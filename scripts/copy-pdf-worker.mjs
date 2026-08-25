import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));

try {
  const pdfjsDistRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const src = join(pdfjsDistRoot, "build", "pdf.worker.min.mjs");
  if (!existsSync(src)) throw new Error("worker file missing");
  const destDir = join(root, "..", "public");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, join(destDir, "pdf.worker.min.mjs"));
} catch (err) {
  console.warn("[postinstall] pdf worker copy skipped:", err instanceof Error ? err.message : err);
}
