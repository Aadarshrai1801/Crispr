"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  CheckCircle,
  FileText,
  Plus,
  Trash,
  Warning,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { api, type DocumentDto } from "@/lib/client/api";
import { useActiveDocuments } from "@/lib/client/use-active-documents";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Skeleton, StatusDot } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

type UploadState = { name: string; file: File; error?: string; duplicateOf?: DocumentDto };

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeIds, setActiveIds, hydrated } = useActiveDocuments();
  const router = useRouter();

  const load = useCallback(() => api.listDocuments().then(setDocs).catch(() => setDocs([])), []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is processing
  useEffect(() => {
    if (!docs?.some((d) => d.status === "processing")) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [docs, load]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        setUploads((u) => [...u, { name: file.name, file }]);
        try {
          await api.uploadDocument(file);
        } catch (err) {
          const e = err as Error & { status?: number; payload?: Record<string, unknown> };
          if (e.status === 409 && e.payload) {
            const existing = (e.payload as { existing_document: DocumentDto }).existing_document;
            setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, duplicateOf: existing } : x)));
          } else {
            setUploads((u) =>
              u.map((x) => (x.name === file.name ? { ...x, error: e.message || "Upload failed" } : x))
            );
          }
        }
      }
      void load();
    },
    [load]
  );

  function resolveDuplicate(name: string, choice: "reuse" | "separate", existingId: string) {
    setUploads((u) => u.filter((x) => x.name !== name));
    if (choice === "reuse") {
      setActiveIds(Array.from(new Set([...activeIds, existingId])));
      router.push("/");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this document? Its chunks, embeddings and document-scoped corrections are removed too.")) return;
    await api.deleteDocument(id);
    setActiveIds(activeIds.filter((a) => a !== id));
    void load();
  }

  const readyDocs = docs?.filter((d) => d.status === "ready") ?? [];
  const anyProcessing = docs?.some((d) => d.status === "processing") ?? false;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 text-[13px] text-ink-soft">
            Upload PDFs to query them. Select which ones are active in chat.
          </p>
        </div>
        {anyProcessing && (
          <Chip tone="warn">
            <ArrowClockwise size={11} className="animate-spin" /> Ingesting…
          </Chip>
        )}
      </header>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={cn(
          "focus-ring mb-6 cursor-pointer rounded-2xl border border-dashed p-8 text-center transition-colors duration-200",
          dragOver ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-line-strong hover:bg-surface-2"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Plus size={20} weight="light" className="mx-auto mb-2 text-ink-faint" />
        <p className="text-[13px] font-medium">Drop PDFs here or click to browse</p>
        <p className="mt-1 text-xs text-ink-faint">Up to 200MB per file. Scanned pages fall back to OCR.</p>
      </div>

      {/* Upload issues / duplicates */}
      {uploads.map((u) => (
        <div
          key={u.name}
          className={cn(
            "mb-3 rounded-xl border px-4 py-3 text-[13px]",
            u.error && "border-danger/25 bg-danger-soft",
            u.duplicateOf && "border-warn/30 bg-warn-soft"
          )}
        >
          {u.error && (
            <div className="flex items-start gap-2">
              <WarningCircle size={15} className="mt-0.5 shrink-0 text-danger" />
              <span>
                <span className="font-medium">{u.name}</span> — {u.error}
              </span>
              <button onClick={() => setUploads((all) => all.filter((x) => x !== u))} className="focus-ring ml-auto rounded-md p-0.5 hover:text-danger">
                <XCircle size={14} />
              </button>
            </div>
          )}
          {u.duplicateOf && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                <span className="font-medium">{u.name}</span> already exists as “{u.duplicateOf.filename}”.
              </span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="primary" onClick={() => resolveDuplicate(u.name, "reuse", u.duplicateOf!.id)}>
                  Reuse index
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setUploads((all) => all.filter((x) => x !== u));
                    void api.uploadDocument(u.file, true)
                      .then(() => load())
                      .catch(() => undefined);
                  }}
                >
                  Keep separate copy
                </Button>
              </span>
            </div>
          )}
        </div>
      ))}

      {/* List */}
      {docs === null ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={<FileText size={20} weight="light" />}
          title="No documents yet"
          body="Upload your first PDF above. Once processed you can ask questions about it and correct wrong answers."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {docs.map((doc) => {
            const checked = activeIds.includes(doc.id);
            return (
              <div
                key={doc.id}
                className={cn(
                  "group relative rounded-2xl border p-4 transition-all duration-200",
                  checked ? "border-accent-line bg-accent-soft" : "border-line bg-surface hover:border-line-strong"
                )}
              >
                <div className="flex items-start gap-3">
                  <button
                    role="checkbox"
                    aria-checked={checked}
                    disabled={doc.status !== "ready"}
                    onClick={() => doc.status === "ready" && setActiveIds(checked ? activeIds.filter((x) => x !== doc.id) : [...activeIds, doc.id])}
                    aria-label={`Use ${doc.filename} in chat`}
                    className={cn(
                      "focus-ring mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors duration-200",
                      checked ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-transparent hover:border-ink-faint",
                      doc.status !== "ready" && "cursor-not-allowed opacity-40"
                    )}
                  >
                    {checked && <CheckCircle size={12} weight="bold" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium" title={doc.filename}>
                      {doc.filename}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-faint">
                      <span className="inline-flex items-center gap-1.5 font-mono">
                        <StatusDot status={doc.status} />
                        {doc.status}
                      </span>
                      {doc.page_count > 0 && <span>{doc.page_count} pages</span>}
                      <span>{formatDate(doc.created_at)}</span>
                    </div>
                    {doc.ocr_warning === 1 && doc.status === "ready" && (
                      <Chip tone="warn" className="mt-2">
                        <Warning size={10} weight="fill" /> Low-confidence extraction (OCR)
                      </Chip>
                    )}
                    {doc.status === "failed" && doc.error && (
                      <p className="mt-2 text-xs leading-relaxed text-danger">{doc.error}</p>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${doc.filename}`}
                    onClick={() => void handleDelete(doc.id)}
                    className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  >
                    <Trash size={14} weight="light" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {readyDocs.length > 0 && (
        <p className="mt-6 text-center text-xs text-ink-faint">
          {readyDocs.length === 1
            ? "1 document ready"
            : `${readyDocs.length} documents ready`}{" "}
          · selections carry over to{" "}
          <button onClick={() => router.push("/")} className="text-accent underline-offset-2 hover:underline">
            Chat
          </button>
        </p>
      )}
    </div>
  );
}
