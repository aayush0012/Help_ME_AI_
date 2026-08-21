# RAG System Accuracy & Performance Evaluation Report

**Evaluation Date:** 2026-08-21 09:21:17
**LLM Evaluator:** Groq `llama-3.3-70b-versatile` | **Embeddings:** `all-MiniLM-L6-v2`

## 📈 Summary Metrics

| Metric | Result | Benchmark Target |
| :--- | :---: | :---: |
| **Context Retrieval Precision** | **60.0%** | > 85% |
| **Answer Groundedness & Faithfulness** | **100.0%** | > 90% |
| **Web Search Fallback Rate** | **60.0%** | Safe Routing |
| **Average Query Latency** | **6226 ms** | < 1500 ms |

## 📋 Per-Query Evaluation Breakdown

| ID | Category | Question | Retrieval | Groundedness | Fallback | Latency |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | Document Content (Exact Fact) | What is the running time of linear search versus binary search mentioned in the slides? | PASS | PASS | NO | 10.03s |
| 2 | Document Metadata | Who is the author of the document and what is her email address? | FAIL | PASS | YES | 3.58s |
| 3 | Document Reasoning | What is the main motivation discussed in the slides regarding search time? | PASS | PASS | NO | 2.43s |
| 4 | Out-of-Document (Web Fallback) | What is Retrieval-Augmented Generation (RAG) and how does vector search work? | PASS | PASS | YES | 2.33s |
| 5 | Adversarial (Web Fallback) | What is the current stock price of Apple Inc today? | FAIL | PASS | YES | 12.76s |
