import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// Self-contained dossier styling — mirrors ShipmentPDF.jsx (the palette/fonts are
// duplicated rather than imported so the two documents can evolve independently;
// a shared pdf-kit could be factored out later if a third document appears).
const PAL = {
  paperCream:    '#FBF8F0',
  inkForest:     '#1F3B2D',
  inkForestDeep: '#14281E',
  inkMuted:      '#5A6B5F',
  inkFaint:      '#8A9188',
  brass:         '#B8914A',
  brassDeep:     '#8A6A33',
  oxblood:       '#6B2C2C',
  oxbloodWash:   '#F4E7E4',
  ruleHair:      '#D4C9A8',
  ruleSoft:      '#E4DCC4',
  brassWash:     '#F6EFDB',
}

// react-pdf ships these built-in (no remote TTF fetch): Times for serif display,
// Helvetica for body, Courier for tabular codes/numerics.
const F = {
  display:       'Times-Roman',
  displayBold:   'Times-Bold',
  displayItalic: 'Times-Italic',
  body:          'Helvetica',
  bodyBold:      'Helvetica-Bold',
  mono:          'Courier',
  monoBold:      'Courier-Bold',
}

const styles = StyleSheet.create({
  page: { padding: 48, paddingBottom: 72, fontFamily: F.body, fontSize: 10, color: PAL.inkForestDeep, backgroundColor: PAL.paperCream },
  brassRail: { backgroundColor: PAL.brass, height: 3, marginBottom: 24 },
  headerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, paddingBottom: 18, borderBottom: `1 solid ${PAL.ruleHair}` },
  eyebrow: { fontSize: 8, color: PAL.brassDeep, letterSpacing: 2.2, fontFamily: F.mono, marginBottom: 6, textTransform: 'uppercase' },
  brand: { fontFamily: F.display, fontSize: 26, color: PAL.inkForestDeep, letterSpacing: -0.4 },
  headerTitle: { fontFamily: F.display, fontSize: 20, color: PAL.inkForestDeep, marginTop: 4, letterSpacing: -0.2 },
  headerRight: { fontSize: 9, color: PAL.inkMuted, textAlign: 'right', fontFamily: F.mono, letterSpacing: 0.6 },
  folio: { fontSize: 8, color: PAL.brassDeep, fontFamily: F.mono, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: 10 },
  stamp: { fontSize: 8, padding: '3 8', color: PAL.brassDeep, border: `1 solid ${PAL.brass}`, borderRadius: 1, fontFamily: F.mono, letterSpacing: 1.4, textTransform: 'uppercase' },
  stampGreen: { color: '#2F6B3A', border: '1 solid #5E9A6A' },
  stampAmber: { color: PAL.brassDeep, border: `1 solid ${PAL.brass}` },

  sectionLabel: { fontSize: 8, color: PAL.brassDeep, letterSpacing: 2, fontFamily: F.mono, textTransform: 'uppercase', marginBottom: 10, marginTop: 22, paddingBottom: 4, borderBottom: `0.5 solid ${PAL.ruleHair}` },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottom: `0.5 solid ${PAL.ruleSoft}` },
  rowLabel: { color: PAL.inkMuted, fontSize: 10, fontFamily: F.body, maxWidth: '62%' },
  rowValue: { fontFamily: F.mono, fontSize: 10, color: PAL.inkForestDeep, textAlign: 'right' },

  // classification code pyramid
  codeBox: { backgroundColor: PAL.brassWash, padding: '16 20', marginTop: 4, border: `1 solid ${PAL.brass}`, borderRadius: 2 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  codeTier: { fontSize: 8, color: PAL.brassDeep, fontFamily: F.mono, letterSpacing: 1.4, textTransform: 'uppercase' },
  codeHs6: { fontFamily: F.monoBold, fontSize: 13, color: PAL.inkForest },
  codeCn8: { fontFamily: F.monoBold, fontSize: 15, color: PAL.inkForest },
  codeCn10: { fontFamily: F.monoBold, fontSize: 20, color: PAL.inkForestDeep, letterSpacing: 0.6 },
  taricDesc: { fontSize: 10, color: PAL.inkForest, fontFamily: F.display, marginTop: 10, lineHeight: 1.4 },

  confidenceTag: { fontSize: 9, fontFamily: F.monoBold, color: PAL.inkForestDeep },

  bodyText: { fontSize: 10, color: PAL.inkForest, lineHeight: 1.6, fontFamily: F.display },
  altItem: { padding: '8 0', borderBottom: `0.5 solid ${PAL.ruleSoft}` },
  altHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  altCode: { fontFamily: F.monoBold, fontSize: 10, color: PAL.inkForest },
  altPct: { fontFamily: F.mono, fontSize: 9, color: PAL.inkMuted },
  altReason: { fontSize: 9, color: PAL.inkMuted, fontFamily: F.body, lineHeight: 1.45 },

  link: { fontSize: 9, color: PAL.brassDeep, fontFamily: F.mono },

  warnBox: { backgroundColor: PAL.oxbloodWash, padding: '12 16', marginTop: 6, border: `1 solid ${PAL.oxblood}`, borderRadius: 2 },
  warnCat: { fontSize: 10, fontFamily: F.bodyBold, color: PAL.oxblood, marginBottom: 4 },
  warnText: { fontSize: 9, color: PAL.inkForestDeep, lineHeight: 1.5, marginBottom: 4 },
  warnMeta: { fontSize: 8, color: PAL.inkMuted, fontFamily: F.mono, lineHeight: 1.5 },

  disclaimer: { marginTop: 28, paddingTop: 14, borderTop: `0.5 solid ${PAL.ruleHair}`, fontSize: 8, color: PAL.inkMuted, lineHeight: 1.65, fontFamily: F.displayItalic },
  footer: { position: 'absolute', bottom: 32, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: PAL.inkMuted, fontFamily: F.mono, letterSpacing: 0.8, paddingTop: 10, borderTop: `0.5 solid ${PAL.ruleHair}` },
})

const fmtDate = (d) => new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' })

// Group a digit string into the customs convention: 4 + pairs → "8517 13 00 00".
function grouped(code) {
  const d = String(code || '').replace(/\D/g, '')
  if (d.length <= 4) return d
  return d.slice(0, 4) + ' ' + (d.slice(4).match(/.{1,2}/g) || []).join(' ')
}

function Masthead({ title, subtitle, rightLabel, rightStampStyle, rightDate, docRef }) {
  return (
    <View>
      <View style={styles.brassRail} />
      <View style={styles.headerBar}>
        <View style={{ maxWidth: '64%' }}>
          <Text style={styles.eyebrow}>Grand-Duché de Luxembourg · EU Customs</Text>
          <Text style={styles.brand}>Dutify<Text style={{ color: PAL.brass }}>.</Text></Text>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle ? <Text style={{ ...styles.eyebrow, marginTop: 8 }}>{subtitle}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {rightLabel ? <Text style={{ ...styles.stamp, ...(rightStampStyle || {}) }}>{rightLabel}</Text> : null}
          <Text style={{ ...styles.headerRight, marginTop: 8 }}>{rightDate}</Text>
          {docRef ? <Text style={styles.folio}>Ref · {docRef}</Text> : null}
        </View>
      </View>
    </View>
  )
}

// data = {
//   inputDescription, shortLabel, hs6, cn8, cn10, taricDescription,
//   confidencePct, model, rationale,
//   alternatives: [{ code, label, confidencePct, reasoning }],
//   taricVerified, taricWarning, dutyRateRaw, saturnUrl, sensitiveGoods,
//   nomenclatureVersion, ref, generatedAt,
// }
export function ClassificationDossierPDF({ data }) {
  const verified = data.taricVerified === true
  const code = data.cn10 || data.cn8 || data.hs6 || ''
  const alts = Array.isArray(data.alternatives) ? data.alternatives.filter((a) => a && (a.code || a.hs6)) : []
  const sg = data.sensitiveGoods
  let sectionNo = 0
  const sec = () => String(++sectionNo).padStart(2, '0')

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Masthead
          title="Classification Dossier"
          subtitle={data.shortLabel || (data.inputDescription || '').slice(0, 72)}
          rightLabel={verified ? 'Verified' : 'Advisory'}
          rightStampStyle={verified ? styles.stampGreen : styles.stampAmber}
          rightDate={fmtDate(data.generatedAt || new Date())}
          docRef={data.ref}
        />

        {/* Subject goods */}
        <Text style={styles.sectionLabel}>§ {sec()}  Subject Goods</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Description (as submitted)</Text>
          <Text style={{ ...styles.rowValue, maxWidth: '60%' }}>{data.inputDescription || '—'}</Text>
        </View>
        {data.shortLabel ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Short label</Text>
            <Text style={styles.rowValue}>{data.shortLabel}</Text>
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Nomenclature in force</Text>
          <Text style={styles.rowValue}>{data.nomenclatureVersion || 'CN 2026 / HS 2022'}</Text>
        </View>

        {/* Classification */}
        <Text style={styles.sectionLabel}>§ {sec()}  Classification</Text>
        <View style={styles.codeBox}>
          {data.hs6 ? (
            <View style={styles.codeRow}>
              <Text style={styles.codeTier}>HS subheading</Text>
              <Text style={styles.codeHs6}>{grouped(data.hs6)}</Text>
            </View>
          ) : null}
          {data.cn8 ? (
            <View style={styles.codeRow}>
              <Text style={styles.codeTier}>CN8</Text>
              <Text style={styles.codeCn8}>{grouped(data.cn8)}</Text>
            </View>
          ) : null}
          <View style={styles.codeRow}>
            <Text style={styles.codeTier}>{data.cn10 ? 'CN10 / TARIC' : 'Code'}</Text>
            <Text style={styles.codeCn10}>{grouped(code)}</Text>
          </View>
          {data.taricDescription ? <Text style={styles.taricDesc}>{data.taricDescription}</Text> : null}
        </View>
        <View style={{ ...styles.row, marginTop: 8 }}>
          <Text style={styles.rowLabel}>Confidence</Text>
          <Text style={styles.confidenceTag}>
            {typeof data.confidencePct === 'number' ? `${data.confidencePct}%` : '—'}
            {data.model ? `   ·   ${String(data.model).toUpperCase()}` : ''}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>TARIC verification</Text>
          <Text style={styles.rowValue}>{verified ? 'Verified against EU TARIC' : (data.taricWarning ? 'Not verified' : 'Not checked')}</Text>
        </View>

        {/* Basis & reasoning */}
        {data.rationale ? (
          <>
            <Text style={styles.sectionLabel}>§ {sec()}  Basis of Classification</Text>
            <Text style={styles.bodyText}>{data.rationale}</Text>
          </>
        ) : null}

        {/* Alternatives considered */}
        {alts.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>§ {sec()}  Alternatives Considered</Text>
            {alts.map((a, i) => (
              <View key={i} style={styles.altItem}>
                <View style={styles.altHead}>
                  <Text style={styles.altCode}>{grouped(a.code || a.hs6)}{a.label ? `  ·  ${a.label}` : ''}</Text>
                  <Text style={styles.altPct}>{typeof a.confidencePct === 'number' ? `${a.confidencePct}%` : ''}</Text>
                </View>
                {a.reasoning ? <Text style={styles.altReason}>{a.reasoning}</Text> : null}
              </View>
            ))}
          </>
        ) : null}

        {/* TARIC evidence */}
        <Text style={styles.sectionLabel}>§ {sec()}  TARIC Evidence</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Third-country (MFN) duty rate</Text>
          <Text style={styles.rowValue}>{data.dutyRateRaw || '—'}</Text>
        </View>
        {data.taricWarning ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Verification note</Text>
            <Text style={{ ...styles.rowValue, maxWidth: '60%', color: PAL.oxblood }}>{data.taricWarning}</Text>
          </View>
        ) : null}
        {data.saturnUrl ? (
          <View style={{ paddingVertical: 7 }}>
            <Text style={{ ...styles.rowLabel, marginBottom: 3 }}>Official verification (Luxembourg ADA / Saturn)</Text>
            <Text style={styles.link}>{data.saturnUrl}</Text>
          </View>
        ) : null}

        {/* Sensitive / controlled goods */}
        {sg ? (
          <>
            <Text style={styles.sectionLabel}>§ {sec()}  Controlled / Sensitive Goods</Text>
            <View style={styles.warnBox}>
              <Text style={styles.warnCat}>{sg.category || 'Restricted goods'}</Text>
              {sg.warning ? <Text style={styles.warnText}>{sg.warning}</Text> : null}
              {sg.licenceAuthority ? <Text style={styles.warnMeta}>Authority: {sg.licenceAuthority}</Text> : null}
              {Array.isArray(sg.regulations) && sg.regulations.length ? <Text style={styles.warnMeta}>Regulations: {sg.regulations.join(' · ')}</Text> : null}
              {sg.consequences ? <Text style={{ ...styles.warnMeta, color: PAL.oxblood }}>{sg.consequences}</Text> : null}
            </View>
          </>
        ) : null}

        <Text style={styles.disclaimer}>
          This dossier records an AI-assisted classification and the reasoning behind it for due-diligence and audit purposes. It is advisory and is NOT a Binding Tariff Information (BTI) decision: it does not bind customs authorities. For legally binding certainty, apply for a BTI via the EU Customs Trader Portal. Duty rates and nomenclature are sourced from the EU TARIC database for the version stated above and may change; verify the code and rate in TARIC / on the Saturn link before filing a customs declaration.
        </Text>

        <View style={styles.footer} fixed>
          <Text>dutify.lu  ·  classification dossier</Text>
          <Text>Generated {fmtDate(data.generatedAt || new Date())}{data.ref ? `  ·  ${data.ref}` : ''}</Text>
        </View>
      </Page>
    </Document>
  )
}

// Pre-filled EU Binding Tariff Information (BTI) application draft. Shares the
// dossier's data shape; `data.applicant` carries the user's known details and
// the rest are left as fill-in lines.
export function BtiApplicationPDF({ data }) {
  const ap = data.applicant || {}
  const code = data.cn8 || data.cn10 || data.hs6 || ''
  const Line = ({ label, value }) => (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={{ ...styles.rowValue, maxWidth: '60%', color: value ? PAL.inkForestDeep : PAL.inkFaint }}>
        {value || '____________________________'}
      </Text>
    </View>
  )
  const Check = ({ children }) => (
    <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 3 }}>
      <Text style={{ fontFamily: F.mono, color: PAL.brassDeep }}>[ ]</Text>
      <Text style={{ ...styles.bodyText, fontSize: 9.5, flex: 1 }}>{children}</Text>
    </View>
  )
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Masthead
          title="Binding Tariff Information"
          subtitle="Draft application — submit via the EU Customs Trader Portal"
          rightLabel="Draft"
          rightStampStyle={styles.stampAmber}
          rightDate={fmtDate(data.generatedAt || new Date())}
          docRef={data.ref}
        />

        <Text style={styles.bodyText}>
          This is a prepared draft to help you apply for a Binding Tariff Information (BTI) decision — a free EU ruling
          that fixes your goods' classification for three years. Review and complete the fields below, then file it
          through the EU Customs Trader Portal. It is not an application until you submit it.
        </Text>

        <Text style={styles.sectionLabel}>§ 01  Applicant / Holder</Text>
        <Line label="Name" value={ap.name} />
        <Line label="Company" value={ap.company} />
        <Line label="Email" value={ap.email} />
        <Line label="EORI number" value={null} />
        <Line label="Address" value={null} />

        <Text style={styles.sectionLabel}>§ 02  Goods Description</Text>
        <Text style={styles.bodyText}>{data.inputDescription || '—'}</Text>
        {data.taricDescription ? (
          <Text style={{ ...styles.bodyText, marginTop: 6, color: PAL.inkMuted }}>
            TARIC reference description: {data.taricDescription}
          </Text>
        ) : null}

        <Text style={styles.sectionLabel}>§ 03  Envisaged Classification</Text>
        <View style={styles.codeBox}>
          <View style={styles.codeRow}>
            <Text style={styles.codeTier}>Envisaged code</Text>
            <Text style={styles.codeCn8}>{grouped(code)}</Text>
          </View>
          {data.taricDescription ? <Text style={styles.taricDesc}>{data.taricDescription}</Text> : null}
        </View>

        {data.rationale ? (
          <>
            <Text style={styles.sectionLabel}>§ 04  Justification</Text>
            <Text style={styles.bodyText}>{data.rationale}</Text>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>§ 05  Supporting Documents to Attach</Text>
        <Check>Clear photographs of the goods (all relevant sides and labels)</Check>
        <Check>Technical data sheet or product specification</Check>
        <Check>Composition / materials breakdown (% by weight where relevant)</Check>
        <Check>Brochures, catalogues or manufacturer documentation</Check>
        <Check>Laboratory analysis, where classification depends on it</Check>
        <Check>A sample, if the customs authority requests one</Check>

        <Text style={styles.sectionLabel}>§ 06  How to Submit</Text>
        <Text style={styles.bodyText}>
          File via the EU Customs Trader Portal (eBTI). You will need an EORI number and an EU Login. A BTI decision is
          normally issued within 120 days and is binding across all EU member states for three years.
        </Text>
        <Text style={{ ...styles.link, marginTop: 6 }}>https://customs.ec.europa.eu/gtp/</Text>

        <Text style={styles.disclaimer}>
          Dutify prepared this draft from an AI-assisted classification to speed up your BTI application. It is not legal
          advice and is neither a submitted application nor a customs decision. The envisaged code and justification are
          your proposal to the customs authority, which makes the binding determination.
        </Text>

        <View style={styles.footer} fixed>
          <Text>dutify.lu  ·  BTI draft application</Text>
          <Text>Prepared {fmtDate(data.generatedAt || new Date())}{data.ref ? `  ·  ${data.ref}` : ''}</Text>
        </View>
      </Page>
    </Document>
  )
}
