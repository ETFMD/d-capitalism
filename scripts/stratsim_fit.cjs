#!/usr/bin/env node
/* [STRATSIM-FIT] 과최적화 탐색기 자료 — data/stratsim/fit-9sig.json · data/stratsim/fit-sma.json
   · 후보 설정: scripts/stratsim_fit_seed.json (기간·목표별 최적화 후보 — 설정만 있고 수치는 없음)
   · 계산: 투자전략 시뮬레이터 화면 코드(src/stratsim/*.js)를 그대로 불러와 화면과 똑같이 계산
     (시작 $10,000 + 매달 $500 · 9sig 현금 이자 4% · SMA 현금 이자 0% · 거래 비용 0.02% · 맞춘 구간 끝 = 2025년 12월 31일)
   · 맞춘 구간 지표(연평균·끝 금액·낙폭·샤프·소르티노·칼마·쏠림·보유 대비·작동 규칙·강건성·1990~2010)는
     계산 코드나 후보가 바뀔 때만 다시 계산(오래 걸림 — SMA 약 20분), 2026년 이후 구간·1990~최신 지표는 매일
   사용: node scripts/stratsim_fit.cjs [--full] [--kind 9sig|sma] [--limit 행수(시험용)]
   결과가 바뀔 때만 파일을 씀 (계산 시각만 바뀐 경우 제외) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'stratsim');
const ENGINE_FILES = ['00-core.js', '05-params.js', '10-engine.js', '40-state.js', '41-render.js'];
const HASH_FILES = ['00-core.js', '05-params.js', '10-engine.js'];   // 계산 결과를 바꾸는 파일 (41-render 의 ssCfgSeries 를 바꾸면 --full 로 다시)
const FIT_END = '2025-12-31';
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const ONLY = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;
const LIMIT = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : 0;

// ── 화면 계산 코드 불러오기 (화면을 그리는 함수는 빈 함수로) ──
function loadEngine() {
  const stubs = [
    'const ssPeriodUI = { update() {} };', 'const ssSideUI = { update() {} };',
    'function ssChartUpdate() {}', 'function ssAfterRender() {}', 'function ssTxEffective() { return null; }', 'const SB = { res: {}, yday: {} };',
    'function ssScheduleRun() {}', 'function ssCustomSig() { return ""; }', 'function ssCustomGlobals() { return {}; }',
  ].join('\n');
  const body = ENGINE_FILES.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
  const src = stubs + '\n' + body + '\n;ssReady = true;';
  const names = [...new Set([...src.matchAll(/^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=/gm)].map((m) => m[1] || m[2]))];
  const ctx = { console, Map, Set, Math, Date, JSON, Number, String, Array, Object, Boolean, RegExp, Error, parseFloat, parseInt, isFinite, Infinity, NaN, Float64Array, Uint8Array, Promise, setTimeout, clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {} } };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__M = {' + names.join(',') + '};', ctx, { filename: 'stratsim-engine.js' });
  const M = ctx.__M;
  const prices = fs.readFileSync(path.join(ROOT, 'data', 'stratsim', 'prices.csv'), 'utf8');
  const nfci = fs.readFileSync(path.join(ROOT, 'data', 'stratsim', 'nfci.csv'), 'utf8');
  M.ssInitData(M.ssParsePrices(prices), M.ssParseNfci(nfci));
  return M;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// 맞춘 구간(고정) 지표의 정의가 바뀌면 이 숫자를 올림 → 다음 실행이 전체를 다시 계산
const STATIC_VER = 2;   // 2: 연평균·낙폭을 소수 넷째 자리까지 (화면에서 한 번만 반올림되게)
const engineHash = sha(HASH_FILES.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n') + '|static-v' + STATIC_VER);

const M = loadEngine();
const DS = M.DS, Q = DS.q, S = M.S;
const qOfMonth = (ym) => Q.findIndex((r) => r[0].slice(0, 7) === ym);
const X_FIT = qOfMonth(FIT_END.slice(0, 7)), X_LAST = Q.length - 1, X_2010 = qOfMonth('2010-03');
if (X_FIT < 0 || Q[X_FIT][0] !== FIT_END) throw new Error('맞춘 구간 끝 분기를 찾지 못함: ' + FIT_END);
const LAST_DAY = DS.days[DS.days.length - 1].date;
const DEC_DAY = DS.days.filter((d) => d.date <= FIT_END).pop().date;

// ── 한 구간의 화면 조건(ctx) — 화면과 같은 방식으로 한 번 그려서 얻음 ──
const ctxCache = new Map();
function ctxFor(e, x) {
  const k = e + ':' + x;
  if (ctxCache.has(k)) return ctxCache.get(k);
  S.saved = []; S.e = e; S.x = x; S.iPos = 333; S.mPos = M.ssMonthlyToPos(500); S.raise = '0'; S.ed = ''; S.xd = ''; S.editing = null; S.panel = null; S.infl = false; S.tx = null;
  M.ssRender();
  if (M.ssPosToInitial(S.iPos) !== 10000 || M.ssPosToMonthly(S.mPos) !== 500) throw new Error('시작 금액·적립금이 $10,000·$500 이 아님');
  const c = Object.assign({}, M.R.ctx);
  ctxCache.set(k, c);
  return c;
}
let nid = 0;
function run(type, params, e, x) {
  const ctx = ctxFor(e, x);
  const cfg = { id: 'f' + (nid++), type, name: 'x', params, color: '#ffffff', hidden: false };
  const s = M.ssCfgSeries(cfg, ctx);
  const sim = M.R.cfgSim[cfg.id];
  delete M.R.cfgSim[cfg.id];
  return { s, sim, ctx };
}
// 끝 금액만 (작동 규칙·강건성 — 화면과 같은 계산에서 낙폭·보유 선만 생략)
function finalOnly(type, params, e, x) {
  const ctx = ctxFor(e, x);
  const cfg = { id: 'g' + (nid++), type, name: 'x', params, color: '#ffffff', hidden: false };
  const s = M.ssCfgSeries(cfg, ctx, true);
  delete M.R.cfgSim[cfg.id];
  return s.end;
}
// 날마다 평가액 — 화면 낙폭과 같은 방식(9sig 는 리밸런스 사이 보유 고정 · SMA 는 날마다 보유)
function dailyEquity(sim) {
  const out = [];
  const multi = sim.type === 'sma';
  const c = multi ? sim.dd : sim.ddc, key = sim.ddKey;
  if (!c || !c.length) return out;
  const a = c[0].date, b = c[c.length - 1].date;
  let ci = 0;
  for (const row of DS.days) {
    if (row.date < a) continue;
    if (row.date > b) break;
    while (ci + 1 < c.length && c[ci + 1].date <= row.date) ci++;
    let v;
    if (multi) { v = c[ci].cash || 0; for (const k in (c[ci].h || {})) { const px = row[k]; if (px > 0) v += c[ci].h[k] * px; } }
    else { const px = row[key]; if (!(px > 0)) continue; v = c[ci].shares * px + c[ci].cash; }
    if (Number.isFinite(v) && v > 0) out.push({ date: row.date, v });
  }
  return out;
}
// 달마다 수익률: 달 마지막 거래일 평가액, 그 사이 들어온 적립금(일정 날짜 기준)을 빼고
function monthlyReturns(dv, ctx) {
  const sc = M.ssSchedule(ctx.monthly, ctx.raise, ctx.entryDate, ctx.exitDate);
  const fl = sc.list.slice().sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
  const pts = [];
  for (let i = 0; i < dv.length; i++) { const nx = dv[i + 1]; if (!nx || nx.date.slice(0, 7) !== dv[i].date.slice(0, 7)) pts.push(dv[i]); }
  const rets = [];
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    let F = 0;
    while (k < fl.length && fl[k].date <= pts[i].date) { if (fl[k].date > pts[i - 1].date) F += fl[k].amount; k++; }
    rets.push((pts[i].v - F) / pts[i - 1].v - 1);
  }
  return rets;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function riskStats(rets) {
  if (rets.length < 3) return { sharpe: null, sortino: null, conc: null };
  const m = mean(rets), sd = Math.sqrt(mean(rets.map((r) => (r - m) ** 2))), dn = Math.sqrt(mean(rets.map((r) => Math.min(r, 0) ** 2)));
  const lg = rets.map((r) => Math.log(1 + r)), tot = lg.reduce((s, x) => s + x, 0);
  const top = lg.slice().sort((p, q) => q - p).slice(0, Math.max(1, Math.ceil(rets.length * 0.01))).reduce((s, x) => s + x, 0);
  return { sharpe: sd > 0 ? m / sd * Math.sqrt(12) : null, sortino: dn > 0 ? m / dn * Math.sqrt(12) : null, conc: tot > 0 ? top / tot * 100 : null };
}
const r2 = (v, d) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(d));

// ── 종류별 정의 ──
// 규칙을 '끄면'(아래 값) 끝 금액이 달라지는 것만 작동 규칙으로 셈 · 강건성은 아래 손잡이를 선택지 한 칸씩 위·아래로
const KIND = {
  '9sig': {
    core: 5,
    rules: { crash: { cd: '100' }, spike: { sp: '0' }, throttle: { bp: '100' }, deploy: { dep: '0' }, rebal: { rp: '0' }, target: { tc: 'holding' } },
    knobs: ['cash', 'g', 'cd', 'cw', 'st', 'sp', 'bp', 'dep', 'rp'],
  },
  sma: {
    core: 6,
    rules: { confirm: { cb: '0', cs: '0' }, settle: { settle: '0' }, 'rsi-sell': { oh: '0' }, 'rsi-buy': { cool: '0' }, 'dca-in': { din: '0' }, 'dca-out': { dout: '0' }, bodyguard: { bg: '0' } },
    knobs: ['win', 'eb', 'xb', 'cb', 'cs', 'settle', 'oh', 'ohw', 'cool', 'coolw', 'din', 'dout', 'bg', 'bgw'],
  },
};
// 1990년부터 구간(1990–2010 · 1990–최신)의 진입 분기 = 후보 자료의 1990년 탭 진입 분기
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'stratsim_fit_seed.json'), 'utf8'));
for (const k of Object.keys(KIND)) {
  KIND[k].e90 = ((SEED[k] && SEED[k].tabs) || []).find((t) => t.from === '1990')?.e;
  if (!KIND[k].e90) throw new Error(k + ': 후보 자료에 1990년 탭이 없음');
}
const COLS = ['final', 'cagr', 'dd', 'sharpe', 'sortino', 'calmar', 'conc', 'vsbh', 'active', 'live', 'robust', 'back', 'backDD', 'fwd', 'fwdDD', 'era', 'eraDD', 'eraSharpe'];
const STATIC_N = 13;   // 앞 13칸 = 맞춘 구간(고정) · 뒤 5칸 = 날마다

const bhCache = new Map();
function bhCagr(ul, e) {
  const k = ul + ':' + e;
  if (!bhCache.has(k)) bhCache.set(k, run('bh', { ul }, e, X_FIT).s.cagr);
  return bhCache.get(k);
}
function staticMetrics(kind, p, e, from) {
  const K = KIND[kind];
  const fit = run(kind, p, e, X_FIT), F = fit.s.end;
  const rs = riskStats(monthlyReturns(dailyEquity(fit.sim), fit.ctx));
  const fin = (q) => finalOnly(kind, q, e, X_FIT);
  const live = [];
  for (const [nm, off] of Object.entries(K.rules)) {
    const q = Object.assign({}, p, off);
    if (Object.keys(off).every((k) => String(q[k]) === String(p[k]))) continue;   // 이미 꺼져 있음
    const f = fin(q);
    if (Math.abs(f - F) > 1e-9 * Math.max(1, Math.abs(F))) live.push(nm);
  }
  let nb = 0, ok = 0;
  for (const k of K.knobs) {
    const opts = M.SS_PDEF[kind + '.' + k].opts.map((o) => o[0]), i = opts.indexOf(String(p[k]));
    if (i < 0) continue;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= opts.length) continue;
      nb++;
      if (F > 0 && Math.abs(fin(Object.assign({}, p, { [k]: opts[j] })) / F - 1) <= 0.25) ok++;
    }
  }
  let back = null, backDD = null;
  if (from === '2010') { const b = run(kind, p, KIND[kind].e90, X_2010); back = b.s.cagr; backDD = b.s.maxDD; }
  return [Math.round(F), r2(fit.s.cagr, 4), r2(fit.s.maxDD, 4), r2(rs.sharpe, 2), r2(rs.sortino, 2), r2(fit.s.maxDD > 0 ? fit.s.cagr / fit.s.maxDD : null, 2), r2(rs.conc, 0),
    r2(fit.s.cagr - bhCagr(p.ul, e), 1), K.core + live.length, live.join('+'), nb ? Math.round(ok / nb * 100) : null, r2(back, 1), r2(backDD, 1)];
}
function dynamicMetrics(kind, p, e) {
  // 2026년 이후: 처음(e)부터 오늘까지 이어서 돌린 전략의 2025년 말 대비 수익(적립금 뺌)·그 사이 최대 낙폭
  //   · 평가액은 화면 낙폭과 같은 방식(9sig 는 마지막 리밸런스까지만 — 리밸런스 시점을 옮긴 매년 전략은 2025년 말 전에 끝날 수 있음 → 그 뒤는 그대로라 0%)
  //   · 빼는 돈: 9sig 는 기록 줄에 반영된 적립금(리밸런스 날), SMA 는 들어온 날 그대로
  const all = run(kind, p, e, X_LAST), dv = dailyEquity(all.sim);
  let fwd = null, fwdDD = null, iDec = -1;
  for (let i = 0; i < dv.length && dv[i].date <= DEC_DAY; i++) iDec = i;
  if (iDec >= 0 && iDec === dv.length - 1) { fwd = 0; fwdDD = 0; }
  else if (iDec >= 0) {
    const end = dv[dv.length - 1].date;
    let F = 0;
    if (kind === '9sig') { const lg = all.sim.log; for (let i = 1; i < lg.length; i++) if (lg[i].date > DEC_DAY && lg[i].date <= end) F += lg[i].invested - lg[i - 1].invested; }
    else { const sc = M.ssSchedule(all.ctx.monthly, all.ctx.raise, all.ctx.entryDate, all.ctx.exitDate); for (const it of sc.list) if (it.date > DEC_DAY && it.date <= end) F += it.amount; }
    fwd = ((dv[dv.length - 1].v - F) / dv[iDec].v - 1) * 100;
    let pk = -Infinity, mdd = 0;
    for (let i = iDec; i < dv.length; i++) { if (dv[i].v > pk) pk = dv[i].v; mdd = Math.max(mdd, 1 - dv[i].v / pk); }
    fwdDD = mdd * 100;
  }
  // 1990년부터 오늘까지
  const era = run(kind, p, KIND[kind].e90, X_LAST);
  const rs = riskStats(monthlyReturns(dailyEquity(era.sim), era.ctx));
  return [r2(fwd, 1), r2(fwdDD, 1), r2(era.s.cagr, 1), r2(era.s.maxDD, 1), r2(rs.sharpe, 2)];
}

// ── 실행 ──
function main() {
const seed = SEED;
const t0 = Date.now();
let wrote = 0;
for (const kind of ['9sig', 'sma']) {
  if (ONLY && ONLY !== kind) continue;
  const sd = seed[kind], keys = sd.keys, fixed = sd.fixed;
  const seedHash = sha(JSON.stringify(sd));
  const outPath = path.join(ROOT, 'data', 'stratsim', 'fit-' + kind + '.json');
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (e) { prev = null; }
  const reuse = !FULL && prev && prev.engine === engineHash && prev.seed === seedHash && !LIMIT;
  const prevRows = new Map();
  if (reuse) for (const t of prev.tabs) for (const r of t.rows) prevRows.set(t.key + '|' + r.slice(COLS.length).join(','), r);
  const tabs = [];
  let n = 0, hit = 0;
  for (const t of sd.tabs) {
    const rows = [];
    for (const raw of (LIMIT ? t.rows.slice(0, LIMIT) : t.rows)) {
      const p = Object.assign({}, fixed);
      keys.forEach((k, i) => { p[k] = String(raw[i]); });
      const clean = M.ssCleanParams(kind, p);
      for (const k of keys) if (String(clean[k]) !== String(p[k])) throw new Error(kind + ' ' + t.key + ': 선택지에 없는 값 ' + k + '=' + p[k]);
      const old = prevRows.get(t.key + '|' + raw.join(','));
      const st = old ? old.slice(0, STATIC_N) : staticMetrics(kind, clean, t.e, t.from);
      if (old) hit++;
      rows.push(st.concat(dynamicMetrics(kind, clean, t.e), raw));
      n++;
      if (n % 200 === 0) console.log(`  ${kind} ${n}행 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
    }
    const tab = { key: t.key, goal: t.goal, from: t.from, e: t.e, rows };
    if (t.goal === 'dd') { tab.cagrMin = t.cagrMin; tab.total = t.total; }
    tabs.push(tab);
  }
  const out = { v: 1, kind, updated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), engine: engineHash, seed: seedHash, dataTo: LAST_DAY, fitEnd: FIT_END, fwdFrom: DEC_DAY,
    keys, fixed, cols: COLS, tabs };
  // 검사: 행 수·숫자
  for (const t of tabs) for (const r of t.rows) {
    if (!(r[0] > 0) || !Number.isFinite(r[1]) || !(r[2] >= 0 && r[2] <= 100)) throw new Error(kind + ' ' + t.key + ': 이상한 결과 ' + JSON.stringify(r.slice(0, 3)));
  }
  const body = (o) => { const c = Object.assign({}, o); delete c.updated; return JSON.stringify(c); };
  if (prev && body(prev) === body(out)) { console.log(`${kind}: 바뀐 것 없음 (${n}행, 고정 지표 재사용 ${hit}행)`); continue; }
  if (LIMIT) { console.log(`${kind}: --limit 시험이라 저장하지 않음`, JSON.stringify(out.tabs[0].rows[0])); continue; }
  const txt = JSON.stringify(out).replace(/\],\[/g, '],\n[');
  fs.writeFileSync(outPath + '.tmp', txt + '\n');
  fs.renameSync(outPath + '.tmp', outPath);
  wrote++;
  console.log(`${kind}: 저장 ${path.relative(ROOT, outPath)} — ${n}행 (고정 지표 재사용 ${hit}행) · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}
console.log('끝 —', ((Date.now() - t0) / 1000).toFixed(0), '초 · 저장', wrote);
}
if (require.main === module) main();
module.exports = { M, run, finalOnly, ctxFor, dailyEquity, monthlyReturns, riskStats, staticMetrics, dynamicMetrics, KIND, X_FIT, X_LAST };
