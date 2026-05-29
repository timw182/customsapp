'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'

const CATEGORIES = [
  {
    id: 'searchHistory',
    label: 'HS Code Search History',
    icon: '🔍',
    what: 'Every product description you typed into the AI classifier and the HS codes returned, including confidence scores and timestamps.',
    irreversible: true,
  },
  {
    id: 'favourites',
    label: 'Saved HS Codes',
    icon: '★',
    what: 'HS codes you bookmarked, with descriptions, duty rates, and any personal notes you added.',
    irreversible: true,
  },
  {
    id: 'shipments',
    label: 'Calculation Records',
    icon: '📦',
    what: 'Customs duty calculations you ran — origin country, incoterm, line items, CIF values, duty and VAT totals.',
    irreversible: true,
  },
  {
    id: 'notifications',
    label: 'Notification Inbox',
    icon: '🔔',
    what: 'System notifications stored in your account inbox (lookup results, billing reminders, product updates).',
    irreversible: false,
  },
  {
    id: 'deviceTokens',
    label: 'Device Push Tokens',
    icon: '📱',
    what: 'Push notification registrations from your iOS/Android devices. Removes all devices from your account.',
    irreversible: false,
  },
  {
    id: 'prefs',
    label: 'Preferences & Settings',
    icon: '⚙',
    what: 'Your saved display, AI, and privacy preferences. Resets everything to defaults (currency, language, AI model, etc.).',
    irreversible: false,
  },
]

function pluralise(n, singular, plural) {
  return n === 1 ? `1 ${singular}` : `${n.toLocaleString()} ${plural}`
}

function countLabel(id, counts) {
  const n = counts[id]
  if (n === undefined) return null
  if (id === 'prefs') return counts.hasPrefs ? 'Saved' : 'Using defaults'
  if (id === 'deviceTokens') return pluralise(n, 'device', 'devices')
  if (id === 'notifications') return pluralise(n, 'notification', 'notifications')
  if (id === 'favourites') return pluralise(n, 'saved code', 'saved codes')
  if (id === 'shipments') return pluralise(n, 'record', 'records')
  if (id === 'searchHistory') return pluralise(n, 'search', 'searches')
  return null
}

function isEmpty(id, counts) {
  if (id === 'prefs') return !counts.hasPrefs
  return counts[id] === 0
}

export default function RemoveMyData() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [counts, setCounts] = useState(null)
  const [confirming, setConfirming] = useState(null) // category id being confirmed
  const [deleting, setDeleting] = useState(null)
  const [deleted, setDeleted] = useState([]) // ids successfully deleted
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [confirmAccount, setConfirmAccount] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (status === 'authenticated') loadCounts()
  }, [status])

  async function loadCounts() {
    try {
      const r = await fetch('/api/me/data', { headers: { Accept: 'application/json' } })
      if (r.ok) setCounts(await r.json())
    } catch {}
  }

  async function deleteCategory(id) {
    setDeleting(id)
    setError(null)
    try {
      const r = await fetch('/api/me/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: id }),
      })
      if (r.ok) {
        setDeleted(prev => [...prev, id])
        setConfirming(null)
        await loadCounts()
      } else {
        setError('Deletion failed. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    }
    setDeleting(null)
  }

  async function deleteAccount() {
    setDeletingAccount(true)
    setError(null)
    try {
      const r = await fetch('/api/me', { method: 'DELETE' })
      if (r.ok) {
        router.push('/login?deleted=1')
      } else {
        setError('Account deletion failed. Please contact support.')
      }
    } catch {
      setError('Network error. Please try again.')
    }
    setDeletingAccount(false)
  }

  if (status === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.loadingWrap}>
          <div style={styles.scanTrack}><div style={styles.scanFill} /></div>
        </div>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.lockIcon}>🔒</div>
          <h1 style={styles.title}>Sign in to manage your data</h1>
          <p style={styles.subtitle}>
            You need to be signed in to view and delete your Dutify data.
          </p>
          <button style={styles.signInBtn} onClick={() => signIn(undefined, { callbackUrl: '/removemydata' })}>
            Sign in →
          </button>
        </div>
      </div>
    )
  }

  const email = session?.user?.email ?? ''

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes scan {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rmd-card:hover { border-color: rgba(156,168,138,0.3) !important; }
        .rmd-del-btn:hover:not(:disabled) { background: rgba(196,99,74,0.18) !important; border-color: rgba(196,99,74,0.5) !important; }
        .rmd-confirm-yes:hover:not(:disabled) { opacity: 0.88; }
        .rmd-account-btn:hover:not(:disabled) { background: rgba(196,99,74,0.18) !important; }
      `}</style>

      <div style={styles.shell}>

        {/* Header */}
        <div style={styles.header}>
          <a href="/dashboard" style={styles.backLink}>← Back to Dutify</a>
          <div style={styles.eyebrow}>Data & Privacy</div>
          <h1 style={styles.title}>Your Data</h1>
          <p style={styles.subtitle}>
            Signed in as <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>.
            Below is a summary of all data Dutify holds about your account.
            You can delete individual categories or remove your account entirely.
          </p>
        </div>

        {/* What we collect info box */}
        <div style={styles.infoBox}>
          <div style={styles.infoTitle}>What Dutify collects</div>
          <div style={styles.infoGrid}>
            {[
              ['Account data', 'Email address, display name, plan, registration date'],
              ['Search history', 'Product descriptions you searched and AI-returned HS codes'],
              ['Calculation records', 'Customs duty calculations with line items and totals'],
              ['Saved codes', 'HS codes you bookmarked with notes'],
              ['Preferences', 'Your display, language, AI, and privacy settings'],
              ['Device tokens', 'Push notification registrations from mobile devices'],
              ['Sessions', 'Active login sessions (expire automatically)'],
              ['OTP codes', 'Short-lived email verification codes (auto-expire in 10 min)'],
            ].map(([label, desc]) => (
              <div key={label} style={styles.infoRow}>
                <span style={styles.infoLabel}>{label}</span>
                <span style={styles.infoDesc}>{desc}</span>
              </div>
            ))}
          </div>
          <p style={styles.infoNote}>
            We do not sell your data or share it with third parties.
            Search history may be used anonymously to improve classification accuracy
            when the analytics preference is enabled.
          </p>
        </div>

        {/* Category cards */}
        <div style={styles.sectionTitle}>Delete by category</div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        <div style={styles.cardGrid}>
          {CATEGORIES.map(cat => {
            const isDeleted = deleted.includes(cat.id)
            const count = counts ? countLabel(cat.id, counts) : null
            const empty = counts ? isEmpty(cat.id, counts) : false
            const isConfirming = confirming === cat.id
            const isDeleting = deleting === cat.id

            return (
              <div key={cat.id} className="rmd-card" style={{
                ...styles.card,
                opacity: isDeleted ? 0.45 : 1,
                borderColor: isDeleted ? 'var(--border-subtle)' : isConfirming ? 'rgba(196,99,74,0.4)' : 'var(--border-subtle)',
                transition: 'border-color 0.15s, opacity 0.2s',
              }}>
                <div style={styles.cardTop}>
                  <div style={styles.cardMeta}>
                    <span style={styles.cardIcon}>{cat.icon}</span>
                    <div>
                      <div style={styles.cardLabel}>{cat.label}</div>
                      {count && (
                        <div style={{ ...styles.cardCount, color: empty ? 'var(--text-muted)' : 'var(--sage-light)' }}>
                          {count}
                        </div>
                      )}
                    </div>
                  </div>
                  {isDeleted ? (
                    <span style={styles.deletedBadge}>Deleted</span>
                  ) : (
                    <button
                      className="rmd-del-btn"
                      style={{ ...styles.deleteBtn, opacity: (empty || isDeleting) ? 0.4 : 1, cursor: (empty || isDeleting) ? 'not-allowed' : 'pointer' }}
                      disabled={empty || isDeleting}
                      onClick={() => setConfirming(isConfirming ? null : cat.id)}
                    >
                      {isDeleting ? '…' : 'Delete'}
                    </button>
                  )}
                </div>

                <p style={styles.cardWhat}>{cat.what}</p>

                {isConfirming && !isDeleted && (
                  <div style={styles.confirmRow}>
                    {cat.irreversible && (
                      <span style={styles.confirmWarning}>⚠ This cannot be undone.</span>
                    )}
                    <div style={styles.confirmBtns}>
                      <button style={styles.confirmCancel} onClick={() => setConfirming(null)}>Cancel</button>
                      <button
                        className="rmd-confirm-yes"
                        style={styles.confirmYes}
                        disabled={isDeleting}
                        onClick={() => deleteCategory(cat.id)}
                      >
                        {isDeleting ? 'Deleting…' : 'Yes, delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Full account deletion */}
        <div style={styles.dangerZone}>
          <div style={styles.dangerTitle}>Delete account</div>
          <p style={styles.dangerDesc}>
            Permanently removes your account, all data listed above, and all associated sessions and API tokens.
            This cannot be undone. Your email address will be freed immediately.
          </p>

          {!confirmAccount ? (
            <button
              className="rmd-account-btn"
              style={styles.accountDeleteBtn}
              onClick={() => setConfirmAccount(true)}
            >
              Delete my account
            </button>
          ) : (
            <div style={styles.accountConfirm}>
              <p style={styles.accountConfirmText}>
                Are you sure? This will delete everything associated with <strong>{email}</strong> permanently.
              </p>
              <div style={styles.confirmBtns}>
                <button style={styles.confirmCancel} onClick={() => setConfirmAccount(false)}>Cancel</button>
                <button
                  className="rmd-confirm-yes"
                  style={{ ...styles.confirmYes, background: 'var(--terracotta)', minWidth: 160 }}
                  disabled={deletingAccount}
                  onClick={deleteAccount}
                >
                  {deletingAccount ? 'Deleting…' : 'Yes, delete everything'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          Questions about your data? Contact{' '}
          <a href="mailto:privacy@dutify.lu" style={styles.footerLink}>privacy@dutify.lu</a>
        </div>

      </div>
    </div>
  )
}

const C = {
  bg: '#13161C',
  bgCard: '#1C1F26',
  bgRaised: '#22262F',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.13)',
  textPrimary: '#E8EAF0',
  textSecondary: '#9CA0AB',
  textMuted: '#5C6070',
  sage: '#9CA88A',
  sageLight: '#B8C4A4',
  sageBg: 'rgba(156,168,138,0.08)',
  terracotta: '#C4634A',
  terracottaBg: 'rgba(196,99,74,0.08)',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusXl: '16px',
  fontBody: 'var(--font-dmsans), system-ui, sans-serif',
  fontMono: 'var(--font-jbm), monospace',
  fontSerif: 'var(--font-fraunces), Georgia, serif',
}

const styles = {
  page: {
    minHeight: '100vh',
    background: C.bg,
    color: C.textPrimary,
    fontFamily: C.fontBody,
    padding: '40px 20px 80px',
    backgroundImage: 'radial-gradient(circle, rgba(156,168,138,0.04) 1px, transparent 1px)',
    backgroundSize: '22px 22px',
  },
  shell: {
    maxWidth: 680,
    margin: '0 auto',
    animation: 'fadeUp 0.2s ease',
  },
  loadingWrap: {
    maxWidth: 400,
    margin: '120px auto',
  },
  scanTrack: {
    height: 2,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  scanFill: {
    position: 'absolute',
    inset: 0,
    width: '40%',
    background: `linear-gradient(90deg, transparent, ${C.sage}, transparent)`,
    animation: 'scan 1.2s ease-in-out infinite',
  },
  lockIcon: { fontSize: 32, marginBottom: 16 },
  header: { marginBottom: 36 },
  backLink: {
    display: 'inline-block',
    fontFamily: C.fontMono,
    fontSize: 11,
    color: C.textMuted,
    textDecoration: 'none',
    letterSpacing: '0.5px',
    marginBottom: 28,
  },
  eyebrow: {
    fontFamily: C.fontMono,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: '2.8px',
    textTransform: 'uppercase',
    color: C.sage,
    marginBottom: 10,
  },
  title: {
    fontFamily: C.fontSerif,
    fontSize: 38,
    fontWeight: 700,
    fontStyle: 'italic',
    color: C.textPrimary,
    margin: '0 0 12px',
    letterSpacing: '-0.5px',
    lineHeight: 1.05,
  },
  subtitle: {
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 1.6,
    margin: 0,
  },
  signInBtn: {
    marginTop: 24,
    padding: '12px 28px',
    background: C.sage,
    border: 'none',
    borderRadius: C.radiusMd,
    color: '#0E1218',
    fontFamily: C.fontBody,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.1px',
  },
  infoBox: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: C.radiusXl,
    padding: '20px 22px',
    marginBottom: 32,
  },
  infoTitle: {
    fontFamily: C.fontMono,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color: C.textMuted,
    marginBottom: 14,
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  infoRow: {
    display: 'flex',
    gap: 12,
    padding: '7px 0',
    borderBottom: `1px solid ${C.border}`,
    alignItems: 'baseline',
  },
  infoLabel: {
    fontFamily: C.fontMono,
    fontSize: 11,
    fontWeight: 700,
    color: C.textPrimary,
    minWidth: 160,
    flexShrink: 0,
  },
  infoDesc: {
    fontSize: 12.5,
    color: C.textSecondary,
    lineHeight: 1.5,
  },
  infoNote: {
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 1.55,
    margin: '14px 0 0',
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontFamily: C.fontMono,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color: C.textMuted,
    marginBottom: 12,
  },
  errorBanner: {
    padding: '10px 14px',
    background: C.terracottaBg,
    border: `1px solid rgba(196,99,74,0.3)`,
    borderRadius: C.radiusMd,
    fontSize: 13,
    color: C.terracotta,
    marginBottom: 12,
  },
  cardGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 36,
  },
  card: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: C.radiusLg,
    padding: '16px 18px',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  cardMeta: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  cardIcon: { fontSize: 18, lineHeight: 1.3, flexShrink: 0 },
  cardLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: C.textPrimary,
    lineHeight: 1.3,
    marginBottom: 2,
  },
  cardCount: {
    fontFamily: C.fontMono,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.3px',
  },
  cardWhat: {
    fontSize: 12.5,
    color: C.textSecondary,
    lineHeight: 1.55,
    margin: 0,
  },
  deleteBtn: {
    padding: '6px 14px',
    background: C.terracottaBg,
    border: `1px solid rgba(196,99,74,0.25)`,
    borderRadius: C.radiusMd,
    color: C.terracotta,
    fontFamily: C.fontBody,
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
    transition: 'background 0.12s, border-color 0.12s',
  },
  deletedBadge: {
    padding: '4px 10px',
    background: 'rgba(156,168,138,0.08)',
    border: `1px solid rgba(156,168,138,0.2)`,
    borderRadius: '99px',
    fontFamily: C.fontMono,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.5px',
    color: C.sage,
    flexShrink: 0,
  },
  confirmRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px solid ${C.border}`,
  },
  confirmWarning: {
    display: 'block',
    fontSize: 12,
    color: C.terracotta,
    marginBottom: 10,
    fontWeight: 600,
  },
  confirmBtns: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  confirmCancel: {
    padding: '7px 16px',
    background: C.bgRaised,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: C.radiusMd,
    color: C.textSecondary,
    fontFamily: C.fontBody,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  confirmYes: {
    padding: '7px 18px',
    background: C.terracotta,
    border: 'none',
    borderRadius: C.radiusMd,
    color: '#fff',
    fontFamily: C.fontBody,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.12s',
  },
  dangerZone: {
    background: C.bgCard,
    border: `1px solid rgba(196,99,74,0.3)`,
    borderRadius: C.radiusXl,
    padding: '22px 22px',
    marginBottom: 32,
  },
  dangerTitle: {
    fontFamily: C.fontMono,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '2.5px',
    textTransform: 'uppercase',
    color: C.terracotta,
    marginBottom: 10,
  },
  dangerDesc: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  accountDeleteBtn: {
    padding: '9px 20px',
    background: C.terracottaBg,
    border: `1px solid rgba(196,99,74,0.3)`,
    borderRadius: C.radiusMd,
    color: C.terracotta,
    fontFamily: C.fontBody,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  accountConfirm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  accountConfirmText: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 1.55,
    margin: 0,
  },
  footer: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  footerLink: {
    color: C.sage,
    textDecoration: 'none',
  },
}
