/* ── [STRATSIM-INTRA] 06 화면 조립 · 자료 불러오기 · 새로 고침 ──────────────────
   불러올 때마다(처음 · 10분마다) 조절 장치를 저장된 상태로 다시 세우고, 바뀔 때마다 거르기 → 평균·중앙값 → 다시 그림
   거르는 순서: 기간 막대 → 시가·종가 막대 필터(가장 최근 날은 늘 남김) → '비슷한 날만'이면 그중 마지막 날과 비슷한 날 */

const SA = { root: null, allDays: [], latestId: null, periodDays: [], metrics: [], similarOn: false, ready: false, loadedAt: 0, timers: false, loading: false, fontsOk: false, drawnBeforeFonts: false };
const SI_NOW_MS = 30 * 1000, SI_DATA_MS = 10 * 60 * 1000;

function siBuildDom(root) {
  root.innerHTML = `
  <div class="ssi-top"><span class="ssi-fetched" id="ssi-fetched">자료를 불러오는 중…</span></div>
  <div class="card ssi-card">
    <div class="ssi-tools">
      <label class="ssi-switch">
        <input type="checkbox" id="ssi-similar">
        <span class="ssi-track" aria-hidden="true"></span>
        <span class="ssi-swt"><b>비슷한 날만</b><small>마지막 날과 가장 비슷하게 움직인 8%</small></span>
      </label>
      ${['open', 'close'].map((k) => `
      <div class="ssi-metric" data-metric="${k}" data-name="${k === 'open' ? '시가' : '종가'}" title="막대 위를 끌어 그 범위의 날만 봅니다 · 바깥을 한 번 누르거나 두 번 누르면 전체">
        <div class="ssi-mh"><span class="ssi-mn">${k === 'open' ? '시가' : '종가'} <small>전일 종가 대비</small></span><span class="ssi-mrange">전체</span><button type="button" class="ssi-mreset" hidden>전체 보기</button></div>
        <svg class="ssi-hist" aria-label="${k === 'open' ? '시가' : '종가'}(전일 종가 대비) 분포 — 끌어서 범위 고르기"></svg>
      </div>`).join('')}
      <div class="ssi-period">
        <div class="ssi-cov" id="ssi-cov" aria-live="polite"></div>
        <div class="ssi-range">
          <div class="ssi-rtrack"></div><div class="ssi-rfill" id="ssi-rfill"></div>
          <input type="range" id="ssi-start" min="0" max="0" value="0" step="1" aria-label="기간 시작">
          <input type="range" id="ssi-end" min="0" max="0" value="0" step="1" aria-label="기간 끝">
        </div>
      </div>
    </div>
    <div class="ssi-info">
      <div class="ssi-legend" id="ssi-legend">
        <span class="lg mean"><i></i>평균</span><span class="lg median"><i></i>중앙값</span>
        <span class="lg buy"><i></i>매수 시각</span><span class="lg sell"><i></i>매도 시각</span>
        <span class="lg today" hidden><i></i>오늘 (장중)</span><span class="lg win" hidden><i></i>비교한 구간</span>
      </div>
      <div class="ssi-readout" id="ssi-readout" hidden><span class="ssi-ro" id="ssi-ro"></span><button type="button" class="ssi-rox" id="ssi-rox" aria-label="닫기">×</button></div>
    </div>
    <div class="ssi-chart" id="ssi-chart">
      <div class="ssi-msg" id="ssi-msg"><span class="ssi-spin"></span><span>자료를 불러오는 중…</span></div>
    </div>
    <div class="ssi-foot">
      <div class="ssi-scale" role="group" aria-label="세로축 눈금">
        <button type="button" data-y="log" aria-pressed="true" title="±0.1% 안은 직선, 바깥은 로그 — 0 근처를 넓게, 큰 날도 한 화면에">로그</button><button type="button" data-y="linear" aria-pressed="false" title="보이는 날들의 범위에 맞춘 직선 눈금">직선</button>
      </div>
      <span class="ssi-zone" id="ssi-zone"></span>
    </div>
  </div>`;
}

const siQ = (id) => document.getElementById(id);

function siZoneNote() {
  const open = siFmtClock(SI_OPEN + SC.offset), close = siFmtClock(SI_CLOSE + SC.offset);
  let dst = false;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: SI_MARKET_TZ, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    dst = !!p && /DT$/.test(p.value);
  } catch (e) { /* 무시 */ }
  const el = siQ('ssi-zone');
  if (SI_LOCAL_TZ === SI_MARKET_TZ) el.textContent = `시각: 뉴욕 시간 · 미국 정규장 ${open}~${close}`;
  else el.textContent = `시각: ${SC.zone} · 미국 정규장 ${open}~${close}` + (dst ? ' (미국 서머타임)' : '');
}

function siCoverage(days) {
  const el = siQ('ssi-cov');
  if (!days.length) { el.innerHTML = '<b>0</b>일'; return; }
  el.innerHTML = `<b>${days.length}</b>일 · <b>${siFmtDate(days[0].date)}</b> ~ <b>${siFmtDate(days[days.length - 1].date)}</b>`;
}

function siShowMsg(html, retry) {
  const m = siQ('ssi-msg');
  m.hidden = !html;
  m.innerHTML = html || '';
  if (retry) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ssi-retry'; b.textContent = '다시 불러오기';
    b.addEventListener('click', () => siLoad());
    m.appendChild(b);
  }
}

// 거르기 → 그리기 (조절 장치가 바뀔 때마다)
function siRefresh() {
  if (!SA.ready) return;
  const filtered = SA.periodDays.filter((d) => d.id === SA.latestId || SA.metrics.every((f) => f.pass(d)));
  let days = filtered, cutoff = null, ref = null;
  if (SA.similarOn && filtered.length) {
    ref = filtered[filtered.length - 1];
    ({ days, cutoff } = siSimilar(filtered, ref));
  }
  siCoverage(days);
  SC.data = days;
  SC.aggs = days.length ? siAggregates(days) : [];
  SC.marks = SC.aggs.length ? siMarks(SC.aggs) : [];
  SC.refId = ref ? ref.id : null;
  SC.cutoff = cutoff;
  SC.todayId = SA.latestId;
  SC.opacityCount = filtered.filter((d) => d.id !== SA.latestId).length;
  siRender();
  siShowMsg(days.length ? '' : '조건에 맞는 날이 없습니다 — 시가·종가 범위나 기간을 넓혀 보세요');
  const lg = siQ('ssi-legend');
  lg.querySelector('.today').hidden = !SC.live;
  lg.querySelector('.win').hidden = cutoff === null;
}

async function siFetchText(url, need) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) { if (need) throw new Error(url + ' ' + r.status); return ''; }
  return r.text();
}

async function siLoad() {
  if (SA.loading) return;
  SA.loading = true;
  if (!SA.allDays.length) siShowMsg('<span class="ssi-spin"></span><span>자료를 불러오는 중…</span>');
  try {
    const [t5, t1, tu] = await Promise.all([
      siFetchText(SI_DATA.m5, true),
      siFetchText(SI_DATA.m1, false).catch(() => ''),   // 없어도 됨 (가장 최근 거래일 1분봉)
      siFetchText(SI_DATA.upd, false).catch(() => ''),
    ]);
    const hist = siParseCsv(t5, 5);
    const allDays = siBuildDays(siMergeToday(hist, siParseCsv(t1, 1)));
    if (!allDays.length) throw new Error('빈 자료');
    if (!SA.fontsOk && !SA.allDays.length) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]);
    if (!SA.fontsOk && !SA.allDays.length) SA.drawnBeforeFonts = true;
    siApplyData(allDays, tu);
    SA.loadedAt = Date.now();
    if (!SA.timers) siStartTimers();
  } catch (e) {
    if (!SA.allDays.length) siShowMsg('자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.', true);
  } finally {
    SA.loading = false;
  }
}

function siApplyData(allDays, updatedText) {
  SA.allDays = allDays;
  SA.latestId = allDays[allDays.length - 1].id;
  let lo = Infinity, hi = -Infinity;
  for (const d of allDays) for (const p of d.points) { if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct; }
  SC.yLimit = Math.max(SC.yLimit || 0, Math.ceil(Math.max(-lo, hi)));      // 넓어지기만 함 (새로 불러와도 축이 줄지 않게)
  SA.ready = false;
  const guarded = () => siRefresh();
  SA.metrics = [...SA.root.querySelectorAll('.ssi-metric')].map((b) => siMetric(b.dataset.metric, b, allDays, guarded));
  SA.similarOn = siStore.flag(SI_KEYS.similar, siMarketMinuteNow() !== null);
  siQ('ssi-similar').checked = SA.similarOn;
  siPeriod(allDays, { start: siQ('ssi-start'), end: siQ('ssi-end'), fill: siQ('ssi-rfill') }, (days) => { SA.periodDays = days; guarded(); });
  SA.ready = true;
  siRefresh();
  // 자료 갱신 시각 (보는 사람 시간대)
  const iso = (updatedText || '').trim();
  const when = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z$/.test(iso) ? new Date(iso) : null;
  const f = siQ('ssi-fetched');
  f.innerHTML = (when ? `자료 갱신 <b>${siEsc(new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when))}</b> · ` : '')
    + `${siEsc(siFmtDate(allDays[0].date))} ~ ${siEsc(siFmtDate(allDays[allDays.length - 1].date))} <b>${allDays.length.toLocaleString('ko-KR')}</b>거래일 · 출처 야후 파이낸스 · networthcast`;
}

function siStartTimers() {
  SA.timers = true;
  setInterval(() => siDrawNow(), SI_NOW_MS);
  setInterval(() => { if (!document.hidden) siLoad(); }, SI_DATA_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - SA.loadedAt > SI_DATA_MS) siLoad();
    else if (!document.hidden) siDrawNow();
  });
}

function siOnHoverInfo(info) {
  const ro = siQ('ssi-readout'), lg = siQ('ssi-legend');
  const show = !!info && SC.compact;
  ro.hidden = !show; lg.classList.toggle('dim', show);
  if (!show) return;
  const d = info.day;
  siQ('ssi-ro').innerHTML = `<b>${siFmtDate(d.date)} (${siWeekday(d.date)})${info.today ? ' 오늘' : ''}</b>`
    + ` <span>${siFmtClock(info.minute + SC.offset)}</span> <span class="${siTone(info.dayPct)}">${siFmtPct(info.dayPct)}</span>`
    + ` <span class="mut">· 종가</span> <span class="${siTone(info.close)}">${siFmtPct(info.close)}</span>`;
}

function siInit() {
  const root = document.getElementById('ssi-app');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  SA.root = root;
  siBuildDom(root);
  SC.offset = siLocalOffset(new Date());
  SC.zone = siZoneLabel();
  SC.yType = siStore.flag(SI_KEYS.log, true) ? 'log' : 'linear';
  siChartInit(siQ('ssi-chart'));
  siHoverInit();
  SH.onInfo = siOnHoverInfo;
  SH.keep = siQ('ssi-readout');
  siQ('ssi-rox').addEventListener('click', () => siHoverHide());
  siZoneNote();

  const scaleBtns = [...root.querySelectorAll('.ssi-scale button')];
  const paintScale = () => scaleBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.y === SC.yType)));
  paintScale();
  scaleBtns.forEach((b) => b.addEventListener('click', () => {
    if (SC.yType === b.dataset.y) return;
    SC.yType = b.dataset.y;
    siStore.set(SI_KEYS.log, SC.yType === 'log' ? '1' : '0');
    paintScale();
    siRender();
  }));
  siQ('ssi-similar').addEventListener('change', (e) => {
    SA.similarOn = e.target.checked;
    siStore.set(SI_KEYS.similar, SA.similarOn ? '1' : '0');
    siRefresh();
  });

  // 폭이 바뀌면 다시 그림 (막대 필터는 새 폭으로 다시 그리고, 고른 값은 그대로)
  let lastW = 0, lastH = 0, raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = siQ('ssi-chart').clientWidth, h = window.innerHeight;
      if (w === lastW && (SC.compact || h === lastH)) return;
      lastW = w; lastH = h;
      if (!SA.ready) return;
      SA.metrics.forEach((m) => m.build());
      siRender();
    });
  };
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(siQ('ssi-chart'));
  window.addEventListener('resize', onResize);
  // 글꼴이 늦게 오면(글자 폭으로 상자·눈금 자리를 정하므로) 한 번 다시 그림 — 처음 그리기는 글꼴을 잠깐(최대 0.8초) 기다림
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      SA.fontsOk = true;
      if (SA.ready && SA.drawnBeforeFonts) { SA.metrics.forEach((m) => m.build()); siRender(); }
    });
  } else SA.fontsOk = true;
  // 검증용 읽기 전용 요약 — 자동 시험이 같은 자료에서 원본과 숫자를 대조할 때 씀
  root.ssiState = () => ({
    days: SC.data.map((d) => d.id), all: SA.allDays.length, latest: SA.latestId,
    aggs: SC.aggs.map((a) => [a.minute, a.mean, a.median, a.n]),
    marks: SC.marks.map((m) => ({ kind: m.kind, minute: m.minute, reasons: m.reasons.map((r) => [r.what, r.value]) })),
    refId: SC.refId, cutoff: SC.cutoff, opacityCount: SC.opacityCount, opacity: SC.dayOpacity, live: !!SC.live, similar: SA.similarOn,
    yType: SC.yType, yLimit: SC.yLimit, yTicks: SC.y ? SC.y.ticks.slice() : [], offset: SC.offset, zone: SC.zone,
    metrics: SA.metrics.map((m) => ({ key: m.key, min: m.min, max: m.max, lo: m.lo, hi: m.hi, bins: m.bins.map((b) => [b.x0, b.x1, b.n]) })),
    coverage: siQ('ssi-cov').textContent,
  });
  siLoad();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', siInit);
else siInit();
