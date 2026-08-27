"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChatCircleText,
  CaretDown,
  Check,
  CircleNotch,
  FileText,
  SealCheck,
  ShieldCheck,
  Sparkle,
  Trash,
  ChartBar,
  UsersThree,
} from "@phosphor-icons/react";
import { ThemeToggle } from "./theme-toggle";
import { DialogHost } from "./ui/dialogs";
import { useSession } from "@/lib/client/use-session";
import { api } from "@/lib/client/api";

const NAV = [
  { href: "/", label: "Chat", icon: ChatCircleText },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/corrections", label: "Corrections", icon: SealCheck },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/analytics", label: "Analytics", icon: ChartBar },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const reduce = useReducedMotion();
  const [openMenu, setOpenMenu] = useState<"user" | "ws" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const wsMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on navigation
  useEffect(() => setOpenMenu(null), [pathname]);

  // Close dropdowns when touching outside or pressing Escape
  useEffect(() => {
    if (!openMenu) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (openMenu === "ws" && wsMenuRef.current && !wsMenuRef.current.contains(target)) setOpenMenu(null);
      if (openMenu === "user" && userMenuRef.current && !userMenuRef.current.contains(target)) setOpenMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  async function deleteActiveWorkspace() {
    if (!activeWorkspace) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteWorkspace(activeWorkspace.id);
      setConfirmDelete(false);
      setOpenMenu(null);
      session.refresh(); // falls back to the first remaining membership
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const activeWorkspace = session.workspaces.find((w) => w.id === session.workspaceId);
  const activeUser = session.users.find((u) => u.id === session.userId);
  const canDeleteWorkspace =
    session.role === "Admin" && activeWorkspace != null && activeWorkspace.id !== "ws_default";

  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-[100dvh] w-[232px] shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <Link href="/" className="focus-ring mb-6 flex items-center gap-2.5 rounded-lg px-2 py-1">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-on-accent">
            <Sparkle size={14} weight="fill" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Crispr</span>
          <span className="mt-px rounded-md border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-strong">
            v2
          </span>
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "focus-ring group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-200",
                  active
                    ? "bg-accent-soft font-medium text-accent-strong"
                    : "text-ink-soft hover:bg-surface-hover hover:text-ink"
                )}
              >
                <Icon size={16} weight={active ? "fill" : "regular"} />
                {label}
              </Link>
            );
          })}
          <Link
            href="/workspace"
            className={clsx(
              "focus-ring group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-200",
              pathname === "/workspace"
                ? "bg-accent-soft font-medium text-accent-strong"
                : "text-ink-soft hover:bg-surface-hover hover:text-ink"
            )}
          >
            <UsersThree size={16} weight={pathname === "/workspace" ? "fill" : "regular"} />
            Workspace
          </Link>
        </nav>

        <div className="mt-auto space-y-2 border-t border-line pt-3">
          {/* Workspace switcher */}
          <div className="relative px-1" ref={wsMenuRef}>
            <button
              onClick={() => {
                setOpenMenu(openMenu === "ws" ? null : "ws");
                setConfirmDelete(false);
                setDeleteError(null);
              }}
              className="focus-ring flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-surface-hover"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-ink-faint">Workspace</span>
                <span className="block truncate text-xs font-medium">{activeWorkspace?.name ?? "Personal Workspace"}</span>
              </span>
              <CaretDown size={11} className="shrink-0 text-ink-faint" />
            </button>
            <AnimatePresence initial={false}>
              {openMenu === "ws" && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]"
                >
                  {(session.workspaces.length ? session.workspaces : [{ id: "ws_default", name: "Personal Workspace" } as never]).map(
                    (w) => (
                      <button
                        key={(w as { id: string }).id}
                        onClick={() => session.setWorkspace((w as { id: string }).id)}
                        disabled={deleting}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover disabled:opacity-50"
                      >
                        <span className="truncate">
                          {(w as { name: string }).name}
                          {(w as { plan_tier?: string; id: string }).plan_tier && (w as { id: string }).id !== "ws_default" && (
                            <span className="ml-1.5 font-mono text-[9px] uppercase text-ink-faint">
                              {(w as { plan_tier?: string }).plan_tier}
                            </span>
                          )}
                        </span>
                        {(w as { id: string }).id === session.workspaceId && <Check size={12} weight="bold" className="text-accent" />}
                      </button>
                    )
                  )}
                  {canDeleteWorkspace && !confirmDelete && (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      disabled={deleting}
                      className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
                    >
                      <Trash size={12} weight="light" /> Delete workspace…
                    </button>
                  )}
                  {canDeleteWorkspace && confirmDelete && (
                    <div className="border-t border-line bg-danger-soft/40 px-3 py-2.5">
                      {deleting ? (
                        <div>
                          <p className="flex items-center gap-2 text-xs font-medium text-danger">
                            <CircleNotch size={13} className="animate-spin" /> Deleting “{activeWorkspace?.name}”…
                          </p>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-danger/15">
                            <motion.div
                              className="h-full rounded-full bg-danger"
                              initial={reduce ? false : { width: "4%" }}
                              animate={{ width: "92%" }}
                              transition={{ duration: reduce ? 0 : 6, ease: "easeOut" }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-[11px] leading-snug text-danger">
                            Delete “{activeWorkspace?.name}”? All documents, corrections and history are erased permanently.
                          </p>
                          <div className="mt-2 flex gap-1.5">
                            <button
                              onClick={() => void deleteActiveWorkspace()}
                              className="focus-ring rounded-md bg-danger px-2 py-1 text-[11px] font-semibold text-white hover:bg-danger/90"
                            >
                              Delete forever
                            </button>
                            <button
                              onClick={() => setConfirmDelete(false)}
                              className="focus-ring rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium hover:bg-surface-hover"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {deleteError && <p className="border-t border-line px-3 py-2 text-[11px] text-danger">{deleteError}</p>}
                  <Link
                    href="/workspace#new"
                    className="block w-full border-t border-line px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft"
                  >
                    + New workspace
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User menu */}
          <div className="relative flex items-center justify-between px-1" ref={userMenuRef}>
            <button
              onClick={() => setOpenMenu(openMenu === "user" ? null : "user")}
              className="focus-ring min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-surface-hover"
            >
              <span className="block truncate text-xs text-ink-soft">
                {activeUser ? `${activeUser.name}${session.role ? ` · ${session.role}` : ""}` : "Signed out"}
              </span>
            </button>
            <ThemeToggle />
            <AnimatePresence initial={false}>
              {openMenu === "user" && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]"
                >
                  {session.users.length > 1 && (
                    <>
                      <p className="border-b border-line px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                        Act as (RBAC demo — dev only)
                      </p>
                      {session.users.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => session.setUser(u.id)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover"
                        >
                          <span className="truncate">{u.name}</span>
                          {u.id === session.userId && <Check size={12} weight="bold" className="text-accent" />}
                        </button>
                      ))}
                    </>
                  )}
                  <button
                    onClick={session.signOut}
                    className="w-full border-t border-line px-3 py-2 text-left text-xs font-medium text-accent hover:bg-accent-soft"
                  >
                    Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      {/* Top bar — mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-on-accent">
            <Sparkle size={12} weight="fill" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Crispr</span>
        </Link>
        <nav className="flex items-center gap-1">
          {[...NAV, { href: "/workspace", label: "Workspace", icon: UsersThree }].map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={clsx(
                  "focus-ring grid h-8 w-8 place-items-center rounded-lg transition-colors duration-200",
                  active ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-surface-hover"
                )}
              >
                <Icon size={16} weight={active ? "fill" : "regular"} />
              </Link>
            );
          })}
          <ThemeToggle />
        </nav>
      </header>

      <main className="min-w-0 flex-1">{children}</main>
      <DialogHost />
    </div>
  );
}
