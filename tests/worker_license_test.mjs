// Worker 72루틴 자동매매 배포판 라이선스(/license) 단독 확인 (node tests/worker_license_test.mjs · run_regression.py 가 부름)
//  · 관리자: 발급(issue)·차단/해제(revoke)·목록(list) — 관리자 키 틀리면 거부
//  · 배포판 PC: 확인(check) — 없는 키·차단된 키·기기 수 초과면 '거부'(reason) · 정상이면 ed25519 서명(공개키로 검증)
//  · validUntil = 지금 + 14일 유예 · 서명키(LIC_SK) 없으면 not-ready(거부 아님 — 유예로 버팀)
//  · 400일 넘게 조용한 키 정리(cron)
// D1 두 방식: ① 진짜 SQLite(node:sqlite) 에 schema.sql 의 lic·lic_pc 그대로 ② 없으면 SQL 문장별 모의표(같은 뜻). R72_LIC_FAKE=1 이면 ② 로만.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lict-')), 'license.mjs');
fs.copyFileSync(path.join(ROOT, 'worker', 'src', 'license.js'), tmp);
const { license, licenseScan, _test } = await import(pathToFileURL(tmp).href);
const Q = _test.SQL;

/* ── ed25519 키 한 쌍 (진짜 서명·검증) ── */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const SK_B64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');     // LIC_SK (Worker 비밀값 모양)
const PUB = crypto.createPublicKey({ key: publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' });
const verify = (payload, sigB64) => crypto.verify(null, Buffer.from(payload), PUB, Buffer.from(sigB64, 'base64'));
const ADMIN = 'admin-secret-key-1234567890';

/* ── D1 ① 진짜 SQLite ── */
let mode = 'fake', DB;
if (!process.env.R72_LIC_FAKE) {
  try {
    const ew = process.emitWarning; process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : ew.call(process, w, ...a));
    const { DatabaseSync } = await import('node:sqlite').finally(() => { process.emitWarning = ew; });
    const db = new DatabaseSync(':memory:');
    const schema = fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8').split('\n').filter((l) => /CREATE TABLE IF NOT EXISTS lic/.test(l)).join('\n');
    db.exec(schema);
    const st = (sql, a) => { const s = db.prepare(sql); return { first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: Number(r.changes) } }; } }; };
    DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
    mode = 'sqlite';
  } catch (e) { DB = null; }
}
/* ── D1 ② 모의표 ── */
if (!DB) {
  const L = new Map(), P = new Map();
  const pk = (a, b) => a + '|' + b;
  const ex = (sql, a) => {
    const [x0, x1, x2, x3, x4, x5, x6] = a;
    switch (sql) {
      case Q.get: { const r = L.get(x0); return r ? { ...r } : null; }
      case Q.count: return { n: L.size };
      case Q.make: { if (L.has(x0)) return { c: 0 }; L.set(x0, { id: x0, name: x1, status: 'active', maxm: x2, note: x3, issued: x4, upd: x5 }); return { c: 1 }; }
      case Q.setStatus: { const r = L.get(x2); if (r) { r.status = x0; r.upd = x1; return { c: 1 }; } return { c: 0 }; }
      case Q.touch: { const r = L.get(x1); if (r) { r.upd = x0; return { c: 1 }; } return { c: 0 }; }
      case Q.list: return [...L.values()].sort((a1, b1) => a1.issued - b1.issued).map((r) => ({ id: r.id, name: r.name, status: r.status, maxm: r.maxm, issued: r.issued, upd: r.upd }));
      case Q.del: return { c: L.delete(x0) ? 1 : 0 };
      case Q.old: return [...L.values()].filter((r) => r.upd < x0).map((r) => ({ id: r.id }));
      case Q.pcGet: return P.has(pk(x0, x1)) ? { mid: x1 } : null;
      case Q.pcCount: return { n: [...P.values()].filter((p) => p.id === x0).length };
      case Q.pcList: return [...P.values()].filter((p) => p.id === x0).sort((a1, b1) => a1.first - b1.first).map((p) => ({ mid: p.mid, first: p.first, last: p.last }));
      case Q.pcAdd: { const k = pk(x0, x1), o = P.get(k); if (o) o.last = x3; else P.set(k, { id: x0, mid: x1, first: x2, last: x3 }); return { c: 1 }; }
      case Q.pcSeen: { const p = P.get(pk(x1, x2)); if (p) { p.last = x0; return { c: 1 }; } return { c: 0 }; }
      case Q.pcDelAll: { let c = 0; for (const [k, p] of P) if (p.id === x0) { P.delete(k); c++; } return { c }; }
    }
    throw new Error('모르는 SQL: ' + sql);
  };
  const st = (sql, a) => ({ first: async () => { const v = ex(sql, a); return Array.isArray(v) ? v[0] || null : v && v.c === undefined ? v : null; }, all: async () => ({ results: ex(sql, a) }), run: async () => ({ meta: { changes: ex(sql, a).c || 0 } }) });
  DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
}

let clock = Date.UTC(2026, 9, 18, 8, 0);
Date.now = () => clock;
const env = { DB, LIC_SK: SK_B64, LIC_ADMIN: ADMIN };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const call = async (body, e = env) => { const r = await license(new Request('https://w/license', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), e, json); return { s: r.status, j: await r.json() }; };
let fails = 0, oks = 0;
const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
const DAY = 86400e3;
const MID = (n) => (n.toString(16).padStart(2, '0')).repeat(16);   // 32바이트 지문 해시 모양

/* GET → ready */
let r = await license(new Request('https://w/license'), env, json); r = await r.json();
ok(r.ok && r.now === clock && r.ready === true, 'GET → now · ready(서명키·관리자 키 있음)', r);
r = await license(new Request('https://w/license'), { DB, LIC_SK: SK_B64 }, json); r = await r.json();
ok(r.ready === false, 'GET → 관리자 키 없으면 ready=false', r);

/* 관리자 인증 */
r = await call({ op: 'issue', name: '홍길동' }); ok(r.s === 403 && r.j.error === 'admin', 'admin 키 없으면 발급 거부', r);
r = await call({ op: 'issue', admin: 'wrong', name: '홍길동' }); ok(r.s === 403, '틀린 admin 키 → 거부', r);
ok(_test.sameKey('abc', 'abc') && !_test.sameKey('abc', 'abd') && !_test.sameKey('abc', 'ab'), 'sameKey: 같은 길이·모든 글자', null);

/* 발급 */
r = await call({ op: 'issue', admin: ADMIN, name: '홍길동' });
const KEY = r.j.key, ID = r.j.id;
ok(r.j.ok && /^[A-Z0-9-]{10,40}$/.test(KEY) && /^[a-f0-9]{32}$/.test(ID) && r.j.maxm === 3, '발급 → 키(32자+하이픈)·id(해시)·maxm 기본 3', r.j);
r = await call({ op: 'issue', admin: ADMIN, name: '김철수', maxm: 2, note: '친구' });
const KEY2 = r.j.key;
ok(r.j.ok && r.j.maxm === 2 && r.j.key !== KEY, '발급2 → 다른 키 · maxm 지정', r.j);
r = await call({ op: 'issue', admin: ADMIN, name: 'x'.repeat(61) }); ok(r.s === 400, '이름 60자 초과 → 400', r);

/* 확인(check) — 정상: 서명 검증 */
const A = MID(0xaa), B = MID(0xbb), C = MID(0xcc), D = MID(0xdd);
r = await call({ op: 'check', key: KEY, mid: A });
ok(r.j.ok && r.j.validUntil === clock + 14 * DAY && r.j.name === '홍길동' && verify(ID + '|' + A + '|' + r.j.validUntil, r.j.sig), '확인(정상) → validUntil = 지금+14일 · 공개키로 서명 검증됨', { ok: r.j.ok, vu: r.j.validUntil - clock });
ok(!verify(ID + '|' + B + '|' + r.j.validUntil, r.j.sig), '서명은 그 기기(mid)만 — 다른 mid 로는 검증 실패(위조 불가)', null);
const sigA = r.j.sig;

/* 없는 키·모양 */
r = await call({ op: 'check', key: 'ZZZZ-ZZZZ-ZZZZ', mid: A }); ok(r.j.ok === false && r.j.reason === 'unknown', '없는 키 → 거부(unknown)', r.j);
r = await call({ op: 'check', key: KEY, mid: 'nothex' }); ok(r.j.ok === false && r.j.reason === 'mid', 'mid 모양 이상 → 거부', r.j);
r = await call({ op: 'check', key: 'short', mid: A }); ok(r.j.ok === false && r.j.reason === 'form', '키 모양 이상 → 거부', r.j);

/* 같은 기기 다시 — 기기 수 안 늘어남 · 소문자 키도 받음 */
clock += DAY;
r = await call({ op: 'check', key: KEY.toLowerCase(), mid: A });
ok(r.j.ok && r.j.validUntil === clock + 14 * DAY && r.j.sig !== sigA, '같은 기기 다시 확인(소문자 키도) → 새 validUntil·새 서명', { vu: r.j.validUntil - clock });

/* 기기 수 한도(3대) */
r = await call({ op: 'check', key: KEY, mid: B }); ok(r.j.ok, '2번째 기기 OK', r.j);
r = await call({ op: 'check', key: KEY, mid: C }); ok(r.j.ok, '3번째 기기 OK', r.j);
r = await call({ op: 'check', key: KEY, mid: D }); ok(r.j.ok === false && r.j.reason === 'maxm' && r.j.maxm === 3, '4번째 기기 → 거부(maxm 3) — 한 키를 여러 사람에게 못 돌리게', r.j);
r = await call({ op: 'check', key: KEY, mid: A }); ok(r.j.ok, '이미 등록된 기기는 한도와 무관하게 OK', r.j);

/* 차단(revoke) → 거부 · 해제(active) → 다시 OK */
r = await call({ op: 'revoke', admin: ADMIN, key: KEY }); ok(r.j.ok && r.j.status === 'revoked', '차단 → revoked', r.j);
r = await call({ op: 'check', key: KEY, mid: A }); ok(r.j.ok === false && r.j.reason === 'revoked', '차단된 키로 확인 → 거부(revoked) — 유예 안 씀(즉시 정지)', r.j);
r = await call({ op: 'revoke', admin: ADMIN, id: ID, status: 'active' }); ok(r.j.ok && r.j.status === 'active', 'id 로 해제 → active', r.j);
r = await call({ op: 'check', key: KEY, mid: A }); ok(r.j.ok, '해제 뒤 다시 OK', r.j);
r = await call({ op: 'revoke', admin: ADMIN, key: 'ZZZZ-ZZZZ' }); ok(r.s === 404, '없는 키 차단 → 404', r);
r = await call({ op: 'revoke', key: KEY }); ok(r.s === 403, '차단도 관리자 키 필요', r);

/* 목록 */
r = await call({ op: 'list', admin: ADMIN });
ok(r.j.ok && r.j.licenses.length === 2 && r.j.licenses.find((x) => x.id === ID).machines === 3 && r.j.licenses.find((x) => x.name === '김철수').maxm === 2, '목록 → 이름·상태·기기 수·maxm', r.j.licenses);

/* 서명키 없으면 not-ready(거부 아님 — 배포판은 유예로 버팀) */
r = await call({ op: 'check', key: KEY, mid: A }, { DB, LIC_ADMIN: ADMIN }); ok(r.s === 503 && r.j.error === 'not-ready', '서명키 없음 → not-ready(503) — 거부 아님', r.j);

/* 정리(cron) — 400일 넘게 조용한 키 */
r = await call({ op: 'issue', admin: ADMIN, name: '오래된키' }); const OLDID = r.j.id;
clock += 401 * DAY;
const n = await licenseScan(env, clock);
r = await call({ op: 'check', key: KEY, mid: A });   // KEY 는 방금 확인했으니 touch 로 살아 있어야(단, clock 점프로 다 오래됨) — 확인만
r = await call({ op: 'list', admin: ADMIN });
ok(n >= 1 && !r.j.licenses.find((x) => x.id === OLDID), '400일 넘게 조용한 키 정리(cron)', { n, left: r.j.licenses.map((x) => x.name) });

console.log((fails ? 'FAIL' : 'OK') + ' 배포판 라이선스(/license · ' + mode + ') ' + oks + ' / ' + (oks + fails));
process.exit(fails ? 1 : 0);
