import os
import hashlib
import time
import base64
import concurrent.futures
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_core.documents import Document
import pymupdf
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

base_dir = os.path.dirname(os.path.abspath(__file__))
env_file = os.path.join(base_dir, ".env")
if os.path.exists(env_file):
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

chunk_size_val = 1000
chunk_overlap_val = 200

def _process_single_page_ocr(vision_llm, file_path, page_num, total_pages):
    num = page_num + 1
    print(f"Running OCR transcription on page {num}/{total_pages}...")
    try:
        # Open separate doc handle per thread for thread safety
        with pymupdf.open(file_path) as doc:
            page = doc[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")

        base64_image = base64.b64encode(img_bytes).decode("utf-8")

        message = HumanMessage(
            content=[
                {
                    "type": "text", 
                    "text": (
                        "Transcribe all academic text, headings, mathematical formulas (format in LaTeX $...$ or $$...$$), "
                        "and tables from this page image. Output only the clean transcribed text without conversational commentary."
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64," + base64_image
                    }
                }
            ]
        )

        response = vision_llm.invoke([message])
        transcribed_text = response.content.strip()

        if transcribed_text:
            return Document(
                page_content=transcribed_text,
                metadata={
                    "source": os.path.basename(file_path),
                    "page": page_num
                }
            )
    except Exception as e:
        print(f"OCR error on page {num}: {e}")
    return None

def run_cloud_ocr(file_path):
    print("Opening PDF with PyMuPDF for parallel cloud transcription...")
    try:
        with pymupdf.open(file_path) as doc:
            total_pages = len(doc)
    except Exception as e:
        print(f"Failed to open PDF for OCR: {e}")
        return []

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print("Warning: GROQ_API_KEY is not set.")
        return []

    try:
        vision_llm = ChatGroq(
            model="llama-3.2-11b-vision-preview",
            api_key=api_key,
            temperature=0
        )
    except Exception as e:
        print(f"Failed to initialize vision LLM: {e}")
        return []

    ocr_elements = []
    # Parallelize up to 4 concurrent page OCR calls
    max_workers = min(4, total_pages) if total_pages > 0 else 1
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_process_single_page_ocr, vision_llm, file_path, p, total_pages): p
            for p in range(total_pages)
        }
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                ocr_elements.append(res)

    # Sort results by original page order
    ocr_elements.sort(key=lambda d: d.metadata.get("page", 0))
    return ocr_elements

def partition_document(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError("PDF not found at: " + file_path)

    print("Loading file with PyMuPDF: " + file_path)
    start = time.time()
    try:
        elements = []
        total_chars = 0
        with pymupdf.open(file_path) as doc:
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text("text")
                cleaned = text.strip()
                total_chars += len(cleaned)
                elements.append(
                    Document(
                        page_content=text,
                        metadata={
                            "source": os.path.basename(file_path),
                            "page": page_num
                        }
                    )
                )
    except Exception as e:
        raise RuntimeError("Failed to load PDF with PyMuPDF: " + str(e))

    print(f"PyMuPDF load complete ({round(time.time() - start, 2)}s). Total characters: {total_chars}")

    if total_chars < 150:
        print("Standard PDF loader extracted minimal text. Falling back to Cloud Vision OCR...")
        ocr_elements = run_cloud_ocr(file_path)
        if len(ocr_elements) > 0:
            elements = ocr_elements
            print("Cloud OCR complete. Pages transcribed: " + str(len(elements)))
        else:
            print("Cloud OCR returned no pages. Using standard loader output.")

    elapsed = time.time() - start
    print("Ingestion load completed in " + str(round(elapsed, 1)) + "s")
    return elements

def chunk_document(elements):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size_val,
        chunk_overlap=chunk_overlap_val
    )
    chunks = text_splitter.split_documents(elements)
    return chunks

def process_chunks(chunks, source_name):
    documents = []
    print("Total chunks: " + str(len(chunks)))

    for i in range(len(chunks)):
        chunk = chunks[i]
        page = chunk.metadata.get("page", 0) + 1
        
        txt = chunk.page_content
        cleaned = txt.strip()
        if len(cleaned) < 10:
            print("Skipping empty chunk " + str(i))
            continue

        doc = Document(
            page_content=chunk.page_content,
            metadata={
                "source": source_name,
                "pages": str(page),
                "chunk_index": i,
            },
        )
        documents.append(doc)

    print("Processed docs: " + str(len(documents)))
    return documents

def make_doc_id(doc):
    source = doc.metadata.get("source")
    idx = doc.metadata.get("chunk_index")
    txt = doc.page_content
    key = str(source) + "::chunk_" + str(idx) + "::" + txt
    hashed = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return hashed

def create_vectorstore(documents, persist_directory=None):
    from main import get_embeddings
    embeddings = get_embeddings()

    if persist_directory is None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        persist_directory = os.path.join(base_dir, "chroma_db")

    vectorstore = Chroma(
        persist_directory=persist_directory,
        embedding_function=embeddings,
    )

    ids = []
    for i in range(len(documents)):
        doc = documents[i]
        doc_id = make_doc_id(doc)
        ids.append(doc_id)

    total = len(documents)
    batch_size = 100
    print("Inserting " + str(total) + " documents in batches of " + str(batch_size) + "...")

    for i in range(0, total, batch_size):
        start = i
        end = i + batch_size
        if end > total:
            end = total
            
        batch_docs = []
        batch_ids = []
        for j in range(start, end):
            batch_docs.append(documents[j])
            batch_ids.append(ids[j])

        vectorstore.add_documents(documents=batch_docs, ids=batch_ids)
        print("  Inserted " + str(end) + "/" + str(total))

    return vectorstore

if __name__ == "__main__":
    file_path = os.path.join("docs", "rag.pdf")
    source_name = os.path.basename(file_path)

    try:
        print("Loading PDF...")
        elements = partition_document(file_path)

        print("Creating chunks...")
        chunks = chunk_document(elements)

        print("Processing chunks...")
        processed_documents = process_chunks(chunks, source_name)

        if len(processed_documents) == 0:
            print("No documents produced from this PDF.")
        else:
            print("Generating embeddings and storing vectors...")
            vectorstore = create_vectorstore(processed_documents)
            print("Ingestion completed")

    except FileNotFoundError as e:
        print(e)
    except RuntimeError as e:
        print(e)
    except Exception as e:
        print(e)