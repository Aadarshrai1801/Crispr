"use client";

import { useMemo, useSyncExternalStore } from "react";
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
  setUser: (id: string) => void;
  setWorkspace: (id: string) => void;
  /** Reload workspaces (+ role) for the acting user after server-side changes. */
  refresh: () => void;
}

interface SessionState {
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
 *
 * State lives in one module-level store shared by every useSession() caller,
 * so switching user/workspace or saving settings updates the whole app live.
 */
const INITIAL: SessionState = {
  userId: null,
  workspaceId: "ws_default",
  users: [],
  workspaces: [],
  role: null,
  hydrated: false,
};

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();
let hydrateStarted = false;

function setState(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!hydrateStarted) {
    hydrateStarted = true;
    void hydrate();
  }
  return () => listeners.delete(listener);
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function fetchRole(workspaceId: string, userId: string): Promise<string | null> {
  try {
    const { members } = await api.members(workspaceId);
    return members.find((m) => m.user_id === userId)?.role ?? null;
  } catch {
    return null;
  }
}

async function hydrate() {
  try {
    const storedUser = localStorage.getItem(USER_KEY);
    const storedWs = localStorage.getItem(WS_KEY);
    const { users: allUsers } = await api.users();
    // Resolve effective user: stored -> first available.
    const effectiveUser =
      storedUser && allUsers.some((x) => x.id === storedUser) ? storedUser : (allUsers[0]?.id ?? null);
    const wsList = effectiveUser ? await api.workspaces(effectiveUser).then((r) => r.workspaces) : [];
    const activeWs =
      storedWs && wsList.some((w) => w.id === storedWs) ? storedWs : (wsList[0]?.id ?? INITIAL.workspaceId);
    const role = effectiveUser ? await fetchRole(activeWs, effectiveUser) : null;
    setState({
      userId: effectiveUser,
      users: allUsers,
      workspaces: wsList,
      workspaceId: activeWs,
      role,
      hydrated: true,
    });
  } catch {
    /* server unreachable — leave defaults */
    setState({ hydrated: true });
  }
}

function setUser(id: string) {
  persist(USER_KEY, id);
  setState({ userId: id, role: null });
  void (async () => {
    try {
      const wsList = await api.workspaces(id).then((r) => r.workspaces);
      // Keep the current workspace when shared with the new identity; otherwise reset to their first.
      const nextWs = wsList.some((w) => w.id === state.workspaceId)
        ? state.workspaceId
        : (wsList[0]?.id ?? state.workspaceId);
      persist(WS_KEY, nextWs);
      const role = await fetchRole(nextWs, id);
      setState({ workspaces: wsList, workspaceId: nextWs, role });
    } catch {
      /* keep previous list */
    }
  })();
}

function setWorkspace(id: string) {
  persist(WS_KEY, id);
  setState({ workspaceId: id });
  if (state.userId) void fetchRole(id, state.userId).then((role) => setState({ role }));
}

function refresh() {
  const uid = state.userId;
  if (!uid) return;
  void (async () => {
    try {
      const wsList = await api.workspaces(uid).then((r) => r.workspaces);
      const patch: Partial<SessionState> = { workspaces: wsList };
      if (wsList.length && !wsList.some((w) => w.id === state.workspaceId)) {
        // Active workspace disappeared (e.g. membership revoked) — fall back to their first.
        const nextWs = wsList[0].id;
        persist(WS_KEY, nextWs);
        patch.workspaceId = nextWs;
        patch.role = await fetchRole(nextWs, uid);
      } else {
        patch.role = await fetchRole(state.workspaceId, uid);
      }
      setState(patch);
    } catch {
      /* ignore */
    }
  })();
}

export function useSession(): Session {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
  return useMemo<Session>(
    () => ({ ...snapshot, setUser, setWorkspace, refresh }),
    [snapshot]
  );
}
