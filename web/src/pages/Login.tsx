import { useState } from "react";

export function LoginPage({ hasUsers, demoLogin, onSignedIn }: {
  hasUsers: boolean;
  demoLogin: { username: string; password: string } | null;
  onSignedIn: () => void;
}) {
  const [username, setUsername] = useState(demoLogin?.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Sign-in failed");
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="8" fill="var(--brand)" /><path d="M9 22c0-7 5-12 14-13-1 9-6 14-13 14" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </span>
          <span><strong>Aravi Ads</strong><small className="muted">Sign in to continue</small></span>
        </div>
        {!hasUsers ? (
          <p className="muted">
            No logins exist yet. On the machine running the dashboard, run
            <code className="cmd">npm run user:add -- krinesh</code>
            then come back and sign in.
          </p>
        ) : (
          <>
            <label className="field">
              Username
              <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!demoLogin} />
            </label>
            <label className="field">
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!demoLogin} />
            </label>
            {error && <p className="warn small" role="alert">{error}</p>}
            <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            {demoLogin && (
              <p className="muted small">Demo database: sign in as <code>{demoLogin.username}</code> / <code>{demoLogin.password}</code>.</p>
            )}
          </>
        )}
      </form>
    </div>
  );
}
