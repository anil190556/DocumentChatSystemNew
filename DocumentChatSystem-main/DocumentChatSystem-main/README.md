
## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Browser / UI                        │
│  React + Vite  ·  upload zone  ·  chat  ·  citations    │
└────────────────────────┬────────────────────────────────┘
                         │ REST / SSE
┌────────────────────────▼────────────────────────────────┐
│                   FastAPI  (Python)                      │
│                                                          │
│  POST /ingest          POST /chat                        │
│  ┌──────────────┐      ┌──────────────────────────────┐  │
│  │ PDF parser   │      │ 1. embed query               │  │
│  │ text chunker │      │ 2. ANN search (Qdrant)       │  │
│  │ embedder     │      │ 3. rerank top-k chunks       │  │
│  │ Qdrant upsert│      │ 4. build prompt + context    │  │
│  └──────────────┘      │ 5. stream LLM response       │  │
│                        └──────────────────────────────┘  │
└──────┬──────────────────────────┬───────────────────────┘
       │                          │
┌──────▼──────┐          ┌────────▼────────┐
│   Qdrant    │          │  OpenAI / Cohere │
│ vector DB   │          │  LLM + embedder  │
└─────────────┘          └─────────────────┘
```

**Ingestion pipeline**
1. Parse document → extract raw text (PyMuPDF for PDFs, plain read for TXT/MD)
2. Chunk with a sliding window (512 tokens, 64-token overlap)
3. Embed each chunk → `text-embedding-3-large` (3072-dim, reduced to 1536)
4. Upsert vectors + metadata (doc id, chunk index, page number, raw text) into Qdrant

**Query pipeline**
1. Embed query with the same model
2. Retrieve top-20 candidates from Qdrant (cosine similarity)
3. Rerank to top-5 with Cohere Rerank v3
4. Stuff context into a system prompt with source attribution instructions
5. Stream the LLM response back to the client via SSE; attach citation metadata

---

## Productionising & Cloud Deployment

### What needs to change before this is production-ready

| Area | Current (demo) | Production target |
|---|---|---|
| Document storage | Browser memory | S3 / GCS object store |
| Vector DB | Local Qdrant (Docker) | Qdrant Cloud or managed Weaviate |
| Auth | None | Clerk / Auth0 with per-user document isolation |
| Queue | Synchronous ingest | SQS / Pub/Sub + worker pool |
| Observability | None | LangSmith traces + Prometheus metrics |
| Rate limiting | None | API Gateway or Nginx with token-bucket |
| Secrets | `.env` file | AWS Secrets Manager / GCP Secret Manager |

### AWS reference architecture

```
Route 53 → CloudFront → S3 (static React build)
                      → ALB → ECS Fargate (FastAPI, 2–8 replicas)
                                  ↓
                             SQS queue → ECS worker (ingest jobs)
                                  ↓
                           Qdrant on EC2 (r6g.2xlarge) or Qdrant Cloud
                           RDS Postgres (document metadata, user state)
                           S3 (raw uploaded files)
                           Secrets Manager (API keys)
                           CloudWatch + X-Ray (logs, traces)
```

Autoscaling: ECS service auto-scaling on CPU + queue depth. Qdrant scales by adding replicas and sharding by collection. Embedding jobs are CPU-bound — a g4dn.xlarge runs ~3× faster than a general-purpose instance for batch encoding.

For **GCP**: Cloud Run (API) + Cloud Tasks (ingest queue) + Vertex AI Embeddings + AlloyDB pgvector or managed Weaviate on GCP Marketplace.

For **Cloudflare**: Workers + Vectorize (built-in vector DB, 5M vectors free) + AI Gateway for LLM proxying — best for latency-sensitive, globally distributed use cases with smaller document collections.

---

## RAG/LLM Approach & Decisions

### LLM
**Chosen: `claude-sonnet-5` (Anthropic)**

Considered GPT-4o and Gemini 2.0 Flash. Claude Sonnet 5 was selected because its 200k context window handles large retrieved context sets without truncation anxiety, and its instruction-following is noticeably tighter when asked to cite specific passages and avoid hallucinating beyond the provided context. GPT-4o is a close second and is a reasonable swap.

### Embedding model
**Chosen: `text-embedding-3-large` (OpenAI, 1536-dim)**

Strong MTEB benchmark scores across retrieval tasks. The `large` variant with dimension reduction to 1536 gives a good balance of quality vs. storage cost. For a fully open-source stack, `bge-m3` (BAAI) is the best alternative — it supports sparse + dense retrieval in a single model.

### Vector database
**Chosen: Qdrant**

Evaluated Pinecone, Weaviate, and pgvector. Qdrant was selected because:
- Native hybrid search (sparse BM25 + dense vectors in one query)
- Payload filtering without a separate metadata store
- Rust core with excellent single-node performance
- Clean Python client and straightforward Docker setup for local dev

pgvector is compelling if you already run Postgres and want fewer moving parts. Use it for prototypes and small deployments (<1M vectors).

### Orchestration
**Chosen: custom thin wrapper (no LangChain)**

LangChain adds significant abstraction overhead and the retrieval pipeline here is simple enough that a 100-line custom implementation is easier to reason about, test, and debug than fighting framework conventions. If the pipeline grows (multi-hop retrieval, query decomposition, agent tool use), LlamaIndex would be the next step — its node abstraction maps more naturally to the chunked document model than LangChain's chain primitives.

### Chunking strategy
Recursive character splitting with 512-token windows and 64-token overlap. Overlap preserves sentence context at chunk boundaries. For structured documents (contracts, technical specs), a semantic chunking approach — splitting on paragraph/section boundaries rather than fixed token counts — would improve retrieval precision.

### Prompt & context management
- System prompt instructs the model to answer only from provided context and to cite source passages using `[n]` notation
- Retrieved chunks injected in ranked order (highest similarity first)
- If query is out-of-scope for the document set, the model is instructed to say so rather than hallucinate
- Max context budget: 6000 tokens of retrieved text + 2000 tokens of conversation history

### Guardrails
- Input: strip PII patterns from queries before embedding (regex for email, phone, SSN)
- Output: validate that cited `[n]` references exist in the retrieved set before returning
- Jailbreak mitigation: system prompt isolation — user content never appears in the system role

### Quality & Evaluation
Retrieval quality measured with Recall@5 on a held-out QA set derived from the document collection. End-to-end answer quality scored with an LLM judge (GPT-4o as judge, grading faithfulness to source + relevance to query on a 1–5 scale). Target: faithfulness ≥ 4.0, relevance ≥ 4.2.

### Observability
LangSmith for trace-level visibility into each retrieval + generation call. Key metrics tracked: retrieval latency p50/p95, rerank latency, LLM TTFT (time to first token), answer faithfulness score, user thumbs-up/down rate per query.

---

## Key Technical Decisions

**Reranking after retrieval, not just ANN**
Pure vector similarity retrieves semantically related chunks but doesn't always surface the most *answerable* ones. A cross-encoder reranker (Cohere Rerank v3) sees the query and each candidate passage together, dramatically improving top-5 precision at a modest latency cost (~80ms). Worth it.

**Streaming responses via SSE**
LLM generation latency is user-perceptible. Streaming the response token-by-token with citations appended after the stream completes gives a significantly better perceived performance than waiting for the full response.

**Per-document chunk namespacing**
All chunks are stored with a `doc_id` payload field. This lets you scope retrieval to a subset of documents (filter by `doc_id IN [...]`) without separate collections, which simplifies multi-tenancy and avoids collection proliferation.

**Separate embedding + storage step at ingest time**
Embedding at query time is too slow and too expensive at scale. All documents are embedded once at upload and stored. Re-embedding is only triggered on document update.

---

## Engineering Standards

**Followed**
- Single responsibility: ingestion pipeline, retrieval, and generation are separate modules
- Environment variable configuration (no hardcoded keys)
- Structured logging (JSON) for all backend events
- Type hints throughout Python backend (Pydantic models for all API I/O)
- Idempotent ingest: re-uploading the same file hash is a no-op
- Frontend: TypeScript strict mode, component decomposition, no prop drilling past 2 levels

**Skipped (knowingly, for scope)**
- No test suite — a production version would have unit tests for chunking logic, integration tests for the retrieval pipeline, and a golden-set eval harness
- No CI/CD pipeline configured
- No database migrations framework (Alembic) — schema managed manually
- No rate limiting on the ingest endpoint

---

## How I Used AI Tools

Claude (claude-sonnet-5 via Claude Code) was used throughout:

- **UI scaffolding**: generated the initial React component structure and Tailwind layout, then iterated on the citation card UX and typing indicator
- **Architecture sounding board**: talked through the chunking strategy trade-offs and the reranking decision before committing
- **Boilerplate acceleration**: FastAPI route signatures, Pydantic models, and the Qdrant upsert/query wrappers were drafted by Claude and reviewed/edited by hand
- **README first draft**: this document was drafted with Claude and then substantially rewritten — particularly the "decisions and why" sections, which reflect actual choices made during development rather than generic best-practice recitation

I did not use AI-generated code without reading and understanding it. Every generated block was reviewed, and several were rewritten when they introduced unnecessary abstraction or didn't match the actual data model.

---

## What I'd Do Differently With More Time

1. **Semantic chunking over fixed-size splitting** — split on document structure (headings, paragraphs) rather than token counts. Produces more coherent chunks, especially for PDFs with tables and section headers.

2. **Query decomposition for complex questions** — multi-hop questions ("What did the 2024 paper say about the limitation that the 2025 survey addressed?") require decomposing the query into sub-questions, retrieving separately, and synthesizing. Not implemented.

3. **Full evaluation harness** — build a golden QA set from the document collection, run automated faithfulness + relevance scoring on every code change, and gate deploys on regression thresholds.

4. **User feedback loop** — thumbs up/down on answers fed back into a fine-tuning dataset for the reranker. Cheap to collect, high signal.

5. **Hybrid sparse + dense retrieval from day one** — BM25 (sparse) catches exact keyword matches that dense retrieval misses (product codes, proper nouns, acronyms). I'd wire `bge-m3`'s built-in sparse vectors into Qdrant's hybrid search rather than adding BM25 as an afterthought.

6. **Better PDF parsing** — PyMuPDF misses a lot on scanned PDFs and complex layouts. `unstructured` or `marker` would handle tables, headers, and multi-column layouts substantially better.

---

## Screenshots

See `/screenshots` directory in the repository for UI screenshots of:
- Document upload and indexing flow
- Chat interface with citation cards expanded
- Source excerpt preview
