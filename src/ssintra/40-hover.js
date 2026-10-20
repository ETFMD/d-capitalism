/* ── [STRATSIM-INTRA] 04 마우스·탭으로 보기 ──────────────────────────────
   그림 위 아무 곳: 가장 가까운 5분 시각에 세로선 · 그 시각 커서와 가장 가까운 날을 강조 · 평균/중앙값/그날 값 · 그날 날짜·종가
   마우스는 올리기만 하면, 손가락은 탭(옆으로 끌면 따라감) — 다른 곳을 누르거나 × 를 누르면 닫힘 */

const SH = { active: false, pinned: false, down: false, onInfo: null, keep: null };

function siHoverInit() {
  const t = SC.target;
  const pos = (e) => {
    const r = SC.svg.getBoundingClientRect();
    return [e.clientX - r.left - SC.m.l, e.clientY - r.top - SC.m.t];
  };
  t.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || SH.down) siHoverAt(...pos(e));
  });
  t.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    SH.down = true; SH.pinned = true;
    siHoverAt(...pos(e));
  });
  const up = () => { SH.down = false; };
  t.addEventListener('pointerup', up);
  t.addEventListener('pointercancel', up);
  t.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !SH.pinned) siHoverHide(); });
  document.addEventListener('pointerdown', (e) => {
    if (SH.pinned && e.target !== t && !(SH.keep && SH.keep.contains(e.target))) siHoverHide();
  }, true);
}

function siHoverHide() {
  SH.active = false; SH.pinned = false;
  if (SC.svg) SC.svg.classList.remove('hovering');
  if (SC.g.hover) siClear(SC.g.hover);
  if (SC.g.hday) siClear(SC.g.hday);
  if (SH.onInfo) SH.onInfo(null);
}
const siHoverReset = siHoverHide;

function siHoverAt(px, py) {
  const { data, aggs, x, y, pw, ph } = SC;
  if (!data.length || !aggs.length) return;
  px = Math.max(0, Math.min(pw, px));
  py = Math.max(0, Math.min(ph, py));
  const agg = aggs[siBisectCenter(aggs, x.invert(px), (a) => a.minute)];
  const cursor = y.invert(py);
  const at = (d) => d.points[siBisectCenter(d.points, agg.minute, (p) => p.minute)];
  const nearest = siLeast(data, (d) => { const p = at(d); return p.minute === agg.minute ? Math.abs(p.pct - cursor) : Infinity; });
  const dayPct = at(nearest).pct;
  SH.active = true;
  SC.svg.classList.add('hovering');          // 보는 동안 매수·매도 상자는 옅게 (값 글자가 잘 보이게)
  const g = SC.g.hover;
  siClear(g);
  const hx = siR(x(agg.minute));
  siEl('line', { class: 'ssi-hrule', x1: hx, x2: hx, y1: 0, y2: ph }, g);

  // 가리킨 날: 맨 위에 진하게 (장중 오늘은 이미 맨 위라 그대로)
  const hd = SC.g.hday;
  siClear(hd);
  const isToday = SC.live && nearest.id === SC.todayId;
  if (!isToday) siEl('path', { class: 'ssi-day hover', d: siPathD(nearest.points) }, hd);

  // 시각 칩 (가로축 위)
  const tText = siFmtClock(agg.minute + SC.offset);
  const cw = siTextW(tText, 10.5, true) + 12, chH = 16;
  const cx = Math.max(cw / 2, Math.min(pw - cw / 2, hx));
  const chip = siEl('g', { class: 'ssi-hchip', transform: `translate(${siR(cx)},${siR(ph + 10)})` }, g);
  siEl('rect', { x: siR(-cw / 2), y: -chH / 2, width: siR(cw), height: chH, rx: 4 }, chip);
  siEl('text', { y: 0, dy: '0.35em', 'text-anchor': 'middle' }, chip).textContent = tText;

  // 세로선이 평균·중앙값·그날 선과 만나는 값 — 겹치면 위아래로 벌림
  const cross = [
    { k: 'mean', name: '평균 ', v: agg.mean },
    { k: 'median', name: '중앙값 ', v: agg.median },
    { k: 'day', name: '', v: dayPct },
  ].filter((c) => c.v != null).map((c) => ({ ...c, y: y(c.v) }));
  const ord = siSortBy(cross, (c) => c.y);
  ord.forEach((c) => { c.ly = c.y; });
  for (let i = 1; i < ord.length; i++) ord[i].ly = Math.max(ord[i].ly, ord[i - 1].ly + 14);
  for (let i = ord.length - 2; i >= 0; i--) ord[i].ly = Math.min(ord[i].ly, ord[i + 1].ly - 14);
  const onRight = hx > pw - (SC.compact ? 110 : 150);
  for (const c of cross) {
    const cg = siEl('g', { class: 'ssi-hx ' + c.k }, g);
    siEl('circle', { cx: hx, cy: siR(c.y), r: 3.5 }, cg);
    const t = siEl('text', { x: hx + (onRight ? -9 : 9), y: siR(c.ly), dy: '0.35em', 'text-anchor': onRight ? 'end' : 'start' }, cg);
    if (c.name) t.appendChild(document.createTextNode(c.name));
    siEl('tspan', { class: 'num' }, t).textContent = siFmtPct(c.v);
  }

  // 그날 끝: 오른쪽 여백에 날짜와 종가(전일 종가 대비) — 평균·중앙값 이름과 겹치면 위아래로 옮김 (좁은 화면은 위 안내줄에)
  const last = nearest.points[nearest.points.length - 1];
  if (!SC.compact) {
    const ey = y(last.pct), H = 26;
    const clearOfNames = (cy) => SC.lineLabelYs.every((ly) => Math.abs(cy - ly) > 20);
    const inPlot = (cy) => cy - H / 2 >= 0 && cy + H / 2 <= ph;
    const endY = [ey, ey - H, ey + H, ey - 2 * H, ey + 2 * H].find((cy) => inPlot(cy) && clearOfNames(cy));
    const yy = siR(endY === undefined ? ey : endY), xx = siR(pw + 6);
    const t = siEl('text', { class: 'ssi-hend', x: xx, y: yy }, g);
    siEl('tspan', { x: xx, dy: '-0.35em' }, t).textContent = siFmtDate(nearest.date) + ' (' + siWeekday(nearest.date) + ')';
    siEl('tspan', { x: xx, dy: '1.2em', class: 'dim' }, t).textContent = '종가 ' + siFmtPct(last.pct);
  }
  if (SH.onInfo) SH.onInfo({ day: nearest, minute: agg.minute, dayPct, close: last.pct, agg, today: isToday });
}
