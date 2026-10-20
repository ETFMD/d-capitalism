/* ── [STRATSIM-INTRA] 05 조절 장치 ───────────────────────────────────────
   시가·종가 막대 필터(끌어서 범위 고르기) · 기간 막대(두 손잡이) · 비슷한 날만 · 로그/직선 눈금
   고른 값은 이 브라우저에 저장 — 끝에 닿은 손잡이는 'edge' 로 저장해 새 자료가 붙어도 끝을 따라감 */

const SI_KEYS = { period: 'ssi-period', similar: 'ssi-similar', log: 'ssi-log', metric: (k) => 'ssi-metric-' + k };
const SI_MEM = {};       // 저장소를 못 쓰는 브라우저(사생활 보호 창 등)에서도 이 화면이 열려 있는 동안은 기억
const siStore = {
  get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) { /* 저장소 없음 */ } return k in SI_MEM ? SI_MEM[k] : null; },
  set(k, v) { SI_MEM[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* 저장소 없음 */ } },
  json(k) { try { return JSON.parse(this.get(k)) || {}; } catch (e) { return {}; } },
  flag(k, dflt) { const v = this.get(k); return v === null ? dflt : v === '1'; },
};

// ── 막대 필터 (시가 · 종가, 둘 다 전일 종가 대비 %) ──
// 모든 날의 값을 0.1% 단위로 넓힌 범위를 30칸으로 나눈 막대 · 끌어 고른 범위 밖의 날은 빼고 봄 (가장 최근 날은 늘 남김)
const SI_METRICS = { open: (d) => d.open, close: (d) => d.close };
const siR1 = (v) => +v.toFixed(1);

function siBins(values, min, max) {
  let tz = [];
  for (let i = 1; i < SI_METRIC_BINS; i++) tz.push(min + ((max - min) * i) / SI_METRIC_BINS);
  let a = 0, b = tz.length;
  while (a < tz.length && tz[a] <= min) ++a;
  while (b > 0 && tz[b - 1] > max) --b;
  if (a || b < tz.length) tz = tz.slice(a, b);
  const m = tz.length, bins = [];
  for (let i = 0; i <= m; i++) bins.push({ x0: i > 0 ? tz[i - 1] : min, x1: i < m ? tz[i] : max, n: 0 });
  for (const v of values) {
    if (v == null || !(min <= v && v <= max)) continue;
    let lo = 0, hi = m;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (tz[mid] <= v) lo = mid + 1; else hi = mid; }
    bins[lo].n++;
  }
  return bins;
}

function siMetric(key, block, allDays, onChange) {
  const value = SI_METRICS[key];
  const values = allDays.map(value).filter((v) => v !== null);
  const min = siR1(Math.floor(siMin(values) / SI_METRIC_STEP) * SI_METRIC_STEP);
  const max = siR1(Math.ceil(siMax(values) / SI_METRIC_STEP) * SI_METRIC_STEP);
  const bins = siBins(values, min, max);
  const st = { key, min, max, lo: min, hi: max, bins };
  const svg = block.querySelector('.ssi-hist'), rng = block.querySelector('.ssi-mrange'), reset = block.querySelector('.ssi-mreset');
  const name = block.dataset.name;
  if (block._ssiAbort) block._ssiAbort.abort();      // 자료를 다시 불러오면 이전 손잡이 동작은 지움
  const ac = (block._ssiAbort = new AbortController()), sig = { signal: ac.signal };
  let W = 0, H = 0, xs = null, els = null;
  const inv = (px) => min + (px / W) * (max - min);

  const save = () => siStore.set(SI_KEYS.metric(key), JSON.stringify({ lo: st.lo > min ? st.lo : 'edge', hi: st.hi < max ? st.hi : 'edge' }));
  const active = () => st.lo > min || st.hi < max;

  function build() {
    siClear(svg);
    W = Math.max(40, svg.clientWidth); H = Math.max(16, svg.clientHeight);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    xs = (v) => ((v - min) / (max - min || 1)) * W;
    const top = Math.max(1, siMax(bins.map((b) => b.n)) || 1);
    const yb = (n) => H - (n / top) * (H - 2);
    const gb = siEl('g', { class: 'bars' }, svg);
    const rects = bins.map((b) => siEl('rect', { x: siR(xs(b.x0) + 0.5), width: Math.max(1, siR(xs(b.x1) - xs(b.x0) - 1)), y: siR(yb(b.n)), height: siR(H - yb(b.n)) }, gb));
    if (min < 0 && max > 0) siEl('line', { class: 'zero', x1: siR(xs(0)), x2: siR(xs(0)), y1: 0, y2: H }, svg);
    const sel = siEl('rect', { class: 'sel', y: 0, height: H }, svg);
    const hs = [0, 1].map((i) => {
      const h = siEl('rect', { class: 'handle', y: -1, height: H + 2, width: 6, rx: 2, tabindex: 0, role: 'slider', 'aria-label': name + (i ? ' 상한' : ' 하한'), 'aria-valuemin': min, 'aria-valuemax': max }, svg);
      h.addEventListener('keydown', (e) => keyMove(e, i), sig);
      return h;
    });
    const labels = [0, 1].map(() => siEl('text', { class: 'hlabel', y: H + 3, dy: '0.71em' }, svg));
    els = { rects, sel, hs, labels };
    paint();
  }

  function paint() {
    if (!els) return;
    const on = active();
    els.rects.forEach((r, i) => r.classList.toggle('in', !on || (bins[i].x1 > st.lo && bins[i].x0 < st.hi)));
    const a = xs(st.lo), b = xs(st.hi);
    els.sel.setAttribute('x', siR(a)); els.sel.setAttribute('width', siR(Math.max(0, b - a)));
    [a, b].forEach((px, i) => {
      const h = els.hs[i], v = i ? st.hi : st.lo;
      h.setAttribute('x', siR(px - 3));
      h.setAttribute('aria-valuenow', v);
      h.setAttribute('aria-valuetext', siFmtPct(v, 1));
    });
    // 손잡이 아래 경곗값: 가운데 맞춤 → 칸 밖으로 안 나가게 → 둘이 붙으면 아래쪽은 왼쪽, 위쪽은 오른쪽으로 비킴
    const t = els.labels;
    t[0].textContent = siFmtPct(st.lo, 1); t[1].textContent = siFmtPct(st.hi, 1);
    const w0 = t[0].getComputedTextLength ? t[0].getComputedTextLength() : 30, w1 = t[1].getComputedTextLength ? t[1].getComputedTextLength() : 30, G = 6;
    let l0 = Math.max(0, Math.min(W - w0, a - w0 / 2)), l1 = Math.max(0, Math.min(W - w1, b - w1 / 2));
    const over = l0 + w0 + G - l1;
    if (over > 0) {
      l0 = Math.max(0, l0 - over / 2);
      l1 = Math.min(W - w1, l0 + w0 + G);
      l0 = Math.max(0, Math.min(l0, l1 - w0 - G));
    }
    t[0].setAttribute('x', siR(l0)); t[1].setAttribute('x', siR(l1));
    rng.hidden = on; reset.hidden = !on;
    block.classList.toggle('on', on);
  }

  // (끌기·키보드는 늘 lo ≤ hi 로 부름 · 저장값이 거꾸로면 원본처럼 그대로 둬 아무 날도 통과하지 않음 — 바깥을 누르면 풀림)
  function set(lo, hi, user) {
    st.lo = lo; st.hi = hi;
    paint();
    if (user) { save(); onChange(); }
  }

  // 끌기: 손잡이 = 그 끝만 · 좁혀 둔 범위 안 = 통째로 옮김 · 밖(또는 아직 전체일 때 아무 곳) = 새로 고르기 · 움직이지 않고 떼면 전체로
  let drag = null;
  const hit = (px, e) => {
    const a = xs(st.lo), b = xs(st.hi), grab = e.pointerType === 'mouse' ? 6 : 14;
    const da = Math.abs(px - a), db = Math.abs(px - b);
    if (Math.min(da, db) <= grab) return da < db || (da === db && px < a) ? 'lo' : 'hi';
    return px > a && px < b && active() ? 'move' : 'new';
  };
  const pxOf = (e) => e.clientX - svg.getBoundingClientRect().left - svg.clientLeft;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !xs) return;
    const px = pxOf(e);
    drag = { mode: hit(px, e), x0: px, a: xs(st.lo), b: xs(st.hi), moved: false, id: e.pointerId };
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    e.preventDefault();
  }, sig);
  svg.addEventListener('pointermove', (e) => {
    if (!drag && xs && e.pointerType === 'mouse') { const m = hit(pxOf(e), e); svg.style.cursor = m === 'move' ? 'move' : m === 'new' ? '' : 'ew-resize'; }
    if (!drag || e.pointerId !== drag.id) return;
    const px = Math.max(0, Math.min(W, pxOf(e)));
    if (!drag.moved && Math.abs(px - drag.x0) < 2) return;
    drag.moved = true;
    let a = drag.a, b = drag.b;
    if (drag.mode === 'lo') a = px;
    else if (drag.mode === 'hi') b = px;
    else if (drag.mode === 'move') { const d = Math.max(-drag.a, Math.min(W - drag.b, px - drag.x0)); a = drag.a + d; b = drag.b + d; }
    else { a = Math.min(drag.x0, px); b = Math.max(drag.x0, px); }
    if (a > b) [a, b] = [b, a];
    set(siR1(inv(a)), siR1(inv(b)), true);
  }, sig);
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const wasClick = !drag.moved && drag.mode === 'new';
    drag = null;
    if (wasClick) set(min, max, true);
  };
  svg.addEventListener('pointerup', end, sig);
  svg.addEventListener('pointercancel', end, sig);
  svg.addEventListener('dblclick', () => set(min, max, true), sig);
  reset.addEventListener('click', () => set(min, max, true), sig);

  function keyMove(e, i) {
    const big = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown' ? 1 : SI_METRIC_STEP;
    let v = i ? st.hi : st.lo;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') v -= big;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') v += big;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else return;
    e.preventDefault();
    v = siR1(Math.max(min, Math.min(max, v)));
    if (i) set(st.lo, Math.max(st.lo, v), true); else set(Math.min(st.hi, v), st.hi, true);
  }

  const saved = siStore.json(SI_KEYS.metric(key));
  set(typeof saved.lo === 'number' ? siR1(Math.max(min, saved.lo)) : min, typeof saved.hi === 'number' ? siR1(Math.min(max, saved.hi)) : max, false);
  save();                            // 끝에 닿은 값은 'edge' 로 다시 저장 (자료 범위가 넓어지면 끝을 따라가게)
  build();
  st.build = build;
  st.pass = (d) => { const v = value(d); return v !== null && v >= st.lo && v <= st.hi; };
  return st;
}

// ── 기간 막대: 불러온 거래일 위의 두 손잡이 (서로 넘지 않음) ──
function siRestoreThumb(saved, dates, edge, isStart) {
  if (!saved || saved === 'edge') return edge;
  const exact = dates.indexOf(saved);
  if (exact >= 0) return exact;
  let inward = -1;
  if (isStart) inward = dates.findIndex((d) => d > saved);
  else for (let i = dates.length - 1; i >= 0; i--) if (dates[i] < saved) { inward = i; break; }
  return inward >= 0 ? inward : edge;
}

function siPeriod(allDays, els, onChange) {
  const { start, end, fill } = els, last = allDays.length - 1, dates = allDays.map((d) => d.date);
  const saved = siStore.json(SI_KEYS.period);
  start.max = end.max = String(Math.max(0, last));
  start.value = String(siRestoreThumb(saved.start, dates, 0, true));
  end.value = String(siRestoreThumb(saved.end, dates, last, false));
  const apply = () => {
    let lo = +start.value, hi = +end.value;
    if (lo > hi) [lo, hi] = [hi, lo];
    start.value = String(lo); end.value = String(hi);
    const span = Math.max(1, last);
    fill.style.left = (lo / span) * 100 + '%';
    fill.style.width = ((hi - lo) / span) * 100 + '%';
    start.setAttribute('aria-valuetext', siFmtDate(dates[lo]));
    end.setAttribute('aria-valuetext', siFmtDate(dates[hi]));
    siStore.set(SI_KEYS.period, JSON.stringify({ start: lo === 0 ? 'edge' : dates[lo], end: hi === last ? 'edge' : dates[hi] }));
    onChange(allDays.slice(lo, hi + 1));
  };
  start.oninput = apply;
  end.oninput = apply;
  apply();
}
