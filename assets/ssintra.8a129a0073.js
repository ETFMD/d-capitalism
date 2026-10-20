/* 자동 생성 — src/ssintra/*.js 를 이은 것 (scripts/build_pages.py [MOD]) · 직접 고치지 말고 src/ssintra/ 을 고칠 것 */
(function () {
'use strict';

/* ═══ 00-core.js ═══ */
/* ── [STRATSIM-INTRA] TQQQ 장중 흐름 · 00 기초 ─────────────────────────────
   자료 읽기 · 날마다 '전일 종가 대비 %' 경로 · 시각별 평균/중앙값 · 매수/매도 시각 · 비슷한 날 고르기 · 시간대
   계산 규칙은 원본(tqqq.networthcast.com 의 TQQQ intraday 화면)과 같은 숫자가 나오게 맞춤 — 코드는 새로 씀 (d3 없이)
   (빌드가 src/ssintra/*.js 를 파일 이름 순서로 이어 한 IIFE('use strict')로 묶음) */

const SI_OPEN = 9 * 60 + 30;        // 뉴욕 09:30 (분)
const SI_CLOSE = 16 * 60;           // 뉴욕 16:00
const SI_STEP = 5;                  // 평균·중앙값·비교 격자 = 5분
const SI_MARKET_TZ = 'America/New_York';
const SI_DAY_MIN = 24 * 60;
const SI_KEEP_SHARE = 0.08;         // 비슷한 날: 가장 가까운 8% (최소 1일)
const SI_RECENCY = 3;               // 비슷한 날 거리: 마지막 시각 가중치 = 첫 시각의 3배
const SI_METRIC_STEP = 0.1;         // 막대 필터 눈금 0.1%
const SI_METRIC_BINS = 30;
const SI_SYMLOG_C = 0.1;            // 로그 눈금: ±0.1% 안쪽은 직선
const SI_PCT_LADDER = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const SI_OPACITY = { min: 0.05, max: 0.35, k: 4 };

const SI_DATA = { m5: 'data/stratsim/intraday-5m.csv', m1: 'data/stratsim/intraday-1m.csv', upd: 'data/stratsim/intraday-updated.txt' };

// ── d3 과 같은 규칙의 작은 계산 도구 (null·NaN 은 건너뜀) ──
const siAsc = (a, b) => (a == null || b == null ? NaN : a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN);
const siAscDef = (a, b) => (a == null || !(a >= a)) - (b == null || !(b >= b)) || (a < b ? -1 : a > b ? 1 : 0);

function siMean(vals) {
  let n = 0, s = 0;
  for (let v of vals) if (v != null && (v = +v) >= v) { n++; s += v; }
  return n ? s / n : undefined;
}

// 중앙값 = 정렬했을 때 가운데 (짝수면 v0 + (v1 − v0) × 0.5 — 원본과 같은 식)
function siMedian(vals) {
  const a = Float64Array.from(vals.filter((v) => v != null && +v >= +v), Number);
  const n = a.length;
  if (!n) return undefined;
  if (n < 2) return a[0];
  a.sort();
  const i = (n - 1) * 0.5, i0 = Math.floor(i), v0 = a[i0], v1 = a[i0 + 1];
  return v0 + (v1 - v0) * (i - i0);
}

// 합 — 0·NaN 은 더하지 않음 (원본 계산과 같은 순서·같은 결과)
function siSum(arr, f) {
  let s = 0, i = -1;
  for (let v of arr) if ((v = +(f ? f(v, ++i, arr) : v))) s += v;
  return s;
}

function siMin(arr) { let m; for (const v of arr) if (v != null && (m === undefined ? v >= v : m > v)) m = v; return m; }
function siMax(arr) { let m; for (const v of arr) if (v != null && (m === undefined ? v >= v : m < v)) m = v; return m; }

// 가장 작은/큰 값을 가진 첫 원소
function siLeast(arr, f) {
  let best, bv, ok = false;
  for (const e of arr) { const v = f(e); if (ok ? siAsc(v, bv) < 0 : siAsc(v, v) === 0) { best = e; bv = v; ok = true; } }
  return best;
}
function siGreatest(arr, f) {
  let best, bv, ok = false;
  for (const e of arr) { const v = f(e); if (ok ? siAsc(v, bv) > 0 : siAsc(v, v) === 0) { best = e; bv = v; ok = true; } }
  return best;
}

// 안정 정렬 (키가 같으면 원래 순서, 값이 없거나 NaN 인 키는 맨 뒤)
function siSortBy(arr, f) {
  const k = arr.map(f), idx = arr.map((_, i) => i);
  idx.sort((i, j) => siAscDef(k[i], k[j]) || i - j);
  return idx.map((i) => arr[i]);
}

// 정렬된 배열에서 x 에 가장 가까운 위치 (한가운데면 뒤쪽)
function siBisectCenter(arr, x, f) {
  let lo = 0, hi = arr.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (f(arr[mid]) < x) lo = mid + 1; else hi = mid; }
  return lo > 0 && f(arr[lo - 1]) - x > -(f(arr[lo]) - x) ? lo - 1 : lo;
}

// ── 자료 ──
// CSV 한 줄 = 한 거래일: YYYYMMDD, 첫 봉 시가, 09:30 봉부터 봉마다 종가(빈칸 = 봉 없음)
// → [{date: 'YYYY-MM-DD', open, bars: [{minute: 봉이 끝나는 뉴욕 분, close}]}] 날짜순
// (봉의 '분'은 끝 시각: 09:30 에 시작한 5분봉 → 09:35, 09:34 에 시작한 1분봉도 09:35 — 두 해상도가 같은 격자를 씀)
function siParseCsv(text, barMin) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    const c0 = raw.charCodeAt(0);
    if (!(c0 >= 48 && c0 <= 57)) continue;
    const c = raw.replace(/\r$/, '').split(',');
    const d = c[0];
    const open = +c[1];
    if (d.length !== 8 || !(open > 0)) continue;
    const bars = [];
    for (let k = 2; k < c.length; k++) {
      if (c[k] === '') continue;
      const v = +c[k];
      if (v > 0) bars.push({ minute: SI_OPEN + (k - 1) * barMin, close: v });
    }
    if (bars.length) out.push({ date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), open, bars });
  }
  return siSortBy(out, (s) => s.date);
}

// 1분봉 파일(가장 최근 거래일)은 그날이 지금 장이 열린 날이거나 5분봉 기록에 아직 없는 날일 때만 그날 5분봉을 대신함
function siMergeToday(hist, today) {
  if (!today.length) return hist;
  const t = today[today.length - 1];
  const last = hist.length ? hist[hist.length - 1].date : '';
  if (t.date !== siMarketDateNow() && t.date <= last) return hist;
  return siSortBy(hist.filter((s) => s.date !== t.date).concat([t]), (s) => s.date);
}

// 날마다 경로: 모든 점 = 그 봉 종가의 '전 거래일 마지막 종가' 대비 % (시세 화면과 같은 기준)
// → 하루는 0 이 아니라 시가 갭에서 시작하고, 0% 선은 전날 종가. 첫 날은 전날이 없어 뺌
function siBuildDays(sessions) {
  const out = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1], day = sessions[i];
    const pc = prev.bars[prev.bars.length - 1].close;
    const pct = (price) => (price / pc - 1) * 100;
    const points = [{ minute: SI_OPEN, pct: pct(day.open) }].concat(day.bars.map((bar) => ({ minute: bar.minute, pct: pct(bar.close) })));
    const last = points[points.length - 1];
    out.push({ id: day.date, date: day.date, points, open: points[0].pct, close: last.pct, complete: last.minute === SI_CLOSE });
  }
  return out;
}

const siPointMap = (d) => d._m || (d._m = new Map(d.points.map((p) => [p.minute, p.pct])));

// 5분 격자의 시각마다 그날들의 % 평균·중앙값
function siAggregates(days) {
  const maps = days.map(siPointMap);
  const out = [];
  for (let minute = SI_OPEN; minute <= SI_CLOSE; minute += SI_STEP) {
    const vals = [];
    for (const m of maps) { const v = m.get(minute); if (v !== undefined) vals.push(v); }
    out.push({ minute, mean: siMean(vals), median: siMedian(vals), n: vals.length });
  }
  return out;
}

// 매수 = 평균(중앙값)이 가장 낮은 시각, 매도 = 가장 높은 시각 · 같은 종류가 같은 시각이면 한 표시로 합침
const SI_RULES = [
  { kind: 'buy', what: 'mean', pick: (a) => siLeast(a, (d) => d.mean) },
  { kind: 'buy', what: 'median', pick: (a) => siLeast(a, (d) => d.median) },
  { kind: 'sell', what: 'mean', pick: (a) => siGreatest(a, (d) => d.mean) },
  { kind: 'sell', what: 'median', pick: (a) => siGreatest(a, (d) => d.median) },
];
function siMarks(aggs) {
  const groups = new Map();
  for (const r of SI_RULES) {
    const agg = r.pick(aggs);
    if (!agg) continue;
    const key = r.kind + '@' + agg.minute;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { id: key, minute: agg.minute, kind: r.kind, anchor: r.what, agg, reasons: [] }));
    g.reasons.push({ what: r.what, value: agg[r.what] });
  }
  return siSortBy([...groups.values()], (g) => g.minute);
}

// 두 % 경로의 거리: 뒤쪽 시각일수록 무겁게(첫 시각 1 → 마지막 3) 잰 제곱 평균 거리의 제곱근
function siDistance(a, b) {
  const steps = a.length - 1, grow = SI_RECENCY - 1;
  let num = 0, den = 0;
  for (let i = 0; i <= steps; i++) {
    const w = 1 + (steps > 0 ? i / steps : 0) * grow;
    const term = +(w * (a[i] - b[i]) ** 2);
    if (term) num += term;   // 0·NaN 은 더하지 않음 (siSum 과 같은 규칙)
    if (w) den += w;
  }
  return Math.sqrt(num / den);
}

// 비슷한 날: 기준일(마지막 날, 장중이면 오늘 지금까지)의 시가~마지막 시각 경로와 같은 시각들로 비교해
// 가장 가까운 8%(최소 1일)만 남김 · 그 시각 중 하나라도 없는 날(기준보다 짧은 조기 폐장일 등)은 뺌
function siSimilar(days, ref) {
  const refMap = siPointMap(ref);
  const cutoff = ref.points[ref.points.length - 1].minute;
  const minutes = [];
  for (let m = SI_OPEN; m < cutoff + 1; m += SI_STEP) minutes.push(m);
  const refSeries = minutes.map((m) => refMap.get(m));
  const scored = [];
  for (const d of days) {
    if (d === ref) continue;
    const m = siPointMap(d);
    if (!minutes.every((x) => m.has(x))) continue;
    scored.push({ day: d, distance: siDistance(refSeries, minutes.map((x) => m.get(x))) });
  }
  const keep = Math.max(1, Math.round(scored.length * SI_KEEP_SHARE));
  const kept = siSortBy(scored, (s) => s.distance).slice(0, keep).map((s) => s.day);
  return { days: siSortBy([ref].concat(kept), (d) => d.date), cutoff };
}

// 선 진하기: 수백 일이면 5%, 열몇 일이면 35% (4 ÷ 날 수)
const siDayOpacity = (n) => Math.min(SI_OPACITY.max, Math.max(SI_OPACITY.min, SI_OPACITY.k / Math.max(1, n)));

// ── 시각 · 시간대 ──
const SI_LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })();

function siMinuteOfDay(tz, date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => +(parts.find((p) => p.type === t) || { value: 0 }).value;
  return (get('hour') % 24) * 60 + get('minute');
}

// 뉴욕 시각에 더하면 보는 사람의 시각이 되는 분 — 오늘 기준(양쪽 서머타임 규칙은 지금 것)
function siLocalOffset(now) {
  let diff = siMinuteOfDay(SI_LOCAL_TZ, now) - siMinuteOfDay(SI_MARKET_TZ, now);
  if (diff > SI_DAY_MIN / 2) diff -= SI_DAY_MIN;
  if (diff <= -SI_DAY_MIN / 2) diff += SI_DAY_MIN;
  return diff;
}

const siMarketDateNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: SI_MARKET_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// 지금 뉴욕 시각(분) — 평일 09:30~16:00 이 아니면 null (휴장일은 알 수 없어 열린 것으로 봄)
function siMarketMinuteNow() {
  const now = new Date();
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: SI_MARKET_TZ, weekday: 'short' }).format(now);
  if (wd === 'Sat' || wd === 'Sun') return null;
  const m = siMinuteOfDay(SI_MARKET_TZ, now);
  return m >= SI_OPEN && m <= SI_CLOSE ? m : null;
}

const siIsLive = (day) => !!day && siMarketMinuteNow() !== null && day.date === siMarketDateNow();

// 시간대 이름 (한국어): 서울이면 '한국 시간', 뉴욕이면 '뉴욕 시간', 그 밖은 'GMT+1' 같은 줄임
function siZoneLabel() {
  if (SI_LOCAL_TZ === 'Asia/Seoul') return '한국 시간';
  if (SI_LOCAL_TZ === SI_MARKET_TZ) return '뉴욕 시간';
  for (const style of ['shortOffset', 'short']) {      // 'GMT+1' 같은 꼴 (옛 브라우저는 'PDT' 같은 줄임)
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: SI_LOCAL_TZ, timeZoneName: style }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      if (p) return '내 시간대 ' + p.value;
    } catch (e) { /* 다음 방식 */ }
  }
  return '내 시간대';
}

// ── 서식 ──
const siFmtPct = (v, dec = 2) => (v > 0 ? '+' : '') + v.toFixed(dec) + '%';
const siFmtAxisPct = (v) => (v > 0 ? '+' : '') + parseFloat(v.toFixed(2)) + '%';
const siFmtClock = (m) => { const w = ((m % SI_DAY_MIN) + SI_DAY_MIN) % SI_DAY_MIN; return Math.floor(w / 60) + ':' + String(w % 60).padStart(2, '0'); };
const SI_WD = ['일', '월', '화', '수', '목', '금', '토'];
const siFmtDate = (iso) => iso.slice(0, 4) + '.' + iso.slice(5, 7) + '.' + iso.slice(8, 10);
const siWeekday = (iso) => SI_WD[new Date(iso + 'T12:00:00Z').getUTCDay()];
const siEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const siTone = (v) => (v > 0 ? 'up' : v < 0 ? 'dn' : '');

/* ═══ 10-scale.js ═══ */
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

/* ═══ 20-chart.js ═══ */
/* ── [STRATSIM-INTRA] 02 차트 (SVG) ─────────────────────────────────────
   날마다 경로(옅은 선 다발) · 평균(실선)·중앙값(점선) · 비슷한 날 비교 구간 · 지금 시각 · 매수/매도 표시 · 오늘(장중) 경로
   모든 시각은 뉴욕 '분'으로 계산하고, 글자로 보여 줄 때만 보는 사람 시간대로 옮김 (SC.offset) */

const SI_NS = 'http://www.w3.org/2000/svg';
const SC = {
  box: null, svg: null, g: {}, target: null,
  w: 0, h: 0, m: null, pw: 0, ph: 0, compact: false, x: null, y: null,
  yType: 'log', yLimit: 0,              // yLimit: 로그 눈금의 ±범위 — 모든 날로 한 번 정하고 줄이지 않음 (거르기로 축이 바뀌지 않게)
  data: [], aggs: [], marks: [], refId: null, cutoff: null, todayId: null, opacityCount: null,
  offset: 0, zone: '', lineLabelYs: [], paths: new Map(), geomKey: '', todayDrawn: false,
};

function siEl(tag, attrs, parent) {
  const e = document.createElementNS(SI_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const siClear = (g) => { while (g.firstChild) g.removeChild(g.firstChild); };
const siReduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const siR = (v) => Math.round(v * 10) / 10;

let siMeasureCtx = null;
function siTextW(text, px, mono, bold) {
  if (!siMeasureCtx) siMeasureCtx = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const fam = (mono ? cs.getPropertyValue('--mono') : cs.getPropertyValue('--font')) || 'sans-serif';
  siMeasureCtx.font = (bold ? '600 ' : '400 ') + px + 'px ' + fam;
  return siMeasureCtx.measureText(text).width;
}

function siChartInit(box) {
  SC.box = box;
  SC.svg = siEl('svg', { class: 'ssi-svg', role: 'img', 'aria-labelledby': 'ssi-svg-t' }, box);
  siEl('title', { id: 'ssi-svg-t' }, SC.svg);
  const plot = (SC.g.plot = siEl('g', { class: 'ssi-plot' }, SC.svg));
  ['grid', 'xaxis', 'yaxis', 'zero', 'match', 'days', 'hday', 'aggs', 'now', 'annot', 'today', 'hover'].forEach((k) => {
    SC.g[k] = siEl('g', { class: 'ssi-' + k }, plot);
  });
  SC.target = siEl('rect', { class: 'ssi-target', fill: 'transparent' }, plot);
}

function siLayout() {
  const w = Math.max(200, Math.floor(SC.box.clientWidth));
  const compact = w < 640;
  const m = compact ? { t: 10, r: 46, b: 28, l: 44 } : { t: 10, r: 108, b: 30, l: 52 };
  const vh = window.innerHeight || 800;
  const h = compact ? 440 : Math.round(Math.max(440, Math.min(640, vh - 330)));
  SC.w = w; SC.h = h; SC.m = m; SC.compact = compact;
  SC.pw = w - m.l - m.r; SC.ph = h - m.t - m.b;
  SC.svg.setAttribute('width', w); SC.svg.setAttribute('height', h);
  SC.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  SC.svg.classList.toggle('compact', compact);
  SC.g.plot.setAttribute('transform', `translate(${m.l},${m.t})`);
}

function siPathD(points, yv) {
  const x = SC.x, y = SC.y;
  let d = '', pen = false;
  for (const p of points) {
    const v = yv ? yv(p) : p.pct;
    if (v == null || !(v >= v)) { pen = false; continue; }
    d += (pen ? 'L' : 'M') + siR(x(p.minute)) + ',' + siR(y(v));
    pen = true;
  }
  return d;
}

function siRender() {
  if (!SC.svg) return;
  siLayout();
  const live = siIsLive(SC.data.find((d) => d.id === SC.todayId));
  SC.live = live;
  SC.x = siXScale(SC.pw);
  if (SC.yType === 'log') SC.y = siYScale('log', { limit: SC.yLimit }, SC.ph);
  else {
    let lo = Infinity, hi = -Infinity;
    for (const d of SC.data) for (const p of d.points) { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct; }
    if (!(lo <= hi)) lo = hi = 0;
    SC.y = siYScale('linear', { lo, hi }, SC.ph);
  }
  const key = [SC.pw, SC.ph, SC.yType, SC.y(0), SC.y.ticks.join()].join('|');
  if (key !== SC.geomKey) { SC.geomKey = key; SC.paths.forEach((p) => { p.dKey = ''; }); }
  siDrawAxes();
  siDrawDays(live);
  siDrawAggs();
  siDrawNow();
  siTodayLabelPlace(live);
  siDrawMarks(live);
  siDrawToday(live);
  siHoverReset();
  SC.target.setAttribute('width', Math.max(0, SC.pw));
  SC.target.setAttribute('height', Math.max(0, SC.ph));
  siAriaSummary();
}

function siDrawAxes() {
  const { x, y, pw, ph, offset } = SC;
  const g = SC.g.grid, gx = SC.g.xaxis, gy = SC.g.yaxis, gz = SC.g.zero;
  [g, gx, gy, gz].forEach(siClear);
  for (const t of y.ticks) {
    const py = siR(y(t));
    siEl('line', { x1: 0, x2: pw, y1: py, y2: py }, g);
    const tx = siEl('text', { x: -8, y: py, dy: '0.32em', 'text-anchor': 'end' }, gy);
    tx.textContent = siFmtAxisPct(t);
    siEl('line', { class: 'tick', x1: -5, x2: 0, y1: py, y2: py }, gy);
  }
  siEl('line', { class: 'dom', x1: 0, x2: 0, y1: 0, y2: ph }, gy);
  // 가로 눈금: 장 시작·마감 + 보는 사람 시각으로 딱 떨어지는 정시 · 글자가 겹치면 시작·마감을 남기고 사이 것을 뺌
  const hours = [];
  for (let m = SI_OPEN + 1; m < SI_CLOSE; m++) if ((((m + offset) % 60) + 60) % 60 === 0) hours.push(m);
  const ticks = [SI_OPEN].concat(hours, [SI_CLOSE]);
  siEl('line', { class: 'dom', x1: 0, x2: pw, y1: ph, y2: ph }, gx);
  const fs = SC.compact ? 10 : 11, room = (t) => siTextW(siFmtClock(t + offset), fs, true) + 8;
  const shown = new Set([SI_OPEN, SI_CLOSE]);
  let lastRight = x(SI_OPEN) + room(SI_OPEN) / 2;
  const endLeft = x(SI_CLOSE) - room(SI_CLOSE) / 2;
  for (const m of hours) {
    const half = room(m) / 2, px = x(m);
    if (px - half >= lastRight && px + half <= endLeft) { shown.add(m); lastRight = px + half; }
  }
  for (const m of ticks) {
    const px = siR(x(m));
    siEl('line', { class: 'tick', x1: px, x2: px, y1: ph, y2: ph + 5 }, gx);
    if (!shown.has(m)) continue;
    const tx = siEl('text', { x: px, y: ph + 8, dy: '0.71em', 'text-anchor': 'middle' }, gx);
    tx.textContent = siFmtClock(m + offset);
  }
  const pz = siR(y(0));
  siEl('line', { x1: 0, x2: pw, y1: pz, y2: pz }, gz);
}

function siDrawDays(live) {
  const { data, x, ph } = SC;
  const gm = SC.g.match;
  siClear(gm);
  if (SC.cutoff !== null) siEl('rect', { class: 'ssi-window', x: 0, y: 0, width: Math.max(0, siR(x(SC.cutoff))), height: ph }, gm);
  const faint = live ? data.filter((d) => d.id !== SC.todayId) : data;
  const op = siDayOpacity(SC.opacityCount != null ? SC.opacityCount : faint.length);
  SC.dayOpacity = op;
  const g = SC.g.days, keep = new Set();
  const frag = document.createDocumentFragment();
  for (const d of faint) {
    let p = SC.paths.get(d.id);
    if (!p || p.day !== d) {
      if (p && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      p = { el: siEl('path', { class: 'ssi-day' }), day: d, dKey: '' };
      SC.paths.set(d.id, p);
    }
    if (p.dKey !== SC.geomKey) { p.el.setAttribute('d', siPathD(d.points)); p.dKey = SC.geomKey; }
    const ref = live && d.id === SC.refId;
    p.el.setAttribute('class', ref ? 'ssi-day ref' : 'ssi-day');
    p.el.style.opacity = ref ? 1 : op;
    keep.add(d.id);
    frag.appendChild(p.el);
  }
  siClear(g);
  g.appendChild(frag);
  if (SC.paths.size > keep.size * 2 + 64) SC.paths.forEach((p, id) => { if (!keep.has(id)) SC.paths.delete(id); });
}

function siDrawAggs() {
  const { aggs, x, y } = SC;
  const g = SC.g.aggs;
  siClear(g);
  SC.lineLabelYs = [];
  if (!aggs.length) return;
  siEl('path', { class: 'ssi-median', d: siPathD(aggs, (a) => a.median) }, g);
  siEl('path', { class: 'ssi-mean', d: siPathD(aggs, (a) => a.mean) }, g);
  // 선 이름은 범례 대신 오른쪽 끝에 — 둘이 너무 가까우면 벌림
  const lastOf = (k) => { for (let i = aggs.length - 1; i >= 0; i--) if (aggs[i][k] != null) return aggs[i]; return null; };
  const lm = lastOf('mean'), ld = lastOf('median');
  if (!lm || !ld) return;
  const labels = [{ k: 'mean', t: '평균', y: y(lm.mean), x: x(lm.minute) }, { k: 'median', t: '중앙값', y: y(ld.median), x: x(ld.minute) }];
  const gap = labels[0].y - labels[1].y, MIN = 13;
  if (Math.abs(gap) < MIN) {
    const push = (MIN - Math.abs(gap)) / 2;
    labels[0].y += gap >= 0 ? push : -push;
    labels[1].y += gap >= 0 ? -push : push;
  }
  for (const l of labels) {
    const t = siEl('text', { class: 'ssi-lname ' + l.k, x: siR(l.x + 6), y: siR(l.y), dy: '0.35em' }, g);
    t.textContent = l.t;
  }
  SC.lineLabelYs = labels.map((l) => l.y);
}

// 지금 시각: 맨 위 짧은 눈금 (장이 열린 평일에만) — 30초마다 다시 그림
function siDrawNow() {
  const g = SC.g.now;
  if (!g) return;
  siClear(g);
  SC.nowBox = null;
  const minute = siMarketMinuteNow();
  if (minute === null || !SC.x) return;
  const px = siR(SC.x(minute)), near = px > SC.x(SI_CLOSE) - (SC.compact ? 70 : 120);
  siEl('line', { class: 'ssi-nowline', x1: px, x2: px, y1: 0, y2: siR(SC.ph * 0.05) }, g);
  const t = siEl('text', { class: 'ssi-nowlabel', x: px + (near ? -6 : 6), y: 12, 'text-anchor': near ? 'end' : 'start' }, g);
  t.textContent = '지금 ' + siFmtClock(minute + SC.offset) + (SC.compact ? '' : ' · ' + SC.zone);
  const w = siTextW(t.textContent, 10.5);
  SC.nowBox = { l: near ? px - 6 - w : px, r: near ? px : px + 6 + w, t: 0, b: 16 };     // 매수·매도 상자가 피해 갈 자리
}

// 오늘(장중) 경로: 맨 위 층에 굵게 · 처음 그릴 때 그어지듯 나타남 · 마지막 점에서 맥박 (움직임 줄이기 설정이면 멈춤)
function siDrawToday(live) {
  const g = SC.g.today;
  siClear(g);
  if (!live) return;
  const today = SC.data.find((d) => d.id === SC.todayId);
  const pts = today.points, d = siPathD(pts);
  siEl('path', { class: 'ssi-tglow', d }, g);
  const path = siEl('path', { class: 'ssi-tpath', d }, g);
  if (!SC.todayDrawn && !siReduced() && path.getTotalLength) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len + ' ' + len;
    path.style.strokeDashoffset = len;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset .9s cubic-bezier(.33,1,.68,1)';
    path.style.strokeDashoffset = '0';
    path.addEventListener('transitionend', () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; path.style.transition = ''; }, { once: true });
  }
  SC.todayDrawn = true;
  const last = pts[pts.length - 1], cx = siR(SC.x(last.minute)), cy = siR(SC.y(last.pct));
  const rings = siEl('g', { class: 'ssi-rings', transform: `translate(${cx},${cy})` }, g);
  siEl('circle', { class: 'ssi-ring', r: 5 }, rings);
  siEl('circle', { class: 'ssi-ring second', r: 5 }, rings);
  siEl('circle', { class: 'ssi-tdot', cx, cy, r: 4 }, g);
  const L = SC.todayLabel;
  const t = siEl('text', { class: 'ssi-tlabel', x: siR(L.x), y: siR(L.y), 'text-anchor': L.anchor }, g);
  t.appendChild(document.createTextNode('오늘 '));
  const s = siEl('tspan', { class: siTone(last.pct) }, t);
  s.textContent = siFmtPct(last.pct);
}

// 오늘 값 이름표 자리: 점의 오른쪽 아래 → 오른쪽 위 → 왼쪽 아래 → 왼쪽 위 (오른쪽 끝에 가까우면 왼쪽부터)
// 오늘 선·평균선·중앙값 선을 가리지 않고 그림 안에 드는 첫 자리 → 없으면 오늘 선만 피하는 자리 → 그것도 없으면 첫 자리
function siTodayLabelPlace(live) {
  SC.todayLabel = null;
  if (!live) return;
  const pts = SC.data.find((d) => d.id === SC.todayId).points, last = pts[pts.length - 1];
  const cx = SC.x(last.minute), cy = SC.y(last.pct);
  const w = siTextW('오늘 ', 11, false, true) + siTextW(siFmtPct(last.pct), 11, true, true);
  const poly = (arr, f) => arr.filter((a) => f(a) != null).map((a) => ({ x: SC.x(a.minute), y: SC.y(f(a)) }));
  const todayLine = poly(pts, (p) => p.pct), aggLines = [poly(SC.aggs, (a) => a.mean), poly(SC.aggs, (a) => a.median)];
  const hits = (box, pl) => pl.some((p, i) => i > 0 && siLineHitsBox(pl[i - 1], p, box));
  const cand = [[1, 18], [1, -10], [-1, 18], [-1, -10]];
  if (cx > SC.pw - 110) cand.push(...cand.splice(0, 2));
  const opts = cand.map(([dir, dy]) => {
    const x = cx + dir * 10, l = dir > 0 ? x : x - w;
    return { x, y: cy + dy, anchor: dir > 0 ? 'start' : 'end', box: { l, r: l + w, t: cy + dy - 11, b: cy + dy + 3 } };
  });
  const inside = (b) => b.l >= 0 && b.r <= SC.pw && b.t >= 0 && b.b <= SC.ph;
  SC.todayLabel = opts.find((o) => inside(o.box) && !hits(o.box, todayLine) && !aggLines.some((pl) => hits(o.box, pl)))
    || opts.find((o) => inside(o.box) && !hits(o.box, todayLine)) || opts[0];
}

function siAriaSummary() {
  const t = SC.svg.querySelector('title');
  if (!t) return;
  const n = SC.data.length;
  if (!n) { t.textContent = 'TQQQ 장중 경로 — 조건에 맞는 날이 없음'; return; }
  const parts = SC.marks.map((p) => (p.kind === 'buy' ? '매수 ' : '매도 ') + siFmtClock(p.minute + SC.offset) + ' (' + p.reasons.map((r) => (r.what === 'mean' ? '평균 ' : '중앙값 ') + siFmtPct(r.value)).join(', ') + ')');
  t.textContent = `TQQQ 장중 경로 ${n}일 겹쳐 보기 (${SC.zone}) — ` + parts.join(' · ');
}

/* ═══ 30-marks.js ═══ */
/* ── [STRATSIM-INTRA] 03 매수·매도 표시 ──────────────────────────────────
   평균(중앙값)이 가장 낮은 시각 = 매수, 가장 높은 시각 = 매도 — 점 + 꺾인 연결선 + 글 상자
   상자 자리: 매수는 선 아래, 매도는 선 위를 먼저 · 가까운 층부터 차례로 따져 서로 겹치지 않고, 그림 안에 있고,
   장중 오늘 선을 가리지 않는 자리를 한꺼번에 찾음 (막히면 앞 상자 자리를 바꿔 다시 · 끝내 없으면 조건을 하나씩 풀어 고름) */

const SIA = { padX: 6, padY: 5, titleH: 14, lineH: 13, clear: 6, lead: 14, gutter: 30, step: 44, levels: 4, keep: 24, budget: 20000 };

// 두 구간 [a0, a1]·[b0, b1] 이 여유 c 안으로 겹치는지 → 가로·세로 둘 다 겹치면 닿음
const siSpanHit = (a0, a1, b0, b1, c) => a0 < b1 + c && b0 - c < a1;
// 축에 나란한 선분 {x1,x2,y1,y2} 또는 상자 {l,r,t,b} 가 다른 상자(여백 c 포함)에 닿는지
const siSegHitsBox = (s, b, c) => siSpanHit(s.x1, s.x2, b.l, b.r, c) && siSpanHit(s.y1, s.y2, b.t, b.b, c);
const siBoxHit = (a, b, c) => siSpanHit(a.l, a.r, b.l, b.r, c) && siSpanHit(a.t, a.b, b.t, b.b, c);

// 임의 선분 a→b 가 상자를 지나는지: 선분 위 점을 t(0~1)로 놓고, 가로·세로 각각 상자 안에 드는 t 범위를 좁혀 남는 게 있으면 지남
function siLineHitsBox(a, b, box) {
  let lo = 0, hi = 1;
  const within = (p0, d, min, max) => {
    if (d === 0) return min <= p0 && p0 <= max;   // 그 축으로 움직이지 않음 — 처음부터 안에 있어야
    const ta = (min - p0) / d, tb = (max - p0) / d;
    lo = Math.max(lo, Math.min(ta, tb)); hi = Math.min(hi, Math.max(ta, tb));
    return lo <= hi;
  };
  return within(a.x, b.x - a.x, box.l, box.r) && within(a.y, b.y - a.y, box.t, box.b);
}

function siMarkText(p) {
  const title = (p.kind === 'buy' ? '매수 ' : '매도 ') + siFmtClock(p.minute + SC.offset);
  const lines = p.reasons.map((r) => ({ name: r.what === 'mean' ? '평균 ' : '중앙값 ', value: siFmtPct(r.value) }));
  let w = siTextW(title, 11, false, true);
  for (const l of lines) w = Math.max(w, siTextW(l.name, 10.5) + siTextW(l.value, 10.5, true));
  return { title, lines, w: Math.ceil(w) + SIA.padX * 2, h: SIA.padY * 2 + SIA.titleH + lines.length * SIA.lineH };
}

function siMarkCandidates(p, pw, extraLefts) {
  const { w: W, h: H } = p.box0, px = p.px, py = p.py, s0 = p.kind === 'buy' ? 1 : -1;
  const pref = px + SIA.lead + W <= pw ? px + SIA.lead : px - SIA.lead - W;
  const lefts = [pref, px - SIA.lead - W, px + SIA.lead, px - W / 2, Math.max(0, Math.min(pw - W, px - W / 2))].concat(extraLefts || []);
  for (let k = 1; k <= 3; k++) lefts.push(px + SIA.lead + k * (W + SIA.clear), px - SIA.lead - W - k * (W + SIA.clear));
  const uniq = [...new Set(lefts.map((l) => Math.round(l)))].filter((l) => l >= 0 && l + W <= pw);
  const out = [];
  for (const sign of [s0, -s0]) {
    for (let L = 0; L < SIA.levels; L++) {
      const gy = py + sign * (SIA.gutter + L * SIA.step);
      const top = sign > 0 ? gy : gy - H;
      for (const left of uniq) {
        const box = { l: left, r: left + W, t: top, b: top + H };
        const segs = [{ x1: px, x2: px, y1: Math.min(py, gy), y2: Math.max(py, gy) }];
        let path = `M${siR(px)},${siR(py)}V${siR(gy)}`;
        if (px < box.l) { segs.push({ x1: px, x2: box.l, y1: gy, y2: gy }); path += `H${siR(box.l)}`; }
        else if (px > box.r) { segs.push({ x1: box.r, x2: px, y1: gy, y2: gy }); path += `H${siR(box.r)}`; }
        out.push({ box, segs, path, cost: L * SIA.step + Math.abs(left - pref) * 0.5 + (sign === s0 ? 0 : 2 * SIA.step) });
      }
    }
  }
  for (const dir of [1, -1]) {      // 점 바로 옆 (가로 연결선만)
    const left = dir > 0 ? px + SIA.lead : px - SIA.lead - W;
    const box = { l: left, r: left + W, t: py - H / 2, b: py + H / 2 };
    const ex = dir > 0 ? left : left + W;
    out.push({ box, segs: [{ x1: Math.min(px, ex), x2: Math.max(px, ex), y1: py, y2: py }], path: `M${siR(px)},${siR(py)}H${siR(ex)}`, cost: 1.5 * SIA.step + (dir > 0 ? 0 : W) });
  }
  return out.map((c, i) => ({ c, i })).sort((a, b) => a.c.cost - b.c.cost || a.i - b.i).map((o) => o.c);
}

function siLayoutMarks(points, pw, ph, lineHit, fixed) {
  const C = SIA.clear;
  const inside = (g) => g.box.t >= 0 && g.box.b <= ph && g.box.l >= 0 && g.box.r <= pw;
  const dotsClear = (g) => points.every((q) => !siBoxHit(g.box, { l: q.px - 5, r: q.px + 5, t: q.py - 5, b: q.py + 5 }, 2));
  // fixed: 이미 자리가 정해진 글자(오늘 값 이름표 · '지금' 표시) — 상자도 연결선도 가리지 않게
  const fixedClear = (g) => fixed.every((o) => !siBoxHit(g.box, o, C) && g.segs.every((s) => !siSegHitsBox(s, o, 2)));
  const clearOf = (g, others) => others.every((o) => !siBoxHit(g.box, o.box, C)
    && g.segs.every((s) => !siSegHitsBox(s, o.box, C)) && o.segs.every((s) => !siSegHitsBox(s, g.box, C)));
  const ok = (g) => inside(g) && dotsClear(g) && !lineHit(g.box) && fixedClear(g);
  const valid = points.map((p) => siMarkCandidates(p, pw).filter(ok).slice(0, SIA.keep));
  // 1) 모든 표시를 한꺼번에: 앞 표시부터 후보를 차례로 놓아 보고, 막히면 앞 표시로 돌아가 다음 후보로 (후보를 볼 때마다 1씩, SIA.budget 번까지)
  const n = points.length, at = new Array(n).fill(-1), chosen = [];
  let left = SIA.budget, lvl = 0, failed = false;
  while (lvl < n && !failed) {
    let k = at[lvl] + 1;
    for (; k < valid[lvl].length; k++) {
      if (--left < 0) { failed = true; break; }
      if (clearOf(valid[lvl][k], chosen)) break;
    }
    if (failed) break;
    if (k < valid[lvl].length) { at[lvl] = k; chosen.push(valid[lvl][k]); lvl++; continue; }
    at[lvl] = -1;                    // 이 표시는 둘 곳이 없음 → 앞 표시를 다음 후보로
    if (--lvl < 0) failed = true; else chosen.pop();
  }
  if (!failed) return chosen;
  // 2) 못 찾으면 하나씩: 모든 조건 → 그림 안·서로 안 겹침 → 그림 안 → 첫 후보 순으로 풀어 가며
  const placed = [];
  for (const p of points) {
    const all = siMarkCandidates(p, pw, placed.map((o) => o.box.r + C));
    const tiers = [(g) => ok(g) && clearOf(g, placed), (g) => inside(g) && clearOf(g, placed), inside];
    let pick = null;
    for (const t of tiers) { pick = all.find(t); if (pick) break; }
    placed.push(pick || all[0]);
  }
  return placed;
}

// 장중 오늘 선(그려져 있을 때)을 상자가 가리는지
function siTodayHitTest(live) {
  if (!live) return () => false;
  const day = SC.data.find((d) => d.id === SC.todayId);
  if (!day) return () => false;
  const pts = day.points.map((p) => ({ x: SC.x(p.minute), y: SC.y(p.pct) })), P = 8;
  return (b) => {
    const box = { l: b.l - P, r: b.r + P, t: b.t - P, b: b.b + P };
    for (let i = 1; i < pts.length; i++) if (siLineHitsBox(pts[i - 1], pts[i], box)) return true;
    return false;
  };
}

function siDrawMarks(live) {
  const g = SC.g.annot;
  siClear(g);
  if (!SC.marks.length) return;
  const points = SC.marks.map((p) => {
    const v = p.agg[p.anchor];
    const q = { ...p, px: SC.x(p.minute), py: SC.y(v) };
    q.box0 = siMarkText(q);
    return q;
  });
  const fixed = [SC.todayLabel && SC.todayLabel.box, SC.nowBox].filter(Boolean);
  const placed = siLayoutMarks(points, SC.pw, SC.ph, siTodayHitTest(live), fixed);
  points.forEach((p, i) => {
    const pl = placed[i], b = pl.box;
    const mg = siEl('g', { class: 'ssi-mark ' + p.kind }, g);
    siEl('path', { class: 'ssi-mline', d: pl.path }, mg);
    siEl('circle', { class: 'ssi-mdot', cx: siR(p.px), cy: siR(p.py), r: 5 }, mg);
    siEl('rect', { class: 'ssi-mbox', x: siR(b.l), y: siR(b.t), width: siR(b.r - b.l), height: siR(b.b - b.t), rx: 5 }, mg);
    const tt = siEl('text', { class: 'ssi-mtitle', x: siR(b.l + SIA.padX), y: siR(b.t + SIA.padY + 11) }, mg);
    tt.textContent = p.box0.title;
    p.box0.lines.forEach((l, k) => {
      const t = siEl('text', { class: 'ssi-mtext', x: siR(b.l + SIA.padX), y: siR(b.t + SIA.padY + SIA.titleH + (k + 1) * SIA.lineH - 2) }, mg);
      t.appendChild(document.createTextNode(l.name));
      siEl('tspan', { class: 'num' }, t).textContent = l.value;
    });
  });
}

/* ═══ 40-hover.js ═══ */
/* ── [STRATSIM-INTRA] 04 마우스·탭으로 보기 ──────────────────────────────
   그림 위 아무 곳: 가장 가까운 5분 시각에 세로선 · 그 시각 커서와 가장 가까운 날을 강조 · 평균/중앙값/그날 값 · 그날 날짜·종가
   마우스는 올리기만 하면, 손가락은 탭(옆으로 끌면 따라감) — 다른 곳을 누르거나 × 를 누르면 닫힘 */

const SH = { active: false, pinned: false, down: false, onInfo: null, keep: null };

function siHoverInit() {
  const t = SC.target;
  const pos = (e) => {
    const r = SC.svg.getBoundingClientRect();
    return [e.clientX - r.left - SC.m.l, e.clientY - r.top - SC.m.t];
  };
  t.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || SH.down) siHoverAt(...pos(e));
  });
  t.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    SH.down = true; SH.pinned = true;
    siHoverAt(...pos(e));
  });
  const up = () => { SH.down = false; };
  t.addEventListener('pointerup', up);
  t.addEventListener('pointercancel', up);
  t.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !SH.pinned) siHoverHide(); });
  document.addEventListener('pointerdown', (e) => {
    if (SH.pinned && e.target !== t && !(SH.keep && SH.keep.contains(e.target))) siHoverHide();
  }, true);
}

function siHoverHide() {
  SH.active = false; SH.pinned = false;
  if (SC.svg) SC.svg.classList.remove('hovering');
  if (SC.g.hover) siClear(SC.g.hover);
  if (SC.g.hday) siClear(SC.g.hday);
  if (SH.onInfo) SH.onInfo(null);
}
const siHoverReset = siHoverHide;

function siHoverAt(px, py) {
  const { data, aggs, x, y, pw, ph } = SC;
  if (!data.length || !aggs.length) return;
  px = Math.max(0, Math.min(pw, px));
  py = Math.max(0, Math.min(ph, py));
  const agg = aggs[siBisectCenter(aggs, x.invert(px), (a) => a.minute)];
  const cursor = y.invert(py);
  const at = (d) => d.points[siBisectCenter(d.points, agg.minute, (p) => p.minute)];
  const nearest = siLeast(data, (d) => { const p = at(d); return p.minute === agg.minute ? Math.abs(p.pct - cursor) : Infinity; });
  const dayPct = at(nearest).pct;
  SH.active = true;
  SC.svg.classList.add('hovering');          // 보는 동안 매수·매도 상자는 옅게 (값 글자가 잘 보이게)
  const g = SC.g.hover;
  siClear(g);
  const hx = siR(x(agg.minute));
  siEl('line', { class: 'ssi-hrule', x1: hx, x2: hx, y1: 0, y2: ph }, g);

  // 가리킨 날: 맨 위에 진하게 (장중 오늘은 이미 맨 위라 그대로)
  const hd = SC.g.hday;
  siClear(hd);
  const isToday = SC.live && nearest.id === SC.todayId;
  if (!isToday) siEl('path', { class: 'ssi-day hover', d: siPathD(nearest.points) }, hd);

  // 시각 칩 (가로축 위)
  const tText = siFmtClock(agg.minute + SC.offset);
  const cw = siTextW(tText, 10.5, true) + 12, chH = 16;
  const cx = Math.max(cw / 2, Math.min(pw - cw / 2, hx));
  const chip = siEl('g', { class: 'ssi-hchip', transform: `translate(${siR(cx)},${siR(ph + 10)})` }, g);
  siEl('rect', { x: siR(-cw / 2), y: -chH / 2, width: siR(cw), height: chH, rx: 4 }, chip);
  siEl('text', { y: 0, dy: '0.35em', 'text-anchor': 'middle' }, chip).textContent = tText;

  // 세로선이 평균·중앙값·그날 선과 만나는 값 — 겹치면 위아래로 벌림
  const cross = [
    { k: 'mean', name: '평균 ', v: agg.mean },
    { k: 'median', name: '중앙값 ', v: agg.median },
    { k: 'day', name: '', v: dayPct },
  ].filter((c) => c.v != null).map((c) => ({ ...c, y: y(c.v) }));
  const ord = siSortBy(cross, (c) => c.y);
  ord.forEach((c) => { c.ly = c.y; });
  for (let i = 1; i < ord.length; i++) ord[i].ly = Math.max(ord[i].ly, ord[i - 1].ly + 14);
  for (let i = ord.length - 2; i >= 0; i--) ord[i].ly = Math.min(ord[i].ly, ord[i + 1].ly - 14);
  const onRight = hx > pw - (SC.compact ? 110 : 150);
  for (const c of cross) {
    const cg = siEl('g', { class: 'ssi-hx ' + c.k }, g);
    siEl('circle', { cx: hx, cy: siR(c.y), r: 3.5 }, cg);
    const t = siEl('text', { x: hx + (onRight ? -9 : 9), y: siR(c.ly), dy: '0.35em', 'text-anchor': onRight ? 'end' : 'start' }, cg);
    if (c.name) t.appendChild(document.createTextNode(c.name));
    siEl('tspan', { class: 'num' }, t).textContent = siFmtPct(c.v);
  }

  // 그날 끝: 오른쪽 여백에 날짜와 종가(전일 종가 대비) — 평균·중앙값 이름과 겹치면 위아래로 옮김 (좁은 화면은 위 안내줄에)
  const last = nearest.points[nearest.points.length - 1];
  if (!SC.compact) {
    const ey = y(last.pct), H = 26;
    const clearOfNames = (cy) => SC.lineLabelYs.every((ly) => Math.abs(cy - ly) > 20);
    const inPlot = (cy) => cy - H / 2 >= 0 && cy + H / 2 <= ph;
    const endY = [ey, ey - H, ey + H, ey - 2 * H, ey + 2 * H].find((cy) => inPlot(cy) && clearOfNames(cy));
    const yy = siR(endY === undefined ? ey : endY), xx = siR(pw + 6);
    const t = siEl('text', { class: 'ssi-hend', x: xx, y: yy }, g);
    siEl('tspan', { x: xx, dy: '-0.35em' }, t).textContent = siFmtDate(nearest.date) + ' (' + siWeekday(nearest.date) + ')';
    siEl('tspan', { x: xx, dy: '1.2em', class: 'dim' }, t).textContent = '종가 ' + siFmtPct(last.pct);
  }
  if (SH.onInfo) SH.onInfo({ day: nearest, minute: agg.minute, dayPct, close: last.pct, agg, today: isToday });
}

/* ═══ 50-controls.js ═══ */
/* ── [STRATSIM-INTRA] 05 조절 장치 ───────────────────────────────────────
   시가·종가 막대 필터(끌어서 범위 고르기) · 기간 막대(두 손잡이) · 비슷한 날만 · 로그/직선 눈금
   고른 값은 이 브라우저에 저장 — 끝에 닿은 손잡이는 'edge' 로 저장해 새 자료가 붙어도 끝을 따라감 */

const SI_KEYS = { period: 'ssi-period', similar: 'ssi-similar', log: 'ssi-log', metric: (k) => 'ssi-metric-' + k };
const SI_MEM = {};       // 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서도 이 화면이 열려 있는 동안은 기억
const siStore = {
  get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) { /* 저장소 없음 */ } return k in SI_MEM ? SI_MEM[k] : null; },
  set(k, v) { SI_MEM[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } },
  json(k) { try { return JSON.parse(this.get(k)) || {}; } catch (e) { return {}; } },
  flag(k, dflt) { const v = this.get(k); return v === null ? dflt : v === '1'; },
};

// ── 막대 필터 (시가 · 종가, 둘 다 전일 종가 대비 %) ──
// 모든 날의 값을 0.1% 단위로 넓힌 범위를 30칸으로 나눈 막대 · 끌어 고른 범위 밖의 날은 빼고 봄 (가장 최근 날은 늘 남김)
const SI_METRICS = { open: (d) => d.open, close: (d) => d.close };
const siR1 = (v) => +v.toFixed(1);

function siBins(values, min, max) {
  let tz = [];
  for (let i = 1; i < SI_METRIC_BINS; i++) tz.push(min + ((max - min) * i) / SI_METRIC_BINS);
  let a = 0, b = tz.length;
  while (a < tz.length && tz[a] <= min) ++a;
  while (b > 0 && tz[b - 1] > max) --b;
  if (a || b < tz.length) tz = tz.slice(a, b);
  const m = tz.length, bins = [];
  for (let i = 0; i <= m; i++) bins.push({ x0: i > 0 ? tz[i - 1] : min, x1: i < m ? tz[i] : max, n: 0 });
  for (const v of values) {
    if (v == null || !(min <= v && v <= max)) continue;
    let lo = 0, hi = m;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (tz[mid] <= v) lo = mid + 1; else hi = mid; }
    bins[lo].n++;
  }
  return bins;
}

function siMetric(key, block, allDays, onChange) {
  const value = SI_METRICS[key];
  const values = allDays.map(value).filter((v) => v !== null);
  const min = siR1(Math.floor(siMin(values) / SI_METRIC_STEP) * SI_METRIC_STEP);
  const max = siR1(Math.ceil(siMax(values) / SI_METRIC_STEP) * SI_METRIC_STEP);
  const bins = siBins(values, min, max);
  const st = { key, min, max, lo: min, hi: max, bins };
  const svg = block.querySelector('.ssi-hist'), rng = block.querySelector('.ssi-mrange'), reset = block.querySelector('.ssi-mreset');
  const name = block.dataset.name;
  if (block._ssiAbort) block._ssiAbort.abort();      // 자료를 다시 불러오면 이전 손잡이 동작은 지움
  const ac = (block._ssiAbort = new AbortController()), sig = { signal: ac.signal };
  let W = 0, H = 0, xs = null, els = null;
  const inv = (px) => min + (px / W) * (max - min);

  const save = () => siStore.set(SI_KEYS.metric(key), JSON.stringify({ lo: st.lo > min ? st.lo : 'edge', hi: st.hi < max ? st.hi : 'edge' }));
  const active = () => st.lo > min || st.hi < max;

  function build() {
    siClear(svg);
    W = Math.max(40, svg.clientWidth); H = Math.max(16, svg.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    xs = (v) => ((v - min) / (max - min || 1)) * W;
    const top = Math.max(1, siMax(bins.map((b) => b.n)) || 1);
    const yb = (n) => H - (n / top) * (H - 2);
    const gb = siEl('g', { class: 'bars' }, svg);
    const rects = bins.map((b) => siEl('rect', { x: siR(xs(b.x0) + 0.5), width: Math.max(1, siR(xs(b.x1) - xs(b.x0) - 1)), y: siR(yb(b.n)), height: siR(H - yb(b.n)) }, gb));
    if (min < 0 && max > 0) siEl('line', { class: 'zero', x1: siR(xs(0)), x2: siR(xs(0)), y1: 0, y2: H }, svg);
    const sel = siEl('rect', { class: 'sel', y: 0, height: H }, svg);
    const hs = [0, 1].map((i) => {
      const h = siEl('rect', { class: 'handle', y: -1, height: H + 2, width: 6, rx: 2, tabindex: 0, role: 'slider', 'aria-label': name + (i ? ' 상한' : ' 하한'), 'aria-valuemin': min, 'aria-valuemax': max }, svg);
      h.addEventListener('keydown', (e) => keyMove(e, i), sig);
      return h;
    });
    const labels = [0, 1].map(() => siEl('text', { class: 'hlabel', y: H + 3, dy: '0.71em' }, svg));
    els = { rects, sel, hs, labels };
    paint();
  }

  function paint() {
    if (!els) return;
    const on = active();
    els.rects.forEach((r, i) => r.classList.toggle('in', !on || (bins[i].x1 > st.lo && bins[i].x0 < st.hi)));
    const a = xs(st.lo), b = xs(st.hi);
    els.sel.setAttribute('x', siR(a)); els.sel.setAttribute('width', siR(Math.max(0, b - a)));
    [a, b].forEach((px, i) => {
      const h = els.hs[i], v = i ? st.hi : st.lo;
      h.setAttribute('x', siR(px - 3));
      h.setAttribute('aria-valuenow', v);
      h.setAttribute('aria-valuetext', siFmtPct(v, 1));
    });
    // 손잡이 아래 경곗값: 가운데 맞춤 → 칸 밖으로 안 나가게 → 둘이 붙으면 아래쪽은 왼쪽, 위쪽은 오른쪽으로 비킴
    const t = els.labels;
    t[0].textContent = siFmtPct(st.lo, 1); t[1].textContent = siFmtPct(st.hi, 1);
    const w0 = t[0].getComputedTextLength ? t[0].getComputedTextLength() : 30, w1 = t[1].getComputedTextLength ? t[1].getComputedTextLength() : 30, G = 6;
    let l0 = Math.max(0, Math.min(W - w0, a - w0 / 2)), l1 = Math.max(0, Math.min(W - w1, b - w1 / 2));
    const over = l0 + w0 + G - l1;
    if (over > 0) {
      l0 = Math.max(0, l0 - over / 2);
      l1 = Math.min(W - w1, l0 + w0 + G);
      l0 = Math.max(0, Math.min(l0, l1 - w0 - G));
    }
    t[0].setAttribute('x', siR(l0)); t[1].setAttribute('x', siR(l1));
    rng.hidden = on; reset.hidden = !on;
    block.classList.toggle('on', on);
  }

  // (끌기·키보드는 늘 lo ≤ hi 로 부름 · 저장값이 거꾸로면 원본처럼 그대로 둬 아무 날도 통과하지 않음 — 바깥을 누르면 풀림)
  function set(lo, hi, user) {
    st.lo = lo; st.hi = hi;
    paint();
    if (user) { save(); onChange(); }
  }

  // 끌기: 손잡이 = 그 끝만 · 좁혀 둔 범위 안 = 통째로 옮김 · 밖(또는 아직 전체일 때 아무 곳) = 새로 고르기 · 움직이지 않고 떼면 전체로
  let drag = null;
  const hit = (px, e) => {
    const a = xs(st.lo), b = xs(st.hi), grab = e.pointerType === 'mouse' ? 6 : 14;
    const da = Math.abs(px - a), db = Math.abs(px - b);
    if (Math.min(da, db) <= grab) return da < db || (da === db && px < a) ? 'lo' : 'hi';
    return px > a && px < b && active() ? 'move' : 'new';
  };
  const pxOf = (e) => e.clientX - svg.getBoundingClientRect().left - svg.clientLeft;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !xs) return;
    const px = pxOf(e);
    drag = { mode: hit(px, e), x0: px, a: xs(st.lo), b: xs(st.hi), moved: false, id: e.pointerId };
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    e.preventDefault();
  }, sig);
  svg.addEventListener('pointermove', (e) => {
    if (!drag && xs && e.pointerType === 'mouse') { const m = hit(pxOf(e), e); svg.style.cursor = m === 'move' ? 'move' : m === 'new' ? '' : 'ew-resize'; }
    if (!drag || e.pointerId !== drag.id) return;
    const px = Math.max(0, Math.min(W, pxOf(e)));
    if (!drag.moved && Math.abs(px - drag.x0) < 2) return;
    drag.moved = true;
    let a = drag.a, b = drag.b;
    if (drag.mode === 'lo') a = px;
    else if (drag.mode === 'hi') b = px;
    else if (drag.mode === 'move') { const d = Math.max(-drag.a, Math.min(W - drag.b, px - drag.x0)); a = drag.a + d; b = drag.b + d; }
    else { a = Math.min(drag.x0, px); b = Math.max(drag.x0, px); }
    if (a > b) [a, b] = [b, a];
    set(siR1(inv(a)), siR1(inv(b)), true);
  }, sig);
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasClick = !drag.moved && drag.mode === 'new';
    drag = null;
    if (wasClick) set(min, max, true);
  };
  svg.addEventListener('pointerup', end, sig);
  svg.addEventListener('pointercancel', end, sig);
  svg.addEventListener('dblclick', () => set(min, max, true), sig);
  reset.addEventListener('click', () => set(min, max, true), sig);

  function keyMove(e, i) {
    const big = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown' ? 1 : SI_METRIC_STEP;
    let v = i ? st.hi : st.lo;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') v -= big;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') v += big;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    v = siR1(Math.max(min, Math.min(max, v)));
    if (i) set(st.lo, Math.max(st.lo, v), true); else set(Math.min(st.hi, v), st.hi, true);
  }

  const saved = siStore.json(SI_KEYS.metric(key));
  set(typeof saved.lo === 'number' ? siR1(Math.max(min, saved.lo)) : min, typeof saved.hi === 'number' ? siR1(Math.min(max, saved.hi)) : max, false);
  save();                            // 끝에 닿은 값은 'edge' 로 다시 저장 (자료 범위가 넓어지면 끝을 따라가게)
  build();
  st.build = build;
  st.pass = (d) => { const v = value(d); return v !== null && v >= st.lo && v <= st.hi; };
  return st;
}

// ── 기간 막대: 불러온 거래일 위의 두 손잡이 (서로 넘지 않음) ──
function siRestoreThumb(saved, dates, edge, isStart) {
  if (!saved || saved === 'edge') return edge;
  const exact = dates.indexOf(saved);
  if (exact >= 0) return exact;
  let inward = -1;
  if (isStart) inward = dates.findIndex((d) => d > saved);
  else for (let i = dates.length - 1; i >= 0; i--) if (dates[i] < saved) { inward = i; break; }
  return inward >= 0 ? inward : edge;
}

function siPeriod(allDays, els, onChange) {
  const { start, end, fill } = els, last = allDays.length - 1, dates = allDays.map((d) => d.date);
  const saved = siStore.json(SI_KEYS.period);
  start.max = end.max = String(Math.max(0, last));
  start.value = String(siRestoreThumb(saved.start, dates, 0, true));
  end.value = String(siRestoreThumb(saved.end, dates, last, false));
  const apply = () => {
    let lo = +start.value, hi = +end.value;
    if (lo > hi) [lo, hi] = [hi, lo];
    start.value = String(lo); end.value = String(hi);
    const span = Math.max(1, last);
    fill.style.left = (lo / span) * 100 + '%';
    fill.style.width = ((hi - lo) / span) * 100 + '%';
    start.setAttribute('aria-valuetext', siFmtDate(dates[lo]));
    end.setAttribute('aria-valuetext', siFmtDate(dates[hi]));
    siStore.set(SI_KEYS.period, JSON.stringify({ start: lo === 0 ? 'edge' : dates[lo], end: hi === last ? 'edge' : dates[hi] }));
    onChange(allDays.slice(lo, hi + 1));
  };
  start.oninput = apply;
  end.oninput = apply;
  apply();
}

/* ═══ 60-app.js ═══ */
/* ── [STRATSIM-INTRA] 06 화면 조립 · 자료 불러오기 · 새로 고침 ──────────────────
   불러올 때마다(처음 · 10분마다) 조절 장치를 저장된 상태로 다시 세우고, 바뀔 때마다 거르기 → 평균·중앙값 → 다시 그림
   거르는 순서: 기간 막대 → 시가·종가 막대 필터(가장 최근 날은 늘 남김) → '비슷한 날만'이면 그중 마지막 날과 비슷한 날 */

const SA = { root: null, allDays: [], latestId: null, periodDays: [], metrics: [], similarOn: false, ready: false, loadedAt: 0, timers: false, loading: false, fontsOk: false, drawnBeforeFonts: false };
const SI_NOW_MS = 30 * 1000, SI_DATA_MS = 10 * 60 * 1000;

function siBuildDom(root) {
  root.innerHTML = `
  <div class="ssi-top"><span class="ssi-fetched" id="ssi-fetched">자료를 불러오는 중…</span></div>
  <div class="card ssi-card">
    <div class="ssi-tools">
      <label class="ssi-switch">
        <input type="checkbox" id="ssi-similar">
        <span class="ssi-track" aria-hidden="true"></span>
        <span class="ssi-swt"><b>비슷한 날만</b><small>마지막 날과 가장 비슷하게 움직인 8%</small></span>
      </label>
      ${['open', 'close'].map((k) => `
      <div class="ssi-metric" data-metric="${k}" data-name="${k === 'open' ? '시가' : '종가'}" title="막대 위를 끌어 그 범위의 날만 봅니다 · 바깥을 한 번 누르거나 두 번 누르면 전체">
        <div class="ssi-mh"><span class="ssi-mn">${k === 'open' ? '시가' : '종가'} <small>전일 종가 대비</small></span><span class="ssi-mrange">전체</span><button type="button" class="ssi-mreset" hidden>전체 보기</button></div>
        <svg class="ssi-hist" aria-label="${k === 'open' ? '시가' : '종가'}(전일 종가 대비) 분포 — 끌어서 범위 고르기"></svg>
      </div>`).join('')}
      <div class="ssi-period">
        <div class="ssi-cov" id="ssi-cov" aria-live="polite"></div>
        <div class="ssi-range">
          <div class="ssi-rtrack"></div><div class="ssi-rfill" id="ssi-rfill"></div>
          <input type="range" id="ssi-start" min="0" max="0" value="0" step="1" aria-label="기간 시작">
          <input type="range" id="ssi-end" min="0" max="0" value="0" step="1" aria-label="기간 끝">
        </div>
      </div>
    </div>
    <div class="ssi-info">
      <div class="ssi-legend" id="ssi-legend">
        <span class="lg mean"><i></i>평균</span><span class="lg median"><i></i>중앙값</span>
        <span class="lg buy"><i></i>매수 시각</span><span class="lg sell"><i></i>매도 시각</span>
        <span class="lg today" hidden><i></i>오늘 (장중)</span><span class="lg win" hidden><i></i>비교한 구간</span>
      </div>
      <div class="ssi-readout" id="ssi-readout" hidden><span class="ssi-ro" id="ssi-ro"></span><button type="button" class="ssi-rox" id="ssi-rox" aria-label="닫기">×</button></div>
    </div>
    <div class="ssi-chart" id="ssi-chart">
      <div class="ssi-msg" id="ssi-msg"><span class="ssi-spin"></span><span>자료를 불러오는 중…</span></div>
    </div>
    <div class="ssi-foot">
      <div class="ssi-scale" role="group" aria-label="세로축 눈금">
        <button type="button" data-y="log" aria-pressed="true" title="±0.1% 안은 직선, 바깥은 로그 — 0 근처를 넓게, 큰 날도 한 화면에">로그</button><button type="button" data-y="linear" aria-pressed="false" title="보이는 날들의 범위에 맞춘 직선 눈금">직선</button>
      </div>
      <span class="ssi-zone" id="ssi-zone"></span>
    </div>
  </div>`;
}

const siQ = (id) => document.getElementById(id);

function siZoneNote() {
  const open = siFmtClock(SI_OPEN + SC.offset), close = siFmtClock(SI_CLOSE + SC.offset);
  let dst = false;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: SI_MARKET_TZ, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    dst = !!p && /DT$/.test(p.value);
  } catch (e) { /* 무시 */ }
  const el = siQ('ssi-zone');
  if (SI_LOCAL_TZ === SI_MARKET_TZ) el.textContent = `시각: 뉴욕 시간 · 미국 정규장 ${open}~${close}`;
  else el.textContent = `시각: ${SC.zone} · 미국 정규장 ${open}~${close}` + (dst ? ' (미국 서머타임)' : '');
}

function siCoverage(days) {
  const el = siQ('ssi-cov');
  if (!days.length) { el.innerHTML = '<b>0</b>일'; return; }
  el.innerHTML = `<b>${days.length}</b>일 · <b>${siFmtDate(days[0].date)}</b> ~ <b>${siFmtDate(days[days.length - 1].date)}</b>`;
}

function siShowMsg(html, retry) {
  const m = siQ('ssi-msg');
  m.hidden = !html;
  m.innerHTML = html || '';
  if (retry) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ssi-retry'; b.textContent = '다시 불러오기';
    b.addEventListener('click', () => siLoad());
    m.appendChild(b);
  }
}

// 거르기 → 그리기 (조절 장치가 바뀔 때마다)
function siRefresh() {
  if (!SA.ready) return;
  const filtered = SA.periodDays.filter((d) => d.id === SA.latestId || SA.metrics.every((f) => f.pass(d)));
  let days = filtered, cutoff = null, ref = null;
  if (SA.similarOn && filtered.length) {
    ref = filtered[filtered.length - 1];
    ({ days, cutoff } = siSimilar(filtered, ref));
  }
  siCoverage(days);
  SC.data = days;
  SC.aggs = days.length ? siAggregates(days) : [];
  SC.marks = SC.aggs.length ? siMarks(SC.aggs) : [];
  SC.refId = ref ? ref.id : null;
  SC.cutoff = cutoff;
  SC.todayId = SA.latestId;
  SC.opacityCount = filtered.filter((d) => d.id !== SA.latestId).length;
  siRender();
  siShowMsg(days.length ? '' : '조건에 맞는 날이 없습니다 — 시가·종가 범위나 기간을 넓혀 보세요');
  const lg = siQ('ssi-legend');
  lg.querySelector('.today').hidden = !SC.live;
  lg.querySelector('.win').hidden = cutoff === null;
}

async function siFetchText(url, need) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) { if (need) throw new Error(url + ' ' + r.status); return ''; }
  return r.text();
}

async function siLoad() {
  if (SA.loading) return;
  SA.loading = true;
  if (!SA.allDays.length) siShowMsg('<span class="ssi-spin"></span><span>자료를 불러오는 중…</span>');
  try {
    const [t5, t1, tu] = await Promise.all([
      siFetchText(SI_DATA.m5, true),
      siFetchText(SI_DATA.m1, false).catch(() => ''),   // 없어도 됨 (가장 최근 거래일 1분봉)
      siFetchText(SI_DATA.upd, false).catch(() => ''),
    ]);
    const hist = siParseCsv(t5, 5);
    const allDays = siBuildDays(siMergeToday(hist, siParseCsv(t1, 1)));
    if (!allDays.length) throw new Error('빈 자료');
    if (!SA.fontsOk && !SA.allDays.length) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]);
    if (!SA.fontsOk && !SA.allDays.length) SA.drawnBeforeFonts = true;
    siApplyData(allDays, tu);
    SA.loadedAt = Date.now();
    if (!SA.timers) siStartTimers();
  } catch (e) {
    if (!SA.allDays.length) siShowMsg('자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
  } finally {
    SA.loading = false;
  }
}

function siApplyData(allDays, updatedText) {
  SA.allDays = allDays;
  SA.latestId = allDays[allDays.length - 1].id;
  let lo = Infinity, hi = -Infinity;
  for (const d of allDays) for (const p of d.points) { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct; }
  SC.yLimit = Math.max(SC.yLimit || 0, Math.ceil(Math.max(-lo, hi)));      // 넓어지기만 함 (새로 불러와도 축이 줄지 않게)
  SA.ready = false;
  const guarded = () => siRefresh();
  SA.metrics = [...SA.root.querySelectorAll('.ssi-metric')].map((b) => siMetric(b.dataset.metric, b, allDays, guarded));
  SA.similarOn = siStore.flag(SI_KEYS.similar, siMarketMinuteNow() !== null);
  siQ('ssi-similar').checked = SA.similarOn;
  siPeriod(allDays, { start: siQ('ssi-start'), end: siQ('ssi-end'), fill: siQ('ssi-rfill') }, (days) => { SA.periodDays = days; guarded(); });
  SA.ready = true;
  siRefresh();
  // 자료 갱신 시각 (보는 사람 시간대)
  const iso = (updatedText || '').trim();
  const when = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z$/.test(iso) ? new Date(iso) : null;
  const f = siQ('ssi-fetched');
  f.innerHTML = (when ? `자료 갱신 <b>${siEsc(new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when))}</b> · ` : '')
    + `${siEsc(siFmtDate(allDays[0].date))} ~ ${siEsc(siFmtDate(allDays[allDays.length - 1].date))} <b>${allDays.length.toLocaleString('ko-KR')}</b>거래일 · 출처 야후 파이낸스 · networthcast`;
}

function siStartTimers() {
  SA.timers = true;
  setInterval(() => siDrawNow(), SI_NOW_MS);
  setInterval(() => { if (!document.hidden) siLoad(); }, SI_DATA_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - SA.loadedAt > SI_DATA_MS) siLoad();
    else if (!document.hidden) siDrawNow();
  });
}

function siOnHoverInfo(info) {
  const ro = siQ('ssi-readout'), lg = siQ('ssi-legend');
  const show = !!info && SC.compact;
  ro.hidden = !show; lg.classList.toggle('dim', show);
  if (!show) return;
  const d = info.day;
  siQ('ssi-ro').innerHTML = `<b>${siFmtDate(d.date)} (${siWeekday(d.date)})${info.today ? ' 오늘' : ''}</b>`
    + ` <span>${siFmtClock(info.minute + SC.offset)}</span> <span class="${siTone(info.dayPct)}">${siFmtPct(info.dayPct)}</span>`
    + ` <span class="mut">· 종가</span> <span class="${siTone(info.close)}">${siFmtPct(info.close)}</span>`;
}

function siInit() {
  const root = document.getElementById('ssi-app');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  SA.root = root;
  siBuildDom(root);
  SC.offset = siLocalOffset(new Date());
  SC.zone = siZoneLabel();
  SC.yType = siStore.flag(SI_KEYS.log, true) ? 'log' : 'linear';
  siChartInit(siQ('ssi-chart'));
  siHoverInit();
  SH.onInfo = siOnHoverInfo;
  SH.keep = siQ('ssi-readout');
  siQ('ssi-rox').addEventListener('click', () => siHoverHide());
  siZoneNote();

  const scaleBtns = [...root.querySelectorAll('.ssi-scale button')];
  const paintScale = () => scaleBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.y === SC.yType)));
  paintScale();
  scaleBtns.forEach((b) => b.addEventListener('click', () => {
    if (SC.yType === b.dataset.y) return;
    SC.yType = b.dataset.y;
    siStore.set(SI_KEYS.log, SC.yType === 'log' ? '1' : '0');
    paintScale();
    siRender();
  }));
  siQ('ssi-similar').addEventListener('change', (e) => {
    SA.similarOn = e.target.checked;
    siStore.set(SI_KEYS.similar, SA.similarOn ? '1' : '0');
    siRefresh();
  });

  // 폭이 바뀌면 다시 그림 (막대 필터는 새 폭으로 다시 그리고, 고른 값은 그대로)
  let lastW = 0, lastH = 0, raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = siQ('ssi-chart').clientWidth, h = window.innerHeight;
      if (w === lastW && (SC.compact || h === lastH)) return;
      lastW = w; lastH = h;
      if (!SA.ready) return;
      SA.metrics.forEach((m) => m.build());
      siRender();
    });
  };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(siQ('ssi-chart'));
  window.addEventListener('resize', onResize);
  // 글꼴이 늦게 오면(글자 폭으로 상자·눈금 자리를 정하므로) 한 번 다시 그림 — 처음 그리기는 글꼴을 잠깐(최대 0.8초) 기다림
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      SA.fontsOk = true;
      if (SA.ready && SA.drawnBeforeFonts) { SA.metrics.forEach((m) => m.build()); siRender(); }
    });
  } else SA.fontsOk = true;
  // 검증용 읽기 전용 요약 — 자동 시험이 같은 자료에서 원본과 숫자를 대조할 때 씀
  root.ssiState = () => ({
    days: SC.data.map((d) => d.id), all: SA.allDays.length, latest: SA.latestId,
    aggs: SC.aggs.map((a) => [a.minute, a.mean, a.median, a.n]),
    marks: SC.marks.map((m) => ({ kind: m.kind, minute: m.minute, reasons: m.reasons.map((r) => [r.what, r.value]) })),
    refId: SC.refId, cutoff: SC.cutoff, opacityCount: SC.opacityCount, opacity: SC.dayOpacity, live: !!SC.live, similar: SA.similarOn,
    yType: SC.yType, yLimit: SC.yLimit, yTicks: SC.y ? SC.y.ticks.slice() : [], offset: SC.offset, zone: SC.zone,
    metrics: SA.metrics.map((m) => ({ key: m.key, min: m.min, max: m.max, lo: m.lo, hi: m.hi, bins: m.bins.map((b) => [b.x0, b.x1, b.n]) })),
    coverage: siQ('ssi-cov').textContent,
  });
  siLoad();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siInit);
else siInit();

})();
