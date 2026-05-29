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

function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

const CCY = /^[A-Z]{3}$/;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const from = (searchParams.get('from') || 'EUR').toUpperCase();
  const toRaw = searchParams.get('to');
  const to = toRaw ? toRaw.toUpperCase() : null;

  // Validate before they ever reach the upstream URL or the cache key — both
  // are built by interpolation, so reject anything that isn't a 3-letter code.
  if (!CCY.test(from) || (to !== null && !CCY.test(to))) {
    return Response.json({ error: 'Invalid currency code' }, { status: 400 });
  }

  const cacheKey = to ? `${from}-${to}` : `${from}-all`;
  const cached = getCached(cacheKey);
  if (cached) {
    return Response.json({ ...cached, cached: true });
  }

  try {
    const url = to
      ? `https://api.frankfurter.app/latest?from=${from}&to=${to}`
      : `https://api.frankfurter.app/latest?from=${from}`;

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
