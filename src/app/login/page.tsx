"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkle } from "@phosphor-icons/react";
import { api, type SessionPayload } from "@/lib/client/api";

/**
 * Login screen (blocker #1). Password-based sign-in against the local SQLite
 * user store. In non-production runtimes a quick "act as" list of seeded demo
 * accounts is offered so RBAC stays observable locally.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    // Already signed in? Go straight to the app (and pick up dev flag).
    api
      .session()
      .then((s) => {
        if (s.dev_impersonation) setDevMode(true);
        router.replace("/");
      })
      .catch(() => undefined);
  }, [router]);

  async function finish(s: SessionPayload) {
    try {
      localStorage.setItem("crisp-active-workspace", s.workspaceId ?? "ws_default");
      localStorage.setItem("crisp-active-user", s.user.id);
    } catch {
      /* ignore */
    }
    router.replace("/");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await finish(await api.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function devAs(userId: string) {
    setBusy(true);
    setError(null);
    try {
      await finish(await api.devLoginAs(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent-strong";
  const DEMOS: Array<[string, string]> = [
    ["Local User", "local@crispai.app"],
    ["Marcus (Approver)", "marcus@crispai.app"],
    ["Priya (Contributor)", "priya@crispai.app"],
    ["Dana (Viewer)", "dana@crispai.app"],
  ];

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-on-accent">
            <Sparkle size={16} weight="fill" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Crispr</span>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
          <h1 className="text-base font-semibold">Sign in</h1>
          <input
            className={input}
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
          <input
            className={input}
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="focus-ring w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Local development accounts use password <code>demo1234</code>. Production accounts are
            provisioned with <code>scripts/create-user.mjs</code>.
          </p>
        </form>

        {devMode && (
          <div className="rounded-xl border border-dashed border-line p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              Dev only — act as (RBAC demo)
            </p>
            <div className="space-y-1">
              {DEMOS.map(([name, mail]) => (
                <button
                  key={mail}
                  disabled={busy}
                  onClick={() => devAs(mail)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-hover disabled:opacity-50"
                >
                  <span>{name}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{mail}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
