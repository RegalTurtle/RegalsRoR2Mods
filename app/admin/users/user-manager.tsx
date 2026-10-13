"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AccountAccess } from "@/lib/access";

type User = AccountAccess & { id: string; username: string };
type Item = { id: string; name: string };
const blank = { allPacks: false, allGroups: false, packIds: [] as string[], groupIds: [] as string[] };
type Permissions = typeof blank;

function AccessEditor({ value, onChange, packs, groups }: { value: Permissions; onChange: (value: Permissions) => void; packs: Item[]; groups: Item[] }) {
  return <div className="mt-3 grid gap-4 sm:grid-cols-2">{([{ title: "Modpacks", all: "allPacks", ids: "packIds", items: packs }, { title: "Collections", all: "allGroups", ids: "groupIds", items: groups }] as const).map(({ title, all, ids, items }) => <fieldset key={title} className="rounded border border-[var(--border)] p-3">
    <legend className="px-1 font-bold">{title}</legend>
    <label className="checkbox-row"><input type="checkbox" checked={value[all]} onChange={(event) => onChange({ ...value, [all]: event.target.checked })} />All, including future {title.toLowerCase()}</label>
    {items.map((item) => <label className="checkbox-row" key={item.id}><input type="checkbox" disabled={value[all]} checked={value[all] || value[ids].includes(item.id)} onChange={() => onChange({ ...value, [ids]: value[ids].includes(item.id) ? value[ids].filter((id) => id !== item.id) : [...value[ids], item.id] })} />{item.name}</label>)}
    {!items.length && <p className="text-sm text-[var(--muted)]">None available.</p>}
  </fieldset>)}</div>;
}

export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [packs, setPacks] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Item[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Permissions>>({});
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState<Permissions>(blank);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load accounts");
    setUsers(data.users); setPacks(data.packs); setGroups(data.groups);
    setDrafts(Object.fromEntries(data.users.map((user: User) => [user.id, { allPacks: user.allPacks, allGroups: user.allGroups, packIds: user.packIds, groupIds: user.groupIds }])));
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((error) => setMessage(error.message)).finally(() => setBusy(false)); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function mutate(method: string, body: unknown, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Account action failed");
      if (method === "POST") { setUsername(""); setPassword(""); setAccess(blank); }
      await load(); setMessage(success);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Account action failed"); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-5xl p-6">
    <Link href="/" className="text-[var(--accent-light)]">← Back to modpacks</Link>
    <h1 className="mt-4 text-3xl font-bold">Manage users</h1>
    <p className="mt-2 text-sm text-[var(--muted)]">Choose the modpacks and collections each account can view. Members can edit and download permitted modpacks. Administrators also manage collections and users.</p>
    <p className="my-3 text-sm" role="status">{message || (busy ? "Loading…" : "")}</p>
    <form className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5" onSubmit={(event) => { event.preventDefault(); void mutate("POST", { username, password, ...access }, "Account created."); }}>
      <h2 className="text-xl font-bold">Create account</h2>
      <fieldset disabled={busy}>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Username<input className="text-field mt-1" required pattern="[A-Za-z0-9_-]+" maxLength={64} autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="text-sm font-bold">Password<input className="text-field mt-1" type="password" required minLength={12} maxLength={1024} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><span className="text-xs text-[var(--muted)]">At least 12 characters.</span></label></div>
        <AccessEditor value={access} onChange={setAccess} packs={packs} groups={groups} />
        <button className="small-button mt-4" type="submit">Create account</button>
      </fieldset>
    </form>
    <div className="mt-5 grid gap-4">{users.map((user) => <section key={user.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-lg font-bold">{user.username} <span className="text-sm text-[var(--muted)]">{user.role === "admin" ? "Administrator" : "Member"}</span></h2>
      {user.role === "admin" ? <p className="mt-2 text-sm text-[var(--muted)]">Full access. Administrator accounts are protected from deletion and permission changes here.</p> : <fieldset disabled={busy}>
        <AccessEditor value={drafts[user.id] ?? blank} onChange={(value) => setDrafts((current) => ({ ...current, [user.id]: value }))} packs={packs} groups={groups} />
        <div className="mt-4 flex gap-3"><button className="small-button" type="button" onClick={() => mutate("PATCH", { id: user.id, ...drafts[user.id] }, "Permissions saved.")}>Save access</button>
          <button className="small-button" type="button" onClick={() => { if (window.confirm(`Delete account ${user.username}? They will lose access immediately.`)) void mutate("DELETE", { id: user.id }, "Account deleted."); }}>Delete account</button></div>
      </fieldset>}
    </section>)}</div>
  </main>;
}
