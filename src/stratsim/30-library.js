/* ── [STRATSIM] 30 전략 라이브러리 ─────────────────────────────────────────
   레버리지 ETF 로 많이 알려진 타이밍·회전 전략 + 직접 고른 전략 + 과최적화 탐색 1위 설정, 모두 44개.
   카드 숫자(5개 시기의 연평균·최대 낙폭, 1995년부터의 분기 곡선)는 창을 열 때 이 앱 자료로 직접 계산 —
   미리 적어 둔 값이 없어 자료가 갱신되면 그대로 따라감. 계산 규칙은 원본 Strategies Simulator 와 같음.
   '써 보기' = 저장 전략으로 추가 (프리셋 → 기본 9sig/SMA 엔진, 코드 → 사용자 전략: 격리 Worker 에서 실행)
   코드 문자열은 하나하나가 혼자 돌아가야 함(저장된 사본은 Worker 안에서 따로 실행) → 공용 조각을 글자 그대로 끼워 넣음 */

// ── 전략 코드 공용 조각 (문자열로 각 코드 안에 들어감) ───────────────────────
const SLK_STAT_SMA = '{ id: "stat", label: "중심선", options: [{ value: "sma", label: "이동평균" }, { value: "median", label: "중앙값" }], default: "sma" }';
const SLK_STAT_MED = '{ id: "stat", label: "중심선", options: [{ value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" }], default: "median" }';
const SLK_ASSET6 = `{ id: "asset", label: "매매 종목", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "spxl", label: "SPXL" },
      { value: "sso", label: "SSO" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" } ] }`;
const SLK_COST13 = '{ id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [0, 0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 0.75, 1] }';
const SLK_RATE15 = '{ id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8] }';

// 중심선: 그날까지 W 거래일 안의 양수 종가로 평균(sma) 또는 중앙값(median)
const SLK_LINE = `    // 중심선 — 그날까지 W 거래일 안의 양수 종가로 평균 또는 중앙값 (p.stat)
    // 평균은 날마다 같은 순서로 처음부터 다시 더하고, 중앙값은 정렬된 창을 하루씩 밀어 빠르게 구함
    const lineOf = (arr, W) => {
      const med = p.stat === "median";
      let win = null, at = -2;
      const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      return (i) => {
        const from = Math.max(0, i - W + 1);
        if (!med) {
          let s = 0, n = 0;
          for (let k = from; k <= i; k++) if (arr[k] > 0) { s += arr[k]; n++; }
          return n ? s / n : 0;
        }
        if (win === null || i !== at + 1) {
          win = [];
          for (let k = from; k <= i; k++) if (arr[k] > 0) win.push(arr[k]);
          win.sort((a, b) => a - b);
        } else {
          if (arr[i] > 0) win.splice(pos(arr[i]), 0, arr[i]);
          const out = i - W;
          if (out >= 0 && arr[out] > 0) win.splice(pos(arr[out]), 1);
        }
        at = i;
        const n = win.length;
        return n === 0 ? 0 : n % 2 ? win[(n - 1) / 2] : (win[n / 2 - 1] + win[n / 2]) / 2;
      };
    };`;

// 기록 간격 (차트 가로축이 주 단위면 주의 마지막 거래일, 아니면 달의 마지막 거래일)
const SLK_TICK = `      // 기록 줄 간격 — 차트 가로축이 주 단위면 주의 마지막 거래일, 아니면 달의 마지막 거래일
      const tick = i === p.endIdx || (p.weeklyDisplay
        ? Math.floor((Date.parse(data.dates[i]) / 864e5 + 3) / 7) !== Math.floor((Date.parse(data.dates[i + 1]) / 864e5 + 3) / 7)
        : data.dates[i + 1].slice(0, 7) !== data.dates[i].slice(0, 7));`;

// 들어온 돈 (출금은 음수) — 한 종목(sh, lev[i]) 전략
const SLK_MONEY1 = `      let contributed = 0, action = "hold";
      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 모자란 만큼 오늘 종가로 팔고 현금은 0 — 계좌는 0 아래로 내려가지 않음
          const cut = Math.min(sh * (lev[i] || 0), -cash);
          if (cut > 0) sh = Math.max(0, sh - cut / lev[i]);
          cash = 0;
        }
      }`;
// 두 종목을 들고 있을 수 있는 전략 (a 먼저, 그다음 b 를 팔아 출금을 메움)
const slkMoney2 = (a, pa, b, pb, la, lb) => `      let contributed = 0, action = "hold";
      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 ${la} 먼저, 그다음 ${lb} 를 오늘 종가로 팔아 메우고 현금은 0 (계좌는 0 아래로 안 감)
          let cut = Math.min(${a} * (${pa} || 0), -cash);
          if (cut > 0) { ${a} = Math.max(0, ${a} - cut / ${pa}); cash += cut; }
          cut = Math.min(${b} * (${pb} || 0), -cash);
          if (cut > 0) { ${b} = Math.max(0, ${b} - cut / ${pb}); cash += cut; }
          cash = 0;
        }
      }`;
// 수수료를 따지는 전략: 들고 있는 것(held)을 비용까지 감안해 필요한 만큼 판매
const slkMoneyHeld = (traded) => `      const amt = p.contributions ? p.contributions[data.dates[i]] : 0;
      if (amt) {
        cash += amt; contributed = amt; invested += amt; action = "contribution";
        if (cash < 0) {   // 출금이 현금보다 크면 들고 있는 것을 오늘 종가로 필요한 만큼(비용 포함) 팔고 현금은 0
          const hx = priceOf(held, i), g = Math.min(shares * hx, -cash / (1 - cost));
          if (g > 0) { shares = Math.max(0, shares - g / hx); fee += g * cost;${traded ? ' traded += g;' : ''} note = "출금 — " + held.toUpperCase() + " 일부 매도"; }
          cash = 0;
        }
      }`;
const SLK_LOG1 = `      if (contributed !== 0 || action === "buy" || action === "sell" || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });`;
// 매일 판단 — up 이면 lev 보유, 아니면 현금 (팔 때 판 금액을 현금에 더함 — 그날 들어온 적립금이 사라지지 않게)
const SLK_DAILY = `      if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
      else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }`;
// 와일더 RSI 를 시작 전 back 거래일부터 데움 (sig 기준)
const slkRsiSeed = (RW, back) => `    // RSI(${RW}) — 시작 ${back}거래일 전부터 와일더 방식으로 미리 데움
    const RW = ${RW};
    let au = 0, ad = 0;
    const s0 = Math.max(1, p.startIdx - ${back});
    for (let k = s0; k < s0 + RW && k <= p.startIdx; k++) { const d = sig[k] - sig[k - 1]; if (d > 0) au += d; else ad -= d; }
    au /= RW; ad /= RW;
    for (let k = s0 + RW; k < p.startIdx; k++) { const d = sig[k] - sig[k - 1]; au = (au * (RW - 1) + (d > 0 ? d : 0)) / RW; ad = (ad * (RW - 1) + (d < 0 ? -d : 0)) / RW; }`;
const SLK_RSI_STEP = `      const d = sig[i] - sig[i - 1];
      au = (au * (RW - 1) + (d > 0 ? d : 0)) / RW; ad = (ad * (RW - 1) + (d < 0 ? -d : 0)) / RW;
      const rsi = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);`;

// 한 종목 ↔ 현금, 매일 판단하는 단순 타이밍 전략의 코드
function slDailyCode(o) {
  return `{
  name: ${JSON.stringify(o.name)},
  params: [
    ${o.params.join(',\n    ')}
  ],
  run(data, p) {
    // ${o.about}
    const log = [], ${o.vars};
${SLK_LINE}
${o.setup}
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
${o.day}
${SLK_DAILY}
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;
}
const slkWin = (opts, def) => '{ id: "window", label: "기간 (일)", options: [' + opts.join(', ') + '], default: ' + (def || 200) + ' }';
const SLK_SIG_LINE = '      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c;';

const SL_CODE = {};

// #1 Faber — QQQ 를 중심선과 비교, 달의 마지막 거래일에만 판단
SL_CODE[1] = `{
  name: "Faber 10개월·200일 (월말 판단) → TQQQ/현금",
  params: [
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // QQQ 종가가 중심선 위면 TQQQ, 아래면 현금(이자 없음). 판단은 달의 마지막 거래일(다음 거래일이 다른 달)에만 —
    // 차트 가로축이 주 단위여도, 계산이 달 중간에 끝나도 그대로 (기록 줄 간격과는 따로)
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], nx = data.dates[i + 1];
      if (nx !== undefined && nx.slice(0, 7) !== data.dates[i].slice(0, 7)) {
        const c = line(i), up = c > 0 && sig[i] > c;
        if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
${SLK_TICK}
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[2] = slDailyCode({
  name: 'Gayed LRS 3배 — SPY 200일선 → SPXL/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SPXL(S&P 3배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.spxl',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[3] = slDailyCode({
  name: 'Gayed LRS 2배 — SPY 200일선 → SSO/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SSO(S&P 2배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.sso',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});

// #8 Siegel — 위아래 대칭 띠, 띠 안에서는 그대로
SL_CODE[8] = `{
  name: "Siegel ±띠 — SPY 200일선 → TQQQ/현금",
  params: [
    { id: "band", label: "띠 (중심선 ± %)", options: [0, 1, 2, 3], default: 1 },
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: SPY 가 중심선 + 띠 이상이면 TQQQ, 중심선 − 띠 이하면 현금(이자 없음). 띠 안에서는 그대로 둠
    const log = [], sig = data.spy, lev = data.tqqq, hiK = 1 + p.band / 100, loK = 1 - p.band / 100;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const c = line(i), px = lev[i], s = sig[i];
      if (c > 0 && s > 0) {
        if (!inMkt && s >= c * hiK && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (inMkt && s <= c * loK) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[9] = slDailyCode({
  name: 'TQQQ 표준 200일선 — 신호 SPY/QQQ → TQQQ/현금',
  params: ['{ id: "signal", label: "신호 종목", options: [{ value: "spy", label: "SPY" }, { value: "qqq", label: "QQQ" }], default: "spy" }', slkWin([100, 150, 200, 250]), SLK_STAT_SMA],
  about: '매일: 신호 종목이 중심선 위면 TQQQ, 아래면 현금(이자 없음)',
  vars: 'sig = data[p.signal], lev = data.tqqq',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[10] = slDailyCode({
  name: 'QQQ 200일선 → TQQQ, 아니면 현금',
  params: [
    '{ id: "signal", label: "신호 종목", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" }',
    '{ id: "lev", label: "레버리지 종목", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" }',
    slkWin([100, 150, 200, 250]), SLK_STAT_SMA],
  about: '매일: 신호 종목이 중심선 위면 레버리지 종목, 아래면 현금(이자 없음)',
  vars: 'sig = data[p.signal], lev = data[p.lev]',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[11] = slDailyCode({
  name: 'SPY 200일선 → UPRO(SPXL)/현금',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SPY 가 중심선 위면 SPXL(UPRO 와 같은 S&P 3배), 아래면 현금(이자 없음)',
  vars: 'sig = data.spy, lev = data.spxl',
  setup: '    const line = lineOf(sig, p.window);',
  day: SLK_SIG_LINE,
});
SL_CODE[12] = slDailyCode({
  name: 'SSO 자기 200일선 → SSO/현금 (2배)',
  params: [slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: SSO 가 자기 중심선 위면 SSO, 아래면 현금(이자 없음)',
  vars: 'lev = data.sso',
  setup: '    const line = lineOf(lev, p.window);',
  day: '      const c = line(i), px = lev[i], up = c > 0 && px > c;',
});

// #13 Hollywood — SPY 위아래 다른 띠로 TQQQ ↔ QQQ (현금으로는 안 감)
SL_CODE[13] = `{
  name: "Hollywood SPY 200일선 +4/−3 → TQQQ/QQQ",
  params: [
    { id: "entry", label: "TQQQ 로 가는 띠 (중심선 위 %)", options: [0, 2, 3, 4, 5], default: 4 },
    { id: "exit", label: "QQQ 로 가는 띠 (중심선 아래 %)", options: [0, 2, 3, 4, 5], default: 3 },
    ${slkWin([100, 150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: SPY 가 중심선 + 진입 띠 이상이면 TQQQ, 중심선 − 탈출 띠 이하면 QQQ. 사이에서는 그대로 (시작은 QQQ)
    const log = [], sig = data.spy, hiK = 1 + p.entry / 100, loK = 1 - p.exit / 100;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shT = 0, shQ = 0, mode = "qqq";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shT', 'data.tqqq[i]', 'shQ', 'data.qqq[i]', 'TQQQ', 'QQQ')}
      const c = line(i), s = sig[i];
      if (c > 0 && s > 0) { if (s >= c * hiK) mode = "tqqq"; else if (s <= c * loK) mode = "qqq"; }
      const pxT = data.tqqq[i], pxQ = data.qqq[i], now = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "none");
      let traded = false;
      if (mode !== now && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (mode === "tqqq") shT = cash / pxT; else shQ = cash / pxQ;
        cash = 0; traded = true;
        action = mode === "tqqq" ? "매수 — TQQQ" : "위험 축소 — QQQ";
      } else if (cash > 0) {
        if (mode === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (mode === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

SL_CODE[15] = slDailyCode({
  name: 'Composer 200일선 + RSI → TQQQ/현금',
  params: ['{ id: "rsiMax", label: "들고 있을 RSI(14) 상한", options: [60, 70, 80, 100], default: 80 }', slkWin([150, 200, 250]), SLK_STAT_SMA],
  about: '매일: QQQ 가 중심선 위이고 QQQ 의 RSI(14) 가 상한 미만이면 TQQQ, 아니면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const line = lineOf(sig, p.window);\n' + slkRsiSeed(14, 60),
  day: SLK_RSI_STEP + '\n      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c && rsi < p.rsiMax;',
});

// #17 MACD — QQQ 일봉 MACD(12/26, 신호선 9) + TQQQ 추적 손절
SL_CODE[17] = `{
  name: "MACD(12/26) → TQQQ/현금 (+추적 손절)",
  params: [{ id: "trail", label: "추적 손절 (고점 대비 %)", options: [0, 20, 30, 40], default: 30 }],
  run(data, p) {
    // 매일: MACD 가 신호선과 0 보다 모두 위면 TQQQ, 아니면 현금(이자 없음).
    // 들고 있는 동안 TQQQ 가 산 뒤 고점에서 trail% 넘게 빠지면 추적 손절
    const log = [], sig = data.qqq, lev = data.tqqq, trail = p.trail / 100;
    const kF = 2 / 13, kS = 2 / 27, kG = 2 / 10;
    const s0 = Math.max(0, p.startIdx - 60);
    let fast = sig[s0] || 0, slow = sig[s0] || 0, macd = 0, gline = 0;
    const step = (v) => { fast += kF * (v - fast); slow += kS * (v - slow); macd = fast - slow; gline += kG * (macd - gline); };
    for (let k = s0 + 1; k < p.startIdx; k++) if (sig[k] > 0) step(sig[k]);
    let cash = p.initial, sh = 0, inMkt = false, peak = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const v = sig[i], px = lev[i];
      if (v > 0) step(v);
      const up = macd > gline && macd > 0;
      if (inMkt && px > peak) peak = px;
      const stop = inMkt && trail > 0 && px > 0 && px < peak * (1 - trail);
      let traded = false;
      if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; peak = px; action = "buy"; traded = true; }
      else if ((!up || stop) && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = stop ? "추적 손절 매도" : "sell"; traded = true; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #18 40주 — 주의 마지막 거래일에만 판단
SL_CODE[18] = `{
  name: "40주 이동평균 (주말 판단) → TQQQ/현금",
  params: [
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 주의 마지막 거래일(다음 거래일이 다른 주 — 월요일에 바뀌는 주)에만: QQQ 가 중심선 위면 TQQQ, 아래면 현금(이자 없음)
    // 계산이 주 중간에 끝나도 그날은 판단하지 않음
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    const weekNo = (s) => Math.floor((Date.parse(s) / 864e5 + 3) / 7);
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], nx = data.dates[i + 1];
      if (nx !== undefined && weekNo(nx) !== weekNo(data.dates[i])) {
        const c = line(i), up = c > 0 && sig[i] > c;
        if (up && !inMkt && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
        else if (!up && inMkt) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      }
      if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[19] = slDailyCode({
  name: '골든·데드 크로스 50/200 → TQQQ/현금',
  params: ['{ id: "fast", label: "빠른 선 (일)", options: [20, 50, 100], default: 50 }', '{ id: "slow", label: "느린 선 (일)", options: [150, 200, 250], default: 200 }', SLK_STAT_SMA],
  about: '매일: QQQ 의 빠른 중심선이 느린 중심선 위면 TQQQ, 아래면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const fastL = lineOf(sig, p.fast), slowL = lineOf(sig, p.slow);',
  day: '      const a = fastL(i), b = slowL(i), px = lev[i], up = b > 0 && a > b;',
});

// #20 변동성 목표 — 매달 첫 거래일에 TQQQ 비중 재조정
SL_CODE[20] = `{
  name: "변동성 목표 TQQQ (목표 변동성에 맞춰 비중 조절)",
  params: [
    { id: "target", label: "목표 변동성 (연 %)", options: [15, 20, 25, 30], default: 25 },
    { id: "lookback", label: "변동성 계산 기간 (일)", options: [20, 40, 60], default: 20 }
  ],
  run(data, p) {
    // 매달 첫 거래일: TQQQ 비중 = 목표 ÷ 최근 일간 수익률의 연율 변동성 (0~100%), 나머지는 현금(이자 없음)
    const log = [], lev = data.tqqq, L = p.lookback, goal = p.target / 100;
    let cash = p.initial, sh = 0, month0 = null, w = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
      const px = lev[i], month = data.dates[i].slice(0, 7), newMonth = month0 === null || month !== month0;
      month0 = month;
      if (newMonth && px > 0) {
        const rets = [];
        let mean = 0;
        for (let k = Math.max(1, i - L + 1); k <= i; k++) if (lev[k] > 0 && lev[k - 1] > 0) { const r = lev[k] / lev[k - 1] - 1; rets.push(r); mean += r; }
        const n = rets.length;
        mean = n ? mean / n : 0;
        let vol = 0;
        for (const r of rets) vol += (r - mean) * (r - mean);
        vol = n ? Math.sqrt(vol / n) * Math.sqrt(252) : 0;
        const tw = vol > 0 ? Math.max(0, Math.min(1, goal / vol)) : 0;
        const total = sh * px + cash;
        sh = (total * tw) / px; cash = total - sh * px; w = tw; action = "rebalance";
      }
${SLK_TICK}
      if (contributed !== 0 || action === "rebalance" || tick)
        log.push({ date: data.dates[i], value: sh * px + cash, price: px, contributed: contributed, action: action, weight: w });
    }
    return { log: log };
  }
}`;

SL_CODE[22] = `{
  name: "Connors RSI(2) 눌림 매수 (200일 추세 안)",
  params: [
    { id: "buy", label: "RSI(2) 가 이 아래면 매수", options: [5, 10, 15], default: 10 },
    { id: "sell", label: "RSI(2) 가 이 위면 매도", options: [60, 70, 80], default: 70 },
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: QQQ 가 200일 중심선 위일 때 RSI(2) 가 매수 기준 아래면 TQQQ 를 사고,
    // RSI(2) 가 매도 기준 위이거나 중심선 아래면 현금(이자 없음)
    const log = [], sig = data.qqq, lev = data.tqqq;
${SLK_LINE}
    const line = lineOf(sig, 200);
${slkRsiSeed(2, 30)}
    let cash = p.initial, sh = 0, inMkt = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_MONEY1}
${SLK_RSI_STEP}
      const c = line(i), px = lev[i], trend = c > 0 && sig[i] > c;
      if (trend && !inMkt && rsi < p.buy && px > 0) { sh = cash / px; cash = 0; inMkt = true; action = "buy"; }
      else if (inMkt && (!trend || rsi > p.sell)) { cash += sh * px; sh = 0; inMkt = false; action = "sell"; }
      else if (inMkt && cash > 0 && px > 0) { sh += cash / px; cash = 0; }
${SLK_TICK}
${SLK_LOG1}
    }
    return { log: log };
  }
}`;

SL_CODE[23] = slDailyCode({
  name: '200일선 + RSI 과열 매도·식음 재진입',
  params: ['{ id: "oh", label: "과열 매도: RSI(10) 이 이 이상", options: [60, 70, 80, 100], default: 80 }', '{ id: "cool", label: "다시 살 때: RSI(10) 이 이 미만", options: [40, 50, 60, 100], default: 60 }', SLK_STAT_SMA],
  about: '매일: QQQ 가 200일 중심선 위이고 RSI(10) 이 과열 기준 미만이면 TQQQ — 새로 살 때는 RSI(10) 이 식음 기준 미만이어야 함. 아니면 현금(이자 없음)',
  vars: 'sig = data.qqq, lev = data.tqqq',
  setup: '    const line = lineOf(sig, 200);\n' + slkRsiSeed(10, 40),
  day: SLK_RSI_STEP + '\n      const c = line(i), px = lev[i], up = c > 0 && sig[i] > c && rsi < p.oh && (inMkt || rsi < p.cool);',
});

// #24 보디가드 — QQQ 가 중심선보다 많이 위면 QQQ 로 줄이고, 더 위면 전부 현금
SL_CODE[24] = `{
  name: "200일선 + 보디가드 (레버리지 축소·전부 현금)",
  params: [
    { id: "delev", label: "QQQ 로 줄이기 (중심선 위 %)", options: [0, 20, 25, 30, 35, 40], default: 30 },
    { id: "gtfo", label: "전부 현금 (중심선 위 %)", options: [0, 35, 40, 45, 50], default: 40 },
    ${slkWin([150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: QQQ 가 중심선 아래면 현금, 중심선보다 gtfo% 이상 위면 현금, delev% 이상 위면 QQQ, 그 밖엔 TQQQ (현금 이자 없음)
    const log = [], sig = data.qqq;
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shT = 0, shQ = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shT', 'data.tqqq[i]', 'shQ', 'data.qqq[i]', 'TQQQ', 'QQQ')}
      const c = line(i), q = sig[i], gap = c > 0 ? (q / c - 1) * 100 : 0;
      let want;
      if (c <= 0 || q <= 0 || q < c) want = "cash";
      else if (p.gtfo > 0 && gap >= p.gtfo) want = "cash";
      else if (p.delev > 0 && gap >= p.delev) want = "qqq";
      else want = "tqqq";
      const pxT = data.tqqq[i], pxQ = data.qqq[i], now = shT > 0 ? "tqqq" : (shQ > 0 ? "qqq" : "cash");
      let traded = false;
      if (want !== now && pxT > 0 && pxQ > 0) {
        cash += shT * pxT + shQ * pxQ; shT = 0; shQ = 0;
        if (want === "tqqq") { shT = cash / pxT; cash = 0; } else if (want === "qqq") { shQ = cash / pxQ; cash = 0; }
        action = want === "tqqq" ? "buy" : (want === "qqq" ? "레버리지 축소 — QQQ" : "전부 현금으로");
        traded = true;
      } else if (cash > 0) {
        if (want === "tqqq" && pxT > 0) { shT += cash / pxT; cash = 0; }
        else if (want === "qqq" && pxQ > 0) { shQ += cash / pxQ; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shT * pxT + shQ * pxQ + cash, price: pxT, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #25 늘 투자 — 중심선 아래면 현금 대신 신호 종목(1배)을 들고 있음
SL_CODE[25] = `{
  name: "200일선 → TQQQ, 아니면 QQQ (늘 투자)",
  params: [
    { id: "signal", label: "신호·대기 종목", options: [{ value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }], default: "qqq" },
    { id: "lev", label: "레버리지 종목", options: [{ value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" }, { value: "sso", label: "SSO" }, { value: "spxl", label: "SPXL" }], default: "tqqq" },
    ${slkWin([100, 150, 200, 250])},
    ${SLK_STAT_SMA}
  ],
  run(data, p) {
    // 매일: 신호 종목이 중심선 위면 레버리지 종목, 아래면 신호 종목 자체(1배)를 보유 — 현금으로는 안 감
    const log = [], sig = data[p.signal], lev = data[p.lev];
${SLK_LINE}
    const line = lineOf(sig, p.window);
    let cash = p.initial, shL = 0, shP = 0, mode = "park";
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${slkMoney2('shL', 'lev[i]', 'shP', 'sig[i]', '레버리지 종목', '대기 종목')}
      const c = line(i), pxL = lev[i], pxP = sig[i], want = (c > 0 && sig[i] > c) ? "lev" : "park";
      let traded = false;
      if (want !== mode && pxL > 0 && pxP > 0) {
        cash += shL * pxL + shP * pxP; shL = 0; shP = 0;
        if (want === "lev") shL = cash / pxL; else shP = cash / pxP;
        cash = 0; mode = want; traded = true;
        action = want === "lev" ? "buy" : "위험 축소 — " + p.signal.toUpperCase();
      } else if (cash > 0) {
        if (mode === "lev" && pxL > 0) { shL += cash / pxL; cash = 0; }
        else if (mode === "park" && pxP > 0) { shP += cash / pxP; cash = 0; }
      }
${SLK_TICK}
      if (contributed !== 0 || traded || tick)
        log.push({ date: data.dates[i], value: shL * pxL + shP * pxP + cash, price: pxL, contributed: contributed, action: action });
    }
    return { log: log };
  }
}`;

// #26 중앙값 과열 — 매매 종목이 자기 중심선보다 많이 위면 비켜섬 (내려갈 때 규칙 없음)
SL_CODE[26] = `{
  name: "중앙값 과열 250일",
  params: [
    ${SLK_ASSET6},
    { id: "park", label: "빠졌을 때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" },
      { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { id: "threshold", label: "중심선보다 이만큼 위면 매도 (%)", default: 55, options: [
      10, 15, 20, 25, 30, 35, 40, 42, 44, 46, 48, 50, 52, 54, 55, 56, 58, 60, 62, 64, 66, 68, 70, 75, 80, 85, 90, 100, 110, 125, 150, 175, 200] },
    ${SLK_STAT_MED},
    { id: "window", label: "기간 (일)", default: 250, options: [
      40, 60, 80, 100, 120, 140, 160, 180, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310, 320, 340, 360, 380, 400, 450, 500] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "assetPrice", label: "가격", tip: "그날 매매 종목의 종가. 매도 규칙은 이 값을 이동 중심선과 비교합니다." },
    { key: "medianPrice", label: "중심선", tip: "매매 종목의 최근 N거래일 중심선 — 기본은 중앙값(창의 절반은 위, 절반은 아래에서 마감), 중심선 설정을 바꾸면 이동평균." },
    { key: "overPct", label: "중심선 대비", tip: "가격이 중심선보다 몇 % 위(+)·아래(−)인지. 매도 기준을 넘으면 팔고, 다시 그 아래로 내려오는 즉시 되삽니다. 중심선이 비어 있는 처음에는 0." },
    { key: "sellLevel", label: "매도선", tip: "중심선보다 정확히 매도 기준만큼 위인 가격. 이 위로 마감하면 팔고, 다시 아래로 내려오면 삽니다." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = p.window || 250, thr = (p.threshold || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // 이동 창: 정렬 배열(중앙값) + 합계(평균) — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; } };
    const from = Math.max(0, p.startIdx - W + 1);
    for (let k = from; k < p.startIdx; k++) if (px[k] > 0) put(px[k]);
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, mid = 0, over = 0;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (px[i] > 0) put(px[i]);
      if (i - W >= from && px[i - W] > 0) take(px[i - W]);   // 창에서 빠지는 날 (데울 때 넣은 날부터만 — 늘 정확히 W 거래일)
      const n = win.length;
      mid = n === 0 ? 0 : (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : total / n);
      over = mid > 0 && px[i] > 0 ? px[i] / mid - 1 : 0;
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      let want = held;
      if (mid > 0 && px[i] > 0) want = over > thr ? p.park : p.asset;
      if (want !== held) {
        const oldPx = priceOf(held, i), newPx = priceOf(want, i);
        if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
        if (want !== "cash" && newPx > 0) { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = "가격 " + (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(1) + "% — " + W + "일 " + CN + " 대비";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i], medianPrice: mid, overPct: over * 100, sellLevel: mid * (1 + thr) });
    }
    const hot = over > thr;
    const pct = (over >= 0 ? "+" : "−") + Math.abs(over * 100).toFixed(2) + "%";
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "medianPrice", label: W + "일 " + CN },
        { key: "sellLevel", label: "과열선 (+" + (p.threshold || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "일 " + CN,
            value: (hot ? "▲ " : "") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendUp" : "activity",
            sub: (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            tip: A + " 의 마지막 종가가 최근 " + W + "거래일 이동 " + CN + "보다 얼마나 위·아래인지입니다. 매도 기준보다 낮으면 그대로 들고 있고, 넘으면 가격이 너무 달아난 것으로 보고 비켜섭니다." },
          { label: "매도 기준",
            value: "+" + (p.threshold || 0) + "%",
            icon: "flag",
            sub: hot ? "넘어섬 — " + A + " 에서 나와 있음" : "여유 " + (Math.max(0, thr - over) * 100).toFixed(1) + "%p",
            tip: "가격이 " + CN + "보다 이만큼 위로 달아나면 팔고 " + K + "(으)로 옮깁니다. 다시 이 선 아래로 내려오는 즉시 " + A + " 를 삽니다." },
          { label: "빠졌을 때 보유",
            value: K,
            icon: "shield",
            sub: p.park === "cash" ? "연 " + (p.cashRate || 0) + "% 이자" : "빠져 있어도 시장에 남음",
            tip: "매도 신호가 켜져 있는 동안 돈이 머무는 곳입니다. 현금은 정한 이자를 받고, 다른 종목은 시장에 남되 덜 위험합니다." }
        ],
        decision: {
          action: hot ? (p.park === "cash" ? "현금 유지" : K + " 매수") : A + " 매수",
          note: hot ? "가격이 " + CN + "보다 " + (p.threshold || 0) + "% 넘게 위" : "가격이 보통 범위 안",
          tone: hot ? "bad" : "good",
          reasons: [{
            name: "중심선 과열",
            val: A + " " + pct + " vs " + W + "일 " + CN,
            tag: hot ? "밖 · " + K : "안 · " + A,
            lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// #39 과열 매도 — 신호 종목(기본 SSO)이 자기 이동평균보다 많이 위면 비켜섬
SL_CODE[39] = `{
  name: "과열 매도 (많이 오르면 팔기)",
  params: [
    ${SLK_ASSET6},
    { id: "signal", label: "신호 종목", default: "sso", options: [
      { value: "sso", label: "SSO" }, { value: "spy", label: "SPY" }, { value: "qqq", label: "QQQ" }, { value: "tqqq", label: "TQQQ" } ] },
    ${SLK_STAT_SMA},
    { id: "window", label: "기간 (일)", default: 150, options: [
      20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200,
      210, 220, 230, 240, 250, 260, 270, 280, 300, 320, 350, 400] },
    { id: "stretch", label: "중심선보다 이만큼 위면 매도 (%)", default: 20, options: [
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 30, 32, 35, 40, 45, 50] },
    { id: "park", label: "빠졌을 때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" } ] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "signalPrice", label: "신호 종가", tip: "과열 신호를 읽는 종목(기본 SSO)의 종가 — 매매하는 종목과 다를 수 있습니다." },
    { key: "signalSma", label: "중심선", tip: "신호 종목의 중심선(중심선 설정에 따라 이동평균 또는 중앙값). 신호 종가를 이 선과 비교합니다." },
    { key: "abovePct", label: "중심선 대비", tip: "신호 종가가 중심선보다 몇 % 위(+)·아래(−)인지. 매도 기준을 넘으면 팔고, 기준 이하인 동안은 매매 종목을 들고 있습니다." },
    { key: "assetPrice", label: "종목 가격", tip: "그날 매매 종목의 종가 — 빠져 있는 날에도 보여 주어 무엇에서 나와 있는지 알 수 있습니다." },
    { key: "triggerLine", label: "매도선", tip: "신호 종목의 중심선보다 정확히 매도 기준만큼 위인 값 — 신호가 이 위로 마감하면 비키고, 다시 아래로 오면 되삽니다." }
  ],
  run(data, p) {
    const log = [];
    const sig = data[p.signal] || data.sso, px0 = data[p.asset] || data.tqqq;
    const W = p.window, thr = (p.stretch || 0) / 100;
    const useMed = p.stat === "median", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : data[id][i];
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, mid = 0, above = 0;
    // 이동 창: 합계(평균)와 정렬 배열(중앙값)을 함께 — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0, cnt = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; cnt++; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; cnt--; } };
    for (let k = Math.max(0, p.startIdx - W + 1); k <= p.startIdx; k++) if (sig[k] > 0) put(sig[k]);
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) {
        if (sig[i] > 0) put(sig[i]);
        if (i - W >= 0 && sig[i - W] > 0) take(sig[i - W]);
      }
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      mid = cnt > 0 ? (useMed ? (cnt % 2 ? win[(cnt - 1) >> 1] : (win[cnt / 2 - 1] + win[cnt / 2]) / 2) : total / cnt) : 0;
      above = mid > 0 ? sig[i] / mid - 1 : 0;
      let want = held;
      if (mid > 0) want = above > thr ? p.park : p.asset;
      if (want !== held) {
        const oldPx = priceOf(held, i), newPx = priceOf(want, i);
        if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
        if (want !== "cash" && newPx > 0) { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% — " + (useMed ? "중앙값" : "이동평균") + " 대비 (기준 " + (thr * 100).toFixed(0) + "%)";
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          signalPrice: sig[i], signalSma: mid, abovePct: above * 100, assetPrice: px0[i],
          triggerLine: mid * (1 + thr) });
    }
    const hot = above > thr;
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const gap = thr * 100 - above * 100, T = (thr * 100).toFixed(0);
    const A = p.asset.toUpperCase(), S = p.signal.toUpperCase();
    const K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "signalPrice", label: S + " 가격" },
        { key: "signalSma", label: W + "일 " + CN },
        { key: "triggerLine", label: "매도선 (+" + (p.stretch || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: S + " vs " + p.window + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendDown" : "trendUp",
            sub: (sig[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            tip: S + " 가 " + p.window + "일 중심선보다 얼마나 위인지입니다. +" + T + "% 이하면 " + A + " 를 들고 있고, 넘어서면 팝니다." },
          { label: "매도 기준",
            value: "+" + T + "%",
            icon: "flag",
            sub: hot ? "기준을 넘어 작동 중" : S + " 가 이만큼 달아나면 작동",
            tip: "과열 기준: " + S + " 가 중심선보다 이만큼 넘게 위로 마감하면 " + A + " 를 팔고 " + K + "(으)로 옮깁니다." },
          { label: "기준까지 거리",
            value: gap >= 0 ? "여유 " + gap.toFixed(2) + "%" : Math.abs(gap).toFixed(2) + "% 넘어섬",
            tone: hot ? "bad" : "good",
            icon: "activity",
            sub: hot ? "+" + T + "% 아래로 돌아와야 되삼" : S + " 가 팔기 전까지 더 오를 수 있는 폭",
            tip: "지금 늘어난 정도와 매도 기준의 차이입니다. 양수면 들고 있으면서 남은 여유, 음수면 이미 기준을 넘어 빠져 있다는 뜻입니다." },
          { label: "빠졌을 때 보유",
            value: K,
            icon: p.park === "cash" ? "dollar" : "shield",
            sub: p.park === "cash" ? "기다리는 돈에 연 " + (p.cashRate || 0) + "% 이자" : A + " 에서 나와 있는 동안 " + K + " 보유",
            tip: "과열로 판 뒤 돈이 머무는 곳입니다. " + S + " 가 기준 이하로 돌아오는 즉시 " + A + " 로 돌아갑니다." }
        ],
        decision: {
          action: hot ? (p.park === "cash" ? "현금 유지" : K + " 매수") : A + " 매수",
          note: hot ? S + " 가 " + (useMed ? "중앙값" : "평균") + "보다 " + pct + " 달아남" : "과열 아님 (" + pct + " vs 기준 +" + T + "%)",
          tone: hot ? "bad" : "good",
          reasons: [{
            name: "과열",
            val: S + " " + pct + " vs " + p.window + "일 (기준 +" + T + "%)",
            tag: hot ? "밖 · " + K : "안 · " + A,
            lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy"
          }]
        }
      }
    };
  }
}`;

// #40 중앙값 과열 + SQQQ 대기 — 하루 한 번만 거래(갈아탈 때 두 날로 나눔), 다리마다 수수료
SL_CODE[40] = `{
  name: "중앙값 과열 (250일) — SQQQ 대기",
  params: [
    ${SLK_ASSET6},
    { id: "park", label: "빠졌을 때 보유", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    ${SLK_STAT_MED},
    { id: "window", label: "기간 (일)", default: 250, options: [
      20, 30, 40, 50, 60, 75, 90, 100, 110, 120, 130, 140, 150, 160, 175, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340, 360, 400, 450, 500] },
    { id: "overPct", label: "중심선보다 이만큼 위면 나감 (%)", default: 55, options: [
      10, 15, 20, 25, 30, 35, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5, 70, 75, 80, 85, 90, 95, 100, 110, 125, 150, 175, 200] },
    { id: "splitDays", label: "하루에 한 번만 거래", type: "bool", default: true, options: [
      { value: true, label: "예" }, { value: false, label: "아니요" } ] },
    ${SLK_RATE15},
    ${SLK_COST13}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가 — 신호도 지수가 아니라 이 종목에서 읽습니다." },
    { key: "medianPrice", label: "중심선", tip: "이 종목 최근 N개 종가의 중심선 — 기본은 중앙값(창의 절반은 위, 절반은 아래; 튀는 값에 덜 흔들림), 중심선 설정을 바꾸면 이동평균." },
    { key: "abovePct", label: "중심선 대비", tip: "오늘 종가가 중심선보다 몇 % 위(+)·아래(−)인지. 전략이 보는 숫자는 이것 하나뿐입니다." },
    { key: "triggerPrice", label: "기준 가격", tip: "중심선보다 정확히 기준 % 위인 가격. 이 위로 마감하면 대기 종목으로, 아래로 돌아오면 다시 삽니다 — 나가고 들어오는 선이 같습니다." },
    { key: "parkPrice", label: "대기 가격", tip: "빠져 있을 때 들고 있는 종목의 종가. 대기가 현금이면 0." },
    { key: "leg", label: "단계", tip: "종목에서 종목으로 갈아탈 때 이 줄이 몇 번째 다리인지. 현금에서 사거나 현금으로 파는 한 번짜리 거래와 거래 없는 줄은 비어 있습니다." },
    { key: "traded", label: "거래액", tip: "이 줄에서 오간 돈 — 수수료는 이 금액에 붙습니다. 나눠 갈아타면 파는 줄과 사는 줄에 따로 나옵니다." },
    { key: "fee", label: "수수료", tip: "이 줄에서 낸 비용(거래액 × 비용 %). 종목 간 갈아타기는 두 다리라 두 번 냅니다 — 하루 한 번 거래가 켜져 있으면 하루 차이로 두 줄에." },
    { key: "feesPaid", label: "누적 수수료", tip: "처음부터 낸 거래 비용의 합계. 평가액과 견주면 갈아타기에 실제로 얼마를 썼는지 보입니다." },
    { key: "holdingsValue", label: "보유액", tip: "들고 있는 종목의 금액. 현금을 더하면 전체." }
  ],
  run(data, p) {
    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250), over = (p.overPct || 0) / 100;
    const useMed = p.stat !== "sma", CN = useMed ? "중앙값" : "평균";
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    // 이동 창: 정렬 배열 + 합계 — 하루에 하나 넣고 하나 뺌
    const win = [];
    let total = 0;
    const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const put = (v) => { win.splice(pos(v), 0, v); total += v; };
    const take = (v) => { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); total -= v; } };
    const from = Math.max(0, p.startIdx - W + 1);
    for (let k = from; k < p.startIdx; k++) if (px[k] > 0) put(px[k]);
    let cash = p.initial, shares = 0, held = "cash", invested = p.initial, legWait = false, feesPaid = 0;
    let mid = 0, above = 0, trigger = 0, hot = false, want = "cash";
    let prevAbove = 0, prevRoom = 0;   // 어제 값 — 신호 카드의 '오늘 변화'
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) { prevAbove = above; prevRoom = trigger > 0 && px[i - 1] > 0 ? trigger / px[i - 1] - 1 : 0; }
      if (px[i] > 0) put(px[i]);
      if (i - W >= from && px[i - W] > 0) take(px[i - W]);   // 창에서 빠지는 날 (데울 때 넣은 것만)
      const n = win.length;
      mid = n === 0 ? 0 : (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : total / n);
      above = mid > 0 && px[i] > 0 ? px[i] / mid - 1 : 0;
      trigger = mid * (1 + over);
      hot = mid > 0 && px[i] > 0 && px[i] > trigger;
      let contributed = 0, action = "hold", note = "", fee = 0, traded = 0, leg = "";
      cash *= 1 + dayRate;
${slkMoneyHeld(true)}
      want = held;
      if (mid > 0 && px[i] > 0) want = hot ? p.park : p.asset;
      const pctTxt = CN + " 대비 " + (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "%";
      let did = false;
      if (want !== held) {
        const twoLeg = held !== "cash" && want !== "cash";
        const secondLeg = legWait && held === "cash";
        const oldPx = priceOf(held, i);
        if (p.splitDays && twoLeg) {
          // 하루 한 번: 오늘은 현금으로 팔기만 — 사는 것은 다음 거래일에 신호를 다시 보고
          if (oldPx > 0) {
            const g = shares * oldPx, f = g * cost;
            cash += g - f; fee += f; traded += g; shares = 0;
            action = "sell"; leg = "1/2";
            note = pctTxt + " — 2단계 중 1단계, 다음 거래일에 " + want.toUpperCase() + " 매수";
            held = "cash"; legWait = true; did = true;
          }
        } else {
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {   // 살 종목 가격이 있을 때만 바꿈 (자료 빈 날에 빈손으로 들고 있지 않게)
            if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; traded += g; shares = 0; }
            if (want !== "cash") { const f = cash * cost; traded += cash; shares = (cash - f) / newPx; fee += f; cash = 0; }
            action = held === "cash" ? "buy" : (want === "cash" ? "sell" : "switch");
            leg = secondLeg ? "2/2" : (twoLeg ? "1+2 같은 날" : "");
            note = pctTxt + (secondLeg ? " — 2단계 중 2단계" : " (기준 +" + (over * 100).toFixed(1) + "%)");
            held = want; legWait = false; did = true;
          }
        }
      } else if (legWait) legWait = false;
      // 새 돈은 오늘 거래가 없었을 때만 들고 있는 종목에 넣음
      if (!did && held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;
        traded += cash; shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
        if (action === "contribution") note = "적립금 투자";
      }
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      feesPaid += fee;
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, leg: leg,
          traded: traded, fee: fee, feesPaid: feesPaid,
          assetPrice: px[i] || 0, medianPrice: mid, abovePct: above * 100,
          triggerPrice: trigger, parkPrice: priceOf(p.park, i) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const last = px[p.endIdx] || 0;
    const sign = (v) => (v >= 0 ? "+" : "−");
    const pct = sign(above) + Math.abs(above * 100).toFixed(2) + "%";
    const room = trigger > 0 && last > 0 ? trigger / last - 1 : 0;
    const roomTxt = sign(room) + Math.abs(room * 100).toFixed(2) + "%";
    const pending = want !== held;
    // 어제에서 오늘로의 변화 — 여유가 줄었다(음수)는 건 들고 있는 종목이 올랐다는 뜻이라 좋은 쪽
    const dAbove = (above - prevAbove) * 100, dRoom = (room - prevRoom) * 100;
    const heldPrev = priceOf(held, p.endIdx - 1);
    const heldGain = heldPrev > 0 ? (priceOf(held, p.endIdx) / heldPrev - 1) * 100 : null;
    return {
      log: log,
      lines: [
        { key: "assetPrice", label: A + " 가격" },
        { key: "medianPrice", label: W + "일 " + CN },
        { key: "triggerPrice", label: "과열선 (+" + (p.overPct || 0) + "%)" }
      ],
      signals: {
        cards: [
          { label: A + " vs " + W + "일 " + CN,
            value: (hot ? "▲ " : "▼ ") + pct,
            tone: hot ? "bad" : "good",
            icon: hot ? "trendUp" : "trendDown",
            sub: last.toFixed(2) + " vs " + CN + " " + mid.toFixed(2),
            delta: { text: sign(dAbove) + Math.abs(dAbove).toFixed(2) + "%", tone: dAbove >= 0 ? "good" : "bad" },
            tip: "마지막 종가와 최근 " + W + "개 종가의 중심선(중심선 설정에 따라 중앙값 또는 이동평균)의 차이입니다. 너무 위로 달아나면 대기 종목으로 비키고, 그 밖에는 " + A + " 를 들고 있습니다. 괄호 안 숫자는 어제 종가 대비 오늘 바뀐 폭입니다." },
          { label: hot ? "기준 아래까지" : "여유",
            value: roomTxt,
            tone: hot ? "bad" : "good",
            icon: "activity",
            sub: hot ? trigger.toFixed(2) + " 아래로 내려와야 함" : last.toFixed(2) + " → " + trigger.toFixed(2),
            delta: { text: sign(dRoom) + Math.abs(dRoom).toFixed(2) + "%", tone: dRoom <= 0 ? "good" : "bad" },
            tip: "나가기 전까지 더 오를 수 있는 폭, 또는 다시 들어가려면 내려와야 하는 폭입니다. 괄호 안은 오늘의 변화 — 들고 있는 동안 여유가 줄었다면 대개 종목이 오른 것이라, 숫자는 줄었어도 좋은 쪽(초록)으로 표시합니다." },
          { label: "지금 보유",
            value: name(held) + (pending ? " → " + name(want) : ""),
            tone: held === p.asset ? "good" : "bad",
            icon: held === p.asset ? "trendUp" : "flag",
            sub: held === "cash" ? "연 " + (p.cashRate || 0) + "% 이자" : priceOf(held, p.endIdx).toFixed(2) + " 에 보유",
            delta: heldGain != null ? { text: sign(heldGain) + Math.abs(heldGain).toFixed(2) + "%", tone: heldGain >= 0 ? "good" : "bad" } : null,
            tip: "마지막 날 들고 있는 것과, 다음 거래일로 미뤄 둔 다리. 손절·추세 필터·폭락 규칙이 없고 과열에만 반응하므로 하락은 바닥까지 함께 갑니다." + (p.park === "sqqq" ? " SQQQ 는 −3배 인버스라 오르거나 옆으로 가는 장에서는 계속 녹습니다." : "") }
        ],
        decision: {
          action: pending ? (want === "cash" ? "현금으로" : name(want) + " 매수") : (hot ? (p.park === "cash" ? "현금 유지" : K + " 보유") : A + " 매수"),
          note: pending ? "2단계 — 지난 거래일에 현금으로 팔았고, 다음에 " + name(want) + " 매수" : (hot ? "가격이 " + W + "일 " + CN + "보다 " + pct + " 위" : "가격이 " + CN + " 대비 " + pct),
          tone: hot ? "bad" : "good",
          reasons: [
            { name: "과열", val: A + " " + pct + " vs " + W + "일 " + CN, tag: hot ? "밖 · " + K : "안 · " + A, lean: hot ? (p.park === "cash" ? "cash" : "out") : "buy" },
            { name: "기준선", val: "+" + (over * 100).toFixed(1) + "% = " + trigger.toFixed(2), tag: hot ? "넘어섬" : roomTxt + " 남음", lean: hot ? "out" : "hold" }
          ]
        }
      }
    };
  }
}`;

// #41·#44 공용 — 손잡이 목록 (값·기본값은 원본과 같음)
const SLK_W41 = '5, 7, 10, 14, 20, 30, 40, 50, 60, 75, 90, 100, 110, 120, 130, 140, 150, 160, 175, 190, 200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 320, 340, 360, 400, 450, 500';
const slkParams41 = (veto) => `    { section: "매매 종목·신호" },
    ${SLK_ASSET6},
    { id: "stat", label: "중심선", default: "median", options: [
      { value: "median", label: "중앙값" }, { value: "sma", label: "이동평균" }, { value: "rsi", label: "RSI (50 중심선 대비)" } ] },
    { id: "window", label: "기간 (일)", default: 250, options: [
      ${SLK_W41}] },
    { section: "과열 — 급등을 팔기" },
    { id: "overPct", label: "중심선 위 (%)", default: 55, options: [
      2, 4, 5, 6, 8, 10, 12, 15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5, 70, 72.5, 75, 80, 85, 90, 95, 100, 110, 120, 125, 130, 140, 150, 160, 175, 200, 225, 250, 300] },
    { id: "park", label: "그때 보유", default: "sqqq", options: [
      { value: "sqqq", label: "SQQQ" }, { value: "cash", label: "현금" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" } ] },
    { section: "폭락 신호 — 탈출이 재는 기준" },
    { id: "crashStat", label: "중심선", default: "same", options: [
      { value: "same", label: "주 신호와 같게" }, { value: "median", label: "중앙값" },
      { value: "sma", label: "이동평균" }, { value: "rsi", label: "RSI (50 중심선 대비)" } ] },
    { id: "crashWindow", label: "기간 (일)", default: 0, options: [
      { value: 0, label: "주 신호와 같게" },
      ${SLK_W41}] },
    { section: "폭락 탈출 — 무너지면 나가기" },
    { id: "exitPct", label: "중심선 대비 (%)", default: -28, options: [
      10, 8, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15, -16, -17, -18, -19, -20, -22, -24, -25, -26, -28, -30, -32, -34, -35, -36, -38, -40, -42, -44, -45, -46, -48, -50, -52, -55, -58, -60, -65, -70, -75, -80] },
    { id: "crashAsset", label: "그때 보유", default: "cash", options: [
      { value: "cash", label: "현금" }, { value: "sqqq", label: "SQQQ" }, { value: "qqq", label: "QQQ" },
      { value: "spy", label: "SPY" }, { value: "sso", label: "SSO" }, { value: "qld", label: "QLD" },
      { value: "tqqq", label: "TQQQ" }, { value: "spxl", label: "SPXL" } ] },
    { id: "slopeGate", label: "중심선 기울기가 이보다 낮을 때만 (연 %)", default: 20, options: [
      { value: 999, label: "끔" }, { value: -40, label: "-40" }, { value: -20, label: "-20" },
      { value: -10, label: "-10" }, { value: 0, label: "0" }, { value: 10, label: "10" },
      { value: 20, label: "20" }, { value: 30, label: "30" }, { value: 40, label: "40" },
      { value: 60, label: "60" }, { value: 80, label: "80" }, { value: 120, label: "120" } ] },
    { id: "belowGate", label: "중심선 아래 머문 날수가 이 이상일 때만", default: 10, options: [
      { value: 0, label: "끔" }, 1, 2, 3, 5, 8, 10, 15, 20, 30] },${veto ? `
    { section: "신용 거부 — NFCI (시카고 연준)" },
    { id: "nfciTh", label: "NFCI 가 이보다 높으면 현금으로", default: 0.4, options: [
      { value: 999, label: "끔" }, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.5, 2 ] },
    { id: "vetoEnd", label: "거부가 풀리는 때", default: "cycle", options: [
      { value: "cycle", label: "NFCI 가 진정되거나 폭락 탈출→회복이 한 바퀴 끝나면" },
      { value: "nfci", label: "NFCI 가 진정될 때만" } ] },` : ''}
    { section: "실행·비용" },
    { id: "splitDays", label: "하루에 한 번만 거래", type: "bool", default: true, options: [
      { value: true, label: "예" }, { value: false, label: "아니요" } ] },
    { id: "cashRate", label: "현금 이자 (연 %)", default: 4, options: [
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10, 11, 12] },
    { id: "tradeCost", label: "거래 비용 (%)", default: 0.02, options: [
      0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1] }`;

// 두 신호(과열 판단·폭락 판단)의 이동 창·RSI·기울기 이력 준비 — #41·#44 의 run 앞부분
const SLK_SETUP41 = `    const log = [];
    const px = data[p.asset] || data.tqqq;
    const W = Math.max(2, p.window || 250);
    const over = (p.overPct || 0) / 100, exitB = (p.exitPct || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;   // 현금 하루 이자
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : (data[id][i] || 0);
    const crashAsset = p.crashAsset || "cash";
    // 신호는 두 개: 주 신호(과열)와 폭락 신호(탈출). 각각 '가격 vs 이동 중심선' 또는 'RSI vs 50'.
    // RSI 면 +55% = RSI 77.5, −30% = RSI 35 처럼 같은 % 기준이 그대로 통함. 폭락 쪽 기본은 주 신호와 같게
    const useMed = p.stat !== "sma", mainRsi = p.stat === "rsi";
    const crashSame = p.crashStat === "same" || p.crashStat == null;
    const crashRsi = crashSame ? mainRsi : p.crashStat === "rsi";
    const W2raw = +p.crashWindow || 0, W2 = W2raw > 0 ? Math.max(2, W2raw) : W;
    const useMedC = crashSame ? useMed : p.crashStat !== "sma";
    const sameLine = W2 === W && crashRsi === mainRsi && (crashRsi || useMedC === useMed);
    // 이동 창: 정렬 배열 + 합계 — 하루에 하나 넣고 하나 뺌
    const makeRoll = (Wn) => {
      const win = [];
      let sum = 0;
      const pos = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
      return {
        from: Math.max(0, p.startIdx - Wn + 1),
        add(v) { win.splice(pos(v), 0, v); sum += v; },
        drop(v) { const k = pos(v); if (k < win.length && win[k] === v) { win.splice(k, 1); sum -= v; } },
        mid(m) { const n = win.length; return n === 0 ? 0 : (m ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : sum / n); }
      };
    };
    // 와일더 RSI — 시작 전 최대 기간 4배만큼 미리 데움 (처음 Wn 개는 단순 평균)
    const makeRsi = (Wn) => {
      let up = 0, dn = 0, cnt = 0;
      const step = (i) => {
        if (!(px[i] > 0 && px[i - 1] > 0)) return;
        const d = px[i] - px[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
        if (cnt < Wn) { up += g; dn += l; cnt++; if (cnt === Wn) { up /= Wn; dn /= Wn; } }
        else { up = (up * (Wn - 1) + g) / Wn; dn = (dn * (Wn - 1) + l) / Wn; }
      };
      for (let k = Math.max(1, p.startIdx - 4 * Wn); k < p.startIdx; k++) step(k);
      return { step: step, val: () => (cnt < Wn ? 0 : (dn === 0 ? 100 : 100 - 100 / (1 + up / dn))) };
    };
    const rollM = mainRsi ? null : makeRoll(W);
    const rollC = crashRsi ? null : (sameLine ? rollM : makeRoll(W2));
    const rsiM = mainRsi ? makeRsi(W) : null;
    const rsiC = crashRsi ? (mainRsi && W2 === W ? rsiM : makeRsi(W2)) : null;
    if (rollM) for (let k = rollM.from; k < p.startIdx; k++) if (px[k] > 0) rollM.add(px[k]);
    if (rollC && rollC !== rollM) for (let k = rollC.from; k < p.startIdx; k++) if (px[k] > 0) rollC.add(px[k]);
    // 기울기 확인: 폭락 중심선의 63거래일 전 값이 시작 전부터 필요 → 시작 전 63일을 따로 한 번 돌려 둠
    // (RSI 폭락 신호면 중심이 늘 50 이라 기울기 0 — 음수 기준을 쓰려면 기울기 조건을 끄세요)
    const slopeGate = p.slopeGate == null ? 999 : +p.slopeGate;
    const belowGate = +p.belowGate || 0;
    const preC = new Array(63).fill(0);
    if (!crashRsi && slopeGate !== 999) {
      const pre = makeRoll(W2);
      const pf = Math.max(0, p.startIdx - 63 - W2 + 1);
      for (let k = pf; k < p.startIdx - 63; k++) if (px[k] > 0) pre.add(px[k]);
      for (let j = 0; j < 63; j++) {
        const k = p.startIdx - 63 + j;
        if (k >= 0 && px[k] > 0) pre.add(px[k]);
        const out = k - W2;
        if (out >= pf && px[out] > 0) pre.drop(px[out]);
        preC[j] = k >= 0 ? pre.mid(useMedC) : 0;
      }
    }
    const ring = new Array(64).fill(0);   // 폭락 중심선 최근 64일
    const ZK = { normal: "보통", over: "과열", crash: "폭락" };
    let cash = p.initial, shares = 0, held = "cash", state = "normal", invested = p.initial;
    let med = 0, medC = 0, above = 0, aboveC = 0, zone = "normal", sigM = 0, sigC = 0, below = 0, slope = 0;
    // 판단 참고용 통계(거래에는 안 씀): 폭락 신호의 범위·탈출 기간, 매매 종목의 고점 대비 낙폭
    let lo = Infinity, hi = -Infinity, stints = [], inCrash = false, stint = 0;
    let peak = 0, peakDate = "", ddNow = 0, ddMax = 0;`;
// 매일 앞부분: 창·RSI 갱신 → 두 신호 → 기울기·아래 머문 날 → 통계
const SLK_DAY41 = `      if (px[i] > 0) { if (rollM) rollM.add(px[i]); if (rollC && rollC !== rollM) rollC.add(px[i]); }
      if (rollM) { const out = i - W; if (out >= rollM.from && px[out] > 0) rollM.drop(px[out]); }
      if (rollC && rollC !== rollM) { const out = i - W2; if (out >= rollC.from && px[out] > 0) rollC.drop(px[out]); }
      if (rsiM && i > 0) rsiM.step(i);
      if (rsiC && rsiC !== rsiM && i > 0) rsiC.step(i);
      med = mainRsi ? 50 : rollM.mid(useMed);
      sigM = mainRsi ? rsiM.val() : px[i];
      medC = sameLine ? med : (crashRsi ? 50 : rollC.mid(useMedC));
      sigC = sameLine ? sigM : (crashRsi ? rsiC.val() : px[i]);
      above = med > 0 && sigM > 0 ? sigM / med - 1 : 0;
      aboveC = medC > 0 && sigC > 0 ? sigC / medC - 1 : 0;
      // 확인 조건: 폭락 중심선의 63일 기울기(연율)와, 폭락 신호가 중심선 아래에 머문 연속 날수
      const dayN = i - p.startIdx;
      const prevC = crashRsi ? 50 : (dayN >= 63 ? ring[(dayN - 63) % 64] : preC[dayN] || 0);
      slope = prevC > 0 && medC > 0 ? (Math.pow(medC / prevC, 4) - 1) * 100 : 0;
      ring[dayN % 64] = medC;
      below = (medC > 0 && sigC > 0 && sigC < medC) ? below + 1 : 0;
      if (medC > 0 && sigC > 0) { if (aboveC < lo) lo = aboveC; if (aboveC > hi) hi = aboveC; }
      if (px[i] > 0) {
        if (px[i] > peak) { peak = px[i]; peakDate = data.dates[i]; }
        ddNow = peak > 0 ? px[i] / peak - 1 : 0;
        if (-ddNow > ddMax) ddMax = -ddNow;
      }`;
// 구간 판단: 보통 → (과열 | 폭락) , 폭락 → 탈출선 위로 돌아오면 보통
const SLK_STATE41 = `        const pOver = med * (1 + over), pExit = medC * (1 + exitB);
        if (state === "normal" || state === "over") {
          if (sigM > pOver) state = "over";
          else if (sigC < pExit
            && (slopeGate === 999 || slope < slopeGate)
            && (belowGate === 0 || below >= belowGate)) state = "crash";
          else state = "normal";
        } else if (sigC > pExit) state = "normal";
        zone = state;`;
const slkTrade41 = (noteExpr) => `        if (p.splitDays && want !== held && held !== "cash" && want !== "cash") want = "cash";   // 하루 한 번: 오늘은 팔기만, 사는 건 다음 거래일에 다시 보고
        if (want !== held) {
          const oldPx = priceOf(held, i);
          if (held !== "cash" && oldPx > 0) { const g = shares * oldPx, f = g * cost; cash += g - f; fee += f; shares = 0; }
          const newPx = priceOf(want, i);
          if (want === "cash" || newPx > 0) {
            if (want !== "cash") { const f = cash * cost; shares = (cash - f) / newPx; fee += f; cash = 0; }
            action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
            note = ${noteExpr};
            held = want;
          }
        } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
          const f = cash * cost;
          shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
          if (action === "contribution") note = "적립금 투자";
        }`;
const SLK_STINT41 = `      const wasCrash = inCrash;
      inCrash = state === "crash";
      if (inCrash) stint++;
      if (wasCrash && !inCrash) { stints.push(stint); stint = 0; }
      // 그림용 중심선: RSI 신호면 가격 기준으로 바꾼 중심(가격 × 50 / RSI) — 가격이 이 선을 넘는 것이 곧 RSI 기준
      const medPlot = mainRsi ? (sigM > 0 ? px[i] * 50 / sigM : 0) : med;`;
const SLK_NOTE41 = '"중심선 대비 " + (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% — " + ZK[zone]';

// #41 중앙값 과열 + SQQQ + 확인된 깊은 폭락 탈출
SL_CODE[41] = `{
  name: "중앙값 과열 + SQQQ + 폭락 탈출",
  params: [
${slkParams41(false)}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가." },
    { key: "medianPrice", label: "중심선", tip: "주 신호의 중심선을 가격으로 — 최근 N개 종가의 중앙값·이동평균, 신호가 RSI 면 RSI 로 바꾼 중심(가격 × 50 / RSI). 가격이 이 선에서 그린 띠를 넘는 것이 곧 기준입니다." },
    { key: "crashCenter", label: "폭락 중심", tip: "폭락 쪽 띠(탈출)가 재는 중심선. 폭락 신호에 따로 기간·통계를 주지 않으면 주 중심선과 같습니다." },
    { key: "abovePct", label: "중심선 대비", tip: "주 신호(가격 또는 RSI)가 중심보다 몇 % 위(+)·아래(−)인지. 과열 띠는 이 숫자로 정합니다." },
    { key: "crashAbovePct", label: "폭락 신호 대비", tip: "같은 늘어남을 폭락 신호로 잰 값 — 탈출 띠는 이 숫자로 정합니다." },
    { key: "zone", label: "구간", tip: "종가가 들어간 구간: 과열(대기 종목), 보통(보유), 폭락(밖)." },
    { key: "fee", label: "수수료", tip: "이 줄의 거래에서 낸 비용." }
  ],
  run(data, p) {
${SLK_SETUP41}
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_DAY41}
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
${SLK_STATE41}
        let want = state === "normal" ? p.asset : state === "over" ? p.park : crashAsset;
${slkTrade41(SLK_NOTE41)}
      }
${SLK_STINT41}
      const medCPlot = sameLine ? medPlot : (crashRsi ? (sigC > 0 ? px[i] * 50 / sigC : 0) : medC);
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100, zone: ZK[zone],
          crashCenter: medCPlot, crashAbovePct: aboveC * 100,
          mainSignal: sigM, crashSignal: sigC,
          overLine: medPlot * (1 + over), exitLine: medCPlot * (1 + exitB) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const zoneHold = zone === "normal" ? A : zone === "over" ? K : name(crashAsset);
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "중앙값" : "평균");
    const CNc = crashRsi ? "RSI(" + W2 + ")" : (useMedC ? "중앙값" : "평균");
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const tone = zone === "normal" ? "good" : "bad";
    const holdTxt = name(held), Z = ZK[zone], exitP = p.exitPct || 0;
    // 신호 차트 선 (반등·포기선은 일부러 안 그림 — 탈출선이 아래쪽 기준)
    const lines = [
      { key: "assetPrice", label: A + " 가격" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") 선" } : { key: "medianPrice", label: W + "일 " + CN }
    ];
    if (!sameLine) lines.push(crashRsi ? { key: "crashCenter", label: "RSI(" + W2 + ") 폭락선" } : { key: "crashCenter", label: W2 + "일 " + CNc + " 폭락 기준" });
    lines.push(
      { key: "exitLine", label: "폭락 탈출 (" + exitP + "%" + (sameLine ? "" : " @ " + CNc) + ")" },
      { key: "overLine", label: "과열선 (+" + (p.overPct || 0) + "%)" }
    );
    if (inCrash && stint > 0) stints.push(stint);   // 마지막 날에도 밖에 있으면
    const sorted = stints.slice().sort((a, b) => a - b);
    const midStint = sorted.length ? sorted[(sorted.length - 1) >> 1] : 0;
    const reach = lo < Infinity && lo * 100 <= exitP;
    const room = aboveC * 100 - exitP;
    return {
      log: log,
      lines: lines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: tone,
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + med.toFixed(2),
            tip: "과열 규칙이 보는 늘어남: " + (mainRsi ? "RSI 와 50 중심선" : "종가와 " + W + "일 " + CN) + ". +" + (p.overPct || 0) + "% 를 넘으면 " + K + "(으)로 비키고, 폭락 탈출은 " + (sameLine ? "같은 신호" : "따로 둔 신호(" + CNc + ")") + "가 " + exitP + "% 아래로 내려가면 " + name(crashAsset) + "(으)로 나갑니다." },
          { label: "지금 구간",
            value: Z,
            tone: tone,
            icon: "sliders",
            sub: holdTxt + " 보유 중",
            tip: "마지막 종가가 들어간 구간과 거기서 들고 있는 것: 과열(대기 종목), 보통(매매 종목), 폭락(신호가 탈출선 위로 돌아올 때까지 밖)." },
          { label: "폭락 탈출",
            value: exitP + "%",
            icon: "shield",
            sub: "그다음 " + name(crashAsset) + " 보유"
              + (slopeGate !== 999 ? " · 기울기<" + slopeGate + " 필요" : "")
              + (belowGate > 0 ? " · " + belowGate + "일 아래" : "")
              + (sameLine ? "" : " — " + CNc + " 기준"),
            tip: "확인된 붕괴 탈출: 신호가 중심보다 이만큼 아래로 떨어지고 확인 조건(중심선 기울기 둔화, 선 아래 머문 날수)까지 통과해야 " + A + " 를 팔아 " + name(crashAsset) + "(으)로 옮기고, 신호가 탈출선 위로 돌아오는 즉시 되삽니다. 9개 계열을 비교한 검증에서 얕고 빠른 탈출보다 깊고 확인된 탈출이 뽑혔습니다 — 확인 조건이 단순 −8% 탈출을 손해로 만들던 헛신호를 걸러 냅니다." },
          { label: "폭락 신호 범위",
            value: (lo < Infinity ? (lo >= 0 ? "+" : "") + (lo * 100).toFixed(1) + "% … +" + (hi * 100).toFixed(1) + "%" : "—"),
            tone: reach ? "good" : "bad",
            icon: "activity",
            sub: reach ? "탈출 " + stints.length + "번, 중앙값 " + midStint + "일 밖" : exitP + "% 탈출선에 한 번도 닿지 않음",
            tip: "이번 실행 동안 폭락 신호의 늘어남이 오간 전체 범위입니다. 탈출 기준이 이 범위의 바닥보다 낮으면 절대 작동하지 않아 폭락 탈출이 사실상 꺼진 셈입니다 — 느린 RSI 창은 범위를 크게 좁히므로(RSI(250) 은 ±10% 를 거의 못 벗어남) 깊은 기준에는 빠른 창이 필요합니다." },
          { label: "탈출까지 여유",
            value: (room >= 0 ? "+" : "") + room.toFixed(1) + "%p",
            tone: room >= 0 ? "good" : "bad",
            icon: "shield",
            sub: "신호 " + (aboveC >= 0 ? "+" : "") + (aboveC * 100).toFixed(1) + "% vs " + exitP + "% 선",
            tip: "폭락 신호가 탈출 전까지 더 떨어질 수 있는 폭(양수) 또는 이미 선을 지나친 폭(음수). '곧 팔리게 되나'를 가장 바로 보여 줍니다." },
          { label: A + " 낙폭",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "고점 " + peak.toFixed(2) + " (" + peakDate + ") 대비 · 최악 " + (-ddMax * 100).toFixed(0) + "%",
            tip: "매매 종목이 지금까지의 고점에서 얼마나 내려왔는지입니다. 전략은 이 숫자를 직접 보지 않고 신호의 늘어남으로 움직이지만, 둘을 견주면 아픈 하락에서 탈출 규칙이 실제로 작동하는지 보입니다: 낙폭은 깊은데 탈출이 한 번도 없었다면 폭락 신호가 너무 느리거나 깊게 맞춰진 것입니다." }
        ],
        decision: {
          action: zoneHold === "현금" ? "현금 유지" : zone === "normal" ? zoneHold + " 매수" : zoneHold + " 보유",
          note: "신호가 " + CN + " 대비 " + pct + " — " + Z + " 구간",
          tone: tone,
          reasons: [
            { name: "구간", val: A + " " + pct + " vs " + CN, tag: Z + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : zoneHold === "현금" ? "cash" : "out" }
          ]
        }
      }
    };
  }
}`;

// #44 = #41 + NFCI 신용 거부 (한쪽 방향: 현금으로 보내기만)
SL_CODE[44] = `{
  name: "NFCI 거부 + 중앙값 과열 SQQQ + 중앙값 폭락 탈출",
  params: [
${slkParams41(true)}
  ],
  columns: [
    { key: "assetPrice", label: "종목", tip: "매매 종목의 종가." },
    { key: "medianPrice", label: "중심선", tip: "주 신호의 중심선을 가격으로 — 최근 N개 종가의 중앙값·이동평균, 신호가 RSI 면 RSI 로 바꾼 중심(가격 × 50 / RSI)." },
    { key: "abovePct", label: "중심선 대비", tip: "주 신호가 중심보다 몇 % 위(+)·아래(−)인지." },
    { key: "nfci", label: "NFCI", tip: "시카고 연준 전국 금융 여건 지수(주간, 발표 지연 7일). 0 위 = 평균보다 빡빡한 여건, 거부 기준 위 = 신용 경색 — 전부 현금." },
    { key: "zone", label: "구간", tip: "종가가 들어간 구간 — 또는 NFCI 우선 규칙이 전부 현금으로 묶어 두는 동안은 '신용 거부'." },
    { key: "fee", label: "수수료", tip: "이 줄의 거래에서 낸 비용." }
  ],
  run(data, p) {
${SLK_SETUP41}
    // 신용 거부: NFCI 가 기준 위로 올라서면 켜짐. 'cycle'(기본) = NFCI 가 진정되거나, 거부 중에 가격 규칙이
    // 폭락 탈출 → 회복을 한 바퀴 마치면 풀림 (가격이 다시 들어갈 자격을 얻었으니). 'nfci' = 기준 위인 동안 내내
    const nfciTh = p.nfciTh == null ? 0.4 : +p.nfciTh;
    const nfciArr = data.nfci || null;
    const vetoCycle = (p.vetoEnd || "cycle") !== "nfci";
    let armed = false, crashSeen = false, wasAbove = false;
    let nfNow = NaN, vetoOn = false, vetoDays = 0, vetoTimes = 0, prevVeto = false;
    for (let i = p.startIdx; i <= p.endIdx; i++) {
${SLK_DAY41}
      nfNow = nfciArr ? nfciArr[i] : NaN;
      let contributed = 0, action = "hold", note = "", fee = 0;
      if (held === "cash") cash *= 1 + dayRate;
${slkMoneyHeld(false)}
      if (med > 0 && medC > 0 && sigM > 0 && sigC > 0 && px[i] > 0) {
${SLK_STATE41}
        // 한쪽 방향 신용 거부: 현금으로 갈 이유만 됨
        const nfAbove = nfciTh !== 999 && isFinite(nfNow) && nfNow > nfciTh;
        if (!vetoCycle) vetoOn = nfAbove;
        else {
          if (nfAbove && !wasAbove) { armed = true; crashSeen = false; }
          if (!nfAbove) armed = false;
          if (armed) {
            if (state === "crash") crashSeen = true;
            else if (crashSeen) armed = false;   // 가격 규칙이 폭락 탈출 뒤 회복 → 풀어 줌
          }
          vetoOn = armed;
        }
        wasAbove = nfAbove;
        if (vetoOn) { vetoDays++; if (!prevVeto) vetoTimes++; }
        prevVeto = vetoOn;
        let want = state === "normal" ? p.asset : state === "over" ? p.park : crashAsset;
        if (vetoOn) want = "cash";
${slkTrade41('vetoOn ? "NFCI " + nfNow.toFixed(2) + " > " + nfciTh + " — 신용 거부" : ' + SLK_NOTE41)}
      }
${SLK_STINT41}
      const hp = priceOf(held, i), stockVal = shares * hp;
${SLK_TICK}
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed !== 0 || tick || action !== "hold")
        log.push({ date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: hp, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          assetPrice: px[i] || 0, medianPrice: medPlot, abovePct: above * 100,
          nfci: isFinite(nfNow) ? nfNow : null,
          zone: vetoOn ? "신용 거부" : ZK[zone],
          overLine: medPlot * (1 + over), exitLine: medPlot * (1 + exitB) });
    }
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "현금" : p.park.toUpperCase();
    const name = (id) => id === "cash" ? "현금" : id.toUpperCase();
    const CN = mainRsi ? "RSI(" + W + ")" : (useMed ? "중앙값" : "평균");
    const pct = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const tone = vetoOn ? "bad" : zone === "normal" ? "good" : "bad";
    const holdTxt = name(held), Z = ZK[zone], exitP = p.exitPct || 0;
    const lines = [
      { key: "assetPrice", label: A + " 가격" },
      mainRsi ? { key: "medianPrice", label: "RSI(" + W + ") 선" } : { key: "medianPrice", label: W + "일 " + CN },
      { key: "exitLine", label: "폭락 탈출 (" + exitP + "%)" },
      { key: "overLine", label: "과열선 (+" + (p.overPct || 0) + "%)" }
    ];
    if (inCrash && stint > 0) stints.push(stint);
    const nfTxt = isFinite(nfNow) ? (nfNow >= 0 ? "+" : "") + nfNow.toFixed(2) : "없음";
    const vetoGap = isFinite(nfNow) && nfciTh !== 999 ? (nfciTh - nfNow) : NaN;
    return {
      log: log,
      lines: lines,
      signals: {
        cards: [
          { label: mainRsi ? "RSI(" + W + ") vs 50" : A + " vs " + W + "일 " + CN,
            value: (above >= 0 ? "▲ " : "▼ ") + pct,
            tone: zone === "normal" ? "good" : "bad",
            icon: above >= 0 ? "trendUp" : "trendDown",
            sub: mainRsi ? sigM.toFixed(1) + " vs 50" : (px[p.endIdx] || 0).toFixed(2) + " vs " + CN + " " + med.toFixed(2),
            tip: "과열 규칙이 보는 늘어남입니다. +" + (p.overPct || 0) + "% 를 넘으면 " + K + "(으)로 비키고, " + exitP + "% 아래로 내려가면(확인 조건 포함) " + name(crashAsset) + "(으)로 팝니다." },
          { label: "지금 구간",
            value: vetoOn ? "신용 거부" : Z,
            tone: tone,
            icon: "sliders",
            sub: holdTxt + " 보유 중",
            tip: "마지막 종가가 들어간 구간 — 과열(대기), 보통(보유), 폭락(밖) — 또는 NFCI 우선 규칙이 구간과 상관없이 전부 현금으로 묶어 두는 동안의 '신용 거부'." },
          { label: "NFCI 신용 거부",
            value: nfTxt,
            tone: nfciTh === 999 ? "good" : (vetoOn ? "bad" : "good"),
            icon: "shield",
            sub: nfciTh === 999 ? "거부 끔"
              : vetoOn ? "+" + nfciTh + " 위 — 진정될 때까지 현금" + (vetoCycle ? " (또는 폭락 한 바퀴가 끝날 때까지)" : "")
              : "+" + nfciTh + " 에서 거부 (" + vetoGap.toFixed(2) + " 남음) · 이번 실행에서 " + vetoTimes + "번, " + vetoDays + "일",
            tip: "시카고 연준 전국 금융 여건 지수(NFCI) — 주간 값을 발표 지연 7일 뒤부터 씁니다. +" + (nfciTh === 999 ? "0.4" : nfciTh) + " 위 = 신용 경색: 전부 현금으로. 한쪽 방향이라 레버리지를 늘리는 일은 없습니다. 지수가 진정되면 풀리고" + (vetoCycle ? ", 거부 중에 가격 규칙이 스스로 폭락 탈출 뒤 회복까지 마치면 더 일찍 풀립니다 — 시장이 다시 들어갈 자격을 얻었으니 신용 스트레스만으로는 붙잡지 않음" : "") + ". 1971년 이후 진짜 신용 위기(1973-75, 볼커 긴축, 1987, S&L 1990, 금융위기)에만 작동했고 2009년 7월 이후로는 조용합니다." },
          { label: "폭락 탈출",
            value: exitP + "%",
            icon: "shield",
            sub: "그다음 " + name(crashAsset) + " 보유"
              + (slopeGate !== 999 ? " · 기울기<" + slopeGate + " 필요" : "")
              + (belowGate > 0 ? " · " + belowGate + "일 아래" : ""),
            tip: "확인된 붕괴 탈출: 신호가 중심보다 이만큼 아래로 떨어지고 확인 조건까지 통과해야 " + A + " 를 팔아 " + name(crashAsset) + "(으)로 옮기고, 신호가 탈출선 위로 돌아오면 되삽니다." },
          { label: A + " 낙폭",
            value: (ddNow * 100).toFixed(1) + "%",
            tone: ddNow > -0.15 ? "good" : "bad",
            icon: "trendDown",
            sub: "고점 " + peak.toFixed(2) + " (" + peakDate + ") 대비 · 최악 " + (-ddMax * 100).toFixed(0) + "%",
            tip: "매매 종목이 지금까지의 고점에서 얼마나 내려왔는지입니다. 가격 띠는 중심선 대비 늘어남으로, 거부는 신용 여건으로 움직입니다 — 이 숫자는 그 둘이 무엇을 막으려는지 보여 줍니다." }
        ],
        decision: {
          action: vetoOn ? "현금 유지 — 신용 거부"
            : (state === "normal" ? A + " 매수" : state === "over" ? K + " 보유" : name(crashAsset) === "현금" ? "현금 유지" : name(crashAsset) + " 보유"),
          note: vetoOn ? "NFCI " + nfTxt + " 가 +" + nfciTh + " 위 — 신용 여건이 진정되기를 기다리는 중"
            : "신호가 " + CN + " 대비 " + pct + " — " + Z + " 구간 · NFCI " + nfTxt,
          tone: tone,
          reasons: [
            { name: "구간", val: A + " " + pct + " vs " + CN, tag: Z + " · " + holdTxt,
              lean: zone === "normal" ? "buy" : holdTxt === "현금" ? "cash" : "out" },
            { name: "신용 (NFCI)", val: nfTxt + " vs +" + (nfciTh === 999 ? "끔" : nfciTh),
              tag: vetoOn ? "거부 — 현금" : "진정",
              lean: vetoOn ? "cash" : "buy" }
          ]
        }
      }
    };
  }
}`;

// ── 라이브러리 목록 ────────────────────────────────────────────────────
const SS_LIB_LINKS = {
  F: 'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  GB: 'https://cmtassociation.org/wp-content/uploads/2025/08/2016-gayed-bilello.pdf',
  ALV: 'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
  MACD: 'https://www.lambrospetrou.com/articles/investing-leveraged-qqq-macd/',
  SSO: 'https://www.brightworkresearch.com/using-letfs-combined-with-the-200-day-moving-average-trading-approach/',
  HW: 'https://bestfolio.app/strategies/tqqq-qqq-band',
  '3PH': 'https://www.tradingview.com/script/cbUgg7hl-SPY-200SMA-4-Entry-3-Exit-TQQQ-QLD-GLDM-THREE-PHASE-STRATEGY/',
  CMP: 'https://www.composer.trade/trading-strategies/tqqq-rsi-strategy-Lh0fYfA5RJQmpyfGEORb',
  BH: 'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  GS: 'https://graniteshares.com/research/the-200-moving-average-strategy-explained/',
  QS: 'https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/',
  QC: 'https://www.quantconnect.com/research/15351/leveraged-etfs-with-systematic-risk-management/',
  QP: 'https://quantpedia.com/leveraged-etfs-in-asset-allocation-opportunity-or-trap/',
  'BH·GS': 'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  'F·BH': 'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  'ALV·QC': 'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
};
const SS_LIB_TAGS = {
  app: '앱 기본', foundation: '기초', academic: '학술', portfolio: '포트폴리오', composite: '복합', momentum: '모멘텀', origin: '원조',
  community: '커뮤니티', oscillator: '오실레이터', crossover: '이동평균 교차', risk: '위험 관리', picked: '직접 고름', overfit: '과최적화',
};
const SL_SELF = '직접 고른 전략 — 숫자는 이 앱의 자체 백테스트이며 외부에서 주장한 값이 아님';
const SL_APP = '앱의 기본 전략 — 숫자는 이 앱이 표준 기본값으로 돌린 백테스트';
const sll = (...a) => a.join('\n');
// 과최적화 탐색기 1위 설정 (프리셋)
function slFit(n, eng, goal, span, cagr, dd, params) {
  const E = eng === '9sig' ? '9sig' : 'SMA', G = goal === 'ret' ? '최고 수익' : '최저 낙폭';
  // 원래 1953년부터 찾은 후보 — 이 사이트 자료는 1971년부터(그 전 나스닥 값은 검증할 수 없는 가상값이라 뺌)라 탐색기에서는 1971–2025 탭
  const now = /^1953/.test(span) ? '의 ‘' + G + ' ' + span.replace(/^1953/, '1971') + '’ 탭(이 사이트 자료는 1971년부터 — 그 전 나스닥 값은 검증할 수 없는 가상값이라 뺌)' : '';
  return {
    n, name: E + ' · ' + G + ' ' + span, tag: 'overfit',
    rules: sll(E + ' 과최적화 탐색기의 ‘' + G + ' ' + span + '’ 후보를 처음 찾을 때 1위였던 설정 — 그 구간에 맞춘 값(당시 표본 안 CAGR ' + cagr + '%, 낙폭 ' + dd + '%). 지금 계산으로 다시 돌린 값과 순위는 탐색기 표' + now + '에서 볼 수 있습니다.',
      '앱의 ' + E + ' 엔진 그대로 돌아가므로 써 보면 모든 손잡이를 바꿀 수 있습니다.',
      '그 구간을 뒤져 고른 값이라 다른 구간은 훨씬 나빠 보일 것으로 예상하세요 — 추천이 아니라 과최적화의 차이를 보여 주려고 둔 것입니다.'),
    reported: '처음 찾을 때 ' + span + ' 표본 안: CAGR ' + cagr + '% / 낙폭 −' + dd + '%',
    preset: { type: eng, params },
  };
}

const SS_LIBRARY = [
  // 앱의 두 기본 엔진 (프리셋 — 써 보면 손잡이를 모두 바꿀 수 있는 기본 9sig/SMA 저장 전략)
  { n: 42, name: '9sig', tag: 'app',
    rules: sll('제이슨 켈리의 9-Sig 를 TQQQ 에 맞춘 것.',
      '보유: TQQQ 60% + 현금 완충 40%(연 4% 이자).',
      '분기마다: TQQQ 평가액을 분기 9% 씩 커지는 목표선과 비교 — 목표보다 많으면 넘친 만큼 팔아 현금으로, 적으면 모자란 만큼 현금으로 삽니다(한 번에 현금의 90% 까지만).',
      '폭락 규칙: TQQQ 가 2년 고점보다 30% 넘게 떨어져 있으면 팔아야 할 때도 매도를 미룹니다(연속 두 번까지).',
      '급등 규칙: 한 분기에 +100% 오르면 주식 비중을 60% 로 되돌립니다.',
      '거래 비용 0.02%. 앱의 표준 기본값 — 9sig 엔진 그대로라 써 보면 모든 손잡이를 패널에서 바꿀 수 있습니다.'),
    reported: SL_APP,
    preset: { type: '9sig', params: { ul: 'tqqq', g: '9', cd: '30', cw: '24', sp: '100', per: 'quarterly', cash: '40', cr: '4', bp: '90', dep: '0', tc: 'holding', park: 'cash', rp: '0', st: '60', cost: '0.02' } } },
  { n: 43, name: 'SMA 200', tag: 'app',
    rules: sll('앱의 표준 추세 규칙.',
      '신호: QQQ 종가가 200일 이동평균 위면 TQQQ, 아래로 마감하면 현금(연 4% 이자) — 매일 확인, 완충 띠 없음.',
      '과열 매도: RSI(9) 가 90 이상이면 팝니다.',
      '식음 재진입: RSI(7) 이 80 아래일 때만 다시 삽니다.',
      '버블 보험: TQQQ 가 자기 200일 평균보다 40% 이상 위면 전부 현금.',
      '실행: T+1 결제, 다시 살 때 15거래일에 나눠 삼, 거래 비용 0.02%.',
      'SMA 엔진 그대로라 써 보면 모든 손잡이를 패널에서 바꿀 수 있습니다.'),
    reported: SL_APP,
    preset: { type: 'sma', params: { sig: 'qqq', win: '200', ul: 'tqqq', cr: '4', eb: '0', xb: '0', oh: '90', cool: '80', ohw: '9', coolw: '7', cb: '0', cs: '0', settle: '1', out: 'cash', din: '15', dout: '15', bg: '40', bga: 'tqqq', bgw: '200', cost: '0.02' } } },
  { n: 1, name: 'Faber 10개월·200일 타이밍 모델', tag: 'foundation', src: 'F',
    rules: sll('신호: S&P(또는 QQQ) 와 10개월 이동평균(약 200일).',
      '들어감: 월말 종가가 평균 위 → 보유.',
      '나감: 월말 종가가 평균 아래 → 단기 국채.',
      '주기: 매달(마지막 거래일).',
      '이 앱 구현: QQQ 와 200일 중심선 → TQQQ ↔ 현금(이자 없음). 판단은 달의 마지막 거래일에만 (기간 길이·차트 눈금과 상관없이 — 계산이 달 중간에 끝나면 그날은 판단 안 함).'),
    reported: '연 10.2% vs 매수 후 보유 9.3% (S&P, 1901–2012)', code: SL_CODE[1] },
  { n: 2, name: 'Gayed & Bilello LRS 3배 — 장기 레버리지', tag: 'academic', src: 'GB',
    rules: sll('신호: S&P 500 총수익 지수와 200일 이동평균.',
      '들어감: 평균 위 → S&P 3배.',
      '나감: 평균 아래 → 단기 국채.',
      '주기: 매일 · 1년에 약 5번 왕복.',
      '이 앱 구현: SPY 와 200일 중심선 → SPXL(S&P 3배) ↔ 현금(이자 없음), 매일.'),
    reported: 'CAGR 26.8% · 최대 낙폭 −92.2% · 샤프 0.47 (1928–2015)', code: SL_CODE[2] },
  { n: 3, name: 'Gayed & Bilello LRS 2배', tag: 'academic', src: 'GB',
    rules: sll('#2 와 같고 레버리지만 2배.',
      '신호: 레버리지 없는 S&P 총수익과 200일 이동평균.',
      '대기: 단기 국채. 주기: 매일.',
      '이 앱 구현: SPY 와 200일 중심선 → SSO(S&P 2배) ↔ 현금(이자 없음), 매일.'),
    reported: 'CAGR 19.1% · 최대 낙폭 −78.7% · 샤프 0.51 (1928–2015)', code: SL_CODE[3] },
  { n: 4, name: 'Gayed & Bilello LRS 1.25배', tag: 'academic', src: 'GB',
    rules: sll('#2 와 같고 1.25배 — 보수적인 쪽.',
      '신호: S&P 총수익과 200일 이동평균. 주기: 매일.',
      '아직 이 앱에서 백테스트하지 않았습니다.'),
    reported: '연 12.4% (1928–2015)' },
  { n: 5, name: 'HedgeFundie 엑설런트 어드벤처 (UPRO 55 / TMF 45)', tag: 'portfolio', needs: 'TMF', src: 'BH',
    rules: sll('고정 비중: UPRO(S&P 3배) 55% + TMF(장기 국채 3배) 45%, 분기마다 리밸런스.',
      '선택: UPRO 쪽에 200일 이동평균을 덧씌우기도 함.',
      '주기: 분기.'),
    reported: 'Bogleheads 의 유명한 포트폴리오 — 2022년에 두 다리가 함께 무너지는 위험이 드러남' },
  { n: 6, name: 'Alvarez UPRO/TQQQ 복합 전략', tag: 'composite', needs: 'VIX', src: 'ALV',
    rules: sll('주기: 매달.',
      '관문: VIX ≤ 25 · S&P 가 200일 이동평균 위 · VWO 모멘텀 > 0 · BND 모멘텀 > 0.',
      '모두 참 → UPRO 50% + TQQQ 50%.',
      '1~2개 거짓 → QQQ 50% + SPY 50%.',
      '3~4개 거짓 → TLT 100%.'),
    reported: '연 24.4% · 최대 낙폭 −54% (2010–2023)' },
  { n: 7, name: 'Antonacci 듀얼 모멘텀 → 레버리지 ETF (GEM)', tag: 'momentum', needs: 'VWO/BND', src: 'QP',
    rules: sll('절대 필터: 기초 지수의 12개월 수익률이 단기 국채보다 높을 때만.',
      '상대 선택: S&P 와 나스닥 중 모멘텀이 강한 쪽 → 그 지수의 3배 종목, 아니면 단기 국채.',
      '주기: 매달.'),
    reported: '널리 인용되는 모멘텀 틀 — 레버리지 ETF 는 초과 수익과 헛신호 손실을 함께 키움' },
  { n: 8, name: 'Siegel 200일 ±1% 띠', tag: 'origin', src: 'F',
    rules: sll('신호: 지수와 200일 이동평균, 위아래 대칭 ±1% 띠.',
      '들어감: 종가가 평균보다 +1% 이상 위.',
      '나감: 종가가 평균보다 −1% 이하 → 단기 국채.',
      '주기: 매일.',
      '이 앱 구현: SPY 와 200일 중심선 ± 띠 → TQQQ ↔ 현금(이자 없음), 매일. 띠 안에서는 그대로 둠.'),
    reported: '헛신호를 줄이는 완충 띠 아이디어의 원조 (다우지수 1886–2006)', code: SL_CODE[8] },
  { n: 9, name: 'TQQQ 표준 200일 이동평균 (r/LETF)', tag: 'community', src: 'BH·GS',
    rules: sll('신호: S&P 또는 QQQ 와 200일 이동평균.',
      '들어감: 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '주기: 매일 또는 매달.',
      '참고: S&P 신호라면 TQQQ 보다 UPRO 가 더 깔끔합니다.',
      '이 앱 구현: SPY(QQQ 로 바꿀 수 있음)와 200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일.'),
    reported: 'S&P 200일선 6.7% vs 보유 7.4% · 낙폭 29% vs 56% (1960–)', code: SL_CODE[9] },
  { n: 10, name: 'QQQ 200일 → TQQQ (같은 지수, 현금 대기)', tag: 'app', src: 'F·BH',
    rules: sll('신호: QQQ 와 자기 200일 이동평균 → TQQQ 매매.',
      '들어감: 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '신호와 매매가 같은 지수라 기초 지수가 어긋날 위험이 없습니다. 주기: 매일.',
      '이 앱 구현: QQQ 와 200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일. 신호·종목·기간을 바꿀 수 있음.'),
    reported: '이 앱의 표준 SMA 설정', code: SL_CODE[10] },
  { n: 11, name: 'SPY 200일 → UPRO (같은 지수 짝)', tag: 'community', src: 'BH',
    rules: sll('신호: SPY(S&P) 와 200일 이동평균 → UPRO(S&P 3배) 매매.',
      '들어감: 평균 위. 나감: 평균 아래 → 단기 국채.',
      '신호와 매매가 같은 지수입니다. 주기: 매일.',
      '이 앱 구현: UPRO 대신 같은 S&P 3배인 SPXL 자료로 — SPY 와 200일 중심선 → SPXL ↔ 현금(이자 없음), 매일.'),
    reported: '"TQQQ 보다 깔끔" — S&P↔나스닥 기초 지수 차이 위험이 없음', code: SL_CODE[11] },
  { n: 12, name: 'SSO/SHY 자기 가격 200일 회전 (2배)', tag: 'app', src: 'SSO',
    rules: sll('신호: SSO 자기 가격과 200일 이동평균.',
      '들어감: 평균 위 → SSO. 나감: 평균 아래 → SHY(1~3년 국채).',
      '다시 위로 넘으면 다시 삼. 주기: 매일.',
      '이 앱 구현: SSO 와 자기 200일 중심선 → SSO ↔ 현금(이자 없음 — SHY 자료는 없음), 매일.'),
    reported: '샤프 0.555 vs SPY 보유 0.524 (5년)', code: SL_CODE[12] },
  { n: 13, name: 'Hollywood SPY 200일 +4%/−3% → TQQQ/QQQ', tag: 'community', src: 'HW',
    rules: sll('신호: SPY 와 200일 이동평균, 위아래가 다른 띠.',
      '들어감: SPY 가 평균보다 +4% 이상 위 → TQQQ 100%.',
      '나감: SPY 가 평균보다 −3% 이하 → QQQ 100% (현금으로는 가지 않음).',
      '주기: 매일. 원래 글에는 보디가드와 나눠 다시 사기도 붙어 있습니다.',
      '이 앱 구현: 두 띠와 TQQQ ↔ QQQ 갈아타기만(보디가드·나눠 사기 없음). 처음에는 QQQ 로 시작하고, 띠 사이에서는 그대로 둠.'),
    reported: 'CAGR 27.3% · 최대 낙폭 −95.8% · 샤프 0.71 (1985–2026)', code: SL_CODE[13] },
  { n: 14, name: '3단계 TQQQ/QLD/GLDM', tag: 'community', needs: '금', src: '3PH',
    rules: sll('1단계: SPY 가 200일 평균 +4% 위 → TQQQ 100%.',
      '2단계: 366일 들고 있으면 → QLD(2배) 50% + GLDM(금) 50%.',
      '3단계: SPY 가 200일 평균 −3% 아래 → SGOV 50% + GLDM 50%.',
      '주기: 매일.'),
    reported: '날짜별 거래가 적힌 백테스트 표를 공개함' },
  { n: 15, name: 'Composer TQQQ-RSI (200일 + RSI + PPO)', tag: 'oscillator', src: 'CMP',
    rules: sll('200일 추세 필터 AND RSI AND PPO.',
      '상승 추세 안에서 눌림에 TQQQ 를 사고, 아니면 SHV 에서 대기.',
      '주기: 매일 갈아타기.',
      '이 앱 구현: QQQ 가 200일 중심선 위이고 QQQ 의 RSI(14) 가 80 미만일 때만 TQQQ, 아니면 현금(이자 없음). PPO 는 없음.'),
    reported: '연 69.11% · 최대 낙폭 −23.5% · 샤프 1.47 (2023년 9월부터 — 짧음)', code: SL_CODE[15] },
  { n: 16, name: 'Composer 다중 신호 + 헤지', tag: 'oscillator', needs: 'SQQQ/UVXY', src: 'CMP',
    rules: sll('#15 에 전술적 헤지를 더함: 극단적인 움직임 뒤 잠깐 SQQQ(−3배)나 UVXY, 급락에는 TECL(3배).',
      '주기: 매일.'),
    reported: 'Composer 변형 중 가장 복잡함' },
  { n: 17, name: 'Petrou 주간 MACD → TQQQ (+ 손절)', tag: 'crossover', src: 'MACD',
    rules: sll('신호: QQQ/나스닥100 주간 MACD.',
      '들어감: MACD 가 0 위로 올라서면 → TQQQ. 나감: 0 아래로 내려가면 → 현금.',
      '손절: 고정 10% + 추적 30%. 주기: 매주.',
      '이 앱 구현: QQQ 일봉 MACD(12/26, 신호선 9) — MACD 가 신호선과 0 보다 모두 위면 TQQQ, 아니면 현금(이자 없음). 산 뒤 TQQQ 고점에서 30% 빠지면 추적 손절(신호가 그대로 켜져 있으면 다음 날 다시 삼). 매일 확인하며 고정 10% 손절은 없음.'),
    reported: '+11,194% (2010년 2월–2025년 7월)', code: SL_CODE[17] },
  { n: 18, name: '40주 이동평균 교차 → TQQQ', tag: 'crossover', src: 'MACD',
    rules: sll('신호: 나스닥100 과 40주 이동평균(약 200일, 주봉).',
      '들어감: 주말 종가가 평균 위 → TQQQ. 나감: 평균 아래 → 현금.',
      '주기: 매주.',
      '이 앱 구현: QQQ 와 200일 중심선을 주의 마지막 거래일에만 비교 → TQQQ ↔ 현금(이자 없음). 계산이 주 중간에 끝나면 그날은 판단 안 함.'),
    reported: '+2,800% (Petrou 비교 기간)', code: SL_CODE[18] },
  { n: 19, name: '골든·데드 크로스 50/200', tag: 'crossover', src: 'GS',
    rules: sll('들어감: 50일 평균이 200일 평균 위로 올라섬(골든 크로스) → 레버리지 ETF.',
      '나감: 데드 크로스(50 < 200) → 현금·단기 국채.',
      '주기: 매일.',
      '이 앱 구현: QQQ 의 50일·200일 중심선 → TQQQ ↔ 현금(이자 없음), 매일.'),
    reported: '고전적인 이동평균 교차 — 가격 vs 200일선보다 느림', code: SL_CODE[19] },
  { n: 20, name: '변동성 목표 (목표 변동성에 맞춰 레버리지 조절)', tag: 'risk', src: 'QC',
    rules: sll('레버리지 = 목표 변동성 ÷ 최근 실제 변동성, 종목 배수가 상한. 변동성이 커지면 줄입니다.',
      '목표 15~25%. 200일 이동평균 관문을 함께 쓰기도 함. 주기: 매주·매달.',
      '이 앱 구현: 매달 첫 거래일에 TQQQ 비중 = 목표 25% ÷ 최근 20거래일 TQQQ 일간 수익률의 연율 변동성(최대 100%), 나머지는 현금(이자 없음).'),
    reported: '이분법 탈출 없이 꼬리 위험을 줄임 (QuantConnect)', code: SL_CODE[20] },
  { n: 21, name: 'VIX 단계별 레버리지', tag: 'risk', needs: 'VIX', src: 'ALV·QC',
    rules: sll('VIX 로 레버리지 정하기: VIX < 15 → 3배, 15~25 → 2배, 25~35 → 1배, 35 초과 → 현금.',
      '주기: 매일·매주. Alvarez VIX 관문의 조상.'),
    reported: '투명한 단계표 — 공포가 커지면 레버리지를 줄임' },
  { n: 22, name: 'Connors RSI(2) 상승 추세 눌림 매수', tag: 'oscillator', src: 'QS',
    rules: sll('추세 필터: 가격이 200일 이동평균 위.',
      '들어감: RSI(2) < 10(과매도)이면 TQQQ 매수.',
      '나감: RSI(2) > 70 이거나 가격이 200일 평균 아래. 주기: 매일.',
      '이 앱 구현: QQQ 의 200일 중심선과 QQQ RSI(2) → TQQQ ↔ 현금(이자 없음).'),
    reported: '추세 필터 안에서 하는 단기 평균 회귀', code: SL_CODE[22] },
  { n: 23, name: '200일 이동평균 + RSI 매도·재진입', tag: 'app', src: 'CMP',
    rules: sll('과열 매도: RSI(10) 이 기준 이상이면 평균 위라도 현금으로.',
      '식음 재진입: 사라는 신호가 나와도 RSI(10) 이 식음 기준 아래로 내려올 때까지 기다렸다 삼.',
      '주기: 매일.',
      '이 앱 구현: QQQ 가 200일 중심선 위이고 RSI(10) 이 80 미만이면 TQQQ 유지, 새로 살 때는 RSI(10) 이 60 미만이어야 함. 아니면 현금(이자 없음).'),
    reported: '많이 오르면 팔고 눌림을 기다려 되삼 — 앱이 구현', code: SL_CODE[23] },
  { n: 24, name: '보디가드 레버리지 축소 (+30 / +40)', tag: 'app', src: 'HW',
    rules: sll('주 신호와 따로: 기초 지수가 200일 평균보다 30% 이상 위면 3배 → QQQ(1배), 40% 이상 위면 전부 현금.',
      '바로 실행(나눠 사기보다 우선).',
      '이 앱 구현: QQQ 가 200일 중심선 아래면 현금, 40% 이상 위면 현금, 30% 이상 위면 QQQ, 그 밖에는 TQQQ — 현금 이자 없음.'),
    reported: '닷컴 거품 보험 — 앱이 구현', code: SL_CODE[24] },
  { n: 25, name: '늘 투자 대기 + 나눠 다시 사기', tag: 'app', src: 'HW',
    rules: sll('팔 때 현금 대신 QQQ/SPY(1배)를 들고 있음.',
      '다시 살 때는 6~12개월에 걸쳐 QQQ 로 나눠 사거나, SPY 가 200일 평균 +4% 위를 되찾으면 TQQQ 로 완전히 갈아탐.',
      '이 앱 구현: QQQ 가 200일 중심선 위면 TQQQ, 아래면 QQQ — 늘 투자. 나눠 사기는 없음.'),
    reported: '하락장에서 채권 대신 QQQ 를 들면 평균 +6.91% — 앱이 구현', code: SL_CODE[25] },
  // 직접 고른 전략 (출처 글이 없어 이름에 링크 없음)
  { n: 26, name: '중앙값 과열 250일', tag: 'picked',
    rules: sll('신호: 매매 종목과 자기 최근 250개 종가의 중앙값.',
      '나감: 가격이 중앙값보다 55% 넘게 위 → 대기(기본은 현금, 연 4% 이자).',
      '들어감: 그렇지 않으면 언제든. 주기: 매일. 거래 비용 0.02%.',
      '과열만 거르는 필터라 내려갈 때의 규칙이 없습니다 — 모든 폭락을 바닥까지 들고 갑니다.'),
    reported: SL_SELF, code: SL_CODE[26] },
  { n: 39, name: '과열 매도 — SSO 신호 (많이 오르면 팔기)', tag: 'picked',
    rules: sll('신호: SSO 와 자기 150일 이동평균.',
      '나감: 신호가 평균보다 20% 넘게 위로 마감 → 대기(기본은 현금).',
      '들어감: 그렇지 않으면 언제든. 주기: 매일.',
      '신호 종목과 매매 종목(기본 TQQQ)은 따로 고를 수 있습니다.',
      '과열만 거르는 필터 — ‘중앙값 과열 250일’처럼 내려갈 때의 규칙이 없어 모든 폭락을 들고 갑니다.'),
    reported: SL_SELF, code: SL_CODE[39] },
  { n: 40, name: '중앙값 과열 (250일) — SQQQ 대기', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 팔고 SQQQ 를 삼.',
      '다시 그 아래로 내려오면 되삼.',
      '매일 확인, 손절 없음. 하루에 한 번만 거래(종목끼리 갈아탈 때는 이틀에 걸쳐), 거래 비용 0.02%.'),
    reported: SL_SELF, code: SL_CODE[40] },
  { n: 41, name: '중앙값 과열 + SQQQ + 폭락 탈출', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 SQQQ 로 갈아탐.',
      '중앙값보다 28% 아래로 마감하고 — 중앙값 자체도 오름을 멈췄을 때(기울기 연 +20% 미만, 선 아래 10일 이상 연속) — 현금으로 팖.',
      '가격이 탈출선 위로 돌아오면 되삼.',
      '매일 확인, 하루에 한 번만 거래.'),
    reported: '직접 고름. 2010–2025 를 훑어 맞춘 값이라 대표 숫자는 표본 안 성적으로 보세요. 숫자는 이 앱의 자체 백테스트', code: SL_CODE[41] },
  { n: 44, name: 'NFCI 거부 + 중앙값 과열 SQQQ + 중앙값 폭락 탈출', tag: 'picked',
    rules: sll('TQQQ 보유. 250일 중앙값보다 55% 위로 마감하면 SQQQ 로 갈아탐.',
      '중앙값보다 28% 아래로 마감하고 — 중앙값도 오름을 멈췄을 때(최근 3개월 기울기가 연 20% 미만, 선 아래 10일 이상 연속) — 현금으로 팖. 가격이 탈출선 위로 돌아오면 되삼. 매일 확인, 하루에 한 번만 거래.',
      '여기에 신용 규칙 하나: 시카고 연준의 주간 NFCI(0 = 평균 여건, 높을수록 빡빡한 신용; 각 값은 그 주가 끝나고 7일 뒤부터 씀)가 +0.4 위로 올라서면 들고 있는 것을 전부 현금으로 팔고 그대로 있습니다.',
      '신용 규칙은 NFCI 가 +0.4 아래로 내려오거나, 그 사이 가격 규칙이 스스로 폭락 탈출과 재진입을 마치면 꺼집니다. 그 뒤에는 NFCI 가 +0.4 아래로 내려갔다 다시 올라설 때까지 가격 규칙이 모두 정합니다.',
      '신용 규칙은 팔기만 하고 사지는 않습니다.',
      '백테스트에서 11번 작동했고 모두 1971년~2007년 11월 사이, 매번 3주~15개월 현금으로 있었습니다. 위기 내내 현금으로 있지는 않습니다: 2008년에는 2007년 11월 30일에 팔고 2008년 4월 1일에 가격 규칙에 넘겼으며, 가격 규칙은 2008년 봄·여름에 여러 번 들락날락한 뒤 2008년 9월 15일에 팔고 2009년 4월에 되샀습니다.'),
    reported: '거부(veto) 부분은 따로 검증함: 1973년부터의 시기표, 52개 창 전진 검증, 흐름을 살린 부트스트랩(다시 뽑은 경로의 87%), 연준 당시 발표 자료, 위약 시험. 이득은 띄엄띄엄 — 몇 번의 신용 위기가 거의 다 만듦', code: SL_CODE[44] },
  // 과최적화 탐색기 1위 — 구간에 맞춰 찾은 최고점이지 예측이 아님 (차이를 보이려고 둠)
  slFit(27, '9sig', 'ret', '2010–2025', '55.33', '69.91', { ul: 'tqqq', g: '130', cd: '5', cw: '24', sp: '25', per: 'monthly', cash: '90', cr: '4', bp: '100', dep: '75', tc: 'holding', park: 'cash', rp: '10', st: '0', cost: '0.02' }),
  slFit(28, '9sig', 'dd', '2010–2025', '30.01', '19.41', { ul: 'tqqq', g: '12', cd: '25', cw: '21', sp: '100', per: 'yearly', cash: '70', cr: '4', bp: '70', dep: '0', tc: 'holding', park: 'qld', rp: '10', st: '0', cost: '0.02' }),
  slFit(29, '9sig', 'ret', '1990–2025', '42.24', '81.66', { ul: 'tqqq', g: '150', cd: '5', cw: '36', sp: '200', per: 'yearly', cash: '0', cr: '4', bp: '100', dep: '100', tc: 'holding', park: 'cash', rp: '0', st: '0', cost: '0.02' }),
  slFit(30, '9sig', 'dd', '1990–2025', '18.12', '22.67', { ul: 'tqqq', g: '0.5', cd: '5', cw: '60', sp: '250', per: 'quarterly', cash: '70', cr: '4', bp: '70', dep: '50', tc: 'holding', park: 'cash', rp: '30', st: '0', cost: '0.02' }),
  slFit(31, '9sig', 'ret', '1953–2025', '19.96', '96.58', { ul: 'tqqq', g: '40', cd: '25', cw: '24', sp: '160', per: 'quarterly', cash: '40', cr: '4', bp: '85', dep: '100', tc: 'target', park: 'cash', rp: '30', st: '0', cost: '0.02' }),
  slFit(32, '9sig', 'dd', '1953–2025', '12.01', '45.8', { ul: 'tqqq', g: '15', cd: '20', cw: '48', sp: '50', per: 'yearly', cash: '60', cr: '4', bp: '50', dep: '0', tc: 'holding', park: 'cash', rp: '15', st: '25', cost: '0.02' }),
  slFit(33, 'sma', 'ret', '2010–2025', '79.79', '74.03', { sig: 'spy', win: '280', ul: 'sso', cr: '0', eb: '5', xb: '1.9', oh: '20', cool: '55', ohw: '3', coolw: '22', cb: '3', cs: '10', settle: '5', out: 'tqqq', din: '10', dout: '5', bg: '55', bga: 'tqqq', bgw: '250', cost: '0.02' }),
  slFit(34, 'sma', 'dd', '2010–2025', '61.01', '44.5', { sig: 'qqq', win: '30', ul: 'tqqq', cr: '0', eb: '0.1', xb: '3.5', oh: '65', cool: '65', ohw: '4', coolw: '17', cb: '3', cs: '10', settle: '1', out: 'sso', din: '7', dout: '42', bg: '35', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(35, 'sma', 'ret', '1990–2025', '54.13', '81.66', { sig: 'qqq', win: '30', ul: 'spy', cr: '0', eb: '13', xb: '12', oh: '80', cool: '70', ohw: '6', coolw: '16', cb: '0', cs: '10', settle: '5', out: 'tqqq', din: '7', dout: '25', bg: '30', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(36, 'sma', 'dd', '1990–2025', '31.28', '39.46', { sig: 'spxl', win: '220', ul: 'tqqq', cr: '0', eb: '0', xb: '5', oh: '15', cool: '45', ohw: '2', coolw: '8', cb: '0', cs: '10', settle: '0', out: 'cash', din: '4', dout: '12', bg: '30', bga: 'sso', bgw: '270', cost: '0.02' }),
  slFit(37, 'sma', 'ret', '1953–2025', '29.97', '83.6', { sig: 'spxl', win: '20', ul: 'tqqq', cr: '0', eb: '0.4', xb: '0.4', oh: '80', cool: '0', ohw: '12', coolw: '17', cb: '0', cs: '0', settle: '0', out: 'spy', din: '1', dout: '6', bg: '35', bga: 'qld', bgw: '300', cost: '0.02' }),
  slFit(38, 'sma', 'dd', '1953–2025', '18', '51.79', { sig: 'spxl', win: '20', ul: 'qld', cr: '0', eb: '0.5', xb: '0.3', oh: '85', cool: '75', ohw: '8', coolw: '25', cb: '0', cs: '0', settle: '1', out: 'cash', din: '0', dout: '5', bg: '20', bga: 'qqq', bgw: '250', cost: '0.02' }),
];
const slRunnable = (e) => !!(e && (e.preset || e.code));

// ── 저장·공유된 예전 라이브러리 코드 → 지금 코드 (2026-10-21 버그 고침) ─────────
// 고치기 전 코드의 지문(FNV-1a 32비트 · 글자 수). '써 보기'로 저장했거나 링크로 받은 사본이 손대지 않은 예전 코드면
// 지금 코드로 바꿈 — 사용자가 고친 코드(지문이 다름)는 그대로 둠
//   #1 Faber: 차트가 주 단위면 매주 판단하던 것 → 달의 마지막 거래일에만 · #18: 계산 끝 날(주 중간)에 판단하던 것
//   #2 #3 #8 #9 #10 #11 #12 #15 #17 #18 #19 #22 #23: 파는 날 들어온 적립금이 사라지던 것 · #26: 첫날 창이 하나 짧아질 수 있던 것
const SS_LIB_OLD = { 1: '9398d0d5:3065', 2: '69d110b3:2973', 3: '62609f35:2970', 8: 'b69ecf43:3155', 9: '5dd45200:3108', 10: '57a3b329:3298',
  11: '4775b483:2974', 12: '78c98b65:2938', 15: '5f6a2ba5:3747', 17: 'c99f178f:2353', 18: 'aac02be6:3205', 19: '99d2dda8:3082',
  22: 'b0ac78a6:3799', 23: 'c428c6db:3811', 26: '071d71cc:7489' };
function ssLibFingerprint(code) {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) { h ^= code.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + ':' + code.length;
}
// 사용자 전략(cfg) 한 개 — 예전 라이브러리 코드면 지금 코드·설명으로 바꾸고 true
function ssUpgradeLibCode(cfg) {
  if (!cfg || cfg.type !== 'custom' || !cfg.code) return false;
  const f = ssLibFingerprint(cfg.code);
  for (const n in SS_LIB_OLD) {
    if (SS_LIB_OLD[n] !== f) continue;
    const L = SS_LIBRARY.find((e) => e.n === +n);
    if (!L || !L.code) return false;
    cfg.code = L.code; cfg.desc = L.rules || cfg.desc; cfg.lib = L.n;
    return true;
  }
  return false;
}

// ── 카드 숫자 (열 때 계산 · 보이는 카드만 · 한 번 계산하면 기억) ─────────────
const SL_SPARK_FROM = '1995-01-01';   // 작은 곡선의 왼쪽 끝
const SL_START = 10000;               // 시작 금액
const SL_MONTH = 1000;                // 새 달 첫 거래일마다 더하는 돈
// 다섯 칸: 전체 + 두 전환점(닷컴 고점 2000 1분기 · 금융위기 바닥 2009 1분기)으로 자른 네 구간
// 진입은 앱과 같게 경계 분기의 '직전 분기말' — 끝은 경계 이하 마지막 분기말(null = 마지막 날)
const SL_ERAS = [
  { key: '1971', from: '1971-01-01', to: null, label: ['1971–', '오늘'], sub: '전체 기간' },
  { key: '1980', from: '1980-01-01', to: '2000-03-31', label: ['1980–', '2000 1분기'], sub: '거품 전 상승기' },
  { key: '2000', from: '2000-03-31', to: '2009-03-31', label: ['2000 1분기–', '2009 1분기'], sub: '닷컴 고점 → 금융위기 바닥' },
  { key: '2009', from: '2009-03-31', to: '2025-12-31', label: ['2009 1분기–', '2025 4분기'], sub: '금융위기 뒤 상승장' },
  { key: '2026', from: '2025-12-31', to: null, label: ['2026–', '오늘'], sub: '올해' },
];
const SLX = { days: null, grid: null, spy: null, memo: new Map(), mods: new Map() };

// 자료가 바뀌면(다시 불러오면) 기억을 비움
function slBase() {
  if (!DS.days || !DS.days.length || !DS.q || !DS.q.length) return null;
  if (SLX.days === DS.days && SLX.grid) return SLX;
  SLX.days = DS.days;
  SLX.memo = new Map();
  SLX.mods = new Map();
  SLX.grid = slQuarterGrid();
  SLX.spy = slSpyCurve(SLX.grid);
  return SLX;
}
// 1995년부터 분기마다 한 점 — 날짜는 그 분기의 마지막 거래일, 이름표는 그 거래일의 달 (진행 중인 분기가 미래 달로 안 보이게)
function slQuarterGrid() {
  const days = DS.days, out = [];
  let i = 0;
  while (i < days.length && days[i].date < SL_SPARK_FROM) i++;
  let qk = null;
  for (; i < days.length; i++) {
    const d = days[i].date, k = d.slice(0, 4) + 'Q' + Math.ceil(+d.slice(5, 7) / 3);
    if (k !== qk) { out.push({ key: d.slice(0, 7), date: d }); qk = k; }
    else { const o = out[out.length - 1]; o.date = d; o.key = d.slice(0, 7); }
  }
  return out;
}
// 비교선: 1995년 첫 거래일에 SPY 를 $10K 사고, 새 달 첫 거래일마다 $1,000 어치 더 삼 (전략과 같은 돈 흐름)
function slSpyCurve(grid) {
  const days = DS.days, out = new Array(grid.length);
  let si = -1;
  for (let i = 0; i < days.length; i++) if (days[i].date >= SL_SPARK_FROM) { si = i; break; }
  if (si < 0 || !(days[si].spy > 0)) return out.fill(SL_START);
  let units = SL_START / days[si].spy, mo = days[si].date.slice(0, 7), di = si;
  for (let q = 0; q < grid.length; q++) {
    while (di < days.length - 1 && days[di].date < grid[q].date) {
      di++;
      const m = days[di].date.slice(0, 7);
      if (m !== mo) { mo = m; if (days[di].spy > 0) units += SL_MONTH / days[di].spy; }
    }
    out[q] = units * days[di].spy;
  }
  return out;
}
// 분기 행 찾기 · 날짜 위치 찾기
function slQAtOrAfter(d) { const Q = DS.q; for (let i = 0; i < Q.length; i++) if (Q[i][0] >= d) return i; return -1; }
function slQAtOrBefore(d) { const Q = DS.q; if (!d) return Q.length - 1; for (let i = Q.length - 1; i >= 0; i--) if (Q[i][0] <= d) return i; return -1; }
function slDayAtOrBefore(d) {
  const days = DS.days;
  if (!d) return days.length - 1;
  let lo = 0, hi = days.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (days[m].date <= d) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}
const slEntryQ = (d) => { const qi = slQAtOrAfter(d); return qi > 0 ? qi - 1 : qi; };
const slQDate = (qi, fb) => (qi >= 0 && DS.q[qi] ? DS.q[qi][0] : fb);

// 코드 전략 한 번 실행 (1차 코드라 메인 스레드에서 — 사용자 코드는 절대 이 길로 안 옴)
function slRunCode(mod, si, ei) {
  const days = DS.days, d0 = days[si].date, d1 = days[ei].date;
  const g = { initial: SL_START, monthly: SL_MONTH, annualRaise: 0, startIdx: si, endIdx: ei, entryDate: d0, exitDate: d1,
    contributions: ssContribObj(SL_MONTH, 0, d0, d1, null) };
  return ssRunTrusted(mod, g, {}).log || [];
}
// 프리셋 한 번 실행 (기본 엔진 · 저장 전략과 같은 옵션 연결)
function slRunPreset(pr, qa, qb) {
  const p = ssCleanParams(pr.type, pr.params);
  const d0 = slQDate(qa, null), d1 = slQDate(qb, null);
  const base = { initial: SL_START, monthly: SL_MONTH, raise: 0, qi0: qa, qi1: qb, rate: ssRate9(p) };
  if (pr.type === '9sig') {
    const o9 = ssOpts9(p), per = p.per || 'quarterly';
    let rows = null;
    const rp = +p.rp || 0;
    if (rp > 0) {
      const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1));
      const q = ssShiftRows(per, off, d0, d1);
      if (q && q.length >= 2) rows = q;
    }
    const yearly = per === 'yearly';
    const r = ssRun9(Object.assign({}, base, { period: per, rows, sampleQ: yearly, noBH: true }, o9));
    return {
      points: (yearly ? r.samples : r.log).map((l) => ({ date: l.date, value: l.total })),
      ctrl: r.log.map((l) => ({ date: l.date, shares: l.price > 0 ? l.holdVal / l.price : 0, cash: l.cash })),
      key: SS_KEY_OF[o9.ul] || 'tqqq', start: d0, end: d1,
    };
  }
  const r = ssRunSma(Object.assign({}, base, { dd: true }, ssOptsSma(p)));
  return { points: r.points.map((pt) => ({ date: pt.date, value: pt.value })), multi: r.dd || null, start: d0, end: d1, daily: true };
}
// 한 전략의 실행기: (구간 시작, 끝) → 결과
function slRunner(e) {
  const B = slBase();
  if (e.preset) return (from, to) => slRunPreset(e.preset, slEntryQ(from), slQAtOrBefore(to));
  let mod = B.mods.get(e.n);
  if (!mod) { mod = ssEvalTrusted(e.code); B.mods.set(e.n, mod); }
  return (from, to) => {
    const si = slDayAtOrBefore(slQDate(slEntryQ(from), from));
    const ei = to === null ? DS.days.length - 1 : slDayAtOrBefore(slQDate(slQAtOrBefore(to), to));
    // 시작 금액은 진입일에, 적립은 달이 바뀐 첫 거래일에 들어감(slRunCode 의 contributions) → 연평균도 그 날짜로
    return { points: slRunCode(mod, si, ei), start: DS.days[si].date, daily: true };
  };
}
// 돈 가중 연수익률(IRR) + 최대 낙폭 — 매달 새 돈이 들어가므로 단순 시작/끝 비율이면 적립금을 수익으로 셈
function slMeasure(res) {
  const pts = res && res.points;
  if (!pts || pts.length < 2 || !(pts[0].value > 0)) return null;
  const v1 = pts[pts.length - 1].value;
  // 끝 = 마지막 값이 나온 점의 날짜 (리밸런스 시점을 옮긴 프리셋은 구간 끝보다 앞일 수 있음 — 본 화면 연평균과 같은 규칙)
  const d0 = res.start || pts[0].date, d1 = String(pts[pts.length - 1].date);
  const yrs = (Date.parse(d1) - Date.parse(d0)) / (365.25 * 864e5);
  // 낙폭: 앱처럼 매일 종가로 다시 평가 (엔진 기준점 → 없으면 코드 기록으로 기준점을 만듦 → 그래도 없으면 기록 값으로)
  let dd = null;
  if (res.multi && res.multi.length) dd = ssDailyDDMulti(res.multi).pct;
  else if (res.ctrl && res.ctrl.length) dd = ssDailyDD(res.ctrl, res.key || 'tqqq').pct;
  else { const cc = ssCustomCtrl(pts); if (cc) dd = ssDailyDDMulti(cc).pct; }
  if (dd == null) {
    let top = -Infinity;
    dd = 0;
    for (const r of pts) { if (r.value > top) top = r.value; if (top > 0) dd = Math.max(dd, 1 - r.value / top); }
  }
  const paid = SL_START + SL_MONTH * Math.max(0, Math.round(yrs * 12));
  // 적립 날짜·장부 규칙은 그 계산과 같게: 코드 전략·SMA = 'day', 9sig 프리셋 = 'r9' (ssFlows)
  const cagr = yrs > 0 ? ssCagrMW(SL_START, SL_MONTH, 0, d0, d1, yrs, v1, paid, null, res.daily ? 'day' : 'r9', true) : 0;
  return { cagr, dd: dd * 100 };
}
// 기록을 분기 점에 맞춤 (그 분기 날짜까지의 마지막 값 · 첫 기록 전은 시작 금액)
function slFill(pts, grid) {
  const out = new Array(grid.length);
  let j = 0, last = SL_START;
  for (let q = 0; q < grid.length; q++) {
    while (j < pts.length && pts[j].date <= grid[q].date) { last = pts[j].value; j++; }
    out[q] = last;
  }
  return out;
}
// 한 카드의 숫자 — 실패한 전략은 그 카드만 '—' (라이브러리 전체는 계속)
function slStats(e) {
  const B = slBase();
  if (!B || !e) return null;
  if (B.memo.has(e.n)) return B.memo.get(e.n);
  let res = null;
  if (slRunnable(e)) {
    try {
      const run = slRunner(e), metrics = {};
      for (const era of SL_ERAS) { const m = slMeasure(run(era.from, era.to)); if (m) metrics[era.key] = m; }
      res = { metrics, curve: slFill(run(SL_SPARK_FROM, null).points || [], B.grid) };
    } catch (err) {
      console.warn('전략 라이브러리 #' + e.n + ' 계산 실패 —', (err && err.message) || err);
      res = { metrics: {}, curve: null };
    }
  }
  B.memo.set(e.n, res);
  return res;
}

// ── 화면 ──────────────────────────────────────────────────────────────
const SL_PAGE = 8;   // 한 쪽 카드 수 (카드마다 계산이 여러 번 돌아서)
const SLU = { el: null, page: 1, q: '', token: 0, back: null, tip: null, active: null };
const SL_WIP = '공개된 글을 바탕으로 이 앱에서 다시 구현한 전략들이며, 합성 자료 위에서 시작 $10K + 매달 $1,000, 세금 없음으로 백테스트했습니다. '
  + '실제 결과는 더 나쁩니다: 자주 사고파는 전략은 세금과 슬리피지에 크게 깎이고, 여기 있는 3배 전략 대부분은 1971년부터 보면 어딘가에서 80% 넘는 낙폭(몇몇은 거의 100%)을 겪었습니다. '
  + '대략적인 비교로만 보세요 — 오류를 고치고 빠진 전략을 채우면서 숫자는 바뀔 수 있습니다.';

// 짧은 금액: $10K · $257K · $22M · $1.3B
function slMoney(v) {
  if (!(v > 0)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
  return '$' + Math.round(v);
}
const slPct = (v) => (v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%');
// 낙폭: 90% 넘으면 소수 셋째 자리까지 (−99.960% 와 −100% 는 살아남은 계좌와 깡통의 차이)
function slDDText(dd) { const t = dd > 90 ? dd.toFixed(3) : String(Math.round(dd)); return +t === 0 ? '0%' : '−' + t + '%'; }
const slQName = (key) => key.slice(0, 4) + '년 ' + Math.ceil(+key.slice(5, 7) / 3) + '분기';

// 규칙 풍선: 이름 · 규칙 · 필요한 자료 · 출처 메모
function slTipText(e) {
  const parts = [e.name, '', e.rules];
  if (e.needs) parts.push('', '이 앱에 없는 자료가 필요함: ' + e.needs);
  if (e.reported) parts.push('', '출처 메모: ' + e.reported);
  return parts.join('\n');
}
// 한 쪽에 보일 카드 (검색어의 모든 낱말이 이름·태그·필요 자료·규칙에 들어 있어야)
function slFiltered() {
  const words = SLU.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return SS_LIBRARY.slice();
  return SS_LIBRARY.filter((e) => {
    const hay = [e.name, e.tag, SS_LIB_TAGS[e.tag], e.needs, e.rules].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// 로그 눈금 (카드마다 전략·SPY 둘 다 들어가게)
const SL_SW = 300, SL_SH = 120, SL_SP = 3;
function slScale(curve, spy) {
  const vals = curve.concat(spy).filter((v) => v > 0);
  const lo = Math.log10(Math.min.apply(null, vals)), hi = Math.log10(Math.max.apply(null, vals));
  const span = (hi - lo) || 1;
  return {
    lo, hi,
    y: (v) => (v > 0 ? SL_SH - SL_SP - ((Math.log10(v) - lo) / span) * (SL_SH - 2 * SL_SP) : SL_SH - SL_SP),
    x: (i, n) => SL_SP + (i / (n - 1)) * (SL_SW - 2 * SL_SP),
  };
}
function slSparkHtml(e, st) {
  const ok = slRunnable(e);
  if (!ok) return '<div class="ss-lib-sp ss-lib-sp0"><span>백테스트 없음</span></div>';
  if (!st) return '<div class="ss-lib-sp ss-lib-sp0 ss-lib-wait"><span>계산 중…</span></div>';
  const curve = st.curve, spy = SLX.spy;
  if (!curve || !spy || !spy.length) return '<div class="ss-lib-sp ss-lib-sp0"><span>계산하지 못했습니다</span></div>';
  const s = slScale(curve, spy), N = curve.length;
  const path = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + s.x(i, N).toFixed(1) + ' ' + s.y(v).toFixed(1)).join(' ');
  let grid = '';
  for (let k = Math.ceil(s.lo); k <= Math.floor(s.hi); k++) { const y = s.y(Math.pow(10, k)).toFixed(1); grid += '<line x1="0" y1="' + y + '" x2="' + SL_SW + '" y2="' + y + '"/>'; }
  // 이름표 높이(%): 아래 연도 줄·왼쪽 위 '로그' 표시와 안 겹치게, 오른쪽 끝 두 이름표는 서로 10% 이상 떨어지게
  const pc = (v) => (s.y(v) / SL_SH) * 100, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let yS = clamp(pc(curve[N - 1]), 6, 78), yB = clamp(pc(spy[spy.length - 1]), 6, 78);
  if (Math.abs(yS - yB) < 10) {
    const mid = (yS + yB) / 2, sTop = yS <= yB;
    yS = mid + (sTop ? -5 : 5); yB = mid + (sTop ? 5 : -5);
    const top = Math.min(yS, yB), bot = Math.max(yS, yB);
    if (top < 6) { yS += 6 - top; yB += 6 - top; } else if (bot > 78) { yS -= bot - 78; yB -= bot - 78; }
  }
  const y0 = clamp(pc(SL_START), 18, 78);
  const g = SLX.grid, years = [0, 1, 2, 3].map((k) => g[Math.round((k / 3) * (g.length - 1))].key.slice(0, 4));
  const span = g.length ? g[0].key.slice(0, 4) + '–' + g[g.length - 1].key.slice(0, 4) : '';
  return '<div class="ss-lib-sp" data-n="' + e.n + '">'
    + '<svg viewBox="0 0 ' + SL_SW + ' ' + SL_SH + '" preserveAspectRatio="none" role="img" aria-label="' + ssEsc(e.name) + ' 와 SPY, 로그 눈금 ' + span + '">'
    + '<g class="ss-lib-grid">' + grid + '</g>'
    + '<path class="ss-lib-lspy" d="' + path(spy) + '"/>'
    + '<path class="ss-lib-lst" d="' + path(curve) + '"/></svg>'
    + '<span class="ss-lib-log">로그</span>'
    + '<span class="ss-lib-lb ss-lib-lb0" style="top:' + y0.toFixed(0) + '%">' + slMoney(SL_START) + '</span>'
    + '<span class="ss-lib-lb ss-lib-lbst" style="top:' + yS.toFixed(0) + '%">' + slMoney(curve[N - 1]) + '</span>'
    + '<span class="ss-lib-lb ss-lib-lbspy" style="top:' + yB.toFixed(0) + '%">SPY ' + slMoney(spy[spy.length - 1]) + '</span>'
    + '<span class="ss-lib-yr">' + years.map((y) => '<b>' + y + '</b>').join('') + '</span>'
    + '<i class="ss-lib-x" aria-hidden="true"></i><i class="ss-lib-dot ss-lib-dspy" aria-hidden="true"></i><i class="ss-lib-dot ss-lib-dst" aria-hidden="true"></i>'
    + '</div>';
}
// 시기 표: 기간 / 연평균(돈 가중) / 최대 낙폭
function slEraHtml(e, st) {
  const m = st && st.metrics, wait = slRunnable(e) && !st;
  const head = SL_ERAS.map((era) => {
    const c = m && m[era.key];
    const t = era.label.join('') + ' · ' + era.sub + (c ? '\n' + slPct(c.cagr) + ' 연평균 수익률(돈 가중 CAGR)\n' + slDDText(c.dd) + ' 그 기간 안 가장 깊은 낙폭' : '');
    return '<td title="' + ssEsc(t) + '"><span>' + era.label[0] + '</span><span>' + era.label[1] + '</span></td>';
  }).join('');
  const cell = (fn) => SL_ERAS.map((era) => { const c = m && m[era.key]; return c ? fn(c) : '<td class="ss-lib-na">' + (wait ? '…' : '—') + '</td>'; }).join('');
  return '<table class="ss-lib-era"><tbody>'
    + '<tr class="ss-lib-rd"><th scope="row">기간</th>' + head + '</tr>'
    + '<tr class="ss-lib-rc"><th scope="row">연평균</th>' + cell((c) => '<td class="' + (c.cagr >= 0 ? 'ss-lib-up' : 'ss-lib-dn') + '">' + slPct(c.cagr) + '</td>') + '</tr>'
    + '<tr class="ss-lib-rx"><th scope="row">최대 낙폭</th>' + cell((c) => '<td>' + slDDText(c.dd) + '</td>') + '</tr>'
    + '</tbody></table>';
}
function slCardHtml(e) {
  const st = SLX.memo.has(e.n) ? SLX.memo.get(e.n) : null, ok = slRunnable(e);
  const link = e.src && SS_LIB_LINKS[e.src];
  const nm = link
    ? '<a class="ss-lib-nm" href="' + ssEsc(link) + '" target="_blank" rel="noopener" title="' + ssEsc(e.rules) + '">' + ssEsc(e.name) + '</a>'
    : '<span class="ss-lib-nm" title="' + ssEsc(e.rules) + '">' + ssEsc(e.name) + '</span>';
  const act = ok
    ? '<button type="button" class="ss-lib-try" data-try="' + e.n + '" title="이 전략을 저장 전략으로 차트에 더하기">써 보기 <span aria-hidden="true">▸</span></button>'
    : e.needs
      ? '<span class="ss-lib-na2" title="이 앱에 없는 자료가 필요합니다">' + ssEsc(e.needs) + ' 필요</span>'
      : '<span class="ss-lib-na2">준비 중</span>';
  return '<article class="ss-lib-card' + (ok ? '' : ' off') + '" data-n="' + e.n + '">'
    + '<div class="ss-lib-ch"><div class="ss-lib-tt"><span class="ss-lib-tag">' + ssEsc(SS_LIB_TAGS[e.tag] || e.tag) + '</span>' + nm + '</div>'
    + '<div class="ss-lib-ca">' + act
    + '<span class="ss-i ss-lib-info" tabindex="0" role="button" aria-label="규칙 보기" data-tip="' + ssEsc(slTipText(e)) + '" data-tip-wide>ⓘ</span></div></div>'
    + '<div class="ss-lib-body">' + slSparkHtml(e, st) + slEraHtml(e, st) + '</div>'
    + '</article>';
}
function slPagerHtml(total, pages, from, shown) {
  if (!total) return '';
  const b = (pg, label, dis, on, aria) => '<button type="button" class="ss-lib-pg' + (on ? ' on' : '') + '" data-page="' + pg + '"' + (dis ? ' disabled' : '') + (on ? ' aria-current="page"' : '') + (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';
  let nums = '';
  for (let k = 1; k <= pages; k++) nums += b(k, k, false, k === SLU.page, k + '쪽');
  return '<span class="ss-lib-pinfo">' + (from + 1) + '–' + (from + shown) + ' / ' + total + '</span>'
    + '<span class="ss-lib-pbtns">' + b(SLU.page - 1, '‹', SLU.page <= 1, false, '이전 쪽') + nums + b(SLU.page + 1, '›', SLU.page >= pages, false, '다음 쪽') + '</span>';
}

// 한 쪽 그리기 — 기억해 둔 카드는 바로, 나머지는 하나씩 계산하며 채움 (창이 바로 뜨게)
function slRenderPage(scrollTop) {
  const root = SLU.el;
  if (!root) return;
  slHideTip();
  const list = slFiltered(), pages = Math.max(1, Math.ceil(list.length / SL_PAGE));
  SLU.page = Math.min(Math.max(1, SLU.page), pages);
  const from = (SLU.page - 1) * SL_PAGE, slice = list.slice(from, from + SL_PAGE);
  const cards = root.querySelector('.ss-lib-cards');
  cards.innerHTML = slice.map(slCardHtml).join('');
  root.querySelector('.ss-lib-none').hidden = list.length > 0;
  root.querySelector('.ss-lib-pager').innerHTML = slPagerHtml(list.length, pages, from, slice.length);
  if (scrollTop) root.querySelector('.ss-lib-scroll').scrollTop = 0;
  const token = ++SLU.token;
  const todo = slice.filter((e) => slRunnable(e) && !SLX.memo.has(e.n));
  const step = () => {
    if (token !== SLU.token || !todo.length || !SLU.el || SLU.el.hidden) return;
    const e = todo.shift();
    slStats(e);
    const card = cards.querySelector('.ss-lib-card[data-n="' + e.n + '"]');
    if (card) { const st = SLX.memo.get(e.n); card.querySelector('.ss-lib-body').innerHTML = slSparkHtml(e, st) + slEraHtml(e, st); }
    if (todo.length) setTimeout(step, 0);
  };
  if (todo.length) setTimeout(step, 16);
}

// 작은 곡선 위 마우스·손가락 → 세로선 + 점 두 개 + 풍선 (그 분기의 전략·SPY 금액)
function slSparkAt(box, clientX) {
  const st = SLX.memo.get(+box.getAttribute('data-n')), curve = st && st.curve, spy = SLX.spy;
  if (!curve || !spy) { slHideTip(); return; }
  if (SLU.active && SLU.active !== box) SLU.active.classList.remove('hov');
  SLU.active = box;
  box.classList.add('hov');
  const r = box.getBoundingClientRect(), N = curve.length, s = slScale(curve, spy);
  const fx = ((clientX - r.left) / r.width * SL_SW - SL_SP) / (SL_SW - 2 * SL_SP);
  const i = Math.round(Math.max(0, Math.min(1, fx)) * (N - 1));
  const xPx = (s.x(i, N) / SL_SW) * r.width, yPx = (v) => (s.y(v) / SL_SH) * r.height;
  const setAt = (sel, y) => { const el = box.querySelector(sel); if (el) { el.style.left = xPx + 'px'; if (y != null) el.style.top = y + 'px'; } };
  setAt('.ss-lib-x'); setAt('.ss-lib-dst', yPx(curve[i])); setAt('.ss-lib-dspy', yPx(spy[i]));
  const sv = curve[i], pv = spy[i], top = Math.max(sv, pv, 1);
  const ws = Math.max(2, (sv / top) * 100).toFixed(1), wp = Math.max(2, (pv / top) * 100).toFixed(1);
  const mult = pv > 0 ? 'SPY 의 ' + (sv / pv).toFixed(sv / pv >= 10 ? 0 : 1) + '배' : '';
  let tip = SLU.tip;
  if (!tip) { tip = document.createElement('div'); tip.className = 'ss-lib-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); SLU.tip = tip; }
  tip.innerHTML = '<div class="ss-lib-tq">' + slQName(SLX.grid[i].key) + '<b>' + mult + '</b></div>'
    + '<div class="ss-lib-tr"><span class="ss-lib-tb"><i class="st" style="width:' + ws + '%"></i></span><span class="ss-lib-tv st">' + slMoney(sv) + '</span></div>'
    + '<div class="ss-lib-tr"><span class="ss-lib-tb"><i class="spy" style="width:' + wp + '%"></i></span><span class="ss-lib-tv">SPY ' + slMoney(pv) + '</span></div>';
  tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + xPx + 14;
  if (left + tw > window.innerWidth - 8) left = r.left + xPx - tw - 14;
  left = Math.max(8, left);
  const top2 = Math.max(8, Math.min(window.innerHeight - th - 8, r.top + 4));
  tip.style.left = left + 'px';
  tip.style.top = top2 + 'px';
}
function slHideTip() {
  if (SLU.tip) SLU.tip.style.display = 'none';
  if (SLU.active) { SLU.active.classList.remove('hov'); SLU.active = null; }
}

// 써 보기 → 저장 전략으로 추가하고 창을 닫음 (선이 바로 보이게)
function slTry(e) {
  if (!slRunnable(e) || typeof ssAddFromLibrary !== 'function') return null;
  const arg = e.preset
    ? { n: e.n, name: e.name, rules: e.rules, preset: { type: e.preset.type, params: Object.assign({}, e.preset.params) } }
    : { n: e.n, name: e.name, rules: e.rules, code: e.code };
  const id = ssAddFromLibrary(arg);
  if (SLU.el && !SLU.el.hidden) ssLibraryClose();
  return id;
}

function slBuild() {
  if (SLU.el) return SLU.el;
  const ready = SS_LIBRARY.filter(slRunnable).length;
  const el = document.createElement('div');
  el.className = 'ss-lib';
  el.hidden = true;
  el.innerHTML = '<div class="ss-lib-box" role="dialog" aria-modal="true" aria-labelledby="ss-lib-h" tabindex="-1">'
    + '<div class="ss-lib-top"><h2 class="ss-lib-h" id="ss-lib-h"><span aria-hidden="true">📚</span> 전략 라이브러리</h2>'
    + '<details class="ss-lib-wip"><summary>⚠ 아직 만드는 중 — 숫자는 대략적인 비교용</summary><p>' + ssEsc(SL_WIP) + '</p></details>'
    + '<button type="button" class="ss-lib-close" aria-label="닫기">×</button></div>'
    + '<div class="ss-lib-scroll"><div class="ss-lib-head"><div class="ss-lib-bar">'
    + '<span class="ss-lib-leg"><i class="st"></i>전략 <i class="spy"></i>SPY · 로그 · <span class="ss-lib-span"></span></span>'
    + '<nav class="ss-lib-pager" aria-label="쪽 넘기기"></nav>'
    + '<span class="ss-lib-cnt">' + ready + '/' + SS_LIBRARY.length + ' 백테스트됨 · 규칙은 ⓘ</span></div>'
    + '<input type="search" class="ss-lib-q" autocomplete="off" spellcheck="false" placeholder="전략 찾기 — 이름·태그·규칙 낱말…" aria-label="전략 찾기"></div>'
    + '<p class="ss-lib-none" hidden>찾는 전략이 없습니다 — 다른 낱말로 찾아보세요.</p>'
    + '<div class="ss-lib-cards"></div></div></div>';
  document.body.appendChild(el);
  SLU.el = el;
  // 누르기: 닫기 · 바깥(배경) · 써 보기 · 쪽
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t === el || t.closest('.ss-lib-close')) { ssLibraryClose(); return; }
    const tr = t.closest('[data-try]');
    if (tr) { const e = SS_LIBRARY.find((x) => x.n === +tr.getAttribute('data-try')); if (e) slTry(e); return; }
    const pg = t.closest('[data-page]');
    if (pg && !pg.disabled) { SLU.page = +pg.getAttribute('data-page'); slRenderPage(true); }
  });
  const q = el.querySelector('.ss-lib-q');
  q.addEventListener('input', () => { SLU.q = q.value; SLU.page = 1; slRenderPage(true); });
  const cards = el.querySelector('.ss-lib-cards');
  // 마우스: 지나가며 보기 · 손가락: 누른 채 옆으로 끌어 보기 (위아래로 끌면 그냥 스크롤)
  cards.addEventListener('pointermove', (ev) => {
    const box = ev.target.closest && ev.target.closest('.ss-lib-sp[data-n]');
    if (!box) { if (SLU.active) slHideTip(); return; }
    if (ev.pointerType === 'mouse' || ev.buttons) slSparkAt(box, ev.clientX);
  });
  cards.addEventListener('pointerdown', (ev) => { const box = ev.target.closest && ev.target.closest('.ss-lib-sp[data-n]'); if (box) slSparkAt(box, ev.clientX); });
  cards.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') slHideTip(); });
  el.querySelector('.ss-lib-scroll').addEventListener('scroll', slHideTip, { passive: true });
  return el;
}
// 창이 열려 있는 동안: Esc = (검색어가 있으면) 검색어 지우기 / 닫기 · Tab 은 창 안에서만 돎
function slOnKey(ev) {
  const el = SLU.el;
  if (!el || el.hidden) return;
  if (ev.key === 'Escape') {
    const q = el.querySelector('.ss-lib-q');
    if (document.activeElement === q && q.value) { q.value = ''; SLU.q = ''; SLU.page = 1; slRenderPage(true); }
    else ssLibraryClose();
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  if (ev.key === 'Tab') {
    const f = Array.from(el.querySelectorAll('a[href], button:not([disabled]), input, summary, [tabindex="0"]')).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (ev.shiftKey && (document.activeElement === a || !el.contains(document.activeElement))) { z.focus(); ev.preventDefault(); }
    else if (!ev.shiftKey && (document.activeElement === z || !el.contains(document.activeElement))) { a.focus(); ev.preventDefault(); }
  }
}
function slDropHash() {
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* 주소를 못 바꾸는 환경 */ }
}

function ssLibraryOpen() {
  const el = slBuild();
  const B = slBase();
  const span = el.querySelector('.ss-lib-span');
  if (span) span.textContent = B && B.grid.length ? B.grid[0].key.slice(0, 4) + '–' + B.grid[B.grid.length - 1].key.slice(0, 4) : '';
  if (el.hidden) {
    SLU.back = document.activeElement;
    el.hidden = false;
    document.documentElement.classList.add('ss-lib-on');
    document.addEventListener('keydown', slOnKey, true);
  }
  if (!B) {
    el.querySelector('.ss-lib-cards').innerHTML = '<p class="ss-lib-none">가격 자료를 불러오는 중입니다 — 잠시 뒤 다시 열어 주세요.</p>';
    el.querySelector('.ss-lib-pager').innerHTML = '';
  } else {
    el.querySelector('.ss-lib-q').value = SLU.q;
    slRenderPage(false);
  }
  const box = el.querySelector('.ss-lib-box');
  if (box) box.focus({ preventScroll: true });
}
function ssLibraryClose() {
  const el = SLU.el;
  if (!el || el.hidden) return;
  el.hidden = true;
  SLU.token++;
  slHideTip();
  document.documentElement.classList.remove('ss-lib-on');
  document.removeEventListener('keydown', slOnKey, true);
  if (location.hash === '#library') slDropHash();
  const b = SLU.back;
  SLU.back = null;
  if (b && typeof b.focus === 'function' && document.contains(b)) { try { b.focus({ preventScroll: true }); } catch (err) { /* 무시 */ } }
}
// 주소: #library → 열기 · #add-N → N번 전략을 바로 저장 전략으로 (그 뒤 주소에서 지움)
function ssLibraryFromHash() {
  const h = location.hash || '';
  if (h === '#library') { ssLibraryOpen(); return; }
  const m = /^#add-(\d+)$/.exec(h);
  if (!m) return;
  slDropHash();
  const e = SS_LIBRARY.find((x) => x.n === +m[1]);
  if (e && slRunnable(e) && DS.days) slTry(e);
}
