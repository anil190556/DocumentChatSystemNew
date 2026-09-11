import { useState, useRef, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  id: string;
  name: string;
  size: string;
  pages: number;
  status: "indexing" | "ready" | "error";
  addedAt: string;
  chunks: number;
}

interface Citation {
  docId: string;
  docName: string;
  excerpt: string;
  page: number;
  score: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  ts: string;
}

// ── Mock data ────────────────────────────────────────────────────────────────

const INITIAL_DOCS: Doc[] = [
  {
    id: "d1",
    name: "transformer_architecture.pdf",
    size: "2.4 MB",
    pages: 14,
    status: "ready",
    addedAt: "2026-09-11",
    chunks: 87,
  },
  {
    id: "d2",
    name: "rag_survey_2025.pdf",
    size: "5.1 MB",
    pages: 38,
    status: "ready",
    addedAt: "2026-09-10",
    chunks: 214,
  },
  {
    id: "d3",
    name: "vector_databases_overview.txt",
    size: "180 KB",
    pages: 1,
    status: "ready",
    addedAt: "2026-09-09",
    chunks: 31,
  },
];

const MOCK_RESPONSES: Record<string, { content: string; citations: Citation[] }> = {
  default: {
    content:
      "Based on the documents in your collection, retrieval-augmented generation (RAG) works by first encoding your query into a dense vector embedding, then performing approximate nearest-neighbor search over your indexed document chunks to retrieve the top-k most semantically similar passages. These retrieved passages are then injected into the LLM prompt as context, grounding the model's response in your actual documents rather than parametric memory alone.\n\nThe key advantage is that you can update your knowledge base without retraining the underlying model — simply re-index new documents and the system immediately benefits from that new content.",
    citations: [
      {
        docId: "d2",
        docName: "rag_survey_2025.pdf",
        excerpt:
          "RAG systems retrieve relevant passages via dense retrieval (e.g. DPR, Contriever) or sparse retrieval (BM25), then condition generation on the retrieved context. Hybrid retrieval combining both sparse and dense signals consistently outperforms either alone on open-domain QA benchmarks.",
        page: 4,
        score: 0.94,
      },
      {
        docId: "d1",
        docName: "transformer_architecture.pdf",
        excerpt:
          "Attention mechanisms allow the model to dynamically weight the relevance of each token in the context window. With long-context models, the full retrieved document set can often fit within a single forward pass.",
        page: 7,
        score: 0.81,
      },
    ],
  },
  embedding: {
    content:
      "Embedding models convert text into dense floating-point vectors in a high-dimensional space (typically 768–3072 dimensions) such that semantically similar passages have small cosine distance. For RAG, the choice of embedding model significantly impacts retrieval quality.\n\nTop performers as of 2025 include OpenAI's `text-embedding-3-large`, Cohere's `embed-v3`, and open-source models like `nomic-embed-text` and `bge-m3`. When selecting an embedding model, consider: (1) dimensionality vs. storage cost, (2) multilingual support, (3) max sequence length — critical for long document chunks, and (4) whether a fine-tuned domain-specific model would outperform a general-purpose one.",
    citations: [
      {
        docId: "d3",
        docName: "vector_databases_overview.txt",
        excerpt:
          "Embedding dimensionality is a direct trade-off: higher-dimensional vectors capture more semantic nuance but increase storage and query latency. Quantization techniques like int8 or binary quantization can reduce memory by 4–32× with minimal quality degradation.",
        page: 1,
        score: 0.96,
      },
      {
        docId: "d2",
        docName: "rag_survey_2025.pdf",
        excerpt:
          "MTEB (Massive Text Embedding Benchmark) is the standard evaluation suite for comparing embedding models across retrieval, clustering, classification, and semantic textual similarity tasks.",
        page: 12,
        score: 0.88,
      },
    ],
  },
  vector: {
    content:
      "Vector databases store and index embedding vectors for fast approximate nearest-neighbor (ANN) search. The main options are:\n\n**Managed cloud services:** Pinecone, Weaviate Cloud, Qdrant Cloud — zero-ops, built-in scaling, pay-per-query.\n\n**Self-hosted:** Qdrant, Weaviate, Milvus, Chroma — full control, no vendor lock-in, require infrastructure management.\n\n**Embedded / in-process:** pgvector (PostgreSQL extension), LanceDB, Chroma (local mode) — ideal for prototyping and single-node deployments.\n\nFor production RAG at scale, Qdrant and Weaviate both offer strong performance with HNSW indexes, metadata filtering, and hybrid sparse+dense retrieval. pgvector is compelling if you already run Postgres and want to avoid a separate service.",
    citations: [
      {
        docId: "d3",
        docName: "vector_databases_overview.txt",
        excerpt:
          "HNSW (Hierarchical Navigable Small World) is the dominant ANN index structure. It offers O(log n) search complexity and supports incremental inserts without full reindexing, making it practical for continuously updated document collections.",
        page: 1,
        score: 0.97,
      },
    ],
  },
};

function getMockResponse(query: string): { content: string; citations: Citation[] } {
  const q = query.toLowerCase();
  if (q.includes("embed")) return MOCK_RESPONSES.embedding;
  if (q.includes("vector") || q.includes("database") || q.includes("pinecone") || q.includes("qdrant"))
    return MOCK_RESPONSES.vector;
  return MOCK_RESPONSES.default;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1v9M4 4l4-3 4 3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 2a1 1 0 011-1h5l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M14 8L2 2l3 6-3 6 12-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M1.5 3.5h10M5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M10.5 3.5l-.5 7a1 1 0 01-1 .9H4a1 1 0 01-1-.9l-.5-7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.25" />
      <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Doc["status"] }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{
        background:
          status === "ready" ? "#D4FF3E" : status === "indexing" ? "#F5A623" : "#FF4444",
        boxShadow: status === "ready" ? "0 0 4px #D4FF3E88" : undefined,
      }}
    />
  );
}

function DocItem({
  doc,
  active,
  onClick,
  onDelete,
}: {
  doc: Doc;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      className="group relative flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors"
      style={{
        background: active ? "#1A1A1A" : hover ? "#131313" : "transparent",
        borderLeft: active ? "2px solid #D4FF3E" : "2px solid transparent",
      }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="mt-0.5 text-[#444]">
        <IconFile />
      </span>
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-medium truncate leading-tight"
          style={{ color: active ? "#F2F2F2" : "#AAAAAA", fontFamily: "var(--font-jetbrains)" }}
        >
          {doc.name}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <StatusDot status={doc.status} />
          <span className="text-[10px]" style={{ color: "#555", fontFamily: "var(--font-jetbrains)" }}>
            {doc.chunks} chunks · {doc.size}
          </span>
        </div>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded"
        style={{ color: "#555" }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

function UploadZone({ onUpload }: { onUpload: (name: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((f) => onUpload(f.name));
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => onUpload(f.name));
  }

  return (
    <div
      className="mx-3 mb-3 flex flex-col items-center justify-center gap-1.5 py-4 cursor-pointer transition-all"
      style={{
        border: `1px dashed ${dragging ? "#D4FF3E" : "#2A2A2A"}`,
        borderRadius: "3px",
        background: dragging ? "#D4FF3E08" : "transparent",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.txt,.md,.docx"
        className="hidden"
        onChange={handleChange}
      />
      <span style={{ color: dragging ? "#D4FF3E" : "#444" }}>
        <IconUpload />
      </span>
      <span className="text-[10px] text-center" style={{ color: "#555", fontFamily: "var(--font-jetbrains)" }}>
        drop files or click
        <br />
        <span style={{ color: "#3A3A3A" }}>pdf · txt · md · docx</span>
      </span>
    </div>
  );
}

function CitationCard({ citation, index }: { citation: Citation; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded overflow-hidden transition-all"
      style={{ border: "1px solid #1F1F1F", background: "#0F0F0F" }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{
            background: "#D4FF3E18",
            color: "#D4FF3E",
            fontFamily: "var(--font-jetbrains)",
          }}
        >
          [{index + 1}]
        </span>
        <span className="flex-1 text-[11px] truncate" style={{ color: "#777", fontFamily: "var(--font-jetbrains)" }}>
          {citation.docName}
        </span>
        <span className="text-[10px]" style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}>
          p.{citation.page}
        </span>
        <span
          className="text-[10px]"
          style={{ color: "#D4FF3E88", fontFamily: "var(--font-jetbrains)" }}
        >
          {(citation.score * 100).toFixed(0)}%
        </span>
        <span
          className="transition-transform"
          style={{
            color: "#444",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <IconChevron />
        </span>
      </button>
      {open && (
        <div
          className="px-3 pb-3 text-[11px] leading-relaxed"
          style={{
            color: "#888",
            fontFamily: "var(--font-jetbrains)",
            borderTop: "1px solid #1A1A1A",
            paddingTop: "8px",
          }}
        >
          "{citation.excerpt}"
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-2">
        {!isUser && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5"
            style={{
              background: "#D4FF3E",
              color: "#090909",
              fontFamily: "var(--font-jetbrains)",
              borderRadius: "2px",
            }}
          >
            RAG
          </span>
        )}
        <span className="text-[10px]" style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}>
          {message.ts}
        </span>
        {isUser && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5"
            style={{
              background: "#1E1E1E",
              color: "#888",
              fontFamily: "var(--font-jetbrains)",
              borderRadius: "2px",
            }}
          >
            YOU
          </span>
        )}
      </div>

      <div
        className="max-w-[680px] text-sm leading-relaxed"
        style={{
          padding: isUser ? "10px 14px" : "14px 16px",
          background: isUser ? "#1A1A1A" : "#111111",
          border: `1px solid ${isUser ? "#252525" : "#1C1C1C"}`,
          borderRadius: "3px",
          color: isUser ? "#AAAAAA" : "#E8E8E8",
          fontFamily: "var(--font-instrument)",
        }}
      >
        {message.content.split("\n\n").map((para, i) => {
          if (para.startsWith("**") || para.includes("**")) {
            return (
              <p key={i} className="mb-3 last:mb-0">
                {para.split("**").map((part, j) =>
                  j % 2 === 1 ? (
                    <strong key={j} style={{ color: "#F2F2F2", fontWeight: 600 }}>
                      {part}
                    </strong>
                  ) : (
                    part
                  )
                )}
              </p>
            );
          }
          return (
            <p key={i} className="mb-3 last:mb-0">
              {para}
            </p>
          );
        })}
      </div>

      {message.citations && message.citations.length > 0 && (
        <div className="w-full max-w-[680px] flex flex-col gap-1.5">
          <span
            className="text-[10px] uppercase tracking-widest mb-0.5"
            style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}
          >
            Sources
          </span>
          {message.citations.map((c, i) => (
            <CitationCard key={i} citation={c} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span
        className="text-[10px] font-semibold px-2 py-0.5 self-start"
        style={{
          background: "#D4FF3E",
          color: "#090909",
          fontFamily: "var(--font-jetbrains)",
          borderRadius: "2px",
        }}
      >
        RAG
      </span>
      <div
        className="flex items-center gap-1.5 px-4 py-3"
        style={{ background: "#111111", border: "1px solid #1C1C1C", borderRadius: "3px" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "#D4FF3E",
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              opacity: 0.7,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [docs, setDocs] = useState<Doc[]>(INITIAL_DOCS);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      content:
        "Ready. I have indexed 3 documents in your collection — a survey on RAG architectures, the original transformer paper, and an overview of vector databases. Ask me anything about them.",
      ts: "09:00",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const now = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
      ts: now(),
    };

    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);

    await new Promise((r) => setTimeout(r, 1400 + Math.random() * 800));

    const { content, citations } = getMockResponse(text);
    const assistantMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "assistant",
      content,
      citations,
      ts: now(),
    };

    setThinking(false);
    setMessages((m) => [...m, assistantMsg]);
  }, [input, thinking]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleUpload(name: string) {
    const newDoc: Doc = {
      id: `d${Date.now()}`,
      name,
      size: `${(Math.random() * 4 + 0.2).toFixed(1)} MB`,
      pages: Math.floor(Math.random() * 40 + 2),
      status: "indexing",
      addedAt: new Date().toISOString().split("T")[0],
      chunks: 0,
    };
    setDocs((d) => [newDoc, ...d]);

    setTimeout(() => {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === newDoc.id
            ? { ...d, status: "ready", chunks: Math.floor(Math.random() * 180 + 20) }
            : d
        )
      );
    }, 2500);
  }

  const readyCount = docs.filter((d) => d.status === "ready").length;
  const totalChunks = docs.filter((d) => d.status === "ready").reduce((s, d) => s + d.chunks, 0);

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
        textarea { resize: none; }
        textarea::placeholder { color: #444; }
      `}</style>

      <div className="flex h-screen overflow-hidden" style={{ background: "#090909" }}>
        {/* ── Sidebar ── */}
        <aside
          className="flex flex-col flex-shrink-0 overflow-hidden transition-all duration-200"
          style={{
            width: sidebarOpen ? "260px" : "0px",
            borderRight: "1px solid #161616",
          }}
        >
          {/* Sidebar header */}
          <div
            className="px-4 py-4 flex-shrink-0"
            style={{ borderBottom: "1px solid #161616" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-xs font-bold tracking-widest uppercase"
                style={{ color: "#D4FF3E", fontFamily: "var(--font-jetbrains)" }}
              >
                DocChat
              </span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: "#1A1A1A", color: "#555", fontFamily: "var(--font-jetbrains)" }}
              >
                RAG
              </span>
            </div>
            <div className="flex gap-3 mt-2">
              <span className="text-[10px]" style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}>
                <span style={{ color: "#D4FF3E" }}>{readyCount}</span> docs
              </span>
              <span className="text-[10px]" style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}>
                <span style={{ color: "#D4FF3E" }}>{totalChunks}</span> chunks
              </span>
            </div>
          </div>

          {/* Upload zone */}
          <div className="pt-3 flex-shrink-0">
            <UploadZone onUpload={handleUpload} />
          </div>

          {/* Doc list */}
          <div className="flex-1 overflow-y-auto">
            <div
              className="px-3 pb-1.5 pt-1"
              style={{ borderBottom: "1px solid #141414" }}
            >
              <span
                className="text-[9px] uppercase tracking-widest"
                style={{ color: "#333", fontFamily: "var(--font-jetbrains)" }}
              >
                Indexed Documents
              </span>
            </div>
            {docs.map((doc) => (
              <DocItem
                key={doc.id}
                doc={doc}
                active={activeDocId === doc.id}
                onClick={() => setActiveDocId(activeDocId === doc.id ? null : doc.id)}
                onDelete={() => {
                  setDocs((d) => d.filter((x) => x.id !== doc.id));
                  if (activeDocId === doc.id) setActiveDocId(null);
                }}
              />
            ))}
          </div>

          {/* Sidebar footer */}
          <div
            className="px-3 py-3 flex-shrink-0"
            style={{ borderTop: "1px solid #141414" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "#D4FF3E", boxShadow: "0 0 4px #D4FF3E" }}
              />
              <span className="text-[10px]" style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}>
                claude-sonnet-5 · text-embedding-3-large
              </span>
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header
            className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
            style={{ borderBottom: "1px solid #141414" }}
          >
            <button
              className="flex flex-col gap-1 p-1.5 rounded transition-colors"
              style={{ color: "#555" }}
              onClick={() => setSidebarOpen((o) => !o)}
            >
              <span className="w-4 h-px" style={{ background: "currentColor", display: "block" }} />
              <span className="w-3 h-px" style={{ background: "currentColor", display: "block" }} />
              <span className="w-4 h-px" style={{ background: "currentColor", display: "block" }} />
            </button>

            <div style={{ width: "1px", height: "16px", background: "#1F1F1F" }} />

            <span
              className="text-xs"
              style={{ color: "#444", fontFamily: "var(--font-jetbrains)" }}
            >
              {activeDocId
                ? docs.find((d) => d.id === activeDocId)?.name
                : `${readyCount} documents · ${totalChunks} indexed chunks`}
            </span>

            <div className="flex-1" />

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors rounded"
              style={{
                border: "1px solid #1F1F1F",
                color: "#555",
                fontFamily: "var(--font-jetbrains)",
                background: "transparent",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#888";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#333";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#555";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#1F1F1F";
              }}
              onClick={() => {
                setMessages([
                  {
                    id: "init-" + Date.now(),
                    role: "assistant",
                    content: "Conversation cleared. Ready for new queries.",
                    ts: now(),
                  },
                ]);
              }}
            >
              <IconSearch />
              New chat
            </button>
          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {thinking && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            className="px-5 py-4 flex-shrink-0"
            style={{ borderTop: "1px solid #141414" }}
          >
            {/* Suggested queries */}
            {messages.length <= 1 && (
              <div className="flex gap-2 mb-3 flex-wrap">
                {[
                  "How does RAG retrieval work?",
                  "Compare vector database options",
                  "Explain embedding models",
                ].map((q) => (
                  <button
                    key={q}
                    className="text-[11px] px-3 py-1.5 rounded transition-colors"
                    style={{
                      border: "1px solid #1F1F1F",
                      color: "#555",
                      fontFamily: "var(--font-jetbrains)",
                      background: "transparent",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#D4FF3E";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#D4FF3E44";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#555";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#1F1F1F";
                    }}
                    onClick={() => setInput(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div
              className="flex items-end gap-3"
              style={{
                border: "1px solid #1F1F1F",
                borderRadius: "3px",
                background: "#111111",
                padding: "10px 12px",
              }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your documents…"
                className="flex-1 bg-transparent outline-none text-sm leading-relaxed"
                style={{
                  color: "#E8E8E8",
                  fontFamily: "var(--font-instrument)",
                  minHeight: "22px",
                  maxHeight: "160px",
                  overflowY: "auto",
                }}
                disabled={thinking}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || thinking}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded transition-all"
                style={{
                  background: input.trim() && !thinking ? "#D4FF3E" : "#1A1A1A",
                  color: input.trim() && !thinking ? "#090909" : "#444",
                  cursor: input.trim() && !thinking ? "pointer" : "default",
                }}
              >
                <IconSend />
              </button>
            </div>
            <p
              className="text-[10px] mt-2 text-center"
              style={{ color: "#2A2A2A", fontFamily: "var(--font-jetbrains)" }}
            >
              ↵ send · shift+↵ newline · responses grounded in your documents
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
