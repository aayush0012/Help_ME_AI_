import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from hybrid_retrieval import hybrid_retrieve

k_val = 5

def load_db():
    embeds = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    
    current_dir = os.path.dirname(os.path.abspath(__file__))
    db_dir = os.path.join(current_dir, "chroma_db")

    db = Chroma(
        persist_directory=db_dir,
        embedding_function=embeds,
    )
    return db

def retrieve_chunks(db, query, k=k_val):
    return hybrid_retrieve(db, query, k=k)
## we can store all the formatted chunks inside a document after rrf 
def build_context(results):
    parts = []
    for i in range(len(results)):
        item = results[i]
        doc = item[0]
        score = item[1]
        
        source = doc.metadata.get("source")
        if not source:
            source = "unknown"
            
        num = i + 1
        part = "[Source " + str(num) + " - " + str(source) + " | score=" + str(round(score, 4)) + "]\n" + doc.page_content
        parts.append(part)
        
    context = "\n\n".join(parts)
    return context