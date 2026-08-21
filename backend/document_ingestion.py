import os
import hashlib
import time
from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
import fitz
import base64
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage

load_dotenv()

chunk_size_val = 1000
chunk_overlap_val = 200

def run_cloud_ocr(file_path):
    print("Opening PDF with PyMuPDF for cloud transcription...")
    try:
        doc = fitz.open(file_path)
    except Exception as e:
        print(e)
        return []

    ocr_elements = []
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
        print(e)
        return []

    for page_num in range(len(doc)):
        num = page_num + 1
        total = len(doc)
        print("Running OCR transcription on page " + str(num) + "/" + str(total) + "...")
        try:
            page = doc[page_num]
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")

            base64_image = base64.b64encode(img_bytes).decode("utf-8")

            message = HumanMessage(
                content=[
                    {
                        "type": "text", 
                        "text": "Transcribe all text, numbers, and structured table data from this page image exactly as they appear. Do not summarize, format, or add any commentary. Output only the transcribed text."
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
                doc_element = Document(
                    page_content=transcribed_text,
                    metadata={
                        "source": os.path.basename(file_path),
                        "page": page_num
                    }
                )
                ocr_elements.append(doc_element)
        except Exception as e:
            print(e)

    return ocr_elements

def partition_document(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError("PDF not found at: " + file_path)

    print("Loading file: " + file_path)
    start = time.time()
    try:
        loader = PyPDFLoader(file_path)
        elements = loader.load()
    except Exception as e:
        raise RuntimeError("Failed to load PDF: " + str(e))

    total_chars = 0
    for i in range(len(elements)):
        doc = elements[i]
        txt = doc.page_content
        cleaned = txt.strip()
        total_chars = total_chars + len(cleaned)
    
    print("Standard load complete. Total characters: " + str(total_chars))

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