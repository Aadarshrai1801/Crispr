import Groq from "groq-sdk";
import { config } from "./config";
import { normalizeCitationMarkers } from "./utils";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("GROQ_API_KEY is not set. Add it to .env.local — see .env.example for reference.");
    this.name = "LlmNotConfiguredError";
  }
}

let client: Groq | null = null;

export function getGroqClient(): Groq {
  if (!config.groqApiKey) throw new LlmNotConfiguredError();
  client ??= new Groq({ apiKey: config.groqApiKey });
  return client;
}

export interface GroundedAnswerRequest {
  question: string;
  /** Numbered context blocks already formatted with document name + page labels. */
  contexts: string[];
  strict?: boolean;
  documentNames: string[];
}

export const GROUNDING_SYSTEM_PROMPT = `You are a precise document Q&A assistant. You answer questions using ONLY the numbered context passages provided by the user.

Rules:
1. Every factual claim must be traceable to a specific context passage. Cite inline immediately after the claim using the passage number in plain ASCII square brackets, e.g. [2] or [2][5]. Never use fullwidth or decorative brackets (no 【2】, no （2）).
2. Never invent facts, numbers, names, or citations that are not present in the passages.
3. If the passages do not contain enough information to answer, reply EXACTLY: "This question cannot be answered from the uploaded document(s)." followed by one short sentence explaining what is missing.
4. Quote figures, dates, and defined terms verbatim from the passages.
5. Be concise: lead with the direct answer, then at most 3 short supporting sentences.`;

export async function generateGroundedAnswer(req: GroundedAnswerRequest): Promise<string> {
  const groq = getGroqClient();
  const strictAddendum =
    req.strict === true
      ? "\n\nSTRICTNESS: A previous answer for this same question was rejected as incorrect. Re-read every passage carefully and prefer the passage whose details most directly address the exact wording of the question. Do not reuse the rejected reasoning."
      : "";
  const userContent = [
    `Document(s): ${req.documentNames.join(", ")}`,
    "",
    "Context passages:",
    ...req.contexts.map((c, i) => `[${i + 1}] ${c}`),
    "",
    `Question: ${req.question}`,
    strictAddendum,
    "",
    "Answer with inline [n] citations, or state plainly that the documents do not contain the answer.",
  ].join("\n");

  const completion = (await groq.chat.completions.create({
    model: config.groqModel,
    temperature: req.strict ? 0 : 0.1,
    // Reasoning models (gpt-oss) spend completion budget on internal reasoning;
    // keep effort low for this extraction task and leave headroom so the cited
    // answer itself is never truncated.
    ...(isReasoningModel(config.groqModel) ? { reasoning_effort: "low" } : {}),
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: GROUNDING_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  } as Parameters<Groq["chat"]["completions"]["create"]>[0])) as Groq.Chat.ChatCompletion;
  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  return normalizeCitationMarkers(raw);
}

function isReasoningModel(model: string): boolean {
  return /gpt-oss|qwen|deepseek/i.test(model);
}

/* ------------------------------------------------------------------ */
/* v2 helpers                                                          */
/* ------------------------------------------------------------------ */

/** FR-43: batch verdict on whether passage pairs make conflicting factual claims. */
export async function generateConflictVerdicts(
  pairs: Array<{ index: number; passageA: string; passageB: string }>
): Promise<Array<{ index: number; conflicting: boolean; rationale?: string }>> {
  const groq = getGroqClient();
  const content = [
    "You are a document consistency auditor. For each numbered pair of passages from DIFFERENT documents, decide whether they make CONFLICTING factual claims about the same subject (different values, dates, percentages, procedures, or rules for the same thing).",
    "Superficial topic overlap without a factual contradiction is NOT a conflict. Different scopes/jurisdictions explicitly stated are NOT conflicts.",
    "",
    ...pairs.flatMap((p) => [`PAIR ${p.index}:`, p.passageA, "---", p.passageB, ""]),
    'Respond ONLY with a JSON array like [{"index":1,"conflicting":true,"rationale":"one short sentence explaining the contradiction"}]. Include every pair index.',
  ].join("\n");

  const completion = (await groq.chat.completions.create({
    model: config.groqModel,
    temperature: 0,
    ...(isReasoningModel(config.groqModel) ? { reasoning_effort: "low" } : {}),
    max_completion_tokens: 2048,
    messages: [{ role: "user", content }],
  } as Parameters<Groq["chat"]["completions"]["create"]>[0])) as Groq.Chat.ChatCompletion;

  const raw = completion.choices[0]?.message?.content ?? "[]";
  const jsonText = raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1);
  const parsed = JSON.parse(jsonText) as Array<{ index: number; conflicting: boolean; rationale?: string }>;
  return Array.isArray(parsed) ? parsed : [];
}

/** FR-51: synthesize a draft correction for a repeatedly-flagged question from retrieved context. */
export async function generateSuggestedAnswer(question: string, contexts: string[]): Promise<string> {
  const groq = getGroqClient();
  const content = [
    "Context passages:",
    ...contexts.map((c, i) => `[${i + 1}] ${c}`),
    "",
    `Question (flagged as answered incorrectly multiple times): ${question}`,
    "",
    "Draft the best-supported answer using ONLY the passages above. Cite with [n]. If the passages genuinely do not answer it, reply exactly: INSUFFICIENT_CONTEXT.",
  ].join("\n");

  const completion = (await groq.chat.completions.create({
    model: config.groqModel,
    temperature: 0.1,
    ...(isReasoningModel(config.groqModel) ? { reasoning_effort: "low" } : {}),
    max_completion_tokens: 1024,
    messages: [
      {
        role: "system",
        content:
          "You draft candidate corrections for a self-correcting Q&A system. Be precise, concise, and strictly grounded in the provided passages.",
      },
      { role: "user", content },
    ],
  } as Parameters<Groq["chat"]["completions"]["create"]>[0])) as Groq.Chat.ChatCompletion;

  return normalizeCitationMarkers(completion.choices[0]?.message?.content?.trim() ?? "");
}
