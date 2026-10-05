export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  try {
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=2, stale-while-revalidate=8');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(502).json({
      error: 'Hyperliquid upstream failed',
      detail: String((err && err.message) || err),
    });
  }
}
