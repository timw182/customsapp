import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measuresOf, conditionsOf, detailsUrlOf } from '../src/lib/taric-exporter.mjs';

// Pages saved from the TARIC consultation site on 2026-10-14: e-bikes 8711 60 10 00 from China,
// trimmed to Bodo Vehicle Group (C382), "all other companies" (C999) and the third-country duty.
const details = readFileSync(new URL('./fixtures/taric-measures-ebike.html', import.meta.url), 'utf8');
const conditions = readFileSync(new URL('./fixtures/taric-conditions-c382.html', import.meta.url), 'utf8');

test('only trade-defence measures are read, each with its company', () => {
  const ms = measuresOf(details);
  assert.equal(ms.length, 4);
  assert.deepEqual(ms.map((m) => `${m.kind} ${m.additionalCode}`).sort(),
    ['antiDumping C382', 'antiDumping C999', 'countervailing C382', 'countervailing C999']);
  assert.equal(ms.find((m) => m.additionalCode === 'C382').company, 'Bodo Vehicle Group Co., Ltd.');
});

test('a named company has no printed rate; all other companies do', () => {
  const ms = measuresOf(details);
  const rate = (kind, code) => ms.find((m) => m.kind === kind && m.additionalCode === code).rate;
  assert.equal(rate('antiDumping', 'C382'), null);
  assert.equal(rate('antiDumping', 'C999'), 62.1);
  assert.equal(rate('countervailing', 'C999'), 17.2);
});

test('the conditions give the rate with the invoice declaration and without it', () => {
  assert.deepEqual(conditionsOf(conditions), { withDocument: 58.3, without: 62.1, document: 'D008' });
});

test('the outer page frames the details with a session id', () => {
  const outer = `<a href="measures_details.jsp?op=&amp;Taric=8711601000&amp;Sid=abc">x</a>`;
  assert.equal(detailsUrlOf(outer), 'https://ec.europa.eu/taxation_customs/dds2/taric/measures_details.jsp?op=&Taric=8711601000&Sid=abc');
  assert.equal(detailsUrlOf('<html></html>'), null);
});
