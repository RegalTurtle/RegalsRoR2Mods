"use client";
import { useRef, useState } from "react";
import { editConfig, parseConfig } from "@/lib/mod-config";
import type { ConfigTemplate } from "@/lib/profile-export";
import ConfigComparison from "./config-comparison";

export default function ModConfigPanel({ modId, version, packId = "", packName = packId, hasConfig = false, canEdit = true }: { modId: string; version: string; packId?: string; packName?: string; hasConfig?: boolean; canEdit?: boolean }) {
  const [path, setPath] = useState("");
  const [versions, setVersions] = useState(version);
  const [content, setContent] = useState("");
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ id: string; name: string }[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [hasSavedConfig, setHasSavedConfig] = useState(false);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [showImport, setShowImport] = useState(false);
  const initializedTargets = useRef(false);
  const settings = parseConfig(content);
  async function load() {
    setBusy(true);
    try {
      const response = await fetch(`/api/mod-configs?modId=${encodeURIComponent(modId)}&packId=${encodeURIComponent(packId)}`);
      if (!response.ok) throw new Error("Unable to load saved configs.");
      const data = await response.json() as { configs: ConfigTemplate[]; targets: { id: string; name: string }[]; sources: { id: string; name: string }[] };
      const config = data.configs[0];
      setHasSavedConfig(Boolean(config));
      setTargets(data.targets);
      setSources(data.sources);
      setSourceId((current) => data.sources.some((source) => source.id === current) ? current : data.sources[0]?.id ?? "");
      if (!initializedTargets.current) { setSelectedTargets(data.targets.map((target) => target.id)); initializedTargets.current = true; }
      if (config) { setPath(config.path); setVersions(config.sourceVersion ?? version); setContent(config.content); setEdits({}); }
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  async function importConfig() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/mod-configs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: sourceId, modId, targetIds: [packId] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Import failed.");
      if (data.copied !== 1) throw new Error("The modpack no longer contains this mod. Reload and try again.");
      await load();
      setShowImport(false);
      setMessage("Config imported and saved to this modpack.");
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  async function copy() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/mod-configs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId, modId, targetIds: selectedTargets.filter((id) => targets.some((target) => target.id === id)) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Copy failed.");
      setMessage(`Saved config copied to ${data.copied} modpack${data.copied === 1 ? "" : "s"}.`);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setMessage("");
    try {
      for (const setting of settings) {
        const value = edits[setting.line];
        if (value === undefined) continue;
        if (setting.choices.length && !setting.choices.includes(value)) throw new Error(`Choose an allowed value for ${setting.name}.`);
        if (/^(Int\d*|UInt\d*|Single|Double|Decimal)$/i.test(setting.type) && (!value.trim() || !Number.isFinite(Number(value)))) throw new Error(`Enter a number for ${setting.name}.`);
      }
      const next = editConfig(content, edits);
      const response = await fetch("/api/mod-configs", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId, modId, path, sourceVersion: versions.trim(), content: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed.");
      setContent(next); setEdits({}); await load(); setMessage("Config saved.");
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  return <details className="mod-config-dropdown" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary>Config {(hasSavedConfig || hasConfig) && <span className="ml-2 text-[var(--accent-light)]" title="Saved config available" aria-label="Saved config available">✓</span>}</summary>
    <div className="p-4">
      <p className="mb-3 text-sm text-[var(--muted)]">Saved for this modpack. Paste a BepInEx .cfg file to build its settings menu.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">Filename / relative subfolder<input className="text-field mt-1" readOnly={!canEdit} value={path} placeholder="Author.Mod.cfg" onChange={(event) => setPath(event.target.value)} /></label>
        <label className="text-sm font-bold">Config from mod version<input className="text-field mt-1" readOnly={!canEdit} value={versions} placeholder="1.2.3" onChange={(event) => setVersions(event.target.value)} /><span className="mt-1 block text-xs font-normal">Used for all mod versions until you save a replacement.</span></label>
      </div>
      <details className="mt-3" open={!content}><summary className="cursor-pointer font-bold">Import / edit config text</summary><textarea className="review-notes mt-2 font-mono text-xs" aria-label="Config file content" readOnly={!canEdit} value={content} onChange={(event) => { setContent(event.target.value); setEdits({}); }} placeholder="Paste the full config file here, including sections and comments." /></details>
      {[...new Set(settings.map((setting) => setting.section))].map((section) => <fieldset className="mt-4 rounded border border-[var(--border)] p-3" key={section}><legend className="px-1 font-bold">{section}</legend>
        {settings.filter((setting) => setting.section === section).map((setting) => <label className="mb-3 block text-sm" key={setting.line}><span className="font-bold">{setting.name}</span>{setting.description && <span className="my-1 block whitespace-pre-wrap text-xs text-[var(--muted)]">{setting.description}</span>}
          {/Boolean/i.test(setting.type) || /^(true|false)$/i.test(setting.value) || setting.choices.length ? <select disabled={!canEdit} className="text-field mt-1" value={edits[setting.line] ?? setting.value} onChange={(event) => setEdits((current) => ({ ...current, [setting.line]: event.target.value }))}>
            {[...new Set([setting.value, ...(setting.choices.length ? setting.choices : ["true", "false"])])].map((value) => <option key={value}>{value}</option>)}
          </select> : <input readOnly={!canEdit} className="text-field mt-1" value={edits[setting.line] ?? setting.value} onChange={(event) => setEdits((current) => ({ ...current, [setting.line]: event.target.value }))} />}
        </label>)}
      </fieldset>)}
      {content && !settings.length && <p className="mt-2 text-sm">No section/key settings detected. The original file can still be saved.</p>}
      <button className="small-button mt-3" type="button" disabled={!canEdit || busy || !content || !path} onClick={save}>{busy ? "Working…" : "Save config"}</button>
      <button className="small-button mt-3 ml-2" type="button" disabled={!canEdit || busy} aria-expanded={showImport} onClick={() => setShowImport((current) => !current)}>Import from</button>
      {showImport && <div className="mt-2 rounded border border-[var(--border)] p-3">
        {sources.length ? <>
          <label className="text-sm font-bold">Source modpack<select className="text-field mt-1" value={sourceId} disabled={busy} onChange={(event) => setSourceId(event.target.value)}>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
          </select></label>
          <p className="mt-2 text-xs text-[var(--muted)]">Imports the saved config, filename, and source version. Replaces the current config and unsaved edits.</p>
          <button className="small-button mt-2" type="button" disabled={!canEdit || busy || !sourceId} onClick={importConfig}>Import config</button>
        </> : <p className="text-sm text-[var(--muted)]">No other modpacks have a saved config for this mod.</p>}
      </div>}
      <ConfigComparison modId={modId} packId={packId} packName={packName} sources={sources} disabled={busy} />
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <p className="mb-2 text-sm font-bold">Copy to other modpacks</p>
        <p className="mb-2 text-xs text-[var(--muted)]">Copies the saved config and replaces this mod’s config in each selected modpack. Save your edits first.</p>
        {targets.length ? <>
          <details className="filter-dropdown"><summary>{selectedTargets.filter((id) => targets.some((target) => target.id === id)).length} of {targets.length} modpacks selected</summary>
            <div className="checkbox-list">{targets.map((target) => <label className="checkbox-row" key={target.id}>
              <input type="checkbox" disabled={busy} checked={selectedTargets.includes(target.id)} onChange={() => setSelectedTargets((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])} />
              <span>{target.name}</span>
            </label>)}</div>
          </details>
          <button className="small-button mt-2" type="button" disabled={!canEdit || busy || !hasSavedConfig || !selectedTargets.some((id) => targets.some((target) => target.id === id))} onClick={copy}>Copy saved config</button>
        </> : <p className="text-sm text-[var(--muted)]">No other modpacks contain this mod.</p>}
      </div>
      <p className="mt-2 text-sm" role="status">{message}</p>
    </div>
  </details>;
}
