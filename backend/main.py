import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import shutil
import traceback
import re
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from langchain_groq import ChatGroq
from document_ingestion import (
    partition_document,
    chunk_document,
    process_chunks,
    create_vectorstore,
)
from hybrid_retrieval import hybrid_retrieve
from agent import StudyAgent
from langchain_chroma import Chroma
from langchain_community.embeddings.fastembed import FastEmbedEmbeddings
from dotenv import load_dotenv
base_dir = os.path.dirname(os.path.abspath(__file__))
env_file = os.path.join(base_dir, ".env")
if os.path.exists(env_file):
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

app = FastAPI()

upload_folder = os.path.join(base_dir, "uploads")
persist_dir = os.path.join(base_dir, "chroma_db")
frontend_dist_path = os.path.abspath(os.path.join(base_dir, "../frontend/dist"))

os.makedirs(upload_folder, exist_ok=True)

def get_session_paths(session_id, create=True):
    if not session_id or not re.match(r"^[a-zA-Z0-9_\-]+$", session_id):
        return upload_folder, persist_dir
    
    session_upload = os.path.join(upload_folder, session_id)
    session_persist = os.path.join(persist_dir, session_id)
    if create:
        os.makedirs(session_upload, exist_ok=True)
        os.makedirs(session_persist, exist_ok=True)
    return session_upload, session_persist

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"https?://.*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    headers = {"Access-Control-Allow-Origin": "*"}
    if exc.headers:
        headers.update(exc.headers)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=headers,
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
        headers={"Access-Control-Allow-Origin": "*"},
    )

def get_llm():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY environment variable is not set. Please configure it in your settings."
        )
    api_key = api_key.strip("'\" \t\r\n")
    primary_llm = ChatGroq(
        model="groq/compound-mini",
        api_key=api_key,
        temperature=0.0,
    )
    fallback_llm1 = ChatGroq(
        model="groq/compound",
        api_key=api_key,
        temperature=0.0,
    )
    fallback_llm2 = ChatGroq(
        model="qwen/qwen3.6-27b",
        api_key=api_key,
        temperature=0.0,
    )
    fallback_llm3 = ChatGroq(
        model="openai/gpt-oss-20b",
        api_key=api_key,
        temperature=0.0,
    )
    return primary_llm.with_fallbacks([fallback_llm1, fallback_llm2, fallback_llm3])

_embeddings_instance = None

def get_embeddings():
    global _embeddings_instance
    if _embeddings_instance is None:
        print("Using FastEmbed (ONNX Runtime - BAAI/bge-small-en-v1.5)...")
        _embeddings_instance = FastEmbedEmbeddings(
            model_name="BAAI/bge-small-en-v1.5",
            max_length=512
        )
    return _embeddings_instance

class ChatRequest(BaseModel):
    question: str | None = None

@app.get("/")
def home():
    index_file = os.path.join(frontend_dist_path, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "RAG Backend Running"}

@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    session_id: str = Query(None)
):
    try:
        print("Upload started (session: " + str(session_id) + ")")
        filename = file.filename
        lower_name = filename.lower()
        if not lower_name.endswith(".pdf"):
            raise HTTPException(status_code=400, detail="Only PDF files are supported")

        safe_filename = os.path.basename(filename)
        session_upload_folder, session_persist_dir = get_session_paths(session_id)

        if os.path.exists(session_persist_dir):
            try:
                import chromadb
                client = chromadb.PersistentClient(path=session_persist_dir)
                collections = client.list_collections()
                for i in range(len(collections)):
                    col = collections[i]
                    client.delete_collection(col.name)
            except Exception as e:
                print(e)

        print("Saving file")
        file_path = os.path.join(session_upload_folder, safe_filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        print("Partitioning PDF")
        elements = partition_document(file_path)

        print("Chunking elements")
        chunks = chunk_document(elements)

        print("Processing chunks")
        processed_documents = process_chunks(chunks, source_name=safe_filename)

        if len(processed_documents) == 0:
            raise HTTPException(
                status_code=422,
                detail="No usable content could be extracted from this PDF",
            )

        print("Creating vectorstore")
        create_vectorstore(processed_documents, persist_directory=session_persist_dir)

        print("Done")
        res = {
            "message": "PDF processed successfully",
            "chunks_indexed": len(processed_documents)
        }
        return res

    except HTTPException:
        raise
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to process PDF")

@app.post("/chat")
async def chat(
    request: ChatRequest = None,
    question: str = Query(None),
    session_id: str = Query(None)
):
    try:
        q_val = None
        if request and request.question:
            q_val = request.question
        elif question:
            q_val = question

        if not q_val or not q_val.strip():
            raise HTTPException(
                status_code=400,
                detail="Question cannot be empty",
            )
        question = q_val.strip()

        session_upload_folder, session_persist_dir = get_session_paths(session_id, create=False)

        if not os.path.exists(session_persist_dir) or not os.listdir(session_persist_dir):
            raise HTTPException(
                status_code=400,
                detail="No document has been ingested yet. Upload a PDF first.",
            )

        vectorstore = Chroma(
            persist_directory=session_persist_dir,
            embedding_function=get_embeddings(),
        )

        agent = StudyAgent(vectorstore=vectorstore, llm=get_llm())
        result = agent.invoke(question)

        res = {
            "answer": result.get("answer", "No response generated."),
            "sources": result.get("sources", []),
            "steps": result.get("steps", [])
        }
        return res
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Chat processing error: {str(e)}"
        )

if os.path.exists(frontend_dist_path):
    assets_path = os.path.join(frontend_dist_path, "assets")
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{catchall:path}")
    async def serve_frontend(catchall: str):
        if catchall.startswith("upload") or catchall.startswith("chat"):
            raise HTTPException(status_code=404, detail="Not Found")

        file_path = os.path.join(frontend_dist_path, catchall)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)

        index_file = os.path.join(frontend_dist_path, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        raise HTTPException(status_code=404, detail="Frontend build index.html not found")