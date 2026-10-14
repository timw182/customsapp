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
const bks = { value: 28931.12, exchangeRate: 1, invoiceFreight: 2838.88, incoterm: "DAP", transportMode: "air",
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

test("invoice freight is ignored under E and F terms, where the freight box already counts it", () => {
  const exw = landedCost({ ...bks, incoterm: "EXW" });
  close(exw.customsValue, 28931.12);
});

test("off the air, freight shown on a C or D invoice counts whole", () => {
  const r = landedCost({ ...bks, transportMode: "road" });
  close(r.customsValue, 31770);
});

test("a whole invoice spreads the invoice freight over its lines by value", () => {
  const r = landedCostShipment({ ...bks, lines: [
    { value: 8953.56, hsCode: "8208900000", dutyRatePct: 1.7 },
    { value: 19977.56, hsCode: "8208900000", dutyRatePct: 1.7 },
  ] });
  close(r.customsValue, 30918.34); close(Math.round(r.customsDuty * 100) / 100, 525.61);
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
