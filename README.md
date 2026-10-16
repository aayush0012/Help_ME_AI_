# HelpMe AI - PDF Document Search & RAG System

HelpMe AI is a full-stack, state-of-the-art **Retrieval-Augmented Generation (RAG)** application. It allows users to upload any PDF document, automatically builds a semantic search index, and provides an interactive chat interface to ask questions. The system answers questions using *only* the context extracted from the document and references the **exact page numbers** the information was retrieved from.

Additionally, the pipeline features a **smart fallback to Cloud Vision OCR** (via Llama 3.2 Vision on Groq) for scanned PDFs and image-heavy documents, ensuring high-quality text extraction under all circumstances.

---

## 🚀 Key Features

* **Interactive Chat Interface**: A polished, responsive React single-page app (SPA) with a sliding drawer for file uploads, message history, auto-scrolling, and inline source page citations.
* **Smart Ingestion Pipeline**:
  * Extracted text is checked for quality. If a PDF yields insufficient text (e.g. scanned images, forms), the pipeline automatically triggers **Cloud Vision OCR**.
  * Runs page-by-page OCR transcription using **Llama 3.2 11B Vision** via Groq API.
* **Semantic Indexing & Vector DB**:
  * Chunks text using `RecursiveCharacterTextSplitter` from LangChain.
  * Encodes text using Hugging Face's `sentence-transformers/all-MiniLM-L6-v2` embeddings.
  * Persists embeddings inside a local **Chroma DB** instance.
  * Utilizes SHA-256 deduplication to prevent indexing duplicate chunks.
* **Context-Grounded Q&A**:
  * Queries are answered by **Llama 3.3 70B** via Groq, strictly constrained to the ingested context.
  * Returns distance scores and source page numbers to the frontend.
* **Containerized Deployment**:
  * Features a single multi-stage `Dockerfile` that compiles the React frontend and packages it inside the FastAPI backend container for effortless single-port deployment.

---

## 🛠️ Architecture Overview

The workspace is organized into two primary services:
* **Frontend**: A React/Vite web interface that displays the welcome landing, document uploader, chat history, loading indicators, and source citations.
* **Backend**: A FastAPI server that handles file upload processing, runs the PDF parser/OCR pipeline, connects to the Chroma vector store, builds prompt contexts, and calls the Groq LLM API.

```
Rag_based_Project-/
├── backend/
│   ├── main.py                 # FastAPI application, routing, and server config
│   ├── document_ingestion.py   # OCR, parsing, chunking, and database indexing pipeline
│   ├── retrieval.py            # Local CLI testing script with conversation history
│   ├── uploads/                # Directory for temporary uploaded PDFs
│   ├── chroma_db/              # Persisted vector database (Chroma)
│   └── .env                    # Local environment configuration file
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # React UI application
│   │   ├── App.css             # Main stylesheet
│   │   ├── index.css           # Core typography and baseline styles
│   │   └── main.jsx            # Frontend entrypoint
│   ├── index.html              # Main HTML skeleton
│   ├── package.json            # Frontend node packages
│   └── vite.config.js          # Vite config
├── docs/                       # Example files and test documents (e.g. rag.pdf)
├── Dockerfile                  # Multi-stage production container setup
├── requirements.txt            # Python backend dependencies
└── README.md                   # Project documentation
```

---

## 📊 Pipeline Flowcharts

> [!NOTE]
> I am still actively learning **LangGraph** to build the agentic state machine, so this part of the project is a work in progress as I continue my learning journey!

### 1. Document Ingestion Pipeline

```text
[ START: User Uploads PDF ]
          │
          ▼
[ main.py: get_session_paths() ] ──► Creates safe user session folders
          │
          ▼
[ document_ingestion.py: partition_document() ] ──► Opens PDF & reads characters
          │
          ├──► (If Text Characters >= 150) ──► Keep standard text
          │
          └──► (If Text Characters < 150) ──► Convert PDF to PNG images
                                                     │
                                                     ▼
                                            [ Groq Vision OCR ] 
                                            Reads images & extracts text
          │
          ▼
[ document_ingestion.py: chunk_document() ] 
Cuts text into 1000-character blocks (with 200 character overlap)
          │
          ▼
[ document_ingestion.py: make_doc_id() ] 
Generates unique IDs using SHA256 hashes to prevent duplicates
          │
          ▼
[ document_ingestion.py: create_vectorstore() ] 
Sends blocks in batches of 100 to HuggingFace to get number values (Embeddings)
          │
          ▼
[ SQLite-based ChromaDB ] ──► Saves text + numbers into session folder
          │
          ▼
[ END: Return Success Status to Frontend ]
```

### 2. Chat Retrieval & Agentic Pipeline

```text
[ START: User submits question ]
          │
          ▼
[ main.py: Initialize ChromaDB for Session ]
          │
          ▼
[ agent.py: node_retrieve ] (Still learning LangGraph state machines)
          │
          ▼
[ hybrid_retrieval.py: hybrid_retrieve() ] 
Runs parallel searches:
  ├──► Vector Search (Chroma) ──► Semantic / Meaning Matches
  └──► Keyword Search (BM25)  ──► Exact Word Matches
          │
          ▼
[ Reciprocal Rank Fusion (RRF) ] ──► Fuses and ranks all matches
          │
          ▼
[ agent.py: node_grade_documents ] 
Ask LLM: "Is this retrieved information relevant to the question?"
          │
          ├─► (Verdicts is 'yes') ──────────────────────────────┐
          │                                                     │
          └─► (Verdict is 'no') ──► [ agent.py: node_web_search ] │
                                    Queries DuckDuckGo Search   │
                                    & appends web results       │
                                              │                 │
                                              ▼                 ▼
                                    [ agent.py: node_generate ]
                                    Llama 3.3 writes final response
                                              │
                                              ▼
                                    [ agent.py: grade_generation ]
                                    LLM checks for hallucinations
                                              │
                    ┌─────────────────────────┴────────────────────────┐
                    ▼                                                  ▼
          (Passed: Grounded)                                 (Failed: Hallucinated)
                    │                                                  │
                    ▼                                                  ▼
[ END: Return answer & sources ]                        Check: Has Web Search run yet?
                                                         ├──► (No) ──► Go to Web Search
                                                         └──► (Yes) ──► Return best-effort
```

---

## 📋 Prerequisites

Make sure you have the following installed on your machine:
* **Python 3.10+**
* **Node.js 18+**
* **Docker** (optional, for containerized execution)
* **Groq Cloud API Key** (for LLM generation and OCR)
* **Hugging Face Hub Token** (for vector embeddings)

---

## 🔧 Installation & Setup

### 1. Set Up Environment Variables

Create a file named `.env` in the `backend/` directory:

```bash
# Navigate to backend and create .env file
cd backend
touch .env
```

Add your API keys to the `backend/.env` file:
```env
GROQ_API_KEY="your-groq-api-key"
HUGGINGFACEHUB_API_TOKEN="your-huggingface-token"

# Optional: List of origins allowed to call the backend API (or * for wildcard)
CORS_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

---

### 2. Run the Backend (FastAPI)

1. Open a new terminal in the project root.
2. Create and activate a Python virtual environment:
   ```bash
   # Windows (PowerShell)
   python -m venv .venv
   .venv\Scripts\Activate.ps1

   # macOS / Linux
   python3 -m venv .venv
   source .venv/bin/activate
   ```
3. Install backend dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the FastAPI development server:
   ```bash
   uvicorn backend.main:app --reload --port 8000
   ```

---

### 3. Run the Frontend (React + Vite)

1. Open a new terminal in the project root.
2. Navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```
3. Install packages:
   ```bash
   npm install
   ```
4. Start the frontend development server:
   ```bash


---

## 🔌 API Documentation

The FastAPI backend exposes the following primary endpoints:

### 1. Ingest PDF Document
* **Endpoint**: `/upload`
* **Method**: `POST`
* **Content-Type**: `multipart/form-data`
* **Request Body**: `file` (PDF file)
* **Description**: Receives a PDF file, parses it (falling back to Cloud OCR if text is sparse), chunks it, generates embeddings, and saves/indexes the vectors in Chroma DB.
* **Example Response**:
  ```json
  {
    "message": "PDF processed successfully",
    "chunks_indexed": 42
  }
  ```

### 2. Search & Chat
* **Endpoint**: `/chat`
* **Method**: `POST`
* **Query Parameters**: `question` (string, the query)
* **Description**: Queries the Chroma vector index using the query embedding. Constructs a grounded context from top matches, invokes Llama 3.3 via Groq, and returns the grounded answer along with exact source metadata.
* **Example Response**:
  ```json
  {
    "answer": "Retrieval-Augmented Generation (RAG) is a technique that uses external data...",
    "sources": [
      {
        "source": "rag.pdf",
        "pages": "1",
        "distance": 0.4321
      }
    ]
  }
  ```

---

## 🧪 CLI Testing Interface

If you want to test the RAG ingestion and retrieval logic directly in the terminal:
1. Make sure you have activated your virtual environment.
2. To test the **ingestion** script alone (processes `docs/rag.pdf`):
   ```bash
   python backend/document_ingestion.py
   ```
3. To test the **interactive retrieval** chat interface in the terminal:
   ```bash
   python backend/retrieval.py
   ```
   *This allows you to type queries in the console and watch the streaming answers along with cosine distances of retrieved chunks.*

---

## 🧠 Behind the Scenes: Ingestion Pipeline

1. **Document Loading**: PyPDF reads document metadata and pages.
2. **Scan/Image Recognition Check**: If the document contains less than 150 characters of machine-readable text, it is assumed to be scanned.
3. **Cloud OCR Fallback**: The pipeline renders each page into an image and calls the Groq-powered Llama 3.2 Vision model to extract structured data and text cleanly.
4. **Chunk & Deduplicate**: Chunks are split at `1000` character bounds with `200` overlap. We hash (`sha256`) the source name, chunk index, and content to create unique doc IDs.
5. **Vector Search & Grounding**: When a user queries the model, similarity scores are matched against Chroma DB. If the closest match distance exceeds standard thresholds, or the model doesn't find answers in the context, it strictly responds with `Information not found in notes.`.
