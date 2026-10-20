/* ── [STRATSIM] 20 사용자 전략 실행 (격리 Worker) ──────────────────────────
   사용자·공유 링크로 받은 전략 코드는 절대 이 페이지(메인 스레드)에서 돌리지 않음:
   blob Worker 안에서만 실행 — DOM·저장소·쿠키 없음 + 네트워크·저장 API 를 모두 지우고
   4초가 넘으면 Worker 를 죽임. 주고받는 것은 시장 자료와 숫자·글자뿐.
   (사이트 로그인 정보는 localStorage 에 있으므로 Worker 에선 닿을 수 없음)
   계약(전략 객체 { name, params, columns, lines, run(data, p) })은 원본과 같게 — 원본용으로
   만든 코드도 그대로 붙여 넣어 돌아감 */

// 사용자 전략에 넘기는 자료 (전체 일봉 — 한 번 만들어 둠)
let _ssCustomData = null;
function ssCustomData() {
  if (_ssCustomData) return _ssCustomData;
  const d = DS.days || [];
  const col = (k) => d.map((r) => r[k] || 0);
  _ssCustomData = {
    dates: d.map((r) => r.date),
    tqqq: d.map((r) => r.tqqq), qqq: d.map((r) => r.qqq), spy: d.map((r) => r.spy),
    qld: d.map((r) => r.qld), sso: d.map((r) => r.sso), spxl: d.map((r) => r.spxl), sqqq: col('sqqq'),
    nfci: DS.nfci ? DS.nfci.slice() : d.map(() => NaN),
  };
  return _ssCustomData;
}

// Worker 안에서 도는 함수 (문자열로 바꿔 blob 으로 실행 — 메인 스레드에서 부르지 않음)
function ssWorkerMain() {
  'use strict';
  // 밖으로 나가거나 남길 수 있는 것은 전부 지움 — 자기 자신과 원형(prototype) 사슬 모두
  var BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches',
    'Notification', 'SharedWorker', 'Worker', 'BroadcastChannel', 'Request', 'navigator', 'location', 'RTCPeerConnection', 'FileReaderSync'];
  BLOCK.forEach(function (k) {
    for (var o = self; o; o = Object.getPrototypeOf(o)) {
      try { if (Object.prototype.hasOwnProperty.call(o, k)) Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch (e) {}
    }
    try { self[k] = undefined; } catch (e) {}
  });
  var DATA = null;
  function clean(raw) {
    var s = String(raw || '').trim();
    var f = s.match(/```[a-zA-Z0-9]*\s*([\s\S]*?)```/);
    if (f) s = f[1].trim();
    s = s.replace(/^\s*(?:module\.exports\s*=|export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*/, '').trim();
    return s.replace(/;\s*$/, '').trim();
  }
  function asStrategy(m) {
    if (typeof m === 'function') return { name: null, run: m, params: undefined };
    if (m && typeof m.run === 'function') return { name: m.name || null, run: m.run, params: m.params, columns: m.columns, lines: m.lines };
    return null;
  }
  function str(v) { return v == null ? null : String(v); }
  function cols(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c) continue;
      if (typeof c === 'string') { out.push({ key: c }); continue; }
      if (c.key == null) continue;
      out.push({ key: String(c.key), label: str(c.label), tip: c.tip != null ? String(c.tip) : str(c.tooltip) });
    }
    return out.length ? out : null;
  }
  function lines(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 6; i++) {
      var l = raw[i];
      if (!l) continue;
      if (typeof l === 'string') { out.push({ key: l, label: l }); continue; }
      if (l.key == null) continue;
      out.push({ key: String(l.key), label: l.label != null ? String(l.label) : String(l.key) });
    }
    return out.length ? out : null;
  }
  function signals(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var cards = [], reasons = [], d = null, i, c, r;
    if (Array.isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length && cards.length < 12; i++) {
        c = raw.cards[i];
        if (!c || c.label == null) continue;
        cards.push({ label: str(c.label), value: str(c.value), sub: str(c.sub), tip: str(c.tip), tone: str(c.tone), icon: str(c.icon),
          delta: (c.delta && typeof c.delta === 'object' && c.delta.text != null) ? { text: str(c.delta.text), tone: str(c.delta.tone) } : null });
      }
    }
    if (raw.decision && typeof raw.decision === 'object') {
      if (Array.isArray(raw.decision.reasons)) {
        for (i = 0; i < raw.decision.reasons.length && reasons.length < 10; i++) {
          r = raw.decision.reasons[i];
          if (!r || r.name == null) continue;
          reasons.push({ name: str(r.name), val: str(r.val), tag: str(r.tag), lean: str(r.lean) });
        }
      }
      d = { action: str(raw.decision.action), note: str(raw.decision.note), tone: str(raw.decision.tone), reasons: reasons };
    }
    if (!cards.length && !d) return null;
    return { cards: cards, decision: d, asOf: str(raw.asOf) };
  }
  // 붙여 넣은 글에서 전략 객체를 찾음 — 괄호·코드 울타리·앞뒤 글이 섞여도 몇 가지 후보로 시도
  function evalStrategy(code) {
    var base = clean(code), cands = [base], t = base, k;
    for (k = 0; k < 4 && /^\(/.test(t) && /\)$/.test(t); k++) { t = t.slice(1, -1).trim(); cands.push(t); }
    var fo = Math.min.apply(null, ['{', '('].map(function (ch) { var i = base.indexOf(ch); return i < 0 ? Infinity : i; }));
    var lc = Math.max(base.lastIndexOf('}'), base.lastIndexOf(')'));
    if (isFinite(fo) && fo > 0 && lc > fo) cands.push(base.slice(fo, lc + 1));
    var fb = base.indexOf('{'), lb = base.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cands.push(base.slice(fb, lb + 1));
    if (base.length > 4 && /^\(\{/.test(base) && /\}\)$/.test(base)) cands.push(base.slice(2, -2).trim());
    var mod = null, lastErr;
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci]; if (!c) continue;
      try { var a = asStrategy((new Function('"use strict"; return (' + c + '\n);'))()); if (a) { mod = a; break; } } catch (e) { lastErr = e; }
      try { var b = asStrategy((new Function('"use strict";\n' + c + '\n'))()); if (b) { mod = b; break; } } catch (e2) { lastErr = e2; }
    }
    if (!mod) throw new Error('전략을 읽지 못했습니다 — run(data, p) 함수이거나 그 함수를 가진 객체여야 합니다(앞뒤 설명 글 없이). ' + (lastErr ? lastErr.message : ''));
    return mod;
  }
  function coerce(sp, raw) {
    var isBool = sp.type === 'bool' || sp.type === 'boolean' || (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean') || typeof sp.default === 'boolean';
    if (isBool) return raw === true || raw === 'true' || raw === '1' || raw === 1;
    var isNum = sp.type === 'number' || 'min' in sp || 'max' in sp || 'step' in sp || (Array.isArray(sp.options) && typeof sp.options[0] === 'number') || typeof sp.default === 'number';
    if (isNum) { var n = Number(raw); return isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
    return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
  }
  self.onmessage = function (e) {
    var msg = e.data || {};
    if (msg.type === 'data') { DATA = msg.data; return; }
    if (msg.type !== 'run') return;
    var out;
    try {
      var mod = evalStrategy(msg.code);
      var schema = Array.isArray(mod.params) ? mod.params : [];
      try { schema = JSON.parse(JSON.stringify(schema)); } catch (e0) { schema = []; }
      var p = {}, g = msg.globals || {}, key;
      for (key in g) p[key] = g[key];
      var raw = msg.rawParams || {};
      for (var si = 0; si < schema.length; si++) {
        var sp = schema[si];
        if (sp && sp.id != null) p[sp.id] = coerce(sp, (raw && (sp.id in raw)) ? raw[sp.id] : sp.default);
      }
      var res = mod.run(DATA, p);
      var rawLog = Array.isArray(res) ? res : (res && Array.isArray(res.log) ? res.log : null);
      if (!rawLog) throw new Error('run() 은 { date, value } 배열(또는 { log: [...] })을 돌려줘야 합니다.');
      var log = [];
      for (var li = 0; li < rawLog.length; li++) {
        var row = rawLog[li]; if (!row || row.date == null) continue;
        var o = {}, rk;
        for (rk in row) { var rv = row[rk]; if (typeof rv === 'number' || typeof rv === 'string' || typeof rv === 'boolean') o[rk] = rv; }
        log.push(o);
      }
      out = { reqId: msg.reqId, schema: schema, name: mod.name || null, log: log,
        columns: cols(res && res.columns) || cols(mod.columns), signals: signals(res && res.signals),
        lines: lines(res && res.lines) || lines(mod.lines),
        totalContributed: (res && typeof res.totalContributed === 'number') ? res.totalContributed : null };
    } catch (err) {
      out = { reqId: msg.reqId, error: (err && err.message) ? err.message : String(err) };
    }
    self.postMessage(out);
  };
}

// 메인 스레드와 같은 형변환 (저장된 값 → 전략이 받는 값)
function ssCoerce(sp, raw) {
  const isBool = sp.type === 'bool' || sp.type === 'boolean' || (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean') || typeof sp.default === 'boolean';
  if (isBool) return raw === true || raw === 'true' || raw === '1' || raw === 1;
  const isNum = sp.type === 'number' || 'min' in sp || 'max' in sp || 'step' in sp || (Array.isArray(sp.options) && typeof sp.options[0] === 'number') || typeof sp.default === 'number';
  if (isNum) { const n = Number(raw); return Number.isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
  return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
}

// ── 실행 관리 ──────────────────────────────────────────────────────────
const SB = {
  w: null, seq: 0, dataSent: false,
  pending: {},       // reqId → { id, sig, timer } 또는 { cb, timer }
  timers: {},        // cfgId → { sig, t } (보내기 대기)
  lastFire: {},      // cfgId → 마지막으로 보낸 시각
  res: {},           // cfgId → { sig, log, schema, columns, signals, lines, name, error, totalContributed }
  yday: {},          // cfgId → { sig, value, error } (전일 대비 배지)
  prevQ: [], prevN: 0,  // 미리보기 막대 대기열 (동시 2개)
  pcache: {},        // 미리보기 결과 (key → 최종값)
  onResult: null,    // 결과가 오면 부를 함수 (앱이 render 로 채움)
  onName: null,      // 전략 이름을 코드에서 받았을 때
};
const SS_TIMEOUT = 4000, SS_THROTTLE = 150, SS_PREV_MAX = 2;

function ssWorker() {
  if (SB.w) return SB.w;
  try {
    const url = URL.createObjectURL(new Blob(['(' + ssWorkerMain.toString() + ')()'], { type: 'application/javascript' }));
    const w = new Worker(url);
    w.onmessage = ssOnWorkerMsg;
    w.onerror = () => { try { w.terminate(); } catch (e) {} SB.w = null; SB.dataSent = false; };
    SB.w = w; SB.dataSent = false;
  } catch (e) { SB.w = null; }
  return SB.w;
}
function ssSendData() {
  const w = ssWorker();
  if (!w || SB.dataSent) return;
  w.postMessage({ type: 'data', data: ssCustomData() });
  SB.dataSent = true;
}
function ssKillWorker() { try { SB.w && SB.w.terminate(); } catch (e) {} SB.w = null; SB.dataSent = false; }

// 전략이 받는 공통 값 (p.initial · p.contributions · p.startIdx … )
function ssCustomGlobals(ctx) {
  const entryDate = ctx.ed || (DS.q[ctx.qi0] || [])[0] || null;
  const exitDate = ctx.xd || (DS.q[ctx.qi1] || [])[0] || null;
  let startIdx = 0, endIdx = 0;
  const s = DS.idx.get(entryDate), e = DS.idx.get(exitDate);
  if (s != null) startIdx = s;
  if (e != null) endIdx = e;
  if (!endIdx) endIdx = Math.max(0, DS.days.length - 1);
  const contributions = ssContribObj(ctx.monthly, ctx.raise, entryDate, exitDate, ctx.sched);
  return { initial: ctx.initial, monthly: ctx.monthly, annualRaise: ctx.raise, startIdx, endIdx, entryDate, exitDate, contributions, weeklyDisplay: ctx.grain === 'weekly' };
}
function ssCustomSig(cfg, ctx) {
  const sk = ctx.sched && ctx.sched.list ? ctx.sched.list.map((r) => r.date + ':' + r.amount).join(',') : '';
  return [cfg.code || '', JSON.stringify(cfg.params || {}), ctx.initial, ctx.monthly, ctx.raise, ctx.qi0, ctx.qi1, ctx.ed || '', ctx.xd || '', sk, ctx.grain || ''].join('|');
}

// 같은 전략의 실행은 하나씩만 · 끄는 중에도 150ms 마다 새 값으로 (끌기 중에도 선이 따라옴)
function ssScheduleRun(id, code, params, sig, globals) {
  for (const k in SB.pending) if (SB.pending[k].id === id && SB.pending[k].sig === sig) return;
  if (SB.timers[id] && SB.timers[id].sig === sig) return;
  for (const k in SB.pending) if (SB.pending[k].id === id) return;     // 돌아오면 render 가 다시 부름
  if (SB.timers[id]) clearTimeout(SB.timers[id].t);
  const wait = Math.max(0, SS_THROTTLE - (Date.now() - (SB.lastFire[id] || 0)));
  SB.timers[id] = { sig, t: setTimeout(() => { delete SB.timers[id]; SB.lastFire[id] = Date.now(); ssPost(id, code, params, sig, globals); }, wait) };
}
function ssPost(id, code, params, sig, globals) {
  const isY = /::yday$/.test(id);
  const fail = (error) => {
    if (isY) SB.yday[id.slice(0, -6)] = { sig, value: null, error };
    else SB.res[id] = { sig, log: [], schema: (SB.res[id] && SB.res[id].schema) || [], error };
    if (SB.onResult) SB.onResult(id);
  };
  const w = ssWorker();
  if (!w) { fail('이 브라우저에서는 격리 실행(Web Worker)을 쓸 수 없습니다.'); return; }
  ssSendData();
  const reqId = ++SB.seq;
  const timer = setTimeout(() => { delete SB.pending[reqId]; ssKillWorker(); fail('시간이 너무 오래 걸려 멈췄습니다 — 끝나지 않는 반복이 있는지 확인해 주세요.'); }, SS_TIMEOUT);
  SB.pending[reqId] = { id, sig, timer };
  w.postMessage({ type: 'run', reqId, code, globals, rawParams: params || {} });
}
// 미리보기 막대용 1회 실행 (결과는 cb 로만 — 본 선 캐시엔 안 넣음)
function ssPreviewRun(code, params, globals, cb) { SB.prevQ.push({ code, params, globals, cb }); ssPumpPreview(); }
function ssClearPreview() { SB.prevQ.length = 0; }
function ssPumpPreview() { while (SB.prevN < SS_PREV_MAX && SB.prevQ.length) ssStartPreview(SB.prevQ.shift()); }
function ssStartPreview(job) {
  const w = ssWorker();
  if (!w) { job.cb(null, 'no-sandbox'); return; }
  ssSendData();
  const reqId = ++SB.seq;
  SB.prevN++;
  let done = false;
  const finish = (msg, err) => { if (done) return; done = true; SB.prevN--; try { job.cb(msg, err); } finally { ssPumpPreview(); } };
  const timer = setTimeout(() => { delete SB.pending[reqId]; ssKillWorker(); finish(null, 'timeout'); }, SS_TIMEOUT);
  SB.pending[reqId] = { cb: finish, timer };
  w.postMessage({ type: 'run', reqId, code: job.code, globals: job.globals, rawParams: job.params || {} });
}
function ssOnWorkerMsg(e) {
  const msg = e.data || {};
  const pend = SB.pending[msg.reqId];
  if (!pend) return;
  clearTimeout(pend.timer);
  delete SB.pending[msg.reqId];
  if (pend.cb) { pend.cb(msg, msg.error); return; }
  if (/::yday$/.test(pend.id)) {
    const log = msg.log || [], last = log.length ? log[log.length - 1] : null;
    SB.yday[pend.id.slice(0, -6)] = { sig: pend.sig, value: last && typeof last.value === 'number' && isFinite(last.value) ? last.value : null, error: msg.error || null };
    if (SB.onResult) SB.onResult(pend.id, true);
    return;
  }
  SB.res[pend.id] = { sig: pend.sig, log: msg.log || [], schema: msg.schema || [], columns: msg.columns || null, signals: msg.signals || null,
    lines: msg.lines || null, name: msg.name || null, error: msg.error || null, totalContributed: typeof msg.totalContributed === 'number' ? msg.totalContributed : null };
  if (msg.name && SB.onName) SB.onName(pend.id, msg.name);
  if (SB.onResult) SB.onResult(pend.id);
}

// 라이브러리 카드용: 우리 사이트가 직접 쓴 전략 코드(1차 코드)는 메인 스레드에서 바로 실행
// (사용자·공유 코드는 이 함수를 절대 쓰지 않음 — 위 Worker 로만)
function ssEvalTrusted(code) {
  const s = String(code || '').trim();
  const m = (new Function('"use strict"; return (' + s + '\n);'))();
  if (typeof m === 'function') return { run: m, params: [] };
  if (m && typeof m.run === 'function') return m;
  throw new Error('bad library code');
}
function ssRunTrusted(mod, globals, raw) {
  const p = Object.assign({}, globals);
  for (const sp of (Array.isArray(mod.params) ? mod.params : [])) if (sp && sp.id != null) p[sp.id] = ssCoerce(sp, raw && sp.id in raw ? raw[sp.id] : sp.default);
  const res = mod.run(ssCustomData(), p);
  return Array.isArray(res) ? { log: res } : (res || { log: [] });
}
