'use client'
import { useState, useEffect } from 'react'

const s = {
  page:    { minHeight: '100vh', background: '#0e0e0e', color: '#e8e0d0', fontFamily: 'Georgia, serif', padding: 32 },
  header:  { borderBottom: '1px solid #222', paddingBottom: 24, marginBottom: 32 },
  label:   { fontSize: 10, letterSpacing: 4, color: '#c8a96e', textTransform: 'uppercase' },
  title:   { fontSize: 28, fontWeight: 300, marginTop: 4 },
  card:    { background: '#141414', border: '1px solid #222', borderRadius: 2, padding: 24, marginBottom: 24 },
  btn:     { padding: '10px 20px', background: '#c8a96e', border: 'none', color: '#0e0e0e', fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, borderRadius: 2, cursor: 'pointer' },
  btnSm:   { padding: '4px 10px', background: 'none', border: '1px solid #333', color: '#c26b6b', fontSize: 11, borderRadius: 2, cursor: 'pointer' },
  input:   { background: '#1a1a1a', border: '1px solid #333', color: '#e8e0d0', padding: '8px 12px', fontFamily: 'monospace', fontSize: 13, borderRadius: 2, width: 80, outline: 'none' },
  sectionLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 3, color: '#666', marginBottom: 12 },
  code:    { fontFamily: 'monospace', fontSize: 14, color: '#c8a96e', letterSpacing: 2 },
  tag:     (used) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 2, fontSize: 11, fontFamily: 'monospace', background: used ? '#2e1a1a' : '#1a2e1a', border: `1px solid ${used ? '#5a2d2d' : '#2d5a2d'}`, color: used ? '#c26b6b' : '#6bc26b' }),
}

export default function AdminPanel() {
  const [codes, setCodes]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expiresInDays, setExpiresInDays] = useState('')
  const [copied, setCopied]       = useState(null)

  useEffect(() => { fetchCodes() }, [])

  async function fetchCodes() {
    setLoading(true)
    const res = await fetch('/api/invites')
    const data = await res.json()
    setCodes(data)
    setLoading(false)
  }

  async function generate() {
    setGenerating(true)
    const res = await fetch('/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInDays: expiresInDays ? parseInt(expiresInDays) : null })
    })
    const code = await res.json()
    setCodes(c => [code, ...c])
    setGenerating(false)
  }

  async function deleteCode(id) {
    await fetch('/api/invites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    setCodes(c => c.filter(x => x.id !== id))
  }

  function copyCode(code) {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  const fmt = (d) => d ? new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.label}>EU Customs Calculator</div>
        <h1 style={s.title}>Admin Panel</h1>
      </div>

      {/* Generate */}
      <div style={s.card}>
        <div style={s.sectionLabel}>Generate Invite Code</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 11, color: '#777', display: 'block', marginBottom: 4 }}>Expires in (days)</label>
            <input
              type="number"
              placeholder="never"
              value={expiresInDays}
              onChange={e => setExpiresInDays(e.target.value)}
              style={s.input}
            />
          </div>
          <button onClick={generate} disabled={generating} style={{ ...s.btn, marginTop: 20 }}>
            {generating ? 'Generating...' : '+ Generate Code'}
          </button>
        </div>
      </div>

      {/* Codes list */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={s.sectionLabel}>Invite Codes ({codes.length})</div>
          <button onClick={fetchCodes} style={{ ...s.btnSm, color: '#888' }}>refresh</button>
        </div>

        {loading ? (
          <div style={{ color: '#555', fontSize: 13 }}>Loading...</div>
        ) : codes.length === 0 ? (
          <div style={{ color: '#555', fontSize: 13, fontStyle: 'italic' }}>No codes yet — generate one above.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 100px 60px 80px', gap: 12, padding: '6px 12px', fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 2 }}>
              <span>Code</span>
              <span>Status</span>
              <span>Created</span>
              <span>Expires</span>
              <span>Used by</span>
              <span></span>
            </div>
            {codes.map((c, i) => (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 100px 100px 60px 80px',
                gap: 12, padding: '10px 12px', alignItems: 'center',
                background: i % 2 === 0 ? '#111' : '#0e0e0e',
                borderRadius: 2
              }}>
                <span
                  style={{ ...s.code, cursor: 'pointer' }}
                  onClick={() => copyCode(c.code)}
                  title="Click to copy"
                >
                  {c.code} {copied === c.code ? '✓' : ''}
                </span>
                <span style={s.tag(!!c.usedAt)}>{c.usedAt ? 'used' : 'available'}</span>
                <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>{fmt(c.createdAt)}</span>
                <span style={{ fontSize: 12, color: c.expiresAt && new Date(c.expiresAt) < new Date() ? '#c26b6b' : '#888', fontFamily: 'monospace' }}>{fmt(c.expiresAt)}</span>
                <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.usedBy || '—'}</span>
                <button onClick={() => deleteCode(c.id)} style={s.btnSm}>delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <a href="/calculator" style={{ color: '#c8a96e', fontSize: 13 }}>← Back to calculator</a>
      </div>
    </div>
  )
}
