import { getMembership, listWorkspacesForUser } from "@/lib/db";
import { requireAuthenticatedUser } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I? Returns the session user's identity + workspaces + active role, or 401. */
export async function GET(request: Request) {
  try {
    const user = requireAuthenticatedUser(request);
    const workspaces = listWorkspacesForUser(user.id);
    const workspaceId = workspaces[0]?.id ?? null;
    return json({
      user: { id: user.id, name: user.name, email: user.email },
      workspaces,
      workspaceId,
      role: workspaceId ? getMembership(workspaceId, user.id)?.role ?? null : null,
    });
  } catch (err) {
    return apiError(err);
  }
}
