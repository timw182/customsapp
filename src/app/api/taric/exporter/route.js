import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/apiAuth';
import { exporterRates } from '@/lib/taric-exporter.mjs';

/* One named exporter's anti-dumping and countervailing rates (src/lib/taric-exporter.mjs says why
   these come from the consultation site, not the SOAP service /api/taric uses). Asked for one company
   at a time, when a person names the seller, not on every tariff look-up (2026-10-14). */
export async function POST(req) {
  const a = await requireUser(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const code = String(body.code ?? '').replace(/\D/g, '');
  const origin = String(body.countryCode ?? '').replace(/[^A-Za-z]/g, '').toUpperCase();
  const additionalCode = String(body.additionalCode ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (code.length !== 10 || origin.length !== 2 || additionalCode.length !== 4) {
    return NextResponse.json({ error: 'code (10 digits), countryCode and additionalCode (e.g. C382) required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ code, origin, additionalCode, measures: await exporterRates(code, origin, additionalCode) });
  } catch (error) {
    console.error('[taric/exporter]', error);
    return NextResponse.json({ error: 'The TARIC consultation site could not be read just now.' }, { status: 502 });
  }
}
