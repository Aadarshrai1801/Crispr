import { describe, it, expect } from "vitest";
import {
  insertChatSession,
  getChatSession,
  listChatSessions,
  insertChatMessage,
  listChatMessages,
  renameChatSession,
  archiveChatSession,
  deleteChatSession,
  touchChatSession,
} from "@/lib/db";
import { serializeSession, serializeMessage } from "@/lib/chat";

describe("persistent chat sessions (Phase 1)", () => {
  it("creates, lists and renames a session scoped to user + workspace", async () => {
    const s = await insertChatSession({ user_id: "u1", workspace_id: "ws_default", document_ids: ["d1"] });
    expect(s.title).toBe("New chat");
    expect((await getChatSession(s.id))?.id).toBe(s.id);

    // Other user's sessions are isolated per user.
    await insertChatSession({ user_id: "u2", workspace_id: "ws_default" });
    const mine = await listChatSessions("u1", "ws_default");
    expect(mine.some((x) => x.id === s.id)).toBe(true);
    expect((await listChatSessions("u2", "ws_default")).some((x) => x.id === s.id)).toBe(false);

    await renameChatSession(s.id, "Quarterly review");
    expect((await getChatSession(s.id))?.title).toBe("Quarterly review");
  });

  it("appends messages in order and serializes to the DTO shape", async () => {
    const s = await insertChatSession({ user_id: "u1", workspace_id: "ws_default" });
    await insertChatMessage({ session_id: s.id, role: "user", content: { question: "What are the terms?" } });
    await insertChatMessage({
      session_id: s.id,
      role: "assistant",
      content: { result: { query_log_id: "q1", answer: "30 days net" } },
      query_log_id: "q1",
    });
    const msgs = await listChatMessages(s.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(JSON.parse(msgs[1].content).result.answer).toBe("30 days net");

    const dto = serializeMessage(msgs[1]);
    expect(dto.query_log_id).toBe("q1");
    expect((dto.content as { result: { answer: string } }).result.answer).toBe("30 days net");
  });

  it("touches last_message_at and serializes a session with message count", async () => {
    const s = await insertChatSession({ user_id: "u1", workspace_id: "ws_default" });
    await touchChatSession(s.id, ["d1", "d2"]);
    const after = (await getChatSession(s.id))!;
    expect(after.last_message_at).not.toBeNull();
    expect(JSON.parse(after.document_ids)).toEqual(["d1", "d2"]);
    const dto = serializeSession(after, 3);
    expect(dto.message_count).toBe(3);
    expect(dto.document_ids).toEqual(["d1", "d2"]);
  });

  it("archives and hard-deletes sessions with their messages", async () => {
    const s = await insertChatSession({ user_id: "u1", workspace_id: "ws_default" });
    await insertChatMessage({ session_id: s.id, role: "user", content: { question: "x" } });

    await archiveChatSession(s.id);
    expect((await getChatSession(s.id))?.status).toBe("archived");
    expect((await listChatSessions("u1", "ws_default")).some((x) => x.id === s.id)).toBe(false);

    await deleteChatSession(s.id);
    expect(await getChatSession(s.id)).toBeUndefined();
    expect(await listChatMessages(s.id)).toHaveLength(0);
  });
});
