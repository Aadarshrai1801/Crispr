import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadsDir } from "@/lib/config";
import {
  getDocument,
  insertDocumentVersion,
  listCorrectionsNeedingVersionReview,
  listDocumentVersions,
  setNeedsVersionReview,
  updateDocumentStatus,
} from "@/lib/db";
import { extractAnyDocument } from "@/lib/formats";
import { enqueueIngestion, scheduleConflictScan } from "@/lib/ingest";
import { audit } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { requireContext, requireContributor } from "@/lib/rbac";
import { apiError } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/* ------------------------- text diffing helpers ------------------------- */

interface SectionDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Splits extracted page text into pseudo-sections keyed by detected headings or paragraph blocks. */
function splitSections(pages: Array<{ pageNumber: number; text: string }>): Map<string, string> {
  const sections = new Map<string, string>();
  let currentHeading = "Preamble";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) sections.set(currentHeading, ((sections.get(currentHeading) ?? "") + "\n" + body).trim());
    buffer = [];
  };

  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const t = line.trim();
      const isHeading =
        t.length > 0 &&
        t.length < 90 &&
        !/[.,;]$/.test(t) &&
        (/^\d+(\.\d+)*[.)]?\s+\S/.test(t) || t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(/\s+/).length <= 10);
      if (isHeading) {
        flush();
        currentHeading = t;
        // Disambiguate repeated headings across pages
        if (sections.has(currentHeading)) currentHeading = `${t} (p.${page.pageNumber})`;
        continue;
      }
      if (t) buffer.push(t);
    }
  }
  flush();
  return sections;
}

function diffSections(oldSections: Map<string, string>, newSections: Map<string, string>): SectionDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const matchedNew = new Set<string>();

  for (const [heading, oldText] of oldSections) {
    if (newSections.has(heading)) {
      matchedNew.add(heading);
      if (jaccard(tokenize(oldText), tokenize(newSections.get(heading)!)) < 0.92) {
        modified.push(heading);
      }
      continue;
    }
    // Fuzzy-match renamed/relocated sections by content overlap.
    let bestHeading: string | null = null;
    let bestScore = 0;
    for (const [h2, t2] of newSections) {
      if (matchedNew.has(h2)) continue;
      const score = jaccard(tokenize(oldText), tokenize(t2));
      if (score > bestScore) {
        bestScore = score;
        bestHeading = h2;
      }
    }
    if (bestHeading && bestScore >= 0.75) {
      matchedNew.add(bestHeading);
      if (bestScore < 0.98) modified.push(`${heading} → ${bestHeading}`);
    } else {
      removed.push(heading);
    }
  }
  for (const heading of newSections.keys()) {
    if (!matchedNew.has(heading)) added.push(heading);
  }
  return { added, removed, modified };
}

/* ------------------------------ routes ------------------------------ */

/** Version history for a document (newest first). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const doc = getDocument(id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    await requireContext(request, doc.workspace_id);
    const versions = listDocumentVersions(id).map((v) => ({ ...v, storage_path: undefined }));
    return NextResponse.json({
      versions,
      current_version_number: doc.version_number,
      corrections_needing_review: listCorrectionsNeedingVersionReview(doc.workspace_id).filter((c) => c.document_id === id),
    });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * FR-39: upload a new version of a previously-ingested document.
 * Detects the prior version, produces a material-changes diff summary, flags
 * affected corrections for review, re-ingests, and notifies webhooks.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const doc = getDocument(id);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const ctx = requireContext(request, doc.workspace_id);
    requireContributor(ctx);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Missing file field" }, { status: 400 });
    if (file.size > 200 * 1024 * 1024) return NextResponse.json({ error: "File exceeds the 200MB limit." }, { status: 413 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // Extract BOTH texts for the diff before touching anything.
    const oldBuffer = await readFile(doc.storage_path);
    const oldExtract = await extractAnyDocument(oldBuffer, doc.filename);
    const newExtract = await extractAnyDocument(buffer, file.name);

    const diff = diffSections(splitSections(oldExtract.pages), splitSections(newExtract.pages));
    const materialChanges = diff.added.length + diff.removed.length + diff.modified.length;

    const nextVersion = doc.version_number + 1;

    // Archive the current file under its version number, then replace it.
    const versionsDir = path.join(uploadsDir(), "versions", id);
    mkdirSync(versionsDir, { recursive: true });
    const ext = path.extname(doc.filename).toLowerCase() || ".bin";
    const archivedPath = path.join(versionsDir, `v${doc.version_number}${ext}`);
    await copyFile(doc.storage_path, archivedPath);

    const hash = createHash("sha256").update(buffer).digest("hex");
    await writeFile(doc.storage_path, buffer);

    const diffSummary = {
      ...diff,
      stats: {
        previous_version: doc.version_number,
        pages_before: oldExtract.pageCount,
        pages_after: newExtract.pageCount,
        material_changes: materialChanges,
      },
    };

    const version = insertDocumentVersion({
      document_id: id,
      version_number: nextVersion,
      uploaded_by: ctx.userId,
      diff_summary: JSON.stringify(diffSummary),
      storage_path: archivedPath,
      file_hash: hash,
      page_count: newExtract.pageCount,
    });

    updateDocumentStatus(id, {
      filename: file.name,
      file_hash: hash,
      status: "processing",
      error: null,
      current_version_id: version.id,
      version_number: nextVersion,
    });

    // FR-39: prompt review of whether existing corrections still apply.
    const affected = listCorrectionsNeedingVersionReview(doc.workspace_id)
      .filter((c) => c.document_id === id)
      .map((c) => c.id);
    const allDocCorrections = (
      await import("@/lib/db")
    ).listCorrections(doc.workspace_id, id).filter((c) => ["active", "pending"].includes(c.status));
    for (const c of allDocCorrections) setNeedsVersionReview(c.id, true);

    enqueueIngestion(id);
    scheduleConflictScan(doc.workspace_id);

    audit.write(doc.workspace_id, ctx.userId, "document.version_updated", "document", id,
      { version: doc.version_number },
      { version: nextVersion, filename: file.name, material_changes: materialChanges });
    dispatchWebhook("document.version_updated", doc.workspace_id, {
      document_id: id,
      version: nextVersion,
      filename: file.name,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      corrections_flagged_for_review: allDocCorrections.length,
    });

    void affected;
    return NextResponse.json(
      {
        version: { ...version, storage_path: undefined },
        diff_summary: diffSummary,
        corrections_needing_review: allDocCorrections.map((c) => ({
          id: c.id,
          question_text: c.question_text,
        })),
      },
      { status: 202 }
    );
  } catch (err) {
    return apiError(err);
  }
}
