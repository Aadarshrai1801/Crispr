import { describe, it, expect } from "vitest";
import { ROLE_RANK, requireRole, requireWorkspace, AuthzError, type RequesterContext } from "@/lib/rbac";
import type { WorkspaceRole } from "@/lib/types";

/**
 * FR-34 RBAC matrix. Role enforcement itself is pure rank comparison; the
 * membership/identity plumbing is covered by approvals.test.ts which runs
 * against a real temp SQLite database.
 */
const ROLES: WorkspaceRole[] = ["Viewer", "Contributor", "Approver", "Admin"];

function ctx(role: WorkspaceRole): RequesterContext {
  return { userId: `user_${role.toLowerCase()}`, workspace: {} as never, role };
}

describe("ROLE_RANK ordering", () => {
  it("ranks Viewer < Contributor < Approver < Admin", () => {
    expect(ROLE_RANK.Viewer).toBeLessThan(ROLE_RANK.Contributor);
    expect(ROLE_RANK.Contributor).toBeLessThan(ROLE_RANK.Approver);
    expect(ROLE_RANK.Approver).toBeLessThan(ROLE_RANK.Admin);
  });
});

describe("role x minimum-role matrix", () => {
  const matrix: Array<[WorkspaceRole, Parameters<typeof requireRole>[1], boolean]> = [
    // [acting role, required role, allowed]
    ["Viewer", "Viewer", true],
    ["Viewer", "Contributor", false],
    ["Viewer", "Approver", false],
    ["Viewer", "Admin", false],
    ["Contributor", "Viewer", true],
    ["Contributor", "Contributor", true],
    ["Contributor", "Approver", false],
    ["Contributor", "Admin", false],
    ["Approver", "Viewer", true],
    ["Approver", "Contributor", true],
    ["Approver", "Approver", true],
    ["Approver", "Admin", false],
    ["Admin", "Viewer", true],
    ["Admin", "Contributor", true],
    ["Admin", "Approver", true],
    ["Admin", "Admin", true],
  ];

  it.each(matrix)("%s %s %s", (role, min, allowed) => {
    if (allowed) {
      expect(() => requireRole(ctx(role), min)).not.toThrow();
    } else {
      try {
        requireRole(ctx(role), min);
        throw new Error(`expected ${role} to be denied ${min}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthzError);
        expect((err as AuthzError).status).toBe(403);
      }
    }
  });

  it("denial messages name the missing and actual role", () => {
    try {
      requireRole(ctx("Viewer"), "Admin");
    } catch (err) {
      expect((err as Error).message).toContain("Admin");
      expect((err as Error).message).toContain("Viewer");
    }
  });

  it("covers every defined role exactly once in the matrix", () => {
    const acting = new Set(matrix.map(([r]) => r));
    expect([...acting].sort()).toEqual([...ROLES].sort());
  });
});

describe("requireWorkspace", () => {
  it("throws 404 for unknown workspaces", async () => {
    try {
      await requireWorkspace("ws_does_not_exist");
      throw new Error("expected 404");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).status).toBe(404);
    }
  });
});
