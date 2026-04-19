"use client";
import { useState, useEffect } from "react";

export default function AdminPanel() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [copied, setCopied] = useState(null);
  const [sendModal, setSendModal] = useState(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const [exciseMeta, setExciseMeta] = useState(null);
  const [exciseRefreshing, setExciseRefreshing] = useState(false);
  const [exciseRefreshResult, setExciseRefreshResult] = useState(null);

  // Mobile tokens
  const [tokens, setTokens] = useState([]);
  const [users, setUsers] = useState([]);
  const [tokenUserId, setTokenUserId] = useState("");
  const [tokenName, setTokenName] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issuedToken, setIssuedToken] = useState(null); // { plaintext, token }
  const [tokenCopied, setTokenCopied] = useState(false);

  useEffect(() => {
    fetchCodes();
    fetchTokens();
    fetchUsers();
    fetch("/api/excise-rates")
      .then((r) => r.json())
      .then((d) => setExciseMeta(d))
      .catch(() => {});
  }, []);

  async function fetchTokens() {
    const res = await fetch("/api/admin/tokens");
    if (res.ok) setTokens(await res.json());
  }

  async function fetchUsers() {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }

  async function issueNewToken() {
    if (!tokenUserId || !tokenName.trim()) return;
    setIssuing(true);
    try {
      const res = await fetch("/api/admin/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: tokenUserId, name: tokenName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setIssuedToken(data);
        setTokenName("");
        fetchTokens();
      } else {
        alert(data.error ?? "Failed to issue token");
      }
    } catch {
      alert("Network error");
    }
    setIssuing(false);
  }

  async function revokeTokenById(id) {
    if (!confirm("Revoke this token? The device using it will be signed out.")) return;
    await fetch("/api/admin/tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchTokens();
  }

  function copyIssuedToken() {
    if (!issuedToken?.plaintext) return;
    navigator.clipboard.writeText(issuedToken.plaintext);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  async function refreshExciseRates() {
    setExciseRefreshing(true);
    setExciseRefreshResult(null);
    try {
      const res = await fetch("/api/admin/excise-rates", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setExciseMeta((m) => ({ ...m, lastChecked: data.lastChecked, source: data.notes ?? m?.source }));
        setExciseRefreshResult({ ok: true, msg: data.updated ? `${data.changes.length} rate(s) updated` : "Rates confirmed — no changes" });
      } else {
        setExciseRefreshResult({ ok: false, msg: data.error ?? "Refresh failed" });
      }
    } catch {
      setExciseRefreshResult({ ok: false, msg: "Network error" });
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
      setCodes((cs) => cs.map((c) => (c.id === sendModal.codeId ? { ...c, sentTo: data.invite.sentTo } : c)));
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
    <div className="dossier-folder">
      {/* Masthead */}
      <header className="admin-head">
        <div>
          <span className="eyebrow">Registrar · Internal</span>
          <h1 className="display display-md">The Admin Ledger</h1>
          <p className="serif italic-serif muted">
            Issue invite codes, monitor excise rate freshness, and revoke access.
          </p>
        </div>
        <a href="/calculator" className="btn btn-ghost">← Back to calculator</a>
      </header>

      <hr className="hairline-double" />

      {/* Generate */}
      <section className="dossier-card dossier-card--tabbed mt-6">
        <div className="section-header">
          <span className="section-num">§ 01</span>
          <h2 className="section-title">Issue an invite</h2>
        </div>

        <div className="row gap-4 row-wrap" style={{ alignItems: "flex-end" }}>
          <div style={{ width: 180 }}>
            <label className="field-label" htmlFor="adm-exp">Expires in (days)</label>
            <input
              id="adm-exp"
              type="number"
              placeholder="never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
          <button onClick={generate} disabled={generating} className="btn btn-cta">
            {generating ? "Issuing…" : "+  Issue code"}
          </button>
        </div>
      </section>

      {/* Codes list */}
      <section className="dossier-card mt-5">
        <div className="section-header">
          <span className="section-num">§ 02</span>
          <h2 className="section-title">Issued codes</h2>
          <span className="section-sub">{codes.length} on register</span>
          <button onClick={fetchCodes} className="btn btn-plain btn-sm" style={{ marginLeft: "auto" }}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="muted italic-serif">Loading the ledger…</div>
        ) : codes.length === 0 ? (
          <div className="muted italic-serif">No codes yet — issue one above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Used by</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                  return (
                    <tr key={c.id}>
                      <td>
                        <button
                          onClick={() => copyCode(c.code)}
                          className="code-pill"
                          title="Click to copy"
                        >
                          <span className="mono" style={{ fontSize: 14, letterSpacing: 2, color: "var(--ink-forest-deep)" }}>
                            {c.code}
                          </span>
                          {copied === c.code && <span className="brass mono" style={{ fontSize: 10 }}>COPIED</span>}
                        </button>
                      </td>
                      <td>
                        {c.usedAt ? (
                          <span className="tag tag-oxblood">USED</span>
                        ) : (
                          <span className="tag tag-forest">OPEN</span>
                        )}
                      </td>
                      <td className="mono muted text-xs">{fmt(c.createdAt)}</td>
                      <td className={"mono text-xs " + (expired ? "oxblood" : "muted")}>{fmt(c.expiresAt)}</td>
                      <td className="mono text-xs muted truncate" style={{ maxWidth: 180 }}>
                        {c.usedBy || "—"}
                      </td>
                      <td>
                        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
                          {!c.usedAt && (
                            c.sentTo ? (
                              <span className="tag">✉ Sent</span>
                            ) : (
                              <button onClick={() => openSendModal(c)} className="btn btn-plain btn-sm">Send</button>
                            )
                          )}
                          <button onClick={() => deleteCode(c.id)} className="btn btn-danger btn-sm">Delete</button>
                        </div>
                        {c.sentTo && (
                          <div className="mono text-xs muted truncate mt-1" style={{ textAlign: "right" }}>
                            ✉ {c.sentTo}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Mobile tokens */}
      <section className="dossier-card mt-5">
        <div className="section-header">
          <span className="section-num">§ 03</span>
          <h2 className="section-title">Mobile tokens</h2>
          <span className="section-sub">Per-device bearer tokens for Dutify Pocket</span>
        </div>

        {/* Issue form */}
        <div className="row gap-4 row-wrap" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="field-label" htmlFor="tok-user">User</label>
            <select
              id="tok-user"
              value={tokenUserId}
              onChange={(e) => setTokenUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} {u.name ? `· ${u.name}` : ""} {u._count?.apiTokens ? `· ${u._count.apiTokens} token(s)` : ""}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <label className="field-label" htmlFor="tok-name">Device name</label>
            <input
              id="tok-name"
              type="text"
              placeholder="Tim's iPhone"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
            />
          </div>
          <button
            onClick={issueNewToken}
            disabled={issuing || !tokenUserId || !tokenName.trim()}
            className="btn btn-cta"
          >
            {issuing ? "Issuing…" : "+  Issue token"}
          </button>
        </div>

        {/* One-time plaintext — shown only once */}
        {issuedToken && (
          <div className="alert alert-warn mt-4" style={{ position: "relative" }}>
            <div style={{ flex: 1 }}>
              <div className="alert-title">Token issued — copy it now</div>
              <p className="text-sm mt-1" style={{ color: "var(--brass-deep)" }}>
                This is the only time you will see the plaintext. Once dismissed, only the first 8 characters remain visible.
              </p>
              <div
                className="mono mt-3"
                style={{
                  padding: "12px 14px",
                  background: "var(--paper-cream)",
                  border: "1.5px solid var(--brass)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  letterSpacing: "0.04em",
                  color: "var(--ink-forest-deep)",
                  wordBreak: "break-all",
                }}
              >
                {issuedToken.plaintext}
              </div>
              <div className="row gap-2 mt-3">
                <button onClick={copyIssuedToken} className="btn btn-brass btn-sm">
                  {tokenCopied ? "Copied ✓" : "Copy to clipboard"}
                </button>
                <button onClick={() => setIssuedToken(null)} className="btn btn-plain btn-sm">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tokens table */}
        {tokens.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: "var(--sp-5)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Device</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const revoked = !!t.revokedAt;
                  const expired = t.expiresAt && new Date(t.expiresAt) < new Date();
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="mono text-xs">{t.userEmail}</div>
                        {t.userName && <div className="text-xs muted">{t.userName}</div>}
                      </td>
                      <td>{t.name}</td>
                      <td className="mono text-xs brass">dty_live_{t.prefix}…</td>
                      <td className="mono text-xs muted">{fmt(t.createdAt)}</td>
                      <td className="mono text-xs muted">{t.lastUsedAt ? fmt(t.lastUsedAt) : "—"}</td>
                      <td>
                        {revoked ? (
                          <span className="tag tag-oxblood">REVOKED</span>
                        ) : expired ? (
                          <span className="tag tag-oxblood">EXPIRED</span>
                        ) : (
                          <span className="tag tag-forest">ACTIVE</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {!revoked && !expired && (
                          <button onClick={() => revokeTokenById(t.id)} className="btn btn-danger btn-sm">
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tokens.length === 0 && (
          <p className="muted italic-serif mt-4">No tokens issued yet.</p>
        )}
      </section>

      {/* Excise Rates */}
      <section className="dossier-card mt-5">
        <div className="section-header">
          <span className="section-num">§ 04</span>
          <h2 className="section-title">Excise rates</h2>
          <button
            onClick={refreshExciseRates}
            disabled={exciseRefreshing}
            className="btn btn-brass btn-sm"
            style={{ marginLeft: "auto" }}
          >
            {exciseRefreshing ? "Checking…" : "Refresh now"}
          </button>
        </div>

        {exciseMeta &&
          (() => {
            const daysOld = Math.floor((Date.now() - new Date(exciseMeta.lastChecked)) / 86400000);
            const stale = daysOld > 14;
            return (
              <div className="kv-grid">
                <div className="kv">
                  <span className="kv-label">Last checked</span>
                  <span className={"kv-value " + (stale ? "oxblood" : "forest")}>
                    {daysOld === 0 ? "Today" : `${daysOld} day${daysOld !== 1 ? "s" : ""} ago`}
                    {stale ? "  ⚠" : "  ✓"}
                  </span>
                </div>
                <div className="kv">
                  <span className="kv-label">Source</span>
                  <span className="kv-value text-sm">{exciseMeta.source}</span>
                </div>
                {exciseMeta.notes && (
                  <div className="kv span-2">
                    <span className="kv-label">Notes</span>
                    <span className="text-sm muted italic-serif">{exciseMeta.notes}</span>
                  </div>
                )}
              </div>
            );
          })()}

        {exciseRefreshResult && (
          <div className={"alert mt-4 " + (exciseRefreshResult.ok ? "alert-info" : "alert-danger")}>
            <div>
              <div className="alert-title">{exciseRefreshResult.ok ? "Updated" : "Failed"}</div>
              {exciseRefreshResult.msg}
            </div>
          </div>
        )}

        <p className="mono text-xs faint mt-4">
          Auto-checked every 14 days via cron · source: ae.gouvernement.lu
        </p>
      </section>

      {/* Send email modal */}
      {sendModal && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && closeSendModal()}>
          <div className="dossier-card dossier-card-lg modal-panel stamp-in">
            <span className="eyebrow">Dispatch by mail</span>
            <h3 className="display display-sm mt-1">Send invite</h3>
            <div className="mono mt-3" style={{ fontSize: 18, letterSpacing: 3, color: "var(--brass-deep)" }}>
              {sendModal.codeStr}
            </div>

            <hr className="hairline mt-4 mb-4" />

            <label className="field-label" htmlFor="send-email">Recipient email</label>
            <input
              id="send-email"
              type="email"
              placeholder="invitee@example.com"
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSendModal()}
              autoFocus
            />

            {sendResult && (
              <div className={"alert mt-3 " + (sendResult.ok ? "alert-info" : "alert-danger")}>
                <div>
                  <div className="alert-title">{sendResult.ok ? "Sent" : "Failed"}</div>
                  {sendResult.msg}
                </div>
              </div>
            )}

            <div className="row gap-2 mt-5" style={{ justifyContent: "flex-end" }}>
              <button onClick={closeSendModal} className="btn btn-plain">Cancel</button>
              <button onClick={submitSendModal} disabled={sending || !sendEmail} className="btn btn-cta">
                {sending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .admin-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: var(--sp-5);
          margin-bottom: var(--sp-5);
        }
        .admin-head h1 { color: var(--ink-forest-deep); margin-top: var(--sp-1); }
        .code-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          background: var(--brass-wash);
          border: 1px solid var(--brass-soft);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--dur-fast) var(--ease-out);
        }
        .code-pill:hover { background: var(--brass); color: var(--paper-cream); }
        .code-pill:hover .mono { color: var(--paper-cream) !important; }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(20, 40, 30, 0.35);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999;
          padding: var(--sp-4);
          animation: fade-in 160ms var(--ease-out);
        }
        .modal-panel {
          width: 460px;
          max-width: 100%;
          background: var(--paper-cream);
          border-top: 3px solid var(--brass);
        }
      `}</style>
    </div>
  );
}
