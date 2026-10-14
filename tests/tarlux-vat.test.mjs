import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vatRowsOf, measuresUrl } from '../src/lib/tarlux-vat.mjs';

// Answers saved from TARLUX's measures service on 2026-10-14, trimmed to the VAT rows (measure
// type LBT), the national additional codes they name, and one third-country duty row to skip.
const read = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('a code with one VAT rate gives that rate and no choice', () => {
  const v = vatRowsOf(read('tarlux-vat-9014202000.json'));
  assert.equal(v.ratePct, 17);
  assert.deepEqual(v.choices, [{ ratePct: 17, additionalCode: null, description: null }]);
});

test('a code with several VAT rates leads with the standard one and names what each other is for', () => {
  const v = vatRowsOf(read('tarlux-vat-0603110000.json'));
  assert.equal(v.ratePct, 17);
  assert.deepEqual(v.choices.map((c) => [c.ratePct, c.additionalCode]), [[17, '1994'], [8, '1926']]);
  assert.match(v.choices[1].description, /^Cut flowers/);
  assert.equal(v.choices[0].description, 'Other Goods liable to VAT at rate of 17% in accordance with the VAT Legislation');
});

test('the EU-area duplicate of each rate is not a second choice', () => {
  /* Every LBT row comes twice, once for ERGA OMNES and once for the EU; one choice per rate. */
  assert.equal(vatRowsOf(read('tarlux-vat-0603110000.json')).choices.length, 2);
});

test('a code TARLUX refuses as not declarable gives null, not a rate', () => {
  assert.equal(vatRowsOf(read('tarlux-vat-notdeclarable.json')), null);
});

test('the service is asked for every measure on the code for today, imports, in euro', () => {
  const u = new URL(measuresUrl('9014202000', new Date('2026-10-14T09:00:00Z')));
  assert.equal(u.origin + u.pathname, 'https://saturn.etat.lu/ite-tariff-public-proxy/ite-tariff-trusted-rs/v1/mcc/measures');
  assert.equal(u.searchParams.get('commoditycode'), '9014202000');
  assert.equal(u.searchParams.get('simulationdate'), '2026-10-14');
  assert.equal(u.searchParams.get('tradedirection'), 'I');
  assert.equal(u.searchParams.get('count'), '200');
});
