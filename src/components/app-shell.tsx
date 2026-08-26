"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  ChatCircleText,
  CaretDown,
  Check,
  FileText,
  SealCheck,
  ShieldCheck,
  Sparkle,
  ChartBar,
  UsersThree,
} from "@phosphor-icons/react";
import { ThemeToggle } from "./theme-toggle";
import { useSession } from "@/lib/client/use-session";

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
  const [openMenu, setOpenMenu] = useState<"user" | "ws" | null>(null);

  // Close dropdowns on navigation
  useEffect(() => setOpenMenu(null), [pathname]);

  const activeWorkspace = session.workspaces.find((w) => w.id === session.workspaceId);
  const activeUser = session.users.find((u) => u.id === session.userId);

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
          <div className="relative px-1">
            <button
              onClick={() => setOpenMenu(openMenu === "ws" ? null : "ws")}
              className="focus-ring flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left hover:bg-surface-hover"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[10px] uppercase tracking-wider text-ink-faint">Workspace</span>
                <span className="block truncate text-xs font-medium">{activeWorkspace?.name ?? "Personal Workspace"}</span>
              </span>
              <CaretDown size={11} className="shrink-0 text-ink-faint" />
            </button>
            {openMenu === "ws" && (
              <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
                {(session.workspaces.length ? session.workspaces : [{ id: "ws_default", name: "Personal Workspace" } as never]).map(
                  (w) => (
                    <button
                      key={(w as { id: string }).id}
                      onClick={() => session.setWorkspace((w as { id: string }).id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover"
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
                <Link
                  href="/workspace#new"
                  className="block w-full border-t border-line px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft"
                >
                  + New workspace
                </Link>
              </div>
            )}
          </div>

          {/* User menu */}
          <div className="relative flex items-center justify-between px-1">
            <button
              onClick={() => setOpenMenu(openMenu === "user" ? null : "user")}
              className="focus-ring min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-surface-hover"
            >
              <span className="block truncate text-xs text-ink-soft">
                {activeUser ? `${activeUser.name}${session.role ? ` · ${session.role}` : ""}` : "Signed out"}
              </span>
            </button>
            <ThemeToggle />
            {openMenu === "user" && (
              <div className="absolute bottom-full left-0 z-50 mb-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
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
              </div>
            )}
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
    </div>
  );
}
