/* 1단계 격자 → 매끈한 지도(이웃 9점 중앙값: 분할 −2·0·+2 × 목표 −1·0·+1%) → 2단계 출발점 opt/regions.json
   node regions.js <1단계 결과 폴더> <출력 regions.json>
   종목·기간마다 버전별로: CAGR 출발점 1개 + 균형(CAGR ÷ |MDD|, 매끈한 CAGR ≥ 그 종목·기간 최고의 절반) 출발점 1개 */
'use strict';
const fs = require('fs'), path = require('path');
const [DIR, OUT] = process.argv.slice(2);
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/^(TQQQ|SOXL|UPRO|TECL)_(act|pre)_\d\.\d\.json$/.test(f)) files.push(p); } })(DIR);
const f32 = b64 => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
const by = {};
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(f, 'utf8')), S = c.splits, T = c.targets, si = {}, ti = {};
  S.forEach((s, i) => si[s] = i); T.forEach((t, i) => ti[t] = i);
  const k = c.tk + '_' + c.per, cell = (by[k] = by[k] || { maps: [] });
  for (const g of c.grid) {
    const cg = f32(g.cagr), md = f32(g.mdd), at = (s, t) => { const a = si[s], b = ti[t]; return a == null || b == null ? null : a * T.length + b; };
    for (const s of S) for (const t of T) {
      if (t > 49) continue;   /* 50% 넘는 목표는 격자가 5% 간격이라 이웃을 만들 수 없음 — 2단계 좌표 탐색이 다룸 */
      const cs = [], ms = [];
      for (const ds of [-2, 0, 2]) for (const dt of [-1, 0, 1]) { const j = at(s + ds, Math.round((t + dt) * 2) / 2); if (j != null) { cs.push(cg[j]); ms.push(md[j]); } }
      if (cs.length < 6) continue;
      cell.maps.push({ ver: c.ver, combo: c.combos[g.combo], splits: s, target: t, cagrMed: med(cs), mddMed: med(ms) });
    }
  }
  /* 1단계에서 이웃 25점으로 고른 '안정' 설정도 출발점으로 (버전·목표마다) */
  cell.rob = cell.rob || [];
  for (const obj of ['cagr', 'calmar']) if (c.final && c.final[obj]) cell.rob.push({ ver: c.ver, obj, p: Object.assign({ ver: c.ver }, c.final[obj].robust.p), from: '1단계 안정' });
}
const regions = {};
for (const k of Object.keys(by).sort()) {
  const M = by[k].maps; let maxS = -Infinity; for (const m of M) if (m.cagrMed > maxS) maxS = m.cagrMed;
  const floor = maxS * 0.5, cal = m => m.cagrMed >= floor && m.mddMed < 0 ? m.cagrMed / -m.mddMed : -Infinity;
  const starts = [];
  for (const ver of ['1.0', '2.0', '2.1', '2.2', '3.0', '4.0']) {
    const mv = M.filter(m => m.ver === ver); if (!mv.length) continue;
    let b1 = mv[0], b2 = null; for (const m of mv) { if (m.cagrMed > b1.cagrMed) b1 = m; if (isFinite(cal(m)) && (!b2 || cal(m) > cal(b2))) b2 = m; }
    starts.push({ ver, obj: 'cagr', p: Object.assign({ splits: b1.splits, target: b1.target }, b1.combo), grid: { cagrMed: b1.cagrMed, mddMed: b1.mddMed } });
    if (b2) starts.push({ ver, obj: 'calmar', p: Object.assign({ splits: b2.splits, target: b2.target }, b2.combo), grid: { cagrMed: b2.cagrMed, mddMed: b2.mddMed } });
  }
  const key = p => JSON.stringify(Object.keys(p).sort().map(n => [n, p[n]]));
  for (const r of by[k].rob || []) { const same = starts.find(s => s.ver === r.ver && s.obj === r.obj && s.p.splits === r.p.splits && s.p.target === r.p.target);
    if (!same && !starts.some(s => s.from === r.from && key(s.p) === key(r.p))) starts.push(r); }
  regions[k] = { floor, maxSmooth: maxS, starts };
  console.log(k, '매끈한 최고 ' + (maxS * 100).toFixed(2) + '% · 균형 기준 ' + (floor * 100).toFixed(2) + '% · 출발점 ' + starts.length + ' · ' + starts.map(s => 'V' + s.ver + ' ' + s.obj + ' ' + s.p.splits + '/' + s.p.target + ' ' + (s.grid ? (s.grid.cagrMed * 100).toFixed(1) + '%' : '(1단계 안정)')).join(' | '));
}
fs.writeFileSync(OUT, JSON.stringify(regions, null, 1));
