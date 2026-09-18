import os
import hashlib
import time
import base64
import io
import concurrent.futures
from PIL import Image
import pytesseract
from dotenv import load_dotenv
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_core.documents import Document
import pymupdf

base_dir = os.path.dirname(os.path.abspath(__file__))
env_file = os.path.join(base_dir, ".env")
if os.path.exists(env_file):
    load_dotenv(dotenv_path=env_file)
else:
    load_dotenv()

chunk_size_val = 1000
chunk_overlap_val = 200

def _ocr_single_page(file_path, page_num, total_pages):
    num = page_num + 1
    try:
        with pymupdf.open(file_path) as doc:
            page = doc[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            del pix
            img = Image.open(io.BytesIO(img_bytes))

        text = pytesseract.image_to_string(img).strip()
        del img
        if text:
            return Document(
                page_content=text,
                metadata={
                    "source": os.path.basename(file_path),
                    "page": page_num
                }
            )
    except Exception as e:
        print(f"OCR warning on page {num}: {e}")
    return None

def partition_document(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError("PDF not found at: " + file_path)

    print("Loading file with PyMuPDF: " + file_path)
    start = time.time()
    elements = []
    scanned_pages = []
    total_pages = 0

    try:
        with pymupdf.open(file_path) as doc:
            total_pages = len(doc)
            for page_num in range(total_pages):
                page = doc[page_num]
                text = page.get_text("text").strip()
                # If page has substantial digital text (>= 100 characters), use digital extraction directly
                if len(text) >= 100:
                    elements.append(
                        Document(
                            page_content=text,
                            metadata={
                                "source": os.path.basename(file_path),
                                "page": page_num
                            }
                        )
                    )
                else:
                    # Page has minimal or no selectable text (scanned image, photo, or empty/watermark-only)
                    scanned_pages.append((page_num, text))
    except Exception as e:
        raise RuntimeError("Failed to read PDF with PyMuPDF: " + str(e))

    print(f"PyMuPDF initial pass: {len(elements)} digital text pages, {len(scanned_pages)} scanned/image pages.")

    # Run parallel OCR on all scanned/image-heavy pages
    if scanned_pages:
        print(f"Running OCR on {len(scanned_pages)} scanned pages...")
        max_workers = min(4, len(scanned_pages))
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(_ocr_single_page, file_path, p, total_pages): (p, fallback_text)
                for p, fallback_text in scanned_pages
            }
            for future in concurrent.futures.as_completed(futures):
                p, fallback_text = futures[future]
                res = future.result()
                if res and len(res.page_content.strip()) > 10:
                    elements.append(res)
                elif fallback_text:
                    elements.append(
                        Document(
                            page_content=fallback_text,
                            metadata={
                                "source": os.path.basename(file_path),
                                "page": p
                            }
                        )
                    )

    # Sort all pages back into their original sequential order
    elements.sort(key=lambda d: d.metadata.get("page", 0))

    elapsed = time.time() - start
    print(f"Ingestion completed in {round(elapsed, 1)}s. Total pages loaded: {len(elements)}")
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