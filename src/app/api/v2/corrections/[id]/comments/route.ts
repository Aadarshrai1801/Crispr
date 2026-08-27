import { z } from "zod";
import { getCorrection, insertComment, listComments } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireContext, requireContributor } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  body: z.string().min(1).max(4000),
});

/**
 * FR-35: threaded comment discussion per correction, visible to everyone with
 * at least Viewer access to the workspace; posting needs Contributor+.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await getCorrection(id);
    if (!existing) return json({ error: "Correction not found" }, 404);
    await requireContext(request, existing.workspace_id);
    return json({ comments: await listComments(id) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const existing = await getCorrection(id);
    if (!existing) return json({ error: "Correction not found" }, 404);
    const ctx = await requireContext(request, existing.workspace_id);
    requireContributor(ctx);

    const comment = await insertComment(id, ctx.userId, body.body.trim());
    await audit.write(existing.workspace_id, ctx.userId, "comment.added", "correction", id, null, {
      comment_id: comment.id,
    });
    return json({ comment }, 201);
  } catch (err) {
    return apiError(err);
  }
}
