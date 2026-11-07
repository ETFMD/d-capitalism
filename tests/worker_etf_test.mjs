// Worker ETF 차트 비교 실제 가격 경로 단독 확인 (node tests/worker_etf_test.mjs · run_regression.py 가 부름)
//  · yahooRows: 야후 일봉 → "YYYYMMDD,시가,종가" 줄 (거래소 현지 날짜 · 시가 없는 날은 빈칸 · 종가 없는 날은 뺌)
//  · etfPage(m=kp): 네이버 일별 시세 쪽 찾기 — 추정 쪽이 어긋나도 앞뒤로 옮겨 찾음 · 보관본
//    · 자료 시작 전 날짜 = 200 "first=자료 첫날"(보관) · 미래 날짜 404 · 잘못된 코드 400 · 원본 오류 502
//  · liveQuote(/q): 실시간 시세 — 야후 1분봉 마지막 체결가 · 장(프리·정규·애프터·마감) 판정 · 다른 사이트 403 · 15초 메모리 보관 · 원본 오류 시 직전 값
// fetch·D1 은 모의 (m.stock 처럼 1쪽 = 가장 최근 60거래일, 최신이 앞)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.js'), 'utf8');
const a = src.indexOf('const KP_TTL'), b = src.indexOf('async function etfChart');
if (a < 0 || b < 0) { console.log('FAIL Worker 에서 etfPage·yahooRows 구간을 찾지 못함'); process.exit(1); }
const W = new Function('CNN_UA', src.slice(a, b) + '\nreturn { etfPage, yahooRows, etfSource };')('test');

const days = []; for (let d = Date.UTC(2026, 0, 2); days.length < 200; d += 864e5) { const w = new Date(d).getUTCDay(); if (w > 0 && w < 6) days.push(new Date(d).toISOString().slice(0, 10)); }
const ymd = (s) => s.replace(/-/g, '');
let calls = [], upstreamDown = false;
globalThis.fetch = async (u) => {
  const g = +/page=(\d+)/.exec(u)[1]; calls.push(g);
  if (upstreamDown) return { ok: false, status: 503, json: async () => ({}) };
  const n = days.length, hi = n - 1 - (g - 1) * 60, lo = Math.max(0, n - g * 60), rows = [];
  for (let i = hi; i >= lo; i--) rows.push({ localTradedAt: days[i], openPrice: (10000 + i).toLocaleString('en-US'), closePrice: String(20000 + i) });
  return { ok: true, status: 200, json: async () => rows };
};
const store = {};
const env = { DB: { prepare: () => ({ bind: (...x) => ({ first: async () => store[x[0]] || null, run: async () => { store[x[0]] = { t: x[1], v: x[2] }; } }) }) } };
const cors = { ok: true, headers: {} };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
let fails = 0, oks = 0;
const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
async function kp(d, g, s = '498400') {
  calls = [];
  const r = await W.etfPage(env, new URL('https://x/etf?m=kp&s=' + s + '&d=' + ymd(d) + '&g=' + g), cors, json);
  return { status: r.status, text: await r.text(), calls: calls.slice() };
}
const gOf = (i) => Math.floor((days.length - 1 - i) / 60) + 1;
let r = await kp(days[100], gOf(100));
ok(r.status === 200 && r.text.split('\n').includes(ymd(days[100]) + ',' + (10100) + ',' + (20100)) && r.calls.join() === String(gOf(100)), '정확한 쪽 한 번에 · 시가 쉼표 제거', r);
r = await kp(days[30], 2); ok(r.status === 200 && r.text.includes(ymd(days[30]) + ',') && r.calls.join() === '2,3', '추정 쪽이 최근 쪽 → 옛날 쪽으로', r.calls);
r = await kp(days[190], 2); ok(r.status === 200 && r.text.includes(ymd(days[190]) + ',') && r.calls.join() === '2,1', '추정 쪽이 옛날 쪽 → 최근 쪽으로', r.calls);
r = await kp(days[30], 2); ok(r.status === 200 && r.calls.length === 0, '같은 날짜 두 번째 → 보관본(원본 안 부름)', r.calls);
r = await kp('2025-06-02', 4); ok(r.status === 200 && r.text === 'first=' + ymd(days[0]) && r.calls.join() === '4', '자료 시작 전 날짜 → 200 "first=자료 첫날" (마지막 쪽이 60줄 미만이면 바로 · 콘솔 오류 없게)', r);
r = await kp('2025-05-01', 9); ok(r.status === 200 && r.text === 'first=' + ymd(days[0]) && r.calls.length <= 6, '추정 쪽이 자료 끝 너머 → 앞으로 옮겨 자료 첫날 찾음', r);
r = await kp('2025-05-01', 9); ok(r.status === 200 && r.text === 'first=' + ymd(days[0]) && r.calls.length === 0, '자료 첫날 답도 보관', r);
r = await kp('2027-01-04', 1); ok(r.status === 404 && r.calls.join() === '1', '미래 날짜 → 404', r);
const bad = await W.etfPage(env, new URL('https://x/etf?m=kp&s=../x&d=20260105&g=1'), cors, json); ok(bad.status === 400, '잘못된 코드 → 400', bad.status);
upstreamDown = true; r = await kp(days[150], gOf(150)); ok(r.status === 502, '원본 오류(보관본 없음) → 502', r.status);
r = await kp(days[30], 2); ok(r.status === 200 && r.calls.length === 0, '원본 오류여도 보관본은 그대로', r.status); upstreamDown = false;
const yv = JSON.stringify({ chart: { result: [{ meta: { gmtoffset: 32400 }, timestamp: [1733184000, 1733270400, 1733356800], indicators: { quote: [{ open: [9840, null, 9800], close: [9925, 9830, null] }] } }] } });
ok(W.yahooRows(yv) === '20241203,9840,9925\n20241204,,9830', '야후 줄: 현지 날짜 · 시가 없는 날 빈칸 · 종가 없는 날 뺌', W.yahooRows(yv));
ok(W.yahooRows('{"chart":{"result":[{}]}}') === '', '야후 자료 없음 → 빈 문자열', '');
// 상장 전 백테스트 재료: 야후 기호(지수·선물·환율·해외 종목·클래스 주식) 허용 · 이상한 기호·너무 긴 기호는 거절 · 네이버 지수·종목 코드
const okU = ['SPY', '^SP500TR', 'GC=F', '7203.T', 'BRK-B', '000001.SS', 'ERIC-B.ST', 'NZDUSD=X', 'BTC-USD', 'BAJAJ-AUTO.BO'].filter(x => !W.etfSource('u', x));
ok(!okU.length, 'm=u 백테스트 재료 기호 허용', okU);
const badU = ['', 'a b', '../x', 'spy', 'ABCDEFGHIJKLMNOPQ', '^^GSPC', 'SPY&x=1'].filter(x => W.etfSource('u', x));
ok(!badU.length, 'm=u 이상한 기호 거절', badU);
ok(['KOSPI', 'KPI200', '069500', '0167A0'].every(x => W.etfSource('k', x)) && !W.etfSource('k', 'KOSPI;') && !W.etfSource('k', 'abc'), 'm=k 국내 지수·종목 코드', '');
// ── 실시간 시세 /q (야후 1분봉 마지막 체결가 · 프리·정규·애프터 · 15초 메모리 보관) ──
const qa = src.indexOf('const Q_TTL'), qb = src.indexOf('export default');
if (qa < 0 || qb < 0 || qb < qa) { console.log('FAIL Worker 에서 /q(liveQuote) 구간을 찾지 못함'); process.exit(1); }
const Q = new Function('CNN_UA', src.slice(qa, qb) + '\nreturn { yQuote, liveQuote, QC, yReg, liveQuotes, QSC };')('test');
const S = 1791878400, TP = { pre: { start: S, end: S + 19800 }, regular: { start: S + 19800, end: S + 43200 }, post: { start: S + 43200, end: S + 57600 } };   // 2026-10-13 04:00 EDT 부터
const yj = (bars, meta = {}) => JSON.stringify({ chart: { result: [{ meta: Object.assign({ symbol: 'SOXL', gmtoffset: -14400, regularMarketPrice: 128.4, regularMarketTime: S - 14400, chartPreviousClose: 127.1, currentTradingPeriod: TP }, meta),
  timestamp: bars.map((x) => x[0]), indicators: { quote: [{ close: bars.map((x) => x[1]) }] } }] } });
let q = Q.yQuote(yj([[S + 60, 121.29], [S + 600, 121.333333]]), S + 700);
ok(q && q.p === 121.3333 && q.t === S + 600 && q.ps === 'pre' && q.ses === 'pre' && q.rp === 128.4 && q.pc === 127.1, '/q 프리장: 마지막 1분봉 = 지금 가격 (정규장 가격은 전일 종가 그대로)', q);
q = Q.yQuote(yj([[S + 20000, 125], [S + 30000, 125.502], [S + 30060, null]], { regularMarketPrice: 125.502 }), S + 30070);
ok(q && q.p === 125.502 && q.t === S + 30000 && q.ps === 'reg' && q.ses === 'reg', '/q 정규장: 아직 체결 없는 마지막 분(null)은 건너뜀', q);
q = Q.yQuote(yj([[S + 30000, 125.5], [S + 50000, 126.75], [S + 50060, null]]), S + 50100);
ok(q && q.p === 126.75 && q.ps === 'post' && q.ses === 'post', '/q 애프터장 가격', q);
q = Q.yQuote(yj([[S + 50000, 126.75]]), S + 60000);
ok(q && q.p === 126.75 && q.ps === 'post' && q.ses === 'closed', '/q 애프터장 끝난 뒤 = 장 마감 · 마지막 체결가(애프터)', q);
const MON = { pre: { start: S + 6 * 86400, end: S + 6 * 86400 + 19800 }, regular: { start: S + 6 * 86400 + 19800, end: S + 6 * 86400 + 43200 }, post: { start: S + 6 * 86400 + 43200, end: S + 6 * 86400 + 57600 } };
q = Q.yQuote(yj([[S + 3 * 86400 + 57540, 119.9]], { currentTradingPeriod: MON }), S + 4 * 86400);
ok(q && q.p === 119.9 && q.ps === 'post' && q.ses === 'closed', '/q 주말(시간표가 다음 거래일): 금요일 19:59 체결 = 애프터 · 장 마감', q);
q = Q.yQuote(yj([], { regularMarketPrice: 130.12, regularMarketTime: S + 43200 }), S + 43300);
ok(q && q.p === 130.12 && q.t === S + 43200 && q.ses === 'post', '/q 1분봉이 없으면 정규장 가격', q);
ok(Q.yQuote('{x', S) === null && Q.yQuote('{"chart":{"result":[]}}', S) === null && Q.yQuote(yj([[S, null]], { regularMarketPrice: null }), S) === null, '/q 깨진 응답·빈 응답·가격 없음 → null', '');
let qcalls = [], qmode = 'ok';
globalThis.fetch = async (u) => { qcalls.push(u); if (qmode === '404') return { ok: false, status: 404, text: async () => '{}' };
  if (qmode === 'down') return { ok: false, status: 503, text: async () => '' }; return { ok: true, status: 200, text: async () => yj([[S + 30000, 125.5]]) }; };
const qreq = async (s, c = cors) => { const r = await Q.liveQuote(new URL('https://x/q?s=' + s), c, json); return { status: r.status, j: JSON.parse(await r.text()) }; };
let qr = await qreq('soxl', { ok: false, headers: {} }); ok(qr.status === 403 && !qcalls.length, '/q 다른 사이트에서 부르면 403 (원본 안 부름)', qr);
qr = await qreq('a%20b'); ok(qr.status === 400 && !qcalls.length, '/q 이상한 기호 → 400', qr);
qr = await qreq('..%2Fx'); ok(qr.status === 400 && !qcalls.length, '/q 경로 기호 → 400', qr);
qr = await qreq('soxl'); ok(qr.status === 200 && qr.j.s === 'SOXL' && qr.j.p === 125.5 && qcalls.length === 1 && /\/chart\/SOXL\?interval=1m&range=1d&includePrePost=true$/.test(qcalls[0]), '/q 정상 · 대문자 · 1분봉 프리·애프터 포함 주소', [qr, qcalls]);
qr = await qreq('SOXL'); ok(qr.status === 200 && qcalls.length === 1, '/q 15초 안 같은 기호 → 메모리 보관본 (원본 안 부름)', qcalls.length);
qr = await qreq('%5EGSPC'); ok(qr.status === 200 && qcalls.length === 2 && qcalls[1].indexOf('/chart/%5EGSPC?') > 0, '/q 지수 기호(^) 인코딩', qcalls[1]);
const realNow = Date.now; Date.now = () => realNow() + 16000; qmode = 'down';
qr = await qreq('SOXL'); ok(qr.status === 200 && qr.j.stale === 1 && qr.j.p === 125.5 && qcalls.length === 3, '/q 15초 지나 원본 오류 → 직전 값(stale)', qr);
qr = await qreq('TQQQ'); ok(qr.status === 502, '/q 원본 오류 · 보관본 없음 → 502', qr);
qmode = '404'; qr = await qreq('ZZZZ'); ok(qr.status === 404, '/q 없는 기호 → 404', qr);
Date.now = realNow;
// ── 여러 종목 정규장 가격 /qs (반도체 지수 분석 실시간 · 일봉 1일치 meta · 60초 보관 · 8개씩) ──
const ym = (meta) => JSON.stringify({ chart: { result: [{ meta: Object.assign({ symbol: 'NVDA', gmtoffset: -18000, regularMarketPrice: 190.123456, regularMarketTime: 1794330000, chartPreviousClose: 186.64 }, meta) }] } });
let g = Q.yReg(ym({}));
ok(g && g.rp === 190.1235 && g.rt === 1794330000 && g.pc === 186.64 && g.d === new Date((1794330000 - 18000) * 1000).toISOString().slice(0, 10), '/qs 야후 meta → 정규장 가격·시각·거래소 날짜·전일 종가', g);
ok(Q.yReg(ym({ regularMarketTime: 1794366000 })).d === '2026-11-10' && Q.yReg(ym({ regularMarketTime: 1794376800 })).d === '2026-11-11', '/qs 거래소 날짜 = 현지 시각 기준(UTC 날짜 아님)', '');
ok(Q.yReg('{x') === null && Q.yReg(ym({ regularMarketPrice: null })) === null && Q.yReg(ym({ regularMarketTime: 0 })) === null, '/qs 깨진 응답·가격·시각 없음 → null', '');
let scalls = [], smode = 'ok';
globalThis.fetch = async (u) => { scalls.push(u); if (smode === 'down') return { ok: false, status: 503, text: async () => '' };
  const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]); return { ok: true, status: 200, text: async () => (sym === 'BAD' ? '{}' : ym({ symbol: sym, regularMarketPrice: 100 + scalls.length })) }; };
const sreq = async (s, c = cors) => { const r = await Q.liveQuotes(new URL('https://x/qs?s=' + s), c, json); return { status: r.status, j: JSON.parse(await r.text()) }; };
let sr = await sreq('NVDA,AMD', { ok: false, headers: {} }); ok(sr.status === 403 && !scalls.length, '/qs 다른 사이트 → 403', sr);
sr = await sreq('NVDA,a%20b'); ok(sr.status === 400 && !scalls.length, '/qs 이상한 기호 → 400', sr);
sr = await sreq(Array.from({ length: 46 }, (_, i) => 'T' + i).join(',')); ok(sr.status === 400 && !scalls.length, '/qs 46개 넘음 → 400', sr.status);
sr = await sreq(''); ok(sr.status === 400, '/qs 빈 목록 → 400', sr.status);
const L = ['nvda', 'AMD', 'NVDA', 'KRW=X', '^SOX', 'BAD'].concat(Array.from({ length: 10 }, (_, i) => 'Z' + i));
sr = await sreq(L.map(encodeURIComponent).join(','));
ok(sr.status === 200 && Object.keys(sr.j.q).length === 15 && sr.j.q.NVDA.rp > 100 && sr.j.q['KRW=X'].rp > 100 && sr.j.q['^SOX'] && sr.j.q.BAD === null && scalls.length === 15
  && scalls.every((u) => /\?interval=1d&range=1d$/.test(u)) && scalls.some((u) => u.indexOf('/chart/%5ESOX?') > 0), '/qs 여러 종목 · 대문자·중복 제거 · 못 받은 종목 null · 일봉 1일치 주소', [Object.keys(sr.j.q).length, scalls.length]);
const n0 = scalls.length; sr = await sreq('NVDA,AMD'); ok(sr.status === 200 && scalls.length === n0 && sr.j.q.NVDA.rp > 100 && sr.j.q.AMD.rp > 100, '/qs 60초 안 → 메모리 보관본(원본 안 부름)', scalls.length - n0);
const realNow2 = Date.now; Date.now = () => realNow2() + 61000; smode = 'down';
sr = await sreq('NVDA,QQQ'); ok(sr.status === 200 && sr.j.q.NVDA && sr.j.q.NVDA.stale === 1 && sr.j.q.QQQ === null, '/qs 60초 지나 원본 오류 → 직전 값(stale) · 처음 종목은 null', sr.j);
Date.now = realNow2;
console.log('Worker ETF 실제 가격 경로: ok ' + oks + ' · fail ' + fails);
process.exit(fails ? 1 : 0);
