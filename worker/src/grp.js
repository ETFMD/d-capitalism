/* 72루틴 자동매매 PC 여러 대 (/grp) — 여러 PC 를 켜 두고 같은 계좌를 함께 지키되 주문은 한 대만 (주문 PC 가 꺼지면 다른 PC 가 이어받음)
 * · 묶음 = PC1 이 만든 무작위 32바이트 '묶음 코드' (사용자가 다른 PC 에 넣음) — 이 Worker 는 코드를 모름
 *   - 요청에는 t = SHA-256('r72grp-auth|'+코드) · 행 id = SHA-256('r72grp|'+t) 앞 32자
 *   - 공유 상태(원장·일지·설정) · 비밀값(증권사 키·텔레그램) · 증권사 접속 토큰은 PC 가 코드로 만든 열쇠(AES-GCM)로 암호화해서 보냄 → 여기서는 풀 수 없음
 * · 주문 권한(owner) — 한 번에 한 PC · 바뀔 때마다 epoch +1 (모두 조건부 UPDATE 한 문장이라 두 PC 가 동시에 가질 수 없음)
 *   - touch: 주문·취소 직전 '아직 내가 주문 PC'인지 확인하며 seen 갱신 (owner·epoch 이 같을 때만) · done: 주문 PC 가 실행 하나를 끝까지 마침(done = 그 실행을 시작한 시각)
 *   - claim: 주문 PC 가 정해진 실행 시각 뒤에 시작한 실행을 끝내지 못했고(done < before — 시작만 하고 죽어도) 2분 넘게 아무 신호가 없을 때(seen — 느린 실행이 주문 직전 확인을 한 바로 그때 가져가지 않게) 가져감
 *     · before 는 2분 넘게 지난 시각만 · 가져가면 done = NULL (새 주문 PC 가 첫 실행을 끝내기 전에 죽으면 다음 PC 가 바로 이어받게)
 *   - fz = 조심 모드 대상 PC 들 { mid: { s: 그 PC 의 마지막 신호, r: 다시 들어온 시각 } } — 하나라도 있으면 주문 PC 는 '조심 모드'(주문 전 증권사 주문 목록 확인)
 *     · 넣는 때: 주문 PC 가 신호 없이 이어받힘(claim) · kick 당함 · 스스로 빠짐(bye: r = 지금) — 그 PC 가 서버에만 못 붙은 채 증권사로 주문을 계속할 수 있어서
 *     · 빼는 때: 다시 들어오고(hello) 하루 뒤 · 안 들어오면 마지막 신호 이틀 뒤 (PC 프로그램은 서버와 하루 넘게 끊기면 스스로 새 주문을 멈추고, 그날 주문은 장 마감으로 끝남)
 *     · 넘기기(give)·두 번째 이어받기에도 그대로 이어감
 *   - give: 주문 PC 가 넘김(사용자 요청 want · 주 PC 로 돌려주기) · bye: 묶음에서 빠짐(주문 PC 면 비움)
 *   - put: 주문 PC 만 공유 상태 저장 (ver 이 같을 때만 → +1)
 *   - sec: 비밀값 묶음(어느 PC 든 · sec_at 이 같을 때만) · tok: 접속 토큰(만료가 더 늦은 것만 — 토스는 새로 받으면 옛 토큰이 무효라 모든 PC 가 같은 토큰을 씀)
 *   - req: 대기 PC 화면에서 '자동매매 켜기/끄기' 요청 → 주문 PC 가 다음 실행에 반영
 * · 남용 막기: 묶음 20개 · 묶음마다 PC 8대 · 본문 1MB · 60일 넘게 조용한 묶음·PC 지움(cron)
 * · GET /grp → { ok, now, ready } (연결·시계 확인 · ready = 표 있음) */
const MAX_GROUPS = 20, MAX_PCS = 8, MAX_BODY = 1000000, MAX_STATE = 950000, MAX_SEC = 32000, MAX_TOK = 4000;
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5, KEEP = 60 * DAY, FZ_BACK = DAY, FZ_GONE = 2 * DAY;

const SQL = {
  get: 'SELECT id, owner, epoch, seen, done, fz, want, req, ver, st_at, st_by, sec_at, upd FROM grp WHERE id = ?',
  count: 'SELECT COUNT(*) AS n FROM grp',
  make: 'INSERT INTO grp (id, owner, epoch, seen, done, ver, state, st_at, st_by, sec, sec_at, created, upd) VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
  state: 'SELECT ver, state, st_at, st_by FROM grp WHERE id = ?',
  secGet: 'SELECT sec, sec_at FROM grp WHERE id = ?',
  touch: 'UPDATE grp SET seen = ?, upd = ? WHERE id = ? AND owner = ? AND epoch = ?',
  done: 'UPDATE grp SET seen = ?, done = ?, upd = ? WHERE id = ? AND owner = ? AND epoch = ?',
  alive: 'UPDATE grp SET upd = ? WHERE id = ?',
  claim: 'UPDATE grp SET owner = ?, epoch = epoch + 1, seen = ?, done = NULL, want = NULL, fz = ?, upd = ? WHERE id = ? AND epoch = ? AND (owner IS NULL OR ((done IS NULL OR done < ?) AND (seen IS NULL OR seen < ?)))',
  give: 'UPDATE grp SET owner = ?, epoch = epoch + 1, seen = ?, done = ?, want = NULL, upd = ? WHERE id = ? AND owner = ? AND epoch = ?',
  release: 'UPDATE grp SET owner = NULL, epoch = epoch + 1, want = NULL, fz = ?, upd = ? WHERE id = ? AND owner = ?',
  put: 'UPDATE grp SET state = ?, ver = ver + 1, st_at = ?, st_by = ?, seen = ?, upd = ? WHERE id = ? AND owner = ? AND epoch = ? AND ver = ?',
  fzSet: 'UPDATE grp SET fz = ? WHERE id = ? AND COALESCE(fz, \'\') = ?',
  want: 'UPDATE grp SET want = ?, upd = ? WHERE id = ?',
  req: 'UPDATE grp SET req = ?, upd = ? WHERE id = ?',
  sec: 'UPDATE grp SET sec = ?, sec_at = ?, upd = ? WHERE id = ? AND COALESCE(sec_at, 0) = ?',
  del: 'DELETE FROM grp WHERE id = ?',
  old: 'SELECT id FROM grp WHERE upd < ?',
  pcPut: 'INSERT INTO grp_pc (gid, mid, name, rank, seen, ver, rd) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gid, mid) DO UPDATE SET name = excluded.name, rank = excluded.rank, seen = excluded.seen, ver = excluded.ver, rd = excluded.rd',
  pcs: 'SELECT mid, name, rank, seen, ver, rd FROM grp_pc WHERE gid = ?',
  pcHas: 'SELECT mid FROM grp_pc WHERE gid = ? AND mid = ?',
  pcSeen: 'SELECT seen FROM grp_pc WHERE gid = ? AND mid = ?',
  pcCount: 'SELECT COUNT(*) AS n FROM grp_pc WHERE gid = ?',
  pcDel: 'DELETE FROM grp_pc WHERE gid = ? AND mid = ?',
  pcDelAll: 'DELETE FROM grp_pc WHERE gid = ?',
  pcOld: 'DELETE FROM grp_pc WHERE seen < ?',
  tokPut: 'INSERT INTO grp_tok (gid, b, s, exp, at, by_mid) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(gid, b) DO UPDATE SET s = excluded.s, exp = excluded.exp, at = excluded.at, by_mid = excluded.by_mid WHERE excluded.exp > grp_tok.exp',
  toks: 'SELECT b, s, exp, at, by_mid FROM grp_tok WHERE gid = ?',
  tokDelAll: 'DELETE FROM grp_tok WHERE gid = ?',
};

const enc = new TextEncoder();
async function hex(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const parse = (s) => { try { const v = JSON.parse(s || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
const int = (v) => (Number.isFinite(+v) && +v >= 0 && +v < 1e14 ? Math.floor(+v) : null);
const BLOB = /^[A-Za-z0-9+/=._-]+$/;
const blobOk = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && BLOB.test(s);
const changes = (r) => (r && r.meta ? r.meta.changes : 0) || 0;
/* 조심 모드 대상 PC 들 — 끝난 것은 뺌 */
function fzOf(g, now) {
  const o = parse(g.fz) || {}, out = {};
  for (const [k, v] of Object.entries(o)) if (/^[a-f0-9]{16,64}$/.test(k) && v && typeof v === 'object' && !(v.r ? now - v.r > FZ_BACK : now - (v.s || 0) > FZ_GONE)) out[k] = { s: int(v.s) || 0, r: int(v.r) || null };
  return out;
}
const fzStr = (o) => (Object.keys(o).length ? JSON.stringify(o) : null);
function cleanRd(rd) {
  rd = rd && typeof rd === 'object' ? rd : {};
  return JSON.stringify({ k: rd.k ? 1 : 0, ip: rd.ip ? 1 : 0, f: Math.min(99, int(rd.f) || 0), b: /^(toss|kis)$/.test(String(rd.b || '')) ? rd.b : null });
}
function view(g, pcs, toks, now) {
  return { ok: true, now, owner: g.owner || null, epoch: g.epoch, seen: g.seen || null, done: g.done || null, fz: g.fzo && Object.keys(g.fzo).length ? g.fzo : null, want: g.want || null, req: parse(g.req), ver: g.ver, st_at: g.st_at || null, st_by: g.st_by || null, sec_at: g.sec_at || null,
    pcs: (pcs || []).map((p) => ({ m: p.mid, n: p.name || '', r: p.rank || 9, s: p.seen || 0, v: p.ver || '', rd: parse(p.rd) || {} })),
    tok: (toks || []).reduce((o, t) => { o[t.b] = { s: t.s, exp: t.exp, at: t.at, by: t.by_mid }; return o; }, {}) };
}

export async function grp(req, env, json) {
  const now = Date.now();
  if (req.method === 'GET') { let ready = false; try { await env.DB.prepare(SQL.count).first(); ready = true; } catch (e) { /* 표 없음 */ } return json({ ok: true, now, ready }); }   /* 배포 확인용 — grp 표가 있으면 ready */
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  if ((+req.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'too big' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'too big' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'json' }, 400); }
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'json' }, 400);
  const t = String(b.t || ''), m = String(b.m || ''), op = String(b.op || '');
  if (!/^[a-f0-9]{64}$/.test(t)) return json({ ok: false, error: 't' }, 400);
  if (!/^[a-f0-9]{16,64}$/.test(m)) return json({ ok: false, error: 'm' }, 400);
  const DB = env.DB, id = (await hex('r72grp|' + t)).slice(0, 32);
  const name = String(b.n || '').replace(/[\u0000-\u001f]/g, '').slice(0, 40), rank = Math.max(1, Math.min(9, int(b.r) || 9)), pv = String(b.v || '').slice(0, 16);
  const pcPut = () => DB.prepare(SQL.pcPut).bind(id, m, name, rank, now, pv, cleanRd(b.rd)).run();
  let g = await DB.prepare(SQL.get).bind(id).first();

  if (op === 'make') {
    if (g) return json({ ok: false, error: 'exists' }, 409);
    if (!blobOk(b.state, MAX_STATE)) return json({ ok: false, error: 'state' }, 400);
    if (b.sec != null && !blobOk(b.sec, MAX_SEC)) return json({ ok: false, error: 'sec' }, 400);
    let n = await DB.prepare(SQL.count).first();
    if (n && n.n >= MAX_GROUPS) { await sweep(env, now); n = await DB.prepare(SQL.count).first(); }
    if (n && n.n >= MAX_GROUPS) return json({ ok: false, error: 'full' }, 429);
    const r = await DB.prepare(SQL.make).bind(id, m, now, now, b.state, now, m, b.sec || null, b.sec ? now : null, now, now).run();
    if (!changes(r)) return json({ ok: false, error: 'exists' }, 409);
    await DB.prepare(SQL.pcDelAll).bind(id).run(); await DB.prepare(SQL.tokDelAll).bind(id).run();   /* 같은 id 의 옛 찌꺼기 */
    await pcPut();
    return json({ ok: true, now, epoch: 1, ver: 1, sec_at: b.sec ? now : null });
  }
  if (!g) return json({ ok: false, error: 'nogroup' }, 404);
  const member = async () => !!(await DB.prepare(SQL.pcHas).bind(id, m).first());
  const lastSig = async (who) => { const p = await DB.prepare(SQL.pcSeen).bind(id, who).first(); return Math.max(g.seen || 0, g.done || 0, (p && p.seen) || 0) || now; };   /* 주문 PC 의 마지막 신호(일한 신호·hello 중 늦은 것) */
  const lost = () => json({ ok: false, error: 'owner', owner: g.owner || null, epoch: g.epoch, seen: g.seen || null, done: g.done || null, ver: g.ver, now });

  if (op === 'hello') {
    if (!(await member())) { const n = await DB.prepare(SQL.pcCount).bind(id).first(); if (n && n.n >= MAX_PCS) return json({ ok: false, error: 'pcs' }, 429); }
    await pcPut();
    /* hello 는 seen 을 바꾸지 않음 — seen 은 주문 PC 가 일한 신호(touch·done·put)만: 실행을 시작만 하고 매번 죽는 주문 PC 가 이어받기를 막지 않게 */
    await DB.prepare(SQL.alive).bind(now, id).run();   /* 대기 PC 만 살아 있어도 묶음은 살아 있음(60일 정리 기준) */
    /* 조심 모드 대상: 끝난 것 빼기 · 이 PC 가 대상이면 '다시 들어옴'(그때부터 하루) — 서버 없이 넣었을 그날 주문이 장 마감으로 끝날 때까지 */
    const fz = fzOf(g, now);
    if (fz[m] && !fz[m].r) fz[m].r = now;
    if (fzStr(fz) !== (g.fz || null)) await DB.prepare(SQL.fzSet).bind(fzStr(fz), id, g.fz || '').run();
    g.fzo = fz;
    const pcs = (await DB.prepare(SQL.pcs).bind(id).all()).results, toks = (await DB.prepare(SQL.toks).bind(id).all()).results;
    return json(view(g, pcs, toks, now));
  }
  if (!(await member())) return json({ ok: false, error: 'member' }, 403);
  if (op === 'state') { const s = await DB.prepare(SQL.state).bind(id).first(); return json({ ok: true, now, ver: s.ver, state: s.state, st_at: s.st_at, st_by: s.st_by }); }
  if (op === 'secget') { const s = await DB.prepare(SQL.secGet).bind(id).first(); return json({ ok: true, now, sec: s.sec || null, sec_at: s.sec_at || null }); }
  if (op === 'touch') {
    const e = int(b.e);
    if (changes(await DB.prepare(SQL.touch).bind(now, now, id, m, e).run())) return json({ ok: true, now, epoch: e });
    return lost();
  }
  if (op === 'done') {   /* 주문 PC 가 실행 하나를 끝까지 마침 — done = 그 실행을 시작한 시각(서버 시계로: 지금 − 실행에 걸린 시간 el · 1시간 안) · 이어받기는 이것으로 판단(시작만 하고 죽으면 이어받음) */
    const e = int(b.e), el = int(b.el), d = el != null && el < HOUR ? now - el : now;
    if (changes(await DB.prepare(SQL.done).bind(now, d, now, id, m, e).run())) return json({ ok: true, now, epoch: e, done: d });
    return lost();
  }
  if (op === 'claim') {
    const e = int(b.e), before = int(b.before);
    if (e == null || !(before > 0) || before > now - 2 * MIN) return json({ ok: false, error: 'before' }, 400);   /* 지금 막 신호를 보내는 주문 PC 와 겹치지 않게 2분 넘게 지난 시각만 */
    /* 신호 없이 이어받힌 주문 PC 를 조심 모드 대상에 더함(서버에만 못 붙은 채 주문하고 있을 수 있음 · s = 그 PC 의 마지막 신호) · 이미 있던 대상은 그대로 이어감 */
    const fz = fzOf(g, now);
    if (g.owner && g.owner !== m) fz[g.owner] = { s: await lastSig(g.owner), r: null };
    if (changes(await DB.prepare(SQL.claim).bind(m, now, fzStr(fz), now, id, e, before, now - 2 * MIN).run())) return json({ ok: true, now, epoch: e + 1, fz: fzStr(fz) ? fz : null });
    return lost();
  }
  if (op === 'give') {
    const e = int(b.e), to = String(b.to || '');
    if (!/^[a-f0-9]{16,64}$/.test(to) || !(await DB.prepare(SQL.pcHas).bind(id, to).first())) return json({ ok: false, error: 'to' }, 400);
    if (changes(await DB.prepare(SQL.give).bind(to, now, now, now, id, m, e).run())) return json({ ok: true, now, epoch: e + 1, owner: to });   /* 조심 모드 대상은 그대로 이어감 */
    return lost();
  }
  if (op === 'put') {
    const e = int(b.e), base = int(b.ver);
    if (!blobOk(b.state, MAX_STATE)) return json({ ok: false, error: 'state' }, 400);
    if (changes(await DB.prepare(SQL.put).bind(b.state, now, m, now, now, id, m, e, base).run())) return json({ ok: true, now, ver: base + 1 });
    return lost();
  }
  if (op === 'want') { await DB.prepare(SQL.want).bind(b.on === false ? (g.want === m ? null : g.want) : m, now, id).run(); return json({ ok: true, now }); }
  if (op === 'req') {
    if (b.k !== 'enabled' || typeof b.on !== 'boolean') return json({ ok: false, error: 'req' }, 400);
    await DB.prepare(SQL.req).bind(JSON.stringify({ k: 'enabled', on: b.on, at: now, by: m }), now, id).run();
    return json({ ok: true, now });
  }
  if (op === 'tok') {
    const bk = String(b.b || ''), exp = int(b.exp);
    if (!/^(toss|kis|kis-demo)$/.test(bk) || !blobOk(b.s, MAX_TOK) || !(exp > now)) return json({ ok: false, error: 'tok' }, 400);
    const r = await DB.prepare(SQL.tokPut).bind(id, bk, b.s, exp, now, m).run();
    return json({ ok: true, now, changed: changes(r) > 0 });
  }
  if (op === 'sec') {
    if (!blobOk(b.sec, MAX_SEC)) return json({ ok: false, error: 'sec' }, 400);
    const base = int(b.base) || 0, at = Math.max(now, base + 1);
    if (changes(await DB.prepare(SQL.sec).bind(b.sec, at, now, id, base).run())) return json({ ok: true, now, sec_at: at });
    return json({ ok: false, error: 'sec-conflict', sec_at: g.sec_at || null, now });
  }
  if (op === 'kick') {   /* 다른 PC 빼기(고장 나 버린 PC) — 지금 주문 PC 는 1시간 넘게 신호가 없을 때만 */
    const to = String(b.to || '');
    if (!/^[a-f0-9]{16,64}$/.test(to) || to === m) return json({ ok: false, error: 'to' }, 400);
    if (g.owner === to && g.seen && now - g.seen < HOUR) return json({ ok: false, error: 'busy' }, 409);
    await DB.prepare(SQL.pcDel).bind(id, to).run();
    /* 뺀 주문 PC 는 고장이 아니라 서버에만 못 붙은 채 주문하고 있을 수 있어 조심 모드 대상에 (마지막 신호 이틀 뒤 · 다시 들어오면 하루 뒤 끝) */
    if (g.owner === to) { const fz = fzOf(g, now); fz[to] = { s: await lastSig(to), r: null }; await DB.prepare(SQL.release).bind(fzStr(fz), now, id, to).run(); }
    return json({ ok: true, now });
  }
  if (op === 'bye') {
    await DB.prepare(SQL.pcDel).bind(id, m).run();
    if (g.owner === m) { const fz = fzOf(g, now); fz[m] = { s: now, r: now }; await DB.prepare(SQL.release).bind(fzStr(fz), now, id, m).run(); }   /* 스스로 빠진 주문 PC — 하루 조심 모드 */
    const n = await DB.prepare(SQL.pcCount).bind(id).first();
    if (!n || !n.n) { await DB.prepare(SQL.del).bind(id).run(); await DB.prepare(SQL.tokDelAll).bind(id).run(); return json({ ok: true, now, gone: true }); }
    return json({ ok: true, now });
  }
  return json({ ok: false, error: 'op' }, 400);
}

/** cron — 60일 넘게 조용한 묶음·PC 지움 */
async function sweep(env, now) {
  const DB = env.DB;
  const old = ((await DB.prepare(SQL.old).bind(now - KEEP).all()).results) || [];
  for (const r of old) { await DB.prepare(SQL.del).bind(r.id).run(); await DB.prepare(SQL.pcDelAll).bind(r.id).run(); await DB.prepare(SQL.tokDelAll).bind(r.id).run(); }
  await DB.prepare(SQL.pcOld).bind(now - KEEP).run();
  return old.length;
}
export async function grpScan(env, now) { return sweep(env, now); }

export const _test = { SQL, hex, MAX_GROUPS, MAX_PCS, MAX_STATE, KEEP, FZ_BACK, FZ_GONE };
