"use client";
import { useState, useEffect } from "react";

const s = {
  page: {
    minHeight: "100vh",
    background: "#f0f7f4",
    color: "#111827",
    fontFamily: "'DM Sans', sans-serif",
    padding: 32,
  },
  header: { borderBottom: "1px solid #e2e8f0", paddingBottom: 24, marginBottom: 32 },
  label: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 10,
    letterSpacing: 5,
    color: "#10b981",
    textTransform: "uppercase",
  },
  title: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 6,
  },
  card: {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 4,
    padding: 28,
    marginBottom: 24,
    boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
  },
  btn: {
    padding: "11px 22px",
    background: "linear-gradient(135deg, #34d399, #10b981)",
    border: "none",
    color: "#111827",
    fontSize: 11,
    letterSpacing: 3,
    textTransform: "uppercase",
    fontWeight: 700,
    borderRadius: 2,
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    transition: "box-shadow 0.2s, transform 0.1s",
  },
  btnSm: {
    padding: "4px 10px",
    background: "none",
    border: "1px solid #e2e8f0",
    color: "#dc2626",
    fontSize: 11,
    borderRadius: 2,
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    letterSpacing: 1,
    textTransform: "uppercase",
    transition: "border-color 0.2s",
  },
  btnSmSend: {
    padding: "4px 10px",
    background: "none",
    border: "1px solid #e2e8f0",
    color: "#2563eb",
    fontSize: 11,
    borderRadius: 2,
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    letterSpacing: 1,
    textTransform: "uppercase",
    transition: "border-color 0.2s, background 0.2s",
  },
  input: {
    background: "#f0f7f4",
    border: "1px solid #e2e8f0",
    color: "#111827",
    padding: "8px 12px",
    fontFamily: "monospace",
    fontSize: 13,
    borderRadius: 2,
    width: 90,
    outline: "none",
    transition: "border-color 0.2s",
  },
  sectionLabel: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 4,
    color: "#6b7280",
    marginBottom: 14,
  },
  code: { fontFamily: "monospace", fontSize: 14, color: "#10b981", letterSpacing: 2 },
  tag: (used) => ({
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 2,
    fontSize: 10,
    fontFamily: "'Oswald', sans-serif",
    letterSpacing: 1,
    textTransform: "uppercase",
    background: used ? "#fee2e2" : "#dcfce7",
    border: `1px solid ${used ? "#fca5a5" : "#86efac"}`,
    color: used ? "#dc2626" : "#15803d",
  }),
};

export default function AdminPanel() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [copied, setCopied] = useState(null);
  // sendModal: { codeId, codeStr } | null
  const [sendModal, setSendModal] = useState(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null); // { ok: bool, msg: string }

  const [exciseMeta, setExciseMeta] = useState(null); // { lastChecked, source, notes }
  const [exciseRefreshing, setExciseRefreshing] = useState(false);
  const [exciseRefreshResult, setExciseRefreshResult] = useState(null);

  useEffect(() => {
    fetchCodes();
    fetch('/api/excise-rates')
      .then(r => r.json())
      .then(d => setExciseMeta(d))
      .catch(() => {});
  }, []);

  async function refreshExciseRates() {
    setExciseRefreshing(true);
    setExciseRefreshResult(null);
    try {
      const res = await fetch('/api/admin/excise-rates', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setExciseMeta(m => ({ ...m, lastChecked: data.lastChecked, source: data.notes ?? m?.source }));
        setExciseRefreshResult({ ok: true, msg: data.updated ? `${data.changes.length} rate(s) updated` : 'Rates confirmed — no changes' });
      } else {
        setExciseRefreshResult({ ok: false, msg: data.error ?? 'Refresh failed' });
      }
    } catch {
      setExciseRefreshResult({ ok: false, msg: 'Network error' });
    }
    setExciseRefreshing(false);
  }

  async function fetchCodes() {
    setLoading(true);
    const res = await fetch("/api/invites");
    const data = await res.json();
    setCodes(data);
    setLoading(false);
  }

  async function generate() {
    setGenerating(true);
    const body = expiresInDays ? { expiresInDays: parseInt(expiresInDays) } : {};
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const code = await res.json();
    if (code.id) setCodes((c) => [code, ...c]);
    setGenerating(false);
  }

  async function deleteCode(id) {
    await fetch("/api/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCodes((c) => c.filter((x) => x.id !== id));
  }

  async function sendInviteEmail(codeId, email) {
    const res = await fetch("/api/invites/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeId, email }),
    });
    return res.ok;
  }

  function openSendModal(c) {
    setSendModal({ codeId: c.id, codeStr: c.code });
    setSendEmail("");
    setSendResult(null);
  }

  function closeSendModal() {
    setSendModal(null);
    setSendEmail("");
    setSendResult(null);
    setSending(false);
  }

  async function submitSendModal() {
    if (!sendEmail || !sendModal) return;
    setSending(true);
    setSendResult(null);
    const res = await fetch("/api/invites/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeId: sendModal.codeId, email: sendEmail }),
    });
    const data = await res.json();
    if (res.ok) {
      setCodes((cs) => cs.map((c) => c.id === sendModal.codeId ? { ...c, sentTo: data.invite.sentTo } : c));
      closeSendModal();
    } else {
      setSendResult({ ok: false, msg: data.error ?? "Failed to send" });
      setSending(false);
    }
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString("de-LU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  return (
    <div style={s.page}>
      <div style={s.header}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <svg width="30" height="30" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="11" fill="#1f2937" />
            <rect x="25" y="8" width="6" height="18" rx="3" fill="url(#aGold)" />
            <path
              d="M13 22L28 39L43 22"
              stroke="url(#aGold)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="10" y="43" width="36" height="4" rx="2" fill="url(#aGold)" />
            <defs>
              <linearGradient id="aGold" x1="13" y1="8" x2="43" y2="47" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
          </svg>
          <span
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#111827",
            }}
          >
            Dutify
          </span>
        </div>
        <div style={s.label}>Admin</div>
        <h1 style={s.title}>Invite Codes</h1>
      </div>

      {/* Generate */}
      <div style={s.card}>
        <div style={s.sectionLabel}>Generate Invite Code</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10,
                color: "#6b7280",
                letterSpacing: 3,
                textTransform: "uppercase",
                display: "block",
                marginBottom: 6,
              }}
            >
              Expires in (days)
            </label>
            <input
              type="number"
              placeholder="never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              style={s.input}
              onFocus={(e) => (e.target.style.borderColor = "#10b981")}
              onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
            />
          </div>
          <button
            onClick={generate}
            disabled={generating}
            style={{ ...s.btn, opacity: generating ? 0.7 : 1 }}
            onMouseEnter={(e) => {
              if (!generating) {
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(16,185,129,0.3)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {generating ? "Generating..." : "+ Generate Code"}
          </button>
        </div>
      </div>

      {/* Codes list */}
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={s.sectionLabel}>Invite Codes ({codes.length})</div>
          <button
            onClick={fetchCodes}
            style={{ ...s.btnSm, color: "#6b7280" }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#10b981")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ color: "#6b7280", fontSize: 13 }}>Loading...</div>
        ) : codes.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13, fontStyle: "italic" }}>No codes yet — generate one above.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 100px 100px 120px 140px",
                gap: 12,
                padding: "6px 12px",
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10,
                color: "#6b7280",
                textTransform: "uppercase",
                letterSpacing: 2,
              }}
            >
              <span>Code</span>
              <span>Status</span>
              <span>Created</span>
              <span>Expires</span>
              <span>Used by</span>
              <span></span>
            </div>
            {codes.map((c, i) => (
              <div
                key={c.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 100px 100px 120px 140px",
                  gap: 12,
                  padding: "10px 12px",
                  alignItems: "center",
                  background: i % 2 === 0 ? "#f0f7f4" : "#fff",
                  borderRadius: 2,
                  border: "1px solid #e2e8f0",
                }}
              >
                <span style={{ ...s.code, cursor: "pointer" }} onClick={() => copyCode(c.code)} title="Click to copy">
                  {c.code} {copied === c.code ? <span style={{ color: "#15803d" }}>✓</span> : ""}
                </span>
                <span style={s.tag(!!c.usedAt)}>{c.usedAt ? "used" : "available"}</span>
                <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "monospace" }}>{fmt(c.createdAt)}</span>
                <span
                  style={{
                    fontSize: 12,
                    color: c.expiresAt && new Date(c.expiresAt) < new Date() ? "#dc2626" : "#6b7280",
                    fontFamily: "monospace",
                  }}
                >
                  {fmt(c.expiresAt)}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontFamily: "monospace",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.usedBy || "—"}
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                  {!c.usedAt && (
                    c.sentTo ? (
                      <button disabled style={{ ...s.btnSmSend, color: "#6b7280", borderColor: "#e2e8f0", cursor: "not-allowed", opacity: 0.6 }}>
                        Sent
                      </button>
                    ) : (
                      <button
                        onClick={() => openSendModal(c)}
                        style={s.btnSmSend}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#60a5fa";
                          e.currentTarget.style.background = "#dbeafe";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "#e2e8f0";
                          e.currentTarget.style.background = "none";
                        }}
                      >
                        Send
                      </button>
                    )
                  )}
                  <button
                    onClick={() => deleteCode(c.id)}
                    style={s.btnSm}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#fca5a5";
                      e.currentTarget.style.background = "#fee2e2";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.background = "none";
                    }}
                  >
                    Delete
                  </button>
                </div>
                {c.sentTo && (
                  <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ✉ {c.sentTo}
                  </span>
                )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <a
          href="/calculator"
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontSize: 12,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#10b981",
            textDecoration: "none",
          }}
        >
          ← Back to calculator
        </a>
      </div>

      {/* Excise Rates */}
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={s.sectionLabel}>Excise Rates</div>
          <button
            onClick={refreshExciseRates}
            disabled={exciseRefreshing}
            style={{ ...s.btnSm, color: exciseRefreshing ? "#6b7280" : "#2563eb", opacity: exciseRefreshing ? 0.7 : 1 }}
            onMouseEnter={(e) => { if (!exciseRefreshing) e.currentTarget.style.borderColor = "#2563eb"; }}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
          >
            {exciseRefreshing ? "Checking..." : "Refresh Now"}
          </button>
        </div>
        {exciseMeta && (() => {
          const daysOld = Math.floor((Date.now() - new Date(exciseMeta.lastChecked)) / 86400000);
          const stale = daysOld > 14;
          return (
            <div style={{ fontSize: 12, fontFamily: "monospace", lineHeight: 1.8 }}>
              <div>
                <span style={{ color: "#6b7280" }}>Last checked: </span>
                <span style={{ color: stale ? "#dc2626" : "#15803d", fontWeight: 600 }}>
                  {daysOld === 0 ? "today" : `${daysOld} day${daysOld !== 1 ? "s" : ""} ago`}
                  {stale ? " ⚠ stale" : " ✓"}
                </span>
              </div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>{exciseMeta.source}</div>
              {exciseMeta.notes && <div style={{ color: "#6b7280", fontSize: 11 }}>{exciseMeta.notes}</div>}
            </div>
          );
        })()}
        {exciseRefreshResult && (
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 2, fontSize: 12,
            background: exciseRefreshResult.ok ? "#dcfce7" : "#fee2e2",
            border: `1px solid ${exciseRefreshResult.ok ? "#86efac" : "#fca5a5"}`,
            color: exciseRefreshResult.ok ? "#15803d" : "#dc2626",
          }}>
            {exciseRefreshResult.msg}
          </div>
        )}
        <div style={{ marginTop: 12, fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
          Auto-checked every 14 days via cron · source: ae.gouvernement.lu
        </div>
      </div>

      {/* Send email modal */}
      {sendModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeSendModal(); }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              padding: 32,
              width: 420,
              maxWidth: "90vw",
              boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ ...s.sectionLabel, marginBottom: 6 }}>Send Invite by Email</div>
            <div style={{ fontFamily: "monospace", fontSize: 18, color: "#10b981", letterSpacing: 4, marginBottom: 20 }}>
              {sendModal.codeStr}
            </div>

            <label
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontSize: 10,
                color: "#6b7280",
                letterSpacing: 3,
                textTransform: "uppercase",
                display: "block",
                marginBottom: 6,
              }}
            >
              Recipient email
            </label>
            <input
              type="email"
              placeholder="invitee@example.com"
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitSendModal(); }}
              style={{ ...s.input, width: "100%", boxSizing: "border-box", marginBottom: 16 }}
              onFocus={(e) => (e.target.style.borderColor = "#10b981")}
              onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
              autoFocus
            />

            {sendResult && (
              <div
                style={{
                  marginBottom: 14,
                  padding: "8px 12px",
                  borderRadius: 2,
                  fontSize: 12,
                  fontFamily: "'Oswald', sans-serif",
                  letterSpacing: 1,
                  background: sendResult.ok ? "#dcfce7" : "#fee2e2",
                  border: `1px solid ${sendResult.ok ? "#86efac" : "#fca5a5"}`,
                  color: sendResult.ok ? "#15803d" : "#dc2626",
                }}
              >
                {sendResult.ok ? "✓ " : "✗ "}{sendResult.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={closeSendModal}
                style={{ ...s.btnSm, color: "#6b7280" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#10b981")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e2e8f0")}
              >
                Cancel
              </button>
              <button
                onClick={submitSendModal}
                disabled={sending || !sendEmail}
                style={{ ...s.btn, padding: "8px 20px", opacity: sending || !sendEmail ? 0.6 : 1 }}
                onMouseEnter={(e) => {
                  if (!sending && sendEmail) {
                    e.currentTarget.style.boxShadow = "0 4px 20px rgba(16,185,129,0.3)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {sending ? "Sending..." : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
