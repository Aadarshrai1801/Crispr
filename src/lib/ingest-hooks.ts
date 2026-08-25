/**
 * Debounced background hooks shared by API routes. Kept separate from ingest.ts
 * to avoid import cycles between the feedback path and the suggestion engine.
 */

declare global {
  // eslint-disable-next-line no-var
  var __crispFlagAnalysisTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

export function scheduleRepeatedFlagAnalysis(workspaceId: string, delayMs = 45_000) {
  globalThis.__crispFlagAnalysisTimers ??= new Map();
  const timers = globalThis.__crispFlagAnalysisTimers;
  const existing = timers.get(workspaceId);
  if (existing) clearTimeout(existing);
  timers.set(
    workspaceId,
    setTimeout(() => {
      timers.delete(workspaceId);
      void (async () => {
        try {
          const { generateRepeatedFlagSuggestions } = await import("./suggestions");
          const created = await generateRepeatedFlagSuggestions(workspaceId);
          if (created > 0) console.log(`[suggestions] ${workspaceId}: ${created} repeated-flag suggestion(s) generated`);
        } catch (err) {
          console.warn("[suggestions] analysis failed:", err instanceof Error ? err.message : err);
        }
      })();
    }, delayMs)
  );
}
