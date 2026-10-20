/* ── [STRATSIM-FIT] 9sig · SMA 과최적화 탐색기 ──────────────────────────────────
   자료: data/stratsim/fit-<종류>.json (scripts/stratsim_fit.cjs 가 투자전략 시뮬레이터와 같은 계산으로 매일 갱신)
   기간·목표(수익 최대·낙폭 최소)별 후보 설정 표 — 정렬·필터·CSV·'열기'(시뮬레이터에서 그 설정으로) */

const FR = document.getElementById('ssf-app');
const KIND = FR ? FR.dataset.kind : null;
const SSF_ASSET_TIER = { tqqq: 3, spxl: 3, qld: 2, sso: 2, qqq: 1, spy: 1, sqqq: 3, cash: 0 };
const SSF_RULE_KO = { crash: '폭락 버티기', spike: '급등 되돌림', throttle: '매수 한도', deploy: '적립금 바로 투자', rebal: '리밸런스 시점', target: '목표 기준',
  confirm: '확인 일수', settle: '결제 대기', 'rsi-sell': 'RSI 과열 매도', 'rsi-buy': 'RSI 식으면 매수', 'dca-in': '나눠 사기', 'dca-out': '나눠 옮기기', bodyguard: '버블 보험' };
const SSF_PER_KO = { weekly: '매주', monthly: '매달', quarterly: '매 분기', yearly: '매년' };
const ssfEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ssfMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  const u = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : null;
  if (!u) return s + '$' + Math.round(a);
  const v = a / u[0];
  return s + '$' + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + u[1];
}
const ssfPct = (v, d, plus) => (v == null || !Number.isFinite(+v) ? '—' : (plus && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(+v).toFixed(d) + '%');
const ssfTick = (a) => (a === 'cash' ? '현금' : String(a).toUpperCase());
const ssfPill = (a) => '<span class="ssf-pill t' + (SSF_ASSET_TIER[a] != null ? SSF_ASSET_TIER[a] : 0) + '">' + ssfEsc(ssfTick(a)) + '</span>';
const ssfSign = (v) => (v == null ? '' : v > 0 ? ' ssf-up' : v < 0 ? ' ssf-dn' : '');

// ── 열 정의 (m: 지표 이름 · p: 손잡이 이름) ──
function ssfCols(D) {
  const mi = {}; D.cols.forEach((c, i) => { mi[c] = i; });
  const pi = {}; D.keys.forEach((k, i) => { pi[k] = D.cols.length + i; });
  const M = (r, c) => r[mi[c]], P = (r, k) => r[pi[k]];
  const is9 = D.kind === '9sig';
  const nRules = is9 ? 11 : 13;
  const ddCls = (v) => (v >= 70 ? 'ssf-dd4' : v >= 55 ? 'ssf-dd3' : v >= 40 ? 'ssf-dd2' : 'ssf-dd1');
  const cols = [
    { id: 'open', h: '', cls: 'ssf-open l', get: (r) => '<a class="ssf-go" target="_blank" rel="noopener" href="' + ssfLink(D, r, P) + '" title="투자전략 시뮬레이터에서 이 설정으로 열기 (새 탭)">열기 ↗</a>' },
    { id: 'rank', h: '#', cls: 'ssf-rank l', get: (r, i) => i + 1, tip: '지금 정렬 순서의 순위입니다. 열 이름을 누르면 그 열로 다시 정렬합니다 — 수익 최대 탭은 연평균 높은 순, 낙폭 최소 탭은 낙폭 작은 순으로 열립니다.' },
    { id: 'cagr', h: '연평균', v: (r) => M(r, 'cagr'), get: (r) => '<b class="ssf-up">' + ssfPct(M(r, 'cagr'), 1, true) + '</b>',
      tip: '맞춘 구간(시작 연도~2025년 말)의 돈 가중 연수익률(IRR) — 시작 금액과 매달 적립금이 들어온 날짜를 모두 반영한 연평균입니다. 시뮬레이터에서 같은 설정으로 열었을 때 범례의 연평균과 같습니다.' },
    { id: 'final', h: '끝 금액', v: (r) => M(r, 'final'), get: (r) => '<b>' + ssfMoney(M(r, 'final')) + '</b>',
      tip: '2025년 12월 31일 평가액 — 시작 $10,000 + 매달 $500 를 모든 후보에 똑같이 넣었으므로 그대로 비교할 수 있습니다. 시작 연도가 이를수록 오래 불어나 금액이 큽니다.' },
    { id: 'dd', h: '최대 낙폭', v: (r) => M(r, 'dd'), get: (r) => '<span class="' + ddCls(M(r, 'dd')) + '">−' + (+M(r, 'dd')).toFixed(0) + '%</span>',
      tip: '맞춘 구간 동안 고점에서 저점까지 가장 크게 떨어진 비율 — 날마다 종가로 다시 평가합니다(리밸런스 사이에는 보유 그대로). −55% 는 평가액이 한때 직전 고점보다 55% 낮았다는 뜻입니다.' },
    { id: 'sharpe', h: '샤프', m: 1, v: (r) => M(r, 'sharpe'), get: (r) => (M(r, 'sharpe') == null ? '—' : (+M(r, 'sharpe')).toFixed(2)),
      tip: '변동 1만큼에 얻은 수익 — 맞춘 구간의 달별 수익률(적립금 뺀 값) 평균 ÷ 표준편차 × √12 (무위험 수익 0).\n\n0.5 미만 약함 · 0.5~1 괜찮음 · 1~1.5 강함 · 1.5 넘음 드묾(운 좋게 맞춘 경우가 많음)' },
    { id: 'sortino', h: '소르티노', m: 1, v: (r) => M(r, 'sortino'), get: (r) => (M(r, 'sortino') == null ? '—' : (+M(r, 'sortino')).toFixed(2)),
      tip: '샤프와 같지만 손실 난 달만 위험으로 셉니다 — 크게 오른 달은 벌점이 아닙니다.\n\n1 미만 약함 · 1~2 괜찮음 · 2 넘음 강함\n\n샤프보다 훨씬 크면 오를 때 크게 오르는 쪽으로 치우친 것' },
    { id: 'calmar', h: '칼마', m: 1, v: (r) => M(r, 'calmar'), get: (r) => (M(r, 'calmar') == null ? '—' : (+M(r, 'calmar')).toFixed(2)),
      tip: '연평균 ÷ 최대 낙폭 — 견뎌야 했던 가장 깊은 손실 1만큼에 얻은 연수익.\n\n0.5 미만 나쁨 · 0.5~1 보통 · 1~2 좋음 · 2 넘음 아주 좋음' },
    { id: 'conc', h: '쏠림', m: 1, v: (r) => M(r, 'conc'), get: (r) => (M(r, 'conc') == null ? '—' : M(r, 'conc') + '%'),
      tip: '전체 복리 수익 가운데 가장 좋았던 상위 1% 달이 만든 몫 — 결과가 몇몇 특별한 달에 얼마나 기대는지.\n\n15% 미만 고르게 벌어 되풀이되기 쉬움 · 15~40% 보통 · 40% 넘음 몇 달에 기댐(다른 기간에서 잘 안 통함)' },
    { id: 'vsbh', h: '보유 대비', m: 1, v: (r) => M(r, 'vsbh'), get: (r) => (M(r, 'vsbh') == null ? '—' : '<span class="' + ssfSign(M(r, 'vsbh')) + '">' + (M(r, 'vsbh') > 0 ? '+' : M(r, 'vsbh') < 0 ? '−' : '') + Math.abs(M(r, 'vsbh')).toFixed(1) + '%p</span>'),
      tip: '이 전략의 연평균 − 같은 ' + (is9 ? '종목' : '주 종목') + '을 그냥 사서 들고 있었을 때의 연평균(같은 $10,000 + 매달 $500). 신호와 타이밍이 그냥 보유보다 무엇을 더했는지 보여 줍니다.\n\n0 보다 크면 보유를 이김 · 작으면 수익을 내줌\n\n낙폭 최소 탭은 덜 흔들리는 것이 목표라 마이너스가 흔합니다.' },
    { id: 'active', h: '작동 규칙', m: 1, v: (r) => M(r, 'active'),
      get: (r) => { const l = String(M(r, 'live') || '').split('+').filter(Boolean).map((x) => SSF_RULE_KO[x] || x).join(' · ') || '없음'; return '<span class="ssf-tipc" data-tip="결과를 바꾸는 규칙: ' + ssfEsc(l) + '">' + M(r, 'active') + '/' + nRules + '</span>'; },
      tip: (is9 ? '손잡이 11개 가운데 결과를 실제로 바꾸는 개수. 기본 5개(종목·현금 둘 곳·주기·목표 성장·현금 비중)는 늘 세고, 규칙 6개(폭락 버티기·급등 되돌림·매수 한도·적립금 바로 투자·리밸런스 시점·목표 기준)는 그 규칙을 꺼 봤을 때 끝 금액이 달라질 때만 셉니다.\n\n5 = 기본 손잡이만, 맞출 여지가 적음 · 11 = 모든 규칙이 작동, 맞출 여지가 가장 큼'
        : '손잡이 13개 가운데 결과를 실제로 바꾸는 개수. 기본 6개(주 종목·신호·대기 종목·이평 기간·살 때·팔 때 버퍼)는 늘 세고, 규칙 7개(확인 일수·결제 대기·RSI 과열 매도·RSI 식으면 매수·나눠 사기·나눠 옮기기·버블 보험)는 그 규칙을 꺼 봤을 때 끝 금액이 달라질 때만 셉니다.\n\n6 = 기본 손잡이만, 맞출 여지가 적음 · 13 = 모든 규칙이 작동, 맞출 여지가 가장 큼') + '\n\n숫자에 마우스를 올리면(휴대폰은 누르면) 작동하는 규칙이 보입니다.' },
    { id: 'robust', h: '강건성', m: 1, v: (r) => M(r, 'robust'), get: (r) => (M(r, 'robust') == null ? '—' : '<span class="' + (M(r, 'robust') >= 70 ? 'ssf-good' : M(r, 'robust') >= 40 ? 'ssf-mid' : 'ssf-bad') + '">' + M(r, 'robust') + '%</span>'),
      tip: '조절 손잡이마다 선택지를 한 칸 위·아래로 바꿔 다시 돌렸을 때, 끝 금액이 이 설정의 ±25% 안에 드는 이웃의 비율.\n\n70% 넘음 넓은 고원(강건함) · 40~70% 보통 · 40% 미만 칼날 위(과최적화 가능성이 큼)' },
    { id: 'fwd', h: '26년 이후', m: 1, v: (r) => M(r, 'fwd'), get: (r) => (M(r, 'fwd') == null ? '—' : '<span class="ssf-tipc' + ssfSign(M(r, 'fwd')) + '" data-tip="그 사이 최대 낙폭 −' + (M(r, 'fwdDD') != null ? (+M(r, 'fwdDD')).toFixed(1) : '?') + '%">' + ssfPct(M(r, 'fwd'), 1, true) + '</span>'),
      tip: '어떤 후보도 맞추는 데 쓰지 않은 2026년 1월 1일부터 최신 자료일까지의 수익률(연율 아님) — 맞춘 구간부터 이어서 돌린 전략이 2025년 말 평가액 대비 얼마나 늘었는지(그 사이 적립금은 뺌). 매일 갱신되는 진짜 시험 구간입니다.\n\n시뮬레이터에서 2026년에 새로 시작하면 현금에서 출발하므로 이 값과 다를 수 있습니다. 마우스를 올리면 그 구간 최대 낙폭.' },
    { id: 'back', h: '1990–2010', m: 1, only2010: 1, v: (r) => M(r, 'back'), get: (r) => (M(r, 'back') == null ? '—' : '<span class="ssf-tipc' + ssfSign(M(r, 'back')) + '" data-tip="그 구간 최대 낙폭 −' + (M(r, 'backDD') != null ? (+M(r, 'backDD')).toFixed(1) : '?') + '%">' + ssfPct(M(r, 'back'), 0, true) + '</span>'),
      tip: '이 설정을 1990년부터 2010년까지 돌렸을 때의 연평균 — 맞춘 구간 이전이라 한 번도 본 적 없는 구간으로 거꾸로 시험합니다(2010년 탭에만).\n\n맞춘 구간 연평균에 가깝고 낙폭도 비슷하면 다른 시대에도 통함 · 0 근처·마이너스·낙폭 폭발이면 2010년대에만 맞춘 것. 마우스를 올리면 그 구간 최대 낙폭.' },
    { id: 'era', h: '1990–최신', m: 1, v: (r) => M(r, 'era'), get: (r) => (M(r, 'era') == null ? '—' : '<span class="ssf-tipc' + ssfSign(M(r, 'era')) + '" data-tip="최대 낙폭 −' + (M(r, 'eraDD') != null ? (+M(r, 'eraDD')).toFixed(1) : '?') + '% · 샤프 ' + (M(r, 'eraSharpe') != null ? (+M(r, 'eraSharpe')).toFixed(2) : '?') + '">' + ssfPct(M(r, 'era'), 0, true) + '</span>'),
      tip: '1990년부터 최신 자료일까지 이 설정을 계속 돌렸을 때의 연평균 — 30년 넘는 기간의 정직한 장기 성적. 2010년 탭에서는 앞 시험·맞춘 구간·뒤 시험이 한 숫자에 다 들어갑니다.\n\n맞춘 구간 연평균에 가까우면 오래 통함 · 훨씬 낮으면 맞춘 구간이 결과를 부풀린 것. 마우스를 올리면 최대 낙폭과 샤프.' },
  ];
  if (is9) cols.push(
    { id: 'ul', h: '종목', cls: 'l', v: (r) => P(r, 'ul'), get: (r) => ssfPill(P(r, 'ul')), tip: '9sig 가 사고파는 성장 쪽 종목 — 매 주기 목표선까지 이 종목을 사거나 팝니다. 색: 빨강 3배(TQQQ·SPXL) · 주황 2배(QLD·SSO) · 파랑 1배(QQQ·SPY).' },
    { id: 'park', h: '현금 둘 곳', cls: 'l', v: (r) => P(r, 'park'), get: (r) => ssfPill(P(r, 'park')), tip: '안전 몫을 둘 곳 — 현금이면 현금 이자(연 4%)를 받고, 종목(예: SPY)이면 그 몫도 그 종목으로 들고 있어 양쪽 모두 시장에 있습니다.' },
    { id: 'per', h: '주기', cls: 'l', v: (r) => P(r, 'per'), get: (r) => SSF_PER_KO[P(r, 'per')] || P(r, 'per'), tip: '목표선까지 맞추는 주기 — 매주·매달·매 분기(표준 9sig)·매년. 목표 성장률은 고른 주기마다 적용됩니다(예: 매달 + 3% = 달마다 3%).' },
    { id: 'cash', h: '현금 비중', v: (r) => +P(r, 'cash'), get: (r) => P(r, 'cash') + '%', tip: '시작할 때 안전 쪽(현금 둘 곳)에 두는 비율, 나머지로 종목을 삽니다. 40% = 표준 60/40 9sig. 낮을수록 공격적, 높을수록 완충이 큼.' },
    { id: 'g', h: '목표 성장', v: (r) => +P(r, 'g'), get: (r) => P(r, 'g') + '%', tip: '주기마다 목표선이 커지는 비율(신호선) — 표준 9sig 는 분기마다 9%. 낮으면 오를 때 팔고, 높으면 계속 삽니다.' },
    { id: 'cd', h: '폭락 기준', v: (r) => +P(r, 'cd'), get: (r) => '−' + P(r, 'cd') + '%', tip: '종목이 최근 고점보다 이만큼 넘게 떨어져 있으면 매도를 두 번까지 건너뜁니다(바닥에서 던지지 않게). −5% 처럼 작으면 거의 늘 버티므로 잘 팔지 않습니다.' },
    { id: 'cw', h: '폭락 기간', v: (r) => +P(r, 'cw'), get: (r) => P(r, 'cw') + '개월', tip: '폭락 규칙의 \'최근 고점\'을 몇 개월 거슬러 볼지 — 24 = 표준 2년 고점. 짧을수록 작은 조정도 폭락으로 봅니다.' },
    { id: 'st', h: '되돌림 비중', v: (r) => +P(r, 'st'), get: (r) => P(r, 'st') + '%', tip: '급등 규칙이 걸리면 주식 비중을 이 값까지 낮춰 이익을 챙깁니다. 60% = 종목 60%로 되돌림.' },
    { id: 'sp', h: '급등 기준', v: (r) => +P(r, 'sp'), get: (r) => (+P(r, 'sp') === 0 ? '끔' : '+' + P(r, 'sp') + '%'), tip: '한 주기에 종목이 이만큼 넘게 오르면 되돌림 비중까지 강제로 맞춥니다. 클수록 오름세를 오래 두고, 작을수록 자주 이익을 챙깁니다. 0 = 끔.' },
    { id: 'bp', h: '매수 한도', v: (r) => +P(r, 'bp'), get: (r) => P(r, 'bp') + '%', tip: '한 번 살 때 현금(안전 쪽)의 이 비율까지만 씁니다 — 표준 9sig 는 90%. 100%면 매번 다 씁니다.' },
    { id: 'dep', h: '바로 투자', v: (r) => +P(r, 'dep'), get: (r) => P(r, 'dep') + '%', tip: '매달 적립금 가운데 이 비율을 그 달 가격에 바로 종목으로 삽니다(나머지는 다음 리밸런스까지 현금). 0% = 표준 9sig.' },
    { id: 'rp', h: '리밸런스 시점', v: (r) => +P(r, 'rp'), get: (r) => P(r, 'rp') + '%', tip: '주기 안 어디서 리밸런스할지 — 0% = 주기 시작 무렵, 100% = 끝 무렵. 날짜가 결과를 얼마나 흔드는지 보는 타이밍 손잡이입니다.' },
    { id: 'tc', h: '목표 기준', cls: 'l', v: (r) => P(r, 'tc'), get: (r) => (P(r, 'tc') === 'target' ? '직전 목표액' : '직전 보유액'), tip: '다음 목표선을 무엇에서 키우는지 — 직전 보유액(표준 9sig) 또는 직전 목표액. 직전 목표액에서 키우면 실제로 얼마를 들고 있었든 목표가 더 빨리 커집니다.' },
  );
  else cols.push(
    { id: 'ul', h: '주 종목', cls: 'l', v: (r) => P(r, 'ul'), get: (r) => ssfPill(P(r, 'ul')), tip: '추세가 위일 때(신호 종목이 이동평균 위) 들고 있는 종목 — 수익 대부분이 여기서 나옵니다. 색: 빨강 3배(TQQQ·SPXL) · 주황 2배(QLD·SSO) · 파랑 1배(QQQ·SPY).' },
    { id: 'sig', h: '신호', cls: 'l', v: (r) => P(r, 'sig'), get: (r) => ssfPill(P(r, 'sig')), tip: '사고팔 때를 정하는 기준 종목 — 이 종목을 사고파는 것은 아닙니다. 이 종목 종가가 자기 이동평균 위면 주 종목, 아래면 대기 종목.' },
    { id: 'out', h: '대기', cls: 'l', v: (r) => P(r, 'out'), get: (r) => ssfPill(P(r, 'out')), tip: '추세가 아래일 때 들고 있는 것 — 현금이면 기다리고, 종목이면 그 종목으로 시장에 남습니다. 대기 = TQQQ 처럼 내려갈 때도 3배를 들고 있는 설정은 이 기간에만 운 좋게 맞은 경우가 많습니다.' },
    { id: 'bga', h: '버블 감시', cls: 'l', v: (r) => P(r, 'bga'), get: (r) => ssfPill(P(r, 'bga')), tip: '버블 보험이 지켜보는 종목 — 자기 이동평균보다 너무 멀리 오르면(오른쪽 버블 기준) 추세와 상관없이 전부 현금으로 팝니다.' },
    { id: 'win', h: '이평', v: (r) => +P(r, 'win'), get: (r) => P(r, 'win') + '일', tip: '신호 종목 이동평균 기간(거래일, 21 ≈ 한 달, 252 ≈ 1년). 200 = 고전적인 200일선. 길수록 느리고 거래가 적으며, 짧을수록 자주 들락날락합니다.' },
    { id: 'eb', h: '살 때 버퍼', v: (r) => +P(r, 'eb'), get: (r) => P(r, 'eb') + '%', tip: '신호 종목이 이동평균보다 이만큼 위에서 마감해야 삽니다 — 살짝 넘는 속임수를 거릅니다.' },
    { id: 'xb', h: '팔 때 버퍼', v: (r) => +P(r, 'xb'), get: (r) => P(r, 'xb') + '%', tip: '신호 종목이 이동평균보다 이만큼 아래에서 마감해야 팝니다. 살 때 버퍼와 함께 선 주변의 \'아무것도 안 하는 구간\' 폭을 정합니다.' },
    { id: 'cbs', h: '확인 일수', v: (r) => +P(r, 'cb') * 100 + +P(r, 'cs'), get: (r) => P(r, 'cb') + '/' + P(r, 'cs'), tip: '살 때/팔 때 신호가 며칠 이어져야 거래하는지(0 = 처음 넘는 날 바로).' },
    { id: 'oh', h: 'RSI 과열', v: (r) => +P(r, 'oh'), get: (r) => (+P(r, 'oh') === 0 ? '끔' : P(r, 'oh') + '/' + P(r, 'ohw')), tip: '기준/기간. 90/9 = 9일 RSI 가 90 이상이면 추세가 위여도 팝니다(포물선 꼭대기 잡기). 드물게 작동합니다.' },
    { id: 'cool', h: 'RSI 식음', v: (r) => +P(r, 'cool'), get: (r) => (+P(r, 'cool') === 0 ? '끔' : P(r, 'cool') + '/' + P(r, 'coolw')), tip: '기준/기간. 판 뒤 RSI 가 이 아래로 식을 때까지 다시 사지 않습니다. 80/7 = 7일 RSI 가 80 아래일 때만 삼.' },
    { id: 'din', h: '나눠 사기', v: (r) => +P(r, 'din'), get: (r) => P(r, 'din') + '일', tip: '주 종목을 몇 거래일에 나눠 살지(0 = 한 번에). 15 = 15일 동안 날마다 1/15씩.' },
    { id: 'dout', h: '나눠 옮기기', v: (r) => +P(r, 'dout'), get: (r) => P(r, 'dout') + '일', tip: '추세가 꺾였을 때 대기 종목을 몇 거래일에 나눠 살지(0 = 한 번에).' },
    { id: 'bg', h: '버블 기준', v: (r) => +P(r, 'bg'), get: (r) => (+P(r, 'bg') === 0 ? '끔' : '+' + P(r, 'bg') + '%/' + P(r, 'bgw')), tip: '기준/기간. +40%/200 = 버블 감시 종목이 자기 200일 평균보다 40% 넘게 위에서 마감하면 전부 현금. 작을수록 자주 빠집니다.' },
    { id: 'settle', h: '결제 대기', v: (r) => +P(r, 'settle'), get: (r) => P(r, 'settle') + '일', tip: '거래한 뒤 다음 거래까지 기다리는 거래일 수 — 현금 계좌 결제(T+N) 흉내. 1 = 하루에 한 번까지, 0 = 제한 없음.' },
  );
  return { cols, M, P, mi, pi };
}

// 시뮬레이터에서 열기: 그 기간 시작 분기부터 최신까지, 기본 선은 숨기고 이 설정만
function ssfLink(D, r, P) {
  const p = Object.assign({}, D.fixed);
  D.keys.forEach((k) => { p[k] = String(P(r, k)); });
  const name = D.kind === '9sig' ? '9sig ' + ssfTick(p.ul) + ' · ' + (SSF_PER_KO[p.per] || p.per) + ' · ' + ssfTick(p.park)
    : 'SMA ' + [p.ul, p.sig, p.out, p.bga].map(ssfTick).join('/');
  const o = { v: 1, i: 333, m: 500, a: '0', r: 4, e: SSF.cur ? SSF.cur.e : 0, hd: ['bh', 'invested'], sc: [{ t: D.kind, n: name, p, c: D.kind === '9sig' ? '#22d3ee' : '#a3e635' }] };
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return 'strategy-simulator/#ss=j' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── 필터 (열마다 구간·종류 — 같은 필터 안은 '또는', 필터끼리는 '그리고') ──
const INF = Infinity;
function ssfFilters(kind) {
  const R = (id, lbl, b) => ({ id, lbl, kind: 'range', b });
  if (kind === '9sig') return [
    R('final', '끝 금액', [['$25만 미만', 0, 25e4], ['$25만~100만', 25e4, 1e6], ['$100만~500만', 1e6, 5e6], ['$500만~2천만', 5e6, 2e7], ['$2천만 이상', 2e7, INF]]),
    R('cagr', '연평균', [['15% 미만', -INF, 15], ['15~25%', 15, 25], ['25~35%', 25, 35], ['35~45%', 35, 45], ['45% 이상', 45, INF]]),
    R('dd', '최대 낙폭', [['30% 미만', 0, 30], ['30~45%', 30, 45], ['45~60%', 45, 60], ['60~75%', 60, 75], ['75% 이상', 75, INF]]),
    { id: 'ul', lbl: '종목', kind: 'cat' }, { id: 'park', lbl: '현금 둘 곳', kind: 'cat' }, { id: 'per', lbl: '주기', kind: 'cat' },
    R('cash', '현금 비중', [['0~10%', 0, 11], ['20~30%', 11, 31], ['40~50%', 31, 51], ['60% 이상', 51, INF]]),
    R('g', '목표 성장', [['5% 미만', 0, 5], ['5~15%', 5, 15], ['15~40%', 15, 40], ['40~80%', 40, 80], ['80% 이상', 80, INF]]),
    R('cd', '폭락 기준', [['15% 이하', 0, 16], ['20~40%', 16, 41], ['45~70%', 41, 71], ['75% 이상', 71, INF]]),
    R('cw', '폭락 기간', [['3~9개월', 0, 10], ['12~24개월', 10, 25], ['36개월 이상', 25, INF]]),
    R('st', '되돌림 비중', [['25% 이하', 0, 26], ['30~50%', 26, 51], ['60~75%', 51, 76], ['80% 이상', 76, INF]]),
    R('sp', '급등 기준', [['끔(0)', 0, 1], ['+25~75%', 1, 76], ['+80~150%', 76, 151], ['+160% 이상', 151, INF]]),
    R('bp', '매수 한도', [['50~70%', 0, 71], ['75~90%', 71, 91], ['95~100%', 91, INF]]),
    R('dep', '바로 투자', [['0%', 0, 1], ['10~25%', 1, 26], ['50~75%', 26, 76], ['100%', 76, INF]]),
    R('rp', '리밸런스 시점', [['0~20%', 0, 21], ['25~50%', 21, 51], ['55~75%', 51, 76], ['80% 이상', 76, INF]]),
    { id: 'tc', lbl: '목표 기준', kind: 'cat' },
    R('sharpe', '샤프', [['0.5 미만', -INF, 0.5], ['0.5~1', 0.5, 1], ['1~1.5', 1, 1.5], ['1.5 이상', 1.5, INF]]),
    R('sortino', '소르티노', [['1 미만', -INF, 1], ['1~2', 1, 2], ['2 이상', 2, INF]]),
    R('calmar', '칼마', [['0.5 미만', -INF, 0.5], ['0.5~1', 0.5, 1], ['1~2', 1, 2], ['2 이상', 2, INF]]),
    R('conc', '쏠림', [['15% 미만', -INF, 15], ['15~40%', 15, 40], ['40% 이상', 40, INF]]),
    R('vsbh', '보유 대비', [['마이너스', -INF, 0], ['0~5%p', 0, 5], ['5~10%p', 5, 10], ['10%p 이상', 10, INF]]),
    R('active', '작동 규칙', [['5~7', 0, 8], ['8~9', 8, 10], ['10~11', 10, INF]]),
    R('robust', '강건성', [['40% 미만', -INF, 40], ['40~70%', 40, 70], ['70% 이상', 70, INF]]),
    R('fwd', '26년 이후', [['마이너스', -INF, 0], ['0~50%', 0, 50], ['50% 이상', 50, INF]]),
    R('back', '1990–2010', [['마이너스', -INF, 0], ['0~10%', 0, 10], ['10% 이상', 10, INF]]),
    R('era', '1990–최신', [['15% 미만', -INF, 15], ['15~25%', 15, 25], ['25% 이상', 25, INF]]),
  ];
  return [
    R('final', '끝 금액', [['$2,500만 미만', 0, 25e6], ['$2,500만~7,500만', 25e6, 75e6], ['$7,500만~1.5억', 75e6, 150e6], ['$1.5억 이상', 150e6, INF]]),
    R('cagr', '연평균', [['40% 미만', -INF, 40], ['40~55%', 40, 55], ['55~65%', 55, 65], ['65~72%', 65, 72], ['72% 이상', 72, INF]]),
    R('dd', '최대 낙폭', [['40% 미만', 0, 40], ['40~55%', 40, 55], ['55~70%', 55, 70], ['70% 이상', 70, INF]]),
    { id: 'ul', lbl: '주 종목', kind: 'cat' }, { id: 'sig', lbl: '신호', kind: 'cat' }, { id: 'out', lbl: '대기', kind: 'cat' }, { id: 'bga', lbl: '버블 감시', kind: 'cat' },
    R('win', '이평 기간', [['10~50', 10, 51], ['60~120', 60, 121], ['130~200', 130, 201], ['210~300', 210, 301]]),
    R('eb', '살 때 버퍼', [['0~1%', 0, 1.0001], ['1~5%', 1.0001, 5], ['5~15%', 5, 15], ['15% 이상', 15, INF]]),
    R('xb', '팔 때 버퍼', [['0~1%', 0, 1.0001], ['1~5%', 1.0001, 5], ['5~15%', 5, 15], ['15% 이상', 15, INF]]),
    R('oh', 'RSI 과열', [['60 미만', 0, 60], ['60~80', 60, 80], ['80~90', 80, 90.0001], ['90 넘음', 90.0001, INF]]),
    R('cool', 'RSI 식음', [['50 미만', 0, 50], ['50~70', 50, 70], ['70~85', 70, 85], ['85 이상', 85, INF]]),
    R('din', '나눠 사기', [['0 (한 번에)', 0, 1], ['1~15일', 1, 16], ['20~30일', 16, 31], ['42일 이상', 42, INF]]),
    R('dout', '나눠 옮기기', [['0 (한 번에)', 0, 1], ['1~15일', 1, 16], ['20~30일', 16, 31], ['42일 이상', 42, INF]]),
    R('bg', '버블 기준', [['끔(0)', 0, 1], ['+5~30%', 1, 35], ['+35~60%', 35, 65], ['+65% 이상', 65, INF]]),
    R('bgw', '버블 기간', [['10~50', 10, 51], ['60~120', 60, 121], ['130~200', 130, 201], ['210~300', 210, 301]]),
    { id: 'settle', lbl: '결제 대기', kind: 'cat' },
    R('sharpe', '샤프', [['0.5 미만', -INF, 0.5], ['0.5~1', 0.5, 1], ['1~1.5', 1, 1.5], ['1.5 이상', 1.5, INF]]),
    R('sortino', '소르티노', [['1 미만', -INF, 1], ['1~2', 1, 2], ['2 이상', 2, INF]]),
    R('calmar', '칼마', [['0.5 미만', -INF, 0.5], ['0.5~1', 0.5, 1], ['1~2', 1, 2], ['2 이상', 2, INF]]),
    R('conc', '쏠림', [['15% 미만', -INF, 15], ['15~40%', 15, 40], ['40% 이상', 40, INF]]),
    R('vsbh', '보유 대비', [['마이너스', -INF, 0], ['0~5%p', 0, 5], ['5~10%p', 5, 10], ['10%p 이상', 10, INF]]),
    R('active', '작동 규칙', [['6~8', 0, 9], ['9~11', 9, 12], ['12~13', 12, INF]]),
    R('robust', '강건성', [['40% 미만', -INF, 40], ['40~70%', 40, 70], ['70% 이상', 70, INF]]),
    R('fwd', '26년 이후', [['마이너스', -INF, 0], ['0~50%', 0, 50], ['50% 이상', 50, INF]]),
    R('back', '1990–2010', [['마이너스', -INF, 0], ['0~10%', 0, 10], ['10% 이상', 10, INF]]),
    R('era', '1990–최신', [['15% 미만', -INF, 15], ['15~25%', 15, 25], ['25% 이상', 25, INF]]),
  ];
}

// ── 상태·그리기 ──
const SSF = { D: null, C: null, F: null, cur: null, st: {}, tipEl: null, popEl: null, popFor: null };
const SSF_TAB = (t) => (t.goal === 'dd' ? '낙폭 최소' : '수익 최대') + ' <span class="ssf-span">' + t.from + '–2025</span>';
function ssfVal(id, r) {
  const c = SSF.C.cols.find((x) => x.id === id);
  if (c && c.v) return c.v(r);
  if (SSF.C.mi[id] != null) return r[SSF.C.mi[id]];
  if (SSF.C.pi[id] != null) return r[SSF.C.pi[id]];
  return null;
}
function ssfPass(r, st) {
  for (const id in st.filters) {
    const sel = st.filters[id];
    if (!sel || !sel.length) continue;
    const f = SSF.F.find((x) => x.id === id);
    let ok = false;
    for (const v of sel) {
      if (f.kind === 'range') { const [a, b] = v.split(':').map(Number); const x = +ssfVal(id, r); if (Number.isFinite(x) && x >= a && x < b) { ok = true; break; } }
      else if (String(r[SSF.C.pi[id]]) === v) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}
function ssfRows(t, st) {
  const arr = t.rows.map((r, i) => [r, i]).filter(([r]) => ssfPass(r, st));
  const c = SSF.C.cols.find((x) => x.id === st.sort);
  if (c && c.v) arr.sort((A, B) => {
    const a = c.v(A[0]), b = c.v(B[0]);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const d = typeof a === 'string' || typeof b === 'string' ? String(a).localeCompare(String(b)) : a - b;
    return st.desc ? -d : d;
  });
  return arr;
}
function ssfCatOpts(f, t) {
  const set = [...new Set(t.rows.map((r) => String(r[SSF.C.pi[f.id]])))];
  set.sort((a, b) => (Number.isFinite(+a) && Number.isFinite(+b) ? +a - +b : a.localeCompare(b)));
  const lab = (v) => (f.id === 'per' ? SSF_PER_KO[v] || v : f.id === 'tc' ? (v === 'target' ? '직전 목표액' : '직전 보유액') : f.id === 'settle' ? v + '일' : ssfTick(v));
  return set.map((v) => ({ v, l: lab(v) }));
}
function ssfOpts(f, t) { return f.kind === 'cat' ? ssfCatOpts(f, t) : f.b.map((b) => ({ v: b[1] + ':' + b[2], l: b[0] })); }
function ssfSelText(f, t, sel) {
  if (!sel || !sel.length) return '전체';
  if (sel.length === 1) { const o = ssfOpts(f, t).find((x) => x.v === sel[0]); return o ? o.l : '1개'; }
  return sel.length + '개 고름';
}

function ssfDrawPane(t) {
  const st = SSF.st[t.key], pane = document.getElementById('ssf-pane');
  const nSet = Object.keys(st.filters).filter((k) => (st.filters[k] || []).length).length;
  const cols = SSF.C.cols.filter((c) => !(c.only2010 && t.from !== '2010'));
  const fparts = SSF.F.filter((f) => !(f.id === 'back' && t.from !== '2010')).map((f) => {
    const sel = st.filters[f.id] || [];
    return '<label class="ssf-fl"><span>' + f.lbl + '</span><button type="button" class="ssf-fsel' + (sel.length ? ' set' : '') + '" data-f="' + f.id + '">' + ssfEsc(ssfSelText(f, t, sel)) + '<i>▾</i></button></label>';
  }).join('');
  pane.innerHTML = '<div class="ssf-bar"><button type="button" class="ssf-btn' + (st.open ? ' on' : '') + '" data-act="filters">필터' + (nSet ? ' <span class="ssf-badge">' + nSet + '</span>' : '') + '</button>'
    + '<button type="button" class="ssf-btn" data-act="reset"' + (nSet ? '' : ' disabled') + '>필터 지우기</button><button type="button" class="ssf-btn" data-act="csv">CSV 받기</button><span class="ssf-count" id="ssf-count"></span></div>'
    + '<div class="ssf-filters' + (st.open ? ' open' : '') + '">' + fparts + '</div>'
    + '<div class="ssf-scroll" id="ssf-scroll"><table class="ssf-tbl" id="ssf-tbl"></table></div>'
    + '<p class="ssf-foot">' + ssfFoot(t) + '</p>';
  ssfDrawTable(t, cols);
}
function ssfFoot(t) {
  const D = SSF.D, n = t.rows.length;
  const fresh = '자료: ' + D.dataTo.replace(/-/g, '.') + '까지 · 맞춘 구간 끝 ' + D.fitEnd.replace(/-/g, '.') + ' · 모든 후보에 시작 $10,000 + 매달 $500 (같은 돈이라 끝 금액을 그대로 비교) · 현금 이자 ' + (D.kind === '9sig' ? '4%' : '0%') + ' · 거래 비용 0.02%';
  if (t.goal === 'dd') {
    const ok = t.rows.filter((r) => r[SSF.C.mi.cagr] >= t.cagrMin).length;
    return '<b>연평균 ' + t.cagrMin + '% 이상</b>을 지키면서 <b>최대 낙폭이 가장 작도록</b> ' + t.from + '~2025년 구간에 맞춰 찾은 설정 ' + n + '개(후보 ' + t.total + '개 가운데 조건을 만족했던 것)입니다. 이 사이트 계산으로 다시 돌린 지금 조건을 만족하는 것은 ' + ok + '개입니다. 낙폭 작은 순으로 열립니다. ' + fresh + '.';
  }
  return '<b>끝 금액이 가장 크도록</b>(= 돈 가중 연평균 최대) ' + t.from + '~2025년 구간에 맞춰 찾은 설정 ' + n + '개입니다. 연평균 높은 순으로 열립니다. 2026년부터는 어떤 설정도 맞추는 데 쓰지 않은 구간이라 \'26년 이후\' 열이 진짜 시험입니다. ' + fresh + '.';
}
function ssfDrawTable(t, cols) {
  const st = SSF.st[t.key], el = document.getElementById('ssf-tbl');
  const arr = ssfRows(t, st);
  const firstM = cols.findIndex((c) => c.m), lastM = cols.length - 1 - cols.slice().reverse().findIndex((c) => c.m);
  const mc = (c, i) => (c.m ? ' m' : '') + (i === firstM ? ' ms' : '') + (i === lastM ? ' me' : '');
  const head = cols.map((c, i) => {
    const on = st.sort === c.id;
    return '<th class="' + (c.cls || '') + mc(c, i) + (c.v ? ' sortable' : '') + (on ? ' on' : '') + '" data-c="' + c.id + '"' + (on ? ' aria-sort="' + (st.desc ? 'descending' : 'ascending') + '"' : '') + '>' + c.h
      + (c.tip ? '<span class="ssf-q" data-tip="' + ssfEsc(c.tip) + '" tabindex="0" role="button" aria-label="' + ssfEsc(c.h || '열') + ' 설명">?</span>' : '') + (on ? '<span class="ssf-ar">' + (st.desc ? '▼' : '▲') + '</span>' : '') + '</th>';
  }).join('');
  const body = arr.map(([r, idx], i) => '<tr data-i="' + idx + '"' + (st.sel === idx ? ' class="sel"' : '') + '>' + cols.map((c, k) => '<td class="' + (c.cls || '') + mc(c, k) + '">' + c.get(r, i) + '</td>').join('') + '</tr>').join('');
  el.innerHTML = '<thead><tr>' + head + '</tr></thead><tbody>' + (body || '<tr><td class="ssf-empty" colspan="' + cols.length + '">조건에 맞는 설정이 없습니다 — 필터를 줄여 보세요.</td></tr>') + '</tbody>';
  const ths = el.querySelectorAll('thead th');
  if (ths[0] && ths[1]) { el.style.setProperty('--f1', ths[0].offsetWidth + 'px'); el.style.setProperty('--f2', (ths[0].offsetWidth + ths[1].offsetWidth) + 'px'); }
  const cnt = document.getElementById('ssf-count');
  if (cnt) cnt.textContent = arr.length + ' / ' + t.rows.length + '개';
}

function ssfCsv(t) {
  const st = SSF.st[t.key], arr = ssfRows(t, st), D = SSF.D, C = SSF.C;
  const head = ['순위'].concat(D.cols.filter((c) => !(c === 'back' || c === 'backDD') || t.from === '2010'), D.keys, ['link']);
  const esc = (v) => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const base = location.origin && location.origin !== 'null' ? location.origin + '/' : 'https://d-capitalism.com/';
  const lines = [head.join(',')].concat(arr.map(([r], i) => [i + 1].concat(D.cols.filter((c) => !(c === 'back' || c === 'backDD') || t.from === '2010').map((c) => r[C.mi[c]]), D.keys.map((k) => r[C.pi[k]]), [base + ssfLink(D, r, C.P)]).map(esc).join(',')));
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = D.kind + '-overfit-' + (t.goal === 'dd' ? 'min-drawdown' : 'max-return') + '-' + t.from + '-' + arr.length + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// 필터 고르기 창 (화면에 하나 — 표 스크롤에 잘리지 않게 fixed)
function ssfOpenPop(btn) {
  const t = SSF.cur, st = SSF.st[t.key], id = btn.dataset.f, f = SSF.F.find((x) => x.id === id);
  if (SSF.popFor === btn && !SSF.popEl.hidden) { ssfClosePop(); return; }
  const sel = st.filters[id] || [];
  SSF.popEl.innerHTML = '<label class="ssf-mrow all"><input type="checkbox" data-all' + (sel.length ? '' : ' checked') + '> 전체</label>'
    + ssfOpts(f, t).map((o) => '<label class="ssf-mrow"><input type="checkbox" value="' + ssfEsc(o.v) + '"' + (sel.includes(o.v) ? ' checked' : '') + '> ' + ssfEsc(o.l) + '</label>').join('');
  SSF.popEl.hidden = false; SSF.popFor = btn;
  const rc = btn.getBoundingClientRect(), w = SSF.popEl.offsetWidth, h = SSF.popEl.offsetHeight;
  let top = rc.bottom + 4;
  if (top + h > innerHeight - 8) top = Math.max(8, rc.top - h - 4);
  SSF.popEl.style.left = Math.max(8, Math.min(rc.left, innerWidth - w - 8)) + 'px';
  SSF.popEl.style.top = top + 'px';
  SSF.popEl.onchange = (e) => {
    const cb = e.target;
    let s = st.filters[id] || [];
    if (cb.hasAttribute('data-all')) { s = []; SSF.popEl.querySelectorAll('input:not([data-all])').forEach((x) => { x.checked = false; }); cb.checked = true; }
    else { s = cb.checked ? s.concat(cb.value) : s.filter((v) => v !== cb.value); SSF.popEl.querySelector('[data-all]').checked = !s.length; }
    st.filters[id] = s;
    btn.classList.toggle('set', s.length > 0);
    btn.firstChild.nodeValue = ssfSelText(f, t, s);
    const bar = document.querySelector('#ssf-pane [data-act="filters"]'), n = Object.keys(st.filters).filter((k) => (st.filters[k] || []).length).length;
    if (bar) bar.innerHTML = '필터' + (n ? ' <span class="ssf-badge">' + n + '</span>' : '');
    const rs = document.querySelector('#ssf-pane [data-act="reset"]');
    if (rs) rs.disabled = !n;
    ssfDrawTable(t, SSF.C.cols.filter((c) => !(c.only2010 && t.from !== '2010')));
  };
}
function ssfClosePop() { if (SSF.popEl) { SSF.popEl.hidden = true; SSF.popFor = null; } }

// 설명 풍선 (열 이름 ? · 셀) — 마우스는 올리면, 터치는 누르면
function ssfShowTip(el) {
  const tt = SSF.tipEl;
  tt.textContent = el.getAttribute('data-tip');
  tt.hidden = false;
  const r = el.getBoundingClientRect(), w = tt.offsetWidth, h = tt.offsetHeight;
  let top = r.bottom + 8;
  if (top + h > innerHeight - 8) top = r.top - h - 8;
  tt.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px';
  tt.style.top = Math.max(8, top) + 'px';
  SSF.tipFor = el;
}
function ssfHideTip() { if (SSF.tipEl) { SSF.tipEl.hidden = true; SSF.tipFor = null; } }

function ssfShow(key) {
  const t = SSF.D.tabs.find((x) => x.key === key) || SSF.D.tabs[0];
  SSF.cur = t;
  document.querySelectorAll('#ssf-app .ssf-tab').forEach((b) => { const on = b.dataset.k === t.key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  ssfClosePop(); ssfHideTip();
  ssfDrawPane(t);
  try { history.replaceState(history.state, '', location.pathname + location.search + (t.key === SSF.D.tabs[0].key ? '' : '#' + t.key)); } catch (e) {}
}

async function ssfBoot() {
  if (!FR || FR.dataset.booted) return;
  FR.dataset.booted = '1';
  FR.innerHTML = '<div class="ssf-loading"><span class="ssf-spin"></span>자료를 불러오는 중…</div>';
  let D;
  try {
    const r = await fetch('data/stratsim/fit-' + KIND + '.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    D = await r.json();
    if (!D || !Array.isArray(D.tabs) || !D.tabs.length) throw new Error('자료 모양');
  } catch (e) { FR.innerHTML = '<div class="ssf-loading err">자료를 불러오지 못했습니다 — 새로고침해 주세요.</div>'; return; }
  SSF.D = D; SSF.C = ssfCols(D); SSF.F = ssfFilters(D.kind);
  for (const t of D.tabs) SSF.st[t.key] = { sort: t.goal === 'dd' ? 'dd' : 'cagr', desc: t.goal !== 'dd', filters: {}, open: false, sel: null };
  FR.innerHTML = '<div class="ssf-top"><div class="ssf-tabs" role="tablist">' + D.tabs.map((t, i) => '<button type="button" role="tab" class="ssf-tab ' + t.goal + '" data-k="' + t.key + '" aria-selected="' + (i ? 'false' : 'true') + '"><i></i>' + SSF_TAB(t) + ' <span class="ssf-n">' + t.rows.length + '</span></button>').join('') + '</div>'
    + '<a class="ssf-back" href="strategy-simulator/">← 투자전략 시뮬레이터</a></div>'
    + '<div class="ssf-pane card" id="ssf-pane"></div>';
  SSF.tipEl = document.createElement('div'); SSF.tipEl.className = 'ssf-tipbox'; SSF.tipEl.hidden = true; SSF.tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(SSF.tipEl);
  SSF.popEl = document.createElement('div'); SSF.popEl.className = 'ssf-pop'; SSF.popEl.hidden = true; document.body.appendChild(SSF.popEl);
  FR.addEventListener('click', (e) => {
    const tab = e.target.closest('.ssf-tab');
    if (tab) { ssfShow(tab.dataset.k); return; }
    const q = e.target.closest('[data-tip]');
    if (q && (q.classList.contains('ssf-q') || matchMedia('(hover: none)').matches)) { e.preventDefault(); e.stopPropagation(); if (SSF.tipFor === q) ssfHideTip(); else ssfShowTip(q); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
      const t = SSF.cur, st = SSF.st[t.key];
      if (act.dataset.act === 'filters') { st.open = !st.open; ssfClosePop(); ssfDrawPane(t); }
      else if (act.dataset.act === 'reset') { st.filters = {}; ssfClosePop(); ssfDrawPane(t); }
      else if (act.dataset.act === 'csv') ssfCsv(t);
      return;
    }
    const fs = e.target.closest('.ssf-fsel');
    if (fs) { ssfOpenPop(fs); return; }
    const th = e.target.closest('th.sortable');
    if (th) {
      const t = SSF.cur, st = SSF.st[t.key], id = th.dataset.c;
      if (st.sort === id) st.desc = !st.desc;
      else { st.sort = id; st.desc = !(id === 'dd' || id === 'conc' || id === 'active'); }
      ssfDrawTable(t, SSF.C.cols.filter((c) => !(c.only2010 && t.from !== '2010')));
      return;
    }
    const tr = e.target.closest('tbody tr[data-i]');
    if (tr && !e.target.closest('a')) {
      const st = SSF.st[SSF.cur.key], i = +tr.dataset.i, was = st.sel === i;
      FR.querySelectorAll('tbody tr.sel').forEach((x) => x.classList.remove('sel'));
      st.sel = was ? null : i;
      if (!was) tr.classList.add('sel');
    }
  });
  FR.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ssf-q')) { e.preventDefault(); if (SSF.tipFor === e.target) ssfHideTip(); else ssfShowTip(e.target); }
    if (e.key === 'Enter' && e.target.matches('th.sortable')) e.target.click();
  });
  FR.addEventListener('mouseover', (e) => { if (matchMedia('(hover: none)').matches) return; const q = e.target.closest('[data-tip]'); if (q) ssfShowTip(q); });
  FR.addEventListener('mouseout', (e) => { if (matchMedia('(hover: none)').matches) return; const q = e.target.closest('[data-tip]'); if (q && !q.contains(e.relatedTarget)) ssfHideTip(); });
  document.addEventListener('mousedown', (e) => { if (!SSF.popEl.hidden && !SSF.popEl.contains(e.target) && !e.target.closest('.ssf-fsel')) ssfClosePop(); });
  document.addEventListener('touchstart', (e) => { if (!SSF.popEl.hidden && !SSF.popEl.contains(e.target) && !e.target.closest('.ssf-fsel')) ssfClosePop(); if (SSF.tipFor && !e.target.closest('[data-tip]')) ssfHideTip(); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ssfClosePop(); ssfHideTip(); } });
  addEventListener('scroll', () => { ssfHideTip(); if (SSF.popFor && !SSF.popEl.hidden) { const r = SSF.popFor.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) ssfClosePop(); } }, { passive: true });
  document.getElementById('ssf-pane').addEventListener('scroll', () => ssfHideTip(), true);
  const want = (location.hash || '').replace(/^#/, '');
  ssfShow(D.tabs.some((t) => t.key === want) ? want : D.tabs[0].key);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ssfBoot);
else ssfBoot();
