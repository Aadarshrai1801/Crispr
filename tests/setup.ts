import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Runs before every test file (each file gets a fresh forked worker):
 * - point DATA_DIR at a throwaway temp dir so tests never touch ./data
 * - force non-production mode so validateProductionEnv() stays out of the way
 *
 * Must run BEFORE any app module is imported by the test file.
 */
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "crispr-test-"));
