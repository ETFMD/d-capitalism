/* 재현 믿음도 준비 — node prep.js <1단계 폴더> <regions.json> <데이터 폴더> <src/index.html>
   1) <종목>_hyb.json = 실제 종가·분배금 + 상장 전 재현에 쓰는 '추정 고가'
      (late 의 고가 ÷ max(전일 종가, 종가) 비율을 실제 종가에 그대로 적용 — 종가는 실제, 고가만 모형)
   2) 상장 전 포함: 1단계 후보마다 dh = CAGR(hyb) − CAGR(act) (추정 고가 때문에 부풀거나 줄어든 몫)
      |dh| ≤ 2%p 이고 살 수 없는 날(nob)이 없으면 '믿을 만함' → floorC = 믿을 만한 후보 이웃 25점 중앙 CAGR 최고의 절반,
      startsC = 버전별 믿을 만한 최고(cagrC)·균형(calmarC) 출발점 → regions.json 에 덧붙임 */
'use strict';
const fs = require('fs'), path = require('path');
const [D1, REGF, DATA, SRC] = process.argv.slice(2);
const TH = 0.02;
const src = fs.readFileSync(SRC, 'utf8');
const gr = (n, e) => { const a = src.indexOf('var ' + n + ' = (function'), b = src.indexOf(e, a); if (a < 0 || b < 0) throw new Error(n); return src.slice(a, b); };
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
const rd = (tk, k) => JSON.parse(fs.readFileSync(path.join(DATA, tk + '_' + k + '.json'), 'utf8'));
function run(tk, D, p) {
  const from = 1, to = D.d.length - 1;
  const R = MHV.run(cfgOf(tk, p), D, { from, to, capital: 10000, norm: 'auto', rows: false, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: { fx: i => D.fx[i], method: p.method || 'fifo', harvest: !!p.harvest } });
  const days = dn(D.d[to]) - dn(D.d[from - 1]), cagr = R.final > 0 ? Math.pow(R.final / 10000, 365.25 / days) - 1 : -1;
  let pk = -Infinity, m = 0; for (const e of R.eq) { if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
  return { cagr, mdd: m, nob: R.nob || 0 };
}
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const nb25 = p => { const o = []; for (const ds of [-2, -1, 0, 1, 2]) for (const dt of [-1, -0.5, 0, 0.5, 1]) { const s = p.splits + ds, t = Math.round((p.target + dt) * 2) / 2; if (s >= 2 && s <= 100 && t >= 0.5 && t <= 100) o.push(Object.assign({}, p, { splits: s, target: t })); } return o; };
/* 1) hyb */
const HYB = {};
for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
  const a = rd(tk, 'act'), l = rd(tk, 'late');
  if (a.d.length !== l.d.length || a.d[0] !== l.d[0] || a.d[a.d.length - 1] !== l.d[l.d.length - 1]) throw new Error(tk + ' late/act 날짜 다름');
  const h = a.c.map((c, i) => i === 0 ? a.h[0] : Math.max(a.c[i - 1], c) * (l.h[i] / Math.max(l.c[i - 1], l.c[i])));
  HYB[tk] = Object.assign({}, a, { h, L: 0 });
  fs.writeFileSync(path.join(DATA, tk + '_hyb.json'), JSON.stringify(HYB[tk]));
}
/* 2) 상장 전 포함 후보의 믿음도 (REGF 가 '-' 면 hyb 만 만들고 끝) */
if (REGF === '-') { console.log('hyb 만 만듦'); process.exit(0); }
const REG = JSON.parse(fs.readFileSync(REGF, 'utf8'));
const files = []; (function w(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) w(q); else if (/^(TQQQ|SOXL|UPRO|TECL)_pre_\d\.\d\.json$/.test(f)) files.push(q); } })(D1);
const KEYS = ['ver', 'splits', 'target', 'big', 'lines', 'shares', 'part', 'capP', 'avgOff', 'money', 'exhaust', 'restart', 'tround', 'rebase', 'noBig', 'method', 'harvest'];
for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
  const k = tk + '_pre'; if (!REG[k]) continue;
  const cells = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8'))).filter(c => c.tk === tk);
  const A = rd(tk, 'act'), P = rd(tk, 'pre'), H = HYB[tk], seen = new Set(), rows = [];
  for (const c of cells) {
    const ps = [c.default.p];
    for (const obj of ['cagr', 'calmar']) { const f = c.final[obj]; if (!f) continue; ps.push(f.raw.p, f.robust.p); f.cands.forEach(x => ps.push(x.p)); }
    for (const p0 of ps) {
      const p = Object.assign({ ver: c.ver, method: 'fifo', harvest: false }, p0), key = KEYS.map(n => p[n]).join('|'); if (seen.has(key)) continue; seen.add(key);
      const dh = run(tk, H, p).cagr - run(tk, A, p).cagr, row = { ver: c.ver, p, dh };
      if (Math.abs(dh) <= TH && run(tk, P, p).nob === 0) { const rs = nb25(p).map(q => run(tk, P, q)); row.s9 = { cagrMed: med(rs.map(r => r.cagr)), mddMed: med(rs.map(r => r.mdd)) }; }
      rows.push(row);
    }
  }
  const cred = rows.filter(r => r.s9);
  const maxC = cred.reduce((m, r) => Math.max(m, r.s9.cagrMed), -Infinity), floorC = isFinite(maxC) ? maxC * 0.5 : 0;
  const calC = r => r.s9 && r.s9.cagrMed >= floorC && r.s9.mddMed < 0 ? r.s9.cagrMed / -r.s9.mddMed : -Infinity;
  const startsC = [];
  for (const ver of ['1.0', '2.0', '2.1', '2.2', '3.0', '4.0']) {
    const cv = cred.filter(r => r.ver === ver), base = REG[k].starts.filter(s => s.ver === ver);
    const b1 = cv.reduce((b, r) => (!b || r.s9.cagrMed > b.s9.cagrMed ? r : b), null), b2 = cv.reduce((b, r) => (calC(r) > -Infinity && (!b || calC(r) > calC(b)) ? r : b), null);
    const fb = o => (base.find(s => s.obj === o) || base[0] || {}).p;
    startsC.push({ ver, obj: 'cagrC', p: b1 ? b1.p : fb('cagr'), from: b1 ? '1단계 믿을 만한 후보' : '매끈한 지도(믿음도 미확인)', s9: b1 && b1.s9, dh: b1 && b1.dh });
    startsC.push({ ver, obj: 'calmarC', p: b2 ? b2.p : (b1 ? b1.p : fb('calmar')), from: b2 ? '1단계 믿을 만한 균형 후보' : '대체 출발점', s9: b2 && b2.s9, dh: b2 && b2.dh });
  }
  REG[k].floorC = floorC; REG[k].startsC = startsC; REG[k].prep = { nCand: rows.length, nCred: cred.length, th: TH };
  const pc = x => (x * 100).toFixed(2) + '%';
  console.log(k, '후보 ' + rows.length + ' · 믿을 만함 ' + cred.length + ' · 믿을 만한 이웃 중앙 최고 ' + pc(maxC) + ' → floorC ' + pc(floorC));
  console.log('  dh 분포: ' + rows.map(r => r.dh).sort((x, y) => x - y).map(x => (x * 100).toFixed(1)).join(' '));
  for (const s of startsC) console.log('  ' + s.obj + ' V' + s.ver + ' ' + s.p.splits + '분할 ' + s.p.target + '% · ' + s.from + (s.s9 ? ' · 이웃 ' + pc(s.s9.cagrMed) + '/' + pc(s.s9.mddMed) + ' dh ' + pc(s.dh) : ''));
}
fs.writeFileSync(REGF, JSON.stringify(REG, null, 1));
