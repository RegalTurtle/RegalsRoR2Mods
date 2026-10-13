"use client";

import { useState } from "react";
import { createTwoFilesPatch, diffLines } from "diff";
import type { ConfigTemplate } from "@/lib/profile-export";

type Snapshot = { current: ConfigTemplate; other: ConfigTemplate; otherName: string };

export default function ConfigComparison({ modId, packId, packName, sources, disabled }: {
  modId: string; packId: string; packName: string; sources: { id: string; name: string }[]; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ignoreLineEndings, setIgnoreLineEndings] = useState(true);
  const effectiveId = sources.some((source) => source.id === sourceId) ? sourceId : sources[0]?.id ?? "";
  async function compare() {
    setBusy(true); setError(""); setSnapshot(null);
    try {
      const read = async (id: string) => {
        const response = await fetch(`/api/mod-configs?packId=${encodeURIComponent(id)}&modId=${encodeURIComponent(modId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load saved configs for comparison.");
        const config = ((await response.json()).configs as ConfigTemplate[])[0];
        if (!config) throw new Error("Both modpacks must have a saved config for this mod.");
        return config;
      };
      const [current, other] = await Promise.all([read(packId), read(effectiveId)]);
      setSnapshot({ current, other, otherName: sources.find((source) => source.id === effectiveId)?.name ?? effectiveId });
    } catch (err) { setError(err instanceof Error ? err.message : "Comparison failed."); }
    finally { setBusy(false); }
  }
  const normalize = (content: string) => ignoreLineEndings ? content.replace(/\r\n|\r/g, "\n") : content;
  const currentText = snapshot ? normalize(snapshot.current.content) : "";
  const otherText = snapshot ? normalize(snapshot.other.content) : "";
  const changes = diffLines(currentText, otherText);
  const added = changes.filter((change) => change.added).reduce((total, change) => total + (change.count ?? 0), 0);
  const removed = changes.filter((change) => change.removed).reduce((total, change) => total + (change.count ?? 0), 0);
  const patch = snapshot ? createTwoFilesPatch(`${packName}/${snapshot.current.path}`, `${snapshot.otherName}/${snapshot.other.path}`,
    currentText, otherText, `mod version: ${snapshot.current.sourceVersion ?? "Unknown"}`, `mod version: ${snapshot.other.sourceVersion ?? "Unknown"}`, { context: 3 }) : "";

  return <div className="mt-3">
    <button className="small-button" type="button" disabled={disabled || busy} aria-expanded={open} onClick={() => setOpen((value) => !value)}>Compare with</button>
    {open && <div className="mt-2 rounded border border-[var(--border)] p-3">
      <p className="mb-2 text-xs text-[var(--muted)]">Compares saved configs. Save your edits first. Minus lines are from this modpack; plus lines are from the selected modpack.</p>
      {sources.length ? <>
        <label className="text-sm font-bold">Other modpack<select className="text-field mt-1" value={effectiveId} disabled={busy} onChange={(event) => { setSourceId(event.target.value); setSnapshot(null); setError(""); }}>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select></label>
        <button className="small-button mt-2" type="button" disabled={busy || disabled || !effectiveId} onClick={compare}>{busy ? "Comparing…" : "Compare saved configs"}</button>
        <label className="checkbox-row mt-2"><input type="checkbox" checked={ignoreLineEndings} onChange={(event) => setIgnoreLineEndings(event.target.checked)} />Ignore line-ending differences (CRLF/LF)</label>
      </> : <p className="text-sm text-[var(--muted)]">No other modpacks have a saved config for this mod.</p>}
      {error && <p className="mt-2 text-sm text-[var(--danger)]" role="alert">{error}</p>}
      {snapshot && <>
        <p className="mt-3 force-wrap text-sm font-bold">{packName}: {snapshot.current.path} → {snapshot.otherName}: {snapshot.other.path}</p>
        <p className="my-2 text-sm" role="status">{added || removed ? `${added} added, ${removed} removed lines` : "Config contents are identical."}</p>
        <pre className="config-diff" aria-label="Unified config diff">{patch.split("\n").map((line, index) => <span key={index} className={line.startsWith("+++") || line.startsWith("---") ? "diff-header" : line.startsWith("+") ? "diff-added" : line.startsWith("-") ? "diff-removed" : line.startsWith("@@") ? "diff-hunk" : ""}>{line || " "}</span>)}</pre>
      </>}
    </div>}
  </div>;
}
