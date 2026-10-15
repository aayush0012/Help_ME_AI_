# HelpMe AI - Master Architecture & System Flowcharts

This document provides the complete, end-to-end visual flowcharts and sequence diagrams for the entire **HelpMe AI RAG & Agent** system.

---

## 1. End-to-End PDF Upload & Ingestion Workflow

This section outlines **exactly** what happens step-by-step when a user drops a PDF into the application.

### A. Sequence Diagram (Browser $\rightarrow$ Backend $\rightarrow$ ChromaDB)

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant UI as 🖥️ React Frontend
    participant API as ⚡ FastAPI (/api/upload)
    participant Worker as 🧵 Background Worker Thread
    participant PyMuPDF as 📄 PyMuPDF + OCR Engine
    participant Splitter as ✂️ Text Splitter
    participant Embed as 🔢 FastEmbed (ONNX)
    participant Chroma as 🧠 ChromaDB

    User->>UI: 1. Drags & drops PDF file
    UI->>UI: 2. Validates .pdf extension & checks session_id
    UI->>UI: 3. Displays "Uploading & Processing..." spinner
    UI->>API: 4. POST /api/upload?session_id=XYZ (multipart/form-data)
    
    API->>API: 5. Validates filename & creates session folder
    API->>API: 6. Saves PDF bytes to disk: uploads/XYZ/doc.pdf
    API->>Chroma: 7. Resets/clears old session collection if re-uploading
    API->>Worker: 8. Offloads heavy processing (run_in_executor)
    
    rect rgb(240, 248, 255)
        Note over Worker,Chroma: Ingestion Subsystem (Background Worker)
        Worker->>PyMuPDF: 9. Open PDF & loop page-by-page (0..N-1)
        
        alt Page has digital text (>= 20 characters)
            PyMuPDF->>PyMuPDF: Extract text directly + tag metadata {"page": page_num}
        else Page is scanned image & Tesseract OCR exists
            PyMuPDF->>PyMuPDF: Convert page to image & run parallel OCR
        end
        
        PyMuPDF->>Splitter: 10. Pass sequential page documents
        Splitter->>Splitter: 11. Split text into ~1000-char chunks (200 overlap)
        Splitter->>Splitter: 12. Convert to 1-based page number ("pages": "1")
        
        Splitter->>Embed: 13. Pass clean chunks to create_vectorstore()
        Worker->>Worker: 14. Compute SHA-256 ID for each chunk
        Embed->>Embed: 15. Generate 384-d vector embeddings in batches of 100
        Embed->>Chroma: 16. Store vectors + text + metadata (file, page #, ID)
        Chroma-->>Worker: 17. Indexing complete (returns chunk count)
    end

    Worker-->>API: 18. Worker finishes (e.g. 18 chunks indexed)
    API-->>UI: 19. HTTP 200 JSON: {"message": "PDF processed", "chunks_indexed": 18}
    UI->>UI: 20. Stops spinner, unlocks chat input box
    UI-->>User: 21. Displays "PDF Ready! Ask your question."
```

### B. Upload Decision Flowchart

```mermaid
flowchart TD
    A([User selects / drops PDF]) --> B[Frontend validates .pdf extension]
    B --> C[Frontend sends POST /api/upload with session_id]
    
    C --> D[FastAPI saves file to disk at: uploads/session_id/doc.pdf]
    D --> E[FastAPI clears any existing Chroma collection for this session]
    E --> F[FastAPI spawns background worker thread]
    
    subgraph IngestionWorker ["Background Processing Thread"]
        F --> G[PyMuPDF opens PDF file]
        G --> H[Loop over Page 0 to Page N-1]
        
        H --> I{Does page have >= 20 chars of digital text?}
        I -- "Yes" --> J[Extract direct text and tag metadata: page_num]
        I -- "No" --> K{Is Tesseract OCR installed?}
        K -- "Yes" --> L[Run parallel Tesseract OCR on page image]
        K -- "No" --> M[Use available raw text characters]
        
        J --> N[Sort all pages in original sequential order]
        L --> N
        M --> N
        
        N --> O[RecursiveCharacterTextSplitter cuts text into 1,000-char chunks]
        O --> P[Filter empty chunks and convert page to 1-based string: '1', '2'...]
        P --> Q[Calculate unique SHA-256 hash ID for each chunk]
        
        Q --> R[FastEmbed converts text chunks into 384-d embeddings]
        R --> S[(ChromaDB inserts records in batches of 100)]
    end
    
    S --> T[Worker returns total chunk count to FastAPI]
    T --> U[FastAPI returns HTTP 200: { chunks_indexed: N }]
    U --> V[Frontend unlocks chat input and notifies user]
    V --> W([Ready to receive questions])
```

---

## 2. End-to-End Query & Retrieval Workflow (Asking a Question)

This section outlines **exactly** what happens step-by-step when a user asks a question in the chat interface.

### A. Sequence Diagram (Browser $\rightarrow$ Hybrid Search $\rightarrow$ Agent $\rightarrow$ Groq LLM $\rightarrow$ Answer)

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant UI as 🖥️ React Frontend
    participant API as ⚡ FastAPI (/api/chat)
    participant Chroma as 🧠 ChromaDB
    participant Hybrid as 🔎 Hybrid Retrieval (BM25 + Dense)
    participant Agent as 🤖 LangGraph StudyAgent
    participant LLM as ⚡ Groq LLM (Compound/Qwen)

    User->>UI: 1. Types question & clicks Send
    UI->>UI: 2. Appends user message to chat feed & shows typing indicator
    UI->>API: 3. POST /api/chat?session_id=XYZ { "question": "..." }
    
    API->>API: 4. Validates question & checks session vectorstore exists
    API->>Chroma: 5. Connects to ChromaDB for session_id
    API->>Agent: 6. Instantiates StudyAgent(vectorstore, llm) & calls agent.invoke()
    
    rect rgb(245, 243, 255)
        Note over Agent,Hybrid: Node 1: 'retrieve' (Hybrid Retrieval Engine)
        Agent->>Hybrid: 7. Calls hybrid_retrieve(query, k=5)
        Hybrid->>Chroma: 8a. Dense Search (FastEmbed embedding + Cosine Similarity)
        Hybrid->>Chroma: 8b. Fetch all corpus documents for BM25
        Hybrid->>Hybrid: 8c. Sparse Search (BM25Okapi token scoring)
        Hybrid->>Hybrid: 8d. Reciprocal Rank Fusion (RRF): Score = 1/(60+Rank_d) + 1/(60+Rank_s)
        Hybrid-->>Agent: 9. Returns Top-5 Fused Chunks with metadata
    end

    rect rgb(254, 243, 199)
        Note over Agent,LLM: Node 2: 'grade_documents'
        Agent->>Agent: 10. Evaluates if retrieved chunks are relevant to question
    end

    rect rgb(240, 253, 244)
        Note over Agent,LLM: Node 3: 'generate'
        Agent->>Agent: 11. Formats chunks into strict context blocks
        Agent->>Agent: 12. Extracts page numbers from chunk metadata: [{source, pages}]
        Agent->>LLM: 13. Calls Groq LLM with strict anti-hallucination prompt
        LLM-->>Agent: 14. Returns context-grounded Markdown answer
        Agent->>Agent: 15. Node 'grade_generation' checks answer validity
    end

    Agent-->>API: 16. Returns { answer: "...", sources: [{ source, pages }], steps: [...] }
    API-->>UI: 17. HTTP 200 JSON payload
    UI->>UI: 18. Renders Markdown text + interactive Page Citation Badges (e.g. 📄 doc.pdf p. 3)
    UI-->>User: 19. Displays answer with clickable sources
```

### B. Retrieval & Answering Decision Flowchart

```mermaid
flowchart TD
    Q0([User types question & clicks Send]) --> Q1[React sends POST /api/chat with session_id]
    
    Q1 --> Q2{Does session vectorstore exist in ChromaDB?}
    Q2 -- "No" --> QErr[Return 400: 'No document ingested yet']
    Q2 -- "Yes" --> Q3[FastAPI initializes StudyAgent with ChromaDB & Groq LLM]
    
    Q3 --> Q4["Agent Node 1: 'retrieve' (Run Hybrid Search)"]
    
    subgraph HybridEngine ["Hybrid Retrieval Process"]
        Q4 --> H1["Dense Search:\nChromaDB Cosine Similarity (top 20)"]
        Q4 --> H2["Sparse Search:\nBM25 Keyword Frequency (top 20)"]
        H1 --> H3["Reciprocal Rank Fusion (RRF):\nRRF_Score = 1/(60+Rank_dense) + 1/(60+Rank_bm25)"]
        H2 --> H3
        H3 --> H4[Select Top-5 Highest Scoring Chunks]
    end
    
    H4 --> Q5["Agent Node 2: 'grade_documents'\nCheck chunk relevance to query"]
    
    Q5 --> Q6{"Are chunks relevant to the question?"}
    
    Q6 -- "No (Web Enabled)" --> QWeb["Node 3: 'web_search'\nQuery DuckDuckGo for web context"]
    Q6 -- "No (Web Disabled)" --> QGen
    Q6 -- "Yes (Relevant)" --> QGen["Node 4: 'generate'\nConstruct Strict Anti-Hallucination Prompt"]
    QWeb --> QGen
    
    QGen --> QLLM["Call Groq LLM (Compound-Mini / Fallbacks)"]
    QLLM --> QExtract["Extract Deterministic Page Citations from doc.metadata['pages']"]
    
    QExtract --> QCheck{"Node: 'grade_generation'\nIs answer grounded?"}
    QCheck -- "Yes / Complete" --> QReturn[Return JSON { answer, sources, steps }]
    QCheck -- "Hallucinated & Web On" --> QWeb
    
    QReturn --> QUI[Frontend displays Markdown Answer + Clickable Page Citation Badges]
    QUI --> QEnd([Done])
```

---

## 3. Dedicated Hybrid Search Engine (`backend/hybrid_retrieval.py`)

```mermaid
flowchart TD
    QueryIn([User Query Received]) --> Fork[Run Parallel Search Queries]
    
    subgraph Dense ["1. Dense Semantic Search (ChromaDB)"]
        Fork --> D1["Embed query using FastEmbed"]
        D1 --> D2["ChromaDB Cosine Similarity Search"]
        D2 --> D3["Retrieve Top Dense Chunks\n(Rank 1 to N)"]
    end
    
    subgraph Sparse ["2. Sparse Keyword Search (BM25)"]
        Fork --> S1["Tokenize Query & All Corpus Chunks"]
        S1 --> S2["BM25Okapi Keyword Frequency Scoring"]
        S2 --> S3["Sort by BM25 Score & Filter score > 0\n(Rank 1 to N)"]
    end
    
    D3 --> RRF["3. Reciprocal Rank Fusion (RRF Algorithm)\n\nFor each chunk d:\nRRF_Score(d) = 1 / (60 + Rank_dense) + 1 / (60 + Rank_sparse)"]
    S3 --> RRF
    
    RRF --> SortRank["4. Sort Chunks by Highest Fused RRF Score"]
    SortRank --> TopK([5. Return Top-K Ranked Chunks to Agent, k=5])
```

---

## 4. LangGraph Study Agent StateGraph (`backend/agent.py`)

```mermaid
flowchart TD
    StartGraph([START]) --> NodeRetrieve["Node 1: 'retrieve'\n• Calls hybrid_retrieve(k=5)\n• Collects Top-5 Chunks + Steps"]
    
    NodeRetrieve --> NodeGrade["Node 2: 'grade_documents'\n• Evaluates chunk relevance to question"]
    
    NodeGrade --> EdgeDecide{"Conditional Edge:\n'decide_next_step'"}
    
    EdgeDecide -- "Chunks are relevant" --> NodeGenerate["Node 4: 'generate'\n• Build strict anti-hallucination prompt\n• Feed verified chunks\n• Call Groq LLM (Compound / Qwen)"]
    
    EdgeDecide -- "No relevant chunks\n& Web Search Enabled" --> NodeWeb["Node 3: 'web_search'\n• Query DuckDuckGo\n• Convert web snippets to Documents"]
    
    EdgeDecide -- "No relevant chunks\n& Web Search Disabled" --> NodeGenerate
    
    NodeWeb --> NodeGenerate
    
    NodeGenerate --> EdgeGradeGen{"Conditional Edge:\n'grade_generation'\n(Hallucination / Groundedness Check)"}
    
    EdgeGradeGen -- "Grounded / Valid Answer" --> ExtractMeta["Extract Page Citations from Chunk Metadata:\n[{ source: 'file.pdf', pages: '3' }]"]
    
    EdgeGradeGen -- "Hallucinating (Web fallback)" --> NodeWeb
    
    EdgeGradeGen -- "Max attempts reached / Done" --> ExtractMeta
    
    ExtractMeta --> EndGraph([END: Return Answer + Sources + Steps to API])
```

---

## 5. Master End-to-End System Architecture

```mermaid
flowchart TD
    %% Styling
    classDef ui fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef api fill:#0f172a,stroke:#818cf8,stroke-width:2px,color:#f8fafc;
    classDef ingest fill:#0369a1,stroke:#38bdf8,stroke-width:2px,color:#ffffff;
    classDef agent fill:#4338ca,stroke:#a78bfa,stroke-width:2px,color:#ffffff;
    classDef db fill:#065f46,stroke:#34d399,stroke-width:2px,color:#ffffff;

    User(["👤 User"]):::ui
    Frontend["🖥️ React Frontend (Vite)\n• PDF Drag & Drop\n• Chat Interface\n• Clickable Page Badges"]:::ui
    
    FastAPI["⚡ FastAPI Backend (`main.py`)\n• POST /api/upload\n• POST /api/chat\n• Session Management"]:::api
    
    User <--> Frontend
    Frontend <-->|"REST API Requests / JSON"| FastAPI

    %% Ingestion
    subgraph IngestionSystem ["📥 Ingestion Subsystem (`document_ingestion.py`)"]
        Parser["PyMuPDF Parser + Tesseract OCR"]:::ingest
        Splitter["Text Splitter (1,000 chars)"]:::ingest
        Embedding["FastEmbed (ONNX 384-d vectors)"]:::ingest
        Parser --> Splitter --> Embedding
    end

    %% Storage
    ChromaDB[("🧠 ChromaDB Vector Store\n• Dense Vectors\n• Chunk Text\n• Page Metadata (source, pages)")]:::db

    %% Retrieval & Agent
    subgraph AgentSystem ["🤖 Hybrid Search & Agent Subsystem (`hybrid_retrieval.py` & `agent.py`)"]
        Hybrid["Hybrid Search (Dense + BM25 + RRF)"]:::agent
        Graph["LangGraph StateGraph\n(Retrieve -> Grade -> Fallback -> Generate)"]:::agent
        Groq["⚡ Groq LLM Inference\n(Compound-Mini / Qwen / GPT-OSS)"]:::agent
        Hybrid --> Graph --> Groq
    end

    FastAPI -->|"Upload PDF"| IngestionSystem
    Embedding -->|"Save Chunks & Vectors"| ChromaDB
    
    FastAPI -->|"User Question"| AgentSystem
    ChromaDB -.->|"Retrieve Chunks"| Hybrid
    Groq -->|"Answer + Page Metadata"| FastAPI
```

---

## 6. Technology Stack & Role Summary

| Layer / Subsystem | File Location | Technology | Primary Responsibility |
| :--- | :--- | :--- | :--- |
| **User Interface** | `frontend/` | React, Vite, CSS | Drag-and-drop PDF upload, interactive chat UI, and source citation badges. |
| **REST Server** | `backend/main.py` | FastAPI, Uvicorn, Pydantic | Non-blocking async API handling `/api/upload` and `/api/chat` with session isolation. |
| **PDF Ingestion** | `backend/document_ingestion.py` | PyMuPDF, Tesseract OCR | Page-by-page text extraction with OCR fallback and page number preservation. |
| **Chunking & Indexing** | `backend/document_ingestion.py` | LangChain Text Splitter, hashlib | Cuts text into 1,000-char chunks, assigns SHA-256 IDs, and attaches page metadata. |
| **Embedding Generation** | `backend/main.py` | FastEmbed (`BAAI/bge-small-en-v1.5`) | Generates 384-dimensional vector embeddings locally via ONNX Runtime with zero API costs. |
| **Vector Storage** | `backend/chroma_db/` | ChromaDB (SQLite + HNSW) | Persistent embedded vector database storing chunk vectors, texts, and metadata. |
| **Hybrid Search** | `backend/hybrid_retrieval.py` | ChromaDB + `rank_bm25` (BM25Okapi) | Dual retrieval (semantic + keyword) fused via Reciprocal Rank Fusion (RRF). |
| **LangGraph Agent** | `backend/agent.py` | LangGraph (`StateGraph`), DuckDuckGo | Orchestrates relevance grading, web search fallback, and groundedness verification. |
| **LLM Inference** | `backend/main.py` | Groq API (`ChatGroq`) | Ultra-fast token generation using high-speed cloud LLMs (`Compound-Mini`, `Qwen`). |
