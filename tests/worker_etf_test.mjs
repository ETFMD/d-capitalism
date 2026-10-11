// Worker ETF 차트 비교 실제 가격 경로 단독 확인 (node tests/worker_etf_test.mjs · run_regression.py 가 부름)
//  · yahooRows: 야후 일봉 → "YYYYMMDD,시가,종가" 줄 (거래소 현지 날짜 · 시가 없는 날은 빈칸 · 종가 없는 날은 뺌)
//  · etfPage(m=kp): 네이버 일별 시세 쪽 찾기 — 추정 쪽이 어긋나도 앞뒤로 옮겨 찾음 · 보관본
//    · 자료 시작 전 날짜 = 200 "first=자료 첫날"(보관) · 미래 날짜 404 · 잘못된 코드 400 · 원본 오류 502
// fetch·D1 은 모의 (m.stock 처럼 1쪽 = 가장 최근 60거래일, 최신이 앞)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.js'), 'utf8');
const a = src.indexOf('const KP_TTL'), b = src.indexOf('async function etfChart');
if (a < 0 || b < 0) { console.log('FAIL Worker 에서 etfPage·yahooRows 구간을 찾지 못함'); process.exit(1); }
const W = new Function('CNN_UA', src.slice(a, b) + '\nreturn { etfPage, yahooRows };')('test');

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
console.log('Worker ETF 실제 가격 경로: ok ' + oks + ' · fail ' + fails);
process.exit(fails ? 1 : 0);
