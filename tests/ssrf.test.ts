import { describe, it, expect } from "vitest";
import { isForbiddenIp, assertSafeRemoteUrl } from "@/lib/ssrf";

describe("isForbiddenIp", () => {
  it("blocks loopback and unspecified", () => {
    expect(isForbiddenIp("127.0.0.1")).toBe(true);
    expect(isForbiddenIp("127.9.9.9")).toBe(true);
    expect(isForbiddenIp("0.0.0.0")).toBe(true);
    expect(isForbiddenIp("::1")).toBe(true);
    expect(isForbiddenIp("::")).toBe(true);
  });

  it("blocks link-local including cloud metadata endpoints", () => {
    expect(isForbiddenIp("169.254.169.254")).toBe(true);
    expect(isForbiddenIp("169.254.1.1")).toBe(true);
    expect(isForbiddenIp("fe80::1")).toBe(true);
  });

  it("blocks RFC1918 and other private ranges", () => {
    for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1"]) {
      expect(isForbiddenIp(ip), ip).toBe(true);
    }
    expect(isForbiddenIp("fd00::1")).toBe(true); // unique local
    expect(isForbiddenIp("fc00::abcd")).toBe(true);
    expect(isForbiddenIp("ff02::1")).toBe(true); // multicast
    expect(isForbiddenIp("224.0.0.1")).toBe(true);
    expect(isForbiddenIp("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped loopback
    expect(isForbiddenIp("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isForbiddenIp("8.8.8.8")).toBe(false);
    expect(isForbiddenIp("1.1.1.1")).toBe(false);
    expect(isForbiddenIp("2606:4700::1111")).toBe(false);
    expect(isForbiddenIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("refuses unparseable input", () => {
    expect(isForbiddenIp("not-an-ip")).toBe(true);
    expect(isForbiddenIp("")).toBe(true);
  });
});

describe("assertSafeRemoteUrl", () => {
  it("rejects non-http schemes", async () => {
    await expect(assertSafeRemoteUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertSafeRemoteUrl("ftp://example.com/x.pdf")).rejects.toThrow(/http/);
    await expect(assertSafeRemoteUrl("gopher://example.com")).rejects.toThrow(/http/);
  });

  it("rejects non-standard ports", async () => {
    await expect(assertSafeRemoteUrl("http://example.com:8080/a.pdf")).rejects.toThrow(/port/i);
    await expect(assertSafeRemoteUrl("http://example.com:22/a.pdf")).rejects.toThrow(/port/i);
  });

  it("rejects localhost-style hostnames without DNS", async () => {
    await expect(assertSafeRemoteUrl("http://localhost/a.pdf")).rejects.toThrow();
    await expect(assertSafeRemoteUrl("http://foo.internal/a.pdf")).rejects.toThrow();
    await expect(assertSafeRemoteUrl("http://bar.local/a.pdf")).rejects.toThrow();
  });

  it("accepts well-formed public http(s) URLs with resolvable hosts", async () => {
    const url = await assertSafeRemoteUrl("https://example.com/document.pdf");
    expect(url.hostname).toBe("example.com");
  });

  it("rejects malformed URLs and literal private IPs", async () => {
    await expect(assertSafeRemoteUrl("not a url")).rejects.toThrow();
    // Literal-IP lookups resolve offline — no network needed.
    await expect(assertSafeRemoteUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private/i);
    await expect(assertSafeRemoteUrl("http://127.0.0.1:3000/api")).rejects.toThrow();
  });
});
