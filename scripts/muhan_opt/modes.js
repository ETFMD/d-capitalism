/* 뽑힌 설정을 세 방식(반영 안 함 · 한도로 낮춰 넣기 · 그날 건너뛰기)에 모두 넣어 보기 — 같은 자료·같은 조건(final.js run0 과 같음)
   node modes.js <데이터 폴더> <src/index.html> <이름=final.json> [...]   → 표준 출력 표 + CMP_OUT=<json 경로> */
'use strict';
const fs = require('fs'), path = require('path');
const [DATA, SRC, ...FJ] = process.argv.slice(2);
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
function run(tk, D, p, mode, fee) {
  const from = 1, to = D.d.length - 1, rej = mode === 'none' ? null : { mode, cap: 1.2 };
  const R = MHV.run(cfgOf(tk, p), D, { from, to, capital: 10000, norm: 'auto', rows: false, fee: fee == null ? 0.0007 : fee, sec: 0.0000206, divTax: 0.15, tax: { fx: i => D.fx[i], method: p.method || 'fifo', harvest: !!p.harvest }, rej });
  const days = dn(D.d[to]) - dn(D.d[from - 1]), cagr = R.final > 0 ? Math.pow(R.final / 10000, 365.25 / days) - 1 : -1;
  let pk = -Infinity, m = 0; for (const e of R.eq) { if (e > pk) pk = e; const dd = e / pk - 1; if (dd < m) m = dd; }
  return { cagr, mdd: m, rj: R.rj ? { days: R.rj.days, rows: R.rj.rows, miss: R.rj.miss, noO: R.rj.noO } : null, nob: R.nob || 0 };
}
const pc = x => (x * 100).toFixed(1);
const OUT = {};
const NM = { raw: '최고 CAGR', rob: '안정 최고', bal: '균형', credRob: '믿을 만한 안정 최고', credBal: '믿을 만한 균형' };
for (const arg of FJ) {
  const [name, f] = arg.split('=');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [key, r] of Object.entries(j.RES)) {
    const [tk, per] = key.split('_'), D = ds(tk, per);
    for (const nm of per === 'act' ? ['raw', 'rob', 'bal'] : ['raw', 'credRob', 'credBal']) {
      const x = r[nm]; if (!x) continue;
      const o = { src: name, tk, per, nm: NM[nm], p: x.p };
      for (const m of ['none', 'clamp', 'skip']) o[m] = run(tk, D, x.p, m);
      (OUT[key] = OUT[key] || []).push(o);
      const s = m => pc(o[m].cagr) + ' / ' + pc(o[m].mdd) + (o[m].rj ? ' (' + o[m].rj.days + '일' + (o[m].rj.miss ? '·' + o[m].rj.miss : '') + ')' : '');
      console.log([key, name, NM[nm], 'V' + x.p.ver + ' ' + x.p.splits + '분할 ' + x.p.target + '% 큰수 ' + x.p.big + '%', s('none'), s('clamp'), s('skip')].join(' | '));
    }
  }
}
if (process.env.CMP_OUT) fs.writeFileSync(process.env.CMP_OUT, JSON.stringify(OUT, null, 1));
