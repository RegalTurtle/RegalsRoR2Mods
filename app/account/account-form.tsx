"use client";
import Link from "next/link";
import { useState } from "react";

export default function AccountForm({ username: initialUsername }: { username: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return <main className="mx-auto w-full max-w-lg p-6">
    <Link href="/" className="text-[var(--accent-light)]">← Back to modpacks</Link>
    <form className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6" onSubmit={async (event) => {
      event.preventDefault(); setError(""); setSaved(false);
      if (newPassword !== confirmation) { setError("New passwords do not match."); return; }
      setBusy(true);
      try {
        const response = await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, currentPassword, newPassword }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Account update failed");
        setUsername(data.username); setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setSaved(true);
      } catch (err) { setError(err instanceof Error ? err.message : "Account update failed"); }
      finally { setBusy(false); }
    }}>
      <h1 className="text-2xl font-bold">Account settings</h1>
      <fieldset disabled={busy}>
        <label className="field-label" htmlFor="account-username">Username</label>
        <input className="text-field" id="account-username" required maxLength={64} pattern="[A-Za-z0-9_-]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label className="field-label" htmlFor="current-password">Current password</label>
        <input className="text-field" id="current-password" required type="password" maxLength={1024} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <label className="field-label" htmlFor="new-password">New password</label>
        <input className="text-field" id="new-password" type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <p className="mt-1 text-xs text-[var(--muted)]">Leave blank to keep your password. New passwords need at least 12 characters.</p>
        <label className="field-label" htmlFor="confirm-password">Confirm new password</label>
        <input className="text-field" id="confirm-password" type="password" required={Boolean(newPassword)} maxLength={1024} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        <button className="small-button mt-5" type="submit">{busy ? "Saving…" : "Save account"}</button>
      </fieldset>
      {error && <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p>}
      {saved && <p className="mt-3 text-sm" role="status">Account updated. Other sessions were signed out if you changed your password.</p>}
    </form>
  </main>;
}
