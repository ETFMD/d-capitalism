/* ── [STRATSIM] 43 전략 패널 (왼쪽에서 열리는 설정·기록 창) ─────────────────────
   기본 선(그냥 보유·현금 복리)과 저장 전략(9sig·SMA·그냥 보유·현금 복리·사용자 전략)의 설정 문장 · 선 색 ·
   통계 4칸 · 거래 기록 표(CSV) · 9sig 설명 · SMA 신호 지표와 '지금 판단' · 사용자 전략 신호 차트 */

const ssPanel = { open: false, drag: false, hideC: false, hideE: false, cHideC: false, cHideE: false };
const SS_EXPLORER = { '9sig': '9sig-overfit/', sma: 'sma-overfit/' };

const ssTipI = (t, wide) => (t ? ' <span class="ss-i" tabindex="0" data-tip="' + ssEsc(t) + '"' + (wide ? ' data-tip-wide' : '') + '>ⓘ</span>' : '');

// 지금 패널이 다루는 대상: { type, owner('base'|cfg id), cfg, params }
function ssPanelTarget() {
  if (S.editing) { const c = ssFindCfg(S.editing); if (c) return { type: c.type, owner: c.id, cfg: c, params: c.params }; }
  if (S.panel) return { type: S.panel, owner: 'base', cfg: null, params: S.base[S.panel] };
  return null;
}
function ssParamsOf(type, owner) { if (owner === 'base') return S.base[type]; const c = ssFindCfg(owner); return c ? c.params : null; }
function ssSetParam(type, owner, k, v) {
  const p = ssParamsOf(type, owner);
  if (!p) return;
  p[k] = typeof v === 'boolean' ? v : String(v);
  if (owner !== 'base') ssPersistSaved();
  ssChanged();
}

// ── 열기·닫기 ──
function ssOpenBasePanel(type, keep) {
  S.editing = null; S.pendingName = null;
  if (!keep) S.base[type] = ssDefaults(type);   // 열 때는 늘 기본값 사본에서 시작 (공유 링크로 열린 창은 링크 값 그대로)
  S.hide[type] = false;                      // 숨겨 둔 선이면 다시 보이게
  S.panel = type;
  ssShowPanel();
  ssPanelTitle(type === 'bh' ? '그냥 보유 ' + S.base.bh.ul.toUpperCase() : '현금 복리');
  ssChanged();
}
function ssOpenCfgPanel(id) {
  const c = ssFindCfg(id);
  if (!c) return;
  S.pendingName = null; S.panel = null; S.editing = id;
  ssShowPanel();
  ssPanelTitle(c.name);
  ssChanged();
}
function ssShowPanel() {
  const p = document.getElementById('ss-panel');
  if (!p) return;
  ssPanel.open = true;
  p.classList.add('open');
  p.setAttribute('aria-hidden', 'false');
}
function ssClosePanel() {
  const p = document.getElementById('ss-panel');
  if (S.panel) S.base[S.panel] = ssDefaults(S.panel);   // 기본 선은 닫으면 기본값으로
  S.editing = null; S.panel = null; S.pendingName = null;
  ssPanel.open = false;
  ssClosePd(); ssCloseColor(true); ssCloseCp();
  if (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
  SM.hover = null; ssHideMarkerTip();
  ssChanged();
}
// 기본 패널에서 바꾼 것이 있으면 닫기 전에 물어봄 (저장 전략은 바로바로 저장되므로 묻지 않음)
function ssAttemptClose() {
  if (S.panel && !ssParamsEqual(S.panel, S.base[S.panel], ssDefaults(S.panel))) {
    const type = S.panel;
    ssDialog('바꾼 설정을 저장할까요?', '<b>' + ssEsc(SS_TYPE_NAMES[type]) + '</b> 설정을 바꿨습니다. 기본 선은 바꾼 값을 기억하지 않아 닫으면 기본값으로 돌아갑니다. 새 전략으로 저장해 둘까요?',
      [{ t: '그냥 닫기', fn: () => ssClosePanel() }, { t: '저장', pri: true, fn: () => { ssSaveFromBase(type); ssClosePanel(); } }]);
    return;
  }
  ssClosePanel();
}
function ssPanelTitle(t) { const el = document.getElementById('ss-ptitle'); if (el && el.textContent !== t) el.textContent = t; }
function ssCommitTitle(text) {
  const name = String(text || '').replace(/\s+/g, ' ').trim();
  if (S.editing) {
    const c = ssFindCfg(S.editing);
    if (c) { if (name) ssRenameCfg(c.id, name); ssPanelTitle(c.name); }
  } else S.pendingName = name || null;
}

// 기본 패널의 지금 값 → 새 저장 전략 (그 사본을 편집 중으로 · 기본 선은 숨김)
function ssSaveFromBase(type) {
  const params = Object.assign({}, S.base[type]);
  const cfg = { id: ssNewId(), type, name: ssUniqueName(S.pendingName || SS_TYPE_NAMES[type]), params, color: ssBaseColor(type), hidden: false };
  S.pendingName = null;
  S.saved.push(cfg);
  ssPersistSaved();
  S.base[type] = ssDefaults(type);
  S.hide[type] = true;
  if (S.panel === type) { S.panel = null; S.editing = cfg.id; ssPanelTitle(cfg.name); }
  ssChanged();
  ssFlashSaved(cfg.id);
}
function ssRenameCfg(id, name) {
  const c = ssFindCfg(id);
  if (!c) return;
  const n = ssUniqueName(String(name).replace(/\s+/g, ' ').trim(), id);
  if (!n || n === c.name) return;
  c.name = n; ssPersistSaved(); ssChanged();
}
function ssFlashSaved(id) {
  const b = document.querySelector('#ss-pbody .ss-savebar .ss-btn.pri');
  if (b) { const t = b.textContent; b.classList.add('flash'); b.textContent = '✓ 저장됨'; setTimeout(() => { if (b.isConnected) { b.classList.remove('flash'); b.textContent = t; } }, 1100); }
  const pill = document.querySelector('.ss-pill[data-id="' + id + '"]');
  if (pill) { pill.classList.add('flash'); setTimeout(() => pill.classList.remove('flash'), 1100); }
}

// ── 조절 칸 (막대 미리보기 드롭다운의 단추) ──
function ssCtl(type, owner, k, extraCls) {
  const p = ssParamsOf(type, owner) || {};
  const dis = type === '9sig' && k === 'dep' && !(ssPosToMonthly(S.mPos) > 0) && !S.tx;
  return '<button type="button" class="ss-pd' + (extraCls ? ' ' + extraCls : '') + '" data-pd-type="' + type + '" data-pd-own="' + owner + '" data-pd-k="' + k + '"' + (dis ? ' disabled title="매달 적립금이 0원보다 클 때만 의미가 있습니다 (시작 금액에는 해당 없음)"' : '') + '><span>' + ssEsc(ssOptLabel(type, k, p[k])) + '</span><i>▾</i></button>';
}
function ssCtls9(owner) {
  const p = ssParamsOf('9sig', owner);
  const c = (k) => ssCtl('9sig', owner, k);
  const stock = 100 - (+p.cash || 0);
  return '<div class="ss-cg">'
    + '<a class="ss-explore" target="_blank" rel="noopener" href="' + SS_EXPLORER['9sig'] + '">🔬 과최적화 탐색기 — 1971·1990·2010년부터 기간별로 가장 잘 맞았던 9sig 설정 ↗</a>'
    + '<p class="ss-line">시작 금액의 ' + c('cash') + ' 를 ' + c('park') + ssTipI('안전 몫(현금 %)은 기본적으로 현금으로 두고 아래 이자를 받습니다. QQQ·SPY 등을 고르면 그 몫을 그 종목으로 들고 있게 되고, 새 돈과 리밸런스도 그 종목으로 사고팝니다(현금 이자는 붙지 않음). 레버리지 종목을 고르면 두 몫 모두 레버리지가 됩니다.') + ' 로 두고, 나머지 <b>' + stock + '%</b>로 ' + c('ul') + ' 를 삽니다.</p>'
    + (p.park === 'cash' ? '<p class="ss-line">그 현금에는 연 ' + c('cr') + ' 이자가 붙습니다.' + ssTipI('리밸런스 사이에 9sig 가 들고 있는 현금이 받는 연이자입니다. SMA 전략·현금 복리 선의 이자와는 따로입니다.') + '</p>' : '')
    + '<p class="ss-line">' + c('per') + ssTipI('리밸런스 주기입니다. 원래 9sig 는 분기마다 9% 목표라서, 옆의 성장률은 \'고른 주기마다\'로 읽힙니다 — 분기 + 9% 면 목표가 분기마다 9% 씩 큽니다.') + ' 리밸런스하고 목표를 ' + c('g') + ' 씩 키웁니다.' + ssTipI('3배 ETF(TQQQ·SPXL)에는 분기 9% 가 표준입니다. 2배(QLD·SSO)라면 낮추세요.') + '</p>'
    + '<p class="ss-line">폭락장: 주가가 지난 ' + c('cw') + ' 최고점보다 ' + c('cd') + ' 넘게 떨어져 있으면 팔지 않고 버팁니다.' + ssTipI('주가가 최근 고점보다 이만큼 떨어져 있으면 원래 팔아야 할 때도 최대 두 번(연속)까지 매도를 건너뜁니다 — 바닥에서 던지지 않도록. 기간은 \'최근 고점\'을 얼마나 거슬러 볼지이며, 표준은 2년입니다.') + '</p>'
    + '<p class="ss-line">급등: 한 기간에 ' + c('sp') + ' 넘게 오르면 주식 비중을 ' + c('st') + ' 로 낮춰 이익을 챙깁니다.' + ssTipI('한 주기(표준은 분기)에 이만큼 넘게 오르면 시작 비중으로 강제 리밸런스해, 급등 뒤 한 종목에 너무 쏠리지 않게 합니다. \'끔\'이면 오름세를 그대로 둡니다.') + '</p>'
    + '<p class="ss-line">살 때는 현금의 ' + c('bp') + ' 까지만 씁니다.' + ssTipI('사야 할 때 현금 중 이 비율까지만 써서 늘 여유 현금을 남깁니다. 표준 9sig 는 90%(10% 남김). 100%면 매번 현금을 다 씁니다.') + '</p>'
    + '<p class="ss-line">리밸런스 거래마다 수수료·슬리피지 ' + c('cost') + ' 가 듭니다.' + ssTipI('리밸런스 때 사고판 금액에 붙는 거래 비용입니다 — 매도·매수·급등 되돌림·바로 투자한 적립금 모두. 0.02% 는 개인 투자자에게 현실적인 추정치입니다.') + '</p>'
    + '</div>'
    + '<div class="ss-cg ss-whatif">'
    + '<div class="ss-cgt">적립금 바로 투자</div><p class="ss-line">매달 적립금의 ' + c('dep') + ' 를 바로 주식에 넣습니다.</p>'
    + '<p class="ss-note">매달 적립금에만 해당합니다(시작 금액은 아님). 0%면 다음 리밸런스까지 적립금을 현금으로 두고, 높이면 그만큼을 그 달 가격에 바로 삽니다.</p>'
    + '<div class="ss-cgt">리밸런스 시점</div><p class="ss-line">각 기간의 ' + c('rp') + ' 지점에서 리밸런스합니다.</p>'
    + '<p class="ss-note">기간 안 어디서 확인할지 — 0% = 기간 시작 무렵, 100% = 기간 끝 무렵. 정확한 날짜에 결과가 얼마나 민감한지 시험해 볼 수 있습니다.</p>'
    + '<div class="ss-cgt">목표 성장 기준</div><p class="ss-line">다음 목표를 ' + c('tc') + ' 에서 키웁니다.</p>'
    + '<p class="ss-note">예 (9% 성장): 지난 목표가 $10,000 인데 실제로 $8,000 만 들고 있었다면, 다음 목표는 직전 보유액 기준 <b>$8,720</b>(8,000 × 1.09), 직전 목표액 기준 <b>$10,900</b>(10,000 × 1.09).</p>'
    + '</div>';
}
function ssCtlsSma(owner) {
  const p = ssParamsOf('sma', owner), c = (k) => ssCtl('sma', owner, k);
  return '<div class="ss-cg">'
    + '<a class="ss-explore" target="_blank" rel="noopener" href="' + SS_EXPLORER.sma + '">🔬 과최적화 탐색기 — 1971·1990·2010년부터 기간별로 가장 잘 맞았던 SMA 설정 ↗</a>'
    + '<p class="ss-line">' + c('sig') + ' 종가가 ' + c('win') + '일 이동평균 위에 있으면 ' + c('ul') + ' 를 삽니다.</p>'
    + '<p class="ss-line">살 때는 평균보다 ' + c('eb') + ' 이상 위, 팔 때는 ' + c('xb') + ' 이상 아래여야 합니다.</p>'
    + '<p class="ss-line">신호가 ' + c('cb') + ' 일 이어져야 사고, ' + c('cs') + ' 일 이어져야 팝니다.' + ssTipI('잦은 들락날락을 막습니다.\n가격이 선 반대편에 이 날수만큼 머물러야 거래합니다.\n\n예: 3 —\nQQQ 가 하루 선 아래로 내려갔다 반등하면 팔지 않습니다. 3일 연속 아래에서 마감해야 팝니다.\n\n0 = 처음 넘는 날 바로 거래.') + '</p>'
    + '<p class="ss-line">거래한 뒤 다음 거래까지 ' + c('settle') + ' 거래일 기다립니다.' + ssTipI('현금 계좌 결제(T+N).\n\n사고판 뒤 돈·주식이 결제되기 전에는 다음 거래를 할 수 없습니다 — 산 직후 바로 팔거나 판 직후 바로 사는 것을 막는 실제 증권사 규칙을 흉내 냅니다.\n\n예: 2 — 월요일에 팔면 수요일부터 다시 살 수 있습니다.\n\n0 = 바로 결제(제한 없음).') + '</p>'
    + '<p class="ss-line">RSI(' + c('ohw') + ')' + ssTipI('RSI 는 0~100 의 속도계입니다:\n• 약 70 이상 = 빠르게 올라 쉬어 가기 쉬움\n• 약 30 이하 = 많이 맞아 반등하기 쉬움\n\nRSI( ) 안의 숫자 = 며칠을 돌아볼지(2~30).\n2 = 작은 흔들림에도 반응, 30 = 느리고 부드러움. 10 이 흔한 중간값.\n\n이건 파는 쪽 RSI 입니다 — 사는 규칙은 아래에 따로 있습니다.') + ' 가 ' + c('oh') + ' 면 그래도 팝니다.</p>'
    + '<p class="ss-line">RSI(' + c('coolw') + ') 가 ' + c('cool') + ' 일 때만 삽니다.' + ssTipI('사라는 신호가 나와도 쫓아 사지 않고 식기를 기다립니다.\n\n예: 40 —\nRSI 가 40 아래로 내려올 때(눌림목)까지 기다렸다 삽니다.\n\nRSI( ) 안의 숫자 = 돌아볼 날수(2~30).\n끔 = 사라는 신호가 나오면 바로 삽니다.') + '</p>'
    + '<div class="ss-cgt">팔았을 때 들고 있을 것</div>'
    + '<p class="ss-line">시장 밖에 있을 땐 ' + c('out') + ' 를 들고 있습니다.' + ssTipI('팔고 난 뒤 들고 있을 것.\n\n• 현금 — 아래 이자를 받으며 기다림\n• QQQ / SPY — 레버리지 없는 시장에 그대로 머묾: 3배보다 훨씬 안전하지만 시장이 오르면 같이 오름\n\n예: TQQQ 매도 → QQQ 보유 → 사라는 신호가 돌아오면 다시 TQQQ.') + '</p>'
    + (p.out === 'cash' ? '<p class="ss-line">그 현금에는 연 ' + c('cr') + ' 이자가 붙습니다.' + ssTipI('시장 밖에서 현금으로 있는 동안 받는 연이자입니다 — 예금·단기 국채처럼.\n\n예: 4% = 다시 살 때까지 현금이 연 4% 쯤 불어남.') + '</p>' : '')
    + '<div class="ss-cgt">나눠서 사기' + ssTipI('기본은 모든 거래를 한 번에 합니다. 여기서 사는 쪽을 여러 날에 나눌 수 있습니다 — 하루 가격에 다 걸지 않도록. 파는 것은 늘 그날 한 번에.\n\n예: 대기 종목 나눠 사기 5일 — 전략이 빠지는 날 주 종목을 바로 현금으로 팔고, 이후 5거래일 동안 대기 종목을 하루 한 조각씩 삽니다. 2개월이면 약 두 달에 걸쳐 나눕니다. 다 사기 전에 사라는 신호가 돌아오면 멈추고 주 종목으로 갈아탑니다.') + '</div>'
    + '<p class="ss-line">살 때는 주 종목을 ' + c('din') + ' 에 걸쳐 나눠 삽니다.</p>'
    + '<p class="ss-line">팔 때는 대기 종목으로 ' + c('dout') + ' 에 걸쳐 나눠 옮깁니다.' + ssTipI('현금 대신 QQQ/SPY 에 머물 때만 의미가 있습니다.\n\n팔 때 3배 종목은 바로 팔고, 그다음 이 기간에 걸쳐 QQQ/SPY 를 나눠 삽니다.\n\n중간에 사라는 신호가 돌아오면 멈추고 3배 종목으로 돌아갑니다.') + '</p>'
    + '<div class="ss-cgt">거래 비용</div>'
    + '<p class="ss-line">사고팔 때마다 수수료·슬리피지 ' + c('cost') + ' 가 듭니다.' + ssTipI('거래마다 드는 비용 — 증권사 수수료 + 슬리피지(예상 가격과 실제 체결 가격의 차이).\n\n사고팔 때 모두 붙으므로 종목을 갈아타면 두 번 냅니다.\n\n예: 0.1% 면 $10,000 매수가 $9,990 어치가 됩니다. 자주 거래하는 전략일수록 여러 번 내므로, 올려 보면 현실 마찰이 결과를 얼마나 깎는지 보입니다.') + '</p>'
    + '<div class="ss-cgt">버블 보험' + ssTipI('거품 브레이크. 시장이 평균선 위로 아주 멀리 달아났을 때(1999년·2021년 말처럼) 3배 종목을 들고 있는 것은 특히 위험합니다 — 그래서 이 규칙은 주 신호와 상관없이 전부 현금으로 미리 팝니다. 고른 종목이 자기 이동평균보다 얼마나 위에 있는지로 재며, 위의 \'팔았을 때 들고 있을 것\'(보통 매도 때만 적용)과는 따로입니다.') + '</div>'
    + '<p class="ss-line">' + c('bga') + ' 가 ' + c('bgw') + '일 이동평균보다 ' + c('bg') + ' 위면 전부 현금으로 팝니다.</p>'
    + '</div>';
}
function ssCtlsBh(owner) {
  return '<div class="ss-cg"><p class="ss-line">진입할 때 ' + ssCtl('bh', owner, 'ul') + ' 를 사고, 매달 적립금도 계속 사 모으며 팔지 않습니다.' + ssTipI('시작 금액을 진입일에 사고 매달 적립금도 같은 종목을 더 삽니다. 아무것도 팔지 않습니다.') + '</p></div>';
}
function ssCtlsInv(owner) {
  const p = ssParamsOf('invested', owner);
  const r = ssPosToRate(+p.r || 0);
  return '<div class="ss-cg"><p class="ss-note" style="margin-bottom:10px">모든 적립금을 주식 대신 이자 붙는 현금으로만 모았다면 얼마가 되는지 보여 주는 기준선입니다. 9sig·SMA 전략의 현금 이자는 각 전략 설정에서 따로 정합니다.</p>'
    + '<div class="ss-rate"><span>현금 이자율 (연)</span><b id="ss-rate-v">' + r.toFixed(1) + '%</b></div>'
    + '<input type="range" class="ss-range" id="ss-rate" data-own="' + owner + '" min="0" max="1000" step="1" value="' + (+p.r || 0) + '" aria-label="현금 이자율"></div>';
}

// ── 통계 4칸 ──
function ssStatCard(label, icon, value, cls, sub, tip, delta) {
  return '<div class="ss-stat"><div class="ss-sth"><span class="ss-stl">' + label + ssTipI(tip) + '</span>' + ssIco(SS_ICON[icon] || '', 'ss-sti') + '</div>'
    + '<div class="ss-stv ' + (cls || '') + '">' + value + (delta && delta.text ? ' <span class="ss-std ' + (delta.tone || '') + '">' + delta.text + '</span>' : '') + '</div>' + (sub ? '<div class="ss-sts">' + sub + '</div>' : '') + '</div>';
}
function ssStatsGrid(m) {
  if (!m) return '';
  const cs = Number.isFinite(m.cagr) ? (m.cagr >= 0 ? '+' : '') + m.cagr.toFixed(1) + '%' : '–';
  return '<div class="ss-stats">'
    + ssStatCard('연평균 수익률', m.cagr >= 0 ? 'trendUp' : 'trendDown', cs, m.cagr >= 0 ? 'ss-up' : 'ss-dn', '', '돈 가중 연수익률(IRR).\n\n넣은 돈마다 실제로 투자된 기간만큼 가중하므로, 일찍 넣은 돈이 더 크게 칩니다 — 단순히 끝÷시작으로 구한 값보다 정확합니다.')
    + ssStatCard('시작 금액', 'dollar', ssMoney(Math.round(m.start || 0)), '', '', '고른 기간이 시작될 때의 평가액 — 여기서 처음 투자한 금액입니다.')
    + ssStatCard('끝 금액', 'flag', ssMoney(Math.round(m.end || 0)), '', '', '고른 기간이 끝날 때의 평가액. 차트에서 이 선이 끝나는 자리입니다.')
    + ssStatCard('최대 낙폭', 'trendDown', ssDD(m.maxDD), 'ss-dn', ssDDRange(m.ddPeak, m.ddTrough), '기간 중 고점에서 저점까지 가장 크게 떨어진 비율 — 매일 종가로 다시 평가하므로 분기 중간의 폭락도 잡힙니다. 아래 날짜가 언제였는지입니다.')
    + '</div>';
}

// ── 기록 표 ──
function ssLogHead(title, mt) {
  return '<div class="ss-sec" style="margin-top:' + (mt == null ? 24 : mt) + 'px"><span>' + title + '</span><button type="button" class="ss-csv" data-csv title="CSV 로 받기"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>CSV</button></div>';
}
const SS_LATEST_TIP = '가장 최근 값이고 이 기간은 아직 끝나지 않았습니다. 가격은 장중 몇 시간 뒤에 받은 값이라 남은 시간 동안 크게 움직일 수 있고 실제 종가와 다를 수 있습니다. 다음 날 자료로 갱신됩니다.';
const ssLatest = (last) => (last ? ssTipI(SS_LATEST_TIP) : '');
const ssNewMoney = (log) => log.map((l, i) => (i === 0 ? l.invested : l.invested - log[i - 1].invested));
function ss9ActLabel(a) {
  if (!a) return '';
  if (a.k === 'START') return '시작';
  if (a.k === 'SELL') return '매도 ' + ssMoney(a.amt) + (a.late ? ' (보류 끝)' : '');
  if (a.k === 'HOLD') return a.crash ? '보류 (폭락 ' + a.crash + '/2)' : '유지';
  if (a.k === 'BUY') return '매수 ' + ssMoney(a.amt) + (a.part ? ' (일부)' : '');
  if (a.k === 'RESET') return '되돌림 ' + ssMoney(a.amt) + ' (급등)';
  if (a.k === 'SNAPSHOT') return '현재 평가';
  return a.k;
}
function ssLog9Html(log, ul) {
  if (!log || !log.length) return '';
  const nm = ssNewMoney(log), L = log.length - 1, U = ul.toUpperCase();
  const rows = log.map((l, i) => {
    const k = l.act && l.act.k, ac = k === 'SELL' ? 'ss-dn' : k === 'BUY' ? 'ss-up' : 'ss-hold';
    const sh = l.price > 0 ? l.holdVal / l.price : 0;
    return '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td>' + (i === 0 ? '처음' : '리밸런스') + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td>'
      + '<td>' + ssLogPrice(l.price) + '</td><td>' + ssLogShares(sh) + '</td><td>' + ssMoney(Math.round(l.holdVal)) + '</td><td class="ss-tgt">' + ssMoney(Math.round(l.target)) + '</td><td>' + ssMoney(Math.round(l.cash)) + '</td><td>' + ssMoney(Math.round(l.total)) + '</td>'
      + '<td>' + (!l.fee ? '—' : l.fee >= 1 ? ssMoney(Math.round(l.fee)) : '+$' + l.fee.toFixed(2)) + '</td><td class="' + ac + ' ss-act">' + ss9ActLabel(l.act) + '</td></tr>';
  }).join('');
  return '<div class="ss-logsec">' + ssLogHead('리밸런스 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('줄 번호. 처음 자리가 0 이고 리밸런스마다 하나씩 늘어 — 마지막 번호가 리밸런스 횟수입니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>' + U + ' 가격</th><th>' + U + ' 주수</th><th>' + U + ' 평가액</th><th>목표</th><th>현금</th><th>합계</th><th>수수료' + ssTipI('이 리밸런스에서 낸 거래 비용(수수료 % × 거래 금액) — 매도·매수·급등 되돌림·바로 투자한 적립금. 유지만 한 리밸런스는 0(—).') + '</th><th>동작</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}
function ssLogBhHtml(log, series, ul) {
  if (!log || !log.length || !series || !series.length) return '';
  const nm = ssNewMoney(log), n = log.length, L = n - 1, U = ul.toUpperCase();
  const hasC = nm.some((m, i) => i > 0 && m > 0);
  const idx = hasC ? log.map((_, i) => i) : n > 1 ? [0, L] : [0];
  const rows = idx.map((i) => {
    const s = series[i] || {};
    const t = i === 0 ? '처음 매수' : hasC ? (nm[i] > 0 ? '매달 적립' : '보유') : '최근';
    return '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(log[i].date) + '</td><td>' + t + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td><td>' + ssLogPrice(s.price) + '</td><td>' + ssLogShares(s.shares) + '</td><td>' + ssMoney(Math.round(s.value || 0)) + '</td></tr>';
  }).join('');
  return '<div class="ss-logsec">' + ssLogHead('그냥 보유 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('전체 가격 기록에서의 줄 번호(처음 매수가 0). 적립이 없으면 표를 첫 줄과 마지막 줄만 남겨 번호가 건너뛸 수 있습니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>' + U + ' 가격</th><th>' + U + ' 주수</th><th>평가액</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}
function ssLogInvHtml(log) {
  if (!log || !log.length) return '';
  const nm = ssNewMoney(log), L = log.length - 1;
  const rows = log.map((l, i) => '<tr' + (i === L ? ' class="last"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td>' + (i === 0 ? '처음' : nm[i] > 0 ? '매달 적립' : '이자') + ssLatest(i === L) + '</td><td>' + (nm[i] > 0 ? ssMoney(Math.round(nm[i])) : '—') + '</td><td>' + ssMoney(Math.round(l.base)) + '</td></tr>').join('');
  return '<div class="ss-logsec">' + ssLogHead('현금 복리 기록') + '<div class="ss-tw"><table><thead><tr><th>#' + ssTipI('줄 번호 — 첫 줄이 0 이고 하나씩 늘어납니다.') + '</th><th>날짜</th><th>종류</th><th>새 돈</th><th>평가액</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

// SMA 로그 한 줄 → { 이름, 직전 대비 수익률, 색 } — 표와 차트 풍선이 같이 씀
function ssSmaRowInfo(log, i, ul) {
  const l = log[i], prev = i > 0 ? log[i - 1] : null;
  const held = String(l.held || l.state || '').toUpperCase(), from = prev ? String(prev.held || prev.state || '').toUpperCase() : '';
  const T = (x) => (x === 'CASH' ? '현금' : x);
  const swap = (a, b) => (a === 'CASH' ? T(b) + ' 매수' : b === 'CASH' ? T(a) + ' 매도 → 현금' : T(a) + ' 매도 → ' + T(b) + ' 매수');
  let label;
  switch (l.action) {
    case 'CONTRIB': label = '+ ' + ssMoney(Math.round(l.contribAmt || 0)); break;
    case 'DCA-ADD': label = T(held) + ' 나눠 사기'; break;
    case 'ENTER': case 'EXIT': label = swap(from, held); break;
    case 'BG-GTFO': label = '버블: ' + T(from) + ' 매도 → 현금'; break;
    case 'BG-CLEAR': label = '버블 끝: ' + T(held) + ' 매수'; break;
    case 'START': label = '시작'; break;
    case 'END': label = '기간 끝'; break;
    default: label = l.action;
  }
  let gain = null;
  if (prev && prev.total > 0 && l.date !== prev.date) gain = (l.total - prev.total - ((l.invested || 0) - (prev.invested || 0))) / prev.total * 100;
  const ac = l.action === 'EXIT' || l.action === 'BG-GTFO' ? 'ss-dn' : l.action === 'ENTER' || l.action === 'DCA-ADD' ? 'ss-up' : 'ss-hold';
  return { label, gain, ac };
}
function ssHoldTime(log, heldOf) {
  const ms = {};
  let tot = 0;
  for (let i = 0; i < log.length - 1; i++) {
    const a = heldOf(log[i]);
    if (!a) continue;
    const dt = Date.parse(log[i + 1].date) - Date.parse(log[i].date);
    if (dt > 0) { ms[a] = (ms[a] || 0) + dt; tot += dt; }
  }
  if (!(tot > 0)) return '';
  const chips = Object.entries(ms).sort((a, b) => b[1] - a[1]).map(([a, v]) => { const y = v / 31557600000; return '<span class="ss-htc"><b>' + ssEsc(a === 'CASH' ? '현금' : a) + '</b> ' + (v / tot * 100).toFixed(1) + '% <i>(' + (y >= 1 ? y.toFixed(1) + '년' : Math.round(y * 12) + '개월') + ')</i></span>'; }).join('');
  return '<div class="ss-htime"><span>종목별 보유 기간:</span>' + chips + '</div>';
}
function ssLogSmaHtml(log, ul) {
  if (!log || !log.length) return '';
  const U = ul.toUpperCase();
  const rows = log.map((l, i) => {
    const info = ssSmaRowInfo(log, i, U);
    const g = info.gain != null ? ' <span class="' + (info.gain >= 0 ? 'ss-up' : 'ss-dn') + '">(' + (info.gain >= 0 ? '+' : '−') + Math.abs(info.gain).toFixed(1) + '%)</span>' : '';
    const mk = !!(SS_EVT[l.action] && l.total > 0);
    const cls = mk ? 'mk' : l.action === 'CONTRIB' ? 'rc' : l.action === 'DCA-ADD' ? 'rd' : '';
    const fee = !l.fee ? '—' : l.fee >= 1 ? ssMoney(Math.round(l.fee)) : '$' + l.fee.toFixed(2);
    const tot = l.total || 0, pf = tot > 0 ? (l.stockVal || 0) / tot * 100 : 0, pc = tot > 0 ? (l.cash || 0) / tot * 100 : 0;
    const mix = [];
    if (pf >= 0.5) mix.push(Math.round(pf) + '% ' + String(l.held || '').toUpperCase());
    if (pc >= 0.5) mix.push(Math.round(pc) + '% 현금');
    const held = String(l.held || l.state || '').toUpperCase();
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + (mk ? ' data-mkey="' + i + '"' : '') + '><td>' + i + '</td><td>' + ssLogDate(l.date) + '</td><td class="' + info.ac + '">' + ssEsc(info.label) + g + '</td><td>' + (held === 'CASH' ? '현금' : held) + '</td><td class="ss-mix">' + (mix.length ? mix.join(' · ') : tot > 0 ? '100% 현금' : '—') + '</td>'
      + '<td>' + (l.shares > 0 ? ssLogPrice(l.stockVal / l.shares) : '—') + '</td><td>' + ssLogShares(l.shares) + '</td><td>' + ssMoney(Math.round(l.stockVal)) + '</td><td>' + ssMoney(Math.round(l.cash)) + '</td><td>' + ssMoney(Math.round(l.total)) + '</td><td>' + ssMoney(l.invested) + '</td><td>' + fee + '</td></tr>';
  }).join('');
  const nc = log.filter((l) => l.action === 'CONTRIB').length, ne = log.filter((l) => l.action === 'DCA-ADD').length;
  const tg = (nc ? '<label class="ss-chk"><input type="checkbox" data-hide="c"' + (ssPanel.hideC ? ' checked' : '') + '> 매달 적립 줄 숨기기 (' + nc + ')</label>' : '') + (ne ? '<label class="ss-chk"><input type="checkbox" data-hide="e"' + (ssPanel.hideE ? ' checked' : '') + '> 나눠 사기 조각 숨기기 (' + ne + ')</label>' : '');
  const th = (t, tip) => '<th>' + t + ssTipI(tip) + '</th>';
  return '<div class="ss-logsec">' + ssLogHead('SMA 거래 기록') + '<div class="ss-chks">' + tg + '</div><div class="ss-tw' + (ssPanel.hideC ? ' hide-c' : '') + (ssPanel.hideE ? ' hide-e' : '') + '"><table><thead><tr>'
    + th('#', '사건 번호. 시작(첫 자리)이 0 이고 거래·매달 적립마다 하나씩 늘어 — 마지막 번호가 이 기간의 사건 수입니다.')
    + th('날짜', '이 줄이 일어난 거래일.\n\n전략이 실제로 뭔가 한 날만 적습니다 — 대부분의 날은 그냥 들고 있어서 나오지 않습니다.')
    + th('동작', '이날 한 일:\n\n• 시작 — 첫 자리\n• A 매도 → 현금 — 들고 있던 것을 팔아 현금으로\n• B 매수 — B 를 삼\n갈아타기는 같은 날 두 줄(매도 후 매수)로 나옵니다 — 실제로 두 번 거래하고 비용도 두 번 냅니다.\n• B 나눠 사기 — 나눠 사는 한 조각(각자 비용). \'나눠 사기 조각 숨기기\'로 접을 수 있음\n• + $X — 매달 적립금이 들어옴\n• 버블: A 매도 → 현금 — 버블 브레이크가 전부 현금으로\n• 버블 끝: B 매수 — 브레이크가 풀려 다시 삼\n• 기간 끝 — 기간 마지막의 평가(거래 아님) · 합계가 차트 끝값과 같음\n\n괄호 속 (%) 는 직전 동작 이후의 수익·손실입니다 — 그사이 들어온 적립금은 빼고 계산해, 들고 있던 것 자체의 수익률입니다.')
    + th('보유', '이 거래 직후 실제로 들고 있던 것:\n\n• ' + U + ' — 3배 종목에 모두 투자\n• QQQ / SPY — 레버리지 없는 종목(훨씬 안전)\n• 현금 — 시장 밖\n\n추세 신호와 다를 수 있습니다: 버블 브레이크가 걸리면 추세는 \'안\'이어도 실제로는 현금에 있습니다.')
    + th('구성', '지금 돈이 어떻게 나뉘어 있는지: 주 종목(' + U + ') 또는 대기 종목 비율 vs 현금.\n\n나눠 사는 중이면 일부만 투자된 상태 — 예: \'58% SPXL · 42% 현금\'.')
    + th('종목 가격', '이날 실제로 들고 있던 종목(보유 칸)의 종가 — 신호 안이면 주 종목, 밖이면 대기 종목.\n\n현금 줄은 비어 있음(—). 가격 × 주수 = 주식 평가액.')
    + th('주수', '거래 뒤 보유 칸 종목의 주수.\n\n전부 현금일 때만 0 — 그래서 버블 브레이크·현금 매도 줄은 0. 주 종목이든 대기 종목이든 들고 있으면 0 이 아님.')
    + th('주식 평가액', '들고 있는 종목의 금액 — 현금을 뺀 나머지 전부.')
    + th('현금', '이 거래 뒤 현금으로 있는 금액. 다시 투자될 때까지 현금 이자를 받습니다.')
    + th('합계', '그날 전체 평가액: 종목 + 현금. 차트의 이 전략 선이 그리는 값입니다.')
    + th('넣은 돈', '이 날까지 넣은 돈의 합 — 시작 금액 + 지금까지의 적립금.\n\n합계 − 넣은 돈 = 수익.')
    + th('수수료', '이 줄의 거래에서 낸 비용(수수료 % × 거래 금액). 매도와 나눠 사기 조각마다 냅니다.\n\n적립·시작·기간 끝 줄은 0(—).')
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>' + ssHoldTime(log, (r) => String(r.held || r.state || 'cash').toUpperCase()) + '</div>';
}

// SMA 신호 지표 (마지막 거래일) + '지금 판단'
function ssSmaSignals(p) {
  const di = DS.days.length - 1;
  const sig = (p.sig || 'qqq').toLowerCase(), win = +p.win || 200, ohw = +p.ohw || 10, cw = +p.coolw || 10;
  const oh = +p.oh || 0, cool = +p.cool || 0, bga = (p.bga || 'qqq').toLowerCase(), bg = +p.bg || 0, bgw = +p.bgw || win;
  const eb = +p.eb || 0, xb = +p.xb || 0;
  const smaArr = ssInd('sma', sig, win, false);
  if (!smaArr || smaArr[di] == null) return '';
  const price = DS.days[di][sig], sma = smaArr[di], above = price > sma, pct = (price / sma - 1) * 100;
  // 오늘까지 이동평균 위(또는 아래)에 연속으로 있었던 거래일 수
  let days = 0;
  while (di - days >= 0) { const j = di - days, avg = smaArr[j]; if (avg == null || (DS.days[j][sig] > avg) !== above) break; days++; }
  const A = sig.toUpperCase();
  const red = (t) => '<span class="ss-warn">' + t + '</span>';
  const rsiAt = (w) => { const a = ssInd('rsi', sig, w, false); return a && a[di] != null ? a[di] : null; };
  const rsiCard = (label, w, thr, cmp, tip) => {
    const v = rsiAt(w), vs = v == null ? '—' : v.toFixed(1);
    let sub;
    if (thr <= 0) sub = '끔'; else if (v == null) sub = ''; else { const hit = cmp === 'above' ? v >= thr : v <= thr; const t = thr + (cmp === 'above' ? ' 이상' : ' 이하'); sub = hit ? red(t + ' · 해당') : t; }
    return ssStatCard('RSI(' + w + ') · ' + label, 'activity', vs, '', sub, tip);
  };
  const rsiTip = (w, side, lvl) => '최근 ' + w + '일 ' + A + ' 의 상대강도지수(RSI) — 0~100 의 속도계.\n\n계산:\n1. 날마다 종가 변화를 오른 몫·내린 몫으로 나눔\n2. 각각의 ' + w + '일 평균을 와일더 방식으로: 새 평균 = (이전 평균 × ' + (w - 1) + ' + 오늘) ÷ ' + w + '\n3. RS = 평균 상승 ÷ 평균 하락\n4. RSI = 100 − 100 ÷ (1 + RS)\n\n50 = 오르내림 균형 · 약 70 이상 = 빠르게 오름 · 약 30 이하 = 많이 빠짐.\n\n' + (side === 'sell' ? '매도 규칙: RSI 가 과열 기준' + (lvl > 0 ? '(' + lvl + ')' : '') + ' 이상이면 팝니다.' : '매수 규칙: RSI 가 기준' + (lvl > 0 ? '(' + lvl + ')' : '') + ' 아래로 식을 때까지 기다렸다 다시 삽니다 — 과열된 꼭대기를 사지 않도록.');
  const cards = [];
  cards.push(ssStatCard(A + ' vs ' + win + '일 평균', above ? 'trendUp' : 'trendDown', (above ? '▲ +' : '▼ −') + Math.abs(pct).toFixed(2) + '%', above ? 'ss-up' : 'ss-dn', ssLogPrice(price) + ' vs 평균 ' + ssLogPrice(sma), '신호 종목의 마지막 종가와 ' + win + '일 이동평균.\n\n평균 위 = 추세 규칙이 \'안\'(3배 종목 보유), 아래 = \'밖\'. 핵심 매수·매도 신호입니다.'));
  cards.push(ssStatCard('평균 ' + (above ? '위' : '아래') + ' 연속', 'clock', days + '일', '', A + ' 가 마지막으로 선을 넘은 뒤', A + ' 가 지금 쪽(평균 위/아래)에 며칠째 연속 머무는지 — 지금 추세 신호가 뒤집히지 않고 얼마나 이어졌는지입니다.'));
  if (eb > 0 || xb > 0) cards.push(ssStatCard('완충 띠', 'sliders', '+' + eb + '% / −' + xb + '%', '', '매수 &gt; ' + ssLogPrice(sma * (1 + eb / 100)) + ' · 매도 &lt; ' + ssLogPrice(sma * (1 - xb / 100)), '완충값이 만드는 가격 문턱: 평균보다 ' + eb + '% 위에서만 사고 ' + xb + '% 아래에서만 팝니다. 선 바로 위아래에서 들락날락하는 것을 막는 무반응 구간입니다.'));
  cards.push(rsiCard('매도', ohw, oh, 'above', rsiTip(ohw, 'sell', oh)));
  cards.push(rsiCard('매수', cw, cool, 'below', rsiTip(cw, 'buy', cool)));
  const bgArr = ssInd('sma', bga, bgw, false);
  let bgPct = null;
  if (bgArr && bgArr[di] != null) {
    bgPct = (DS.days[di][bga] / bgArr[di] - 1) * 100;
    const armed = bg > 0 && bgPct >= bg;
    cards.push(ssStatCard(bga.toUpperCase() + ' vs ' + bgw + '일 평균', 'shield', (bgPct >= 0 ? '+' : '−') + Math.abs(bgPct).toFixed(2) + '%', armed ? 'ss-warn' : bgPct >= 0 ? 'ss-up' : 'ss-dn',
      armed ? red('⚠ 작동 — 현금으로 팔게 됨') : bg > 0 ? '+' + bg + '% 이면 현금으로' : '끔',
      '버블 보험 계기: ' + bga.toUpperCase() + ' 가 자기 ' + bgw + '일 평균보다 얼마나 위에 있는지.\n\n' + (bg > 0 ? '+' + bg + '% 에 닿으면 주 신호와 상관없이 브레이크가 전부 현금으로 팝니다.' : '브레이크가 꺼져 있습니다(현금 기준 없음).')));
  }
  // 지금 판단: 오늘 목돈을 넣는다면
  const P = String(p.ul || sig).toUpperCase(), outA = (p.out || 'cash').toLowerCase(), B = outA === 'cash' ? '현금' : outA.toUpperCase();
  const din = +p.din || 0;
  const ohV = rsiAt(ohw), clV = rsiAt(cw), ps = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '%';
  const trendIn = pct > eb, hot = oh > 0 && ohV != null && ohV >= oh, blocked = cool > 0 && clV != null && clV >= cool, armed = bg > 0 && bgPct != null && bgPct >= bg;
  const rv = (v) => (v == null ? '—' : v.toFixed(1));
  const rs = [{ lean: trendIn ? 'buy' : 'out', name: '추세', val: A + ' ' + ps(pct) + ' vs ' + win + '일', tag: trendIn ? '안 · ' + P : '밖 · ' + B }];
  if (oh > 0) rs.push({ lean: hot ? 'out' : 'buy', name: '과열', val: 'RSI(' + ohw + ') ' + rv(ohV), tag: hot ? '매도 ≥' + oh : '괜찮음' });
  if (cool > 0) rs.push({ lean: blocked ? 'out' : 'buy', name: '재진입', val: 'RSI(' + cw + ') ' + rv(clV), tag: blocked ? '대기 <' + cool : '열림' });
  if (bg > 0) rs.push({ lean: armed ? 'cash' : 'buy', name: '버블', val: bga.toUpperCase() + ' ' + (bgPct == null ? '—' : ps(bgPct)), tag: armed ? '현금 +' + bg + '%' : '꺼짐' });
  let action, cls, note;
  if (armed) { action = '현금으로'; cls = 'cash'; note = '버블 브레이크가 추세보다 우선'; }
  else if (trendIn && !hot && !blocked) { action = P + ' 매수'; cls = 'buy'; note = din > 1 ? din + '거래일에 나눠 삼' : '한 번에'; }
  else { action = B === '현금' ? '현금 유지' : B + ' 매수'; cls = 'hold'; note = B === '현금' ? '매수 신호가 꺼져 있음' : '대기 종목 — 매수 신호가 꺼져 있음'; }
  return '<div class="ss-sec" style="margin-top:24px"><span>신호 지표 <i class="ss-asof">· ' + ssDate(DS.days[di].date) + ' 기준</i></span></div><div class="ss-stats">' + cards.join('') + '</div>' + ssDecisionHtml(action, cls, note, rs);
}
function ssDecisionHtml(action, cls, note, reasons) {
  return '<div class="ss-sec" style="margin-top:22px"><span>지금 판단</span></div><div class="ss-dec"><div class="ss-dech sd-' + cls + '"><span class="ss-decl">오늘 목돈을 넣는다면</span><span class="ss-deca">' + ssEsc(action) + '</span>' + (note ? '<span class="ss-decn">' + ssEsc(note) + '</span>' : '') + '</div>'
    + (reasons && reasons.length ? '<div class="ss-decs">' + reasons.map((r) => '<div class="ss-decr lean-' + r.lean + '"><i></i><span class="n">' + ssEsc(r.name) + '</span><span class="v">' + ssEsc(r.val || '') + '</span><span class="t">' + ssEsc(r.tag || '') + '</span></div>').join('') + '</div>' : '') + '</div>';
}

// 9sig 설명 (지금 값으로 문장)
function ss9Rules(p) {
  const ul = String(p.ul || 'tqqq').toUpperCase(), g = +p.g || 9, cd = +p.cd || 30, sp = +p.sp, cash = +p.cash || 0, stock = 100 - cash, bp = +p.bp || 90;
  const name = '9sig';
  const crash = cd >= 100 ? '<span class="ss-mut">(폭락 보호: ' + cd + '% 라 사실상 꺼짐)</span>' : ul + ' 가 2년 고점보다 <b>' + cd + '%</b> 넘게 떨어져 있으면 <b>최대 두 분기 연속 매도를 건너뜁니다</b> — 폭락 때 던지지 않도록. 두 번 건너뛴 뒤에는 그래도 팝니다.';
  const spike = sp <= 0 ? '<span class="ss-mut">(급등 되돌림: 끔)</span>' : ul + ' 가 <b>한 분기에 ' + sp + '% 넘게 오르고</b> 아직 ' + stock + '% 이상을 들고 있으면 ' + stock + '/' + cash + ' 로 강제 리밸런스 — 횡재를 확정합니다.';
  return '<div class="ss-sec" style="margin-top:24px"><span>' + name + ' 설명</span></div><div class="ss-rules">'
    + '<p><b>생각:</b> ' + ul + ' 는 분기마다 ' + g + '% 씩 커야 합니다. 더 빨리 컸으면 넘친 만큼 팔아 현금으로, 덜 컸으면 현금으로 모자란 만큼 삽니다. 그게 전부입니다.</p>'
    + '<h5>실제 순서</h5>'
    + '<p><b>1. 시작.</b> 돈의 ' + stock + '% 로 ' + ul + ' 를 사고 ' + cash + '% 는 현금으로. ' + ul + ' 쪽 금액을 적어 둡니다 — 이것이 <b>목표</b>입니다.</p>'
    + '<p><b>2. 분기마다, 판단하기 전에:</b></p><ul><li>목표를 <b>' + g + '%</b> 키웁니다.</li><li>이번 분기에 새 돈(매달 적립)을 넣었다면 그 <b>절반</b>만큼도 목표를 올립니다.</li></ul>'
    + '<p><b>3. 이제 ' + ul + ' 를 목표와 비교:</b></p><ul><li><b>목표보다 많으면?</b> 넘친 만큼 팔아 현금으로.</li><li><b>목표보다 적으면?</b> 모자란 만큼 현금으로 삼.</li><li><b>같으면?</b> 유지.</li></ul>'
    + '<h5>안전장치</h5>'
    + '<p>• <b>매수 한도 ' + bp + '%.</b> 한 번 살 때 현금의 ' + bp + '% 까지만 씁니다' + (bp < 100 ? ' — 여유 현금을 남깁니다' : '') + '.</p>'
    + '<p>• <b>폭락 시 매도 보류.</b> ' + crash + '</p>'
    + '<p>• <b>급등 되돌림.</b> ' + spike + '</p>'
    + '<p class="ss-note">매달 적립금은 늘 현금으로 먼저 들어가고(' + ul + ' 로 바로 가지 않음) 분기 리밸런스가 주식으로 옮깁니다. 목표를 새 돈의 절반만큼 올리는 것은, 넣은 돈의 절반은 결국 ' + ul + ' 로 가야 한다고 보는 셈입니다.</p></div>';
}

// ── 선 색 고르기 ──
const SS_SWATCHES = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'];
function ssActiveColor() { const t = ssPanelTarget(); if (!t) return '#7a7aa6'; return t.cfg ? t.cfg.color : ssBaseColor(t.type); }
function ssColorBar() {
  const col = ssActiveColor(), hex = col.replace(/^#/, '').toLowerCase();
  return '<div class="ss-colorbar"><span>선 색</span><button type="button" id="ss-ctrig" class="ss-ctrig" style="background:' + col + '" aria-label="선 색 고르기"></button>'
    + '<div id="ss-cpop" class="ss-cpop" hidden><div class="ss-cgrid">' + SS_SWATCHES.map((c) => '<button type="button" class="ss-sw' + (c === '#' + hex ? ' sel' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('')
    + '</div><div class="ss-crow"><span>#</span><input type="text" id="ss-chex" maxlength="6" spellcheck="false" value="' + hex + '" aria-label="16진 색"><button type="button" id="ss-cok">확인</button></div></div></div>';
}
let _ssColorOrig = null;
function ssOpenColor() {
  const pop = document.getElementById('ss-cpop'), tr = document.getElementById('ss-ctrig');
  if (!pop || !tr) return;
  _ssColorOrig = ssActiveColor();
  pop.hidden = false;
  const r = tr.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = r.left + 'px';
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - 8 - pr.width) + 'px';
  if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - 6 - pr.height) + 'px';
}
function ssCloseColor(revert) {
  const pop = document.getElementById('ss-cpop');
  if (pop) pop.hidden = true;
  if (revert && _ssColorOrig) ssPreviewColor(_ssColorOrig);
  _ssColorOrig = null;
}
function ssPreviewColor(c) {
  const t = ssPanelTarget();
  if (!t || !ssChart) return;
  const key = t.cfg ? 'cfg:' + t.cfg.id : t.type;
  for (const d of R.datasets) if (d._key === key || (t.cfg && d.cfgId === t.cfg.id)) { d._color = c; d.borderColor = c; }
  const tr = document.getElementById('ss-ctrig');
  if (tr) tr.style.background = c;
  ssChart.update('none');
}
function ssCommitColor(c) {
  const t = ssPanelTarget();
  if (!t) return;
  if (t.cfg) { t.cfg.color = c; ssPersistSaved(); } else S.baseColor[t.type] = c;
  ssChanged();
}
const ssNormHex = (v) => { const s = String(v || '').trim().replace(/^#/, ''); return /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s.toLowerCase() : null; };

// ── 패널 몸통 그리기 ──
function ssRenderPanel() {
  if (!ssPanel.open) return;
  const body = document.getElementById('ss-pbody');
  if (!body || ssPanel.drag) return;
  const t = ssPanelTarget();
  if (!t) { ssClosePanel(); return; }
  const top = body.scrollTop;
  let h = '';
  const m = t.cfg ? R.metrics['cfg:' + t.cfg.id] : R.metrics[t.type];
  if (t.type === 'custom') { body.innerHTML = ssCustomPanelHtml(t.cfg, m, body.clientWidth); body.scrollTop = top; return; }
  if (t.type === '9sig') h += ssCtls9(t.owner);
  else if (t.type === 'sma') h += ssCtlsSma(t.owner);
  else if (t.type === 'bh') h += ssCtlsBh(t.owner);
  else if (t.type === 'invested') h += ssCtlsInv(t.owner);
  h += ssColorBar();
  if (!t.cfg) h += '<div class="ss-savebar"><button type="button" class="ss-btn pri" data-savenew="' + t.type + '" title="지금 설정을 새 저장 전략으로">전략으로 저장</button></div>';
  if (t.type === '9sig' && t.cfg) {
    const ss = t.cfg.subShown || {};
    h += '<div class="ss-sec"><span>세부 선</span></div><div class="ss-subchips">' + SS_SUB_DEFS.map((d) => '<div class="ss-chip ss-subchip' + (ss[d.key] ? '' : ' off') + '" data-sub="' + d.key + '" role="button" tabindex="0">' + ssEye(!!ss[d.key]) + '<span class="ss-cdot" style="background:' + t.cfg.color + '"></span><span class="ss-cname">' + ssEsc(ssSubLabel(d.key, t.cfg.params)) + '</span></div>').join('') + '</div>';
  }
  h += ssStatsGrid(m);
  const sim = t.cfg ? R.cfgSim[t.cfg.id] : null;
  if (t.type === '9sig' && sim) { h += ssLog9Html(sim.log, t.params.ul || 'tqqq'); h += ss9Rules(t.params); }
  else if (t.type === 'bh') {
    const key = SS_COL[t.params.ul] ? t.params.ul : 'tqqq';
    const src = sim || R.base;
    if (src) h += ssLogBhHtml(src.log, (src.bh || {})[key], key);
  } else if (t.type === 'invested') {
    const src = sim || R.base;
    if (src) h += ssLogInvHtml(src.log);
  } else if (t.type === 'sma') {
    h += ssSmaSignals(t.params);
    if (sim) h += ssLogSmaHtml(sim.log, t.params.ul || 'tqqq');
  }
  body.innerHTML = h;
  body.scrollTop = top;
}

// ── 대화상자 ──
function ssDialog(title, html, btns) {
  ssCloseDialog();
  const ov = document.createElement('div');
  ov.className = 'ss-ov';
  ov.id = 'ss-dlg';
  ov.innerHTML = '<div class="ss-modal" role="dialog" aria-modal="true"><div class="ss-mtitle">' + ssEsc(title) + '</div><div class="ss-mbody">' + html + '</div><div class="ss-mact">'
    + btns.map((b, i) => '<button type="button" class="ss-btn' + (b.pri ? ' pri' : '') + (b.danger ? ' danger' : '') + '" data-dlg="' + i + '">' + ssEsc(b.t) + '</button>').join('') + '</div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dlg]');
    if (b) { const fn = btns[+b.getAttribute('data-dlg')].fn; ssCloseDialog(); if (fn) fn(); return; }
    if (e.target === ov) ssCloseDialog();
  });
  const f = ov.querySelector('.ss-btn.pri, .ss-btn.danger') || ov.querySelector('.ss-btn');
  if (f) f.focus();
}
function ssCloseDialog() { const d = document.getElementById('ss-dlg'); if (d) d.remove(); }

// ── 설명 풍선 (ⓘ) — 패널 스크롤에 잘리지 않게 화면 고정 위치 ──
(function () {
  let box = null;
  const show = (el) => {
    if (!box) { box = document.createElement('div'); box.className = 'ss-tipbox'; box.setAttribute('role', 'tooltip'); document.body.appendChild(box); }
    box.textContent = el.getAttribute('data-tip');
    box.classList.toggle('wide', el.hasAttribute('data-tip-wide'));
    box.style.display = 'block';
    const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    box.style.left = left + 'px'; box.style.top = top + 'px';
  };
  const hide = () => { if (box) box.style.display = 'none'; };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) show(el); });
  document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.ss-i[data-tip]')) hide(); });
  document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('.ss-i[data-tip]'); if (el) { e.preventDefault(); show(el); } else hide(); }, true);
  window.addEventListener('scroll', hide, true);
})();

// ── 표 → CSV ──
function ssTableCsv(table) {
  // 칸 글자: ⓘ 빼고 공백 한 칸으로 · 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감쌈(따옴표는 두 번)
  const cell = (el) => { const t = el.textContent.replace(/ⓘ/g, '').replace(/\s+/g, ' ').trim(); return /[",\n]/.test(t) ? '"' + t.split('"').join('""') + '"' : t; };
  const line = (cells) => cells.map(cell).join(',');
  const out = [line(Array.from(table.querySelectorAll('thead th')))];
  for (const tr of table.querySelectorAll('tbody tr')) if (getComputedStyle(tr).display !== 'none') out.push(line(Array.from(tr.children)));
  return '\ufeff' + out.join('\n');   // 엑셀이 한글을 알아보게 BOM
}
function ssDownload(text, name, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

// ── 패널 안 사건 ──
function ssWirePanel() {
  const panel = document.getElementById('ss-panel'), body = document.getElementById('ss-pbody'), title = document.getElementById('ss-ptitle');
  panel.querySelector('.ss-pclose').addEventListener('click', () => ssAttemptClose());
  let focusV = '';
  title.addEventListener('focus', () => { focusV = title.textContent; });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } else if (e.key === 'Escape') { e.preventDefault(); title.textContent = focusV; title.blur(); } });
  title.addEventListener('blur', () => ssCommitTitle(title.textContent));
  panel.querySelector('.ss-pedit').addEventListener('click', () => { title.focus(); const r = document.createRange(); r.selectNodeContents(title); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  // 너비 조절 (저장)
  const content = panel.querySelector('.ss-pin'), rz = panel.querySelector('.ss-presize');
  const apply = (w) => { content.style.width = Math.max(280, Math.min(Math.round(window.innerWidth * 0.98), w)) + 'px'; };
  try { const w = parseFloat(localStorage.getItem(SS_LS.panelW)); if (Number.isFinite(w)) apply(w); } catch (e) {}
  rz.addEventListener('mousedown', (e) => {
    const x0 = e.clientX, w0 = content.getBoundingClientRect().width;
    content.classList.add('rs');
    const mv = (ev) => { apply(w0 + ev.clientX - x0); ev.preventDefault(); };
    const up = () => { content.classList.remove('rs'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); try { localStorage.setItem(SS_LS.panelW, String(parseInt(content.style.width, 10) || 360)); } catch (er) {} ssRenderPanel(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (content.style.width) apply(parseInt(content.style.width, 10) || 360); });
  body.addEventListener('click', (e) => {
    const t = e.target;
    const pd = t.closest('.ss-pd');
    if (pd && !pd.disabled) { ssOpenPd(pd); return; }
    if (t.closest('[data-csv]')) {
      const sec = t.closest('.ss-logsec'), table = sec && sec.querySelector('table');
      if (!table) return;
      const ttl = (sec.querySelector('.ss-sec span') || {}).textContent || '기록';
      ssDownload(ssTableCsv(table), '투자전략-' + ttl.trim().replace(/\s+/g, '-').replace(/[^0-9A-Za-z가-힣-]/g, '') + '-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv');
      return;
    }
    const sn = t.closest('[data-savenew]');
    if (sn) { ssSaveFromBase(sn.getAttribute('data-savenew')); return; }
    const sub = t.closest('.ss-subchip[data-sub]');
    if (sub) { const c = ssFindCfg(S.editing); if (c) { c.subShown = c.subShown || {}; c.subShown[sub.getAttribute('data-sub')] = sub.classList.contains('off'); ssPersistSaved(); ssChanged(); } return; }
    const lch = t.closest('.ss-lchip[data-line]');
    if (lch) { const c = ssFindCfg(S.editing); if (c) { c.subShown = c.subShown || {}; c.subShown[lch.getAttribute('data-line')] = lch.classList.contains('off'); ssPersistSaved(); ssRenderPanel(); } return; }
    if (t.closest('#ss-ctrig')) { const pop = document.getElementById('ss-cpop'); if (pop && !pop.hidden) ssCloseColor(true); else ssOpenColor(); return; }
    const sw = t.closest('.ss-sw');
    if (sw) { const c = sw.getAttribute('data-color'); _ssColorOrig = null; ssCloseColor(false); ssCommitColor(c); return; }
    if (t.closest('#ss-cok')) { const c = ssNormHex((document.getElementById('ss-chex') || {}).value) || _ssColorOrig || ssActiveColor(); _ssColorOrig = null; ssCloseColor(false); ssCommitColor(c); return; }
    if (t.closest('#ss-cedit')) { if (S.editing) ssOpenBuilder(S.editing, false); return; }
    const cp = t.closest('.ss-cp');
    if (cp) { ssOpenCp(cp); return; }
  });
  body.addEventListener('input', (e) => {
    if (e.target.id === 'ss-chex') { const h = ssNormHex(e.target.value); if (h) ssPreviewColor(h); return; }
    if (e.target.id === 'ss-rate') {
      const own = e.target.getAttribute('data-own');
      // 0.5% 단위로 맞춤 (막대 위치는 제곱 눈금)
      const r = Math.round(ssPosToRate(+e.target.value) * 2) / 2, pos = ssRateToPos(r);
      if (pos !== +e.target.value) e.target.value = String(pos);
      const v = document.getElementById('ss-rate-v');
      if (v) v.textContent = r.toFixed(1) + '%';
      ssSetParam('invested', own, 'r', String(pos));
    }
  });
  body.addEventListener('change', (e) => {
    const h = e.target.getAttribute && e.target.getAttribute('data-hide');
    if (h === 'c' || h === 'e') { ssPanel[h === 'c' ? 'hideC' : 'hideE'] = e.target.checked; body.querySelectorAll('.ss-tw').forEach((w) => w.classList.toggle(h === 'c' ? 'hide-c' : 'hide-e', e.target.checked)); }
    const ch = e.target.getAttribute && e.target.getAttribute('data-chide');
    if (ch === 'c' || ch === 'e') { ssPanel[ch === 'c' ? 'cHideC' : 'cHideE'] = e.target.checked; body.querySelectorAll('.ss-ctw').forEach((w) => w.classList.toggle(ch === 'c' ? 'hide-c' : 'hide-e', e.target.checked)); }
  });
  // 패널 안 범위 막대를 끄는 동안은 몸통을 다시 그리지 않음 (끌기가 끊기지 않게)
  const dragOn = (e) => { if (e.target && e.target.matches && e.target.matches('#ss-pbody input[type="range"]')) ssPanel.drag = true; };
  const dragOff = () => { if (!ssPanel.drag) return; ssPanel.drag = false; ssRenderPanel(); };
  document.addEventListener('mousedown', dragOn); document.addEventListener('touchstart', dragOn, { passive: true });
  document.addEventListener('mouseup', dragOff); document.addEventListener('touchend', dragOff);
  // 기록 표 줄에 마우스 → 차트의 그 거래 표시를 강조
  body.addEventListener('mouseover', (e) => { const r = e.target.closest('tr[data-mkey]'); if (r) ssSetMarkerHover(r.getAttribute('data-mkey')); });
  body.addEventListener('mouseout', (e) => { const r = e.target.closest('tr[data-mkey]'); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) ssSetMarkerHover(null); });
  // 색 고르기: 바깥을 누르면 취소(되돌림)
  document.addEventListener('mousedown', (e) => {
    const pop = document.getElementById('ss-cpop');
    if (!pop || pop.hidden) return;
    if (e.target.closest('#ss-cpop') || e.target.closest('#ss-ctrig')) return;
    ssCloseColor(true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('ss-dlg')) { ssCloseDialog(); return; }
    if (document.getElementById('ss-builder') || document.getElementById('ss-txm') || document.querySelector('.ss-pdpop') || document.querySelector('.ss-dcal')) return;
    if (ssPanel.open && !(document.activeElement && document.activeElement.id === 'ss-ptitle')) ssAttemptClose();
  });
  // 라이브러리에서 '써 보기' 뒤 강조된 선: 빈 곳을 누르면 강조를 풂
  document.addEventListener('click', (e) => {
    if (!S.editing || ssPanel.open) return;
    if (e.target.closest('#ss-panel, .ss-pills, .ss-ov, .ss-lib, button, .ss-chip, select, input, label, a')) return;
    S.editing = null;
    ssChartUpdate();
  });
}
