from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
import faiss
import numpy as np
import json
import os
from sentence_transformers import SentenceTransformer

print("Loading all necessary data...")
with open('data/bible_verses.json', 'r') as f:
    bible_data = json.load(f)

index = faiss.read_index("data/bible_verse_index.faiss")

model = SentenceTransformer('paraphrase-MiniLM-L3-v2')
print("Data loaded successfully.")

app = FastAPI()

frontend_domain = os.getenv("FRONTEND_DOMAIN", "https://scripture-search.eglenn.app")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_domain],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/similar/")
def find_similar_verses(query_verse: str, k: int = 5):
    """
    Finds the k most similar verses to a query verse.
    - query_verse: The text of the verse you want to find similarities for.
    - k: The number of similar verses to return.
    """
    query_vector = model.encode([query_verse])

    distances, indices = index.search(query_vector, k + 1)

    results = []
    for i in range(1, k + 1):
        verse_index = indices[0][i]
        result_verse = bible_data[verse_index]
        results.append({
            "reference": result_verse['reference'],
            "text": result_verse['text'],
            "distance": float(distances[0][i])
        })
        
    return {"query": query_verse, "similar_verses": results}

@app.get("/")
def read_root():
    return RedirectResponse(url=f"http://{frontend_domain}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 10000)))