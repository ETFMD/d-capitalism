/* 무한매수법 설정 탐색 2단계 — '안정 최고': 이웃 9점(분할 −2·0·+2 × 목표 −1·0·+1%) 중앙값을 최대로
   node opt/muhan_rob.js <종목> <act|pre> <cagr|calmar|cagrC|calmarC>   · 출발점 = opt/regions.json
   · cagr·calmar: 1단계 격자를 매끈하게 만든 지도에서 고른 곳에서 출발
   · cagrC·calmarC (상장 전 포함만): '재현 믿음도' |dh| ≤ 2%p 인 설정만 — dh = CAGR(실제 종가 + 추정 고가) − CAGR(실제), 상장 이후 구간
   · 좌표 탐색: 목표·분할·큰수·하방 LOC 줄·줄당 주식·1차 매도·큰수 상한·평단 괴리·선택 조합 — UI 범위 전체, 매번 이웃 9점 중앙값으로 판단
   · 마지막: 이웃 25점(분할 ±2 × 목표 ±1, 0.5 간격) 통계 · 세금 계산 방식 × 연말 절세 · 세전 · 원금·수수료 바꿔 보기 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const [TK, PER, OBJN, VERF] = process.argv.slice(2);
const CONS = OBJN === 'cons';   /* 제약 탐색: 이웃 중앙 MDD·가운데 MDD·원금 10만$ MDD ≥ −60% 안에서 min(이웃 중앙 CAGR, 10만$ CAGR) 최대 · 하방 LOC 10줄 이하 */
const LIM = -0.60;
const TH = 0.02;
function engine() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
  const g = (n, e) => { const a = src.indexOf('var ' + n + ' = (function'), b = src.indexOf(e, a); if (a < 0 || b < 0) throw new Error(n); return src.slice(a, b); };
  const MHE = new Function(g('MHE', "if (typeof module !== 'undefined') module.exports = MHE;") + '\nreturn MHE;')();
  return new Function('MHE', g('MHV', "if (typeof module !== 'undefined') module.exports = MHV;") + '\nreturn MHV;')(MHE);
}
function dataOf(tk, per) { const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', tk + '_' + per + '.json'), 'utf8'));
  if (process.env.OPT_TRUNC) for (const k of ['d', 'c', 'h', 'dv', 'fx']) if (D[k]) D[k] = D[k].slice(0, +process.env.OPT_TRUNC);   /* 시험용 */
  return D; }
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
  c.ideal = false; return c;
}
function evaluator(MHV, tk, D) {
  const dn = s => Date.parse(s + 'T00:00:00Z') / 864e5, from = 1, to = D.d.length - 1, days = dn(D.d[to]) - dn(D.d[from - 1]), fx = i => D.fx[i];
  return function (p, gross) {
    const cap = p.cap || 10000, fee = p.fee != null ? p.fee : 0.0007;
    const o = gross ? { from, to, capital: cap, norm: 'auto', rows: false, fee: 0, sec: 0, divTax: 0, tax: null }
                    : { from, to, capital: cap, norm: 'auto', rows: false, fee, sec: fee > 0 ? 0.0000206 : 0, divTax: 0.15, tax: { fx, method: p.method || 'fifo', harvest: !!p.harvest } };
    const R = MHV.run(cfgOf(MHV, tk, p), D, o), cagr = R.final > 0 ? Math.pow(R.final / cap, 365.25 / days) - 1 : -1;
    let pk = -Infinity, m = 0; for (let i = 0; i < R.eq.length; i++) { const e = R.eq[i]; if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
    return [cagr, m, R.n.exh, R.cycles.length, R.nob || 0, R.lack0 || 0, R.taxExt || 0, R.final, R.n.win, R.tsell || 0];
  };
}
if (process.env.OPT_WORKER) {
  const MHV = engine(), EV = { main: evaluator(MHV, TK, dataOf(TK, PER)) };
  if (PER === 'pre') { EV.act = evaluator(MHV, TK, dataOf(TK, 'act')); EV.hyb = evaluator(MHV, TK, dataOf(TK, 'hyb')); }
  process.on('message', m => { process.send({ id: m.id, out: m.tasks.map(p => { try { return EV[p.ser || 'main'](p, m.gross); } catch (e) { return [-9, -1, 0, 0, 0, 0, 0, 0, 0, 0]; } }) }); });
  return;
}
const W = Math.max(1, Number(process.env.OPT_W) || os.cpus().length), workers = [], pend = {}; let seq = 0;
for (let k = 0; k < W; k++) { const w = cp.fork(__filename, [TK, PER, OBJN, VERF || ''], { env: Object.assign({}, process.env, { OPT_WORKER: '1' }) }); w.on('message', m => { const f = pend[m.id]; delete pend[m.id]; f(m.out); }); workers.push(w); }
const pack = r => ({ cagr: r[0], mdd: r[1], exh: r[2], cyc: r[3], nob: r[4], lack0: r[5], ext: r[6], fin: r[7], win: r[8], tsell: r[9] });
function evalBatch(list, gross) {
  if (!list.length) return Promise.resolve([]);
  const chunks = workers.map(() => []), idx = workers.map(() => []);
  list.forEach((p, i) => { const k = i % W; chunks[k].push(p); idx[k].push(i); });
  return Promise.all(chunks.map((ch, k) => ch.length ? new Promise(res => { const id = ++seq; pend[id] = res; workers[k].send({ id, tasks: ch, gross: !!gross }); }) : Promise.resolve([])))
    .then(parts => { const out = new Array(list.length); parts.forEach((pt, k) => pt.forEach((r, j) => { out[idx[k][j]] = pack(r); })); return out; });
}
const MHV0 = engine(), DATA = dataOf(TK, PER);
const range = (a, b, s) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(Math.round(x * 100) / 100); return o; };
const VALS = { target: range(0.5, 100, 0.5), splits: range(2, 100, 1), big: range(0, 40, 0.5), shares: range(1, 20, 1), part: range(0.5, 50, 0.5), capP: range(0, 50, 0.5), avgOff: range(-20, 20, 0.5) };
function combos(v) {
  const out = [];
  if (v === '4.0') { for (const nb of [false, true]) out.push({ noBig: nb }); return out; }
  for (const exhaust of MHV0.EXHAUST[v]) for (const restart of ['next', 'rsi']) {
    if (v === '3.0') { for (const tround of ['r2', 'c1']) for (const rebase of [false, true]) out.push({ exhaust, restart, tround, rebase }); }
    else if (v === '2.2') { for (const money of ['compound', 'simple']) for (const tround of ['r2', 'c1']) out.push({ money, exhaust, restart, tround }); }
    else for (const money of ['compound', 'simple']) out.push({ money, exhaust, restart });
  }
  return out;
}
const dimsOf = v => ['target', 'splits', 'big'].concat(v !== '1.0' && v !== '2.0' ? ['lines', 'shares'] : []).concat(v === '2.0' || v === '2.1' ? ['part', 'capP'] : []).concat(v === '1.0' || v === '2.0' || v === '2.1' ? ['avgOff'] : []).concat(['combo']);
const keyOf = p => [p.ser || '', p.ver, p.splits, p.target, p.big, p.lines, p.shares, p.part, p.capP, p.avgOff, p.money, p.exhaust, p.restart, p.tround, p.rebase ? 1 : 0, p.noBig ? 1 : 0, p.method, p.harvest ? 1 : 0, p.cap || 0, p.fee == null ? '' : p.fee].join('|');
const memo = new Map(); let nEval = 0;
async function evalMany(list) {
  const need = [], seen = new Set();
  list.forEach(p => { const k = keyOf(p); if (!memo.has(k) && !seen.has(k)) { seen.add(k); need.push(p); } });
  const res = await evalBatch(need); nEval += need.length; need.forEach((p, i) => memo.set(keyOf(p), res[i]));
  return list.map(p => memo.get(keyOf(p)));
}
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const nb9 = p => { const o = []; for (const ds of [-2, 0, 2]) for (const dt of [-1, 0, 1]) { const s = p.splits + ds, t = Math.round((p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) o.push(Object.assign({}, p, { splits: s, target: t })); } return o; };
const nb25 = p => { const o = []; for (const ds of [-2, -1, 0, 1, 2]) for (const dt of [-1, -0.5, 0, 0.5, 1]) { const s = p.splits + ds, t = Math.round((p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) o.push(Object.assign({}, p, { splits: s, target: t })); } return o; };
/* 여러 후보의 이웃 25점(분할 ±2 × 목표 ±1, 0.5 간격)을 한꺼번에 계산해 매끈한 값 (+ CRED 면 가운데 설정의 재현 믿음도 dh)
   (처음엔 9점이었으나 분할 2~3 끝에서 이웃이 줄어 위쪽 중앙값으로 치우치는 문제가 있어 25점·보통 중앙값으로 바꿈) */
const CRED = OBJN === 'cagrC' || OBJN === 'calmarC';
async function smoothMany(cands, nbf) {
  const groups = cands.map(nbf || nb25), flat = [].concat(...groups);
  cands.forEach(p => flat.push(p));   /* 가운데 설정 — 살 수 없는 날(1주 값 > 주문 금액) 있는지 */
  if (CONS) cands.forEach(p => flat.push(Object.assign({}, p, { cap: 100000 })));
  if (CRED) cands.forEach(p => { flat.push(Object.assign({}, p, { ser: 'act' }), Object.assign({}, p, { ser: 'hyb' })); });
  const res = await evalMany(flat);
  let k = 0; const out = groups.map(g => { const rs = res.slice(k, k + g.length); k += g.length; return { n: g.length, cagrMed: med(rs.map(r => r.cagr)), mddMed: med(rs.map(r => r.mdd)), cagrMin: Math.min(...rs.map(r => r.cagr)), mddMin: Math.min(...rs.map(r => r.mdd)) }; });
  out.forEach(s => { const c = res[k++]; s.nob = c.nob; s.cCagr = c.cagr; s.cMdd = c.mdd; });
  if (CONS) out.forEach(s => { const c = res[k++]; s.c100 = c.cagr; s.m100 = c.mdd; });
  if (CRED) out.forEach(s => { const a = res[k++], h = res[k++]; s.dh = h.cagr - a.cagr; s.actCagr = a.cagr; s.cred = Math.abs(s.dh) <= TH; });
  return out;
}
const t0 = Date.now(), log = s => console.log(((Date.now() - t0) / 1000).toFixed(0) + 's ' + s);
(async () => {
  const REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'regions.json'), 'utf8'))[TK + '_' + PER];
  if (!REG) { log('regions.json 에 ' + TK + '_' + PER + ' 없음 — 이번에는 건너뜀'); workers.forEach(w => w.kill()); return; }
  if (CRED && PER !== 'pre') { log('상장 이후는 재현 믿음도 탐색이 필요 없음'); workers.forEach(w => w.kill()); return; }
  const out = { tk: TK, per: PER, objn: OBJN, floor: REG.floor, floorC: REG.floorC, th: TH, runs: [] };
  /* 모든 목표: 가운데 설정이 '살 수 없는 날' 없이 원래 방법대로 돌아가야 함(nob = 0, 화면에 ⚠ 없음) */
  const OBJ = { cagr: s => s.nob === 0 ? s.cagrMed : -Infinity, calmar: s => s.nob === 0 && s.cagrMed >= REG.floor && s.mddMed < 0 ? s.cagrMed / -s.mddMed : -Infinity,
                cons: s => s.nob !== 0 ? -Infinity : Math.min(s.cagrMed, s.c100) - 10 * Math.max(0, LIM - Math.min(s.mddMed, s.cMdd, s.m100)),
                cagrC: s => s.nob === 0 && s.cred ? s.cagrMed : -Infinity, calmarC: s => s.nob === 0 && s.cred && s.cagrMed >= REG.floorC && s.mddMed < 0 ? s.cagrMed / -s.mddMed : -Infinity };
  const STARTS = CONS ? (REG.startsK || []).filter(s => !VERF || s.ver === VERF) : CRED ? (REG.startsC || []).filter(s => s.obj === OBJN) : REG.starts.filter(s => s.obj === OBJN);
  for (const st of STARTS.slice(0, +process.env.OPT_NSTART || STARTS.length)) {
    const v = st.ver, COMBOS = combos(v), DIMS = dimsOf(v), obj = OBJN;
    let cur = Object.assign({ ver: v, big: 15, lines: 8, shares: 1, part: 5, capP: 5, avgOff: 0, money: v === '3.0' ? 'half' : v === '4.0' ? 'cash' : 'compound', exhaust: 'official', restart: 'next', tround: 'r2', rebase: false, noBig: false, method: 'fifo', harvest: false }, st.p);
    if (CONS && cur.ver !== '1.0' && cur.ver !== '2.0') cur.lines = Math.min(Math.max(cur.lines, cur.ver === '4.0' ? 1 : 0), 10);   /* 하방 LOC 10줄 이하 */
    let curS = (await smoothMany([cur]))[0]; const trace = [];
    for (let round = 1; round <= (+process.env.OPT_ROUNDS || 4); round++) {
      let improved = false;
      for (const dim of DIMS) {
        let cand;
        /* 1회차는 범위 전체, 2회차부터는 지금 값 앞뒤 12칸 */
        const win = a => { if (round === 1) return a; const i = a.findIndex(x => Math.abs(x - cur[dim]) < 1e-9); return i < 0 ? a : a.slice(Math.max(0, i - 12), i + 13); };
        if (dim === 'combo') cand = COMBOS.map(c => Object.assign({}, cur, c));
        else if (dim === 'shares' && !(cur.lines > 0)) continue;
        else if (dim === 'lines') cand = win(v === '4.0' ? range(1, CONS ? 10 : 80, 1) : range(0, CONS ? 10 : 80, 1)).map(x => Object.assign({}, cur, { lines: x }));
        else cand = win(VALS[dim]).map(x => Object.assign({}, cur, { [dim]: x }));
        const sm = await smoothMany(cand);
        let bi = -1, bs = OBJ[obj](curS);
        sm.forEach((s, i) => { const sc = OBJ[obj](s); if (sc > bs + 1e-12) { bs = sc; bi = i; } });
        if (bi >= 0) { cur = cand[bi]; curS = sm[bi]; improved = true; trace.push([round, dim, dim === 'combo' ? JSON.stringify(COMBOS.find(c => Object.keys(c).every(k => c[k] === cur[k]))) : cur[dim], +(curS.cagrMed * 100).toFixed(3), +(curS.mddMed * 100).toFixed(2)]); }
      }
      if (!improved) break;
    }
    /* 마지막: 세금 계산 방식 × 연말 절세(이웃 9점으로) → 이웃 25점 · 가운데 값 · 세전 · 원금/수수료 */
    const vs = []; for (const method of ['fifo', 'avg']) for (const harvest of [false, true]) vs.push(Object.assign({}, cur, { method, harvest }));
    const vsm = await smoothMany(vs); let bi = 0; vsm.forEach((s, i) => { if (OBJ[obj](s) > OBJ[obj](vsm[bi]) + 1e-12) bi = i; });
    const best = vs[bi], n25 = vsm[bi], c = (await evalMany([best]))[0], gross = (await evalBatch([best], true))[0];
    const alt = await evalBatch([Object.assign({}, best, { cap: 100000 }), Object.assign({}, best, { cap: 1000000 }), Object.assign({}, best, { fee: 0.0025 }), Object.assign({}, best, { fee: 0 })]);
    out.runs.push({ obj, start: st, p: best, s9: vsm[bi], s25: n25, center: c, gross, alt: { cap100k: alt[0], cap1m: alt[1], fee025: alt[2], fee0: alt[3] }, taxVariants: vs.map((q, i) => ({ method: q.method, harvest: q.harvest, s9: vsm[i] })), trace, ok: isFinite(OBJ[obj](vsm[bi])) });
    log(obj + ' V' + v + ' 출발 ' + st.p.splits + '분할·' + st.p.target + '% → ' + best.splits + '분할·' + best.target + '% 이웃 중앙 ' + (n25.cagrMed * 100).toFixed(2) + '% / ' + (n25.mddMed * 100).toFixed(1) + '% · 가운데 ' + (c.cagr * 100).toFixed(2) + '%' + (CRED ? ' · dh ' + (vsm[bi].dh * 100).toFixed(2) + '%p' : '') + ' · 계산 ' + nEval);
  }
  out.nEval = nEval; out.sec = (Date.now() - t0) / 1000;
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'rob_' + TK + '_' + PER + '_' + OBJN + (VERF ? '_' + VERF : '') + '.json'), JSON.stringify(out));
  log('끝 · 계산 ' + nEval + '번'); workers.forEach(w => w.kill());
})().catch(e => { console.error(e); workers.forEach(w => w.kill()); process.exit(1); });
