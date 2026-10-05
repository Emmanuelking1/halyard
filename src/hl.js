export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

export const LOOKBACK = {
  '1m': 8 * 60 * 60 * 1000,
  '5m': 36 * 60 * 60 * 1000,
  '15m': 4 * 24 * 60 * 60 * 1000,
  '1h': 16 * 24 * 60 * 60 * 1000,
  '4h': 70 * 24 * 60 * 60 * 1000,
  '1d': 400 * 24 * 60 * 60 * 1000,
};

export async function info(body) {
  const res = await fetch('/api/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = typeof data === 'object' && data ? data.error || data.detail : text;
    throw new Error(detail || `Hyperliquid ${res.status}`);
  }
  return data;
}

export function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtPx(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (a >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  if (a >= 0.01) return n.toFixed(4);
  if (a >= 0.0001) return n.toFixed(6);
  return n.toPrecision(4);
}

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + 'K';
  return sign + a.toFixed(a >= 10 ? 1 : 2);
}

export function fmtFunding(rate) {
  if (!Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  const sign = pct > 0 ? '+' : '';
  return sign + pct.toFixed(4) + '%';
}

export function pctChange(px, prev) {
  if (!Number.isFinite(px) || !Number.isFinite(prev) || prev === 0) return null;
  return ((px - prev) / prev) * 100;
}

export function fmtPct(p) {
  if (!Number.isFinite(p)) return '—';
  const sign = p > 0 ? '+' : '';
  return sign + p.toFixed(2) + '%';
}

export function toCandle(row) {
  return {
    t: Number(row.t),
    o: Number(row.o),
    h: Number(row.h),
    l: Number(row.l),
    c: Number(row.c),
    v: Number(row.v),
    n: Number(row.n),
  };
}

export function mergeCandles(prev, rows, coin, interval) {
  const map = new Map(prev.map((c) => [c.t, c]));
  for (const row of rows) {
    if (!row) continue;
    if (row.s && row.s !== coin) continue;
    if (row.i && row.i !== interval) continue;
    const c = toCandle(row);
    if (!Number.isFinite(c.t) || !Number.isFinite(c.c)) continue;
    map.set(c.t, c);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}
