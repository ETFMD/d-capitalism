/* 밸류리밸런싱 VR 5.0 백테스트 엔진(VRE.run · summary · xirr · 체결 규칙) 검사 — node tests/vr_bt_test.js  (run_regression.py 가 자동 실행)
   · src/index.html 의 [VR-ENGINE](VRE) 를 그대로 꺼내 씀 (브라우저와 같은 코드)
   · ① 가이드북 3-2·기록 화면 엔진과 같은 결과: 수정주가 그대로 · 10거래일 · 세금·수수료 없음이면 VRE.backtest(공식 사다리)·VRE.simple(라오어 공개 방식)과 날마다 같은 평가금
   · ② 라오어 공개 거치식 백테스트(2011~2020 · ±15%)를 단순 모델로 재현 (G 10~100 연평균 차이 0.3%p 이내)
   · ③ 사이클마다 체결된 매수·매도 가격 = 그 사이클 매수표·매도표(VRE.buyTable·sellTable)의 앞부분 · Pool 한도에서 멈춘 자리도 표와 같음
   · ④ 현금 흐름 맞추기 · 평가금 = 보유 × 가격 + Pool · 시간가중 지수 · XIRR · 양도소득세(선입선출 독립 계산) · 연말 절세 · 인출 부족 · 적립식→거치식 전환 · G 키우기
   · ⑤ 가격 단위(분할·병합 흉내) · 달력 2주 사이클
   · ⑥ 체결 규칙: 시가·고가·저가가 다 있으면 min(매수점, 시가)·max(매도점, 시가) · 없는 날은 종가로 판단 (VRE.backtest 도 같음)
   실패가 있으면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const a0 = src.indexOf('var VRE = (function'), b0 = src.indexOf("if (typeof module !== 'undefined') module.exports = VRE;", a0);
if (a0 < 0 || b0 < 0) throw new Error('VRE 없음');
const VRE = new Function(src.slice(a0, b0) + '\nreturn VRE;')();
const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'etfcagr.json'), 'utf8'));
function series(tk, m) {
  const s = J.series[tk], n = s.c.length, d = [], idx = {}; let x = s.d0;
  for (let i = 0; i < n; i++) { if (i) x += s.dd[i - 1]; d.push(new Date(x * 864e5).toISOString().slice(0, 10)); idx[x] = i; }
  const dv = new Array(n).fill(0); (s.div || []).forEach(e => { if (idx[e[0]] != null) dv[idx[e[0]]] += e[1]; });
  const r = m ? v => Math.round(v * m * 100) / 100 : v => v;
  return { d, c: s.c.map(r), h: s.h.map((v, k) => Math.max(r(v), r(s.c[k]))), l: s.l.map((v, k) => Math.min(r(v), r(s.c[k]))), dv };
}
let ok = 0, bad = 0;
function check(name, cond, info) { if (cond) ok++; else { bad++; console.log('FAIL ' + name + (info ? ' — ' + info : '')); } }
const TQ = series('TQQQ'), SX = series('SOXL'), r2 = VRE.r2;
const idxGE = (D, s) => { for (let i = 0; i < D.d.length; i++) if (D.d[i] >= s) return i; return D.d.length; };
const idxLE = (D, s) => { for (let i = D.d.length - 1; i >= 0; i--) if (D.d[i] <= s) return i; return -1; };

/* ① 기존 엔진과 같은 결과 (센트 가격 · 분배금 없음 · 첫날 체결 없음) */
for (const tk of ['TQQQ', 'SOXL']) for (const m of [100, 300]) {
  const D = series(tk, m); D.dv = null;
  const days = D.d.map((x, i) => ({ date: x, c: D.c[i], h: D.h[i], l: D.l[i] })), p0 = D.c[0];
  for (const G of [5, 10, 20, 40]) for (const type of ['hold', 'acc', 'wd']) for (const b of [0.1, 0.15]) {
    const n = Math.floor(10000 / p0), V0 = r2(n * p0), lim = VRE.TYPES[type].limit, amt = type === 'acc' ? 250 : type === 'wd' ? 40 : 0;
    const A = VRE.backtest({ type, G, band: b, V0, P0: 0, amt, limit: lim }, days);
    const B = VRE.run({ type, G, band: b, limit: lim, amt, mode: 'ladder', cycle: 'td', pool0: 0 }, D, { from: 0, capital: V0, norm: 'none' });
    let md = 0; for (let i = 0; i < A.eq.length; i++) md = Math.max(md, Math.abs(A.eq[i] - B.eq[i]) / A.eq[i]);
    check('공식 사다리 = VRE.backtest ' + [tk, m, G, type, b].join(' '), A.eq.length === B.eq.length && md < 1e-12 && A.buys === B.buys - B.cycles[0].init && A.sells === B.sells && A.n === B.n && A.cycles === B.cycles.length,
      [md, A.buys, B.buys - B.cycles[0].init, A.sells, B.sells, A.n, B.n].join(' '));
    if (type === 'hold') {
      const S1 = VRE.simple({ G, band: b, V0 }, days), S2 = VRE.run({ type: 'hold', G, band: b, mode: 'simple', cycle: 'td', pool0: 0 }, D, { from: 0, capital: V0, norm: 'none' });
      let md2 = 0; for (let i = 0; i < S1.eq.length; i++) md2 = Math.max(md2, Math.abs(S1.eq[i] - S2.eq[i]) / S1.eq[i]);
      check('단순 모델 = VRE.simple ' + [tk, m, G, b].join(' '), md2 < 1e-12, md2);
    }
  }
}

/* ② 라오어 공개 거치식 백테스트 (2011~2020 · ±15% · 원문 표) — 단순 모델 재현 */
{ const LAOER = { 10: 49.47, 20: 46.16, 30: 44.12, 40: 41.86, 50: 39.64, 100: 34.06 }, D = Object.assign({}, TQ, { dv: null });
  const f = idxGE(D, '2011-01-01'), t = idxLE(D, '2020-12-31'), out = [];
  Object.keys(LAOER).forEach(G => { const R = VRE.run({ type: 'hold', G: +G, band: 0.15, mode: 'simple', cycle: 'td', pool0: 0 }, D, { from: f, to: t, capital: 10000, norm: 'none', rows: false });
    const S = VRE.summary(R, D, 10000); out.push([G, +(S.cagr * 100).toFixed(2), LAOER[G]]); });
  check('라오어 공개 수치 재현 (G 10~100 · 0.3%p 이내)', out.every(x => Math.abs(x[1] - x[2]) <= 0.3), JSON.stringify(out)); }

/* ③~④ 실제 일봉 · 여러 설정: 매수표·매도표 · 현금 흐름 · 평가금 · 시간가중 · 세금 */
const fx = D => D.d.map(d => 1100 + 300 * Math.sin(Date.parse(d) / 864e5 / 400));   /* 시험용 원/달러 (날마다 다름) */
function fifoGain(D, R, o) {   /* 양도소득세 독립 계산 — 날마다 표의 매수·매도·세금 매도로 (같은 날 산 것은 한 묶음 · 결제일 기준 연도 · 결제일 환율) */
  const N = D.d.length, F = o.tax.fx, set = i => i + (D.d[i] < '2024-05-28' ? 2 : 1);
  const yr = i => { const j = set(i); if (j < N) return +D.d[j].slice(0, 4); let t = new Date(D.d[N - 1] + 'T12:00:00Z'), m = j - (N - 1); while (m > 0) { t.setUTCDate(t.getUTCDate() + 1); if (t.getUTCDay() % 6) m--; } return t.getUTCFullYear(); };
  const fxA = i => F(Math.min(N - 1, set(i)));
  const lots = [], g = {}, fee = o.fee, sec = o.sec;
  const sell = (i, q, usd) => { let w = usd * fxA(i), base = 0, need = q; while (need > 1e-9 && lots.length) { const L = lots[0], tk = Math.min(need, L[0]); base += tk * L[1]; L[0] -= tk; need -= tk; if (L[0] <= 1e-9) lots.shift(); } g[yr(i)] = (g[yr(i)] || 0) + w - base; };
  R.rows.forEach((r, j) => { const cc = D.c[r.i] * r.k;
    if (r.split > 0) lots.forEach(L => { L[0] *= r.split; L[1] /= r.split; });                         /* 2:1 분할 흉내 — 단위 수 × f · 단가 ÷ f */
    if (r.split < 0) { if (r.rest) sell(r.i - 1, r.rest, r.restCash); lots.forEach(L => { L[0] /= -r.split; L[1] *= -r.split; }); }   /* 10:1 병합 — 끝수는 전날 종가로 판 것 */
    if (r.bq) lots.push([r.bq, r.ba * (1 + fee) * fxA(r.i) / r.bq]);
    if (r.sq) sell(r.i, r.sq, r.sa * (1 - fee - sec));
    if (r.ts) sell(r.i, r.ts, r.ts * cc * (1 - fee - sec)); });
  return g;
}
const CFG = [];
for (const type of ['acc', 'hold', 'wd']) for (const G of [10, 20]) for (const cycle of ['cal', 'td']) for (const norm of ['auto', 'none']) for (const pool0 of [0, 0.2])
  CFG.push({ c: { type, G, band: 0.15, limit: VRE.TYPES[type].limit, amt: type === 'acc' ? 250 : type === 'wd' ? 60 : 0, mode: 'ladder', cycle, pool0 }, norm });
let nTable = 0, nCyc = 0;
for (const [tk, D0] of [['TQQQ', TQ], ['SOXL', SX]]) {
  const D = Object.assign({}, D0), F = fx(D);
  CFG.forEach((x, ci) => {
    const fee = ci % 3 === 0 ? 0 : 0.0025, sec = fee ? 0.0000206 : 0, name = tk + ' ' + JSON.stringify(x.c) + ' ' + x.norm + ' fee ' + fee;
    const o = { from: ci % 4 === 0 ? 0 : idxGE(D, '2014-03-03'), capital: 10000 + ci * 137, fee, sec, divTax: fee ? 0.15 : 0, norm: x.norm, trace: true,
                tax: fee ? { fx: i => F[i], method: 'fifo', harvest: false } : null };
    const R = VRE.run(x.c, D, o), S = VRE.summary(R, D, o.capital);
    /* ③ 사이클마다 매수·매도 가격 = 매수표·매도표 앞부분 · 한도에서 멈췄으면 표도 거기서 끝 */
    let tb = true, info = '';
    R.cycles.forEach(c => { nCyc++;
      const bt = VRE.buyTable(c.min, c.n0, c.pool0, c.L, c.bpx.length + 1).map(r => r.price), st = VRE.sellTable(c.max, c.n0, c.pool0, c.spx.length + 1).map(r => r.price).slice(0, c.spx.length);
      if (JSON.stringify(bt.slice(0, c.bpx.length)) !== JSON.stringify(c.bpx) || JSON.stringify(st) !== JSON.stringify(c.spx)) { tb = false; info = info || c.no + ': ' + c.bpx.slice(0, 4) + ' / ' + bt.slice(0, 4); }
      if (c.limHit && bt.length > c.bpx.length && !c.dry) { tb = false; info = info || c.no + ' 한도 ' + bt.length + ' > ' + c.bpx.length; }
      nTable += c.bpx.length + c.spx.length; });
    check('매수표·매도표 = 체결 ' + name, tb, info);
    /* ④ 평가금 = 보유 × 가격 + Pool − 밖에서 낸 세금 · 정수 보유 · Pool ≥ 0 */
    let ext = 0, okq = true, okp = true; R.rows.forEach(r => { const e = r.q * D.c[r.i] * r.k + r.pool; if (Math.abs(r.eq - e) > 1e-6 + R.taxExt + 1e-9) okq = false; if (r.q !== Math.floor(r.q) || r.pool < -0.005) okp = false; });
    check('평가금 = 보유 × 가격 + Pool ' + name, okq && Math.abs(R.final - (R.n * D.c[R.to] * R.k + R.pool[R.pool.length - 1] - R.taxExt)) < 1e-6);
    check('정수 보유 · Pool ≥ 0 ' + name, okp);
    /* 현금 흐름 맞추기 (세금 없을 때): Pool 끝 − 처음 = 매도 − 매수(수수료 포함) + 분배금 + 적립 − 인출 (± 센트 반올림) */
    if (!o.tax) {
      const r0 = R.rows[0], pool0 = r0.pool - (r0.dv || 0);
      let sum = 0, ops = 0; R.rows.forEach((r, j) => { const ba = j ? r.ba : 0; sum += -ba * (1 + fee) + r.sa * (1 - fee - sec) + (j ? r.dv : 0) + r.flow; ops += (j ? r.bq : 0) + r.sq + (r.dv ? 1 : 0) + (r.flow ? 1 : 0); });
      const diff = R.pool[R.pool.length - 1] - pool0 - sum;
      check('현금 흐름 맞추기 ' + name, R.rs > 0 || Math.abs(diff) <= 0.005 * ops + 1e-6, diff.toFixed(4) + ' (ops ' + ops + ')');
    }
    /* 시간가중 지수: 흐름 없으면 평가금 ÷ 원금 · 있으면 전날 지수로 단위 사고팜 (독립 계산) */
    let u = o.capital, okn = true; R.rows.forEach((r, j) => { if (r.flow) u += r.flow / (R.eq[j - 1] / u); if (Math.abs(R.nav[j] - R.eq[j] / u) > 1e-12 * Math.max(1, R.nav[j])) okn = false; });
    check('시간가중 지수 ' + name, okn);
    if (!R.flows.length) check('흐름 없으면 IRR = CAGR ' + name, Math.abs(S.irr - S.cagr) < 1e-12);
    /* 양도소득세 — 선입선출 독립 계산과 같은 연도별 양도차익 */
    if (o.tax) {
      const g = fifoGain(D, R, o), bad2 = R.taxes.filter(t => Math.abs((g[t.y] || 0) - t.gain) > 1 + 1e-9 * Math.abs(t.gain));
      check('양도차익 (선입선출 독립 계산) ' + name, !bad2.length, JSON.stringify(bad2.slice(0, 2).map(t => [t.y, t.gain, g[t.y]])));
      check('양도세 = (차익 − 250만) × 22% ' + name, R.taxes.every(t => Math.abs(t.tax - Math.max(0, t.gain - 2500000) * 0.22) < 1e-6));
      check('세금 낸 날 = 다음 해 5월 31일 이후 첫 거래일 ' + name, R.taxes.every(t => t.paid == null || t.paid === '-' || (t.paid >= (t.y + 1) + '-05-31' && D.d[D.d.indexOf(t.paid) - 1] < (t.y + 1) + '-05-31')));
    }
    /* 인출 부족 · 적립 합계 */
    const flowSum = R.flows.reduce((s, f) => s + f[1], 0);
    check('적립 − 인출 합계 ' + name, Math.abs(flowSum - (R.contrib - R.withdraw)) < 1e-6);
  });
}
check('매수표·매도표 비교 수 (충분히 많이)', nTable > 5000 && nCyc > 5000, nTable + ' / ' + nCyc);

/* XIRR · 요약 */
{ const r = VRE.xirr([[0, -100], [730, 121]]), want = Math.pow(1.21, 365.25 / 730) - 1;
  check('XIRR 2년 21%', Math.abs(r - want) < 1e-9, r + ' vs ' + want);
  const fl = [[0, -1000]]; for (let m = 1; m <= 24; m++) fl.push([m * 30, -100]); fl.push([750, 4200]);
  const x = VRE.xirr(fl), npv = fl.reduce((s, f) => s + f[1] * Math.pow(1 + x, -(f[0]) / 365.25), 0);
  check('XIRR 매달 적립 — 현재가치 0', Math.abs(npv) < 1e-6, npv);
  check('XIRR 흐름 1개면 없음', VRE.xirr([[0, -1]]) === null); }

/* 인출식: Pool 이 모자라면 있는 만큼만 · 부족 기록 */
{ const R = VRE.run({ type: 'wd', G: 20, band: 0.15, limit: 0.25, amt: 2000, mode: 'ladder', cycle: 'cal', pool0: 0.1 }, TQ, { from: idxGE(TQ, '2021-06-01'), capital: 10000, norm: 'auto' });
  const after = R.rows.filter(r => R.dead != null && r.i >= R.dead);
  check('인출식 부족: Pool 이 모자란 사이클을 세고 Pool·V 는 0 아래로 안 감 · V 가 0 이하가 되면 그날부터 멈춤', R.short > 0 && R.shortAmt > 0 && R.pool.every(p => p >= -0.005) && R.V.every(v => v > 0) && R.flows.every(f => f[1] < 0)
    && R.dead != null && after.length > 0 && after.every(r => !r.flow && !r.bq && !r.sq), [R.short, R.shortAmt, R.dead].join(' '));
  const R2 = VRE.run({ type: 'wd', G: 20, band: 0.15, limit: 0.25, amt: 30, mode: 'ladder', cycle: 'cal', pool0: 0.2 }, TQ, { from: idxGE(TQ, '2016-01-04'), capital: 10000, norm: 'auto' });
  check('인출식 보통 금액: 멈추지 않음 · 인출 합계 = 사이클 수 × 금액 − 부족분', R2.dead == null && Math.abs(R2.withdraw - (30 * (R2.cycles.length - 1) - R2.shortAmt)) < 1e-6, [R2.withdraw, R2.cycles.length, R2.shortAmt].join(' ')); }

/* 적립식 → 거치식 전환 (총자산 ≥ 적립금 × 배수) · G 해마다 키우기 */
{ const D = TQ, f = idxGE(D, '2012-01-03'), cfg = { type: 'acc', G: 10, band: 0.15, limit: 0.75, amt: 250, mode: 'ladder', cycle: 'cal', pool0: 0, toHold: 60, gStep: 1 };
  const R = VRE.run(cfg, D, { from: f, capital: 5000, norm: 'auto' }), sw = R.switchAt, cs = R.cycles;
  const before = cs.filter(c => c.from < sw && c.no > 1), after = cs.filter(c => c.from >= sw);
  const prev = R.rows[R.rows.findIndex(r => r.i === sw) - 1];
  check('적립식 → 거치식 전환: 전환 사이클부터 적립 없음 · 한도 50% · 전환 직전 총자산 ≥ 적립금 × 60', sw != null && before.every(c => c.flow === 250 && c.type === 'acc') && after.every(c => c.flow === 0 && c.type === 'hold' && c.lim === 0.5) && prev.E + prev.pool >= 250 * 60 && R.type === 'hold',
    [sw && D.d[sw], before.length, after.length].join(' '));
  const t0 = VRE.dnum(D.d[f]);
  check('G 해마다 +1 (원문 1년마다 /11 /12)', cs.every(c => c.no === 1 || c.G === 10 + Math.floor((VRE.dnum(D.d[c.from]) - t0) / 365.25 + 1e-9)) && cs[cs.length - 1].G >= 20, cs[cs.length - 1].G);
  const prevE = r => r.E + r.pool;
  check('전환 전 사이클 첫날 총자산 < 적립금 × 60', before.every(c => { const j = R.rows.findIndex(r => r.i === c.from); return prevE(R.rows[j - 1]) < 250 * 60; })); }

/* 달력 2주 사이클: 시작일 + 14일 × m 이상인 첫 거래일 */
{ const f = idxGE(TQ, '2015-01-02'), R = VRE.run({ type: 'hold', G: 10, band: 0.15, limit: 0.5, mode: 'ladder', cycle: 'cal' }, TQ, { from: f, capital: 10000, norm: 'auto', rows: false });
  const t0 = VRE.dnum(TQ.d[f]), dn = TQ.d.map(VRE.dnum);
  check('달력 2주 사이클 첫날', R.cycles.every((c, m) => m === 0 ? c.from === f : dn[c.from] >= t0 + 14 * m && dn[c.from - 1] < t0 + 14 * m), R.cycles.length);
  const R2 = VRE.run({ type: 'hold', G: 10, band: 0.15, limit: 0.5, mode: 'simple', cycle: 'cal' }, TQ, { from: f, capital: 10000, norm: 'auto' });
  check('단순 모델은 사이클 첫날에만 사고팜', R2.rows.every(r => (!r.bq && !r.sq) || r.st || r.first)); }

/* 연말 절세 매도·재매수: 보유·사이클 그대로 · 낸 세금 ≤ 안 했을 때 */
{ const F = fx(TQ), f = idxGE(TQ, '2015-01-02'), cfg = { type: 'hold', G: 10, band: 0.15, limit: 0.5, mode: 'ladder', cycle: 'cal' };
  const o = h => ({ from: f, capital: 50000, fee: 0.0007, sec: 0.0000206, divTax: 0.15, norm: 'auto', tax: { fx: i => F[i], method: 'fifo', harvest: h } });
  const A = VRE.run(cfg, TQ, o(false)), B = VRE.run(cfg, TQ, o(true));
  check('연말 절세: 실행됨 · 낸 세금 줄어듦', B.rows.some(r => r.hv > 0) && B.taxPaid < A.taxPaid, [A.taxPaid, B.taxPaid].map(x => x.toFixed(0)).join(' → '));
  const Am = VRE.run(cfg, TQ, Object.assign(o(false), { tax: { fx: i => F[i], method: 'avg', harvest: false } }));
  check('이동평균도 계산됨 (선입선출과 다른 연도별 차익)', Am.taxes.length === A.taxes.length && Am.taxes.some((t, j) => Math.abs(t.gain - A.taxes[j].gain) > 1)); }

/* ⑤ 가격 단위 (분할·병합 흉내): 큰 상승·폭락 합성 일봉 */
{ const d = [], c = [], h = [], l = []; let t = Date.parse('2001-01-02T00:00:00Z'), p = 40;
  for (let i = 0; i < 2600; i++) { const g = i < 900 ? 0.005 : i < 1500 ? -0.018 : 0.004; p *= Math.exp(g + 0.03 * Math.sin(i * 1.7)); d.push(new Date(t).toISOString().slice(0, 10)); c.push(r2(Math.max(0.01, p))); h.push(r2(Math.max(0.01, p * 1.02))); l.push(r2(Math.max(0.01, p * 0.98))); t += (new Date(t).getUTCDay() === 5 ? 3 : 1) * 864e5; }
  const sc = m => ({ d, c: c.map(x => x * m), h: h.map(x => x * m), l: l.map(x => x * m), dv: null }), cfg = { type: 'hold', G: 10, band: 0.15, limit: 0.5, mode: 'ladder', cycle: 'cal' };
  const D = sc(1000), A = VRE.run(cfg, D, { from: 0, capital: 10000, norm: 'auto' }), A2 = VRE.run(cfg, sc(10000), { from: 0, capital: 10000, norm: 'auto' });
  const starts = A.rows.filter(r => r.st), units = starts.map(r => D.c[r.i - 1] * r.k);
  check('분할(2:1)·병합(10:1) 흉내가 일어남', A.sp > 0 && A.rs > 0 && A.rows.some(r => r.rest > 0), [A.sp, A.rs].join(' '));
  check('사이클 첫날 1주 가격 $5~$200 (바꾼 뒤)', units.every(u => u >= 5 - 1e-9 && u <= 200 + 1e-9), Math.min.apply(null, units) + ' ~ ' + Math.max.apply(null, units));
  const SA = VRE.summary(A, D, 10000), SA2 = VRE.summary(A2, sc(10000), 10000);
  check('가격 수준이 달라도 같은 결과 (첫날 1주 = $50 로 맞춤)', Math.abs(SA.cagr - SA2.cagr) < 1e-9 && A.buys === A2.buys && A.sells === A2.sells, [SA.cagr, SA2.cagr].join(' vs '));
  let cont = true, nck = 0; A.rows.forEach((r, j) => { if (j && r.split && r.bq + r.sq === 0) { const prev = A.rows[j - 1], v0 = prev.q * D.c[r.i - 1] * prev.k + prev.pool, v1 = r.q * D.c[r.i - 1] * r.k + r.pool - r.dv; nck++; if (Math.abs(v0 - v1) > 0.01) cont = false; } });
  check('분할·병합한 날 가치 그대로 (거래 없는 날 ' + nck + '번)', cont && nck > 0); }

/* ⑥ 체결 규칙 — 시가·고가·저가가 다 있는 날: 저가 ≤ 매수점이면 min(매수점, 시가) · 고가 ≥ 매도점이면 max(매도점, 시가) (시가는 저가~고가 안으로 맞춤)
      없는 날(시가 null): 종가로 판단 — 종가 ≤ 매수점이면 종가에 매수 · 종가 ≥ 매도점이면 종가에 매도
   합성 일봉(밤사이 갭이 잦음 · 시가가 빠진 날 · 저가~고가 밖 시가가 섞임)으로, 날마다 체결 가격을 매수표·매도표 가격과 그날 값으로 다시 계산해 맞춤 */
{ const d = [], c = [], h = [], l = [], o = [], ct = x => Math.round(x * 100) / 100; let t = Date.parse('2004-01-02T00:00:00Z'), p = 50;   /* 센트 가격 · 첫날 종가 $50 (VRE.backtest 첫 매수 개수가 딱 맞게) */
  for (let i = 0; i < 3200; i++) {
    const gap = i ? 0.05 * Math.sin(i * 2.3) * Math.sin(i * 0.77) : 0, op = ct(p * Math.exp(gap)), cl = i ? ct(op * Math.exp(0.03 * Math.sin(i * 1.3 + 0.4) + 0.012 * Math.sin(i * 0.011))) : 50;
    const hi = ct(Math.max(op, cl) * (1 + 0.012 * Math.abs(Math.sin(i * 0.9)))), lo = ct(Math.min(op, cl) * (1 - 0.012 * Math.abs(Math.cos(i * 1.1))));
    d.push(new Date(t).toISOString().slice(0, 10)); c.push(cl); h.push(i ? Math.max(hi, op, cl) : 60); l.push(i ? Math.min(lo, op, cl) : 40);   /* 첫날 범위를 넓게 — 첫날 사다리 체결이 있으면 드러나게 */
    o.push(i % 11 === 5 ? null : i % 13 === 7 ? ct(lo * 0.97) : i % 17 === 3 ? ct(hi * 1.03) : op);   /* 시가 없는 날 · 저가 아래 · 고가 위 (엔진이 안으로 맞춤) */
    p = cl; t += (new Date(t).getUTCDay() === 5 ? 3 : 1) * 864e5;
  }
  const DO = { d, c, h, l, o, dv: null }, DC = Object.assign({}, DO, { o: null });
  let nFill = 0, nGapB = 0, nGapS = 0, nClose = 0, nClamp = 0;
  const verify = (D, R, name, fee, sec) => {
    let okF = true, info = '', okM = true, infoM = '', nMiss = 0;
    const ptr = {}; R.cycles.forEach(cy => { ptr[cy.no] = [0, 0, cy, 0]; });
    R.rows.forEach((r, j) => {
      if (!j) return;
      const P = ptr[r.n], cy = P[2], i = r.i, k = r.k, io = !!(D.o && D.o[i] > 0);
      const op = (io ? Math.min(Math.max(D.o[i], D.l[i]), D.h[i]) : D.c[i]) * k, lo = (io ? D.l[i] : D.c[i]) * k, hi = (io ? D.h[i] : D.c[i]) * k;
      let sb = 0, ss = 0;
      for (let q = 0; q < r.bq; q++) { const bp = cy.bpx[P[0]], fp = cy.fpx[P[0]]; P[0]++; sb += fp; nFill++;
        const want = Math.min(bp, op); if (Math.abs(fp - want) > 1e-9 * Math.max(1, want) || lo > bp + 1e-9) { okF = false; info = info || [D.d[i], 'B', bp, fp, want, lo].join(' '); }
        if (io && fp < bp - 1e-9) nGapB++; if (!io) nClose++; if (io && (D.o[i] < D.l[i] || D.o[i] > D.h[i])) nClamp++; }
      for (let q = 0; q < r.sq; q++) { const sp = cy.spx[P[1]], fq = cy.fsx[P[1]]; P[1]++; ss += fq; nFill++;
        const want = Math.max(sp, op); if (Math.abs(fq - want) > 1e-9 * Math.max(1, want) || hi < sp - 1e-9) { okF = false; info = info || [D.d[i], 'S', sp, fq, want, hi].join(' '); }
        if (io && fq > sp + 1e-9) nGapS++; if (!io) nClose++; if (io && (D.o[i] < D.l[i] || D.o[i] > D.h[i])) nClamp++; }
      if (Math.abs(sb - r.ba) > 1e-9 * Math.max(1, r.ba) || Math.abs(ss - r.sa) > 1e-9 * Math.max(1, r.sa)) { okF = false; info = info || [D.d[i], 'sum', sb, r.ba, ss, r.sa].join(' '); }
      /* 놓친 체결 없음: 그날 체결 뒤 다음 매수점은 판단 저가보다 낮아야(한도·Pool 이 막지 않았으면) · 다음 매도점은 판단 고가보다 높아야(매도표·보유가 남았으면) */
      if (!cy.dead && cy.n0 >= 1) {
        for (let q = P[3]; q < P[0]; q++) P[4] = (P[4] || 0) + cy.bpx[q]; P[3] = P[0];
        const nb = r2(cy.min / (cy.n0 + P[0])), ns = cy.n0 - P[1] >= 1 ? r2(cy.max / (cy.n0 - P[1])) : Infinity, used = P[4] || 0;
        if (used + nb <= cy.L - 1e-6 && r.pool - r.sa > nb * (1 + fee) + 1 && lo <= nb + 1e-9) { okM = false; infoM = infoM || [D.d[i], '매수 놓침', nb, lo, used, cy.L].join(' '); }
        if (ns < Infinity && r.q > 0 && hi >= ns - 1e-9) { okM = false; infoM = infoM || [D.d[i], '매도 놓침', ns, hi].join(' '); }
        nMiss++;
      }
    });
    check('놓친 체결 없음 (닿은 매수점·매도점은 한도·Pool·매도표가 막지 않는 한 그날 체결) ' + name, okM && nMiss > 1000, infoM || nMiss);
    R.cycles.forEach(cy => { const P = ptr[cy.no]; if (P[0] !== cy.bpx.length || P[1] !== cy.spx.length) { okF = false; info = info || 'cycle ' + cy.no + ' 개수'; } });
    check('체결 규칙 (시가 반영 · 없는 날 종가) ' + name, okF, info);
    check('체결가가 지정가보다 나쁘지 않음 ' + name, R.cycles.every(cy => cy.fpx.every((x, q) => x <= cy.bpx[q] + 1e-9) && cy.fsx.every((x, q) => x >= cy.spx[q] - 1e-9)));
  };
  for (const type of ['hold', 'acc', 'wd']) for (const norm of ['none', 'auto']) {
    const cfg = { type, G: 10, band: 0.15, limit: VRE.TYPES[type].limit, amt: type === 'acc' ? 250 : type === 'wd' ? 30 : 0, mode: 'ladder', cycle: 'cal', pool0: 0.1 };
    const oo = { from: 0, capital: 20000, fee: 0.0025, sec: 0.0000206, norm, trace: true };
    verify(DO, VRE.run(cfg, DO, oo), type + ' ' + norm + ' 시가 있음', oo.fee, oo.sec);
    const RC = VRE.run(cfg, DC, oo); verify(DC, RC, type + ' ' + norm + ' 시가 없음', oo.fee, oo.sec);
    check('시가 없으면 매수·매도 = 그날 종가 × 개수 ' + type + ' ' + norm, RC.rows.every((r, j) => !j || (Math.abs(r.ba - r.bq * DC.c[r.i] * r.k) < 1e-9 * Math.max(1, r.ba) && Math.abs(r.sa - r.sq * DC.c[r.i] * r.k) < 1e-9 * Math.max(1, r.sa))));
  }
  check('체결 규칙 시험이 갭 매수·갭 매도·종가 판단·시가 맞춤을 모두 지남', nGapB > 20 && nGapS > 20 && nClose > 50 && nClamp > 5 && nFill > 2000, [nFill, nGapB, nGapS, nClose, nClamp].join(' '));
  /* 기록 화면·가이드북 엔진(VRE.backtest)도 같은 규칙 — 수정주가 그대로 · 10거래일 · 세금·수수료 없음이면 날마다 같은 평가금 */
  const days = d.map((x, i) => ({ date: x, c: c[i], h: h[i], l: l[i], o: o[i] }));
  for (const type of ['hold', 'acc', 'wd']) { const lim = VRE.TYPES[type].limit, amt = type === 'acc' ? 250 : type === 'wd' ? 30 : 0, n0 = Math.floor(10000 / c[0]), V0 = r2(n0 * c[0]);
    const A = VRE.backtest({ type, G: 10, band: 0.15, V0, P0: 0, amt, limit: lim }, days), B = VRE.run({ type, G: 10, band: 0.15, limit: lim, amt, mode: 'ladder', cycle: 'td', pool0: 0 }, DO, { from: 0, capital: V0, norm: 'none' });
    let md = 0; for (let i = 0; i < A.eq.length; i++) md = Math.max(md, Math.abs(A.eq[i] - B.eq[i]) / A.eq[i]);
    check('시가 있는 일봉: VRE.backtest = VRE.run ' + type, A.eq.length === B.eq.length && md < 1e-12 && A.sells === B.sells, md); }
}

/* 분배금: 분배락일 아침 보유분만 — 시작일이 분배락일이면 그날은 받지 않음(그날 종가에 처음 삼) · 전날 시작이면 받음 */
{ const e = TQ.dv.findIndex((x, i) => x > 0 && i > 300), cfg = { type: 'hold', G: 10, band: 0.15, limit: 0.5, mode: 'ladder', cycle: 'cal' };
  const A = VRE.run(cfg, TQ, { from: e, capital: 10000, norm: 'auto' }), B = VRE.run(cfg, TQ, { from: e - 1, capital: 10000, norm: 'auto' });
  check('시작일이 분배락일이면 그날 분배금 없음 · 전날 시작이면 있음', e > 0 && A.rows[0].dv === 0 && A.divs === A.rows.reduce((s, r) => s + r.dv, 0) && B.rows[1].dv > 0, [TQ.d[e], A.rows[0].dv, B.rows[1].dv].join(' ')); }

/* 같은 입력이면 같은 결과 · 평균 현금 비중 0~1 */
{ const cfg = { type: 'acc', G: 10, band: 0.15, limit: 0.75, amt: 250, mode: 'ladder', cycle: 'cal' }, o = { from: 0, capital: 10000, norm: 'auto' };
  const A = VRE.summary(VRE.run(cfg, TQ, o), TQ, 10000), B = VRE.summary(VRE.run(cfg, TQ, o), TQ, 10000);
  check('같은 결과', JSON.stringify(A) === JSON.stringify(B));
  check('평균 현금 비중 0~1 · IRR·시간가중 계산됨', A.cash > 0 && A.cash < 1 && A.irr != null && A.cagr != null && A.bh.irr != null, [A.cash, A.irr, A.cagr, A.bh.irr].join(' ')); }

console.log((bad ? 'FAIL' : 'OK') + ' vr_bt_test: ' + ok + '개 통과 · ' + bad + '개 실패');
process.exit(bad ? 1 : 0);
