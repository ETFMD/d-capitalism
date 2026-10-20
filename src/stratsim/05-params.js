/* ── [STRATSIM] 05 전략 손잡이 목록 ───────────────────────────────────────
   9sig · SMA · 그냥 보유(B&H) · 현금 복리 의 조절 칸(선택지·기본값·이름).
   저장 전략·공유 링크·미리보기 막대·분석 창이 모두 이 목록 하나를 씀 */

const SS_TICK = (v) => (v === 'cash' ? '현금' : String(v).toUpperCase());
const ssRange = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(4)); return o; };
const ssOpts = (vals, lab) => vals.map((v) => [String(v), lab ? lab(v) : String(v)]);

const SS_ASSET_OPTS9 = ['tqqq', 'qld', 'sso', 'spxl', 'sqqq', 'qqq', 'spy'];
const SS_PARK_OPTS = ['cash', 'qqq', 'spy', 'qld', 'tqqq', 'sso', 'spxl', 'sqqq'];
const SS_RATE_OPTS = ssOpts([...ssRange(0, 13, 0.5), 14, 15, 16, 18, 20], (v) => (+v).toFixed(1) + '%');
const SS_COST_OPTS = ssOpts([0, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1], (v) => v + '%');
const SS_WIN_OPTS = ssOpts(ssRange(10, 300, 10));
const SS_BUF_OPTS = ssOpts([...ssRange(0, 2, 0.1), 2.5, 3, 3.5, 4, 4.5, 5, ...ssRange(6, 50, 1)], (v) => v + '%');
const SS_DAYS_OPTS = ssOpts([...ssRange(0, 15, 1), 20, 25, 30, 42, 63, 84, 105, 126],
  (v) => (v === 0 ? '즉시' : v === 42 ? '2개월' : v === 63 ? '3개월' : v === 84 ? '4개월' : v === 105 ? '5개월' : v === 126 ? '6개월' : v + '일'));

// 9sig — k: 내 키 · def: 기본값(문자열) · opts: [값, 표시]
const SS_P9 = [
  { k: 'cash', def: '40', opts: ssOpts(ssRange(0, 90, 10), (v) => v + '%') },
  { k: 'park', def: 'cash', opts: SS_PARK_OPTS.map((v) => [v, SS_TICK(v)]) },
  { k: 'ul', def: 'tqqq', opts: SS_ASSET_OPTS9.map((v) => [v, SS_TICK(v)]) },
  { k: 'cr', def: '4', opts: SS_RATE_OPTS },
  { k: 'per', def: 'quarterly', opts: [['weekly', '매주'], ['monthly', '매달'], ['quarterly', '매 분기'], ['yearly', '매년']] },
  { k: 'g', def: '9', opts: ssOpts([0.5, 0.6, 0.7, 0.8, 0.9, ...ssRange(1, 150, 1)], (v) => v + '%') },
  { k: 'cd', def: '30', opts: ssOpts([...ssRange(5, 100, 5), 110, 120, 130, 140, 150, 180], (v) => v + '%') },
  { k: 'cw', def: '24', opts: ssOpts([3, 6, 9, 12, 15, 18, 21, 24, 36, 48, 60], (v) => (v < 24 ? (v / 3) + '분기' : (v / 12) + '년')) },
  { k: 'st', def: '60', opts: ssOpts([0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100], (v) => v + '%') },
  { k: 'sp', def: '100', opts: ssOpts([0, 25, 50, 60, 70, 75, 80, 90, ...ssRange(100, 200, 10), 225, 250, 275, 300, 350, 400, 500], (v) => (v === 0 ? '끔' : v + '%')) },
  { k: 'bp', def: '90', opts: ssOpts([50, 60, 70, 75, 80, 85, 90, 95, 100], (v) => v + '%') },
  { k: 'cost', def: '0.02', opts: SS_COST_OPTS },
  { k: 'dep', def: '0', opts: ssOpts([0, 10, 25, 50, 75, 100], (v) => v + '%') },
  { k: 'rp', def: '0', opts: ssOpts(ssRange(0, 100, 5), (v) => v + '%') },
  { k: 'tc', def: 'holding', opts: [['holding', '직전 보유액'], ['target', '직전 목표액']] },
];

// SMA (이동평균 추세)
const SS_PSMA = [
  { k: 'ul', def: 'tqqq', opts: SS_ASSET_OPTS9.map((v) => [v, SS_TICK(v)]) },
  { k: 'sig', def: 'qqq', opts: ['qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'win', def: '200', opts: SS_WIN_OPTS },
  { k: 'eb', def: '0', opts: SS_BUF_OPTS },
  { k: 'xb', def: '0', opts: SS_BUF_OPTS },
  { k: 'cb', def: '0', opts: [['0', '0 (바로)'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']] },
  { k: 'cs', def: '0', opts: [['0', '0 (바로)'], ['2', '2'], ['3', '3'], ['5', '5'], ['10', '10']] },
  { k: 'settle', def: '1', opts: [['0', '0 (바로)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] },
  { k: 'ohw', def: '9', opts: ssOpts(ssRange(2, 30, 1)) },
  { k: 'oh', def: '90', opts: [...ssOpts(ssRange(10, 90, 5), (v) => v + ' 이상'), ['0', '끔 — 강제 매도 안 함']] },
  { k: 'coolw', def: '7', opts: ssOpts(ssRange(2, 30, 1)) },
  { k: 'cool', def: '80', opts: [...ssOpts(ssRange(10, 90, 5), (v) => v + ' 미만'), ['0', '수준 상관없이 (끔)']] },
  { k: 'out', def: 'cash', opts: ['cash', 'qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'cr', def: '4', opts: SS_RATE_OPTS },
  { k: 'din', def: '15', opts: SS_DAYS_OPTS },
  { k: 'dout', def: '15', opts: SS_DAYS_OPTS },
  { k: 'cost', def: '0.02', opts: SS_COST_OPTS },
  { k: 'bga', def: 'tqqq', opts: ['qqq', 'spy', 'tqqq', 'qld', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) },
  { k: 'bg', def: '40', opts: [...ssOpts(ssRange(5, 100, 5), (v) => '+' + v + '%'), ['0', '끔']] },
  { k: 'bgw', def: '200', opts: SS_WIN_OPTS },
];

const SS_PBH = [{ k: 'ul', def: 'tqqq', opts: ['tqqq', 'qld', 'qqq', 'spy', 'sso', 'spxl', 'sqqq'].map((v) => [v, SS_TICK(v)]) }];
// 현금 복리: r = 금리 슬라이더 위치(0~1000, 기본 200 = 4%)
const SS_PINV = [{ k: 'r', def: '200', opts: null }];

const SS_SCHEMA = { '9sig': SS_P9, sma: SS_PSMA, bh: SS_PBH, invested: SS_PINV };
const SS_PDEF = {};   // 'type.k' → 정의
for (const t in SS_SCHEMA) for (const p of SS_SCHEMA[t]) SS_PDEF[t + '.' + p.k] = p;

function ssDefaults(type) {
  const o = {};
  for (const p of SS_SCHEMA[type] || []) o[p.k] = p.def;
  return o;
}
// 저장·공유된 값이 선택지에 없으면 기본값으로 (옛 링크·손으로 고친 주소 대비)
function ssCleanParams(type, raw) {
  const out = ssDefaults(type);
  const src = raw || {};
  for (const p of SS_SCHEMA[type] || []) {
    if (!(p.k in src)) continue;
    const v = String(src[p.k]);
    if (!p.opts || p.opts.some((o) => o[0] === v)) out[p.k] = v;
    else if (type === '9sig' && p.k === 'dep' && v === '1') out[p.k] = '50';   // 옛 켬/끔 값 '1' = 50%
  }
  return out;
}
function ssParamsEqual(type, a, b) {
  for (const p of SS_SCHEMA[type] || []) if (String((a || {})[p.k]) !== String((b || {})[p.k])) return false;
  return true;
}
function ssOptLabel(type, k, v) {
  const p = SS_PDEF[type + '.' + k];
  if (!p || !p.opts) return String(v);
  const o = p.opts.find((x) => x[0] === String(v));
  return o ? o[1] : String(v);
}

// 손잡이 → 엔진 옵션 (원본의 기본값 대체 규칙 그대로: 0·빈 값이면 엔진 기본)
const ssNum = (v, d) => { const n = +v; return Number.isFinite(n) ? n : d; };
function ssOpts9(p) {
  return {
    growth: (+p.g) / 100 || 0.09,
    crashDrop: ssNum(p.cd, 30),
    crashMonths: +p.cw || 24,
    spike: ssNum(p.sp, 100),
    ul: SS_COL[p.ul] || 1,
    cashPct: (+p.cash || 0) / 100,
    deploy: (+p.dep || 0) / 100,
    fromTarget: p.tc === 'target' || p.tc === '1',
    buyPower: +p.bp || 90,
    park: p.park || 'cash',
    spikeReset: p.st || 'auto',
    cost: +p.cost || 0,
  };
}
function ssOptsSma(p) {
  return {
    signal: p.sig || 'qqq',
    win: +p.win || 200,
    ul: SS_COL[p.ul] || 1,
    entryBuf: +p.eb || 0,
    exitBuf: +p.xb || 0,
    ohRsi: +p.oh || 0,
    coolRsi: +p.cool || 0,
    out: p.out || 'cash',
    easeIn: +p.din || 0,
    easeOut: +p.dout || 0,
    bubble: +p.bg || 0,
    bubbleAsset: p.bga || 'qqq',
    bubbleWin: +p.bgw || 0,
    cost: +p.cost || 0,
    ohWin: +p.ohw || 10,
    coolWin: +p.coolw || 10,
    check: 'daily',
    confirmBuy: +p.cb || 0,
    confirmSell: +p.cs || 0,
    settle: +p.settle || 0,
  };
}
const ssRate9 = (p) => (+p.cr || 0) / 100;
