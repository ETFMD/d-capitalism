// Worker 72루틴 PC 생존 감시(/hb) 단독 확인 (node tests/worker_hb_test.mjs · run_regression.py 가 부름)
//  · 등록(알림 대상 암호화 저장 · 원문은 D1 에 없음) · 열쇠 해시만 저장 · 알림 대상 없이 처음 오면 need:cred · HB_KEY 없으면 등록 거절
//  · cron: 주문 시각 + 20분 지나도 신호 없음 → 텔레그램 1번 · 마감 1시간 전 한 번 더 · 신호 오면 '다시 들어옴' · 72시간 조용 → 하루 1번 3번까지 · 30일 → 지움
//  · 같은 텔레그램 · 다른 PC 가 3시간 안에 신호 → '두 PC' 경고 + 옛 기록 정리 · 같은 PC(mid 같음)가 열쇠만 바뀌면 경고 없음
//  · 남용: 30개 한도 · 4KB · 잘못된 열쇠·토큰 모양 거절 · 보내기 실패하면 다음 cron 에 다시(세 번까지)
// D1·fetch 는 모의 (hb.js 의 SQL 문장을 그대로 받아 메모리 표로)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
// worker/src/hb.js 는 ES 모듈 문법인데 package.json 에 type:module 이 없어 → 임시 .mjs 사본으로 불러옴 (Node 버전과 상관없이)
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hbt-')), 'hb.mjs');
fs.copyFileSync(path.join(ROOT, 'worker', 'src', 'hb.js'), tmp);
const { hb, hbScan, _test } = await import(pathToFileURL(tmp).href);

const Q = _test.SQL, rows = new Map();
const D1 = { prepare(sql) { return { bind: (...a) => ({ first: async () => exec(sql, a, 'first'), all: async () => ({ results: exec(sql, a, 'all') }), run: async () => exec(sql, a, 'run') }), first: async () => exec(sql, [], 'first'), all: async () => ({ results: exec(sql, [], 'all') }) }; } };
function exec(sql, a) {
  if (sql === Q.get) return rows.get(a[0]) || null;
  if (sql === Q.count) return { n: rows.size };
  if (sql === Q.trim) { for (const [k, r] of rows) if (r.last < a[0]) rows.delete(k); return {}; }
  if (sql === Q.del) { rows.delete(a[0]); return {}; }
  if (sql === Q.same) return [...rows.values()].filter((r) => r.tgh === a[0] && r.id !== a[1]).map((r) => ({ id: r.id, mid: r.mid, last: r.last, alarm: r.alarm }));
  if (sql === Q.dropSame) { for (const [k, r] of rows) if (r.tgh === a[0] && r.id !== a[1]) rows.delete(k); return {}; }
  if (sql === Q.put) { const [id, tgh, mid, cred, last, next, cut, ds, st, alarm, created] = a; const old = rows.get(id); rows.set(id, { id, tgh, mid, cred, last, next, cut, ds, st, alarm, created: old ? old.created : created }); return {}; }
  if (sql === Q.all) return [...rows.values()].map((r) => ({ ...r }));
  if (sql === Q.alarm) { const r = rows.get(a[1]); if (r) r.alarm = a[0]; return {}; }
  if (sql === Q.noCred) { const r = rows.get(a[0]); if (r) r.cred = null; return {}; }
  throw new Error('모르는 SQL: ' + sql);
}
let sent = [], tgDown = false;
globalThis.fetch = async (u, o) => { const b = JSON.parse(o.body); sent.push({ u: String(u), b }); return { ok: !(tgDown && /telegram/.test(u)), status: tgDown ? 502 : 200 }; };
let clock = Date.UTC(2026, 9, 16, 8, 0);   // 17:00 KST
const realNow = Date.now; Date.now = () => clock;
const env = { DB: D1, HB_KEY: 'k'.repeat(64) };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const post = async (body, e = env) => { const r = await hb(new Request('https://w/hb', { method: 'POST', body: JSON.stringify(body) }), e, json); return { status: r.status, j: await r.json() }; };
let fails = 0, oks = 0;
const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
const KEY = 'A'.repeat(30) + 'pc1', TG = { token: '123456789:' + 'x'.repeat(35), chat: '987654321' }, MID = 'ab'.repeat(16);
const M = 60e3, H = 3600e3;

let r = await post({ key: KEY, next: clock + 5 * M });
ok(r.j.ok === false && r.j.need === 'cred', '알림 대상 없이 처음 → need:cred', r.j);
r = await post({ key: KEY, cred: { tg: TG } }, { DB: D1 });
ok(r.status === 503 && rows.size === 0, 'HB_KEY 없으면 알림 대상을 받지 않음(원문 저장 안 함)', r);
r = await post({ key: 'short', cred: { tg: TG } }); ok(r.status === 400, '열쇠 모양 틀림 → 400', r);
r = await post({ key: KEY, cred: { tg: { token: 'bad', chat: '1' } } }); ok(r.status === 400, '토큰 모양 틀림 → 400', r);
r = await post({ key: KEY, cred: { nt: 'http://evil/x' } }); ok(r.status === 400, 'ntfy 주소 https 아님 → 400', r);
r = await post({ key: KEY, pad: 'x'.repeat(5000) }); ok(r.status === 413, '4KB 넘음 → 413', r.status);
const next = clock + 5 * M, cut = clock + 11 * H + 48 * M;
r = await post({ key: KEY, next, cut, ds: '2026-10-16', mid: MID, st: { en: true }, cred: { tg: TG, nt: 'https://ntfy.sh/r72-abcdefghijkmnpqrstuvwx' } });
const id = (await _test.hex('r72hb|' + KEY)).slice(0, 32), row = rows.get(id);
ok(r.j.ok && r.j.cred && row && !JSON.stringify(row).includes(TG.token) && !JSON.stringify(row).includes(KEY) && row.cred.includes('.'), '등록: 열쇠 해시만 · 토큰은 암호문으로', row);
ok(!sent.length, '등록만으로는 알림 없음', sent);
// 주문 시각 + 20분 전 → 조용 · 지나면 1번 (텔레그램 + ntfy)
clock = next + 15 * M; ok(await hbScan(env, clock) === 0 && !sent.length, '주문 시각 + 15분 → 아직 알림 없음', sent);
clock = next + 21 * M; let n = await hbScan(env, clock);
ok(n === 1 && sent.length === 2 && sent.some((x) => /telegram/.test(x.u) && x.b.chat_id === TG.chat && /PC 신호 없음/.test(x.b.text) && /접수 마감/.test(x.b.text)) && sent.some((x) => /ntfy\.sh\/$/.test(x.u) && x.b.topic === 'r72-abcdefghijkmnpqrstuvwx' && x.b.priority === 5),
  '주문 시각 + 21분 → 텔레그램·ntfy 로 PC 신호 없음', sent);
sent = []; clock += 15 * M; ok(await hbScan(env, clock) === 0 && !sent.length, '같은 주문 시각은 한 번만', sent);
clock = cut - 59 * M; await hbScan(env, clock); ok(sent.length === 2 && /1시간 남았/.test(sent[0].b.text), '마감 1시간 전 한 번 더', sent);
sent = []; clock = cut - 30 * M; await hbScan(env, clock); ok(!sent.length, '두 번째 알림도 한 번만', sent);
// 신호 다시 → '다시 들어옴'
r = await post({ key: KEY, next: clock + 20 * H, cut: clock + 30 * H, mid: MID });
ok(r.j.ok && sent.length === 2 && /다시 들어왔어요/.test(sent[0].b.text), '알림 뒤 신호 → 다시 들어옴', sent);
sent = []; r = await post({ key: KEY, next: clock + 20 * H, mid: MID }); ok(!sent.length, '다시 들어옴도 한 번만', sent);
// 72시간 조용 → 하루 1번 · 3번까지
const quiet = rows.get(id).last; rows.get(id).next = null;
clock = quiet + 71 * H; await hbScan(env, clock); ok(!sent.length, '71시간 → 아직', sent);
let cnt = 0; for (let d = 0; d < 6; d++) { clock = quiet + 72 * H + d * 24 * H + 60e3; sent = []; await hbScan(env, clock); cnt += sent.filter((x) => /telegram/.test(x.u)).length; }
ok(cnt === 3, '72시간 조용 → 하루 1번, 3번까지', cnt);
// 텔레그램 실패 → 다음 cron 에 다시 (ntfy 도 실패하게 대상에서 빼고)
rows.clear(); sent = []; clock = Date.UTC(2026, 9, 20, 8, 0);
await post({ key: KEY, next: clock + 5 * M, cut: clock + 10 * H, mid: MID, cred: { tg: TG } });
tgDown = true; clock += 26 * M; await hbScan(env, clock); clock += 15 * M; await hbScan(env, clock);
const tries = sent.length; tgDown = false; sent = []; clock += 15 * M; await hbScan(env, clock);
ok(tries === 2 && sent.length === 1 && /PC 신호 없음/.test(sent[0].b.text), '보내기 실패 → 다음 cron 에 다시', [tries, sent.length]);
// 두 PC — 같은 텔레그램 · 다른 mid 가 3시간 안 → 경고 + 옛 기록 정리 / 같은 mid(같은 PC 가 열쇠만 새로) → 경고 없음
rows.clear(); sent = []; clock = Date.UTC(2026, 9, 21, 8, 0);
await post({ key: KEY, mid: MID, cred: { tg: TG } });
const KEY2 = 'B'.repeat(30) + 'pc2';
r = await post({ key: KEY2, mid: 'cd'.repeat(16), cred: { tg: TG } });
ok(r.j.ok && sent.length === 1 && /다른 PC/.test(sent[0].b.text) && rows.size === 1, '같은 텔레그램 · 다른 PC 3시간 안 → 두 PC 경고 · 옛 기록 정리', [sent.length, rows.size]);
sent = []; const KEY3 = 'C'.repeat(30) + 'pc3';
r = await post({ key: KEY3, mid: 'cd'.repeat(16), cred: { tg: TG } });
ok(r.j.ok && !sent.length && rows.size === 1, '같은 PC(mid 같음)가 열쇠만 새로 → 경고 없이 이어받음', [sent, rows.size]);
// 두 PC 가 번갈아 등록(서로 기록을 지우고 새로) → 경고는 6시간에 한 번만 (지운 기록의 경고 시각 이어받음)
sent = []; for (let i = 0; i < 6; i++) { clock += 25 * M; await post(i % 2 ? { key: KEY3, mid: 'cd'.repeat(16), cred: { tg: TG } } : { key: KEY, mid: MID, cred: { tg: TG } }); }
const flip1 = sent.length; clock += 6 * H; sent = []; await post({ key: KEY, mid: MID, cred: { tg: TG } }); await post({ key: KEY3, mid: 'cd'.repeat(16), cred: { tg: TG } });
ok(flip1 === 0 && sent.length === 1 && /다른 PC/.test(sent[0].b.text), '두 PC 번갈아 등록 → 6시간 안 경고 다시 없음 · 6시간 뒤 한 번', [flip1, sent.length]);
// HB_KEY 가 바뀌어 알림 대상을 못 풂 → 지움 → 다음 신호에 need:cred → 다시 받음
rows.clear(); sent = []; clock = Date.UTC(2026, 9, 22, 8, 0);
await post({ key: KEY, mid: MID, next: clock + 5 * M, cut: clock + 10 * H, cred: { tg: TG } });
const env2 = { DB: D1, HB_KEY: 'z'.repeat(64) };
clock += 26 * M; await hbScan(env2, clock);
const rr = rows.get(id); r = await post({ key: KEY, mid: MID, next: clock + 20 * H }, env2);
const r2 = await post({ key: KEY, mid: MID, next: clock + 20 * H, cred: { tg: TG } }, env2);
ok(rr.cred === null && !sent.length && r.j.need === 'cred' && r2.j.ok && rows.get(id).cred, '알림 대상을 못 풂(HB_KEY 바뀜) → 지움 → need:cred → 다시 받음', [rr.cred, r.j, r2.j]);
rows.clear(); sent = []; await post({ key: KEY3, mid: 'cd'.repeat(16), cred: { tg: TG } });
// bye · 30일 · 한도
r = await post({ key: KEY3, bye: true }); ok(r.j.ok && rows.size === 0, 'bye → 기록 지움', rows.size);
await post({ key: KEY, mid: MID, cred: { tg: TG } }); clock += 31 * 24 * H; await hbScan(env, clock); ok(rows.size === 0, '30일 넘게 조용 → 지움', rows.size);
for (let i = 0; i < _test.MAX_ROWS; i++) await post({ key: 'K'.repeat(28) + String(i).padStart(4, '0'), cred: { tg: { token: '123456789:' + String(i).padStart(35, 'y'), chat: String(i + 1) } } });
r = await post({ key: 'Z'.repeat(30), cred: { tg: TG } });
ok(r.status === 429 && rows.size === _test.MAX_ROWS, '30개 한도 → 429', [r.status, rows.size]);
clock += 8 * 24 * H; r = await post({ key: 'Z'.repeat(30), cred: { tg: TG } });
ok(r.j.ok && rows.size === 1, '7일 넘게 조용한 기록부터 정리하고 받음', rows.size);
// (2026-10-22) 전략별 일정 sch — 1시간 전 미리 알림(그 전 깨우기 실행 뒤 신호 없음) · 시각 뒤 알림은 전략 이름으로(SMA 200 은 +5분) · 제때 깬 PC 는 알리지 않음 · sch 정리
{
  rows.clear(); sent = []; clock = Date.UTC(2026, 9, 22, 17, 0);   // 한국 10/23 02:00
  const tSma = Date.UTC(2026, 9, 22, 19, 38), cSma = tSma + 10 * M, ndSma = Date.UTC(2026, 9, 22, 18, 8);   // 한국 04:38 판단 · 04:48 마감 · 03:08 뒤 신호 필요
  const t72 = Date.UTC(2026, 9, 23, 8, 5), c72 = Date.UTC(2026, 9, 23, 19, 48), nd72 = Date.UTC(2026, 9, 23, 1, 10);   // 한국 17:05 주문 · 다음 날 04:48 마감 · 10:10 실행 뒤 신호 필요
  const SCH = [{ w: 'sma', n: tSma, c: cSma, nd: ndSma }, { w: '72', n: t72, c: c72, nd: nd72 }];
  await post({ key: KEY, mid: MID, next: tSma, cut: cSma, st: { en: true, sch: SCH }, cred: { tg: TG, nt: 'https://ntfy.sh/r72-abcdefghijkmnpqrstuvwx' } });
  ok(JSON.parse(rows.get(id).st).sch.length === 2, 'sch 를 st 안에 저장(표 모양 그대로)', rows.get(id).st);
  clock = tSma - 61 * M; await hbScan(env, clock); ok(!sent.length, '1시간 전보다 앞 → 알림 없음', sent);
  clock = tSma - 55 * M; await hbScan(env, clock);
  const tx = sent.map((x) => x.b.text || x.b.message);
  ok(sent.length === 2 && /^\[72루틴 SMA 200 생존 감시\] ⏰ PC 신호 없음\(미리 알림\) — SMA 200 마감 전 판단 시각\(10\/23 4:38|^\[72루틴 SMA 200 생존 감시\] ⏰ PC 신호 없음\(미리 알림\) — SMA 200 마감 전 판단 시각\(10\/23 04:38/.test(tx[0]) && /55분 남았/.test(tx[0]) && sent[1].b.title === '72루틴 SMA 200 생존 감시' && !tx.some((x) => /72루틴 주문/.test(x)),
    '마지막 신호(02:00)가 03:08 앞 + 1시간 안 → SMA 200 미리 알림(텔레그램·ntfy) · 72루틴은 아직 아님', tx);
  sent = []; clock += 15 * M; await hbScan(env, clock); ok(!sent.length, '미리 알림은 한 번만', sent);
  clock = tSma - 30 * M; r = await post({ key: KEY, mid: MID, next: tSma, cut: cSma, st: { en: true, sch: SCH } });
  ok(sent.length === 2 && /다시 들어왔어요/.test(sent[0].b.text), '미리 알림 뒤 PC 가 켜짐 → 다시 들어옴', sent.map((x) => x.b.text));
  sent = []; clock = tSma + 4 * M; await hbScan(env, clock); ok(!sent.length, 'SMA 200 판단 시각 + 4분 → 아직', sent);
  clock = tSma + 6 * M; await hbScan(env, clock);
  ok(sent.length === 2 && /SMA 200 마감 전 판단 시각\(10\/23 04:38\)이 6분 지났는데/.test(sent[0].b.text) && /접수 마감\(10\/23 04:48\) 전에 프로그램이 돌면/.test(sent[0].b.text), 'SMA 200 판단 시각 + 5분 넘어 신호 없음 → SMA 200 이름으로 · 마감 전이면 아직 할 수 있다고', sent.map((x) => x.b.text));
  // 판단 뒤 PC 가 돌아와 다음 날 일정으로 신호 → 72루틴은 10:10 실행 뒤 신호가 있음(제때 깸) → 16:05 미리 알림 없음
  sent = []; clock = Date.UTC(2026, 9, 23, 1, 12); const SCH2 = [{ w: 'sma', n: tSma + 24 * H, c: cSma + 24 * H, nd: ndSma + 24 * H }, { w: '72', n: t72, c: c72, nd: nd72 }];
  await post({ key: KEY, mid: MID, next: t72, cut: c72, st: { en: true, sch: SCH2 } }); sent = [];
  clock = t72 - 50 * M; await hbScan(env, clock); ok(!sent.length, '그 전 깨우기 실행(10:10) 뒤 신호가 있음 → 절전 중이어도 미리 알림 없음', sent.map((x) => x.b.text));
  clock = t72 + 21 * M; await hbScan(env, clock);
  ok(sent.length === 2 && /^\[72루틴 SMA 200 생존 감시\] 🚨 PC 신호 없음 — 72루틴 주문 시각\(10\/23 17:05\)이 21분 지났는데/.test(sent[0].b.text), '72루틴 주문 시각 + 20분 → 72루틴 이름으로', sent.map((x) => x.b.text));
  sent = []; clock = c72 - 59 * M; await hbScan(env, clock); ok(sent.length === 2 && /72루틴 LOC 접수 마감\(10\/24 04:48\)까지 1시간 남았어요/.test(sent[0].b.text), '72루틴 접수 마감 1시간 전 한 번 더', sent.map((x) => x.b.text));
  sent = []; clock += 15 * M; await hbScan(env, clock); ok(sent.filter((x) => /telegram/.test(x.u)).every((x) => !/72루틴 LOC 접수 마감/.test(x.b.text)), '마감 1시간 전 알림도 한 번만', sent.map((x) => x.b.text));
  // 1시간 전인데 그 전 깨우기 실행 뒤 신호가 없음(깨우기 실패) → 72루틴 미리 알림
  rows.clear(); sent = []; clock = Date.UTC(2026, 9, 23, 0, 0);   // 한국 09:00 마지막 신호
  await post({ key: KEY, mid: MID, next: t72, cut: c72, st: { en: true, sch: [{ w: '72', n: t72, c: c72, nd: nd72 }] }, cred: { tg: TG } }); sent = [];
  clock = t72 - 58 * M; await hbScan(env, clock);
  ok(sent.length === 1 && /72루틴 주문 시각\(10\/23 17:05\)까지 58분 남았는데, PC 프로그램 신호가 10\/23 09:00 뒤로 없어요\(10\/23 10:10 무렵에는 실행됐어야 해요\)/.test(sent[0].b.text), '72루틴: 10:10 깨우기 뒤 신호 없음 → 16:07 미리 알림', sent.map((x) => x.b.text));
  // (독립 검토) PC 시계가 몇 초 빨라 예정 실행(10:10) 신호가 10:09:50 에 찍힘 → 미리 알림 없음 · 6분 앞이면 알림
  for (const [lead, want] of [[10e3, 0], [6 * M, 1]]) {
    rows.clear(); sent = []; clock = nd72 - lead;
    await post({ key: KEY, mid: MID, next: t72, cut: c72, st: { en: true, sch: [{ w: '72', n: t72, c: c72, nd: nd72 }] }, cred: { tg: TG } }); sent = [];
    clock = t72 - 50 * M; await hbScan(env, clock);
    ok(sent.length === want, lead < M ? 'PC 시계가 10초 빠름(예정 실행 신호가 nd 보다 10초 앞) → 미리 알림 없음(5분 여유)' : '예정 실행보다 6분 앞이 마지막 신호 → 미리 알림', sent.map((x) => x.b.text));
  }
  // (독립 검토) 72루틴 시각 뒤 알림은 일정의 72루틴 시각·마감으로 — next 가 SMA 200 시각(두 전략 중 빠른 것)이어도
  rows.clear(); sent = []; clock = Date.UTC(2026, 9, 22, 17, 0);
  await post({ key: KEY, mid: MID, next: tSma, cut: cSma, st: { en: true, sch: [{ w: '72', n: t72, c: c72, nd: nd72 }] }, cred: { tg: TG } }); sent = [];
  clock = t72 + 25 * M; await hbScan(env, clock);
  const t72msg = (sent.find((x) => /72루틴 주문 시각/.test(x.b.text || '')) || { b: { text: '' } }).b.text;
  ok(/72루틴 주문 시각\(10\/23 17:05\)이 25분 지났는데/.test(t72msg) && /LOC 접수 마감\(10\/24 04:48\) 전에/.test(t72msg) && !/04:38\)이/.test(t72msg), '72루틴 알림 = 일정의 72루틴 시각(17:05)·마감(다음 날 04:48) — next(SMA 200 04:38)가 아니라', sent.map((x) => x.b.text));
  // sch 정리 — 모르는 전략·잘못된 시각은 버림 · 같은 전략 둘이면 앞의 것 · 4개까지
  const cs = _test.cleanSch([{ w: 'x', n: 1 }, { w: '72', n: -5 }, { w: 'sma', n: 1e12, c: 'a', nd: 9e12 }, { w: 'sma', n: 2e12 }, { w: '72', n: 1.5e12, nd: 1.4e12 }, { w: '72', n: 1.6e12 }]);
  ok(JSON.stringify(cs) === JSON.stringify([{ w: 'sma', n: 1e12, c: null, nd: null }]), 'sch 정리(모르는 전략·잘못된 값 버림 · 4개까지만 봄 · 전략마다 하나)', cs);
}
const g = await hb(new Request('https://w/hb'), env, json), gj = await g.json();
ok(gj.ok && gj.ready === true && gj.now === clock, 'GET /hb → 준비됨·지금 시각', gj);
Date.now = realNow;
console.log((fails ? '실패 ' + fails + '건 · ' : '') + 'worker_hb_test: ' + oks + '개 통과');
process.exit(fails ? 1 : 0);
