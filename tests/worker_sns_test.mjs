// Worker SNS 자동 게시(/sns — worker/src/sns.js) 단독 확인 (node tests/worker_sns_test.mjs · run_regression.py 가 부름)
//  · 관리자만(다른 회원·다른 출처 403) · 연결(OAuth 주소에 비밀값 없음 · state 한 번만 · 시간 지나면 거절 · 토큰은 암호화해 저장)
//  · 유튜브(갱신 토큰 · 채널 이름)·인스타(data[] 응답 · 60일 토큰 교환·갱신)·스레드·페이스북(글쓰기 가능한 페이지만) 연결
//  · 영상 조각 올리기(크기 확인) → 공개 주소(전체·Range·HEAD·416) = 올린 바이트 그대로
//  · 게시: 유튜브 이어 올리기(조각별 Content-Range · 308 → 200 → 쇼츠 주소) · 인스타 릴스(컨테이너 → FINISHED → 게시 → permalink)
//    · 스레드(VIDEO → FINISHED → threads_publish) · 페이스북 릴스(start → rupload file_url → 업로드 끝 → finish → published)
//  · 같은 영상·같은 SNS 는 한 번만 · 진행 중이면 다시 시작 안 함 · 실패 뒤 다시 시도 · 90초 넘는 영상은 페이스북 거절 · 20분 넘으면 실패
//  · Meta 연결 끊기·자료 삭제 콜백(signed_request 서명 확인)
// D1: node:sqlite(Node 22.13+) 가 있으면 진짜 SQLite 로 sns.js 의 SQL 그대로 · 없으면 같은 뜻의 모의 표 (SNS_FAKE=1 이면 모의 표만)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'snst-')), 'sns.mjs');
fs.copyFileSync(path.join(ROOT, 'worker', 'src', 'sns.js'), tmp);

/* Workers 전용 FixedLengthStream 흉내 (길이가 다르면 오류) */
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(n) { let got = 0; super({ transform(ch, c) { got += ch.byteLength; if (got > n) c.error(new Error('too long')); else c.enqueue(ch); }, flush(c) { if (got !== n) c.error(new Error('length ' + got + ' != ' + n)); } }); this.expected = n; }
};
const { sns, _test } = await import(pathToFileURL(tmp).href);
const Q = _test.SQL, PART = _test.PART;

let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('  ✗ ' + msg); } }

/* ── D1 ── */
let mode = 'fake', DB;
if (!process.env.SNS_FAKE) {
  try {
    const ew = process.emitWarning; process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : ew.call(process, w, ...a));
    const { DatabaseSync } = await import('node:sqlite').finally(() => { process.emitWarning = ew; });
    const db = new DatabaseSync(':memory:');
    const st = (sql, a) => { const s = db.prepare(sql); return { first: async () => s.get(...a) || null, all: async () => ({ results: s.all(...a) }), run: async () => { const r = s.run(...a); return { meta: { changes: Number(r.changes) } }; } }; };
    DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
    mode = 'sqlite';
  } catch (e) { DB = null; }
}
if (!DB) {   /* 모의 표: sns.js 의 SQL 문장을 그대로 받아 같은 뜻으로 */
  const T = { tok: new Map(), st: new Map(), job: new Map(), post: new Map() };
  const ex = (sql, a) => {
    if (Q.init.includes(sql)) return null;
    switch (sql) {
      case Q.tokGet: { const r = T.tok.get(a[0]); return r ? { enc: r.enc, name: r.name, exp: r.exp, upd: r.upd } : null; }
      case Q.tokAll: return [...T.tok.values()].map((r) => ({ p: r.p, name: r.name, exp: r.exp, upd: r.upd }));
      case Q.tokPut: T.tok.set(a[0], { p: a[0], enc: a[1], name: a[2], exp: a[3], upd: a[4] }); return { c: 1 };
      case Q.tokDel: return { c: T.tok.delete(a[0]) ? 1 : 0 };
      case Q.stPut: if (T.st.has(a[0])) throw new Error('UNIQUE'); T.st.set(a[0], { p: a[1], back: a[2], exp: a[3] }); return { c: 1 };
      case Q.stGet: { const r = T.st.get(a[0]); return r ? { ...r } : null; }
      case Q.stDel: return { c: T.st.delete(a[0]) ? 1 : 0 };
      case Q.stOld: { let c = 0; for (const [k, v] of T.st) if (v.exp < a[0]) { T.st.delete(k); c++; } return { c }; }
      case Q.jobGet: { const r = T.job.get(a[0]); return r ? { ...r } : null; }
      case Q.jobPut: if (T.job.has(a[0])) throw new Error('UNIQUE'); T.job.set(a[0], { id: a[0], size: a[1], parts: a[2], have: a[3], dur: a[4], w: a[5], h: a[6], audio: a[7], created: a[8] }); return { c: 1 };
      case Q.jobDel: return { c: T.job.delete(a[0]) ? 1 : 0 };
      case Q.jobHave: { const r = T.job.get(a[1]); if (r) r.have = a[0]; return { c: r ? 1 : 0 }; }
      case Q.jobOld: { let c = 0; for (const [k, v] of T.job) if (v.created < a[0]) { T.job.delete(k); c++; } return { c }; }
      case Q.postGet: { const r = T.post.get(a[0] + '|' + a[1]); return r ? { ...r } : null; }
      case Q.postAll: return [...T.post.values()].filter((r) => r.job === a[0]).map((r) => ({ p: r.p, st: r.st, url: r.url, err: r.err, upd: r.upd }));
      case Q.postPut: T.post.set(a[0] + '|' + a[1], { job: a[0], p: a[1], st: a[2], data: a[3], url: a[4], err: a[5], upd: a[6] }); return { c: 1 };
      case Q.postOld: { let c = 0; for (const [k, v] of T.post) if (v.upd < a[0]) { T.post.delete(k); c++; } return { c }; }
    }
    throw new Error('모의 표에 없는 SQL: ' + sql);
  };
  const st = (sql, a) => ({ first: async () => { const r = ex(sql, a); return Array.isArray(r) ? r[0] || null : r && r.c == null ? r : null; },
    all: async () => { const r = ex(sql, a); return { results: Array.isArray(r) ? r : [] }; }, run: async () => { const r = ex(sql, a); return { meta: { changes: r && r.c != null ? r.c : 0 } }; } });
  DB = { prepare: (sql) => Object.assign(st(sql, []), { bind: (...a) => st(sql, a) }) };
}

/* ── KV (스트림으로 받고 64KB 조각으로 내줌) ── */
const KVM = new Map();
async function readAll(v) {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof v === 'string') return new TextEncoder().encode(v);
  const r = v.getReader(), out = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; out.push(value); n += value.byteLength; }
  const u = new Uint8Array(n); let o = 0; for (const x of out) { u.set(x, o); o += x.byteLength; } return u;
}
const KV = {
  async put(k, v, o) { KVM.set(k, { u: await readAll(v), ttl: o && o.expirationTtl }); },
  async get(k, o) { const x = KVM.get(k); if (!x) return null; const u = x.u; let i = 0;
    return new ReadableStream({ pull(c) { if (i >= u.length) { c.close(); return; } c.enqueue(u.slice(i, i + 65536)); i += 65536; } }); },
};

/* ── 외부 API 흉내 ── */
const calls = [];
let H = {};   /* 'METHOD host/path' 앞부분 → (url, opt, body) => Response */
const jr = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
globalThis.fetch = async (url, opt = {}) => {
  const u = new URL(url), m = (opt.method || 'GET').toUpperCase(), key = m + ' ' + u.host + u.pathname;
  let body = opt.body;
  if (body != null) body = await readAll(body);   /* 문자열·스트림 모두 바이트로 */
  calls.push({ key, url: String(url), opt, body });
  for (const k of Object.keys(H)) if (key.startsWith(k)) return H[k](u, opt, body);
  throw new Error('흉내 없는 요청: ' + key);
};

const ORIGIN = 'https://d-capitalism.com', W = 'https://etfmd-counter.test.workers.dev';
const env = { DB, SNS_KV: KV, SNS_KEY: 'k'.repeat(64), ALLOWED_ORIGINS: 'https://etfmd.github.io,' + ORIGIN,
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', IG_APP_ID: 'igid', IG_APP_SECRET: 'igsecret', TH_APP_ID: 'thid', TH_APP_SECRET: 'thsecret', FB_APP_ID: 'fbid', FB_APP_SECRET: 'fbsecret' };
const adminUser = async (e, req) => (req.headers.get('Authorization') === 'Bearer admin' ? { id: 2 } : null);
async function call(method, p, { body, raw, origin = ORIGIN, auth = 'admin', headers = {} } = {}) {
  const h = { ...headers }; if (origin) h.Origin = origin; if (auth) h.Authorization = 'Bearer ' + auth;
  let b; if (raw !== undefined) { b = raw; h['Content-Length'] = String(raw.byteLength != null ? raw.byteLength : raw.length); } else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const req = new Request(W + p, { method, headers: h, body: b, duplex: 'half' });
  const okOrigin = env.ALLOWED_ORIGINS.split(',').includes(origin || '');
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  const r = await sns(req, env, new URL(req.url), json, { ok: okOrigin, headers: {} }, adminUser);
  return r;
}
const J = async (r) => ({ s: r.status, j: await r.json() });

/* 1. 권한 */
let r = await J(await call('GET', '/sns/status', { auth: 'someone' }));
ok(r.s === 403, '관리자가 아니면 403');
r = await J(await call('GET', '/sns/status', { origin: 'https://evil.example' }));
ok(r.s === 403 && r.j.error === 'origin', '다른 출처면 403');
r = await J(await call('GET', '/sns/status'));
ok(r.s === 200 && r.j.key && r.j.kv && ['yt', 'ig', 'th', 'fb'].every((p) => r.j.p[p].ready && !r.j.p[p].conn && r.j.p[p].cb === W + '/sns/cb/' + p), '상태: 4곳 준비됨·미연결·콜백 주소');

/* 2. 연결 */
async function connect(p, cbResp) {
  const c = await J(await call('POST', '/sns/connect/' + p, { body: { back: ORIGIN + '/asset-speed/' } }));
  const u = new URL(c.j.url), state = u.searchParams.get('state');
  ok(c.s === 200 && state && u.searchParams.get('redirect_uri') === W + '/sns/cb/' + p && !c.j.url.includes('secret'), p + ' 연결 주소 (state · redirect_uri · 비밀값 없음)');
  const res = await call('GET', '/sns/cb/' + p + '?code=CODE' + p + '&state=' + state + (cbResp || ''), { origin: null, auth: null });
  return { res, state, u };
}
H = {
  'POST oauth2.googleapis.com/token': (u, o, b) => { const f = new URLSearchParams(new TextDecoder().decode(b));
    if (f.get('grant_type') === 'authorization_code') return jr(f.get('code') === 'CODEyt' ? { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3599 } : { error: 'invalid_grant' }, f.get('code') === 'CODEyt' ? 200 : 400);
    return jr({ access_token: 'AT2', expires_in: 3599 }); },
  'GET www.googleapis.com/youtube/v3/channels': () => jr({ items: [{ id: 'UC1', snippet: { title: '디코딩 자본주의' } }] }),
};
let c = await connect('yt');
const loc = c.res.headers.get('Location');
ok(c.res.status === 302 && loc === ORIGIN + '/asset-speed/#sns=yt:ok', '유튜브 연결 → 사이트로 돌아감 (#sns=yt:ok) ' + loc);
ok(c.u.searchParams.get('access_type') === 'offline' && c.u.searchParams.get('prompt') === 'consent' && /youtube\.upload/.test(c.u.searchParams.get('scope')), '유튜브 주소: offline·consent·youtube.upload');
const row = await DB.prepare(Q.tokGet).bind('yt').first();
ok(row && row.name === '디코딩 자본주의' && !/RT1|AT1/.test(row.enc), '토큰은 암호화해 저장 (원문 없음) · 채널 이름');
const again = await call('GET', '/sns/cb/yt?code=CODEyt&state=' + c.state, { origin: null, auth: null });
ok(/#sns=yt:err/.test(again.headers.get('Location')), '같은 state 두 번째는 거절');
const bad = await call('GET', '/sns/cb/yt?code=CODEyt&state=nope', { origin: null, auth: null });
ok(/#sns=yt:err/.test(bad.headers.get('Location')), '모르는 state 거절');
const denied = await connect('yt', '&error=access_denied');
ok(/#sns=yt:err:access_denied/.test(denied.res.headers.get('Location')), '취소하면 err');
H['GET www.googleapis.com/youtube/v3/channels'] = () => jr({ items: [] });
H['POST oauth2.googleapis.com/token'] = () => jr({ access_token: 'AT1', expires_in: 3599 });   /* 갱신 토큰 없음 */
c = await connect('yt');
ok(/err:/.test(c.res.headers.get('Location')) && decodeURIComponent(c.res.headers.get('Location')).includes('갱신 토큰'), '갱신 토큰이 없으면 안내와 함께 실패');
ok((await DB.prepare(Q.tokGet).bind('yt').first()).name === '디코딩 자본주의', '실패한 다시 연결은 기존 연결을 지우지 않음');
H['POST oauth2.googleapis.com/token'] = (u, o, b) => { const f = new URLSearchParams(new TextDecoder().decode(b)); return jr(f.get('grant_type') === 'refresh_token' ? { access_token: 'AT2', expires_in: 3599 } : { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3599 }); };
H['GET www.googleapis.com/youtube/v3/channels'] = () => jr({ items: [{ id: 'UC1', snippet: { title: '디코딩 자본주의' } }] });

H['POST api.instagram.com/oauth/access_token'] = () => jr({ data: [{ access_token: 'IGS', user_id: '111', permissions: 'instagram_business_basic,instagram_business_content_publish' }] });
H['GET graph.instagram.com/access_token'] = (u) => jr(u.searchParams.get('grant_type') === 'ig_exchange_token' && u.searchParams.get('access_token') === 'IGS' && u.searchParams.get('client_secret') === 'igsecret' ? { access_token: 'IGL', token_type: 'bearer', expires_in: 5183944 } : { error: { message: 'bad' } }, 200);
H['GET graph.instagram.com/v26.0/me'] = () => jr({ user_id: '1784', username: 'dcap' });
c = await connect('ig');
ok(c.res.headers.get('Location').endsWith('#sns=ig:ok') && /instagram_business_content_publish/.test(c.u.searchParams.get('scope')), '인스타 연결 (data[] 응답 · 60일 토큰 교환)');
H['POST graph.threads.com/oauth/access_token'] = () => jr({ access_token: 'THS', user_id: '222' });
H['GET graph.threads.com/access_token'] = (u) => jr(u.searchParams.get('grant_type') === 'th_exchange_token' ? { access_token: 'THL', expires_in: 5183944 } : { error: { message: 'bad' } });
H['GET graph.threads.com/v1.0/me'] = () => jr({ id: '333', username: 'dcap' });
c = await connect('th');
ok(c.res.headers.get('Location').endsWith('#sns=th:ok') && c.u.host === 'threads.com', '스레드 연결');
H['GET graph.facebook.com/v26.0/oauth/access_token'] = (u) => jr(u.searchParams.get('grant_type') === 'fb_exchange_token' ? { access_token: 'FBL', expires_in: 5183944 } : { access_token: 'FBS' });
H['GET graph.facebook.com/v26.0/me/accounts'] = () => jr({ data: [{ id: '9', name: '보기만', access_token: 'P9', tasks: ['ANALYZE'] }, { id: '10', name: '디코딩 자본주의', access_token: 'P10', tasks: ['CREATE_CONTENT', 'MANAGE'] }] });
c = await connect('fb');
ok(c.res.headers.get('Location').endsWith('#sns=fb:ok') && /pages_manage_posts/.test(c.u.searchParams.get('scope')), '페이스북 연결 (scope)');
r = await J(await call('GET', '/sns/status'));
ok(r.j.p.fb.conn && r.j.p.fb.pages.length === 1 && r.j.p.fb.pages[0].id === '10' && r.j.p.fb.sel === '10' && r.j.p.ig.name === '@dcap', '페이스북: 글쓰기 가능한 페이지만 · 선택됨');
env.FB_CONFIG_ID = 'CFG1';
const fbc = await J(await call('POST', '/sns/connect/fb', { body: { back: ORIGIN + '/asset-speed/' } }));
ok(new URL(fbc.j.url).searchParams.get('config_id') === 'CFG1' && !new URL(fbc.j.url).searchParams.get('scope'), 'FB_CONFIG_ID 가 있으면 config_id 로');
delete env.FB_CONFIG_ID;
r = await J(await call('POST', '/sns/connect/yt', { body: { back: 'https://evil.example/x' } }));
ok(r.s === 400, '돌아갈 주소는 사이트만');

/* 3. 영상 조각 → 공개 주소 */
const size = PART + 1234567, vid = new Uint8Array(size);
for (let i = 0; i < size; i++) vid[i] = (i * 31 + (i >> 9)) & 255;
const id = 'a'.repeat(64);
r = await J(await call('POST', '/sns/job', { body: { id, size, dur: 18.1, w: 1080, h: 1920, audio: 'aac' } }));
ok(r.s === 200 && r.j.parts === 2 && r.j.have === '00' && r.j.url === W + '/sns/m/' + id + '.mp4', '작업: 조각 2개 · 공개 주소');
r = await J(await call('POST', '/sns/job', { body: { id: 'b'.repeat(64), size: 5e6, dur: 18, w: 1920, h: 1080 } }));
ok(r.s === 400, '가로 영상은 거절');
r = await J(await call('POST', '/sns/part/' + id + '/0', { raw: vid.slice(0, PART - 1) }));
ok(r.s === 400, '조각 크기가 다르면 거절');
r = await J(await call('POST', '/sns/pub', { body: { job: id, p: 'ig', text: 'x' } }));
ok(r.s === 409, '조각을 다 올리기 전에는 게시 안 됨');
r = await J(await call('POST', '/sns/part/' + id + '/0', { raw: vid.slice(0, PART) }));
ok(r.s === 200 && r.j.have === '10' && KVM.get('m:' + id + ':0').ttl === 86400, '조각 0 → KV (하루 뒤 삭제)');
r = await J(await call('POST', '/sns/part/' + id + '/1', { raw: vid.slice(PART) }));
ok(r.s === 200 && r.j.have === '11', '조각 1');
async function getBytes(h) { const res = await call('GET', '/sns/m/' + id + '.mp4', { origin: null, auth: null, headers: h || {} }); return { res, u: await readAll(res.body) }; }
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let g = await getBytes();
ok(g.res.status === 200 && same(g.u, vid) && g.res.headers.get('Content-Type') === 'video/mp4', '공개 주소 = 올린 영상 그대로 (' + g.u.length + '바이트)');
g = await getBytes({ Range: 'bytes=' + (PART - 100) + '-' + (PART + 99) });
ok(g.res.status === 206 && same(g.u, vid.slice(PART - 100, PART + 100)) && g.res.headers.get('Content-Range') === `bytes ${PART - 100}-${PART + 99}/${size}`, 'Range: 조각 경계를 넘는 200바이트');
g = await getBytes({ Range: 'bytes=-500' });
ok(g.res.status === 206 && same(g.u, vid.slice(size - 500)), 'Range: 끝 500바이트');
g = await getBytes({ Range: 'bytes=0-' });
ok(g.res.status === 200 && same(g.u, vid), 'Range: 0- 는 전체');
const h416 = await call('GET', '/sns/m/' + id + '.mp4', { origin: null, auth: null, headers: { Range: 'bytes=' + (size + 5) + '-' } });
ok(h416.status === 416, '범위 밖 416');
const hd = await call('HEAD', '/sns/m/' + id + '.mp4', { origin: null, auth: null });
ok(hd.status === 200 && hd.headers.get('Content-Length') === String(size), 'HEAD');
ok((await call('GET', '/sns/m/' + 'c'.repeat(64) + '.mp4', { origin: null, auth: null })).status === 404, '없는 영상 404');

/* 4. 게시 */
const step = async (p) => J(await call('POST', '/sns/step', { body: { job: id, p } }));
const pub = async (p, extra) => J(await call('POST', '/sns/pub', { body: { job: id, p, text: '본문 #재테크', title: '코스피 vs S&P 500 #shorts', tags: ['재테크', '<S&P500>'], ...(extra || {}) } }));
/* 유튜브 */
let ytPuts = [];
H['POST www.googleapis.com/upload/youtube/v3/videos'] = (u, o, b) => new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=U1' } });
H['PUT www.googleapis.com/upload/youtube/v3/videos'] = (u, o, b) => { ytPuts.push({ range: o.headers['Content-Range'], len: b.length, b }); return ytPuts.length === 1 ? new Response('', { status: 308, headers: { Range: 'bytes=0-' + (PART - 1) } }) : jr({ id: 'VID123', snippet: {} }); };
await DB.prepare(Q.tokPut).bind('yt', await _test.seal(env, { rt: 'RT1', at: 'OLD', ax: 1, ch: 'UC1' }), '디코딩 자본주의', null, 1).run();   /* 접속 토큰 만료 → 갱신해야 함 */
calls.length = 0;
r = await pub('yt');
const init = calls.find((x) => x.key.startsWith('POST www.googleapis.com/upload'));
const meta = init && JSON.parse(new TextDecoder().decode(init.body));
ok(r.j.st === 'up' && calls.some((x) => x.key === 'POST oauth2.googleapis.com/token') && init.opt.headers.Authorization === 'Bearer AT2', '유튜브: 만료된 접속 토큰 갱신 뒤 시작');
ok(init.opt.headers['X-Upload-Content-Length'] === String(size) && meta.snippet.title === '코스피 vs S&P 500 #shorts' && meta.status.privacyStatus === 'public' && meta.snippet.tags.join() === '재테크,S&P500', '유튜브: 크기·제목·공개·태그(<>#) 정리');
r = await step('yt');
ok(r.j.st === 'up' && r.j.pct === Math.round(PART / size * 100) && ytPuts[0].range === `bytes 0-${PART - 1}/${size}` && same(ytPuts[0].b, vid.slice(0, PART)), '유튜브 조각 0 (Content-Range · 바이트 그대로) → 308');
r = await step('yt');
ok(r.j.st === 'done' && r.j.url === 'https://www.youtube.com/shorts/VID123' && ytPuts[1].range === `bytes ${PART}-${size - 1}/${size}` && same(ytPuts[1].b, vid.slice(PART)), '유튜브 마지막 조각 → 쇼츠 주소');
calls.length = 0;
r = await pub('yt');
ok(r.j.st === 'done' && r.j.dup && calls.length === 0, '같은 영상은 유튜브에 다시 올리지 않음');
/* 인스타 */
let igStatus = 'IN_PROGRESS';
H['POST graph.instagram.com/v26.0/1784/media_publish'] = (u, o, b) => { const f = new URLSearchParams(new TextDecoder().decode(b)); return jr(f.get('creation_id') === 'C1' ? { id: 'M1' } : { error: { message: 'bad' } }); };
H['POST graph.instagram.com/v26.0/1784/media'] = (u, o, b) => { const f = new URLSearchParams(new TextDecoder().decode(b)); return jr(f.get('media_type') === 'REELS' && f.get('video_url') === W + '/sns/m/' + id + '.mp4' && f.get('access_token') === 'IGL' && f.get('caption') === '본문 #재테크' && f.get('share_to_feed') === 'true' ? { id: 'C1' } : { error: { message: 'bad params ' + [...f].join('&') } }); };
H['GET graph.instagram.com/v26.0/C1'] = () => jr({ status_code: igStatus, id: 'C1' });
H['GET graph.instagram.com/v26.0/M1'] = () => jr({ permalink: 'https://www.instagram.com/reel/abc/' });
r = await pub('ig');
ok(r.j.st === 'wait', '인스타: 릴스 컨테이너 (REELS · 공개 주소 · 캡션 · 피드 공유)');
r = await J(await call('POST', '/sns/pub', { body: { job: id, p: 'ig', text: 'x' } }));
ok(r.j.busy && r.j.st === 'wait', '진행 중이면 다시 시작하지 않음');
r = await step('ig');
ok(r.j.st === 'wait', '처리 중 → 기다림');
igStatus = 'FINISHED';
r = await step('ig');
ok(r.j.st === 'done' && r.j.url === 'https://www.instagram.com/reel/abc/', '인스타: FINISHED → 게시 → permalink');
/* 스레드 */
let thStatus = 'ERROR';
H['POST graph.threads.com/v1.0/333/threads_publish'] = () => jr({ id: 'T9' });
H['POST graph.threads.com/v1.0/333/threads'] = (u, o, b) => { const f = new URLSearchParams(new TextDecoder().decode(b)); return jr(f.get('media_type') === 'VIDEO' && f.get('video_url') === W + '/sns/m/' + id + '.mp4' && f.get('text').length <= 500 ? { id: 'TC1' } : { error: { message: 'bad' } }); };
H['GET graph.threads.com/v1.0/TC1'] = () => jr(thStatus === 'ERROR' ? { status: 'ERROR', error_message: 'FAILED_DOWNLOADING_VIDEO' } : { status: thStatus });
H['GET graph.threads.com/v1.0/T9'] = () => jr({ permalink: 'https://www.threads.com/@dcap/post/xyz' });
r = await pub('th', { text: 'ㄱ'.repeat(800) });
ok(r.j.st === 'wait', '스레드: VIDEO 컨테이너 (글 500자로 자름)');
r = await step('th');
ok(r.j.st === 'err' && /FAILED_DOWNLOADING_VIDEO/.test(r.j.err), '스레드: ERROR → 실패와 이유');
thStatus = 'FINISHED';
r = await pub('th');
ok(r.j.st === 'wait', '실패 뒤 다시 시도하면 새로 시작');
r = await step('th');
ok(r.j.st === 'done' && r.j.url === 'https://www.threads.com/@dcap/post/xyz', '스레드: FINISHED → 게시 → permalink');
/* 페이스북 */
let fbS = { video_status: 'uploading', uploading_phase: { status: 'in_progress' } }, finished = null;
H['POST graph.facebook.com/v26.0/10/video_reels'] = (u, o, b) => {
  if (u.searchParams.get('upload_phase') === 'finish') { finished = Object.fromEntries(u.searchParams); return jr({ success: true }); }
  const j = JSON.parse(new TextDecoder().decode(b)); return jr(j.upload_phase === 'start' && j.access_token === 'P10' ? { video_id: 'FV1', upload_url: 'https://rupload.facebook.com/video-upload/FV1' } : { error: { message: 'bad' } }); };
let rup = null;
H['POST rupload.facebook.com/video-upload/v26.0/FV1'] = (u, o) => { rup = o.headers; return jr({ success: true }); };
H['GET graph.facebook.com/v26.0/FV1'] = () => jr({ status: fbS, id: 'FV1' });
r = await pub('fb');
ok(r.j.st === 'wait' && rup && rup.Authorization === 'OAuth P10' && rup.file_url === W + '/sns/m/' + id + '.mp4', '페이스북: 릴스 시작 → rupload(file_url · OAuth 페이지 토큰)');
r = await step('fb');
ok(r.j.st === 'wait' && !finished, '업로드 중에는 finish 하지 않음');
fbS = { video_status: 'upload_complete', uploading_phase: { status: 'complete' }, processing_phase: { status: 'not_started' }, publishing_phase: { status: 'not_started' } };
r = await step('fb');
ok(r.j.st === 'wait' && finished && finished.video_state === 'PUBLISHED' && finished.video_id === 'FV1' && finished.description === '본문 #재테크', '업로드 끝 → finish(PUBLISHED · 설명)');
fbS = { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete', publish_status: 'published' } };
r = await step('fb');
ok(r.j.st === 'done' && r.j.url === 'https://www.facebook.com/reel/FV1', '페이스북: published → 릴스 주소');
r = await J(await call('GET', '/sns/posts?job=' + id));
ok(r.j.posts.length === 4 && r.j.posts.every((x) => x.st === 'done'), '4곳 모두 done 기록');
/* 90초 넘는 영상 · 20분 초과 */
const id2 = 'd'.repeat(64), small = vid.slice(0, 200000);
await call('POST', '/sns/job', { body: { id: id2, size: small.length, dur: 95, w: 1080, h: 1920 } });
await call('POST', '/sns/part/' + id2 + '/0', { raw: small });
r = await J(await call('POST', '/sns/pub', { body: { job: id2, p: 'fb', text: 'x' } }));
ok(r.j.st === 'err' && /90초/.test(r.j.err), '90초 넘는 영상은 페이스북 거절');
igStatus = 'IN_PROGRESS';
H['POST graph.instagram.com/v26.0/1784/media'] = () => jr({ id: 'C1' });
r = await J(await call('POST', '/sns/pub', { body: { job: id2, p: 'ig', text: 'x' } }));
const prow = await DB.prepare(Q.postGet).bind(id2, 'ig').first(), pd = JSON.parse(prow.data); pd.t0 -= 21 * 60;
await DB.prepare(Q.postPut).bind(id2, 'ig', 'wait', JSON.stringify(pd), null, null, prow.upd).run();
r = await J(await call('POST', '/sns/step', { body: { job: id2, p: 'ig' } }));
ok(r.j.st === 'err' && /20분/.test(r.j.err), '20분 넘게 처리 중이면 실패');
/* 인스타 60일 토큰 갱신 (20일 안 남음 · 하루 지남) */
const igRow = await DB.prepare(Q.tokGet).bind('ig').first(), igD = await _test.unseal(env, igRow.enc); igD.got -= 2 * 86400;
await DB.prepare(Q.tokPut).bind('ig', await _test.seal(env, igD), igRow.name, Math.floor(Date.now() / 1000) + 10 * 86400, igRow.upd).run();
let refreshed = false;
H['GET graph.instagram.com/refresh_access_token'] = (u) => { refreshed = u.searchParams.get('grant_type') === 'ig_refresh_token' && u.searchParams.get('access_token') === 'IGL'; return jr({ access_token: 'IGL2', expires_in: 5183944 }); };
r = await J(await call('GET', '/sns/status'));
const igRow2 = await DB.prepare(Q.tokGet).bind('ig').first();
ok(refreshed && igRow2.exp > Date.now() / 1000 + 50 * 86400 && (await _test.unseal(env, igRow2.enc)).tok === 'IGL2', '인스타 60일 토큰 갱신');

/* 5. Meta 연결 끊기·삭제 콜백 (서명 확인) */
const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1' })).toString('base64url');
const sig = await _test.hmac('thsecret', payload);
const fd = new URLSearchParams({ signed_request: sig + '.' + payload });
let dr = await sns(new Request(W + '/sns/meta/delete', { method: 'POST', body: fd }), env, new URL(W + '/sns/meta/delete'), (o, s = 200) => new Response(JSON.stringify(o), { status: s }), { ok: false, headers: {} }, adminUser);
let dj = await dr.json();
ok(dr.status === 200 && dj.confirmation_code && dj.url.startsWith(W + '/sns/meta/deleted') && !(await DB.prepare(Q.tokGet).bind('th').first()), '삭제 요청(스레드 비밀값 서명) → 스레드 토큰 삭제 · 확인 코드');
const fd2 = new URLSearchParams({ signed_request: 'x' + sig.slice(1) + '.' + payload });
dr = await sns(new Request(W + '/sns/meta/deauth', { method: 'POST', body: fd2 }), env, new URL(W + '/sns/meta/deauth'), (o, s = 200) => new Response(JSON.stringify(o), { status: s }), { ok: false, headers: {} }, adminUser);
ok(dr.status === 400, '서명이 틀리면 거절');
r = await J(await call('POST', '/sns/disconnect/fb'));
r = await J(await call('GET', '/sns/status'));
ok(!r.j.p.fb.conn && r.j.p.yt.conn, '연결 끊기');
/* KV 없음 */
const kv = env.SNS_KV; delete env.SNS_KV;
r = await J(await call('POST', '/sns/job', { body: { id: 'e'.repeat(64), size: 5e6, dur: 18, w: 1080, h: 1920 } }));
ok(r.s === 503, 'KV 가 없으면 503 안내');
env.SNS_KV = kv;

console.log(`worker_sns_test: ${pass}개 통과 · ${fail}개 실패 (D1: ${mode})`);
process.exit(fail ? 1 : 0);
