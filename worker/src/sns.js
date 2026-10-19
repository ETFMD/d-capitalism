/* ── SNS 자동 게시 (관리자 전용) — 자산 속도 영상(9:16 MP4)을 유튜브 쇼츠 · 인스타그램 릴스 · 스레드 · 페이스북 페이지 릴스에 한 번에 ──
 * 연결: 각 SNS 의 공식 로그인 창(OAuth) → 받은 게시 권한(토큰)만 D1 sns_tok 에 AES-GCM 암호화(SNS_KEY)해 둠 — 비밀번호는 다루지 않음
 *   · 유튜브: Google OAuth(youtube.upload · youtube.readonly) · 갱신 토큰으로 접속 토큰을 그때그때 받음
 *   · 인스타그램: Instagram API with Instagram Login(프로 계정) · 60일 토큰 — 20일 안 남으면 갱신(하루 지난 토큰만)
 *   · 스레드: Threads API · 60일 토큰(같은 방식) · 페이스북: Facebook Login → 페이지 토큰(만료 없음) · 페이지 릴스만 가능(개인 프로필 불가)
 * 영상: 브라우저가 24 MiB 조각으로 올림 → KV(SNS_KV · 하루 뒤 자동 삭제) → 공개 주소 /sns/m/<id>.mp4
 *   · 인스타그램·스레드·페이스북은 이 주소에서 영상을 가져감 · 유튜브는 Worker 가 같은 조각을 이어 올리기(resumable)로 보냄
 * 게시: 브라우저가 단계마다 부름 (POST /sns/pub → POST /sns/step 반복) — 한 번 부를 때 일은 조금씩 (무료 요금제 CPU 10ms · 하위 요청 50개 안)
 *   · 같은 영상(job = 영상 SHA-256)·같은 SNS 는 한 번만: sns_post 가 'done' 이면 다시 올리지 않음 · 진행 중이면 다시 시작하지 않음
 * 비밀값(Worker secret): SNS_KEY(자동 생성) · YT_CLIENT_ID/YT_CLIENT_SECRET(없으면 GOOGLE_CLIENT_ID/SECRET) · IG_APP_ID/IG_APP_SECRET
 *   · TH_APP_ID/TH_APP_SECRET · FB_APP_ID/FB_APP_SECRET · FB_CONFIG_ID(선택 — '비즈니스용 Facebook 로그인' 구성 ID)
 * 공식 문서(2026-10 확인): Instagram content-publishing · business-login · Threads posts/long-lived-tokens/troubleshooting
 *   · Facebook reels-publishing(video_reels · rupload file_url) · manual-flow · long-lived tokens · YouTube videos.insert(resumable)
 */
const GV = 'v26.0', TV = 'v1.0';
export const PART = 24 * 1024 * 1024;          // 24 MiB — 유튜브 조각 규칙(256 KiB 배수) · KV 값 최대 25 MiB 안
const MAX_SIZE = 300 * 1024 * 1024;            // 인스타그램 릴스 최대 300 MB
const KV_TTL = 86400, JOB_TTL = 20 * 3600;      // KV 조각은 하루 뒤 자동 삭제 · 작업은 20시간까지만 씀(그 뒤엔 다시 올림)
const WAIT_MAX = 20 * 60;                       // 처리 기다리기 최대 20분
const PS = ['yt', 'ig', 'th', 'fb'];
const NAME = { yt: '유튜브', ig: '인스타그램', th: '스레드', fb: '페이스북' };
const enc = new TextEncoder();

export const SQL = {
  init: [
    'CREATE TABLE IF NOT EXISTS sns_tok (p TEXT PRIMARY KEY, enc TEXT NOT NULL, name TEXT, exp INTEGER, upd INTEGER)',
    'CREATE TABLE IF NOT EXISTS sns_state (s TEXT PRIMARY KEY, p TEXT NOT NULL, back TEXT, exp INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sns_job (id TEXT PRIMARY KEY, size INTEGER NOT NULL, parts INTEGER NOT NULL, have TEXT NOT NULL, dur REAL, w INTEGER, h INTEGER, audio TEXT, created INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS sns_post (job TEXT NOT NULL, p TEXT NOT NULL, st TEXT NOT NULL, data TEXT, url TEXT, err TEXT, upd INTEGER, PRIMARY KEY (job, p))',
  ],
  tokGet: 'SELECT enc, name, exp, upd FROM sns_tok WHERE p = ?',
  tokAll: 'SELECT p, name, exp, upd FROM sns_tok',
  tokPut: 'INSERT INTO sns_tok (p, enc, name, exp, upd) VALUES (?, ?, ?, ?, ?) ON CONFLICT(p) DO UPDATE SET enc = excluded.enc, name = excluded.name, exp = excluded.exp, upd = excluded.upd',
  tokDel: 'DELETE FROM sns_tok WHERE p = ?',
  stPut: 'INSERT INTO sns_state (s, p, back, exp) VALUES (?, ?, ?, ?)',
  stGet: 'SELECT p, back, exp FROM sns_state WHERE s = ?',
  stDel: 'DELETE FROM sns_state WHERE s = ?',
  stOld: 'DELETE FROM sns_state WHERE exp < ?',
  jobGet: 'SELECT id, size, parts, have, dur, w, h, audio, created FROM sns_job WHERE id = ?',
  jobPut: 'INSERT INTO sns_job (id, size, parts, have, dur, w, h, audio, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  jobDel: 'DELETE FROM sns_job WHERE id = ?',
  jobHave: 'UPDATE sns_job SET have = ? WHERE id = ?',
  jobOld: 'DELETE FROM sns_job WHERE created < ?',
  postGet: 'SELECT job, p, st, data, url, err, upd FROM sns_post WHERE job = ? AND p = ?',
  postAll: 'SELECT p, st, url, err, upd FROM sns_post WHERE job = ?',
  postPut: 'INSERT INTO sns_post (job, p, st, data, url, err, upd) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job, p) DO UPDATE SET st = excluded.st, data = excluded.data, url = excluded.url, err = excluded.err, upd = excluded.upd',
  postOld: 'DELETE FROM sns_post WHERE upd < ?',
};

let ready = false;
async function init(env) {
  if (ready) return;
  for (const s of SQL.init) await env.DB.prepare(s).run();
  ready = true;
}
const now = () => Math.floor(Date.now() / 1000);
const qs = (o) => new URLSearchParams(o).toString();
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function unb64(s) { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; }
function b64u(u8) { return b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); }
function rnd(n) { return b64u(crypto.getRandomValues(new Uint8Array(n))); }
class Err extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

/* ── 토큰 암호화 (AES-GCM · 열쇠 = SHA-256('sns:' + SNS_KEY)) ── */
async function aes(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('sns:' + env.SNS_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(env), enc.encode(JSON.stringify(obj))));
  return b64(iv) + '.' + b64(ct);
}
async function unseal(env, s) {
  const [iv, ct] = String(s).split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aes(env), unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ── 외부 API 부르기: 실패하면 그 SNS 의 오류 문구를 그대로 ── */
async function call(url, opt) {
  const r = await fetch(url, opt || {});
  const t = await r.text();
  let j = null;
  try { j = t ? JSON.parse(t) : {}; } catch (e) { j = null; }
  if (!r.ok || (j && j.error)) {
    const e = j && j.error;
    const m = e ? (typeof e === 'string' ? (j.error_description || j.error_message || e) : (e.error_user_msg || e.message || JSON.stringify(e))) : (j && (j.error_message || j.message)) || t.slice(0, 200);
    const x = new Err(String(m || ('HTTP ' + r.status)).slice(0, 300), 502); x.http = r.status; x.code = e && (e.code || e); throw x;
  }
  return j || {};
}
const form = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs(body) });

function cfg(env, p) {
  if (p === 'yt') return { id: env.YT_CLIENT_ID || env.GOOGLE_CLIENT_ID, secret: env.YT_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET };
  if (p === 'ig') return { id: env.IG_APP_ID, secret: env.IG_APP_SECRET };
  if (p === 'th') return { id: env.TH_APP_ID, secret: env.TH_APP_SECRET };
  if (p === 'fb') return { id: env.FB_APP_ID, secret: env.FB_APP_SECRET, config: env.FB_CONFIG_ID };
  return {};
}
const configured = (env, p) => { const c = cfg(env, p); return !!(c.id && c.secret && env.SNS_KEY); };

/* ── 연결 (OAuth) ── */
function authUrl(env, p, ru, state) {
  const c = cfg(env, p);
  if (p === 'yt') return 'https://accounts.google.com/o/oauth2/v2/auth?' + qs({ client_id: c.id, redirect_uri: ru, response_type: 'code', access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', state });
  if (p === 'ig') return 'https://www.instagram.com/oauth/authorize?' + qs({ client_id: c.id, redirect_uri: ru, response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish', state });
  if (p === 'th') return 'https://threads.com/oauth/authorize?' + qs({ client_id: c.id, redirect_uri: ru, scope: 'threads_basic,threads_content_publish', response_type: 'code', state });
  return `https://www.facebook.com/${GV}/dialog/oauth?` + qs({ client_id: c.id, redirect_uri: ru, state, response_type: 'code',
    ...(c.config ? { config_id: c.config } : { scope: 'pages_show_list,pages_read_engagement,pages_manage_posts' }) });
}
async function exchange(env, p, code, ru) {   /* code → {data(암호화해 둘 것), name(보여 줄 계정 이름), exp(만료 · 없으면 null)} */
  const c = cfg(env, p), t0 = now();
  if (p === 'yt') {
    const t = await form('https://oauth2.googleapis.com/token', { code, client_id: c.id, client_secret: c.secret, redirect_uri: ru, grant_type: 'authorization_code' });
    if (!t.refresh_token) throw new Err('구글이 갱신 토큰을 주지 않았습니다 — 구글 계정 > 보안 > 서드파티 연결에서 이 앱을 지운 뒤 다시 연결해 주세요');
    const ch = await call('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + t.access_token } });
    const c0 = (ch.items || [])[0];
    if (!c0) throw new Err('이 구글 계정에는 유튜브 채널이 없습니다 — 채널이 있는 계정으로 연결해 주세요');
    return { data: { rt: t.refresh_token, at: t.access_token, ax: t0 + (Number(t.expires_in) || 3600), ch: c0.id }, name: (c0.snippet && c0.snippet.title) || c0.id, exp: null };
  }
  if (p === 'ig') {
    let t = await form('https://api.instagram.com/oauth/access_token', { client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', redirect_uri: ru, code });
    if (t.data && t.data[0]) t = t.data[0];
    const ll = await call('https://graph.instagram.com/access_token?' + qs({ grant_type: 'ig_exchange_token', client_secret: c.secret, access_token: t.access_token }));
    const me = await call(`https://graph.instagram.com/${GV}/me?` + qs({ fields: 'user_id,username', access_token: ll.access_token }));
    return { data: { tok: ll.access_token, uid: String(me.user_id || t.user_id), got: t0 }, name: '@' + (me.username || ''), exp: t0 + (Number(ll.expires_in) || 5184000) };
  }
  if (p === 'th') {
    const t = await form('https://graph.threads.com/oauth/access_token', { client_id: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: ru });
    const ll = await call('https://graph.threads.com/access_token?' + qs({ grant_type: 'th_exchange_token', client_secret: c.secret, access_token: t.access_token }));
    const me = await call(`https://graph.threads.com/${TV}/me?` + qs({ fields: 'id,username', access_token: ll.access_token }));
    return { data: { tok: ll.access_token, uid: String(me.id || t.user_id), got: t0 }, name: '@' + (me.username || ''), exp: t0 + (Number(ll.expires_in) || 5184000) };
  }
  const t = await call(`https://graph.facebook.com/${GV}/oauth/access_token?` + qs({ client_id: c.id, redirect_uri: ru, client_secret: c.secret, code }));
  const ll = await call(`https://graph.facebook.com/${GV}/oauth/access_token?` + qs({ grant_type: 'fb_exchange_token', client_id: c.id, client_secret: c.secret, fb_exchange_token: t.access_token }));
  const pg = await call(`https://graph.facebook.com/${GV}/me/accounts?` + qs({ fields: 'id,name,access_token,tasks', limit: '100', access_token: ll.access_token }));
  const pages = (pg.data || []).filter((x) => x.access_token && (!x.tasks || x.tasks.includes('CREATE_CONTENT'))).map((x) => ({ id: String(x.id), name: x.name || String(x.id), tok: x.access_token }));
  if (!pages.length) throw new Err('글을 올릴 수 있는 페이스북 페이지가 없습니다 — 페이지를 만든 뒤, 연결할 때 그 페이지를 꼭 선택해 주세요');
  return { data: { pages, sel: pages[0].id }, name: pages[0].name, exp: null };
}
async function saveTok(env, p, x) { await env.DB.prepare(SQL.tokPut).bind(p, await seal(env, x.data), x.name || null, x.exp || null, now()).run(); }
/* 저장된 토큰 꺼내기 (필요하면 갱신) → 그 SNS 의 data */
async function tok(env, p) {
  const r = await env.DB.prepare(SQL.tokGet).bind(p).first();
  if (!r) throw new Err(NAME[p] + ' 연결이 없습니다 — 먼저 연결해 주세요', 409);
  let d;
  try { d = await unseal(env, r.enc); } catch (e) { throw new Err(NAME[p] + ' 연결 정보를 풀 수 없습니다(SNS_KEY 바뀜) — 다시 연결해 주세요', 409); }
  const c = cfg(env, p), t = now();
  if (p === 'yt' && (!d.at || d.ax < t + 120)) {
    let x;
    try { x = await form('https://oauth2.googleapis.com/token', { client_id: c.id, client_secret: c.secret, refresh_token: d.rt, grant_type: 'refresh_token' }); }
    catch (e) { throw new Err('유튜브 연결이 끊겼습니다(' + e.message + ') — 다시 연결해 주세요', 409); }
    d.at = x.access_token; d.ax = t + (Number(x.expires_in) || 3600); if (x.refresh_token) d.rt = x.refresh_token;
    await env.DB.prepare(SQL.tokPut).bind(p, await seal(env, d), r.name, r.exp, t).run();
  }
  if (p === 'ig' || p === 'th') {
    if (r.exp && r.exp < t) throw new Err(NAME[p] + ' 연결이 만료됐습니다(60일 동안 쓰지 않음) — 다시 연결해 주세요', 409);
    if (r.exp && r.exp - t < 20 * 86400 && t - (d.got || 0) > 86400) {   /* 60일 토큰: 20일 안 남았고 하루 지났으면 갱신 */
      const u = p === 'ig' ? 'https://graph.instagram.com/refresh_access_token?' + qs({ grant_type: 'ig_refresh_token', access_token: d.tok })
        : 'https://graph.threads.com/refresh_access_token?' + qs({ grant_type: 'th_refresh_token', access_token: d.tok });
      try {
        const x = await call(u);
        d.tok = x.access_token || d.tok; d.got = t;
        await env.DB.prepare(SQL.tokPut).bind(p, await seal(env, d), r.name, t + (Number(x.expires_in) || 5184000), t).run();
      } catch (e) { /* 갱신 실패해도 아직 유효하면 그대로 씀 */ }
    }
  }
  return d;
}

/* ── 영상 공개 주소 (/sns/m/<id>.mp4 · KV 조각을 이어서 · Range 지원) ── */
function slice(from, to) {   /* 조각 안 [from, to] 바이트만 통과 */
  let pos = 0;
  return new TransformStream({ transform(ch, c) { const s = pos, e = pos + ch.byteLength; pos = e; const a = Math.max(from, s), b = Math.min(to + 1, e); if (a < b) c.enqueue(ch.subarray(a - s, b - s)); } });
}
async function media(env, req, id) {
  const j = await env.DB.prepare(SQL.jobGet).bind(id).first();
  if (!j || j.have.indexOf('0') >= 0 || j.created < now() - JOB_TTL || !env.SNS_KV) return new Response('not found', { status: 404 });
  const size = j.size;
  let a = 0, b = size - 1, part = false;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  if (rg && (rg[1] || rg[2])) {
    if (rg[1]) { a = Number(rg[1]); b = rg[2] ? Math.min(Number(rg[2]), size - 1) : size - 1; } else { a = Math.max(0, size - Number(rg[2])); }
    if (a > b || a >= size) return new Response('range', { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    part = !(a === 0 && b === size - 1);
  }
  const len = b - a + 1;
  const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (part) h['Content-Range'] = `bytes ${a}-${b}/${size}`;
  if (req.method === 'HEAD') return new Response(null, { status: part ? 206 : 200, headers: { ...h, 'Content-Length': String(len) } });
  const { readable, writable } = new FixedLengthStream(len);
  (async () => {
    for (let k = Math.floor(a / PART); k <= Math.floor(b / PART); k++) {
      const ps = k * PART, pe = Math.min(size, ps + PART) - 1;
      const s = await env.SNS_KV.get('m:' + id + ':' + k, { type: 'stream' });
      if (!s) throw new Error('part');
      const from = Math.max(a, ps) - ps, to = Math.min(b, pe) - ps;
      await (from === 0 && to === pe - ps ? s : s.pipeThrough(slice(from, to))).pipeTo(writable, { preventClose: true });
    }
    await writable.close();
  })().catch((e) => writable.abort(e).catch(() => 0));
  return new Response(readable, { status: part ? 206 : 200, headers: h });
}
async function kvStream(env, id, k, len) {   /* KV 조각 → 길이가 정해진 흐름 (Content-Length 가 붙게) */
  const s = await env.SNS_KV.get('m:' + id + ':' + k, { type: 'stream' });
  if (!s) throw new Err('보관한 영상 조각이 없습니다(하루 지나 지워짐) — 영상을 다시 올려 주세요', 410);
  const { readable, writable } = new FixedLengthStream(len);
  s.pipeTo(writable).catch(() => 0);
  return readable;
}
const partLen = (j, k) => (k < j.parts - 1 ? PART : j.size - PART * (j.parts - 1));

/* ── 게시: 시작(pub) · 한 단계 진행(step) ── */
function vurl(origin, id) { return origin + '/sns/m/' + id + '.mp4'; }
async function savePost(env, job, p, st, data, url, err) {
  await env.DB.prepare(SQL.postPut).bind(job, p, st, data ? JSON.stringify(data) : null, url || null, err || null, now()).run();
  return { p, st, url: url || null, err: err || null };
}
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) : s; }
async function pubStart(env, j, p, b, origin) {
  const d = await tok(env, p), mu = vurl(origin, j.id);
  if (p === 'yt') {
    const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).replace(/[<>#]/g, '').trim()).filter(Boolean).slice(0, 15);
    const meta = { snippet: { title: clip(b.title || '자산 속도 #shorts', 100), description: clip(b.text, 4900), tags, categoryId: '27', defaultLanguage: 'ko' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } };
    const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
      headers: { Authorization: 'Bearer ' + d.at, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(j.size), 'X-Upload-Content-Type': 'video/mp4' },
      body: JSON.stringify(meta) });
    const loc = r.headers.get('Location');
    if (!r.ok || !loc) { const t = await r.text(); let m = t.slice(0, 300); try { const x = JSON.parse(t); m = (x.error && (x.error.message || x.error)) || m; } catch (e) {} throw new Err('유튜브 업로드 시작 실패: ' + m, 502); }
    return { st: 'up', data: { uri: loc, k: 0, t0: now() } };
  }
  if (p === 'ig') {
    const x = await form(`https://graph.instagram.com/${GV}/${d.uid}/media`, { media_type: 'REELS', video_url: mu, caption: clip(b.text, 2200), share_to_feed: 'true', access_token: d.tok });
    return { st: 'wait', data: { c: x.id, t0: now() } };
  }
  if (p === 'th') {
    const x = await form(`https://graph.threads.com/${TV}/${d.uid}/threads`, { media_type: 'VIDEO', video_url: mu, text: clip(b.text, 500), access_token: d.tok });
    return { st: 'wait', data: { c: x.id, t0: now() } };
  }
  /* fb: 페이지 릴스 — 시작 → rupload(file_url = 공개 주소) → 업로드 끝나면 finish(게시) */
  if (j.dur && j.dur > 90) throw new Err('페이스북 릴스는 90초까지만 올릴 수 있습니다 (이 영상 ' + Math.round(j.dur) + '초)');
  const pg = (d.pages || []).find((x) => x.id === d.sel) || (d.pages || [])[0];
  if (!pg) throw new Err('페이스북 페이지가 없습니다 — 다시 연결해 주세요', 409);
  const s = await call(`https://graph.facebook.com/${GV}/${pg.id}/video_reels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_phase: 'start', access_token: pg.tok }) });
  if (!s.video_id) throw new Err('페이스북 릴스 시작 실패', 502);
  await call(`https://rupload.facebook.com/video-upload/${GV}/${s.video_id}`, { method: 'POST', headers: { Authorization: 'OAuth ' + pg.tok, file_url: mu } });
  return { st: 'wait', data: { v: String(s.video_id), page: pg.id, ph: 'up', desc: clip(b.text, 2200), t0: now() } };
}
async function pubStep(env, j, row) {   /* → {st, data, url, err, pct} */
  const p = row.p, data = row.data ? JSON.parse(row.data) : {}, t = now();
  if (p !== 'yt' && t - (data.t0 || t) > WAIT_MAX) return { st: 'err', data, err: NAME[p] + ' 처리 시간이 20분을 넘었습니다 — 그 SNS 앱에서 올라갔는지 확인한 뒤 다시 시도해 주세요' };
  const d = await tok(env, p);
  if (p === 'yt') {
    const k = data.k || 0, a = k * PART, len = partLen(j, k);
    const r = await fetch(data.uri, { method: 'PUT', redirect: 'manual', headers: { 'Content-Range': `bytes ${a}-${a + len - 1}/${j.size}`, 'Content-Type': 'video/mp4' }, body: await kvStream(env, j.id, k, len) });
    if (r.status === 308) { data.k = k + 1; return { st: 'up', data, pct: Math.round((a + len) / j.size * 100) }; }
    const tx = await r.text(); let x = {}; try { x = JSON.parse(tx); } catch (e) {}
    if ((r.status === 200 || r.status === 201) && x.id) return { st: 'done', data: { id: x.id }, url: 'https://www.youtube.com/shorts/' + x.id };
    if (r.status === 404 || r.status === 410) return { st: 'err', data, err: '유튜브 업로드 세션이 끝났습니다 — 다시 시도해 주세요' };
    return { st: 'err', data, err: '유튜브 업로드 실패: ' + ((x.error && x.error.message) || tx.slice(0, 200) || r.status) };
  }
  if (p === 'ig') {
    const s = await call(`https://graph.instagram.com/${GV}/${data.c}?` + qs({ fields: 'status_code,status', access_token: d.tok }));
    if (s.status_code === 'FINISHED') {
      const m = await form(`https://graph.instagram.com/${GV}/${d.uid}/media_publish`, { creation_id: data.c, access_token: d.tok });
      let url = 'https://www.instagram.com/';
      try { const q = await call(`https://graph.instagram.com/${GV}/${m.id}?` + qs({ fields: 'permalink', access_token: d.tok })); url = q.permalink || url; } catch (e) {}
      return { st: 'done', data: { id: m.id }, url };
    }
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') return { st: 'err', data, err: '인스타그램 처리 실패(' + s.status_code + (s.status ? ' · ' + s.status : '') + ')' };
    if (s.status_code === 'PUBLISHED') return { st: 'done', data, url: 'https://www.instagram.com/' };
    return { st: 'wait', data };
  }
  if (p === 'th') {
    const s = await call(`https://graph.threads.com/${TV}/${data.c}?` + qs({ fields: 'status,error_message', access_token: d.tok }));
    if (s.status === 'FINISHED') {
      const m = await form(`https://graph.threads.com/${TV}/${d.uid}/threads_publish`, { creation_id: data.c, access_token: d.tok });
      let url = 'https://www.threads.com/';
      try { const q = await call(`https://graph.threads.com/${TV}/${m.id}?` + qs({ fields: 'permalink', access_token: d.tok })); url = q.permalink || url; } catch (e) {}
      return { st: 'done', data: { id: m.id }, url };
    }
    if (s.status === 'ERROR' || s.status === 'EXPIRED') return { st: 'err', data, err: '스레드 처리 실패(' + s.status + (s.error_message ? ' · ' + s.error_message : '') + ')' };
    if (s.status === 'PUBLISHED') return { st: 'done', data, url: 'https://www.threads.com/' };
    return { st: 'wait', data };
  }
  /* fb */
  const pg = (d.pages || []).find((x) => x.id === data.page);
  if (!pg) return { st: 'err', data, err: '페이스북 페이지 연결이 바뀌었습니다 — 다시 시도해 주세요' };
  const s = await call(`https://graph.facebook.com/${GV}/${data.v}?` + qs({ fields: 'status', access_token: pg.tok }));
  const S = s.status || {}, up = S.uploading_phase || {}, pr = S.processing_phase || {}, pu = S.publishing_phase || {};
  const bad = [up, pr, pu].find((x) => x.status === 'error' || x.error);
  if (S.video_status === 'error' || S.video_status === 'upload_failed' || S.video_status === 'expired' || bad) {
    return { st: 'err', data, err: '페이스북 처리 실패(' + ((bad && bad.error && bad.error.message) || S.video_status) + ')' };
  }
  const okUp = /^complete/.test(up.status || '') || ['upload_complete', 'processing', 'ready'].includes(S.video_status);
  if (data.ph === 'up') {
    if (!okUp) return { st: 'wait', data };
    await call(`https://graph.facebook.com/${GV}/${pg.id}/video_reels?` + qs({ access_token: pg.tok, video_id: data.v, upload_phase: 'finish', video_state: 'PUBLISHED', description: data.desc || '' }), { method: 'POST' });
    data.ph = 'pub';
    return { st: 'wait', data };
  }
  if (pu.publish_status === 'published' || (S.video_status === 'ready' && /^complete/.test(pu.status || ''))) return { st: 'done', data: { id: data.v }, url: 'https://www.facebook.com/reel/' + data.v };
  return { st: 'wait', data };
}

/* ── Meta 연결 끊기·자료 삭제 요청 (signed_request · 앱 비밀값으로 서명 확인) ── */
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data))));
}
async function signed(env, sr) {
  const [sig, payload] = String(sr || '').split('.');
  if (!sig || !payload) return null;
  for (const p of ['ig', 'th', 'fb']) {
    const c = cfg(env, p);
    if (c.secret && (await hmac(c.secret, payload)) === sig) { try { return { p, d: JSON.parse(new TextDecoder().decode(unb64u(payload))) }; } catch (e) { return null; } }
  }
  return null;
}

/* ── 요청 처리 ── */
export async function sns(req, env, url, json, cors, adminUser) {
  const path = url.pathname, origin = url.origin, m = req.method;
  if (!env.DB) return json({ error: 'no db' }, 503);
  try {
    await init(env);
    /* 공개: 영상 주소 · OAuth 돌아오는 곳 · Meta 콜백 */
    let x = /^\/sns\/m\/([0-9a-f]{64})\.mp4$/.exec(path);
    if (x && (m === 'GET' || m === 'HEAD')) return await media(env, req, x[1]);
    x = /^\/sns\/cb\/(yt|ig|th|fb)$/.exec(path);
    if (x && m === 'GET') {
      const p = x[1], s = url.searchParams.get('state') || '', code = (url.searchParams.get('code') || '').replace(/#_$/, '');
      const st = s ? await env.DB.prepare(SQL.stGet).bind(s).first() : null;
      if (st) await env.DB.prepare(SQL.stDel).bind(s).run();
      const back = (st && st.back) || 'https://d-capitalism.com/asset-speed/';
      const go = (ok, msg) => new Response(null, { status: 302, headers: { Location: back.split('#')[0] + '#sns=' + p + ':' + (ok ? 'ok' : 'err') + (msg ? ':' + encodeURIComponent(String(msg).slice(0, 300)) : ''), 'Cache-Control': 'no-store' } });
      if (!st || st.p !== p || st.exp < now()) return go(false, '연결 시간이 지났거나 잘못된 요청입니다 — 다시 연결해 주세요');
      const e = url.searchParams.get('error_description') || url.searchParams.get('error_message') || url.searchParams.get('error_reason') || url.searchParams.get('error');
      if (e || !code) return go(false, e || '연결을 취소했습니다');
      if (!configured(env, p)) return go(false, '비밀값이 없습니다');
      try { await saveTok(env, p, await exchange(env, p, code, origin + '/sns/cb/' + p)); return go(true); } catch (er) { return go(false, er.message); }
    }
    if (path === '/sns/meta/deauth' || path === '/sns/meta/delete') {
      if (m !== 'POST') return json({ error: 'method' }, 405);
      const f = await req.formData().catch(() => null), v = await signed(env, f && f.get('signed_request'));
      if (!v) return json({ error: 'bad signature' }, 400);
      await env.DB.prepare(SQL.tokDel).bind(v.p).run();
      if (path === '/sns/meta/deauth') return json({ ok: true });
      const code = rnd(9);
      return json({ url: origin + '/sns/meta/deleted?c=' + code, confirmation_code: code });
    }
    if (path === '/sns/meta/deleted') return new Response('d-capitalism.com: 연결 정보(게시 권한 토큰)를 지웠습니다. 이 앱은 다른 개인 정보를 보관하지 않습니다.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

    /* 여기부터 관리자만 (사이트에서 · 로그인 토큰) */
    if (!cors.ok) return json({ error: 'origin' }, 403);
    const u = await adminUser(env, req);
    if (!u) return json({ error: 'admin only' }, 403);
    const body = m === 'POST' && !/^\/sns\/part\//.test(path) ? await req.json().catch(() => ({})) : {};

    if (path === '/sns/status' && m === 'GET') {
      const rows = (await env.DB.prepare(SQL.tokAll).all()).results || [], by = {};
      rows.forEach((r) => { by[r.p] = r; });
      const out = { key: !!env.SNS_KEY, kv: !!env.SNS_KV, worker: origin, meta: { deauth: origin + '/sns/meta/deauth', del: origin + '/sns/meta/delete' }, p: {} };
      for (const p of PS) {
        const r = by[p], o = { ready: configured(env, p), conn: !!r, name: r ? r.name : null, exp: r ? r.exp : null, cb: origin + '/sns/cb/' + p };
        if (r && (p === 'ig' || p === 'th')) { try { await tok(env, p); } catch (e) { o.warn = e.message; } }   /* 60일 토큰은 화면을 열 때도 갱신 */
        if (r && p === 'fb') { try { const d = await tok(env, p); o.pages = (d.pages || []).map((g) => ({ id: g.id, name: g.name })); o.sel = d.sel; } catch (e) { o.warn = e.message; } }
        out.p[p] = o;
      }
      return json(out);
    }
    x = /^\/sns\/(connect|disconnect)\/(yt|ig|th|fb)$/.exec(path);
    if (x && m === 'POST') {
      const p = x[2];
      if (x[1] === 'disconnect') { await env.DB.prepare(SQL.tokDel).bind(p).run(); return json({ ok: true }); }
      if (!configured(env, p)) return json({ error: NAME[p] + ' 앱 비밀값(또는 SNS_KEY)이 Worker 에 없습니다 — 설정 방법을 따라 넣어 주세요' }, 400);
      const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
      const back = String(body.back || '');
      if (!allowed.some((o) => back.startsWith(o + '/'))) return json({ error: 'bad back' }, 400);
      const s = rnd(24);
      await env.DB.prepare(SQL.stOld).bind(now()).run();
      await env.DB.prepare(SQL.stPut).bind(s, p, back, now() + 600).run();
      return json({ url: authUrl(env, p, origin + '/sns/cb/' + p, s) });
    }
    if (path === '/sns/fb/page' && m === 'POST') {
      const d = await tok(env, 'fb'), pg = (d.pages || []).find((g) => g.id === String(body.id));
      if (!pg) return json({ error: '페이지 없음' }, 400);
      d.sel = pg.id; await saveTok(env, 'fb', { data: d, name: pg.name, exp: null });
      return json({ ok: true, sel: pg.id });
    }
    if (path === '/sns/job' && m === 'POST') {   /* 영상 올리기 준비 {id: SHA-256, size, dur, w, h, audio} */
      if (!env.SNS_KV) return json({ error: '영상 보관함(KV)이 연결되지 않았습니다 — Worker 배포를 확인해 주세요' }, 503);
      const id = String(body.id || ''), size = Math.floor(Number(body.size));
      if (!/^[0-9a-f]{64}$/.test(id) || !(size > 1000) || size > MAX_SIZE) return json({ error: '영상 크기·식별값 이상 (최대 300MB)' }, 400);
      const w = Math.floor(Number(body.w)) || 0, h = Math.floor(Number(body.h)) || 0, dur = Number(body.dur) || 0;
      if (!(h > w) || dur < 3) return json({ error: '세로(9:16) 3초 이상 영상만 올릴 수 있습니다' }, 400);
      await env.DB.prepare(SQL.jobOld).bind(now() - 2 * 86400).run();
      await env.DB.prepare(SQL.postOld).bind(now() - 180 * 86400).run();
      let j = await env.DB.prepare(SQL.jobGet).bind(id).first();
      if (j && (j.size !== size || j.created < now() - JOB_TTL)) { await env.DB.prepare(SQL.jobDel).bind(id).run(); j = null; }   /* 오래돼 KV 조각이 지워졌을 수 있음 → 다시 */
      if (!j) {
        const parts = Math.ceil(size / PART);
        await env.DB.prepare(SQL.jobPut).bind(id, size, parts, '0'.repeat(parts), dur, w, h, String(body.audio || '').slice(0, 20), now()).run();
        j = await env.DB.prepare(SQL.jobGet).bind(id).first();
      }
      const posts = (await env.DB.prepare(SQL.postAll).bind(id).all()).results || [];
      return json({ id, part: PART, parts: j.parts, have: j.have, url: vurl(origin, id), posts });
    }
    x = /^\/sns\/part\/([0-9a-f]{64})\/(\d+)$/.exec(path);
    if (x && m === 'POST') {   /* 조각 하나 (본문 = 영상 바이트) → KV */
      const j = await env.DB.prepare(SQL.jobGet).bind(x[1]).first(), k = Number(x[2]);
      if (!j || k >= j.parts) return json({ error: '작업 없음' }, 404);
      const want = partLen(j, k), got = Number(req.headers.get('Content-Length'));
      if (got !== want || !req.body) return json({ error: '조각 크기 다름 (' + got + ' ≠ ' + want + ')' }, 400);
      await env.SNS_KV.put('m:' + j.id + ':' + k, req.body, { expirationTtl: KV_TTL });
      const cur = await env.DB.prepare(SQL.jobGet).bind(j.id).first();
      const have = cur.have.slice(0, k) + '1' + cur.have.slice(k + 1);
      await env.DB.prepare(SQL.jobHave).bind(have, j.id).run();
      return json({ ok: true, have });
    }
    if ((path === '/sns/pub' || path === '/sns/step') && m === 'POST') {
      const id = String(body.job || ''), p = String(body.p || '');
      if (!PS.includes(p)) return json({ error: 'sns' }, 400);
      const j = await env.DB.prepare(SQL.jobGet).bind(id).first();
      if (!j) return json({ error: '영상 작업이 없습니다 — 다시 올려 주세요' }, 404);
      const row = await env.DB.prepare(SQL.postGet).bind(id, p).first();
      if (path === '/sns/pub') {
        if (row && row.st === 'done') return json({ p, st: 'done', url: row.url, dup: true });   /* 같은 영상은 한 번만 */
        if (row && (row.st === 'up' || row.st === 'wait') && now() - row.upd < 600) return json({ p, st: row.st, busy: true });   /* 진행 중 — 다시 시작하지 않음 */
        if (j.have.indexOf('0') >= 0) return json({ error: '영상 올리기가 끝나지 않았습니다' }, 409);
        try {
          const r = await pubStart(env, j, p, body, origin);
          return json(await savePost(env, id, p, r.st, r.data));
        } catch (e) { return json(await savePost(env, id, p, 'err', null, null, e.message)); }
      }
      if (!row) return json({ error: '시작하지 않았습니다' }, 404);
      if (row.st === 'done' || row.st === 'err') return json({ p, st: row.st, url: row.url, err: row.err });
      let r;
      try { r = await pubStep(env, j, row); } catch (e) {
        if (e.status === 409 || e.status === 410) r = { st: 'err', data: row.data ? JSON.parse(row.data) : null, err: e.message };
        else return json({ p, st: row.st, warn: e.message });   /* 일시 오류 — 다음 번에 다시 */
      }
      const out = await savePost(env, id, p, r.st, r.data, r.url, r.err);
      if (r.pct != null) out.pct = r.pct;
      return json(out);
    }
    if (path === '/sns/posts' && m === 'GET') {
      const id = url.searchParams.get('job') || '';
      return json({ posts: (await env.DB.prepare(SQL.postAll).bind(id).all()).results || [] });
    }
    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: e && e.message ? e.message : 'server' }, (e && e.status) || 500);
  }
}
export const _test = { SQL, PART, seal, unseal, authUrl, slice, signed, hmac, reset: () => { ready = false; } };
