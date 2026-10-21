/* SMA 200 백테스트 엔진([SMA200-ENG] SMB) 검사 — node tests/sma200_test.cjs [--full]  (run_regression.py 가 자동 실행)
   · src/index.html 의 SMB · MBT 를 그대로 꺼내 씀 (관리자 화면 /sma200/ 과 같은 코드) · 비교 기준 = 투자전략 시뮬레이터 엔진(scripts/stratsim_fit.cjs 가 꺼낸 ssRunSma)
   · ① 시뮬레이터와 같게: 무작위 손잡이 조합(선택지 전부) × 무작위 기간(1953~) — 끝 금액 차이 0 · 날마다 평가금 = 시뮬레이터 보유(dd) × 종가 · 최대 낙폭 같음
   · ② 실전(1주 단위 · 수수료 = 체결 금액 × 수수료율 · SEC · 분배금 원천징수)·시뮬 방식 × 양도세(선입선출·이동평균) × 이자세 — 거래 기록만으로 따로 다시 계산:
        날마다 현금·주식 · 매수·매도 금액 · 분배금 · 현금 이자 · 연도별 원화 손익(결제일 환율·결제일 연도) · 세액 · 납부일(다음 해 5/31 이후 첫 거래일) · 납부액(그날 환율) · 끝날 정리 값 · 평가금
        + 규칙: 실전은 소수 주 없음 · 현금 음수 없음 · 보유하기로 한 날은 1주 값보다 적은 현금만 남음
   · ③ 자료: 실제 일봉 달력(빠진 날 0 · 달력 밖 날 0) · 프리셋 첫 시작 가능일 = 쓰는 지표가 모두 나온 첫날(따로 계산)
   · ④ 도우미: clean(선택지 밖 → 프리셋) · stats(연평균·낙폭 식) · bh(그냥 보유 세전·세후 따로 계산) · plan(매월 첫 거래일 · 끝 20거래일 전) · one = run + stats + bh
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
let ok = 0, bad = 0;
function check(name, cond, info) { if (cond) ok++; else { bad++; if (bad < 40) console.log('FAIL ' + name + (info !== undefined ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)).slice(0, 400) : '')); } }
let seed = 20261021; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];

(async () => {
  /* ── ① 시뮬레이터와 같게 ── */
  const Dsim = SMB.fromCsv(fs.readFileSync(path.join(ROOT, 'data', 'stratsim', 'prices.csv'), 'utf8'));
  check('시뮬레이터 자료 달력 = 시뮬레이터', Dsim.d.length === DS.days.length && Dsim.d.every((x, i) => x === DS.days[i].date));
  for (const k of SMB.ASSETS) check('시뮬레이터 자료 가격 ' + k, Dsim.px[k].every((v, i) => v === DS.days[i][k] || (Number.isNaN(v) && Number.isNaN(DS.days[i][k]))));
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

  /* ── ② 실전·세금 독립 검산 ── */
  const sIdx = i => i + (D.d[i] < '2024-05-28' ? 2 : 1);
  const yr = i => { const j = sIdx(i); if (j < N) return +D.d[j].slice(0, 4); const t = new Date(D.d[N - 1] + 'T12:00:00Z'); let m = j - (N - 1); while (m > 0) { t.setUTCDate(t.getUTCDate() + 1); if (t.getUTCDay() % 6) m--; } return t.getUTCFullYear(); };
  const fxA = i => fx[Math.min(N - 1, sIdx(i))];
  const NR = FULL ? 1200 : 250;
  let runs = 0, wPer = 0, wG = 0, wLiq = 0, wDiv = 0, wInt = 0, wEq = 0, nTaxSell = 0, nPaid = 0, nDiv = 0;
  for (let t = 0; t < NR; t++) {
    const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.6 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
    for (const k of ['sig', 'ul', 'out', 'bga']) if (p[k] === 'sqqq') p[k] = SMB.PRESET[k];
    if (t % 4 === 0) Object.assign(p, SMB.PRESET);
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
      if (T.paid && T.paid !== '-') { if (T.paid < (T.y + 1) + '-05-31') check('5/31 전 납부 없음', false, T); const pi = D.d.indexOf(T.paid); if (pi > a && D.d[pi - 1] >= (T.y + 1) + '-05-31') check('5/31 뒤 첫 거래일에 납부', false, T); }
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
  check('실전·세금: 연도별 원화 손익 (' + runs + '번)', wG < 1e-12, wG);
  check('실전·세금: 끝날 정리 값', wLiq < 1e-9, wLiq);
  check('보유 구간 손익 합 + 분배금 + 이자 − 양도세 = 끝 평가금 − 원금', wPer < 1e-9, wPer);
  check('실전·세금: 분배금 합', wDiv < 1e-9, wDiv);
  check('실전·세금: 이자 합', wInt < 1e-8, wInt);
  check('실전·세금: 날마다 평가금', wEq < 1e-9, wEq);
  check('검산이 실제로 세금 납부·세금 내려 판 날·분배금을 지나감', nPaid > 20 && nTaxSell > 3 && nDiv > 20, [nPaid, nTaxSell, nDiv]);

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
    const D0 = Object.assign({}, D, { dv: null, _ind: D._ind });
    const NT = FULL ? 800 : 200; let nT = 0, nTop = 0, nSet = 0, nTax = 0, nSmall = 0, nNoBuy = 0;
    const cases = [[Object.assign({}, SMB.PRESET, { settle: '3' }), 0, 1e10, 0, false, true], [Object.assign({}, SMB.PRESET, { settle: '5' }), 0, 1e10, 0, false, true], [Object.assign({}, SMB.PRESET), 1, 1e10, 0, false, true]];
    for (let t = 0; t < NT; t++) {
      const p = {}; for (const k in SMB.OPTS) p[k] = rnd() < 0.5 ? SMB.PRESET[k] : pick(SMB.OPTS[k])[0];
      for (const k of ['sig', 'ul', 'out', 'bga']) if (p[k] === 'sqqq') p[k] = SMB.PRESET[k];
      if (t % 3 === 0) p.settle = pick(['2', '3', '4', '5']);
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
        if (j && !withTax && (x.sb !== x.b.length > 0 || x.ss !== x.s.length > 0)) { check('시뮬 방식: 산 날·판 날 표시 = 실제 매매', false, [D.d[x.i], p]); break; }
        if (j && (x.st !== y.st || x.tgt !== y.tgt || x.ease !== y.ease || x.bg !== y.bg || !!x.sb !== !!y.sb || !!x.ss !== !!y.ss)) {
          check('실전 = 시뮬 방식과 같은 날 사고팖', false, [D.d[x.i], lag, cap, fee, withTax, p, [x.st, y.st, x.tgt, y.tgt, x.ease, y.ease, x.sb, y.sb, x.ss, y.ss]]); break;
        }
        if (y.b.some(q => q.top) && (y.sb || SMB.ASSETS.some(k => k !== y.tgt && y.sh[k] > 0))) { check('잔돈 매수는 목표 종목만 들고 있을 때 · 결정한 매수와 같은 날 아님', false, [D.d[y.i], p]); break; }
      }
    }
    check('실전 = 시뮬 방식 날짜 (' + nT + '번 · 결제 대기 2일 이상 ' + nSet + ' · 양도세 ' + nTax + ' · 작은 원금 ' + nSmall + ' · 잔돈 매수 ' + nTop + '일 · 1주도 못 산 회차 ' + nNoBuy + '일)',
      nT > 100 && nSet > 30 && nTax > 30 && nSmall > 30 && nTop > 100 && nNoBuy > 10, [nT, nSet, nTax, nSmall, nTop, nNoBuy]);
    /* 검토에서 나온 두 경우 그대로 */
    { const p = { sig: 'tqqq', win: '110', ul: 'qld', eb: '10', xb: '8', cb: '3', cs: '2', settle: '2', ohw: '4', oh: '45', coolw: '2', cool: '65', out: 'qqq', cr: '7.5', din: '11', dout: '126', bga: 'spy', bg: '50', bgw: '130' };
      const a = D.d.indexOf('2015-02-02'), o = { from: a, to: N - 1, capital: 1e5, fee: 0.0025, sec: 0.0000206, divTax: 0.15, intTax: 0, tax: { fx: i => fx[i], method: 'fifo' }, rows: true };
      const R = SMB.run(D, p, Object.assign({ mode: 'real' }, o)), i = D.d.indexOf('2018-05-31'), r = R.rows.find(x => x.i === i + 1);
      check('세금 낸 날 남은 잔돈이 나눠 사기·매도를 막지 않음(2018-06-01 QLD 매도)', a > 0 && i > 0 && r && r.s.some(s => s.k === 'qld' && !s.tax), r && r.s); }
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
  console.log((bad ? 'FAIL ' : '') + 'sma200_test: ' + ok + '개 통과 · ' + bad + '개 실패 (시뮬레이터 대조 ' + n1 + '번 · 실전·세금 검산 ' + runs + '번)');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL 예외 ' + (e && e.stack || e)); process.exit(1); });
