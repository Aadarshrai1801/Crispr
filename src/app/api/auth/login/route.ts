import { z } from "zod";
import { createSession, getMembership, getUserByEmail, getUser, listWorkspacesForUser } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_MS, verifyPassword } from "@/lib/auth";
import { AuthzError, devImpersonationEnabled } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.union([
  z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) }),
  // Passwordless identity switch — ONLY available outside production so the
  // local demo switcher keeps working. In prod every login needs a password.
  z.object({ user_id: z.string().min(1).max(100) }),
]);

function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Builds the payload the client session store expects after a successful login. */
async function sessionPayload(userId: string) {
  const user = (await getUser(userId))!;
  const workspaces = await listWorkspacesForUser(userId);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    workspaces,
    workspaceId: workspaces[0]?.id ?? null,
    role: workspaces.length ? (await getMembership(workspaces[0].id, userId))?.role ?? null : null,
    // Lets the client know whether the demo identity switcher is available.
    dev_impersonation: devImpersonationEnabled(),
  };
}

export async function POST(request: Request) {
  try {
    // Brute-force throttle keyed by source IP across all login attempts.
    const limit = checkRateLimit(`auth:${clientIp(request)}`, "auth");
    if (!limit.ok) return rateLimitResponse(limit);

    const body = BodySchema.parse(await request.json());
    let userId: string;
    if ("user_id" in body) {
      if (!devImpersonationEnabled()) {
        throw new AuthzError("Passwordless sign-in is disabled. Provide email and password.", 403);
      }
      // Dev convenience: accept id or email.
      const user = (await getUser(body.user_id)) ?? (await getUserByEmail(body.user_id));
      if (!user) throw new AuthzError("Unknown user.", 404);
      userId = user.id;
    } else {
      const user = await getUserByEmail(body.email);
      if (!user || !verifyPassword(body.password, (user as { password_hash?: string }).password_hash)) {
        throw new AuthzError("Invalid email or password.", 401);
      }
      userId = user.id;
    }

    const { token } = await createSession(userId, SESSION_TTL_MS);
    const res = json(await sessionPayload(userId));
    res.headers.append("Set-Cookie", sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)));
    return res;
  } catch (err) {
    return apiError(err);
  }
}
