/* 72루틴 자동매매 PC 프로그램 생존 감시 (/hb) — PC 가 꺼지거나 프로그램이 멈춰 주문을 놓치기 전에 사람에게 알림
 * · PC 프로그램(routine72-auto)이 실행될 때마다(5분마다 · 주문 시각) POST /hb { key, next(다음 주문 시각 ms), cut(LOC 접수 마감 ms), ds, st, mid }
 *   - key: PC 마다 무작위(그 PC 비밀값 저장소에만) · 이 Worker 는 SHA-256(key) 앞 32자(id)만 저장
 *   - 처음(또는 알림 대상이 바뀌면) cred { tg:{token, chat}, nt: 'https://ntfy.sh/주제' } — HB_KEY(Worker 비밀값 · 배포 때 자동 생성)로 AES-GCM 암호화해 D1 에 보관
 * · 15분마다(cron) 확인
 *   - 주문 시각 + 20분이 지났는데 그 뒤 신호가 없음 → 텔레그램(+ntfy) '🚨 PC 신호 없음' · 접수 마감 1시간 전에 한 번 더
 *   - (2026-10-22) 전략별 일정 sch [{ w:'72'|'sma', n 주문·판단 시각, c 접수 마감, nd 그때까지 신호가 있어야 하는 시각 }] — st 안에 저장(표 모양 그대로)
 *     · 1시간 전 미리 알림: 시각 1시간 전 ~ 시각 사이에 마지막 신호가 nd − 5분(PC 시계 여유)보다 앞이면 '⏰ PC 신호 없음(미리 알림)' — 그날을 살릴 1시간
 *       (nd = 그 전 마지막 깨우기 실행 · 늘 켜진 PC 의 25분 신호 간격을 생각해 1시간 30분 전보다 늦지 않게 — PC 가 정해 보냄 · 절전했다 제때 깨는 PC 는 알리지 않음)
 *     · 시각 뒤 알림: 72루틴 + 20분 · SMA 200 + 5분(판단 창 10분 · 15분 cron 이라 실제로는 접수 마감 무렵) — 전략 이름으로
 *     · sch 가 없으면(옛 PC 프로그램) 예전대로 next·cut 으로
 *   - 72시간 넘게 신호 없음(자동매매를 꺼 둔 때 등) → 하루 한 번 · 세 번까지
 *   - 알림 뒤 다시 신호가 오면 '✅ 다시 들어옴'
 * · 같은 텔레그램(알림 대상)으로 다른 PC 가 3시간 안에 신호를 보냈으면 '두 PC 에서 도는 중'(주문이 두 번 들어갈 수 있음) 경고 · 옛 기록은 새 등록이 이어받음
 * · 남용 막기: 기록 30개까지(7일 넘게 조용한 것부터 정리) · 본문 4KB · 30일 넘게 신호 없으면 지움 · 알림은 저장된 대상에게만
 * · 알림 대상을 풀 수 없으면(HB_KEY 바뀜) 지우고 → PC 의 다음 신호에 need:cred 로 다시 받음
 * · GET /hb → { ok, ready(HB_KEY 있음), now } — PC 프로그램이 시계 오차·연결 확인에 씀 */
const MAX_ROWS = 30, MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const GRACE = 20 * MIN, REMIND = HOUR, SILENT = 72 * HOUR, KEEP = 30 * DAY, PRE = HOUR, GRACE_SMA = 5 * MIN, ND_TOL = 5 * MIN;   /* ND_TOL: PC 시계가 몇 초~몇 분 빨라 예정 실행 신호가 nd 보다 조금 앞에 찍혀도 미리 알림을 보내지 않게(2026-10-22 독립 검토) */

const SQL = {
  get: 'SELECT id, tgh, mid, cred, last, alarm FROM hb WHERE id = ?',
  count: 'SELECT COUNT(*) AS n FROM hb',
  trim: 'DELETE FROM hb WHERE last < ?',
  del: 'DELETE FROM hb WHERE id = ?',
  same: 'SELECT id, mid, last, alarm FROM hb WHERE tgh = ? AND id != ?',
  dropSame: 'DELETE FROM hb WHERE tgh = ? AND id != ?',
  put: 'INSERT INTO hb (id, tgh, mid, cred, last, next, cut, ds, st, alarm, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET tgh = excluded.tgh, mid = excluded.mid, cred = excluded.cred, last = excluded.last, next = excluded.next, cut = excluded.cut, ds = excluded.ds, st = excluded.st, alarm = excluded.alarm',
  all: 'SELECT id, cred, last, next, cut, ds, st, alarm FROM hb',
  alarm: 'UPDATE hb SET alarm = ? WHERE id = ?',
  noCred: 'UPDATE hb SET cred = NULL WHERE id = ?',
};

const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hex(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function aesKey(env) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('r72hb|' + env.HB_KEY)), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text)));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(env, s) {
  const [iv, ct] = String(s || '').split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct)));
}
const parse = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
const num = (v) => (Number.isFinite(+v) && +v > 0 && +v < 4e12 ? Math.floor(+v) : null);
function kst(ms) { const d = new Date(ms + 9 * HOUR); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function dur(ms) { const h = Math.floor(ms / HOUR), m = Math.round((ms % HOUR) / MIN); return h >= 48 ? Math.round(ms / DAY) + '일' : (h ? h + '시간 ' : '') + m + '분'; }
function cleanCred(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  if (c.tg) {
    const t = String(c.tg.token || ''), ch = String(c.tg.chat || '');
    if (!/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(t) || !/^-?\d{1,20}$/.test(ch)) return null;
    out.tg = { token: t, chat: ch };
  }
  if (c.nt) { const n = String(c.nt); if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[A-Za-z0-9_-]{8,64}$/.test(n)) return null; out.nt = n; }
  return out.tg || out.nt ? out : null;
}
function cleanSch(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v.slice(0, 4) : []) {
    const w = x && (x.w === '72' || x.w === 'sma') ? x.w : null, n = num(x && x.n);
    if (w && n && !out.some((y) => y.w === w)) out.push({ w, n, c: num(x.c), nd: num(x.nd) });
  }
  return out;
}
function cleanSt(s) {
  s = s && typeof s === 'object' ? s : {};
  const o = { en: s.en ? 1 : 0, pz: s.pz ? 1 : 0, tgf: Math.min(9999, Math.max(0, Math.floor(+s.tgf) || 0)), v: String(s.v || '').slice(0, 16) };
  const sch = cleanSch(s.sch); if (sch.length) o.sch = sch;
  return o;
}

/** 알림 보내기 — 텔레그램(+ntfy 는 첫 줄만) · 하나라도 가면 true */
async function deliver(env, sealed, text) {
  let c; try { c = JSON.parse(await unseal(env, sealed)); } catch (e) { throw Object.assign(new Error('unseal'), { unseal: true }); }   /* HB_KEY 가 바뀜 등 → 알림 대상을 다시 받아야 함 */
  const jobs = [];
  if (c.tg) jobs.push(fetch('https://api.telegram.org/bot' + c.tg.token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.tg.chat, text: '[72루틴 SMA 200 생존 감시] ' + text, disable_web_page_preview: true }) }).then((r) => r.ok));
  if (c.nt) {
    const u = new URL(c.nt);
    jobs.push(fetch(u.origin + '/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: u.pathname.slice(1), title: '72루틴 SMA 200 생존 감시', message: text.split('\n')[0].slice(0, 240), priority: 5, tags: ['rotating_light'] }) }).then((r) => r.ok));
  }
  const rs = await Promise.allSettled(jobs);
  return rs.some((r) => r.status === 'fulfilled' && r.value);
}

const DUP = '⚠ 같은 텔레그램으로 알림을 받는 72루틴 프로그램이 다른 PC 에서도 돌고 있어요(최근 3시간 안에 신호).\nPC 를 바꿨다면 옛 PC 에서 uninstall.cmd 로 작업 스케줄러를 지워 주세요 — 두 PC 가 같은 계좌로 돌면 주문이 두 번 들어갈 수 있어요.';
const a1 = (r, now) => '🚨 PC 신호 없음 — 주문 시각(' + kst(r.next) + ')이 ' + dur(now - r.next) + ' 지났는데 PC 프로그램이 실행되지 않았어요 (마지막 신호 ' + kst(r.last) + ').\nPC 전원·절전·인터넷·윈도우 업데이트 재시작을 확인해 주세요.' + (r.cut ? ' LOC 접수 마감(' + kst(r.cut) + ') 전에 프로그램이 다시 돌면 오늘 주문을 넣어요.' : '');
const a2 = (r) => '🚨 아직 PC 신호가 없어요 — LOC 접수 마감(' + kst(r.cut) + ')까지 1시간 남았어요. 지금 PC 를 켜면 오늘 주문을 넣을 수 있어요.';
/* 전략별 일정(sch) 알림 */
const NAME = { '72': '72루틴', sma: 'SMA 200' }, WHAT = { '72': '주문', sma: '마감 전 판단' };
const p0 = (r, s, now) => '⏰ PC 신호 없음(미리 알림) — ' + NAME[s.w] + ' ' + WHAT[s.w] + ' 시각(' + kst(s.n) + ')까지 ' + dur(s.n - now) + ' 남았는데, PC 프로그램 신호가 ' + kst(r.last) + ' 뒤로 없어요(' + kst(s.nd) + ' 무렵에는 실행됐어야 해요).\nPC 전원·절전·인터넷·윈도우 업데이트 재시작을 확인해 주세요 — 그 시각 전에 PC 가 켜지면 오늘 ' + (s.w === 'sma' ? '판단·주문' : '주문') + '을 그대로 해요.';
const l1 = (r, s, now) => s.w === 'sma'
  ? '🚨 PC 신호 없음 — SMA 200 마감 전 판단 시각(' + kst(s.n) + ')이 ' + dur(now - s.n) + ' 지났는데 PC 프로그램이 실행되지 않았어요 (마지막 신호 ' + kst(r.last) + ').\n' + (s.c && now < s.c ? '접수 마감(' + kst(s.c) + ') 전에 프로그램이 돌면 오늘 판단해요.' : '오늘 SMA 200 판단 창(접수 마감 ' + (s.c ? kst(s.c) : '—') + ')이 지났어요 — 다음 거래일 판단에서 공식 종가 신호대로 맞춰요(하루 늦게 따라감).') + ' PC 전원·절전·인터넷을 확인해 주세요.'
  : '🚨 PC 신호 없음 — 72루틴 주문 시각(' + kst(s.n) + ')이 ' + dur(now - s.n) + ' 지났는데 PC 프로그램이 실행되지 않았어요 (마지막 신호 ' + kst(r.last) + ').\nPC 전원·절전·인터넷·윈도우 업데이트 재시작을 확인해 주세요.' + (s.c && now < s.c ? ' LOC 접수 마감(' + kst(s.c) + ') 전에 프로그램이 다시 돌면 오늘 주문을 넣어요.' : '');   /* 일정의 72루틴 시각·마감(예전 r.next 는 두 전략 중 빠른 것 — SMA 200 시각이 나올 수 있었음 · 2026-10-22 독립 검토) */
const l2 = (r, s) => '🚨 아직 PC 신호가 없어요 — ' + NAME[s.w] + ' LOC 접수 마감(' + kst(s.c) + ')까지 1시간 남았어요. 지금 PC 를 켜면 오늘 주문을 넣을 수 있어요.';
const a3 = (r, now) => '⚠ PC 프로그램 신호가 ' + dur(now - r.last) + '째 없어요 (마지막 ' + kst(r.last) + '). 일부러 끈 거면 무시해도 돼요 — 프로그램 설정에서 생존 감시를 끄면 이 알림도 멈춰요.';

export async function hb(req, env, json) {
  const now = Date.now();
  if (req.method === 'GET') return json({ ok: true, ready: !!env.HB_KEY, now });
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  const raw = await req.text();
  if (raw.length > 4000) return json({ ok: false, error: 'too big' }, 413);
  let b; try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, error: 'json' }, 400); }
  const key = String(b && b.key || '');
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(key)) return json({ ok: false, error: 'key' }, 400);
  const id = (await hex('r72hb|' + key)).slice(0, 32);
  if (b.bye) { await env.DB.prepare(SQL.del).bind(id).run(); return json({ ok: true, bye: true, now }); }
  const row = await env.DB.prepare(SQL.get).bind(id).first();
  let cred = row ? row.cred : null, tgh = row ? row.tgh : null;
  const mid = /^[a-f0-9]{8,64}$/.test(String(b.mid || '')) ? String(b.mid) : (row && row.mid) || null;
  if (b.cred) {
    if (!env.HB_KEY) return json({ ok: false, error: 'not-ready' }, 503);
    const c = cleanCred(b.cred);
    if (!c) return json({ ok: false, error: 'cred' }, 400);
    cred = await seal(env, JSON.stringify(c));
    tgh = (await hex(c.tg ? 'tg|' + c.tg.token + '|' + c.tg.chat : 'nt|' + c.nt)).slice(0, 32);
  }
  if (!cred) return json({ ok: false, need: 'cred', now });
  if (!row) {
    let n = await env.DB.prepare(SQL.count).first();
    if (n && n.n >= MAX_ROWS) { await env.DB.prepare(SQL.trim).bind(now - 7 * DAY).run(); n = await env.DB.prepare(SQL.count).first(); }
    if (n && n.n >= MAX_ROWS) return json({ ok: false, error: 'full' }, 429);
  }
  const alarm = row ? parse(row.alarm) : {}, notes = [];
  if (b.cred) {   /* 같은 알림 대상의 다른 기록 — 다른 PC(mid 다름)가 3시간 안에 돌았으면 경고 · 옛 기록은 이 등록이 이어받음 */
    const others = ((await env.DB.prepare(SQL.same).bind(tgh, id).all()).results) || [];
    if (others.length) {
      /* 경고는 6시간에 한 번 — 두 PC 가 번갈아 등록하며 서로의 기록을 지워도(새 기록) 지운 기록의 마지막 경고 시각을 이어받음 */
      const dupAt = Math.max(alarm.dup || 0, ...others.map((x) => parse(x.alarm).dup || 0));
      if (others.some((x) => x.last > now - 3 * HOUR && (!mid || !x.mid || x.mid !== mid)) && !(dupAt && now - dupAt < 6 * HOUR)) { notes.push(DUP); alarm.dup = now; }
      else if (dupAt) alarm.dup = dupAt;
      await env.DB.prepare(SQL.dropSame).bind(tgh, id).run();
    }
  }
  if (alarm.on && row) { notes.push('✅ PC 신호가 다시 들어왔어요 (멈춰 있던 시간 약 ' + dur(now - row.last) + ').'); delete alarm.on; delete alarm.a3n; }
  const st = JSON.stringify(cleanSt(Object.assign({}, b.st, { v: b.v })));
  const ds = /^\d{4}-\d{2}-\d{2}$/.test(String(b.ds || '')) ? b.ds : null;
  await env.DB.prepare(SQL.put).bind(id, tgh, mid, cred, now, num(b.next), num(b.cut), ds, st, JSON.stringify(alarm), now).run();
  if (notes.length) { try { await deliver(env, cred, notes.join('\n\n')); } catch (e) { /* 알림 실패는 신호 기록과 따로 */ } }
  return json({ ok: true, now, cred: true });
}

/** cron(15분마다) — 놓친 주문 시각 · 오래 조용함 */
export async function hbScan(env, now) {
  if (!env.HB_KEY) return 0;
  const rows = ((await env.DB.prepare(SQL.all).all()).results) || [];
  let sent = 0;
  for (const r of rows) {
    if (r.last < now - KEEP) { await env.DB.prepare(SQL.del).bind(r.id).run(); continue; }
    const a = parse(r.alarm), msgs = [], mark = [], sch = parse(r.st).sch || [];
    if (sch.length) {   /* 전략별 일정(2026-10-22) — 72루틴·SMA 200 따로 · 1시간 전 미리 알림 */
      for (const s of sch) {
        if (!(r.last < s.n)) continue;   /* 그 시각 뒤 신호가 왔음 */
        const k = s.w, gr = s.w === 'sma' ? GRACE_SMA : GRACE, L = a.l || {}, P = a.p || {}, R = a.r || {};
        if (now >= s.n + gr && L[k] !== s.n) { msgs.push(l1(r, s, now)); mark.push(() => { a.l = Object.assign({}, a.l, { [k]: s.n }); a.on = a.on || now; }); }
        else if (s.c && L[k] === s.n && R[k] !== s.n && s.c - REMIND > s.n + gr && now >= s.c - REMIND && now < s.c) { msgs.push(l2(r, s)); mark.push(() => { a.r = Object.assign({}, a.r, { [k]: s.n }); }); }
        else if (s.nd && now >= s.n - PRE && now < s.n && r.last < s.nd - ND_TOL && P[k] !== s.n) { msgs.push(p0(r, s, now)); mark.push(() => { a.p = Object.assign({}, a.p, { [k]: s.n }); a.on = a.on || now; }); }
      }
    } else if (r.next && r.last < r.next) {
      if (now >= r.next + GRACE && a.a1 !== r.next) { msgs.push(a1(r, now)); mark.push(() => { a.a1 = r.next; a.on = a.on || now; }); }
      else if (r.cut && a.a1 === r.next && a.a2 !== r.next && now >= r.cut - REMIND && now < r.cut) { msgs.push(a2(r)); mark.push(() => { a.a2 = r.next; }); }
    }
    if (now - r.last >= SILENT && (!a.a3 || now - a.a3 >= DAY) && (a.a3n || 0) < 3) { msgs.push(a3(r, now)); mark.push(() => { a.a3 = now; a.a3n = (a.a3n || 0) + 1; a.on = a.on || now; }); }
    if (!msgs.length) continue;
    let ok = false;
    try { ok = await deliver(env, r.cred, msgs.join('\n\n')); }
    catch (e) { ok = false; if (e && e.unseal) await env.DB.prepare(SQL.noCred).bind(r.id).run(); }   /* 풀 수 없는 알림 대상 → 지움 → PC 의 다음 신호에 need:cred 로 다시 받음 */
    if (ok || (a.f || 0) >= 2) { mark.forEach((f) => f()); delete a.f; if (ok) sent++; } else a.f = (a.f || 0) + 1;   /* 못 보냈으면 다음 cron 에 다시(세 번까지) */
    await env.DB.prepare(SQL.alarm).bind(JSON.stringify(a), r.id).run();
  }
  return sent;
}

export const _test = { SQL, cleanCred, cleanSch, kst, dur, GRACE, REMIND, SILENT, KEEP, MAX_ROWS, PRE, GRACE_SMA, ND_TOL, hex };
