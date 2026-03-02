'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', name: '', password: '', inviteCode: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      setLoading(false)
    } else {
      router.push('/login?registered=1')
    }
  }

  const inputStyle = { width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#e8e0d0', padding: '10px 12px', fontFamily: 'monospace', fontSize: 13, borderRadius: 2, outline: 'none' }
  const labelStyle = { fontSize: 11, color: '#777', letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6 }

  return (
    <div style={{ minHeight: '100vh', background: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif' }}>
      <div style={{ width: 360, padding: 40, border: '1px solid #222', borderRadius: 2 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: '#c8a96e', textTransform: 'uppercase', marginBottom: 8 }}>Luxembourg · EU Customs</div>
        <h1 style={{ fontSize: 24, fontWeight: 300, color: '#e8e0d0', marginBottom: 32 }}>Register</h1>

        <form onSubmit={handleSubmit}>
          {[
            { key: 'name',       label: 'Full Name',    type: 'text' },
            { key: 'email',      label: 'Email',        type: 'email' },
            { key: 'password',   label: 'Password',     type: 'password' },
            { key: 'inviteCode', label: 'Invite Code',  type: 'text' },
          ].map(({ key, label, type }) => (
            <div key={key} style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{label}</label>
              <input type={type} value={form[key]} onChange={update(key)} required style={inputStyle} />
            </div>
          ))}
          {error && <p style={{ color: '#c26b6b', fontSize: 13, marginBottom: 16 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: '#c8a96e', border: 'none', color: '#0e0e0e', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, borderRadius: 2, cursor: 'pointer', marginTop: 8 }}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#555' }}>
          Already have an account?{' '}
          <a href="/login" style={{ color: '#c8a96e' }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
