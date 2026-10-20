/* ── [STRATSIM] 투자전략 시뮬레이터 · 10 계산 엔진 ──────────────────────────
   ssRun9   : 9sig(목표선 리밸런싱) + 매수 후 보유 7종 + 적금 기준선(Invested Compounded)
   ssRunSma : 이동평균 추세 전략(SMA) — 버퍼·확인·RSI 과열/식음·버블 보험·분할 매수·T+N
   적립 일정 : ssSchedule (공식) — 실제 거래내역이 있으면 같은 모양의 일정을 대신 넘김      */

// 적립 일정: byMonth = 월말 거래일 기준 금액(9sig·보유·적금선), byDate/list = 달이 바뀐 첫 거래일(일별로 걷는 전략)
// 금액 = 매달 × (1+인상률)^(그해 − 시작 해)
function ssSchedule(monthly, raise, d0, d1) {
  const s = { byDate: new Map(), byMonth: new Map(), list: [], priceDateByMonth: new Map() };
  if (!(monthly > 0) || !d0 || !d1) return s;
  const y0 = +d0.slice(0, 4), amt = (d) => monthly * Math.pow(1 + (raise || 0), +d.slice(0, 4) - y0);
  if (DS.m) for (const r of DS.m) if (r[0] > d0 && r[0] <= d1) s.byMonth.set(r[0].slice(0, 7), amt(r[0]));
  if (DS.days) {
    const a = DS.idx.get(d0), b = DS.idx.get(d1);
    if (a != null && b != null) {
      let pm = null;
      for (let i = a; i <= b; i++) {
        const d = DS.days[i].date, mo = d.slice(0, 7);
        if (pm !== null && mo !== pm) { const v = amt(d); s.byDate.set(d, v); s.list.push({ date: d, amount: v }); }
        pm = mo;
      }
    }
  }
  return s;
}
// 사용자 전략에 넘기는 {날짜: 금액}
function ssContribObj(monthly, raise, d0, d1, sched) {
  const s = sched || (d0 && d1 ? ssSchedule(monthly, raise, d0, d1) : null), o = {};
  if (s && s.byDate) for (const [d, v] of s.byDate) o[d] = v;
  return o;
}
// from(제외) 다음 거래일부터 upto(제외) 전까지, 주의 마지막 거래일마다 fn(날)
function ssEachWeekEnd(from, upto, on, fn) {
  if (!on || !DS.days) return;
  const a = DS.idx.get(from), b = DS.idx.get(upto);
  if (a == null || b == null) return;
  for (let i = a + 1; i < b; i++) {
    const d = DS.days[i], nx = DS.days[i + 1];
    if (ssWeekLast(d.date, nx && nx.date)) fn(d);
  }
}
const ssIsQEndMonth = (d) => { const m = d.slice(5, 7); return m === '03' || m === '06' || m === '09' || m === '12'; };

// ── 9sig + 보유 + 적금선 ─────────────────────────────────────────────────
// o = { initial, monthly, raise, rate(전략 현금 연이율, 소수), baseRate(적금선, 없으면 rate),
//       qi0, qi1(분기 위치 — 진입은 '직전 분기말'로 이미 당겨 받음), period, rows(맞춤 기간 행), ed, xd(정확한 날짜),
//       sched, growth(0.09), crashDrop(30), crashMonths(24), spike(100, 0=끔), ul(열 1), cashPct(0.4),
//       spikeReset('auto'|%), deploy(0~1), buyPower(90), park('cash'), fromTarget, cost(%), sampleQ, sampleW, noBH }
function ssRun9(o) {
  const mRate = (o.rate || 0) / 12;
  const raise = o.raise || 0;
  const bRate = (o.baseRate != null ? +o.baseRate : (o.rate || 0)) / 12;
  const period = o.period || 'quarterly';
  const pRows = ssPeriodRows(period);
  let rows = o.rows || pRows || DS.q;
  let qi0 = o.qi0, qi1 = o.qi1;
  const growth = o.growth != null ? o.growth : 0.09;
  const crashDrop = o.crashDrop != null ? +o.crashDrop : 30;
  const crashKeep = 1 - crashDrop / 100;
  const crashMonths = o.crashMonths != null ? +o.crashMonths : 24;
  const spikePct = o.spike != null ? +o.spike : 100;
  const spikeAt = spikePct > 0 ? spikePct / 100 : Infinity;
  const ul = o.ul != null ? o.ul : 1;
  const cashPct = o.cashPct != null ? +o.cashPct : 0.4;
  const stockPct = 1 - cashPct;
  const sr = o.spikeReset;
  const resetTo = (sr == null || sr === 'auto' || sr === '') ? stockPct : +sr / 100;
  const deploy = Math.max(0, Math.min(1, o.deploy != null ? +o.deploy : 0));
  const power = Math.max(0, Math.min(1, (o.buyPower != null ? +o.buyPower : 90) / 100));
  const park = (o.park || 'cash').toLowerCase();
  const parkCol = SS_COL[park] != null ? SS_COL[park] : null;
  const cashPark = park === 'cash' || parkCol == null;
  const parkPx = (r) => (cashPark ? 1 : (r && r[parkCol]) || 0);
  const fromTarget = !!o.fromTarget;
  const cost = Math.max(0, +o.cost || 0) / 100;

  // 연간 = 진입일부터 12달마다(기념일) — 기념일 이하 마지막 월말 행. 청산일이 마지막 기념일보다 뒤면 '현재 평가' 행(리밸런스 안 함)
  let custom = false, snapAt = -1;
  if (period === 'yearly' && !o.rows) {
    const d0 = DS.q[qi0] && DS.q[qi0][0], d1 = DS.q[qi1] && DS.q[qi1][0];
    if (d0 && d1) {
      // 1년 뒤 같은 달·날 (없는 날은 Date.UTC 규칙대로 다음 달로 — 2/29 → 3/1)
      const nextYear = (iso) => new Date(Date.UTC(+iso.slice(0, 4) + 1, +iso.slice(5, 7) - 1, +iso.slice(8, 10))).toISOString().slice(0, 10);
      // 그 날짜 이하 마지막 월말 행 (없으면 null)
      const monthEndOnOrBefore = (iso) => { let k = -1; while (k + 1 < DS.m.length && DS.m[k + 1][0] <= iso) k++; return k < 0 ? null : DS.m[k]; };
      const roll = [];
      let anniv = d0;
      while (anniv <= d1) { const row = monthEndOnOrBefore(anniv); if (row) roll.push(row); anniv = nextYear(anniv); }
      const lastRoll = roll.length ? roll[roll.length - 1][0] : null;
      if (lastRoll !== null && d1 > lastRoll) {
        const tail = monthEndOnOrBefore(d1);
        if (tail && tail[0] > lastRoll) { roll.push(tail); snapAt = roll.length - 1; }
      }
      if (roll.length >= 2) { rows = roll; qi0 = 0; qi1 = roll.length - 1; custom = true; }
    }
  }
  // 분기 행이 아닌 행(주·월·연 기간 또는 맞춤 행)이면 진입·청산 날짜로 위치를 다시 찾음
  if (!custom && rows !== DS.q && ((period !== 'quarterly' && pRows) || o.rows)) {
    const d0 = o.ed || (DS.q[qi0] && DS.q[qi0][0]), d1 = o.xd || (DS.q[qi1] && DS.q[qi1][0]);
    if (d0 && d1) {
      let e = 0, x = rows.length - 1;
      for (let i = 0; i < rows.length; i++) { if (rows[i][0] <= d0) e = i; else break; }
      for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][0] >= d1) x = i; else break; }
      qi0 = e; qi1 = x;
    }
  }
  const fastMonths = rows === pRows || (period === 'quarterly' && rows === DS.q);
  const monthsOf = DS.mIn[period];
  const S = rows.slice(qi0, qi1 + 1);
  if (S.length < 2) return { log: [], samples: [], bh: {}, bhS: {}, contributed: o.initial };

  const initial = o.initial;
  let cash = initial * cashPct, parkSh = 0;
  if (!cashPark) { const p0 = parkPx(S[0]); parkSh = p0 > 0 ? cash / p0 : 0; }
  const fee0 = cost > 0 ? initial * stockPct * cost : 0;
  let sh = initial * stockPct * (1 - cost) / S[0][ul];
  let target = initial * stockPct;
  let prevHold = initial * stockPct * (1 - cost);
  let invested = initial, base = initial;
  const sched = o.sched || ssSchedule(o.monthly, raise, S[0][0], S[S.length - 1][0]);
  const log = [], samples = [];
  const sampleQ = !!o.sampleQ, sampleW = !!o.sampleW;
  let prevDate = S[0][0], crashSkips = 0, weekFrom = S[0][0];
  const ulKey = SS_KEY_OF[ul], parkKey = SS_KEY_OF[parkCol];
  const snap = (date, price, hv, c) => ({ date, price, holdVal: hv, cash: c, total: hv + c, target, invested, base });
  // 주간 표시 점: 지금 보유 그대로 그 주 마지막 거래일 종가로
  const fillWeeks = (upto) => {
    ssEachWeekEnd(weekFrom, upto, sampleW, (d) => {
      const px = ulKey ? d[ulKey] : 0;
      if (!(px > 0)) return;
      const c = cashPark ? cash : (parkKey && d[parkKey] > 0 ? parkSh * d[parkKey] : cash);
      samples.push(snap(d.date, px, sh * px, c));
    });
    weekFrom = upto;
  };
  const daysOf = (mk) => (sched.list && sched.list.length && DS.days)
    ? [...new Set(sched.list.filter(r => r.date.slice(0, 7) === mk).map(r => r.date))].filter(d => DS.idx.has(d)).sort() : [];

  for (let qi = 0; qi < S.length; qi++) {
    const qDate = S[qi][0], qPx = S[qi][ul];
    let fee = 0;
    if (qi === 0) {
      const hv = sh * S[0][ul];
      log.push({ date: qDate, price: S[0][ul], holdVal: hv, cash, total: hv + cash, act: { k: 'START' }, fee: fee0, invested, base, target });
      if (sampleQ || sampleW) samples.push(snap(qDate, S[0][ul], hv, cash));
      prevHold = hv; prevDate = qDate;
      continue;
    }
    let newMoney = 0;
    // 한 번의 적립(또는 인출)을 그 가격으로
    const putMoney = (px, d, mRow) => {
      const amt = sched.byDate.has(d) ? sched.byDate.get(d) : (sched.byMonth.get(d.slice(0, 7)) || 0);
      if (amt < 0) {
        let need = -amt;
        if (cashPark) { const c = Math.min(Math.max(cash, 0), need); cash -= c; need -= c; }
        else {
          const pp = mRow ? (mRow[parkCol] || 0) : 0, pv = pp > 0 ? parkSh * pp : 0, c = Math.min(pv, need);
          if (c > 0 && pp > 0) parkSh -= c / pp;
          need -= c;
        }
        if (need > 0 && px > 0 && sh > 0) {
          const g = Math.min(sh * px, need / (1 - cost));
          sh -= g / px; fee += g * cost; need -= g * (1 - cost);
        }
        if (cashPark) cash *= 1 + mRate;
      } else {
        const toStock = amt * deploy, toPark = amt - toStock;
        if (toStock > 0 && px > 0) { sh += toStock * (1 - cost) / px; fee += toStock * cost; }
        if (cashPark) { cash += (toStock > 0 && px > 0) ? toPark : amt; cash *= 1 + mRate; }
        else if (toPark > 0) {
          const pp = mRow ? (mRow[parkCol] || 0) : 0;
          if (pp > 0) parkSh += toPark / pp; else cash += toPark;
        }
      }
      invested += amt; newMoney += amt; base += amt;
      if (sampleQ && d && d < qDate && px > 0 && ssIsQEndMonth(d)) {
        const c = cashPark ? cash : (mRow && mRow[parkCol] > 0 ? parkSh * mRow[parkCol] : cash);
        samples.push(snap(d, px, sh * px, c));
      }
    };
    // 한 달: 적금선은 달마다 한 번 이자 → 실제 거래내역이면 그달 거래 날짜마다 그날 가격, 아니면 월말 행으로 한 번
    const doMonth = (mRow) => {
      base *= 1 + bRate;
      const days = daysOf(mRow[0].slice(0, 7));
      if (days.length) {
        for (const d of days) {
          fillWeeks(d);
          const dp = ulKey ? DS.days[DS.idx.get(d)][ulKey] : 0;
          putMoney(dp > 0 ? dp : mRow[ul], d, mRow);
          if ((sampleW || sampleQ) && dp > 0) {
            const c = cashPark ? cash : (mRow[parkCol] > 0 ? parkSh * mRow[parkCol] : cash);
            samples.push(snap(d, dp, sh * dp, c));
          }
        }
        fillWeeks(mRow[0]);
      } else {
        fillWeeks(mRow[0]);
        putMoney(mRow[ul], mRow[0], mRow);
      }
    };
    if (fastMonths) for (const mi of monthsOf[qi0 + qi]) doMonth(DS.m[mi]);
    else for (const r of DS.m) if (r[0] > prevDate && r[0] <= qDate) doMonth(r);
    fillWeeks(qDate);
    if (!cashPark) { const pp = parkPx(S[qi]); if (pp > 0) cash = parkSh * pp; }

    let act;
    if (qi !== snapAt) {
      target = (fromTarget ? target : prevHold) * (1 + growth) + newMoney * 0.5;
      const diff = sh * qPx - target;
      // 폭락 판단: 최근 crashMonths 개월 안 최고가의 (1−crashDrop) 아래면 매도 보류(최대 2번)
      const tm = +qDate.slice(0, 4) * 12 + (+qDate.slice(5, 7) - 1) - crashMonths;
      const since = String(Math.floor(tm / 12)).padStart(4, '0') + '-' + String((tm % 12 + 12) % 12 + 1).padStart(2, '0') + qDate.slice(7);
      let hi = qPx;
      for (let k = qi; k >= 0; k--) { if (S[k][0] < since) break; if (S[k][ul] > hi) hi = S[k][ul]; }
      const crash = qPx < hi * crashKeep;
      const pNow = parkPx(S[qi]);
      const toPark = (v) => { cash += v; if (!cashPark && pNow > 0) parkSh += v / pNow; };
      const fromPark = (v) => { cash -= v; if (!cashPark && pNow > 0) parkSh -= v / pNow; };
      if (diff > 0 && (!crash || crashSkips >= 2)) {
        sh -= diff / qPx; toPark(diff * (1 - cost)); fee += diff * cost;
        act = { k: 'SELL', amt: diff, late: crash };
        crashSkips = 0;
      } else if (diff > 0) {
        crashSkips++;
        act = { k: 'HOLD', crash: crashSkips };
      } else if (diff < 0 && cash > 0) {
        crashSkips = 0;
        const buy = Math.min(-diff, cash * power);
        if (buy > 0) {
          sh += buy * (1 - cost) / qPx; fromPark(buy); fee += buy * cost;
          act = { k: 'BUY', amt: buy, part: buy < -diff };
        } else act = { k: 'HOLD' };
      } else { crashSkips = 0; act = { k: 'HOLD' }; }
      // 급등 리셋: 이번 기간 spike% 이상 오르고 주식 비중이 리셋 비중~100% 이고 폭락 구간이 아니면 리셋 비중으로 되돌림
      const pp = S[qi - 1][ul];
      const gain = pp > 0 ? (qPx - pp) / pp : 0;
      const hv = sh * qPx, tot = hv + cash, w = tot > 0 ? hv / tot : 0;
      if (gain >= spikeAt && w >= resetTo && w <= 1 && !crash) {
        const keep = tot * resetTo, cut = hv - keep;
        sh = keep / qPx;
        cash = tot - keep - cut * cost; fee += cut * cost;
        if (!cashPark && pNow > 0) parkSh = cash / pNow;
        target = keep;
        act = { k: 'RESET', amt: cut };
      }
    } else act = { k: 'SNAPSHOT' };

    const hv = sh * qPx;
    log.push({ date: qDate, price: qPx, holdVal: hv, cash, total: hv + cash, act, fee, invested, base, target });
    if (sampleQ || sampleW) samples.push(snap(qDate, qPx, hv, cash));
    prevHold = hv; prevDate = qDate;
  }
  if (o.noBH) return { log, samples, bh: {}, bhS: {}, contributed: invested };

  // 매수 후 보유(한 종목): 시작에 전부 사고, 적립금은 그달 가격으로 계속 삼
  const holdOnly = (col, needPx) => {
    const pts = [], smp = [];
    let n = S[0][col] ? initial / S[0][col] : 0, pd = S[0][0], wf = S[0][0];
    const key = SS_KEY_OF[col];
    const weeks = (upto) => { ssEachWeekEnd(wf, upto, sampleW && !!key, (d) => { if (d[key] > 0) smp.push({ date: d.date, value: n * d[key] }); }); wf = upto; };
    const month = (mRow) => {
      const days = daysOf(mRow[0].slice(0, 7));
      if (days.length) {
        for (const d of days) {
          weeks(d);
          const dp = key ? DS.days[DS.idx.get(d)][key] : null;
          const px = dp > 0 ? dp : mRow[col];
          const amt = sched.byDate.get(d) || 0;
          if (needPx ? px : true) n += amt / px;
          if ((sampleW || sampleQ) && dp > 0) smp.push({ date: d, value: n * dp });
        }
        weeks(mRow[0]);
      } else {
        weeks(mRow[0]);
        const amt = sched.byMonth.get(mRow[0].slice(0, 7)) || 0, px = mRow[col];
        if (needPx ? px : true) n += amt / px;
        if (sampleQ && px > 0 && ssIsQEndMonth(mRow[0])) smp.push({ date: mRow[0], value: n * px });
      }
    };
    if ((sampleQ || sampleW) && S[0][col]) smp.push({ date: S[0][0], value: n * S[0][col] });
    for (let qi = 0; qi < S.length; qi++) {
      const qd = S[qi][0], qp = S[qi][col];
      if (qi > 0 && (!needPx || qp)) {
        if (fastMonths) for (const mi of monthsOf[qi0 + qi]) month(DS.m[mi]);
        else for (const r of DS.m) if (r[0] > pd && r[0] <= qd) month(r);
        weeks(qd);
        if (sampleW && qp) smp.push({ date: qd, value: n * qp });
      }
      pts.push({ date: qd, value: qp ? n * qp : 0, price: qp, shares: n });
      pd = qd;
    }
    return { pts, smp };
  };
  const bh = {}, bhS = {};
  // TQQQ·QQQ 는 가격이 0인 기간도 적립을 셈(원본과 같게), 나머지는 그 기간 가격이 있어야
  [['tqqq', false], ['qqq', false], ['spy', true], ['qld', true], ['sso', true], ['spxl', true], ['sqqq', true]].forEach(([a, need]) => {
    const r = holdOnly(SS_COL[a], need);
    bh[a] = r.pts; bhS[a] = r.smp;
  });
  return { log, samples, bh, bhS, contributed: invested };
}

// ── SMA 추세 전략 ───────────────────────────────────────────────────────
// o = { initial, monthly, raise, rate(현금 연이율, 소수), qi0, qi1, ed, xd, sched,
//       signal('qqq'), win(200), ul(열 1), entryBuf, exitBuf(%), ohRsi, coolRsi(0=끔), ohWin, coolWin(10),
//       out('cash'), easeIn, easeOut(거래일 수), bubble(%, 0=끔), bubbleAsset, bubbleWin, cost(%),
//       check('daily'|'monthly'), confirmBuy, confirmSell, settle(거래일), dd(낙폭 기준점), sampleW }
function ssRunSma(o) {
  const sig = (o.signal || 'qqq').toLowerCase();
  const win = +o.win || 200;
  const ul = o.ul != null ? +o.ul : 1;
  const entryBuf = (+o.entryBuf || 0) / 100, exitBuf = (+o.exitBuf || 0) / 100;
  const ohLevel = +o.ohRsi || 0, coolLevel = +o.coolRsi || 0;
  const outA = (o.out || 'cash').toLowerCase();
  const easeIn = Math.max(0, +o.easeIn || 0), easeOut = Math.max(0, +o.easeOut || 0);
  const bubble = +o.bubble || 0;
  const cost = Math.max(0, +o.cost || 0) / 100;
  const ohWin = +o.ohWin || 10, coolWin = +o.coolWin || 10;
  const daily = (o.check || 'monthly') === 'daily';
  const cBuy = Math.max(0, +o.confirmBuy || 0), cSell = Math.max(0, +o.confirmSell || 0);
  const settle = Math.max(0, +o.settle || 0);
  const mRate = (o.rate || 0) / 12;
  const initial = o.initial;
  const none = { points: [], log: [], dd: null, contributed: initial };
  if (!DS.m || !DS.q) return none;
  const smaAt = ssInd('sma', sig, win, !daily);
  if (!smaAt) return none;
  const steps = daily ? DS.rows : DS.m;
  const ohAt = ssInd('rsi', sig, ohWin, !daily), coolAt = ssInd('rsi', sig, coolWin, !daily);
  const d0 = o.ed || DS.q[o.qi0][0], d1 = o.xd || DS.q[o.qi1][0];
  const sched = o.sched || ssSchedule(o.monthly, o.raise || 0, d0, d1);
  const sigCol = SS_COL[sig] || 2;
  const ulName = SS_ASSETS.find(a => SS_COL[a] === ul) || 'tqqq';
  const bgA = (o.bubbleAsset || SS_UNLEV[ulName] || 'qqq').toLowerCase();
  const bgCol = SS_COL[bgA] || SS_COL.qqq;
  const bgWin = +o.bubbleWin || win;
  const bgSma = bubble > 0 ? ssInd('sma', bgA, bgWin, !daily) : null;

  let a = 0;
  while (a < steps.length && steps[a][0] < d0) a++;
  let b = steps.length - 1;
  while (b >= 0 && steps[b][0] > d1) b--;
  if (a > b) return none;

  // 추세 판단 (들고 있을 때 / 나와 있을 때)
  const judge = (st, px, avg, ohV, coolV) => {
    if (avg == null || px <= 0) return st;
    const hot = ohLevel > 0 && ohV != null && ohV >= ohLevel;
    if (st === 'in') return hot ? 'out' : (px < avg * (1 - exitBuf) ? 'out' : 'in');
    if (hot) return 'out';
    if (coolLevel > 0 && coolV != null && coolV >= coolLevel) return 'out';
    return px > avg * (1 + entryBuf) ? 'in' : 'out';
  };
  const bubbleState = (px, avg) => (!avg || avg <= 0 || px <= 0) ? 'normal' : (bubble > 0 && (px / avg - 1) * 100 >= bubble ? 'gtfo' : 'normal');
  const wantAsset = (st, bg) => (bg === 'gtfo' ? 'cash' : st === 'out' ? outA : ulName);

  const r0 = steps[a];
  let state = smaAt[a] == null ? 'in' : ((r0[sigCol] || 0) > smaAt[a] ? 'in' : 'out');
  if (state === 'in' && ohLevel > 0 && ohAt && ohAt[a] != null && ohAt[a] >= ohLevel) state = 'out';
  let pend = state, pendN = 0;
  let bg = bubbleState(r0[bgCol] || 0, bgSma ? bgSma[a] : null);
  let byBubble = bg === 'gtfo';
  const sh = { tqqq: 0, qqq: 0, spy: 0, qld: 0, sso: 0, spxl: 0, sqqq: 0 };
  let cash = initial, invested = initial, lastAmt = 0;
  const px = (row, k) => { const c = SS_COL[k]; return c != null ? (row[c] || 0) : 0; };
  let tgt = wantAsset(state, bg);
  if (tgt !== 'cash') { const p0 = px(r0, tgt); if (p0 > 0) { sh[tgt] = cash * (1 - cost) / p0; cash = 0; } }
  let ease = 0, lastSell = a - 1e9, lastBuy = a - 1e9;
  const value = (row) => { let v = 0; for (const k of SS_ASSETS) if (sh[k] > 0) v += sh[k] * (px(row, k) || 0); return v + cash; };
  const biggest = (row) => { let best = 'cash', bv = cash; for (const k of SS_ASSETS) if (sh[k] > 0) { const v = sh[k] * (px(row, k) || 0); if (v > bv) { bv = v; best = k; } } return best; };
  const shSum = () => sh.tqqq + sh.qqq + sh.spy + sh.qld + sh.sso + sh.spxl + sh.sqqq;
  const holding = () => { const h = {}; for (const k of SS_ASSETS) if (sh[k] > 0) h[k] = sh[k]; return h; };
  let held = biggest(r0);
  const points = [{ date: r0[0], value: value(r0), state }];
  const ul0 = r0[ul] || 0;
  const log = [{ date: r0[0], state, held, action: 'START', fee: held !== 'cash' ? initial * cost : 0, price: ul0, shares: shSum(), stockVal: value(r0) - cash, cash, total: value(r0), invested: initial }];
  const qEnd = new Set();
  for (let q = o.qi0; q <= o.qi1; q++) qEnd.add(DS.q[q][0]);
  const dd = o.dd ? [{ date: r0[0], h: holding(), cash }] : null;
  let ready = tgt === 'cash' ? true : (ul0 > 0 && px(r0, tgt) > 0);
  let pMonth = r0[0].slice(0, 7);

  for (let m = a + 1; m <= b; m++) {
    const row = steps[m], d = row[0], ulPx = row[ul] || 0;
    const mo = d.slice(0, 7), newMonth = mo !== pMonth;
    pMonth = mo;
    if (newMonth && cash > 0) cash *= 1 + mRate;
    const moneyDay = sched.byDate.has(d);
    if (moneyDay) {
      lastAmt = sched.byDate.get(d) || 0;
      invested += lastAmt;
      if (lastAmt < 0) {
        let need = -lastAmt;
        const c = Math.min(Math.max(cash, 0), need);
        cash -= c; need -= c;
        if (need > 0) for (const k of SS_ASSETS) {
          if (need <= 0 || sh[k] <= 0) continue;
          const p = px(row, k);
          if (p <= 0) continue;
          const g = Math.min(sh[k] * p, need / (1 - cost));
          sh[k] -= g / p; need -= g * (1 - cost);
        }
      } else cash += lastAmt;
    }
    // 확인 필터: 바뀐 신호가 정한 횟수만큼 이어져야 실제로 바꿈
    const bgBefore = bg;
    const want = judge(state, row[sigCol] || 0, smaAt[m], ohAt ? ohAt[m] : null, coolAt ? coolAt[m] : null);
    if (want !== state) {
      if (want === pend) pendN++; else { pend = want; pendN = 1; }
      const need = want === 'in' ? cBuy : cSell;
      if (need <= 1 || pendN >= need) { state = want; pendN = 0; }
    } else { pend = state; pendN = 0; }
    bg = bubbleState(row[bgCol] || 0, bgSma ? bgSma[m] : null);
    const before = tgt;
    tgt = wantAsset(state, bg);
    if (!ready) ready = tgt === 'cash' || px(row, tgt) > 0;
    const canSell = settle === 0 || m - lastBuy >= settle;
    if (tgt !== before) ease = (tgt === 'cash' || bg !== 'normal' || bgBefore !== 'normal') ? 0 : (tgt === ulName ? easeIn || 0 : easeOut || 0);
    let sellFee = 0, sold = false;
    if (canSell) {
      for (const k of SS_ASSETS) {
        if (k !== tgt && sh[k] > 0) {
          const p = px(row, k);
          if (p > 0) { const v = sh[k] * p; cash += v * (1 - cost); sellFee += v * cost; sh[k] = 0; sold = true; }
        }
      }
      if (sold) lastSell = m;
    }
    const entry = (action, h, fee, extra) => {
      const r = { date: d, state, held: h, action, fee: fee || 0, price: ulPx, shares: shSum(), stockVal: value(row) - cash, cash, total: value(row), invested };
      if (extra != null) r.contribAmt = extra;
      log.push(r);
    };
    let traded = false;
    if (sold) { entry(bg === 'gtfo' ? 'BG-GTFO' : 'EXIT', 'cash', sellFee); held = 'cash'; byBubble = bg === 'gtfo'; traded = true; }
    const canBuy = settle === 0 || m - lastSell >= settle;
    if (canBuy && ready && tgt !== 'cash' && cash > 0) {
      const p = px(row, tgt);
      if (p > 0) {
        const easing = ease > 0;
        let amt;
        if (ease > 1) { amt = cash * (1 / ease); sh[tgt] += amt * (1 - cost) / p; cash -= amt; ease--; }
        else { amt = cash; sh[tgt] += amt * (1 - cost) / p; cash = 0; if (ease === 1) ease = 0; }
        lastBuy = m;
        const topUp = held === tgt;
        if (topUp && !easing && moneyDay) entry('CONTRIB', tgt, amt * cost, lastAmt);
        else {
          entry(topUp ? 'DCA-ADD' : byBubble ? 'BG-CLEAR' : (tgt === ulName ? 'ENTER' : 'EXIT'), tgt, amt * cost);
          held = tgt;
          if (!topUp) byBubble = false;
        }
        traded = true;
      }
    }
    if (!traded && moneyDay && lastAmt > 0) entry('CONTRIB', held, 0, lastAmt);
    if (dd) dd.push({ date: d, h: holding(), cash });
    if (qEnd.has(d) || (o.sampleW && ssWeekLast(d, steps[m + 1] && steps[m + 1][0]))) points.push({ date: d, value: value(row), state });
  }
  const last = steps[b];
  if (last && (!log.length || log[log.length - 1].date !== last[0])) {
    log.push({ date: last[0], state, held: biggest(last), action: 'END', fee: 0, price: last[ul] || 0, shares: shSum(), stockVal: value(last) - cash, cash, total: value(last), invested });
  }
  return { points, log, dd, contributed: invested };
}
