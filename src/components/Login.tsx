import { useState, type FormEvent } from "react";
import { AlertCircle, BarChart3, Eye, Lock, LogIn, User } from "lucide-react";

interface Props {
  onSignedIn: (username: string) => void;
  onPublic: () => void;
}

export function Login({ onSignedIn, onPublic }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return onSignedIn(body.username);
      setError(body.error ?? `Sign-in failed (${res.status}).`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="hero">
        <div className="hero-brand">
          <span className="mark large">RI</span>
          <div>
            <strong>RI <em>Campaign</em> Dashboard</strong>
            <small>Routine immunization field monitoring</small>
          </div>
        </div>
        <div className="hero-copy">
          <h1>See which settlements teams <em>reached</em>, and where the gaps remain.</h1>
          <p>
            Drill from LGA to ward to a single settlement across Lagos, and compare field visits
            with eTally reports to see which figures need checking.
          </p>
        </div>
        <div className="hero-foot">
          <div className="pills">
            <span>Settlement visits</span>
            <span>eTally</span>
            <span>Microplan grids</span>
          </div>
          <div className="powered">
            <span>Powered by</span>
            <img src="/eha-logo-white.png" alt="eHealth Africa" />
          </div>
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <span className="form-icon"><BarChart3 size={24} aria-hidden /></span>
          <h2>Welcome back</h2>
          <p className="sub">Sign in to see settlement-level data.</p>
          {error && (
            <div className="form-error" role="alert"><AlertCircle size={18} aria-hidden />{error}</div>
          )}
          <label htmlFor="username">Username</label>
          <div className="field">
            <User size={18} aria-hidden />
            <input id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <label htmlFor="password">Password</label>
          <div className="field">
            <Lock size={18} aria-hidden />
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="primary" disabled={busy}>
            <LogIn size={18} aria-hidden />{busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" className="secondary" onClick={onPublic}>
            <Eye size={18} aria-hidden />View public dashboard
          </button>
          <p className="help">Need access? Ask your state coordinator.</p>
        </form>
      </section>
    </div>
  );
}
