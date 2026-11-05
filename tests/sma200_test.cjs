/* SMA 200 백테스트 엔진([SMA200-ENG] SMB) 검사 — node tests/sma200_test.cjs [--full]  (run_regression.py 가 자동 실행)
   · src/index.html 의 SMB · MBT 를 그대로 꺼내 씀 (관리자 화면 /sma200/ 과 같은 코드) · 비교 기준 = 투자전략 시뮬레이터 엔진(scripts/stratsim_fit.cjs 가 꺼낸 ssRunSma)
   · ① 시뮬레이터와 같게: 무작위 손잡이 조합(선택지 전부) × 무작위 기간(자료 첫날 1971-02-05~) — 끝 금액 차이 0 · 날마다 평가금 = 시뮬레이터 보유(dd) × 종가 · 최대 낙폭 같음
   · ② 실전(1주 단위 · 수수료 = 체결 금액 × 수수료율 · SEC · 분배금 원천징수)·시뮬 방식 × 양도세(선입선출·이동평균) × 이자세 — 거래 기록만으로 따로 다시 계산:
        날마다 현금·주식 · 매수·매도 금액 · 분배금 · 현금 이자 · 연도별 원화 손익(결제일 환율·결제일 연도) · 세액 · 납부일(다음 해 5/1 — 휴장이면 다음 첫 거래일) · 납부액(그날 환율) · 끝날 정리 값 · 평가금
        + 규칙: 실전은 소수 주 없음 · 현금 음수 없음 · 보유하기로 한 날은 1주 값보다 적은 현금만 남음
   · ③ 자료: 실제 일봉 달력(빠진 날 0 · 달력 밖 날 0) · 프리셋 첫 시작 가능일 = 쓰는 지표가 모두 나온 첫날(따로 계산)
   · ④ 도우미: clean(선택지 밖 → 프리셋) · stats(연평균·낙폭 식) · bh(그냥 보유 세전·세후 따로 계산) · plan(매월 첫 거래일 · 끝 20거래일 전) · one = run + stats + bh
   · ⑥ SOXL 화면(/soxl-sma160/ 'SOXL SMA 160' · 원본 SXCFG): 자료 · 기본값(= 시뮬레이터 라이브러리 'SOXL SMA 160' 손잡이) · 첫 시작 가능일 · SOXL·SOXX 를 더해도 TQQQ 쪽 결과 그대로 · ②·⑤ 를 SOXL 자료로 한 번 더
   실패가 있으면 'FAIL …' 줄과 종료 코드 1 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
const a0 = src.indexOf('var SMB = (function'), b0 = src.indexOf("if (typeof module !== 'undefined') module.exports = SMB;", a0);
if (a0 < 0 || b0 < 0) throw new Error('SMB 없음');
const SMB = new Function(src.slice(a0, b0) + '\nreturn SMB;')();
const mA = src.indexOf('window.MBT = (function () {'), endM = "okOpen: okOpen, withOpen: withOpen, preOpen: preOpen, OPX: OPX };\n})();", mB = src.indexOf(endM, mA);
if (mA < 0 || mB < 0) throw new Error('MBT 없음');
const win = { mdLoad: n => Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', n), 'utf8'))) };
new Function('window', src.slice(mA, mB + endM.length))(win);
const MBT = win.MBT, FULL = process.argv.includes('--full');
const F = require(path.join(ROOT, 'scripts', 'stratsim_fit.cjs')); const M = F.M, DS = M.DS;
let ok = 0, bad = 0, simDates = null, runsX = 0;
function check(name, cond, info) { if (cond) ok++; else { bad++; if (bad < 40) console.log('FAIL ' + name + (info !== undefined ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 400) : '')); } }
let seed = 20261021; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

(async () => {
  /* ── ① 시뮬레이터와 같게 ── */
  const Dsim = SMB.fromCsv(fs.readFileSync(path.join(ROOT, 'data', 'stratsim', 'prices.csv'), 'utf8'));
  check('시뮬레이터 자료 달력 = 시뮬레이터', Dsim.d.length === DS.days.length && Dsim.d.every((x, i) => x === DS.days[i].date));
  check('시뮬레이터 자료 종목 = SMB.SIM = 시뮬레이터 SS_ASSETS (SOXL·SOXX 2026-11-05 맨 뒤 추가)', JSON.stringify(Object.keys(Dsim.px).sort()) === JSON.stringify(SMB.SIM.slice().sort()) && JSON.stringify(SMB.ASSETS) === JSON.stringify(SMB.SIM) &&
    JSON.stringify(SMB.ASSETS) === JSON.stringify(M.SS_ASSETS) && JSON.stringify(SMB.EXT) === '["soxl","soxx"]' && SMB.ASSETS.slice(-2).join() === 'soxl,soxx', [Object.keys(Dsim.px), SMB.ASSETS, M.SS_ASSETS]);
  {   /* SOXL·SOXX 열: 1994-05-04(필라델피아 반도체 지수 첫날)부터 값 · 그 전은 0 · 빈 날 없음 */
    const f = k => Dsim.px[k].findIndex(v => v > 0);
    check('시뮬레이터 자료 SOXL·SOXX: 1994-05-04 부터 · 그 뒤 빈 날 없음', ['soxl', 'soxx'].every(k => Dsim.d[f(k)] === '1994-05-04' && Dsim.px[k].slice(f(k)).every(v => v > 0)), ['soxl', 'soxx'].map(k => Dsim.d[f(k)]));
  }
  for (const k of SMB.SIM) check('시뮬레이터 자료 가격 ' + k, Dsim.px[k].every((v, i) => v === DS.days[i][k] || (Number.isNaN(v) && Number.isNaN(DS.days[i][k]))));
  const NP = FULL ? 3000 : 700;
  let wF = 0, wE = 0, wD = 0, n1 = 0;
  for (let t = 0; t < NP; t++) {
    const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.5 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
    if (t % 5 === 0) Object.assign(p, SMB.PRESET);
    const a = Math.floor(rnd() * (Dsim.d.length - 300)), b = Math.min(Dsim.d.length - 1, a + 20 + Math.floor(rnd() * (rnd() < 0.3 ? 20000 : 3000)));
    const cp = M.ssCleanParams('sma', p);
    const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: M.ssRate9(cp), dd: true, ed: Dsim.d[a], xd: Dsim.d[b] }, M.ssOptsSma(cp)));
    const x = SMB.run(Dsim, p, { from: a, to: b, capital: 100000, mode: 'sim', tax: null, intTax: 0 });
    const v = r.points[r.points.length - 1].value;
    wF = Math.max(wF, Math.abs(v - x.final) / Math.abs(v));
    wD = Math.max(wD, Math.abs(M.ssDailyDDMulti(r.dd).pct + SMB.mdd(x.eq)));
    if (r.dd.length !== x.eq.length) { check('날 수 같음', false, [Dsim.d[a], Dsim.d[b]]); continue; }
    for (let i = 0; i < r.dd.length; i++) { const c = r.dd[i], row = DS.days[a + i]; let vv = c.cash || 0; for (const k in c.h) vv += c.h[k] * row[k]; wE = Math.max(wE, Math.abs(vv - x.eq[i]) / Math.max(1, Math.abs(vv))); }
    /* 거래 횟수: 시뮬레이터 기록의 전량 매도(EXIT · BG-GTFO 중 현금이 된 날) = 엔진 nSell
       (시뮬레이터는 '팔았을 때' 자산을 사는 날도 EXIT 로 적지만 그날은 매수라서 뺀다) */
    const ns = r.log.filter(l => (l.action === 'EXIT' || l.action === 'BG-GTFO') && l.held === 'cash').length;
    if (ns !== x.nSell) check('전량 매도 횟수 = 시뮬레이터', false, [ns, x.nSell, Dsim.d[a], Dsim.d[b], p]);
    n1++;
  }
  check('시뮬레이터와 같게: 끝 금액 차이 0 (' + n1 + '번)', wF === 0, wF);
  check('시뮬레이터와 같게: 날마다 평가금 (상대 1e-12 이내)', wE < 1e-12, wE);
  check('시뮬레이터와 같게: 최대 낙폭 (1e-12 이내)', wD < 1e-12, wD);

  /* ── ③ 실제 일봉 자료 ── */
  const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'etfcagr.json'), 'utf8')), X = {};
  for (const k of ['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl']) X[k] = MBT.fromCagr(J.series[k.toUpperCase()]);
  const D = SMB.fromSeries(X), N = D.d.length, Fx = await MBT.fxData(), fx = MBT.fxFor(D.d, Fx);
  check('실제 일봉: 상장 뒤 빠진 날 0', D.gaps.length === 0, D.gaps.slice(0, 5));
  check('실제 일봉: 달력 밖 날 0', D.extra.length === 0, D.extra.slice(0, 5));
  check('실제 일봉: SQQQ 없음(0)', D.px.sqqq.every(v => v === 0));
  check('실제 일봉: 끝 = 모든 종목의 가장 이른 끝', D.d[N - 1] === Object.values(D.ends).sort()[0], [D.d[N - 1], D.ends]);
  {
    const fv = SMB.firstValid(D, SMB.PRESET), K = SMB.knobs(SMB.PRESET), s200 = SMB.sma(D.px.qqq, 200), t200 = SMB.sma(D.px.tqqq, 200), r9 = SMB.rsi(D.px.qqq, 9), r7 = SMB.rsi(D.px.qqq, 7);
    let e = -1; for (let i = 0; i < N; i++) if (s200[i] != null && t200[i] != null && r9[i] != null && r7[i] != null && D.px.tqqq[i] > 0 && D.px.qqq[i] > 0) { e = i; break; }
    check('프리셋 첫 시작 가능일 = 지표가 모두 나온 첫날', fv === e && K.bga === 'tqqq', [D.d[fv], D.d[e]]);
  }

  /* ── ② 실전·세금 독립 검산 — recheck(자료, 환율, 횟수, 손잡이 만들기, 이름 앞글자) · TQQQ 자료(여기) · SOXL 자료(⑥) ── */
  const recheck = (D, fx, NR, gen, tag) => {
  const N = D.d.length;
  const sIdx = i => i + (D.d[i] < '2024-05-28' ? 2 : 1);
  const yr = i => { const j = sIdx(i); if (j < N) return +D.d[j].slice(0, 4); const t = new Date(D.d[N - 1] + 'T12:00:00Z'); let m = j - (N - 1); while (m > 0) { t.setUTCDate(t.getUTCDate() + 1); if (t.getUTCDay() % 6) m--; } return t.getUTCFullYear(); };
  const fxA = i => fx[Math.min(N - 1, sIdx(i))];
  let runs = 0, wPer = 0, wG = 0, wLiq = 0, wDiv = 0, wInt = 0, wEq = 0, nTaxSell = 0, nPaid = 0, nDiv = 0;
  for (let t = 0; t < NR; t++) {
    const p = gen(t);
    const fv = SMB.firstValid(D, p); if (fv < 0 || fv > N - 320) continue;
    const a = fv + Math.floor(rnd() * (N - fv - 300)), b = Math.min(N - 1, a + 60 + Math.floor(rnd() * 5000));
    const mode = rnd() < 0.75 ? 'real' : 'sim', fee = pick([0, 0.0002, 0.001, 0.0025, 0.005]), method = pick(['fifo', 'avg']), intTax = pick([0, 0.154]);
    const o = { from: a, to: b, capital: pick([3000, 20000, 100000, 1e6]), mode, fee, sec: 0.0000206, divTax: 0.15, intTax, tax: { fx: i => fx[i], method }, rows: true };
    const R = SMB.run(D, p, o), K = R.K, sec = mode === 'real' ? o.sec : 0;
    runs++;
    let cash = o.capital; const sh = {}; SMB.ASSETS.forEach(k => sh[k] = 0);
    const lots = {}, pool = {}, gain = {}; let divSum = 0, intSum = 0, pm = D.d[a].slice(0, 7), ext = 0;
    for (const r of R.rows) {
      const i = r.i, mr = K.rate / 12 * (1 - intTax);
      if (i > a) { const mo = D.d[i].slice(0, 7); if (mo !== pm && cash > 0) { const it = cash * mr; cash += it; intSum += it; if (Math.abs(it - r.int) > 1e-6 * Math.max(1, it)) check('이자', false, [D.d[i], it, r.int]); } pm = mo; }
      const sh0 = Object.assign({}, sh);
      const doSell = s => {
        if (mode === 'real' && Math.abs(s.q - Math.round(s.q)) > 1e-9) check('실전인데 소수 주 매도', false, [D.d[i], s.q]);
        const v = s.q * D.px[s.k][i], net = v * (1 - fee - sec);
        if (Math.abs(net - s.net) > 1e-6 * Math.max(1, net)) check('매도 금액', false, [D.d[i], net, s.net]);
        cash += net; sh[s.k] -= s.q;
        const w = net * fxA(i); let base = 0;
        if (method === 'avg') { const P = pool[s.k] || { q: 0, c: 0 }; base = P.q > 0 ? P.c * Math.min(1, s.q / P.q) : 0; P.c -= base; P.q -= s.q; if (P.q <= 1e-12) { P.q = 0; P.c = 0; } pool[s.k] = P; }
        else { const Lq = lots[s.k] || []; let need = s.q; while (need > 1e-12 && Lq.length) { const z = Lq[0], tk = Math.min(need, z[0]); base += tk * z[1]; z[0] -= tk; need -= tk; if (z[0] <= 1e-12) Lq.shift(); } if (need > 1e-6) check('없는 주식 매도', false, D.d[i]); }
        const y = yr(i); gain[y] = (gain[y] || 0) + w - base;
      };
      r.s.filter(s => !s.tax).forEach(doSell);   /* 엔진 순서: 신호 매도 → 양도세(모자라면 보유 매도 → 납부) → 매수 → 분배금 */
      r.s.filter(s => s.tax).forEach(s => { doSell(s); nTaxSell++; });
      const pd = R.taxes.filter(T => T.paid === D.d[i] && T.tax > 0).reduce((s2, T) => s2 + T.tax / fx[i], 0);
      if (Math.abs(pd - r.tax) > 1e-6 * Math.max(1, pd)) check('세금 납부액 = 원화 세액 ÷ 그날 환율', false, [D.d[i], pd, r.tax]);
      if (pd > 0) nPaid++;
      const pay = Math.min(pd, Math.max(0, cash)); ext += pd - pay; cash -= pay;
      for (const bx of r.b) {
        const pr = D.px[bx.k][i];
        if (mode === 'real') { if (Math.abs(bx.q - Math.round(bx.q)) > 1e-9) check('실전인데 소수 주 매수', false, [D.d[i], bx.q]); const sp = bx.q * pr * (1 + fee); if (Math.abs(sp - bx.spend) > 1e-6 * sp) check('매수 금액', false, D.d[i]); if (sp > cash + 1e-6) check('현금보다 많이 삼', false, [D.d[i], sp, cash]); cash -= sp; }
        else { if (Math.abs(bx.spend * (1 - fee) / pr - bx.q) > 1e-9 * Math.max(1, bx.q)) check('시뮬 매수 주수', false, D.d[i]); cash -= bx.spend; }
        sh[bx.k] += bx.q;
        if (method === 'avg') { const P = pool[bx.k] || { q: 0, c: 0 }; P.q += bx.q; P.c += bx.spend * fxA(i); pool[bx.k] = P; } else (lots[bx.k] = lots[bx.k] || []).push([bx.q, bx.spend * fxA(i) / bx.q]);
      }
      if (mode === 'sim' && r.b.length && Math.abs(cash) < 1e-6) cash = r.cash;   /* 시뮬 방식은 '남은 현금 = 0' 대입 */
      let dc = 0; if (mode === 'real') for (const k of SMB.ASSETS) { const dv = D.dv[k][i]; if (dv > 0 && sh0[k] > 0 && i > a) dc += sh0[k] * dv * 0.85; }
      cash += dc; divSum += dc; if (dc > 0) nDiv++;
      if (Math.abs(dc - r.div) > 1e-6 * Math.max(1, dc)) check('분배금', false, [D.d[i], dc, r.div]);
      if (Math.abs(cash - r.cash) > 1e-6 * Math.max(1, Math.abs(r.cash)) + 1e-6) { check('현금', false, [D.d[i], cash, r.cash]); cash = r.cash; }
      if (r.cash < -1e-6) check('현금 음수 없음', false, [D.d[i], r.cash]);
      for (const k of SMB.ASSETS) if (Math.abs(sh[k] - r.sh[k]) > 1e-9 * Math.max(1, sh[k])) { check('주식 수', false, [D.d[i], k, sh[k], r.sh[k]]); sh[k] = r.sh[k]; }
      let v = 0; for (const k of SMB.ASSETS) if (sh[k] > 0) v += sh[k] * D.px[k][i]; v += cash;
      wEq = Math.max(wEq, Math.abs(v - ext - r.eq) / Math.max(1, Math.abs(v)));
      if (mode === 'real' && r.tgt !== 'cash' && r.ease === 0 && r.b.length && r.cash - r.div > D.px[r.tgt][i] * (1 + fee) + 1e-6) check('보유하기로 한 날은 1주 값보다 적은 현금만', false, [D.d[i], r.cash, D.px[r.tgt][i]]);
    }
    /* 화면의 '전량 매도 N번'(세금 아닌 매도가 있는 날 수) = 엔진 nSell · 그런 날은 신호 종목이 아니라 보유 전부를 팖 */
    const sellDays = R.rows.filter(r => r.s.some(s => !s.tax));
    if (sellDays.length !== R.nSell) check('매도한 날 수 = nSell', false, [sellDays.length, R.nSell]);
    for (const r of sellDays) for (const s of r.s.filter(s => !s.tax)) { const j = R.rows.indexOf(r), before = j > 0 ? R.rows[j - 1].sh[s.k] : 0; if (Math.abs(s.q - before) > 1e-9 * Math.max(1, before)) check('신호 매도 = 그 종목 전량', false, [D.d[r.i], s.k, s.q, before]); }
    /* 보유 구간 표 맞춤: 끝 평가금 − 원금 = 구간 손익 합 + 분배금 + 이자 − 낸 양도세 */
    { let pl = 0; R.periods.forEach(q => { pl += (q.open ? q.net + q.val : q.net) - q.spend; });
      const rs = R.final - o.capital - (pl + R.divs + R.intr - R.taxPaid); wPer = Math.max(wPer, Math.abs(rs) / Math.max(1, Math.abs(R.final)));
      const op = R.periods.filter(q => q.open).map(q => q.k).sort(), hd = SMB.ASSETS.filter(k => R.sh[k] > 0).sort();
      if (JSON.stringify(op) !== JSON.stringify(hd)) check('보유 중 구간 = 끝날 들고 있는 종목(종목마다 하나)', false, [D.d[a], op, hd]);
      for (const q of R.periods) if (!q.open && !(q.to >= q.from)) check('구간 끝 ≥ 시작', false, q); }
    for (const y in gain) wG = Math.max(wG, Math.abs(gain[y] - (R.gain[y] || 0)) / Math.max(1, Math.abs(gain[y])));
    for (const T of R.taxes) {
      const exp = Math.max(0, (gain[T.y] || 0) - SMB.DED) * SMB.RATE;
      if (Math.abs(exp - T.tax) > 1e-3) check('세액 = 22% × (손익 − 250만 원)', false, [T.y, exp, T.tax]);
      if (T.paid && T.paid !== '-') { if (T.paid < (T.y + 1) + '-05-01') check('5/1 전 납부 없음', false, T); const pi = D.d.indexOf(T.paid); if (pi > a && D.d[pi - 1] >= (T.y + 1) + '-05-01') check('5/1(휴장이면 다음 거래일)에 납부', false, T); }
    }
    const ly = yr(b); let unreal = 0, hv = 0;
    for (const k of SMB.ASSETS) if (sh[k] > 0) { const v = sh[k] * D.px[k][b]; hv += v; const bs = method === 'avg' ? (pool[k] ? pool[k].c : 0) : (lots[k] || []).reduce((s2, z) => s2 + z[0] * z[1], 0); unreal += v * (1 - fee - sec) * fxA(b) - bs; }
    const unp = R.taxes.filter(T => T.paid == null && T.y !== ly && T.tax > 0).reduce((s2, T) => s2 + T.tax, 0);
    const liq = cash + hv * (1 - fee - sec) - R.taxExt - (unp + Math.max(0, (gain[ly] || 0) + unreal - SMB.DED) * SMB.RATE) / fx[b];
    wLiq = Math.max(wLiq, Math.abs(liq - R.liq) / Math.max(1, Math.abs(R.liq)));
    wDiv = Math.max(wDiv, Math.abs(divSum - R.divs) / Math.max(1, R.divs)); wInt = Math.max(wInt, Math.abs(intSum - R.intr) / Math.max(1, R.intr));
    const due = R.taxes.filter(T => T.paid == null && T.tax > 0).reduce((s2, T) => s2 + T.tax / fx[b], 0);
    if (Math.abs(due - R.taxDue) > 1e-6 * Math.max(1, due)) check('미납 양도세', false, [due, R.taxDue]);
  }
  check(tag + '실전·세금: 연도별 원화 손익 (' + runs + '번)', wG < 1e-12, wG);
  check(tag + '실전·세금: 끝날 정리 값', wLiq < 1e-9, wLiq);
  check(tag + '보유 구간 손익 합 + 분배금 + 이자 − 양도세 = 끝 평가금 − 원금', wPer < 1e-9, wPer);
  check(tag + '실전·세금: 분배금 합', wDiv < 1e-9, wDiv);
  check(tag + '실전·세금: 이자 합', wInt < 1e-8, wInt);
  check(tag + '실전·세금: 날마다 평가금', wEq < 1e-9, wEq);
  check(tag + '검산이 실제로 세금 납부·세금 내려 판 날·분배금을 지나감', nPaid > 20 && nTaxSell > 3 && nDiv > 20, [nPaid, nTaxSell, nDiv]);
  return runs;
  };
  const runs = recheck(D, fx, FULL ? 1200 : 250, t => {
    const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.6 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
    for (const k of ['sig', 'ul', 'out', 'bga']) if (p[k] === 'sqqq' || p[k] === 'soxl' || p[k] === 'soxx') p[k] = SMB.PRESET[k];   /* TQQQ 쪽 실제 일봉 자료(D)에 없는 종목 */
    if (t % 4 === 0) Object.assign(p, SMB.PRESET);
    return p;
  }, '');
  const sIdx = i => i + (D.d[i] < '2024-05-28' ? 2 : 1);

  /* ── ④ 도우미 ── */
  {   /* 프리셋 = 투자전략 시뮬레이터 라이브러리 'SMA 200' (src/stratsim/30-library.js — 라이브러리를 고치면 여기서 알림) · 선택지 = 시뮬레이터 편집 창(SS_PSMA) */
    const lib = fs.readFileSync(path.join(ROOT, 'src', 'stratsim', '30-library.js'), 'utf8'), i0 = lib.indexOf("name: 'SMA 200'"), m = i0 < 0 ? null : /preset:\s*\{\s*type:\s*'sma',\s*params:\s*(\{[^}]*\})/.exec(lib.slice(i0, i0 + 3000));
    const lp = m ? new Function('return ' + m[1])() : null;
    check('프리셋 = 라이브러리 SMA 200', !!lp && JSON.stringify(Object.keys(lp).sort().map(k => [k, lp[k]])) === JSON.stringify(Object.keys(SMB.PRESET).sort().map(k => [k, SMB.PRESET[k]])), [lp, SMB.PRESET]);
    const sp = {}; (M.SS_PSMA || []).forEach(q => { sp[q.k] = (q.opts || []).map(o => String(o[0])); });
    const same = Object.keys(SMB.OPTS).every(k => sp[k] && JSON.stringify(sp[k]) === JSON.stringify(SMB.OPTS[k].map(o => String(o[0]))));
    check('선택지 = 시뮬레이터 편집 창', Object.keys(sp).length > 0 && same && Object.keys(sp).every(k => SMB.OPTS[k]), Object.keys(sp));
  }
  check('clean: 선택지 밖 → 프리셋', SMB.clean({ win: '123', sig: 'xx', bg: '0', cr: '20' }).win === '200' && SMB.clean({ sig: 'xx' }).sig === 'qqq' && SMB.clean({ bg: '0' }).bg === '0' && SMB.clean({ cr: '20' }).cr === '20');
  {
    const a = SMB.firstValid(D, SMB.PRESET), b = N - 1, o = { capital: 100000, mode: 'real', fee: 0.0025, sec: 0.0000206, divTax: 0.15, intTax: 0.154, tax: { fx: i => fx[i], method: 'fifo' } };
    const R = SMB.run(D, SMB.PRESET, Object.assign({ from: a, to: b }, o)), st = SMB.stats(R), days = SMB.dnum(D.d[b]) - SMB.dnum(D.d[a]);
    check('stats: 연평균 식', Math.abs(st.cagr - (Math.pow(R.final / 100000, 365.25 / days) - 1)) < 1e-15 && st.days === days);
    let pk = -Infinity, m = 0; R.eq.forEach(v => { pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); });
    check('stats: 최대 낙폭 식', st.mdd === m);
    /* 그냥 보유(실전): 분배금(15% 뗀 뒤)을 분배락일 종가로 다시 삼 — 세전은 수수료 없이, 세후는 다시 살 때 수수료 · 취득가에 더함(그날 결제일 환율) */
    const h = SMB.bh(D, 'tqqq', a, b, 100000, o), P = D.px.tqqq, p0 = P[a], p1 = P[b], f0 = fx[Math.min(N - 1, sIdx(a))], f1 = fx[Math.min(N - 1, sIdx(b))];
    let qg = 100000 / p0, qn = 100000 / 1.0025 / p0, basis = 100000 * f0, nEv = 0;
    for (let i = a + 1; i <= b; i++) { const dv = D.dv.tqqq[i]; if (dv > 0) { nEv++; const c = qn * dv * 0.85; qn += c / (P[i] * 1.0025); basis += c * fx[Math.min(N - 1, sIdx(i))]; qg *= 1 + dv * 0.85 / P[i]; } }
    const pr = qn * p1 * (1 - 0.0025 - 0.0000206), tx = 0.22 * Math.max(0, pr * f1 - basis - 2500000) / fx[b];
    check('bh(실전): 분배금 다시 사기 · 세후 = 수수료·SEC·양도세 뺀 값', nEv > 5 && Math.abs(h.fin / (qg * p1) - 1) < 1e-12 && Math.abs(h.netFin / (pr - tx) - 1) < 1e-12 && h.fin > 100000 * p1 / p0, [nEv, h.fin, qg * p1, h.netFin, pr - tx]);
    const hs = SMB.bh(D, 'tqqq', a, b, 100000, Object.assign({}, o, { mode: 'sim', tax: null }));
    check('bh(시뮬 방식): 분배금 없이 가격 비율', Math.abs(hs.fin - 100000 * p1 / p0) < 1e-6 && Math.abs(hs.netFin - 100000 * 0.9975 / p0 * p1 * 0.9975) < 1e-6);
    const one = SMB.one(D, SMB.PRESET, o, a, b);
    check('one = run + stats + bh', one.cagr === st.cagr && one.mdd === st.mdd && one.liq === st.cagrLiq && one.bh === h.cagr && one.bhN === h.net && one.d === D.d[a], one);
    const pl = SMB.plan(D, a, b, 20), months = new Set(pl.first.map(s => D.d[s].slice(0, 7)));
    check('plan: 매월 첫 거래일 · 끝 20거래일 전까지 · 빠짐·겹침 없음', pl.first.every(s => s === a || D.d[s - 1].slice(0, 7) !== D.d[s].slice(0, 7)) && months.size === pl.first.length &&
      pl.n === b - 20 - a + 1 && new Set(pl.first.concat(pl.rest)).size === pl.n && Math.max(...pl.first, ...pl.rest) === b - 20);
    check('plan: 매월 표본만', SMB.plan(D, a, b, 20, true).rest.length === 0);
    /* 세금 없음 · 수수료 0 이면 끝날 정리 = 평가금 */
    const R0 = SMB.run(D, SMB.PRESET, { from: a, to: b, capital: 100000, mode: 'real', fee: 0, sec: 0, divTax: 0.15, intTax: 0, tax: null });
    check('세금·수수료 없으면 정리 값 = 평가금', Math.abs(R0.liq - R0.final) < 1e-6 && R0.taxPaid === 0 && R0.taxDue === 0);
  }
  /* ── ⑤ 실전이 시뮬레이터와 같은 날 사고파는지 · 하루 늦게(lag) · RSI 상장 전 0 ── */
  {   /* RSI: 앞쪽 0 은 건너뜀 → 0 을 붙인 계열의 RSI = 원래 계열의 RSI 를 그만큼 민 것 (시뮬레이터 자료처럼 0 이 없으면 예전 식과 같음) */
    const v = Dsim.px.qqq.slice(0, 400), z = [0, 0, 0].concat(v), r0 = SMB.rsi(v, 14), rz = SMB.rsi(z, 14);
    check('RSI: 상장 전 0 을 오름으로 세지 않음', rz.slice(0, 17).every(x => x == null) && r0.every((x, i) => x === rz[i + 3]));
    const t = D.px.tqqq, s0 = t.findIndex(x => x > 0), rt = SMB.rsi(t, 30);
    check('RSI: 실제 TQQQ 는 상장 뒤 30일째부터', rt[s0 + 29] == null && rt[s0 + 30] != null, [D.d[s0]]);
  }
  {   /* 실전(1주 단위 · 분배금 · 잔돈 다시 사기 · 양도세 1주 올림) vs 시뮬 방식 — 같은 자료로 날마다 신호·목표·나눠 사기 남은 횟수 · 시뮬레이터가 산 날(sb) · 판 날(ss) 이 같아야 함
         · 원금: 아주 작음($150 · 1주도 못 사는 회차가 생김) ~ 아주 큼 · 수수료 0 ~ 0.25% · lag 0/1 · 결제 대기 2일 이상을 자주
         · 양도세를 넣는 경우는 분배금을 뺀 자료(D0)로 — 분배금만큼 실전 현금이 많아 '세금 낼 현금이 모자란가'가 달라지는 것은 금액 차이라서 */
    simDates = (D, fx, NT, PRE, gen, tag) => {
    const N = D.d.length, D0 = Object.assign({}, D, { dv: null, _ind: D._ind });
    let nT = 0, nTop = 0, nSet = 0, nTax = 0, nSmall = 0, nNoBuy = 0;
    const cases = [[Object.assign({}, PRE, { settle: '3' }), 0, 1e10, 0, false, true], [Object.assign({}, PRE, { settle: '5' }), 0, 1e10, 0, false, true], [Object.assign({}, PRE), 1, 1e10, 0, false, true]];
    for (let t = 0; t < NT; t++) {
      const p = gen(t);
      cases.push([p, rnd() < 0.5 ? 1 : 0, pick([150, 3000, 1e5, 1e7, 1e10]), pick([0, 0.001, 0.0025]), rnd() < 0.35, false]);
    }
    for (const [p, lag, cap, fee, withTax, full] of cases) {
      const DD = withTax ? D0 : D, fv = SMB.firstValid(DD, p, lag); if (fv < 0 || fv > N - 120) continue;
      const a = full ? fv : fv + Math.floor(rnd() * (N - fv - 100)), b = full ? N - 1 : Math.min(N - 1, a + 60 + Math.floor(rnd() * 4000));
      const base = { from: a, to: b, capital: cap, fee, sec: 0, intTax: 0, tax: withTax ? { fx: i => fx[i], method: pick(['fifo', 'avg']) } : null, rows: true, lag };
      const Rs = SMB.run(DD, p, Object.assign({ mode: 'sim' }, base)), Rr = SMB.run(DD, p, Object.assign({ mode: 'real', divTax: 0.15, sec: 0.0000206 }, base));
      nT++; if (+p.settle >= 2) nSet++; if (withTax) nTax++; if (cap <= 3000) nSmall++;
      for (let j = 0; j < Rs.rows.length; j++) {
        const x = Rs.rows[j], y = Rr.rows[j];
        if (y.b.some(q => q.top)) nTop++;
        if (j && y.sb && !y.b.length) nNoBuy++;
        if (j && !withTax && (x.sb !== x.b.length > 0 || x.ss !== x.s.length > 0)) { check(tag + '시뮬 방식: 산 날·판 날 표시 = 실제 매매', false, [D.d[x.i], p]); break; }
        if (j && (x.st !== y.st || x.tgt !== y.tgt || x.ease !== y.ease || x.bg !== y.bg || !!x.sb !== !!y.sb || !!x.ss !== !!y.ss)) {
          check(tag + '실전 = 시뮬 방식과 같은 날 사고팖', false, [D.d[x.i], lag, cap, fee, withTax, p, [x.st, y.st, x.tgt, y.tgt, x.ease, y.ease, x.sb, y.sb, x.ss, y.ss]]); break;
        }
        if (y.b.some(q => q.top) && (y.sb || SMB.ASSETS.some(k => k !== y.tgt && y.sh[k] > 0))) { check(tag + '잔돈 매수는 목표 종목만 들고 있을 때 · 결정한 매수와 같은 날 아님', false, [D.d[y.i], p]); break; }
      }
    }
    check(tag + '실전 = 시뮬 방식 날짜 (' + nT + '번 · 결제 대기 2일 이상 ' + nSet + ' · 양도세 ' + nTax + ' · 작은 원금 ' + nSmall + ' · 잔돈 매수 ' + nTop + '일 · 1주도 못 산 회차 ' + nNoBuy + '일)',
      nT > 100 && nSet > 30 && nTax > 30 && nSmall > 30 && nTop > 100 && nNoBuy > 10, [nT, nSet, nTax, nSmall, nTop, nNoBuy]);
    };
    simDates(D, fx, FULL ? 800 : 200, SMB.PRESET, t => {
      const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.5 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
      for (const k of ['sig', 'ul', 'out', 'bga']) if (p[k] === 'sqqq' || p[k] === 'soxl' || p[k] === 'soxx') p[k] = SMB.PRESET[k];   /* TQQQ 쪽 실제 일봉 자료(D)에 없는 종목 */
      if (t % 3 === 0) p.settle = pick(['2', '3', '4', '5']);
      return p;
    }, '');
    /* 검토에서 나온 두 경우 그대로 */
    { const p = { sig: 'tqqq', win: '110', ul: 'qld', eb: '10', xb: '8', cb: '3', cs: '2', settle: '2', ohw: '4', oh: '45', coolw: '2', cool: '65', out: 'qqq', cr: '7.5', din: '11', dout: '126', bga: 'spy', bg: '50', bgw: '130' };
      const a = D.d.indexOf('2015-02-02'), o = { from: a, to: N - 1, capital: 1e5, fee: 0.0025, sec: 0.0000206, divTax: 0.15, intTax: 0, tax: { fx: i => fx[i], method: 'fifo' }, rows: true };
      /* 2017년 양도세 낸 날(2026-10-22 전: 2018-05-31 · 지금: 납부일 5/1 → 2018-05-01) 다음 거래일에 QLD 매도 */
      const R = SMB.run(D, p, Object.assign({ mode: 'real' }, o)), T17 = R.taxes.find(T => T.y === 2017), i = T17 ? D.d.indexOf(T17.paid) : -1, r = R.rows.find(x => x.i === i + 1);
      check('세금 낸 날 남은 잔돈이 나눠 사기·매도를 막지 않음(' + (r ? D.d[r.i] : '?') + ' QLD 매도)', a > 0 && i > 0 && T17.paid === '2018-05-01' && r && r.s.some(s => s.k === 'qld' && !s.tax), r && r.s); }
    { const p = { sig: 'qqq', win: '220', ul: 'qld', eb: '1.5', xb: '15', cs: '10', settle: '0', ohw: '15', oh: '50', coolw: '17', cool: '75', out: 'spxl', cr: '1', din: '63', dout: '10', bga: 'qld', bg: '15', bgw: '40' };
      const a = D.d.indexOf('2023-06-26'), o = { from: a, to: N - 1, capital: 150, fee: 0, intTax: 0, tax: null, rows: true, lag: 1 };
      const Rs = SMB.run(D, p, Object.assign({ mode: 'sim' }, o)), Rr = SMB.run(D, p, Object.assign({ mode: 'real', divTax: 0.15 }, o));
      const bad2 = Rr.rows.filter((y, j) => y.b.some(q => q.top) && Rs.rows[j].ease !== y.ease);
      check('아무것도 못 든 채 목표가 바뀌면 잔돈 매수가 아니라 나눠 사기로', a > 0 && Rr.rows.every((y, j) => y.ease === Rs.rows[j].ease && !!y.sb === !!Rs.rows[j].sb) && !bad2.length); }
  }
  {   /* 하루 늦게(lag 1) = 신호 종목을 하루 민 계열로 같은 날 판단(lag 0) — 시뮬레이터 자료의 빈 칸(SQQQ)에 '하루 민 QQQ'(첫날 0)를 넣어 비교 */
    const Dz = { d: Dsim.d, px: Object.assign({}, Dsim.px), dv: null, kind: 'sim' };
    Dz.px.sqqq = Dsim.px.qqq.map((v, i) => (i ? Dsim.px.qqq[i - 1] : 0));
    let nL = 0, wL = 0;
    for (let t = 0; t < (FULL ? 400 : 120); t++) {
      const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.5 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
      for (const k of ['ul', 'out']) if (p[k] === 'sqqq') p[k] = SMB.PRESET[k];
      const p1 = Object.assign({}, p, { sig: 'qqq', bga: 'qqq' }), p0 = Object.assign({}, p, { sig: 'sqqq', bga: 'sqqq' });
      const fv = Math.max(SMB.firstValid(Dz, p1, 1), SMB.firstValid(Dz, p0, 0)); if (fv < 0) continue;
      const a = fv + Math.floor(rnd() * (Dz.d.length - fv - 300)), b = Math.min(Dz.d.length - 1, a + 20 + Math.floor(rnd() * 8000));
      const R1 = SMB.run(Dz, p1, { from: a, to: b, capital: 1e5, mode: 'sim', lag: 1 }), R0 = SMB.run(Dz, p0, { from: a, to: b, capital: 1e5, mode: 'sim', lag: 0 });
      nL++; wL = Math.max(wL, Math.abs(R1.final - R0.final) / R0.final); if (R1.nSell !== R0.nSell) check('하루 늦게: 매도 횟수', false, [Dz.d[a], Dz.d[b], p]);
    }
    check('하루 늦게 = 하루 민 신호로 같은 날 (' + nL + '번 · 끝 금액 차이 0)', nL > 60 && wL === 0, wL);
    const f0 = SMB.firstValid(D, SMB.PRESET), f1 = SMB.firstValid(D, SMB.PRESET, 1);
    check('하루 늦게: 첫 시작 가능일 = 하루 뒤', f1 === f0 + 1, [D.d[f0], D.d[f1]]);
  }
  /* ── ⑥ SOXL 자료 — 관리자 'SOXL SMA 160 백테스트'(/soxl-sma160/ · src/index.html SXCFG · 2026-11-05 이름 SOXL SMA 200 → 160 · 기본값 = 탐색 후보 C) ──
       · 화면 설정(SXCFG)을 원본에서 그대로 꺼내 씀 → 종목·기본값을 바꾸면 여기서도 그대로 검사
       · 자료(SOXL·SOXX·SPY·QQQ 실제 일봉) · 기본값 첫 시작 가능일 · SOXL·SOXX 를 더해도 TQQQ 쪽 결과 그대로 · 실전·세금 독립 검산(②) · 실전 = 시뮬 방식 날짜(⑤) */
  const ia = src.indexOf('var SXCFG = '), SX = ia < 0 ? null : new Function('return ' + src.slice(ia + 12, src.indexOf('};', ia) + 1))();
  /* 'SOXL SMA 160' 손잡이 (사용자 결정 2026-11-05 — 탐색 후보 C) — 여기 따로 적어 원본(SXCFG.def · 라이브러리 #45)과 대조 */
  const C160 = { sig: 'soxl', win: '160', ul: 'soxl', eb: '5', xb: '0.8', cb: '5', cs: '5', settle: '1', ohw: '14', oh: '75', coolw: '7', cool: '60', out: 'spy', cr: '0', din: '10', dout: '0', bga: 'soxl', bgw: '250', bg: '75' };
  const sortJ = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  check('SXCFG 를 원본에서 꺼냄 (종목 · 기본값 = SOXL SMA 160 · 저장 판 2 · 이름)', !!SX && SX.id === 'sx' && sortJ(SX.def) === sortJ(C160) && SX.pv === 2 && SX.nm === 'SOXL SMA 160' && SX.page === 'page-soxl160' &&
    SX.csv === 'soxl-sma160-backtest' && JSON.stringify(SX.modes) === '["real","pre","sim"]' && /^SOXL SMA 160 백테스트 /.test(SX.title), SX);
  {   /* 투자전략 시뮬레이터 라이브러리 'SOXL SMA 160' 프리셋 = 이 화면 기본값 (손잡이 전부 · 비용만 시뮬레이터 0.02%) · 시뮬레이터 선택지 안의 값 */
    const vm = require('vm'), lc = { console, Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, parseFloat, parseInt, isFinite, Infinity, NaN,
      document: { getElementById() { return null; }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }, window: { addEventListener() {} } };
    vm.createContext(lc); vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'stratsim', '30-library.js'), 'utf8') + ';globalThis.__L = SS_LIBRARY;', lc);
    const L = lc.__L.filter(e => e.name === 'SOXL SMA 160'), pr = L[0] && L[0].preset, pp = pr ? Object.assign({}, pr.params) : {};
    const cost = pp.cost; delete pp.cost;
    check("라이브러리 'SOXL SMA 160' 프리셋 = SOXL 화면 기본값 (손잡이 전부 · 비용 0.02% · 번호 하나뿐 · 선택지 안)", L.length === 1 && pr.type === 'sma' && cost === '0.02' && sortJ(pp) === sortJ(C160) &&
      lc.__L.filter(e => e.n === L[0].n).length === 1 && sortJ(SMB.clean(pr.params)) === sortJ(Object.assign({}, SMB.PRESET, pr.params)), [L.length, pr]);
  }
  if (SX) {
    const PX = Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0', din: '5', dout: '5', xb: '0.8' }, SX.def), TKX = SX.tk;
    check('SOXL 화면 종목은 모두 엔진이 받는 값 · 실제 일봉 있음', ['sig', 'ul', 'out', 'bga'].every(k => TKX[k].every(v => SMB.XOPTS[k].some(o => o[0] === v) && (v === 'cash' || SX.real.indexOf(v) >= 0 && J.series[v.toUpperCase()]))), TKX);
    check('clean: SOXL·SOXX 받음 · 빈 칸은 base · 시뮬레이터 선택지(OPTS)에도 있음(2026-11-05)', SMB.clean({ ul: 'soxl', sig: 'soxx' }).ul === 'soxl' && SMB.clean({}, PX).bga === 'soxl' && SMB.clean({ ul: 'xx' }, PX).ul === 'soxl' &&
      SMB.clean({ ul: 'xx' }).ul === 'tqqq' && SMB.OPTS.ul.some(o => o[0] === 'soxl') && SMB.XOPTS === SMB.OPTS);
    const XS = {}; for (const k of SX.real) XS[k] = MBT.fromCagr(J.series[k.toUpperCase()]);
    const DX = SMB.fromSeries(XS), NX = DX.d.length, fxX = MBT.fxFor(DX.d, Fx);
    check('SOXL 자료: 상장 뒤 빠진 날 0 · 달력 밖 날 0', DX.gaps.length === 0 && DX.extra.length === 0, [DX.gaps.slice(0, 5), DX.extra.slice(0, 5)]);
    check('SOXL 자료: 끝 = 모든 종목의 가장 이른 끝 · TQQQ 쪽 종목 0', DX.d[NX - 1] === Object.values(DX.ends).sort()[0] && ['tqqq', 'qld', 'sso', 'spxl', 'sqqq'].every(k => DX.px[k].every(v => v === 0)), DX.ends);
    {
      const fv = SMB.firstValid(DX, PX), s160 = SMB.sma(DX.px.soxl, 160), b250 = SMB.sma(DX.px.soxl, 250), r14 = SMB.rsi(DX.px.soxl, 14), r7 = SMB.rsi(DX.px.soxl, 7);
      let e = -1; for (let i = 0; i < NX; i++) if (s160[i] != null && b250[i] != null && r14[i] != null && r7[i] != null && DX.px.soxl[i] > 0 && DX.px.spy[i] > 0) { e = i; break; }
      const lst = DX.px.soxl.findIndex(v => v > 0);
      check('SOXL 기본값 첫 시작 가능일 = 지표가 모두 나온 첫날 (2011-03-07 = SOXL 상장 2010-03-11 부터 250번째 거래일 — 설명서 글과 같음)', fv === e && DX.d[fv] === '2011-03-07' && DX.d[lst] === '2010-03-11' && fv - lst === 249 &&
        SMB.knobs(PX).bga === 'soxl' && SMB.knobs(PX).sig === 'soxl' && SMB.knobs(PX).bgw === 250, [DX.d[fv], DX.d[e], fv - lst]);
      /* 설명서 글(#g-soxl160)의 첫날 = 엔진 첫날 */
      check('SOXL 설명서 첫날 = 2011년 3월 7일', src.indexOf('모든 지표가 처음 갖춰지는 2011년 3월 7일부터') > 0 && src.indexOf('SOXL 상장 2010년 3월 11일부터 250번째 거래일') > 0);
    }
    {   /* 자료에 SOXL·SOXX 칸이 있어도(늘 0) TQQQ 쪽 결과 그대로 — 칸을 지운 자료와 끝 금액·날마다 평가금·정리 값·세금이 같음 */
      const strip = Q => { const px = Object.assign({}, Q.px), dv = Q.dv ? Object.assign({}, Q.dv) : null; for (const k of SMB.EXT) { delete px[k]; if (dv) delete dv[k]; } return { d: Q.d, px, dv }; };
      const Dn = strip(D), P0 = Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0', din: '5', dout: '5', xb: '0.8' });
      let same = 0, tried = 0;
      for (const [pp, mode] of [[P0, 'real'], [SMB.PRESET, 'real'], [Object.assign({}, P0, { out: 'qld', bga: 'spy', settle: '3' }), 'real'], [P0, 'sim']]) {
        const a = SMB.firstValid(D, pp), o = { from: a, to: N - 1, capital: 1e5, mode, fee: 0.0025, sec: 0.0000206, divTax: 0.15, intTax: 0.154, tax: { fx: i => fx[i], method: 'fifo' }, rows: true };
        const R1 = SMB.run(D, pp, o), R2 = SMB.run(Dn, pp, o); tried++;
        if (R1.final === R2.final && R1.liq === R2.liq && R1.taxPaid === R2.taxPaid && R1.eq.every((v, i) => v === R2.eq[i]) && R1.nSell === R2.nSell) same++;
      }
      check('SOXL·SOXX 칸이 있어도 TQQQ 쪽 결과 그대로 (' + tried + '가지)', same === tried, [same, tried]);
      /* SOXL 설정도 자료에 다른 종목이 더 있어도 같은 날 같은 값 (TQQQ 쪽 실제 일봉을 함께 넣은 큰 자료와 비교 — 달력이 같은 기본값 첫날 ~) */
      const XA = Object.assign({}, X, XS), DA = SMB.fromSeries(XA), a1 = SMB.firstValid(DX, PX), a2 = DA.d.indexOf(DX.d[a1]);
      const fxA2 = MBT.fxFor(DA.d, Fx), oX = { capital: 1e5, mode: 'real', fee: 0.0025, sec: 0.0000206, divTax: 0.15, intTax: 0.154, rows: false };
      const RX = SMB.run(DX, PX, Object.assign({ from: a1, to: NX - 1, tax: { fx: i => fxX[i], method: 'fifo' } }, oX)), RA = SMB.run(DA, PX, Object.assign({ from: a2, to: DA.d.length - 1, tax: { fx: i => fxA2[i], method: 'fifo' } }, oX));
      check('SOXL 설정: 자료에 다른 종목을 더해도 같은 값', DX.d.slice(a1).join() === DA.d.slice(a2).join() && RX.final === RA.final && RX.eq.every((v, i) => v === RA.eq[i]) && RX.liq === RA.liq, [RX.final, RA.final]);
    }
    const genX = (mix, every) => t => {
      const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < mix ? PX[k] : TKX[k] ? pick(TKX[k]) : pick(SMB.OPTS[k])[0];
      if (every === 4 && t % 4 === 0) Object.assign(p, PX);
      if (every === 3 && t % 3 === 0) p.settle = pick(['2', '3', '4', '5']);
      return p;
    };
    runsX = recheck(DX, fxX, FULL ? 1200 : 250, genX(0.6, 4), 'SOXL ');
    simDates(DX, fxX, FULL ? 800 : 200, PX, genX(0.5, 3), 'SOXL ');
  }
  console.log((bad ? 'FAIL ' : '') + 'sma200_test: ' + ok + '개 통과 · ' + bad + '개 실패 (시뮬레이터 대조 ' + n1 + '번 · 실전·세금 검산 TQQQ ' + runs + '번 · SOXL ' + runsX + '번)');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL 예외 ' + (e && e.stack || e)); process.exit(1); });
