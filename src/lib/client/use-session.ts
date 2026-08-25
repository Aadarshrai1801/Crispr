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
  /** Clear the session cookie and return to the login screen. */
  signOut: () => void;
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
 * Session store: identity comes from the HttpOnly session cookie (blocker #1).
 * Hydration asks the server who we are; the workspace selector remains a
 * client-side choice because the server re-validates membership on every call.
 * The "act as" demo switcher only functions when the server reports
 * dev_impersonation (non-production runtimes).
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
    const storedWs = localStorage.getItem(WS_KEY);
    const s = await api.session();
    const wsList = s.workspaces;
    const activeWs =
      storedWs && wsList.some((w) => w.id === storedWs) ? storedWs : (s.workspaceId ?? INITIAL.workspaceId);
    const role = await fetchRole(activeWs, s.user.id);

    let users = [s.user];
    if (s.dev_impersonation) {
      // Local/demo runtime only: load all accounts so RBAC is observable.
      try {
        const { users: allUsers } = await api.users();
        if (allUsers.length) users = allUsers;
      } catch {
        /* keep single-user list */
      }
    }

    setState({
      userId: s.user.id,
      users,
      workspaces: wsList,
      workspaceId: activeWs,
      role,
      hydrated: true,
    });
  } catch {
    /* unauthenticated or server unreachable — login page handles redirect */
    setState({ hydrated: true });
  }
}

function setUser(id: string) {
  if (id === state.userId) return;
  void (async () => {
    try {
      // Dev-only passwordless identity switch; server rejects it in production.
      await api.devLoginAs(id);
      persist(USER_KEY, id);
      setState({ userId: id, role: null });
      const wsList = await api.workspaces().then((r) => r.workspaces);
      const nextWs = wsList.some((w) => w.id === state.workspaceId)
        ? state.workspaceId
        : (wsList[0]?.id ?? state.workspaceId);
      persist(WS_KEY, nextWs);
      const role = await fetchRole(nextWs, id);
      setState({ workspaces: wsList, workspaceId: nextWs, role });
    } catch {
      /* keep previous identity */
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
      const wsList = await api.workspaces().then((r) => r.workspaces);
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

function signOut() {
  void api
    .logout()
    .catch(() => undefined)
    .finally(() => {
      try {
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(WS_KEY);
      } catch {
        /* ignore */
      }
      if (typeof window !== "undefined") window.location.href = "/login";
    });
}

export function useSession(): Session {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
  return useMemo<Session>(
    () => ({ ...snapshot, setUser, setWorkspace, refresh, signOut }),
    [snapshot]
  );
}
