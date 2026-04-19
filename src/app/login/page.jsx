"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/calculator");
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        {/* Left column — identity */}
        <aside className="auth-aside">
          <div className="auth-brand">
            <span className="eyebrow">Grand-Duché de Luxembourg</span>
            <h1 className="auth-brand-name display display-md">
              Dutify<span className="auth-brand-amp">&amp;</span>Co.
            </h1>
            <p className="auth-brand-sub serif italic-serif">
              Bureau of Import Duty, Classification &amp; Excise.
              <br />
              Established for Luxembourg customs professionals.
            </p>
          </div>

          <div className="ornament">
            <span className="ornament-mark">§ § §</span>
          </div>

          <dl className="auth-ledger">
            <div>
              <dt>MFN &amp; Preferential</dt>
              <dd>TARIC SOAP verified</dd>
            </div>
            <div>
              <dt>HS Classification</dt>
              <dd>AI-assisted · CN10 probed</dd>
            </div>
            <div>
              <dt>Excise &amp; CBAM</dt>
              <dd>Schema-driven</dd>
            </div>
          </dl>

          <div className="auth-footmark num">
            Vol. XVII · Folio 04 · MMXXVI
          </div>
        </aside>

        {/* Right column — sign-in card */}
        <section className="auth-card">
          <header className="auth-card-head">
            <div className="seal seal-lg" aria-hidden>D</div>
            <span className="eyebrow">Entry &amp; Clearance</span>
            <h2 className="display display-sm">Sign in to your dossier</h2>
          </header>

          <hr className="hairline-double" />

          {error && (
            <div className="alert alert-danger mb-4">
              <div>
                <div className="alert-title">Refused</div>
                {error}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="stack-4">
            <div className="field-row--stack">
              <label className="field-label" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>

            <div className="field-row--stack">
              <label className="field-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-cta btn-lg w-full"
            >
              {loading ? "Verifying…" : "Enter the dossier"}
              <span aria-hidden>→</span>
            </button>
          </form>

          <footer className="auth-card-foot">
            <span className="muted">Invited to join?</span>{" "}
            <a href="/register" className="forest strong">Register with an invite code →</a>
          </footer>
        </section>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--sp-7) var(--gutter);
          background:
            radial-gradient(900px 500px at 15% 10%, rgba(184,145,74,0.08), transparent 60%),
            radial-gradient(1000px 600px at 100% 100%, rgba(31,59,45,0.06), transparent 55%),
            var(--paper-bone);
        }
        .auth-shell {
          width: 100%;
          max-width: 1080px;
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          background: var(--paper-cream);
          border: 1px solid var(--rule-hair);
          border-bottom: 3px solid var(--brass);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lift);
          overflow: hidden;
        }
        .auth-aside {
          padding: var(--sp-8) var(--sp-7);
          background:
            linear-gradient(180deg, var(--paper-cream) 0%, var(--paper-bone) 100%);
          position: relative;
          display: flex;
          flex-direction: column;
        }
        .auth-aside::before {
          content: "";
          position: absolute;
          inset: var(--sp-4);
          border: 1px solid var(--rule-hair);
          border-radius: var(--radius-sm);
          pointer-events: none;
        }
        .auth-brand { position: relative; z-index: 1; }
        .auth-brand-name {
          margin-top: var(--sp-2);
          color: var(--ink-forest-deep);
        }
        .auth-brand-amp {
          color: var(--brass);
          font-style: italic;
          margin: 0 0.1em;
          font-variation-settings: "opsz" 72, "SOFT" 50;
        }
        .auth-brand-sub {
          margin-top: var(--sp-3);
          color: var(--ink-muted);
          font-size: var(--fs-md);
          max-width: 32ch;
          line-height: 1.5;
        }
        .auth-ledger {
          position: relative;
          z-index: 1;
          margin-top: auto;
          display: grid;
          gap: var(--sp-3);
        }
        .auth-ledger > div {
          display: flex;
          justify-content: space-between;
          gap: var(--sp-3);
          padding: var(--sp-2) 0;
          border-bottom: 1px solid var(--rule-soft);
          align-items: baseline;
        }
        .auth-ledger dt {
          font-family: var(--font-body);
          font-size: var(--fs-xs);
          text-transform: uppercase;
          letter-spacing: var(--track-label);
          color: var(--ink-muted);
        }
        .auth-ledger dd {
          font-family: var(--font-mono);
          font-size: var(--fs-xs);
          color: var(--ink-forest-deep);
        }
        .auth-footmark {
          position: relative;
          z-index: 1;
          margin-top: var(--sp-6);
          font-size: 10px;
          letter-spacing: 0.3em;
          color: var(--brass-deep);
          text-transform: uppercase;
        }
        .auth-card {
          padding: var(--sp-8) var(--sp-7);
          display: flex;
          flex-direction: column;
          gap: var(--sp-5);
          background:
            radial-gradient(600px 400px at 100% 0%, rgba(184,145,74,0.05), transparent 60%),
            var(--paper-cream);
        }
        .auth-card-head {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--sp-3);
        }
        .auth-card-head .seal { margin-bottom: var(--sp-2); }
        .auth-card-head h2 { color: var(--ink-forest-deep); line-height: 1.1; }
        .auth-card-foot {
          margin-top: var(--sp-3);
          padding-top: var(--sp-4);
          border-top: 1px solid var(--rule-soft);
          font-size: var(--fs-sm);
        }
        @media (max-width: 860px) {
          .auth-shell { grid-template-columns: 1fr; }
          .auth-aside { padding: var(--sp-7) var(--sp-5); }
          .auth-aside::before { inset: var(--sp-3); }
          .auth-card { padding: var(--sp-7) var(--sp-5); }
        }
      `}</style>
    </main>
  );
}
