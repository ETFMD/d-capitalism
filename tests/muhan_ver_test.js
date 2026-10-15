/* 무한매수법 버전별 엔진(MHV) 검사 — node tests/muhan_ver_test.js  (run_regression.py 가 자동 실행)
   · src/index.html 의 [MUHAN-ENGINE](MHE) · [MUHAN-VER](MHV) 를 그대로 꺼내 씀 (브라우저와 같은 코드)
   · 라오어 공식 카페 원문 숫자: 주문표 예시 · 별% 공식 · 반복리 · LABU 2021 사례 · TQQQ 해마다 소진 횟수(2010~2021)
   · V4.0 = 기록 화면 엔진(MHE.backtest)과 날마다 같은 평가금 · 기록 화면 다시 계산(replay) = 백테스트 상태 · 무작위 불변식 · 양도소득세 계산
   · 가격 단위(상장 전 재현·액면 병합) · 양도세 현금 부족 · V3 반복리 완충 바닥 · 작은 원금(1회 < 1주) · 세금 포함 불변식
   · ⑱ 증권사 주문 거부(o.rej — 한도 = 시가 × 1.2 · 한도로 낮춰 넣기 / 그날 건너뛰기)
   · ⑲ 주문 넣는 때(o.fill — 'open' 정규장 시작 전: 갭 상승이면 시가 · 'pre' 프리장 시작: 전날 종가가 이미 넘으면 전날 종가, 주문 거부 기준 전날 종가)
   실패가 있으면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
function grab(name, endMark) { const a = src.indexOf('var ' + name + ' = (function'), b = src.indexOf(endMark, a); if (a < 0 || b < 0) throw new Error(name + ' 없음'); return src.slice(a, b); }
const MHE = new Function(grab('MHE', "if (typeof module !== 'undefined') module.exports = MHE;") + '\nreturn MHE;')();
const MHV = new Function('MHE', grab('MHV', "if (typeof module !== 'undefined') module.exports = MHV;") + '\nreturn MHV;')(MHE);
const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'etfcagr.json'), 'utf8'));
function series(tk) {
  const s = J.series[tk], n = s.c.length, d = [], idx = {}; let x = s.d0;
  for (let i = 0; i < n; i++) { if (i) x += s.dd[i - 1]; d.push(new Date(x * 864e5).toISOString().slice(0, 10)); idx[x] = i; }
  const dv = new Array(n).fill(0); (s.div || []).forEach(e => { if (idx[e[0]] != null) dv[idx[e[0]]] += e[1]; });
  return { d, c: s.c, h: s.h ? s.h.map((v, k) => Math.max(v, s.c[k])) : null, dv };
}
let ok = 0, bad = 0;
function check(name, cond, info) { if (cond) ok++; else { bad++; console.log('FAIL ' + name + (info ? ' — ' + info : '')); } }
function eq(name, got, want) { const g = JSON.stringify(got), w = JSON.stringify(want); check(name, g === w, 'got ' + g + ' want ' + w); }
const TQ = series('TQQQ'), SX = series('SOXL');

/* ① 원문 주문표·공식 예시 */
function st(cfg, o) { const s = MHV.init(cfg, o.cash); Object.assign(s, o); s.mode = s.mode || 'normal'; return s; }
const rows = P => P.rows.map(r => [r.side, r.m, r.p, r.q]);
{ const cfg = MHV.defaults('2.1', 'TQQQ'), s = st(cfg, { cash: 40000 - 25 * 39.86, qty: 25, avg: 39.86, one: 1000 }), P = MHV.plan(cfg, s, { prev: 39.86 });   /* V2.1 1회차 영상 해설 2022-03-15 */
  eq('V2.1 매수표', rows(P).filter(r => r[0] === 'B'), [['B','LOC',41.85,11],['B','LOC',39.86,14],['B','LOC',38.46,1],['B','LOC',37.04,1],['B','LOC',35.71,1],['B','LOC',34.48,1],['B','LOC',33.33,1],['B','LOC',32.26,1],['B','LOC',31.25,1],['B','LOC',30.3,1]]);
  eq('V2.1 매도표', rows(P).filter(r => r[0] === 'S'), [['S','LOC',41.85,6],['S','LMT',43.85,19]]); }
{ const cfg = MHV.defaults('2.1', 'SOXL'), s = st(cfg, { cash: 10000, qty: 200, avg: 50, one: 200 * 50 / 30 });   /* V2.1 후반전 매도 2021-11-13 */
  eq('V2.1 후반 매도', rows(MHV.plan(cfg, s, { prev: 49 })).filter(r => r[0] === 'S'), [['S','LMT',55,100],['S','LMT',52.5,50],['S','LOC',50,50]]);
  const s2 = st(cfg, { cash: 10000, qty: 100, avg: 50, one: 100 * 50 / 15 });
  eq('V2.1 전반 매도', rows(MHV.plan(cfg, s2, { prev: 50 })).filter(r => r[0] === 'S'), [['S','LOC',52.5,25],['S','LMT',55,75]]); }
{ const cfg = Object.assign(MHV.defaults('2.2', 'TQQQ'), { splits: 39.2, lines: 5, tround: 'c1' }), s = st(cfg, { cash: 30000, qty: 383, avg: 38.365, one: 1000 });   /* V2.2 오피셜 2023-05-19 */
  const P = MHV.plan(cfg, s, { prev: 38.5 });
  eq('V2.2 T·별%·별지점', [P.T, Math.round(P.sp * 100) / 100, P.star], [14.7, 2.5, 39.32]);
  eq('V2.2 매수표', rows(P).filter(r => r[0] === 'B').slice(0, 6), [['B','LOC',39.31,12],['B','LOC',38.37,14],['B','LOC',37.03,1],['B','LOC',35.71,1],['B','LOC',34.48,1],['B','LOC',33.33,1]]);
  eq('V2.2 매도표', rows(P).filter(r => r[0] === 'S'), [['S','LOC',39.32,95],['S','LMT',42.2,288]]); }
{ const c = MHV.defaults('2.2', 'SOXL'), t = MHV.defaults('2.2', 'TQQQ');   /* SOXL V2.2 2023-07-16 · V2.2 T값 글 */
  eq('SOXL V2.2 목표 12', c.target, 12);
  eq('SOXL 별% = 12 − 0.6T', [10, 15, 25, 35, 5, 30].map(x => Math.round(MHV.starPct(c, x) * 100) / 100), [6, 3, -3, -9, 9, -6]);
  eq('35분할 별%', [Math.round(MHV.starPct(Object.assign({}, c, { splits: 35 }), 20) * 100) / 100, Math.round(MHV.starPct(Object.assign({}, t, { splits: 35 }), 20) * 100) / 100], [-1.71, -1.43]);
  eq('TQQQ 별% = 10 − T/2', [6, 13, 21, 38].map(x => MHV.starPct(t, x)), [7, 3.5, -0.5, -9]); }
{ const a = MHV.defaults('3.0', 'TQQQ'), b = MHV.defaults('3.0', 'SOXL');   /* V3.0 2024-06-13 */
  eq('V3 기본값', [a.splits, a.target, b.target], [20, 15, 20]);
  eq('V3 별% TQQQ·SOXL', [[0, 4, 10, 19].map(x => MHV.starPct(a, x)), [0, 4, 10, 19].map(x => MHV.starPct(b, x))], [[15, 9, 0, -13.5], [20, 12, 0, -18]]);
  const s = MHV.init(a, 20000); const o1 = MHV.oneOf(a, s); s.cum = 200; s.maxCum = 200; const o2 = MHV.oneOf(a, s); s.cum = 100; const o3 = MHV.oneOf(a, s);
  eq('V3 반복리 (원금÷20 + 최대 누적수익÷40)', [o1, o2, o3], [1000, 1005, 1005]); }
{ const cfg = MHV.defaults('2.0', 'FNGU'), s = st(cfg, { cash: 9000, qty: 10, avg: 24, one: 250 });   /* V2.0 원문 예시 */
  eq('V2.0 예시1 (1회 ÷ 현재가 = 9주)', rows(MHV.plan(cfg, s, { prev: 26 })).filter(r => r[0] === 'B').reduce((x, r) => x + r[3], 0), 9);
  eq('V2.0 예시2 (평단이 높으면 큰수에 1회 전부)', rows(MHV.plan(cfg, st(cfg, { cash: 9000, qty: 10, avg: 30, one: 250 }), { prev: 20 })).filter(r => r[0] === 'B'), [['B','LOC',23,12]]);
  eq('V2.0 큰수 상한 평단 +5%', MHV.plan(cfg, st(cfg, { cash: 9000, qty: 10, avg: 30, one: 250 }), { prev: 30 }).rows.filter(r => r.tag === 'big')[0].p, 31.5); }

/* ② 라오어 「V2.1 백테스트 분석 및 소고」(2021-11-15) LABU 2021 사례 — 원문 백테스트 방식(정액·단리) */
const LABU = { d0: '2021-01-04', dd: [1,1,1,1,3,1,1,1,1,4,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,4,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,4,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,4,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,4,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1],
  c: [100.36,100.17,105.87,118.85,119.51,116.09,118.56,117.25,128.22,124.38,130.38,130.54,121.88,126.23,137.18,130.22,125.05,123.17,126.17,143.07,151.86,146.99,150.67,162.5,183.21,176.51,165.15,158.28,153.63,141.82,143.73,132,139,126.35,118.19,123.8,108.33,110.44,118.89,107.43,92.42,83.63,89.5,81.89,93.77,93.83,105.07,103.67,107.22,102.3,105.91,90.68,99.09,103.62,85.77,72.47,78.78,75.12,68.5,69.95,78.92,81.14,83.97,77.21,71.86,73.29,68.63,64.21,67,72.12,74.5,70.8,66.3,65.92,72.58,75.14,74.83,83.16,83.27,84.34,81.12,78.75,75.92,66.81,63.51,61.17,63.72,56.81,59.63,58.18,55.68,61.83,61.21,62.25,58.84,62.38,61.3,59.94,57.89,61.42,63.63,63,60.94,61.84,60.94,61.3,69.4,70.89,72.78,74.9,74.59,76.2,70.69,70.8,72.07,70.47,72.78,70.69,71.7,76.59,78.84,77.94,74.14,73.65,78.45,75.22,70.48,66.64,67.77,70.46,67.74,63.98,58.7,58.63,58.74,59.03,62.71,64.67,61.21,59.4,56,54.19,59.9,56.9,54.73,55.21,56.35,56.38,62.68,59.7,59.75,58.41,57.28,58.67,55.98,51.87,54.4,51.56,47.91,52,59.09,59.16,61.05,60.22,64.98,64.53,66.3],
  h: [104,101.36,110,119.16,125.741,119.398,121.29,122.5,129,134.828,132.696,136.605,132.6,127.75,137.326,141.493,140.97,133,136.194,143.96,153.09,155.94,154.02,164.06,183.435,185.61,184.55,169.96,159.78,157.06,144.41,139.49,144.84,139.45,122.87,126.88,127.23,115.83,119.88,117.89,107.245,95.07,89.5,94.87,96.36,101,105.19,104.02,107.88,109.478,107.64,103.968,99.62,106.26,101.44,88.75,78.85,79.74,74.75,72.45,79.996,85.84,85.21,84.72,77.96,75.92,73.18,68.67,67,75.59,77.2,75.78,71.718,68.398,72.619,79.49,77.65,83.528,85.89,86.12,86.148,83.25,81.25,74.09,69.099,62.996,65.686,63.02,61.3,62.75,60.8,62.75,63.1,66.59,61.24,63.74,64.64,63.04,61.72,61.61,63.9,67.8,64.09,62.78,62.098,63.08,71.42,72.87,75.19,75.6,75.88,77.73,75.89,72.24,73.58,71.66,73.52,72.94,73.08,76.89,79.14,83.82,78.6,76.53,78.48,78.716,75.997,71.45,68.635,70.8,71.78,67.28,65,59.594,61.09,61.25,62.9,64.95,64.56,62.035,60.48,56.2,60.6,61.64,57.66,57.09,56.35,59.7,62.87,62.25,61.71,61.24,58.59,59.33,59.545,55.39,54.45,55.21,51.4,52.86,59.22,59.26,62.08,63.74,66.41,67.4,67.36] };
{ const d = [LABU.d0]; let t = Date.parse(LABU.d0 + 'T00:00:00Z'); LABU.dd.forEach(x => { t += x * 864e5; d.push(new Date(t).toISOString().slice(0, 10)); });
  const S = { d, c: LABU.c, h: LABU.h, dv: null };
  const go = (ver, start) => { const cfg = Object.assign(MHV.defaults(ver, 'LABU'), { money: 'simple', ideal: true }), from = d.indexOf(start);
    const O = MHV.run(cfg, S, { from, capital: 1e7, norm: 'always', rows: true }), c1 = O.cycles[0], ex = O.rows.find(r => r.exh);
    return { exh: ex ? d[ex.i] : null, ratio: ex ? Math.round(ex.avg / S.c[from] * 1e4) / 1e4 : null, end: c1.end != null ? d[c1.end] : null, pnl: Math.round(c1.pnl / 1e7 * 1e4) / 100 }; };
  const v1 = go('1.0', '2021-02-08'), v1b = go('1.0', '2021-02-22'), v21 = go('2.1', '2021-02-22');
  eq('LABU V1.0 4/6 소진 · 평단÷첫날 0.5521 · 다음 날 매도', [v1.exh, v1.ratio, v1.end], ['2021-04-06', 0.5521, '2021-04-07']);
  check('LABU V1.0 손익 ≈ 원문 −29%', Math.abs(v1.pnl - -29) < 0.1, v1.pnl);
  check('LABU V1.0(2/22 시작) 4/23 40회 · 다음 거래일 매도 ≈ 원문 +0.7%', v1b.exh === '2021-04-23' && v1b.end === '2021-04-26' && Math.abs(v1b.pnl - 0.7) < 0.05, JSON.stringify(v1b));
  check('LABU V2.1 소진 없이 6월 초 익절 ≈ 원문 +9.5%', v21.exh == null && v21.end === '2021-06-09' && Math.abs(v21.pnl - 9.5) < 0.15, JSON.stringify(v21)); }

/* ③ 라오어 2022-12-27 표: TQQQ V2.1·V2.2 해마다 소진(쿼터손절) 횟수 2010~2021 — 원문 백테스트 방식(정액·단리·모자라면 채움) */
{ const OFF = { '2.1': [3, 0, 3, 0, 0, 2, 2, 0, 4, 2, 0, 0], '2.2': [0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0] };
  for (const ver of ['2.1', '2.2']) {
    const cfg = Object.assign(MHV.defaults(ver, 'TQQQ'), { money: 'simple', ideal: true }, ver === '2.2' ? { target: 10 } : {});
    const O = MHV.run(cfg, TQ, { from: 1, capital: 1e6, inject: true, norm: 'always', rows: true }), cnt = {};
    O.rows.forEach(r => { if (r.ql) { const y = TQ.d[r.i].slice(0, 4); cnt[y] = (cnt[y] || 0) + 1; } });
    const ys = []; for (let y = 2010; y <= 2021; y++) ys.push(cnt[y] || 0);
    eq('TQQQ V' + ver + ' 해마다 소진 횟수 2010~2021 = 원문 표', ys, OFF[ver]);
  } }

/* ④ V4.0 = 기록 화면 엔진(MHE.backtest) — 날마다 평가금 일치 */
{ let n = 0, b0 = 0;
  for (const [tk, S] of [['TQQQ', TQ], ['SOXL', SX]]) for (const sp of [20, 30, 40]) for (const bg of [5, 12]) {
    const tg = tk === 'TQQQ' ? 15 : 20, R = MHE.backtest({ ticker: tk, splits: sp, targetProfit: tg, bigNumPercent: bg, lowerLocShares: 1 }, S.c, 20000, S.h);
    const O = MHV.run(Object.assign(MHV.defaults('4.0', tk), { splits: sp, target: tg, big: bg }), { d: S.d, c: S.c, h: S.h }, { from: 1, capital: 20000, norm: 'always', rows: false });
    let mx = 0; for (let i = 1; i < S.c.length; i++) mx = Math.max(mx, Math.abs(O.eq[i - 1] - R.eq[i]) / R.eq[i]); n++; if (mx > 1e-9) { b0++; console.log('  V4 차이', tk, sp, bg, mx); } }
  check('V4.0 백테스트 = 기록 화면 엔진 (' + n + '가지 조건, 날마다 평가금)', b0 === 0, b0 + '건 다름'); }

/* ⑤ 기록 화면 다시 계산(replay, 사용자가 적은 체결) = 백테스트 하루 루프 상태 */
{ let n = 0, b0 = 0;
  for (const [tk, D] of [['TQQQ', TQ], ['SOXL', SX]]) for (const ver of ['1.0', '2.0', '2.1', '2.2', '3.0']) for (const sp of [20, 40]) for (let s0 = 40; s0 < D.c.length - 200; s0 += 331) {
    const cfg = Object.assign(MHV.defaults(ver, tk), { splits: sp }), k = 50 / D.c[s0 - 1], st0 = MHV.init(cfg, 10000); MHV.begin(cfg, st0);
    const recs = [];
    for (let i = s0; i < Math.min(D.c.length, s0 + 300); i++) {
      const bar = { c: D.c[i] * k, h: D.h[i] * k }, P = MHV.plan(cfg, st0, { prev: D.c[i - 1] * k }), f = MHV.settle(P.rows, bar, false), ev = MHV.apply(cfg, st0, P, f, bar, {});
      recs.push({ date: D.d[i], close: bar.c, fills: f.map(x => ({ side: x.side, p: x.p, q: x.q, tag: x.tag, m: x.m })) });
      if (ev.end) break;
    }
    const a = MHV.replay(cfg, { capital: 10000 }, recs).st; n++;
    if (!(Math.abs(a.qty - st0.qty) < 1e-9 && Math.abs(a.avg - st0.avg) < 1e-9 && Math.abs(a.cash - st0.cash) < 1e-6 && a.mode === st0.mode && a.T === st0.T)) { b0++; if (b0 < 4) console.log('  replay 차이', tk, ver, sp, D.d[s0]); }
  }
  check('기록 화면 다시 계산 = 백테스트 상태 (' + n + '가지)', b0 === 0, b0 + '건 다름'); }

/* ⑤b 기록 화면에 더한 백테스트 세부 규칙 — 단리(처음 원금 ≠ 지금 현금) · 정액(소수 주) · 평단 괴리율 · T 둘째 자리 올림 · V3 반복리 누적(cum0·max0) 도
       기록 화면 다시 계산(replay) = 백테스트 하루 루프 상태 (기록 화면이 백테스트와 같은 규칙으로 주문표·T값·1회 매수금을 냄) */
{ let n = 0, b0 = 0;
  for (const [tk, D] of [['TQQQ', TQ], ['SOXL', SX]]) for (const ver of ['1.0', '2.0', '2.1', '2.2', '3.0']) for (const ideal of [false, true]) for (let s0 = 60; s0 < D.c.length - 200; s0 += 523) {
    const cfg = Object.assign(MHV.defaults(ver, tk), { splits: ver === '3.0' ? 20 : 30, ideal });
    if (ver !== '3.0') cfg.money = 'simple';
    if (ver === '1.0' || ver === '2.0' || ver === '2.1') cfg.avgOff = s0 % 2 ? -1.5 : 2;
    if (ver === '2.2' || ver === '3.0') cfg.tround = 'c1';
    const x = { capital: 12000, base: 10000, cum0: ver === '3.0' ? 1500 : 0, max0: ver === '3.0' ? 2500 : 0 };
    const k = 50 / D.c[s0 - 1], st0 = MHV.init(cfg, x.capital); st0.base = x.base; st0.cum = x.cum0; st0.maxCum = x.max0; MHV.begin(cfg, st0);
    const one0 = MHV.oneOf(cfg, st0), recs = [];
    for (let i = s0; i < Math.min(D.c.length, s0 + 300); i++) {
      const bar = { c: D.c[i] * k, h: D.h[i] * k }, P = MHV.plan(cfg, st0, { prev: D.c[i - 1] * k }), f = MHV.settle(P.rows, bar, ideal), ev = MHV.apply(cfg, st0, P, f, bar, {});
      recs.push({ date: D.d[i], close: bar.c, fills: f.map(z => ({ side: z.side, p: z.p, q: z.q, tag: z.tag, m: z.m })) });
      if (ev.end) break;
    }
    const R = MHV.replay(cfg, x, recs), a = R.st; n++;
    const sameOne = ver === '3.0' ? Math.abs(one0 - (10000 / 20 + 2500 / 40)) < 1e-9 : Math.abs(one0 - 10000 / 30) < 1e-9;   /* 단리 = 처음 원금 ÷ 분할 · V3 = 원금 ÷ 20 + 최대 누적 ÷ 40 */
    if (!(sameOne && Math.abs(a.qty - st0.qty) < 1e-9 && Math.abs(a.avg - st0.avg) < 1e-9 && Math.abs(a.cash - st0.cash) < 1e-6 && a.mode === st0.mode && a.T === st0.T && Math.abs(MHV.tOf(cfg, a) - MHV.tOf(cfg, st0)) < 1e-12)) {
      b0++; if (b0 < 4) console.log('  세부 규칙 replay 차이', tk, ver, ideal, D.d[s0], one0); }
  }
  check('기록 화면 세부 규칙(단리·정액·평단 괴리율·T 올림·V3 누적) 다시 계산 = 백테스트 상태 (' + n + '가지)', b0 === 0, b0 + '건 다름'); }
/* ⑤c 새 사이클 RSI 60 이하 — 백테스트(run): 첫 사이클은 바로 · 두 번째 사이클부터 와일더 RSI(14) 가 60 이하인 날에야 첫 매수 (기록 화면 rsiGate 와 같은 규칙) */
{ const cfg = Object.assign(MHV.defaults('2.2', 'TQQQ'), { restart: 'rsi' }), O = MHV.run(cfg, TQ, { from: 1, capital: 10000, rows: true }), c2 = O.cycles.slice(1).filter(c => !c.rebuy);
  const ok1 = O.cycles.length > 2 && O.cycles[0].from === 1, bad = c2.filter(c => { const r = MHV.rsiW(TQ.c, c.from - 1); return !(r == null || r <= 60); });
  const waited = c2.filter(c => { const prev = O.cycles[O.cycles.indexOf(c) - 1]; return prev && prev.end != null && c.from > prev.end + 1; });
  check('새 사이클 RSI: 첫 사이클 바로 · 다음 사이클 첫날 RSI ≤ 60 · 기다린 사이클 있음', ok1 && bad.length === 0 && waited.length > 0, JSON.stringify([O.cycles.length, bad.length, waited.length]));
  const waitOk = waited.every(c => { const prev = O.cycles[O.cycles.indexOf(c) - 1]; for (let j = prev.end + 1; j < c.from; j++) { const r = MHV.rsiW(TQ.c, j - 1); if (r == null || r <= 60) return false; } return true; });
  check('새 사이클 RSI: 기다린 날은 모두 RSI > 60', waitOk); }

/* ⑥ 보유를 다 판 날 같은 날 매수 → 새 사이클 (V1.0 지정가 익절 + 큰수 LOC): T 는 1 이하에서 다시 시작 */
{ const O = MHV.run(MHV.defaults('1.0', 'TQQQ'), TQ, { from: 1, capital: 10000, rows: true }), rb = O.rows.filter(r => r.rb);
  check('V1.0 같은 날 재매수 = 새 사이클 (T ≤ 1)', rb.length > 0 && rb.every(r => r.T <= 1 + 1e-9), rb.length + '건 · 최대 T ' + Math.max.apply(null, rb.map(r => r.T)));
  check('V1.0 재매수 사이클 수 = 사이클 기록', O.cycles.filter(c => c.rebuy).length === rb.length); }

/* ⑦ 무작위 불변식: 보유 ≥ 0 · 매도 ≤ 보유 · 평가금 = 현금 + 보유 × 종가 · 최종 = 원금 + 실현 + 미실현 − 수수료 + 분배 */
{ let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; let n = 0, b0 = 0;
  for (let it = 0; it < 160; it++) {
    const [tk, S] = rnd() < 0.5 ? ['TQQQ', TQ] : ['SOXL', SX], ver = MHV.VERS[Math.floor(rnd() * 6)], cfg = MHV.defaults(ver, tk);
    if (ver !== '4.0') { cfg.splits = [20, 30, 40, 25, 60][Math.floor(rnd() * 5)]; cfg.money = rnd() < 0.5 ? 'simple' : cfg.money; const ex = MHV.EXHAUST[ver]; cfg.exhaust = ex[Math.floor(rnd() * ex.length)]; cfg.restart = rnd() < 0.2 ? 'rsi' : 'next'; cfg.ideal = rnd() < 0.3; }
    else cfg.splits = [20, 30, 40][Math.floor(rnd() * 3)];
    const N = S.c.length, from = 1 + Math.floor(rnd() * (N - 300)), to = Math.min(N - 1, from + 200 + Math.floor(rnd() * 2500)), cap = [5000, 20000, 1e5][Math.floor(rnd() * 3)], fee = rnd() < 0.5 ? 0 : 0.0025, dv = rnd() < 0.5;
    const O = MHV.run(cfg, { d: S.d, c: S.c, h: S.h, dv: dv ? S.dv : null }, { from, to, capital: cap, fee, sec: fee ? 0.0000206 : 0, divTax: dv ? 0.15 : 0, norm: ['auto', 'always', 'none'][Math.floor(rnd() * 3)], rows: true });
    let err = null, pq = 0, rz = 0, fe = 0, dd = 0; n++;
    for (const r of O.rows) { if (r.q < -1e-9) err = 'qty<0'; if (r.sq > pq + 1e-9) err = 'sell>hold'; if (Math.abs(r.cash + r.q * S.c[r.i] * r.k - r.eq) > 1e-6 * Math.max(1, r.eq)) err = 'eq'; if (!isFinite(r.eq)) err = 'nan'; pq = r.q; rz += r.rz; fe += r.fee; dd += r.dv; }
    const L = O.rows[O.rows.length - 1], want = cap + rz + L.q * (S.c[L.i] * L.k - L.avg * L.k) - fe + dd;
    if (Math.abs(want - O.final) > 1e-6 * Math.max(cap, O.final)) err = err || 'cash';
    if (err) { b0++; if (b0 < 4) console.log('  불변식', err, tk, ver, JSON.stringify({ sp: cfg.splits, ex: cfg.exhaust, id: cfg.ideal }), S.d[from]); }
  }
  check('무작위 불변식 (' + n + '번)', b0 === 0, b0 + '건 실패'); }

/* ⑧ 해외주식 양도소득세 — (결제일 기준 해마다 실현 손익 원화 − 250만) × 22% · 다음 해 5월 말 납부 */
function synth(dates, closes, highs) { return { d: dates, c: closes, h: highs, dv: null }; }
function bdays(from, n, skip) { const out = []; let t = Date.parse(from + 'T12:00:00Z'); while (out.length < n) { const d = new Date(t), s = d.toISOString().slice(0, 10); if (d.getUTCDay() % 6 && (!skip || skip.indexOf(s) < 0)) out.push(s); t += 864e5; } return out; }
{ /* V1.0: 첫날 100에 1000주 → 다음 날 고가 121 · 종가 120 → 110 지정가 전량 (이익 0,000) → 그 뒤 120 보합 (실현 손익 0) */
  /* 미국 결제일: 2024-05-28 전 T+2 · 그 뒤 T+1 — 12월 끝 무렵 매도는 결제일이 다음 해면 다음 해 양도 */
  for (const [start, wantY] of [['2025-03-03', 2025], ['2025-12-29', 2026], ['2023-12-26', 2024], ['2023-12-21', 2023]]) {
    const d = bdays(start, 420, ['2023-12-25', '2024-01-01', '2025-12-25', '2026-01-01', '2027-01-01']), c = d.map((x, i) => i === 0 || i === 1 ? 100 : 120), h = d.map((x, i) => i === 2 ? 121 : c[i]);
    const O = MHV.run(MHV.defaults('1.0', 'TQQQ'), synth(d, c, h), { from: 1, capital: 4000000, fee: 0, tax: { fx: () => 1300, method: 'fifo' }, rows: true });
    const T = O.taxes.filter(t => t.tax > 0), g = O.taxes.filter(t => t.y === wantY)[0];
    const sellDay = d[2], payDue = (wantY + 1) + '-05-31', paidDay = d.find(x => x >= payDue);
    check('양도세 ' + sellDay + ' 매도 → 결제일 기준 ' + wantY + '년', g && Math.abs(g.gain - 13000000) < 1 && T.length === 1 && T[0].y === wantY, JSON.stringify(O.taxes));
    check('양도세 (1300만 − 250만) × 22% = 231만 원 · ' + paidDay + ' 납부', g && Math.abs(g.tax - 2310000) < 1 && g.paid === paidDay && Math.abs(O.taxPaid - 2310000 / 1300) < 1e-6, g && JSON.stringify(g));
  } }
{ /* 선입선출 vs 이동평균: 100에 사고 90에 더 산 뒤 일부만 팔면 취득가가 다름 */
  const d = bdays('2025-03-03', 40), c = [100, 100, 90, 90, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95];
  const f = MHV.run(MHV.defaults('2.2', 'TQQQ'), synth(d, c, c.slice()), { from: 1, capital: 1e6, tax: { fx: () => 1000, method: 'fifo' }, rows: false });
  const a = MHV.run(MHV.defaults('2.2', 'TQQQ'), synth(d, c, c.slice()), { from: 1, capital: 1e6, tax: { fx: () => 1000, method: 'avg' }, rows: false });
  check('선입선출·이동평균 모두 계산 (실현 손익 없음 → 0)', f.taxes.every(t => t.tax === 0) && a.taxes.every(t => t.tax === 0)); }

/* ⑨ 상장 전 재현 구간: 가격 수준에 뜻이 없어 사이클 시작가를 $50 단위로 (예전엔 $10~$2000 이면 그대로 써 1회 매수금 < 1주 가격 → 매수가 멈춤)
      같은 가격이 실제 거래 가격이면 그대로(1주 단위 현실) 두고 '1회 매수금 < 1주 가격' 날을 셈 */
{ const n = 400, d = bdays('2000-01-03', n), c = d.map((x, i) => 900 * Math.pow(0.997, i) * (1 + 0.05 * Math.sin(i / 7)));
  const D = { d, c, h: c.map(x => x * 1.01), dv: null, L: 300 };
  for (const ver of MHV.VERS) {
    const O = MHV.run(MHV.defaults(ver, 'TQQQ'), D, { from: 1, capital: 10000, rows: true }), buys = O.rows.filter(r => r.i < 300 && r.bq > 0).length;
    check('상장 전 구간 $50 단위 · 매수 이어짐 V' + ver, buys > 20 && !(O.nobFrom && O.nobFrom < d[300]) && Math.abs(O.cycles[0].k - 50 / c[0]) < 1e-12, 'buys ' + buys + ' nobFrom ' + O.nobFrom + ' k ' + O.cycles[0].k);
    const O2 = MHV.run(MHV.defaults(ver, 'TQQQ'), Object.assign({}, D, { L: 0 }), { from: 1, capital: 10000, rows: true });
    check('실제 가격 $900 · 1회 $250 → 단위 그대로 · 1주 못 삼 날 셈 · 현금 ≥ 0 V' + ver, O2.cycles[0].k === 1 && O2.nob > 0 && O2.rows.every(r => r.cash > -1e-9), 'nob ' + O2.nob);
  } }

/* ⑩ 사이클 안 큰 하락($50 → $0.05) → 액면 병합처럼 단위 10배 (보유 ÷ 10 · 평단 × 10) · 세금 장부도 같은 단위 */
{ const n = 360, d = bdays('2024-01-02', n), c = d.map((x, i) => i < 250 ? 50 * Math.pow(0.001, i / 250) : 0.05 * Math.pow(1.3, (i - 250) / 4));
  const D = { d, c, h: c.map(x => x * 1.02), dv: null };
  for (const ver of ['2.2', '3.0', '4.0']) {
    const O = MHV.run(Object.assign(MHV.defaults(ver, 'TQQQ'), ver === '4.0' ? {} : { exhaust: 'hold' }), D, { from: 1, capital: 100000, rows: true, tax: { fx: () => 1000, method: 'fifo' } });
    let mn = Infinity; O.rows.forEach((r, k) => { if (k > 0 && O.rows[k - 1].q > 0) mn = Math.min(mn, D.c[r.i - 1] * r.k); });
    const rz = O.rows.reduce((s, r) => s + r.rz, 0), g = O.taxes.reduce((s, t) => s + t.gain, 0);
    check('액면 병합 V' + ver + ' (주문 단위 가격 ≥ $1)', O.rs >= 1 && mn >= 1 - 1e-9, 'rs ' + O.rs + ' min ' + mn);
    check('액면 병합 뒤 세금 장부 = 실현 손익 × 환율 V' + ver, Math.abs(g - rz * 1000) < 1e-6 * Math.max(1e3, Math.abs(rz * 1000)), 'gain ' + g + ' rz×1000 ' + rz * 1000);
    check('액면 병합 뒤 평가금 = 현금 + 보유 × 종가 V' + ver, O.rows.every(r => Math.abs(r.cash + r.q * D.c[r.i] * r.k - r.eq) < 1e-6 * Math.max(1, r.eq)));
  } }

/* ⑪ 5월 말 양도세를 낼 현금이 모자라면 그날 종가에 보유를 팔아 냄 · 다 팔아도 모자라면 밖에서 낸 것으로 (현금은 0 아래로 안 내려감 — 예전엔 음수 현금으로 매수가 멈췄음) */
{ const d = bdays('2025-01-02', 520), j = d.indexOf('2026-01-02');
  const path = (low, days) => { const c = d.map((x, i) => { if (i < j) { const ph = i % 60; return ph < 35 ? 100 - ph : 65 + (ph - 35) * 2.2; } const k = i - j; return k < days ? 80 * Math.pow(low / 80, k / days) : low; }); return { d, c, h: c.map(x => x * 1.005), dv: null }; };
  for (const [low, ext] of [[10, false], [2, true]]) {
    const D = path(low, 45), O = MHV.run(Object.assign(MHV.defaults('1.0', 'TQQQ'), { exhaust: 'hold' }), D, { from: 1, capital: 1e6, rows: true, fee: 0.001, tax: { fx: () => 1000, method: 'fifo' } });
    const ts = O.rows.filter(r => r.ts > 0), paid = O.taxes.filter(t => t.usd), last = O.rows[O.rows.length - 1];
    check('양도세 현금 부족 → 보유 팔아 냄 (최저 $' + low + ')', O.tsell === 1 && ts.length === 1 && ts[0].i === D.d.indexOf(paid[0].paid) && O.rows.every(r => r.cash > -1e-9), JSON.stringify([O.tsell, ts.length, O.taxExt]));
    check(ext ? '다 팔아도 모자람 → 밖에서 낸 세금만큼 평가금에서 뺌' : '팔아서 다 냄 → 밖에서 낸 세금 없음', ext ? (O.taxExt > 0 && last.q === 0 && Math.abs(last.cash) < 1e-6 && Math.abs(O.final + O.taxExt) < 1e-6 && paid[0].ext > 0) : O.taxExt === 0, JSON.stringify([O.taxExt, last.q, last.cash, O.final]));
    const rz = O.rows.reduce((s, r) => s + r.rz, 0), fe = O.rows.reduce((s, r) => s + r.fee, 0), un = last.q * (D.c[last.i] - last.avg) * last.k;
    check('세후 평가금 = 원금 + 실현 + 미실현 − 수수료 − 낸 세금 (최저 $' + low + ')', Math.abs(1e6 + rz + un - fe - O.taxPaid - O.final) < 1e-6 * 1e6, (1e6 + rz + un - fe - O.taxPaid) + ' vs ' + O.final);
  } }

/* ⑫ V3.0 반복리: 손해가 나도 1회 매수금을 줄이지 않음(원문) → 손실이 남겨 둔 수익 절반보다 크면 전반전부터 '잔금 소진 → 쿼터매도'가 되풀이 — 표시(lack0)하고 '다시 정하기'(선택)로 비교
      실제 TQQQ·SOXL 2010~ 에서는 한 번도 없음 (헛알림 없음) */
{ const d = bdays('2025-01-02', 700), j = d.indexOf('2026-01-02');
  const c = d.map((x, i) => { if (i < j) { const ph = i % 40; return ph < 20 ? 100 - ph * 1.2 : 76 + (ph - 20) * 2.5; } const k = i - j; return k < 60 ? 100 * Math.pow(0.03, k / 60) : k < 260 ? 3 * Math.pow(1 / 0.03, (k - 60) / 200) : 100 + (k - 260) * 0.3 * Math.sin(k); });
  const D = { d, c, h: c.map(x => x * 1.01), dv: null }, cfg = MHV.defaults('3.0', 'TQQQ');
  const A = MHV.run(cfg, D, { from: 1, capital: 100000, rows: false }), B = MHV.run(Object.assign({}, cfg, { rebase: true }), D, { from: 1, capital: 100000, rows: false });
  check('V3 완충 바닥 → 전반전 잔금 소진 셈 · 다시 정하기 켜면 줄어듦', A.lack0 > 0 && B.rebase > 0 && B.rebase === B.over && B.lack0 < A.lack0, JSON.stringify([A.lack0, B.rebase, B.over, B.lack0]));
  check('전반전 잔금 소진 표시는 V3.0 만 (V2.x 는 1회 매수금이 사이클마다 현금 ÷ 분할)', ['1.0', '2.0', '2.1', '2.2', '4.0'].every(v => MHV.run(MHV.defaults(v, 'TQQQ'), D, { from: 1, capital: 100000, rows: false, tax: { fx: () => 1000, method: 'fifo' } }).lack0 === 0));
  let fa = 0; for (const [tk, S] of [['TQQQ', TQ], ['SOXL', SX]]) for (const sp of [20, 30, 40]) { const R = MHV.run(Object.assign(MHV.defaults('3.0', tk), { splits: sp }), S, { from: 1, capital: 10000, rows: false }); fa += R.lack0; }
  check('실제 TQQQ·SOXL V3.0 (20·30·40분할) 전반전 잔금 소진 0일', fa === 0, fa); }

/* ⑬ 1회 매수금 < 1주 가격 (작은 원금): V4.0 도 현금 안에서만 사고(예전엔 주문표의 '최소 1주' 때문에 현금이 음수) · 그런 날을 셈 */
{ const n = 300, d = bdays('2024-01-02', n), c = d.map((x, i) => 50 * (1 + 0.2 * Math.sin(i / 9)) * Math.pow(0.999, i)), D = { d, c, h: c.map(x => x * 1.01), dv: null };
  for (const ver of MHV.VERS) { const O = MHV.run(MHV.defaults(ver, 'TQQQ'), D, { from: 1, capital: 600, rows: true, fee: 0.0025 });
    check('작은 원금 $600 · 1회 < 1주 → 현금 ≥ 0 · 셈 V' + ver, O.rows.every(r => r.cash > -1e-9) && O.nob > 0, 'nob ' + O.nob + ' minCash ' + Math.min.apply(null, O.rows.map(r => r.cash))); } }

/* ⑭ 실제 TQQQ·SOXL 기본값(세금·수수료 포함): 현금은 늘 0 이상 · 알림(1주 못 삼·액면 병합·밖에서 낸 세금) 없음 */
{ let bad1 = []; for (const [tk, S] of [['TQQQ', TQ], ['SOXL', SX]]) for (const ver of MHV.VERS) {
    const O = MHV.run(MHV.defaults(ver, tk), S, { from: 1, capital: 10000, rows: true, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: { fx: () => 1300, method: 'fifo' } });
    if (!O.rows.every(r => r.cash > -1e-9) || O.nob || O.rs || O.taxExt) bad1.push(tk + ' ' + ver + ' ' + JSON.stringify([Math.min.apply(null, O.rows.map(r => r.cash)), O.nob, O.rs, O.taxExt])); }
  check('실제 TQQQ·SOXL 기본값 세금 포함: 현금 ≥ 0 · 알림 없음', bad1.length === 0, bad1.join(' | ')); }

/* ⑮ 무작위 불변식 (세금 포함): 현금 ≥ 0 · 세후 평가금 = 원금 + 실현 + 미실현 − 수수료 + 분배 − 낸 세금 */
{ let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648; let n = 0, b0 = 0;
  for (let it = 0; it < 120; it++) {
    const [tk, S] = rnd() < 0.5 ? ['TQQQ', TQ] : ['SOXL', SX], ver = MHV.VERS[Math.floor(rnd() * 6)], cfg = MHV.defaults(ver, tk);
    if (ver !== '4.0') { cfg.splits = [20, 30, 40][Math.floor(rnd() * 3)]; const ex = MHV.EXHAUST[ver]; cfg.exhaust = ex[Math.floor(rnd() * ex.length)]; if (ver === '3.0') cfg.rebase = rnd() < 0.5; }
    const N = S.c.length, from = 1 + Math.floor(rnd() * (N - 600)), to = Math.min(N - 1, from + 500 + Math.floor(rnd() * 3000)), cap = [3000, 20000, 1e6][Math.floor(rnd() * 3)];
    const O = MHV.run(cfg, { d: S.d, c: S.c, h: S.h, dv: S.dv }, { from, to, capital: cap, fee: 0.0025, sec: 0.0000206, divTax: 0.15, rows: true, tax: { fx: () => 1100 + 300 * rnd(), method: rnd() < 0.5 ? 'fifo' : 'avg', harvest: rnd() < 0.3 } });
    let err = null, rz = 0, fe = 0, dd = 0; n++;
    for (const r of O.rows) { if (r.cash < -1e-9) err = 'cash<0'; if (!isFinite(r.eq)) err = 'nan'; rz += r.rz; fe += r.fee; dd += r.dv; }
    const L = O.rows[O.rows.length - 1], want = cap + rz + L.q * (S.c[L.i] * L.k - L.avg * L.k) - fe + dd - O.taxPaid;
    if (Math.abs(want - O.final) > 1e-6 * Math.max(cap, Math.abs(O.final))) err = err || 'final ' + want + ' vs ' + O.final;
    if (err) { b0++; if (b0 < 4) console.log('  세금 불변식', err, tk, ver, cap, S.d[from]); }
  }
  check('무작위 불변식 · 세금 포함 (' + n + '번)', b0 === 0, b0 + '건 실패'); }

/* ⑯ 1회 매수금 '일부분 복리'(money 'part' · mix · 72루틴 선택) — 번 돈은 mix 만큼: (처음 원금 + (현금 − 처음 원금) × mix) ÷ 분할
      · 잃은 돈은 전부(2026-10-15 사용자 결정): 현금 < 처음 원금이면 처음 원금 = 현금 · 1회 = 현금 ÷ 분할 · mix 1 = 복리와 날마다 같음 */
{ const c72 = m => Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, avgOff: 0, exhaust: 'recover', restart: 'rsi' }, m);
  const o = { from: 1, capital: 10000, rows: true, fee: 0.0075, sec: 0.0000206, divTax: 0.15, tax: { fx: () => 1300, method: 'fifo', harvest: false } };
  const run = m => MHV.run(c72(m), SX, o), same = (a, b) => a.eq.length === b.eq.length && a.eq.every((x, i) => Math.abs(x - b.eq[i]) < 1e-9);
  const C = run({ money: 'compound' }), S0 = run({ money: 'simple' }), P1 = run({ money: 'part', mix: 1 }), P0 = run({ money: 'part', mix: 0 }), PN = run({ money: 'part' });
  check('일부분 복리 mix 1 = 복리 (날마다 평가금)', same(P1, C)); check('일부분 복리 mix 없음 = 복리', same(PN, C));
  check('일부분 복리 mix 0 ≠ 단리 (손실 뒤엔 처음 원금을 낮춰 1회가 현금 ÷ 72) · 현금 ≥ 0', !same(P0, S0) && P0.rows.every(r => r.cash > -1e-9), [P0.final, S0.final].map(Math.round).join(' / '));
  const cfg = c72({ money: 'part', mix: 0.3 }), s = MHV.init(cfg, 10000); s.cash = 13000; MHV.begin(cfg, s);
  check('일부분 복리 30%: 이익 3,000 → 1회 = (10,000 + 900) ÷ 72', Math.abs(s.one - 10900 / 72) < 1e-9, s.one);
  s.cash = 6000; MHV.begin(cfg, s);
  check('일부분 복리 30%: 손실 4,000 → 잃은 돈 전부 · 1회 = 6,000 ÷ 72 · 처음 원금 6,000 으로', Math.abs(s.one - 6000 / 72) < 1e-9 && s.base === 6000, [s.one, s.base]);
  s.cash = 9000; MHV.begin(cfg, s);
  check('일부분 복리 30%: 그 뒤 이익 3,000 → 낮춘 원금 기준 (6,000 + 900) ÷ 72', Math.abs(s.one - 6900 / 72) < 1e-9 && s.base === 6000, [s.one, s.base]);
  const z = MHV.init(c72({ money: 'part', mix: 0 }), 10000); z.cash = 12000; MHV.begin(c72({ money: 'part', mix: 0 }), z);
  check('일부분 복리 0%: 이익은 넣지 않음 → 1회 = 10,000 ÷ 72', Math.abs(z.one - 10000 / 72) < 1e-9, z.one);
  /* 손실 뒤에도 1회 × 분할 ≤ 현금 (72회를 끝까지 살 수 있음) — 사이클 시작마다 */
  const st5 = MHV.init(cfg, 10000); let okAll = true; [7000, 12000, 8000, 15000, 15000, 9000].forEach(cs => { st5.cash = cs; MHV.begin(cfg, st5); if (st5.one * 72 > cs + 1e-6) okAll = false; });
  check('일부분 복리: 어떤 순서로 벌고 잃어도 1회 × 72 ≤ 현금', okAll);
  const H = run({ money: 'part', mix: 0.5 });
  check('일부분 복리 50%: 현금 ≥ 0 · 결과가 복리·단리와 다름', H.rows.every(r => r.cash > -1e-9) && !same(H, C) && !same(H, S0), [H.final, C.final, S0.final].map(Math.round).join(' / ')); }

/* ⑰ 중간 진입이 이미 소진이면(V1.0: 회차를 다 썼거나 현금 < 1회 × 0.5) 처음부터 소진 대응 — 다시 계산(replay) 직후 그날 주문표에 매수 없음 (72루틴·새로 만든 중간 진입 = 표식 xc)
   · 표식 없는 예전 중간 진입 세션은 예전처럼 (첫 기록 날 판정 — 그 기록을 다시 계산해도 상태가 바뀌지 않게) */
{ const cfg = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, avgOff: 0, exhaust: 'recover' });
  const mid = m => MHV.replay(cfg, { capital: 20000, mid: Object.assign({ qty: 100, avg: 50, one: 277.78, xc: true }, m) }, []).st, buys = st => MHV.plan(cfg, st, { prev: 48 }).rows;
  const A = mid({ cash: 15000, T: 72 }), pa = buys(A);
  check('중간 진입 72회 다 씀 → 소진 대응(평단 −10% LOC 전량) · 매수 주문 없음', A.mode === 'xrec' && !pa.some(r => r.side === 'B') && pa.some(r => r.tag === 'xrec') && pa.some(r => r.tag === 'tp'), A.mode + ' ' + pa.map(r => r.tag).join(','));
  const B = mid({ cash: 100, T: 30 });
  check('중간 진입 현금 < 1회 × 0.5 → 소진 대응', B.mode === 'xrec' && !buys(B).some(r => r.side === 'B'), B.mode);
  const C = mid({ cash: 15000, T: 30 }), pc = buys(C);
  check('중간 진입 여유 있음 → 평소 주문표 (평단·큰수 LOC 매수 + 목표 지정가)', C.mode === 'normal' && pc.some(r => r.tag === 'avg') && pc.some(r => r.tag === 'big') && pc.some(r => r.tag === 'tp'), C.mode + ' ' + pc.map(r => r.tag).join(','));
  const cf2 = Object.assign({}, cfg, { exhaust: 'hold' }), H = MHV.replay(cf2, { capital: 20000, mid: { qty: 100, avg: 50, cash: 15000, T: 72, one: 277.78, xc: true } }, []).st;
  check('중간 진입 소진 · 다른 소진 대응(보유)도 그대로', H.mode === 'xhold', H.mode);
  const O = mid({ cash: 15000, T: 72, xc: false });
  check('표식 없는 예전 중간 진입은 예전처럼 (시작은 평소 상태 · 첫 기록 날 판정)', O.mode === 'normal', O.mode);
  /* 예전 세션 다시 계산 그대로: V2.2 T 39.5/40 중간 진입 + 첫날 ★쿼터매도 기록 → 표식 없으면 평소 상태 유지 (표식이 있으면 처음부터 쿼터손절 — 새 세션에서만) */
  const c22 = MHV.defaults('2.2', 'TQQQ'), recs = [{ date: '2024-01-02', close: 52, fills: [{ side: 'S', q: 197, p: 52, tag: 'qs', m: 'LOC' }] }];
  const m22 = { qty: 790, avg: 50, cash: 500, one: 1000, T: 39.5 }, o22 = MHV.replay(c22, { capital: 40000, mid: m22 }, recs).st, n22 = MHV.replay(c22, { capital: 40000, mid: Object.assign({ xc: true }, m22) }, []).st;
  check('V2.2 예전 중간 진입(T 39.5) + 첫날 기록 → 평소 상태 그대로 · 새 중간 진입은 처음부터 소진(쿼터손절)', o22.mode === 'normal' && n22.mode !== 'normal', o22.mode + ' / ' + n22.mode); }

/* ⑱ 증권사 주문 거부 (백테스트 선택 o.rej) — 매수 지정가 > 주문 시점 가격(그날 시가, 없으면 전날 종가) × 1.2(1센트 버림)
   · clamp = 한도로 낮춰 넣기(수량 그대로) · skip = 그날 그 주문 없음 · 매도·MOC 는 그대로(매도가 시가 × 0.8 아래인 날은 셈만) */
{ const RC = MHV.rejCap;
  eq('한도 = 시가 × 1.2 1센트 버림 (118.42 → 142.10 · 120.91 → 145.09 · 100 → 120 · 1.5 → 1.80 · 3 → 3.60 부동소수 오차 없이)', [RC(118.42, 1.2), RC(120.91, 1.2), RC(100, 1.2), RC(1.15, 1.2), RC(120.9, 1.2), RC(1.5, 1.2), RC(3, 1.2), RC(3.8, 1.2)], [142.1, 145.09, 120, 1.38, 145.08, 1.8, 3.6, 4.56]);
  { let badc = []; for (let c = 100; c <= 50000; c++) { const x = c / 100; if (RC(x, 1.2) !== Math.floor(c * 12 / 10) / 100) badc.push(x); }   /* $1 ~ $500 모든 센트: 정수로 셈한 값과 같음 */
    check('한도 1센트 버림 = 정수 계산 ($1 ~ $500 모든 센트 가격)', !badc.length, badc.slice(0, 5).join(',')); }
  const mk = () => [{ side: 'B', m: 'LOC', p: 145.09, q: 10, tag: 'first' }, { side: 'B', m: 'LOC', p: 142.1, q: 3, tag: 'avg' }, { side: 'B', m: 'MOC', p: 0, q: 2, tag: 'x' },
                    { side: 'S', m: 'LMT', p: 200, q: 5, tag: 'tp' }, { side: 'S', m: 'MOC', p: 0, q: 3, tag: 'xall' }];
  const S0 = () => ({ days: 0, rows: 0, miss: 0, noO: 0, sell: 0, first: null });
  let rw = mk(), S = S0(), n = MHV.rejApply(rw, 118.42, { mode: 'clamp', cap: 1.2 }, { c: 125.06 }, S, '2026-10-13');
  eq('clamp: 한도 넘는 줄만 한도로 (수량 그대로 · 원래 가격 rj) · 한도와 같은 줄·MOC·매도 그대로', rw.map(r => [r.side, r.m, r.p, r.q, r.rj || 0]),
     [['B','LOC',142.1,10,145.09],['B','LOC',142.1,3,0],['B','MOC',0,2,0],['S','LMT',200,5,0],['S','MOC',0,3,0]]);
  eq('clamp 통계: 거부 1일 · 1줄 · 종가 125.06 ≤ 한도라 결과 같음(miss 0)', [n, S.days, S.rows, S.miss, S.first], [1, 1, 1, 0, '2026-10-13']);
  rw = mk(); S = S0(); MHV.rejApply(rw, 118.42, { mode: 'clamp', cap: 1.2 }, { c: 143 }, S, 'd');
  eq('clamp: 종가 143 (한도 142.10 < 종가 ≤ 원래 145.09) → 그날 체결이 달라짐(miss) · 낮춘 줄은 안 됨 / 원래 줄은 됨', [S.days, S.miss, MHV.settle(rw, { c: 143 }).filter(f => f.side === 'B').map(f => f.tag), MHV.settle(mk(), { c: 143 }).filter(f => f.side === 'B').map(f => f.tag)], [1, 1, [], ['first']]);
  rw = mk(); S = S0(); MHV.rejApply(rw, 118.42, { mode: 'skip', cap: 1.2 }, { c: 125.06 }, S, 'd');
  eq('skip: 한도 넘는 줄 없앰 · 종가 ≤ 원래 가격이라 달라짐', [rw.map(r => r.tag), S.days, S.rows, S.miss], [['avg', 'x', 'tp', 'xall'], 1, 1, 1]);
  rw = mk(); S = S0(); MHV.rejApply(rw, 118.42, { mode: 'skip', cap: 1.2 }, { c: 146 }, S, 'd');
  eq('skip: 종가 146 > 원래 가격 → 어차피 안 됐을 주문 (miss 0)', [S.days, S.miss], [1, 0]);
  rw = [{ side: 'S', m: 'LOC', p: 90, q: 5, tag: 'xrec' }, { side: 'S', m: 'MOC', p: 0, q: 5, tag: 'xall' }]; S = S0(); MHV.rejApply(rw, 118.42, { mode: 'clamp', cap: 1.2 }, { c: 120 }, S, 'd');
  eq('매도 지정가 < 시가 × 0.8 → sell 셈만 (매도 줄은 그대로 · MOC 는 셈 안 함)', [S.sell, S.days, rw[0].p], [1, 0, 90]);
  rw = mk(); S = S0(); MHV.rejApply(rw, 125, { mode: 'clamp', cap: 1.2 }, { c: 125 }, S, 'd');
  eq('한도 안이면 아무것도 안 바뀜 (시가 125 → 한도 150)', [rw.map(r => r.p), S.days], [[145.09, 142.1, 0, 200, 0], 0]);
  /* 주문 시점 가격 = 그날 시가 (종가가 아님): 둘째 날 시가 90 → 한도 108 < 상단 매수선 113 (종가 100 이면 한도 120 이라 거부 없음) */
  { const cf = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 10, big: 13 }), Dm = { d: ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'], c: [100, 100, 100, 100], h: [100, 100, 100, 100], o: [100, 100, 90, 100], dv: [0, 0, 0, 0] };
    const om = { from: 1, to: 3, capital: 10000, norm: 'none', rows: true, fee: 0, sec: 0, divTax: 0, tax: null };
    const Q = m => MHV.run(cf, Dm, Object.assign({}, om, { rej: m ? { mode: m, cap: 1.2 } : null }));
    const N = Q(null), Cc = Q('clamp'), Sk = Q('skip');
    eq('시가 90 인 날만 거부(1일·1줄) · 낮춰 넣으면 종가 100 ≤ 108 이라 같은 체결 · 건너뛰면 그 줄 없음', [Cc.rj.days, Cc.rj.rows, Cc.rj.miss, Cc.rj.first, Sk.rj.days, Sk.rj.miss, Cc.rows[1].rj, Cc.rows[1].bq === N.rows[1].bq, Sk.rows[1].bq < N.rows[1].bq],
       [1, 1, 0, '2026-01-06', 1, 1, 1, true, true]);
    const Dn = Object.assign({}, Dm, { o: null }), Q2 = MHV.run(cf, Dn, Object.assign({}, om, { rej: { mode: 'skip', cap: 1.2 } }));
    eq('시가가 없으면 전날 종가(100)로 봄 → 거부 없음 · noO 3일', [Q2.rj.days, Q2.rj.noO, Q2.final === N.final], [0, 3, true]); }
  /* run: 72루틴 설정(V1.0 · 72분할 · 상단 매수선 +13%) */
  const c72 = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, avgOff: 0, exhaust: 'recover', lines: 0 });
  const base = { from: 1, to: SX.d.length - 1, capital: 100000, norm: 'auto', rows: true, fee: 0.0025, sec: 0.0000206, divTax: 0.15, tax: null };
  const same = (A, B) => A.eq.length === B.eq.length && A.eq.every((v, i) => v === B.eq[i]) && A.final === B.final;
  const R0 = MHV.run(c72, SX, base), Rn = MHV.run(c72, SX, Object.assign({}, base, { rej: null }));
  check('rej 없음 = 지금까지와 같음 (날마다 평가금) · 통계 없음', same(R0, Rn) && R0.rj === null);
  const Rc0 = MHV.run(c72, SX, Object.assign({}, base, { rej: { mode: 'clamp', cap: 1.2 } }));
  check('시가 자료 없음 → 전날 종가로 봄: +13% 줄은 한도(+20%) 안 → 거부 0 · 결과 같음 · noO = 모든 날', same(Rc0, R0) && Rc0.rj.days === 0 && Rc0.rj.noO === base.to - base.from + 1, JSON.stringify(Rc0.rj));
  const Rbig = MHV.run(Object.assign({}, c72, { big: 30 }), SX, Object.assign({}, base, { rej: { mode: 'skip', cap: 1.2 } }));
  check('시가 없음 + 상단 매수선 +30% → 전날 종가 기준으로도 늘 한도 초과 (구조적 거부)', Rbig.rj.days > 100 && Rbig.rj.rows >= Rbig.rj.days, JSON.stringify(Rbig.rj));
  /* 시가를 만들어 넣은 자료: 어떤 날은 '시가 = 종가 ÷ 1.15'(그 종가가 전날 × 1.08 아래인 날 → 한도 = 종가 × 1.0435 < 상단 매수선, 그리고 종가 ≤ 한도) */
  const o = SX.c.map((c, i) => i && i % 3 === 0 && c < SX.c[i - 1] * 1.08 ? c / 1.15 : i ? SX.c[i - 1] : c), D2 = Object.assign({}, SX, { o });
  const nTrig = o.filter((x, i) => i && i % 3 === 0 && SX.c[i] < SX.c[i - 1] * 1.08).length;
  const Rc = MHV.run(c72, D2, Object.assign({}, base, { rej: { mode: 'clamp', cap: 1.2 } })), Rs = MHV.run(c72, D2, Object.assign({}, base, { rej: { mode: 'skip', cap: 1.2 } }));
  check('clamp: 종가가 늘 한도 아래인 자료 → 거부는 있어도(' + Rc.rj.days + '일) 결과는 반영 안 함과 날마다 같음 · miss 0', Rc.rj.days > 50 && Rc.rj.miss === 0 && same(Rc, R0), JSON.stringify(Rc.rj));
  check('skip: 같은 자료 → 거부된 날마다 그 주문은 체결됐을 것 (miss = days) · 결과 다름', Rs.rj.days > 50 && Rs.rj.miss === Rs.rj.days && !same(Rs, R0), JSON.stringify(Rs.rj));
  check('skip: 거부된 날(행 rj > 0)엔 큰 줄(상단 매수선·처음 매수) 체결이 없음', Rs.rows.filter(r => r.rj > 0).every(r => !(r.tags.big || r.tags.first || r.tags.cap)), Rs.rows.filter(r => r.rj > 0 && (r.tags.big || r.tags.first || r.tags.cap)).length);
  check('거부 줄이 생기는 날 ≤ 만든 갭 하락 날(' + nTrig + ')', Rc.rj.days <= nTrig && Rs.rj.days <= nTrig);
  /* 다른 버전 · V4.0(MHE 주문표) · 정액 · 세금 장부 포함에서도 clamp(종가 ≤ 한도) = 반영 안 함, 현금 ≥ 0 */
  const tx = { fx: () => 1300, method: 'fifo', harvest: false };
  [['2.1', {}], ['2.2', {}], ['3.0', {}], ['4.0', {}], ['2.1', { ideal: true }], ['1.0', { big: 15 }]].forEach(([v, x]) => {
    const cf = Object.assign(MHV.defaults(v, 'SOXL'), x), bb = Object.assign({}, base, { capital: 10000, tax: tx }), A = MHV.run(cf, D2, bb), B = MHV.run(cf, D2, Object.assign({}, bb, { rej: { mode: 'clamp', cap: 1.2 } })), C = MHV.run(cf, D2, Object.assign({}, bb, { rej: { mode: 'skip', cap: 1.2 } }));
    check('V' + v + (x.ideal ? ' 정액' : '') + ': clamp(종가 ≤ 한도) = 반영 안 함 · skip 현금 ≥ 0 · 통계 일관 (거부 ' + B.rj.days + '일)', same(A, B) && B.rj.miss === 0 && C.rows.every(r => r.cash > -1e-6) && C.rj.miss <= C.rj.days && C.rj.rows >= C.rj.days, JSON.stringify([B.rj, C.rj]));
  });
}

/* ⑲ 주문 넣는 때 (백테스트 선택 o.fill) — 지정가 매도 체결 가격과 주문 거부 기준가만 바뀜 · LOC·MOC 는 그대로 · 없으면 지금까지와 같음 */
{
  const one = (bar) => { const f = MHV.settle([{ side: 'S', m: 'LMT', p: 100, q: 5, tag: 'tp' }], bar)[0]; return f ? [f.p, f.gap || 0] : null; };
  eq('기존(fm 없음): 고가 101 ≥ 100 → 지정가 100 (시가 103·전날 종가 120 이 있어도 무시)', one({ c: 99, h: 101, o: 103, pc: 120 }), [100, 0]);
  eq('open: 시가 103 · 고가 105 → 시가 103 에 (gap 1)', one({ c: 99, h: 105, o: 103, fm: 'open', pc: 98 }), [103, 1]);
  eq('open: 시가 98 · 고가 101 → 지정가 100 (gap 0)', one({ c: 99, h: 101, o: 98, fm: 'open', pc: 98 }), [100, 0]);
  eq('open: 시가 모름(0) · 고가 105 → 지정가 100', one({ c: 99, h: 105, o: 0, fm: 'open', pc: 98 }), [100, 0]);
  eq('open: 시가 110 > 고가 105 (자료 어긋남) → 고가 105 까지만', one({ c: 99, h: 105, o: 110, fm: 'open', pc: 98 }), [105, 1]);
  eq('open: 고가 99 < 지정가 → 체결 없음 (시가 99)', one({ c: 98, h: 99, o: 99, fm: 'open', pc: 98 }), null);
  eq('pre: 전날 종가 102 ≥ 지정가 → 전날 종가 102 에 (그날 고가 99 여도)', one({ c: 97, h: 99, o: 98, fm: 'pre', pc: 102 }), [102, 1]);
  eq('pre: 전날 종가 98 · 시가 103 갭 상승 → 지정가 100 (프리장에서 걸림 — 보수적)', one({ c: 99, h: 105, o: 103, fm: 'pre', pc: 98 }), [100, 0]);
  eq('pre: 전날 종가 98 · 고가 99 → 체결 없음', one({ c: 98, h: 99, o: 98, fm: 'pre', pc: 98 }), null);
  eq('pre: 전날 종가 = 지정가 100 → 100 (gap 0)', one({ c: 95, h: 96, o: 96, fm: 'pre', pc: 100 }), [100, 0]);
  const lb = m => MHV.settle([{ side: 'B', m: 'LOC', p: 50, q: 2, tag: 'avg' }, { side: 'S', m: 'LOC', p: 48, q: 1, tag: 'q' }, { side: 'S', m: 'MOC', p: 0, q: 1, tag: 'x' }], { c: 49, h: 60, o: 55, fm: m, pc: 70 }).map(f => [f.side, f.p, f.q]);
  eq('LOC 매수·LOC 매도·MOC 는 셋 다 같음 (종가 49)', [lb(undefined), lb('open'), lb('pre')], [[['B',49,2],['S',49,1],['S',49,1]], [['B',49,2],['S',49,1],['S',49,1]], [['B',49,2],['S',49,1],['S',49,1]]]);
  /* 작은 자료로 run 끝까지: V1.0 10분할 목표 10% — 1일째 종가 100 매수 → 2일째 시가 112 · 고가 115 (지정가 110) */
  const cf = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 10, target: 10, big: 13 }), Dm = { d: ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07'], c: [100, 100, 111, 111], h: [100, 100, 115, 111], o: [100, 100, 112, 111], dv: [0, 0, 0, 0] };
  const om = { from: 1, to: 3, capital: 10000, norm: 'none', rows: true, fee: 0, sec: 0, divTax: 0, tax: null };
  const Rf = m => MHV.run(cf, Dm, Object.assign({}, om, { fill: m }));
  const A0 = Rf(null), Ao = Rf('open'), Ap = Rf('pre'), q1 = A0.rows[0].bq;
  eq('run: 2일째 매도 수량 같음 · 기존 = 지정가 110 × 수량 · 정규장 시작 전 = 시가 112 × 수량 · 프리장 시작 = 110 (전날 종가 100 < 110)', [A0.rows[1].sq === q1, Ao.rows[1].sq === q1, Math.round(A0.rows[1].sa * 100) / 100, Math.round(Ao.rows[1].sa * 100) / 100, Math.round(Ap.rows[1].sa * 100) / 100],
     [true, true, Math.round(110 * q1 * 100) / 100, Math.round(112 * q1 * 100) / 100, Math.round(110 * q1 * 100) / 100]);
  eq('run: 통계 fx — 기존 null · open 1일 · pre 0일 · 최종 차이 = 2 × 수량', [A0.fx, Ao.fx.days, Ap.fx.days, Math.round((Ao.final - A0.final) * 1e6) / 1e6], [null, 1, 0, 2 * q1]);
  /* 실제 SOXL(시가 포함) · 72루틴 설정 */
  const so = J.series.SOXL, SXo = Object.assign({}, SX, { o: so.o && so.o.length === SX.c.length ? so.o : null });
  check('etfcagr SOXL 시가 o 가 있음 (종가와 같은 길이)', !!SXo.o, so.o ? so.o.length + ' vs ' + SX.c.length : '없음');
  const c72 = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, avgOff: 0, exhaust: 'recover', lines: 0 });
  const base = { from: 1, to: SX.d.length - 1, capital: 100000, norm: 'auto', rows: true, fee: 0.0025, sec: 0.0000206, divTax: 0.15, tax: null };
  const same = (A, B) => A.eq.length === B.eq.length && A.eq.every((v, i) => v === B.eq[i]) && A.final === B.final;
  const R0 = MHV.run(c72, SXo, base), Rn = MHV.run(c72, SXo, Object.assign({}, base, { fill: null })), Rx = MHV.run(c72, SXo, Object.assign({}, base, { fill: 'zzz' }));
  check('fill 없음·이상한 값 = 지금까지와 같음 (fx null)', same(R0, Rn) && same(R0, Rx) && R0.fx === null && Rx.fx === null);
  const Ro = MHV.run(c72, SXo, Object.assign({}, base, { fill: 'open' })), Rp = MHV.run(c72, SXo, Object.assign({}, base, { fill: 'pre' }));
  const fd = (A, B) => { for (let i = 0; i < A.rows.length; i++) if (A.rows[i].sa !== B.rows[i].sa || A.rows[i].bq !== B.rows[i].bq) return i; return -1; };
  const io = fd(R0, Ro);
  check('open: 갭 상승 매도 날 ' + Ro.fx.days + '일 · 처음 달라진 날 = 같은 수량을 더 비싸게 판 날', Ro.fx.days > 0 && io >= 0 && Ro.rows[io].sq === R0.rows[io].sq && Ro.rows[io].sa > R0.rows[io].sa && Ro.rows[io].bq === R0.rows[io].bq, 'i ' + io);
  check('pre(주문 거부 없음): 전날 종가가 이미 지정가 이상인 날이 없으면 기존과 같음 (' + Rp.fx.days + '일)', (Rp.fx.days === 0) === same(Rp, R0));
  const P3 = ['clamp', 'skip'].map(m => MHV.run(c72, SXo, Object.assign({}, base, { fill: 'pre', rej: { mode: m, cap: 1.2 } })));
  check('pre: 주문 거부 기준 = 전날 종가 → 상단 매수선 +13% 는 한도(+20%) 안 → 거부 0 · 결과 = pre 반영 안 함 · noO 0', P3.every(R => R.rj.days === 0 && R.rj.noO === 0 && same(R, Rp)), JSON.stringify(P3.map(R => R.rj)));
  const O3 = ['clamp', 'skip'].map(m => MHV.run(c72, SXo, Object.assign({}, base, { fill: 'open', rej: { mode: m, cap: 1.2 } }))), L3 = MHV.run(c72, SXo, Object.assign({}, base, { rej: { mode: 'skip', cap: 1.2 } }));
  check('open·기존: 주문 거부 기준 = 그날 시가 → 갭 하락 날 거부 있음 (' + O3[1].rj.days + ' · ' + L3.rj.days + '일)', O3[1].rj.days > 0 && L3.rj.days > 0 && O3[0].rj.noO === L3.rj.noO);
  const Pb = MHV.run(Object.assign({}, c72, { big: 30 }), SXo, Object.assign({}, base, { fill: 'pre', rej: { mode: 'skip', cap: 1.2 } }));
  check('pre + 상단 매수선 +30% → 전날 종가 × 1.2 를 늘 넘음 (구조적 거부)', Pb.rj.days > 100 && Pb.rj.noO === 0, JSON.stringify(Pb.rj));
  const Ronull = MHV.run(c72, SX, Object.assign({}, base, { fill: 'open' }));
  check('open + 시가 자료 없음 → 지정가로 봄 = 기존과 같음 · fx.noO > 0 · days 0', same(Ronull, R0) && Ronull.fx.days === 0 && Ronull.fx.noO > 0, JSON.stringify(Ronull.fx));
  /* 다른 버전 · V4.0(MHE 주문표) · 정액 · 세금 장부: open 의 지정가 매도 체결가 ≥ 지정가 (현금 ≥ 0 · 날마다 매도 금액 ≥ 같은 날 기존 매도 금액, 처음 달라진 날까지) */
  const tx = { fx: () => 1300, method: 'fifo', harvest: false };
  [['2.1', {}], ['2.2', {}], ['3.0', {}], ['4.0', {}], ['2.1', { ideal: true }]].forEach(([v, x]) => {
    const cf2 = Object.assign(MHV.defaults(v, 'SOXL'), x), bb = Object.assign({}, base, { capital: 10000, tax: tx }), A = MHV.run(cf2, SXo, bb), B = MHV.run(cf2, SXo, Object.assign({}, bb, { fill: 'open' })), C = MHV.run(cf2, SXo, Object.assign({}, bb, { fill: 'pre', rej: { mode: 'clamp', cap: 1.2 } }));
    const i = fd(A, B);
    check('V' + v + (x.ideal ? ' 정액' : '') + ': open 처음 달라진 날 = 더 비싸게 판 날 · 현금 ≥ 0 · fx 통계 (' + B.fx.days + '일 · pre ' + C.fx.days + '일)', B.fx.days > 0 && i >= 0 && B.rows[i].sa > A.rows[i].sa && B.rows.every(r => r.cash > -1e-6) && C.rows.every(r => r.cash > -1e-6) && C.rj.noO === 0, 'i ' + i);
  });
}

console.log((bad ? 'FAIL ' : 'OK ') + '무한매수법 버전 엔진 검사 ' + ok + ' / ' + (ok + bad));
process.exit(bad ? 1 : 0);
