"use client";
import { useState } from "react";

const TRANSPORT_MODES = ["Road", "Sea", "Air", "Rail", "Inland waterway", "Multimodal"];
const GUARANTEE_TYPES = [
  "0 — Guarantee waiver",
  "1 — Comprehensive guarantee",
  "2 — Individual guarantee (in cash)",
  "4 — Individual guarantee in the form of an undertaking",
  "9 — Individual guarantee with multiple usage vouchers",
];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN"];
const PACKAGE_TYPES = ["Boxes", "Pallets", "Cartons", "Crates", "Bags", "Drums", "Rolls", "Pieces", "Containers", "Other"];
const EMPTY_ITEM = { description: "", hsCode: "", countryOfOrigin: "", packages: "", packageType: "Boxes", grossWeight: "", value: "", currency: "EUR" };
const COMMON_OFFICES = [
  { code: "LU000100", name: "Luxembourg Sandweiler (Road)" },
  { code: "LU000200", name: "Luxembourg Airport (Air)" },
  { code: "BE421000", name: "Antwerp Port (Sea)" },
  { code: "NL000824", name: "Rotterdam Port (Sea)" },
  { code: "DE004700", name: "Hamburg Port (Sea)" },
  { code: "FR001200", name: "Paris CDG Airport (Air)" },
  { code: "FR003200", name: "Le Havre Port (Sea)" },
];

// Dossier form primitives — bone paper, forest ink, brass focus.
const inputStyle = {
  padding: "9px 12px",
  borderRadius: 2,
  border: "1px solid var(--rule-hair)",
  borderBottom: "1px solid var(--rule-strong)",
  background: "var(--paper-cream)",
  color: "var(--ink-forest-deep)",
  fontSize: 13,
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  transition: "all .12s cubic-bezier(.33,1,.68,1)",
};
const selectStyle = {
  ...inputStyle,
  background: "var(--paper-cream)",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
};
const labelStyle = {
  fontSize: 11,
  color: "var(--ink-muted)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 500,
  fontFamily: "var(--font-body)",
  display: "block",
  marginBottom: 4,
};
const fieldWrap = (flex) => ({ display: "flex", flexDirection: "column", gap: 4, flex: flex || 1 });

function Field({ label, name, value, onChange, type, placeholder, flex, required }) {
  return (
    <div style={fieldWrap(flex)}>
      <label style={labelStyle}>{label}{required && <span style={{ color: "var(--oxblood)" }}> *</span>}</label>
      <input
        type={type || "text"}
        placeholder={placeholder || ""}
        value={value || ""}
        onChange={onChange}
        style={inputStyle}
      />
    </div>
  );
}

function SelectField({ label, name, value, onChange, options, flex, required }) {
  return (
    <div style={fieldWrap(flex)}>
      <label style={labelStyle}>{label}{required && <span style={{ color: "var(--oxblood)" }}> *</span>}</label>
      <select value={value || ""} onChange={onChange} style={selectStyle}>
        <option value="">Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function PartyBlock({ title, prefix, data, onChange }) {
  const f = (label, key, opts = {}) => (
    <Field
      label={label}
      value={data[prefix + key] || ""}
      onChange={(e) => onChange(prefix + key, e.target.value)}
      flex={opts.flex}
      placeholder={opts.placeholder}
      required={opts.required}
    />
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {title && (
        <div style={{
          fontSize: 11, fontWeight: 500, color: "var(--brass-deep)",
          textTransform: "uppercase", letterSpacing: "0.18em",
          fontFamily: "var(--font-mono)",
        }}>{title}</div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        {f("Name", "Name", { flex: 2, required: true })}
        {f("EORI Number", "EORI", { flex: 1, placeholder: "e.g. LU123456789" })}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {f("Street & Number", "Street", { flex: 2 })}
        {f("City", "City", {})}
        {f("Postcode", "Postcode", { flex: 0.7 })}
        {f("Country (ISO)", "Country", { flex: 0.7, placeholder: "e.g. LU" })}
      </div>
    </div>
  );
}

function OfficeField({ label, codeKey, nameKey, codeVal, nameVal, onCodeChange, onNameChange }) {
  const [custom, setCustom] = useState(false);
  return (
    <div style={fieldWrap(1)}>
      <label style={labelStyle}>{label}</label>
      {!custom ? (
        <>
          <select
            value={codeVal || ""}
            onChange={(e) => {
              const o = COMMON_OFFICES.find(x => x.code === e.target.value);
              onCodeChange(e.target.value);
              onNameChange(o ? o.name : "");
            }}
            style={selectStyle}
          >
            <option value="">Select or enter custom…</option>
            {COMMON_OFFICES.map(o => <option key={o.code} value={o.code}>{o.code} — {o.name}</option>)}
          </select>
          <button onClick={() => setCustom(true)} style={{
            fontSize: 11, color: "var(--brass-deep)", background: "none", border: "none",
            cursor: "pointer", textAlign: "left", padding: "2px 0", marginTop: 3,
            fontFamily: "var(--font-body)", letterSpacing: "0.04em",
            textDecoration: "underline", textDecorationColor: "var(--brass-soft)",
            textUnderlineOffset: "2px",
          }}>
            Enter custom code ↗
          </button>
        </>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <input placeholder="Code e.g. LU000100" value={codeVal || ""} onChange={e => onCodeChange(e.target.value)}
            style={{ ...inputStyle, flex: 1 }} />
          <input placeholder="Office name" value={nameVal || ""} onChange={e => onNameChange(e.target.value)}
            style={{ ...inputStyle, flex: 2 }} />
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: "var(--paper-cream)",
      border: "1px solid var(--rule-hair)",
      borderBottom: "1px solid var(--rule-strong)",
      borderLeft: "2px solid var(--brass)",
      borderRadius: 4,
      padding: "18px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxShadow: "var(--shadow-paper)",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 500,
        color: "var(--brass-deep)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontFamily: "var(--font-mono)",
        paddingBottom: 4,
        borderBottom: "1px solid var(--rule-soft)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ width: 12, height: 1, background: "var(--brass)", display: "inline-block" }} />
        {title}
      </div>
      {children}
    </div>
  );
}

export default function T1DraftTab() {
  const [decl, setDecl] = useState({
    transportMode: "",
    declarationDate: new Date().toISOString().slice(0, 10),
    officeOfDepartureCode: "", officeOfDeparture: "",
    officeOfDestinationCode: "", officeOfDestination: "",
  });
  const [parties, setParties] = useState({});
  const [transport, setTransport] = useState({});
  const [guarantee, setGuarantee] = useState({});
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const setParty = (key, val) => setParties(p => ({ ...p, [key]: val }));
  const setTrans = (key, val) => setTransport(p => ({ ...p, [key]: val }));
  const setGuar = (key, val) => setGuarantee(p => ({ ...p, [key]: val }));
  const updateItem = (i, key, val) => setItems(p => p.map((it, idx) => idx === i ? { ...it, [key]: val } : it));

  const totalPkgs = items.reduce((a, it) => a + (parseInt(it.packages) || 0), 0);
  const totalWeight = items.reduce((a, it) => a + (parseFloat(it.grossWeight) || 0), 0).toFixed(2);

  async function generatePDF() {
    setLoading(true); setError(null);
    try {
      const payload = {
        type: "t1",
        ...decl,
        principalName: parties.principalName, principalEORI: parties.principalEORI,
        principalStreet: parties.principalStreet, principalCity: parties.principalCity,
        principalPostcode: parties.principalPostcode, principalCountry: parties.principalCountry,
        consignorName: parties.consignorName, consignorEORI: parties.consignorEORI,
        consignorStreet: parties.consignorStreet, consignorCity: parties.consignorCity,
        consignorPostcode: parties.consignorPostcode, consignorCountry: parties.consignorCountry,
        consigneeName: parties.consigneeName, consigneeEORI: parties.consigneeEORI,
        consigneeStreet: parties.consigneeStreet, consigneeCity: parties.consigneeCity,
        consigneePostcode: parties.consigneePostcode, consigneeCountry: parties.consigneeCountry,
        carrier: transport.carrier, vehicleId: transport.vehicleId,
        containerNumber: transport.containerNumber, sealNumbers: transport.sealNumbers,
        countryOfDispatch: transport.countryOfDispatch, transportDocRef: transport.transportDocRef,
        guaranteeType: guarantee.guaranteeType, guaranteeRef: guarantee.guaranteeRef,
        guaranteeAccessCode: guarantee.guaranteeAccessCode,
        items,
      };
      const res = await fetch("/api/export/pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `T1-draft-${Date.now()}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  const row = { display: "flex", gap: 10 };

  return (
    <div className="v2-tab-wrap">
      <div className="v2-card">
        <div className="v2-card-hdr">
          <div className="v2-card-icon">📋</div>
          <span className="v2-card-title">T1 Transit Declaration</span>
          <span className="v2-card-sub">Common External Transit · Draft</span>
        </div>
        <div className="v2-card-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <div style={{
            padding: "12px 16px",
            background: "var(--brass-wash)",
            borderLeft: "3px solid var(--brass)",
            borderRadius: "0 4px 4px 0",
            fontSize: 13,
            color: "var(--brass-deep)",
            fontFamily: "var(--font-body)",
          }}>
            <strong style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"opsz" 18, "SOFT" 50' }}>Draft only.</strong>
            {" "}Not legally valid until submitted via the EU DVA customs transit system.
          </div>

          {/* Declaration */}
          <Section title="Declaration">
            <div style={row}>
              <SelectField label="Transport Mode *" value={decl.transportMode} onChange={e => setDecl(p => ({ ...p, transportMode: e.target.value }))} options={TRANSPORT_MODES} />
              <Field label="Date of Declaration" type="date" value={decl.declarationDate} onChange={e => setDecl(p => ({ ...p, declarationDate: e.target.value }))} />
            </div>
            <div style={row}>
              <OfficeField
                label="Office of Departure *"
                codeVal={decl.officeOfDepartureCode} nameVal={decl.officeOfDeparture}
                onCodeChange={v => setDecl(p => ({ ...p, officeOfDepartureCode: v }))}
                onNameChange={v => setDecl(p => ({ ...p, officeOfDeparture: v }))}
              />
              <OfficeField
                label="Office of Destination *"
                codeVal={decl.officeOfDestinationCode} nameVal={decl.officeOfDestination}
                onCodeChange={v => setDecl(p => ({ ...p, officeOfDestinationCode: v }))}
                onNameChange={v => setDecl(p => ({ ...p, officeOfDestination: v }))}
              />
            </div>
          </Section>

          {/* Principal */}
          <Section title="Principal (Declarant)">
            <PartyBlock prefix="principal" data={parties} onChange={setParty} title="" />
          </Section>

          {/* Consignor */}
          <Section title="Consignor (Sender)">
            <PartyBlock prefix="consignor" data={parties} onChange={setParty} title="" />
          </Section>

          {/* Consignee */}
          <Section title="Consignee (Recipient)">
            <PartyBlock prefix="consignee" data={parties} onChange={setParty} title="" />
          </Section>

          {/* Transport */}
          <Section title="Transport Details">
            <div style={row}>
              <Field label="Carrier / Transport Company" value={transport.carrier} onChange={e => setTrans("carrier", e.target.value)} />
              <Field label="Vehicle / Convoy Number" value={transport.vehicleId} onChange={e => setTrans("vehicleId", e.target.value)} placeholder="e.g. LU AB 1234" />
            </div>
            <div style={row}>
              <Field label="Container Number" value={transport.containerNumber} onChange={e => setTrans("containerNumber", e.target.value)} placeholder="e.g. MSCU1234567" />
              <Field label="Seal Number(s)" value={transport.sealNumbers} onChange={e => setTrans("sealNumbers", e.target.value)} placeholder="e.g. 123456, 123457" />
            </div>
            <div style={row}>
              <Field label="Country of Dispatch (ISO)" value={transport.countryOfDispatch} onChange={e => setTrans("countryOfDispatch", e.target.value)} placeholder="e.g. CN, US, GB" flex={0.5} />
              <Field label="CMR / AWB / B/L Reference" value={transport.transportDocRef} onChange={e => setTrans("transportDocRef", e.target.value)} />
            </div>
          </Section>

          {/* Guarantee */}
          <Section title="Guarantee">
            <SelectField label="Guarantee Type *" value={guarantee.guaranteeType} onChange={e => setGuar("guaranteeType", e.target.value)} options={GUARANTEE_TYPES} flex={2} />
            <div style={row}>
              <Field label="Guarantee Reference" value={guarantee.guaranteeRef} onChange={e => setGuar("guaranteeRef", e.target.value)} />
              <Field label="Access Code" value={guarantee.guaranteeAccessCode} onChange={e => setGuar("guaranteeAccessCode", e.target.value)} />
            </div>
          </Section>

          {/* Goods */}
          <Section title={`Goods Items (${items.length})`}>
            {items.map((item, i) => (
              <div key={i} style={{
                background: "var(--paper-sunk)",
                border: "1px solid var(--rule-hair)",
                borderRadius: 4,
                padding: "16px 18px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "var(--ink-forest-deep)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}>Item №{String(i + 1).padStart(2, "0")}</span>
                  {items.length > 1 && (
                    <button onClick={() => setItems(p => p.filter((_, idx) => idx !== i))}
                      style={{
                        fontSize: 11,
                        color: "var(--oxblood)",
                        background: "transparent",
                        border: "1px solid var(--oxblood)",
                        borderRadius: 2,
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontFamily: "var(--font-body)",
                        letterSpacing: "0.04em",
                      }}>
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={row}>
                    <Field label="Description of Goods *" value={item.description} onChange={e => updateItem(i, "description", e.target.value)} placeholder="Full commercial description" flex={3} required />
                    <Field label="HS Code *" value={item.hsCode} onChange={e => updateItem(i, "hsCode", e.target.value)} placeholder="8-digit" flex={1} required />
                    <Field label="Origin (ISO)" value={item.countryOfOrigin} onChange={e => updateItem(i, "countryOfOrigin", e.target.value)} placeholder="e.g. CN" flex={0.7} />
                  </div>
                  <div style={row}>
                    <Field label="No. Packages" type="number" value={item.packages} onChange={e => updateItem(i, "packages", e.target.value)} placeholder="10" flex={0.8} />
                    <div style={fieldWrap(1)}>
                      <label style={labelStyle}>Package Type</label>
                      <select value={item.packageType} onChange={e => updateItem(i, "packageType", e.target.value)} style={selectStyle}>
                        {PACKAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <Field label="Gross Weight (kg)" type="number" value={item.grossWeight} onChange={e => updateItem(i, "grossWeight", e.target.value)} placeholder="250.5" flex={1} />
                    <Field label="Value" type="number" value={item.value} onChange={e => updateItem(i, "value", e.target.value)} placeholder="5000" flex={1} />
                    <div style={fieldWrap(0.7)}>
                      <label style={labelStyle}>Currency</label>
                      <select value={item.currency} onChange={e => updateItem(i, "currency", e.target.value)} style={selectStyle}>
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button onClick={() => setItems(p => [...p, { ...EMPTY_ITEM }])}
              style={{
                fontSize: 12,
                color: "var(--ink-forest)",
                background: "transparent",
                border: "1px solid var(--ink-forest)",
                borderRadius: 2,
                padding: "9px 18px",
                cursor: "pointer",
                fontWeight: 500,
                fontFamily: "var(--font-body)",
                letterSpacing: "0.04em",
                alignSelf: "flex-start",
              }}>
              + Add Goods Item
            </button>
          </Section>

          {/* Summary */}
          <div style={{
            background: "var(--brass-wash)",
            borderLeft: "3px solid var(--brass)",
            borderRadius: "0 4px 4px 0",
            padding: "12px 16px",
            fontSize: 13,
            color: "var(--ink-forest-deep)",
            fontFamily: "var(--font-body)",
          }}>
            <strong style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 11, color: "var(--brass-deep)" }}>Summary</strong>
            <span style={{ marginLeft: 8 }}>
              {items.length} item(s) · <span className="mono">{totalPkgs}</span> packages · <span className="mono">{totalWeight}</span> kg gross
            </span>
          </div>

          {error && (
            <div style={{
              color: "var(--oxblood)",
              fontSize: 13,
              padding: "8px 12px",
              background: "var(--oxblood-wash)",
              borderLeft: "3px solid var(--oxblood)",
              borderRadius: "0 4px 4px 0",
              fontFamily: "var(--font-body)",
            }}>
              Error: {error}
            </div>
          )}

          <button onClick={generatePDF} disabled={loading}
            style={{
              padding: "14px 28px",
              background: loading ? "var(--paper-edge)" : "var(--ink-forest)",
              color: loading ? "var(--ink-faint)" : "var(--paper-cream)",
              border: "1px solid " + (loading ? "var(--rule-hair)" : "var(--ink-forest-deep)"),
              borderRadius: 2,
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "var(--font-body)",
              letterSpacing: "0.04em",
              cursor: loading ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
              boxShadow: loading ? "none" : "inset 0 -1px 0 rgba(0,0,0,0.15), 0 1px 0 rgba(31,59,45,0.1)",
              transition: "all .12s cubic-bezier(.33,1,.68,1)",
            }}>
            {loading ? "Generating…" : "Generate Draft T1 PDF  ↓"}
          </button>
          <div style={{
            fontSize: 12,
            color: "var(--ink-muted)",
            marginTop: -8,
            fontStyle: "italic",
            fontFamily: "var(--font-display)",
            fontVariationSettings: '"opsz" 14, "SOFT" 50',
          }}>
            PDF includes all fields in a structured format ready for review by your customs broker.
          </div>

        </div>
      </div>
    </div>
  );
}
