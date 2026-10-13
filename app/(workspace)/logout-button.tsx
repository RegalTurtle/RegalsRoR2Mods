"use client";
import { useState } from "react";

export default function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="flex items-center gap-2">
    {error && <span role="alert" className="text-sm text-[var(--danger)]">{error}</span>}
    <button className="small-button" type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error();
        window.location.assign("/login");
      } catch { setError("Logout failed. Try again."); setBusy(false); }
    }}>{busy ? "Logging out…" : "Log out"}</button>
  </div>;
}
