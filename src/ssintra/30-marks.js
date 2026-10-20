/* ── [STRATSIM-INTRA] 03 매수·매도 표시 ──────────────────────────────────
   평균(중앙값)이 가장 낮은 시각 = 매수, 가장 높은 시각 = 매도 — 점 + 꺾인 연결선 + 글 상자
   상자 자리: 매수는 선 아래, 매도는 선 위를 먼저 · 가까운 층부터 차례로 따져 서로 겹치지 않고, 그림 안에 있고,
   장중 오늘 선을 가리지 않는 자리를 한꺼번에 찾음 (막히면 앞 상자 자리를 바꿔 다시 · 끝내 없으면 조건을 하나씩 풀어 고름) */

const SIA = { padX: 6, padY: 5, titleH: 14, lineH: 13, clear: 6, lead: 14, gutter: 30, step: 44, levels: 4, keep: 24, budget: 20000 };

// 두 구간 [a0, a1]·[b0, b1] 이 여유 c 안으로 겹치는지 → 가로·세로 둘 다 겹치면 닿음
const siSpanHit = (a0, a1, b0, b1, c) => a0 < b1 + c && b0 - c < a1;
// 축에 나란한 선분 {x1,x2,y1,y2} 또는 상자 {l,r,t,b} 가 다른 상자(여백 c 포함)에 닿는지
const siSegHitsBox = (s, b, c) => siSpanHit(s.x1, s.x2, b.l, b.r, c) && siSpanHit(s.y1, s.y2, b.t, b.b, c);
const siBoxHit = (a, b, c) => siSpanHit(a.l, a.r, b.l, b.r, c) && siSpanHit(a.t, a.b, b.t, b.b, c);

// 임의 선분 a→b 가 상자를 지나는지: 선분 위 점을 t(0~1)로 놓고, 가로·세로 각각 상자 안에 드는 t 범위를 좁혀 남는 게 있으면 지남
function siLineHitsBox(a, b, box) {
  let lo = 0, hi = 1;
  const within = (p0, d, min, max) => {
    if (d === 0) return min <= p0 && p0 <= max;   // 그 축으로 움직이지 않음 — 처음부터 안에 있어야
    const ta = (min - p0) / d, tb = (max - p0) / d;
    lo = Math.max(lo, Math.min(ta, tb)); hi = Math.min(hi, Math.max(ta, tb));
    return lo <= hi;
  };
  return within(a.x, b.x - a.x, box.l, box.r) && within(a.y, b.y - a.y, box.t, box.b);
}

function siMarkText(p) {
  const title = (p.kind === 'buy' ? '매수 ' : '매도 ') + siFmtClock(p.minute + SC.offset);
  const lines = p.reasons.map((r) => ({ name: r.what === 'mean' ? '평균 ' : '중앙값 ', value: siFmtPct(r.value) }));
  let w = siTextW(title, 11, false, true);
  for (const l of lines) w = Math.max(w, siTextW(l.name, 10.5) + siTextW(l.value, 10.5, true));
  return { title, lines, w: Math.ceil(w) + SIA.padX * 2, h: SIA.padY * 2 + SIA.titleH + lines.length * SIA.lineH };
}

function siMarkCandidates(p, pw, extraLefts) {
  const { w: W, h: H } = p.box0, px = p.px, py = p.py, s0 = p.kind === 'buy' ? 1 : -1;
  const pref = px + SIA.lead + W <= pw ? px + SIA.lead : px - SIA.lead - W;
  const lefts = [pref, px - SIA.lead - W, px + SIA.lead, px - W / 2, Math.max(0, Math.min(pw - W, px - W / 2))].concat(extraLefts || []);
  for (let k = 1; k <= 3; k++) lefts.push(px + SIA.lead + k * (W + SIA.clear), px - SIA.lead - W - k * (W + SIA.clear));
  const uniq = [...new Set(lefts.map((l) => Math.round(l)))].filter((l) => l >= 0 && l + W <= pw);
  const out = [];
  for (const sign of [s0, -s0]) {
    for (let L = 0; L < SIA.levels; L++) {
      const gy = py + sign * (SIA.gutter + L * SIA.step);
      const top = sign > 0 ? gy : gy - H;
      for (const left of uniq) {
        const box = { l: left, r: left + W, t: top, b: top + H };
        const segs = [{ x1: px, x2: px, y1: Math.min(py, gy), y2: Math.max(py, gy) }];
        let path = `M${siR(px)},${siR(py)}V${siR(gy)}`;
        if (px < box.l) { segs.push({ x1: px, x2: box.l, y1: gy, y2: gy }); path += `H${siR(box.l)}`; }
        else if (px > box.r) { segs.push({ x1: box.r, x2: px, y1: gy, y2: gy }); path += `H${siR(box.r)}`; }
        out.push({ box, segs, path, cost: L * SIA.step + Math.abs(left - pref) * 0.5 + (sign === s0 ? 0 : 2 * SIA.step) });
      }
    }
  }
  for (const dir of [1, -1]) {      // 점 바로 옆 (가로 연결선만)
    const left = dir > 0 ? px + SIA.lead : px - SIA.lead - W;
    const box = { l: left, r: left + W, t: py - H / 2, b: py + H / 2 };
    const ex = dir > 0 ? left : left + W;
    out.push({ box, segs: [{ x1: Math.min(px, ex), x2: Math.max(px, ex), y1: py, y2: py }], path: `M${siR(px)},${siR(py)}H${siR(ex)}`, cost: 1.5 * SIA.step + (dir > 0 ? 0 : W) });
  }
  return out.map((c, i) => ({ c, i })).sort((a, b) => a.c.cost - b.c.cost || a.i - b.i).map((o) => o.c);
}

function siLayoutMarks(points, pw, ph, lineHit, fixed) {
  const C = SIA.clear;
  const inside = (g) => g.box.t >= 0 && g.box.b <= ph && g.box.l >= 0 && g.box.r <= pw;
  const dotsClear = (g) => points.every((q) => !siBoxHit(g.box, { l: q.px - 5, r: q.px + 5, t: q.py - 5, b: q.py + 5 }, 2));
  // fixed: 이미 자리가 정해진 글자(오늘 값 이름표 · '지금' 표시) — 상자도 연결선도 가리지 않게
  const fixedClear = (g) => fixed.every((o) => !siBoxHit(g.box, o, C) && g.segs.every((s) => !siSegHitsBox(s, o, 2)));
  const clearOf = (g, others) => others.every((o) => !siBoxHit(g.box, o.box, C)
    && g.segs.every((s) => !siSegHitsBox(s, o.box, C)) && o.segs.every((s) => !siSegHitsBox(s, g.box, C)));
  const ok = (g) => inside(g) && dotsClear(g) && !lineHit(g.box) && fixedClear(g);
  const valid = points.map((p) => siMarkCandidates(p, pw).filter(ok).slice(0, SIA.keep));
  // 1) 모든 표시를 한꺼번에: 앞 표시부터 후보를 차례로 놓아 보고, 막히면 앞 표시로 돌아가 다음 후보로 (후보를 볼 때마다 1씩, SIA.budget 번까지)
  const n = points.length, at = new Array(n).fill(-1), chosen = [];
  let left = SIA.budget, lvl = 0, failed = false;
  while (lvl < n && !failed) {
    let k = at[lvl] + 1;
    for (; k < valid[lvl].length; k++) {
      if (--left < 0) { failed = true; break; }
      if (clearOf(valid[lvl][k], chosen)) break;
    }
    if (failed) break;
    if (k < valid[lvl].length) { at[lvl] = k; chosen.push(valid[lvl][k]); lvl++; continue; }
    at[lvl] = -1;                    // 이 표시는 둘 곳이 없음 → 앞 표시를 다음 후보로
    if (--lvl < 0) failed = true; else chosen.pop();
  }
  if (!failed) return chosen;
  // 2) 못 찾으면 하나씩: 모든 조건 → 그림 안·서로 안 겹침 → 그림 안 → 첫 후보 순으로 풀어 가며
  const placed = [];
  for (const p of points) {
    const all = siMarkCandidates(p, pw, placed.map((o) => o.box.r + C));
    const tiers = [(g) => ok(g) && clearOf(g, placed), (g) => inside(g) && clearOf(g, placed), inside];
    let pick = null;
    for (const t of tiers) { pick = all.find(t); if (pick) break; }
    placed.push(pick || all[0]);
  }
  return placed;
}

// 장중 오늘 선(그려져 있을 때)을 상자가 가리는지
function siTodayHitTest(live) {
  if (!live) return () => false;
  const day = SC.data.find((d) => d.id === SC.todayId);
  if (!day) return () => false;
  const pts = day.points.map((p) => ({ x: SC.x(p.minute), y: SC.y(p.pct) })), P = 8;
  return (b) => {
    const box = { l: b.l - P, r: b.r + P, t: b.t - P, b: b.b + P };
    for (let i = 1; i < pts.length; i++) if (siLineHitsBox(pts[i - 1], pts[i], box)) return true;
    return false;
  };
}

function siDrawMarks(live) {
  const g = SC.g.annot;
  siClear(g);
  if (!SC.marks.length) return;
  const points = SC.marks.map((p) => {
    const v = p.agg[p.anchor];
    const q = { ...p, px: SC.x(p.minute), py: SC.y(v) };
    q.box0 = siMarkText(q);
    return q;
  });
  const fixed = [SC.todayLabel && SC.todayLabel.box, SC.nowBox].filter(Boolean);
  const placed = siLayoutMarks(points, SC.pw, SC.ph, siTodayHitTest(live), fixed);
  points.forEach((p, i) => {
    const pl = placed[i], b = pl.box;
    const mg = siEl('g', { class: 'ssi-mark ' + p.kind }, g);
    siEl('path', { class: 'ssi-mline', d: pl.path }, mg);
    siEl('circle', { class: 'ssi-mdot', cx: siR(p.px), cy: siR(p.py), r: 5 }, mg);
    siEl('rect', { class: 'ssi-mbox', x: siR(b.l), y: siR(b.t), width: siR(b.r - b.l), height: siR(b.b - b.t), rx: 5 }, mg);
    const tt = siEl('text', { class: 'ssi-mtitle', x: siR(b.l + SIA.padX), y: siR(b.t + SIA.padY + 11) }, mg);
    tt.textContent = p.box0.title;
    p.box0.lines.forEach((l, k) => {
      const t = siEl('text', { class: 'ssi-mtext', x: siR(b.l + SIA.padX), y: siR(b.t + SIA.padY + SIA.titleH + (k + 1) * SIA.lineH - 2) }, mg);
      t.appendChild(document.createTextNode(l.name));
      siEl('tspan', { class: 'num' }, t).textContent = l.value;
    });
  });
}
