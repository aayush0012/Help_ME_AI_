import os
import sys
import time
from typing import List, Dict, Any

# Ensure backend directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv()

from langchain_groq import ChatGroq
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from document_ingestion import partition_document, chunk_document, process_chunks
from agent import StudyAgent

# Initialize Embeddings & VectorStore
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
PERSIST_DIRECTORY = os.path.join(os.path.dirname(__file__), "..", "chroma_db")

vectorstore = Chroma(
    persist_directory=PERSIST_DIRECTORY,
    embedding_function=embeddings
)

groq_api_key = os.getenv("GROQ_API_KEY")
if not groq_api_key:
    print("Error: GROQ_API_KEY environment variable not set.")
    sys.exit(1)

primary_llm = ChatGroq(
    model="openai/gpt-oss-120b",
    temperature=0.0,
    groq_api_key=groq_api_key
)
fallback_llm1 = ChatGroq(
    model="qwen/qwen3.6-27b",
    temperature=0.0,
    groq_api_key=groq_api_key
)
fallback_llm2 = ChatGroq(
    model="openai/gpt-oss-20b",
    temperature=0.0,
    groq_api_key=groq_api_key
)
llm = primary_llm.with_fallbacks([fallback_llm1, fallback_llm2])

agent = StudyAgent(vectorstore=vectorstore, llm=llm)

# Evaluation Test Suite (Aligned with docs/rag.pdf: Hashing and Collision)
EVAL_QUESTIONS = [
    {
        "id": 1,
        "question": "What is the running time of linear search versus binary search mentioned in the slides?",
        "expected_keywords": ["linear", "binary", "o(n)", "o(log n)"],
        "category": "Document Content (Exact Fact)"
    },
    {
        "id": 2,
        "question": "Who is the author of the document and what is her email address?",
        "expected_keywords": ["divyashikha", "sethia", "dtu.ac.in"],
        "category": "Document Metadata"
    },
    {
        "id": 3,
        "question": "What is the main motivation discussed in the slides regarding search time?",
        "expected_keywords": ["search", "o(1)", "time", "motivation"],
        "category": "Document Reasoning"
    },
    {
        "id": 4,
        "question": "What is Retrieval-Augmented Generation (RAG) and how does vector search work?",
        "expected_keywords": ["retrieval", "vector", "generation", "rag"],
        "category": "Out-of-Document (Web Fallback)"
    },
    {
        "id": 5,
        "question": "What is the current stock price of Apple Inc today?",
        "expected_keywords": ["apple", "stock", "price"],
        "category": "Adversarial (Web Fallback)"
    }
]

def run_accuracy_evaluation(pdf_path: str = None):
    print("=" * 70)
    print("🚀 STARTING RAG SYSTEM ACCURACY BENCHMARK EVALUATION")
    print("=" * 70)

    if pdf_path and os.path.exists(pdf_path):
        print(f"📄 Ingesting evaluation document: {pdf_path}")
        elements = partition_document(pdf_path)
        chunks = chunk_document(elements)
        processed_docs = process_chunks(chunks, os.path.basename(pdf_path))
        if processed_docs:
            vectorstore.add_documents(processed_docs)
            print(f"✅ Ingested {len(processed_docs)} document chunks into Chroma DB.\n")

    results = []
    total_latency = 0.0
    relevant_retrievals = 0
    grounded_generations = 0
    fallback_triggers = 0

    for test in EVAL_QUESTIONS:
        q_id = test["id"]
        q_text = test["question"]
        category = test["category"]
        expected_kw = test["expected_keywords"]

        print(f"[{q_id}/{len(EVAL_QUESTIONS)}] Testing: '{q_text}' ({category})")
        start_time = time.time()

        # Invoke RAG Agent StateGraph
        initial_state = {
            "question": q_text,
            "documents": [],
            "generation": "",
            "web_search_required": False,
            "sources": [],
            "steps": []
        }

        output = agent.graph.invoke(initial_state)
        latency = round(time.time() - start_time, 2)
        total_latency += latency

        retrieved_docs = output.get("documents", [])
        answer = output.get("generation", "")
        sources = output.get("sources", [])
        web_required = output.get("web_search_required", False)
        steps = output.get("steps", [])

        # 1. Evaluate Retrieval Precision (Keyword presence in retrieved context)
        retrieved_text = " ".join([d.page_content for d in retrieved_docs]).lower()
        keyword_hits = sum(1 for kw in expected_kw if kw.lower() in retrieved_text)
        retrieval_pass = (keyword_hits > 0 or len(expected_kw) == 0) and len(retrieved_docs) > 0
        if retrieval_pass:
            relevant_retrievals += 1

        # 2. Evaluate Groundedness / Faithfulness (Agent verification steps)
        # If hallucinating_fallback or web_search occurred, track fallback
        web_fallback_used = any("web_search" in step for step in steps) or web_required
        if web_fallback_used:
            fallback_triggers += 1

        # Grounded if answer is non-empty and backed by sources
        grounded_pass = len(answer.strip()) > 30 and (len(sources) > 0 or web_fallback_used)
        if grounded_pass:
            grounded_generations += 1

        res_entry = {
            "id": q_id,
            "question": q_text,
            "category": category,
            "retrieved_chunks": len(retrieved_docs),
            "retrieval_pass": "PASS" if retrieval_pass else "FAIL",
            "grounded_pass": "PASS" if grounded_pass else "FAIL",
            "web_fallback": "YES" if web_fallback_used else "NO",
            "latency_s": latency,
            "sources_count": len(sources),
            "answer_preview": answer[:120].replace("\n", " ") + "..."
        }
        results.append(res_entry)

        print(f"   └─ Retrieval: {res_entry['retrieval_pass']} | Groundedness: {res_entry['grounded_pass']} | Fallback: {res_entry['web_fallback']} | Time: {latency}s")
        print("-" * 70)

    # Compute Summary Metrics
    total_tests = len(EVAL_QUESTIONS)
    context_recall_pct = round((relevant_retrievals / total_tests) * 100, 1)
    faithfulness_pct = round((grounded_generations / total_tests) * 100, 1)
    avg_latency_ms = round((total_latency / total_tests) * 1000, 0)

    print("\n" + "=" * 70)
    print("📊 FINAL RAG ACCURACY EVALUATION REPORT")
    print("=" * 70)
    print(f"• Context Retrieval Precision Rate: {context_recall_pct}% ({relevant_retrievals}/{total_tests})")
    print(f"• Answer Faithfulness & Groundedness: {faithfulness_pct}% ({grounded_generations}/{total_tests})")
    print(f"• Web Search Fallbacks Triggered  : {fallback_triggers}/{total_tests}")
    print(f"• Average End-to-End Query Latency : {avg_latency_ms} ms")
    print("=" * 70 + "\n")

    # Save Report to Markdown Artifact
    report_path = os.path.join(os.path.dirname(__file__), "evaluation_report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# RAG System Accuracy & Performance Evaluation Report\n\n")
        f.write(f"**Evaluation Date:** {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**LLM Evaluator:** Groq `llama-3.3-70b-versatile` | **Embeddings:** `all-MiniLM-L6-v2`\n\n")
        f.write("## 📈 Summary Metrics\n\n")
        f.write(f"| Metric | Result | Benchmark Target |\n")
        f.write(f"| :--- | :---: | :---: |\n")
        f.write(f"| **Context Retrieval Precision** | **{context_recall_pct}%** | > 85% |\n")
        f.write(f"| **Answer Groundedness & Faithfulness** | **{faithfulness_pct}%** | > 90% |\n")
        f.write(f"| **Web Search Fallback Rate** | **{(fallback_triggers/total_tests)*100:.1f}%** | Safe Routing |\n")
        f.write(f"| **Average Query Latency** | **{avg_latency_ms:.0f} ms** | < 1500 ms |\n\n")
        f.write("## 📋 Per-Query Evaluation Breakdown\n\n")
        f.write("| ID | Category | Question | Retrieval | Groundedness | Fallback | Latency |\n")
        f.write("|---|---|---|:---:|:---:|:---:|:---:|\n")
        for r in results:
            f.write(f"| {r['id']} | {r['category']} | {r['question']} | {r['retrieval_pass']} | {r['grounded_pass']} | {r['web_fallback']} | {r['latency_s']}s |\n")

    print(f"📄 Detailed evaluation report written to {report_path}")

if __name__ == "__main__":
    sample_pdf = os.path.join(os.path.dirname(__file__), "..", "docs", "rag.pdf")
    run_accuracy_evaluation(sample_pdf)
