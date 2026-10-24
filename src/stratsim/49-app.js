/* ── [STRATSIM] 49 화면 뼈대 · 왼쪽 입력 · 위 도구 막대 · 공유 ─────────────────── */

// 상태가 바뀌면: 저장 → 주소 # → 다시 계산·그리기
function ssChanged() {
  if (!ssReady) return;
  ssPersistMain();
  ssRender();
  ssSyncHash();
}
// 다시 그린 뒤 따라 고칠 것들
function ssAfterRender() {
  ssLegend.render();
  ssRenderPills();
  ssTxSummary();
  if (ssPanel.open) ssRenderPanel();
  if (typeof ssAnalyticsRefresh === 'function') ssAnalyticsRefresh();
  ssShareCard();
}

const SS_SVG = {
  cal: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  up: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  edit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  first: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><line x1="6" y1="12" x2="20" y2="12"/><line x1="3" y1="5" x2="3" y2="19"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  grid: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  book: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
};

function ssShellHtml() {
  const raise = SS_RAISE_OPTS.map((v) => '<option value="' + v + '">' + v + '%</option>').join('');
  return '<div class="ss-top">'
    + '<span class="ss-fetched" id="ss-fetched" hidden title="미국 장이 열린 동안 한 시간마다(마감 뒤 한 번 더) 새 일봉을 받습니다 — 자료 출처는 아래 설명글">가격 자료 갱신 <b id="ss-fetched-t"></b></span>'
    + '<div class="ss-topr"><details class="ss-res" id="ss-res"><summary>자료실 <i>▾</i></summary><div class="ss-resl">'
    + '<a href="tqqq-intraday/">TQQQ 장중 흐름</a><a href="9sig-overfit/">9sig 과최적화 탐색기</a><a href="sma-overfit/">SMA 과최적화 탐색기</a>'
    + '<a href="muhan/">무한매수법</a><a href="muhan-backtest/">무한매수법 백테스트</a><a href="vr/">밸류리밸런싱 VR 5.0</a><a href="vr-backtest/">밸류리밸런싱 VR 5.0 백테스트</a></div></details>'   // 상단 메뉴 '투자전략 자료실'과 같은 목록(2026-10-24)
    + '<button type="button" class="ss-btn ss-sharebtn" id="ss-share" data-ss-share title="지금 설정 그대로 열리는 링크 복사">' + SS_SVG.link + '<span>링크 복사</span></button></div></div>'
    + '<div class="ss-layout">'
    + '<aside class="ss-side card"><div class="ss-sidehead"><button type="button" class="ss-btn ss-anbtn" id="ss-an-open">' + SS_SVG.grid + ' 분석 표</button></div>'
    + '<button type="button" class="ss-btn ss-txmode" id="ss-txmode" hidden></button>'
    + '<div id="ss-contrib">'
    + '<div class="ss-ctl"><div class="ss-ctlh"><label for="ss-init">시작 금액</label><b class="ss-val" id="ss-dinit">$10,000</b></div><input type="range" class="ss-range" id="ss-init" min="0" max="1000" step="1" value="333" aria-label="시작 금액"></div>'
    + '<div class="ss-ctl"><div class="ss-ctlh"><label for="ss-mon">매달 적립</label><span class="ss-ctlr"><b class="ss-val" id="ss-dmon">$500</b><button type="button" class="ss-ibtn" id="ss-txopen" title="슬라이더 대신 내 실제 거래내역 쓰기" aria-label="실제 거래내역 쓰기">' + SS_SVG.up + '</button></span></div>'
    + '<label class="ss-raise" for="ss-raise"><span>해마다</span><select id="ss-raise" class="ss-isel">' + raise + '</select><span>씩 늘림</span></label>'
    + '<input type="range" class="ss-range" id="ss-mon" min="0" max="1000" step="1" value="233" aria-label="매달 적립"></div></div>'
    + '<div id="ss-txon" class="ss-ctl" hidden><div class="ss-txsum" id="ss-txsum"></div><div class="ss-txbtns"><button type="button" class="ss-ibtn" id="ss-txedit" title="거래내역 고치기">' + SS_SVG.edit + '</button><button type="button" class="ss-ibtn" id="ss-txfirst" title="진입일을 첫 거래일로">' + SS_SVG.first + '</button><button type="button" class="ss-ibtn danger" id="ss-txdel" title="거래내역 완전히 지우기">' + SS_SVG.trash + '</button></div></div>'
    + '<button type="button" class="ss-newc" id="ss-newc">+ 사용자 전략 (코드)</button>'
    + '<button type="button" class="ss-libbtn" id="ss-libbtn">' + SS_SVG.book + ' 전략 라이브러리</button>'
    + '<div class="ss-pills" id="ss-pills" hidden></div></aside>'
    + '<section class="ss-main card"><div class="ss-legend" id="ss-legend"></div>'
    + '<div class="ss-chartbox" id="ss-chartbox"><canvas id="ss-chart" role="img" aria-label="전략별 평가액 차트"></canvas>'
    + '<div class="ss-loading" id="ss-loading"><div class="ss-spin"></div><div id="ss-loading-t">가격 자료를 불러오는 중…</div></div>'
    + '<button type="button" class="ss-pillbtn ss-logbtn" id="ss-log" aria-pressed="false" title="세로축을 로그 눈금으로">로그</button>'
    + '<button type="button" class="ss-pillbtn ss-inflbtn" id="ss-infl" aria-pressed="false" title="모든 선을 연 3% 물가로 할인 — 첫 날 기준의 실질 금액으로 보기">물가 반영</button>'
    + '<button type="button" class="ss-pillbtn ss-zoombtn" id="ss-zoom" hidden title="확대를 풀고 전체 기간 보기 (그래프 더블클릭도 같음)">전체 보기</button></div>'
    + '<div id="ss-tip"></div>'
    + '<div class="ss-period"><button type="button" class="ss-play" id="ss-play-l" aria-pressed="false" title="한 분기씩 뒤로 · 재생">◀</button>'
    + '<div class="ss-range2" id="ss-range"><div class="ss-rtrack"></div><div class="ss-rfill"></div>'
    + '<div class="ss-td" id="ss-tde"><span>진입</span><div class="ss-tdr"><b id="ss-de">2010년 1분기</b><button type="button" class="ss-ibtn" id="ss-pick-e" title="진입일 정확히 고르기" aria-label="진입일 정확히 고르기">' + SS_SVG.cal + '</button></div></div>'
    + '<div class="ss-td" id="ss-tdx"><span>청산</span><div class="ss-tdr"><b id="ss-dx">—</b><button type="button" class="ss-ibtn" id="ss-pick-x" title="청산일 정확히 고르기" aria-label="청산일 정확히 고르기">' + SS_SVG.cal + '</button></div></div>'
    + '<div class="ss-th" data-h="e" role="slider" aria-label="진입"></div><div class="ss-th" data-h="x" role="slider" aria-label="청산"></div></div>'
    + '<button type="button" class="ss-play" id="ss-play-r" aria-pressed="false" title="한 분기씩 앞으로 · 재생">▶</button></div>'
    + '</section></div>';
}
function ssPanelShell() {
  return '<div class="ss-pin"><div class="ss-phead"><div class="ss-ptw"><h3 id="ss-ptitle" contenteditable="true" spellcheck="false" title="눌러서 이름 바꾸기">전략</h3><button type="button" class="ss-pedit" aria-label="이름 바꾸기" tabindex="-1">' + SS_SVG.edit + '</button></div>'
    + '<button type="button" class="ss-pclose" aria-label="닫기">×</button></div><div class="ss-pbody" id="ss-pbody"></div><div class="ss-presize" title="끌어서 너비 조절"></div></div>';
}

// ── 왼쪽 입력 ──
const ssSideUI = {
  update(initial, monthly) {
    const di = document.getElementById('ss-dinit'), dm = document.getElementById('ss-dmon');
    if (di) di.textContent = ssMoney(initial);
    if (dm) dm.textContent = ssMoney(monthly);
    const i = document.getElementById('ss-init'), m = document.getElementById('ss-mon'), r = document.getElementById('ss-raise');
    if (i && +i.value !== S.iPos) i.value = S.iPos;
    if (m && +m.value !== S.mPos) m.value = S.mPos;
    if (r && r.value !== S.raise) r.value = S.raise;
    const lg = document.getElementById('ss-log'), fl = document.getElementById('ss-infl');
    if (lg) lg.setAttribute('aria-pressed', S.log ? 'true' : 'false');
    if (fl) fl.setAttribute('aria-pressed', S.infl ? 'true' : 'false');
  },
};
// 거래내역 요약 · 켜기/끄기 단추
function ssTxSummary() {
  const on = !!S.tx, a = document.getElementById('ss-contrib'), b = document.getElementById('ss-txon'), mode = document.getElementById('ss-txmode');
  if (!a || !b) return;
  a.hidden = on; b.hidden = !on;
  if (mode) {
    if (S.tx) { mode.hidden = false; mode.textContent = '슬라이더로 바꾸기'; }
    else if (S.txStash) { mode.hidden = false; mode.textContent = '내 거래 ' + S.txStash.rows.length + '건으로 바꾸기'; }
    else mode.hidden = true;
  }
  if (!on) return;
  const s = S.tx, rows = ['<span class="ss-txr"><b>' + s.rows.length + '</b>건 · <b>' + ssMoney(Math.round(s.total)) + '</b> 투자</span>'];
  if (s.source === 'sheet') rows.push('<span class="ss-txr ss-mut">구글 시트와 동기화</span>');
  if (s.actualPoints && s.actualPoints.length) {
    const m = R.actual, sh = s.showActual !== false;
    const st = sh && m && Number.isFinite(m.cagr) ? '<b class="' + (m.cagr >= 0 ? 'ss-up' : 'ss-dn') + '">' + (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%</b>' + (Number.isFinite(m.maxDD) && m.maxDD > 0 ? ' <span>낙폭 <b class="ss-dn">-' + m.maxDD.toFixed(1) + '%</b></span>' : '') : '';
    rows.push('<span class="ss-txr ss-txact"><button type="button" id="ss-txeye" class="ss-txeye" title="\'내 계좌\' 선 ' + (sh ? '숨기기' : '보이기') + '">' + ssEye(sh) + '</button><i class="ss-cdot" style="background:' + SS_ACTUAL_COLOR + '"></i>내 계좌 ' + st + '</span>');
  }
  document.getElementById('ss-txsum').innerHTML = rows.join('');
  const ed = document.getElementById('ss-txedit'), fs = document.getElementById('ss-txfirst');
  if (ed) ed.title = s.source === 'sheet' ? '연결한 시트 바꾸기' : '거래내역 고치기';
  if (fs) fs.title = '진입일을 첫 거래일(' + ssDate(s.entryDate) + ')로';
}

// 화살표 키: 금액이 실제로 바뀌게 한 칸씩 (로그 눈금이라 위치 1칸은 너무 작음)
function ssArrowStep(el, toV, fromV, steps, max) {
  el.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const cur = toV(+el.value), next = dir > 0 ? cur + steps(cur) : Math.max(0, cur - steps(Math.max(0, cur - 1)));
    let ns = fromV(next), g = 0;
    while (g++ < 2000 && ns >= 0 && ns <= max && ((dir > 0 && toV(ns) <= cur) || (dir < 0 && toV(ns) >= cur))) ns += dir;
    el.value = String(Math.max(0, Math.min(max, ns)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function ssWireShell(root) {
  const $ = (id) => document.getElementById(id);
  $('ss-init').addEventListener('input', (e) => { S.iPos = +e.target.value; ssChanged(); });
  $('ss-mon').addEventListener('input', (e) => { S.mPos = +e.target.value; ssChanged(); });
  $('ss-raise').addEventListener('change', (e) => { S.raise = e.target.value; ssChanged(); });
  ssArrowStep($('ss-init'), ssPosToInitial, ssInitialToPos, (v) => (v < 1e4 ? 100 : v < 1e5 ? 1e3 : v < 1e6 ? 1e4 : v < 1e7 ? 1e5 : 1e6), 1000);
  ssArrowStep($('ss-mon'), ssPosToMonthly, ssMonthlyToPos, (v) => (v < 1500 ? 50 : v < 1e4 ? 100 : v < 1e5 ? 1000 : 10000), 1000);
  $('ss-log').addEventListener('click', () => { S.log = !S.log; ssChanged(); });
  $('ss-infl').addEventListener('click', () => { S.infl = !S.infl; ssChanged(); });
  $('ss-legend').addEventListener('click', (e) => {
    const more = e.target.closest('[data-lg-more]');
    if (more) { ssOpenBasePanel(more.getAttribute('data-lg-more')); return; }
    const chip = e.target.closest('[data-lg]');
    if (!chip) return;
    const k = chip.getAttribute('data-lg');
    const show = S.hide[k];
    S.hide[k] = !show;
    if (show && S.panel !== k) S.base[k] = ssDefaults(k);   // 다시 보이면 기본값으로
    ssChanged();
  });
  $('ss-legend').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-lg]')) { e.preventDefault(); e.target.click(); } });
  $('ss-newc').addEventListener('click', () => ssCreateCustom());
  $('ss-libbtn').addEventListener('click', () => { if (typeof ssLibraryOpen === 'function') ssLibraryOpen(); });
  $('ss-an-open').addEventListener('click', () => { if (typeof ssAnalyticsToggle === 'function') ssAnalyticsToggle(); });
  $('ss-share').addEventListener('click', async () => {
    const b = $('ss-share'), url = await ssShareUrl();
    ssCopy(url, () => { const sp = b.querySelector('span'); sp.textContent = '복사됨 ✓'; b.classList.add('flash'); setTimeout(() => { sp.textContent = '링크 복사'; b.classList.remove('flash'); }, 1800); });
  });
  document.addEventListener('click', (e) => { const m = $('ss-res'); if (m && m.open && !m.contains(e.target)) m.open = false; });
  // 거래내역
  $('ss-txopen').addEventListener('click', () => ssTxOpen());
  $('ss-txedit').addEventListener('click', () => {
    const s = S.tx || S.txStash;
    if (!s) return;
    if (s.source === 'sheet' && s.sheetUrl) ssTxOpen({ url: s.sheetUrl, edit: true, cols: { dc: s.dc, ac: s.ac, xc: s.xc } });
    else ssTxOpen({ text: ssTxToTsv(s.rows), edit: true });
  });
  $('ss-txfirst').addEventListener('click', () => { if (!S.tx) return; ssTxApplyEntry(); ssChanged(); });
  $('ss-txdel').addEventListener('click', () => ssDialog('거래내역 지우기', '저장해 둔 거래내역을 완전히 지울까요? 되돌릴 수 없습니다.', [{ t: '취소' }, { t: '지우기', danger: true, fn: () => { S.tx = null; S.txStash = null; S.ed = ''; ssTxPersist(); ssChanged(); } }]));
  $('ss-txmode').addEventListener('click', () => {
    if (S.tx) { S.tx = null; S.ed = ''; }
    else if (S.txStash) S.tx = S.txStash;
    else return;
    ssTxPersist(); ssChanged();
    if (S.tx) ssTxRefreshSheet();
  });
  $('ss-txsum').addEventListener('click', (e) => {
    if (!e.target.closest('#ss-txeye')) return;
    const cur = S.tx || S.txStash;
    if (!cur) return;
    cur.showActual = cur.showActual === false;
    ssTxPersist(); ssChanged();
  });
}

// 사이트 오른쪽 아래 공유 창의 카드 (지금 보이는 선 중 끝 금액이 가장 큰 것)
function ssShareCard() {
  const reg = (window.dcShareSpec = window.dcShareSpec || {});
  reg['strategy-simulator'] = function () {
    if (!R.ctx || !R.labels.length) return null;
    const vis = R.datasets.filter((d) => !d.hidden && !d.sub && R.metrics[d._key]);
    if (!vis.length) return null;
    const best = vis.slice().sort((a, b) => (R.metrics[b._key].end || 0) - (R.metrics[a._key].end || 0))[0];
    const m = R.metrics[best._key];
    const rows = vis.slice(0, 4).map((d) => { const x = R.metrics[d._key]; return [d.label, (x.cagr >= 0 ? '+' : '') + x.cagr.toFixed(1) + '% · 낙폭 ' + ssDD(x.maxDD), false]; });
    return { key: 'strategy-simulator', chip: '투자전략 시뮬레이터', title: best.label + ' 백테스트',
      label: ssDate(R.ctx.d0) + ' ~ ' + ssDate(R.ctx.d1) + ' · 시작 ' + ssMoney(R.ctx.initial) + ' + 매달 ' + ssMoney(R.ctx.monthly),
      big: (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%', sub: '연평균 수익률(돈 가중) · 끝 금액 ' + ssMoney(m.end), rows,
      source: '실제·합성 일봉 기준 백테스트 · 과거 결과는 미래를 보장하지 않음' };
  };
}
