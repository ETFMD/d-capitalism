/* 무한매수법 백테스트 설정 탐색 — 한 칸(종목 · 기간 · 버전)을 전부 계산
   node scripts/muhan_opt/muhan_opt.js <TQQQ|SOXL|UPRO|TECL> <act|pre> <1.0|2.0|2.1|2.2|3.0|4.0>
   · 엔진 = src/index.html 의 MHE·MHV 그대로 (사이트 시뮬레이터와 같은 코드)
   · 자료 = scripts/muhan_opt/data/<종목>_<기간>.json (시뮬레이터 화면이 쓰는 일봉·재현 일봉·원/달러를 그대로 꺼낸 것)
   · 조건 = 시뮬레이터 기본 환경: 원금 $10,000 · 1주 단위 주문 · 수수료 0.07% + SEC · 분배금 원천징수 15% · 양도세 22%
   ① 전체 격자: 분할 2~100 × 목표 0.5~50(0.5 간격)+55~100(5 간격) × 버전의 모든 선택 조합(1회 매수금·소진 대응·새 사이클·T 반올림·다시 정하기·큰수 미사용)
   ② 좌표 탐색: 상위 출발점마다 분할·목표·큰수·하방 LOC 줄·줄당 주식·1차 매도·큰수 상한·평단 괴리·선택 조합을 UI 범위 전체로 하나씩 훑어 더 나아지지 않을 때까지
      (FIX='avgOff=0' 처럼 고정한 설정은 훑지 않음)
   ③ 세금 계산 방식(선입선출·이동평균) × 연말 절세 매도 · ④ 이웃(분할 ±2 × 목표 ±1) 안정성 · 세전 값 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'src', 'index.html')) && d !== path.dirname(d)) d = path.dirname(d); return d; })();   /* 저장소 맨 위 (src/index.html 이 있는 곳) */
const [TK, PER, VER] = process.argv.slice(2);
const PILOT = !!process.env.OPT_PILOT;
/* 고정할 설정 — 환경 변수 FIX='avgOff=0' 처럼 '이름=값' 을 쉼표로 (예: 평단 LOC 괴리율 0% 로 두고 탐색) · 고정한 값은 탐색하지 않고 출발점·기본값에도 그 값 */
const FIX = (process.env.FIX || '').split(',').map(s => s.trim()).filter(Boolean).reduce((o, kv) => { const i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); o[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && isFinite(+v) ? +v : v; return o; }, {});
/* 증권사 주문 거부 — 환경 변수 REJ='clamp'(한도로 낮춰 넣기) | 'skip'(그날 건너뛰기) · 없으면 반영 안 함 (시뮬레이터 '7. 고급 설정' · 주소 rj=c|s 와 같은 계산)
   매수 지정가 > 그날 시가(자료 o — 0·없음이면 전날 종가) × 1.2 를 1센트 버림 → MHV.run o.rej · 자료의 시가는 dump.py 가 화면(MBT.withOpen·preOpen)에서 꺼냄 */
const REJ = /^(clamp|skip)$/.test(process.env.REJ || '') ? { mode: process.env.REJ, cap: 1.2 } : null;
/* 주문 넣는 때 — 환경 변수 FILL='open'(정규장 시작 전: 갭 상승이면 그날 시가에 팔림) | 'pre'(프리장 시작 한국 17~18시: 전날 종가가 이미 지정가 이상이면 전날 종가, 주문 거부 기준 전날 종가) · 없으면 기존 계산
   (시뮬레이터 '7. 고급 설정 → 주문 넣는 때' · 주소 ft=o|p 와 같은 계산 · MHV.run o.fill · 'open' 은 자료에 시가 o 필요) */
const FILL = /^(open|pre)$/.test(process.env.FILL || '') ? process.env.FILL : null;

function engine() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const g = (n, e) => { const a = src.indexOf('var ' + n + ' = (function'), b = src.indexOf(e, a); if (a < 0 || b < 0) throw new Error(n); return src.slice(a, b); };
  const MHE = new Function(g('MHE', "if (typeof module !== 'undefined') module.exports = MHE;") + '\nreturn MHE;')();
  return new Function('MHE', g('MHV', "if (typeof module !== 'undefined') module.exports = MHV;") + '\nreturn MHV;')(MHE);
}
function dataOf(tk, per) {
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', tk + '_' + per + '.json'), 'utf8')), n = Number(process.env.OPT_TRUNC) || 0;
  if (n > 0) for (const k of ['d', 'c', 'h', 'o', 'dv', 'fx']) if (D[k]) D[k] = D[k].slice(0, n);   /* 시험용으로 앞부분만 */
  return D;
}

/* 시뮬레이터 cfgOf 와 같게 설정 만들기 */
function cfgOf(MHV, tk, p) {
  const c = MHV.defaults(p.ver, tk);
  c.splits = p.splits; c.target = p.target; c.big = p.big; c.exhaust = p.exhaust; c.restart = p.ver === '4.0' ? 'next' : p.restart;
  if (p.ver === '2.0' || p.ver === '2.1') { c.part = p.part; c.cap = p.capP; }
  if (p.ver === '1.0' || p.ver === '2.0' || p.ver === '2.1') c.avgOff = p.avgOff;
  if (p.ver !== '1.0' && p.ver !== '2.0') { c.lines = Math.round(p.lines); c.shares = Math.max(1, Math.round(p.shares || 1)); }
  if (p.ver === '4.0') c.noBig = !!p.noBig;
  if (/^(1\.0|2\.0|2\.1|2\.2)$/.test(p.ver)) c.money = p.money;
  if (p.ver === '2.2' || p.ver === '3.0') c.tround = p.tround;
  if (p.ver === '3.0') c.rebase = !!p.rebase;
  c.ideal = false;
  return c;
}
function evaluator(MHV, tk, D) {
  const dn = s => Date.parse(s + 'T00:00:00Z') / 864e5, from = 1, to = D.d.length - 1, days = dn(D.d[to]) - dn(D.d[from - 1]);
  const fx = i => D.fx[i];
  return function (p, gross) {
    const cap = p.cap || 10000, fee = p.fee != null ? p.fee : 0.0007;
    const o = gross ? { from, to, capital: cap, norm: 'auto', rows: false, fee: 0, sec: 0, divTax: 0, tax: null, rej: REJ, fill: FILL }
                    : { from, to, capital: cap, norm: 'auto', rows: false, fee, sec: fee > 0 ? 0.0000206 : 0, divTax: 0.15, tax: { fx, method: p.method || 'fifo', harvest: !!p.harvest }, rej: REJ, fill: FILL };
    const R = MHV.run(cfgOf(MHV, tk, p), D, o);
    const cagr = R.final > 0 ? Math.pow(R.final / cap, 365.25 / days) - 1 : -1;
    let pk = -Infinity, m = 0; for (let i = 0; i < R.eq.length; i++) { const e = R.eq[i]; if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
    return { cagr, mdd: m, fin: R.final, exh: R.n.exh, win: R.n.win, cyc: R.cycles.length, nob: R.nob || 0, lack0: R.lack0 || 0, ext: R.taxExt || 0, tsell: R.tsell || 0 };
  };
}

/* ── 작업자 ── */
if (process.env.OPT_WORKER) {
  const MHV = engine(), D = dataOf(TK, PER), ev = evaluator(MHV, TK, D);
  process.on('message', m => {
    const out = m.tasks.map(p => { try { const r = ev(p, m.gross); return [r.cagr, r.mdd, r.exh, r.cyc, r.nob, r.lack0, r.ext, r.fin, r.win, r.tsell]; } catch (e) { return [-9, -1, 0, 0, 0, 0, 0, 0, 0, 0]; } });
    process.send({ id: m.id, out });
  });
  return;
}

/* ── 지휘 ── */
const W = Math.max(1, Number(process.env.OPT_W) || os.cpus().length);
const workers = [], pend = {};
let seq = 0;
for (let k = 0; k < W; k++) {
  const w = cp.fork(__filename, [TK, PER, VER], { env: Object.assign({}, process.env, { OPT_WORKER: '1' }) });
  w.on('message', m => { const f = pend[m.id]; delete pend[m.id]; f(m.out); });
  workers.push(w);
}
const pack = r => ({ cagr: r[0], mdd: r[1], exh: r[2], cyc: r[3], nob: r[4], lack0: r[5], ext: r[6], fin: r[7], win: r[8], tsell: r[9] });
function evalBatch(list, gross) {
  if (!list.length) return Promise.resolve([]);
  const chunks = workers.map(() => []), idx = workers.map(() => []);
  list.forEach((p, i) => { const k = i % W; chunks[k].push(p); idx[k].push(i); });
  return Promise.all(chunks.map((ch, k) => ch.length ? new Promise(res => { const id = ++seq; pend[id] = res; workers[k].send({ id, tasks: ch, gross: !!gross }); }) : Promise.resolve([])))
    .then(parts => { const out = new Array(list.length); parts.forEach((pt, k) => pt.forEach((r, j) => { out[idx[k][j]] = pack(r); })); return out; });
}

const MHV0 = engine(), DEF = MHV0.defaults(VER, TK), DATA = dataOf(TK, PER);
if ((REJ || FILL === 'open') && !(DATA.o && DATA.o.length === DATA.d.length)) throw new Error((REJ ? 'REJ=' + REJ.mode : 'FILL=open') + ' 에는 시가(o)가 든 자료가 필요해요 — dump.py 를 다시 돌리세요');
const range = (a, b, s) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(Math.round(x * 100) / 100); return o; };
const SPLITS = PILOT ? [5, 10, 20, 30, 40] : range(2, 100, 1);
const TGT_A = PILOT ? [5, 10, 15, 20] : range(0.5, 50, 0.5).concat(range(55, 100, 5));
const TGT = range(0.5, 100, 0.5), BIG = range(0, 40, 0.5), LINES = VER === '4.0' ? range(1, 80, 1) : range(0, 80, 1), SHARES = range(1, 20, 1);
const PART = range(0.5, 50, 0.5), CAPP = range(0, 50, 0.5), AVGOFF = range(-20, 20, 0.5);
/* 버전의 선택 조합 */
function combos(v) {
  const ex = MHV0.EXHAUST[v], out = [];
  if (v === '4.0') { for (const nb of [false, true]) out.push({ noBig: nb }); return out; }
  for (const exhaust of ex) for (const restart of ['next', 'rsi']) {
    if (v === '3.0') { for (const tround of ['r2', 'c1']) for (const rebase of [false, true]) out.push({ exhaust, restart, tround, rebase }); }
    else if (v === '2.2') { for (const money of ['compound', 'simple']) for (const tround of ['r2', 'c1']) out.push({ money, exhaust, restart, tround }); }
    else for (const money of ['compound', 'simple']) out.push({ money, exhaust, restart });
  }
  return PILOT ? out.slice(0, 2) : out;
}
const COMBOS = combos(VER);
const base = Object.assign({ ver: VER, splits: DEF.splits, target: DEF.target, big: DEF.big, lines: DEF.lines, shares: 1, part: DEF.part || 5, capP: DEF.cap || 5, avgOff: 0,
  money: VER === '3.0' ? 'half' : VER === '4.0' ? 'cash' : 'compound', exhaust: 'official', restart: 'next', tround: 'r2', rebase: false, noBig: false, method: 'fifo', harvest: false }, FIX);
const DIMS = ['target', 'splits', 'big']
  .concat(VER !== '1.0' && VER !== '2.0' ? ['lines', 'shares'] : [])
  .concat(VER === '2.0' || VER === '2.1' ? ['part', 'capP'] : [])
  .concat(VER === '1.0' || VER === '2.0' || VER === '2.1' ? ['avgOff'] : [])
  .concat(['combo']).filter(d => !(d in FIX));
const VALS = { target: TGT, splits: SPLITS.length > 10 ? SPLITS : range(2, 100, 1), big: BIG, lines: LINES, shares: SHARES, part: PART, capP: CAPP, avgOff: AVGOFF };
const keyOf = p => [p.splits, p.target, p.big, p.lines, p.shares, p.part, p.capP, p.avgOff, p.money, p.exhaust, p.restart, p.tround, p.rebase ? 1 : 0, p.noBig ? 1 : 0, p.method, p.harvest ? 1 : 0].join('|');
const memo = new Map(); let nEval = 0; const refPts = new Map();   /* 격자 밖(좌표 탐색·마지막 단계)에서 계산한 점 */
async function evalMany(list) {
  const need = [], seen = new Set();
  list.forEach(p => { const k = keyOf(p); if (!memo.has(k) && !seen.has(k)) { seen.add(k); need.push(p); } });
  const res = await evalBatch(need); nEval += need.length;
  need.forEach((p, i) => memo.set(keyOf(p), res[i]));
  return list.map(p => memo.get(keyOf(p)));
}
const t0 = Date.now(), log = s => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's ' + s);

(async () => {
  const out = { tk: TK, per: PER, ver: VER, fix: FIX, rej: REJ ? REJ.mode : 'none', fill: FILL || 'none', from: DATA.d[0], to: DATA.d[DATA.d.length - 1], L: DATA.L || 0, listing: DATA.L ? DATA.d[DATA.L] : DATA.d[0],
                env: '원금 $10,000 · 1주 단위 · 수수료 0.07% + SEC 0.00206% · 분배 원천징수 15% · 양도세 22% (결제일 매매기준율, 5월 말 납부)' + (REJ ? ' · 증권사 주문 거부 ' + REJ.mode + '(' + (FILL === 'pre' ? '전날 종가' : '시가') + ' × 1.2)' : '') + (FILL ? ' · 주문 넣는 때 ' + FILL : ''), combos: COMBOS, splits: SPLITS, targets: TGT_A };
  /* 원문 기본값 */
  const d0 = (await evalMany([Object.assign({}, base, VER === '4.0' ? {} : {})]))[0];
  out.default = { p: base, r: d0 }; log('기본값 CAGR ' + (d0.cagr * 100).toFixed(2) + '% MDD ' + (d0.mdd * 100).toFixed(1) + '%');
  /* ① 전체 격자 */
  out.grid = [];
  const pts = [];   /* 모든 계산 점 (프런티어용) */
  for (let ci = 0; ci < COMBOS.length; ci++) {
    const list = [];
    for (const s of SPLITS) for (const t of TGT_A) list.push(Object.assign({}, base, COMBOS[ci], { splits: s, target: t }));
    const res = await evalMany(list);
    const cg = new Float32Array(res.length), md = new Float32Array(res.length);
    res.forEach((r, i) => { cg[i] = r.cagr; md[i] = r.mdd; });
    out.grid.push({ combo: ci, cagr: Buffer.from(cg.buffer).toString('base64'), mdd: Buffer.from(md.buffer).toString('base64') });
    let bi = 0; res.forEach((r, i) => { if (r.cagr > res[bi].cagr) bi = i; });
    log('격자 ' + (ci + 1) + '/' + COMBOS.length + ' ' + JSON.stringify(COMBOS[ci]) + ' 최고 ' + (res[bi].cagr * 100).toFixed(2) + '% (' + list[bi].splits + '분할 · ' + list[bi].target + '%) · 계산 ' + nEval);
  }
  const save = () => { fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out', TK + '_' + PER + '_' + VER + '.json'), JSON.stringify(out)); };
  out.nEval = nEval; out.partial = 'grid'; save();
  /* 격자에서 출발점 고르기 */
  const all = [];
  for (const [k, r] of memo) all.push([k, r]);
  const P = new Map(); for (const [k] of all) { /* 키 → 설정 복원은 격자 목록에서 */ }
  const gridPts = [];
  for (let ci = 0; ci < COMBOS.length; ci++) for (const s of SPLITS) for (const t of TGT_A) { const p = Object.assign({}, base, COMBOS[ci], { splits: s, target: t }); gridPts.push([p, memo.get(keyOf(p))]); }
  let maxA = -Infinity; for (const g of gridPts) if (g[1].cagr > maxA) maxA = g[1].cagr;   /* (큰 배열에 Math.max.apply 를 쓰면 호출 스택이 넘침) */
  const floor = maxA * 0.5;
  out.maxA = maxA; out.floor = floor;
  const calmar = r => r.cagr >= floor && r.mdd < 0 ? r.cagr / -r.mdd : -Infinity;
  const OBJ = { cagr: r => r.cagr, calmar };
  function pickStarts(score, n) {
    const s = gridPts.slice().sort((a, b) => score(b[1]) - score(a[1])), chosen = [];
    for (const [p, r] of s) {
      if (!isFinite(score(r))) break;
      if (chosen.some(([q]) => keyOf(Object.assign({}, q, { splits: 0, target: 0 })) === keyOf(Object.assign({}, p, { splits: 0, target: 0 })) && Math.abs(q.splits - p.splits) <= 3 && Math.abs(q.target - p.target) <= 2)) continue;
      chosen.push([p, r]); if (chosen.length >= n) break;
    }
    return chosen;
  }
  /* ② 좌표 탐색 */
  async function climb(start, obj) {
    let cur = Object.assign({}, start), curR = (await evalMany([cur]))[0], trace = [];
    for (let round = 1; round <= (PILOT ? 2 : 6); round++) {
      let improved = false;
      for (const dim of DIMS) {
        let cand;
        if (dim === 'combo') cand = COMBOS.map(c => Object.assign({}, cur, c));
        else if (dim === 'shares' && !(cur.lines > 0)) continue;
        else cand = VALS[dim].map(v => Object.assign({}, cur, { [dim]: v }));
        const res = await evalMany(cand);
        cand.forEach((p, i) => refPts.set(keyOf(p), { p, r: res[i] }));
        let bi = -1, bs = OBJ[obj](curR);
        res.forEach((r, i) => { const sc = OBJ[obj](r); if (sc > bs + 1e-12) { bs = sc; bi = i; } });
        if (bi >= 0) { cur = cand[bi]; curR = res[bi]; improved = true; trace.push([round, dim, dim === 'combo' ? JSON.stringify(COMBOS.find(c => Object.keys(c).every(k => c[k] === cur[k]))) : cur[dim], +(curR.cagr * 100).toFixed(3), +(curR.mdd * 100).toFixed(2)]); }
      }
      if (!improved) break;
    }
    return { p: cur, r: curR, trace };
  }
  out.refine = {};
  for (const obj of ['cagr', 'calmar']) {
    const starts = pickStarts(OBJ[obj], PILOT ? 2 : 4), runs = [];
    for (const [p] of starts) { const c = await climb(p, obj); runs.push({ start: { splits: p.splits, target: p.target, combo: COMBOS.findIndex(cc => Object.keys(cc).every(k => cc[k] === p[k])) }, p: c.p, r: c.r, trace: c.trace });
      log('탐색 ' + obj + ' 출발 ' + p.splits + '분할·' + p.target + '% → ' + (c.r.cagr * 100).toFixed(2) + '% / MDD ' + (c.r.mdd * 100).toFixed(1) + '% · 계산 ' + nEval); }
    runs.sort((a, b) => OBJ[obj](b.r) - OBJ[obj](a.r));
    out.refine[obj] = runs;
  }
  /* ③ 후보 고르기: 목표별 상위 8개(서로 다른 곳) → ④ 이웃(분할 ±2 × 목표 ±1, 25점) 안정성
        · 그냥 최고(raw) = 목표 값이 가장 큰 것 · 안정 최고(robust) = 이웃 중앙값이 가장 큰 것
     ⑤ 둘 다: 세금 계산 방식(선입선출·이동평균) × 연말 절세 · 세전 · 원금 $10만·$100만 · 수수료 0.25%·0% */
  out.final = {};
  const neighOf = p => { const nb = []; for (const ds of [-2, -1, 0, 1, 2]) for (const dt of [-1, -0.5, 0, 0.5, 1]) { const s = p.splits + ds, t = Math.round((p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) nb.push(Object.assign({}, p, { splits: s, target: t })); } return nb; };
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const bucket = p => keyOf(Object.assign({}, p, { splits: Math.round(p.splits / 3), target: Math.round(p.target / 1.5), method: 'fifo', harvest: false }));
  async function polish(p, obj) {
    const vs = []; for (const method of ['fifo', 'avg']) for (const harvest of [false, true]) vs.push(Object.assign({}, p, { method, harvest }));
    const vr = await evalMany(vs); vs.forEach((q, i) => refPts.set(keyOf(q), { p: q, r: vr[i] }));
    let bi = 0; vr.forEach((r, i) => { if (OBJ[obj](r) > OBJ[obj](vr[bi]) + 1e-12) bi = i; });
    const best = vs[bi], bestR = vr[bi], gross = (await evalBatch([best], true))[0];
    const alt = await evalBatch([Object.assign({}, best, { cap: 100000 }), Object.assign({}, best, { cap: 1000000 }), Object.assign({}, best, { fee: 0.0025 }), Object.assign({}, best, { fee: 0 })]);
    return { p: best, r: bestR, taxVariants: vs.map((q, i) => ({ method: q.method, harvest: q.harvest, cagr: vr[i].cagr, mdd: vr[i].mdd })), gross, alt: { cap100k: alt[0], cap1m: alt[1], fee025: alt[2], fee0: alt[3] } };
  }
  for (const obj of ['cagr', 'calmar']) {
    const pool = [];
    for (const [, v] of refPts) pool.push([v.p, v.r]);
    for (const g of gridPts) pool.push(g);
    pool.sort((a, b) => OBJ[obj](b[1]) - OBJ[obj](a[1]));
    const cands = [], seenB = new Set();
    for (const [p, r] of pool) { if (!isFinite(OBJ[obj](r))) break; const b = bucket(p); if (seenB.has(b)) continue; seenB.add(b); cands.push([p, r]); if (cands.length >= 8) break; }
    const cs = [];
    for (const [p, r] of cands) {
      const nb = neighOf(p), nr = await evalMany(nb); nb.forEach((q, i) => refPts.set(keyOf(q), { p: q, r: nr[i] }));
      cs.push({ p, r, neigh: { n: nr.length, cagrMed: med(nr.map(x => x.cagr)), cagrMin: Math.min.apply(null, nr.map(x => x.cagr)), mddMed: med(nr.map(x => x.mdd)), mddMin: Math.min.apply(null, nr.map(x => x.mdd)),
        objMed: med(nr.map(x => { const v = OBJ[obj](x); return isFinite(v) ? v : -1; })) } });
    }
    if (!cs.length) continue;
    const raw = cs[0], rob = cs.slice().sort((a, b) => b.neigh.objMed - a.neigh.objMed)[0];
    out.final[obj] = { raw: Object.assign(await polish(raw.p, obj), { neigh: raw.neigh }), robust: Object.assign(await polish(rob.p, obj), { neigh: rob.neigh }),
      cands: cs.map(c => ({ p: c.p, cagr: c.r.cagr, mdd: c.r.mdd, neigh: c.neigh })) };
    const f = out.final[obj];
    log('최종 ' + obj + ' 그냥 최고 ' + (f.raw.r.cagr * 100).toFixed(2) + '% / ' + (f.raw.r.mdd * 100).toFixed(1) + '% (이웃 중앙 ' + (f.raw.neigh.cagrMed * 100).toFixed(2) + '%) · 안정 최고 ' +
        (f.robust.r.cagr * 100).toFixed(2) + '% / ' + (f.robust.r.mdd * 100).toFixed(1) + '% (이웃 중앙 ' + (f.robust.neigh.cagrMed * 100).toFixed(2) + '%) · 계산 ' + nEval);
  }
  /* 격자 밖에서 계산한 점 (좌표 탐색·세금 방식·이웃) — 프런티어용 · 격자 점은 out.grid */
  out.points = [];
  for (const [k, v] of refPts) { const r = v.r; out.points.push([k, +r.cagr.toFixed(6), +r.mdd.toFixed(6), r.exh, r.nob, r.lack0, r.ext > 0 ? 1 : 0]); }
  out.nEval = nEval; out.sec = (Date.now() - t0) / 1000; delete out.partial;
  save();
  log('끝 · 계산 ' + nEval + '번');
  workers.forEach(w => w.kill());
})().catch(e => { console.error(e); workers.forEach(w => w.kill()); process.exit(1); });
