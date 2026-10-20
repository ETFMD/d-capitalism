/* ── [STRATSIM] 42 차트 (Chart.js) ─────────────────────────────────────────
   선 끝 이름표 · 마우스 풍선 카드 · 끌어서 구간 수익률 · 매매 표시(패널 열린 전략) · 범례 칩 */

let ssChart = null;
const SS_Y_TICKS = 8;
// 한국식: 오름 빨강 · 내림 파랑
const SS_UP = '#f04452', SS_DOWN = '#3182f6';
const SS_EVT = {   // 이동평균(SMA) 전략 거래 표시
  ENTER: { color: SS_UP, shape: 'circle', label: '매수' },
  EXIT: { color: SS_DOWN, shape: 'hexagon', label: '매도' },
  'BG-GTFO': { color: '#b06000', shape: 'diamond', label: '버블 → 현금' },
  'BG-CLEAR': { color: '#16a34a', shape: 'square', label: '버블 끝' },
};
const SS_CEVT = {  // 사용자 전략 거래 표시
  buy: { color: SS_UP, shape: 'circle', label: '매수' },
  sell: { color: SS_DOWN, shape: 'hexagon', label: '매도' },
  switch: { color: '#8b5cf6', shape: 'diamond', label: '갈아타기' },
  rebalance: { color: '#b06000', shape: 'square', label: '비중 조정' },
};
// 표시 테두리 = 거래한 종목
const SS_ASSET_STROKE = { tqqq: '#0040ff', qqq: '#ff8c00', spy: '#a020f0', qld: '#00b3e6', sso: '#ff1493', spxl: '#6d4c2f', sqqq: '#000000', cash: '#5a6472' };

// 사용자 전략 기록의 action 글 → 표시 종류 (앞머리로 먼저, 없으면 글 안에 든 낱말로)
const SS_KIND_BY_PREFIX = [
  ['contribution', /^(contrib|deposit|\+|적립|입금|출금)/],
  ['ease', /^(ease|dca|slice|tranche|분할)/],
  ['start', /^(start|init|open|시작)/],
  ['end', /^(end|final|끝|마지막)/],
  ['switch', /^(switch|swap|rotate|갈아)/],
  ['rebalance', /^(rebal|trim|adjust|비중|조정)/],
  ['sell', /^(sell|exit|park|매도)/],
  ['buy', /^(buy|enter|매수)/],
];
const SS_KIND_BY_WORD = ['contribution', 'sell', 'buy'];
function ssCustomKind(action) {
  const a = action == null ? '' : String(action).trim().toLowerCase();
  if (a === '') return 'hold';
  const pre = SS_KIND_BY_PREFIX.find((rule) => rule[1].test(a));
  if (pre) return pre[0];
  return SS_KIND_BY_WORD.find((w) => a.indexOf(w) !== -1) || 'hold';
}
const SS_KIND_LABEL = { buy: '매수', sell: '매도', switch: '갈아타기', rebalance: '비중 조정', ease: '분할 매수', contribution: '적립', start: '시작', end: '끝', hold: '보유' };
function ssCustomLabel(action) {
  const raw = String(action == null ? '' : action).trim();
  if (!raw) return '보유';
  const k = ssCustomKind(raw), st = SS_CEVT[k];
  // 설명이 붙은 긴 글('sell — 200일선 아래')은 그대로(첫 글자만 대문자), 짧은 낱말은 우리말 이름으로
  const wordy = raw.length > (st ? st.label.length + 2 : 6) && /[\s—:\-]/.test(raw.slice(1));
  return wordy ? raw[0].toUpperCase() + raw.slice(1) : (SS_KIND_LABEL[k] || raw);
}
// 직전 기록 대비 수익률(%) — 이번 기록에 들어온 적립금은 빼고
function ssCustomGain(log, i) {
  const before = i > 0 ? log[i - 1] : null, row = log[i];
  if (!before || !row || before.date === row.date) return null;
  const v0 = +before.value, v1 = +row.value;
  if (!(v0 > 0 && Number.isFinite(v1))) return null;
  const added = +row.contributed;
  return (v1 - v0 - (Number.isFinite(added) ? added : 0)) / v0 * 100;
}
function ssCustomEvents(log) {
  const out = [];
  (log || []).forEach((r, i) => { if (!r || r.date == null || !(+r.value > 0)) return; const st = SS_CEVT[ssCustomKind(r.action)]; if (st) out.push({ i, row: r, st }); });
  return out;
}
function ssAssetStroke(held) {
  if (held == null || held === '') return null;
  for (const p of String(held).toLowerCase().split(/[+/,\s]+/)) if (SS_ASSET_STROKE[p]) return SS_ASSET_STROKE[p];
  return null;
}
// 거래 표시가 가리키는 종목: 매수 = 지금 든 것, 매도 = 그 전에 들고 있던 것
function ssMarkerAsset(log, i, isSell) {
  const h = (r) => (r && r.held != null && r.held !== '' ? String(r.held) : null);
  if (!isSell) return h(log[i]);
  const cur = h(log[i]);
  for (let j = i - 1; j >= 0; j--) { const x = h(log[j]); if (x && x !== cur) return x; }
  return cur;
}

// ── 테마 색 (사이트 다크/라이트) ──
function ssTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return { light, text: v('--text', '#e4e4e5'), text2: v('--text2', '#9e9ea4'), text3: v('--text3', '#6d6d76'), grid: light ? 'rgba(0,27,55,0.07)' : 'rgba(255,255,255,0.06)',
    border: light ? 'rgba(0,27,55,0.16)' : 'rgba(255,255,255,0.14)', bg: light ? '#ffffff' : '#17171c', pill: light ? 'rgba(255,255,255,0.94)' : 'rgba(23,23,28,0.94)', accent: '#3182f6' };
}
const SS_MONO = '"DM Mono", ui-monospace, monospace', SS_SANS = '"Noto Sans KR", sans-serif';

// 색에 투명도 입히기 (#rgb · #rrggbb · rgb()/rgba() → rgba(r,g,b,a)) · 그 밖의 색 이름은 그대로
function ssWithAlpha(color, a) {
  if (typeof color !== 'string') return color;
  let rgb = null;
  if (color.charAt(0) === '#') {
    const hex = color.length === 4 ? color.slice(1).replace(/./g, '$&$&') : color.slice(1);
    rgb = [0, 2, 4].map((at) => parseInt(hex.substr(at, 2), 16));
  } else {
    const inner = /rgba?\(([^)]+)\)/.exec(color);
    if (inner) rgb = inner[1].split(',').slice(0, 3).map((x) => x.trim());
  }
  return rgb ? 'rgba(' + rgb.join(',') + ',' + a + ')' : color;
}

// 패널이 열린 선 = 굵게, 나머지 = 반투명
function ssActiveKey() {
  if (S.editing) return 'cfg:' + S.editing;
  if (S.panel) return S.panel;
  return null;
}
function ssApplyEmphasis() {
  const ak = ssActiveKey();
  const smaOpen = !!(S.editing && (ssFindCfg(S.editing) || {}).type === 'sma' && ssPanel.open);
  const customOpen = !!(S.editing && (ssFindCfg(S.editing) || {}).type === 'custom' && ssPanel.open);
  for (const d of R.datasets) {
    if (d._baseW == null) d._baseW = d.borderWidth != null ? d.borderWidth : 1;
    const isA = ak && d._key === ak, dim = ak && !isA;
    d.borderWidth = isA && (smaOpen || customOpen) ? 0 : isA ? d._baseW * 2 : d._baseW;
    d.borderColor = dim ? ssWithAlpha(d._color, 0.5) : d._color;
  }
}

// 라벨 사이 아무 날짜의 x 픽셀 (두 라벨 사이 보간)
function ssXForDate(c, date) {
  const labs = c.data.labels, axis = c.scales.x, end = labs.length - 1;
  let k = 0;   // date 이하 마지막 라벨
  while (k < end && labs[k + 1] <= date) k++;
  if (k >= end) return axis.getPixelForValue(end);
  const ta = Date.parse(labs[k]), tb = Date.parse(labs[k + 1]);
  const part = tb > ta ? Math.min(1, Math.max(0, (Date.parse(date) - ta) / (tb - ta))) : 0;
  const xa = axis.getPixelForValue(k);
  return xa + (axis.getPixelForValue(k + 1) - xa) * part;
}
// 마우스 x 픽셀 → 가장 가까운 라벨 번호 (범위 안으로)
function ssIndexForPixel(c, px) {
  const n = c.data.labels ? c.data.labels.length : 0;
  if (!n) return 0;
  const axis = c.scales.x;
  const at = axis && axis.getValueForPixel ? Math.round(axis.getValueForPixel(px)) : 0;
  return Number.isFinite(at) ? Math.min(n - 1, Math.max(0, at)) : 0;
}
// 거래 표시가 앞서 그린 표시와 겹치면(6px 안) 위·아래로 번갈아 한 칸씩 비켜 놓음 (최대 12칸)
function ssSpreadY(placed, x, baseY, area) {
  const GAP = 6;
  const crowded = (y) => {
    for (let j = placed.length - 1; j >= 0 && !(placed[j].x < x - GAP); j--) if (Math.hypot(placed[j].x - x, y - placed[j].y) < GAP) return true;
    return false;
  };
  if (!crowded(baseY)) return baseY;
  for (let step = 1; step <= 12; step++) {
    for (const dir of [-1, 1]) {
      const y = baseY + dir * step * GAP;
      if (y >= area.top + 5 && y <= area.bottom - 5 && !crowded(y)) return y;
    }
  }
  return baseY;
}
function ssDrawMarker(cx, x, y, st, hovered, stroke) {
  const r = hovered ? 7 : 5;
  cx.beginPath();
  if (st.shape === 'hexagon') {   // 꼭짓점이 위로 오는 육각형
    for (let k = 0; k < 6; k++) { const ang = (k * 60 - 90) * Math.PI / 180; cx[k ? 'lineTo' : 'moveTo'](x + r * Math.cos(ang), y + r * Math.sin(ang)); }
    cx.closePath();
  }
  else if (st.shape === 'diamond') { [[0, -r], [r, 0], [0, r], [-r, 0]].forEach(([dx, dy], k) => cx[k ? 'lineTo' : 'moveTo'](x + dx, y + dy)); cx.closePath(); }
  else if (st.shape === 'square') { const h = r * 0.8; cx.rect(x - h, y - h, 2 * h, 2 * h); }
  else cx.arc(x, y, r, 0, Math.PI * 2);
  cx.fillStyle = st.color;
  cx.lineWidth = hovered ? 3 : 2.5;
  cx.strokeStyle = stroke || (hovered ? '#383874' : 'rgba(255,255,255,0.9)');
  cx.fill(); cx.stroke();
}

// ── 구간 선택 (끌기) ──
const SR = { a: null, b: null, drag: false, raf: null, map: null };
const ssHasRange = () => SR.a != null && SR.b != null && !SR.drag ? true : SR.a != null && SR.b != null;
function ssRangeChange(lo, hi) {
  const out = {};
  if (!ssChart) return out;
  ssChart.data.datasets.forEach((ds) => { if (!ds || ds.hidden) return; const d = ssDayChange(ds.data[hi], ds.data[lo]); if (d) out[ds._key] = d; });
  return out;
}
function ssClearRange() {
  if (SR.a == null && !SR.drag) return;
  SR.a = SR.b = null; SR.drag = false; SR.map = null; S.pin = null;
  ssLegend.render();
  if (ssChart) ssChart.update('none');
  ssSyncHash();
}
function ssPinRange(from, to) {
  if (!ssChart) return false;
  const L = ssChart.data.labels, i1 = L.indexOf(from), i2 = L.indexOf(to);
  if (i1 < 0 || i2 < 0) return false;
  SR.a = i1; SR.b = i2; SR.drag = false;
  SR.map = ssRangeChange(Math.min(i1, i2), Math.max(i1, i2));
  S.pin = [L[Math.min(i1, i2)], L[Math.max(i1, i2)]];
  ssLegend.render(); ssChart.update('none');
  return true;
}
// 구간 숫자: 세 자리 유효숫자 고정 (표처럼 줄이 맞게)
function ssSig(v, n) { if (!v) return 0; const m = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(v)))); return Math.round(v * m) / m; }
function ssSigDigits(v, n) { if (!v) return (0).toFixed(n - 1); const r = ssSig(v, n); return r.toFixed(Math.max(0, n - Math.floor(Math.log10(Math.abs(r))) - 1)); }
function ssRangeMoney(v, n) {
  n = n || 3;
  const sign = v < 0 ? '-' : '', a = ssSig(Math.abs(v), n);
  const u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']].find((x) => a >= x[0]);
  return u ? sign + '$' + ssSigDigits(a / u[0], n) + u[1] : sign + '$' + ssSigDigits(a, n);
}
function ssRangeMoneyPair(a, b) { for (let n = 3; n < 6; n++) { const x = ssRangeMoney(a, n), y = ssRangeMoney(b, n); if (x !== y || a === b) return [x, y]; } return [ssRangeMoney(a, 5), ssRangeMoney(b, 5)]; }
function ssRangeDuration(a, b) {
  const f = new Date(a + 'T00:00:00Z'), t = new Date(b + 'T00:00:00Z');
  let y = t.getUTCFullYear() - f.getUTCFullYear(), m = t.getUTCMonth() - f.getUTCMonth();
  if (t.getUTCDate() < f.getUTCDate()) m--;
  if (m < 0) { y--; m += 12; }
  if (y > 0) return m > 0 ? y + '년 ' + m + '개월' : y + '년';
  if (m > 0) return m + '개월';
  const days = Math.round((t - f) / 86400000), w = Math.floor(days / 7);
  return w > 0 ? w + '주' : Math.max(days, 0) + '일';
}

// ── 마우스·탭 상태 ──
const SM = { list: [], hover: null };   // 그린 거래 표시 (적중 상자) · 마우스가 올라간 표시 키
const ssIsTouch = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
let ssTipPinned = false;

// 선 끝 이름표 (오른쪽 여백 = 가장 긴 이름표 폭)
function ssDayDeltaFor(ds, today) {
  if (ds._sub) return null;
  const y = R.yday[ds._key];
  return y != null ? ssDayChange(today, y) : null;
}
const ssDeltaText = (d) => { const s = d.pct >= 0 ? '+' : ''; return '(' + s + d.pct.toFixed(1) + '% · ' + s + ssMoney(d.abs) + ')'; };
const ssEndLabels = {
  id: 'ssEndLabels',
  beforeLayout(c) {
    const last = c.data.labels.length - 1;
    if (last < 0) return;
    const cx = c.ctx, compact = window.innerWidth <= 600;
    let maxW = 0;
    c.data.datasets.forEach((ds) => {
      if (ds.hidden) return;
      const v = ds.data[last];
      if (typeof v !== 'number' || !isFinite(v)) return;
      cx.font = (compact ? '600 8px ' : '600 9px ') + SS_SANS;
      maxW = Math.max(maxW, cx.measureText((ds.label || '').toUpperCase()).width);
      if (!compact) {
        cx.font = '500 11px ' + SS_MONO;
        let w = cx.measureText(ssMoney(Math.round(v))).width;
        if (R.ctx && R.ctx.latest) { const d = ssDayDeltaFor(ds, v); if (d) { cx.font = '600 9px ' + SS_MONO; w += 5 + cx.measureText(ssDeltaText(d)).width; } }
        maxW = Math.max(maxW, w);
      }
    });
    if (!maxW) return;
    c.options.layout.padding.right = compact ? Math.max(40, Math.min(130, Math.round(maxW) + 12)) : Math.max(100, Math.min(260, Math.round(maxW) + 16));
  },
  afterDraw(c) {
    const area = c.chartArea, cx = c.ctx;
    if (!area) return;
    const infl = document.getElementById('ss-infl');
    if (infl) { const bx = Math.round(area.left + 4), by = Math.round(area.top + 4); if (infl._lx !== bx || infl._ly !== by) { infl.style.left = bx + 'px'; infl.style.top = by + 'px'; infl._lx = bx; infl._ly = by; } }
    const compact = window.innerWidth <= 600, last = c.data.labels.length - 1;
    if (last < 0) return;
    const ys = c.scales.y;
    const items = c.data.datasets.map((ds, i) => {
      if (ds.hidden) return null;
      const pt = c.getDatasetMeta(i).data[last];
      if (!pt) return null;
      const v = ds.data[last];
      let y = pt.y;
      if (ys && typeof v === 'number' && isFinite(v) && !(ys.type === 'logarithmic' && v <= 0)) { const py = ys.getPixelForValue(v); if (isFinite(py)) y = py; }
      return { y, oy: y, ds, color: typeof ds.borderColor === 'string' ? ds.borderColor : '#7a7aa6', name: ds.label || '', v };
    }).filter(Boolean);
    // 끝 라벨 쌓기: 위에서부터 gap 간격으로 밀어 내리고 → 아래 끝을 넘친 만큼 거꾸로 올리고 → 그림 영역 안으로
    items.sort((a, b) => a.y - b.y);
    const gap = compact ? 13 : 26, n = items.length;
    for (let k = 1; k < n; k++) items[k].y = Math.max(items[k].y, items[k - 1].y + gap);
    for (let k = n - 1; k >= 0; k--) items[k].y = Math.min(items[k].y, area.bottom - 5 - (n - 1 - k) * gap);
    for (const it of items) it.y = Math.min(area.bottom - 5, Math.max(area.top + 10, it.y));
    cx.save();
    const x = area.right + 8, ak = ssActiveKey();
    for (const it of items) {
      // 라벨 → 선 끝 점까지 점선 이끔선 · 끝 점(패널이 열린 선은 크게)
      const tipR = it.ds._key === ak ? 5 : 3, endX = area.right;
      cx.setLineDash([2, 2]); cx.lineWidth = 1; cx.strokeStyle = it.color; cx.fillStyle = it.color;
      cx.beginPath(); cx.moveTo(x - 2, it.y); cx.lineTo(endX, it.oy); cx.stroke();
      cx.setLineDash([]);
      cx.beginPath(); cx.arc(endX, it.oy, tipR, 0, 2 * Math.PI); cx.fill();
      if (compact) {
        cx.font = '600 8px ' + SS_SANS; cx.fillStyle = it.color; cx.globalAlpha = 0.9; cx.textBaseline = 'middle';
        cx.fillText(it.name.toUpperCase(), x, it.y); cx.globalAlpha = 1;
        continue;
      }
      cx.font = '600 9px ' + SS_SANS; cx.fillStyle = it.color; cx.globalAlpha = 0.9; cx.textBaseline = 'bottom';
      cx.fillText(it.name.toUpperCase(), x, it.y - 1); cx.globalAlpha = 1;
      cx.font = '500 11px ' + SS_MONO; cx.textBaseline = 'top';
      const vs = ssMoney(Math.round(it.v));
      cx.fillText(vs, x, it.y + 1);
      if (R.ctx && R.ctx.latest) {
        const d = ssDayDeltaFor(it.ds, it.v);
        if (d) { const w = cx.measureText(vs).width; cx.font = '600 9px ' + SS_MONO; cx.fillStyle = d.pct >= 0 ? SS_UP : SS_DOWN; cx.fillText(ssDeltaText(d), x + w + 5, it.y + 2); }
      }
    }
    cx.restore();
  },
};

// 패널이 열린 이동평균·사용자 전략: 거래 단위 상세선 + 거래 표시
const ssMarkers = {
  id: 'ssMarkers',
  afterDatasetsDraw(c) {
    SM.list = [];
    if (!ssPanel.open || !S.editing) return;
    const cfg = ssFindCfg(S.editing);
    if (!cfg || (cfg.type !== 'sma' && cfg.type !== 'custom')) return;
    const ti = c.data.datasets.findIndex((d) => d._key === 'cfg:' + cfg.id);
    if (ti < 0 || c.data.datasets[ti].hidden) return;
    const ds = c.data.datasets[ti], labs = c.data.labels, xs = c.scales.x, ys = c.scales.y, area = c.chartArea, cx = c.ctx;
    const sim = R.cfgSim[cfg.id];
    const log = cfg.type === 'sma' ? (sim && sim.log) || [] : R.customLogs[cfg.id] || [];
    if (!log.length || !labs.length) return;
    const valOf = cfg.type === 'sma' ? (ev) => ev.total : (r) => +r.value;
    cx.save();
    const pts = [];
    for (let i = 0; i < labs.length; i++) if (ds.data[i] != null) pts.push({ x: xs.getPixelForValue(i), v: ds.data[i] });
    for (const ev of log) { const v = valOf(ev); if (v > 0 && ev.date != null) pts.push({ x: ssXForDate(c, ev.date), v: v * ssInflFactor(ev.date, labs[0]) }); }
    pts.sort((a, b) => a.x - b.x);
    if (pts.length > 1) {
      cx.beginPath(); cx.moveTo(pts[0].x, ys.getPixelForValue(pts[0].v));
      for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k].x, ys.getPixelForValue(pts[k].v));
      cx.strokeStyle = ds._color; cx.lineWidth = (ds._baseW || 2) * 2; cx.lineJoin = 'round'; cx.stroke();
    }
    const placed = [];
    let hov = null;
    const evs = cfg.type === 'sma'
      ? log.map((ev, i) => ({ i, row: ev, st: SS_EVT[ev.action] })).filter((e) => e.st && e.row.total > 0)
      : ssCustomEvents(log);
    for (const ev of evs) {
      const px = ssXForDate(c, ev.row.date);
      if (px < area.left - 2 || px > area.right + 2) continue;
      const by = ys.getPixelForValue(valOf(ev.row) * ssInflFactor(ev.row.date, labs[0]));
      if (!(by >= area.top - 2 && by <= area.bottom + 2)) continue;
      const py = ssSpreadY(placed, px, by, area);
      const key = String(ev.i);
      const isSell = cfg.type === 'sma' ? (ev.row.action === 'EXIT' || ev.row.action === 'BG-GTFO') : ssCustomKind(ev.row.action) === 'sell';
      const stroke = ssAssetStroke(ssMarkerAsset(log, ev.i, isSell));
      if (key === SM.hover) hov = { px, py, st: ev.st, stroke }; else ssDrawMarker(cx, px, py, ev.st, false, stroke);
      SM.list.push({ x: px, y: py, key, i: ev.i, row: ev.row, st: ev.st, stroke, kind: cfg.type, cfgId: cfg.id });
      placed.push({ x: px, y: py });
    }
    if (hov) ssDrawMarker(cx, hov.px, hov.py, hov.st, true, hov.stroke);
    cx.restore();
  },
};

// 끌어서 고른 구간: 음영 + 날짜 + 기간 + 선마다 시작·끝 원과 수익률
const ssRangePlugin = {
  id: 'ssRange',
  afterDraw(c) {
    if (SR.a == null || SR.b == null) return;
    const area = c.chartArea;
    if (!area) return;
    const T = ssTheme(), xs = c.scales.x, lo = Math.min(SR.a, SR.b), hi = Math.max(SR.a, SR.b);
    const x1 = xs.getPixelForValue(lo), x2 = xs.getPixelForValue(hi), cx = c.ctx;
    cx.save();
    cx.fillStyle = 'rgba(49,130,246,0.12)';
    cx.fillRect(Math.min(x1, x2), area.top, Math.abs(x2 - x1) || 1, area.bottom - area.top);
    cx.strokeStyle = 'rgba(49,130,246,0.55)'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(x1, area.top); cx.lineTo(x1, area.bottom); cx.moveTo(x2, area.top); cx.lineTo(x2, area.bottom); cx.stroke();
    const pill = (txt, cxp, cyp, font, w, h, border, color) => {
      cx.fillStyle = T.pill; cx.strokeStyle = border; cx.lineWidth = 1;
      cx.beginPath(); if (cx.roundRect) cx.roundRect(cxp - w / 2, cyp - h / 2, w, h, 6); else cx.rect(cxp - w / 2, cyp - h / 2, w, h); cx.fill(); cx.stroke();
      cx.fillStyle = color; cx.font = font; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(txt, cxp, cyp + 1);
    };
    cx.font = '600 9px ' + SS_MONO;
    const H = 15, Y = area.top + 8, PX = 5, GAP = 4;
    const sl = ssDate(c.data.labels[lo]), el = ssDate(c.data.labels[hi]);
    const sw = cx.measureText(sl).width + PX * 2, ew = cx.measureText(el).width + PX * 2;
    let sx = x1, ex = x2;
    if (x1 + sw / 2 + GAP > x2 - ew / 2) { const mid = (x1 + x2) / 2; sx = mid - GAP / 2 - sw / 2; ex = mid + GAP / 2 + ew / 2; }
    pill(sl, sx, Y, '600 9px ' + SS_MONO, sw, H, 'rgba(49,130,246,0.6)', T.accent);
    pill(el, ex, Y, '600 9px ' + SS_MONO, ew, H, 'rgba(49,130,246,0.6)', T.accent);
    const dur = ssRangeDuration(c.data.labels[lo], c.data.labels[hi]);
    cx.font = '600 9px ' + SS_SANS;
    pill(dur, (x1 + x2) / 2, Y + H + 8, '600 9px ' + SS_SANS, cx.measureText(dur).width + PX * 2, H, 'rgba(49,130,246,0.6)', T.accent);
    cx.restore();
    const map = SR.map, ys = c.scales.y;
    if (!map || !ys) return;
    cx.save();
    const mx = (x1 + x2) / 2, items = [];
    const PF = '700 10px ' + SS_MONO, RF = '600 8px ' + SS_MONO;
    for (const ds of c.data.datasets) {
      const d = map[ds._key];
      if (!d || ds.hidden) continue;
      const v1 = ds.data[lo], v2 = ds.data[hi];
      if (typeof v1 !== 'number' || !isFinite(v1) || typeof v2 !== 'number' || !isFinite(v2)) continue;
      const p1 = ys.getPixelForValue(v1), p2 = ys.getPixelForValue(v2);
      if (!isFinite(p1) || !isFinite(p2)) continue;
      const col = typeof ds.borderColor === 'string' ? ds.borderColor : '#7a7aa6';
      cx.strokeStyle = col; cx.lineWidth = 1.5; cx.setLineDash([4, 3]);
      cx.beginPath(); cx.moveTo(x1, p1); cx.lineTo(x2, p2); cx.stroke(); cx.setLineDash([]);
      for (const [px, py] of [[x1, p1], [x2, p2]]) { cx.beginPath(); cx.arc(px, py, 4, 0, Math.PI * 2); cx.fillStyle = col; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = T.bg; cx.stroke(); }
      const sg = d.pct >= 0 ? '+' : '-';
      const pt = sg + ssSigDigits(Math.abs(d.pct), 3) + '%';
      const [fa, fb] = ssRangeMoneyPair(v1, v2);
      const rt = ' (' + fa + ' → ' + fb + ', ' + sg + ssRangeMoney(Math.abs(d.abs)) + ')';
      cx.font = PF; const pw = cx.measureText(pt).width;
      cx.font = RF; const rw = cx.measureText(rt).width;
      items.push({ my: (p1 + p2) / 2, pt, pw, rt, rw, col, pos: d.pct >= 0 });
    }
    const LH = 14, LG = LH + 2;
    items.sort((a, b) => a.my - b.my);
    for (let k = 1; k < items.length; k++) if (items[k].my - items[k - 1].my < LG) items[k].my = items[k - 1].my + LG;
    for (let k = items.length - 1; k >= 0; k--) { const m = area.bottom - 5 - (items.length - 1 - k) * LG; if (items[k].my > m) items[k].my = m; }
    const pcw = Math.max(0, ...items.map((i) => i.pw)), rcw = Math.max(0, ...items.map((i) => i.rw)), tw = pcw + rcw;
    for (const it of items) {
      cx.fillStyle = T.pill; cx.strokeStyle = it.col; cx.lineWidth = 1;
      cx.beginPath(); if (cx.roundRect) cx.roundRect(mx - tw / 2 - 4, it.my - LH / 2, tw + 8, LH, 6); else cx.rect(mx - tw / 2 - 4, it.my - LH / 2, tw + 8, LH); cx.fill(); cx.stroke();
      cx.fillStyle = it.pos ? SS_UP : SS_DOWN; cx.textBaseline = 'middle';
      cx.textAlign = 'right'; cx.font = PF; cx.fillText(it.pt, mx - tw / 2 + pcw, it.my + 1);
      cx.textAlign = 'left'; cx.font = RF; cx.fillText(it.rt, mx - tw / 2 + pcw, it.my + 1);
    }
    cx.restore();
  },
};

// 마우스 풍선: 보이는 선마다 카드(값 큰 순 · 막대 = 값/최대) + 점까지 이끔선 + 아래 날짜 칩
function ssExternalTip(context) {
  const c = context.chart, tip = context.tooltip, el = document.getElementById('ss-tip');
  if (!el) return;
  if (SM.hover !== null) { el.style.display = 'none'; return; }
  if (SR.drag || (SR.a != null && SR.b != null)) { el.style.display = 'none'; return; }
  if (tip.opacity === 0) { if (ssIsTouch() && ssTipPinned) return; el.style.display = 'none'; return; }
  if (ssIsTouch()) ssTipPinned = true;
  const idx = tip.dataPoints && tip.dataPoints[0] ? tip.dataPoints[0].dataIndex : null;
  if (idx == null) return;
  const date = c.data.labels[idx];
  const items = [];   // 보이는 선만, 값 큰 순
  c.data.datasets.forEach((d, i) => {
    const v = d.data ? d.data[idx] : null;
    if (d.hidden || v == null || Number.isNaN(v)) return;
    items.push({ i, n: d.label, v, col: typeof d.borderColor === 'string' ? d._color || d.borderColor : '#7a7aa6', dash: d.borderDash || null });
  });
  items.sort((a, b) => b.v - a.v);
  const maxV = Math.max(0, ...items.map((it) => it.v));
  const host = el.parentElement, hr = host.getBoundingClientRect(), cr = c.canvas.getBoundingClientRect();
  const tx = (x) => x + cr.left - hr.left, ty = (y) => y + cr.top - hr.top;
  const hx = tx(tip.caretX), aTop = ty(c.chartArea.top), aBot = ty(c.chartArea.bottom);
  const cards = items.map((it) => {
    const pct = maxV > 0 ? Math.max(0, it.v / maxV * 100) : 0;
    const sample = '<svg width="20" height="4" style="flex-shrink:0;overflow:visible"><line x1="0" y1="2" x2="20" y2="2" stroke="' + it.col + '" stroke-width="2" stroke-linecap="round"' + (it.dash ? ' stroke-dasharray="' + it.dash.join(',') + '"' : '') + '/></svg>';
    const py = ty(c.getDatasetMeta(it.i).data[idx].y);
    return { html: '<div class="ss-ttc"><div class="ss-ttf" style="width:' + pct + '%;background:' + ssWithAlpha(it.col, 0.2) + '"></div><div class="ss-ttr"><div class="ss-ttl">' + sample + '<span class="ss-ttn" title="' + ssEsc(it.n) + '">' + ssEsc(it.n) + '</span></div><span class="ss-ttv">' + ssMoney(Math.round(it.v)) + '</span></div></div>', py, col: it.col };
  });
  const dl = c._grain === 'quarterly' ? ssQLabel(date) : ssDate(date);
  el.innerHTML = '<svg class="ss-ttlead" width="' + hr.width + '" height="' + hr.height + '"></svg><div class="ss-ttdate">' + dl + '<button class="ss-ttx" type="button" aria-label="닫기" data-tt-close>&times;</button></div>' + cards.map((x) => x.html).join('');
  el.style.display = 'block';
  const ce = Array.from(el.querySelectorAll('.ss-ttc'));
  const nat = Math.ceil(Math.max(0, ...ce.map((x) => x.getBoundingClientRect().width)));
  const cw = Math.min(320, nat);
  ce.forEach((x) => { x.style.width = cw + 'px'; });
  const ch = ce[0] ? ce[0].offsetHeight : 0;
  let left = hx + 16;
  if (left + cw > hr.width - 8) left = hx - 16 - cw;
  if (left < 8) left = 8;
  // 카드 쌓기: 점 높이 순으로 겹치지 않게 내려 놓고 → 아래 끝에서 거꾸로 올리고 → 위로 넘치면 전체를 내림
  const step = ch + 4;
  const order = cards.map((x, k) => ({ k, top: x.py - ch / 2 })).sort((a, b) => a.top - b.top);
  for (let j = 1; j < order.length; j++) order[j].top = Math.max(order[j].top, order[j - 1].top + step);
  let floor = aBot - ch;
  for (let j = order.length - 1; j >= 0; j--) { order[j].top = Math.min(order[j].top, floor); floor = order[j].top - step; }
  const over = order.length ? aTop - order[0].top : 0;
  if (over > 0) order.forEach((o) => { o.top += over; });
  const lead = el.querySelector('.ss-ttlead'), ax = left > hx ? left : left + cw;
  order.forEach(({ k, top }) => {
    ce[k].style.left = left + 'px'; ce[k].style.top = top + 'px';
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', hx); ln.setAttribute('y1', cards[k].py); ln.setAttribute('x2', ax); ln.setAttribute('y2', top + ch / 2); ln.setAttribute('stroke', cards[k].col);
    lead.appendChild(ln);
  });
  const chip = el.querySelector('.ss-ttdate'), w = chip.offsetWidth;
  chip.style.left = Math.max(8, Math.min(hr.width - w - 8, hx - w / 2)) + 'px';
  chip.style.top = (aBot + 4) + 'px';
}

// 거래 표시 풍선
function ssMarkerShape(shape, color, stroke) {
  const inner = { hexagon: '<polygon points="7,1 12.2,4 12.2,10 7,13 1.8,10 1.8,4"/>', diamond: '<polygon points="7,1 13,7 7,13 1,7"/>', square: '<rect x="2" y="2" width="10" height="10" rx="1.5"/>' }[shape] || '<circle cx="7" cy="7" r="5.5"/>';
  return '<svg viewBox="0 0 14 14" width="15" height="15" style="fill:' + color + ';stroke:' + (stroke || 'rgba(56,56,116,0.35)') + ';stroke-width:' + (stroke ? 1.6 : 1) + '">' + inner + '</svg>';
}
const SS_ICON = {
  trendUp: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  deposit: '<path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="21" x2="20" y2="21"/>',
  tag: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
};
const ssIco = (p, cls) => '<svg class="' + (cls || 'ss-mi') + '" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
function ssGainPill(g) { return g == null ? '' : '<span class="ss-mgain ' + (g >= 0 ? 'up' : 'dn') + '">' + (g >= 0 ? '▲ ' : '▼ ') + Math.abs(g).toFixed(1) + '%</span>'; }
function ssMarkerTipHtml(m) {
  const L = R.labels, f = ssInflFactor(m.row.date, L[0]);
  const row = (ico, k, v, strong) => '<div class="ss-mrow' + (strong ? ' strong' : '') + '"><span class="ss-mk">' + ssIco(ico) + k + '</span><b>' + v + '</b></div>';
  if (m.kind === 'sma') {
    const sim = R.cfgSim[m.cfgId], log = (sim && sim.log) || [], cfg = ssFindCfg(m.cfgId);
    const info = ssSmaRowInfo(log, m.i, String((cfg && cfg.params.ul) || 'tqqq').toUpperCase());
    const ev = m.row, held = String(ev.held || ev.state || '').toUpperCase();
    const total = Math.round((ev.total || 0) * f), inv = Math.round((ev.invested || 0) * f), pr = total - inv;
    return '<div class="ss-mhead"><span>' + ssMarkerShape(m.st.shape, m.st.color, m.stroke) + '</span><div class="ss-mht"><div class="ss-mtitle" style="color:' + m.st.color + '">' + ssEsc(info.label) + '</div><div class="ss-msub">#' + m.i + ' · ' + ssDate(ev.date) + '</div></div>' + ssGainPill(info.gain) + '</div>'
      + '<div class="ss-mrows">' + row(SS_ICON.box, '보유', ssEsc(held)) + row(SS_ICON.dollar, '평가액', ssMoney(total), true) + row(SS_ICON.deposit, '넣은 돈', ssMoney(inv))
      + row(pr >= 0 ? SS_ICON.trendUp : SS_ICON.trendDown, '수익', '<span class="' + (pr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pr >= 0 ? '+' : '−') + ssMoney(Math.abs(pr)) + '</span>') + '</div>';
  }
  const r = m.row, log = R.customLogs[m.cfgId] || [], g = ssCustomGain(log, m.i), num = (v) => (Number.isFinite(+v) ? +v : null);
  const total = num(r.value) != null ? Math.round(num(r.value) * f) : null, inv = num(r.invested) != null ? Math.round(num(r.invested) * f) : null;
  const cash = num(r.cash) != null ? Math.round(num(r.cash) * f) : null, price = num(r.price);
  const rows = [];
  if (r.held != null && r.held !== '') rows.push(row(SS_ICON.box, '보유', ssEsc(String(r.held).toUpperCase())));
  if (price != null && price > 0) rows.push(row(SS_ICON.tag, '가격', ssLogPrice(price)));
  if (total != null) rows.push(row(SS_ICON.dollar, '평가액', ssMoney(total), true));
  if (cash != null && cash > 0) rows.push(row(SS_ICON.dollar, '현금', ssMoney(cash)));
  if (inv != null) {
    rows.push(row(SS_ICON.deposit, '넣은 돈', ssMoney(inv)));
    if (total != null) { const pr = total - inv; rows.push(row(pr >= 0 ? SS_ICON.trendUp : SS_ICON.trendDown, '수익', '<span class="' + (pr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pr >= 0 ? '+' : '−') + ssMoney(Math.abs(pr)) + '</span>')); }
  }
  const note = r.note != null && r.note !== '' ? '<div class="ss-mnote">' + ssEsc(String(r.note)) + '</div>' : '';
  return '<div class="ss-mhead"><span>' + ssMarkerShape(m.st.shape, m.st.color, m.stroke) + '</span><div class="ss-mht"><div class="ss-mtitle" style="color:' + m.st.color + '">' + ssEsc(ssCustomLabel(r.action)) + '</div><div class="ss-msub">#' + m.i + ' · ' + ssDate(r.date) + '</div></div>' + ssGainPill(g) + '</div><div class="ss-mrows">' + rows.join('') + '</div>' + note;
}
function ssShowMarkerTip(m) {
  const tt = document.getElementById('ss-mtip');
  if (!tt || !ssChart) return;
  const lt = document.getElementById('ss-tip');
  if (lt) lt.style.display = 'none';
  const r = ssChart.canvas.getBoundingClientRect();
  tt.innerHTML = ssMarkerTipHtml(m);
  tt.style.display = 'block';
  const w = tt.offsetWidth || 180, h = tt.offsetHeight || 80;
  let left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + m.x - w / 2));
  let top = r.top + m.y - h - 12;
  if (top < 8) top = r.top + m.y + 14;
  tt.style.left = left + 'px'; tt.style.top = top + 'px';
}
function ssHideMarkerTip() { const tt = document.getElementById('ss-mtip'); if (tt) tt.style.display = 'none'; }
function ssSetMarkerHover(key) {
  if (SM.hover === key) return;
  SM.hover = key;
  if (ssChart) ssChart.draw();
  if (key == null) { ssHideMarkerTip(); return; }
  const m = SM.list.find((x) => x.key === key);
  if (m) ssShowMarkerTip(m); else ssHideMarkerTip();
}

// ── 차트 만들기 / 고치기 ──
function ssChartUpdate() {
  const canvas = document.getElementById('ss-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  const T = ssTheme();
  ssApplyEmphasis();
  if (!ssChart) {
    ssChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      plugins: [ssEndLabels, ssMarkers, ssRangePlugin],
      data: { labels: R.labels, datasets: R.datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: window.innerWidth <= 600 ? 50 : 140, left: 26, bottom: 12 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false, external: ssExternalTip } },
        scales: {
          x: { ticks: { font: { size: 10, family: SS_MONO }, maxTicksLimit: window.innerWidth <= 600 ? 6 : 10, maxRotation: 0, callback: function (v) { const d = this.getLabelForValue(v); return d ? d.slice(0, 7) : ''; } } },
          y: { ticks: { font: { family: SS_MONO, size: 10 }, maxTicksLimit: SS_Y_TICKS, callback: (v) => ssMoneyAxis(v) },
            afterBuildTicks: (scale) => {
              if (!S.log) return;
              scale.ticks = scale.ticks.filter((t) => { const v = t.value; if (v <= 0) return false; const m = v / Math.pow(10, Math.floor(Math.log10(v))); return Math.abs(m - 1) < 0.05 || Math.abs(m - 2) < 0.05 || Math.abs(m - 5) < 0.05; });
              if (scale.ticks.length > SS_Y_TICKS) { const src = scale.ticks, out = []; for (let k = 0; k < SS_Y_TICKS; k++) out.push(src[Math.round(k * (src.length - 1) / (SS_Y_TICKS - 1))]); scale.ticks = out.filter((t, k, a) => a.indexOf(t) === k); }
            } },
        },
      },
    });
    ssWireChart();
    const ld = document.getElementById('ss-loading');
    if (ld) ld.hidden = true;
  }
  const ch = ssChart;
  ch._grain = R.ctx ? R.ctx.grain : 'quarterly';
  ch.data.labels = R.labels;
  ch.data.datasets = R.datasets;
  for (const ax of ['x', 'y']) {
    const o = ch.options.scales[ax];
    o.ticks.color = T.text3;
    o.grid = { color: T.grid };
    o.border = { color: T.border };
  }
  ch.options.scales.y.type = S.log ? 'logarithmic' : 'linear';
  ch.options.scales.y.beginAtZero = !S.log;
  ch.options.scales.y.min = S.log ? undefined : 0;
  ch.update('none');
  if (SR.a != null && SR.b != null) {   // 라벨이 바뀌면 고정 구간을 날짜로 다시 찾음
    if (S.pin) { const L = ch.data.labels, i1 = L.indexOf(S.pin[0]), i2 = L.indexOf(S.pin[1]); if (i1 >= 0 && i2 >= 0) { SR.a = i1; SR.b = i2; SR.map = ssRangeChange(Math.min(i1, i2), Math.max(i1, i2)); } else { SR.a = SR.b = null; SR.map = null; S.pin = null; } }
    else if (!SR.drag) { SR.a = SR.b = null; SR.map = null; }
    ch.update('none');
  }
}

function ssWireChart() {
  const ch = ssChart, cv = ch.canvas;
  cv.addEventListener('mousemove', (e) => {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let hit = null, best = 11;
    for (const m of SM.list) { const d = Math.hypot(mx - m.x, my - m.y); if (d < best) { best = d; hit = m; } }
    const k = hit ? hit.key : null;
    if (k !== SM.hover) { SM.hover = k; ch.draw(); }
    if (hit) ssShowMarkerTip(hit); else ssHideMarkerTip();
  });
  cv.addEventListener('mouseleave', () => { ssHideMarkerTip(); if (SM.hover !== null) { SM.hover = null; ch.draw(); } });
  // 끌어서 구간 고르기 (마우스) — 놓으면 사라짐, Shift 를 누른 채 놓으면 고정
  cv.addEventListener('mousedown', (e) => {
    if (ssIsTouch() || !ch.chartArea) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, a = ch.chartArea;
    if (mx < a.left || mx > a.right || my < a.top || my > a.bottom) return;
    SR.drag = true; S.pin = null;
    SR.a = SR.b = ssIndexForPixel(ch, mx);
  });
  const live = () => {
    if (SR.raf) return;
    SR.raf = requestAnimationFrame(() => {
      SR.raf = null;
      if (SR.a == null || SR.b == null) return;
      SR.map = ssRangeChange(Math.min(SR.a, SR.b), Math.max(SR.a, SR.b));
      ssLegend.render(); ch.update('none');
    });
  };
  document.addEventListener('mousemove', (e) => {
    if (!SR.drag || !ch.chartArea) return;
    const r = cv.getBoundingClientRect(), a = ch.chartArea;
    SR.b = ssIndexForPixel(ch, Math.max(a.left, Math.min(a.right, e.clientX - r.left)));
    live();
  });
  document.addEventListener('mouseup', (e) => {
    if (!SR.drag) return;
    SR.drag = false;
    if (SR.a === SR.b) { ssClearRange(); return; }
    if (e.shiftKey) {
      const lo = Math.min(SR.a, SR.b), hi = Math.max(SR.a, SR.b);
      SR.map = ssRangeChange(lo, hi);
      S.pin = [ch.data.labels[lo], ch.data.labels[hi]];
      ssLegend.render(); ch.update('none'); ssSyncHash();
      return;
    }
    ssClearRange();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (SR.a != null || SR.drag)) ssClearRange(); });
  document.addEventListener('click', (e) => {
    if (SR.a == null || SR.drag) return;
    if (e.target.closest && (e.target.closest('#ss-chart') || e.target.closest('[data-ss-share]') || e.target.closest('.dsh-fab, .dsh-pop'))) return;
    ssClearRange();
  });
  // 풍선 닫기 (터치 기기는 고정 · × 또는 바깥 탭)
  const tt = document.getElementById('ss-tip');
  if (tt) tt.addEventListener('click', (e) => { if (e.target.closest('[data-tt-close]')) { ssTipPinned = false; tt.style.display = 'none'; } });
  document.addEventListener('click', (e) => {
    if (!ssIsTouch() || !ssTipPinned) return;
    if (e.target.closest('#ss-tip') || e.target.closest('#ss-chart')) return;
    ssTipPinned = false; if (tt) tt.style.display = 'none';
  });
  // 테마가 바뀌면 축 색을 다시
  new MutationObserver(() => { if (ssChart) ssChartUpdate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// ── 범례 칩 (그냥 보유 · 현금 복리) ──
const ssLegend = {
  chip(key, name, color, hidden, m, more) {
    const rng = SR.map && SR.map[key];
    const pv = rng ? rng.pct : m && m.cagr;
    let mt = '';
    if (pv !== undefined && pv != null && Number.isFinite(pv)) {
      const dd = m && Number.isFinite(m.maxDD) ? '<div class="ss-lmr"><span class="ss-lml">낙폭</span><span class="ss-lmv ss-dn">' + ssDD(m.maxDD) + '</span>' + (ssDDRange(m.ddPeak, m.ddTrough) ? '<span class="ss-lmrange">' + ssDDRange(m.ddPeak, m.ddTrough) + '</span>' : '') + '</div>' : '';
      mt = '<div class="ss-lm"><div class="ss-lmr"><span class="ss-lml">' + (rng ? '구간' : '연평균') + '</span><span class="ss-lmv ' + (pv >= 0 ? 'ss-up' : 'ss-dn') + '">' + (pv >= 0 ? '+' : '') + pv.toFixed(1) + '%</span></div>' + dd + '</div>';
    }
    return '<div class="ss-chip' + (hidden ? ' off' : '') + '" data-lg="' + key + '" role="button" tabindex="0" title="눌러서 보이기/숨기기">'
      + ssEye(!hidden) + '<span class="ss-cdot" style="background:' + color + '"></span><span class="ss-cname">' + ssEsc(name) + '</span>' + mt
      + (more ? '<button type="button" class="ss-cmore" data-lg-more="' + key + '" aria-label="자세히 · 설정" title="자세히 · 설정"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="17 9 14 12 17 15"/></svg></button>' : '') + '</div>';
  },
  render() {
    const host = document.getElementById('ss-legend');
    if (!host) return;
    const M = R.metrics || {};
    const bhName = '그냥 보유 ' + String(ssBaseEff('bh').ul).toUpperCase();
    host.innerHTML = this.chip('bh', bhName, ssBaseColor('bh'), S.hide.bh, M.bh, true) + this.chip('invested', '현금 복리', ssBaseColor('invested'), S.hide.invested, M.invested, true);
  },
};
function ssEye(open) {
  return '<svg class="ss-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + (open
    ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>') + '</svg>';
}
// 가격·주수 서식 (표)
function ssLogPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '–';
  if (p >= 1000) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toPrecision(2);
}
function ssLogShares(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
