/* ── [STRATSIM] 45 기간 (진입·청산) ────────────────────────────────────────
   이중 슬라이더(거래일 단위 · 최근에 해상도를 몰아주는 로그 휨) · 손잡이 위 라벨 · ◀▶ 재생 · 화살표 키 · 정확한 날짜 달력
   · 2026-11-28 분기 → 거래일 단위: 손잡이가 분기 경계(진입 = 직전 분기 마지막 거래일 · 청산 = 분기 마지막 거래일)에 놓이면
     예전과 같은 분기 번호(S.e·S.x)로, 그 밖의 날이면 정확한 날짜(S.ed·S.xd — 달력으로 고른 것과 같은 계산)로 적음
     → 분기 경계에서는 숫자·공유 링크·저장값이 예전과 똑같고, 청산이 맨 끝(최신)이면 다음 날 자료가 붙어도 최신을 따라감
   · 손잡이를 누른 뒤 ←·→ = 그 손잡이 하루(거래일)씩 · Shift+←·→ / PageUp·PageDown = 한 분기(63거래일)씩 · Home·End = 끝까지
     막대(손잡이 밖)를 누른 뒤 ←·→ = 둘 다 하루씩 · ◀▶ = 둘 다 한 분기씩 (둘 다 분기 경계면 예전처럼 분기 번호로) */

const SS_STEP_Q = 63;   // 한 분기 거래일 수 (SS_PERIOD_DAYS.quarterly 와 같음) — Shift+화살표 · ◀▶ 한 걸음(정확한 날짜일 때)

// 지금 S 가 가리키는 진입·청산 (ssRender 첫머리와 같은 정리 규칙 — S 는 바꾸지 않음)
//   41-render.js 는 과최적화 탐색기 계산 해시(scripts/stratsim_fit.cjs HASH_FILES)에 들어가 고치면 탐색기 표 전체를 다시 계산하므로 같은 규칙을 여기 따로 둠
//   — 둘이 같은지는 tests/run_regression.py 'strategy-simulator' 기간 슬라이더 검사가 화면 계산(R.ctx)과 대조
function ssPeriodDates() {
  const qmax = DS.q.length - 1;
  let e = Number.isFinite(S.e) ? S.e : 0, x = Number.isFinite(S.x) ? S.x : qmax;
  if (e < 0) e = 0;
  if (x < 0) x = qmax;
  if (e > qmax) e = qmax;
  if (x > qmax) x = qmax;
  if (e >= x) { x = Math.min(e + 1, qmax); e = Math.min(e, x - 1); if (e < 0) e = 0; }
  let ed = S.ed, xd = S.xd;
  if (ed && !DS.idx.has(ed)) ed = '';
  if (xd && !DS.idx.has(xd)) xd = '';
  if (ed && xd && ed >= xd) { ed = ''; xd = ''; }
  return { e, x, ed, xd, entryDate: ed || DS.q[e > 0 ? e - 1 : e][0], exitDate: xd || DS.q[x][0] };
}
// 날짜가 분기 마지막 거래일이면 그 분기 행 번호, 아니면 −1
function ssQRowIdx(d) { const i = ssQIdxForDate(d); return DS.q[i] && DS.q[i][0] === d ? i : -1; }
// 진입·청산 거래일(dE < dX) → S.e·S.x·S.ed·S.xd
//   canonE·canonX: 그 쪽 날짜가 분기 경계면 분기 번호로 적음(정확한 날짜 지움 — 슬라이더·달력) · false 면 정확한 날짜 그대로(거래내역 첫날 · 가만히 둔 정확한 날짜)
//   분기 번호가 겹치면(진입 분기 ≥ 청산 분기 — 화면 계산이 청산을 다음 분기로 밀어 버림) 진입을 정확한 날짜로 두고 번호만 청산 앞 분기로
//   (예전 달력도 같은 날 고르면 청산이 다음 분기로 밀렸음 — 같이 고침)
function ssSetPeriod(dE, dX, canonE, canonX) {
  const qmax = DS.q.length - 1;
  const kE = canonE ? ssQRowIdx(dE) : -1, kX = canonX ? ssQRowIdx(dX) : -1;
  let ed = kE >= 0 ? '' : dE, xd = kX >= 0 ? '' : dX;
  let e = kE >= 0 ? kE + 1 : ssQIdxForDate(dE), x = kX >= 0 ? kX : ssQIdxForDate(dX);
  if (e >= x) {
    if (x >= 1) { ed = dE; e = x - 1; }
    else { ed = dE; xd = dX; e = 0; x = Math.min(1, qmax); }
  }
  S.e = e; S.x = x; S.ed = ed; S.xd = xd;
}

const ssPeriodUI = {
  el: null, fill: null, th: [], max: 0, ei: 0, xi: 0, raf: 0, playT: null, playDir: 0,
  init(root) {
    this.el = root.querySelector('#ss-range');
    this.fill = this.el.querySelector('.ss-rfill');
    this.th = [this.el.querySelector('[data-h="e"]'), this.el.querySelector('[data-h="x"]')];
    this.max = DS.days.length - 1;
    this.th.forEach((t) => { t.setAttribute('tabindex', '0'); t.setAttribute('aria-valuemin', '0'); t.setAttribute('aria-valuemax', String(this.max)); });
    this.sync();
    const el = this.el;
    const track = (move) => {
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    };
    // 손잡이 끌기 (진입 ≤ 청산 − 1 거래일)
    this.th.forEach((t, k) => {
      const start = (ev) => {
        ev.preventDefault();
        this.sync();
        const rect = el.getBoundingClientRect();
        track((e2) => {
          const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
          const v = this.toVal((cx - rect.left) / rect.width * 100);
          if (k === 0) this.set(Math.min(v, this.xi - 1), this.xi, 'e'); else this.set(this.ei, Math.max(v, this.ei + 1), 'x');
        });
      };
      t.addEventListener('mousedown', start);
      t.addEventListener('touchstart', start, { passive: false });
      // 손잡이 키: 그 손잡이만 하루씩 · Shift / PageUp·PageDown 한 분기씩 · Home·End 끝까지
      t.addEventListener('keydown', (ev) => {
        const big = ev.shiftKey || ev.key === 'PageUp' || ev.key === 'PageDown';
        const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' || ev.key === 'PageUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' || ev.key === 'PageDown' ? -1 : 0;
        if (!d && ev.key !== 'Home' && ev.key !== 'End') return;
        ev.preventDefault(); ev.stopPropagation();
        this.sync();
        const n = d * (big ? SS_STEP_Q : 1);
        if (k === 0) this.set(ev.key === 'Home' ? 0 : ev.key === 'End' ? this.xi - 1 : Math.min(this.ei + n, this.xi - 1), this.xi, 'e', true);
        else this.set(this.ei, ev.key === 'Home' ? this.ei + 1 : ev.key === 'End' ? this.max : Math.max(this.xi + n, this.ei + 1), 'x', true);
      });
    });
    // 채운 막대 끌기 = 둘이 같이 (거래일 수 유지 · % 로 따라감)
    const fillStart = (ev) => {
      ev.preventDefault();
      this.sync();
      const rect = el.getBoundingClientRect(), x0 = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const span = this.xi - this.ei, p0 = this.toPct(this.ei);
      track((e2) => {
        const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
        let ne = this.toVal(p0 + (cx - x0) / rect.width * 100), nx = ne + span;
        if (ne < 0) { ne = 0; nx = span; }
        if (nx > this.max) { nx = this.max; ne = this.max - span; }
        this.set(ne, nx, null);
      });
    };
    this.fill.addEventListener('mousedown', fillStart);
    this.fill.addEventListener('touchstart', fillStart, { passive: false });
    // 트랙 누르기 = 가까운 손잡이를 그리로
    el.querySelector('.ss-rtrack').addEventListener('click', (ev) => {
      this.sync();
      const rect = el.getBoundingClientRect(), v = this.toVal((ev.clientX - rect.left) / rect.width * 100);
      if (Math.abs(v - this.ei) < Math.abs(v - this.xi)) this.set(Math.min(v, this.xi - 1), this.xi, 'e', true);
      else this.set(this.ei, Math.max(v, this.ei + 1), 'x', true);
    });
    // 막대 키(손잡이 밖을 눌러 막대에 초점): 둘 다 하루씩 · Shift 한 분기씩
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', (ev) => { if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return; ev.preventDefault(); this.shift((ev.key === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? SS_STEP_Q : 1)); });
    // 누른 곳에 초점: 손잡이면 그 손잡이(키로 하루씩 이어서 맞추게), 아니면 막대
    el.addEventListener('mousedown', (ev) => { const t = ev.target.closest && ev.target.closest('.ss-th'); (t || el).focus({ preventScroll: true }); });
    const pl = root.querySelector('#ss-play-l'), pr = root.querySelector('#ss-play-r');
    pl.addEventListener('click', () => (this.playDir === -1 ? this.stop() : this.play(-1)));
    pr.addEventListener('click', () => (this.playDir === 1 ? this.stop() : this.play(1)));
    this.pl = pl; this.pr = pr;
    root.querySelector('#ss-pick-e').addEventListener('click', (ev) => ssDatePick.open('e', ev.currentTarget));
    root.querySelector('#ss-pick-x').addEventListener('click', (ev) => ssDatePick.open('x', ev.currentTarget));
    window.addEventListener('resize', () => this.layout());
  },
  // 거래일 위치 ↔ 막대 % — 오늘에서 먼 날일수록 촘촘한 로그 눈금 (예전 분기 눈금과 같은 모양)
  //   오늘에서 k 거래일 떨어진 곳 = 100·(1 − ln(1 + k/s) / ln(1 + max/s)) %,  s = max(1, 전체 거래일 수 × 7.5%)
  warp() { const max = this.max, s = Math.max(1, max * 0.075); return { max, s, full: Math.log1p(max / s) }; },
  toPct(v) {
    const w = this.warp();
    if (w.max <= 0) return 0;
    const back = Math.min(w.max, Math.max(0, w.max - v));
    return 100 - 100 * Math.log1p(back / w.s) / w.full;
  },
  toVal(p) {
    const w = this.warp();
    if (w.max <= 0) return 0;
    const share = Math.min(100, Math.max(0, p)) / 100;
    const back = w.s * Math.expm1((1 - share) * w.full);
    return Math.round(Math.min(w.max, Math.max(0, w.max - back)));
  },
  // S → 지금 진입·청산 거래일 위치
  sync() {
    const p = ssPeriodDates(), a = DS.idx.get(p.entryDate), b = DS.idx.get(p.exitDate);
    if (a != null) this.ei = a;
    if (b != null) this.xi = b;
  },
  // 진입·청산 거래일 위치로 옮김 (side: 'e' 진입만 · 'x' 청산만 · null 둘 다) — now: 바로 다시 계산(아니면 다음 화면 그리기 때 한 번)
  set(ei, xi, side, now) {
    const N = this.max;
    ei = Math.max(0, Math.min(Math.round(ei), N - 1));
    xi = Math.max(ei + 1, Math.min(Math.round(xi), N));
    if (ei === this.ei && xi === this.xi) return false;   // 같은 날이면 다시 계산하지 않음
    const dE = DS.days[ei].date, dX = DS.days[xi].date;
    // 움직인 쪽은 분기 경계면 분기 번호로 · 가만히 둔 쪽은 지금 적힌 방식(분기 번호 / 정확한 날짜) 그대로
    ssSetPeriod(dE, dX, side !== 'x' || !S.ed, side !== 'e' || !S.xd);
    this.ei = ei; this.xi = xi;
    this.labels(dE, dX, S.ed, S.xd);
    this.layout();
    if (now) { this.cancel(); ssChanged(); } else this.queue();
    return true;
  },
  // 끄는 동안은 화면 그리기마다 한 번만 다시 계산 (마우스가 움직일 때마다 전부 다시 계산하지 않게)
  queue() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; ssChanged(); }); },
  cancel() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },
  labels(dE, dX, ed, xd) {
    const de = document.getElementById('ss-de'), dx = document.getElementById('ss-dx');
    if (de) de.textContent = ssDate(dE);
    if (dx) dx.textContent = ssDate(dX);
    const pe = document.getElementById('ss-pick-e'), px = document.getElementById('ss-pick-x');
    if (pe) pe.classList.toggle('on', !!ed);
    if (px) px.classList.toggle('on', !!xd);
    if (this.th[0]) { this.th[0].setAttribute('aria-valuenow', String(this.ei)); this.th[0].setAttribute('aria-valuetext', '진입 ' + ssDate(dE)); }
    if (this.th[1]) { this.th[1].setAttribute('aria-valuenow', String(this.xi)); this.th[1].setAttribute('aria-valuetext', '청산 ' + ssDate(dX)); }
  },
  layout() {
    if (!this.el) return;
    const ep = this.toPct(this.ei), xp = this.toPct(this.xi);
    this.th[0].style.left = ep + '%'; this.th[1].style.left = xp + '%';
    this.fill.style.left = ep + '%'; this.fill.style.width = (xp - ep) + '%';
    // 손잡이 위 라벨: 겹치면 양쪽으로 밀고 가장자리 안에
    const eL = document.getElementById('ss-tde'), xL = document.getElementById('ss-tdx'), w = this.el.clientWidth;
    if (!eL || !xL || !w) return;
    const eHalf = eL.offsetWidth / 2, xHalf = xL.offsetWidth / 2, need = eHalf + xHalf + 8;
    const inside = (c, half) => Math.min(Math.max(c, half), w - half);
    let eC = ep / 100 * w, xC = xp / 100 * w;
    const short = need - (xC - eC);
    if (short > 0) { eC -= short / 2; xC += short / 2; }
    eC = inside(eC, eHalf); xC = inside(xC, xHalf);
    if (xC - eC < need) {   // 한쪽이 가장자리에 붙었으면 다른 쪽을 밀어냄
      if (eC <= eHalf) xC = Math.min(eC + need, w - xHalf);
      else if (xC + xHalf >= w) eC = Math.max(xC - need, eHalf);
    }
    eL.style.left = eC + 'px'; xL.style.left = xC + 'px';
  },
  // 다시 계산한 뒤(ssRender) — 정리된 진입·청산으로 손잡이·라벨을 맞춤
  update(e, x, ed, xd) {
    if (!this.el) return;
    const dE = ed || DS.q[e > 0 ? e - 1 : e][0], dX = xd || DS.q[x][0];
    const a = DS.idx.get(dE), b = DS.idx.get(dX);
    if (a != null) this.ei = a;
    if (b != null) this.xi = b;
    this.labels(dE, dX, ed, xd);
    this.layout();
  },
  // 둘 다 n 거래일 (끝에 닿으면 멈춤)
  shift(n) {
    this.sync();
    const ne = this.ei + n, nx = this.xi + n;
    if (ne < 0 || nx > this.max) return false;
    return this.set(ne, nx, null, true);
  },
  // ◀▶ 한 걸음 = 한 분기: 둘 다 분기 경계면 분기 번호로(예전과 같음), 아니면 둘 다 63거래일
  step(dir) {
    if (!S.ed && !S.xd) {
      const p = ssPeriodDates(), ne = p.e + dir, nx = p.x + dir;
      if (ne < 0 || nx > DS.q.length - 1) return false;
      this.cancel();
      S.e = ne; S.x = nx;
      ssChanged();
      return true;
    }
    return this.shift(dir * SS_STEP_Q);
  },
  stop() {
    if (this.playT) { clearInterval(this.playT); this.playT = null; }
    this.playDir = 0;
    this.pl.setAttribute('aria-pressed', 'false'); this.pr.setAttribute('aria-pressed', 'false');
    this.pl.textContent = '◀'; this.pr.textContent = '▶';
  },
  play(dir) {
    this.stop();
    this.playDir = dir;
    const b = dir < 0 ? this.pl : this.pr;
    b.setAttribute('aria-pressed', 'true'); b.textContent = '■';
    if (!this.step(dir)) { this.stop(); return; }
    this.playT = setInterval(() => { if (!this.step(dir)) this.stop(); }, 750);
  },
};
// 날짜가 든 분기 (분기 마지막 거래일 ≥ 날짜 인 첫 분기)
function ssQIdxForDate(d) { for (let i = 0; i < DS.q.length; i++) if (DS.q[i][0] >= d) return i; return DS.q.length - 1; }

// ── 정확한 날짜 달력 ──
const ssDatePick = {
  st: null,
  close() {
    if (!this.st) return;
    this.st.pop.remove(); this.st.trig.classList.remove('open');
    this.st = null;
    document.removeEventListener('mousedown', this._dd, true);
    document.removeEventListener('keydown', this._kd, true);
    window.removeEventListener('resize', this._rp);
    window.removeEventListener('scroll', this._sc, true);
  },
  effEntry() { return ssPeriodDates().entryDate; },
  effExit() { return ssPeriodDates().exitDate; },
  pos(pop, trig) { ssPlacePop(pop, trig, pop.offsetWidth || 260, 260, 0); },
  grid(side, y, m) {
    const pop = this.st.pop, bound = side === 'e' ? this.effExit() : this.effEntry();
    const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
    const minY = +d0.slice(0, 4), minM = +d0.slice(5, 7) - 1, maxY = +d1.slice(0, 4), maxM = +d1.slice(5, 7) - 1;
    // select 를 콕 집어 찾음 — 사이트 공통 고르기([CSEL])가 select 앞에 같은 class 의 단추를 두므로 '.ss-dcy' 만 쓰면 단추가 잡힘
    pop.querySelector('select.ss-dcm').value = String(m);
    pop.querySelector('select.ss-dcy').value = String(y);
    pop.querySelector('[data-nav="-1"]').disabled = y < minY || (y === minY && m <= minM);
    pop.querySelector('[data-nav="1"]').disabled = y > maxY || (y === maxY && m >= maxM);
    const dow = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cur = side === 'e' ? S.ed : S.xd;
    const cells = [];
    for (let i = 0; i < dow; i++) cells.push('<span></span>');
    for (let d = 1; d <= dim; d++) {
      const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const ok = DS.idx.has(ds) && (side === 'e' ? (!bound || ds < bound) : (!bound || ds > bound));
      cells.push('<button type="button" class="ss-dcd' + (cur === ds ? ' sel' : '') + '" data-date="' + ds + '"' + (ok ? '' : ' disabled') + '>' + d + '</button>');
    }
    pop.querySelector('.ss-dcg').innerHTML = cells.join('');
  },
  open(side, trig) {
    if (this.st && this.st.side === side) { this.close(); return; }
    this.close();
    const anchor = side === 'e' ? this.effEntry() : this.effExit();
    const a = anchor || DS.days[DS.days.length - 1].date;
    let y = +a.slice(0, 4), m = +a.slice(5, 7) - 1;
    const minY = +DS.days[0].date.slice(0, 4), maxY = +DS.days[DS.days.length - 1].date.slice(0, 4);
    const yo = [];
    for (let yr = maxY; yr >= minY; yr--) yo.push('<option value="' + yr + '">' + yr + '년</option>');
    const mo = Array.from({ length: 12 }, (_, i) => '<option value="' + i + '">' + (i + 1) + '월</option>').join('');
    const pop = document.createElement('div');
    pop.className = 'ss-dcal';
    pop.innerHTML = '<div class="ss-dch"><button type="button" class="ss-dcn" data-nav="-1" aria-label="이전 달">&lsaquo;</button><span><select class="ss-isel ss-dcy" aria-label="연도">' + yo.join('') + '</select><select class="ss-isel ss-dcm" aria-label="월">' + mo + '</select></span><button type="button" class="ss-dcn" data-nav="1" aria-label="다음 달">&rsaquo;</button></div>'
      + '<div class="ss-dcw">' + ['일', '월', '화', '수', '목', '금', '토'].map((w) => '<span>' + w + '</span>').join('') + '</div><div class="ss-dcg"></div>'
      + '<div class="ss-dcf"><button type="button" class="ss-dcclr" title="고른 날이 든 분기의 경계(진입 = 그 분기 시작 · 청산 = 그 분기 끝)로 맞춤">분기 경계로 맞추기</button></div>';
    document.body.appendChild(pop);
    this.pos(pop, trig);
    trig.classList.add('open');
    this.st = { side, pop, trig, y, m };
    this.grid(side, y, m);
    pop.addEventListener('click', (ev) => {
      const nav = ev.target.closest('.ss-dcn');
      if (nav && !nav.disabled) {
        let { y: yy, m: mm } = this.st;
        mm += +nav.dataset.nav;
        if (mm < 0) { mm = 11; yy--; } else if (mm > 11) { mm = 0; yy++; }
        this.st.y = yy; this.st.m = mm; this.grid(side, yy, mm);
        return;
      }
      const day = ev.target.closest('.ss-dcd');
      if (day && !day.disabled) {
        const d = day.dataset.date;
        // 고른 날이 분기 경계면 슬라이더처럼 분기 번호로 — 같은 날이면 고른 방법과 상관없이 같은 숫자
        //   (주간·연간 9sig 는 분기 번호 계산과 정확한 날짜 계산의 리밸런스 날이 달라, 예전엔 달력 2025.12.31 과 막대 '2025년 4분기'의 숫자가 달랐음)
        // 다른 쪽은 지금 적힌 방식 그대로
        const p = ssPeriodDates();
        if (side === 'e') ssSetPeriod(d, p.exitDate, true, !p.xd); else ssSetPeriod(p.entryDate, d, !p.ed, true);
        this.close();
        ssPeriodUI.cancel();
        ssChanged();
        return;
      }
      if (ev.target.closest('.ss-dcclr')) { if (side === 'e') S.ed = ''; else S.xd = ''; this.close(); ssChanged(); }
    });
    pop.addEventListener('change', (ev) => {
      if (!ev.target.matches('select.ss-dcm, select.ss-dcy')) return;
      let yy = +pop.querySelector('select.ss-dcy').value, mm = +pop.querySelector('select.ss-dcm').value;
      const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
      const lo = { y: +d0.slice(0, 4), m: +d0.slice(5, 7) - 1 }, hi = { y: +d1.slice(0, 4), m: +d1.slice(5, 7) - 1 };
      if (yy < lo.y || (yy === lo.y && mm < lo.m)) { yy = lo.y; mm = lo.m; }
      if (yy > hi.y || (yy === hi.y && mm > hi.m)) { yy = hi.y; mm = hi.m; }
      this.st.y = yy; this.st.m = mm; this.grid(side, yy, mm);
    });
    // 바깥을 누르면 닫음 — 단, 연도·월 고르기 목록(.cs-menu)은 사이트 공통 고르기([CSEL])가 <body> 끝에 따로 띄우므로 '안'으로 봄
    // (예전: 목록에서 연도를 누르는 순간 달력이 닫혀 연도·월을 바꿀 수 없었음)
    this._dd = (e) => { const t = e.target; if (this.st && !this.st.pop.contains(t) && t !== this.st.trig && !this.st.trig.contains(t) && !(t.closest && t.closest('.cs-menu'))) this.close(); };
    this._kd = (e) => { if (e.key === 'Escape') this.close(); };
    this._rp = () => { if (this.st) this.pos(this.st.pop, this.st.trig); };
    this._sc = (e) => {
      if (!this.st || this.st.pop.contains(e.target) || (e.target.closest && e.target.closest('.cs-menu'))) return;   // 목록 안 스크롤은 무시
      const r = this.st.trig.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || (!r.width && !r.height)) { this.close(); return; }
      this.pos(this.st.pop, this.st.trig);
    };
    document.addEventListener('mousedown', this._dd, true);
    document.addEventListener('keydown', this._kd, true);
    window.addEventListener('resize', this._rp);
    window.addEventListener('scroll', this._sc, true);
  },
};
