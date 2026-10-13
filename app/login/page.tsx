"use client";
import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="flex min-h-dvh items-center justify-center p-5">
    <form className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--panel)] p-7 shadow-xl" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError("");
      try {
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Login failed");
        const next = new URLSearchParams(window.location.search).get("next");
        // Same-origin routes only; never forward to an arbitrary URL.
        window.location.assign(next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !/[\x00-\x1f]/.test(next) ? next : "/");
      } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); setBusy(false); }
    }}>
      <p className="text-xs font-bold uppercase tracking-widest text-[var(--accent-light)]">Regal&apos;s Risk of Rain 2</p>
      <h1 className="mt-2 text-2xl font-bold">Log in</h1>
      <label className="field-label" htmlFor="username">Username</label>
      <input id="username" className="text-field" autoComplete="username" required maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)} />
      <label className="field-label" htmlFor="password">Password</label>
      <input id="password" className="text-field" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      <button className="command-button mt-5 w-full" type="submit" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
    </form>
  </main>;
}
