"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  DownloadSimple,
  Key,
  Link as LinkIcon,
  Plug,
  Plus,
  SealCheck,
  Trash,
  UsersThree,
} from "@phosphor-icons/react";
import {
  api,
  type ApiKeyDto,
  type AuditEntryDto,
  type IntegrationConnectionDto,
  type MemberDto,
  type UserDto,
  type WebhookEndpointDto,
} from "@/lib/client/api";
import { useSession } from "@/lib/client/use-session";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, Skeleton } from "@/components/ui/primitives";
import { cn, formatDate } from "@/lib/utils";

type Tab = "settings" | "members" | "audit" | "keys" | "webhooks" | "integrations";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "settings", label: "Settings" },
  { id: "members", label: "Members & roles" },
  { id: "audit", label: "Audit log" },
  { id: "keys", label: "API keys" },
  { id: "webhooks", label: "Webhooks" },
  { id: "integrations", label: "Integrations" },
];

export default function WorkspacePage() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("settings");
  const wsId = session.workspaceId;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 md:px-8 md:py-10">
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Team collaboration</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {session.workspaces.find((w) => w.id === wsId)?.name ?? "Workspace"}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          <Chip tone="accent">{session.workspaces.find((w) => w.id === wsId)?.plan_tier ?? "team"} plan</Chip>
          <span>Shared document library · shared correction layer · role-based access</span>
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "focus-ring rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150",
              tab === t.id ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-surface-hover"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!session.hydrated ? (
        <Skeleton className="h-64" />
      ) : tab === "settings" ? (
        <SettingsTab session={session} />
      ) : tab === "members" ? (
        <MembersTab wsId={wsId} />
      ) : tab === "audit" ? (
        <AuditTab wsId={wsId} />
      ) : tab === "keys" ? (
        <KeysTab wsId={wsId} planTier={session.workspaces.find((w) => w.id === wsId)?.plan_tier ?? "team"} />
      ) : tab === "webhooks" ? (
        <WebhooksTab wsId={wsId} />
      ) : (
        <IntegrationsTab wsId={wsId} planTier={session.workspaces.find((w) => w.id === wsId)?.plan_tier ?? "team"} />
      )}
    </div>
  );
}

/* ------------------------------ Settings ------------------------------ */

function SettingsTab({ session }: { session: ReturnType<typeof useSession> }) {
  const ws = session.workspaces.find((w) => w.id === session.workspaceId);
  const [tier, setTier] = useState("team");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState("team");
  const [busyCreate, setBusyCreate] = useState(false);

  useEffect(() => {
    if (!ws) return;
    setTier(ws.plan_tier);
  }, [ws]);

  async function save(patch: Record<string, unknown>, msg: string) {
    setSaving(true);
    setSavedMsg(null);
    try {
      await api.updateWorkspace(session.workspaceId, patch);
      session.refresh();
      setSavedMsg(msg);
    } catch (err) {
      setSavedMsg(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function createWorkspace() {
    if (newName.trim().length < 2) return;
    setBusyCreate(true);
    try {
      const { workspace } = await api.createWorkspace({ name: newName.trim(), plan_tier: newTier });
      session.refresh();
      session.setWorkspace(workspace.id);
      setNewName("");
    } finally {
      setBusyCreate(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">Review workflow</h2>
        <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-soft">
          Corrections and edits submitted by Contributors are held in the Approvals queue and only go live for other
          members after an Approver or Admin accepts them. Admins and Approvers publish their own changes immediately.
        </p>

        {(saving || savedMsg) && (
          <p className={cn("mt-4 text-xs", savedMsg && !saving ? "text-accent" : "text-ink-faint")}>
            {saving ? "Saving…" : savedMsg}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold">Plan tier</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Tiers gate features per the packaging table — e.g. the public API and API keys require Enterprise.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value);
              void save({ plan_tier: e.target.value }, `Plan set to ${e.target.value}`);
            }}
            aria-label="Plan tier"
            className="focus-ring h-9 rounded-xl border border-line-strong bg-bg px-2 text-xs"
          >
            {["free", "pro", "team", "enterprise"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section id="new" className="rounded-2xl border border-dashed border-line-strong bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Plus size={14} weight="bold" /> Create a workspace</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Support Policy KB"
            className="focus-ring h-9 rounded-xl border border-line-strong bg-bg px-3 text-[13px]"
          />
          <select value={newTier} onChange={(e) => setNewTier(e.target.value)} aria-label="New workspace tier" className="focus-ring h-9 rounded-xl border border-line-strong bg-bg px-2 text-xs">
            {["free", "pro", "team", "enterprise"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Button variant="primary" size="sm" disabled={newName.trim().length < 2 || busyCreate} onClick={() => void createWorkspace()}>
            {busyCreate ? "Creating…" : "Create"}
          </Button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------ Members ------------------------------ */

const ROLES = ["Admin", "Approver", "Contributor", "Viewer"] as const;

function MembersTab({ wsId }: { wsId: string }) {
  const [members, setMembers] = useState<MemberDto[] | null>(null);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [addId, setAddId] = useState("");
  const [addRole, setAddRole] = useState("Viewer");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ members: m }, { users: u }] = await Promise.all([api.members(wsId), api.users()]);
      setMembers(m);
      setUsers(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
      setMembers([]);
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!addId) return;
    setError(null);
    try {
      await api.addMember(wsId, addId, addRole);
      setAddId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs font-semibold">{r}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              {r === "Admin" && "Manage workspace, users, roles, integrations"}
              {r === "Approver" && "Approve/reject corrections + all Contributor powers"}
              {r === "Contributor" && "Upload documents, submit corrections, comment"}
              {r === "Viewer" && "Query documents and view corrections only"}
            </p>
          </div>
        ))}
      </div>

      {members === null ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Joined</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{m.name}</p>
                    <p className="text-[11px] text-ink-faint">{m.email}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={m.role}
                      onChange={(e) => void api.changeRole(wsId, m.user_id, e.target.value).then(load).catch((err) => setError(err.message))}
                      aria-label={`Role for ${m.name}`}
                      className="focus-ring h-7 rounded-lg border border-line-strong bg-bg px-1.5 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-faint">{formatDate(m.joined_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => void api.removeMember(wsId, m.user_id).then(load).catch((err) => setError(err.message))}>
                      <Trash size={12} weight="light" /> Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface p-4">
        <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="User to add" className="focus-ring h-9 min-w-48 rounded-xl border border-line-strong bg-bg px-2 text-xs">
          <option value="">Select user…</option>
          {users.filter((u) => !members?.some((m) => m.user_id === u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>
        <select value={addRole} onChange={(e) => setAddRole(e.target.value)} aria-label="Role for new member" className="focus-ring h-9 rounded-xl border border-line-strong bg-bg px-2 text-xs">
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <Button variant="primary" size="sm" disabled={!addId} onClick={() => void add()}>
          Add member
        </Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

/* ------------------------------ Audit log ------------------------------ */

function AuditTab({ wsId }: { wsId: string }) {
  const [entries, setEntries] = useState<AuditEntryDto[] | null>(null);

  useEffect(() => {
    void api.auditLog(wsId).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [wsId]);

  function exportLog(format: "csv" | "json") {
    window.open(`/api/v2/workspaces/${encodeURIComponent(wsId)}/audit-log?format=${format}`, "_blank");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink-soft">
          Immutable, append-only record of every correction and approval action (FR-41): actor, timestamp, before/after state.
        </p>
        <span className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => exportLog("csv")}>
            <DownloadSimple size={13} weight="light" /> CSV
          </Button>
          <Button size="sm" onClick={() => exportLog("json")}>
            <DownloadSimple size={13} weight="light" /> JSON
          </Button>
        </span>
      </div>

      {entries === null ? (
        <Skeleton className="h-64" />
      ) : entries.length === 0 ? (
        <EmptyState icon={<SealCheck size={20} weight="light" />} title="No audit activity yet" body="Correction submissions, approvals, rejections and edits will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((e) => (
                <tr key={e.id} className="border-b border-line last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-ink-faint">{formatDate(e.timestamp)}</td>
                  <td className="px-3 py-2 text-ink-soft">{e.actor_id.replace(/^user_/, "")}</td>
                  <td className="px-3 py-2"><Chip>{e.action_type}</Chip></td>
                  <td className="max-w-40 truncate px-3 py-2 font-mono text-[10px] text-ink-faint">{e.target_type}:{e.target_id.slice(0, 18)}</td>
                  <td className="max-w-md truncate px-3 py-2 text-[11px] text-ink-soft" title={`${e.before_state ?? ""} → ${e.after_state ?? ""}`}>
                    {summarize(e.after_state ?? e.before_state)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function summarize(stateJson: string | null): string {
  if (!stateJson) return "—";
  try {
    const o = JSON.parse(stateJson) as Record<string, unknown>;
    const keys = ["status", "question", "filename", "name", "reason", "role"];
    const parts = keys.filter((k) => k in o && o[k]).map((k) => `${k}: ${String(o[k]).slice(0, 40)}`);
    return parts.join(" · ") || "updated";
  } catch {
    return stateJson.slice(0, 80);
  }
}

/* ------------------------------ API keys ------------------------------ */

function KeysTab({ wsId, planTier }: { wsId: string; planTier: string }) {
  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [writeScope, setWriteScope] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enterprise = planTier === "enterprise";

  const load = useCallback(() => api.apiKeys(wsId).then((r) => setKeys(r.keys)).catch((e) => { setError(e.message); setKeys([]); }), [wsId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setError(null);
    try {
      const { secret } = await api.createApiKey(wsId, name.trim() || "Default key", writeScope ? ["query", "write"] : ["query"]);
      setSecretOnce(secret);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    }
  }

  if (!enterprise) {
    return (
      <EmptyState
        icon={<Key size={20} weight="light" />}
        title="Enterprise feature"
        body="API keys power the public REST API (FR-46) and require the Enterprise tier. Switch the plan tier in Settings to try it locally."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink-soft">
        Keys authenticate the public REST API (<code className="font-mono text-[11px]">POST /api/public/query</code>,{" "}
        <code className="font-mono text-[11px]">/api/public/documents</code>,{" "}
        <code className="font-mono text-[11px]">/api/public/corrections</code>). The full secret is shown once at creation.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" className="focus-ring h-9 w-56 rounded-xl border border-line-strong bg-bg px-3 text-[13px]" />
        <label className="inline-flex h-9 items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={writeScope} onChange={(e) => setWriteScope(e.target.checked)} />
          include write scope
        </label>
        <Button variant="primary" size="sm" onClick={() => void create()}><Key size={12} weight="fill" /> Create key</Button>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      {secretOnce && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-3">
          <p className="text-xs font-medium text-warn">Copy your secret now — it will not be shown again:</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px]">{secretOnce}</code>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(secretOnce)}><Copy size={12} /> Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => setSecretOnce(null)}>Done</Button>
          </div>
        </div>
      )}

      {keys === null ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Prefix</th>
                <th className="px-3 py-2 font-medium">Scopes</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-faint">No keys yet.</td></tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-medium">{k.name}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-ink-faint">{k.key_prefix}…</td>
                  <td className="px-3 py-2.5"><Chip>{(JSON.parse(k.scopes) as string[]).join(", ")}</Chip></td>
                  <td className="px-3 py-2.5">
                    {k.revoked_at ? <Chip tone="danger">revoked</Chip> : <Chip tone="accent">active</Chip>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!k.revoked_at && (
                      <Button variant="ghost" size="sm" onClick={() => void api.revokeApiKey(k.id).then(load)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Webhooks ------------------------------ */

const PROVIDER_HINTS: Record<string, string> = {
  slack: "Fully wired — point a Slack /crisp slash command at POST /api/integrations/slack/events to query your library from chat.",
  teams: "Registers the connection only. Real message answering needs an Azure Bot registration forwarding payloads to a bot endpoint.",
  zapier: "Fully wired via webhooks — add an endpoint in the Webhooks tab and consume signed correction/conflict events in Zapier or Make.",
  gdrive: "Registers the connection only. Folder→library sync needs Google OAuth app credentials (client ID + secret), not configured in this local build.",
  notion: "Registers the connection only. Database sync needs a Notion integration token, not configured in this local build.",
  confluence: "Enterprise tier · registers the connection. Space sync needs Confluence OAuth credentials.",
  sharepoint: "Enterprise tier · registers the connection. Library sync needs SharePoint OAuth credentials.",
};

function WebhooksTab({ wsId }: { wsId: string }) {
  const [data, setData] = useState<{ endpoints: WebhookEndpointDto[]; available_events: string[] } | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secretOnce, setSecretOnce] = useState<string | null>(null);

  const load = useCallback(() => api.webhooks(wsId).then(setData).catch(() => setData({ endpoints: [], available_events: [] })), [wsId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink-soft">
        Deliver <code className="font-mono text-[11px]">correction.submitted/approved/rejected</code>,{" "}
        <code className="font-mono text-[11px]">conflict.detected</code> and{" "}
        <code className="font-mono text-[11px]">document.version_updated</code> events to any endpoint. Payloads are HMAC-SHA256
        signed (<code className="font-mono text-[11px]">X-Crisp-Signature</code>) so receivers can verify authenticity.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.example.com/crispr" className="focus-ring h-9 min-w-72 flex-1 rounded-xl border border-line-strong bg-bg px-3 text-[13px]" />
        <Button variant="primary" size="sm" disabled={!/^https?:\/\/.+/.test(url) || events.length === 0}
          onClick={() =>
            void api.createWebhook(wsId, url, events).then((r) => {
              setSecretOnce(r.secret);
              setUrl("");
              setEvents([]);
              void load();
            })
          }>
          <Plus size={12} weight="bold" /> Add endpoint
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(data?.available_events ?? []).map((ev) => (
          <button
            key={ev}
            onClick={() => setEvents(events.includes(ev) ? events.filter((x) => x !== ev) : [...events, ev])}
            aria-pressed={events.includes(ev)}
            className={cn(
              "focus-ring rounded-lg border px-2 py-1 font-mono text-[10px]",
              events.includes(ev) ? "border-accent bg-accent-soft text-accent-strong" : "border-line-strong text-ink-soft"
            )}
          >
            {ev}
          </button>
        ))}
      </div>

      {secretOnce && (
        <div className="rounded-xl border border-warn/30 bg-warn-soft p-3">
          <p className="text-xs font-medium text-warn">Signing secret (shown once):</p>
          <code className="mt-1 block break-all rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[11px]">{secretOnce}</code>
          <Button size="sm" variant="ghost" className="mt-1.5" onClick={() => setSecretOnce(null)}>Done</Button>
        </div>
      )}

      {data === null ? (
        <Skeleton className="h-24" />
      ) : data.endpoints.length === 0 ? (
        <EmptyState icon={<LinkIcon size={20} weight="light" />} title="No webhook endpoints" body="Add one above to receive signed correction/conflict events." />
      ) : (
        <div className="space-y-2">
          {data.endpoints.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
              <Plug size={14} weight="light" className="shrink-0 text-ink-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{e.url}</span>
              <span className="flex flex-wrap gap-1">
                {(JSON.parse(e.events) as string[]).map((ev) => (
                  <Chip key={ev}>{ev}</Chip>
                ))}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void api.deleteWebhook(wsId, e.id).then(load)}>
                <Trash size={12} weight="light" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Integrations ------------------------------ */

const PROVIDERS: Array<{ id: string; label: string; enterpriseOnly?: boolean }> = [
  { id: "slack", label: "Slack bot" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "gdrive", label: "Google Drive sync" },
  { id: "notion", label: "Notion sync" },
  { id: "confluence", label: "Confluence sync", enterpriseOnly: true },
  { id: "sharepoint", label: "SharePoint sync", enterpriseOnly: true },
  { id: "zapier", label: "Zapier / Make" },
];

function IntegrationsTab({ wsId, planTier }: { wsId: string; planTier: string }) {
  const [connections, setConnections] = useState<IntegrationConnectionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => api.integrations(wsId).then((r) => setConnections(r.connections)).catch((e) => { setError(e.message); setConnections([]); }),
    [wsId]
  );
  useEffect(() => {
    void load();
  }, [load]);

  const statusFor = (id: string) => connections?.find((c) => c.provider === id)?.sync_status;

  return (
    <div className="space-y-3">
      <p className="max-w-[68ch] text-[13px] leading-relaxed text-ink-soft">
        Connect records a per-workspace connection (credentials encrypted at rest, AES-256-GCM). In this local build{" "}
        <span className="font-medium text-ink">Slack</span> and <span className="font-medium text-ink">Zapier/webhooks</span> are
        fully functional; the other providers store the connection state and stay dormant until their vendor OAuth app
        credentials are configured.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const locked = p.enterpriseOnly && planTier !== "enterprise";
          const connected = statusFor(p.id) === "connected";
          return (
            <div key={p.id} className={cn("rounded-2xl border bg-surface p-4", locked ? "opacity-60" : "border-line")}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  {p.label}
                  {connected ? <Chip tone="accent">connected</Chip> : <Chip>not connected</Chip>}
                  {locked && <Chip tone="warn">enterprise</Chip>}
                </p>
                {!locked && (
                  <Button
                    size="sm"
                    variant={connected ? "ghost" : "primary"}
                    onClick={() =>
                      connected
                        ? void api.disconnectIntegration(wsId, p.id).then(load).catch((e) => setError(e.message))
                        : void api.connectIntegration(wsId, p.id).then(load).catch((e) => setError(e.message))
                    }
                  >
                    {connected ? "Disconnect" : "Connect"}
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{PROVIDER_HINTS[p.id]}</p>
            </div>
          );
        })}
      </div>
      <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-4 text-[12px] leading-relaxed text-ink-soft">
        <p className="mb-1 flex items-center gap-1.5 font-medium"><UsersThree size={13} weight="fill" /> Enterprise deployment (FR-44)</p>
        On-prem/private-cloud deployment runs this same app inside the customer VPC with <code className="font-mono text-[11px]">DATA_DIR</code>{" "}
        pointed at customer storage — all documents, embeddings and corrections remain in-environment. See the README section
        “On-prem deployment” for the checklist.
      </div>
    </div>
  );
}
