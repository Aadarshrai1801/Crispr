"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type UserDto, type WorkspaceDto } from "./api";

const USER_KEY = "crisp-active-user";
const WS_KEY = "crisp-active-workspace";

export interface Session {
  userId: string | null;
  workspaceId: string;
  users: UserDto[];
  workspaces: WorkspaceDto[];
  role: string | null;
  hydrated: boolean;
}

/**
 * Demo-grade session for the local app: active user + workspace are chosen in
 * the sidebar and sent as headers on every API call. All authorization is
 * still enforced server-side (RBAC FR-34); these headers only identify the actor.
 */
export function useSession() {
  const [userId, setUserIdState] = useState<string | null>(null);
  const [workspaceId, setWorkspaceIdState] = useState<string>("ws_default");
  const [users, setUsers] = useState<UserDto[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      if (u) setUserIdState(u);
      const w = localStorage.getItem(WS_KEY);
      if (w) setWorkspaceIdState(w);
    } catch {
      /* ignore */
    }

    void (async () => {
      try {
        const [{ users: allUsers }, { workspaces: allWs }] = await Promise.all([api.users(), api.workspaces(u ?? undefined)]);
        setUsers(allUsers);
        setWorkspaces(allWs);
        // Resolve effective user: stored -> first non-demo? keep stored if valid.
        const effectiveUser = u && allUsers.some((x) => x.id === u) ? u : allUsers[0]?.id ?? null;
        if (!u && effectiveUser) setUserIdState(effectiveUser);
        const wsList = effectiveUser ? await api.workspaces(effectiveUser).then((r) => r.workspaces) : [];
        const merged = wsList.length ? wsList : allWs;
        setWorkspaces(merged);
        const storedWs = localStorage.getItem(WS_KEY);
        if (storedWs && merged.some((w) => w.id === storedWs)) {
          setWorkspaceIdState(storedWs);
        } else if (merged[0]) {
          setWorkspaceIdState(merged[0].id);
        }
      } catch {
        /* server unreachable — leave defaults */
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const setUser = useCallback((id: string) => {
    setUserIdState(id);
    try {
      localStorage.setItem(USER_KEY, id);
    } catch {
      /* ignore */
    }
    // Reload workspace list for the new identity and reset to their default view.
    void api.workspaces(id).then(({ workspaces: ws }) => {
      setWorkspaces(ws);
      if (ws.length && !ws.some((w) => w.id === workspaceId)) {
        setWorkspaceIdState(ws[0].id);
        try {
          localStorage.setItem(WS_KEY, ws[0].id);
        } catch {
          /* ignore */
        }
      }
    });
  }, [workspaceId]);

  const setWorkspace = useCallback((id: string) => {
    setWorkspaceIdState(id);
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  // Track the acting user's role in the active workspace (for UI affordances only).
  useEffect(() => {
    if (!userId || !workspaceId || !hydrated) return;
    let cancelled = false;
    void api.members(workspaceId).then(({ members }) => {
      if (cancelled) return;
      const mine = members.find((m) => m.user_id === userId);
      setRole(mine?.role ?? null);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId, workspaceId, hydrated]);

  return { userId, setUser, workspaceId, setWorkspace, users, workspaces, role, hydrated };
}
