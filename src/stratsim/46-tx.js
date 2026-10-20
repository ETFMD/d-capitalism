/* ── [STRATSIM] 46 실제 거래내역 ─────────────────────────────────────────
   내 입금·출금 기록(날짜, 금액 [, 계좌 평가액])을 올리거나 붙여 넣거나 구글 시트(CSV 게시) 주소로 연결하면
   슬라이더 공식 대신 그 기록으로 모든 전략을 계산. 첫 줄 = 시작 금액·진입일 · 주말·휴장일 입금은 다음 거래일로 */

// ── 읽기 ──
// 날짜 칸 → 'YYYY-MM-DD' (2024-03-05 · 2024.3.5 · 2024/3/5 · 3/5/2024(미국식) · 그 밖에 Date 가 읽는 것) · 못 읽으면 null
function ssTxDate(s) {
  const t = s == null ? '' : String(s).trim();
  if (t === '') return null;
  const two = (x) => (x.length < 2 ? '0' + x : x);
  const ymd = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (ymd) return [ymd[1], two(ymd[2]), two(ymd[3])].join('-');
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (mdy) return [mdy[3], two(mdy[1]), two(mdy[2])].join('-');
  const d = new Date(t), ms = d.getTime();
  if (ms !== ms) return null;   // 읽지 못함(NaN)
  return [d.getUTCFullYear(), two(String(d.getUTCMonth() + 1)), two(String(d.getUTCDate()))].join('-');
}
// 금액 칸 → 숫자 ('$1,234.5' · '1,000원' · '(500)' = −500 · '-500') · 못 읽으면 null
function ssTxAmount(s) {
  const t = s == null ? '' : String(s).trim();
  if (t === '') return null;
  const v = parseFloat(t.replace(/[()$,\s원₩]/g, ''));
  if (!Number.isFinite(v)) return null;
  const inParens = /^\(.*\)$/.test(t);   // 회계식 음수
  return inParens ? -Math.abs(v) : v;
}
const SS_TX_AMT_RE = /transaction|amount|value|invested|contribution|deposit|cash|금액|입금|투자|적립/i;
const SS_TX_DATE_RE = /date|날짜|일자/i;
const SS_TX_ACT_RE = /total|balance|portfolio|net.?worth|평가|잔고|잔액|총액/i;
// 한 줄 → 칸들 (큰따옴표로 감싼 칸 안의 구분자·"" 지원) · 칸마다 앞뒤 공백 지움
function ssTxSplit(line, sep) {
  const cells = [];
  let buf = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch !== '"') buf += ch;
      else if (line.charAt(i + 1) === '"') { buf += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { cells.push(buf.trim()); buf = ''; }
    else buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}
function ssTxRaw(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) return { headers: null, rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const first = ssTxSplit(lines[0], sep);
  const head = first.some((c) => SS_TX_DATE_RE.test(c)) || first.every((c) => ssTxDate(c) == null && ssTxAmount(c) == null);
  return { headers: head ? first : null, rows: (head ? lines.slice(1) : lines).map((l) => ssTxSplit(l, sep)) };
}
function ssTxBestNum(rows, dc, n) {
  let best = -1, bs = -1;
  for (let c = 0; c < n; c++) {
    if (c === dc) continue;
    let s = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) if (ssTxAmount((rows[i] || [])[c]) != null) s++;
    if (s > bs) { bs = s; best = c; }
  }
  return best === -1 ? (dc === 0 ? 1 : 0) : best;
}
function ssTxDetect(headers, rows) {
  const n = headers ? headers.length : (rows[0] || []).length;
  let dc = 0, ac = 1;
  if (headers) {
    const d = headers.findIndex((c) => SS_TX_DATE_RE.test(c));
    dc = d === -1 ? 0 : d;
    const cand = headers.map((c, i) => ({ i, c })).filter((x) => x.i !== dc && SS_TX_AMT_RE.test(x.c) && !SS_TX_ACT_RE.test(x.c));
    const cand2 = cand.length ? cand : headers.map((c, i) => ({ i, c })).filter((x) => x.i !== dc && SS_TX_AMT_RE.test(x.c));
    ac = cand2.length ? cand2[0].i : ssTxBestNum(rows, dc, n);
  } else if (n > 2) ac = ssTxBestNum(rows, dc, n);
  if (ac === dc) ac = dc === 0 ? Math.min(1, n - 1) : 0;
  let xc = null;
  if (headers) { const i = headers.findIndex((c, k) => k !== dc && k !== ac && SS_TX_ACT_RE.test(c)); if (i !== -1) xc = i; }
  return { dc, ac, xc };
}
function ssTxRows(rows, dc, ac, xc) {
  const out = [];
  let skipped = 0;
  for (const cells of rows) {
    const date = ssTxDate(cells[dc]), amount = ssTxAmount(cells[ac]);
    if (date == null || amount == null) { skipped++; continue; }
    const r = { date, amount };
    if (xc != null) { const a = ssTxAmount(cells[xc]); if (a != null) r.actual = a; }
    out.push(r);
  }
  // 같은 날은 한 줄로: 금액은 더하고, 평가액은 그날 마지막으로 적힌 값
  const byDay = new Map();
  for (const r of out) {
    const before = byDay.get(r.date);
    const one = { date: r.date, amount: (before ? before.amount : 0) + r.amount };
    const act = r.actual != null ? r.actual : before ? before.actual : undefined;
    if (act != null) one.actual = act;
    byDay.set(r.date, one);
  }
  const merged = [...byDay.values()].sort((x, y) => (x.date > y.date) - (x.date < y.date));
  return { rows: merged, skipped, total: merged.reduce((s, r) => s + r.amount, 0) };
}
function ssTxParse(text, dc, ac, xc) {
  const { headers, rows } = ssTxRaw(text);
  if (!rows.length) return { rows: [], skipped: 0, total: 0, headers: null, raw: [], dc: 0, ac: 1, xc: null };
  const n = headers ? headers.length : (rows[0] || []).length;
  let d = dc, a = ac, x = xc;
  if (d == null || a == null || d < 0 || a < 0 || d >= n || a >= n || d === a) ({ dc: d, ac: a, xc: x } = ssTxDetect(headers, rows));
  if (x != null && (x < 0 || x >= n || x === d || x === a)) x = ssTxDetect(headers, rows).xc;
  return Object.assign(ssTxRows(rows, d, a, x), { headers, raw: rows, dc: d, ac: a, xc: x != null ? x : null });
}
// 주말·휴장일 → 다음 거래일 (자료 끝 넘으면 null)
function ssTxSnap(d) {
  if (DS.idx.has(d)) return d;
  const days = DS.days;
  if (d > days[days.length - 1].date) return null;
  let lo = 0, hi = days.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m].date >= d) { ans = days[m].date; hi = m - 1; } else lo = m + 1; }
  return ans;
}
function ssTxSchedule(list) {
  const byDate = new Map(), byMonth = new Map(), out = [], pdm = new Map();
  for (const r of list) {
    byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
    const mo = r.date.slice(0, 7);
    byMonth.set(mo, (byMonth.get(mo) || 0) + r.amount);
    out.push({ date: r.date, amount: r.amount });
    pdm.set(mo, r.date);
  }
  return { byDate, byMonth, list: out, priceDateByMonth: pdm };
}
function ssTxState(rows, source, url, dc, ac, xc, showActual) {
  if (!rows || !rows.length) return null;
  const [first, ...rest] = rows;
  const flows = [];
  for (const r of rest) { const d = ssTxSnap(r.date); if (d != null) flows.push({ date: d, amount: r.amount }); }
  const act = new Map();
  for (const r of rows) {
    if (r.actual == null || !isFinite(r.actual)) continue;
    let d = ssTxSnap(r.date);
    if (d == null) d = DS.days[DS.days.length - 1].date;   // 자료 끝 뒤 평가액 = 가장 최근 값
    act.set(d, r.actual);
  }
  return {
    initial: first.amount, entryDate: ssTxSnap(first.date) || first.date, rows,
    schedule: ssTxSchedule(flows),
    actualPoints: Array.from(act, ([date, value]) => ({ date, value })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    total: rows.reduce((s, r) => s + r.amount, 0), source: source || 'upload', sheetUrl: url || null,
    dc: dc != null ? dc : null, ac: ac != null ? ac : null, xc: xc != null ? xc : null, showActual: showActual !== false,
  };
}
const ssNextMonth = (ym) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); };
// 진입일에 맞춘 거래내역 보기: 첫 거래 전 진입 → 0원 시작 + 모든 거래가 날짜별 흐름 /
// 중간 진입 → 그 전까지를 한 덩어리 시작 금액(평가액이 있으면 그 날 평가액, 없으면 현금 복리 잔액) + 이후 흐름
function ssTxEffective(st, E0, annualRate) {
  if (!st) return null;
  const E = E0 || st.entryDate;
  const all = [{ date: st.entryDate, amount: st.initial }].concat(st.schedule.list);
  if (E < st.entryDate) return { initial: 0, schedule: ssTxSchedule(all), actualPoints: st.actualPoints || [], entryDate: E };
  if (E === st.entryDate) return { initial: st.initial, schedule: st.schedule, actualPoints: st.actualPoints || [], entryDate: E };
  const pts = st.actualPoints || [];
  let initial = null;   // 진입일 이하 마지막 계좌 평가액
  for (const p of pts) { if (p.date > E) break; initial = p.value; }
  if (initial == null) {   // 평가액이 없으면: 진입일까지 넣은 돈을 매달 (연 이율 ÷ 12) 복리로 굴린 잔액
    const growth = 1 + (annualRate || 0) / 12;
    let bal = 0, month = st.entryDate.slice(0, 7);
    const rollTo = (ym) => { while (month < ym) { bal *= growth; month = ssNextMonth(month); } };
    for (const f of all) { if (f.date > E) break; rollTo(f.date.slice(0, 7)); bal += f.amount; }
    rollTo(E.slice(0, 7));
    initial = bal;
  }
  const later = all.filter((f) => f.date > E), lp = pts.filter((p) => p.date >= E);
  if (pts.length && pts[0].date <= E && (!lp.length || lp[0].date !== E)) lp.unshift({ date: E, value: initial });
  return { initial, schedule: ssTxSchedule(later), actualPoints: lp, entryDate: E };
}

// ── 저장 ──
function ssTxPersist() {
  try {
    const s = S.txStash;
    if (s) localStorage.setItem(SS_LS.tx, JSON.stringify({ rows: s.rows, source: s.source, sheetUrl: s.sheetUrl, dc: s.dc, ac: s.ac, xc: s.xc, showActual: s.showActual !== false, active: !!S.tx }));
    else localStorage.removeItem(SS_LS.tx);
  } catch (e) {}
}
function ssTxLoad() {
  try {
    const o = JSON.parse(localStorage.getItem(SS_LS.tx) || 'null');
    if (!o || !Array.isArray(o.rows) || !o.rows.length) return;
    const rows = o.rows.filter((r) => r && typeof r.date === 'string' && Number.isFinite(+r.amount)).map((r) => { const x = { date: r.date, amount: +r.amount }; if (r.actual != null && Number.isFinite(+r.actual)) x.actual = +r.actual; return x; });
    const st = ssTxState(rows, o.source, o.sheetUrl, o.dc, o.ac, o.xc, o.showActual);
    S.txStash = st;
    S.tx = o.active !== false ? st : null;
  } catch (e) {}
}
function ssTxFromShared(rows) {
  if (!Array.isArray(rows)) return;
  const clean = rows.slice(0, 5000).filter((r) => r && typeof r.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.date) && Number.isFinite(+r.amount)).map((r) => { const x = { date: r.date, amount: +r.amount }; if (r.actual != null && Number.isFinite(+r.actual)) x.actual = +r.actual; return x; });
  if (!clean.length) return;
  const st = ssTxState(clean, 'upload');
  S.tx = st; S.txStash = st;
}

// 진입을 첫 거래일로 (정확한 날짜 + 손잡이)
function ssTxApplyEntry() { if (!S.tx) return; S.ed = S.tx.entryDate; S.e = ssQIdxForDate(S.tx.entryDate); }

// 시트 연결이면 열 때마다 조용히 다시 받아 옴 (실패하면 저장된 것 그대로)
async function ssTxRefreshSheet() {
  const cur = S.txStash;
  if (!cur || cur.source !== 'sheet' || !cur.sheetUrl) return;
  const was = !!S.tx;
  try {
    const res = await fetch(cur.sheetUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = ssTxParse(await res.text(), cur.dc, cur.ac, cur.xc);
    if (!p.rows.length) throw new Error('empty');
    const fresh = ssTxState(p.rows, 'sheet', cur.sheetUrl, p.dc, p.ac, p.xc, cur.showActual);
    S.txStash = fresh;
    if (was) S.tx = fresh;
    ssTxPersist();
    ssChanged();
  } catch (e) {}
}

// ── 창 (올리기 · 실시간 시트) ──
const TXM = { p: null, src: 'upload', url: null, err: null, loading: false, edit: false, text: '', sheet: '', tab: 'upload', downOnBg: false };
function ssTxOpen(o) {
  o = o || {};
  ssTxClose();
  Object.assign(TXM, { p: null, src: 'upload', url: null, err: null, loading: false, edit: !!o.edit, text: o.text || '', sheet: o.url || '', tab: o.url ? 'sheet' : 'upload' });
  if (TXM.text) TXM.p = ssTxParse(TXM.text);
  const ov = document.createElement('div');
  ov.className = 'ss-ov';
  ov.id = 'ss-txm';
  document.body.appendChild(ov);
  ssTxDraw();
  if (o.url) ssTxFetch(o.url, o.cols || null);
  else { const ta = ov.querySelector('#ss-txta'); if (ta) ta.focus(); }
}
function ssTxClose() { const m = document.getElementById('ss-txm'); if (m) m.remove(); TXM.p = null; }
function ssTxPreviewHtml(p) {
  if (!p) return '';
  if (!p.rows.length) return '<div class="ss-err">읽을 수 있는 줄이 없습니다 — 날짜·금액 열을 확인해 주세요.</div>';
  const act = p.xc != null && p.rows.some((r) => r.actual != null);
  return '<div class="ss-txstat"><b>' + p.rows.length + '</b>건' + (p.skipped ? ', 건너뜀 <b>' + p.skipped + '</b>건' : '') + ' · 합계 <b>' + ssMoney(Math.round(p.total)) + '</b> · ' + ssDate(p.rows[0].date) + ' → ' + ssDate(p.rows[p.rows.length - 1].date) + '</div>'
    + '<div class="ss-txtw"><table class="ss-txt"><thead><tr><th>날짜</th><th>금액</th>' + (act ? '<th>계좌 평가액</th>' : '') + '</tr></thead><tbody>'
    + p.rows.slice(0, 200).map((r) => '<tr><td>' + ssDate(r.date) + '</td><td>' + ssMoney(Math.round(r.amount)) + '</td>' + (act ? '<td>' + (r.actual != null ? ssMoney(Math.round(r.actual)) : '—') + '</td>' : '') + '</tr>').join('') + '</tbody></table></div>';
}
function ssTxColsHtml(p) {
  const n = p && p.raw && p.raw.length ? (p.headers ? p.headers.length : p.raw[0].length) : 0;
  if (n < 2) return '';
  const lab = (i) => ssEsc(p.headers && p.headers[i] ? p.headers[i] : (i + 1) + '번째 열');
  const opts = (sel) => Array.from({ length: n }, (_, i) => '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + lab(i) + '</option>').join('');
  return '<div class="ss-txcols"><label>날짜 열 <select id="ss-txdc" class="ss-isel">' + opts(p.dc) + '</select></label><label>금액 열 <select id="ss-txac" class="ss-isel">' + opts(p.ac) + '</select></label>'
    + '<label title="선택: 그날 계좌의 실제 총 평가액 — \'내 계좌\' 선으로 그려 전략들과 견줌">계좌 평가액 열 <select id="ss-txxc" class="ss-isel"><option value=""' + (p.xc == null ? ' selected' : '') + '>— 없음 —</option>' + opts(p.xc) + '</select></label></div>';
}
function ssTxRefreshParsed() {
  const m = document.getElementById('ss-txm');
  if (!m) return;
  const a = m.querySelector('#ss-txprev'), b = m.querySelector('#ss-txcolslot'), c = m.querySelector('[data-tx-ok]');
  if (a) a.innerHTML = ssTxPreviewHtml(TXM.p);
  if (b) b.innerHTML = ssTxColsHtml(TXM.p);
  if (c) c.disabled = !(TXM.p && TXM.p.rows.length);
}
function ssTxDraw() {
  const m = document.getElementById('ss-txm');
  if (!m) return;
  const up = '<div class="ss-help">한 줄에 거래 하나: 날짜, 금액 (출금은 −).<br>가장 이른 거래가 진입일과 시작 금액이 됩니다. 세 번째 열에 그날 계좌 평가액을 넣으면 \'내 계좌\' 선도 그려집니다.</div>'
    + '<input type="file" id="ss-txfile" accept=".csv,.tsv,.txt" class="ss-txfile">'
    + '<textarea id="ss-txta" class="ss-ta" placeholder="날짜&#9;금액&#10;2019-01-03&#9;10000&#10;2019-02-01&#9;500&#10;2019-03-01&#9;500">' + ssEsc(TXM.text) + '</textarea>';
  const sh = '<div class="ss-help">구글 시트의 \'웹에 게시 → CSV\' 주소를 넣으세요.<br>이 페이지를 열 때마다 자동으로 다시 받아 옵니다.</div>'
    + '<div class="ss-txsheet"><input type="url" id="ss-txurl" placeholder="공개 CSV 주소 (파일 → 공유 → 웹에 게시 → CSV)" value="' + ssEsc(TXM.sheet) + '"><button type="button" class="ss-btn" id="ss-txfetch"' + (TXM.loading ? ' disabled' : '') + '>' + (TXM.loading ? '불러오는 중…' : '불러오기') + '</button></div>'
    + (TXM.err ? '<div class="ss-err">' + ssEsc(TXM.err) + '</div>' : '');
  m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">' + (TXM.edit ? '거래내역 고치기' : '실제 거래내역') + '</div>'
    + '<div class="ss-tabs"><button type="button" class="' + (TXM.tab === 'upload' ? 'on' : '') + '" data-tx-tab="upload">올리기·붙여넣기</button><button type="button" class="' + (TXM.tab === 'sheet' ? 'on' : '') + '" data-tx-tab="sheet">구글 시트 연결</button></div>'
    + (TXM.tab === 'upload' ? up : sh)
    + '<div id="ss-txcolslot">' + ssTxColsHtml(TXM.p) + '</div><div id="ss-txprev">' + ssTxPreviewHtml(TXM.p) + '</div>'
    + '<div class="ss-mact"><button type="button" class="ss-btn" data-tx-cancel>취소</button><button type="button" class="ss-btn pri" data-tx-ok' + (TXM.p && TXM.p.rows.length ? '' : ' disabled') + '>이 내역 쓰기</button></div></div>';
}
async function ssTxFetch(url, cols) {
  TXM.loading = true; TXM.err = null; ssTxDraw();
  try {
    if (!/^https:\/\//i.test(url)) throw new Error('https:// 주소만 쓸 수 있습니다');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = ssTxParse(await res.text(), cols ? cols.dc : null, cols ? cols.ac : null, cols ? cols.xc : null);
    if (!p.raw.length) throw new Error('자료가 없습니다');
    TXM.p = p; TXM.src = 'sheet'; TXM.url = url;
  } catch (e) {
    TXM.p = null;
    TXM.err = '불러오지 못했습니다 — ' + (e && e.message ? e.message : '공개 CSV 주소인지 확인해 주세요');
  }
  TXM.loading = false;
  if (document.getElementById('ss-txm')) ssTxDraw();
}
document.addEventListener('mousedown', (e) => { TXM.downOnBg = !!(e.target && e.target.id === 'ss-txm'); });
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (t.id === 'ss-txm') { if (TXM.downOnBg) ssTxClose(); return; }
  if (!t.closest('#ss-txm')) return;
  const tab = t.closest('[data-tx-tab]');
  if (tab) { TXM.tab = tab.getAttribute('data-tx-tab'); ssTxDraw(); return; }
  if (t.closest('#ss-txfetch')) { const u = (document.getElementById('ss-txurl') || {}).value; if (u && u.trim()) ssTxFetch(u.trim()); return; }
  if (t.closest('[data-tx-cancel]')) { ssTxClose(); return; }
  if (t.closest('[data-tx-ok]')) {
    const p = TXM.p;
    if (!p || !p.rows.length) return;
    const st = ssTxState(p.rows, TXM.src, TXM.src === 'sheet' ? TXM.url : null, p.dc, p.ac, p.xc);
    S.tx = st; S.txStash = st;
    ssTxPersist();
    ssTxClose();
    ssTxApplyEntry();
    ssChanged();
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'ss-txta') { TXM.text = e.target.value; TXM.p = e.target.value.trim() ? ssTxParse(e.target.value) : null; TXM.src = 'upload'; TXM.url = null; ssTxRefreshParsed(); }
  else if (e.target.id === 'ss-txurl') TXM.sheet = e.target.value;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ss-txfile') {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { TXM.text = String(rd.result || ''); TXM.p = TXM.text.trim() ? ssTxParse(TXM.text) : null; TXM.src = 'upload'; TXM.url = null; ssTxDraw(); };
    rd.readAsText(f);
    return;
  }
  if (e.target.id === 'ss-txdc' || e.target.id === 'ss-txac' || e.target.id === 'ss-txxc') {
    if (!TXM.p || !TXM.p.raw) return;
    const dc = +document.getElementById('ss-txdc').value, ac = +document.getElementById('ss-txac').value;
    const xr = document.getElementById('ss-txxc').value, xc = xr === '' ? null : +xr;
    TXM.p = Object.assign({}, TXM.p, ssTxRows(TXM.p.raw, dc, ac, xc), { dc, ac, xc });
    ssTxRefreshParsed();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ss-txm')) ssTxClose(); });
const ssTxToTsv = (rows) => (rows.some((r) => r.actual != null)
  ? '날짜\t금액\t평가액\n' + rows.map((r) => r.date + '\t' + r.amount + '\t' + (r.actual != null ? r.actual : '')).join('\n')
  : '날짜\t금액\n' + rows.map((r) => r.date + '\t' + r.amount).join('\n'));
