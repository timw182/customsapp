// /var/www/customs/src/app/api/fx/route.js
// Cached proxy for frankfurter.app ECB exchange rates
// Cache: 4 hours (rates update once daily on ECB business days)

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Simple in-memory cache (survives across requests within same process)
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/* Bounded since ?date= made the key space dates x currencies (2026-10-10 review): the oldest
   entry goes when the map is full, and expired ones are only dropped when read. */
const CACHE_MAX = 500;

function setCached(key, data) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { data, ts: Date.now() });
}

const CCY = /^[A-Z]{3}$/;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get('from') || 'EUR').toUpperCase();
  const toRaw = searchParams.get('to');
  const to = toRaw ? toRaw.toUpperCase() : null;
  /* ?date=YYYY-MM-DD answers with the ECB rate of that day (or the last business day before it).
     The customs exchange rate for a month is the ECB rate of the penultimate Wednesday of the month
     before (UCC-IA Art. 146), which is what the ELP tool asks for (2026-10-10). */
  const dateRaw = searchParams.get('date');
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
  if (dateRaw && !date) return Response.json({ error: 'Invalid date' }, { status: 400 });

  // Validate before they ever reach the upstream URL or the cache key — both
  // are built by interpolation, so reject anything that isn't a 3-letter code.
  if (!CCY.test(from) || (to !== null && !CCY.test(to))) {
    return Response.json({ error: 'Invalid currency code' }, { status: 400 });
  }

  const cacheKey = `${date ?? 'latest'}:${to ? `${from}-${to}` : `${from}-all`}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return Response.json({ ...cached, cached: true });
  }

  try {
    const when = date ?? 'latest';
    const url = to
      ? `https://api.frankfurter.app/${when}?from=${from}&to=${to}`
      : `https://api.frankfurter.app/${when}?from=${from}`;

    const resp = await fetch(url, {
      next: { revalidate: 14400 }, // 4h Next.js cache hint
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) throw new Error(`Frankfurter error: ${resp.status}`);
    const data = await resp.json();
    setCached(cacheKey, data);
    return Response.json(data);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
