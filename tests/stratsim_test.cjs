#!/usr/bin/env node
/* [STRATSIM] 투자전략 시뮬레이터 계산 회귀 검사 — node tests/stratsim_test.cjs
   · 화면 계산 코드(src/stratsim/*.js)를 그대로 불러와(scripts/stratsim_fit.cjs 와 같은 방법) 고정 구간 5가지의 기준값과 대조
     (기준값 = 원본 Strategies Simulator 와 무작위 3,800번·화면 12가지 대조를 마친 엔진으로 2026-10-20 에 계산 — 구간이 고정이라 새 자료가 붙어도 그대로.
      2026-10-21: 연평균만 7곳 다시 계산 — 원본도 틀리던 것을 고침: SMA 적립 날짜(월말 → 실제 달 첫 거래일) · 리밸런스 시점을 옮긴 9sig 의 끝 날짜(청산일 전 마지막 리밸런스 날 값인데 청산일까지 셈) ·
      주 단위 화면에서 진입 전 월말 적립이 하나 더 들어가던 것. 끝 금액·낙폭은 그대로)
   · 연평균(돈 가중 CAGR): 답을 아는 흐름으로 IRR(50년 넘는 기간 포함) · 적립 흐름 = 엔진이 실제로 넣은 돈(무작위 화면 조건 60가지) ·
     정확한 청산일의 SMA 끝 값 · 1953년~최신 적립식 연평균
   · 과최적화 탐색기 자료(data/stratsim/fit-*.json): 탭·행 수가 후보와 같고, 무작위 행의 맞춘 구간 지표를 다시 계산하면 저장된 값과 같음
   · 전략 라이브러리 코드 전략(2026-10-21 고친 것): 어느 날 들어온 돈도 사라지지 않음(특히 파는 날) · #1 Faber 는 달의 마지막
     거래일에만 판단(주 단위 화면에서도 같은 거래) · #18 은 주의 마지막 거래일에만 · #26 중심선 = 마지막 W 거래일로 직접 계산한 값
   실패하면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const path = require('path'), fs = require('fs');
const F = require(path.join(__dirname, '..', 'scripts', 'stratsim_fit.cjs'));
const M = F.M, S = M.S;
const GOLD = [
  {"name":"기본 2010–2025 · 전략 없음","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.2731878649,81.6150703134,6162492.04356,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null]}},
  {"name":"9sig·SMA 기본","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[["9sig",{}],["sma",{}]],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.2731878649,81.6150703134,6162492.04356,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null],"g0":[39.0547580275,59.66735114,5448549.33593,"2021-11-19","2022-12-28"],"g1":[44.9301312397,46.2811945542,9990216.92722,"2018-08-29","2019-08-05"]}},
  {"name":"거치식 $100K 2000–2020","e":188,"x":271,"i":500,"m":0,"a":"0","cfgs":[["9sig",{}],["sma",{}],["9sig",{"per":"monthly","g":"3"}]],"labels":[253,"1999-12-31","2020-12-31"],"met":{"bh":[-9.21103178578,99.9823378436,13140.3979103,"2000-03-27","2009-03-09"],"invested":[4.07374795303,0,231313.351046,null,null],"g0":[-7.40838272748,99.9552507683,19858.0420443,"2000-03-27","2009-03-09"],"g1":[14.4836791711,78.9873796806,1712914.79269,"2000-04-03","2003-04-09"],"g2":[-8.19129104088,99.9581791471,16614.4233182,"2000-03-27","2009-03-09"]}},
  {"name":"적립 $1000 +5% 1990–2015","e":148,"x":251,"i":333,"m":1000,"a":"5","cfgs":[["9sig",{"park":"qqq","dep":"50","rp":"50"}],["sma",{"sig":"spy","win":"100","eb":"2","xb":"2","cb":"3","cs":"3","settle":"2","oh":"70","cool":"50","out":"qqq","din":"5","dout":"10","bg":"0"}]],"labels":[105,"1989-12-29","2015-12-31"],"met":{"bh":[11.4427582318,99.9364556645,2875775.77533,"2000-03-27","2002-09-23"],"invested":[4.07341312015,0,1041994.61333,null,null],"g0":[12.0045555275,99.1114675088,3076467.31677,"2000-03-27","2002-10-07"],"g1":[13.5376651311,87.5237503647,4001125.07494,"2000-03-27","2008-11-20"]}},
  {"name":"1953–1999 · 매년·매주","e":1,"x":187,"i":300,"m":100,"a":"0","cfgs":[["9sig",{"per":"yearly","g":"30","cash":"30","bp":"100","tc":"target"}],["9sig",{"per":"weekly","g":"1","ul":"qld","cost":"0.1"}],["bh",{"ul":"spy"}],["invested",{"r":"300"}]],"labels":[2441,"1953-03-27","1999-12-31"],"met":{"bh":[20.7871139834,96.6186281433,86119176.9562,"1972-04-12","1974-10-03"],"invested":[4.07389214888,0,204793.870698,null,null],"g0":[20.6686005009,96.6349994763,82472483.8721,"1972-04-12","1974-10-03"],"g1":[16.5161529271,87.1364862715,18035088.7931,"1972-04-12","1974-10-03"],"g2":[9.96595361879,46.5624985366,1590456.66504,"1973-01-11","1974-10-03"],"g3":[9.38018658215,0,1285249.89721,null,null]}}
];
let n = 0, bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };
const close = (a, b, tol) => (a == null || b == null ? a === b : Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)));
for (const g of GOLD) {
  S.saved = g.cfgs.map(([t, p], k) => ({ id: 'g' + k, type: t, name: t + k, params: M.ssCleanParams(t, Object.assign(M.ssDefaults(t), p)), color: '#ffffff', hidden: false }));
  S.e = g.e; S.x = g.x; S.iPos = g.i; S.mPos = M.ssMonthlyToPos(g.m); S.raise = g.a; S.ed = ''; S.xd = ''; S.editing = null; S.panel = null; S.infl = false; S.log = false; S.tx = null;
  M.ssRender();
  const R = M.R;
  n++;
  if (R.labels.length !== g.labels[0] || R.labels[0] !== g.labels[1] || R.labels[R.labels.length - 1] !== g.labels[2]) fail(g.name + ': 라벨 ' + [R.labels.length, R.labels[0], R.labels[R.labels.length - 1]] + ' ≠ ' + g.labels);
  for (const [k, want] of Object.entries(g.met)) {
    const v = R.metrics[k === 'bh' || k === 'invested' ? k : 'cfg:' + k];
    n++;
    if (!v) { fail(g.name + ' ' + k + ': 결과 없음'); continue; }
    const got = [v.cagr, v.maxDD, v.end, v.ddPeak, v.ddTrough];
    if (!close(got[0], want[0], 1e-7) || !close(got[1], want[1], 1e-7) || !close(got[2], want[2], 1e-7) || got[3] !== want[3] || got[4] !== want[4])
      fail(g.name + ' ' + k + ': ' + JSON.stringify(got) + ' ≠ ' + JSON.stringify(want));
  }
}
// 과최적화 탐색기 자료
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stratsim_fit_seed.json'), 'utf8'));
for (const kind of ['9sig', 'sma']) {
  const file = path.join(__dirname, '..', 'data', 'stratsim', 'fit-' + kind + '.json');
  let D;
  try { D = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(kind + ': fit 자료 읽기 실패 ' + e.message); continue; }
  const sd = seed[kind];
  n++;
  if (D.tabs.length !== sd.tabs.length) { fail(kind + ': 탭 ' + D.tabs.length + ' ≠ ' + sd.tabs.length); continue; }
  D.tabs.forEach((t, i) => {
    n++;
    if (t.key !== sd.tabs[i].key || t.rows.length !== sd.tabs[i].rows.length) fail(kind + ' ' + t.key + ': 행 ' + t.rows.length + ' ≠ ' + sd.tabs[i].rows.length);
    for (const r of t.rows) if (!(r[0] > 0) || !Number.isFinite(r[1]) || !(r[2] >= 0 && r[2] <= 100) || r[8] == null) { fail(kind + ' ' + t.key + ': 이상한 행 ' + JSON.stringify(r.slice(0, 9))); break; }
  });
  // 무작위 행 2개(탭마다 다르게)를 다시 계산
  for (const ti of [0, 3]) {
    const t = D.tabs[ti], r = t.rows[Math.floor(t.rows.length / 3)];
    const p = Object.assign({}, D.fixed);
    D.keys.forEach((k, j) => { p[k] = String(r[D.cols.length + j]); });
    const st = F.staticMetrics(kind, M.ssCleanParams(kind, p), t.e, t.from);
    n++;
    const same = st.every((v, j) => (typeof v === 'number' ? close(v, r[j], 1e-9) : v === r[j]));
    if (!same) fail(kind + ' ' + t.key + ': 다시 계산한 맞춘 구간 지표가 다름 ' + JSON.stringify(st) + ' ≠ ' + JSON.stringify(r.slice(0, st.length)));
  }
}
// 전략 라이브러리 코드 전략 — 고친 버그가 되살아나지 않게
{
  const vm = require('vm');
  const lctx = { console, Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, parseFloat, parseInt, isFinite, Infinity, NaN,
    document: { getElementById() { return null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }, window: { addEventListener() {} } };
  vm.createContext(lctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'stratsim', '30-library.js'), 'utf8') + ';globalThis.__L = { lib: SS_LIBRARY };', lctx);
  const LIB = lctx.__L.lib.filter((e) => e.code);
  const DSd = M.DS.days, ND = DSd.length;
  const data = { dates: DSd.map((d) => d.date), nfci: Array.from(M.DS.nfci) };
  for (const k of ['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq']) data[k] = DSd.map((d) => d[k]);
  const at = new Map(data.dates.map((d, i) => [d, i]));
  const firstAt = (d) => data.dates.findIndex((x) => x >= d);
  const monthly = (s, e) => { const c = {}; let lm = data.dates[s].slice(0, 7); for (let i = s + 1; i <= e; i++) { const m = data.dates[i].slice(0, 7); if (m !== lm) { lm = m; c[data.dates[i]] = 1000; } } return c; };
  const run = (e, s, x, weekly, contributions, extra) => {
    const mod = (0, eval)('(' + e.code + ')');
    const p = { initial: 10000, contributions, monthly: 1000, annualRaise: 0, startIdx: s, endIdx: x, entryDate: data.dates[s], exitDate: data.dates[x], weeklyDisplay: weekly };
    for (const sp of mod.params || []) if (sp && sp.id) p[sp.id] = sp.default;
    const r = mod.run(data, Object.assign(p, extra || {}));
    return { log: Array.isArray(r) ? r : r.log, cost: (p.tradeCost || 0) / 100 };
  };
  const isTrade = (a) => !/^(hold|contribution|start|end)\b/.test(String(a)) && String(a) !== 'hold';
  // ① 들어온 돈이 사라지지 않음: 거래한 날에 X 를 더 넣으면 그날 평가액이 X 만큼(거래 비용만큼 덜) 커짐
  const X = 777;
  for (const e of LIB) {
    for (const [d0, d1, weekly] of [['1999-06-01', '2009-12-31', false], ['2018-01-02', '2024-06-28', true]]) {
      const s = firstAt(d0), x = firstAt(d1), c = monthly(s, x), A = run(e, s, x, weekly, c);
      for (const r of A.log.filter((q) => isTrade(q.action) && q.date !== data.dates[s] && q.date !== data.dates[x]).slice(0, 8)) {
        const c2 = Object.assign({}, c); c2[r.date] = (c2[r.date] || 0) + X;
        const rb = run(e, s, x, weekly, c2).log.find((q) => q.date === r.date);
        const dv = rb ? rb.value - r.value : NaN, tol = 1e-6 * Math.max(1, r.value);
        n++;
        if (!(dv >= X * (1 - 2 * A.cost) - tol && dv <= X + tol)) fail('라이브러리 #' + e.n + ': ' + r.date + ' ' + String(r.action).slice(0, 16) + ' 날 들어온 ' + X + ' 가 평가액에 ' + (Number.isFinite(dv) ? dv.toFixed(2) : dv) + ' 만 반영');
      }
    }
  }
  // ② #1 은 달의 마지막 거래일에만 판단 — 주 단위·달 단위 화면에서 거래가 같음 · ③ #18 은 주의 마지막 거래일에만
  const wk = (d) => Math.floor((Date.parse(d) / 864e5 + 3) / 7);
  const e1 = LIB.find((e) => e.n === 1), e18 = LIB.find((e) => e.n === 18);
  for (const [d0, d1] of [['2016-01-04', '2023-08-16'], ['1987-03-02', '1992-11-11'], ['2019-02-01', '2026-01-14']]) {
    const s = firstAt(d0), x = firstAt(d1), c = monthly(s, x);
    const tw = run(e1, s, x, true, c).log.filter((q) => isTrade(q.action)), tm = run(e1, s, x, false, c).log.filter((q) => isTrade(q.action));
    n++;
    if (tw.map((q) => q.date + q.action).join() !== tm.map((q) => q.date + q.action).join()) fail('라이브러리 #1: 주 단위 화면의 거래가 달 단위와 다름 ' + d0);
    for (const q of tm) { const i = at.get(q.date); n++; if (!(i + 1 < ND && data.dates[i + 1].slice(0, 7) !== q.date.slice(0, 7))) fail('라이브러리 #1: 달의 마지막 거래일이 아닌 ' + q.date + ' 에 거래'); }
    for (const q of run(e18, s, x, true, c).log.filter((q) => isTrade(q.action))) { const i = at.get(q.date); n++; if (!(i + 1 < ND && wk(data.dates[i + 1]) !== wk(q.date))) fail('라이브러리 #18: 주의 마지막 거래일이 아닌 ' + q.date + ' 에 거래'); }
  }
  // ④ #26 중심선 = 마지막 W 거래일(양수 가격)로 직접 계산한 중앙값·평균 — 창 밖 첫날 가격과 같은 값이 창 안에 있는 시작일 포함
  const e26 = LIB.find((e) => e.n === 26), med = (a) => { const b = a.slice().sort((u, v) => u - v), m = b.length; return m % 2 ? b[(m - 1) / 2] : (b[m / 2 - 1] + b[m / 2]) / 2; };
  for (const [d0, W, stat] of [['2012-06-01', 250, 'median'], ['1999-03-15', 250, 'median'], ['2020-04-01', 100, 'sma'], ['1975-01-02', 40, 'median']]) {
    let s = firstAt(d0);
    for (let t = 0; t < 400; t++, s++) { const v = data.tqqq[s - W]; let dup = false; for (let j = s - W + 1; j <= s; j++) if (data.tqqq[j] === v) { dup = true; break; } if (dup) break; }
    const x = Math.min(ND - 1, s + 260), log = run(e26, s, x, false, {}, { window: W, stat, asset: 'tqqq' }).log;
    let wrong = 0;
    for (const r of log) { const i = at.get(r.date), v = []; for (let j = Math.max(0, i - W + 1); j <= i; j++) if (data.tqqq[j] > 0) v.push(data.tqqq[j]); const want = stat === 'median' ? med(v) : v.reduce((a, b) => a + b, 0) / v.length; if (Math.abs(r.medianPrice - want) > 1e-9 * Math.max(1, want)) wrong++; }
    n++;
    if (wrong) fail('라이브러리 #26: 중심선이 마지막 ' + W + '거래일로 직접 계산한 값과 ' + wrong + '줄 다름 (' + data.dates[s] + ' 시작)');
  }
}
// 연평균(돈 가중 CAGR · 2026-10-21 고친 것) — ① IRR: 답을 아는 흐름으로 (50년 넘는 기간 포함, 예전엔 풀지 못해 대략식으로 떨어짐)
// ② 연평균에 쓰는 적립 흐름 = 엔진이 실제로 넣은 돈 (9sig·그냥 보유·현금 복리 = 월말 · SMA·사용자 코드 = 달이 바뀐 첫 거래일)
// ③ 정확한 청산일(분기 중간)의 SMA 끝 값 = 그날 값 ④ 1953년~최신 적립식 연평균이 따로 푼 값과 같음
{
  let seed = 20261021;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  // ① 흐름을 만들고 정한 연이율 r* 로 끝 값을 정하면 IRR 은 정확히 r* (넣기만 하고 끝에 한 번 받으므로 답이 하나)
  for (let k = 0; k < 400; k++) {
    const T = k < 40 ? 50 + rnd() * 30 : 0.3 + rnd() * 79.7, rs = -0.6 + rnd() * 1.8;
    const ini = pick([0, 100, 10000, 1e6]), mon = ini === 0 ? pick([50, 1000, 5000]) : pick([0, 0, 50, 1000, 5000]), ra = pick([0, 0.03, 0.1]);
    const flows = [{ t: 0, cf: -ini }];
    for (let m = 1; m / 12 <= T; m++) flows.push({ t: m / 12, cf: -mon * Math.pow(1 + ra, Math.floor((m - 1) / 12)) });
    let V = 0;
    for (const f of flows) V -= f.cf * Math.pow(1 + rs, T - f.t);
    if (!(V > 0) || !Number.isFinite(V)) continue;
    const got = M.ssIrr(flows.concat([{ t: T, cf: V }]));
    n++;
    if (got == null || Math.abs(got - rs * 100) > 1e-7 * Math.max(1, Math.abs(rs * 100))) fail('IRR: ' + T.toFixed(2) + '년 · 시작 ' + ini + ' · 매달 ' + mon + ' · 답 ' + (rs * 100).toFixed(6) + '% → ' + got);
  }
  // ② 무작위 화면 조건 — 엔진 기록의 '넣은 돈 누계' = 시작 금액 + 연평균 계산에 쓰는 적립 흐름의 그날까지 합
  const Q = M.DS.q, days = M.DS.days;
  for (let k = 0; k < 60; k++) {
    const e = 1 + Math.floor(rnd() * (Q.length - 6)), x = Math.min(Q.length - 1, e + 1 + Math.floor(rnd() * (k % 3 === 0 ? 12 : 200)));
    let ed = '', xd = '';
    if (k % 4 === 1) {   // 정확한 날짜(분기 중간)
      const a = M.DS.idx.get(Q[e - 1][0]), b = M.DS.idx.get(Q[x][0]);
      if (b - a > 40) { ed = days[a + 1 + Math.floor(rnd() * 20)].date; xd = days[b - 1 - Math.floor(rnd() * 20)].date; }
    }
    const per = pick(['quarterly', 'quarterly', 'monthly', 'weekly', 'yearly']);
    S.saved = [
      { id: 'n', type: '9sig', params: M.ssCleanParams('9sig', Object.assign(M.ssDefaults('9sig'), { per, rp: pick(['0', '0', '50']), dep: pick(['0', '50']), park: pick(['cash', 'qqq']) })) },
      { id: 's', type: 'sma', params: M.ssCleanParams('sma', Object.assign(M.ssDefaults('sma'), { sig: pick(['qqq', 'spy']), win: pick(['100', '200']), din: pick(['0', '5']) })) },
      { id: 'b', type: 'bh', params: M.ssCleanParams('bh', { ul: pick(['tqqq', 'spy', 'qld']) }) },
      { id: 'v', type: 'invested', params: M.ssCleanParams('invested', { r: pick(['0', '300', '600']) }) },
    ].map((c) => Object.assign(c, { name: c.id, color: '#ffffff', hidden: false }));
    const mon = pick([0, 100, 500, 1000, 2500]);
    S.e = e; S.x = x; S.iPos = pick([0, 200, 333, 600]); S.mPos = M.ssMonthlyToPos(mon); S.raise = pick(['0', '3', '10']); S.ed = ed; S.xd = xd; S.editing = null; S.panel = null; S.infl = false; S.log = false; S.tx = null;
    if (S.iPos === 0 && mon === 0) S.iPos = 333;
    M.ssRender();
    const R = M.R, c = R.ctx;
    if (!R.labels.length) continue;
    const sumTo = (d0, d1, daily) => { let s = 0; for (const f of M.ssFlows(c.initial, c.monthly, c.raise, d0, d1, null, daily)) if (f.t > 0) s -= f.cf; return c.initial + s; };
    for (const id of ['n', 's', 'b', 'v']) {
      const sim = R.cfgSim[id], log = sim && sim.log;
      if (!log || !log.length) continue;
      const daily = id === 's', d0 = daily ? c.entryDate : log[0].date;
      let bad1 = null;
      for (const r of log) { if (r.invested == null) continue; const want = r.invested, got = sumTo(d0, r.date, daily); if (Math.abs(got - want) > 1e-6 * Math.max(1, Math.abs(want))) { bad1 = r.date + ' 엔진 ' + want.toFixed(2) + ' · 흐름 ' + got.toFixed(2); break; } }
      n++;
      if (bad1) fail('적립 흐름 ≠ 엔진 (' + id + ' ' + per + ' ' + Q[e][0] + '~' + Q[x][0] + (ed ? ' 정확한 날짜 ' + ed + '~' + xd : '') + '): ' + bad1);
    }
    // 사용자 코드 전략이 받는 적립(달이 바뀐 첫 거래일) = daily 흐름
    const co = M.ssContribObj(c.monthly, c.raise, c.entryDate, c.exitDate, null), fl = M.ssFlows(c.initial, c.monthly, c.raise, c.entryDate, c.exitDate, null, true).filter((f) => f.t > 0);
    const t0 = Date.parse(c.entryDate + 'T00:00:00Z'), ks = Object.keys(co).sort();
    n++;
    if (ks.length !== fl.length || ks.some((d, i) => Math.abs((Date.parse(d + 'T00:00:00Z') - t0) / M.SS_YEAR_MS - fl[i].t) > 1e-12 || Math.abs(co[d] + fl[i].cf) > 1e-9)) fail('코드 전략 적립(contributions)이 daily 흐름과 다름 ' + c.entryDate + '~' + c.exitDate);
    // ③ SMA 끝 값 = 엔진의 청산일 값
    const sl = R.cfgSim.s && R.cfgSim.s.log, ms = R.metrics['cfg:s'];
    if (sl && sl.length && ms) { n++; const lt = sl[sl.length - 1]; if (Math.abs(ms.end - lt.total) > 1e-6 * Math.max(1, lt.total)) fail('SMA 끝 값 ' + ms.end + ' ≠ 청산일(' + lt.date + ') 값 ' + lt.total + (xd ? ' · 청산 ' + xd : '')); }
  }
  // ④ 1953년~최신, 시작 $10K + 매달 $1,000: 그냥 보유 연평균 = 흐름을 따로 풀어 구한 값 (예전: 풀지 못해 대략식 ≈ 8%)
  S.saved = []; S.e = 1; S.x = Q.length - 1; S.iPos = M.ssInitialToPos(10000); S.mPos = M.ssMonthlyToPos(1000); S.raise = '0'; S.ed = ''; S.xd = ''; S.tx = null;
  M.ssRender();
  {
    const c = M.R.ctx, fv = M.R.base.bh.tqqq[M.R.base.bh.tqqq.length - 1].value, fl = M.ssFlows(c.initial, c.monthly, c.raise, c.d0, c.d1, null).concat([{ t: c.years, cf: fv }]);
    let lo = -0.5, hi = 2;
    const g = (r) => fl.reduce((s, f) => s + f.cf * Math.exp(Math.log1p(r) * (c.years - f.t)), 0);
    for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) > 0) lo = mid; else hi = mid; }
    const want = (lo + hi) / 2 * 100, got = M.R.metrics.bh.cagr;
    n++;
    if (!(c.years > 70) || Math.abs(got - want) > 1e-6) fail('1953~최신 그냥 보유 연평균 ' + got + ' ≠ 따로 푼 값 ' + want + ' (' + c.years.toFixed(1) + '년)');
  }
}
console.log('stratsim_test: 검사 ' + n + '개 · 실패 ' + bad + '개');
process.exit(bad ? 1 : 0);
