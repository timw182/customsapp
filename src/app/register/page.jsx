"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const FIELDS = [
  { key: "name",       label: "Full Name",    type: "text",     auto: "name" },
  { key: "email",      label: "Email",        type: "email",    auto: "email" },
  { key: "password",   label: "Password",     type: "password", auto: "new-password" },
  { key: "inviteCode", label: "Invite Code",  type: "text",     auto: "off", mono: true },
];

export default function RegisterPage() {
  const [form, setForm] = useState({ email: "", name: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      setLoading(false);
    } else {
      router.push("/login?registered=1");
    }
  }

  return (
    <main className="auth-page">
      <div className="reg-shell">
        <header className="reg-head">
          <span className="eyebrow">Form R-01 · Admittance by invite</span>
          <h1 className="display display-md">Register a new dossier</h1>
          <p className="serif italic-serif muted">
            Complete every field below. Your invite code is verified against the registrar before issuance.
          </p>
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
          {FIELDS.map(({ key, label, type, auto, mono }, i) => (
            <div className="field-row--stack" key={key}>
              <label className="field-label" htmlFor={`reg-${key}`}>
                <span className="reg-field-num">{String(i + 1).padStart(2, "0")}</span>
                {label}
                <span className="req">*</span>
              </label>
              <input
                id={`reg-${key}`}
                type={type}
                name={key}
                value={form[key]}
                onChange={update(key)}
                autoComplete={auto}
                required
                style={mono ? { fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" } : undefined}
              />
            </div>
          ))}

          <button
            type="submit"
            disabled={loading}
            className="btn btn-cta btn-lg w-full mt-3"
          >
            {loading ? "Issuing credentials…" : "Issue the dossier"}
            <span aria-hidden>→</span>
          </button>
        </form>

        <footer className="reg-foot">
          Already admitted? <a href="/login" className="forest strong">Sign in →</a>
        </footer>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--sp-7) var(--gutter);
          background:
            radial-gradient(900px 500px at 50% 10%, rgba(184,145,74,0.08), transparent 60%),
            var(--paper-bone);
        }
        .reg-shell {
          width: 100%;
          max-width: 560px;
          background: var(--paper-cream);
          border: 1px solid var(--rule-hair);
          border-top: 3px solid var(--brass);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lift);
          padding: var(--sp-8) var(--sp-7);
          position: relative;
        }
        .reg-shell::before {
          content: "";
          position: absolute;
          inset: var(--sp-3);
          border: 1px solid var(--rule-hair);
          border-radius: var(--radius-sm);
          pointer-events: none;
        }
        .reg-head { position: relative; z-index: 1; display: flex; flex-direction: column; gap: var(--sp-3); margin-bottom: var(--sp-5); }
        .reg-head h1 { color: var(--ink-forest-deep); }
        .reg-head p { max-width: 48ch; line-height: 1.5; }
        .reg-field-num {
          font-family: var(--font-mono);
          color: var(--brass-deep);
          font-size: 10px;
          margin-right: 6px;
          letter-spacing: 0.12em;
        }
        .reg-foot {
          margin-top: var(--sp-5);
          padding-top: var(--sp-4);
          border-top: 1px solid var(--rule-soft);
          font-size: var(--fs-sm);
          text-align: center;
        }
        @media (max-width: 640px) {
          .reg-shell { padding: var(--sp-7) var(--sp-5); }
          .reg-shell::before { inset: var(--sp-2); }
        }
      `}</style>
    </main>
  );
}
