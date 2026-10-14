"use client";

import Image from "next/image";
import { useState } from "react";

type Pack = { id: string; name: string; modIds: string[] };
type Mod = { id: string; name: string; owner: string; description: string; version: string; thumbnailUrl: string; url: string };

export default function ModpackComparison({ current, packs, mods, onClose }: {
  current: Pack; packs: Pack[]; mods: Mod[]; onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const others = packs.filter((pack) => pack.id !== current.id);
  const other = others.find((pack) => pack.id === selectedId) ?? others[0];
  const currentIds = new Set(current.modIds);
  const otherIds = new Set(other?.modIds ?? []);
  const missing = [...otherIds].filter((id) => !currentIds.has(id));
  const shared = [...otherIds].filter((id) => currentIds.has(id)).length;
  const catalog = new Map(mods.map((mod) => [mod.id, mod]));
  const search = query.trim().toLowerCase();
  const visible = missing.filter((id) => {
    const mod = catalog.get(id);
    return !search || [id, mod?.name, mod?.owner, mod?.description].join(" ").toLowerCase().includes(search);
  }).sort((a, b) => (catalog.get(a)?.name ?? a).localeCompare(catalog.get(b)?.name ?? b));

  return <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold">Compare modpacks</h2>
      <button className="small-button" type="button" onClick={onClose}>Close comparison</button>
    </div>
    <p className="mt-3 force-wrap text-sm text-[var(--secondary)]">Current modpack: <strong>{current.name}</strong></p>
    {other ? <>
      <label className="field-label" htmlFor="comparison-pack">Compare with</label>
      <select id="comparison-pack" className="text-field" value={other.id} onChange={(event) => { setSelectedId(event.target.value); setQuery(""); }}>
        {others.map((pack) => <option value={pack.id} key={pack.id}>{pack.name}</option>)}
      </select>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded bg-[var(--selected)] p-3"><strong className="block text-xl text-[var(--accent-light)]">{missing.length}</strong>Missing from current</div>
        <div className="rounded bg-[var(--surface-hover)] p-3"><strong className="block text-xl">{shared}</strong>Shared mods</div>
      </div>
      <p className="mt-4 force-wrap text-sm">Mods in <strong>{other.name}</strong> that are not in <strong>{current.name}</strong>.</p>
      <p className="mt-1 text-xs text-[var(--muted)]">Compares full mod lists, regardless of the center panel&apos;s filters.</p>
      <label className="field-label" htmlFor="comparison-search">Search missing mods</label>
      <input id="comparison-search" className="text-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mod or author" />
      <p className="my-3 text-xs text-[var(--muted)]" role="status">Showing {visible.length} of {missing.length} missing mods</p>
      <ul className="grid gap-2">{visible.map((id) => {
        const mod = catalog.get(id);
        return <li className="rounded border border-[var(--border)] bg-[var(--input)] p-3" key={id}>
          <div className="flex items-start gap-3">
            {mod?.thumbnailUrl && <Image src={mod.thumbnailUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded object-cover" />}
            <div className="min-w-0">
              {mod ? <a href={mod.url} target="_blank" rel="noreferrer" className="force-wrap font-bold text-[var(--accent-light)]">{mod.name}</a> : <strong className="force-wrap">{id}</strong>}
              {mod && <p className="force-wrap text-xs text-[var(--muted)]">by {mod.owner} · v{mod.version}</p>}
            </div>
          </div>
          {mod && <p className="mt-2 line-clamp-2 text-xs text-[var(--secondary)]">{mod.description}</p>}
        </li>;
      })}</ul>
      {!missing.length && <p className="mt-3 text-sm">All mods in {other.name} are already in {current.name}.</p>}
      {missing.length > 0 && !visible.length && <p className="mt-3 text-sm">No missing mods match your search.</p>}
    </> : <p className="mt-4 text-sm text-[var(--muted)]">No other modpacks are available to compare.</p>}
  </section>;
}
