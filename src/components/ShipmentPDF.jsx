import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page:        { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#111827', backgroundColor: '#fff' },
  accentBar:   { backgroundColor: '#10b981', height: 4, marginBottom: 28 },
  headerBar:   { backgroundColor: '#f0f7f4', padding: '16 20', marginBottom: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 6 },
  headerLabel: { fontSize: 8, color: '#10b981', letterSpacing: 2 },
  headerTitle: { fontSize: 18, color: '#111827', fontFamily: 'Helvetica-Bold', marginTop: 3 },
  headerRight: { fontSize: 8, color: '#6b7280', textAlign: 'right' },
  sectionLabel:{ fontSize: 8, color: '#10b981', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8, marginTop: 20 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottom: '0.5 solid #e2e8f0' },
  rowLabel:    { color: '#6b7280', fontSize: 10 },
  rowValue:    { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#111827' },
  totalBox:    { backgroundColor: '#ecfdf5', padding: '14 18', marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', border: '1 solid #a7f3d0', borderRadius: 6 },
  totalLabel:  { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#111827' },
  totalValue:  { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#059669' },
  badge:       { fontSize: 8, padding: '2 6', backgroundColor: '#064e3b', color: '#34d399', borderRadius: 3 },
  badgeRed:    { fontSize: 8, padding: '2 6', backgroundColor: '#7f1d1d', color: '#fca5a5', borderRadius: 3 },
  disclaimer:  { marginTop: 32, paddingTop: 12, borderTop: '0.5 solid #e2e8f0', fontSize: 8, color: '#9ca3af', lineHeight: 1.6 },
  footer:      { position: 'absolute', bottom: 32, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#9ca3af' },
  lineItem:    { padding: '8 0', borderBottom: '0.5 solid #f1f5f9' },
  lineTitle:   { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2, color: '#111827' },
  lineDetail:  { fontSize: 9, color: '#6b7280' },
})

const fmt = (n) => `€ ${Number(n).toLocaleString('de-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function ExcisePDF({ data }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>

        <View style={styles.accentBar}/>
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.headerLabel}>LUXEMBOURG · EU CUSTOMS</Text>
            <Text style={styles.headerTitle}>Excise Duty Calculation</Text>
          </View>
          <View>
            <Text style={styles.headerRight}>{data.category}</Text>
            <Text style={styles.headerRight}>{fmtDate(data.createdAt || new Date())}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Excise Breakdown</Text>
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

        <View style={styles.footer}>
          <Text>EU Customs Calculator · dutify.lu</Text>
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

        {/* Header */}
        <View style={styles.accentBar}/>
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.headerLabel}>LUXEMBOURG · EU CUSTOMS</Text>
            <Text style={styles.headerTitle}>Import Duty Calculation</Text>
          </View>
          <View>
            <Text style={styles.headerRight}>{data.label || 'Shipment'}</Text>
            <Text style={styles.headerRight}>{fmtDate(data.createdAt || new Date())}</Text>
          </View>
        </View>

        {/* Shipment details */}
        <Text style={styles.sectionLabel}>Shipment Details</Text>
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

        {/* Line items */}
        {lines.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Goods</Text>
            {lines.map((line, i) => (
              <View key={i} style={styles.lineItem}>
                <Text style={styles.lineTitle}>{line.description || 'Item ' + (i + 1)}</Text>
                <Text style={styles.lineDetail}>
                  HS {line.hsCode || '—'} · Duty {line.dutyRate || 0}% · Value {data.currency} {line.value}
                  {line.freight ? ` · Freight ${data.currency} ${line.freight}` : ''}
                  {line.insurance ? ` · Insurance ${data.currency} ${line.insurance}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Duty breakdown */}
        <Text style={styles.sectionLabel}>Duty Breakdown</Text>
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

        {/* Total */}
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total Landed Cost</Text>
          <Text style={styles.totalValue}>{fmt(data.total)}</Text>
        </View>

        {/* Notes */}
        {data.notes && (
          <>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={{ fontSize: 10, color: '#444', lineHeight: 1.5 }}>{data.notes}</Text>
          </>
        )}

        {/* Disclaimer */}
        <Text style={styles.disclaimer}>
          This document is an estimate only and is not a substitute for an official customs declaration. Actual duties and taxes are determined by the Administration des Douanes et Accises (Luxembourg) at the time of import. Always verify HS codes and applicable rates in the EU TARIC database before filing. Exchange rates are ECB reference rates and may differ from rates applied by customs authorities.
        </Text>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>EU Customs Calculator · dutify.lu</Text>
          <Text>Generated {fmtDate(new Date())}</Text>
        </View>

      </Page>
    </Document>
  )
}
