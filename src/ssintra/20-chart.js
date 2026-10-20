/* ── [STRATSIM-INTRA] 02 차트 (SVG) ─────────────────────────────────────
   날마다 경로(옅은 선 다발) · 평균(실선)·중앙값(점선) · 비슷한 날 비교 구간 · 지금 시각 · 매수/매도 표시 · 오늘(장중) 경로
   모든 시각은 뉴욕 '분'으로 계산하고, 글자로 보여 줄 때만 보는 사람 시간대로 옮김 (SC.offset) */

const SI_NS = 'http://www.w3.org/2000/svg';
const SC = {
  box: null, svg: null, g: {}, target: null,
  w: 0, h: 0, m: null, pw: 0, ph: 0, compact: false, x: null, y: null,
  yType: 'log', yLimit: 0,              // yLimit: 로그 눈금의 ±범위 — 모든 날로 한 번 정하고 줄이지 않음 (거르기로 축이 바뀌지 않게)
  data: [], aggs: [], marks: [], refId: null, cutoff: null, todayId: null, opacityCount: null,
  offset: 0, zone: '', lineLabelYs: [], paths: new Map(), geomKey: '', todayDrawn: false,
};

function siEl(tag, attrs, parent) {
  const e = document.createElementNS(SI_NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const siClear = (g) => { while (g.firstChild) g.removeChild(g.firstChild); };
const siReduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const siR = (v) => Math.round(v * 10) / 10;

let siMeasureCtx = null;
function siTextW(text, px, mono, bold) {
  if (!siMeasureCtx) siMeasureCtx = document.createElement('canvas').getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const fam = (mono ? cs.getPropertyValue('--mono') : cs.getPropertyValue('--font')) || 'sans-serif';
  siMeasureCtx.font = (bold ? '600 ' : '400 ') + px + 'px ' + fam;
  return siMeasureCtx.measureText(text).width;
}

function siChartInit(box) {
  SC.box = box;
  SC.svg = siEl('svg', { class: 'ssi-svg', role: 'img', 'aria-labelledby': 'ssi-svg-t' }, box);
  siEl('title', { id: 'ssi-svg-t' }, SC.svg);
  const plot = (SC.g.plot = siEl('g', { class: 'ssi-plot' }, SC.svg));
  ['grid', 'xaxis', 'yaxis', 'zero', 'match', 'days', 'hday', 'aggs', 'now', 'annot', 'today', 'hover'].forEach((k) => {
    SC.g[k] = siEl('g', { class: 'ssi-' + k }, plot);
  });
  SC.target = siEl('rect', { class: 'ssi-target', fill: 'transparent' }, plot);
}

function siLayout() {
  const w = Math.max(200, Math.floor(SC.box.clientWidth));
  const compact = w < 640;
  const m = compact ? { t: 10, r: 46, b: 28, l: 44 } : { t: 10, r: 108, b: 30, l: 52 };
  const vh = window.innerHeight || 800;
  const h = compact ? 440 : Math.round(Math.max(440, Math.min(640, vh - 330)));
  SC.w = w; SC.h = h; SC.m = m; SC.compact = compact;
  SC.pw = w - m.l - m.r; SC.ph = h - m.t - m.b;
  SC.svg.setAttribute('width', w); SC.svg.setAttribute('height', h);
  SC.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  SC.svg.classList.toggle('compact', compact);
  SC.g.plot.setAttribute('transform', `translate(${m.l},${m.t})`);
}

function siPathD(points, yv) {
  const x = SC.x, y = SC.y;
  let d = '', pen = false;
  for (const p of points) {
    const v = yv ? yv(p) : p.pct;
    if (v == null || !(v >= v)) { pen = false; continue; }
    d += (pen ? 'L' : 'M') + siR(x(p.minute)) + ',' + siR(y(v));
    pen = true;
  }
  return d;
}

function siRender() {
  if (!SC.svg) return;
  siLayout();
  const live = siIsLive(SC.data.find((d) => d.id === SC.todayId));
  SC.live = live;
  SC.x = siXScale(SC.pw);
  if (SC.yType === 'log') SC.y = siYScale('log', { limit: SC.yLimit }, SC.ph);
  else {
    let lo = Infinity, hi = -Infinity;
    for (const d of SC.data) for (const p of d.points) { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct; }
    if (!(lo <= hi)) lo = hi = 0;
    SC.y = siYScale('linear', { lo, hi }, SC.ph);
  }
  const key = [SC.pw, SC.ph, SC.yType, SC.y(0), SC.y.ticks.join()].join('|');
  if (key !== SC.geomKey) { SC.geomKey = key; SC.paths.forEach((p) => { p.dKey = ''; }); }
  siDrawAxes();
  siDrawDays(live);
  siDrawAggs();
  siDrawNow();
  siTodayLabelPlace(live);
  siDrawMarks(live);
  siDrawToday(live);
  siHoverReset();
  SC.target.setAttribute('width', Math.max(0, SC.pw));
  SC.target.setAttribute('height', Math.max(0, SC.ph));
  siAriaSummary();
}

function siDrawAxes() {
  const { x, y, pw, ph, offset } = SC;
  const g = SC.g.grid, gx = SC.g.xaxis, gy = SC.g.yaxis, gz = SC.g.zero;
  [g, gx, gy, gz].forEach(siClear);
  for (const t of y.ticks) {
    const py = siR(y(t));
    siEl('line', { x1: 0, x2: pw, y1: py, y2: py }, g);
    const tx = siEl('text', { x: -8, y: py, dy: '0.32em', 'text-anchor': 'end' }, gy);
    tx.textContent = siFmtAxisPct(t);
    siEl('line', { class: 'tick', x1: -5, x2: 0, y1: py, y2: py }, gy);
  }
  siEl('line', { class: 'dom', x1: 0, x2: 0, y1: 0, y2: ph }, gy);
  // 가로 눈금: 장 시작·마감 + 보는 사람 시각으로 딱 떨어지는 정시 · 글자가 겹치면 시작·마감을 남기고 사이 것을 뺌
  const hours = [];
  for (let m = SI_OPEN + 1; m < SI_CLOSE; m++) if ((((m + offset) % 60) + 60) % 60 === 0) hours.push(m);
  const ticks = [SI_OPEN].concat(hours, [SI_CLOSE]);
  siEl('line', { class: 'dom', x1: 0, x2: pw, y1: ph, y2: ph }, gx);
  const fs = SC.compact ? 10 : 11, room = (t) => siTextW(siFmtClock(t + offset), fs, true) + 8;
  const shown = new Set([SI_OPEN, SI_CLOSE]);
  let lastRight = x(SI_OPEN) + room(SI_OPEN) / 2;
  const endLeft = x(SI_CLOSE) - room(SI_CLOSE) / 2;
  for (const m of hours) {
    const half = room(m) / 2, px = x(m);
    if (px - half >= lastRight && px + half <= endLeft) { shown.add(m); lastRight = px + half; }
  }
  for (const m of ticks) {
    const px = siR(x(m));
    siEl('line', { class: 'tick', x1: px, x2: px, y1: ph, y2: ph + 5 }, gx);
    if (!shown.has(m)) continue;
    const tx = siEl('text', { x: px, y: ph + 8, dy: '0.71em', 'text-anchor': 'middle' }, gx);
    tx.textContent = siFmtClock(m + offset);
  }
  const pz = siR(y(0));
  siEl('line', { x1: 0, x2: pw, y1: pz, y2: pz }, gz);
}

function siDrawDays(live) {
  const { data, x, ph } = SC;
  const gm = SC.g.match;
  siClear(gm);
  if (SC.cutoff !== null) siEl('rect', { class: 'ssi-window', x: 0, y: 0, width: Math.max(0, siR(x(SC.cutoff))), height: ph }, gm);
  const faint = live ? data.filter((d) => d.id !== SC.todayId) : data;
  const op = siDayOpacity(SC.opacityCount != null ? SC.opacityCount : faint.length);
  SC.dayOpacity = op;
  const g = SC.g.days, keep = new Set();
  const frag = document.createDocumentFragment();
  for (const d of faint) {
    let p = SC.paths.get(d.id);
    if (!p || p.day !== d) {
      if (p && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      p = { el: siEl('path', { class: 'ssi-day' }), day: d, dKey: '' };
      SC.paths.set(d.id, p);
    }
    if (p.dKey !== SC.geomKey) { p.el.setAttribute('d', siPathD(d.points)); p.dKey = SC.geomKey; }
    const ref = live && d.id === SC.refId;
    p.el.setAttribute('class', ref ? 'ssi-day ref' : 'ssi-day');
    p.el.style.opacity = ref ? 1 : op;
    keep.add(d.id);
    frag.appendChild(p.el);
  }
  siClear(g);
  g.appendChild(frag);
  if (SC.paths.size > keep.size * 2 + 64) SC.paths.forEach((p, id) => { if (!keep.has(id)) SC.paths.delete(id); });
}

function siDrawAggs() {
  const { aggs, x, y } = SC;
  const g = SC.g.aggs;
  siClear(g);
  SC.lineLabelYs = [];
  if (!aggs.length) return;
  siEl('path', { class: 'ssi-median', d: siPathD(aggs, (a) => a.median) }, g);
  siEl('path', { class: 'ssi-mean', d: siPathD(aggs, (a) => a.mean) }, g);
  // 선 이름은 범례 대신 오른쪽 끝에 — 둘이 너무 가까우면 벌림
  const lastOf = (k) => { for (let i = aggs.length - 1; i >= 0; i--) if (aggs[i][k] != null) return aggs[i]; return null; };
  const lm = lastOf('mean'), ld = lastOf('median');
  if (!lm || !ld) return;
  const labels = [{ k: 'mean', t: '평균', y: y(lm.mean), x: x(lm.minute) }, { k: 'median', t: '중앙값', y: y(ld.median), x: x(ld.minute) }];
  const gap = labels[0].y - labels[1].y, MIN = 13;
  if (Math.abs(gap) < MIN) {
    const push = (MIN - Math.abs(gap)) / 2;
    labels[0].y += gap >= 0 ? push : -push;
    labels[1].y += gap >= 0 ? -push : push;
  }
  for (const l of labels) {
    const t = siEl('text', { class: 'ssi-lname ' + l.k, x: siR(l.x + 6), y: siR(l.y), dy: '0.35em' }, g);
    t.textContent = l.t;
  }
  SC.lineLabelYs = labels.map((l) => l.y);
}

// 지금 시각: 맨 위 짧은 눈금 (장이 열린 평일에만) — 30초마다 다시 그림
function siDrawNow() {
  const g = SC.g.now;
  if (!g) return;
  siClear(g);
  SC.nowBox = null;
  const minute = siMarketMinuteNow();
  if (minute === null || !SC.x) return;
  const px = siR(SC.x(minute)), near = px > SC.x(SI_CLOSE) - (SC.compact ? 70 : 120);
  siEl('line', { class: 'ssi-nowline', x1: px, x2: px, y1: 0, y2: siR(SC.ph * 0.05) }, g);
  const t = siEl('text', { class: 'ssi-nowlabel', x: px + (near ? -6 : 6), y: 12, 'text-anchor': near ? 'end' : 'start' }, g);
  t.textContent = '지금 ' + siFmtClock(minute + SC.offset) + (SC.compact ? '' : ' · ' + SC.zone);
  const w = siTextW(t.textContent, 10.5);
  SC.nowBox = { l: near ? px - 6 - w : px, r: near ? px : px + 6 + w, t: 0, b: 16 };     // 매수·매도 상자가 피해 갈 자리
}

// 오늘(장중) 경로: 맨 위 층에 굵게 · 처음 그릴 때 그어지듯 나타남 · 마지막 점에서 맥박 (움직임 줄이기 설정이면 멈춤)
function siDrawToday(live) {
  const g = SC.g.today;
  siClear(g);
  if (!live) return;
  const today = SC.data.find((d) => d.id === SC.todayId);
  const pts = today.points, d = siPathD(pts);
  siEl('path', { class: 'ssi-tglow', d }, g);
  const path = siEl('path', { class: 'ssi-tpath', d }, g);
  if (!SC.todayDrawn && !siReduced() && path.getTotalLength) {
    const len = path.getTotalLength();
    path.style.strokeDasharray = len + ' ' + len;
    path.style.strokeDashoffset = len;
    path.getBoundingClientRect();
    path.style.transition = 'stroke-dashoffset .9s cubic-bezier(.33,1,.68,1)';
    path.style.strokeDashoffset = '0';
    path.addEventListener('transitionend', () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; path.style.transition = ''; }, { once: true });
  }
  SC.todayDrawn = true;
  const last = pts[pts.length - 1], cx = siR(SC.x(last.minute)), cy = siR(SC.y(last.pct));
  const rings = siEl('g', { class: 'ssi-rings', transform: `translate(${cx},${cy})` }, g);
  siEl('circle', { class: 'ssi-ring', r: 5 }, rings);
  siEl('circle', { class: 'ssi-ring second', r: 5 }, rings);
  siEl('circle', { class: 'ssi-tdot', cx, cy, r: 4 }, g);
  const L = SC.todayLabel;
  const t = siEl('text', { class: 'ssi-tlabel', x: siR(L.x), y: siR(L.y), 'text-anchor': L.anchor }, g);
  t.appendChild(document.createTextNode('오늘 '));
  const s = siEl('tspan', { class: siTone(last.pct) }, t);
  s.textContent = siFmtPct(last.pct);
}

// 오늘 값 이름표 자리: 점의 오른쪽 아래 → 오른쪽 위 → 왼쪽 아래 → 왼쪽 위 (오른쪽 끝에 가까우면 왼쪽부터)
// 오늘 선·평균선·중앙값 선을 가리지 않고 그림 안에 드는 첫 자리 → 없으면 오늘 선만 피하는 자리 → 그것도 없으면 첫 자리
function siTodayLabelPlace(live) {
  SC.todayLabel = null;
  if (!live) return;
  const pts = SC.data.find((d) => d.id === SC.todayId).points, last = pts[pts.length - 1];
  const cx = SC.x(last.minute), cy = SC.y(last.pct);
  const w = siTextW('오늘 ', 11, false, true) + siTextW(siFmtPct(last.pct), 11, true, true);
  const poly = (arr, f) => arr.filter((a) => f(a) != null).map((a) => ({ x: SC.x(a.minute), y: SC.y(f(a)) }));
  const todayLine = poly(pts, (p) => p.pct), aggLines = [poly(SC.aggs, (a) => a.mean), poly(SC.aggs, (a) => a.median)];
  const hits = (box, pl) => pl.some((p, i) => i > 0 && siLineHitsBox(pl[i - 1], p, box));
  const cand = [[1, 18], [1, -10], [-1, 18], [-1, -10]];
  if (cx > SC.pw - 110) cand.push(...cand.splice(0, 2));
  const opts = cand.map(([dir, dy]) => {
    const x = cx + dir * 10, l = dir > 0 ? x : x - w;
    return { x, y: cy + dy, anchor: dir > 0 ? 'start' : 'end', box: { l, r: l + w, t: cy + dy - 11, b: cy + dy + 3 } };
  });
  const inside = (b) => b.l >= 0 && b.r <= SC.pw && b.t >= 0 && b.b <= SC.ph;
  SC.todayLabel = opts.find((o) => inside(o.box) && !hits(o.box, todayLine) && !aggLines.some((pl) => hits(o.box, pl)))
    || opts.find((o) => inside(o.box) && !hits(o.box, todayLine)) || opts[0];
}

function siAriaSummary() {
  const t = SC.svg.querySelector('title');
  if (!t) return;
  const n = SC.data.length;
  if (!n) { t.textContent = 'TQQQ 장중 경로 — 조건에 맞는 날이 없음'; return; }
  const parts = SC.marks.map((p) => (p.kind === 'buy' ? '매수 ' : '매도 ') + siFmtClock(p.minute + SC.offset) + ' (' + p.reasons.map((r) => (r.what === 'mean' ? '평균 ' : '중앙값 ') + siFmtPct(r.value)).join(', ') + ')');
  t.textContent = `TQQQ 장중 경로 ${n}일 겹쳐 보기 (${SC.zone}) — ` + parts.join(' · ');
}
