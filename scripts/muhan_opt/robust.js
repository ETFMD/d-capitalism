/* 거부 처리를 어떻게 가정하든 버티는 설정 — node robust.js <데이터 폴더> <src/index.html> <출력.json> <final 후보.csv> [후보.csv …]  (TOP=12 · ONLY=TQQQ,UPRO · PER=act|pre 로 나눠 돌릴 수 있음)
   후보 = 두 방식 최종 정리 CSV 의 설정 전부(시뮬레이터 주소에서 읽음 · 같은 설정은 하나로)
   시나리오 6개: 반영 안 함 · 한도로 낮춰 넣기(시가×1.2) · 그날 건너뛰기(시가×1.2 · ×1.15 · ×1.25 · 전날 종가×1.2)
   · 한 점 점수 = 6개 중 가장 낮은 CAGR → 위쪽 TOP 개만 이웃 25곳(분할 ±2 × 목표 ±1)을 6개 시나리오로 → 이웃 중앙 CAGR 의 6개 중 최저
   · 뽑기: 최고(한 점 최저 CAGR 최대) · 안정(min(한 점 최저, 이웃 중앙 최저) 최대) · 균형(그 값 ÷ |min(한 점 최저 MDD, 이웃 중앙 최저 MDD)| 최대, 안정의 절반 이상)
   · 이웃까지 보는 후보 = 한 점 최저 CAGR 위쪽 TOP + 그 비율 위쪽 TOP + 최종 정리 CSV 이웃 중앙값(두 방식 중 나쁜 쪽) 위쪽 2×TOP + 그 비율 위쪽 2×TOP
   · 상장 전 포함은 '믿을 만한' 것만(한도로 낮춰 넣기 기준 |dh| ≤ 2 · |dSyn| ≤ 5 · 세전 |d| < 5%p) · 살 수 없는 날(nob) 있는 설정 제외 */
'use strict';
const fs = require('fs'), path = require('path');
const [DATA, SRC, OUTF, ...CSVS] = process.argv.slice(2);
const TOP = +(process.env.TOP || 12), ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, PER = process.env.PER || null;   /* PER=act|pre 로 한 기간만 */
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
const DS = {}; const ds = (tk, k) => DS[tk + k] || (DS[tk + k] = Object.assign(JSON.parse(fs.readFileSync(path.join(DATA, tk + '_' + k + '.json'), 'utf8')), { _tag: tk + '_' + k }));
const SC = [['none', null, false], ['clamp', { mode: 'clamp', cap: 1.2 }, false], ['skip', { mode: 'skip', cap: 1.2 }, false], ['skip115', { mode: 'skip', cap: 1.15 }, false], ['skip125', { mode: 'skip', cap: 1.25 }, false], ['skipPrev', { mode: 'skip', cap: 1.2 }, true]];
const memo = new Map();
function run(tk, D, p, rej, prevBasis, gross) {
  const k = D._tag + '|' + JSON.stringify(p) + '|' + JSON.stringify(rej) + prevBasis + gross;   /* 자료 종류(act·pre·hyb·late)까지 열쇠에 — 길이만으로는 act·hyb·late 가 같아 섞임 */
  if (memo.has(k)) return memo.get(k);
  const DD = prevBasis ? Object.assign({}, D, { o: null }) : D, from = 1, to = D.d.length - 1;
  const o = gross ? { from, to, capital: 10000, norm: 'auto', rows: false, rej } : { from, to, capital: 10000, norm: 'auto', rows: false, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: { fx: i => D.fx[i], method: p.method || 'fifo', harvest: !!p.harvest }, rej };
  const R = MHV.run(cfgOf(tk, p), DD, o);
  const days = dn(D.d[to]) - dn(D.d[from - 1]), cagr = R.final > 0 ? Math.pow(R.final / 10000, 365.25 / days) - 1 : -1;
  let pk = -Infinity, m = 0; for (const e of R.eq) { if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
  const r = { cagr, mdd: m, nob: R.nob || 0, rjDays: R.rj ? R.rj.days : 0 }; memo.set(k, r); return r;
}
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
/* CSV → 설정 (mk_prev.js 와 같은 방식 · 주소의 코드값) */
const parseCSV = t => { const rows = [], re = /("([^"]|"")*"|[^,\n]*)(,|\n|$)/g; let row = [], m; t = t.replace(/^﻿/, '');
  while ((m = re.exec(t)) && m[0] !== '') { let v = m[1]; if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"'); row.push(v); if (m[3] !== ',') { rows.push(row); row = []; } } return rows; };
const POOL = {};
for (const f of CSVS) {
  const C = parseCSV(fs.readFileSync(f, 'utf8')), H = C[0], ix = Object.fromEntries(H.map((h, i) => [h, i]));
  for (const r of C.slice(1)) {
    if (r.length < H.length) continue;
    const url = r[ix['시뮬레이터 주소']], q = Object.fromEntries(url.split('#')[1].split('&').map(kv => kv.split('='))), tk = q.t, per = q.p === '1' ? 'pre' : 'act', v = q.v, DEF = MHV.defaults(v, tk);
    const rel = { lines: v !== '1.0' && v !== '2.0', pc: v === '2.0' || v === '2.1', money: /^(1\.0|2\.0|2\.1|2\.2)$/.test(v), tr: v === '2.2' || v === '3.0' };
    const p = { ver: v, splits: +q.sp, target: +q.tg, big: +q.bg, lines: rel.lines ? +q.ln : DEF.lines, shares: rel.lines ? +q.sh : 1,
      part: rel.pc ? +q.pt : DEF.part || 5, capP: rel.pc ? +q.cp : DEF.cap || 5, avgOff: q.ao ? +q.ao : 0,
      money: rel.money ? q.m || 'compound' : v === '3.0' ? 'half' : 'cash', exhaust: v === '4.0' ? 'official' : q.x || 'official', restart: v === '4.0' ? 'next' : q.r === 'rsi' ? 'rsi' : 'next',
      tround: rel.tr && q.tr === 'c1' ? 'c1' : 'r2', rebase: v === '3.0' && q.rb === '1', noBig: v === '4.0' && q.nb === '1', method: q.tm === 'avg' ? 'avg' : 'fifo', harvest: q.hv === '1' };
    if (p.avgOff !== 0) continue;
    const key = url.split('#')[1].split('&').filter(kv => !/^(rj|e)=/.test(kv)).join('&');
    const P = (POOL[tk + '_' + per] = POOL[tk + '_' + per] || new Map());
    if (!P.has(key)) P.set(key, { key, p, from: [], csvNbC: Infinity, csvNbM: 0 });
    const E = P.get(key); E.from.push(path.basename(path.dirname(f)) + ':' + (r[ix['뽑힘']] || '후보'));
    E.csvNbC = Math.min(E.csvNbC, +r[ix['이웃 중앙 CAGR']] / 100); E.csvNbM = Math.min(E.csvNbM, +r[ix['이웃 중앙 MDD']] / 100);   /* 두 방식 최종 정리의 이웃 중앙값 중 나쁜 쪽 — 이웃까지 볼 후보 고르기에만 씀 */
  }
}
const OUT = {};
const pc = x => (x * 100).toFixed(1);
for (const [key, P] of Object.entries(POOL)) {
  const [tk, per] = key.split('_'); if (ONLY && !ONLY.includes(tk) || PER && per !== PER) continue;
  const D = ds(tk, per), cands = [...P.values()];
  for (const c of cands) { c.sc = {}; for (const [nm, rej, pb] of SC) c.sc[nm] = run(tk, D, c.p, rej, pb, false); c.minC = Math.min(...SC.map(s => c.sc[s[0]].cagr)); c.minM = Math.min(...SC.map(s => c.sc[s[0]].mdd)); }
  let ok = cands.filter(c => SC.every(s => c.sc[s[0]].nob === 0));
  if (per === 'pre') {   /* 믿을 만함 — 한도로 낮춰 넣기 기준 (final.js credOf 와 같은 계산) */
    const DA = ds(tk, 'act'), DH = ds(tk, 'hyb'), DL = ds(tk, 'late'), rj = { mode: 'clamp', cap: 1.2 };
    for (const c of ok) { const a = run(tk, DA, c.p, rj, false, false), h = run(tk, DH, c.p, rj, false, false), l = run(tk, DL, c.p, rj, false, false);
      const gA = run(tk, DA, c.p, rj, false, true), gL = run(tk, DL, c.p, rj, false, true);
      c.dh = h.cagr - a.cagr; c.dSyn = l.cagr - a.cagr; c.dSynG = gL.cagr - gA.cagr; c.cred = Math.abs(c.dh) <= 0.02 && Math.abs(c.dSyn) <= 0.05 && Math.abs(c.dSynG) < 0.05; }
    ok = ok.filter(c => c.cred);
  }
  ok.sort((a, b) => b.minC - a.minC);
  const top = ok.slice(0, TOP);
  /* 이웃: 위쪽 TOP 개 + 균형 후보(한 점 최저 CAGR ÷ |최저 MDD| 위쪽 TOP 개) */
  const balTop = ok.filter(c => c.minM < 0).sort((a, b) => b.minC / -b.minM - a.minC / -a.minM).slice(0, TOP);
  /* + 두 방식 최종 정리의 이웃 중앙값(나쁜 쪽)이 높은 것 · 그 비율이 좋은 것 — 한 점만 높은 봉우리 말고 넓게 좋은 곳도 이웃까지 봄 */
  const nbTop = ok.filter(c => isFinite(c.csvNbC)).sort((a, b) => b.csvNbC - a.csvNbC).slice(0, 2 * TOP);
  const nbBal = ok.filter(c => isFinite(c.csvNbC) && c.csvNbM < 0).sort((a, b) => b.csvNbC / -b.csvNbM - a.csvNbC / -a.csvNbM).slice(0, 2 * TOP);
  const look = [...new Set([...top, ...balTop, ...nbTop, ...nbBal])];
  for (const c of look) {
    c.nb = {};
    for (const [nm, rej, pb] of SC) { const rs = [];
      for (const dsp of [-2, -1, 0, 1, 2]) for (const dt of [-1, -0.5, 0, 0.5, 1]) { const s = c.p.splits + dsp, t = Math.round((c.p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) rs.push(run(tk, D, Object.assign({}, c.p, { splits: s, target: t }), rej, pb, false)); }
      c.nb[nm] = { cagr: med(rs.map(r => r.cagr)), mdd: med(rs.map(r => r.mdd)) }; }
    c.nbMinC = Math.min(...SC.map(s => c.nb[s[0]].cagr)); c.nbMinM = Math.min(...SC.map(s => c.nb[s[0]].mdd));
  }
  const best = (a, f) => a.reduce((b, x) => (f(x) > f(b) ? x : b), a[0]);
  /* 안정·균형은 가운데(한 점)와 이웃 중앙 중 나쁜 쪽으로 — 가운데만 움푹 꺼진 설정(이웃은 좋은데 그 설정 자체는 낮음)을 고르지 않게 */
  for (const c of look) { c.sC = Math.min(c.minC, c.nbMinC); c.sM = Math.min(c.minM, c.nbMinM); }
  const raw = top[0], rob = best(look, c => c.sC), floor = rob.sC * 0.5, bal = best(look, c => c.sC >= floor && c.sM < 0 ? c.sC / -c.sM : -Infinity);
  const pick = c => c && { p: c.p, key: c.key, from: c.from, minC: c.minC, minM: c.minM, nbMinC: c.nbMinC, nbMinM: c.nbMinM, sc: c.sc, nb: c.nb, dh: c.dh, dSyn: c.dSyn, dSynG: c.dSynG };
  OUT[key] = { tk, per, to: D.d[D.d.length - 1], nCand: cands.length, nOk: ok.length, nLook: look.length, raw: pick(raw), rob: pick(rob), bal: pick(bal),
    look: look.map(c => ({ key: c.key, p: c.p, minC: c.minC, minM: c.minM, nbMinC: c.nbMinC, nbMinM: c.nbMinM, sc: c.sc, nb: c.nb })) };
  console.log('\n=== ' + key + ' 후보 ' + cands.length + ' · 조건 맞는 것 ' + ok.length + ' · 이웃까지 본 것 ' + look.length);
  for (const [nm, c] of [['최고', raw], ['안정', rob], ['균형', bal]]) console.log('  ' + nm + ' V' + c.p.ver + ' ' + c.p.splits + '분할 ' + c.p.target + '% 큰수 ' + c.p.big + '% | 최저 ' + pc(c.minC) + '/' + pc(c.minM) + ' | 이웃 최저 ' + pc(c.nbMinC) + '/' + pc(c.nbMinM) + ' | ' + SC.map(s => s[0] + ' ' + pc(c.sc[s[0]].cagr)).join(' ') + ' | ' + c.from.slice(0, 2).join(' / '));
}
fs.writeFileSync(OUTF, JSON.stringify(OUT, null, 1));
