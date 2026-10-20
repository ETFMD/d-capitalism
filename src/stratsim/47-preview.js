/* ── [STRATSIM] 47 막대 미리보기 드롭다운 ───────────────────────────────────
   선택지를 열면, 다른 값은 그대로 두고 그 칸만 바꿔 끝까지 계산한 최종 금액을 막대로 —
   어느 값이 가장 좋았는지 한눈에 (가장 큰 값 = 강조 · 같은 값이 3번 넘게 이어지면 '=') */

let ssPd = null;   // { pop, trig }

// 이 칸의 선택지마다 최종 금액
function ssPdTotals(type, owner, k) {
  const ctx = R.ctx;
  if (!ctx) return [];
  const p0 = ssParamsOf(type, owner);
  const def = SS_PDEF[type + '.' + k];
  const opts = def.opts.map((o) => o[0]);
  const common = { initial: ctx.initial, monthly: ctx.monthly, raise: ctx.raise, qi0: ctx.qi0, qi1: ctx.qi1, sched: ctx.sched };
  const ov = ctx.anyOv ? { ed: ctx.entryDate, xd: ctx.exitDate } : {};
  if (type === 'bh') {
    const rows = ctx.anyOv ? (() => { const q = ssExactRows('quarterly', ctx.entryDate, ctx.exitDate); return q && q.length >= 2 ? q : null; })() : null;
    const r = ssRun9(Object.assign({}, common, { rate: 0.04, baseRate: ctx.rate, period: 'quarterly', rows }, ov, ssOpts9(ssDefaults('9sig'))));
    return opts.map((v) => { const a = r.bh[v] || []; return a.length ? a[a.length - 1].value : 0; });
  }
  return opts.map((v) => {
    const p = Object.assign({}, p0, { [k]: v });
    try {
      if (type === '9sig') {
        const per = p.per || 'quarterly';
        let rows = null;
        const rp = +p.rp || 0;
        if (rp > 0) { const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1)); const q = ssShiftRows(per, off, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
        if (!rows && ctx.anyOv) { const q = ssExactRows(per, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
        const r = ssRun9(Object.assign({}, common, { rate: ssRate9(p), baseRate: ctx.rate, period: per, rows, noBH: true }, ov, ssOpts9(p)));
        return r.log.length ? r.log[r.log.length - 1].total : 0;
      }
      if (type === 'sma') {
        const r = ssRunSma(Object.assign({}, common, { rate: ssRate9(p) }, ov, ssOptsSma(p)));
        return r.points.length ? r.points[r.points.length - 1].value : 0;
      }
    } catch (e) { return 0; }
    return 0;
  });
}
// 떠 있는 창을 단추 바로 아래에 — 아래 공간이 flipUnder 보다 좁고 위가 더 넓으면 위로 · 좌우는 화면 안 8px
//   maxH > 0 이면 높이도 그 공간(최대 maxH)에 맞춤 · 막대 미리보기 드롭다운과 날짜 달력이 같이 씀
function ssPlacePop(pop, trig, width, flipUnder, maxH) {
  const r = trig.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  pop.style.left = Math.max(8, Math.min(r.left, vw - 8 - width)) + 'px';
  const room = vh - r.bottom - 8, up = room < flipUnder && r.top > room;
  pop.style.top = up ? '' : (r.bottom + 4) + 'px';
  pop.style.bottom = up ? (vh - r.top + 4) + 'px' : '';
  if (maxH > 0) pop.style.maxHeight = Math.min(maxH, up ? r.top - 8 : room) + 'px';
}
function ssPdPos(pop, trig) {
  const w = Math.max(trig.getBoundingClientRect().width, 260);
  pop.style.minWidth = w + 'px';
  ssPlacePop(pop, trig, w, 180, 340);
}
function ssClosePd() {
  if (!ssPd) return;
  ssPd.pop.remove(); ssPd.trig.classList.remove('open');
  ssPd = null;
  document.removeEventListener('mousedown', ssPdDown, true);
  document.removeEventListener('keydown', ssPdKey, true);
  window.removeEventListener('resize', ssPdRepos);
  window.removeEventListener('scroll', ssPdScroll, true);
}
function ssPdDown(e) { if (ssPd && !ssPd.pop.contains(e.target) && e.target !== ssPd.trig && !ssPd.trig.contains(e.target)) ssClosePd(); }
function ssPdKey(e) { if (e.key === 'Escape') ssClosePd(); }
function ssPdRepos() { if (ssPd) ssPdPos(ssPd.pop, ssPd.trig); }
function ssPdScroll(e) {
  if (!ssPd || ssPd.pop.contains(e.target)) return;
  const r = ssPd.trig.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) { ssClosePd(); return; }
  ssPdPos(ssPd.pop, ssPd.trig);
}
// 공통 팝업 (기본 전략 손잡이·사용자 전략 손잡이 모두)
function ssPdShell(trig, rows, curIdx, onPick) {
  const pop = document.createElement('div');
  pop.className = 'ss-pdpop';
  pop.innerHTML = '<div class="ss-pdh">고르면 끝 금액</div>' + rows.map((lab, i) => '<div class="ss-pdr' + (i === curIdx ? ' sel' : '') + '" data-i="' + i + '"><span class="ss-pdl">' + ssEsc(lab) + '</span><span class="ss-pdt"><span class="ss-pdf"></span></span><span class="ss-pdv">…</span></div>').join('');
  document.body.appendChild(pop);
  let mw = 0;
  pop.querySelectorAll('.ss-pdl').forEach((el) => { mw = Math.max(mw, el.offsetWidth); });
  if (mw > 0) pop.style.setProperty('--pdl', Math.ceil(mw) + 'px');
  ssPdPos(pop, trig);
  trig.classList.add('open');
  ssPd = { pop, trig };
  pop.addEventListener('click', (e) => { const r = e.target.closest('.ss-pdr'); if (!r) return; const i = +r.getAttribute('data-i'); ssClosePd(); onPick(i); });
  const sel = pop.querySelector('.ss-pdr.sel');
  if (sel) pop.scrollTop = Math.max(0, sel.offsetTop - (pop.clientHeight - sel.offsetHeight) / 2);
  document.addEventListener('mousedown', ssPdDown, true);
  document.addEventListener('keydown', ssPdKey, true);
  window.addEventListener('resize', ssPdRepos);
  window.addEventListener('scroll', ssPdScroll, true);
  return pop;
}
// mode 'all' = 기본 전략(모두 한 번에 계산): 최댓값과 같은 값 모두 강조 + 3번 넘게 같은 값 '='
// mode 'one' = 사용자 전략(하나씩 도착): 다 오면 첫 최댓값 하나만 강조
function ssPdFill(pop, totals, mode) {
  const rows = Array.from(pop.querySelectorAll('.ss-pdr'));
  const done = totals.every((t) => t != null);
  const maxT = Math.max(0, ...totals.map((t) => t || 0));
  const labels = totals.map((t) => (t == null ? null : ssMoney(Math.round(t))));
  const maxL = ssMoney(Math.round(maxT)), bestIdx = totals.indexOf(maxT);
  // 같은 금액이 셋 이상 이어지면 둘째부터 '=' 로 흐리게
  const rep = labels.map(() => false);
  if (mode === 'all') {
    let runFrom = 0;
    for (let i = 1; i <= labels.length; i++) {
      if (i < labels.length && labels[i] === labels[runFrom]) continue;
      if (i - runFrom >= 3) for (let k = runFrom + 1; k < i; k++) rep[k] = true;
      runFrom = i;
    }
  }
  rows.forEach((row, i) => {
    const t = totals[i];
    row.querySelector('.ss-pdf').style.width = (maxT > 0 && t != null ? Math.max(1.5, t / maxT * 100) : 0) + '%';
    row.querySelector('.ss-pdv').textContent = t == null ? '…' : labels[i];
    row.classList.toggle('best', maxT > 0 && (mode === 'all' ? labels[i] === maxL : done && i === bestIdx));
    row.classList.toggle('rep', rep[i]);
  });
}
function ssOpenPd(trig) {
  if (ssPd && ssPd.trig === trig) { ssClosePd(); return; }
  ssClosePd();
  const type = trig.getAttribute('data-pd-type'), owner = trig.getAttribute('data-pd-own'), k = trig.getAttribute('data-pd-k');
  const def = SS_PDEF[type + '.' + k], p = ssParamsOf(type, owner);
  if (!def || !p) return;
  const cur = def.opts.findIndex((o) => o[0] === String(p[k]));
  const pop = ssPdShell(trig, def.opts.map((o) => o[1]), cur, (i) => { const v = def.opts[i][0]; if (String(p[k]) !== v) ssSetParam(type, owner, k, v); });
  setTimeout(() => { if (!ssPd || ssPd.pop !== pop) return; let tot; try { tot = ssPdTotals(type, owner, k); } catch (e) { return; } ssPdFill(pop, tot, 'all'); }, 0);
}
