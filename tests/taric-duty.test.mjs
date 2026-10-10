// TARIC duty expressions as the tariff prints them, read and applied (src/lib/taric-duty.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { applyDuty, parseDutyRate, quantitiesNeeded } from "../src/lib/taric-duty.mjs";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg ?? ""} expected ${b}, got ${a}`);

test("a plain percentage", () => {
  const p = parseDutyRate("12.000 %");
  assert.equal(p.type, "ad_valorem"); assert.equal(p.adValorem, 12); assert.deepEqual(p.specifics, []);
  close(applyDuty(p, 1000), 120);
});

test("a specific duty per 100 kg is not duty free (the cheese line of 2026-10-10)", () => {
  const p = parseDutyRate("167.100 EUR DTN");
  assert.equal(p.type, "specific"); assert.equal(p.adValorem, null);
  assert.deepEqual(quantitiesNeeded(p), ["kg"]);
  assert.equal(applyDuty(p, 1000), null, "no weight, no answer");
  close(applyDuty(p, 1000, { kg: 250 }), 167.1 * 2.5);
});

test("a compound duty adds the percentage and the per-unit part", () => {
  const p = parseDutyRate("6.400 % + 20.100 EUR DTN");
  assert.equal(p.type, "compound");
  close(applyDuty(p, 10000, { kg: 1000 }), 640 + 201);
});

test("MIN and MAX clauses bound the duty", () => {
  const min = parseDutyRate("0.000 % MIN 1.300 EUR DTN");
  close(applyDuty(min, 10000, { kg: 5000 }), 65, "the floor applies when the percentage gives less");
  const max = parseDutyRate("10.000 % MAX 2.000 EUR KGM");
  close(applyDuty(max, 10000, { kg: 100 }), 200, "the ceiling applies when the percentage gives more");
  close(applyDuty(max, 1000, { kg: 100 }), 100, "below the ceiling the percentage stands");
});

test("free, nought and the old slash spelling", () => {
  assert.equal(parseDutyRate("FREE").type, "duty_free");
  assert.equal(parseDutyRate("NIHIL").adValorem, 0, "a named exporter at nil anti-dumping is a rate of nought");
  assert.equal(parseDutyRate("0.000 %").type, "duty_free");
  const old = parseDutyRate("44.0 EUR/100 kg");
  assert.equal(old.specifics[0].unit, "DTN"); close(applyDuty(old, 0, { kg: 200 }), 88);
});

test("a unit this does not know is reported, not guessed", () => {
  const p = parseDutyRate("3.000 EUR DTN E");
  assert.equal(p.complete, false); assert.equal(p.type, "unknown");
  assert.equal(parseDutyRate(""), null); assert.equal(parseDutyRate(null), null);
});
