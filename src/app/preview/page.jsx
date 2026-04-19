"use client";

export default function PreviewPage() {
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const swatches = [
    { name: "paper-bone",   hex: "#F5F1E8", cat: "paper" },
    { name: "paper-cream",  hex: "#FBF8F0", cat: "paper" },
    { name: "paper-edge",   hex: "#EDE6D3", cat: "paper" },
    { name: "paper-sunk",   hex: "#EEE7D0", cat: "paper" },
    { name: "ink-forest",      hex: "#1F3B2D", cat: "ink" },
    { name: "ink-forest-deep", hex: "#14281E", cat: "ink" },
    { name: "ink-muted",       hex: "#5A6B5F", cat: "ink" },
    { name: "ink-faint",       hex: "#8A9188", cat: "ink" },
    { name: "brass",       hex: "#B8914A", cat: "brass" },
    { name: "brass-deep",  hex: "#8A6A33", cat: "brass" },
    { name: "brass-soft",  hex: "#D9BE83", cat: "brass" },
    { name: "oxblood",     hex: "#6B2C2C", cat: "oxblood" },
    { name: "seal-red",    hex: "#8B2E2E", cat: "oxblood" },
  ];

  return (
    <main>
      {/* Masthead */}
      <header
        style={{
          background: "var(--paper-cream)",
          borderBottom: "1px solid var(--rule-strong)",
          boxShadow: "0 1px 0 var(--paper-edge), 0 2px 0 var(--rule-hair)",
          padding: "20px 32px",
          display: "flex",
          alignItems: "baseline",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 500,
              color: "var(--ink-forest-deep)",
              letterSpacing: "-0.015em",
              fontVariationSettings: '"opsz" 48, "SOFT" 50',
            }}
          >
            Dutify
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.24em",
              color: "var(--brass-deep)",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Design System · Folio 01
          </span>
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-muted)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {date}
        </span>
      </header>

      <div className="dossier-folder-wide rise">
        {/* Title */}
        <section style={{ paddingTop: 32, paddingBottom: 48 }}>
          <span className="eyebrow">The Customs Dossier</span>
          <h1
            className="display"
            style={{
              fontSize: "clamp(48px, 8vw, 96px)",
              color: "var(--ink-forest-deep)",
              marginTop: 16,
              maxWidth: "18ch",
              lineHeight: 0.95,
            }}
          >
            A paper ledger<br />
            <em className="italic-serif" style={{ color: "var(--brass-deep)" }}>for modern customs.</em>
          </h1>
          <p
            className="serif"
            style={{
              marginTop: 24,
              maxWidth: "60ch",
              fontSize: 18,
              lineHeight: 1.5,
              color: "var(--ink-muted)",
              fontVariationSettings: '"opsz" 20, "SOFT" 50',
            }}
          >
            Every surface of Dutify uses this design language — bone paper, forest-green ink, brass accents, and a restrained use of oxblood reserved for refusals, expired measures, and danger. This page is the reference. Every primitive that appears in the app, in context.
          </p>

          <div className="ornament">
            <span className="ornament-mark">§ § §</span>
          </div>
        </section>

        {/* Swatches */}
        <section className="rise-1 mt-7">
          <div className="section-header">
            <span className="section-num">§ 01</span>
            <h2 className="section-title">The palette</h2>
            <span className="section-sub">Paper · ink · brass · oxblood</span>
          </div>

          <div className="grid-4" style={{ gap: 16 }}>
            {swatches.map((s) => (
              <article
                key={s.name}
                className="dossier-card"
                style={{ padding: 0, overflow: "hidden" }}
              >
                <div
                  style={{
                    height: 88,
                    background: s.hex,
                    borderBottom: "1px solid var(--rule-hair)",
                    position: "relative",
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      position: "absolute",
                      bottom: 8,
                      right: 10,
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      color: s.cat === "paper" ? "var(--ink-muted)" : "rgba(255,255,255,0.85)",
                    }}
                  >
                    {s.hex}
                  </span>
                </div>
                <div style={{ padding: "10px 14px" }}>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-forest-deep)", fontWeight: 500 }}>
                    --{s.name}
                  </div>
                  <div className="text-xs muted" style={{ fontStyle: "italic", fontFamily: "var(--font-display)", fontVariationSettings: '"opsz" 12, "SOFT" 50' }}>
                    {s.cat}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Typography */}
        <section className="rise-2 mt-8">
          <div className="section-header">
            <span className="section-num">§ 02</span>
            <h2 className="section-title">Typography</h2>
            <span className="section-sub">Fraunces · DM Sans · JetBrains Mono</span>
          </div>

          <div className="grid-2">
            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Display · Fraunces</span>
              <div className="display display-lg mt-3" style={{ color: "var(--ink-forest-deep)", fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                Duty &amp; Declaration
              </div>
              <div className="display display-md mt-3" style={{ color: "var(--ink-forest)", fontVariationSettings: '"opsz" 72, "SOFT" 50' }}>
                Article 23 · Preferential origin
              </div>
              <div className="serif italic-serif muted mt-3" style={{ fontSize: 22 }}>
                For the avoidance of doubt, Luxembourg applies…
              </div>
            </div>

            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Body · DM Sans</span>
              <p className="mt-3" style={{ fontSize: 16, lineHeight: 1.6, color: "var(--ink-forest-deep)" }}>
                For shipments entering Luxembourg under EU customs union rules, the MFN rate applies unless a preferential origin is declared. Proof of origin — EUR.1, invoice declaration, or REX — must be held at the time of entry, not issued retrospectively.
              </p>
              <div className="hairline mt-4 mb-4" />
              <span className="eyebrow">Monospace · JetBrains Mono</span>
              <div className="mono mt-3" style={{ fontSize: 22, color: "var(--ink-forest-deep)", letterSpacing: "0.02em", fontVariantNumeric: "tabular-nums" }}>
                6204.62.50   EUR&nbsp;12,480.00   12.0&nbsp;%
              </div>
            </div>
          </div>
        </section>

        {/* Form controls */}
        <section className="rise-3 mt-8">
          <div className="section-header">
            <span className="section-num">§ 03</span>
            <h2 className="section-title">Controls in context</h2>
            <span className="section-sub">Field rows, inputs, buttons</span>
          </div>

          <div className="grid-2">
            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Field rows</span>
              <div className="mt-4">
                <div className="field-row">
                  <span className="field-label">HS Code<span className="req">*</span></span>
                  <span className="field-value-mono">6204.62.50</span>
                </div>
                <div className="field-row">
                  <span className="field-label">Country of origin</span>
                  <span className="field-value">
                    Viet&nbsp;Nam&nbsp;<span className="stamp-badge stamp-badge--forest" style={{ marginLeft: 8 }}>FTA ✓</span>
                  </span>
                </div>
                <div className="field-row">
                  <span className="field-label">CIF value</span>
                  <span className="field-value-lg">€12,480.00</span>
                </div>
                <div className="field-row">
                  <span className="field-label">Duty rate</span>
                  <span className="field-value-mono">12.0&nbsp;%</span>
                </div>
              </div>
            </div>

            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Inputs</span>
              <div className="stack-4 mt-4">
                <div>
                  <label className="field-label" htmlFor="px-text">Description</label>
                  <input id="px-text" type="text" placeholder="Men's cotton trousers, woven" />
                </div>
                <div>
                  <label className="field-label" htmlFor="px-num">Amount</label>
                  <input id="px-num" type="number" placeholder="0.00" />
                </div>
                <div>
                  <label className="field-label" htmlFor="px-sel">Incoterm</label>
                  <select id="px-sel" defaultValue="CIF">
                    <option>EXW — Ex Works</option>
                    <option>FOB — Free on Board</option>
                    <option>CIF — Cost Insurance Freight</option>
                    <option>DAP — Delivered at Place</option>
                  </select>
                </div>
                <div className="row gap-2 mt-2">
                  <button className="btn btn-cta">Calculate</button>
                  <button className="btn btn-ghost">Ghost</button>
                  <button className="btn btn-brass">Brass</button>
                  <button className="btn btn-danger">Delete</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stamps, seals, tags */}
        <section className="rise-4 mt-8">
          <div className="section-header">
            <span className="section-num">§ 04</span>
            <h2 className="section-title">Marks of authority</h2>
            <span className="section-sub">Stamps, seals, tags</span>
          </div>

          <div className="dossier-card dossier-card-lg">
            <div className="row gap-4 row-wrap" style={{ alignItems: "center" }}>
              <div className="seal seal-lg">D</div>
              <div className="seal">A</div>
              <div className="seal seal-sm">§</div>

              <span style={{ flex: 1 }} />

              <span className="stamp-badge">Cleared</span>
              <span className="stamp-badge stamp-badge--forest">TARIC ✓</span>
              <span className="stamp-badge stamp-badge--oxblood">Refused</span>
              <span className="stamp-badge stamp-badge--mute">Draft</span>
            </div>

            <hr className="hairline mt-5 mb-5" />

            <div className="row gap-2 row-wrap">
              <span className="tag">Default</span>
              <span className="tag tag-forest">Forest · FTA</span>
              <span className="tag tag-brass">Brass · CBAM</span>
              <span className="tag tag-oxblood">Oxblood · Expired</span>
            </div>
          </div>
        </section>

        {/* Alerts */}
        <section className="rise-5 mt-8">
          <div className="section-header">
            <span className="section-num">§ 05</span>
            <h2 className="section-title">Notices &amp; advisories</h2>
          </div>

          <div className="stack-3">
            <div className="alert alert-info">
              <div>
                <div className="alert-title">Preferential rate available</div>
                Viet Nam is a signatory to EVFTA. Apply 0% on presentation of a REX origin declaration.
              </div>
            </div>
            <div className="alert alert-warn">
              <div>
                <div className="alert-title">CBAM reporting required</div>
                Chapter 72 (iron &amp; steel) falls under the Carbon Border Adjustment Mechanism. Embedded emissions must be reported.
              </div>
            </div>
            <div className="alert alert-danger">
              <div>
                <div className="alert-title">Origin sanctioned</div>
                Imports from the Russian Federation are prohibited under EU sanctions. Entry refused.
              </div>
            </div>
          </div>
        </section>

        {/* Stat rows, KV grid */}
        <section className="mt-8">
          <div className="section-header">
            <span className="section-num">§ 06</span>
            <h2 className="section-title">Breakdown</h2>
            <span className="section-sub">Stat rows &amp; key/value displays</span>
          </div>

          <div className="grid-2">
            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Shipment breakdown</span>
              <div className="mt-4">
                <div className="stat-row"><span className="stat-label">Item value</span><span className="stat-value">€10,000.00</span></div>
                <div className="stat-row"><span className="stat-label">Freight (70%)</span><span className="stat-value">€420.00</span></div>
                <div className="stat-row"><span className="stat-label">Insurance</span><span className="stat-value">€60.00</span></div>
                <div className="stat-row stat-row--total"><span className="stat-label">CIF value</span><span className="stat-value">€10,480.00</span></div>
              </div>
              <div className="mt-5">
                <div className="stat-row"><span className="stat-label">Customs duty · 12.0%</span><span className="stat-value">€1,257.60</span></div>
                <div className="stat-row"><span className="stat-label">Import VAT · 17%</span><span className="stat-value">€2,000.54</span></div>
                <div className="stat-row stat-row--total">
                  <span className="stat-label">Total landed cost</span>
                  <span className="stat-value" style={{ color: "var(--brass-deep)" }}>€13,738.14</span>
                </div>
              </div>
            </div>

            <div className="dossier-card dossier-card-lg">
              <span className="eyebrow">Key facts</span>
              <div className="kv-grid mt-4">
                <div className="kv">
                  <span className="kv-label">MRN</span>
                  <span className="kv-value">25LU20250942</span>
                </div>
                <div className="kv">
                  <span className="kv-label">HS code</span>
                  <span className="kv-value-display">6204.62.50</span>
                </div>
                <div className="kv">
                  <span className="kv-label">Declared at</span>
                  <span className="kv-value">LU000100</span>
                </div>
                <div className="kv">
                  <span className="kv-label">VAT rate</span>
                  <span className="kv-value">17.0 %</span>
                </div>
              </div>

              <hr className="hairline-double mt-5" />

              <div className="progress-rail mt-4">
                <div className="progress-fill" style={{ width: "72%" }} />
              </div>
              <div className="row-between mt-2">
                <span className="text-xs muted">Classification progress</span>
                <span className="mono text-xs brass">72 / 100</span>
              </div>
            </div>
          </div>
        </section>

        {/* Tab bar */}
        <section className="mt-8">
          <div className="section-header">
            <span className="section-num">§ 07</span>
            <h2 className="section-title">Index tabs</h2>
            <span className="section-sub">The dossier navigator</span>
          </div>

          <div className="dossier-tabs">
            {["Calculator", "Excise", "CBAM", "T1 Transit", "Import Flow", "HS Lookup", "FX Rates", "Reference"].map((t, i) => (
              <button key={t} className={"dossier-tab" + (i === 0 ? " active" : "")}>
                {t}
              </button>
            ))}
          </div>

          <div
            className="dossier-card"
            style={{
              borderRadius: "0 var(--radius-md) var(--radius-md) var(--radius-md)",
              borderTop: "1px solid var(--rule-strong)",
              marginTop: -1,
              padding: "32px 28px",
            }}
          >
            <p className="serif italic-serif muted" style={{ fontSize: 16 }}>
              Each tab is a folio of the dossier. The brass cap distinguishes the active folio; the paper tone steps from bone (resting surface) to cream (active folio), maintaining the impression that the user has turned a physical page.
            </p>
          </div>
        </section>

        {/* Ornamental closer */}
        <footer className="mt-8 pt-5" style={{ paddingBottom: 80, textAlign: "center" }}>
          <div className="ornament">
            <span className="ornament-mark">✦</span>
          </div>
          <p className="mono text-xs muted" style={{ letterSpacing: "0.3em" }}>
            END OF SPECIMEN · VOL. XVII · FOLIO 01
          </p>
        </footer>
      </div>
    </main>
  );
}
