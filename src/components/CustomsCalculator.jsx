"use client";
import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";

const LUXEMBURG_VAT = 0.17;
const ORIGIN_AGREEMENTS = {
  CH: { name: "Switzerland", pref: true, note: "Free Trade Agreement – 0% on most goods" },
  NO: { name: "Norway", pref: true, note: "EEA – 0% on most goods" },
  IS: { name: "Iceland", pref: true, note: "EEA – 0% on most goods" },
  GB: { name: "United Kingdom", pref: true, note: "TCA – reduced/0% with Rules of Origin proof" },
  CA: { name: "Canada", pref: true, note: "CETA – reduced rates with proof of origin" },
  JP: { name: "Japan", pref: true, note: "EPA – reduced rates on many goods" },
  KR: { name: "South Korea", pref: true, note: "FTA – reduced rates on many goods" },
  SG: { name: "Singapore", pref: true, note: "EUSFTA – reduced/0% rates" },
  MX: { name: "Mexico", pref: true, note: "Global Agreement – reduced rates" },
  US: { name: "United States", pref: false, note: "No FTA – MFN (standard) rates apply" },
  CN: { name: "China", pref: false, note: "No FTA – MFN rates; anti-dumping may apply" },
  IN: { name: "India", pref: false, note: "No FTA – MFN rates apply" },
  AU: { name: "Australia", pref: false, note: "No FTA currently – MFN rates" },
  HK: { name: "Hong Kong", pref: false, note: "Treated as China for customs purposes" },
  TR: { name: "Turkey", pref: true, note: "Customs Union – 0% on industrial goods" },
};

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "CNY",
  "HKD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
];

const INCOTERMS_CIF = {
  EXW: { label: "EXW – Ex Works", cifFactor: "full", note: "Add freight, insurance, origin charges to get CIF" },
  FOB: { label: "FOB – Free on Board", cifFactor: "freight+ins", note: "Add main carriage freight + insurance" },
  CFR: { label: "CFR – Cost & Freight", cifFactor: "ins", note: "Add insurance only (typically 0.5-1%)" },
  CIF: { label: "CIF – Cost, Insurance & Freight", cifFactor: "none", note: "Value is already CIF – use directly" },
  DDP: {
    label: "DDP – Delivered Duty Paid",
    cifFactor: "none",
    note: "Seller handles customs – use declared customs value",
  },
  DAP: { label: "DAP – Delivered At Place", cifFactor: "none", note: "Similar to CIF for customs purposes" },
};

function Spinner() {
  return (
    <div
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        border: "2px solid #c8a96e44",
        borderTopColor: "#c8a96e",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}

export default function CustomsCalculator({ user }) {
  const [tab, setTab] = useState("calculator");

  // Form state
  const [description, setDescription] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [dutyRate, setDutyRate] = useState("");
  const [itemValue, setItemValue] = useState("");
  const [freight, setFreight] = useState("");
  const [insurance, setInsurance] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [originCountry, setOriginCountry] = useState("US");
  const [incoterm, setIncoterm] = useState("FOB");
  const [preferential, setPreferential] = useState(false);
  const [hasProofOfOrigin, setHasProofOfOrigin] = useState(false);

  // Data state
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateDate, setRateDate] = useState(null);
  const [hsResult, setHsResult] = useState(null);
  const [hsLoading, setHsLoading] = useState(false);
  const [dutyRateSource, setDutyRateSource] = useState(null); // null | "ai" | "manual"
  const [dutyRateLoading, setDutyRateLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Favourites
  const [favourites, setFavourites] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [savedCodes, setSavedCodes] = useState(new Set());

  // FX board state
  const [allRates, setAllRates] = useState({});
  const [allRatesDate, setAllRatesDate] = useState(null);
  const [allRatesLoading, setAllRatesLoading] = useState(false);
  const [fxAmount, setFxAmount] = useState("1");
  const [fxFrom, setFxFrom] = useState("USD");
  const [fxTo, setFxTo] = useState("EUR");

  const hasPref = ORIGIN_AGREEMENTS[originCountry]?.pref;

  // Fetch exchange rate
  useEffect(() => {
    if (currency === "EUR") {
      setExchangeRate(1);
      setRateDate(new Date().toISOString().split("T")[0]);
      return;
    }
    setRateLoading(true);
    fetch(`https://api.frankfurter.app/latest?from=${currency}&to=EUR`)
      .then((r) => r.json())
      .then((d) => {
        setExchangeRate(d.rates?.EUR);
        setRateDate(d.date);
        setRateLoading(false);
      })
      .catch(() => {
        setError("Could not fetch exchange rate. Check connection.");
        setRateLoading(false);
      });
  }, [currency]);

  // Fetch all rates once on mount (base EUR)
  useEffect(() => {
    setAllRatesLoading(true);
    fetch("https://api.frankfurter.app/latest?from=EUR")
      .then((r) => r.json())
      .then((d) => {
        setAllRates(d.rates || {});
        setAllRatesDate(d.date);
        setAllRatesLoading(false);
      })
      .catch(() => setAllRatesLoading(false));
  }, []);

  // Load favourites
  useEffect(() => {
    fetch("/api/favourites")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFavourites(data);
          setSavedCodes(new Set(data.map((f) => f.hsCode)));
        }
      });
  }, []);

  const convertFX = (amount, from, to) => {
    if (from === to) return parseFloat(amount);
    const rates = { EUR: 1, ...allRates };
    const fromRate = rates[from];
    const toRate = rates[to];
    if (!fromRate || !toRate) return null;
    return (parseFloat(amount) / fromRate) * toRate;
  };

  const lookupHS = async () => {
    if (!description.trim()) return;
    setHsLoading(true);
    setHsResult(null);
    try {
      const resp = await fetch("/api/hs-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, type: "classify" }),
      });
      const parsed = await resp.json();
      setHsResult(parsed);
      setHsCode(parsed.hs6 || "");
      setDutyRate(String(parsed.standardDutyRate ?? ""));
      setDutyRateSource({
        aiGenerated: true,
        description: parsed.description,
        note: `Standard MFN rate from HS classification. ${parsed.antiDumping ? "⚠ Anti-dumping may apply." : ""}`,
        rateType: "ad valorem",
      });
    } catch (e) {
      setHsResult({ error: "Could not classify product. Try entering HS code manually." });
    }
    setHsLoading(false);
  };

  const lookupDutyRate = async (code) => {
    const clean = code.replace(/\D/g, "");
    if (clean.length < 6) return;
    setDutyRateLoading(true);
    setDutyRateSource(null);
    try {
      const resp = await fetch("/api/hs-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, type: "rate" }),
      });
      const parsed = await resp.json();
      setDutyRate(String(parsed.mfnRate ?? ""));
      setDutyRateSource({ ...parsed, aiGenerated: true });
    } catch (e) {
      setDutyRateSource({ error: true });
    }
    setDutyRateLoading(false);
  };

  const calculate = () => {
    const val = parseFloat(itemValue) || 0;
    const fr = parseFloat(freight) || 0;
    const ins = parseFloat(insurance) || 0;
    const rate = exchangeRate || 1;
    const duty = parseFloat(dutyRate) || 0;

    if (!val || !exchangeRate) return;

    // Convert everything to EUR
    const valEUR = val * rate;
    const frEUR = fr * rate;
    const insEUR = ins * rate;

    // CIF value
    let cifEUR = valEUR;
    if (incoterm === "FOB" || incoterm === "EXW") cifEUR = valEUR + frEUR + insEUR;
    else if (incoterm === "CFR") cifEUR = valEUR + insEUR;

    // Duty-free threshold
    const dutyFree = cifEUR <= 150;

    // Apply preferential rate
    let effectiveDutyRate = duty / 100;
    if (hasPref && hasProofOfOrigin) effectiveDutyRate = 0;

    const customsDuty = dutyFree ? 0 : cifEUR * effectiveDutyRate;
    const vatBase = cifEUR + customsDuty;
    const importVAT = vatBase * LUXEMBURG_VAT;
    const total = cifEUR + customsDuty + importVAT;

    setResult({
      cifEUR,
      customsDuty,
      importVAT,
      total,
      effectiveDutyRate: effectiveDutyRate * 100,
      dutyFree,
      vatBase,
      valEUR,
      frEUR,
      insEUR,
    });
  };

  const downloadPDF = async () => {
    if (!result) return;
    const data = {
      createdAt: new Date(),
      originCountry,
      incoterm,
      currency,
      exchangeRate,
      rateDate,
      lines: [{ description, hsCode, dutyRate, value: itemValue, freight, insurance }],
      cifEUR: result.cifEUR,
      customsDuty: result.customsDuty,
      importVAT: result.importVAT,
      total: result.total,
    };
    const res = await fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customs-${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveFavourite = async (hs) => {
    setFavLoading(true);
    const res = await fetch("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hsCode: hs.hs6,
        description: hs.description,
        dutyRate: hs.standardDutyRate,
        notes: hs.antiDumpingNote || "",
      }),
    });
    const fav = await res.json();
    setFavourites((f) => [fav, ...f.filter((x) => x.hsCode !== fav.hsCode)]);
    setSavedCodes((s) => new Set([...s, fav.hsCode]));
    setFavLoading(false);
  };

  const removeFavourite = async (id, hsCode) => {
    await fetch("/api/favourites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setFavourites((f) => f.filter((x) => x.id !== id));
    setSavedCodes((s) => {
      const n = new Set(s);
      n.delete(hsCode);
      return n;
    });
  };

  const fmt = (n) => n?.toLocaleString("de-LU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0e0e0e",
        color: "#e8e0d0",
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        padding: "0",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Courier+Prime:wght@400;700&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { background: #1a1a1a; border: 1px solid #333; color: #e8e0d0; padding: 8px 12px; font-family: 'Courier Prime', monospace; font-size: 13px; border-radius: 2px; width: 100%; outline: none; transition: border-color 0.2s; }
        input:focus, select:focus { border-color: #c8a96e; }
        select option { background: #1a1a1a; }
        button { cursor: pointer; font-family: 'Cormorant Garamond', Georgia, serif; }
        .tag { display: inline-block; padding: 2px 8px; border-radius: 2px; font-size: 11px; font-family: 'Courier Prime', monospace; }
        .tag-green { background: #1a2e1a; border: 1px solid #2d5a2d; color: #6bc26b; }
        .tag-red { background: #2e1a1a; border: 1px solid #5a2d2d; color: #c26b6b; }
        .tag-amber { background: #2e261a; border: 1px solid #5a4a2d; color: #c8a96e; }
        .result-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #222; }
        .result-row:last-child { border-bottom: none; }
        .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 3px; color: #666; margin-bottom: 12px; }
        .btn-gold { background: #c8a96e; color: #0e0e0e; border: none; transition: background 0.2s, box-shadow 0.25s, transform 0.1s; cursor: pointer; }
        .btn-gold:hover { background: #ddb97e; box-shadow: 0 0 22px #c8a96e55, 0 0 6px #c8a96e33; transform: translateY(-1px); }
        .btn-gold:active { transform: translateY(0); box-shadow: none; }
        .btn-gold:disabled { background: #333; color: #666; box-shadow: none; transform: none; cursor: default; }
        .btn-ghost { background: none; transition: color 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.1s; cursor: pointer; }
        .btn-ghost:hover { border-color: #c8a96e88 !important; color: #ddb97e !important; box-shadow: 0 0 12px #c8a96e22; transform: translateY(-1px); }
        .btn-ghost:active { transform: translateY(0); }
        .btn-ghost:disabled { opacity: 0.3; cursor: default; transform: none; box-shadow: none; }

        /* Responsive */
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        .tabs-bar { display: flex; justify-content: center; border-bottom: 1px solid #222; padding: 0 16px; overflow-x: auto; scrollbar-width: none; }
        .tabs-bar::-webkit-scrollbar { display: none; }
        .tab-btn { padding: 14px 24px; background: none; border: none; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; white-space: nowrap; margin-bottom: -1px; transition: color 0.2s, background 0.2s; flex-shrink: 0; border-radius: 4px 4px 0 0; position: relative; }
        .tab-btn:hover { color: #e8e0d0 !important; background: #ffffff08; }
        .tab-btn::after { content: ''; position: absolute; bottom: -1px; left: 50%; right: 50%; height: 1px; background: #c8a96e44; transition: left 0.2s, right 0.2s; }
        .tab-btn:hover::after { left: 16px; right: 16px; }
        .page-header { border-bottom: 1px solid #222; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .page-content { padding: 24px; max-width: 900px; margin: 0 auto; }
        .header-right { text-align: right; flex-shrink: 0; }
        .fx-grid { display: grid; grid-template-columns: 52px 1fr 1fr 1fr; gap: 0; }
        .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }

        @media (max-width: 700px) {
          .two-col { grid-template-columns: 1fr; gap: 24px; }
          .ref-grid { grid-template-columns: 1fr; gap: 24px; }
          .tabs-bar { padding: 0 8px; justify-content: flex-start; }
          .tab-btn { padding: 12px 14px; font-size: 11px; letter-spacing: 1px; }
          .page-header { padding: 16px; }
          .page-content { padding: 16px; }
          .header-right { display: none; }
          .fx-two-col { grid-template-columns: 1fr !important; }
          .fx-grid { grid-template-columns: 44px 1fr 80px; }
          .fx-grid .fx-hide { display: none; }
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: 4,
              color: "#c8a96e",
              textTransform: "uppercase",
              marginBottom: 4,
              fontFamily: "'Courier Prime', monospace",
            }}
          >
            Luxembourg · EU Customs
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: 1 }}>Import Duty Calculator</h1>
        </div>
        <div className="header-right">
          <div style={{ fontSize: 10, color: "#555", fontFamily: "'Courier Prime', monospace" }}>
            COMMON CUSTOMS TARIFF
          </div>
          <div style={{ fontSize: 10, color: "#555", fontFamily: "'Courier Prime', monospace" }}>VAT LU 17%</div>
          {rateDate && currency !== "EUR" && (
            <div style={{ fontSize: 10, color: "#c8a96e66", fontFamily: "'Courier Prime', monospace", marginTop: 4 }}>
              FX: {currency}/EUR {exchangeRate?.toFixed(5)} · {rateDate}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {user?.role === "ADMIN" && (
              <a
                href="/admin"
                style={{
                  fontSize: 10,
                  color: "#555",
                  fontFamily: "'Courier Prime', monospace",
                  letterSpacing: 1,
                  textDecoration: "none",
                  padding: "4px 8px",
                  border: "1px solid #222",
                  borderRadius: 2,
                  transition: "color 0.2s, border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.target.style.color = "#c8a96e";
                  e.target.style.borderColor = "#c8a96e44";
                }}
                onMouseLeave={(e) => {
                  e.target.style.color = "#555";
                  e.target.style.borderColor = "#222";
                }}
              >
                admin
              </a>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={{
                fontSize: 10,
                color: "#555",
                fontFamily: "'Courier Prime', monospace",
                letterSpacing: 1,
                background: "none",
                border: "1px solid #222",
                borderRadius: 2,
                padding: "4px 8px",
                cursor: "pointer",
                transition: "color 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#c26b6b";
                e.currentTarget.style.borderColor = "#5a2d2d";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#555";
                e.currentTarget.style.borderColor = "#222";
              }}
            >
              logout
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {["calculator", "hs-lookup", "fx", "reference"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="tab-btn"
            style={{
              color: tab === t ? "#c8a96e" : "#555",
              borderBottom: tab === t ? "1px solid #c8a96e" : "1px solid transparent",
            }}
          >
            {t === "calculator" ? "Calc" : t === "hs-lookup" ? "HS Lookup" : t === "fx" ? "FX Rates" : "Reference"}
          </button>
        ))}
      </div>

      <div className="page-content">
        {/* CALCULATOR TAB */}
        {tab === "calculator" && (
          <div className="two-col">
            {/* Left: Inputs */}
            <div>
              <div className="section-label">Shipment Details</div>

              <div style={{ display: "grid", gap: 16 }}>
                {/* Origin */}
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Origin Country
                  </label>
                  <select
                    value={originCountry}
                    onChange={(e) => {
                      setOriginCountry(e.target.value);
                      setHasProofOfOrigin(false);
                    }}
                  >
                    {Object.entries(ORIGIN_AGREEMENTS).map(([code, info]) => (
                      <option key={code} value={code}>
                        {info.name} ({code})
                      </option>
                    ))}
                    <option value="OTHER">Other</option>
                  </select>
                  {ORIGIN_AGREEMENTS[originCountry] && (
                    <div
                      style={{
                        fontSize: 11,
                        color: hasPref ? "#6bc26b" : "#888",
                        marginTop: 6,
                        fontFamily: "'Courier Prime', monospace",
                      }}
                    >
                      {ORIGIN_AGREEMENTS[originCountry].note}
                    </div>
                  )}
                  {hasPref && (
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 8,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={hasProofOfOrigin}
                        onChange={(e) => setHasProofOfOrigin(e.target.checked)}
                        style={{ width: "auto" }}
                      />
                      I have a valid proof of origin (EUR.1 / origin declaration)
                    </label>
                  )}
                </div>

                {/* Incoterm */}
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Incoterm
                  </label>
                  <select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                    {Object.entries(INCOTERMS_CIF).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4, fontFamily: "'Courier Prime', monospace" }}>
                    {INCOTERMS_CIF[incoterm]?.note}
                  </div>
                </div>

                {/* Currency */}
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Currency
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 12, color: "#888", whiteSpace: "nowrap" }}>
                      {rateLoading ? <Spinner /> : currency === "EUR" ? "" : `× ${exchangeRate?.toFixed(4)}`}
                    </div>
                  </div>
                </div>

                {/* Values */}
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Goods Value ({currency})
                  </label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={itemValue}
                    onChange={(e) => setItemValue(e.target.value)}
                  />
                </div>

                {(incoterm === "FOB" || incoterm === "EXW") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "#777",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        Freight ({currency})
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={freight}
                        onChange={(e) => setFreight(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "#777",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        Insurance ({currency})
                      </label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={insurance}
                        onChange={(e) => setInsurance(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                {incoterm === "CFR" && (
                  <div>
                    <label
                      style={{
                        fontSize: 11,
                        color: "#777",
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      Insurance ({currency})
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={insurance}
                      onChange={(e) => setInsurance(e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    HS Code
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="e.g. 8471.30"
                      value={hsCode}
                      onChange={(e) => {
                        setHsCode(e.target.value);
                        setDutyRateSource(null);
                      }}
                      onBlur={(e) => {
                        if (e.target.value.replace(/\D/g, "").length >= 6) lookupDutyRate(e.target.value);
                      }}
                      style={{ flex: "1 1 100%" }}
                    />
                    <button
                      onClick={() => lookupDutyRate(hsCode)}
                      disabled={dutyRateLoading || hsCode.replace(/\D/g, "").length < 6}
                      className="btn-ghost"
                      style={{
                        flex: "1 1 auto",
                        padding: "8px 12px",
                        border: "1px solid #333",
                        color: dutyRateLoading ? "#555" : "#c8a96e",
                        fontSize: 11,
                        letterSpacing: 1,
                        borderRadius: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        whiteSpace: "nowrap",
                        background: "none",
                      }}
                    >
                      {dutyRateLoading ? (
                        <>
                          <Spinner /> rate...
                        </>
                      ) : (
                        "get rate"
                      )}
                    </button>
                    <button
                      onClick={() => setTab("hs-lookup")}
                      className="btn-ghost"
                      style={{
                        flex: "1 1 auto",
                        padding: "8px 12px",
                        border: "1px solid #333",
                        color: "#c8a96e",
                        fontSize: 11,
                        letterSpacing: 1,
                        borderRadius: 2,
                        whiteSpace: "nowrap",
                        background: "none",
                      }}
                    >
                      find code
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#777",
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    Duty Rate (%)
                    {dutyRateSource?.aiGenerated && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 10,
                          color: "#c8a96e",
                          letterSpacing: 1,
                        }}
                      >
                        AI SUGGESTED
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 3.5"
                    value={dutyRate}
                    onChange={(e) => {
                      setDutyRate(e.target.value);
                      setDutyRateSource((s) => (s ? { ...s, aiGenerated: false } : null));
                    }}
                    step="0.1"
                    style={{ borderColor: dutyRateSource?.aiGenerated ? "#c8a96e55" : undefined }}
                  />

                  {/* AI-suggested rate disclaimer */}
                  {dutyRateSource?.aiGenerated && !dutyRateSource.error && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "10px 14px",
                        background: "#1e1a10",
                        border: "1px solid #c8a96e33",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#c8a96e", marginBottom: 4 }}>
                        ⚠ AI-estimated rate — please verify before use
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#888",
                          fontFamily: "'Courier Prime', monospace",
                          lineHeight: 1.6,
                        }}
                      >
                        {dutyRateSource.description && (
                          <span>
                            {dutyRateSource.description}
                            <br />
                          </span>
                        )}
                        {dutyRateSource.note && (
                          <span>
                            {dutyRateSource.note}
                            <br />
                          </span>
                        )}
                        MFN rate type: {dutyRateSource.rateType || "ad valorem"}
                      </div>
                      <a
                        href={`https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${hsCode.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener"
                        style={{
                          display: "inline-block",
                          marginTop: 8,
                          fontSize: 11,
                          color: "#c8a96e",
                          fontFamily: "'Courier Prime', monospace",
                        }}
                      >
                        → Verify official rate in TARIC ↗
                      </a>
                    </div>
                  )}
                  {dutyRateSource?.error && (
                    <div
                      style={{ marginTop: 6, fontSize: 11, color: "#c26b6b", fontFamily: "'Courier Prime', monospace" }}
                    >
                      Could not look up rate — enter manually and verify in TARIC.
                    </div>
                  )}
                  {!dutyRateSource && !dutyRateLoading && (
                    <div
                      style={{ fontSize: 11, color: "#444", marginTop: 4, fontFamily: "'Courier Prime', monospace" }}
                    >
                      Enter HS code above to auto-suggest · or{" "}
                      <a
                        href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp"
                        target="_blank"
                        rel="noopener"
                        style={{ color: "#c8a96e" }}
                      >
                        look up in TARIC ↗
                      </a>
                    </div>
                  )}
                </div>

                <button
                  onClick={calculate}
                  className="btn-gold"
                  style={{
                    padding: "14px",
                    fontSize: 13,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    borderRadius: 2,
                    marginTop: 8,
                    fontFamily: "'Cormorant Garamond', serif",
                    width: "100%",
                  }}
                >
                  Calculate Duties
                </button>
              </div>
            </div>

            {/* Right: Results */}
            <div>
              <div className="section-label">Duty Breakdown</div>

              {!result && (
                <div
                  style={{
                    border: "1px dashed #222",
                    borderRadius: 2,
                    padding: 40,
                    textAlign: "center",
                    color: "#444",
                    fontSize: 14,
                    fontStyle: "italic",
                  }}
                >
                  Enter shipment details and calculate to see the duty breakdown
                </div>
              )}

              {result && (
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  {result.dutyFree && (
                    <div
                      style={{
                        background: "#1a2e1a",
                        border: "1px solid #2d5a2d",
                        padding: "12px 16px",
                        borderRadius: 2,
                        marginBottom: 16,
                        fontSize: 13,
                        color: "#6bc26b",
                      }}
                    >
                      ✓ CIF value ≤ €150 — Customs duties waived (low-value goods threshold). Import VAT still applies.
                    </div>
                  )}
                  {hasPref && hasProofOfOrigin && (
                    <div
                      style={{
                        background: "#1a2e1a",
                        border: "1px solid #2d5a2d",
                        padding: "12px 16px",
                        borderRadius: 2,
                        marginBottom: 16,
                        fontSize: 13,
                        color: "#6bc26b",
                      }}
                    >
                      ✓ Preferential duty rate applied (0%) — valid proof of origin declared
                    </div>
                  )}

                  <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 2, padding: 20 }}>
                    <div className="result-row">
                      <span style={{ color: "#888", fontSize: 13 }}>Goods value</span>
                      <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                        € {fmt(result.valEUR)}
                      </span>
                    </div>
                    {(incoterm === "FOB" || incoterm === "EXW") && (
                      <>
                        <div className="result-row">
                          <span style={{ color: "#888", fontSize: 13 }}>+ Freight</span>
                          <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                            € {fmt(result.frEUR)}
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#888", fontSize: 13 }}>+ Insurance</span>
                          <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                            € {fmt(result.insEUR)}
                          </span>
                        </div>
                      </>
                    )}
                    {incoterm === "CFR" && (
                      <div className="result-row">
                        <span style={{ color: "#888", fontSize: 13 }}>+ Insurance</span>
                        <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                          € {fmt(result.insEUR)}
                        </span>
                      </div>
                    )}

                    <div className="result-row" style={{ borderTop: "1px solid #333", paddingTop: 14, marginTop: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>CIF Value (customs base)</span>
                      <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 14, color: "#c8a96e" }}>
                        € {fmt(result.cifEUR)}
                      </span>
                    </div>

                    <div style={{ height: 1, background: "#222", margin: "12px 0" }} />

                    <div className="result-row">
                      <span style={{ color: "#888", fontSize: 13 }}>
                        Customs duty
                        <span
                          style={{
                            fontFamily: "'Courier Prime', monospace",
                            marginLeft: 8,
                            fontSize: 11,
                            color: "#555",
                          }}
                        >
                          {result.dutyFree ? "(waived)" : `${result.effectiveDutyRate.toFixed(2)}%`}
                        </span>
                      </span>
                      <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                        € {fmt(result.customsDuty)}
                      </span>
                    </div>

                    <div className="result-row" style={{ borderBottom: "1px solid #333", paddingBottom: 14 }}>
                      <span style={{ color: "#888", fontSize: 13 }}>
                        Import VAT (LU)
                        <span
                          style={{
                            fontFamily: "'Courier Prime', monospace",
                            marginLeft: 8,
                            fontSize: 11,
                            color: "#555",
                          }}
                        >
                          17%
                        </span>
                      </span>
                      <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13 }}>
                        € {fmt(result.importVAT)}
                      </span>
                    </div>

                    <div className="result-row" style={{ borderBottom: "none", paddingTop: 16 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>Total landed cost</span>
                      <span
                        style={{
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 20,
                          color: "#c8a96e",
                          fontWeight: 700,
                        }}
                      >
                        € {fmt(result.total)}
                      </span>
                    </div>

                    <div style={{ marginTop: 16, padding: "12px 16px", background: "#0e0e0e", borderRadius: 2 }}>
                      <div style={{ fontSize: 11, color: "#555", fontFamily: "'Courier Prime', monospace" }}>
                        Duties as % of goods value:{" "}
                        {(((result.customsDuty + result.importVAT) / result.valEUR) * 100).toFixed(1)}%
                      </div>
                      <div
                        style={{ fontSize: 11, color: "#555", fontFamily: "'Courier Prime', monospace", marginTop: 4 }}
                      >
                        VAT base: CIF + Duty = € {fmt(result.vatBase)}
                      </div>
                      {currency !== "EUR" && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#555",
                            fontFamily: "'Courier Prime', monospace",
                            marginTop: 4,
                          }}
                        >
                          FX rate used: 1 {currency} = {exchangeRate?.toFixed(5)} EUR · {rateDate}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 16px",
                      background: "#141414",
                      border: "1px solid #222",
                      borderRadius: 2,
                      fontSize: 12,
                      color: "#666",
                      lineHeight: 1.6,
                    }}
                  >
                    <strong style={{ color: "#888" }}>⚠ Important:</strong> This is an estimate only. Actual duties are
                    determined by Luxembourg customs (Administration des Douanes). Anti-dumping, excise, or other
                    special duties are not included. Always verify HS code and rates in{" "}
                    <a
                      href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp"
                      target="_blank"
                      rel="noopener"
                      style={{ color: "#c8a96e" }}
                    >
                      TARIC ↗
                    </a>
                    .
                  </div>

                  <button
                    onClick={downloadPDF}
                    className="btn-ghost"
                    style={{
                      marginTop: 12,
                      width: "100%",
                      padding: "12px",
                      border: "1px solid #333",
                      color: "#c8a96e",
                      fontSize: 12,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      borderRadius: 2,
                      background: "none",
                      fontFamily: "'Cormorant Garamond', serif",
                    }}
                  >
                    ↓ Export PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* HS LOOKUP TAB */}
        {tab === "hs-lookup" && (
          <div style={{ maxWidth: 640 }}>
            <div className="section-label">AI-Assisted HS Code Classification</div>
            <p style={{ color: "#888", fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>
              Describe your product in detail. The more specific, the better — include material composition, function,
              whether it's finished/unfinished, and end use.
            </p>

            <div style={{ display: "grid", gap: 12 }}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Laptop computer, 15-inch, Intel Core i7, 16GB RAM, for personal/commercial use. Not a gaming laptop."
                rows={4}
                style={{
                  background: "#1a1a1a",
                  border: "1px solid #333",
                  color: "#e8e0d0",
                  padding: "12px",
                  fontFamily: "'Courier Prime', monospace",
                  fontSize: 13,
                  borderRadius: 2,
                  width: "100%",
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <button
                onClick={lookupHS}
                disabled={hsLoading}
                className={hsLoading ? "" : "btn-gold"}
                style={{
                  padding: "14px",
                  background: hsLoading ? "#333" : undefined,
                  color: hsLoading ? "#888" : undefined,
                  fontSize: 13,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  borderRadius: 2,
                  fontFamily: "'Cormorant Garamond', serif",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  border: "none",
                  width: "100%",
                }}
              >
                {hsLoading ? (
                  <>
                    <Spinner /> Classifying...
                  </>
                ) : (
                  "Classify Product"
                )}
              </button>
            </div>

            {hsResult && !hsResult.error && (
              <div style={{ marginTop: 24, animation: "fadeIn 0.3s ease" }}>
                <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 2, padding: 24 }}>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 20 }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 28,
                          color: "#c8a96e",
                          letterSpacing: 4,
                        }}
                      >
                        {hsResult.hs6}
                      </div>
                      <div style={{ fontSize: 14, color: "#aaa", marginTop: 4 }}>{hsResult.description}</div>
                    </div>
                    <span
                      className={`tag tag-${hsResult.confidence === "high" ? "green" : hsResult.confidence === "medium" ? "amber" : "red"}`}
                    >
                      {hsResult.confidence} confidence
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                    <div style={{ background: "#0e0e0e", padding: 16, borderRadius: 2 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#555",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          marginBottom: 6,
                        }}
                      >
                        Standard Duty Rate
                      </div>
                      <div style={{ fontFamily: "'Courier Prime', monospace", fontSize: 24, color: "#e8e0d0" }}>
                        {hsResult.standardDutyRate}%
                      </div>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>MFN (Most Favoured Nation) rate</div>
                    </div>
                    <div style={{ background: "#0e0e0e", padding: 16, borderRadius: 2 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#555",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Flags
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span className={`tag ${hsResult.antiDumping ? "tag-red" : "tag-green"}`}>
                          {hsResult.antiDumping ? "⚠ Anti-dumping possible" : "✓ No anti-dumping"}
                        </span>
                        <span className={`tag ${hsResult.excise ? "tag-amber" : "tag-green"}`}>
                          {hsResult.excise ? "⚠ Excise duty" : "✓ No excise duty"}
                        </span>
                        <span className={`tag ${hsResult.prohibitedRestricted ? "tag-red" : "tag-green"}`}>
                          {hsResult.prohibitedRestricted ? "⚠ Restricted/controlled" : "✓ No restrictions"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {hsResult.antiDumping && hsResult.antiDumpingNote && (
                    <div
                      style={{
                        background: "#2e1a1a",
                        border: "1px solid #5a2d2d",
                        padding: 12,
                        borderRadius: 2,
                        marginBottom: 12,
                        fontSize: 13,
                        color: "#c26b6b",
                      }}
                    >
                      Anti-dumping: {hsResult.antiDumpingNote}
                    </div>
                  )}
                  {hsResult.excise && hsResult.exciseNote && (
                    <div
                      style={{
                        background: "#2e261a",
                        border: "1px solid #5a4a2d",
                        padding: 12,
                        borderRadius: 2,
                        marginBottom: 12,
                        fontSize: 13,
                        color: "#c8a96e",
                      }}
                    >
                      Excise: {hsResult.exciseNote}
                    </div>
                  )}

                  {hsResult.complianceNotes?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#555",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Compliance Requirements
                      </div>
                      <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                        {hsResult.complianceNotes.map((note, i) => (
                          <li
                            key={i}
                            style={{
                              fontSize: 13,
                              color: "#aaa",
                              fontFamily: "'Courier Prime', monospace",
                              padding: "6px 10px",
                              background: "#0e0e0e",
                              borderRadius: 2,
                            }}
                          >
                            · {note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {hsResult.alternativeHS?.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#555",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          marginBottom: 8,
                        }}
                      >
                        Alternative Classifications
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {hsResult.alternativeHS.map((code, i) => (
                          <span key={i} className="tag tag-amber">
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
                    <button
                      onClick={() => {
                        setTab("calculator");
                      }}
                      className="btn-gold"
                      style={{
                        flex: 1,
                        padding: "12px",
                        fontSize: 12,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        fontWeight: 700,
                        borderRadius: 2,
                        fontFamily: "'Cormorant Garamond', serif",
                      }}
                    >
                      Use in Calculator
                    </button>
                    <button
                      onClick={() =>
                        savedCodes.has(hsResult.hs6)
                          ? removeFavourite(favourites.find((f) => f.hsCode === hsResult.hs6)?.id, hsResult.hs6)
                          : saveFavourite(hsResult)
                      }
                      disabled={favLoading}
                      className="btn-ghost"
                      style={{
                        padding: "12px 16px",
                        border: "1px solid #333",
                        borderRadius: 2,
                        fontSize: 18,
                        background: "none",
                        color: savedCodes.has(hsResult.hs6) ? "#c8a96e" : "#555",
                      }}
                      title={savedCodes.has(hsResult.hs6) ? "Remove from favourites" : "Save to favourites"}
                    >
                      {savedCodes.has(hsResult.hs6) ? "★" : "☆"}
                    </button>
                    <a
                      href={`https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${hsResult.hs6?.replace(".", "")}`}
                      target="_blank"
                      rel="noopener"
                      className="btn-ghost"
                      style={{
                        flex: 1,
                        padding: "12px",
                        border: "1px solid #333",
                        color: "#c8a96e",
                        fontSize: 12,
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        textAlign: "center",
                        textDecoration: "none",
                        borderRadius: 2,
                        display: "block",
                      }}
                    >
                      Verify in TARIC ↗
                    </a>
                  </div>
                </div>
              </div>
            )}

            {hsResult?.error && (
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 16px",
                  background: "#2e1a1a",
                  border: "1px solid #5a2d2d",
                  borderRadius: 2,
                  color: "#c26b6b",
                  fontSize: 13,
                }}
              >
                {hsResult.error}
              </div>
            )}

            {/* Favourites */}
            {favourites.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div className="section-label">Saved HS Codes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {favourites.map((fav) => (
                    <div
                      key={fav.id}
                      style={{
                        background: "#141414",
                        border: "1px solid #1e1e1e",
                        borderRadius: 2,
                        padding: "12px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span
                            style={{
                              fontFamily: "'Courier Prime', monospace",
                              fontSize: 16,
                              color: "#c8a96e",
                              letterSpacing: 2,
                            }}
                          >
                            {fav.hsCode}
                          </span>
                          <span className="tag tag-amber">{fav.dutyRate}%</span>
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#777",
                            marginTop: 3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fav.description}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => {
                            setHsCode(fav.hsCode);
                            setDutyRate(String(fav.dutyRate));
                            setTab("calculator");
                          }}
                          className="btn-ghost"
                          style={{
                            padding: "6px 12px",
                            border: "1px solid #333",
                            color: "#c8a96e",
                            fontSize: 11,
                            letterSpacing: 1,
                            borderRadius: 2,
                            background: "none",
                          }}
                        >
                          use
                        </button>
                        <button
                          onClick={() => removeFavourite(fav.id, fav.hsCode)}
                          className="btn-ghost"
                          style={{
                            padding: "6px 10px",
                            border: "1px solid #333",
                            color: "#555",
                            fontSize: 13,
                            borderRadius: 2,
                            background: "none",
                          }}
                          title="Remove"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FX RATES TAB */}
        {tab === "fx" && (
          <div>
            <div className="two-col" style={{ gap: 32 }}>
              {/* Left: Converter */}
              <div>
                <div className="section-label">Currency Converter → EUR</div>
                <div style={{ background: "#141414", border: "1px solid #222", borderRadius: 2, padding: 24 }}>
                  {/* Amount + From */}
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: "#777",
                        letterSpacing: 2,
                        textTransform: "uppercase",
                        display: "block",
                        marginBottom: 6,
                      }}
                    >
                      Amount
                    </label>
                    <input
                      type="number"
                      value={fxAmount}
                      onChange={(e) => setFxAmount(e.target.value)}
                      placeholder="1.00"
                      style={{
                        background: "#1a1a1a",
                        border: "1px solid #333",
                        color: "#e8e0d0",
                        padding: "10px 14px",
                        fontFamily: "'Courier Prime', monospace",
                        fontSize: 15,
                        borderRadius: 2,
                        width: "100%",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      gap: 12,
                      alignItems: "end",
                      marginBottom: 20,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "#777",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        From
                      </label>
                      <select
                        value={fxFrom}
                        onChange={(e) => setFxFrom(e.target.value)}
                        style={{
                          background: "#1a1a1a",
                          border: "1px solid #333",
                          color: "#e8e0d0",
                          padding: "10px 12px",
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 13,
                          borderRadius: 2,
                          width: "100%",
                          outline: "none",
                        }}
                      >
                        {["EUR", ...Object.keys(allRates)].sort().map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ fontSize: 20, color: "#555", paddingBottom: 4, textAlign: "center" }}>⇄</div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "#777",
                          letterSpacing: 2,
                          textTransform: "uppercase",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        To
                      </label>
                      <select
                        value={fxTo}
                        onChange={(e) => setFxTo(e.target.value)}
                        style={{
                          background: "#1a1a1a",
                          border: "1px solid #333",
                          color: "#e8e0d0",
                          padding: "10px 12px",
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 13,
                          borderRadius: 2,
                          width: "100%",
                          outline: "none",
                        }}
                      >
                        {["EUR", ...Object.keys(allRates)].sort().map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* Result */}
                  {(() => {
                    const converted = convertFX(fxAmount, fxFrom, fxTo);
                    const rate = convertFX(1, fxFrom, fxTo);
                    if (!fxAmount || converted === null) return null;
                    return (
                      <div style={{ background: "#0e0e0e", borderRadius: 2, padding: "20px 20px" }}>
                        <div
                          style={{
                            fontFamily: "'Courier Prime', monospace",
                            fontSize: 28,
                            color: "#c8a96e",
                            letterSpacing: 2,
                          }}
                        >
                          {converted.toLocaleString("de-LU", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}{" "}
                          <span style={{ fontSize: 16, color: "#888" }}>{fxTo}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 12,
                            color: "#555",
                            fontFamily: "'Courier Prime', monospace",
                          }}
                        >
                          1 {fxFrom} = {rate?.toFixed(6)} {fxTo}
                        </div>
                        {allRatesDate && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#444",
                              fontFamily: "'Courier Prime', monospace",
                            }}
                          >
                            ECB rate · {allRatesDate}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Swap button */}
                  <button
                    onClick={() => {
                      const tmp = fxFrom;
                      setFxFrom(fxTo);
                      setFxTo(tmp);
                    }}
                    className="btn-ghost"
                    style={{
                      marginTop: 14,
                      width: "100%",
                      padding: "10px",
                      background: "none",
                      border: "1px solid #2a2a2a",
                      color: "#666",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      borderRadius: 2,
                    }}
                  >
                    swap currencies
                  </button>
                </div>

                {/* Source note */}
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 11,
                    color: "#444",
                    fontFamily: "'Courier Prime', monospace",
                    lineHeight: 1.7,
                  }}
                >
                  Rates sourced from the European Central Bank via{" "}
                  <a href="https://www.frankfurter.app" target="_blank" rel="noopener" style={{ color: "#c8a96e66" }}>
                    frankfurter.app ↗
                  </a>{" "}
                  · Updated daily on ECB business days · Not for financial transactions
                </div>
              </div>

              {/* Right: Rates board */}
              <div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
                >
                  <div className="section-label" style={{ marginBottom: 0 }}>
                    Live Rates vs EUR
                  </div>
                  {allRatesDate && (
                    <span style={{ fontSize: 10, color: "#444", fontFamily: "'Courier Prime', monospace" }}>
                      {allRatesDate}
                    </span>
                  )}
                </div>

                {allRatesLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
                    <Spinner />
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {/* EUR itself */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px 1fr 1fr 1fr",
                        gap: 0,
                        background: "#1a1a14",
                        flexShrink: 0,
                        padding: "9px 14px",
                        borderRadius: 2,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 13,
                          color: "#c8a96e",
                          fontWeight: 700,
                        }}
                      >
                        EUR
                      </span>
                      <span style={{ fontSize: 11, color: "#555" }}>Euro (base)</span>
                      <span
                        style={{
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 13,
                          color: "#888",
                          textAlign: "right",
                        }}
                      >
                        1.000000
                      </span>
                      <span
                        className="fx-hide"
                        style={{
                          fontFamily: "'Courier Prime', monospace",
                          fontSize: 11,
                          color: "#555",
                          textAlign: "right",
                        }}
                      >
                        —
                      </span>
                    </div>
                    {Object.entries(allRates)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([code, eurRate], i) => {
                        const toEur = 1 / eurRate;
                        return (
                          <div
                            key={code}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "52px 1fr 1fr 1fr",
                              gap: 0,
                              background: i % 2 === 0 ? "#141414" : "#111",
                              padding: "9px 14px",
                              alignItems: "center",
                              cursor: "pointer",
                              transition: "background 0.15s",
                            }}
                            onClick={() => {
                              setFxFrom(code);
                              setFxTo("EUR");
                            }}
                            title={`Click to convert ${code} → EUR`}
                          >
                            <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 13, color: "#e8e0d0" }}>
                              {code}
                            </span>
                            <span style={{ fontSize: 11, color: "#555" }}>1 EUR =</span>
                            <span
                              style={{
                                fontFamily: "'Courier Prime', monospace",
                                fontSize: 13,
                                color: "#aaa",
                                textAlign: "right",
                              }}
                            >
                              {eurRate.toFixed(4)}
                            </span>
                            <span
                              className="fx-hide"
                              style={{
                                fontFamily: "'Courier Prime', monospace",
                                fontSize: 11,
                                color: "#666",
                                textAlign: "right",
                              }}
                            >
                              1 {code} = {toEur.toFixed(4)} €
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* REFERENCE TAB */}
        {tab === "reference" && (
          <div className="two-col" style={{ gap: 32 }}>
            <div>
              <div className="section-label">EU Import Thresholds</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {[
                  {
                    label: "De minimis (duty)",
                    value: "≤ €150",
                    note: "No customs duty; VAT still due",
                    color: "green",
                  },
                  {
                    label: "Low-value VAT relief",
                    value: "ABOLISHED",
                    note: "Since July 2021, all imports are VAT-liable",
                    color: "red",
                  },
                  {
                    label: "Informal entry threshold",
                    value: "≤ €1,000",
                    note: "Simplified declaration possible",
                    color: "amber",
                  },
                  {
                    label: "Formal entry required",
                    value: "> €1,000",
                    note: "Full customs declaration (SAD)",
                    color: "red",
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#141414",
                      border: "1px solid #1e1e1e",
                      padding: "14px 16px",
                      borderRadius: 2,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{item.label}</span>
                      <span className={`tag tag-${item.color}`}>{item.value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#666", fontFamily: "'Courier Prime', monospace" }}>
                      {item.note}
                    </div>
                  </div>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: 28 }}>
                Luxembourg VAT Rates
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {[
                  { label: "Standard rate", value: "17%", note: "Most goods & services" },
                  { label: "Intermediate rate", value: "14%", note: "Wines, advertising, some fuel" },
                  { label: "Reduced rate", value: "8%", note: "Gas, electricity, tourism" },
                  { label: "Super-reduced rate", value: "3%", note: "Food, books, medicine, children's goods" },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#141414",
                      border: "1px solid #1e1e1e",
                      padding: "14px 16px",
                      borderRadius: 2,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{item.label}</span>
                      <span className="tag tag-amber">{item.value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#666", fontFamily: "'Courier Prime', monospace" }}>
                      {item.note}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-label">Trade Agreements (EU)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {Object.entries(ORIGIN_AGREEMENTS).map(([code, info]) => (
                  <div
                    key={code}
                    style={{
                      background: "#141414",
                      border: "1px solid #1e1e1e",
                      padding: "10px 16px",
                      borderRadius: 2,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 13 }}>{info.name}</span>
                      <div
                        style={{ fontSize: 11, color: "#555", fontFamily: "'Courier Prime', monospace", marginTop: 2 }}
                      >
                        {info.note}
                      </div>
                    </div>
                    <span className={`tag tag-${info.pref ? "green" : "red"}`}>{info.pref ? "FTA" : "MFN"}</span>
                  </div>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: 28 }}>
                Useful Links
              </div>
              {[
                {
                  label: "TARIC Consultation",
                  url: "https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp",
                  desc: "Official EU tariff database",
                },
                {
                  label: "Access2Markets",
                  url: "https://trade.ec.europa.eu/access-to-markets/en/content",
                  desc: "EU trade & market access portal",
                },
                {
                  label: "Luxembourg Customs (ADA)",
                  url: "https://douanes.public.lu",
                  desc: "Administration des Douanes et Accises",
                },
                {
                  label: "ECB Exchange Rates",
                  url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
                  desc: "Official ECB reference rates",
                },
              ].map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "block",
                    background: "#141414",
                    border: "1px solid #1e1e1e",
                    padding: "12px 16px",
                    borderRadius: 2,
                    textDecoration: "none",
                    marginBottom: 2,
                    transition: "border-color 0.2s",
                  }}
                >
                  <div style={{ color: "#c8a96e", fontSize: 13 }}>{link.label} ↗</div>
                  <div style={{ fontSize: 11, color: "#555", fontFamily: "'Courier Prime', monospace", marginTop: 2 }}>
                    {link.desc}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
