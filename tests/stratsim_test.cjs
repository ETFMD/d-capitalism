#!/usr/bin/env node
/* [STRATSIM] 투자전략 시뮬레이터 계산 회귀 검사 — node tests/stratsim_test.cjs
   · 화면 계산 코드(src/stratsim/*.js)를 그대로 불러와(scripts/stratsim_fit.cjs 와 같은 방법) 고정 구간 5가지의 기준값과 대조
     (기준값 = 원본 Strategies Simulator 와 무작위 3,800번·화면 12가지 대조를 마친 엔진으로 2026-10-20 에 계산 — 구간이 고정이라 새 자료가 붙어도 그대로.
      2026-10-21: 원본도 틀리던 것을 고쳐 다시 계산 — 연평균: 적립을 월말이 아니라 엔진이 실제로 산 날(달이 바뀐 첫 거래일 —
      9sig·그냥 보유·SMA 모두, 현금 복리만 달마다 이자 뒤 더하므로 월말) · 끝 값이 나온 점 날짜 · 주 단위 화면의 진입 전 적립 /
      끝 금액: 리밸런스 시점을 옮긴 9sig 의 마지막 행이 달 중간이면 그달 이미 들어온 적립도 넣음(예전엔 빠짐). 낙폭은 그대로 /
      2026-10-21: 상장 전 구간을 사이트의 다른 백테스트와 같은 재현 식(data/stratsim/prelist.csv · scripts/stratsim_prelist.py)으로 바꿔 다시 계산 —
      엔진은 그대로, 자료만 바뀜. 이때부터 기준값은 고정 자료 tests/fixtures/stratsim-prices-2026-10-21.csv.gz 로 계산
      (상장 전 구간이 재현 식 갱신으로 바뀌거나 야후가 지난 값을 고쳐도 기준값은 그대로 — 엔진이 바뀌었을 때만 실패))
   · 연평균(돈 가중 CAGR): 답을 아는 흐름으로 IRR(50년 넘는 기간 포함) · 적립 흐름 = 엔진이 실제로 넣은 돈(무작위 화면 조건 60가지 —
     행마다 넣은 돈 누계 + 그냥 보유 주수로 돈의 날짜·가격까지) · 실제 거래내역의 달 중간 마지막 행 · 정확한 청산일의 SMA 끝 값 ·
     시각이 붙은 날짜 · 아주 작은 값의 IRR 부호 · 자료 첫해~최신(50년 넘음) 적립식 연평균
   · 과최적화 탐색기 자료(data/stratsim/fit-*.json): 탭·행 수가 후보와 같고, 무작위 행의 맞춘 구간 지표를 다시 계산하면 저장된 값과 같음
   · 전략 라이브러리 코드 전략(2026-10-21 고친 것): 어느 날 들어온 돈도 사라지지 않음(특히 파는 날) · #1 Faber 는 달의 마지막
     거래일에만 판단(주 단위 화면에서도 같은 거래) · #18 은 주의 마지막 거래일에만 · #26 중심선 = 마지막 W 거래일로 직접 계산한 값
   실패하면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const path = require('path'), fs = require('fs');
const F = require(path.join(__dirname, '..', 'scripts', 'stratsim_fit.cjs'));
const M = F.M, S = M.S;
// 기준값은 고정 자료(tests/fixtures — 2026-10-21 의 data/stratsim/prices.csv)로 계산: 상장 전 구간이 재현 식 갱신으로 조금씩 바뀌거나
// 야후가 지난 값을 고쳐도 엔진(화면 계산 코드)이 그대로면 같은 숫자가 나와야 함 (탐색기 자료 검사·나머지 검사는 지금 자료로)
const MG = F.loadEngine(require('zlib').gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'stratsim-prices-2026-10-21.csv.gz'))).toString('utf8')), SG = MG.S;
const GOLD = [
  {"name":"기본 2010–2025 · 전략 없음","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.1201215621,81.6151278303,6170336.94583,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null]}},
  {"name":"9sig·SMA 기본","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[["9sig",{}],["sma",{}]],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.1201215621,81.6151278303,6170336.94583,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null],"g0":[38.8929343333,59.6666174775,5448728.44246,"2021-11-19","2022-12-28"],"g1":[44.8592252037,46.2753711365,9920177.74862,"2018-08-29","2019-08-05"]}},
  {"name":"거치식 $100K 2000–2020","e":188,"x":271,"i":500,"m":0,"a":"0","cfgs":[["9sig",{}],["sma",{}],["9sig",{"per":"monthly","g":"3"}]],"labels":[253,"1999-12-31","2020-12-31"],"met":{"bh":[-8.43487329168,99.9790131127,15712.7981753,"2000-03-27","2009-03-09"],"invested":[4.07374795299,0,231313.351046,null,null],"g0":[-6.72541239078,99.9482022111,23172.2391388,"2000-03-27","2009-03-09"],"g1":[13.634273148,79.4460576392,1464907.11344,"2000-04-03","2003-03-31"],"g2":[-7.69328407717,99.9531816085,18613.4942624,"2000-03-27","2009-03-09"]}},
  {"name":"적립 $1000 +5% 1990–2015","e":148,"x":251,"i":333,"m":1000,"a":"5","cfgs":[["9sig",{"park":"qqq","dep":"50","rp":"50"}],["sma",{"sig":"spy","win":"100","eb":"2","xb":"2","cb":"3","cs":"3","settle":"2","oh":"70","cool":"50","out":"qqq","din":"5","dout":"10","bg":"0"}]],"labels":[105,"1989-12-29","2015-12-31"],"met":{"bh":[11.7395656475,99.9324687531,3031945.82709,"2000-03-27","2002-10-09"],"invested":[4.07341312019,0,1041994.61333,null,null],"g0":[12.5435577811,99.0430457009,3371284.64729,"2000-03-27","2002-10-09"],"g1":[14.1941817143,87.6109355113,4436305.389,"2000-02-24","2008-11-20"]}},
  {"name":"1953–1999 · 매년·매주","e":1,"x":187,"i":300,"m":100,"a":"0","cfgs":[["9sig",{"per":"yearly","g":"30","cash":"30","bp":"100","tc":"target"}],["9sig",{"per":"weekly","g":"1","ul":"qld","cost":"0.1"}],["bh",{"ul":"spy"}],["invested",{"r":"300"}]],"labels":[2441,"1953-03-27","1999-12-31"],"met":{"bh":[24.0581983668,95.6988393952,283834758.536,"1972-04-18","1974-10-03"],"invested":[4.07389214884,0,204793.870698,null,null],"g0":[23.2484085012,95.7086903361,212034368.972,"1972-04-18","1974-10-03"],"g1":[18.0530197377,86.2257551257,32055483.522,"1973-01-11","1974-10-03"],"g2":[12.8450801671,43.9598827551,4615381.63529,"1973-01-11","1974-10-03"],"g3":[9.38018658215,0,1285249.89721,null,null]}}
];
let n = 0, bad = 0;
const fail = (m) => { bad++; console.log('FAIL ' + m); };
const close = (a, b, tol) => (a == null || b == null ? a === b : Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)));
for (const g of GOLD) {
  SG.saved = g.cfgs.map(([t, p], k) => ({ id: 'g' + k, type: t, name: t + k, params: MG.ssCleanParams(t, Object.assign(MG.ssDefaults(t), p)), color: '#ffffff', hidden: false }));
  SG.e = g.e; SG.x = g.x; SG.iPos = g.i; SG.mPos = MG.ssMonthlyToPos(g.m); SG.raise = g.a; SG.ed = ''; SG.xd = ''; SG.editing = null; SG.panel = null; SG.infl = false; SG.log = false; SG.tx = null;
  MG.ssRender();
  const R = MG.R;
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
// ③ 정확한 청산일(분기 중간)의 SMA 끝 값 = 그날 값 ④ 자료 첫해~최신(50년 넘음) 적립식 연평균이 따로 푼 값과 같음
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
    const flowsTo = (d0, d1, mode, fin) => M.ssFlows(c.initial, c.monthly, c.raise, d0, d1, null, mode, fin);
    const sumTo = (d0, d1, mode, fin) => { let s = 0; for (const f of flowsTo(d0, d1, mode, fin)) if (f.t > 0) s -= f.cf; return c.initial + s; };
    for (const id of ['n', 's', 'b', 'v']) {
      const sim = R.cfgSim[id], log = sim && sim.log;
      if (!log || !log.length) continue;
      const mode = id === 's' ? 'day' : id === 'v' ? 'r9base' : 'r9', d0 = mode === 'day' ? c.entryDate : log[0].date;
      let bad1 = null;
      log.forEach((r, i) => { if (bad1 || r.invested == null) return; const want = r.invested, got = sumTo(d0, r.date, mode, i === log.length - 1); if (Math.abs(got - want) > 1e-6 * Math.max(1, Math.abs(want))) bad1 = r.date + ' 엔진 ' + want.toFixed(2) + ' · 흐름 ' + got.toFixed(2); });
      n++;
      if (bad1) fail('적립 흐름 ≠ 엔진 (' + id + ' ' + per + ' ' + Q[e][0] + '~' + Q[x][0] + (ed ? ' 정확한 날짜 ' + ed + '~' + xd : '') + '): ' + bad1);
    }
    // 돈의 날짜까지: 그냥 보유는 적립 날짜의 가격으로 삼 → 행마다 주수 = 시작 금액/첫날 가격 + Σ 적립/그 돈 날짜의 가격 ('r9' 흐름의 날짜로)
    { const bs = R.cfgSim.b, key = M.SS_COL[S.saved[2].params.ul] ? S.saved[2].params.ul : 'tqqq', pts = bs && bs.bh && bs.bh[key];
      if (pts && pts.length) {
        const pxOf = (d) => M.DS.days[M.DS.idx.get(d)][key];
        let bad2 = null;
        pts.forEach((pt, i) => { if (bad2) return; let sh = 0; for (const f of flowsTo(pts[0].date, pt.date, 'r9', i === pts.length - 1)) { const p0 = pxOf(f.d); if (p0 > 0) sh += -f.cf / p0; } if (Math.abs(sh - pt.shares) > 1e-9 * Math.max(1, pt.shares)) bad2 = pt.date + ' 주수 ' + pt.shares + ' ≠ ' + sh; });
        n++;
        if (bad2) fail('그냥 보유 적립 날짜·가격 ≠ r9 흐름 (' + key + ' ' + per + (ed ? ' ' + ed + '~' + xd : '') + '): ' + bad2);
      } }
    // 사용자 코드 전략이 받는 적립(달이 바뀐 첫 거래일) = daily 흐름
    const co = M.ssContribObj(c.monthly, c.raise, c.entryDate, c.exitDate, null), fl = M.ssFlows(c.initial, c.monthly, c.raise, c.entryDate, c.exitDate, null, true).filter((f) => f.t > 0);
    const t0 = Date.parse(c.entryDate + 'T00:00:00Z'), ks = Object.keys(co).sort();
    n++;
    if (ks.length !== fl.length || ks.some((d, i) => Math.abs((Date.parse(d + 'T00:00:00Z') - t0) / M.SS_YEAR_MS - fl[i].t) > 1e-12 || Math.abs(co[d] + fl[i].cf) > 1e-9)) fail('코드 전략 적립(contributions)이 daily 흐름과 다름 ' + c.entryDate + '~' + c.exitDate);
    // ③ SMA 끝 값 = 엔진의 청산일 값
    const sl = R.cfgSim.s && R.cfgSim.s.log, ms = R.metrics['cfg:s'];
    if (sl && sl.length && ms) { n++; const lt = sl[sl.length - 1]; if (Math.abs(ms.end - lt.total) > 1e-6 * Math.max(1, lt.total)) fail('SMA 끝 값 ' + ms.end + ' ≠ 청산일(' + lt.date + ') 값 ' + lt.total + (xd ? ' · 청산 ' + xd : '')); }
  }
  // ⑤ 실제 거래내역 + 마지막 행이 달 중간(정확한 청산일 · 주 단위 · 리밸런스 시점 옮김): 그 날까지의 입금이 엔진에 모두 들어감
  //    (예전엔 그달 월말 행이 청산일 뒤라 입금이 빠졌는데 연평균은 셈) — 9sig 넣은 돈 누계 · 그냥 보유 끝 값을 직접 계산과 대조
  for (let k = 0; k < 40; k++) {
    const a = M.DS.idx.get(Q[1 + Math.floor(rnd() * (Q.length - 30))][0]), b = Math.min(days.length - 2, a + 60 + Math.floor(rnd() * 900));
    const d0 = days[a].date, d1 = days[b].date, list = [];
    for (let i = a + 1; i <= Math.min(days.length - 1, b + 40); i++) if (rnd() < 0.06) list.push({ date: days[i].date, amount: Math.round(100 + rnd() * 5000) * (rnd() < 0.1 ? -0.3 : 1) });
    const sch = { byDate: new Map(), byMonth: new Map(), list: list.slice(), priceDateByMonth: new Map() };
    for (const r of list) { sch.byDate.set(r.date, (sch.byDate.get(r.date) || 0) + r.amount); sch.byMonth.set(r.date.slice(0, 7), (sch.byMonth.get(r.date.slice(0, 7)) || 0) + r.amount); }
    const per = pick(['quarterly', 'weekly', 'monthly', 'yearly']), mode = pick(['exact', 'shift', 'plain']);
    let rows = null;
    if (mode === 'exact') rows = M.ssExactRows(per, d0, d1);
    if (mode === 'shift') rows = M.ssShiftRows(per, 5 + Math.floor(rnd() * 40), d0, d1);
    if (rows && rows.length < 2) rows = null;
    const qi0 = Q.findIndex((r) => r[0] >= d0), qi1 = Math.max(qi0 + 1, Q.findIndex((r) => r[0] >= d1));
    const o = Object.assign({ initial: 10000, monthly: 0, raise: 0, rate: 0.04, qi0, qi1, period: per, rows, sched: sch }, mode === 'plain' ? {} : { ed: d0, xd: d1 }, M.ssOpts9(M.ssDefaults('9sig')));
    if (mode === 'plain') { o.qi0 = Math.max(0, qi0 - 1); }
    const r = M.ssRun9(o);
    if (!r.log.length) continue;
    const s0 = r.log[0].date, sL = r.log[r.log.length - 1].date;
    let want = 10000;
    const seen = new Set();
    for (const x of list) if (x.date > s0 && x.date <= sL && !seen.has(x.date)) { seen.add(x.date); want += sch.byDate.get(x.date); }
    const last = r.log[r.log.length - 1];
    n++;
    if (Math.abs(last.invested - want) > 1e-6 * Math.max(1, want)) fail('거래내역 9sig(' + per + ' ' + mode + ' ' + s0 + '~' + sL + '): 넣은 돈 ' + last.invested + ' ≠ 그날까지 입금 ' + want);
    // 그냥 보유 TQQQ: 시작에 전부 사고 입금일마다 그날 가격으로 삼 → 끝 값 = 주수 × 끝날 가격
    const bh = r.bh.tqqq, px = (d) => days[M.DS.idx.get(d)].tqqq;
    let sh = 10000 / px(s0);
    for (const d of seen) sh += sch.byDate.get(d) / px(d);
    const bv = bh[bh.length - 1].value, bw = sh * px(bh[bh.length - 1].date);
    n++;
    if (Math.abs(bv - bw) > 1e-6 * Math.max(1, bw)) fail('거래내역 그냥 보유(' + per + ' ' + mode + '): 끝 값 ' + bv + ' ≠ 직접 계산 ' + bw);
  }
  // ⑥ 사용자 코드가 시각이 붙은 날짜로 기록해도 적립 흐름이 같음 · ⑦ 아주 작은 값(−99.8%/년, 60년)도 IRR 부호를 바르게
  {
    const d0 = '1999-12-31', d1 = '2014-12-31', f1 = M.ssFlows(10000, 1000, 0.05, d0, d1, null, true), f2 = M.ssFlows(10000, 1000, 0.05, d0, d1 + 'T00:00:00.000Z', null, true);
    n++;
    if (f1.length !== f2.length || f1.length < 170) fail('시각이 붙은 날짜의 daily 흐름 ' + f2.length + ' ≠ ' + f1.length);
    const rs = -0.9982, T = 60, got = M.ssIrr([{ t: 0, cf: -100 }, { t: T, cf: 100 * Math.pow(1 + rs, T) }]);
    n++;
    if (got == null || Math.abs(got - rs * 100) > 1e-6) fail('아주 작은 값 IRR ' + got + ' ≠ ' + rs * 100);
  }
  // ④ 자료 첫해(1971 · 2026-10-21 전엔 1953)~최신, 시작 $10K + 매달 $1,000: 그냥 보유 연평균 = 흐름을 따로 풀어 구한 값 (예전: 50년 넘는 기간을 풀지 못해 대략식 ≈ 8%)
  S.saved = []; S.e = 1; S.x = Q.length - 1; S.iPos = M.ssInitialToPos(10000); S.mPos = M.ssMonthlyToPos(1000); S.raise = '0'; S.ed = ''; S.xd = ''; S.tx = null;
  M.ssRender();
  {
    const c = M.R.ctx, fv = M.R.base.bh.tqqq[M.R.base.bh.tqqq.length - 1].value, fl = M.ssFlows(c.initial, c.monthly, c.raise, c.d0, c.d1, null).concat([{ t: c.years, cf: fv }]);
    let lo = -0.5, hi = 2;
    const g = (r) => fl.reduce((s, f) => s + f.cf * Math.exp(Math.log1p(r) * (c.years - f.t)), 0);
    for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; if (g(lo) * g(mid) > 0) lo = mid; else hi = mid; }
    const want = (lo + hi) / 2 * 100, got = M.R.metrics.bh.cagr;
    n++;
    if (!(c.years > 50) || Math.abs(got - want) > 1e-6) fail('자료 첫해~최신 그냥 보유 연평균 ' + got + ' ≠ 따로 푼 값 ' + want + ' (' + c.years.toFixed(1) + '년)');
  }
}
console.log('stratsim_test: 검사 ' + n + '개 · 실패 ' + bad + '개');
process.exit(bad ? 1 : 0);
