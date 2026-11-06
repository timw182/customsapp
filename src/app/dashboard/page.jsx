'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
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
  { id: 'records',      label: 'Records',      icon: 'bookmark' },
  { id: 'calculator',   label: 'Calculator',   icon: 'calc'     },
  { id: 'reductions',   label: 'Reductions',   icon: 'tag'      },
  { id: 'goods',        label: 'Goods Index',  icon: 'package'  },
  { id: 'rulings',      label: 'Rulings',      icon: 'info'     },
  { sep: true },
  { id: 'notifications',label: 'Notifications',icon: 'bell'     },
  { id: 'settings',     label: 'Settings',     icon: 'settings' },
]

const PAGE_CRUMBS = {
  search: 'Search', records: 'Records',
  calculator: 'Landed Cost Calculator', reductions: 'Reductions',
  goods: 'Goods Index', rulings: 'Rulings',
  notifications: 'Notifications', settings: 'Settings',
}

/* ── Sidebar ─────────────────────────────────────────────────────── */
function Sidebar({ current, onNav, user, unread }) {
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
                {item.id === 'notifications' && unread > 0 && (
                  <span className={s.navItemBadge}>{unread > 99 ? '99+' : unread}</span>
                )}
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
function Topbar({ page, user, calcHs, unread, onBell }) {
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
        <button className={s.topbarBtn} title="Notifications" onClick={onBell} style={{ position: 'relative' }}>
          <NavIcon name="bell" size={18} />
          {unread > 0 && (
            <span className={s.notifCount}>{unread > 9 ? '9+' : unread}</span>
          )}
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

// Browser equivalent of the mobile lib/photo.ts pipeline: load the chosen
// file, downscale to a 1568 px longest edge (Anthropic's vision ceiling), and
// re-encode as JPEG q0.7 → raw base64 (no data: prefix) for /api/hs-lookup.
function fileToResizedBase64(file, MAX = 1568, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) { reject(new Error('Please choose an image file')); return }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const longest = Math.max(img.width, img.height) || MAX
      const scale = longest > MAX ? MAX / longest : 1
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not supported')); return }
      ctx.drawImage(img, 0, 0, w, h)
      const base64 = (canvas.toDataURL('image/jpeg', quality).split(',')[1]) || ''
      if (!base64) { reject(new Error('Failed to encode image')); return }
      resolve({ base64, mediaType: 'image/jpeg' })
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
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

  // Shared transport for both the text and image classification paths: POSTs
  // a body to /api/hs-lookup and consumes either a one-shot JSON reply or the
  // SSE thinking/result/error stream, updating state as events arrive.
  const streamClassify = useCallback(async (body, ctrl) => {
    const res = await fetch('/api/hs-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
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
  }, [onHsFound, loadRecent, advanceProgress])

  // Reset the workspace and arm a fresh AbortController for a new run.
  const beginRun = useCallback(() => {
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
    return ctrl
  }, [])

  const runClassify = useCallback(async (desc) => {
    const trimmed = (desc ?? '').trim()
    if (!trimmed) return
    const ctrl = beginRun()
    try {
      await streamClassify({ type: 'classify', description: trimmed }, ctrl)
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [beginRun, streamClassify])

  // Image classification (Pro): resize client-side, then stream classify-image.
  // The current text box, if any, rides along as a vision hint.
  const runClassifyImage = useCallback(async (file) => {
    const ctrl = beginRun()
    setThinking(['Reading image…'])
    try {
      const { base64, mediaType } = await fileToResizedBase64(file)
      await streamClassify(
        { type: 'classify-image', imageBase64: base64, imageMediaType: mediaType, hint: query.trim() || undefined },
        ctrl,
      )
    } catch (e) {
      if (e?.name !== 'AbortError') setError(e?.message || 'Could not read image')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [beginRun, streamClassify, query])

  const onPickImage = useCallback((e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (file) runClassifyImage(file)
  }, [runClassifyImage])

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

          <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />

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

/* ── Goods Index page ────────────────────────────────────────────── */
const GIX_ORIGINS = [
  { code: 'US', name: 'United States', pref: false, type: 'mfn' },
  { code: 'CN', name: 'China', pref: false, type: 'mfn' },
  { code: 'GB', name: 'United Kingdom', pref: true, type: 'fta' },
  { code: 'TR', name: 'Turkey', pref: true, type: 'cu' },
  { code: 'CH', name: 'Switzerland', pref: true, type: 'fta' },
  { code: 'JP', name: 'Japan', pref: true, type: 'fta' },
  { code: 'KR', name: 'South Korea', pref: true, type: 'fta' },
  { code: 'CA', name: 'Canada', pref: true, type: 'fta' },
  { code: 'SG', name: 'Singapore', pref: true, type: 'fta' },
  { code: 'VN', name: 'Vietnam', pref: true, type: 'fta' },
  { code: 'IN', name: 'India', pref: true, type: 'gsp' },
  { code: 'TH', name: 'Thailand', pref: true, type: 'gsp' },
  { code: 'ID', name: 'Indonesia', pref: true, type: 'gsp' },
  { code: 'MY', name: 'Malaysia', pref: true, type: 'gsp' },
  { code: 'TW', name: 'Taiwan', pref: false, type: 'mfn' },
  { code: 'HK', name: 'Hong Kong', pref: false, type: 'mfn' },
  { code: 'AU', name: 'Australia', pref: true, type: 'fta' },
  { code: 'NZ', name: 'New Zealand', pref: true, type: 'fta' },
  { code: 'MX', name: 'Mexico', pref: true, type: 'fta' },
  { code: 'BR', name: 'Brazil', pref: false, type: 'mfn' },
  { code: 'AR', name: 'Argentina', pref: false, type: 'mfn' },
  { code: 'ZA', name: 'South Africa', pref: true, type: 'epa' },
  { code: 'MA', name: 'Morocco', pref: true, type: 'fta' },
  { code: 'TN', name: 'Tunisia', pref: true, type: 'fta' },
  { code: 'EG', name: 'Egypt', pref: true, type: 'fta' },
  { code: 'IL', name: 'Israel', pref: true, type: 'fta' },
  { code: 'JO', name: 'Jordan', pref: true, type: 'fta' },
  { code: 'LB', name: 'Lebanon', pref: true, type: 'fta' },
  { code: 'UA', name: 'Ukraine', pref: true, type: 'fta' },
  { code: 'GE', name: 'Georgia', pref: true, type: 'fta' },
  { code: 'MD', name: 'Moldova', pref: true, type: 'fta' },
  { code: 'RS', name: 'Serbia', pref: true, type: 'atp' },
  { code: 'AL', name: 'Albania', pref: true, type: 'atp' },
  { code: 'ME', name: 'Montenegro', pref: true, type: 'atp' },
  { code: 'MK', name: 'North Macedonia', pref: true, type: 'atp' },
  { code: 'BA', name: 'Bosnia & Herzegovina', pref: true, type: 'atp' },
  { code: 'NO', name: 'Norway', pref: true, type: 'eea' },
  { code: 'IS', name: 'Iceland', pref: true, type: 'eea' },
  { code: 'AE', name: 'UAE', pref: false, type: 'mfn' },
  { code: 'SA', name: 'Saudi Arabia', pref: false, type: 'mfn' },
  { code: 'PK', name: 'Pakistan', pref: true, type: 'gsp+' },
  { code: 'BD', name: 'Bangladesh', pref: true, type: 'eba' },
  { code: 'LK', name: 'Sri Lanka', pref: true, type: 'gsp+' },
  { code: 'RU', name: 'Russia', pref: false, type: 'sanctioned' },
  { code: 'BY', name: 'Belarus', pref: false, type: 'sanctioned' },
].sort((a, b) => a.name.localeCompare(b.name))

function GixTree({ parts }) {
  if (!parts?.length) return null
  return (
    <div className={s.gixTree}>
      {parts.map((text, i) => {
        const isLeaf = i === parts.length - 1
        return (
          <div key={i} className={s.gixTreeNode} style={{ paddingLeft: i * 14 }}>
            <span className={`${s.gixTreeIcon}${isLeaf ? ' ' + s.gixTreeLeafIcon : ''}`}>
              {isLeaf ? '◆' : '└'}
            </span>
            <span className={isLeaf ? s.gixTreeLeafText : s.gixTreeText}>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

const GIX_EXAMPLES = ['0901.21', '8471.30', '6403.10', '2204.21']

function GoodsIndexPage() {
  const [input, setInput] = useState('')
  const [origin, setOrigin] = useState('US')
  const [describe, setDescribe] = useState(null)
  const [rate, setRate] = useState(null)
  const abortRef = useRef(null)
  const rateAbortRef = useRef(null)

  const digits = input.replace(/\D/g, '').slice(0, 10)
  const isValid = digits.length >= 6

  function fetchRate(clean, countryCode) {
    rateAbortRef.current?.abort()
    const rateCtrl = new AbortController()
    rateAbortRef.current = rateCtrl
    setRate('loading')
    fetch('/api/taric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cn8: clean, countryCode }),
      signal: rateCtrl.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setRate(d))
      .catch(e => { if (e?.name !== 'AbortError') setRate({ error: true }) })
  }

  function lookup(code, countryCode) {
    const clean = code.replace(/\D/g, '').slice(0, 10)
    if (clean.length < 6) return
    const country = countryCode ?? origin

    abortRef.current?.abort()
    rateAbortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setDescribe('loading')
    setRate(null)

    fetch(`/api/taric-describe?code=${clean}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => setDescribe(d))
      .catch(e => { if (e?.name !== 'AbortError') setDescribe({ error: 'TARIC lookup failed' }) })

    if (clean.length === 10) fetchRate(clean, country)
  }

  const handleSubmit = (e) => { e?.preventDefault(); lookup(input) }

  const handleChange = (e) => {
    setInput(e.target.value)
    setDescribe(null)
    setRate(null)
    abortRef.current?.abort()
    rateAbortRef.current?.abort()
  }

  const handleClear = () => {
    setInput('')
    setDescribe(null)
    setRate(null)
    abortRef.current?.abort()
    rateAbortRef.current?.abort()
  }

  const handleOriginChange = (e) => {
    const newOrigin = e.target.value
    setOrigin(newOrigin)
    // Re-fetch rate if we already have a 10-digit result showing
    const clean = input.replace(/\D/g, '').slice(0, 10)
    if (clean.length === 10 && describe && describe !== 'loading') {
      fetchRate(clean, newOrigin)
    }
  }

  useEffect(() => () => { abortRef.current?.abort(); rateAbortRef.current?.abort() }, [])

  const hasResult = describe && describe !== 'loading'

  // Split code display: HS-6 in primary, EU extension in sage
  const hs6Fmt = digits.length >= 6 ? `${digits.slice(0,4)}.${digits.slice(4,6)}` : digits
  const extFmt = digits.length >= 8
    ? `.${digits.slice(6,8)}${digits.length >= 10 ? `.${digits.slice(8,10)}` : ''}`
    : ''

  const codeType = digits.length === 10 ? 'CN10' : digits.length === 8 ? 'CN8' : 'HS-6'
  const isDeclarable = digits.length === 10

  const originInfo = GIX_ORIGINS.find(c => c.code === origin)

  // Prefer preferential rate when available and country has pref agreement
  const prefMeasure = rate && rate !== 'loading' && !rate.error
    ? rate.preferential?.[0]
    : null
  const usePref = originInfo?.pref && prefMeasure
  const rateDisplay = rate && rate !== 'loading' && !rate.error
    ? usePref
      ? (prefMeasure.dutyRateRaw ?? (prefMeasure.dutyRate?.adValorem != null ? `${prefMeasure.dutyRate.adValorem}%` : 'Free'))
      : (rate.mfnRateRaw ?? (rate.mfnRate != null ? `${rate.mfnRate}%` : 'Free'))
    : null
  const isFree = rateDisplay === 'Free' || (usePref ? prefMeasure?.dutyRate?.adValorem === 0 : rate?.mfnRate === 0)

  return (
    <div className={s.gixPage}>
      <div className={`${s.gixWrap} ${hasResult ? s.gixWrapWide : ''}`}>

      <h1 className={s.pageTitle}>Goods Index</h1>

      {/* Input block */}
      <div className={s.gixInputBlock}>
        <div className={s.gixInputLabel}>Code lookup</div>
        <form onSubmit={handleSubmit}>
          <div className={s.gixInputRow}>
            <input
              className={s.gixInputField}
              value={input}
              onChange={handleChange}
              placeholder="e.g. 6403.10.11.00"
              inputMode="numeric"
              autoFocus
            />
            <button type="submit" className={s.gixLookupBtn} disabled={!isValid}>
              Look up →
            </button>
            {(input || hasResult) && (
              <button type="button" className={s.gixClearBtn} onClick={handleClear} aria-label="Clear">
                ×
              </button>
            )}
          </div>
        </form>
        <div className={s.gixOriginRow}>
          <span className={s.gixOriginLabel}>Origin</span>
          <select
            className={s.gixOriginSelect}
            value={origin}
            onChange={handleOriginChange}
          >
            {GIX_ORIGINS.map(c => (
              <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
            ))}
          </select>
          {(() => {
            const o = GIX_ORIGINS.find(c => c.code === origin)
            if (!o) return null
            const isSanction = o.type === 'sanctioned'
            const isPref = o.pref
            const label = isSanction ? '⚠ Sanctioned'
              : isPref ? (o.type === 'eea' ? 'EEA' : o.type === 'cu' ? 'Customs Union' : o.type.toUpperCase())
              : 'MFN'
            return (
              <span className={`${s.gixOriginPill} ${isSanction ? s.gixOriginPillSanction : isPref ? s.gixOriginPillPref : s.gixOriginPillMfn}`}>
                {label}
              </span>
            )
          })()}
        </div>
        <div className={s.gixExamples}>
          Try:
          {GIX_EXAMPLES.map(ex => (
            <span
              key={ex}
              className={s.gixExCode}
              onClick={() => { setInput(ex); lookup(ex) }}
            >{ex}</span>
          ))}
        </div>
      </div>

      {/* Loading */}
      {describe === 'loading' && (
        <div className={s.gixLoading}>
          <div className={s.gixLoadingText}>Querying EU TARIC…</div>
          <div className={s.gixScanTrack}><div className={s.gixScanFill} /></div>
        </div>
      )}

      {/* Result */}
      {hasResult && (
        <div className={s.gixResult}>

          {/* Code hero */}
          <div className={s.gixCodeHero}>
            <div className={s.gixBigCode}>
              {hs6Fmt}
              {extFmt && <span className={s.gixBigCodeExt}>{extFmt}</span>}
            </div>
            <div className={s.gixBadges}>
              <span className={`${s.gixBadge} ${isDeclarable ? s.gixBadgeSage : ''}`}>
                {codeType}{isDeclarable ? ' · Declarable' : ''}
              </span>
              <span className={s.gixBadge}>EU TARIC</span>
              {describe.error && <span className={`${s.gixBadge} ${s.gixBadgeAmber}`}>Lookup failed</span>}
            </div>
          </div>

          {/* Main grid */}
          <div className={s.gixGrid}>

            {/* Left: description panel */}
            <div className={s.gixDescPanel}>

              {describe.error && (
                <div className={s.gixDescCard}>
                  <div className={s.gixEmpty}>{describe.error}</div>
                </div>
              )}

              {Array.isArray(describe.en) && describe.en.length === 0 && !describe.error && (
                <div className={s.gixDescCard}>
                  <div className={s.gixEmpty}>
                    No description found — code may not exist or is not declarable in TARIC.
                  </div>
                </div>
              )}

              {Array.isArray(describe.en) && describe.en.length > 0 && (
                <div className={s.gixDescCard}>
                  <div className={s.gixLangRow}>
                    <span className={`${s.gixLangPill} ${s.gixLangPillEn}`}>EN</span>
                    <div className={s.gixLangRule} />
                  </div>
                  <GixTree parts={describe.en} />
                </div>
              )}

              {Array.isArray(describe.fr) && describe.fr.length > 0 && (
                <div className={s.gixDescCard}>
                  <div className={s.gixLangRow}>
                    <span className={`${s.gixLangPill} ${s.gixLangPillFr}`}>FR</span>
                    <div className={s.gixLangRule} />
                  </div>
                  <GixTree parts={describe.fr} />
                </div>
              )}
            </div>

            {/* Right: rate + info panel */}
            <div className={s.gixSidePanel}>

              <div className={s.gixRateCard}>
                <div className={s.gixRateLabel}>Import Duty Rate</div>

                {!isDeclarable && (
                  <div className={s.gixRateMuted}>
                    Requires a full 10-digit CN10 code.
                  </div>
                )}

                {isDeclarable && rate === 'loading' && (
                  <>
                    <div className={s.gixRateScan} />
                    <div className={s.gixRateSub} style={{ marginTop: 8 }}>Fetching from TARIC…</div>
                  </>
                )}

                {isDeclarable && rateDisplay && (
                  <>
                    <div className={`${s.gixRateValue}${isFree ? ' ' + s.gixRateValueFree : ''}`}>
                      {rateDisplay}
                    </div>
                    <div className={s.gixRateSub}>
                      {usePref
                        ? `${originInfo?.type?.toUpperCase() ?? 'Pref.'} · ${originInfo?.name ?? origin}`
                        : `MFN · ${originInfo?.name ?? origin}`
                      }
                    </div>
                  </>
                )}

                {isDeclarable && rate?.error && (
                  <div className={s.gixRateMuted}>
                    Rate unavailable — no TARIC data for this code.
                  </div>
                )}
              </div>

              <div className={s.gixInfoCard}>
                <div className={s.gixInfoLabel}>Code Details</div>
                <div className={s.gixInfoRow}>
                  <span className={s.gixInfoKey}>Format</span>
                  <span className={s.gixInfoVal}>{codeType}</span>
                </div>
                <div className={s.gixInfoRow}>
                  <span className={s.gixInfoKey}>Digits</span>
                  <span className={s.gixInfoVal}>{digits.length}</span>
                </div>
                <div className={s.gixInfoRow}>
                  <span className={s.gixInfoKey}>Declarable</span>
                  <span className={s.gixInfoVal}>{isDeclarable ? 'Yes' : 'No'}</span>
                </div>
                <div className={s.gixInfoRow}>
                  <span className={s.gixInfoKey}>Source</span>
                  <span className={s.gixInfoVal}>EU TARIC</span>
                </div>
              </div>
            </div>

            {/* Short-code nudge — spans both columns */}
            {!isDeclarable && !describe.error && Array.isArray(describe.en) && describe.en.length > 0 && (
              <div className={s.gixNudge}>
                <div className={s.gixNudgeDot} />
                Add more digits for a declarable CN10 code and unlock the MFN duty rate.
              </div>
            )}
          </div>

        </div>
      )}
      </div>
    </div>
  )
}

/* ── Settings page ───────────────────────────────────────────────── */
const PREFS_KEY = 'dutify.prefs'
const DEFAULT_PREFS = {
  currency: 'EUR', language: 'en', dateFormat: 'dmy-slash',
  defaultOrigin: null, units: 'metric', showConfidenceScores: true,
  aiModel: 'haiku', confidenceThreshold: 80, autoTaricValidation: true,
  explanationLevel: 'short', showReasoningSteps: true,
  emailNotifications: true, dataUsageAnalytics: true,
}

function loadStoredPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch { return DEFAULT_PREFS }
}

function StgToggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => !disabled && onChange(!value)}
      className={`${s.stgToggleSwitch} ${value ? s.stgToggleSwitchOn : ''}`}
      style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <span className={s.stgToggleSwitchThumb} />
    </button>
  )
}

function StgField({ label, children }) {
  return (
    <div className={s.stgField}>
      <label className={s.stgFieldLabel}>{label}</label>
      {children}
    </div>
  )
}

function StgSelect({ value, onChange, children }) {
  return (
    <select className={s.stgSelect} value={value} onChange={e => onChange(e.target.value)}>
      {children}
    </select>
  )
}

function StgSegmented({ options, value, onChange, isPro }) {
  return (
    <div className={s.stgSegGroup}>
      {options.map(opt => {
        const locked = opt.pro && !isPro
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            className={`${s.stgSeg} ${active ? s.stgSegActive : ''}`}
            onClick={() => onChange(opt.value, locked)}
          >
            {locked && <span className={s.stgSegProBadge}>★ Pro</span>}
            <span className={`${s.stgSegLabel} ${active ? s.stgSegLabelActive : ''}`}>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function StgToggleRow({ label, sub, value, onChange, disabled, customRight }) {
  return (
    <div className={s.stgToggleRow}>
      <div className={s.stgToggleText}>
        <div className={s.stgToggleLabel}>{label}</div>
        {sub && <div className={s.stgToggleSub}>{sub}</div>}
      </div>
      {customRight || <StgToggle value={value} onChange={onChange} disabled={disabled} />}
    </div>
  )
}

const STG_SECTIONS = [
  { id: 'account',       label: 'Account' },
  { id: 'preferences',   label: 'Preferences' },
  { id: 'ai',            label: 'AI' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy',       label: 'Privacy' },
  { id: 'support',       label: 'Support' },
]

// Deletable data categories surfaced in Privacy → Your Data. Keys match the
// counts returned by GET /api/me/data and the categories accepted by DELETE.
const DATA_CATEGORIES = [
  { key: 'searchHistory', label: 'Search history',  unit: 'lookup',       unitPlural: 'lookups' },
  { key: 'favourites',    label: 'Saved codes',     unit: 'record',       unitPlural: 'records' },
  { key: 'shipments',     label: 'Saved shipments', unit: 'shipment',     unitPlural: 'shipments' },
  { key: 'notifications', label: 'Notifications',   unit: 'notification', unitPlural: 'notifications' },
]

function SettingsPage() {
  const { data: session } = useSession()
  const [me, setMe] = useState(null)
  const [prefs, setPrefs] = useState(DEFAULT_PREFS)
  const [saveStatus, setSaveStatus] = useState(null) // null | 'saving' | 'saved' | 'error'
  const [activeSection, setActiveSection] = useState('account')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [proMsg, setProMsg] = useState(null) // null | string (field name)
  // Profile (account-wide store at /api/me/profile)
  const [profile, setProfile] = useState(null) // { name, company, phone, avatar }
  const [profileForm, setProfileForm] = useState({ name: '', company: '', phone: '' })
  const [profileStatus, setProfileStatus] = useState(null) // null | 'saving' | 'saved' | 'error'
  const avatarFileRef = useRef(null)
  // Change password
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwStatus, setPwStatus] = useState(null) // null | 'saving' | 'saved'
  const [pwError, setPwError] = useState(null)
  // Support ticket
  const [support, setSupport] = useState({ subject: '', message: '' })
  const [supportStatus, setSupportStatus] = useState(null) // null | 'sending' | 'sent' | 'error'
  const [supportError, setSupportError] = useState(null)
  // Data categories
  const [dataCounts, setDataCounts] = useState(null)
  const [dataBusy, setDataBusy] = useState(null) // category currently clearing
  const sectionRefs = useRef({})
  const saveTimer = useRef(null)
  const saveStatusTimer = useRef(null)
  const proMsgTimer = useRef(null)
  const profileSaveTimer = useRef(null)

  // Load from localStorage immediately, then replace with server prefs once fetched
  useEffect(() => { setPrefs(loadStoredPrefs()) }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/me', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
      fetch('/api/me/prefs', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
      fetch('/api/me/profile', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
      fetch('/api/me/data', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
    ]).then(([meData, prefsData, profData, dataData]) => {
      if (meData?.user) setMe(meData.user)
      if (prefsData?.prefs) {
        const merged = { ...DEFAULT_PREFS, ...prefsData.prefs }
        setPrefs(merged)
        // Keep localStorage in sync as a fast local cache
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)) } catch {}
      }
      if (profData?.profile) {
        setProfile(profData.profile)
        setProfileForm({
          name: profData.profile.name || '',
          company: profData.profile.company || '',
          phone: profData.profile.phone || '',
        })
      }
      if (dataData) setDataCounts(dataData)
    }).catch(() => {})
  }, [])

  const persistToServer = useCallback((next) => {
    clearTimeout(saveTimer.current)
    clearTimeout(saveStatusTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(() => {
      fetch('/api/me/prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(r => {
          setSaveStatus(r.ok ? 'saved' : 'error')
          saveStatusTimer.current = setTimeout(() => setSaveStatus(null), 2000)
        })
        .catch(() => {
          setSaveStatus('error')
          saveStatusTimer.current = setTimeout(() => setSaveStatus(null), 2000)
        })
    }, 600)
  }, [])

  const updatePref = useCallback((key, value) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)) } catch {}
      persistToServer(next)
      return next
    })
  }, [persistToServer])

  const tryProPref = useCallback((key, value, locked) => {
    if (locked) {
      clearTimeout(proMsgTimer.current)
      setProMsg(key)
      proMsgTimer.current = setTimeout(() => setProMsg(null), 2800)
      return
    }
    updatePref(key, value)
  }, [updatePref])

  const scrollTo = useCallback((id) => {
    setActiveSection(id)
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const ref = id => el => { sectionRefs.current[id] = el }

  const handleSignOut = () => signOut({ callbackUrl: '/login' })

  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    try {
      const r = await fetch('/api/me', { method: 'DELETE' })
      if (r.ok) signOut({ callbackUrl: '/login' })
    } catch {}
    setDeleteLoading(false)
  }

  // ── Profile ───────────────────────────────────────────────────────
  const putProfile = useCallback((payload) => {
    setProfileStatus('saving')
    return fetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('save failed')))
      .then(data => {
        if (data?.profile) setProfile(data.profile)
        setProfileStatus('saved')
        clearTimeout(profileSaveTimer.current)
        profileSaveTimer.current = setTimeout(() => setProfileStatus(null), 2000)
        return data?.profile
      })
      .catch(() => {
        setProfileStatus('error')
        clearTimeout(profileSaveTimer.current)
        profileSaveTimer.current = setTimeout(() => setProfileStatus(null), 2500)
      })
  }, [])

  const handleProfileSave = useCallback(() => {
    putProfile({
      name: profileForm.name.trim() || null,
      company: profileForm.company.trim() || null,
      phone: profileForm.phone.trim() || null,
    })
  }, [putProfile, profileForm])

  const handleAvatarPick = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { base64, mediaType } = await fileToResizedBase64(file, 512, 0.82)
      await putProfile({ avatar: { mime: mediaType, base64 } })
    } catch {
      setProfileStatus('error')
      clearTimeout(profileSaveTimer.current)
      profileSaveTimer.current = setTimeout(() => setProfileStatus(null), 2500)
    }
  }, [putProfile])

  const handleAvatarClear = useCallback(() => { putProfile({ avatar: null }) }, [putProfile])

  // ── Change password ───────────────────────────────────────────────
  const handleChangePassword = useCallback(async () => {
    setPwError(null)
    if (pw.next.length < 8) { setPwError('New password must be at least 8 characters'); return }
    if (pw.next !== pw.confirm) { setPwError('New passwords do not match'); return }
    setPwStatus('saving')
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setPwStatus(null); setPwError(data?.error || 'Could not change password'); return }
      setPwStatus('saved')
      setPw({ current: '', next: '', confirm: '' })
      setTimeout(() => setPwStatus(null), 2500)
    } catch {
      setPwStatus(null)
      setPwError('Network error')
    }
  }, [pw])

  // ── Support ───────────────────────────────────────────────────────
  const handleSupportSend = useCallback(async () => {
    setSupportError(null)
    if (!support.subject.trim() || !support.message.trim()) {
      setSupportError('Subject and message are required'); return
    }
    setSupportStatus('sending')
    try {
      const r = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: support.subject.trim(),
          message: support.message.trim(),
          appVersion: 'web',
          platform: 'web',
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setSupportStatus('error'); setSupportError(data?.error || 'Could not send'); return }
      setSupportStatus('sent')
      setSupport({ subject: '', message: '' })
      setTimeout(() => setSupportStatus(null), 3000)
    } catch {
      setSupportStatus('error')
      setSupportError('Network error')
    }
  }, [support])

  // ── Data categories ───────────────────────────────────────────────
  const handleClearCategory = useCallback(async (category) => {
    setDataBusy(category)
    try {
      const r = await fetch('/api/me/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      })
      if (r.ok) {
        const counts = await fetch('/api/me/data', { headers: { Accept: 'application/json' } })
          .then(res => res.ok ? res.json() : null).catch(() => null)
        if (counts) setDataCounts(counts)
      }
    } catch {}
    setDataBusy(null)
  }, [])

  const handleExportData = useCallback(async () => {
    try {
      const [profileRes, prefsRes, favRes, histRes, notifRes] = await Promise.all([
        fetch('/api/me/profile', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
        fetch('/api/me/prefs', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
        fetch('/api/favourites', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
        fetch('/api/hs-lookup/history', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
        fetch('/api/me/notifications', { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : null),
      ])
      const bundle = {
        exportedAt: new Date().toISOString(),
        account: { email: me?.email || session?.user?.email || '', plan: me?.plan ?? 'free' },
        profile: profileRes?.profile ?? null,
        preferences: prefsRes?.prefs ?? null,
        favourites: favRes ?? [],
        searchHistory: histRes ?? [],
        notifications: notifRes?.notifications ?? [],
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dutify-data-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {}
  }, [me, session])

  const FREE_LIMIT = 50
  const used = me?.usageThisMonth ?? 0
  const remaining = Math.max(0, FREE_LIMIT - used)
  const usagePct = Math.min(100, Math.round((used / FREE_LIMIT) * 100))
  const lowQuota = remaining <= 5

  const displayName = me?.name || session?.user?.name || 'User'
  const email = me?.email || session?.user?.email || ''
  const initials = (displayName).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className={s.page}>
      <div className={s.stgShell}>

        {/* Left sticky nav */}
        <nav className={s.stgNav}>
          <div className={s.stgNavHead}>Settings</div>
          {STG_SECTIONS.map(sec => (
            <button
              key={sec.id}
              className={`${s.stgNavItem} ${activeSection === sec.id ? s.stgNavItemActive : ''}`}
              onClick={() => scrollTo(sec.id)}
            >
              {sec.label}
            </button>
          ))}
          {saveStatus && (
            <div className={s.stgSaveStatus} style={{
              color: saveStatus === 'saved' ? 'var(--sage-light)' : saveStatus === 'error' ? 'var(--terracotta)' : 'var(--text-muted)',
            }}>
              {saveStatus === 'saving' ? '↑ Saving…' : saveStatus === 'saved' ? '✓ Saved' : '✕ Error'}
            </div>
          )}
          <div className={s.stgNavFooter}>
            <span className={`${s.stgNavPlan} ${me?.plan === 'pro' ? s.stgNavPlanPro : ''}`}>
              {me?.plan === 'pro' ? '★ Pro' : 'Free'}
            </span>
            {email && <div className={s.stgNavPlanEmail}>{email}</div>}
          </div>
        </nav>

        {/* Scrollable content */}
        <div className={s.stgContent}>

          {/* ── Account ── */}
          <section ref={ref('account')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>Account</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Profile</div>
              <div className={s.stgProfileRow}>
                <button
                  type="button"
                  className={s.stgAvatarBtn}
                  onClick={() => avatarFileRef.current?.click()}
                  title="Change profile picture"
                >
                  {profile?.avatar?.dataUrl
                    ? <img src={profile.avatar.dataUrl} alt="" className={s.stgAvatarImg} />
                    : <span className={s.stgAvatar}>{initials}</span>}
                  <span className={s.stgAvatarEditBadge}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </span>
                </button>
                <input ref={avatarFileRef} type="file" accept="image/*" onChange={handleAvatarPick} style={{ display: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={s.stgProfileName}>{displayName}</div>
                  <div className={s.stgProfileEmail}>{email}</div>
                  <span className={`${s.stgPlanBadge} ${me?.plan === 'pro' ? s.stgPlanBadgePro : ''}`}>
                    {me?.plan === 'pro' ? '★ Pro' : 'Free Plan'}
                  </span>
                  {profile?.avatar?.dataUrl && (
                    <button type="button" className={s.stgAvatarRemove} onClick={handleAvatarClear}>Remove photo</button>
                  )}
                </div>
              </div>

              <div className={s.stgFormGrid}>
                <StgField label="Name">
                  <input
                    className={s.stgInput}
                    value={profileForm.name}
                    onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Your name"
                    maxLength={120}
                  />
                </StgField>
                <StgField label="Company">
                  <input
                    className={s.stgInput}
                    value={profileForm.company}
                    onChange={e => setProfileForm(f => ({ ...f, company: e.target.value }))}
                    placeholder="Company (optional)"
                    maxLength={120}
                  />
                </StgField>
                <StgField label="Phone">
                  <input
                    className={s.stgInput}
                    value={profileForm.phone}
                    onChange={e => setProfileForm(f => ({ ...f, phone: e.target.value }))}
                    placeholder="Phone (optional)"
                    maxLength={40}
                  />
                </StgField>
              </div>
              <div className={s.stgFormFoot}>
                {profileStatus === 'saved' && <span className={s.stgFormOk}>✓ Saved</span>}
                {profileStatus === 'error' && <span className={s.stgFormErr}>Could not save</span>}
                <button
                  className={s.stgPrimaryBtn}
                  onClick={handleProfileSave}
                  disabled={profileStatus === 'saving'}
                >
                  {profileStatus === 'saving' ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </div>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Security</div>
              <div className={s.stgFormGrid}>
                <StgField label="Current password">
                  <input
                    className={s.stgInput}
                    type="password"
                    value={pw.current}
                    onChange={e => setPw(p => ({ ...p, current: e.target.value }))}
                    autoComplete="current-password"
                  />
                </StgField>
                <StgField label="New password">
                  <input
                    className={s.stgInput}
                    type="password"
                    value={pw.next}
                    onChange={e => setPw(p => ({ ...p, next: e.target.value }))}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                </StgField>
                <StgField label="Confirm new password">
                  <input
                    className={s.stgInput}
                    type="password"
                    value={pw.confirm}
                    onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
                    autoComplete="new-password"
                  />
                </StgField>
              </div>
              <div className={s.stgFormFoot}>
                {pwError && <span className={s.stgFormErr}>{pwError}</span>}
                {pwStatus === 'saved' && <span className={s.stgFormOk}>✓ Password changed</span>}
                <button
                  className={s.stgPrimaryBtn}
                  onClick={handleChangePassword}
                  disabled={pwStatus === 'saving' || !pw.current || !pw.next}
                >
                  {pwStatus === 'saving' ? 'Updating…' : 'Change password'}
                </button>
              </div>
            </div>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Monthly Usage</div>
              <div className={s.stgUsageRow}>
                <span className={s.stgUsageNum} style={{ color: lowQuota ? 'var(--terracotta)' : undefined }}>
                  {remaining}
                </span>
                <span className={s.stgUsageSuffix}>lookups remaining of {FREE_LIMIT} this month</span>
              </div>
              <div className={s.stgUsageTrack}>
                <div
                  className={s.stgUsageFill}
                  style={{ width: `${usagePct}%`, background: lowQuota ? 'var(--terracotta)' : 'var(--sage)' }}
                />
              </div>
              {me?.plan !== 'pro' && (
                <div className={s.stgUpgradeHint}>Upgrade to Pro for unlimited lookups</div>
              )}
            </div>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Session</div>
              <button className={s.stgActionRow} onClick={handleSignOut}>
                <div>
                  <div className={s.stgActionLabel}>Sign out</div>
                  <div className={s.stgActionSub}>Sign out of Dutify on this device</div>
                </div>
                <span className={s.stgActionArrow}>→</span>
              </button>
            </div>
          </section>

          {/* ── Preferences ── */}
          <section ref={ref('preferences')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>Preferences</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Display</div>
              <StgField label="Currency">
                <StgSelect value={prefs.currency} onChange={v => updatePref('currency', v)}>
                  <option value="EUR">EUR — Euro (€)</option>
                  <option value="USD">USD — US Dollar ($)</option>
                  <option value="GBP">GBP — British Pound (£)</option>
                  <option value="CHF">CHF — Swiss Franc</option>
                  <option value="JPY">JPY — Japanese Yen (¥)</option>
                </StgSelect>
              </StgField>
              <StgField label="Language">
                <StgSelect value={prefs.language} onChange={v => updatePref('language', v)}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Français</option>
                </StgSelect>
              </StgField>
              <StgField label="Date Format">
                <StgSelect value={prefs.dateFormat} onChange={v => updatePref('dateFormat', v)}>
                  <option value="dmy-slash">DD/MM/YYYY — European</option>
                  <option value="dmy-dot">DD.MM.YYYY</option>
                  <option value="mdy">MM/DD/YYYY — US</option>
                  <option value="iso">YYYY-MM-DD — ISO 8601</option>
                </StgSelect>
              </StgField>
              <StgToggleRow
                label="Confidence Scores"
                sub="Show AI confidence percentage on classification results"
                value={prefs.showConfidenceScores}
                onChange={v => updatePref('showConfidenceScores', v)}
              />
            </div>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Calculations</div>
              <StgField label="Default Origin Country">
                <StgSelect value={prefs.defaultOrigin || ''} onChange={v => updatePref('defaultOrigin', v || null)}>
                  <option value="">Not set</option>
                  <option value="CN">China (CN)</option>
                  <option value="US">United States (US)</option>
                  <option value="IN">India (IN)</option>
                  <option value="VN">Vietnam (VN)</option>
                  <option value="GB">United Kingdom (GB)</option>
                  <option value="CH">Switzerland (CH)</option>
                  <option value="JP">Japan (JP)</option>
                  <option value="KR">South Korea (KR)</option>
                  <option value="TR">Turkey (TR)</option>
                  <option value="BD">Bangladesh (BD)</option>
                  <option value="DE">Germany (DE)</option>
                </StgSelect>
              </StgField>
              <StgField label="Units">
                <StgSelect value={prefs.units} onChange={v => updatePref('units', v)}>
                  <option value="metric">Metric (kg, cm, L)</option>
                  <option value="imperial">Imperial (lb, in, gal)</option>
                </StgSelect>
              </StgField>
            </div>
          </section>

          {/* ── AI Settings ── */}
          <section ref={ref('ai')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>AI Settings</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Classification</div>
              <StgField label="AI Model">
                <StgSegmented
                  isPro={me?.plan === 'pro'}
                  value={prefs.aiModel}
                  onChange={(v, locked) => tryProPref('aiModel', v, locked)}
                  options={[
                    { value: 'haiku', label: 'Haiku' },
                    { value: 'sonnet', label: 'Sonnet', pro: true },
                  ]}
                />
                {proMsg === 'aiModel' && (
                  <div className={s.stgProMsg}>★ Pro feature — Sonnet is available on Pro plan</div>
                )}
              </StgField>
              <StgField label={`Confidence Threshold — ${prefs.confidenceThreshold}%`}>
                <input
                  type="range"
                  min={50} max={99} step={5}
                  value={prefs.confidenceThreshold}
                  onChange={e => updatePref('confidenceThreshold', Number(e.target.value))}
                  className={s.stgRange}
                />
                <div className={s.stgRangeLabels}>
                  <span>50% — Permissive</span>
                  <span>99% — Strict</span>
                </div>
              </StgField>
              <StgField label="Explanation Detail">
                <StgSegmented
                  isPro={me?.plan === 'pro'}
                  value={prefs.explanationLevel}
                  onChange={(v, locked) => tryProPref('explanationLevel', v, locked)}
                  options={[
                    { value: 'short',    label: 'Short' },
                    { value: 'medium',   label: 'Medium' },
                    { value: 'detailed', label: 'Detailed', pro: true },
                  ]}
                />
                {proMsg === 'explanationLevel' && (
                  <div className={s.stgProMsg}>★ Pro feature — detailed WCO analysis is available on Pro plan</div>
                )}
              </StgField>
              <StgToggleRow
                label="Auto TARIC Validation"
                sub="Automatically verify classifications against EU TARIC database"
                value={prefs.autoTaricValidation}
                onChange={v => updatePref('autoTaricValidation', v)}
              />
              <StgToggleRow
                label="Reasoning Steps"
                sub="Display AI thinking steps during classification"
                value={prefs.showReasoningSteps}
                onChange={v => updatePref('showReasoningSteps', v)}
              />
            </div>
          </section>

          {/* ── Notifications ── */}
          <section ref={ref('notifications')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>Notifications</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Email</div>
              <StgToggleRow
                label="Email Notifications"
                sub={`Receive updates at ${email || 'your registered address'}`}
                value={prefs.emailNotifications}
                onChange={v => updatePref('emailNotifications', v)}
              />
            </div>

            <div className={s.stgCard} style={{ opacity: 0.65 }}>
              <div className={s.stgCardLabel}>Push</div>
              <div className={s.stgPushNote}>
                Push notifications are available in the Dutify iOS app.
              </div>
            </div>
          </section>

          {/* ── Privacy ── */}
          <section ref={ref('privacy')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>Privacy & Data</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Analytics</div>
              <StgToggleRow
                label="Usage Analytics"
                sub="Share anonymous usage patterns to help improve Dutify"
                value={prefs.dataUsageAnalytics}
                onChange={v => updatePref('dataUsageAnalytics', v)}
              />
            </div>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Your Data</div>
              {DATA_CATEGORIES.map(cat => {
                const count = dataCounts?.[cat.key]
                return (
                  <div key={cat.key} className={s.stgDataRow}>
                    <div className={s.stgDataText}>
                      <div className={s.stgDataLabel}>{cat.label}</div>
                      <div className={s.stgDataCount}>
                        {count == null ? '—' : `${count} ${count === 1 ? cat.unit : cat.unitPlural}`}
                      </div>
                    </div>
                    <button
                      className={s.stgGhostBtn}
                      onClick={() => handleClearCategory(cat.key)}
                      disabled={dataBusy === cat.key || !count}
                    >
                      {dataBusy === cat.key ? 'Clearing…' : 'Clear'}
                    </button>
                  </div>
                )
              })}
              <div className={s.stgFormFoot}>
                <button className={s.stgPrimaryBtn} onClick={handleExportData}>
                  ↓ Export my data (JSON)
                </button>
              </div>
            </div>

            <div className={s.stgCard} style={{ borderColor: 'rgba(196,99,74,0.3)' }}>
              <div className={s.stgCardLabel} style={{ color: 'var(--terracotta)' }}>Danger Zone</div>
              {!deleteConfirm ? (
                <StgToggleRow
                  label="Delete Account"
                  sub="Permanently delete your account and all associated data"
                  value={false}
                  onChange={() => {}}
                  customRight={
                    <button className={s.stgDangerBtn} onClick={() => setDeleteConfirm(true)}>
                      Delete
                    </button>
                  }
                />
              ) : (
                <div className={s.stgDeleteConfirm}>
                  <div className={s.stgDeleteWarning}>
                    This will permanently delete your account, all search history, saved codes, and API tokens. This cannot be undone.
                  </div>
                  <div className={s.stgDeleteActions}>
                    <button className={s.stgCancelBtn} onClick={() => setDeleteConfirm(false)}>Cancel</button>
                    <button
                      className={s.stgConfirmDeleteBtn}
                      onClick={handleDeleteAccount}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? 'Deleting…' : 'Yes, delete my account'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── Support ── */}
          <section ref={ref('support')} className={s.stgSection}>
            <header className={s.stgSectionHead}>
              <h2 className={s.stgSectionTitle}>Support</h2>
              <span className={s.stgSectionAccent} />
            </header>

            <div className={s.stgCard}>
              <div className={s.stgCardLabel}>Contact Us</div>
              <div className={s.stgToggleSub} style={{ marginBottom: 14 }}>
                Send a message to the Dutify team. We reply to {email || 'your registered address'}.
              </div>
              <StgField label="Subject">
                <input
                  className={s.stgInput}
                  value={support.subject}
                  onChange={e => setSupport(v => ({ ...v, subject: e.target.value }))}
                  placeholder="What can we help with?"
                  maxLength={120}
                />
              </StgField>
              <StgField label="Message">
                <textarea
                  className={s.stgTextarea}
                  value={support.message}
                  onChange={e => setSupport(v => ({ ...v, message: e.target.value }))}
                  placeholder="Describe your question or issue…"
                  rows={5}
                  maxLength={4000}
                />
              </StgField>
              <div className={s.stgFormFoot}>
                {supportError && <span className={s.stgFormErr}>{supportError}</span>}
                {supportStatus === 'sent' && <span className={s.stgFormOk}>✓ Message sent</span>}
                <button
                  className={s.stgPrimaryBtn}
                  onClick={handleSupportSend}
                  disabled={supportStatus === 'sending' || !support.subject.trim() || !support.message.trim()}
                >
                  {supportStatus === 'sending' ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </div>
          </section>

        </div>
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

/* ── Notifications page ─────────────────────────────────────────── */
const NOTIF_ICONS = {
  newResults:     '✦',
  lowConfidence:  '△',
  billing:        '◈',
  productUpdates: '◎',
}

const NOTIF_COLORS = {
  newResults:     'var(--sage-light)',
  lowConfidence:  '#FFB74D',
  billing:        'var(--terracotta)',
  productUpdates: '#7EA4D8',
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function NotificationsPage({ onUnreadChange }) {
  const [items, setItems] = useState(null)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    fetch('/api/me/notifications', { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setItems(d.notifications)
          if (d.unread > 0) {
            fetch('/api/me/notifications/read-all', { method: 'POST' })
              .then(() => onUnreadChange?.(0))
          } else {
            onUnreadChange?.(0)
          }
        }
      })
      .catch(() => {})
  }, [])

  async function deleteOne(id) {
    await fetch(`/api/me/notifications/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(n => n.id !== id))
  }

  async function clearAll() {
    setClearing(true)
    await fetch('/api/me/notifications', { method: 'DELETE' })
    setItems([])
    setClearing(false)
  }

  const loading = items === null

  return (
    <div className={s.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 24 }}>
        <h1 className={s.pageTitle} style={{ marginBottom: 0 }}>Notifications</h1>
        {!loading && items.length > 0 && (
          <button
            onClick={clearAll}
            disabled={clearing}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
              letterSpacing: '1.5px', textTransform: 'uppercase',
              color: 'var(--text-muted)', padding: '2px 0',
            }}
          >
            {clearing ? 'Clearing…' : 'Clear all'}
          </button>
        )}
      </div>

      {loading && <div className={s.empty}>Loading…</div>}

      {!loading && items.length === 0 && (
        <div className={s.empty}>No notifications — you're all caught up.</div>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 680 }}>
          {items.map(n => {
            const icon = NOTIF_ICONS[n.category] ?? '◎'
            const color = NOTIF_COLORS[n.category] ?? 'var(--sage-light)'
            return (
              <div key={n.id} style={{
                display: 'flex', gap: 14, alignItems: 'flex-start',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '14px 16px',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 16, color,
                  flexShrink: 0, lineHeight: 1.4, marginTop: 1,
                }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {n.body}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.3px' }}>
                    {timeAgo(n.createdAt)}
                  </span>
                  <button
                    onClick={() => deleteOne(n.id)}
                    title="Dismiss"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 16, lineHeight: 1,
                      padding: '2px 4px', borderRadius: 4,
                    }}
                  >×</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Records page ────────────────────────────────────────────────── */
function chapterHue(hsCode) {
  const ch = parseInt(String(hsCode || '').replace(/\D/g, '').slice(0, 2) || '0', 10)
  if (ch <= 5)  return '#5A8B6A'
  if (ch <= 14) return '#6B8B4A'
  if (ch <= 24) return '#8B7A4A'
  if (ch <= 27) return '#4A5A8B'
  if (ch <= 40) return '#8B5A4A'
  if (ch <= 49) return '#4A7A8B'
  if (ch <= 63) return '#7A4A8B'
  if (ch <= 70) return '#8B6A4A'
  if (ch <= 83) return '#7A7A3A'
  if (ch <= 92) return '#3A7A8B'
  return '#5A6B8B'
}

/* ── Reductions (tariff preferences by origin) ───────────────────── */
const REDUCTION_ORIGINS = [
  { v: 'CN', l: 'China' }, { v: 'US', l: 'United States' }, { v: 'IN', l: 'India' },
  { v: 'VN', l: 'Vietnam' }, { v: 'GB', l: 'United Kingdom' }, { v: 'CH', l: 'Switzerland' },
  { v: 'JP', l: 'Japan' }, { v: 'KR', l: 'South Korea' }, { v: 'TR', l: 'Turkey' },
  { v: 'BD', l: 'Bangladesh' }, { v: 'NO', l: 'Norway' }, { v: 'CA', l: 'Canada' },
  { v: 'MX', l: 'Mexico' }, { v: 'ZA', l: 'South Africa' }, { v: 'BR', l: 'Brazil' },
  { v: 'EG', l: 'Egypt' }, { v: 'MA', l: 'Morocco' }, { v: 'UA', l: 'Ukraine' },
  { v: 'TH', l: 'Thailand' }, { v: 'ID', l: 'Indonesia' }, { v: 'SG', l: 'Singapore' },
]

// Heuristic scheme classification from a zone's acronym / description, used to
// colour the preference badge. Purely cosmetic — the zone data is authoritative.
function reductionScheme(zone) {
  const t = `${zone.acronym || ''} ${zone.description || ''}`.toLowerCase()
  if (/everything but arms|\beba\b/.test(t)) return { label: 'EBA', tone: 'sage' }
  if (/gsp|generalised|generalized|preferences/.test(t)) return { label: 'GSP', tone: 'sage' }
  if (/customs union/.test(t)) return { label: 'Customs Union', tone: 'navy' }
  if (/free trade|fta|economic partnership|\bepa\b|association/.test(t)) return { label: 'FTA', tone: 'navy' }
  if (/pan-euro|\bpem\b|cumulation/.test(t)) return { label: 'PEM', tone: 'navy' }
  return { label: 'Preference', tone: 'muted' }
}

function ReductionsPage({ initialOrigin }) {
  const [origin, setOrigin] = useState(initialOrigin && /^[A-Z]{2}$/.test(initialOrigin) ? initialOrigin : '')
  const [zones, setZones] = useState(null) // null | array | { error: true }
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!origin) { setZones(null); return }
    setLoading(true)
    const ctrl = new AbortController()
    fetch(`/api/trade-agreements?origin=${encodeURIComponent(origin)}`, {
      headers: { Accept: 'application/json' }, signal: ctrl.signal,
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('lookup failed')))
      .then(d => setZones(Array.isArray(d.zones) ? d.zones : []))
      .catch(e => { if (e?.name !== 'AbortError') setZones({ error: true }) })
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [origin])

  const originLabel = REDUCTION_ORIGINS.find(o => o.v === origin)?.l || origin

  return (
    <div className={s.page}>
      <h1 className={s.pageTitle}>Tariff Reductions</h1>
      <p className={s.redIntro}>
        See the EU preferential trade arrangements that cover a country of origin — GSP/EBA, free-trade
        agreements, customs unions and Pan-Euro-Med cumulation. Preferential duty rates require valid
        proof of origin (REX statement, EUR.1, or origin declaration).
      </p>

      <div className={s.redControls}>
        <StgSelect value={origin} onChange={setOrigin}>
          <option value="">Select a country of origin…</option>
          {REDUCTION_ORIGINS.map(o => <option key={o.v} value={o.v}>{o.l} ({o.v})</option>)}
        </StgSelect>
      </div>

      {!origin && (
        <div className={s.empty}>Choose an origin country to list the trade arrangements it belongs to.</div>
      )}
      {origin && loading && <div className={s.empty}>Querying EU TARIC geographical areas…</div>}
      {origin && !loading && zones?.error && (
        <div className={s.errorCard}>Could not load trade arrangements. Try again.</div>
      )}
      {origin && !loading && Array.isArray(zones) && zones.length === 0 && (
        <div className={s.empty}>
          No active EU preferential arrangement found for {originLabel}. Imports are charged the standard
          (MFN / erga omnes) duty rate.
        </div>
      )}
      {origin && !loading && Array.isArray(zones) && zones.length > 0 && (
        <>
          <div className={s.redCount}>
            {zones.length} arrangement{zones.length !== 1 ? 's' : ''} cover {originLabel}
          </div>
          <div className={s.redGrid}>
            {zones.map(z => {
              const scheme = reductionScheme(z)
              return (
                <div key={z.code} className={s.redCard}>
                  <div className={s.redCardHead}>
                    <span className={`${s.badge} ${scheme.tone === 'sage' ? s.badgeSage : scheme.tone === 'navy' ? s.badgeNavy : s.badgeCache}`}>
                      {scheme.label}
                    </span>
                    <span className={s.redCardCode}>{z.acronym || z.code}</span>
                  </div>
                  <div className={s.redCardDesc}>{z.description || z.acronym || z.code}</div>
                </div>
              )
            })}
          </div>
          <a
            className={s.redA2m}
            href={`https://trade.ec.europa.eu/access-to-markets/en/search?product=&origin=${origin}&destination=LU`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Look up exact preferential rates on Access2Markets →
          </a>
        </>
      )}
    </div>
  )
}

// Saved-records order is a client-side preference (the favourites API has no
// order column), mirroring the mobile app's local savedOrder store. We keep an
// array of favourite ids in localStorage and reconcile it against the server
// list on load: known ids first (in saved order), then any new ones by recency.
const SAVED_ORDER_KEY = 'dutify.savedOrder'
function loadSavedOrder() {
  try { const v = JSON.parse(localStorage.getItem(SAVED_ORDER_KEY) || '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
function saveSavedOrder(ids) {
  try { localStorage.setItem(SAVED_ORDER_KEY, JSON.stringify(ids)) } catch {}
}
function applySavedOrder(items, order) {
  if (!order.length) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Infinity
    const rb = rank.has(b.id) ? rank.get(b.id) : Infinity
    return ra - rb // ties (both unranked) keep server order (createdAt desc)
  })
}

function RecordsPage({ onNavigate, onHsFound }) {
  const [tab, setTab] = useState('saved')
  const [savedItems, setSavedItems] = useState(null)
  const [histItems, setHistItems] = useState(null)
  const [modal, setModal] = useState(null) // { hsCode, description, dutyRate, confidencePct, sensitiveGoods? }
  const [clearingHistory, setClearingHistory] = useState(false)
  const [dragId, setDragId] = useState(null)

  useEffect(() => {
    fetch('/api/favourites', { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setSavedItems(applySavedOrder(Array.isArray(data) ? data : [], loadSavedOrder())))
      .catch(() => setSavedItems([]))

    fetch('/api/hs-lookup/history', { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setHistItems(Array.isArray(data) ? data : []))
      .catch(() => setHistItems([]))
  }, [])

  function onDropFav(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    setSavedItems(prev => {
      const arr = [...prev]
      const from = arr.findIndex(f => f.id === dragId)
      const to = arr.findIndex(f => f.id === targetId)
      if (from === -1 || to === -1) return prev
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      saveSavedOrder(arr.map(f => f.id))
      return arr
    })
    setDragId(null)
  }

  async function deleteFav(e, id) {
    e.stopPropagation()
    await fetch('/api/favourites', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSavedItems(prev => prev.filter(f => f.id !== id))
    if (modal?.id === id) setModal(null)
  }

  async function deleteHistItem(id) {
    await fetch(`/api/hs-lookup/history?id=${id}`, { method: 'DELETE' })
    setHistItems(prev => prev.filter(h => h.id !== id))
  }

  async function clearHistory() {
    setClearingHistory(true)
    await fetch('/api/hs-lookup/history', { method: 'DELETE' })
    setHistItems([])
    setClearingHistory(false)
  }

  const savedCount = savedItems?.length ?? 0
  const histCount = histItems?.length ?? 0

  return (
    <div className={s.page}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className={s.pageTitle} style={{ marginBottom: 0 }}>Records</h1>
        {tab === 'history' && histItems?.length > 0 && (
          <button
            onClick={clearHistory}
            disabled={clearingHistory}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
              letterSpacing: '1.5px', textTransform: 'uppercase',
              color: 'var(--text-muted)',
            }}
          >{clearingHistory ? 'Clearing…' : 'Clear all'}</button>
        )}
      </div>

      <div className={s.recTabs}>
        <button
          className={`${s.recTab} ${tab === 'saved' ? s.recTabActive : ''}`}
          onClick={() => setTab('saved')}
        >
          ★ Saved
          {savedCount > 0 && <span className={s.recTabCount}>{savedCount}</span>}
        </button>
        <button
          className={`${s.recTab} ${tab === 'history' ? s.recTabActive : ''}`}
          onClick={() => setTab('history')}
        >
          ⏱ History
          {histCount > 0 && <span className={s.recTabCount}>{histCount}</span>}
        </button>
      </div>

      {tab === 'saved' && (
        <>
          {savedItems === null && <div className={s.empty}>Loading…</div>}
          {savedItems?.length === 0 && (
            <div className={s.empty}>No saved codes yet. Star a result on the Search page to save it here.</div>
          )}
          {savedItems?.length > 0 && (
            <>
              {savedItems.length > 1 && (
                <div className={s.recReorderHint}>Drag tiles to reorder</div>
              )}
              <div className={s.recGrid}>
                {savedItems.map(fav => {
                  const code = formatCn(fav.hsCode)
                  const isSensitive = !!fav.sensitiveGoods
                  return (
                    <div
                      key={fav.id}
                      draggable
                      onDragStart={(e) => { setDragId(fav.id); e.dataTransfer.effectAllowed = 'move' }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                      onDrop={(e) => { e.preventDefault(); onDropFav(fav.id) }}
                      onDragEnd={() => setDragId(null)}
                      className={`${s.recTile} ${isSensitive ? s.recTileSensitive : ''} ${dragId === fav.id ? s.recTileDragging : ''}`}
                      onClick={() => setModal({ hsCode: fav.hsCode, description: fav.description, dutyRate: fav.dutyRate, confidencePct: fav.confidencePct, sensitiveGoods: fav.sensitiveGoods })}
                    >
                      <button
                        className={s.recTileDel}
                        onClick={(e) => deleteFav(e, fav.id)}
                        title="Remove"
                        aria-label="Remove"
                      >×</button>
                      <div className={s.recTileHs}>{code}</div>
                      <div className={s.recTileDesc}>{fav.description}</div>
                      <div className={s.recTileFooter}>
                        {fav.dutyRate != null && (
                          <span className={`${s.badge} ${fav.dutyRate === 0 ? s.badgeSage : s.badgeNavy}`}>
                            {fav.dutyRate === 0 ? 'Free' : `${fav.dutyRate}%`}
                          </span>
                        )}
                        {fav.confidencePct != null && (
                          <span className={s.badge} style={{
                            background: fav.confidencePct >= 85 ? 'rgba(76,175,80,0.12)' : fav.confidencePct >= 65 ? 'rgba(255,183,77,0.12)' : 'rgba(239,83,80,0.12)',
                            border: `1px solid ${fav.confidencePct >= 85 ? 'rgba(76,175,80,0.3)' : fav.confidencePct >= 65 ? 'rgba(255,183,77,0.3)' : 'rgba(239,83,80,0.3)'}`,
                            color: fav.confidencePct >= 85 ? '#81C784' : fav.confidencePct >= 65 ? '#FFB74D' : '#EF9A9A',
                          }}>
                            {fav.confidencePct}%
                          </span>
                        )}
                        {isSensitive && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--terracotta)' }}>
                            ⚠ {fav.sensitiveGoods.category}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {tab === 'history' && (
        <>
          {histItems === null && <div className={s.empty}>Loading…</div>}
          {histItems?.length === 0 && (
            <div className={s.empty}>No searches yet. Classify a product on the Search page to build history.</div>
          )}
          {histItems?.length > 0 && (
            <div className={s.recGrid}>
              {histItems.map(item => {
                const color = chapterHue(item.hs6 || item.cn8)
                const code = formatHs(item.hs6, item.cn8)
                return (
                  <div
                    key={item.id}
                    className={s.recTile}
                    style={{ borderLeft: `3px solid ${color}66` }}
                    onClick={() => setModal({ hsCode: item.cn8 || item.hs6, description: item.description, dutyRate: item.dutyRate, confidencePct: item.confidencePct })}
                  >
                    <button
                      className={s.recTileDel}
                      onClick={(e) => { e.stopPropagation(); deleteHistItem(item.id) }}
                      title="Remove"
                      aria-label="Remove"
                    >×</button>
                    <div className={s.recTileHs}>{code}</div>
                    <div className={s.recTileDesc}>{item.description}</div>
                    <div className={s.recTileFooter}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', flex: 1 }}>
                        {timeAgo(item.createdAt)}
                      </span>
                      {item.dutyRate != null && (
                        <span className={`${s.badge} ${item.dutyRate === 0 ? s.badgeSage : s.badgeNavy}`}>
                          {item.dutyRate === 0 ? 'Free' : `${item.dutyRate}%`}
                        </span>
                      )}
                      <span className={`${s.badge} ${item.fromCache ? s.badgeCache : s.badgeSage}`}>
                        {item.fromCache ? 'Cached' : 'Live'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Calculator overlay */}
      {modal && (
        <div className={s.recOverlay} onClick={() => setModal(null)}>
          <div className={s.recOverlayCard} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
              <div className={s.recOverlayHs}>{formatCn(modal.hsCode)}</div>
              <button
                onClick={() => setModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: '2px 4px', marginTop: 2, flexShrink: 0 }}
              >×</button>
            </div>
            <div className={s.recOverlayDesc}>{modal.description}</div>

            <div className={s.recOverlayBadges}>
              {modal.dutyRate != null && (
                <span className={`${s.badge} ${modal.dutyRate === 0 ? s.badgeSage : s.badgeNavy}`}>
                  {modal.dutyRate === 0 ? 'Free' : `${modal.dutyRate}%`}
                </span>
              )}
              {modal.confidencePct != null && (
                <span className={s.badge} style={{
                  background: modal.confidencePct >= 85 ? 'rgba(76,175,80,0.12)' : modal.confidencePct >= 65 ? 'rgba(255,183,77,0.12)' : 'rgba(239,83,80,0.12)',
                  border: `1px solid ${modal.confidencePct >= 85 ? 'rgba(76,175,80,0.3)' : modal.confidencePct >= 65 ? 'rgba(255,183,77,0.3)' : 'rgba(239,83,80,0.3)'}`,
                  color: modal.confidencePct >= 85 ? '#81C784' : modal.confidencePct >= 65 ? '#FFB74D' : '#EF9A9A',
                }}>
                  {modal.confidencePct}% confidence
                </span>
              )}
            </div>

            {modal.sensitiveGoods && (
              <div className={s.recOverlaySensitive}>
                <strong style={{ color: 'var(--terracotta)' }}>⚠ {modal.sensitiveGoods.category}</strong>
                {' — '}{modal.sensitiveGoods.warning}
              </div>
            )}

            <div className={s.recOverlayActions}>
              <button
                className={s.recOverlayUse}
                onClick={() => { onHsFound?.(modal.hsCode); onNavigate?.('calculator'); setModal(null) }}
              >
                Use in Calculator →
              </button>
              <button className={s.recOverlayDismiss} onClick={() => setModal(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Root Dashboard ──────────────────────────────────────────────── */
export default function Dashboard() {
  const { data: session } = useSession()
  const [page, setPage] = useState('search')
  const [calcHs, setCalcHs] = useState('')
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetch('/api/me/notifications', { headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.unread != null) setUnread(d.unread) })
      .catch(() => {})
  }, [])

  const handleHsFound = useCallback(hs => {
    setCalcHs(hs)
  }, [])

  const renderPage = () => {
    switch (page) {
      case 'search':      return <SearchPage onNavigate={setPage} onHsFound={handleHsFound} />
      case 'records':     return <RecordsPage onNavigate={setPage} onHsFound={setCalcHs} />
      case 'calculator':  return <CalcWizard initialHs={calcHs} onHsFound={setCalcHs} />
      case 'settings':    return <SettingsPage />
      case 'reductions':  return <ReductionsPage />
      case 'goods':       return <GoodsIndexPage />
      case 'rulings':     return <RulingsPage prefillHs={calcHs} onNavigate={setPage} />
      case 'notifications': return <NotificationsPage onUnreadChange={setUnread} />
      default:            return null
    }
  }

  return (
    <div className={s.shell}>
      <Sidebar current={page} onNav={setPage} user={session?.user} unread={unread} />
      <main className={s.main}>
        <Topbar page={page} user={session?.user} calcHs={calcHs} unread={unread} onBell={() => setPage('notifications')} />
        <div className={`${s.content} ${page === 'search' ? s.contentNoScroll : ''}`}>
          {renderPage()}
        </div>
      </main>
    </div>
  )
}
