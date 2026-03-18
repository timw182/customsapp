"use client";
import { useState } from "react";
import styles from "./HsLookupTabV2.module.css";

export default function HsLookupTabV2({
  description, setDescription,
  lookupHS, hsLoading, hsResult, setHsResult,
  favourites, savedCodes,
  saveFavourite, removeFavourite,
  setTab, setHsCode,
}) {
  const [dismissedQuestions, setDismissedQuestions] = useState(new Set());
  const cn8Fmt = hsResult?.cn8
    ? hsResult.cn8.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3")
    : (hsResult?.hs6 || "");

  const confColor = hsResult?.confidence === "high" ? "#10b981"
    : hsResult?.confidence === "medium" ? "#D97706" : "#DC2626";
  const confWidth = hsResult?.confidence === "high" ? "90%"
    : hsResult?.confidence === "medium" ? "60%" : "30%";

  const isCBAM = (() => {
    const code = ((hsResult?.cn8 || hsResult?.hs6) || "").replace(/\D/g,"");
    return ["72","73","76","25","28","31","27"].includes(code.substring(0,2));
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
              onClick={lookupHS}
              disabled={hsLoading || !description.trim()}
            >
              {hsLoading ? <><span className={styles.spinner}/>Classifying…</> : "Classify"}
            </button>
          </div>
          <div className={styles.hint}>
            Claude AI classifies based on your description. Always verify against official TARIC before lodging a declaration.
          </div>

          {/* Error */}
          {hsResult?.error && (
            <div className={`${styles.infoPill} ${styles.pillRed}`} style={{marginTop:14}}>
              ⚠️ {hsResult.error}
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
                    MFN duty: <strong>{hsResult.standardDutyRate}%</strong>
                  </span>
                  <span className={styles.resultRateItem}>
                    Luxembourg VAT: <strong>{hsResult.vatRateLU || 17}%</strong>
                  </span>
                  {isCBAM && <span className={`${styles.tag} ${styles.tagAmber}`}>CBAM eligible</span>}
                  {hsResult.antiDumping && <span className={`${styles.tag} ${styles.tagRed}`}>Anti-dumping ⚠️</span>}
                </div>
                <div className={styles.confRow}>
                  <span className={styles.confLabel}>Confidence</span>
                  <div className={styles.confBar}>
                    <div className={styles.confFill} style={{width:confWidth,background:confColor}}/>
                  </div>
                  <span className={styles.confText}>{hsResult.confidence}</span>
                </div>
                <div className={styles.resultActions}>
                  <a
                    href={`https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&number=${(hsResult.cn8||"").replace(/\D/g,"")}0000&LangDescr=en`}
                    target="_blank" rel="noreferrer"
                    className={`${styles.btnGhost} ${styles.btnSm}`}
                  >
                    Verify in TARIC ↗
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

      {/* ── SAVED HS CODES ── */}
      <div className={styles.card}>
        <div className={styles.cardHdr}>
          <div className={styles.cardIcon}>⭐</div>
          <span className={styles.cardTitle}>Saved HS Codes</span>
        </div>
        {favourites.length === 0 ? (
          <div className={styles.emptyState}>
            No saved codes yet — classify a product to get started
          </div>
        ) : (
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>CN Code</th>
                <th>Description</th>
                <th>MFN Duty</th>
                <th>VAT</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {favourites.map((fav) => (
                <tr key={fav.id}>
                  <td className={`${styles.mono} ${styles.bold}`}>{fav.hsCode}</td>
                  <td>{fav.description}</td>
                  <td className={styles.mono}>{fav.dutyRate != null ? `${fav.dutyRate}%` : "—"}</td>
                  <td className={styles.mono}>17%</td>
                  <td>
                    <div style={{display:"flex",gap:6}}>
                      <button
                        className={`${styles.btnGhost} ${styles.btnSm}`}
                        onClick={() => { setHsCode(fav.hsCode); setTab("calculator"); }}
                      >
                        Use
                      </button>
                      <button
                        onClick={() => removeFavourite(fav.id, fav.hsCode)}
                        style={{height:28,padding:"0 8px",background:"transparent",border:"1px solid rgba(220,38,38,.2)",borderRadius:5,color:"#DC2626",fontSize:10,fontFamily:"var(--font-oswald,Oswald),sans-serif",cursor:"pointer",letterSpacing:".5px"}}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
