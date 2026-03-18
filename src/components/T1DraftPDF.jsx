import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const s = StyleSheet.create({
  page:       { padding: 44, fontFamily: 'Helvetica', fontSize: 9, color: '#111827', backgroundColor: '#fff' },
  accentBar:  { backgroundColor: '#1d4ed8', height: 4, marginBottom: 20 },
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  headerLeft: {},
  tag:        { fontSize: 7, color: '#1d4ed8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 3 },
  title:      { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#111827' },
  subtitle:   { fontSize: 9, color: '#6b7280', marginTop: 2 },
  headerRight:{ textAlign: 'right' },
  mrnBox:     { backgroundColor: '#eff6ff', border: '1 solid #bfdbfe', borderRadius: 4, padding: '8 12', marginBottom: 20 },
  mrnLabel:   { fontSize: 7, color: '#1d4ed8', letterSpacing: 2, marginBottom: 2 },
  mrnValue:   { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#1e3a8a' },
  draftWmark: { fontSize: 7, color: '#9ca3af', marginTop: 2 },
  secLabel:   { fontSize: 7, color: '#1d4ed8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6, marginTop: 14, fontFamily: 'Helvetica-Bold' },
  grid:       { flexDirection: 'row', gap: 8, marginBottom: 4 },
  cell:       { flex: 1, backgroundColor: '#f8fafc', border: '0.5 solid #e2e8f0', borderRadius: 3, padding: '6 8' },
  cellLabel:  { fontSize: 7, color: '#6b7280', marginBottom: 2 },
  cellValue:  { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#111827' },
  row:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottom: '0.5 solid #f1f5f9' },
  rowLabel:   { color: '#6b7280', fontSize: 8.5 },
  rowValue:   { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: '#111827' },
  itemBox:    { backgroundColor: '#f8fafc', border: '0.5 solid #e2e8f0', borderRadius: 3, padding: '7 10', marginBottom: 6 },
  itemTitle:  { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#111827', marginBottom: 4 },
  itemRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  itemKV:     { fontSize: 8 },
  itemKey:    { color: '#6b7280' },
  itemVal:    { fontFamily: 'Helvetica-Bold', color: '#111827' },
  warnBox:    { backgroundColor: '#fef9c3', border: '0.5 solid #fde047', borderRadius: 3, padding: '6 10', marginTop: 12, marginBottom: 4 },
  warnText:   { fontSize: 7.5, color: '#713f12' },
  disclaimer: { marginTop: 20, paddingTop: 8, borderTop: '0.5 solid #e2e8f0', fontSize: 7, color: '#9ca3af', lineHeight: 1.6 },
  footer:     { position: 'absolute', bottom: 28, left: 44, right: 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#9ca3af' },
})

const val = (v, fallback = '—') => (v && String(v).trim()) ? String(v).trim() : fallback
const fmtDate = (d) => new Date(d).toLocaleDateString('de-LU', { day: '2-digit', month: '2-digit', year: 'numeric' })

function Field({ label, value, flex }) {
  return (
    <View style={[s.cell, flex ? { flex } : {}]}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue}>{val(value)}</Text>
    </View>
  )
}

function Section({ label }) {
  return <Text style={s.secLabel}>{label}</Text>
}

export function T1DraftPDF({ data }) {
  const now = new Date()
  const items = data.items || []

  return (
    <Document>
      <Page size="A4" style={s.page}>

        <View style={s.accentBar} />

        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.tag}>EU Customs · Transit</Text>
            <Text style={s.title}>T1 Transit Declaration</Text>
            <Text style={s.subtitle}>Common External Transit — Draft</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={{ fontSize: 8, color: '#6b7280' }}>Generated: {fmtDate(now)}</Text>
            <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>dutify.lu</Text>
          </View>
        </View>

        {/* MRN placeholder */}
        <View style={s.mrnBox}>
          <Text style={s.mrnLabel}>Movement Reference Number (MRN)</Text>
          <Text style={s.mrnValue}>{val(data.mrn, 'To be assigned by DVA/NCTS upon submission')}</Text>
          <Text style={s.draftWmark}>⚠ DRAFT — Not submitted to NCTS/DVA. For preparation purposes only.</Text>
        </View>

        {/* Declaration type + offices */}
        <Section label="Declaration" />
        <View style={s.grid}>
          <Field label="Declaration Type" value="T1 — External Transit" />
          <Field label="Date of Declaration" value={val(data.declarationDate, fmtDate(now))} />
          <Field label="Transport Mode" value={val(data.transportMode)} />
        </View>
        <View style={s.grid}>
          <Field label="Office of Departure" value={`${val(data.officeOfDeparture)}${data.officeOfDepartureCode ? ` (${data.officeOfDepartureCode})` : ''}`} />
          <Field label="Office of Destination" value={`${val(data.officeOfDestination)}${data.officeOfDestinationCode ? ` (${data.officeOfDestinationCode})` : ''}`} />
        </View>

        {/* Principal */}
        <Section label="Principal (Declarant)" />
        <View style={s.grid}>
          <Field label="Name" value={data.principalName} flex={2} />
          <Field label="EORI" value={data.principalEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.principalStreet)}, ${val(data.principalCity)} ${val(data.principalPostcode)}, ${val(data.principalCountry)}`} flex={2} />
        </View>

        {/* Consignor */}
        <Section label="Consignor (Sender)" />
        <View style={s.grid}>
          <Field label="Name" value={data.consignorName} flex={2} />
          <Field label="EORI" value={data.consignorEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.consignorStreet)}, ${val(data.consignorCity)} ${val(data.consignorPostcode)}, ${val(data.consignorCountry)}`} flex={2} />
        </View>

        {/* Consignee */}
        <Section label="Consignee (Recipient)" />
        <View style={s.grid}>
          <Field label="Name" value={data.consigneeName} flex={2} />
          <Field label="EORI" value={data.consigneeEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.consigneeStreet)}, ${val(data.consigneeCity)} ${val(data.consigneePostcode)}, ${val(data.consigneeCountry)}`} flex={2} />
        </View>

        {/* Transport */}
        <Section label="Transport Details" />
        <View style={s.grid}>
          <Field label="Carrier / Transport Co." value={data.carrier} />
          <Field label="Vehicle / Convoy No." value={data.vehicleId} />
          <Field label="Container No." value={data.containerNumber} />
        </View>
        <View style={s.grid}>
          <Field label="Seal Number(s)" value={data.sealNumbers} />
          <Field label="Country of Dispatch" value={data.countryOfDispatch} />
          <Field label="CMR / AWB / B/L Ref." value={data.transportDocRef} />
        </View>

        {/* Guarantee */}
        <Section label="Guarantee" />
        <View style={s.grid}>
          <Field label="Guarantee Type" value={data.guaranteeType} />
          <Field label="Guarantee Reference" value={data.guaranteeRef} />
          <Field label="Access Code" value={data.guaranteeAccessCode} />
        </View>

        {/* Goods */}
        <Section label={`Goods (${items.length} item${items.length !== 1 ? 's' : ''})`} />
        {items.map((item, i) => (
          <View key={i} style={s.itemBox}>
            <Text style={s.itemTitle}>Item {i + 1} — {val(item.description)}</Text>
            <View style={s.itemRow}>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>HS Code: </Text><Text style={s.itemVal}>{val(item.hsCode)}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Origin: </Text><Text style={s.itemVal}>{val(item.countryOfOrigin)}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Packages: </Text><Text style={s.itemVal}>{val(item.packages)} {val(item.packageType, '')}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Gross Weight: </Text><Text style={s.itemVal}>{val(item.grossWeight)} kg</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Value: </Text><Text style={s.itemVal}>{val(item.value)} {val(item.currency, 'EUR')}</Text></Text></View>
            </View>
          </View>
        ))}

        {/* Totals */}
        <Section label="Totals" />
        <View style={s.grid}>
          <Field label="Total Packages" value={items.reduce((a, it) => a + (parseInt(it.packages) || 0), 0) || '—'} />
          <Field label="Total Gross Weight" value={items.reduce((a, it) => a + (parseFloat(it.grossWeight) || 0), 0).toFixed(2) + ' kg'} />
          <Field label="Total Value" value={items.length ? (items.reduce((a, it) => a + (parseFloat(it.value) || 0), 0).toFixed(2) + ' ' + (items[0]?.currency || 'EUR')) : '—'} />
        </View>

        {/* Warning */}
        <View style={s.warnBox}>
          <Text style={s.warnText}>⚠ This is a DRAFT document for preparation purposes only. It must be submitted through the EU DVA (Customs Transit Application) or an authorised customs software to obtain a valid MRN and TAD. The principal is responsible for ensuring all data is accurate and complete before submission.</Text>
        </View>

        <Text style={s.disclaimer}>
          T1 transit declarations must be submitted via the EU DVA system (replaced NCTS as of October 2024). A guarantee covering potential duties is mandatory. The Transit Accompanying Document (TAD) with the MRN must accompany the goods throughout transit. Dutify.lu provides this draft for preparation purposes only and accepts no liability for customs decisions.
        </Text>

        <View style={s.footer}>
          <Text>EU Customs Transit · dutify.lu</Text>
          <Text>Draft T1 · {fmtDate(now)}</Text>
        </View>

      </Page>
    </Document>
  )
}
