"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SourceCategory,
  SourceRecord,
  createSourceId,
  deleteBlob,
  detectCategory,
  detectCategoryFromUrl,
  loadSources,
  persistBlob,
  persistSources,
  readBlob
} from "@/lib/sources";

type PreviewEntry = {
  objectUrl?: string;
  text?: string;
};

const ASSISTANT_ENDPOINT_KEY = "agentic-source-hub::assistant-endpoint";

const CATEGORY_OPTIONS: { key: SourceCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "video", label: "Video" },
  { key: "image", label: "Image" },
  { key: "pdf", label: "PDF" },
  { key: "text", label: "Text" },
  { key: "other", label: "Other" }
];

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(1)} ${units[index]}`;
}

function formatDate(dateIso: string): string {
  const date = new Date(dateIso);
  return date.toLocaleString();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export default function SourceManager() {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [previews, setPreviews] = useState<Record<string, PreviewEntry>>({});
  const [assistantUrl, setAssistantUrl] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<SourceCategory | "all">(
    "all"
  );
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error" | "info">(
    "info"
  );
  const [sending, setSending] = useState(false);
  const [urlForm, setUrlForm] = useState({
    url: "",
    name: "",
    tags: "",
    description: ""
  });
  const [textForm, setTextForm] = useState({
    title: "",
    content: "",
    tags: ""
  });
  const objectUrlRef = useRef<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialSources = loadSources();
    setSources(initialSources);
    const storedEndpoint = window.localStorage.getItem(ASSISTANT_ENDPOINT_KEY);
    if (storedEndpoint) {
      setAssistantUrl(storedEndpoint);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistSources(sources);
  }, [sources]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ASSISTANT_ENDPOINT_KEY, assistantUrl);
  }, [assistantUrl]);

  useEffect(() => {
    let isCurrent = true;

    const loadPreviews = async () => {
      const next: Record<string, PreviewEntry> = {};
      const existingIds = new Set(sources.map((source) => source.id));

      Object.entries(objectUrlRef.current).forEach(([id, url]) => {
        if (!existingIds.has(id)) {
          URL.revokeObjectURL(url);
          delete objectUrlRef.current[id];
        }
      });

      for (const source of sources) {
        if (source.fileKey) {
          const blob = await readBlob(source.fileKey);
          if (!blob) continue;
          if (!objectUrlRef.current[source.id]) {
            objectUrlRef.current[source.id] = URL.createObjectURL(blob);
          }
          next[source.id] = { objectUrl: objectUrlRef.current[source.id] };
        } else if (source.textKey) {
          const blob = await readBlob(source.textKey);
          if (!blob) continue;
          const text = await blob.text();
          next[source.id] = { text };
        } else {
          next[source.id] = {};
        }
      }

      if (isCurrent) {
        setPreviews(next);
      }
    };

    loadPreviews().catch((error) => {
      console.error("Failed to prepare previews", error);
    });

    return () => {
      isCurrent = false;
    };
  }, [sources]);

  useEffect(() => {
    return () => {
      Object.values(objectUrlRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      objectUrlRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (selectedId) {
      const exists = sources.some((source) => source.id === selectedId);
      if (!exists) {
        setSelectedId(null);
      }
    }

    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => sources.some((s) => s.id === id)));
      return next;
    });
  }, [sources, selectedId]);

  const filteredSources = useMemo(() => {
    const lowerQuery = query.toLowerCase();
    return sources.filter((source) => {
      const matchesCategory =
        categoryFilter === "all" ? true : source.category === categoryFilter;
      const matchesQuery =
        lowerQuery.length === 0 ||
        source.name.toLowerCase().includes(lowerQuery) ||
        (source.description &&
          source.description.toLowerCase().includes(lowerQuery)) ||
        source.tags.some((tag) => tag.toLowerCase().includes(lowerQuery));
      return matchesCategory && matchesQuery;
    });
  }, [sources, categoryFilter, query]);

  const selectedSources = useMemo(
    () => sources.filter((source) => selectedIds.has(source.id)),
    [sources, selectedIds]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (!fileArray.length) return;

      setIsProcessing(true);
      const additions: SourceRecord[] = [];

      for (const file of fileArray) {
        const id = createSourceId();
        const category = detectCategory(file);
        const fileKey = `file::${id}`;
        await persistBlob(fileKey, file);
        additions.push({
          id,
          name: file.name,
          kind: "file",
          category,
          createdAt: new Date().toISOString(),
          size: file.size,
          mimeType: file.type,
          tags: [],
          description: "",
          fileKey
        });
      }

      setSources((prev) => [...additions, ...prev]);
      setSelectedId(additions[0]?.id ?? null);
      setStatusTone("success");
      setStatusMessage(`Added ${additions.length} source${additions.length > 1 ? "s" : ""}.`);
      setTimeout(() => setStatusMessage(null), 3500);
      setIsProcessing(false);
    },
    []
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      if (event.dataTransfer?.files) {
        await handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const { files } = event.target;
      if (files) {
        await handleFiles(files);
        event.target.value = "";
      }
    },
    [handleFiles]
  );

  const handleUrlSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!urlForm.url.trim()) return;
    const id = createSourceId();
    const name = urlForm.name.trim() || urlForm.url.trim();
    const tags = parseTags(urlForm.tags);
    const category = detectCategoryFromUrl(urlForm.url);

    const newSource: SourceRecord = {
      id,
      name,
      kind: "url",
      category,
      createdAt: new Date().toISOString(),
      tags,
      description: urlForm.description.trim(),
      url: urlForm.url.trim()
    };

    setSources((prev) => [newSource, ...prev]);
    setSelectedId(id);
    setUrlForm({ url: "", name: "", tags: "", description: "" });
    setStatusTone("success");
    setStatusMessage("Linked remote source.");
    setTimeout(() => setStatusMessage(null), 3200);
  };

  const handleTextSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!textForm.title.trim() || !textForm.content.trim()) return;
    const id = createSourceId();
    const textKey = `text::${id}`;
    await persistBlob(
      textKey,
      new Blob([textForm.content.trim()], { type: "text/plain" })
    );

    const newSource: SourceRecord = {
      id,
      name: textForm.title.trim(),
      kind: "text",
      category: "text",
      createdAt: new Date().toISOString(),
      tags: parseTags(textForm.tags),
      textKey,
      description: ""
    };

    setSources((prev) => [newSource, ...prev]);
    setSelectedId(id);
    setTextForm({ title: "", content: "", tags: "" });
    setStatusTone("success");
    setStatusMessage("Captured text note.");
    setTimeout(() => setStatusMessage(null), 3200);
  };

  const handleDelete = async (source: SourceRecord) => {
    if (source.fileKey) {
      await deleteBlob(source.fileKey);
    }
    if (source.textKey) {
      await deleteBlob(source.textKey);
    }
    setSources((prev) => prev.filter((item) => item.id !== source.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(source.id);
      return next;
    });
    if (selectedId === source.id) {
      setSelectedId(null);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSendToAssistant = async () => {
    if (!assistantUrl.trim()) {
      setStatusTone("error");
      setStatusMessage("Add assistant endpoint URL first.");
      setTimeout(() => setStatusMessage(null), 3500);
      return;
    }

    const targets = selectedSources.length
      ? selectedSources
      : selectedId
      ? sources.filter((source) => source.id === selectedId)
      : [];

    if (!targets.length) {
      setStatusTone("info");
      setStatusMessage("Select at least one source to send.");
      setTimeout(() => setStatusMessage(null), 3200);
      return;
    }

    setSending(true);
    setStatusTone("info");
    setStatusMessage("Sending payload to assistant…");

    try {
      const payload = [];

      for (const source of targets) {
        if (source.fileKey) {
          const blob = await readBlob(source.fileKey);
          if (!blob) continue;
          const base64 = await blobToBase64(blob);
          payload.push({
            id: source.id,
            name: source.name,
            type: source.category,
            kind: source.kind,
            tags: source.tags,
            createdAt: source.createdAt,
            size: source.size,
            mimeType: source.mimeType,
            description: source.description,
            data: {
              encoding: "base64",
              value: base64
            }
          });
        } else if (source.textKey) {
          const blob = await readBlob(source.textKey);
          const text = blob ? await blob.text() : "";
          payload.push({
            id: source.id,
            name: source.name,
            type: source.category,
            kind: source.kind,
            tags: source.tags,
            createdAt: source.createdAt,
            description: source.description,
            data: {
              encoding: "text",
              value: text
            }
          });
        } else if (source.url) {
          payload.push({
            id: source.id,
            name: source.name,
            type: source.category,
            kind: source.kind,
            tags: source.tags,
            createdAt: source.createdAt,
            description: source.description,
            data: {
              encoding: "url",
              value: source.url
            }
          });
        }
      }

      const response = await fetch(assistantUrl.trim(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sourceCount: payload.length,
          sources: payload
        })
      });

      if (!response.ok) {
        throw new Error(`Assistant request failed (${response.status})`);
      }

      setStatusTone("success");
      setStatusMessage("Assistant synced successfully.");
      setTimeout(() => setStatusMessage(null), 3500);
    } catch (error) {
      console.error(error);
      setStatusTone("error");
      setStatusMessage("Unable to reach assistant endpoint.");
      setTimeout(() => setStatusMessage(null), 4000);
    } finally {
      setSending(false);
    }
  };

  const selectedPreview = selectedId ? previews[selectedId] : undefined;
  const selectedSource = selectedId
    ? sources.find((source) => source.id === selectedId)
    : undefined;

  return (
    <div className="main-shell">
      <header className="card shadow-soft" style={{ gap: "18px" }}>
        <div className="chip-row">
          <span className="pill">Agentic Source Hub</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <h1 style={{ margin: 0, fontSize: "28px" }}>
            Curate multimodal knowledge sources
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", maxWidth: 720 }}>
            Upload media, attach documents, or capture notes. Stage everything
            your AI workflows need, then sync them to your agent endpoint in one
            click.
          </p>
        </div>
        <div
          className="card"
          style={{ display: "flex", flexDirection: "column", gap: "14px" }}
        >
          <label style={{ fontWeight: 600, fontSize: 14 }}>
            Assistant webhook URL
          </label>
          <input
            className="input"
            placeholder="https://api.your-agent.com/sources"
            value={assistantUrl}
            onChange={(event) => setAssistantUrl(event.target.value)}
          />
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            We&apos;ll POST selected sources here as structured JSON.
          </p>
        </div>
      </header>

      {statusMessage && (
        <div
          className="card"
          style={{
            marginTop: 24,
            borderColor:
              statusTone === "success"
                ? "rgba(34,197,94,0.4)"
                : statusTone === "error"
                ? "rgba(220,38,38,0.4)"
                : "rgba(59,130,246,0.3)",
            backgroundColor:
              statusTone === "success"
                ? "rgba(240,253,244,0.8)"
                : statusTone === "error"
                ? "rgba(254,242,242,0.8)"
                : "rgba(239,246,255,0.8)",
            color:
              statusTone === "success"
                ? "rgb(22,163,74)"
                : statusTone === "error"
                ? "rgb(220,38,38)"
                : "rgb(37,99,235)"
          }}
        >
          {statusMessage}
        </div>
      )}

      <div className="page-grid" style={{ marginTop: 28 }}>
        <section className="section">
          <div
            className={`dropzone card ${isDragging ? "drag-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsDragging(false);
            }}
            onDrop={handleDrop}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--foreground)"
              }}
            >
              Drop videos, images, PDFs, or text files
            </div>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Supports up to ~8MB per file via browser storage. Files remain on
              this device until you push them to your assistant.
            </p>
            <div className="inline-actions" style={{ justifyContent: "center" }}>
              <button
                className="button button-primary"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
              >
                {isProcessing ? "Processing…" : "Select files"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleFileInput}
                accept=".mp4,.mov,.avi,.mkv,.webm,.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.md"
              />
            </div>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Link remote sources</h2>
            <form className="inline-form" onSubmit={handleUrlSubmit}>
              <input
                className="input"
                placeholder="https://example.com/resource.pdf"
                value={urlForm.url}
                onChange={(event) =>
                  setUrlForm((state) => ({ ...state, url: event.target.value }))
                }
                required
              />
              <input
                className="input"
                placeholder="Custom name (optional)"
                value={urlForm.name}
                onChange={(event) =>
                  setUrlForm((state) => ({ ...state, name: event.target.value }))
                }
              />
              <textarea
                className="textarea"
                placeholder="Describe the resource (optional)"
                value={urlForm.description}
                onChange={(event) =>
                  setUrlForm((state) => ({
                    ...state,
                    description: event.target.value
                  }))
                }
                rows={3}
              />
              <input
                className="input"
                placeholder="Tags (comma separated)"
                value={urlForm.tags}
                onChange={(event) =>
                  setUrlForm((state) => ({ ...state, tags: event.target.value }))
                }
              />
              <button className="button button-secondary" type="submit">
                Save remote source
              </button>
            </form>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Capture quick notes</h2>
            <form className="inline-form" onSubmit={handleTextSubmit}>
              <input
                className="input"
                placeholder="Title"
                value={textForm.title}
                onChange={(event) =>
                  setTextForm((state) => ({ ...state, title: event.target.value }))
                }
                required
              />
              <textarea
                className="textarea"
                placeholder="Content"
                value={textForm.content}
                onChange={(event) =>
                  setTextForm((state) => ({
                    ...state,
                    content: event.target.value
                  }))
                }
                rows={5}
                required
              />
              <input
                className="input"
                placeholder="Tags (comma separated)"
                value={textForm.tags}
                onChange={(event) =>
                  setTextForm((state) => ({ ...state, tags: event.target.value }))
                }
              />
              <button className="button button-secondary" type="submit">
                Save text note
              </button>
            </form>
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ fontWeight: 600, fontSize: 14 }}>Search</label>
              <input
                className="input"
                placeholder="Search name, tags, description"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="chip-row">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="button button-secondary"
                  style={{
                    backgroundColor:
                      categoryFilter === option.key
                        ? "rgba(37,99,235,0.12)"
                        : "var(--surface-elevated)",
                    borderColor:
                      categoryFilter === option.key
                        ? "rgba(37,99,235,0.5)"
                        : "var(--border)",
                    color:
                      categoryFilter === option.key
                        ? "var(--primary)"
                        : "var(--muted)",
                    fontWeight: categoryFilter === option.key ? 600 : 500
                  }}
                  onClick={() =>
                    setCategoryFilter(option.key as SourceCategory | "all")
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20 }}>Sources</h2>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                {filteredSources.length} item
                {filteredSources.length === 1 ? "" : "s"}
              </span>
            </div>

            {filteredSources.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 16 }}>
                <strong>No sources yet.</strong>
                <span>
                  Add files, notes, or remote URLs to start curating your
                  knowledge base.
                </span>
              </div>
            ) : (
              <div className="sources-list" style={{ marginTop: 20 }}>
                {filteredSources.map((source) => (
                  <article
                    key={source.id}
                    className={`source-card${
                      selectedId === source.id ? " selected" : ""
                    }`}
                    onClick={() => setSelectedId(source.id)}
                  >
                    <div className="source-card-header">
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(source.id)}
                          onChange={(event) => {
                            event.stopPropagation();
                            toggleSelection(source.id);
                          }}
                        />
                        <div>
                          <div className="source-name">{source.name}</div>
                          <div className="source-meta">
                            <span>{source.kind.toUpperCase()}</span>
                            <span>·</span>
                            <span>{source.category}</span>
                            {source.size ? (
                              <>
                                <span>·</span>
                                <span>{formatBytes(source.size)}</span>
                              </>
                            ) : null}
                            <span>·</span>
                            <span>{formatDate(source.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="source-actions">
                        {source.url ? (
                          <a
                            href={source.url}
                            className="button button-secondary"
                            style={{ padding: "6px 12px" }}
                            onClick={(event) => event.stopPropagation()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="button button-secondary"
                          style={{ padding: "6px 12px", color: "var(--danger)" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDelete(source);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {source.description ? (
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                        {source.description}
                      </p>
                    ) : null}
                    {source.tags.length ? (
                      <div className="chip-row">
                        {source.tags.map((tag) => (
                          <span key={tag} className="tag">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="preview-panel">
          <div className="card preview-surface">
            <h2 style={{ margin: 0, fontSize: 20 }}>Inspector</h2>
            {selectedSource ? (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6
                  }}
                >
                  <strong style={{ fontSize: 18 }}>{selectedSource.name}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    {selectedSource.kind.toUpperCase()} · {selectedSource.category} ·{" "}
                    {formatDate(selectedSource.createdAt)}
                  </span>
                </div>

                {selectedSource.tags.length ? (
                  <div className="chip-row">
                    {selectedSource.tags.map((tag) => (
                      <span key={tag} className="tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                {selectedSource.description ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    {selectedSource.description}
                  </p>
                ) : null}

                {selectedSource.url ? (
                  <a
                    className="button button-primary"
                    style={{ alignSelf: "flex-start" }}
                    href={selectedSource.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open remote resource
                  </a>
                ) : null}

                {selectedSource.fileKey && selectedPreview?.objectUrl ? (
                  <>
                    {selectedSource.category === "video" ? (
                      <video
                        className="preview-media"
                        controls
                        src={selectedPreview.objectUrl}
                      />
                    ) : selectedSource.category === "image" ? (
                      <img
                        className="preview-media"
                        alt={selectedSource.name}
                        src={selectedPreview.objectUrl}
                      />
                    ) : selectedSource.category === "pdf" ? (
                      <iframe
                        className="preview-media"
                        style={{ minHeight: 320, background: "#fff" }}
                        src={selectedPreview.objectUrl}
                        title={selectedSource.name}
                      />
                    ) : (
                      <a
                        className="button button-secondary"
                        href={selectedPreview.objectUrl}
                        download={selectedSource.name}
                      >
                        Download file
                      </a>
                    )}
                  </>
                ) : null}

                {selectedSource.textKey && selectedPreview?.text ? (
                  <pre
                    style={{
                      backgroundColor: "rgba(15,23,42,0.85)",
                      color: "#f8fafc",
                      padding: 16,
                      borderRadius: 12,
                      overflowX: "auto",
                      maxHeight: 320,
                      margin: 0
                    }}
                  >
                    {selectedPreview.text}
                  </pre>
                ) : null}
              </>
            ) : (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 280
                }}
              >
                <strong>Select a source to inspect its details.</strong>
                <span>
                  Choose multiple items with the checkboxes below to send them to
                  your assistant.
                </span>
              </div>
            )}
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Push to assistant</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Selected sources will be batched as JSON and delivered to your node.
            </p>
            <button
              className="button button-primary"
              onClick={handleSendToAssistant}
              disabled={sending}
            >
              {sending ? "Sending…" : "Send selection"}
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {selectedSources.length
                ? `${selectedSources.length} source${
                    selectedSources.length > 1 ? "s" : ""
                  } selected`
                : selectedId
                ? "Sending current selection"
                : "No sources selected"}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
