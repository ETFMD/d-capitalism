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
function ssIrr(flows) {
  if (!flows || flows.length < 2 || !flows.some((f) => f.cf > 0) || !flows.some((f) => f.cf < 0)) return null;
  // 현재가치 합 (흐름 순서대로 더함)
  const pv = (rate) => flows.reduce((acc, f) => acc + f.cf / Math.pow(1 + rate, f.t), 0);
  // 구간 [a, b] 를 반씩 줄임 — 연 −99.9999% ~ +100,000%, 최대 300번
  let a = -0.999999, b = 1000, pa = pv(a);
  const pb = pv(b);
  if (pa === 0) return a * 100;
  if (!(Number.isFinite(pa) && Number.isFinite(pb)) || pa * pb > 0) return null;
  for (let left = 300; left > 0; left--) {
    const c = (a + b) / 2, pc = pv(c);
    if (!Number.isFinite(pc)) return null;
    if (b - a < 1e-12 || Math.abs(pc) < 1e-9) return c * 100;
    if (pa * pc > 0) { a = c; pa = pc; } else b = c;
  }
  return (a + b) / 2 * 100;
}
const SS_YEAR_MS = 365.25 * 86400000;
// 넣은 돈의 흐름: 시작 −initial, 그 뒤 적립(일정 있으면 일정 날짜, 없으면 월말 공식)
function ssFlows(initial, monthly, raise, d0, d1, sched) {
  const t0 = Date.parse(d0 + 'T00:00:00Z');
  const flows = [{ t: 0, cf: -initial }];
  if (sched && sched.list) {
    for (const r of sched.list) if (r.date > d0 && r.date <= d1 && r.amount !== 0) flows.push({ t: (Date.parse(r.date + 'T00:00:00Z') - t0) / SS_YEAR_MS, cf: -r.amount });
    return flows;
  }
  if (monthly > 0 && DS.m) {
    const y0 = +d0.slice(0, 4);
    for (const r of DS.m) if (r[0] > d0 && r[0] <= d1) flows.push({ t: (Date.parse(r[0] + 'T00:00:00Z') - t0) / SS_YEAR_MS, cf: -monthly * Math.pow(1 + (raise || 0), +r[0].slice(0, 4) - y0) });
  }
  return flows;
}
// 돈 가중 CAGR(%) — 못 풀면 (평가액/넣은 돈)^(1/년) − 1
function ssCagrMW(initial, monthly, raise, d0, d1, years, finalV, contributed, sched) {
  if (!(finalV > 0) || !(years > 0)) return 0;
  const flows = ssFlows(initial, monthly, raise, d0, d1, sched);
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
