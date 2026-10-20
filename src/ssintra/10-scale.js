/* ── [STRATSIM-INTRA] 01 눈금 ──────────────────────────────────────────
   세로축: 로그(대칭 로그 — ±0.1% 안쪽은 직선, 바깥은 로그 → 0 근처 붐비는 구간은 넓게, 큰 날도 한 화면에)
          또는 직선(지금 보이는 날들의 범위를 보기 좋은 값으로 넓혀 약 8칸) · 가로축: 뉴욕 09:30~16:00 */

function siTickSpec(start, stop, count) {
  const step = (stop - start) / Math.max(0, count), power = Math.floor(Math.log10(step)), error = step / Math.pow(10, power);
  const factor = error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1;
  let i1, i2, inc;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc); i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc); i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return siTickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

// 보기 좋은 눈금 값 (start ≤ stop)
function siTicks(start, stop, count) {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const [i1, i2, inc] = siTickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const out = [];
  for (let i = 0; i <= i2 - i1; i++) out.push(inc < 0 ? (i1 + i) / -inc : (i1 + i) * inc);
  return out;
}

// 범위를 눈금 간격의 배수로 넓힘 (간격이 더 안 바뀔 때까지 · 끝내 안 맞으면 처음 범위 그대로)
function siNice(lo, hi, count) {
  let prestep, a = lo, b = hi;
  for (let iter = 0; iter < 10; iter++) {
    const step = siTickSpec(a, b, count)[2];
    if (step === prestep) return [a, b];
    if (step > 0) { a = Math.floor(a / step) * step; b = Math.ceil(b / step) * step; }
    else if (step < 0) { a = Math.ceil(a * step) / step; b = Math.floor(b * step) / step; }
    else break;
    prestep = step;
  }
  return [lo, hi];
}

// 세로 눈금: px = y(%), y.invert(px) = %
function siYScale(type, opt, h) {
  let tf, ti, d0, d1, ticks;
  if (type === 'log') {
    const c = SI_SYMLOG_C, lim = opt.limit;
    tf = (v) => Math.sign(v) * Math.log1p(Math.abs(v / c));
    ti = (t) => Math.sign(t) * Math.expm1(Math.abs(t)) * c;
    d0 = tf(-lim); d1 = tf(lim);
    ticks = [0];
    SI_PCT_LADDER.filter((t) => t >= c && t <= lim).forEach((t) => ticks.push(t, -t));
  } else {
    const [lo, hi] = siNice(Math.min(0, opt.lo), Math.max(0, opt.hi), 8);
    tf = ti = (v) => v;
    d0 = lo; d1 = hi;
    ticks = siTicks(lo, hi, 8);
  }
  const span = d1 - d0 || 1;
  const y = (v) => h - ((tf(v) - d0) / span) * h;
  y.invert = (py) => ti(d0 + ((h - py) / h) * span);
  y.ticks = ticks;
  return y;
}

function siXScale(w) {
  const x = (m) => ((m - SI_OPEN) / (SI_CLOSE - SI_OPEN)) * w;
  x.invert = (px) => SI_OPEN + (px / w) * (SI_CLOSE - SI_OPEN);
  return x;
}
