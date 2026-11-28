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
  check('시뮬레이터 자료 종목 = SMB.SIM = 시뮬레이터 SS_ASSETS (SOXL·SOXX 2026-11-05 · TECL·XLK 2026-11-27 맨 뒤 추가)', JSON.stringify(Object.keys(Dsim.px).sort()) === JSON.stringify(SMB.SIM.slice().sort()) && JSON.stringify(SMB.ASSETS) === JSON.stringify(SMB.SIM) &&
    JSON.stringify(SMB.ASSETS) === JSON.stringify(M.SS_ASSETS) && JSON.stringify(SMB.EXT) === '["soxl","soxx","tecl","xlk"]' && SMB.ASSETS.slice(-4).join() === 'soxl,soxx,tecl,xlk', [Object.keys(Dsim.px), SMB.ASSETS, M.SS_ASSETS]);
  {   /* SOXL·SOXX 열: 1994-05-04(필라델피아 반도체 지수 첫날)부터 값 · XLK: 1971-02-05(자료 첫날 — 상장 전 재현) · 그 전은 0 · 빈 날 없음
       TECL: XLK 재현을 이어 붙여 자료 첫날부터(2026-11-27 파마-프렌치 업종 재료 — XLK 식 오차가 이어 붙이기 한도 5% 안 · 처음엔 1998-12-22 부터) */
    const f = k => Dsim.px[k].findIndex(v => v > 0), F0 = { soxl: ['1994-05-04'], soxx: ['1994-05-04'], tecl: [Dsim.d[0]], xlk: [Dsim.d[0]] };
    check('시뮬레이터 자료 SOXL·SOXX 1994-05-04 · TECL·XLK 자료 첫날부터 · 그 뒤 빈 날 없음', Object.keys(F0).every(k => F0[k].indexOf(Dsim.d[f(k)]) >= 0 && Dsim.px[k].slice(f(k)).every(v => v > 0)) && Dsim.d[0] === '1971-02-05', Object.keys(F0).map(k => Dsim.d[f(k)]));
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
    for (const k of ['sig', 'ul', 'out', 'bga']) if (['sqqq', 'soxl', 'soxx', 'tecl', 'xlk'].indexOf(p[k]) >= 0) p[k] = SMB.PRESET[k];   /* TQQQ 쪽 실제 일봉 자료(D)에 없는 종목 */
    if (t % 4 === 0) Object.assign(p, SMB.PRESET);
    return p;
  }, '');
  const sIdx = i => i + (D.d[i] < '2024-05-28' ? 2 : 1);

  /* ── ④ 도우미 ── */
  {   /* 라이브러리 'SMA 200' (src/stratsim/30-library.js) = 이 화면 기본값(실전 — 자동매매 프로그램 고정 규칙) + 거래 비용 0.25% · 양도세 22% · 원천징수 15%
         (2026-11-28 사용자 결정 — 예전엔 SMB.PRESET(현금·4%·완충 0·15일 · 이 화면 기본값의 바탕)과 같았음. SMB.PRESET 은 예전 값 그대로 — 저장값 옮기기가 씀)
       · 선택지 = 시뮬레이터 편집 창(SS_PSMA) — 시뮬레이터에만 있는 세금 손잡이(tax · wht)는 이 엔진에선 run 의 tax · divTax 로 */
    const lib = fs.readFileSync(path.join(ROOT, 'src', 'stratsim', '30-library.js'), 'utf8'), i0 = lib.indexOf("name: 'SMA 200'"), m = i0 < 0 ? null : /preset:\s*\{\s*type:\s*'sma',\s*params:\s*(\{[^}]*\})/.exec(lib.slice(i0, i0 + 4000));
    const lp = m ? new Function('return ' + m[1])() : null;
    const want = Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0', din: '5', dout: '5', xb: '0.8', cost: '0.25', tax: '22', wht: '15' });
    const sj = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
    check('라이브러리 SMA 200 = 이 화면 기본값(실전) + 비용 0.25% · 양도세 22% · 원천징수 15%', !!lp && sj(lp) === sj(want), [lp, want]);
    const bi = src.indexOf('function base(mode) {'), bs = bi < 0 ? '' : src.slice(bi, bi + 1500);
    const dv = k => { const r = new RegExp('\\b' + k + " = '([^']*)'").exec(src); return r ? r[1] : null; };
    check('이 화면 기본값(실전) 손잡이 = 라이브러리 SMA 200 (팔았을 때 · 이자 · 나눠 사기 · 팔 때 완충)', bi > 0 && /SMB\.PRESET/.test(bs) && dv('DEF_OUT') === 'spy' && dv('DEF_CR') === '0' && dv('DEF_DAYS') === '5' && dv('DEF_XB') === '0.8', [dv('DEF_OUT'), dv('DEF_CR'), dv('DEF_DAYS'), dv('DEF_XB')]);
    const sp = {}; (M.SS_PSMA || []).forEach(q => { sp[q.k] = (q.opts || []).map(o => String(o[0])); });
    const same = Object.keys(SMB.OPTS).every(k => sp[k] && JSON.stringify(sp[k]) === JSON.stringify(SMB.OPTS[k].map(o => String(o[0]))));
    const TAXK = ['tax', 'wht'];
    check('선택지 = 시뮬레이터 편집 창 (세금 손잡이 tax · wht 는 시뮬레이터에만)', Object.keys(sp).length > 0 && same && Object.keys(sp).every(k => SMB.OPTS[k] || TAXK.includes(k)) && TAXK.every(k => sp[k]), Object.keys(sp));
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
      for (const k of ['sig', 'ul', 'out', 'bga']) if (['sqqq', 'soxl', 'soxx', 'tecl', 'xlk'].indexOf(p[k]) >= 0) p[k] = SMB.PRESET[k];   /* TQQQ 쪽 실제 일봉 자료(D)에 없는 종목 */
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
    const cost = pp.cost, tx2 = pp.tax, wh2 = pp.wht; delete pp.cost; delete pp.tax; delete pp.wht;
    const pe = Object.assign({}, pr ? pr.params : {}); delete pe.tax; delete pe.wht;
    check("라이브러리 'SOXL SMA 160' 프리셋 = SOXL 화면 기본값 (손잡이 전부 · 비용 0.25% · 양도세 22% · 원천징수 15% — 2026-11-28 · 번호 하나뿐 · 선택지 안)", L.length === 1 && pr.type === 'sma' && cost === '0.25' && tx2 === '22' && wh2 === '15' && sortJ(pp) === sortJ(C160) &&
      lc.__L.filter(e => e.n === L[0].n).length === 1 && sortJ(SMB.clean(pe)) === sortJ(Object.assign({}, SMB.PRESET, pe)), [L.length, pr]);
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
      check('SOXL·SOXX·TECL·XLK 칸이 있어도 TQQQ 쪽 결과 그대로 (' + tried + '가지)', same === tried, [same, tried]);
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
  /* ── ⑦ 투자전략 시뮬레이터 세금 (2026-11-28 — 양도세 22% · 분배금 미국 원천징수 15% 선택 · SMA 추세 · 그냥 보유) ──
       · 양도세: 시뮬레이터 엔진(ssRunSma) = 이 엔진 시뮬 방식 + 양도세(선입선출) — 분배금 자료를 끄면 끝 금액·낸 세금·세후 청산이 같아야 함(무작위 손잡이 × 기간)
       · 원천징수: 늘 들고 있는 설정 = 그냥 보유 — 끝 금액 = 원금 × 가격 비 × 누적 배수 · 그냥 보유 선(ssRun9) · 요약(ssRun9 r.bhTax)과 같음
       · 그냥 보유 요약은 선과 같은 길: 적립(달 중간 진입 · 상장 전) 원가 = 가격을 1로 바꾼 같은 선의 끝 값 · 중간에 뺀 돈은 그해 판 이익(손 계산)
       · 분배금 원가(양도세): 엔진 장부(묶음 나눔)와 그냥 보유 요약(원가 더함) 두 계산이 같은 세후 청산
       · 분배금 자료(divs.csv) = 가격 자료(수정주가)의 분배락일 수정 계수 변화(1 − 분배금 ÷ 전날 종가) */
  let taxN = 0;
  {
    const TX = M.DS, keepDiv = TX.divY, fxS = i => M.ssFx(i);
    check('세금 자료 읽음 (분배금 · 원/달러)', !!keepDiv && !!TX.fx && Object.keys(keepDiv).length >= 9 && TX.fx.length === Dsim.d.length, [keepDiv && Object.keys(keepDiv), TX.fx && TX.fx.length]);
    TX.divY = null;   /* 분배금을 끈 채 — 이 엔진 시뮬 방식엔 분배금이 없음 */
    let wF = 0, wT = 0, wL = 0, nTaxRow = 0, badTaxRow = 0;
    const NT = FULL ? 800 : 250;
    for (let t = 0; t < NT; t++) {
      const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.5 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
      if (t % 4 === 0) Object.assign(p, SMB.PRESET, { out: 'spy', cr: '0', din: '5', dout: '5', xb: '0.8', cost: '0.25' });
      const a = Math.floor(rnd() * (Dsim.d.length - 600)), b = Math.min(Dsim.d.length - 1, a + 300 + Math.floor(rnd() * (rnd() < 0.3 ? 15000 : 4000)));
      const cp = M.ssCleanParams('sma', Object.assign({}, p, { tax: '22', wht: '0' }));
      const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: M.ssRate9(cp), dd: true, ed: Dsim.d[a], xd: Dsim.d[b] }, M.ssOptsSma(cp)));
      const x = SMB.run(Dsim, p, { from: a, to: b, capital: 100000, mode: 'sim', tax: { fx: fxS, method: 'fifo' }, intTax: 0 });
      const v = r.points[r.points.length - 1].value, rel = (u, w) => Math.abs(u - w) / Math.max(1, Math.abs(w));
      wF = Math.max(wF, rel(v, x.final)); wT = Math.max(wT, rel(r.tax.paid, x.taxPaid)); wL = Math.max(wL, rel(r.tax.liq, x.liq));
      if (rel(v, x.final) > 1e-9 && wF === rel(v, x.final)) check('양도세 대조 한 건', false, [Dsim.d[a], Dsim.d[b], p, v, x.final]);
      /* 기록의 TAX 행 = 지금 든 것 그대로(다 팔렸으면 현금) — 종목별 보유 기간·다음 행 '무엇 → 무엇' 이 세금 낸 날에 바뀌지 않게 */
      for (let i = 1; i < r.log.length; i++) if (r.log[i].action === 'TAX') { nTaxRow++; if (r.log[i].held !== (r.log[i].shares > 0 ? r.log[i - 1].held : 'cash')) badTaxRow++; }
      taxN++;
    }
    check('시뮬레이터 양도세 = 이 엔진 시뮬 방식 + 양도세: 끝 금액 (상대 1e-9 · ' + NT + '번)', wF < 1e-9, wF);
    check('시뮬레이터 양도세 = 이 엔진: 낸 양도세 · 끝 날 세후 청산', wT < 1e-9 && wL < 1e-9, [wT, wL]);
    check('기록의 TAX 행 = 지금 든 것 (' + nTaxRow + '행)', nTaxRow > 50 && badTaxRow === 0, [nTaxRow, badTaxRow]);
    TX.divY = keepDiv;
    /* 원천징수 — 늘 들고 있는 SMA(신호 QQQ 10일선 · 50% 넘게 아래일 때만 팖 · 과열·식음·버블 끔 · 비용 0) = 그냥 보유 */
    const ALW = { sig: 'qqq', win: '10', ul: 'tqqq', cr: '0', eb: '0', xb: '50', oh: '0', cool: '0', ohw: '9', coolw: '7', cb: '0', cs: '0', settle: '0', out: 'cash', din: '0', dout: '0', bg: '0', bga: 'tqqq', bgw: '200', cost: '0' };
    const smA = SMB.sma(Dsim.px.qqq, 10);
    let okW = 0, okL = 0, nW = 0, wA = 0, wB = 0, wC = 0;
    for (const [d0, d1, ul] of [['2011-03-01', '2026-11-27', 'tqqq'], ['2000-01-03', '2026-11-27', 'qqq'], ['1995-01-03', '2026-11-27', 'spy'], ['2015-06-01', '2025-12-31', 'soxl'], ['2010-06-01', '2026-11-27', 'tecl']]) {
      let a = Dsim.d.findIndex(x => x >= d0); while (a > 0 && !(Dsim.px.qqq[a] > smA[a])) a++;   /* 첫날 '보유' 인 날로 */
      const b = Dsim.d.lastIndexOf(d1 <= Dsim.d[Dsim.d.length - 1] ? d1 : Dsim.d[Dsim.d.length - 1]);
      const P = Dsim.px[ul] || M.DS.days.map(x => x[ul]), WF = M.ssWhtFactor(ul, 0.15);
      const cp = M.ssCleanParams('sma', Object.assign({}, ALW, { ul, bga: ul, tax: '22', wht: '15' }));
      const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: 0, dd: true, ed: Dsim.d[a], xd: Dsim.d[b] }, M.ssOptsSma(cp)));
      const v = r.points[r.points.length - 1].value, want = 100000 * M.DS.days[b][ul] / M.DS.days[a][ul] * (WF ? WF[b] / WF[a] : 1);
      const sold = r.log.some(l => l.action === 'EXIT' || l.action === 'TAX');
      nW++;
      const r9 = M.ssRun9({ initial: 100000, monthly: 0, raise: 0, rate: 0, qi0: 0, qi1: 1, ed: Dsim.d[a], xd: Dsim.d[b], rows: M.ssExactRows('quarterly', Dsim.d[a], Dsim.d[b]), bhWht: 0.15, bhTax: { key: ul, tax: 0.22 } });
      const bh = r9.bh[ul], bv = bh[bh.length - 1].value, s2 = { end: r9.bhTax.end, wht: r9.bhTax.wht, liq: r9.bhTax.end - r9.bhTax.due };
      const rel = (u, w2) => Math.abs(u - w2) / Math.max(1, Math.abs(w2));
      wA = Math.max(wA, rel(v, want)); wB = Math.max(wB, rel(bv, want)); wC = Math.max(wC, rel(s2.end, want));
      if (!sold && rel(v, want) < 1e-9 && rel(bv, want) < 1e-9 && rel(s2.end, want) < 1e-9) okW++;
      /* 분배금 원가: 엔진 장부(묶음 나눔) 세후 청산 = 그냥 보유 요약(원가 더함) — 같은 원천징수 · 같은 원가 · 비용 0 */
      if (!sold && rel(r.tax.liq, s2.liq) < 1e-9 && rel(r.tax.whtPaid, s2.wht) < 1e-9 && r.tax.whtPaid > 0) okL++;
      else check('분배금 원가 대조 ' + ul, false, [r.tax.liq, s2.liq, r.tax.whtPaid, s2.wht, sold]);
    }
    check('원천징수: 늘 보유 SMA = 원금 × 가격 비 × 누적 배수 = 그냥 보유 선 = 그냥 보유 요약 (TQQQ·QQQ·SPY·SOXL·TECL)', okW === nW, [okW, nW, wA, wB, wC]);
    check('분배금 원가: 엔진 장부 세후 청산 = 그냥 보유 요약 · 원천징수 금액 같음', okL === nW, [okL, nW]);
    /* 원천징수가 없으면(끔 · 자료 없음) 예전과 같은 값 — 그냥 보유 선 · SMA */
    {
      const q = M.ssExactRows('quarterly', '2010-03-31', '2025-12-31');
      const b0 = M.ssRun9({ initial: 10000, monthly: 500, raise: 0, rate: 0.04, qi0: 0, qi1: 1, ed: '2010-03-31', xd: '2025-12-31', rows: q }).bh.tqqq;
      const b1 = M.ssRun9({ initial: 10000, monthly: 500, raise: 0, rate: 0.04, qi0: 0, qi1: 1, ed: '2010-03-31', xd: '2025-12-31', rows: q, bhWht: 0 }).bh.tqqq;
      const b2 = M.ssRun9({ initial: 10000, monthly: 500, raise: 0, rate: 0.04, qi0: 0, qi1: 1, ed: '2010-03-31', xd: '2025-12-31', rows: q, bhWht: 0.15 }).bh.tqqq;
      check('그냥 보유: 원천징수 끔 = 예전 값(한 글자도 같음) · 켬 = 조금 작음', JSON.stringify(b0) === JSON.stringify(b1) && b2[b2.length - 1].value < b0[b0.length - 1].value && b2[b2.length - 1].value > b0[b0.length - 1].value * 0.98, [b0[b0.length - 1].value, b2[b2.length - 1].value]);
    }
    /* 중간에 뺀 돈(실제 거래내역)도 판 것 — 늘 보유 SMA · 비용 0 · 분배금 끔: 판 이익(원화) − 250만 원 × 22% 를 이듬해 5월 첫 거래일에 냄 (손 계산과 같음) */
    {
      TX.divY = null;
      const a = Dsim.d.indexOf('2016-03-01') >= 0 ? Dsim.d.indexOf('2016-03-01') : Dsim.d.findIndex(x => x >= '2016-03-01');
      let a2 = a; while (!(Dsim.px.qqq[a2] > smA[a2])) a2++;
      const t = Dsim.d.findIndex(x => x >= '2017-07-03'), b = Dsim.d.findIndex(x => x >= '2018-12-31');
      const sched = { byDate: new Map([[Dsim.d[t], -60000]]), byMonth: new Map(), list: [{ date: Dsim.d[t], amount: -60000 }] };
      const cp = M.ssCleanParams('sma', Object.assign({}, ALW, { ul: 'qqq', bga: 'qqq', tax: '22', wht: '0' }));
      const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: 0, dd: true, ed: Dsim.d[a2], xd: Dsim.d[b], sched }, M.ssOptsSma(cp)));
      const st = i => i + (Dsim.d[i] < '2024-05-28' ? 2 : 1), P = i => M.DS.days[i].qqq;
      const sh0 = 100000 / P(a2), unit = 100000 * fxS(st(a2)) / sh0, q = 60000 / P(t), gain = 60000 * fxS(st(t)) - q * unit;
      const yT = +Dsim.d[st(t)].slice(0, 4), pay = Dsim.d.findIndex(x => x >= (yT + 1) + '-05-01'), want = Math.max(0, gain - 2500000) * 0.22 / fxS(pay);
      const tl = r.log.filter(l => l.action === 'TAX');
      check('중간에 뺀 돈의 양도세 = 손 계산 (판 이익 − 250만 원 × 22% · 이듬해 5월 첫 거래일)', r.tax && Math.abs(r.tax.paid - want) < 1e-6 * want && tl.length === 1 && tl[0].date === Dsim.d[pay] && want > 1000, [r.tax && r.tax.paid, want, tl.map(l => l.date), Dsim.d[pay]]);
      TX.divY = keepDiv;
    }
    /* 팔 것이 없어 못 낸 양도세(빚 · taxExt): 평가금 = −빚 · 낙폭 자료의 현금도 −빚 · 기록의 주식 평가금은 0(빚을 주식에서 빼지 않음) · TAX 행은 지금 든 것(현금) */
    {
      TX.divY = null;
      let a = Dsim.d.findIndex(x => x >= '2016-03-01'); while (!(Dsim.px.qqq[a] > smA[a])) a++;
      const t = Dsim.d.findIndex(x => x >= '2017-07-03'), b = Dsim.d.findIndex(x => x >= '2019-12-31');
      const sched = { byDate: new Map([[Dsim.d[t], -1e8]]), byMonth: new Map(), list: [{ date: Dsim.d[t], amount: -1e8 }] };
      const cp = M.ssCleanParams('sma', Object.assign({}, ALW, { ul: 'qqq', bga: 'qqq', tax: '22', wht: '0' }));
      const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: 0, dd: true, ed: Dsim.d[a], xd: Dsim.d[b], sched }, M.ssOptsSma(cp)));
      const ext = r.tax && r.tax.ext, end = r.log[r.log.length - 1], tl = r.log.filter(l => l.action === 'TAX'), ld = r.dd[r.dd.length - 1];
      check('못 낸 양도세(빚): 평가금 = −빚 · 낙폭 자료 현금 = −빚 · 주식 평가금 0 · TAX 행 = 현금', ext > 1000 && Math.abs(r.points[r.points.length - 1].value + ext) < 1e-6 && Math.abs(ld.cash + ext) < 1e-6
        && Math.abs(end.stockVal) < 1e-9 && tl.length === 1 && tl[0].held === 'cash' && Math.abs(tl[0].stockVal) < 1e-9, [ext, r.points[r.points.length - 1].value, ld, end.stockVal, tl.map(l => [l.held, l.stockVal])]);
      TX.divY = keepDiv;
    }
    /* 그냥 보유 요약 = 선과 같은 길 (2026-11-28 검토 결함 — 예전 요약은 따로 날마다 셈: 달 중간 진입의 그달 적립 · 상장 전 원금이 선과 달랐음)
         · 환율 고정(자료 끔 → 1,300원) · 분배금 끔: 원가 = 선에 들어간 달러 = 그 종목 가격을 1로 바꾼 같은 선의 끝 값
           → 낼 양도세 = max(0, (끝 값 − 들어간 달러) × 1,300 − 250만) × 22% ÷ 1,300  (적립 · 달 중간 진입 · 상장 전 · 실제 거래내역 날짜) */
    {
      const keepFx = TX.fx, keepDivB = TX.divY, SAVE = {};
      for (const k of ['days', 'rows', 'idx', 'q', 'm', 'w', 'y', 'mIn', 'nfci', 'smaD', 'smaM', 'rsiD', 'rsiM', 'whtF', 'divY', 'fx']) SAVE[k] = M.DS[k];
      const cases = [['tqqq', '2010-03-15', '2025-11-20', 500, 0.03, null], ['spy', '1995-02-14', '2026-11-27', 300, 0, null], ['soxl', '1990-05-10', '2000-03-10', 200, 0, null],
        ['qqq', '2001-07-17', '2019-08-14', 1000, 0.05, null], ['tecl', '2009-01-02', '2024-06-12', 0, 0, [['2012-02-15', 5000], ['2015-11-03', 7000], ['2020-03-23', 20000], ['2024-06-12', 3000]]]];
      const runB = (key, d0, d1, mo, ra, lst) => {
        const sched = lst ? { byDate: new Map(lst), byMonth: new Map(), list: lst.map(([date, amount]) => ({ date, amount })) } : undefined;
        return M.ssRun9({ initial: 10000, monthly: mo, raise: ra, rate: 0, qi0: 0, qi1: 1, ed: d0, xd: d1, rows: M.ssExactRows('quarterly', d0, d1), sched, bhTax: { key, tax: 0.22 } });
      };
      let okP = 0, wP = 0;
      const real = cases.map(([key, d0, d1, mo, ra, lst]) => { M.DS.fx = null; M.DS.divY = null; return runB(key, d0, d1, mo, ra, lst); });
      const unit = {};
      cases.forEach(([key, d0, d1, mo, ra, lst], ci) => {
        M.ssInitData(SAVE.days.map(d => { const c = Object.assign({}, d); if (c[key] > 0) c[key] = 1; return c; }), null);
        M.DS.fx = null; M.DS.divY = null;
        const rc = runB(key, d0, d1, mo, ra, lst), cb = rc.bh[key];
        unit[ci] = cb[cb.length - 1].value;
      });
      Object.assign(M.DS, SAVE);
      cases.forEach(([key, d0, d1], ci) => {
        const r = real[ci], b = r.bh[key], V = b[b.length - 1].value, C = unit[ci];
        const want = Math.max(0, (V - C) * 1300 - 2500000) * 0.22 / 1300, got = r.bhTax && r.bhTax.due;
        const e = Math.abs(got - want) / Math.max(1, want); wP = Math.max(wP, e);
        if (e < 1e-9 && r.bhTax.end === V && want > 0) okP++; else check('그냥 보유 요약 길 ' + key + ' ' + d0, false, [got, want, V, C]);
      });
      check('그냥 보유 요약 = 선과 같은 길: 원가 = 가격 1 선의 끝 값 (적립·달 중간 진입·상장 전 SOXL·실제 거래내역 날짜 · ' + cases.length + '가지)', okP === cases.length, [okP, wP]);
      /* 넣은 돈: 그냥 보유 선에 실제로 들어간 달러(가격 1 선의 끝 값) = SMA 엔진 넣은 돈 = 9sig 넣은 돈 — 가격이 늘 있는 종목 (2026-11-28 · 예전엔 달 중간 진입이면 그냥 보유·9sig 만 한 달 치 더) */
      let okU = 0, nU = 0;
      cases.forEach(([key, d0, d1, mo, ra, lst], ci) => {
        if (key === 'soxl') return;
        nU++;
        const sched = lst ? { byDate: new Map(lst), byMonth: new Map(), list: lst.map(([date, amount]) => ({ date, amount })) } : undefined;
        const rs = M.ssRunSma(Object.assign({ initial: 10000, monthly: mo, raise: ra, rate: 0, ed: d0, xd: d1, sched }, M.ssOptsSma(M.ssCleanParams('sma', {}))));
        if (Math.abs(unit[ci] - rs.contributed) < 1e-6 && Math.abs(real[ci].contributed - rs.contributed) < 1e-6) okU++;
        else check('넣은 돈 ' + key + ' ' + d0, false, [unit[ci], rs.contributed, real[ci].contributed]);
      });
      check('넣은 돈: 그냥 보유 선에 들어간 달러 = SMA = 9sig (' + nU + '가지 · 달 중간 진입 포함)', okU === nU && nU === 4, [okU, nU]);
      check('그냥 보유 요약 시험 뒤 자료 되돌림', M.DS.days === SAVE.days && M.DS.fx === keepFx && M.DS.divY === keepDivB && M.DS.idx.size === Dsim.d.length);
    }
    /* 그냥 보유 · 적립 + 분배금 + 원천징수 + 양도세 = 늘 보유 SMA(실제 거래내역 날짜 적립 · 비용 0) — 엔진 장부(선입선출 · 묶음 나눔)와 같은 세후 청산 */
    {
      const lst = [['2012-02-15', 5000], ['2013-05-06', 3000], ['2016-11-09', 8000], ['2020-03-23', 20000], ['2022-10-13', 6000]];
      const sched = { byDate: new Map(lst), byMonth: new Map(), list: lst.map(([date, amount]) => ({ date, amount })) };
      let a = Dsim.d.findIndex(x => x >= '2011-03-01'); while (!(Dsim.px.qqq[a] > smA[a])) a++;
      const b = Dsim.d.lastIndexOf('2026-11-27') >= 0 ? Dsim.d.lastIndexOf('2026-11-27') : Dsim.d.length - 1;
      let okS = 0;
      for (const ul of ['tqqq', 'qqq', 'spy']) {
        const cp = M.ssCleanParams('sma', Object.assign({}, ALW, { ul, bga: ul, tax: '22', wht: '15' }));
        const r = M.ssRunSma(Object.assign({ initial: 100000, monthly: 0, raise: 0, rate: 0, dd: true, ed: Dsim.d[a], xd: Dsim.d[b], sched }, M.ssOptsSma(cp)));
        const r9 = M.ssRun9({ initial: 100000, monthly: 0, raise: 0, rate: 0, qi0: 0, qi1: 1, ed: Dsim.d[a], xd: Dsim.d[b], rows: M.ssExactRows('quarterly', Dsim.d[a], Dsim.d[b]), sched, bhWht: 0.15, bhTax: { key: ul, tax: 0.22 } });
        const v = r.points[r.points.length - 1].value, sold = r.log.some(l => l.action === 'EXIT' || l.action === 'TAX'), rel = (u, w2) => Math.abs(u - w2) / Math.max(1, Math.abs(w2));
        const t9 = r9.bhTax, liq9 = t9.end - t9.due;
        if (!sold && rel(v, t9.end) < 1e-9 && rel(r.tax.liq, liq9) < 1e-9 && rel(r.tax.whtPaid, t9.wht) < 1e-9 && t9.due > 0) okS++;
        else check('적립 + 세금 대조 ' + ul, false, [v, t9.end, r.tax.liq, liq9, r.tax.whtPaid, t9.wht, sold]);
      }
      check('그냥 보유 · 적립 + 분배금 원천징수 + 양도세 = 늘 보유 SMA 엔진 장부 (끝 값 · 세후 청산 · 원천징수 · TQQQ·QQQ·SPY)', okS === 3, okS);
    }
    /* 그냥 보유 · 중간에 뺀 돈 = 평균 단가로 판 것 · 그해 이익과 끝 해 이익을 따로 공제 (손 계산 · 분배금 끔 · 실제 환율) */
    {
      TX.divY = null;
      const a = Dsim.d.findIndex(x => x >= '2016-03-01'), t = Dsim.d.findIndex(x => x >= '2017-07-03'), b = Dsim.d.findIndex(x => x >= '2018-12-31');
      const sched = { byDate: new Map([[Dsim.d[t], -60000]]), byMonth: new Map(), list: [{ date: Dsim.d[t], amount: -60000 }] };
      const r9 = M.ssRun9({ initial: 100000, monthly: 0, raise: 0, rate: 0, qi0: 0, qi1: 1, ed: Dsim.d[a], xd: Dsim.d[b], rows: M.ssExactRows('quarterly', Dsim.d[a], Dsim.d[b]), sched, bhTax: { key: 'qqq', tax: 0.22 } });
      const st = i => Math.min(Dsim.d.length - 1, i + (Dsim.d[i] < '2024-05-28' ? 2 : 1)), P = i => M.DS.days[i].qqq;
      const n0 = 100000 / P(a), b0 = 100000 * fxS(st(a)), v = n0 * P(t), f = 60000 / v, realT = f * (v * fxS(st(t)) - b0), b1 = b0 * (1 - f), n1 = n0 - 60000 / P(t);
      const V = n1 * P(b), yT = +Dsim.d[st(t)].slice(0, 4), yB = +Dsim.d[st(b)].slice(0, 4);
      const dueK = (yT !== yB ? Math.max(0, realT - 2500000) * 0.22 + Math.max(0, V * fxS(st(b)) - b1 - 2500000) * 0.22 : Math.max(0, realT + V * fxS(st(b)) - b1 - 2500000) * 0.22);
      const want = dueK / fxS(b), got = r9.bhTax.due;
      check('그냥 보유 · 중간에 뺀 돈 = 손 계산 (평균 단가 · 해마다 공제 · ' + yT + '·' + yB + ')', yT !== yB && Math.abs(got - want) < 1e-9 * want && Math.abs(r9.bhTax.end - V) < 1e-9 * V && realT > 2500000, [got, want, r9.bhTax.end, V, realT]);
      TX.divY = keepDiv;
    }
    /* 적립 + 세금: 숫자가 이상하지 않음(NaN·음수 없음 · 세금 켬 ≤ 끔 · 세후 청산 ≤ 끝 금액) */
    {
      const cp0 = M.ssCleanParams('sma', Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0', din: '5', dout: '5', xb: '0.8', cost: '0.25' }));
      const go = (tax, wht) => { const c = Object.assign({}, cp0, { tax, wht }); return M.ssRunSma(Object.assign({ initial: 10000, monthly: 500, raise: 0.03, rate: 0, dd: true, ed: '1995-01-03', xd: '2026-11-27' }, M.ssOptsSma(c))); };
      const r0 = go('0', '0'), r1 = go('22', '15'), f0 = r0.points[r0.points.length - 1].value, f1 = r1.points[r1.points.length - 1].value;
      check('적립 + 세금: 켬 < 끔 · 세후 청산 ≤ 끝 금액 · 낸 양도세 > 0 · 값이 모두 수', f1 < f0 && r1.tax.liq <= f1 + 1e-6 && r1.tax.paid > 0 && r1.points.every(pt => Number.isFinite(pt.value) && pt.value > 0) && r1.log.some(l => l.action === 'TAX'), [f0, f1, r1.tax]);
    }
    /* 분배금 자료 = 가격 자료의 분배락일 수정 계수 변화 — 상장 뒤 실제 일봉(data/etfcagr.json · 분할만 반영)로 확인 */
    {
      const J = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'etfcagr.json'), 'utf8')).series;
      const day = (x) => new Date(x * 864e5).toISOString().slice(0, 10);
      let nn = 0, bb = 0;
      const rows = fs.readFileSync(path.join(ROOT, 'data', 'stratsim', 'divs.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
      for (const ln of rows) {
        const [d8, k, dvs, pcs] = ln.split(','), d = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8), S2 = J[k.toUpperCase()];
        const i = Dsim.d.indexOf(d); if (i < 1 || !S2) continue;
        let x = S2.d0; const m = {}; for (let j = 0; j < S2.c.length; j++) { if (j) x += S2.dd[j - 1]; m[day(x)] = S2.c[j]; }
        const dp = Dsim.d[i - 1]; if (!m[d] || !m[dp]) continue;
        const pk = M.DS.days[i][k], pk0 = M.DS.days[i - 1][k]; if (!(pk > 0 && pk0 > 0)) continue;
        const yy = 1 - (pk0 / m[dp]) / (pk / m[d]), y = +dvs / +pcs; nn++;
        if (Math.abs(yy - y) > Math.max(2e-4, 0.05 * y)) { bb++; if (bb < 4) check('분배금 ' + k + ' ' + d, false, [y, yy]); }
        if (nn >= 600) break;
      }
      check('분배금 자료 = 수정주가의 분배락일 계수 변화 (5% 안 · ' + nn + '건)', nn >= 300 && bb === 0, [nn, bb]);
      /* 원천징수 몫 g(ssDivShare) = 그날 평가금 중 분배금 몫 — 실제 종가(분할만 반영)로 따로 셈: 분배금 × (1 − 분배금 ÷ 전날 종가) ÷ 그날 종가 (0.1% 안) */
      let ng = 0, wg = 0;
      for (const ln of rows) {
        const [d8, k, dvs, pcs] = ln.split(','), d = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8), S2 = J[k.toUpperCase()], i = M.DS.idx.get(d);
        if (i == null || !S2) continue;
        let x = S2.d0; const m = {}; for (let j = 0; j < S2.c.length; j++) { if (j) x += S2.dd[j - 1]; m[day(x)] = S2.c[j]; }
        if (!m[d]) continue;
        const y = +dvs / +pcs, truth = +dvs * (1 - y) / m[d];
        wg = Math.max(wg, Math.abs(M.ssDivShare(k, i) / truth - 1)); ng++;
      }
      check('원천징수 몫 = 실제 종가로 셈한 그날 분배금 몫 (0.1% 안 · ' + ng + '건)', ng >= 300 && wg < 1e-3, [ng, wg]);
    }
  }
  console.log((bad ? 'FAIL ' : '') + 'sma200_test: ' + ok + '개 통과 · ' + bad + '개 실패 (시뮬레이터 대조 ' + n1 + '번 · 실전·세금 검산 TQQQ ' + runs + '번 · SOXL ' + runsX + '번 · 시뮬레이터 세금 대조 ' + taxN + '번)');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL 예외 ' + (e && e.stack || e)); process.exit(1); });
