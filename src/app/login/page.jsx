"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [mode, setMode] = useState("otp"); // 'otp' | 'password'
  const [step, setStep] = useState("email"); // 'email' | 'code'  (otp mode)
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function requestCode(e) {
    e?.preventDefault?.();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Too many requests. Try again later.");
      } else if (!res.ok) {
        setError("Could not send code. Try again.");
      } else {
        setStep("code");
        setInfo(`We sent a 6-digit code to ${email.trim()}.`);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e) {
    e?.preventDefault?.();
    setLoading(true);
    setError("");
    const res = await signIn("otp", { email: email.trim(), code: code.trim(), redirect: false });
    if (res?.error || !res?.ok) {
      setError("Invalid or expired code");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  async function handlePassword(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">D</span>
          <span className="auth-brand-name">Dutify</span>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">
          {mode === "otp"
            ? "Sign in with a 6-digit code — same inbox as the mobile app."
            : "Sign in with your password."}
        </p>

        {error && (
          <div className="auth-error">
            <strong>Refused.</strong> {error}
          </div>
        )}
        {info && !error && <div className="auth-info">{info}</div>}

        {mode === "otp" && step === "email" && (
          <form onSubmit={requestCode} className="auth-form">
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <button type="submit" disabled={loading || !email.trim()} className="auth-submit">
              {loading ? "Sending…" : "Send code"}
              <span aria-hidden>→</span>
            </button>
          </form>
        )}

        {mode === "otp" && step === "code" && (
          <form onSubmit={verifyOtp} className="auth-form">
            <label className="auth-field">
              <span>6-digit code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                autoFocus
                required
              />
            </label>
            <button type="submit" disabled={loading || code.length !== 6} className="auth-submit">
              {loading ? "Verifying…" : "Verify & sign in"}
              <span aria-hidden>→</span>
            </button>
            <button
              type="button"
              className="auth-linkbtn"
              onClick={() => { setStep("email"); setCode(""); setError(""); setInfo(""); }}
            >
              ← Use a different email
            </button>
          </form>
        )}

        {mode === "password" && (
          <form onSubmit={handlePassword} className="auth-form">
            <label className="auth-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </label>
            <button type="submit" disabled={loading} className="auth-submit">
              {loading ? "Signing in…" : "Sign in"}
              <span aria-hidden>→</span>
            </button>
          </form>
        )}

        <div className="auth-foot">
          {mode === "otp" ? (
            <button type="button" className="auth-linkbtn" onClick={() => { setMode("password"); setError(""); setInfo(""); }}>
              Use password instead
            </button>
          ) : (
            <button type="button" className="auth-linkbtn" onClick={() => { setMode("otp"); setStep("email"); setError(""); setInfo(""); }}>
              Use email code instead
            </button>
          )}
          <span className="auth-sep">·</span>
          <a href="/register">Invite code →</a>
        </div>
      </div>

      <style jsx>{`
        .auth-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          background:
            radial-gradient(900px 500px at 15% 10%, rgba(156,168,138,0.08), transparent 60%),
            radial-gradient(1000px 600px at 100% 100%, rgba(19,41,75,0.25), transparent 55%),
            var(--bg);
        }
        .auth-card {
          width: 100%;
          max-width: 440px;
          background: var(--bg-card);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lift);
          padding: 40px 36px 32px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .auth-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .auth-brand-mark {
          width: 28px; height: 28px;
          border-radius: 8px;
          background: linear-gradient(145deg, var(--sage) 0%, var(--sage-dim) 100%);
          color: #0b0e13;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 15px;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 0 0 1px rgba(156,168,138,0.3);
        }
        .auth-brand-name {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 20px;
          letter-spacing: -0.01em;
          color: var(--text-primary);
        }
        .auth-brand-name::after {
          content: "";
          display: inline-block;
          width: 4px; height: 4px;
          background: var(--sage);
          border-radius: 50%;
          margin-left: 3px;
          vertical-align: top;
          margin-top: 4px;
        }
        .auth-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 28px;
          letter-spacing: -0.02em;
          color: var(--text-primary);
          margin: 0;
        }
        .auth-sub {
          color: var(--text-secondary);
          font-size: 14px;
          margin: 0 0 4px;
        }
        .auth-error {
          background: var(--terracotta-bg);
          border: 1px solid rgba(196,99,74,0.4);
          color: var(--terracotta);
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 13.5px;
        }
        .auth-info {
          background: rgba(156,168,138,0.12);
          border: 1px solid rgba(156,168,138,0.3);
          color: var(--sage-light);
          padding: 10px 14px;
          border-radius: var(--radius-md);
          font-size: 13px;
        }
        .auth-linkbtn {
          background: none;
          border: none;
          padding: 0;
          color: var(--sage-light);
          font-family: inherit;
          font-size: 13px;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .auth-linkbtn:hover { color: var(--sage); }
        .auth-sep { color: var(--text-muted); margin: 0 8px; }
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .auth-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .auth-field > span {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .auth-field input {
          height: 46px;
          padding: 0 16px;
          background: var(--bg-input);
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 14px;
          transition: border-color .12s ease, box-shadow .12s ease;
        }
        .auth-field input:focus {
          outline: none;
          border-color: var(--sage);
          box-shadow: 0 0 0 4px rgba(156,168,138,0.18);
        }
        .auth-field input::placeholder { color: var(--text-muted); }
        .auth-submit {
          margin-top: 6px;
          height: 52px;
          background: var(--navy);
          border: 1px solid var(--navy-light);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 14.5px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
        }
        .auth-submit:hover:not(:disabled) {
          background: var(--navy-light);
          transform: translateY(-1px);
          box-shadow: 0 6px 24px rgba(19,41,75,0.45);
        }
        .auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .auth-foot {
          text-align: center;
          padding-top: 8px;
          border-top: 1px solid var(--border-subtle);
          font-size: 13px;
          color: var(--text-secondary);
        }
        .auth-foot a {
          color: var(--sage);
          text-decoration: none;
          font-weight: 500;
        }
        .auth-foot a:hover { color: var(--sage-light); }
      `}</style>
    </main>
  );
}
