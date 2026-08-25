"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { CaretLeft, CaretRight, FilePdf, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface ViewerTarget {
  documentId: string;
  documentName: string;
  page: number;
}

export default function PdfViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(target.page);
  const [width, setWidth] = useState(520);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPage(target.page), [target.page, target.documentId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(280, Math.floor(w) - 32));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <FilePdf size={14} weight="light" className="shrink-0 text-accent" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{target.documentName}</p>
        <div className="flex items-center gap-0.5 font-mono text-[11px] text-ink-soft">
          <button
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="focus-ring rounded-md p-1 hover:bg-surface-hover disabled:opacity-30"
          >
            <CaretLeft size={12} weight="bold" />
          </button>
          <span className="tabular-nums">
            {page}
            {numPages ? ` / ${numPages}` : ""}
          </span>
          <button
            aria-label="Next page"
            disabled={!!numPages && page >= numPages}
            onClick={() => setPage((p) => p + 1)}
            className="focus-ring rounded-md p-1 hover:bg-surface-hover disabled:opacity-30"
          >
            <CaretRight size={12} weight="bold" />
          </button>
        </div>
        <Button variant="ghost" size="sm" aria-label="Close viewer" onClick={onClose}>
          <X size={13} weight="bold" />
        </Button>
      </header>

      <div ref={containerRef} className="flex-1 overflow-auto bg-bg p-4">
        <Document
          file={`/api/files/${target.documentId}`}
          onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
          loading={
            <div className="space-y-3 py-6">
              <Skeleton className="mx-auto h-3 w-40" />
              <Skeleton className="h-[640px] w-full" />
            </div>
          }
          error={<p className="py-10 text-center text-xs text-danger">Could not load this PDF.</p>}
        >
          <Page
            pageNumber={page}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<Skeleton className="h-[640px] w-full" />}
          />
        </Document>
      </div>
    </div>
  );
}
