"""Embedding versions: which model's vectors live in which Atlas field + index.

Changing the embedding model means re-embedding the whole corpus, and vectors
from different models can't be mixed. So each model gets its own *version*: its
own document field and its own vector index. Both versions can coexist in the
collection, which makes the switch a config flip:

* ``EMBEDDING_VERSION`` (default ``v1``) — the version the API searches with:
  its model encodes queries, its field/index are queried.
* ``EMBEDDING_WRITE_VERSIONS`` (default: just the active version) —
  comma-separated versions that ingestion writes for every new/updated document.
  Set it to ``v1,v2`` for as long as both are in use, so neither falls behind.

See docs/embedding-migration.md for the cutover and rollback runbook.

Run ``python -m embeddings --prefetch v1,v2`` to cache the query-side model
files (the Dockerfile does this at build time).
"""

import argparse
import os
from dataclasses import dataclass
from typing import Literal

import numpy as np
from bson.binary import Binary, BinaryVectorDtype
from dotenv import load_dotenv

import encoder

# The config below is read at import time; make sure api/.env has been applied
# no matter which module imports this first.
load_dotenv()


@dataclass(frozen=True)
class EmbeddingVersion:
    name: str
    model: str  # key into encoder.MODELS
    field: str  # document field holding the vector
    index: str  # Atlas Vector Search index over `field`
    # How the vector is stored. float32 vectors get Atlas scalar quantization in
    # the index; int8 vectors are quantized by us (per-vector scale, which cosine
    # ignores) — ~400 B/doc instead of ~1.55 KB.
    dtype: Literal["float32", "int8"]
    # Default recency lift (see db._recency_factor). The lift multiplies the
    # score, so it has to be scaled to how spread out a model's scores are: e5's
    # top-50 cosine scores span ~1/3 of MiniLM-L3's, so its default is ~1/3.
    recency_weight: float

    @property
    def dim(self) -> int:
        return encoder.MODELS[self.model].dim


VERSIONS: dict[str, EmbeddingVersion] = {
    "v1": EmbeddingVersion(
        name="v1",
        model="paraphrase-MiniLM-L3-v2",
        field="embedding",
        index=os.getenv("VECTOR_INDEX_NAME", "vector_index"),
        dtype="float32",
        recency_weight=0.06,
    ),
    "v2": EmbeddingVersion(
        name="v2",
        model="e5-small-v2",
        field="embedding_v2",
        index=os.getenv("VECTOR_INDEX_NAME_V2", "vector_index_v2"),
        dtype="int8",
        recency_weight=0.02,
    ),
}


def get_version(name: str) -> EmbeddingVersion:
    try:
        return VERSIONS[name.strip()]
    except KeyError:
        raise ValueError(
            f"Unknown embedding version {name!r}; known: {sorted(VERSIONS)}"
        ) from None


ACTIVE = get_version(os.getenv("EMBEDDING_VERSION", "v1"))
WRITE_VERSIONS = [
    get_version(v)
    for v in (os.getenv("EMBEDDING_WRITE_VERSIONS") or ACTIVE.name).split(",")
    if v.strip()
]


def to_bson(vector: np.ndarray, dtype: str) -> Binary:
    """Pack one normalized vector as a BSON binData vector of ``dtype``."""
    vector = np.asarray(vector, dtype=np.float32)
    if dtype == "float32":
        return Binary.from_vector([float(x) for x in vector], BinaryVectorDtype.FLOAT32)
    if dtype == "int8":
        # Symmetric per-vector scale onto [-127, 127]. Cosine similarity is
        # scale-invariant, so no scale needs storing.
        peak = float(np.abs(vector).max()) or 1.0
        q = np.round(vector * (127.0 / peak)).astype(np.int8)
        return Binary.from_vector([int(x) for x in q], BinaryVectorDtype.INT8)
    raise ValueError(f"Unsupported vector dtype {dtype!r}")


def encode_query(text: str, version: EmbeddingVersion = ACTIVE) -> list[float] | Binary:
    """Encode a search string into a ``$vectorSearch`` queryVector for ``version``.

    float32 versions get a plain list (as before); int8 versions get an int8
    binData vector, matching the indexed type.
    """
    vector = encoder.encode_query(version.model, text)
    if version.dtype == "float32":
        return vector.tolist()
    return to_bson(vector, version.dtype)


def encode_passages(texts: list[str], version: EmbeddingVersion) -> list[Binary]:
    """Encode corpus texts into stored binData vectors for ``version``."""
    vectors = encoder.encode_passages(version.model, texts)
    return [to_bson(v, version.dtype) for v in vectors]


def stored_query_vector(doc: dict, version: EmbeddingVersion = ACTIVE) -> list[float] | Binary | None:
    """A document's stored vector, ready to reuse as a ``queryVector``."""
    stored = doc.get(version.field)
    if stored is None:
        return None
    if isinstance(stored, Binary) and version.dtype == "float32":
        return [float(x) for x in stored.as_vector().data]
    return stored  # int8 binData is passed through as-is


def stored_to_array(stored) -> np.ndarray:
    """Decode a stored vector (float32/int8 binData or array) to a unit float32 array."""
    data = stored.as_vector().data if isinstance(stored, Binary) else stored
    arr = np.asarray(data, dtype=np.float32)
    return arr / (np.linalg.norm(arr) or 1.0)


def index_definition(version: EmbeddingVersion) -> dict:
    """The Atlas Vector Search index definition for ``version``."""
    vector_field: dict = {
        "type": "vector",
        "path": version.field,
        "numDimensions": version.dim,
        "similarity": "cosine",
    }
    if version.dtype == "float32":
        # Pre-quantized int8 vectors must NOT set this: Atlas silently skips
        # non-float vectors under automatic quantization.
        vector_field["quantization"] = "scalar"
    return {"fields": [vector_field, {"type": "filter", "path": "source"}]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Embedding model utilities")
    parser.add_argument(
        "--prefetch",
        metavar="VERSIONS",
        help="Comma-separated versions whose query-side model files to cache.",
    )
    parser.add_argument(
        "--passages",
        action="store_true",
        help="With --prefetch, also cache the passage-side (ingest) ONNX files.",
    )
    args = parser.parse_args()
    if args.prefetch:
        for name in args.prefetch.split(","):
            version = get_version(name)
            encoder.prefetch(version.model, passages=args.passages)
            print(f"cached {version.name}: {version.model}")
    else:
        for v in VERSIONS.values():
            mark = "*" if v is ACTIVE else " "
            print(f"{mark} {v.name}: model={v.model} field={v.field} index={v.index} dtype={v.dtype}")
        print("writes:", ",".join(v.name for v in WRITE_VERSIONS))


if __name__ == "__main__":
    main()
