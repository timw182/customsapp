"use client";
import HsLookupTabV2 from "./HsLookupTabV2";
import dynamic from "next/dynamic";
const CustomsFlow = dynamic(() => import("./CustomsFlow"), { ssr: false, loading: () => <div style={{padding:40,color:"#6b7280",textAlign:"center"}}>Loading flow…</div> });
import T1DraftTab from "./T1DraftTab";
import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";

// Luxembourg VAT rates (Loi TVA, 2026)
// Maps HS chapter to applicable VAT rate
const LU_VAT_RATES_3 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 36, 49];
const LU_VAT_RATES_8 = [27, 90];
// Chapter 22: still wine ≤13° ABV = 14%, still wine >13° ABV = 17%, sparkling/beer/spirits = 17%
// stillWineLow flag passed from UI when user confirms still wine ≤13° ABV
// chapter 30 pharma = 3%, chapter 61-64 children items = 3% (needs user input for size)

function getLuVAT(hsCode, stillWineLow = false) {
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
const EXCISE_RATES = {
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
const EXCISE_SCHEMAS = {
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

// ─── CBAM (Carbon Border Adjustment Mechanism) — EU Regulation 2023/956 ────────
// Phase-in factor = fraction of embedded emissions requiring CBAM certificate purchase
// = 1 − share of free EU ETS allowances (free allocation phased out per ETS Directive Art. 10a)
// Financial obligations start 1 Jan 2026. From 2026 importers must surrender CBAM certificates.
const CBAM_FACTOR = {
  2026: 0.025,  // 2.5% (97.5% free allocation remaining)
  2027: 0.05,   // 5%
  2028: 0.1,    // 10%
  2029: 0.225,  // 22.5%
  2030: 0.485,  // 48.5%
  2031: 0.73,   // 73%
  2032: 0.865,  // 86.5%
  2033: 0.98,   // 98%
  2034: 1.0,    // 100% — no more free allocation
};

// Default embedded emission factors (tCO₂e / tonne or MWh) — pre-markup
// Source: EU Implementing Regulation 2025/2621
const CBAM_DEFAULT_EMISSIONS = {
  steel: {
    CN: 3.486,
    IN: 4.697,
    RU: 3.531,
    TR: 2.541,
    UA: 2.476,
    US: 1.618,
    EG: 3.21,
    BR: 2.23,
    KR: 2.15,
    default: 2.9,
  },
  aluminium: { CN: 14.1, IN: 9.6, RU: 4.2, TR: 5.3, NO: 0.7, CA: 1.8, EG: 4.8, default: 6.7 },
  cement: { UA: 1.518, EG: 1.419, TR: 0.895, CN: 1.051, IN: 1.131, MA: 1.102, DZ: 1.089, default: 0.87 },
  fertilisers: { RU: 2.7, CN: 6.8, EG: 2.1, TN: 2.3, MA: 2.6, SA: 2.2, default: 3.5 },
  hydrogen: { RU: 8.9, CN: 9.0, US: 8.8, NO: 0.5, SA: 9.1, default: 8.9 },
  electricity: { CN: 0.555, IN: 0.708, RU: 0.334, TR: 0.328, UA: 0.344, BA: 0.685, RS: 0.54, default: 0.35 },
};

// EU ETS product benchmarks (tCO₂e/tonne) — best-available technology reference
const CBAM_BENCHMARKS = {
  steel_bf_bof: 1.37,
  steel_dri_eaf: 0.481,
  steel_scrap_eaf: 0.072,
  aluminium_primary: 1.423,
  aluminium_secondary: 0.091,
  cement: 0.766,
  ammonia_ng: 1.522,
};

// Default value markup applied on top of base default emission factors
// (penalises use of default values vs verified actual emissions)
const CBAM_MARKUP = (year, isFertiliser) => (isFertiliser ? 1.01 : year <= 2026 ? 1.1 : year === 2027 ? 1.2 : 1.3);

const CBAM_SECTORS = {
  steel: {
    label: "Steel & Iron",
    cnCodes: "CN 7201–7326",
    unit: "tonne",
    indirectIncluded: false,
    routes: [
      { value: "bf_bof", label: "BF/BOF — Blast Furnace + Basic Oxygen Furnace", benchmark: "steel_bf_bof" },
      { value: "dri_eaf", label: "DRI/EAF — Direct Reduced Iron + Electric Arc Furnace", benchmark: "steel_dri_eaf" },
      { value: "scrap_eaf", label: "Scrap EAF — Electric Arc Furnace (scrap-fed)", benchmark: "steel_scrap_eaf" },
    ],
  },
  aluminium: {
    label: "Aluminium",
    cnCodes: "CN 7601–7616",
    unit: "tonne",
    indirectIncluded: false,
    routes: [
      { value: "primary", label: "Primary aluminium (electrolysis)", benchmark: "aluminium_primary" },
      { value: "secondary", label: "Secondary aluminium (recycled scrap)", benchmark: "aluminium_secondary" },
    ],
  },
  cement: {
    label: "Cement",
    cnCodes: "CN 2523",
    unit: "tonne",
    indirectIncluded: true,
    routes: null,
    benchmark: "cement",
  },
  fertilisers: {
    label: "Fertilisers (N-based)",
    cnCodes: "CN 2814, 3102, 3105",
    unit: "tonne",
    indirectIncluded: true,
    routes: null,
    isFertiliser: true,
  },
  hydrogen: {
    label: "Hydrogen",
    cnCodes: "CN 2804 10 00",
    unit: "tonne",
    indirectIncluded: false,
    routes: [
      { value: "smr", label: "Steam Methane Reforming (grey/blue H₂)", benchmark: "ammonia_ng" },
      { value: "electrolysis", label: "Electrolysis (green H₂, low-emission)", benchmark: null },
    ],
  },
  electricity: {
    label: "Electricity",
    cnCodes: "CN 2716 00 00",
    unit: "MWh",
    indirectIncluded: true,
    routes: null,
    noDeMinimis: true,
  },
};

// Comprehensive EU trade preference data
// pref: true = preferential rates available (FTA/GSP/EBA/EEA/CU)
// type: 'fta'|'eea'|'cu'|'gsp'|'gsp+'|'eba'|'atp'|'mfn'|'sanctioned'
// proof: proof of origin document required
const ORIGIN_AGREEMENTS = {
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

// CBAM countries - derived from ORIGIN_AGREEMENTS
const CBAM_COUNTRIES = Object.entries(ORIGIN_AGREEMENTS)
  .map(([code, info]) => ({ code, name: info.name }))
  .sort((a, b) => a.name.localeCompare(b.name))
  .concat([{ code: "default", name: "Other / Unknown" }]);

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

// All 11 Incoterms 2020 with CIF conversion logic
// EU customs value = CIF at first EU point of entry
const INCOTERMS_CIF = {
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
const AIRFREIGHT_ZONES = {
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

function getAirfreightPct(countryCode) {
  return (AIRFREIGHT_ZONES[countryCode] ?? 70) / 100;
}

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
  const [transportMode, setTransportMode] = useState("air"); // air only for now
  const [preferential, setPreferential] = useState(false);
  const [hasProofOfOrigin, setHasProofOfOrigin] = useState(false);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateDate, setRateDate] = useState(null);
  const [hsResult, setHsResult] = useState(null);
  const [hsLoading, setHsLoading] = useState(false);
  const [dutyRateSource, setDutyRateSource] = useState(null);
  const [antiDumpingRate, setAntiDumpingRate] = useState(""); // ADD rate % if applicable
  const [stillWineLow, setStillWineLow] = useState(false); // true = still wine ≤13° ABV → 14% VAT
  const [dutyRateLoading, setDutyRateLoading] = useState(false);
  const [taricData, setTaricData] = useState(null);
  const [showChapterPopup, setShowChapterPopup] = useState(false);
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

  const [exciseCategory, setExciseCategory] = useState("beer");
  const [exciseInputs, setExciseInputs] = useState({ breweryTier: "large", above15: false });
  const [exciseCifValue, setExciseCifValue] = useState("");
  const [exciseResult, setExciseResult] = useState(null);
  const [exciseRates, setExciseRates] = useState(EXCISE_RATES);
  const [exciseRatesLastChecked, setExciseRatesLastChecked] = useState(null);
  const setExciseInput = (key, val) => setExciseInputs((prev) => ({ ...prev, [key]: val }));

  const [cbamSector, setCbamSector] = useState("steel");
  const [cbamCountry, setCbamCountry] = useState("CN");
  const [cbamTonnes, setCbamTonnes] = useState("");
  const [cbamMode, setCbamMode] = useState("default");
  const [cbamActualEmissions, setCbamActualEmissions] = useState("");
  const [cbamEtsPrice, setCbamEtsPrice] = useState("70");
  const [cbamCarbonPaid, setCbamCarbonPaid] = useState("");
  const [cbamRoute, setCbamRoute] = useState("bf_bof");
  const [cbamYear, setCbamYear] = useState(2026);
  const [cbamResult, setCbamResult] = useState(null);

  const resultRef = useRef(null);
  const connectorSvgRef = useRef(null);
  const planeFiredRef = useRef(false);

  const hasPref = ORIGIN_AGREEMENTS[originCountry]?.pref;

  // ── Persist form state to localStorage ─────────────────────
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("dutify_form") || "{}");
      if (s.tab)                   setTab(s.tab);
      if (s.description    != null) setDescription(s.description);
      if (s.hsCode         != null) setHsCode(s.hsCode);
      if (s.dutyRate       != null) setDutyRate(s.dutyRate);
      if (s.itemValue      != null) setItemValue(s.itemValue);
      if (s.freight        != null) setFreight(s.freight);
      if (s.insurance      != null) setInsurance(s.insurance);
      if (s.currency       != null) setCurrency(s.currency);
      if (s.originCountry  != null) setOriginCountry(s.originCountry);
      if (s.incoterm       != null) setIncoterm(s.incoterm);
      if (s.preferential   != null) setPreferential(s.preferential);
      if (s.hasProofOfOrigin != null) setHasProofOfOrigin(s.hasProofOfOrigin);
      if (s.antiDumpingRate != null) setAntiDumpingRate(s.antiDumpingRate);
      if (s.fxAmount       != null) setFxAmount(s.fxAmount);
      if (s.fxFrom         != null) setFxFrom(s.fxFrom);
      if (s.fxTo           != null) setFxTo(s.fxTo);
      if (s.exciseCategory != null) setExciseCategory(s.exciseCategory);
      if (s.exciseCifValue != null) setExciseCifValue(s.exciseCifValue);
      if (s.exciseInputs   != null) setExciseInputs(s.exciseInputs);
      if (s.cbamSector     != null) setCbamSector(s.cbamSector);
      if (s.cbamCountry    != null) setCbamCountry(s.cbamCountry);
      if (s.cbamTonnes     != null) setCbamTonnes(s.cbamTonnes);
      if (s.cbamMode       != null) setCbamMode(s.cbamMode);
      if (s.cbamActualEmissions != null) setCbamActualEmissions(s.cbamActualEmissions);
      if (s.cbamEtsPrice   != null) setCbamEtsPrice(s.cbamEtsPrice);
      if (s.cbamCarbonPaid != null) setCbamCarbonPaid(s.cbamCarbonPaid);
      if (s.cbamRoute      != null) setCbamRoute(s.cbamRoute);
      if (s.cbamYear       != null) setCbamYear(s.cbamYear);
    } catch {}
  }, []); // restore once on mount

  useEffect(() => {
    try {
      localStorage.setItem("dutify_form", JSON.stringify({
        tab, description, hsCode, dutyRate, itemValue, freight, insurance,
        currency, originCountry, incoterm, preferential, hasProofOfOrigin,
        antiDumpingRate, fxAmount, fxFrom, fxTo,
        exciseCategory, exciseCifValue, exciseInputs,
        cbamSector, cbamCountry, cbamTonnes, cbamMode, cbamActualEmissions,
        cbamEtsPrice, cbamCarbonPaid, cbamRoute, cbamYear,
      }));
    } catch {}
  }, [tab, description, hsCode, dutyRate, itemValue, freight, insurance,
      currency, originCountry, incoterm, preferential, hasProofOfOrigin,
      antiDumpingRate, fxAmount, fxFrom, fxTo,
      exciseCategory, exciseCifValue, exciseInputs,
      cbamSector, cbamCountry, cbamTonnes, cbamMode, cbamActualEmissions,
      cbamEtsPrice, cbamCarbonPaid, cbamRoute, cbamYear]);
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (currency === "EUR") {
      setExchangeRate(1);
      setRateDate(new Date().toISOString().split("T")[0]);
      return;
    }
    const controller = new AbortController();
    setRateLoading(true);
    fetch(`/api/fx?from=${currency}&to=EUR`, { signal: controller.signal })
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
    fetch("/api/fx?from=EUR", { signal: controller.signal })
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
    fetch("/api/excise-rates")
      .then((r) => r.json())
      .then((d) => {
        if (d.rates) {
          setExciseRates(d.rates);
          setExciseRatesLastChecked(d.lastChecked);
        }
      })
      .catch(() => {
        /* keep hardcoded fallback */
      });
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

  const lookupHS = async (overrideDesc) => {
    const desc = overrideDesc || description;
    if (!desc.trim()) return;
    setHsLoading(true);
    setHsResult(null);
    try {
      const resp = await fetch("/api/hs-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, type: "classify" }),
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
    setTaricData(null);
    try {
      // Primary: real-time TARIC API (official EU web service)
      const resp = await fetch("/api/taric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cn8: clean, countryCode: originCountry || null }),
      });
      const parsed = await resp.json();
      if (!parsed.error) {
        setTaricData(parsed);
        // Use preferential rate if available, else MFN
        // New API: preferential measures have dutyRate.adValorem (parsed object)
        const prefMeasure = parsed.preferential?.find(m => m.dutyRate?.adValorem != null);
        const prefRate = prefMeasure ? prefMeasure.dutyRate.adValorem : null;
        const appliedRate = (hasPref && prefRate != null) ? prefRate : (parsed.mfnRate ?? "");
        setDutyRate(String(appliedRate));

        // Warn if MFN is specific/compound duty (ad valorem rate may not capture full cost)
        const hasSpecificDuty = parsed.mfnRateType === 'specific' || parsed.mfnRateType === 'compound';

        setDutyRateSource({
          taricLive: true,
          aiGenerated: false,
          description: parsed.description,
          referenceDate: parsed.referenceDate,
          antiDumping: parsed.antiDumping,
          countervailing: parsed.countervailing,
          safeguard: parsed.safeguard,
          mfnRate: parsed.mfnRate,
          mfnRateType: parsed.mfnRateType,
          mfnRateParsed: parsed.mfnRateParsed,
          hasSpecificDuty,
          prefRate,
          usingPref: hasPref && prefRate != null,
          note: "Live from TARIC (" + parsed.referenceDate + ")",
        });
        setShowChapterPopup(true);
        setTimeout(() => setShowChapterPopup(false), 5000);
      } else {
        throw new Error(parsed.error);
      }
    } catch (e) {
      // Fallback: AI estimate
      try {
        const r2 = await fetch("/api/hs-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, type: "rate" }),
        });
        const p2 = await r2.json();
        setDutyRate(String(p2.mfnRate ?? ""));
        setDutyRateSource({ ...p2, aiGenerated: true });
      } catch {
        setDutyRateSource({ error: true });
      }
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
    let frEUR = fr * rate;
    const insEUR = ins * rate;

    // Apply airfreight zone % rule (EU Reg. 2015/2447, Annex 23-01)
    // Only a % of airfreight cost is included in customs value
    if (transportMode === "air") {
      const pct = getAirfreightPct(originCountry);
      frEUR = frEUR * pct;
    }

    // CIF conversion based on Incoterm 2020
    const incotermDef = INCOTERMS_CIF[incoterm] || {};
    let cifEUR = valEUR;
    if (incotermDef.needsFreight && incotermDef.needsIns) cifEUR = valEUR + frEUR + insEUR;
    else if (!incotermDef.needsFreight && incotermDef.needsIns) cifEUR = valEUR + insEUR;
    // else CIF/CIP/DAP/DPU/DDP: use value as-is

    // De minimis: €150 exemption on CUSTOMS DUTIES ONLY — abolished 1 July 2026
    // Anti-dumping duties are NOT covered by de minimis — they still apply
    const deMinimisActive = new Date() < new Date("2026-07-01");
    const dutyFree = deMinimisActive && cifEUR <= 150;
    const deMinimisExpiringSoon = deMinimisActive && cifEUR <= 150 && new Date() >= new Date("2026-04-01");

    let effectiveDutyRate = duty / 100;
    if (preferential && hasProofOfOrigin) {
      if (dutyRateSource?.usingPref) {
        // TARIC already returned the actual preferential rate — use as-is
        effectiveDutyRate = duty / 100;
      } else {
        // Fallback: rough reduction by agreement type
        const prefType = ORIGIN_AGREEMENTS[originCountry]?.type || "";
        // Turkey customs union (cu) only covers INDUSTRIAL goods (HS ch. 25–97 excl. ch. 39-40 for some)
        // Agricultural goods (HS ch. 1–24) pay MFN rates even with Turkey
        const hsChapter = parseInt(String(hsCode).replace(/\D/g, "").substring(0, 2), 10) || 0;
        const isTurkeyCUAgri = prefType === "cu" && originCountry === "TR" && hsChapter >= 1 && hsChapter <= 24;
        if (isTurkeyCUAgri) {
          // Agricultural goods from Turkey: MFN rate applies
          effectiveDutyRate = duty / 100;
        } else if (["eba", "fta", "eea", "cu", "atp", "epa"].includes(prefType)) {
          effectiveDutyRate = 0;
        } else if (prefType === "gsp+") {
          effectiveDutyRate = effectiveDutyRate * 0.2;
        } else if (prefType === "gsp") {
          effectiveDutyRate = effectiveDutyRate * 0.35;
        } else {
          effectiveDutyRate = 0;
        }
      }
    }
    const customsDuty = dutyFree ? 0 : cifEUR * effectiveDutyRate;

    // Anti-dumping duty: NOT waived by de minimis — ADD applies to all commercial shipments
    // (UCC Art. 83; ADD is a trade defence measure, not covered by customs duty exemptions)
    const addRate = parseFloat(antiDumpingRate) || 0;
    const antiDumpingDuty = cifEUR * (addRate / 100);

    // VAT rate based on HS code (Luxembourg Loi TVA)
    // stillWineLow = user confirmed still wine ≤13° ABV → 14% VAT
    const vatRate = getLuVAT(hsCode, stillWineLow);
    // VAT base: CIF + all duties including excise (Loi TVA art. 42 / UCC Art. 86)
    const exciseDutyAmt = exciseResult ? exciseResult.duty || 0 : 0;
    const vatBase = cifEUR + customsDuty + antiDumpingDuty + exciseDutyAmt;
    const importVAT = vatBase * vatRate;
    setResult({
      cifEUR,
      customsDuty,
      antiDumpingDuty,
      exciseDutyAmt,
      importVAT,
      total: cifEUR + customsDuty + antiDumpingDuty + exciseDutyAmt + importVAT,
      effectiveDutyRate: effectiveDutyRate * 100,
      addRate,
      dutyFree,
      deMinimisExpiringSoon,
      vatBase,
      vatRate,
      valEUR,
      frEUR,
      insEUR,
      airfreightPct: transportMode === "air" ? getAirfreightPct(originCountry) * 100 : null,
      prefType: preferential && hasProofOfOrigin ? ORIGIN_AGREEMENTS[originCountry]?.type || "fta" : null,
    });
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const calculateExcise = () => {
    const schema = EXCISE_SCHEMAS[exciseCategory];
    if (!schema) return;
    const inp = {
      volume: parseFloat(exciseInputs.volume) || 0,
      plato: parseFloat(exciseInputs.plato) || 0,
      abv: parseFloat(exciseInputs.abv) || 0,
      qty: parseFloat(exciseInputs.qty) || 0,
      weight: parseFloat(exciseInputs.weight) || 0,
      retailPerUnit: parseFloat(exciseInputs.retailPerUnit) || 0,
      retailPerKg: parseFloat(exciseInputs.retailPerKg) || 0,
      breweryTier: exciseInputs.breweryTier || "large",
      above15: !!exciseInputs.above15,
    };
    const calcResult = schema.calc(inp, exciseRates);
    const { duty, note } = calcResult;
    // Use dynamic vatRate from calc result (still wine varies by ABV) or schema default
    const effectiveVatRate = calcResult.vatRate ?? schema.vatRate ?? 0.17;
    const cifVal = parseFloat(exciseCifValue) || 0;
    const vatBase = cifVal + (duty || 0);
    const vatAmt = vatBase * effectiveVatRate;
    setExciseResult({
      duty: duty || 0,
      note: note || "",
      cifVal,
      vatAmt,
      vatRate: effectiveVatRate * 100,
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
    if (cbamMode === "actual") {
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
    const deMinimis = !sector.noDeMinimis && cbamSector !== "electricity" && tonnes < 50;

    // Benchmark comparison (only for default mode with a known route benchmark)
    let benchmarkEmissions = null;
    if (cbamMode === "default") {
      if (sector.routes) {
        const route = sector.routes.find((r) => r.value === cbamRoute);
        benchmarkEmissions = route?.benchmark ? (CBAM_BENCHMARKS[route.benchmark] ?? null) : null;
      } else if (sector.benchmark) {
        benchmarkEmissions = CBAM_BENCHMARKS[sector.benchmark] ?? null;
      }
    }

    setCbamResult({
      tonnes,
      totalEmbedded,
      factor,
      coveredEmissions,
      etsPrice,
      grossCost,
      carbonPaid,
      netCost,
      perUnitCost,
      deMinimis,
      emissionsSource,
      defaultPerTonne,
      benchmarkEmissions,
      year: cbamYear,
      sectorLabel: sector.label,
      unit: sector.unit,
    });
  };

  const downloadExcisePDF = async () => {
    if (!exciseResult) return;
    const res = await fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "excise",
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `excise-${Date.now()}.pdf`;
    a.click();
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

  function firePlaneAnimation() {
    if (planeFiredRef.current) return;
    const svg = connectorSvgRef.current;
    if (!svg) return;
    planeFiredRef.current = true;

    const trail = svg.querySelector(".c-trail");
    const ring = svg.querySelector(".c-ring");
    const anim = svg.querySelector("#c-anim");

    if (trail) {
      trail.style.animation = "none";
      void trail.offsetWidth;
      trail.style.strokeDasharray = "1000";
      trail.style.strokeDashoffset = "1000";
      trail.style.opacity = "1";
      trail.style.animation = "trailGrow 2.5s ease-out forwards";
    }
    if (anim) {
      anim.setAttribute("repeatCount", "1");
      anim.setAttribute("fill", "freeze");
      try { anim.beginElement(); } catch (_) {}
    }
    setTimeout(() => {
      if (ring) {
        ring.style.animation = "none";
        void ring.offsetWidth;
        ring.style.animation = "arrivalPulse 1.2s ease-out forwards";
      }
    }, 2500);
    setTimeout(() => {
      planeFiredRef.current = false;
      if (trail) { trail.style.opacity = "0"; trail.style.animation = "none"; }
      if (ring) { ring.style.opacity = "0"; ring.style.animation = "none"; }
      if (anim) {
        anim.setAttribute("repeatCount", "indefinite");
        anim.removeAttribute("fill");
        try { anim.beginElement(); } catch (_) {}
      }
    }, 5000);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "#f0dfc0",
        color: "#111827",
        fontFamily: "var(--font-dm-sans), sans-serif",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes trailGrow { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
        @keyframes arrivalPulse { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
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
        .v2-nav { display:flex; align-items:center; height:56px; background:#10b981; padding:0 24px; position:sticky; top:0; z-index:200; border-bottom:1px solid rgba(255,255,255,.06); }
        .v2-nav-logo { display:flex; align-items:center; gap:10px; margin-right:32px; text-decoration:none; }
        .v2-nav-logo-icon { width:30px; height:30px; border-radius:7px; background:#111827; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .v2-nav-logo-text { font-family:var(--font-oswald),sans-serif; font-size:20px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:#fff; }
        .v2-nav-tabs { display:flex; gap:2px; flex:1; overflow-x:auto; scrollbar-width:none; }
        .v2-nav-tabs::-webkit-scrollbar { display:none; }
        .v2-tab-btn { padding:6px 16px; border-radius:6px; font-family:var(--font-oswald),sans-serif; font-size:13px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:rgba(255,255,255,.75); cursor:pointer; border:none; background:none; white-space:nowrap; transition:.15s; position:relative; }
        .v2-tab-btn:hover { color:#fff; background:rgba(255,255,255,.07); }
        .v2-tab-btn.active { color:#fff; background:rgba(0,0,0,.15); }
        .v2-tab-btn.active::after { content:''; position:absolute; bottom:-1px; left:12px; right:12px; height:2px; background:#fff; border-radius:2px; }
        .v2-nav-right { display:flex; align-items:center; gap:10px; margin-left:auto; }
        .v2-nav-user { display:flex; align-items:center; gap:7px; font-size:12px; color:rgba(255,255,255,.75); font-family:var(--font-courier-prime),monospace; }
        .v2-nav-avatar { width:24px; height:24px; border-radius:50%; background:rgba(0,0,0,.25); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#fff; font-family:var(--font-oswald),sans-serif; }
        .v2-nav-btn { font-size:11px; font-family:var(--font-oswald),sans-serif; letter-spacing:1px; text-transform:uppercase; color:rgba(255,255,255,.75); background:none; border:1px solid rgba(255,255,255,.25); border-radius:5px; padding:4px 11px; cursor:pointer; transition:.15s; text-decoration:none; display:inline-flex; align-items:center; }
        .v2-nav-btn:hover { color:#fff; border-color:rgba(255,255,255,.5); }
        .page-content { padding: 24px; max-width: 1380px; margin: 0 auto; }
        .page-content { padding: 24px; max-width: 1380px; margin: 0 auto; }
        .header-right { text-align: right; flex-shrink: 0; }
        .fx-grid { display: grid; grid-template-columns: 52px 1fr 1fr 1fr; gap: 0; }
        .ref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
        .ref-link:hover { border-color: rgba(16,185,129,0.3) !important; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .ref-link { transition: border-color 0.2s, transform 0.15s, box-shadow 0.15s; }
        @media (max-width: 1350px) {
          .v2-tab-btn { padding: 5px 10px; letter-spacing: 0.5px; font-size: 12px; }
          .v2-nav-logo-text { font-size: 17px; letter-spacing: 2px; }
          .v2-nav-logo { margin-right: 16px; }
        }
        @media (max-width: 1100px) {
          .v2-tab-btn { padding: 5px 8px; letter-spacing: 0; font-size: 11px; }
          .v2-nav-user span { display: none; }
        }
        @media (max-width: 700px) {
          .two-col { grid-template-columns: 1fr; gap: 24px; }
          .ref-grid { grid-template-columns: 1fr; gap: 24px; }
          .v2-nav-tabs { padding: 0 4px; }
          .v2-tab-btn { padding: 6px 10px; font-size: 11px; letter-spacing: 1px; }
          
          .page-content { padding: 16px; }
          .header-right { display: none; }
          .fx-two-col { grid-template-columns: 1fr !important; }
          .fx-grid { grid-template-columns: 44px 1fr 80px; }
          .fx-grid .fx-hide { display: none; }
        }
      `}</style>

            {/* V2 Navbar */}
      <nav className="v2-nav">
        <div className="v2-nav-logo">
          <div className="v2-nav-logo-icon">
            <svg width="18" height="18" viewBox="0 0 56 56" fill="none">
              <rect x="25" y="8" width="6" height="18" rx="3" fill="#fff"/>
              <path d="M13 22L28 39L43 22" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="10" y="43" width="36" height="4" rx="2" fill="#fff"/>
            </svg>
          </div>
          <span className="v2-nav-logo-text">Dutify</span>
        </div>
        <div className="v2-nav-tabs">
          {["calculator","excise","cbam","t1","flow","hs-lookup","fx","rulings","reference"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={"v2-tab-btn" + (tab === t ? " active" : "")}
            >
              {t === "calculator" ? "Calculator"
                : t === "excise" ? "Excise"
                : t === "cbam" ? "CBAM"
                : t === "t1" ? "T1 Transit"
                : t === "flow" ? "Import Flow"
                : t === "hs-lookup" ? "HS Lookup"
                : t === "fx" ? "FX Rates"
                : t === "rulings" ? "Rulings"
                : "Reference"}
            </button>
          ))}
        </div>
        <div className="v2-nav-right">
          <div className="v2-nav-user">
            <div className="v2-nav-avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>
            <span>{user?.name || user?.email}</span>
          </div>
          {user?.role === "ADMIN" && (
            <a href="/admin" className="v2-nav-btn">Admin</a>
          )}
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="v2-nav-btn">
            Logout
          </button>
        </div>
      </nav>

      <div className="page-content">
        {/* CALCULATOR TAB */}
        {tab === "calculator" &&
          (() => {
            const needsShipping = INCOTERMS_CIF[incoterm]?.needsFreight || INCOTERMS_CIF[incoterm]?.needsIns;
            const hsChapter = parseInt(hsCode.replace(/\D/g, "").slice(0, 2)) || 0;
            const isExcisable = [22, 24, 27].includes(hsChapter);
            const isCbam = [26, 27, 28, 31, 72, 73, 76].includes(hsChapter);
            const originInfo = ORIGIN_AGREEMENTS[originCountry];
            const isSanctioned = originInfo?.type === "sanctioned";
            const totalDuties = result
              ? (result.customsDuty || 0) + (result.antiDumpingDuty || 0) + (result.exciseDutyAmt || 0) + (result.importVAT || 0)
              : 0;

            return (
              <div className="v2-tab-wrap">

                {/* ── Card 1: Goods ── */}
                <div className="v2-card">
                  <div className="v2-card-hdr">
                    <div className="v2-card-icon">📦</div>
                    <span className="v2-card-title">Goods</span>
                    <span className="v2-card-sub">Describe the item · find its CN / TARIC code</span>
                  </div>
                  <div className="v2-card-body">
                    <div className="v2-g2">
                      <div className="v2-s2">
                        <div className="v2-lbl">Description</div>
                        <input
                          className="v2-inp"
                          type="text"
                          placeholder="e.g. Samsung Galaxy S24 smartphone"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                      </div>
                      <div>
                        <div className="v2-lbl">HS / CN Code</div>
                        <div className="v2-inp-row">
                          <input
                            className="v2-inp"
                            type="text"
                            placeholder="e.g. 8471.30"
                            value={hsCode}
                            onChange={(e) => {
                              setHsCode(e.target.value);
                              setDutyRateSource(null);
                              setPreferential(false);
                              setHasProofOfOrigin(false);
                            }}
                          />
                          <button
                            className="v2-btn-ghost v2-btn-sm"
                            onClick={() => {
                              if (hsCode) {
                                lookupDutyRate(hsCode);
                              }
                            }}
                          >Rate</button>
                          <a
                            href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp"
                            target="_blank"
                            rel="noopener"
                            className="v2-btn-ghost v2-btn-sm"
                            style={{textDecoration:"none"}}
                          >Find ↗</a>
                        </div>
                        {dutyRateSource && (
                          <div className={`v2-pill ${dutyRateSource.aiGenerated ? "v2-pill-amber" : "v2-pill-green"}`} style={{marginTop:6}}>
                            {dutyRateSource.aiGenerated
                              ? `⚡ AI: ${dutyRateSource.chapter || "Ch." + hsChapter} · ${dutyRateSource.desc || ""} · VAT ${((getLuVAT(hsCode)) * 100).toFixed(0)}%`
                              : `✓ TARIC live · ${dutyRateSource.desc || ""} · VAT ${((getLuVAT(hsCode)) * 100).toFixed(0)}%`
                            }
                          </div>
                        )}
                        {dutyRateSource?.hasSpecificDuty && (
                          <div className="v2-hint" style={{color:"#d97706",marginTop:4}}>
                            ⚠ Specific/compound duty applies ({dutyRateSource.mfnRateParsed?.raw}) — enter the ad valorem component only; calculate specific duty (€/kg) separately
                          </div>
                        )}
                        {dutyRateSource?.countervailing && (
                          <div className="v2-hint" style={{color:"#dc2626",marginTop:4}}>
                            ⚠ Countervailing Duty (CVD) active — enter CVD rate in the ADD field above (separate from anti-dumping)
                          </div>
                        )}
                        {dutyRateSource?.safeguard && (
                          <div className="v2-hint" style={{color:"#dc2626",marginTop:4}}>
                            ⚠ Safeguard duty active on this product — additional tariff applies, check TARIC for current rate
                          </div>
                        )}
                      </div>

                    </div>
                    {(isExcisable || isCbam) && (
                      <div style={{marginTop:12,display:"flex",gap:8,flexWrap:"wrap"}}>
                        {isCbam && <span className="v2-tag v2-tag-blue">🏭 CBAM eligible</span>}
                        {isExcisable && <span className="v2-tag v2-tag-amber">⚡ Excise — check Excise tab</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Card 2: Shipment ── */}
                <div className="v2-card">
                  <div className="v2-card-hdr">
                    <div className="v2-card-icon">✈️</div>
                    <span className="v2-card-title">Shipment</span>
                    <span className="v2-card-sub">CIF = customs duty base (cost + insurance + freight to EU border)</span>
                  </div>
                  <div className="v2-card-body">
                    <div className="v2-g3">
                      <div>
                        <div className="v2-lbl">Item Value</div>
                        <input
                          className="v2-inp"
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          value={itemValue}
                          onChange={(e) => setItemValue(e.target.value)}
                        />
                      </div>
                      <div>
                        <div className="v2-lbl">Currency</div>
                        <select
                          className="v2-sel"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                        >
                          {CURRENCIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="v2-lbl">Incoterm</div>
                        <select className="v2-sel" value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                          {Object.entries(INCOTERMS_CIF).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        {(incoterm === "DAP" || incoterm === "DPU") && (
                          <div className="v2-hint" style={{color:"#d97706"}}>⚠ DAP/DPU: enter the goods value <strong>excluding</strong> EU internal transport. Deduct freight from EU border to named place from the price.</div>
                        )}
                        {incoterm === "DDP" && (
                          <div className="v2-hint" style={{color:"#d97706"}}>⚠ DDP: enter the customs value <strong>excluding</strong> import duties. The DDP price includes duties already paid by seller — subtract them before entering here.</div>
                        )}
                      </div>
                      {needsShipping && (
                        <>
                          <div>
                            <div className="v2-lbl">Freight Cost ({currency})</div>
                            <input
                              className="v2-inp"
                              type="number"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                              value={freight}
                              onChange={(e) => setFreight(e.target.value)}
                            />
                          </div>
                          <div>
                            <div className="v2-lbl">Insurance ({currency})</div>
                            <input
                              className="v2-inp"
                              type="number"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                              value={insurance}
                              onChange={(e) => setInsurance(e.target.value)}
                            />
                          </div>
                          <div>
                            <div className="v2-lbl">Transport Mode</div>
                            <select className="v2-sel" value={transportMode} onChange={(e) => setTransportMode(e.target.value)}>
                              <option value="air">Air (70% freight rule)</option>
                              <option value="sea">Sea / Road (full freight)</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                    {currency !== "EUR" && (
                      <div style={{marginTop:12,display:"flex",alignItems:"center",gap:10}}>
                        <span className="v2-fx-badge">
                          {rateLoading
                            ? "Loading ECB rate…"
                            : exchangeRate
                              ? `1 ${currency} = ${exchangeRate.toFixed(4)} EUR · ECB`
                              : "FX rate unavailable"
                          }
                        </span>
                        <button className="v2-btn-ghost v2-btn-sm" onClick={() => setCurrency(c => c)}>Refresh FX</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Card 3: Origin & Rates ── */}
                <div className="v2-card">
                  <div className="v2-card-hdr">
                    <div className="v2-card-icon">🌍</div>
                    <span className="v2-card-title">Origin &amp; Rates</span>
                    <span className="v2-card-sub">Country of origin determines preferential treatment &amp; anti-dumping</span>
                  </div>
                  <div className="v2-card-body">
                    <div className="v2-g2">
                      <div>
                        <div className="v2-lbl">Country of Origin</div>
                        <select
                          className="v2-sel"
                          value={originCountry}
                          onChange={(e) => { setOriginCountry(e.target.value); setHasProofOfOrigin(false); }}
                        >
                          {Object.entries(ORIGIN_AGREEMENTS)
                            .sort(([, a], [, b]) => (a.name || "").localeCompare(b.name || ""))
                            .map(([code, info]) => (
                              <option key={code} value={code}>{info.name} ({code})</option>
                            ))}
                        </select>
                        {originInfo && (
                          <div className={`v2-pill ${
                            originInfo.type === "sanctioned" ? "v2-pill-red"
                            : ["fta","eba","eea","cu","atp","epa","cta"].includes(originInfo.type) ? "v2-pill-green"
                            : originInfo.type === "gsp" || originInfo.type === "gsp+" ? "v2-pill-blue"
                            : "v2-pill-amber"
                          }`} style={{marginTop:6}}>
                            {originInfo.flag} {originInfo.name} · {originInfo.desc || originInfo.type?.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="v2-lbl">
                          Customs Duty Rate (%)
                          {dutyRateSource?.taricLive && <span className="v2-tag v2-tag-gold" style={{marginLeft:6}}>TARIC live</span>}
                          {dutyRateSource?.aiGenerated && <span className="v2-tag v2-tag-amber" style={{marginLeft:6}}>AI</span>}
                        </div>
                        <div className="v2-inp-row">
                          <input
                            className="v2-inp"
                            type="number"
                            placeholder="e.g. 3.5"
                            step="0.01"
                            min="0"
                            value={dutyRate}
                            onChange={(e) => { setDutyRate(e.target.value); setDutyRateSource((s) => s ? { ...s, aiGenerated: false } : null); }}
                          />
                          <span style={{display:"flex",alignItems:"center",padding:"0 10px",fontFamily:"var(--font-courier-prime),monospace",color:"var(--muted)"}}>%</span>
                        </div>
                        {dutyRateLoading && <div className="v2-hint">Fetching TARIC rate…</div>}
                      </div>
                      <div>
                        <div className="v2-lbl">Anti-Dumping Duty (%)</div>
                        <div className="v2-inp-row">
                          <input
                            className="v2-inp"
                            type="number"
                            placeholder="0.0"
                            step="0.01"
                            min="0"
                            value={antiDumpingRate}
                            onChange={(e) => setAntiDumpingRate(e.target.value)}
                          />
                          <span style={{display:"flex",alignItems:"center",padding:"0 10px",fontFamily:"var(--font-courier-prime),monospace",color:"var(--muted)"}}>%</span>
                        </div>
                        <div className="v2-hint">ADD applies on top of customs duty and is NOT waived by the €150 de minimis · check TARIC for active measures</div>
                      </div>
                      {/* Still wine VAT — only show when HS chapter 22 */}
                      {parseInt(String(hsCode).replace(/\D/g,"").substring(0,2),10) === 22 && (
                        <div>
                          <div className="v2-lbl">Wine VAT Rate (LU)</div>
                          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer",marginTop:4}}>
                            <input
                              type="checkbox"
                              checked={stillWineLow}
                              onChange={(e) => setStillWineLow(e.target.checked)}
                            />
                            Still wine ≤ 13° ABV → 14% VAT
                          </label>
                          <div className="v2-hint">Luxembourg: still wine ≤13° ABV = 14% VAT; {'>'}13° ABV, sparkling, beer, spirits = 17%</div>
                        </div>
                      )}
                      <div>
                        <div className="v2-lbl">Preferential Treatment</div>
                        {hasPref ? (
                          <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer"}}>
                              <input
                                type="checkbox"
                                checked={preferential}
                                onChange={(e) => { setPreferential(e.target.checked); if (!e.target.checked) setHasProofOfOrigin(false); }}
                              />
                              Claim preferential rate ({originInfo?.type?.toUpperCase()})
                            </label>
                            {preferential && (
                              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer"}}>
                                <input
                                  type="checkbox"
                                  checked={hasProofOfOrigin}
                                  onChange={(e) => setHasProofOfOrigin(e.target.checked)}
                                />
                                Proof of origin held (EUR.1 / invoice declaration)
                              </label>
                            )}
                            <div className="v2-hint" style={{marginTop:2}}>
                              {preferential && hasProofOfOrigin
                                ? "✓ Preferential rate will be applied"
                                : preferential
                                  ? "Confirm you hold proof of origin to apply the rate"
                                  : originInfo?.note || "Preferential rate available — check the box to apply"}
                            </div>
                          </div>
                        ) : (
                          <div style={{marginTop:6,fontSize:13,color:"#9ca3af"}}>
                            No EU preferential agreement — MFN rate applies
                            {originInfo?.type === "sanctioned" && <span style={{color:"#dc2626",fontWeight:600}}> ⚠️ Sanctioned country</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="v2-calc-row">
                    <button className="v2-calc-btn" onClick={calculate}>
                      Calculate
                    </button>
                    <button className="v2-reset-btn" onClick={() => { setResult(null); setDescription(""); setHsCode(""); setDutyRate(""); setItemValue(""); setFreight(""); setInsurance(""); setAntiDumpingRate(""); setDutyRateSource(null); setPreferential(false); setHasProofOfOrigin(false); }}>Reset</button>
                    <span style={{fontSize:11,color:"#9ca3af",fontFamily:"var(--font-courier-prime),monospace"}}>Results update live as you type</span>
                  </div>
                </div>

                {/* ── Breakdown ── */}
                {result && (
                  <div className="v2-bk-card">
                    <div className="v2-card-hdr">
                      <div className="v2-card-icon" style={{background:"rgba(16,185,129,0.1)"}}>📋</div>
                      <span className="v2-card-title">Calculation Breakdown</span>
                      <span className="v2-card-sub" style={{color:"#10b981",fontFamily:"var(--font-courier-prime),monospace",fontWeight:700}}>
                        Total: €{fmt(result.total)}
                      </span>
                    </div>
                    <div className="v2-card-body">
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 40px"}}>
                        <div>
                          <div className="v2-sec-h">Customs Value (CIF)</div>
                          <div className="v2-bk-row"><span className="v2-bk-lbl">Item value (EUR)</span><span className="v2-bk-val">€{fmt(result.valEUR)}</span></div>
                          {result.frEUR > 0 && <div className="v2-bk-row"><span className="v2-bk-lbl">Freight ({result.airfreightPct ?? 100}%)</span><span className="v2-bk-val">€{fmt(result.frEUR)}</span></div>}
                          {result.insEUR > 0 && <div className="v2-bk-row"><span className="v2-bk-lbl">Insurance</span><span className="v2-bk-val">€{fmt(result.insEUR)}</span></div>}
                          <div className="v2-bk-sep"/>
                          <div className="v2-bk-total"><span>CIF Value</span><span className="v2-bk-val" style={{color:"#10b981"}}>€{fmt(result.cifEUR)}</span></div>
                        </div>
                        <div>
                          <div className="v2-sec-h">Duties &amp; Taxes</div>
                          {result.deMinimisExpiringSoon && (
                            <div style={{background:"#fef3c7",border:"1px solid #f59e0b",borderRadius:6,padding:"6px 10px",fontSize:12,color:"#92400e",marginBottom:8}}>
                              ⚠️ <strong>€150 de minimis abolished 1 July 2026</strong> — customs duty will apply to this shipment after that date
                            </div>
                          )}
                          <div className="v2-bk-row">
                            <span className="v2-bk-lbl">Customs duty {result.dutyFree ? "(waived — de minimis)" : result.effectiveDutyRate.toFixed(1) + "%"}</span>
                            <span className="v2-bk-val">€{fmt(result.customsDuty)}</span>
                          </div>
                          {result.antiDumpingDuty > 0 && (
                            <div className="v2-bk-row">
                              <span className="v2-bk-lbl">Anti-dumping {result.addRate?.toFixed(1)}%</span>
                              <span className="v2-bk-val">€{fmt(result.antiDumpingDuty)}</span>
                            </div>
                          )}
                          <div className="v2-bk-row">
                            <span className="v2-bk-lbl">Import VAT {((result.vatRate || 0.17) * 100).toFixed(0)}%</span>
                            <span className="v2-bk-val">€{fmt(result.importVAT)}</span>
                          </div>
                          <div className="v2-bk-sep"/>
                          <div className="v2-bk-total"><span>Total duties</span><span className="v2-bk-val" style={{color:"#10b981"}}>€{fmt(totalDuties)}</span></div>
                        </div>
                      </div>
                      <div className="v2-bk-grand">
                        <div>
                          <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>Total landed cost (CIF + all duties)</div>
                          <div style={{fontFamily:"var(--font-courier-prime),monospace",fontSize:28,fontWeight:700,color:"var(--foreground)",letterSpacing:-1}}>€{fmt(result.total)}</div>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <button
                            className="v2-btn-ghost v2-btn-sm"
                            onClick={() => saveFavourite(hsCode)}
                          >⭐ Save HS</button>
                          <button
                            className="v2-btn-gold v2-btn-sm"
                            onClick={downloadPDF}
                            
                          >⬇ Export PDF</button>
                        </div>
                      </div>
                      {/* Proportion bar */}
                      {result.cifEUR > 0 && (
                        <div style={{marginTop:16}}>
                          <div style={{fontSize:9,letterSpacing:2,textTransform:"uppercase",color:"#9ca3af",marginBottom:6,fontFamily:"var(--font-oswald),sans-serif"}}>Composition</div>
                          <div style={{height:8,borderRadius:4,overflow:"hidden",display:"flex"}}>
                            {(() => {
                              const segments = [
                                { val: result.valEUR, color: "#e2e8f0" },
                                { val: result.customsDuty, color: "#6366f1" },
                                { val: result.antiDumpingDuty || 0, color: "#dc2626" },
                                { val: result.exciseDutyAmt || 0, color: "#d97706" },
                                { val: result.importVAT, color: "#10b981" },
                              ].filter(s => s.val > 0);
                              const tv = segments.reduce((a, s) => a + s.val, 0);
                              return segments.map((s, i) => (
                                <div key={i} style={{flex: s.val / tv, background: s.color}} />
                              ));
                            })()}
                          </div>
                          <div style={{display:"flex",gap:10,marginTop:6,flexWrap:"wrap"}}>
                            {[
                              {label:"Goods",color:"#e2e8f0",text:"#9ca3af"},
                              {label:"Duty",color:"#6366f1",text:"#6366f1"},
                              ...(result.antiDumpingDuty > 0 ? [{label:"ADD",color:"#dc2626",text:"#dc2626"}] : []),
                              ...(result.exciseDutyAmt > 0 ? [{label:"Excise",color:"#d97706",text:"#d97706"}] : []),
                              {label:"VAT",color:"#10b981",text:"#10b981"},
                            ].map(({label,color,text}) => (
                              <div key={label} style={{display:"flex",alignItems:"center",gap:4,fontSize:9}}>
                                <div style={{width:8,height:8,borderRadius:2,background:color}}/>
                                <span style={{color:text}}>{label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Excise / CBAM alerts */}
                {isExcisable && (
                  <div style={{background:"rgba(245,158,11,.05)",border:"1px solid rgba(245,158,11,.25)",borderRadius:8,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>🥃</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#d97706"}}>Excise Duty Required</div>
                      <div style={{fontSize:10,color:"#9ca3af"}}>This HS chapter is excisable (alcohol / tobacco / fuel).</div>
                    </div>
                    <button onClick={() => setTab("excise")} style={{fontSize:10,color:"#d97706",background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.3)",borderRadius:4,padding:"4px 10px",cursor:"pointer",fontWeight:700}}>Excise →</button>
                  </div>
                )}
                {isCbam && (
                  <div style={{background:"rgba(59,130,246,.05)",border:"1px solid rgba(59,130,246,.25)",borderRadius:8,padding:"12px 16px",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>🌍</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#2563eb"}}>CBAM Applies</div>
                      <div style={{fontSize:10,color:"#9ca3af"}}>Carbon Border Adjustment Mechanism applies.</div>
                    </div>
                    <button onClick={() => setTab("cbam")} style={{fontSize:10,color:"#2563eb",background:"rgba(59,130,246,.1)",border:"1px solid rgba(59,130,246,.3)",borderRadius:4,padding:"4px 10px",cursor:"pointer",fontWeight:700}}>CBAM →</button>
                  </div>
                )}

                {/* Disclaimer */}
                <div style={{padding:"10px 14px",background:"#f9fafb",border:"1px solid var(--border)",borderRadius:6,fontSize:10,color:"#9ca3af",lineHeight:1.6}}>
                  ⚠ Estimate only. Verify at{" "}
                  <a href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp" target="_blank" rel="noopener" style={{color:"var(--gold)"}}>TARIC ↗</a>.
                </div>

              </div>
            );
          })()}
        {/* EXCISE TAB */}
        {tab === "excise" && (
          <div className="v2-tab-wrap">
            <div className="v2-card">
              <div className="v2-card-hdr"><div className="v2-card-icon">🏛️</div><span className="v2-card-title">Excise Duty Calculator</span><span className="v2-card-sub">Luxembourg ADA rates · 2026</span></div>
              <div className="v2-card-body">
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 2,
                  padding: 24,
                  display: "grid",
                  gap: 16,
                }}
              >
                {/* Category */}
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
                    Category
                  </label>
                  <select
                    value={exciseCategory}
                    onChange={(e) => {
                      setExciseCategory(e.target.value);
                      setExciseInputs({ breweryTier: "large", above15: false });
                      setExciseResult(null);
                    }}
                  >
                    {["Alcohol", "Tobacco", "Energy"].map((group) => (
                      <optgroup key={group} label={group}>
                        {Object.entries(EXCISE_SCHEMAS)
                          .filter(([, s]) => s.group === group)
                          .map(([key, s]) => (
                            <option key={key} value={key}>
                              {s.label}
                            </option>
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
                  const lbl = {
                    fontSize: 11,
                    color: "#6b7280",
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    display: "block",
                    marginBottom: 6,
                  };
                  return (
                    <>
                      {inp.includes("volume") && (
                        <div>
                          <label style={lbl}>Volume (litres)</label>
                          <input
                            type="number"
                            placeholder="e.g. 100"
                            min="0"
                            step="0.1"
                            value={exciseInputs.volume ?? ""}
                            onChange={(e) => setExciseInput("volume", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("plato") && (
                        <div>
                          <label style={lbl}>Original Gravity (°Plato)</label>
                          <input
                            type="number"
                            placeholder="e.g. 12"
                            min="0"
                            max="30"
                            step="0.1"
                            value={exciseInputs.plato ?? ""}
                            onChange={(e) => setExciseInput("plato", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("breweryTier") && (
                        <div>
                          <label style={lbl}>Brewery Annual Output</label>
                          <select
                            value={exciseInputs.breweryTier || "large"}
                            onChange={(e) => setExciseInput("breweryTier", e.target.value)}
                          >
                            <option value="large">&gt; 200,000 hl/yr — €0.7933/hl/°P</option>
                            <option value="medium">≤ 200,000 hl/yr — €0.4462/hl/°P</option>
                            <option value="small">≤ 50,000 hl/yr — €0.3966/hl/°P</option>
                          </select>
                        </div>
                      )}
                      {inp.includes("abv") && (
                        <div>
                          <label style={lbl}>Alcohol % vol (ABV)</label>
                          <input
                            type="number"
                            placeholder="e.g. 40"
                            min="0"
                            max="100"
                            step="0.1"
                            value={exciseInputs.abv ?? ""}
                            onChange={(e) => setExciseInput("abv", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("above15") && (
                        <div>
                          <label style={lbl}>Alcoholic Strength</label>
                          <select
                            value={exciseInputs.above15 ? "high" : "low"}
                            onChange={(e) => setExciseInput("above15", e.target.value === "high")}
                          >
                            <option value="low">≤ 15° alc — €47.10/hl</option>
                            <option value="high">&gt; 15° alc — €66.93/hl</option>
                          </select>
                        </div>
                      )}
                      {inp.includes("qty") && (
                        <div>
                          <label style={lbl}>Quantity (units)</label>
                          <input
                            type="number"
                            placeholder="e.g. 1000"
                            min="0"
                            step="1"
                            value={exciseInputs.qty ?? ""}
                            onChange={(e) => setExciseInput("qty", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("weight") && (
                        <div>
                          <label style={lbl}>Weight (kg)</label>
                          <input
                            type="number"
                            placeholder="e.g. 10"
                            min="0"
                            step="0.1"
                            value={exciseInputs.weight ?? ""}
                            onChange={(e) => setExciseInput("weight", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("retailPerUnit") && (
                        <div>
                          <label style={lbl}>Retail Price per Unit (€)</label>
                          <input
                            type="number"
                            placeholder="e.g. 0.35"
                            min="0"
                            step="0.01"
                            value={exciseInputs.retailPerUnit ?? ""}
                            onChange={(e) => setExciseInput("retailPerUnit", e.target.value)}
                          />
                        </div>
                      )}
                      {inp.includes("retailPerKg") && (
                        <div>
                          <label style={lbl}>Retail Price per kg (€) — optional</label>
                          <input
                            type="number"
                            placeholder="leave blank → minimum floor applies"
                            min="0"
                            step="0.01"
                            value={exciseInputs.retailPerKg ?? ""}
                            onChange={(e) => setExciseInput("retailPerKg", e.target.value)}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Optional CIF value for VAT calculation */}
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
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
                    Declared Goods Value (CIF, €) — optional
                  </label>
                  <input
                    type="number"
                    placeholder="For VAT calculation on goods + excise"
                    min="0"
                    step="0.01"
                    value={exciseCifValue}
                    onChange={(e) => setExciseCifValue(e.target.value)}
                  />
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 1.5 }}>
                    If provided, import VAT ({EXCISE_SCHEMAS[exciseCategory]?.vatRate * 100 ?? 17}%) is calculated on
                    goods value + excise.
                  </div>
                </div>

                {/* Stale rates notice */}
                <div
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    fontFamily: "var(--font-courier-prime), monospace",
                    lineHeight: 1.5,
                  }}
                >
                  {exciseRatesLastChecked &&
                    (() => {
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
                  <a
                    href="https://douanes.public.lu/fr/accises/taux-droits-accise.html"
                    target="_blank"
                    rel="noopener"
                    style={{ color: "#10b981" }}
                  >
                    ADA rate tables ↗
                  </a>
                </div>

                <button
                  onClick={calculateExcise}
                  className="btn-gold"
                  style={{
                    padding: "14px",
                    fontSize: 13,
                    letterSpacing: 3,
                    textTransform: "uppercase",
                    fontWeight: 700,
                    borderRadius: 2,
                    fontFamily: "var(--font-oswald), sans-serif",
                    width: "100%",
                  }}
                >
                  Calculate Excise
                </button>
              </div>
            </div>
            </div>

            <div className="v2-card">
              <div className="v2-card-hdr"><div className="v2-card-icon">📊</div><span className="v2-card-title">Result</span></div>
              <div className="v2-card-body">
              {!exciseResult ? (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 2,
                    padding: 24,
                    color: "#6b7280",
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  Select a category, enter the quantities, and press Calculate Excise.
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 2, padding: 24 }}>
                  {/* Category label */}
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: 4,
                      textTransform: "uppercase",
                      fontFamily: "var(--font-oswald), sans-serif",
                      color: "var(--muted)",
                      marginBottom: 12,
                    }}
                  >
                    {exciseResult.label}
                  </div>

                  <div style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <div className="result-row">
                      <span style={{ color: "#6b7280", fontSize: 13 }}>
                        Excise Duty (LU)
                        {exciseResult.note && (
                          <span
                            style={{
                              fontFamily: "var(--font-courier-prime), monospace",
                              marginLeft: 8,
                              fontSize: 11,
                              color: "#6b7280",
                            }}
                          >
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
                        <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                          € {fmt(exciseResult.cifVal)}
                        </span>
                      </div>
                    )}
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
                          {exciseResult.vatRate}% on {exciseResult.cifVal > 0 ? "goods + excise" : "excise only"}
                        </span>
                      </span>
                      <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                        € {fmt(exciseResult.vatAmt)}
                      </span>
                    </div>
                  </div>

                  {/* Total */}
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
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: 4,
                        textTransform: "uppercase",
                        fontFamily: "var(--font-oswald), sans-serif",
                        color: "var(--muted)",
                      }}
                    >
                      Total Excise + VAT
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-courier-prime), monospace",
                        fontSize: 28,
                        color: "var(--gold)",
                        fontWeight: 700,
                      }}
                    >
                      € {fmt(exciseResult.total)}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 11,
                      color: "#6b7280",
                      fontFamily: "var(--font-courier-prime), monospace",
                      lineHeight: 1.5,
                    }}
                  >
                    Source: Official ADA Luxembourg rates, effective 01.01.2026
                  </div>

                  <button
                    onClick={downloadExcisePDF}
                    className="btn-ghost"
                    style={{
                      marginTop: 16,
                      width: "100%",
                      padding: "10px 14px",
                      fontSize: 11,
                      letterSpacing: 2,
                      textTransform: "uppercase",
                      fontFamily: "var(--font-oswald), sans-serif",
                      border: "1px solid #e2e8f0",
                      borderRadius: 2,
                      color: "#10b981",
                      background: "none",
                      cursor: "pointer",
                    }}
                  >
                    Download PDF
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        )}

        {/* CBAM TAB */}
        {tab === "cbam" &&
          (() => {
            const sector = CBAM_SECTORS[cbamSector];
            const defaults = CBAM_DEFAULT_EMISSIONS[cbamSector] || {};
            const base = defaults[cbamCountry] ?? defaults.default;
            const markup = CBAM_MARKUP(cbamYear, !!sector?.isFertiliser);
            const previewFactor = base != null ? base * markup : null;
            const tonnes = parseFloat(cbamTonnes);
            const showDeMinimisHint = !isNaN(tonnes) && tonnes > 0 && tonnes < 50 && !sector?.noDeMinimis;

            return (
              <div className="v2-tab-wrap">
                <div className="v2-card">
                  <div className="v2-card-hdr">
                    <div className="v2-card-icon">🏭</div>
                    <span className="v2-card-title">CBAM Calculator</span>
                    <span className="v2-card-sub">Carbon Border Adjustment Mechanism · in force Jan 2026</span>
                  </div>
                  <div className="v2-card-body">
                    <div className="v2-pill v2-pill-amber" style={{marginBottom:16}}>
                      ⚠️ CBAM transitional period ended 31 Dec 2025. From Jan 2026 importers must surrender CBAM certificates at EU ETS price.
                    </div>
                    <div className="v2-g2">
                      <div>
                        <div className="v2-lbl">Product Sector</div>
                        <select
                          className="v2-sel"
                          value={cbamSector}
                          onChange={(e) => {
                            const s = CBAM_SECTORS[e.target.value];
                            setCbamSector(e.target.value);
                            setCbamResult(null);
                            if (s?.defaultMode) setCbamMode(s.defaultMode);
                          }}
                        >
                          {Object.entries(CBAM_SECTORS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        {sector?.cn && (
                          <div className="v2-hint">CN codes: {sector.cn}</div>
                        )}
                      </div>
                      <div>
                        <div className="v2-lbl">Country of Origin</div>
                        <select
                          className="v2-sel"
                          value={cbamCountry}
                          onChange={(e) => { setCbamCountry(e.target.value); setCbamResult(null); }}
                        >
                          {Object.entries(ORIGIN_AGREEMENTS)
                            .filter(([, v]) => v.name)
                            .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                            .map(([k, v]) => (
                              <option key={k} value={k}>{v.name} ({k})</option>
                            ))}
                        </select>
                        {previewFactor != null && (
                          <div className="v2-hint">
                            Default emission factor: <strong>{previewFactor.toFixed(2)} t CO₂e/t</strong>
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="v2-lbl">Net Mass (tonnes)</div>
                        <input
                          className="v2-inp"
                          type="number"
                          placeholder="0"
                          min="0"
                          step="0.01"
                          value={cbamTonnes}
                          onChange={(e) => { setCbamTonnes(e.target.value); setCbamResult(null); }}
                        />
                        {showDeMinimisHint && (
                          <div className="v2-hint v2-pill v2-pill-blue" style={{marginTop:6}}>
                            ℹ Under 50t may qualify for de minimis exemption
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="v2-lbl">EU ETS Price (€/t CO₂e)</div>
                        <input
                          className="v2-inp"
                          type="number"
                          placeholder="~65"
                          min="0"
                          step="0.01"
                          value={cbamEtsPrice}
                          onChange={(e) => { setCbamEtsPrice(e.target.value); setCbamResult(null); }}
                        />
                        <div className="v2-hint">Current ETS price · check <a href="https://ember-climate.org/insights/research/european-carbon-price-tracker/" target="_blank" rel="noopener" style={{color:"var(--gold)"}}>Ember ↗</a></div>
                      </div>
                      <div>
                        <div className="v2-lbl">Emissions Mode</div>
                        <select
                          className="v2-sel"
                          value={cbamMode}
                          onChange={(e) => { setCbamMode(e.target.value); setCbamResult(null); }}
                        >
                          <option value="default">Use default emission factor</option>
                          <option value="actual">Use actual verified emissions</option>
                        </select>
                      </div>
                      {cbamMode === "actual" && (
                        <div>
                          <div className="v2-lbl">Actual Emissions (t CO₂e/t)</div>
                          <input
                            className="v2-inp"
                            type="number"
                            placeholder="0.00"
                            min="0"
                            step="0.01"
                            value={cbamActualEmissions}
                            onChange={(e) => { setCbamActualEmissions(e.target.value); setCbamResult(null); }}
                          />
                        </div>
                      )}
                      <div>
                        <div className="v2-lbl">Carbon Price Already Paid (€/t)</div>
                        <input
                          className="v2-inp"
                          type="number"
                          placeholder="0"
                          min="0"
                          step="0.01"
                          value={cbamCarbonPaid}
                          onChange={(e) => { setCbamCarbonPaid(e.target.value); setCbamResult(null); }}
                        />
                        <div className="v2-hint">Carbon price paid in country of origin — reduces CBAM liability</div>
                      </div>
                    </div>
                    <div className="v2-calc-row" style={{marginTop:20}}>
                      <button
                        className="v2-calc-btn"
                        onClick={calculateCBAM}
                        disabled={!cbamSector || !cbamTonnes || !cbamEtsPrice}
                      >
                        Calculate CBAM
                      </button>
                      <button className="v2-reset-btn" onClick={() => { setCbamResult(null); setCbamTonnes(""); setCbamCarbonPaid("0"); setCbamActualEmissions(""); }}>
                        Reset
                      </button>
                    </div>
                    {cbamResult && (
                      <div className={`v2-pill ${cbamResult.netCost > 0 ? "v2-pill-amber" : "v2-pill-green"}`} style={{marginTop:16}}>
                        {cbamResult.netCost > 0
                          ? `⚠ CBAM liability: €${fmt(cbamResult.netCost)} · ${cbamResult.emissionFactor?.toFixed(3)} t CO₂e/t · ${fmt(cbamResult.totalEmissions)} t CO₂e total`
                          : `✓ No CBAM liability — carbon price paid in origin country covers EU ETS cost`
                        }
                      </div>
                    )}
                  </div>
                </div>

                {/* Sector reference */}
                <div className="v2-card">
                  <div className="v2-card-hdr">
                    <div className="v2-card-icon">📊</div>
                    <span className="v2-card-title">CBAM Sectors &amp; CN Codes</span>
                    <span className="v2-card-sub">Goods in scope from 1 Jan 2026</span>
                  </div>
                  <div className="v2-card-body">
                    <table className="v2-tbl">
                      <thead>
                        <tr><th>Sector</th><th>CN Chapter(s)</th><th>Default EF (t CO₂e/t)</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(CBAM_SECTORS).map(([k, v]) => (
                          <tr key={k} style={{cursor:"pointer"}} onClick={() => setCbamSector(k)}>
                            <td className="v2-bold">{v.label}</td>
                            <td className="v2-mono">{v.cn || "—"}</td>
                            <td className="v2-mono">{CBAM_DEFAULT_EMISSIONS[k]?.default?.toFixed(2) ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="v2-hint" style={{marginTop:12}}>
                      Click any row to select that sector. Emission factors are EU Commission defaults — use verified data where available.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* HS LOOKUP TAB */}
        {tab === "t1" && <T1DraftTab />}
        {tab === "flow" && <CustomsFlow />}
        {tab === "hs-lookup" && (
          <HsLookupTabV2
            description={description}
            setDescription={setDescription}
            lookupHS={lookupHS}
            hsLoading={hsLoading}
            hsResult={hsResult}
            setHsResult={setHsResult}
            favourites={favourites}
            savedCodes={savedCodes}
            saveFavourite={saveFavourite}
            removeFavourite={removeFavourite}
            setTab={setTab}
            setHsCode={setHsCode}
          />
        )}
         {tab === "fx" && (
          <div className="v2-tab-wrap">
            <div className="v2-card">
              <div className="v2-card-hdr">
                <div className="v2-card-icon">💱</div>
                <span className="v2-card-title">Currency Converter</span>
                <span className="v2-card-sub">ECB reference rates · {allRatesDate || rateDate || "loading…"}</span>
              </div>
              <div className="v2-card-body">
                <div className="v2-g3" style={{alignItems:"end"}}>
                  <div>
                    <div className="v2-lbl">Amount</div>
                    <input className="v2-inp" type="number" value={fxAmount} onChange={(e) => setFxAmount(e.target.value)} placeholder="1.00"/>
                  </div>
                  <div>
                    <div className="v2-lbl">From</div>
                    <select className="v2-sel" value={fxFrom} onChange={(e) => setFxFrom(e.target.value)}>
                      {["EUR",...Object.keys(allRates)].sort().map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="v2-lbl">To</div>
                    <div className="v2-inp-row">
                      <select className="v2-sel" value={fxTo} onChange={(e) => setFxTo(e.target.value)}>
                        {["EUR",...Object.keys(allRates)].sort().map((c) => <option key={c}>{c}</option>)}
                      </select>
                      <button className="v2-btn-ghost" style={{flexShrink:0}} onClick={() => { const t=fxFrom; setFxFrom(fxTo); setFxTo(t); }}>⇄</button>
                    </div>
                  </div>
                </div>
                {(() => {
                  const converted = convertFX(fxAmount, fxFrom, fxTo);
                  const rate = convertFX(1, fxFrom, fxTo);
                  if (!fxAmount || converted === null) return null;
                  return (
                    <div className="v2-pill v2-pill-green" style={{marginTop:14}}>
                      <span style={{fontFamily:"var(--font-courier-prime),monospace",fontSize:22,fontWeight:700,color:"#059669"}}>
                        {converted.toLocaleString("de-LU",{minimumFractionDigits:4,maximumFractionDigits:4})} {fxTo}
                      </span>
                      <span style={{fontSize:12,color:"#6B7280",display:"block",marginTop:4,fontFamily:"var(--font-courier-prime),monospace"}}>
                        1 {fxFrom} = {rate?.toFixed(6)} {fxTo} · ECB {allRatesDate || rateDate}
                      </span>
                    </div>
                  );
                })()}
                <div style={{marginTop:12,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span className="v2-fx-badge">ECB · {allRatesDate || rateDate || "..."}</span>
                  <button className="v2-btn-ghost v2-btn-sm" onClick={async () => { setAllRatesLoading(true); try { const r=await fetch("/api/fx"); const d=await r.json(); if(d.rates){setAllRates(d.rates);setAllRatesDate(d.date);} } catch(e){} setAllRatesLoading(false); }}>
                    {allRatesLoading ? "…" : "Refresh FX"}
                  </button>
                </div>
              </div>
            </div>
            <div className="v2-card">
              <div className="v2-card-hdr">
                <div className="v2-card-icon">📊</div>
                <span className="v2-card-title">FX Rates</span>
                <span className="v2-card-sub">European Central Bank · updated daily</span>
              </div>
              <div style={{padding:0}}>
                <div className="v2-fx-hdr">
                  <div/>
                  <div>Currency</div>
                  <div style={{textAlign:"right"}}>Rate to EUR</div>
                  <div style={{textAlign:"right"}}>EUR per unit</div>
                </div>
                {Object.entries(allRates).length === 0 ? (
                  <div style={{padding:"24px 20px",textAlign:"center",color:"#9CA3AF",fontSize:13}}>Loading rates…</div>
                ) : (
                  [
                    {code:"USD",flag:"🇺🇸",name:"US Dollar"},
                    {code:"GBP",flag:"🇬🇧",name:"Pound Sterling"},
                    {code:"CHF",flag:"🇨🇭",name:"Swiss Franc"},
                    {code:"JPY",flag:"🇯🇵",name:"Japanese Yen"},
                    {code:"CNY",flag:"🇨🇳",name:"Chinese Yuan"},
                    {code:"CAD",flag:"🇨🇦",name:"Canadian Dollar"},
                    {code:"AUD",flag:"🇦🇺",name:"Australian Dollar"},
                    {code:"HKD",flag:"🇭🇰",name:"Hong Kong Dollar"},
                    {code:"KRW",flag:"🇰🇷",name:"South Korean Won"},
                    {code:"INR",flag:"🇮🇳",name:"Indian Rupee"},
                    {code:"TRY",flag:"🇹🇷",name:"Turkish Lira"},
                    {code:"NOK",flag:"🇳🇴",name:"Norwegian Krone"},
                    {code:"SEK",flag:"🇸🇪",name:"Swedish Krona"},
                    {code:"DKK",flag:"🇩🇰",name:"Danish Krone"},
                    {code:"PLN",flag:"🇵🇱",name:"Polish Zloty"},
                    {code:"CZK",flag:"🇨🇿",name:"Czech Koruna"},
                  ].filter(({code}) => allRates[code]).map(({code,flag,name}) => {
                    const rate = allRates[code];
                    if (!rate) return null;
                    const rateToEur = 1/rate;
                    return (
                      <div key={code} className="v2-fx-row">
                        <span className="v2-fx-flag">{flag}</span>
                        <div className="v2-fx-name">{name}<span className="v2-fx-code">{code}</span></div>
                        <div className="v2-fx-rate">{rateToEur.toFixed(4)}</div>
                        <div className="v2-fx-inv">{rate.toFixed(4)} EUR/{code}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

         {tab === "rulings" && (
          <div className="v2-tab-wrap">
            <div className="v2-card">
              <div className="v2-card-hdr">
                <div className="v2-card-icon">⚖️</div>
                <span className="v2-card-title">Binding Tariff Information</span>
                <span className="v2-card-sub">BTI rulings database · EBTI search</span>
              </div>
              <div className="v2-card-body">
                <div className="v2-lbl">Search by CN / HS Code</div>
                <div className="v2-inp-row" style={{marginBottom:12}}>
                  <input
                    className="v2-inp"
                    type="text"
                    placeholder="e.g. 8471.30 or 847130"
                    value={hsCode}
                    onChange={(e) => setHsCode(e.target.value.replace(/[^0-9.]/g,""))}
                  />
                  <span style={{display:"flex",alignItems:"center",padding:"0 10px",fontFamily:"var(--font-courier-prime),monospace",color:"#9CA3AF",fontSize:12,flexShrink:0,whiteSpace:"nowrap"}}>
                    {hsCode ? `→ ${hsCode.replace(/\D/g,"").padEnd(8,"·")}` : "enter code"}
                  </span>
                </div>
                <div className="v2-pill v2-pill-blue" style={{marginBottom:16}}>
                  BTI rulings are legally binding for 3 years. Check EBTI before requesting a new one. Shared with HS Lookup &amp; Calculator tabs.
                </div>
                <div className="v2-sec-h">Classification databases</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[
                    {name:"EU EBTI — European Binding Tariff Information",authority:"European Commission / DG TAXUD",desc:"Legally binding BTI decisions issued by EU member states. Binding across the entire EU for 3 years.",url:`https://ec.europa.eu/taxation_customs/dds2/ebti/ebti_consultation.jsp?Lang=en${hsCode.replace(/\D/g,"").length>=4?`&nomenc=${hsCode.replace(/\D/g,"").slice(0,8)}`:""}`,flag:"🇪🇺",badge:"Binding · EU-wide",badgeColor:"#059669"},
                    {name:"TARES — Décisions de Classification",authority:"BAZG / Switzerland",desc:"Swiss customs classification decisions. Useful for CH/LI goods and EU comparison.",url:"https://www.bazg.admin.ch/fr/decisions-classification-tarifaire-tares",flag:"🇨🇭",badge:"Switzerland",badgeColor:"#dc2626"},
                    {name:"UK BTI — Binding Tariff Information",authority:"HMRC / UK Trade Tariff",desc:"UK post-Brexit BTI decisions. Useful for UK-origin goods.",url:`https://www.trade-tariff.service.gov.uk/binding_tariff_information${hsCode.replace(/\D/g,"").length>=4?`?commodity_code=${hsCode.replace(/\D/g,"")}`:""}`,flag:"🇬🇧",badge:"Post-Brexit",badgeColor:"#1d4ed8"},
                    {name:"WCO — Classification Opinions",authority:"World Customs Organization",desc:"International HS Committee opinions. Authoritative for HS6 chapter-level disputes.",url:"https://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools/hs_classification_opinions.aspx",flag:"🌐",badge:"HS6 · Global",badgeColor:"#7c3aed"},
                    {name:"ECICS — Chemical Substances",authority:"European Commission",desc:"EU classification of chemical substances. Essential for Chapter 28/29/38 goods.",url:"https://ec.europa.eu/taxation_customs/dds2/ecics/chemicalsubstance_consultation.jsp?Lang=en",flag:"⚗️",badge:"Ch. 28–38",badgeColor:"#d97706"},
                  ].map(({name,authority,desc,url,flag,badge,badgeColor}) => (
                    <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="v2-ruling-card">
                      <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                        <span style={{fontSize:22,flexShrink:0,lineHeight:1}}>{flag}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
                            <span style={{fontSize:13,fontWeight:700,color:"#111827"}}>{name}</span>
                            <span style={{fontSize:10,fontWeight:700,letterSpacing:1,padding:"2px 7px",borderRadius:10,background:`${badgeColor}18`,color:badgeColor,textTransform:"uppercase",fontFamily:"var(--font-oswald),sans-serif"}}>{badge}</span>
                          </div>
                          <div className="v2-ruling-meta">{authority}</div>
                          <div className="v2-ruling-desc" style={{marginTop:4}}>{desc}</div>
                        </div>
                        <span style={{fontSize:14,color:"#10b981",flexShrink:0}}>↗</span>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

         {tab === "reference" && (
          <div className="v2-tab-wrap">
            <div className="v2-card">
              <div className="v2-card-hdr">
                <div className="v2-card-icon">📚</div>
                <span className="v2-card-title">Reference</span>
                <span className="v2-card-sub">Official sources &amp; tools</span>
              </div>
              <div className="v2-card-body">
                <div className="v2-sec-h" style={{marginBottom:10}}>EU Customs</div>
                <div className="v2-ref-grid" style={{marginBottom:20}}>
                  <a className="v2-ref-link" href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp" target="_blank" rel="noopener"><div className="v2-ref-link-title">TARIC Consultation</div><div className="v2-ref-link-desc">Official EU TARIC database — duty rates, measures, suspensions</div><div className="v2-ref-link-url">ec.europa.eu/taxation_customs</div></a>
                  <a className="v2-ref-link" href="https://ec.europa.eu/taxation_customs/dds2/ebti/ebti_consultation.jsp" target="_blank" rel="noopener"><div className="v2-ref-link-title">EBTI — BTI Rulings</div><div className="v2-ref-link-desc">European BTI database — binding classification rulings</div><div className="v2-ref-link-url">ec.europa.eu/…/ebti</div></a>
                  <a className="v2-ref-link" href="https://www.wcotradetools.org/en/harmonized-system" target="_blank" rel="noopener"><div className="v2-ref-link-title">WCO — HS Nomenclature</div><div className="v2-ref-link-desc">HS 2022 explanatory notes and classification opinions</div><div className="v2-ref-link-url">wcotradetools.org</div></a>
                  <a className="v2-ref-link" href="https://cbam.ec.europa.eu/" target="_blank" rel="noopener"><div className="v2-ref-link-title">CBAM Registry</div><div className="v2-ref-link-desc">EU CBAM — register, certificates, embedded emissions</div><div className="v2-ref-link-url">cbam.ec.europa.eu</div></a>
                  <a className="v2-ref-link" href="https://trade.ec.europa.eu/access-to-markets/en/home" target="_blank" rel="noopener"><div className="v2-ref-link-title">EU Market Access</div><div className="v2-ref-link-desc">Trade agreements, tariff concessions and rules of origin</div><div className="v2-ref-link-url">trade.ec.europa.eu</div></a>
                  <a className="v2-ref-link" href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noopener"><div className="v2-ref-link-title">ECB Exchange Rates</div><div className="v2-ref-link-desc">Official ECB reference rates — updated daily</div><div className="v2-ref-link-url">ecb.europa.eu</div></a>
                </div>
                <div className="v2-sec-h" style={{marginBottom:10}}>Luxembourg</div>
                <div className="v2-ref-grid" style={{marginBottom:20}}>
                  <a className="v2-ref-link" href="https://douanes.public.lu" target="_blank" rel="noopener"><div className="v2-ref-link-title">ADA Luxembourg</div><div className="v2-ref-link-desc">Administration des douanes et accises — excise rates, procedures</div><div className="v2-ref-link-url">douanes.public.lu</div></a>
                  <a className="v2-ref-link" href="https://aed.public.lu" target="_blank" rel="noopener"><div className="v2-ref-link-title">AED — TVA</div><div className="v2-ref-link-desc">Luxembourg VAT rules and registrations</div><div className="v2-ref-link-url">aed.public.lu</div></a>
                  <a className="v2-ref-link" href="https://tarlux.public.lu/" target="_blank" rel="noopener"><div className="v2-ref-link-title">TARLUX — Simulation</div><div className="v2-ref-link-desc">ADA Luxembourg — official duty simulation tool</div><div className="v2-ref-link-url">tarlux.public.lu</div></a>
                  <a className="v2-ref-link" href="https://guichet.public.lu/fr/entreprises/finances-fiscalite/douane-accises.html" target="_blank" rel="noopener"><div className="v2-ref-link-title">Guichet.lu — Customs</div><div className="v2-ref-link-desc">Business guide to import/export procedures in Luxembourg</div><div className="v2-ref-link-url">guichet.public.lu</div></a>
                </div>
                <div className="v2-sec-h" style={{marginBottom:10}}>Luxembourg VAT Rates</div>
                <table className="v2-tbl" style={{marginBottom:20}}>
                  <thead><tr><th>Rate</th><th>%</th><th>Applies to</th></tr></thead>
                  <tbody>
                    <tr><td className="v2-bold">Standard</td><td className="v2-mono">17%</td><td>Most goods &amp; services</td></tr>
                    <tr><td className="v2-bold">Intermediate</td><td className="v2-mono">14%</td><td>Wines, advertising, some fuel</td></tr>
                    <tr><td className="v2-bold">Reduced</td><td className="v2-mono">8%</td><td>Gas, electricity, tourism</td></tr>
                    <tr><td className="v2-bold">Super-reduced</td><td className="v2-mono">3%</td><td>Food, books, medicine, children&apos;s goods</td></tr>
                  </tbody>
                </table>
                <div className="v2-sec-h" style={{marginBottom:10}}>What&apos;s changing</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <div className="v2-pill v2-pill-red">🚨 <strong>1 Jul 2026</strong> — €150 e-commerce duty-free threshold removed. New €3 flat duty per item until 2028, then full TARIC rates.</div>
                  <div className="v2-pill v2-pill-amber">⚠️ <strong>Jan 2026</strong> — CBAM full financial obligations begin. Certificates surrendered quarterly at EU ETS price.</div>
                  <div className="v2-pill v2-pill-blue">🔄 <strong>2028</strong> — New EU Customs Authority and Data Hub replace current fragmented national systems.</div>
                  <div className="v2-pill v2-pill-green">✓ <strong>2024–2026</strong> — New FTAs in force: EU-NZ (2024), EU-Chile updated, EU-Australia pending.</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
