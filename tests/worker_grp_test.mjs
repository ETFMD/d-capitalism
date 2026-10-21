// Worker 72루틴 PC 여러 대(/grp) 단독 확인 (node tests/worker_grp_test.mjs · run_regression.py 가 부름)
//  · 묶음 만들기·가입(hello)·공유 상태(주문 PC 만 · ver 조건)·주문 권한(touch·claim·give·bye) — 두 PC 가 동시에 주문 PC 가 될 수 없음
//  · 이어받기는 주문 PC 가 '정해진 시각(before)' 뒤로 실행을 끝내지 못했을 때만(done — 시작만 하고 죽어도) · before 는 2분 넘게 지난 시각만
//  · fz(조심 모드 대상 PC 들): 신호 없이 이어받힘·kick·bye 때 더함 · 다시 들어오면 하루 · 안 돌아오면 마지막 신호 이틀 뒤 빠짐 · 넘기기·두 번째 이어받기에도 그대로
//  · 이어받기는 주문 PC 가 2분 안에 신호(주문 직전 확인)를 보냈으면 안 됨
//  · 접속 토큰은 만료가 더 늦은 것만 · 비밀값 묶음은 sec_at 이 같을 때만 · 요청(켜기/끄기) · 고장 PC 빼기 · 한도(PC 8대·묶음 20개·본문 크기) · 60일 정리
// D1 은 두 가지로 확인: ① 진짜 SQLite(node:sqlite — Node 22.13+ 에서) 에 grp.js 의 SQL 을 그대로 실행 ② 없으면 SQL 문장별 모의 표(같은 뜻)
//   R72_GRP_FAKE=1 이면 ② 로만 (두 방식이 같은 결과인지 로컬에서 확인)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grpt-')), 'grp.mjs');
fs.copyFileSync(path.join(ROOT, 'worker', 'src', 'grp.js'), tmp);
const { grp, grpScan, _test } = await import(pathToFileURL(tmp).href);
const Q = _test.SQL;

/* ── D1 ① 진짜 SQLite ── */
let mode = 'fake', DB;
if (!process.env.R72_GRP_FAKE) {
  try {
    const ew = process.emitWarning; process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : ew.call(process, w, ...a));   /* 실험 기능 경고 숨김 */
    const { DatabaseSync } = await import('node:sqlite').finally(() => { process.emitWarning = ew; });
    const db = new DatabaseSync(':memory:');
    const schema = fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8').split('\n').filter((l) => /CREATE TABLE IF NOT EXISTS grp/.test(l)).join('\n');
    db.exec(schema);
    const st = (sql, a) => { const s = db.prepare(sql); return { first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: Number(r.changes) } }; } }; };
    DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
    mode = 'sqlite';
  } catch (e) { DB = null; }
}
/* ── D1 ② 모의 표 (grp.js 의 SQL 문장 그대로 받아 같은 뜻으로) ── */
if (!DB) {
  const G = new Map(), P = new Map(), K = new Map();
  const pk = (a, b) => a + '|' + b;
  const ex = (sql, a) => {
    const g = G.get(a[0]);
    switch (sql) {
      case Q.get: { const r = G.get(a[0]); return r ? { ...r } : null; }
      case Q.count: return { n: G.size };
      case Q.make: { if (G.has(a[0])) return { c: 0 }; G.set(a[0], { id: a[0], owner: a[1], epoch: 1, seen: a[2], done: a[3], fz: null, want: null, req: null, ver: 1, state: a[4], st_at: a[5], st_by: a[6], sec: a[7], sec_at: a[8], created: a[9], upd: a[10] }); return { c: 1 }; }
      case Q.state: return g ? { ver: g.ver, state: g.state, st_at: g.st_at, st_by: g.st_by } : null;
      case Q.secGet: return g ? { sec: g.sec, sec_at: g.sec_at } : null;
    }
    const [x0, x1, x2, x3, x4, x5, x6, x7] = a;
    switch (sql) {
      case Q.alive: { const r = G.get(x1); if (r) r.upd = x0; return { c: r ? 1 : 0 }; }
      case Q.touch: { const r = G.get(x2); if (r && r.owner === x3 && r.epoch === x4) { r.seen = x0; r.upd = x1; return { c: 1 }; } return { c: 0 }; }
      case Q.done: { const r = G.get(x3); if (r && r.owner === x4 && r.epoch === x5) { r.seen = x0; r.done = x1; r.upd = x2; return { c: 1 }; } return { c: 0 }; }
      case Q.claim: { const r = G.get(a[4]); if (r && r.epoch === a[5] && (r.owner == null || ((r.done == null || r.done < a[6]) && (r.seen == null || r.seen < a[7])))) { Object.assign(r, { owner: a[0], epoch: r.epoch + 1, seen: a[1], done: null, want: null, fz: a[2], upd: a[3] }); return { c: 1 }; } return { c: 0 }; }
      case Q.give: { const r = G.get(a[4]); if (r && r.owner === a[5] && r.epoch === a[6]) { Object.assign(r, { owner: a[0], epoch: r.epoch + 1, seen: a[1], done: a[2], want: null, upd: a[3] }); return { c: 1 }; } return { c: 0 }; }
      case Q.release: { const r = G.get(x2); if (r && r.owner === x3) { Object.assign(r, { owner: null, epoch: r.epoch + 1, want: null, fz: x0, upd: x1 }); return { c: 1 }; } return { c: 0 }; }
      case Q.put: { const r = G.get(a[5]); if (r && r.owner === a[6] && r.epoch === a[7] && r.ver === a[8]) { Object.assign(r, { state: a[0], ver: r.ver + 1, st_at: a[1], st_by: a[2], seen: a[3], upd: a[4] }); return { c: 1 }; } return { c: 0 }; }
      case Q.fzSet: { const r = G.get(x1); if (r && (r.fz || '') === x2) { r.fz = x0; return { c: 1 }; } return { c: 0 }; }
      case Q.want: { const r = G.get(x2); if (r) { r.want = x0; r.upd = x1; } return { c: r ? 1 : 0 }; }
      case Q.req: { const r = G.get(x2); if (r) { r.req = x0; r.upd = x1; } return { c: r ? 1 : 0 }; }
      case Q.sec: { const r = G.get(x3); if (r && (r.sec_at || 0) === x4) { Object.assign(r, { sec: x0, sec_at: x1, upd: x2 }); return { c: 1 }; } return { c: 0 }; }
      case Q.del: return { c: G.delete(x0) ? 1 : 0 };
      case Q.old: return [...G.values()].filter((r) => r.upd < x0).map((r) => ({ id: r.id }));
      case Q.pcPut: { P.set(pk(x0, x1), { gid: x0, mid: x1, name: x2, rank: x3, seen: x4, ver: x5, rd: x6 }); return { c: 1 }; }
      case Q.pcs: return [...P.values()].filter((p) => p.gid === x0).map((p) => ({ mid: p.mid, name: p.name, rank: p.rank, seen: p.seen, ver: p.ver, rd: p.rd }));
      case Q.pcSeen: { const p = P.get(pk(x0, x1)); return p ? { seen: p.seen } : null; }
      case Q.pcHas: return P.has(pk(x0, x1)) ? { mid: x1 } : null;
      case Q.pcCount: return { n: [...P.values()].filter((p) => p.gid === x0).length };
      case Q.pcDel: return { c: P.delete(pk(x0, x1)) ? 1 : 0 };
      case Q.pcDelAll: { let c = 0; for (const [k, p] of P) if (p.gid === x0) { P.delete(k); c++; } return { c }; }
      case Q.pcOld: { let c = 0; for (const [k, p] of P) if (p.seen < x0) { P.delete(k); c++; } return { c }; }
      case Q.tokPut: { const k = pk(x0, x1), o = K.get(k); if (!o || x3 > o.exp) { K.set(k, { gid: x0, b: x1, s: x2, exp: x3, at: x4, by_mid: x5 }); return { c: 1 }; } return { c: 0 }; }
      case Q.toks: return [...K.values()].filter((t) => t.gid === x0).map((t) => ({ b: t.b, s: t.s, exp: t.exp, at: t.at, by_mid: t.by_mid }));
      case Q.tokDelAll: { let c = 0; for (const [k, t] of K) if (t.gid === x0) { K.delete(k); c++; } return { c }; }
    }
    throw new Error('모르는 SQL: ' + sql);
  };
  const st = (sql, a) => ({ first: async () => { const v = ex(sql, a); return Array.isArray(v) ? v[0] || null : v && v.c === undefined ? v : null; }, all: async () => ({ results: ex(sql, a) }), run: async () => ({ meta: { changes: ex(sql, a).c || 0 } }) });
  DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
}

let clock = Date.UTC(2026, 9, 16, 8, 0);   // 17:00 KST
Date.now = () => clock;
const env = { DB };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const call = async (body) => { const r = await grp(new Request('https://w/grp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env, json); return { s: r.status, j: await r.json() }; };
let fails = 0, oks = 0;
const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
const M = 60e3, H = 3600e3, D = 864e5;
const T1 = 'a'.repeat(64), A = '11'.repeat(16), B = '22'.repeat(16), C = '33'.repeat(16), Z = '44'.repeat(16);
const blob = (x) => 'Zm9v' + x;   // 암호문 흉내 (base64 글자)

let r = await grp(new Request('https://w/grp'), env, json); r = await r.json();
ok(r.ok && r.now === clock && r.ready === true, 'GET → now · ready(표 있음)', r);
r = await call({ t: 'xyz', m: A, op: 'hello' }); ok(r.s === 400 && r.j.error === 't', 't 모양 → 400', r);
r = await call({ t: T1, m: 'nothex', op: 'hello' }); ok(r.s === 400 && r.j.error === 'm', 'm 모양 → 400', r);
r = await call('x'.repeat(1000001)); ok(r.s === 413, '1MB 넘음 → 413', r.s);
r = await call({ t: T1, m: A, op: 'hello' }); ok(r.s === 404 && r.j.error === 'nogroup', '없는 묶음 → 404', r);
r = await call({ t: T1, m: A, op: 'make', n: 'PC1', r: 1, state: 'bad state!' }); ok(r.s === 400, '상태 글자 이상 → 400', r);
r = await call({ t: T1, m: A, op: 'make', n: 'PC1', r: 1, state: blob('s1'), sec: blob('k1'), v: '0.3.0', rd: { k: 1, ip: 1, f: 1, b: 'toss' } });
ok(r.j.ok && r.j.epoch === 1 && r.j.ver === 1 && r.j.sec_at === clock, '묶음 만들기 → 주문 PC = 만든 PC · epoch 1 · ver 1', r.j);
r = await call({ t: T1, m: B, op: 'make', state: blob('x') }); ok(r.s === 409, '같은 묶음 다시 만들기 → 409', r);
r = await call({ t: T1, m: B, op: 'state' }); ok(r.s === 403, '가입 전 상태 읽기 → 403', r);

clock += M;
r = await call({ t: T1, m: A, op: 'hello', e: 1, n: 'PC1', r: 1, v: '0.3.0', rd: { k: 1, ip: 1, f: 1 } });
ok(r.j.ok && r.j.owner === A && r.j.epoch === 1 && r.j.seen === clock - M && r.j.ver === 1 && r.j.pcs.length === 1 && r.j.fz === null, '주문 PC hello → seen 은 그대로(일한 신호 touch·done·put 만 · 시작만 하고 매번 죽는 주문 PC 가 이어받기를 막지 않게)', r.j);
clock += M;
r = await call({ t: T1, m: B, op: 'hello', n: 'PC2', r: 2, v: '0.3.0', rd: { k: 1, ip: 1, f: 1, sp: 1, evil: 'x' } });
ok(r.j.ok && r.j.owner === A && r.j.seen === clock - 2 * M && r.j.pcs.length === 2 && r.j.pcs.find((p) => p.m === B).r === 2 && r.j.pcs.find((p) => p.m === B).rd.k === 1 && r.j.pcs.find((p) => p.m === B).rd.sp === 1 && !('evil' in r.j.pcs.find((p) => p.m === B).rd), '대기 PC 가입(예비 표시 · 모르는 값은 버림) · 주문 PC seen 은 그대로', r.j);
r = await call({ t: T1, m: B, op: 'state' }); ok(r.j.ok && r.j.state === blob('s1') && r.j.ver === 1 && r.j.st_by === A, '가입 뒤 공유 상태 읽기(암호문 그대로)', r.j);
r = await call({ t: T1, m: B, op: 'secget' }); ok(r.j.ok && r.j.sec === blob('k1'), '비밀값 묶음 읽기', r.j);
// put — 주문 PC 만 · ver 조건
r = await call({ t: T1, m: B, op: 'put', e: 1, ver: 1, state: blob('s2') }); ok(!r.j.ok && r.j.error === 'owner' && r.j.owner === A, '대기 PC 는 상태 저장 못 함', r.j);
r = await call({ t: T1, m: A, op: 'put', e: 1, ver: 1, state: blob('s2') }); ok(r.j.ok && r.j.ver === 2, '주문 PC 상태 저장 → ver 2', r.j);
r = await call({ t: T1, m: A, op: 'put', e: 1, ver: 1, state: blob('s3') }); ok(!r.j.ok && r.j.ver === 2, '낡은 ver 로 저장 → 거절', r.j);
r = await call({ t: T1, m: A, op: 'put', e: 1, ver: 2, state: 'x'.repeat(_test.MAX_STATE + 1) }); ok(r.s === 400, '상태가 너무 큼 → 400', r.s);
// touch
r = await call({ t: T1, m: A, op: 'touch', e: 1 }); ok(r.j.ok, '주문 PC touch', r.j);
r = await call({ t: T1, m: B, op: 'touch', e: 1 }); ok(!r.j.ok && r.j.owner === A, '대기 PC touch → 거절', r.j);
r = await call({ t: T1, m: A, op: 'touch', e: 2 }); ok(!r.j.ok, '다른 epoch touch → 거절', r.j);
// done — 주문 PC 가 실행 하나를 끝까지 마침 (done = 그 실행을 시작한 시각 · 1시간 넘게 지난 st 는 무시)
const fzK = (j) => (j.fz ? Object.keys(j.fz).sort().join(',') : '');
const ep = async (who) => (await call({ t: T1, m: who, op: 'hello' })).j.epoch;
r = await call({ t: T1, m: B, op: 'done', e: 1 }); ok(!r.j.ok && r.j.owner === A, '대기 PC done → 거절', r.j);
r = await call({ t: T1, m: A, op: 'done', e: 1, el: 2 * H }); ok(r.j.ok && r.j.done === clock, 'done: 실행에 1시간 넘게 걸렸다는 값은 무시(지금)', r.j);
const doneA = clock - 30e3;
r = await call({ t: T1, m: A, op: 'done', e: 1, el: 30e3 }); ok(r.j.ok && r.j.done === doneA, '주문 PC done = 실행 시작 시각(서버 시계: 지금 − 걸린 시간)', r.j);
// claim — before 는 2분 넘게 지난 시각 · 주문 PC 가 before 뒤에 시작한 실행을 끝냈으면 실패 · 2분 안에 신호가 있으면 실패 · 시작만 하고 죽으면 이어받음
r = await call({ t: T1, m: B, op: 'claim', e: 1, before: clock - M }); ok(r.s === 400 && r.j.error === 'before', 'before 가 2분 안 → 400', r.j);
clock += 5 * M;
r = await call({ t: T1, m: B, op: 'claim', e: 1, before: doneA - M }); ok(!r.j.ok && r.j.owner === A && r.j.done === doneA, '주문 PC 가 before 뒤에 시작한 실행을 끝냄 → 이어받기 실패', r.j);
clock += 5 * M;
r = await call({ t: T1, m: A, op: 'hello', e: 1, n: 'PC1', r: 1 }); r = await call({ t: T1, m: A, op: 'touch', e: 1 });   /* 다음 실행을 시작만 하고(주문 직전 확인까지) 멈춤 */
const startA = clock;
clock += M;
r = await call({ t: T1, m: B, op: 'claim', e: 1, before: startA - M }); ok(!r.j.ok && r.j.owner === A, '주문 PC 가 2분 안에 신호(주문 직전 확인) → 이어받기 실패 (느린 실행이 주문을 보내는 바로 그때 가져가지 않음)', r.j);
clock += 7 * M;
r = await call({ t: T1, m: B, op: 'hello', n: 'PC2', r: 2 }); ok(r.j.seen === startA && r.j.done === doneA, 'hello: 마지막 신호(seen)·마지막으로 끝낸 실행의 시작(done) 따로', r.j);
clock += 12 * M;
r = await call({ t: T1, m: B, op: 'claim', e: 2, before: clock - 10 * M }); ok(!r.j.ok, '틀린 epoch 로 이어받기 실패', r.j);
r = await call({ t: T1, m: B, op: 'claim', e: 1, before: startA - M }); ok(r.j.ok && r.j.epoch === 2 && fzK(r.j) === A && r.j.fz[A].s === startA && r.j.fz[A].r === null, '주문 PC 가 실행을 시작만 하고 끝내지 못함 → 대기 PC 가 이어받음 · 조심 모드 대상 = 옛 주문 PC(마지막 신호)', r.j);
r = await call({ t: T1, m: A, op: 'touch', e: 1 }); ok(!r.j.ok && r.j.owner === B && r.j.epoch === 2, '옛 주문 PC touch → 거절(주문하지 않음)', r.j);
r = await call({ t: T1, m: A, op: 'put', e: 1, ver: 2, state: blob('old') }); ok(!r.j.ok && r.j.owner === B, '옛 주문 PC 상태 저장 → 거절', r.j);
r = await call({ t: T1, m: B, op: 'hello', e: 2, n: 'PC2', r: 2 }); ok(r.j.owner === B && fzK(r.j) === A && r.j.seen === clock && r.j.done === null, '새 주문 PC hello → 조심 모드 그대로 · 이어받으면 done 비움(첫 실행을 끝내기 전에 죽으면 다음 PC 가 바로)', r.j);
r = await call({ t: T1, m: B, op: 'done', e: 2, el: 0 }); ok(r.j.ok, '새 주문 PC 실행 끝', r.j);
clock += D; r = await call({ t: T1, m: B, op: 'hello', e: 2 }); ok(fzK(r.j) === A && r.j.fz[A].r === null, '옛 주문 PC 가 안 돌아옴 — 하루 뒤에도 조심 모드', r.j); await call({ t: T1, m: B, op: 'done', e: 2, el: 0 });
clock += D + M; r = await call({ t: T1, m: B, op: 'hello', e: 2 }); ok(r.j.fz === null, '안 돌아온 PC: 마지막 신호 이틀 뒤 끝 (그 PC 는 서버와 하루 넘게 끊기면 스스로 새 주문을 멈춤)', r.j); await call({ t: T1, m: B, op: 'done', e: 2, el: 0 });
// 동시에 두 PC 가 이어받기 → 하나만
clock += M; await call({ t: T1, m: C, op: 'hello', n: 'PC3', r: 3 });
clock += 30 * M;
const [c1, c2] = await Promise.all([call({ t: T1, m: A, op: 'claim', e: 2, before: clock - 10 * M }), call({ t: T1, m: C, op: 'claim', e: 2, before: clock - 10 * M })]);
ok([c1, c2].filter((x) => x.j.ok).length === 1, '두 PC 가 같은 epoch 로 동시에 이어받기 → 하나만 성공', [c1.j, c2.j]);
const win = c1.j.ok ? A : C, loser = win === A ? C : A;
r = await call({ t: T1, m: loser, op: 'hello', n: 'x', r: 5 }); ok(r.j.owner === win && r.j.epoch === 3 && fzK(r.j) === B, '주문 PC 는 하나 (epoch 3) · 조심 모드 대상 = B', r.j);
// give · want — 넘겨도 조심 모드 대상은 그대로
r = await call({ t: T1, m: B, op: 'want' }); r = await call({ t: T1, m: B, op: 'hello', n: 'PC2', r: 2 }); ok(r.j.want === B && r.j.fz[B].r === clock, '이 PC 가 주문하기 요청 → want · B 가 돌아옴(r)', r.j);
r = await call({ t: T1, m: win, op: 'give', e: 3, to: Z }); ok(r.s === 400, '가입 안 한 PC 에 넘기기 → 400', r);
r = await call({ t: T1, m: loser, op: 'give', e: 3, to: B }); ok(!r.j.ok, '주문 PC 가 아니면 넘기기 못 함', r.j);
r = await call({ t: T1, m: win, op: 'give', e: 3, to: B }); ok(r.j.ok && r.j.epoch === 4 && r.j.owner === B, '주문 PC 가 넘김 → epoch 4', r.j);
r = await call({ t: T1, m: B, op: 'hello', e: 4, n: 'PC2', r: 2 }); ok(r.j.owner === B && r.j.want === null && fzK(r.j) === B && r.j.done === clock, '넘긴 뒤 want 비움 · 조심 모드 대상은 그대로 · done = 넘긴 시각', r.j);
// req
r = await call({ t: T1, m: A, op: 'req', k: 'enabled', on: false }); r = await call({ t: T1, m: B, op: 'hello', e: 4 });
ok(r.j.req && r.j.req.k === 'enabled' && r.j.req.on === false && r.j.req.by === A && r.j.req.at === clock, '켜기/끄기 요청', r.j.req);
r = await call({ t: T1, m: A, op: 'req', k: 'other', on: true }); ok(r.s === 400, '모르는 요청 → 400', r);
/* SMA 200 켜기/끄기 요청(2026-10-22) — 72루틴 요청과 한 칸에 따로 · 서로 지우지 않음 */
const at72 = clock;
r = await call({ t: T1, m: B, op: 'req', k: 'smaEnabled', on: true }); r = await call({ t: T1, m: B, op: 'hello', e: 4 });
ok(r.j.req && r.j.req.k === 'enabled' && r.j.req.on === false && r.j.req.at === at72 && r.j.req.sma && r.j.req.sma.on === true && r.j.req.sma.by === B && r.j.req.sma.at === clock, 'SMA 200 요청 — 72루틴 요청은 그대로', r.j.req);
const atS = clock;
r = await call({ t: T1, m: A, op: 'req', k: 'enabled', on: true }); r = await call({ t: T1, m: B, op: 'hello', e: 4 });
ok(r.j.req && r.j.req.k === 'enabled' && r.j.req.on === true && r.j.req.by === A && r.j.req.sma && r.j.req.sma.on === true && r.j.req.sma.at === atS, '72루틴 요청 — SMA 200 요청은 그대로', r.j.req);
r = await call({ t: T1, m: A, op: 'req', k: 'smaEnabled', on: 'yes' }); ok(r.s === 400, 'SMA 200 요청 on 이 참/거짓이 아니면 400', r);
// tok — 만료가 더 늦은 것만
r = await call({ t: T1, m: A, op: 'tok', b: 'toss', s: blob('t1'), exp: clock + D }); ok(r.j.ok && r.j.changed, '접속 토큰 저장', r.j);
r = await call({ t: T1, m: B, op: 'tok', b: 'toss', s: blob('t0'), exp: clock + D - M }); ok(r.j.ok && !r.j.changed, '더 일찍 만료되는(옛) 토큰은 안 바꿈', r.j);
r = await call({ t: T1, m: B, op: 'tok', b: 'toss', s: blob('t2'), exp: clock + D + M }); ok(r.j.ok && r.j.changed, '더 새 토큰으로 바꿈', r.j);
r = await call({ t: T1, m: C, op: 'hello' }); ok(r.j.tok.toss && r.j.tok.toss.s === blob('t2') && r.j.tok.toss.by === B, 'hello 에 최신 토큰', r.j.tok);
r = await call({ t: T1, m: B, op: 'tok', b: 'evil', s: blob('t'), exp: clock + D }); ok(r.s === 400, '모르는 증권사 → 400', r);
r = await call({ t: T1, m: B, op: 'tok', b: 'kis', s: blob('t'), exp: clock - 1 }); ok(r.s === 400, '이미 만료 → 400', r);
// sec — sec_at 이 같을 때만
const s0 = (await call({ t: T1, m: B, op: 'hello' })).j.sec_at;
r = await call({ t: T1, m: B, op: 'sec', sec: blob('k2'), base: s0 }); ok(r.j.ok && r.j.sec_at > s0, '비밀값 묶음 바꾸기', r.j);
r = await call({ t: T1, m: A, op: 'sec', sec: blob('k3'), base: s0 }); ok(!r.j.ok && r.j.error === 'sec-conflict', '낡은 sec_at 로 바꾸기 → 충돌(다시 받아 합침)', r.j);
r = await call({ t: T1, m: A, op: 'secget' }); ok(r.j.sec === blob('k2'), '충돌한 쪽은 저장 안 됨', r.j);
// kick — 주문 PC 는 1시간 넘게 조용할 때만
r = await call({ t: T1, m: A, op: 'kick', to: B }); ok(r.s === 409, '방금 신호 보낸 주문 PC 는 빼지 못함', r);
r = await call({ t: T1, m: A, op: 'kick', to: C }); ok(r.j.ok, '대기 PC 빼기', r.j);
r = await call({ t: T1, m: A, op: 'hello' }); ok(r.j.pcs.length === 2 && !r.j.pcs.some((p) => p.m === C), '뺀 PC 는 목록에서 없음', r.j.pcs);
r = await call({ t: T1, m: C, op: 'state' }); ok(r.s === 403, '뺀 PC 는 상태를 못 읽음(다시 가입 전)', r);
// fz — 안 돌아온 PC 는 두 번째 이어받기·넘기기에도 그대로 (검토 2) · 돌아오면 하루 · 안 돌아오면 마지막 신호 이틀
clock += D + M; r = await call({ t: T1, m: A, op: 'hello' }); ok(r.j.fz === null, '돌아온 PC(B)는 하루 뒤 조심 모드 끝', r.j);
await call({ t: T1, m: B, op: 'done', e: 4, el: 0 });   /* B(주문 PC) 마지막 신호(실행 끝) */
clock += 2 * H;
r = await call({ t: T1, m: A, op: 'claim', e: 4, before: clock - 30 * M }); ok(r.j.ok && fzK(r.j) === B, '주문 PC(B) 2시간 조용 → A 가 이어받음 · 대상 B', r.j);
const sB = r.j.fz[B].s;
await call({ t: T1, m: C, op: 'hello', n: 'PC3', r: 3 });
clock += 2 * H;
r = await call({ t: T1, m: C, op: 'claim', e: 5, before: clock - 30 * M }); ok(r.j.ok && fzK(r.j) === [A, B].sort().join(','), '두 번째 이어받기(C) → 안 돌아온 B 는 그대로 + A 더함', r.j);
r = await call({ t: T1, m: A, op: 'hello', n: 'PC1', r: 1 }); ok(r.j.fz[A].r === clock && r.j.fz[B].r === null, 'A 가 돌아옴 → A 만 하루 시계', r.j);
r = await call({ t: T1, m: C, op: 'give', e: 6, to: A }); ok(r.j.ok, 'C → A 넘김', r.j);
r = await call({ t: T1, m: A, op: 'hello', e: 7 }); ok(fzK(r.j) === [A, B].sort().join(','), '넘겨도 대상(A·B) 그대로', r.j);
clock += D + M; r = await call({ t: T1, m: A, op: 'hello', e: 7 }); ok(fzK(r.j) === B, '돌아온 A 는 하루 뒤 빠짐 · 안 돌아온 B 는 그대로', r.j);
clock = sB + 2 * D + M; r = await call({ t: T1, m: A, op: 'hello', e: 7 }); ok(r.j.fz === null, '안 돌아온 B 는 마지막 신호 이틀 뒤 빠짐', r.j);
// kick 한 주문 PC → 조심 모드 대상 (서버에만 못 붙은 채 주문하고 있을 수 있음)
await call({ t: T1, m: C, op: 'hello', n: 'PC3', r: 3 });
clock += 2 * H; r = await call({ t: T1, m: C, op: 'kick', to: A }); ok(r.j.ok, '2시간 조용한 주문 PC 빼기', r.j);
r = await call({ t: T1, m: C, op: 'hello', n: 'PC3', r: 3 }); ok(r.j.owner === null && fzK(r.j) === A && r.j.fz[A].r === null, '주문 PC 를 빼면 비움 · 조심 모드 대상 = 뺀 PC', r.j);
r = await call({ t: T1, m: C, op: 'claim', e: r.j.epoch, before: clock - 3 * M }); ok(r.j.ok && fzK(r.j) === A, '빈 자리 이어받기 → 조심 모드 이어감', r.j);
// bye — 주문 PC 가 스스로 빠지면 비움 → 남은 PC 가 바로 가져감 · 빠진 PC 기준 하루 · 안 돌아온 대상은 그대로
await call({ t: T1, m: B, op: 'hello', n: 'PC2', r: 2 });
r = await call({ t: T1, m: C, op: 'bye' }); ok(r.j.ok && !r.j.gone, '주문 PC(C) 빠짐', r.j);
r = await call({ t: T1, m: B, op: 'hello' }); ok(r.j.owner === null && fzK(r.j) === [A, C].sort().join(',') && r.j.fz[C].r === clock && r.j.fz[A].r === null && r.j.pcs.length === 1, '주문 PC 비움 · 대상 = 빠진 C(하루) + 안 돌아온 A', r.j);
const e0 = r.j.epoch;
r = await call({ t: T1, m: B, op: 'claim', e: e0, before: clock - 3 * M }); ok(r.j.ok && r.j.epoch === e0 + 1 && fzK(r.j) === [A, C].sort().join(','), '빈 주문 PC → 남은 PC 가 가져감 · 조심 모드 이어감', r.j);
r = await call({ t: T1, m: B, op: 'bye' }); ok(r.j.gone, '마지막 PC 빠짐 → 묶음 지움', r.j);
r = await call({ t: T1, m: B, op: 'hello' }); ok(r.s === 404, '지운 묶음 → 404', r);
// PC 8대 한도
const T2 = 'b'.repeat(64);
await call({ t: T2, m: '01'.repeat(16), op: 'make', state: blob('s') });
for (let i = 2; i <= 8; i++) await call({ t: T2, m: String(i).padStart(2, '0').repeat(16), op: 'hello' });
r = await call({ t: T2, m: '09'.repeat(16), op: 'hello' }); ok(r.s === 429 && r.j.error === 'pcs', '9번째 PC → 429', r);
r = await call({ t: T2, m: '05'.repeat(16), op: 'hello' }); ok(r.j.ok && r.j.pcs.length === 8, '이미 가입한 PC 는 그대로', r.j.pcs.length);
// 묶음 20개 한도 · 60일 조용한 묶음 정리
for (let i = 0; i < 19; i++) await call({ t: (i + 10).toString(16).padStart(2, '0').repeat(32), m: A, op: 'make', state: blob('s') });
r = await call({ t: 'c'.repeat(64), m: A, op: 'make', state: blob('s') }); ok(r.s === 429, '21번째 묶음 → 429', r);
clock += 61 * D;
await call({ t: T2, m: '05'.repeat(16), op: 'hello' });   // 하나만 살아 있음
r = await call({ t: 'c'.repeat(64), m: A, op: 'make', state: blob('s') }); ok(r.j.ok, '60일 조용한 묶음을 정리하고 만들기', r.j);
r = await call({ t: '0a'.repeat(32), m: A, op: 'hello' }); ok(r.s === 404, '조용하던 묶음은 지워짐', r.s);
r = await call({ t: T2, m: '05'.repeat(16), op: 'hello' }); ok(r.j.ok && r.j.pcs.length === 1 && r.j.pcs[0].m === '05'.repeat(16), '살아 있던 묶음은 그대로 · 60일 조용한 PC 7대만 정리', r.j);
clock += 61 * D; const n = await grpScan(env, clock); ok(n === 2, 'cron 정리 — 남은 두 묶음 모두 60일 조용 → 지움', n);
r = await call({ t: T2, m: '05'.repeat(16), op: 'hello' }); ok(r.s === 404, 'cron 이 지운 묶음 → 404', r.s);

console.log((fails ? '실패 ' + fails + '개 · ' : '') + 'worker_grp_test: ' + oks + '개 통과 (D1: ' + mode + ')');
process.exit(fails ? 1 : 0);
