// The landed-cost arithmetic, on the worked example from the ELP tool's review of 2026-10-10:
// EXW from China by air, goods €10,000, air freight €1,000, insurance €50, 17% VAT.
import test from "node:test";
import assert from "node:assert/strict";
import { landedCost } from "../src/lib/landed-cost.mjs";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg ?? ""} expected ${b}, got ${a}`);
const base = { value: 10000, exchangeRate: 1, freight: 1000, insurance: 50, incoterm: "EXW", transportMode: "air",
  origin: "CN", hsCode: "8517130000", dutyRatePct: 0, vatRatePct: 17, now: new Date("2026-10-10") };

test("the customs value takes 70% of the air freight from China, as Annex 23-01 says", () => {
  const r = landedCost(base);
  close(r.freightEUR, 700); close(r.freightExcludedEUR, 300); close(r.customsValue, 10750);
});

test("import VAT is due on the whole freight, not only the share customs counts", () => {
  const r = landedCost(base);
  close(r.vatBase, 11050, "VAT base"); close(r.importVAT, 1878.5, "VAT");
});

test("the landed cost is what the importer paid plus what customs charges", () => {
  const r = landedCost(base);
  close(r.total, 10000 + 1000 + 50 + 0 + 1878.5, "total");
});

test("onward carriage in Luxembourg is VAT-able and part of the cost, never of the customs value", () => {
  const r = landedCost({ ...base, onwardCarriage: 120 });
  close(r.customsValue, 10750); close(r.vatBase, 11170); close(r.total, 11170 + 11170 * 0.17);
});

test("under C and D terms the freight is inside the price: nothing sits outside the customs value", () => {
  for (const incoterm of ["CIF", "CPT", "DAP", "DDP"]) {
    const r = landedCost({ ...base, incoterm, dutyRatePct: 4 });
    close(r.freightExcludedEUR, 0, incoterm);
    close(r.vatBase, r.customsValue + r.customsDuty, incoterm);
  }
  const cfr = landedCost({ ...base, incoterm: "CFR", transportMode: "sea" });
  close(cfr.customsValue, 10050, "CFR adds insurance only");
});

/* File 2313832 (ELP, 2026-08-28): BKS knives from Indonesia, DAP Ehlerange, goods €28,931.12 with
   the freight on its own line, €2,838.88. Luxembourg customs (MRN 26LU715L00004V4IR8) valued it at
   goods + 70% of that freight and charged €525.61 at 1.7%; this tool, ignoring the line, said €491.83. */
const bks = { value: 28931.12, exchangeRate: 1, freightInPrice: 2838.88, freightShownApart: true, incoterm: "DAP", transportMode: "air",
  origin: "ID", hsCode: "8208900000", dutyRatePct: 1.7, vatRatePct: 17, now: new Date("2026-08-28") };

test("freight a DAP invoice shows on its own line counts at the air share, as customs charged on 2313832", () => {
  const r = landedCost(bks);
  close(r.customsValue, 30918.34, "customs value");
  close(Math.round(r.customsDuty * 100) / 100, 525.61, "duty");
  close(r.freightEUR, 1987.22); close(r.freightExcludedEUR, 851.66);
});

test("the invoice's freight beyond the air share is still VAT-able and part of the cost", () => {
  const r = landedCost(bks);
  close(r.vatBase, 30918.34 + r.customsDuty + 851.66, "VAT base");
  close(r.total, 28931.12 + 2838.88 + r.customsDuty + r.importVAT, "total");
});

/* The office's workbook ("IMPORT - customs value details.xls", 1,159 declarations since 2002), sheet
   "BKS - DAP": a DAP price of €53,500 with the AWB freight of €4,177 inside it; 30% of that freight,
   the part flown after the EU border, comes off the price: customs value €52,246.90. */
test("freight inside a C or D price comes off it at the post-border share, as the office declares", () => {
  const r = landedCost({ ...bks, value: 53500, freightInPrice: 4177, freightShownApart: false });
  close(r.customsValue, 52246.9, "customs value"); close(r.freightExcludedEUR, 1253.1);
  close(r.total, 53500 + r.customsDuty + r.importVAT, "the price already holds the freight");
  for (const incoterm of ["CIF", "CPT", "CFR", "CIP", "DPU", "DDP"]) close(landedCost({ ...bks, value: 53500, freightInPrice: 4177, freightShownApart: false, incoterm }).customsValue, 52246.9, incoterm);
});

test("freight in the price is ignored under E and F terms, where the freight box counts it", () => {
  close(landedCost({ ...bks, incoterm: "EXW" }).customsValue, 28931.12);
  close(landedCost({ ...bks, incoterm: "FOB", freightShownApart: false }).customsValue, 28931.12);
});

test("off the air, freight in a C or D price stays in it whole, and a freight line counts whole", () => {
  close(landedCost({ ...bks, transportMode: "road" }).customsValue, 31770);
  close(landedCost({ ...bks, value: 53500, freightShownApart: false, transportMode: "sea" }).customsValue, 53500);
});

/* Sheet "KTI-CPT": CPT from Korea, €4,970 (2.2%) and €335 (1.7%), AWB freight €1,400, 17% off, spread
   over the lines by NET WEIGHT (207 kg and 3 kg), which is how the office has always apportioned
   transport: duty €104.1788 + €5.6372 = €109.816. By value it would be €109.69. */
test("a whole invoice spreads the transport over its lines by net weight when every line has one", () => {
  const r = landedCostShipment({ exchangeRate: 1, freightInPrice: 1400, incoterm: "CPT", transportMode: "air", origin: "KR", vatRatePct: 17, now: new Date("2026-08-28"), lines: [
    { value: 4970, hsCode: "8418999099", dutyRatePct: 2.2, quantities: { kg: 207 } },
    { value: 335, hsCode: "8421392590", dutyRatePct: 1.7, quantities: { kg: 3 } },
  ] });
  close(r.lines[0].customsValue, 4735.4); close(r.lines[1].customsValue, 331.6);
  close(r.customsDuty, 109.816, "duty"); close(r.customsValue, 5067);
  assert.equal(r.spreadBy, "weight");
});

test("without a weight on every line the transport is spread by value, and insurance always is", () => {
  const r = landedCostShipment({ exchangeRate: 1, freight: 1000, insurance: 100, incoterm: "EXW", transportMode: "road", origin: "CH", vatRatePct: 17, lines: [
    { value: 3000, dutyRatePct: 0, quantities: { kg: 10 } }, { value: 1000, dutyRatePct: 0 },
  ] });
  assert.equal(r.spreadBy, "value");
  close(r.lines[0].customsValue, 3000 + 750 + 75); close(r.lines[1].customsValue, 1000 + 250 + 25);
  const w = landedCostShipment({ exchangeRate: 1, freight: 1000, insurance: 100, incoterm: "EXW", transportMode: "road", origin: "CH", vatRatePct: 17, lines: [
    { value: 3000, dutyRatePct: 0, quantities: { kg: 10 } }, { value: 1000, dutyRatePct: 0, quantities: { kg: 30 } },
  ] });
  close(w.lines[0].customsValue, 3000 + 250 + 75, "freight by weight, insurance by value"); close(w.lines[1].customsValue, 1000 + 750 + 25);
});

/* Sheet "3 D DONNA B FASO": EXW from Burkina Faso, XOF 574,280 air freight at 50% (zone E) plus
   XOF 2,918.28 of other charges at origin, which count whole: €437.74 + €4.45 = €442.19 on €1,065. */
test("other charges at origin go into the customs value whole, not at the air share", () => {
  const r = landedCost({ value: 1065 * 655.957, exchangeRate: 1 / 655.957, freight: 574280, originCharges: 2918.28, incoterm: "EXW", transportMode: "air", origin: "BF", dutyRatePct: 0, vatRatePct: 17 });
  close(r.airfreightPct, 50); close(r.originChargesEUR, 4.45, "origin charges"); close(r.customsValue, 1507.19, "customs value");
});

/* Annex 23-01 splits the United States, Canada and Russia by airport. Houston, ELP's commonest
   import origin (321 files in the 18 months to 2026-10-14), is zone B at 78%, not the 70% of New York. */
test("the air share for the US, Canada and Russia follows the departure airport", () => {
  const at = (origin, departureAirport, extra = {}) => landedCost({ ...base, origin, departureAirport, ...extra }).airfreightPct;
  assert.equal(at("US", "IAH"), 78); assert.equal(at("US", "JFK"), 70); assert.equal(at("US", "ANC"), 89);
  assert.equal(at("CA", "YVR"), 78); assert.equal(at("CA", "YYZ"), 70);
  assert.equal(at("RU", "SVO"), 30); assert.equal(at("RU", "OVB"), 57); assert.equal(at("RU", "VVO"), 83);
  assert.equal(at("CN", "IAH"), 70, "an airport cannot move a one-zone country");
});

test("the share follows the departure, not the goods' origin: Chinese goods flown out of Houston are zone B", () => {
  assert.equal(landedCost({ ...base, origin: "CN", departureCountry: "US", departureAirport: "IAH" }).airfreightPct, 78);
  const r = landedCostShipment({ ...base, origin: "US", departureAirport: "IAH", lines: [{ value: 1000, origin: "CN", dutyRatePct: 0 }, { value: 1000, dutyRatePct: 0 }] });
  assert.equal(r.lines[0].airfreightPct, 78); assert.equal(r.lines[1].airfreightPct, 78);
  assert.equal(landedCost({ ...base, origin: "CN" }).airfreightPct, 70, "no departure given: the origin's zone");
});

test("an airport the Annex does not name takes the nearest named one; none at all, the country's usual zone", () => {
  const hou = landedCost({ ...base, origin: "US", departureAirport: "HOU", departureLat: 29.65, departureLon: -95.28 });
  assert.equal(hou.airfreightPct, 78); assert.equal(hou.airfreightVia, "IAH");
  const sat = landedCost({ ...base, origin: "US", departureAirport: "SAT" });
  assert.equal(sat.airfreightPct, 70); assert.equal(sat.airfreightVia, null); assert.equal(sat.airportUnknown, true);
  assert.equal(landedCost({ ...base, origin: "US" }).airportUnknown, true);
  assert.equal(landedCost({ ...base, origin: "CN" }).airportUnknown, false);
});

/* The office's VAT block adds its clearance fee (€125 on 166 of 196 sheets) to the base: a commission
   to the first destination is an incidental expense (VAT Directive Art. 86(1)(b)). */
test("the clearance fee is in the VAT base and the cost, never in the customs value", () => {
  const r = landedCost({ ...base, agencyFees: 125, dutyRatePct: 4 });
  close(r.customsValue, 10750); close(r.vatBase, 10750 + 430 + 300 + 125); close(r.total, 10000 + 1000 + 50 + 430 + 125 + r.importVAT);
});

test("duty and anti-dumping are charged on the customs value and both feed the VAT base", () => {
  const r = landedCost({ ...base, transportMode: "road", freight: 800, insurance: 0, dutyRatePct: 6, antiDumpingRatePct: 48.5 });
  close(r.customsValue, 10800); close(r.customsDuty, 648); close(r.antiDumpingDuty, 5238);
  close(r.vatBase, 10800 + 648 + 5238); close(r.total, 16686 + 16686 * 0.17);
});

test("a ticked preference with no TARIC rate behind it changes nothing", () => {
  const japan = landedCost({ ...base, origin: "JP", dutyRatePct: 3, preferential: true, hasProofOfOrigin: true, usingPreferentialRate: false });
  assert.equal(japan.effectiveDutyRate, 3); assert.equal(japan.preference, null);
  const india = landedCost({ ...base, origin: "IN", dutyRatePct: 12, preferential: true, hasProofOfOrigin: true });
  assert.equal(india.effectiveDutyRate, 12); assert.equal(india.preference, null);
});

test("the preferential rate TARIC gave is used as typed, and named", () => {
  const r = landedCost({ ...base, origin: "JP", dutyRatePct: 0, preferential: true, hasProofOfOrigin: true, usingPreferentialRate: true });
  assert.equal(r.effectiveDutyRate, 0); assert.equal(r.preference, "fta");
});

test("the €150 duty relief ended on 1 July 2026", () => {
  const before = landedCost({ ...base, value: 120, freight: 40, insurance: 0, dutyRatePct: 4, now: new Date("2026-06-30") });
  assert.equal(before.dutyFree, true); assert.equal(before.customsDuty, 0);
  const after = landedCost({ ...base, value: 120, freight: 40, insurance: 0, dutyRatePct: 4, now: new Date("2026-07-01") });
  assert.equal(after.dutyFree, false); close(after.customsDuty, 148 * 0.04);
});

test("a foreign currency is converted once, at euro per unit", () => {
  const r = landedCost({ ...base, value: 12000, exchangeRate: 0.92, freight: 1500, insurance: 60, incoterm: "FCA", origin: "US" });
  close(r.valueEUR, 11040); close(r.freightEUR, 1380 * 0.7); close(r.freightExcludedEUR, 1380 * 0.3); close(r.insuranceEUR, 55.2);
});

/* ---------------------------------------------------------- 2026-10-10, second round */

import { landedCostShipment } from "../src/lib/landed-cost.mjs";

test("a specific duty is charged on the weight, and without a weight the duty is left open", () => {
  const r = landedCost({ ...base, transportMode: "road", freight: 500, insurance: 0, incoterm: "EXW", origin: "CH",
    dutyRatePct: 0, dutyExpression: "167.100 EUR DTN", quantities: { kg: 400 } });
  close(r.customsDuty, 167.1 * 4); assert.deepEqual(r.dutyNeeds, []);
  const open = landedCost({ ...base, dutyExpression: "167.100 EUR DTN" });
  assert.equal(open.customsDuty, null); assert.deepEqual(open.dutyNeeds, ["kg"]); assert.equal(open.total, null);
});

test("VAT is paid at import whoever imports; a registered business sees the part it reclaims; procedure 42 charges none", () => {
  const cost = landedCost({ ...base, dutyRatePct: 4 });
  assert.equal(cost.vatRecoverable, 0);
  const reco = landedCost({ ...base, dutyRatePct: 4, vatPosition: "recoverable" });
  close(reco.importVAT, cost.importVAT); close(reco.total, cost.total, "the total is the same: the VAT is paid either way");
  close(reco.vatRecoverable, reco.importVAT); close(reco.cashAtImport, reco.customsDuty + reco.importVAT);
  const p42 = landedCost({ ...base, dutyRatePct: 4, vatPosition: "procedure42" });
  assert.equal(p42.importVAT, 0); close(p42.total, cost.total - cost.importVAT);
});

test("a shipment of lines spreads freight and insurance by value and sums the lines", () => {
  const r = landedCostShipment({ ...base, freight: 1000, insurance: 50, lines: [
    { value: 7500, hsCode: "8517130000", dutyRatePct: 0 },
    { value: 2500, hsCode: "6109100010", dutyRatePct: 12, vatRatePct: 17 },
  ] });
  close(r.lines[0].share, 0.75); close(r.lines[1].share, 0.25);
  close(r.lines[0].freightEUR, 525); close(r.lines[1].freightEUR, 175, "70% of its quarter of the freight");
  close(r.lines[1].customsValue, 2500 + 175 + 12.5); close(r.lines[1].customsDuty, (2500 + 175 + 12.5) * 0.12);
  close(r.customsValue, r.lines[0].customsValue + r.lines[1].customsValue);
  close(r.freightExcludedEUR, 300); close(r.valueEUR, 10000);
  close(r.total, r.lines[0].total + r.lines[1].total);
});

test("a shipment with one open specific duty has an open total and says what it needs", () => {
  const r = landedCostShipment({ ...base, lines: [
    { value: 5000, dutyRatePct: 0 },
    { value: 5000, dutyExpression: "20.000 EUR DTN" },
  ] });
  assert.equal(r.total, null); assert.deepEqual(r.dutyNeeds, ["kg"]);
});

/* ---- The VAT rate a code implies, from TARLUX first and the chapter guess second (2026-10-14) ---- */
import { getLuVAT, luVatAnswer } from "../src/lib/landed-cost.mjs";

test("the chapter guess no longer puts every chapter-90 instrument at 8%", () => {
  /* 9014 20 20 00, aeronautical navigation instruments, is 17% in TARLUX; the old list had 90 at 8%. */
  assert.equal(getLuVAT("9014202000"), 0.17);
});

test("the rate comes from TARLUX when it answers, with its choices and a source", async () => {
  const rows = { ratePct: 17, choices: [{ ratePct: 17, additionalCode: "1994", description: "Other goods" }, { ratePct: 8, additionalCode: "1926", description: "Cut flowers" }] };
  const a = await luVatAnswer("0603110000", false, { lookup: async () => rows });
  assert.equal(a.vatRatePct, 17);
  assert.equal(a.vatSource, "tarlux");
  assert.equal(a.vatChoices.length, 2);
});

test("the chapter guess stands in, and says so, when TARLUX refuses the code or cannot be reached", async () => {
  const refused = await luVatAnswer("0603110000", false, { lookup: async () => null });
  assert.equal(refused.vatRatePct, 3, "chapter 6 is in the 3% list");
  assert.equal(refused.vatSource, "chapter");
  assert.deepEqual(refused.vatChoices, []);
  const down = await luVatAnswer("9014202000", false, { lookup: async () => { throw new Error("timeout"); } });
  assert.equal(down.vatRatePct, 17);
  assert.equal(down.vatSource, "chapter");
});
