"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ChatCircleText, FileText, SealCheck, Sparkle } from "@phosphor-icons/react";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Chat", icon: ChatCircleText },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/corrections", label: "Corrections", icon: SealCheck },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[100dvh] flex-col lg:flex-row">
      {/* Sidebar — desktop */}
      <aside className="sticky top-0 hidden h-[100dvh] w-[232px] shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <Link href="/" className="focus-ring mb-8 flex items-center gap-2.5 rounded-lg px-2 py-1">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-on-accent">
            <Sparkle size={14} weight="fill" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Crisp</span>
          <span className="mt-px rounded-md border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-strong">
            beta
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
        </nav>

        <div className="mt-auto space-y-2 border-t border-line pt-3">
          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Personal workspace</p>
            <ThemeToggle />
          </div>
          <p className="truncate px-1 text-xs text-ink-soft">local@crispai.app</p>
        </div>
      </aside>

      {/* Top bar — mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-lg lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-on-accent">
            <Sparkle size={12} weight="fill" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Crisp</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
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
