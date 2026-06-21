"""Lightweight ONNX text encoder for ``paraphrase-MiniLM-L3-v2``.

Replaces the torch / sentence-transformers stack. We only ever embed short
strings (queries at runtime, passages at ingest time), so we run the model's
ONNX export with onnxruntime + the HF tokenizer and do mean pooling + L2
normalization ourselves.

This produces embeddings identical to the torch model (cosine ≈ 1.0), so
vectors already stored in Atlas stay compatible — while dropping ~470 MB of
dependencies (torch, scipy, scikit-learn, sympy), which lets the API run on a
512 MB host.
"""

import os
from functools import lru_cache

import numpy as np

MODEL_REPO = os.getenv("EMBED_MODEL_REPO", "sentence-transformers/paraphrase-MiniLM-L3-v2")
ONNX_FILE = os.getenv("EMBED_ONNX_FILE", "onnx/model.onnx")
EMBED_DIM = 384


@lru_cache(maxsize=1)
def _load():
    """Lazily download + load the tokenizer and ONNX session (cached)."""
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    from transformers import AutoTokenizer

    onnx_path = hf_hub_download(MODEL_REPO, ONNX_FILE)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO)
    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    input_names = {i.name for i in session.get_inputs()}
    return tokenizer, session, input_names


def encode_batch(texts: list[str], batch_size: int = 64) -> np.ndarray:
    """Encode texts to an (N, 384) array of normalized float32 embeddings."""
    tokenizer, session, input_names = _load()
    out: list[np.ndarray] = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        enc = tokenizer(chunk, padding=True, truncation=True, return_tensors="np")
        feed = {k: v for k, v in enc.items() if k in input_names}
        last_hidden = session.run(None, feed)[0]  # [B, T, H]
        mask = enc["attention_mask"][..., None].astype(np.float32)
        summed = (last_hidden * mask).sum(axis=1)
        counts = np.clip(mask.sum(axis=1), 1e-9, None)
        mean = summed / counts  # masked mean pooling
        normed = mean / np.linalg.norm(mean, axis=1, keepdims=True)
        out.append(normed.astype(np.float32))
    return np.vstack(out)


def encode(text: str) -> list[float]:
    """Encode a single string to a normalized 384-dim vector (list of floats)."""
    return encode_batch([text])[0].tolist()
