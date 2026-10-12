/* 버전별 '안정 최고'(이웃 25곳 중앙 CAGR 최고 · 살 수 없는 날 없음 · 상장 전 포함은 믿을 만한 것만) — node perver.js <후보.csv …> */
'use strict';
const fs = require('fs');
const parse = t => { const rows = [], re = /("([^"]|"")*"|[^,\n]*)(,|\n|$)/g; let row = [], m; t = t.replace(/^﻿/, '');
  while ((m = re.exec(t)) && m[0] !== '') { let v = m[1]; if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"'); row.push(v); if (m[3] !== ',') { rows.push(row); row = []; } } return rows; };
let H = null; const R = [];
for (const f of process.argv.slice(2)) { const rows = parse(fs.readFileSync(f, 'utf8')); H = rows[0]; for (const r of rows.slice(1)) if (r.length === H.length) R.push(Object.fromEntries(H.map((h, i) => [h, r[i]]))); }
const pc = x => (+x).toFixed(1) + '%';
for (const per of ['상장 이후', '상장 전 포함']) {
  console.log('\n| 버전 | TQQQ | SOXL | UPRO | TECL |\n|---|---|---|---|---|');
  for (const v of ['1.0', '2.0', '2.1', '2.2', '3.0', '4.0']) {
    const cells = ['TQQQ', 'SOXL', 'UPRO', 'TECL'].map(tk => {
      const c = R.filter(r => r['종목'] === tk && r['기간'] === per && r['버전'] === v && r['살 수 없는 날(일)'] === '0' && (per === '상장 이후' || (Math.abs(+r['추정 고가 영향 dh(%p)']) <= 2 && Math.abs(+r['재현 전체 차이 dSyn(%p)']) <= 5)));
      if (!c.length) return '—';
      const b = c.reduce((a, x) => +x['이웃 중앙 CAGR'] > +a['이웃 중앙 CAGR'] ? x : a);
      return pc(b['이웃 중앙 CAGR']) + ' / ' + pc(b['이웃 중앙 MDD']).replace('.0%', '%') + ' (' + b['분할'] + '분할 ' + b['목표%'] + '%)';
    });
    console.log('| V' + v + ' | ' + cells.join(' | ') + ' |');
  }
}
