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
  let rows = o.rows || null;
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

  // 기간 행 (2026-11-28 — 분기 번호로 고른 기간과 정확한 날짜로 고른 기간이 같은 규칙 · 같은 날이면 같은 숫자)
  //   매주·매달·매 분기 = 진입일 행 + 그 사이 기간 끝 행 + 청산일 행 (ssExactRows)
  //     예전 분기 번호의 매주는 진입 이하 마지막 주말 행 ~ 청산 이상 첫 주말 행이라 고른 기간보다 앞뒤로 며칠 넓었음(원본과 같았음)
  //   매년 = 진입일부터 1년마다 기념일(진입일이 달의 마지막 거래일이면 해마다 같은 달 마지막 거래일 · 아니면 같은 날 이하 마지막 거래일)
  //          + 마지막 기념일 뒤 청산일은 '현재 평가' 행(리밸런스 안 함) (ssAnnivRows)
  //   분기 번호의 매 분기는 예전 그대로 DS.q 위치 · rows 를 받으면(리밸런스 시점 옮김 등) 그 행에서 진입·청산 날짜로 위치를 찾음
  let snapAt = -1;
  const dE = o.ed || (DS.q[qi0] && DS.q[qi0][0]), dX = o.xd || (DS.q[qi1] && DS.q[qi1][0]);
  if (!o.rows) {
    let own = null;
    if (dE && dX) {
      if (period === 'yearly') { const a = ssAnnivRows(dE, dX); if (a.rows.length >= 2) { own = a.rows; snapAt = a.snapAt; } }
      else if (period !== 'quarterly' || o.ed || o.xd) { const q = ssExactRows(period, dE, dX); if (q.length >= 2) own = q; }
    }
    if (own) { rows = own; qi0 = 0; qi1 = own.length - 1; } else rows = DS.q;
  } else if (rows !== DS.q && dE && dX) {
    let e = 0, x = rows.length - 1;
    for (let i = 0; i < rows.length; i++) { if (rows[i][0] <= dE) e = i; else break; }
    for (let i = rows.length - 1; i >= 0; i--) { if (rows[i][0] >= dX) x = i; else break; }
    qi0 = e; qi1 = x;
  }
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
  // 마지막 행 날짜가 달 중간(그달 거래일이 더 남음)이면 그달 실제 거래내역 입금일 중 그 날까지 — 월말 행이 그 뒤라 달 처리에서 빠지는 것
  const tailDays = (qDate) => {
    if (!(sched.list && sched.list.length) || !DS.days) return [];
    const i = DS.idx.get(qDate), nx = i != null ? DS.days[i + 1] : null, mk = qDate.slice(0, 7);
    if (!nx || nx.date.slice(0, 7) !== mk) return [];
    return daysOf(mk).filter((d) => d <= qDate && d > S[0][0]);
  };

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
    { const [lo, hi] = ssMonthSpan(prevDate, qDate); for (let mi = lo; mi < hi; mi++) doMonth(DS.m[mi]); }
    // 마지막 행이 달 중간(정확한 청산일 · 주 단위 · 리밸런스 시점 옮김)이면 그달 월말 행은 위에서 안 돎 →
    // 실제 거래내역의 그달 입금 중 이 날까지 것을 그날 가격으로 넣음 (이자는 달마다라 덜 찬 달은 없음 · 공식 적립은 월말 금액이라 없음)
    if (qi === S.length - 1) for (const d of tailDays(qDate)) {
      fillWeeks(d);
      const row = DS.rows[DS.idx.get(d)], dp = ulKey ? DS.days[DS.idx.get(d)][ulKey] : 0;
      putMoney(dp > 0 ? dp : qPx, d, row);
      if ((sampleW || sampleQ) && dp > 0) {
        const c = cashPark ? cash : (row[parkCol] > 0 ? parkSh * row[parkCol] : cash);
        samples.push(snap(d, dp, sh * dp, c));
      }
    }
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
  //  분배금 원천징수(o.bhWht · 2026-11-28): 주식 수 = 기준 주식 수 n × 그날 누적 배수(ssWhtFactor) — 원천징수가 없으면 배수 1(예전과 같은 값)
  const holdOnly = (col, needPx) => {
    const pts = [], smp = [];
    const key = SS_KEY_OF[col], WF = key ? ssWhtFactor(key, +o.bhWht || 0) : null;
    const fAt = WF ? (d) => { const i = DS.idx.get(d); return i == null ? 1 : WF[i]; } : () => 1;
    let n = S[0][col] ? initial / S[0][col] / fAt(S[0][0]) : 0, pd = S[0][0], wf = S[0][0];
    const weeks = (upto) => { ssEachWeekEnd(wf, upto, sampleW && !!key, (d) => { if (d[key] > 0) smp.push({ date: d.date, value: n * fAt(d.date) * d[key] }); }); wf = upto; };
    const month = (mRow) => {
      const days = daysOf(mRow[0].slice(0, 7));
      if (days.length) {
        for (const d of days) {
          weeks(d);
          const dp = key ? DS.days[DS.idx.get(d)][key] : null;
          const px = dp > 0 ? dp : mRow[col];
          const amt = sched.byDate.get(d) || 0;
          if (needPx ? px : true) n += amt / px / fAt(d);
          if ((sampleW || sampleQ) && dp > 0) smp.push({ date: d, value: n * fAt(d) * dp });
        }
        weeks(mRow[0]);
      } else {
        weeks(mRow[0]);
        const amt = sched.byMonth.get(mRow[0].slice(0, 7)) || 0, px = mRow[col];
        if (needPx ? px : true) n += amt / px / fAt(mRow[0]);
        if (sampleQ && px > 0 && ssIsQEndMonth(mRow[0])) smp.push({ date: mRow[0], value: n * fAt(mRow[0]) * px });
      }
    };
    if ((sampleQ || sampleW) && S[0][col]) smp.push({ date: S[0][0], value: n * fAt(S[0][0]) * S[0][col] });
    for (let qi = 0; qi < S.length; qi++) {
      const qd = S[qi][0], qp = S[qi][col];
      if (qi > 0 && (!needPx || qp)) {
        { const [lo, hi] = ssMonthSpan(pd, qd); for (let mi = lo; mi < hi; mi++) month(DS.m[mi]); }
        // 마지막 행이 달 중간이면 실제 거래내역의 그달 그 날까지 입금도 (9sig 쪽과 같은 규칙)
        if (qi === S.length - 1) for (const d of tailDays(qd)) {
          weeks(d);
          const dp = key ? DS.days[DS.idx.get(d)][key] : null, px = dp > 0 ? dp : qp, amt = sched.byDate.get(d) || 0;
          if (needPx ? px : true) n += amt / px / fAt(d);
          if ((sampleW || sampleQ) && dp > 0) smp.push({ date: d, value: n * fAt(d) * dp });
        }
        weeks(qd);
        if (sampleW && qp) smp.push({ date: qd, value: n * fAt(qd) * qp });
      }
      const nq = n * fAt(qd);
      pts.push({ date: qd, value: qp ? nq * qp : 0, price: qp, shares: nq });
      pd = qd;
    }
    return { pts, smp };
  };
  const bh = {}, bhS = {};
  // TQQQ·QQQ 는 가격이 0인 기간도 적립을 셈(원본과 같게), 나머지는 그 기간 가격이 있어야
  [['tqqq', false], ['qqq', false], ['spy', true], ['qld', true], ['sso', true], ['spxl', true], ['sqqq', true], ['soxl', true], ['soxx', true], ['tecl', true], ['xlk', true]].forEach(([a, need]) => {
    const r = holdOnly(SS_COL[a], need);
    bh[a] = r.pts; bhS[a] = r.smp;
  });
  return { log, samples, bh, bhS, contributed: invested };
}

// ── 세금 (2026-11-28 — 양도세 22% · 분배금 미국 원천징수 15% 선택 · SMA 추세 · 그냥 보유) ──────────
// 해외주식 양도세 장부 — SMA 200 백테스트 엔진(SMB · 자동매매 프로그램)과 같은 규칙:
//   선입선출 · 원화 손익(사고판 금액 × 결제일 원/달러) · 결제일(2024-05-28 전 T+2, 그 뒤 T+1)이 속한 해 ·
//   해마다 (손익 − 250만 원) × 세율 · 이듬해 5월 1일(그날 또는 뒤 첫 거래일)에 냄 — 계산은 엔진(ssRunSma)이 함
const SS_TAX_DED = 2500000;
function ssTaxBook(rate) {
  const N = DS.days.length, lots = {}, gain = {}, list = [];
  const settleIdx = (i) => i + (DS.days[i].date < '2024-05-28' ? 2 : 1);
  const yearOf = (i) => {
    const j = settleIdx(i);
    if (j < N) return +DS.days[j].date.slice(0, 4);
    const t = new Date(DS.days[N - 1].date + 'T12:00:00Z');   // 자료 끝 뒤 결제일 = 평일로 셈
    let m = j - (N - 1);
    while (m > 0) { t.setUTCDate(t.getUTCDate() + 1); if (t.getUTCDay() % 6) m--; }
    return t.getUTCFullYear();
  };
  const fxAt = (i) => ssFx(Math.min(N - 1, settleIdx(i)));
  return {
    rate, lots, gain, list, yearOf, fxAt,
    buy(i, k, q, usd) { if (!(q > 0)) return; const w = usd * fxAt(i); (lots[k] = lots[k] || []).push([q, w / q]); },
    sell(i, k, q, usd) {
      if (!(q > 0)) return 0;
      const w = usd * fxAt(i), L = lots[k] || [];
      let base = 0, need = q;
      while (need > 1e-12 && L.length) { const x = L[0], t = Math.min(need, x[0]); base += t * x[1]; x[0] -= t; need -= t; if (x[0] <= 1e-12) L.shift(); }
      const y = yearOf(i); gain[y] = (gain[y] || 0) + w - base; return w - base;
    },
    // 분배락일: 들고 있던 몫 중 (1 − g)는 원래 묶음(수량만 줄고 원가 그대로) · 다시 산 몫 keep × g 는 새 묶음(원가 = 그날 가격)
    //  (수정주가는 분배금을 그날 다시 산 것으로 봄 — 그 몫까지 양도 차익으로 세지 않게)
    div(i, k, g, keep, sh0, px) {
      const L = lots[k];
      if (L) for (const x of L) { x[0] *= 1 - g; x[1] /= 1 - g; }
      const q = keep * g * sh0;
      if (q > 0) (lots[k] = lots[k] || []).push([q, px * fxAt(i)]);
    },
    yearEnd(m, b) {
      if (m < b && yearOf(m + 1) !== yearOf(m)) { const y = yearOf(m), g = gain[y] || 0; list.push({ y, gain: g, tax: Math.max(0, g - SS_TAX_DED) * rate, paid: null }); }
    },
    basis(k) { return (lots[k] || []).reduce((a, x) => a + x[0] * x[1], 0); },
  };
}
// 분배금 원천징수 몫 g = 분배금 ÷ 전날 종가 × (전날 ÷ 그날 수정 종가) — 그날 평가금 중 분배금(다시 산 것으로 친 몫)의 비율
const ssDivShare = (key, i) => {
  const Y = DS.divY && DS.divY[key], y = Y ? Y[i] : 0;
  if (!(y > 0) || i < 1) return 0;
  const p0 = DS.days[i - 1][key], p1 = DS.days[i][key];
  return p0 > 0 && p1 > 0 ? y * p0 / p1 : 0;
};
// 그냥 보유 선의 원천징수: 날짜 위치마다 누적 배수 Π(1 − 원천징수율 × g) — 주식 수 = 기준 주식 수 × 배수 (없으면 null = 1)
function ssWhtFactor(key, w) {
  if (!(w > 0) || !DS.divY || !DS.divY[key]) return null;
  const ck = key + '|' + w;
  if (DS.whtF[ck]) return DS.whtF[ck];
  const N = DS.days.length, out = new Float64Array(N);
  let f = 1;
  for (let i = 0; i < N; i++) { const g = ssDivShare(key, i); if (g > 0) f *= 1 - w * g; out[i] = f; }
  return (DS.whtF[ck] = out);
}
// 그냥 보유의 세금 요약 — 팔지 않으므로 해마다 내는 양도세는 없음 · 끝 날 전부 판다고 보고 그해 한 번 공제(250만 원)
//   원가 = 넣은 돈 × 그날 결제 환율 + 분배금 다시 산 몫 · 중간에 뺀 돈(실제 거래내역)은 평균 단가로 뺀 손익을 끝 날 손익에 더함
//   o = { key, d0, d1, initial, sched, wht(소수), tax(소수) } → { wht: 낸 원천징수($), due: 끝에 다 팔면 낼 양도세($), liq: 낸 뒤 금액($), end: 끝 평가금($) }
function ssBhTaxEnd(o) {
  const key = o.key, i0 = DS.idx.get(o.d0), i1 = DS.idx.get(o.d1);
  if (i0 == null || i1 == null || i1 < i0) return null;
  const P = (i) => DS.days[i][key] || 0, book = o.tax > 0 ? ssTaxBook(o.tax) : null, w = o.wht || 0, sched = o.sched;
  let n = P(i0) > 0 ? o.initial / P(i0) : 0, basis = book ? o.initial * book.fxAt(i0) : 0, real = 0, wht = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    const p = P(i);
    if (!(p > 0)) continue;
    const g = n > 0 ? ssDivShare(key, i) : 0;
    if (g > 0) {
      if (book) basis += (1 - w) * g * n * p * book.fxAt(i);
      wht += w * g * n * p; n *= 1 - w * g;
    }
    const amt = sched && sched.byDate ? sched.byDate.get(DS.days[i].date) || 0 : 0;
    if (amt > 0) { n += amt / p; if (book) basis += amt * book.fxAt(i); }
    else if (amt < 0 && n > 0) {
      const f = Math.min(1, -amt / (n * p));
      if (book) { real += f * (n * p * book.fxAt(i) - basis); basis *= 1 - f; }
      n *= 1 - f;
    }
  }
  const end = n * P(i1);
  let due = 0;
  if (book) { const gainK = end * book.fxAt(i1) + real - basis; due = Math.max(0, gainK - SS_TAX_DED) * o.tax / ssFx(i1); }
  return { wht, due, liq: end - due, end };
}

// ── SMA 추세 전략 ───────────────────────────────────────────────────────
// o = { initial, monthly, raise, rate(현금 연이율, 소수), qi0, qi1, ed, xd, sched,
//       signal('qqq'), win(200), ul(열 1), entryBuf, exitBuf(%), ohRsi, coolRsi(0=끔), ohWin, coolWin(10),
//       out('cash'), easeIn, easeOut(거래일 수), bubble(%, 0=끔), bubbleAsset, bubbleWin, cost(%),
//       check('daily'|'monthly'), confirmBuy, confirmSell, settle(거래일), dd(낙폭 기준점), sampleW,
//       taxRate(양도세 · 소수 0.22), whtRate(분배금 원천징수 · 소수 0.15) — 2026-11-28 · 매일 확인일 때만(편집 창 SMA 는 늘 매일) }
//   세금: SMA 200 백테스트 엔진 SMB 시뮬 방식(tax)과 같은 계산 — 판 금액·산 금액의 원화 손익 · 이듬해 5월 1일 납부(현금이 모자라면
//   종목 순서대로 모자란 만큼 팔아서) · 분배금은 수정주가에 든 몫에서 원천징수만 뺌(그 날 아침 들고 있던 주식) · 결과 r.tax
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
  const taxRate = daily ? Math.max(0, +o.taxRate || 0) : 0, whtRate = daily ? Math.max(0, +o.whtRate || 0) : 0;
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
  const sh = { tqqq: 0, qqq: 0, spy: 0, qld: 0, sso: 0, spxl: 0, sqqq: 0, soxl: 0, soxx: 0, tecl: 0, xlk: 0 };
  let cash = initial, invested = initial, lastAmt = 0;
  const px = (row, k) => { const c = SS_COL[k]; return c != null ? (row[c] || 0) : 0; };
  let tgt = wantAsset(state, bg);
  const book = taxRate > 0 ? ssTaxBook(taxRate) : null, divOn = (taxRate > 0 || whtRate > 0) && !!DS.divY;
  let taxPaid = 0, taxExt = 0, whtPaid = 0;
  if (tgt !== 'cash') { const p0 = px(r0, tgt); if (p0 > 0) { sh[tgt] = cash * (1 - cost) / p0; if (book) book.buy(a, tgt, sh[tgt], cash); cash = 0; } }
  let ease = 0, lastSell = a - 1e9, lastBuy = a - 1e9;
  const value = (row) => { let v = 0; for (const k of SS_ASSETS) if (sh[k] > 0) v += sh[k] * (px(row, k) || 0); return v + cash - taxExt; };   // taxExt = 팔 것이 없어 못 낸 양도세(빚)
  const biggest = (row) => { let best = 'cash', bv = cash; for (const k of SS_ASSETS) if (sh[k] > 0) { const v = sh[k] * (px(row, k) || 0); if (v > bv) { bv = v; best = k; } } return best; };
  const shSum = () => sh.tqqq + sh.qqq + sh.spy + sh.qld + sh.sso + sh.spxl + sh.sqqq + sh.soxl + sh.soxx + sh.tecl + sh.xlk;
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
    // 분배락일: 그날 아침 들고 있던 주식 — 수정주가에 든 분배금 몫에서 원천징수를 뺌 · 양도세 원가를 다시 산 몫으로 나눔
    if (divOn) for (const k of SS_ASSETS) {
      if (!(sh[k] > 0)) continue;
      const g = ssDivShare(k, m);
      if (!(g > 0)) continue;
      const sh0 = sh[k];
      if (book) book.div(m, k, g, 1 - whtRate, sh0, px(row, k));
      if (whtRate > 0) { whtPaid += whtRate * g * sh0 * px(row, k); sh[k] = sh0 * (1 - whtRate * g); }
    }
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
          if (book) book.sell(m, k, g / p, g * (1 - cost));
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
          if (p > 0) { const v = sh[k] * p; cash += v * (1 - cost); sellFee += v * cost; if (book) book.sell(m, k, sh[k], v * (1 - cost)); sh[k] = 0; sold = true; }
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
    // 해외주식 양도세: 해가 바뀌면 그해 세금 확정 → 이듬해 5월 1일(그날 또는 뒤 첫 거래일) 사기 전에 냄 (SMB 와 같은 순서)
    if (book) {
      book.yearEnd(m, b);
      for (const T of book.list) {
        if (T.paid != null || d < (T.y + 1) + '-05-01') continue;
        if (!(T.tax > 0)) { T.paid = '-'; continue; }
        const usd = T.tax / ssFx(m), short0 = cash < usd - 1e-9;
        let tFee = 0;
        for (const k of SS_ASSETS) {
          if (!(cash < usd - 1e-9)) break;
          if (!(sh[k] > 0)) continue;
          const p = px(row, k);
          if (!(p > 0)) continue;
          const q = Math.min(sh[k], (usd - cash) / (p * (1 - cost))), v = q * p;
          cash += v * (1 - cost); tFee += v * cost; book.sell(m, k, q, v * (1 - cost));
          sh[k] -= q; if (sh[k] <= 1e-12) sh[k] = 0;
        }
        const pay = Math.min(usd, Math.max(0, cash)), ext = usd - pay;
        cash -= pay; taxPaid += usd; T.paid = d; T.usd = usd;
        if (ext > 1e-9) { taxExt += ext; T.ext = ext; }
        if (short0) cash = 0;   // 모자라 팔아서 낸 날 — 남은 잔돈(소수점 오차)으로 사지 않음 (SMB 시뮬 방식과 같게)
        if (!(shSum() > 0)) held = 'cash';
        entry('TAX', biggest(row), tFee);
        log[log.length - 1].tax = usd;
      }
    }
    const canBuy = settle === 0 || m - lastSell >= settle;
    if (canBuy && ready && tgt !== 'cash' && cash > 0) {
      const p = px(row, tgt);
      if (p > 0) {
        const easing = ease > 0;
        let amt;
        if (ease > 1) { amt = cash * (1 / ease); sh[tgt] += amt * (1 - cost) / p; cash -= amt; ease--; }
        else { amt = cash; sh[tgt] += amt * (1 - cost) / p; cash = 0; if (ease === 1) ease = 0; }
        if (book) book.buy(m, tgt, amt * (1 - cost) / p, amt);
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
  // 청산일이 분기말이 아니면(정확한 날짜) 그날 값도 점으로 — 없으면 화면 끝 값이 직전 분기말 값으로 남았음
  if (last && points[points.length - 1].date !== last[0]) points.push({ date: last[0], value: value(last), state });
  if (last && (!log.length || log[log.length - 1].date !== last[0])) {
    log.push({ date: last[0], state, held: biggest(last), action: 'END', fee: 0, price: last[ul] || 0, shares: shSum(), stockVal: value(last) - cash, cash, total: value(last), invested });
  }
  // 세금 요약 — 낸 양도세·원천징수 · 아직 안 낸 양도세(지난해 몫 + 올해 실현 손익) · 끝 날 전부 팔고 세금까지 낸 뒤 금액(SMB liq 와 같은 식)
  let tax = null;
  if (taxRate > 0 || whtRate > 0) {
    let liq = cash - taxExt;
    for (const k of SS_ASSETS) if (sh[k] > 0) liq += sh[k] * px(last, k) * (1 - cost);
    let due = 0;
    if (book) {
      const ly = book.yearOf(b);
      if (!book.list.some((x) => x.y === ly)) book.list.push({ y: ly, gain: book.gain[ly] || 0, tax: Math.max(0, (book.gain[ly] || 0) - SS_TAX_DED) * taxRate, paid: null, partial: true });
      const f1 = ssFx(b), fs = book.fxAt(b);
      due = book.list.filter((x) => x.paid == null && x.tax > 0).reduce((t, x) => t + x.tax / f1, 0);
      let unreal = 0;
      for (const k of SS_ASSETS) if (sh[k] > 0) unreal += sh[k] * px(last, k) * (1 - cost) * fs - book.basis(k);
      const unpaid = book.list.filter((x) => x.paid == null && x.y !== ly && x.tax > 0).reduce((t, x) => t + x.tax, 0);
      const finalTax = Math.max(0, (book.gain[ly] || 0) + unreal - SS_TAX_DED) * taxRate;
      liq -= (unpaid + finalTax) / f1;
    }
    tax = { rate: taxRate, wht: whtRate, paid: taxPaid, ext: taxExt, whtPaid, due, liq, years: book ? book.list : [], fx: !!DS.fx, divs: !!DS.divY };
  }
  return { points, log, dd, contributed: invested, tax };
}
