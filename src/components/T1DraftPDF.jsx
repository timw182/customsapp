import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

// Fonts: built-in react-pdf fonts (Times-Roman / Helvetica / Courier) to avoid
// remote TTF fetch failures. Times substitutes for Fraunces, Helvetica for
// DM Sans, Courier for JetBrains Mono. Palette + rules + section numbers
// carry the dossier aesthetic.
const F = {
  display:      'Times-Roman',
  displayBold:  'Times-Bold',
  displayItalic:'Times-Italic',
  body:         'Helvetica',
  bodyBold:     'Helvetica-Bold',
  mono:         'Courier',
  monoBold:     'Courier-Bold',
}

const PAL = {
  paperCream:    '#FBF8F0',
  paperSunk:     '#EEE7D0',
  paperEdge:     '#EDE6D3',
  inkForest:     '#1F3B2D',
  inkForestDeep: '#14281E',
  inkMuted:      '#5A6B5F',
  inkFaint:      '#8A9188',
  brass:         '#B8914A',
  brassDeep:     '#8A6A33',
  brassWash:     '#F6EFDB',
  oxblood:       '#6B2C2C',
  ruleHair:      '#D4C9A8',
  ruleStrong:    '#9A8B5E',
  ruleSoft:      '#E4DCC4',
}

const s = StyleSheet.create({
  page: {
    padding: 44,
    paddingBottom: 64,
    fontFamily: F.body,
    fontSize: 9,
    color: PAL.inkForestDeep,
    backgroundColor: PAL.paperCream,
  },
  brassRail: { backgroundColor: PAL.brass, height: 3, marginBottom: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottom: `1 solid ${PAL.ruleHair}`,
  },
  tag: {
    fontSize: 7.5,
    color: PAL.brassDeep,
    letterSpacing: 2,
    fontFamily: F.mono,
    fontWeight: 500,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  brand: {
    fontFamily: F.display,
    fontSize: 22,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  title: {
    fontFamily: F.display,
    fontSize: 18,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 9,
    color: PAL.inkMuted,
    marginTop: 3,
    fontFamily: F.displayItalic,
  },
  headerRight: { textAlign: 'right' },
  stamp: {
    fontSize: 7.5,
    padding: '3 8',
    color: PAL.brassDeep,
    border: `1 solid ${PAL.brass}`,
    borderRadius: 1,
    fontFamily: F.mono,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: 500,
  },
  mrnBox: {
    backgroundColor: PAL.brassWash,
    border: `1 solid ${PAL.brass}`,
    borderRadius: 2,
    padding: '12 14',
    marginBottom: 20,
  },
  mrnLabel: {
    fontSize: 7.5,
    color: PAL.brassDeep,
    letterSpacing: 2,
    fontFamily: F.mono,
    fontWeight: 500,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  mrnValue: {
    fontSize: 14,
    fontFamily: F.monoBold,
    color: PAL.inkForestDeep,
    letterSpacing: 1,
  },
  draftWmark: {
    fontSize: 8,
    color: PAL.oxblood,
    marginTop: 6,
    fontFamily: F.displayItalic,
  },
  secLabel: {
    fontSize: 8,
    color: PAL.brassDeep,
    letterSpacing: 2,
    fontFamily: F.mono,
    fontWeight: 500,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
    paddingBottom: 4,
    borderBottom: `0.5 solid ${PAL.ruleHair}`,
  },
  grid: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  cell: {
    flex: 1,
    backgroundColor: PAL.paperSunk,
    border: `0.5 solid ${PAL.ruleHair}`,
    borderLeft: `2 solid ${PAL.brassSoft || PAL.brass}`,
    borderRadius: 2,
    padding: '7 10',
  },
  cellLabel: {
    fontSize: 7.5,
    color: PAL.inkMuted,
    marginBottom: 3,
    fontFamily: F.body,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: 500,
  },
  cellValue: {
    fontSize: 9.5,
    fontFamily: F.mono,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    letterSpacing: 0.3,
  },
  itemBox: {
    backgroundColor: PAL.paperSunk,
    border: `0.5 solid ${PAL.ruleHair}`,
    borderLeft: `2 solid ${PAL.brass}`,
    borderRadius: 2,
    padding: '9 12',
    marginBottom: 7,
  },
  itemTitle: {
    fontFamily: F.display,
    fontSize: 10,
    fontWeight: 500,
    color: PAL.inkForestDeep,
    marginBottom: 5,
  },
  itemRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  itemKV: { fontSize: 8.5 },
  itemKey: { color: PAL.inkMuted, fontFamily: F.body },
  itemVal: { fontFamily: F.mono, fontWeight: 500, color: PAL.inkForestDeep, letterSpacing: 0.3 },
  warnBox: {
    backgroundColor: PAL.brassWash,
    border: `0.5 solid ${PAL.brass}`,
    borderLeft: `3 solid ${PAL.brass}`,
    borderRadius: 2,
    padding: '8 12',
    marginTop: 14,
    marginBottom: 4,
  },
  warnText: {
    fontSize: 8,
    color: PAL.brassDeep,
    lineHeight: 1.6,
    fontFamily: F.body,
  },
  disclaimer: {
    marginTop: 18,
    paddingTop: 10,
    borderTop: `0.5 solid ${PAL.ruleHair}`,
    fontSize: 7.5,
    color: PAL.inkMuted,
    lineHeight: 1.65,
    fontFamily: F.displayItalic,
  },
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: PAL.inkMuted,
    fontFamily: F.mono,
    letterSpacing: 0.8,
    paddingTop: 8,
    borderTop: `0.5 solid ${PAL.ruleHair}`,
  },
  folio: {
    fontSize: 7.5,
    color: PAL.brassDeep,
    fontFamily: F.mono,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 6,
  },
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
        <View style={s.brassRail} />

        <View style={s.headerRow}>
          <View>
            <Text style={s.tag}>Grand-Duché de Luxembourg · EU Transit</Text>
            <Text style={s.brand}>Dutify<Text style={{ color: PAL.brass }}>.</Text></Text>
            <Text style={s.title}>T1 Transit Declaration</Text>
            <Text style={s.subtitle}>Common External Transit — Draft</Text>
          </View>
          <View style={s.headerRight}>
            <Text style={s.stamp}>Draft</Text>
            <Text style={{ fontSize: 8, color: PAL.inkMuted, marginTop: 8, fontFamily: F.mono, letterSpacing: 0.6 }}>
              Generated: {fmtDate(now)}
            </Text>
            <Text style={s.folio}>Folio · {String(now.getTime()).slice(-6)}</Text>
          </View>
        </View>

        {/* MRN */}
        <View style={s.mrnBox}>
          <Text style={s.mrnLabel}>Movement Reference Number (MRN)</Text>
          <Text style={s.mrnValue}>{val(data.mrn, 'To be assigned by DVA/NCTS upon submission')}</Text>
          <Text style={s.draftWmark}>Draft — not submitted to NCTS/DVA. For preparation purposes only.</Text>
        </View>

        <Section label="§ 01  Declaration" />
        <View style={s.grid}>
          <Field label="Declaration Type" value="T1 — External Transit" />
          <Field label="Date of Declaration" value={val(data.declarationDate, fmtDate(now))} />
          <Field label="Transport Mode" value={val(data.transportMode)} />
        </View>
        <View style={s.grid}>
          <Field label="Office of Departure" value={`${val(data.officeOfDeparture)}${data.officeOfDepartureCode ? ` (${data.officeOfDepartureCode})` : ''}`} />
          <Field label="Office of Destination" value={`${val(data.officeOfDestination)}${data.officeOfDestinationCode ? ` (${data.officeOfDestinationCode})` : ''}`} />
        </View>

        <Section label="§ 02  Principal (Declarant)" />
        <View style={s.grid}>
          <Field label="Name" value={data.principalName} flex={2} />
          <Field label="EORI" value={data.principalEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.principalStreet)}, ${val(data.principalCity)} ${val(data.principalPostcode)}, ${val(data.principalCountry)}`} flex={2} />
        </View>

        <Section label="§ 03  Consignor (Sender)" />
        <View style={s.grid}>
          <Field label="Name" value={data.consignorName} flex={2} />
          <Field label="EORI" value={data.consignorEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.consignorStreet)}, ${val(data.consignorCity)} ${val(data.consignorPostcode)}, ${val(data.consignorCountry)}`} flex={2} />
        </View>

        <Section label="§ 04  Consignee (Recipient)" />
        <View style={s.grid}>
          <Field label="Name" value={data.consigneeName} flex={2} />
          <Field label="EORI" value={data.consigneeEORI} flex={1} />
        </View>
        <View style={s.grid}>
          <Field label="Address" value={`${val(data.consigneeStreet)}, ${val(data.consigneeCity)} ${val(data.consigneePostcode)}, ${val(data.consigneeCountry)}`} flex={2} />
        </View>

        <Section label="§ 05  Transport Details" />
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

        <Section label="§ 06  Guarantee" />
        <View style={s.grid}>
          <Field label="Guarantee Type" value={data.guaranteeType} />
          <Field label="Guarantee Reference" value={data.guaranteeRef} />
          <Field label="Access Code" value={data.guaranteeAccessCode} />
        </View>

        <Section label={`§ 07  Goods (${items.length} item${items.length !== 1 ? 's' : ''})`} />
        {items.map((item, i) => (
          <View key={i} style={s.itemBox}>
            <Text style={s.itemTitle}>
              Item №{String(i + 1).padStart(2, '0')} — {val(item.description)}
            </Text>
            <View style={s.itemRow}>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>HS Code: </Text><Text style={s.itemVal}>{val(item.hsCode)}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Origin: </Text><Text style={s.itemVal}>{val(item.countryOfOrigin)}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Packages: </Text><Text style={s.itemVal}>{val(item.packages)} {val(item.packageType, '')}</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Gross Weight: </Text><Text style={s.itemVal}>{val(item.grossWeight)} kg</Text></Text></View>
              <View><Text style={s.itemKV}><Text style={s.itemKey}>Value: </Text><Text style={s.itemVal}>{val(item.value)} {val(item.currency, 'EUR')}</Text></Text></View>
            </View>
          </View>
        ))}

        <Section label="§ 08  Totals" />
        <View style={s.grid}>
          <Field label="Total Packages" value={items.reduce((a, it) => a + (parseInt(it.packages) || 0), 0) || '—'} />
          <Field label="Total Gross Weight" value={items.reduce((a, it) => a + (parseFloat(it.grossWeight) || 0), 0).toFixed(2) + ' kg'} />
          <Field label="Total Value" value={items.length ? (items.reduce((a, it) => a + (parseFloat(it.value) || 0), 0).toFixed(2) + ' ' + (items[0]?.currency || 'EUR')) : '—'} />
        </View>

        <View style={s.warnBox}>
          <Text style={s.warnText}>
            This is a DRAFT document for preparation purposes only. It must be submitted through the EU DVA (Customs Transit Application) or an authorised customs software to obtain a valid MRN and TAD. The principal is responsible for ensuring all data is accurate and complete before submission.
          </Text>
        </View>

        <Text style={s.disclaimer}>
          T1 transit declarations must be submitted via the EU DVA system (replaced NCTS as of October 2024). A guarantee covering potential duties is mandatory. The Transit Accompanying Document (TAD) with the MRN must accompany the goods throughout transit. Dutify.lu provides this draft for preparation purposes only and accepts no liability for customs decisions.
        </Text>

        <View style={s.footer} fixed>
          <Text>dutify.lu · EU transit ledger</Text>
          <Text>Draft T1 · {fmtDate(now)}</Text>
        </View>
      </Page>
    </Document>
  )
}
