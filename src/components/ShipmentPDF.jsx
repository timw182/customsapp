import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page:        { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1a1a1a', backgroundColor: '#fff' },
  headerBar:   { backgroundColor: '#0e0e0e', padding: '16 24', marginBottom: 32, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLabel: { fontSize: 8, color: '#c8a96e', letterSpacing: 2 },
  headerTitle: { fontSize: 18, color: '#e8e0d0', fontFamily: 'Helvetica', marginTop: 2 },
  headerRight: { fontSize: 8, color: '#888', textAlign: 'right' },
  sectionLabel:{ fontSize: 8, color: '#999', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8, marginTop: 20 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottom: '0.5 solid #eeeeee' },
  rowLabel:    { color: '#666', fontSize: 10 },
  rowValue:    { fontFamily: 'Helvetica-Bold', fontSize: 10 },
  totalBox:    { backgroundColor: '#f9f6f0', padding: '12 16', marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', border: '1 solid #e8dcc8' },
  totalLabel:  { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  totalValue:  { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#8a6f3e' },
  badge:       { fontSize: 8, padding: '2 6', backgroundColor: '#1a2e1a', color: '#6bc26b', borderRadius: 2 },
  badgeRed:    { fontSize: 8, padding: '2 6', backgroundColor: '#2e1a1a', color: '#c26b6b', borderRadius: 2 },
  disclaimer:  { marginTop: 32, paddingTop: 12, borderTop: '0.5 solid #ddd', fontSize: 8, color: '#aaa', lineHeight: 1.6 },
  footer:      { position: 'absolute', bottom: 32, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: '#bbb' },
  lineItem:    { padding: '8 0', borderBottom: '0.5 solid #f0f0f0' },
  lineTitle:   { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  lineDetail:  { fontSize: 9, color: '#888' },
})

const fmt = (n) => `€ ${Number(n).toLocaleString('de-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d) => new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' })

export function ShipmentPDF({ data }) {
  const lines = typeof data.lines === 'string' ? JSON.parse(data.lines) : (data.lines || [])
  const dutyFree = data.cifEUR <= 150

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
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
          <Text style={styles.rowLabel}>
            Customs Duty {dutyFree ? '(waived — CIF ≤ €150)' : ''}
          </Text>
          <Text style={styles.rowValue}>{fmt(data.customsDuty)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Import VAT Luxembourg (17%)</Text>
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
          <Text>EU Customs Calculator · customs.bluebrick.cloud</Text>
          <Text>Generated {fmtDate(new Date())}</Text>
        </View>

      </Page>
    </Document>
  )
}
