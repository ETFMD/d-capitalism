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
