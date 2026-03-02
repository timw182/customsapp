"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

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

  const inputStyle = {
    width: "100%",
    background: "#f5f0e8",
    border: "1px solid var(--border)",
    color: "var(--foreground)",
    padding: "10px 12px",
    fontFamily: "var(--font-courier-prime), monospace",
    fontSize: 13,
    borderRadius: 2,
    outline: "none",
    transition: "border-color 0.2s",
  };

  const labelStyle = {
    fontFamily: "var(--font-oswald), sans-serif",
    fontSize: 10,
    color: "var(--muted)",
    letterSpacing: 3,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 6,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-dm-sans), sans-serif",
      }}
    >
      <div
        style={{
          width: 380,
          padding: 48,
          background: "#fff",
          border: "1px solid var(--border)",
          borderTop: "3px solid var(--gold)",
          borderRadius: 4,
          boxShadow: "0 4px 32px rgba(0,0,0,0.06)",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="11" fill="#1a1208" />
            <rect x="25" y="8" width="6" height="18" rx="3" fill="url(#rGold)" />
            <path
              d="M13 22L28 39L43 22"
              stroke="url(#rGold)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="10" y="43" width="36" height="4" rx="2" fill="url(#rGold)" />
            <defs>
              <linearGradient id="rGold" x1="13" y1="8" x2="43" y2="47" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#F8DA6A" />
                <stop offset="100%" stopColor="#D4920A" />
              </linearGradient>
            </defs>
          </svg>
          <span
            style={{
              fontFamily: "var(--font-oswald), sans-serif",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "var(--foreground)",
            }}
          >
            Dutify
          </span>
        </div>

        <div
          style={{
            fontFamily: "var(--font-oswald), sans-serif",
            fontSize: 10,
            letterSpacing: 5,
            color: "var(--gold)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Luxembourg · Import Duties
        </div>
        <h1
          style={{
            fontFamily: "var(--font-oswald), sans-serif",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--foreground)",
            marginBottom: 32,
          }}
        >
          Create Account
        </h1>

        <form onSubmit={handleSubmit}>
          {[
            { key: "name", label: "Full Name", type: "text" },
            { key: "email", label: "Email", type: "email" },
            { key: "password", label: "Password", type: "password" },
            { key: "inviteCode", label: "Invite Code", type: "text" },
          ].map(({ key, label, type }) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={update(key)}
                required
                className="auth-input"
                style={inputStyle}
              />
            </div>
          ))}
          {error && (
            <p
              style={{
                color: "#8e2e2e",
                fontSize: 13,
                marginBottom: 16,
                fontFamily: "var(--font-courier-prime), monospace",
              }}
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="auth-btn"
            style={{
              width: "100%",
              padding: "13px 0",
              background: "linear-gradient(135deg, var(--gold-hi), var(--gold))",
              border: "none",
              color: "#0a0600",
              fontSize: 12,
              letterSpacing: 3,
              textTransform: "uppercase",
              fontWeight: 700,
              borderRadius: 2,
              cursor: loading ? "default" : "pointer",
              fontFamily: "var(--font-oswald), sans-serif",
              marginTop: 8,
              transition: "opacity 0.2s, box-shadow 0.2s, transform 0.1s",
            }}
          >
            {loading ? "Creating account..." : "Create Account →"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            paddingTop: 24,
            borderTop: "1px solid #e8e2d8",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          Already have an account?{" "}
          <a
            href="/login"
            style={{
              color: "var(--gold)",
              textDecoration: "none",
              fontFamily: "var(--font-oswald), sans-serif",
              letterSpacing: 1,
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
