/* 제약 탐색(muhan_rob.js … cons) 출발점 — node scripts/muhan_opt/cons_starts.js <1단계 결과 폴더> <후보.csv> <regions.json> [이전 추천.csv …]
   종목(상장 이후)·버전마다:
   ① 1단계 격자를 이웃으로 매끈하게 한 지도(목표 ≤ 49 는 ±1%p, 55~100 은 ±5%p · 분할 ±2)에서
      매끈한 MDD ≥ −60% 이고 한 점 MDD ≥ −60% 인 곳 중 매끈한 CAGR 위쪽으로 서로 다른 곳 2개
   ② 후보 CSV(final.js 가 쓴 후보 전부)에서 살 수 없는 날 없고 한 점 MDD ≥ −60% 인 것 중 이웃 중앙 CAGR 최고 1개
   ③ (있으면) 이전 추천 CSV 의 '시뮬레이터 주소' 설정
   → regions.json 의 <종목>_act.startsK 로 씀(파일이 있으면 다른 값은 그대로 두고 startsK 만 바꿈).
   환경 변수 FIX='avgOff=0' 처럼 고정한 값은 모든 출발점에 그 값으로 (muhan_rob.js 도 같은 FIX 로 돌릴 것). */
'use strict';
const fs = require('fs'), path = require('path');
const [D1, CSVF, OUT, ...PREV] = process.argv.slice(2);
const FIX = (process.env.FIX || '').split(',').map(s => s.trim()).filter(Boolean).reduce((o, kv) => { const i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim(); o[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && isFinite(+v) ? +v : v; return o; }, {});
const f32 = b64 => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const med = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const files = []; (function w(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) w(q); else if (/^(TQQQ|SOXL|UPRO|TECL)_act_\d\.\d\.json$/.test(f)) files.push(q); } })(D1);
const cells = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
/* CSV (따옴표 · 줄바꿈 CRLF/LF 모두) */
const parse = t => { const rows = [], re = /("([^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g; let row = [], m; t = t.replace(/^﻿/, '');
  while ((m = re.exec(t)) && m[0] !== '') { let v = m[1]; if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"'); row.push(v); if (m[3] !== ',') { rows.push(row); row = []; } } return rows; };
const readCSV = f => { const r = parse(fs.readFileSync(f, 'utf8')); return { rows: r.slice(1), ix: Object.fromEntries(r[0].map((h, i) => [h, i])) }; };
/* 시뮬레이터 주소(#…) → 설정 (주소에 없는 값은 화면 기본값) */
const pOfLink = u => { const q = Object.fromEntries(u.split('#')[1].split('&').map(kv => kv.split('='))), v = q.v;
  return { ver: v, splits: +q.sp, target: +q.tg, big: +q.bg, lines: q.ln != null ? +q.ln : 0, shares: q.sh != null ? +q.sh : 1, part: q.pt != null ? +q.pt : 5, capP: q.cp != null ? +q.cp : 5, avgOff: q.ao != null ? +q.ao : 0,
    money: q.m || (v === '3.0' ? 'half' : v === '4.0' ? 'cash' : 'compound'), exhaust: q.x || 'official', restart: q.r === 'rsi' ? 'rsi' : 'next', tround: q.tr === 'c1' ? 'c1' : 'r2', rebase: q.rb === '1', noBig: q.nb === '1', method: q.tm === 'avg' ? 'avg' : 'fifo', harvest: q.hv === '1' }; };
const C = readCSV(CSVF), P = PREV.map(readCSV);
const REG = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const tk of ['TQQQ', 'SOXL', 'UPRO', 'TECL']) {
  const startsK = [];
  for (const ver of ['1.0', '2.0', '2.1', '2.2', '3.0', '4.0']) {
    const c = cells.find(x => x.tk === tk && x.ver === ver); if (!c) continue;
    const S = c.splits, T = c.targets, si = {}, ti = {}; S.forEach((v, i) => si[v] = i); T.forEach((v, i) => ti[v] = i);
    const pts = [];
    c.grid.forEach(g => { const cg = f32(g.cagr), md = f32(g.mdd), at = (a, b) => { const x = si[a], y = ti[b]; return x == null || y == null ? null : x * T.length + y; };
      for (const s of S) for (const t of T) { const j0 = at(s, t); if (md[j0] < -0.6) continue;
        const dts = t <= 49 ? [-1, 0, 1] : [-5, 0, 5], cs = [], ms = [];
        for (const ds of [-2, 0, 2]) for (const dt of dts) { const j = at(s + ds, Math.round((t + dt) * 2) / 2); if (j != null) { cs.push(cg[j]); ms.push(md[j]); } }
        if (cs.length < 6) continue; const sc = med(cs), sm = med(ms); if (sm < -0.6) continue;
        pts.push({ combo: c.combos[g.combo], s, t, sc, sm, c0: cg[j0], m0: md[j0] }); } });
    pts.sort((a, b) => b.sc - a.sc);
    const picked = [];
    for (const x of pts) { if (picked.length >= 2) break;
      if (picked.some(y => JSON.stringify(y.combo) === JSON.stringify(x.combo) && Math.abs(y.s - x.s) < 10 && Math.abs(y.t - x.t) < 15)) continue; picked.push(x); }
    for (const x of picked) startsK.push({ ver, from: '격자 지도', p: Object.assign({}, c.default.p, x.combo, { ver, splits: x.s, target: x.t }, FIX), grid: { sc: x.sc, sm: x.sm, c0: x.c0, m0: x.m0 } });
    const ix = C.ix, cands = C.rows.filter(r => r[ix['종목']] === tk && r[ix['기간']] === '상장 이후' && r[ix['버전']] === ver && r[ix['살 수 없는 날(일)']] === '0' && +r[ix['MDD']] >= -60);
    if (cands.length) { const b = cands.reduce((a, r) => +r[ix['이웃 중앙 CAGR']] > +a[ix['이웃 중앙 CAGR']] ? r : a);
      startsK.push({ ver, from: '후보', p: Object.assign(pOfLink(b[ix['시뮬레이터 주소']]), FIX), grid: { nb: +b[ix['이웃 중앙 CAGR']], nbm: +b[ix['이웃 중앙 MDD']], c0: +b[ix['CAGR(세후)']], m0: +b[ix['MDD']] } }); }
  }
  for (const { rows, ix } of P) for (const r of rows) if (r[ix['종목']] === tk && r[ix['시뮬레이터 주소']]) { const p = Object.assign(pOfLink(r[ix['시뮬레이터 주소']]), FIX); startsK.push({ ver: p.ver, from: '이전 추천', p }); }
  REG[tk + '_act'] = Object.assign(REG[tk + '_act'] || {}, { startsK });
  console.log(tk, startsK.length + '곳: ' + startsK.map(s => 'V' + s.ver + ' ' + s.from + ' ' + s.p.splits + '/' + s.p.target).join(' · '));
}
fs.writeFileSync(OUT, JSON.stringify(REG, null, 1));
