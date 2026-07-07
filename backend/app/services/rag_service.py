import json
from typing import Optional
from uuid import UUID

try:
    import chromadb
    CHROMADB_AVAILABLE = True
except ImportError:
    chromadb = None
    CHROMADB_AVAILABLE = False

from app.core.config import settings
from app.services.llm_service import LLMService


class RAGService:
    """Servicio de Retrieval-Augmented Generation con ChromaDB."""

    def __init__(self):
        self.llm = LLMService()
        self._chroma_client = None
        self._collection = None

    def _get_collection(self):
        if not CHROMADB_AVAILABLE:
            return None
        if self._collection is None:
            try:
                self._chroma_client = chromadb.HttpClient(
                    host=settings.CHROMA_HOST,
                    port=settings.CHROMA_PORT,
                )
                self._collection = self._chroma_client.get_or_create_collection(
                    name=settings.CHROMA_COLLECTION,
                    metadata={"hnsw:space": "cosine"},
                )
            except Exception:
                self._chroma_client = chromadb.EphemeralClient()
                self._collection = self._chroma_client.get_or_create_collection(
                    name=settings.CHROMA_COLLECTION,
                    metadata={"hnsw:space": "cosine"},
                )
        return self._collection

    async def _get_embedding(self, text: str) -> list[float]:
        return await self.llm.embed(text)

    async def index_chunks(
        self,
        project_id: UUID,
        document_id: UUID,
        chunks: list[dict],
    ) -> list[str]:
        collection = self._get_collection()
        if not collection or not self.llm.is_configured:
            return [f"{project_id}_{document_id}_{c['index']}" for c in chunks]

        ids = []
        embeddings = []
        documents = []
        metadatas = []

        for chunk in chunks:
            chunk_id = f"{project_id}_{document_id}_{chunk['index']}"
            embedding = await self._get_embedding(chunk["content"])
            ids.append(chunk_id)
            embeddings.append(embedding)
            documents.append(chunk["content"])
            metadatas.append({
                "project_id": str(project_id),
                "document_id": str(document_id),
                "chunk_index": chunk["index"],
            })

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
        )
        return ids

    async def search(
        self,
        query: str,
        project_id: UUID,
        top_k: int = 10,
    ) -> list[dict]:
        collection = self._get_collection()
        if not collection or not self.llm.is_configured:
            return []

        query_embedding = await self._get_embedding(query)

        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where={"project_id": str(project_id)},
        )

        chunks = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                chunks.append({
                    "content": doc,
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if results["distances"] else 0,
                })
        return chunks

    async def get_project_context(self, project_id: UUID, query: str, top_k: int = 15) -> str:
        chunks = await self.search(query, project_id, top_k)
        if not chunks:
            return ""
        context_parts = []
        for i, chunk in enumerate(chunks):
            context_parts.append(f"[Fragmento {i+1}]\n{chunk['content']}")
        return "\n\n---\n\n".join(context_parts)

    def delete_project_documents(self, project_id: UUID):
        try:
            collection = self._get_collection()
            collection.delete(where={"project_id": str(project_id)})
        except Exception:
            pass
