import os
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

        workflow.add_conditional_edges(
            "generate",
            self.grade_generation,
            {
                "grounded": END,
                "hallucinating_fallback": "web_search",
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
            verdict = response.content.strip().lower()
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

        prompt = "You are an academic study assistant.\n\n"
        prompt += "Answer the user's question clearly, thoroughly, and objectively using the provided context.\n\n"
        prompt += "Rules:\n"
        prompt += "1. Ground your answer in the facts and information present in the context. If the question asks you to analyze, summarize, critique, or evaluate the context (like a resume or study notes), do so using the context details.\n"
        prompt += "2. Do NOT include any inline citations, bracketed sources, or references in your generated text. Write a natural and readable response.\n"
        prompt += "3. If the context does not contain relevant information to answer the question at all, respond exactly:\n"
        prompt += "Information not found in notes.\n\n"
        prompt += "CONTEXT:\n" + context + "\n\n"
        prompt += "QUESTION:\n" + question + "\n\n"
        prompt += "ANSWER:\n"

        try:
            response = self.llm.invoke(prompt)
            generation = response.content.strip()
            generation = re.sub(r"<think>.*?</think>", "", generation, flags=re.DOTALL).strip()
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
        if state.get("web_search_required", False):
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
            verdict = response.content.strip().lower()
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
                if not has_web:
                    print("Generation contains potential hallucinations. Forcing Web Search fallback.")
                    steps.append("Fact check failed: Answer contained ungrounded claims. Rerouting to Web Search.")
                    return "hallucinating_fallback"
                else:
                    print("Generation contains potential hallucinations, but web search has already run. Returning best effort.")
                    steps.append("Fact check warning: Some claims might not be fully grounded, but search fallbacks exhausted.")
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
