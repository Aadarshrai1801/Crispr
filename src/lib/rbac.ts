import { countMembers, getMembership, getUser, getWorkspace, listMembers } from "./db";
import { tierFeatures } from "./config";
import type { PlanTier, WorkspaceRole, WorkspaceRow } from "./types";

/**
 * Server-side RBAC (FR-34). Every check here runs on the API layer; the client
 * never gates anything security-relevant on its own.
 */

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  Admin: 4,
  Approver: 3,
  Contributor: 2,
  Viewer: 1,
};

export interface RequesterContext {
  userId: string;
  workspace: WorkspaceRow;
  role: WorkspaceRole;
}

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

/** Resolve the acting user from headers (demo-grade identity for a local app). */
export function resolveUserId(request: Request): string {
  const headerId = request.headers.get("x-crisp-user-id");
  if (headerId) {
    const user = getUser(headerId);
    if (user) return user.id;
  }
  return defaultUserIdSafe();
}

let cachedDefaultUser: string | undefined;
function defaultUserIdSafe(): string {
  cachedDefaultUser ??= (
    getDbSafe().prepare("SELECT id FROM users ORDER BY rowid LIMIT 1").get() as { id: string }
  ).id;
  return cachedDefaultUser;
}

function getDbSafe() {
  // Direct import would be fine too; kept local to make the dependency explicit.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require("./db") as typeof import("./db")).getDb();
}

/**
 * Resolve requester + role within a workspace. Throws AuthzError when the user
 * has no membership. Viewer is the minimum role for any read access.
 */
export function requireContext(request: Request, workspaceId: string): RequesterContext {
  const userId = resolveUserId(request);
  const ws = requireWorkspace(workspaceId);
  const membership = getMembership(workspaceId, userId);
  if (!membership) throw new AuthzError("You do not have access to this workspace.", 403);
  return { userId, workspace: ws, role: membership.role };
}

export function requireWorkspace(workspaceId: string): WorkspaceRow {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new AuthzError("Workspace not found.", 404);
  return ws;
}

export function requireRole(ctx: RequesterContext, min: WorkspaceRole) {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    throw new AuthzError(`Requires ${min} role (you are ${ctx.role}).`, 403);
  }
}

export function requireAdmin(ctx: RequesterContext) {
  requireRole(ctx, "Admin");
}

export function requireApprover(ctx: RequesterContext) {
  requireRole(ctx, "Approver");
}

/** Contributor can upload documents & submit corrections; Viewer cannot (FR-34). */
export function requireContributor(ctx: RequesterContext) {
  requireRole(ctx, "Contributor");
}

export function requireTier(workspace: WorkspaceRow, feature: keyof typeof tierFeatures) {
  const allowed = tierFeatures[feature] as readonly PlanTier[];
  if (!allowed.includes(workspace.plan_tier)) {
    throw new AuthzError(`This feature requires ${allowed.join("/")} tier (workspace is ${workspace.plan_tier}).`, 402);
  }
}

export function memberCount(workspaceId: string): number {
  return countMembers(workspaceId);
}

export function listMemberDetails(workspaceId: string) {
  return listMembers(workspaceId);
}
