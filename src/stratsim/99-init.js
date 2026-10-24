/* ── [STRATSIM] 99 시작 ─────────────────────────────────────────────────
   자료 받기 → 화면 뼈대 → 저장된 상태(주소 # > 브라우저 저장 > 기본) → 첫 계산 */

async function ssBoot() {
  const root = document.getElementById('ss-app');
  if (!root || root.dataset.booted) return;
  root.dataset.booted = '1';
  root.innerHTML = ssShellHtml();
  const panel = document.createElement('aside');
  panel.id = 'ss-panel';
  panel.className = 'ss-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = ssPanelShell();
  document.body.appendChild(panel);
  const mtip = document.createElement('div');
  mtip.id = 'ss-mtip';
  document.body.appendChild(mtip);
  const fail = (msg) => { const t = document.getElementById('ss-loading-t'); if (t) { t.textContent = msg; t.classList.add('err'); } const sp = root.querySelector('.ss-spin'); if (sp) sp.style.display = 'none'; };
  let stamp = '';
  try { const r = await fetch('data/stratsim/updated.txt', { cache: 'no-store' }); if (r.ok) stamp = (await r.text()).trim(); } catch (e) {}
  const v = encodeURIComponent(stamp || String(Date.now()).slice(0, 7));
  let pricesTxt, nfciTxt = '';
  try {
    const [p, n] = await Promise.all([fetch('data/stratsim/prices.csv?v=' + v), fetch('data/stratsim/nfci.csv?v=' + v).catch(() => null)]);
    if (!p.ok) throw new Error('HTTP ' + p.status);
    pricesTxt = await p.text();
    if (n && n.ok) nfciTxt = await n.text();
  } catch (e) { fail('가격 자료를 불러오지 못했습니다 — 새로고침해 주세요.'); return; }
  const days = ssParsePrices(pricesTxt);
  if (days.length < 300) { fail('가격 자료가 올바르지 않습니다 — 새로고침해 주세요.'); return; }
  ssInitData(days, ssParseNfci(nfciTxt));
  if (stamp) {
    const d = new Date(stamp);
    if (!Number.isNaN(d.getTime())) {
      S.fetchedAt = d;
      const f = document.getElementById('ss-fetched'), t = document.getElementById('ss-fetched-t');
      if (f && t) { t.textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); f.hidden = false; }
    }
  }
  // 기본: 청산 = 마지막 분기 · 진입 = 2010년 1분기 (3배 ETF 가 나온 때)
  S.x = DS.q.length - 1;
  S.e = ssDefaultEntry();
  ssLoadStorage();
  ssTxLoad();
  const shared = await ssReadHash();
  let mapped = null;
  if (shared) {
    ssApplyMain(shared, true);
    if (shared.bu && SS_COL[shared.bu]) S.base.bh.ul = shared.bu;
    if (shared.b9) S.base['9sig'] = ssCleanParams('9sig', shared.b9);
    if (shared.bs) S.base.sma = ssCleanParams('sma', shared.bs);
    if (Array.isArray(shared.sc)) mapped = ssImportShared(shared.sc);
    if (Array.isArray(shared.tx) && shared.tx.length) ssTxFromShared(shared.tx);
    const anKey = (k) => { if (typeof k !== 'string') return null; if (k.indexOf('cfg:') !== 0) return k; const i = parseInt(k.slice(4), 10); const c = mapped && mapped[i]; const id = c ? ssResolveShared(c) : null; return id ? 'cfg:' + id : null; };
    if (shared.as) { const k = anKey(shared.as); if (k) S.an.strategy = k; }
    if (shared.ab) { const k = anKey(shared.ab); if (k) S.an.baseline = k; }
    if (Number.isFinite(+shared.act) && +shared.act > 0) S.an.target = +shared.act;
    if (Number.isFinite(+shared.acp)) S.an.growth = +shared.acp;
    if (Number.isFinite(+shared.anp) && +shared.anp > 0) S.an.yMin = +shared.anp;
    if (Number.isFinite(+shared.amp) && +shared.amp > 0) S.an.yMax = +shared.amp;
  }
  if (S.x > DS.q.length - 1) S.x = DS.q.length - 1;
  ssPeriodUI.init(root);
  ssWireShell(root);
  ssWirePills();
  ssWirePanel();
  SB.onResult = (id, ydayOnly) => { if (ydayOnly) { if (ssChart) ssChart.update('none'); return; } ssRender(); };
  SB.onName = (id, name) => {
    const c = ssFindCfg(id);
    if (!c || !/^사용자 전략( \(\d+\))?$/.test(c.name)) return;
    const t = String(name).replace(/\s+/g, ' ').trim();
    if (!t) return;
    c.name = ssUniqueName(t, c.id);
    ssPersistSaved();
    if (S.editing === c.id) ssPanelTitle(c.name);
  };
  ssReady = true;
  ssRender();
  _ssHashTok = (location.hash || '').replace(/^#/, '');
  if (shared) {
    if (shared.rf && shared.rt) ssPinRange(String(shared.rf), String(shared.rt));
    let opened = false;
    const si = parseInt(shared.spc, 10);
    if (mapped && Number.isInteger(si) && mapped[si]) { const id = ssResolveShared(mapped[si]); if (id) { ssOpenCfgPanel(id); opened = true; } }
    if (!opened && (shared.sp === 'bh' || shared.sp === 'invested')) ssOpenBasePanel(shared.sp, true);
    if (shared.am && typeof ssAnalyticsOpen === 'function') ssAnalyticsOpen(!!(shared.as || shared.ab));
  }
  ssTxRefreshSheet();
  if (typeof ssLibraryFromHash === 'function') ssLibraryFromHash();
  // 다른 공유 링크를 같은 페이지에 붙여 넣으면 그 상태로 다시 엶
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace(/^#/, '');
    if (/^ss=/.test(h) && h !== _ssHashTok) location.reload();
    else if (typeof ssLibraryFromHash === 'function') ssLibraryFromHash();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ssBoot);
else ssBoot();
// 시험·문제 확인용 읽기 손잡이 (tests/run_regression.py 등) — 화면·계산에는 영향 없음
window.SSM = Object.freeze({
  get S() { return S; }, get R() { return R; }, get DS() { return DS; }, get chart() { return ssChart; }, get zoom() { return { lo: SZ.lo, hi: SZ.hi }; },
  ready: () => ssReady, render: () => ssRender(), add: (entry) => ssAddFromLibrary(entry),
  openCfg: (id) => ssOpenCfgPanel(id), openBase: (k) => ssOpenBasePanel(k),
});
