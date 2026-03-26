export const runtime = "nodejs";

const GRAFANA_URL =
  "https://faro-collector-prod-eu-west-2.grafana.net/collect/366dbce62face306fe0e8d9dbc1462b4";

export async function POST(req) {
  try {
    const body = await req.text();
    const resp = await fetch(GRAFANA_URL, {
      method: "POST",
      headers: {
        "Content-Type": req.headers.get("Content-Type") || "application/json",
      },
      body,
    });
    return new Response(null, { status: resp.status });
  } catch {
    return new Response(null, { status: 204 });
  }
}
