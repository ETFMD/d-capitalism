/* 자동 생성 — src/stratsim/*.js 를 이은 것 (scripts/build_pages.py [MOD]) · 직접 고치지 말고 src/stratsim/ 을 고칠 것 */
(function () {
'use strict';

/* ═══ 00-core.js ═══ */
/* ── [STRATSIM] 투자전략 시뮬레이터 · 00 기초 ──────────────────────────────
   자료 읽기 · 기간(주·월·분기·연) 묶음 · 이동평균/RSI · 금액·날짜 서식 · 슬라이더 눈금
   · 돈 가중 수익률(IRR) · 일별 최대 낙폭.  (빌드가 src/stratsim/*.js 를 한 IIFE 로 묶음)
   계산 규칙은 원본 Strategies Simulator(tqqq.networthcast.com)와 같게 맞춤 — 코드는 새로 씀 */

// 종목 열 순서: 행 = [날짜, tqqq, qqq, spy, qld, sso, spxl, sqqq]
const SS_ASSETS = ['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq'];
const SS_COL = { tqqq: 1, qqq: 2, spy: 3, qld: 4, sso: 5, spxl: 6, sqqq: 7 };
const SS_KEY_OF = ['date', 'tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq'];
// 레버리지 종목의 기초(비레버리지) 짝 — 버블 보험 기본 측정 종목
const SS_UNLEV = { tqqq: 'qqq', qld: 'qqq', sso: 'spy', spxl: 'spy', qqq: 'qqq', spy: 'spy', sqqq: 'qqq' };
const SS_PERIOD_DAYS = { weekly: 5, monthly: 21, quarterly: 63, yearly: 252 };

// 전체 자료 (initData 가 채움)
const DS = {
  days: null,      // [{date, tqqq, qqq, spy, qld, sso, spxl, sqqq}]
  rows: null,      // 같은 날들을 행 모양으로
  idx: null,       // Map 날짜 → days 위치
  q: null, m: null, w: null, y: null,  // 기간 마지막 거래일 행
  mIn: null,       // 기간 이름 → [기간 i 에 속한 월 행 위치들]
  nfci: null,      // 거래일마다 NFCI (발표 7일 뒤부터) — 없으면 NaN
  smaD: {}, smaM: {}, rsiD: {}, rsiM: {},
};

const ssDash = (d8) => d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8);

// data/stratsim/prices.csv (날짜,qqq,tqqq,spy,qld,sso,spxl,sqqq) → days
// tqqq 칸이 빈 날은 뺌 · 다른 종목 빈칸·읽을 수 없는 값은 0
const SS_CSV_REST = ['spy', 'qld', 'sso', 'spxl', 'sqqq'];   // 4~8번째 칸
function ssParsePrices(text) {
  const out = [];
  for (const ln of String(text).split(/\r?\n/)) {
    const c0 = ln.charCodeAt(0);
    if (!(c0 >= 48 && c0 <= 57)) continue;                     // 머리줄·빈 줄
    const c = ln.split(',');
    if (c[2] == null || c[2] === '') continue;
    const row = { date: ssDash(c[0]), qqq: parseFloat(c[1]), tqqq: parseFloat(c[2]) };
    SS_CSV_REST.forEach((k, j) => { row[k] = parseFloat(c[3 + j]) || 0; });
    out.push(row);
  }
  return out;
}

function ssParseNfci(text) {
  const out = [];
  for (const ln of String(text).split(/\r?\n/)) {
    if (!ln || ln.charCodeAt(0) < 48 || ln.charCodeAt(0) > 57) continue;
    const c = ln.split(',');
    out.push([ssDash(c[0]), parseFloat(c[1])]);
  }
  return out;
}

const ssRowOf = (d) => SS_KEY_OF.map((k) => d[k]);   // [날짜, tqqq, qqq, spy, qld, sso, spxl, sqqq]

// 같은 기간(키)의 마지막 거래일만 남김 — 날짜 순서 그대로
function ssLastPer(days, keyOf) {
  const out = [];
  let prev = null;
  for (const d of days) {
    const k = keyOf(d.date);
    if (k === prev) out[out.length - 1] = ssRowOf(d);
    else { out.push(ssRowOf(d)); prev = k; }
  }
  return out;
}
const ssKeyM = (s) => s.slice(0, 7);
const ssKeyQ = (s) => s.slice(0, 5) + Math.ceil(+s.slice(5, 7) / 3);
const ssKeyY = (s) => s.slice(0, 4);
// 그 날이 속한 주(월요일 시작)의 월요일 날짜
function ssMonday(s) {
  const t = new Date(s + 'T00:00:00Z');
  const wd = t.getUTCDay();
  t.setUTCDate(t.getUTCDate() - (wd === 0 ? 6 : wd - 1));
  return t.toISOString().slice(0, 10);
}
// 그 주의 마지막 거래일인가 (다음 거래일이 다른 주면)
const ssWeekLast = (d, next) => !next || ssMonday(d) !== ssMonday(next);

// 기간 행 i 마다 그 기간에 들어오는 월 행 위치 (이전 기간 끝 < 월 ≤ 이 기간 끝)
function ssMonthsWithin(prows) {
  const mm = DS.m, out = new Array(prows.length);
  out[0] = [];
  let j = 0;
  while (j < mm.length && mm[j][0] <= prows[0][0]) j++;
  for (let i = 1; i < prows.length; i++) {
    const lst = [];
    while (j < mm.length && mm[j][0] <= prows[i][0]) lst.push(j++);
    out[i] = lst;
  }
  return out;
}

// NFCI: 관측일 + 7일(달력)부터 쓸 수 있고 다음 발표까지 유지
function ssAlignNfci(days, weekly) {
  const WEEK_MS = 7 * 86400000;
  const usable = weekly.map((w) => ({ from: new Date(Date.parse(w[0] + 'T00:00:00Z') + WEEK_MS).toISOString().slice(0, 10), val: w[1] }));
  let next = 0, latest = NaN;
  return days.map((day) => {
    for (; next < usable.length && usable[next].from <= day.date; next++) latest = usable[next].val;
    return latest;
  });
}

function ssInitData(days, nfciWeekly) {
  DS.days = days;
  DS.rows = days.map(ssRowOf);
  DS.idx = new Map(days.map((d, i) => [d.date, i]));
  DS.q = ssLastPer(days, ssKeyQ);
  DS.m = ssLastPer(days, ssKeyM);
  DS.w = ssLastPer(days, ssMonday);
  DS.y = ssLastPer(days, ssKeyY);
  DS.mIn = { weekly: ssMonthsWithin(DS.w), monthly: ssMonthsWithin(DS.m), quarterly: ssMonthsWithin(DS.q), yearly: ssMonthsWithin(DS.y) };
  DS.nfci = nfciWeekly && nfciWeekly.length ? ssAlignNfci(days, nfciWeekly) : days.map(() => NaN);
  DS.smaD = {}; DS.smaM = {}; DS.rsiD = {}; DS.rsiM = {};
}
const ssPeriodRows = (name) => (name === 'weekly' ? DS.w : name === 'monthly' ? DS.m : name === 'yearly' ? DS.y : name === 'quarterly' ? DS.q : null);

// 리밸런스 시점(%): 진입일 행 + (진입 + max(1,offset)) 거래일부터 기간 거래일 수 간격 (청산일 넘으면 멈춤)
function ssShiftRows(period, offset, entryDate, exitDate) {
  if (!DS.days) return [];
  const e = DS.idx.get(entryDate);
  if (e == null) return [];
  const step = SS_PERIOD_DAYS[period] || 63;
  const out = [DS.rows[e]];
  for (let k = e + Math.max(1, offset); k < DS.days.length; k += step) {
    if (exitDate && DS.days[k].date > exitDate) break;
    out.push(DS.rows[k]);
  }
  return out;
}
// 정확한 날짜(달력): 진입일 행 + 그 사이 기간 끝 행 + 청산일 행
function ssExactRows(period, entryDate, exitDate) {
  if (!DS.days) return [];
  const e = DS.idx.get(entryDate), x = DS.idx.get(exitDate);
  if (e == null || x == null || e >= x) return [];
  const src = ssPeriodRows(period) || DS.q;
  const out = [DS.rows[e]];
  for (const r of src) if (r[0] > entryDate && r[0] < exitDate) out.push(r);
  out.push(DS.rows[x]);
  return out;
}

// 이동평균: 창 안 값이 모두 양수일 때만 (아니면 null)
function ssSma(vals, w) {
  const out = new Array(vals.length);
  let sum = 0, n = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > 0) { sum += vals[i]; n++; }
    if (i >= w && vals[i - w] > 0) { sum -= vals[i - w]; n--; }
    out[i] = n === w ? sum / w : null;
  }
  return out;
}
// 와일더 RSI (첫 값 = 1..w 차이 단순 평균, 그다음 지수 평활)
function ssRsi(vals, w) {
  const out = new Array(vals.length).fill(null);
  if (vals.length < w + 1) return out;
  let up = 0, dn = 0;
  for (let i = 1; i <= w; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) up += d; else dn -= d; }
  up /= w; dn /= w;
  out[w] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  for (let i = w + 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    up = (up * (w - 1) + (d > 0 ? d : 0)) / w;
    dn = (dn * (w - 1) + (d < 0 ? -d : 0)) / w;
    out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}
// 지표는 처음 쓸 때 계산해 둠 · 월 = 월말 거래일 값
function ssInd(kind, asset, w, monthly) {
  const store = kind === 'sma' ? (monthly ? DS.smaM : DS.smaD) : (monthly ? DS.rsiM : DS.rsiD);
  const key = asset + '_' + w;
  if (key in store) return store[key];
  if (!SS_COL[asset] || !(w > 0)) return (store[key] = null);
  if (monthly) {
    const dser = ssInd(kind, asset, w, false);
    return (store[key] = DS.m.map(r => { const i = DS.idx.get(r[0]); return i != null ? dser[i] : null; }));
  }
  const vals = DS.days.map(d => d[asset]);
  return (store[key] = kind === 'sma' ? ssSma(vals, w) : ssRsi(vals, w));
}

// ── 서식 ───────────────────────────────────────────────────────────────
// 금액: $10.00K · $1.234M · $256.4B (네 자리 유효)
const SS_MONEY_UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
function ssMoney(n) {
  const a = Math.abs(n), unit = SS_MONEY_UNITS.find((u) => a >= u[0]);
  let body;
  if (!unit) body = String(Math.round(a));
  else { const v = a / unit[0]; body = v.toFixed(v >= 100 ? 1 : v >= 10 ? 2 : 3) + unit[1]; }   // 네 자리 유효
  return (n < 0 ? '-$' : '$') + body;
}
// 축·짧은 금액: 끝 0 지움 ($10.00K → $10K)
function ssMoneyAxis(n) { return ssMoney(n).replace(/\.0+([KMBT])$/, '$1').replace(/(\.\d*?)0+([KMBT])$/, '$1$2'); }
// 3자리 유효 + K/M/B (기호 없음) — 히트맵 칸
function ssShort3(n) {
  if (!Number.isFinite(n) || n === 0) return '0';
  const a = Math.abs(n);
  let v = n, u = '';
  if (a >= 1e9) { v = n / 1e9; u = 'B'; } else if (a >= 1e6) { v = n / 1e6; u = 'M'; } else if (a >= 1e3) { v = n / 1e3; u = 'K'; }
  const av = Math.abs(v);
  return (av >= 100 ? v.toFixed(0) : av >= 10 ? v.toFixed(1) : v.toFixed(2)) + u;
}
// 최대 낙폭(0~100): −59.7% · 90% 넘으면 소수 4자리
const ssDD = (p) => (p > 0 ? '−' + p.toFixed(p > 90 ? 4 : 1) + '%' : '0.0%');
const ssPct = (v, d) => (v >= 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%';
// 날짜: 2023.2.12 · 분기: 1999년 1분기 · 표: 26.10.01
function ssDate(s) {
  if (!s || s.length < 10) return ssMonthLabel(s);
  return s.slice(0, 4) + '.' + (+s.slice(5, 7)) + '.' + (+s.slice(8, 10));
}
function ssMonthLabel(s) { return s && s.length >= 7 ? s.slice(0, 4) + '.' + (+s.slice(5, 7)) : (s || ''); }
const ssQLabel = (s) => s.slice(0, 4) + '년 ' + Math.ceil(+s.slice(5, 7) / 3) + '분기';
const ssLogDate = (s) => (s && s.length >= 10 ? s.slice(2, 4) + '.' + s.slice(5, 7) + '.' + s.slice(8, 10) : (s || ''));
function ssDDRange(a, b) {
  if (!a || !b) return '';
  const x = ssDate(a), y = ssDate(b);
  return x === y ? x : x + '–' + y;
}
const SS_HTML_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const ssEsc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (ch) => SS_HTML_ENT[ch]);

// ── 슬라이더 눈금 (위치 0~1000) ───────────────────────────────────────
// 초기 투자금: $100 ~ $1억 로그 눈금 + 금액대별 반올림
function ssPosToInitial(s) {
  if (s <= 0) return 0;
  const raw = Math.pow(10, 2 + (s / 1000) * 6);
  const unit = raw < 1e4 ? 100 : raw < 1e5 ? 1e3 : raw < 1e6 ? 1e4 : raw < 1e7 ? 1e5 : 1e6;
  return Math.round(raw / unit) * unit;
}
function ssInitialToPos(v) { return v <= 0 ? 0 : Math.round(((Math.log10(Math.max(v, 100)) - 2) / 6) * 1000); }
// 매달 적립: $50 ~ $100만 로그 눈금
const SS_M_LO = Math.log10(50), SS_M_SPAN = Math.log10(1e6) - Math.log10(50);
function ssPosToMonthly(s) {
  if (!Number.isFinite(s) || s <= 0) return 0;
  const raw = Math.pow(10, SS_M_LO + ((Math.min(s, 1000) - 1) / 999) * SS_M_SPAN);
  const unit = raw < 1500 ? 50 : raw < 1e4 ? 100 : raw < 1e5 ? 1000 : 10000;
  return Math.min(1e6, Math.round(raw / unit) * unit);
}
function ssMonthlyToPos(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const t = (Math.log10(Math.min(v, 1e6)) - SS_M_LO) / SS_M_SPAN;
  return Math.round(Math.max(1, Math.min(1000, 1 + t * 999)));
}
// 현금 이자율: 제곱 눈금 0~100%, 0.5% 단위
function ssPosToRate(s) {
  if (s <= 0) return 0;
  const t = Math.max(0, Math.min(1, s / 1000));
  return Math.round(t * t * 200) / 2;
}
function ssRateToPos(r) { return r <= 0 ? 0 : Math.round(Math.sqrt(Math.max(0, Math.min(100, r)) / 100) * 1000); }

// ── 수익률·낙폭 ──────────────────────────────────────────────────────
// 돈 가중 연수익률(IRR, %) — 이분법. 흐름 [{t(년), cf}] (넣은 돈 −, 마지막 평가액 +)
// 끝 시점 가치 Σ cf·(1+r)^(T−t) 가 0 이 되는 r — 현재가치(÷(1+r)^t)와 0 의 위치는 같지만 지수가 0 이상이라
// 50년 넘는 기간에도 넘치지 않음 (현재가치로 풀면 r≈−100% 끝에서 무한대가 나와 풀지 못하고 대략식으로 떨어졌음)
function ssIrr(flows) {
  if (!flows || flows.length < 2 || !flows.some((f) => f.cf > 0) || !flows.some((f) => f.cf < 0)) return null;
  let T = 0;
  for (const f of flows) if (f.t > T) T = f.t;
  const fv = (rate) => { let s = 0; for (const f of flows) s += f.cf * Math.pow(1 + rate, T - f.t); return s; };
  // 구간 [a, b] 를 반씩 줄임 — 연 −99.9999% ~ +100,000% (단 (1+b)^T 가 1e300 을 넘지 않게), 폭 1e−13 까지
  let a = -0.999999, b = Math.min(1000, Math.pow(10, 300 / Math.max(T, 1)) - 1), pa = fv(a);
  const pb = fv(b);
  if (pa === 0) return a * 100;
  if (pb === 0) return b * 100;
  // 부호는 곱이 아니라 직접 비교 (아주 작은 두 값의 곱은 0 으로 떨어져 부호가 틀림)
  if (!(Number.isFinite(pa) && Number.isFinite(pb)) || (pa > 0) === (pb > 0)) return null;
  for (let left = 200; left > 0 && b - a > 1e-13; left--) {
    const c = (a + b) / 2, pc = fv(c);
    if (!Number.isFinite(pc)) return null;
    if (pc === 0) return c * 100;
    if ((pc > 0) === (pa > 0)) { a = c; pa = pc; } else b = c;
  }
  return (a + b) / 2 * 100;
}
const SS_YEAR_MS = 365.25 * 86400000;
// d 이하 마지막 거래일 ('YYYY-MM-DD' 뒤에 붙은 시각 등은 무시) — 없으면 null
function ssDayOnOrBefore(d) {
  if (!d || !DS.days || !DS.days.length) return null;
  const s = String(d).slice(0, 10);
  if (DS.idx.has(s)) return s;
  let lo = 0, hi = DS.days.length - 1, at = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (DS.days[m].date <= s) { at = DS.days[m].date; lo = m + 1; } else hi = m - 1; }
  return at;
}
// 넣은 돈의 흐름 [{t(년), cf, d(그 돈의 날짜)}] — 시작 −initial(d0) + 계산 엔진이 d1 의 값에 실제로 넣은 적립을 그 돈의 날짜로
// 적립 일정: 실제 거래내역(sched.list)이 있으면 그 날짜, 없으면 공식 ssSchedule(d0 뒤 달이 바뀐 첫 거래일 · 금액 = 매달 × (1+인상률)^(그해 − d0 해))
// mode — 어느 계산의 값인지 (d0 = 그 계산이 시작 금액을 넣은 날로 넘길 것):
//  'day'    SMA·사용자 코드(날마다 걷는 계산): 일정 날짜에 바로 들어감 → d0 < 날짜 ≤ d1 인 것 모두
//  'r9'     9sig·그냥 보유(ssRun9): 그달 월말 행을 처리할 때 넣되 가격은 일정 날짜 — 그달 일정 날짜가 없으면(달 중간 진입의 첫 달 등) 월말에 그달 금액
//           → 그달 월말 ≤ d1 인 달 것 · final(그 계산의 마지막 행)이면 d1 이 달 중간이어도 그달 d1 까지의 일정 날짜 것도(ssRun9 tailDays)
//  'r9base' 현금 복리 선(같은 엔진의 base): 달마다 이자를 먼저 붙이고 그달 돈을 더함 = 그달 월말에 넣은 것 → 날짜는 월말(마지막 행의 덜 찬 달은 d1)
//  (예전 호출의 true = 'day')
function ssFlows(initial, monthly, raise, d0, d1, sched, mode, final) {
  const t0 = Date.parse(d0 + 'T00:00:00Z'), tOf = (d) => (Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') - t0) / SS_YEAR_MS;
  const flows = [{ t: 0, cf: -initial, d: String(d0) }], add = (d, a) => flows.push({ t: tOf(d), cf: -a, d: String(d).slice(0, 10) });
  const m = mode === true ? 'day' : mode || 'r9';
  // 공식 일정은 거래일 사이로 만들어야 함 — 사용자 코드가 기록한 날짜가 거래일 모양이 아니어도(시각 붙음 등) 그 날 이하 마지막 거래일로
  const s = sched && sched.list ? sched : monthly > 0 ? ssSchedule(monthly, raise, d0, ssDayOnOrBefore(d1) || d1) : null;
  if (!s) return flows;
  if (m === 'day') {
    for (const r of s.list) if (r.date > d0 && r.date <= d1 && r.amount) add(r.date, r.amount);
    return flows;
  }
  const base = m === 'r9base', d1s = String(d1).slice(0, 10), byMk = new Map();
  for (const r of s.list) if (DS.idx.has(r.date)) { const mk = r.date.slice(0, 7); if (!byMk.has(mk)) byMk.set(mk, new Set()); byMk.get(mk).add(r.date); }
  for (const row of DS.m || []) {
    const me = row[0];
    if (me <= d0) continue;
    const mk = me.slice(0, 7), days = byMk.has(mk) ? [...byMk.get(mk)].sort() : null;
    if (me <= d1s) {
      if (days) { for (const d of days) { const a = s.byDate.get(d) || 0; if (a) add(base ? me : d, a); } }
      else { const a = s.byMonth.get(mk) || 0; if (a) add(me, a); }
      continue;
    }
    // 그달 월말이 d1 뒤 = d1 이 그달 중간: 마지막 행이면 그달 d1 까지의 일정 날짜 것만 (그 뒤 달은 없음)
    if (final !== false && days && mk === d1s.slice(0, 7)) for (const d of days) if (d <= d1s && d > d0) { const a = s.byDate.get(d) || 0; if (a) add(base ? d1s : d, a); }
    break;
  }
  return flows;
}
// 돈 가중 CAGR(%) — 못 풀면 (평가액/넣은 돈)^(1/년) − 1 · mode·final 은 ssFlows 와 같음
function ssCagrMW(initial, monthly, raise, d0, d1, years, finalV, contributed, sched, mode, final) {
  if (!(finalV > 0) || !(years > 0)) return 0;
  const flows = ssFlows(initial, monthly, raise, d0, d1, sched, mode, final);
  flows.push({ t: years, cf: finalV });
  const r = ssIrr(flows);
  if (r != null && Number.isFinite(r)) return r;
  const tc = contributed > 0 ? contributed : initial;
  return tc > 0 ? (Math.pow(finalV / tc, 1 / years) - 1) * 100 : 0;
}
// 최대 낙폭 추적: 값을 차례로 넣으면 '그때까지의 최고점 대비 가장 깊은 하락'(0~1)과 그 최고점·바닥의 표시를 기억
function ssPeakTracker() {
  let top = -Infinity, topAt = null;
  const worst = { pct: 0, from: null, to: null };
  return {
    worst,
    push(v, at) {
      if (v > top) { top = v; topAt = at; return; }
      if (top > 0) { const fall = (top - v) / top; if (fall > worst.pct) { worst.pct = fall; worst.from = topAt; worst.to = at; } }
    },
  };
}
// 기준점(ctrl: 날짜순, 그 날부터 다음 기준점 전까지 보유가 그대로) 의 첫날~마지막 날 사이 거래일마다 fn(그날 가격 행, 적용되는 기준점)
function ssEachHeldDay(ctrl, fn) {
  const first = ctrl[0].date, last = ctrl[ctrl.length - 1].date;
  let k = 0;
  for (const row of DS.days) {
    if (row.date < first) continue;
    if (row.date > last) return;
    while (k + 1 < ctrl.length && ctrl[k + 1].date <= row.date) k++;
    fn(row, ctrl[k]);
  }
}
// 일별 최대 낙폭 — 기준점[{date, shares, cash}] 사이엔 보유가 그대로, 매일 종가로 다시 평가
function ssDailyDD(ctrl, key) {
  const t = ssPeakTracker();
  if (ctrl && ctrl.length && DS.days) ssEachHeldDay(ctrl, (row, c) => {
    const px = row[key];
    if (!(px > 0)) return;
    const v = c.shares * px + c.cash;
    if (Number.isFinite(v) && v > 0) t.push(v, row.date);
  });
  return { pct: t.worst.pct, peakDate: t.worst.from, troughDate: t.worst.to };
}
// 여러 종목을 함께 들고 있을 때 — 기준점 [{date, h:{종목:주수}, cash}]
function ssDailyDDMulti(ctrl) {
  const t = ssPeakTracker();
  if (ctrl && ctrl.length && DS.days) ssEachHeldDay(ctrl, (row, c) => {
    let v = c.cash || 0;
    for (const k in (c.h || {})) { const px = row[k]; if (px > 0) v += c.h[k] * px; }
    if (Number.isFinite(v) && v > 0) t.push(v, row.date);
  });
  return { pct: t.worst.pct, peakDate: t.worst.from, troughDate: t.worst.to };
}
// 값 시리즈의 최대 낙폭 (dates 가 있으면 고점·저점 날짜)
function ssSeriesDD(vals, dates) {
  const res = { pct: 0, peakIdx: -1, troughIdx: -1, peakDate: null, troughDate: null };
  if (!vals || vals.length < 2) return res;
  const t = ssPeakTracker();
  vals.forEach((v, i) => { if (Number.isFinite(v)) t.push(v, i); });
  res.pct = t.worst.pct;
  if (t.worst.from !== null) { res.peakIdx = t.worst.from; res.troughIdx = t.worst.to; }
  if (dates) { res.peakDate = dates[res.peakIdx] || null; res.troughDate = dates[res.troughIdx] || null; }
  return res;
}
// 사용자 전략 로그 → 일별 낙폭 기준점 (모든 행에 held·cash·shares 가 있어야)
function ssCustomCtrl(log) {
  if (!log || !log.length) return null;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const ctrl = new Array(log.length);
  for (let i = 0; i < log.length; i++) {
    const row = log[i];
    if (!row || typeof row.date !== 'string' || !num(row.cash)) return null;
    const asset = typeof row.held === 'string' ? row.held.toLowerCase() : '';
    if (asset === '') return null;
    const hold = {};
    if (asset !== 'cash') {
      if (!SS_COL[asset] || !num(row.shares)) return null;
      hold[asset] = row.shares;
    }
    ctrl[i] = { date: row.date, cash: row.cash, h: hold };
  }
  return ctrl;
}
// 실제 계좌 평가액의 낙폭 — 입출금은 빼고 (시간 가중 지수)
function ssFlowAdjDD(points, flows) {
  const res = { pct: 0, peakDate: null, troughDate: null };
  if (!points || points.length < 2) return res;
  const fl = flows || [];
  let fi = 0;
  while (fi < fl.length && fl[fi].date <= points[0].date) fi++;
  let idx = 1, peak = 1, pd = points[0].date;
  for (let i = 1; i < points.length; i++) {
    let f = 0;
    while (fi < fl.length && fl[fi].date <= points[i].date) f += fl[fi++].amount;
    const pv = points[i - 1].value;
    if (pv > 0 && isFinite(points[i].value)) idx *= Math.max(0, (points[i].value - f) / pv);
    if (idx > peak) { peak = idx; pd = points[i].date; }
    const dd = peak > 0 ? 1 - idx / peak : 0;
    if (dd > res.pct) { res.pct = dd; res.peakDate = pd; res.troughDate = points[i].date; }
  }
  return res;
}
// 오늘 들고 있는 것을 전 거래일 종가로 다시 계산 (전일 대비 배지)
function ssRepriceYesterday(hold, cash) {
  if (!DS.days || DS.days.length < 2) return null;
  const y = DS.days[DS.days.length - 2];
  let v = typeof cash === 'number' && isFinite(cash) ? cash : 0;
  for (const k of Object.keys(hold || {})) {
    if (!(hold[k] > 0)) continue;
    if (!(y[k] > 0)) return null;
    v += hold[k] * y[k];
  }
  return v;
}
function ssDayChange(today, yday) {
  if (typeof today !== 'number' || !isFinite(today) || today <= 0) return null;
  if (typeof yday !== 'number' || !isFinite(yday) || yday <= 0) return null;
  return { pct: (today - yday) / yday * 100, abs: today - yday };
}

/* ═══ 05-params.js ═══ */
/* ── [STRATSIM] 05 전략 손잡이 목록 ───────────────────────────────────────
   9sig · SMA · 그냥 보유(B&H) · 현금 복리 의 조절 칸(선택지·기본값·이름).
   저장 전략·공유 링크·미리보기 막대·분석 창이 모두 이 목록 하나를 씀 */

const SS_TICK = (v) => (v === 'cash' ? '현금' : String(v).toUpperCase());
const ssRange = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(4)); return o; };
const ssOpts = (vals, lab) => vals.map((v) => [String(v), lab ? lab(v) : String(v)]);

const SS_ASSET_OPTS9 = ['tqqq', 'qld', 'sso', 'spxl', 'sqqq', 'qqq', 'spy'];
const SS_PARK_OPTS = ['cash', 'qqq', 'spy', 'qld', 'tqqq', 'sso', 'spxl', 'sqqq'];
const SS_RATE_OPTS = ssOpts([...ssRange(0, 13, 0.5), 14, 15, 16, 18, 20], (v) => (+v).toFixed(1) + '%');
const SS_COST_OPTS = ssOpts([0, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1], (v) => v + '%');
const SS_WIN_OPTS = ssOpts(ssRange(10, 300, 10));
const SS_BUF_OPTS = ssOpts([...ssRange(0, 2, 0.1), 2.5, 3, 3.5, 4, 4.5, 5, ...ssRange(6, 50, 1)], (v) => v + '%');
const SS_DAYS_OPTS = ssOpts([...ssRange(0, 15, 1), 20, 25, 30, 42, 63, 84, 105, 126],
  (v) => (v === 0 ? '즉시' : v === 42 ? '2개월' : v === 63 ? '3개월' : v === 84 ? '4개월' : v === 105 ? '5개월' : v === 126 ? '6개월' : v + '일'));

// 9sig — k: 내 키 · def: 기본값(문자열) · opts: [값, 표시]
const SS_P9 = [
  { k: 'cash', def: '40', opts: ssOpts(ssRange(0, 90, 10), (v) => v + '%') },
  { k: 'park', def: 'cash', opts: SS_PARK_OPTS.map((v) => [v, SS_TICK(v)]) },
  { k: 'ul', def: 'tqqq', opts: SS_ASSET_OPTS9.map((v) => [v, SS_TICK(v)]) },
  { k: 'cr', def: '4', opts: SS_RATE_OPTS },
  { k: 'per', def: 'quarterly', opts: [['weekly', '매주'], ['monthly', '매달'], ['quarterly', '매 분기'], ['yearly', '매년']] },
  { k: 'g', def: '9', opts: ssOpts([0.5, 0.6, 0.7, 0.8, 0.9, ...ssRange(1, 150, 1)], (v) => v + '%') },
  { k: 'cd', def: '30', opts: ssOpts([...ssRange(5, 100, 5), 110, 120, 130, 140, 150, 180], (v) => v + '%') },
  { k: 'cw', def: '24', opts: ssOpts([3, 6, 9, 12, 15, 18, 21, 24, 36, 48, 60], (v) => (v < 24 ? (v / 3) + '분기' : (v / 12) + '년')) },
  { k: 'st', def: '60', opts: ssOpts([0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100], (v) => v + '%') },
  { k: 'sp', def: '100', opts: ssOpts([0, 25, 50, 60, 70, 75, 80, 90, ...ssRange(100, 200, 10), 225, 250, 275, 300, 350, 400, 500], (v) => (v === 0 ? '끔' : v + '%')) },
  { k: 'bp', def: '90', opts: ssOpts([50, 60, 70, 75, 80, 85, 90, 95, 100], (v) => v + '%') },
  { k: 'cost', def: '0.02', opts: SS_COST_OPTS },
  { k: 'dep', def: '0', opts: ssOpts([0, 10, 25, 50, 75, 100], (v) => v + '%') },
  { k: 'rp', def: '0', opts: ssOpts(ssRange(0, 100, 5), (v) => v + '%') },
  { k: 'tc', def: 'holding', opts: [['holding', '직전 보유액'], ['target', '직전 목표액']] },
];

// SMA (이동평균 추세)
const SS_PSMA = [
  { k: 'ul', def: 'tqqq', opts: SS_ASSET_OPTS9.map((v) => [v, SS_TICK(v)]) },
  { k: 'sig', def: 'qqq', opts: ['qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'win', def: '200', opts: SS_WIN_OPTS },
  { k: 'eb', def: '0', opts: SS_BUF_OPTS },
  { k: 'xb', def: '0', opts: SS_BUF_OPTS },
  { k: 'cb', def: '0', opts: [['0', '0 (바로)'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']] },
  { k: 'cs', def: '0', opts: [['0', '0 (바로)'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']] },
  { k: 'settle', def: '1', opts: [['0', '0 (바로)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] },
  { k: 'ohw', def: '9', opts: ssOpts(ssRange(2, 30, 1)) },
  { k: 'oh', def: '90', opts: [...ssOpts(ssRange(10, 90, 5), (v) => v + ' 이상'), ['0', '끔 — 강제 매도 안 함']] },
  { k: 'coolw', def: '7', opts: ssOpts(ssRange(2, 30, 1)) },
  { k: 'cool', def: '80', opts: [...ssOpts(ssRange(10, 90, 5), (v) => v + ' 미만'), ['0', '수준 상관없이 (끔)']] },
  { k: 'out', def: 'cash', opts: ['cash', 'qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'cr', def: '4', opts: SS_RATE_OPTS },
  { k: 'din', def: '15', opts: SS_DAYS_OPTS },
  { k: 'dout', def: '15', opts: SS_DAYS_OPTS },
  { k: 'cost', def: '0.02', opts: SS_COST_OPTS },
  { k: 'bga', def: 'tqqq', opts: ['qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'bg', def: '40', opts: [...ssOpts(ssRange(5, 100, 5), (v) => '+' + v + '%'), ['0', '끔']] },
  { k: 'bgw', def: '200', opts: SS_WIN_OPTS },
];

const SS_PBH = [{ k: 'ul', def: 'tqqq', opts: ['tqqq', 'qld', 'qqq', 'spy', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) }];
// 현금 복리: r = 금리 슬라이더 위치(0~1000, 기본 200 = 4%)
const SS_PINV = [{ k: 'r', def: '200', opts: null }];

const SS_SCHEMA = { '9sig': SS_P9, sma: SS_PSMA, bh: SS_PBH, invested: SS_PINV };
const SS_PDEF = {};   // 'type.k' → 정의
for (const t in SS_SCHEMA) for (const p of SS_SCHEMA[t]) SS_PDEF[t + '.' + p.k] = p;

function ssDefaults(type) {
  const o = {};
  for (const p of SS_SCHEMA[type] || []) o[p.k] = p.def;
  return o;
}
// 저장·공유된 값이 선택지에 없으면 기본값으로 (옛 링크·손으로 고친 주소 대비)
function ssCleanParams(type, raw) {
  const out = ssDefaults(type);
  const src = raw || {};
  for (const p of SS_SCHEMA[type] || []) {
    if (!(p.k in src)) continue;
    const v = String(src[p.k]);
    if (!p.opts || p.opts.some((o) => o[0] === v)) out[p.k] = v;
    else if (type === '9sig' && p.k === 'dep' && v === '1') out[p.k] = '50';   // 옛 켬/끔 값 '1' = 50%
  }
  return out;
}
function ssParamsEqual(type, a, b) {
  for (const p of SS_SCHEMA[type] || []) if (String((a || {})[p.k]) !== String((b || {})[p.k])) return false;
  return true;
}
function ssOptLabel(type, k, v) {
  const p = SS_PDEF[type + '.' + k];
  if (!p || !p.opts) return String(v);
  const o = p.opts.find((x) => x[0] === String(v));
  return o ? o[1] : String(v);
}

// 손잡이 → 엔진 옵션 (원본의 기본값 대체 규칙 그대로: 0·빈 값이면 엔진 기본)
const ssNum = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
function ssOpts9(p) {
  return {
    growth: (+p.g) / 100 || 0.09,
    crashDrop: ssNum(p.cd, 30),
    crashMonths: +p.cw || 24,
    spike: ssNum(p.sp, 100),
    ul: SS_COL[p.ul] || 1,
    cashPct: (+p.cash || 0) / 100,
    deploy: (+p.dep || 0) / 100,
    fromTarget: p.tc === 'target' || p.tc === '1',
    buyPower: +p.bp || 90,
    park: p.park || 'cash',
    spikeReset: p.st || 'auto',
    cost: +p.cost || 0,
  };
}
function ssOptsSma(p) {
  return {
    signal: p.sig || 'qqq',
    win: +p.win || 200,
    ul: SS_COL[p.ul] || 1,
    entryBuf: +p.eb || 0,
    exitBuf: +p.xb || 0,
    ohRsi: +p.oh || 0,
    coolRsi: +p.cool || 0,
    out: p.out || 'cash',
    easeIn: +p.din || 0,
    easeOut: +p.dout || 0,
    bubble: +p.bg || 0,
    bubbleAsset: p.bga || 'qqq',
    bubbleWin: +p.bgw || 0,
    cost: +p.cost || 0,
    ohWin: +p.ohw || 10,
    coolWin: +p.coolw || 10,
    check: 'daily',
    confirmBuy: +p.cb || 0,
    confirmSell: +p.cs || 0,
    settle: +p.settle || 0,
  };
}
const ssRate9 = (p) => (+p.cr || 0) / 100;

/* ═══ 10-engine.js ═══ */
/* ── [STRATSIM] 투자전략 시뮬레이터 · 10 계산 엔진 ──────────────────────────
   ssRun9   : 9sig(목표선 리밸런싱) + 매수 후 보유 7종 + 적금 기준선(Invested Compounded)
   ssRunSma : 이동평균 추세 전략(SMA) — 버퍼·확인·RSI 과열/식음·버블 보험·분할 매수·T+N
   적립 일정 : ssSchedule (공식) — 실제 거래내역이 있으면 같은 모양의 일정을 대신 넘김      */

// 적립 일정: byMonth = 월말 거래일 기준 금액(9sig·보유·적금선), byDate/list = 달이 바뀐 첫 거래일(일별로 걷는 전략)
// 금액 = 매달 × (1+인상률)^(그해 − 시작 해)
function ssSchedule(monthly, raise, d0, d1) {
  const s = { byDate: new Map(), byMonth: new Map(), list: [], priceDateByMonth: new Map() };
  if (!(monthly > 0) || !d0 || !d1) return s;
  const y0 = +d0.slice(0, 4), amt = (d) => monthly * Math.pow(1 + (raise || 0), +d.slice(0, 4) - y0);
  if (DS.m) for (const r of DS.m) if (r[0] > d0 && r[0] <= d1) s.byMonth.set(r[0].slice(0, 7), amt(r[0]));
  if (DS.days) {
    const a = DS.idx.get(d0), b = DS.idx.get(d1);
    if (a != null && b != null) {
      let pm = null;
      for (let i = a; i <= b; i++) {
        const d = DS.days[i].date, mo = d.slice(0, 7);
        if (pm !== null && mo !== pm) { const v = amt(d); s.byDate.set(d, v); s.list.push({ date: d, amount: v }); }
        pm = mo;
      }
    }
  }
  return s;
}
// 사용자 전략에 넘기는 {날짜: 금액}
function ssContribObj(monthly, raise, d0, d1, sched) {
  const s = sched || (d0 && d1 ? ssSchedule(monthly, raise, d0, d1) : null), o = {};
  if (s && s.byDate) for (const [d, v] of s.byDate) o[d] = v;
  return o;
}
// from(제외) 다음 거래일부터 upto(제외) 전까지, 주의 마지막 거래일마다 fn(날)
function ssEachWeekEnd(from, upto, on, fn) {
  if (!on || !DS.days) return;
  const a = DS.idx.get(from), b = DS.idx.get(upto);
  if (a == null || b == null) return;
  for (let i = a + 1; i < b; i++) {
    const d = DS.days[i], nx = DS.days[i + 1];
    if (ssWeekLast(d.date, nx && nx.date)) fn(d);
  }
}
const ssIsQEndMonth = (d) => { const m = d.slice(5, 7); return m === '03' || m === '06' || m === '09' || m === '12'; };

// ── 9sig + 보유 + 적금선 ─────────────────────────────────────────────────
// o = { initial, monthly, raise, rate(전략 현금 연이율, 소수), baseRate(적금선, 없으면 rate),
//       qi0, qi1(분기 위치 — 진입은 '직전 분기말'로 이미 당겨 받음), period, rows(맞춤 기간 행), ed, xd(정확한 날짜),
//       sched, growth(0.09), crashDrop(30), crashMonths(24), spike(100, 0=끔), ul(열 1), cashPct(0.4),
//       spikeReset('auto'|%), deploy(0~1), buyPower(90), park('cash'), fromTarget, cost(%), sampleQ, sampleW, noBH }
function ssRun9(o) {
  const mRate = (o.rate || 0) / 12;
  const raise = o.raise || 0;
  const bRate = (o.baseRate != null ? +o.baseRate : (o.rate || 0)) / 12;
  const period = o.period || 'quarterly';
  const pRows = ssPeriodRows(period);
  let rows = o.rows || pRows || DS.q;
  let qi0 = o.qi0, qi1 = o.qi1;
  const growth = o.growth != null ? o.growth : 0.09;
  const crashDrop = o.crashDrop != null ? +o.crashDrop : 30;
  const crashKeep = 1 - crashDrop / 100;
  const crashMonths = o.crashMonths != null ? +o.crashMonths : 24;
  const spikePct = o.spike != null ? +o.spike : 100;
  const spikeAt = spikePct > 0 ? spikePct / 100 : Infinity;
  const ul = o.ul != null ? o.ul : 1;
  const cashPct = o.cashPct != null ? +o.cashPct : 0.4;
  const stockPct = 1 - cashPct;
  const sr = o.spikeReset;
  const resetTo = (sr == null || sr === 'auto' || sr === '') ? stockPct : +sr / 100;
  const deploy = Math.max(0, Math.min(1, o.deploy != null ? +o.deploy : 0));
  const power = Math.max(0, Math.min(1, (o.buyPower != null ? +o.buyPower : 90) / 100));
  const park = (o.park || 'cash').toLowerCase();
  const parkCol = SS_COL[park] != null ? SS_COL[park] : null;
  const cashPark = park === 'cash' || parkCol == null;
  const parkPx = (r) => (cashPark ? 1 : (r && r[parkCol]) || 0);
  const fromTarget = !!o.fromTarget;
  const cost = Math.max(0, +o.cost || 0) / 100;

  // 연간 = 진입일부터 12달마다(기념일) — 기념일 이하 마지막 월말 행. 청산일이 마지막 기념일보다 뒤면 '현재 평가' 행(리밸런스 안 함)
  let custom = false, snapAt = -1;
  if (period === 'yearly' && !o.rows) {
    const d0 = DS.q[qi0] && DS.q[qi0][0], d1 = DS.q[qi1] && DS.q[qi1][0];
    if (d0 && d1) {
      // 1년 뒤 같은 달·날 (없는 날은 Date.UTC 규칙대로 다음 달로 — 2/29 → 3/1)
      const nextYear = (iso) => new Date(Date.UTC(+iso.slice(0, 4) + 1, +iso.slice(5, 7) - 1, +iso.slice(8, 10))).toISOString().slice(0, 10);
      // 그 날짜 이하 마지막 월말 행 (없으면 null)
      const monthEndOnOrBefore = (iso) => { let k = -1; while (k + 1 < DS.m.length && DS.m[k + 1][0] <= iso) k++; return k < 0 ? null : DS.m[k]; };
      const roll = [];
      let anniv = d0;
      while (anniv <= d1) { const row = monthEndOnOrBefore(anniv); if (row) roll.push(row); anniv = nextYear(anniv); }
      const lastRoll = roll.length ? roll[roll.length - 1][0] : null;
      if (lastRoll !== null && d1 > lastRoll) {
        const tail = monthEndOnOrBefore(d1);
        if (tail && tail[0] > lastRoll) { roll.push(tail); snapAt = roll.length - 1; }
      }
      if (roll.length >= 2) { rows = roll; qi0 = 0; qi1 = roll.length - 1; custom = true; }
    }
  }
  // 분기 행이 아닌 행(주·월·연 기간 또는 맞춤 행)이면 진입·청산 날짜로 위치를 다시 찾음
  if (!custom && rows !== DS.q && ((period !== 'quarterly' && pRows) || o.rows)) {
    const d0 = o.ed || (DS.q[qi0] && DS.q[qi0][0]), d1 = o.xd || (DS.q[qi1] && DS.q[qi1][0]);
    if (d0 && d1) {
      let e = 0, x = rows.length - 1;
      for (let i = 0; i < rows.length; i++) { if (rows[i][0] <= d0) e = i; else break; }
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][0] >= d1) x = i; else break; }
      qi0 = e; qi1 = x;
    }
  }
  const fastMonths = rows === pRows || (period === 'quarterly' && rows === DS.q);
  const monthsOf = DS.mIn[period];
  const S = rows.slice(qi0, qi1 + 1);
  if (S.length < 2) return { log: [], samples: [], bh: {}, bhS: {}, contributed: o.initial };

  const initial = o.initial;
  let cash = initial * cashPct, parkSh = 0;
  if (!cashPark) { const p0 = parkPx(S[0]); parkSh = p0 > 0 ? cash / p0 : 0; }
  const fee0 = cost > 0 ? initial * stockPct * cost : 0;
  let sh = initial * stockPct * (1 - cost) / S[0][ul];
  let target = initial * stockPct;
  let prevHold = initial * stockPct * (1 - cost);
  let invested = initial, base = initial;
  const sched = o.sched || ssSchedule(o.monthly, raise, S[0][0], S[S.length - 1][0]);
  const log = [], samples = [];
  const sampleQ = !!o.sampleQ, sampleW = !!o.sampleW;
  let prevDate = S[0][0], crashSkips = 0, weekFrom = S[0][0];
  const ulKey = SS_KEY_OF[ul], parkKey = SS_KEY_OF[parkCol];
  const snap = (date, price, hv, c) => ({ date, price, holdVal: hv, cash: c, total: hv + c, target, invested, base });
  // 주간 표시 점: 지금 보유 그대로 그 주 마지막 거래일 종가로
  const fillWeeks = (upto) => {
    ssEachWeekEnd(weekFrom, upto, sampleW, (d) => {
      const px = ulKey ? d[ulKey] : 0;
      if (!(px > 0)) return;
      const c = cashPark ? cash : (parkKey && d[parkKey] > 0 ? parkSh * d[parkKey] : cash);
      samples.push(snap(d.date, px, sh * px, c));
    });
    weekFrom = upto;
  };
  const daysOf = (mk) => (sched.list && sched.list.length && DS.days)
    ? [...new Set(sched.list.filter(r => r.date.slice(0, 7) === mk).map(r => r.date))].filter(d => DS.idx.has(d)).sort() : [];
  // 마지막 행 날짜가 달 중간(그달 거래일이 더 남음)이면 그달 실제 거래내역 입금일 중 그 날까지 — 월말 행이 그 뒤라 달 처리에서 빠지는 것
  const tailDays = (qDate) => {
    if (!(sched.list && sched.list.length) || !DS.days) return [];
    const i = DS.idx.get(qDate), nx = i != null ? DS.days[i + 1] : null, mk = qDate.slice(0, 7);
    if (!nx || nx.date.slice(0, 7) !== mk) return [];
    return daysOf(mk).filter((d) => d <= qDate && d > S[0][0]);
  };

  for (let qi = 0; qi < S.length; qi++) {
    const qDate = S[qi][0], qPx = S[qi][ul];
    let fee = 0;
    if (qi === 0) {
      const hv = sh * S[0][ul];
      log.push({ date: qDate, price: S[0][ul], holdVal: hv, cash, total: hv + cash, act: { k: 'START' }, fee: fee0, invested, base, target });
      if (sampleQ || sampleW) samples.push(snap(qDate, S[0][ul], hv, cash));
      prevHold = hv; prevDate = qDate;
      continue;
    }
    let newMoney = 0;
    // 한 번의 적립(또는 인출)을 그 가격으로
    const putMoney = (px, d, mRow) => {
      const amt = sched.byDate.has(d) ? sched.byDate.get(d) : (sched.byMonth.get(d.slice(0, 7)) || 0);
      if (amt < 0) {
        let need = -amt;
        if (cashPark) { const c = Math.min(Math.max(cash, 0), need); cash -= c; need -= c; }
        else {
          const pp = mRow ? (mRow[parkCol] || 0) : 0, pv = pp > 0 ? parkSh * pp : 0, c = Math.min(pv, need);
          if (c > 0 && pp > 0) parkSh -= c / pp;
          need -= c;
        }
        if (need > 0 && px > 0 && sh > 0) {
          const g = Math.min(sh * px, need / (1 - cost));
          sh -= g / px; fee += g * cost; need -= g * (1 - cost);
        }
        if (cashPark) cash *= 1 + mRate;
      } else {
        const toStock = amt * deploy, toPark = amt - toStock;
        if (toStock > 0 && px > 0) { sh += toStock * (1 - cost) / px; fee += toStock * cost; }
        if (cashPark) { cash += (toStock > 0 && px > 0) ? toPark : amt; cash *= 1 + mRate; }
        else if (toPark > 0) {
          const pp = mRow ? (mRow[parkCol] || 0) : 0;
          if (pp > 0) parkSh += toPark / pp; else cash += toPark;
        }
      }
      invested += amt; newMoney += amt; base += amt;
      if (sampleQ && d && d < qDate && px > 0 && ssIsQEndMonth(d)) {
        const c = cashPark ? cash : (mRow && mRow[parkCol] > 0 ? parkSh * mRow[parkCol] : cash);
        samples.push(snap(d, px, sh * px, c));
      }
    };
    // 한 달: 적금선은 달마다 한 번 이자 → 실제 거래내역이면 그달 거래 날짜마다 그날 가격, 아니면 월말 행으로 한 번
    const doMonth = (mRow) => {
      base *= 1 + bRate;
      const days = daysOf(mRow[0].slice(0, 7));
      if (days.length) {
        for (const d of days) {
          fillWeeks(d);
          const dp = ulKey ? DS.days[DS.idx.get(d)][ulKey] : 0;
          putMoney(dp > 0 ? dp : mRow[ul], d, mRow);
          if ((sampleW || sampleQ) && dp > 0) {
            const c = cashPark ? cash : (mRow[parkCol] > 0 ? parkSh * mRow[parkCol] : cash);
            samples.push(snap(d, dp, sh * dp, c));
          }
        }
        fillWeeks(mRow[0]);
      } else {
        fillWeeks(mRow[0]);
        putMoney(mRow[ul], mRow[0], mRow);
      }
    };
    if (fastMonths) for (const mi of monthsOf[qi0 + qi]) doMonth(DS.m[mi]);
    else for (const r of DS.m) if (r[0] > prevDate && r[0] <= qDate) doMonth(r);
    // 마지막 행이 달 중간(정확한 청산일 · 주 단위 · 리밸런스 시점 옮김)이면 그달 월말 행은 위에서 안 돎 →
    // 실제 거래내역의 그달 입금 중 이 날까지 것을 그날 가격으로 넣음 (이자는 달마다라 덜 찬 달은 없음 · 공식 적립은 월말 금액이라 없음)
    if (qi === S.length - 1) for (const d of tailDays(qDate)) {
      fillWeeks(d);
      const row = DS.rows[DS.idx.get(d)], dp = ulKey ? DS.days[DS.idx.get(d)][ulKey] : 0;
      putMoney(dp > 0 ? dp : qPx, d, row);
      if ((sampleW || sampleQ) && dp > 0) {
        const c = cashPark ? cash : (row[parkCol] > 0 ? parkSh * row[parkCol] : cash);
        samples.push(snap(d, dp, sh * dp, c));
      }
    }
    fillWeeks(qDate);
    if (!cashPark) { const pp = parkPx(S[qi]); if (pp > 0) cash = parkSh * pp; }

    let act;
    if (qi !== snapAt) {
      target = (fromTarget ? target : prevHold) * (1 + growth) + newMoney * 0.5;
      const diff = sh * qPx - target;
      // 폭락 판단: 최근 crashMonths 개월 안 최고가의 (1−crashDrop) 아래면 매도 보류(최대 2번)
      const tm = +qDate.slice(0, 4) * 12 + (+qDate.slice(5, 7) - 1) - crashMonths;
      const since = String(Math.floor(tm / 12)).padStart(4, '0') + '-' + String((tm % 12 + 12) % 12 + 1).padStart(2, '0') + qDate.slice(7);
      let hi = qPx;
      for (let k = qi; k >= 0; k--) { if (S[k][0] < since) break; if (S[k][ul] > hi) hi = S[k][ul]; }
      const crash = qPx < hi * crashKeep;
      const pNow = parkPx(S[qi]);
      const toPark = (v) => { cash += v; if (!cashPark && pNow > 0) parkSh += v / pNow; };
      const fromPark = (v) => { cash -= v; if (!cashPark && pNow > 0) parkSh -= v / pNow; };
      if (diff > 0 && (!crash || crashSkips >= 2)) {
        sh -= diff / qPx; toPark(diff * (1 - cost)); fee += diff * cost;
        act = { k: 'SELL', amt: diff, late: crash };
        crashSkips = 0;
      } else if (diff > 0) {
        crashSkips++;
        act = { k: 'HOLD', crash: crashSkips };
      } else if (diff < 0 && cash > 0) {
        crashSkips = 0;
        const buy = Math.min(-diff, cash * power);
        if (buy > 0) {
          sh += buy * (1 - cost) / qPx; fromPark(buy); fee += buy * cost;
          act = { k: 'BUY', amt: buy, part: buy < -diff };
        } else act = { k: 'HOLD' };
      } else { crashSkips = 0; act = { k: 'HOLD' }; }
      // 급등 리셋: 이번 기간 spike% 이상 오르고 주식 비중이 리셋 비중~100% 이고 폭락 구간이 아니면 리셋 비중으로 되돌림
      const pp = S[qi - 1][ul];
      const gain = pp > 0 ? (qPx - pp) / pp : 0;
      const hv = sh * qPx, tot = hv + cash, w = tot > 0 ? hv / tot : 0;
      if (gain >= spikeAt && w >= resetTo && w <= 1 && !crash) {
        const keep = tot * resetTo, cut = hv - keep;
        sh = keep / qPx;
        cash = tot - keep - cut * cost; fee += cut * cost;
        if (!cashPark && pNow > 0) parkSh = cash / pNow;
        target = keep;
        act = { k: 'RESET', amt: cut };
      }
    } else act = { k: 'SNAPSHOT' };

    const hv = sh * qPx;
    log.push({ date: qDate, price: qPx, holdVal: hv, cash, total: hv + cash, act, fee, invested, base, target });
    if (sampleQ || sampleW) samples.push(snap(qDate, qPx, hv, cash));
    prevHold = hv; prevDate = qDate;
  }
  if (o.noBH) return { log, samples, bh: {}, bhS: {}, contributed: invested };

  // 매수 후 보유(한 종목): 시작에 전부 사고, 적립금은 그달 가격으로 계속 삼
  const holdOnly = (col, needPx) => {
    const pts = [], smp = [];
    let n = S[0][col] ? initial / S[0][col] : 0, pd = S[0][0], wf = S[0][0];
    const key = SS_KEY_OF[col];
    const weeks = (upto) => { ssEachWeekEnd(wf, upto, sampleW && !!key, (d) => { if (d[key] > 0) smp.push({ date: d.date, value: n * d[key] }); }); wf = upto; };
    const month = (mRow) => {
      const days = daysOf(mRow[0].slice(0, 7));
      if (days.length) {
        for (const d of days) {
          weeks(d);
          const dp = key ? DS.days[DS.idx.get(d)][key] : null;
          const px = dp > 0 ? dp : mRow[col];
          const amt = sched.byDate.get(d) || 0;
          if (needPx ? px : true) n += amt / px;
          if ((sampleW || sampleQ) && dp > 0) smp.push({ date: d, value: n * dp });
        }
        weeks(mRow[0]);
      } else {
        weeks(mRow[0]);
        const amt = sched.byMonth.get(mRow[0].slice(0, 7)) || 0, px = mRow[col];
        if (needPx ? px : true) n += amt / px;
        if (sampleQ && px > 0 && ssIsQEndMonth(mRow[0])) smp.push({ date: mRow[0], value: n * px });
      }
    };
    if ((sampleQ || sampleW) && S[0][col]) smp.push({ date: S[0][0], value: n * S[0][col] });
    for (let qi = 0; qi < S.length; qi++) {
      const qd = S[qi][0], qp = S[qi][col];
      if (qi > 0 && (!needPx || qp)) {
        if (fastMonths) for (const mi of monthsOf[qi0 + qi]) month(DS.m[mi]);
        else for (const r of DS.m) if (r[0] > pd && r[0] <= qd) month(r);
        // 마지막 행이 달 중간이면 실제 거래내역의 그달 그 날까지 입금도 (9sig 쪽과 같은 규칙)
        if (qi === S.length - 1) for (const d of tailDays(qd)) {
          weeks(d);
          const dp = key ? DS.days[DS.idx.get(d)][key] : null, px = dp > 0 ? dp : qp, amt = sched.byDate.get(d) || 0;
          if (needPx ? px : true) n += amt / px;
          if ((sampleW || sampleQ) && dp > 0) smp.push({ date: d, value: n * dp });
        }
        weeks(qd);
        if (sampleW && qp) smp.push({ date: qd, value: n * qp });
      }
      pts.push({ date: qd, value: qp ? n * qp : 0, price: qp, shares: n });
      pd = qd;
    }
    return { pts, smp };
  };
  const bh = {}, bhS = {};
  // TQQQ·QQQ 는 가격이 0인 기간도 적립을 셈(원본과 같게), 나머지는 그 기간 가격이 있어야
  [['tqqq', false], ['qqq', false], ['spy', true], ['qld', true], ['sso', true], ['spxl', true], ['sqqq', true]].forEach(([a, need]) => {
    const r = holdOnly(SS_COL[a], need);
    bh[a] = r.pts; bhS[a] = r.smp;
  });
  return { log, samples, bh, bhS, contributed: invested };
}

// ── SMA 추세 전략 ───────────────────────────────────────────────────────
// o = { initial, monthly, raise, rate(현금 연이율, 소수), qi0, qi1, ed, xd, sched,
//       signal('qqq'), win(200), ul(열 1), entryBuf, exitBuf(%), ohRsi, coolRsi(0=끔), ohWin, coolWin(10),
//       out('cash'), easeIn, easeOut(거래일 수), bubble(%, 0=끔), bubbleAsset, bubbleWin, cost(%),
//       check('daily'|'monthly'), confirmBuy, confirmSell, settle(거래일), dd(낙폭 기준점), sampleW }
function ssRunSma(o) {
  const sig = (o.signal || 'qqq').toLowerCase();
  const win = +o.win || 200;
  const ul = o.ul != null ? +o.ul : 1;
  const entryBuf = (+o.entryBuf || 0) / 100, exitBuf = (+o.exitBuf || 0) / 100;
  const ohLevel = +o.ohRsi || 0, coolLevel = +o.coolRsi || 0;
  const outA = (o.out || 'cash').toLowerCase();
  const easeIn = Math.max(0, +o.easeIn || 0), easeOut = Math.max(0, +o.easeOut || 0);
  const bubble = +o.bubble || 0;
  const cost = Math.max(0, +o.cost || 0) / 100;
  const ohWin = +o.ohWin || 10, coolWin = +o.coolWin || 10;
  const daily = (o.check || 'monthly') === 'daily';
  const cBuy = Math.max(0, +o.confirmBuy || 0), cSell = Math.max(0, +o.confirmSell || 0);
  const settle = Math.max(0, +o.settle || 0);
  const mRate = (o.rate || 0) / 12;
  const initial = o.initial;
  const none = { points: [], log: [], dd: null, contributed: initial };
  if (!DS.m || !DS.q) return none;
  const smaAt = ssInd('sma', sig, win, !daily);
  if (!smaAt) return none;
  const steps = daily ? DS.rows : DS.m;
  const ohAt = ssInd('rsi', sig, ohWin, !daily), coolAt = ssInd('rsi', sig, coolWin, !daily);
  const d0 = o.ed || DS.q[o.qi0][0], d1 = o.xd || DS.q[o.qi1][0];
  const sched = o.sched || ssSchedule(o.monthly, o.raise || 0, d0, d1);
  const sigCol = SS_COL[sig] || 2;
  const ulName = SS_ASSETS.find(a => SS_COL[a] === ul) || 'tqqq';
  const bgA = (o.bubbleAsset || SS_UNLEV[ulName] || 'qqq').toLowerCase();
  const bgCol = SS_COL[bgA] || SS_COL.qqq;
  const bgWin = +o.bubbleWin || win;
  const bgSma = bubble > 0 ? ssInd('sma', bgA, bgWin, !daily) : null;

  let a = 0;
  while (a < steps.length && steps[a][0] < d0) a++;
  let b = steps.length - 1;
  while (b >= 0 && steps[b][0] > d1) b--;
  if (a > b) return none;

  // 추세 판단 (들고 있을 때 / 나와 있을 때)
  const judge = (st, px, avg, ohV, coolV) => {
    if (avg == null || px <= 0) return st;
    const hot = ohLevel > 0 && ohV != null && ohV >= ohLevel;
    if (st === 'in') return hot ? 'out' : (px < avg * (1 - exitBuf) ? 'out' : 'in');
    if (hot) return 'out';
    if (coolLevel > 0 && coolV != null && coolV >= coolLevel) return 'out';
    return px > avg * (1 + entryBuf) ? 'in' : 'out';
  };
  const bubbleState = (px, avg) => (!avg || avg <= 0 || px <= 0) ? 'normal' : (bubble > 0 && (px / avg - 1) * 100 >= bubble ? 'gtfo' : 'normal');
  const wantAsset = (st, bg) => (bg === 'gtfo' ? 'cash' : st === 'out' ? outA : ulName);

  const r0 = steps[a];
  let state = smaAt[a] == null ? 'in' : ((r0[sigCol] || 0) > smaAt[a] ? 'in' : 'out');
  if (state === 'in' && ohLevel > 0 && ohAt && ohAt[a] != null && ohAt[a] >= ohLevel) state = 'out';
  let pend = state, pendN = 0;
  let bg = bubbleState(r0[bgCol] || 0, bgSma ? bgSma[a] : null);
  let byBubble = bg === 'gtfo';
  const sh = { tqqq: 0, qqq: 0, spy: 0, qld: 0, sso: 0, spxl: 0, sqqq: 0 };
  let cash = initial, invested = initial, lastAmt = 0;
  const px = (row, k) => { const c = SS_COL[k]; return c != null ? (row[c] || 0) : 0; };
  let tgt = wantAsset(state, bg);
  if (tgt !== 'cash') { const p0 = px(r0, tgt); if (p0 > 0) { sh[tgt] = cash * (1 - cost) / p0; cash = 0; } }
  let ease = 0, lastSell = a - 1e9, lastBuy = a - 1e9;
  const value = (row) => { let v = 0; for (const k of SS_ASSETS) if (sh[k] > 0) v += sh[k] * (px(row, k) || 0); return v + cash; };
  const biggest = (row) => { let best = 'cash', bv = cash; for (const k of SS_ASSETS) if (sh[k] > 0) { const v = sh[k] * (px(row, k) || 0); if (v > bv) { bv = v; best = k; } } return best; };
  const shSum = () => sh.tqqq + sh.qqq + sh.spy + sh.qld + sh.sso + sh.spxl + sh.sqqq;
  const holding = () => { const h = {}; for (const k of SS_ASSETS) if (sh[k] > 0) h[k] = sh[k]; return h; };
  let held = biggest(r0);
  const points = [{ date: r0[0], value: value(r0), state }];
  const ul0 = r0[ul] || 0;
  const log = [{ date: r0[0], state, held, action: 'START', fee: held !== 'cash' ? initial * cost : 0, price: ul0, shares: shSum(), stockVal: value(r0) - cash, cash, total: value(r0), invested: initial }];
  const qEnd = new Set();
  for (let q = o.qi0; q <= o.qi1; q++) qEnd.add(DS.q[q][0]);
  const dd = o.dd ? [{ date: r0[0], h: holding(), cash }] : null;
  let ready = tgt === 'cash' ? true : (ul0 > 0 && px(r0, tgt) > 0);
  let pMonth = r0[0].slice(0, 7);

  for (let m = a + 1; m <= b; m++) {
    const row = steps[m], d = row[0], ulPx = row[ul] || 0;
    const mo = d.slice(0, 7), newMonth = mo !== pMonth;
    pMonth = mo;
    if (newMonth && cash > 0) cash *= 1 + mRate;
    const moneyDay = sched.byDate.has(d);
    if (moneyDay) {
      lastAmt = sched.byDate.get(d) || 0;
      invested += lastAmt;
      if (lastAmt < 0) {
        let need = -lastAmt;
        const c = Math.min(Math.max(cash, 0), need);
        cash -= c; need -= c;
        if (need > 0) for (const k of SS_ASSETS) {
          if (need <= 0 || sh[k] <= 0) continue;
          const p = px(row, k);
          if (p <= 0) continue;
          const g = Math.min(sh[k] * p, need / (1 - cost));
          sh[k] -= g / p; need -= g * (1 - cost);
        }
      } else cash += lastAmt;
    }
    // 확인 필터: 바뀐 신호가 정한 횟수만큼 이어져야 실제로 바꿈
    const bgBefore = bg;
    const want = judge(state, row[sigCol] || 0, smaAt[m], ohAt ? ohAt[m] : null, coolAt ? coolAt[m] : null);
    if (want !== state) {
      if (want === pend) pendN++; else { pend = want; pendN = 1; }
      const need = want === 'in' ? cBuy : cSell;
      if (need <= 1 || pendN >= need) { state = want; pendN = 0; }
    } else { pend = state; pendN = 0; }
    bg = bubbleState(row[bgCol] || 0, bgSma ? bgSma[m] : null);
    const before = tgt;
    tgt = wantAsset(state, bg);
    if (!ready) ready = tgt === 'cash' || px(row, tgt) > 0;
    const canSell = settle === 0 || m - lastBuy >= settle;
    if (tgt !== before) ease = (tgt === 'cash' || bg !== 'normal' || bgBefore !== 'normal') ? 0 : (tgt === ulName ? easeIn || 0 : easeOut || 0);
    let sellFee = 0, sold = false;
    if (canSell) {
      for (const k of SS_ASSETS) {
        if (k !== tgt && sh[k] > 0) {
          const p = px(row, k);
          if (p > 0) { const v = sh[k] * p; cash += v * (1 - cost); sellFee += v * cost; sh[k] = 0; sold = true; }
        }
      }
      if (sold) lastSell = m;
    }
    const entry = (action, h, fee, extra) => {
      const r = { date: d, state, held: h, action, fee: fee || 0, price: ulPx, shares: shSum(), stockVal: value(row) - cash, cash, total: value(row), invested };
      if (extra != null) r.contribAmt = extra;
      log.push(r);
    };
    let traded = false;
    if (sold) { entry(bg === 'gtfo' ? 'BG-GTFO' : 'EXIT', 'cash', sellFee); held = 'cash'; byBubble = bg === 'gtfo'; traded = true; }
    const canBuy = settle === 0 || m - lastSell >= settle;
    if (canBuy && ready && tgt !== 'cash' && cash > 0) {
      const p = px(row, tgt);
      if (p > 0) {
        const easing = ease > 0;
        let amt;
        if (ease > 1) { amt = cash * (1 / ease); sh[tgt] += amt * (1 - cost) / p; cash -= amt; ease--; }
        else { amt = cash; sh[tgt] += amt * (1 - cost) / p; cash = 0; if (ease === 1) ease = 0; }
        lastBuy = m;
        const topUp = held === tgt;
        if (topUp && !easing && moneyDay) entry('CONTRIB', tgt, amt * cost, lastAmt);
        else {
          entry(topUp ? 'DCA-ADD' : byBubble ? 'BG-CLEAR' : (tgt === ulName ? 'ENTER' : 'EXIT'), tgt, amt * cost);
          held = tgt;
          if (!topUp) byBubble = false;
        }
        traded = true;
      }
    }
    if (!traded && moneyDay && lastAmt > 0) entry('CONTRIB', held, 0, lastAmt);
    if (dd) dd.push({ date: d, h: holding(), cash });
    if (qEnd.has(d) || (o.sampleW && ssWeekLast(d, steps[m + 1] && steps[m + 1][0]))) points.push({ date: d, value: value(row), state });
  }
  const last = steps[b];
  // 청산일이 분기말이 아니면(정확한 날짜) 그날 값도 점으로 — 없으면 화면 끝 값이 직전 분기말 값으로 남았음
  if (last && points[points.length - 1].date !== last[0]) points.push({ date: last[0], value: value(last), state });
  if (last && (!log.length || log[log.length - 1].date !== last[0])) {
    log.push({ date: last[0], state, held: biggest(last), action: 'END', fee: 0, price: last[ul] || 0, shares: shSum(), stockVal: value(last) - cash, cash, total: value(last), invested });
  }
  return { points, log, dd, contributed: invested };
}

/* ═══ 20-sandbox.js ═══ */
/* ── [STRATSIM] 20 사용자 전략 실행 (격리 Worker) ──────────────────────────
   사용자·공유 링크로 받은 전략 코드는 절대 이 페이지(메인 스레드)에서 돌리지 않음:
   blob Worker 안에서만 실행 — DOM·저장소·쿠키 없음 + 네트워크·저장 API 를 모두 지우고
   4초가 넘으면 Worker 를 죽임. 주고받는 것은 시장 자료와 숫자·글자뿐.
   (사이트 로그인 정보는 localStorage 에 있으므로 Worker 에선 닿을 수 없음)
   계약(전략 객체 { name, params, columns, lines, run(data, p) })은 원본과 같게 — 원본용으로
   만든 코드도 그대로 붙여 넣어 돌아감 */

// 사용자 전략에 넘기는 자료 (전체 일봉 — 한 번 만들어 둠)
let _ssCustomData = null;
function ssCustomData() {
  if (_ssCustomData) return _ssCustomData;
  const d = DS.days || [];
  const col = (k) => d.map((r) => r[k] || 0);
  _ssCustomData = {
    dates: d.map((r) => r.date),
    tqqq: d.map((r) => r.tqqq), qqq: d.map((r) => r.qqq), spy: d.map((r) => r.spy),
    qld: d.map((r) => r.qld), sso: d.map((r) => r.sso), spxl: d.map((r) => r.spxl), sqqq: col('sqqq'),
    nfci: DS.nfci ? DS.nfci.slice() : d.map(() => NaN),
  };
  return _ssCustomData;
}

// Worker 안에서 도는 함수 (문자열로 바꿔 blob 으로 실행 — 메인 스레드에서 부르지 않음)
function ssWorkerMain() {
  'use strict';
  // 밖으로 나가거나 남길 수 있는 것은 전부 지움 — 자기 자신과 원형(prototype) 사슬 모두
  var BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches',
    'Notification', 'SharedWorker', 'Worker', 'BroadcastChannel', 'Request', 'navigator', 'location', 'RTCPeerConnection', 'FileReaderSync'];
  BLOCK.forEach(function (k) {
    for (var o = self; o; o = Object.getPrototypeOf(o)) {
      try { if (Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) {}
    }
    try { self[k] = undefined; } catch (e) {}
  });
  var DATA = null;
  function clean(raw) {
    var s = String(raw || '').trim();
    var f = s.match(/```[a-zA-Z0-9]*\s*([\s\S]*?)```/);
    if (f) s = f[1].trim();
    s = s.replace(/^\s*(?:module\.exports\s*=|export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*/, '').trim();
    return s.replace(/;\s*$/, '').trim();
  }
  function asStrategy(m) {
    if (typeof m === 'function') return { name: null, run: m, params: undefined };
    if (m && typeof m.run === 'function') return { name: m.name || null, run: m.run, params: m.params, columns: m.columns, lines: m.lines };
    return null;
  }
  function str(v) { return v == null ? null : String(v); }
  function cols(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c) continue;
      if (typeof c === 'string') { out.push({ key: c }); continue; }
      if (c.key == null) continue;
      out.push({ key: String(c.key), label: str(c.label), tip: c.tip != null ? String(c.tip) : str(c.tooltip) });
    }
    return out.length ? out : null;
  }
  function lines(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 6; i++) {
      var l = raw[i];
      if (!l) continue;
      if (typeof l === 'string') { out.push({ key: l, label: l }); continue; }
      if (l.key == null) continue;
      out.push({ key: String(l.key), label: l.label != null ? String(l.label) : String(l.key) });
    }
    return out.length ? out : null;
  }
  function signals(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var cards = [], reasons = [], d = null, i, c, r;
    if (Array.isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length && cards.length < 12; i++) {
        c = raw.cards[i];
        if (!c || c.label == null) continue;
        cards.push({ label: str(c.label), value: str(c.value), sub: str(c.sub), tip: str(c.tip), tone: str(c.tone), icon: str(c.icon),
          delta: (c.delta && typeof c.delta === 'object' && c.delta.text != null) ? { text: str(c.delta.text), tone: str(c.delta.tone) } : null });
      }
    }
    if (raw.decision && typeof raw.decision === 'object') {
      if (Array.isArray(raw.decision.reasons)) {
        for (i = 0; i < raw.decision.reasons.length && reasons.length < 10; i++) {
          r = raw.decision.reasons[i];
          if (!r || r.name == null) continue;
          reasons.push({ name: str(r.name), val: str(r.val), tag: str(r.tag), lean: str(r.lean) });
        }
      }
      d = { action: str(raw.decision.action), note: str(raw.decision.note), tone: str(raw.decision.tone), reasons: reasons };
    }
    if (!cards.length && !d) return null;
    return { cards: cards, decision: d, asOf: str(raw.asOf) };
  }
  // 붙여 넣은 글에서 전략 객체를 찾음 — 괄호·코드 울타리·앞뒤 글이 섞여도 몇 가지 후보로 시도
  function evalStrategy(code) {
    var base = clean(code), cands = [base], t = base, k;
    for (k = 0; k < 4 && /^\(/.test(t) && /\)$/.test(t); k++) { t = t.slice(1, -1).trim(); cands.push(t); }
    var fo = Math.min.apply(null, ['{', '('].map(function (ch) { var i = base.indexOf(ch); return i < 0 ? Infinity : i; }));
    var lc = Math.max(base.lastIndexOf('}'), base.lastIndexOf(')'));
    if (isFinite(fo) && fo > 0 && lc > fo) cands.push(base.slice(fo, lc + 1));
    var fb = base.indexOf('{'), lb = base.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cands.push(base.slice(fb, lb + 1));
    if (base.length > 4 && /^\(\{/.test(base) && /\}\)$/.test(base)) cands.push(base.slice(2, -2).trim());
    var mod = null, lastErr;
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci]; if (!c) continue;
      try { var a = asStrategy((new Function('"use strict"; return (' + c + '\n);'))()); if (a) { mod = a; break; } } catch (e) { lastErr = e; }
      try { var b = asStrategy((new Function('"use strict";\n' + c + '\n'))()); if (b) { mod = b; break; } } catch (e2) { lastErr = e2; }
    }
    if (!mod) throw new Error('전략을 읽지 못했습니다 — run(data, p) 함수이거나 그 함수를 가진 객체여야 합니다(앞뒤 설명 글 없이). ' + (lastErr ? lastErr.message : ''));
    return mod;
  }
  function coerce(sp, raw) {
    var isBool = sp.type === 'bool' || sp.type === 'boolean' || (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean') || typeof sp.default === 'boolean';
    if (isBool) return raw === true || raw === 'true' || raw === '1' || raw === 1;
    var isNum = sp.type === 'number' || 'min' in sp || 'max' in sp || 'step' in sp || (Array.isArray(sp.options) && typeof sp.options[0] === 'number') || typeof sp.default === 'number';
    if (isNum) { var n = Number(raw); return isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
    return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
  }
  self.onmessage = function (e) {
    var msg = e.data || {};
    if (msg.type === 'data') { DATA = msg.data; return; }
    if (msg.type !== 'run') return;
    var out;
    try {
      var mod = evalStrategy(msg.code);
      var schema = Array.isArray(mod.params) ? mod.params : [];
      try { schema = JSON.parse(JSON.stringify(schema)); } catch (e0) { schema = []; }
      var p = {}, g = msg.globals || {}, key;
      for (key in g) p[key] = g[key];
      var raw = msg.rawParams || {};
      for (var si = 0; si < schema.length; si++) {
        var sp = schema[si];
        if (sp && sp.id != null) p[sp.id] = coerce(sp, (raw && (sp.id in raw)) ? raw[sp.id] : sp.default);
      }
      var res = mod.run(DATA, p);
      var rawLog = Array.isArray(res) ? res : (res && Array.isArray(res.log) ? res.log : null);
      if (!rawLog) throw new Error('run() 은 { date, value } 배열(또는 { log: [...] })을 돌려줘야 합니다.');
      var log = [];
      for (var li = 0; li < rawLog.length; li++) {
        var row = rawLog[li]; if (!row || row.date == null) continue;
        var o = {}, rk;
        for (rk in row) { var rv = row[rk]; if (typeof rv === 'number' || typeof rv === 'string' || typeof rv === 'boolean') o[rk] = rv; }
        log.push(o);
      }
      out = { reqId: msg.reqId, schema: schema, name: mod.name || null, log: log,
        columns: cols(res && res.columns) || cols(mod.columns), signals: signals(res && res.signals),
        lines: lines(res && res.lines) || lines(mod.lines),
        totalContributed: (res && typeof res.totalContributed === 'number') ? res.totalContributed : null };
    } catch (err) {
      out = { reqId: msg.reqId, error: (err && err.message) ? err.message : String(err) };
    }
    self.postMessage(out);
  };
}

// 메인 스레드와 같은 형변환 (저장된 값 → 전략이 받는 값)
function ssCoerce(sp, raw) {
  const isBool = sp.type === 'bool' || sp.type === 'boolean' || (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean') || typeof sp.default === 'boolean';
  if (isBool) return raw === true || raw === 'true' || raw === '1' || raw === 1;
  const isNum = sp.type === 'number' || 'min' in sp || 'max' in sp || 'step' in sp || (Array.isArray(sp.options) && typeof sp.options[0] === 'number') || typeof sp.default === 'number';
  if (isNum) { const n = Number(raw); return Number.isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
  return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
}

// ── 실행 관리 ──────────────────────────────────────────────────────────
const SB = {
  w: null, seq: 0, dataSent: false,
  pending: {},       // reqId → { id, sig, timer } 또는 { cb, timer }
  timers: {},        // cfgId → { sig, t } (보내기 대기)
  lastFire: {},      // cfgId → 마지막으로 보낸 시각
  res: {},           // cfgId → { sig, log, schema, columns, signals, lines, name, error, totalContributed }
  yday: {},          // cfgId → { sig, value, error } (전일 대비 배지)
  prevQ: [], prevN: 0,  // 미리보기 막대 대기열 (동시 2개)
  pcache: {},        // 미리보기 결과 (key → 최종값)
  onResult: null,    // 결과가 오면 부를 함수 (앱이 render 로 채움)
  onName: null,      // 전략 이름을 코드에서 받았을 때
};
const SS_TIMEOUT = 4000, SS_THROTTLE = 150, SS_PREV_MAX = 2;

function ssWorker() {
  if (SB.w) return SB.w;
  try {
    const url = URL.createObjectURL(new Blob(['(' + ssWorkerMain.toString() + ')()'], { type: 'application/javascript' }));
    const w = new Worker(url);
    w.onmessage = ssOnWorkerMsg;
    w.onerror = () => { try { w.terminate(); } catch (e) {} SB.w = null; SB.dataSent = false; };
    SB.w = w; SB.dataSent = false;
  } catch (e) { SB.w = null; }
  return SB.w;
}
function ssSendData() {
  const w = ssWorker();
  if (!w || SB.dataSent) return;
  w.postMessage({ type: 'data', data: ssCustomData() });
  SB.dataSent = true;
}
function ssKillWorker() { try { SB.w && SB.w.terminate(); } catch (e) {} SB.w = null; SB.dataSent = false; }

// 전략이 받는 공통 값 (p.initial · p.contributions · p.startIdx … )
function ssCustomGlobals(ctx) {
  const entryDate = ctx.ed || (DS.q[ctx.qi0] || [])[0] || null;
  const exitDate = ctx.xd || (DS.q[ctx.qi1] || [])[0] || null;
  let startIdx = 0, endIdx = 0;
  const s = DS.idx.get(entryDate), e = DS.idx.get(exitDate);
  if (s != null) startIdx = s;
  if (e != null) endIdx = e;
  if (!endIdx) endIdx = Math.max(0, DS.days.length - 1);
  const contributions = ssContribObj(ctx.monthly, ctx.raise, entryDate, exitDate, ctx.sched);
  return { initial: ctx.initial, monthly: ctx.monthly, annualRaise: ctx.raise, startIdx, endIdx, entryDate, exitDate, contributions, weeklyDisplay: ctx.grain === 'weekly' };
}
function ssCustomSig(cfg, ctx) {
  const sk = ctx.sched && ctx.sched.list ? ctx.sched.list.map((r) => r.date + ':' + r.amount).join(',') : '';
  return [cfg.code || '', JSON.stringify(cfg.params || {}), ctx.initial, ctx.monthly, ctx.raise, ctx.qi0, ctx.qi1, ctx.ed || '', ctx.xd || '', sk, ctx.grain || ''].join('|');
}

// 같은 전략의 실행은 하나씩만 · 끄는 중에도 150ms 마다 새 값으로 (끌기 중에도 선이 따라옴)
function ssScheduleRun(id, code, params, sig, globals) {
  for (const k in SB.pending) if (SB.pending[k].id === id && SB.pending[k].sig === sig) return;
  if (SB.timers[id] && SB.timers[id].sig === sig) return;
  for (const k in SB.pending) if (SB.pending[k].id === id) return;     // 돌아오면 render 가 다시 부름
  if (SB.timers[id]) clearTimeout(SB.timers[id].t);
  const wait = Math.max(0, SS_THROTTLE - (Date.now() - (SB.lastFire[id] || 0)));
  SB.timers[id] = { sig, t: setTimeout(() => { delete SB.timers[id]; SB.lastFire[id] = Date.now(); ssPost(id, code, params, sig, globals); }, wait) };
}
function ssPost(id, code, params, sig, globals) {
  const isY = /::yday$/.test(id);
  const fail = (error) => {
    if (isY) SB.yday[id.slice(0, -6)] = { sig, value: null, error };
    else SB.res[id] = { sig, log: [], schema: (SB.res[id] && SB.res[id].schema) || [], error };
    if (SB.onResult) SB.onResult(id);
  };
  const w = ssWorker();
  if (!w) { fail('이 브라우저에서는 격리 실행(Web Worker)을 쓸 수 없습니다.'); return; }
  ssSendData();
  const reqId = ++SB.seq;
  const timer = setTimeout(() => { delete SB.pending[reqId]; ssKillWorker(); fail('시간이 너무 오래 걸려 멈췄습니다 — 끝나지 않는 반복이 있는지 확인해 주세요.'); }, SS_TIMEOUT);
  SB.pending[reqId] = { id, sig, timer };
  w.postMessage({ type: 'run', reqId, code, globals, rawParams: params || {} });
}
// 미리보기 막대용 1회 실행 (결과는 cb 로만 — 본 선 캐시엔 안 넣음)
function ssPreviewRun(code, params, globals, cb) { SB.prevQ.push({ code, params, globals, cb }); ssPumpPreview(); }
function ssClearPreview() { SB.prevQ.length = 0; }
function ssPumpPreview() { while (SB.prevN < SS_PREV_MAX && SB.prevQ.length) ssStartPreview(SB.prevQ.shift()); }
function ssStartPreview(job) {
  const w = ssWorker();
  if (!w) { job.cb(null, 'no-sandbox'); return; }
  ssSendData();
  const reqId = ++SB.seq;
  SB.prevN++;
  let done = false;
  const finish = (msg, err) => { if (done) return; done = true; SB.prevN--; try { job.cb(msg, err); } finally { ssPumpPreview(); } };
  const timer = setTimeout(() => { delete SB.pending[reqId]; ssKillWorker(); finish(null, 'timeout'); }, SS_TIMEOUT);
  SB.pending[reqId] = { cb: finish, timer };
  w.postMessage({ type: 'run', reqId, code: job.code, globals: job.globals, rawParams: job.params || {} });
}
function ssOnWorkerMsg(e) {
  const msg = e.data || {};
  const pend = SB.pending[msg.reqId];
  if (!pend) return;
  clearTimeout(pend.timer);
  delete SB.pending[msg.reqId];
  if (pend.cb) { pend.cb(msg, msg.error); return; }
  if (/::yday$/.test(pend.id)) {
    const log = msg.log || [], last = log.length ? log[log.length - 1] : null;
    SB.yday[pend.id.slice(0, -6)] = { sig: pend.sig, value: last && typeof last.value === 'number' && isFinite(last.value) ? last.value : null, error: msg.error || null };
    if (SB.onResult) SB.onResult(pend.id, true);
    return;
  }
  SB.res[pend.id] = { sig: pend.sig, log: msg.log || [], schema: msg.schema || [], columns: msg.columns || null, signals: msg.signals || null,
    lines: msg.lines || null, name: msg.name || null, error: msg.error || null, totalContributed: typeof msg.totalContributed === 'number' ? msg.totalContributed : null };
  if (msg.name && SB.onName) SB.onName(pend.id, msg.name);
  if (SB.onResult) SB.onResult(pend.id);
}

// 라이브러리 카드용: 우리 사이트가 직접 쓴 전략 코드(1차 코드)는 메인 스레드에서 바로 실행
// (사용자·공유 코드는 이 함수를 절대 쓰지 않음 — 위 Worker 로만)
function ssEvalTrusted(code) {
  const s = String(code || '').trim();
  const m = (new Function('"use strict"; return (' + s + '\n);'))();
  if (typeof m === 'function') return { run: m, params: [] };
  if (m && typeof m.run === 'function') return m;
  throw new Error('bad library code');
}
function ssRunTrusted(mod, globals, raw) {
  const p = Object.assign({}, globals);
  for (const sp of (Array.isArray(mod.params) ? mod.params : [])) if (sp && sp.id != null) p[sp.id] = ssCoerce(sp, raw && sp.id in raw ? raw[sp.id] : sp.default);
  const res = mod.run(ssCustomData(), p);
  return Array.isArray(res) ? { log: res } : (res || { log: [] });
}

/* ═══ 30-library.js ═══ */
/* ── [STRATSIM] 30 전략 라이브러리 ─────────────────────────────────────────
   레버리지 ETF 로 많이 알려진 타이밍·회전 전략 + 직접 고른 전략 + 과최적화 탐색 1위 설정, 모두 44개.
   카드 숫자(5개 시기의 연평균·최대 낙폭, 1995년부터의 분기 곡선)는 창을 열 때 이 앱 자료로 직접 계산 —
   미리 적어 둔 값이 없어 자료가 갱신되면 그대로 따라감. 계산 규칙은 원본 Strategies Simulator 와 같음.
   '써 보기' = 저장 전략으로 추가 (프리셋 → 기본 9sig/SMA 엔진, 코드 → 사용자 전략: 격리 Worker 에서 실행)
   코드 문자열은 하나하나가 혼자 돌아가야 함(저장된 사본은 Worker 안에서 따로 실행) → 공용 조각을 글자 그대로 끼워 넣음 */

// ── 전략 코드 공용 조각 (문자열로 각 코드 안에 들어감) ───────────────────────
const SLK_STAT_SMA = '{ id: "stat", label: "중심선", options: [{ value: "sma", label: "이동평균" }, { value: "median", label: "중앙값" }], default: "sma" }';
const SLK_STAT_MED = '{ id: "stat", label: "중심선", options: [{ value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" }], default: "median" }';
const SLK_ASSET6 = `{ id: "asset", label: "매매 종목", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] }`;
const SLK_COST13 = '{ id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [0, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1] }';
const SLK_RATE15 = '{ id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8] }';

// 중심선: 그날까지 W 거래일 안의 양수 종가로 평균(sma) 또는 중앙값(median)
const SLK_LINE = `    // 중심선 — 그날까지 W 거래일 안의 양수 종가로 평균 또는 중앙값 (p.stat)
    // 평균은 날마다 같은 순서로 처음부터 다시 더하고, 중앙값은 정렬된 창을 하루씩 밀어 빠르게 구함
    const lineOf = (arr, W) => {
      const med = p.stat === "median";
      let win = null, at = -2;
      const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      return (i) => {
        const from = Math.max(0, i - W + 1);
        if (!med) {
          let s = 0, n = 0;
          for (let k = from; k <= i; k++) if (arr[k] > 0) { s += arr[k]; n++; }
          return n ? s / n : 0;
        }
        if (win === null || i !== at + 1) {
          win = [];
          for (let k = from; k <= i; k++) if (arr[k] > 0) win.push(arr[k]);
          win.sort((a, b) => a - b);
        } else {
          if (arr[i] > 0) win.splice(pos(arr[i]), 0, arr[i]);
          const out = i - W;
          if (out >= 0 && arr[out] > 0) win.splice(pos(arr[out]), 1);
        }
        at = i;
        const n = win.length;
        return n === 0 ? 0 : n % 2 ? win[(n - 1) / 2] : (win[n / 2 - 1] + win[n / 2]) / 2;
      };
    };`;

// 기록 간격 (차트 가로축이 주 단위면 주의 마지막 거래일, 아니면 달의 마지막 거래일)
const SLK_TICK = `      // 기록 줄 간격 — 차트 가로축이 주 단위면 주의 마지막 거래일, 아니면 달의 마지막 거래일
      const tick = i === p.endIdx || (p.weeklyDisplay
        ? Math.floor((Date.parse(data.dates[i]) / 864e5 + 3) / 7) !== Math.floor((Date.parse(data.dates[i + 1]) / 864e5 + 3) / 7)
        : data.dates[i + 1].slice(0, 7) !== data.dates[i].slice(0, 7));`;

// 들어온 돈 (출금은 음수) — 한 종목(sh, lev[i]) 전략
const SLK_MONEY1 = `      let contributed = 0, action = "hold";
      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 모자란 만큼 오늘 종가로 팔고 현금은 0 — 계좌는 0 아래로 내려가지 않음
          const cut = Math.min(sh * (lev[i] || 0), -cash);
          if (cut > 0) sh = Math.max(0, sh - cut / lev[i]);
          cash = 0;
        }
      }`;
// 두 종목을 들고 있을 수 있는 전략 (a 먼저, 그다음 b 를 팔아 출금을 메움)
const slkMoney2 = (a, pa, b, pb, la, lb) => `      let contributed = 0, action = "hold";
      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 ${la} 먼저, 그다음 ${lb} 를 오늘 종가로 팔아 메우고 현금은 0 (계좌는 0 아래로 안 감)
          let cut = Math.min(${a} * (${pa} || 0), -cash);
          if (cut > 0) { ${a} = Math.max(0, ${a} - cut / ${pa}); cash += cut; }
          cut = Math.min(${b} * (${pb} || 0), -cash);
          if (cut > 0) { ${b} = Math.max(0, ${b} - cut / ${pb}); cash += cut; }
          cash = 0;
        }
      }`;
// 수수료를 따지는 전략: 들고 있는 것(held)을 비용까지 감안해 필요한 만큼 판매
const slkMoneyHeld = (traded) => `      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; invested += amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 들고 있는 것을 오늘 종가로 필요한 만큼(비용 포함) 팔고 현금은 0
          const hx = priceOf(held, i), g = Math.min(shares * hx, -cash / (1 - cost));
          if (g > 0) { shares = Math.max(0, shares - g / hx); fee += g * cost;${traded ? ' traded += g;' : ''} note = "출금 — " + held.toUpperCase() + " 일부 매도"; }
          cash = 0;
        }
      }`;
const SLK_LOG1 = `      if (contributed !== 0 || action === "buy" || action === "sell" || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });`;
// 매일 판단 — up 이면 lev 보유, 아니면 현금 (팔 때 판 금액을 현금에 더함 — 그날 들어온 적립금이 사라지지 않게)
const SLK_DAILY = `      if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
      else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }`;
// 와일더 RSI 를 시작 전 back 거래일부터 데움 (sig 기준)
const slkRsiSeed = (RW, back) => `    // RSI(${RW}) — 시작 ${back}거래일 전부터 와일더 방식으로 미리 데움
    const RW = ${RW};
    let au = 0, ad = 0;
    const s0 = Math.max(1, p.startIdx - ${back});
    for (let k = s0; k < s0 + RW && k <= p.startIdx; k++) { const d = sig[k] - sig[k - 1]; if (d > 0) au += d; else ad -= d; }
    au /= RW; ad /= RW;
    for (let k = s0 + RW; k < p.startIdx; k++) { const d = sig[k] - sig[k - 1]; au = (au * (RW - 1) + (d > 0 ? d : 0)) / RW; ad = (ad * (RW - 1) + (d < 0 ? -d : 0)) / RW; }`;
const SLK_RSI_STEP = `      const d = sig[i] - sig[i - 1];
      au = (au * (RW - 1) + (d > 0 ? d : 0)) / RW; ad = (ad * (RW - 1) + (d < 0 ? -d : 0)) / RW;
      const rsi = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);`;

// 한 종목 ↔ 현금, 매일 판단하는 단순 타이밍 전략의 코드
function slDailyCode(o) {
  return `{
  name: ${JSON.stringify(o.name)},
  params: [
    ${o.params.join(',\n    ')}
  ],
  run(data, p) {
    // ${o.about}
    const log = [], ${o.vars};
${SLK_LINE}
${o.setup}
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
${o.day}
${SLK_DAILY}
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;
}
const slkWin = (opts, def) => '{ id: "window", label: "기간 (일)", options: [' + opts.join(', ') + '], default: ' + (def || 200) + ' }';
const SLK_SIG_LINE = '      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c;';

const SL_CODE = {};

// #1 Faber — QQQ 를 중심선과 비교, 달의 마지막 거래일에만 판단
SL_CODE[1] = `{
  name: "Faber 10개월·200일 (월말 판단) → TQQQ/현금",
  params: [
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // QQQ 종가가 중심선 위면 TQQQ, 아래면 현금(이자 없음). 판단은 달의 마지막 거래일(다음 거래일이 다른 달)에만 —
    // 차트 가로축이 주 단위여도, 계산이 달 중간에 끝나도 그대로 (기록 줄 간격과는 따로)
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], nx = data.dates[i + 1];
      if (nx !== undefined && nx.slice(0, 7) !== data.dates[i].slice(0, 7)) {
        const c = line(i), up = c > 0 && sig[i] > c;
        if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
${SLK_TICK}
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[2] = slDailyCode({
  name: 'Gayed LRS 3배 — SPY 200일선 → SPXL/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SPXL(S&P 3배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.spxl',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[3] = slDailyCode({
  name: 'Gayed LRS 2배 — SPY 200일선 → SSO/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SSO(S&P 2배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.sso',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});

// #8 Siegel — 위아래 대칭 띠, 띠 안에서는 그대로
SL_CODE[8] = `{
  name: "Siegel ±띠 — SPY 200일선 → TQQQ/현금",
  params: [
    { id: "band", label: "띠 (중심선 ± %)", options: [0, 1, 2, 3], default: 1 },
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: SPY 가 중심선 + 띠 이상이면 TQQQ, 중심선 − 띠 이하면 현금(이자 없음). 띠 안에서는 그대로 둠
    const log = [], sig = data.spy, lev = data.tqqq, hiK = 1 + p.band / 100, loK = 1 - p.band / 100;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const c = line(i), px = lev[i], s = sig[i];
      if (c > 0 && s > 0) {
        if (!inMkt && s >= c * hiK && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (inMkt && s <= c * loK) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[9] = slDailyCode({
  name: 'TQQQ 표준 200일선 — 신호 SPY/QQQ → TQQQ/현금',
  params: ['{ id: "signal", label: "신호 종목", options: [{ value: "spy", label: "SPY" }, { value: "qqq", label: "QQQ" }], default: "spy" }', slkWin([100, 150, 200, 250]), SLK_STAT_SMA],
  about: '매일: 신호 종목이 중심선 위면 TQQQ, 아래면 현금(이자 없음)',
  vars: 'sig = data[p.signal], lev = data.tqqq',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[10] = slDailyCode({
  name: 'QQQ 200일선 → TQQQ, 아니면 현금',
  params: [
    '{ id: "signal", label: "신호 종목", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" }',
    '{ id: "lev", label: "레버리지 종목", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" }',
    slkWin([100, 150, 200, 250]), SLK_STAT_SMA],
  about: '매일: 신호 종목이 중심선 위면 레버리지 종목, 아래면 현금(이자 없음)',
  vars: 'sig = data[p.signal], lev = data[p.lev]',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[11] = slDailyCode({
  name: 'SPY 200일선 → UPRO(SPXL)/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SPXL(UPRO 와 같은 S&P 3배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.spxl',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[12] = slDailyCode({
  name: 'SSO 자기 200일선 → SSO/현금 (2배)',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SSO 가 자기 중심선 위면 SSO, 아래면 현금(이자 없음)',
  vars: 'lev = data.sso',
  setup: '    const line = lineOf(lev, p.window);',
  day: '      const c = line(i), px = lev[i], up = c > 0 && px > c;',
});

// #13 Hollywood — SPY 위아래 다른 띠로 TQQQ ↔ QQQ (현금으로는 안 감)
SL_CODE[13] = `{
  name: "Hollywood SPY 200일선 +4/−3 → TQQQ/QQQ",
  params: [
    { id: "entry", label: "TQQQ 로 가는 띠 (중심선 위 %)", options: [0, 2, 3, 4, 5], default: 4 },
    { id: "exit", label: "QQQ 로 가는 띠 (중심선 아래 %)", options: [0, 2, 3, 4, 5], default: 3 },
    ${slkWin([100, 150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: SPY 가 중심선 + 진입 띠 이상이면 TQQQ, 중심선 − 탈출 띠 이하면 QQQ. 사이에서는 그대로 (시작은 QQQ)
    const log = [], sig = data.spy, hiK = 1 + p.entry / 100, loK = 1 - p.exit / 100;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shT = 0, shQ = 0, mode = "qqq";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shT', 'data.tqqq[i]', 'shQ', 'data.qqq[i]', 'TQQQ', 'QQQ')}
      const c = line(i), s = sig[i];
      if (c > 0 && s > 0) { if (s >= c * hiK) mode = "tqqq"; else if (s <= c * loK) mode = "qqq"; }
      const pxT = data.tqqq[i], pxQ = data.qqq[i], now = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "none");
      let traded = false;
      if (mode !== now && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (mode === "tqqq") shT = cash / pxT; else shQ = cash / pxQ;
        cash = 0; traded = true;
        action = mode === "tqqq" ? "매수 — TQQQ" : "위험 축소 — QQQ";
      } else if (cash > 0) {
        if (mode === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (mode === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

SL_CODE[15] = slDailyCode({
  name: 'Composer 200일선 + RSI → TQQQ/현금',
  params: ['{ id: "rsiMax", label: "들고 있을 RSI(14) 상한", options: [60, 70, 80, 100], default: 80 }', slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: QQQ 가 중심선 위이고 QQQ 의 RSI(14) 가 상한 미만이면 TQQQ, 아니면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const line = lineOf(sig, p.window);\n' + slkRsiSeed(14, 60),
  day: SLK_RSI_STEP + '\n      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c && rsi < p.rsiMax;',
});

// #17 MACD — QQQ 일봉 MACD(12/26, 신호선 9) + TQQQ 추적 손절
SL_CODE[17] = `{
  name: "MACD(12/26) → TQQQ/현금 (+추적 손절)",
  params: [{ id: "trail", label: "추적 손절 (고점 대비 %)", options: [0, 20, 30, 40], default: 30 }],
  run(data, p) {
    // 매일: MACD 가 신호선과 0 보다 모두 위면 TQQQ, 아니면 현금(이자 없음).
    // 들고 있는 동안 TQQQ 가 산 뒤 고점에서 trail% 넘게 빠지면 추적 손절
    const log = [], sig = data.qqq, lev = data.tqqq, trail = p.trail / 100;
    const kF = 2 / 13, kS = 2 / 27, kG = 2 / 10;
    const s0 = Math.max(0, p.startIdx - 60);
    let fast = sig[s0] || 0, slow = sig[s0] || 0, macd = 0, gline = 0;
    const step = (v) => { fast += kF * (v - fast); slow += kS * (v - slow); macd = fast - slow; gline += kG * (macd - gline); };
    for (let k = s0 + 1; k < p.startIdx; k++) if (sig[k] > 0) step(sig[k]);
    let cash = p.initial, sh = 0, inMkt = false, peak = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const v = sig[i], px = lev[i];
      if (v > 0) step(v);
      const up = macd > gline && macd > 0;
      if (inMkt && px > peak) peak = px;
      const stop = inMkt && trail > 0 && px > 0 && px < peak * (1 - trail);
      let traded = false;
      if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; peak = px; action = "buy"; traded = true; }
      else if ((!up || stop) && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = stop ? "추적 손절 매도" : "sell"; traded = true; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #18 40주 — 주의 마지막 거래일에만 판단
SL_CODE[18] = `{
  name: "40주 이동평균 (주말 판단) → TQQQ/현금",
  params: [
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 주의 마지막 거래일(다음 거래일이 다른 주 — 월요일에 바뀌는 주)에만: QQQ 가 중심선 위면 TQQQ, 아래면 현금(이자 없음)
    // 계산이 주 중간에 끝나도 그날은 판단하지 않음
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    const weekNo = (s) => Math.floor((Date.parse(s) / 864e5 + 3) / 7);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], nx = data.dates[i + 1];
      if (nx !== undefined && weekNo(nx) !== weekNo(data.dates[i])) {
        const c = line(i), up = c > 0 && sig[i] > c;
        if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[19] = slDailyCode({
  name: '골든·데드 크로스 50/200 → TQQQ/현금',
  params: ['{ id: "fast", label: "빠른 선 (일)", options: [20, 50, 100], default: 50 }', '{ id: "slow", label: "느린 선 (일)", options: [150, 200, 250], default: 200 }', SLK_STAT_SMA],
  about: '매일: QQQ 의 빠른 중심선이 느린 중심선 위면 TQQQ, 아래면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const fastL = lineOf(sig, p.fast), slowL = lineOf(sig, p.slow);',
  day: '      const a = fastL(i), b = slowL(i), px = lev[i], up = b > 0 && a > b;',
});

// #20 변동성 목표 — 매달 첫 거래일에 TQQQ 비중 재조정
SL_CODE[20] = `{
  name: "변동성 목표 TQQQ (목표 변동성에 맞춰 비중 조절)",
  params: [
    { id: "target", label: "목표 변동성 (연 %)", options: [15, 20, 25, 30], default: 25 },
    { id: "lookback", label: "변동성 계산 기간 (일)", options: [20, 40, 60], default: 20 }
  ],
  run(data, p) {
    // 매달 첫 거래일: TQQQ 비중 = 목표 ÷ 최근 일간 수익률의 연율 변동성 (0~100%), 나머지는 현금(이자 없음)
    const log = [], lev = data.tqqq, L = p.lookback, goal = p.target / 100;
    let cash = p.initial, sh = 0, month0 = null, w = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], month = data.dates[i].slice(0, 7), newMonth = month0 === null || month !== month0;
      month0 = month;
      if (newMonth && px > 0) {
        const rets = [];
        let mean = 0;
        for (let k = Math.max(1, i - L + 1); k <= i; k++) if (lev[k] > 0 && lev[k - 1] > 0) { const r = lev[k] / lev[k - 1] - 1; rets.push(r); mean += r; }
        const n = rets.length;
        mean = n ? mean / n : 0;
        let vol = 0;
        for (const r of rets) vol += (r - mean) * (r - mean);
        vol = n ? Math.sqrt(vol / n) * Math.sqrt(252) : 0;
        const tw = vol > 0 ? Math.max(0, Math.min(1, goal / vol)) : 0;
        const total = sh * px + cash;
        sh = (total * tw) / px; cash = total - sh * px; w = tw; action = "rebalance";
      }
${SLK_TICK}
      if (contributed !== 0 || action === "rebalance" || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action, weight: w });
    }
    return { log: log };
  }
}`;

SL_CODE[22] = `{
  name: "Connors RSI(2) 눌림 매수 (200일 추세 안)",
  params: [
    { id: "buy", label: "RSI(2) 가 이 아래면 매수", options: [5, 10, 15], default: 10 },
    { id: "sell", label: "RSI(2) 가 이 위면 매도", options: [60, 70, 80], default: 70 },
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: QQQ 가 200일 중심선 위일 때 RSI(2) 가 매수 기준 아래면 TQQQ 를 사고,
    // RSI(2) 가 매도 기준 위이거나 중심선 아래면 현금(이자 없음)
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, 200);
${slkRsiSeed(2, 30)}
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
${SLK_RSI_STEP}
      const c = line(i), px = lev[i], trend = c > 0 && sig[i] > c;
      if (trend && !inMkt && rsi < p.buy && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
      else if (inMkt && (!trend || rsi > p.sell)) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[23] = slDailyCode({
  name: '200일선 + RSI 과열 매도·식음 재진입',
  params: ['{ id: "oh", label: "과열 매도: RSI(10) 이 이 이상", options: [60, 70, 80, 100], default: 80 }', '{ id: "cool", label: "다시 살 때: RSI(10) 이 이 미만", options: [40, 50, 60, 100], default: 60 }', SLK_STAT_SMA],
  about: '매일: QQQ 가 200일 중심선 위이고 RSI(10) 이 과열 기준 미만이면 TQQQ — 새로 살 때는 RSI(10) 이 식음 기준 미만이어야 함. 아니면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const line = lineOf(sig, 200);\n' + slkRsiSeed(10, 40),
  day: SLK_RSI_STEP + '\n      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c && rsi < p.oh && (inMkt || rsi < p.cool);',
});

// #24 보디가드 — QQQ 가 중심선보다 많이 위면 QQQ 로 줄이고, 더 위면 전부 현금
SL_CODE[24] = `{
  name: "200일선 + 보디가드 (레버리지 축소·전부 현금)",
  params: [
    { id: "delev", label: "QQQ 로 줄이기 (중심선 위 %)", options: [0, 20, 25, 30, 35, 40], default: 30 },
    { id: "gtfo", label: "전부 현금 (중심선 위 %)", options: [0, 35, 40, 45, 50], default: 40 },
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: QQQ 가 중심선 아래면 현금, 중심선보다 gtfo% 이상 위면 현금, delev% 이상 위면 QQQ, 그 밖엔 TQQQ (현금 이자 없음)
    const log = [], sig = data.qqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shT = 0, shQ = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shT', 'data.tqqq[i]', 'shQ', 'data.qqq[i]', 'TQQQ', 'QQQ')}
      const c = line(i), q = sig[i], gap = c > 0 ? (q / c - 1) * 100 : 0;
      let want;
      if (c <= 0 || q <= 0 || q < c) want = "cash";
      else if (p.gtfo > 0 && gap >= p.gtfo) want = "cash";
      else if (p.delev > 0 && gap >= p.delev) want = "qqq";
      else want = "tqqq";
      const pxT = data.tqqq[i], pxQ = data.qqq[i], now = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "cash");
      let traded = false;
      if (want !== now && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (want === "tqqq") { shT = cash / pxT; cash = 0; } else if (want === "qqq") { shQ = cash / pxQ; cash = 0; }
        action = want === "tqqq" ? "buy" : (want === "qqq" ? "레버리지 축소 — QQQ" : "전부 현금으로");
        traded = true;
      } else if (cash > 0) {
        if (want === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (want === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #25 늘 투자 — 중심선 아래면 현금 대신 신호 종목(1배)을 들고 있음
SL_CODE[25] = `{
  name: "200일선 → TQQQ, 아니면 QQQ (늘 투자)",
  params: [
    { id: "signal", label: "신호·대기 종목", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" },
    { id: "lev", label: "레버리지 종목", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" },
    ${slkWin([100, 150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: 신호 종목이 중심선 위면 레버리지 종목, 아래면 신호 종목 자체(1배)를 보유 — 현금으로는 안 감
    const log = [], sig = data[p.signal], lev = data[p.lev];
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shL = 0, shP = 0, mode = "park";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shL', 'lev[i]', 'shP', 'sig[i]', '레버리지 종목', '대기 종목')}
      const c = line(i), pxL = lev[i], pxP = sig[i], want = (c > 0 && sig[i] > c) ? "lev" : "park";
      let traded = false;
      if (want !== mode && pxL > 0 && pxP > 0) {
        cash += shL * pxL + shP * pxP; shL = 0; shP = 0;
        if (want === "lev") shL = cash / pxL; else shP = cash / pxP;
        cash = 0; mode = want; traded = true;
        action = want === "lev" ? "buy" : "위험 축소 — " + p.signal.toUpperCase();
      } else if (cash > 0) {
        if (mode === "lev" && pxL > 0) { shL += cash / pxL; cash = 0; }
        else if (mode === "park" && pxP > 0) { shP += cash / pxP; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shL * pxL + shP * pxP + cash, price: pxL, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #26 중앙값 과열 — 매매 종목이 자기 중심선보다 많이 위면 비켜섬 (내려갈 때 규칙 없음)
SL_CODE[26] = `{
  name: "중앙값 과열 250일",
  params: [
    ${SLK_ASSET6},
    { id: "park", label: "빠졌을 때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" },
      { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { id: "threshold", label: "중심선보다 이만큼 위면 매도 (%)", default: 55, options: [
      10, 15, 20, 25, 30, 35, 40, 42, 44, 46, 48, 50, 52, 54, 55, 56, 58, 60, 62, 64, 66, 68, 70, 75, 80, 85, 90, 100, 110, 125, 150, 175, 200] },
    ${SLK_STAT_MED},
    { id: "window", label: "기간 (일)", default: 250, options: [
      40, 60, 80, 100, 120, 140, 160, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 340, 360, 380, 400, 450, 500] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "assetPrice", label: "가격", tip: "그날 매매 종목의 종가. 매도 규칙은 이 값을 이동 중심선과 비교합니다." },
    { key: "medianPrice", label: "중심선", tip: "매매 종목의 최근 N거래일 중심선 — 기본은 중앙값(창의 절반은 위, 절반은 아래에서 마감), 중심선 설정을 바꾸면 이동평균." },
    { key: "overPct", label: "중심선 대비", tip: "가격이 중심선보다 몇 % 위(+)·아래(−)인지. 매도 기준을 넘으면 팔고, 다시 그 아래로 내려오는 즉시 되삽니다. 중심선이 비어 있는 처음에는 0." },
    { key: "sellLevel", label: "매도선", tip: "중심선보다 정확히 매도 기준만큼 위인 가격. 이 위로 마감하면 팔고, 다시 아래로 내려오면 삽니다." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = p.window || 250, thr = (p.threshold || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // 이동 창: 정렬 배열(중앙값) + 합계(평균) — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; } };
    const from = Math.max(0, p.startIdx - W + 1);
    for (let k = from; k < p.startIdx; k++) if (px[k] > 0) put(px[k]);
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, mid = 0, over = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (px[i] > 0) put(px[i]);
      if (i - W >= from && px[i - W] > 0) take(px[i - W]);   // 창에서 빠지는 날 (데울 때 넣은 날부터만 — 늘 정확히 W 거래일)
      const n = win.length;
      mid = n === 0 ? 0 : (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : total / n);
      over = mid > 0 && px[i] > 0 ? px[i] / mid - 1 : 0;
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      let want = held;
      if (mid > 0 && px[i] > 0) want = over > thr ? p.park : p.asset;
      if (want !== held) {
        const oldPx = priceOf(held, i), newPx = priceOf(want, i);
        if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
        if (want !== "cash" && newPx > 0) { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = "가격 " + (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(1) + "% — " + W + "일 " + CN + " 대비";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i], medianPrice: mid, overPct: over * 100, sellLevel: mid * (1 + thr) });
    }
    const hot = over > thr;
    const pct = (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(2) + "%";
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "medianPrice", label: W + "일 " + CN },
        { key: "sellLevel", label: "과열선 (+" + (p.threshold || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "일 " + CN,
            value: (hot ? "▲ " : "") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendUp" : "activity",
            sub: (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            tip: A + " 의 마지막 종가가 최근 " + W + "거래일 이동 " + CN + "보다 얼마나 위·아래인지입니다. 매도 기준보다 낮으면 그대로 들고 있고, 넘으면 가격이 너무 달아난 것으로 보고 비켜섭니다." },
          { label: "매도 기준",
            value: "+" + (p.threshold || 0) + "%",
            icon: "flag",
            sub: hot ? "넘어섬 — " + A + " 에서 나와 있음" : "여유 " + (Math.max(0, thr - over) * 100).toFixed(1) + "%p",
            tip: "가격이 " + CN + "보다 이만큼 위로 달아나면 팔고 " + K + "(으)로 옮깁니다. 다시 이 선 아래로 내려오는 즉시 " + A + " 를 삽니다." },
          { label: "빠졌을 때 보유",
            value: K,
            icon: "shield",
            sub: p.park === "cash" ? "연 " + (p.cashRate || 0) + "% 이자" : "빠져 있어도 시장에 남음",
            tip: "매도 신호가 켜져 있는 동안 돈이 머무는 곳입니다. 현금은 정한 이자를 받고, 다른 종목은 시장에 남되 덜 위험합니다." }
        ],
        decision: {
          action: hot ? (p.park === "cash" ? "현금 유지" : K + " 매수") : A + " 매수",
          note: hot ? "가격이 " + CN + "보다 " + (p.threshold || 0) + "% 넘게 위" : "가격이 보통 범위 안",
          tone: hot ? "bad" : "good",
          reasons: [{
            name: "중심선 과열",
            val: A + " " + pct + " vs " + W + "일 " + CN,
            tag: hot ? "밖 · " + K : "안 · " + A,
            lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// #39 과열 매도 — 신호 종목(기본 SSO)이 자기 이동평균보다 많이 위면 비켜섬
SL_CODE[39] = `{
  name: "과열 매도 (많이 오르면 팔기)",
  params: [
    ${SLK_ASSET6},
    { id: "signal", label: "신호 종목", default: "sso", options: [
      { value: "sso", label: "SSO" }, { value: "spy", label: "SPY" }, { value: "qqq", label: "QQQ" }, { value: "tqqq", label: "TQQQ" } ] },
    ${SLK_STAT_SMA},
    { id: "window", label: "기간 (일)", default: 150, options: [
      20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
      210, 220, 230, 240, 250, 260, 270, 280, 300, 320, 350, 400] },
    { id: "stretch", label: "중심선보다 이만큼 위면 매도 (%)", default: 20, options: [
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 32, 35, 40, 45, 50] },
    { id: "park", label: "빠졌을 때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "signalPrice", label: "신호 종가", tip: "과열 신호를 읽는 종목(기본 SSO)의 종가 — 매매하는 종목과 다를 수 있습니다." },
    { key: "signalSma", label: "중심선", tip: "신호 종목의 중심선(중심선 설정에 따라 이동평균 또는 중앙값). 신호 종가를 이 선과 비교합니다." },
    { key: "abovePct", label: "중심선 대비", tip: "신호 종가가 중심선보다 몇 % 위(+)·아래(−)인지. 매도 기준을 넘으면 팔고, 기준 이하인 동안은 매매 종목을 들고 있습니다." },
    { key: "assetPrice", label: "종목 가격", tip: "그날 매매 종목의 종가 — 빠져 있는 날에도 보여 주어 무엇에서 나와 있는지 알 수 있습니다." },
    { key: "triggerLine", label: "매도선", tip: "신호 종목의 중심선보다 정확히 매도 기준만큼 위인 값 — 신호가 이 위로 마감하면 비키고, 다시 아래로 오면 되삽니다." }
  ],
  run(data, p) {
    const log = [];
    const sig = data[p.signal] || data.sso, px0 = data[p.asset] || data.tqqq;
    const W = p.window, thr = (p.stretch || 0) / 100;
    const useMed = p.stat === "median", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : data[id][i];
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, mid = 0, above = 0;
    // 이동 창: 합계(평균)와 정렬 배열(중앙값)을 함께 — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0, cnt = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; cnt++; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; cnt--; } };
    for (let k = Math.max(0, p.startIdx - W + 1); k <= p.startIdx; k++) if (sig[k] > 0) put(sig[k]);
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) {
        if (sig[i] > 0) put(sig[i]);
        if (i - W >= 0 && sig[i - W] > 0) take(sig[i - W]);
      }
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      mid = cnt > 0 ? (useMed ? (cnt % 2 ? win[(cnt - 1) >> 1] : (win[cnt / 2 - 1] + win[cnt / 2]) / 2) : total / cnt) : 0;
      above = mid > 0 ? sig[i] / mid - 1 : 0;
      let want = held;
      if (mid > 0) want = above > thr ? p.park : p.asset;
      if (want !== held) {
        const oldPx = priceOf(held, i), newPx = priceOf(want, i);
        if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
        if (want !== "cash" && newPx > 0) { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% — " + (useMed ? "중앙값" : "이동평균") + " 대비 (기준 " + (thr * 100).toFixed(0) + "%)";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          signalPrice: sig[i], signalSma: mid, abovePct: above * 100, assetPrice: px0[i],
          triggerLine: mid * (1 + thr) });
    }
    const hot = above > thr;
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const gap = thr * 100 - above * 100, T = (thr * 100).toFixed(0);
    const A = p.asset.toUpperCase(), S = p.signal.toUpperCase();
    const K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "signalPrice", label: S + " 가격" },
        { key: "signalSma", label: W + "일 " + CN },
        { key: "triggerLine", label: "매도선 (+" + (p.stretch || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: S + " vs " + p.window + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendDown" : "trendUp",
            sub: (sig[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            tip: S + " 가 " + p.window + "일 중심선보다 얼마나 위인지입니다. +" + T + "% 이하면 " + A + " 를 들고 있고, 넘어서면 팝니다." },
          { label: "매도 기준",
            value: "+" + T + "%",
            icon: "flag",
            sub: hot ? "기준을 넘어 작동 중" : S + " 가 이만큼 달아나면 작동",
            tip: "과열 기준: " + S + " 가 중심선보다 이만큼 넘게 위로 마감하면 " + A + " 를 팔고 " + K + "(으)로 옮깁니다." },
          { label: "기준까지 거리",
            value: gap >= 0 ? "여유 " + gap.toFixed(2) + "%" : Math.abs(gap).toFixed(2) + "% 넘어섬",
            tone: hot ? "bad" : "good",
            icon: "activity",
            sub: hot ? "+" + T + "% 아래로 돌아와야 되삼" : S + " 가 팔기 전까지 더 오를 수 있는 폭",
            tip: "지금 늘어난 정도와 매도 기준의 차이입니다. 양수면 들고 있으면서 남은 여유, 음수면 이미 기준을 넘어 빠져 있다는 뜻입니다." },
          { label: "빠졌을 때 보유",
            value: K,
            icon: p.park === "cash" ? "dollar" : "shield",
            sub: p.park === "cash" ? "기다리는 돈에 연 " + (p.cashRate || 0) + "% 이자" : A + " 에서 나와 있는 동안 " + K + " 보유",
            tip: "과열로 판 뒤 돈이 머무는 곳입니다. " + S + " 가 기준 이하로 돌아오는 즉시 " + A + " 로 돌아갑니다." }
        ],
        decision: {
          action: hot ? (p.park === "cash" ? "현금 유지" : K + " 매수") : A + " 매수",
          note: hot ? S + " 가 " + (useMed ? "중앙값" : "평균") + "보다 " + pct + " 달아남" : "과열 아님 (" + pct + " vs 기준 +" + T + "%)",
          tone: hot ? "bad" : "good",
          reasons: [{
            name: "과열",
            val: S + " " + pct + " vs " + p.window + "일 (기준 +" + T + "%)",
            tag: hot ? "밖 · " + K : "안 · " + A,
            lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// #40 중앙값 과열 + SQQQ 대기 — 하루 한 번만 거래(갈아탈 때 두 날로 나눔), 다리마다 수수료
SL_CODE[40] = `{
  name: "중앙값 과열 (250일) — SQQQ 대기",
  params: [
    ${SLK_ASSET6},
    { id: "park", label: "빠졌을 때 보유", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    ${SLK_STAT_MED},
    { id: "window", label: "기간 (일)", default: 250, options: [
      20, 30, 40, 50, 60, 75, 90, 100, 110, 120, 130, 140, 150, 160, 175, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340, 360, 400, 450, 500] },
    { id: "overPct", label: "중심선보다 이만큼 위면 나감 (%)", default: 55, options: [
      10, 15, 20, 25, 30, 35, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5, 70, 75, 80, 85, 90, 95, 100, 110, 125, 150, 175, 200] },
    { id: "splitDays", label: "하루에 한 번만 거래", type: "bool", default: true, options: [
      { value: true, label: "예" }, { value: false, label: "아니요" } ] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가 — 신호도 지수가 아니라 이 종목에서 읽습니다." },
    { key: "medianPrice", label: "중심선", tip: "이 종목 최근 N개 종가의 중심선 — 기본은 중앙값(창의 절반은 위, 절반은 아래; 튀는 값에 덜 흔들림), 중심선 설정을 바꾸면 이동평균." },
    { key: "abovePct", label: "중심선 대비", tip: "오늘 종가가 중심선보다 몇 % 위(+)·아래(−)인지. 전략이 보는 숫자는 이것 하나뿐입니다." },
    { key: "triggerPrice", label: "기준 가격", tip: "중심선보다 정확히 기준 % 위인 가격. 이 위로 마감하면 대기 종목으로, 아래로 돌아오면 다시 삽니다 — 나가고 들어오는 선이 같습니다." },
    { key: "parkPrice", label: "대기 가격", tip: "빠져 있을 때 들고 있는 종목의 종가. 대기가 현금이면 0." },
    { key: "leg", label: "단계", tip: "종목에서 종목으로 갈아탈 때 이 줄이 몇 번째 다리인지. 현금에서 사거나 현금으로 파는 한 번짜리 거래와 거래 없는 줄은 비어 있습니다." },
    { key: "traded", label: "거래액", tip: "이 줄에서 오간 돈 — 수수료는 이 금액에 붙습니다. 나눠 갈아타면 파는 줄과 사는 줄에 따로 나옵니다." },
    { key: "fee", label: "수수료", tip: "이 줄에서 낸 비용(거래액 × 비용 %). 종목 간 갈아타기는 두 다리라 두 번 냅니다 — 하루 한 번 거래가 켜져 있으면 하루 차이로 두 줄에." },
    { key: "feesPaid", label: "누적 수수료", tip: "처음부터 낸 거래 비용의 합계. 평가액과 견주면 갈아타기에 실제로 얼마를 썼는지 보입니다." },
    { key: "holdingsValue", label: "보유액", tip: "들고 있는 종목의 금액. 현금을 더하면 전체." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250), over = (p.overPct || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // 이동 창: 정렬 배열 + 합계 — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; } };
    const from = Math.max(0, p.startIdx - W + 1);
    for (let k = from; k < p.startIdx; k++) if (px[k] > 0) put(px[k]);
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, legWait = false, feesPaid = 0;
    let mid = 0, above = 0, trigger = 0, hot = false, want = "cash";
    let prevAbove = 0, prevRoom = 0;   // 어제 값 — 신호 카드의 '오늘 변화'
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) { prevAbove = above; prevRoom = trigger > 0 && px[i - 1] > 0 ? trigger / px[i - 1] - 1 : 0; }
      if (px[i] > 0) put(px[i]);
      if (i - W >= from && px[i - W] > 0) take(px[i - W]);   // 창에서 빠지는 날 (데울 때 넣은 것만)
      const n = win.length;
      mid = n === 0 ? 0 : (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : total / n);
      above = mid > 0 && px[i] > 0 ? px[i] / mid - 1 : 0;
      trigger = mid * (1 + over);
      hot = mid > 0 && px[i] > 0 && px[i] > trigger;
      let contributed = 0, action = "hold", note = "", fee = 0, traded = 0, leg = "";
      cash *= 1 + dayRate;
${slkMoneyHeld(true)}
      want = held;
      if (mid > 0 && px[i] > 0) want = hot ? p.park : p.asset;
      const pctTxt = CN + " 대비 " + (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "%";
      let did = false;
      if (want !== held) {
        const twoLeg = held !== "cash" && want !== "cash";
        const secondLeg = legWait && held === "cash";
        const oldPx = priceOf(held, i);
        if (p.splitDays && twoLeg) {
          // 하루 한 번: 오늘은 현금으로 팔기만 — 사는 것은 다음 거래일에 신호를 다시 보고
          if (oldPx > 0) {
            const g = shares * oldPx, f = g * cost;
            cash += g - f; fee += f; traded += g; shares = 0;
            action = "sell"; leg = "1/2";
            note = pctTxt + " — 2단계 중 1단계, 다음 거래일에 " + want.toUpperCase() + " 매수";
            held = "cash"; legWait = true; did = true;
          }
        } else {
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {   // 살 종목 가격이 있을 때만 바꿈 (자료 빈 날에 빈손으로 들고 있지 않게)
            if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; traded += g; shares = 0; }
            if (want !== "cash") { const f = cash * cost; traded += cash; shares = (cash - f) / newPx; fee += f; cash = 0; }
            action = held === "cash" ? "buy" : (want === "cash" ? "sell" : "switch");
            leg = secondLeg ? "2/2" : (twoLeg ? "1+2 같은 날" : "");
            note = pctTxt + (secondLeg ? " — 2단계 중 2단계" : " (기준 +" + (over * 100).toFixed(1) + "%)");
            held = want; legWait = false; did = true;
          }
        }
      } else if (legWait) legWait = false;
      // 새 돈은 오늘 거래가 없었을 때만 들고 있는 종목에 넣음
      if (!did && held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        traded += cash; shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
        if (action === "contribution") note = "적립금 투자";
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      feesPaid += fee;
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, leg: leg,
          traded: traded, fee: fee, feesPaid: feesPaid,
          assetPrice: px[i] || 0, medianPrice: mid, abovePct: above * 100,
          triggerPrice: trigger, parkPrice: priceOf(p.park, i) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const last = px[p.endIdx] || 0;
    const sign = (v) => (v >= 0 ? "+" : "−");
    const pct = sign(above) + Math.abs(above * 100).toFixed(2) + "%";
    const room = trigger > 0 && last > 0 ? trigger / last - 1 : 0;
    const roomTxt = sign(room) + Math.abs(room * 100).toFixed(2) + "%";
    const pending = want !== held;
    // 어제에서 오늘로의 변화 — 여유가 줄었다(음수)는 건 들고 있는 종목이 올랐다는 뜻이라 좋은 쪽
    const dAbove = (above - prevAbove) * 100, dRoom = (room - prevRoom) * 100;
    const heldPrev = priceOf(held, p.endIdx - 1);
    const heldGain = heldPrev > 0 ? (priceOf(held, p.endIdx) / heldPrev - 1) * 100 : null;
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "medianPrice", label: W + "일 " + CN },
        { key: "triggerPrice", label: "과열선 (+" + (p.overPct || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "일 " + CN,
            value: (hot ? "▲ " : "▼ ") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendUp" : "trendDown",
            sub: last.toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            delta: { text: sign(dAbove) + Math.abs(dAbove).toFixed(2) + "%", tone: dAbove >= 0 ? "good" : "bad" },
            tip: "마지막 종가와 최근 " + W + "개 종가의 중심선(중심선 설정에 따라 중앙값 또는 이동평균)의 차이입니다. 너무 위로 달아나면 대기 종목으로 비키고, 그 밖에는 " + A + " 를 들고 있습니다. 괄호 안 숫자는 어제 종가 대비 오늘 바뀐 폭입니다." },
          { label: hot ? "기준 아래까지" : "여유",
            value: roomTxt,
            tone: hot ? "bad" : "good",
            icon: "activity",
            sub: hot ? trigger.toFixed(2) + " 아래로 내려와야 함" : last.toFixed(2) + " → " + trigger.toFixed(2),
            delta: { text: sign(dRoom) + Math.abs(dRoom).toFixed(2) + "%", tone: dRoom <= 0 ? "good" : "bad" },
            tip: "나가기 전까지 더 오를 수 있는 폭, 또는 다시 들어가려면 내려와야 하는 폭입니다. 괄호 안은 오늘의 변화 — 들고 있는 동안 여유가 줄었다면 대개 종목이 오른 것이라, 숫자는 줄었어도 좋은 쪽(초록)으로 표시합니다." },
          { label: "지금 보유",
            value: name(held) + (pending ? " → " + name(want) : ""),
            tone: held === p.asset ? "good" : "bad",
            icon: held === p.asset ? "trendUp" : "flag",
            sub: held === "cash" ? "연 " + (p.cashRate || 0) + "% 이자" : priceOf(held, p.endIdx).toFixed(2) + " 에 보유",
            delta: heldGain != null ? { text: sign(heldGain) + Math.abs(heldGain).toFixed(2) + "%", tone: heldGain >= 0 ? "good" : "bad" } : null,
            tip: "마지막 날 들고 있는 것과, 다음 거래일로 미뤄 둔 다리. 손절·추세 필터·폭락 규칙이 없고 과열에만 반응하므로 하락은 바닥까지 함께 갑니다." + (p.park === "sqqq" ? " SQQQ 는 −3배 인버스라 오르거나 옆으로 가는 장에서는 계속 녹습니다." : "") }
        ],
        decision: {
          action: pending ? (want === "cash" ? "현금으로" : name(want) + " 매수") : (hot ? (p.park === "cash" ? "현금 유지" : K + " 보유") : A + " 매수"),
          note: pending ? "2단계 — 지난 거래일에 현금으로 팔았고, 다음에 " + name(want) + " 매수" : (hot ? "가격이 " + W + "일 " + CN + "보다 " + pct + " 위" : "가격이 " + CN + " 대비 " + pct),
          tone: hot ? "bad" : "good",
          reasons: [
            { name: "과열", val: A + " " + pct + " vs " + W + "일 " + CN, tag: hot ? "밖 · " + K : "안 · " + A, lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy" },
            { name: "기준선", val: "+" + (over * 100).toFixed(1) + "% = " + trigger.toFixed(2), tag: hot ? "넘어섬" : roomTxt + " 남음", lean: hot ? "out" : "hold" }
          ]
        }
      }
    };
  }
}`;

// #41·#44 공용 — 손잡이 목록 (값·기본값은 원본과 같음)
const SLK_W41 = '5, 7, 10, 14, 20, 30, 40, 50, 60, 75, 90, 100, 110, 120, 130, 140, 150, 160, 175, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340, 360, 400, 450, 500';
const slkParams41 = (veto) => `    { section: "매매 종목·신호" },
    ${SLK_ASSET6},
    { id: "stat", label: "중심선", default: "median", options: [
      { value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" }, { value: "rsi", label: "RSI (50 중심선 대비)" } ] },
    { id: "window", label: "기간 (일)", default: 250, options: [
      ${SLK_W41}] },
    { section: "과열 — 급등을 팔기" },
    { id: "overPct", label: "중심선 위 (%)", default: 55, options: [
      2, 4, 5, 6, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5, 70, 72.5, 75, 80, 85, 90, 95, 100, 110, 120, 125, 130, 140, 150, 160, 175, 200, 225, 250, 300] },
    { id: "park", label: "그때 보유", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "폭락 신호 — 탈출이 재는 기준" },
    { id: "crashStat", label: "중심선", default: "same", options: [
      { value: "same", label: "주 신호와 같게" }, { value: "median", label: "중앙값" },
      { value: "sma", label: "이동평균" }, { value: "rsi", label: "RSI (50 중심선 대비)" } ] },
    { id: "crashWindow", label: "기간 (일)", default: 0, options: [
      { value: 0, label: "주 신호와 같게" },
      ${SLK_W41}] },
    { section: "폭락 탈출 — 무너지면 나가기" },
    { id: "exitPct", label: "중심선 대비 (%)", default: -28, options: [
      10, 8, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15, -16, -17, -18, -19, -20, -22, -24, -25, -26, -28, -30, -32, -34, -35, -36, -38, -40, -42, -44, -45, -46, -48, -50, -52, -55, -58, -60, -65, -70, -75, -80] },
    { id: "crashAsset", label: "그때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "중심선 기울기가 이보다 낮을 때만 (연 %)", default: 20, options: [
      { value: 999, label: "끔" }, { value: -40, label: "-40" }, { value: -20, label: "-20" },
      { value: -10, label: "-10" }, { value: 0, label: "0" }, { value: 10, label: "10" },
      { value: 20, label: "20" }, { value: 30, label: "30" }, { value: 40, label: "40" },
      { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120" } ] },
    { id: "belowGate", label: "중심선 아래 머문 날수가 이 이상일 때만", default: 10, options: [
      { value: 0, label: "끔" }, 1, 2, 3, 5, 8, 10, 15, 20, 30] },${veto ? `
    { section: "신용 거부 — NFCI (시카고 연준)" },
    { id: "nfciTh", label: "NFCI 가 이보다 높으면 현금으로", default: 0.4, options: [
      { value: 999, label: "끔" }, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.5, 2 ] },
    { id: "vetoEnd", label: "거부가 풀리는 때", default: "cycle", options: [
      { value: "cycle", label: "NFCI 가 진정되거나 폭락 탈출→회복이 한 바퀴 끝나면" },
      { value: "nfci", label: "NFCI 가 진정될 때만" } ] },` : ''}
    { section: "실행·비용" },
    { id: "splitDays", label: "하루에 한 번만 거래", type: "bool", default: true, options: [
      { value: true, label: "예" }, { value: false, label: "아니요" } ] },
    { id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12] },
    { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [
      0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1] }`;

// 두 신호(과열 판단·폭락 판단)의 이동 창·RSI·기울기 이력 준비 — #41·#44 의 run 앞부분
const SLK_SETUP41 = `    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250);
    const over = (p.overPct || 0) / 100, exitB = (p.exitPct || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    const crashAsset = p.crashAsset || "cash";
    // 신호는 두 개: 주 신호(과열)와 폭락 신호(탈출). 각각 '가격 vs 이동 중심선' 또는 'RSI vs 50'.
    // RSI 면 +55% = RSI 77.5, −30% = RSI 35 처럼 같은 % 기준이 그대로 통함. 폭락 쪽 기본은 주 신호와 같게
    const useMed = p.stat !== "sma", mainRsi = p.stat === "rsi";
    const crashSame = p.crashStat === "same" || p.crashStat == null;
    const crashRsi = crashSame ? mainRsi : p.crashStat === "rsi";
    const W2raw = +p.crashWindow || 0, W2 = W2raw > 0 ? Math.max(2, W2raw) : W;
    const useMedC = crashSame ? useMed : p.crashStat !== "sma";
    const sameLine = W2 === W && crashRsi === mainRsi && (crashRsi || useMedC === useMed);
    // 이동 창: 정렬 배열 + 합계 — 하루에 하나 넣고 하나 뺌
    const makeRoll = (Wn) => {
      const win = [];
      let sum = 0;
      const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      return {
        from: Math.max(0, p.startIdx - Wn + 1),
        add(v) { win.splice(pos(v), 0, v); sum += v; },
        drop(v) { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); sum -= v; } },
        mid(m) { const n = win.length; return n === 0 ? 0 : (m ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : sum / n); }
      };
    };
    // 와일더 RSI — 시작 전 최대 기간 4배만큼 미리 데움 (처음 Wn 개는 단순 평균)
    const makeRsi = (Wn) => {
      let up = 0, dn = 0, cnt = 0;
      const step = (i) => {
        if (!(px[i] > 0 && px[i - 1] > 0)) return;
        const d = px[i] - px[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
        if (cnt < Wn) { up += g; dn += l; cnt++; if (cnt === Wn) { up /= Wn; dn /= Wn; } }
        else { up = (up * (Wn - 1) + g) / Wn; dn = (dn * (Wn - 1) + l) / Wn; }
      };
      for (let k = Math.max(1, p.startIdx - 4 * Wn); k < p.startIdx; k++) step(k);
      return { step: step, val: () => (cnt < Wn ? 0 : (dn === 0 ? 100 : 100 - 100 / (1 + up / dn))) };
    };
    const rollM = mainRsi ? null : makeRoll(W);
    const rollC = crashRsi ? null : (sameLine ? rollM : makeRoll(W2));
    const rsiM = mainRsi ? makeRsi(W) : null;
    const rsiC = crashRsi ? (mainRsi && W2 === W ? rsiM : makeRsi(W2)) : null;
    if (rollM) for (let k = rollM.from; k < p.startIdx; k++) if (px[k] > 0) rollM.add(px[k]);
    if (rollC && rollC !== rollM) for (let k = rollC.from; k < p.startIdx; k++) if (px[k] > 0) rollC.add(px[k]);
    // 기울기 확인: 폭락 중심선의 63거래일 전 값이 시작 전부터 필요 → 시작 전 63일을 따로 한 번 돌려 둠
    // (RSI 폭락 신호면 중심이 늘 50 이라 기울기 0 — 음수 기준을 쓰려면 기울기 조건을 끄세요)
    const slopeGate = p.slopeGate == null ? 999 : +p.slopeGate;
    const belowGate = +p.belowGate || 0;
    const preC = new Array(63).fill(0);
    if (!crashRsi && slopeGate !== 999) {
      const pre = makeRoll(W2);
      const pf = Math.max(0, p.startIdx - 63 - W2 + 1);
      for (let k = pf; k < p.startIdx - 63; k++) if (px[k] > 0) pre.add(px[k]);
      for (let j = 0; j < 63; j++) {
        const k = p.startIdx - 63 + j;
        if (k >= 0 && px[k] > 0) pre.add(px[k]);
        const out = k - W2;
        if (out >= pf && px[out] > 0) pre.drop(px[out]);
        preC[j] = k >= 0 ? pre.mid(useMedC) : 0;
      }
    }
    const ring = new Array(64).fill(0);   // 폭락 중심선 최근 64일
    const ZK = { normal: "보통", over: "과열", crash: "폭락" };
    let cash = p.initial, shares = 0, held = "cash", state = "normal", invested = p.initial;
    let med = 0, medC = 0, above = 0, aboveC = 0, zone = "normal", sigM = 0, sigC = 0, below = 0, slope = 0;
    // 판단 참고용 통계(거래에는 안 씀): 폭락 신호의 범위·탈출 기간, 매매 종목의 고점 대비 낙폭
    let lo = Infinity, hi = -Infinity, stints = [], inCrash = false, stint = 0;
    let peak = 0, peakDate = "", ddNow = 0, ddMax = 0;`;
// 매일 앞부분: 창·RSI 갱신 → 두 신호 → 기울기·아래 머문 날 → 통계
const SLK_DAY41 = `      if (px[i] > 0) { if (rollM) rollM.add(px[i]); if (rollC && rollC !== rollM) rollC.add(px[i]); }
      if (rollM) { const out = i - W; if (out >= rollM.from && px[out] > 0) rollM.drop(px[out]); }
      if (rollC && rollC !== rollM) { const out = i - W2; if (out >= rollC.from && px[out] > 0) rollC.drop(px[out]); }
      if (rsiM && i > 0) rsiM.step(i);
      if (rsiC && rsiC !== rsiM && i > 0) rsiC.step(i);
      med = mainRsi ? 50 : rollM.mid(useMed);
      sigM = mainRsi ? rsiM.val() : px[i];
      medC = sameLine ? med : (crashRsi ? 50 : rollC.mid(useMedC));
      sigC = sameLine ? sigM : (crashRsi ? rsiC.val() : px[i]);
      above = med > 0 && sigM > 0 ? sigM / med - 1 : 0;
      aboveC = medC > 0 && sigC > 0 ? sigC / medC - 1 : 0;
      // 확인 조건: 폭락 중심선의 63일 기울기(연율)와, 폭락 신호가 중심선 아래에 머문 연속 날수
      const dayN = i - p.startIdx;
      const prevC = crashRsi ? 50 : (dayN >= 63 ? ring[(dayN - 63) % 64] : preC[dayN] || 0);
      slope = prevC > 0 && medC > 0 ? (Math.pow(medC / prevC, 4) - 1) * 100 : 0;
      ring[dayN % 64] = medC;
      below = (medC > 0 && sigC > 0 && sigC < medC) ? below + 1 : 0;
      if (medC > 0 && sigC > 0) { if (aboveC < lo) lo = aboveC; if (aboveC > hi) hi = aboveC; }
      if (px[i] > 0) {
        if (px[i] > peak) { peak = px[i]; peakDate = data.dates[i]; }
        ddNow = peak > 0 ? px[i] / peak - 1 : 0;
        if (-ddNow > ddMax) ddMax = -ddNow;
      }`;
// 구간 판단: 보통 → (과열 | 폭락) , 폭락 → 탈출선 위로 돌아오면 보통
const SLK_STATE41 = `        const pOver = med * (1 + over), pExit = medC * (1 + exitB);
        if (state === "normal" || state === "over") {
          if (sigM > pOver) state = "over";
          else if (sigC < pExit
            && (slopeGate === 999 || slope < slopeGate)
            && (belowGate === 0 || below >= belowGate)) state = "crash";
          else state = "normal";
        } else if (sigC > pExit) state = "normal";
        zone = state;`;
const slkTrade41 = (noteExpr) => `        if (p.splitDays && want !== held && held !== "cash" && want !== "cash") want = "cash";   // 하루 한 번: 오늘은 팔기만, 사는 건 다음 거래일에 다시 보고
        if (want !== held) {
          const oldPx = priceOf(held, i);
          if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {
            if (want !== "cash") { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
            action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
            note = ${noteExpr};
            held = want;
          }
        } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
          const f = cash * cost;
          shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
          if (action === "contribution") note = "적립금 투자";
        }`;
const SLK_STINT41 = `      const wasCrash = inCrash;
      inCrash = state === "crash";
      if (inCrash) stint++;
      if (wasCrash && !inCrash) { stints.push(stint); stint = 0; }
      // 그림용 중심선: RSI 신호면 가격 기준으로 바꾼 중심(가격 × 50 / RSI) — 가격이 이 선을 넘는 것이 곧 RSI 기준
      const medPlot = mainRsi ? (sigM > 0 ? px[i] * 50 / sigM : 0) : med;`;
const SLK_NOTE41 = '"중심선 대비 " + (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% — " + ZK[zone]';

// #41 중앙값 과열 + SQQQ + 확인된 깊은 폭락 탈출
SL_CODE[41] = `{
  name: "중앙값 과열 + SQQQ + 폭락 탈출",
  params: [
${slkParams41(false)}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가." },
    { key: "medianPrice", label: "중심선", tip: "주 신호의 중심선을 가격으로 — 최근 N개 종가의 중앙값·이동평균, 신호가 RSI 면 RSI 로 바꾼 중심(가격 × 50 / RSI). 가격이 이 선에서 그린 띠를 넘는 것이 곧 기준입니다." },
    { key: "crashCenter", label: "폭락 중심", tip: "폭락 쪽 띠(탈출)가 재는 중심선. 폭락 신호에 따로 기간·통계를 주지 않으면 주 중심선과 같습니다." },
    { key: "abovePct", label: "중심선 대비", tip: "주 신호(가격 또는 RSI)가 중심보다 몇 % 위(+)·아래(−)인지. 과열 띠는 이 숫자로 정합니다." },
    { key: "crashAbovePct", label: "폭락 신호 대비", tip: "같은 늘어남을 폭락 신호로 잰 값 — 탈출 띠는 이 숫자로 정합니다." },
    { key: "zone", label: "구간", tip: "종가가 들어간 구간: 과열(대기 종목), 보통(보유), 폭락(밖)." },
    { key: "fee", label: "수수료", tip: "이 줄의 거래에서 낸 비용." }
  ],
  run(data, p) {
${SLK_SETUP41}
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_DAY41}
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
${SLK_STATE41}
        let want = state === "normal" ? p.asset : state === "over" ? p.park : crashAsset;
${slkTrade41(SLK_NOTE41)}
      }
${SLK_STINT41}
      const medCPlot = sameLine ? medPlot : (crashRsi ? (sigC > 0 ? px[i] * 50 / sigC : 0) : medC);
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100, zone: ZK[zone],
          crashCenter: medCPlot, crashAbovePct: aboveC * 100,
          mainSignal: sigM, crashSignal: sigC,
          overLine: medPlot * (1 + over), exitLine: medCPlot * (1 + exitB) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const zoneHold = zone === "normal" ? A : zone === "over" ? K : name(crashAsset);
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "중앙값" : "평균");
    const CNc = crashRsi ? "RSI(" + W2 + ")" : (useMedC ? "중앙값" : "평균");
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const tone = zone === "normal" ? "good" : "bad";
    const holdTxt = name(held), Z = ZK[zone], exitP = p.exitPct || 0;
    // 신호 차트 선 (반등·포기선은 일부러 안 그림 — 탈출선이 아래쪽 기준)
    const lines = [
      { key: "assetPrice", label: A + " 가격" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") 선" } : { key: "medianPrice", label: W + "일 " + CN }
    ];
    if (!sameLine) lines.push(crashRsi ? { key: "crashCenter", label: "RSI(" + W2 + ") 폭락선" } : { key: "crashCenter", label: W2 + "일 " + CNc + " 폭락 기준" });
    lines.push(
      { key: "exitLine", label: "폭락 탈출 (" + exitP + "%" + (sameLine ? "" : " @ " + CNc) + ")" },
      { key: "overLine", label: "과열선 (+" + (p.overPct || 0) + "%)" }
    );
    if (inCrash && stint > 0) stints.push(stint);   // 마지막 날에도 밖에 있으면
    const sorted = stints.slice().sort((a, b) => a - b);
    const midStint = sorted.length ? sorted[(sorted.length - 1) >> 1] : 0;
    const reach = lo < Infinity && lo * 100 <= exitP;
    const room = aboveC * 100 - exitP;
    return {
      log: log,
      lines: lines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: tone,
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + med.toFixed(2),
            tip: "과열 규칙이 보는 늘어남: " + (mainRsi ? "RSI 와 50 중심선" : "종가와 " + W + "일 " + CN) + ". +" + (p.overPct || 0) + "% 를 넘으면 " + K + "(으)로 비키고, 폭락 탈출은 " + (sameLine ? "같은 신호" : "따로 둔 신호(" + CNc + ")") + "가 " + exitP + "% 아래로 내려가면 " + name(crashAsset) + "(으)로 나갑니다." },
          { label: "지금 구간",
            value: Z,
            tone: tone,
            icon: "sliders",
            sub: holdTxt + " 보유 중",
            tip: "마지막 종가가 들어간 구간과 거기서 들고 있는 것: 과열(대기 종목), 보통(매매 종목), 폭락(신호가 탈출선 위로 돌아올 때까지 밖)." },
          { label: "폭락 탈출",
            value: exitP + "%",
            icon: "shield",
            sub: "그다음 " + name(crashAsset) + " 보유"
              + (slopeGate !== 999 ? " · 기울기<" + slopeGate + " 필요" : "")
              + (belowGate > 0 ? " · " + belowGate + "일 아래" : "")
              + (sameLine ? "" : " — " + CNc + " 기준"),
            tip: "확인된 붕괴 탈출: 신호가 중심보다 이만큼 아래로 떨어지고 확인 조건(중심선 기울기 둔화, 선 아래 머문 날수)까지 통과해야 " + A + " 를 팔아 " + name(crashAsset) + "(으)로 옮기고, 신호가 탈출선 위로 돌아오는 즉시 되삽니다. 9개 계열을 비교한 검증에서 얕고 빠른 탈출보다 깊고 확인된 탈출이 뽑혔습니다 — 확인 조건이 단순 −8% 탈출을 손해로 만들던 헛신호를 걸러 냅니다." },
          { label: "폭락 신호 범위",
            value: (lo < Infinity ? (lo >= 0 ? "+" : "") + (lo * 100).toFixed(1) + "% … +" + (hi * 100).toFixed(1) + "%" : "—"),
            tone: reach ? "good" : "bad",
            icon: "activity",
            sub: reach ? "탈출 " + stints.length + "번, 중앙값 " + midStint + "일 밖" : exitP + "% 탈출선에 한 번도 닿지 않음",
            tip: "이번 실행 동안 폭락 신호의 늘어남이 오간 전체 범위입니다. 탈출 기준이 이 범위의 바닥보다 낮으면 절대 작동하지 않아 폭락 탈출이 사실상 꺼진 셈입니다 — 느린 RSI 창은 범위를 크게 좁히므로(RSI(250) 은 ±10% 를 거의 못 벗어남) 깊은 기준에는 빠른 창이 필요합니다." },
          { label: "탈출까지 여유",
            value: (room >= 0 ? "+" : "") + room.toFixed(1) + "%p",
            tone: room >= 0 ? "good" : "bad",
            icon: "shield",
            sub: "신호 " + (aboveC >= 0 ? "+" : "") + (aboveC * 100).toFixed(1) + "% vs " + exitP + "% 선",
            tip: "폭락 신호가 탈출 전까지 더 떨어질 수 있는 폭(양수) 또는 이미 선을 지나친 폭(음수). '곧 팔리게 되나'를 가장 바로 보여 줍니다." },
          { label: A + " 낙폭",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "고점 " + peak.toFixed(2) + " (" + peakDate + ") 대비 · 최악 " + (-ddMax * 100).toFixed(0) + "%",
            tip: "매매 종목이 지금까지의 고점에서 얼마나 내려왔는지입니다. 전략은 이 숫자를 직접 보지 않고 신호의 늘어남으로 움직이지만, 둘을 견주면 아픈 하락에서 탈출 규칙이 실제로 작동하는지 보입니다: 낙폭은 깊은데 탈출이 한 번도 없었다면 폭락 신호가 너무 느리거나 깊게 맞춰진 것입니다." }
        ],
        decision: {
          action: zoneHold === "현금" ? "현금 유지" : zone === "normal" ? zoneHold + " 매수" : zoneHold + " 보유",
          note: "신호가 " + CN + " 대비 " + pct + " — " + Z + " 구간",
          tone: tone,
          reasons: [
            { name: "구간", val: A + " " + pct + " vs " + CN, tag: Z + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : zoneHold === "현금" ? "cash" : "out" }
          ]
        }
      }
    };
  }
}`;

// #44 = #41 + NFCI 신용 거부 (한쪽 방향: 현금으로 보내기만)
SL_CODE[44] = `{
  name: "NFCI 거부 + 중앙값 과열 SQQQ + 중앙값 폭락 탈출",
  params: [
${slkParams41(true)}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가." },
    { key: "medianPrice", label: "중심선", tip: "주 신호의 중심선을 가격으로 — 최근 N개 종가의 중앙값·이동평균, 신호가 RSI 면 RSI 로 바꾼 중심(가격 × 50 / RSI)." },
    { key: "abovePct", label: "중심선 대비", tip: "주 신호가 중심보다 몇 % 위(+)·아래(−)인지." },
    { key: "nfci", label: "NFCI", tip: "시카고 연준 전국 금융 여건 지수(주간, 발표 지연 7일). 0 위 = 평균보다 빡빡한 여건, 거부 기준 위 = 신용 경색 — 전부 현금." },
    { key: "zone", label: "구간", tip: "종가가 들어간 구간 — 또는 NFCI 우선 규칙이 전부 현금으로 묶어 두는 동안은 '신용 거부'." },
    { key: "fee", label: "수수료", tip: "이 줄의 거래에서 낸 비용." }
  ],
  run(data, p) {
${SLK_SETUP41}
    // 신용 거부: NFCI 가 기준 위로 올라서면 켜짐. 'cycle'(기본) = NFCI 가 진정되거나, 거부 중에 가격 규칙이
    // 폭락 탈출 → 회복을 한 바퀴 마치면 풀림 (가격이 다시 들어갈 자격을 얻었으니). 'nfci' = 기준 위인 동안 내내
    const nfciTh = p.nfciTh == null ? 0.4 : +p.nfciTh;
    const nfciArr = data.nfci || null;
    const vetoCycle = (p.vetoEnd || "cycle") !== "nfci";
    let armed = false, crashSeen = false, wasAbove = false;
    let nfNow = NaN, vetoOn = false, vetoDays = 0, vetoTimes = 0, prevVeto = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_DAY41}
      nfNow = nfciArr ? nfciArr[i] : NaN;
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
${SLK_STATE41}
        // 한쪽 방향 신용 거부: 현금으로 갈 이유만 됨
        const nfAbove = nfciTh !== 999 && isFinite(nfNow) && nfNow > nfciTh;
        if (!vetoCycle) vetoOn = nfAbove;
        else {
          if (nfAbove && !wasAbove) { armed = true; crashSeen = false; }
          if (!nfAbove) armed = false;
          if (armed) {
            if (state === "crash") crashSeen = true;
            else if (crashSeen) armed = false;   // 가격 규칙이 폭락 탈출 뒤 회복 → 풀어 줌
          }
          vetoOn = armed;
        }
        wasAbove = nfAbove;
        if (vetoOn) { vetoDays++; if (!prevVeto) vetoTimes++; }
        prevVeto = vetoOn;
        let want = state === "normal" ? p.asset : state === "over" ? p.park : crashAsset;
        if (vetoOn) want = "cash";
${slkTrade41('vetoOn ? "NFCI " + nfNow.toFixed(2) + " > " + nfciTh + " — 신용 거부" : ' + SLK_NOTE41)}
      }
${SLK_STINT41}
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100,
          nfci: isFinite(nfNow) ? nfNow : null,
          zone: vetoOn ? "신용 거부" : ZK[zone],
          overLine: medPlot * (1 + over), exitLine: medPlot * (1 + exitB) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "중앙값" : "평균");
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const tone = vetoOn ? "bad" : zone === "normal" ? "good" : "bad";
    const holdTxt = name(held), Z = ZK[zone], exitP = p.exitPct || 0;
    const lines = [
      { key: "assetPrice", label: A + " 가격" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") 선" } : { key: "medianPrice", label: W + "일 " + CN },
      { key: "exitLine", label: "폭락 탈출 (" + exitP + "%)" },
      { key: "overLine", label: "과열선 (+" + (p.overPct || 0) + "%)" }
    ];
    if (inCrash && stint > 0) stints.push(stint);
    const nfTxt = isFinite(nfNow) ? (nfNow >= 0 ? "+" : "") + nfNow.toFixed(2) : "없음";
    const vetoGap = isFinite(nfNow) && nfciTh !== 999 ? (nfciTh - nfNow) : NaN;
    return {
      log: log,
      lines: lines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: zone === "normal" ? "good" : "bad",
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + med.toFixed(2),
            tip: "과열 규칙이 보는 늘어남입니다. +" + (p.overPct || 0) + "% 를 넘으면 " + K + "(으)로 비키고, " + exitP + "% 아래로 내려가면(확인 조건 포함) " + name(crashAsset) + "(으)로 팝니다." },
          { label: "지금 구간",
            value: vetoOn ? "신용 거부" : Z,
            tone: tone,
            icon: "sliders",
            sub: holdTxt + " 보유 중",
            tip: "마지막 종가가 들어간 구간 — 과열(대기), 보통(보유), 폭락(밖) — 또는 NFCI 우선 규칙이 구간과 상관없이 전부 현금으로 묶어 두는 동안의 '신용 거부'." },
          { label: "NFCI 신용 거부",
            value: nfTxt,
            tone: nfciTh === 999 ? "good" : (vetoOn ? "bad" : "good"),
            icon: "shield",
            sub: nfciTh === 999 ? "거부 끔"
              : vetoOn ? "+" + nfciTh + " 위 — 진정될 때까지 현금" + (vetoCycle ? " (또는 폭락 한 바퀴가 끝날 때까지)" : "")
              : "+" + nfciTh + " 에서 거부 (" + vetoGap.toFixed(2) + " 남음) · 이번 실행에서 " + vetoTimes + "번, " + vetoDays + "일",
            tip: "시카고 연준 전국 금융 여건 지수(NFCI) — 주간 값을 발표 지연 7일 뒤부터 씁니다. +" + (nfciTh === 999 ? "0.4" : nfciTh) + " 위 = 신용 경색: 전부 현금으로. 한쪽 방향이라 레버리지를 늘리는 일은 없습니다. 지수가 진정되면 풀리고" + (vetoCycle ? ", 거부 중에 가격 규칙이 스스로 폭락 탈출 뒤 회복까지 마치면 더 일찍 풀립니다 — 시장이 다시 들어갈 자격을 얻었으니 신용 스트레스만으로는 붙잡지 않음" : "") + ". 1971년 이후 진짜 신용 위기(1973-75, 볼커 긴축, 1987, S&L 1990, 금융위기)에만 작동했고 2009년 7월 이후로는 조용합니다." },
          { label: "폭락 탈출",
            value: exitP + "%",
            icon: "shield",
            sub: "그다음 " + name(crashAsset) + " 보유"
              + (slopeGate !== 999 ? " · 기울기<" + slopeGate + " 필요" : "")
              + (belowGate > 0 ? " · " + belowGate + "일 아래" : ""),
            tip: "확인된 붕괴 탈출: 신호가 중심보다 이만큼 아래로 떨어지고 확인 조건까지 통과해야 " + A + " 를 팔아 " + name(crashAsset) + "(으)로 옮기고, 신호가 탈출선 위로 돌아오면 되삽니다." },
          { label: A + " 낙폭",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "고점 " + peak.toFixed(2) + " (" + peakDate + ") 대비 · 최악 " + (-ddMax * 100).toFixed(0) + "%",
            tip: "매매 종목이 지금까지의 고점에서 얼마나 내려왔는지입니다. 가격 띠는 중심선 대비 늘어남으로, 거부는 신용 여건으로 움직입니다 — 이 숫자는 그 둘이 무엇을 막으려는지 보여 줍니다." }
        ],
        decision: {
          action: vetoOn ? "현금 유지 — 신용 거부"
            : (state === "normal" ? A + " 매수" : state === "over" ? K + " 보유" : name(crashAsset) === "현금" ? "현금 유지" : name(crashAsset) + " 보유"),
          note: vetoOn ? "NFCI " + nfTxt + " 가 +" + nfciTh + " 위 — 신용 여건이 진정되기를 기다리는 중"
            : "신호가 " + CN + " 대비 " + pct + " — " + Z + " 구간 · NFCI " + nfTxt,
          tone: tone,
          reasons: [
            { name: "구간", val: A + " " + pct + " vs " + CN, tag: Z + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : holdTxt === "현금" ? "cash" : "out" },
            { name: "신용 (NFCI)", val: nfTxt + " vs +" + (nfciTh === 999 ? "끔" : nfciTh),
              tag: vetoOn ? "거부 — 현금" : "진정",
              lean: vetoOn ? "cash" : "buy" }
          ]
        }
      }
    };
  }
}`;

// ── 라이브러리 목록 ────────────────────────────────────────────────────
const SS_LIB_LINKS = {
  F: 'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  GB: 'https://cmtassociation.org/wp-content/uploads/2025/08/2016-gayed-bilello.pdf',
  ALV: 'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
  MACD: 'https://www.lambrospetrou.com/articles/investing-leveraged-qqq-macd/',
  SSO: 'https://www.brightworkresearch.com/using-letfs-combined-with-the-200-day-moving-average-trading-approach/',
  HW: 'https://bestfolio.app/strategies/tqqq-qqq-band',
  '3PH': 'https://www.tradingview.com/script/cbUgg7hl-SPY-200SMA-4-Entry-3-Exit-TQQQ-QLD-GLDM-THREE-PHASE-STRATEGY/',
  CMP: 'https://www.composer.trade/trading-strategies/tqqq-rsi-strategy-Lh0fYfA5RJQmpyfGEORb',
  BH: 'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  GS: 'https://graniteshares.com/research/the-200-moving-average-strategy-explained/',
  QS: 'https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/',
  QC: 'https://www.quantconnect.com/research/15351/leveraged-etfs-with-systematic-risk-management/',
  QP: 'https://quantpedia.com/leveraged-etfs-in-asset-allocation-opportunity-or-trap/',
  'BH·GS': 'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  'F·BH': 'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  'ALV·QC': 'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
};
const SS_LIB_TAGS = {
  app: '앱 기본', foundation: '기초', academic: '학술', portfolio: '포트폴리오', composite: '복합', momentum: '모멘텀', origin: '원조',
  community: '커뮤니티', oscillator: '오실레이터', crossover: '이동평균 교차', risk: '위험 관리', picked: '직접 고름', overfit: '과최적화',
};
const SL_SELF = '직접 고른 전략 — 숫자는 이 앱의 자체 백테스트이며 외부에서 주장한 값이 아님';
const SL_APP = '앱의 기본 전략 — 숫자는 이 앱이 표준 기본값으로 돌린 백테스트';
const sll = (...a) => a.join('\n');
// 과최적화 탐색기 1위 설정 (프리셋)
function slFit(n, eng, goal, span, cagr, dd, params) {
  const E = eng === '9sig' ? '9sig' : 'SMA', G = goal === 'ret' ? '최고 수익' : '최저 낙폭';
  // 원래 1953년부터 찾은 후보 — 이 사이트 자료는 1971년부터(그 전 나스닥 값은 검증할 수 없는 가상값이라 뺌)라 탐색기에서는 1971–2025 탭
  const now = /^1953/.test(span) ? '의 ‘' + G + ' ' + span.replace(/^1953/, '1971') + '’ 탭(이 사이트 자료는 1971년부터 — 그 전 나스닥 값은 검증할 수 없는 가상값이라 뺌)' : '';
  return {
    n, name: E + ' · ' + G + ' ' + span, tag: 'overfit',
    rules: sll(E + ' 과최적화 탐색기의 ‘' + G + ' ' + span + '’ 후보를 처음 찾을 때 1위였던 설정 — 그 구간에 맞춘 값(당시 표본 안 CAGR ' + cagr + '%, 낙폭 ' + dd + '%). 지금 계산으로 다시 돌린 값과 순위는 탐색기 표' + now + '에서 볼 수 있습니다.',
      '앱의 ' + E + ' 엔진 그대로 돌아가므로 써 보면 모든 손잡이를 바꿀 수 있습니다.',
      '그 구간을 뒤져 고른 값이라 다른 구간은 훨씬 나빠 보일 것으로 예상하세요 — 추천이 아니라 과최적화의 차이를 보여 주려고 둔 것입니다.'),
    reported: '처음 찾을 때 ' + span + ' 표본 안: CAGR ' + cagr + '% / 낙폭 −' + dd + '%',
    preset: { type: eng, params },
  };
}

const SS_LIBRARY = [
  // 앱의 두 기본 엔진 (프리셋 — 써 보면 손잡이를 모두 바꿀 수 있는 기본 9sig/SMA 저장 전략)
  { n: 42, name: '9sig', tag: 'app',
    rules: sll('제이슨 켈리의 9-Sig 를 TQQQ 에 맞춘 것.',
      '보유: TQQQ 60% + 현금 완충 40%(연 4% 이자).',
      '분기마다: TQQQ 평가액을 분기 9% 씩 커지는 목표선과 비교 — 목표보다 많으면 넘친 만큼 팔아 현금으로, 적으면 모자란 만큼 현금으로 삽니다(한 번에 현금의 90% 까지만).',
      '폭락 규칙: TQQQ 가 2년 고점보다 30% 넘게 떨어져 있으면 팔아야 할 때도 매도를 미룹니다(연속 두 번까지).',
      '급등 규칙: 한 분기에 +100% 오르면 주식 비중을 60% 로 되돌립니다.',
      '거래 비용 0.02%. 앱의 표준 기본값 — 9sig 엔진 그대로라 써 보면 모든 손잡이를 패널에서 바꿀 수 있습니다.'),
    reported: SL_APP,
    preset: { type: '9sig', params: { ul: 'tqqq', g: '9', cd: '30', cw: '24', sp: '100', per: 'quarterly', cash: '40', cr: '4', bp: '90', dep: '0', tc: 'holding', park: 'cash', rp: '0', st: '60', cost: '0.02' } } },
  { n: 43, name: 'SMA 200', tag: 'app',
    rules: sll('앱의 표준 추세 규칙.',
      '신호: QQQ 종가가 200일 이동평균 위면 TQQQ, 아래로 마감하면 현금(연 4% 이자) — 매일 확인, 완충 띠 없음.',
      '과열 매도: RSI(9) 가 90 이상이면 팝니다.',
      '식음 재진입: RSI(7) 이 80 아래일 때만 다시 삽니다.',
      '버블 보험: TQQQ 가 자기 200일 평균보다 40% 이상 위면 전부 현금.',
      '실행: T+1 결제, 다시 살 때 15거래일에 나눠 삼, 거래 비용 0.02%.',
      'SMA 엔진 그대로라 써 보면 모든 손잡이를 패널에서 바꿀 수 있습니다.'),
    reported: SL_APP,
    preset: { type: 'sma', params: { sig: 'qqq', win: '200', ul: 'tqqq', cr: '4', eb: '0', xb: '0', oh: '90', cool: '80', ohw: '9', coolw: '7', cb: '0', cs: '0', settle: '1', out: 'cash', din: '15', dout: '15', bg: '40', bga: 'tqqq', bgw: '200', cost: '0.02' } } },
  { n: 1, name: 'Faber 10개월·200일 타이밍 모델', tag: 'foundation', src: 'F',
    rules: sll('신호: S&P(또는 QQQ) 와 10개월 이동평균(약 200일).',
      '들어감: 월말 종가가 평균 위 → 보유.',
      '나감: 월말 종가가 평균 아래 → 단기 국채.',
      '주기: 매달(마지막 거래일).',
      '이 앱 구현: QQQ 와 200일 중심선 → TQQQ ↔ 현금(이자 없음). 판단은 달의 마지막 거래일에만 (기간 길이·차트 눈금과 상관없이 — 계산이 달 중간에 끝나면 그날은 판단 안 함).'),
    reported: '연 10.2% vs 매수 후 보유 9.3% (S&P, 1901–2012)', code: SL_CODE[1] },
  { n: 2, name: 'Gayed & Bilello LRS 3배 — 장기 레버리지', tag: 'academic', src: 'GB',
    rules: sll('신호: S&P 500 총수익 지수와 200일 이동평균.',
      '들어감: 평균 위 → S&P 3배.',
      '나감: 평균 아래 → 단기 국채.',
      '주기: 매일 · 1년에 약 5번 왕복.',
      '이 앱 구현: SPY 와 200일 중심선 → SPXL(S&P 3배) ↔ 현금(이자 없음), 매일.'),
    reported: 'CAGR 26.8% · 최대 낙폭 −92.2% · 샤프 0.47 (1928–2015)', code: SL_CODE[2] },
  { n: 3, name: 'Gayed & Bilello LRS 2배', tag: 'academic', src: 'GB',
    rules: sll('#2 와 같고 레버리지만 2배.',
      '신호: 레버리지 없는 S&P 총수익과 200일 이동평균.',
      '대기: 단기 국채. 주기: 매일.',
      '이 앱 구현: SPY 와 200일 중심선 → SSO(S&P 2배) ↔ 현금(이자 없음), 매일.'),
    reported: 'CAGR 19.1% · 최대 낙폭 −78.7% · 샤프 0.51 (1928–2015)', code: SL_CODE[3] },
  { n: 4, name: 'Gayed & Bilello LRS 1.25배', tag: 'academic', src: 'GB',
    rules: sll('#2 와 같고 1.25배 — 보수적인 쪽.',
      '신호: S&P 총수익과 200일 이동평균. 주기: 매일.',
      '아직 이 앱에서 백테스트하지 않았습니다.'),
    reported: '연 12.4% (1928–2015)' },
  { n: 5, name: 'HedgeFundie 엑설런트 어드벤처 (UPRO 55 / TMF 45)', tag: 'portfolio', needs: 'TMF', src: 'BH',
    rules: sll('고정 비중: UPRO(S&P 3배) 55% + TMF(장기 국채 3배) 45%, 분기마다 리밸런스.',
      '선택: UPRO 쪽에 200일 이동평균을 덧씌우기도 함.',
      '주기: 분기.'),
    reported: 'Bogleheads 의 유명한 포트폴리오 — 2022년에 두 다리가 함께 무너지는 위험이 드러남' },
  { n: 6, name: 'Alvarez UPRO/TQQQ 복합 전략', tag: 'composite', needs: 'VIX', src: 'ALV',
    rules: sll('주기: 매달.',
      '관문: VIX ≤ 25 · S&P 가 200일 이동평균 위 · VWO 모멘텀 > 0 · BND 모멘텀 > 0.',
      '모두 참 → UPRO 50% + TQQQ 50%.',
      '1~2개 거짓 → QQQ 50% + SPY 50%.',
      '3~4개 거짓 → TLT 100%.'),
    reported: '연 24.4% · 최대 낙폭 −54% (2010–2023)' },
  { n: 7, name: 'Antonacci 듀얼 모멘텀 → 레버리지 ETF (GEM)', tag: 'momentum', needs: 'VWO/BND', src: 'QP',
    rules: sll('절대 필터: 기초 지수의 12개월 수익률이 단기 국채보다 높을 때만.',
      '상대 선택: S&P 와 나스닥 중 모멘텀이 강한 쪽 → 그 지수의 3배 종목, 아니면 단기 국채.',
      '주기: 매달.'),
    reported: '널리 인용되는 모멘텀 틀 — 레버리지 ETF 는 초과 수익과 헛신호 손실을 함께 키움' },
  { n: 8, name: 'Siegel 200일 ±1% 띠', tag: 'origin', src: 'F',
    rules: sll('신호: 지수와 200일 이동평균, 위아래 대칭 ±1% 띠.',
      '들어감: 종가가 평균보다 +1% 이상 위.',
      '나감: 종가가 평균보다 −1% 이하 → 단기 국채.',
      '주기: 매일.',
      '이 앱 구현: SPY 와 200일 중심선 ± 띠 → TQQQ ↔ 현금(이자 없음), 매일. 띠 안에서는 그대로 둠.'),
    reported: '헛신호를 줄이는 완충 띠 아이디어의 원조 (다우지수 1886–2006)', code: SL_CODE[8] },
  { n: 9, name: 'TQQQ 표준 200일 이동평균 (r/LETF)', tag: 'community', src: 'BH·GS',
    rules: sll('신호: S&P 또는 QQQ 와 200일 이동평균.',
      '들어감: 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '주기: 매일 또는 매달.',
      '참고: S&P 신호라면 TQQQ 보다 UPRO 가 더 깔끔합니다.',
      '이 앱 구현: SPY(QQQ 로 바꿀 수 있음)와 200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일.'),
    reported: 'S&P 200일선 6.7% vs 보유 7.4% · 낙폭 29% vs 56% (1960–)', code: SL_CODE[9] },
  { n: 10, name: 'QQQ 200일 → TQQQ (같은 지수, 현금 대기)', tag: 'app', src: 'F·BH',
    rules: sll('신호: QQQ 와 자기 200일 이동평균 → TQQQ 매매.',
      '들어감: 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '신호와 매매가 같은 지수라 기초 지수가 어긋날 위험이 없습니다. 주기: 매일.',
      '이 앱 구현: QQQ 와 200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일. 신호·종목·기간을 바꿀 수 있음.'),
    reported: '이 앱의 표준 SMA 설정', code: SL_CODE[10] },
  { n: 11, name: 'SPY 200일 → UPRO (같은 지수 짝)', tag: 'community', src: 'BH',
    rules: sll('신호: SPY(S&P) 와 200일 이동평균 → UPRO(S&P 3배) 매매.',
      '들어감: 평균 위. 나감: 평균 아래 → 단기 국채.',
      '신호와 매매가 같은 지수입니다. 주기: 매일.',
      '이 앱 구현: UPRO 대신 같은 S&P 3배인 SPXL 자료로 — SPY 와 200일 중심선 → SPXL ↔ 현금(이자 없음), 매일.'),
    reported: '"TQQQ 보다 깔끔" — S&P↔나스닥 기초 지수 차이 위험이 없음', code: SL_CODE[11] },
  { n: 12, name: 'SSO/SHY 자기 가격 200일 회전 (2배)', tag: 'app', src: 'SSO',
    rules: sll('신호: SSO 자기 가격과 200일 이동평균.',
      '들어감: 평균 위 → SSO. 나감: 평균 아래 → SHY(1~3년 국채).',
      '다시 위로 넘으면 다시 삼. 주기: 매일.',
      '이 앱 구현: SSO 와 자기 200일 중심선 → SSO ↔ 현금(이자 없음 — SHY 자료는 없음), 매일.'),
    reported: '샤프 0.555 vs SPY 보유 0.524 (5년)', code: SL_CODE[12] },
  { n: 13, name: 'Hollywood SPY 200일 +4%/−3% → TQQQ/QQQ', tag: 'community', src: 'HW',
    rules: sll('신호: SPY 와 200일 이동평균, 위아래가 다른 띠.',
      '들어감: SPY 가 평균보다 +4% 이상 위 → TQQQ 100%.',
      '나감: SPY 가 평균보다 −3% 이하 → QQQ 100% (현금으로는 가지 않음).',
      '주기: 매일. 원래 글에는 보디가드와 나눠 다시 사기도 붙어 있습니다.',
      '이 앱 구현: 두 띠와 TQQQ ↔ QQQ 갈아타기만(보디가드·나눠 사기 없음). 처음에는 QQQ 로 시작하고, 띠 사이에서는 그대로 둠.'),
    reported: 'CAGR 27.3% · 최대 낙폭 −95.8% · 샤프 0.71 (1985–2026)', code: SL_CODE[13] },
  { n: 14, name: '3단계 TQQQ/QLD/GLDM', tag: 'community', needs: '금', src: '3PH',
    rules: sll('1단계: SPY 가 200일 평균 +4% 위 → TQQQ 100%.',
      '2단계: 366일 들고 있으면 → QLD(2배) 50% + GLDM(금) 50%.',
      '3단계: SPY 가 200일 평균 −3% 아래 → SGOV 50% + GLDM 50%.',
      '주기: 매일.'),
    reported: '날짜별 거래가 적힌 백테스트 표를 공개함' },
  { n: 15, name: 'Composer TQQQ-RSI (200일 + RSI + PPO)', tag: 'oscillator', src: 'CMP',
    rules: sll('200일 추세 필터 AND RSI AND PPO.',
      '상승 추세 안에서 눌림에 TQQQ 를 사고, 아니면 SHV 에서 대기.',
      '주기: 매일 갈아타기.',
      '이 앱 구현: QQQ 가 200일 중심선 위이고 QQQ 의 RSI(14) 가 80 미만일 때만 TQQQ, 아니면 현금(이자 없음). PPO 는 없음.'),
    reported: '연 69.11% · 최대 낙폭 −23.5% · 샤프 1.47 (2023년 9월부터 — 짧음)', code: SL_CODE[15] },
  { n: 16, name: 'Composer 다중 신호 + 헤지', tag: 'oscillator', needs: 'SQQQ/UVXY', src: 'CMP',
    rules: sll('#15 에 전술적 헤지를 더함: 극단적인 움직임 뒤 잠깐 SQQQ(−3배)나 UVXY, 급락에는 TECL(3배).',
      '주기: 매일.'),
    reported: 'Composer 변형 중 가장 복잡함' },
  { n: 17, name: 'Petrou 주간 MACD → TQQQ (+ 손절)', tag: 'crossover', src: 'MACD',
    rules: sll('신호: QQQ/나스닥100 주간 MACD.',
      '들어감: MACD 가 0 위로 올라서면 → TQQQ. 나감: 0 아래로 내려가면 → 현금.',
      '손절: 고정 10% + 추적 30%. 주기: 매주.',
      '이 앱 구현: QQQ 일봉 MACD(12/26, 신호선 9) — MACD 가 신호선과 0 보다 모두 위면 TQQQ, 아니면 현금(이자 없음). 산 뒤 TQQQ 고점에서 30% 빠지면 추적 손절(신호가 그대로 켜져 있으면 다음 날 다시 삼). 매일 확인하며 고정 10% 손절은 없음.'),
    reported: '+11,194% (2010년 2월–2025년 7월)', code: SL_CODE[17] },
  { n: 18, name: '40주 이동평균 교차 → TQQQ', tag: 'crossover', src: 'MACD',
    rules: sll('신호: 나스닥100 과 40주 이동평균(약 200일, 주봉).',
      '들어감: 주말 종가가 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '주기: 매주.',
      '이 앱 구현: QQQ 와 200일 중심선을 주의 마지막 거래일에만 비교 → TQQQ ↔ 현금(이자 없음). 계산이 주 중간에 끝나면 그날은 판단 안 함.'),
    reported: '+2,800% (Petrou 비교 기간)', code: SL_CODE[18] },
  { n: 19, name: '골든·데드 크로스 50/200', tag: 'crossover', src: 'GS',
    rules: sll('들어감: 50일 평균이 200일 평균 위로 올라섬(골든 크로스) → 레버리지 ETF.',
      '나감: 데드 크로스(50 < 200) → 현금·단기 국채.',
      '주기: 매일.',
      '이 앱 구현: QQQ 의 50일·200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일.'),
    reported: '고전적인 이동평균 교차 — 가격 vs 200일선보다 느림', code: SL_CODE[19] },
  { n: 20, name: '변동성 목표 (목표 변동성에 맞춰 레버리지 조절)', tag: 'risk', src: 'QC',
    rules: sll('레버리지 = 목표 변동성 ÷ 최근 실제 변동성, 종목 배수가 상한. 변동성이 커지면 줄입니다.',
      '목표 15~25%. 200일 이동평균 관문을 함께 쓰기도 함. 주기: 매주·매달.',
      '이 앱 구현: 매달 첫 거래일에 TQQQ 비중 = 목표 25% ÷ 최근 20거래일 TQQQ 일간 수익률의 연율 변동성(최대 100%), 나머지는 현금(이자 없음).'),
    reported: '이분법 탈출 없이 꼬리 위험을 줄임 (QuantConnect)', code: SL_CODE[20] },
  { n: 21, name: 'VIX 단계별 레버리지', tag: 'risk', needs: 'VIX', src: 'ALV·QC',
    rules: sll('VIX 로 레버리지 정하기: VIX < 15 → 3배, 15~25 → 2배, 25~35 → 1배, 35 초과 → 현금.',
      '주기: 매일·매주. Alvarez VIX 관문의 조상.'),
    reported: '투명한 단계표 — 공포가 커지면 레버리지를 줄임' },
  { n: 22, name: 'Connors RSI(2) 상승 추세 눌림 매수', tag: 'oscillator', src: 'QS',
    rules: sll('추세 필터: 가격이 200일 이동평균 위.',
      '들어감: RSI(2) < 10(과매도)이면 TQQQ 매수.',
      '나감: RSI(2) > 70 이거나 가격이 200일 평균 아래. 주기: 매일.',
      '이 앱 구현: QQQ 의 200일 중심선과 QQQ RSI(2) → TQQQ ↔ 현금(이자 없음).'),
    reported: '추세 필터 안에서 하는 단기 평균 회귀', code: SL_CODE[22] },
  { n: 23, name: '200일 이동평균 + RSI 매도·재진입', tag: 'app', src: 'CMP',
    rules: sll('과열 매도: RSI(10) 이 기준 이상이면 평균 위라도 현금으로.',
      '식음 재진입: 사라는 신호가 나와도 RSI(10) 이 식음 기준 아래로 내려올 때까지 기다렸다 삼.',
      '주기: 매일.',
      '이 앱 구현: QQQ 가 200일 중심선 위이고 RSI(10) 이 80 미만이면 TQQQ 유지, 새로 살 때는 RSI(10) 이 60 미만이어야 함. 아니면 현금(이자 없음).'),
    reported: '많이 오르면 팔고 눌림을 기다려 되삼 — 앱이 구현', code: SL_CODE[23] },
  { n: 24, name: '보디가드 레버리지 축소 (+30 / +40)', tag: 'app', src: 'HW',
    rules: sll('주 신호와 따로: 기초 지수가 200일 평균보다 30% 이상 위면 3배 → QQQ(1배), 40% 이상 위면 전부 현금.',
      '바로 실행(나눠 사기보다 우선).',
      '이 앱 구현: QQQ 가 200일 중심선 아래면 현금, 40% 이상 위면 현금, 30% 이상 위면 QQQ, 그 밖에는 TQQQ — 현금 이자 없음.'),
    reported: '닷컴 거품 보험 — 앱이 구현', code: SL_CODE[24] },
  { n: 25, name: '늘 투자 대기 + 나눠 다시 사기', tag: 'app', src: 'HW',
    rules: sll('팔 때 현금 대신 QQQ/SPY(1배)를 들고 있음.',
      '다시 살 때는 6~12개월에 걸쳐 QQQ 로 나눠 사거나, SPY 가 200일 평균 +4% 위를 되찾으면 TQQQ 로 완전히 갈아탐.',
      '이 앱 구현: QQQ 가 200일 중심선 위면 TQQQ, 아래면 QQQ — 늘 투자. 나눠 사기는 없음.'),
    reported: '하락장에서 채권 대신 QQQ 를 들면 평균 +6.91% — 앱이 구현', code: SL_CODE[25] },
  // 직접 고른 전략 (출처 글이 없어 이름에 링크 없음)
  { n: 26, name: '중앙값 과열 250일', tag: 'picked',
    rules: sll('신호: 매매 종목과 자기 최근 250개 종가의 중앙값.',
      '나감: 가격이 중앙값보다 55% 넘게 위 → 대기(기본은 현금, 연 4% 이자).',
      '들어감: 그렇지 않으면 언제든. 주기: 매일. 거래 비용 0.02%.',
      '과열만 거르는 필터라 내려갈 때의 규칙이 없습니다 — 모든 폭락을 바닥까지 들고 갑니다.'),
    reported: SL_SELF, code: SL_CODE[26] },
  { n: 39, name: '과열 매도 — SSO 신호 (많이 오르면 팔기)', tag: 'picked',
    rules: sll('신호: SSO 와 자기 150일 이동평균.',
      '나감: 신호가 평균보다 20% 넘게 위로 마감 → 대기(기본은 현금).',
      '들어감: 그렇지 않으면 언제든. 주기: 매일.',
      '신호 종목과 매매 종목(기본 TQQQ)은 따로 고를 수 있습니다.',
      '과열만 거르는 필터 — ‘중앙값 과열 250일’처럼 내려갈 때의 규칙이 없어 모든 폭락을 들고 갑니다.'),
    reported: SL_SELF, code: SL_CODE[39] },
  { n: 40, name: '중앙값 과열 (250일) — SQQQ 대기', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 팔고 SQQQ 를 삼.',
      '다시 그 아래로 내려오면 되삼.',
      '매일 확인, 손절 없음. 하루에 한 번만 거래(종목끼리 갈아탈 때는 이틀에 걸쳐), 거래 비용 0.02%.'),
    reported: SL_SELF, code: SL_CODE[40] },
  { n: 41, name: '중앙값 과열 + SQQQ + 폭락 탈출', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 SQQQ 로 갈아탐.',
      '중앙값보다 28% 아래로 마감하고 — 중앙값 자체도 오름을 멈췄을 때(기울기 연 +20% 미만, 선 아래 10일 이상 연속) — 현금으로 팖.',
      '가격이 탈출선 위로 돌아오면 되삼.',
      '매일 확인, 하루에 한 번만 거래.'),
    reported: '직접 고름. 2010–2025 를 훑어 맞춘 값이라 대표 숫자는 표본 안 성적으로 보세요. 숫자는 이 앱의 자체 백테스트', code: SL_CODE[41] },
  { n: 44, name: 'NFCI 거부 + 중앙값 과열 SQQQ + 중앙값 폭락 탈출', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 SQQQ 로 갈아탐.',
      '중앙값보다 28% 아래로 마감하고 — 중앙값도 오름을 멈췄을 때(최근 3개월 기울기가 연 20% 미만, 선 아래 10일 이상 연속) — 현금으로 팖. 가격이 탈출선 위로 돌아오면 되삼. 매일 확인, 하루에 한 번만 거래.',
      '여기에 신용 규칙 하나: 시카고 연준의 주간 NFCI(0 = 평균 여건, 높을수록 빡빡한 신용; 각 값은 그 주가 끝나고 7일 뒤부터 씀)가 +0.4 위로 올라서면 들고 있는 것을 전부 현금으로 팔고 그대로 있습니다.',
      '신용 규칙은 NFCI 가 +0.4 아래로 내려오거나, 그 사이 가격 규칙이 스스로 폭락 탈출과 재진입을 마치면 꺼집니다. 그 뒤에는 NFCI 가 +0.4 아래로 내려갔다 다시 올라설 때까지 가격 규칙이 모두 정합니다.',
      '신용 규칙은 팔기만 하고 사지는 않습니다.',
      '백테스트에서 11번 작동했고 모두 1971년~2007년 11월 사이, 매번 3주~15개월 현금으로 있었습니다. 위기 내내 현금으로 있지는 않습니다: 2008년에는 2007년 11월 30일에 팔고 2008년 4월 1일에 가격 규칙에 넘겼으며, 가격 규칙은 2008년 봄·여름에 여러 번 들락날락한 뒤 2008년 9월 15일에 팔고 2009년 4월에 되샀습니다.'),
    reported: '거부(veto) 부분은 따로 검증함: 1973년부터의 시기표, 52개 창 전진 검증, 흐름을 살린 부트스트랩(다시 뽑은 경로의 87%), 연준 당시 발표 자료, 위약 시험. 이득은 띄엄띄엄 — 몇 번의 신용 위기가 거의 다 만듦', code: SL_CODE[44] },
  // 과최적화 탐색기 1위 — 구간에 맞춰 찾은 최고점이지 예측이 아님 (차이를 보이려고 둠)
  slFit(27, '9sig', 'ret', '2010–2025', '55.33', '69.91', { ul: 'tqqq', g: '130', cd: '5', cw: '24', sp: '25', per: 'monthly', cash: '90', cr: '4', bp: '100', dep: '75', tc: 'holding', park: 'cash', rp: '10', st: '0', cost: '0.02' }),
  slFit(28, '9sig', 'dd', '2010–2025', '30.01', '19.41', { ul: 'tqqq', g: '12', cd: '25', cw: '21', sp: '100', per: 'yearly', cash: '70', cr: '4', bp: '70', dep: '0', tc: 'holding', park: 'qld', rp: '10', st: '0', cost: '0.02' }),
  slFit(29, '9sig', 'ret', '1990–2025', '42.24', '81.66', { ul: 'tqqq', g: '150', cd: '5', cw: '36', sp: '200', per: 'yearly', cash: '0', cr: '4', bp: '100', dep: '100', tc: 'holding', park: 'cash', rp: '0', st: '0', cost: '0.02' }),
  slFit(30, '9sig', 'dd', '1990–2025', '18.12', '22.67', { ul: 'tqqq', g: '0.5', cd: '5', cw: '60', sp: '250', per: 'quarterly', cash: '70', cr: '4', bp: '70', dep: '50', tc: 'holding', park: 'cash', rp: '30', st: '0', cost: '0.02' }),
  slFit(31, '9sig', 'ret', '1953–2025', '19.96', '96.58', { ul: 'tqqq', g: '40', cd: '25', cw: '24', sp: '160', per: 'quarterly', cash: '40', cr: '4', bp: '85', dep: '100', tc: 'target', park: 'cash', rp: '30', st: '0', cost: '0.02' }),
  slFit(32, '9sig', 'dd', '1953–2025', '12.01', '45.8', { ul: 'tqqq', g: '15', cd: '20', cw: '48', sp: '50', per: 'yearly', cash: '60', cr: '4', bp: '50', dep: '0', tc: 'holding', park: 'cash', rp: '15', st: '25', cost: '0.02' }),
  slFit(33, 'sma', 'ret', '2010–2025', '79.79', '74.03', { sig: 'spy', win: '280', ul: 'sso', cr: '0', eb: '5', xb: '1.9', oh: '20', cool: '55', ohw: '3', coolw: '22', cb: '3', cs: '10', settle: '5', out: 'tqqq', din: '10', dout: '5', bg: '55', bga: 'tqqq', bgw: '250', cost: '0.02' }),
  slFit(34, 'sma', 'dd', '2010–2025', '61.01', '44.5', { sig: 'qqq', win: '30', ul: 'tqqq', cr: '0', eb: '0.1', xb: '3.5', oh: '65', cool: '65', ohw: '4', coolw: '17', cb: '3', cs: '10', settle: '1', out: 'sso', din: '7', dout: '42', bg: '35', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(35, 'sma', 'ret', '1990–2025', '54.13', '81.66', { sig: 'qqq', win: '30', ul: 'spy', cr: '0', eb: '13', xb: '12', oh: '80', cool: '70', ohw: '6', coolw: '16', cb: '0', cs: '10', settle: '5', out: 'tqqq', din: '7', dout: '25', bg: '30', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(36, 'sma', 'dd', '1990–2025', '31.28', '39.46', { sig: 'spxl', win: '220', ul: 'tqqq', cr: '0', eb: '0', xb: '5', oh: '15', cool: '45', ohw: '2', coolw: '8', cb: '0', cs: '10', settle: '0', out: 'cash', din: '4', dout: '12', bg: '30', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(37, 'sma', 'ret', '1953–2025', '29.97', '83.6', { sig: 'spxl', win: '20', ul: 'tqqq', cr: '0', eb: '0.4', xb: '0.4', oh: '80', cool: '0', ohw: '12', coolw: '17', cb: '0', cs: '0', settle: '0', out: 'spy', din: '1', dout: '6', bg: '35', bga: 'qld', bgw: '300', cost: '0.02' }),
  slFit(38, 'sma', 'dd', '1953–2025', '18', '51.79', { sig: 'spxl', win: '20', ul: 'qld', cr: '0', eb: '0.5', xb: '0.3', oh: '85', cool: '75', ohw: '8', coolw: '25', cb: '0', cs: '0', settle: '1', out: 'cash', din: '0', dout: '5', bg: '20', bga: 'qqq', bgw: '250', cost: '0.02' }),
];
const slRunnable = (e) => !!(e && (e.preset || e.code));

// ── 저장·공유된 예전 라이브러리 코드 → 지금 코드 (2026-10-21 버그 고침) ─────────
// 고치기 전 코드의 지문(FNV-1a 32비트 · 글자 수). '써 보기'로 저장했거나 링크로 받은 사본이 손대지 않은 예전 코드면
// 지금 코드로 바꿈 — 사용자가 고친 코드(지문이 다름)는 그대로 둠
//   #1 Faber: 차트가 주 단위면 매주 판단하던 것 → 달의 마지막 거래일에만 · #18: 계산 끝 날(주 중간)에 판단하던 것
//   #2 #3 #8 #9 #10 #11 #12 #15 #17 #18 #19 #22 #23: 파는 날 들어온 적립금이 사라지던 것 · #26: 첫날 창이 하나 짧아질 수 있던 것
const SS_LIB_OLD = { 1: '9398d0d5:3065', 2: '69d110b3:2973', 3: '62609f35:2970', 8: 'b69ecf43:3155', 9: '5dd45200:3108', 10: '57a3b329:3298',
  11: '4775b483:2974', 12: '78c98b65:2938', 15: '5f6a2ba5:3747', 17: 'c99f178f:2353', 18: 'aac02be6:3205', 19: '99d2dda8:3082',
  22: 'b0ac78a6:3799', 23: 'c428c6db:3811', 26: '071d71cc:7489' };
function ssLibFingerprint(code) {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + ':' + code.length;
}
// 사용자 전략(cfg) 한 개 — 예전 라이브러리 코드면 지금 코드·설명으로 바꾸고 true
function ssUpgradeLibCode(cfg) {
  if (!cfg || cfg.type !== 'custom' || !cfg.code) return false;
  const f = ssLibFingerprint(cfg.code);
  for (const n in SS_LIB_OLD) {
    if (SS_LIB_OLD[n] !== f) continue;
    const L = SS_LIBRARY.find((e) => e.n === +n);
    if (!L || !L.code) return false;
    cfg.code = L.code; cfg.desc = L.rules || cfg.desc; cfg.lib = L.n;
    return true;
  }
  return false;
}

// ── 카드 숫자 (열 때 계산 · 보이는 카드만 · 한 번 계산하면 기억) ─────────────
const SL_SPARK_FROM = '1995-01-01';   // 작은 곡선의 왼쪽 끝
const SL_START = 10000;               // 시작 금액
const SL_MONTH = 1000;                // 새 달 첫 거래일마다 더하는 돈
// 다섯 칸: 전체 + 두 전환점(닷컴 고점 2000 1분기 · 금융위기 바닥 2009 1분기)으로 자른 네 구간
// 진입은 앱과 같게 경계 분기의 '직전 분기말' — 끝은 경계 이하 마지막 분기말(null = 마지막 날)
const SL_ERAS = [
  { key: '1971', from: '1971-01-01', to: null, label: ['1971–', '오늘'], sub: '전체 기간' },
  { key: '1980', from: '1980-01-01', to: '2000-03-31', label: ['1980–', '2000 1분기'], sub: '거품 전 상승기' },
  { key: '2000', from: '2000-03-31', to: '2009-03-31', label: ['2000 1분기–', '2009 1분기'], sub: '닷컴 고점 → 금융위기 바닥' },
  { key: '2009', from: '2009-03-31', to: '2025-12-31', label: ['2009 1분기–', '2025 4분기'], sub: '금융위기 뒤 상승장' },
  { key: '2026', from: '2025-12-31', to: null, label: ['2026–', '오늘'], sub: '올해' },
];
const SLX = { days: null, grid: null, spy: null, memo: new Map(), mods: new Map() };

// 자료가 바뀌면(다시 불러오면) 기억을 비움
function slBase() {
  if (!DS.days || !DS.days.length || !DS.q || !DS.q.length) return null;
  if (SLX.days === DS.days && SLX.grid) return SLX;
  SLX.days = DS.days;
  SLX.memo = new Map();
  SLX.mods = new Map();
  SLX.grid = slQuarterGrid();
  SLX.spy = slSpyCurve(SLX.grid);
  return SLX;
}
// 1995년부터 분기마다 한 점 — 날짜는 그 분기의 마지막 거래일, 이름표는 그 거래일의 달 (진행 중인 분기가 미래 달로 안 보이게)
function slQuarterGrid() {
  const days = DS.days, out = [];
  let i = 0;
  while (i < days.length && days[i].date < SL_SPARK_FROM) i++;
  let qk = null;
  for (; i < days.length; i++) {
    const d = days[i].date, k = d.slice(0, 4) + 'Q' + Math.ceil(+d.slice(5, 7) / 3);
    if (k !== qk) { out.push({ key: d.slice(0, 7), date: d }); qk = k; }
    else { const o = out[out.length - 1]; o.date = d; o.key = d.slice(0, 7); }
  }
  return out;
}
// 비교선: 1995년 첫 거래일에 SPY 를 $10K 사고, 새 달 첫 거래일마다 $1,000 어치 더 삼 (전략과 같은 돈 흐름)
function slSpyCurve(grid) {
  const days = DS.days, out = new Array(grid.length);
  let si = -1;
  for (let i = 0; i < days.length; i++) if (days[i].date >= SL_SPARK_FROM) { si = i; break; }
  if (si < 0 || !(days[si].spy > 0)) return out.fill(SL_START);
  let units = SL_START / days[si].spy, mo = days[si].date.slice(0, 7), di = si;
  for (let q = 0; q < grid.length; q++) {
    while (di < days.length - 1 && days[di].date < grid[q].date) {
      di++;
      const m = days[di].date.slice(0, 7);
      if (m !== mo) { mo = m; if (days[di].spy > 0) units += SL_MONTH / days[di].spy; }
    }
    out[q] = units * days[di].spy;
  }
  return out;
}
// 분기 행 찾기 · 날짜 위치 찾기
function slQAtOrAfter(d) { const Q = DS.q; for (let i = 0; i < Q.length; i++) if (Q[i][0] >= d) return i; return -1; }
function slQAtOrBefore(d) { const Q = DS.q; if (!d) return Q.length - 1; for (let i = Q.length - 1; i >= 0; i--) if (Q[i][0] <= d) return i; return -1; }
function slDayAtOrBefore(d) {
  const days = DS.days;
  if (!d) return days.length - 1;
  let lo = 0, hi = days.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m].date <= d) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}
const slEntryQ = (d) => { const qi = slQAtOrAfter(d); return qi > 0 ? qi - 1 : qi; };
const slQDate = (qi, fb) => (qi >= 0 && DS.q[qi] ? DS.q[qi][0] : fb);

// 코드 전략 한 번 실행 (1차 코드라 메인 스레드에서 — 사용자 코드는 절대 이 길로 안 옴)
function slRunCode(mod, si, ei) {
  const days = DS.days, d0 = days[si].date, d1 = days[ei].date;
  const g = { initial: SL_START, monthly: SL_MONTH, annualRaise: 0, startIdx: si, endIdx: ei, entryDate: d0, exitDate: d1,
    contributions: ssContribObj(SL_MONTH, 0, d0, d1, null) };
  return ssRunTrusted(mod, g, {}).log || [];
}
// 프리셋 한 번 실행 (기본 엔진 · 저장 전략과 같은 옵션 연결)
function slRunPreset(pr, qa, qb) {
  const p = ssCleanParams(pr.type, pr.params);
  const d0 = slQDate(qa, null), d1 = slQDate(qb, null);
  const base = { initial: SL_START, monthly: SL_MONTH, raise: 0, qi0: qa, qi1: qb, rate: ssRate9(p) };
  if (pr.type === '9sig') {
    const o9 = ssOpts9(p), per = p.per || 'quarterly';
    let rows = null;
    const rp = +p.rp || 0;
    if (rp > 0) {
      const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1));
      const q = ssShiftRows(per, off, d0, d1);
      if (q && q.length >= 2) rows = q;
    }
    const yearly = per === 'yearly';
    const r = ssRun9(Object.assign({}, base, { period: per, rows, sampleQ: yearly, noBH: true }, o9));
    return {
      points: (yearly ? r.samples : r.log).map((l) => ({ date: l.date, value: l.total })),
      ctrl: r.log.map((l) => ({ date: l.date, shares: l.price > 0 ? l.holdVal / l.price : 0, cash: l.cash })),
      key: SS_KEY_OF[o9.ul] || 'tqqq', start: d0, end: d1,
    };
  }
  const r = ssRunSma(Object.assign({}, base, { dd: true }, ssOptsSma(p)));
  return { points: r.points.map((pt) => ({ date: pt.date, value: pt.value })), multi: r.dd || null, start: d0, end: d1, daily: true };
}
// 한 전략의 실행기: (구간 시작, 끝) → 결과
function slRunner(e) {
  const B = slBase();
  if (e.preset) return (from, to) => slRunPreset(e.preset, slEntryQ(from), slQAtOrBefore(to));
  let mod = B.mods.get(e.n);
  if (!mod) { mod = ssEvalTrusted(e.code); B.mods.set(e.n, mod); }
  return (from, to) => {
    const si = slDayAtOrBefore(slQDate(slEntryQ(from), from));
    const ei = to === null ? DS.days.length - 1 : slDayAtOrBefore(slQDate(slQAtOrBefore(to), to));
    // 시작 금액은 진입일에, 적립은 달이 바뀐 첫 거래일에 들어감(slRunCode 의 contributions) → 연평균도 그 날짜로
    return { points: slRunCode(mod, si, ei), start: DS.days[si].date, daily: true };
  };
}
// 돈 가중 연수익률(IRR) + 최대 낙폭 — 매달 새 돈이 들어가므로 단순 시작/끝 비율이면 적립금을 수익으로 셈
function slMeasure(res) {
  const pts = res && res.points;
  if (!pts || pts.length < 2 || !(pts[0].value > 0)) return null;
  const v1 = pts[pts.length - 1].value;
  // 끝 = 마지막 값이 나온 점의 날짜 (리밸런스 시점을 옮긴 프리셋은 구간 끝보다 앞일 수 있음 — 본 화면 연평균과 같은 규칙)
  const d0 = res.start || pts[0].date, d1 = String(pts[pts.length - 1].date);
  const yrs = (Date.parse(d1) - Date.parse(d0)) / (365.25 * 864e5);
  // 낙폭: 앱처럼 매일 종가로 다시 평가 (엔진 기준점 → 없으면 코드 기록으로 기준점을 만듦 → 그래도 없으면 기록 값으로)
  let dd = null;
  if (res.multi && res.multi.length) dd = ssDailyDDMulti(res.multi).pct;
  else if (res.ctrl && res.ctrl.length) dd = ssDailyDD(res.ctrl, res.key || 'tqqq').pct;
  else { const cc = ssCustomCtrl(pts); if (cc) dd = ssDailyDDMulti(cc).pct; }
  if (dd == null) {
    let top = -Infinity;
    dd = 0;
    for (const r of pts) { if (r.value > top) top = r.value; if (top > 0) dd = Math.max(dd, 1 - r.value / top); }
  }
  const paid = SL_START + SL_MONTH * Math.max(0, Math.round(yrs * 12));
  // 적립 날짜·장부 규칙은 그 계산과 같게: 코드 전략·SMA = 'day', 9sig 프리셋 = 'r9' (ssFlows)
  const cagr = yrs > 0 ? ssCagrMW(SL_START, SL_MONTH, 0, d0, d1, yrs, v1, paid, null, res.daily ? 'day' : 'r9', true) : 0;
  return { cagr, dd: dd * 100 };
}
// 기록을 분기 점에 맞춤 (그 분기 날짜까지의 마지막 값 · 첫 기록 전은 시작 금액)
function slFill(pts, grid) {
  const out = new Array(grid.length);
  let j = 0, last = SL_START;
  for (let q = 0; q < grid.length; q++) {
    while (j < pts.length && pts[j].date <= grid[q].date) { last = pts[j].value; j++; }
    out[q] = last;
  }
  return out;
}
// 한 카드의 숫자 — 실패한 전략은 그 카드만 '—' (라이브러리 전체는 계속)
function slStats(e) {
  const B = slBase();
  if (!B || !e) return null;
  if (B.memo.has(e.n)) return B.memo.get(e.n);
  let res = null;
  if (slRunnable(e)) {
    try {
      const run = slRunner(e), metrics = {};
      for (const era of SL_ERAS) { const m = slMeasure(run(era.from, era.to)); if (m) metrics[era.key] = m; }
      res = { metrics, curve: slFill(run(SL_SPARK_FROM, null).points || [], B.grid) };
    } catch (err) {
      console.warn('전략 라이브러리 #' + e.n + ' 계산 실패 —', (err && err.message) || err);
      res = { metrics: {}, curve: null };
    }
  }
  B.memo.set(e.n, res);
  return res;
}

// ── 화면 ──────────────────────────────────────────────────────────────
const SL_PAGE = 8;   // 한 쪽 카드 수 (카드마다 계산이 여러 번 돌아서)
const SLU = { el: null, page: 1, q: '', token: 0, back: null, tip: null, active: null };
const SL_WIP = '공개된 글을 바탕으로 이 앱에서 다시 구현한 전략들이며, 합성 자료 위에서 시작 $10K + 매달 $1,000, 세금 없음으로 백테스트했습니다. '
  + '실제 결과는 더 나쁩니다: 자주 사고파는 전략은 세금과 슬리피지에 크게 깎이고, 여기 있는 3배 전략 대부분은 1971년부터 보면 어딘가에서 80% 넘는 낙폭(몇몇은 거의 100%)을 겪었습니다. '
  + '대략적인 비교로만 보세요 — 오류를 고치고 빠진 전략을 채우면서 숫자는 바뀔 수 있습니다.';

// 짧은 금액: $10K · $257K · $22M · $1.3B
function slMoney(v) {
  if (!(v > 0)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
const slPct = (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%');
// 낙폭: 90% 넘으면 소수 셋째 자리까지 (−99.960% 와 −100% 는 살아남은 계좌와 깡통의 차이)
function slDDText(dd) { const t = dd > 90 ? dd.toFixed(3) : String(Math.round(dd)); return +t === 0 ? '0%' : '−' + t + '%'; }
const slQName = (key) => key.slice(0, 4) + '년 ' + Math.ceil(+key.slice(5, 7) / 3) + '분기';

// 규칙 풍선: 이름 · 규칙 · 필요한 자료 · 출처 메모
function slTipText(e) {
  const parts = [e.name, '', e.rules];
  if (e.needs) parts.push('', '이 앱에 없는 자료가 필요함: ' + e.needs);
  if (e.reported) parts.push('', '출처 메모: ' + e.reported);
  return parts.join('\n');
}
// 한 쪽에 보일 카드 (검색어의 모든 낱말이 이름·태그·필요 자료·규칙에 들어 있어야)
function slFiltered() {
  const words = SLU.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SS_LIBRARY.slice();
  return SS_LIBRARY.filter((e) => {
    const hay = [e.name, e.tag, SS_LIB_TAGS[e.tag], e.needs, e.rules].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// 로그 눈금 (카드마다 전략·SPY 둘 다 들어가게)
const SL_SW = 300, SL_SH = 120, SL_SP = 3;
function slScale(curve, spy) {
  const vals = curve.concat(spy).filter((v) => v > 0);
  const lo = Math.log10(Math.min.apply(null, vals)), hi = Math.log10(Math.max.apply(null, vals));
  const span = (hi - lo) || 1;
  return {
    lo, hi,
    y: (v) => (v > 0 ? SL_SH - SL_SP - ((Math.log10(v) - lo) / span) * (SL_SH - 2 * SL_SP) : SL_SH - SL_SP),
    x: (i, n) => SL_SP + (i / (n - 1)) * (SL_SW - 2 * SL_SP),
  };
}
function slSparkHtml(e, st) {
  const ok = slRunnable(e);
  if (!ok) return '<div class="ss-lib-sp ss-lib-sp0"><span>백테스트 없음</span></div>';
  if (!st) return '<div class="ss-lib-sp ss-lib-sp0 ss-lib-wait"><span>계산 중…</span></div>';
  const curve = st.curve, spy = SLX.spy;
  if (!curve || !spy || !spy.length) return '<div class="ss-lib-sp ss-lib-sp0"><span>계산하지 못했습니다</span></div>';
  const s = slScale(curve, spy), N = curve.length;
  const path = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + s.x(i, N).toFixed(1) + ' ' + s.y(v).toFixed(1)).join(' ');
  let grid = '';
  for (let k = Math.ceil(s.lo); k <= Math.floor(s.hi); k++) { const y = s.y(Math.pow(10, k)).toFixed(1); grid += '<line x1="0" y1="' + y + '" x2="' + SL_SW + '" y2="' + y + '"/>'; }
  // 이름표 높이(%): 아래 연도 줄·왼쪽 위 '로그' 표시와 안 겹치게, 오른쪽 끝 두 이름표는 서로 10% 이상 떨어지게
  const pc = (v) => (s.y(v) / SL_SH) * 100, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let yS = clamp(pc(curve[N - 1]), 6, 78), yB = clamp(pc(spy[spy.length - 1]), 6, 78);
  if (Math.abs(yS - yB) < 10) {
    const mid = (yS + yB) / 2, sTop = yS <= yB;
    yS = mid + (sTop ? -5 : 5); yB = mid + (sTop ? 5 : -5);
    const top = Math.min(yS, yB), bot = Math.max(yS, yB);
    if (top < 6) { yS += 6 - top; yB += 6 - top; } else if (bot > 78) { yS -= bot - 78; yB -= bot - 78; }
  }
  const y0 = clamp(pc(SL_START), 18, 78);
  const g = SLX.grid, years = [0, 1, 2, 3].map((k) => g[Math.round((k / 3) * (g.length - 1))].key.slice(0, 4));
  const span = g.length ? g[0].key.slice(0, 4) + '–' + g[g.length - 1].key.slice(0, 4) : '';
  return '<div class="ss-lib-sp" data-n="' + e.n + '">'
    + '<svg viewBox="0 0 ' + SL_SW + ' ' + SL_SH + '" preserveAspectRatio="none" role="img" aria-label="' + ssEsc(e.name) + ' 와 SPY, 로그 눈금 ' + span + '">'
    + '<g class="ss-lib-grid">' + grid + '</g>'
    + '<path class="ss-lib-lspy" d="' + path(spy) + '"/>'
    + '<path class="ss-lib-lst" d="' + path(curve) + '"/></svg>'
    + '<span class="ss-lib-log">로그</span>'
    + '<span class="ss-lib-lb ss-lib-lb0" style="top:' + y0.toFixed(0) + '%">' + slMoney(SL_START) + '</span>'
    + '<span class="ss-lib-lb ss-lib-lbst" style="top:' + yS.toFixed(0) + '%">' + slMoney(curve[N - 1]) + '</span>'
    + '<span class="ss-lib-lb ss-lib-lbspy" style="top:' + yB.toFixed(0) + '%">SPY ' + slMoney(spy[spy.length - 1]) + '</span>'
    + '<span class="ss-lib-yr">' + years.map((y) => '<b>' + y + '</b>').join('') + '</span>'
    + '<i class="ss-lib-x" aria-hidden="true"></i><i class="ss-lib-dot ss-lib-dspy" aria-hidden="true"></i><i class="ss-lib-dot ss-lib-dst" aria-hidden="true"></i>'
    + '</div>';
}
// 시기 표: 기간 / 연평균(돈 가중) / 최대 낙폭
function slEraHtml(e, st) {
  const m = st && st.metrics, wait = slRunnable(e) && !st;
  const head = SL_ERAS.map((era) => {
    const c = m && m[era.key];
    const t = era.label.join('') + ' · ' + era.sub + (c ? '\n' + slPct(c.cagr) + ' 연평균 수익률(돈 가중 CAGR)\n' + slDDText(c.dd) + ' 그 기간 안 가장 깊은 낙폭' : '');
    return '<td title="' + ssEsc(t) + '"><span>' + era.label[0] + '</span><span>' + era.label[1] + '</span></td>';
  }).join('');
  const cell = (fn) => SL_ERAS.map((era) => { const c = m && m[era.key]; return c ? fn(c) : '<td class="ss-lib-na">' + (wait ? '…' : '—') + '</td>'; }).join('');
  return '<table class="ss-lib-era"><tbody>'
    + '<tr class="ss-lib-rd"><th scope="row">기간</th>' + head + '</tr>'
    + '<tr class="ss-lib-rc"><th scope="row">연평균</th>' + cell((c) => '<td class="' + (c.cagr >= 0 ? 'ss-lib-up' : 'ss-lib-dn') + '">' + slPct(c.cagr) + '</td>') + '</tr>'
    + '<tr class="ss-lib-rx"><th scope="row">최대 낙폭</th>' + cell((c) => '<td>' + slDDText(c.dd) + '</td>') + '</tr>'
    + '</tbody></table>';
}
function slCardHtml(e) {
  const st = SLX.memo.has(e.n) ? SLX.memo.get(e.n) : null, ok = slRunnable(e);
  const link = e.src && SS_LIB_LINKS[e.src];
  const nm = link
    ? '<a class="ss-lib-nm" href="' + ssEsc(link) + '" target="_blank" rel="noopener" title="' + ssEsc(e.rules) + '">' + ssEsc(e.name) + '</a>'
    : '<span class="ss-lib-nm" title="' + ssEsc(e.rules) + '">' + ssEsc(e.name) + '</span>';
  const act = ok
    ? '<button type="button" class="ss-lib-try" data-try="' + e.n + '" title="이 전략을 저장 전략으로 차트에 더하기">써 보기 <span aria-hidden="true">▸</span></button>'
    : e.needs
      ? '<span class="ss-lib-na2" title="이 앱에 없는 자료가 필요합니다">' + ssEsc(e.needs) + ' 필요</span>'
      : '<span class="ss-lib-na2">준비 중</span>';
  return '<article class="ss-lib-card' + (ok ? '' : ' off') + '" data-n="' + e.n + '">'
    + '<div class="ss-lib-ch"><div class="ss-lib-tt"><span class="ss-lib-tag">' + ssEsc(SS_LIB_TAGS[e.tag] || e.tag) + '</span>' + nm + '</div>'
    + '<div class="ss-lib-ca">' + act
    + '<span class="ss-i ss-lib-info" tabindex="0" role="button" aria-label="규칙 보기" data-tip="' + ssEsc(slTipText(e)) + '" data-tip-wide>ⓘ</span></div></div>'
    + '<div class="ss-lib-body">' + slSparkHtml(e, st) + slEraHtml(e, st) + '</div>'
    + '</article>';
}
function slPagerHtml(total, pages, from, shown) {
  if (!total) return '';
  const b = (pg, label, dis, on, aria) => '<button type="button" class="ss-lib-pg' + (on ? ' on' : '') + '" data-page="' + pg + '"' + (dis ? ' disabled' : '') + (on ? ' aria-current="page"' : '') + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
  let nums = '';
  for (let k = 1; k <= pages; k++) nums += b(k, k, false, k === SLU.page, k + '쪽');
  return '<span class="ss-lib-pinfo">' + (from + 1) + '–' + (from + shown) + ' / ' + total + '</span>'
    + '<span class="ss-lib-pbtns">' + b(SLU.page - 1, '‹', SLU.page <= 1, false, '이전 쪽') + nums + b(SLU.page + 1, '›', SLU.page >= pages, false, '다음 쪽') + '</span>';
}

// 한 쪽 그리기 — 기억해 둔 카드는 바로, 나머지는 하나씩 계산하며 채움 (창이 바로 뜨게)
function slRenderPage(scrollTop) {
  const root = SLU.el;
  if (!root) return;
  slHideTip();
  const list = slFiltered(), pages = Math.max(1, Math.ceil(list.length / SL_PAGE));
  SLU.page = Math.min(Math.max(1, SLU.page), pages);
  const from = (SLU.page - 1) * SL_PAGE, slice = list.slice(from, from + SL_PAGE);
  const cards = root.querySelector('.ss-lib-cards');
  cards.innerHTML = slice.map(slCardHtml).join('');
  root.querySelector('.ss-lib-none').hidden = list.length > 0;
  root.querySelector('.ss-lib-pager').innerHTML = slPagerHtml(list.length, pages, from, slice.length);
  if (scrollTop) root.querySelector('.ss-lib-scroll').scrollTop = 0;
  const token = ++SLU.token;
  const todo = slice.filter((e) => slRunnable(e) && !SLX.memo.has(e.n));
  const step = () => {
    if (token !== SLU.token || !todo.length || !SLU.el || SLU.el.hidden) return;
    const e = todo.shift();
    slStats(e);
    const card = cards.querySelector('.ss-lib-card[data-n="' + e.n + '"]');
    if (card) { const st = SLX.memo.get(e.n); card.querySelector('.ss-lib-body').innerHTML = slSparkHtml(e, st) + slEraHtml(e, st); }
    if (todo.length) setTimeout(step, 0);
  };
  if (todo.length) setTimeout(step, 16);
}

// 작은 곡선 위 마우스·손가락 → 세로선 + 점 두 개 + 풍선 (그 분기의 전략·SPY 금액)
function slSparkAt(box, clientX) {
  const st = SLX.memo.get(+box.getAttribute('data-n')), curve = st && st.curve, spy = SLX.spy;
  if (!curve || !spy) { slHideTip(); return; }
  if (SLU.active && SLU.active !== box) SLU.active.classList.remove('hov');
  SLU.active = box;
  box.classList.add('hov');
  const r = box.getBoundingClientRect(), N = curve.length, s = slScale(curve, spy);
  const fx = ((clientX - r.left) / r.width * SL_SW - SL_SP) / (SL_SW - 2 * SL_SP);
  const i = Math.round(Math.max(0, Math.min(1, fx)) * (N - 1));
  const xPx = (s.x(i, N) / SL_SW) * r.width, yPx = (v) => (s.y(v) / SL_SH) * r.height;
  const setAt = (sel, y) => { const el = box.querySelector(sel); if (el) { el.style.left = xPx + 'px'; if (y != null) el.style.top = y + 'px'; } };
  setAt('.ss-lib-x'); setAt('.ss-lib-dst', yPx(curve[i])); setAt('.ss-lib-dspy', yPx(spy[i]));
  const sv = curve[i], pv = spy[i], top = Math.max(sv, pv, 1);
  const ws = Math.max(2, (sv / top) * 100).toFixed(1), wp = Math.max(2, (pv / top) * 100).toFixed(1);
  const mult = pv > 0 ? 'SPY 의 ' + (sv / pv).toFixed(sv / pv >= 10 ? 0 : 1) + '배' : '';
  let tip = SLU.tip;
  if (!tip) { tip = document.createElement('div'); tip.className = 'ss-lib-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); SLU.tip = tip; }
  tip.innerHTML = '<div class="ss-lib-tq">' + slQName(SLX.grid[i].key) + '<b>' + mult + '</b></div>'
    + '<div class="ss-lib-tr"><span class="ss-lib-tb"><i class="st" style="width:' + ws + '%"></i></span><span class="ss-lib-tv st">' + slMoney(sv) + '</span></div>'
    + '<div class="ss-lib-tr"><span class="ss-lib-tb"><i class="spy" style="width:' + wp + '%"></i></span><span class="ss-lib-tv">SPY ' + slMoney(pv) + '</span></div>';
  tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + xPx + 14;
  if (left + tw > window.innerWidth - 8) left = r.left + xPx - tw - 14;
  left = Math.max(8, left);
  const top2 = Math.max(8, Math.min(window.innerHeight - th - 8, r.top + 4));
  tip.style.left = left + 'px';
  tip.style.top = top2 + 'px';
}
function slHideTip() {
  if (SLU.tip) SLU.tip.style.display = 'none';
  if (SLU.active) { SLU.active.classList.remove('hov'); SLU.active = null; }
}

// 써 보기 → 저장 전략으로 추가하고 창을 닫음 (선이 바로 보이게)
function slTry(e) {
  if (!slRunnable(e) || typeof ssAddFromLibrary !== 'function') return null;
  const arg = e.preset
    ? { n: e.n, name: e.name, rules: e.rules, preset: { type: e.preset.type, params: Object.assign({}, e.preset.params) } }
    : { n: e.n, name: e.name, rules: e.rules, code: e.code };
  const id = ssAddFromLibrary(arg);
  if (SLU.el && !SLU.el.hidden) ssLibraryClose();
  return id;
}

function slBuild() {
  if (SLU.el) return SLU.el;
  const ready = SS_LIBRARY.filter(slRunnable).length;
  const el = document.createElement('div');
  el.className = 'ss-lib';
  el.hidden = true;
  el.innerHTML = '<div class="ss-lib-box" role="dialog" aria-modal="true" aria-labelledby="ss-lib-h" tabindex="-1">'
    + '<div class="ss-lib-top"><h2 class="ss-lib-h" id="ss-lib-h"><span aria-hidden="true">📚</span> 전략 라이브러리</h2>'
    + '<details class="ss-lib-wip"><summary>⚠ 아직 만드는 중 — 숫자는 대략적인 비교용</summary><p>' + ssEsc(SL_WIP) + '</p></details>'
    + '<button type="button" class="ss-lib-close" aria-label="닫기">×</button></div>'
    + '<div class="ss-lib-scroll"><div class="ss-lib-head"><div class="ss-lib-bar">'
    + '<span class="ss-lib-leg"><i class="st"></i>전략 <i class="spy"></i>SPY · 로그 · <span class="ss-lib-span"></span></span>'
    + '<nav class="ss-lib-pager" aria-label="쪽 넘기기"></nav>'
    + '<span class="ss-lib-cnt">' + ready + '/' + SS_LIBRARY.length + ' 백테스트됨 · 규칙은 ⓘ</span></div>'
    + '<input type="search" class="ss-lib-q" autocomplete="off" spellcheck="false" placeholder="전략 찾기 — 이름·태그·규칙 낱말…" aria-label="전략 찾기"></div>'
    + '<p class="ss-lib-none" hidden>찾는 전략이 없습니다 — 다른 낱말로 찾아보세요.</p>'
    + '<div class="ss-lib-cards"></div></div></div>';
  document.body.appendChild(el);
  SLU.el = el;
  // 누르기: 닫기 · 바깥(배경) · 써 보기 · 쪽
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === el || t.closest('.ss-lib-close')) { ssLibraryClose(); return; }
    const tr = t.closest('[data-try]');
    if (tr) { const e = SS_LIBRARY.find((x) => x.n === +tr.getAttribute('data-try')); if (e) slTry(e); return; }
    const pg = t.closest('[data-page]');
    if (pg && !pg.disabled) { SLU.page = +pg.getAttribute('data-page'); slRenderPage(true); }
  });
  const q = el.querySelector('.ss-lib-q');
  q.addEventListener('input', () => { SLU.q = q.value; SLU.page = 1; slRenderPage(true); });
  const cards = el.querySelector('.ss-lib-cards');
  // 마우스: 지나가며 보기 · 손가락: 누른 채 옆으로 끌어 보기 (위아래로 끌면 그냥 스크롤)
  cards.addEventListener('pointermove', (ev) => {
    const box = ev.target.closest && ev.target.closest('.ss-lib-sp[data-n]');
    if (!box) { if (SLU.active) slHideTip(); return; }
    if (ev.pointerType === 'mouse' || ev.buttons) slSparkAt(box, ev.clientX);
  });
  cards.addEventListener('pointerdown', (ev) => { const box = ev.target.closest && ev.target.closest('.ss-lib-sp[data-n]'); if (box) slSparkAt(box, ev.clientX); });
  cards.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') slHideTip(); });
  el.querySelector('.ss-lib-scroll').addEventListener('scroll', slHideTip, { passive: true });
  return el;
}
// 창이 열려 있는 동안: Esc = (검색어가 있으면) 검색어 지우기 / 닫기 · Tab 은 창 안에서만 돎
function slOnKey(ev) {
  const el = SLU.el;
  if (!el || el.hidden) return;
  if (ev.key === 'Escape') {
    const q = el.querySelector('.ss-lib-q');
    if (document.activeElement === q && q.value) { q.value = ''; SLU.q = ''; SLU.page = 1; slRenderPage(true); }
    else ssLibraryClose();
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  if (ev.key === 'Tab') {
    const f = Array.from(el.querySelectorAll('a[href], button:not([disabled]), input, summary, [tabindex="0"]')).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (ev.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { z.focus(); ev.preventDefault(); }
    else if (!ev.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { a.focus(); ev.preventDefault(); }
  }
}
function slDropHash() {
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* 주소를 못 바꾸는 환경 */ }
}

function ssLibraryOpen() {
  const el = slBuild();
  const B = slBase();
  const span = el.querySelector('.ss-lib-span');
  if (span) span.textContent = B && B.grid.length ? B.grid[0].key.slice(0, 4) + '–' + B.grid[B.grid.length - 1].key.slice(0, 4) : '';
  if (el.hidden) {
    SLU.back = document.activeElement;
    el.hidden = false;
    document.documentElement.classList.add('ss-lib-on');
    document.addEventListener('keydown', slOnKey, true);
  }
  if (!B) {
    el.querySelector('.ss-lib-cards').innerHTML = '<p class="ss-lib-none">가격 자료를 불러오는 중입니다 — 잠시 뒤 다시 열어 주세요.</p>';
    el.querySelector('.ss-lib-pager').innerHTML = '';
  } else {
    el.querySelector('.ss-lib-q').value = SLU.q;
    slRenderPage(false);
  }
  const box = el.querySelector('.ss-lib-box');
  if (box) box.focus({ preventScroll: true });
}
function ssLibraryClose() {
  const el = SLU.el;
  if (!el || el.hidden) return;
  el.hidden = true;
  SLU.token++;
  slHideTip();
  document.documentElement.classList.remove('ss-lib-on');
  document.removeEventListener('keydown', slOnKey, true);
  if (location.hash === '#library') slDropHash();
  const b = SLU.back;
  SLU.back = null;
  if (b && typeof b.focus === 'function' && document.contains(b)) { try { b.focus({ preventScroll: true }); } catch (err) { /* 무시 */ } }
}
// 주소: #library → 열기 · #add-N → N번 전략을 바로 저장 전략으로 (그 뒤 주소에서 지움)
function ssLibraryFromHash() {
  const h = location.hash || '';
  if (h === '#library') { ssLibraryOpen(); return; }
  const m = /^#add-(\d+)$/.exec(h);
  if (!m) return;
  slDropHash();
  const e = SS_LIBRARY.find((x) => x.n === +m[1]);
  if (e && slRunnable(e) && DS.days) slTry(e);
}

/* ═══ 40-state.js ═══ */
/* ── [STRATSIM] 40 앱 상태 · 브라우저 저장 · 공유 주소(#ss=) ──────────────────
   · 상태는 S 하나에 — 화면(DOM)은 S 를 그리기만 함
   · 저장: 브라우저 localStorage (입력·기간·보기 / 저장 전략 / 거래내역)
   · 공유·내 저장함: 지금 상태를 압축해 주소 # 에 둠(#ss=…) — 사이트의 공유 창·내 저장함이 # 를 함께 담음 */

const SS_LS = { main: 'dc_ss_state_v1', saved: 'dc_ss_saved_v1', tx: 'dc_ss_tx_v1', panelW: 'dc_ss_panel_w' };
const SS_BASE_COLORS = { '9sig': '#45818e', bh: '#ff2d2e', invested: '#bf9000', sma: '#c64eff' };
const SS_CFG_COLORS = ['#e879f9', '#f59e0b', '#34d399', '#fb7185', '#60a5fa', '#c084fc', '#f97316', '#2dd4bf', '#a78bfa', '#f43f5e', '#84cc16', '#38bdf8'];
const SS_TYPE_NAMES = { '9sig': '9sig', sma: 'SMA', bh: '그냥 보유', invested: '현금 복리', custom: '사용자 전략' };

const S = {
  iPos: 333, mPos: 233, raise: '0',            // 초기 투자 · 매달 적립(슬라이더 위치) · 연 증가율(%)
  e: 0, x: 0, ed: '', xd: '',                  // 진입·청산 분기 위치 + 정확한 날짜(있으면)
  log: false, infl: false,                     // 로그 축 · 물가 반영
  hide: { bh: false, invested: false },        // 기본 선 숨김
  base: { '9sig': ssDefaults('9sig'), sma: ssDefaults('sma'), bh: ssDefaults('bh'), invested: ssDefaults('invested') },
  baseColor: {},                               // 기본 선 색 (이번 방문 동안만)
  saved: [],                                   // 저장 전략
  editing: null,                               // 패널에서 편집 중인 저장 전략 id
  panel: null,                                 // 열린 기본 패널: 'bh' | 'invested' | null
  pendingName: null,                           // 기본 패널에서 저장 전 적어 둔 이름
  tx: null, txStash: null,                     // 거래내역: 켜진 것 · 꺼도 남는 마지막 것
  pin: null,                                   // 고정한 구간 [시작, 끝]
  an: { open: false, strategy: '9sig', baseline: 'compounded', target: 1e6, growth: 20, yMin: null, yMax: null },
  fetchedAt: null,
};
let ssReady = false;

// ── 저장 전략 ────────────────────────────────────────────────────────
const ssNewId = () => 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ssFindCfg(id) { return S.saved.find((c) => c.id === id) || null; }
function ssUniqueName(want, exceptId) {
  const used = new Set(S.saved.filter((c) => c.id !== exceptId).map((c) => c.name));
  let name = want, n = 2;
  while (used.has(name)) name = want + ' (' + (n++) + ')';
  return name;
}
function ssNextColor() {
  const used = new Set(S.saved.map((c) => c.color));
  for (const c of SS_CFG_COLORS) if (!used.has(c)) return c;
  return SS_CFG_COLORS[S.saved.length % SS_CFG_COLORS.length];
}
function ssBaseColor(type) { return S.baseColor[type] || SS_BASE_COLORS[type] || '#7a7aa6'; }
function ssCleanCfg(c) {
  if (!c || typeof c !== 'object' || !SS_TYPE_NAMES[c.type]) return null;
  const cfg = { id: typeof c.id === 'string' ? c.id : ssNewId(), type: c.type, name: String(c.name || SS_TYPE_NAMES[c.type]).slice(0, 80),
    color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : ssNextColor(), hidden: !!c.hidden };
  if (c.type === 'custom') {
    cfg.code = String(c.code || '');
    cfg.desc = String(c.desc || '');
    cfg.params = {};
    if (c.params && typeof c.params === 'object') for (const k in c.params) { const v = c.params[k]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') cfg.params[k] = v; }
    if (c.lib != null) cfg.lib = +c.lib;
  } else cfg.params = ssCleanParams(c.type, c.params);
  if (c.subShown && typeof c.subShown === 'object') { cfg.subShown = {}; for (const k in c.subShown) cfg.subShown[k] = !!c.subShown[k]; }
  return cfg;
}
function ssPersistSaved() {
  try { localStorage.setItem(SS_LS.saved, JSON.stringify(S.saved.filter((c) => !c._tr).map((c) => { const o = Object.assign({}, c); delete o._tr; return o; }))); } catch (e) {}
}

// ── 진입·청산 분기 번호(e·x) ─────────────────────────────────────────
// 번호는 '자료 첫 분기'부터 센 것 — 자료 시작이 바뀌어도(2026-10-21: 1953 → 1971-02-05, 그 전 나스닥 값은 검증할 수 없는 가상값이라 뺌)
// 예전 링크·저장값이 같은 분기를 가리키게 첫 분기말 날짜 q0 를 함께 적음 · q0 가 없으면 예전 자료(첫 분기말 1953-03-31) 기준
const SS_Q0_OLD = '1953-03-31';
const ssQKey = (d) => (+d.slice(0, 4)) * 4 + Math.floor((+d.slice(5, 7) - 1) / 3);
function ssQShift(i, q0) {
  if (!DS.q || !DS.q.length) return i;
  const k = ssQKey(typeof q0 === 'string' && /^\d{4}-\d\d-\d\d$/.test(q0) ? q0 : SS_Q0_OLD) + i - ssQKey(DS.q[0][0]);
  return Math.max(0, Math.min(DS.q.length - 1, k));
}
const ssQ0 = () => (DS.q && DS.q.length ? DS.q[0][0] : SS_Q0_OLD);

// ── 입력·보기 저장 ───────────────────────────────────────────────────
function ssPersistMain() {
  const o = { i: S.iPos, m: ssPosToMonthly(S.mPos), a: S.raise, r: ssPosToRate(+S.base.invested.r), e: S.e, x: S.x, q0: ssQ0(), ed: S.ed, xd: S.xd,
    l: S.log, f: S.infl, hd: Object.keys(S.hide).filter((k) => S.hide[k]) };
  try { localStorage.setItem(SS_LS.main, JSON.stringify(o)); } catch (e) {}
}
function ssApplyMain(o, fromLink) {
  if (!o || typeof o !== 'object') return;
  const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
  if (num(o.i) != null) S.iPos = Math.max(0, Math.min(1000, Math.round(num(o.i))));
  if (num(o.m) != null) S.mPos = ssMonthlyToPos(num(o.m));
  if (o.a != null && SS_RAISE_OPTS.some((x) => x === String(o.a))) S.raise = String(o.a);
  if (num(o.r) != null) S.base.invested.r = String(ssRateToPos(num(o.r)));
  if (num(o.e) != null) S.e = ssQShift(Math.max(0, Math.round(num(o.e))), o.q0);
  if (num(o.x) != null) S.x = ssQShift(Math.max(0, Math.round(num(o.x))), o.q0);
  S.ed = typeof o.ed === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.ed) ? o.ed : (fromLink ? '' : S.ed);
  S.xd = typeof o.xd === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.xd) ? o.xd : (fromLink ? '' : S.xd);
  if (o.l != null) S.log = !!o.l;
  if (o.f != null) S.infl = !!o.f;
  if (Array.isArray(o.hd)) { S.hide.bh = o.hd.indexOf('bh') >= 0; S.hide.invested = o.hd.indexOf('invested') >= 0; }
}
// 기본 선(그냥 보유·현금 복리)의 계산값: 그 설정 창을 열어 고치는 중일 때만 바꾼 값, 나머지 때는 늘 표준값
// (원본과 같음 — 주소에 bu·r 만 있고 창이 닫혀 있으면 표준 TQQQ·4% 로 그림)
function ssBaseEff(type) { return S.panel === type ? S.base[type] : ssDefaults(type); }
const SS_RAISE_OPTS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '15', '20', '25'];

function ssLoadStorage() {
  try { const o = JSON.parse(localStorage.getItem(SS_LS.main) || 'null'); if (o) ssApplyMain(o, false); } catch (e) {}
  try {
    const arr = JSON.parse(localStorage.getItem(SS_LS.saved) || '[]');
    if (Array.isArray(arr)) S.saved = arr.map(ssCleanCfg).filter(Boolean);
    // 예전(고치기 전) 라이브러리 코드로 저장된 사본은 지금 코드로 바꿔 다시 저장
    if (typeof ssUpgradeLibCode === 'function' && S.saved.filter(ssUpgradeLibCode).length) ssPersistSaved();
  } catch (e) {}
}

// ── 압축 (deflate-raw + base64url) ───────────────────────────────────
const ssB64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ssUnB64u = (t) => { let b = t.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function ssPack(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    try {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      return 'z' + ssB64u(new Uint8Array(out));
    } catch (e) {}
  }
  return 'j' + ssB64u(bytes);
}
async function ssUnpack(tok) {
  if (!tok || tok.length < 2) return null;
  const body = ssUnB64u(tok.slice(1));
  if (tok[0] === 'j') return new TextDecoder().decode(body);
  if (tok[0] !== 'z' || typeof DecompressionStream !== 'function') return null;
  const out = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(out));
}

// 지금 화면 상태 → 공유용 묶음 (원본 공유 링크와 같은 범위: 보이는 저장 전략·거래내역·분석 창·고정 구간 포함)
function ssShareState() {
  const o = { v: 1, i: S.iPos, m: ssPosToMonthly(S.mPos), a: S.raise, r: ssPosToRate(+S.base.invested.r), e: S.e, x: S.x, q0: ssQ0() };
  if (S.ed) o.ed = S.ed;
  if (S.xd) o.xd = S.xd;
  if (S.base.bh.ul !== 'tqqq') o.bu = S.base.bh.ul;
  const d9 = ssDiffParams('9sig', S.base['9sig']), ds = ssDiffParams('sma', S.base.sma);
  if (d9) o.b9 = d9;
  if (ds) o.bs = ds;
  if (S.log) o.l = 1;
  if (S.infl) o.f = 1;
  o.hd = Object.keys(S.hide).filter((k) => S.hide[k]);
  const act = S.saved.filter((c) => !c.hidden);
  // 라이브러리에서 그대로 가져온 사용자 전략은 코드 대신 번호만 (받는 쪽이 같은 코드를 라이브러리에서 채움 — 링크가 짧아져 공유 창 4000자 안에 들어감)
  const libOf = (c) => (c.lib != null && typeof SS_LIBRARY !== 'undefined' ? SS_LIBRARY.find((e) => e.n === c.lib) : null);
  if (act.length) o.sc = act.map((c) => {
    const x = { t: c.type, n: c.name, p: c.params || {}, c: c.color };
    if (c.type === 'custom') { const L = libOf(c); if (L && L.code && L.code === c.code) x.lib = c.lib; else { x.code = c.code || ''; x.desc = c.desc || ''; } }
    if (c.subShown) x.ss = c.subShown;
    return x;
  });
  if (S.panel) o.sp = S.panel;
  const oi = act.findIndex((c) => c.id === S.editing);
  if (oi >= 0) o.spc = oi;
  if (S.tx && S.tx.rows && S.tx.rows.length) o.tx = S.tx.rows;
  if (S.an.open) o.am = 1;
  const anKey = (k) => { if (!k || k.indexOf('cfg:') !== 0) return k; const i = act.findIndex((c) => c.id === k.slice(4)); return i >= 0 ? 'cfg:' + i : null; };
  if (S.an.strategy && S.an.strategy !== '9sig') { const k = anKey(S.an.strategy); if (k) o.as = k; }
  if (S.an.baseline && S.an.baseline !== 'compounded') {
    const k = anKey(S.an.baseline);
    if (k) { o.ab = k; if (k === 'custom') o.act = Math.round(S.an.target); if (k === 'custom-pct') o.acp = S.an.growth; }
  }
  if (S.an.yMin != null) o.anp = S.an.yMin;
  if (S.an.yMax != null) o.amp = S.an.yMax;
  if (S.pin) { o.rf = S.pin[0]; o.rt = S.pin[1]; }
  return o;
}
function ssDiffParams(type, p) {
  const d = ssDefaults(type), out = {};
  let n = 0;
  for (const k in d) if (String(p[k]) !== d[k]) { out[k] = p[k]; n++; }
  return n ? out : null;
}
function ssIsDefaultState(o) {
  return o.i === 333 && o.m === 500 && o.a === '0' && o.r === 4 && !o.ed && !o.xd && !o.bu && !o.b9 && !o.bs && !o.l && !o.f && !o.hd.length && !o.sc && !o.sp && !o.tx && !o.am && !o.as && !o.ab && !o.rf
    && o.e === ssDefaultEntry() && o.x === DS.q.length - 1;
}
const ssDefaultEntry = () => { const i = DS.q.findIndex((r) => r[0] >= '2010-01-01'); return i < 0 ? 0 : i; };

// 상태 → 주소 # (조용히 · 기록 안 쌓음). 기본 상태면 # 를 비움
let _ssHashT = null, _ssHashTok = '';
function ssSyncHash() {
  clearTimeout(_ssHashT);
  _ssHashT = setTimeout(async () => {
    if (!ssReady) return;
    const o = ssShareState();
    let h = '';
    if (!ssIsDefaultState(o)) { try { h = 'ss=' + await ssPack(JSON.stringify(o)); } catch (e) { h = ''; } }
    _ssHashTok = h;
    const cur = location.hash.replace(/^#/, '');
    if (cur === h || (!h && !cur)) return;
    if (cur && !/^ss=/.test(cur) && !/=/.test(cur)) { if (!h) return; }   // #library 같은 자리표는 상태가 바뀔 때만 덮어씀
    try { history.replaceState(history.state, '', location.pathname + location.search + (h ? '#' + h : '')); } catch (e) {}
  }, 350);
}
// 공유 주소 전체 (사이트 공유 창의 4000자 한도와 상관없이 바로 복사)
async function ssShareUrl() {
  const o = ssShareState();
  const tok = ssIsDefaultState(o) ? '' : await ssPack(JSON.stringify(o));
  const base = (document.querySelector('link[rel="canonical"]') || {}).href || (location.origin + location.pathname);
  return base.replace(/[?#].*$/, '') + (tok ? '#ss=' + tok : '');
}

// 주소 # → 상태 (불러올 때 한 번). 공유받은 저장 전략은 '임시'(저장 버튼을 눌러야 내 브라우저에 남음)
async function ssReadHash() {
  const m = /(?:^|[#&])ss=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!m) return null;
  try { const t = await ssUnpack(m[1]); const o = JSON.parse(t); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}
function ssImportShared(arr) {
  if (!Array.isArray(arr)) return [];
  const sig = (c) => c.type + '|' + (c.name || '') + '|' + (c.code || '') + '|' + JSON.stringify(c.params || {});
  const have = new Set(S.saved.map(sig));
  const mapped = [];
  for (const raw of arr.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') { mapped.push(null); continue; }
    let code = raw.code, desc = raw.desc;
    if (raw.t === 'custom' && raw.lib != null && !code && typeof SS_LIBRARY !== 'undefined') {
      const L = SS_LIBRARY.find((e) => e.n === +raw.lib);
      if (L && L.code) { code = L.code; desc = L.rules || ''; }
    }
    const c = ssCleanCfg({ type: raw.t, name: raw.n, params: raw.p, color: raw.c, code, desc, subShown: raw.ss, lib: raw.lib });
    if (!c) { mapped.push(null); continue; }
    if (typeof ssUpgradeLibCode === 'function') ssUpgradeLibCode(c);   // 예전 라이브러리 코드가 담긴 링크 → 지금 코드
    if (!have.has(sig(c))) { c.id = ssNewId(); c.name = ssUniqueName(c.name); c._tr = true; S.saved.push(c); have.add(sig(c)); }
    mapped.push(c);
  }
  return mapped;
}
// 공유 배열의 항목 → 지금 내 저장 전략 id (이름은 겹치면 바뀌므로 종류·코드·손잡이로 찾음 · 임시 것 먼저)
function ssResolveShared(c) {
  if (!c) return null;
  const key = (x) => x.type + '|' + (x.code || '') + '|' + JSON.stringify(x.params || {});
  const hits = S.saved.filter((x) => key(x) === key(c));
  if (!hits.length) return null;
  return (hits.find((x) => x._tr) || hits[0]).id;
}

/* ═══ 41-render.js ═══ */
/* ── [STRATSIM] 41 계산 → 차트 자료 ─────────────────────────────────────────
   render() 한 번 = 기간·적립·전략을 읽어 모든 선(그냥 보유 · 현금 복리 · 저장 전략 · 실제 계좌)을 계산하고
   x축 날짜(라벨)에 맞춰 차트에 넣음. 계산 순서·규칙은 원본과 같음(원본 대조 시험으로 확인) */

const SS_PERIOD_RANK = { weekly: 0, monthly: 1, quarterly: 2, yearly: 3 };
const ssFiner = (a, b) => (!a ? b : !b ? a : ((SS_PERIOD_RANK[a] ?? 2) <= (SS_PERIOD_RANK[b] ?? 2) ? a : b));
const ssYears = (a, b) => (!a || !b ? Infinity : (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / SS_YEAR_MS);

// 날짜 라벨마다 그 날 이하의 마지막 값 (라벨이 첫 점보다 앞이면 첫 값)
function ssResample(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  let j = 0;
  return labels.map((d) => { while (j + 1 < points.length && points[j + 1].date <= d) j++; return points[j].value; });
}
// 계산 중(옛 결과) 표시용: 옛 점들이 덮는 날짜 밖은 비움
function ssResampleClamped(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  const a = points[0].date, b = points[points.length - 1].date;
  let j = 0;
  return labels.map((d) => { if (d < a || d > b) return null; while (j + 1 < points.length && points[j + 1].date <= d) j++; return points[j].value; });
}

// x축 날짜 간격: 보이는 9sig 중 가장 잘게 · 기간 10년 미만이면 최소 주간, 아니면 분기
function ssDisplayGrain(livePeriod, spanYears) {
  let p = null;
  for (const c of S.saved) if (c.type === '9sig' && !c.hidden) p = ssFiner(p, c.params.per || 'quarterly');
  const floor = spanYears != null && spanYears < 10 ? 'weekly' : 'quarterly';
  return ssFiner(p || livePeriod || floor, floor);
}

// 물가 반영(연 3%) — 첫 라벨 날짜 기준 할인
const SS_INFL = 0.03;
function ssInflFactor(date, baseDate) {
  if (!S.infl || !baseDate || !date) return 1;
  const y = (Date.parse(date) - Date.parse(baseDate)) / SS_YEAR_MS;
  return y > 0 ? 1 / Math.pow(1 + SS_INFL, y) : 1;
}

// 이번 계산 결과 (패널·표·공유 카드·분석 창이 읽음)
const R = {
  ctx: null,          // 공통 조건
  labels: [], datasets: [],
  base: null,         // 기준 9sig 계산(라벨·그냥 보유·현금 복리의 원천)
  metrics: {},        // 선 키 → { cagr, start, end, maxDD, ddPeak, ddTrough }
  yday: {},           // 선 키 → 전일 값
  cfgSim: {},         // 저장 전략 id → 원 계산 결과(표·표시용)
  customLogs: {},     // 사용자 전략 id → 로그
  actual: null,       // 실제 계좌 지표
};

function ssRender() {
  if (!DS.q || !ssReady) return;
  const maxIdx = DS.q.length - 1;
  let e = Number.isFinite(S.e) ? S.e : 0, x = Number.isFinite(S.x) ? S.x : maxIdx;
  if (e < 0) e = 0;
  if (x < 0) x = maxIdx;
  if (e > maxIdx) e = maxIdx;
  if (x > maxIdx) x = maxIdx;
  if (e >= x) { x = Math.min(e + 1, maxIdx); e = Math.min(e, x - 1); if (e < 0) e = 0; }
  S.e = e; S.x = x;
  const qi0 = e > 0 ? e - 1 : e;   // '그 분기 시작에 진입' = 직전 분기 마지막 거래일
  let ed = S.ed, xd = S.xd;
  if (ed && !DS.idx.has(ed)) ed = '';
  if (xd && !DS.idx.has(xd)) xd = '';
  if (ed && xd && ed >= xd) { ed = ''; xd = ''; }
  const anyOv = !!(ed || xd);
  const entryDate = ed || DS.q[qi0][0], exitDate = xd || DS.q[x][0];

  const monthly = ssPosToMonthly(S.mPos), raise = (+S.raise || 0) / 100;
  const rate = ssPosToRate(+ssBaseEff('invested').r) / 100;
  let initial = ssPosToInitial(S.iPos), sched;
  S.txEff = null;
  if (S.tx) { const eff = ssTxEffective(S.tx, entryDate, rate); if (eff) { initial = eff.initial; sched = eff.schedule; S.txEff = eff; } }

  const N = DS.days.length;
  const prevDay = N >= 2 ? DS.days[N - 2].date : null;
  let latest = !!(prevDay && exitDate === DS.days[N - 1].date);
  if (latest && entryDate >= prevDay) latest = false;

  const editCfg = S.editing ? ssFindCfg(S.editing) : null;
  const livePeriod = editCfg && editCfg.type === '9sig' ? editCfg.params.per : 'quarterly';
  const grain = ssDisplayGrain(livePeriod, ssYears(entryDate, exitDate));

  // ── 기준 9sig (기본값 고정 · 분기) — 라벨·그냥 보유·현금 복리가 여기서 나옴
  const p9 = ssDefaults('9sig');
  const mainPeriod = 'quarterly';
  let rows = null;
  if (anyOv) { const q = ssExactRows(mainPeriod, entryDate, exitDate); if (q && q.length >= 2) rows = q; }
  const ovOpt = anyOv ? { ed: entryDate, xd: exitDate } : {};
  const sampleW = grain === 'weekly' && mainPeriod !== 'weekly';
  const base = ssRun9(Object.assign({ initial, monthly, raise, rate: ssRate9(p9), baseRate: rate, qi0, qi1: x, period: mainPeriod, rows, sched, sampleQ: false, sampleW }, ovOpt, ssOpts9(p9)));
  R.base = base;
  const ctx = { initial, monthly, raise, rate, qi0, qi1: x, e, ed: anyOv ? entryDate : '', xd: anyOv ? exitDate : '', anyOv, entryDate, exitDate, sched, grain, latest, prevDay, labels: [], years: 1, contributed: base.contributed };
  R.ctx = ctx;
  ssPeriodUI.update(e, x, ed, xd);
  ssSideUI.update(initial, monthly);

  if (base.log.length < 1) {
    R.labels = []; R.datasets = []; R.metrics = {};
    ssChartUpdate();
    ssAfterRender();
    return;
  }
  const log = base.log, fin = log[log.length - 1];
  const sameGrain = grain === mainPeriod;
  const labels = sameGrain ? log.map((l) => l.date)
    : ssRun9(Object.assign({ initial, monthly, raise, rate: ssRate9(p9), baseRate: rate, qi0, qi1: x, period: grain, rows: null, sched, noBH: true }, ovOpt, ssOpts9(p9))).log.map((l) => l.date);
  const years = log.length > 1 ? (Date.parse(fin.date) - Date.parse(log[0].date)) / SS_YEAR_MS : 1;
  ctx.labels = labels; ctx.years = years; ctx.d0 = log[0].date; ctx.d1 = fin.date;
  const onLabels = (arr, f) => (sameGrain ? arr.map(f) : ssResample((arr || []).map((a) => ({ date: a.date, value: f(a) })), labels));
  // 연평균(돈 가중): 그냥 보유 = ssRun9 의 적립 규칙('r9'), 현금 복리 = 달마다 이자 뒤 더하는 base('r9base') — ssFlows
  const mw = (v, mode) => ssCagrMW(initial, monthly, raise, log[0].date, fin.date, years, v, base.contributed, sched, mode);

  const metrics = {}, yday = {}, datasets = [];
  const defl = S.infl ? ssInflFactor(prevDay, labels[0]) : 1;
  // ── 그냥 보유 (기본 선)
  const bhUl = ssBaseEff('bh').ul, bhKey = SS_COL[bhUl] ? bhUl : 'tqqq';
  const bhPts = base.bh[bhKey] || [];
  const bhD = onLabels(sampleW ? (base.bhS[bhKey] || []) : bhPts, (p) => p.value);
  const bhFinal = bhPts.length ? bhPts[bhPts.length - 1].value : 0;
  const bhDD = bhPts.length && bhPts[0].shares != null ? ssDailyDD(bhPts.map((p) => ({ date: p.date, shares: p.shares, cash: 0 })), bhKey) : ssSeriesDD(bhD, labels);
  metrics.bh = { cagr: mw(bhFinal, 'r9'), start: bhD[0], end: bhD[bhD.length - 1], maxDD: bhDD.pct * 100, ddPeak: bhDD.peakDate, ddTrough: bhDD.troughDate };
  if (latest && bhPts.length && bhPts[bhPts.length - 1].shares > 0) { const y = ssRepriceYesterday({ [bhKey]: bhPts[bhPts.length - 1].shares }, 0); if (y != null) yday.bh = y * defl; }
  datasets.push(ssDs('bh', '그냥 보유 ' + bhKey.toUpperCase(), bhD, ssBaseColor('bh'), { borderWidth: 2, borderDash: [6, 3], hidden: S.hide.bh }));
  // ── 현금 복리 (모든 적립을 이자 붙는 현금으로)
  const invD = onLabels(sampleW ? base.samples : log, (l) => l.base);
  const invDD = ssSeriesDD(invD, labels);
  metrics.invested = { cagr: mw(fin.base, 'r9base'), start: invD[0], end: invD[invD.length - 1], maxDD: invDD.pct * 100, ddPeak: invDD.peakDate, ddTrough: invDD.troughDate };
  datasets.push(ssDs('invested', '현금 복리', invD, ssBaseColor('invested'), { borderWidth: 1.5, borderDash: [3, 3], tension: 0, hidden: S.hide.invested }));

  // ── 저장 전략
  R.cfgSim = {};
  for (const cfg of S.saved) {
    const s = ssCfgSeries(cfg, ctx);
    metrics['cfg:' + cfg.id] = { cagr: s.cagr, start: s.start, end: s.end, maxDD: s.maxDD, ddPeak: s.ddPeak, ddTrough: s.ddTrough, pending: s.pending, error: s.error };
    if (s.yday != null) yday['cfg:' + cfg.id] = s.yday;
    datasets.push(ssDs('cfg:' + cfg.id, cfg.name, s.data, cfg.color, { borderWidth: 2, hidden: !!cfg.hidden, cfgId: cfg.id }));
    if (cfg.type === '9sig' && s.sub && cfg.subShown) {
      for (const def of SS_SUB_DEFS) {
        if (!cfg.subShown[def.key]) continue;
        datasets.push(ssDs('cfg:' + cfg.id + ':' + def.key, cfg.name + ' · ' + ssSubLabel(def.key, cfg.params), ssResample(s.sub[def.key], labels), cfg.color,
          { borderWidth: 1.5, borderDash: def.dash, tension: def.key === 'target' ? 0 : 0.3, hidden: !!cfg.hidden, cfgId: cfg.id, sub: def.key }));
      }
    }
  }
  // ── 실제 계좌 (거래내역에 평가액 열이 있을 때)
  R.actual = null;
  const eff = S.txEff || S.tx;
  if (S.tx && eff && eff.actualPoints && eff.actualPoints.length && S.tx.showActual !== false) {
    const pts = eff.actualPoints, ser = ssResample(pts, labels);
    for (let i = 0; i < labels.length && labels[i] < pts[0].date; i++) ser[i] = null;
    const fv = pts[pts.length - 1].value;
    const flows = [{ date: eff.entryDate || S.tx.entryDate, amount: eff.initial }].concat(eff.schedule.list);
    const dd = ssFlowAdjDD(pts, flows);
    R.actual = { cagr: ssCfgCagr(ctx, fv, 'day', eff.entryDate || ctx.entryDate, String(pts[pts.length - 1].date)), maxDD: dd.pct * 100, ddPeak: dd.peakDate, ddTrough: dd.troughDate, start: pts[0].value, end: fv };
    metrics.actual = R.actual;
    datasets.push(ssDs('actual', '내 계좌', ser, SS_ACTUAL_COLOR, { borderWidth: 2.5 }));
  }

  // 물가 반영: 각 점 × 할인율 (그린 값 기준이라 매번 새로 계산)
  if (S.infl && labels.length) {
    const disc = labels.map((d) => ssInflFactor(d, labels[0]));
    datasets.forEach((ds) => { ds.data = ds.data.map((v, i) => { const k = disc[i]; return typeof v !== 'number' ? v : v * (k > 0 ? k : 1); }); });
  }
  // 차트 최솟값 1 (로그 축에서 0 이 사라지지 않게)
  datasets.forEach((ds) => ds.data.forEach((v, i, arr) => { if (typeof v === 'number' && v < 1) arr[i] = 1; }));

  R.labels = labels; R.datasets = datasets; R.metrics = metrics; R.yday = yday;
  ssChartUpdate();
  ssAfterRender();
}

// 차트 선 하나 (Chart.js 데이터셋) — 공통 모양 + 선마다 다른 것(o)
const SS_DS_LOOK = { borderWidth: 2, tension: 0.3, fill: false, backgroundColor: 'transparent', pointRadius: 0, pointHitRadius: 10 };
function ssDs(key, label, data, color, o) {
  return Object.assign({ _key: key, _color: color, label, data, borderColor: color }, SS_DS_LOOK, o || {});
}
const SS_ACTUAL_COLOR = '#0d9488';
// 9sig 세부 선: [키, 계산 결과의 값 이름, 점선 모양]
const SS_SUB_DEFS = [['holding', 'holdVal', [2, 2]], ['target', 'target', [9, 4]], ['cash', 'cash', [2, 4, 9, 4]]].map(([key, src, dash]) => ({ key, src, dash }));
function ssSubLabel(key, p) {
  const pp = p || {};
  const ul = String(pp.ul || 'tqqq').toUpperCase(), park = String(pp.park || 'cash').toLowerCase();
  if (key === 'holding') return ul + ' 보유';
  if (key === 'target') return ul + ' 목표';
  return park === 'cash' ? '현금' : park.toUpperCase();
}

// 저장 전략의 돈 가중 CAGR — 그 전략의 계산이 실제로 넣은 돈(날짜·금액)과 끝 값이 나온 날로 (분석 표 풍선과 같은 계산)
//  · mode = ssFlows 의 'day'(SMA·사용자 코드·내 계좌) / 'r9'(9sig·그냥 보유) / 'r9base'(현금 복리)
//  · d0 = 시작 금액을 넣은 날: 날마다 걷는 계산은 진입일, 나머지는 계산의 첫 점
//    (주 단위 화면의 첫 눈금은 진입일 전 주말일 수 있어 눈금으로 세면 진입 전 적립이 하나 더 들어갔었음)
//  · d1 = 끝 값이 나온 점의 날짜 (그 계산의 마지막 행)
function ssCfgCagr(ctx, finalV, mode, d0, d1) {
  const L = ctx.labels;
  if (L.length && d0 && d1 && d1 > d0) {
    const yrs = (Date.parse(d1) - Date.parse(d0)) / SS_YEAR_MS;
    return ssCagrMW(ctx.initial, ctx.monthly, ctx.raise, d0, d1, yrs, finalV, ctx.contributed, ctx.sched, mode, true);
  }
  if (L.length) return ssCagrMW(ctx.initial, ctx.monthly, ctx.raise, L[0], L[L.length - 1], ctx.years, finalV, ctx.contributed, ctx.sched, mode, true);
  return ctx.years > 0 && ctx.contributed > 0 && finalV > 0 ? (Math.pow(finalV / ctx.contributed, 1 / ctx.years) - 1) * 100 : 0;
}
// 날짜 d 에 쓰인 값의 점 날짜 (ssResample 과 같은 규칙: d 이하 마지막 점, 없으면 첫 점)
function ssSrcDate(points, d) {
  if (!points || !points.length) return null;
  let j = 0;
  while (j + 1 < points.length && points[j + 1].date <= d) j++;
  return String(points[j].date);
}

// 저장 전략 한 개 → 라벨에 맞춘 선 + 지표 (lite: 끝 금액만 빨리 — 낙폭·보유 선 계산 생략, 과최적화 탐색기 자료 계산용)
function ssCfgSeries(cfg, ctx, lite) {
  if (cfg.type === 'custom') return ssCustomSeries(cfg, ctx);
  const L = ctx.labels, p = cfg.params;
  const ovOpt = ctx.anyOv ? { ed: ctx.entryDate, xd: ctx.exitDate } : {};
  const yFrom = (hold, cash) => {
    if (!ctx.latest || !ctx.prevDay) return null;
    const v = ssRepriceYesterday(hold, cash);
    return v == null ? null : v * (S.infl ? ssInflFactor(ctx.prevDay, L[0]) : 1);
  };
  let points = null, sub = null, ddc = null, ddKey = null, ddMulti = null, yd = null;
  const common = { initial: ctx.initial, monthly: ctx.monthly, raise: ctx.raise, qi0: ctx.qi0, qi1: ctx.qi1, sched: ctx.sched };
  const exactQ = () => { if (!ctx.anyOv) return null; const q = ssExactRows('quarterly', ctx.entryDate, ctx.exitDate); return q && q.length >= 2 ? q : null; };
  if (cfg.type === '9sig') {
    const o9 = ssOpts9(p), per = p.per || 'quarterly';
    let rows = null;
    const rp = +p.rp || 0;
    if (rp > 0) { const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1)); const q = ssShiftRows(per, off, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
    if (!rows && ctx.anyOv) { const q = ssExactRows(per, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
    const sampleQ = ctx.grain === 'quarterly' && per === 'yearly', sampleW = ctx.grain === 'weekly' && per !== 'weekly';
    const r = ssRun9(Object.assign({}, common, { rate: ssRate9(p), period: per, rows, sampleQ, sampleW, noBH: !!lite }, ovOpt, o9));
    const sr = sampleQ || sampleW ? r.samples : r.log;
    points = sr.map((l) => ({ date: l.date, value: l.total }));
    sub = {
      holding: sr.map((l) => ({ date: l.date, value: l.holdVal })),
      target: sr.map((l) => ({ date: l.date, value: l.target })),
      cash: sr.map((l) => ({ date: l.date, value: l.cash })),
    };
    ddc = r.log.map((l) => ({ date: l.date, shares: l.price > 0 ? l.holdVal / l.price : 0, cash: l.cash }));
    ddKey = SS_KEY_OF[o9.ul] || 'tqqq';
    R.cfgSim[cfg.id] = { type: '9sig', log: r.log, bh: r.bh, ddc, ddKey };
    const last = r.log[r.log.length - 1];
    if (last && DS.days.length) {
      const sh = last.price > 0 ? last.holdVal / last.price : 0, pk = (o9.park || 'cash').toLowerCase(), today = DS.days[DS.days.length - 1];
      if (pk === 'cash') yd = yFrom({ [ddKey]: sh }, last.cash);
      else if (today[pk] > 0) { const h = { [ddKey]: sh }; h[pk] = (h[pk] || 0) + last.cash / today[pk]; yd = yFrom(h, 0); }
    }
  } else if (cfg.type === 'sma') {
    const r = ssRunSma(Object.assign({}, common, { rate: ssRate9(p), dd: !lite, sampleW: ctx.grain === 'weekly' }, ovOpt, ssOptsSma(p)));
    points = r.points.map((pt) => ({ date: pt.date, value: pt.value }));
    ddMulti = r.dd || null;
    R.cfgSim[cfg.id] = { type: 'sma', log: r.log, points: r.points, dd: ddMulti };
    const lc = ddMulti && ddMulti.length ? ddMulti[ddMulti.length - 1] : null;
    if (lc) yd = yFrom(lc.h, lc.cash);
  } else if (cfg.type === 'bh') {
    const q = exactQ();
    const r = ssRun9(Object.assign({}, common, { rate: 0, rows: q, sampleW: ctx.grain === 'weekly' }, ovOpt));
    const key = SS_COL[p.ul] ? p.ul : 'tqqq';
    const raw = r.bh[key] || [], samp = r.bhS[key] || [];
    points = (ctx.grain === 'weekly' ? samp : raw).map((pt) => ({ date: pt.date, value: pt.value }));
    ddc = raw.map((pt) => ({ date: pt.date, shares: pt.shares, cash: 0 }));
    ddKey = key;
    R.cfgSim[cfg.id] = { type: 'bh', log: r.log, bh: r.bh, ddc, ddKey };
    const last = raw[raw.length - 1];
    if (last && last.shares > 0) yd = yFrom({ [key]: last.shares }, 0);
  } else if (cfg.type === 'invested') {
    const q = exactQ();
    const r = ssRun9(Object.assign({}, common, { rate: 0, baseRate: ssPosToRate(+p.r || 0) / 100, rows: q, sampleQ: ctx.grain === 'quarterly', sampleW: ctx.grain === 'weekly' }, ovOpt));
    const sr = ctx.grain === 'quarterly' || ctx.grain === 'weekly' ? r.samples : r.log;
    points = sr.map((l) => ({ date: l.date, value: l.base }));
    R.cfgSim[cfg.id] = { type: 'invested', log: r.log };
  }
  const data = ssResample(points, L);
  const finalV = data.length ? data[data.length - 1] : 0, startV = data.length ? data[0] : 0;
  if (lite) return { data, end: finalV, start: startV };
  const dd = ddMulti && ddMulti.length ? ssDailyDDMulti(ddMulti) : ddc && ddc.length ? ssDailyDD(ddc, ddKey) : ssSeriesDD(data, L);
  const mode = cfg.type === 'sma' ? 'day' : cfg.type === 'invested' ? 'r9base' : 'r9', cd0 = mode === 'day' ? ctx.entryDate : points && points.length ? String(points[0].date) : null;
  const cagr = ssCfgCagr(ctx, finalV, mode, cd0, L.length ? ssSrcDate(points, L[L.length - 1]) : null);
  return { data, cagr, maxDD: dd.pct * 100, start: startV, end: finalV, sub, ddPeak: dd.peakDate, ddTrough: dd.troughDate, yday: yd };
}

// 사용자 전략: 격리 실행 결과(캐시)로 선을 만듦 — 없으면 실행을 걸어 두고, 돌아오면 다시 그림
function ssCustomSeries(cfg, ctx) {
  const empty = (err) => ({ data: ctx.labels.map(() => null), cagr: 0, maxDD: 0, start: 0, end: 0, ddPeak: null, ddTrough: null, error: err || null });
  if (!cfg.code || !String(cfg.code).trim()) { R.customLogs[cfg.id] = []; return empty(null); }
  const sig = ssCustomSig(cfg, ctx);
  const c = SB.res[cfg.id];
  if (c && c.sig === sig) {
    R.customLogs[cfg.id] = c.log || [];
    ssScheduleYday(cfg, ctx);
    const out = ssCustomResult(c.log, ctx, c.error);
    const y = SB.yday[cfg.id];
    if (y && !y.error && y.value != null && ctx.latest) out.yday = y.value * (S.infl ? ssInflFactor(ctx.prevDay, ctx.labels[0]) : 1);
    return out;
  }
  ssScheduleRun(cfg.id, cfg.code, cfg.params, sig, ssCustomGlobals(ctx));
  R.customLogs[cfg.id] = (c && c.log) || [];
  const out = ssCustomResult(c ? c.log : [], ctx, null, true);
  out.pending = true;
  return out;
}
function ssScheduleYday(cfg, ctx) {
  if (!ctx.latest || !ctx.prevDay || !cfg.code) return;
  const yctx = Object.assign({}, ctx, { xd: ctx.prevDay, ed: ctx.ed || ctx.entryDate });
  const sig = ssCustomSig(cfg, yctx);
  const c = SB.yday[cfg.id];
  if (c && c.sig === sig) return;
  ssScheduleRun(cfg.id + '::yday', cfg.code, cfg.params, sig, ssCustomGlobals(yctx));
}
function ssCustomResult(log, ctx, error, stale) {
  const L = ctx.labels;
  if (error) return { data: L.map(() => null), cagr: 0, maxDD: 0, start: 0, end: 0, ddPeak: null, ddTrough: null, error };
  const pts = (log || []).filter((r) => r && r.date != null && typeof r.value === 'number' && Number.isFinite(r.value))
    .map((r) => ({ date: String(r.date), value: r.value })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const data = stale ? ssResampleClamped(pts, L) : ssResample(pts, L);
  let fv = 0, sv = 0;
  for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) { fv = data[i]; break; }
  for (let i = 0; i < data.length; i++) if (data[i] != null) { sv = data[i]; break; }
  const ctrl = ssCustomCtrl(log);
  let dd = ctrl ? ssDailyDDMulti(ctrl) : null;
  if (!dd) dd = pts.length ? ssSeriesDD(pts.map((p) => p.value), pts.map((p) => p.date)) : ssSeriesDD(data, L);
  // 끝 값이 나온 점: 값이 있는 마지막 눈금에 쓰인 기록 날짜
  let li = -1;
  for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) { li = i; break; }
  const cagr = ssCfgCagr(ctx, fv, 'day', ctx.entryDate, li >= 0 ? ssSrcDate(pts, L[li]) : null);
  return { data, cagr, maxDD: dd.pct * 100, start: sv, end: fv, ddPeak: dd.peakDate, ddTrough: dd.troughDate };
}

/* ═══ 42-chart.js ═══ */
/* ── [STRATSIM] 42 차트 (Chart.js) ─────────────────────────────────────────
   선 끝 이름표 · 마우스 풍선 카드 · 끌어서 구간 수익률 · 매매 표시(패널 열린 전략) · 범례 칩 */

let ssChart = null;
const SS_Y_TICKS = 8;
// 한국식: 오름 빨강 · 내림 파랑
const SS_UP = '#f04452', SS_DOWN = '#3182f6';
const SS_EVT = {   // 이동평균(SMA) 전략 거래 표시
  ENTER: { color: SS_UP, shape: 'circle', label: '매수' },
  EXIT: { color: SS_DOWN, shape: 'hexagon', label: '매도' },
  'BG-GTFO': { color: '#b06000', shape: 'diamond', label: '버블 → 현금' },
  'BG-CLEAR': { color: '#16a34a', shape: 'square', label: '버블 끝' },
};
const SS_CEVT = {  // 사용자 전략 거래 표시
  buy: { color: SS_UP, shape: 'circle', label: '매수' },
  sell: { color: SS_DOWN, shape: 'hexagon', label: '매도' },
  switch: { color: '#8b5cf6', shape: 'diamond', label: '갈아타기' },
  rebalance: { color: '#b06000', shape: 'square', label: '비중 조정' },
};
// 표시 테두리 = 거래한 종목
const SS_ASSET_STROKE = { tqqq: '#0040ff', qqq: '#ff8c00', spy: '#a020f0', qld: '#00b3e6', sso: '#ff1493', spxl: '#6d4c2f', sqqq: '#000000', cash: '#5a6472' };

// 사용자 전략 기록의 action 글 → 표시 종류 (앞머리로 먼저, 없으면 글 안에 든 낱말로)
const SS_KIND_BY_PREFIX = [
  ['contribution', /^(contrib|deposit|\+|적립|입금|출금)/],
  ['ease', /^(ease|dca|slice|tranche|분할)/],
  ['start', /^(start|init|open|시작)/],
  ['end', /^(end|final|끝|마지막)/],
  ['switch', /^(switch|swap|rotate|갈아)/],
  ['rebalance', /^(rebal|trim|adjust|비중|조정)/],
  ['sell', /^(sell|exit|park|매도)/],
  ['buy', /^(buy|enter|매수)/],
];
const SS_KIND_BY_WORD = ['contribution', 'sell', 'buy'];
function ssCustomKind(action) {
  const a = action == null ? '' : String(action).trim().toLowerCase();
  if (a === '') return 'hold';
  const pre = SS_KIND_BY_PREFIX.find((rule) => rule[1].test(a));
  if (pre) return pre[0];
  return SS_KIND_BY_WORD.find((w) => a.indexOf(w) !== -1) || 'hold';
}
const SS_KIND_LABEL = { buy: '매수', sell: '매도', switch: '갈아타기', rebalance: '비중 조정', ease: '분할 매수', contribution: '적립', start: '시작', end: '끝', hold: '보유' };
function ssCustomLabel(action) {
  const raw = String(action == null ? '' : action).trim();
  if (!raw) return '보유';
  const k = ssCustomKind(raw), st = SS_CEVT[k];
  // 설명이 붙은 긴 글('sell — 200일선 아래')은 그대로(첫 글자만 대문자), 짧은 낱말은 우리말 이름으로
  const wordy = raw.length > (st ? st.label.length + 2 : 6) && /[\s—:\-]/.test(raw.slice(1));
  return wordy ? raw[0].toUpperCase() + raw.slice(1) : (SS_KIND_LABEL[k] || raw);
}
// 직전 기록 대비 수익률(%) — 이번 기록에 들어온 적립금은 빼고
function ssCustomGain(log, i) {
  const before = i > 0 ? log[i - 1] : null, row = log[i];
  if (!before || !row || before.date === row.date) return null;
  const v0 = +before.value, v1 = +row.value;
  if (!(v0 > 0 && Number.isFinite(v1))) return null;
  const added = +row.contributed;
  return (v1 - v0 - (Number.isFinite(added) ? added : 0)) / v0 * 100;
}
function ssCustomEvents(log) {
  const out = [];
  (log || []).forEach((r, i) => { if (!r || r.date == null || !(+r.value > 0)) return; const st = SS_CEVT[ssCustomKind(r.action)]; if (st) out.push({ i, row: r, st }); });
  return out;
}
function ssAssetStroke(held) {
  if (held == null || held === '') return null;
  for (const p of String(held).toLowerCase().split(/[+/,\s]+/)) if (SS_ASSET_STROKE[p]) return SS_ASSET_STROKE[p];
  return null;
}
// 거래 표시가 가리키는 종목: 매수 = 지금 든 것, 매도 = 그 전에 들고 있던 것
function ssMarkerAsset(log, i, isSell) {
  const h = (r) => (r && r.held != null && r.held !== '' ? String(r.held) : null);
  if (!isSell) return h(log[i]);
  const cur = h(log[i]);
  for (let j = i - 1; j >= 0; j--) { const x = h(log[j]); if (x && x !== cur) return x; }
  return cur;
}

// ── 테마 색 (사이트 다크/라이트) ──
function ssTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return { light, text: v('--text', '#e4e4e5'), text2: v('--text2', '#9e9ea4'), text3: v('--text3', '#6d6d76'), grid: light ? 'rgba(0,27,55,0.07)' : 'rgba(255,255,255,0.06)',
    border: light ? 'rgba(0,27,55,0.16)' : 'rgba(255,255,255,0.14)', bg: light ? '#ffffff' : '#17171c', pill: light ? 'rgba(255,255,255,0.94)' : 'rgba(23,23,28,0.94)', accent: '#3182f6' };
}
const SS_MONO = '"DM Mono", ui-monospace, monospace', SS_SANS = '"Noto Sans KR", sans-serif';

// 색에 투명도 입히기 (#rgb · #rrggbb · rgb()/rgba() → rgba(r,g,b,a)) · 그 밖의 색 이름은 그대로
function ssWithAlpha(color, a) {
  if (typeof color !== 'string') return color;
  let rgb = null;
  if (color.charAt(0) === '#') {
    const hex = color.length === 4 ? color.slice(1).replace(/./g, '$&$&') : color.slice(1);
    rgb = [0, 2, 4].map((at) => parseInt(hex.substr(at, 2), 16));
  } else {
    const inner = /rgba?\(([^)]+)\)/.exec(color);
    if (inner) rgb = inner[1].split(',').slice(0, 3).map((x) => x.trim());
  }
  return rgb ? 'rgba(' + rgb.join(',') + ',' + a + ')' : color;
}

// 패널이 열린 선 = 굵게, 나머지 = 반투명
function ssActiveKey() {
  if (S.editing) return 'cfg:' + S.editing;
  if (S.panel) return S.panel;
  return null;
}
function ssApplyEmphasis() {
  const ak = ssActiveKey();
  const smaOpen = !!(S.editing && (ssFindCfg(S.editing) || {}).type === 'sma' && ssPanel.open);
  const customOpen = !!(S.editing && (ssFindCfg(S.editing) || {}).type === 'custom' && ssPanel.open);
  for (const d of R.datasets) {
    if (d._baseW == null) d._baseW = d.borderWidth != null ? d.borderWidth : 1;
    const isA = ak && d._key === ak, dim = ak && !isA;
    d.borderWidth = isA && (smaOpen || customOpen) ? 0 : isA ? d._baseW * 2 : d._baseW;
    d.borderColor = dim ? ssWithAlpha(d._color, 0.5) : d._color;
  }
}

// 라벨 사이 아무 날짜의 x 픽셀 (두 라벨 사이 보간)
function ssXForDate(c, date) {
  const labs = c.data.labels, axis = c.scales.x, end = labs.length - 1;
  let k = 0;   // date 이하 마지막 라벨
  while (k < end && labs[k + 1] <= date) k++;
  if (k >= end) return axis.getPixelForValue(end);
  const ta = Date.parse(labs[k]), tb = Date.parse(labs[k + 1]);
  const part = tb > ta ? Math.min(1, Math.max(0, (Date.parse(date) - ta) / (tb - ta))) : 0;
  const xa = axis.getPixelForValue(k);
  return xa + (axis.getPixelForValue(k + 1) - xa) * part;
}
// 마우스 x 픽셀 → 가장 가까운 라벨 번호 (범위 안으로)
function ssIndexForPixel(c, px) {
  const n = c.data.labels ? c.data.labels.length : 0;
  if (!n) return 0;
  const axis = c.scales.x;
  const at = axis && axis.getValueForPixel ? Math.round(axis.getValueForPixel(px)) : 0;
  return Number.isFinite(at) ? Math.min(n - 1, Math.max(0, at)) : 0;
}
// 거래 표시가 앞서 그린 표시와 겹치면(6px 안) 위·아래로 번갈아 한 칸씩 비켜 놓음 (최대 12칸)
function ssSpreadY(placed, x, baseY, area) {
  const GAP = 6;
  const crowded = (y) => {
    for (let j = placed.length - 1; j >= 0 && !(placed[j].x < x - GAP); j--) if (Math.hypot(placed[j].x - x, y - placed[j].y) < GAP) return true;
    return false;
  };
  if (!crowded(baseY)) return baseY;
  for (let step = 1; step <= 12; step++) {
    for (const dir of [-1, 1]) {
      const y = baseY + dir * step * GAP;
      if (y >= area.top + 5 && y <= area.bottom - 5 && !crowded(y)) return y;
    }
  }
  return baseY;
}
function ssDrawMarker(cx, x, y, st, hovered, stroke) {
  const r = hovered ? 7 : 5;
  cx.beginPath();
  if (st.shape === 'hexagon') {   // 꼭짓점이 위로 오는 육각형
    for (let k = 0; k < 6; k++) { const ang = (k * 60 - 90) * Math.PI / 180; cx[k ? 'lineTo' : 'moveTo'](x + r * Math.cos(ang), y + r * Math.sin(ang)); }
    cx.closePath();
  }
  else if (st.shape === 'diamond') { [[0, -r], [r, 0], [0, r], [-r, 0]].forEach(([dx, dy], k) => cx[k ? 'lineTo' : 'moveTo'](x + dx, y + dy)); cx.closePath(); }
  else if (st.shape === 'square') { const h = r * 0.8; cx.rect(x - h, y - h, 2 * h, 2 * h); }
  else cx.arc(x, y, r, 0, Math.PI * 2);
  cx.fillStyle = st.color;
  cx.lineWidth = hovered ? 3 : 2.5;
  cx.strokeStyle = stroke || (hovered ? '#383874' : 'rgba(255,255,255,0.9)');
  cx.fill(); cx.stroke();
}

// ── 구간 선택 (끌기) ──
const SR = { a: null, b: null, drag: false, raf: null, map: null };
const ssHasRange = () => SR.a != null && SR.b != null && !SR.drag ? true : SR.a != null && SR.b != null;
function ssRangeChange(lo, hi) {
  const out = {};
  if (!ssChart) return out;
  ssChart.data.datasets.forEach((ds) => { if (!ds || ds.hidden) return; const d = ssDayChange(ds.data[hi], ds.data[lo]); if (d) out[ds._key] = d; });
  return out;
}
function ssClearRange() {
  if (SR.a == null && !SR.drag) return;
  SR.a = SR.b = null; SR.drag = false; SR.map = null; S.pin = null;
  ssLegend.render();
  if (ssChart) ssChart.update('none');
  ssSyncHash();
}
function ssPinRange(from, to) {
  if (!ssChart) return false;
  const L = ssChart.data.labels, i1 = L.indexOf(from), i2 = L.indexOf(to);
  if (i1 < 0 || i2 < 0) return false;
  SR.a = i1; SR.b = i2; SR.drag = false;
  SR.map = ssRangeChange(Math.min(i1, i2), Math.max(i1, i2));
  S.pin = [L[Math.min(i1, i2)], L[Math.max(i1, i2)]];
  ssLegend.render(); ssChart.update('none');
  return true;
}
// 구간 숫자: 세 자리 유효숫자 고정 (표처럼 줄이 맞게)
function ssSig(v, n) { if (!v) return 0; const m = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(v)))); return Math.round(v * m) / m; }
function ssSigDigits(v, n) { if (!v) return (0).toFixed(n - 1); const r = ssSig(v, n); return r.toFixed(Math.max(0, n - Math.floor(Math.log10(Math.abs(r))) - 1)); }
function ssRangeMoney(v, n) {
  n = n || 3;
  const sign = v < 0 ? '-' : '', a = ssSig(Math.abs(v), n);
  const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']].find((x) => a >= x[0]);
  return u ? sign + '$' + ssSigDigits(a / u[0], n) + u[1] : sign + '$' + ssSigDigits(a, n);
}
function ssRangeMoneyPair(a, b) { for (let n = 3; n < 6; n++) { const x = ssRangeMoney(a, n), y = ssRangeMoney(b, n); if (x !== y || a === b) return [x, y]; } return [ssRangeMoney(a, 5), ssRangeMoney(b, 5)]; }
function ssRangeDuration(a, b) {
  const f = new Date(a + 'T00:00:00Z'), t = new Date(b + 'T00:00:00Z');
  let y = t.getUTCFullYear() - f.getUTCFullYear(), m = t.getUTCMonth() - f.getUTCMonth();
  if (t.getUTCDate() < f.getUTCDate()) m--;
  if (m < 0) { y--; m += 12; }
  if (y > 0) return m > 0 ? y + '년 ' + m + '개월' : y + '년';
  if (m > 0) return m + '개월';
  const days = Math.round((t - f) / 86400000), w = Math.floor(days / 7);
  return w > 0 ? w + '주' : Math.max(days, 0) + '일';
}

// ── 마우스·탭 상태 ──
const SM = { list: [], hover: null };   // 그린 거래 표시 (적중 상자) · 마우스가 올라간 표시 키
const ssIsTouch = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
let ssTipPinned = false;

// 선 끝 이름표 (오른쪽 여백 = 가장 긴 이름표 폭)
function ssDayDeltaFor(ds, today) {
  if (ds._sub) return null;
  const y = R.yday[ds._key];
  return y != null ? ssDayChange(today, y) : null;
}
const ssDeltaText = (d) => { const s = d.pct >= 0 ? '+' : ''; return '(' + s + d.pct.toFixed(1) + '% · ' + s + ssMoney(d.abs) + ')'; };
// ── 휠 확대·축소 (마우스 · 2026-10-24) — 그림 영역 위에서 휠 = 마우스 자리의 날짜를 고정한 채 기간(가로)만 확대·축소
//    · Shift+휠 또는 가로 휠 = 옆으로 이동 · 더블클릭·[전체 보기] = 처음대로 · 전체 보기에서 더 줄이면 막지 않음(페이지가 스크롤)
//    · 세로축은 보이는 기간의 값에 맞춰 다시(Chart.js 가 x 범위 안 점만 봄 · 보통 눈금은 0 고정을 풂) · 끌어서 구간 고르기는 그대로
//    · 범위는 날짜(라벨)로 기억 → 계산이 다시 돌아도 같은 날짜 범위 · 그 날짜가 없어지면(기간·간격이 바뀜) 전체로
const SZ = { lo: null, hi: null }, SS_ZMIN = 4;   // 가장 좁게: 라벨 4칸
function ssZoomIdx(c) {
  if (!SZ.lo) return null;
  const L = c.data.labels || [], i0 = L.indexOf(SZ.lo), i1 = L.indexOf(SZ.hi);
  if (i0 < 0 || i1 < 0 || i1 - i0 < Math.min(SS_ZMIN, L.length - 1) || (i0 === 0 && i1 === L.length - 1)) { SZ.lo = SZ.hi = null; return null; }
  return [i0, i1];
}
function ssZoomApply(c) {
  const z = ssZoomIdx(c), x = c.options.scales.x, y = c.options.scales.y;
  if (z) { x.min = z[0]; x.max = z[1]; } else { delete x.min; delete x.max; }
  if (!S.log) { y.min = z ? undefined : 0; y.beginAtZero = !z; }
  const b = document.getElementById('ss-zoom');
  if (b) b.hidden = !z;
}
function ssZoomSet(c, i0, i1) {
  const L = c.data.labels, n = L.length;
  if (i0 <= 0 && i1 >= n - 1) SZ.lo = SZ.hi = null; else { SZ.lo = L[Math.max(0, i0)]; SZ.hi = L[Math.min(n - 1, i1)]; }
  ssZoomApply(c); c.update('none');
}
function ssZoomReset() { if (!SZ.lo || !ssChart) return; SZ.lo = SZ.hi = null; ssZoomApply(ssChart); ssChart.update('none'); }
// 선 끝 이름표를 붙일 라벨 번호: 확대했으면 보이는 마지막 날
function ssEndIdx(c) { const z = ssZoomIdx(c); return z ? z[1] : c.data.labels.length - 1; }

const ssEndLabels = {
  id: 'ssEndLabels',
  beforeLayout(c) {
    const last = ssEndIdx(c), atEnd = last === c.data.labels.length - 1;
    if (last < 0) return;
    const cx = c.ctx, compact = window.innerWidth <= 600;
    let maxW = 0;
    c.data.datasets.forEach((ds) => {
      if (ds.hidden) return;
      const v = ds.data[last];
      if (typeof v !== 'number' || !isFinite(v)) return;
      cx.font = (compact ? '600 8px ' : '600 9px ') + SS_SANS;
      maxW = Math.max(maxW, cx.measureText((ds.label || '').toUpperCase()).width);
      if (!compact) {
        cx.font = '500 11px ' + SS_MONO;
        let w = cx.measureText(ssMoney(Math.round(v))).width;
        if (atEnd && R.ctx && R.ctx.latest) { const d = ssDayDeltaFor(ds, v); if (d) { cx.font = '600 9px ' + SS_MONO; w += 5 + cx.measureText(ssDeltaText(d)).width; } }
        maxW = Math.max(maxW, w);
      }
    });
    if (!maxW) return;
    c.options.layout.padding.right = compact ? Math.max(40, Math.min(130, Math.round(maxW) + 12)) : Math.max(100, Math.min(260, Math.round(maxW) + 16));
  },
  afterDraw(c) {
    const area = c.chartArea, cx = c.ctx;
    if (!area) return;
    const infl = document.getElementById('ss-infl');
    if (infl) { const bx = Math.round(area.left + 4), by = Math.round(area.top + 4); if (infl._lx !== bx || infl._ly !== by) { infl.style.left = bx + 'px'; infl.style.top = by + 'px'; infl._lx = bx; infl._ly = by; } }
    const compact = window.innerWidth <= 600, last = ssEndIdx(c), atEnd = last === c.data.labels.length - 1;
    if (last < 0) return;
    const ys = c.scales.y;
    const items = c.data.datasets.map((ds, i) => {
      if (ds.hidden) return null;
      const pt = c.getDatasetMeta(i).data[last];
      if (!pt) return null;
      const v = ds.data[last];
      let y = pt.y;
      if (ys && typeof v === 'number' && isFinite(v) && !(ys.type === 'logarithmic' && v <= 0)) { const py = ys.getPixelForValue(v); if (isFinite(py)) y = py; }
      return { y, oy: y, ds, color: typeof ds.borderColor === 'string' ? ds.borderColor : '#7a7aa6', name: ds.label || '', v };
    }).filter(Boolean);
    // 끝 라벨 쌓기: 위에서부터 gap 간격으로 밀어 내리고 → 아래 끝을 넘친 만큼 거꾸로 올리고 → 그림 영역 안으로
    items.sort((a, b) => a.y - b.y);
    const gap = compact ? 13 : 26, n = items.length;
    for (let k = 1; k < n; k++) items[k].y = Math.max(items[k].y, items[k - 1].y + gap);
    for (let k = n - 1; k >= 0; k--) items[k].y = Math.min(items[k].y, area.bottom - 5 - (n - 1 - k) * gap);
    for (const it of items) it.y = Math.min(area.bottom - 5, Math.max(area.top + 10, it.y));
    cx.save();
    const x = area.right + 8, ak = ssActiveKey();
    for (const it of items) {
      // 라벨 → 선 끝 점까지 점선 이끔선 · 끝 점(패널이 열린 선은 크게)
      const tipR = it.ds._key === ak ? 5 : 3, endX = Math.min(area.right, c.scales.x.getPixelForValue(last));
      cx.setLineDash([2, 2]); cx.lineWidth = 1; cx.strokeStyle = it.color; cx.fillStyle = it.color;
      cx.beginPath(); cx.moveTo(x - 2, it.y); cx.lineTo(endX, it.oy); cx.stroke();
      cx.setLineDash([]);
      cx.beginPath(); cx.arc(endX, it.oy, tipR, 0, 2 * Math.PI); cx.fill();
      if (compact) {
        cx.font = '600 8px ' + SS_SANS; cx.fillStyle = it.color; cx.globalAlpha = 0.9; cx.textBaseline = 'middle';
        cx.fillText(it.name.toUpperCase(), x, it.y); cx.globalAlpha = 1;
        continue;
      }
      cx.font = '600 9px ' + SS_SANS; cx.fillStyle = it.color; cx.globalAlpha = 0.9; cx.textBaseline = 'bottom';
      cx.fillText(it.name.toUpperCase(), x, it.y - 1); cx.globalAlpha = 1;
      cx.font = '500 11px ' + SS_MONO; cx.textBaseline = 'top';
      const vs = ssMoney(Math.round(it.v));
      cx.fillText(vs, x, it.y + 1);
      if (atEnd && R.ctx && R.ctx.latest) {
        const d = ssDayDeltaFor(it.ds, it.v);
        if (d) { const w = cx.measureText(vs).width; cx.font = '600 9px ' + SS_MONO; cx.fillStyle = d.pct >= 0 ? SS_UP : SS_DOWN; cx.fillText(ssDeltaText(d), x + w + 5, it.y + 2); }
      }
    }
    cx.restore();
  },
};

// 패널이 열린 이동평균·사용자 전략: 거래 단위 상세선 + 거래 표시
const ssMarkers = {
  id: 'ssMarkers',
  afterDatasetsDraw(c) {
    SM.list = [];
    if (!ssPanel.open || !S.editing) return;
    const cfg = ssFindCfg(S.editing);
    if (!cfg || (cfg.type !== 'sma' && cfg.type !== 'custom')) return;
    const ti = c.data.datasets.findIndex((d) => d._key === 'cfg:' + cfg.id);
    if (ti < 0 || c.data.datasets[ti].hidden) return;
    const ds = c.data.datasets[ti], labs = c.data.labels, xs = c.scales.x, ys = c.scales.y, area = c.chartArea, cx = c.ctx;
    const sim = R.cfgSim[cfg.id];
    const log = cfg.type === 'sma' ? (sim && sim.log) || [] : R.customLogs[cfg.id] || [];
    if (!log.length || !labs.length) return;
    const valOf = cfg.type === 'sma' ? (ev) => ev.total : (r) => +r.value;
    cx.save();
    cx.beginPath(); cx.rect(area.left - 8, area.top - 8, area.right - area.left + 16, area.bottom - area.top + 16); cx.clip();   // 확대했을 때 그림 영역 밖 상세선·표시는 잘라 냄
    const pts = [];
    for (let i = 0; i < labs.length; i++) if (ds.data[i] != null) pts.push({ x: xs.getPixelForValue(i), v: ds.data[i] });
    for (const ev of log) { const v = valOf(ev); if (v > 0 && ev.date != null) pts.push({ x: ssXForDate(c, ev.date), v: v * ssInflFactor(ev.date, labs[0]) }); }
    pts.sort((a, b) => a.x - b.x);
    if (pts.length > 1) {
      cx.beginPath(); cx.moveTo(pts[0].x, ys.getPixelForValue(pts[0].v));
      for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k].x, ys.getPixelForValue(pts[k].v));
      cx.strokeStyle = ds._color; cx.lineWidth = (ds._baseW || 2) * 2; cx.lineJoin = 'round'; cx.stroke();
    }
    const placed = [];
    let hov = null;
    const evs = cfg.type === 'sma'
      ? log.map((ev, i) => ({ i, row: ev, st: SS_EVT[ev.action] })).filter((e) => e.st && e.row.total > 0)
      : ssCustomEvents(log);
    for (const ev of evs) {
      const px = ssXForDate(c, ev.row.date);
      if (px < area.left - 2 || px > area.right + 2) continue;
      const by = ys.getPixelForValue(valOf(ev.row) * ssInflFactor(ev.row.date, labs[0]));
      if (!(by >= area.top - 2 && by <= area.bottom + 2)) continue;
      const py = ssSpreadY(placed, px, by, area);
      const key = String(ev.i);
      const isSell = cfg.type === 'sma' ? (ev.row.action === 'EXIT' || ev.row.action === 'BG-GTFO') : ssCustomKind(ev.row.action) === 'sell';
      const stroke = ssAssetStroke(ssMarkerAsset(log, ev.i, isSell));
      if (key === SM.hover) hov = { px, py, st: ev.st, stroke }; else ssDrawMarker(cx, px, py, ev.st, false, stroke);
      SM.list.push({ x: px, y: py, key, i: ev.i, row: ev.row, st: ev.st, stroke, kind: cfg.type, cfgId: cfg.id });
      placed.push({ x: px, y: py });
    }
    if (hov) ssDrawMarker(cx, hov.px, hov.py, hov.st, true, hov.stroke);
    cx.restore();
  },
};

// 끌어서 고른 구간: 음영 + 날짜 + 기간 + 선마다 시작·끝 원과 수익률
const ssRangePlugin = {
  id: 'ssRange',
  afterDraw(c) {
    if (SR.a == null || SR.b == null) return;
    const area = c.chartArea;
    if (!area) return;
    const T = ssTheme(), xs = c.scales.x, lo = Math.min(SR.a, SR.b), hi = Math.max(SR.a, SR.b);
    const x1 = xs.getPixelForValue(lo), x2 = xs.getPixelForValue(hi), cx = c.ctx;
    cx.save();
    cx.beginPath(); cx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top); cx.clip();   // 확대해 구간 일부가 밖이면 음영은 안쪽만
    cx.fillStyle = 'rgba(49,130,246,0.12)';
    cx.fillRect(Math.min(x1, x2), area.top, Math.abs(x2 - x1) || 1, area.bottom - area.top);
    cx.strokeStyle = 'rgba(49,130,246,0.55)'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(x1, area.top); cx.lineTo(x1, area.bottom); cx.moveTo(x2, area.top); cx.lineTo(x2, area.bottom); cx.stroke();
    const pill = (txt, cxp, cyp, font, w, h, border, color) => {
      cx.fillStyle = T.pill; cx.strokeStyle = border; cx.lineWidth = 1;
      cx.beginPath(); if (cx.roundRect) cx.roundRect(cxp - w / 2, cyp - h / 2, w, h, 6); else cx.rect(cxp - w / 2, cyp - h / 2, w, h); cx.fill(); cx.stroke();
      cx.fillStyle = color; cx.font = font; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(txt, cxp, cyp + 1);
    };
    cx.font = '600 9px ' + SS_MONO;
    const H = 15, Y = area.top + 8, PX = 5, GAP = 4;
    const sl = ssDate(c.data.labels[lo]), el = ssDate(c.data.labels[hi]);
    const sw = cx.measureText(sl).width + PX * 2, ew = cx.measureText(el).width + PX * 2;
    let sx = x1, ex = x2;
    if (x1 + sw / 2 + GAP > x2 - ew / 2) { const mid = (x1 + x2) / 2; sx = mid - GAP / 2 - sw / 2; ex = mid + GAP / 2 + ew / 2; }
    pill(sl, sx, Y, '600 9px ' + SS_MONO, sw, H, 'rgba(49,130,246,0.6)', T.accent);
    pill(el, ex, Y, '600 9px ' + SS_MONO, ew, H, 'rgba(49,130,246,0.6)', T.accent);
    const dur = ssRangeDuration(c.data.labels[lo], c.data.labels[hi]);
    cx.font = '600 9px ' + SS_SANS;
    pill(dur, (x1 + x2) / 2, Y + H + 8, '600 9px ' + SS_SANS, cx.measureText(dur).width + PX * 2, H, 'rgba(49,130,246,0.6)', T.accent);
    cx.restore();
    const map = SR.map, ys = c.scales.y;
    if (!map || !ys) return;
    cx.save();
    cx.beginPath(); cx.rect(area.left - 4, area.top - 4, area.right - area.left + 8, area.bottom - area.top + 8); cx.clip();
    const mx = (x1 + x2) / 2, items = [];
    const PF = '700 10px ' + SS_MONO, RF = '600 8px ' + SS_MONO;
    for (const ds of c.data.datasets) {
      const d = map[ds._key];
      if (!d || ds.hidden) continue;
      const v1 = ds.data[lo], v2 = ds.data[hi];
      if (typeof v1 !== 'number' || !isFinite(v1) || typeof v2 !== 'number' || !isFinite(v2)) continue;
      const p1 = ys.getPixelForValue(v1), p2 = ys.getPixelForValue(v2);
      if (!isFinite(p1) || !isFinite(p2)) continue;
      const col = typeof ds.borderColor === 'string' ? ds.borderColor : '#7a7aa6';
      cx.strokeStyle = col; cx.lineWidth = 1.5; cx.setLineDash([4, 3]);
      cx.beginPath(); cx.moveTo(x1, p1); cx.lineTo(x2, p2); cx.stroke(); cx.setLineDash([]);
      for (const [px, py] of [[x1, p1], [x2, p2]]) { cx.beginPath(); cx.arc(px, py, 4, 0, Math.PI * 2); cx.fillStyle = col; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = T.bg; cx.stroke(); }
      const sg = d.pct >= 0 ? '+' : '-';
      const pt = sg + ssSigDigits(Math.abs(d.pct), 3) + '%';
      const [fa, fb] = ssRangeMoneyPair(v1, v2);
      const rt = ' (' + fa + ' → ' + fb + ', ' + sg + ssRangeMoney(Math.abs(d.abs)) + ')';
      cx.font = PF; const pw = cx.measureText(pt).width;
      cx.font = RF; const rw = cx.measureText(rt).width;
      items.push({ my: (p1 + p2) / 2, pt, pw, rt, rw, col, pos: d.pct >= 0 });
    }
    const LH = 14, LG = LH + 2;
    items.sort((a, b) => a.my - b.my);
    for (let k = 1; k < items.length; k++) if (items[k].my - items[k - 1].my < LG) items[k].my = items[k - 1].my + LG;
    for (let k = items.length - 1; k >= 0; k--) { const m = area.bottom - 5 - (items.length - 1 - k) * LG; if (items[k].my > m) items[k].my = m; }
    const pcw = Math.max(0, ...items.map((i) => i.pw)), rcw = Math.max(0, ...items.map((i) => i.rw)), tw = pcw + rcw;
    for (const it of items) {
      cx.fillStyle = T.pill; cx.strokeStyle = it.col; cx.lineWidth = 1;
      cx.beginPath(); if (cx.roundRect) cx.roundRect(mx - tw / 2 - 4, it.my - LH / 2, tw + 8, LH, 6); else cx.rect(mx - tw / 2 - 4, it.my - LH / 2, tw + 8, LH); cx.fill(); cx.stroke();
      cx.fillStyle = it.pos ? SS_UP : SS_DOWN; cx.textBaseline = 'middle';
      cx.textAlign = 'right'; cx.font = PF; cx.fillText(it.pt, mx - tw / 2 + pcw, it.my + 1);
      cx.textAlign = 'left'; cx.font = RF; cx.fillText(it.rt, mx - tw / 2 + pcw, it.my + 1);
    }
    cx.restore();
  },
};

// 마우스 풍선: 보이는 선마다 카드(값 큰 순 · 막대 = 값/최대) + 점까지 이끔선 + 아래 날짜 칩
function ssExternalTip(context) {
  const c = context.chart, tip = context.tooltip, el = document.getElementById('ss-tip');
  if (!el) return;
  if (SM.hover !== null) { el.style.display = 'none'; return; }
  if (SR.drag || (SR.a != null && SR.b != null)) { el.style.display = 'none'; return; }
  if (tip.opacity === 0) { if (ssIsTouch() && ssTipPinned) return; el.style.display = 'none'; return; }
  if (ssIsTouch()) ssTipPinned = true;
  const idx = tip.dataPoints && tip.dataPoints[0] ? tip.dataPoints[0].dataIndex : null;
  if (idx == null) return;
  const date = c.data.labels[idx];
  const items = [];   // 보이는 선만, 값 큰 순
  c.data.datasets.forEach((d, i) => {
    const v = d.data ? d.data[idx] : null;
    if (d.hidden || v == null || Number.isNaN(v)) return;
    items.push({ i, n: d.label, v, col: typeof d.borderColor === 'string' ? d._color || d.borderColor : '#7a7aa6', dash: d.borderDash || null });
  });
  items.sort((a, b) => b.v - a.v);
  const maxV = Math.max(0, ...items.map((it) => it.v));
  const host = el.parentElement, hr = host.getBoundingClientRect(), cr = c.canvas.getBoundingClientRect();
  const tx = (x) => x + cr.left - hr.left, ty = (y) => y + cr.top - hr.top;
  const hx = tx(tip.caretX), aTop = ty(c.chartArea.top), aBot = ty(c.chartArea.bottom);
  const cards = items.map((it) => {
    const pct = maxV > 0 ? Math.max(0, it.v / maxV * 100) : 0;
    const sample = '<svg width="20" height="4" style="flex-shrink:0;overflow:visible"><line x1="0" y1="2" x2="20" y2="2" stroke="' + it.col + '" stroke-width="2" stroke-linecap="round"' + (it.dash ? ' stroke-dasharray="' + it.dash.join(',') + '"' : '') + '/></svg>';
    const py = ty(c.getDatasetMeta(it.i).data[idx].y);
    return { html: '<div class="ss-ttc"><div class="ss-ttf" style="width:' + pct + '%;background:' + ssWithAlpha(it.col, 0.2) + '"></div><div class="ss-ttr"><div class="ss-ttl">' + sample + '<span class="ss-ttn" title="' + ssEsc(it.n) + '">' + ssEsc(it.n) + '</span></div><span class="ss-ttv">' + ssMoney(Math.round(it.v)) + '</span></div></div>', py, col: it.col };
  });
  const dl = c._grain === 'quarterly' ? ssQLabel(date) : ssDate(date);
  el.innerHTML = '<svg class="ss-ttlead" width="' + hr.width + '" height="' + hr.height + '"></svg><div class="ss-ttdate">' + dl + '<button class="ss-ttx" type="button" aria-label="닫기" data-tt-close>&times;</button></div>' + cards.map((x) => x.html).join('');
  el.style.display = 'block';
  const ce = Array.from(el.querySelectorAll('.ss-ttc'));
  const nat = Math.ceil(Math.max(0, ...ce.map((x) => x.getBoundingClientRect().width)));
  const cw = Math.min(320, nat);
  ce.forEach((x) => { x.style.width = cw + 'px'; });
  const ch = ce[0] ? ce[0].offsetHeight : 0;
  let left = hx + 16;
  if (left + cw > hr.width - 8) left = hx - 16 - cw;
  if (left < 8) left = 8;
  // 카드 쌓기: 점 높이 순으로 겹치지 않게 내려 놓고 → 아래 끝에서 거꾸로 올리고 → 위로 넘치면 전체를 내림
  const step = ch + 4;
  const order = cards.map((x, k) => ({ k, top: x.py - ch / 2 })).sort((a, b) => a.top - b.top);
  for (let j = 1; j < order.length; j++) order[j].top = Math.max(order[j].top, order[j - 1].top + step);
  let floor = aBot - ch;
  for (let j = order.length - 1; j >= 0; j--) { order[j].top = Math.min(order[j].top, floor); floor = order[j].top - step; }
  const over = order.length ? aTop - order[0].top : 0;
  if (over > 0) order.forEach((o) => { o.top += over; });
  const lead = el.querySelector('.ss-ttlead'), ax = left > hx ? left : left + cw;
  order.forEach(({ k, top }) => {
    ce[k].style.left = left + 'px'; ce[k].style.top = top + 'px';
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', hx); ln.setAttribute('y1', cards[k].py); ln.setAttribute('x2', ax); ln.setAttribute('y2', top + ch / 2); ln.setAttribute('stroke', cards[k].col);
    lead.appendChild(ln);
  });
  const chip = el.querySelector('.ss-ttdate'), w = chip.offsetWidth;
  chip.style.left = Math.max(8, Math.min(hr.width - w - 8, hx - w / 2)) + 'px';
  chip.style.top = (aBot + 4) + 'px';
}

// 거래 표시 풍선
function ssMarkerShape(shape, color, stroke) {
  const inner = { hexagon: '<polygon points="7,1 12.2,4 12.2,10 7,13 1.8,10 1.8,4"/>', diamond: '<polygon points="7,1 13,7 7,13 1,7"/>', square: '<rect x="2" y="2" width="10" height="10" rx="1.5"/>' }[shape] || '<circle cx="7" cy="7" r="5.5"/>';
  return '<svg viewBox="0 0 14 14" width="15" height="15" style="fill:' + color + ';stroke:' + (stroke || 'rgba(56,56,116,0.35)') + ';stroke-width:' + (stroke ? 1.6 : 1) + '">' + inner + '</svg>';
}
const SS_ICON = {
  trendUp: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  deposit: '<path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="21" x2="20" y2="21"/>',
  tag: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
};
const ssIco = (p, cls) => '<svg class="' + (cls || 'ss-mi') + '" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
function ssGainPill(g) { return g == null ? '' : '<span class="ss-mgain ' + (g >= 0 ? 'up' : 'dn') + '">' + (g >= 0 ? '▲ ' : '▼ ') + Math.abs(g).toFixed(1) + '%</span>'; }
function ssMarkerTipHtml(m) {
  const L = R.labels, f = ssInflFactor(m.row.date, L[0]);
  const row = (ico, k, v, strong) => '<div class="ss-mrow' + (strong ? ' strong' : '') + '"><span class="ss-mk">' + ssIco(ico) + k + '</span><b>' + v + '</b></div>';
  if (m.kind === 'sma') {
    const sim = R.cfgSim[m.cfgId], log = (sim && sim.log) || [], cfg = ssFindCfg(m.cfgId);
    const info = ssSmaRowInfo(log, m.i, String((cfg && cfg.params.ul) || 'tqqq').toUpperCase());
    const ev = m.row, held = String(ev.held || ev.state || '').toUpperCase();
    const total = Math.round((ev.total || 0) * f), inv = Math.round((ev.invested || 0) * f), pr = total - inv;
    return '<div class="ss-mhead"><span>' + ssMarkerShape(m.st.shape, m.st.color, m.stroke) + '</span><div class="ss-mht"><div class="ss-mtitle" style="color:' + m.st.color + '">' + ssEsc(info.label) + '</div><div class="ss-msub">#' + m.i + ' · ' + ssDate(ev.date) + '</div></div>' + ssGainPill(info.gain) + '</div>'
      + '<div class="ss-mrows">' + row(SS_ICON.box, '보유', ssEsc(held)) + row(SS_ICON.dollar, '평가액', ssMoney(total), true) + row(SS_ICON.deposit, '넣은 돈', ssMoney(inv))
      + row(pr >= 0 ? SS_ICON.trendUp : SS_ICON.trendDown, '수익', '<span class="' + (pr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pr >= 0 ? '+' : '−') + ssMoney(Math.abs(pr)) + '</span>') + '</div>';
  }
  const r = m.row, log = R.customLogs[m.cfgId] || [], g = ssCustomGain(log, m.i), num = (v) => (Number.isFinite(+v) ? +v : null);
  const total = num(r.value) != null ? Math.round(num(r.value) * f) : null, inv = num(r.invested) != null ? Math.round(num(r.invested) * f) : null;
  const cash = num(r.cash) != null ? Math.round(num(r.cash) * f) : null, price = num(r.price);
  const rows = [];
  if (r.held != null && r.held !== '') rows.push(row(SS_ICON.box, '보유', ssEsc(String(r.held).toUpperCase())));
  if (price != null && price > 0) rows.push(row(SS_ICON.tag, '가격', ssLogPrice(price)));
  if (total != null) rows.push(row(SS_ICON.dollar, '평가액', ssMoney(total), true));
  if (cash != null && cash > 0) rows.push(row(SS_ICON.dollar, '현금', ssMoney(cash)));
  if (inv != null) {
    rows.push(row(SS_ICON.deposit, '넣은 돈', ssMoney(inv)));
    if (total != null) { const pr = total - inv; rows.push(row(pr >= 0 ? SS_ICON.trendUp : SS_ICON.trendDown, '수익', '<span class="' + (pr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pr >= 0 ? '+' : '−') + ssMoney(Math.abs(pr)) + '</span>')); }
  }
  const note = r.note != null && r.note !== '' ? '<div class="ss-mnote">' + ssEsc(String(r.note)) + '</div>' : '';
  return '<div class="ss-mhead"><span>' + ssMarkerShape(m.st.shape, m.st.color, m.stroke) + '</span><div class="ss-mht"><div class="ss-mtitle" style="color:' + m.st.color + '">' + ssEsc(ssCustomLabel(r.action)) + '</div><div class="ss-msub">#' + m.i + ' · ' + ssDate(r.date) + '</div></div>' + ssGainPill(g) + '</div><div class="ss-mrows">' + rows.join('') + '</div>' + note;
}
function ssShowMarkerTip(m) {
  const tt = document.getElementById('ss-mtip');
  if (!tt || !ssChart) return;
  const lt = document.getElementById('ss-tip');
  if (lt) lt.style.display = 'none';
  const r = ssChart.canvas.getBoundingClientRect();
  tt.innerHTML = ssMarkerTipHtml(m);
  tt.style.display = 'block';
  const w = tt.offsetWidth || 180, h = tt.offsetHeight || 80;
  let left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + m.x - w / 2));
  let top = r.top + m.y - h - 12;
  if (top < 8) top = r.top + m.y + 14;
  tt.style.left = left + 'px'; tt.style.top = top + 'px';
}
function ssHideMarkerTip() { const tt = document.getElementById('ss-mtip'); if (tt) tt.style.display = 'none'; }
function ssSetMarkerHover(key) {
  if (SM.hover === key) return;
  SM.hover = key;
  if (ssChart) ssChart.draw();
  if (key == null) { ssHideMarkerTip(); return; }
  const m = SM.list.find((x) => x.key === key);
  if (m) ssShowMarkerTip(m); else ssHideMarkerTip();
}

// ── 차트 만들기 / 고치기 ──
function ssChartUpdate() {
  const canvas = document.getElementById('ss-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const T = ssTheme();
  ssApplyEmphasis();
  if (!ssChart) {
    ssChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      plugins: [ssEndLabels, ssMarkers, ssRangePlugin],
      data: { labels: R.labels, datasets: R.datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: window.innerWidth <= 600 ? 50 : 140, left: 26, bottom: 12 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external: ssExternalTip } },
        scales: {
          x: { ticks: { font: { size: 10, family: SS_MONO }, maxTicksLimit: window.innerWidth <= 600 ? 6 : 10, maxRotation: 0, callback: function (v) { const d = this.getLabelForValue(v); return d ? d.slice(0, 7) : ''; } } },
          y: { ticks: { font: { family: SS_MONO, size: 10 }, maxTicksLimit: SS_Y_TICKS, callback: (v) => ssMoneyAxis(v) },
            afterBuildTicks: (scale) => {
              if (!S.log) return;
              scale.ticks = scale.ticks.filter((t) => { const v = t.value; if (v <= 0) return false; const m = v / Math.pow(10, Math.floor(Math.log10(v))); return Math.abs(m - 1) < 0.05 || Math.abs(m - 2) < 0.05 || Math.abs(m - 5) < 0.05; });
              if (scale.ticks.length > SS_Y_TICKS) { const src = scale.ticks, out = []; for (let k = 0; k < SS_Y_TICKS; k++) out.push(src[Math.round(k * (src.length - 1) / (SS_Y_TICKS - 1))]); scale.ticks = out.filter((t, k, a) => a.indexOf(t) === k); }
            } },
        },
      },
    });
    ssWireChart();
    const ld = document.getElementById('ss-loading');
    if (ld) ld.hidden = true;
  }
  const ch = ssChart;
  ch._grain = R.ctx ? R.ctx.grain : 'quarterly';
  ch.data.labels = R.labels;
  ch.data.datasets = R.datasets;
  for (const ax of ['x', 'y']) {
    const o = ch.options.scales[ax];
    o.ticks.color = T.text3;
    o.grid = { color: T.grid };
    o.border = { color: T.border };
  }
  ch.options.scales.y.type = S.log ? 'logarithmic' : 'linear';
  ch.options.scales.y.beginAtZero = !S.log;
  ch.options.scales.y.min = S.log ? undefined : 0;
  ssZoomApply(ch);   // 확대해 둔 날짜 범위 유지(없어진 날짜면 전체로)
  ch.update('none');
  if (SR.a != null && SR.b != null) {   // 라벨이 바뀌면 고정 구간을 날짜로 다시 찾음
    if (S.pin) { const L = ch.data.labels, i1 = L.indexOf(S.pin[0]), i2 = L.indexOf(S.pin[1]); if (i1 >= 0 && i2 >= 0) { SR.a = i1; SR.b = i2; SR.map = ssRangeChange(Math.min(i1, i2), Math.max(i1, i2)); } else { SR.a = SR.b = null; SR.map = null; S.pin = null; } }
    else if (!SR.drag) { SR.a = SR.b = null; SR.map = null; }
    ch.update('none');
  }
}

function ssWireChart() {
  const ch = ssChart, cv = ch.canvas;
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let hit = null, best = 11;
    for (const m of SM.list) { const d = Math.hypot(mx - m.x, my - m.y); if (d < best) { best = d; hit = m; } }
    const k = hit ? hit.key : null;
    if (k !== SM.hover) { SM.hover = k; ch.draw(); }
    if (hit) ssShowMarkerTip(hit); else ssHideMarkerTip();
  });
  cv.addEventListener('mouseleave', () => { ssHideMarkerTip(); if (SM.hover !== null) { SM.hover = null; ch.draw(); } });
  // 휠 확대·축소 · Shift/가로 휠 이동 (위 SZ 설명)
  cv.addEventListener('wheel', (e) => {
    const a = ch.chartArea, L = ch.data.labels || [], n = L.length;
    if (!a || n < SS_ZMIN + 2) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (mx < a.left || mx > a.right || my < a.top || my > a.bottom) return;   // 그림 영역 밖(눈금·이름표) = 평소처럼 페이지 스크롤
    const z = ssZoomIdx(ch), i0 = z ? z[0] : 0, i1 = z ? z[1] : n - 1, span = i1 - i0;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (pan) {
      if (!z) return;
      e.preventDefault();
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      if (!d) return;
      let step = Math.round(span * Math.max(-0.5, Math.min(0.5, d / 1000)));
      if (!step) step = Math.sign(d);
      let s0 = i0 + step, s1 = i1 + step;
      if (s0 < 0) { s1 -= s0; s0 = 0; }
      if (s1 > n - 1) { s0 -= s1 - (n - 1); s1 = n - 1; }
      if (s0 !== i0) ssZoomSet(ch, s0, s1);
      return;
    }
    const dy = e.deltaY * unit;
    if (!dy || (!z && dy > 0)) return;                    // 전체 보기에서 더 줄이기 = 막지 않음(페이지 스크롤)
    e.preventDefault();
    let ns = Math.round(span * Math.pow(2, Math.max(-1, Math.min(1, dy / 400))));   // 휠 한 칸(100) ≈ 16% · 트랙패드는 조금씩
    if (ns === span) ns = span + Math.sign(dy);
    ns = Math.max(Math.min(SS_ZMIN, n - 1), Math.min(n - 1, ns));
    const at = Math.min(i1, Math.max(i0, ch.scales.x.getValueForPixel(mx))), ratio = span ? (at - i0) / span : 0.5;
    let s0 = Math.round(at - ratio * ns), s1 = s0 + ns;
    if (s0 < 0) { s1 -= s0; s0 = 0; }
    if (s1 > n - 1) { s0 -= s1 - (n - 1); s1 = n - 1; }
    s0 = Math.max(0, s0);
    if (s0 !== i0 || s1 !== i1) ssZoomSet(ch, s0, s1);
  }, { passive: false });
  cv.addEventListener('dblclick', () => ssZoomReset());
  const zb = document.getElementById('ss-zoom');
  if (zb) zb.addEventListener('click', () => ssZoomReset());
  // 끌어서 구간 고르기 (마우스) — 놓으면 사라짐, Shift 를 누른 채 놓으면 고정
  cv.addEventListener('mousedown', (e) => {
    if (ssIsTouch() || !ch.chartArea) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, a = ch.chartArea;
    if (mx < a.left || mx > a.right || my < a.top || my > a.bottom) return;
    SR.drag = true; S.pin = null;
    SR.a = SR.b = ssIndexForPixel(ch, mx);
  });
  const live = () => {
    if (SR.raf) return;
    SR.raf = requestAnimationFrame(() => {
      SR.raf = null;
      if (SR.a == null || SR.b == null) return;
      SR.map = ssRangeChange(Math.min(SR.a, SR.b), Math.max(SR.a, SR.b));
      ssLegend.render(); ch.update('none');
    });
  };
  document.addEventListener('mousemove', (e) => {
    if (!SR.drag || !ch.chartArea) return;
    const r = cv.getBoundingClientRect(), a = ch.chartArea;
    SR.b = ssIndexForPixel(ch, Math.max(a.left, Math.min(a.right, e.clientX - r.left)));
    live();
  });
  document.addEventListener('mouseup', (e) => {
    if (!SR.drag) return;
    SR.drag = false;
    if (SR.a === SR.b) { ssClearRange(); return; }
    if (e.shiftKey) {
      const lo = Math.min(SR.a, SR.b), hi = Math.max(SR.a, SR.b);
      SR.map = ssRangeChange(lo, hi);
      S.pin = [ch.data.labels[lo], ch.data.labels[hi]];
      ssLegend.render(); ch.update('none'); ssSyncHash();
      return;
    }
    ssClearRange();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (SR.a != null || SR.drag)) ssClearRange(); });
  document.addEventListener('click', (e) => {
    if (SR.a == null || SR.drag) return;
    if (e.target.closest && (e.target.closest('#ss-chart') || e.target.closest('[data-ss-share]') || e.target.closest('.dsh-fab, .dsh-pop'))) return;
    ssClearRange();
  });
  // 풍선 닫기 (터치 기기는 고정 · × 또는 바깥 탭)
  const tt = document.getElementById('ss-tip');
  if (tt) tt.addEventListener('click', (e) => { if (e.target.closest('[data-tt-close]')) { ssTipPinned = false; tt.style.display = 'none'; } });
  document.addEventListener('click', (e) => {
    if (!ssIsTouch() || !ssTipPinned) return;
    if (e.target.closest('#ss-tip') || e.target.closest('#ss-chart')) return;
    ssTipPinned = false; if (tt) tt.style.display = 'none';
  });
  // 테마가 바뀌면 축 색을 다시
  new MutationObserver(() => { if (ssChart) ssChartUpdate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ── 범례 칩 (그냥 보유 · 현금 복리) ──
const ssLegend = {
  chip(key, name, color, hidden, m, more) {
    const rng = SR.map && SR.map[key];
    const pv = rng ? rng.pct : m && m.cagr;
    let mt = '';
    if (pv !== undefined && pv != null && Number.isFinite(pv)) {
      const dd = m && Number.isFinite(m.maxDD) ? '<div class="ss-lmr"><span class="ss-lml">낙폭</span><span class="ss-lmv ss-dn">' + ssDD(m.maxDD) + '</span>' + (ssDDRange(m.ddPeak, m.ddTrough) ? '<span class="ss-lmrange">' + ssDDRange(m.ddPeak, m.ddTrough) + '</span>' : '') + '</div>' : '';
      mt = '<div class="ss-lm"><div class="ss-lmr"><span class="ss-lml">' + (rng ? '구간' : '연평균') + '</span><span class="ss-lmv ' + (pv >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pv >= 0 ? '+' : '') + pv.toFixed(1) + '%</span></div>' + dd + '</div>';
    }
    return '<div class="ss-chip' + (hidden ? ' off' : '') + '" data-lg="' + key + '" role="button" tabindex="0" title="눌러서 보이기/숨기기">'
      + ssEye(!hidden) + '<span class="ss-cdot" style="background:' + color + '"></span><span class="ss-cname">' + ssEsc(name) + '</span>' + mt
      + (more ? '<button type="button" class="ss-cmore" data-lg-more="' + key + '" aria-label="자세히 · 설정" title="자세히 · 설정"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="17 9 14 12 17 15"/></svg></button>' : '') + '</div>';
  },
  render() {
    const host = document.getElementById('ss-legend');
    if (!host) return;
    const M = R.metrics || {};
    const bhName = '그냥 보유 ' + String(ssBaseEff('bh').ul).toUpperCase();
    host.innerHTML = this.chip('bh', bhName, ssBaseColor('bh'), S.hide.bh, M.bh, true) + this.chip('invested', '현금 복리', ssBaseColor('invested'), S.hide.invested, M.invested, true);
  },
};
function ssEye(open) {
  return '<svg class="ss-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + (open
    ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>') + '</svg>';
}
// 가격·주수 서식 (표)
function ssLogPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '–';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toPrecision(2);
}
function ssLogShares(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/* ═══ 43-panel.js ═══ */
/* ── [STRATSIM] 43 전략 패널 (왼쪽에서 열리는 설정·기록 창) ─────────────────────
   기본 선(그냥 보유·현금 복리)과 저장 전략(9sig·SMA·그냥 보유·현금 복리·사용자 전략)의 설정 문장 · 선 색 ·
   통계 4칸 · 거래 기록 표(CSV) · 9sig 설명 · SMA 신호 지표와 '지금 판단' · 사용자 전략 신호 차트 */

const ssPanel = { open: false, drag: false, hideC: false, hideE: false, cHideC: false, cHideE: false };
const SS_EXPLORER = { '9sig': '9sig-overfit/', sma: 'sma-overfit/' };

const ssTipI = (t, wide) => (t ? ' <span class="ss-i" tabindex="0" data-tip="' + ssEsc(t) + '"' + (wide ? ' data-tip-wide' : '') + '>ⓘ</span>' : '');

// 지금 패널이 다루는 대상: { type, owner('base'|cfg id), cfg, params }
function ssPanelTarget() {
  if (S.editing) { const c = ssFindCfg(S.editing); if (c) return { type: c.type, owner: c.id, cfg: c, params: c.params }; }
  if (S.panel) return { type: S.panel, owner: 'base', cfg: null, params: S.base[S.panel] };
  return null;
}
function ssParamsOf(type, owner) { if (owner === 'base') return S.base[type]; const c = ssFindCfg(owner); return c ? c.params : null; }
function ssSetParam(type, owner, k, v) {
  const p = ssParamsOf(type, owner);
  if (!p) return;
  p[k] = typeof v === 'boolean' ? v : String(v);
  if (owner !== 'base') ssPersistSaved();
  ssChanged();
}

// ── 열기·닫기 ──
function ssOpenBasePanel(type, keep) {
  S.editing = null; S.pendingName = null;
  if (!keep) S.base[type] = ssDefaults(type);   // 열 때는 늘 기본값 사본에서 시작 (공유 링크로 열린 창은 링크 값 그대로)
  S.hide[type] = false;                      // 숨겨 둔 선이면 다시 보이게
  S.panel = type;
  ssShowPanel();
  ssPanelTitle(type === 'bh' ? '그냥 보유 ' + S.base.bh.ul.toUpperCase() : '현금 복리');
  ssChanged();
}
function ssOpenCfgPanel(id) {
  const c = ssFindCfg(id);
  if (!c) return;
  S.pendingName = null; S.panel = null; S.editing = id;
  ssShowPanel();
  ssPanelTitle(c.name);
  ssChanged();
}
function ssShowPanel() {
  const p = document.getElementById('ss-panel');
  if (!p) return;
  ssPanel.open = true;
  p.classList.add('open');
  p.setAttribute('aria-hidden', 'false');
}
function ssClosePanel() {
  const p = document.getElementById('ss-panel');
  if (S.panel) S.base[S.panel] = ssDefaults(S.panel);   // 기본 선은 닫으면 기본값으로
  S.editing = null; S.panel = null; S.pendingName = null;
  ssPanel.open = false;
  ssClosePd(); ssCloseColor(true); ssCloseCp();
  if (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
  SM.hover = null; ssHideMarkerTip();
  ssChanged();
}
// 기본 패널에서 바꾼 것이 있으면 닫기 전에 물어봄 (저장 전략은 바로바로 저장되므로 묻지 않음)
function ssAttemptClose() {
  if (S.panel && !ssParamsEqual(S.panel, S.base[S.panel], ssDefaults(S.panel))) {
    const type = S.panel;
    ssDialog('바꾼 설정을 저장할까요?', '<b>' + ssEsc(SS_TYPE_NAMES[type]) + '</b> 설정을 바꿨습니다. 기본 선은 바꾼 값을 기억하지 않아 닫으면 기본값으로 돌아갑니다. 새 전략으로 저장해 둘까요?',
      [{ t: '그냥 닫기', fn: () => ssClosePanel() }, { t: '저장', pri: true, fn: () => { ssSaveFromBase(type); ssClosePanel(); } }]);
    return;
  }
  ssClosePanel();
}
function ssPanelTitle(t) { const el = document.getElementById('ss-ptitle'); if (el && el.textContent !== t) el.textContent = t; }
function ssCommitTitle(text) {
  const name = String(text || '').replace(/\s+/g, ' ').trim();
  if (S.editing) {
    const c = ssFindCfg(S.editing);
    if (c) { if (name) ssRenameCfg(c.id, name); ssPanelTitle(c.name); }
  } else S.pendingName = name || null;
}

// 기본 패널의 지금 값 → 새 저장 전략 (그 사본을 편집 중으로 · 기본 선은 숨김)
function ssSaveFromBase(type) {
  const params = Object.assign({}, S.base[type]);
  const cfg = { id: ssNewId(), type, name: ssUniqueName(S.pendingName || SS_TYPE_NAMES[type]), params, color: ssBaseColor(type), hidden: false };
  S.pendingName = null;
  S.saved.push(cfg);
  ssPersistSaved();
  S.base[type] = ssDefaults(type);
  S.hide[type] = true;
  if (S.panel === type) { S.panel = null; S.editing = cfg.id; ssPanelTitle(cfg.name); }
  ssChanged();
  ssFlashSaved(cfg.id);
}
function ssRenameCfg(id, name) {
  const c = ssFindCfg(id);
  if (!c) return;
  const n = ssUniqueName(String(name).replace(/\s+/g, ' ').trim(), id);
  if (!n || n === c.name) return;
  c.name = n; ssPersistSaved(); ssChanged();
}
function ssFlashSaved(id) {
  const b = document.querySelector('#ss-pbody .ss-savebar .ss-btn.pri');
  if (b) { const t = b.textContent; b.classList.add('flash'); b.textContent = '✓ 저장됨'; setTimeout(() => { if (b.isConnected) { b.classList.remove('flash'); b.textContent = t; } }, 1100); }
  const pill = document.querySelector('.ss-pill[data-id="' + id + '"]');
  if (pill) { pill.classList.add('flash'); setTimeout(() => pill.classList.remove('flash'), 1100); }
}

// ── 조절 칸 (막대 미리보기 드롭다운의 단추) ──
function ssCtl(type, owner, k, extraCls) {
  const p = ssParamsOf(type, owner) || {};
  const dis = type === '9sig' && k === 'dep' && !(ssPosToMonthly(S.mPos) > 0) && !S.tx;
  return '<button type="button" class="ss-pd' + (extraCls ? ' ' + extraCls : '') + '" data-pd-type="' + type + '" data-pd-own="' + owner + '" data-pd-k="' + k + '"' + (dis ? ' disabled title="매달 적립금이 0원보다 클 때만 의미가 있습니다 (시작 금액에는 해당 없음)"' : '') + '><span>' + ssEsc(ssOptLabel(type, k, p[k])) + '</span><i>▾</i></button>';
}
function ssCtls9(owner) {
  const p = ssParamsOf('9sig', owner);
  const c = (k) => ssCtl('9sig', owner, k);
  const stock = 100 - (+p.cash || 0);
  return '<div class="ss-cg">'
    + '<a class="ss-explore" target="_blank" rel="noopener" href="' + SS_EXPLORER['9sig'] + '">🔬 과최적화 탐색기 — 1971·1990·2010년부터 기간별로 가장 잘 맞았던 9sig 설정 ↗</a>'
    + '<p class="ss-line">시작 금액의 ' + c('cash') + ' 를 ' + c('park') + ssTipI('안전 몫(현금 %)은 기본적으로 현금으로 두고 아래 이자를 받습니다. QQQ·SPY 등을 고르면 그 몫을 그 종목으로 들고 있게 되고, 새 돈과 리밸런스도 그 종목으로 사고팝니다(현금 이자는 붙지 않음). 레버리지 종목을 고르면 두 몫 모두 레버리지가 됩니다.') + ' 로 두고, 나머지 <b>' + stock + '%</b>로 ' + c('ul') + ' 를 삽니다.</p>'
    + (p.park === 'cash' ? '<p class="ss-line">그 현금에는 연 ' + c('cr') + ' 이자가 붙습니다.' + ssTipI('리밸런스 사이에 9sig 가 들고 있는 현금이 받는 연이자입니다. SMA 전략·현금 복리 선의 이자와는 따로입니다.') + '</p>' : '')
    + '<p class="ss-line">' + c('per') + ssTipI('리밸런스 주기입니다. 원래 9sig 는 분기마다 9% 목표라서, 옆의 성장률은 \'고른 주기마다\'로 읽힙니다 — 분기 + 9% 면 목표가 분기마다 9% 씩 큽니다.') + ' 리밸런스하고 목표를 ' + c('g') + ' 씩 키웁니다.' + ssTipI('3배 ETF(TQQQ·SPXL)에는 분기 9% 가 표준입니다. 2배(QLD·SSO)라면 낮추세요.') + '</p>'
    + '<p class="ss-line">폭락장: 주가가 지난 ' + c('cw') + ' 최고점보다 ' + c('cd') + ' 넘게 떨어져 있으면 팔지 않고 버팁니다.' + ssTipI('주가가 최근 고점보다 이만큼 떨어져 있으면 원래 팔아야 할 때도 최대 두 번(연속)까지 매도를 건너뜁니다 — 바닥에서 던지지 않도록. 기간은 \'최근 고점\'을 얼마나 거슬러 볼지이며, 표준은 2년입니다.') + '</p>'
    + '<p class="ss-line">급등: 한 기간에 ' + c('sp') + ' 넘게 오르면 주식 비중을 ' + c('st') + ' 로 낮춰 이익을 챙깁니다.' + ssTipI('한 주기(표준은 분기)에 이만큼 넘게 오르면 시작 비중으로 강제 리밸런스해, 급등 뒤 한 종목에 너무 쏠리지 않게 합니다. \'끔\'이면 오름세를 그대로 둡니다.') + '</p>'
    + '<p class="ss-line">살 때는 현금의 ' + c('bp') + ' 까지만 씁니다.' + ssTipI('사야 할 때 현금 중 이 비율까지만 써서 늘 여유 현금을 남깁니다. 표준 9sig 는 90%(10% 남김). 100%면 매번 현금을 다 씁니다.') + '</p>'
    + '<p class="ss-line">리밸런스 거래마다 수수료·슬리피지 ' + c('cost') + ' 가 듭니다.' + ssTipI('리밸런스 때 사고판 금액에 붙는 거래 비용입니다 — 매도·매수·급등 되돌림·바로 투자한 적립금 모두. 0.02% 는 개인 투자자에게 현실적인 추정치입니다.') + '</p>'
    + '</div>'
    + '<div class="ss-cg ss-whatif">'
    + '<div class="ss-cgt">적립금 바로 투자</div><p class="ss-line">매달 적립금의 ' + c('dep') + ' 를 바로 주식에 넣습니다.</p>'
    + '<p class="ss-note">매달 적립금에만 해당합니다(시작 금액은 아님). 0%면 다음 리밸런스까지 적립금을 현금으로 두고, 높이면 그만큼을 그 달 가격에 바로 삽니다.</p>'
    + '<div class="ss-cgt">리밸런스 시점</div><p class="ss-line">각 기간의 ' + c('rp') + ' 지점에서 리밸런스합니다.</p>'
    + '<p class="ss-note">기간 안 어디서 확인할지 — 0% = 기간 시작 무렵, 100% = 기간 끝 무렵. 정확한 날짜에 결과가 얼마나 민감한지 시험해 볼 수 있습니다.</p>'
    + '<div class="ss-cgt">목표 성장 기준</div><p class="ss-line">다음 목표를 ' + c('tc') + ' 에서 키웁니다.</p>'
    + '<p class="ss-note">예 (9% 성장): 지난 목표가 $10,000 인데 실제로 $8,000 만 들고 있었다면, 다음 목표는 직전 보유액 기준 <b>$8,720</b>(8,000 × 1.09), 직전 목표액 기준 <b>$10,900</b>(10,000 × 1.09).</p>'
    + '</div>';
}
function ssCtlsSma(owner) {
  const p = ssParamsOf('sma', owner), c = (k) => ssCtl('sma', owner, k);
  return '<div class="ss-cg">'
    + '<a class="ss-explore" target="_blank" rel="noopener" href="' + SS_EXPLORER.sma + '">🔬 과최적화 탐색기 — 1971·1990·2010년부터 기간별로 가장 잘 맞았던 SMA 설정 ↗</a>'
    + '<p class="ss-line">' + c('sig') + ' 종가가 ' + c('win') + '일 이동평균 위에 있으면 ' + c('ul') + ' 를 삽니다.</p>'
    + '<p class="ss-line">살 때는 평균보다 ' + c('eb') + ' 이상 위, 팔 때는 ' + c('xb') + ' 이상 아래여야 합니다.</p>'
    + '<p class="ss-line">신호가 ' + c('cb') + ' 일 이어져야 사고, ' + c('cs') + ' 일 이어져야 팝니다.' + ssTipI('잦은 들락날락을 막습니다.\n가격이 선 반대편에 이 날수만큼 머물러야 거래합니다.\n\n예: 3 —\nQQQ 가 하루 선 아래로 내려갔다 반등하면 팔지 않습니다. 3일 연속 아래에서 마감해야 팝니다.\n\n0 = 처음 넘는 날 바로 거래.') + '</p>'
    + '<p class="ss-line">거래한 뒤 다음 거래까지 ' + c('settle') + ' 거래일 기다립니다.' + ssTipI('현금 계좌 결제(T+N).\n\n사고판 뒤 돈·주식이 결제되기 전에는 다음 거래를 할 수 없습니다 — 산 직후 바로 팔거나 판 직후 바로 사는 것을 막는 실제 증권사 규칙을 흉내 냅니다.\n\n예: 2 — 월요일에 팔면 수요일부터 다시 살 수 있습니다.\n\n0 = 바로 결제(제한 없음).') + '</p>'
    + '<p class="ss-line">RSI(' + c('ohw') + ')' + ssTipI('RSI 는 0~100 의 속도계입니다:\n• 약 70 이상 = 빠르게 올라 쉬어 가기 쉬움\n• 약 30 이하 = 많이 맞아 반등하기 쉬움\n\nRSI( ) 안의 숫자 = 며칠을 돌아볼지(2~30).\n2 = 작은 흔들림에도 반응, 30 = 느리고 부드러움. 10 이 흔한 중간값.\n\n이건 파는 쪽 RSI 입니다 — 사는 규칙은 아래에 따로 있습니다.') + ' 가 ' + c('oh') + ' 면 그래도 팝니다.</p>'
    + '<p class="ss-line">RSI(' + c('coolw') + ') 가 ' + c('cool') + ' 일 때만 삽니다.' + ssTipI('사라는 신호가 나와도 쫓아 사지 않고 식기를 기다립니다.\n\n예: 40 —\nRSI 가 40 아래로 내려올 때(눌림목)까지 기다렸다 삽니다.\n\nRSI( ) 안의 숫자 = 돌아볼 날수(2~30).\n끔 = 사라는 신호가 나오면 바로 삽니다.') + '</p>'
    + '<div class="ss-cgt">팔았을 때 들고 있을 것</div>'
    + '<p class="ss-line">시장 밖에 있을 땐 ' + c('out') + ' 를 들고 있습니다.' + ssTipI('팔고 난 뒤 들고 있을 것.\n\n• 현금 — 아래 이자를 받으며 기다림\n• QQQ / SPY — 레버리지 없는 시장에 그대로 머묾: 3배보다 훨씬 안전하지만 시장이 오르면 같이 오름\n\n예: TQQQ 매도 → QQQ 보유 → 사라는 신호가 돌아오면 다시 TQQQ.') + '</p>'
    + (p.out === 'cash' ? '<p class="ss-line">그 현금에는 연 ' + c('cr') + ' 이자가 붙습니다.' + ssTipI('시장 밖에서 현금으로 있는 동안 받는 연이자입니다 — 예금·단기 국채처럼.\n\n예: 4% = 다시 살 때까지 현금이 연 4% 쯤 불어남.') + '</p>' : '')
    + '<div class="ss-cgt">나눠서 사기' + ssTipI('기본은 모든 거래를 한 번에 합니다. 여기서 사는 쪽을 여러 날에 나눌 수 있습니다 — 하루 가격에 다 걸지 않도록. 파는 것은 늘 그날 한 번에.\n\n예: 대기 종목 나눠 사기 5일 — 전략이 빠지는 날 주 종목을 바로 현금으로 팔고, 이후 5거래일 동안 대기 종목을 하루 한 조각씩 삽니다. 2개월이면 약 두 달에 걸쳐 나눕니다. 다 사기 전에 사라는 신호가 돌아오면 멈추고 주 종목으로 갈아탑니다.') + '</div>'
    + '<p class="ss-line">살 때는 주 종목을 ' + c('din') + ' 에 걸쳐 나눠 삽니다.</p>'
    + '<p class="ss-line">팔 때는 대기 종목으로 ' + c('dout') + ' 에 걸쳐 나눠 옮깁니다.' + ssTipI('현금 대신 QQQ/SPY 에 머물 때만 의미가 있습니다.\n\n팔 때 3배 종목은 바로 팔고, 그다음 이 기간에 걸쳐 QQQ/SPY 를 나눠 삽니다.\n\n중간에 사라는 신호가 돌아오면 멈추고 3배 종목으로 돌아갑니다.') + '</p>'
    + '<div class="ss-cgt">거래 비용</div>'
    + '<p class="ss-line">사고팔 때마다 수수료·슬리피지 ' + c('cost') + ' 가 듭니다.' + ssTipI('거래마다 드는 비용 — 증권사 수수료 + 슬리피지(예상 가격과 실제 체결 가격의 차이).\n\n사고팔 때 모두 붙으므로 종목을 갈아타면 두 번 냅니다.\n\n예: 0.1% 면 $10,000 매수가 $9,990 어치가 됩니다. 자주 거래하는 전략일수록 여러 번 내므로, 올려 보면 현실 마찰이 결과를 얼마나 깎는지 보입니다.') + '</p>'
    + '<div class="ss-cgt">버블 보험' + ssTipI('거품 브레이크. 시장이 평균선 위로 아주 멀리 달아났을 때(1999년·2021년 말처럼) 3배 종목을 들고 있는 것은 특히 위험합니다 — 그래서 이 규칙은 주 신호와 상관없이 전부 현금으로 미리 팝니다. 고른 종목이 자기 이동평균보다 얼마나 위에 있는지로 재며, 위의 \'팔았을 때 들고 있을 것\'(보통 매도 때만 적용)과는 따로입니다.') + '</div>'
    + '<p class="ss-line">' + c('bga') + ' 가 ' + c('bgw') + '일 이동평균보다 ' + c('bg') + ' 위면 전부 현금으로 팝니다.</p>'
    + '</div>';
}
function ssCtlsBh(owner) {
  return '<div class="ss-cg"><p class="ss-line">진입할 때 ' + ssCtl('bh', owner, 'ul') + ' 를 사고, 매달 적립금도 계속 사 모으며 팔지 않습니다.' + ssTipI('시작 금액을 진입일에 사고 매달 적립금도 같은 종목을 더 삽니다. 아무것도 팔지 않습니다.') + '</p></div>';
}
function ssCtlsInv(owner) {
  const p = ssParamsOf('invested', owner);
  const r = ssPosToRate(+p.r || 0);
  return '<div class="ss-cg"><p class="ss-note" style="margin-bottom:10px">모든 적립금을 주식 대신 이자 붙는 현금으로만 모았다면 얼마가 되는지 보여 주는 기준선입니다. 9sig·SMA 전략의 현금 이자는 각 전략 설정에서 따로 정합니다.</p>'
    + '<div class="ss-rate"><span>현금 이자율 (연)</span><b id="ss-rate-v">' + r.toFixed(1) + '%</b></div>'
    + '<input type="range" class="ss-range" id="ss-rate" data-own="' + owner + '" min="0" max="1000" step="1" value="' + (+p.r || 0) + '" aria-label="현금 이자율"></div>';
}

// ── 통계 4칸 ──
function ssStatCard(label, icon, value, cls, sub, tip, delta) {
  return '<div class="ss-stat"><div class="ss-sth"><span class="ss-stl">' + label + ssTipI(tip) + '</span>' + ssIco(SS_ICON[icon] || '', 'ss-sti') + '</div>'
    + '<div class="ss-stv ' + (cls || '') + '">' + value + (delta && delta.text ? ' <span class="ss-std ' + (delta.tone || '') + '">' + delta.text + '</span>' : '') + '</div>' + (sub ? '<div class="ss-sts">' + sub + '</div>' : '') + '</div>';
}
function ssStatsGrid(m) {
  if (!m) return '';
  const cs = Number.isFinite(m.cagr) ? (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%' : '–';
  return '<div class="ss-stats">'
    + ssStatCard('연평균 수익률', m.cagr >= 0 ? 'trendUp' : 'trendDown', cs, m.cagr >= 0 ? 'ss-up' : 'ss-dn', '', '돈 가중 연수익률(IRR).\n\n넣은 돈마다 실제로 투자된 기간만큼 가중하므로, 일찍 넣은 돈이 더 크게 칩니다 — 단순히 끝÷시작으로 구한 값보다 정확합니다.')
    + ssStatCard('시작 금액', 'dollar', ssMoney(Math.round(m.start || 0)), '', '', '고른 기간이 시작될 때의 평가액 — 여기서 처음 투자한 금액입니다.')
    + ssStatCard('끝 금액', 'flag', ssMoney(Math.round(m.end || 0)), '', '', '고른 기간이 끝날 때의 평가액. 차트에서 이 선이 끝나는 자리입니다.')
    + ssStatCard('최대 낙폭', 'trendDown', ssDD(m.maxDD), 'ss-dn', ssDDRange(m.ddPeak, m.ddTrough), '기간 중 고점에서 저점까지 가장 크게 떨어진 비율 — 매일 종가로 다시 평가하므로 분기 중간의 폭락도 잡힙니다. 아래 날짜가 언제였는지입니다.')
    + '</div>';
}

// ── 기록 표 ──
function ssLogHead(title, mt) {
  return '<div class="ss-sec" style="margin-top:' + (mt == null ? 24 : mt) + 'px"><span>' + title + '</span><button type="button" class="ss-csv" data-csv title="CSV 로 받기"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>CSV</button></div>';
}
const SS_LATEST_TIP = '가장 최근 값이고 이 기간은 아직 끝나지 않았습니다. 가격은 장중 몇 시간 뒤에 받은 값이라 남은 시간 동안 크게 움직일 수 있고 실제 종가와 다를 수 있습니다. 다음 날 자료로 갱신됩니다.';
const ssLatest = (last) => (last ? ssTipI(SS_LATEST_TIP) : '');
const ssNewMoney = (log) => log.map((l, i) => (i === 0 ? l.invested : l.invested - log[i - 1].invested));
function ss9ActLabel(a) {
  if (!a) return '';
  if (a.k === 'START') return '시작';
  if (a.k === 'SELL') return '매도 ' + ssMoney(a.amt) + (a.late ? ' (보류 끝)' : '');
  if (a.k === 'HOLD') return a.crash ? '보류 (폭락 ' + a.crash + '/2)' : '유지';
  if (a.k === 'BUY') return '매수 ' + ssMoney(a.amt) + (a.part ? ' (일부)' : '');
  if (a.k === 'RESET') return '되돌림 ' + ssMoney(a.amt) + ' (급등)';
  if (a.k === 'SNAPSHOT') return '현재 평가';
  return a.k;
}
function ssLog9Html(log, ul) {
  if (!log || !log.length) return '';
  const nm = ssNewMoney(log), L = log.length - 1, U = ul.toUpperCase();
  const rows = log.map((l, i) => {
    const k = l.act && l.act.k, ac = k === 'SELL' ? 'ss-dn' : k === 'BUY' ? 'ss-up' : 'ss-hold';
    const sh = l.price > 0 ? l.holdVal / l.price : 0;
    return '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td>' + (i === 0 ? '처음' : '리밸런스') + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td>'
      + '<td>' + ssLogPrice(l.price) + '</td><td>' + ssLogShares(sh) + '</td><td>' + ssMoney(Math.round(l.holdVal)) + '</td><td class="ss-tgt">' + ssMoney(Math.round(l.target)) + '</td><td>' + ssMoney(Math.round(l.cash)) + '</td><td>' + ssMoney(Math.round(l.total)) + '</td>'
      + '<td>' + (!l.fee ? '—' : l.fee >= 1 ? ssMoney(Math.round(l.fee)) : '+$' + l.fee.toFixed(2)) + '</td><td class="' + ac + ' ss-act">' + ss9ActLabel(l.act) + '</td></tr>';
  }).join('');
  return '<div class="ss-logsec">' + ssLogHead('리밸런스 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('줄 번호. 처음 자리가 0 이고 리밸런스마다 하나씩 늘어 — 마지막 번호가 리밸런스 횟수입니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>' + U + ' 가격</th><th>' + U + ' 주수</th><th>' + U + ' 평가액</th><th>목표</th><th>현금</th><th>합계</th><th>수수료' + ssTipI('이 리밸런스에서 낸 거래 비용(수수료 % × 거래 금액) — 매도·매수·급등 되돌림·바로 투자한 적립금. 유지만 한 리밸런스는 0(—).') + '</th><th>동작</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}
function ssLogBhHtml(log, series, ul) {
  if (!log || !log.length || !series || !series.length) return '';
  const nm = ssNewMoney(log), n = log.length, L = n - 1, U = ul.toUpperCase();
  const hasC = nm.some((m, i) => i > 0 && m > 0);
  const idx = hasC ? log.map((_, i) => i) : n > 1 ? [0, L] : [0];
  const rows = idx.map((i) => {
    const s = series[i] || {};
    const t = i === 0 ? '처음 매수' : hasC ? (nm[i] > 0 ? '매달 적립' : '보유') : '최근';
    return '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(log[i].date) + '</td><td>' + t + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td><td>' + ssLogPrice(s.price) + '</td><td>' + ssLogShares(s.shares) + '</td><td>' + ssMoney(Math.round(s.value || 0)) + '</td></tr>';
  }).join('');
  return '<div class="ss-logsec">' + ssLogHead('그냥 보유 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('전체 가격 기록에서의 줄 번호(처음 매수가 0). 적립이 없으면 표를 첫 줄과 마지막 줄만 남겨 번호가 건너뛸 수 있습니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>' + U + ' 가격</th><th>' + U + ' 주수</th><th>평가액</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}
function ssLogInvHtml(log) {
  if (!log || !log.length) return '';
  const nm = ssNewMoney(log), L = log.length - 1;
  const rows = log.map((l, i) => '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td>' + (i === 0 ? '처음' : nm[i] > 0 ? '매달 적립' : '이자') + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td><td>' + ssMoney(Math.round(l.base)) + '</td></tr>').join('');
  return '<div class="ss-logsec">' + ssLogHead('현금 복리 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('줄 번호 — 첫 줄이 0 이고 하나씩 늘어납니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>평가액</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

// SMA 로그 한 줄 → { 이름, 직전 대비 수익률, 색 } — 표와 차트 풍선이 같이 씀
function ssSmaRowInfo(log, i, ul) {
  const l = log[i], prev = i > 0 ? log[i - 1] : null;
  const held = String(l.held || l.state || '').toUpperCase(), from = prev ? String(prev.held || prev.state || '').toUpperCase() : '';
  const T = (x) => (x === 'CASH' ? '현금' : x);
  const swap = (a, b) => (a === 'CASH' ? T(b) + ' 매수' : b === 'CASH' ? T(a) + ' 매도 → 현금' : T(a) + ' 매도 → ' + T(b) + ' 매수');
  let label;
  switch (l.action) {
    case 'CONTRIB': label = '+ ' + ssMoney(Math.round(l.contribAmt || 0)); break;
    case 'DCA-ADD': label = T(held) + ' 나눠 사기'; break;
    case 'ENTER': case 'EXIT': label = swap(from, held); break;
    case 'BG-GTFO': label = '버블: ' + T(from) + ' 매도 → 현금'; break;
    case 'BG-CLEAR': label = '버블 끝: ' + T(held) + ' 매수'; break;
    case 'START': label = '시작'; break;
    case 'END': label = '기간 끝'; break;
    default: label = l.action;
  }
  let gain = null;
  if (prev && prev.total > 0 && l.date !== prev.date) gain = (l.total - prev.total - ((l.invested || 0) - (prev.invested || 0))) / prev.total * 100;
  const ac = l.action === 'EXIT' || l.action === 'BG-GTFO' ? 'ss-dn' : l.action === 'ENTER' || l.action === 'DCA-ADD' ? 'ss-up' : 'ss-hold';
  return { label, gain, ac };
}
function ssHoldTime(log, heldOf) {
  const ms = {};
  let tot = 0;
  for (let i = 0; i < log.length - 1; i++) {
    const a = heldOf(log[i]);
    if (!a) continue;
    const dt = Date.parse(log[i + 1].date) - Date.parse(log[i].date);
    if (dt > 0) { ms[a] = (ms[a] || 0) + dt; tot += dt; }
  }
  if (!(tot > 0)) return '';
  const chips = Object.entries(ms).sort((a, b) => b[1] - a[1]).map(([a, v]) => { const y = v / 31557600000; return '<span class="ss-htc"><b>' + ssEsc(a === 'CASH' ? '현금' : a) + '</b> ' + (v / tot * 100).toFixed(1) + '% <i>(' + (y >= 1 ? y.toFixed(1) + '년' : Math.round(y * 12) + '개월') + ')</i></span>'; }).join('');
  return '<div class="ss-htime"><span>종목별 보유 기간:</span>' + chips + '</div>';
}
function ssLogSmaHtml(log, ul) {
  if (!log || !log.length) return '';
  const U = ul.toUpperCase();
  const rows = log.map((l, i) => {
    const info = ssSmaRowInfo(log, i, U);
    const g = info.gain != null ? ' <span class="' + (info.gain >= 0 ? 'ss-up' : 'ss-dn') + '">(' + (info.gain >= 0 ? '+' : '−') + Math.abs(info.gain).toFixed(1) + '%)</span>' : '';
    const mk = !!(SS_EVT[l.action] && l.total > 0);
    const cls = mk ? 'mk' : l.action === 'CONTRIB' ? 'rc' : l.action === 'DCA-ADD' ? 'rd' : '';
    const fee = !l.fee ? '—' : l.fee >= 1 ? ssMoney(Math.round(l.fee)) : '$' + l.fee.toFixed(2);
    const tot = l.total || 0, pf = tot > 0 ? (l.stockVal || 0) / tot * 100 : 0, pc = tot > 0 ? (l.cash || 0) / tot * 100 : 0;
    const mix = [];
    if (pf >= 0.5) mix.push(Math.round(pf) + '% ' + String(l.held || '').toUpperCase());
    if (pc >= 0.5) mix.push(Math.round(pc) + '% 현금');
    const held = String(l.held || l.state || '').toUpperCase();
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + (mk ? ' data-mkey="' + i + '"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td class="' + info.ac + '">' + ssEsc(info.label) + g + '</td><td>' + (held === 'CASH' ? '현금' : held) + '</td><td class="ss-mix">' + (mix.length ? mix.join(' · ') : tot > 0 ? '100% 현금' : '—') + '</td>'
      + '<td>' + (l.shares > 0 ? ssLogPrice(l.stockVal / l.shares) : '—') + '</td><td>' + ssLogShares(l.shares) + '</td><td>' + ssMoney(Math.round(l.stockVal)) + '</td><td>' + ssMoney(Math.round(l.cash)) + '</td><td>' + ssMoney(Math.round(l.total)) + '</td><td>' + ssMoney(l.invested) + '</td><td>' + fee + '</td></tr>';
  }).join('');
  const nc = log.filter((l) => l.action === 'CONTRIB').length, ne = log.filter((l) => l.action === 'DCA-ADD').length;
  const tg = (nc ? '<label class="ss-chk"><input type="checkbox" data-hide="c"' + (ssPanel.hideC ? ' checked' : '') + '> 매달 적립 줄 숨기기 (' + nc + ')</label>' : '') + (ne ? '<label class="ss-chk"><input type="checkbox" data-hide="e"' + (ssPanel.hideE ? ' checked' : '') + '> 나눠 사기 조각 숨기기 (' + ne + ')</label>' : '');
  const th = (t, tip) => '<th>' + t + ssTipI(tip) + '</th>';
  return '<div class="ss-logsec">' + ssLogHead('SMA 거래 기록') + '<div class="ss-chks">' + tg + '</div><div class="ss-tw' + (ssPanel.hideC ? ' hide-c' : '') + (ssPanel.hideE ? ' hide-e' : '') + '"><table><thead><tr>'
    + th('#', '사건 번호. 시작(첫 자리)이 0 이고 거래·매달 적립마다 하나씩 늘어 — 마지막 번호가 이 기간의 사건 수입니다.')
    + th('날짜', '이 줄이 일어난 거래일.\n\n전략이 실제로 뭔가 한 날만 적습니다 — 대부분의 날은 그냥 들고 있어서 나오지 않습니다.')
    + th('동작', '이날 한 일:\n\n• 시작 — 첫 자리\n• A 매도 → 현금 — 들고 있던 것을 팔아 현금으로\n• B 매수 — B 를 삼\n갈아타기는 같은 날 두 줄(매도 후 매수)로 나옵니다 — 실제로 두 번 거래하고 비용도 두 번 냅니다.\n• B 나눠 사기 — 나눠 사는 한 조각(각자 비용). \'나눠 사기 조각 숨기기\'로 접을 수 있음\n• + $X — 매달 적립금이 들어옴\n• 버블: A 매도 → 현금 — 버블 브레이크가 전부 현금으로\n• 버블 끝: B 매수 — 브레이크가 풀려 다시 삼\n• 기간 끝 — 기간 마지막의 평가(거래 아님) · 합계가 차트 끝값과 같음\n\n괄호 속 (%) 는 직전 동작 이후의 수익·손실입니다 — 그사이 들어온 적립금은 빼고 계산해, 들고 있던 것 자체의 수익률입니다.')
    + th('보유', '이 거래 직후 실제로 들고 있던 것:\n\n• ' + U + ' — 3배 종목에 모두 투자\n• QQQ / SPY — 레버리지 없는 종목(훨씬 안전)\n• 현금 — 시장 밖\n\n추세 신호와 다를 수 있습니다: 버블 브레이크가 걸리면 추세는 \'안\'이어도 실제로는 현금에 있습니다.')
    + th('구성', '지금 돈이 어떻게 나뉘어 있는지: 주 종목(' + U + ') 또는 대기 종목 비율 vs 현금.\n\n나눠 사는 중이면 일부만 투자된 상태 — 예: \'58% SPXL · 42% 현금\'.')
    + th('종목 가격', '이날 실제로 들고 있던 종목(보유 칸)의 종가 — 신호 안이면 주 종목, 밖이면 대기 종목.\n\n현금 줄은 비어 있음(—). 가격 × 주수 = 주식 평가액.')
    + th('주수', '거래 뒤 보유 칸 종목의 주수.\n\n전부 현금일 때만 0 — 그래서 버블 브레이크·현금 매도 줄은 0. 주 종목이든 대기 종목이든 들고 있으면 0 이 아님.')
    + th('주식 평가액', '들고 있는 종목의 금액 — 현금을 뺀 나머지 전부.')
    + th('현금', '이 거래 뒤 현금으로 있는 금액. 다시 투자될 때까지 현금 이자를 받습니다.')
    + th('합계', '그날 전체 평가액: 종목 + 현금. 차트의 이 전략 선이 그리는 값입니다.')
    + th('넣은 돈', '이 날까지 넣은 돈의 합 — 시작 금액 + 지금까지의 적립금.\n\n합계 − 넣은 돈 = 수익.')
    + th('수수료', '이 줄의 거래에서 낸 비용(수수료 % × 거래 금액). 매도와 나눠 사기 조각마다 냅니다.\n\n적립·시작·기간 끝 줄은 0(—).')
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + ssHoldTime(log, (r) => String(r.held || r.state || 'cash').toUpperCase()) + '</div>';
}

// SMA 신호 지표 (마지막 거래일) + '지금 판단'
function ssSmaSignals(p) {
  const di = DS.days.length - 1;
  const sig = (p.sig || 'qqq').toLowerCase(), win = +p.win || 200, ohw = +p.ohw || 10, cw = +p.coolw || 10;
  const oh = +p.oh || 0, cool = +p.cool || 0, bga = (p.bga || 'qqq').toLowerCase(), bg = +p.bg || 0, bgw = +p.bgw || win;
  const eb = +p.eb || 0, xb = +p.xb || 0;
  const smaArr = ssInd('sma', sig, win, false);
  if (!smaArr || smaArr[di] == null) return '';
  const price = DS.days[di][sig], sma = smaArr[di], above = price > sma, pct = (price / sma - 1) * 100;
  // 오늘까지 이동평균 위(또는 아래)에 연속으로 있었던 거래일 수
  let days = 0;
  while (di - days >= 0) { const j = di - days, avg = smaArr[j]; if (avg == null || (DS.days[j][sig] > avg) !== above) break; days++; }
  const A = sig.toUpperCase();
  const red = (t) => '<span class="ss-warn">' + t + '</span>';
  const rsiAt = (w) => { const a = ssInd('rsi', sig, w, false); return a && a[di] != null ? a[di] : null; };
  const rsiCard = (label, w, thr, cmp, tip) => {
    const v = rsiAt(w), vs = v == null ? '—' : v.toFixed(1);
    let sub;
    if (thr <= 0) sub = '끔'; else if (v == null) sub = ''; else { const hit = cmp === 'above' ? v >= thr : v <= thr; const t = thr + (cmp === 'above' ? ' 이상' : ' 이하'); sub = hit ? red(t + ' · 해당') : t; }
    return ssStatCard('RSI(' + w + ') · ' + label, 'activity', vs, '', sub, tip);
  };
  const rsiTip = (w, side, lvl) => '최근 ' + w + '일 ' + A + ' 의 상대강도지수(RSI) — 0~100 의 속도계.\n\n계산:\n1. 날마다 종가 변화를 오른 몫·내린 몫으로 나눔\n2. 각각의 ' + w + '일 평균을 와일더 방식으로: 새 평균 = (이전 평균 × ' + (w - 1) + ' + 오늘) ÷ ' + w + '\n3. RS = 평균 상승 ÷ 평균 하락\n4. RSI = 100 − 100 ÷ (1 + RS)\n\n50 = 오르내림 균형 · 약 70 이상 = 빠르게 오름 · 약 30 이하 = 많이 빠짐.\n\n' + (side === 'sell' ? '매도 규칙: RSI 가 과열 기준' + (lvl > 0 ? '(' + lvl + ')' : '') + ' 이상이면 팝니다.' : '매수 규칙: RSI 가 기준' + (lvl > 0 ? '(' + lvl + ')' : '') + ' 아래로 식을 때까지 기다렸다 다시 삽니다 — 과열된 꼭대기를 사지 않도록.');
  const cards = [];
  cards.push(ssStatCard(A + ' vs ' + win + '일 평균', above ? 'trendUp' : 'trendDown', (above ? '▲ +' : '▼ −') + Math.abs(pct).toFixed(2) + '%', above ? 'ss-up' : 'ss-dn', ssLogPrice(price) + ' vs 평균 ' + ssLogPrice(sma), '신호 종목의 마지막 종가와 ' + win + '일 이동평균.\n\n평균 위 = 추세 규칙이 \'안\'(3배 종목 보유), 아래 = \'밖\'. 핵심 매수·매도 신호입니다.'));
  cards.push(ssStatCard('평균 ' + (above ? '위' : '아래') + ' 연속', 'clock', days + '일', '', A + ' 가 마지막으로 선을 넘은 뒤', A + ' 가 지금 쪽(평균 위/아래)에 며칠째 연속 머무는지 — 지금 추세 신호가 뒤집히지 않고 얼마나 이어졌는지입니다.'));
  if (eb > 0 || xb > 0) cards.push(ssStatCard('완충 띠', 'sliders', '+' + eb + '% / −' + xb + '%', '', '매수 &gt; ' + ssLogPrice(sma * (1 + eb / 100)) + ' · 매도 &lt; ' + ssLogPrice(sma * (1 - xb / 100)), '완충값이 만드는 가격 문턱: 평균보다 ' + eb + '% 위에서만 사고 ' + xb + '% 아래에서만 팝니다. 선 바로 위아래에서 들락날락하는 것을 막는 무반응 구간입니다.'));
  cards.push(rsiCard('매도', ohw, oh, 'above', rsiTip(ohw, 'sell', oh)));
  cards.push(rsiCard('매수', cw, cool, 'below', rsiTip(cw, 'buy', cool)));
  const bgArr = ssInd('sma', bga, bgw, false);
  let bgPct = null;
  if (bgArr && bgArr[di] != null) {
    bgPct = (DS.days[di][bga] / bgArr[di] - 1) * 100;
    const armed = bg > 0 && bgPct >= bg;
    cards.push(ssStatCard(bga.toUpperCase() + ' vs ' + bgw + '일 평균', 'shield', (bgPct >= 0 ? '+' : '−') + Math.abs(bgPct).toFixed(2) + '%', armed ? 'ss-warn' : bgPct >= 0 ? 'ss-up' : 'ss-dn',
      armed ? red('⚠ 작동 — 현금으로 팔게 됨') : bg > 0 ? '+' + bg + '% 이면 현금으로' : '끔',
      '버블 보험 계기: ' + bga.toUpperCase() + ' 가 자기 ' + bgw + '일 평균보다 얼마나 위에 있는지.\n\n' + (bg > 0 ? '+' + bg + '% 에 닿으면 주 신호와 상관없이 브레이크가 전부 현금으로 팝니다.' : '브레이크가 꺼져 있습니다(현금 기준 없음).')));
  }
  // 지금 판단: 오늘 목돈을 넣는다면
  const P = String(p.ul || sig).toUpperCase(), outA = (p.out || 'cash').toLowerCase(), B = outA === 'cash' ? '현금' : outA.toUpperCase();
  const din = +p.din || 0;
  const ohV = rsiAt(ohw), clV = rsiAt(cw), ps = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  const trendIn = pct > eb, hot = oh > 0 && ohV != null && ohV >= oh, blocked = cool > 0 && clV != null && clV >= cool, armed = bg > 0 && bgPct != null && bgPct >= bg;
  const rv = (v) => (v == null ? '—' : v.toFixed(1));
  const rs = [{ lean: trendIn ? 'buy' : 'out', name: '추세', val: A + ' ' + ps(pct) + ' vs ' + win + '일', tag: trendIn ? '안 · ' + P : '밖 · ' + B }];
  if (oh > 0) rs.push({ lean: hot ? 'out' : 'buy', name: '과열', val: 'RSI(' + ohw + ') ' + rv(ohV), tag: hot ? '매도 ≥' + oh : '괜찮음' });
  if (cool > 0) rs.push({ lean: blocked ? 'out' : 'buy', name: '재진입', val: 'RSI(' + cw + ') ' + rv(clV), tag: blocked ? '대기 <' + cool : '열림' });
  if (bg > 0) rs.push({ lean: armed ? 'cash' : 'buy', name: '버블', val: bga.toUpperCase() + ' ' + (bgPct == null ? '—' : ps(bgPct)), tag: armed ? '현금 +' + bg + '%' : '꺼짐' });
  let action, cls, note;
  if (armed) { action = '현금으로'; cls = 'cash'; note = '버블 브레이크가 추세보다 우선'; }
  else if (trendIn && !hot && !blocked) { action = P + ' 매수'; cls = 'buy'; note = din > 1 ? din + '거래일에 나눠 삼' : '한 번에'; }
  else { action = B === '현금' ? '현금 유지' : B + ' 매수'; cls = 'hold'; note = B === '현금' ? '매수 신호가 꺼져 있음' : '대기 종목 — 매수 신호가 꺼져 있음'; }
  return '<div class="ss-sec" style="margin-top:24px"><span>신호 지표 <i class="ss-asof">· ' + ssDate(DS.days[di].date) + ' 기준</i></span></div><div class="ss-stats">' + cards.join('') + '</div>' + ssDecisionHtml(action, cls, note, rs);
}
function ssDecisionHtml(action, cls, note, reasons) {
  return '<div class="ss-sec" style="margin-top:22px"><span>지금 판단</span></div><div class="ss-dec"><div class="ss-dech sd-' + cls + '"><span class="ss-decl">오늘 목돈을 넣는다면</span><span class="ss-deca">' + ssEsc(action) + '</span>' + (note ? '<span class="ss-decn">' + ssEsc(note) + '</span>' : '') + '</div>'
    + (reasons && reasons.length ? '<div class="ss-decs">' + reasons.map((r) => '<div class="ss-decr lean-' + r.lean + '"><i></i><span class="n">' + ssEsc(r.name) + '</span><span class="v">' + ssEsc(r.val || '') + '</span><span class="t">' + ssEsc(r.tag || '') + '</span></div>').join('') + '</div>' : '') + '</div>';
}

// 9sig 설명 (지금 값으로 문장)
function ss9Rules(p) {
  const ul = String(p.ul || 'tqqq').toUpperCase(), g = +p.g || 9, cd = +p.cd || 30, sp = +p.sp, cash = +p.cash || 0, stock = 100 - cash, bp = +p.bp || 90;
  const name = '9sig';
  const crash = cd >= 100 ? '<span class="ss-mut">(폭락 보호: ' + cd + '% 라 사실상 꺼짐)</span>' : ul + ' 가 2년 고점보다 <b>' + cd + '%</b> 넘게 떨어져 있으면 <b>최대 두 분기 연속 매도를 건너뜁니다</b> — 폭락 때 던지지 않도록. 두 번 건너뛴 뒤에는 그래도 팝니다.';
  const spike = sp <= 0 ? '<span class="ss-mut">(급등 되돌림: 끔)</span>' : ul + ' 가 <b>한 분기에 ' + sp + '% 넘게 오르고</b> 아직 ' + stock + '% 이상을 들고 있으면 ' + stock + '/' + cash + ' 로 강제 리밸런스 — 횡재를 확정합니다.';
  return '<div class="ss-sec" style="margin-top:24px"><span>' + name + ' 설명</span></div><div class="ss-rules">'
    + '<p><b>생각:</b> ' + ul + ' 는 분기마다 ' + g + '% 씩 커야 합니다. 더 빨리 컸으면 넘친 만큼 팔아 현금으로, 덜 컸으면 현금으로 모자란 만큼 삽니다. 그게 전부입니다.</p>'
    + '<h5>실제 순서</h5>'
    + '<p><b>1. 시작.</b> 돈의 ' + stock + '% 로 ' + ul + ' 를 사고 ' + cash + '% 는 현금으로. ' + ul + ' 쪽 금액을 적어 둡니다 — 이것이 <b>목표</b>입니다.</p>'
    + '<p><b>2. 분기마다, 판단하기 전에:</b></p><ul><li>목표를 <b>' + g + '%</b> 키웁니다.</li><li>이번 분기에 새 돈(매달 적립)을 넣었다면 그 <b>절반</b>만큼도 목표를 올립니다.</li></ul>'
    + '<p><b>3. 이제 ' + ul + ' 를 목표와 비교:</b></p><ul><li><b>목표보다 많으면?</b> 넘친 만큼 팔아 현금으로.</li><li><b>목표보다 적으면?</b> 모자란 만큼 현금으로 삼.</li><li><b>같으면?</b> 유지.</li></ul>'
    + '<h5>안전장치</h5>'
    + '<p>• <b>매수 한도 ' + bp + '%.</b> 한 번 살 때 현금의 ' + bp + '% 까지만 씁니다' + (bp < 100 ? ' — 여유 현금을 남깁니다' : '') + '.</p>'
    + '<p>• <b>폭락 시 매도 보류.</b> ' + crash + '</p>'
    + '<p>• <b>급등 되돌림.</b> ' + spike + '</p>'
    + '<p class="ss-note">매달 적립금은 늘 현금으로 먼저 들어가고(' + ul + ' 로 바로 가지 않음) 분기 리밸런스가 주식으로 옮깁니다. 목표를 새 돈의 절반만큼 올리는 것은, 넣은 돈의 절반은 결국 ' + ul + ' 로 가야 한다고 보는 셈입니다.</p></div>';
}

// ── 선 색 고르기 ──
const SS_SWATCHES = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'];
function ssActiveColor() { const t = ssPanelTarget(); if (!t) return '#7a7aa6'; return t.cfg ? t.cfg.color : ssBaseColor(t.type); }
function ssColorBar() {
  const col = ssActiveColor(), hex = col.replace(/^#/, '').toLowerCase();
  return '<div class="ss-colorbar"><span>선 색</span><button type="button" id="ss-ctrig" class="ss-ctrig" style="background:' + col + '" aria-label="선 색 고르기"></button>'
    + '<div id="ss-cpop" class="ss-cpop" hidden><div class="ss-cgrid">' + SS_SWATCHES.map((c) => '<button type="button" class="ss-sw' + (c === '#' + hex ? ' sel' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('')
    + '</div><div class="ss-crow"><span>#</span><input type="text" id="ss-chex" maxlength="6" spellcheck="false" value="' + hex + '" aria-label="16진 색"><button type="button" id="ss-cok">확인</button></div></div></div>';
}
let _ssColorOrig = null;
function ssOpenColor() {
  const pop = document.getElementById('ss-cpop'), tr = document.getElementById('ss-ctrig');
  if (!pop || !tr) return;
  _ssColorOrig = ssActiveColor();
  pop.hidden = false;
  const r = tr.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = r.left + 'px';
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - 8 - pr.width) + 'px';
  if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - 6 - pr.height) + 'px';
}
function ssCloseColor(revert) {
  const pop = document.getElementById('ss-cpop');
  if (pop) pop.hidden = true;
  if (revert && _ssColorOrig) ssPreviewColor(_ssColorOrig);
  _ssColorOrig = null;
}
function ssPreviewColor(c) {
  const t = ssPanelTarget();
  if (!t || !ssChart) return;
  const key = t.cfg ? 'cfg:' + t.cfg.id : t.type;
  for (const d of R.datasets) if (d._key === key || (t.cfg && d.cfgId === t.cfg.id)) { d._color = c; d.borderColor = c; }
  const tr = document.getElementById('ss-ctrig');
  if (tr) tr.style.background = c;
  ssChart.update('none');
}
function ssCommitColor(c) {
  const t = ssPanelTarget();
  if (!t) return;
  if (t.cfg) { t.cfg.color = c; ssPersistSaved(); } else S.baseColor[t.type] = c;
  ssChanged();
}
const ssNormHex = (v) => { const s = String(v || '').trim().replace(/^#/, ''); return /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s.toLowerCase() : null; };

// ── 패널 몸통 그리기 ──
function ssRenderPanel() {
  if (!ssPanel.open) return;
  const body = document.getElementById('ss-pbody');
  if (!body || ssPanel.drag) return;
  const t = ssPanelTarget();
  if (!t) { ssClosePanel(); return; }
  const top = body.scrollTop;
  let h = '';
  const m = t.cfg ? R.metrics['cfg:' + t.cfg.id] : R.metrics[t.type];
  if (t.type === 'custom') { body.innerHTML = ssCustomPanelHtml(t.cfg, m, body.clientWidth); body.scrollTop = top; return; }
  if (t.type === '9sig') h += ssCtls9(t.owner);
  else if (t.type === 'sma') h += ssCtlsSma(t.owner);
  else if (t.type === 'bh') h += ssCtlsBh(t.owner);
  else if (t.type === 'invested') h += ssCtlsInv(t.owner);
  h += ssColorBar();
  if (!t.cfg) h += '<div class="ss-savebar"><button type="button" class="ss-btn pri" data-savenew="' + t.type + '" title="지금 설정을 새 저장 전략으로">전략으로 저장</button></div>';
  if (t.type === '9sig' && t.cfg) {
    const ss = t.cfg.subShown || {};
    h += '<div class="ss-sec"><span>세부 선</span></div><div class="ss-subchips">' + SS_SUB_DEFS.map((d) => '<div class="ss-chip ss-subchip' + (ss[d.key] ? '' : ' off') + '" data-sub="' + d.key + '" role="button" tabindex="0">' + ssEye(!!ss[d.key]) + '<span class="ss-cdot" style="background:' + t.cfg.color + '"></span><span class="ss-cname">' + ssEsc(ssSubLabel(d.key, t.cfg.params)) + '</span></div>').join('') + '</div>';
  }
  h += ssStatsGrid(m);
  const sim = t.cfg ? R.cfgSim[t.cfg.id] : null;
  if (t.type === '9sig' && sim) { h += ssLog9Html(sim.log, t.params.ul || 'tqqq'); h += ss9Rules(t.params); }
  else if (t.type === 'bh') {
    const key = SS_COL[t.params.ul] ? t.params.ul : 'tqqq';
    const src = sim || R.base;
    if (src) h += ssLogBhHtml(src.log, (src.bh || {})[key], key);
  } else if (t.type === 'invested') {
    const src = sim || R.base;
    if (src) h += ssLogInvHtml(src.log);
  } else if (t.type === 'sma') {
    h += ssSmaSignals(t.params);
    if (sim) h += ssLogSmaHtml(sim.log, t.params.ul || 'tqqq');
  }
  body.innerHTML = h;
  body.scrollTop = top;
}

// ── 대화상자 ──
function ssDialog(title, html, btns) {
  ssCloseDialog();
  const ov = document.createElement('div');
  ov.className = 'ss-ov';
  ov.id = 'ss-dlg';
  ov.innerHTML = '<div class="ss-modal" role="dialog" aria-modal="true"><div class="ss-mtitle">' + ssEsc(title) + '</div><div class="ss-mbody">' + html + '</div><div class="ss-mact">'
    + btns.map((b, i) => '<button type="button" class="ss-btn' + (b.pri ? ' pri' : '') + (b.danger ? ' danger' : '') + '" data-dlg="' + i + '">' + ssEsc(b.t) + '</button>').join('') + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]');
    if (b) { const fn = btns[+b.getAttribute('data-dlg')].fn; ssCloseDialog(); if (fn) fn(); return; }
    if (e.target === ov) ssCloseDialog();
  });
  const f = ov.querySelector('.ss-btn.pri, .ss-btn.danger') || ov.querySelector('.ss-btn');
  if (f) f.focus();
}
function ssCloseDialog() { const d = document.getElementById('ss-dlg'); if (d) d.remove(); }

// ── 설명 풍선 (ⓘ) — 패널 스크롤에 잘리지 않게 화면 고정 위치 ──
(function () {
  let box = null;
  const show = (el) => {
    if (!box) { box = document.createElement('div'); box.className = 'ss-tipbox'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box); }
    box.textContent = el.getAttribute('data-tip');
    box.classList.toggle('wide', el.hasAttribute('data-tip-wide'));
    box.style.display = 'block';
    const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    box.style.left = left + 'px'; box.style.top = top + 'px';
  };
  const hide = () => { if (box) box.style.display = 'none'; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.ss-i[data-tip]')) hide(); });
  document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) { e.preventDefault(); show(el); } else hide(); }, true);
  window.addEventListener('scroll', hide, true);
})();

// ── 표 → CSV ──
function ssTableCsv(table) {
  // 칸 글자: ⓘ 빼고 공백 한 칸으로 · 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감쌈(따옴표는 두 번)
  const cell = (el) => { const t = el.textContent.replace(/ⓘ/g, '').replace(/\s+/g, ' ').trim(); return /[",\n]/.test(t) ? '"' + t.split('"').join('""') + '"' : t; };
  const line = (cells) => cells.map(cell).join(',');
  const out = [line(Array.from(table.querySelectorAll('thead th')))];
  for (const tr of table.querySelectorAll('tbody tr')) if (getComputedStyle(tr).display !== 'none') out.push(line(Array.from(tr.children)));
  return '\ufeff' + out.join('\n');   // 엑셀이 한글을 알아보게 BOM
}
function ssDownload(text, name, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

// ── 패널 안 사건 ──
function ssWirePanel() {
  const panel = document.getElementById('ss-panel'), body = document.getElementById('ss-pbody'), title = document.getElementById('ss-ptitle');
  panel.querySelector('.ss-pclose').addEventListener('click', () => ssAttemptClose());
  let focusV = '';
  title.addEventListener('focus', () => { focusV = title.textContent; });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } else if (e.key === 'Escape') { e.preventDefault(); title.textContent = focusV; title.blur(); } });
  title.addEventListener('blur', () => ssCommitTitle(title.textContent));
  panel.querySelector('.ss-pedit').addEventListener('click', () => { title.focus(); const r = document.createRange(); r.selectNodeContents(title); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  // 너비 조절 (저장)
  const content = panel.querySelector('.ss-pin'), rz = panel.querySelector('.ss-presize');
  const apply = (w) => { content.style.width = Math.max(280, Math.min(Math.round(window.innerWidth * 0.98), w)) + 'px'; };
  try { const w = parseFloat(localStorage.getItem(SS_LS.panelW)); if (Number.isFinite(w)) apply(w); } catch (e) {}
  rz.addEventListener('mousedown', (e) => {
    const x0 = e.clientX, w0 = content.getBoundingClientRect().width;
    content.classList.add('rs');
    const mv = (ev) => { apply(w0 + ev.clientX - x0); ev.preventDefault(); };
    const up = () => { content.classList.remove('rs'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); try { localStorage.setItem(SS_LS.panelW, String(parseInt(content.style.width, 10) || 360)); } catch (er) {} ssRenderPanel(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (content.style.width) apply(parseInt(content.style.width, 10) || 360); });
  body.addEventListener('click', (e) => {
    const t = e.target;
    const pd = t.closest('.ss-pd');
    if (pd && !pd.disabled) { ssOpenPd(pd); return; }
    if (t.closest('[data-csv]')) {
      const sec = t.closest('.ss-logsec'), table = sec && sec.querySelector('table');
      if (!table) return;
      const ttl = (sec.querySelector('.ss-sec span') || {}).textContent || '기록';
      ssDownload(ssTableCsv(table), '투자전략-' + ttl.trim().replace(/\s+/g, '-').replace(/[^0-9A-Za-z가-힣-]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv');
      return;
    }
    const sn = t.closest('[data-savenew]');
    if (sn) { ssSaveFromBase(sn.getAttribute('data-savenew')); return; }
    const sub = t.closest('.ss-subchip[data-sub]');
    if (sub) { const c = ssFindCfg(S.editing); if (c) { c.subShown = c.subShown || {}; c.subShown[sub.getAttribute('data-sub')] = sub.classList.contains('off'); ssPersistSaved(); ssChanged(); } return; }
    const lch = t.closest('.ss-lchip[data-line]');
    if (lch) { const c = ssFindCfg(S.editing); if (c) { c.subShown = c.subShown || {}; c.subShown[lch.getAttribute('data-line')] = lch.classList.contains('off'); ssPersistSaved(); ssRenderPanel(); } return; }
    if (t.closest('#ss-ctrig')) { const pop = document.getElementById('ss-cpop'); if (pop && !pop.hidden) ssCloseColor(true); else ssOpenColor(); return; }
    const sw = t.closest('.ss-sw');
    if (sw) { const c = sw.getAttribute('data-color'); _ssColorOrig = null; ssCloseColor(false); ssCommitColor(c); return; }
    if (t.closest('#ss-cok')) { const c = ssNormHex((document.getElementById('ss-chex') || {}).value) || _ssColorOrig || ssActiveColor(); _ssColorOrig = null; ssCloseColor(false); ssCommitColor(c); return; }
    if (t.closest('#ss-cedit')) { if (S.editing) ssOpenBuilder(S.editing, false); return; }
    const cp = t.closest('.ss-cp');
    if (cp) { ssOpenCp(cp); return; }
  });
  body.addEventListener('input', (e) => {
    if (e.target.id === 'ss-chex') { const h = ssNormHex(e.target.value); if (h) ssPreviewColor(h); return; }
    if (e.target.id === 'ss-rate') {
      const own = e.target.getAttribute('data-own');
      // 0.5% 단위로 맞춤 (막대 위치는 제곱 눈금)
      const r = Math.round(ssPosToRate(+e.target.value) * 2) / 2, pos = ssRateToPos(r);
      if (pos !== +e.target.value) e.target.value = String(pos);
      const v = document.getElementById('ss-rate-v');
      if (v) v.textContent = r.toFixed(1) + '%';
      ssSetParam('invested', own, 'r', String(pos));
    }
  });
  body.addEventListener('change', (e) => {
    const h = e.target.getAttribute && e.target.getAttribute('data-hide');
    if (h === 'c' || h === 'e') { ssPanel[h === 'c' ? 'hideC' : 'hideE'] = e.target.checked; body.querySelectorAll('.ss-tw').forEach((w) => w.classList.toggle(h === 'c' ? 'hide-c' : 'hide-e', e.target.checked)); }
    const ch = e.target.getAttribute && e.target.getAttribute('data-chide');
    if (ch === 'c' || ch === 'e') { ssPanel[ch === 'c' ? 'cHideC' : 'cHideE'] = e.target.checked; body.querySelectorAll('.ss-ctw').forEach((w) => w.classList.toggle(ch === 'c' ? 'hide-c' : 'hide-e', e.target.checked)); }
  });
  // 패널 안 범위 막대를 끄는 동안은 몸통을 다시 그리지 않음 (끌기가 끊기지 않게)
  const dragOn = (e) => { if (e.target && e.target.matches && e.target.matches('#ss-pbody input[type="range"]')) ssPanel.drag = true; };
  const dragOff = () => { if (!ssPanel.drag) return; ssPanel.drag = false; ssRenderPanel(); };
  document.addEventListener('mousedown', dragOn); document.addEventListener('touchstart', dragOn, { passive: true });
  document.addEventListener('mouseup', dragOff); document.addEventListener('touchend', dragOff);
  // 기록 표 줄에 마우스 → 차트의 그 거래 표시를 강조
  body.addEventListener('mouseover', (e) => { const r = e.target.closest('tr[data-mkey]'); if (r) ssSetMarkerHover(r.getAttribute('data-mkey')); });
  body.addEventListener('mouseout', (e) => { const r = e.target.closest('tr[data-mkey]'); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) ssSetMarkerHover(null); });
  // 색 고르기: 바깥을 누르면 취소(되돌림)
  document.addEventListener('mousedown', (e) => {
    const pop = document.getElementById('ss-cpop');
    if (!pop || pop.hidden) return;
    if (e.target.closest('#ss-cpop') || e.target.closest('#ss-ctrig')) return;
    ssCloseColor(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('ss-dlg')) { ssCloseDialog(); return; }
    if (document.getElementById('ss-builder') || document.getElementById('ss-txm') || document.querySelector('.ss-pdpop') || document.querySelector('.ss-dcal')) return;
    if (ssPanel.open && !(document.activeElement && document.activeElement.id === 'ss-ptitle')) ssAttemptClose();
  });
  // 라이브러리에서 '써 보기' 뒤 강조된 선: 빈 곳을 누르면 강조를 풂
  document.addEventListener('click', (e) => {
    if (!S.editing || ssPanel.open) return;
    if (e.target.closest('#ss-panel, .ss-pills, .ss-ov, .ss-lib, button, .ss-chip, select, input, label, a')) return;
    S.editing = null;
    ssChartUpdate();
  });
}

/* ═══ 44-saved.js ═══ */
/* ── [STRATSIM] 44 저장 전략 · 사용자 전략(코드) ───────────────────────────
   왼쪽 목록의 알약(보이기·끌어 순서 바꾸기·편집·삭제) · 공유받은 전략 배너 ·
   사용자 전략 만들기 창(설명 → 프롬프트 복사 → 답 붙여넣기) · 코드 편집기(색·줄 번호) · 사용자 전략 패널 */

// ── 알약 목록 ──
function ssPillHtml(c) {
  const m = R.metrics['cfg:' + c.id] || {};
  let mt = '';
  if (m.error) mt = '<div class="ss-pm"><span class="ss-warn">실행 오류 — 편집해서 고쳐 주세요</span></div>';
  else if (m.pending && !Number.isFinite(m.cagr)) mt = '<div class="ss-pm"><span class="ss-mut">계산 중…</span></div>';
  else if (Number.isFinite(m.cagr)) {
    const rg = ssDDRange(m.ddPeak, m.ddTrough);
    mt = '<div class="ss-pm"><span><i>연평균</i> <b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b></span>'
      + (Number.isFinite(m.maxDD) ? '<span><i>낙폭</i> <b class="ss-dn">' + ssDD(m.maxDD) + '</b>' + (rg ? ' <em>' + rg + '</em>' : '') + '</span>' : '') + '</div>';
  }
  return '<div class="ss-pill' + (c.hidden ? ' off' : '') + (S.editing === c.id ? ' editing' : '') + '" data-id="' + c.id + '" draggable="true" title="눌러서 차트에 보이기/숨기기">'
    + '<div class="ss-pt"><span class="ss-ph"><button type="button" class="ss-peye" aria-label="보이기/숨기기">' + ssEye(!c.hidden) + '</button>'
    + '<span class="ss-pdrag" title="끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span></span>'
    + '<span class="ss-cdot" style="background:' + c.color + '"></span><span class="ss-pn">' + ssEsc(c.name) + '</span>'
    + (c.type === 'custom' ? '<span class="ss-pbadge" title="사용자 전략 (격리 실행)">ƒ</span>' : '')
    + '<span class="ss-pact"><button type="button" class="ss-pedit2" title="설정·기록 열기" aria-label="편집"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'
    + '<button type="button" class="ss-pdel" title="전략 지우기" aria-label="지우기"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></span></div>' + mt + '</div>';
}
function ssRenderPills() {
  const host = document.getElementById('ss-pills');
  if (!host) return;
  if (!S.saved.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  const n = S.saved.filter((c) => c._tr).length;
  host.innerHTML = (n ? '<div class="ss-shared"><span>링크로 받은 전략 ' + n + '개 — 저장하지 않으면 이 방문이 끝나면 사라집니다.</span><button type="button" class="ss-btn pri" id="ss-saveshared">' + (n > 1 ? '모두 저장' : '저장') + '</button></div>' : '')
    + '<div class="ss-plist">' + S.saved.map(ssPillHtml).join('') + '</div>';
}
function ssToggleCfg(id) { const c = ssFindCfg(id); if (!c) return; c.hidden = !c.hidden; ssPersistSaved(); ssChanged(); }
function ssDeleteCfg(id) {
  S.saved = S.saved.filter((c) => c.id !== id);
  delete SB.res[id]; delete SB.yday[id];
  if (S.editing === id) { if (ssPanel.open) ssClosePanel(); S.editing = null; }
  ssPersistSaved(); ssChanged();
}
function ssWirePills() {
  const host = document.getElementById('ss-pills');
  let fromHandle = false;
  host.addEventListener('mousedown', (e) => { fromHandle = !!e.target.closest('.ss-pdrag'); });
  host.addEventListener('dragstart', (e) => {
    const p = e.target.closest('.ss-pill');
    if (!p || !fromHandle) { e.preventDefault(); return; }
    p.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.dataset.id); } catch (er) {} }
  });
  host.addEventListener('dragover', (e) => {
    const list = host.querySelector('.ss-plist'), dr = list && list.querySelector('.ss-pill.dragging');
    if (!dr) return;
    e.preventDefault();
    let after = null, best = -Infinity;
    for (const el of list.querySelectorAll('.ss-pill:not(.dragging)')) { const b = el.getBoundingClientRect(), off = e.clientY - b.top - b.height / 2; if (off < 0 && off > best) { best = off; after = el; } }
    if (after == null) { if (list.lastElementChild !== dr) list.appendChild(dr); } else if (after !== dr) list.insertBefore(dr, after);
  });
  host.addEventListener('drop', (e) => { if (host.querySelector('.ss-pill.dragging')) e.preventDefault(); });
  host.addEventListener('dragend', () => {
    fromHandle = false;
    const list = host.querySelector('.ss-plist');
    if (!list) return;
    const dr = list.querySelector('.ss-pill.dragging');
    if (dr) dr.classList.remove('dragging');
    const order = Array.from(list.querySelectorAll('.ss-pill')).map((el) => el.dataset.id);
    const byId = new Map(S.saved.map((c) => [c.id, c])), next = [];
    for (const id of order) { const c = byId.get(id); if (c) { next.push(c); byId.delete(id); } }
    for (const c of S.saved) if (byId.has(c.id)) next.push(c);
    if (next.some((c, i) => c !== S.saved[i])) { S.saved = next; ssPersistSaved(); ssChanged(); }
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('#ss-saveshared')) { for (const c of S.saved) delete c._tr; ssPersistSaved(); ssRenderPills(); return; }
    const p = e.target.closest('.ss-pill');
    if (!p) return;
    const id = p.dataset.id;
    if (e.target.closest('.ss-pdrag')) return;
    if (e.target.closest('.ss-pedit2')) { ssOpenCfgPanel(id); return; }
    if (e.target.closest('.ss-pdel')) {
      const c = ssFindCfg(id);
      if (c) ssDialog('전략 지우기', '‘<b>' + ssEsc(c.name) + '</b>’ 을(를) 지울까요? 되돌릴 수 없습니다.', [{ t: '취소' }, { t: '지우기', danger: true, fn: () => ssDeleteCfg(id) }]);
      return;
    }
    ssToggleCfg(id);
  });
}

// ── 라이브러리 '써 보기' (30-library 가 부름) ──
// preset: { type:'9sig'|'sma', params } → 기본 엔진 저장 전략 · code → 사용자 전략(격리 실행)
function ssAddFromLibrary(entry) {
  if (!entry) return null;
  let cfg;
  if (entry.preset) cfg = { id: ssNewId(), type: entry.preset.type, name: ssUniqueName(entry.name), params: ssCleanParams(entry.preset.type, entry.preset.params), color: ssNextColor(), hidden: false };
  else if (entry.code) cfg = { id: ssNewId(), type: 'custom', name: ssUniqueName(entry.name), code: entry.code, desc: entry.rules || '', params: {}, color: ssNextColor(), hidden: false, lib: entry.n };
  else return null;
  S.saved.push(cfg);
  ssPersistSaved();
  S.editing = cfg.id;            // 패널은 열지 않고 선만 강조 (빈 곳을 누르면 풀림)
  ssChanged();
  setTimeout(() => ssFlashSaved(cfg.id), 30);
  return cfg.id;
}

// ── 사용자 전략: 만들기 창 ──
const SB2 = { id: null, phase: 'describe', isNew: false, beautify: null };
function ssCreateCustom() {
  const cfg = { id: ssNewId(), type: 'custom', name: ssUniqueName('사용자 전략'), code: '', desc: '', params: {}, color: ssNextColor(), hidden: false };
  S.saved.push(cfg);
  S.editing = cfg.id;
  ssPersistSaved();
  ssChanged();
  ssOpenBuilder(cfg.id, true);
}
function ssOpenBuilder(id, isNew) {
  const c = ssFindCfg(id);
  if (!c) return;
  SB2.id = id; SB2.isNew = !!isNew;
  SB2.phase = isNew || !c.code ? 'describe' : 'generate';
  ssDrawBuilder();
}
function ssCloseBuilder(cancelled) {
  const m = document.getElementById('ss-builder');
  if (m) m.remove();
  const id = SB2.id, isNew = SB2.isNew;
  SB2.id = null; SB2.isNew = false;
  if (cancelled && isNew) { const c = ssFindCfg(id); if (c && !c.code) ssDeleteCfg(id); }
}
function ssDrawBuilder() {
  const c = ssFindCfg(SB2.id);
  if (!c) return;
  let m = document.getElementById('ss-builder');
  if (!m) { m = document.createElement('div'); m.className = 'ss-ov'; m.id = 'ss-builder'; document.body.appendChild(m); }
  const err = SB.res[c.id] && SB.res[c.id].error;
  if (SB2.phase === 'describe') {
    m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">전략 설명하기</div>'
      + '<div class="ss-wip">⚠ 사용자 전략 기능은 아직 다듬는 중이라 결과가 바뀔 수 있습니다.</div>'
      + '<div class="ss-help">내 전략을 말로 최대한 자세히 적어 주세요. 쓸 수 있는 종목은 <b>TQQQ</b>·<b>QLD</b>·<b>QQQ</b>·<b>SPY</b>·<b>SSO</b>·<b>SPXL</b>·<b>SQQQ</b>(나스닥 −3배 인버스)와 금융 여건 지수 <b>NFCI</b> 입니다 — 사고팔 조건, 기준값, 매달 적립금을 어떻게 다룰지까지.</div>'
      + '<textarea id="ss-bdesc" class="ss-ta" placeholder="예: TQQQ 를 들고 있다가, 매달 말 QQQ 종가가 200일 이동평균 아래면 전부 현금으로 바꾸고, 다시 위로 올라오면 TQQQ 를 삽니다. 매달 적립금은 지금 들고 있는 쪽에 더합니다.">' + ssEsc(c.desc || '') + '</textarea>'
      + '<div class="ss-mact"><button type="button" class="ss-btn" data-b="cancel">취소</button><button type="button" class="ss-btn pri" data-b="next">다음 →</button></div></div>';
  } else {
    m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">코드 만들기 · 붙여넣기</div>'
      + '<div class="ss-help">아래 단추로 프롬프트를 복사해 <b>ChatGPT</b> 나 <b>Claude</b> 에 붙여 넣어 보내세요. 돌아온 답(코드)을 그대로 복사해 아래 칸에 붙여 넣으면 됩니다. 코드는 이 페이지와 분리된 격리 공간에서만 실행됩니다.</div>'
      + '<button type="button" class="ss-btn ss-copyp" data-b="copy">프롬프트 복사 (ChatGPT · Claude 용)</button>'
      + '<div class="ss-blabel">답을 여기에 붙여 넣으세요</div>'
      + (err && c.code ? '<div class="ss-err"><b>실행하지 못했습니다:</b> ' + ssEsc(err) + '</div>' : '')
      + '<div class="ss-code"><div class="ss-cgut" aria-hidden="true"></div><div class="ss-cscroll"><pre class="ss-chl" aria-hidden="true"><code></code></pre><textarea id="ss-bcode" class="ss-cin" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="전략 코드를 여기에 붙여 넣으세요…">' + ssEsc(c.code || '') + '</textarea></div></div>'
      + '<div class="ss-mact"><button type="button" class="ss-btn" data-b="back">← 뒤로</button><button type="button" class="ss-btn pri" data-b="apply">적용하고 보기</button></div></div>';
  }
  const ta = m.querySelector('#ss-bcode');
  if (ta) ssCodeEditor(ta);
  const f = m.querySelector('textarea');
  if (f) f.focus();
}
document.addEventListener('click', (e) => {
  const m = document.getElementById('ss-builder');
  if (!m || !m.contains(e.target)) return;
  const b = e.target.closest('[data-b]');
  const c = ssFindCfg(SB2.id);
  if (!b || !c) return;
  const act = b.getAttribute('data-b');
  if (act === 'cancel') { ssCloseBuilder(true); return; }
  if (act === 'next') { const d = document.getElementById('ss-bdesc'); c.desc = d ? d.value : ''; ssPersistSaved(); SB2.phase = 'generate'; ssDrawBuilder(); return; }
  if (act === 'back') { const t = document.getElementById('ss-bcode'); if (t) { c.code = t.value; ssPersistSaved(); } SB2.phase = 'describe'; ssDrawBuilder(); return; }
  if (act === 'copy') {
    const txt = ssBuildPrompt(c.desc);
    const done = () => { b.textContent = '복사됨 ✓ — ChatGPT · Claude 에 붙여 넣으세요'; b.classList.add('flash'); setTimeout(() => { if (b.isConnected) { b.textContent = '프롬프트 복사 (ChatGPT · Claude 용)'; b.classList.remove('flash'); } }, 2400); };
    ssCopy(txt, done);
    return;
  }
  if (act === 'apply') {
    const t = document.getElementById('ss-bcode');
    if (!t) return;
    c.code = t.value;
    delete SB.res[c.id];
    ssPersistSaved();
    const id = c.id;
    ssCloseBuilder(false);
    ssOpenCfgPanel(id);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ss-builder')) { e.stopImmediatePropagation(); ssCloseBuilder(true); } }, true);
function ssCopy(text, done) {
  const legacy = () => {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) {} t.remove();
    if (ok) done(); else window.prompt('아래 내용을 복사해 주세요', text);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, legacy); else legacy();
}

// ── 코드 편집기 (글자색 · 줄 번호 · 붙여넣기/포커스 아웃 때 정리) ──
const SS_KW = new Set('const let var function return if else for while do switch case break continue new typeof instanceof in of delete void this null true false undefined class extends super import export default try catch finally throw async await yield'.split(' '));
function ssHighlight(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', i = 0;
  const n = src.length;
  const push = (cls, t) => { out += cls ? '<span class="tk-' + cls + '">' + esc(t) + '</span>' : esc(t); };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; } j = Math.min(j + 1, n); push('str', src.slice(i, j)); i = j; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) { let j = i + 1; while (j < n && /[0-9a-fA-FxXeE._+-]/.test(src[j])) j++; push('num', src.slice(i, j)); i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; const w = src.slice(i, j); let k = j; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++; push(SS_KW.has(w) ? 'kw' : src[k] === '(' ? 'fn' : /[A-Z]/.test(w[0]) ? 'cls' : null, w); i = j; continue; }
    if (/[{}()[\].,;]/.test(c)) { push('pn', c); i++; continue; }
    if (/[+\-*/%=<>!&|^~?:]/.test(c)) { push('op', c); i++; continue; }
    push(null, c); i++;
  }
  return out;
}
function ssLoadBeautify() {
  if (SB2.beautify) return SB2.beautify;
  SB2.beautify = new Promise((res) => {
    if (window.js_beautify) { res(window.js_beautify); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/1.15.1/beautify.min.js';
    s.onload = () => res(window.js_beautify || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return SB2.beautify;
}
function ssCodeEditor(ta) {
  const scroll = ta.parentElement, pre = scroll.querySelector('.ss-chl'), code = pre.querySelector('code'), gut = scroll.parentElement.querySelector('.ss-cgut');
  let lines = -1;
  const gutter = () => { const n = ta.value.split('\n').length; if (n === lines) return; lines = n; let g = ''; for (let k = 1; k <= n; k++) g += k + '\n'; gut.textContent = g; };
  const paint = () => { code.innerHTML = ssHighlight(ta.value) + '\n'; gutter(); };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  const format = () => {
    const v = ta.value.trim();
    if (!v) { paint(); return; }
    ssLoadBeautify().then((bf) => {
      if (bf) { try { const f = bf(ta.value.trim(), { indent_size: 2, brace_style: 'collapse,preserve-inline', space_in_empty_paren: true, end_with_newline: false }); if (f && f !== ta.value) ta.value = f; } catch (e) {} }
      paint(); sync();
    });
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  ta.addEventListener('paste', () => setTimeout(format, 0));
  ta.addEventListener('blur', format);
  if (ta.value.trim()) format(); else paint();
  sync();
}

// ── 사용자 전략 패널 ──
const SS_MINI = { W: 320, H: 148, padL: 6, padT: 8, padB: 16 };
const SS_MINI_COLORS = ['#e11d48', '#0284c7', '#059669', '#a16207', '#7c3aed'];
const ssLineColor = (c, i) => (i === 0 ? c.color : SS_MINI_COLORS[(i - 1) % SS_MINI_COLORS.length]);
const ssLineShown = (c, key) => ((c.subShown || {})[key]) !== false;
let ssMiniData = null;
function ssMiniFmt(v) { return v >= 1000 ? ssMoney(v) : '$' + (v < 10 ? v.toFixed(2) : String(Math.round(v))); }
function ssMiniChart(cfg, lines, log, cw) {
  const series = [];
  lines.forEach((ln, i) => {
    if (!ssLineShown(cfg, ln.key)) return;
    const pts = [];
    for (const r of log) if (r && r.date != null && typeof r[ln.key] === 'number' && isFinite(r[ln.key]) && r[ln.key] > 0) pts.push({ t: Date.parse(r.date), v: r[ln.key], d: String(r.date) });
    if (pts.length > 1) series.push({ label: ln.label, color: ssLineColor(cfg, i), pts });
  });
  ssMiniData = null;
  if (!series.length) return '';
  const { W, H, padL, padT, padB } = SS_MINI, k = Math.max(1, (cw || W) / W);
  const vt = (v) => (v >= 1000 ? ssMoney(v) : '$' + v.toFixed(2));
  const vcw = Math.max(...series.map((s) => vt(s.pts[s.pts.length - 1].v).length)) * (9 / k) * 0.6;
  const ncw = Math.max(...series.map((s) => s.label.length)) * (7 / k) * 0.9;
  const padR = Math.min(4 / k + vcw + 4 / k + ncw + 2 / k, 0.45 * W);
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.pts) { if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  if (!(t1 > t0) || !(hi > 0)) return '';
  const l0 = Math.log10(lo), l1 = Math.log10(hi), lp = Math.max((l1 - l0) * 0.05, 0.01), yLo = l0 - lp, yHi = l1 + lp;
  const xAt = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const yAt = (v) => padT + (yHi - Math.log10(v)) / (yHi - yLo) * (H - padT - padB);
  ssMiniData = { series, t0, t1, yLo, yHi, W, H, padR, k };
  const T = ssTheme(), halo = T.light ? 'rgba(255,255,255,0.95)' : 'rgba(23,23,28,0.95)', mute = T.text3;
  let grid = '';
  for (let g = 0; g < 3; g++) {
    const lv = Math.pow(10, yLo + (yHi - yLo) * (0.15 + 0.35 * g)), y = yAt(lv).toFixed(1);
    grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + T.grid + '" stroke-width="0.5"/><text x="' + (padL + 1) + '" y="' + (+y - 2).toFixed(1) + '" font-family="DM Mono" font-size="' + (8 / k).toFixed(2) + '" fill="' + mute + '" stroke="' + halo + '" stroke-width="' + (2 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + ssMiniFmt(lv) + '</text>';
  }
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0) / 6)), half = 10 / k;
  let xa = '';
  for (let y = y0 + 1; y <= y1; y += step) { const t = Date.parse(y + '-01-01'); if (t <= t0 || t >= t1) continue; xa += '<text x="' + Math.max(half, Math.min(W - half, xAt(t))).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-family="DM Mono" font-size="' + (8 / k).toFixed(2) + '" fill="' + mute + '">' + y + '</text>'; }
  let paths = '';
  const ends = [];
  for (const s of series) {
    let d = '';
    for (const p of s.pts) d += (d ? 'L' : 'M') + xAt(p.t).toFixed(1) + ',' + yAt(p.v).toFixed(1);
    paths += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="0.45"/>';
    const last = s.pts[s.pts.length - 1];
    ends.push({ y: yAt(last.v), v: last.v, color: s.color, name: s.label });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 10 / k) ends[i].y = ends[i - 1].y + 10 / k;
  let el = '';
  for (const e of ends) {
    el += '<text x="' + (W - padR + 4 / k).toFixed(1) + '" y="' + (e.y + 3 / k).toFixed(1) + '" font-family="DM Mono" font-size="' + (9 / k).toFixed(2) + '" font-weight="600" fill="' + e.color + '" stroke="' + halo + '" stroke-width="' + (2.5 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + vt(e.v) + '</text>'
      + '<text x="' + (W - padR + 8 / k + vcw).toFixed(1) + '" y="' + (e.y + 3 / k).toFixed(1) + '" font-family="Noto Sans KR" font-size="' + (7 / k).toFixed(2) + '" font-weight="600" fill="' + e.color + '" stroke="' + halo + '" stroke-width="' + (2 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + ssEsc(e.name) + '</text>';
  }
  return '<svg class="ss-mini" viewBox="0 0 ' + W + ' ' + H + '">' + grid + paths + el + xa + '</svg>';
}
// 신호 차트 마우스: 십자선 + 값 · 끌면 구간 %
(function () {
  let drag = null, active = false;
  const tipEl = () => { let t = document.getElementById('ss-minitip'); if (!t) { t = document.createElement('div'); t.id = 'ss-minitip'; t.hidden = true; document.body.appendChild(t); } return t; };
  const clear = () => { const g = document.querySelector('.ss-mini .mh'); if (g) g.remove(); const t = document.getElementById('ss-minitip'); if (t) t.hidden = true; active = false; };
  const nearest = (pts, t) => { let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; } return t - pts[lo].t <= pts[hi].t - t ? pts[lo] : pts[hi]; };
  const anchor = (svg, e, d) => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / (r.width / d.W), f = Math.max(0, Math.min(1, (x - SS_MINI.padL) / (d.W - SS_MINI.padL - d.padR))); return nearest(d.series[0].pts, d.t0 + f * (d.t1 - d.t0)); };
  const xAt = (d, t) => SS_MINI.padL + (t - d.t0) / (d.t1 - d.t0) * (d.W - SS_MINI.padL - d.padR);
  const place = (tip, e) => { tip.hidden = false; let l = e.clientX + 14, t = e.clientY + 12; if (l + tip.offsetWidth > window.innerWidth - 8) l = e.clientX - tip.offsetWidth - 12; if (t + tip.offsetHeight > window.innerHeight - 8) t = e.clientY - tip.offsetHeight - 10; tip.style.left = l + 'px'; tip.style.top = t + 'px'; };
  const exact = (v) => (v >= 1000 ? ssMoney(v) : '$' + v.toFixed(2));
  document.addEventListener('mousedown', (e) => { const svg = e.target.closest && e.target.closest('.ss-mini'); if (!svg || !ssMiniData || !ssMiniData.series.length) return; drag = anchor(svg, e, ssMiniData); e.preventDefault(); });
  document.addEventListener('mouseup', () => { if (!drag) return; drag = null; clear(); });
  document.addEventListener('mousemove', (e) => {
    const svg = e.target.closest && e.target.closest('.ss-mini');
    if (!svg) { if (active && !drag) clear(); return; }
    const d = ssMiniData;
    if (!d || !d.series.length) return;
    const M = SS_MINI, yAt = (v) => M.padT + (d.yHi - Math.log10(v)) / (d.yHi - d.yLo) * (d.H - M.padT - M.padB);
    const a = anchor(svg, e, d);
    let g = svg.querySelector('.mh');
    if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'mh'); svg.appendChild(g); }
    const tip = tipEl(), line = 'rgba(122,122,166,0.6)';
    if (drag && drag.t !== a.t) {
      let lo = drag, hi = a;
      if (hi.t < lo.t) { lo = a; hi = drag; }
      const xA = xAt(d, lo.t), xB = xAt(d, hi.t);
      const sp = d.series.map((s) => Object.assign({}, s, { p0: nearest(s.pts, lo.t), p1: nearest(s.pts, hi.t) }));
      g.innerHTML = '<rect x="' + xA.toFixed(1) + '" y="' + M.padT + '" width="' + (xB - xA).toFixed(1) + '" height="' + (d.H - M.padT - M.padB) + '" fill="rgba(49,130,246,0.10)"/>'
        + sp.map((s) => { const y0 = yAt(s.p0.v).toFixed(1), y1 = yAt(s.p1.v).toFixed(1); return '<line x1="' + xA.toFixed(1) + '" y1="' + y0 + '" x2="' + xB.toFixed(1) + '" y2="' + y1 + '" stroke="' + s.color + '" stroke-width="0.5" stroke-dasharray="2,1.5"/><circle cx="' + xA.toFixed(1) + '" cy="' + y0 + '" r="0.9" fill="' + s.color + '"/><circle cx="' + xB.toFixed(1) + '" cy="' + y1 + '" r="0.9" fill="' + s.color + '"/>'; }).join('');
      tip.innerHTML = '<div class="d">' + ssDate(lo.d) + ' – ' + ssDate(hi.d) + '</div>' + sp.map((s) => { const p = s.p0.v > 0 ? (s.p1.v / s.p0.v - 1) * 100 : 0; return '<div class="r"><i style="background:' + s.color + '"></i>' + ssEsc(s.label) + '<b class="' + (p >= 0 ? 'ss-up' : 'ss-dn') + '">' + (p >= 0 ? '+' : '') + p.toFixed(1) + '%</b><span>' + exact(s.p0.v) + ' → ' + exact(s.p1.v) + '</span></div>'; }).join('');
      place(tip, e); active = true;
      return;
    }
    const cx = xAt(d, a.t), hits = d.series.map((s) => Object.assign({}, s, { pt: nearest(s.pts, a.t) }));
    g.innerHTML = '<line x1="' + cx.toFixed(1) + '" y1="' + M.padT + '" x2="' + cx.toFixed(1) + '" y2="' + (d.H - M.padB) + '" stroke="' + line + '" stroke-width="0.3" stroke-dasharray="2,2"/>' + hits.map((h) => '<circle cx="' + cx.toFixed(1) + '" cy="' + yAt(h.pt.v).toFixed(1) + '" r="0.6" fill="' + h.color + '"/>').join('');
    tip.innerHTML = '<div class="d">' + ssDate(a.d) + '</div>' + hits.map((h) => '<div class="r"><i style="background:' + h.color + '"></i>' + ssEsc(h.label) + '<b>' + ssMiniFmt(h.pt.v) + '</b></div>').join('');
    place(tip, e); active = true;
  });
})();

// 로그 칸 서식: 키 이름으로 (price·sma·median… = 가격 · share = 주수 · pct = % · 나머지 숫자 = $)
const SS_CLOG = {
  date: ['날짜', '이 줄이 있었던 거래일.\n\n전략이 무언가를 적은 날만 나옵니다 — 거래·적립·주기적 평가.'],
  action: ['동작', '이날 전략이 한 일 — 매수·매도·갈아타기(한 종목에서 다른 종목으로)·비중 조정·나눠 사기 한 조각·매달 적립·그냥 평가.\n\n거래한 줄은 차트 선 위에 표시로 그려지고, 줄에 마우스를 올리면 그 표시가 밝아집니다.\n\n괄호 속 (%) 는 직전 줄 이후의 수익·손실(이 줄의 적립금은 뺌)입니다.'],
  note: ['메모', '전략이 이 줄에 단 설명 — 보통 규칙이 왜 작동했는지.'],
  held: ['보유', '이 줄 직후 들고 있던 것. CASH 는 시장 밖(현금).'],
  price: ['가격', '보유 칸 종목의 그날 종가. 현금 줄은 비어 있음. 가격 × 주수 = 보유 평가액.'],
  shares: ['주수', '이 줄 뒤 들고 있던 종목의 주수. 전부 현금이면 0.'],
  holdingsValue: ['보유 평가액', '현금을 뺀, 들고 있는 모든 것의 금액.'],
  stockVal: ['보유 평가액', '현금을 뺀, 들고 있는 모든 것의 금액.'],
  cash: ['현금', '이 줄 뒤 현금으로 있는 금액.'],
  value: ['합계', '그날 전체 평가액: 보유 + 현금. 차트의 이 전략 선이 그리는 값입니다.'],
  invested: ['넣은 돈', '이 날까지 넣은 돈의 합 — 시작 금액 + 지금까지의 적립금(출금은 뺌).\n\n합계 − 넣은 돈 = 수익.'],
  contributed: ['새 돈', '이 줄에 새로 들어온 돈. 출금이면 음수, 없으면 빈칸.'],
  fee: ['수수료', '이 줄의 거래에서 낸 비용(전략이 계산할 때).'],
};
const SS_CLOG_ORDER = ['date', 'action', 'note', 'held', 'price', 'shares', 'holdingsValue', 'stockVal', 'cash', 'value', 'invested', 'contributed', 'fee'];
function ssCLogCell(k, v) {
  if (v == null || v === '') return '';
  const lk = String(k).toLowerCase();
  if (lk === 'date') return ssLogDate(String(v));
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    if (/price|sma|ema|median|avg|mean/.test(lk)) return v > 0 ? ssLogPrice(v) : '—';
    if (lk.includes('share') || lk.includes('unit') || lk.includes('qty')) return ssLogShares(v);
    if (lk.includes('pct') || lk.includes('percent')) return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
    if ((lk.includes('contrib') || lk.includes('deposit') || lk === 'fee') && v === 0) return '';
    return ssMoney(Math.round(v));
  }
  return ssEsc(v);
}
function ssCLogHtml(log, columns) {
  if (!log || !log.length) return '';
  const meta = {};
  for (const k in SS_CLOG) meta[k] = { label: SS_CLOG[k][0], tip: SS_CLOG[k][1] };
  const declared = [];
  for (const c of columns || []) { if (!c || !c.key) continue; const b = meta[c.key] || {}; meta[c.key] = { label: c.label || b.label || null, tip: c.tip || b.tip || null }; declared.push(c.key); }
  const present = [], seen = new Set();
  for (const r of log) { if (!r) continue; for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); present.push(k); } }
  const rank = (k) => { const i = SS_CLOG_ORDER.indexOf(k); if (i >= 0) return i; const j = declared.indexOf(k); return j >= 0 ? 100 + j : 200 + present.indexOf(k); };
  const keys = present.slice().sort((a, b) => rank(a) - rank(b));
  const AC = { sma: 'SMA', ema: 'EMA', rsi: 'RSI', atr: 'ATR', macd: 'MACD', dd: 'DD', pct: '%', qqq: 'QQQ', spy: 'SPY', tqqq: 'TQQQ' };
  const title = (k) => (meta[k] && meta[k].label) || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_]+/).map((w) => AC[w.toLowerCase()] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const th = (lab, tip) => '<th>' + ssEsc(lab) + ssTipI(tip) + '</th>';
  const head = th('#', '줄 번호 — 처음 적힌 줄이 0 이고 하나씩 늘어, 마지막 번호가 이 기간에 적힌 사건 수입니다.') + keys.map((k) => th(title(k), meta[k] && meta[k].tip)).join('');
  const AK = { buy: 'ss-up', sell: 'ss-dn', switch: 'ss-sw2', rebalance: 'ss-rb', ease: 'ss-up', contribution: 'ss-hold', start: 'ss-hold', end: 'ss-hold', hold: 'ss-hold' };
  let nc = 0, ne = 0;
  const body = log.map((row, i) => {
    const kind = ssCustomKind(row && row.action);
    if (kind === 'contribution') nc++;
    if (kind === 'ease') ne++;
    const mk = !!(SS_CEVT[kind] && +((row || {}).value) > 0);
    const cls = mk ? 'mk' : kind === 'contribution' ? 'rc' : kind === 'ease' ? 'rd' : '';
    const cells = keys.map((k) => {
      if (k !== 'action') return '<td>' + ssCLogCell(k, row ? row[k] : null) + '</td>';
      const g = ssCustomGain(log, i);
      return '<td class="' + (AK[kind] || 'ss-hold') + '">' + ssEsc(ssCustomLabel(row && row.action)) + (g == null ? '' : ' <span class="' + (g >= 0 ? 'ss-up' : 'ss-dn') + '">(' + (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(1) + '%)</span>') + '</td>';
    }).join('');
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + (mk ? ' data-mkey="' + i + '"' : '') + '><td>' + i + '</td>' + cells + '</tr>';
  }).join('');
  const hold = keys.includes('held') ? ssHoldTime(log, (r) => String((r && r.held) || '').toUpperCase()) : '';
  const tg = (nc ? '<label class="ss-chk"><input type="checkbox" data-chide="c"' + (ssPanel.cHideC ? ' checked' : '') + '> 매달 적립 줄 숨기기 (' + nc + ')</label>' : '') + (ne ? '<label class="ss-chk"><input type="checkbox" data-chide="e"' + (ssPanel.cHideE ? ' checked' : '') + '> 나눠 사기 조각 숨기기 (' + ne + ')</label>' : '');
  return '<div class="ss-logsec">' + ssLogHead('거래 기록 (' + log.length + '줄)', 18) + '<div class="ss-chks">' + tg + '</div><div class="ss-tw ss-ctw' + (ssPanel.cHideC ? ' hide-c' : '') + (ssPanel.cHideE ? ' hide-e' : '') + '"><table class="ss-clog"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' + hold + '</div>';
}
function ssCSignalsHtml(sig, asOf) {
  if (!sig) return '';
  const tone = (t) => { const v = String(t || '').toLowerCase(); return v === 'good' || v === 'positive' || v === 'up' ? 'ss-up' : v === 'bad' || v === 'negative' || v === 'down' || v === 'warn' ? 'ss-dn' : ''; };
  let h = '';
  const cards = (sig.cards || []).filter((c) => c && c.label);
  if (cards.length) {
    const a = sig.asOf || asOf;
    h += '<div class="ss-sec" style="margin-top:24px"><span>신호 지표' + (a ? ' <i class="ss-asof">· ' + ssEsc(ssDate(a)) + ' 기준</i>' : '') + '</span></div><div class="ss-stats">'
      + cards.map((c) => ssStatCard(ssEsc(c.label), SS_ICON[c.icon] ? c.icon : 'activity', ssEsc(c.value != null ? c.value : '—'), tone(c.tone), c.sub ? ssEsc(c.sub) : '', c.tip || '', c.delta && c.delta.text ? { text: ssEsc(c.delta.text), tone: tone(c.delta.tone) } : null)).join('') + '</div>';
  }
  const d = sig.decision;
  if (d && (d.action || (d.reasons && d.reasons.length))) {
    const cls = tone(d.tone) === 'ss-up' ? 'buy' : tone(d.tone) === 'ss-dn' ? 'cash' : 'hold';
    h += ssDecisionHtml(d.action || '—', cls, d.note, (d.reasons || []).filter((r) => r && r.name).map((r) => ({ name: r.name, val: r.val, tag: r.tag, lean: ['buy', 'out', 'cash', 'hold'].indexOf(String(r.lean || '').toLowerCase()) >= 0 ? String(r.lean).toLowerCase() : 'hold' })));
  }
  return h;
}
// 사용자 전략 손잡이 선택지 → [{ value, label }]
function ssCParamOpts(sp) {
  if (Array.isArray(sp.options) && sp.options.length) return sp.options.map((o) => (o && typeof o === 'object' ? { value: o.value, label: o.label != null ? o.label : o.value } : { value: o, label: o }));
  if (sp.type === 'bool' || sp.type === 'boolean') return [{ value: true, label: '예' }, { value: false, label: '아니오' }];
  if ('min' in sp || 'max' in sp || sp.type === 'number') {
    let min = Number(sp.min), max = Number(sp.max), step = Number(sp.step);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = min + 10;
    if (!Number.isFinite(step) || step <= 0) step = (max - min) / 10 || 1;
    let n = Math.floor((max - min) / step) + 1;
    if (n > 24) { step = (max - min) / 23; n = 24; }
    if (n < 1) n = 1;
    const out = [];
    for (let i = 0; i < n; i++) { const v = +(min + i * step).toFixed(6); out.push({ value: v, label: String(v) }); }
    return out;
  }
  return [{ value: sp.default, label: String(sp.default) }];
}
const ssCParamVal = (cfg, sp) => ssCoerce(sp, cfg.params && sp.id in cfg.params ? cfg.params[sp.id] : sp.default);
function ssCParamLabel(sp, v) { const m = ssCParamOpts(sp).find((o) => String(o.value) === String(v)); return m ? String(m.label) : String(v); }
function ssCustomPanelHtml(cfg, m, cw) {
  const res = SB.res[cfg.id], err = res && res.error, schema = (res && res.schema) || [];
  let h = '<div class="ss-wip">⚠ 사용자 전략 기능은 아직 다듬는 중이라 결과가 바뀔 수 있습니다.</div>' + ssColorBar()
    + '<div class="ss-note2">전략 코드가 읽을 수 있는 종목: <code>tqqq</code> <code>qld</code> <code>qqq</code> <code>spy</code> <code>sso</code> <code>spxl</code> <code>sqqq</code>(일별 종가) + <code>nfci</code>(금융 여건 지수). 아무 종목이나 규칙에 쓸 수 있습니다.</div>'
    + '<button type="button" id="ss-cedit" class="ss-btn ss-ceditb">전략 고치기</button>';
  if (cfg.desc) h += '<div class="ss-desc">' + ssEsc(cfg.desc) + '</div>';
  if (err) h += '<div class="ss-err"><b>실행하지 못했습니다:</b> ' + ssEsc(err) + ' <span class="ss-mut">— \'전략 고치기\'로 코드를 고쳐 주세요.</span></div>';
  else if (!cfg.code) h += '<div class="ss-mut" style="margin:10px 0">아직 코드가 없습니다 — \'전략 고치기\'를 눌러 만들어 주세요.</div>';
  else if (!res) h += '<div class="ss-mut" style="margin:10px 0">계산 중…</div>';
  if (!err && m && Number.isFinite(m.cagr) && res) {
    const rg = ssDDRange(m.ddPeak, m.ddTrough);
    h += '<div class="ss-cstats"><div><span>연평균</span><b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b></div><div><span>최대 낙폭</span><b class="ss-dn">' + (Number.isFinite(m.maxDD) ? ssDD(m.maxDD) : '—') + '</b>' + (rg ? '<em>' + rg + '</em>' : '') + '</div><div><span>끝 금액</span><b>' + ssMoney(m.end || 0) + '</b></div></div>';
  }
  if (schema.length) {
    h += '<div class="ss-sec" style="margin-top:14px"><span>설정</span></div><div class="ss-cparams">' + schema.map((sp) => {
      if (!sp) return '';
      if (sp.id == null) return sp.section ? '<div class="ss-cpg">' + ssEsc(sp.section) + '</div>' : '';
      return '<div class="ss-cpr"><label>' + ssEsc(sp.label || sp.id) + '</label><button type="button" class="ss-pd ss-cp" data-cp="' + ssEsc(String(sp.id)) + '"><span>' + ssEsc(ssCParamLabel(sp, ssCParamVal(cfg, sp))) + '</span><i>▾</i></button></div>';
    }).join('') + '</div>';
  }
  const lines = (res && res.lines) || null, log = R.customLogs[cfg.id] || [];
  if (lines && lines.length) {
    h += '<div class="ss-sec" style="margin-top:14px"><span>신호 차트</span></div><div class="ss-subchips">' + lines.map((ln, i) => { const on = ssLineShown(cfg, ln.key); return '<div class="ss-chip ss-lchip' + (on ? '' : ' off') + '" data-line="' + ssEsc(ln.key) + '" role="button" tabindex="0">' + ssEye(on) + '<span class="ss-lsw" style="background:' + ssLineColor(cfg, i) + '"></span><span class="ss-cname">' + ssEsc(ln.label) + '</span></div>'; }).join('') + '</div>'
      + ssMiniChart(cfg, lines, log, cw);
  }
  h += ssCSignalsHtml(res && res.signals, log.length ? log[log.length - 1].date : null);
  h += ssCLogHtml(log, res && res.columns);
  return h;
}
// 사용자 전략 손잡이 미리보기 (선택지마다 격리 실행 → 끝 금액 막대)
function ssCloseCp() { if (ssPd && ssPd.cp) ssClosePd(); }
function ssOpenCp(trig) {
  if (ssPd && ssPd.trig === trig) { ssClosePd(); return; }
  const cfg = ssFindCfg(S.editing);
  const res = cfg && SB.res[cfg.id];
  const sp = res && (res.schema || []).find((x) => x && String(x.id) === trig.getAttribute('data-cp'));
  if (!cfg || !sp) return;
  ssClosePd();
  const opts = ssCParamOpts(sp), cur = ssCParamVal(cfg, sp);
  const curIdx = opts.findIndex((o) => String(o.value) === String(cur));
  const pop = ssPdShell(trig, opts.map((o) => String(o.label)), curIdx, (i) => {
    const o = opts[i];
    cfg.params = cfg.params || {};
    cfg.params[sp.id] = typeof o.value === 'boolean' ? o.value : String(o.value);
    ssPersistSaved(); ssChanged();
  });
  ssPd.cp = true;
  const ctx = R.ctx;
  if (!ctx || !cfg.code) return;
  const g = ssCustomGlobals(ctx);
  ssClearPreview();
  const fin = new Array(opts.length).fill(null);
  const draw = () => { if (ssPd && ssPd.pop === pop) ssPdFill(pop, fin, 'one'); };
  const ck = JSON.stringify(g.contributions);
  opts.forEach((o, i) => {
    const ov = {}; ov[sp.id] = typeof o.value === 'boolean' ? o.value : String(o.value);
    const merged = Object.assign({}, cfg.params || {}, ov);
    const key = [cfg.code, JSON.stringify(merged), g.startIdx, g.endIdx, g.initial, g.monthly, g.annualRaise, g.entryDate || '', g.exitDate || '', ck, g.weeklyDisplay ? 1 : 0].join('|');
    if (SB.pcache[key] != null) { fin[i] = SB.pcache[key]; return; }
    ssPreviewRun(cfg.code, merged, g, (msg) => {
      let fv = 0;
      if (msg && msg.log) for (let k = msg.log.length - 1; k >= 0; k--) { const v = msg.log[k].value; if (typeof v === 'number' && isFinite(v)) { fv = v; break; } }
      SB.pcache[key] = fv; fin[i] = fv; draw();
    });
  });
  draw();
}

/* ═══ 45-period.js ═══ */
/* ── [STRATSIM] 45 기간 (진입·청산) ────────────────────────────────────────
   이중 슬라이더(최근 분기에 해상도를 몰아주는 로그 휨) · 손잡이 위 라벨 · ◀▶ 재생 · 화살표 키 · 정확한 날짜 달력 */

const ssPeriodUI = {
  el: null, fill: null, th: [], max: 0, playT: null, playDir: 0,
  init(root) {
    this.el = root.querySelector('#ss-range');
    this.fill = this.el.querySelector('.ss-rfill');
    this.th = [this.el.querySelector('[data-h="e"]'), this.el.querySelector('[data-h="x"]')];
    this.max = DS.q.length - 1;
    const el = this.el;
    // 손잡이 끌기 (진입 ≤ 청산 − 1)
    this.th.forEach((t, k) => {
      const start = (ev) => {
        ev.preventDefault();
        const rect = el.getBoundingClientRect();
        const move = (e2) => {
          const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
          let v = this.toVal((cx - rect.left) / rect.width * 100);
          if (k === 0) S.e = Math.max(0, Math.min(v, S.x - 1)); else S.x = Math.min(this.max, Math.max(v, S.e + 1));
          this.layout();
          this.changed(k === 0 ? 'e' : 'x');
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
      };
      t.addEventListener('mousedown', start);
      t.addEventListener('touchstart', start, { passive: false });
    });
    // 채운 막대 끌기 = 둘이 같이 (폭 유지 · % 로 따라감)
    const fillStart = (ev) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect(), x0 = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const span = S.x - S.e, p0 = this.toPct(S.e);
      const move = (e2) => {
        const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
        let ne = this.toVal(p0 + (cx - x0) / rect.width * 100), nx = ne + span;
        if (ne < 0) { ne = 0; nx = span; }
        if (nx > this.max) { nx = this.max; ne = this.max - span; }
        S.e = ne; S.x = nx;
        this.layout(); this.changed();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    };
    this.fill.addEventListener('mousedown', fillStart);
    this.fill.addEventListener('touchstart', fillStart, { passive: false });
    // 트랙 누르기 = 가까운 손잡이를 그리로
    el.querySelector('.ss-rtrack').addEventListener('click', (ev) => {
      const rect = el.getBoundingClientRect(), v = this.toVal((ev.clientX - rect.left) / rect.width * 100);
      let side;
      if (Math.abs(v - S.e) < Math.abs(v - S.x)) { S.e = Math.min(v, S.x - 1); side = 'e'; } else { S.x = Math.max(v, S.e + 1); side = 'x'; }
      this.layout(); this.changed(side);
    });
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', (ev) => { if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return; ev.preventDefault(); this.step(ev.key === 'ArrowRight' ? 1 : -1); });
    el.addEventListener('mousedown', () => el.focus());
    const pl = root.querySelector('#ss-play-l'), pr = root.querySelector('#ss-play-r');
    pl.addEventListener('click', () => (this.playDir === -1 ? this.stop() : this.play(-1)));
    pr.addEventListener('click', () => (this.playDir === 1 ? this.stop() : this.play(1)));
    this.pl = pl; this.pr = pr;
    root.querySelector('#ss-pick-e').addEventListener('click', (ev) => ssDatePick.open('e', ev.currentTarget));
    root.querySelector('#ss-pick-x').addEventListener('click', (ev) => ssDatePick.open('x', ev.currentTarget));
    window.addEventListener('resize', () => this.layout());
  },
  // 분기 위치 ↔ 막대 % — 오늘에서 먼 분기일수록 촘촘한 로그 눈금
  //   오늘에서 k 분기 떨어진 곳 = 100·(1 − ln(1 + k/s) / ln(1 + max/s)) %,  s = max(1, 전체 분기 수 × 7.5%)
  warp() { const max = this.max, s = Math.max(1, max * 0.075); return { max, s, full: Math.log1p(max / s) }; },
  toPct(v) {
    const w = this.warp();
    if (w.max <= 0) return 0;
    const back = Math.min(w.max, Math.max(0, w.max - v));
    return 100 - 100 * Math.log1p(back / w.s) / w.full;
  },
  toVal(p) {
    const w = this.warp();
    if (w.max <= 0) return 0;
    const share = Math.min(100, Math.max(0, p)) / 100;
    const back = w.s * Math.expm1((1 - share) * w.full);
    return Math.round(Math.min(w.max, Math.max(0, w.max - back)));
  },
  layout() {
    if (!this.el) return;
    const ep = this.toPct(S.e), xp = this.toPct(S.x);
    this.th[0].style.left = ep + '%'; this.th[1].style.left = xp + '%';
    this.fill.style.left = ep + '%'; this.fill.style.width = (xp - ep) + '%';
    // 손잡이 위 라벨: 겹치면 양쪽으로 밀고 가장자리 안에
    const eL = document.getElementById('ss-tde'), xL = document.getElementById('ss-tdx'), w = this.el.clientWidth;
    if (!eL || !xL || !w) return;
    const eHalf = eL.offsetWidth / 2, xHalf = xL.offsetWidth / 2, need = eHalf + xHalf + 8;
    const inside = (c, half) => Math.min(Math.max(c, half), w - half);
    let eC = ep / 100 * w, xC = xp / 100 * w;
    const short = need - (xC - eC);
    if (short > 0) { eC -= short / 2; xC += short / 2; }
    eC = inside(eC, eHalf); xC = inside(xC, xHalf);
    if (xC - eC < need) {   // 한쪽이 가장자리에 붙었으면 다른 쪽을 밀어냄
      if (eC <= eHalf) xC = Math.min(eC + need, w - xHalf);
      else if (xC + xHalf >= w) eC = Math.max(xC - need, eHalf);
    }
    eL.style.left = eC + 'px'; xL.style.left = xC + 'px';
  },
  update(e, x, ed, xd) {
    const de = document.getElementById('ss-de'), dx = document.getElementById('ss-dx');
    if (de) de.textContent = ed ? ssDate(ed) : ssQLabel(DS.q[e][0]);
    if (dx) dx.textContent = xd ? ssDate(xd) : ssQLabel(DS.q[x][0]);
    const pe = document.getElementById('ss-pick-e'), px = document.getElementById('ss-pick-x');
    if (pe) pe.classList.toggle('on', !!ed);
    if (px) px.classList.toggle('on', !!xd);
    this.layout();
  },
  // 움직인 쪽의 정확한 날짜만 지움 (둘 다 움직이면 둘 다)
  changed(side) {
    if (side === 'e' || side == null) S.ed = '';
    if (side === 'x' || side == null) S.xd = '';
    ssChanged();
  },
  step(dir) {
    const ne = S.e + dir, nx = S.x + dir;
    if (ne < 0 || nx > this.max) return false;
    S.e = ne; S.x = nx; this.layout(); this.changed();
    return true;
  },
  stop() {
    if (this.playT) { clearInterval(this.playT); this.playT = null; }
    this.playDir = 0;
    this.pl.setAttribute('aria-pressed', 'false'); this.pr.setAttribute('aria-pressed', 'false');
    this.pl.textContent = '◀'; this.pr.textContent = '▶';
  },
  play(dir) {
    this.stop();
    this.playDir = dir;
    const b = dir < 0 ? this.pl : this.pr;
    b.setAttribute('aria-pressed', 'true'); b.textContent = '■';
    if (!this.step(dir)) { this.stop(); return; }
    this.playT = setInterval(() => { if (!this.step(dir)) this.stop(); }, 750);
  },
};
// 날짜가 든 분기 (분기 마지막 거래일 ≥ 날짜 인 첫 분기)
function ssQIdxForDate(d) { for (let i = 0; i < DS.q.length; i++) if (DS.q[i][0] >= d) return i; return DS.q.length - 1; }

// ── 정확한 날짜 달력 ──
const ssDatePick = {
  st: null,
  close() {
    if (!this.st) return;
    this.st.pop.remove(); this.st.trig.classList.remove('open');
    this.st = null;
    document.removeEventListener('mousedown', this._dd, true);
    document.removeEventListener('keydown', this._kd, true);
    window.removeEventListener('resize', this._rp);
    window.removeEventListener('scroll', this._sc, true);
  },
  effEntry() { if (S.ed) return S.ed; const i = S.e > 0 ? S.e - 1 : S.e; return DS.q[i] && DS.q[i][0]; },
  effExit() { return S.xd || (DS.q[S.x] && DS.q[S.x][0]); },
  pos(pop, trig) { ssPlacePop(pop, trig, pop.offsetWidth || 260, 260, 0); },
  grid(side, y, m) {
    const pop = this.st.pop, bound = side === 'e' ? this.effExit() : this.effEntry();
    const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
    const minY = +d0.slice(0, 4), minM = +d0.slice(5, 7) - 1, maxY = +d1.slice(0, 4), maxM = +d1.slice(5, 7) - 1;
    // select 를 콕 집어 찾음 — 사이트 공통 고르기([CSEL])가 select 앞에 같은 class 의 단추를 두므로 '.ss-dcy' 만 쓰면 단추가 잡힘
    pop.querySelector('select.ss-dcm').value = String(m);
    pop.querySelector('select.ss-dcy').value = String(y);
    pop.querySelector('[data-nav="-1"]').disabled = y < minY || (y === minY && m <= minM);
    pop.querySelector('[data-nav="1"]').disabled = y > maxY || (y === maxY && m >= maxM);
    const dow = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cur = side === 'e' ? S.ed : S.xd;
    const cells = [];
    for (let i = 0; i < dow; i++) cells.push('<span></span>');
    for (let d = 1; d <= dim; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const ok = DS.idx.has(ds) && (side === 'e' ? (!bound || ds < bound) : (!bound || ds > bound));
      cells.push('<button type="button" class="ss-dcd' + (cur === ds ? ' sel' : '') + '" data-date="' + ds + '"' + (ok ? '' : ' disabled') + '>' + d + '</button>');
    }
    pop.querySelector('.ss-dcg').innerHTML = cells.join('');
  },
  open(side, trig) {
    if (this.st && this.st.side === side) { this.close(); return; }
    this.close();
    const anchor = side === 'e' ? this.effEntry() : this.effExit();
    const a = anchor || DS.days[DS.days.length - 1].date;
    let y = +a.slice(0, 4), m = +a.slice(5, 7) - 1;
    const minY = +DS.days[0].date.slice(0, 4), maxY = +DS.days[DS.days.length - 1].date.slice(0, 4);
    const yo = [];
    for (let yr = maxY; yr >= minY; yr--) yo.push('<option value="' + yr + '">' + yr + '년</option>');
    const mo = Array.from({ length: 12 }, (_, i) => '<option value="' + i + '">' + (i + 1) + '월</option>').join('');
    const pop = document.createElement('div');
    pop.className = 'ss-dcal';
    pop.innerHTML = '<div class="ss-dch"><button type="button" class="ss-dcn" data-nav="-1" aria-label="이전 달">&lsaquo;</button><span><select class="ss-isel ss-dcy" aria-label="연도">' + yo.join('') + '</select><select class="ss-isel ss-dcm" aria-label="월">' + mo + '</select></span><button type="button" class="ss-dcn" data-nav="1" aria-label="다음 달">&rsaquo;</button></div>'
      + '<div class="ss-dcw">' + ['일', '월', '화', '수', '목', '금', '토'].map((w) => '<span>' + w + '</span>').join('') + '</div><div class="ss-dcg"></div>'
      + '<div class="ss-dcf"><button type="button" class="ss-dcclr">분기 기본값 쓰기</button></div>';
    document.body.appendChild(pop);
    this.pos(pop, trig);
    trig.classList.add('open');
    this.st = { side, pop, trig, y, m };
    this.grid(side, y, m);
    pop.addEventListener('click', (ev) => {
      const nav = ev.target.closest('.ss-dcn');
      if (nav && !nav.disabled) {
        let { y: yy, m: mm } = this.st;
        mm += +nav.dataset.nav;
        if (mm < 0) { mm = 11; yy--; } else if (mm > 11) { mm = 0; yy++; }
        this.st.y = yy; this.st.m = mm; this.grid(side, yy, mm);
        return;
      }
      const day = ev.target.closest('.ss-dcd');
      if (day && !day.disabled) {
        const d = day.dataset.date;
        if (side === 'e') { S.ed = d; S.e = ssQIdxForDate(d); } else { S.xd = d; S.x = ssQIdxForDate(d); }
        this.close();
        ssPeriodUI.layout();
        ssChanged();
        return;
      }
      if (ev.target.closest('.ss-dcclr')) { if (side === 'e') S.ed = ''; else S.xd = ''; this.close(); ssChanged(); }
    });
    pop.addEventListener('change', (ev) => {
      if (!ev.target.matches('select.ss-dcm, select.ss-dcy')) return;
      let yy = +pop.querySelector('select.ss-dcy').value, mm = +pop.querySelector('select.ss-dcm').value;
      const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
      const lo = { y: +d0.slice(0, 4), m: +d0.slice(5, 7) - 1 }, hi = { y: +d1.slice(0, 4), m: +d1.slice(5, 7) - 1 };
      if (yy < lo.y || (yy === lo.y && mm < lo.m)) { yy = lo.y; mm = lo.m; }
      if (yy > hi.y || (yy === hi.y && mm > hi.m)) { yy = hi.y; mm = hi.m; }
      this.st.y = yy; this.st.m = mm; this.grid(side, yy, mm);
    });
    // 바깥을 누르면 닫음 — 단, 연도·월 고르기 목록(.cs-menu)은 사이트 공통 고르기([CSEL])가 <body> 끝에 따로 띄우므로 '안'으로 봄
    // (예전: 목록에서 연도를 누르는 순간 달력이 닫혀 연도·월을 바꿀 수 없었음)
    this._dd = (e) => { const t = e.target; if (this.st && !this.st.pop.contains(t) && t !== this.st.trig && !this.st.trig.contains(t) && !(t.closest && t.closest('.cs-menu'))) this.close(); };
    this._kd = (e) => { if (e.key === 'Escape') this.close(); };
    this._rp = () => { if (this.st) this.pos(this.st.pop, this.st.trig); };
    this._sc = (e) => {
      if (!this.st || this.st.pop.contains(e.target) || (e.target.closest && e.target.closest('.cs-menu'))) return;   // 목록 안 스크롤은 무시
      const r = this.st.trig.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) { this.close(); return; }
      this.pos(this.st.pop, this.st.trig);
    };
    document.addEventListener('mousedown', this._dd, true);
    document.addEventListener('keydown', this._kd, true);
    window.addEventListener('resize', this._rp);
    window.addEventListener('scroll', this._sc, true);
  },
};

/* ═══ 46-tx.js ═══ */
/* ── [STRATSIM] 46 실제 거래내역 ─────────────────────────────────────────
   내 입금·출금 기록(날짜, 금액 [, 계좌 평가액])을 올리거나 붙여 넣거나 구글 시트(CSV 게시) 주소로 연결하면
   슬라이더 공식 대신 그 기록으로 모든 전략을 계산. 첫 줄 = 시작 금액·진입일 · 주말·휴장일 입금은 다음 거래일로 */

// ── 읽기 ──
// 날짜 칸 → 'YYYY-MM-DD' (2024-03-05 · 2024.3.5 · 2024/3/5 · 3/5/2024(미국식) · 그 밖에 Date 가 읽는 것) · 못 읽으면 null
function ssTxDate(s) {
  const t = s == null ? '' : String(s).trim();
  if (t === '') return null;
  const two = (x) => (x.length < 2 ? '0' + x : x);
  const ymd = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (ymd) return [ymd[1], two(ymd[2]), two(ymd[3])].join('-');
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (mdy) return [mdy[3], two(mdy[1]), two(mdy[2])].join('-');
  const d = new Date(t), ms = d.getTime();
  if (ms !== ms) return null;   // 읽지 못함(NaN)
  return [d.getUTCFullYear(), two(String(d.getUTCMonth() + 1)), two(String(d.getUTCDate()))].join('-');
}
// 금액 칸 → 숫자 ('$1,234.5' · '1,000원' · '(500)' = −500 · '-500') · 못 읽으면 null
function ssTxAmount(s) {
  const t = s == null ? '' : String(s).trim();
  if (t === '') return null;
  const v = parseFloat(t.replace(/[()$,\s원₩]/g, ''));
  if (!Number.isFinite(v)) return null;
  const inParens = /^\(.*\)$/.test(t);   // 회계식 음수
  return inParens ? -Math.abs(v) : v;
}
const SS_TX_AMT_RE = /transaction|amount|value|invested|contribution|deposit|cash|금액|입금|투자|적립/i;
const SS_TX_DATE_RE = /date|날짜|일자/i;
const SS_TX_ACT_RE = /total|balance|portfolio|net.?worth|평가|잔고|잔액|총액/i;
// 한 줄 → 칸들 (큰따옴표로 감싼 칸 안의 구분자·"" 지원) · 칸마다 앞뒤 공백 지움
function ssTxSplit(line, sep) {
  const cells = [];
  let buf = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch !== '"') buf += ch;
      else if (line.charAt(i + 1) === '"') { buf += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { cells.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}
function ssTxRaw(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) return { headers: null, rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const first = ssTxSplit(lines[0], sep);
  const head = first.some((c) => SS_TX_DATE_RE.test(c)) || first.every((c) => ssTxDate(c) == null && ssTxAmount(c) == null);
  return { headers: head ? first : null, rows: (head ? lines.slice(1) : lines).map((l) => ssTxSplit(l, sep)) };
}
function ssTxBestNum(rows, dc, n) {
  let best = -1, bs = -1;
  for (let c = 0; c < n; c++) {
    if (c === dc) continue;
    let s = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) if (ssTxAmount((rows[i] || [])[c]) != null) s++;
    if (s > bs) { bs = s; best = c; }
  }
  return best === -1 ? (dc === 0 ? 1 : 0) : best;
}
function ssTxDetect(headers, rows) {
  const n = headers ? headers.length : (rows[0] || []).length;
  let dc = 0, ac = 1;
  if (headers) {
    const d = headers.findIndex((c) => SS_TX_DATE_RE.test(c));
    dc = d === -1 ? 0 : d;
    const cand = headers.map((c, i) => ({ i, c })).filter((x) => x.i !== dc && SS_TX_AMT_RE.test(x.c) && !SS_TX_ACT_RE.test(x.c));
    const cand2 = cand.length ? cand : headers.map((c, i) => ({ i, c })).filter((x) => x.i !== dc && SS_TX_AMT_RE.test(x.c));
    ac = cand2.length ? cand2[0].i : ssTxBestNum(rows, dc, n);
  } else if (n > 2) ac = ssTxBestNum(rows, dc, n);
  if (ac === dc) ac = dc === 0 ? Math.min(1, n - 1) : 0;
  let xc = null;
  if (headers) { const i = headers.findIndex((c, k) => k !== dc && k !== ac && SS_TX_ACT_RE.test(c)); if (i !== -1) xc = i; }
  return { dc, ac, xc };
}
function ssTxRows(rows, dc, ac, xc) {
  const out = [];
  let skipped = 0;
  for (const cells of rows) {
    const date = ssTxDate(cells[dc]), amount = ssTxAmount(cells[ac]);
    if (date == null || amount == null) { skipped++; continue; }
    const r = { date, amount };
    if (xc != null) { const a = ssTxAmount(cells[xc]); if (a != null) r.actual = a; }
    out.push(r);
  }
  // 같은 날은 한 줄로: 금액은 더하고, 평가액은 그날 마지막으로 적힌 값
  const byDay = new Map();
  for (const r of out) {
    const before = byDay.get(r.date);
    const one = { date: r.date, amount: (before ? before.amount : 0) + r.amount };
    const act = r.actual != null ? r.actual : before ? before.actual : undefined;
    if (act != null) one.actual = act;
    byDay.set(r.date, one);
  }
  const merged = [...byDay.values()].sort((x, y) => (x.date > y.date) - (x.date < y.date));
  return { rows: merged, skipped, total: merged.reduce((s, r) => s + r.amount, 0) };
}
function ssTxParse(text, dc, ac, xc) {
  const { headers, rows } = ssTxRaw(text);
  if (!rows.length) return { rows: [], skipped: 0, total: 0, headers: null, raw: [], dc: 0, ac: 1, xc: null };
  const n = headers ? headers.length : (rows[0] || []).length;
  let d = dc, a = ac, x = xc;
  if (d == null || a == null || d < 0 || a < 0 || d >= n || a >= n || d === a) ({ dc: d, ac: a, xc: x } = ssTxDetect(headers, rows));
  if (x != null && (x < 0 || x >= n || x === d || x === a)) x = ssTxDetect(headers, rows).xc;
  return Object.assign(ssTxRows(rows, d, a, x), { headers, raw: rows, dc: d, ac: a, xc: x != null ? x : null });
}
// 주말·휴장일 → 다음 거래일 (자료 끝 넘으면 null)
function ssTxSnap(d) {
  if (DS.idx.has(d)) return d;
  const days = DS.days;
  if (d > days[days.length - 1].date) return null;
  let lo = 0, hi = days.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m].date >= d) { ans = days[m].date; hi = m - 1; } else lo = m + 1; }
  return ans;
}
function ssTxSchedule(list) {
  const byDate = new Map(), byMonth = new Map(), out = [], pdm = new Map();
  for (const r of list) {
    byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
    const mo = r.date.slice(0, 7);
    byMonth.set(mo, (byMonth.get(mo) || 0) + r.amount);
    out.push({ date: r.date, amount: r.amount });
    pdm.set(mo, r.date);
  }
  return { byDate, byMonth, list: out, priceDateByMonth: pdm };
}
function ssTxState(rows, source, url, dc, ac, xc, showActual) {
  if (!rows || !rows.length) return null;
  const [first, ...rest] = rows;
  const flows = [];
  for (const r of rest) { const d = ssTxSnap(r.date); if (d != null) flows.push({ date: d, amount: r.amount }); }
  const act = new Map();
  for (const r of rows) {
    if (r.actual == null || !isFinite(r.actual)) continue;
    let d = ssTxSnap(r.date);
    if (d == null) d = DS.days[DS.days.length - 1].date;   // 자료 끝 뒤 평가액 = 가장 최근 값
    act.set(d, r.actual);
  }
  return {
    initial: first.amount, entryDate: ssTxSnap(first.date) || first.date, rows,
    schedule: ssTxSchedule(flows),
    actualPoints: Array.from(act, ([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    total: rows.reduce((s, r) => s + r.amount, 0), source: source || 'upload', sheetUrl: url || null,
    dc: dc != null ? dc : null, ac: ac != null ? ac : null, xc: xc != null ? xc : null, showActual: showActual !== false,
  };
}
const ssNextMonth = (ym) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); };
// 진입일에 맞춘 거래내역 보기: 첫 거래 전 진입 → 0원 시작 + 모든 거래가 날짜별 흐름 /
// 중간 진입 → 그 전까지를 한 덩어리 시작 금액(평가액이 있으면 그 날 평가액, 없으면 현금 복리 잔액) + 이후 흐름
function ssTxEffective(st, E0, annualRate) {
  if (!st) return null;
  const E = E0 || st.entryDate;
  const all = [{ date: st.entryDate, amount: st.initial }].concat(st.schedule.list);
  if (E < st.entryDate) return { initial: 0, schedule: ssTxSchedule(all), actualPoints: st.actualPoints || [], entryDate: E };
  if (E === st.entryDate) return { initial: st.initial, schedule: st.schedule, actualPoints: st.actualPoints || [], entryDate: E };
  const pts = st.actualPoints || [];
  let initial = null;   // 진입일 이하 마지막 계좌 평가액
  for (const p of pts) { if (p.date > E) break; initial = p.value; }
  if (initial == null) {   // 평가액이 없으면: 진입일까지 넣은 돈을 매달 (연 이율 ÷ 12) 복리로 굴린 잔액
    const growth = 1 + (annualRate || 0) / 12;
    let bal = 0, month = st.entryDate.slice(0, 7);
    const rollTo = (ym) => { while (month < ym) { bal *= growth; month = ssNextMonth(month); } };
    for (const f of all) { if (f.date > E) break; rollTo(f.date.slice(0, 7)); bal += f.amount; }
    rollTo(E.slice(0, 7));
    initial = bal;
  }
  const later = all.filter((f) => f.date > E), lp = pts.filter((p) => p.date >= E);
  if (pts.length && pts[0].date <= E && (!lp.length || lp[0].date !== E)) lp.unshift({ date: E, value: initial });
  return { initial, schedule: ssTxSchedule(later), actualPoints: lp, entryDate: E };
}

// ── 저장 ──
function ssTxPersist() {
  try {
    const s = S.txStash;
    if (s) localStorage.setItem(SS_LS.tx, JSON.stringify({ rows: s.rows, source: s.source, sheetUrl: s.sheetUrl, dc: s.dc, ac: s.ac, xc: s.xc, showActual: s.showActual !== false, active: !!S.tx }));
    else localStorage.removeItem(SS_LS.tx);
  } catch (e) {}
}
function ssTxLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(SS_LS.tx) || 'null');
    if (!o || !Array.isArray(o.rows) || !o.rows.length) return;
    const rows = o.rows.filter((r) => r && typeof r.date === 'string' && Number.isFinite(+r.amount)).map((r) => { const x = { date: r.date, amount: +r.amount }; if (r.actual != null && Number.isFinite(+r.actual)) x.actual = +r.actual; return x; });
    const st = ssTxState(rows, o.source, o.sheetUrl, o.dc, o.ac, o.xc, o.showActual);
    S.txStash = st;
    S.tx = o.active !== false ? st : null;
  } catch (e) {}
}
function ssTxFromShared(rows) {
  if (!Array.isArray(rows)) return;
  const clean = rows.slice(0, 5000).filter((r) => r && typeof r.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.date) && Number.isFinite(+r.amount)).map((r) => { const x = { date: r.date, amount: +r.amount }; if (r.actual != null && Number.isFinite(+r.actual)) x.actual = +r.actual; return x; });
  if (!clean.length) return;
  const st = ssTxState(clean, 'upload');
  S.tx = st; S.txStash = st;
}

// 진입을 첫 거래일로 (정확한 날짜 + 손잡이)
function ssTxApplyEntry() { if (!S.tx) return; S.ed = S.tx.entryDate; S.e = ssQIdxForDate(S.tx.entryDate); }

// 시트 연결이면 열 때마다 조용히 다시 받아 옴 (실패하면 저장된 것 그대로)
async function ssTxRefreshSheet() {
  const cur = S.txStash;
  if (!cur || cur.source !== 'sheet' || !cur.sheetUrl) return;
  const was = !!S.tx;
  try {
    const res = await fetch(cur.sheetUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = ssTxParse(await res.text(), cur.dc, cur.ac, cur.xc);
    if (!p.rows.length) throw new Error('empty');
    const fresh = ssTxState(p.rows, 'sheet', cur.sheetUrl, p.dc, p.ac, p.xc, cur.showActual);
    S.txStash = fresh;
    if (was) S.tx = fresh;
    ssTxPersist();
    ssChanged();
  } catch (e) {}
}

// ── 창 (올리기 · 실시간 시트) ──
const TXM = { p: null, src: 'upload', url: null, err: null, loading: false, edit: false, text: '', sheet: '', tab: 'upload', downOnBg: false };
function ssTxOpen(o) {
  o = o || {};
  ssTxClose();
  Object.assign(TXM, { p: null, src: 'upload', url: null, err: null, loading: false, edit: !!o.edit, text: o.text || '', sheet: o.url || '', tab: o.url ? 'sheet' : 'upload' });
  if (TXM.text) TXM.p = ssTxParse(TXM.text);
  const ov = document.createElement('div');
  ov.className = 'ss-ov';
  ov.id = 'ss-txm';
  document.body.appendChild(ov);
  ssTxDraw();
  if (o.url) ssTxFetch(o.url, o.cols || null);
  else { const ta = ov.querySelector('#ss-txta'); if (ta) ta.focus(); }
}
function ssTxClose() { const m = document.getElementById('ss-txm'); if (m) m.remove(); TXM.p = null; }
function ssTxPreviewHtml(p) {
  if (!p) return '';
  if (!p.rows.length) return '<div class="ss-err">읽을 수 있는 줄이 없습니다 — 날짜·금액 열을 확인해 주세요.</div>';
  const act = p.xc != null && p.rows.some((r) => r.actual != null);
  return '<div class="ss-txstat"><b>' + p.rows.length + '</b>건' + (p.skipped ? ', 건너뜀 <b>' + p.skipped + '</b>건' : '') + ' · 합계 <b>' + ssMoney(Math.round(p.total)) + '</b> · ' + ssDate(p.rows[0].date) + ' → ' + ssDate(p.rows[p.rows.length - 1].date) + '</div>'
    + '<div class="ss-txtw"><table class="ss-txt"><thead><tr><th>날짜</th><th>금액</th>' + (act ? '<th>계좌 평가액</th>' : '') + '</tr></thead><tbody>'
    + p.rows.slice(0, 200).map((r) => '<tr><td>' + ssDate(r.date) + '</td><td>' + ssMoney(Math.round(r.amount)) + '</td>' + (act ? '<td>' + (r.actual != null ? ssMoney(Math.round(r.actual)) : '—') + '</td>' : '') + '</tr>').join('') + '</tbody></table></div>';
}
function ssTxColsHtml(p) {
  const n = p && p.raw && p.raw.length ? (p.headers ? p.headers.length : p.raw[0].length) : 0;
  if (n < 2) return '';
  const lab = (i) => ssEsc(p.headers && p.headers[i] ? p.headers[i] : (i + 1) + '번째 열');
  const opts = (sel) => Array.from({ length: n }, (_, i) => '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + lab(i) + '</option>').join('');
  return '<div class="ss-txcols"><label>날짜 열 <select id="ss-txdc" class="ss-isel">' + opts(p.dc) + '</select></label><label>금액 열 <select id="ss-txac" class="ss-isel">' + opts(p.ac) + '</select></label>'
    + '<label title="선택: 그날 계좌의 실제 총 평가액 — \'내 계좌\' 선으로 그려 전략들과 견줌">계좌 평가액 열 <select id="ss-txxc" class="ss-isel"><option value=""' + (p.xc == null ? ' selected' : '') + '>— 없음 —</option>' + opts(p.xc) + '</select></label></div>';
}
function ssTxRefreshParsed() {
  const m = document.getElementById('ss-txm');
  if (!m) return;
  const a = m.querySelector('#ss-txprev'), b = m.querySelector('#ss-txcolslot'), c = m.querySelector('[data-tx-ok]');
  if (a) a.innerHTML = ssTxPreviewHtml(TXM.p);
  if (b) b.innerHTML = ssTxColsHtml(TXM.p);
  if (c) c.disabled = !(TXM.p && TXM.p.rows.length);
}
function ssTxDraw() {
  const m = document.getElementById('ss-txm');
  if (!m) return;
  const up = '<div class="ss-help">한 줄에 거래 하나: 날짜, 금액 (출금은 −).<br>가장 이른 거래가 진입일과 시작 금액이 됩니다. 세 번째 열에 그날 계좌 평가액을 넣으면 \'내 계좌\' 선도 그려집니다.</div>'
    + '<input type="file" id="ss-txfile" accept=".csv,.tsv,.txt" class="ss-txfile">'
    + '<textarea id="ss-txta" class="ss-ta" placeholder="날짜&#9;금액&#10;2019-01-03&#9;10000&#10;2019-02-01&#9;500&#10;2019-03-01&#9;500">' + ssEsc(TXM.text) + '</textarea>';
  const sh = '<div class="ss-help">구글 시트의 \'웹에 게시 → CSV\' 주소를 넣으세요.<br>이 페이지를 열 때마다 자동으로 다시 받아 옵니다.</div>'
    + '<div class="ss-txsheet"><input type="url" id="ss-txurl" placeholder="공개 CSV 주소 (파일 → 공유 → 웹에 게시 → CSV)" value="' + ssEsc(TXM.sheet) + '"><button type="button" class="ss-btn" id="ss-txfetch"' + (TXM.loading ? ' disabled' : '') + '>' + (TXM.loading ? '불러오는 중…' : '불러오기') + '</button></div>'
    + (TXM.err ? '<div class="ss-err">' + ssEsc(TXM.err) + '</div>' : '');
  m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">' + (TXM.edit ? '거래내역 고치기' : '실제 거래내역') + '</div>'
    + '<div class="ss-tabs"><button type="button" class="' + (TXM.tab === 'upload' ? 'on' : '') + '" data-tx-tab="upload">올리기·붙여넣기</button><button type="button" class="' + (TXM.tab === 'sheet' ? 'on' : '') + '" data-tx-tab="sheet">구글 시트 연결</button></div>'
    + (TXM.tab === 'upload' ? up : sh)
    + '<div id="ss-txcolslot">' + ssTxColsHtml(TXM.p) + '</div><div id="ss-txprev">' + ssTxPreviewHtml(TXM.p) + '</div>'
    + '<div class="ss-mact"><button type="button" class="ss-btn" data-tx-cancel>취소</button><button type="button" class="ss-btn pri" data-tx-ok' + (TXM.p && TXM.p.rows.length ? '' : ' disabled') + '>이 내역 쓰기</button></div></div>';
}
async function ssTxFetch(url, cols) {
  TXM.loading = true; TXM.err = null; ssTxDraw();
  try {
    if (!/^https:\/\//i.test(url)) throw new Error('https:// 주소만 쓸 수 있습니다');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = ssTxParse(await res.text(), cols ? cols.dc : null, cols ? cols.ac : null, cols ? cols.xc : null);
    if (!p.raw.length) throw new Error('자료가 없습니다');
    TXM.p = p; TXM.src = 'sheet'; TXM.url = url;
  } catch (e) {
    TXM.p = null;
    TXM.err = '불러오지 못했습니다 — ' + (e && e.message ? e.message : '공개 CSV 주소인지 확인해 주세요');
  }
  TXM.loading = false;
  if (document.getElementById('ss-txm')) ssTxDraw();
}
document.addEventListener('mousedown', (e) => { TXM.downOnBg = !!(e.target && e.target.id === 'ss-txm'); });
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.id === 'ss-txm') { if (TXM.downOnBg) ssTxClose(); return; }
  if (!t.closest('#ss-txm')) return;
  const tab = t.closest('[data-tx-tab]');
  if (tab) { TXM.tab = tab.getAttribute('data-tx-tab'); ssTxDraw(); return; }
  if (t.closest('#ss-txfetch')) { const u = (document.getElementById('ss-txurl') || {}).value; if (u && u.trim()) ssTxFetch(u.trim()); return; }
  if (t.closest('[data-tx-cancel]')) { ssTxClose(); return; }
  if (t.closest('[data-tx-ok]')) {
    const p = TXM.p;
    if (!p || !p.rows.length) return;
    const st = ssTxState(p.rows, TXM.src, TXM.src === 'sheet' ? TXM.url : null, p.dc, p.ac, p.xc);
    S.tx = st; S.txStash = st;
    ssTxPersist();
    ssTxClose();
    ssTxApplyEntry();
    ssChanged();
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'ss-txta') { TXM.text = e.target.value; TXM.p = e.target.value.trim() ? ssTxParse(e.target.value) : null; TXM.src = 'upload'; TXM.url = null; ssTxRefreshParsed(); }
  else if (e.target.id === 'ss-txurl') TXM.sheet = e.target.value;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ss-txfile') {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { TXM.text = String(rd.result || ''); TXM.p = TXM.text.trim() ? ssTxParse(TXM.text) : null; TXM.src = 'upload'; TXM.url = null; ssTxDraw(); };
    rd.readAsText(f);
    return;
  }
  if (e.target.id === 'ss-txdc' || e.target.id === 'ss-txac' || e.target.id === 'ss-txxc') {
    if (!TXM.p || !TXM.p.raw) return;
    const dc = +document.getElementById('ss-txdc').value, ac = +document.getElementById('ss-txac').value;
    const xr = document.getElementById('ss-txxc').value, xc = xr === '' ? null : +xr;
    TXM.p = Object.assign({}, TXM.p, ssTxRows(TXM.p.raw, dc, ac, xc), { dc, ac, xc });
    ssTxRefreshParsed();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ss-txm')) ssTxClose(); });
const ssTxToTsv = (rows) => (rows.some((r) => r.actual != null)
  ? '날짜\t금액\t평가액\n' + rows.map((r) => r.date + '\t' + r.amount + '\t' + (r.actual != null ? r.actual : '')).join('\n')
  : '날짜\t금액\n' + rows.map((r) => r.date + '\t' + r.amount).join('\n'));

/* ═══ 47-preview.js ═══ */
/* ── [STRATSIM] 47 막대 미리보기 드롭다운 ───────────────────────────────────
   선택지를 열면, 다른 값은 그대로 두고 그 칸만 바꿔 끝까지 계산한 최종 금액을 막대로 —
   어느 값이 가장 좋았는지 한눈에 (가장 큰 값 = 강조 · 같은 값이 3번 넘게 이어지면 '=') */

let ssPd = null;   // { pop, trig }

// 이 칸의 선택지마다 최종 금액
function ssPdTotals(type, owner, k) {
  const ctx = R.ctx;
  if (!ctx) return [];
  const p0 = ssParamsOf(type, owner);
  const def = SS_PDEF[type + '.' + k];
  const opts = def.opts.map((o) => o[0]);
  const common = { initial: ctx.initial, monthly: ctx.monthly, raise: ctx.raise, qi0: ctx.qi0, qi1: ctx.qi1, sched: ctx.sched };
  const ov = ctx.anyOv ? { ed: ctx.entryDate, xd: ctx.exitDate } : {};
  if (type === 'bh') {
    const rows = ctx.anyOv ? (() => { const q = ssExactRows('quarterly', ctx.entryDate, ctx.exitDate); return q && q.length >= 2 ? q : null; })() : null;
    const r = ssRun9(Object.assign({}, common, { rate: 0.04, baseRate: ctx.rate, period: 'quarterly', rows }, ov, ssOpts9(ssDefaults('9sig'))));
    return opts.map((v) => { const a = r.bh[v] || []; return a.length ? a[a.length - 1].value : 0; });
  }
  return opts.map((v) => {
    const p = Object.assign({}, p0, { [k]: v });
    try {
      if (type === '9sig') {
        const per = p.per || 'quarterly';
        let rows = null;
        const rp = +p.rp || 0;
        if (rp > 0) { const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1)); const q = ssShiftRows(per, off, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
        if (!rows && ctx.anyOv) { const q = ssExactRows(per, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
        const r = ssRun9(Object.assign({}, common, { rate: ssRate9(p), baseRate: ctx.rate, period: per, rows, noBH: true }, ov, ssOpts9(p)));
        return r.log.length ? r.log[r.log.length - 1].total : 0;
      }
      if (type === 'sma') {
        const r = ssRunSma(Object.assign({}, common, { rate: ssRate9(p) }, ov, ssOptsSma(p)));
        return r.points.length ? r.points[r.points.length - 1].value : 0;
      }
    } catch (e) { return 0; }
    return 0;
  });
}
// 떠 있는 창을 단추 바로 아래에 — 아래 공간이 flipUnder 보다 좁고 위가 더 넓으면 위로 · 좌우는 화면 안 8px
//   maxH > 0 이면 높이도 그 공간(최대 maxH)에 맞춤 · 막대 미리보기 드롭다운과 날짜 달력이 같이 씀
function ssPlacePop(pop, trig, width, flipUnder, maxH) {
  const r = trig.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  pop.style.left = Math.max(8, Math.min(r.left, vw - 8 - width)) + 'px';
  const room = vh - r.bottom - 8, up = room < flipUnder && r.top > room;
  pop.style.top = up ? '' : (r.bottom + 4) + 'px';
  pop.style.bottom = up ? (vh - r.top + 4) + 'px' : '';
  if (maxH > 0) pop.style.maxHeight = Math.min(maxH, up ? r.top - 8 : room) + 'px';
}
function ssPdPos(pop, trig) {
  const w = Math.max(trig.getBoundingClientRect().width, 260);
  pop.style.minWidth = w + 'px';
  ssPlacePop(pop, trig, w, 180, 340);
}
function ssClosePd() {
  if (!ssPd) return;
  ssPd.pop.remove(); ssPd.trig.classList.remove('open');
  ssPd = null;
  document.removeEventListener('mousedown', ssPdDown, true);
  document.removeEventListener('keydown', ssPdKey, true);
  window.removeEventListener('resize', ssPdRepos);
  window.removeEventListener('scroll', ssPdScroll, true);
}
function ssPdDown(e) { if (ssPd && !ssPd.pop.contains(e.target) && e.target !== ssPd.trig && !ssPd.trig.contains(e.target)) ssClosePd(); }
function ssPdKey(e) { if (e.key === 'Escape') ssClosePd(); }
function ssPdRepos() { if (ssPd) ssPdPos(ssPd.pop, ssPd.trig); }
function ssPdScroll(e) {
  if (!ssPd || ssPd.pop.contains(e.target)) return;
  const r = ssPd.trig.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) { ssClosePd(); return; }
  ssPdPos(ssPd.pop, ssPd.trig);
}
// 공통 팝업 (기본 전략 손잡이·사용자 전략 손잡이 모두)
function ssPdShell(trig, rows, curIdx, onPick) {
  const pop = document.createElement('div');
  pop.className = 'ss-pdpop';
  pop.innerHTML = '<div class="ss-pdh">고르면 끝 금액</div>' + rows.map((lab, i) => '<div class="ss-pdr' + (i === curIdx ? ' sel' : '') + '" data-i="' + i + '"><span class="ss-pdl">' + ssEsc(lab) + '</span><span class="ss-pdt"><span class="ss-pdf"></span></span><span class="ss-pdv">…</span></div>').join('');
  document.body.appendChild(pop);
  let mw = 0;
  pop.querySelectorAll('.ss-pdl').forEach((el) => { mw = Math.max(mw, el.offsetWidth); });
  if (mw > 0) pop.style.setProperty('--pdl', Math.ceil(mw) + 'px');
  ssPdPos(pop, trig);
  trig.classList.add('open');
  ssPd = { pop, trig };
  pop.addEventListener('click', (e) => { const r = e.target.closest('.ss-pdr'); if (!r) return; const i = +r.getAttribute('data-i'); ssClosePd(); onPick(i); });
  const sel = pop.querySelector('.ss-pdr.sel');
  if (sel) pop.scrollTop = Math.max(0, sel.offsetTop - (pop.clientHeight - sel.offsetHeight) / 2);
  document.addEventListener('mousedown', ssPdDown, true);
  document.addEventListener('keydown', ssPdKey, true);
  window.addEventListener('resize', ssPdRepos);
  window.addEventListener('scroll', ssPdScroll, true);
  return pop;
}
// mode 'all' = 기본 전략(모두 한 번에 계산): 최댓값과 같은 값 모두 강조 + 3번 넘게 같은 값 '='
// mode 'one' = 사용자 전략(하나씩 도착): 다 오면 첫 최댓값 하나만 강조
function ssPdFill(pop, totals, mode) {
  const rows = Array.from(pop.querySelectorAll('.ss-pdr'));
  const done = totals.every((t) => t != null);
  const maxT = Math.max(0, ...totals.map((t) => t || 0));
  const labels = totals.map((t) => (t == null ? null : ssMoney(Math.round(t))));
  const maxL = ssMoney(Math.round(maxT)), bestIdx = totals.indexOf(maxT);
  // 같은 금액이 셋 이상 이어지면 둘째부터 '=' 로 흐리게
  const rep = labels.map(() => false);
  if (mode === 'all') {
    let runFrom = 0;
    for (let i = 1; i <= labels.length; i++) {
      if (i < labels.length && labels[i] === labels[runFrom]) continue;
      if (i - runFrom >= 3) for (let k = runFrom + 1; k < i; k++) rep[k] = true;
      runFrom = i;
    }
  }
  rows.forEach((row, i) => {
    const t = totals[i];
    row.querySelector('.ss-pdf').style.width = (maxT > 0 && t != null ? Math.max(1.5, t / maxT * 100) : 0) + '%';
    row.querySelector('.ss-pdv').textContent = t == null ? '…' : labels[i];
    row.classList.toggle('best', maxT > 0 && (mode === 'all' ? labels[i] === maxL : done && i === bestIdx));
    row.classList.toggle('rep', rep[i]);
  });
}
function ssOpenPd(trig) {
  if (ssPd && ssPd.trig === trig) { ssClosePd(); return; }
  ssClosePd();
  const type = trig.getAttribute('data-pd-type'), owner = trig.getAttribute('data-pd-own'), k = trig.getAttribute('data-pd-k');
  const def = SS_PDEF[type + '.' + k], p = ssParamsOf(type, owner);
  if (!def || !p) return;
  const cur = def.opts.findIndex((o) => o[0] === String(p[k]));
  const pop = ssPdShell(trig, def.opts.map((o) => o[1]), cur, (i) => { const v = def.opts[i][0]; if (String(p[k]) !== v) ssSetParam(type, owner, k, v); });
  setTimeout(() => { if (!ssPd || ssPd.pop !== pop) return; let tot; try { tot = ssPdTotals(type, owner, k); } catch (e) { return; } ssPdFill(pop, tot, 'all'); }, 0);
}

/* ═══ 48-prompt.js ═══ */
/* ── [STRATSIM] 48 사용자 전략 프롬프트 ─────────────────────────────────────
   '프롬프트 복사'로 ChatGPT·Claude 같은 AI 에 붙여 넣는 글. 앱이 run(data, p) 에 넘기는 값과 돌려받을 모양을
   빠짐없이 적어 AI 가 추측하지 않게 함. 앱과 코드 사이의 약속(입력·출력 모양)은 원본 앱과 같아서
   원본용으로 만든 전략 코드도 그대로 돌아감 — 글과 예시 전략은 이 사이트가 새로 씀 */

// 예시 전략 안에 들어가는 '출금 처리' 부분 (설명 3-3 과 같은 내용)
const SS_WITHDRAW_SNIPPET = [
  '        // 출금 처리 — 현금으로 먼저 내고, 모자라면 들고 있는 종목을 그날 종가에 필요한 만큼만 팔아 메움(비용 포함).',
  '        // 그래도 모자라면 다 판 것으로 끝 — 계좌는 0 아래로 내려가지 않음',
  '        if (cash < 0) {',
  '          const px = close(hold, i);',
  '          if (units > 0 && px > 0) {',
  '            const sellAmt = Math.min(units * px, -cash / (1 - cost));',
  '            units -= sellAmt / px; fee += sellAmt * cost; cash += sellAmt * (1 - cost);',
  '            note = "출금 — " + hold.toUpperCase() + " 일부 매도";',
  '          }',
  '          if (cash < 0) cash = 0;',
  '        }',
].join('\n');

const SS_PROMPT = `# 백테스트 전략 코드 부탁

맨 아래 '10. 내 전략'에 적은 매매 규칙을 그대로 따르는 백테스트 전략을, 자바스크립트 객체 하나로 만들어 주세요.
이 객체는 '투자전략 시뮬레이터'라는 차트 앱에 붙여 넣어 실행됩니다. 아래 1~9 는 그 앱과 맞추기 위한 약속입니다.

## 1. 답하는 방법
1) 답 전체가 코드 블록(\`\`\`js 로 시작해 \`\`\` 로 끝남) 하나여야 합니다. 블록 앞뒤에 설명 글을 붙이지 마세요.
   채팅 화면에 맨 코드를 쓰면 따옴표가 둥근 따옴표로 바뀌는 등 글자가 망가져, 복사해도 돌아가지 않습니다.
2) 블록 안은 { 로 시작해 } 로 끝나는 객체 그대로. 변수에 담거나 괄호로 감싸거나 export 하지 마세요.
3) 코드는 같은 입력이면 늘 같은 결과를 내는 동기 코드여야 합니다.
   쓰면 안 되는 것: import·require, async·await, fetch·XMLHttpRequest, setTimeout·setInterval, 화면(DOM),
   Math.random, run 의 두 인자(data, p) 밖의 값. 오류를 던지지 말고, 가격이 0 이거나 없을 때를 미리 막으세요.
4) 빨라야 합니다. 앱은 화면 값을 바꿀 때마다 다시 돌리고, 설정 목록을 펼치면 선택지 수만큼(30번 넘게) 더 돌립니다.
   이동 평균·이동 합계는 날마다 하나 더하고 하나 빼는 식으로 이어 가고, 날짜 반복 안에서 지난 기록 전체를 다시 훑지 마세요.
5) 사람이 읽는 글(name, label, tip, note, 판단판 글)은 모두 한국어로. 종목 이름은 TQQQ 처럼 영문 그대로 둡니다.

## 2. 객체 모양
{
  name: "짧은 전략 이름",
  params:  [ ... ],   // 설정 칸 — 5장
  columns: [ ... ],   // 기록 표에 새로 만든 열의 이름·설명 — 6장
  lines:   [ ... ],   // 작은 신호 차트에 그릴 기준선 — 6장
  run(data, p) {
    // 날마다 계좌를 계산해 기록(log)을 남기고(4장), 마지막 날 규칙의 상태를 알려 줍니다(7장)
    return { log: log, signals: { cards: [ ... ], decision: { ... } } };
  }
}

## 3. 앱이 run(data, p) 에 넘기는 것

### 3-1. data — 날마다의 값 (모든 배열은 길이가 같고, 같은 번호 i 는 같은 날)
- data.dates : "YYYY-MM-DD" 글자, 오래된 날부터. 거래일만 있어 주말·휴일은 빠져 있습니다.
- 일별 종가(분배금 재투자 반영)
  - data.qqq  QQQ  (나스닥100)
  - data.spy  SPY  (S&P 500)
  - data.qld  QLD  (나스닥100 2배)
  - data.tqqq TQQQ (나스닥100 3배)
  - data.sso  SSO  (S&P 500 2배)
  - data.spxl SPXL (S&P 500 3배)
  - data.sqqq SQQQ (나스닥100 −3배 인버스 — 나스닥이 내리면 오름)
  상장 전 기간은 지수로 재현한 값이라 TQQQ·SQQQ 도 1971년 2월 5일(자료 첫날)부터 있습니다.
- data.nfci : 미국 시카고 연은 금융 여건 지수(NFCI). 주간 발표값을 발표 지연(7일)을 두고 거래일마다 채운 것이라 미리 알 수 없는 값은 없습니다.
  가격이 아니라 지표입니다(0 보다 크면 평소보다 돈줄이 빡빡함, +0.5 넘으면 신용 불안). 자료 첫날 무렵 발표 전 날은 NaN 일 수 있으니 쓰기 전에 isFinite() 로 확인하세요.
- 종목 id(위 소문자 이름)로 data[id] 처럼 꺼낼 수 있습니다 — 종목을 설정으로 고르게 할 때 이렇게 쓰세요.
- 아주 이른 날짜 몇 개는 가격이 0 일 수 있습니다. 나눗셈 전에 막으세요.
- 배열은 전체 기간입니다. 이동 평균을 미리 채우려고 p.startIdx 앞의 값을 읽는 것은 괜찮지만,
  기록(log)에는 p.startIdx ~ p.endIdx 안의 날짜만 넣으세요.

### 3-2. p — 이번 계산의 조건
- p.initial : 시작 금액(현금). p.startIdx 날에 들어 있습니다.
- p.contributions : { "YYYY-MM-DD": 금액 } — 돈이 들어오거나 나가는 모든 날. 적립이 없어도 빈 객체 {} 입니다(null 아님).
  보통은 달마다 양수 하나(매달 적립)지만, 사용자가 실제 거래내역을 넣으면 날짜가 불규칙하고 출금(음수)도 있습니다.
  적립금은 반드시 이 객체로 처리하고 직접 계산하지 마세요. 날짜 반복 안에서:
    const amt = p.contributions[data.dates[i]] || 0;
    if (amt !== 0) { cash += amt; contributed = amt; invested += amt; action = "contribution"; }
- p.monthly, p.annualRaise : 화면의 '매달 적립'·'해마다 늘림' 값. 실제 거래내역을 쓸 때는 맞지 않으니 계산에 쓰지 마세요.
- p.startIdx, p.endIdx : 계산할 첫날과 마지막 날의 번호(둘 다 포함).
- p.entryDate, p.exitDate : 그 두 날의 날짜 글자(data.dates[p.startIdx], data.dates[p.endIdx]).
- p.weeklyDisplay : 차트 가로축이 주 단위면(대략 10년보다 짧은 기간) true, 아니면 false 또는 없음. 기록을 얼마나 자주 남길지에만 씁니다(4-3).
- p.<설정 id> : 5장의 설정마다 사용자가 고른 값. 숫자 선택지는 숫자, [true, false] 는 참·거짓, 나머지는 글자로 옵니다.

### 3-3. 출금 처리
출금으로 현금이 0 아래가 될 수 있습니다. 그 즉시(같은 날) 들고 있는 종목을 그날 종가에 모자란 만큼만 팔아 현금을 0 으로 돌리세요.
거래 비용을 계산하는 전략이면 이 매도에도 비용을 매깁니다. 계좌 전체로도 모자라면 다 팔고 현금 0. 하루가 끝날 때 현금은 늘 0 이상입니다.
9장 예시의 '출금 처리' 부분을 그대로 써도 됩니다.

## 4. 돌려줄 것 — 기록(log)
log 는 날짜순 배열이고, 한 줄이 기록 표의 한 행, 키 하나가 한 열입니다. 꼭 있어야 하는 키는 date 와 value 이지만,
아래에서 해당하는 키는 모두 채워야 표와 차트 표시가 제대로 나옵니다.

### 4-1. 줄마다 넣을 키
- date : data.dates 의 그 날짜 글자
- value : 그날 계좌 전체 금액 = 현금 + 보유 종목 평가액
- action : 그날 한 일 — 4-2 의 낱말로 시작
- note : 짧은 메모 (예: "중심선보다 6.2% 위", "5번 중 3번째 매수")
- held : 이 줄 뒤에 들고 있는 것, 대문자 ("TQQQ", "CASH", "TQQQ+CASH") — 모든 줄에. 차트 거래 표시의 테두리 색이 이것으로 정해집니다
- price : held 종목의 그날 종가 (현금이면 0 또는 생략)
- shares : 보유 주수
- holdingsValue : 현금을 뺀 보유 평가액
- cash : 현금
- invested : 지금까지 넣은 돈 합계 (시작 금액 + 적립, 출금은 뺌)
- contributed : 그날 들어온 돈 (출금은 음수, 없으면 0)
- fee : 그날 낸 거래 비용 (없으면 0)
- 그 밖에 규칙 판단에 쓴 숫자를 키로 더 넣으세요(신호 종목 종가, 기준선 값, 차이 % 등). 종목을 설정으로 바꿀 수 있으니
  키 이름에 종목 이름을 넣지 말고 assetPrice·signalPrice 처럼 역할로 지으세요.
- 표는 키 이름으로 서식을 정합니다: price·sma·ema·median·avg·mean 이 들어가면 가격, share·unit·qty 는 주수,
  pct·percent 는 %, 그 밖의 숫자는 금액($). 이에 맞춰 이름을 지으세요(개수·일수처럼 금액이 아닌 값은 log 대신 7장 판단판에).

### 4-2. action 낱말 (소문자로, 이 중 하나로 시작)
- "start" : 첫날 시작 평가
- "buy" : 현금으로 종목을 삼
- "sell" : 종목을 팔고 현금으로
- "switch" : 한 종목을 팔고 바로 다른 종목으로
- "rebalance" : 다 바꾸지 않고 비중만 맞춤
- "ease-in" : 나눠 사기 중 한 번
- "contribution" : 돈이 들어오거나(입금) 나감(출금) — 매매 판단 없음
- "hold" : 거래 없는 정기 평가
- "end" : 마지막 날 평가
낱말 뒤에 설명을 이어 써도 됩니다("buy — 5번 중 3번째"). 앱은 앞 낱말만 봅니다.

### 4-3. 기록을 남기는 날
- 첫날(start)과 마지막 날(end)
- 사고판 날, 비중을 맞춘 날, 나눠 산 날마다
- p.contributions 에 있는 날마다(출금 포함 — action "contribution", contributed = 그날 금액)
- 그리고 거래가 없어도 달마다 한 번(p.weeklyDisplay 가 true 면 주마다 한 번) "hold" 줄
  앱은 기록 줄 사이를 이어 그리므로, 주 단위 화면에서 주마다 줄이 없으면 선이 계단처럼 납작해집니다. 날짜 반복 안에서 이렇게 확인하면 됩니다:
    const next = i < p.endIdx ? data.dates[i + 1] : null;
    const weekOf = (d) => Math.floor((Date.parse(d) / 86400000 + 3) / 7);   // 월요일에 바뀌는 주 번호
    const lastOfMonth = !next || next.slice(0, 7) !== data.dates[i].slice(0, 7);
    const lastOfWeek = p.weeklyDisplay && (!next || weekOf(next) !== weekOf(data.dates[i]));

### 4-4. 차트와 표가 기록을 쓰는 법
- buy·sell·switch·rebalance 줄은 그 날짜의 전략 선 위에 표시로 그려지고, 표시에 마우스를 올리면 그 줄이 풍선으로 보입니다.
  contribution·ease-in·hold·start·end 는 표시 없이 표에만 나옵니다.
- 기록 표는 모든 줄을 보여 주고, 적립 줄·나눠 사기 줄을 숨기는 칸이 있습니다. 표의 줄에 마우스를 올리면 차트의 그 표시가 밝아집니다.

## 5. 설정 칸(params) 만들기
설정 칸 하나가 화면 옆 드롭다운 하나가 되고, 고른 값이 run 에서 p.<id> 로 들어옵니다.
- 모양: { id: "자바스크립트 이름", label: "칸 이름", options: [ ... ], default: options 중 하나 }
- 선택지는 숫자·글자 또는 { value, label }. 예: { value: "tqqq", label: "TQQQ" } 는 TQQQ 로 보이고 "tqqq" 가 넘어갑니다. label 은 꾸미지 말고 종목 이름 그대로.
- 켬·끔은 options: [true, false].
- 칸이 많으면 { section: "소제목" } (id 없음)을 사이에 넣어 묶을 수 있습니다. 예: "보유 종목", "신호", "실행·비용".

### 5-1. 어떤 칸을 만드나 — 설명에 적힌 것만
설정 칸은 '10. 내 전략'에 적힌 종목·숫자·기간을 바꿔 보게 하려는 것입니다. 칸마다 설명의 어느 말에서 나왔는지 댈 수 있어야 하고,
댈 수 없으면 만들지 마세요. 설명에 없는 장치를 넣으면 내가 시키지 않은 규칙이 전략을 바꿔 버립니다. 설명이 짧으면 칸도 적어야 맞습니다.
특히 내가 말하지 않았다면 넣지 말 것: 다시 사는 별도 문턱(나가는 규칙이 풀리면 다시 사는 것으로 충분), 완충 띠·확인 일수,
추가 필터·손절·나눠 사기·최소 보유 기간, 매매 종목과 다른 '신호 종목'('A 를 보고 B 를 사고판다'고 했을 때만).

꼭 만들어야 하는 칸:
1) 매매 종목 — 내가 말한 종목이 기본값, 선택지는 비슷한 종목들(tqqq, qld, spxl, sso, qqq, spy · 헤지 전략이면 sqqq). 코드에서는 data[p.<id>] 로 꺼냅니다(data.tqqq 처럼 고정하지 않기).
2) 빠져 있을 때 들고 있을 것 — 빠지는 상태가 있는 전략만. "cash" 를 꼭 넣으세요. 예: ["cash", "qqq", "spy", "sso", "qld"], 기본 "cash".
   "cash" 는 아무것도 사지 않은 현금 상태이고 data["cash"] 는 없으니 가격을 꺼내기 전에 막으세요.
3) 설명에 나온 문턱·기간·비율 하나하나("55% 위", "250일 중앙값", "300일 평균") — 숫자를 코드에 박지 말고 칸으로.
4) 현금 이자(연 %) — 현금으로 있을 수 있는 전략만. 예: [0, 0.5, 1, …, 6, 7, 8]
5) 거래 비용 — 모든 전략에 반드시, 정확히 이 모양으로(앱의 다른 전략과 같게):
   { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
   거래 금액의 % 를 매수·매도·갈아타기 양쪽·나눠 사기 한 번마다 매기고, 그 줄의 fee 에 적으세요. 0 을 기본값으로 하거나 빼먹지 마세요.

이동 평균과 중앙값은 서로 바꿔 볼 수 있게: 규칙에 이동 평균이나 이동 중앙값이 들어가면, 설명에 나온 쪽을 기본값으로 하는 칸을 하나 더 만드세요.
   { id: "stat", label: "중심선", options: [ { value: "sma", label: "이동평균" }, { value: "median", label: "중앙값" } ], default: "sma" }
   (설명에 중앙값이라고 했으면 default: "median") — 같은 기간으로, 고른 쪽으로 계산합니다.

### 5-2. 숫자 칸의 선택지 — 넉넉하고 촘촘하게
드롭다운을 펼치면 앱이 선택지마다 끝까지 계산해 결과를 막대로 보여 줍니다. 그래서 숫자 칸은 선택지가 15~40개여야 쓸모가 있습니다
(2~3개짜리 숫자 칸은 만들지 마세요). 내가 말한 값을 가운데 두고 양쪽으로 넓게, 가까운 곳은 촘촘히·먼 곳은 성기게
— 예: 기간 [20, 30, 40, …, 300, 320, 350, 400] 이 [100, 200, 300] 보다 낫습니다.

## 6. 표 열 설명(columns)과 신호 차트(lines)
- columns : 4장에서 새로 만든 키마다 { key, label, tip } 하나. tip 은 열 이름 옆 ⓘ 에 뜨는 쉬운 설명입니다
  (무엇을 잰 값인지, 언제 비는지, 어떤 열과 같이 보면 되는지). 기본 키(date, value, action, held, price, shares, cash, invested, contributed, fee)는 앱이 설명하므로 쓰지 않아도 됩니다.
- lines : 규칙이 가격을 어떤 기준선(이동 평균, 중앙값, 과열 띠, 손절선 등)과 비교한다면 그 선들을 { key, label } 로, 최대 6개.
  key 는 값이 생긴 뒤의 모든 기록 줄에 넣는 숫자 키이고(값이 아직 없는 초반 줄은 빼도 됨), 비교하는 가격과 같은 단위로 넣습니다.
  비교되는 가격 자체도 첫 선으로 넣으세요(예: { key: "signalPrice", label: "QQQ 종가" }).
  이 선들은 본 차트가 아니라 전략 설정 창 안의 작은 '신호 차트'에 그려집니다.

## 7. 오늘의 판단판(signals) — 꼭 넣기
기록과 함께, 계산 마지막 날(p.endIdx) 규칙들이 어떤 상태인지 signals 로 돌려주세요. 사용자는 기록을 읽지 않아도 '오늘 새 돈을 넣으면 무엇을 하나'를 봅니다.
마지막 날 이미 계산해 둔 변수로 만들고, 전략을 한 번 더 돌리지 마세요.
- cards : 계기판 4~6개. 각 { label, value, sub, tip, tone, icon }
  - label 짧은 이름(예: "QQQ vs 200일 평균") · value 큰 글자(예: "▲ +6.42%", "77") · sub 아래 작은 줄(예: "$740.86 vs 평균 $696.17")
  - tip 이 값이 무엇이고 판단을 어느 쪽으로 미는지 · tone "good"(투자 쪽) / "bad"(빠지는 쪽) / 생략(중립) — 숫자의 부호가 아니라 상태로
  - icon 은 trendUp, trendDown, clock, sliders, activity, shield, dollar, flag 중 하나
  - 전략이 쓰는 규칙마다 하나씩(추세, 각 지표, 우선 규칙, 완충 등) — 설정 칸의 값이 지금 어떤 상태인지 다 보이게
- decision : 오늘 목돈을 넣는다면 — { action, note, tone, reasons }
  - action 2~4 낱말(예: "TQQQ 매수", "현금 유지") · note 짧은 이유 · tone 투자 쪽 "good", 빠지는 쪽 "bad"
  - reasons 규칙마다 한 줄 { name, val, tag, lean } — 예: { name: "추세", val: "QQQ +6.42% vs 200일", tag: "위 · TQQQ", lean: "buy" }
    lean 은 "buy", "out", "cash", "hold" 중 하나(줄 앞 점의 색)
  - 판단은 코드의 규칙과 같은 변수에서 나와야 합니다. 설명을 다시 해석해 따로 만들지 마세요.

## 8. 계산할 때 지킬 것
- 현금과 보유 주수는 코드 안의 변수로 직접 관리합니다. 앱이 대신 투자해 주는 것은 없습니다.
- 사고팔기는 그날 종가(data[id][i])로. 그날까지의 값으로만 판단하고 다음 날 이후 값은 보지 마세요.
- TQQQ·QLD·SSO·SPXL·SQQQ 는 이미 레버리지 상품입니다. 빚을 내거나 배율을 더 키우지 마세요.
  SQQQ 는 −3배 인버스라 나스닥이 오르거나 횡보하면 빠르게 녹습니다 — 짧은 헤지로만 말이 됩니다.
- 설명이 이름 있는 공개 전략(9sig, 듀얼 모멘텀, HFEA, 올웨더, 200일선 타이밍 등)을 가리키면, 이름으로 짐작하지 말고
  (검색할 수 있으면 찾아서) 실제로 알려진 규칙과 숫자를 그대로 구현하세요.

## 9. 다 만든 예 (모양 참고용 — 내 전략과 다르니 그대로 쓰지 마세요)
{
  name: "중앙값 추세 + 아래 확인",
  // 이 예가 구현한 설명: "QQQ 가 200일 중앙값 위면 TQQQ 를 사고, 3거래일 연속 중앙값 아래면 팔고 현금으로."
  // 칸마다 출처: 매매 종목(TQQQ) · 빠졌을 때(현금) · 신호 종목(QQQ 를 보고 TQQQ 를 매매) · 기간(200일)
  //   · 중심선(중앙값 — 평균과 바꿔 보기) · 아래 확인(3거래일) · 현금 이자 · 거래 비용
  params: [
    { section: "보유 종목" },
    { id: "asset", label: "매매 종목", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] },
    { id: "out", label: "빠졌을 때", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    { section: "신호" },
    { id: "signal", label: "신호 종목", default: "qqq", options: [
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "tqqq", label: "TQQQ" } ] },
    { id: "days", label: "기간 (거래일)", default: 200, options: [
      30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230,240,250,260,280,300,330,360,400] },
    { id: "stat", label: "중심선", default: "median", options: [
      { value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" } ] },
    { id: "confirm", label: "아래 확인 (거래일)", default: 3, options: [
      1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,20,25,30] },
    { section: "실행·비용" },
    { id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "signalPrice", label: "신호 종가", tip: "추세를 보는 종목(기본 QQQ)의 그날 종가입니다. 사고파는 종목과 다를 수 있습니다." },
    { key: "centerPrice", label: "중심선", tip: "신호 종목의 최근 N거래일 중앙값(또는 평균)입니다. 종가가 이보다 위면 매매 종목을 듭니다." },
    { key: "gapPct", label: "중심선과 차이", tip: "종가가 중심선보다 몇 % 위(+)·아래(−)인지입니다. 아래가 확인 일수만큼 이어지면 팝니다." }
  ],
  lines: [
    { key: "signalPrice", label: "신호 종가" },
    { key: "centerPrice", label: "중심선" }
  ],
  run(data, p) {
    const dates = data.dates, sig = data[p.signal] || data.qqq;
    const close = (id, i) => (id === "cash" || !data[id] ? 0 : data[id][i] || 0);
    const N = p.days, cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const weekOf = (d) => Math.floor((Date.parse(d) / 86400000 + 3) / 7);
    // 최근 N 거래일 창: 들어온 순서(queue)와 크기 순서(sorted)를 함께 두고 하루에 하나씩 넣고 뺌
    const queue = [], sorted = [];
    let total = 0;
    const push = (v) => {
      queue.push(v); total += v;
      let k = 0;
      while (k < sorted.length && sorted[k] < v) k++;
      sorted.splice(k, 0, v);
      if (queue.length > N) { const old = queue.shift(); total -= old; sorted.splice(sorted.indexOf(old), 1); }
    };
    const centerNow = () => {
      const n = sorted.length;
      if (n < N) return 0;   // 창이 다 차기 전에는 판단하지 않음
      if (p.stat !== "median") return total / n;
      const h = n >> 1;
      return n % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
    };
    for (let k = Math.max(0, p.startIdx - N); k < p.startIdx; k++) if (sig[k] > 0) push(sig[k]);

    const log = [];
    let cash = p.initial, units = 0, hold = "cash", invested = p.initial;
    let center = 0, gap = 0, below = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (sig[i] > 0) push(sig[i]);
      let action = "hold", note = "", fee = 0, contributed = 0;
      cash *= 1 + dayRate;
      const amt = p.contributions[dates[i]] || 0;
      if (amt !== 0) {
        cash += amt; contributed = amt; invested += amt; action = "contribution";
<<출금 처리>>
      }
      center = centerNow();
      gap = center > 0 && sig[i] > 0 ? sig[i] / center - 1 : 0;
      below = center > 0 && gap < 0 ? below + 1 : 0;
      let want = hold;
      if (center > 0) {
        if (gap > 0) want = p.asset;
        else if (below >= p.confirm) want = p.out;
      }
      if (want !== hold) {
        const pxOld = close(hold, i), pxNew = close(want, i);
        if (hold !== "cash" && pxOld > 0) { const g = units * pxOld; fee += g * cost; cash += g * (1 - cost); units = 0; }
        if (want !== "cash" && pxNew > 0) { fee += cash * cost; units = cash * (1 - cost) / pxNew; cash = 0; }
        action = hold === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = "중심선과 " + (gap >= 0 ? "+" : "") + (gap * 100).toFixed(1) + "%";
        hold = want;
      } else if (hold !== "cash" && cash > 0 && close(hold, i) > 0) {
        // 들어온 적립금은 들고 있는 종목으로 바로
        fee += cash * cost; units += cash * (1 - cost) / close(hold, i); cash = 0;
      }
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      const next = i < p.endIdx ? dates[i + 1] : null;
      const lastOfMonth = !next || next.slice(0, 7) !== dates[i].slice(0, 7);
      const lastOfWeek = p.weeklyDisplay && (!next || weekOf(next) !== weekOf(dates[i]));
      if (action !== "hold" || contributed !== 0 || lastOfMonth || lastOfWeek) {
        const px = close(hold, i), stock = units * px;
        const row = { date: dates[i], value: stock + cash, action: action, note: note, held: hold.toUpperCase(),
          price: px, shares: units, holdingsValue: stock, cash: cash, invested: invested, contributed: contributed, fee: fee,
          signalPrice: sig[i] };
        if (center > 0) { row.centerPrice = center; row.gapPct = gap * 100; }
        log.push(row);
      }
    }

    const A = p.asset.toUpperCase(), O = p.out === "cash" ? "현금" : p.out.toUpperCase(), SG = p.signal.toUpperCase();
    const up = gap > 0, out = !up && below >= p.confirm;
    const gapTxt = (gap >= 0 ? "+" : "") + (gap * 100).toFixed(2) + "%";
    const statName = p.stat === "median" ? "중앙값" : "평균";
    return {
      log: log,
      signals: {
        cards: [
          { label: SG + " vs " + N + "일 " + statName, value: (up ? "▲ " : "▼ ") + gapTxt, tone: up ? "good" : "bad", icon: up ? "trendUp" : "trendDown",
            sub: "종가 " + sig[p.endIdx].toFixed(2) + " · 중심선 " + center.toFixed(2),
            tip: "신호 종목의 마지막 종가와 최근 " + N + "거래일 " + statName + "입니다. 위면 " + A + " 를 들고, 아래가 " + p.confirm + "거래일 이어지면 " + O + "(으)로 옮깁니다." },
          { label: "아래에 머문 날", value: below + " / " + p.confirm + "일", tone: out ? "bad" : "good", icon: "clock",
            sub: below ? "중심선 아래 " + below + "거래일째" : "중심선 위",
            tip: "중심선 아래로 내려간 뒤 이어진 거래일 수입니다. 확인 일수에 닿으면 팝니다 — 하루 이틀 흔들림에 팔지 않으려는 장치입니다." },
          { label: "지금 보유", value: hold === "cash" ? "현금" : hold.toUpperCase(), icon: "shield",
            sub: "계좌 $" + Math.round(units * close(hold, p.endIdx) + cash).toLocaleString("en-US"),
            tip: "계산 마지막 날 들고 있는 것과 계좌 금액입니다." },
          { label: "현금 이자", value: "연 " + (p.cashRate || 0) + "%", icon: "dollar", sub: "현금으로 있을 때",
            tip: "빠져 있는 동안 현금에 붙는 이자입니다. 빠지는 대신 다른 종목을 고르면 쓰이지 않습니다." }
        ],
        decision: {
          action: up ? A + " 매수" : out ? (O === "현금" ? "현금 유지" : O + " 매수") : (hold === "cash" ? "현금 유지" : hold.toUpperCase() + " 보유"),
          note: up ? "종가가 중심선 위" : out ? "중심선 아래가 확인됨" : "중심선 아래지만 아직 확인 전",
          tone: up || (!out && hold !== "cash") ? "good" : "bad",
          reasons: [
            { name: "추세", val: SG + " " + gapTxt + " vs " + N + "일", tag: up ? "위 · " + A : "아래", lean: up ? "buy" : "out" },
            { name: "확인", val: below + "/" + p.confirm + "거래일", tag: out ? "빠짐 · " + O : "유지", lean: out ? "cash" : "hold" }
          ]
        }
      }
    };
  }
}

## 10. 내 전략 (이 설명대로 코드를 써 주세요)
<<여기에 내 전략 설명>>`;

function ssBuildPrompt(desc) {
  const d = String(desc || '').trim();
  return SS_PROMPT.replace('<<출금 처리>>', () => SS_WITHDRAW_SNIPPET).replace('<<여기에 내 전략 설명>>', () => d || '<<여기에 내 전략 설명>>');
}

/* ═══ 49-app.js ═══ */
/* ── [STRATSIM] 49 화면 뼈대 · 왼쪽 입력 · 위 도구 막대 · 공유 ─────────────────── */

// 상태가 바뀌면: 저장 → 주소 # → 다시 계산·그리기
function ssChanged() {
  if (!ssReady) return;
  ssPersistMain();
  ssRender();
  ssSyncHash();
}
// 다시 그린 뒤 따라 고칠 것들
function ssAfterRender() {
  ssLegend.render();
  ssRenderPills();
  ssTxSummary();
  if (ssPanel.open) ssRenderPanel();
  if (typeof ssAnalyticsRefresh === 'function') ssAnalyticsRefresh();
  ssShareCard();
}

const SS_SVG = {
  cal: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  first: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><line x1="6" y1="12" x2="20" y2="12"/><line x1="3" y1="5" x2="3" y2="19"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  grid: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
};

function ssShellHtml() {
  const raise = SS_RAISE_OPTS.map((v) => '<option value="' + v + '">' + v + '%</option>').join('');
  return '<div class="ss-top">'
    + '<span class="ss-fetched" id="ss-fetched" hidden title="미국 장이 열린 동안 한 시간마다(마감 뒤 한 번 더) 새 일봉을 받습니다 — 자료 출처는 아래 설명글">가격 자료 갱신 <b id="ss-fetched-t"></b></span>'
    + '<div class="ss-topr"><details class="ss-res" id="ss-res"><summary>자료실 <i>▾</i></summary><div class="ss-resl">'
    + '<a href="tqqq-intraday/">TQQQ 장중 흐름</a><a href="9sig-overfit/">9sig 과최적화 탐색기</a><a href="sma-overfit/">SMA 과최적화 탐색기</a>'
    + '<a href="muhan/">무한매수법</a><a href="muhan-backtest/">무한매수법 백테스트</a><a href="vr/">밸류리밸런싱 VR 5.0</a><a href="vr-backtest/">밸류리밸런싱 VR 5.0 백테스트</a></div></details>'   // 상단 메뉴 '투자전략 자료실'과 같은 목록(2026-10-24)
    + '<button type="button" class="ss-btn ss-sharebtn" id="ss-share" data-ss-share title="지금 설정 그대로 열리는 링크 복사">' + SS_SVG.link + '<span>링크 복사</span></button></div></div>'
    + '<div class="ss-layout">'
    + '<aside class="ss-side card"><div class="ss-sidehead"><button type="button" class="ss-btn ss-anbtn" id="ss-an-open">' + SS_SVG.grid + ' 분석 표</button></div>'
    + '<button type="button" class="ss-btn ss-txmode" id="ss-txmode" hidden></button>'
    + '<div id="ss-contrib">'
    + '<div class="ss-ctl"><div class="ss-ctlh"><label for="ss-init">시작 금액</label><b class="ss-val" id="ss-dinit">$10,000</b></div><input type="range" class="ss-range" id="ss-init" min="0" max="1000" step="1" value="333" aria-label="시작 금액"></div>'
    + '<div class="ss-ctl"><div class="ss-ctlh"><label for="ss-mon">매달 적립</label><span class="ss-ctlr"><b class="ss-val" id="ss-dmon">$500</b><button type="button" class="ss-ibtn" id="ss-txopen" title="슬라이더 대신 내 실제 거래내역 쓰기" aria-label="실제 거래내역 쓰기">' + SS_SVG.up + '</button></span></div>'
    + '<label class="ss-raise" for="ss-raise"><span>해마다</span><select id="ss-raise" class="ss-isel">' + raise + '</select><span>씩 늘림</span></label>'
    + '<input type="range" class="ss-range" id="ss-mon" min="0" max="1000" step="1" value="233" aria-label="매달 적립"></div></div>'
    + '<div id="ss-txon" class="ss-ctl" hidden><div class="ss-txsum" id="ss-txsum"></div><div class="ss-txbtns"><button type="button" class="ss-ibtn" id="ss-txedit" title="거래내역 고치기">' + SS_SVG.edit + '</button><button type="button" class="ss-ibtn" id="ss-txfirst" title="진입일을 첫 거래일로">' + SS_SVG.first + '</button><button type="button" class="ss-ibtn danger" id="ss-txdel" title="거래내역 완전히 지우기">' + SS_SVG.trash + '</button></div></div>'
    + '<button type="button" class="ss-newc" id="ss-newc">+ 사용자 전략 (코드)</button>'
    + '<button type="button" class="ss-libbtn" id="ss-libbtn">' + SS_SVG.book + ' 전략 라이브러리</button>'
    + '<div class="ss-pills" id="ss-pills" hidden></div></aside>'
    + '<section class="ss-main card"><div class="ss-legend" id="ss-legend"></div>'
    + '<div class="ss-chartbox" id="ss-chartbox"><canvas id="ss-chart" role="img" aria-label="전략별 평가액 차트"></canvas>'
    + '<div class="ss-loading" id="ss-loading"><div class="ss-spin"></div><div id="ss-loading-t">가격 자료를 불러오는 중…</div></div>'
    + '<button type="button" class="ss-pillbtn ss-logbtn" id="ss-log" aria-pressed="false" title="세로축을 로그 눈금으로">로그</button>'
    + '<button type="button" class="ss-pillbtn ss-inflbtn" id="ss-infl" aria-pressed="false" title="모든 선을 연 3% 물가로 할인 — 첫 날 기준의 실질 금액으로 보기">물가 반영</button>'
    + '<button type="button" class="ss-pillbtn ss-zoombtn" id="ss-zoom" hidden title="확대를 풀고 전체 기간 보기 (그래프 더블클릭도 같음)">전체 보기</button></div>'
    + '<div id="ss-tip"></div>'
    + '<div class="ss-period"><button type="button" class="ss-play" id="ss-play-l" aria-pressed="false" title="한 분기씩 뒤로 · 재생">◀</button>'
    + '<div class="ss-range2" id="ss-range"><div class="ss-rtrack"></div><div class="ss-rfill"></div>'
    + '<div class="ss-td" id="ss-tde"><span>진입</span><div class="ss-tdr"><b id="ss-de">2010년 1분기</b><button type="button" class="ss-ibtn" id="ss-pick-e" title="진입일 정확히 고르기" aria-label="진입일 정확히 고르기">' + SS_SVG.cal + '</button></div></div>'
    + '<div class="ss-td" id="ss-tdx"><span>청산</span><div class="ss-tdr"><b id="ss-dx">—</b><button type="button" class="ss-ibtn" id="ss-pick-x" title="청산일 정확히 고르기" aria-label="청산일 정확히 고르기">' + SS_SVG.cal + '</button></div></div>'
    + '<div class="ss-th" data-h="e" role="slider" aria-label="진입"></div><div class="ss-th" data-h="x" role="slider" aria-label="청산"></div></div>'
    + '<button type="button" class="ss-play" id="ss-play-r" aria-pressed="false" title="한 분기씩 앞으로 · 재생">▶</button></div>'
    + '</section></div>';
}
function ssPanelShell() {
  return '<div class="ss-pin"><div class="ss-phead"><div class="ss-ptw"><h3 id="ss-ptitle" contenteditable="true" spellcheck="false" title="눌러서 이름 바꾸기">전략</h3><button type="button" class="ss-pedit" aria-label="이름 바꾸기" tabindex="-1">' + SS_SVG.edit + '</button></div>'
    + '<button type="button" class="ss-pclose" aria-label="닫기">×</button></div><div class="ss-pbody" id="ss-pbody"></div><div class="ss-presize" title="끌어서 너비 조절"></div></div>';
}

// ── 왼쪽 입력 ──
const ssSideUI = {
  update(initial, monthly) {
    const di = document.getElementById('ss-dinit'), dm = document.getElementById('ss-dmon');
    if (di) di.textContent = ssMoney(initial);
    if (dm) dm.textContent = ssMoney(monthly);
    const i = document.getElementById('ss-init'), m = document.getElementById('ss-mon'), r = document.getElementById('ss-raise');
    if (i && +i.value !== S.iPos) i.value = S.iPos;
    if (m && +m.value !== S.mPos) m.value = S.mPos;
    if (r && r.value !== S.raise) r.value = S.raise;
    const lg = document.getElementById('ss-log'), fl = document.getElementById('ss-infl');
    if (lg) lg.setAttribute('aria-pressed', S.log ? 'true' : 'false');
    if (fl) fl.setAttribute('aria-pressed', S.infl ? 'true' : 'false');
  },
};
// 거래내역 요약 · 켜기/끄기 단추
function ssTxSummary() {
  const on = !!S.tx, a = document.getElementById('ss-contrib'), b = document.getElementById('ss-txon'), mode = document.getElementById('ss-txmode');
  if (!a || !b) return;
  a.hidden = on; b.hidden = !on;
  if (mode) {
    if (S.tx) { mode.hidden = false; mode.textContent = '슬라이더로 바꾸기'; }
    else if (S.txStash) { mode.hidden = false; mode.textContent = '내 거래 ' + S.txStash.rows.length + '건으로 바꾸기'; }
    else mode.hidden = true;
  }
  if (!on) return;
  const s = S.tx, rows = ['<span class="ss-txr"><b>' + s.rows.length + '</b>건 · <b>' + ssMoney(Math.round(s.total)) + '</b> 투자</span>'];
  if (s.source === 'sheet') rows.push('<span class="ss-txr ss-mut">구글 시트와 동기화</span>');
  if (s.actualPoints && s.actualPoints.length) {
    const m = R.actual, sh = s.showActual !== false;
    const st = sh && m && Number.isFinite(m.cagr) ? '<b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b>' + (Number.isFinite(m.maxDD) && m.maxDD > 0 ? ' <span>낙폭 <b class="ss-dn">-' + m.maxDD.toFixed(1) + '%</b></span>' : '') : '';
    rows.push('<span class="ss-txr ss-txact"><button type="button" id="ss-txeye" class="ss-txeye" title="\'내 계좌\' 선 ' + (sh ? '숨기기' : '보이기') + '">' + ssEye(sh) + '</button><i class="ss-cdot" style="background:' + SS_ACTUAL_COLOR + '"></i>내 계좌 ' + st + '</span>');
  }
  document.getElementById('ss-txsum').innerHTML = rows.join('');
  const ed = document.getElementById('ss-txedit'), fs = document.getElementById('ss-txfirst');
  if (ed) ed.title = s.source === 'sheet' ? '연결한 시트 바꾸기' : '거래내역 고치기';
  if (fs) fs.title = '진입일을 첫 거래일(' + ssDate(s.entryDate) + ')로';
}

// 화살표 키: 금액이 실제로 바뀌게 한 칸씩 (로그 눈금이라 위치 1칸은 너무 작음)
function ssArrowStep(el, toV, fromV, steps, max) {
  el.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const cur = toV(+el.value), next = dir > 0 ? cur + steps(cur) : Math.max(0, cur - steps(Math.max(0, cur - 1)));
    let ns = fromV(next), g = 0;
    while (g++ < 2000 && ns >= 0 && ns <= max && ((dir > 0 && toV(ns) <= cur) || (dir < 0 && toV(ns) >= cur))) ns += dir;
    el.value = String(Math.max(0, Math.min(max, ns)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function ssWireShell(root) {
  const $ = (id) => document.getElementById(id);
  $('ss-init').addEventListener('input', (e) => { S.iPos = +e.target.value; ssChanged(); });
  $('ss-mon').addEventListener('input', (e) => { S.mPos = +e.target.value; ssChanged(); });
  $('ss-raise').addEventListener('change', (e) => { S.raise = e.target.value; ssChanged(); });
  ssArrowStep($('ss-init'), ssPosToInitial, ssInitialToPos, (v) => (v < 1e4 ? 100 : v < 1e5 ? 1e3 : v < 1e6 ? 1e4 : v < 1e7 ? 1e5 : 1e6), 1000);
  ssArrowStep($('ss-mon'), ssPosToMonthly, ssMonthlyToPos, (v) => (v < 1500 ? 50 : v < 1e4 ? 100 : v < 1e5 ? 1000 : 10000), 1000);
  $('ss-log').addEventListener('click', () => { S.log = !S.log; ssChanged(); });
  $('ss-infl').addEventListener('click', () => { S.infl = !S.infl; ssChanged(); });
  $('ss-legend').addEventListener('click', (e) => {
    const more = e.target.closest('[data-lg-more]');
    if (more) { ssOpenBasePanel(more.getAttribute('data-lg-more')); return; }
    const chip = e.target.closest('[data-lg]');
    if (!chip) return;
    const k = chip.getAttribute('data-lg');
    const show = S.hide[k];
    S.hide[k] = !show;
    if (show && S.panel !== k) S.base[k] = ssDefaults(k);   // 다시 보이면 기본값으로
    ssChanged();
  });
  $('ss-legend').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-lg]')) { e.preventDefault(); e.target.click(); } });
  $('ss-newc').addEventListener('click', () => ssCreateCustom());
  $('ss-libbtn').addEventListener('click', () => { if (typeof ssLibraryOpen === 'function') ssLibraryOpen(); });
  $('ss-an-open').addEventListener('click', () => { if (typeof ssAnalyticsToggle === 'function') ssAnalyticsToggle(); });
  $('ss-share').addEventListener('click', async () => {
    const b = $('ss-share'), url = await ssShareUrl();
    ssCopy(url, () => { const sp = b.querySelector('span'); sp.textContent = '복사됨 ✓'; b.classList.add('flash'); setTimeout(() => { sp.textContent = '링크 복사'; b.classList.remove('flash'); }, 1800); });
  });
  document.addEventListener('click', (e) => { const m = $('ss-res'); if (m && m.open && !m.contains(e.target)) m.open = false; });
  // 거래내역
  $('ss-txopen').addEventListener('click', () => ssTxOpen());
  $('ss-txedit').addEventListener('click', () => {
    const s = S.tx || S.txStash;
    if (!s) return;
    if (s.source === 'sheet' && s.sheetUrl) ssTxOpen({ url: s.sheetUrl, edit: true, cols: { dc: s.dc, ac: s.ac, xc: s.xc } });
    else ssTxOpen({ text: ssTxToTsv(s.rows), edit: true });
  });
  $('ss-txfirst').addEventListener('click', () => { if (!S.tx) return; ssTxApplyEntry(); ssChanged(); });
  $('ss-txdel').addEventListener('click', () => ssDialog('거래내역 지우기', '저장해 둔 거래내역을 완전히 지울까요? 되돌릴 수 없습니다.', [{ t: '취소' }, { t: '지우기', danger: true, fn: () => { S.tx = null; S.txStash = null; S.ed = ''; ssTxPersist(); ssChanged(); } }]));
  $('ss-txmode').addEventListener('click', () => {
    if (S.tx) { S.tx = null; S.ed = ''; }
    else if (S.txStash) S.tx = S.txStash;
    else return;
    ssTxPersist(); ssChanged();
    if (S.tx) ssTxRefreshSheet();
  });
  $('ss-txsum').addEventListener('click', (e) => {
    if (!e.target.closest('#ss-txeye')) return;
    const cur = S.tx || S.txStash;
    if (!cur) return;
    cur.showActual = cur.showActual === false;
    ssTxPersist(); ssChanged();
  });
}

// 사이트 오른쪽 아래 공유 창의 카드 (지금 보이는 선 중 끝 금액이 가장 큰 것)
function ssShareCard() {
  const reg = (window.dcShareSpec = window.dcShareSpec || {});
  reg['strategy-simulator'] = function () {
    if (!R.ctx || !R.labels.length) return null;
    const vis = R.datasets.filter((d) => !d.hidden && !d.sub && R.metrics[d._key]);
    if (!vis.length) return null;
    const best = vis.slice().sort((a, b) => (R.metrics[b._key].end || 0) - (R.metrics[a._key].end || 0))[0];
    const m = R.metrics[best._key];
    const rows = vis.slice(0, 4).map((d) => { const x = R.metrics[d._key]; return [d.label, (x.cagr >= 0 ? '+' : '') + x.cagr.toFixed(1) + '% · 낙폭 ' + ssDD(x.maxDD), false]; });
    return { key: 'strategy-simulator', chip: '투자전략 시뮬레이터', title: best.label + ' 백테스트',
      label: ssDate(R.ctx.d0) + ' ~ ' + ssDate(R.ctx.d1) + ' · 시작 ' + ssMoney(R.ctx.initial) + ' + 매달 ' + ssMoney(R.ctx.monthly),
      big: (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%', sub: '연평균 수익률(돈 가중) · 끝 금액 ' + ssMoney(m.end), rows,
      source: '실제·합성 일봉 기준 백테스트 · 과거 결과는 미래를 보장하지 않음' };
  };
}

/* ═══ 50-analytics.js ═══ */
/* ── [STRATSIM] 50 분석 창 — 시작 연도 × 보유 기간 히트맵 · 연간 수익률 나선 ─────────────────
   계산 규칙(칸 값·비교 비율·낙폭·열 통계·색 눈금·나선 연간 %)은 원본 Strategies Simulator 의 분석 창과
   같게 맞추고(원본 대조 시험으로 확인) 코드·글은 새로 씀.
   · 칸: 행 = 시작 연도(최근이 위) · 열 = N년 보유. 진입 = 전년 마지막 분기말(첫해는 그해 첫 분기말),
     청산 = (시작 연도 + N − 1)년 마지막 분기말. 한 행은 가장 긴 청산까지 한 번만 계산해 분기 위치로 잘라 씀
   · 색: 비교 대비 비율의 ln 을 전체 칸 최소·최대로 나눠 0.5 중심 → 제곱근 곡선 → 파랑(못함)·회청(비슷)·빨강(나음)
     목표 금액이면 달성(빨강)/미달(파랑) 두 색
   · 목표 성장률(연 %)이면 히트맵 대신 나선 — 해마다 수익률 막대(가운데가 가장 오래된 해, 12시가 올해)
   · 풍선의 기간 연평균(이 사이트에서 더함): 그 전략이 실제로 돈을 넣은 날짜·금액과 칸 값이 나온 날로 푼 돈 가중 연수익률
     (본 화면 '연평균 수익률'과 같은 ssCagrMW) — 열 머리 통계의 연평균도 같은 값으로 (원본은 넣은 돈 합계 대비 단순 연평균)
   · 로그 단추 = 본 차트 '로그'(S.log)와 같은 설정 → 풍선 작은 차트의 평가액 선 · 열 머리 끝 금액 막대
   · 사용자 전략(코드)은 늘 격리 Worker(ssPreviewRun)로만 돌림 — 이 페이지에서 직접 실행하지 않음 */

// ── 선택지 ──
const SS_AN_INIT = [0, 100, 500, 1000, 2000, 3000, 5000, 7500, 1e4, 15000, 20000, 25000, 35000, 50000, 75000, 1e5, 150000, 200000, 250000, 350000, 500000, 750000, 1e6, 1.5e6, 2e6, 3e6, 5e6, 1e7];
const SS_AN_MON = [0, 50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 1e4, 15000, 20000, 25000, 50000, 1e5];
const SS_AN_RATE = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];
// 기본 전략 알약 (원본과 같은 묶음 — 9sig 10칸 · SMA 13칸)
const SS_AN_PILLS = { '9sig': ['ul', 'g', 'per', 'cash', 'cr', 'cd', 'cw', 'sp', 'bp', 'park'], sma: ['ul', 'sig', 'win', 'cr', 'eb', 'xb', 'oh', 'cool', 'out', 'din', 'dout', 'bg', 'bga'] };
const SS_AN_PLAB = {
  '9sig': { cash: '현금 비중', park: '안전 몫', ul: '종목', cr: '현금 이자', per: '리밸런스', g: '목표 성장', cd: '폭락 기준', cw: '고점 기간', st: '급등 뒤 비중', sp: '급등 기준', bp: '매수 한도', cost: '거래 비용', dep: '적립금 바로 투자', rp: '리밸런스 시점', tc: '목표 기준' },
  sma: { ul: '보유 종목', sig: '신호 종목', win: '이동평균(일)', eb: '살 때 여유', xb: '팔 때 여유', cb: '매수 확인(일)', cs: '매도 확인(일)', settle: '결제 대기(일)', ohw: '과열 RSI 기간', oh: 'RSI 과열 매도', coolw: '매수 RSI 기간', cool: 'RSI 매수 조건', out: '나와 있을 때', cr: '현금 이자', din: '나눠 사기', dout: '나눠 옮기기', cost: '거래 비용', bga: '버블 기준 종목', bg: '버블 보험', bgw: '버블 이동평균' },
  bh: { ul: '종목' },
};
// 칸 색: 못함(파랑) → 비슷(회청) → 나음(빨강)
const SS_AN_DN = [49, 130, 246], SS_AN_MID = [71, 85, 105], SS_AN_UP = [240, 68, 82];
const SS_AN_H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

const SAN = {
  dom: null, epoch: 0, timer: null, raf: 0, fitT: null, sig: '', busy: false,
  years: null,                            // { first, last, all, min, max } — 분기 행 기준
  gridKey: '',                            // 지금 그려 둔 표 뼈대 (같으면 옛 색을 둔 채 값만 덮음)
  code: new Map(),                        // 사용자 전략 격리 실행 결과 (조건 키 → 점들)
  cellSim: { key: '', map: new Map() },   // 칸 풍선용 계산 (시작:기간)
  yearSim: { key: '', map: new Map() },   // 나선 풍선용 계산 (그해 시작 → 최신)
  spSim: { key: '', sim: null },          // 나선 전체 기간 계산
  sp: { key: '', points: null, size: 0 }, // 그려 둔 나선
  cg: new Map(),                          // 기간 연평균 (조건 키 → { pct, years })
  ui: {}, hl: '', tipFor: '', warming: '', h2c: null, lock: null,
};

// ── 키 · 이름 ──
const ssAnIsCfg = (k) => typeof k === 'string' && k.indexOf('cfg:') === 0;
const ssAnCfg = (k) => (ssAnIsCfg(k) ? ssFindCfg(k.slice(4)) : null);
const ssAnIsBh = (k) => typeof k === 'string' && k.indexOf('bh-') === 0 && SS_COL[k.slice(3)] != null;
const ssAnBuiltin = (k) => k === '9sig' || k === 'sma' || ssAnIsBh(k);
const ssAnBhUl = () => String((S.base.bh && S.base.bh.ul) || 'tqqq').toLowerCase();
function ssAnLabel(k) {
  if (k === 'compounded') return '현금 복리';
  if (k === 'custom') return '목표 금액';
  if (k === 'custom-pct') return '목표 성장률';
  if (ssAnIsCfg(k)) { const c = ssAnCfg(k); return c ? c.name : '저장 전략'; }
  if (k === 'sma') return 'SMA';
  if (ssAnIsBh(k)) return '그냥 보유 ' + k.slice(3).toUpperCase();
  return String(k || '');
}
// 고를 수 있는 기본 전략 (그냥 보유는 왼쪽 그냥 보유 칸의 종목 · 이미 고른 다른 종목도 남겨 둠)
function ssAnBuiltins(sel) {
  const ul = ssAnBhUl(), list = [['9sig', '9sig'], ['bh-' + ul, '그냥 보유 ' + ul.toUpperCase()], ['sma', 'SMA']];
  if (ssAnIsBh(sel) && !list.some((x) => x[0] === sel)) list.push([sel, ssAnLabel(sel)]);
  return list;
}

// ── 입력 · 연도 ──
function ssAnInputs() {
  return { initial: ssPosToInitial(S.iPos), monthly: ssPosToMonthly(S.mPos), raise: (+S.raise || 0) / 100, rate: ssPosToRate(+S.base.invested.r || 0) / 100 };
}
function ssAnYears() {
  if (SAN.years && SAN.years.n === DS.q.length) return SAN.years;
  const first = new Map(), last = new Map();
  for (let i = 0; i < DS.q.length; i++) {
    const y = parseInt(DS.q[i][0].slice(0, 4), 10);
    if (!first.has(y)) first.set(y, i);
    last.set(y, i);
  }
  const all = Array.from(first.keys()).sort((a, b) => a - b);
  SAN.years = { n: DS.q.length, first, last, all, min: all[0], max: all[all.length - 1] };
  return SAN.years;
}
// 그 키가 처음 쓸 수 있는 분기 — SMA 만 이동평균이 생기기 전 구간을 뺌
function ssAnFloor(k) {
  if (k !== 'sma') return 0;
  const p = S.base.sma, ser = ssInd('sma', p.sig || 'qqq', +p.win || 200, true);
  if (!ser) return 0;
  let fm = -1;
  for (let i = 0; i < ser.length; i++) if (ser[i] != null) { fm = i; break; }
  if (fm < 0) return 0;
  const d = DS.m[fm][0];
  for (let q = 0; q < DS.q.length; q++) if (DS.q[q][0] >= d) return q;
  return 0;
}
// 칸 (시작 연도, 보유 기간) → 분기 진입·청산 위치
function ssAnCellRange(sy, p) {
  const Y = ssAnYears(), ey = sy + p - 1;
  const e = Y.last.has(sy - 1) ? Y.last.get(sy - 1) : Y.first.get(sy), x = Y.last.get(ey);
  return e == null || x == null || x <= e ? null : { e, x };
}
// 그해 시작 → 최신 분기 (나선 풍선)
function ssAnYearRange(y) {
  const Y = ssAnYears();
  const e = Y.last.has(y - 1) ? Y.last.get(y - 1) : Y.first.get(y), x = DS.q.length - 1;
  return e == null || x <= e ? null : { e, x };
}

// ── 계산 ──
const ssAnNeeds = (keys) => ({ n9: keys.some((k) => k === '9sig' || k === 'compounded' || ssAnIsBh(k)), sma: keys.indexOf('sma') >= 0 });
// 기본 전략 한 번 계산: 9sig(왼쪽 기본 9sig 설정 · 그 주기) + 그냥 보유 7종 + 현금 복리, SMA 는 필요할 때만
function ssAnSim(inp, qi0, qi1, needs) {
  const out = { log: null, bh: null, sma: null };
  if (needs.n9) {
    const p9 = S.base['9sig'];
    const r = ssRun9(Object.assign({ initial: inp.initial, monthly: inp.monthly, raise: inp.raise, rate: ssRate9(p9), baseRate: inp.rate, qi0, qi1, period: p9.per || 'quarterly' }, ssOpts9(p9)));
    out.log = r.log; out.bh = r.bh;
  }
  if (needs.sma) {
    const ps = S.base.sma;
    out.sma = ssRunSma(Object.assign({ initial: inp.initial, monthly: inp.monthly, raise: inp.raise, rate: ssRate9(ps), qi0, qi1 }, ssOptsSma(ps))).points;
  }
  return out;
}
function ssAnSimPoints(sim, k) {
  if (!sim) return [];
  if (k === '9sig') return (sim.log || []).map((l) => ({ date: l.date, value: l.total }));
  if (k === 'compounded') return (sim.log || []).map((l) => ({ date: l.date, value: l.base }));
  if (k === 'sma') return (sim.sma || []).map((p) => ({ date: p.date, value: p.value }));
  if (ssAnIsBh(k)) return ((sim.bh && sim.bh[k.slice(3)]) || []).map((p) => ({ date: p.date, value: p.value }));
  return [];
}
// 저장 전략(설정형)은 자기 설정으로 그 구간만 계산 — 화면의 선·캐시는 건드리지 않음
function ssAnCfgPoints(cfg, inp, qi0, qi1) {
  const p = cfg.params || {}, base = { initial: inp.initial, monthly: inp.monthly, raise: inp.raise, qi0, qi1 };
  if (cfg.type === '9sig') {
    // 리밸런스 시점을 옮긴 설정(rp)은 본 화면(ssCfgSeries)과 같은 옮긴 행으로 — 행이 진입일부터 같은 간격이라 칸의 값·날짜가 본 화면과 같음
    const per = p.per || 'quarterly', rp = +p.rp || 0;
    let rows = null;
    if (rp > 0) { const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1)); const q = ssShiftRows(per, off, DS.q[qi0][0], DS.q[qi1][0]); if (q && q.length >= 2) rows = q; }
    const r = ssRun9(Object.assign(base, { rate: ssRate9(p), period: per, rows, noBH: true }, ssOpts9(p)));
    return r.log.map((l) => ({ date: l.date, value: l.total }));
  }
  if (cfg.type === 'sma') return ssRunSma(Object.assign(base, { rate: ssRate9(p) }, ssOptsSma(p))).points.map((pt) => ({ date: pt.date, value: pt.value }));
  if (cfg.type === 'bh') {
    const r = ssRun9(Object.assign(base, { rate: 0 })), key = SS_COL[p.ul] ? p.ul : 'tqqq';
    return (r.bh[key] || []).map((pt) => ({ date: pt.date, value: pt.value }));
  }
  if (cfg.type === 'invested') {
    const r = ssRun9(Object.assign(base, { rate: 0, baseRate: ssPosToRate(+p.r || 0) / 100, noBH: true }));
    return r.log.map((l) => ({ date: l.date, value: l.base }));
  }
  return [];
}
// 사용자 전략(코드) — 격리 Worker 로 그 구간 실행 (결과는 조건 키로 기억)
const ssAnCodeKey = (cfg, inp, qi0, qi1) => [cfg.id, cfg.code || '', JSON.stringify(cfg.params || {}), inp.initial, inp.monthly, inp.raise, qi0, qi1].join('|');
function ssAnCodeCached(cfg, inp, qi0, qi1) { const k = ssAnCodeKey(cfg, inp, qi0, qi1); return SAN.code.has(k) ? SAN.code.get(k) : null; }
function ssAnCodeRun(cfg, inp, qi0, qi1) {
  const ck = ssAnCodeKey(cfg, inp, qi0, qi1);
  if (SAN.code.has(ck)) return Promise.resolve(SAN.code.get(ck));
  return new Promise((resolve) => {
    const keep = (pts) => { if (SAN.code.size > 600) SAN.code.clear(); SAN.code.set(ck, pts); resolve(pts); };
    if (!cfg.code || !String(cfg.code).trim()) { keep([]); return; }
    const g = ssCustomGlobals({ initial: inp.initial, monthly: inp.monthly, raise: inp.raise, qi0, qi1, ed: '', xd: '', sched: null, grain: '' });
    ssPreviewRun(cfg.code, cfg.params || {}, g, (msg, err) => {
      let pts = [];
      if (!err && msg && Array.isArray(msg.log)) {
        pts = msg.log.filter((r) => r && r.date != null && typeof r.value === 'number' && Number.isFinite(r.value)).map((r) => ({ date: String(r.date), value: r.value }));
      }
      keep(pts);
    });
  });
}
// 한 행(진입 → 가장 긴 청산)의 분기 값 — 행 날짜마다 그 날 이하 마지막 값, 못 구하면 0
// 연평균 계산용으로 .src[i] = 그 값이 나온 점의 날짜, .d0 = 그 전략이 시작 금액을 넣은 날
async function ssAnRowSeries(k, ctx) {
  const n = ctx.dates.length;
  if (k === 'custom') return new Array(n).fill(S.an.target);
  let pts = [];
  if (k === 'compounded' || ssAnBuiltin(k)) pts = ssAnSimPoints(ctx.sim(), k);
  else if (ssAnIsCfg(k)) {
    const c = ssAnCfg(k);
    if (c) pts = c.type === 'custom' ? await ssAnCodeRun(c, ctx.inp, ctx.e, ctx.x) : ssAnCfgPoints(c, ctx.inp, ctx.e, ctx.x);
  }
  if (!pts || !pts.length) return new Array(n).fill(0);
  const out = new Array(n), src = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = ctx.dates[i];
    while (j + 1 < pts.length && pts[j + 1].date <= d) j++;
    const v = pts[j].value;
    out[i] = Number.isFinite(v) ? v : 0;
    src[i] = String(pts[j].date);
  }
  out.src = src;
  out.d0 = ssAnStartDate(k, ctx.e, pts);
  out.dl = String(pts[pts.length - 1].date);   // 그 계산의 마지막 행 (ssRun9 은 마지막 행에서만 달 중간 적립까지 넣음)
  return out;
}
// 적립 규칙(ssFlows mode): SMA·사용자 코드 = 'day'(날마다 계산 — 달이 바뀐 첫 거래일에 바로) · 현금 복리 = 'r9base' · 9sig·그냥 보유 = 'r9'
function ssAnMode(k) {
  if (k === 'sma') return 'day';
  if (k === 'compounded') return 'r9base';
  const c = ssAnIsCfg(k) ? ssAnCfg(k) : null;
  return !c ? 'r9' : c.type === 'sma' || c.type === 'custom' ? 'day' : c.type === 'invested' ? 'r9base' : 'r9';
}
// 시작 금액을 넣은 날: 날마다 걷는 계산은 진입 분기말(엔진·코드가 받는 진입일), 나머지는 계산의 첫 점(주 단위 9sig 는 그 전 주말일 수 있음)
const ssAnStartDate = (k, e, pts) => (ssAnMode(k) === 'day' ? DS.q[e][0] : pts && pts.length ? String(pts[0].date) : null);
// 기간 연평균(%, 돈 가중) — 그 전략의 계산이 d1 의 값 v 에 실제로 넣은 돈(시작 금액 d0 · 적립 — 날짜·금액)으로 푼 IRR.
// 본 화면 '연평균 수익률'과 같은 계산(ssCagrMW). final = d1 이 그 계산의 마지막 행인지. 못 구하면 null
function ssAnCagr(mode, d0, d1, v, inp, final) {
  if (!d0 || !d1 || !(d1 > d0) || !(v > 0)) return null;
  const key = mode + (final ? 'F' : '') + d0 + d1 + '|' + v + '|' + inp.initial + '|' + inp.monthly + '|' + inp.raise;
  if (SAN.cg.has(key)) return SAN.cg.get(key);
  const years = (Date.parse(d1) - Date.parse(d0)) / SS_YEAR_MS;
  let paid = 0;
  for (const f of ssFlows(inp.initial, inp.monthly, inp.raise, d0, d1, null, mode, !!final)) paid -= f.cf;
  const r = paid > 0 ? ssCagrMW(inp.initial, inp.monthly, inp.raise, d0, d1, years, v, paid, null, mode, !!final) : null;
  const out = Number.isFinite(r) ? { pct: r, years } : null;
  if (SAN.cg.size > 20000) SAN.cg.clear();
  SAN.cg.set(key, out);
  return out;
}
// 앞에서부터의 최대 낙폭 — out[i] = 0..i 구간의 { pct, 고점 위치, 저점 위치 }
function ssAnDDPrefix(s) {
  const out = new Array(s.length);
  let peak = -Infinity, pi = -1, dd = 0, bp = -1, bt = -1;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (Number.isFinite(v)) {
      if (v > peak) { peak = v; pi = i; }
      if (peak > 0) { const d = (peak - v) / peak; if (d > dd) { dd = d; bp = pi; bt = i; } }
    }
    out[i] = { pct: dd, p: bp, t: bt };
  }
  return out;
}

// ── 고른 것 바로잡기 · 처음 열 때 고르기 ──
function ssAnFixKeys() {
  const a = S.an, okS = (k) => ssAnBuiltin(k) || (ssAnIsCfg(k) && !!ssAnCfg(k));
  if (!okS(a.strategy)) a.strategy = '9sig';
  if (!(okS(a.baseline) || a.baseline === 'compounded' || a.baseline === 'custom' || a.baseline === 'custom-pct')) a.baseline = 'compounded';
  if (!(+a.target > 0) || !Number.isFinite(+a.target)) a.target = 1e6;
  a.target = +a.target;
  a.growth = Number.isFinite(+a.growth) ? Math.max(-100, Math.min(100, +a.growth)) : 20;
  const Y = ssAnYears(), fix = (v) => { if (v == null || v === '') return null; const n = Math.round(+v); return Number.isFinite(n) ? Math.max(Y.min, Math.min(Y.max, n)) : null; };
  a.yMin = fix(a.yMin); a.yMax = fix(a.yMax);
  if (a.yMin != null && a.yMax != null && a.yMin > a.yMax) a.yMax = a.yMin;
  if (a.yMin != null && a.yMin <= Y.min) a.yMin = null;
  if (a.yMax != null && a.yMax >= Y.max) a.yMax = null;
}
// 차트에 보이는 선 중 끝 금액이 가장 큰 것 = 볼 전략, 가장 작은 것(현금 복리 포함) = 비교
function ssAnAutoPick() {
  const c = [], M = R.metrics || {};
  if (!S.hide.bh && M.bh && Number.isFinite(M.bh.end)) c.push({ k: 'bh-' + ssAnBhUl(), end: M.bh.end, only: false });
  if (!S.hide.invested && M.invested && Number.isFinite(M.invested.end)) c.push({ k: 'compounded', end: M.invested.end, only: true });
  for (const cfg of S.saved) {
    if (cfg.hidden) continue;
    const m = M['cfg:' + cfg.id];
    if (m && Number.isFinite(m.end)) c.push({ k: 'cfg:' + cfg.id, end: m.end, only: false });
  }
  if (!c.length) return;
  const st = c.filter((x) => !x.only);
  if (st.length) S.an.strategy = st.reduce((a, b) => (b.end > a.end ? b : a)).k;
  const bs = c.filter((x) => x.k !== S.an.strategy);
  if (bs.length) S.an.baseline = bs.reduce((a, b) => (b.end < a.end ? b : a)).k;
}

// ── 화면 뼈대 ──
const SS_AN_ICO = {
  share: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  dl: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  ok: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
};
function ssAnEnsureDom() {
  if (SAN.dom) return SAN.dom;
  const root = document.createElement('div');
  root.className = 'ss-an';
  root.id = 'ss-an';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '분석 표');
  root.tabIndex = -1;
  root.innerHTML = '<div class="ss-an-box" id="ss-an-box"><div class="ss-an-head"><div class="ss-an-row1">'
    + '<div class="ss-an-acts"><button type="button" class="ss-an-ib" id="ss-an-share" title="이 분석 그대로 열리는 링크 복사" aria-label="링크 복사">' + SS_AN_ICO.share + '</button>'
    + '<button type="button" class="ss-an-ib" id="ss-an-dl" title="그림(PNG)으로 받기" aria-label="그림으로 받기">' + SS_AN_ICO.dl + '</button>'
    + '<button type="button" class="ss-an-ib ss-an-lgb" id="ss-an-log" aria-pressed="false" title="풍선 속 작은 차트(평가액 선)와 끝 금액 막대를 로그 눈금으로 — 본 차트 \'로그\'와 같은 설정">로그</button></div>'
    + '<div class="ss-an-sent" id="ss-an-sent">'
    + '<select id="ss-an-st" class="ss-an-sel ss-an-key" aria-label="볼 전략"></select><span class="ss-an-t" id="ss-an-mode">히트맵</span>'
    + '<span class="ss-an-t">· 비교</span><select id="ss-an-bl" class="ss-an-sel ss-an-key" aria-label="비교 대상"></select>'
    + '<input type="text" id="ss-an-tg" class="ss-an-tg" inputmode="text" autocomplete="off" spellcheck="false" placeholder="$1M · 100만 · 1억" aria-label="목표 금액" title="예: 1m · 250k · 100만 · 1억 · $1,000,000" hidden>'
    + '<span class="ss-an-gw" id="ss-an-gw" hidden><input type="range" id="ss-an-gr" min="-100" max="100" step="1" value="20" aria-label="목표 성장률 (연 %)"><b id="ss-an-grv">+20%</b></span>'
    + '<span class="ss-an-t" id="ss-an-conn">대비 색칠</span>'
    + '<span class="ss-an-t">· 시작 금액</span><span class="ss-an-slot" id="ss-an-i"></span>'
    + '<span class="ss-an-t">· 매달</span><span class="ss-an-slot" id="ss-an-m"></span>'
    + '<span class="ss-an-t">· 해마다</span><span class="ss-an-slot" id="ss-an-a"></span><span class="ss-an-t">늘림</span>'
    + '<span class="ss-an-yr" id="ss-an-yr"><span class="ss-an-t">· 시작 연도</span><span class="ss-an-dual"><span class="ss-an-dtrk"></span><span class="ss-an-dfill" id="ss-an-dfill"></span>'
    + '<input type="range" id="ss-an-y0" step="1" aria-label="시작 연도 — 처음"><input type="range" id="ss-an-y1" step="1" aria-label="시작 연도 — 끝"></span><b class="ss-an-yv" id="ss-an-yv"></b></span>'
    + '</div>'
    + '<button type="button" class="ss-an-ib ss-an-ptog" id="ss-an-ptog" aria-expanded="false" title="전략 설정 보기">' + SS_AN_ICO.gear + '</button>'
    + '<button type="button" class="ss-an-ib ss-an-x" id="ss-an-close" aria-label="닫기" title="닫기 (Esc)">×</button></div>'
    + '<div class="ss-an-params" id="ss-an-params"></div>'
    + '<div class="ss-an-sub"><div class="ss-an-leg" id="ss-an-leg"></div><div class="ss-an-prog" id="ss-an-prog" hidden><div class="ss-an-ptr"><div class="ss-an-pbar" id="ss-an-pbar"></div></div><span id="ss-an-ptx">0 / 0</span></div></div>'
    + '</div><div class="ss-an-grid" id="ss-an-grid"></div></div>'
    + '<div class="ss-an-tip" id="ss-an-tip" role="tooltip" hidden></div>';
  document.body.appendChild(root);
  const $ = (id) => document.getElementById(id);
  SAN.dom = { root, box: $('ss-an-box'), grid: $('ss-an-grid'), tip: $('ss-an-tip'), st: $('ss-an-st'), bl: $('ss-an-bl'), tg: $('ss-an-tg'), gw: $('ss-an-gw'), gr: $('ss-an-gr'), grv: $('ss-an-grv'),
    params: $('ss-an-params'), prog: $('ss-an-prog'), pbar: $('ss-an-pbar'), ptx: $('ss-an-ptx'), leg: $('ss-an-leg'), y0: $('ss-an-y0'), y1: $('ss-an-y1'), yv: $('ss-an-yv'), yr: $('ss-an-yr'),
    dfill: $('ss-an-dfill'), mode: $('ss-an-mode'), conn: $('ss-an-conn'), ptog: $('ss-an-ptog') };
  ssAnWire();
  return SAN.dom;
}

// ── 문장 · 알약 그리기 (바뀐 것만 다시 넣음) ──
const ssAnOpt = (v, label, cur) => '<option value="' + ssEsc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + ssEsc(label) + '</option>';
function ssAnSet(el, key, html) { if (SAN.ui[key] === html) return; SAN.ui[key] = html; el.innerHTML = html; }
const ssAnPct = (x) => (x % 1 === 0 ? x.toFixed(0) : x.toFixed(1)) + '%';
function ssAnNumSel(kind, list, cur, fmt, dim) {
  const vals = list.slice();
  if (cur != null && !vals.some((v) => Math.abs(v - cur) < 1e-9)) vals.push(cur);
  vals.sort((a, b) => a - b);
  return '<select class="ss-an-sel ss-an-num' + (dim ? ' dim' : '') + '" data-an="' + kind + '" title="이 창의 모든 전략에 함께 쓰이고 왼쪽 입력도 같이 바뀝니다">'
    + vals.map((v) => '<option value="' + v + '"' + (cur != null && Math.abs(v - cur) < 1e-9 ? ' selected' : '') + '>' + ssEsc(fmt(v)) + '</option>').join('') + '</select>';
}
// 알약: 이름 + 고르기 (data 속성으로 무엇을 바꾸는지 표시)
function ssAnPill(label, opts, cur, attrs, dim) {
  const list = opts.slice();
  if (!list.some((o) => String(o[0]) === String(cur))) list.push([String(cur), String(cur)]);
  return '<label class="ss-an-pill' + (dim ? ' dim' : '') + '"' + (dim ? ' title="지금 결과에 영향이 없는 값입니다"' : '') + '><span>' + ssEsc(label) + '</span><select class="ss-an-psel"' + attrs + '>'
    + list.map((o) => ssAnOpt(o[0], o[1], cur)).join('') + '</select></label>';
}
function ssAnRatePill(label, pct, attrs, dim, asPos) {
  const pcts = SS_AN_RATE.slice();
  if (!pcts.some((x) => Math.abs(x - pct) < 1e-9)) { pcts.push(pct); pcts.sort((a, b) => a - b); }
  const opts = pcts.map((x) => [String(asPos ? ssRateToPos(x) : x), ssAnPct(x)]);
  const cur = asPos ? String(ssRateToPos(pct)) : String(pcts.find((x) => Math.abs(x - pct) < 1e-9));
  return ssAnPill(label, opts, cur, attrs, dim);
}
function ssAnCfgPills(cfg) {
  if (!cfg) return '';
  const id = ' data-cfg="' + ssEsc(cfg.id) + '"';
  if (cfg.type === 'custom') {
    const res = SB.res[cfg.id], schema = (res && res.schema) || [];
    return schema.map((sp) => {
      if (!sp || sp.id == null) return '';
      const opts = ssCParamOpts(sp), cur = ssCParamVal(cfg, sp), ci = opts.findIndex((o) => String(o.value) === String(cur));
      return ssAnPill(sp.label || String(sp.id), opts.map((o, i) => [String(i), String(o.label)]), String(ci), ' data-kind="cc"' + id + ' data-k="' + ssEsc(String(sp.id)) + '"');
    }).join('');
  }
  if (cfg.type === 'invested') return ssAnRatePill('현금 이자율', ssPosToRate(+cfg.params.r || 0), ' data-kind="ci"' + id, false, true);
  return (SS_SCHEMA[cfg.type] || []).filter((d) => d.opts).map((d) => ssAnPill((SS_AN_PLAB[cfg.type] || {})[d.k] || d.k, d.opts, cfg.params[d.k], ' data-kind="c"' + id + ' data-k="' + d.k + '"')).join('');
}
function ssAnPillsFor(k, side) {
  if (ssAnIsCfg(k)) return ssAnCfgPills(ssAnCfg(k));
  if (ssAnIsBh(k)) return ssAnPill('종목', SS_PDEF['bh.ul'].opts, k.slice(3), ' data-kind="bu" data-side="' + side + '"');
  const type = k === '9sig' ? '9sig' : k === 'sma' ? 'sma' : null;
  if (!type) return '';
  return SS_AN_PILLS[type].map((pk) => ssAnPill(SS_AN_PLAB[type][pk], SS_PDEF[type + '.' + pk].opts, S.base[type][pk], ' data-kind="b" data-type="' + type + '" data-k="' + pk + '"')).join('');
}
function ssAnLogUi() {
  const b = document.getElementById('ss-an-log');
  if (!b) return;
  b.setAttribute('aria-pressed', S.log ? 'true' : 'false');
  b.classList.toggle('on', !!S.log);
}
function ssAnRenderControls() {
  ssAnLogUi();
  const d = SAN.dom, a = S.an, st = a.strategy, bl = a.baseline, inp = ssAnInputs();
  const builtin = (sel) => '<optgroup label="전략">' + ssAnBuiltins(sel).map((x) => ssAnOpt(x[0], x[1], sel)).join('') + '</optgroup>';
  const saved = (sel) => (S.saved.length ? '<optgroup label="저장한 전략">' + S.saved.map((c) => ssAnOpt('cfg:' + c.id, c.name, sel)).join('') + '</optgroup>' : '');
  ssAnSet(d.st, 'st', builtin(st) + saved(st));
  if (d.st.value !== st) d.st.value = st;
  ssAnSet(d.bl, 'bl', '<optgroup label="기준선">' + ssAnOpt('compounded', '현금 복리', bl) + '</optgroup>' + builtin(bl) + saved(bl)
    + '<optgroup label="직접 정하기">' + ssAnOpt('custom', '목표 금액 ($)', bl) + ssAnOpt('custom-pct', '목표 성장률 (연 %)', bl) + '</optgroup>');
  if (d.bl.value !== bl) d.bl.value = bl;
  const spiral = bl === 'custom-pct';
  d.mode.textContent = spiral ? '연간 수익률 나선' : '히트맵';
  d.conn.textContent = bl === 'custom' ? '달성 여부로 색칠' : spiral ? '이상인 해를 빨강으로' : '대비 색칠';
  d.tg.hidden = bl !== 'custom';
  if (bl === 'custom' && document.activeElement !== d.tg) d.tg.value = ssMoney(a.target);
  d.gw.hidden = !spiral;
  if (+d.gr.value !== a.growth) d.gr.value = String(a.growth);
  d.grv.textContent = (a.growth >= 0 ? '+' : '') + a.growth + '%';
  // 투자 조건 (왼쪽 입력과 같은 값 — 고르면 왼쪽도 바뀜)
  ssAnSet(document.getElementById('ss-an-i'), 'i', ssAnNumSel('i', SS_AN_INIT, inp.initial, ssMoney, inp.initial <= 0));
  ssAnSet(document.getElementById('ss-an-m'), 'm', ssAnNumSel('m', SS_AN_MON, inp.monthly, ssMoney, inp.monthly <= 0));
  ssAnSet(document.getElementById('ss-an-a'), 'a', ssAnNumSel('a', SS_RAISE_OPTS.map(Number), +S.raise || 0, ssAnPct, inp.monthly <= 0 || !(+S.raise > 0)));
  // 시작 연도 범위
  const Y = ssAnYears(), lo = a.yMin != null ? a.yMin : Y.min, hi = a.yMax != null ? a.yMax : Y.max;
  d.yr.hidden = spiral;
  for (const el of [d.y0, d.y1]) { el.min = String(Y.min); el.max = String(Y.max); }
  if (+d.y0.value !== lo) d.y0.value = String(lo);
  if (+d.y1.value !== hi) d.y1.value = String(hi);
  ssAnYearUi(lo, hi);
  // 전략 설정 알약
  const sp = ssAnPillsFor(st, 'strategy');
  let cp = '';
  if (bl === 'compounded') cp = ssAnRatePill('현금 이자율', ssPosToRate(+S.base.invested.r || 0), ' data-kind="rate"', inp.initial <= 0 && inp.monthly <= 0, false);
  else if (bl !== 'custom' && bl !== 'custom-pct') cp = ssAnPillsFor(bl, 'baseline');
  const none = '<span class="ss-an-none">바꿀 설정 없음</span>';
  let ph = '<div class="ss-an-pg"><span class="ss-an-pl"><b>' + ssEsc(ssAnLabel(st)) + '</b> 설정</span>' + (sp || none) + '</div>';
  if (!spiral) ph += '<div class="ss-an-pg"><span class="ss-an-pl">비교 <b>' + ssEsc(ssAnLabel(bl)) + '</b> 설정</span>' + (cp || none) + '</div>';
  ssAnSet(d.params, 'params', ph);
  // 색 설명
  const sw = (c) => '<i class="ss-an-sw" style="background:rgb(' + c.join(',') + ')"></i>';
  let lg;
  if (spiral) lg = sw(SS_AN_UP) + '<span>그해 수익률이 기준 이상</span>' + sw(SS_AN_DN) + '<span>미만</span><span class="ss-an-lgn">· 가운데가 가장 오래된 해, 12시 방향이 올해</span><span class="ss-an-lgn ss-an-hint">· 막대에 마우스를 올리거나 누르면 자세히</span>';
  else if (bl === 'custom') lg = sw(SS_AN_UP) + '<span>목표 이상</span>' + sw(SS_AN_DN) + '<span>목표 미만</span><span class="ss-an-lgn">· 칸 = 끝 금액 · 작은 숫자 = 끝난 해</span><span class="ss-an-lgn ss-an-hint">· 칸·열 머리에 마우스를 올리거나 누르면 자세히(기간 연평균 · 작은 차트)</span>';
  else lg = '<i class="ss-an-sw ss-an-grad"></i><span>파랑 = ' + ssEsc(ssAnLabel(bl)) + '보다 적음 · 빨강 = 많음 (진할수록 차이 큼)</span><span class="ss-an-lgn">· 칸 = 끝 금액 · 작은 숫자 = 끝난 해</span><span class="ss-an-lgn ss-an-hint">· 칸·열 머리에 마우스를 올리거나 누르면 자세히(기간 연평균 · 작은 차트)</span>';
  ssAnSet(d.leg, 'leg', lg);
}
function ssAnYearUi(lo, hi) {
  const d = SAN.dom, Y = ssAnYears(), span = Y.max - Y.min;
  d.yv.textContent = lo + '–' + hi;
  if (!(span > 0)) { d.dfill.style.left = '0%'; d.dfill.style.width = '0%'; return; }
  d.dfill.style.left = ((lo - Y.min) / span * 100) + '%';
  d.dfill.style.width = ((hi - lo) / span * 100) + '%';
}

// ── 다시 계산 ──
// 결과에 영향을 주는 것 전부 — 같으면 화면 갱신 때 다시 계산하지 않음
function ssAnSig() {
  const a = S.an, cf = (k) => { const c = ssAnCfg(k); return c ? [c.type, c.params, c.code || ''] : null; };
  return JSON.stringify([a.strategy, a.baseline, a.baseline === 'custom' ? a.target : 0, a.baseline === 'custom-pct' ? a.growth : 0, a.yMin, a.yMax, ssAnInputs(), S.base['9sig'], S.base.sma, cf(a.strategy), cf(a.baseline)]);
}
function ssAnBuildSoon() {
  if (SAN.raf) return;
  SAN.raf = requestAnimationFrame(() => { SAN.raf = 0; ssAnBuild(); });
}
async function ssAnBuild(fromRefresh) {
  if (!SAN.dom || !S.an.open || !DS.q) return;
  const was = S.an.strategy + '|' + S.an.baseline;
  ssAnFixKeys();
  if (was !== S.an.strategy + '|' + S.an.baseline) ssSyncHash();   // 지운 저장 전략 등 → 기본으로 돌린 것을 주소에도
  ssAnRenderControls();
  const sig = ssAnSig();
  if (fromRefresh && sig === SAN.sig) return;
  SAN.sig = sig;
  const epoch = ++SAN.epoch;
  SAN.busy = true;
  try {
    if (S.an.baseline === 'custom-pct') await ssAnSpiral(epoch);
    else await ssAnHeat(epoch);
  } catch (err) {
    if (epoch === SAN.epoch) { SAN.sig = ''; SAN.gridKey = ''; SAN.dom.grid.innerHTML = '<div class="ss-an-msg">계산하지 못했습니다 — 설정을 바꿔 다시 시도해 주세요.</div>'; }
    if (window.console) console.error('[분석 표]', err);
  } finally {
    if (epoch === SAN.epoch) { SAN.busy = false; SAN.dom.prog.hidden = true; }
  }
}

// ── 히트맵 ──
async function ssAnHeat(epoch) {
  const d = SAN.dom, grid = d.grid, Y = ssAnYears(), st = S.an.strategy, bl = S.an.baseline, inp = ssAnInputs();
  if (Y.all.length < 2) { SAN.gridKey = ''; grid.innerHTML = '<div class="ss-an-msg">자료가 모자랍니다.</div>'; return; }
  const r0 = S.an.yMin != null ? Math.max(Y.min, S.an.yMin) : Y.min, r1 = S.an.yMax != null ? Math.min(Y.max, S.an.yMax) : Y.max;
  const periods = [];
  for (let p = 1; p <= Y.max - Y.min; p++) periods.push(p);
  const floor = Math.max(ssAnFloor(st), ssAnFloor(bl));
  const cells = [];
  for (let sy = r1; sy >= r0; sy--) {
    for (const p of periods) {
      const ey = sy + p - 1;
      if (ey > Y.max || !Y.last.has(ey)) continue;
      const e = (sy > Y.min && Y.last.has(sy - 1)) ? Y.last.get(sy - 1) : Y.first.get(sy);
      if (e == null || e < floor) continue;
      const x = Y.last.get(ey);
      if (x - e < 1) continue;
      cells.push({ year: sy, period: p, e, x, value: 0, derived: 0 });
    }
  }
  // 뼈대: 칸 구성이 같으면 그대로 두고(옛 색 유지) 값만 덮음
  const gkey = r0 + '-' + r1 + '|' + periods.length + '|' + cells.map((c) => c.year + ':' + c.period).join(',');
  if (gkey !== SAN.gridKey || !grid.querySelector('table')) {
    const has = new Set(cells.map((c) => c.year + ':' + c.period));
    const h = ['<table class="ss-an-tbl"><thead><tr><th class="ss-an-corner" scope="col" title="행 = 투자를 시작한 해 · 열 = 들고 있은 햇수"><span>보유→</span><span>↓시작</span></th>'];
    for (const p of periods) h.push('<th data-c="' + p + '" scope="col">' + p + '년</th>');
    h.push('</tr></thead><tbody>');
    for (let sy = r1; sy >= r0; sy--) {
      h.push('<tr><th data-r="' + sy + '" scope="row">' + sy + '</th>');
      for (const p of periods) h.push(has.has(sy + ':' + p) ? '<td class="c" data-yp="' + sy + ':' + p + '" data-r="' + sy + '" data-c="' + p + '"></td>' : '<td class="c e" data-r="' + sy + '" data-c="' + p + '"></td>');
      h.push('</tr>');
    }
    h.push('</tbody></table>');
    grid.innerHTML = h.join('');
    SAN.gridKey = gkey;
    SAN.hl = '';
  }
  SAN.sp.key = '';
  const refs = new Map();
  grid.querySelectorAll('td[data-yp]').forEach((td) => refs.set(td.getAttribute('data-yp'), td));
  d.prog.hidden = false;
  d.pbar.style.width = '0%';
  d.ptx.textContent = '0 / ' + cells.length;
  // 행마다 한 번: 진입은 같고 계산은 앞으로만 가므로, 가장 긴 청산까지 한 번 돌려 분기 위치로 잘라 씀
  const byRow = new Map();
  for (const c of cells) { let r = byRow.get(c.year); if (!r) byRow.set(c.year, (r = [])); r.push(c); }
  const needs = ssAnNeeds([st, bl]);
  let done = 0, rows = 0;
  for (const rc of byRow.values()) {
    const e = rc[0].e;
    let x = e;
    for (const c of rc) if (c.x > x) x = c.x;
    const dates = [];
    for (let i = e; i <= x; i++) dates.push(DS.q[i][0]);
    let sim = null;
    const ctx = { e, x, dates, inp, sim: () => sim || (sim = ssAnSim(inp, e, x, needs)) };
    const ss = await ssAnRowSeries(st, ctx);
    if (epoch !== SAN.epoch) return;
    const bs = await ssAnRowSeries(bl, ctx);
    if (epoch !== SAN.epoch) return;
    const ddp = ssAnDDPrefix(ss);
    for (const c of rc) {
      const off = c.x - e;
      c.value = ss[off] || 0;
      const b = bs[off] || 0;
      c.derived = b > 0 && c.value > 0 ? c.value / b : 0;
      const q = ddp[off] || { pct: 0, p: -1, t: -1 };
      const td = refs.get(c.year + ':' + c.period);
      if (td) {
        const ey = c.year + c.period - 1;
        td.innerHTML = '<span class="v">' + ssShort3(c.value) + '</span><span class="y">' + ey + '</span>';
        td.setAttribute('data-v', String(c.value));
        td.setAttribute('data-d', String(c.derived));
        td.setAttribute('data-ey', String(ey));
        td.setAttribute('data-dd', String(q.pct));
        td.setAttribute('data-dp', (q.p >= 0 && dates[q.p]) || '');
        td.setAttribute('data-dt', (q.t >= 0 && dates[q.t]) || '');
        // 연평균용: 시작 금액 넣은 날 · 이 칸 값이 나온 날 (전략 / 비교)
        td.setAttribute('data-s0', ss.d0 || '');
        td.setAttribute('data-sd', (ss.src && ss.src[off]) || '');
        td.setAttribute('data-sf', ss.src && ss.src[off] && ss.src[off] === ss.dl ? '1' : '');
        td.setAttribute('data-bv', String(b));
        td.setAttribute('data-b0', bs.d0 || '');
        td.setAttribute('data-bd', (bs.src && bs.src[off]) || '');
        td.setAttribute('data-bf', bs.src && bs.src[off] && bs.src[off] === bs.dl ? '1' : '');
      }
      done++;
    }
    rows++;
    d.pbar.style.width = ((done / cells.length) * 100).toFixed(1) + '%';
    d.ptx.textContent = done + ' / ' + cells.length;
    if (rows % 8 === 0 || rows === byRow.size) {
      await new Promise((r) => requestAnimationFrame(r));
      if (epoch !== SAN.epoch) return;
    }
  }
  ssAnPaint(cells, refs);
  // 풍선이 떠 있으면 새 값으로 다시 채움
  if (!d.tip.hidden && SAN.tipFor) ssAnRefillTip();
}
// 색: 비율 ln 의 전체 최소·최대로 0.5 중심 강도 → 제곱근 곡선 → 파랑·회청·빨강 · 글자는 흰색(대비 4.5:1 되는 가장 옅은 투명도)
function ssAnPaint(cells, refs) {
  let lo = 0, hi = 0;
  for (const c of cells) if (c.derived > 0) { const l = Math.log(c.derived); if (l < lo) lo = l; if (l > hi) hi = l; }
  const target = S.an.target, binary = S.an.baseline === 'custom';
  for (const c of cells) {
    const td = refs.get(c.year + ':' + c.period);
    if (!td) continue;
    let rgb;
    if (binary) rgb = c.value >= target ? SS_AN_UP : SS_AN_DN;
    else {
      let t = 0.5;
      if (c.derived > 0) {
        const l = Math.log(c.derived);
        if (l >= 0 && hi > 0) t = 0.5 + 0.5 * (l / hi);
        else if (l < 0 && lo < 0) t = 0.5 - 0.5 * (l / lo);
      }
      t = Math.max(0, Math.min(1, t));
      const dl = t - 0.5;
      rgb = ssAnMix(0.5 + Math.sign(dl) * Math.pow(Math.abs(dl) * 2, 0.5) * 0.5);
    }
    td.style.background = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    td.style.color = 'rgba(255,255,255,' + ssAnInk(rgb).toFixed(2) + ')';
  }
}
function ssAnMix(t) {
  const a = t < 0.5 ? SS_AN_DN : SS_AN_MID, b = t < 0.5 ? SS_AN_MID : SS_AN_UP, u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * u));
}
const ssAnLum = (c) => { const s = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]; };
function ssAnInk(rgb) {
  const L = ssAnLum(rgb);
  for (let a = 0.72; a <= 1.001; a += 0.02) {
    const l2 = ssAnLum(rgb.map((v) => 255 * a + v * (1 - a)));
    if ((Math.max(l2, L) + 0.05) / (Math.min(l2, L) + 0.05) >= 4.5) return a;
  }
  return 1;
}

// ── 나선 (목표 성장률) ──
function ssAnSpiralSim(inp, k) {
  const key = JSON.stringify([inp, k, S.base['9sig'], k === 'sma' ? S.base.sma : 0]);
  if (SAN.spSim.key !== key || !SAN.spSim.sim) SAN.spSim = { key, sim: ssAnSim(inp, 0, DS.q.length - 1, ssAnNeeds([k])) };
  return SAN.spSim;
}
async function ssAnSpiral(epoch) {
  const d = SAN.dom, st = S.an.strategy, inp = ssAnInputs();
  d.prog.hidden = true;
  SAN.gridKey = '';
  let series, skey;
  if (ssAnIsCfg(st)) {
    const c = ssAnCfg(st), last = DS.q.length - 1;
    series = !c ? [] : c.type === 'custom' ? await ssAnCodeRun(c, inp, 0, last) : ssAnCfgPoints(c, inp, 0, last);
    if (epoch !== SAN.epoch) return;
    skey = JSON.stringify([inp, st, c ? [c.type, c.params, c.code || ''] : 0]);
  } else {
    const s = ssAnSpiralSim(inp, st);
    series = ssAnSimPoints(s.sim, st);
    skey = s.key;
  }
  // 한 장면 기다림: 방금 넣은 고르기(<select>)를 사이트 코드가 단추로 바꾼 뒤의 높이로 크기를 재야 함
  await new Promise((r) => requestAnimationFrame(r));
  if (epoch !== SAN.epoch) return;
  const wrap = d.grid.querySelector('.ss-an-sp svg');
  // 기준 %만 바뀌었으면 색만 다시 칠함
  if (wrap && SAN.sp.key === skey && SAN.sp.points && SAN.sp.size === ssAnSpiralSize()) { ssAnSpiralPaint(); return; }
  ssAnSpiralDraw(series, skey);
}
function ssAnSpiralPoints(series) {
  const byYear = new Map();
  for (const it of series) byYear.set(parseInt(String(it.date).slice(0, 4), 10), it.value);
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const lastD = String(series[series.length - 1].date), lm = parseInt(lastD.slice(5, 7), 10), ld = parseInt(lastD.slice(8, 10), 10);
  const full = lm === 12 && ld >= 28;
  const out = [];
  for (let i = 1; i < years.length; i++) {
    const a = byYear.get(years[i - 1]), b = byYear.get(years[i]);
    if (!(a > 0 && b > 0)) continue;
    out.push({ year: years[i], pct: (b / a - 1) * 100, from: a, to: b, partial: i === years.length - 1 && !full });
  }
  return out;
}
function ssAnSpiralSize() {
  const g = SAN.dom.grid, w = g.clientWidth || 600, h = g.clientHeight || 600;
  return Math.max(300, Math.min(w - 4, h - 4));
}
function ssAnSpiralDraw(series, skey) {
  const grid = SAN.dom.grid;
  SAN.sp = { key: '', points: null, size: 0 };
  const pts = series && series.length ? ssAnSpiralPoints(series) : [];
  if (!pts.length) { grid.innerHTML = '<div class="ss-an-msg">' + (series && series.length ? '나선을 그릴 만큼 자료가 없습니다.' : '이 전략은 계산 결과가 없습니다.') + '</div>'; return; }
  grid.innerHTML = '';                       // 옛 표(스크롤 막대)를 비운 뒤 크기를 잼
  const size = ssAnSpiralSize(), R = size / 2 - 40, c = size / 2;
  // 나선: 반지름 40 → R, 시계 방향 네 바퀴, 끝이 12시 · 길이 표로 '길이 → 점' 변환
  const M = 1600, P = new Array(M + 1), L = new Float64Array(M + 1);
  for (let k = 0; k <= M; k++) {
    const u = k / M, r = 40 + (R - 40) * u, an = 8 * Math.PI * u;
    P[k] = [r * Math.sin(an), -r * Math.cos(an)];
    if (k) L[k] = L[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
  }
  const LT = L[M];
  const at = (s) => {
    if (s <= 0 || s >= LT) {
      const i0 = s <= 0 ? 0 : M - 1, i1 = i0 + 1, dx = P[i1][0] - P[i0][0], dy = P[i1][1] - P[i0][1], l = Math.hypot(dx, dy) || 1, o = s <= 0 ? s : s - LT, b = s <= 0 ? P[0] : P[M];
      return [b[0] + dx / l * o, b[1] + dy / l * o];
    }
    let lo = 0, hi = M;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const f = (s - L[lo]) / ((L[hi] - L[lo]) || 1);
    return [P[lo][0] + (P[hi][0] - P[lo][0]) * f, P[lo][1] + (P[hi][1] - P[lo][1]) * f];
  };
  const N = pts.length, gap = N > 1 ? LT / (N - 1) : LT, bw = Math.min(48, gap * 0.94);
  const turn = (R - 40) / 4, maxH = Math.min(41, turn * 0.86), minH = Math.min(18, maxH * 0.44), fs = Math.max(6, Math.min(8.4, minH * 0.62, bw / 4.4));
  const hFor = (m) => minH + (Math.log1p(Math.min(m, 200)) / Math.log1p(200)) * (maxH - minH);
  const f2 = (v) => v.toFixed(2);
  let guide = '';
  for (let k = 0; k <= M; k += 4) guide += (k ? 'L' : 'M') + f2(P[k][0]) + ' ' + f2(P[k][1]);
  let bars = '', pcts = '', yrs = '';
  pts.forEach((d, i) => {
    const s0 = N > 1 ? (i / (N - 1)) * LT : 0, p = at(s0), q = at(s0 + 1);
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI, flip = ang > 90 || ang < -90, rot = flip ? ang + 180 : ang;
    const h = hFor(Math.abs(d.pct)), hh = h / 2, out = [], inn = [];
    for (let k = 0; k <= 6; k++) {
      const s = s0 + (k / 6 - 0.5) * bw, a = at(s), b = at(s + 0.75);
      const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
      let nx = -ty / tl, ny = tx / tl;
      if (nx * a[0] + ny * a[1] < 0) { nx = -nx; ny = -ny; }
      out.push([a[0] + nx * hh, a[1] + ny * hh]);
      inn.push([a[0] - nx * hh, a[1] - ny * hh]);
    }
    let path = 'M' + f2(out[0][0]) + ' ' + f2(out[0][1]);
    for (let k = 1; k < out.length; k++) path += 'L' + f2(out[k][0]) + ' ' + f2(out[k][1]);
    for (let k = inn.length - 1; k >= 0; k--) path += 'L' + f2(inn[k][0]) + ' ' + f2(inn[k][1]);
    bars += '<path class="bar" data-i="' + i + '" d="' + path + 'Z"/>';
    pcts += '<text class="pt" x="' + f2(p[0]) + '" y="' + f2(p[1]) + '" transform="rotate(' + f2(rot) + ' ' + f2(p[0]) + ' ' + f2(p[1]) + ')">' + (d.pct >= 0 ? '+' : '') + Math.round(d.pct) + '%</text>';
    const dist = Math.hypot(p[0], p[1]) || 1, off = hh + Math.max(6, fs + 1), yx = p[0] + p[0] / dist * off, yy = p[1] + p[1] / dist * off;
    yrs += '<text class="yt" x="' + f2(yx) + '" y="' + f2(yy) + '" transform="rotate(' + f2(rot) + ' ' + f2(yx) + ' ' + f2(yy) + ')">' + d.year + '</text>';
  });
  grid.innerHTML = '<div class="ss-an-sp"><svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="연간 수익률 나선 — ' + pts[0].year + '년부터 ' + pts[N - 1].year + '년까지"'
    + ' style="--an-fs:' + fs.toFixed(2) + 'px"><g transform="translate(' + c + ',' + c + ')"><path class="g" d="' + guide + '"/>' + bars + pcts + yrs + '</g></svg></div>';
  SAN.sp = { key: skey, points: pts, size };
  SAN.hl = '';
  ssAnSpiralPaint();
}
function ssAnSpiralPaint() {
  const pts = SAN.sp.points, thr = S.an.growth;
  if (!pts) return;
  SAN.dom.grid.querySelectorAll('.ss-an-sp .bar').forEach((el) => {
    const d = pts[+el.getAttribute('data-i')];
    if (d) el.setAttribute('fill', d.pct >= thr ? 'rgb(' + SS_AN_UP.join(',') + ')' : 'rgb(' + SS_AN_DN.join(',') + ')');
  });
  if (!SAN.dom.tip.hidden && /^sp:/.test(SAN.tipFor)) ssAnRefillTip();
}

// ── 풍선 ──
function ssAnCellSim(sy, p) {
  const keys = [S.an.strategy, S.an.baseline], needs = ssAnNeeds(keys);
  if (!needs.n9 && !needs.sma) return null;
  const inp = ssAnInputs(), key = JSON.stringify([inp, S.base['9sig'], S.base.sma, needs]);
  if (SAN.cellSim.key !== key) SAN.cellSim = { key, map: new Map() };
  const ck = sy + ':' + p;
  if (SAN.cellSim.map.has(ck)) return SAN.cellSim.map.get(ck);
  const rng = ssAnCellRange(sy, p), sim = rng ? ssAnSim(inp, rng.e, rng.x, needs) : null;
  if (SAN.cellSim.map.size >= 240) SAN.cellSim.map.clear();   // 칸마다 계산 한 벌 — 메모리 한도
  SAN.cellSim.map.set(ck, sim);
  return sim;
}
// 칸 풍선의 작은 차트 점들 (전략 / 비교)
function ssAnTipPoints(k, sy, p, bv, strat, isBase) {
  if (ssAnIsCfg(k)) {
    const c = ssAnCfg(k), rng = ssAnCellRange(sy, p);
    if (!c || !rng) return [];
    const inp = ssAnInputs();
    if (c.type === 'custom') return ssAnCodeCached(c, inp, rng.e, rng.x) || [];
    return ssAnCfgPoints(c, inp, rng.e, rng.x);
  }
  if (isBase && (k === 'custom' || k === 'custom-pct')) {
    const tg = k === 'custom' ? S.an.target : bv;
    if (!Number.isFinite(tg) || tg <= 0 || !strat || strat.length < 2) return [];
    return [{ date: strat[0].date, value: tg }, { date: strat[strat.length - 1].date, value: tg }];
  }
  return ssAnSimPoints(ssAnCellSim(sy, p), k);
}
// 사용자 전략은 칸 구간 결과가 없으면 격리 실행을 걸고, 끝나면 (아직 그 칸이면) 풍선을 다시 채움
function ssAnWarm(sy, p) {
  const c = ssAnCfg(S.an.strategy), rng = ssAnCellRange(sy, p);
  if (!c || c.type !== 'custom' || !rng) return;
  const inp = ssAnInputs();
  if (ssAnCodeCached(c, inp, rng.e, rng.x)) return;
  const tag = c.id + '|' + sy + ':' + p;
  if (SAN.warming === tag) return;
  SAN.warming = tag;
  ssAnCodeRun(c, inp, rng.e, rng.x).then(() => {
    if (SAN.warming === tag) SAN.warming = '';
    if (!SAN.dom.tip.hidden && SAN.tipFor === 'td:' + sy + ':' + p) ssAnRefillTip();
  });
}
function ssAnCellTipHtml(td) {
  const sy = +td.getAttribute('data-r'), p = +td.getAttribute('data-c'), ey = +td.getAttribute('data-ey'), v = +td.getAttribute('data-v'), dv = +td.getAttribute('data-d');
  const dd = +td.getAttribute('data-dd'), rg = ssDDRange(td.getAttribute('data-dp') || null, td.getAttribute('data-dt') || null);
  const st = S.an.strategy, bl = S.an.baseline, bv = dv > 0 ? v / dv : 0;
  let chart = '';
  const ser = ssAnTipPoints(st, sy, p, bv, null, false);
  if (!ser.length) ssAnWarm(sy, p);
  if (ser.length >= 2) {
    const bs = ssAnTipPoints(bl, sy, p, bv, ser, true);
    chart = ssAnMini(ser, bs && bs.length && bl !== st ? bs : null);
  } else if (ssAnIsCfg(st) && (ssAnCfg(st) || {}).type === 'custom') chart = '<div class="ss-an-tmsg">작은 차트를 계산하는 중…</div>';
  const Y = ssAnYears(), xi = Y.last.get(ey), xd = xi != null ? DS.q[xi][0] : '';
  const endTxt = xd && !(+xd.slice(5, 7) === 12 && +xd.slice(8, 10) >= 28) ? ssDate(xd) + ' 기준' : ey + '년 말';
  // 기간 연평균 (돈 가중 — 본 화면 '연평균 수익률'과 같은 계산) · 비교 대상도 같은 방법
  const inp = ssAnInputs(), cg = ssAnCagr(ssAnMode(st), td.getAttribute('data-s0'), td.getAttribute('data-sd'), v, inp, td.getAttribute('data-sf') === '1');
  const bAmt = +td.getAttribute('data-bv') > 0 ? +td.getAttribute('data-bv') : bv;
  const bcg = bl !== 'custom' && dv > 0 ? ssAnCagr(ssAnMode(bl), td.getAttribute('data-b0'), td.getAttribute('data-bd'), bAmt, inp, td.getAttribute('data-bf') === '1') : null;
  const cagrRow = '<div class="ss-an-tc">연평균 ' + (cg ? '<b class="' + (cg.pct >= 0 ? 'up' : 'dn') + '">' + ssAnCgPct(cg.pct) + '</b> <i>' + cg.years.toFixed(1) + '년 · 넣은 날짜별 돈 가중</i>' : '<b>—</b>') + '</div>';
  const ratio = bl !== 'custom' && dv > 0 ? '<div class="ss-an-tr">' + ssEsc(ssAnLabel(bl)) + ' ' + ssMoney(Math.round(bAmt)) + (bcg ? ' <span class="cg">(연 ' + ssAnCgPct(bcg.pct) + ')</span>' : '') + ' 의 <b>' + (dv >= 10 ? dv.toFixed(1) : dv.toFixed(2)) + '배</b></div>'
    : bl === 'custom' ? '<div class="ss-an-tr">목표 ' + ssMoney(S.an.target) + ' ' + (v >= S.an.target ? '<b class="up">달성</b>' : '<b class="dn">미달</b>') + '</div>' : '';
  return '<button type="button" class="x" data-x aria-label="닫기">×</button>'
    + '<div class="tt"><span>' + ssEsc(ssAnLabel(st)) + ' · ' + sy + '년 시작 · ' + p + '년</span><span class="dd">낙폭 ' + ssDD(dd * 100) + (rg ? ' <i>' + rg + '</i>' : '') + '</span></div>'
    + '<div class="tv">' + ssMoney(Math.round(v)) + ' <small>(' + endTxt + ')</small></div>' + cagrRow + ratio + chart;
}
const ssAnCgPct = (p) => (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
// 열 머리: 그 보유 기간의 모든 시작 연도 칸 모아 통계
function ssAnColStats(period) {
  const tds = SAN.dom.grid.querySelectorAll('td.c:not(.e)[data-c="' + period + '"]'), smp = [];
  tds.forEach((td) => {
    const v = +td.getAttribute('data-v'), sy = +td.getAttribute('data-r');
    if (Number.isFinite(v) && v > 0 && Number.isFinite(sy)) smp.push({ year: sy, value: v, dd: +td.getAttribute('data-dd'), ddPeak: td.getAttribute('data-dp') || null, ddTrough: td.getAttribute('data-dt') || null,
      s0: td.getAttribute('data-s0'), sd: td.getAttribute('data-sd'), sf: td.getAttribute('data-sf') === '1' });
  });
  if (!smp.length) return null;
  // 연평균: 칸마다 칸 풍선과 같은 돈 가중 연수익률 (실제 넣은 날짜·금액 · 실제 기간 — 올해처럼 덜 찬 해도 그대로)
  const inp = ssAnInputs(), mode = ssAnMode(S.an.strategy);
  for (const s of smp) { const g = ssAnCagr(mode, s.s0, s.sd, s.value, inp, s.sf); s.cagr = g ? g.pct : null; }
  const asc = (a) => a.slice().sort((x, y) => x - y);
  const med = (s) => { const n = s.length; return n === 0 ? 0 : n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const stat = (a) => { const s = asc(a); return { median: med(s), mean: mean(a), min: s[0], max: s[s.length - 1] }; };
  const byDd = smp.slice().sort((a, b) => (a.dd || 0) - (b.dd || 0)), byVal = smp.slice().sort((a, b) => a.value - b.value);
  const withCg = smp.filter((s) => s.cagr != null), byCg = withCg.slice().sort((a, b) => a.cagr - b.cagr);
  const n = smp.length, desc = smp.map((s) => s.value).sort((a, b) => b - a), dec = [];
  for (let k = 0; k < 10; k++) { const lo = Math.floor(k * n / 10), hi = Math.floor((k + 1) * n / 10); dec.push(lo >= hi ? null : med(asc(desc.slice(lo, hi)))); }
  return { period, n, val: stat(smp.map((s) => s.value)), cagr: withCg.length ? stat(withCg.map((s) => s.cagr)) : null, cagrN: withCg.length,
    cagrWorstYear: byCg.length ? byCg[0].year : null, cagrBestYear: byCg.length ? byCg[byCg.length - 1].year : null,
    dd: stat(smp.map((s) => (Number.isFinite(s.dd) ? s.dd : 0))), worstYear: byVal[0].year, bestYear: byVal[n - 1].year, worstDd: byDd[n - 1], bestDd: byDd[0], dec };
}
function ssAnColTipHtml(period) {
  const s = ssAnColStats(period);
  if (!s) return '';
  const m = (v) => ssMoney(Math.round(v)), pc = ssAnCgPct;
  const ddr = (v, x) => { const r = x ? ssDDRange(x.ddPeak, x.ddTrough) : ''; return ssDD(v * 100) + (r ? '<em>' + r + '</em>' : ''); };
  const cell = (k, v) => '<span class="hc"><span>' + k + '</span><b>' + v + '</b></span>';
  const labs = ['상위 10%', '10–20%', '20–30%', '30–40%', '40–50%', '50–60%', '60–70%', '70–80%', '80–90%', '하위 10%'];
  const bar = (v) => (v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'K' : '$' + Math.round(v));
  const W = 360, padY = 4, rowH = 15, gapY = 3, lw = 70, vw = 62, bx = 4 + lw, bwid = W - 8 - lw - vw, H = padY * 2 + 10 * rowH + 9 * gapY;
  const have = s.dec.filter((v) => v != null && v > 0), top = have.length ? Math.max.apply(null, have) : 1;
  // 로그 눈금: 막대 길이 ∝ log(값 / 밑) — 밑 = 가장 작은 값 아래 10의 거듭제곱 (가장 작은 막대도 보이게)
  const lg = !!S.log && have.length > 0, bot = lg ? Math.pow(10, Math.floor(Math.log10(Math.min.apply(null, have)))) : 0;
  const lenOf = (v) => (lg ? (top > bot ? Math.log(v / bot) / Math.log(top / bot) : 1) : v / top) * bwid;
  let svg = '';
  for (let i = 0; i < 10; i++) {
    const v = s.dec[i], y = padY + i * (rowH + gapY), ly = y + rowH - 4;
    svg += '<text class="dl" x="' + (bx - 6) + '" y="' + ly + '" text-anchor="end">' + labs[i] + '</text>';
    if (v == null || v <= 0) continue;
    const len = Math.max(2, lenOf(v)), col = ssAnMix(1 - i / 9);
    svg += '<rect x="' + bx + '" y="' + y + '" width="' + len.toFixed(1) + '" height="' + rowH + '" rx="2" fill="rgb(' + col.join(',') + ')"><title>시작 연도 ' + labs[i] + ' 구간의 끝 금액 중앙값 ' + m(v) + '</title></rect>'
      + '<text class="dv" x="' + (bx + len + 4).toFixed(1) + '" y="' + ly + '">' + bar(v) + '</text>';
  }
  return '<button type="button" class="x" data-x aria-label="닫기">×</button>'
    + '<div class="tt"><span>' + period + '년 보유 · 시작 연도 ' + s.n + '개</span></div>'
    + '<div class="ss-an-hs">'
    + '<div class="hr"><span class="hl">끝 금액</span>' + cell('중앙값', m(s.val.median)) + cell('평균', m(s.val.mean)) + cell('최저 · ' + s.worstYear, m(s.val.min)) + cell('최고 · ' + s.bestYear, m(s.val.max)) + '</div>'
    + (s.cagr ? '<div class="hr"><span class="hl" title="칸마다 넣은 날짜·금액을 반영한 돈 가중 연수익률(IRR)">연평균</span>' + cell('중앙값', pc(s.cagr.median)) + cell('평균', pc(s.cagr.mean))
      + cell('최저 · ' + s.cagrWorstYear, pc(s.cagr.min)) + cell('최고 · ' + s.cagrBestYear, pc(s.cagr.max)) + '</div>' : '')
    + '<div class="hr"><span class="hl">최대 낙폭</span>' + cell('중앙값', ssDD(s.dd.median * 100)) + cell('평균', ssDD(s.dd.mean * 100)) + cell('가장 깊음', ddr(s.dd.max, s.worstDd)) + cell('가장 얕음', ddr(s.dd.min, s.bestDd)) + '</div>'
    + '</div><div class="ss-an-dt">시작한 해가 이 구간에 들었다면 — 끝 금액 중앙값' + (lg ? ' <span class="lgt">로그 눈금 · 밑 ' + bar(bot) + '</span>' : '') + '</div>'
    + '<svg class="ss-an-dsvg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' + svg + '</svg>'
    + '<div class="ss-an-tn">연평균 = 칸마다 넣은 날짜·금액을 반영한 돈 가중 연수익률(본 화면 \'연평균 수익률\'과 같은 계산)</div>';
}
// 나선 풍선: 그해 시작해 최신까지
function ssAnYearSeries(y) {
  const k = S.an.strategy, inp = ssAnInputs(), rng = ssAnYearRange(y);
  if (!rng) return [];
  if (ssAnIsCfg(k)) { const c = ssAnCfg(k); return !c || c.type === 'custom' ? [] : ssAnCfgPoints(c, inp, rng.e, rng.x); }
  const key = JSON.stringify([inp, k, S.base['9sig'], S.base.sma]);
  if (SAN.yearSim.key !== key) SAN.yearSim = { key, map: new Map() };
  let sim = SAN.yearSim.map.get(y);
  if (!sim) { sim = ssAnSim(inp, rng.e, rng.x, ssAnNeeds([k])); SAN.yearSim.map.set(y, sim); }
  return ssAnSimPoints(sim, k);
}
function ssAnSpiralTipHtml(d) {
  const thr = S.an.growth, hit = d.pct >= thr, ser = ssAnYearSeries(d.year);
  let today = 0, later = 0, endY = '', chart = '', cagrRow = '';
  if (ser.length) {
    today = ser[ser.length - 1].value;
    chart = ssAnMini(ser, null);
    endY = parseInt(String(ser[ser.length - 1].date).slice(0, 4), 10);
    later = endY - d.year;
    // 그해 시작 → 최신 연평균 (칸 풍선과 같은 돈 가중 계산)
    const rng = ssAnYearRange(d.year), k = S.an.strategy;
    const cg = rng ? ssAnCagr(ssAnMode(k), ssAnStartDate(k, rng.e, ser), String(ser[ser.length - 1].date), today, ssAnInputs(), true) : null;
    if (cg) cagrRow = '<div class="ss-an-tc">연평균 <b class="' + (cg.pct >= 0 ? 'up' : 'dn') + '">' + ssAnCgPct(cg.pct) + '</b> <i>' + cg.years.toFixed(1) + '년 · 넣은 날짜별 돈 가중</i></div>';
  }
  return '<button type="button" class="x" data-x aria-label="닫기">×</button>'
    + '<div class="tt"><span>' + ssEsc(ssAnLabel(S.an.strategy)) + ' · ' + d.year + '년 시작</span></div>'
    + '<div class="tv">' + ssMoney(Math.round(today)) + (later > 0 ? ' <small>(' + later + '년 뒤 · ' + endY + ')</small>' : '') + '</div>' + cagrRow + chart
    + '<div class="tf"><span>' + d.year + '년' + (d.partial ? '(올해 지금까지)' : '') + ' 한 해: <b>' + (d.pct >= 0 ? '+' : '') + d.pct.toFixed(2) + '%</b></span>'
    + '<span class="' + (hit ? 'up' : 'dn') + '">기준 ' + (thr >= 0 ? '+' : '') + thr + '% ' + (hit ? '✓ 이상' : '✗ 미만') + '</span></div>';
}
// 작은 차트: 위 = 연도별 수익률 막대(빨강 +, 파랑 −), 아래 = 평가액 선 + 비교 점선(날짜 맞춤)
function ssAnMini(series, base) {
  if (!series || series.length < 2) return '';
  const W = Math.round(Math.max(240, Math.min(340, (window.innerWidth || 400) - 70))), H = 168;
  const groups = [];
  for (let i = 0; i < series.length; i++) {
    const y = parseInt(String(series[i].date).slice(0, 4), 10), v = series[i].value, g = groups[groups.length - 1];
    if (!g || g.y !== y) groups.push({ y, a: i, b: i, va: v, vb: v }); else { g.b = i; g.vb = v; }
  }
  groups.forEach((g, i) => { const b0 = i ? groups[i - 1].vb : g.va; g.pct = b0 > 0 ? (g.vb / b0 - 1) * 100 : 0; });
  const pad = 4, top = 10, bh = 36, mid = top + bh / 2, lt = top + bh + 10, lb = H - 20, lh = lb - lt;
  const n = series.length, dx = (W - pad * 2) / (n - 1), X = (i) => pad + i * dx, f1 = (v) => v.toFixed(1);
  let maxAbs = 1;
  for (const g of groups) if (Math.abs(g.pct) > maxAbs) maxAbs = Math.abs(g.pct);
  maxAbs = Math.min(maxAbs, 200);
  const sc = (bh / 2 - 3) / maxAbs;
  let bars = '', blab = '';
  groups.forEach((g, i) => {
    if (i === 0 && g.a === g.b) return;
    const pv = groups[i - 1], nx = groups[i + 1];
    const xl = pv ? (X(pv.b) + X(g.a)) / 2 : X(0), xr = nx ? (X(g.b) + X(nx.a)) / 2 : X(n - 1);
    const w = Math.max(0.5, xr - xl - 1), hgt = Math.min(Math.abs(g.pct), 200) * sc, up = g.pct >= 0, y = up ? mid - hgt : mid;
    bars += '<rect class="' + (up ? 'u' : 'd') + '" x="' + f1(xl) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(hgt) + '"/>';
    if (w > 22) {
      const ly = up ? Math.max(9, y - 2) : Math.min(top + bh - 1, y + hgt + 9);
      blab += '<text class="bl ' + (up ? 'u' : 'd') + '" x="' + f1((xl + xr) / 2) + '" y="' + f1(ly) + '" text-anchor="middle">' + (up ? '+' : '') + Math.round(g.pct) + '%</text>';
    }
  });
  let mn = Infinity, mx = -Infinity;
  for (const p of series) { if (p.value < mn) mn = p.value; if (p.value > mx) mx = p.value; }
  if (base && base.length) for (const p of base) if (Number.isFinite(p.value)) { if (p.value < mn) mn = p.value; if (p.value > mx) mx = p.value; }
  // 로그 눈금(본 차트 '로그'와 같은 설정): 0 보다 큰 값으로 범위를 잡고, 0 이하(시작 금액 0 등)는 바닥에 붙임
  let lg = !!S.log;
  if (lg) {
    let pm = Infinity;
    for (const p of series) if (p.value > 0 && p.value < pm) pm = p.value;
    if (base && base.length) for (const p of base) if (p.value > 0 && p.value < pm) pm = p.value;
    if (Number.isFinite(pm) && mx > 0) mn = pm; else lg = false;
  }
  if (mx <= mn) mx = lg ? mn * 2 : mn + 1;
  const sv = lg ? (v) => Math.log(Math.max(v, mn)) : (v) => v, s0 = sv(mn), s1 = sv(mx);
  const Yv = (v) => lt + (1 - (sv(v) - s0) / (s1 - s0)) * lh;
  let line = '';
  for (let i = 0; i < n; i++) line += (i ? 'L' : 'M') + f1(X(i)) + ',' + f1(Yv(series[i].value));
  const area = 'M' + f1(X(0)) + ',' + f1(lb) + 'L' + line.slice(1) + 'L' + f1(X(n - 1)) + ',' + f1(lb) + 'Z';
  const sy0 = Yv(series[0].value), sy1 = Yv(series[n - 1].value), above = (cy) => cy - lt > lh * 0.45, endAbove = above(sy1);
  let bpath = '', blbl = '';
  if (base && base.length) {
    const dated = base.filter((b) => b && b.date != null && Number.isFinite(b.value));
    if (dated.length > 1 && series[0].date != null) {
      let bi = 0;
      for (let i = 0; i < n; i++) {
        const dd = series[i].date;
        while (bi + 1 < dated.length && dated[bi + 1].date <= dd) bi++;
        if (dated[bi].date > dd) continue;
        bpath += (bpath ? 'L' : 'M') + f1(X(i)) + ',' + f1(Yv(dated[bi].value));
      }
    } else if (base.length === n) {
      for (let i = 0; i < n; i++) if (Number.isFinite(base[i].value)) bpath += (bpath ? 'L' : 'M') + f1(X(i)) + ',' + f1(Yv(base[i].value));
    } else {
      const v = base[base.length - 1].value;
      if (Number.isFinite(v)) bpath = 'M' + f1(X(0)) + ',' + f1(Yv(v)) + 'L' + f1(X(n - 1)) + ',' + f1(Yv(v));
    }
    const lv = base[base.length - 1].value;
    if (bpath && Number.isFinite(lv)) {
      const yb = Yv(lv), close = Math.abs(yb - sy1) < 26, yl = close ? (endAbove ? yb + 14 : yb - 8) : yb - 4;
      blbl = '<text class="bv" x="' + f1(X(n - 1) - 18) + '" y="' + f1(yl) + '" text-anchor="end">' + ssMoney(Math.round(lv)) + '</text>';
    }
  }
  const sl = above(sy0) ? sy0 - 6 : sy0 + 12, el = endAbove ? sy1 - 6 : sy1 + 12;
  const yrs = groups.filter((g, i) => !(i === 0 && g.a === g.b)), step = Math.max(1, Math.ceil(yrs.length / 10));
  let ax = '';
  yrs.forEach((g, i) => { if (i % step !== 0 && i !== yrs.length - 1) return; ax += '<text class="ax" x="' + f1((X(g.a) + X(g.b)) / 2) + '" y="' + f1(lb + 13) + '" text-anchor="middle">' + g.y + '</text>'; });
  return '<svg class="ss-an-mc" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + bars
    + '<line class="z" x1="' + pad + '" y1="' + f1(mid) + '" x2="' + (W - pad) + '" y2="' + f1(mid) + '"/>'
    + '<path class="ar" d="' + area + '"/>' + (bpath ? '<path class="bs" d="' + bpath + '"/>' : '') + '<path class="ln" d="' + line + '"/>' + blab + blbl
    + '<circle class="pd" cx="' + f1(X(0)) + '" cy="' + f1(sy0) + '" r="2.6"/><circle class="pd" cx="' + f1(X(n - 1)) + '" cy="' + f1(sy1) + '" r="2.6"/>'
    + '<text class="ev" x="' + f1(X(0) + 4) + '" y="' + f1(sl) + '">' + ssMoney(Math.round(series[0].value)) + '</text>'
    + '<text class="ev" x="' + f1(X(n - 1) - 15) + '" y="' + f1(el) + '" text-anchor="end">' + ssMoney(Math.round(series[n - 1].value)) + '</text>'
    + '<line class="xa" x1="' + pad + '" y1="' + f1(lb + 1) + '" x2="' + (W - pad) + '" y2="' + f1(lb + 1) + '"/>' + ax + '</svg>'
    + (lg ? '<div class="ss-an-mlg">평가액 선 · 로그 눈금</div>' : '');
}
// 풍선 위치: 기준 칸의 오른쪽 아래(넘치면 반대쪽) 또는 마우스 옆 — 늘 화면 안
function ssAnPlace(anchor, ev) {
  const tip = SAN.dom.tip, m = 14, vw = window.innerWidth, vh = window.innerHeight;
  tip.style.left = '0px'; tip.style.top = '0px';
  const r = tip.getBoundingClientRect();
  let x, y;
  if (anchor) {
    const c = anchor.getBoundingClientRect();
    x = c.right + m; y = c.bottom + m;
    if (x + r.width > vw - 8) x = c.left - r.width - m;
    if (y + r.height > vh - 8) y = c.top - r.height - m;
  } else {
    x = ev.clientX + m; y = ev.clientY + m;
    if (x + r.width > vw - 8) x = ev.clientX - r.width - m;
    if (y + r.height > vh - 8) y = ev.clientY - r.height - m;
  }
  tip.style.left = Math.max(4, Math.min(x, vw - r.width - 4)) + 'px';
  tip.style.top = Math.max(4, Math.min(y, vh - r.height - 4)) + 'px';
}
function ssAnShowTip(key, html, anchor, ev) {
  const tip = SAN.dom.tip;
  if (!html) { ssAnHideTip(); return; }
  SAN.tipFor = key;
  tip.innerHTML = html;
  tip.hidden = false;
  tip._anchor = anchor || null;
  ssAnPlace(anchor, ev);
}
function ssAnHideTip() {
  const tip = SAN.dom && SAN.dom.tip;
  if (!tip) return;
  tip.hidden = true;
  SAN.tipFor = '';
  tip._anchor = null;
}
function ssAnRefillTip() {
  const k = SAN.tipFor, g = SAN.dom.grid;
  if (!k) return;
  if (k.indexOf('td:') === 0) {
    const td = g.querySelector('td[data-yp="' + k.slice(3) + '"]');
    if (td && td.hasAttribute('data-v')) { SAN.dom.tip.innerHTML = ssAnCellTipHtml(td); ssAnPlace(td); } else ssAnHideTip();
  } else if (k.indexOf('th:') === 0) {
    const th = g.querySelector('th[data-c="' + k.slice(3) + '"]'), h = th ? ssAnColTipHtml(+k.slice(3)) : '';
    if (h) { SAN.dom.tip.innerHTML = h; ssAnPlace(th); } else ssAnHideTip();
  } else if (k.indexOf('sp:') === 0) {
    const d = SAN.sp.points && SAN.sp.points[+k.slice(3)], el = g.querySelector('.ss-an-sp .bar[data-i="' + k.slice(3) + '"]');
    if (d && el) { SAN.dom.tip.innerHTML = ssAnSpiralTipHtml(d); ssAnPlace(el); } else ssAnHideTip();
  }
}
// 행·열 강조
function ssAnHl(r, c) {
  const key = (r || '') + '|' + (c || '');
  if (SAN.hl === key) return;
  SAN.hl = key;
  const g = SAN.dom.grid;
  g.querySelectorAll('.rh, .ch').forEach((el) => el.classList.remove('rh', 'ch'));
  if (r) g.querySelectorAll('[data-r="' + r + '"]').forEach((el) => el.classList.add('rh'));
  if (c) g.querySelectorAll('[data-c="' + c + '"]').forEach((el) => el.classList.add('ch'));
}
// 칸 / 열 머리 하나에 풍선 (같은 칸이면 다시 만들지 않음)
function ssAnTipFor(el) {
  if (el.matches('td.c:not(.e)') && el.hasAttribute('data-v')) {
    const key = 'td:' + el.getAttribute('data-yp');
    if (SAN.tipFor !== key || SAN.dom.tip.hidden) ssAnShowTip(key, ssAnCellTipHtml(el), el);
    return true;
  }
  if (el.matches('th[data-c]')) {
    const key = 'th:' + el.getAttribute('data-c');
    if (SAN.tipFor !== key || SAN.dom.tip.hidden) ssAnShowTip(key, ssAnColTipHtml(+el.getAttribute('data-c')), el);
    return !SAN.dom.tip.hidden;
  }
  return false;
}

// ── 사건 ──
function ssAnWire() {
  const d = SAN.dom, grid = d.grid, tip = d.tip;
  // 풍선 밖을 누르면 닫음 (사이트 고르기 메뉴가 바깥 클릭으로 닫히도록 전파는 막지 않음)
  d.root.addEventListener('click', (e) => {
    if (!tip.hidden && !tip.contains(e.target) && !e.target.closest('td.c:not(.e), th[data-c], .ss-an-sp .bar')) { ssAnHideTip(); ssAnHl(null, null); }
  });
  document.getElementById('ss-an-close').addEventListener('click', () => ssAnalyticsClose());
  document.getElementById('ss-an-share').addEventListener('click', async (e) => {
    const b = e.currentTarget, url = await ssShareUrl();
    ssCopy(url, () => { b.classList.add('ok'); b.innerHTML = SS_AN_ICO.ok; b.title = '복사됨'; setTimeout(() => { b.classList.remove('ok'); b.innerHTML = SS_AN_ICO.share; b.title = '이 분석 그대로 열리는 링크 복사'; }, 1600); });
  });
  document.getElementById('ss-an-dl').addEventListener('click', () => ssAnDownload());
  // 로그 눈금 (본 차트 '로그' 단추와 같은 S.log — 저장·공유 주소에도 같이 담김)
  document.getElementById('ss-an-log').addEventListener('click', () => {
    S.log = !S.log;
    ssAnLogUi();
    ssChanged();
    if (!tip.hidden && SAN.tipFor) ssAnRefillTip();
  });
  d.ptog.addEventListener('click', () => { const on = !d.params.classList.contains('open'); d.params.classList.toggle('open', on); d.ptog.setAttribute('aria-expanded', on ? 'true' : 'false'); d.ptog.classList.toggle('on', on); });
  d.st.addEventListener('change', () => { const v = d.st.value; if (!v || v === S.an.strategy) return; S.an.strategy = v; ssAnHideTip(); ssSyncHash(); ssAnBuild(); });
  d.bl.addEventListener('change', () => {
    const v = d.bl.value;
    if (!v || v === S.an.baseline) return;
    S.an.baseline = v;
    ssAnHideTip(); ssSyncHash(); ssAnBuild();
    if (v === 'custom') setTimeout(() => { if (!d.tg.hidden) d.tg.focus(); }, 0);
  });
  const commitTarget = () => {
    const v = ssAnParseAmount(d.tg.value);
    if (Number.isFinite(v) && v > 0) {
      d.tg.value = ssMoney(v);
      d.tg.classList.remove('bad');
      if (v !== S.an.target) { S.an.target = v; ssSyncHash(); ssAnBuild(); }
    } else if (String(d.tg.value).trim()) d.tg.classList.add('bad');
    else d.tg.value = ssMoney(S.an.target);
  };
  d.tg.addEventListener('change', commitTarget);
  d.tg.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitTarget(); d.tg.blur(); } });
  d.tg.addEventListener('input', () => d.tg.classList.remove('bad'));
  d.gr.addEventListener('input', () => {
    const v = parseFloat(d.gr.value);
    if (!Number.isFinite(v)) return;
    S.an.growth = v;
    d.grv.textContent = (v >= 0 ? '+' : '') + v + '%';
    ssSyncHash(); ssAnBuildSoon();
  });
  const onYear = (isMin) => {
    let lo = parseInt(d.y0.value, 10), hi = parseInt(d.y1.value, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (isMin && lo > hi) { hi = lo; d.y1.value = String(hi); }
    if (!isMin && hi < lo) { lo = hi; d.y0.value = String(lo); }
    const Y = ssAnYears();
    S.an.yMin = lo <= Y.min ? null : lo;
    S.an.yMax = hi >= Y.max ? null : hi;
    ssAnYearUi(lo, hi);
    ssSyncHash(); ssAnBuildSoon();
  };
  d.y0.addEventListener('input', () => onYear(true));
  d.y1.addEventListener('input', () => onYear(false));
  // 투자 조건 (왼쪽 입력과 같은 값)
  document.getElementById('ss-an-sent').addEventListener('change', (e) => {
    const k = e.target.getAttribute && e.target.getAttribute('data-an');
    if (!k) return;
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    if (k === 'i') S.iPos = ssInitialToPos(v);
    else if (k === 'm') S.mPos = ssMonthlyToPos(v);
    else if (k === 'a') { if (!SS_RAISE_OPTS.includes(String(v))) return; S.raise = String(v); }
    else return;
    ssChanged(); ssAnBuild();
  });
  // 전략 설정 알약
  d.params.addEventListener('change', (e) => {
    const sel = e.target;
    if (!sel || !sel.classList || !sel.classList.contains('ss-an-psel')) return;
    const kind = sel.getAttribute('data-kind'), v = sel.value, k = sel.getAttribute('data-k');
    if (kind === 'rate') { S.base.invested.r = String(ssRateToPos(+v)); ssChanged(); ssAnBuild(); return; }
    if (kind === 'bu') { const nk = 'bh-' + String(v).toLowerCase(); if (!ssAnIsBh(nk)) return; if (sel.getAttribute('data-side') === 'baseline') S.an.baseline = nk; else S.an.strategy = nk; ssSyncHash(); ssAnBuild(); return; }
    if (kind === 'b') { const type = sel.getAttribute('data-type'); if (!S.base[type]) return; S.base[type][k] = String(v); ssChanged(); ssAnBuild(); return; }
    const cfg = ssFindCfg(sel.getAttribute('data-cfg'));
    if (!cfg) return;
    cfg.params = cfg.params || {};
    if (kind === 'c') cfg.params[k] = String(v);
    else if (kind === 'ci') cfg.params.r = String(v);
    else if (kind === 'cc') {
      const res = SB.res[cfg.id], sp = res && (res.schema || []).find((x) => x && String(x.id) === k), o = sp ? ssCParamOpts(sp)[+v] : null;
      if (!o) return;
      cfg.params[sp.id] = typeof o.value === 'boolean' ? o.value : String(o.value);
    } else return;
    ssPersistSaved(); ssChanged(); ssAnBuild();
  });
  // 알약 어디를 눌러도 고르기가 열리게 — 사이트 고르기 단추로 바뀐 것은 <label> 이 단추를 눌러 줌, 그대로인 것만 직접 엶
  d.params.addEventListener('click', (e) => {
    const pill = e.target.closest('.ss-an-pill');
    if (!pill || e.target.tagName === 'SELECT' || e.target.closest('button')) return;
    const sel = pill.querySelector('select');
    if (!sel || sel._csBtn || sel.classList.contains('cs-native')) return;
    if (typeof sel.showPicker === 'function') { try { sel.showPicker(); } catch (er) { sel.focus(); } } else sel.focus();
  });
  // 칸·열 머리: 마우스(데스크톱)는 따라다니는 풍선, 터치는 눌러서 고정
  grid.addEventListener('mousemove', (e) => {
    if (ssIsTouch() || e.target.closest('.ss-an-sp')) return;
    const cell = e.target.closest('td.c, th[data-r], th[data-c]');
    if (!cell || !grid.contains(cell)) { ssAnHl(null, null); ssAnHideTip(); return; }
    ssAnHl(cell.getAttribute('data-r'), cell.getAttribute('data-c'));
    if (!ssAnTipFor(cell)) ssAnHideTip();
  });
  grid.addEventListener('mouseleave', () => { if (ssIsTouch()) return; if (/^sp:/.test(SAN.tipFor)) return; ssAnHl(null, null); ssAnHideTip(); });
  grid.addEventListener('scroll', () => { if (!ssIsTouch() && !d.tip.hidden) { ssAnHideTip(); ssAnHl(null, null); } }, { passive: true });
  grid.addEventListener('click', (e) => {
    if (e.target.closest('.ss-an-sp')) {
      const bar = e.target.closest('.bar');
      if (!bar) return;
      const i = +bar.getAttribute('data-i'), pt = SAN.sp.points && SAN.sp.points[i];
      if (pt) ssAnShowTip('sp:' + i, ssAnSpiralTipHtml(pt), bar);
      return;
    }
    const cell = e.target.closest('td.c:not(.e), th[data-c]');
    if (!cell || !grid.contains(cell)) return;
    if (cell.matches('td') && !cell.hasAttribute('data-v')) return;
    ssAnHl(cell.matches('td') ? cell.getAttribute('data-r') : null, cell.getAttribute('data-c'));
    SAN.tipFor = '';
    ssAnTipFor(cell);
  });
  // 나선 막대
  grid.addEventListener('mouseover', (e) => {
    if (ssIsTouch()) return;
    const bar = e.target.closest && e.target.closest('.ss-an-sp .bar');
    if (!bar) return;
    const i = +bar.getAttribute('data-i'), pt = SAN.sp.points && SAN.sp.points[i];
    if (pt) { bar.classList.add('on'); ssAnShowTip('sp:' + i, ssAnSpiralTipHtml(pt), null, e); }
  });
  grid.addEventListener('mousemove', (e) => { if (!ssIsTouch() && /^sp:/.test(SAN.tipFor) && e.target.closest && e.target.closest('.ss-an-sp .bar')) ssAnPlace(null, e); });
  grid.addEventListener('mouseout', (e) => {
    if (ssIsTouch()) return;
    const bar = e.target.closest && e.target.closest('.ss-an-sp .bar');
    if (!bar || (e.relatedTarget && bar.contains(e.relatedTarget))) return;
    bar.classList.remove('on');
    if (/^sp:/.test(SAN.tipFor)) ssAnHideTip();
  });
  tip.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) { ssAnHideTip(); ssAnHl(null, null); } });
  // 나선은 담는 칸 크기에 맞춰 그림 — 칸 크기가 바뀌면(창 크기·머리 줄 높이·설정 펼침) 다시 그림
  const refit = () => {
    clearTimeout(SAN.fitT);
    SAN.fitT = setTimeout(() => { SAN.fitT = null; if (S.an.open && S.an.baseline === 'custom-pct' && SAN.sp.points && SAN.sp.size !== ssAnSpiralSize()) { SAN.sig = ''; ssAnBuild(); } }, 150);
  };
  window.addEventListener('resize', () => { if (!S.an.open) return; ssAnHideTip(); refit(); });
  if (window.ResizeObserver) new ResizeObserver(() => { if (S.an.open) refit(); }).observe(grid);
}
// Esc = 닫기 (창 위 다른 Esc 처리보다 먼저)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.an.open || !SAN.dom || SAN.dom.root.hidden) return;
  if (document.querySelector('.cs-menu.open')) return;   // 열린 고르기 메뉴는 사이트 코드가 Esc 로 먼저 닫음
  e.stopImmediatePropagation();
  e.preventDefault();
  if (!SAN.dom.tip.hidden && ssIsTouch()) { ssAnHideTip(); ssAnHl(null, null); return; }
  ssAnalyticsClose();
}, true);

// 금액 글 → 숫자: $1M · 1m · 250k · 1.5b · $1,000,000 · 100만 · 1억 · 1억5000만 · 5천
function ssAnParseAmount(str) {
  const s = String(str == null ? '' : str).replace(/[$,\s원]/g, '').toLowerCase();
  if (!s) return NaN;
  const U = { k: 1e3, m: 1e6, b: 1e9, 천: 1e3, 만: 1e4, 억: 1e8, 조: 1e12 };
  const re = /(\d+(?:\.\d+)?|\.\d+)(k|m|b|천|만|억|조)?/g;
  let total = 0, used = 0, mt;
  while ((mt = re.exec(s))) {
    if (mt.index !== used) return NaN;
    used = re.lastIndex;
    total += parseFloat(mt[1]) * (mt[2] ? U[mt[2]] : 1);
  }
  return used === s.length && used > 0 ? total : NaN;
}

// ── 그림으로 받기 (html2canvas 는 처음 누를 때만 불러옴) ──
function ssAnLoadH2C() {
  if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
  if (SAN.h2c) return SAN.h2c;
  SAN.h2c = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SS_AN_H2C;
    s.async = true;
    s.onload = () => (typeof window.html2canvas === 'function' ? res(window.html2canvas) : rej(new Error('html2canvas')));
    s.onerror = () => { SAN.h2c = null; s.remove(); rej(new Error('load')); };
    document.head.appendChild(s);
  });
  return SAN.h2c;
}
async function ssAnDownload() {
  const d = SAN.dom, btn = document.getElementById('ss-an-dl');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('wait');
  btn.setAttribute('aria-busy', 'true');
  btn.title = '그림 만드는 중… (표가 크면 몇 초 걸립니다)';
  const fail = (msg) => ssDialog('그림 받기', msg, [{ t: '확인', pri: true }]);
  try {
    let h2c;
    try { h2c = await ssAnLoadH2C(); } catch (e) { fail('이미지 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.'); return; }
    ssAnHideTip(); ssAnHl(null, null);
    // 표 전체가 들어갈 크기 — 복제본(onclone)에서만 펼쳐 찍으므로 화면은 그대로
    const cs = getComputedStyle(d.box), head = d.box.querySelector('.ss-an-head');
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom), gap = parseFloat(cs.rowGap) || 8;
    const W = Math.ceil(Math.max(d.box.clientWidth, d.grid.scrollWidth + 2 + padX)), H = Math.ceil(head.offsetHeight + gap + d.grid.scrollHeight + 2 + padY);
    const scale = Math.max(0.5, Math.min(2, Math.sqrt(16e6 / (W * H))));   // 캔버스 1,600만 화소 안 (휴대폰 브라우저 한도)
    const bg = (getComputedStyle(document.documentElement).getPropertyValue('--bg') || '').trim() || getComputedStyle(document.body).backgroundColor || '#101013';
    // 복제할 때 이 창 밖(본 화면·광고·메뉴 등)은 건너뜀 — <head>(스타일)와 창으로 가는 길만 남김
    const keep = (el) => el === document.documentElement || el === document.body || el === d.root || d.root.contains(el) || el.tagName === 'HEAD' || !!(el.closest && el.closest('head'));
    const canvas = await h2c(d.box, { backgroundColor: bg, scale, logging: false, useCORS: true, width: W, height: H, windowWidth: W, windowHeight: H, scrollX: 0, scrollY: 0,
      ignoreElements: (el) => !keep(el),
      onclone: (doc) => {
        const root = doc.getElementById('ss-an'), grid = doc.getElementById('ss-an-grid');
        if (!root || !grid) return;
        root.classList.add('cap');
        grid.style.overflow = 'visible'; grid.style.flex = '0 0 auto'; grid.style.height = 'auto'; grid.style.minHeight = '0';
        doc.querySelectorAll('#ss-an-box select:not(.cs-native), #ss-an-box input[type="text"]').forEach((el) => {
          if (el.closest('[hidden]')) return;
          const r = doc.createElement('b');
          r.className = 'ss-an-capv';
          r.textContent = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value) : el.value;
          el.parentNode.replaceChild(r, el);
        });
        doc.querySelectorAll('#ss-an-box .ss-an-dual, #ss-an-gr, #ss-an-box .ss-an-acts, #ss-an-ptog, #ss-an-close').forEach((el) => { el.style.display = 'none'; });
        const pr = doc.getElementById('ss-an-prog');
        if (pr) pr.style.visibility = 'hidden';
      } });
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { fail('그림이 너무 커서 만들지 못했습니다 — 시작 연도 범위를 좁혀 다시 받아 보세요.'); return; }
    const now = new Date(), ymd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const nm = (k) => (k === 'custom' ? 'custom-' + Math.round(S.an.target) : k === 'custom-pct' ? 'custom-pct-' + S.an.growth : ssAnIsCfg(k) ? (ssAnCfg(k) || {}).name || 'saved' : k);
    const san = (t) => String(t).replace(/[^0-9A-Za-z가-힣._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.download = 'strategy-analytics-' + san(nm(S.an.strategy)) + '-vs-' + san(nm(S.an.baseline)) + '-' + ymd + '.png';
    a.href = url;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    fail('그림을 만들지 못했습니다: ' + ssEsc((err && err.message) || String(err)));
  } finally {
    btn.disabled = false;
    btn.classList.remove('wait');
    btn.removeAttribute('aria-busy');
    btn.title = '그림(PNG)으로 받기';
  }
}

// ── 열기 · 닫기 · 갱신 (다른 파일이 부름) ──
function ssAnalyticsOpen(keepSelection) {
  if (!ssReady || !DS.q) return;
  const d = ssAnEnsureDom();
  if (!keepSelection) ssAnAutoPick();
  ssAnFixKeys();
  const wasOpen = S.an.open && !d.root.hidden;
  S.an.open = true;
  if (!wasOpen) {
    SAN.lock = { b: document.body.style.overflow, h: document.documentElement.style.overflow };
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    d.root.hidden = false;
    SAN.warming = '';
    ssAnHideTip();
    try { d.root.focus({ preventScroll: true }); } catch (e) {}
  }
  SAN.sig = '';
  ssAnBuild();
  ssSyncHash();
}
function ssAnalyticsClose() {
  if (!SAN.dom) { S.an.open = false; return; }
  S.an.open = false;
  SAN.epoch++;                                // 진행 중인 계산 멈춤
  SAN.busy = false;
  clearTimeout(SAN.timer); SAN.timer = null;
  if (SAN.raf) { cancelAnimationFrame(SAN.raf); SAN.raf = 0; }
  SAN.sig = '';
  ssAnHideTip();
  SAN.dom.root.hidden = true;
  if (SAN.lock) { document.body.style.overflow = SAN.lock.b; document.documentElement.style.overflow = SAN.lock.h; SAN.lock = null; }
  const b = document.getElementById('ss-an-open');
  if (b) { try { b.focus({ preventScroll: true }); } catch (e) {} }
  ssSyncHash();
}
function ssAnalyticsToggle() { if (S.an.open && SAN.dom && !SAN.dom.root.hidden) ssAnalyticsClose(); else ssAnalyticsOpen(false); }
// 본 화면을 다시 그릴 때마다 (열려 있으면 300ms 뒤 — 결과에 영향이 있는 것이 바뀌었을 때만 다시 계산)
function ssAnalyticsRefresh() {
  if (!S.an.open || !SAN.dom || SAN.dom.root.hidden) return;
  clearTimeout(SAN.timer);
  SAN.timer = setTimeout(() => { SAN.timer = null; if (S.an.open) ssAnBuild(true); }, 300);
}

// 시험·문제 확인용 읽기 손잡이 (화면·계산에는 영향 없음)
window.SSAN = Object.freeze({
  busy: () => SAN.busy || !!SAN.timer || !!SAN.raf || !!SAN.fitT,
  colStats: (p) => (SAN.dom ? ssAnColStats(+p) : null),
  spiral: () => (SAN.sp.points ? SAN.sp.points.map((d) => ({ year: d.year, pct: d.pct, partial: d.partial })) : null),
  parse: (s) => ssAnParseAmount(s),
});

/* ═══ 99-init.js ═══ */
/* ── [STRATSIM] 99 시작 ─────────────────────────────────────────────────
   자료 받기 → 화면 뼈대 → 저장된 상태(주소 # > 브라우저 저장 > 기본) → 첫 계산 */

async function ssBoot() {
  const root = document.getElementById('ss-app');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';
  root.innerHTML = ssShellHtml();
  const panel = document.createElement('aside');
  panel.id = 'ss-panel';
  panel.className = 'ss-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = ssPanelShell();
  document.body.appendChild(panel);
  const mtip = document.createElement('div');
  mtip.id = 'ss-mtip';
  document.body.appendChild(mtip);
  const fail = (msg) => { const t = document.getElementById('ss-loading-t'); if (t) { t.textContent = msg; t.classList.add('err'); } const sp = root.querySelector('.ss-spin'); if (sp) sp.style.display = 'none'; };
  let stamp = '';
  try { const r = await fetch('data/stratsim/updated.txt', { cache: 'no-store' }); if (r.ok) stamp = (await r.text()).trim(); } catch (e) {}
  const v = encodeURIComponent(stamp || String(Date.now()).slice(0, 7));
  let pricesTxt, nfciTxt = '';
  try {
    const [p, n] = await Promise.all([fetch('data/stratsim/prices.csv?v=' + v), fetch('data/stratsim/nfci.csv?v=' + v).catch(() => null)]);
    if (!p.ok) throw new Error('HTTP ' + p.status);
    pricesTxt = await p.text();
    if (n && n.ok) nfciTxt = await n.text();
  } catch (e) { fail('가격 자료를 불러오지 못했습니다 — 새로고침해 주세요.'); return; }
  const days = ssParsePrices(pricesTxt);
  if (days.length < 300) { fail('가격 자료가 올바르지 않습니다 — 새로고침해 주세요.'); return; }
  ssInitData(days, ssParseNfci(nfciTxt));
  if (stamp) {
    const d = new Date(stamp);
    if (!Number.isNaN(d.getTime())) {
      S.fetchedAt = d;
      const f = document.getElementById('ss-fetched'), t = document.getElementById('ss-fetched-t');
      if (f && t) { t.textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); f.hidden = false; }
    }
  }
  // 기본: 청산 = 마지막 분기 · 진입 = 2010년 1분기 (3배 ETF 가 나온 때)
  S.x = DS.q.length - 1;
  S.e = ssDefaultEntry();
  ssLoadStorage();
  ssTxLoad();
  const shared = await ssReadHash();
  let mapped = null;
  if (shared) {
    ssApplyMain(shared, true);
    if (shared.bu && SS_COL[shared.bu]) S.base.bh.ul = shared.bu;
    if (shared.b9) S.base['9sig'] = ssCleanParams('9sig', shared.b9);
    if (shared.bs) S.base.sma = ssCleanParams('sma', shared.bs);
    if (Array.isArray(shared.sc)) mapped = ssImportShared(shared.sc);
    if (Array.isArray(shared.tx) && shared.tx.length) ssTxFromShared(shared.tx);
    const anKey = (k) => { if (typeof k !== 'string') return null; if (k.indexOf('cfg:') !== 0) return k; const i = parseInt(k.slice(4), 10); const c = mapped && mapped[i]; const id = c ? ssResolveShared(c) : null; return id ? 'cfg:' + id : null; };
    if (shared.as) { const k = anKey(shared.as); if (k) S.an.strategy = k; }
    if (shared.ab) { const k = anKey(shared.ab); if (k) S.an.baseline = k; }
    if (Number.isFinite(+shared.act) && +shared.act > 0) S.an.target = +shared.act;
    if (Number.isFinite(+shared.acp)) S.an.growth = +shared.acp;
    if (Number.isFinite(+shared.anp) && +shared.anp > 0) S.an.yMin = +shared.anp;
    if (Number.isFinite(+shared.amp) && +shared.amp > 0) S.an.yMax = +shared.amp;
  }
  if (S.x > DS.q.length - 1) S.x = DS.q.length - 1;
  ssPeriodUI.init(root);
  ssWireShell(root);
  ssWirePills();
  ssWirePanel();
  SB.onResult = (id, ydayOnly) => { if (ydayOnly) { if (ssChart) ssChart.update('none'); return; } ssRender(); };
  SB.onName = (id, name) => {
    const c = ssFindCfg(id);
    if (!c || !/^사용자 전략( \(\d+\))?$/.test(c.name)) return;
    const t = String(name).replace(/\s+/g, ' ').trim();
    if (!t) return;
    c.name = ssUniqueName(t, c.id);
    ssPersistSaved();
    if (S.editing === c.id) ssPanelTitle(c.name);
  };
  ssReady = true;
  ssRender();
  _ssHashTok = (location.hash || '').replace(/^#/, '');
  if (shared) {
    if (shared.rf && shared.rt) ssPinRange(String(shared.rf), String(shared.rt));
    let opened = false;
    const si = parseInt(shared.spc, 10);
    if (mapped && Number.isInteger(si) && mapped[si]) { const id = ssResolveShared(mapped[si]); if (id) { ssOpenCfgPanel(id); opened = true; } }
    if (!opened && (shared.sp === 'bh' || shared.sp === 'invested')) ssOpenBasePanel(shared.sp, true);
    if (shared.am && typeof ssAnalyticsOpen === 'function') ssAnalyticsOpen(!!(shared.as || shared.ab));
  }
  ssTxRefreshSheet();
  if (typeof ssLibraryFromHash === 'function') ssLibraryFromHash();
  // 다른 공유 링크를 같은 페이지에 붙여 넣으면 그 상태로 다시 엶
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace(/^#/, '');
    if (/^ss=/.test(h) && h !== _ssHashTok) location.reload();
    else if (typeof ssLibraryFromHash === 'function') ssLibraryFromHash();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ssBoot);
else ssBoot();
// 시험·문제 확인용 읽기 손잡이 (tests/run_regression.py 등) — 화면·계산에는 영향 없음
window.SSM = Object.freeze({
  get S() { return S; }, get R() { return R; }, get DS() { return DS; }, get chart() { return ssChart; }, get zoom() { return { lo: SZ.lo, hi: SZ.hi }; },
  ready: () => ssReady, render: () => ssRender(), add: (entry) => ssAddFromLibrary(entry),
  openCfg: (id) => ssOpenCfgPanel(id), openBase: (k) => ssOpenBasePanel(k),
});

})();
