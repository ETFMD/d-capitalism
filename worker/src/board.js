/* ── 건의 게시판 (/board · 사이트 상단 메뉴 '커뮤니티' → 건의 게시판 /suggest/) ──
 * · 읽기: 누구나 (비밀글은 글쓴이·관리자만) · 쓰기·댓글·공감: 회원만 (간편 로그인 토큰 — auth.js member)
 * · 관리자(auth.js ADMIN_UIDS — 회원 번호로만 판단): 처리 상태 바꾸기 · 답변(댓글에 '운영자' 표시) · 아무 글·댓글 지우기 · 공지 쓰기 · 비밀글·기기 정보·회원 번호 보기
 * · 공개 화면의 닉네임은 가운데를 가림(예: 홍*동 — maskNick) · 관리자 글·답변은 '운영자'
 * · 글은 HTML 이 아닌 일반 글자로 저장하고 화면도 글자로만 그림(스크립트 끼워 넣기 방지) · 길이·횟수 제한(관리자 제외)
 * · 표(schema.sql): board_post · board_cmt · board_vote — 글쓴이가 지우거나 탈퇴하면(auth.js DELETE /auth/me) 즉시 삭제
 *   GET    /board?c=&s=&q=&sort=new|vote&p=1&mine=1&wait=1   목록 20개씩(공지 먼저) + 상태별 개수
 *   GET    /board/<id>                                        글 + 댓글 + 내 공감 여부
 *   POST   /board            {cat, title, body, page, secret, info}   새 글 (회원)
 *   POST   /board/<id>       {cat, title, body, page, secret}         고치기 (글쓴이만)
 *   DELETE /board/<id>                                        지우기 (글쓴이·관리자) — 댓글·공감도 함께
 *   POST   /board/<id>/vote  {on}                             공감 켜기·끄기 (회원 · 내 글 제외)
 *   POST   /board/<id>/cmt   {body}                           댓글 (회원 · 관리자 댓글 = 운영자 답변)
 *   DELETE /board/cmt/<cid>                                   댓글 지우기 (쓴 사람·관리자)
 *   POST   /board/<id>/st    {st}                             처리 상태 (관리자)
 */
import { member, isAdmin } from './auth.js';

export const CATS = ['bug', 'feat', 'etc'], NOTICE = 'notice', STS = ['open', 'plan', 'done', 'hold'];
export const LIM = { title: 80, body: 5000, cmt: 2000, q: 40, per: 20, pages: 500, cmts: 300 };
export const RATE = { postGap: 30, postHour: 5, postDay: 20, cmtGap: 10, cmtDay: 60, dupSec: 600 };   /* 관리자는 제한 없음 */

/* 공개 화면용 닉네임: 첫 글자 + 가림 + 끝 글자 (2글자 이하는 첫 글자 + *) — 카카오 닉네임이 실명인 경우가 많아서 */
export function maskNick(s) {
  const a = Array.from(String(s || '').trim() || '회원');
  if (a.length <= 2) return a[0] + '*';
  return a[0] + '*'.repeat(Math.min(a.length - 2, 4)) + a[a.length - 1];
}
/* 일반 글자로 다듬기: 줄바꿈 통일 · 보이지 않는 제어 문자·방향 바꾸기 문자 제거 · 앞뒤 공백 · 빈 줄 3줄까지 — 너무 길면 null */
const CTRL1 = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;           // 한 줄(제목·검색어)
const CTRLN = /[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g; // 여러 줄(본문·댓글) — 탭·줄바꿈만 남김
export function clean(s, max, multi) {
  s = String(s == null ? '' : s).replace(/\r\n?/g, '\n');
  s = multi ? s.replace(CTRLN, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n') : s.replace(/\s+/g, ' ').replace(CTRL1, '');
  s = s.trim();
  return s.length > max ? null : s;
}
const now = () => Math.floor(Date.now() / 1000);

async function readBody(req) { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return null; } }

/* 글 한 줄(목록·글 보기 공통) — 비밀글은 볼 수 없는 사람에게 제목·화면도 숨김 */
function postOut(x, u, adm) {
  const mine = !!u && x.uid === u.id, see = !x.secret || mine || adm, staff = isAdmin({ id: x.uid });
  const o = { id: x.id, cat: x.cat, st: x.st, title: see ? x.title : '', secret: !!x.secret, locked: !see, page: see ? x.page || '' : '',
    nick: staff ? '운영자' : adm ? (x.nick || '(알 수 없음)') : maskNick(x.nick), staff, me: mine,
    votes: Number(x.votes) || 0, cmts: Number(x.cmts) || 0, ans: !!x.ans, created: x.created, upd: x.upd || null, sat: x.sat || null };
  if (adm) o.uid = x.uid;
  return o;
}
const COUNTS = '(SELECT COUNT(*) FROM board_vote v WHERE v.pid = p.id) AS votes, (SELECT COUNT(*) FROM board_cmt c WHERE c.pid = p.id) AS cmts, ' +
  'EXISTS (SELECT 1 FROM board_cmt a WHERE a.pid = p.id AND a.admin = 1) AS ans';

async function list(env, url, u, adm, json) {
  const sp = url.searchParams, c = sp.get('c') || '', s = sp.get('s') || '', sort = sp.get('sort') === 'vote' ? 'vote' : 'new';
  const q = clean(String(sp.get('q') || '').slice(0, 200), 200, false).slice(0, LIM.q), page = Math.min(LIM.pages, Math.max(1, parseInt(sp.get('p'), 10) || 1));
  const where = [], args = [];
  if (CATS.includes(c) || c === NOTICE) { where.push('p.cat = ?'); args.push(c); }
  if (STS.includes(s)) { where.push('p.st = ?'); args.push(s); }
  if (sp.get('mine') === '1') { where.push('p.uid = ?'); args.push(u ? u.id : -1); }
  if (sp.get('wait') === '1' && adm) where.push("p.st = 'open' AND p.cat <> 'notice' AND NOT EXISTS (SELECT 1 FROM board_cmt a WHERE a.pid = p.id AND a.admin = 1)");
  if (q) {                                                     /* 제목·본문 찾기 — 볼 수 없는 비밀글은 찾기 결과에서도 뺌(본문 내용 짐작 방지) */
    const k = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')"); args.push(k, k);
    if (!adm) { where.push('(p.secret = 0 OR p.uid = ?)'); args.push(u ? u.id : -1); }
  }
  const W = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const order = "(p.cat = 'notice') DESC, " + (sort === 'vote' ? 'votes DESC, p.id DESC' : 'p.id DESC');
  const stmts = [
    env.DB.prepare('SELECT p.id, p.uid, p.cat, p.st, p.title, p.secret, p.page, p.created, p.upd, p.sat, us.nick, ' + COUNTS +
      ' FROM board_post p LEFT JOIN users us ON us.id = p.uid' + W + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').bind(...args, LIM.per, (page - 1) * LIM.per),
    env.DB.prepare('SELECT COUNT(*) AS n FROM board_post p' + W).bind(...args),
    env.DB.prepare("SELECT st, COUNT(*) AS n FROM board_post WHERE cat <> 'notice' GROUP BY st"),
  ];
  if (adm) stmts.push(env.DB.prepare("SELECT COUNT(*) AS n FROM board_post p WHERE p.st = 'open' AND p.cat <> 'notice' AND NOT EXISTS (SELECT 1 FROM board_cmt a WHERE a.pid = p.id AND a.admin = 1)"));
  if (u) stmts.push(env.DB.prepare('SELECT COUNT(*) AS n FROM board_post WHERE uid = ?').bind(u.id));
  const r = await env.DB.batch(stmts);
  const rows = (r[0].results || []).map((x) => postOut(x, u, adm));
  const stat = { open: 0, plan: 0, done: 0, hold: 0 };
  for (const x of r[2].results || []) if (x.st in stat) stat[x.st] = Number(x.n) || 0;
  let i = 3;
  if (adm) stat.wait = Number((r[i++].results[0] || {}).n) || 0;
  if (u) stat.mine = Number((r[i++].results[0] || {}).n) || 0;
  const n = Number((r[1].results[0] || {}).n) || 0;
  return json({ posts: rows, n, page, per: LIM.per, pages: Math.max(1, Math.ceil(n / LIM.per)), stat, viewer: { login: !!u, admin: adm } });
}

async function getPost(env, id) {
  return env.DB.prepare('SELECT p.*, us.nick FROM board_post p LEFT JOIN users us ON us.id = p.uid WHERE p.id = ?').bind(id).first();
}

async function view(env, id, u, adm, json) {
  const x = await getPost(env, id);
  if (!x) return json({ error: 'not found' }, 404);
  const mine = !!u && x.uid === u.id;
  if (x.secret && !mine && !adm) return json({ error: 'secret' }, 403);
  const r = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM board_vote WHERE pid = ?').bind(id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM board_vote WHERE pid = ? AND uid = ?').bind(id, u ? u.id : -1),
    env.DB.prepare('SELECT c.id, c.uid, c.body, c.admin, c.created, us.nick FROM board_cmt c LEFT JOIN users us ON us.id = c.uid WHERE c.pid = ? ORDER BY c.id LIMIT ?').bind(id, LIM.cmts),
  ]);
  const cmts = (r[2].results || []).map((c) => {
    const o = { id: c.id, body: c.body, admin: !!c.admin, me: !!u && c.uid === u.id, created: c.created,
      nick: c.admin ? '운영자' : adm ? (c.nick || '(알 수 없음)') : maskNick(c.nick) };
    if (adm) o.uid = c.uid;
    return o;
  });
  const p = postOut({ ...x, votes: (r[0].results[0] || {}).n, cmts: cmts.length, ans: cmts.some((c) => c.admin) }, u, adm);
  p.body = x.body;
  p.voted = !!Number((r[1].results[0] || {}).n);
  if ((mine || adm) && x.info) { try { p.info = JSON.parse(x.info); } catch (e) {} }
  return json({ post: p, cmts, viewer: { login: !!u, admin: adm } });
}

/* 글 입력값 검사 (새 글·고치기 공통) → {v} 또는 {err} */
function postInput(b, adm) {
  const cat = String(b.cat || '');
  if (!(CATS.includes(cat) || (adm && cat === NOTICE))) return { err: 'cat' };
  const title = clean(b.title, LIM.title, false), body = clean(b.body, LIM.body, true);
  if (title == null || body == null) return { err: 'too long' };
  if (Array.from(title).length < 2) return { err: 'title' };
  if (Array.from(body).length < 5) return { err: 'body' };
  const page = String(b.page || '');
  if (!/^[a-z0-9-]{0,40}$/.test(page)) return { err: 'page' };
  return { v: { cat, title, body, page, secret: b.secret ? 1 : 0 } };
}
function infoOf(b, req) {                                       /* 선택: 오류 확인용 기기 정보 (글쓴이·관리자만 봄) */
  if (!b.info) return null;
  const i = typeof b.info === 'object' ? b.info : {}, n = (x, lo, hi) => { x = Number(x); return isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x * 100) / 100)) : null; };
  const o = { ua: String(req.headers.get('User-Agent') || '').slice(0, 300), w: n(i.w, 0, 20000), h: n(i.h, 0, 20000), dpr: n(i.dpr, 0, 10),
    lang: String(i.lang || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 20), theme: String(i.theme || '').replace(/[^a-z]/g, '').slice(0, 10), zoom: n(i.zoom, 0, 5) };
  return JSON.stringify(o);
}

export async function board(req, env, url, json) {
  const path = url.pathname, m = req.method;
  const u = await member(env, req), adm = isAdmin(u);
  if (path === '/board' && m === 'GET') return await list(env, url, u, adm, json);
  const one = path.match(/^\/board\/(\d{1,9})$/), sub = path.match(/^\/board\/(\d{1,9})\/(vote|cmt|st)$/), cm = path.match(/^\/board\/cmt\/(\d{1,9})$/);
  if (one && m === 'GET') return await view(env, +one[1], u, adm, json);
  if (!(path === '/board' && m === 'POST') && !one && !sub && !cm) return json({ error: 'not found' }, 404);
  if (!u) return json({ error: 'login required' }, 401);
  const t = now();
  let b = {};
  if (m === 'POST') { b = await readBody(req); if (!b) return json({ error: 'bad json' }, 400); }

  if (path === '/board' && m === 'POST') {                       /* 새 글 */
    const r = postInput(b, adm);
    if (r.err) return json({ error: 'bad request', field: r.err }, 400);
    const dup = await env.DB.prepare('SELECT id FROM board_post WHERE uid = ? AND title = ? AND body = ? AND created > ? ORDER BY id DESC LIMIT 1').bind(u.id, r.v.title, r.v.body, t - RATE.dupSec).first();
    if (dup) return json({ ok: true, id: dup.id, dup: true });   /* 두 번 눌러 같은 글이 또 오면 앞의 글 그대로 (횟수 제한보다 먼저) */
    if (!adm) {
      const k = await env.DB.prepare('SELECT COUNT(*) AS d, SUM(CASE WHEN created > ? THEN 1 ELSE 0 END) AS h, MAX(created) AS last FROM board_post WHERE uid = ? AND created > ?')
        .bind(t - 3600, u.id, t - 86400).first();
      if (k && k.last && t - k.last < RATE.postGap) return json({ error: 'slow', wait: RATE.postGap - (t - k.last) }, 429);
      if (k && ((Number(k.h) || 0) >= RATE.postHour || (Number(k.d) || 0) >= RATE.postDay)) return json({ error: 'limit' }, 429);
    }
    const ins = await env.DB.prepare("INSERT INTO board_post (uid, cat, st, title, body, page, secret, info, created) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?)")
      .bind(u.id, r.v.cat, r.v.title, r.v.body, r.v.page, r.v.secret, infoOf(b, req), t).run();
    return json({ ok: true, id: ins.meta && ins.meta.last_row_id });
  }
  if (cm && m === 'DELETE') {                                    /* 댓글 지우기 */
    const c = await env.DB.prepare('SELECT id, uid FROM board_cmt WHERE id = ?').bind(+cm[1]).first();
    if (!c) return json({ error: 'not found' }, 404);
    if (c.uid !== u.id && !adm) return json({ error: 'forbidden' }, 403);
    await env.DB.prepare('DELETE FROM board_cmt WHERE id = ?').bind(c.id).run();
    return json({ ok: true });
  }
  const id = +(one ? one[1] : sub ? sub[1] : 0);
  const x = id ? await getPost(env, id) : null;
  if (!x) return json({ error: 'not found' }, 404);
  const mine = x.uid === u.id;
  if (x.secret && !mine && !adm) return json({ error: 'secret' }, 403);

  if (one && m === 'POST') {                                     /* 고치기 — 글쓴이만 (운영자도 남의 글은 고치지 않음) */
    if (!mine) return json({ error: 'forbidden' }, 403);
    const r = postInput(b, adm);
    if (r.err) return json({ error: 'bad request', field: r.err }, 400);
    await env.DB.prepare('UPDATE board_post SET cat = ?, title = ?, body = ?, page = ?, secret = ?, upd = ? WHERE id = ? AND uid = ?')
      .bind(r.v.cat, r.v.title, r.v.body, r.v.page, r.v.secret, t, id, u.id).run();
    return json({ ok: true });
  }
  if (one && m === 'DELETE') {                                   /* 지우기 — 글쓴이·관리자 · 댓글·공감 함께 */
    if (!mine && !adm) return json({ error: 'forbidden' }, 403);
    await env.DB.batch([env.DB.prepare('DELETE FROM board_vote WHERE pid = ?').bind(id), env.DB.prepare('DELETE FROM board_cmt WHERE pid = ?').bind(id),
      env.DB.prepare('DELETE FROM board_post WHERE id = ?').bind(id)]);
    return json({ ok: true });
  }
  if (sub && sub[2] === 'vote' && m === 'POST') {                /* 공감 — 바라는 상태(on)로 맞춤(두 번 눌러도 같은 결과) */
    if (mine) return json({ error: 'own' }, 403);
    if (x.cat === NOTICE) return json({ error: 'notice' }, 400);
    const on = b.on !== false;
    await env.DB.prepare(on ? 'INSERT OR IGNORE INTO board_vote (pid, uid) VALUES (?, ?)' : 'DELETE FROM board_vote WHERE pid = ? AND uid = ?').bind(id, u.id).run();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM board_vote WHERE pid = ?').bind(id).first();
    return json({ ok: true, voted: on, votes: Number(n && n.n) || 0 });
  }
  if (sub && sub[2] === 'cmt' && m === 'POST') {                 /* 댓글 */
    const body = clean(b.body, LIM.cmt, true);
    if (body == null) return json({ error: 'bad request', field: 'too long' }, 400);
    if (!body) return json({ error: 'bad request', field: 'body' }, 400);
    const dup = await env.DB.prepare('SELECT id FROM board_cmt WHERE pid = ? AND uid = ? AND body = ? AND created > ? LIMIT 1').bind(id, u.id, body, t - RATE.dupSec).first();
    if (dup) return json({ ok: true, id: dup.id, dup: true });
    if (!adm) {
      const k = await env.DB.prepare('SELECT COUNT(*) AS d, MAX(created) AS last FROM board_cmt WHERE uid = ? AND created > ?').bind(u.id, t - 86400).first();
      if (k && k.last && t - k.last < RATE.cmtGap) return json({ error: 'slow', wait: RATE.cmtGap - (t - k.last) }, 429);
      if (k && (Number(k.d) || 0) >= RATE.cmtDay) return json({ error: 'limit' }, 429);
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM board_cmt WHERE pid = ?').bind(id).first();
      if (n && n.n >= LIM.cmts) return json({ error: 'full' }, 409);
    }
    const ins = await env.DB.prepare('INSERT INTO board_cmt (pid, uid, body, admin, created) VALUES (?, ?, ?, ?, ?)').bind(id, u.id, body, adm ? 1 : 0, t).run();
    return json({ ok: true, id: ins.meta && ins.meta.last_row_id });
  }
  if (sub && sub[2] === 'st' && m === 'POST') {                  /* 처리 상태 — 관리자 */
    if (!adm) return json({ error: 'admin only' }, 403);
    const st = String(b.st || '');
    if (!STS.includes(st)) return json({ error: 'bad request', field: 'st' }, 400);
    await env.DB.prepare('UPDATE board_post SET st = ?, sat = ? WHERE id = ?').bind(st, t, id).run();
    return json({ ok: true, st });
  }
  return json({ error: 'not found' }, 404);
}
