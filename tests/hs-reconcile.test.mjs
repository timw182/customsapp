// The code field of a pick must be the code its reasoning concludes on. On 2026-10-26 Sonnet
// returned hs6 "401120" (bus and lorry tyres) for a 265/50R20 passenger tyre while its reasoning
// and notes argued, twice and explicitly, for 4011 10; the pipeline took the field, TARIC picked
// 4011201000 under it, and the office saw a lorry-tyre code over a car-tyre explanation.
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileHs6, subheadingTexts, subheadingsMentioned } from "../src/lib/hs-pipeline.mjs";

const tyre = {
  status: "classified", hs6: "401120", heading: "4011", confidence: "high", confidencePct: 99,
  reasoning: "Under 4011, subheading 4011 20 covers tyres of a kind used on buses or lorries, while 4011 10 covers tyres of a kind used on motor cars. A 265/50R20 107H is a passenger car tyre. 4012 (retreaded) is excluded. The EAGLE TOURING is a Goodyear passenger car tyre line, confirming 401110.",
  notes: "Subheading 4011 10 (motor cars) applies at 6-digit level.",
};
const tyreLines = [
  { cn8: "40111000", cn10: "4011100000", path: "Of a kind used on motor cars (including station wagons and racing cars)" },
  { cn8: "40112010", cn10: "4011201000", path: "Of a kind used on buses or lorries > With a load index not exceeding 121" },
  { cn8: "40112090", cn10: "4011209000", path: "Of a kind used on buses or lorries > With a load index exceeding 121" },
  { cn8: "40117000", cn10: "4011700000", path: "Of a kind used on agricultural or forestry vehicles and machines" },
];
const tyreTexts = subheadingTexts(tyreLines);

test("subheadings are read in every spelling, only under the heading in question, never out of a longer code", () => {
  const found = subheadingsMentioned("4011 10, 4011.20, 4011-30, 401140, 4012 20, 4011209000, 40112010", "4011");
  assert.deepEqual([...found].sort(), ["401110", "401120", "401130", "401140"]);
});

test("a subheading's text is what its lines share, not one line's full path", () => {
  assert.equal(tyreTexts.get("401120"), "Of a kind used on buses or lorries");
  assert.equal(tyreTexts.get("401110"), "Of a kind used on motor cars (including station wagons and racing cars)");
  assert.equal(tyreTexts.size, 3);
});

test("a code that contradicts its own reasoning is replaced by the code the reasoning concludes on", async () => {
  const asked = [];
  const ask = async (_system, user) => { asked.push(user); return { hs6: "401110" }; };
  const out = await reconcileHs6(tyre, tyreTexts, { ask });
  assert.equal(asked.length, 1, "one reconciliation call");
  assert.match(asked[0], /4011 10: Of a kind used on motor cars/, "the official texts go with the question");
  assert.match(asked[0], /4011 20: Of a kind used on buses or lorries/);
  assert.doesNotMatch(asked[0], /4011 70/, "a subheading the argument never names is not offered");
  assert.equal(out.hs6, "401110");
  assert.equal(out.heading, "4011");
  assert.deepEqual(out._reconciled, { from: "401120", to: "401110" });
  assert.ok(out.confidencePct <= 90, "a pick that contradicted itself is not 99 % sure");
});

test("no second call when the reasoning names no other subheading under the heading", async () => {
  const ask = async () => { throw new Error("must not be asked"); };
  const out = await reconcileHs6({ ...tyre, hs6: "401110", reasoning: "GRI 1: new pneumatic tyre for motor cars, 4011 10.", notes: "" }, tyreTexts, { ask });
  assert.equal(out.hs6, "401110");
  assert.equal(out._reconciled, undefined);
});

test("a number that is no real subheading is not a contradiction (the '8807 00' heat sink of 2026-10)", async () => {
  const ask = async () => { throw new Error("must not be asked"); };
  const texts = subheadingTexts([
    { cn8: "88071000", path: "Propellers and rotors and parts thereof" },
    { cn8: "88072010", path: "Under-carriages and parts thereof > For use in civil aircraft" },
  ]);
  const pick = { status: "classified", hs6: "880720", confidencePct: 80, reasoning: "Parts of aircraft, 8807; selecting 8807 00 as the 6-digit subheading.", notes: "8807 has a single subheading (880700)." };
  const out = await reconcileHs6(pick, texts, { ask });
  assert.equal(out.hs6, "880720"); assert.equal(out._reconciled, undefined);
});

test("the reader may only confirm a code the argument actually names, and may confirm the field", async () => {
  const stray = await reconcileHs6(tyre, tyreTexts, { ask: async () => ({ hs6: "401170" }) });
  assert.equal(stray.hs6, "401120", "a real code the reasoning never mentions is not taken");
  const same = await reconcileHs6(tyre, tyreTexts, { ask: async () => ({ hs6: "401120" }) });
  assert.equal(same.hs6, "401120"); assert.equal(same._reconciled, undefined);
  const failed = await reconcileHs6(tyre, tyreTexts, { ask: async () => { throw new Error("api down"); } });
  assert.equal(failed.hs6, "401120", "a failed check changes nothing");
});

test("only a classified pick is checked, and only with texts in hand", async () => {
  const ask = async () => { throw new Error("must not be asked"); };
  const q = { status: "needs_info", questions: [] };
  assert.equal(await reconcileHs6(q, tyreTexts, { ask }), q);
  assert.equal(await reconcileHs6(tyre, undefined, { ask }), tyre);
});
