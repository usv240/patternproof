"use client";

import { useState } from "react";

type GuestWorkspaceButtonProps = {
  className?: string;
  children?: React.ReactNode;
};

export default function GuestWorkspaceButton({
  className = "button primary",
  children = "Use my photos",
}: GuestWorkspaceButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "We could not prepare a private workspace.",
        );
      }
      window.location.assign("/brief/new");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
      setBusy(false);
    }
  }

  return (
    <span className="guest-start">
      <button className={className} type="button" onClick={start} disabled={busy}>
        {busy ? "Preparing your private workspace..." : children}
      </button>
      {message && <small role="alert">{message}</small>}
    </span>
  );
}
