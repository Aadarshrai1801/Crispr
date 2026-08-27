import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, parseCookies, SESSION_COOKIE } from "@/lib/auth";
import { createSession, getSession, deleteSession, getUserByEmail } from "@/lib/db";
import { AuthzError, requireAuthenticatedUser } from "@/lib/rbac";

function requestWithCookie(token: string): Request {
  return new Request("http://localhost/api/test", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
  });
}

describe("password hashing", () => {
  it("verifies correct passwords and rejects wrong ones", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt:/);
    expect(verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(verifyPassword("wrong password", hash)).toBe(false);
  });

  it("salts every hash uniquely", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("fails safely on malformed stored hashes", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "plaintext-not-scrypt")).toBe(false);
    expect(verifyPassword("x", "md5:abc:def")).toBe(false);
  });
});

describe("cookie parsing", () => {
  it("parses session cookies from a Cookie header", () => {
    const cookies = parseCookies("other=1; crisp_session=abc123; extra=x");
    expect(cookies[SESSION_COOKIE]).toBe("abc123");
    expect(cookies.other).toBe("1");
  });

  it("tolerates missing or empty headers", () => {
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("nonsense-no-equals")).toEqual({});
  });
});

describe("SQLite-backed sessions", () => {
  const ownerEmail = "local@crispai.app";

  it("creates, resolves, and expires sessions by token", async () => {
    const user = (await getUserByEmail(ownerEmail))!;
    expect(user).toBeDefined();

    const { token } = await createSession(user.id, 60_000);
    const session = await getSession(token);
    expect(session?.user_id).toBe(user.id);

    await deleteSession(token);
    expect(await getSession(token)).toBeUndefined();
  });

  it("does not return expired sessions", async () => {
    const user = (await getUserByEmail(ownerEmail))!;
    const { token } = await createSession(user.id, -1000); // already expired
    expect(await getSession(token)).toBeUndefined();
  });

  it("requireAuthenticatedUser: valid cookie -> user; no/bad cookie -> 401", async () => {
    const user = (await getUserByEmail(ownerEmail))!;
    const { token } = await createSession(user.id, 60_000);
    expect((await requireAuthenticatedUser(requestWithCookie(token))).id).toBe(user.id);

    for (const req of [
      new Request("http://localhost/api/test"), // no cookie at all
      requestWithCookie("forged-or-expired-token"),
    ]) {
      try {
        await requireAuthenticatedUser(req);
        throw new Error("expected 401");
      } catch (err) {
        expect(err).toBeInstanceOf(AuthzError);
        expect((err as AuthzError).status).toBe(401);
      }
    }
  });

  it("the legacy x-crisp-user-id header grants nothing anymore", async () => {
    const req = new Request("http://localhost/api/test", {
      headers: { "x-crisp-user-id": "user_marcus" },
    });
    try {
      await requireAuthenticatedUser(req);
      throw new Error("header spoof should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).status).toBe(401);
    }
  });
});
