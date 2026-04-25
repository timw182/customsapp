'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import s from './dashboard.module.css'
import CalcWizard from '@/components/CalcWizard'

/* ── Icons ──────────────────────────────────────────────────────── */
const Icon = ({ d, size = 15, stroke = 'currentColor', strokeWidth = 1.9, fill = 'none', viewBox = '0 0 24 24', extra = '' }) => (
  <svg width={size} height={size} viewBox={viewBox} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {d.map((path, i) => path.startsWith('<circle') || path.startsWith('<rect') || path.startsWith('<line') || path.startsWith('<polyline') || path.startsWith('<polygon')
      ? <g key={i} dangerouslySetInnerHTML={{ __html: path }} />
      : <path key={i} d={path} />)}
  </svg>
)

const icons = {
  search:   ['M21 21l-4.35-4.35', '<circle cx="11" cy="11" r="8"/>'],
  history:  ['<circle cx="12" cy="12" r="10"/>', 'M12 6v6l4 2'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  calc:     ['<rect x="4" y="2" width="16" height="20" rx="2"/>', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
  tag:      ['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z', 'M7 7h.01'],
  package:  ['M16.5 9.4l-9-5.21', 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.27 6.96 12 12.01 20.73 6.96', 'M12 22.08V12'],
  info:     ['<circle cx="12" cy="12" r="10"/>', 'M12 8v4', 'M12 16h.01'],
  bell:     ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
  settings: ['<circle cx="12" cy="12" r="3"/>', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'],
  camera:   ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', '<circle cx="12" cy="13" r="4"/>'],
  mic:      ['M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v4', 'M8 23h8'],
  chevron:  ['M9 18l6-6-6-6'],
  image:    ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="8.5" cy="8.5" r="1.5"/>', 'M21 15l-5-5L5 21'],
  user:     ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', '<circle cx="12" cy="7" r="4"/>'],
  lock:     ['<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>', 'M7 11V7a5 5 0 0 1 10 0v4'],
  sliders:  ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  printer:  ['<polyline points="6 9 6 2 18 2 18 9"/>', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', '<rect x="6" y="14" width="12" height="8"/>'],
  shield:   ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  globe:    ['<circle cx="12" cy="12" r="10"/>', 'M2 12h20', 'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z'],
  brain:    ['M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z', 'M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z'],
  dots:     ['<circle cx="12" cy="12" r="1"/>', '<circle cx="19" cy="12" r="1"/>', '<circle cx="5" cy="12" r="1"/>'],
  refresh:  ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15'],
  truck:    ['<rect x="1" y="3" width="15" height="13"/>', '<polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>', '<circle cx="5.5" cy="18.5" r="2.5"/>', '<circle cx="18.5" cy="18.5" r="2.5"/>'],
  globe2:   ['<circle cx="12" cy="12" r="10"/>', 'M2 12h20'],
}

function NavIcon({ name, size = 15 }) {
  const paths = icons[name] || icons.info
  return <Icon d={paths} size={size} />
}

/* ── Nav config ─────────────────────────────────────────────────── */
const NAV = [
  { id: 'search',       label: 'Search',       icon: 'search'   },
  { id: 'history',      label: 'History',      icon: 'history'  },
  { id: 'saved',        label: 'Saved',        icon: 'bookmark' },
  { id: 'calculator',   label: 'Calculator',   icon: 'calc'     },
  { id: 'reductions',   label: 'Reductions',   icon: 'tag'      },
  { id: 'goods',        label: 'Goods Index',  icon: 'package'  },
  { id: 'rulings',      label: 'Rulings',      icon: 'info'     },
  { sep: true },
  { id: 'notifications',label: 'Notifications',icon: 'bell'     },
  { id: 'settings',     label: 'Settings',     icon: 'settings' },
]

const PAGE_CRUMBS = {
  search: 'Search', history: 'History', saved: 'Saved',
  calculator: 'Landed Cost Calculator', reductions: 'Reductions',
  goods: 'Goods Index', rulings: 'Rulings',
  notifications: 'Notifications', settings: 'Settings',
}

/* ── Sidebar ─────────────────────────────────────────────────────── */
function Sidebar({ current, onNav, user }) {
  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'U'
  const displayName = user?.name ?? user?.email ?? 'Account'

  return (
    <aside className={s.sidebar}>
      <div className={s.logo}>
        <img src="/logo.svg" alt="Dutify Pocket" className={s.sidebarLogo} />
      </div>
      <nav className={s.nav}>
        {NAV.map((item, i) =>
          item.sep
            ? <div key={i} className={s.navSep} />
            : (
              <button
                key={item.id}
                className={`${s.navItem} ${current === item.id ? s.navItemActive : ''}`}
                onClick={() => onNav(item.id)}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </button>
            )
        )}
      </nav>

      <div className={s.navSep} />
      <div className={s.userPill}>
        <div className={s.userAvatar}>{initials}</div>
        <div className={s.userPillInfo}>
          <span className={s.userPillName}>{displayName}</span>
          <span className={s.userPillSub}>My Account</span>
        </div>
      </div>
    </aside>
  )
}

/* ── Topbar ──────────────────────────────────────────────────────── */
function Topbar({ page, user, calcHs }) {
  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'U'
  const firstName = user?.name?.split(' ')[0] ?? 'User'

  return (
    <header className={s.topbar}>
      <span className={s.topbarCrumb} />
      <div className={s.topbarRight}>
        {page === 'calculator' && calcHs && (
          <div className={s.hsBadge}>
            <span className={s.hsBadgeLbl}>HS Code</span>
            <span className={s.hsBadgeVal}>{calcHs}</span>
          </div>
        )}
        <button className={s.topbarBtn} title="Notifications">
          <NavIcon name="bell" size={18} />
        </button>
      </div>
    </header>
  )
}

/* ── Search page ────────────────────────────────────────────────── */
function Pyramid({ parts }) {
  if (!parts || parts.length === 0) return null
  return (
    <div className={s.pyramid}>
      {parts.map((part, i) => (
        <div key={i} className={s.pyramidRow} style={{ paddingLeft: `${i * 16}px` }}>
          <span className={s.pyramidArrow}>
            {i === 0 ? '●' : '▸'}
          </span>
          <span className={i === parts.length - 1 ? s.pyramidLeaf : s.pyramidText}>
            {part}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatHs(hs6, cn8) {
  const code = cn8 || hs6
  if (!code) return '—'
  if (code.length >= 6) return `${code.slice(0, 4)}.${code.slice(4, 6)}${code.length > 6 ? '.' + code.slice(6, 8) : ''}`
  return code
}

function formatCn(code) {
  if (!code) return '—'
  const d = String(code).replace(/\D/g, '')
  if (d.length >= 10) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}.${d.slice(8,10)}`
  if (d.length >= 8)  return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`
  if (d.length >= 6)  return `${d.slice(0,4)}.${d.slice(4,6)}`
  return d
}

function formatDuty(rate) {
  if (rate == null) return '—'
  if (rate === 0) return 'Free'
  return `${rate}%`
}

function thinkingToProgress(text) {
  if (!text) return null
  if (text.startsWith('Checking cache')) return 5
  if (text.startsWith('Cache hit')) return 85
  if (text.startsWith('Cache miss')) return 12
  if (text.startsWith('Haiku: fast')) return 22
  if (text.startsWith('Haiku →')) return 46
  if (text.startsWith('Haiku uncertain') || text.startsWith('Haiku failed')) return 32
  if (text.startsWith('Sonnet:')) return 38
  if (text.startsWith('Sonnet →')) return 58
  if (text.startsWith('Cross-checking heading')) return 50
  if (text.startsWith('USITC: heading') && text.includes('confirmed')) return 56
  if (text.startsWith('USITC: heading') && text.includes('not found')) return 48
  if (text.startsWith('USITC check inconclusive')) return 55
  if (text.startsWith('Sonnet retry')) return 62
  if (text.startsWith('Multiple candidates')) return 63
  if (text.startsWith('Probing TARIC')) return 68
  if (text.startsWith('TARIC: found') || text.startsWith('TARIC: service')) return 82
  if (text.startsWith('TARIC: heading')) return 78
  if (text.startsWith('Exact match') || text.startsWith('Best match')) return 87
  if (text.startsWith('MFN duty')) return 89
  if (text.startsWith('Fetching US')) return 93
  if (text.startsWith('⚠')) return 91
  return null
}

function SearchPage({ onNavigate, onHsFound }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recent, setRecent] = useState([])
  const [thinking, setThinking] = useState([])
  const [progress, setProgress] = useState(0)
  const [rationaleOpen, setRationaleOpen] = useState(true)
  const [saved, setSaved] = useState(false)
  const [answer, setAnswer] = useState('')
  const [describe, setDescribe] = useState(null) // { code, en, fr } or 'loading'
  const recRef = useRef(null)
  const fileRef = useRef(null)
  const abortRef = useRef(null)
  const describeAbortRef = useRef(null)
  const thinkingBoxRef = useRef(null)

  const digitsOnly = (query || '').replace(/\D/g, '')
  const isCodeMode = digitsOnly.length >= 6 && digitsOnly.length <= 10 && query.trim().replace(/[\s.\-]/g, '') === digitsOnly

  const loadRecent = useCallback(() => {
    fetch('/api/hs-lookup/history', { headers: { Accept: 'application/json' } })
      .then(r => {
        const ct = r.headers.get('content-type') || ''
        return r.ok && ct.includes('application/json') ? r.json() : []
      })
      .then(data => setRecent(Array.isArray(data) ? data.slice(0, 4) : []))
      .catch(() => {})
  }, [])

  useEffect(() => { loadRecent() }, [loadRecent])

  useEffect(() => {
    if (thinkingBoxRef.current) thinkingBoxRef.current.scrollTop = thinkingBoxRef.current.scrollHeight
  }, [thinking])

  // ── Reverse lookup: HS/CN digits → TARIC description pyramid ─────────
  useEffect(() => {
    if (!isCodeMode) {
      setDescribe(null)
      describeAbortRef.current?.abort()
      return
    }
    // Debounce: wait a tick so rapid typing doesn't spam SOAP
    describeAbortRef.current?.abort()
    const ctrl = new AbortController()
    describeAbortRef.current = ctrl
    const t = setTimeout(() => {
      setDescribe('loading')
      fetch(`/api/taric-describe?code=${digitsOnly}`, {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
      })
        .then(async r => {
          const ct = r.headers.get('content-type') || ''
          if (!ct.includes('application/json')) throw new Error(`HTTP ${r.status}`)
          const data = await r.json()
          if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
          return data
        })
        .then(d => setDescribe(d))
        .catch(e => { if (e?.name !== 'AbortError') setDescribe({ error: e.message || 'Lookup failed' }) })
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [isCodeMode, digitsOnly])

  const advanceProgress = useCallback((pct) => {
    setProgress(prev => (pct > prev ? pct : prev))
  }, [])

  const runClassify = useCallback(async (desc) => {
    const trimmed = (desc ?? '').trim()
    if (!trimmed) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setResult(null)
    setError(null)
    setSaved(false)
    setThinking([])
    setProgress(0)
    setAnswer('')

    try {
      const res = await fetch('/api/hs-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ type: 'classify', description: trimmed }),
        signal: ctrl.signal,
      })

      const ct = res.headers.get('content-type') || ''
      if (!res.ok && !ct.includes('text/event-stream')) {
        const txt = await res.text().catch(() => '')
        let msg = `Server returned ${res.status}`
        try { const j = JSON.parse(txt); if (j?.error) msg = j.error } catch {}
        setError(msg)
        return
      }

      if (!ct.includes('text/event-stream')) {
        const data = await res.json().catch(() => null)
        if (!data) { setError('Invalid response'); return }
        setResult(data)
        advanceProgress(100)
        onHsFound(data.hs6 || '')
        loadRecent()
        return
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 2)
          if (!chunk.startsWith('data:')) continue
          const payload = chunk.slice(5).trim()
          let ev
          try { ev = JSON.parse(payload) } catch { continue }
          if (ev.type === 'thinking' && ev.text) {
            setThinking(prev => [...prev, ev.text])
            const pct = thinkingToProgress(ev.text)
            if (pct != null) advanceProgress(pct)
          } else if (ev.type === 'result') {
            setResult(ev.payload)
            advanceProgress(100)
            onHsFound(ev.payload?.hs6 || '')
            loadRecent()
          } else if (ev.type === 'error') {
            setError(ev.message || 'Classification error')
          }
        }
      }
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [onHsFound, loadRecent, advanceProgress])

  const handleClassify = useCallback(() => runClassify(query), [runClassify, query])

  const handleStop = useCallback(() => { abortRef.current?.abort() }, [])

  const handleClear = useCallback(() => {
    abortRef.current?.abort()
    describeAbortRef.current?.abort()
    setQuery('')
    setLoading(false)
    setResult(null)
    setError(null)
    setThinking([])
    setProgress(0)
    setDescribe(null)
    setSaved(false)
    setAnswer('')
    setRationaleOpen(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!result || saved) return
    const hsCode = result.cn8 || result.hs6
    if (!hsCode) return
    try {
      const res = await fetch('/api/favourites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          hsCode,
          description: query.trim() || result.description || '',
          dutyRate: typeof result.standardDutyRate === 'number' ? result.standardDutyRate : undefined,
          reasoning: result.rationale || undefined,
          confidencePct: result.confidencePct ?? undefined,
          sensitiveGoods: result.sensitiveGoods || null,
        }),
      })
      if (res.ok) setSaved(true)
      else setError('Could not save favourite')
    } catch { setError('Network error while saving') }
  }, [result, saved, query])

  const handleAnswerAdd = useCallback(() => {
    if (!answer.trim()) return
    const next = (query.trim() + ' ' + answer.trim()).trim()
    setQuery(next)
    setAnswer('')
    runClassify(next)
  }, [answer, query, runClassify])

  const pickCandidate = useCallback((c) => {
    onHsFound(c.hs6 || '')
    setResult({
      ...c,
      isCandidates: false,
      description: c.description,
      hs6: c.hs6,
      cn8: c.cn8,
      cn10: c.cn10,
      standardDutyRate: c.mfnRate ?? null,
      taricVerified: true,
      confidencePct: c.confidence_pct ?? null,
    })
  }, [onHsFound])

  useEffect(() => () => abortRef.current?.abort(), [])

  const toggleVoice = () => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) return
    if (recRef.current) { recRef.current.stop(); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false
    recRef.current = r
    setRecording(true)
    r.onresult = e => { setQuery(e.results[0][0].transcript); recRef.current = null; setRecording(false) }
    r.onend = () => { recRef.current = null; setRecording(false) }
    r.start()
  }

  const pct = result?.confidencePct
  const confLevel = pct != null ? (pct >= 85 ? 'high' : pct >= 60 ? 'med' : 'low') : null
  const isCandidates = !!(result && result.isCandidates)
  const isNeedsInfo = !!(result && result.needsMoreInfo)
  const isSuccess = !!(result && !isCandidates && !isNeedsInfo && !result.error && (result.cn8 || result.hs6))

  const showWorkspace = loading || thinking.length > 0 || !!result || !!error || (isCodeMode && !!describe)

  return (
    <div className={`${s.page} ${s.pageSearch} ${showWorkspace ? s.pageSearchActive : ''}`}>
      <div className={s.searchWrap}>

        {/* ── Top fixed: title + input + button ────────── */}
        <div className={s.searchTop}>
          <h1 className={s.pageTitle}>Dutify HS Code Lookup</h1>

          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} />

          {/* Mobile-style input row: mic | text | camera — fused pill */}
          <div className={`${s.mInputRow} ${recording ? s.mInputRowListening : ''}`}>
            <button
              className={`${s.mMicBtn} ${recording ? s.mMicBtnActive : ''}`}
              onClick={toggleVoice}
              title="Voice input"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            <input
              className={s.mInput}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleClassify()}
              placeholder="Describe the product or enter keywords..."
              autoComplete="off"
              spellCheck="false"
            />
            <button
              className={s.mCamBtn}
              onClick={() => fileRef.current?.click()}
              title="Upload image"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          </div>

          {loading ? (
            <button className={`${s.mClassifyBtn} ${s.mStopBtn}`} onClick={handleStop}>
              <span>✕ Stop</span>
            </button>
          ) : !isCodeMode ? (
            <button
              className={s.mClassifyBtn}
              onClick={handleClassify}
              disabled={!query.trim()}
            >
              <span>Classify →</span>
            </button>
          ) : null}
        </div>

        {/* ── Workspace: two-column result area (only when active) ── */}
        {showWorkspace && (
          <div className={`${s.workspace} ${isCodeMode ? s.workspaceSingle : ''}`}>
            <button
              type="button"
              className={s.wsClose}
              onClick={handleClear}
              aria-label="Close and clear"
              title="Close and clear"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {isCodeMode && describe ? (
              <div className={s.pyramidCard}>
                <div className={s.pyramidHead}>
                  <span className={s.pyramidCode}>{formatCn(digitsOnly)}</span>
                  <span className={s.pyramidSub}>TARIC description · EN + FR</span>
                </div>
                {describe === 'loading' && <div className={s.empty}>Fetching from EU TARIC…</div>}
                {describe?.error && <div className={s.errorCard} style={{ marginBottom: 0 }}>{describe.error}</div>}
                {Array.isArray(describe.en) && (describe.en.length > 0 || describe.fr?.length > 0) && (
                  <div className={s.pyramidGrid}>
                    <div className={s.pyramidCol}>
                      <div className={s.pyramidLang}>EN</div>
                      <Pyramid parts={describe.en} />
                    </div>
                    <div className={s.pyramidDivider} />
                    <div className={s.pyramidCol}>
                      <div className={`${s.pyramidLang} ${s.pyramidLangFr}`}>FR</div>
                      <Pyramid parts={describe.fr} />
                    </div>
                  </div>
                )}
              </div>
            ) : <>
            {/* Left: thinking feed */}
            <div className={s.wsLeft}>
              {(loading || thinking.length > 0) && (
                <div className={s.thinkingWrap} style={{ marginBottom: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div className={s.thinkingHeader}>
                    <span className={`${s.thinkingDot} ${loading ? s.thinkingDotActive : ''}`} />
                    <span className={s.thinkingLabel}>{loading ? 'Processing…' : 'Complete'}</span>
                    <span className={s.thinkingPct}>{progress}%</span>
                  </div>
                  <div className={s.progressTrack}>
                    <div className={s.progressFill} style={{ width: `${progress}%` }} />
                  </div>
                  <div ref={thinkingBoxRef} className={s.thinkingFeed} style={{ flex: 1, maxHeight: 'none' }}>
                    {thinking.map((line, i) => {
                      const isResult = line.includes('✓') || line.includes('⚡') || line.includes('→') || line.startsWith('MFN') || line.startsWith('Exact') || line.startsWith('Best')
                      const isWarn = line.startsWith('⚠') || line.startsWith('Haiku uncertain') || line.startsWith('TARIC: heading') || line.startsWith('Fatal')
                      return (
                        <div key={i} className={`${s.thinkingLine} ${isResult ? s.thinkingLineOk : ''} ${isWarn ? s.thinkingLineWarn : ''}`}>
                          <span className={s.thinkingPrefix}>{isResult ? '→' : isWarn ? '!' : '·'}</span>
                          <span>{line}</span>
                        </div>
                      )
                    })}
                    {loading && <div className={s.thinkingLine}><span className={s.thinkingPrefix}>·</span><span style={{ opacity: 0.5 }}>…</span></div>}
                  </div>
                </div>
              )}
            </div>

            {/* Right: result / error / candidates / needs info */}
            <div className={s.wsRight}>
              {error && <div className={s.errorCard}>{error}</div>}

              {isNeedsInfo && (
                <div className={s.resultCard} style={{ marginBottom: 0 }}>
                  <div className={s.needsTitle}>Needs more info</div>
                  {Array.isArray(result.questions) && result.questions.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {result.questions.map((q, i) => {
                        const qText = typeof q === 'string' ? q : q.question
                        const qAnswers = typeof q === 'string' ? [] : (Array.isArray(q.answers) ? q.answers : [])
                        return (
                          <div key={i} className={s.needsQGroup}>
                            <div className={s.needsQText}>{qText}</div>
                            {qAnswers.length > 0 && (
                              <div className={s.answerPills}>
                                {qAnswers.map((a, j) => (
                                  <button
                                    key={j}
                                    className={s.answerPill}
                                    onClick={() => {
                                      const next = (query.trim() + ' ' + a).trim()
                                      setQuery(next)
                                      runClassify(next)
                                    }}
                                  >
                                    {a}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className={s.answerRow}>
                    <input
                      className={s.answerInput}
                      value={answer}
                      onChange={e => setAnswer(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAnswerAdd()}
                      placeholder="Or type your own details and reclassify…"
                    />
                    <button className={s.answerSend} onClick={handleAnswerAdd} disabled={!answer.trim()}>
                      Send
                    </button>
                  </div>
                </div>
              )}

              {isCandidates && Array.isArray(result.candidates) && (
                <div className={s.resultCard} style={{ marginBottom: 0 }}>
                  <div className={s.needsTitle}>Multiple candidates</div>
                  <div className={s.candidateList}>
                    {result.candidates.map((c, i) => (
                      <button key={i} className={s.candidateItem} onClick={() => pickCandidate(c)}>
                        <div className={s.candCode}>{formatCn(c.cn8 || c.hs6)}</div>
                        <div className={s.candDesc}>{c.description}</div>
                        {c.confidence_pct != null && <span className={s.candPct}>{c.confidence_pct}%</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {isSuccess && (
                <div className={s.resultCard} style={{ marginBottom: 0 }}>
                  <div className={s.resultTop}>
                    <div>
                      <div className={s.resultHs}>{formatCn(result.cn10 || result.cn8 || result.hs6)}</div>
                      <div className={s.resultName}>{result.description || query}</div>
                    </div>
                    {pct != null && (
                      <span className={`${s.confBadge} ${confLevel === 'high' ? s.confHigh : confLevel === 'med' ? s.confMed : s.confLow}`}>
                        {pct}%
                      </span>
                    )}
                  </div>
                  <div className={s.resultMeta}>
                    <div className={s.metaItem}>
                      <span className={s.metaLbl}>Duty Rate</span>
                      <span className={s.metaVal}>{formatDuty(result.standardDutyRate)}</span>
                    </div>
                    <div className={s.metaItem}>
                      <span className={s.metaLbl}>VAT · LU</span>
                      <span className={s.metaVal}>{result.vatRateLU ?? 17}%</span>
                    </div>
                    <div className={s.metaItem}>
                      <span className={s.metaLbl}>TARIC</span>
                      <span className={s.metaVal}>
                        {result.taricVerified === true ? '✓ Validated' : result.taricVerified === false ? '— Not validated' : '—'}
                      </span>
                    </div>
                  </div>

                  {result.taricWarning && <div className={s.warnBox}>{result.taricWarning}</div>}

                  {result.sensitiveGoods && (
                    <div className={s.sensBox}>
                      <div className={s.sensTitle}>⚠ {result.sensitiveGoods.category}</div>
                      <div className={s.sensBody}>{result.sensitiveGoods.warning}</div>
                    </div>
                  )}

                  {result.rationale && (
                    <div className={s.rationaleBlock}>
                      <button className={s.rationaleToggle} onClick={() => setRationaleOpen(o => !o)}>
                        <span>GRI · WCO · BTI Reasoning</span>
                        <span style={{ transform: rationaleOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
                      </button>
                      {rationaleOpen && <div className={s.rationaleText}>{result.rationale}</div>}
                    </div>
                  )}

                  <div className={s.resultActions}>
                    {(result.cn10 || result.cn8 || result.hs6) && (
                      <button
                        className={s.saveBtn}
                        style={{ background: 'var(--sage)', color: '#0E1218', border: 'none' }}
                        onClick={() => {
                          onHsFound(result.cn10 || result.cn8 || result.hs6 || '')
                          onNavigate('calculator')
                        }}
                      >
                        Use in Calculator →
                      </button>
                    )}
                    <button className={s.saveBtn} onClick={handleSave} disabled={saved}>
                      {saved ? '✓ Saved' : '☆ Save to favourites'}
                    </button>
                    {(result.cn8 || result.hs6) && (
                      <a
                        className={s.linkBtn}
                        href={buildEbtiUrl({ hs: result.cn8 || result.hs6 })}
                        target="_blank"
                        rel="noreferrer"
                      >View BTIs ↗</a>
                    )}
                    {result.saturnUrl && (
                      <a className={s.linkBtn} href={result.saturnUrl} target="_blank" rel="noreferrer">Saturn ↗</a>
                    )}
                  </div>
                </div>
              )}
            </div>
            </>}
          </div>
        )}

        {/* ── Recent searches (only when idle) ────────── */}
        {!showWorkspace && recent.length > 0 && (
          <div className={s.recentBottom}>
            <div className={s.recentHead}>
              <span className={s.recentTitle}>Recent searches</span>
            </div>
            <div className={s.recentGrid}>
              {recent.map(r => {
                const green = !!r.hs6
                const code = formatHs(r.hs6, r.cn8)
                const name = r.description?.length > 28 ? r.description.slice(0, 26) + '…' : (r.description || '—')
                const conf = Number.isFinite(r.confidencePct) ? `${r.confidencePct}%` : (green ? 'OK' : '—')
                return (
                  <div key={r.id} className={s.recentCard} onClick={() => setQuery(r.description || '')}>
                    <div className={s.recentCardConf} style={{
                      background: green ? 'rgba(76,175,80,0.15)' : 'rgba(239,83,80,0.15)',
                      border: `1px solid ${green ? 'rgba(76,175,80,0.35)' : 'rgba(239,83,80,0.35)'}`,
                      color: green ? '#81C784' : '#EF9A9A',
                    }}>{conf}</div>
                    <div className={s.recentCardName}>{name}</div>
                    <div className={s.recentCardCode}>{code}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── History page ────────────────────────────────────────────────── */
function HistoryPage() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hs-lookup/history', { headers: { Accept: 'application/json' } })
      .then(async r => {
        const ct = r.headers.get('content-type') || ''
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        if (!ct.includes('application/json')) throw new Error('Unexpected response')
        return r.json()
      })
      .then(data => { if (!cancelled) setItems(Array.isArray(data) ? data : []) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>History</h1>
      <div className={s.sectionLabel}>Recent Searches</div>
      {error && <div className={s.empty}>{error}</div>}
      {!error && items == null && <div className={s.empty}>Loading…</div>}
      {!error && items?.length === 0 && <div className={s.empty}>No searches yet. Classify a product on the Search page to build history.</div>}
      {items?.length > 0 && (
        <div className={s.histList}>
          {items.map(item => (
            <div key={item.id} className={s.histItem}>
              <div className={s.histThumb}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <div className={s.histBody}>
                <div className={s.histName}>{item.description}</div>
                <div className={s.histDesc}>{new Date(item.createdAt).toLocaleString()} · Duty {formatDuty(item.dutyRate)}</div>
              </div>
              <div className={s.histRight}>
                <span className={s.histCode}>{formatHs(item.hs6, item.cn8)}</span>
                <span className={`${s.badge} ${item.fromCache ? s.badgeCache : s.badgeSage}`}>
                  {item.fromCache ? 'From Cache' : 'AI + TARIC'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Calculator page ─────────────────────────────────────────────── */
function Section({ id, title, icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={s.sectionCard}>
      <div className={s.sectionHead} onClick={() => setOpen(o => !o)}>
        <div className={s.sectionHeadLeft}>
          <NavIcon name={icon} size={15} />
          <span className={s.sectionTitle}>{title}</span>
        </div>
        <span className={`${s.sectionToggle} ${!open ? s.sectionToggleCollapsed : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>
      {open && <div className={s.sectionBody}>{children}</div>}
    </div>
  )
}

const CALC_TABS = [
  { id: 'product',  label: 'Calculators' },
  { id: 'shipping', label: 'Shipping & Logistics' },
  { id: 'origin',   label: 'Origin & Taxes' },
]

function CalculatorPage({ onHsFound }) {
  const [tab, setTab] = useState('product')
  const [form, setForm] = useState({
    hs: '', desc: '',
    qty: '1', value: '', weight: '', weightUnit: 'kg',
    origin: 'CN', shipMethod: 'sea',
    shipping: '', insurance: '', brokerage: '',
    tariff: '', vat: '21', addDuties: '0',
    incoterms: 'CIF', scheme: 'mfn', dest: 'LU',
    override: '', antiDump: '',
  })
  const [advOpen, setAdvOpen] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const qty      = parseFloat(form.qty)  || 1
  const unitVal  = parseFloat(form.value) || 0
  const ship     = parseFloat(form.shipping) || 0
  const ins      = parseFloat(form.insurance) || 0
  const broker   = parseFloat(form.brokerage) || 0
  const tariff   = parseFloat(form.tariff) || 0
  const vat      = parseFloat(form.vat) || 21
  const addDuty  = parseFloat(form.addDuties) || 0
  const override = parseFloat(form.override)
  const antiDump = parseFloat(form.antiDump) || 0

  const itemVal  = qty * unitVal
  const cif      = itemVal + ship + ins
  const dutyRate = Number.isFinite(override) ? override : (tariff + addDuty + antiDump)
  const duty     = cif * (dutyRate / 100)
  const taxable  = cif + duty
  const vatAmt   = taxable * (vat / 100)
  const otherFees = broker + ins
  const total    = taxable + vatAmt + broker
  const fmt      = v => v > 0 ? `$${v.toFixed(2)}` : '$—'

  const fInput = (k, placeholder, { type = 'text', suffix = null } = {}) => (
    <div className={s.cInputWrap}>
      <input
        className={s.cInput}
        value={form[k]}
        onChange={e => { set(k, e.target.value); if (k === 'hs') onHsFound(e.target.value) }}
        placeholder={placeholder}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
      />
      {suffix && <span className={s.cInputSuffix}>{suffix}</span>}
    </div>
  )
  const fSelect = (k, opts) => (
    <div className={s.cInputWrap}>
      <select className={`${s.cInput} ${s.cSelect}`} value={form[k]} onChange={e => set(k, e.target.value)}>
        {opts.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}
      </select>
    </div>
  )

  return (
    <div className={`${s.page} ${s.pageCalc}`}>
      <div className={s.calcGrid}>

        {/* Left form panel */}
        <div className={s.calcPanel}>
          <div className={s.calcHead}>
            <h1 className={s.calcTitle}>Landed Cost</h1>
            <button className={s.calcReset} onClick={() => setForm(f => ({ ...f, qty: '1', value: '', shipping: '', insurance: '', brokerage: '', tariff: '', addDuties: '0', override: '', antiDump: '' }))}>
              Reset
            </button>
          </div>

          <div className={s.calcTabs}>
            {CALC_TABS.map(t => (
              <button
                key={t.id}
                className={`${s.calcTab} ${tab === t.id ? s.calcTabActive : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'product' && (
            <div className={s.calcSection}>
              <div className={s.calcGroupLabel}>Product Basics</div>

              <div className={s.calcRow}>
                {fInput('hs', 'HS Code (e.g. 8518.30.95)')}
                <button className={s.calcAuxBtn} title="Look up HS code">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/>
                  </svg>
                </button>
              </div>

              <textarea
                className={`${s.cInput} ${s.cTextarea}`}
                value={form.desc}
                onChange={e => set('desc', e.target.value)}
                placeholder="Product Description"
                rows={3}
              />

              <div className={s.calcSubgrid3}>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Quantity</label>
                  {fInput('qty', '1', { type: 'number' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Unit Value</label>
                  {fInput('value', '0.00', { type: 'number', suffix: '$' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Weight ({form.weightUnit})</label>
                  {fInput('weight', '0.0', { type: 'number' })}
                </div>
              </div>

              <div className={s.calcSubgrid2}>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Origin Country</label>
                  {fSelect('origin', [
                    { v: 'CN', l: 'China (CN)' },
                    { v: 'VN', l: 'Vietnam (VN)' },
                    { v: 'IN', l: 'India (IN)' },
                    { v: 'US', l: 'United States (US)' },
                    { v: 'BD', l: 'Bangladesh (BD)' },
                    { v: 'TR', l: 'Turkey (TR)' },
                    { v: 'DE', l: 'Germany (DE)' },
                  ])}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Shipping Method</label>
                  {fSelect('shipMethod', [
                    { v: 'sea', l: 'Sea freight' },
                    { v: 'air', l: 'Air freight' },
                    { v: 'road', l: 'Road' },
                    { v: 'rail', l: 'Rail' },
                    { v: 'courier', l: 'Express courier' },
                  ])}
                </div>
              </div>
            </div>
          )}

          {tab === 'shipping' && (
            <div className={s.calcSection}>
              <div className={s.calcGroupLabel}>Shipping & Logistics</div>

              <div className={s.calcSubgrid2}>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Shipping Cost</label>
                  {fInput('shipping', '0.00', { type: 'number', suffix: '$' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Incoterms</label>
                  {fSelect('incoterms', ['EXW','FOB','CIF','DDP','DAP','FCA'])}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Brokerage</label>
                  {fInput('brokerage', '0.00', { type: 'number', suffix: '$' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Destination</label>
                  {fSelect('dest', [
                    { v: 'LU', l: 'Luxembourg (LU)' },
                    { v: 'DE', l: 'Germany (DE)' },
                    { v: 'FR', l: 'France (FR)' },
                    { v: 'BE', l: 'Belgium (BE)' },
                    { v: 'NL', l: 'Netherlands (NL)' },
                  ])}
                </div>
              </div>
            </div>
          )}

          {tab === 'origin' && (
            <div className={s.calcSection}>
              <div className={s.calcGroupLabel}>Origin & Taxes</div>

              <div className={s.calcSubgrid2}>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Insurance Value</label>
                  {fInput('insurance', '0.00', { type: 'number', suffix: '$' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Customs Duty Rate (%)</label>
                  {fInput('tariff', '0.0', { type: 'number' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>VAT Rate (%)</label>
                  {fInput('vat', '21', { type: 'number' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Preference Scheme</label>
                  {fSelect('scheme', [
                    { v: 'mfn', l: 'None (MFN)' },
                    { v: 'gsp', l: 'GSP' },
                    { v: 'eba', l: 'EBA' },
                    { v: 'pem', l: 'PEM' },
                    { v: 'rex', l: 'REX' },
                  ])}
                </div>
              </div>
            </div>
          )}

          {/* Advanced options — always at bottom, all tabs */}
          <div className={s.calcAdv}>
            <button className={s.calcAdvToggle} onClick={() => setAdvOpen(o => !o)}>
              <span>Advanced Options</span>
              <span style={{ transform: advOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
            </button>
            {advOpen && (
              <div className={s.calcSubgrid2} style={{ marginTop: 10 }}>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Custom Duty Override (%)</label>
                  {fInput('override', 'Auto', { type: 'number' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Anti-Dumping Duty (%)</label>
                  {fInput('antiDump', '0.0', { type: 'number' })}
                </div>
                <div className={s.calcField}>
                  <label className={s.calcFieldLabel}>Additional Duties</label>
                  {fSelect('addDuties', [
                    { v: '0',   l: 'None' },
                    { v: '3.7', l: 'Standard (3.7%)' },
                    { v: '6.5', l: '6.5%' },
                    { v: '12',  l: '12%' },
                  ])}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right results panel */}
        <aside className={s.calcResults}>
          <div className={s.crTitle}>Live Results</div>

          <div className={s.crRow}>
            <span className={s.crKey}>Duties</span>
            <span className={s.crVal}>{fmt(duty)}</span>
          </div>
          <div className={s.crRow}>
            <span className={s.crKey}>VAT</span>
            <span className={s.crVal}>{fmt(vatAmt)}</span>
          </div>
          <div className={s.crRow}>
            <span className={s.crKey}>Other Fees</span>
            <span className={s.crVal}>{fmt(otherFees)}</span>
          </div>

          <div className={s.crTotalCard}>
            <div className={s.crTotalLbl}>Total Landed Cost</div>
            <div className={s.crTotalVal}>{fmt(total)}</div>
          </div>

          <div className={s.crMeta}>
            <div className={s.crMetaRow}><span>HS Code</span><span>{form.hs || '—'}</span></div>
            <div className={s.crMetaRow}><span>CIF Value</span><span>{fmt(cif)}</span></div>
            <div className={s.crMetaRow}><span>Applied Duty</span><span>{dutyRate.toFixed(1)}%</span></div>
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ── Settings page ───────────────────────────────────────────────── */
const SETTINGS_CARDS = [
  { icon: 'user',    title: 'Account',         desc: 'Manage your profile, email address, and account preferences.' },
  { icon: 'sliders', title: 'Preferences',     desc: 'Adjust display settings, default currency, and interface preferences.' },
  { icon: 'brain',   title: 'AI Settings',     desc: 'Configure Dutify AI classification model and confidence thresholds.' },
  { icon: 'lock',    title: 'Data & Privacy',  desc: 'Manage your search history, data retention, and privacy controls.' },
  { icon: 'printer', title: 'Export & Reports',desc: 'Configure PDF templates, export formats, and report settings.' },
  { icon: 'bell',    title: 'Notifications',   desc: 'Set up tariff change alerts, ruling updates, and push notifications.' },
  { icon: 'globe',   title: 'Integrations',    desc: 'Connect to customs brokers, ERP systems, and logistics platforms.' },
  { icon: 'shield',  title: 'Security',        desc: 'Two-factor authentication, active sessions, and API key management.' },
  { icon: 'settings',title: 'Advanced',        desc: 'Developer options, beta features, and advanced classification settings.' },
]

function SettingsPage() {
  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Settings</h1>
      <div className={s.settingsGrid}>
        {SETTINGS_CARDS.map(card => (
          <div key={card.title} className={s.settingsCard}>
            <div className={s.settingsCardIcon}><NavIcon name={card.icon} size={18} /></div>
            <div className={s.settingsCardTitle}>{card.title}</div>
            <div className={s.settingsCardDesc}>{card.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Rulings (Binding Tariff Information) ─────────────────────────── */
const EU_COUNTRIES = [
  { v: '',   l: 'Any Member State' },
  { v: 'AT', l: 'Austria' }, { v: 'BE', l: 'Belgium' }, { v: 'BG', l: 'Bulgaria' },
  { v: 'HR', l: 'Croatia' }, { v: 'CY', l: 'Cyprus' }, { v: 'CZ', l: 'Czechia' },
  { v: 'DK', l: 'Denmark' }, { v: 'EE', l: 'Estonia' }, { v: 'FI', l: 'Finland' },
  { v: 'FR', l: 'France' }, { v: 'DE', l: 'Germany' }, { v: 'GR', l: 'Greece' },
  { v: 'HU', l: 'Hungary' }, { v: 'IE', l: 'Ireland' }, { v: 'IT', l: 'Italy' },
  { v: 'LV', l: 'Latvia' }, { v: 'LT', l: 'Lithuania' }, { v: 'LU', l: 'Luxembourg' },
  { v: 'MT', l: 'Malta' }, { v: 'NL', l: 'Netherlands' }, { v: 'PL', l: 'Poland' },
  { v: 'PT', l: 'Portugal' }, { v: 'RO', l: 'Romania' }, { v: 'SK', l: 'Slovakia' },
  { v: 'SI', l: 'Slovenia' }, { v: 'ES', l: 'Spain' }, { v: 'SE', l: 'Sweden' },
]

function buildEbtiUrl({ hs, keyword, country, includeInvalid }) {
  const digits = (hs || '').replace(/\D/g, '').slice(0, 10)
  const params = new URLSearchParams({ Lang: 'en', nomenc: 'CN', Expand: 'true' })
  if (digits) params.set('Taric', digits)
  if (keyword?.trim()) params.set('keywordsearch1', keyword.trim())
  if (country) params.set('Country', country)
  if (includeInvalid) params.set('includeinvalid', 'true')
  return `https://ec.europa.eu/taxation_customs/dds2/ebti/ebti_consultation.jsp?${params.toString()}`
}

function RulingsPage({ prefillHs, onNavigate }) {
  const [hs, setHs] = useState(prefillHs || '')
  const [keyword, setKeyword] = useState('')
  const [country, setCountry] = useState('')
  const [includeInvalid, setIncludeInvalid] = useState(false)

  useEffect(() => { if (prefillHs) setHs(prefillHs) }, [prefillHs])

  const handleSearch = () => {
    const url = buildEbtiUrl({ hs, keyword, country, includeInvalid })
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const canSearch = hs.trim().length >= 4 || keyword.trim().length >= 3

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Binding Tariff Information</h1>

      <div className={s.btiIntro}>
        <p>
          BTIs are official customs classification decisions issued by EU Member States.
          A BTI is binding on all customs authorities for <strong>3 years</strong> from its issue date,
          making it the gold standard for disputes.
        </p>
        <p className={s.btiNote}>
          Searches open the European Commission's official EBTI consultation portal in a new tab.
        </p>
      </div>

      <div className={s.btiCard}>
        <div className={s.btiGroupLabel}>Search criteria</div>

        <div className={s.calcSubgrid2}>
          <div className={s.calcField}>
            <label className={s.calcFieldLabel}>HS / CN code</label>
            <div className={s.cInputWrap}>
              <input
                className={s.cInput}
                value={hs}
                onChange={e => setHs(e.target.value.replace(/[^\d.]/g, '').slice(0, 13))}
                placeholder="e.g. 8518 or 8518.30.95"
                inputMode="numeric"
              />
            </div>
          </div>
          <div className={s.calcField}>
            <label className={s.calcFieldLabel}>Keyword (optional)</label>
            <div className={s.cInputWrap}>
              <input
                className={s.cInput}
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="e.g. headphone, wireless, leather"
              />
            </div>
          </div>
          <div className={s.calcField}>
            <label className={s.calcFieldLabel}>Issuing country</label>
            <div className={s.cInputWrap}>
              <select className={`${s.cInput} ${s.cSelect}`} value={country} onChange={e => setCountry(e.target.value)}>
                {EU_COUNTRIES.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </div>
          </div>
          <div className={s.calcField}>
            <label className={s.calcFieldLabel}>Include expired</label>
            <label className={s.btiToggle}>
              <input type="checkbox" checked={includeInvalid} onChange={e => setIncludeInvalid(e.target.checked)} />
              <span>Show BTIs past their validity date</span>
            </label>
          </div>
        </div>

        <button
          className={s.mClassifyBtn}
          onClick={handleSearch}
          disabled={!canSearch}
          style={{ marginTop: 18, marginBottom: 0 }}
        >
          <span>Search EBTI portal ↗</span>
        </button>
      </div>

      <div className={s.btiInfo}>
        <div className={s.btiInfoTitle}>What you'll find on EBTI</div>
        <ul className={s.btiInfoList}>
          <li><strong>Reference number</strong> — unique ID (e.g. DEBTI-2024-1234)</li>
          <li><strong>Nomenclature code</strong> — the chosen 8- or 10-digit CN code</li>
          <li><strong>Description, composition, use, process</strong> — full justification</li>
          <li><strong>Validity dates</strong> — typically 3 years from issuance</li>
          <li><strong>Images</strong> — when supplied by the applicant</li>
        </ul>
      </div>
    </div>
  )
}

/* ── Placeholder page ────────────────────────────────────────────── */
function PlaceholderPage({ title, message }) {
  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>{title}</h1>
      <p className={s.empty}>{message}</p>
    </div>
  )
}

/* ── Root Dashboard ──────────────────────────────────────────────── */
export default function Dashboard() {
  const { data: session } = useSession()
  const [page, setPage] = useState('search')
  const [calcHs, setCalcHs] = useState('')

  const handleHsFound = useCallback(hs => {
    setCalcHs(hs)
  }, [])

  const renderPage = () => {
    switch (page) {
      case 'search':      return <SearchPage onNavigate={setPage} onHsFound={handleHsFound} />
      case 'history':     return <HistoryPage />
      case 'calculator':  return <CalcWizard initialHs={calcHs} onHsFound={setCalcHs} />
      case 'settings':    return <SettingsPage />
      case 'saved':       return <PlaceholderPage title="Saved" message="No saved codes yet. Star a result to save it here." />
      case 'reductions':  return <PlaceholderPage title="Reductions" message="Tariff preference schemes and suspensions — coming soon." />
      case 'goods':       return <PlaceholderPage title="Goods Index" message="Browse the TARIC goods nomenclature — coming soon." />
      case 'rulings':     return <RulingsPage prefillHs={calcHs} onNavigate={setPage} />
      case 'notifications': return <PlaceholderPage title="Notifications" message="No notifications." />
      default:            return null
    }
  }

  return (
    <div className={s.shell}>
      <Sidebar current={page} onNav={setPage} user={session?.user} />
      <main className={s.main}>
        <Topbar page={page} user={session?.user} calcHs={calcHs} />
        <div className={`${s.content} ${page === 'search' ? s.contentNoScroll : ''}`}>
          {renderPage()}
        </div>
      </main>
    </div>
  )
}
