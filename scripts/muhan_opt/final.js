/* 최종 정리 — node final.js <1단계 폴더> <2단계 폴더|-> <데이터 폴더> <src/index.html> <출력 폴더>
   후보 = 1단계(버전별 최고·균형 후보 + 이웃) + 2단계(이웃 중앙값 최대화) → 종목 × 기간마다
   · 최고 CAGR(한 점 그대로) · 안정 최고(이웃 25점 중앙값) · 균형(이웃 중앙 CAGR ÷ |이웃 중앙 MDD|, 이웃 중앙 CAGR ≥ 안정 최고의 절반)
   · 상장 전 포함은 '재현 믿음도' — dh = CAGR(상장 뒤 실제 종가 + 상장 전과 같은 추정 고가) − CAGR(실제) (추정 고가 탓),
     dSyn = CAGR(상장 뒤 재현 종가·추정 고가) − CAGR(실제) (재현 가격 전체 탓 — 경로가 조금만 달라도 결과가 크게 바뀌는 설정을 걸러 냄)
     → |dh| ≤ 2%p 이고 |dSyn| ≤ 5%p 인 것 중 최고도 따로
   · 다른 기간 시험: 상장 이후에서 고른 설정을 재현 구간만(처음~상장 전날)에서, 상장 전 포함에서 고른 설정을 상장 이후에서
   · 프런티어(MDD 한도별 최고 CAGR) · 버전별 표(CSV) */
'use strict';
const fs = require('fs'), path = require('path');
const [D1, D2, DATA, SRC, OUT] = process.argv.slice(2);
const src = fs.readFileSync(SRC, 'utf8');
const gr = (n, e) => { const a = src.indexOf('var ' + n + ' = (function'), b = src.indexOf(e, a); return src.slice(a, b); };
const MHE = new Function(gr('MHE', "if (typeof module !== 'undefined') module.exports = MHE;") + '\nreturn MHE;')();
const MHV = new Function('MHE', gr('MHV', "if (typeof module !== 'undefined') module.exports = MHV;") + '\nreturn MHV;')(MHE);
function cfgOf(tk, p) {
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
const dn = s => Date.parse(s + 'T00:00:00Z') / 864e5;
const DS = {}; const ds = (tk, k) => { if (DS[tk + k]) return DS[tk + k]; const D = JSON.parse(fs.readFileSync(path.join(DATA, tk + '_' + k + '.json'), 'utf8'));
  /* 계산 저장 열쇠: 종목·종류 + 자료 길이·끝 날짜·끝 종가·끝 고가 (자료가 바뀌면 다시 계산) */
  D._k = tk + '_' + k + '@' + D.d.length + ':' + D.d[D.d.length - 1] + ':' + D.c[D.c.length - 1] + ':' + D.h[D.h.length - 1] + ':' + D.h[Math.floor(D.h.length / 2)]; return (DS[tk + k] = D); };
/* 계산 결과 저장(같은 설정·같은 구간은 다시 돌리지 않음) — CACHE 폴더의 cache*.json 을 읽고, 이번에 새로 계산한 것은 cache_<TAG>.json 으로 */
const CDIR = process.env.CACHE || OUT, CACHE = new Map(), NEW = {};
if (fs.existsSync(CDIR)) for (const f of fs.readdirSync(CDIR)) if (/^cache.*\.json$/.test(f)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(CDIR, f), 'utf8')))) CACHE.set(k, v);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
function run(tk, D, p, from, to) {
  to = to == null ? D.d.length - 1 : to; from = from || 1;
  const ck = D._k + '|' + from + '|' + to + '|' + kp(p); if (CACHE.has(ck)) return CACHE.get(ck);
  const o = run0(tk, D, p, from, to); CACHE.set(ck, o); NEW[ck] = o; return o;
}
function run0(tk, D, p, from, to) {
  const R = MHV.run(cfgOf(tk, p), D, { from, to, capital: 10000, norm: 'auto', rows: false, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: { fx: i => D.fx[i], method: p.method || 'fifo', harvest: !!p.harvest } });
  const days = dn(D.d[to]) - dn(D.d[from - 1]), cagr = R.final > 0 ? Math.pow(R.final / 10000, 365.25 / days) - 1 : -1;
  let pk = -Infinity, m = 0; for (const e of R.eq) { if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
  return { cagr, mdd: m, exh: R.n.exh, cyc: R.cycles.length, win: R.n.win, nob: R.nob || 0, lack0: R.lack0 || 0, ext: R.taxExt || 0, tsell: R.tsell || 0 };
}
function bh(D, from, to) { to = to == null ? D.d.length - 1 : to; from = from || 1; const days = dn(D.d[to]) - dn(D.d[from - 1]); let pk = -Infinity, m = 0; for (let i = from; i <= to; i++) { const e = D.c[i]; if (e > pk) pk = e; const d = e / pk - 1; if (d < m) m = d; } return { cagr: Math.pow(D.c[to] / D.c[from - 1], 365.25 / days) - 1, mdd: m }; }
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const CRED_OK = x => x.dh != null && Math.abs(x.dh) <= 0.02 && Math.abs(x.dSyn) <= 0.05;   /* 상장 전 포함 '믿을 만함' */
function neigh(tk, D, p) { const rs = []; for (const dsp of [-2, -1, 0, 1, 2]) for (const dt of [-1, -0.5, 0, 0.5, 1]) { const s = p.splits + dsp, t = Math.round((p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) rs.push(run(tk, D, Object.assign({}, p, { splits: s, target: t }))); }
  return { n: rs.length, cagrMed: med(rs.map(r => r.cagr)), mddMed: med(rs.map(r => r.mdd)), cagrMin: Math.min(...rs.map(r => r.cagr)), cagrMax: Math.max(...rs.map(r => r.cagr)) }; }
const KEYS = ['ver', 'splits', 'target', 'big', 'lines', 'shares', 'part', 'capP', 'avgOff', 'money', 'exhaust', 'restart', 'tround', 'rebase', 'noBig', 'method', 'harvest'];
const kp = p => KEYS.map(k => p[k]).join('|');
const clean = p => { const o = {}; KEYS.forEach(k => { if (p[k] !== undefined) o[k] = p[k]; }); return o; };
const list = (dir, re) => { const o = []; if (!dir || dir === '-' || !fs.existsSync(dir)) return o; (function w(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) w(q); else if (re.test(f)) o.push(q); } })(dir); return o; };
const C1 = list(D1, /^(TQQQ|SOXL|UPRO|TECL)_(act|pre)_\d\.\d\.json$/).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const C2 = list(D2, /^rob_(TQQQ|SOXL|UPRO|TECL)_(act|pre)_(cagr|calmar|cagrC|calmarC)\.json$/).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const f32 = b64 => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const RES = {}, CSV = [['종목', '기간', '버전', '뽑힘', '어디서 나온 후보', 'CAGR(세후)', 'MDD', '이웃 중앙 CAGR', '이웃 중앙 MDD', '이웃 최저 CAGR', '추정 고가 영향 dh(%p)', '재현 전체 차이 dSyn(%p)', '살 수 없는 날(일)', '분할', '목표%', '큰수%', '하방 LOC 줄', '줄당 주식', '1차 매도%', '큰수 상한%', '평단 괴리%', '1회 매수금', '소진 대응', '새 사이클', 'T 반올림', '다시 정하기', '큰수 미사용', '취득가액', '연말 절세', '시뮬레이터 주소']];
const hashOf = (tk, p, per) => { const h = ['v=' + p.ver, 't=' + tk, 'c=10000', 'sp=' + p.splits, 'tg=' + p.target];
  if (p.ver === '2.0' || p.ver === '2.1') h.push('pt=' + p.part, 'cp=' + p.capP); h.push('bg=' + p.big, 'fe=0.07');
  if (p.ver !== '1.0' && p.ver !== '2.0') h.push('ln=' + p.lines, 'sh=' + p.shares); if (p.ver === '4.0' && p.noBig) h.push('nb=1');
  if (/^(1\.0|2\.0|2\.1|2\.2)$/.test(p.ver) && p.money !== 'compound') h.push('m=' + p.money); if (p.ver !== '4.0' && p.exhaust !== 'official') h.push('x=' + p.exhaust); if (p.ver !== '4.0' && p.restart === 'rsi') h.push('r=rsi');
  if (per === 'pre') h.push('p=1'); if (p.ver === '3.0' && p.rebase) h.push('rb=1'); if ((p.ver === '1.0' || p.ver === '2.0' || p.ver === '2.1') && p.avgOff) h.push('ao=' + p.avgOff);
  if ((p.ver === '2.2' || p.ver === '3.0') && p.tround === 'c1') h.push('tr=c1'); if (p.method === 'avg') h.push('tm=avg'); if (p.harvest) h.push('hv=1');
  return 'https://d-capitalism.com/muhan-backtest/#' + h.join('&'); };
for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) for (const per of ['act', 'pre']) {
  if (ONLY && !ONLY.includes(tk)) continue;
  const cells = C1.filter(c => c.tk === tk && c.per === per); if (!cells.length) continue;
  const D = ds(tk, per), cand = new Map();
  const add = (p, src, extra) => { p = clean(p); const k = kp(p); if (!cand.has(k)) cand.set(k, Object.assign({ p, src: [src] }, extra || {})); else cand.get(k).src.push(src); };
  for (const c of cells) {
    for (const obj of ['cagr', 'calmar']) { const f = c.final[obj]; if (!f) continue; add(f.raw.p, '1단계 ' + obj + ' 최고'); add(f.robust.p, '1단계 ' + obj + ' 안정'); f.cands.forEach(x => add(Object.assign({ ver: c.ver, method: 'fifo', harvest: false }, x.p), '1단계 ' + obj + ' 후보')); }
    add(Object.assign({}, c.default.p), '원문 기본값');
  }
  for (const r of C2.filter(c => c.tk === tk && c.per === per)) for (const x of r.runs) add(x.p, '2단계 ' + x.obj);
  /* 모든 후보: 가운데 · 이웃 25점 · (상장 전 포함) 재현 믿음도 */
  const DA = ds(tk, 'act'), DL = per === 'pre' ? ds(tk, 'late') : null, DH = per === 'pre' ? ds(tk, 'hyb') : null, rows = [];
  const credOf = p => { const a = run(tk, DA, p), h = run(tk, DH, p), l = run(tk, DL, p); return { dh: h.cagr - a.cagr, dSyn: l.cagr - a.cagr, actCagr: a.cagr }; };
  for (const [, c] of cand) {
    c.r = run(tk, D, c.p); c.n = neigh(tk, D, c.p);
    if (DH) Object.assign(c, credOf(c.p));
    rows.push(c);
  }
  const best = (arr, f) => arr.reduce((b, x) => (f(x) > f(b) ? x : b), arr[0]);
  /* 프런티어(이웃 25점 중앙값 기준): MDD 한도 L 마다 '이웃 중앙 MDD ≥ L' 인 것 중 이웃 중앙 CAGR 최고
     후보 = 위 후보 전부 + 1단계 격자를 이웃 9점으로 매끈하게 한 지도에서 L 마다 위쪽 5개(살 수 없는 날 없는 것; 상장 전 포함은 믿을 만한 것 5개 더)
     모두 가운데 설정에 살 수 없는 날(nob)이 없어야 함 */
  const sm = [];
  for (const c of cells) {
    const S = c.splits, T = c.targets, si = {}, ti = {}; S.forEach((v, i) => si[v] = i); T.forEach((v, i) => ti[v] = i);
    for (const g of c.grid) {
      const cg = f32(g.cagr), md = f32(g.mdd), at = (a, b) => { const x = si[a], y = ti[b]; return x == null || y == null ? null : x * T.length + y; };
      for (const sp of S) for (const t of T) { if (t > 49) continue; const cs = [], ms = [];
        for (const dsp of [-2, 0, 2]) for (const dt of [-1, 0, 1]) { const j = at(sp + dsp, Math.round((t + dt) * 2) / 2); if (j != null) { cs.push(cg[j]); ms.push(md[j]); } }
        if (cs.length >= 6) sm.push([med(cs), med(ms), c, g.combo, sp, t]); }
    }
  }
  sm.sort((a, b) => b[0] - a[0]);
  const pOf = x => clean(Object.assign({}, x[2].default.p, x[2].combos[x[3]], { splits: x[4], target: x[5] }));
  const pool = new Map(rows.map(x => [kp(x.p), x])), info = new Map();
  const infoOf = p => { const k = kp(p); if (!info.has(k)) { const r = run(tk, D, p), o = { r }; if (DH && r.nob === 0) Object.assign(o, credOf(p)); info.set(k, o); } return info.get(k); };
  const LS = [-0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8, -0.9, -1];
  for (const L of LS) { let nP = 0, nC = 0, tried = 0;
    for (const x of sm) { if (!(x[1] >= L)) continue; if (nP >= 5 && (!DH || nC >= 5)) break; if (++tried > 400) break;
      const p = pOf(x), k = kp(p), o = infoOf(p); if (o.r.nob > 0) continue;
      const isC = DH && CRED_OK(o); if (nP >= 5 && !isC) continue;
      if (!pool.has(k)) pool.set(k, Object.assign({ p, src: ['1단계 격자(매끈한 지도)'], r: o.r, n: neigh(tk, D, p) }, DH ? { dh: o.dh, dSyn: o.dSyn, actCagr: o.actCagr } : {}));
      nP++; if (isC) nC++; } }
  /* 뽑기 — 후보 전부(1·2단계 + 격자 지도 후보) 중에서.
     살 수 없는 날(1주 값 > 주문 금액 — 화면에 ⚠)이 있는 설정은 원래 방법대로 돌지 않으므로 뽑지 않음 (rawAny 만 참고로) */
  const allRows = [...pool.values()], okRows = allRows.filter(x => x.r.nob === 0), rawAny = best(allRows, x => x.r.cagr);
  const raw = best(okRows, x => x.r.cagr), rob = best(okRows, x => x.n.cagrMed);
  const floor = rob.n.cagrMed * 0.5, calN = x => x.n.cagrMed >= floor && x.n.mddMed < 0 ? x.n.cagrMed / -x.n.mddMed : -Infinity;
  const bal = best(okRows, calN);
  const cred = per === 'pre' ? okRows.filter(CRED_OK) : null;
  const credRob = cred && cred.length ? best(cred, x => x.n.cagrMed) : null, floorC = credRob ? credRob.n.cagrMed * 0.5 : null;
  const credBal = cred && cred.length ? best(cred, x => x.n.cagrMed >= floorC && x.n.mddMed < 0 ? x.n.cagrMed / -x.n.mddMed : -Infinity) : null;
  const P2 = okRows;
  const front = LS.map(L => { const ok = P2.filter(x => x.n.mddMed >= L), okC = DH ? ok.filter(CRED_OK) : [];
    return { L, plain: ok.length ? best(ok, x => x.n.cagrMed) : null, cred: okC.length ? best(okC, x => x.n.cagrMed) : null }; });
  const B = bh(D);
  RES[tk + '_' + per] = { tk, per, from: D.d[0], to: D.d[D.d.length - 1], listing: D.L ? D.d[D.L] : D.d[0], bh: B, nEval: cells.reduce((s, c) => s + c.nEval, 0) + C2.filter(c => c.tk === tk && c.per === per).reduce((s, c) => s + c.nEval, 0),
    raw, rawAny, rob, bal, floor, floorC, credRob, credBal, nCred: cred ? cred.length : null, nCand: rows.length, front, defaults: rows.filter(x => x.src.includes('원문 기본값')),
    nSm: sm.length, nPool: pool.size };
  /* 뽑힌 설정: 원금·수수료 바꿔 보기 · 세전 */
  for (const x of [raw, rawAny, rob, bal, credRob, credBal]) if (x && !x.alt) {
    const alt = o => { const R = MHV.run(cfgOf(tk, x.p), D, Object.assign({ from: 1, to: D.d.length - 1, norm: 'auto', rows: false }, o)); const days = dn(D.d[D.d.length - 1]) - dn(D.d[0]); return R.final > 0 ? Math.pow(R.final / o.capital, 365.25 / days) - 1 : -1; };
    const tx = { fx: i => D.fx[i], method: x.p.method || 'fifo', harvest: !!x.p.harvest };
    x.alt = { cap100k: alt({ capital: 100000, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: tx }), cap1m: alt({ capital: 1000000, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: tx }),
              fee025: alt({ capital: 10000, fee: 0.0025, sec: 0.0000206, divTax: 0.15, tax: tx }), gross: alt({ capital: 10000, fee: 0, sec: 0, divTax: 0, tax: null }) };
  }
  const tag = new Map(); const tg = (x, t) => { if (!x) return; const k = kp(x.p); tag.set(k, (tag.get(k) ? tag.get(k) + ' · ' : '') + t); };
  tg(raw, '최고 CAGR'); if (rawAny !== raw) tg(rawAny, '최고 CAGR(⚠ 살 수 없는 날 있음)'); tg(rob, '안정 최고'); tg(bal, '균형'); tg(credRob, '믿을 만한 안정 최고'); tg(credBal, '믿을 만한 균형');
  front.forEach(f => { tg(f.plain, '이웃 MDD ≥ ' + Math.round(f.L * 100) + '% 최고'); tg(f.cred, '믿을 만한 이웃 MDD ≥ ' + Math.round(f.L * 100) + '% 최고'); });
  for (const x of [...pool.values()].sort((a, b) => (tag.has(kp(b.p)) - tag.has(kp(a.p))) || b.n.cagrMed - a.n.cagrMed)) { const p = x.p; CSV.push([tk, per === 'act' ? '상장 이후' : '상장 전 포함', p.ver, tag.get(kp(p)) || '', x.src.join(' / '), (x.r.cagr * 100).toFixed(2), (x.r.mdd * 100).toFixed(1), (x.n.cagrMed * 100).toFixed(2), (x.n.mddMed * 100).toFixed(1), (x.n.cagrMin * 100).toFixed(2), x.dh == null ? '' : (x.dh * 100).toFixed(2), x.dSyn == null ? '' : (x.dSyn * 100).toFixed(2), x.r.nob,
    p.splits, p.target, p.big, p.ver === '1.0' || p.ver === '2.0' ? '' : p.lines, p.ver === '1.0' || p.ver === '2.0' ? '' : p.shares, p.ver === '2.0' || p.ver === '2.1' ? p.part : '', p.ver === '2.0' || p.ver === '2.1' ? p.capP : '', p.ver === '1.0' || p.ver === '2.0' || p.ver === '2.1' ? p.avgOff : '',
    /^(1\.0|2\.0|2\.1|2\.2)$/.test(p.ver) ? p.money : '', p.ver === '4.0' ? '' : p.exhaust, p.ver === '4.0' ? '' : p.restart, p.ver === '2.2' || p.ver === '3.0' ? p.tround : '', p.ver === '3.0' ? (p.rebase ? '켬' : '끔') : '', p.ver === '4.0' ? (p.noBig ? '켬' : '끔') : '', p.method, p.harvest ? '켬' : '끔', hashOf(tk, p, per)]); }
  const pc = x => (x * 100).toFixed(2) + '%';
  console.log('\n=== ' + tk + ' ' + per + ' 후보 ' + rows.length + ' · 그냥 보유 ' + pc(B.cagr) + '/' + pc(B.mdd));
  for (const [nm, x] of [['최고(경고 포함)', rawAny !== raw ? rawAny : null], ['최고', raw], ['안정', rob], ['균형', bal], ['믿을만한 안정', credRob], ['믿을만한 균형', credBal]]) if (x) console.log('  ' + nm + ' V' + x.p.ver + ' ' + x.p.splits + '분할 ' + x.p.target + '% | ' + pc(x.r.cagr) + '/' + pc(x.r.mdd) + (x.r.nob ? ' 살 수 없는 날 ' + x.r.nob : '') + ' | 이웃 ' + pc(x.n.cagrMed) + '/' + pc(x.n.mddMed) + ' 최저 ' + pc(x.n.cagrMin) + (x.dh != null ? ' | dh ' + pc(x.dh) + ' dSyn ' + pc(x.dSyn) : '') + (x.alt ? ' | 10만$ ' + pc(x.alt.cap100k) + ' 100만$ ' + pc(x.alt.cap1m) + ' 수수료0.25% ' + pc(x.alt.fee025) + ' 세전 ' + pc(x.alt.gross) : '') + ' | ' + x.src[0]);
  const fs1 = x => 'V' + x.p.ver + ' ' + x.p.splits + '/' + x.p.target + ' 이웃 ' + pc(x.n.cagrMed) + '/' + pc(x.n.mddMed) + ' (한 점 ' + pc(x.r.cagr) + '/' + pc(x.r.mdd) + ')' + (x.dh != null ? ' dh ' + pc(x.dh) : '');
  for (const f of front) console.log('  이웃 MDD ≥ ' + Math.round(f.L * 100) + '%: ' + (f.plain ? fs1(f.plain) : '—') + (f.cred ? ' ‖ 믿을 만한 ' + fs1(f.cred) : ''));
}
/* 다른 기간 시험 */
const OOS = {};
for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
  const A = RES[tk + '_act'], P = RES[tk + '_pre']; if (!A || !P) continue;
  const DP = ds(tk, 'pre'), DA = ds(tk, 'act'), L = DP.L; OOS[tk] = {};
  const segs = { synth: [DP, 1, L - 1], act: [DA, 1, DA.d.length - 1], pre: [DP, 1, DP.d.length - 1] };
  for (const [nm, x] of [['상장 이후 최고', A.raw], ['상장 이후 안정', A.rob], ['상장 이후 균형', A.bal], ['상장 전 포함 최고', P.raw], ['상장 전 포함 안정', P.rob], ['상장 전 포함 균형', P.bal], ['상장 전 포함 믿을 만한 안정', P.credRob], ['상장 전 포함 믿을 만한 균형', P.credBal], ['원문 기본값 V4.0', { p: clean(Object.assign({ ver: '4.0' }, (A.defaults.find(d => d.p.ver === '4.0') || {}).p)) }], ['원문 기본값 V2.2', { p: clean((A.defaults.find(d => d.p.ver === '2.2') || {}).p || {}) }]]) {
    if (!x || !x.p || !x.p.ver) continue;
    const o = {}; for (const [sn, [D, f, t]] of Object.entries(segs)) o[sn] = run(tk, D, x.p, f, t);
    OOS[tk][nm] = { p: x.p, o };
  }
  OOS[tk]['그냥 보유'] = { o: { synth: bh(DP, 1, L - 1), act: bh(DA), pre: bh(DP) } };
}
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(CDIR, { recursive: true });
fs.writeFileSync(path.join(CDIR, 'cache_' + (process.env.TAG || 'main') + '.json'), JSON.stringify(NEW));
fs.writeFileSync(path.join(OUT, 'final.json'), JSON.stringify({ RES, OOS }, null, 1));
fs.writeFileSync(path.join(OUT, '무한매수법_설정탐색_후보.csv'), '﻿' + CSV.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n'));
console.log('\n다른 기간 시험');
for (const [tk, o] of Object.entries(OOS)) for (const [nm, x] of Object.entries(o)) console.log(tk, nm, ['synth', 'act', 'pre'].map(s => s + ' ' + (x.o[s].cagr * 100).toFixed(1) + '%/' + (x.o[s].mdd * 100).toFixed(0) + '%').join(' · '));
