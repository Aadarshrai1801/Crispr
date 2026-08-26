import type { NextConfig } from "next";

/**
 * Nice-to-have #4: defense-in-depth headers. TLS termination stays at the
 * ingress (documented in README), but browsers get explicit instructions even
 * behind trusted proxies. The public REST API additionally gets an explicit,
 * credential-free CORS policy (Bearer-token auth only — no cookies cross-origin).
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injects inline hydration scripts; styles come from Tailwind's stylesheet.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Public API: token-authenticated (never cookie-authenticated), so a
        // permissive origin is safe and enables browser-based API consumers.
        source: "/api/public/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
          { key: "Access-Control-Max-Age", value: "86400" },
          ...securityHeaders.filter((h) => h.key !== "X-Frame-Options"),
        ],
      },
    ];
  },
};

export default nextConfig;
