import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Background pipelines intentionally log-and-continue; the central
      // apiError mapper is the single allowed console.error for request paths.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          // Destructure-strip convention (`const { storage_path: _sp, ...safe }`) is intentional.
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "data/**", "public/pdf.worker.min.mjs"],
  },
];

export default eslintConfig;
