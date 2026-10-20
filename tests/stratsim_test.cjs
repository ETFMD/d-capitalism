#!/usr/bin/env node
/* [STRATSIM] 투자전략 시뮬레이터 계산 회귀 검사 — node tests/stratsim_test.cjs
   · 화면 계산 코드(src/stratsim/*.js)를 그대로 불러와(scripts/stratsim_fit.cjs 와 같은 방법) 고정 구간 5가지의 기준값과 대조
     (기준값 = 원본 Strategies Simulator 와 무작위 3,800번·화면 12가지 대조를 마친 엔진으로 2026-10-20 에 계산 — 구간이 고정이라 새 자료가 붙어도 그대로)
   · 과최적화 탐색기 자료(data/stratsim/fit-*.json): 탭·행 수가 후보와 같고, 무작위 행의 맞춘 구간 지표를 다시 계산하면 저장된 값과 같음
   실패하면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const path = require('path'), fs = require('fs');
const F = require(path.join(__dirname, '..', 'scripts', 'stratsim_fit.cjs'));
const M = F.M, S = M.S;
const GOLD = [
  {"name":"기본 2010–2025 · 전략 없음","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.2731878649,81.6150703134,6162492.04356,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null]}},
  {"name":"9sig·SMA 기본","e":228,"x":291,"i":333,"m":500,"a":"0","cfgs":[["9sig",{}],["sma",{}]],"labels":[65,"2009-12-31","2025-12-31"],"met":{"bh":[40.2731878649,81.6150703134,6162492.04356,"2021-11-19","2022-12-28"],"invested":[4.07280249347,0,153114.16388,null,null],"g0":[39.0547580275,59.66735114,5448549.33593,"2021-11-19","2022-12-28"],"g1":[45.1094642219,46.2811945542,9990216.92722,"2018-08-29","2019-08-05"]}},
  {"name":"거치식 $100K 2000–2020","e":188,"x":271,"i":500,"m":0,"a":"0","cfgs":[["9sig",{}],["sma",{}],["9sig",{"per":"monthly","g":"3"}]],"labels":[253,"1999-12-31","2020-12-31"],"met":{"bh":[-9.21103178578,99.9823378436,13140.3979103,"2000-03-27","2009-03-09"],"invested":[4.07374795303,0,231313.351046,null,null],"g0":[-7.40838272748,99.9552507683,19858.0420443,"2000-03-27","2009-03-09"],"g1":[14.4836791711,78.9873796806,1712914.79269,"2000-04-03","2003-04-09"],"g2":[-8.19129104088,99.9581791471,16614.4233182,"2000-03-27","2009-03-09"]}},
  {"name":"적립 $1000 +5% 1990–2015","e":148,"x":251,"i":333,"m":1000,"a":"5","cfgs":[["9sig",{"park":"qqq","dep":"50","rp":"50"}],["sma",{"sig":"spy","win":"100","eb":"2","xb":"2","cb":"3","cs":"3","settle":"2","oh":"70","cool":"50","out":"qqq","din":"5","dout":"10","bg":"0"}]],"labels":[105,"1989-12-29","2015-12-31"],"met":{"bh":[11.4427582318,99.9364556645,2875775.77533,"2000-03-27","2002-09-23"],"invested":[4.07341312015,0,1041994.61333,null,null],"g0":[11.8893433984,99.1114675088,3076467.31677,"2000-03-27","2002-10-07"],"g1":[13.5965722437,87.5237503647,4001125.07494,"2000-03-27","2008-11-20"]}},
  {"name":"1953–1999 · 매년·매주","e":1,"x":187,"i":300,"m":100,"a":"0","cfgs":[["9sig",{"per":"yearly","g":"30","cash":"30","bp":"100","tc":"target"}],["9sig",{"per":"weekly","g":"1","ul":"qld","cost":"0.1"}],["bh",{"ul":"spy"}],["invested",{"r":"300"}]],"labels":[2441,"1953-03-27","1999-12-31"],"met":{"bh":[20.7871139834,96.6186281433,86119176.9562,"1972-04-12","1974-10-03"],"invested":[4.07389214888,0,204793.870698,null,null],"g0":[20.6498710649,96.6349994763,82472483.8721,"1972-04-12","1974-10-03"],"g1":[16.5206728991,87.1364862715,18035088.7931,"1972-04-12","1974-10-03"],"g2":[9.95326440085,46.5624985366,1590456.66504,"1973-01-11","1974-10-03"],"g3":[9.36787778518,0,1285249.89721,null,null]}}
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
console.log('stratsim_test: 검사 ' + n + '개 · 실패 ' + bad + '개');
process.exit(bad ? 1 : 0);
