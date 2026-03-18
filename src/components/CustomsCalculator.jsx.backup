"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";

const LUXEMBURG_VAT = 0.17;

// Official Luxembourg ADA excise rates effective 01.01.2026
// Source: douanes.public.lu/fr/accises/taux-droits-accise.html
const EXCISE_RATES = {
  // Alcohol — €/hl per °Plato (3 production tiers)
  beer_small:            0.3966,  // brewery ≤ 50,000 hl/yr
  beer_medium:           0.4462,  // brewery ≤ 200,000 hl/yr
  beer_large:            0.7933,  // brewery > 200,000 hl/yr
  'still-wine':          0,       // LU applies EU 0-rate (14% VAT ≤13°, 17% >13°)
  'sparkling-wine':      0,       // LU applies EU 0-rate (17% VAT)
  intermediate_low:     47.0998,  // €/hl — intermediate ≤ 15° alc
  intermediate_high:    66.9313,  // €/hl — intermediate > 15° alc
  spirits:            1123.1042,  // €/hl pure alcohol (total incl. contributions)
  // Tobacco
  cigarettes_specific:   23.3914, // €/1000 units
  cigarettes_advalorem:   0.4814, // 48.14% of retail price
  cigarettes_minimum:   152.80,   // €/1000 minimum
  cigars_advalorem:       0.10,   // 10% of retail price
  cigars_minimum:        23.50,   // €/1000 pieces minimum
  fine_cut_specific:     26.40,   // €/kg
  fine_cut_advalorem:     0.356,  // 35.6% of retail price
  fine_cut_minimum:      77.90,   // €/kg minimum floor
  heated_tobacco_advalorem: 0.28, // 28% of retail price
  heated_tobacco_specific: 16.80, // €/kg
  eliquid:              120.00,   // €/L
  nicotine_pouches:      22.00,   // €/kg
  // Energy
  petrol:                0.5691,  // €/L — unleaded ≤ 10 mg/kg S (17% VAT)
  diesel:                0.4646,  // €/L — road use ≤ 10 mg/kg S (17% VAT)
  heating_fuel:          0.1302,  // €/L — fioul domestique (14% VAT)
  lpg:                   0.2362,  // €/kg — LPG fuel use (8% VAT)
};
// Schema-driven excise config — each category defines its inputs, formula, and VAT rate.
// To add a new category: add one entry here. Nothing else needs to change.
const EXCISE_SCHEMAS = {
  beer: {
    label: 'Beer', group: 'Alcohol', vatRate: 0.17,
    inputs: ['volume', 'plato', 'breweryTier'],
    calc(inp, R) {
      const rate = inp.breweryTier === 'small' ? R.beer_small
                 : inp.breweryTier === 'medium' ? R.beer_medium : R.beer_large;
      const hl = (inp.volume / 100).toFixed(2);
      return { duty: (inp.volume / 100) * (inp.plato || 0) * rate,
               note: `${inp.plato || 0}°P × ${hl} hl × €${rate}/hl/°P` };
    },
  },
  'still-wine': {
    label: 'Still Wine', group: 'Alcohol', vatRate: 0.17,
    inputs: ['volume'],
    calc(inp, R) {
      return { duty: (inp.volume / 100) * R['still-wine'], note: 'EU 0-rate — no excise duty in LU' };
    },
  },
  'sparkling-wine': {
    label: 'Sparkling Wine / Champagne', group: 'Alcohol', vatRate: 0.17,
    inputs: ['volume'],
    calc(inp, R) {
      return { duty: (inp.volume / 100) * R['sparkling-wine'], note: 'EU 0-rate — no excise duty in LU' };
    },
  },
  intermediate: {
    label: 'Intermediate Products', group: 'Alcohol', vatRate: 0.17,
    inputs: ['volume', 'above15'],
    calc(inp, R) {
      const rate = inp.above15 ? R.intermediate_high : R.intermediate_low;
      return { duty: (inp.volume / 100) * rate, note: `€${rate}/hl (${inp.above15 ? '>15°' : '≤15°'} alc)` };
    },
  },
  spirits: {
    label: 'Spirits / Liqueur', group: 'Alcohol', vatRate: 0.17,
    inputs: ['volume', 'abv'],
    calc(inp, R) {
      const hl = (inp.volume / 100).toFixed(2);
      return { duty: (inp.volume / 100) * ((inp.abv || 0) / 100) * R.spirits,
               note: `${inp.abv || 0}% ABV × ${hl} hl × €${R.spirits}/hl pure alc` };
    },
  },
  cigarettes: {
    label: 'Cigarettes', group: 'Tobacco', vatRate: 0.17,
    inputs: ['qty', 'retailPerUnit'],
    calc(inp, R) {
      const specific = (inp.qty / 1000) * R.cigarettes_specific;
      const adval    = inp.qty * (inp.retailPerUnit || 0) * R.cigarettes_advalorem;
      const floor    = (inp.qty / 1000) * R.cigarettes_minimum;
      const duty     = Math.max(specific + adval, floor);
      return { duty, note: duty <= floor + 0.001 ? `min €${R.cigarettes_minimum}/1000 units applies` : 'specific + 48.14% ad valorem' };
    },
  },
  cigars: {
    label: 'Cigars / Cigarillos', group: 'Tobacco', vatRate: 0.17,
    inputs: ['qty', 'retailPerUnit'],
    calc(inp, R) {
      const adval = inp.qty * (inp.retailPerUnit || 0) * R.cigars_advalorem;
      const floor = (inp.qty / 1000) * R.cigars_minimum;
      const duty  = Math.max(adval, floor);
      return { duty, note: duty <= floor + 0.001 ? `min €${R.cigars_minimum}/1000 pcs applies` : '10% ad valorem' };
    },
  },
  'fine-cut': {
    label: 'Fine-Cut Tobacco', group: 'Tobacco', vatRate: 0.17,
    inputs: ['weight', 'retailPerKg'],
    calc(inp, R) {
      const specific = inp.weight * R.fine_cut_specific;
      const adval    = inp.weight * (inp.retailPerKg || 0) * R.fine_cut_advalorem;
      const floor    = inp.weight * R.fine_cut_minimum;
      const duty     = Math.max(specific + adval, floor);
      return { duty, note: duty <= floor + 0.001 ? `min €${R.fine_cut_minimum}/kg applies` : `€${R.fine_cut_specific}/kg + 35.6% ad valorem` };
    },
  },
  'other-tobacco': {
    label: 'Other Tobacco', group: 'Tobacco', vatRate: 0.17,
    inputs: ['weight', 'retailPerKg'],
    calc(inp, R) {
      const specific = inp.weight * R.fine_cut_specific;
      const adval    = inp.weight * (inp.retailPerKg || 0) * R.fine_cut_advalorem;
      const floor    = inp.weight * R.fine_cut_minimum;
      const duty     = Math.max(specific + adval, floor);
      return { duty, note: duty <= floor + 0.001 ? `min €${R.fine_cut_minimum}/kg applies` : `€${R.fine_cut_specific}/kg + 35.6% ad valorem` };
    },
  },
  'heated-tobacco': {
    label: 'Heated Tobacco Products', group: 'Tobacco', vatRate: 0.17,
    inputs: ['weight', 'retailPerKg'],
    calc(inp, R) {
      const specific = inp.weight * R.heated_tobacco_specific;
      const adval    = inp.weight * (inp.retailPerKg || 0) * R.heated_tobacco_advalorem;
      return { duty: specific + adval, note: `€${R.heated_tobacco_specific}/kg specific + 28% ad valorem` };
    },
  },
  eliquid: {
    label: 'E-Liquid (vapes)', group: 'Tobacco', vatRate: 0.17,
    inputs: ['volume'],
    calc(inp, R) {
      return { duty: inp.volume * R.eliquid, note: `€${R.eliquid}/L` };
    },
  },
  'nicotine-pouches': {
    label: 'Nicotine Pouches', group: 'Tobacco', vatRate: 0.17,
    inputs: ['weight'],
    calc(inp, R) {
      return { duty: inp.weight * R.nicotine_pouches, note: `€${R.nicotine_pouches}/kg` };
    },
  },
  petrol: {
    label: 'Petrol (unleaded)', group: 'Energy', vatRate: 0.17,
    inputs: ['volume'],
    calc(inp, R) { return { duty: inp.volume * R.petrol, note: `€${R.petrol}/L` }; },
  },
  diesel: {
    label: 'Diesel', group: 'Energy', vatRate: 0.17,
    inputs: ['volume'],
    calc(inp, R) { return { duty: inp.volume * R.diesel, note: `€${R.diesel}/L` }; },
  },
  'heating-fuel': {
    label: 'Heating Fuel', group: 'Energy', vatRate: 0.14,
    inputs: ['volume'],
    calc(inp, R) { return { duty: inp.volume * R.heating_fuel, note: `€${R.heating_fuel}/L (14% VAT)` }; },
  },
  lpg: {
    label: 'LPG', group: 'Energy', vatRate: 0.08,
    inputs: ['weight'],
    calc(inp, R) { return { duty: inp.weight * R.lpg, note: `€${R.lpg}/kg (8% VAT)` }; },
  },
};

// ─── CBAM (Carbon Border Adjustment Mechanism) — EU Regulation 2023/956 ────────
// Phase-in factor = 1 − share of free EU ETS allowances still in circulation
const CBAM_FACTOR = {
  2026: 0.025, 2027: 0.050, 2028: 0.100, 2029: 0.225,
  2030: 0.485, 2031: 0.730, 2032: 0.865, 2033: 0.980, 2034: 1.000,
};

// Default embedded emission factors (tCO₂e / tonne or MWh) — pre-markup
// Source: EU Implementing Regulation 2025/2621
const CBAM_DEFAULT_EMISSIONS = {
  steel:       { CN: 3.486, IN: 4.697, RU: 3.531, TR: 2.541, UA: 2.476, US: 1.618, EG: 3.210, BR: 2.230, KR: 2.150, default: 2.900 },
  aluminium:   { CN: 14.1,  IN: 9.6,   RU: 4.2,   TR: 5.3,   NO: 0.7,   CA: 1.8,   EG: 4.8,   default: 6.700 },
  cement:      { UA: 1.518, EG: 1.419, TR: 0.895, CN: 1.051, IN: 1.131, MA: 1.102, DZ: 1.089,  default: 0.870 },
  fertilisers: { RU: 2.700, CN: 6.800, EG: 2.100, TN: 2.300, MA: 2.600, SA: 2.200, default: 3.500 },
  hydrogen:    { RU: 8.900, CN: 9.000, US: 8.800, NO: 0.500, SA: 9.100, default: 8.900 },
  electricity:  { CN: 0.555, IN: 0.708, RU: 0.334, TR: 0.328, UA: 0.344, BA: 0.685, RS: 0.540, default: 0.350 },
};

// EU ETS product benchmarks (tCO₂e/tonne) — best-available technology reference
const CBAM_BENCHMARKS = {
  steel_bf_bof:       1.370,
  steel_dri_eaf:      0.481,
  steel_scrap_eaf:    0.072,
  aluminium_primary:  1.423,
  aluminium_secondary:0.091,
  cement:             0.766,
  ammonia_ng:         1.522,
};

// Default value markup applied on top of base default emission factors
// (penalises use of default values vs verified actual emissions)
const CBAM_MARKUP = (year, isFertiliser) =>
  isFertiliser ? 1.01 : year <= 2026 ? 1.10 : year === 2027 ? 1.20 : 1.30;

const CBAM_SECTORS = {
  steel:       { label: 'Steel & Iron',        cnCodes: 'CN 7201–7326',   unit: 'tonne', indirectIncluded: false,
    routes: [
      { value: 'bf_bof',     label: 'BF/BOF — Blast Furnace + Basic Oxygen Furnace', benchmark: 'steel_bf_bof' },
      { value: 'dri_eaf',    label: 'DRI/EAF — Direct Reduced Iron + Electric Arc Furnace', benchmark: 'steel_dri_eaf' },
      { value: 'scrap_eaf',  label: 'Scrap EAF — Electric Arc Furnace (scrap-fed)', benchmark: 'steel_scrap_eaf' },
    ] },
  aluminium:   { label: 'Aluminium',           cnCodes: 'CN 7601–7616',   unit: 'tonne', indirectIncluded: false,
    routes: [
      { value: 'primary',    label: 'Primary aluminium (electrolysis)', benchmark: 'aluminium_primary' },
      { value: 'secondary',  label: 'Secondary aluminium (recycled scrap)', benchmark: 'aluminium_secondary' },
    ] },
  cement:      { label: 'Cement',              cnCodes: 'CN 2523',        unit: 'tonne', indirectIncluded: true,  routes: null, benchmark: 'cement' },
  fertilisers: { label: 'Fertilisers (N-based)',cnCodes: 'CN 2814, 3102, 3105', unit: 'tonne', indirectIncluded: true, routes: null, isFertiliser: true },
  hydrogen:    { label: 'Hydrogen',             cnCodes: 'CN 2804 10 00', unit: 'tonne', indirectIncluded: false,
    routes: [
      { value: 'smr',         label: 'Steam Methane Reforming (grey/blue H₂)', benchmark: 'ammonia_ng' },
      { value: 'electrolysis',label: 'Electrolysis (green H₂, low-emission)', benchmark: null },
    ] },
  electricity: { label: 'Electricity',          cnCodes: 'CN 2716 00 00', unit: 'MWh',   indirectIncluded: true, routes: null, noDeMinimis: true },
};

const CBAM_COUNTRIES = [
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'RU', name: 'Russia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'US', name: 'United States' },
  { code: 'EG', name: 'Egypt' },
  { code: 'MA', name: 'Morocco' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'NO', name: 'Norway' },
  { code: 'CA', name: 'Canada' },
  { code: 'BR', name: 'Brazil' },
  { code: 'KR', name: 'South Korea' },
  { code: 'BA', name: 'Bosnia & Herzegovina' },
  { code: 'RS', name: 'Serbia' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'default', name: 'Other / Unknown' },
];

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
        border: "2px solid rgba(16,185,129,0.25)",
        borderTopColor: "#10b981",
        borderRadius: "50%",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}

export default function CustomsCalculator({ user }) {
  const [tab, setTab] = useState("calculator");
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
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateDate, setRateDate] = useState(null);
  const [hsResult, setHsResult] = useState(null);
  const [hsLoading, setHsLoading] = useState(false);
  const [dutyRateSource, setDutyRateSource] = useState(null);
  const [dutyRateLoading, setDutyRateLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [favourites, setFavourites] = useState([]);
  const [favLoading, setFavLoading] = useState(false);
  const [savedCodes, setSavedCodes] = useState(new Set());
  const [allRates, setAllRates] = useState({});
  const [allRatesDate, setAllRatesDate] = useState(null);
  const [allRatesLoading, setAllRatesLoading] = useState(false);
  const [fxAmount, setFxAmount] = useState("1");
  const [fxFrom, setFxFrom] = useState("USD");
  const [fxTo, setFxTo] = useState("EUR");

  const [exciseCategory, setExciseCategory] = useState('beer');
  const [exciseInputs, setExciseInputs] = useState({ breweryTier: 'large', above15: false });
  const [exciseCifValue, setExciseCifValue] = useState('');
  const [exciseResult, setExciseResult] = useState(null);
  const [exciseRates, setExciseRates] = useState(EXCISE_RATES);
  const [exciseRatesLastChecked, setExciseRatesLastChecked] = useState(null);
  const setExciseInput = (key, val) => setExciseInputs(prev => ({ ...prev, [key]: val }));

  const [cbamSector, setCbamSector] = useState('steel');
  const [cbamCountry, setCbamCountry] = useState('CN');
  const [cbamTonnes, setCbamTonnes] = useState('');
  const [cbamMode, setCbamMode] = useState('default');
  const [cbamActualEmissions, setCbamActualEmissions] = useState('');
  const [cbamEtsPrice, setCbamEtsPrice] = useState('70');
  const [cbamCarbonPaid, setCbamCarbonPaid] = useState('');
  const [cbamRoute, setCbamRoute] = useState('bf_bof');
  const [cbamYear, setCbamYear] = useState(2026);
  const [cbamResult, setCbamResult] = useState(null);

  const resultRef = useRef(null);

  const hasPref = ORIGIN_AGREEMENTS[originCountry]?.pref;

  useEffect(() => {
    if (currency === "EUR") {
      setExchangeRate(1);
      setRateDate(new Date().toISOString().split("T")[0]);
      return;
    }
    const controller = new AbortController();
    setRateLoading(true);
    fetch(`https://api.frankfurter.app/latest?from=${currency}&to=EUR`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setExchangeRate(d.rates?.EUR);
        setRateDate(d.date);
        setRateLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError("Could not fetch exchange rate. Check connection.");
          setRateLoading(false);
        }
      });
    return () => controller.abort();
  }, [currency]);

  useEffect(() => {
    const controller = new AbortController();
    setAllRatesLoading(true);
    fetch("https://api.frankfurter.app/latest?from=EUR", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setAllRates(d.rates || {});
        setAllRatesDate(d.date);
        setAllRatesLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setAllRatesLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    fetch('/api/excise-rates')
      .then(r => r.json())
      .then(d => {
        if (d.rates) {
          setExciseRates(d.rates);
          setExciseRatesLastChecked(d.lastChecked);
        }
      })
      .catch(() => {/* keep hardcoded fallback */});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/favourites", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setFavourites(data);
          setSavedCodes(new Set(data.map((f) => f.hsCode)));
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") console.error("Failed to load favourites", err);
      });
    return () => controller.abort();
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
    const valEUR = val * rate;
    const frEUR = fr * rate;
    const insEUR = ins * rate;
    let cifEUR = valEUR;
    if (incoterm === "FOB" || incoterm === "EXW") cifEUR = valEUR + frEUR + insEUR;
    else if (incoterm === "CFR") cifEUR = valEUR + insEUR;
    const dutyFree = cifEUR <= 150;
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
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const calculateExcise = () => {
    const schema = EXCISE_SCHEMAS[exciseCategory];
    if (!schema) return;
    const inp = {
      volume:        parseFloat(exciseInputs.volume)        || 0,
      plato:         parseFloat(exciseInputs.plato)         || 0,
      abv:           parseFloat(exciseInputs.abv)           || 0,
      qty:           parseFloat(exciseInputs.qty)           || 0,
      weight:        parseFloat(exciseInputs.weight)        || 0,
      retailPerUnit: parseFloat(exciseInputs.retailPerUnit) || 0,
      retailPerKg:   parseFloat(exciseInputs.retailPerKg)   || 0,
      breweryTier:   exciseInputs.breweryTier || 'large',
      above15:       !!exciseInputs.above15,
    };
    const { duty, note } = schema.calc(inp, exciseRates);
    const cifVal = parseFloat(exciseCifValue) || 0;
    const vatBase = cifVal + (duty || 0);
    const vatAmt = vatBase * schema.vatRate;
    setExciseResult({
      duty: duty || 0,
      note: note || '',
      cifVal,
      vatAmt,
      vatRate: schema.vatRate * 100,
      total: (duty || 0) + vatAmt,
      label: schema.label,
    });
  };

  const calculateCBAM = () => {
    const tonnes = parseFloat(cbamTonnes) || 0;
    const etsPrice = parseFloat(cbamEtsPrice) || 70;
    const carbonPaid = parseFloat(cbamCarbonPaid) || 0;
    if (!tonnes) return;

    const sector = CBAM_SECTORS[cbamSector];
    const factor = CBAM_FACTOR[cbamYear] ?? CBAM_FACTOR[2026];
    const isFertiliser = !!sector.isFertiliser;
    const markup = CBAM_MARKUP(cbamYear, isFertiliser);

    let totalEmbedded, defaultPerTonne, emissionsSource;
    if (cbamMode === 'actual') {
      const perTonne = parseFloat(cbamActualEmissions) || 0;
      totalEmbedded = perTonne * tonnes;
      defaultPerTonne = null;
      emissionsSource = `Actual verified: ${perTonne.toFixed(3)} tCO₂e/${sector.unit} × ${tonnes} ${sector.unit}`;
    } else {
      const defaults = CBAM_DEFAULT_EMISSIONS[cbamSector] || {};
      const base = defaults[cbamCountry] ?? defaults.default ?? 0;
      defaultPerTonne = base * markup;
      totalEmbedded = defaultPerTonne * tonnes;
      emissionsSource = `Default: ${base.toFixed(3)} × ${markup} markup = ${defaultPerTonne.toFixed(3)} tCO₂e/${sector.unit}`;
    }

    const coveredEmissions = totalEmbedded * factor;
    const grossCost = coveredEmissions * etsPrice;
    const netCost = Math.max(0, grossCost - carbonPaid);
    const perUnitCost = tonnes > 0 ? netCost / tonnes : 0;
    const deMinimis = !sector.noDeMinimis && cbamSector !== 'electricity' && tonnes < 50;

    // Benchmark comparison (only for default mode with a known route benchmark)
    let benchmarkEmissions = null;
    if (cbamMode === 'default') {
      if (sector.routes) {
        const route = sector.routes.find(r => r.value === cbamRoute);
        benchmarkEmissions = route?.benchmark ? CBAM_BENCHMARKS[route.benchmark] ?? null : null;
      } else if (sector.benchmark) {
        benchmarkEmissions = CBAM_BENCHMARKS[sector.benchmark] ?? null;
      }
    }

    setCbamResult({
      tonnes, totalEmbedded, factor, coveredEmissions,
      etsPrice, grossCost, carbonPaid, netCost, perUnitCost,
      deMinimis, emissionsSource, defaultPerTonne,
      benchmarkEmissions, year: cbamYear, sectorLabel: sector.label, unit: sector.unit,
    });
  };

  const downloadExcisePDF = async () => {
    if (!exciseResult) return;
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'excise',
        createdAt: new Date(),
        category: exciseResult.label,
        exciseDuty: exciseResult.duty,
        exciseNote: exciseResult.note,
        cifVal: exciseResult.cifVal,
        importVAT: exciseResult.vatAmt,
        vatRate: exciseResult.vatRate,
        total: exciseResult.total,
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `excise-${Date.now()}.pdf`; a.click();
    URL.revokeObjectURL(url);
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
      exciseDuty: 0,
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
        width: "100%",
        background: "#f0f7f4",
        color: "#111827",
        fontFamily: "var(--font-dm-sans), sans-serif",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input, select { background: #fff; border: 1px solid var(--border); color: var(--foreground); padding: 8px 12px; font-family: var(--font-courier-prime), monospace; font-size: 13px; border-radius: 2px; width: 100%; outline: none; transition: border-color 0.2s; }
        input:focus, select:focus { border-color: var(--gold); }
        select option { background: #fff; color: var(--foreground); }
        button { cursor: pointer; font-family: var(--font-dm-sans), sans-serif; }
        .tag { display: inline-flex; align-items: center; justify-content: center; min-width: 90px; padding: 5px 10px; border-radius: 3px; font-size: 12px; font-weight: 700; font-family: var(--font-courier-prime), monospace; letter-spacing: 0.5px; backdrop-filter: blur(6px); text-align: center; }
        .tag-green { background: rgba(46, 110, 46, 0.1); border: 1px solid #2e6e2e; color: #2e6e2e; }
        .tag-red { background: rgba(220, 38, 38, 0.1); border: 1px solid #dc2626; color: #dc2626; }
        .tag-amber { background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; color: #10b981; }
        .result-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
        .result-row:last-child { border-bottom: none; }
        .section-label { font-family: var(--font-oswald), sans-serif; font-size: 10px; text-transform: uppercase; letter-spacing: 4px; color: var(--muted); margin-bottom: 12px; font-weight: 400; }
        .btn-gold { background: linear-gradient(135deg, var(--gold-hi), var(--gold)); color: #fff; border: none; transition: all 0.2s; cursor: pointer; }
        .btn-gold:hover { background: linear-gradient(135deg, #a7f3d0, #059669); box-shadow: 0 4px 20px rgba(16,185,129,0.3); transform: translateY(-1px); }
        .btn-gold:active { transform: translateY(0); box-shadow: none; }
        .btn-gold:disabled { background: #e2e8f0; color: #9ca3af; box-shadow: none; transform: none; cursor: default; }
        .btn-ghost { background: none; transition: color 0.2s, border-color 0.2s, transform 0.1s; cursor: pointer; }
        .btn-ghost:hover { border-color: var(--gold) !important; color: var(--gold) !important; transform: translateY(-1px); }
        .btn-ghost:active { transform: translateY(0); }
        .btn-ghost:disabled { opacity: 0.3; cursor: default; transform: none; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        .tabs-bar { display: flex; justify-content: center; border-bottom: 1px solid var(--border); padding: 0 16px; overflow-x: auto; scrollbar-width: none; background: #e8f4f0; }
        .tabs-bar::-webkit-scrollbar { display: none; }
        .tab-btn { padding: 14px 24px; background: none; border: none; font-size: 11px; letter-spacing: 3px; word-spacing: -3px; text-transform: uppercase; white-space: nowrap; margin-bottom: -1px; transition: color 0.2s, background 0.2s; flex-shrink: 0; border-radius: 4px 4px 0 0; position: relative; font-family: var(--font-oswald), sans-serif; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; text-align: center; }
        .tab-btn:hover { color: var(--foreground) !important; background: rgba(0,0,0,0.03); }
        .tab-btn::after { content: ''; position: absolute; bottom: -1px; left: 50%; right: 50%; height: 2px; background: var(--gold); transition: left 0.2s, right 0.2s; }
        .tab-btn:hover::after { left: 16px; right: 16px; }
        .page-header { padding: 0 24px; height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #e8f4f0; margin-top: 20px; margin-bottom: 16px; }
        .page-content { padding: 28px 24px; max-width: 900px; margin: 0 auto; }
        .header-right { text-align: right; flex-shrink: 0; }
        .fx-grid { display: grid; grid-template-columns: 52px 1fr 1fr 1fr; gap: 0; }
        .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        .ref-link:hover { border-color: rgba(16,185,129,0.3) !important; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .ref-link { transition: border-color 0.2s, transform 0.15s, box-shadow 0.15s; }
        @media (max-width: 700px) {
          .two-col { grid-template-columns: 1fr; gap: 24px; }
          .ref-grid { grid-template-columns: 1fr; gap: 24px; }
          .tabs-bar { padding: 0 8px; justify-content: flex-start; }
          .tab-btn { padding: 12px 14px; font-size: 10px; letter-spacing: 1px; word-spacing: -1px; }
          .page-header { padding: 0 16px; }
          .page-content { padding: 16px; }
          .header-right { display: none; }
          .fx-two-col { grid-template-columns: 1fr !important; }
          .fx-grid { grid-template-columns: 44px 1fr 80px; }
          .fx-grid .fx-hide { display: none; }
        }
      `}</style>

      {/* Header */}
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <svg width="32" height="32" viewBox="0 0 56 56" fill="none">
            <rect width="56" height="56" rx="11" fill="#1f2937" />
            <rect x="25" y="8" width="6" height="18" rx="3" fill="url(#hGold)" />
            <path
              d="M13 22L28 39L43 22"
              stroke="url(#hGold)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="10" y="43" width="36" height="4" rx="2" fill="url(#hGold)" />
            <defs>
              <linearGradient id="hGold" x1="13" y1="8" x2="43" y2="47" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
            </defs>
          </svg>
          <span
            style={{
              fontFamily: "var(--font-oswald), sans-serif",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: "#111827",
            }}
          >
            Dutify
          </span>
        </div>
        <div className="header-right">
          <div
            style={{
              fontFamily: "var(--font-oswald), sans-serif",
              fontSize: 10,
              color: "#9ca3af",
              letterSpacing: 3,
              textTransform: "uppercase",
            }}
          >
            Luxembourg · VAT 17%
          </div>
          {rateDate && currency !== "EUR" && (
            <div style={{ fontSize: 10, color: "#10b98188", fontFamily: "var(--font-courier-prime), monospace", marginTop: 4 }}>
              FX: {currency}/EUR {exchangeRate?.toFixed(5)} · {rateDate}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {user?.role === "ADMIN" && (
              <a
                href="/admin"
                style={{
                  fontFamily: "var(--font-oswald), sans-serif",
                  fontSize: 10,
                  color: "#6b7280",
                  letterSpacing: 2,
                  textDecoration: "none",
                  padding: "4px 10px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 2,
                  transition: "color 0.2s, border-color 0.2s",
                  textTransform: "uppercase",
                }}
                onMouseEnter={(e) => {
                  e.target.style.color = "#10b981";
                  e.target.style.borderColor = "#10b98144";
                }}
                onMouseLeave={(e) => {
                  e.target.style.color = "#6b7280";
                  e.target.style.borderColor = "#e2e8f0";
                }}
              >
                admin
              </a>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              style={{
                fontFamily: "var(--font-oswald), sans-serif",
                fontSize: 10,
                color: "#6b7280",
                letterSpacing: 2,
                background: "none",
                border: "1px solid #e2e8f0",
                borderRadius: 2,
                padding: "4px 10px",
                cursor: "pointer",
                transition: "color 0.2s, border-color 0.2s",
                textTransform: "uppercase",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#dc2626";
                e.currentTarget.style.borderColor = "#fca5a5";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6b7280";
                e.currentTarget.style.borderColor = "#e2e8f0";
              }}
            >
              logout
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-bar">
        {["calculator", "excise", "cbam", "hs-lookup", "fx", "reference"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="tab-btn"
            style={{
              color: tab === t ? "var(--gold)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--gold)" : "2px solid transparent",
              background: tab === t ? "rgba(16,185,129,0.07)" : undefined,
            }}
          >
            {t === "calculator" ? "Calc" : t === "excise" ? "Excise" : t === "cbam" ? "CBAM" : t === "hs-lookup" ? "HS Lookup" : t === "fx" ? "FX Rates" : "Reference"}
          </button>
        ))}
      </div>

      <div className="page-content">
        {/* CALCULATOR TAB */}
        {tab === "calculator" && (
          <div className="two-col">
            <div>
              <div className="section-label">Shipment Details</div>
              <div style={{ display: "grid", gap: 16 }}>
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
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
                        color: hasPref ? "#2e6e2e" : "#6b7280",
                        marginTop: 6,
                        fontFamily: "var(--font-courier-prime), monospace",
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

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
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
                  <div
                    style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}
                  >
                    {INCOTERMS_CIF[incoterm]?.note}
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
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
                    <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>
                      {rateLoading ? <Spinner /> : currency === "EUR" ? "" : `× ${exchangeRate?.toFixed(4)}`}
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
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
                          color: "#6b7280",
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
                          color: "#6b7280",
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
                        color: "#6b7280",
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
                      color: "#6b7280",
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
                        border: "1px solid #e2e8f0",
                        color: dutyRateLoading ? "#6b7280" : "#10b981",
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
                        border: "1px solid #e2e8f0",
                        color: "#10b981",
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
                      color: "#6b7280",
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
                          fontFamily: "var(--font-courier-prime), monospace",
                          fontSize: 10,
                          color: "#10b981",
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
                    style={{ borderColor: dutyRateSource?.aiGenerated ? "rgba(16,185,129,0.3)" : undefined }}
                  />
                  {dutyRateSource?.aiGenerated && !dutyRateSource.error && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "10px 14px",
                        background: "#f0fff4",
                        border: "1px solid rgba(16,185,129,0.2)",
                        borderRadius: 2,
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#10b981", marginBottom: 4 }}>
                        ⚠ AI-estimated rate — please verify before use
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          fontFamily: "var(--font-courier-prime), monospace",
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
                          color: "#10b981",
                          fontFamily: "var(--font-courier-prime), monospace",
                        }}
                      >
                        → Verify official rate in TARIC ↗
                      </a>
                    </div>
                  )}
                  {dutyRateSource?.error && (
                    <div
                      style={{ marginTop: 6, fontSize: 11, color: "#dc2626", fontFamily: "var(--font-courier-prime), monospace" }}
                    >
                      Could not look up rate — enter manually and verify in TARIC.
                    </div>
                  )}
                  {!dutyRateSource && !dutyRateLoading && (
                    <div
                      style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}
                    >
                      Enter HS code above to auto-suggest · or{" "}
                      <a
                        href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp"
                        target="_blank"
                        rel="noopener"
                        style={{ color: "#10b981" }}
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
                    fontFamily: "var(--font-oswald), sans-serif",
                    width: "100%",
                  }}
                >
                  Calculate Duties
                </button>
              </div>
            </div>

            {/* Right: Results */}
            <div ref={resultRef}>
              <div className="section-label">Duty Breakdown</div>
              {!result && (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 2,
                    padding: "44px 24px",
                    textAlign: "center",
                    background: "#f0f7f4",
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.25, lineHeight: 1 }}>↓</div>
                  <div
                    style={{
                      fontFamily: "var(--font-oswald), sans-serif",
                      fontSize: 11,
                      letterSpacing: 4,
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 8,
                    }}
                  >
                    Duty Breakdown
                  </div>
                  <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
                    Fill in shipment details and click<br />
                    <strong style={{ fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", letterSpacing: 1 }}>
                      Calculate Duties
                    </strong>
                  </div>
                </div>
              )}
              {result && (
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  {result.dutyFree && (
                    <div
                      style={{
                        background: "#e8f5e8",
                        border: "1px solid #a8d8a8",
                        padding: "12px 16px",
                        borderRadius: 2,
                        marginBottom: 16,
                        fontSize: 13,
                        color: "#2e6e2e",
                      }}
                    >
                      ✓ CIF value ≤ €150 — Customs duties waived (low-value goods threshold). Import VAT still applies.
                    </div>
                  )}
                  {hasPref && hasProofOfOrigin && (
                    <div
                      style={{
                        background: "#e8f5e8",
                        border: "1px solid #a8d8a8",
                        padding: "12px 16px",
                        borderRadius: 2,
                        marginBottom: 16,
                        fontSize: 13,
                        color: "#2e6e2e",
                      }}
                    >
                      ✓ Preferential duty rate applied (0%) — valid proof of origin declared
                    </div>
                  )}
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                    <div className="result-row">
                      <span style={{ color: "#6b7280", fontSize: 13 }}>Goods value</span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                        € {fmt(result.valEUR)}
                      </span>
                    </div>
                    {(incoterm === "FOB" || incoterm === "EXW") && (
                      <>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>+ Freight</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            € {fmt(result.frEUR)}
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>+ Insurance</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            € {fmt(result.insEUR)}
                          </span>
                        </div>
                      </>
                    )}
                    {incoterm === "CFR" && (
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>+ Insurance</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                          € {fmt(result.insEUR)}
                        </span>
                      </div>
                    )}
                    <div
                      className="result-row"
                      style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14, marginTop: 4 }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>
                        CIF Value (customs base)
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 14, color: "#10b981" }}>
                        € {fmt(result.cifEUR)}
                      </span>
                    </div>
                    <div style={{ height: 1, background: "#e2e8f0", margin: "12px 0" }} />
                    <div className="result-row">
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        Customs duty
                        <span
                          style={{
                            fontFamily: "var(--font-courier-prime), monospace",
                            marginLeft: 8,
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          {result.dutyFree ? "(waived)" : `${result.effectiveDutyRate.toFixed(2)}%`}
                        </span>
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                        € {fmt(result.customsDuty)}
                      </span>
                    </div>
                    <div className="result-row" style={{ borderBottom: "none" }}>
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        Import VAT (LU)
                        <span
                          style={{
                            fontFamily: "var(--font-courier-prime), monospace",
                            marginLeft: 8,
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          17% on CIF + duties
                        </span>
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                        € {fmt(result.importVAT)}
                      </span>
                    </div>
                  </div>

                  {/* Hero total */}
                  <div
                    style={{
                      marginTop: 8,
                      background: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(16,185,129,0.08))",
                      border: "1px solid rgba(16,185,129,0.3)",
                      borderRadius: 2,
                      padding: "18px 20px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 16,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: 4,
                          textTransform: "uppercase",
                          fontFamily: "var(--font-oswald), sans-serif",
                          color: "var(--muted)",
                          marginBottom: 6,
                        }}
                      >
                        Total Landed Cost
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-courier-prime), monospace",
                          color: "#6b7280",
                          lineHeight: 1.7,
                        }}
                      >
                        Duties: {(((result.customsDuty + result.importVAT) / result.valEUR) * 100).toFixed(1)}% of goods
                        value
                        <br />
                        VAT base: € {fmt(result.vatBase)}
                        {currency !== "EUR" && (
                          <>
                            <br />1 {currency} = {exchangeRate?.toFixed(5)} EUR · {rateDate}
                          </>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-courier-prime), monospace",
                        fontSize: 30,
                        color: "var(--gold)",
                        fontWeight: 700,
                        letterSpacing: 1,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      € {fmt(result.total)}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 16px",
                      background: "#f0fff4",
                      border: "1px solid #e2e8f0",
                      borderRadius: 2,
                      fontSize: 12,
                      color: "#6b7280",
                      lineHeight: 1.6,
                    }}
                  >
                    <strong style={{ color: "#6b7280" }}>⚠ Important:</strong> This is an estimate only. Actual duties
                    are determined by Luxembourg customs (Administration des Douanes). Anti-dumping or other
                    special duties may not be included. Always verify HS code and rates in{" "}
                    <a
                      href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp"
                      target="_blank"
                      rel="noopener"
                      style={{ color: "#10b981" }}
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
                      border: "1px solid #e2e8f0",
                      color: "#10b981",
                      fontSize: 12,
                      letterSpacing: 3,
                      textTransform: "uppercase",
                      borderRadius: 2,
                      background: "none",
                      fontFamily: "var(--font-oswald), sans-serif",
                    }}
                  >
                    ↓ Export PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EXCISE TAB */}
        {tab === "excise" && (
          <div className="two-col">
            <div>
              <div className="section-label">Excise Duty Calculator — Luxembourg</div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24, display: "grid", gap: 16 }}>

                {/* Category */}
                <div>
                  <label style={{ fontSize: 11, color: "#6b7280", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 6 }}>Category</label>
                  <select
                    value={exciseCategory}
                    onChange={(e) => { setExciseCategory(e.target.value); setExciseInputs({ breweryTier: 'large', above15: false }); setExciseResult(null); }}
                  >
                    {['Alcohol', 'Tobacco', 'Energy'].map(group => (
                      <optgroup key={group} label={group}>
                        {Object.entries(EXCISE_SCHEMAS).filter(([, s]) => s.group === group).map(([key, s]) => (
                          <option key={key} value={key}>{s.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Schema-driven inputs */}
                {(() => {
                  const schema = EXCISE_SCHEMAS[exciseCategory];
                  if (!schema) return null;
                  const inp = schema.inputs;
                  const lbl = { fontSize: 11, color: "#6b7280", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 6 };
                  return (<>
                    {inp.includes('volume') && (
                      <div><label style={lbl}>Volume (litres)</label>
                        <input type="number" placeholder="e.g. 100" min="0" step="0.1"
                          value={exciseInputs.volume ?? ''} onChange={(e) => setExciseInput('volume', e.target.value)} /></div>
                    )}
                    {inp.includes('plato') && (
                      <div><label style={lbl}>Original Gravity (°Plato)</label>
                        <input type="number" placeholder="e.g. 12" min="0" max="30" step="0.1"
                          value={exciseInputs.plato ?? ''} onChange={(e) => setExciseInput('plato', e.target.value)} /></div>
                    )}
                    {inp.includes('breweryTier') && (
                      <div><label style={lbl}>Brewery Annual Output</label>
                        <select value={exciseInputs.breweryTier || 'large'} onChange={(e) => setExciseInput('breweryTier', e.target.value)}>
                          <option value="large">&gt; 200,000 hl/yr — €0.7933/hl/°P</option>
                          <option value="medium">≤ 200,000 hl/yr — €0.4462/hl/°P</option>
                          <option value="small">≤ 50,000 hl/yr — €0.3966/hl/°P</option>
                        </select></div>
                    )}
                    {inp.includes('abv') && (
                      <div><label style={lbl}>Alcohol % vol (ABV)</label>
                        <input type="number" placeholder="e.g. 40" min="0" max="100" step="0.1"
                          value={exciseInputs.abv ?? ''} onChange={(e) => setExciseInput('abv', e.target.value)} /></div>
                    )}
                    {inp.includes('above15') && (
                      <div><label style={lbl}>Alcoholic Strength</label>
                        <select value={exciseInputs.above15 ? 'high' : 'low'} onChange={(e) => setExciseInput('above15', e.target.value === 'high')}>
                          <option value="low">≤ 15° alc — €47.10/hl</option>
                          <option value="high">&gt; 15° alc — €66.93/hl</option>
                        </select></div>
                    )}
                    {inp.includes('qty') && (
                      <div><label style={lbl}>Quantity (units)</label>
                        <input type="number" placeholder="e.g. 1000" min="0" step="1"
                          value={exciseInputs.qty ?? ''} onChange={(e) => setExciseInput('qty', e.target.value)} /></div>
                    )}
                    {inp.includes('weight') && (
                      <div><label style={lbl}>Weight (kg)</label>
                        <input type="number" placeholder="e.g. 10" min="0" step="0.1"
                          value={exciseInputs.weight ?? ''} onChange={(e) => setExciseInput('weight', e.target.value)} /></div>
                    )}
                    {inp.includes('retailPerUnit') && (
                      <div><label style={lbl}>Retail Price per Unit (€)</label>
                        <input type="number" placeholder="e.g. 0.35" min="0" step="0.01"
                          value={exciseInputs.retailPerUnit ?? ''} onChange={(e) => setExciseInput('retailPerUnit', e.target.value)} /></div>
                    )}
                    {inp.includes('retailPerKg') && (
                      <div><label style={lbl}>Retail Price per kg (€) — optional</label>
                        <input type="number" placeholder="leave blank → minimum floor applies" min="0" step="0.01"
                          value={exciseInputs.retailPerKg ?? ''} onChange={(e) => setExciseInput('retailPerKg', e.target.value)} /></div>
                    )}
                  </>);
                })()}

                {/* Optional CIF value for VAT calculation */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                  <label style={{ fontSize: 11, color: "#6b7280", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Declared Goods Value (CIF, €) — optional
                  </label>
                  <input type="number" placeholder="For VAT calculation on goods + excise" min="0" step="0.01"
                    value={exciseCifValue} onChange={(e) => setExciseCifValue(e.target.value)} />
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                    If provided, import VAT ({EXCISE_SCHEMAS[exciseCategory]?.vatRate * 100 ?? 17}%) is calculated on goods value + excise.
                  </div>
                </div>

                {/* Stale rates notice */}
                <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.5 }}>
                  {exciseRatesLastChecked && (() => {
                    const daysOld = Math.floor((Date.now() - new Date(exciseRatesLastChecked)) / 86400000);
                    const stale = daysOld > 14;
                    return (
                      <span style={{ color: stale ? "#dc2626" : "#6b7280" }}>
                        {stale ? "⚠ " : ""}Rates last verified {daysOld === 0 ? "today" : `${daysOld}d ago`}
                        {stale ? " — may be outdated" : ""} ·{" "}
                      </span>
                    );
                  })()}
                  Verify at{" "}
                  <a href="https://douanes.public.lu/fr/accises/taux-droits-accise.html" target="_blank" rel="noopener" style={{ color: "#10b981" }}>
                    ADA rate tables ↗
                  </a>
                </div>

                <button
                  onClick={calculateExcise}
                  className="btn-gold"
                  style={{ padding: "14px", fontSize: 13, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, borderRadius: 2, fontFamily: "var(--font-oswald), sans-serif", width: "100%" }}
                >
                  Calculate Excise
                </button>
              </div>
            </div>

            {/* Result panel */}
            <div>
              <div className="section-label">Result</div>
              {!exciseResult ? (
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24, color: "#6b7280", fontSize: 13, lineHeight: 1.7 }}>
                  Select a category, enter the quantities, and press Calculate Excise.
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24 }}>
                  {/* Category label */}
                  <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", marginBottom: 12 }}>
                    {exciseResult.label}
                  </div>

                  <div style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <div className="result-row">
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        Excise Duty (LU)
                        {exciseResult.note && (
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", marginLeft: 8, fontSize: 11, color: "#6b7280" }}>
                            {exciseResult.note}
                          </span>
                        )}
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                        € {fmt(exciseResult.duty)}
                      </span>
                    </div>
                    {exciseResult.cifVal > 0 && (
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Declared goods value</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>€ {fmt(exciseResult.cifVal)}</span>
                      </div>
                    )}
                    <div className="result-row" style={{ borderBottom: "none" }}>
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        Import VAT (LU)
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", marginLeft: 8, fontSize: 11, color: "#6b7280" }}>
                          {exciseResult.vatRate}% on {exciseResult.cifVal > 0 ? "goods + excise" : "excise only"}
                        </span>
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>€ {fmt(exciseResult.vatAmt)}</span>
                    </div>
                  </div>

                  {/* Total */}
                  <div style={{ marginTop: 8, background: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(16,185,129,0.08))", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 2, padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)" }}>
                      Total Excise + VAT
                    </div>
                    <div style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 28, color: "var(--gold)", fontWeight: 700 }}>
                      € {fmt(exciseResult.total)}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.5 }}>
                    Source: Official ADA Luxembourg rates, effective 01.01.2026
                  </div>

                  <button
                    onClick={downloadExcisePDF}
                    className="btn-ghost"
                    style={{ marginTop: 16, width: "100%", padding: "10px 14px", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", border: "1px solid #e2e8f0", borderRadius: 2, color: "#10b981", background: "none", cursor: "pointer" }}
                  >
                    Download PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CBAM TAB */}
        {tab === "cbam" && (() => {
          const lbl = { fontSize: 11, color: "#6b7280", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 6 };
          const sector = CBAM_SECTORS[cbamSector];
          const defaults = CBAM_DEFAULT_EMISSIONS[cbamSector] || {};
          const base = defaults[cbamCountry] ?? defaults.default;
          const markup = CBAM_MARKUP(cbamYear, !!sector?.isFertiliser);
          const previewFactor = base != null ? base * markup : null;
          const tonnes = parseFloat(cbamTonnes);
          const showDeMinimisHint = !isNaN(tonnes) && tonnes > 0 && tonnes < 50 && !sector?.noDeMinimis;

          return (
            <div className="two-col">
              {/* ── Left: Inputs ── */}
              <div>
                <div className="section-label">CBAM Carbon Cost Calculator</div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24, display: "grid", gap: 16 }}>

                  {/* Sector */}
                  <div>
                    <label style={lbl}>Product Sector</label>
                    <select
                      value={cbamSector}
                      onChange={(e) => {
                        const s = CBAM_SECTORS[e.target.value];
                        setCbamSector(e.target.value);
                        setCbamRoute(s?.routes?.[0]?.value || '');
                        setCbamResult(null);
                      }}
                    >
                      {Object.entries(CBAM_SECTORS).map(([k, s]) => (
                        <option key={k} value={k}>{s.label} · {s.cnCodes}</option>
                      ))}
                    </select>
                    {sector?.indirectIncluded && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                        Indirect emissions (electricity) included in default factors.
                      </div>
                    )}
                  </div>

                  {/* Country */}
                  <div>
                    <label style={lbl}>Country of Origin</label>
                    <select value={cbamCountry} onChange={(e) => setCbamCountry(e.target.value)}>
                      {CBAM_COUNTRIES.map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Import Year */}
                  <div>
                    <label style={lbl}>Import Year</label>
                    <select value={cbamYear} onChange={(e) => setCbamYear(parseInt(e.target.value))}>
                      {Object.entries(CBAM_FACTOR).map(([y, f]) => (
                        <option key={y} value={y}>{y} — {(f * 100).toFixed(1)}% CBAM factor</option>
                      ))}
                    </select>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                      Factor = % of embedded emissions requiring certificate coverage.
                    </div>
                  </div>

                  {/* Quantity */}
                  <div>
                    <label style={lbl}>Import Quantity ({sector?.unit || 'tonne'})</label>
                    <input
                      type="number" placeholder="e.g. 500" min="0" step="0.1"
                      value={cbamTonnes} onChange={(e) => setCbamTonnes(e.target.value)}
                    />
                    {showDeMinimisHint && (
                      <div style={{ fontSize: 11, color: "#2e6e2e", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                        ✓ Below 50 {sector?.unit} de minimis — CBAM obligation likely waived. Confirm with declarant.
                      </div>
                    )}
                  </div>

                  {/* Production route */}
                  {sector?.routes && (
                    <div>
                      <label style={lbl}>Production Route</label>
                      <select value={cbamRoute} onChange={(e) => setCbamRoute(e.target.value)}>
                        {sector.routes.map(r => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Emissions mode */}
                  <div>
                    <label style={lbl}>Embedded Emissions Source</label>
                    <select value={cbamMode} onChange={(e) => setCbamMode(e.target.value)}>
                      <option value="default">Default values (EU Reg. 2025/2621 + markup)</option>
                      <option value="actual">Actual verified emissions (accredited verifier)</option>
                    </select>
                    {cbamMode === 'default' && previewFactor != null && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.6 }}>
                        Base factor: {(base ?? 0).toFixed(3)} × {markup} markup = {previewFactor.toFixed(3)} tCO₂e/{sector?.unit || 't'}
                      </div>
                    )}
                  </div>

                  {cbamMode === 'actual' && (
                    <div>
                      <label style={lbl}>Actual Embedded Emissions (tCO₂e per {sector?.unit || 'tonne'})</label>
                      <input
                        type="number" placeholder="e.g. 1.85" min="0" step="0.001"
                        value={cbamActualEmissions} onChange={(e) => setCbamActualEmissions(e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                        Must be verified by an EU-accredited independent verifier.
                      </div>
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, display: "grid", gap: 16 }}>
                    {/* ETS price */}
                    <div>
                      <label style={lbl}>EU ETS Carbon Price (€/tCO₂)</label>
                      <input
                        type="number" placeholder="e.g. 70" min="0" step="0.5"
                        value={cbamEtsPrice} onChange={(e) => setCbamEtsPrice(e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                        Quarterly average ETS price applies. Check{" "}
                        <a href="https://www.eex.com/en/market-data/environmental-markets" target="_blank" rel="noopener" style={{ color: "#10b981" }}>EEX ↗</a>
                        {" "}for current prices.
                      </div>
                    </div>

                    {/* Carbon price already paid */}
                    <div>
                      <label style={lbl}>Carbon Price Already Paid Abroad (€) — optional</label>
                      <input
                        type="number" placeholder="0.00" min="0" step="0.01"
                        value={cbamCarbonPaid} onChange={(e) => setCbamCarbonPaid(e.target.value)}
                      />
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace" }}>
                        Effective carbon price paid in origin country. Deducted from CBAM cost.
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={calculateCBAM}
                    className="btn-gold"
                    style={{ padding: "14px", fontSize: 13, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, borderRadius: 2, fontFamily: "var(--font-oswald), sans-serif", width: "100%" }}
                  >
                    Calculate CBAM
                  </button>
                </div>

                {/* Key dates reference */}
                <div style={{ marginTop: 16, background: "#f0f7f4", border: "1px solid #e2e8f0", borderRadius: 2, padding: 16 }}>
                  <div className="section-label" style={{ marginTop: 0, marginBottom: 10 }}>Key Dates & Thresholds</div>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 2, fontFamily: "var(--font-courier-prime), monospace" }}>
                    <div>Jan 2026 — CBAM fully operational (declarant obligations begin)</div>
                    <div>31 May each year — CBAM annual declaration deadline</div>
                    <div>Feb 2027 — CBAM certificate sales open</div>
                    <div>30 Sep 2027 — First surrender deadline (covering 2026 imports)</div>
                    <div style={{ color: "#2e6e2e" }}>50 t/yr — de minimis threshold (excl. electricity)</div>
                  </div>
                </div>
              </div>

              {/* ── Right: Result ── */}
              <div>
                <div className="section-label">CBAM Cost Estimate</div>
                {!cbamResult ? (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: "44px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.2, lineHeight: 1 }}>CO₂</div>
                    <div style={{ fontFamily: "var(--font-oswald), sans-serif", fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
                      Carbon Border Adjustment
                    </div>
                    <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
                      Select sector, origin country, and quantity,<br />then click <strong style={{ fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", letterSpacing: 1 }}>Calculate CBAM</strong>
                    </div>
                  </div>
                ) : (
                  <div style={{ animation: "fadeIn 0.3s ease" }}>
                    {cbamResult.deMinimis && (
                      <div style={{ background: "#e8f5e8", border: "1px solid #a8d8a8", padding: "12px 16px", borderRadius: 2, marginBottom: 16, fontSize: 13, color: "#2e6e2e" }}>
                        ✓ {cbamResult.tonnes.toFixed(1)} {cbamResult.unit} is below the 50-{cbamResult.unit} de minimis threshold. No CBAM obligation likely applies — verify with your authorised declarant.
                      </div>
                    )}

                    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                      <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", marginBottom: 12 }}>
                        {cbamResult.sectorLabel}
                      </div>

                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Import quantity</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>{cbamResult.tonnes.toFixed(2)} {cbamResult.unit}</span>
                      </div>
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Total embedded emissions</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>{cbamResult.totalEmbedded.toFixed(3)} tCO₂e</span>
                      </div>
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>
                          CBAM factor ({cbamResult.year})
                          <span style={{ fontSize: 11, marginLeft: 8, fontFamily: "var(--font-courier-prime), monospace", color: "#6b7280" }}>
                            {(cbamResult.factor * 100).toFixed(1)}% phase-in
                          </span>
                        </span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>×{cbamResult.factor}</span>
                      </div>
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Covered emissions</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>{cbamResult.coveredEmissions.toFixed(4)} tCO₂e</span>
                      </div>
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>EU ETS price</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>€{cbamResult.etsPrice}/tCO₂</span>
                      </div>
                      <div className="result-row">
                        <span style={{ color: "#6b7280", fontSize: 13 }}>Gross CBAM cost</span>
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>€ {fmt(cbamResult.grossCost)}</span>
                      </div>
                      {cbamResult.carbonPaid > 0 && (
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>− Carbon price paid abroad</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13, color: "#2e6e2e" }}>− € {fmt(cbamResult.carbonPaid)}</span>
                        </div>
                      )}

                      {/* Net CBAM cost total box */}
                      <div style={{ marginTop: 8, background: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(16,185,129,0.08))", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 2, padding: "18px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ fontSize: 10, letterSpacing: 4, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)" }}>
                            Net CBAM Cost
                          </div>
                          <div style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 28, color: "var(--gold)", fontWeight: 700 }}>
                            € {fmt(cbamResult.netCost)}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace" }}>
                          € {cbamResult.perUnitCost.toFixed(2)} per {cbamResult.unit} · {cbamResult.tonnes.toFixed(1)} {cbamResult.unit} imported
                        </div>
                      </div>

                      {/* Benchmark comparison */}
                      {cbamResult.benchmarkEmissions != null && cbamResult.defaultPerTonne != null && (
                        <div style={{ marginTop: 16, padding: "12px 16px", background: "#f0f7f4", border: "1px solid #e2e8f0", borderRadius: 2 }}>
                          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", marginBottom: 8 }}>
                            vs EU ETS Benchmark
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.9 }}>
                            <div>Imported product: {cbamResult.defaultPerTonne.toFixed(3)} tCO₂e/t</div>
                            <div>EU benchmark: {cbamResult.benchmarkEmissions.toFixed(3)} tCO₂e/t</div>
                            <div style={{ color: cbamResult.defaultPerTonne > cbamResult.benchmarkEmissions ? "#dc2626" : "#2e6e2e", marginTop: 2 }}>
                              {cbamResult.defaultPerTonne > cbamResult.benchmarkEmissions
                                ? `⚠ ${((cbamResult.defaultPerTonne / cbamResult.benchmarkEmissions - 1) * 100).toFixed(0)}% above EU best-in-class`
                                : `✓ Within EU benchmark range`}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Emissions source note */}
                      <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.5 }}>
                        {cbamResult.emissionsSource}
                      </div>

                      {/* Compliance checklist */}
                      <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", fontFamily: "var(--font-oswald), sans-serif", color: "var(--muted)", marginBottom: 10 }}>
                          Compliance Checklist
                        </div>
                        {[
                          "Register as authorised CBAM declarant in the CBAM Registry",
                          "Obtain embedded emissions report from supplier (or use defaults)",
                          "Have actual emissions verified by an EU-accredited verifier",
                          "Purchase CBAM certificates via national authority (ADA Luxembourg)",
                          "Submit annual CBAM declaration by 31 May for prior year",
                          "Surrender certificates by 30 September each year",
                          cbamResult.deMinimis ? "✓ De minimis: below 50t — obligation likely waived" : "Monitor annual import volume — 50t de minimis applies per CN code",
                        ].map((item, i) => (
                          <div key={i} style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.9, paddingLeft: 14, position: "relative" }}>
                            <span style={{ position: "absolute", left: 0, color: "#10b981" }}>·</span>
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginTop: 12, fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.6 }}>
                      Estimate based on EU Reg. 2023/956 and Implementing Reg. 2025/2621. Default emission factors subject to mandatory +{((CBAM_MARKUP(cbamResult.year, false) - 1) * 100).toFixed(0)}% markup in {cbamResult.year}. CBAM certificates not purchasable until Feb 2027. First surrender: 30 Sep 2027. Always consult an authorised CBAM declarant before filing.
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* HS LOOKUP TAB */}
        {tab === "hs-lookup" && (
          <div style={{ maxWidth: 500, margin: "0 auto" }}>
            
            {/* INPUT SECTION */}
            <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 24, marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                🔍 HS Code Lookup
              </h2>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your product... e.g. Samsung Galaxy S24 smartphone 256GB"
                rows={3}
                style={{
                  width: "100%",
                  padding: 14,
                  border: "2px solid #e5e7eb",
                  borderRadius: 8,
                  fontSize: 15,
                  fontFamily: "inherit",
                  resize: "none",
                  marginBottom: 12,
                  outline: "none",
                }}
              />
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                💡 Be specific: brand, model, material, function
              </p>
              <button
                onClick={lookupHS}
                disabled={hsLoading}
                style={{
                  width: "100%",
                  padding: 14,
                  background: hsLoading ? "#e5e7eb" : "#059669",
                  color: hsLoading ? "#6b7280" : "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: hsLoading ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {hsLoading ? <><Spinner /> Classifying...</> : "Classify Product"}
              </button>
            </div>

            {/* SENSITIVE GOODS WARNING */}
            {hsResult && hsResult.sensitiveGoods && (
              <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", marginBottom: 16 }}>
                <div style={{ background: "#dc2626", color: "white", padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
                      Sensitive Goods — Licence Required
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
                      Category: {hsResult.sensitiveGoods.category}
                    </div>
                  </div>
                </div>
                <div style={{ background: "#fee2e2", padding: "16px 20px", fontSize: 13, color: "#991b1b" }}>
                  {hsResult.sensitiveGoods.warning}
                  <ul style={{ listStyle: "none", marginTop: 12, padding: 0 }}>
                    {hsResult.sensitiveGoods.licenceAuthority && (
                      <li style={{ padding: "4px 0", display: "flex", gap: 8 }}>📋 Authority: {hsResult.sensitiveGoods.licenceAuthority}</li>
                    )}
                    {hsResult.sensitiveGoods.regulations && hsResult.sensitiveGoods.regulations.map((r, i) => (
                      <li key={i} style={{ padding: "4px 0", display: "flex", gap: 8 }}>📜 {r}</li>
                    ))}
                    {hsResult.sensitiveGoods.consequences && (
                      <li style={{ padding: "4px 0", display: "flex", gap: 8 }}>⚡ {hsResult.sensitiveGoods.consequences}</li>
                    )}
                  </ul>
                </div>
                <div style={{ padding: "16px 20px", background: "#fef2f2", borderTop: "1px solid #fecaca" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                    <input type="checkbox" style={{ width: 18, height: 18 }} />
                    I understand and will verify licence requirements
                  </label>
                </div>
              </div>
            )}

            {/* NEEDS MORE INFO */}
            {hsResult && hsResult.needsMoreInfo && (
              <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden", marginBottom: 16 }}>
                <div style={{ background: "#d97706", color: "white", padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ fontSize: 24 }}>🤔</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>More Details Needed</div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{hsResult.reason}</div>
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>Please specify:</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
                    {hsResult.questions && hsResult.questions.map((q, i) => (
                      <li key={i} style={{ padding: "10px 14px", background: "#fef3c7", borderRadius: 6, marginBottom: 8, fontSize: 14, color: "#92400e" }}>
                        ❓ {q}
                      </li>
                    ))}
                  </ul>
                  {hsResult.possibleChapters && (
                    <div>
                      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Could be in:</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {hsResult.possibleChapters.map((ch, i) => (
                          <span key={i} style={{ padding: "6px 12px", background: "#f3f4f6", borderRadius: 16, fontSize: 13, color: "#6b7280" }}>{ch}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {hsResult.hint && (
                    <div style={{ marginTop: 16, padding: 12, background: "#fef9c3", borderRadius: 6, fontSize: 13, color: "#713f12" }}>
                      💡 {hsResult.hint}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUCCESS RESULT */}
            {hsResult && !hsResult.error && !hsResult.needsMoreInfo && hsResult.cn8 && (
              <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 24 }}>
                
                {/* Code Display */}
                <div style={{ textAlign: "center", paddingBottom: 20, borderBottom: "1px solid #e5e7eb", marginBottom: 20 }}>
                  <div style={{ fontSize: 36, fontWeight: 700, fontFamily: "monospace", color: "#059669", letterSpacing: 2 }}>
                    {hsResult.cn8 ? hsResult.cn8.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3") : hsResult.hs6}
                  </div>
                  <div style={{ fontSize: 15, color: "#6b7280", marginTop: 4 }}>{hsResult.description}</div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600 }}>{hsResult.standardDutyRate}%</div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Duty</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600 }}>{hsResult.vatRateLU || 17}%</div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>VAT</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 50, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ 
                            height: "100%", 
                            borderRadius: 3,
                            width: hsResult.confidence === "high" ? "90%" : hsResult.confidence === "medium" ? "60%" : "30%",
                            background: hsResult.confidence === "high" ? "#059669" : hsResult.confidence === "medium" ? "#d97706" : "#dc2626"
                          }} />
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>Confidence</div>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div style={{ 
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, 
                  padding: 12, borderRadius: 8, marginBottom: 20,
                  background: (hsResult.antiDumping || hsResult.prohibitedRestricted) ? "#fee2e2" : "#d1fae5",
                  color: (hsResult.antiDumping || hsResult.prohibitedRestricted) ? "#dc2626" : "#059669",
                  fontSize: 14, fontWeight: 500
                }}>
                  {(hsResult.antiDumping || hsResult.prohibitedRestricted) 
                    ? "⚠️ Restrictions may apply — check details"
                    : "✅ Clear to import — no restrictions"
                  }
                </div>

                {/* Expandable: Documents */}
                {hsResult.requiredDocuments && hsResult.requiredDocuments.length > 0 && (
                  <details style={{ borderTop: "1px solid #e5e7eb" }}>
                    <summary style={{ padding: "14px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 500 }}>
                      <span>📄 Required Documents</span>
                      <span style={{ fontSize: 12, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>{hsResult.requiredDocuments.length}</span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.requiredDocuments.map((doc, i) => (
                        <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", fontSize: 14, borderBottom: "1px solid #f3f4f6" }}>
                          <span style={{ 
                            width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
                            background: doc.mandatory ? "#d1fae5" : "transparent",
                            border: doc.mandatory ? "2px solid #059669" : "2px solid #e5e7eb",
                            color: "#059669"
                          }}>{doc.mandatory ? "✓" : ""}</span>
                          {doc.name}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Expandable: Preferential Rates */}
                {hsResult.preferentialRates && hsResult.preferentialRates.length > 0 && (
                  <details style={{ borderTop: "1px solid #e5e7eb" }}>
                    <summary style={{ padding: "14px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 500 }}>
                      <span>🌍 Preferential Rates</span>
                      <span style={{ fontSize: 12, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>{hsResult.preferentialRates.length} FTAs</span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.preferentialRates.slice(0, 6).map((pref, i) => (
                        <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 14, borderBottom: "1px solid #f3f4f6" }}>
                          <span>{pref.partner}</span>
                          <span style={{ fontWeight: 500 }}>{pref.rate}%</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Expandable: Regulations */}
                {hsResult.regulatoryNotes && hsResult.regulatoryNotes.length > 0 && (
                  <details style={{ borderTop: "1px solid #e5e7eb" }}>
                    <summary style={{ padding: "14px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, fontWeight: 500 }}>
                      <span>📋 Regulations</span>
                      <span style={{ fontSize: 12, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 10 }}>{hsResult.regulatoryNotes.length}</span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.regulatoryNotes.map((reg, i) => (
                        <li key={i} style={{ padding: "8px 0", fontSize: 14, borderBottom: "1px solid #f3f4f6" }}>{reg}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 12, marginTop: 20, paddingTop: 20, borderTop: "1px solid #e5e7eb" }}>
                  <button 
                    onClick={() => addFavourite(hsResult.cn8 || hsResult.hs6, hsResult.description)}
                    style={{ flex: 1, padding: 14, background: "#f3f4f6", color: "#1f2937", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: "pointer" }}
                  >
                    ★ Save
                  </button>
                  <button 
                    onClick={() => { setHsCode(hsResult.cn8 || hsResult.hs6); setTab("calculator"); }}
                    style={{ flex: 1, padding: 14, background: "#059669", color: "white", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: "pointer" }}
                  >
                    → Use in Calculator
                  </button>
                </div>
              </div>
            )}

            {/* ERROR */}
            {hsResult && hsResult.error && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, color: "#dc2626", fontSize: 14 }}>
                {hsResult.error}
              </div>
            )}

            {/* FAVOURITES */}
            {favourites.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>Saved HS Codes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {favourites.map((fav, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, background: "#fff", borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                      <div>
                        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#059669" }}>{fav.code}</span>
                        <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 13 }}>{fav.description}</span>
                      </div>
                      <button onClick={() => removeFavourite(fav.code)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 18 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
        {tab === "fx" && (
          <div>
            <div className="two-col" style={{ gap: 32 }}>
              <div>
                <div className="section-label">Currency Converter → EUR</div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24 }}>
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        fontSize: 11,
                        color: "#6b7280",
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
                        background: "#f0f7f4",
                        border: "1px solid #e2e8f0",
                        color: "#111827",
                        padding: "10px 14px",
                        fontFamily: "var(--font-courier-prime), monospace",
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
                          color: "#6b7280",
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
                          background: "#f0f7f4",
                          border: "1px solid #e2e8f0",
                          color: "#111827",
                          padding: "10px 12px",
                          fontFamily: "var(--font-courier-prime), monospace",
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
                    <div style={{ fontSize: 20, color: "#6b7280", paddingBottom: 4, textAlign: "center" }}>⇄</div>
                    <div>
                      <label
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
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
                          background: "#f0f7f4",
                          border: "1px solid #e2e8f0",
                          color: "#111827",
                          padding: "10px 12px",
                          fontFamily: "var(--font-courier-prime), monospace",
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
                  {(() => {
                    const converted = convertFX(fxAmount, fxFrom, fxTo);
                    const rate = convertFX(1, fxFrom, fxTo);
                    if (!fxAmount || converted === null) return null;
                    return (
                      <div style={{ background: "#f0f7f4", borderRadius: 2, padding: "20px 20px" }}>
                        <div
                          style={{
                            fontFamily: "var(--font-courier-prime), monospace",
                            fontSize: 28,
                            color: "#10b981",
                            letterSpacing: 2,
                          }}
                        >
                          {converted.toLocaleString("de-LU", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}{" "}
                          <span style={{ fontSize: 16, color: "#6b7280" }}>{fxTo}</span>
                        </div>
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 12,
                            color: "#6b7280",
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          1 {fxFrom} = {rate?.toFixed(6)} {fxTo}
                        </div>
                        {allRatesDate && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11,
                              color: "#6b7280",
                              fontFamily: "var(--font-courier-prime), monospace",
                            }}
                          >
                            ECB rate · {allRatesDate}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                      border: "1px solid #e2e8f0",
                      color: "#6b7280",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      borderRadius: 2,
                    }}
                  >
                    swap currencies
                  </button>
                </div>
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 11,
                    color: "#6b7280",
                    fontFamily: "var(--font-courier-prime), monospace",
                    lineHeight: 1.7,
                  }}
                >
                  Rates sourced from the European Central Bank via{" "}
                  <a href="https://www.frankfurter.app" target="_blank" rel="noopener" style={{ color: "#10b98155" }}>
                    frankfurter.app ↗
                  </a>{" "}
                  · Updated daily on ECB business days · Not for financial transactions
                </div>
              </div>

              <div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
                >
                  <div className="section-label" style={{ marginBottom: 0 }}>
                    Live Rates vs EUR
                  </div>
                  {allRatesDate && (
                    <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace" }}>
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
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px 1fr 1fr 1fr",
                        gap: 0,
                        background: "#e8f4f0",
                        flexShrink: 0,
                        padding: "9px 14px",
                        borderRadius: 2,
                        alignItems: "center",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-courier-prime), monospace",
                          fontSize: 13,
                          color: "#10b981",
                          fontWeight: 700,
                        }}
                      >
                        EUR
                      </span>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>Euro (base)</span>
                      <span
                        style={{
                          fontFamily: "var(--font-courier-prime), monospace",
                          fontSize: 13,
                          color: "#6b7280",
                          textAlign: "right",
                        }}
                      >
                        1.000000
                      </span>
                      <span
                        className="fx-hide"
                        style={{
                          fontFamily: "var(--font-courier-prime), monospace",
                          fontSize: 11,
                          color: "#6b7280",
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
                              background: i % 2 === 0 ? "#f0f7f4" : "#fff",
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
                            <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13, color: "#111827" }}>
                              {code}
                            </span>
                            <span style={{ fontSize: 11, color: "#6b7280" }}>1 EUR =</span>
                            <span
                              style={{
                                fontFamily: "var(--font-courier-prime), monospace",
                                fontSize: 13,
                                color: "#6b7280",
                                textAlign: "right",
                              }}
                            >
                              {eurRate.toFixed(4)}
                            </span>
                            <span
                              className="fx-hide"
                              style={{
                                fontFamily: "var(--font-courier-prime), monospace",
                                fontSize: 11,
                                color: "#6b7280",
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
                    style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "14px 16px", borderRadius: 2 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{item.label}</span>
                      <span className={`tag tag-${item.color}`}>{item.value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace" }}>
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
                    style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "14px 16px", borderRadius: 2 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13 }}>{item.label}</span>
                      <span className="tag tag-amber">{item.value}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace" }}>
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
                      background: "#fff",
                      border: "1px solid #e2e8f0",
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
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          fontFamily: "var(--font-courier-prime), monospace",
                          marginTop: 2,
                        }}
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
                  className="ref-link"
                  style={{
                    display: "block",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    padding: "12px 16px",
                    borderRadius: 2,
                    textDecoration: "none",
                    marginBottom: 2,
                  }}
                >
                  <div style={{ color: "#10b981", fontSize: 13 }}>{link.label} ↗</div>
                  <div
                    style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace", marginTop: 2 }}
                  >
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
