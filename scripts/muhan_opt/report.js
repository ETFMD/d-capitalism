/* final.json → 보고용 표(마크다운) — node report.js <final.json> [더 많은 final.json …] */
'use strict';
const fs = require('fs');
const RES = {}, OOS = {}; let RJ = 'none', FL = 'none';
for (const f of process.argv.slice(2)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); Object.assign(RES, j.RES); Object.assign(OOS, j.OOS); if (j.rej) RJ = j.rej; if (j.fill) FL = j.fill; }   /* rej: 증권사 주문 거부 처리 (final.js 의 REJ) */
const sg = x => { const v = Math.round(x * 1000) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1); };
const pc = (x, d) => x == null || !isFinite(x) ? '—' : (x * 100).toFixed(d == null ? 1 : d) + '%';
const EXH = { official: '원문', sellall: '소진 시 전량 매도', recover: '소진 시 매수 멈추고 평단 −10% 안 전량 매도', hold: '소진 시 매수 멈추고 보유' };
function desc(p) {
  const a = [], v = p.ver;
  a.push(p.splits + '분할', (v === '2.2' ? 'R ' : '목표 ') + p.target + '%');
  if (v === '2.0' || v === '2.1') a.push('1차 ' + p.part + '%', '상한 +' + p.capP + '%');
  a.push('큰수 ' + (v === '4.0' ? '×' : '+') + p.big + '%');
  if ((v === '1.0' || v === '2.0' || v === '2.1') && p.avgOff) a.push('괴리 ' + (p.avgOff > 0 ? '+' : '') + p.avgOff + '%');
  if (v !== '1.0' && v !== '2.0') a.push(p.lines ? 'LOC ' + p.lines + '×' + p.shares : 'LOC 없음');
  if (/^(1\.0|2\.0|2\.1|2\.2)$/.test(v) && p.money === 'simple') a.push('단리');
  if (v !== '4.0') { if (p.exhaust !== 'official') a.push({ sellall: '소진 시 전량 매도', recover: '소진 시 −10% 회복 매도', hold: '소진 시 보유' }[p.exhaust]); if (p.restart === 'rsi') a.push('RSI 시작'); }
  if ((v === '2.2' || v === '3.0') && p.tround === 'c1') a.push('T 올림');
  if (v === '3.0' && p.rebase) a.push('다시 정하기');
  if (v === '4.0' && p.noBig) a.push('큰수 미사용');
  if (p.method === 'avg') a.push('이동평균'); if (p.harvest) a.push('연말 절세');
  return '**V' + v + '** ' + a.join(' · ');
}
const hashOf = (tk, p, per) => { const h = ['v=' + p.ver, 't=' + tk, 'c=10000', 'sp=' + p.splits, 'tg=' + p.target];
  if (p.ver === '2.0' || p.ver === '2.1') h.push('pt=' + p.part, 'cp=' + p.capP); h.push('bg=' + p.big, 'fe=0.07');
  if (p.ver !== '1.0' && p.ver !== '2.0') h.push('ln=' + p.lines, 'sh=' + p.shares); if (p.ver === '4.0' && p.noBig) h.push('nb=1');
  if (/^(1\.0|2\.0|2\.1|2\.2)$/.test(p.ver) && p.money !== 'compound') h.push('m=' + p.money); if (p.ver !== '4.0' && p.exhaust !== 'official') h.push('x=' + p.exhaust); if (p.ver !== '4.0' && p.restart === 'rsi') h.push('r=rsi');
  if (per === 'pre') h.push('p=1'); if (p.ver === '3.0' && p.rebase) h.push('rb=1'); if ((p.ver === '1.0' || p.ver === '2.0' || p.ver === '2.1') && p.avgOff) h.push('ao=' + p.avgOff);
  if ((p.ver === '2.2' || p.ver === '3.0') && p.tround === 'c1') h.push('tr=c1'); if (p.method === 'avg') h.push('tm=avg'); if (p.harvest) h.push('hv=1');
  if (RJ === 'clamp' || RJ === 'skip') h.push('rj=' + (RJ === 'clamp' ? 'c' : 's')); if (FL === 'open' || FL === 'pre') h.push('ft=' + (FL === 'open' ? 'o' : 'p')); const E = RES[tk + '_' + per]; if (E && E.to) h.push('e=' + E.to);
  return 'https://d-capitalism.com/muhan-backtest/#' + h.join('&'); };
const link = (tk, x, per) => '[열기](' + hashOf(tk, x.p, per) + ')';
const out = [];
for (const per of ['act', 'pre']) {
  out.push('\n### ' + (per === 'act' ? '상장 이후 (실제 가격)' : '상장 전 포함 (지수로 재현한 가격 + 실제)') + '\n');
  out.push('| 종목 · 기간 | 기준 | 설정 | CAGR / MDD | 이웃 25곳 중앙 |' + (per === 'pre' ? ' 착시 점검 (고가 · 전체) |' : '') + ' 원금 10만·100만$ | |');
  out.push('|---|---|---|---|---|' + (per === 'pre' ? '---|' : '') + '---|---|');
  for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
    const R = RES[tk + '_' + per]; if (!R) continue;
    const head = tk + ' ' + R.from.slice(0, 4) + '~' + R.to.slice(2, 4) + '.' + R.to.slice(5, 7) + '.' + R.to.slice(8, 10);
    const rows = per === 'act' ? [['최고 CAGR', R.raw], ['안정 최고', R.rob], ['균형', R.bal]] : [['최고 CAGR', R.raw], ['믿을 만한 안정 최고', R.credRob], ['믿을 만한 균형', R.credBal]];
    const seen = new Map();
    for (const [nm, x] of rows) { if (!x) continue; const k = JSON.stringify(x.p); if (seen.has(k)) { seen.get(k).nm.push(nm); continue; } seen.set(k, { nm: [nm], x }); }
    let first = true;
    for (const { nm, x } of seen.values()) {
      out.push('| ' + (first ? head : '') + ' | ' + nm.join(' = ') + ' | ' + desc(x.p) + ' | ' + pc(x.r.cagr) + ' / ' + pc(x.r.mdd, 0) + ' | ' + pc(x.n.cagrMed) + ' / ' + pc(x.n.mddMed, 0) + ' |' + (per === 'pre' ? ' ' + sg(x.dh) + ' · ' + sg(x.dSyn) + '%p ' + (Math.abs(x.dh) <= 0.02 && Math.abs(x.dSyn) <= 0.05 ? '✓' : '✗') + ' |' : '') + ' ' + (x.alt ? pc(x.alt.cap100k) + ' · ' + pc(x.alt.cap1m) : '') + ' | ' + link(tk, x, per) + ' |');
      first = false;
    }
    out.push('| | 그냥 보유 | — | ' + pc(R.bh.cagr) + ' / ' + pc(R.bh.mdd, 0) + ' | | ' + (per === 'pre' ? '|' : '') + ' | |');
  }
}
/* MDD 한도별 */
for (const per of ['act', 'pre']) {
  out.push('\n#### MDD 한도별 최고 (' + (per === 'act' ? '상장 이후' : '상장 전 포함 · 믿을 만한 것만') + ' · 이웃 25곳 중앙값 기준)\n');
  out.push('| 종목 | MDD −30% 안 | −50% 안 | −70% 안 | 제한 없음 |'); out.push('|---|---|---|---|---|');
  for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
    const R = RES[tk + '_' + per]; if (!R) continue;
    const cell = L => { const f = R.front.find(q => Math.abs(q.L - L) < 1e-9); const x = f && (per === 'pre' ? f.cred : f.plain); return x ? pc(x.n.cagrMed) + ' / ' + pc(x.n.mddMed, 0) + ' (V' + x.p.ver + ' ' + x.p.splits + '분할 ' + x.p.target + '%)' : '—'; };
    out.push('| ' + tk + ' | ' + [-0.3, -0.5, -0.7, -1].map(cell).join(' | ') + ' |');
  }
}
/* 다른 기간 */
out.push('\n#### 다른 기간에 넣어 보면 (CAGR / MDD)\n');
out.push('| 종목 | 고른 곳 · 기준 | 상장 전 재현 구간만 | 상장 이후 | 상장 전 포함 전체 |'); out.push('|---|---|---|---|---|');
for (const tk of Object.keys(OOS)) {
  let first = true;
  for (const [nm, x] of Object.entries(OOS[tk])) {
    const o = x.o; out.push('| ' + (first ? tk : '') + ' | ' + nm + (x.p ? ' (V' + x.p.ver + ' ' + x.p.splits + '분할 ' + x.p.target + '%)' : '') + ' | ' + ['synth', 'act', 'pre'].map(s => pc(o[s].cagr) + ' / ' + pc(o[s].mdd, 0)).join(' | ') + ' |'); first = false;
  }
}
console.log(out.join('\n'));
