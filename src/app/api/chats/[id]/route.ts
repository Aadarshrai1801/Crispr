import { z } from "zod";
import { NextResponse } from "next/server";
import { deleteChatSession, getChatSession, listChatMessages, renameChatSession } from "@/lib/db";
import { requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";
import { serializeMessage, serializeSession } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({ title: z.string().min(1).max(200) });

/**
 * Load a session and verify the requester owns it inside the active workspace.
 * Returns the session metadata + all messages so the client can resume a thread.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await getChatSession(id);
    if (!session) return NextResponse.json({ error: "Chat session not found" }, { status: 404 });

    const wsId =
      request.headers.get("x-crisp-workspace-id") ??
      new URL(request.url).searchParams.get("workspace_id") ??
      session.workspace_id;
    const ctx = await requireContext(request, wsId);
    if (session.workspace_id !== ctx.workspace.id || session.user_id !== ctx.userId) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const messages = await listChatMessages(session.id);
    return json({
      session: serializeSession(session, Math.max(1, Math.ceil(messages.length / 2))),
      messages: messages.map(serializeMessage),
    });
  } catch (err) {
    return apiError(err);
  }
}

/** PATCH /api/chats/{id} — rename a session. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = PatchSchema.parse(await request.json());

    const session = await getChatSession(id);
    if (!session) return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    const wsId = session.workspace_id;
    const ctx = await requireContext(request, wsId);
    if (session.user_id !== ctx.userId) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    await renameChatSession(id, body.title);
    const n = (await listChatMessages(id)).length;
    return json({ session: serializeSession((await getChatSession(id))!, Math.max(1, Math.ceil(n / 2))) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    return apiError(err);
  }
}

/** DELETE /api/chats/{id} — hard-delete a session and its messages. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await getChatSession(id);
    if (!session) return NextResponse.json({ ok: true });

    const ctx = await requireContext(request, session.workspace_id);
    if (session.user_id !== ctx.userId && ctx.role !== "Admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await deleteChatSession(id);
    return json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
