/* 무한매수법 버전별 엔진(MHV) 검사 — node tests/muhan_ver_test.js  (run_regression.py 가 자동 실행)
   · src/index.html 의 [MUHAN-ENGINE](MHE) · [MUHAN-VER](MHV) 를 그대로 꺼내 씀 (브라우저와 같은 코드)
   · 라오어 공식 카페 원문 숫자: 주문표 예시 · 별% 공식 · 반복리 · LABU 2021 사례 · TQQQ 해마다 소진 횟수(2010~2021)
   · V4.0 = 기록 화면 엔진(MHE.backtest)과 날마다 같은 평가금 · 기록 화면 다시 계산(replay) = 백테스트 상태 · 무작위 불변식 · 양도소득세 계산
   · 가격 단위(상장 전 재현·액면 병합) · 양도세 현금 부족 · V3 반복리 완충 바닥 · 작은 원금(1회 < 1주) · 세금 포함 불변식
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

console.log((bad ? 'FAIL ' : 'OK ') + '무한매수법 버전 엔진 검사 ' + ok + ' / ' + (ok + bad));
process.exit(bad ? 1 : 0);
