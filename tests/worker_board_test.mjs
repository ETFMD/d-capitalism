// Worker 건의 게시판(/board · worker/src/board.js) 단독 확인 (node tests/worker_board_test.mjs · run_regression.py 가 부름)
//  · 진짜 SQLite(node:sqlite — Node 22.5+)에 worker/schema.sql 전체를 만들고, Worker 의 fetch(worker/src/index.js)를 그대로 불러 확인 — 허용 출처·로그인 토큰(auth.js)·관리자 판단까지 실제 코드
//  · 읽기(누구나)·쓰기(회원만)·고치기(글쓴이만)·지우기(글쓴이·관리자)·공감(한 번 · 내 글 제외 · 바라는 상태로)·댓글(운영자 답변 표시)·처리 상태(관리자)
//  · 비밀글(목록에서 제목 숨김 · 찾기에서도 뺌 · 글쓴이·관리자만 열기) · 닉네임 가림(홍*동) · 기기 정보(글쓴이·관리자만) · 공지(관리자만 · 맨 위 · 공감 없음)
//  · 입력 검사(분류·길이·화면 주소·제어 문자) · 두 번 눌림(같은 글 → 앞 글) · 횟수 제한(30초·1시간 5개·하루 20개 · 댓글 10초·하루 60개) · 찾기 % 글자 그대로
//  · 탈퇴(DELETE /auth/me) → 그 회원의 글·댓글·공감 즉시 삭제 · 남의 글 공감 수도 바로 줄어듦
//  --serve <포트> <허용 출처> : 화면 검사(run_regression.py board_check)용 — 같은 Worker 코드를 이 SQLite 로 띄움 · 첫 줄에 {port, tokens} 출력
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVE = process.argv[2] === '--serve';

let DatabaseSync;
try {
  const ew = process.emitWarning; process.emitWarning = (w, ...a) => (/SQLite/.test(String(w)) ? undefined : ew.call(process, w, ...a));
  ({ DatabaseSync } = await import('node:sqlite').finally(() => { process.emitWarning = ew; }));
} catch (e) {
  console.log((SERVE ? 'SERVE-FAIL ' : '') + 'worker_board_test: node:sqlite 없음 (Node 22.5+ 필요 · 지금 ' + process.version + ')');
  process.exit(SERVE ? 3 : 1);
}
/* Worker 원본을 임시 폴더로 복사 (package.json type=module — 저장소 worker/ 에는 package.json 이 없음) */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardt-'));
for (const f of fs.readdirSync(path.join(ROOT, 'worker', 'src'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'worker', 'src', f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
const B = await import(pathToFileURL(path.join(dir, 'board.js')).href);

/* ── D1 흉내: node:sqlite 에 같은 SQL 그대로 (prepare·bind·first·all·run·batch=한 거래) ── */
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
const plain = (r) => (r ? { ...r } : null);
function stmt(sql, args) {
  const ex = () => {
    const s = db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) return { results: s.all(...args).map(plain), meta: {} };
    const r = s.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  return {
    bind: (...a) => { if (a.some((x) => x === undefined)) throw new Error('D1 bind undefined: ' + sql); return stmt(sql, a); },
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ex(),
    run: async () => ex(),
    _ex: ex,
  };
}
const DB = { prepare: (sql) => stmt(sql, []), batch: async (list) => { db.exec('BEGIN'); try { const o = list.map((s) => s._ex()); db.exec('COMMIT'); return o; } catch (e) { db.exec('ROLLBACK'); throw e; } } };

const SITE = SERVE ? process.argv[4] || 'http://127.0.0.1' : 'https://d-capitalism.com';
const env = { DB, AUTH_SECRET: 'board-test-secret', ALLOWED_ORIGINS: SITE, KAKAO_CLIENT_ID: 'test-kakao' };
let clock = Date.UTC(2026, 9, 20, 3, 0);   // 12:00 KST
const realNow = Date.now;
if (!SERVE) Date.now = () => clock;
const sec = () => Math.floor(Date.now() / 1000);

/* 회원 · 로그인 토큰 (auth.js 와 같은 서명) */
const enc = new TextEncoder();
const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function token(uid) {
  const p = b64u(JSON.stringify({ k: 'u', uid, v: 0, exp: sec() + 30 * 86400 }));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return p + '.' + Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(p))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const addUser = (id, nick) => db.prepare("INSERT INTO users (id, provider, pid, nick, created, last, agreed, terms_ver, ver) VALUES (?, 'kakao', ?, ?, ?, ?, ?, '2026-10-20', 0)").run(id, 'p' + id, nick, sec(), sec(), sec());
addUser(2, '현경흠'); addUser(5, '홍길동'); addUser(6, '김철수'); addUser(7, 'Al');
const TK = { admin: await token(2), a: await token(5), b: await token(6), c: await token(7) };

if (SERVE) {
  const srv = http.createServer(async (rq, rs) => {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = Buffer.concat(chunks);
    const h = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (typeof v === 'string') h.set(k, v);
    try {
      const r = await worker.fetch(new Request('https://w' + rq.url, { method: rq.method, headers: h, body: ['GET', 'HEAD', 'OPTIONS'].includes(rq.method) ? undefined : body }), env, {});
      const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
      rs.writeHead(r.status, out); rs.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { rs.writeHead(500); rs.end(String(e && e.stack || e)); }
  });
  srv.listen(Number(process.argv[3]) || 0, '127.0.0.1', () => { console.log(JSON.stringify({ port: srv.address().port, tokens: TK })); });
} else {
  let fails = 0, oks = 0;
  const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
  async function call(method, p, body, who, origin = SITE) {
    const h = { 'Content-Type': 'application/json' };
    if (origin) h.Origin = origin;
    if (who) h.Authorization = 'Bearer ' + (TK[who] || who);
    h['User-Agent'] = 'Mozilla/5.0 (test) board';
    const r = await worker.fetch(new Request('https://w' + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, {});
    let j = null; try { j = await r.json(); } catch (e) {}
    return { s: r.status, j: j || {}, h: r.headers };
  }
  const tick = (s) => { clock += s * 1000; };
  const rows = (sql, ...a) => db.prepare(sql).all(...a).map(plain);

  // ── 순수 함수
  ok(B.maskNick('홍길동') === '홍*동' && B.maskNick('현경흠') === '현*흠' && B.maskNick('Al') === 'A*' && B.maskNick('가') === '가*' && B.maskNick('') === '회*'
    && B.maskNick('Alexander') === 'A****r', '닉네임 가림', [B.maskNick('홍길동'), B.maskNick('Alexander')]);
  ok(B.clean(' a\r\nb‮\u0007\n\n\n\n\nc ', 100, true) === 'a\nb\n\n\nc', '여러 줄 다듬기(줄바꿈·제어 문자·방향 문자·빈 줄)', B.clean(' a\r\nb‮\u0007\n\n\n\n\nc ', 100, true));
  ok(B.clean('  제목\n  둘\t셋 ', 100, false) === '제목 둘 셋' && B.clean('x'.repeat(81), 80, false) === null, '한 줄 다듬기 · 길이 넘으면 null', B.clean('  제목\n  둘\t셋 ', 100, false));

  // ── 출처·로그인
  let r = await call('GET', '/board', undefined, null, 'https://evil.example');
  ok(r.s === 403 && r.j.error === 'origin', '다른 사이트 출처 → 403', r);
  r = await call('OPTIONS', '/board', undefined, null);
  ok(r.s === 204 && r.h.get('access-control-allow-origin') === SITE && /DELETE/.test(r.h.get('access-control-allow-methods')), 'OPTIONS → 204 · CORS 허용', [r.s, r.h.get('access-control-allow-origin')]);
  r = await call('GET', '/board');
  ok(r.s === 200 && r.j.posts.length === 0 && r.j.n === 0 && r.j.viewer.login === false && r.j.stat.open === 0, '처음 목록(손님) → 빈 목록', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: '로그인 없이', body: '본문 다섯 글자 이상' });
  ok(r.s === 401, '손님 글쓰기 → 401', r);
  r = await call('POST', '/board', { cat: 'bug', title: '가짜 토큰', body: '본문 다섯 글자 이상' }, 'x.y');
  ok(r.s === 401, '틀린 토큰 → 401', r);

  // ── 입력 검사
  r = await call('POST', '/board', { cat: 'bad', title: '분류 이상', body: '본문 다섯 글자 이상' }, 'a'); ok(r.s === 400 && r.j.field === 'cat', '분류 이상 → 400', r.j);
  r = await call('POST', '/board', { cat: 'notice', title: '회원 공지', body: '본문 다섯 글자 이상' }, 'a'); ok(r.s === 400 && r.j.field === 'cat', '회원이 공지 → 400', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: '가', body: '본문 다섯 글자 이상' }, 'a'); ok(r.s === 400 && r.j.field === 'title', '제목 1글자 → 400', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: 'x'.repeat(81), body: '본문 다섯 글자 이상' }, 'a'); ok(r.s === 400 && r.j.field === 'too long', '제목 81자 → 400', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: '본문 짧음', body: '짧음' }, 'a'); ok(r.s === 400 && r.j.field === 'body', '본문 4글자 → 400', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: '본문 김', body: 'y'.repeat(5001) }, 'a'); ok(r.s === 400 && r.j.field === 'too long', '본문 5001자 → 400', r.j);
  r = await call('POST', '/board', { cat: 'bug', title: '화면 이상', body: '본문 다섯 글자 이상', page: '../x' }, 'a'); ok(r.s === 400 && r.j.field === 'page', '화면 주소 이상 → 400', r.j);
  r = await call('POST', '/board', '{bad json', 'a'); ok(r.s === 400 && r.j.error === 'bad json', 'JSON 이상 → 400', r.j);

  // ── 새 글 (회원 5 홍길동: 버그 + 기기 정보)
  const XSS = '<img src=x onerror=alert(1)> 연봉 계산기 오류';
  r = await call('POST', '/board', { cat: 'bug', title: XSS, body: '연봉 5,000만원을 넣으면\r\n실수령액이 0원으로 나옵니다.‮', page: 'salary', secret: false, info: { w: 390, h: 844, dpr: 3, lang: 'ko-KR', theme: 'dark', zoom: 1.1 } }, 'a');
  ok(r.s === 200 && r.j.ok && r.j.id === 1, '회원 새 글 → id 1', r.j);
  const P1 = r.j.id;
  r = await call('POST', '/board', { cat: 'bug', title: XSS, body: '연봉 5,000만원을 넣으면\r\n실수령액이 0원으로 나옵니다.‮', page: 'salary', info: true }, 'a');
  ok(r.s === 200 && r.j.id === P1 && r.j.dup, '같은 글 또 보냄(두 번 눌림) → 앞 글 그대로', r.j);
  r = await call('POST', '/board', { cat: 'feat', title: '두 번째 글', body: '30초 안에 다른 글' }, 'a');
  ok(r.s === 429 && r.j.error === 'slow' && r.j.wait === 30, '30초 안에 새 글 → 429 slow', r.j);
  tick(31);
  r = await call('POST', '/board', { cat: 'feat', title: '다크 모드 그래프 색', body: '그래프 선을 더 굵게 해 주세요' }, 'a');
  ok(r.s === 200 && r.j.id === 2, '31초 뒤 → 새 글 id 2', r.j);
  const P2 = r.j.id;
  let row = rows('SELECT * FROM board_post WHERE id = ?', P1)[0];
  ok(row.title === XSS && row.body === '연봉 5,000만원을 넣으면\n실수령액이 0원으로 나옵니다.' && row.st === 'open' && row.page === 'salary', '글자 그대로 저장(HTML 아님) · 줄바꿈·방향 문자 정리', row);
  const info = JSON.parse(row.info);
  ok(info.w === 390 && info.dpr === 3 && info.ua === 'Mozilla/5.0 (test) board' && info.zoom === 1.1 && info.theme === 'dark', '기기 정보(브라우저는 요청 머리글에서)', info);
  ok(rows('SELECT info FROM board_post WHERE id = ?', P2)[0].info === null, '기기 정보 안 고르면 저장 안 함', 0);

  // ── 회원 6 김철수: 비밀글
  tick(5);
  r = await call('POST', '/board', { cat: 'etc', title: '내 계정 기록이 사라졌어요', body: '무한매수법 기록 비밀 내용 abc%_def', secret: true }, 'b');
  ok(r.j.ok && r.j.id === 3, '비밀글 → id 3', r.j);
  const P3 = r.j.id;
  r = await call('GET', '/board');
  const lp = (j, id) => j.posts.find((x) => x.id === id);
  ok(r.j.n === 3 && r.j.posts.map((x) => x.id).join() === '3,2,1', '목록 최신순', r.j.posts.map((x) => x.id));
  ok(lp(r.j, P3).locked && lp(r.j, P3).title === '' && lp(r.j, P3).secret && lp(r.j, P3).nick === '김*수', '손님: 비밀글 제목 숨김 · 닉네임 가림', lp(r.j, P3));
  ok(lp(r.j, P1).nick === '홍*동' && lp(r.j, P1).title === XSS && lp(r.j, P1).uid === undefined && lp(r.j, P1).me === false, '손님: 일반 글 제목 · 회원 번호 없음', lp(r.j, P1));
  r = await call('GET', '/board/' + P3); ok(r.s === 403 && r.j.error === 'secret', '손님: 비밀글 열기 → 403', r);
  r = await call('GET', '/board/' + P3, undefined, 'a'); ok(r.s === 403, '다른 회원: 비밀글 열기 → 403', r);
  r = await call('GET', '/board/' + P3, undefined, 'b'); ok(r.s === 200 && r.j.post.body.includes('비밀 내용') && r.j.post.me, '글쓴이: 비밀글 열림', r.j.post);
  r = await call('GET', '/board/' + P3, undefined, 'admin'); ok(r.s === 200 && r.j.post.nick === '김철수' && r.j.post.uid === 6 && r.j.viewer.admin, '관리자: 비밀글 · 전체 닉네임 · 회원 번호', r.j.post);
  r = await call('GET', '/board', undefined, 'b'); ok(!lp(r.j, P3).locked && lp(r.j, P3).title && lp(r.j, P3).me && r.j.stat.mine === 1, '글쓴이 목록: 비밀글 제목 보임 · 내 글 수', [lp(r.j, P3), r.j.stat]);

  // ── 찾기 (비밀글 빼기 · % _ 글자 그대로)
  r = await call('GET', '/board?q=' + encodeURIComponent('비밀 내용')); ok(r.j.n === 0, '손님 찾기: 비밀글 본문은 안 나옴', r.j.n);
  r = await call('GET', '/board?q=' + encodeURIComponent('비밀 내용'), undefined, 'admin'); ok(r.j.n === 1, '관리자 찾기: 비밀글 나옴', r.j.n);
  r = await call('GET', '/board?q=' + encodeURIComponent('%_'), undefined, 'b'); ok(r.j.n === 1 && r.j.posts[0].id === P3, '찾기 % _ 는 글자 그대로(모두 맞음 아님)', r.j.n);
  r = await call('GET', '/board?q=' + encodeURIComponent('%'), undefined, 'a'); ok(r.j.n === 0, '찾기 % 하나 → 0개', r.j.n);
  r = await call('GET', '/board?q=' + encodeURIComponent('실수령액')); ok(r.j.n === 1 && r.j.posts[0].id === P1, '본문 낱말로 찾기', r.j.n);
  r = await call('GET', '/board?c=feat'); ok(r.j.n === 1 && r.j.posts[0].id === P2, '분류 거르기', r.j.n);

  // ── 글 보기: 기기 정보는 글쓴이·관리자만
  r = await call('GET', '/board/' + P1, undefined, 'b'); ok(r.s === 200 && r.j.post.info === undefined && r.j.post.body.includes('0원') && r.j.post.nick === '홍*동', '다른 회원: 기기 정보 없음', r.j.post);
  r = await call('GET', '/board/' + P1, undefined, 'a'); ok(r.j.post.info && r.j.post.info.w === 390 && r.j.post.me, '글쓴이: 기기 정보 보임', r.j.post.info);
  r = await call('GET', '/board/999'); ok(r.s === 404, '없는 글 → 404', r.s);

  // ── 공감
  r = await call('POST', '/board/' + P1 + '/vote', { on: true }); ok(r.s === 401, '손님 공감 → 401', r.s);
  r = await call('POST', '/board/' + P1 + '/vote', { on: true }, 'a'); ok(r.s === 403 && r.j.error === 'own', '내 글 공감 → 403', r.j);
  r = await call('POST', '/board/' + P1 + '/vote', { on: true }, 'b'); ok(r.j.ok && r.j.voted && r.j.votes === 1, '공감 → 1', r.j);
  r = await call('POST', '/board/' + P1 + '/vote', { on: true }, 'b'); ok(r.j.votes === 1, '또 눌러도(on) 1', r.j);
  r = await call('POST', '/board/' + P1 + '/vote', { on: true }, 'c'); ok(r.j.votes === 2, '다른 회원 공감 → 2', r.j);
  r = await call('POST', '/board/' + P1 + '/vote', { on: false }, 'c'); ok(r.j.votes === 1 && r.j.voted === false, '공감 끄기 → 1', r.j);
  r = await call('POST', '/board/' + P3 + '/vote', { on: true }, 'a'); ok(r.s === 403 && r.j.error === 'secret', '못 보는 비밀글 공감 → 403', r.j);
  r = await call('GET', '/board/' + P1, undefined, 'b'); ok(r.j.post.voted === true && r.j.post.votes === 1, '글 보기: 내 공감 표시', r.j.post);
  r = await call('GET', '/board?sort=vote'); ok(r.j.posts[0].id === P1 && r.j.posts[0].votes === 1, '공감순', r.j.posts.map((x) => [x.id, x.votes]));

  // ── 댓글 · 운영자 답변 · 답변 대기
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '저도 같은 증상이에요' }, 'b'); ok(r.j.ok && r.j.id === 1, '회원 댓글', r.j);
  const C1 = r.j.id;
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '저도 같은 증상이에요' }, 'b'); ok(r.j.ok && r.j.id === C1 && r.j.dup, '같은 댓글 또 보냄 → 앞 댓글 그대로', r.j);
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '또 하나' }, 'b'); ok(r.s === 429 && r.j.error === 'slow', '댓글 10초 안 → 429', r.j);
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '   ' }, 'c'); ok(r.s === 400 && r.j.field === 'body', '빈 댓글 → 400', r.j);
  r = await call('POST', '/board/' + P1 + '/cmt', { body: 'z'.repeat(2001) }, 'c'); ok(r.s === 400 && r.j.field === 'too long', '댓글 2001자 → 400', r.j);
  r = await call('POST', '/board/' + P3 + '/cmt', { body: '남의 비밀글 댓글' }, 'a'); ok(r.s === 403, '못 보는 비밀글 댓글 → 403', r.s);
  r = await call('GET', '/board?wait=1', undefined, 'admin'); ok(r.j.n === 3 && r.j.stat.wait === 3, '관리자: 답변 대기 3', [r.j.n, r.j.stat]);
  r = await call('GET', '/board?wait=1'); ok(r.j.n === 3 && r.j.stat.wait === undefined, '손님 wait=1 은 무시(전체) · 대기 수 없음', [r.j.n, r.j.stat]);
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '확인했습니다. 고쳐서 배포했어요.' }, 'admin'); ok(r.j.ok, '운영자 답변', r.j);
  r = await call('POST', '/board/' + P3 + '/cmt', { body: '비밀글 답변' }, 'admin'); ok(r.j.ok, '운영자: 비밀글 답변', r.j);
  r = await call('GET', '/board/' + P1, undefined, 'c');
  ok(r.j.cmts.length === 2 && r.j.cmts[0].nick === '김*수' && !r.j.cmts[0].admin && r.j.cmts[1].admin && r.j.cmts[1].nick === '운영자' && r.j.post.ans && r.j.post.cmts === 2, '댓글 목록 · 운영자 표시', r.j.cmts);
  r = await call('GET', '/board?wait=1', undefined, 'admin'); ok(r.j.n === 1 && r.j.posts[0].id === P2 && r.j.stat.wait === 1, '답변한 글은 대기에서 빠짐', [r.j.n, r.j.stat]);
  r = await call('GET', '/board'); ok(lp(r.j, P1).ans && lp(r.j, P1).cmts === 2 && lp(r.j, P1).votes === 1, '목록: 답변 완료 · 댓글 수 · 공감 수', lp(r.j, P1));

  // ── 댓글 지우기
  r = await call('DELETE', '/board/cmt/' + C1, undefined, 'a'); ok(r.s === 403, '남의 댓글 지우기 → 403', r.s);
  r = await call('DELETE', '/board/cmt/' + C1, undefined, 'b'); ok(r.j.ok, '내 댓글 지우기', r.j);
  r = await call('DELETE', '/board/cmt/' + C1, undefined, 'b'); ok(r.s === 404, '지운 댓글 다시 → 404', r.s);

  // ── 처리 상태
  r = await call('POST', '/board/' + P1 + '/st', { st: 'done' }, 'a'); ok(r.s === 403, '회원 상태 바꾸기 → 403', r.s);
  r = await call('POST', '/board/' + P1 + '/st', { st: 'nope' }, 'admin'); ok(r.s === 400, '상태 값 이상 → 400', r.s);
  r = await call('POST', '/board/' + P1 + '/st', { st: 'done' }, 'admin'); ok(r.j.ok && r.j.st === 'done', '관리자 상태 → 완료', r.j);
  r = await call('POST', '/board/' + P2 + '/st', { st: 'plan' }, 'admin');
  r = await call('GET', '/board?s=done'); ok(r.j.n === 1 && r.j.posts[0].id === P1 && r.j.posts[0].st === 'done' && r.j.posts[0].sat, '상태 거르기', r.j.posts);
  ok(r.j.stat.open === 1 && r.j.stat.plan === 1 && r.j.stat.done === 1 && r.j.stat.hold === 0, '상태별 개수', r.j.stat);

  // ── 고치기
  r = await call('POST', '/board/' + P1, { cat: 'bug', title: '남이 고침', body: '남이 고친 본문' }, 'b'); ok(r.s === 403, '남의 글 고치기 → 403', r.s);
  r = await call('POST', '/board/' + P1, { cat: 'bug', title: '운영자가 고침', body: '운영자가 고친 본문' }, 'admin'); ok(r.s === 403, '운영자도 남의 글은 못 고침', r.s);
  tick(40);
  r = await call('POST', '/board/' + P1, { cat: 'bug', title: '연봉 계산기 실수령액 0원', body: '고친 본문입니다', page: 'salary', secret: false }, 'a'); ok(r.j.ok, '글쓴이 고치기', r.j);
  r = await call('GET', '/board/' + P1); ok(r.j.post.title === '연봉 계산기 실수령액 0원' && r.j.post.upd === sec() && r.j.post.st === 'done', '고친 내용 · 고친 시각 · 상태 그대로', r.j.post);

  // ── 공지 (관리자만 · 맨 위 · 공감 없음 · 상태 개수에서 뺌)
  r = await call('POST', '/board', { cat: 'notice', title: '건의 게시판 이용 안내', body: '버그와 바라는 기능을 남겨 주세요.' }, 'admin'); ok(r.j.ok, '관리자 공지', r.j);
  const PN = r.j.id;
  r = await call('GET', '/board'); ok(r.j.posts[0].id === PN && r.j.posts[0].staff && r.j.posts[0].nick === '운영자' && r.j.stat.open === 1, '공지 맨 위 · 운영자 · 상태 개수에서 뺌', [r.j.posts[0], r.j.stat]);
  r = await call('GET', '/board?sort=vote'); ok(r.j.posts[0].id === PN, '공감순에도 공지 맨 위', r.j.posts.map((x) => x.id));
  r = await call('POST', '/board/' + PN + '/vote', { on: true }, 'a'); ok(r.s === 400 && r.j.error === 'notice', '공지 공감 → 400', r.j);

  // ── 쪽 나누기 (관리자는 횟수 제한 없음)
  for (let i = 0; i < 22; i++) { r = await call('POST', '/board', { cat: 'etc', title: '운영자 시험 글 ' + i, body: '쪽 나누기 시험 ' + i }, 'admin'); if (!r.j.ok) break; }
  ok(r.j.ok, '관리자 연속 22개(제한 없음)', r.j);
  r = await call('GET', '/board?p=1'); ok(r.j.posts.length === 20 && r.j.n === 26 && r.j.pages === 2 && r.j.posts[0].id === PN, '1쪽 20개 · 모두 26 · 2쪽', [r.j.posts.length, r.j.n, r.j.pages]);
  r = await call('GET', '/board?p=2'); ok(r.j.posts.length === 6 && r.j.page === 2 && !r.j.posts.some((x) => x.id === PN), '2쪽 6개 · 공지는 1쪽만', [r.j.posts.length, r.j.page]);
  r = await call('GET', '/board?p=99999'); ok(r.j.page === 500 && r.j.posts.length === 0, '쪽 번호 상한', r.j.page);
  r = await call('GET', '/board?mine=1', undefined, 'a'); ok(r.j.n === 2 && r.j.posts.every((x) => x.me), '내 글만', r.j.n);
  r = await call('GET', '/board?mine=1'); ok(r.j.n === 0, '손님 내 글 → 0', r.j.n);

  // ── 회원 횟수 제한 (1시간 5개 · 하루 20개 · 댓글 하루 60개)
  for (let i = 0; i < 3; i++) { tick(31); r = await call('POST', '/board', { cat: 'feat', title: '제안 ' + i, body: '제안 본문 ' + i }, 'c'); }
  ok(r.j.ok, '회원 7: 31초 간격 3개', r.j);
  tick(31); r = await call('POST', '/board', { cat: 'feat', title: '제안 4', body: '제안 본문 4' }, 'c');
  tick(31); r = await call('POST', '/board', { cat: 'feat', title: '제안 5', body: '제안 본문 5' }, 'c'); ok(r.j.ok, '1시간에 5개까지', r.j);
  tick(31); r = await call('POST', '/board', { cat: 'feat', title: '제안 6', body: '제안 본문 6' }, 'c'); ok(r.s === 429 && r.j.error === 'limit', '1시간 6번째 → 429 limit', r.j);
  db.prepare('UPDATE board_post SET created = created - 3700 WHERE uid = 7').run();
  r = await call('POST', '/board', { cat: 'feat', title: '제안 6', body: '제안 본문 6' }, 'c'); ok(r.j.ok, '1시간 지나면 다시', r.j);
  db.prepare('UPDATE board_post SET created = created - 3700 WHERE uid = 7').run();
  for (let i = 0; i < 14; i++) db.prepare("INSERT INTO board_post (uid, cat, st, title, body, created) VALUES (7, 'etc', 'open', 'x', 'yyyyy', ?)").run(sec() - 7200 - i);
  r = await call('POST', '/board', { cat: 'feat', title: '제안 21', body: '제안 본문 21' }, 'c'); ok(r.s === 429 && r.j.error === 'limit', '하루 21번째 → 429', r.j);
  for (let i = 0; i < 60; i++) db.prepare('INSERT INTO board_cmt (pid, uid, body, admin, created) VALUES (?, 7, ?, 0, ?)').run(P2, 'c' + i, sec() - 100 - i);
  r = await call('POST', '/board/' + P2 + '/cmt', { body: '61번째' }, 'c'); ok(r.s === 429 && r.j.error === 'limit', '댓글 하루 61번째 → 429', r.j);

  // ── 지우기
  r = await call('DELETE', '/board/' + P2, undefined, 'b'); ok(r.s === 403, '남의 글 지우기 → 403', r.s);
  r = await call('DELETE', '/board/' + P2); ok(r.s === 401, '손님 지우기 → 401', r.s);
  const before = rows('SELECT COUNT(*) AS n FROM board_cmt WHERE pid = ?', P2)[0].n;
  r = await call('DELETE', '/board/' + P2, undefined, 'admin'); ok(r.j.ok && before === 60, '관리자가 남의 글 지우기', [r.j, before]);
  ok(rows('SELECT COUNT(*) AS n FROM board_cmt WHERE pid = ?', P2)[0].n === 0 && rows('SELECT COUNT(*) AS n FROM board_post WHERE id = ?', P2)[0].n === 0, '글 지우면 댓글도 지움', 0);
  r = await call('GET', '/board/' + P2); ok(r.s === 404, '지운 글 → 404', r.s);

  // ── 탈퇴 → 그 회원의 글·댓글·공감 즉시 삭제
  tick(20);
  r = await call('POST', '/board/' + P1 + '/cmt', { body: '탈퇴 전 회원 6 댓글' }, 'b'); ok(r.j.ok, '회원 6 댓글(탈퇴 전)', r.j);
  r = await call('GET', '/board/' + P1); const v0 = r.j.post.votes, c0 = r.j.cmts.length;
  r = await call('DELETE', '/auth/me', undefined, 'b'); ok(r.j.ok, '회원 6 탈퇴', r.j);
  ok(rows('SELECT COUNT(*) AS n FROM board_post WHERE uid = 6')[0].n === 0 && rows('SELECT COUNT(*) AS n FROM board_cmt WHERE uid = 6 OR pid = ?', P3)[0].n === 0
    && rows('SELECT COUNT(*) AS n FROM board_vote WHERE uid = 6')[0].n === 0, '탈퇴: 글·댓글(내 글에 달린 운영자 답변 포함)·공감 삭제', 0);
  r = await call('GET', '/board/' + P1); ok(r.j.post.votes === v0 - 1 && r.j.cmts.length === c0 - 1, '남의 글 공감·댓글 수 바로 줄어듦', [v0, r.j.post.votes, c0, r.j.cmts.length]);
  r = await call('GET', '/board/' + P3, undefined, 'admin'); ok(r.s === 404, '탈퇴 회원 비밀글 없음', r.s);
  r = await call('POST', '/board', { cat: 'bug', title: '탈퇴 뒤 토큰', body: '쓰면 안 되는 글' }, 'b'); ok(r.s === 401, '탈퇴 회원 토큰 → 401', r.s);
  r = await call('GET', '/board', undefined, 'b'); ok(r.s === 200 && r.j.viewer.login === false, '탈퇴 회원 토큰으로 읽기 → 손님으로', r.j.viewer);
  r = await call('GET', '/board/abc'); ok(r.s === 404, '이상한 주소 → 404', r.s);
  r = await call('POST', '/board/1/zzz', {}, 'a'); ok(r.s === 404, '없는 동작 → 404', r.s);

  Date.now = realNow;
  console.log((fails ? '실패 ' + fails + '건 · ' : '') + 'worker_board_test: ' + oks + '개 통과 (D1: SQLite)');
  process.exit(fails ? 1 : 0);
}
