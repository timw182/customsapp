"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputStyle = {
  width: "100%",
  background: "#f0f7f4",
  border: "1px solid rgba(0,0,0,0.1)",
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 15,
  color: "#111827",
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  color: "#6b7280",
  marginBottom: 6,
};

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
    <div style={{ minHeight: "100vh", background: "#f0f7f4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      {/* Blobs */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        <div className="auth-blob auth-blob-3" />
      </div>

      {/* Card */}
      <div style={{ position: "relative", zIndex: 1, width: 420, maxWidth: "calc(100vw - 40px)", padding: "44px 44px 40px", background: "#fff", borderRadius: 20, boxShadow: "0 0 0 1px rgba(0,0,0,0.06), 0 20px 60px rgba(0,0,0,0.1)" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
          <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="14" fill="#10b981"/>
            <rect x="25" y="10" width="6" height="16" rx="3" fill="white"/>
            <path d="M14 22L28 38L42 22" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="12" y="42" width="32" height="4" rx="2" fill="white"/>
          </svg>
          <span style={{ fontWeight: 600, fontSize: 20, color: "#111827", letterSpacing: "-0.3px" }}>Dutify</span>
        </div>

        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "2px", textTransform: "uppercase", color: "#6b7280", marginBottom: 8 }}>
          Luxembourg · Import Duties
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "#111827", marginBottom: 32, letterSpacing: "-0.5px" }}>
          Sign in
        </h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="auth-input" style={inputStyle} />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="auth-input" style={inputStyle} />
          </div>

          {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 16 }}>{error}</p>}

          <button type="submit" disabled={loading} className="auth-btn" style={{ width: "100%", padding: "14px 0", background: "#10b981", border: "none", borderRadius: 12, color: "white", fontSize: 15, fontWeight: 600, cursor: loading ? "default" : "pointer", transition: "background 0.2s, transform 0.1s, box-shadow 0.2s" }}>
            {loading ? "Signing in…" : "Sign in →"}
          </button>
        </form>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid rgba(0,0,0,0.07)", textAlign: "center", fontSize: 14, color: "#6b7280" }}>
          Have an invite code?{" "}
          <a href="/register" style={{ color: "#10b981", fontWeight: 600, textDecoration: "none" }}>Register</a>
        </div>
      </div>
    </div>
  );
}
