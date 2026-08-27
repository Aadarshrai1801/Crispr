import { countMembers, getMembership, getSession, getUser, getWorkspace, listMembers } from "./db";
import { isProdRuntime, tierFeatures } from "./config";
import { SESSION_COOKIE, parseCookies } from "./auth";
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

/**
 * Blocker #1: resolve the acting user from the signed-in session cookie.
 * The legacy x-crisp-user-id header is no longer trusted anywhere. Requests
 * without a valid session throw 401 before any workspace/role check runs.
 */
export async function requireAuthenticatedUser(request: Request): Promise<{ id: string; name: string; email: string }> {
  const token = parseCookies(request.headers.get("cookie") ?? "")[SESSION_COOKIE];
  if (!token) throw new AuthzError("Authentication required. Sign in to continue.", 401);
  const session = await getSession(token);
  if (!session) throw new AuthzError("Session expired or invalid. Sign in again.", 401);
  const user = await getUser(session.user_id);
  if (!user) throw new AuthzError("This account no longer exists.", 401);
  return user;
}

/** Dev-only impersonation hook for the local demo switcher; disabled in production. */
export function devImpersonationEnabled(): boolean {
  return !isProdRuntime();
}

export async function resolveUserId(request: Request): Promise<string> {
  return (await requireAuthenticatedUser(request)).id;
}

/**
 * Resolve requester + role within a workspace. Throws AuthzError when the user
 * has no membership. Viewer is the minimum role for any read access.
 */
export async function requireContext(request: Request, workspaceId: string): Promise<RequesterContext> {
  const userId = await resolveUserId(request);
  const ws = await requireWorkspace(workspaceId);
  const membership = await getMembership(workspaceId, userId);
  if (!membership) throw new AuthzError("You do not have access to this workspace.", 403);
  return { userId, workspace: ws, role: membership.role };
}

export async function requireWorkspace(workspaceId: string): Promise<WorkspaceRow> {
  const ws = await getWorkspace(workspaceId);
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

export async function memberCount(workspaceId: string): Promise<number> {
  return countMembers(workspaceId);
}

export async function listMemberDetails(workspaceId: string) {
  return listMembers(workspaceId);
}
