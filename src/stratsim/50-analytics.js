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
    const r = ssRun9(Object.assign(base, { rate: ssRate9(p), period: p.per || 'quarterly', noBH: true }, ssOpts9(p)));
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
  return out;
}
// 날마다 걷는 계산(SMA · 사용자 코드)인지 — 적립이 '달이 바뀐 첫 거래일'에 들어감. 나머지(9sig·그냥 보유·현금 복리)는 월말
function ssAnDaily(k) {
  if (k === 'sma') return true;
  const c = ssAnIsCfg(k) ? ssAnCfg(k) : null;
  return !!c && (c.type === 'sma' || c.type === 'custom');
}
// 시작 금액을 넣은 날: 날마다 걷는 계산은 진입 분기말(엔진·코드가 받는 진입일), 나머지는 계산의 첫 점(주 단위 9sig 는 그 전 주말일 수 있음)
const ssAnStartDate = (k, e, pts) => (ssAnDaily(k) ? DS.q[e][0] : pts && pts.length ? String(pts[0].date) : null);
// 기간 연평균(%, 돈 가중) — 그 전략이 실제로 돈을 넣은 날짜·금액(시작 금액 d0 · 적립 d0 다음 ~ d1)과 d1 의 평가액 v 로 푼 IRR.
// 본 화면 '연평균 수익률'과 같은 계산(ssCagrMW). 못 구하면 null
function ssAnCagr(daily, d0, d1, v, inp) {
  if (!d0 || !d1 || !(d1 > d0) || !(v > 0)) return null;
  const key = (daily ? 'd' : 'm') + d0 + d1 + '|' + v + '|' + inp.initial + '|' + inp.monthly + '|' + inp.raise;
  if (SAN.cg.has(key)) return SAN.cg.get(key);
  const years = (Date.parse(d1) - Date.parse(d0)) / SS_YEAR_MS;
  let paid = 0;
  for (const f of ssFlows(inp.initial, inp.monthly, inp.raise, d0, d1, null, daily)) paid -= f.cf;
  const r = paid > 0 ? ssCagrMW(inp.initial, inp.monthly, inp.raise, d0, d1, years, v, paid, null, daily) : null;
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
        td.setAttribute('data-bv', String(b));
        td.setAttribute('data-b0', bs.d0 || '');
        td.setAttribute('data-bd', (bs.src && bs.src[off]) || '');
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
  const inp = ssAnInputs(), cg = ssAnCagr(ssAnDaily(st), td.getAttribute('data-s0'), td.getAttribute('data-sd'), v, inp);
  const bAmt = +td.getAttribute('data-bv') > 0 ? +td.getAttribute('data-bv') : bv;
  const bcg = bl !== 'custom' && dv > 0 ? ssAnCagr(ssAnDaily(bl), td.getAttribute('data-b0'), td.getAttribute('data-bd'), bAmt, inp) : null;
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
      s0: td.getAttribute('data-s0'), sd: td.getAttribute('data-sd') });
  });
  if (!smp.length) return null;
  // 연평균: 칸마다 칸 풍선과 같은 돈 가중 연수익률 (실제 넣은 날짜·금액 · 실제 기간 — 올해처럼 덜 찬 해도 그대로)
  const inp = ssAnInputs(), daily = ssAnDaily(S.an.strategy);
  for (const s of smp) { const g = ssAnCagr(daily, s.s0, s.sd, s.value, inp); s.cagr = g ? g.pct : null; }
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
    const cg = rng ? ssAnCagr(ssAnDaily(k), ssAnStartDate(k, rng.e, ser), String(ser[ser.length - 1].date), today, ssAnInputs()) : null;
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
