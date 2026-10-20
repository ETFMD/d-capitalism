/* ── [STRATSIM] 41 계산 → 차트 자료 ─────────────────────────────────────────
   render() 한 번 = 기간·적립·전략을 읽어 모든 선(그냥 보유 · 현금 복리 · 저장 전략 · 실제 계좌)을 계산하고
   x축 날짜(라벨)에 맞춰 차트에 넣음. 계산 순서·규칙은 원본과 같음(원본 대조 시험으로 확인) */

const SS_PERIOD_RANK = { weekly: 0, monthly: 1, quarterly: 2, yearly: 3 };
const ssFiner = (a, b) => (!a ? b : !b ? a : ((SS_PERIOD_RANK[a] ?? 2) <= (SS_PERIOD_RANK[b] ?? 2) ? a : b));
const ssYears = (a, b) => (!a || !b ? Infinity : (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / SS_YEAR_MS);

// 날짜 라벨마다 그 날 이하의 마지막 값 (라벨이 첫 점보다 앞이면 첫 값)
function ssResample(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  let j = 0;
  return labels.map((d) => { while (j + 1 < points.length && points[j + 1].date <= d) j++; return points[j].value; });
}
// 계산 중(옛 결과) 표시용: 옛 점들이 덮는 날짜 밖은 비움
function ssResampleClamped(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  const a = points[0].date, b = points[points.length - 1].date;
  let j = 0;
  return labels.map((d) => { if (d < a || d > b) return null; while (j + 1 < points.length && points[j + 1].date <= d) j++; return points[j].value; });
}

// x축 날짜 간격: 보이는 9sig 중 가장 잘게 · 기간 10년 미만이면 최소 주간, 아니면 분기
function ssDisplayGrain(livePeriod, spanYears) {
  let p = null;
  for (const c of S.saved) if (c.type === '9sig' && !c.hidden) p = ssFiner(p, c.params.per || 'quarterly');
  const floor = spanYears != null && spanYears < 10 ? 'weekly' : 'quarterly';
  return ssFiner(p || livePeriod || floor, floor);
}

// 물가 반영(연 3%) — 첫 라벨 날짜 기준 할인
const SS_INFL = 0.03;
function ssInflFactor(date, baseDate) {
  if (!S.infl || !baseDate || !date) return 1;
  const y = (Date.parse(date) - Date.parse(baseDate)) / SS_YEAR_MS;
  return y > 0 ? 1 / Math.pow(1 + SS_INFL, y) : 1;
}

// 이번 계산 결과 (패널·표·공유 카드·분석 창이 읽음)
const R = {
  ctx: null,          // 공통 조건
  labels: [], datasets: [],
  base: null,         // 기준 9sig 계산(라벨·그냥 보유·현금 복리의 원천)
  metrics: {},        // 선 키 → { cagr, start, end, maxDD, ddPeak, ddTrough }
  yday: {},           // 선 키 → 전일 값
  cfgSim: {},         // 저장 전략 id → 원 계산 결과(표·표시용)
  customLogs: {},     // 사용자 전략 id → 로그
  actual: null,       // 실제 계좌 지표
};

function ssRender() {
  if (!DS.q || !ssReady) return;
  const maxIdx = DS.q.length - 1;
  let e = Number.isFinite(S.e) ? S.e : 0, x = Number.isFinite(S.x) ? S.x : maxIdx;
  if (e < 0) e = 0;
  if (x < 0) x = maxIdx;
  if (e > maxIdx) e = maxIdx;
  if (x > maxIdx) x = maxIdx;
  if (e >= x) { x = Math.min(e + 1, maxIdx); e = Math.min(e, x - 1); if (e < 0) e = 0; }
  S.e = e; S.x = x;
  const qi0 = e > 0 ? e - 1 : e;   // '그 분기 시작에 진입' = 직전 분기 마지막 거래일
  let ed = S.ed, xd = S.xd;
  if (ed && !DS.idx.has(ed)) ed = '';
  if (xd && !DS.idx.has(xd)) xd = '';
  if (ed && xd && ed >= xd) { ed = ''; xd = ''; }
  const anyOv = !!(ed || xd);
  const entryDate = ed || DS.q[qi0][0], exitDate = xd || DS.q[x][0];

  const monthly = ssPosToMonthly(S.mPos), raise = (+S.raise || 0) / 100;
  const rate = ssPosToRate(+ssBaseEff('invested').r) / 100;
  let initial = ssPosToInitial(S.iPos), sched;
  S.txEff = null;
  if (S.tx) { const eff = ssTxEffective(S.tx, entryDate, rate); if (eff) { initial = eff.initial; sched = eff.schedule; S.txEff = eff; } }

  const N = DS.days.length;
  const prevDay = N >= 2 ? DS.days[N - 2].date : null;
  let latest = !!(prevDay && exitDate === DS.days[N - 1].date);
  if (latest && entryDate >= prevDay) latest = false;

  const editCfg = S.editing ? ssFindCfg(S.editing) : null;
  const livePeriod = editCfg && editCfg.type === '9sig' ? editCfg.params.per : 'quarterly';
  const grain = ssDisplayGrain(livePeriod, ssYears(entryDate, exitDate));

  // ── 기준 9sig (기본값 고정 · 분기) — 라벨·그냥 보유·현금 복리가 여기서 나옴
  const p9 = ssDefaults('9sig');
  const mainPeriod = 'quarterly';
  let rows = null;
  if (anyOv) { const q = ssExactRows(mainPeriod, entryDate, exitDate); if (q && q.length >= 2) rows = q; }
  const ovOpt = anyOv ? { ed: entryDate, xd: exitDate } : {};
  const sampleW = grain === 'weekly' && mainPeriod !== 'weekly';
  const base = ssRun9(Object.assign({ initial, monthly, raise, rate: ssRate9(p9), baseRate: rate, qi0, qi1: x, period: mainPeriod, rows, sched, sampleQ: false, sampleW }, ovOpt, ssOpts9(p9)));
  R.base = base;
  const ctx = { initial, monthly, raise, rate, qi0, qi1: x, e, ed: anyOv ? entryDate : '', xd: anyOv ? exitDate : '', anyOv, entryDate, exitDate, sched, grain, latest, prevDay, labels: [], years: 1, contributed: base.contributed };
  R.ctx = ctx;
  ssPeriodUI.update(e, x, ed, xd);
  ssSideUI.update(initial, monthly);

  if (base.log.length < 1) {
    R.labels = []; R.datasets = []; R.metrics = {};
    ssChartUpdate();
    ssAfterRender();
    return;
  }
  const log = base.log, fin = log[log.length - 1];
  const sameGrain = grain === mainPeriod;
  const labels = sameGrain ? log.map((l) => l.date)
    : ssRun9(Object.assign({ initial, monthly, raise, rate: ssRate9(p9), baseRate: rate, qi0, qi1: x, period: grain, rows: null, sched, noBH: true }, ovOpt, ssOpts9(p9))).log.map((l) => l.date);
  const years = log.length > 1 ? (Date.parse(fin.date) - Date.parse(log[0].date)) / SS_YEAR_MS : 1;
  ctx.labels = labels; ctx.years = years; ctx.d0 = log[0].date; ctx.d1 = fin.date;
  const onLabels = (arr, f) => (sameGrain ? arr.map(f) : ssResample((arr || []).map((a) => ({ date: a.date, value: f(a) })), labels));
  // 연평균(돈 가중): 그냥 보유 = ssRun9 의 적립 규칙('r9'), 현금 복리 = 달마다 이자 뒤 더하는 base('r9base') — ssFlows
  const mw = (v, mode) => ssCagrMW(initial, monthly, raise, log[0].date, fin.date, years, v, base.contributed, sched, mode);

  const metrics = {}, yday = {}, datasets = [];
  const defl = S.infl ? ssInflFactor(prevDay, labels[0]) : 1;
  // ── 그냥 보유 (기본 선)
  const bhUl = ssBaseEff('bh').ul, bhKey = SS_COL[bhUl] ? bhUl : 'tqqq';
  const bhPts = base.bh[bhKey] || [];
  const bhD = onLabels(sampleW ? (base.bhS[bhKey] || []) : bhPts, (p) => p.value);
  const bhFinal = bhPts.length ? bhPts[bhPts.length - 1].value : 0;
  const bhDD = bhPts.length && bhPts[0].shares != null ? ssDailyDD(bhPts.map((p) => ({ date: p.date, shares: p.shares, cash: 0 })), bhKey) : ssSeriesDD(bhD, labels);
  metrics.bh = { cagr: mw(bhFinal, 'r9'), start: bhD[0], end: bhD[bhD.length - 1], maxDD: bhDD.pct * 100, ddPeak: bhDD.peakDate, ddTrough: bhDD.troughDate };
  if (latest && bhPts.length && bhPts[bhPts.length - 1].shares > 0) { const y = ssRepriceYesterday({ [bhKey]: bhPts[bhPts.length - 1].shares }, 0); if (y != null) yday.bh = y * defl; }
  datasets.push(ssDs('bh', '그냥 보유 ' + bhKey.toUpperCase(), bhD, ssBaseColor('bh'), { borderWidth: 2, borderDash: [6, 3], hidden: S.hide.bh }));
  // ── 현금 복리 (모든 적립을 이자 붙는 현금으로)
  const invD = onLabels(sampleW ? base.samples : log, (l) => l.base);
  const invDD = ssSeriesDD(invD, labels);
  metrics.invested = { cagr: mw(fin.base, 'r9base'), start: invD[0], end: invD[invD.length - 1], maxDD: invDD.pct * 100, ddPeak: invDD.peakDate, ddTrough: invDD.troughDate };
  datasets.push(ssDs('invested', '현금 복리', invD, ssBaseColor('invested'), { borderWidth: 1.5, borderDash: [3, 3], tension: 0, hidden: S.hide.invested }));

  // ── 저장 전략
  R.cfgSim = {};
  for (const cfg of S.saved) {
    const s = ssCfgSeries(cfg, ctx);
    metrics['cfg:' + cfg.id] = { cagr: s.cagr, start: s.start, end: s.end, maxDD: s.maxDD, ddPeak: s.ddPeak, ddTrough: s.ddTrough, pending: s.pending, error: s.error };
    if (s.yday != null) yday['cfg:' + cfg.id] = s.yday;
    datasets.push(ssDs('cfg:' + cfg.id, cfg.name, s.data, cfg.color, { borderWidth: 2, hidden: !!cfg.hidden, cfgId: cfg.id }));
    if (cfg.type === '9sig' && s.sub && cfg.subShown) {
      for (const def of SS_SUB_DEFS) {
        if (!cfg.subShown[def.key]) continue;
        datasets.push(ssDs('cfg:' + cfg.id + ':' + def.key, cfg.name + ' · ' + ssSubLabel(def.key, cfg.params), ssResample(s.sub[def.key], labels), cfg.color,
          { borderWidth: 1.5, borderDash: def.dash, tension: def.key === 'target' ? 0 : 0.3, hidden: !!cfg.hidden, cfgId: cfg.id, sub: def.key }));
      }
    }
  }
  // ── 실제 계좌 (거래내역에 평가액 열이 있을 때)
  R.actual = null;
  const eff = S.txEff || S.tx;
  if (S.tx && eff && eff.actualPoints && eff.actualPoints.length && S.tx.showActual !== false) {
    const pts = eff.actualPoints, ser = ssResample(pts, labels);
    for (let i = 0; i < labels.length && labels[i] < pts[0].date; i++) ser[i] = null;
    const fv = pts[pts.length - 1].value;
    const flows = [{ date: eff.entryDate || S.tx.entryDate, amount: eff.initial }].concat(eff.schedule.list);
    const dd = ssFlowAdjDD(pts, flows);
    R.actual = { cagr: ssCfgCagr(ctx, fv, 'day', eff.entryDate || ctx.entryDate, String(pts[pts.length - 1].date)), maxDD: dd.pct * 100, ddPeak: dd.peakDate, ddTrough: dd.troughDate, start: pts[0].value, end: fv };
    metrics.actual = R.actual;
    datasets.push(ssDs('actual', '내 계좌', ser, SS_ACTUAL_COLOR, { borderWidth: 2.5 }));
  }

  // 물가 반영: 각 점 × 할인율 (그린 값 기준이라 매번 새로 계산)
  if (S.infl && labels.length) {
    const disc = labels.map((d) => ssInflFactor(d, labels[0]));
    datasets.forEach((ds) => { ds.data = ds.data.map((v, i) => { const k = disc[i]; return typeof v !== 'number' ? v : v * (k > 0 ? k : 1); }); });
  }
  // 차트 최솟값 1 (로그 축에서 0 이 사라지지 않게)
  datasets.forEach((ds) => ds.data.forEach((v, i, arr) => { if (typeof v === 'number' && v < 1) arr[i] = 1; }));

  R.labels = labels; R.datasets = datasets; R.metrics = metrics; R.yday = yday;
  ssChartUpdate();
  ssAfterRender();
}

// 차트 선 하나 (Chart.js 데이터셋) — 공통 모양 + 선마다 다른 것(o)
const SS_DS_LOOK = { borderWidth: 2, tension: 0.3, fill: false, backgroundColor: 'transparent', pointRadius: 0, pointHitRadius: 10 };
function ssDs(key, label, data, color, o) {
  return Object.assign({ _key: key, _color: color, label, data, borderColor: color }, SS_DS_LOOK, o || {});
}
const SS_ACTUAL_COLOR = '#0d9488';
// 9sig 세부 선: [키, 계산 결과의 값 이름, 점선 모양]
const SS_SUB_DEFS = [['holding', 'holdVal', [2, 2]], ['target', 'target', [9, 4]], ['cash', 'cash', [2, 4, 9, 4]]].map(([key, src, dash]) => ({ key, src, dash }));
function ssSubLabel(key, p) {
  const pp = p || {};
  const ul = String(pp.ul || 'tqqq').toUpperCase(), park = String(pp.park || 'cash').toLowerCase();
  if (key === 'holding') return ul + ' 보유';
  if (key === 'target') return ul + ' 목표';
  return park === 'cash' ? '현금' : park.toUpperCase();
}

// 저장 전략의 돈 가중 CAGR — 그 전략의 계산이 실제로 넣은 돈(날짜·금액)과 끝 값이 나온 날로 (분석 표 풍선과 같은 계산)
//  · mode = ssFlows 의 'day'(SMA·사용자 코드·내 계좌) / 'r9'(9sig·그냥 보유) / 'r9base'(현금 복리)
//  · d0 = 시작 금액을 넣은 날: 날마다 걷는 계산은 진입일, 나머지는 계산의 첫 점
//    (주 단위 화면의 첫 눈금은 진입일 전 주말일 수 있어 눈금으로 세면 진입 전 적립이 하나 더 들어갔었음)
//  · d1 = 끝 값이 나온 점의 날짜 (그 계산의 마지막 행)
function ssCfgCagr(ctx, finalV, mode, d0, d1) {
  const L = ctx.labels;
  if (L.length && d0 && d1 && d1 > d0) {
    const yrs = (Date.parse(d1) - Date.parse(d0)) / SS_YEAR_MS;
    return ssCagrMW(ctx.initial, ctx.monthly, ctx.raise, d0, d1, yrs, finalV, ctx.contributed, ctx.sched, mode, true);
  }
  if (L.length) return ssCagrMW(ctx.initial, ctx.monthly, ctx.raise, L[0], L[L.length - 1], ctx.years, finalV, ctx.contributed, ctx.sched, mode, true);
  return ctx.years > 0 && ctx.contributed > 0 && finalV > 0 ? (Math.pow(finalV / ctx.contributed, 1 / ctx.years) - 1) * 100 : 0;
}
// 날짜 d 에 쓰인 값의 점 날짜 (ssResample 과 같은 규칙: d 이하 마지막 점, 없으면 첫 점)
function ssSrcDate(points, d) {
  if (!points || !points.length) return null;
  let j = 0;
  while (j + 1 < points.length && points[j + 1].date <= d) j++;
  return String(points[j].date);
}

// 저장 전략 한 개 → 라벨에 맞춘 선 + 지표 (lite: 끝 금액만 빨리 — 낙폭·보유 선 계산 생략, 과최적화 탐색기 자료 계산용)
function ssCfgSeries(cfg, ctx, lite) {
  if (cfg.type === 'custom') return ssCustomSeries(cfg, ctx);
  const L = ctx.labels, p = cfg.params;
  const ovOpt = ctx.anyOv ? { ed: ctx.entryDate, xd: ctx.exitDate } : {};
  const yFrom = (hold, cash) => {
    if (!ctx.latest || !ctx.prevDay) return null;
    const v = ssRepriceYesterday(hold, cash);
    return v == null ? null : v * (S.infl ? ssInflFactor(ctx.prevDay, L[0]) : 1);
  };
  let points = null, sub = null, ddc = null, ddKey = null, ddMulti = null, yd = null;
  const common = { initial: ctx.initial, monthly: ctx.monthly, raise: ctx.raise, qi0: ctx.qi0, qi1: ctx.qi1, sched: ctx.sched };
  const exactQ = () => { if (!ctx.anyOv) return null; const q = ssExactRows('quarterly', ctx.entryDate, ctx.exitDate); return q && q.length >= 2 ? q : null; };
  if (cfg.type === '9sig') {
    const o9 = ssOpts9(p), per = p.per || 'quarterly';
    let rows = null;
    const rp = +p.rp || 0;
    if (rp > 0) { const off = Math.round(rp / 100 * ((SS_PERIOD_DAYS[per] || 63) - 1)); const q = ssShiftRows(per, off, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
    if (!rows && ctx.anyOv) { const q = ssExactRows(per, ctx.entryDate, ctx.exitDate); if (q && q.length >= 2) rows = q; }
    const sampleQ = ctx.grain === 'quarterly' && per === 'yearly', sampleW = ctx.grain === 'weekly' && per !== 'weekly';
    const r = ssRun9(Object.assign({}, common, { rate: ssRate9(p), period: per, rows, sampleQ, sampleW, noBH: !!lite }, ovOpt, o9));
    const sr = sampleQ || sampleW ? r.samples : r.log;
    points = sr.map((l) => ({ date: l.date, value: l.total }));
    sub = {
      holding: sr.map((l) => ({ date: l.date, value: l.holdVal })),
      target: sr.map((l) => ({ date: l.date, value: l.target })),
      cash: sr.map((l) => ({ date: l.date, value: l.cash })),
    };
    ddc = r.log.map((l) => ({ date: l.date, shares: l.price > 0 ? l.holdVal / l.price : 0, cash: l.cash }));
    ddKey = SS_KEY_OF[o9.ul] || 'tqqq';
    R.cfgSim[cfg.id] = { type: '9sig', log: r.log, bh: r.bh, ddc, ddKey };
    const last = r.log[r.log.length - 1];
    if (last && DS.days.length) {
      const sh = last.price > 0 ? last.holdVal / last.price : 0, pk = (o9.park || 'cash').toLowerCase(), today = DS.days[DS.days.length - 1];
      if (pk === 'cash') yd = yFrom({ [ddKey]: sh }, last.cash);
      else if (today[pk] > 0) { const h = { [ddKey]: sh }; h[pk] = (h[pk] || 0) + last.cash / today[pk]; yd = yFrom(h, 0); }
    }
  } else if (cfg.type === 'sma') {
    const r = ssRunSma(Object.assign({}, common, { rate: ssRate9(p), dd: !lite, sampleW: ctx.grain === 'weekly' }, ovOpt, ssOptsSma(p)));
    points = r.points.map((pt) => ({ date: pt.date, value: pt.value }));
    ddMulti = r.dd || null;
    R.cfgSim[cfg.id] = { type: 'sma', log: r.log, points: r.points, dd: ddMulti };
    const lc = ddMulti && ddMulti.length ? ddMulti[ddMulti.length - 1] : null;
    if (lc) yd = yFrom(lc.h, lc.cash);
  } else if (cfg.type === 'bh') {
    const q = exactQ();
    const r = ssRun9(Object.assign({}, common, { rate: 0, rows: q, sampleW: ctx.grain === 'weekly' }, ovOpt));
    const key = SS_COL[p.ul] ? p.ul : 'tqqq';
    const raw = r.bh[key] || [], samp = r.bhS[key] || [];
    points = (ctx.grain === 'weekly' ? samp : raw).map((pt) => ({ date: pt.date, value: pt.value }));
    ddc = raw.map((pt) => ({ date: pt.date, shares: pt.shares, cash: 0 }));
    ddKey = key;
    R.cfgSim[cfg.id] = { type: 'bh', log: r.log, bh: r.bh, ddc, ddKey };
    const last = raw[raw.length - 1];
    if (last && last.shares > 0) yd = yFrom({ [key]: last.shares }, 0);
  } else if (cfg.type === 'invested') {
    const q = exactQ();
    const r = ssRun9(Object.assign({}, common, { rate: 0, baseRate: ssPosToRate(+p.r || 0) / 100, rows: q, sampleQ: ctx.grain === 'quarterly', sampleW: ctx.grain === 'weekly' }, ovOpt));
    const sr = ctx.grain === 'quarterly' || ctx.grain === 'weekly' ? r.samples : r.log;
    points = sr.map((l) => ({ date: l.date, value: l.base }));
    R.cfgSim[cfg.id] = { type: 'invested', log: r.log };
  }
  const data = ssResample(points, L);
  const finalV = data.length ? data[data.length - 1] : 0, startV = data.length ? data[0] : 0;
  if (lite) return { data, end: finalV, start: startV };
  const dd = ddMulti && ddMulti.length ? ssDailyDDMulti(ddMulti) : ddc && ddc.length ? ssDailyDD(ddc, ddKey) : ssSeriesDD(data, L);
  const mode = cfg.type === 'sma' ? 'day' : cfg.type === 'invested' ? 'r9base' : 'r9', cd0 = mode === 'day' ? ctx.entryDate : points && points.length ? String(points[0].date) : null;
  const cagr = ssCfgCagr(ctx, finalV, mode, cd0, L.length ? ssSrcDate(points, L[L.length - 1]) : null);
  return { data, cagr, maxDD: dd.pct * 100, start: startV, end: finalV, sub, ddPeak: dd.peakDate, ddTrough: dd.troughDate, yday: yd };
}

// 사용자 전략: 격리 실행 결과(캐시)로 선을 만듦 — 없으면 실행을 걸어 두고, 돌아오면 다시 그림
function ssCustomSeries(cfg, ctx) {
  const empty = (err) => ({ data: ctx.labels.map(() => null), cagr: 0, maxDD: 0, start: 0, end: 0, ddPeak: null, ddTrough: null, error: err || null });
  if (!cfg.code || !String(cfg.code).trim()) { R.customLogs[cfg.id] = []; return empty(null); }
  const sig = ssCustomSig(cfg, ctx);
  const c = SB.res[cfg.id];
  if (c && c.sig === sig) {
    R.customLogs[cfg.id] = c.log || [];
    ssScheduleYday(cfg, ctx);
    const out = ssCustomResult(c.log, ctx, c.error);
    const y = SB.yday[cfg.id];
    if (y && !y.error && y.value != null && ctx.latest) out.yday = y.value * (S.infl ? ssInflFactor(ctx.prevDay, ctx.labels[0]) : 1);
    return out;
  }
  ssScheduleRun(cfg.id, cfg.code, cfg.params, sig, ssCustomGlobals(ctx));
  R.customLogs[cfg.id] = (c && c.log) || [];
  const out = ssCustomResult(c ? c.log : [], ctx, null, true);
  out.pending = true;
  return out;
}
function ssScheduleYday(cfg, ctx) {
  if (!ctx.latest || !ctx.prevDay || !cfg.code) return;
  const yctx = Object.assign({}, ctx, { xd: ctx.prevDay, ed: ctx.ed || ctx.entryDate });
  const sig = ssCustomSig(cfg, yctx);
  const c = SB.yday[cfg.id];
  if (c && c.sig === sig) return;
  ssScheduleRun(cfg.id + '::yday', cfg.code, cfg.params, sig, ssCustomGlobals(yctx));
}
function ssCustomResult(log, ctx, error, stale) {
  const L = ctx.labels;
  if (error) return { data: L.map(() => null), cagr: 0, maxDD: 0, start: 0, end: 0, ddPeak: null, ddTrough: null, error };
  const pts = (log || []).filter((r) => r && r.date != null && typeof r.value === 'number' && Number.isFinite(r.value))
    .map((r) => ({ date: String(r.date), value: r.value })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const data = stale ? ssResampleClamped(pts, L) : ssResample(pts, L);
  let fv = 0, sv = 0;
  for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) { fv = data[i]; break; }
  for (let i = 0; i < data.length; i++) if (data[i] != null) { sv = data[i]; break; }
  const ctrl = ssCustomCtrl(log);
  let dd = ctrl ? ssDailyDDMulti(ctrl) : null;
  if (!dd) dd = pts.length ? ssSeriesDD(pts.map((p) => p.value), pts.map((p) => p.date)) : ssSeriesDD(data, L);
  // 끝 값이 나온 점: 값이 있는 마지막 눈금에 쓰인 기록 날짜
  let li = -1;
  for (let i = data.length - 1; i >= 0; i--) if (data[i] != null) { li = i; break; }
  const cagr = ssCfgCagr(ctx, fv, 'day', ctx.entryDate, li >= 0 ? ssSrcDate(pts, L[li]) : null);
  return { data, cagr, maxDD: dd.pct * 100, start: sv, end: fv, ddPeak: dd.peakDate, ddTrough: dd.troughDate };
}
