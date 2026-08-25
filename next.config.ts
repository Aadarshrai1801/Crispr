import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@lancedb/lancedb",
    "@huggingface/transformers",
    "onnxruntime-node",
    "tesseract.js",
    "@napi-rs/canvas",
    "unpdf",
    "pdfjs-dist",
  ],
};

export default nextConfig;
