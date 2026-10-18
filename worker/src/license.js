/* 72루틴 자동매매 배포판 라이선스 (/license) — 받는 사람에게 나눠 주는 배포판이 돌아갈 자격을 확인
 * · 관리자(제작자)가 사람마다 키 1개 발급 → 배포판 + 키를 직접 전달. 유출되면 그 키만 차단(revoke).
 * · 이 Worker 는 키 원문을 저장하지 않음: id = SHA-256('r72lic|'+키) 앞 32자 만 D1(lic) 에 둠. (DB 가 새도 쓸 수 있는 키가 나오지 않음)
 * · 배포판 PC: 시작·하루 1회 POST /license {op:'check', key, mid} → 서버가 ed25519 개인키(LIC_SK · Worker 비밀값)로 { id|mid|validUntil } 에 서명해 보냄.
 *     - 배포판엔 공개키만 들어가 서명을 검증 → '위조'는 불가. validUntil = 지금 + 유예(14일): 서버가 잠깐 안 돼도 그때까지 주문 계속.
 *     - 차단·만료·기기초과 등 '명시적 거부'를 받으면 배포판은 유예를 쓰지 않고 즉시 전체 정지(클라이언트 쪽 규칙).
 * · 관리자 전용(op issue·revoke·list): LIC_ADMIN(Worker 비밀값) 과 같아야 함. (키 원문은 발급 응답에서 한 번만 돌려줌)
 * · mid = 기기 지문 해시(원문 아님) · 한 키에 maxm(기본 3)대까지 · 넘으면 거부(한 키를 여러 사람에게 못 돌리게)
 * · GET /license → { ok, ready(LIC_SK·LIC_ADMIN 있음), now } (배포 확인·시계)
 * · 남용 막기: 키 2000개 · 본문 작음 · 90일 넘게 아무 기기도 확인 안 한 키는 cron 이 정리(발급은 유지 — 쓰기 전일 수 있어 upd 기준)
 */
const MAX_LICS = 2000, MAX_BODY = 4000, GRACE = 14 * 86400e3, KEEP = 400 * 86400e3, DAY = 86400e3;

const SQL = {
  get: 'SELECT id, name, status, maxm, issued, upd FROM lic WHERE id = ?',
  count: 'SELECT COUNT(*) AS n FROM lic',
  make: 'INSERT INTO lic (id, name, status, maxm, note, issued, upd) VALUES (?, ?, \'active\', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
  setStatus: 'UPDATE lic SET status = ?, upd = ? WHERE id = ?',
  touch: 'UPDATE lic SET upd = ? WHERE id = ?',
  list: 'SELECT id, name, status, maxm, issued, upd FROM lic ORDER BY issued',
  del: 'DELETE FROM lic WHERE id = ?',
  old: 'SELECT id FROM lic WHERE upd < ?',
  pcGet: 'SELECT mid FROM lic_pc WHERE id = ? AND mid = ?',
  pcCount: 'SELECT COUNT(*) AS n FROM lic_pc WHERE id = ?',
  pcList: 'SELECT mid, first, last FROM lic_pc WHERE id = ? ORDER BY first',
  pcAdd: 'INSERT INTO lic_pc (id, mid, first, last) VALUES (?, ?, ?, ?) ON CONFLICT(id, mid) DO UPDATE SET last = excluded.last',
  pcSeen: 'UPDATE lic_pc SET last = ? WHERE id = ? AND mid = ?',
  pcDelAll: 'DELETE FROM lic_pc WHERE id = ?',
};

const enc = new TextEncoder();
async function hex(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const idOf = async (key) => (await hex('r72lic|' + key)).slice(0, 32);
const changes = (r) => (r && r.meta ? r.meta.changes : 0) || 0;
const nameOk = (s) => s == null || (typeof s === 'string' && s.length <= 60);
/* 같은 길이·모든 글자 비교(관리자 키) — 빨리 끝나 비교 시간으로 길이를 흘리지 않게 */
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
/* 발급 키 — 사람이 옮겨 적기 쉬운 32자(Crockford base32 · 0/O·1/I 없음) */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(20)); let s = '';
  for (let i = 0; i < 20; i++) s += B32[b[i] & 31] + (i % 4 === 3 && i < 19 ? '-' : '');
  return s;   /* 예: XXXX-XXXX-XXXX-XXXX-XXXX (20글자 + 하이픈) */
}
const B64 = (u8) => btoa(String.fromCharCode(...u8));
function b64ToBytes(s) { const t = atob(s); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }

/* 서명 — LIC_SK(ed25519 개인키 · base64 PKCS8 · Worker 비밀값)로 payload 에 서명(raw 64바이트 → base64) */
async function signTok(env, payload) {
  const sk = await crypto.subtle.importKey('pkcs8', b64ToBytes(env.LIC_SK), { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, sk, enc.encode(payload));
  return B64(new Uint8Array(sig));
}

export async function license(req, env, json) {
  const now = Date.now();
  if (req.method === 'GET') return json({ ok: true, ready: !!(env.LIC_SK && env.LIC_ADMIN), now });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  if ((+req.headers.get('content-length') || 0) > MAX_BODY) return json({ ok: false, error: 'too big' }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'too big' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'json' }, 400); }
  if (!b || typeof b !== 'object') return json({ ok: false, error: 'json' }, 400);
  const DB = env.DB, op = String(b.op || '');

  /* ── 배포판 PC: 자격 확인 ── */
  if (op === 'check') {
    if (!env.LIC_SK) return json({ ok: false, error: 'not-ready' }, 503);   /* 서명키 없음 → 배포판은 유예로 버팀(거부 아님) */
    const key = String(b.key || '').toUpperCase(), mid = String(b.mid || '');
    if (!/^[A-Z0-9-]{10,60}$/.test(key)) return json({ ok: false, reason: 'form', now });
    if (!/^[a-f0-9]{16,64}$/.test(mid)) return json({ ok: false, reason: 'mid', now });
    const id = await idOf(key), row = await DB.prepare(SQL.get).bind(id).first();
    if (!row) return json({ ok: false, reason: 'unknown', now });            /* 없는 키 → 거부(즉시 정지) */
    if (row.status === 'revoked') return json({ ok: false, reason: 'revoked', name: row.name || null, now });   /* 차단 → 거부 */
    const seen = await DB.prepare(SQL.pcGet).bind(id, mid).first();
    if (!seen) {
      const n = await DB.prepare(SQL.pcCount).bind(id).first();
      if (n && n.n >= (row.maxm || 3)) return json({ ok: false, reason: 'maxm', maxm: row.maxm || 3, now });   /* 기기 수 초과 → 거부 */
      await DB.prepare(SQL.pcAdd).bind(id, mid, now, now).run();
    } else { await DB.prepare(SQL.pcSeen).bind(now, id, mid).run(); }
    await DB.prepare(SQL.touch).bind(now, id).run();
    const validUntil = now + GRACE, payload = id + '|' + mid + '|' + validUntil;
    return json({ ok: true, sig: await signTok(env, payload), validUntil, name: row.name || null, now });
  }

  /* ── 관리자 전용 ── */
  if (op === 'issue' || op === 'revoke' || op === 'list') {
    if (!env.LIC_ADMIN || !sameKey(String(b.admin || ''), env.LIC_ADMIN)) return json({ ok: false, error: 'admin' }, 403);
    if (op === 'issue') {
      if (!nameOk(b.name) || !nameOk(b.note)) return json({ ok: false, error: 'name' }, 400);
      const maxm = Number.isInteger(b.maxm) && b.maxm >= 1 && b.maxm <= 20 ? b.maxm : 3;
      const n = await DB.prepare(SQL.count).first();
      if (n && n.n >= MAX_LICS) return json({ ok: false, error: 'full' }, 429);
      for (let i = 0; i < 5; i++) {   /* 거의 안 겹치지만 혹시 겹치면 다시 */
        const key = newKey(), id = await idOf(key);
        const r = await DB.prepare(SQL.make).bind(id, b.name || null, maxm, b.note || null, now, now).run();
        if (changes(r)) return json({ ok: true, key, id, name: b.name || null, maxm, now });
      }
      return json({ ok: false, error: 'retry' }, 500);
    }
    if (op === 'revoke') {
      const id = b.id && /^[a-f0-9]{32}$/.test(b.id) ? b.id : (b.key ? await idOf(String(b.key).toUpperCase()) : null);
      if (!id) return json({ ok: false, error: 'id' }, 400);
      const status = b.status === 'active' ? 'active' : 'revoked';
      const r = await DB.prepare(SQL.setStatus).bind(status, now, id).run();
      if (!changes(r)) return json({ ok: false, error: 'nokey' }, 404);
      return json({ ok: true, id, status, now });
    }
    if (op === 'list') {
      const rows = ((await DB.prepare(SQL.list).all()).results) || [];
      const out = [];
      for (const r of rows) { const c = await DB.prepare(SQL.pcCount).bind(r.id).first(); out.push({ id: r.id, name: r.name, status: r.status, maxm: r.maxm, machines: (c && c.n) || 0, issued: r.issued, upd: r.upd }); }
      return json({ ok: true, licenses: out, now });
    }
  }
  return json({ ok: false, error: 'op' }, 400);
}

/* 오래 조용한 키 정리 — cron (아무 기기도 400일 넘게 확인 안 함) */
export async function licenseScan(env, now) {
  const rows = ((await env.DB.prepare(SQL.old).bind(now - KEEP).all()).results) || [];
  for (const r of rows) { await env.DB.prepare(SQL.pcDelAll).bind(r.id).run(); await env.DB.prepare(SQL.del).bind(r.id).run(); }
  return rows.length;
}

export const _test = { SQL, hex, idOf, newKey, sameKey, signTok, GRACE, KEEP, MAX_LICS, B64, b64ToBytes };
