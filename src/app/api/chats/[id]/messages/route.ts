import { z } from "zod";
import { NextResponse } from "next/server";
import { getChatSession, insertChatMessage, listChatMessages, renameChatSession, touchChatSession } from "@/lib/db";
import { requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";
import { serializeSession } from "@/lib/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MessagesSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.unknown(),
        query_log_id: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(20),
});

/** POST /api/chats/{id}/messages — append user/assistant messages to a session. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const session = await getChatSession(id);
    if (!session) return NextResponse.json({ error: "Chat session not found" }, { status: 404 });

    const ctx = await requireContext(request, session.workspace_id);
    if (session.user_id !== ctx.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = MessagesSchema.parse(await request.json());
    for (const m of body.messages) {
      await insertChatMessage({
        session_id: id,
        role: m.role,
        content: m.content,
        query_log_id: m.query_log_id ?? null,
      });
    }
    // Derive a title from the first user message if it's still the placeholder.
    const current = (await getChatSession(id))!;
    if (current.title === "New chat") {
      const u = body.messages.find((m) => m.role === "user");
      if (u && typeof u.content === "object" && u.content && "question" in u.content) {
        const q = (u.content as { question?: unknown }).question;
        if (typeof q === "string" && q.trim()) {
          await renameChatSession(id, q.trim().slice(0, 60));
        }
      }
    }
    const docIds: string[] = current.document_ids ? JSON.parse(current.document_ids) : [];
    await touchChatSession(id, docIds);

    const n = (await listChatMessages(id)).length;
    return json({ session: serializeSession((await getChatSession(id))!, Math.max(1, Math.ceil(n / 2))) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    return apiError(err);
  }
}
