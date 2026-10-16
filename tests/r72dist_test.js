/* 72루틴 시작일별 분포([T72-DIST] R72D) 검사 — node tests/r72dist_test.js [--full]  (run_regression.py 가 자동 실행)
   · src/index.html 의 MHE · MHV · MBT · R72D 를 그대로 꺼내 씀 (브라우저·자동매매 프로그램과 같은 코드)
   · ① 순수 함수: 백분위(선형 보간 = 엑셀 PERCENTILE) · 5%p 구간(아래 포함·위 미포함 · 경계값 · 음수) · 보유 기간 필터(365.25 × N 경계) · 시작일 목록(매월 첫 거래일 · 끝 20거래일 전)
   · ② 시작일 하나(R72D.one) = 화면 백테스트 카드 계산(MHV.run → MBT.stats) — 수수료·양도세(선입선출·이동평균·연말 절세)·세금 없음·분배금 끔·주문 거부·주문 넣는 때
   · ③ 프로젝트 문서 'claude/72루틴-평균CAGR-분포-자료.md' 숫자와 대조 (끝 2026-10-14 · 수수료 0.1% · 양도세 선입선출 · 원금 $100,000)
       매월 첫 거래일 표본(§10): 보유 ≥ 1년 188곳 평균 45.13% · p10 33.69% · 중앙 44.30% · p90 58.44% · 최저 23.80% · 최고 78.82%  (±0.3%p — 시세 자료가 나중에 분할 등으로 다시 맞춰져도 견디게)
       --full: 모든 시작일 4,154곳(§3·§5·§5-2) — 보유 ≥ 1년 3,923곳 평균 45.27% · 중앙 44.30% · 구간별 개수 · MDD 평균 −51.7% (약 15초)
   · ④ 나눠 실행(job): 표본 먼저 → 모든 시작일 · 쉼 · 멈춤 · 오류 / 보관(cache): 새 계산을 넣으면 끝나지 않은 다른 계산은 멈춤
   · ⑤ 화면 문자열: 탭 4개 · 숫자 없음/오류 안내 · 글자 이스케이프 · NaN·undefined 없음 · 무한매수법 용어 없음
   실패가 있으면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
function grab(name, endMark) { const a = src.indexOf('var ' + name + ' = (function'), b = src.indexOf(endMark, a); if (a < 0 || b < 0) throw new Error(name + ' 없음'); return src.slice(a, b); }
const MHE = new Function(grab('MHE', "if (typeof module !== 'undefined') module.exports = MHE;") + '\nreturn MHE;')();
const MHV = new Function('MHE', grab('MHV', "if (typeof module !== 'undefined') module.exports = MHV;") + '\nreturn MHV;')(MHE);
const R72D = new Function(grab('R72D', "if (typeof module !== 'undefined') module.exports = R72D;") + '\nreturn R72D;')();
const mA = src.indexOf('window.MBT = (function () {'), endM = "okOpen: okOpen, withOpen: withOpen, preOpen: preOpen, OPX: OPX };\n})();", mB = src.indexOf(endM, mA);
if (mA < 0 || mB < 0) throw new Error('MBT 없음');
const win = { mdLoad: n => Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n), 'utf8'))) };
new Function('window', src.slice(mA, mB + endM.length))(win);
const MBT = win.MBT, FULL = process.argv.includes('--full');
let ok = 0, bad = 0;
function check(name, cond, info) { if (cond) ok++; else { bad++; console.log('FAIL ' + name + (info !== undefined ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 400) : '')); } }
const near = (a, b, t) => a != null && b != null && Math.abs(a - b) <= t;

function cfg72() {   /* [T72] lock 과 같은 설정 (vcfg) */
  const c = MHV.defaults('1.0', 'SOXL');
  Object.assign(c, { splits: 72, target: 52.5, big: 13, lines: 0, shares: MHE.locShares(undefined), exhaust: 'recover', tround: 'r2', avgOff: 0, money: 'compound', restart: 'next', rebase: false, ideal: false });
  return c;
}

(async () => {
  /* ① 순수 함수 */
  check('백분위 = 선형 보간 (엑셀 PERCENTILE · numpy 기본)', R72D.q([1, 2, 3, 4], 0.1) === 1.3 && R72D.q([1, 2, 3, 4], 0.5) === 2.5 && R72D.q([5], 0.9) === 5 && R72D.q([], 0.5) === null, [R72D.q([1, 2, 3, 4], 0.1), R72D.q([1, 2, 3, 4], 0.5)]);
  const H = R72D.hist([0.2, 0.25, 0.2499999999, -0.05, -1e-6, 0, -1e-13, 0.05, 0.15], 5);
  check('5%p 구간: 아래 포함·위 미포함 · 경계값(20·25·0·−5) · 음수 · 부동소수 오차(−1e-13)는 0 구간 · 빈 구간도 이어짐 · 비율 합 1',
    JSON.stringify(H.map(b => [b.lo, b.n])) === JSON.stringify([[-5, 2], [0, 2], [5, 1], [10, 0], [15, 1], [20, 2], [25, 1]]) && Math.abs(H.reduce((a, b) => a + b.p, 0) - 1) < 1e-12, H.map(b => [b.lo, b.n]));
  check('구간: 값 없음 · NaN·null 은 뺌', R72D.hist([], 5).length === 0 && R72D.hist([null, NaN, 0.31], 5).length === 1 && R72D.hist([null, NaN, 0.31], 5)[0].lo === 30);
  const hr = [365, 366, 1095, 1096, 3652, 3653].map(d => ({ days: d }));
  check('보유 기간 필터: 일수 ≥ 365.25 × N (1년 = 366일부터 · 3년 = 1,096일 · 10년 = 3,653일 · 4년 = 정확히 1,461일 포함)', R72D.hold(hr, 1).length === 5 && R72D.hold(hr, 3).length === 3 && R72D.hold(hr, 10).length === 1 && R72D.hold(hr, 0).length === 6 &&
    R72D.hold([{ days: 1460 }, { days: 1461 }], 4).length === 1);
  const S0 = R72D.summ([{ d: 'a', x: 0.1 }, { d: 'b', x: -0.2 }, { d: 'c', x: 0.3 }, { d: 'd', x: null }, { d: 'e', x: 0.3 }], 'x');
  check('요약: 값 있는 것만 · 평균·중앙·최저·최고(같으면 먼저 것) · 양(+) 비율', S0.n === 4 && near(S0.mean, 0.125, 1e-15) && near(S0.med, 0.2, 1e-15) && S0.min === -0.2 && S0.max === 0.3 && S0.lo.d === 'b' && S0.hi.d === 'c' && S0.pos === 0.75 && R72D.summ([], 'x') === null, S0);

  /* 자료 (화면과 같은 규칙: 장중 오늘 일봉 뺌) */
  const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'etfcagr.json'), 'utf8'));
  const D = MBT.fromCagr(J.series.SOXL); if (!D.h) D.h = D.c.slice();
  const F = await MBT.fxData(), fx = MBT.fxFor(D.d, F), cfg = cfg72(), last = D.d.length - 1;
  const pl = R72D.plan(D.d, last);
  const firstOfMonth = pl.first.every((s, i) => s === 1 || D.d[s].slice(0, 7) !== D.d[s - 1].slice(0, 7)) && pl.first.every((s, i) => !i || D.d[s].slice(0, 7) !== D.d[pl.first[i - 1]].slice(0, 7));
  check('시작일 목록: 1 ~ 끝 − 20거래일 · 매월 첫 거래일 먼저(표본) · 빠짐·겹침 없음', pl.n === last - 20 && pl.first[0] === 1 && firstOfMonth &&
    new Set(pl.first.concat(pl.rest)).size === pl.n && Math.max(...pl.first.concat(pl.rest)) === last - 20 && R72D.plan(D.d, 20).n === 0 && R72D.plan(D.d, 21).n === 1, [pl.n, last, pl.first.length]);

  /* ② 시작일 하나 = 카드 계산 (MHV.run → MBT.stats) */
  const base = (o, x) => Object.assign({ fee: o.fee / 100, sec: 0.0000206, divTax: 0.15, norm: 'auto', tax: o.tax ? { fx: i => fx[i], method: o.method || 'fifo', harvest: !!o.harvest } : null }, x || {});
  await MBT.withOpen(D).catch(() => null);   /* 주문 거부·주문 넣는 때는 시가가 필요 (시세 자료에 있으면 그대로) */
  const hasO = !!(D.o && D.o.some(v => v > 0));
  const cases = [['수수료 0.25% · 양도세 선입선출', base({ fee: 0.25, tax: 1 })], ['이동평균 · 연말 절세', base({ fee: 0.1, tax: 1, method: 'avg', harvest: 1 })], ['양도세 없음', base({ fee: 0.25, tax: 0 })],
    ['세금·수수료 없음(미포함 보기)', { fee: 0, sec: 0, divTax: 0, norm: 'auto', tax: null }]].concat(hasO ? [['주문 거부 한도로 낮춰 넣기 + 정규장 시작 전', base({ fee: 0.25, tax: 1 }, { rej: { mode: 'clamp', cap: 1.2 }, fill: 'open' })]] : []);
  const Dnd = Object.assign({}, D, { dv: null });
  const bad2 = [];
  for (const [nm, o] of cases) for (const s of [1, 77, 1500, 3000, pl.n - 300, pl.n]) for (const DD of [D, Dnd]) {
    const r = R72D.one(MHV, cfg, DD, o, s, last, 100000), R = MHV.run(cfg, DD, Object.assign({}, o, { from: s, to: last, capital: 100000, rows: false })), st = MBT.stats(R, DD, 100000);
    const due = MBT.cagr(100000, st.final - st.taxDue, st.days);
    if (!(r.days === st.days && near(r.cagr, st.cagr, 1e-12) && near(r.mdd, st.mdd, 1e-12) && near(r.bh, st.bh.cagr, 1e-12) && near(r.bhMdd, st.bh.mdd, 1e-12) && near(r.due, due, 1e-12) && r.d === D.d[s]))
      bad2.push(nm + ' s=' + s + (DD === Dnd ? ' 분배금 끔' : '') + ' ' + JSON.stringify([r.cagr, st.cagr, r.mdd, st.mdd]));
  }
  /* 짧은 기간(시작 + 25거래일) 50곳 — 첫날 움직임이 MDD·그냥 보유 MDD 에 그대로 들어가는지(기준일 종가는 낙폭 최고점에 넣지 않음 = 카드와 같음) */
  for (let k = 0; k < 50; k++) { const s = 30 + k * 81, t = s + 25, o = cases[0][1], r = R72D.one(MHV, cfg, D, o, s, t, 100000), st = MBT.stats(MHV.run(cfg, D, Object.assign({}, o, { from: s, to: t, capital: 100000, rows: false })), D, 100000);
    if (!(near(r.mdd, st.mdd, 1e-12) && near(r.bhMdd, st.bh.mdd, 1e-12) && near(r.bh, st.bh.cagr, 1e-12) && r.days === st.days)) bad2.push('짧은 기간 s=' + s + ' ' + JSON.stringify([r.bhMdd, st.bh.mdd, r.mdd, st.mdd])); }
  /* SOXL 그냥 보유 세후 = 문서 부록 E(build_dataset.js) 계산 그대로 — 수수료 사고팔 때 · SEC · 양도세 22% × (원화 차익 − 250만 원) · 세금·수수료 없는 보기는 세전과 같음 */
  const bhDoc = (o, s, t) => { const P = 100000, c0 = D.c[s - 1], c1 = D.c[t], days = MBT.dnum(D.d[t]) - MBT.dnum(D.d[s - 1]), sh = P / (1 + (o.fee || 0)) / c0, pr = sh * c1 * (1 - (o.fee || 0) - (o.sec || 0));
    const tax = o.tax ? 0.22 * Math.max(0, pr * fx[t] - P * fx[s - 1] - 2500000) / fx[t] : 0; return Math.pow((pr - tax) / P, 365.25 / days) - 1; };
  for (const [nm, o] of cases) for (const s of [1, 77, 1500, 3000, pl.n - 300, pl.n]) { const r = R72D.one(MHV, cfg, D, o, s, last, 100000);
    if (!near(r.bhN, bhDoc(o, s, last), 1e-12) || (!o.fee && !o.tax && !near(r.bhN, r.bh, 1e-12))) bad2.push('세후 보유 ' + nm + ' s=' + s + ' ' + JSON.stringify([r.bhN, bhDoc(o, s, last), r.bh])); }
  check('MHV.RATE·DED = 양도세 22% · 공제 250만 원 (세후 보유 계산에 씀)', MHV.RATE === 0.22 && MHV.DED === 2500000, [MHV.RATE, MHV.DED]);
  check('시작일 하나 = 화면 백테스트 카드 계산(MHV.run → MBT.stats) · SOXL 그냥 보유 세후 = 문서 부록 E — 짧은 기간 50곳 + ' + cases.length + '가지 조건 × 시작일 6곳 × 분배금 켬/끔' + (hasO ? '' : ' (시가 없어 주문 거부·넣는 때 빼고)'), !bad2.length, bad2.slice(0, 3).join(' | '));

  /* ③ 문서 숫자 대조 — 끝 2026-10-14 · 수수료 0.1% · 양도세 선입선출 · $100,000 */
  const to = D.d.indexOf('2026-10-14');
  if (to < 0) check('문서 대조: 자료에 2026-10-14 가 있음', false);
  else {
    const o = base({ fee: 0.1, tax: 1 }), P2 = R72D.plan(D.d, to);
    const mon = P2.first.map(s => R72D.one(MHV, cfg, D, o, s, to, 100000)), M1 = R72D.summ(R72D.hold(mon, 1), 'cagr'), pp = v => (v * 100).toFixed(2);
    check('문서 §10 매월 첫 거래일 표본(보유 ≥ 1년): 188곳 · 평균 45.13% · p10 33.69% · 중앙 44.30% · p90 58.44% · 최저 23.80% · 최고 78.82% (±0.3%p)',
      P2.n === 4154 && P2.first.length === 199 && M1.n === 188 && [[M1.mean, 0.4513], [M1.p10, 0.3369], [M1.med, 0.4430], [M1.p90, 0.5844], [M1.min, 0.2380], [M1.max, 0.7882]].every(x => near(x[0], x[1], 0.003)),
      [P2.n, P2.first.length, M1.n, pp(M1.mean), pp(M1.p10), pp(M1.med), pp(M1.p90), pp(M1.min), pp(M1.max)]);
    if (FULL) {
      const t0 = Date.now(), all = P2.first.concat(P2.rest).sort((a, b) => a - b).map(s => R72D.one(MHV, cfg, D, o, s, to, 100000)), y1 = R72D.hold(all, 1);
      const S = R72D.summ(y1, 'cagr'), Mx = R72D.summ(y1, 'mdd'), Du = R72D.summ(y1, 'due'), Hs = R72D.hist(y1.map(r => r.cagr), 5).map(b => b.n).join(',');
      check('--full 문서 §3·§4·§5·§5-2 (모든 시작일): ≥1년 3,923곳 · 평균 45.27 · 중앙 44.30 · p10 33.62 · p90 58.49 · 최저 23.15(2021-12-07) · 최고 88.08(2025-02-19) · 미납세 차감 40.96 · MDD 평균 −51.7 · 중앙 −54.2 · 최악 −82.6 · 구간별 개수',
        S.n === 3923 && pp(S.mean) === '45.27' && pp(S.med) === '44.30' && pp(S.p10) === '33.62' && pp(S.p90) === '58.49' && pp(S.min) === '23.15' && S.lo.d === '2021-12-07' && pp(S.max) === '88.08' && S.hi.d === '2025-02-19' &&
        pp(Du.mean) === '40.96' && (Mx.mean * 100).toFixed(1) === '-51.7' && (Mx.med * 100).toFixed(1) === '-54.2' && (Mx.min * 100).toFixed(1) === '-82.6' && Hs === '29,40,650,719,583,678,549,340,197,72,30,21,5,10',
        [S.n, pp(S.mean), pp(S.med), pp(S.p10), pp(S.p90), pp(S.min), S.lo.d, pp(S.max), S.hi.d, pp(Du.mean), pp(Mx.mean), Hs]);
      const Ys = R72D.years(y1, 'cagr');
      check('--full 문서 §6 시작 연도별: 2010 205곳 33.25% · 2021 252곳 45.27% · 2025 196곳 64.85% · MDD 2023 −36.2%', Ys.length === 16 && Ys[0].y === '2010' && Ys[0].n === 205 && pp(Ys[0].s.mean) === '33.25' &&
        Ys[11].n === 252 && pp(Ys[11].s.mean) === '45.27' && Ys[15].n === 196 && pp(Ys[15].s.mean) === '64.85' && (Ys[13].mdd.mean * 100).toFixed(1) === '-36.2', Ys.map(y => y.y + ':' + y.n + ':' + pp(y.s.mean)).join(' '));
      const N9 = y => { const a = R72D.hold(all, y), b = R72D.summ(a, 'bhN'), w = a.filter(r => r.due > r.bhN).length / a.length; return [a.length, pp(b.mean), (b.med * 100).toFixed(1), Math.round(w * 100)]; };
      const n1 = N9(1), n3 = N9(3), n10 = N9(10);
      check('--full 문서 §9 SOXL 그냥 보유 세후: ≥1년 평균 46.37%(중앙 38.7%) · 72루틴(미납세 차감)이 더 높은 시작일 48% · ≥3년 37.83% · 53% · ≥10년 40.25% · 23%',
        n1.join() === '3923,46.37,38.7,48' && n3[1] === '37.83' && n3[3] === 53 && n10[1] === '40.25' && n10[3] === 23, [n1, n3, n10]);
      console.log('  --full 모든 시작일 ' + all.length + '곳 ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
    }
  }

  /* ④ 나눠 실행 · 보관 */
  const fake = { first: [1, 5, 9], rest: [2, 3, 4, 6, 7, 8], n: 9 }, mk = s => ({ s, d: '2020-01-' + String(s).padStart(2, '0'), days: 400 + s, cagr: s / 100, due: s / 200, mdd: -s / 50, bh: s / 80, bhN: s / 150, bhMdd: -0.5 });   /* bhN: cagr(s/100) 보다는 낮고 due(s/200) 보다는 높게 — 비교 기준이 due 인지 확인 */
  const ev = [], st1 = await new Promise(res => { const st = R72D.job({ plan: fake, run: s => mk(s), budget: 1e9, update: (s, full) => { if (full) { ev.push(s.stage + ':' + (s.first ? s.first.length : 0)); if (s.stage === 'done') res(s); } } }); });
  check('나눠 실행: 표본(매월 첫 거래일 3곳) → 모든 시작일 9곳 · 끝나면 시작일 순서 · 단계마다 다시 그리기', ev.join() === 'more:3,done:3' && st1.rows.map(r => r.s).join() === '1,2,3,4,5,6,7,8,9' && st1.first.map(r => r.s).join() === '1,5,9' && st1.n === 9, ev);
  let pz = 3, runs = 0; const st2 = await new Promise(res => { const st = R72D.job({ plan: fake, run: s => { runs++; return mk(s); }, paused: () => pz-- > 0, budget: 1e9, update: (s, f) => { if (s.stage === 'done') res(s); } }); });
  check('쉼(paused) 뒤 이어서 끝까지', st2.stage === 'done' && runs === 9 && pz < 0);
  const st3 = R72D.job({ plan: fake, run: s => { if (s === 6) throw new Error('<b>x</b>'); return mk(s); }, budget: 0.0001, update: () => {} });
  await new Promise(r => setTimeout(r, 300));
  check('계산 오류 → stage err · 메시지', st3.stage === 'err' && st3.err === '<b>x</b>', st3.stage);
  let n4 = 0; const st4 = R72D.job({ plan: fake, run: s => { n4++; return mk(s); }, budget: 0.0001, update: () => {} }); st4.cancel();
  await new Promise(r => setTimeout(r, 200));
  check('멈춤(cancel) → 더 계산하지 않음', n4 <= 1 && st4.stage !== 'done', n4);
  const st5 = R72D.job({ plan: { first: [], rest: [], n: 0 }, run: mk, update: () => {} });
  await new Promise(r => setTimeout(r, 50));
  check('시작일 없음 → stage empty', st5.stage === 'empty');
  const C = R72D.cache(2), a1 = R72D.job({ plan: fake, run: mk, budget: 0.0001, update: () => {} }), done1 = st1;
  C.put('d', done1); C.put('a', a1); const a2 = R72D.job({ plan: fake, run: mk, budget: 0.0001, update: () => {} }); C.put('b', a2);
  check('보관: 새 계산을 넣으면 끝나지 않은 다른 계산은 멈추고 버림 · 끝난 것은 남김(최근 2개)', a1.dead && !C.get('a') && C.get('d') === done1 && C.get('b') === a2 && !a2.dead);
  a2.cancel();

  /* ⑤ 화면 문자열 */
  const m = { id: 'r7d-box', end: '2026-10-14', first: '2010-03-12', set: '원금 $100,000 · 수수료 0.1% <x>', net: true, tax: true, act: 'r7d' }, BADW = /라오어|무한매수|T값|별지점|큰수|NaN|undefined|Infinity/;
  const full = { stage: 'done', rows: st1.rows, first: st1.first, n: 9, nf: 3, i: 9 };
  const tabs = ['cagr', 'mdd', 'line', 'year'].map(t => R72D.html(full, m, { hold: 1, tab: t, due: false }));
  const winTile = (h => { const i = h.indexOf('72루틴이 더 높았던 시작일'); return i < 0 ? '' : h.slice(i, i + 160); })(tabs[0]);
  check('화면: SOXL 그냥 보유 세후(평균) · 세전 함께 · 72루틴(미납세 뺀 값)이 더 높았던 시작일 비율 칸 (가짜 9곳: due s/200 < bhN s/150 < cagr s/100 → 미납세 뺀 값 기준이면 0%)', /SOXL 그냥 보유 \(세후\)/.test(tabs[0]) && /세전 평균/.test(tabs[0]) && /<b>0%<\/b>/.test(winTile) && /0 \/ 9곳/.test(winTile) &&
    /세후\(세전\)/.test(tabs[3]) && !/SOXL 그냥 보유 \(세후\)/.test(R72D.html(full, Object.assign({}, m, { net: false }), { hold: 1, tab: 'cagr' })), winTile);
  check('화면: 탭 4개 모두 그림 · 숫자 칸 7개 · 설정 문구 이스케이프 · NaN/undefined/무한매수법 용어 없음', tabs.every(h => /class="r7d-kv"/.test(h) && (h.match(/class="r7d-k"/g) || []).length === 7 && h.includes('&lt;x&gt;') && !BADW.test(h)) &&
    /r7d-hist up/.test(tabs[0]) && /r7d-hist dn/.test(tabs[1]) && /r7d-ln/.test(tabs[2]) && /r7d-t/.test(tabs[3]), tabs.map(h => (h.match(BADW) || [''])[0]));
  check('화면: 선택된 단추 aria-pressed · 미납세 토글은 세금 포함 보기에서만', /data-r7d="hold" data-v="1" data-act="r7d" aria-pressed="true"/.test(tabs[0]) && /data-r7d="due"/.test(tabs[0]) && !/data-r7d="due"/.test(R72D.html(full, Object.assign({}, m, { net: false }), { hold: 1, tab: 'cagr' })));
  check('화면: 보유 기간 조건에 맞는 시작일 없음 → 안내', /보유 10년 이상인 시작일이 없어요/.test(R72D.html(full, m, { hold: 10, tab: 'cagr' })));
  check('화면: 계산 중(표본 전) → 진행 막대만 · 표본 단계 → 진행 막대 + 표본 숫자', /r7d-pg/.test(R72D.html({ stage: 'run', rows: [], first: null, n: 9, nf: 3, i: 1 }, m, { hold: 1, tab: 'cagr' })) && !/r7d-kv/.test(R72D.html({ stage: 'run', rows: [], first: null, n: 9, nf: 3, i: 1 }, m, { hold: 1, tab: 'cagr' })) &&
    /정밀 계산 중/.test(R72D.html({ stage: 'more', rows: [], first: st1.first, n: 9, nf: 3, i: 5 }, m, { hold: 1, tab: 'cagr' })) && /\(표본\)/.test(R72D.html({ stage: 'more', rows: [], first: st1.first, n: 9, nf: 3, i: 5 }, m, { hold: 1, tab: 'cagr' })));
  check('화면: 오류 글자 이스케이프 · 시작일 없음 안내', R72D.html({ stage: 'err', err: '<img>' }, m, { hold: 1 }).includes('&lt;img&gt;') && /시작일이 없어요/.test(R72D.html({ stage: 'empty' }, m, { hold: 1 })));
  check('화면: 한계 문구(같은 자료로 고른 설정 · 시작일이 겹침 · 끝 날짜 · 수익 약속 아님)', /같은 기간 자료를 보고 고른 설정/.test(tabs[0]) && /독립된 시험이 아니에요/.test(tabs[0]) && /끝 날짜 하루의 종가/.test(tabs[0]) && /수익을 약속하지 않아요/.test(tabs[0]));

  console.log((bad ? 'FAIL ' : '') + 'r72dist: ' + ok + '개 통과 · ' + bad + '개 실패' + (FULL ? ' (--full)' : ''));
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL r72dist 오류: ' + (e && e.stack || e)); process.exit(1); });
