"use client";

import { useState } from "react";

export default function MagicLinkForm({ nextPath = "/brief" }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next: nextPath }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      setMessage(payload.message ?? payload.error ?? "Unable to send sign-in link.");
    } catch {
      setMessage("Unable to reach the sign-in service.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="email">Work email</label>
      <input id="email" type="email" autoComplete="email" required value={email}
        onChange={(event) => setEmail(event.target.value)} placeholder="you@studio.com" />
      <button className="button primary" disabled={sending} type="submit">
        {sending ? "Sending..." : "Email me a sign-in link"}
      </button>
      {message && <p className="form-message" role="status">{message}</p>}
    </form>
  );
}
