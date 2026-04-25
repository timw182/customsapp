'use client'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import s from './CalcWizard.module.css'

/* ── tiny SVG helpers ──────────────────────────────────────────────── */
const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const Lock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" ry="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const Search = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
  </svg>
)
const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
)
const Bolt = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)
const Globe = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

/* ── config ────────────────────────────────────────────────────────── */
const STEPS = [
  { id: 1, label: 'HS Code Lookup',        sub: 'Classify' },
  { id: 2, label: 'Landed Cost Calculator', sub: 'Origin · VAT' },
  { id: 3, label: 'Shipping Details',       sub: 'Freight · Incoterms' },
  { id: 4, label: 'Summary & Export',       sub: 'Soon' },
]

const ORIGINS = [
  { v: 'CN', l: 'China (CN)' },
  { v: 'VN', l: 'Vietnam (VN)' },
  { v: 'IN', l: 'India (IN)' },
  { v: 'US', l: 'United States (US)' },
  { v: 'BD', l: 'Bangladesh (BD)' },
  { v: 'TR', l: 'Turkey (TR)' },
  { v: 'UK', l: 'United Kingdom (UK)' },
  { v: 'JP', l: 'Japan (JP)' },
]

// Benelux first (primary market), then the rest of EU27 alphabetical.
// VAT shown is the standard rate at first render — the live value comes
// from /api/vat-lookup once the destination is confirmed.
const DESTINATIONS = [
  // ── Benelux ──
  { v: 'LU', l: 'Luxembourg (LU)',  vat: 17,   currency: 'EUR', group: 'Benelux' },
  { v: 'BE', l: 'Belgium (BE)',     vat: 21,   currency: 'EUR', group: 'Benelux' },
  { v: 'NL', l: 'Netherlands (NL)', vat: 21,   currency: 'EUR', group: 'Benelux' },
  // ── Rest of EU27 ──
  { v: 'AT', l: 'Austria (AT)',     vat: 20,   currency: 'EUR', group: 'EU27' },
  { v: 'BG', l: 'Bulgaria (BG)',    vat: 20,   currency: 'EUR', group: 'EU27' },
  { v: 'HR', l: 'Croatia (HR)',     vat: 25,   currency: 'EUR', group: 'EU27' },
  { v: 'CY', l: 'Cyprus (CY)',      vat: 19,   currency: 'EUR', group: 'EU27' },
  { v: 'CZ', l: 'Czechia (CZ)',     vat: 21,   currency: 'EUR', group: 'EU27' },
  { v: 'DK', l: 'Denmark (DK)',     vat: 25,   currency: 'EUR', group: 'EU27' },
  { v: 'EE', l: 'Estonia (EE)',     vat: 22,   currency: 'EUR', group: 'EU27' },
  { v: 'FI', l: 'Finland (FI)',     vat: 25.5, currency: 'EUR', group: 'EU27' },
  { v: 'FR', l: 'France (FR)',      vat: 20,   currency: 'EUR', group: 'EU27' },
  { v: 'DE', l: 'Germany (DE)',     vat: 19,   currency: 'EUR', group: 'EU27' },
  { v: 'GR', l: 'Greece (GR)',      vat: 24,   currency: 'EUR', group: 'EU27' },
  { v: 'HU', l: 'Hungary (HU)',     vat: 27,   currency: 'EUR', group: 'EU27' },
  { v: 'IE', l: 'Ireland (IE)',     vat: 23,   currency: 'EUR', group: 'EU27' },
  { v: 'IT', l: 'Italy (IT)',       vat: 22,   currency: 'EUR', group: 'EU27' },
  { v: 'LV', l: 'Latvia (LV)',      vat: 21,   currency: 'EUR', group: 'EU27' },
  { v: 'LT', l: 'Lithuania (LT)',   vat: 21,   currency: 'EUR', group: 'EU27' },
  { v: 'MT', l: 'Malta (MT)',       vat: 18,   currency: 'EUR', group: 'EU27' },
  { v: 'PL', l: 'Poland (PL)',      vat: 23,   currency: 'EUR', group: 'EU27' },
  { v: 'PT', l: 'Portugal (PT)',    vat: 23,   currency: 'EUR', group: 'EU27' },
  { v: 'RO', l: 'Romania (RO)',     vat: 19,   currency: 'EUR', group: 'EU27' },
  { v: 'SK', l: 'Slovakia (SK)',    vat: 23,   currency: 'EUR', group: 'EU27' },
  { v: 'SI', l: 'Slovenia (SI)',    vat: 22,   currency: 'EUR', group: 'EU27' },
  { v: 'ES', l: 'Spain (ES)',       vat: 21,   currency: 'EUR', group: 'EU27' },
  { v: 'SE', l: 'Sweden (SE)',      vat: 25,   currency: 'EUR', group: 'EU27' },
]

// Incoterms 2020 grouped by what's expected to be in the unit price
// when sold under that term. Drives the "what to enter" hints in Step 3
// and the customs-value derivation in computed().
//   freightToBorder  — true if the price already covers transport TO the EU border
//   insurance        — true if the price already covers insurance to destination
//   sellerHandlesImport — true if the seller pays the duties (DDP only)
const INCOTERM_PROFILES = {
  EXW: { freightToBorder: false, insurance: false, sellerHandlesImport: false, label: 'Ex Works',                   note: "Buyer collects from seller's premises. You pay everything." },
  FCA: { freightToBorder: false, insurance: false, sellerHandlesImport: false, label: 'Free Carrier',               note: "Seller delivers to a named carrier in the country of origin." },
  FAS: { freightToBorder: false, insurance: false, sellerHandlesImport: false, label: 'Free Alongside Ship',         note: "Seller delivers alongside the vessel at the named port." },
  FOB: { freightToBorder: false, insurance: false, sellerHandlesImport: false, label: 'Free on Board',               note: "Seller loads onto the vessel; main carriage is on you." },
  CFR: { freightToBorder: true,  insurance: false, sellerHandlesImport: false, label: 'Cost and Freight',            note: "Price covers freight to destination port; insurance is on you." },
  CIF: { freightToBorder: true,  insurance: true,  sellerHandlesImport: false, label: 'Cost, Insurance and Freight', note: "Price covers freight + minimum insurance to destination port." },
  CPT: { freightToBorder: true,  insurance: false, sellerHandlesImport: false, label: 'Carriage Paid To',            note: "Multimodal CFR — freight to named place; insurance on you." },
  CIP: { freightToBorder: true,  insurance: true,  sellerHandlesImport: false, label: 'Carriage and Insurance Paid', note: "Multimodal CIF — freight + insurance to named place." },
  DAP: { freightToBorder: true,  insurance: true,  sellerHandlesImport: false, label: 'Delivered at Place',          note: "Seller delivers to the named place; you clear customs." },
  DPU: { freightToBorder: true,  insurance: true,  sellerHandlesImport: false, label: 'Delivered at Place Unloaded', note: "Seller delivers AND unloads; you clear customs." },
  DDP: { freightToBorder: true,  insurance: true,  sellerHandlesImport: true,  label: 'Delivered Duty Paid',         note: "Seller pays everything including duty + VAT. Subtract those for customs value." },
}
const INCOTERMS = Object.keys(INCOTERM_PROFILES)

/* ── formatting ────────────────────────────────────────────────────── */
function formatCn(code) {
  if (!code) return ''
  const d = String(code).replace(/\D/g, '')
  if (d.length >= 10) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}.${d.slice(8,10)}`
  if (d.length >= 8)  return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`
  if (d.length >= 6)  return `${d.slice(0,4)}.${d.slice(4,6)}`
  return d
}
function money(v, currency = 'EUR') {
  if (!Number.isFinite(v) || v === 0) return currency === 'EUR' ? '€ —' : '$ —'
  const sym = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'
  return `${sym} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* ── preferential-zone filter ──────────────────────────────────────
   TARIC's geo-areas table mixes preferential schemes (GSP, EFTA, EPA…)
   with control zones (phytosanitary, surveillance, safeguards). We only
   want the preference-bearing ones for the origin hint. Bilateral FTAs
   (EU-Japan EPA, EU-UK TCA, EU-Korea, EU-CETA) are encoded as
   regulations on individual measures, not as country-group zones, so
   they won't appear here — surface them via /api/taric-rates instead. */
function isPreferentialZone(z) {
  const a = (z.acronym || '').toUpperCase()
  const d = (z.description || '').toUpperCase()
  if (/\b(GSP|GSP\+|EFTA|EEA|EPA|CARI|CARIFORUM|SADC|PANEU|PEM)\b/.test(a)) return true
  if (/(PREFERENTIAL|FREE TRADE|PARTNERSHIP AGREEMENT|CUSTOMS UNION|STABILISATION AND ASSOCIATION|PAN-EURO|MERCOSUR|EUR-MED|ASSOCIATION AGREEMENT|TRADE AND COOPERATION)/.test(d)) return true
  return false
}
function zoneShortName(z) {
  // Prefer the acronym (GSP, EFTA…) but fall back to a trimmed description
  // for the bilateral / one-off preferences that have no useful acronym.
  const a = (z.acronym || '').trim()
  if (a && a.length <= 12 && !/^\d+$/.test(a)) return a
  return (z.description || z.code).split(/[—-]|in accordance with/)[0].trim().slice(0, 36)
}

/* ── thinking → pct mapping (mirrors dashboard SearchPage) ────────── */
function thinkingToProgress(t) {
  if (!t) return null
  if (t.startsWith('Checking cache')) return 5
  if (t.startsWith('Cache hit')) return 90
  if (t.startsWith('Cache miss')) return 12
  if (t.startsWith('Haiku: fast')) return 22
  if (t.startsWith('Haiku →')) return 46
  if (t.startsWith('Sonnet:')) return 38
  if (t.startsWith('Sonnet →')) return 58
  if (t.startsWith('Probing TARIC')) return 70
  if (t.startsWith('TARIC:')) return 82
  if (t.startsWith('Exact match') || t.startsWith('Best match')) return 92
  if (t.startsWith('MFN duty')) return 95
  return null
}

/* ════════════════════════════════════════════════════════════════════
   STEPPER TIMELINE
   ════════════════════════════════════════════════════════════════════ */
function Timeline({ current, completed, onJump }) {
  return (
    <div className={s.stepper}>
      {STEPS.map((st) => {
        const isDone = completed.has(st.id)
        const isActive = current === st.id
        const isLocked = !isDone && !isActive
        const prevDone = completed.has(st.id - 1) || st.id === 1
        const nextDone = completed.has(st.id)
        const cellClasses = [
          s.stepCell,
          prevDone ? s.stepCellDoneBefore : '',
          nextDone ? s.stepCellDoneAfter : '',
        ].join(' ')
        const nodeClasses = [
          s.stepNode,
          isDone ? s.stepNodeDone : '',
          isActive ? s.stepNodeActive : '',
          isLocked ? s.stepNodeLocked : '',
        ].join(' ')
        return (
          <div key={st.id} className={cellClasses}>
            <button
              type="button"
              className={nodeClasses}
              disabled={isLocked}
              onClick={() => { if (isDone) onJump(st.id) }}
              aria-label={`Step ${st.id}: ${st.label}${isDone ? ' (completed)' : isActive ? ' (current)' : ' (locked)'}`}
              title={isDone ? 'Go back to this step' : isActive ? 'Current step' : 'Complete prior steps first'}
            >
              {isDone ? <Check /> : isLocked ? <Lock /> : st.id}
            </button>
            <span className={`${s.stepLabel} ${isActive ? s.stepLabelActive : ''} ${isDone ? s.stepLabelDone : ''}`}>
              {st.label}
              <span className={s.stepSub}>{st.sub}</span>
              {isActive && <span className={s.stepLabelUnderline} />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   STEP 1 — HS LOOKUP (AI + manual)
   ════════════════════════════════════════════════════════════════════ */
function buildEbtiUrl(hs) {
  const digits = String(hs || '').replace(/\D/g, '').slice(0, 10)
  const params = new URLSearchParams({ Lang: 'en', nomenc: 'CN', Expand: 'true' })
  if (digits) params.set('Taric', digits)
  return `https://ec.europa.eu/taxation_customs/dds2/ebti/ebti_consultation.jsp?${params.toString()}`
}
function buildSaturnUrl(hs) {
  const digits = String(hs || '').replace(/\D/g, '')
  if (!digits) return 'https://saturn.etat.lu/ite-tariff-public/#/taric/nomenclature/sbn'
  return `https://saturn.etat.lu/ite-tariff-public/#/taric/nomenclature/sbn?code=${digits}`
}

function Step1HsLookup({ state, setState, onComplete }) {
  const [query, setQuery] = useState(state.query || '')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [thinking, setThinking] = useState([])
  const [error, setError] = useState(null)
  const [manual, setManual] = useState('')
  const [saved, setSaved] = useState(false)
  const [savedErr, setSavedErr] = useState(null)
  const abortRef = useRef(null)
  const result = state.hsResult

  const advance = useCallback((pct) => setProgress(p => (pct > p ? pct : p)), [])

  const runClassify = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    setThinking([])
    setProgress(0)
    setState(v => ({ ...v, hsResult: null, query: q }))

    try {
      const res = await fetch('/api/hs-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ type: 'classify', description: q }),
        signal: ctrl.signal,
      })
      const ct = res.headers.get('content-type') || ''

      if (!ct.includes('text/event-stream')) {
        const data = await res.json().catch(() => null)
        if (!data || data.error) { setError(data?.error || 'Classification failed'); return }
        setState(v => ({ ...v, hsResult: data }))
        advance(100)
        return
      }

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, i).trim()
          buf = buf.slice(i + 2)
          if (!chunk.startsWith('data:')) continue
          const payload = chunk.slice(5).trim()
          let ev; try { ev = JSON.parse(payload) } catch { continue }
          if (ev.type === 'thinking' && ev.text) {
            setThinking(p => [...p, ev.text])
            const pct = thinkingToProgress(ev.text)
            if (pct != null) advance(pct)
          } else if (ev.type === 'result') {
            setState(v => ({ ...v, hsResult: ev.payload }))
            advance(100)
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
  }, [query, advance, setState])

  const handleManualUse = async () => {
    const digits = manual.replace(/\D/g, '').slice(0, 10)
    if (digits.length < 6) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/taric-describe?code=${digits}`, {
        headers: { Accept: 'application/json' },
      })
      const ct = res.headers.get('content-type') || ''
      const data = ct.includes('application/json') ? await res.json() : null
      if (!res.ok || !data || data.error) {
        const fallback = res.status === 502
          ? 'EU TARIC service is currently unreachable. Please retry in a moment.'
          : res.status === 404
            ? 'No TARIC entry found for this code. Check the digits and try again.'
            : `TARIC returned ${res.status}. Please retry.`
        setError(data?.error || fallback)
        return
      }
      const en = Array.isArray(data.en) ? data.en : []
      const fr = Array.isArray(data.fr) ? data.fr : []
      const leafEn = en[en.length - 1] || ''
      if (!leafEn && fr.length === 0) {
        setError('This code exists but returned no description. Please verify.')
        return
      }
      setState(v => ({
        ...v,
        hsResult: {
          hs6: digits.slice(0, 6),
          cn8: digits.length >= 8 ? digits.slice(0, 8) : null,
          cn10: digits.length >= 10 ? digits.slice(0, 10) : null,
          description: leafEn || fr[fr.length - 1] || '',
          taricDescriptions: { en, fr },
          taricVerified: true,
          standardDutyRate: null,
          manual: false,
        },
        query: manual,
      }))
    } catch (e) {
      setError('TARIC service unreachable. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => () => abortRef.current?.abort(), [])

  const canConfirm = !!result && !!(result.cn10 || result.cn8 || result.hs6)
  const primaryCode = result?.cn10 || result?.cn8 || result?.hs6 || ''

  const clearResult = () => {
    setState(v => ({ ...v, hsResult: null }))
    setThinking([])
    setProgress(0)
    setError(null)
    setSaved(false)
    setSavedErr(null)
  }

  const handleSaveFavourite = async () => {
    if (!result || saved) return
    const hsCode = result.cn8 || result.hs6
    if (!hsCode) return
    setSavedErr(null)
    try {
      const res = await fetch('/api/favourites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          hsCode,
          description: state.query?.trim() || result.description || '',
          dutyRate: typeof result.standardDutyRate === 'number' ? result.standardDutyRate : undefined,
          reasoning: result.rationale || undefined,
          confidencePct: result.confidencePct ?? undefined,
          sensitiveGoods: result.sensitiveGoods || null,
        }),
      })
      if (res.ok) setSaved(true)
      else setSavedErr('Could not save')
    } catch { setSavedErr('Network error') }
  }

  return (
    <div>
      <div className={s.panelHead}>
        <div>
          <p className={s.panelEyebrow}>Step 1 · Classification</p>
          <h2 className={s.panelTitle}>HS Code Lookup</h2>
        </div>
      </div>

      <div className={s.lookupCol}>
        {/* Result first once we have one — inputs collapse away */}
        {result && canConfirm && (
          <div className={s.hsResult}>
            <div className={s.hsResultTop}>
              <div>
                <div className={s.hsResultCode}>{formatCn(primaryCode)}</div>
                <div className={s.hsResultDesc}>{result.description || state.query}</div>
              </div>
              {result.confidencePct != null && (
                <span className={s.hsResultConf}>{result.confidencePct}% match</span>
              )}
            </div>
            <div className={s.hsResultMeta}>
              <div className={s.hsResultMetaItem}>
                <span className={s.hsResultMetaLbl}>MFN Duty</span>
                <span className={s.hsResultMetaVal}>
                  {result.standardDutyRate === 0 ? 'Free' : result.standardDutyRate != null ? `${result.standardDutyRate}%` : '—'}
                </span>
              </div>
              <div className={s.hsResultMetaItem}>
                <span className={s.hsResultMetaLbl}>TARIC</span>
                <span className={s.hsResultMetaVal}>
                  {result.taricVerified === true ? '✓ Verified' : '—'}
                </span>
              </div>
              <div className={s.hsResultMetaItem}>
                <span className={s.hsResultMetaLbl}>Source</span>
                <span className={s.hsResultMetaVal}>
                  {result.fromCache ? 'Cached' : result.taricVerified ? 'EU TARIC' : result.manual ? 'Manual' : 'AI + TARIC'}
                </span>
              </div>
            </div>

            {/* TARIC hierarchy pyramid */}
            {result.taricDescriptions && (result.taricDescriptions.en?.length > 0 || result.taricDescriptions.fr?.length > 0) && (
              <div className={s.taricPyramid}>
                <div className={s.taricPyramidLabel}>TARIC nomenclature hierarchy</div>
                <div className={s.taricPyramidGrid}>
                  {['en', 'fr'].map(lang => (
                    result.taricDescriptions[lang]?.length > 0 && (
                      <div key={lang} className={s.taricPyramidCol}>
                        <div className={s.taricPyramidLang}>{lang.toUpperCase()}</div>
                        {result.taricDescriptions[lang].map((p, i, arr) => (
                          <div key={i} className={s.taricPyramidRow} style={{ paddingLeft: `${i * 12}px` }}>
                            <span className={s.taricPyramidGlyph}>{i === arr.length - 1 ? '●' : '▸'}</span>
                            <span className={i === arr.length - 1 ? s.taricPyramidLeaf : s.taricPyramidBranch}>{p}</span>
                          </div>
                        ))}
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            <div className={s.hsActions}>
              <button className={s.hsActionPrimary} onClick={onComplete}>
                Use in calculator <ArrowRight />
              </button>
              <button
                className={`${s.hsActionGhost} ${saved ? s.hsActionSaved : ''}`}
                onClick={handleSaveFavourite}
                disabled={saved}
                title={savedErr || ''}
              >
                {saved ? '✓ Saved' : '☆ Save to favourites'}
              </button>
              <a
                className={s.hsActionGhost}
                href={buildEbtiUrl(result.cn8 || result.hs6)}
                target="_blank" rel="noreferrer"
              >
                View BTIs ↗
              </a>
              <a
                className={s.hsActionGhost}
                href={result.saturnUrl || buildSaturnUrl(result.cn8 || result.hs6)}
                target="_blank" rel="noreferrer"
              >
                Saturn ↗
              </a>
              <button className={s.hsReclassify} onClick={clearResult}>
                ↻ Classify another
              </button>
            </div>
          </div>
        )}

        {/* Manual HS code entry — only when no result */}
        {!(result && canConfirm) && (
          <div className={s.field}>
            <label className={s.fieldLabel}>HS / CN code</label>
            <div className={s.hsHero} style={{ gap: 10 }}>
              <div className={s.hsInputWrap}>
                <input
                  className={s.hsInput}
                  value={manual}
                  onChange={e => setManual(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && manual.replace(/\D/g, '').length >= 6) handleManualUse() }}
                  placeholder="e.g. 8518 or 8518.30.95"
                  inputMode="numeric"
                  style={{ paddingLeft: 14 }}
                  autoFocus
                />
              </div>
              <button
                className={s.hsGo}
                onClick={handleManualUse}
                disabled={loading || manual.replace(/\D/g, '').length < 6}
              >
                {loading ? (
                  <><span className={s.vatAiSpinner} style={{ borderColor: 'rgba(14,18,24,0.3)', borderTopColor: '#0E1218' }} /> Checking TARIC…</>
                ) : (
                  <>Check against TARIC <ArrowRight /></>
                )}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Need to classify by description? Use the <strong style={{color:'var(--text-secondary)'}}>Search</strong> tab — results are auto-passed here.
            </p>
          </div>
        )}

        {error && (
          <div className={s.hsError} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>⚠ {error}</span>
            <button
              type="button"
              onClick={handleManualUse}
              disabled={loading || manual.replace(/\D/g, '').length < 6}
              style={{
                background: 'var(--terracotta)', color: '#fff', border: 'none',
                padding: '7px 14px', borderRadius: 'var(--radius-md)',
                fontWeight: 700, fontSize: 12.5, cursor: 'pointer', letterSpacing: '.02em',
              }}
            >
              Retry TARIC
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   STEP 2 — ORIGIN / DEST / VAT (with confirm modal)
   ════════════════════════════════════════════════════════════════════ */
function Step2LandedCost({ state, setState, originZones = [], onComplete, onBack }) {
  const [vatLoading, setVatLoading] = useState(false)
  const [vatLookup, setVatLookup] = useState(null)
  const [vatError, setVatError] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const dest = useMemo(() => DESTINATIONS.find(d => d.v === state.dest) || DESTINATIONS[0], [state.dest])
  const hsForVat = state.hsResult?.cn10 || state.hsResult?.cn8 || state.hsResult?.hs6 || ''

  // Real VAT lookup against the EU TEDB snapshot. Re-runs when destination
  // or HS code changes — the HS chapter may flip the suggestion from
  // standard to a reduced-rate candidate.
  useEffect(() => {
    if (!dest) return
    let cancelled = false
    setVatLoading(true)
    setVatError(null)
    const params = new URLSearchParams({ dest: dest.v })
    if (hsForVat) params.set('hs', hsForVat)
    fetch(`/api/vat-lookup?${params.toString()}`)
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return
        if (!ok || data.error) {
          setVatError(data.error || 'VAT lookup failed')
          setVatLoading(false)
          return
        }
        setVatLookup(data)
        // Reset confirmation when the suggestion changes; carry the new
        // suggested rate into state so the LiveResults sidebar can preview.
        setState(v => ({ ...v, suggestedVat: data.suggested, vatConfirmed: false }))
        setVatLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setVatError('Could not reach VAT lookup service.')
        setVatLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.dest, hsForVat])

  const set = (k, v) => setState(s => ({ ...s, [k]: v }))

  return (
    <div>
      <div className={s.panelHead}>
        <div>
          <p className={s.panelEyebrow}>Step 2 · Landed Cost</p>
          <h2 className={s.panelTitle}>Origin, Destination &amp; Taxes</h2>
        </div>
      </div>

      {/* Classification summary */}
      {state.hsResult && (
        <div className={s.classCard}>
          <div className={s.classCardLabel}>Selected classification</div>
          <div className={s.classCardCode}>
            {formatCn(state.hsResult.cn10 || state.hsResult.cn8 || state.hsResult.hs6)}
          </div>
          <div className={s.classCardDesc}>
            {state.hsResult.description || state.query}
          </div>
        </div>
      )}

      <div className={s.group}>
        <h3 className={s.groupTitle}>Origin &amp; Destination</h3>
        <div className={s.rowTwo}>
          <div className={s.field}>
            <span className={s.fieldLabel}>Origin country</span>
            <select className={s.select} value={state.origin} onChange={e => set('origin', e.target.value)}>
              {ORIGINS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <OriginPreferenceHint origin={state.origin} zones={originZones} />
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Destination</span>
            <select className={s.select} value={state.dest} onChange={e => set('dest', e.target.value)}>
              {DESTINATIONS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className={s.vatBlock}>
        <div className={s.vatAiRow}>
          <span className={s.vatAiBadge}>
            {vatLoading && <span className={s.vatAiSpinner} />}
            <Bolt /> EU TEDB · VAT lookup
          </span>
          <span>
            {vatLoading
              ? `Looking up VAT rates for ${dest.l}…`
              : vatError
                ? vatError
                : state.vatConfirmed
                  ? `VAT ${state.vat}% confirmed for ${dest.l}.`
                  : vatLookup?.reducedCandidate != null && vatLookup.hint?.strength === 'likely'
                    ? `${dest.l}: standard ${vatLookup.standard}% — but this HS chapter typically qualifies for the reduced rate (${vatLookup.reducedCandidate}%). Confirm to choose.`
                    : `${dest.l}: standard ${vatLookup?.standard ?? dest.vat}% applies — please confirm.`}
          </span>
        </div>
        <button
          type="button"
          className={`${s.vatBtn} ${state.vatConfirmed ? s.vatBtnConfirmed : ''}`}
          onClick={() => setShowConfirm(true)}
          disabled={vatLoading || !vatLookup}
        >
          {state.vatConfirmed ? (
            <>
              <span className={s.vatCheck}><Check /></span>
              VAT {state.vat}% confirmed — {dest.l}
            </>
          ) : (
            <>Confirm VAT Rate {(vatLookup?.suggested ?? dest.vat)}% — {dest.l}</>
          )}
        </button>
      </div>

      <div className={s.stepNav}>
        <button className={s.backBtn} onClick={onBack}>← Back</button>
        <button
          className={s.nextBtn}
          onClick={onComplete}
          disabled={!state.vatConfirmed}
        >
          Continue <ArrowRight />
        </button>
      </div>

      {showConfirm && vatLookup && (
        <VatConfirmModal
          lookup={vatLookup}
          dest={dest}
          onCancel={() => setShowConfirm(false)}
          onConfirm={(rate) => {
            setState(v => ({ ...v, vat: rate, vatConfirmed: true }))
            setShowConfirm(false)
          }}
        />
      )}
    </div>
  )
}

/* ── Origin preference chips (Step 2) ──────────────────────────────
   Shows multilateral preference schemes the origin participates in.
   Bilateral FTAs do not appear here (they're per-measure regulations,
   surfaced by /api/taric-rates) — the LiveResults toggle covers those. */
function OriginPreferenceHint({ origin, zones }) {
  if (!zones || zones.length === 0) {
    return (
      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
        No multilateral preference scheme — bilateral FTAs (if any) appear once an HS code is set.
      </div>
    )
  }
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
        {origin} preferences
      </span>
      {zones.map(z => (
        <span
          key={z.code}
          title={`${z.description} · TARIC zone ${z.code}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--sage-dim, #4a6b4a)',
            background: 'rgba(122,162,122,0.10)',
            border: '1px solid rgba(122,162,122,0.32)',
            padding: '3px 8px',
            borderRadius: 999,
            letterSpacing: '.02em',
          }}
        >
          {zoneShortName(z)}
        </span>
      ))}
    </div>
  )
}

/* ── VAT confirm modal ─────────────────────────────────────────────
   Shows the full set of rates the destination country uses and lets the
   user pick one (or override with a custom rate). The lookup payload
   comes from /api/vat-lookup (TEDB-backed) so the rates and the source
   citation reflect real reference data, not placeholder text. */
function VatConfirmModal({ lookup, dest, onCancel, onConfirm }) {
  const initialRate = lookup.suggested
  const [picked, setPicked] = useState(initialRate)
  const [editing, setEditing] = useState(false)
  const [custom, setCustom] = useState(String(initialRate))
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const finalRate = editing ? parseFloat(custom) || 0 : picked
  const labelFor = (r) => {
    if (r === lookup.standard) return 'Standard'
    if (lookup.reducedCandidate != null && r === lookup.reducedCandidate) return 'Reduced'
    if (r === 0) return 'Zero'
    return null
  }
  return (
    <div className={s.modalBackdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="vat-modal-title">
        <p className={s.modalEyebrow}>Please confirm</p>
        <h3 id="vat-modal-title" className={s.modalTitle}>VAT rate at destination</h3>

        <div className={s.modalDisplay}>
          {editing ? (
            <input
              className={s.input}
              style={{ width: 130, fontSize: 28, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '-1px', height: 62, textAlign: 'center' }}
              type="number"
              step="0.1"
              autoFocus
              value={custom}
              onChange={e => setCustom(e.target.value)}
            />
          ) : (
            <span className={s.modalRate}>{picked}</span>
          )}
          <span className={s.modalRateUnit}>%</span>
          <button
            type="button"
            onClick={() => setEditing(v => !v)}
            style={{
              marginLeft: 'auto', fontSize: 12, background: 'transparent',
              border: '1px solid var(--border-strong)', padding: '6px 12px',
              borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {editing ? 'Use rate picker' : 'Custom rate'}
          </button>
        </div>

        {/* Quick-pick chips for every applicable rate the country uses */}
        {!editing && lookup.alternatives.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0 0 14px' }}>
            {lookup.alternatives.map(r => {
              const isPicked = r === picked
              const tag = labelFor(r)
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPicked(r)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '7px 12px',
                    borderRadius: 999,
                    border: `1px solid ${isPicked ? 'var(--sage)' : 'rgba(255,255,255,0.18)'}`,
                    background: isPicked ? 'rgba(122,162,122,0.18)' : 'transparent',
                    color: isPicked ? 'var(--sage-light, #c9d6b8)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {r}%{tag ? <span style={{ marginLeft: 6, opacity: 0.65, fontWeight: 500 }}>· {tag}</span> : null}
                </button>
              )
            })}
          </div>
        )}

        <p className={s.modalDetail}>
          {lookup.reasoning}
        </p>
        {lookup.country?.notes && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '6px 0 14px', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--text-secondary)' }}>{dest.l}:</strong> {lookup.country.notes}
          </p>
        )}

        <div className={s.modalSource}>
          {lookup.source}
        </div>

        <div className={s.modalActions}>
          <button className={s.modalCancel} onClick={onCancel}>Cancel</button>
          <button className={s.modalConfirm} onClick={() => onConfirm(finalRate)}>
            <Check /> Confirm {finalRate}% VAT
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   STEP 3 — SHIPPING DETAILS · Incoterms-driven inputs
   The Incoterm picker leads, because it determines what the unit price
   already includes. Freight/insurance fields dim when the term implies
   they're already in the price; a "post-importation costs" field appears
   for DDP since UCC Art 70 lets the importer subtract those.
   ════════════════════════════════════════════════════════════════════ */
function Step3Shipping({ state, setState, onComplete, onBack }) {
  const set = (k, v) => setState(s => ({ ...s, [k]: v }))
  const profile = INCOTERM_PROFILES[state.incoterms] || INCOTERM_PROFILES.CIF

  // For Incoterms where the price already covers the leg, switch the
  // freight / insurance field labels to "additional" and dim them. The
  // user can still enter values (e.g. internal trucking past the port).
  const freightDimmed = profile.freightToBorder
  const insuranceDimmed = profile.insurance
  const freightLabel = freightDimmed ? 'Additional freight' : 'Freight to EU border'
  const insuranceLabel = insuranceDimmed ? 'Additional insurance' : 'Insurance to EU border'

  return (
    <div>
      <div className={s.panelHead}>
        <div>
          <p className={s.panelEyebrow}>Step 3 · Shipping</p>
          <h2 className={s.panelTitle}>Shipping Details</h2>
        </div>
      </div>

      {/* Incoterm leads — drives every other field below */}
      <div className={s.group}>
        <h3 className={s.groupTitle}>Incoterms 2020</h3>
        <div className={s.rowTwo}>
          <div className={s.field}>
            <span className={s.fieldLabel}>Term</span>
            <select className={s.select} value={state.incoterms} onChange={e => set('incoterms', e.target.value)}>
              {INCOTERMS.map(i => <option key={i} value={i}>{i} — {INCOTERM_PROFILES[i].label}</option>)}
            </select>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Named place</span>
            <input
              className={s.input}
              type="text"
              value={state.namedPlace || ''}
              onChange={e => set('namedPlace', e.target.value)}
              placeholder={state.incoterms === 'EXW' ? "e.g. Shenzhen factory" : state.incoterms === 'FOB' ? 'e.g. Port of Shanghai' : 'e.g. Antwerp'}
            />
          </div>
        </div>
        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          background: 'rgba(156,168,138,0.06)',
          border: '1px solid rgba(156,168,138,0.18)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
        }}>
          <strong style={{ color: 'var(--text-primary)' }}>{state.incoterms} · {profile.label}</strong>
          <span style={{ color: 'var(--text-muted)' }}> — {profile.note}</span>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>Price covers freight to EU border: <strong style={{ color: profile.freightToBorder ? 'var(--sage)' : 'var(--terracotta)' }}>{profile.freightToBorder ? 'yes' : 'no'}</strong></span>
            <span>Insurance: <strong style={{ color: profile.insurance ? 'var(--sage)' : 'var(--terracotta)' }}>{profile.insurance ? 'yes' : 'no'}</strong></span>
            <span>Seller pays import duty: <strong style={{ color: profile.sellerHandlesImport ? 'var(--sage)' : 'var(--terracotta)' }}>{profile.sellerHandlesImport ? 'yes' : 'no'}</strong></span>
          </div>
        </div>
      </div>

      <div className={s.group}>
        <h3 className={s.groupTitle}>Invoice values</h3>
        <div className={s.rowThree}>
          <div className={s.field}>
            <span className={s.fieldLabel}>
              Invoice value <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {state.incoterms}</span>
            </span>
            <div className={s.inputWithSuffix}>
              <input
                type="number"
                inputMode="decimal"
                className={s.input}
                value={state.value}
                onChange={e => set('value', e.target.value)}
                placeholder="0.00"
              />
              <span className={s.inputSuffix}>{state.currency}</span>
            </div>
          </div>
          <div className={s.field} style={{ opacity: freightDimmed ? 0.55 : 1 }}>
            <span className={s.fieldLabel}>
              {freightLabel}
              {freightDimmed && <span title="Already in invoice value under this Incoterm" style={{ marginLeft: 6, color: 'var(--text-muted)' }}>(included)</span>}
            </span>
            <div className={s.inputWithSuffix}>
              <input
                type="number"
                inputMode="decimal"
                className={s.input}
                value={state.shipping}
                onChange={e => set('shipping', e.target.value)}
                placeholder="0.00"
              />
              <span className={s.inputSuffix}>{state.currency}</span>
            </div>
          </div>
          <div className={s.field} style={{ opacity: insuranceDimmed ? 0.55 : 1 }}>
            <span className={s.fieldLabel}>
              {insuranceLabel}
              {insuranceDimmed && <span title="Already in invoice value under this Incoterm" style={{ marginLeft: 6, color: 'var(--text-muted)' }}>(included)</span>}
            </span>
            <div className={s.inputWithSuffix}>
              <input
                type="number"
                inputMode="decimal"
                className={s.input}
                value={state.insurance}
                onChange={e => set('insurance', e.target.value)}
                placeholder="0.00"
              />
              <span className={s.inputSuffix}>{state.currency}</span>
            </div>
          </div>
        </div>
      </div>

      <div className={s.group}>
        <h3 className={s.groupTitle}>Other costs</h3>
        <div className={s.rowTwo}>
          <div className={s.field}>
            <span className={s.fieldLabel}>Brokerage / clearance fee</span>
            <div className={s.inputWithSuffix}>
              <input
                type="number"
                inputMode="decimal"
                className={s.input}
                value={state.brokerage}
                onChange={e => set('brokerage', e.target.value)}
                placeholder="0.00"
              />
              <span className={s.inputSuffix}>{state.currency}</span>
            </div>
          </div>
          {/* DDP-specific: post-importation costs subtracted from CIF.
              Per UCC Art 70(2)(b), inland freight from the EU border to
              destination is excluded from customs value when sold under
              a DDP-style term, provided it can be quantified separately. */}
          {profile.sellerHandlesImport && (
            <div className={s.field}>
              <span className={s.fieldLabel}>
                Post-importation costs <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· DDP only</span>
              </span>
              <div className={s.inputWithSuffix}>
                <input
                  type="number"
                  inputMode="decimal"
                  className={s.input}
                  value={state.postImport || ''}
                  onChange={e => set('postImport', e.target.value)}
                  placeholder="0.00"
                />
                <span className={s.inputSuffix}>{state.currency}</span>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Inland freight from EU border + duty/VAT included in seller's price (UCC Art 70(2)(b)).
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={s.stepNav}>
        <button className={s.backBtn} onClick={onBack}>← Back</button>
        <button className={s.nextBtn} onClick={onComplete}>
          Continue <ArrowRight />
        </button>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   STEP 4 — SUMMARY & EXPORT
   Final read-only review of the calculation. The user can copy a JSON
   snapshot for downstream tooling or trigger the browser print dialog
   for a clean PDF. No backend persistence yet — that lives behind a
   future "Save to dossier" action.
   ════════════════════════════════════════════════════════════════════ */
function Step4Summary({ state, computed, rates, useTA, originZones, onBack }) {
  const [copied, setCopied] = useState(false)
  const dest = DESTINATIONS.find(d => d.v === state.dest) || DESTINATIONS[0]
  const profile = computed.incotermProfile || INCOTERM_PROFILES.CIF
  const hsCode = state.hsResult?.cn10 || state.hsResult?.cn8 || state.hsResult?.hs6 || '—'

  // Source of the duty rate that was actually applied — keeps the audit
  // trail honest about whether MFN, an FTA preference, or a customs-union
  // rate was used.
  const dutySource =
    useTA && rates?.best?.kind === 'cu'
      ? `Customs Union (${rates.best.agreement}, certificate ${rates.best.certificate})`
      : useTA && rates?.best?.kind === 'fta'
        ? `Preferential / FTA (${rates.best.regulationId || 'TARIC PREF measure'})`
        : rates?.mfn != null
          ? `MFN (${rates.mfn.regulationId || 'TARIC type 103'})`
          : state.hsResult?.standardDutyRate != null
            ? 'MFN (cached from HS classification)'
            : 'Not available'

  const snapshot = {
    classification: {
      hs: hsCode,
      description: state.hsResult?.description || null,
      taricVerified: !!state.hsResult?.taricVerified,
    },
    movement: {
      origin: state.origin,
      destination: state.dest,
      incoterm: state.incoterms,
      namedPlace: state.namedPlace || null,
      currency: state.currency,
    },
    values: {
      invoice: parseFloat(state.value) || 0,
      freight: parseFloat(state.shipping) || 0,
      insurance: parseFloat(state.insurance) || 0,
      brokerage: parseFloat(state.brokerage) || 0,
      postImport: parseFloat(state.postImport) || 0,
    },
    duty: {
      rate: computed.dutyRate,
      source: dutySource,
      preferenceApplied: useTA,
      schemes: originZones.map(z => z.acronym || z.code),
    },
    vat: {
      rate: state.vat,
      confirmed: !!state.vatConfirmed,
    },
    totals: {
      cif: round2(computed.cif),
      duty: round2(computed.duty),
      vat: round2(computed.vatAmt),
      brokerage: round2(computed.brokerage),
      total: round2(computed.total),
    },
    generated: new Date().toISOString(),
  }

  const copyJson = () => {
    navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  const print = () => window.print()

  return (
    <div>
      <div className={s.panelHead}>
        <div>
          <p className={s.panelEyebrow}>Step 4 · Export</p>
          <h2 className={s.panelTitle}>Summary &amp; Export</h2>
        </div>
      </div>

      {/* Headline total */}
      <div style={{
        padding: '20px 22px',
        background: 'linear-gradient(180deg, rgba(122,162,122,0.14), rgba(122,162,122,0.04))',
        border: '1px solid rgba(122,162,122,0.3)',
        borderRadius: 'var(--radius-lg, 14px)',
        marginBottom: 18,
      }}>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--sage)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Total landed cost
        </div>
        <div style={{ fontSize: 38, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-1.2px', marginTop: 4 }}>
          {money(computed.total, state.currency)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          HS <strong style={{ color: 'var(--text-secondary)' }}>{formatCn(hsCode)}</strong>
          {' · '}{state.origin} → {state.dest} · {state.incoterms}
          {state.namedPlace ? ` (${state.namedPlace})` : ''}
        </div>
      </div>

      {/* Two-column breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <SummaryBlock title="Classification">
          <SummaryRow label="HS code" value={formatCn(hsCode)} mono />
          <SummaryRow label="Description" value={state.hsResult?.description || '—'} wrap />
          <SummaryRow label="TARIC verified" value={state.hsResult?.taricVerified ? '✓ yes' : 'no'} />
        </SummaryBlock>

        <SummaryBlock title="Movement">
          <SummaryRow label="Origin" value={state.origin} />
          <SummaryRow label="Destination" value={`${dest.l}`} />
          <SummaryRow label="Incoterm" value={`${state.incoterms} · ${profile.label}`} />
          {state.namedPlace && <SummaryRow label="Named place" value={state.namedPlace} />}
        </SummaryBlock>

        <SummaryBlock title="Invoice & freight">
          <SummaryRow label="Invoice value" value={money(parseFloat(state.value) || 0, state.currency)} mono />
          <SummaryRow label={profile.freightToBorder ? 'Additional freight' : 'Freight to border'} value={money(parseFloat(state.shipping) || 0, state.currency)} mono />
          <SummaryRow label={profile.insurance ? 'Additional insurance' : 'Insurance to border'} value={money(parseFloat(state.insurance) || 0, state.currency)} mono />
          {profile.sellerHandlesImport && (
            <SummaryRow label="Post-importation costs" value={`− ${money(parseFloat(state.postImport) || 0, state.currency)}`} mono />
          )}
          <SummaryRow label="CIF (customs value)" value={money(computed.cif, state.currency)} mono strong />
        </SummaryBlock>

        <SummaryBlock title="Duty & taxes">
          <SummaryRow label="Duty rate" value={`${computed.dutyRate.toFixed(2)}%`} mono />
          <SummaryRow label="Rate source" value={dutySource} wrap />
          <SummaryRow label="Duty amount" value={money(computed.duty, state.currency)} mono />
          <SummaryRow label={`VAT ${state.vat}% on (CIF + duty)`} value={money(computed.vatAmt, state.currency)} mono />
          <SummaryRow label="Brokerage" value={money(computed.brokerage, state.currency)} mono />
        </SummaryBlock>
      </div>

      {/* Compliance reminders for the chosen scenario */}
      <div style={{
        padding: '12px 14px',
        background: 'rgba(212,143,99,0.06)',
        border: '1px solid rgba(212,143,99,0.22)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 16,
        fontSize: 12,
        lineHeight: 1.6,
        color: 'var(--text-secondary)',
      }}>
        <strong style={{ color: 'var(--terracotta, #d48f63)', display: 'block', marginBottom: 4, letterSpacing: '.04em', textTransform: 'uppercase', fontSize: 10.5 }}>
          Reminders for this scenario
        </strong>
        {useTA && rates?.best?.kind === 'fta' && (
          <div>· Claiming preferential origin requires a valid proof (REX statement, EUR.1 movement certificate, or origin declaration depending on the agreement). The importer of record must hold this on file.</div>
        )}
        {useTA && rates?.best?.kind === 'cu' && (
          <div>· Customs Union: present a valid {rates.best.certificate} certificate to clear at 0% duty.</div>
        )}
        {profile.sellerHandlesImport && (
          <div>· DDP: the seller must be VAT-registered in {dest.l} or appoint a fiscal representative. Verify that post-importation costs entered above match the seller's cost breakdown.</div>
        )}
        {state.hsResult?.sensitiveGoods && (
          <div>· This HS chapter triggered a sensitive-goods flag — additional licences or phytosanitary/health certificates may be required.</div>
        )}
        {!state.hsResult?.taricVerified && (
          <div>· The HS code is not TARIC-verified. Check the leaf description before submitting any customs declaration.</div>
        )}
      </div>

      {/* Export actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button
          type="button"
          onClick={print}
          style={{
            padding: '11px 18px',
            background: 'var(--sage)',
            color: '#0E1218',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            letterSpacing: '.02em',
          }}
        >
          🖨 Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={copyJson}
          style={{
            padding: '11px 18px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            letterSpacing: '.02em',
          }}
        >
          {copied ? '✓ Copied' : '⎘ Copy JSON snapshot'}
        </button>
      </div>

      <div className={s.stepNav}>
        <button className={s.backBtn} onClick={onBack}>← Back</button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Generated {new Date().toLocaleString()}
        </span>
      </div>
    </div>
  )
}

function SummaryBlock({ title, children }) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--sage)', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  )
}
function SummaryRow({ label, value, mono, wrap, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: wrap ? 'flex-start' : 'baseline' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: strong ? 14 : 12.5,
        fontWeight: strong ? 700 : 500,
        color: strong ? 'var(--text-primary)' : 'var(--text-secondary)',
        textAlign: 'right',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
        wordBreak: wrap ? 'break-word' : 'normal',
      }}>
        {value}
      </span>
    </div>
  )
}
function round2(n) { return Math.round((n || 0) * 100) / 100 }

/* ════════════════════════════════════════════════════════════════════
   LIVE RESULTS
   ════════════════════════════════════════════════════════════════════ */
function LiveResults({ state, computed, rates, ratesLoading, originZones = [], useTA, onToggleTA, onCurrencyChange }) {
  // Flash an animation whenever any computed value changes
  const [flashKey, setFlashKey] = useState(0)
  const prevRef = useRef(computed.total)
  useEffect(() => {
    if (prevRef.current !== computed.total) {
      setFlashKey(k => k + 1)
      prevRef.current = computed.total
    }
  }, [computed.total])

  const currency = state.currency
  const hsCode = state.hsResult ? formatCn(state.hsResult.cn10 || state.hsResult.cn8 || state.hsResult.hs6) : null

  return (
    <div className={s.resultsStick}>
      <div className={s.resultsCard}>
        <div className={s.resultsHead}>
          <h3 className={s.resultsTitle}>Live Results</h3>
          <span className={s.resultsPulse}>Live</span>
        </div>

        <div className={s.resultsCurrency}>
          <span className={s.resultsCurrencyLbl}>Currency</span>
          <select
            className={s.resultsCurrencySel}
            value={state.currency}
            onChange={e => onCurrencyChange(e.target.value)}
          >
            <option value="EUR">EUR · €</option>
            <option value="USD">USD · $</option>
            <option value="GBP">GBP · £</option>
          </select>
        </div>

        <div className={s.resultsRows} key={flashKey}>
          <div className={s.resultsRow}>
            <span className={s.resultsKey}>
              Customs value (CIF)
              <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>· {state.incoterms}-derived</span>
            </span>
            <span className={`${s.resultsVal} ${computed.cif === 0 ? s.resultsValDim : s.resultsValPulse}`}>
              {money(computed.cif, currency)}
            </span>
          </div>
          <div className={s.resultsRow}>
            <span className={s.resultsKey}>
              Duties {computed.dutyRate != null && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {computed.dutyRate.toFixed(1)}%</span>}
            </span>
            <span className={`${s.resultsVal} ${computed.duty === 0 ? s.resultsValDim : s.resultsValPulse}`}>
              {money(computed.duty, currency)}
            </span>
          </div>
          <div style={{ margin: '4px 0', padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', borderLeft: '2px solid rgba(14,18,24,0.1)' }}>
            Trade agreement:{' '}
            {ratesLoading
              ? 'checking…'
              : !state.hsResult
                ? 'classify an HS first'
                : !rates
                  ? `(no data yet — cn=${state.hsResult?.cn10 || state.hsResult?.cn8 || state.hsResult?.hs6 || '—'}, origin=${state.origin})`
                  : rates.best
                    ? `available (${rates.best.rate.toFixed(1)}% vs MFN ${rates.mfn?.rate?.toFixed(1) ?? '—'}%)`
                    : `none applies · MFN ${rates.mfn?.rate?.toFixed(1) ?? '—'}%`}
          </div>
          {rates?.best && (() => {
            // Label resolution priority: customs-union has an explicit
            // agreement name from /api/taric-rates; otherwise prefer a
            // multilateral scheme matched on the origin (GSP, EFTA, …);
            // otherwise the generic "Preferential rate".
            const ftaScheme = rates.best.kind === 'fta' && originZones.length > 0 ? zoneShortName(originZones[0]) : null
            return (
              <button
                type="button"
                onClick={onToggleTA}
                aria-pressed={useTA}
                title={
                  rates.best.kind === 'fta' && originZones.length > 0
                    ? `Preference schemes for ${state.origin}: ${originZones.map(zoneShortName).join(', ')}`
                    : undefined
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  margin: '4px 0',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${useTA ? 'var(--sage)' : 'rgba(14,18,24,0.15)'}`,
                  background: useTA ? 'rgba(122,162,122,0.12)' : 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span>
                  {useTA ? '✓ ' : ''}
                  {rates.best.kind === 'cu'
                    ? <>{rates.best.agreement} · {rates.best.rate.toFixed(1)}% with {rates.best.certificate}</>
                    : <>{ftaScheme || 'Preferential rate'} · {rates.best.rate.toFixed(1)}% vs {rates.mfn.rate.toFixed(1)}% MFN</>
                  }
                </span>
                <span style={{ color: 'var(--sage)', fontWeight: 600 }}>
                  {useTA ? 'ON' : 'apply'}
                </span>
              </button>
            )
          })()}
          {rates?.best?.kind === 'fta' && originZones.length > 0 && (
            <div style={{ margin: '0 0 4px 0', padding: '0 10px', fontSize: 10.5, color: 'var(--text-muted)' }}>
              Eligible schemes: {originZones.map(z => zoneShortName(z)).join(' · ')}
            </div>
          )}

          <div className={s.resultsRow}>
            <span className={s.resultsKey}>
              VAT {state.vatConfirmed && <span style={{ color: 'var(--sage-dim)', fontSize: 11 }}>· {state.vat}%</span>}
            </span>
            <span className={`${s.resultsVal} ${!state.vatConfirmed ? s.resultsValDim : s.resultsValPulse}`}>
              {state.vatConfirmed ? money(computed.vatAmt, currency) : 'pending'}
            </span>
          </div>
          <div className={s.resultsRow}>
            <span className={s.resultsKey}>Brokerage</span>
            <span className={`${s.resultsVal} ${computed.brokerage === 0 ? s.resultsValDim : ''}`}>
              {money(computed.brokerage, currency)}
            </span>
          </div>
        </div>

        <div className={s.resultsBreak} />

        <div className={s.resultsTotalLabel}>Total Landed Cost</div>
        <div className={s.resultsTotalAmount}>
          {state.vatConfirmed && computed.total > 0 ? money(computed.total, currency) : money(0, currency)}
        </div>

        <p className={s.resultsFoot}>
          {hsCode ? <>HS <strong style={{color:'var(--text-secondary)'}}>{hsCode}</strong> · </> : null}
          {state.origin} → {state.dest} · {state.incoterms}
          {!state.vatConfirmed && <><br />Confirm the VAT rate to see the final total.</>}
        </p>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   ROOT
   ════════════════════════════════════════════════════════════════════ */
export default function CalcWizard({ initialHs = '', onHsFound = () => {} }) {
  const [step, setStep] = useState(1)
  const [completed, setCompleted] = useState(new Set())

  const [state, setState] = useState({
    query: '',
    hsResult: initialHs ? {
      hs6: initialHs.slice(0, 6),
      cn8: initialHs.length >= 8 ? initialHs.slice(0, 8) : null,
      cn10: initialHs.length >= 10 ? initialHs.slice(0, 10) : null,
      description: 'Prefilled from search',
      standardDutyRate: null,
      manual: true,
    } : null,

    origin: 'CN',
    dest: 'LU',
    currency: 'EUR',
    value: '',
    shipping: '',
    insurance: '',
    brokerage: '',
    postImport: '',
    incoterms: 'CIF',
    namedPlace: '',
    vat: 17,
    suggestedVat: 17,
    vatConfirmed: false,
  })

  // TARIC rates for (current CN × origin). Populated once both are known.
  // `preferential` is only set when a PREF measure exists AND is lower
  // than MFN, so the toggle below can assume it's a genuine saving.
  const [rates, setRates] = useState(null)
  const [ratesLoading, setRatesLoading] = useState(false)
  const [useTA, setUseTA] = useState(false)

  // Multilateral preference zones the chosen origin belongs to (GSP,
  // EFTA, EEA, EPA, …). Cached per-origin in module scope to avoid
  // re-fetching as the user toggles between steps.
  const [originZones, setOriginZones] = useState([])
  useEffect(() => {
    const o = state.origin
    if (!o || o.length !== 2) { setOriginZones([]); return }
    let cancelled = false
    fetch(`/api/trade-agreements?origin=${o}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        const zones = Array.isArray(data?.zones) ? data.zones.filter(isPreferentialZone) : []
        setOriginZones(zones)
      })
      .catch(() => { if (!cancelled) setOriginZones([]) })
    return () => { cancelled = true }
  }, [state.origin])

  useEffect(() => {
    const cn = state.hsResult?.cn10 || state.hsResult?.cn8 || state.hsResult?.hs6
    if (!cn || cn.replace(/\D/g, '').length < 6 || !state.origin || state.origin.length !== 2) {
      setRates(null); setUseTA(false); setRatesLoading(false); return
    }
    let cancelled = false
    setRatesLoading(true)
    fetch(`/api/taric-rates?cn=${cn.replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}&origin=${state.origin}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        setRatesLoading(false)
        if (!data || data.error) { setRates(null); return }
        const mfn = data.mfn?.rate
        const pref = data.preferential?.rate
        const cu = data.customsUnion?.rate
        // Collapse the PREF and Customs Union paths into a single "best
        // non-MFN rate" for the UI. Strictly better than MFN to qualify.
        const best =
          cu != null && mfn != null && cu < mfn ? { kind: 'cu', rate: cu, certificate: data.customsUnion.certificate, agreement: data.customsUnion.agreement }
          : pref != null && mfn != null && pref < mfn ? { kind: 'fta', rate: pref, regulationId: data.preferential.regulationId }
          : null
        setRates({ ...data, best })
      })
      .catch(() => { if (!cancelled) setRatesLoading(false) })
    return () => { cancelled = true }
  }, [state.hsResult?.cn10, state.hsResult?.cn8, state.hsResult?.hs6, state.origin])

  // Reset the toggle whenever the rate context changes — stops a stale
  // "preference applied" from surviving an origin or HS change.
  useEffect(() => { setUseTA(false) }, [rates?.cn, rates?.origin])

  // bubble up HS code so the topbar pill reflects current classification
  useEffect(() => {
    const hs = state.hsResult?.cn8 || state.hsResult?.hs6 || ''
    if (hs) onHsFound(hs)
  }, [state.hsResult, onHsFound])

  const markCompleted = (id) => setCompleted(prev => {
    const next = new Set(prev); next.add(id); return next
  })

  const handleComplete = (id) => {
    markCompleted(id)
    setStep(Math.min(id + 1, STEPS.length))
  }

  const handleJump = (id) => {
    if (completed.has(id) || id === step) setStep(id)
  }

  /* ── Derived calculation (always current) ─────────────────────────
     Customs value is the transaction value adjusted to the EU border per
     UCC Articles 70–74. The Incoterm determines what's already in the
     invoice value vs. what must be added (or, for DDP, subtracted):

       EXW / FCA / FOB      → invoice + freight + insurance to border
       CFR / CPT            → invoice already covers freight; add insurance
       CIF / CIP / DAP / DPU → invoice already covers freight + insurance
       DDP                  → invoice covers everything; subtract post-
                              importation costs (inland freight from EU
                              border + the duty/VAT the seller will reclaim)

     If the user enters an "additional" freight/insurance value under a
     term that already covers it, we add that on top — e.g. inland leg
     past the destination port that wasn't in the seller's quote.
  ─────────────────────────────────────────────────────────────────── */
  const computed = useMemo(() => {
    const v = parseFloat(state.value) || 0
    const ship = parseFloat(state.shipping) || 0
    const ins = parseFloat(state.insurance) || 0
    const broker = parseFloat(state.brokerage) || 0
    const postImport = parseFloat(state.postImport) || 0
    const profile = INCOTERM_PROFILES[state.incoterms] || INCOTERM_PROFILES.CIF

    // CIF derivation. The freight/insurance fields are reinterpreted by
    // Step 3's labels based on the Incoterm — when the term already
    // covers the leg, the field becomes "additional" (anything beyond
    // what the seller covered). Either way they are added, never double-
    // counted, because the user's invoice value reflects the term.
    // For DDP, subtract post-importation costs (inland freight from EU
    // border + the duty/VAT the seller will reclaim). Floors at 0.
    let cif = v + ship + ins
    if (profile.sellerHandlesImport) cif = Math.max(0, cif - postImport)

    // Duty rate sources, in priority order: live "best" (if user toggled
    // — FTA or Customs Union), live MFN from TARIC, HS lookup cached rate.
    const mfnRate = rates?.mfn?.rate ?? state.hsResult?.standardDutyRate ?? 0
    const dutyRate = useTA && rates?.best?.rate != null ? rates.best.rate : mfnRate
    const duty = cif * (dutyRate / 100)
    const taxable = cif + duty
    const vatAmt = state.vatConfirmed ? taxable * ((parseFloat(state.vat) || 0) / 100) : 0
    const total = taxable + vatAmt + broker
    return { cif, duty, dutyRate, vatAmt, brokerage: broker, total, incotermProfile: profile }
  }, [state, rates, useTA])

  return (
    <div className={s.root}>
      <Timeline current={step} completed={completed} onJump={handleJump} />

      <div className={s.grid}>
        <div className={s.panel}>
          {step === 1 && (
            <Step1HsLookup
              state={state}
              setState={setState}
              onComplete={() => handleComplete(1)}
            />
          )}
          {step === 2 && (
            <Step2LandedCost
              state={state}
              setState={setState}
              originZones={originZones}
              onComplete={() => handleComplete(2)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Shipping
              state={state}
              setState={setState}
              onComplete={() => handleComplete(3)}
              onBack={() => setStep(2)}
            />
          )}
          {step === 4 && (
            <Step4Summary
              state={state}
              computed={computed}
              rates={rates}
              useTA={useTA}
              originZones={originZones}
              onBack={() => setStep(3)}
            />
          )}
        </div>

        <LiveResults
          state={state}
          computed={computed}
          rates={rates}
          ratesLoading={ratesLoading}
          originZones={originZones}
          useTA={useTA}
          onToggleTA={() => setUseTA(v => !v)}
          onCurrencyChange={(c) => setState(v => ({ ...v, currency: c }))}
        />
      </div>
    </div>
  )
}
