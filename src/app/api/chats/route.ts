import { z } from "zod";
import { NextResponse } from "next/server";
import { insertChatSession, listChatMessages, listChatSessions } from "@/lib/db";
import { requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";
import { serializeSession } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveWorkspaceId(request: Request): string {
  return (
    request.headers.get("x-crisp-workspace-id") ??
    new URL(request.url).searchParams.get("workspace_id") ??
    "ws_default"
  );
}

const CreateSchema = z.object({
  title: z.string().max(200).optional(),
  document_ids: z.array(z.string()).max(200).optional(),
});

/** GET /api/chats — the current user's active sessions in the active workspace. */
export async function GET(request: Request) {
  try {
    const wsId = resolveWorkspaceId(request);
    const ctx = await requireContext(request, wsId);

    const sessions = await listChatSessions(ctx.userId, ctx.workspace.id);
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const n = (await listChatMessages(s.id)).length;
      counts.set(s.id, n > 0 ? Math.max(1, Math.ceil(n / 2)) : 0);
    }
    return json({
      sessions: sessions.map((s) => serializeSession(s, counts.get(s.id) ?? 0)),
    });
  } catch (err) {
    return apiError(err);
  }
}

/** POST /api/chats — create a session for the current user. */
export async function POST(request: Request) {
  try {
    const wsId = resolveWorkspaceId(request);
    const ctx = await requireContext(request, wsId);
    const body = CreateSchema.parse(await request.json());

    const session = await insertChatSession({
      user_id: ctx.userId,
      workspace_id: ctx.workspace.id,
      title: body.title ?? "New chat",
      document_ids: body.document_ids ?? [],
    });

    return json({ session: serializeSession(session, 0) }, 201);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    return apiError(err);
  }
}
