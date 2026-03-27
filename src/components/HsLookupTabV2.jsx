"use client";
import { useState, useEffect, useRef } from "react";
import styles from "./HsLookupTabV2.module.css";

const PROGRESS_STAGES = [
  { label: "AI classifying goods…",         pct: 18, ms: 0    },
  { label: "Verifying with EU TARIC…",      pct: 42, ms: 3500 },
  { label: "Browsing valid subheadings…",   pct: 65, ms: 7000 },
  { label: "Loading duty rates…",           pct: 84, ms: 11000 },
  { label: "Finalising result…",            pct: 95, ms: 16000 },
];

export default function HsLookupTabV2({
  description, setDescription,
  lookupHS, hsLoading, hsResult, setHsResult,
  favourites, savedCodes,
  saveFavourite, removeFavourite,
  setTab, setHsCode,
}) {
  const [dismissedQuestions, setDismissedQuestions] = useState(new Set());
  const [progress, setProgress] = useState({ pct: 0, label: "", active: false });
  const timersRef = useRef([]);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Load search history
  useEffect(() => {
    fetch("/api/hs-lookup/history")
      .then(r => r.ok ? r.json() : [])
      .then(data => { setHistory(data); setHistoryLoaded(true); })
      .catch(() => setHistoryLoaded(true));
  }, []);

  // Refresh history after each completed lookup
  useEffect(() => {
    if (!hsLoading && historyLoaded) {
      fetch("/api/hs-lookup/history")
        .then(r => r.ok ? r.json() : [])
        .then(setHistory)
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsLoading]);

  function deleteHistoryItem(id) {
    fetch(`/api/hs-lookup/history?id=${id}`, { method: "DELETE" }).catch(() => {});
    setHistory(h => h.filter(x => x.id !== id));
  }

  function clearHistory() {
    fetch("/api/hs-lookup/history", { method: "DELETE" }).catch(() => {});
    setHistory([]);
  }

  useEffect(() => {
    if (hsLoading) {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setProgress({ pct: PROGRESS_STAGES[0].pct, label: PROGRESS_STAGES[0].label, active: true });
      PROGRESS_STAGES.slice(1).forEach(({ label, pct, ms }) => {
        const t = setTimeout(() => setProgress(p => p.active ? { pct, label, active: true } : p), ms);
        timersRef.current.push(t);
      });
    } else {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      if (progress.active) {
        setProgress(p => ({ ...p, pct: 100, label: "Done" }));
        const t = setTimeout(() => setProgress({ pct: 0, label: "", active: false }), 500);
        timersRef.current.push(t);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsLoading]);
  // Prefer cn10 (10-digit TARIC code), fall back to cn8
  const primaryCode = hsResult?.cn10 || hsResult?.cn8 || "";
  const cn8Fmt = primaryCode.replace(/\D/g,"").replace(/(\d{4})(\d{2})(\d{2})(\d{2})?/, (_, a, b, c, d) =>
    d ? `${a}.${b}.${c}.${d}` : `${a}.${b}.${c}`
  ) || (hsResult?.hs6 || "");

  const confColor = hsResult?.confidence === "high" ? "#10b981"
    : hsResult?.confidence === "medium" ? "#D97706" : "#DC2626";
  const confWidth = hsResult?.confidence === "high" ? "90%"
    : hsResult?.confidence === "medium" ? "60%" : "30%";

  // CBAM goods — precise 4-digit heading / 6-digit subheading level check
  // EU Reg. 2023/956 Annex I: cement, iron/steel, aluminium, fertilizers, electricity, hydrogen
  // Broad chapter checks (25, 27, 28) were incorrect — chapter 25 has mostly non-CBAM minerals,
  // chapter 27 covers petroleum/gas (not CBAM), chapter 28 covers many non-CBAM chemicals
  const CBAM_HEADINGS = new Set([
    // Iron & steel (Chapter 72)
    "7201","7202","7203","7204","7205","7206","7207","7208","7209","7210","7211","7212","7213","7214","7215","7216","7217","7218","7219","7220","7221","7222","7223","7224","7225","7226","7227","7228","7229",
    // Articles of iron/steel (Chapter 73) — selected CBAM headings
    "7301","7302","7303","7304","7305","7306","7307","7308","7309","7310","7311","7312","7313","7314","7315","7316","7317","7318","7319","7320","7321","7322","7323","7324","7325","7326",
    // Aluminium (Chapter 76)
    "7601","7602","7603","7604","7605","7606","7607","7608","7609","7610","7611","7612","7613","7614","7615","7616",
    // Cement (Chapter 25 — only heading 2523)
    "2523",
    // Fertilizers (Chapter 28 + 31)
    "2808","2814","2834",  // nitric acid, ammonia, nitrates (Ch28)
    "3101","3102","3103","3104","3105",  // all fertilizer headings (Ch31)
    // Electricity (Chapter 27 — only heading 2716)
    "2716",
    // Hydrogen (Chapter 28 — only 2804.10)
    "2804",
  ]);
  const isCBAM = (() => {
    const code = ((hsResult?.cn8 || hsResult?.hs6) || "").replace(/\D/g,"");
    if (code.length < 4) return false;
    return CBAM_HEADINGS.has(code.substring(0, 4));
  })();

  return (
    <div className={styles.wrap}>

      {/* ── LOOKUP CARD ── */}
      <div className={styles.card}>
        <div className={styles.cardHdr}>
          <div className={styles.cardIcon}>🔍</div>
          <span className={styles.cardTitle}>HS Code Lookup</span>
          <span className={styles.cardSub}>AI-assisted classification · TARIC verification</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.lbl}>Describe the goods</div>
          <div className={styles.inpRow} style={{marginBottom:12}}>
            <input
              className={styles.inp}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !hsLoading && description.trim() && lookupHS()}
              placeholder="e.g. waterproof running shoes with rubber sole, size 42"
            />
            <button
              className={styles.btnGold}
              onClick={() => lookupHS()}
              disabled={hsLoading || !description.trim()}
            >
              {hsLoading ? <><span className={styles.spinner}/>Classifying…</> : "Classify"}
            </button>
          </div>
          <div className={styles.hint}>
            Claude AI classifies based on your description. Always verify against official TARIC before lodging a declaration.
          </div>

          {/* Progress bar */}
          {progress.active && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
              </div>
              <div className={styles.progressLabel}>{progress.label}</div>
            </div>
          )}

          {/* Error */}
          {hsResult?.error && (
            <div className={`${styles.infoPill} ${styles.pillRed}`} style={{marginTop:14}}>
              ⚠️ {hsResult.error}
            </div>
          )}

          {/* ── CANDIDATES RESULT ── */}
          {hsResult?.isCandidates && (
            <div style={{marginTop:16}}>
              <div className={styles.lbl} style={{marginBottom:8}}>
                Multiple candidates — select the best match:
              </div>
              {hsResult.partialReasoning && (
                <div className={styles.rationale} style={{marginBottom:10}}>
                  {hsResult.partialReasoning}
                </div>
              )}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {hsResult.candidates.map((c) => {
                  const digits = (c.cn10||c.cn8||'').replace(/\D/g,'');
                  const fmt = digits.replace(/(\d{4})(\d{2})(\d{2})(\d{2})?/, (_,a,b,cc,d) => d ? `${a}.${b}.${cc}.${d}` : `${a}.${b}.${cc}`);
                  return (
                    <div key={c.cn10||c.cn8} className={styles.candidateRow}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontFamily:'var(--f-mono)',fontWeight:700,fontSize:13,color:'var(--text)'}}>{fmt}</span>
                          {c.confidencePct != null && (
                            <span className={styles.candidatePct}>{c.confidencePct}%</span>
                          )}
                          {c.mfnRateRaw ? (
                            <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'rgba(16,185,129,.09)',border:'1px solid rgba(16,185,129,.25)',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}} title={c.mfnRateRaw}>MFN {c.mfnRateRaw}</span>
                          ) : c.mfnRate != null ? (
                            <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'rgba(16,185,129,.09)',border:'1px solid rgba(16,185,129,.25)',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}}>MFN {c.mfnRate}%</span>
                          ) : null}
                          {c.taricVerified && (
                            <span className={`${styles.tag} ${styles.tagGold}`}>✓ TARIC</span>
                          )}
                        </div>
                        <div style={{fontSize:12.5,color:'var(--body)'}}>{c.description || c.label}</div>
                        {c.reasoning && (
                          <div style={{fontSize:11,color:'var(--muted)',marginTop:3,lineHeight:1.5}}>{c.reasoning}</div>
                        )}
                      </div>
                      <button
                        className={`${styles.btnGold} ${styles.btnSm}`}
                        onClick={() => { setHsCode(c.hs6 || (c.cn8||'').slice(0,6) || ''); setTab('calculator'); }}
                      >
                        Use in Calc
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── SENSITIVE GOODS ── */}
          {hsResult?.sensitiveGoods && (
            <div className={styles.alertBox}>
              <div className={`${styles.alertHdr} ${styles.alertHdrRed}`}>
                <span style={{fontSize:20}}>⚠️</span>
                <div>
                  <div className={styles.alertHdrTitle}>Sensitive Goods — Licence Required</div>
                  <div className={styles.alertHdrSub}>Category: {hsResult.sensitiveGoods.category}</div>
                </div>
              </div>
              <div className={`${styles.alertBody} ${styles.alertBodyRed}`}>
                {hsResult.sensitiveGoods.warning}
                <ul style={{listStyle:"none",marginTop:10,padding:0}}>
                  {hsResult.sensitiveGoods.licenceAuthority && (
                    <li style={{padding:"3px 0"}}>📋 Authority: {hsResult.sensitiveGoods.licenceAuthority}</li>
                  )}
                  {hsResult.sensitiveGoods.regulations?.map((r,i) => (
                    <li key={i} style={{padding:"3px 0"}}>📜 {r}</li>
                  ))}
                  {hsResult.sensitiveGoods.consequences && (
                    <li style={{padding:"3px 0"}}>⚡ {hsResult.sensitiveGoods.consequences}</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* ── NEEDS MORE INFO ── */}
          {hsResult?.needsMoreInfo && (
            <div className={styles.alertBox}>
              <div className={`${styles.alertHdr} ${styles.alertHdrAmber}`}>
                <span style={{fontSize:20}}>🤔</span>
                <div>
                  <div className={styles.alertHdrTitle}>More Details Needed</div>
                  <div className={styles.alertHdrSub}>{hsResult.reason}</div>
                </div>
              </div>
              <div className={styles.alertBodyAmber}>
                <p style={{fontSize:12,color:"#6B7280",marginBottom:12}}>Click an answer to refine:</p>
                {hsResult.questions?.map((q,i) => {
                  const qText = typeof q === "string" ? q : q.question;
                  const answers = typeof q === "string" ? [] : (q.answers || []);
                  if (dismissedQuestions.has(i)) return null;
                  return (
                    <div key={i} style={{marginBottom:12}}>
                      <div style={{fontFamily:"var(--font-oswald,Oswald),sans-serif",fontSize:10.5,fontWeight:600,letterSpacing:1,color:"#92400e",marginBottom:6,textTransform:"uppercase"}}>
                        ❓ {qText}
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {answers.length === 0 ? (
                          <button className={`${styles.answerPill} ${styles.answerPillAmber}`}
                            onClick={() => setDescription(p => p.trim() + " ")}>
                            + type answer
                          </button>
                        ) : answers.map((a,j) => (
                          <button key={j} className={`${styles.answerPill} ${styles.answerPillAmber}`}
                            onClick={() => { const d = description.trim() + " " + a; setDescription(d); setDismissedQuestions(prev => new Set([...prev, i])); }}>
                            {a}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {hsResult.possibleChapters?.length > 0 && (
                  <div style={{marginTop:8}}>
                    <p style={{fontSize:11.5,color:"#6B7280",marginBottom:7}}>Could be classified under:</p>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {hsResult.possibleChapters.map((ch,i) => (
                        <button key={i} className={`${styles.answerPill} ${styles.answerPillGray}`}
                          onClick={() => { const d = description.trim() + " " + ch; setDescription(d); }}>
                          {ch}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {hsResult.hint && (
                  <div style={{marginTop:12,padding:"10px 12px",background:"#fef9c3",borderRadius:6,fontSize:12.5,color:"#713f12"}}>
                    💡 {hsResult.hint}
                  </div>
                )}
                <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid #fde68a"}}>
                  <button
                    className={styles.btnGold}
                    onClick={() => lookupHS(description)}
                    disabled={hsLoading}
                  >
                    {hsLoading ? "Searching…" : "🔍 Search with updated description"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── SUCCESS RESULT ── */}
          {hsResult && !hsResult.error && !hsResult.needsMoreInfo && hsResult.cn8 && (
            <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
              <div className={styles.resultPill}>
                <div className={styles.resultCode}>{cn8Fmt}</div>
                <div className={styles.resultDesc}>{hsResult.description}</div>
                <div className={styles.resultRates}>
                  <span className={styles.resultRateItem}>
                    MFN duty: <strong>{hsResult.standardDutyRate ?? "—"}%</strong>
                    {hsResult.mfnRateEstimated && <span style={{fontSize:9,color:'#d97706',marginLeft:4}}>(AI est.)</span>}
                  </span>
                  <span className={styles.resultRateItem}>
                    Luxembourg VAT: <strong>{hsResult.vatRateLU || 17}%</strong>
                  </span>
                  {isCBAM && <span className={`${styles.tag} ${styles.tagAmber}`}>CBAM eligible</span>}
                  {hsResult.antiDumping && <span className={`${styles.tag} ${styles.tagRed}`}>Anti-dumping ⚠️</span>}
                  {hsResult.fromCache && <span className={`${styles.tag} ${styles.tagGold}`}>⚡ Cached</span>}
                </div>
                {hsResult.taricVerified === true && (
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,marginBottom:2}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,color:'#059669',background:'#d1fae5',border:'1px solid #6ee7b7',borderRadius:4,padding:'2px 8px'}}>
                      ✓ TARIC verified (LU)
                    </span>
                  </div>
                )}
                {hsResult.taricVerified === false && (
                  <div style={{marginTop:4,marginBottom:2,padding:'6px 10px',background:'#fef3c7',border:'1px solid #fbbf24',borderRadius:4,fontSize:11.5,color:'#92400e'}}>
                    ⚠️ {hsResult.taricWarning}
                  </div>
                )}
                {hsResult.taricSiblings?.length > 1 && (
                  <div style={{marginTop:6,padding:'8px 10px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:6}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#166534',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>
                      📋 Valid 10-digit TARIC codes under {hsResult.hs6} — pick the most specific:
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:4}}>
                      {hsResult.taricSiblings.map((s) => {
                        const dispCode = s.cn10 || s.cn8;
                        const isSelected = (s.cn10 && s.cn10 === (hsResult.cn10||hsResult.cn8)) || s.cn8 === hsResult.cn8;
                        return (
                        <div key={s.cn10||s.cn8} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 6px',borderRadius:4,background: isSelected ? '#dcfce7' : 'white',border: isSelected ? '1px solid #86efac' : '1px solid #e5e7eb'}}>
                          <span style={{fontFamily:'monospace',fontWeight:700,fontSize:12,color:'#166534',minWidth:85}}>{dispCode.replace(/(\d{4})(\d{2})(\d{2})(\d{2})?/,(_, a,b,c,d) => d ? `${a}.${b}.${c}.${d}` : `${a}.${b}.${c}`)}</span>
                          <span style={{fontSize:12,color:'#374151',flex:1}}>{s.description}</span>
                          {s.mfnRateRaw ? (
                            <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'rgba(16,185,129,.09)',border:'1px solid rgba(16,185,129,.25)',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}} title={s.mfnRateRaw}>{s.mfnRateRaw}</span>
                          ) : s.mfnRate != null ? (
                            <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'rgba(16,185,129,.09)',border:'1px solid rgba(16,185,129,.25)',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}}>{s.mfnRate}%</span>
                          ) : (
                            <span style={{fontSize:10,fontWeight:600,color:'#9CA3AF',background:'#f3f4f6',border:'1px solid #e5e7eb',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}}>—</span>
                          )}
                          {isSelected && <span style={{fontSize:10,color:'#16a34a',whiteSpace:'nowrap'}}>← AI pick</span>}
                          <button
                            className={`${styles.btnGhost} ${styles.btnSm}`}
                            onClick={() => { setHsCode(dispCode); setTab('calculator'); }}
                          >
                            Use →
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={styles.confRow}>
                  <span className={styles.confLabel}>Confidence</span>
                  <div className={styles.confBar}>
                    <div className={styles.confFill} style={{width:confWidth,background:confColor}}/>
                  </div>
                  <span className={styles.confText}>{hsResult.confidence}</span>
                </div>
                <div className={styles.resultActions}>
                  <a
                    href={hsResult.saturnUrl || `https://saturn.etat.lu/ite-tariff-public/#/taric/nomenclature/sbn`}
                    target="_blank" rel="noreferrer"
                    className={`${styles.btnGhost} ${styles.btnSm}`}
                  >
                    Verify on Saturn (LU) ↗
                  </a>
                  <button
                    className={`${styles.btnGhost} ${styles.btnSm}`}
                    onClick={() => { setHsCode(hsResult.hs6 || ""); setTab("calculator"); }}
                  >
                    Use in Calculator
                  </button>
                  {!savedCodes?.has(hsResult.hs6) ? (
                    <button
                      className={`${styles.btnGhost} ${styles.btnSm}`}
                      onClick={() => saveFavourite(hsResult)}
                    >
                      ⭐ Save
                    </button>
                  ) : (
                    <span className={`${styles.tag} ${styles.tagGold}`}>⭐ Saved</span>
                  )}
                </div>
              </div>

              {/* Rationale */}
              {hsResult.rationale && (
                <div className={styles.rationale}>
                  <strong>Classification rationale:</strong> {hsResult.rationale}
                </div>
              )}

              {/* Expandable: Required Documents */}
              {hsResult.requiredDocuments?.length > 0 && (
                <details className={styles.expander}>
                  <summary>
                    <span>📄 Required Documents</span>
                    <span className={styles.expBadge}>{hsResult.requiredDocuments.length}</span>
                  </summary>
                  <div className={styles.expBody}>
                    {hsResult.requiredDocuments.map((doc,i) => (
                      <div key={i} className={styles.expRow}>
                        <span style={{width:16,height:16,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,background:doc.mandatory?"#d1fae5":"transparent",border:`2px solid ${doc.mandatory?"#10b981":"#E5E7EB"}`,color:"#10b981",flexShrink:0}}>
                          {doc.mandatory?"✓":""}
                        </span>
                        {doc.name}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Expandable: Preferential Rates */}
              {hsResult.preferentialRates?.length > 0 && (
                <details className={styles.expander}>
                  <summary>
                    <span>🌍 Preferential Rates</span>
                    <span className={styles.expBadge}>{hsResult.preferentialRates.length} FTAs</span>
                  </summary>
                  <div className={styles.expBody}>
                    {hsResult.preferentialRates.slice(0,6).map((pref,i) => (
                      <div key={i} className={styles.expRow} style={{justifyContent:"space-between"}}>
                        <span>{pref.partner}</span>
                        <span className={styles.mono} style={{fontWeight:700}}>{pref.rate}%</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Expandable: Regulations */}
              {hsResult.regulatoryNotes?.length > 0 && (
                <details className={styles.expander}>
                  <summary>
                    <span>📋 Regulations</span>
                    <span className={styles.expBadge}>{hsResult.regulatoryNotes.length}</span>
                  </summary>
                  <div className={styles.expBody}>
                    {hsResult.regulatoryNotes.map((reg,i) => (
                      <div key={i} className={styles.expRow}>{reg}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── RECENT SEARCHES ── */}
      {history.length > 0 && (
        <div className={styles.card}>
          <div className={styles.cardHdr}>
            <div className={styles.cardIcon}>🕒</div>
            <span className={styles.cardTitle}>Recent Searches</span>
            <span className={styles.cardSub}>Cached — no API tokens used</span>
            <button
              onClick={clearHistory}
              style={{marginLeft:'auto',fontSize:10,color:'var(--muted)',background:'none',border:'1px solid var(--border)',borderRadius:4,padding:'2px 8px',cursor:'pointer',fontFamily:'var(--f-head)',letterSpacing:.5,textTransform:'uppercase'}}
            >
              Clear all
            </button>
          </div>
          <div className={styles.cardBody} style={{padding:'10px 14px'}}>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {history.map((item) => {
                const code = item.cn8 || item.hs6 || '';
                const fmt = code.replace(/(\d{4})(\d{2})(\d{2})(\d{2})?/, (_,a,b,c,d) => d ? `${a}.${b}.${c}.${d}` : `${a}.${b}.${c}`);
                const ago = (() => {
                  const diff = Date.now() - new Date(item.createdAt).getTime();
                  if (diff < 3600000) return `${Math.round(diff/60000)}m ago`;
                  if (diff < 86400000) return `${Math.round(diff/3600000)}h ago`;
                  return `${Math.round(diff/86400000)}d ago`;
                })();
                return (
                  <div key={item.id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface,#fff)',cursor:'pointer',transition:'.15s'}}
                    onMouseEnter={e => e.currentTarget.style.borderColor='rgba(16,185,129,.4)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
                    onClick={() => { setDescription(item.description); lookupHS(item.description); }}
                  >
                    <span style={{fontSize:12,color:'var(--body)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description}</span>
                    {fmt && <span style={{fontFamily:'var(--f-mono)',fontSize:11,fontWeight:700,color:'var(--text)',whiteSpace:'nowrap'}}>{fmt}</span>}
                    {item.dutyRate != null && <span style={{fontSize:10,fontWeight:700,color:'#059669',background:'rgba(16,185,129,.09)',border:'1px solid rgba(16,185,129,.25)',borderRadius:3,padding:'1px 6px',whiteSpace:'nowrap'}}>{item.dutyRate}%</span>}
                    {item.fromCache && <span style={{fontSize:9,color:'#059669',whiteSpace:'nowrap',fontFamily:'var(--f-head)',letterSpacing:.5}}>⚡ cached</span>}
                    <span style={{fontSize:10,color:'var(--subtle)',whiteSpace:'nowrap'}}>{ago}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                      style={{fontSize:12,color:'var(--subtle)',background:'none',border:'none',cursor:'pointer',padding:'0 2px',lineHeight:1,flexShrink:0}}
                      title="Remove"
                    >×</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
