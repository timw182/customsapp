// The landed cost of an import: customs value, duty, anti-dumping, excise and VAT.
//
// This is the calculator's arithmetic, lifted out of CustomsCalculator.jsx so it has one home. The
// component imports it and so does /api/landed-cost, which is how other tools on this server (the ELP
// forwarding tool) ask the same question and get the same answer. Nothing here touches React, the
// database or the network: rates in, figures out.
//
// Sources are named where they are used: LU VAT (Loi TVA), ADA excise rates, EU Reg. 2015/2447
// Annex 23-01 for the airfreight share, VAT Directive Art. 86 (Loi TVA art. 34) for the VAT base.
//
// Corrected 2026-10-10 after a review from the ELP tool: the VAT base used to be the customs value
// plus duties, which left out the share of the air freight that customs excludes (30% from China)
// and any carriage inside Luxembourg; the total left that freight out too, so it was not what the
// importer paid; and a ticked preference with no TARIC rate behind it was given an invented
// discount (0% for any FTA country, 35% of the rate for GSP).

import { applyDuty, parseDutyRate } from "./taric-duty.mjs";

// Luxembourg VAT rates (Loi TVA, 2026)
// Maps HS chapter to applicable VAT rate
export const LU_VAT_RATES_3 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 36, 49];
export const LU_VAT_RATES_8 = [27, 90];
// Chapter 22: still wine ≤13° ABV = 14%, still wine >13° ABV = 17%, sparkling/beer/spirits = 17%
// stillWineLow flag passed from UI when user confirms still wine ≤13° ABV
// chapter 30 pharma = 3%, chapter 61-64 children items = 3% (needs user input for size)

export function getLuVAT(hsCode, stillWineLow = false) {
  if (!hsCode) return 0.17;
  const chapter = parseInt(String(hsCode).replace(/\D/g, "").substring(0, 2), 10);
  if (LU_VAT_RATES_3.includes(chapter)) return 0.03;
  if (LU_VAT_RATES_8.includes(chapter)) return 0.08;
  if (chapter === 30) return 0.03; // pharma
  if (chapter === 22 && stillWineLow) return 0.14; // still wine ≤13° ABV (LU Loi TVA)
  return 0.17;
}

// Official Luxembourg ADA excise rates effective 01.01.2026
// Source: douanes.public.lu/fr/accises/taux-droits-accise.html
export const EXCISE_RATES = {
  // Alcohol — €/hl per °Plato (3 production tiers)
  beer_small: 0.3966, // brewery ≤ 50,000 hl/yr
  beer_medium: 0.4462, // brewery ≤ 200,000 hl/yr
  beer_large: 0.7933, // brewery > 200,000 hl/yr
  "still-wine": 0, // LU applies EU 0-rate (14% VAT ≤13°, 17% >13°)
  "sparkling-wine": 0, // LU applies EU 0-rate (17% VAT)
  intermediate_low: 47.0998, // €/hl — intermediate ≤ 15° alc
  intermediate_high: 66.9313, // €/hl — intermediate > 15° alc
  spirits: 1123.1042, // €/hl pure alcohol (total incl. contributions)
  // Tobacco
  cigarettes_specific: 23.3914, // €/1000 units
  cigarettes_advalorem: 0.4814, // 48.14% of retail price
  cigarettes_minimum: 152.8, // €/1000 minimum
  cigars_advalorem: 0.1, // 10% of retail price
  cigars_minimum: 23.5, // €/1000 pieces minimum
  fine_cut_specific: 26.4, // €/kg
  fine_cut_advalorem: 0.356, // 35.6% of retail price
  fine_cut_minimum: 77.9, // €/kg minimum floor
  heated_tobacco_advalorem: 0.28, // 28% of retail price
  heated_tobacco_specific: 16.8, // €/kg
  eliquid: 120.0, // €/L
  nicotine_pouches: 22.0, // €/kg
  // Energy
  petrol: 0.5691, // €/L — unleaded ≤ 10 mg/kg S (17% VAT)
  diesel: 0.4646, // €/L — road use ≤ 10 mg/kg S (17% VAT)
  heating_fuel: 0.1302, // €/L — fioul domestique (14% VAT)
  lpg: 0.2362, // €/kg — LPG fuel use (8% VAT)
};
// Schema-driven excise config — each category defines its inputs, formula, and VAT rate.
// To add a new category: add one entry here. Nothing else needs to change.
export const EXCISE_SCHEMAS = {
  beer: {
    label: "Beer",
    group: "Alcohol",
    vatRate: 0.17,
    inputs: ["volume", "plato", "breweryTier"],
    calc(inp, R) {
      const rate =
        inp.breweryTier === "small" ? R.beer_small : inp.breweryTier === "medium" ? R.beer_medium : R.beer_large;
      const hl = (inp.volume / 100).toFixed(2);
      return {
        duty: (inp.volume / 100) * (inp.plato || 0) * rate,
        note: `${inp.plato || 0}°P × ${hl} hl × €${rate}/hl/°P`,
      };
    },
  },
  "still-wine": {
    label: "Still Wine",
    group: "Alcohol",
    // VAT: 14% if ≤13° ABV, 17% if >13° ABV (LU Loi TVA — Luxembourg exception)
    vatRate: null, // dynamic — determined by abv input
    inputs: ["volume", "abv"],
    calc(inp, R) {
      const vatRate = (inp.abv || 0) <= 13 ? 0.14 : 0.17;
      return {
        duty: (inp.volume / 100) * R["still-wine"],
        note: `EU 0-rate — no excise duty in LU · VAT ${vatRate * 100}% (${(inp.abv || 0) <= 13 ? "≤13°" : ">13°"} ABV)`,
        vatRate,
      };
    },
  },
  "sparkling-wine": {
    label: "Sparkling Wine / Champagne",
    group: "Alcohol",
    vatRate: 0.17,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: (inp.volume / 100) * R["sparkling-wine"], note: "EU 0-rate — no excise duty in LU" };
    },
  },
  intermediate: {
    label: "Intermediate Products",
    group: "Alcohol",
    vatRate: 0.17,
    inputs: ["volume", "above15"],
    calc(inp, R) {
      const rate = inp.above15 ? R.intermediate_high : R.intermediate_low;
      return { duty: (inp.volume / 100) * rate, note: `€${rate}/hl (${inp.above15 ? ">15°" : "≤15°"} alc)` };
    },
  },
  spirits: {
    label: "Spirits / Liqueur",
    group: "Alcohol",
    vatRate: 0.17,
    inputs: ["volume", "abv"],
    calc(inp, R) {
      const hl = (inp.volume / 100).toFixed(2);
      return {
        duty: (inp.volume / 100) * ((inp.abv || 0) / 100) * R.spirits,
        note: `${inp.abv || 0}% ABV × ${hl} hl × €${R.spirits}/hl pure alc`,
      };
    },
  },
  cigarettes: {
    label: "Cigarettes",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["qty", "retailPerUnit"],
    calc(inp, R) {
      const specific = (inp.qty / 1000) * R.cigarettes_specific;
      const adval = inp.qty * (inp.retailPerUnit || 0) * R.cigarettes_advalorem;
      const floor = (inp.qty / 1000) * R.cigarettes_minimum;
      const duty = Math.max(specific + adval, floor);
      return {
        duty,
        note:
          duty <= floor + 0.001 ? `min €${R.cigarettes_minimum}/1000 units applies` : "specific + 48.14% ad valorem",
      };
    },
  },
  cigars: {
    label: "Cigars / Cigarillos",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["qty", "retailPerUnit"],
    calc(inp, R) {
      const adval = inp.qty * (inp.retailPerUnit || 0) * R.cigars_advalorem;
      const floor = (inp.qty / 1000) * R.cigars_minimum;
      const duty = Math.max(adval, floor);
      return { duty, note: duty <= floor + 0.001 ? `min €${R.cigars_minimum}/1000 pcs applies` : "10% ad valorem" };
    },
  },
  "fine-cut": {
    label: "Fine-Cut Tobacco",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["weight", "retailPerKg"],
    calc(inp, R) {
      const specific = inp.weight * R.fine_cut_specific;
      const adval = inp.weight * (inp.retailPerKg || 0) * R.fine_cut_advalorem;
      const floor = inp.weight * R.fine_cut_minimum;
      const duty = Math.max(specific + adval, floor);
      return {
        duty,
        note:
          duty <= floor + 0.001
            ? `min €${R.fine_cut_minimum}/kg applies`
            : `€${R.fine_cut_specific}/kg + 35.6% ad valorem`,
      };
    },
  },
  "other-tobacco": {
    label: "Other Tobacco",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["weight", "retailPerKg"],
    calc(inp, R) {
      const specific = inp.weight * R.fine_cut_specific;
      const adval = inp.weight * (inp.retailPerKg || 0) * R.fine_cut_advalorem;
      const floor = inp.weight * R.fine_cut_minimum;
      const duty = Math.max(specific + adval, floor);
      return {
        duty,
        note:
          duty <= floor + 0.001
            ? `min €${R.fine_cut_minimum}/kg applies`
            : `€${R.fine_cut_specific}/kg + 35.6% ad valorem`,
      };
    },
  },
  "heated-tobacco": {
    label: "Heated Tobacco Products",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["weight", "retailPerKg"],
    calc(inp, R) {
      const specific = inp.weight * R.heated_tobacco_specific;
      const adval = inp.weight * (inp.retailPerKg || 0) * R.heated_tobacco_advalorem;
      return { duty: specific + adval, note: `€${R.heated_tobacco_specific}/kg specific + 28% ad valorem` };
    },
  },
  eliquid: {
    label: "E-Liquid (vapes)",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: inp.volume * R.eliquid, note: `€${R.eliquid}/L` };
    },
  },
  "nicotine-pouches": {
    label: "Nicotine Pouches",
    group: "Tobacco",
    vatRate: 0.17,
    inputs: ["weight"],
    calc(inp, R) {
      return { duty: inp.weight * R.nicotine_pouches, note: `€${R.nicotine_pouches}/kg` };
    },
  },
  petrol: {
    label: "Petrol (unleaded)",
    group: "Energy",
    vatRate: 0.17,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: inp.volume * R.petrol, note: `€${R.petrol}/L` };
    },
  },
  diesel: {
    label: "Diesel",
    group: "Energy",
    vatRate: 0.17,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: inp.volume * R.diesel, note: `€${R.diesel}/L` };
    },
  },
  "heating-fuel": {
    label: "Heating Fuel",
    group: "Energy",
    vatRate: 0.14,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: inp.volume * R.heating_fuel, note: `€${R.heating_fuel}/L (14% VAT)` };
    },
  },
  lpg: {
    label: "LPG",
    group: "Energy",
    vatRate: 0.08,
    inputs: ["weight"],
    calc(inp, R) {
      return { duty: inp.weight * R.lpg, note: `€${R.lpg}/kg (8% VAT)` };
    },
  },
};

// Comprehensive EU trade preference data
// pref: true = preferential rates available (FTA/GSP/EBA/EEA/CU)
// type: 'fta'|'eea'|'cu'|'gsp'|'gsp+'|'eba'|'atp'|'mfn'|'sanctioned'
// proof: proof of origin document required
export const ORIGIN_AGREEMENTS = {
  // EEA / EFTA
  IS: { name: "Iceland", pref: true, type: "eea", note: "EEA – 0% on most goods (EUR.1 or origin declaration)" },
  LI: { name: "Liechtenstein", pref: true, type: "eea", note: "EEA/EFTA – 0% on most goods" },
  NO: { name: "Norway", pref: true, type: "eea", note: "EEA – 0% on most goods" },
  CH: { name: "Switzerland", pref: true, type: "fta", note: "FTA – 0% on most goods (EUR.1)" },

  // EU Customs Union
  TR: { name: "Turkey", pref: true, type: "cu", note: "Customs Union – 0% industrial goods (no agriculture)" },
  AD: { name: "Andorra", pref: true, type: "cu", note: "Customs Union (industrial + agri)" },
  SM: { name: "San Marino", pref: true, type: "cu", note: "Customs Union" },

  // UK (post-Brexit)
  GB: {
    name: "United Kingdom",
    pref: true,
    type: "fta",
    note: "UK TCA – 0% with origin proof (origin declaration on invoice)",
  },

  // FTA Partners (in force)
  AL: { name: "Albania", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  AM: { name: "Armenia", pref: true, type: "fta", note: "CEPA – Comprehensive & Enhanced Partnership" },
  AO: { name: "Angola", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  BA: { name: "Bosnia & Herzegovina", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  BD: { name: "Bangladesh", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  BF: { name: "Burkina Faso", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  BI: { name: "Burundi", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  BJ: { name: "Benin", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  BO: { name: "Bolivia", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  BT: { name: "Bhutan", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  CA: { name: "Canada", pref: true, type: "fta", note: "CETA – 0% on most goods (origin declaration)" },
  CD: { name: "DR Congo", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  CF: { name: "Central African Rep.", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  CG: { name: "Congo", pref: true, type: "gsp", note: "Standard GSP – reduced rates" },
  CI: { name: "Cote d'Ivoire", pref: true, type: "epa", note: "Economic Partnership Agreement" },
  CL: { name: "Chile", pref: true, type: "fta", note: "EU-Chile Interim Agreement (new 2024)" },
  CM: { name: "Cameroon", pref: true, type: "epa", note: "Economic Partnership Agreement" },
  CO: { name: "Colombia", pref: true, type: "fta", note: "EU-Colombia-Peru FTA" },
  CV: { name: "Cabo Verde", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  DJ: { name: "Djibouti", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  DZ: { name: "Algeria", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  EC: { name: "Ecuador", pref: true, type: "fta", note: "EU-Colombia-Peru-Ecuador FTA" },
  EG: { name: "Egypt", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  ER: { name: "Eritrea", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  ET: { name: "Ethiopia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  FJ: { name: "Fiji", pref: true, type: "epa", note: "EU-Pacific EPA" },
  GA: { name: "Gabon", pref: true, type: "gsp", note: "Standard GSP" },
  GE: { name: "Georgia", pref: true, type: "fta", note: "DCFTA – Deep & Comprehensive FTA" },
  GH: { name: "Ghana", pref: true, type: "epa", note: "Economic Partnership Agreement" },
  GM: { name: "Gambia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  GN: { name: "Guinea", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  GQ: { name: "Equatorial Guinea", pref: true, type: "gsp", note: "Standard GSP" },
  GW: { name: "Guinea-Bissau", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  GY: { name: "Guyana", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  HT: { name: "Haiti", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  ID: { name: "Indonesia", pref: true, type: "gsp", note: "Standard GSP – reduced rates" },
  IL: { name: "Israel", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  IN: { name: "India", pref: true, type: "gsp", note: "Standard GSP – reduced rates (FTA negotiations ongoing)" },
  IQ: { name: "Iraq", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  IR: { name: "Iran", pref: false, type: "sanctioned", note: "⚠️ SANCTIONED – EU restrictive measures apply" },
  JM: { name: "Jamaica", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  JO: { name: "Jordan", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  JP: { name: "Japan", pref: true, type: "fta", note: "EU-Japan EPA – reduced/0% rates" },
  KE: { name: "Kenya", pref: true, type: "epa", note: "EU-EAC EPA (Kenya)" },
  KG: { name: "Kyrgyzstan", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  KH: { name: "Cambodia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  KI: { name: "Kiribati", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  KM: { name: "Comoros", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  KP: { name: "North Korea", pref: false, type: "sanctioned", note: "⚠️ SANCTIONED – Comprehensive embargo" },
  KR: { name: "South Korea", pref: true, type: "fta", note: "EU-Korea FTA – 0% on most goods" },
  KZ: { name: "Kazakhstan", pref: true, type: "gsp", note: "Standard GSP" },
  LA: { name: "Laos", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  LB: { name: "Lebanon", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  LK: { name: "Sri Lanka", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  LR: { name: "Liberia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  LS: { name: "Lesotho", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  LY: { name: "Libya", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  MA: { name: "Morocco", pref: true, type: "fta", note: "Association Agreement (Euro-Med) + Enhanced" },
  MD: { name: "Moldova", pref: true, type: "fta", note: "DCFTA – Deep & Comprehensive FTA" },
  ME: { name: "Montenegro", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  MG: { name: "Madagascar", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  MK: { name: "North Macedonia", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  ML: { name: "Mali", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  MM: { name: "Myanmar", pref: false, type: "sanctioned", note: "⚠️ EBA WITHDRAWN – Sanctions; MFN rates" },
  MN: { name: "Mongolia", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  MR: { name: "Mauritania", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  MU: { name: "Mauritius", pref: true, type: "epa", note: "EU-ESA Interim EPA" },
  MV: { name: "Maldives", pref: true, type: "gsp", note: "Standard GSP" },
  MW: { name: "Malawi", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  MX: { name: "Mexico", pref: true, type: "fta", note: "EU-Mexico Global Agreement (updated)" },
  MZ: { name: "Mozambique", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  NA: { name: "Namibia", pref: true, type: "epa", note: "EU-SADC EPA" },
  NE: { name: "Niger", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  NG: { name: "Nigeria", pref: true, type: "gsp", note: "Standard GSP" },
  NP: { name: "Nepal", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  NR: { name: "Nauru", pref: true, type: "epa", note: "EU-Pacific EPA" },
  NZ: { name: "New Zealand", pref: true, type: "fta", note: "EU-NZ FTA (in force 2024)" },
  PA: { name: "Panama", pref: true, type: "fta", note: "EU-Central America AA" },
  PE: { name: "Peru", pref: true, type: "fta", note: "EU-Colombia-Peru FTA" },
  PG: { name: "Papua New Guinea", pref: true, type: "epa", note: "EU-Pacific EPA" },
  PH: { name: "Philippines", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  PK: { name: "Pakistan", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  PS: { name: "Palestine", pref: true, type: "fta", note: "Euro-Med Association Agreement" },
  RW: { name: "Rwanda", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SA: { name: "Saudi Arabia", pref: false, type: "mfn", note: "No FTA – MFN rates (GCC negotiations)" },
  SB: { name: "Solomon Islands", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SC: { name: "Seychelles", pref: true, type: "epa", note: "EU-ESA Interim EPA" },
  SD: { name: "Sudan", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SG: { name: "Singapore", pref: true, type: "fta", note: "EUSFTA – 0% on most goods" },
  SH: { name: "St. Helena", pref: true, type: "gsp", note: "Standard GSP" },
  SL: { name: "Sierra Leone", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SN: { name: "Senegal", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SO: { name: "Somalia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SS: { name: "South Sudan", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  ST: { name: "Sao Tome & Principe", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  SV: { name: "El Salvador", pref: true, type: "fta", note: "EU-Central America AA" },
  SZ: { name: "Eswatini", pref: true, type: "epa", note: "EU-SADC EPA" },
  TD: { name: "Chad", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  TG: { name: "Togo", pref: true, type: "gsp", note: "Standard GSP" },
  TH: { name: "Thailand", pref: true, type: "gsp", note: "Standard GSP – reduced rates" },
  TJ: { name: "Tajikistan", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  TL: { name: "Timor-Leste", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  TM: { name: "Turkmenistan", pref: true, type: "gsp", note: "Standard GSP" },
  TN: { name: "Tunisia", pref: true, type: "fta", note: "Association Agreement (Euro-Med)" },
  TO: { name: "Tonga", pref: true, type: "epa", note: "EU-Pacific EPA" },
  TV: { name: "Tuvalu", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  TZ: { name: "Tanzania", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  UA: { name: "Ukraine", pref: true, type: "fta", note: "DCFTA + Autonomous Trade Measures (ATM)" },
  UG: { name: "Uganda", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  UZ: { name: "Uzbekistan", pref: true, type: "gsp+", note: "GSP+ – Enhanced preferences" },
  VN: { name: "Vietnam", pref: true, type: "fta", note: "EVFTA – 0% on most goods (phased)" },
  VU: { name: "Vanuatu", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  WS: { name: "Samoa", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  XK: { name: "Kosovo", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  YE: { name: "Yemen", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  ZA: { name: "South Africa", pref: true, type: "epa", note: "EU-SADC EPA" },
  ZM: { name: "Zambia", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  ZW: { name: "Zimbabwe", pref: true, type: "gsp", note: "Standard GSP" },
  // MFN (no preference)
  AE: { name: "UAE", pref: false, type: "mfn", note: "No FTA – MFN rates (GCC negotiations)" },
  AF: { name: "Afghanistan", pref: true, type: "eba", note: "EBA – Everything But Arms (0%, LDC)" },
  AG: { name: "Antigua & Barbuda", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  AR: { name: "Argentina", pref: false, type: "mfn", note: "No FTA – MFN (Mercosur FTA pending ratification)" },
  AU: { name: "Australia", pref: true, type: "fta", note: "EU-Australia FTA (signed 2024, pending ratification)" },
  AZ: { name: "Azerbaijan", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  BB: { name: "Barbados", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  BN: { name: "Brunei", pref: true, type: "gsp", note: "Standard GSP" },
  BR: { name: "Brazil", pref: false, type: "mfn", note: "No FTA – MFN (Mercosur pending)" },
  BW: { name: "Botswana", pref: true, type: "epa", note: "EU-SADC EPA" },
  BY: { name: "Belarus", pref: false, type: "sanctioned", note: "⚠️ SANCTIONED – EU restrictive measures" },
  BZ: { name: "Belize", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  CN: { name: "China", pref: false, type: "mfn", note: "No FTA – MFN rates; anti-dumping common" },
  CR: { name: "Costa Rica", pref: true, type: "fta", note: "EU-Central America AA" },
  CU: { name: "Cuba", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  DM: { name: "Dominica", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  DO: { name: "Dominican Republic", pref: true, type: "epa", note: "EU-CARIFORUM EPA" },
  GT: { name: "Guatemala", pref: true, type: "fta", note: "EU-Central America AA" },
  HK: { name: "Hong Kong", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  HN: { name: "Honduras", pref: true, type: "fta", note: "EU-Central America AA" },
  HT: { name: "Haiti", pref: true, type: "eba", note: "EBA – 0% (LDC)" },
  JP: { name: "Japan", pref: true, type: "fta", note: "EU-Japan EPA" },
  KW: { name: "Kuwait", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  LY: { name: "Libya", pref: false, type: "mfn", note: "No FTA" },
  MO: { name: "Macao", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  MY: { name: "Malaysia", pref: true, type: "gsp", note: "Standard GSP" },
  NI: { name: "Nicaragua", pref: true, type: "fta", note: "EU-Central America AA" },
  OM: { name: "Oman", pref: false, type: "mfn", note: "No FTA – MFN rates (GCC)" },
  PY: { name: "Paraguay", pref: false, type: "mfn", note: "No FTA (Mercosur pending)" },
  QA: { name: "Qatar", pref: false, type: "mfn", note: "No FTA – MFN rates (GCC)" },
  RS: { name: "Serbia", pref: true, type: "atp", note: "Stabilisation & Association Agreement" },
  RU: { name: "Russia", pref: false, type: "sanctioned", note: "⚠️ SANCTIONED – Comprehensive EU measures" },
  SY: { name: "Syria", pref: false, type: "sanctioned", note: "⚠️ SANCTIONED – EU restrictive measures" },
  TW: { name: "Taiwan", pref: false, type: "mfn", note: "No FTA – MFN rates" },
  US: { name: "United States", pref: false, type: "mfn", note: "No FTA – MFN rates (TTIP stalled)" },
  UY: { name: "Uruguay", pref: false, type: "mfn", note: "No FTA (Mercosur pending)" },
  VE: { name: "Venezuela", pref: false, type: "mfn", note: "No FTA – MFN rates" },
};

// All 11 Incoterms 2020 with CIF conversion logic
// EU customs value = CIF at first EU point of entry
export const INCOTERMS_CIF = {
  EXW: {
    label: "EXW – Ex Works",
    needsFreight: true,
    needsIns: true,
    note: "Add all transport + insurance to get CIF",
  },
  FCA: {
    label: "FCA – Free Carrier",
    needsFreight: true,
    needsIns: true,
    note: "Add main carriage + insurance from named place",
  },
  FAS: {
    label: "FAS – Free Alongside Ship",
    needsFreight: true,
    needsIns: true,
    note: "Sea only — add loading, freight + insurance",
  },
  FOB: {
    label: "FOB – Free on Board",
    needsFreight: true,
    needsIns: true,
    note: "Sea only — add main carriage + insurance",
  },
  CFR: { label: "CFR – Cost & Freight", needsFreight: false, needsIns: true, note: "Sea only — add insurance only" },
  CIF: {
    label: "CIF – Cost, Insurance & Freight",
    needsFreight: false,
    needsIns: false,
    note: "Sea only — already CIF, use directly",
  },
  CPT: {
    label: "CPT – Carriage Paid To",
    needsFreight: false,
    needsIns: true,
    note: "Add insurance only (carriage included)",
  },
  CIP: {
    label: "CIP – Carriage & Insurance Paid",
    needsFreight: false,
    needsIns: false,
    note: "Already includes freight + insurance",
  },
  DAP: { label: "DAP – Delivered at Place", needsFreight: false, needsIns: false, note: "Use declared customs value" },
  DPU: {
    label: "DPU – Delivered at Place Unloaded",
    needsFreight: false,
    needsIns: false,
    note: "Use declared customs value",
  },
  DDP: {
    label: "DDP – Delivered Duty Paid",
    needsFreight: false,
    needsIns: false,
    note: "Duty included — use declared customs value",
  },
};

// Airfreight zone percentages (EU Reg. 2015/2447, Annex 23-01)
// % of airfreight cost to include in customs value
export const AIRFREIGHT_ZONES = {
  CA: 70,
  GL: 70,
  US: 70,
  MX: 78,
  GT: 78,
  BZ: 78,
  SV: 78,
  HN: 78,
  NI: 78,
  CR: 78,
  PA: 78,
  CO: 78,
  VE: 78,
  GY: 78,
  SR: 78,
  BR: 78,
  EC: 78,
  PE: 78,
  BO: 78,
  CL: 78,
  AR: 78,
  UY: 78,
  PY: 78,
  DZ: 33,
  EG: 33,
  LY: 33,
  MA: 33,
  TN: 33,
  NG: 50,
  GH: 50,
  CI: 50,
  SN: 50,
  CM: 50,
  ET: 50,
  ML: 50,
  BF: 50,
  KE: 61,
  TZ: 61,
  UG: 61,
  CD: 61,
  CG: 61,
  RW: 61,
  BI: 61,
  ZA: 74,
  MZ: 74,
  ZW: 74,
  ZM: 74,
  AO: 74,
  BW: 74,
  NA: 74,
  MG: 74,
  MU: 74,
  IL: 27,
  JO: 27,
  LB: 27,
  IQ: 27,
  IR: 27,
  SY: 27,
  AM: 27,
  AZ: 27,
  GE: 27,
  KW: 27,
  SA: 43,
  AE: 43,
  QA: 43,
  BH: 43,
  OM: 43,
  YE: 43,
  IN: 46,
  PK: 46,
  BD: 46,
  NP: 46,
  AF: 46,
  BT: 46,
  KZ: 57,
  UZ: 57,
  TM: 57,
  KG: 57,
  TJ: 57,
  CN: 70,
  HK: 70,
  TW: 70,
  TH: 70,
  VN: 70,
  MY: 70,
  SG: 70,
  PH: 70,
  ID: 70,
  MM: 70,
  KH: 70,
  LA: 70,
  MN: 70,
  MO: 70,
  LK: 70,
  BN: 70,
  JP: 83,
  KR: 83,
  KP: 83,
  AU: 79,
  NZ: 79,
  UA: 30,
  IS: 30,
  TR: 15,
  NO: 15,
  RS: 15,
  BA: 15,
  ME: 15,
  AL: 15,
  MK: 15,
  MD: 15,
  BY: 15,
  XK: 15,
  FO: 15,
  CH: 5,
  GB: 5,
};

export function getAirfreightPct(countryCode) {
  return (AIRFREIGHT_ZONES[countryCode] ?? 70) / 100;
}

/* ------------------------------------------------------------ the sum ---- */

const number = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** De minimis relief on customs duty ends on 1 July 2026; anti-dumping duty was never covered by it. */
const DE_MINIMIS_ENDS = new Date("2026-07-01");
const DE_MINIMIS_LIMIT = 150;

/**
 * What an import costs once customs is done with it.
 *
 * Amounts are in the invoice currency and converted with `exchangeRate` (units of EUR per unit of
 * that currency; 1 for an invoice already in EUR). `dutyRatePct` is the tariff rate as TARIC gives
 * it, and `usingPreferentialRate` says it is already the preferential one, in which case the
 * agreement is not applied a second time.
 */
export function landedCost(input = {}) {
  const value = number(input.value);
  const exchangeRate = number(input.exchangeRate) || 1;
  const incoterm = INCOTERMS_CIF[input.incoterm] ? input.incoterm : "EXW";
  const origin = String(input.origin || "").toUpperCase();
  const hsCode = String(input.hsCode || "");
  const now = input.now instanceof Date ? input.now : new Date();

  const valueEUR = value * exchangeRate;
  const insuranceEUR = number(input.insurance) * exchangeRate;
  const freightPaidEUR = number(input.freight) * exchangeRate;
  let freightEUR = freightPaidEUR;

  /* Only part of an airfreight cost enters the customs value, by distance zone (Annex 23-01). */
  const airfreightPct = input.transportMode === "air" ? getAirfreightPct(origin) : null;
  if (airfreightPct !== null) freightEUR = freightEUR * airfreightPct;

  /* The Incoterm decides what the customs value already includes. */
  const terms = INCOTERMS_CIF[incoterm] || {};
  let customsValue = valueEUR;
  if (terms.needsFreight && terms.needsIns) customsValue = valueEUR + freightEUR + insuranceEUR;
  else if (!terms.needsFreight && terms.needsIns) customsValue = valueEUR + insuranceEUR;

  /* Freight the importer pays that customs leaves out of its value: the rest of the air freight
     when the Incoterm makes the buyer pay the freight. Under C and D terms the freight is inside
     the price and nothing is outside. It is still a cost, and still VAT-able (Art. 86(1)(b)). */
  let freightExcludedEUR = terms.needsFreight ? Math.max(0, freightPaidEUR - freightEUR) : 0;
  /* Freight a C or D invoice shows on its own line, on top of the goods. The seller bills the
     carriage, so it is in the price paid, but transport after the EU border stays out of the value
     when the invoice shows it apart (UCC Art. 72(a)): on air, the Annex 23-01 share counts, as for
     E and F terms. Case: file 2313832 (2026-08-28), DAP from Indonesia, goods €28,931.12 plus a
     freight line of €2,838.88; Luxembourg customs took goods + 70% of it and charged €525.61, where
     this read the goods alone and said €491.83. Freight hidden inside the prices cannot be split,
     and then the whole price is the value, as before. `freight` keeps its meaning under these
     terms (ignored), because Dutify's own calculator sends it whatever the Incoterm. */
  const invoiceFreightPaidEUR = terms.needsFreight ? 0 : number(input.invoiceFreight) * exchangeRate;
  const invoiceFreightEUR = airfreightPct !== null ? invoiceFreightPaidEUR * airfreightPct : invoiceFreightPaidEUR;
  customsValue += invoiceFreightEUR;
  freightExcludedEUR += invoiceFreightPaidEUR - invoiceFreightEUR;
  /* Carriage from the EU border or port to the first destination in Luxembourg, when paid
     separately: never in the customs value, always in the VAT base (Art. 86(1)(b)). */
  const onwardCarriageEUR = number(input.onwardCarriage) * exchangeRate;

  const deMinimisActive = now < DE_MINIMIS_ENDS;
  const dutyFree = deMinimisActive && customsValue <= DE_MINIMIS_LIMIT;

  const dutyRate = number(input.dutyRatePct) / 100;
  const agreement = ORIGIN_AGREEMENTS[origin]?.type || "";
  /* A preference counts only when the rate in hand IS the preferential one TARIC gave for this
     code and origin, and the proof is held. Until 2026-10-10 a ticked box with no TARIC rate
     behind it invented a discount by agreement type (0% for any FTA or EPA country, 35% of the
     rate for GSP, 20% for GSP+). Neither the GSP (full suspension or 3.5 points off, by product)
     nor the phased FTAs work like that: where TARIC lists no preference, there is none to claim,
     and the rate stays what was typed. */
  const claimingPreference = !!input.preferential && !!input.hasProofOfOrigin && !!input.usingPreferentialRate;

  /* A specific or compound duty (euros per 100 kg, per litre…) needs the quantities declared:
     `dutyExpression` is TARIC's text and `quantities` is { kg, l, lpa, items, m2, m3 }. When the
     expression cannot be applied for want of a quantity, the duty is null and `dutyNeeds` says what
     is missing, so the screen asks rather than printing a percentage of nothing. */
  const expression = input.dutyExpression ? parseDutyRate(input.dutyExpression) : null;
  const quantities = input.quantities && typeof input.quantities === "object" ? input.quantities : {};
  let customsDuty = dutyFree ? 0 : customsValue * dutyRate;
  let dutyNeeds = [];
  if (expression && expression.complete && !dutyFree) {
    const applied = applyDuty(expression, customsValue, quantities);
    if (applied == null) {
      dutyNeeds = [...new Set([expression, expression.min, expression.max].flatMap((p) => (p?.specifics ?? []).map((s) => s.basis)).filter(Boolean))];
      customsDuty = null;
    } else customsDuty = applied;
  }
  /* Anti-dumping duty is a trade defence measure: de minimis does not reach it (UCC Art. 83). */
  const antiDumpingRate = number(input.antiDumpingRatePct) / 100;
  const antiDumpingDuty = customsValue * antiDumpingRate;
  const exciseDuty = number(input.exciseDuty);
  const dutyKnown = customsDuty != null;
  const dutyForBase = customsDuty ?? 0;

  const vatRate = input.vatRatePct != null ? number(input.vatRatePct) / 100 : getLuVAT(hsCode, !!input.stillWineLow);
  /* VAT is charged on the customs value, every duty on it, and the incidental costs up to the first
     place of destination in Luxembourg (VAT Directive Art. 86(1)(b), Loi TVA art. 34): that is the
     freight customs left out and the onward carriage, which the customs value does not hold. */
  const vatBase = customsValue + dutyForBase + antiDumpingDuty + exciseDuty + freightExcludedEUR + onwardCarriageEUR;
  /* Who bears the VAT. Import VAT is charged and paid at import whoever the importer is (ELP,
     2026-10-10: "it needs to be paid every time; companies then request it back"), so it is in the
     total in every case. "recoverable" marks a Luxembourg VAT-registered business that reclaims it
     on its return: the same total, with the reclaimable part named. "procedure42" is the one case
     with no import VAT here: the goods go straight on to another member state and the customer
     self-accounts at destination. "cost" is a private person or an unregistered importer. */
  const vatPosition = ["cost", "recoverable", "procedure42"].includes(input.vatPosition) ? input.vatPosition : "cost";
  const importVAT = vatPosition === "procedure42" ? 0 : vatBase * vatRate;
  const vatRecoverable = vatPosition === "recoverable" ? importVAT : 0;

  return {
    valueEUR,
    /** The freight in the customs value: the freight box's share, or the invoice line's. */
    freightEUR: (terms.needsFreight ? freightEUR : 0) + invoiceFreightEUR,
    /** The freight paid that is not in the customs value: the airline's share beyond the zone percentage. */
    freightExcludedEUR,
    onwardCarriageEUR,
    insuranceEUR,
    airfreightPct: airfreightPct === null ? null : airfreightPct * 100,
    customsValue,
    dutyFree,
    deMinimisExpiringSoon: dutyFree && now >= new Date("2026-04-01"),
    effectiveDutyRate: dutyRate * 100,
    /** TARIC's duty text as read, when one was given; the screen shows it beside the figure. */
    dutyExpression: expression,
    /** Null when a specific duty could not be applied: `dutyNeeds` names the quantities missing. */
    customsDuty,
    dutyNeeds,
    antiDumpingRate: antiDumpingRate * 100,
    antiDumpingDuty,
    exciseDuty,
    vatRate,
    vatBase,
    vatPosition,
    importVAT,
    /* What the import costs: everything paid for the goods and their carriage, plus what customs
       charges on it, VAT included. The customs value alone is not the cost when part of the freight
       sits outside it. `vatRecoverable` is the part of that a registered business gets back later;
       `cashAtImport` is what customs collects on the day. */
    total: dutyKnown
      ? customsValue + freightExcludedEUR + onwardCarriageEUR + customsDuty + antiDumpingDuty + exciseDuty + importVAT
      : null,
    vatRecoverable,
    cashAtImport: dutyKnown ? customsDuty + antiDumpingDuty + exciseDuty + importVAT : null,
    preference: claimingPreference ? agreement || "fta" : null,
    incoterm,
  };
}

/* ------------------------------------------------------- a whole invoice ---- */

/**
 * A shipment of several lines on one invoice. Each line has its own code, rates and value; the
 * freight, insurance and onward carriage are the shipment's and are spread over the lines by value,
 * which is how a declaration apportions them (UCC-IA Art. 138 lets any reasonable key serve; value
 * is the one customs expects). Each line is then landedCost() on its own, and the totals are sums.
 *
 *   landedCostShipment({ lines: [{ value, hsCode, origin?, dutyRatePct, dutyExpression?, quantities?,
 *                                   antiDumpingRatePct?, exciseDuty?, vatRatePct?, usingPreferentialRate?,
 *                                   preferential?, hasProofOfOrigin? }],
 *                        exchangeRate, incoterm, transportMode, origin, freight, invoiceFreight, insurance,
 *                        onwardCarriage, vatPosition, now })
 */
export function landedCostShipment(input = {}) {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const values = lines.map((l) => Math.max(0, number(l.value)));
  const sumValue = values.reduce((a, b) => a + b, 0);
  const share = (i) => (sumValue > 0 ? values[i] / sumValue : lines.length ? 1 / lines.length : 0);

  const results = lines.map((line, i) => landedCost({
    ...input,
    ...line,
    origin: line.origin || input.origin,
    freight: number(input.freight) * share(i),
    invoiceFreight: number(input.invoiceFreight) * share(i),
    insurance: number(input.insurance) * share(i),
    onwardCarriage: number(input.onwardCarriage) * share(i),
    /* A line's own VAT rate wins; otherwise the shipment's; otherwise the chapter's. */
    vatRatePct: line.vatRatePct ?? input.vatRatePct ?? null,
  }));

  const sum = (key) => results.reduce((a, r) => (a == null || r[key] == null ? null : a + r[key]), 0);
  const first = results[0];
  return {
    lines: results.map((r, i) => ({ ...r, share: share(i) })),
    valueEUR: sum("valueEUR"),
    freightEUR: sum("freightEUR"),
    freightExcludedEUR: sum("freightExcludedEUR"),
    onwardCarriageEUR: sum("onwardCarriageEUR"),
    insuranceEUR: sum("insuranceEUR"),
    airfreightPct: first ? first.airfreightPct : null,
    customsValue: sum("customsValue"),
    customsDuty: sum("customsDuty"),
    dutyNeeds: [...new Set(results.flatMap((r) => r.dutyNeeds))],
    antiDumpingDuty: sum("antiDumpingDuty"),
    exciseDuty: sum("exciseDuty"),
    vatBase: sum("vatBase"),
    importVAT: sum("importVAT"),
    vatRecoverable: sum("vatRecoverable"),
    vatPosition: first ? first.vatPosition : "cost",
    total: sum("total"),
    cashAtImport: sum("cashAtImport"),
    incoterm: first ? first.incoterm : (INCOTERMS_CIF[input.incoterm] ? input.incoterm : "EXW"),
  };
}
