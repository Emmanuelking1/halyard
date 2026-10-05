import { useEffect, useRef } from 'react';
import { fmtPx } from './hl.js';

const UP = '#1c9a74';
const DOWN = '#e15a4a';
const EMA = '#8eb4ff';
const LAST = '#e4b06a';
const GRID = 'rgba(232, 214, 184, 0.08)';
const INK = '#efe6d6';
const MUTED = '#9a9184';
const FONT = '12px "IBM Plex Mono", ui-monospace, monospace';

function emaSeries(candles, period) {
  const k = 2 / (period + 1);
  const out = new Array(candles.length).fill(null);
  let prev = null;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i].c;
    if (i < period) sum += c;
    if (i === period - 1) {
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period && prev != null) {
      prev = c * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function fmtTime(ts, interval) {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  if (interval === '1d') return `${mon} ${d.getUTCDate()}`;
  if (interval === '4h' || interval === '1h') return `${mon} ${d.getUTCDate()} ${hh}:${mm}`;
  return `${hh}:${mm}`;
}

export default function CandleChart({ candles, emaOn, interval, resetKey }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const candlesRef = useRef(candles);
  const emaOnRef = useRef(emaOn);
  const intervalRef = useRef(interval);
  const viewRef = useRef({ key: '', start: 0, count: 140, pinned: true });
  const hoverRef = useRef(null);
  const dragRef = useRef(null);

  candlesRef.current = candles;
  emaOnRef.current = emaOn;
  intervalRef.current = interval;

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w < 10 || h < 10) return;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    const data = candlesRef.current || [];
    const n = data.length;
    if (!n) {
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for candles', w / 2, h / 2);
      return;
    }

    const view = viewRef.current;
    if (view.key !== resetKey) {
      const count = Math.min(140, n);
      view.key = resetKey;
      view.count = count;
      view.start = Math.max(0, n - count);
      view.pinned = true;
    } else if (view.pinned) {
      view.count = Math.min(view.count, n);
      view.start = Math.max(0, n - view.count);
    } else {
      view.count = Math.min(view.count, n);
      view.start = Math.max(0, Math.min(view.start, n - view.count));
    }

    const start = view.start;
    const count = Math.max(1, view.count);
    const slice = data.slice(start, start + count);
    const m = slice.length;
    if (!m) return;

    const padT = 28;
    const padB = 26;
    const plotL = 10;
    const axisW = 76;
    const plotR = w - axisW;
    const plotW = Math.max(1, plotR - plotL);
    const volH = Math.max(48, Math.round(h * 0.18));
    const gap = 10;
    const chartH = Math.max(40, h - padT - padB - volH - gap);

    let min = Infinity;
    let max = -Infinity;
    let maxVol = 0;
    for (const c of slice) {
      if (c.l < min) min = c.l;
      if (c.h > max) max = c.h;
      if (c.v > maxVol) maxVol = c.v;
    }
    const ema = emaOnRef.current ? emaSeries(data, 21) : null;
    if (ema) {
      for (let i = start; i < start + m; i++) {
        const v = ema[i];
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || Math.abs(max) * 0.002 || 1;
    min -= span * 0.08;
    max += span * 0.08;
    const yOf = (px) => padT + ((max - px) / (max - min)) * chartH;
    const slot = plotW / m;

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const px = max - ((max - min) * i) / ticks;
      const y = yOf(px);
      ctx.beginPath();
      ctx.moveTo(plotL, y);
      ctx.lineTo(plotR, y);
      ctx.stroke();
      ctx.fillText(fmtPx(px), plotR + 8, y);
    }

    const volTop = padT + chartH + gap;
    ctx.fillStyle = 'rgba(154, 145, 132, 0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('VOL', plotL + 2, volTop + 8);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotL, volTop, plotW, volH);
    ctx.clip();
    for (let i = 0; i < m; i++) {
      const c = slice[i];
      const up = c.c >= c.o;
      const cx = plotL + (i + 0.5) * slot;
      const bw = Math.max(1, Math.min(16, slot * 0.72));
      const bh = maxVol > 0 ? (c.v / maxVol) * (volH - 8) : 0;
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = up ? UP : DOWN;
      ctx.fillRect(cx - bw / 2, volTop + volH - bh, bw, bh);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotL, padT, plotW, chartH);
    ctx.clip();
    for (let i = 0; i < m; i++) {
      const c = slice[i];
      const up = c.c >= c.o;
      const cx = plotL + (i + 0.5) * slot;
      const bw = Math.max(1, Math.min(16, slot * 0.72));
      ctx.strokeStyle = up ? UP : DOWN;
      ctx.fillStyle = up ? UP : DOWN;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(c.h));
      ctx.lineTo(cx, yOf(c.l));
      ctx.stroke();
      const yHi = yOf(Math.max(c.o, c.c));
      const yLo = yOf(Math.min(c.o, c.c));
      ctx.fillRect(cx - bw / 2, yHi, bw, Math.max(1, yLo - yHi));
    }

    if (ema) {
      ctx.beginPath();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = EMA;
      let pen = false;
      for (let i = 0; i < m; i++) {
        const v = ema[start + i];
        if (v == null) {
          pen = false;
          continue;
        }
        const x = plotL + (i + 0.5) * slot;
        const y = yOf(v);
        if (!pen) {
          ctx.moveTo(x, y);
          pen = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const last = data[n - 1];
    const ly = yOf(last.c);
    if (ly >= padT && ly <= padT + chartH) {
      ctx.save();
      ctx.strokeStyle = LAST;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotL, ly);
      ctx.lineTo(plotR, ly);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    if (ly >= padT - 10 && ly <= padT + chartH + 10) {
      const label = fmtPx(last.c);
      const ty = Math.max(padT + 8, Math.min(padT + chartH - 8, ly));
      ctx.fillStyle = '#3a2a16';
      ctx.fillRect(plotR + 4, ty - 9, axisW - 10, 18);
      ctx.fillStyle = LAST;
      ctx.textAlign = 'left';
      ctx.fillText(label, plotR + 8, ty);
    }

    ctx.strokeStyle = GRID;
    ctx.beginPath();
    ctx.moveTo(plotL, padT + chartH);
    ctx.lineTo(plotR, padT + chartH);
    ctx.stroke();

    ctx.fillStyle = MUTED;
    ctx.textAlign = 'center';
    const iv = intervalRef.current;
    const marks = 5;
    for (let i = 0; i < marks; i++) {
      const idx = Math.round(((m - 1) * i) / (marks - 1));
      const c = slice[idx];
      if (!c) continue;
      const x = plotL + (idx + 0.5) * slot;
      ctx.fillText(fmtTime(c.t, iv), x, h - 12);
    }

    const hover = hoverRef.current;
    const readout = hover && hover.i >= start && hover.i < start + m ? data[hover.i] : last;
    if (readout) {
      const up = readout.c >= readout.o;
      const delta = readout.c - readout.o;
      const parts = [
        { t: `O ${fmtPx(readout.o)}`, c: INK },
        { t: `H ${fmtPx(readout.h)}`, c: INK },
        { t: `L ${fmtPx(readout.l)}`, c: INK },
        { t: `C ${fmtPx(readout.c)}`, c: up ? UP : DOWN },
        { t: `${delta >= 0 ? '+' : ''}${fmtPx(delta)}`, c: up ? UP : DOWN },
      ];
      if (emaOnRef.current) parts.push({ t: 'EMA 21', c: EMA });
      let x = plotL + 4;
      ctx.textAlign = 'left';
      const y = 14;
      for (const p of parts) {
        ctx.fillStyle = p.c;
        ctx.fillText(p.t, x, y);
        x += ctx.measureText(p.t).width + 14;
      }
    }

    if (hover && hover.x >= plotL && hover.x <= plotR && hover.y >= padT && hover.y <= h - padB) {
      ctx.save();
      ctx.strokeStyle = 'rgba(239, 230, 214, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hover.x, padT);
      ctx.lineTo(hover.x, volTop + volH);
      if (hover.y <= padT + chartH) {
        ctx.moveTo(plotL, hover.y);
        ctx.lineTo(plotR, hover.y);
      }
      ctx.stroke();
      ctx.restore();
      if (hover.y >= padT && hover.y <= padT + chartH) {
        const px = max - ((hover.y - padT) / chartH) * (max - min);
        ctx.fillStyle = '#241c14';
        ctx.fillRect(plotR + 4, hover.y - 9, axisW - 10, 18);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.fillText(fmtPx(px), plotR + 8, hover.y);
      }
      const hi = Math.floor((hover.x - plotL) / slot);
      const hc = slice[hi];
      if (hc) {
        const label = fmtTime(hc.t, iv);
        const tw = ctx.measureText(label).width + 12;
        const tx = Math.min(plotR - tw, Math.max(plotL, hover.x - tw / 2));
        ctx.fillStyle = '#241c14';
        ctx.fillRect(tx, h - 22, tw, 16);
        ctx.fillStyle = INK;
        ctx.textAlign = 'left';
        ctx.fillText(label, tx + 6, h - 14);
      }
    }
  };

  useEffect(() => {
    draw();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e) => {
      e.preventDefault();
      const data = candlesRef.current || [];
      const n = data.length;
      if (n < 2) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plotL = 10;
      const plotR = rect.width - 76;
      const plotW = Math.max(1, plotR - plotL);
      const v = viewRef.current;
      const rel = Math.min(1, Math.max(0, (x - plotL) / plotW));
      const idx = v.start + rel * v.count;
      const zoom = e.deltaY > 0 ? 1.12 : 0.88;
      let count = Math.round(v.count * zoom);
      count = Math.max(20, Math.min(n, count));
      let start = Math.round(idx - rel * count);
      if (start < 0) start = 0;
      if (start + count > n) start = Math.max(0, n - count);
      v.start = start;
      v.count = count;
      v.pinned = start + count >= n - 1;
      draw();
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  const pos = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, plotW: Math.max(1, rect.width - 76 - 10) };
  };

  const onMove = (e) => {
    const data = candlesRef.current || [];
    const p = pos(e);
    const v = viewRef.current;
    const slot = p.plotW / Math.max(1, v.count);
    const local = Math.floor((p.x - 10) / slot);
    const i = v.start + local;
    hoverRef.current = { x: p.x, y: p.y, i };
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const shift = Math.round(-dx / slot);
      const n = data.length;
      let start = dragRef.current.start + shift;
      start = Math.max(0, Math.min(start, Math.max(0, n - v.count)));
      v.start = start;
      v.pinned = start + v.count >= n - 1;
    }
    draw();
  };

  const onDown = (e) => {
    wrapRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, start: viewRef.current.start };
  };
  const onUp = () => {
    dragRef.current = null;
  };
  const onLeave = () => {
    hoverRef.current = null;
    dragRef.current = null;
    draw();
  };
  const onDbl = () => {
    const n = (candlesRef.current || []).length;
    const count = Math.min(140, n || 140);
    viewRef.current.start = Math.max(0, n - count);
    viewRef.current.count = count;
    viewRef.current.pinned = true;
    draw();
  };

  return (
    <div
      className="chartwrap"
      ref={wrapRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
      onDoubleClick={onDbl}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
