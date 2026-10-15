import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from langchain_qdrant import QdrantVectorStore
from main import get_embeddings
from hybrid_retrieval import hybrid_retrieve

k_val = 5

def load_db(collection_name="rag_default"):
    embeds = get_embeddings()

    db = QdrantVectorStore.from_existing_collection(
        embedding=embeds,
        collection_name=collection_name,
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY"),
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