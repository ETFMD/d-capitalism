/* ── [STRATSIM] 44 저장 전략 · 사용자 전략(코드) ───────────────────────────
   왼쪽 목록의 알약(보이기·끌어 순서 바꾸기·편집·삭제) · 공유받은 전략 배너 ·
   사용자 전략 만들기 창(설명 → 프롬프트 복사 → 답 붙여넣기) · 코드 편집기(색·줄 번호) · 사용자 전략 패널 */

// ── 알약 목록 ──
function ssPillHtml(c) {
  const m = R.metrics['cfg:' + c.id] || {};
  let mt = '';
  if (m.error) mt = '<div class="ss-pm"><span class="ss-warn">실행 오류 — 편집해서 고쳐 주세요</span></div>';
  else if (m.pending && !Number.isFinite(m.cagr)) mt = '<div class="ss-pm"><span class="ss-mut">계산 중…</span></div>';
  else if (Number.isFinite(m.cagr)) {
    const rg = ssDDRange(m.ddPeak, m.ddTrough);
    mt = '<div class="ss-pm"><span><i>연평균</i> <b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b></span>'
      + (Number.isFinite(m.maxDD) ? '<span><i>낙폭</i> <b class="ss-dn">' + ssDD(m.maxDD) + '</b>' + (rg ? ' <em>' + rg + '</em>' : '') + '</span>' : '') + '</div>';
  }
  return '<div class="ss-pill' + (c.hidden ? ' off' : '') + (S.editing === c.id ? ' editing' : '') + '" data-id="' + c.id + '" draggable="true" title="눌러서 차트에 보이기/숨기기">'
    + '<div class="ss-pt"><span class="ss-ph"><button type="button" class="ss-peye" aria-label="보이기/숨기기">' + ssEye(!c.hidden) + '</button>'
    + '<span class="ss-pdrag" title="끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기"><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span></span>'
    + '<span class="ss-cdot" style="background:' + c.color + '"></span><span class="ss-pn">' + ssEsc(c.name) + '</span>'
    + (c.type === 'custom' ? '<span class="ss-pbadge" title="사용자 전략 (격리 실행)">ƒ</span>' : '')
    + '<span class="ss-pact"><button type="button" class="ss-pedit2" title="설정·기록 열기" aria-label="편집"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'
    + '<button type="button" class="ss-pdel" title="전략 지우기" aria-label="지우기"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></span></div>' + mt + '</div>';
}
function ssRenderPills() {
  const host = document.getElementById('ss-pills');
  if (!host) return;
  if (!S.saved.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  const n = S.saved.filter((c) => c._tr).length;
  host.innerHTML = (n ? '<div class="ss-shared"><span>링크로 받은 전략 ' + n + '개 — 저장하지 않으면 이 방문이 끝나면 사라집니다.</span><button type="button" class="ss-btn pri" id="ss-saveshared">' + (n > 1 ? '모두 저장' : '저장') + '</button></div>' : '')
    + '<div class="ss-plist">' + S.saved.map(ssPillHtml).join('') + '</div>';
}
function ssToggleCfg(id) { const c = ssFindCfg(id); if (!c) return; c.hidden = !c.hidden; ssPersistSaved(); ssChanged(); }
function ssDeleteCfg(id) {
  S.saved = S.saved.filter((c) => c.id !== id);
  delete SB.res[id]; delete SB.yday[id];
  if (S.editing === id) { if (ssPanel.open) ssClosePanel(); S.editing = null; }
  ssPersistSaved(); ssChanged();
}
function ssWirePills() {
  const host = document.getElementById('ss-pills');
  let fromHandle = false;
  host.addEventListener('mousedown', (e) => { fromHandle = !!e.target.closest('.ss-pdrag'); });
  host.addEventListener('dragstart', (e) => {
    const p = e.target.closest('.ss-pill');
    if (!p || !fromHandle) { e.preventDefault(); return; }
    p.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', p.dataset.id); } catch (er) {} }
  });
  host.addEventListener('dragover', (e) => {
    const list = host.querySelector('.ss-plist'), dr = list && list.querySelector('.ss-pill.dragging');
    if (!dr) return;
    e.preventDefault();
    let after = null, best = -Infinity;
    for (const el of list.querySelectorAll('.ss-pill:not(.dragging)')) { const b = el.getBoundingClientRect(), off = e.clientY - b.top - b.height / 2; if (off < 0 && off > best) { best = off; after = el; } }
    if (after == null) { if (list.lastElementChild !== dr) list.appendChild(dr); } else if (after !== dr) list.insertBefore(dr, after);
  });
  host.addEventListener('drop', (e) => { if (host.querySelector('.ss-pill.dragging')) e.preventDefault(); });
  host.addEventListener('dragend', () => {
    fromHandle = false;
    const list = host.querySelector('.ss-plist');
    if (!list) return;
    const dr = list.querySelector('.ss-pill.dragging');
    if (dr) dr.classList.remove('dragging');
    const order = Array.from(list.querySelectorAll('.ss-pill')).map((el) => el.dataset.id);
    const byId = new Map(S.saved.map((c) => [c.id, c])), next = [];
    for (const id of order) { const c = byId.get(id); if (c) { next.push(c); byId.delete(id); } }
    for (const c of S.saved) if (byId.has(c.id)) next.push(c);
    if (next.some((c, i) => c !== S.saved[i])) { S.saved = next; ssPersistSaved(); ssChanged(); }
  });
  host.addEventListener('click', (e) => {
    if (e.target.closest('#ss-saveshared')) { for (const c of S.saved) delete c._tr; ssPersistSaved(); ssRenderPills(); return; }
    const p = e.target.closest('.ss-pill');
    if (!p) return;
    const id = p.dataset.id;
    if (e.target.closest('.ss-pdrag')) return;
    if (e.target.closest('.ss-pedit2')) { ssOpenCfgPanel(id); return; }
    if (e.target.closest('.ss-pdel')) {
      const c = ssFindCfg(id);
      if (c) ssDialog('전략 지우기', '‘<b>' + ssEsc(c.name) + '</b>’ 을(를) 지울까요? 되돌릴 수 없습니다.', [{ t: '취소' }, { t: '지우기', danger: true, fn: () => ssDeleteCfg(id) }]);
      return;
    }
    ssToggleCfg(id);
  });
}

// ── 라이브러리 '써 보기' (30-library 가 부름) ──
// preset: { type:'9sig'|'sma', params } → 기본 엔진 저장 전략 · code → 사용자 전략(격리 실행)
function ssAddFromLibrary(entry) {
  if (!entry) return null;
  let cfg;
  if (entry.preset) cfg = { id: ssNewId(), type: entry.preset.type, name: ssUniqueName(entry.name), params: ssCleanParams(entry.preset.type, entry.preset.params), color: ssNextColor(), hidden: false };
  else if (entry.code) cfg = { id: ssNewId(), type: 'custom', name: ssUniqueName(entry.name), code: entry.code, desc: entry.rules || '', params: {}, color: ssNextColor(), hidden: false, lib: entry.n };
  else return null;
  S.saved.push(cfg);
  ssPersistSaved();
  S.editing = cfg.id;            // 패널은 열지 않고 선만 강조 (빈 곳을 누르면 풀림)
  ssChanged();
  setTimeout(() => ssFlashSaved(cfg.id), 30);
  return cfg.id;
}

// ── 사용자 전략: 만들기 창 ──
const SB2 = { id: null, phase: 'describe', isNew: false, beautify: null };
function ssCreateCustom() {
  const cfg = { id: ssNewId(), type: 'custom', name: ssUniqueName('사용자 전략'), code: '', desc: '', params: {}, color: ssNextColor(), hidden: false };
  S.saved.push(cfg);
  S.editing = cfg.id;
  ssPersistSaved();
  ssChanged();
  ssOpenBuilder(cfg.id, true);
}
function ssOpenBuilder(id, isNew) {
  const c = ssFindCfg(id);
  if (!c) return;
  SB2.id = id; SB2.isNew = !!isNew;
  SB2.phase = isNew || !c.code ? 'describe' : 'generate';
  ssDrawBuilder();
}
function ssCloseBuilder(cancelled) {
  const m = document.getElementById('ss-builder');
  if (m) m.remove();
  const id = SB2.id, isNew = SB2.isNew;
  SB2.id = null; SB2.isNew = false;
  if (cancelled && isNew) { const c = ssFindCfg(id); if (c && !c.code) ssDeleteCfg(id); }
}
function ssDrawBuilder() {
  const c = ssFindCfg(SB2.id);
  if (!c) return;
  let m = document.getElementById('ss-builder');
  if (!m) { m = document.createElement('div'); m.className = 'ss-ov'; m.id = 'ss-builder'; document.body.appendChild(m); }
  const err = SB.res[c.id] && SB.res[c.id].error;
  if (SB2.phase === 'describe') {
    m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">전략 설명하기</div>'
      + '<div class="ss-wip">⚠ 사용자 전략 기능은 아직 다듬는 중이라 결과가 바뀔 수 있습니다.</div>'
      + '<div class="ss-help">내 전략을 말로 최대한 자세히 적어 주세요. 쓸 수 있는 종목은 <b>TQQQ</b>·<b>QLD</b>·<b>QQQ</b>·<b>SPY</b>·<b>SSO</b>·<b>SPXL</b>·<b>SQQQ</b>(나스닥 −3배 인버스)와 금융 여건 지수 <b>NFCI</b> 입니다 — 사고팔 조건, 기준값, 매달 적립금을 어떻게 다룰지까지.</div>'
      + '<textarea id="ss-bdesc" class="ss-ta" placeholder="예: TQQQ 를 들고 있다가, 매달 말 QQQ 종가가 200일 이동평균 아래면 전부 현금으로 바꾸고, 다시 위로 올라오면 TQQQ 를 삽니다. 매달 적립금은 지금 들고 있는 쪽에 더합니다.">' + ssEsc(c.desc || '') + '</textarea>'
      + '<div class="ss-mact"><button type="button" class="ss-btn" data-b="cancel">취소</button><button type="button" class="ss-btn pri" data-b="next">다음 →</button></div></div>';
  } else {
    m.innerHTML = '<div class="ss-modal ss-modal-w" role="dialog" aria-modal="true"><div class="ss-mtitle">코드 만들기 · 붙여넣기</div>'
      + '<div class="ss-help">아래 단추로 프롬프트를 복사해 <b>ChatGPT</b> 나 <b>Claude</b> 에 붙여 넣어 보내세요. 돌아온 답(코드)을 그대로 복사해 아래 칸에 붙여 넣으면 됩니다. 코드는 이 페이지와 분리된 격리 공간에서만 실행됩니다.</div>'
      + '<button type="button" class="ss-btn ss-copyp" data-b="copy">프롬프트 복사 (ChatGPT · Claude 용)</button>'
      + '<div class="ss-blabel">답을 여기에 붙여 넣으세요</div>'
      + (err && c.code ? '<div class="ss-err"><b>실행하지 못했습니다:</b> ' + ssEsc(err) + '</div>' : '')
      + '<div class="ss-code"><div class="ss-cgut" aria-hidden="true"></div><div class="ss-cscroll"><pre class="ss-chl" aria-hidden="true"><code></code></pre><textarea id="ss-bcode" class="ss-cin" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="전략 코드를 여기에 붙여 넣으세요…">' + ssEsc(c.code || '') + '</textarea></div></div>'
      + '<div class="ss-mact"><button type="button" class="ss-btn" data-b="back">← 뒤로</button><button type="button" class="ss-btn pri" data-b="apply">적용하고 보기</button></div></div>';
  }
  const ta = m.querySelector('#ss-bcode');
  if (ta) ssCodeEditor(ta);
  const f = m.querySelector('textarea');
  if (f) f.focus();
}
document.addEventListener('click', (e) => {
  const m = document.getElementById('ss-builder');
  if (!m || !m.contains(e.target)) return;
  const b = e.target.closest('[data-b]');
  const c = ssFindCfg(SB2.id);
  if (!b || !c) return;
  const act = b.getAttribute('data-b');
  if (act === 'cancel') { ssCloseBuilder(true); return; }
  if (act === 'next') { const d = document.getElementById('ss-bdesc'); c.desc = d ? d.value : ''; ssPersistSaved(); SB2.phase = 'generate'; ssDrawBuilder(); return; }
  if (act === 'back') { const t = document.getElementById('ss-bcode'); if (t) { c.code = t.value; ssPersistSaved(); } SB2.phase = 'describe'; ssDrawBuilder(); return; }
  if (act === 'copy') {
    const txt = ssBuildPrompt(c.desc);
    const done = () => { b.textContent = '복사됨 ✓ — ChatGPT · Claude 에 붙여 넣으세요'; b.classList.add('flash'); setTimeout(() => { if (b.isConnected) { b.textContent = '프롬프트 복사 (ChatGPT · Claude 용)'; b.classList.remove('flash'); } }, 2400); };
    ssCopy(txt, done);
    return;
  }
  if (act === 'apply') {
    const t = document.getElementById('ss-bcode');
    if (!t) return;
    c.code = t.value;
    delete SB.res[c.id];
    ssPersistSaved();
    const id = c.id;
    ssCloseBuilder(false);
    ssOpenCfgPanel(id);
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ss-builder')) { e.stopImmediatePropagation(); ssCloseBuilder(true); } }, true);
function ssCopy(text, done) {
  const legacy = () => {
    const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) {} t.remove();
    if (ok) done(); else window.prompt('아래 내용을 복사해 주세요', text);
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, legacy); else legacy();
}

// ── 코드 편집기 (글자색 · 줄 번호 · 붙여넣기/포커스 아웃 때 정리) ──
const SS_KW = new Set('const let var function return if else for while do switch case break continue new typeof instanceof in of delete void this null true false undefined class extends super import export default try catch finally throw async await yield'.split(' '));
function ssHighlight(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', i = 0;
  const n = src.length;
  const push = (cls, t) => { out += cls ? '<span class="tk-' + cls + '">' + esc(t) + '</span>' : esc(t); };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; } j = Math.min(j + 1, n); push('str', src.slice(i, j)); i = j; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) { let j = i + 1; while (j < n && /[0-9a-fA-FxXeE._+-]/.test(src[j])) j++; push('num', src.slice(i, j)); i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; const w = src.slice(i, j); let k = j; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++; push(SS_KW.has(w) ? 'kw' : src[k] === '(' ? 'fn' : /[A-Z]/.test(w[0]) ? 'cls' : null, w); i = j; continue; }
    if (/[{}()[\].,;]/.test(c)) { push('pn', c); i++; continue; }
    if (/[+\-*/%=<>!&|^~?:]/.test(c)) { push('op', c); i++; continue; }
    push(null, c); i++;
  }
  return out;
}
function ssLoadBeautify() {
  if (SB2.beautify) return SB2.beautify;
  SB2.beautify = new Promise((res) => {
    if (window.js_beautify) { res(window.js_beautify); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/js-beautify/1.15.1/beautify.min.js';
    s.onload = () => res(window.js_beautify || null);
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return SB2.beautify;
}
function ssCodeEditor(ta) {
  const scroll = ta.parentElement, pre = scroll.querySelector('.ss-chl'), code = pre.querySelector('code'), gut = scroll.parentElement.querySelector('.ss-cgut');
  let lines = -1;
  const gutter = () => { const n = ta.value.split('\n').length; if (n === lines) return; lines = n; let g = ''; for (let k = 1; k <= n; k++) g += k + '\n'; gut.textContent = g; };
  const paint = () => { code.innerHTML = ssHighlight(ta.value) + '\n'; gutter(); };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; };
  const format = () => {
    const v = ta.value.trim();
    if (!v) { paint(); return; }
    ssLoadBeautify().then((bf) => {
      if (bf) { try { const f = bf(ta.value.trim(), { indent_size: 2, brace_style: 'collapse,preserve-inline', space_in_empty_paren: true, end_with_newline: false }); if (f && f !== ta.value) ta.value = f; } catch (e) {} }
      paint(); sync();
    });
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  ta.addEventListener('paste', () => setTimeout(format, 0));
  ta.addEventListener('blur', format);
  if (ta.value.trim()) format(); else paint();
  sync();
}

// ── 사용자 전략 패널 ──
const SS_MINI = { W: 320, H: 148, padL: 6, padT: 8, padB: 16 };
const SS_MINI_COLORS = ['#e11d48', '#0284c7', '#059669', '#a16207', '#7c3aed'];
const ssLineColor = (c, i) => (i === 0 ? c.color : SS_MINI_COLORS[(i - 1) % SS_MINI_COLORS.length]);
const ssLineShown = (c, key) => ((c.subShown || {})[key]) !== false;
let ssMiniData = null;
function ssMiniFmt(v) { return v >= 1000 ? ssMoney(v) : '$' + (v < 10 ? v.toFixed(2) : String(Math.round(v))); }
function ssMiniChart(cfg, lines, log, cw) {
  const series = [];
  lines.forEach((ln, i) => {
    if (!ssLineShown(cfg, ln.key)) return;
    const pts = [];
    for (const r of log) if (r && r.date != null && typeof r[ln.key] === 'number' && isFinite(r[ln.key]) && r[ln.key] > 0) pts.push({ t: Date.parse(r.date), v: r[ln.key], d: String(r.date) });
    if (pts.length > 1) series.push({ label: ln.label, color: ssLineColor(cfg, i), pts });
  });
  ssMiniData = null;
  if (!series.length) return '';
  const { W, H, padL, padT, padB } = SS_MINI, k = Math.max(1, (cw || W) / W);
  const vt = (v) => (v >= 1000 ? ssMoney(v) : '$' + v.toFixed(2));
  const vcw = Math.max(...series.map((s) => vt(s.pts[s.pts.length - 1].v).length)) * (9 / k) * 0.6;
  const ncw = Math.max(...series.map((s) => s.label.length)) * (7 / k) * 0.9;
  const padR = Math.min(4 / k + vcw + 4 / k + ncw + 2 / k, 0.45 * W);
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.pts) { if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t; if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  if (!(t1 > t0) || !(hi > 0)) return '';
  const l0 = Math.log10(lo), l1 = Math.log10(hi), lp = Math.max((l1 - l0) * 0.05, 0.01), yLo = l0 - lp, yHi = l1 + lp;
  const xAt = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const yAt = (v) => padT + (yHi - Math.log10(v)) / (yHi - yLo) * (H - padT - padB);
  ssMiniData = { series, t0, t1, yLo, yHi, W, H, padR, k };
  const T = ssTheme(), halo = T.light ? 'rgba(255,255,255,0.95)' : 'rgba(23,23,28,0.95)', mute = T.text3;
  let grid = '';
  for (let g = 0; g < 3; g++) {
    const lv = Math.pow(10, yLo + (yHi - yLo) * (0.15 + 0.35 * g)), y = yAt(lv).toFixed(1);
    grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + T.grid + '" stroke-width="0.5"/><text x="' + (padL + 1) + '" y="' + (+y - 2).toFixed(1) + '" font-family="DM Mono" font-size="' + (8 / k).toFixed(2) + '" fill="' + mute + '" stroke="' + halo + '" stroke-width="' + (2 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + ssMiniFmt(lv) + '</text>';
  }
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0) / 6)), half = 10 / k;
  let xa = '';
  for (let y = y0 + 1; y <= y1; y += step) { const t = Date.parse(y + '-01-01'); if (t <= t0 || t >= t1) continue; xa += '<text x="' + Math.max(half, Math.min(W - half, xAt(t))).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-family="DM Mono" font-size="' + (8 / k).toFixed(2) + '" fill="' + mute + '">' + y + '</text>'; }
  let paths = '';
  const ends = [];
  for (const s of series) {
    let d = '';
    for (const p of s.pts) d += (d ? 'L' : 'M') + xAt(p.t).toFixed(1) + ',' + yAt(p.v).toFixed(1);
    paths += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="0.45"/>';
    const last = s.pts[s.pts.length - 1];
    ends.push({ y: yAt(last.v), v: last.v, color: s.color, name: s.label });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 10 / k) ends[i].y = ends[i - 1].y + 10 / k;
  let el = '';
  for (const e of ends) {
    el += '<text x="' + (W - padR + 4 / k).toFixed(1) + '" y="' + (e.y + 3 / k).toFixed(1) + '" font-family="DM Mono" font-size="' + (9 / k).toFixed(2) + '" font-weight="600" fill="' + e.color + '" stroke="' + halo + '" stroke-width="' + (2.5 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + vt(e.v) + '</text>'
      + '<text x="' + (W - padR + 8 / k + vcw).toFixed(1) + '" y="' + (e.y + 3 / k).toFixed(1) + '" font-family="Noto Sans KR" font-size="' + (7 / k).toFixed(2) + '" font-weight="600" fill="' + e.color + '" stroke="' + halo + '" stroke-width="' + (2 / k).toFixed(2) + '" stroke-linejoin="round" paint-order="stroke">' + ssEsc(e.name) + '</text>';
  }
  return '<svg class="ss-mini" viewBox="0 0 ' + W + ' ' + H + '">' + grid + paths + el + xa + '</svg>';
}
// 신호 차트 마우스: 십자선 + 값 · 끌면 구간 %
(function () {
  let drag = null, active = false;
  const tipEl = () => { let t = document.getElementById('ss-minitip'); if (!t) { t = document.createElement('div'); t.id = 'ss-minitip'; t.hidden = true; document.body.appendChild(t); } return t; };
  const clear = () => { const g = document.querySelector('.ss-mini .mh'); if (g) g.remove(); const t = document.getElementById('ss-minitip'); if (t) t.hidden = true; active = false; };
  const nearest = (pts, t) => { let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; } return t - pts[lo].t <= pts[hi].t - t ? pts[lo] : pts[hi]; };
  const anchor = (svg, e, d) => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / (r.width / d.W), f = Math.max(0, Math.min(1, (x - SS_MINI.padL) / (d.W - SS_MINI.padL - d.padR))); return nearest(d.series[0].pts, d.t0 + f * (d.t1 - d.t0)); };
  const xAt = (d, t) => SS_MINI.padL + (t - d.t0) / (d.t1 - d.t0) * (d.W - SS_MINI.padL - d.padR);
  const place = (tip, e) => { tip.hidden = false; let l = e.clientX + 14, t = e.clientY + 12; if (l + tip.offsetWidth > window.innerWidth - 8) l = e.clientX - tip.offsetWidth - 12; if (t + tip.offsetHeight > window.innerHeight - 8) t = e.clientY - tip.offsetHeight - 10; tip.style.left = l + 'px'; tip.style.top = t + 'px'; };
  const exact = (v) => (v >= 1000 ? ssMoney(v) : '$' + v.toFixed(2));
  document.addEventListener('mousedown', (e) => { const svg = e.target.closest && e.target.closest('.ss-mini'); if (!svg || !ssMiniData || !ssMiniData.series.length) return; drag = anchor(svg, e, ssMiniData); e.preventDefault(); });
  document.addEventListener('mouseup', () => { if (!drag) return; drag = null; clear(); });
  document.addEventListener('mousemove', (e) => {
    const svg = e.target.closest && e.target.closest('.ss-mini');
    if (!svg) { if (active && !drag) clear(); return; }
    const d = ssMiniData;
    if (!d || !d.series.length) return;
    const M = SS_MINI, yAt = (v) => M.padT + (d.yHi - Math.log10(v)) / (d.yHi - d.yLo) * (d.H - M.padT - M.padB);
    const a = anchor(svg, e, d);
    let g = svg.querySelector('.mh');
    if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.setAttribute('class', 'mh'); svg.appendChild(g); }
    const tip = tipEl(), line = 'rgba(122,122,166,0.6)';
    if (drag && drag.t !== a.t) {
      let lo = drag, hi = a;
      if (hi.t < lo.t) { lo = a; hi = drag; }
      const xA = xAt(d, lo.t), xB = xAt(d, hi.t);
      const sp = d.series.map((s) => Object.assign({}, s, { p0: nearest(s.pts, lo.t), p1: nearest(s.pts, hi.t) }));
      g.innerHTML = '<rect x="' + xA.toFixed(1) + '" y="' + M.padT + '" width="' + (xB - xA).toFixed(1) + '" height="' + (d.H - M.padT - M.padB) + '" fill="rgba(49,130,246,0.10)"/>'
        + sp.map((s) => { const y0 = yAt(s.p0.v).toFixed(1), y1 = yAt(s.p1.v).toFixed(1); return '<line x1="' + xA.toFixed(1) + '" y1="' + y0 + '" x2="' + xB.toFixed(1) + '" y2="' + y1 + '" stroke="' + s.color + '" stroke-width="0.5" stroke-dasharray="2,1.5"/><circle cx="' + xA.toFixed(1) + '" cy="' + y0 + '" r="0.9" fill="' + s.color + '"/><circle cx="' + xB.toFixed(1) + '" cy="' + y1 + '" r="0.9" fill="' + s.color + '"/>'; }).join('');
      tip.innerHTML = '<div class="d">' + ssDate(lo.d) + ' – ' + ssDate(hi.d) + '</div>' + sp.map((s) => { const p = s.p0.v > 0 ? (s.p1.v / s.p0.v - 1) * 100 : 0; return '<div class="r"><i style="background:' + s.color + '"></i>' + ssEsc(s.label) + '<b class="' + (p >= 0 ? 'ss-up' : 'ss-dn') + '">' + (p >= 0 ? '+' : '') + p.toFixed(1) + '%</b><span>' + exact(s.p0.v) + ' → ' + exact(s.p1.v) + '</span></div>'; }).join('');
      place(tip, e); active = true;
      return;
    }
    const cx = xAt(d, a.t), hits = d.series.map((s) => Object.assign({}, s, { pt: nearest(s.pts, a.t) }));
    g.innerHTML = '<line x1="' + cx.toFixed(1) + '" y1="' + M.padT + '" x2="' + cx.toFixed(1) + '" y2="' + (d.H - M.padB) + '" stroke="' + line + '" stroke-width="0.3" stroke-dasharray="2,2"/>' + hits.map((h) => '<circle cx="' + cx.toFixed(1) + '" cy="' + yAt(h.pt.v).toFixed(1) + '" r="0.6" fill="' + h.color + '"/>').join('');
    tip.innerHTML = '<div class="d">' + ssDate(a.d) + '</div>' + hits.map((h) => '<div class="r"><i style="background:' + h.color + '"></i>' + ssEsc(h.label) + '<b>' + ssMiniFmt(h.pt.v) + '</b></div>').join('');
    place(tip, e); active = true;
  });
})();

// 로그 칸 서식: 키 이름으로 (price·sma·median… = 가격 · share = 주수 · pct = % · 나머지 숫자 = $)
const SS_CLOG = {
  date: ['날짜', '이 줄이 있었던 거래일.\n\n전략이 무언가를 적은 날만 나옵니다 — 거래·적립·주기적 평가.'],
  action: ['동작', '이날 전략이 한 일 — 매수·매도·갈아타기(한 종목에서 다른 종목으로)·비중 조정·나눠 사기 한 조각·매달 적립·그냥 평가.\n\n거래한 줄은 차트 선 위에 표시로 그려지고, 줄에 마우스를 올리면 그 표시가 밝아집니다.\n\n괄호 속 (%) 는 직전 줄 이후의 수익·손실(이 줄의 적립금은 뺌)입니다.'],
  note: ['메모', '전략이 이 줄에 단 설명 — 보통 규칙이 왜 작동했는지.'],
  held: ['보유', '이 줄 직후 들고 있던 것. CASH 는 시장 밖(현금).'],
  price: ['가격', '보유 칸 종목의 그날 종가. 현금 줄은 비어 있음. 가격 × 주수 = 보유 평가액.'],
  shares: ['주수', '이 줄 뒤 들고 있던 종목의 주수. 전부 현금이면 0.'],
  holdingsValue: ['보유 평가액', '현금을 뺀, 들고 있는 모든 것의 금액.'],
  stockVal: ['보유 평가액', '현금을 뺀, 들고 있는 모든 것의 금액.'],
  cash: ['현금', '이 줄 뒤 현금으로 있는 금액.'],
  value: ['합계', '그날 전체 평가액: 보유 + 현금. 차트의 이 전략 선이 그리는 값입니다.'],
  invested: ['넣은 돈', '이 날까지 넣은 돈의 합 — 시작 금액 + 지금까지의 적립금(출금은 뺌).\n\n합계 − 넣은 돈 = 수익.'],
  contributed: ['새 돈', '이 줄에 새로 들어온 돈. 출금이면 음수, 없으면 빈칸.'],
  fee: ['수수료', '이 줄의 거래에서 낸 비용(전략이 계산할 때).'],
};
const SS_CLOG_ORDER = ['date', 'action', 'note', 'held', 'price', 'shares', 'holdingsValue', 'stockVal', 'cash', 'value', 'invested', 'contributed', 'fee'];
function ssCLogCell(k, v) {
  if (v == null || v === '') return '';
  const lk = String(k).toLowerCase();
  if (lk === 'date') return ssLogDate(String(v));
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    if (/price|sma|ema|median|avg|mean/.test(lk)) return v > 0 ? ssLogPrice(v) : '—';
    if (lk.includes('share') || lk.includes('unit') || lk.includes('qty')) return ssLogShares(v);
    if (lk.includes('pct') || lk.includes('percent')) return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
    if ((lk.includes('contrib') || lk.includes('deposit') || lk === 'fee') && v === 0) return '';
    return ssMoney(Math.round(v));
  }
  return ssEsc(v);
}
function ssCLogHtml(log, columns) {
  if (!log || !log.length) return '';
  const meta = {};
  for (const k in SS_CLOG) meta[k] = { label: SS_CLOG[k][0], tip: SS_CLOG[k][1] };
  const declared = [];
  for (const c of columns || []) { if (!c || !c.key) continue; const b = meta[c.key] || {}; meta[c.key] = { label: c.label || b.label || null, tip: c.tip || b.tip || null }; declared.push(c.key); }
  const present = [], seen = new Set();
  for (const r of log) { if (!r) continue; for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); present.push(k); } }
  const rank = (k) => { const i = SS_CLOG_ORDER.indexOf(k); if (i >= 0) return i; const j = declared.indexOf(k); return j >= 0 ? 100 + j : 200 + present.indexOf(k); };
  const keys = present.slice().sort((a, b) => rank(a) - rank(b));
  const AC = { sma: 'SMA', ema: 'EMA', rsi: 'RSI', atr: 'ATR', macd: 'MACD', dd: 'DD', pct: '%', qqq: 'QQQ', spy: 'SPY', tqqq: 'TQQQ' };
  const title = (k) => (meta[k] && meta[k].label) || k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_]+/).map((w) => AC[w.toLowerCase()] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const th = (lab, tip) => '<th>' + ssEsc(lab) + ssTipI(tip) + '</th>';
  const head = th('#', '줄 번호 — 처음 적힌 줄이 0 이고 하나씩 늘어, 마지막 번호가 이 기간에 적힌 사건 수입니다.') + keys.map((k) => th(title(k), meta[k] && meta[k].tip)).join('');
  const AK = { buy: 'ss-up', sell: 'ss-dn', switch: 'ss-sw2', rebalance: 'ss-rb', ease: 'ss-up', contribution: 'ss-hold', start: 'ss-hold', end: 'ss-hold', hold: 'ss-hold' };
  let nc = 0, ne = 0;
  const body = log.map((row, i) => {
    const kind = ssCustomKind(row && row.action);
    if (kind === 'contribution') nc++;
    if (kind === 'ease') ne++;
    const mk = !!(SS_CEVT[kind] && +((row || {}).value) > 0);
    const cls = mk ? 'mk' : kind === 'contribution' ? 'rc' : kind === 'ease' ? 'rd' : '';
    const cells = keys.map((k) => {
      if (k !== 'action') return '<td>' + ssCLogCell(k, row ? row[k] : null) + '</td>';
      const g = ssCustomGain(log, i);
      return '<td class="' + (AK[kind] || 'ss-hold') + '">' + ssEsc(ssCustomLabel(row && row.action)) + (g == null ? '' : ' <span class="' + (g >= 0 ? 'ss-up' : 'ss-dn') + '">(' + (g >= 0 ? '+' : '−') + Math.abs(g).toFixed(1) + '%)</span>') + '</td>';
    }).join('');
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + (mk ? ' data-mkey="' + i + '"' : '') + '><td>' + i + '</td>' + cells + '</tr>';
  }).join('');
  const hold = keys.includes('held') ? ssHoldTime(log, (r) => String((r && r.held) || '').toUpperCase()) : '';
  const tg = (nc ? '<label class="ss-chk"><input type="checkbox" data-chide="c"' + (ssPanel.cHideC ? ' checked' : '') + '> 매달 적립 줄 숨기기 (' + nc + ')</label>' : '') + (ne ? '<label class="ss-chk"><input type="checkbox" data-chide="e"' + (ssPanel.cHideE ? ' checked' : '') + '> 나눠 사기 조각 숨기기 (' + ne + ')</label>' : '');
  return '<div class="ss-logsec">' + ssLogHead('거래 기록 (' + log.length + '줄)', 18) + '<div class="ss-chks">' + tg + '</div><div class="ss-tw ss-ctw' + (ssPanel.cHideC ? ' hide-c' : '') + (ssPanel.cHideE ? ' hide-e' : '') + '"><table class="ss-clog"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' + hold + '</div>';
}
function ssCSignalsHtml(sig, asOf) {
  if (!sig) return '';
  const tone = (t) => { const v = String(t || '').toLowerCase(); return v === 'good' || v === 'positive' || v === 'up' ? 'ss-up' : v === 'bad' || v === 'negative' || v === 'down' || v === 'warn' ? 'ss-dn' : ''; };
  let h = '';
  const cards = (sig.cards || []).filter((c) => c && c.label);
  if (cards.length) {
    const a = sig.asOf || asOf;
    h += '<div class="ss-sec" style="margin-top:24px"><span>신호 지표' + (a ? ' <i class="ss-asof">· ' + ssEsc(ssDate(a)) + ' 기준</i>' : '') + '</span></div><div class="ss-stats">'
      + cards.map((c) => ssStatCard(ssEsc(c.label), SS_ICON[c.icon] ? c.icon : 'activity', ssEsc(c.value != null ? c.value : '—'), tone(c.tone), c.sub ? ssEsc(c.sub) : '', c.tip || '', c.delta && c.delta.text ? { text: ssEsc(c.delta.text), tone: tone(c.delta.tone) } : null)).join('') + '</div>';
  }
  const d = sig.decision;
  if (d && (d.action || (d.reasons && d.reasons.length))) {
    const cls = tone(d.tone) === 'ss-up' ? 'buy' : tone(d.tone) === 'ss-dn' ? 'cash' : 'hold';
    h += ssDecisionHtml(d.action || '—', cls, d.note, (d.reasons || []).filter((r) => r && r.name).map((r) => ({ name: r.name, val: r.val, tag: r.tag, lean: ['buy', 'out', 'cash', 'hold'].indexOf(String(r.lean || '').toLowerCase()) >= 0 ? String(r.lean).toLowerCase() : 'hold' })));
  }
  return h;
}
// 사용자 전략 손잡이 선택지 → [{ value, label }]
function ssCParamOpts(sp) {
  if (Array.isArray(sp.options) && sp.options.length) return sp.options.map((o) => (o && typeof o === 'object' ? { value: o.value, label: o.label != null ? o.label : o.value } : { value: o, label: o }));
  if (sp.type === 'bool' || sp.type === 'boolean') return [{ value: true, label: '예' }, { value: false, label: '아니오' }];
  if ('min' in sp || 'max' in sp || sp.type === 'number') {
    let min = Number(sp.min), max = Number(sp.max), step = Number(sp.step);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = min + 10;
    if (!Number.isFinite(step) || step <= 0) step = (max - min) / 10 || 1;
    let n = Math.floor((max - min) / step) + 1;
    if (n > 24) { step = (max - min) / 23; n = 24; }
    if (n < 1) n = 1;
    const out = [];
    for (let i = 0; i < n; i++) { const v = +(min + i * step).toFixed(6); out.push({ value: v, label: String(v) }); }
    return out;
  }
  return [{ value: sp.default, label: String(sp.default) }];
}
const ssCParamVal = (cfg, sp) => ssCoerce(sp, cfg.params && sp.id in cfg.params ? cfg.params[sp.id] : sp.default);
function ssCParamLabel(sp, v) { const m = ssCParamOpts(sp).find((o) => String(o.value) === String(v)); return m ? String(m.label) : String(v); }
function ssCustomPanelHtml(cfg, m, cw) {
  const res = SB.res[cfg.id], err = res && res.error, schema = (res && res.schema) || [];
  let h = '<div class="ss-wip">⚠ 사용자 전략 기능은 아직 다듬는 중이라 결과가 바뀔 수 있습니다.</div>' + ssColorBar()
    + '<div class="ss-note2">전략 코드가 읽을 수 있는 종목: <code>tqqq</code> <code>qld</code> <code>qqq</code> <code>spy</code> <code>sso</code> <code>spxl</code> <code>sqqq</code>(일별 종가) + <code>nfci</code>(금융 여건 지수). 아무 종목이나 규칙에 쓸 수 있습니다.</div>'
    + '<button type="button" id="ss-cedit" class="ss-btn ss-ceditb">전략 고치기</button>';
  if (cfg.desc) h += '<div class="ss-desc">' + ssEsc(cfg.desc) + '</div>';
  if (err) h += '<div class="ss-err"><b>실행하지 못했습니다:</b> ' + ssEsc(err) + ' <span class="ss-mut">— \'전략 고치기\'로 코드를 고쳐 주세요.</span></div>';
  else if (!cfg.code) h += '<div class="ss-mut" style="margin:10px 0">아직 코드가 없습니다 — \'전략 고치기\'를 눌러 만들어 주세요.</div>';
  else if (!res) h += '<div class="ss-mut" style="margin:10px 0">계산 중…</div>';
  if (!err && m && Number.isFinite(m.cagr) && res) {
    const rg = ssDDRange(m.ddPeak, m.ddTrough);
    h += '<div class="ss-cstats"><div><span>연평균</span><b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b></div><div><span>최대 낙폭</span><b class="ss-dn">' + (Number.isFinite(m.maxDD) ? ssDD(m.maxDD) : '—') + '</b>' + (rg ? '<em>' + rg + '</em>' : '') + '</div><div><span>끝 금액</span><b>' + ssMoney(m.end || 0) + '</b></div></div>';
  }
  if (schema.length) {
    h += '<div class="ss-sec" style="margin-top:14px"><span>설정</span></div><div class="ss-cparams">' + schema.map((sp) => {
      if (!sp) return '';
      if (sp.id == null) return sp.section ? '<div class="ss-cpg">' + ssEsc(sp.section) + '</div>' : '';
      return '<div class="ss-cpr"><label>' + ssEsc(sp.label || sp.id) + '</label><button type="button" class="ss-pd ss-cp" data-cp="' + ssEsc(String(sp.id)) + '"><span>' + ssEsc(ssCParamLabel(sp, ssCParamVal(cfg, sp))) + '</span><i>▾</i></button></div>';
    }).join('') + '</div>';
  }
  const lines = (res && res.lines) || null, log = R.customLogs[cfg.id] || [];
  if (lines && lines.length) {
    h += '<div class="ss-sec" style="margin-top:14px"><span>신호 차트</span></div><div class="ss-subchips">' + lines.map((ln, i) => { const on = ssLineShown(cfg, ln.key); return '<div class="ss-chip ss-lchip' + (on ? '' : ' off') + '" data-line="' + ssEsc(ln.key) + '" role="button" tabindex="0">' + ssEye(on) + '<span class="ss-lsw" style="background:' + ssLineColor(cfg, i) + '"></span><span class="ss-cname">' + ssEsc(ln.label) + '</span></div>'; }).join('') + '</div>'
      + ssMiniChart(cfg, lines, log, cw);
  }
  h += ssCSignalsHtml(res && res.signals, log.length ? log[log.length - 1].date : null);
  h += ssCLogHtml(log, res && res.columns);
  return h;
}
// 사용자 전략 손잡이 미리보기 (선택지마다 격리 실행 → 끝 금액 막대)
function ssCloseCp() { if (ssPd && ssPd.cp) ssClosePd(); }
function ssOpenCp(trig) {
  if (ssPd && ssPd.trig === trig) { ssClosePd(); return; }
  const cfg = ssFindCfg(S.editing);
  const res = cfg && SB.res[cfg.id];
  const sp = res && (res.schema || []).find((x) => x && String(x.id) === trig.getAttribute('data-cp'));
  if (!cfg || !sp) return;
  ssClosePd();
  const opts = ssCParamOpts(sp), cur = ssCParamVal(cfg, sp);
  const curIdx = opts.findIndex((o) => String(o.value) === String(cur));
  const pop = ssPdShell(trig, opts.map((o) => String(o.label)), curIdx, (i) => {
    const o = opts[i];
    cfg.params = cfg.params || {};
    cfg.params[sp.id] = typeof o.value === 'boolean' ? o.value : String(o.value);
    ssPersistSaved(); ssChanged();
  });
  ssPd.cp = true;
  const ctx = R.ctx;
  if (!ctx || !cfg.code) return;
  const g = ssCustomGlobals(ctx);
  ssClearPreview();
  const fin = new Array(opts.length).fill(null);
  const draw = () => { if (ssPd && ssPd.pop === pop) ssPdFill(pop, fin, 'one'); };
  const ck = JSON.stringify(g.contributions);
  opts.forEach((o, i) => {
    const ov = {}; ov[sp.id] = typeof o.value === 'boolean' ? o.value : String(o.value);
    const merged = Object.assign({}, cfg.params || {}, ov);
    const key = [cfg.code, JSON.stringify(merged), g.startIdx, g.endIdx, g.initial, g.monthly, g.annualRaise, g.entryDate || '', g.exitDate || '', ck, g.weeklyDisplay ? 1 : 0].join('|');
    if (SB.pcache[key] != null) { fin[i] = SB.pcache[key]; return; }
    ssPreviewRun(cfg.code, merged, g, (msg) => {
      let fv = 0;
      if (msg && msg.log) for (let k = msg.log.length - 1; k >= 0; k--) { const v = msg.log[k].value; if (typeof v === 'number' && isFinite(v)) { fv = v; break; } }
      SB.pcache[key] = fv; fin[i] = fv; draw();
    });
  });
  draw();
}
