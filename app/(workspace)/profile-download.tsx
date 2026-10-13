"use client";

import { useState } from "react";
import { buildProfileArchive, resolveProfile, type ProfileMod, type ProfilePackage, type ConfigTemplate } from "@/lib/profile-export";
import { configTemplates } from "@/lib/config-templates";

type ExportPack = { id: string; name: string; modIds: string[]; curatedVersions?: Record<string, string> };

export default function ProfileDownload({ pack }: { pack: ExportPack }) {
  const [resolved, setResolved] = useState<ProfileMod[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // A changed membership/version list invalidates an earlier validation.
  const signature = JSON.stringify([pack.name, pack.modIds]);
  const [validatedSignature, setValidatedSignature] = useState("");
  const ready = resolved !== null && validatedSignature === signature;

  async function loadCatalog() {
    const response = await fetch("https://thunderstore.io/c/riskofrain2/api/v1/package/", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to fetch current Thunderstore versions. Try again.");
    const data = await response.json() as ProfilePackage[];
    if (!Array.isArray(data)) throw new Error("Invalid Thunderstore response.");
    return data;
  }

  async function loadConfigs() {
    const response = await fetch(`/api/mod-configs?packId=${encodeURIComponent(pack.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load configs. Export stopped to avoid missing settings.");
    const data = await response.json() as { configs: ConfigTemplate[] };
    return [...configTemplates, ...data.configs];
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Profile export failed."); setResolved(null); }
    finally { setBusy(false); }
  }

  async function validate() {
    const data = await loadCatalog();
    const mods = resolveProfile(pack.modIds, data);
    buildProfileArchive(pack.name, mods, await loadConfigs());
    setResolved(mods); setValidatedSignature(signature);
    setMessage(`${mods.length} mods including dependencies validated.`);
  }

  async function download() {
    // Recheck availability immediately before creating the download.
    const data = await loadCatalog();
    const mods = resolveProfile(pack.modIds, data);
    const archive = buildProfileArchive(pack.name, mods, await loadConfigs());
    const url = URL.createObjectURL(new Blob([new Uint8Array(archive).buffer], { type: "application/zip" }));
    const link = document.createElement("a"); link.href = url; link.download = `${pack.name}.r2z`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    setMessage("Profile downloaded. In r2modman, use Import profile → From file.");
  }

  return <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
    <h2 className="text-lg font-bold">Download r2modman profile</h2>
    <p className="mt-1 text-sm text-[var(--muted)]">Profile: {pack.name}. All {pack.modIds.length} modpack mods and required dependencies are included automatically, using their latest available versions.</p>
    <p className="mt-3 text-sm text-[var(--muted)]">Saved configs for the resolved mods will be included. Expand the Config panel for a mod to import or edit its files.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="small-button" disabled={busy || !pack.modIds.length} onClick={() => run(validate)}>{busy ? "Working…" : "Validate profile"}</button>
      <button type="button" className="small-button" disabled={busy || !ready} onClick={() => run(download)}>Download .r2z</button>
    </div>
    {error && <p role="alert" className="mt-3 force-wrap text-sm text-[var(--danger)]">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {ready && resolved && <details className="mt-3"><summary className="cursor-pointer text-sm font-bold">Resolved versions ({resolved.length})</summary><ul className="mt-2 text-xs">{resolved.map((mod) => <li key={mod.name}>{mod.name} — {mod.version.major}.{mod.version.minor}.{mod.version.patch}</li>)}</ul></details>}
  </div>;
}
