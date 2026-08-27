import { z } from "zod";
import { deleteWorkspaceCascade, listCorrections, listDocuments, updateWorkspaceSettings } from "@/lib/db";
import { deleteVectorsForDocument, removeCorrectionVector } from "@/lib/vector";
import { deleteDocumentFile } from "@/lib/ingest";
import { audit } from "@/lib/audit";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  approval_required: z.boolean().optional(), // FR-33
  confidence_threshold: z.number().min(0).max(1).optional(), // FR-42
  plan_tier: z.enum(["free", "pro", "team", "enterprise"]).optional(),
});

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    return json({ workspace: ctx.workspace, role: ctx.role });
  } catch (err) {
    return apiError(err);
  }
}

/** Admin-only settings updates (FR-33 approval mode, FR-42 threshold, tier). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());
    const ctx = requireContext(request, id);
    requireAdmin(ctx);
    updateWorkspaceSettings(id, body);
    audit.write(
      id,
      ctx.userId,
      "workspace.updated",
      "workspace",
      id,
      {
        name: ctx.workspace.name,
        approval_required: Boolean(ctx.workspace.approval_required),
        confidence_threshold: ctx.workspace.confidence_threshold,
        plan_tier: ctx.workspace.plan_tier,
      },
      body
    );
    const { getWorkspace } = await import("@/lib/db");
    return json({ workspace: getWorkspace(id) });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * Admin-only, irreversible workspace teardown. Cascades documents (files +
 * vector rows), corrections, members and all auxiliary tables. The seeded
 * default workspace is protected — every account needs a home to fall back to.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    requireAdmin(ctx);
    if (id === "ws_default") {
      return json({ error: "The default workspace cannot be deleted." }, 403);
    }

    const docs = listDocuments(id);
    for (const doc of docs) {
      await deleteVectorsForDocument(doc.id).catch(() => undefined);
      if (doc.storage_path) deleteDocumentFile(doc.storage_path);
      const path = await import("node:path");
      const rm = await import("node:fs/promises");
      await rm
        .rm(path.join(doc.storage_path, "..", "versions", doc.id), { recursive: true, force: true })
        .catch(() => undefined);
    }

    const corrections = listCorrections(id);
    for (const c of corrections) {
      await removeCorrectionVector(c.id).catch(() => undefined);
    }

    // Audit before the cascade erases the trail — best-effort record elsewhere.
    audit.write("ws_default", ctx.userId, "workspace.updated", "workspace", id, { name: ctx.workspace.name }, { deleted: true });

    deleteWorkspaceCascade(id);
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
