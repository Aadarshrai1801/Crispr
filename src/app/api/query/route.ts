import { NextResponse } from "next/server";
import { z } from "zod";
import { answerQuestion } from "@/lib/retrieval";
import { defaultUserId, defaultWorkspaceId, getDocument } from "@/lib/db";
import { LlmNotConfiguredError } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  document_ids: z.array(z.string()).min(1),
  question: z.string().min(3).max(2000),
});

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());

    const readyDocs = body.document_ids.filter((id) => getDocument(id)?.status === "ready");
    if (!readyDocs.length) {
      return NextResponse.json(
        { error: "None of the selected documents are ready yet. Wait for processing to finish." },
        { status: 409 }
      );
    }

    const payload = await answerQuestion({
      workspaceId: defaultWorkspaceId(),
      userId: defaultUserId(),
      documentIds: readyDocs,
      question: body.question,
    });
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request", details: err.issues }, { status: 400 });
    }
    console.error("[query.POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 }
    );
  }
}
