import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Blocker #7: Turbopack dev artifacts in .next make a subsequent `next build`
 * fail with PageNotFoundError. Always build from a clean slate — this script
 * is wired into the `build` npm script so CI and local builds behave the same.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
rmSync(path.join(root, ".next"), { recursive: true, force: true });
console.log("[clean] removed .next");
