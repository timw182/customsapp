"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";

// Luxembourg VAT rates (Loi TVA, 2026)
// Maps HS chapter to applicable VAT rate
const LU_VAT_RATES_3 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 36, 49];
const LU_VAT_RATES_8 = [27, 90];
// Note: chapter 22 wines have special rules (still wine 14%, >13° ABV 17%)
// chapter 30 pharma = 3%, chapter 61-64 children items = 3% (needs user input for size)

function getLuVAT(hsCode) {
  if (!hsCode) return 0.17;
  const chapter = parseInt(String(hsCode).replace(/\D/g, "").substring(0, 2), 10);
  if (LU_VAT_RATES_3.includes(chapter)) return 0.03;
  if (LU_VAT_RATES_8.includes(chapter)) return 0.08;
  if (chapter === 30) return 0.03; // pharma
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
    vatRate: 0.17,
    inputs: ["volume"],
    calc(inp, R) {
      return { duty: (inp.volume / 100) * R["still-wine"], note: "EU 0-rate — no excise duty in LU" };
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
// Phase-in factor = 1 − share of free EU ETS allowances still in circulation
const CBAM_FACTOR = {
  2026: 0.0,
  2027: 0.05,
  2028: 0.1,
  2029: 0.225,
  2030: 0.485,
  2031: 0.73,
  2032: 0.865,
  2033: 0.98,
  2034: 1.0,
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
        // Use preferential rate for the specific country if TARIC returned one,
        // otherwise fall back to MFN rate
        const prefMeasure = parsed.preferential?.find(m => m.dutyRate != null);
        const prefRate = prefMeasure ? parseFloat(prefMeasure.dutyRate) : null;
        const appliedRate = (hasPref && prefRate != null) ? prefRate : (parsed.mfnRate ?? "");
        setDutyRate(String(appliedRate));
        setDutyRateSource({
          taricLive: true,
          aiGenerated: false,
          description: parsed.description,
          referenceDate: parsed.referenceDate,
          antiDumping: parsed.antiDumping,
          mfnRate: parsed.mfnRate,
          prefRate: prefRate,
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

    const dutyFree = cifEUR <= 150;
    let effectiveDutyRate = duty / 100;
    if (hasPref && hasProofOfOrigin) {
      if (dutyRateSource?.usingPref) {
        // TARIC already returned the actual preferential rate — use as-is, no further reduction
        effectiveDutyRate = duty / 100;
      } else {
        // Fallback: rough reduction by agreement type
        const prefType = ORIGIN_AGREEMENTS[originCountry]?.type || "";
        if (["eba", "fta", "eea", "cu", "atp", "epa", "cta"].includes(prefType)) {
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

    // Anti-dumping duty (on top of customs duty, same base)
    const addRate = parseFloat(antiDumpingRate) || 0;
    const antiDumpingDuty = dutyFree ? 0 : cifEUR * (addRate / 100);

    // VAT rate based on HS code (Luxembourg Loi TVA)
    const vatRate = getLuVAT(hsCode);
    // VAT base includes customs duty + ADD (excise handled separately)
    // VAT base includes customs duty, ADD, and excise duty (Loi TVA art. 42)
    const exciseDutyAmt = exciseResult ? exciseResult.duty || 0 : 0;
    const vatBase = cifEUR + customsDuty + antiDumpingDuty + exciseDutyAmt;
    const importVAT = vatBase * vatRate;
    const total = cifEUR + customsDuty + antiDumpingDuty + importVAT;
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
      vatBase,
      vatRate,
      valEUR,
      frEUR,
      insEUR,
      airfreightPct: transportMode === "air" ? getAirfreightPct(originCountry) * 100 : null,
      prefType: hasPref && hasProofOfOrigin ? ORIGIN_AGREEMENTS[originCountry]?.type || "fta" : null,
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
    const { duty, note } = schema.calc(inp, exciseRates);
    const cifVal = parseFloat(exciseCifValue) || 0;
    const vatBase = cifVal + (duty || 0);
    const vatAmt = vatBase * schema.vatRate;
    setExciseResult({
      duty: duty || 0,
      note: note || "",
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
        background: "#f0f7f4",
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
            Luxembourg · Import Calculator
          </div>
          {rateDate && currency !== "EUR" && (
            <div
              style={{
                fontSize: 10,
                color: "#10b98188",
                fontFamily: "var(--font-courier-prime), monospace",
                marginTop: 4,
              }}
            >
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
            {t === "calculator"
              ? "Calculator"
              : t === "excise"
                ? "Excise"
                : t === "cbam"
                  ? "CBAM"
                  : t === "hs-lookup"
                    ? "HS Lookup"
                    : t === "fx"
                      ? "FX Rates"
                      : "Reference"}
          </button>
        ))}
      </div>

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

            const S = {
              card: { background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 20 },
              sectionHead: { fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#9ca3af", marginBottom: 14, fontFamily: "var(--font-oswald), sans-serif" },
              label: { display: "block", fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#9ca3af", marginBottom: 5, marginTop: 14 },
              hint: { fontSize: 10, color: "#9ca3af", marginTop: 4, fontFamily: "var(--font-courier-prime), monospace", lineHeight: 1.5 },
            };

            return (
              <div style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

                {/* ──── LEFT: INPUTS ──── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* Card 1: HS Code */}
                  <div style={S.card}>
                    <div style={S.sectionHead}>Goods</div>
                    <label style={{ ...S.label, marginTop: 0 }}>Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Samsung Galaxy S24 smartphone"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <label style={S.label}>HS / CN Code</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        placeholder="e.g. 8471.30"
                        value={hsCode}
                        onChange={(e) => {
                          const val = e.target.value;
                          setHsCode(val);
                          setDutyRateSource(null);
                          if (val.replace(/\D/g, "").length === 8) firePlaneAnimation();
                        }}
                        onBlur={(e) => {
                          if (e.target.value.replace(/\D/g, "").length >= 6) lookupDutyRate(e.target.value);
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        onClick={() => lookupDutyRate(hsCode)}
                        disabled={dutyRateLoading || hsCode.replace(/\D/g, "").length < 6}
                        className="btn-ghost"
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 10, borderRadius: 4, background: "none", whiteSpace: "nowrap" }}
                      >
                        {dutyRateLoading ? <Spinner /> : "get rate"}
                      </button>
                      <button
                        onClick={() => setTab("hs-lookup")}
                        className="btn-ghost"
                        style={{ padding: "8px 10px", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 10, borderRadius: 4, background: "none", whiteSpace: "nowrap" }}
                      >
                        find ↗
                      </button>
                    </div>
                    {taricData && showChapterPopup && (
                      <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 6, fontSize: 11, color: "#1e40af" }}>
                        <strong>Ch. {taricData.chapter}</strong> · {taricData.description}
                      </div>
                    )}
                    {(isExcisable || isCbam) && (
                      <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                        {isExcisable && (
                          <button
                            onClick={() => setTab("excise")}
                            style={{ fontSize: 9, background: "rgba(245,158,11,0.1)", color: "#d97706", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", letterSpacing: 1, fontWeight: 700 }}
                          >
                            EXCISE ↗
                          </button>
                        )}
                        {isCbam && (
                          <button
                            onClick={() => setTab("cbam")}
                            style={{ fontSize: 9, background: "rgba(59,130,246,0.1)", color: "#2563eb", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", letterSpacing: 1, fontWeight: 700 }}
                          >
                            CBAM ↗
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card 2: Origin & Value */}
                  <div style={S.card}>
                    <div style={S.sectionHead}>Origin & Value</div>

                    <label style={S.label}>Country of Origin</label>
                    <select
                      value={originCountry}
                      onChange={(e) => { setOriginCountry(e.target.value); setHasProofOfOrigin(false); }}
                    >
                      {Object.entries(ORIGIN_AGREEMENTS)
                        .sort((a, b) => a[1].name.localeCompare(b[1].name))
                        .map(([code, info]) => (
                          <option key={code} value={code}>{info.name} ({code})</option>
                        ))}
                      <option value="OTHER">Other</option>
                    </select>

                    {isSanctioned ? (
                      <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 10px", marginTop: 8 }}>
                        <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 11 }}>⚠️ SANCTIONED</span>
                        <div style={{ color: "#dc2626", fontSize: 10, marginTop: 2 }}>{originInfo.note}</div>
                      </div>
                    ) : originInfo ? (
                      <div style={S.hint}>{originInfo.note}</div>
                    ) : null}

                    {hasPref && (
                      <>
                        <label style={S.label}>Proof of Origin</label>
                        <select
                          value={hasProofOfOrigin ? "yes" : "none"}
                          onChange={(e) => setHasProofOfOrigin(e.target.value !== "none")}
                        >
                          <option value="none">None — MFN rate applies</option>
                          <option value="yes">EUR.1 / Invoice declaration / REX</option>
                        </select>
                        {hasProofOfOrigin && (
                          <div style={{ ...S.hint, color: "#059669" }}>✓ Preferential rate will apply</div>
                        )}
                      </>
                    )}

                    <label style={S.label}>Goods Value</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 8 }}>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={itemValue}
                        onChange={(e) => setItemValue(e.target.value)}
                      />
                      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    {currency !== "EUR" && (
                      <div style={S.hint}>
                        {rateLoading ? "Loading ECB rate..." : `× ${exchangeRate?.toFixed(4)} = €${itemValue && exchangeRate ? (parseFloat(itemValue) * exchangeRate).toFixed(2) : "—"}`}
                      </div>
                    )}
                  </div>

                  {/* Card 3: Logistics */}
                  <div style={S.card}>
                    <div style={S.sectionHead}>Logistics</div>

                    <label style={S.label}>Incoterm 2020</label>
                    <select value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
                      {Object.entries(INCOTERMS_CIF).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <div style={S.hint}>{INCOTERMS_CIF[incoterm]?.note}</div>

                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 6 }}>
                      <span style={{ fontSize: 16 }}>✈</span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#059669" }}>Air Freight</div>
                        {INCOTERMS_CIF[incoterm]?.needsFreight && (
                          <div style={{ fontSize: 10, color: "#9ca3af" }}>{getAirfreightPct(originCountry) * 100}% of cost included in customs value · EU Reg. 2015/2447</div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                      <div>
                        <label style={{ ...S.label, marginTop: 0 }}>
                          Freight ({currency})
                          {!INCOTERMS_CIF[incoterm]?.needsFreight && (
                            <span style={{ color: "#10b981", marginLeft: 4 }}>✓ incl.</span>
                          )}
                        </label>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={freight}
                          onChange={(e) => setFreight(e.target.value)}
                          style={{ opacity: INCOTERMS_CIF[incoterm]?.needsFreight ? 1 : 0.5 }}
                        />
                        {INCOTERMS_CIF[incoterm]?.needsFreight && (
                          <div style={S.hint}>{getAirfreightPct(originCountry) * 100}% → customs value (air zone)</div>
                        )}
                      </div>
                      <div>
                        <label style={{ ...S.label, marginTop: 0 }}>
                          Insurance ({currency})
                          {!INCOTERMS_CIF[incoterm]?.needsIns && (
                            <span style={{ color: "#10b981", marginLeft: 4 }}>✓ incl.</span>
                          )}
                        </label>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={insurance}
                          onChange={(e) => setInsurance(e.target.value)}
                          style={{ opacity: INCOTERMS_CIF[incoterm]?.needsIns ? 1 : 0.5 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Duty Rates */}
                  <div style={S.card}>
                    <div style={S.sectionHead}>Duty Rates</div>
                    <div style={{ display: "grid", gridTemplateColumns: dutyRateSource?.taricLive ? "1fr 1fr" : "1fr", gap: 12 }}>
                      <div>
                        <label style={S.label}>Customs Duty Rate (%)</label>
                        <input
                          type="number"
                          placeholder="e.g. 3.5"
                          value={dutyRate}
                          onChange={(e) => { setDutyRate(e.target.value); setDutyRateSource((s) => s ? { ...s, aiGenerated: false } : null); }}
                          step="0.1"
                          style={{ borderColor: dutyRateSource?.aiGenerated ? "rgba(16,185,129,0.4)" : undefined }}
                        />
                        {dutyRateSource?.taricLive && !dutyRateSource?.error && (
                          <div style={{ ...S.hint, color: "#3b82f6" }}>
                            ✓ Live TARIC · {dutyRateSource.referenceDate}
                            {dutyRateSource.usingPref && (
                              <span style={{ color: "#059669", marginLeft: 6 }}>✓ preferential rate ({originCountry})</span>
                            )}
                            {!dutyRateSource.usingPref && dutyRateSource.prefRate != null && (
                              <span style={{ color: "#9ca3af", marginLeft: 6 }}>MFN · pref. {dutyRateSource.prefRate}% with proof of origin</span>
                            )}
                            {dutyRateSource.mfnRate != null && dutyRateSource.usingPref && (
                              <span style={{ color: "#9ca3af", marginLeft: 6 }}>· MFN {dutyRateSource.mfnRate}%</span>
                            )}
                            {dutyRateSource.antiDumping && <span style={{ color: "#f97316", marginLeft: 6 }}>⚠ ADD may apply</span>}
                          </div>
                        )}
                        {dutyRateSource?.aiGenerated && !dutyRateSource?.error && (
                          <div style={S.hint}>
                            ⚠ AI estimate ·{" "}
                            <a href={"https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=" + hsCode.replace(/[^0-9]/g, "")} target="_blank" rel="noopener" style={{ color: "var(--gold)" }}>verify TARIC ↗</a>
                          </div>
                        )}
                        {dutyRateSource?.error && <div style={{ ...S.hint, color: "#dc2626" }}>Lookup failed — enter manually</div>}
                        {!dutyRateSource && !dutyRateLoading && (
                          <div style={S.hint}>Auto from HS · <a href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp" target="_blank" rel="noopener" style={{ color: "var(--gold)" }}>TARIC ↗</a></div>
                        )}
                      </div>
                      {dutyRateSource?.taricLive && !dutyRateSource?.error && (
                        <div>
                          <label style={S.label}>Anti-Dumping Duty (%)</label>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={antiDumpingRate}
                            onChange={(e) => setAntiDumpingRate(e.target.value)}
                            step="0.1"
                            min="0"
                          />
                          {!antiDumpingRate && <div style={S.hint}>0 if no ADD order</div>}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={calculate}
                    className="btn-gold"
                    style={{ padding: "16px", fontSize: 13, letterSpacing: 3, textTransform: "uppercase", fontWeight: 700, borderRadius: 8, fontFamily: "var(--font-oswald), sans-serif", width: "100%" }}
                  >
                    Calculate
                  </button>
                  {result && (
                    <button
                      onClick={downloadPDF}
                      className="btn-ghost"
                      style={{ width: "100%", padding: "12px", border: "1px solid var(--border)", color: "var(--gold)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", borderRadius: 8, background: "none", fontFamily: "var(--font-oswald), sans-serif" }}
                    >
                      ↓ Export PDF
                    </button>
                  )}
                </div>

                {/* ──── RIGHT: RESULT ──── */}
                <div ref={resultRef} style={{ position: "sticky", top: 16 }}>
                  {!result ? (
                    <div style={S.card}>
                      <div style={S.sectionHead}>Result</div>
                      <div style={{ color: "#c4cdd6", fontSize: 40, textAlign: "center", padding: "16px 0", fontFamily: "var(--font-oswald), sans-serif", letterSpacing: 2 }}>€ —</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        {[
                          ["🏷", "HS code → TARIC duty rate"],
                          ["💱", "FX conversion (ECB rates)"],
                          ["📦", "Incoterm → CIF customs value"],
                          ["✈", "Air freight zone adjustment"],
                          ["🤝", "FTA / GSP preferential rates"],
                          ["🏛", "Luxembourg import VAT"],
                        ].map(([icon, text]) => (
                          <div key={text} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#9ca3af", fontFamily: "var(--font-courier-prime), monospace" }}>
                            <span>{icon}</span><span>{text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeIn 0.3s ease" }}>
                      {/* Headline */}
                      <div style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(52,211,153,0.05))", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, padding: 24 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#059669", marginBottom: 4, fontFamily: "var(--font-oswald), sans-serif" }}>
                          {result.dutyFree ? "Duty-Free Import (≤€150)" : "Duties & Taxes"}
                        </div>
                        <div style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 44, color: "var(--foreground)", fontWeight: 700, lineHeight: 1, letterSpacing: -1 }}>
                          €{fmt(totalDuties)}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                          Landed cost: <strong style={{ color: "var(--foreground)" }}>€{fmt(result.total)}</strong>
                          {" · "}
                          {((totalDuties / (result.valEUR || 1)) * 100).toFixed(1)}% on goods value
                        </div>
                        {hasPref && hasProofOfOrigin && (
                          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(5,150,105,0.1)", borderRadius: 20, padding: "4px 10px", fontSize: 10, color: "#059669", fontWeight: 600 }}>
                            ✓ {result.prefType === "gsp" ? "GSP reduced" : result.prefType === "gsp+" ? "GSP+ reduced" : "0% preferential"} applied
                          </div>
                        )}
                      </div>

                      {/* Ledger */}
                      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                        {[
                          { label: "Goods value", value: result.valEUR, sub: currency !== "EUR" ? `${itemValue} ${currency}` : null },
                          ...(result.frEUR > 0 ? [{ label: `Freight (${result.airfreightPct ?? 100}% air adj.)`, value: result.frEUR }] : []),
                          ...(result.insEUR > 0 ? [{ label: "Insurance", value: result.insEUR }] : []),
                          { label: "Customs Value (CIF)", value: result.cifEUR, divider: true, bold: true },
                          { label: `Customs Duty ${result.dutyFree ? "(waived)" : result.effectiveDutyRate.toFixed(1) + "%"}`, value: result.customsDuty, accent: "#6366f1" },
                          ...(result.antiDumpingDuty > 0 ? [{ label: `Anti-Dumping Duty ${result.addRate.toFixed(1)}%`, value: result.antiDumpingDuty, accent: "#dc2626" }] : []),
                          ...(result.exciseDutyAmt > 0 ? [{ label: "Excise Duty", value: result.exciseDutyAmt, accent: "#d97706" }] : []),
                          { label: `Import VAT ${((result.vatRate || 0.17) * 100).toFixed(0)}%`, value: result.importVAT, accent: "#0891b2" },
                          { label: "Total Duties & Taxes", value: totalDuties, divider: true, bold: true, total: true },
                        ].map(({ label, value, sub, divider, bold, total, accent }, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "baseline",
                              padding: "10px 20px",
                              borderTop: divider ? "2px solid var(--border)" : i > 0 ? "1px solid rgba(0,0,0,0.04)" : "none",
                              background: total ? "rgba(16,185,129,0.04)" : "transparent",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: bold ? 12 : 11, fontWeight: bold ? 700 : 400, color: accent || (bold ? "var(--foreground)" : "#6b7280") }}>
                                {label}
                              </div>
                              {sub && <div style={{ fontSize: 10, color: "#9ca3af" }}>{sub}</div>}
                            </div>
                            <div style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: bold ? 14 : 12, fontWeight: bold ? 700 : 400, color: total ? "var(--gold)" : (accent || "var(--foreground)") }}>
                              €{fmt(value)}
                            </div>
                          </div>
                        ))}

                        {/* Proportion bar */}
                        {result.cifEUR > 0 && (
                          <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", background: "#fafafa" }}>
                            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "#9ca3af", marginBottom: 6 }}>Composition</div>
                            <div style={{ height: 8, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                              {(() => {
                                const segments = [
                                  { val: result.valEUR, color: "#e2e8f0" },
                                  { val: result.customsDuty, color: "#6366f1" },
                                  { val: result.antiDumpingDuty || 0, color: "#dc2626" },
                                  { val: result.exciseDutyAmt || 0, color: "#d97706" },
                                  { val: result.importVAT, color: "#10b981" },
                                ].filter(s => s.val > 0);
                                const total_val = segments.reduce((a, s) => a + s.val, 0);
                                return segments.map((s, i) => (
                                  <div key={i} style={{ flex: s.val / total_val, background: s.color }} />
                                ));
                              })()}
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                              {[
                                { label: "Goods", color: "#e2e8f0", textColor: "#9ca3af" },
                                { label: "Duty", color: "#6366f1", textColor: "#6366f1" },
                                ...(result.antiDumpingDuty > 0 ? [{ label: "ADD", color: "#dc2626", textColor: "#dc2626" }] : []),
                                ...(result.exciseDutyAmt > 0 ? [{ label: "Excise", color: "#d97706", textColor: "#d97706" }] : []),
                                { label: "VAT", color: "#10b981", textColor: "#10b981" },
                              ].map(({ label, color, textColor }) => (
                                <div key={label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                                  <span style={{ color: textColor }}>{label}</span>
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
                    <div style={{ marginTop: 10, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>🥃</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#d97706" }}>Excise Duty Required</div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>This HS chapter is excisable (alcohol / tobacco / fuel).</div>
                      </div>
                      <button onClick={() => setTab("excise")} style={{ fontSize: 10, color: "#d97706", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                        Excise →
                      </button>
                    </div>
                  )}
                  {isCbam && (
                    <div style={{ marginTop: 10, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 18 }}>🌍</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#2563eb" }}>CBAM Applies</div>
                        <div style={{ fontSize: 10, color: "#9ca3af" }}>Carbon Border Adjustment Mechanism applies.</div>
                      </div>
                      <button onClick={() => setTab("cbam")} style={{ fontSize: 10, color: "#2563eb", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                        CBAM →
                      </button>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "#f9fafb", border: "1px solid var(--border)", borderRadius: 6, fontSize: 10, color: "#9ca3af", lineHeight: 1.6 }}>
                    ⚠ Estimate only. Verify at{" "}
                    <a href="https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp" target="_blank" rel="noopener" style={{ color: "var(--gold)" }}>TARIC ↗</a>.
                  </div>
                </div>
              </div>
            );
          })()}
        {/* EXCISE TAB */}
        {tab === "excise" && (
          <div className="two-col">
            <div>
              <div className="section-label">Excise Duty Calculator — Luxembourg</div>
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

            {/* Result panel */}
            <div>
              <div className="section-label">Result</div>
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
        )}

        {/* CBAM TAB */}
        {tab === "cbam" &&
          (() => {
            const lbl = {
              fontSize: 11,
              color: "#6b7280",
              letterSpacing: 2,
              textTransform: "uppercase",
              display: "block",
              marginBottom: 6,
            };
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
                    {/* Sector */}
                    <div>
                      <label style={lbl}>Product Sector</label>
                      <select
                        value={cbamSector}
                        onChange={(e) => {
                          const s = CBAM_SECTORS[e.target.value];
                          setCbamSector(e.target.value);
                          setCbamRoute(s?.routes?.[0]?.value || "");
                          setCbamResult(null);
                        }}
                      >
                        {Object.entries(CBAM_SECTORS).map(([k, s]) => (
                          <option key={k} value={k}>
                            {s.label} · {s.cnCodes}
                          </option>
                        ))}
                      </select>
                      {sector?.indirectIncluded && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 4,
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          Indirect emissions (electricity) included in default factors.
                        </div>
                      )}
                    </div>

                    {/* Country */}
                    <div>
                      <label style={lbl}>Country of Origin</label>
                      <select value={cbamCountry} onChange={(e) => setCbamCountry(e.target.value)}>
                        {CBAM_COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Import Year */}
                    <div>
                      <label style={lbl}>Import Year</label>
                      <select value={cbamYear} onChange={(e) => setCbamYear(parseInt(e.target.value))}>
                        {Object.entries(CBAM_FACTOR).map(([y, f]) => (
                          <option key={y} value={y}>
                            {y} — {(f * 100).toFixed(1)}% CBAM factor
                          </option>
                        ))}
                      </select>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          marginTop: 4,
                          fontFamily: "var(--font-courier-prime), monospace",
                        }}
                      >
                        Factor = % of embedded emissions requiring certificate coverage.
                      </div>
                    </div>

                    {/* Quantity */}
                    <div>
                      <label style={lbl}>Import Quantity ({sector?.unit || "tonne"})</label>
                      <input
                        type="number"
                        placeholder="e.g. 500"
                        min="0"
                        step="0.1"
                        value={cbamTonnes}
                        onChange={(e) => setCbamTonnes(e.target.value)}
                      />
                      {showDeMinimisHint && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#2e6e2e",
                            marginTop: 4,
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          ✓ Below 50 {sector?.unit} de minimis — CBAM obligation likely waived. Confirm with declarant.
                        </div>
                      )}
                    </div>

                    {/* Production route */}
                    {sector?.routes && (
                      <div>
                        <label style={lbl}>Production Route</label>
                        <select value={cbamRoute} onChange={(e) => setCbamRoute(e.target.value)}>
                          {sector.routes.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
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
                      {cbamMode === "default" && previewFactor != null && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 6,
                            fontFamily: "var(--font-courier-prime), monospace",
                            lineHeight: 1.6,
                          }}
                        >
                          Base factor: {(base ?? 0).toFixed(3)} × {markup} markup = {previewFactor.toFixed(3)} tCO₂e/
                          {sector?.unit || "t"}
                        </div>
                      )}
                    </div>

                    {cbamMode === "actual" && (
                      <div>
                        <label style={lbl}>Actual Embedded Emissions (tCO₂e per {sector?.unit || "tonne"})</label>
                        <input
                          type="number"
                          placeholder="e.g. 1.85"
                          min="0"
                          step="0.001"
                          value={cbamActualEmissions}
                          onChange={(e) => setCbamActualEmissions(e.target.value)}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 4,
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          Must be verified by an EU-accredited independent verifier.
                        </div>
                      </div>
                    )}

                    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, display: "grid", gap: 16 }}>
                      {/* ETS price */}
                      <div>
                        <label style={lbl}>EU ETS Carbon Price (€/tCO₂)</label>
                        <input
                          type="number"
                          placeholder="e.g. 70"
                          min="0"
                          step="0.5"
                          value={cbamEtsPrice}
                          onChange={(e) => setCbamEtsPrice(e.target.value)}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 4,
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          Quarterly average ETS price applies. Check{" "}
                          <a
                            href="https://www.eex.com/en/market-data/environmental-markets"
                            target="_blank"
                            rel="noopener"
                            style={{ color: "#10b981" }}
                          >
                            EEX ↗
                          </a>{" "}
                          for current prices.
                        </div>
                      </div>

                      {/* Carbon price already paid */}
                      <div>
                        <label style={lbl}>Carbon Price Already Paid Abroad (€) — optional</label>
                        <input
                          type="number"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          value={cbamCarbonPaid}
                          onChange={(e) => setCbamCarbonPaid(e.target.value)}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            color: "#6b7280",
                            marginTop: 4,
                            fontFamily: "var(--font-courier-prime), monospace",
                          }}
                        >
                          Effective carbon price paid in origin country. Deducted from CBAM cost.
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={calculateCBAM}
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
                      Calculate CBAM
                    </button>
                  </div>

                  {/* Key dates reference */}
                  <div
                    style={{
                      marginTop: 16,
                      background: "#f0f7f4",
                      border: "1px solid #e2e8f0",
                      borderRadius: 2,
                      padding: 16,
                    }}
                  >
                    <div className="section-label" style={{ marginTop: 0, marginBottom: 10 }}>
                      Key Dates & Thresholds
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#6b7280",
                        lineHeight: 2,
                        fontFamily: "var(--font-courier-prime), monospace",
                      }}
                    >
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
                    <div
                      style={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 2,
                        padding: "44px 24px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 32, marginBottom: 14, opacity: 0.2, lineHeight: 1 }}>CO₂</div>
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
                        Carbon Border Adjustment
                      </div>
                      <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>
                        Select sector, origin country, and quantity,
                        <br />
                        then click{" "}
                        <strong
                          style={{
                            fontFamily: "var(--font-oswald), sans-serif",
                            color: "var(--muted)",
                            letterSpacing: 1,
                          }}
                        >
                          Calculate CBAM
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <div style={{ animation: "fadeIn 0.3s ease" }}>
                      {cbamResult.deMinimis && (
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
                          ✓ {cbamResult.tonnes.toFixed(1)} {cbamResult.unit} is below the 50-{cbamResult.unit} de
                          minimis threshold. No CBAM obligation likely applies — verify with your authorised declarant.
                        </div>
                      )}

                      <div
                        style={{
                          background: "#fff",
                          border: "1px solid #e2e8f0",
                          borderRadius: 2,
                          padding: 20,
                          boxShadow: "0 2px 12px rgba(0,0,0,0.05)",
                        }}
                      >
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
                          {cbamResult.sectorLabel}
                        </div>

                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>Import quantity</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            {cbamResult.tonnes.toFixed(2)} {cbamResult.unit}
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>Total embedded emissions</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            {cbamResult.totalEmbedded.toFixed(3)} tCO₂e
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>
                            CBAM factor ({cbamResult.year})
                            <span
                              style={{
                                fontSize: 11,
                                marginLeft: 8,
                                fontFamily: "var(--font-courier-prime), monospace",
                                color: "#6b7280",
                              }}
                            >
                              {(cbamResult.factor * 100).toFixed(1)}% phase-in
                            </span>
                          </span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            ×{cbamResult.factor}
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>Covered emissions</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            {cbamResult.coveredEmissions.toFixed(4)} tCO₂e
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>EU ETS price</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            €{cbamResult.etsPrice}/tCO₂
                          </span>
                        </div>
                        <div className="result-row">
                          <span style={{ color: "#6b7280", fontSize: 13 }}>Gross CBAM cost</span>
                          <span style={{ fontFamily: "var(--font-courier-prime), monospace", fontSize: 13 }}>
                            € {fmt(cbamResult.grossCost)}
                          </span>
                        </div>
                        {cbamResult.carbonPaid > 0 && (
                          <div className="result-row">
                            <span style={{ color: "#6b7280", fontSize: 13 }}>− Carbon price paid abroad</span>
                            <span
                              style={{
                                fontFamily: "var(--font-courier-prime), monospace",
                                fontSize: 13,
                                color: "#2e6e2e",
                              }}
                            >
                              − € {fmt(cbamResult.carbonPaid)}
                            </span>
                          </div>
                        )}

                        {/* Net CBAM cost total box */}
                        <div
                          style={{
                            marginTop: 8,
                            background: "linear-gradient(135deg, rgba(52,211,153,0.18), rgba(16,185,129,0.08))",
                            border: "1px solid rgba(16,185,129,0.3)",
                            borderRadius: 2,
                            padding: "18px 20px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 6,
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
                              Net CBAM Cost
                            </div>
                            <div
                              style={{
                                fontFamily: "var(--font-courier-prime), monospace",
                                fontSize: 28,
                                color: "var(--gold)",
                                fontWeight: 700,
                              }}
                            >
                              € {fmt(cbamResult.netCost)}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6b7280",
                              fontFamily: "var(--font-courier-prime), monospace",
                            }}
                          >
                            € {cbamResult.perUnitCost.toFixed(2)} per {cbamResult.unit} · {cbamResult.tonnes.toFixed(1)}{" "}
                            {cbamResult.unit} imported
                          </div>
                        </div>

                        {/* Benchmark comparison */}
                        {cbamResult.benchmarkEmissions != null && cbamResult.defaultPerTonne != null && (
                          <div
                            style={{
                              marginTop: 16,
                              padding: "12px 16px",
                              background: "#f0f7f4",
                              border: "1px solid #e2e8f0",
                              borderRadius: 2,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                letterSpacing: 3,
                                textTransform: "uppercase",
                                fontFamily: "var(--font-oswald), sans-serif",
                                color: "var(--muted)",
                                marginBottom: 8,
                              }}
                            >
                              vs EU ETS Benchmark
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#6b7280",
                                fontFamily: "var(--font-courier-prime), monospace",
                                lineHeight: 1.9,
                              }}
                            >
                              <div>Imported product: {cbamResult.defaultPerTonne.toFixed(3)} tCO₂e/t</div>
                              <div>EU benchmark: {cbamResult.benchmarkEmissions.toFixed(3)} tCO₂e/t</div>
                              <div
                                style={{
                                  color:
                                    cbamResult.defaultPerTonne > cbamResult.benchmarkEmissions ? "#dc2626" : "#2e6e2e",
                                  marginTop: 2,
                                }}
                              >
                                {cbamResult.defaultPerTonne > cbamResult.benchmarkEmissions
                                  ? `⚠ ${((cbamResult.defaultPerTonne / cbamResult.benchmarkEmissions - 1) * 100).toFixed(0)}% above EU best-in-class`
                                  : `✓ Within EU benchmark range`}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Emissions source note */}
                        <div
                          style={{
                            marginTop: 12,
                            fontSize: 11,
                            color: "#6b7280",
                            fontFamily: "var(--font-courier-prime), monospace",
                            lineHeight: 1.5,
                          }}
                        >
                          {cbamResult.emissionsSource}
                        </div>

                        {/* Compliance checklist */}
                        <div style={{ marginTop: 16, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
                          <div
                            style={{
                              fontSize: 10,
                              letterSpacing: 3,
                              textTransform: "uppercase",
                              fontFamily: "var(--font-oswald), sans-serif",
                              color: "var(--muted)",
                              marginBottom: 10,
                            }}
                          >
                            Compliance Checklist
                          </div>
                          {[
                            "Register as authorised CBAM declarant in the CBAM Registry",
                            "Obtain embedded emissions report from supplier (or use defaults)",
                            "Have actual emissions verified by an EU-accredited verifier",
                            "Purchase CBAM certificates via national authority (ADA Luxembourg)",
                            "Submit annual CBAM declaration by 31 May for prior year",
                            "Surrender certificates by 30 September each year",
                            cbamResult.deMinimis
                              ? "✓ De minimis: below 50t — obligation likely waived"
                              : "Monitor annual import volume — 50t de minimis applies per CN code",
                          ].map((item, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize: 12,
                                color: "#6b7280",
                                lineHeight: 1.9,
                                paddingLeft: 14,
                                position: "relative",
                              }}
                            >
                              <span style={{ position: "absolute", left: 0, color: "#10b981" }}>·</span>
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          fontSize: 11,
                          color: "#6b7280",
                          fontFamily: "var(--font-courier-prime), monospace",
                          lineHeight: 1.6,
                        }}
                      >
                        Estimate based on EU Reg. 2023/956 and Implementing Reg. 2025/2621. Default emission factors
                        subject to mandatory +{((CBAM_MARKUP(cbamResult.year, false) - 1) * 100).toFixed(0)}% markup in{" "}
                        {cbamResult.year}. CBAM certificates not purchasable until Feb 2027. First surrender: 30 Sep
                        2027. Always consult an authorised CBAM declarant before filing.
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
            <div
              style={{
                background: "#fff",
                borderRadius: 12,
                boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                padding: 24,
                marginBottom: 16,
              }}
            >
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
                {hsLoading ? (
                  <>
                    <Spinner /> Classifying...
                  </>
                ) : (
                  "Classify Product"
                )}
              </button>
            </div>

            {/* SENSITIVE GOODS WARNING */}
            {hsResult && hsResult.sensitiveGoods && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  overflow: "hidden",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    background: "#dc2626",
                    color: "white",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
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
                      <li style={{ padding: "4px 0", display: "flex", gap: 8 }}>
                        📋 Authority: {hsResult.sensitiveGoods.licenceAuthority}
                      </li>
                    )}
                    {hsResult.sensitiveGoods.regulations &&
                      hsResult.sensitiveGoods.regulations.map((r, i) => (
                        <li key={i} style={{ padding: "4px 0", display: "flex", gap: 8 }}>
                          📜 {r}
                        </li>
                      ))}
                    {hsResult.sensitiveGoods.consequences && (
                      <li style={{ padding: "4px 0", display: "flex", gap: 8 }}>
                        ⚡ {hsResult.sensitiveGoods.consequences}
                      </li>
                    )}
                  </ul>
                </div>
                <div style={{ padding: "16px 20px", background: "#fef2f2", borderTop: "1px solid #fecaca" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, cursor: "pointer" }}>
                    <input type="checkbox" style={{ width: 18, height: 18 }} />I understand and will verify licence
                    requirements
                  </label>
                </div>
              </div>
            )}

            {/* NEEDS MORE INFO */}
            {hsResult && hsResult.needsMoreInfo && (
              <div
                style={{
                  background: "#fff",
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  overflow: "hidden",
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    background: "#d97706",
                    color: "white",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 24 }}>🤔</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>More Details Needed</div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{hsResult.reason}</div>
                  </div>
                </div>
                <div style={{ padding: 20 }}>
                  <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>Please specify:</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
                    {hsResult.questions &&
                      hsResult.questions.map((q, i) => (
                        <li
                          key={i}
                          style={{
                            padding: "10px 14px",
                            background: "#fef3c7",
                            borderRadius: 6,
                            marginBottom: 8,
                            fontSize: 14,
                            color: "#92400e",
                          }}
                        >
                          ❓ {q}
                        </li>
                      ))}
                  </ul>
                  {hsResult.possibleChapters && (
                    <div>
                      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>Could be in:</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {hsResult.possibleChapters.map((ch, i) => (
                          <span
                            key={i}
                            style={{
                              padding: "6px 12px",
                              background: "#f3f4f6",
                              borderRadius: 16,
                              fontSize: 13,
                              color: "#6b7280",
                            }}
                          >
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {hsResult.hint && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 12,
                        background: "#fef9c3",
                        borderRadius: 6,
                        fontSize: 13,
                        color: "#713f12",
                      }}
                    >
                      💡 {hsResult.hint}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SUCCESS RESULT */}
            {hsResult && !hsResult.error && !hsResult.needsMoreInfo && hsResult.cn8 && (
              <div
                style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 24 }}
              >
                {/* Code Display */}
                <div
                  style={{
                    textAlign: "center",
                    paddingBottom: 20,
                    borderBottom: "1px solid #e5e7eb",
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      fontSize: 36,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      color: "#059669",
                      letterSpacing: 2,
                    }}
                  >
                    {hsResult.cn8 ? hsResult.cn8.replace(/(\d{4})(\d{2})(\d{2})/, "$1.$2.$3") : hsResult.hs6}
                  </div>
                  <div style={{ fontSize: 15, color: "#6b7280", marginTop: 4 }}>{hsResult.description}</div>
                  <div style={{ display: "flex", justifyContent: "center", gap: 24, marginTop: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600 }}>{hsResult.standardDutyRate}%</div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                        Duty
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 600 }}>{hsResult.vatRateLU || 17}%</div>
                      <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>
                        VAT
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div
                          style={{ width: 50, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}
                        >
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 3,
                              width:
                                hsResult.confidence === "high"
                                  ? "90%"
                                  : hsResult.confidence === "medium"
                                    ? "60%"
                                    : "30%",
                              background:
                                hsResult.confidence === "high"
                                  ? "#059669"
                                  : hsResult.confidence === "medium"
                                    ? "#d97706"
                                    : "#dc2626",
                            }}
                          />
                        </div>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          marginTop: 4,
                        }}
                      >
                        Confidence
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status Badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 20,
                    background: hsResult.antiDumping || hsResult.prohibitedRestricted ? "#fee2e2" : "#d1fae5",
                    color: hsResult.antiDumping || hsResult.prohibitedRestricted ? "#dc2626" : "#059669",
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  {hsResult.antiDumping || hsResult.prohibitedRestricted
                    ? "⚠️ Restrictions may apply — check details"
                    : "✅ Clear to import — no restrictions"}
                </div>

                {/* Expandable: Documents */}
                {hsResult.requiredDocuments && hsResult.requiredDocuments.length > 0 && (
                  <details style={{ borderTop: "1px solid #e5e7eb" }}>
                    <summary
                      style={{
                        padding: "14px 0",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <span>📄 Required Documents</span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          background: "#f3f4f6",
                          padding: "2px 8px",
                          borderRadius: 10,
                        }}
                      >
                        {hsResult.requiredDocuments.length}
                      </span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.requiredDocuments.map((doc, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 0",
                            fontSize: 14,
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              background: doc.mandatory ? "#d1fae5" : "transparent",
                              border: doc.mandatory ? "2px solid #059669" : "2px solid #e5e7eb",
                              color: "#059669",
                            }}
                          >
                            {doc.mandatory ? "✓" : ""}
                          </span>
                          {doc.name}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Expandable: Preferential Rates */}
                {hsResult.preferentialRates && hsResult.preferentialRates.length > 0 && (
                  <details style={{ borderTop: "1px solid #e5e7eb" }}>
                    <summary
                      style={{
                        padding: "14px 0",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <span>🌍 Preferential Rates</span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          background: "#f3f4f6",
                          padding: "2px 8px",
                          borderRadius: 10,
                        }}
                      >
                        {hsResult.preferentialRates.length} FTAs
                      </span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.preferentialRates.slice(0, 6).map((pref, i) => (
                        <li
                          key={i}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "8px 0",
                            fontSize: 14,
                            borderBottom: "1px solid #f3f4f6",
                          }}
                        >
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
                    <summary
                      style={{
                        padding: "14px 0",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                    >
                      <span>📋 Regulations</span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          background: "#f3f4f6",
                          padding: "2px 8px",
                          borderRadius: 10,
                        }}
                      >
                        {hsResult.regulatoryNotes.length}
                      </span>
                    </summary>
                    <ul style={{ listStyle: "none", padding: "0 0 16px 0", margin: 0 }}>
                      {hsResult.regulatoryNotes.map((reg, i) => (
                        <li key={i} style={{ padding: "8px 0", fontSize: 14, borderBottom: "1px solid #f3f4f6" }}>
                          {reg}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Actions */}
                <div
                  style={{ display: "flex", gap: 12, marginTop: 20, paddingTop: 20, borderTop: "1px solid #e5e7eb" }}
                >
                  <button
                    onClick={() => addFavourite(hsResult.cn8 || hsResult.hs6, hsResult.description)}
                    style={{
                      flex: 1,
                      padding: 14,
                      background: "#f3f4f6",
                      color: "#1f2937",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    ★ Save
                  </button>
                  <button
                    onClick={() => {
                      setHsCode(hsResult.cn8 || hsResult.hs6);
                      setTab("calculator");
                    }}
                    style={{
                      flex: 1,
                      padding: 14,
                      background: "#059669",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 15,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    → Use in Calculator
                  </button>
                </div>
              </div>
            )}

            {/* ERROR */}
            {hsResult && hsResult.error && (
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 16px",
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  borderRadius: 8,
                  color: "#dc2626",
                  fontSize: 14,
                }}
              >
                {hsResult.error}
              </div>
            )}

            {/* FAVOURITES */}
            {favourites.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 12 }}>Saved HS Codes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {favourites.map((fav, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: 12,
                        background: "#fff",
                        borderRadius: 8,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      }}
                    >
                      <div>
                        <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#059669" }}>{fav.code}</span>
                        <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 13 }}>{fav.description}</span>
                      </div>
                      <button
                        onClick={() => removeFavourite(fav.code)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#dc2626",
                          cursor: "pointer",
                          fontSize: 18,
                        }}
                      >
                        ×
                      </button>
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
                    <span
                      style={{ fontSize: 10, color: "#6b7280", fontFamily: "var(--font-courier-prime), monospace" }}
                    >
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
                            <span
                              style={{
                                fontFamily: "var(--font-courier-prime), monospace",
                                fontSize: 13,
                                color: "#111827",
                              }}
                            >
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
                {Object.entries(ORIGIN_AGREEMENTS)
                  .sort((a, b) => a[1].name.localeCompare(b[1].name))
                  .map(([code, info]) => (
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
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      fontFamily: "var(--font-courier-prime), monospace",
                      marginTop: 2,
                    }}
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
