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
    <div
      style={{
        minHeight: "100vh",
        background: "#f0ebe2",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div
        style={{
          width: 380,
          padding: 48,
          background: "#fff",
          border: "1px solid #d8d2c8",
          borderRadius: 4,
          boxShadow: "0 4px 32px rgba(0,0,0,0.06)",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
          <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="11" fill="#1a1208" />
            <rect x="25" y="8" width="6" height="18" rx="3" fill="url(#lGold)" />
            <path
              d="M13 22L28 39L43 22"
              stroke="url(#lGold)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="10" y="43" width="36" height="4" rx="2" fill="url(#lGold)" />
            <defs>
              <linearGradient id="lGold" x1="13" y1="8" x2="43" y2="47" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#F8DA6A" />
                <stop offset="100%" stopColor="#D4920A" />
              </linearGradient>
            </defs>
          </svg>
          <span
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#0e0a04",
            }}
          >
            Dutify
          </span>
        </div>

        <div
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 10,
            letterSpacing: 5,
            color: "#C8900A",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Luxembourg · Import Duties
        </div>
        <h1
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#0e0a04",
            marginBottom: 32,
          }}
        >
          Sign In
        </h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10,
                color: "#9a8e7e",
                letterSpacing: 3,
                textTransform: "uppercase",
                display: "block",
                marginBottom: 6,
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                background: "#f5f0e8",
                border: "1px solid #d8d2c8",
                color: "#0e0a04",
                padding: "10px 12px",
                fontFamily: "monospace",
                fontSize: 13,
                borderRadius: 2,
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#C8900A")}
              onBlur={(e) => (e.target.style.borderColor = "#d8d2c8")}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10,
                color: "#9a8e7e",
                letterSpacing: 3,
                textTransform: "uppercase",
                display: "block",
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                background: "#f5f0e8",
                border: "1px solid #d8d2c8",
                color: "#0e0a04",
                padding: "10px 12px",
                fontFamily: "monospace",
                fontSize: 13,
                borderRadius: 2,
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#C8900A")}
              onBlur={(e) => (e.target.style.borderColor = "#d8d2c8")}
            />
          </div>
          {error && (
            <p style={{ color: "#8e2e2e", fontSize: 13, marginBottom: 16, fontFamily: "monospace" }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "13px 0",
              background: "linear-gradient(135deg, #F8DA6A, #C8900A)",
              border: "none",
              color: "#0a0600",
              fontSize: 12,
              letterSpacing: 3,
              textTransform: "uppercase",
              fontWeight: 700,
              borderRadius: 2,
              cursor: loading ? "default" : "pointer",
              fontFamily: "'Oswald', sans-serif",
              opacity: loading ? 0.7 : 1,
              transition: "opacity 0.2s, box-shadow 0.2s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.boxShadow = "0 4px 20px rgba(200,144,10,0.3)";
                e.target.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.boxShadow = "none";
              e.target.style.transform = "translateY(0)";
            }}
          >
            {loading ? "Signing in..." : "Sign In →"}
          </button>
        </form>

        <div
          style={{
            marginTop: 24,
            paddingTop: 24,
            borderTop: "1px solid #e8e2d8",
            textAlign: "center",
            fontSize: 13,
            color: "#9a8e7e",
          }}
        >
          Have an invite code?{" "}
          <a
            href="/register"
            style={{
              color: "#C8900A",
              textDecoration: "none",
              fontFamily: "'Oswald', sans-serif",
              letterSpacing: 1,
              textTransform: "uppercase",
              fontSize: 12,
            }}
          >
            Register
          </a>
        </div>
      </div>
    </div>
  );
}
