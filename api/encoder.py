"""Lightweight, model-aware ONNX text encoder (no torch, no transformers).

Each supported model is described by a :class:`ModelSpec`: its Hugging Face repo,
which ONNX export to run for queries and for passages, the pooling strategy
(masked mean vs. CLS), the query/passage instruction prefixes the model was
trained with, and the truncation length. We run the export with onnxruntime +
the repo's ``tokenizer.json`` (via the ``tokenizers`` library), then pool and
L2-normalize ourselves.

* ``encode_query`` is for search strings (API, at request time).
* ``encode_passages`` is for corpus text (ingest / re-embed, offline).

Keep those two apart: models like e5 expect different prefixes on each side.

Which model is *active* (and which Atlas field/index its vectors live in) is
decided by ``embeddings.py``; this module only knows how to run a model.

Downloaded files are treated as data: only the ONNX graph and tokenizer.json are
loaded, via onnxruntime / tokenizers. No repo code is ever executed.
"""

import os
import threading
from dataclasses import dataclass
from functools import cache
from typing import Literal

import numpy as np

EMBED_DIM = 384


@dataclass(frozen=True)
class ModelSpec:
    repo: str
    # ONNX file used to encode queries (what the API loads — keep it small).
    query_onnx: str
    # ONNX file used to encode passages (ingest / re-embed — runs offline, so it
    # can be the full-precision export).
    passage_onnx: str
    pooling: Literal["mean", "cls"]
    query_prefix: str = ""
    passage_prefix: str = ""
    max_length: int = 512
    dim: int = EMBED_DIM


MODELS: dict[str, ModelSpec] = {
    # The original model. Mean pooling, no prefixes. Truncation stays at 512 to
    # match how the ONNX-era corpus was embedded (the earliest corpora were
    # embedded with sentence-transformers' 128-token limit; see docs).
    "paraphrase-MiniLM-L3-v2": ModelSpec(
        repo="sentence-transformers/paraphrase-MiniLM-L3-v2",
        query_onnx="onnx/model.onnx",
        passage_onnx="onnx/model.onnx",
        pooling="mean",
    ),
    # Upgrade candidate (see docs/embedding-migration.md). Mean pooling with
    # "query: " / "passage: " prefixes. The API runs the repo's int8 export
    # (~34 MB) for queries; passages are embedded with the fp32 export.
    "e5-small-v2": ModelSpec(
        repo="intfloat/e5-small-v2",
        query_onnx="onnx/model_qint8_avx512_vnni.onnx",
        passage_onnx="model.onnx",
        pooling="mean",
        query_prefix="query: ",
        passage_prefix="passage: ",
    ),
    # Runner-up in the eval: CLS pooling, query-only instruction prefix.
    "snowflake-arctic-embed-xs": ModelSpec(
        repo="Snowflake/snowflake-arctic-embed-xs",
        query_onnx="onnx/model_quantized.onnx",
        passage_onnx="onnx/model.onnx",
        pooling="cls",
        query_prefix="Represent this sentence for searching relevant passages: ",
    ),
}


class Encoder:
    """One ONNX session + tokenizer for one model and one ONNX file."""

    def __init__(self, spec: ModelSpec, onnx_file: str):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        self.spec = spec
        tokenizer = Tokenizer.from_file(hf_hub_download(spec.repo, "tokenizer.json"))
        tokenizer.enable_truncation(max_length=spec.max_length)
        pad_id = tokenizer.token_to_id("[PAD]")
        tokenizer.enable_padding(
            pad_id=0 if pad_id is None else pad_id, pad_token="[PAD]"
        )
        self.tokenizer = tokenizer
        self.session = ort.InferenceSession(
            hf_hub_download(spec.repo, onnx_file), providers=["CPUExecutionProvider"]
        )
        self.input_names = {i.name for i in self.session.get_inputs()}
        # Serialize inference: on a small host, concurrent requests would each
        # allocate their own activation buffers (≈+25 MB per 512-token query),
        # and with ~1 vCPU there is no throughput to gain from running in parallel.
        self._lock = threading.Lock()

    def _embed(self, texts: list[str]) -> np.ndarray:
        encs = self.tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encs], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feed["token_type_ids"] = np.array([e.type_ids for e in encs], dtype=np.int64)
        feed = {k: v for k, v in feed.items() if k in self.input_names}
        with self._lock:
            hidden = self.session.run(None, feed)[0]  # [B, T, H]
        if self.spec.pooling == "cls":
            pooled = hidden[:, 0]
        else:
            m = mask[..., None].astype(np.float32)
            pooled = (hidden * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-9, None)
        return (pooled / np.linalg.norm(pooled, axis=1, keepdims=True)).astype(np.float32)

    def encode(self, texts: list[str], prefix: str = "", batch_size: int = 64) -> np.ndarray:
        """Encode texts to an (N, dim) array of L2-normalized float32 vectors."""
        texts = [prefix + t for t in texts]
        # Batch similar lengths together to minimize padding.
        order = np.argsort([len(t) for t in texts], kind="stable")
        out = np.empty((len(texts), self.spec.dim), dtype=np.float32)
        for start in range(0, len(texts), batch_size):
            idx = order[start : start + batch_size]
            out[idx] = self._embed([texts[i] for i in idx])
        return out


def _spec(model: str) -> ModelSpec:
    try:
        return MODELS[model]
    except KeyError:
        raise ValueError(f"Unknown embedding model {model!r}; known: {sorted(MODELS)}") from None


# `functools.cache` doesn't stop two threads from computing the same value at
# once, and FastAPI runs sync endpoints on a thread pool: after a cold start, a
# burst of first requests would each build their own ONNX session (measured
# ~+200 MB, pushing a 512 MB host to its limit). Build each encoder under a lock.
_load_lock = threading.Lock()


@cache
def _build_query_encoder(model: str) -> Encoder:
    spec = _spec(model)
    # EMBED_ONNX_FILE swaps the query-side export (e.g. a different int8 build)
    # without touching the corpus vectors.
    return Encoder(spec, os.getenv("EMBED_ONNX_FILE") or spec.query_onnx)


@cache
def _build_passage_encoder(model: str) -> Encoder:
    spec = _spec(model)
    return Encoder(spec, spec.passage_onnx)


def _query_encoder(model: str) -> Encoder:
    with _load_lock:
        return _build_query_encoder(model)


def _passage_encoder(model: str) -> Encoder:
    with _load_lock:
        return _build_passage_encoder(model)


def encode_query(model: str, text: str) -> np.ndarray:
    """Encode one search string (with the model's query prefix)."""
    spec = _spec(model)
    return _query_encoder(model).encode([text], prefix=spec.query_prefix)[0]


def encode_passages(model: str, texts: list[str], batch_size: int = 64) -> np.ndarray:
    """Encode corpus passages (with the model's passage prefix) → (N, dim)."""
    spec = _spec(model)
    return _passage_encoder(model).encode(texts, prefix=spec.passage_prefix, batch_size=batch_size)


def prefetch(model: str, passages: bool = False) -> None:
    """Download (cache) the files a model needs, without loading them."""
    from huggingface_hub import hf_hub_download

    spec = _spec(model)
    hf_hub_download(spec.repo, "tokenizer.json")
    hf_hub_download(spec.repo, spec.query_onnx)
    if passages:
        hf_hub_download(spec.repo, spec.passage_onnx)
