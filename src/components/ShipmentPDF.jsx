import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// Dossier palette — mirrored from globals.css as JS constants because
// @react-pdf/renderer does not read CSS variables.
const PAL = {
  paperBone:      '#F5F1E8',
  paperCream:     '#FBF8F0',
  paperEdge:      '#EDE6D3',
  inkForest:      '#1F3B2D',
  inkForestDeep:  '#14281E',
  inkMuted:       '#5A6B5F',
  inkFaint:       '#8A9188',
  brass:          '#B8914A',
  brassDeep:      '#8A6A33',
  brassSoft:      '#D9BE83',
  oxblood:        '#6B2C2C',
  ruleHair:       '#D4C9A8',
  ruleStrong:     '#9A8B5E',
  ruleSoft:       '#E4DCC4',
}

// Fonts: react-pdf ships Helvetica / Times-Roman / Courier built-in. Using them
// sidesteps the flaky Font.register + remote TTF fetch path. Times-Roman stands
// in for Fraunces (serif display), Helvetica for DM Sans (body), Courier for
// JetBrains Mono (tabular numerics). The dossier aesthetic survives via the
// palette, hairline rules, § section numbers, brass stamp, and cream paper.
const F = {
  display:     'Times-Roman',
  displayBold: 'Times-Bold',
  displayItalic:'Times-Italic',
  body:        'Helvetica',
  bodyBold:    'Helvetica-Bold',
  mono:        'Courier',
  monoBold:    'Courier-Bold',
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    paddingBottom: 72,
    fontFamily: F.body,
    fontSize: 10,
    color: PAL.inkForestDeep,
    backgroundColor: PAL.paperCream,
  },
  brassRail: {
    backgroundColor: PAL.brass,
    height: 3,
    marginBottom: 24,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingBottom: 18,
    borderBottom: `1 solid ${PAL.ruleHair}`,
  },
  brand: {
    fontFamily: F.display,
    fontSize: 26,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    letterSpacing: -0.4,
  },
  eyebrow: {
    fontSize: 8,
    color: PAL.brassDeep,
    letterSpacing: 2.2,
    fontFamily: F.mono,
    fontWeight: 500,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontFamily: F.display,
    fontSize: 20,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    marginTop: 4,
    letterSpacing: -0.2,
  },
  headerRight: {
    fontSize: 9,
    color: PAL.inkMuted,
    textAlign: 'right',
    fontFamily: F.mono,
    letterSpacing: 0.6,
  },
  folio: {
    fontSize: 8,
    color: PAL.brassDeep,
    fontFamily: F.mono,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 8,
    color: PAL.brassDeep,
    letterSpacing: 2,
    fontFamily: F.mono,
    fontWeight: 500,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 22,
    paddingBottom: 4,
    borderBottom: `0.5 solid ${PAL.ruleHair}`,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottom: `0.5 solid ${PAL.ruleSoft}`,
  },
  rowLabel: {
    color: PAL.inkMuted,
    fontSize: 10,
    fontFamily: F.body,
  },
  rowValue: {
    fontFamily: F.mono,
    fontWeight: 500,
    fontSize: 10,
    color: PAL.inkForestDeep,
  },
  totalBox: {
    backgroundColor: '#F6EFDB', // brass-wash
    padding: '16 20',
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    border: `1 solid ${PAL.brass}`,
    borderRadius: 2,
  },
  totalLabel: {
    fontSize: 11,
    fontFamily: F.display,
    fontWeight: 500,
    color: PAL.inkForestDeep,
  },
  totalValue: {
    fontSize: 22,
    fontFamily: F.monoBold,
    color: PAL.inkForestDeep,
    letterSpacing: 0.4,
  },
  lineItem: {
    padding: '9 0',
    borderBottom: `0.5 solid ${PAL.ruleSoft}`,
  },
  lineTitle: {
    fontSize: 11,
    fontFamily: F.display,
    fontWeight: 500,
    marginBottom: 3,
    color: PAL.inkForestDeep,
  },
  lineDetail: {
    fontSize: 9,
    color: PAL.inkMuted,
    fontFamily: F.mono,
    letterSpacing: 0.3,
  },
  disclaimer: {
    marginTop: 28,
    paddingTop: 14,
    borderTop: `0.5 solid ${PAL.ruleHair}`,
    fontSize: 8,
    color: PAL.inkMuted,
    lineHeight: 1.65,
    fontFamily: F.displayItalic,
  },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: PAL.inkMuted,
    fontFamily: F.mono,
    letterSpacing: 0.8,
    paddingTop: 10,
    borderTop: `0.5 solid ${PAL.ruleHair}`,
  },
  stamp: {
    fontSize: 8,
    padding: '3 8',
    color: PAL.brassDeep,
    border: `1 solid ${PAL.brass}`,
    borderRadius: 1,
    fontFamily: F.mono,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: 500,
  },
})

const fmt = (n) => `€ ${Number(n).toLocaleString('de-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' })

function Masthead({ title, subtitle, rightLabel, rightDate }) {
  return (
    <View>
      <View style={styles.brassRail} />
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.eyebrow}>Grand-Duché de Luxembourg · EU Customs</Text>
          <Text style={styles.brand}>Dutify<Text style={{ color: PAL.brass }}>.</Text></Text>
          <Text style={styles.headerTitle}>{title}</Text>
          {subtitle && <Text style={{ ...styles.eyebrow, marginTop: 8 }}>{subtitle}</Text>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {rightLabel && <Text style={styles.stamp}>{rightLabel}</Text>}
          <Text style={{ ...styles.headerRight, marginTop: 8 }}>{rightDate}</Text>
          <Text style={styles.folio}>Folio · {String(new Date().getTime()).slice(-6)}</Text>
        </View>
      </View>
    </View>
  )
}

export function ExcisePDF({ data }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Masthead
          title="Excise Duty Calculation"
          subtitle={data.category}
          rightLabel={'Draft'}
          rightDate={fmtDate(data.createdAt || new Date())}
        />

        <Text style={styles.sectionLabel}>§ 01  Excise Breakdown</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Category</Text>
          <Text style={styles.rowValue}>{data.category}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Excise Duty (LU){data.exciseNote ? `  —  ${data.exciseNote}` : ''}</Text>
          <Text style={styles.rowValue}>{fmt(data.exciseDuty)}</Text>
        </View>
        {data.cifVal > 0 && (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Declared Goods Value (CIF)</Text>
            <Text style={styles.rowValue}>{fmt(data.cifVal)}</Text>
          </View>
        )}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Import VAT Luxembourg ({data.vatRate}% on {data.cifVal > 0 ? 'goods + excise' : 'excise'})</Text>
          <Text style={styles.rowValue}>{fmt(data.importVAT)}</Text>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total Excise + VAT</Text>
          <Text style={styles.totalValue}>{fmt(data.total)}</Text>
        </View>

        <Text style={styles.disclaimer}>
          This document is an estimate only. Excise duty rates are sourced from the Administration des Douanes et Accises (ADA) Luxembourg, effective 01.01.2026. Actual duties are determined by ADA at the time of release for consumption. Always verify current rates at douanes.public.lu before filing.
        </Text>

        <View style={styles.footer} fixed>
          <Text>dutify.lu  ·  EU customs ledger</Text>
          <Text>Generated {fmtDate(new Date())}</Text>
        </View>
      </Page>
    </Document>
  )
}

export function ShipmentPDF({ data }) {
  const lines = typeof data.lines === 'string' ? JSON.parse(data.lines) : (data.lines || [])
  const dutyFree = data.cifEUR <= 150

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Masthead
          title="Import Duty Calculation"
          subtitle={data.label || 'Shipment'}
          rightLabel={dutyFree ? 'De Minimis' : 'Cleared'}
          rightDate={fmtDate(data.createdAt || new Date())}
        />

        <Text style={styles.sectionLabel}>§ 01  Shipment Details</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Origin Country</Text>
          <Text style={styles.rowValue}>{data.originCountry}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Incoterm</Text>
          <Text style={styles.rowValue}>{data.incoterm}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Currency</Text>
          <Text style={styles.rowValue}>{data.currency} (1 {data.currency} = {Number(data.exchangeRate).toFixed(5)} EUR · {data.rateDate})</Text>
        </View>

        {lines.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>§ 02  Goods</Text>
            {lines.map((line, i) => (
              <View key={i} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{line.description || 'Item ' + (i + 1)}</Text>
                <Text style={styles.lineDetail}>
                  HS {line.hsCode || '—'}  ·  Duty {line.dutyRate || 0}%  ·  Value {data.currency} {line.value}
                  {line.freight ? `  ·  Freight ${data.currency} ${line.freight}` : ''}
                  {line.insurance ? `  ·  Insurance ${data.currency} ${line.insurance}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>§ {lines.length > 0 ? '03' : '02'}  Duty Breakdown</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>CIF Value (customs base)</Text>
          <Text style={styles.rowValue}>{fmt(data.cifEUR)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Customs Duty {dutyFree ? '(waived — CIF ≤ €150)' : ''}</Text>
          <Text style={styles.rowValue}>{fmt(data.customsDuty)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Import VAT Luxembourg (17% on CIF + duties)</Text>
          <Text style={styles.rowValue}>{fmt(data.importVAT)}</Text>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total Landed Cost</Text>
          <Text style={styles.totalValue}>{fmt(data.total)}</Text>
        </View>

        {data.notes && (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={{ fontSize: 10, color: PAL.inkForest, lineHeight: 1.55, fontFamily: F.display }}>{data.notes}</Text>
          </>
        )}

        <Text style={styles.disclaimer}>
          This document is an estimate only and is not a substitute for an official customs declaration. Actual duties and taxes are determined by the Administration des Douanes et Accises (Luxembourg) at the time of import. Always verify HS codes and applicable rates in the EU TARIC database before filing. Exchange rates are ECB reference rates and may differ from rates applied by customs authorities.
        </Text>

        <View style={styles.footer} fixed>
          <Text>dutify.lu  ·  EU customs ledger</Text>
          <Text>Generated {fmtDate(new Date())}</Text>
        </View>
      </Page>
    </Document>
  )
}
