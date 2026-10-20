// Worker 방문자 수(POST /hit · worker/src/index.js hit()) 단독 확인 (node tests/worker_visit_test.mjs · run_regression.py 가 부름)
//  · 네이버 애널리틱스 '방문자수'와 같은 기준: 브라우저 번호(id)마다 하루(한국 시간) 1번 — 같은 IP 의 다른 브라우저는 따로 셈 (예전 IP 기준과 다른 점)
//  · 같은 브라우저 다시 → 그대로 · 날짜가 바뀌면 다시 1번 · 번호 원문·IP 원문은 D1 에 없음(해시만)
//  · 번호 없는 요청(예전 화면 캐시) → IP 기준 · 잘못된 번호 → IP 기준
//  · 남용 막기: 같은 IP 에서 하루 새 번호 VISIT_IP_MAX(40)개까지 · 다른 IP 는 영향 없음
//  · 검색봇·크롤러 UA · 허용되지 않은 출처 · UA 없음 → 세지 않음 (숫자는 돌려줌)
//  · 진짜 SQLite(node:sqlite)에 worker/schema.sql 전체 → Worker fetch 그대로
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let DatabaseSync;
try {
  const ew = process.emitWarning; process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : ew.call(process, w, ...a));
  ({ DatabaseSync } = await import('node:sqlite').finally(() => { process.emitWarning = ew; }));
} catch (e) {
  console.log('worker_visit_test: node:sqlite 없음 (Node 22.13+ 필요 · 지금 ' + process.version + ')');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visitt-'));
for (const f of fs.readdirSync(path.join(ROOT, 'worker', 'src'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'worker', 'src', f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
const plain = (r) => (r ? { ...r } : null);
function stmt(sql, args) {
  const ex = () => {
    const s = db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: s.all(...args).map(plain), meta: {} };
    const r = s.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  return { bind: (...a) => stmt(sql, a), first: async () => plain(db.prepare(sql).get(...args)), all: async () => ex(), run: async () => ex(), _ex: ex };
}
const DB = { prepare: (sql) => stmt(sql, []), batch: async (list) => { db.exec('BEGIN'); try { const o = list.map((s) => s._ex()); db.exec('COMMIT'); return o; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const SITE = 'https://d-capitalism.com';
const env = { DB, SALT: 'visit-test-salt', ALLOWED_ORIGINS: SITE };
let clock = Date.UTC(2026, 9, 20, 6, 0);   // 15:00 KST
Date.now = () => clock;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
async function hit({ id, ip = '1.2.3.4', ua = UA, origin = SITE, raw } = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain;charset=UTF-8' };
  if (ua) headers['User-Agent'] = ua;
  const body = raw !== undefined ? raw : JSON.stringify(id ? { id } : {});
  const r = await worker.fetch(new Request('https://w.workers.dev/hit', { method: 'POST', headers, body }), env, {});
  return { status: r.status, j: await r.json(), cors: r.headers.get('Access-Control-Allow-Origin') };
}
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('') || n;
let fails = 0, oks = 0;
const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
const today = () => db.prepare("SELECT n FROM daily WHERE day = ?").get(new Date(clock + 9 * 3600e3).toISOString().slice(0, 10))?.n || 0;

const A = hex(), B = hex(), C = hex();
let r = await hit({ id: A });
ok(r.status === 200 && r.j.today === 1 && r.cors === SITE, '첫 브라우저 → 오늘 1', r);
r = await hit({ id: A }); ok(r.j.today === 1, '같은 브라우저 다시 → 그대로 1', r.j);
r = await hit({ id: B }); ok(r.j.today === 2, '같은 IP 의 다른 브라우저 → 따로 셈 (네이버 기준 · 예전 IP 기준이면 1)', r.j);
r = await hit({ id: C, ip: '5.6.7.8' }); ok(r.j.today === 3, '다른 IP 다른 브라우저 → 3', r.j);
r = await hit({ id: A, ip: '9.9.9.9' }); ok(r.j.today === 3, '같은 브라우저가 IP 만 바뀜(와이파이→LTE) → 그대로', r.j);
const dump = JSON.stringify(db.prepare('SELECT * FROM visits').all()) + JSON.stringify(db.prepare('SELECT * FROM vcap').all());
ok(![A, B, C, '1.2.3.4', '5.6.7.8'].some((x) => dump.includes(x)), '번호·IP 원문은 D1 에 없음(해시만)', dump.slice(0, 200));
ok(db.prepare("SELECT COUNT(*) AS n FROM visits WHERE h LIKE 'v%'").get().n === 3, '브라우저 기준 해시 3개(v 로 시작)', db.prepare('SELECT * FROM visits').all());

r = await hit({ ip: '7.7.7.7' }); ok(r.j.today === 4, '번호 없는 요청(예전 화면) → IP 기준으로 셈', r.j);
r = await hit({ ip: '7.7.7.7' }); ok(r.j.today === 4, '번호 없는 요청 같은 IP 다시 → 그대로', r.j);
r = await hit({ id: 'xyz', ip: '7.7.7.7' }); ok(r.j.today === 4, '잘못된 번호 → IP 기준(이미 셈) → 그대로', r.j);
r = await hit({ raw: '{not json', ip: '7.7.7.8' }); ok(r.status === 200 && r.j.today === 5, '본문이 깨져도 오류 없이 IP 기준', r);

for (const [ua, why] of [['Mozilla/5.0 (compatible; Googlebot/2.1)', '검색봇'], ['Mozilla/5.0 HeadlessChrome/126', '자동 검사(headless)'], ['Yeti/1.1', '네이버 수집봇'], ['', 'UA 없음']]) {
  r = await hit({ id: hex(), ip: '8.8.8.8', ua }); ok(r.j.today === 5, why + ' → 세지 않음', r.j);
}
r = await hit({ id: hex(), ip: '8.8.4.4', origin: 'https://evil.example' }); ok(r.j.today === 5, '허용되지 않은 출처 → 세지 않음', r.j);

// 남용: 같은 IP 에서 새 번호 40개까지만
for (let i = 0; i < 45; i++) await hit({ id: hex(), ip: '6.6.6.6' });
ok(today() === 45, '같은 IP 새 번호는 하루 40개까지만 (5 + 40 = 45)', today());
r = await hit({ id: hex(), ip: '6.6.6.7' }); ok(r.j.today === 46, '다른 IP 는 영향 없음', r.j);

// 날짜가 바뀌면(한국 시간 자정) 같은 브라우저도 다시 1번 · 어제 숫자
clock = Date.UTC(2026, 9, 20, 15, 1);   // 10-21 00:01 KST
r = await hit({ id: A }); ok(r.j.today === 1 && r.j.yesterday === 46 && r.j.day === '2026-10-21', '자정 지나면 같은 브라우저 다시 1 · 어제 46', r.j);
r = await hit({ id: A }); ok(r.j.today === 1, '새 날에도 같은 브라우저는 하루 1번', r.j);
ok(r.j.total === 47 && r.j.max === 46 && r.j.maxDay === '2026-10-20', '전체·최대', r.j);

// 2일 지난 해시·남용 개수 정리 (03:00 KST cron)
clock = Date.UTC(2026, 9, 22, 18, 5);   // 10-23 03:05 KST
const waits = [];
await worker.scheduled({ scheduledTime: clock }, env, { waitUntil: (p) => waits.push(p) });
await Promise.allSettled(waits);
ok(db.prepare("SELECT COUNT(*) AS n FROM visits WHERE day < '2026-10-21'").get().n === 0 && db.prepare("SELECT COUNT(*) AS n FROM vcap WHERE day < '2026-10-21'").get().n === 0,
  '03시 정리: 2일 지난 해시·IP별 개수 삭제', { v: db.prepare('SELECT day, COUNT(*) n FROM visits GROUP BY day').all(), c: db.prepare('SELECT day, COUNT(*) n FROM vcap GROUP BY day').all() });
ok(db.prepare('SELECT SUM(n) AS n FROM daily').get().n === 47, '정리해도 날짜별 합계는 그대로', db.prepare('SELECT * FROM daily').all());

console.log(`worker_visit_test: ${oks}개 통과 · ${fails}개 실패`);
process.exit(fails ? 1 : 0);
