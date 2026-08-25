"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  CheckCircle,
  FileText,
  LinkSimple,
  Plus,
  Trash,
  Warning,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { api, type DocumentDto, type VersionDiffSummary } from "@/lib/client/api";
import { useActiveDocuments } from "@/lib/client/use-active-documents";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Skeleton, StatusDot } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

type UploadState = { name: string; file: File; error?: string; duplicateOf?: DocumentDto };

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.eml,.msg,application/pdf";

interface VersionResult {
  version: { id: string; version_number: number };
  diff_summary: VersionDiffSummary;
  corrections_needing_review: Array<{ id: string; question_text: string }>;
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const versionInputRef = useRef<HTMLInputElement>(null);
  const [versionTarget, setVersionTarget] = useState<DocumentDto | null>(null);
  const [versionResult, setVersionResult] = useState<VersionResult | null>(null);
  const [versionBusy, setVersionBusy] = useState(false);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const { activeIds, setActiveIds, hydrated } = useActiveDocuments();
  const router = useRouter();

  const load = useCallback(() => api.listDocuments().then(setDocs).catch(() => setDocs([])), []);

  useEffect(() => {
    void load();
  }, [load]);

  // FR-49 support: browser extension hands off a PDF URL via /documents?fetch_url=
  useEffect(() => {
    const fetchUrl = new URLSearchParams(window.location.search).get("fetch_url");
    if (!fetchUrl) return;
    setFetchNotice(`Ingesting from URL… ${fetchUrl}`);
    api
      .fetchUrl(fetchUrl)
      .then((d) => {
        setFetchNotice(
          d.already_ingested ? `Already in your library as “${d.filename}”.` : `Ingesting “${d.filename}” from the link…`
        );
        router.replace("/documents");
        void load();
      })
      .catch((err) => {
        setFetchNotice(err instanceof Error ? err.message : "Could not ingest that URL");
        router.replace("/documents");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            Upload PDFs, Word, Excel, and email exports to query them. Select which ones are active in chat.
          </p>
        </div>
        {anyProcessing && (
          <Chip tone="warn">
            <ArrowClockwise size={11} className="animate-spin" /> Ingesting…
          </Chip>
        )}
      </header>

      {fetchNotice && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[13px] text-accent-strong">
          <LinkSimple size={15} className="shrink-0" /> {fetchNotice}
        </div>
      )}

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
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
        <Plus size={20} weight="light" className="mx-auto mb-2 text-ink-faint" />
        <p className="text-[13px] font-medium">Drop files here or click to browse</p>
        <p className="mt-1 text-xs text-ink-faint">
          PDF · DOCX · XLSX · EML · MSG — up to 200MB. Tables are preserved; scanned pages fall back to OCR.
        </p>
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
                      <span>v{doc.version_number}</span>
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

                  <div className="flex shrink-0 flex-col items-end gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Upload a new version of this document"
                      disabled={doc.status !== "ready" || versionBusy}
                      onClick={() => {
                        setVersionTarget(doc);
                        setVersionResult(null);
                        setTimeout(() => versionInputRef.current?.click(), 0);
                      }}
                    >
                      <ArrowClockwise size={13} weight="light" /> New version
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${doc.filename}`}
                      onClick={() => void handleDelete(doc.id)}
                    >
                      <Trash size={14} weight="light" />
                    </Button>
                  </div>
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

      {/* Hidden input for new-version uploads (FR-39) */}
      <input
        ref={versionInputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || !versionTarget) return;
          setVersionBusy(true);
          api
            .uploadNewVersion(versionTarget.id, file)
            .then((res) => setVersionResult(res))
            .catch((err) => setErrorBanner(err instanceof Error ? err.message : "Version upload failed"))
            .finally(() => {
              setVersionBusy(false);
              void load();
            });
        }}
      />
      {errorBanner && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-danger/25 bg-danger-soft px-4 py-2.5 text-[13px] text-danger shadow-[var(--shadow-card)]">
          {errorBanner}
        </div>
      )}

      {/* Version diff modal */}
      {versionResult && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && setVersionResult(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-sm font-semibold">
              New version detected — {versionResult.version.version_number > 0 && `v${versionResult.version.version_number} uploaded`}
            </h2>
            {(() => {
              const d = versionResult.diff_summary;
              return (
                <>
                  <p className="mt-1 text-xs text-ink-faint">
                    {d.stats.material_changes} material change{d.stats.material_changes === 1 ? "" : "s"} ·{" "}
                    {d.stats.pages_before} → {d.stats.pages_after} pages
                  </p>
                  <DiffList label="Added sections" items={d.added} tone="accent" emptyText="No new sections." />
                  <DiffList label="Removed sections" items={d.removed} tone="danger" emptyText="Nothing removed." />
                  <DiffList label="Modified sections" items={d.modified} tone="warn" emptyText="No modified sections." />
                </>
              );
            })()}

            <div className="mt-4 rounded-xl border border-line bg-bg/60 p-3">
              <p className="text-xs font-medium">Corrections to review ({versionResult.corrections_needing_review.length})</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                Existing corrections on this document are flagged for review — confirm whether each still applies, is now
                resolved by the update, or needs re-flagging. Manage them from the Corrections page.
              </p>
              <ul className="mt-2 space-y-1">
                {versionResult.corrections_needing_review.slice(0, 5).map((c) => (
                  <li key={c.id} className="truncate text-[11px] text-ink-soft">“{c.question_text}”</li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setVersionResult(null)}>Close</Button>
              <Button variant="primary" onClick={() => router.push("/corrections")}>
                Review corrections
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffList({ label, items, tone, emptyText }: { label: string; items: string[]; tone: "accent" | "danger" | "warn"; emptyText: string }) {
  return (
    <div className="mt-3">
      <p className={cn("font-mono text-[9px] uppercase tracking-wider", tone === "accent" && "text-accent-strong", tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>
        {label} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-faint">{emptyText}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {items.slice(0, 8).map((s) => (
            <li key={s} className="truncate rounded-md bg-surface-2 px-2 py-1 text-[11px] text-ink-soft" title={s}>
              {s}
            </li>
          ))}
          {items.length > 8 && <li className="text-[11px] text-ink-faint">+{items.length - 8} more…</li>}
        </ul>
      )}
    </div>
  );
}
