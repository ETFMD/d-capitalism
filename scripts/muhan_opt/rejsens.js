/* '그날 건너뛰기'로 뽑힌 설정이 거부 규칙을 조금만 바꿔도 버티는지 — 한도 배수(1.15·1.2·1.25·1.3·1.5) · 기준가(그날 시가 / 전날 종가)
   node rejsens.js <데이터 폴더> <src/index.html> <final.json>   → 마크다운 표 */
'use strict';
const fs = require('fs'), path = require('path');
const [DATA, SRC, FJ] = process.argv.slice(2);
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
const DS = {}; const ds = (tk, k) => DS[tk + k] || (DS[tk + k] = JSON.parse(fs.readFileSync(path.join(DATA, tk + '_' + k + '.json'), 'utf8')));
function run(tk, D, p, rej) {
  const from = 1, to = D.d.length - 1;
  const R = MHV.run(cfgOf(tk, p), D, { from, to, capital: 10000, norm: 'auto', rows: false, fee: 0.0007, sec: 0.0000206, divTax: 0.15, tax: { fx: i => D.fx[i], method: p.method || 'fifo', harvest: !!p.harvest }, rej });
  const days = dn(D.d[to]) - dn(D.d[from - 1]), cagr = R.final > 0 ? Math.pow(R.final / 10000, 365.25 / days) - 1 : -1;
  return (cagr * 100).toFixed(1);
}
const j = JSON.parse(fs.readFileSync(FJ, 'utf8'));
console.log('| 종목 · 기간 | 기준 | 설정 | 반영 안 함 | 시가×1.15 | ×1.2 | ×1.25 | ×1.3 | ×1.5 | 전날 종가×1.2 |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const [key, r] of Object.entries(j.RES)) {
  const [tk, per] = key.split('_'), D = ds(tk, per), D0 = Object.assign({}, D, { o: null });
  const picks = per === 'act' ? [['최고', r.raw], ['안정', r.rob], ['균형', r.bal]] : [['최고', r.raw], ['믿을 만한 안정', r.credRob], ['믿을 만한 균형', r.credBal]];
  const seen = new Set();
  for (const [nm, x] of picks) { if (!x) continue; const k = JSON.stringify(x.p); if (seen.has(k)) continue; seen.add(k);
    const row = [run(tk, D, x.p, null)].concat([1.15, 1.2, 1.25, 1.3, 1.5].map(c => run(tk, D, x.p, { mode: 'skip', cap: c })), [run(tk, D0, x.p, { mode: 'skip', cap: 1.2 })]);
    console.log('| ' + key + ' | ' + nm + ' | V' + x.p.ver + ' ' + x.p.splits + '분할 ' + x.p.target + '% 큰수 ' + x.p.big + '% | ' + row.join(' | ') + ' |'); }
}
