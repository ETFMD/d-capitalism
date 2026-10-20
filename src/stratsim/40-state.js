/* ── [STRATSIM] 40 앱 상태 · 브라우저 저장 · 공유 주소(#ss=) ──────────────────
   · 상태는 S 하나에 — 화면(DOM)은 S 를 그리기만 함
   · 저장: 브라우저 localStorage (입력·기간·보기 / 저장 전략 / 거래내역)
   · 공유·내 저장함: 지금 상태를 압축해 주소 # 에 둠(#ss=…) — 사이트의 공유 창·내 저장함이 # 를 함께 담음 */

const SS_LS = { main: 'dc_ss_state_v1', saved: 'dc_ss_saved_v1', tx: 'dc_ss_tx_v1', panelW: 'dc_ss_panel_w' };
const SS_BASE_COLORS = { '9sig': '#45818e', bh: '#ff2d2e', invested: '#bf9000', sma: '#c64eff' };
const SS_CFG_COLORS = ['#e879f9', '#f59e0b', '#34d399', '#fb7185', '#60a5fa', '#c084fc', '#f97316', '#2dd4bf', '#a78bfa', '#f43f5e', '#84cc16', '#38bdf8'];
const SS_TYPE_NAMES = { '9sig': '9sig', sma: 'SMA', bh: '그냥 보유', invested: '현금 복리', custom: '사용자 전략' };

const S = {
  iPos: 333, mPos: 233, raise: '0',            // 초기 투자 · 매달 적립(슬라이더 위치) · 연 증가율(%)
  e: 0, x: 0, ed: '', xd: '',                  // 진입·청산 분기 위치 + 정확한 날짜(있으면)
  log: false, infl: false,                     // 로그 축 · 물가 반영
  hide: { bh: false, invested: false },        // 기본 선 숨김
  base: { '9sig': ssDefaults('9sig'), sma: ssDefaults('sma'), bh: ssDefaults('bh'), invested: ssDefaults('invested') },
  baseColor: {},                               // 기본 선 색 (이번 방문 동안만)
  saved: [],                                   // 저장 전략
  editing: null,                               // 패널에서 편집 중인 저장 전략 id
  panel: null,                                 // 열린 기본 패널: 'bh' | 'invested' | null
  pendingName: null,                           // 기본 패널에서 저장 전 적어 둔 이름
  tx: null, txStash: null,                     // 거래내역: 켜진 것 · 꺼도 남는 마지막 것
  pin: null,                                   // 고정한 구간 [시작, 끝]
  an: { open: false, strategy: '9sig', baseline: 'compounded', target: 1e6, growth: 20, yMin: null, yMax: null },
  fetchedAt: null,
};
let ssReady = false;

// ── 저장 전략 ────────────────────────────────────────────────────────
const ssNewId = () => 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function ssFindCfg(id) { return S.saved.find((c) => c.id === id) || null; }
function ssUniqueName(want, exceptId) {
  const used = new Set(S.saved.filter((c) => c.id !== exceptId).map((c) => c.name));
  let name = want, n = 2;
  while (used.has(name)) name = want + ' (' + (n++) + ')';
  return name;
}
function ssNextColor() {
  const used = new Set(S.saved.map((c) => c.color));
  for (const c of SS_CFG_COLORS) if (!used.has(c)) return c;
  return SS_CFG_COLORS[S.saved.length % SS_CFG_COLORS.length];
}
function ssBaseColor(type) { return S.baseColor[type] || SS_BASE_COLORS[type] || '#7a7aa6'; }
function ssCleanCfg(c) {
  if (!c || typeof c !== 'object' || !SS_TYPE_NAMES[c.type]) return null;
  const cfg = { id: typeof c.id === 'string' ? c.id : ssNewId(), type: c.type, name: String(c.name || SS_TYPE_NAMES[c.type]).slice(0, 80),
    color: /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : ssNextColor(), hidden: !!c.hidden };
  if (c.type === 'custom') {
    cfg.code = String(c.code || '');
    cfg.desc = String(c.desc || '');
    cfg.params = {};
    if (c.params && typeof c.params === 'object') for (const k in c.params) { const v = c.params[k]; if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') cfg.params[k] = v; }
    if (c.lib != null) cfg.lib = +c.lib;
  } else cfg.params = ssCleanParams(c.type, c.params);
  if (c.subShown && typeof c.subShown === 'object') { cfg.subShown = {}; for (const k in c.subShown) cfg.subShown[k] = !!c.subShown[k]; }
  return cfg;
}
function ssPersistSaved() {
  try { localStorage.setItem(SS_LS.saved, JSON.stringify(S.saved.filter((c) => !c._tr).map((c) => { const o = Object.assign({}, c); delete o._tr; return o; }))); } catch (e) {}
}

// ── 입력·보기 저장 ───────────────────────────────────────────────────
function ssPersistMain() {
  const o = { i: S.iPos, m: ssPosToMonthly(S.mPos), a: S.raise, r: ssPosToRate(+S.base.invested.r), e: S.e, x: S.x, ed: S.ed, xd: S.xd,
    l: S.log, f: S.infl, hd: Object.keys(S.hide).filter((k) => S.hide[k]) };
  try { localStorage.setItem(SS_LS.main, JSON.stringify(o)); } catch (e) {}
}
function ssApplyMain(o, fromLink) {
  if (!o || typeof o !== 'object') return;
  const num = (v) => (v != null && v !== '' && Number.isFinite(+v) ? +v : null);
  if (num(o.i) != null) S.iPos = Math.max(0, Math.min(1000, Math.round(num(o.i))));
  if (num(o.m) != null) S.mPos = ssMonthlyToPos(num(o.m));
  if (o.a != null && SS_RAISE_OPTS.some((x) => x === String(o.a))) S.raise = String(o.a);
  if (num(o.r) != null) S.base.invested.r = String(ssRateToPos(num(o.r)));
  if (num(o.e) != null) S.e = Math.max(0, Math.round(num(o.e)));
  if (num(o.x) != null) S.x = Math.max(0, Math.round(num(o.x)));
  S.ed = typeof o.ed === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.ed) ? o.ed : (fromLink ? '' : S.ed);
  S.xd = typeof o.xd === 'string' && /^\d{4}-\d\d-\d\d$/.test(o.xd) ? o.xd : (fromLink ? '' : S.xd);
  if (o.l != null) S.log = !!o.l;
  if (o.f != null) S.infl = !!o.f;
  if (Array.isArray(o.hd)) { S.hide.bh = o.hd.indexOf('bh') >= 0; S.hide.invested = o.hd.indexOf('invested') >= 0; }
}
// 기본 선(그냥 보유·현금 복리)의 계산값: 그 설정 창을 열어 고치는 중일 때만 바꾼 값, 나머지 때는 늘 표준값
// (원본과 같음 — 주소에 bu·r 만 있고 창이 닫혀 있으면 표준 TQQQ·4% 로 그림)
function ssBaseEff(type) { return S.panel === type ? S.base[type] : ssDefaults(type); }
const SS_RAISE_OPTS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '15', '20', '25'];

function ssLoadStorage() {
  try { const o = JSON.parse(localStorage.getItem(SS_LS.main) || 'null'); if (o) ssApplyMain(o, false); } catch (e) {}
  try {
    const arr = JSON.parse(localStorage.getItem(SS_LS.saved) || '[]');
    if (Array.isArray(arr)) S.saved = arr.map(ssCleanCfg).filter(Boolean);
  } catch (e) {}
}

// ── 압축 (deflate-raw + base64url) ───────────────────────────────────
const ssB64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ssUnB64u = (t) => { let b = t.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function ssPack(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    try {
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
      return 'z' + ssB64u(new Uint8Array(out));
    } catch (e) {}
  }
  return 'j' + ssB64u(bytes);
}
async function ssUnpack(tok) {
  if (!tok || tok.length < 2) return null;
  const body = ssUnB64u(tok.slice(1));
  if (tok[0] === 'j') return new TextDecoder().decode(body);
  if (tok[0] !== 'z' || typeof DecompressionStream !== 'function') return null;
  const out = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(out));
}

// 지금 화면 상태 → 공유용 묶음 (원본 공유 링크와 같은 범위: 보이는 저장 전략·거래내역·분석 창·고정 구간 포함)
function ssShareState() {
  const o = { v: 1, i: S.iPos, m: ssPosToMonthly(S.mPos), a: S.raise, r: ssPosToRate(+S.base.invested.r), e: S.e, x: S.x };
  if (S.ed) o.ed = S.ed;
  if (S.xd) o.xd = S.xd;
  if (S.base.bh.ul !== 'tqqq') o.bu = S.base.bh.ul;
  const d9 = ssDiffParams('9sig', S.base['9sig']), ds = ssDiffParams('sma', S.base.sma);
  if (d9) o.b9 = d9;
  if (ds) o.bs = ds;
  if (S.log) o.l = 1;
  if (S.infl) o.f = 1;
  o.hd = Object.keys(S.hide).filter((k) => S.hide[k]);
  const act = S.saved.filter((c) => !c.hidden);
  // 라이브러리에서 그대로 가져온 사용자 전략은 코드 대신 번호만 (받는 쪽이 같은 코드를 라이브러리에서 채움 — 링크가 짧아져 공유 창 4000자 안에 들어감)
  const libOf = (c) => (c.lib != null && typeof SS_LIBRARY !== 'undefined' ? SS_LIBRARY.find((e) => e.n === c.lib) : null);
  if (act.length) o.sc = act.map((c) => {
    const x = { t: c.type, n: c.name, p: c.params || {}, c: c.color };
    if (c.type === 'custom') { const L = libOf(c); if (L && L.code && L.code === c.code) x.lib = c.lib; else { x.code = c.code || ''; x.desc = c.desc || ''; } }
    if (c.subShown) x.ss = c.subShown;
    return x;
  });
  if (S.panel) o.sp = S.panel;
  const oi = act.findIndex((c) => c.id === S.editing);
  if (oi >= 0) o.spc = oi;
  if (S.tx && S.tx.rows && S.tx.rows.length) o.tx = S.tx.rows;
  if (S.an.open) o.am = 1;
  const anKey = (k) => { if (!k || k.indexOf('cfg:') !== 0) return k; const i = act.findIndex((c) => c.id === k.slice(4)); return i >= 0 ? 'cfg:' + i : null; };
  if (S.an.strategy && S.an.strategy !== '9sig') { const k = anKey(S.an.strategy); if (k) o.as = k; }
  if (S.an.baseline && S.an.baseline !== 'compounded') {
    const k = anKey(S.an.baseline);
    if (k) { o.ab = k; if (k === 'custom') o.act = Math.round(S.an.target); if (k === 'custom-pct') o.acp = S.an.growth; }
  }
  if (S.an.yMin != null) o.anp = S.an.yMin;
  if (S.an.yMax != null) o.amp = S.an.yMax;
  if (S.pin) { o.rf = S.pin[0]; o.rt = S.pin[1]; }
  return o;
}
function ssDiffParams(type, p) {
  const d = ssDefaults(type), out = {};
  let n = 0;
  for (const k in d) if (String(p[k]) !== d[k]) { out[k] = p[k]; n++; }
  return n ? out : null;
}
function ssIsDefaultState(o) {
  return o.i === 333 && o.m === 500 && o.a === '0' && o.r === 4 && !o.ed && !o.xd && !o.bu && !o.b9 && !o.bs && !o.l && !o.f && !o.hd.length && !o.sc && !o.sp && !o.tx && !o.am && !o.as && !o.ab && !o.rf
    && o.e === ssDefaultEntry() && o.x === DS.q.length - 1;
}
const ssDefaultEntry = () => { const i = DS.q.findIndex((r) => r[0] >= '2010-01-01'); return i < 0 ? 0 : i; };

// 상태 → 주소 # (조용히 · 기록 안 쌓음). 기본 상태면 # 를 비움
let _ssHashT = null, _ssHashTok = '';
function ssSyncHash() {
  clearTimeout(_ssHashT);
  _ssHashT = setTimeout(async () => {
    if (!ssReady) return;
    const o = ssShareState();
    let h = '';
    if (!ssIsDefaultState(o)) { try { h = 'ss=' + await ssPack(JSON.stringify(o)); } catch (e) { h = ''; } }
    _ssHashTok = h;
    const cur = location.hash.replace(/^#/, '');
    if (cur === h || (!h && !cur)) return;
    if (cur && !/^ss=/.test(cur) && !/=/.test(cur)) { if (!h) return; }   // #library 같은 자리표는 상태가 바뀔 때만 덮어씀
    try { history.replaceState(history.state, '', location.pathname + location.search + (h ? '#' + h : '')); } catch (e) {}
  }, 350);
}
// 공유 주소 전체 (사이트 공유 창의 4000자 한도와 상관없이 바로 복사)
async function ssShareUrl() {
  const o = ssShareState();
  const tok = ssIsDefaultState(o) ? '' : await ssPack(JSON.stringify(o));
  const base = (document.querySelector('link[rel="canonical"]') || {}).href || (location.origin + location.pathname);
  return base.replace(/[?#].*$/, '') + (tok ? '#ss=' + tok : '');
}

// 주소 # → 상태 (불러올 때 한 번). 공유받은 저장 전략은 '임시'(저장 버튼을 눌러야 내 브라우저에 남음)
async function ssReadHash() {
  const m = /(?:^|[#&])ss=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (!m) return null;
  try { const t = await ssUnpack(m[1]); const o = JSON.parse(t); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
}
function ssImportShared(arr) {
  if (!Array.isArray(arr)) return [];
  const sig = (c) => c.type + '|' + (c.name || '') + '|' + (c.code || '') + '|' + JSON.stringify(c.params || {});
  const have = new Set(S.saved.map(sig));
  const mapped = [];
  for (const raw of arr.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') { mapped.push(null); continue; }
    let code = raw.code, desc = raw.desc;
    if (raw.t === 'custom' && raw.lib != null && !code && typeof SS_LIBRARY !== 'undefined') {
      const L = SS_LIBRARY.find((e) => e.n === +raw.lib);
      if (L && L.code) { code = L.code; desc = L.rules || ''; }
    }
    const c = ssCleanCfg({ type: raw.t, name: raw.n, params: raw.p, color: raw.c, code, desc, subShown: raw.ss, lib: raw.lib });
    if (!c) { mapped.push(null); continue; }
    if (!have.has(sig(c))) { c.id = ssNewId(); c.name = ssUniqueName(c.name); c._tr = true; S.saved.push(c); have.add(sig(c)); }
    mapped.push(c);
  }
  return mapped;
}
// 공유 배열의 항목 → 지금 내 저장 전략 id (이름은 겹치면 바뀌므로 종류·코드·손잡이로 찾음 · 임시 것 먼저)
function ssResolveShared(c) {
  if (!c) return null;
  const key = (x) => x.type + '|' + (x.code || '') + '|' + JSON.stringify(x.params || {});
  const hits = S.saved.filter((x) => key(x) === key(c));
  if (!hits.length) return null;
  return (hits.find((x) => x._tr) || hits[0]).id;
}
