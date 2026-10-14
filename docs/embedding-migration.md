# Embedding model upgrade: v1 → v2

How the API can switch from `paraphrase-MiniLM-L3-v2` (**v1**) to `intfloat/e5-small-v2` (**v2**) without downtime, and how to roll it back. The vectors for each version live in their own document field with their own Atlas Vector Search index, so cutover and rollback are a config flip.

| | v1 (current) | v2 (candidate) |
|---|---|---|
| Model | `sentence-transformers/paraphrase-MiniLM-L3-v2` | `intfloat/e5-small-v2` |
| Pooling / prefixes | mean / none | mean / `query: ` and `passage: ` |
| Query-side ONNX (the API) | `onnx/model.onnx` (fp32, 69 MB) | `onnx/model_qint8_avx512_vnni.onnx` (int8, 34 MB) |
| Passage-side ONNX (ingest) | `onnx/model.onnx` | `model.onnx` (fp32, 133 MB) |
| Field | `embedding` (float32 binData, ~1.55 KB/doc) | `embedding_v2` (int8 binData, ~405 B/doc) |
| Index | `vector_index` (cosine, scalar quantization) | `vector_index_v2` (cosine, no `quantization` because the vectors are already int8) |
| Recency-lift default | `0.06` | `0.02` |

Everything is defined in `api/embeddings.py` (versions) and `api/encoder.py` (models).

## Why e5-small-v2

Measured October 2026 on a stratified 10k-doc sample of the corpus, with 40 known-answer queries (the target verse or a phrase-identified talk is known), plus a side-by-side read of real `query_logs` queries. **This is a small proxy, not a benchmark.** With 40 queries a 0.03 change in recall is about one query.

| | recall@10 | hit@10 | MRR@10 |
|---|---|---|---|
| v1 (the stored production vectors) | 0.72 | 0.88 | 0.74 |
| v2 as deployed (fp32 passages, int8 queries, int8 storage) | 0.85 | 0.98 | 0.81 |

The paired bootstrap 95% CI for v2's recall@10 gain is about +0.05 to +0.20. Its MRR gain (+0.07) is not significant. v2 did better on 10 queries and worse on 1. The runners-up were `snowflake-arctic-embed-xs` (similar recall, no MRR gain) and `all-MiniLM-L12-v2`. It also returned more on-topic scripture for conversational queries such as "the earth is sad when christ dies" and "prophets are not infallible".

Memory: the API's peak RSS during a 20-query run plus a burst of 4 concurrent ~512-token queries, measured on macOS/arm64 (production is linux/amd64, so expect differences):

| | peak RSS |
|---|---|
| v1, before this change (transformers tokenizer, parallel inference) | ~454–466 MB |
| v1, after (tokenizers only, serialized inference) | ~353–369 MB |
| v2 (int8 query model) | ~307 MB |
| v2 with the fp32 query model (not used) | ~465 MB |

## Storage (Atlas free tier: 512 MB = uncompressed BSON + index bytes)

As of October 2026 there are 137,117 docs: data is 352.7 MB and indexes are 2.4 MB, so ~356 MB is used.

* A float32 `embedding_v2` alongside `embedding` would add 137k × ~1.55 KB ≈ **+213 MB, about 569 MB in total. That is over the cap.**
* An int8 `embedding_v2` adds 137k × 405 B ≈ **+56 MB, about 412 MB in total.** This fits, with ~100 MB of headroom.
* After cutover, dropping v1 (unsetting `embedding` and dropping `vector_index`) frees about 203 MB, leaving about 210 MB in total.

Storing int8 costs no measurable recall on the proxy (cosine ignores the per-vector scale). `ingest.reembed` refuses to start if its projection leaves less than 40 MB of headroom.

## Runbook

All commands run from `api/` with `api/.env` loaded. Steps 2, 3 and 6 write to Atlas.

```bash
# 0. Ship this code first. It is inert until EMBEDDING_VERSION changes: the default is v1.
#    Rebuild the image, which bakes in both v1 and v2 query models.

# 1. Check coverage (read-only), then a dry run (reads and embeds, writes nothing)
uv run python -m ingest.reembed --version v2 --status
uv run python -m ingest.reembed --version v2 --dry-run --limit 1000

# 2. Backfill embedding_v2 (resumable; only touches docs without the field; ~60 writes/s,
#    which is under the free tier's 100 ops/s). About 1 h on an M-series laptop for 137k docs.
uv run python -m ingest.reembed --version v2

# 3. Build the v2 index, then wait until Atlas reports it READY
uv run python -m ingest.reembed --version v2 --create-index

# 4. Keep both versions current while both exist: any ingest/sync run from now on needs
EMBEDDING_WRITE_VERSIONS=v1,v2 uv run python -m ingest.sync
#    (then re-run step 2, which picks up anything a run without it missed)

# 5. Cutover: set EMBEDDING_VERSION=v2 on the API host and restart.
#    Rollback: unset it (or set v1) and restart.

# 6. Later, once v2 has settled (separate decision): set EMBEDDING_WRITE_VERSIONS=v2,
#    unset the `embedding` field, drop `vector_index`, and make v2 the default in embeddings.py.
```

Before step 5, try v2 locally against the real index: `EMBEDDING_VERSION=v2 LOG_QUERIES=0 uv run uvicorn app:app --port 10000`.

## Caveats

* **int8 query model on x86.** The e5 int8 export uses s8 weights and u8 activations. On x86 CPUs without AVX512-VNNI, onnxruntime's u8s8 kernels can saturate, which shifts query vectors slightly. On arm64, the int8 vs fp32 query cosine is 0.998–0.999 for normal queries and 0.984 for a 500-token one. Check it on the production host before cutover:

  ```bash
  docker run --rm -e HF_HUB_OFFLINE=0 --entrypoint python gospel-library-search -c "import encoder as e; s=e.MODELS['e5-small-v2']; q=e.Encoder(s, s.query_onnx); f=e.Encoder(s, s.passage_onnx); t=['query: charity never faileth','query: how to know truth for ourselves through the holy ghost']; print((q.encode(t)*f.encode(t)).sum(1))"
  ```

  If it prints well under ~0.99, set `EMBED_ONNX_FILE` to another int8 build. The fp32 file is the fallback, but at ~465 MB it would not fit a 512 MB host.
* **Scores look different.** e5's cosines bunch together: a typical top hit is ~0.94 in the API's (1+cos)/2 scale, versus ~0.82 for v1. The "% match" bar will read high for everything. That is also why v2's default recency weight is 0.02 rather than 0.06. With 0.06, recency outweighs relevance (e.g. 2025–26 talks rank above D&C 138 for "spirit prison"). `RECENCY_WEIGHT` still overrides it.
* **`ingest.stats`** uses the active version's vectors. Its "strong verse echo" threshold (`> 0.6` cosine) was tuned for v1 and needs re-tuning for v2.
* **v1's stored vectors are inconsistent.** Corpora embedded before the ONNX switch (most of Conference) were truncated at 128 tokens by sentence-transformers. Later ones (BYU Speeches, the handbook, newer talks) used 512. The re-embed makes v2 consistent at 512.
* **Long queries cost more on v2.** The API now runs one inference at a time. A ~512-token query took ~70–85 ms single-threaded on an M4 (vs ~20 ms on v1), so expect a few hundred ms on a small shared vCPU. Short queries cost a few ms either way.
