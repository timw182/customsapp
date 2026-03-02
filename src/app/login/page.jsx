'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const router = useRouter()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', { email, password, redirect: false })
    if (res?.error) {
      setError('Invalid email or password')
      setLoading(false)
    } else {
      router.push('/calculator')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0e0e0e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif' }}>
      <div style={{ width: 360, padding: 40, border: '1px solid #222', borderRadius: 2 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: '#c8a96e', textTransform: 'uppercase', marginBottom: 8 }}>Luxembourg · EU Customs</div>
        <h1 style={{ fontSize: 24, fontWeight: 300, color: '#e8e0d0', marginBottom: 32 }}>Sign In</h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#777', letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#e8e0d0', padding: '10px 12px', fontFamily: 'monospace', fontSize: 13, borderRadius: 2, outline: 'none' }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 11, color: '#777', letterSpacing: 2, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{ width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#e8e0d0', padding: '10px 12px', fontFamily: 'monospace', fontSize: 13, borderRadius: 2, outline: 'none' }}
            />
          </div>
          {error && <p style={{ color: '#c26b6b', fontSize: 13, marginBottom: 16 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', padding: 12, background: '#c8a96e', border: 'none', color: '#0e0e0e', fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, borderRadius: 2, cursor: 'pointer' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: '#555' }}>
          Have an invite code?{' '}
          <a href="/register" style={{ color: '#c8a96e' }}>Register</a>
        </p>
      </div>
    </div>
  )
}
