/* ── [STRATSIM] 45 기간 (진입·청산) ────────────────────────────────────────
   이중 슬라이더(최근 분기에 해상도를 몰아주는 로그 휨) · 손잡이 위 라벨 · ◀▶ 재생 · 화살표 키 · 정확한 날짜 달력 */

const ssPeriodUI = {
  el: null, fill: null, th: [], max: 0, playT: null, playDir: 0,
  init(root) {
    this.el = root.querySelector('#ss-range');
    this.fill = this.el.querySelector('.ss-rfill');
    this.th = [this.el.querySelector('[data-h="e"]'), this.el.querySelector('[data-h="x"]')];
    this.max = DS.q.length - 1;
    const el = this.el;
    // 손잡이 끌기 (진입 ≤ 청산 − 1)
    this.th.forEach((t, k) => {
      const start = (ev) => {
        ev.preventDefault();
        const rect = el.getBoundingClientRect();
        const move = (e2) => {
          const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
          let v = this.toVal((cx - rect.left) / rect.width * 100);
          if (k === 0) S.e = Math.max(0, Math.min(v, S.x - 1)); else S.x = Math.min(this.max, Math.max(v, S.e + 1));
          this.layout();
          this.changed(k === 0 ? 'e' : 'x');
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
      };
      t.addEventListener('mousedown', start);
      t.addEventListener('touchstart', start, { passive: false });
    });
    // 채운 막대 끌기 = 둘이 같이 (폭 유지 · % 로 따라감)
    const fillStart = (ev) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect(), x0 = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const span = S.x - S.e, p0 = this.toPct(S.e);
      const move = (e2) => {
        const cx = e2.touches ? e2.touches[0].clientX : e2.clientX;
        let ne = this.toVal(p0 + (cx - x0) / rect.width * 100), nx = ne + span;
        if (ne < 0) { ne = 0; nx = span; }
        if (nx > this.max) { nx = this.max; ne = this.max - span; }
        S.e = ne; S.x = nx;
        this.layout(); this.changed();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
    };
    this.fill.addEventListener('mousedown', fillStart);
    this.fill.addEventListener('touchstart', fillStart, { passive: false });
    // 트랙 누르기 = 가까운 손잡이를 그리로
    el.querySelector('.ss-rtrack').addEventListener('click', (ev) => {
      const rect = el.getBoundingClientRect(), v = this.toVal((ev.clientX - rect.left) / rect.width * 100);
      let side;
      if (Math.abs(v - S.e) < Math.abs(v - S.x)) { S.e = Math.min(v, S.x - 1); side = 'e'; } else { S.x = Math.max(v, S.e + 1); side = 'x'; }
      this.layout(); this.changed(side);
    });
    el.setAttribute('tabindex', '0');
    el.addEventListener('keydown', (ev) => { if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return; ev.preventDefault(); this.step(ev.key === 'ArrowRight' ? 1 : -1); });
    el.addEventListener('mousedown', () => el.focus());
    const pl = root.querySelector('#ss-play-l'), pr = root.querySelector('#ss-play-r');
    pl.addEventListener('click', () => (this.playDir === -1 ? this.stop() : this.play(-1)));
    pr.addEventListener('click', () => (this.playDir === 1 ? this.stop() : this.play(1)));
    this.pl = pl; this.pr = pr;
    root.querySelector('#ss-pick-e').addEventListener('click', (ev) => ssDatePick.open('e', ev.currentTarget));
    root.querySelector('#ss-pick-x').addEventListener('click', (ev) => ssDatePick.open('x', ev.currentTarget));
    window.addEventListener('resize', () => this.layout());
  },
  // 분기 위치 ↔ 막대 % — 오늘에서 먼 분기일수록 촘촘한 로그 눈금
  //   오늘에서 k 분기 떨어진 곳 = 100·(1 − ln(1 + k/s) / ln(1 + max/s)) %,  s = max(1, 전체 분기 수 × 7.5%)
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
  layout() {
    if (!this.el) return;
    const ep = this.toPct(S.e), xp = this.toPct(S.x);
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
  update(e, x, ed, xd) {
    const de = document.getElementById('ss-de'), dx = document.getElementById('ss-dx');
    if (de) de.textContent = ed ? ssDate(ed) : ssQLabel(DS.q[e][0]);
    if (dx) dx.textContent = xd ? ssDate(xd) : ssQLabel(DS.q[x][0]);
    const pe = document.getElementById('ss-pick-e'), px = document.getElementById('ss-pick-x');
    if (pe) pe.classList.toggle('on', !!ed);
    if (px) px.classList.toggle('on', !!xd);
    this.layout();
  },
  // 움직인 쪽의 정확한 날짜만 지움 (둘 다 움직이면 둘 다)
  changed(side) {
    if (side === 'e' || side == null) S.ed = '';
    if (side === 'x' || side == null) S.xd = '';
    ssChanged();
  },
  step(dir) {
    const ne = S.e + dir, nx = S.x + dir;
    if (ne < 0 || nx > this.max) return false;
    S.e = ne; S.x = nx; this.layout(); this.changed();
    return true;
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
  effEntry() { if (S.ed) return S.ed; const i = S.e > 0 ? S.e - 1 : S.e; return DS.q[i] && DS.q[i][0]; },
  effExit() { return S.xd || (DS.q[S.x] && DS.q[S.x][0]); },
  pos(pop, trig) { ssPlacePop(pop, trig, pop.offsetWidth || 260, 260, 0); },
  grid(side, y, m) {
    const pop = this.st.pop, bound = side === 'e' ? this.effExit() : this.effEntry();
    const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
    const minY = +d0.slice(0, 4), minM = +d0.slice(5, 7) - 1, maxY = +d1.slice(0, 4), maxM = +d1.slice(5, 7) - 1;
    pop.querySelector('.ss-dcm').value = String(m);
    pop.querySelector('.ss-dcy').value = String(y);
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
      + '<div class="ss-dcf"><button type="button" class="ss-dcclr">분기 기본값 쓰기</button></div>';
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
        if (side === 'e') { S.ed = d; S.e = ssQIdxForDate(d); } else { S.xd = d; S.x = ssQIdxForDate(d); }
        this.close();
        ssPeriodUI.layout();
        ssChanged();
        return;
      }
      if (ev.target.closest('.ss-dcclr')) { if (side === 'e') S.ed = ''; else S.xd = ''; this.close(); ssChanged(); }
    });
    pop.addEventListener('change', (ev) => {
      if (!ev.target.matches('.ss-dcm, .ss-dcy')) return;
      let yy = +pop.querySelector('.ss-dcy').value, mm = +pop.querySelector('.ss-dcm').value;
      const d0 = DS.days[0].date, d1 = DS.days[DS.days.length - 1].date;
      const lo = { y: +d0.slice(0, 4), m: +d0.slice(5, 7) - 1 }, hi = { y: +d1.slice(0, 4), m: +d1.slice(5, 7) - 1 };
      if (yy < lo.y || (yy === lo.y && mm < lo.m)) { yy = lo.y; mm = lo.m; }
      if (yy > hi.y || (yy === hi.y && mm > hi.m)) { yy = hi.y; mm = hi.m; }
      this.st.y = yy; this.st.m = mm; this.grid(side, yy, mm);
    });
    this._dd = (e) => { if (this.st && !this.st.pop.contains(e.target) && e.target !== this.st.trig && !this.st.trig.contains(e.target)) this.close(); };
    this._kd = (e) => { if (e.key === 'Escape') this.close(); };
    this._rp = () => { if (this.st) this.pos(this.st.pop, this.st.trig); };
    this._sc = (e) => {
      if (!this.st || this.st.pop.contains(e.target)) return;
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
