import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Blocker #3: SSRF protection for server-initiated fetches of user-supplied
 * URLs. Validates scheme, port, and the resolved IP address of EVERY host we
 * are about to contact — including every redirect hop (automatic redirect
 * following is disabled and re-validated manually).
 *
 * Known limitation (documented in SECURITY.md): classic DNS-rebinding TOCTOU
 * remains possible because fetch() re-resolves DNS after our check. Redirect-
 * based bypasses and literal-IP bypasses are fully covered.
 */

const ALLOWED_PORTS = new Set(["", "80", "443"]);
const MAX_REDIRECTS = 5;

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** True when the address must NOT be contacted from server-side fetches. */
export function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
  if (!net.isIPv6(ip)) return true; // unparseable -> refuse
  const lower = ip.toLowerCase();
  const bare = lower.replace(/^\[|\]$/g, "");
  if (bare === "::1" || bare === "::") return true; // loopback / unspecified
  if (bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true; // fc00::/7 unique local
  if (bare.startsWith("ff")) return true; // multicast
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4IsPrivate(mapped[1]);
  if (bare.startsWith("::ffff:")) return true; // other mapped forms -> refuse
  return false;
}

/**
 * Validate a URL for server-side fetching: http(s), standard port only,
 * hostname resolves exclusively to public addresses.
 * Throws Error with a user-safe message on any violation.
 */
export async function assertSafeRemoteUrl(urlStr: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new Error("Only standard ports (80/443) can be fetched.");
  }
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(url.hostname)) {
    throw new Error("This host cannot be fetched.");
  }

  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve the URL's hostname.");
  }
  if (!addresses.length || addresses.some((a) => isForbiddenIp(a.address))) {
    throw new Error("This URL points at a private or unreachable network address.");
  }
  return url;
}

/**
 * fetch() wrapper that re-validates every redirect target before following it.
 * Size/time caps remain the caller's responsibility (AbortSignal + body cap).
 */
export async function safeFetch(
  urlStr: string,
  init: RequestInit & { maxRedirects?: number } = {}
): Promise<Response> {
  const { maxRedirects = MAX_REDIRECTS, ...fetchInit } = init;
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertSafeRemoteUrl(current);
    const res = await fetch(url, { ...fetchInit, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("The URL redirected too many times.");
}
