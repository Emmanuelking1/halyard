import { useEffect, useMemo, useRef, useState } from 'react';
import CandleChart from './chart.jsx';
import {
  INTERVALS,
  LOOKBACK,
  fmtCompact,
  fmtFunding,
  fmtPct,
  fmtPx,
  info,
  mergeCandles,
  num,
  pctChange,
  toCandle,
} from './hl.js';

function parseLevel(l) {
  return { px: num(l.px), sz: num(l.sz), n: l.n };
}

function clsx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function App() {
  const [coin, setCoin] = useState('BTC');
  const [interval, setIntervalKey] = useState('15m');
  const [query, setQuery] = useState('');
  const [markets, setMarkets] = useState([]);
  const [candles, setCandles] = useState([]);
  const [book, setBook] = useState({ bids: [], asks: [], time: null });
  const [trades, setTrades] = useState([]);
  const [mids, setMids] = useState({});
  const [status, setStatus] = useState({ rest: 'idle', ws: 'idle' });
  const [emaOn, setEmaOn] = useState(true);
  const [candleError, setCandleError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const genRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const data = await info({ type: 'metaAndAssetCtxs' });
        const universe = data?.[0]?.universe || [];
        const ctxs = data?.[1] || [];
        const rows = universe
          .map((u, i) => {
            const c = ctxs[i] || {};
            return {
              name: u.name,
              maxLeverage: u.maxLeverage,
              mark: num(c.markPx),
              mid: num(c.midPx),
              oracle: num(c.oraclePx),
              prev: num(c.prevDayPx),
              funding: num(c.funding),
              oi: num(c.openInterest),
              vol: num(c.dayNtlVlm),
              premium: num(c.premium),
            };
          })
          .sort((a, b) => (b.vol || 0) - (a.vol || 0));
        if (!stop) setMarkets(rows);
      } catch {
        if (!stop) setStatus((s) => ({ ...s, rest: s.rest === 'live' ? 'live' : 'error' }));
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let stop = false;
    const gen = ++genRef.current;
    setLoading(true);
    setCandleError('');
    setCandles([]);
    setTrades([]);
    const nowMs = Date.now();
    info({
      type: 'candleSnapshot',
      req: {
        coin,
        interval,
        startTime: nowMs - LOOKBACK[interval],
        endTime: nowMs,
      },
    })
      .then((data) => {
        if (stop || gen !== genRef.current) return;
        const rows = (Array.isArray(data) ? data : [])
          .map(toCandle)
          .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.c))
          .sort((a, b) => a.t - b.t);
        setCandles(rows);
        setStatus((s) => ({ ...s, rest: 'live' }));
        setLoading(false);
      })
      .catch((err) => {
        if (stop || gen !== genRef.current) return;
        setCandleError(err.message || 'Candle request failed');
        setStatus((s) => ({ ...s, rest: 'error' }));
        setLoading(false);
      });
    info({ type: 'l2Book', coin })
      .then((d) => {
        if (stop || gen !== genRef.current) return;
        setBook({
          bids: (d.levels?.[0] || []).map(parseLevel),
          asks: (d.levels?.[1] || []).map(parseLevel),
          time: d.time,
        });
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [coin, interval, reloadKey]);

  useEffect(() => {
    let dead = false;
    let ws;
    let ping;
    let retry;
    let attempt = 0;

    const connect = () => {
      if (dead) return;
      ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
      ws.onopen = () => {
        attempt = 0;
        setStatus((s) => ({ ...s, ws: 'live' }));
        const sub = (subscription) => ws.send(JSON.stringify({ method: 'subscribe', subscription }));
        sub({ type: 'candle', coin, interval });
        sub({ type: 'l2Book', coin });
        sub({ type: 'trades', coin });
        sub({ type: 'allMids' });
        clearInterval(ping);
        ping = setInterval(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }));
        }, 25000);
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.channel === 'candle') {
          const rows = Array.isArray(msg.data) ? msg.data : [msg.data];
          setCandles((prev) => mergeCandles(prev, rows, coin, interval));
        } else if (msg.channel === 'l2Book') {
          const d = msg.data;
          if (!d || (d.coin && d.coin !== coin)) return;
          setBook({
            bids: (d.levels?.[0] || []).map(parseLevel),
            asks: (d.levels?.[1] || []).map(parseLevel),
            time: d.time,
          });
        } else if (msg.channel === 'trades') {
          const rows = (Array.isArray(msg.data) ? msg.data : []).filter((t) => !t.coin || t.coin === coin);
          if (!rows.length) return;
          const prints = rows.map((t) => ({
            px: num(t.px),
            sz: num(t.sz),
            side: t.side,
            time: t.time,
          }));
          setTrades((prev) => [...prints].reverse().concat(prev).slice(0, 14));
        } else if (msg.channel === 'allMids') {
          if (msg.data?.mids) setMids(msg.data.mids);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (dead) return;
        setStatus((s) => ({ ...s, ws: 'error' }));
        const wait = Math.min(10000, 700 * 2 ** attempt);
        attempt += 1;
        retry = setTimeout(connect, wait);
      };
    };

    connect();
    return () => {
      dead = true;
      clearInterval(ping);
      clearTimeout(retry);
      try {
        ws && ws.close();
      } catch {
        /* ignore */
      }
    };
  }, [coin, interval]);

  const active = markets.find((m) => m.name === coin);
  const liveMid = mids[coin] != null ? num(mids[coin]) : null;
  const last = candles[candles.length - 1];
  const price = liveMid ?? last?.c ?? active?.mid ?? active?.mark;
  const change = pctChange(price, active?.prev);

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    const rows = q ? markets.filter((m) => m.name.toUpperCase().includes(q)) : markets;
    return rows.slice(0, 40);
  }, [markets, query]);

  const asks = book.asks.slice(0, 10);
  const bids = book.bids.slice(0, 10);
  const bestAsk = asks[0]?.px;
  const bestBid = bids[0]?.px;
  const spread = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? bestAsk - bestBid : null;
  const maxSz = Math.max(1e-12, ...asks.map((l) => l.sz || 0), ...bids.map((l) => l.sz || 0));

  const clock = now.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <div className="word">HALYARD</div>
            <div className="kicker">Hyperliquid perpetual tape</div>
          </div>
        </div>
        <div className="pills">
          <span className={clsx('pill', status.rest === 'live' && 'ok', status.rest === 'error' && 'bad')}>
            <i /> REST {status.rest === 'live' ? 'live' : status.rest === 'error' ? 'down' : 'idle'}
          </span>
          <span className={clsx('pill', status.ws === 'live' && 'ok', status.ws === 'error' && 'bad')}>
            <i /> WS {status.ws === 'live' ? 'live' : status.ws === 'error' ? 'reconnecting' : 'idle'}
          </span>
          <span className="pill clock">{clock} UTC</span>
        </div>
      </header>

      <div className="shell">
        <aside className="rail">
          <label className="search">
            <span>Markets</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search BTC, HYPE…"
              spellCheck={false}
            />
          </label>
          <div className="marketlist">
            {shown.length === 0 && <div className="empty">No market matches.</div>}
            {shown.map((m) => {
              const mid = num(mids[m.name]) ?? m.mid ?? m.mark;
              const ch = pctChange(mid, m.prev);
              return (
                <button
                  key={m.name}
                  className={clsx('mrow', m.name === coin && 'active')}
                  onClick={() => setCoin(m.name)}
                >
                  <span className="sym">
                    {m.name}
                    <em>{m.maxLeverage ? `${m.maxLeverage}x` : ''}</em>
                  </span>
                  <span className="mpx">{fmtPx(mid)}</span>
                  <span className={clsx('mch', ch > 0 && 'up', ch < 0 && 'down')}>{fmtPct(ch)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="stage">
          <div className="charthead">
            <div className="identity">
              <div className="pair">
                {coin}-PERP <span>HL</span>
              </div>
              <div className={clsx('big', change > 0 && 'up', change < 0 && 'down')}>{fmtPx(price)}</div>
              <div className={clsx('chg', change > 0 && 'up', change < 0 && 'down')}>
                {fmtPct(change)} <span>vs prev day</span>
              </div>
            </div>
            <dl className="stats">
              <div>
                <dt>Mark</dt>
                <dd>{fmtPx(active?.mark)}</dd>
              </div>
              <div>
                <dt>Oracle</dt>
                <dd>{fmtPx(active?.oracle)}</dd>
              </div>
              <div>
                <dt>Funding</dt>
                <dd className={clsx(active?.funding > 0 && 'up', active?.funding < 0 && 'down')}>
                  {fmtFunding(active?.funding)}
                </dd>
              </div>
              <div>
                <dt>Open interest</dt>
                <dd>{fmtCompact(active?.oi)}</dd>
              </div>
              <div>
                <dt>24h notional</dt>
                <dd>${fmtCompact(active?.vol)}</dd>
              </div>
              <div>
                <dt>Premium</dt>
                <dd>{fmtFunding(active?.premium)}</dd>
              </div>
            </dl>
          </div>

          <div className="toolbar">
            <div className="intervals">
              {INTERVALS.map((iv) => (
                <button key={iv} className={iv === interval ? 'on' : ''} onClick={() => setIntervalKey(iv)}>
                  {iv}
                </button>
              ))}
            </div>
            <button className={emaOn ? 'on ema' : 'ema'} onClick={() => setEmaOn((v) => !v)}>
              EMA 21
            </button>
            <span className="hint">Scroll to zoom · drag to pan · double-click resets</span>
          </div>

          {candleError && (
            <div className="banner">
              <span>{candleError}</span>
              <button onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
            </div>
          )}
          {loading && !candleError && <div className="loading">Pulling candleSnapshot…</div>}

          <CandleChart candles={candles} emaOn={emaOn} interval={interval} resetKey={`${coin}-${interval}`} />
        </main>

        <aside className="bookcol">
          <section>
            <header>
              <h2>Book</h2>
              <span>{asks.length || bids.length ? 'l2Book' : 'waiting'}</span>
            </header>
            <div className="ladder">
              {[...asks].reverse().map((l, i) => (
                <div className="level ask" key={`a${i}`}>
                  <span className="bar" style={{ width: `${((l.sz || 0) / maxSz) * 100}%` }} />
                  <span className="px">{fmtPx(l.px)}</span>
                  <span className="sz">{fmtCompact(l.sz)}</span>
                </div>
              ))}
              <div className="spread">
                spread {spread == null ? '—' : fmtPx(spread)}
              </div>
              {bids.map((l, i) => (
                <div className="level bid" key={`b${i}`}>
                  <span className="bar" style={{ width: `${((l.sz || 0) / maxSz) * 100}%` }} />
                  <span className="px">{fmtPx(l.px)}</span>
                  <span className="sz">{fmtCompact(l.sz)}</span>
                </div>
              ))}
              {asks.length === 0 && bids.length === 0 && <div className="empty">Book is empty.</div>}
            </div>
          </section>
          <section>
            <header>
              <h2>Prints</h2>
              <span>trades</span>
            </header>
            <div className="prints">
              {trades.length === 0 && <div className="empty">No prints yet.</div>}
              {trades.map((t, i) => (
                <div className="print" key={`${t.time}-${i}`}>
                  <span className="tm">
                    {t.time
                      ? new Date(t.time).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' })
                      : '—'}
                  </span>
                  <span className={t.side === 'B' ? 'up' : 'down'}>{t.side === 'B' ? 'buy' : 'sell'}</span>
                  <span>{fmtPx(t.px)}</span>
                  <span className="sz">{fmtCompact(t.sz)}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="foot">
        Public mainnet · api.hyperliquid.xyz · candleSnapshot, metaAndAssetCtxs, l2Book, trades, allMids. No keys, no orders.
      </footer>
    </div>
  );
}
