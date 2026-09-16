import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import re
from typing import List, TypedDict, Dict, Any
from duckduckgo_search import DDGS
from langchain_core.documents import Document
from langgraph.graph import StateGraph, START, END
from hybrid_retrieval import hybrid_retrieve

class AgentState(TypedDict):
    question: str
    documents: List[Document]
    generation: str
    web_search_required: bool
    sources: List[Dict[str, Any]]
    steps: List[str]

class StudyAgent:
    def __init__(self, vectorstore, llm):
        self.vectorstore = vectorstore
        self.llm = llm
        self.graph = self._build_graph()

    def _build_graph(self):
        workflow = StateGraph(AgentState)

        workflow.add_node("retrieve", self.node_retrieve)
        workflow.add_node("grade_documents", self.node_grade_documents)
        workflow.add_node("web_search", self.node_web_search)
        workflow.add_node("generate", self.node_generate)

        workflow.add_edge(START, "retrieve")
        workflow.add_edge("retrieve", "grade_documents")
        
        workflow.add_conditional_edges(
            "grade_documents",
            self.decide_next_step,
            {
                "web_search": "web_search",
                "generate": "generate"
            }
        )
        
        workflow.add_edge("web_search", "generate")

        enable_web = os.getenv("ENABLE_WEB_SEARCH", "false").lower() == "true"
        workflow.add_conditional_edges(
            "generate",
            self.grade_generation,
            {
                "grounded": END,
                "hallucinating_fallback": "web_search" if enable_web else END,
                "max_attempts_reached": END
            }
        )

        return workflow.compile()

    def node_retrieve(self, state: AgentState) -> Dict[str, Any]:
        print("\n--- AGENT: RETRIEVING DOCUMENTS ---")
        question = state["question"]
        docs_with_scores = hybrid_retrieve(self.vectorstore, question, k=5)
        
        docs = []
        for item in docs_with_scores:
            doc = item[0]
            docs.append(doc)
            
        steps = state.get("steps", [])
        steps.append("Retrieved chunks using Hybrid Retrieval (Vector + BM25)")

        return {
            "documents": docs,
            "steps": steps
        }

    def node_grade_documents(self, state: AgentState) -> Dict[str, Any]:
        print("\n--- AGENT: GRADING DOCUMENT RELEVANCE ---")
        question = state["question"]
        docs = state["documents"]
        steps = state.get("steps", [])
        steps.append("Grading source document relevance to question")

        if not docs:
            print("No documents retrieved. Flagging for web search.")
            return {
                "web_search_required": True,
                "steps": steps
            }

        parts = []
        for i in range(len(docs)):
            num = i + 1
            doc = docs[i]
            part = "Document " + str(num) + ":\n" + doc.page_content
            parts.append(part)
        context = "\n\n".join(parts)
        
        prompt = "You are an academic grader evaluating if the provided document context is relevant to the question.\n"
        prompt += "If the question is asking to analyze, summarize, evaluate, or critique the document context itself (like a resume, essay, or study notes), the context is highly relevant.\n\n"
        prompt += "CONTEXT:\n" + context + "\n\n"
        prompt += "QUESTION:\n" + question + "\n\n"
        prompt += "Is this CONTEXT relevant to the QUESTION? Respond with exactly one word: 'yes' or 'no'.\n"
        prompt += "Do not include any other text, explanation, or punctuation.\n"

        try:
            response = self.llm.invoke(prompt)
            raw_text = str(response.content) if hasattr(response, "content") and response.content is not None else str(response or "")
            verdict = raw_text.strip().lower()
            verdict = re.sub(r"<think>.*?</think>", "", verdict, flags=re.DOTALL).strip()
            print("Document Relevance Verdict: " + verdict)
            
            if "yes" in verdict:
                return {
                    "web_search_required": False,
                    "steps": steps
                }
            else:
                print("All retrieved documents graded as IRRELEVANT. Triggering Web Search.")
                return {
                    "web_search_required": True,
                    "steps": steps
                }
        except Exception as e:
            print(e)
            return {
                "web_search_required": False,
                "steps": steps
            }

    def node_web_search(self, state: AgentState) -> Dict[str, Any]:
        print("\n--- AGENT: PERFORMING WEB SEARCH FALLBACK ---")
        question = state["question"]
        steps = state.get("steps", [])
        steps.append("Performed web search fallback for supplementary context")

        search_query = re.sub(r"^(who (was|is)|what (is|are|was)|how to|explain|tell me about|can you)\s+", "", question, flags=re.IGNORECASE)
        search_query = search_query.strip("?. ")
        print("Original query: '" + question + "' -> Cleaned search query: '" + search_query + "'")

        web_docs = []
        try:
            with DDGS() as ddgs:
                results = list(ddgs.text(search_query, max_results=3))
                
                if not results:
                    results = list(ddgs.text(search_query, backend="html", max_results=3))
                
                for r in results:
                    body = r.get("body", "")
                    href = r.get("href", "web")
                    title = r.get("title", "Web Source")
                    
                    doc = Document(
                        page_content=body,
                        metadata={
                            "source": href,
                            "pages": "web",
                            "title": title
                        }
                    )
                    web_docs.append(doc)
            print("Web search completed successfully. Found " + str(len(web_docs)) + " web snippets.")
        except Exception as e:
            print(e)

        current_docs = state.get("documents", [])
        return {
            "documents": current_docs + web_docs,
            "steps": steps
        }

    def node_generate(self, state: AgentState) -> Dict[str, Any]:
        print("\n--- AGENT: GENERATING ANSWER ---")
        question = state["question"]
        docs = state["documents"]
        steps = state.get("steps", [])
        steps.append("Generating final response with context")

        parts = []
        sources = []
        seen = []

        for i in range(len(docs)):
            num = i + 1
            doc = docs[i]
            meta = doc.metadata
            
            source = meta.get("source")
            if not source:
                source = "unknown"
                
            pages = meta.get("pages")
            if not pages:
                pages = "unknown"
                
            title = meta.get("title")
            if not title:
                title = ""

            part = "### Reference Context #" + str(num) + " (File: " + str(source) + ", Location: " + str(pages) + ")\n" + doc.page_content
            parts.append(part)

            key = str(source) + "::" + str(pages)
            if key not in seen:
                seen.append(key)
                item = {
                    "source": source,
                    "pages": pages,
                    "title": title
                }
                sources.append(item)

        context = "\n\n".join(parts)

        prompt = (
            "You are a strict, context-grounded AI assistant for document analysis. "
            "Your task is to answer the user's question using EXCLUSIVELY the verified CONTEXT chunks provided below.\n\n"
            "MANDATORY ANTI-HALLUCINATION CONSTRAINTS (STRICT ADHERENCE REQUIRED):\n"
            "1. ABSOLUTE CONTEXT BOUNDARY: You must base your answer ONLY on facts, definitions, numbers, procedures, and statements directly present in the CONTEXT. "
            "Never use outside world knowledge, training assumptions, or unmentioned external facts.\n"
            "2. ZERO EXTRAPOLATION: Do NOT speculate, infer, extrapolate, or embellish. If a concept, tool, file name, method, or detail is not explicitly mentioned in the context chunks, you MUST NOT include it in your response.\n"
            "3. NO FABRICATED EXPLANATIONS: Do NOT invent explanations or background information to make the answer sound more complete. If the context gives a brief or partial explanation, present only that brief or partial explanation.\n"
            "4. PARTIAL / UNMENTIONED TOPICS: If the context answers only part of the question, answer ONLY the supported part and explicitly note: 'The provided document does not contain details regarding [unmentioned aspect].'\n"
            "5. MISSING INFORMATION: If the context contains NO factual basis to answer the question, respond with ONLY:\n"
            "Information not found in the provided document.\n"
            "6. CLEAN BODY TEXT: Do not write artificial citation brackets like [Source 1] or [Page 2] in the body text (sources are tracked automatically).\n\n"
            "PRESENTATION GUIDELINES (USE ONLY CONTEXT FACTS):\n"
            "- Structure the answer clearly using Markdown headings (e.g. `### Summary`, `### Key Points`, `### Details`).\n"
            "- Use bullet points with **bold lead-ins** for concepts explicitly found in the context.\n"
            "- If commands, code, or syntax are directly provided in the context, format them in `inline code` or ```code blocks```.\n"
            "- If comparing categories or data directly present in the context, format with a clean Markdown table.\n\n"
            f"=== VERIFIED DOCUMENT CONTEXT CHUNKS ===\n{context}\n=== END DOCUMENT CONTEXT ===\n\n"
            f"USER QUESTION: {question}\n\n"
            "STRICT CONTEXT-GROUNDED ANSWER:\n"
        )

        try:
            response = self.llm.invoke(prompt)
            raw_text = ""
            if hasattr(response, "content") and response.content is not None:
                if isinstance(response.content, str):
                    raw_text = response.content
                elif isinstance(response.content, list):
                    raw_text = " ".join([item.get("text", "") if isinstance(item, dict) else str(item) for item in response.content])
                else:
                    raw_text = str(response.content)
            else:
                raw_text = str(response or "")

            generation = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL).strip()
            if not generation:
                generation = "Information not found in notes."
        except Exception as e:
            print(f"Error in node_generate LLM invocation: {e}")
            err_msg = str(e)
            if "groq_api_key" in err_msg.lower() or "api_key" in err_msg.lower() or "401" in err_msg or "unauthorized" in err_msg.lower():
                generation = "Error generating answer: GROQ_API_KEY environment variable is missing or invalid in deployment settings."
            else:
                generation = f"Error generating answer: {err_msg}"

        return {
            "generation": generation,
            "sources": sources,
            "steps": steps
        }

    def decide_next_step(self, state: AgentState) -> str:
        enable_web = os.getenv("ENABLE_WEB_SEARCH", "false").lower() == "true"
        if enable_web and state.get("web_search_required", False):
            return "web_search"
        return "generate"

    def grade_generation(self, state: AgentState) -> str:
        print("\n--- AGENT: CHECKING FOR HALLUCINATIONS ---")
        generation = state["generation"]
        docs = state["documents"]
        steps = state.get("steps", [])

        if "information not found" in generation.lower() or "error generating" in generation.lower():
            return "max_attempts_reached"

        parts = []
        for doc in docs:
            parts.append(doc.page_content)
        context = "\n\n".join(parts)
        
        prompt = "You are an academic evaluator checking for hallucinations and fact conflicts.\n\n"
        prompt += "SUPPORTING CONTEXT:\n" + context + "\n\n"
        prompt += "GENERATED ANSWER:\n" + generation + "\n\n"
        prompt += "Is the GENERATED ANSWER consistent with and supported by the SUPPORTING CONTEXT?\n"
        prompt += "Respond with 'yes' if the answer is grounded and does not fabricate fake facts.\n"
        prompt += "Respond with 'no' if the answer contains fabricated facts or directly contradicts the context.\n"
        prompt += "Do not write any explanation, introduction, or punctuation.\n"

        try:
            response = self.llm.invoke(prompt)
            raw_text = str(response.content) if hasattr(response, "content") and response.content is not None else str(response or "")
            verdict = raw_text.strip().lower()
            verdict = re.sub(r"<think>.*?</think>", "", verdict, flags=re.DOTALL).strip()
            print("Hallucination Grader Verdict: " + verdict)

            has_web = False
            for doc in docs:
                pages = doc.metadata.get("pages")
                if pages == "web":
                    has_web = True

            if "yes" in verdict:
                steps.append("Fact check passed: Answer is fully grounded in context.")
                return "grounded"
            else:
                enable_web = os.getenv("ENABLE_WEB_SEARCH", "false").lower() == "true"
                if enable_web and not has_web:
                    print("Generation contains potential hallucinations. Forcing Web Search fallback.")
                    steps.append("Fact check failed: Answer contained ungrounded claims. Rerouting to Web Search.")
                    return "hallucinating_fallback"
                else:
                    print("Generation evaluated against context. Returning context-grounded response.")
                    steps.append("Fact check complete: Returned context-grounded response.")
                    return "max_attempts_reached"
        except Exception as e:
            print(e)
            return "max_attempts_reached"

    def invoke(self, question: str) -> Dict[str, Any]:
        initial_state = {
            "question": question,
            "documents": [],
            "generation": "",
            "web_search_required": False,
            "sources": [],
            "steps": []
        }
        final_state = self.graph.invoke(initial_state)
        return {
            "answer": final_state["generation"],
            "sources": final_state["sources"],
            "steps": final_state["steps"]
        }
