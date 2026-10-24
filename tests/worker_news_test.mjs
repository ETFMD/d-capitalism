// Worker 디코딩 뉴스(/news · worker/src/news.js) 단독 확인 (node tests/worker_news_test.mjs · run_regression.py 가 부름)
//  · 진짜 SQLite(node:sqlite — Node 22.13+)에 worker/schema.sql 전체 + 실제 Worker fetch·scheduled(worker/src/index.js) 그대로
//  · 가짜 RSS(형식만 흉내 낸 짧은 글 — 실제 기사 아님) · 가짜 Workers AI(env.AI.run) · 가짜 시계
//  · RSS 읽기(날짜 형식·CDATA·글자 참조·추적 꼬리·종목 힌트·광고 문구) · 1분 수집(48시간·처음 원본의 날짜 없는 기사·같은 기사 두 번 막기·원본 실패 뒤 점점 드물게)
//  · AI 정리(full/tag/none · 투자 무관 숨김 · 이상한 답 3번 → 원문 · 한도 · 모델 바꾸기 · AI 없음) · GET /news (전체·바뀐 것만·숨긴 것·더 보기·나라)
//  --serve <포트> <허용 출처> : 화면 검사(run_regression.py news_check)용 — 같은 Worker 코드를 이 SQLite + 정리된 기사로 띄움 · 첫 줄에 {port}
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
  console.log((SERVE ? 'SERVE-FAIL ' : '') + 'worker_news_test: node:sqlite 없음 (Node 22.13+ 필요 · 지금 ' + process.version + ')');
  process.exit(SERVE ? 3 : 1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newst-'));
for (const f of fs.readdirSync(path.join(ROOT, 'worker', 'src'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'worker', 'src', f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
const worker = (await import(pathToFileURL(path.join(dir, 'index.js')).href)).default;
const N = await import(pathToFileURL(path.join(dir, 'news.js')).href);

/* ── D1 흉내 ── */
const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync(path.join(ROOT, 'worker', 'schema.sql'), 'utf8'));
const plain = (r) => (r ? { ...r } : null);
let reads = 0;
function stmt(sql, args) {
  const ex = () => {
    const s = db.prepare(sql);
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) { const o = s.all(...args).map(plain); reads += o.length; return { results: o, meta: {} }; }
    const r = s.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  };
  return {
    bind: (...a) => { if (a.some((x) => x === undefined)) throw new Error('D1 bind undefined: ' + sql); if (a.length > 100) throw new Error('D1 바인드 100개 넘음'); return stmt(sql, a); },
    first: async () => { const o = plain(db.prepare(sql).get(...args)); if (o) reads++; return o; },
    all: async () => ex(),
    run: async () => ex(),
    _ex: ex,
  };
}
const DB = { prepare: (sql) => stmt(sql, []), batch: async (list) => { db.exec('BEGIN'); try { const o = list.map((s) => s._ex()); db.exec('COMMIT'); return o; } catch (e) { db.exec('ROLLBACK'); throw e; } } };

const SITE = SERVE ? process.argv[4] || 'http://127.0.0.1' : 'https://d-capitalism.com';
let clock = Date.UTC(2026, 9, 26, 13, 30);   // 2026-10-26(월) 22:30 KST
const realNow = Date.now;
Date.now = () => clock;
const iso = (t) => new Date(t).toISOString();
const rfc = (t) => new Date(t).toUTCString().replace('GMT', '+0000');

/* ── 가짜 RSS 서버 (형식만 흉내 — 기사 내용은 지어낸 짧은 문장) ── */
const FEEDS = {};   // url → {status, body, etag}
let fetchLog = [];
globalThis.fetch = async (u, o = {}) => {
  u = String(u); fetchLog.push(u);
  const f = FEEDS[u];
  if (!f) return new Response('nf', { status: 404 });
  if (f.throw) throw new Error(f.throw);
  if (f.etag && o.headers && o.headers['If-None-Match'] === f.etag) return new Response(null, { status: 304 });
  return new Response(f.body, { status: f.status || 200, headers: f.etag ? { ETag: f.etag } : {} });
};
const FU = Object.fromEntries(N.NEWS_FEEDS.map((f) => [f.k, f.u]));
const rss = (items, extra = '') => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:nasdaq="http://nasdaq.com"><channel><title>t</title>${extra}${items.join('')}</channel></rss>`;
const item = (o) => `<item><title>${o.title}</title><link>${o.link}</link>${o.date ? `<pubDate>${o.date}</pubDate>` : ''}${o.desc != null ? `<description>${o.desc}</description>` : ''}${o.more || ''}</item>`;

/* ── 가짜 Workers AI ── */
let aiMode = 'ok', aiCalls = [];
const AI = {
  async run(model, inp) {
    aiCalls.push({ model, inp });
    if (aiMode === 'throw-first' && model === N.AI_MODELS[0][0]) throw new Error('5007: model unavailable');
    if (aiMode === 'quota') throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
    if (aiMode === 'junk') return { response: '죄송합니다. 정리할 수 없습니다.' };
    const items = JSON.parse(inp.messages[1].content.replace(/^\/no_think\n/, ''));
    const out = items.map((x) => ({
      i: x.i,
      t: x.mode === 'full' ? '한국어 제목: ' + x.title.slice(0, 20) : '무시돼야 함',
      s: x.mode === 'full' && x.d ? '요약: ' + x.d.slice(0, 30) : (x.mode === 'tag' ? '무시돼야 함' : ''),
      k: /Apple/.test(x.title) ? ['AAPL', '$nvda', 'bad ticker!!', 'TSLA', 'MSFT', 'AMZN', 'GOOG'] : (/삼성전자/.test(x.title) ? ['삼성전자'] : []),
      imp: /Fed|금리/.test(x.title) ? 3 : 7,
      sen: /falls|하락/.test(x.title) ? -1 : 0,
      rel: !/coupon|쿠폰/i.test(x.title),
    }));
    const txt = (aiMode === 'think' ? '<think>생각 [1,2]</think>\n```json\n' : '') + JSON.stringify(out) + (aiMode === 'think' ? '\n```' : '');
    return { response: txt, usage: { prompt_tokens: 900, completion_tokens: 600 } };
  },
};
const env = { DB, ALLOWED_ORIGINS: SITE, AI };

if (SERVE) {
  /* 화면 검사용: 미국·국내 기사 여러 개를 정리된 상태로 넣고, 새 기사는 /__add 로 (run_regression 이 '새 뉴스' 알림 확인) */
  const now = clock = realNow();
  Date.now = () => realNow();
  const by = {};   // 원본마다 60건 아래로 나눔 (RSS 한 번에 60건까지 읽음)
  const usK = ['sa', 'invs', 'inve', 'invr'], krK = ['nsis', 'asiae'];
  for (let i = 0; i < 240; i++) {   // 묶음(200)보다 많이 → '지난 뉴스 더 보기' 확인
    const us = i % 3 !== 2, t = now - i * 3 * 60e3, k = us ? usK[i % 4] : krK[i % 2];
    (by[k] = by[k] || []).push(item({ title: us ? `Apple shares ${i % 4 === 0 ? 'falls' : 'rise'} after report ${i}` : `삼성전자 ${i}번째 소식 하락`, link: `https://example.com/${us ? 'us' : 'kr'}/${i}?utm_source=x`, date: rfc(t), desc: us ? `Synthetic summary sentence number ${i} for layout tests only.` : '본문 요약' }));
  }
  for (const k in by) FEEDS[FU[k]] = { body: rss(by[k]) };
  FEEDS[FU.fed] = { body: rss([item({ title: 'Fed holds rates steady', link: 'https://example.com/fed/1', date: rfc(now - 3 * 60e3), desc: 'Synthetic policy statement summary.' })]) };
  for (let k = 0; k < 80 && db.prepare('SELECT COUNT(*) AS c FROM news WHERE st = 0').get().c + (k ? 0 : 1) > 0; k++) await N.newsTick(env, Date.now(), { feeds: 30 });
  let addN = 0;
  const srv = http.createServer(async (rq, rs) => {
    if (rq.url.startsWith('/__add')) {   // 새 기사 하나 (정리까지)
      addN++;
      FEEDS[FU.sa] = { body: rss([item({ title: `Breaking: Apple test news ${addN}`, link: `https://example.com/new/${addN}`, date: rfc(Date.now() - 1000), desc: 'New synthetic item.' })]) };
      db.prepare("UPDATE news_feed SET next = 0, wm = 0 WHERE k = 'sa'").run();
      const r = await N.newsTick(env, Date.now(), { feeds: 30 });
      rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(r)); return;
    }
    const h = new Headers(); for (const [k, v] of Object.entries(rq.headers)) if (typeof v === 'string') h.set(k, v);
    try {
      const r = await worker.fetch(new Request('https://w' + rq.url, { method: rq.method, headers: h }), env, {});
      const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
      rs.writeHead(r.status, out); rs.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { rs.writeHead(500); rs.end(String(e && e.stack || e)); }
  });
  srv.listen(Number(process.argv[3]) || 0, '127.0.0.1', () => { console.log(JSON.stringify({ port: srv.address().port })); });
} else {
  let fails = 0, oks = 0;
  const ok = (c, m, i) => { if (c) oks++; else { fails++; console.log('FAIL', m, JSON.stringify(i)); } };
  const rows = (sql, ...a) => db.prepare(sql).all(...a).map(plain);
  const get = async (p, origin = SITE) => {
    const r = await worker.fetch(new Request('https://w' + p, { headers: origin ? { Origin: origin } : {} }), env, {});
    let j = null; try { j = await r.json(); } catch (e) {}
    return { s: r.status, j: j || {}, h: r.headers };
  };
  const min = (n) => { clock += n * 60e3; };

  // ── 1. 글자·날짜·주소
  ok(N.parseDate('Sat, 24 Oct 2026 17:20:43 +0900') === Date.UTC(2026, 9, 24, 8, 20, 43), 'RFC 822 (+0900)');
  ok(N.parseDate('Sat,24 Oct 2026 08:00:00 +0900') === Date.UTC(2026, 9, 23, 23, 0, 0), '쉼표 뒤 공백 없음');
  ok(N.parseDate('<![CDATA[Fri, 16 Oct 2026 15:00:00 GMT]]>') === Date.UTC(2026, 9, 16, 15), 'CDATA 안 날짜');
  ok(N.parseDate('2026-10-24 09:24:17', 'Z') === Date.UTC(2026, 9, 24, 9, 24, 17) && N.parseDate('2026-10-24 17:52:00', '+09:00') === Date.UTC(2026, 9, 24, 8, 52), "'YYYY-MM-DD HH:MM:SS' + 원본 시간대");
  ok(N.parseDate('2026-10-24T09:00:00-04:00') === Date.UTC(2026, 9, 24, 13) && N.parseDate('20250921161916+0900') === Date.UTC(2025, 8, 21, 7, 19, 16), 'ISO · 숫자만 형식');
  ok(Number.isNaN(N.parseDate('')) && Number.isNaN(N.parseDate('어제')), '날짜 없음·이상 → NaN');
  ok(N.plain('<![CDATA[Apple&#x2019;s &amp;lt;b&amp;gt;rally&amp;lt;/b&amp;gt; &quot;big&quot;&nbsp;day]]>') === 'Apple’s rally "big" day', 'CDATA·글자 참조·이중 인코딩 태그 빼기', N.plain('<![CDATA[Apple&#x2019;s &amp;lt;b&amp;gt;rally&amp;lt;/b&amp;gt; &quot;big&quot;&nbsp;day]]>'));
  ok(N.cleanUrl('https://seekingalpha.com/news/1-x?utm_source=feed&utm_medium=r&feed_item_type=news') === 'https://seekingalpha.com/news/1-x' && N.cleanUrl('http://www.edaily.co.kr/news/newspath.asp?newsid=021&mod=x') === 'http://www.edaily.co.kr/news/newspath.asp?newsid=021'
    && N.cleanUrl('javascript:alert(1)') === '' && N.cleanUrl('<![CDATA[https://a.com/x?time=1#y]]>') === 'https://a.com/x', '주소: 추적 꼬리만 빼기 · http(s) 만');
  ok(N.normTitle('[속보] Apple, 실적 발표!') === N.normTitle('apple 실적발표') , '같은 기사 제목 비교(꺾쇠 머리말·기호·대소문자 무시)');
  const px = N.parseFeed(rss([
    item({ title: '<![CDATA[Apple &amp; Nvidia rally]]>', link: '<![CDATA[https://x.com/a?utm_source=rss]]>', date: 'Mon, 26 Oct 2026 12:00:00 GMT', desc: '<![CDATA[<p>Shares rose <b>3%</b>.</p><p>The post <a href="x">Apple</a> appeared first on Benzinga. Visit Benzinga</p>]]>',
      more: '<category domain="https://seekingalpha.com/symbol/AAPL">aapl</category><category domain="https://seekingalpha.com/symbol/CL1:COM">x</category><nasdaq:tickers>NVDA,NVDA</nasdaq:tickers>' }),
    item({ title: 'No link', link: '', date: 'Mon, 26 Oct 2026 12:00:00 GMT' }),
    item({ title: 'Same as desc', link: 'https://x.com/b', desc: 'Same as desc' }),
  ]), { p: 'full' });
  ok(px.length === 2 && px[0].t0 === 'Apple & Nvidia rally' && px[0].url === 'https://x.com/a' && px[0].d0 === 'Shares rose 3% .' && px[0].hint === 'NVDA,AAPL' && Number.isNaN(px[1].ts) && px[1].d0 === '',
    'RSS 읽기: CDATA·광고 문구 빼기·종목 힌트(SA 분류·나스닥)·주소 없는 기사 빼기·제목과 같은 요약문 빼기', px);
  const atom = N.parseFeed('<feed><entry><title>Atom title</title><link rel="alternate" href="https://a.com/e1?mod=rss"/><updated>2026-10-26T12:00:00Z</updated><summary>Sum text here ok</summary></entry></feed>', { p: 'full' });
  ok(atom.length === 1 && atom[0].url === 'https://a.com/e1' && atom[0].ts === Date.UTC(2026, 9, 26, 12) && atom[0].d0 === 'Sum text here ok', 'Atom 읽기', atom);
  ok(N.parseFeed(rss([item({ title: '제목', link: 'https://k.com/1', date: rfc(clock), desc: '국내 요약문은 쓰지 않음' })]), { p: 'tag' })[0].d0 === '', "'tag'(국내 언론)는 요약문을 저장하지 않음");

  // ── 2. 1분 수집
  const T = clock;
  FEEDS[FU.sa] = { etag: 'e1', body: rss([
    item({ title: 'Apple beats estimates', link: 'https://sa.com/1?utm_source=feed', date: rfc(T - 5 * 60e3), desc: 'Apple reported revenue above estimates.' }),
    item({ title: 'Old news', link: 'https://sa.com/old', date: rfc(T - 50 * 3600e3), desc: 'old' }),
    item({ title: 'No date item', link: 'https://sa.com/nodate', desc: 'x' }),
    item({ title: 'Future item', link: 'https://sa.com/future', date: rfc(T + 3 * 3600e3), desc: 'future one' }),
    item({ title: 'Big coupon deals today', link: 'https://sa.com/coupon', date: rfc(T - 2 * 60e3), desc: 'Shopping deals.' }),
  ]) };
  FEEDS[FU.invs] = { body: rss([item({ title: 'Apple beats estimates', link: 'https://inv.com/apple', date: '2026-10-26 13:20:00', desc: 'Same story elsewhere.' }),
    item({ title: 'Fed signals pause', link: 'https://inv.com/fed', date: '2026-10-26 13:10:00', desc: 'Policy makers signaled a pause.' })]) };
  FEEDS[FU.nsis] = { body: rss([item({ title: '삼성전자 3분기 실적 발표', link: 'https://hk.com/1', date: rfc(T - 9 * 60e3) }), item({ title: '쿠폰 행사 안내', link: 'https://hk.com/2', date: rfc(T - 8 * 60e3) })]) };
  FEEDS[FU.ynm] = { body: rss([item({ title: '코스피 하락 마감', link: 'https://yna.co.kr/view/1', date: rfc(T - 4 * 60e3), desc: '연합뉴스 요약문 (쓰면 안 됨)' })], '<copyright>AI 학습 및 활용 금지</copyright>') };
  FEEDS[FU.cnbc] = { status: 403, body: 'blocked' };
  FEEDS[FU.wsj] = { throw: 'network down' };
  let res = await N.newsTick(env, clock, { feeds: 40, noAi: true });
  let all = rows('SELECT * FROM news ORDER BY ts DESC');
  ok(all.length === 7, '처음 수집: 48시간 안·주소 있는 기사만 · 처음 원본의 날짜 없는 기사 뺌 · 같은 제목 하루 한 번', all.map((r) => r.t0));
  ok(!all.some((r) => r.t0 === 'Old news' || r.t0 === 'No date item'), '오래된 기사·날짜 없는 기사(처음) 없음');
  const fut = all.find((r) => r.t0 === 'Future item');
  ok(fut && fut.ts === clock, '미래 시각 → 받은 시각', fut);
  ok(all.filter((r) => r.t0 === 'Apple beats estimates').length === 1, '다른 원본의 같은 기사(같은 날 같은 제목) → 한 번만');
  const yn = all.find((r) => r.src === 'ynm');
  ok(yn && yn.st === 2 && yn.d0 === null && yn.t === null, "연합뉴스('none'): AI 없이 원문 제목 그대로 · 요약문 저장 안 함", yn);
  ok(all.filter((r) => r.src !== 'ynm').every((r) => r.st === 0), '나머지는 AI 정리 대기(st 0)');
  let fd = Object.fromEntries(rows('SELECT * FROM news_feed').map((r) => [r.k, r]));
  ok(fd.sa.ok === clock && fd.sa.next > clock && fd.sa.etag === 'e1' && fd.cnbc.err === 'HTTP 403' && fd.cnbc.fails === 1 && /network down/.test(fd.wsj.err), '원본 상태: 성공·ETag · 403 · 네트워크 오류 기록', [fd.sa, fd.cnbc, fd.wsj]);
  const n0 = all.length;
  // 다시: 304 · 같은 기사 두 번 안 넣음 · 실패한 원본은 점점 드물게
  min(1); fetchLog = [];
  res = await N.newsTick(env, clock, { feeds: 40, noAi: true });
  ok(fetchLog.includes(FU.sa) && !fetchLog.includes(FU.cnbc) && !fetchLog.includes(FU.invs), '1분 뒤: 1분 원본(SA)만 · 실패 원본은 2분 뒤 · 2분 원본은 아직', fetchLog);
  ok(rows('SELECT COUNT(*) AS c FROM news')[0].c === n0 && /sa:304/.test(res.fetched.join()), 'ETag 같음 → 304 · 새 기사 없음', res);
  for (let i = 0; i < 6; i++) { min(1); await N.newsTick(env, clock, { feeds: 40, noAi: true }); }
  fd = Object.fromEntries(rows('SELECT * FROM news_feed').map((r) => [r.k, r]));
  ok(fd.cnbc.fails >= 2 && fd.cnbc.next - fd.cnbc.last >= 4 * 60e3 - 5e3, '계속 실패 → 다음 시도 간격이 늘어남(2·4·8…분, 최대 1시간)', fd.cnbc);
  // 한 번에 최대 FEEDS_PER_TICK 개
  db.exec('UPDATE news_feed SET next = 0'); fetchLog = [];
  await N.newsTick(env, clock, { noAi: true });
  ok(fetchLog.length === N.FEEDS_PER_TICK, `한 번(1분)에 RSS 최대 ${N.FEEDS_PER_TICK}개 (무료 플랜 CPU·하위 요청)`, fetchLog.length);
  // 새 기사 하나 추가 → 들어감 · 2시간 넘게 지난 늦은 기사는 무시(이미 본 원본)
  FEEDS[FU.sa] = { body: rss([item({ title: 'Apple falls on China news', link: 'https://sa.com/3', date: rfc(clock - 60e3), desc: 'Shares fell after a report.' }), item({ title: 'Late old', link: 'https://sa.com/late', date: rfc(clock - 5 * 3600e3), desc: 'late' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'");
  res = await N.newsTick(env, clock, { feeds: 1, noAi: true });
  ok(res.added === 1 && rows("SELECT * FROM news WHERE url = 'https://sa.com/3'").length === 1 && !rows("SELECT * FROM news WHERE url = 'https://sa.com/late'").length, '새 기사 1건 · 지난번 가장 새 기사보다 2시간 넘게 이른 기사는 무시', res);

  // ── 3. AI 정리
  min(1);
  let a = await N.newsTick(env, clock, { feeds: 0 });
  all = Object.fromEntries(rows('SELECT * FROM news').map((r) => [r.t0, r]));
  const ap = all['Apple beats estimates'];
  ok(ap.st === 1 && ap.t === '한국어 제목: Apple beats estimate' && ap.s && ap.s.startsWith('요약: ') && ap.tk === 'AAPL,NVDA,TSLA,MSFT,AMZN' && ap.imp === 1 && ap.sen === 0,
    "AI 정리(full): 한국어 제목·요약 · 종목(대문자·$ 빼기·이상한 값 빼기·최대 5) · 중요도 범위 밖 → 1", ap);
  const sm = all['삼성전자 3분기 실적 발표'];
  ok(sm.st === 1 && sm.t === null && sm.s === null && sm.tk === '삼성전자', "국내('tag'): AI 가 제목·요약을 써도 버리고 종목만", sm);
  ok(all['Big coupon deals today'].st === 3 && all['쿠폰 행사 안내'].st === 3, "투자와 무관(rel false) → 숨김(st 3)");
  ok(aiCalls.length === 1 && JSON.parse(aiCalls[0].inp.messages[1].content).length === 6 && !aiCalls[0].inp.messages[1].content.includes('연합뉴스 요약문'), `AI 한 번에 6건 · 연합뉴스는 AI 에 보내지 않음`, aiCalls.length);
  const sent = JSON.parse(aiCalls[0].inp.messages[1].content);
  ok(sent.every((x) => x.mode === 'tag' ? !('d' in x) : true) && sent.find((x) => x.title === 'Apple falls on China news').d === 'Shares fell after a report.', "AI 에 보내는 것: full = 제목+RSS 요약문 · tag = 제목만");
  const used = rows("SELECT v FROM news_kv WHERE k LIKE 'ai:2026%'")[0];
  ok(used && Math.abs(Number(used.v) - (900 * 9091 + 600 * 27273) / 1e6) < 0.2, 'AI 사용량(뉴런) = 모델 가격표 × 토큰', used);
  // 남은 1건(Fed signals pause)은 다음 분에
  min(1); aiCalls = []; aiMode = 'think';
  await N.newsTick(env, clock, { feeds: 0 });
  ok(rows("SELECT st FROM news WHERE t0 = 'Fed signals pause'")[0].st === 1 && rows("SELECT imp FROM news WHERE t0 = 'Fed signals pause'")[0].imp === 3, '생각 태그·코드블록이 섞인 답도 JSON 만 꺼냄 · 중요도 3');
  ok(N.aiParse('앞말 [{"i":1,"t":"a"}] 뒷말')[0].t === 'a' && N.aiParse('{"items":[{"i":2}]}')[0].i === 2 && N.aiParse('없음') === null, 'AI 답 꺼내기(앞뒤 말 · {items})');
  ok(N.aiText({ choices: [{ message: { content: 'x' } }] }) === 'x' && N.aiText({ response: { a: 1 } }) === '{"a":1}' && N.aiText('s') === 's', 'AI 답 형식 여러 가지');
  // 이상한 답 3번 → 원문 그대로(st 2)
  FEEDS[FU.sa] = { body: rss([item({ title: 'Junk test item', link: 'https://sa.com/j', date: rfc(clock), desc: 'Junk.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'");
  aiMode = 'junk';
  for (let i = 0; i < 4; i++) { min(1); await N.newsTick(env, clock, { feeds: i ? 0 : 1 }); }
  const jk = rows("SELECT * FROM news WHERE t0 = 'Junk test item'")[0];
  ok(jk.st === 2 && jk.tries >= 3, '이상한 답 3번 → 원문 그대로 보여 줌', jk);
  ok(rows("SELECT v FROM news_kv WHERE k = 'ai:err'")[0].v.startsWith('parse:'), '마지막 AI 오류 기록');
  // 첫 모델 실패 → 다음 모델 · 기억
  FEEDS[FU.sa] = { body: rss([item({ title: 'Model switch item', link: 'https://sa.com/m', date: rfc(clock), desc: 'Switch.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'"); aiMode = 'throw-first'; aiCalls = [];
  min(1); await N.newsTick(env, clock, { feeds: 1 });
  ok(rows("SELECT st FROM news WHERE t0 = 'Model switch item'")[0].st === 1 && aiCalls.map((c) => c.model).join() === N.AI_MODELS[0][0] + ',' + N.AI_MODELS[1][0]
    && rows("SELECT v FROM news_kv WHERE k='ai:model'")[0].v === N.AI_MODELS[1][0] && aiCalls[1].inp.messages[1].content.startsWith('/no_think'), '첫 모델 실패 → 다음 모델(qwen3 은 생각 끔) · 그 모델을 기억', aiCalls.map((c) => c.model));
  FEEDS[FU.sa] = { body: rss([item({ title: 'Model remembered', link: 'https://sa.com/m2', date: rfc(clock), desc: 'Remember.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'"); aiCalls = [];
  min(1); await N.newsTick(env, clock, { feeds: 1 });
  ok(aiCalls.length === 1 && aiCalls[0].model === N.AI_MODELS[1][0], '다음 번엔 기억한 모델부터', aiCalls.map((c) => c.model));
  // 하루 한도
  FEEDS[FU.sa] = { body: rss([item({ title: 'Quota item', link: 'https://sa.com/q', date: rfc(clock), desc: 'Quota.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'"); aiMode = 'quota';
  min(1); await N.newsTick(env, clock, { feeds: 1 });
  const day = iso(clock).slice(0, 10);
  ok(rows("SELECT v FROM news_kv WHERE k='ai:block'")[0].v === day && rows("SELECT st FROM news WHERE t0='Quota item'")[0].st === 0, '무료 한도 다 씀(4006) → 오늘은 AI 멈춤 · 기사는 잠시 대기');
  aiCalls = []; aiMode = 'ok';
  for (let i = 0; i < 11; i++) { min(1); await N.newsTick(env, clock, { feeds: 0 }); }
  ok(aiCalls.length === 0 && rows("SELECT st FROM news WHERE t0='Quota item'")[0].st === 2, '한도 막힌 날: AI 부르지 않음 · 10분 넘게 기다린 기사는 원문 그대로', aiCalls.length);
  // 다음 날(UTC) → 다시 AI
  db.exec("DELETE FROM news_kv WHERE k='ai:block'");
  db.prepare("INSERT OR REPLACE INTO news_kv (k, v, t) VALUES ('ai:' || ?, '9500', ?)").run(day, clock);
  FEEDS[FU.sa] = { body: rss([item({ title: 'Cap item', link: 'https://sa.com/c', date: rfc(clock), desc: 'Cap.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'"); aiCalls = [];
  min(1); await N.newsTick(env, clock, { feeds: 1 });
  ok(aiCalls.length === 0, `오늘 사용량이 상한(${N.AI_DAILY_CAP} 뉴런) 넘으면 AI 부르지 않음`);
  // 한도 60% 넘음 → 해외 기사만 AI · 국내 기사는 10분 뒤 원문 그대로
  db.exec("DELETE FROM news_kv WHERE k LIKE 'ai:2026%'");
  db.prepare("INSERT OR REPLACE INTO news_kv (k, v, t) VALUES ('ai:' || ?, '6000', ?)").run(day, clock);
  FEEDS[FU.sa] = { body: rss([item({ title: 'Saving us item', link: 'https://sa.com/sv', date: rfc(clock), desc: 'Saving.' })]) };
  FEEDS[FU.nsis] = { body: rss([item({ title: '절약 국내 기사', link: 'https://hk.com/sv', date: rfc(clock) })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k IN ('sa','nsis')"); db.exec("UPDATE news SET st = 2 WHERE st = 0"); aiCalls = [];
  min(1); await N.newsTick(env, clock, { feeds: 40 });
  ok(aiCalls.length === 1 && JSON.parse(aiCalls[0].inp.messages[1].content.replace(/^\/no_think\n/, '')).every((x) => x.mode === 'full') && rows("SELECT st FROM news WHERE t0='Saving us item'")[0].st === 1
     && rows("SELECT st FROM news WHERE t0='절약 국내 기사'")[0].st === 0, '한도 60% 넘음 → 해외 기사만 AI', aiCalls.length);
  min(11); await N.newsTick(env, clock, { feeds: 0 });
  ok(rows("SELECT st FROM news WHERE t0='절약 국내 기사'")[0].st === 2, '그때 국내 기사는 10분 뒤 원문 그대로');
  // AI 바인딩 없음
  const env2 = { DB, ALLOWED_ORIGINS: SITE };
  min(3); await N.newsTick(env2, clock, { feeds: 0 });
  ok(rows("SELECT st FROM news WHERE t0='Cap item'")[0].st === 2, 'Workers AI 없음 → 2분 지난 기사는 원문 그대로');

  // ── 4. GET /news
  let r = await get('/news');
  const snap = r.j;
  ok(r.s === 200 && r.h.get('access-control-allow-origin') === SITE && snap.v > 0 && snap.items.length === rows('SELECT COUNT(*) AS c FROM news WHERE st IN (0,1,2)')[0].c, 'GET /news: 최신 묶음 · CORS', [r.s, snap.items && snap.items.length]);
  ok(snap.items.every((x, i, A) => !i || A[i - 1].ts >= x.ts) && !snap.items.some((x) => /coupon|쿠폰/i.test(x.t)), '새 기사부터 · 숨긴 기사 없음');
  const ia = snap.items.find((x) => x.o === 'Apple beats estimates');
  ok(ia && ia.t.startsWith('한국어 제목') && ia.x && ia.k.includes('AAPL') && ia.a === 1 && ia.m === 'us' && ia.s && snap.src[ia.s][0], '기사: 한국어 제목·원문 제목(o)·요약(x)·종목(k)·AI 표시(a=1)·원본 이름', ia);
  const iy = snap.items.find((x) => x.s === 'ynm');
  ok(iy && iy.a === 2 && !iy.x && !iy.o && snap.src.ynm[1] === 'none', '연합뉴스: 원문 제목만 · AI 표시 없음', iy);
  r = await get('/news?after=' + snap.v);
  ok(r.j.same === 1 && !r.j.items, '바뀐 것 없음 → same (작은 응답)', r.j);
  // 새 기사 + 숨김 → 바뀐 것만
  FEEDS[FU.sa] = { body: rss([item({ title: 'Delta Apple item', link: 'https://sa.com/d', date: rfc(clock), desc: 'Delta.' }), item({ title: 'Delta coupon spam', link: 'https://sa.com/d2', date: rfc(clock), desc: 'Spam.' })]) };
  db.exec("UPDATE news_feed SET next = 0 WHERE k = 'sa'");
  min(1); await N.newsTick(env, clock, { feeds: 1, noAi: true });
  r = await get('/news?after=' + snap.v);
  ok(r.j.part === 1 && r.j.items.length === 2 && r.j.items.every((x) => x.a === 0) && r.j.v > snap.v, '새 기사 → 바뀐 것만(정리 전 a=0)', r.j);
  const v2 = r.j.v;
  db.exec("DELETE FROM news_kv WHERE k LIKE 'ai:2026%'");   // 위 한도 시험의 사용량 지움 (다음 날처럼)
  min(1); await N.newsTick(env, clock, { feeds: 0 });
  r = await get('/news?after=' + v2);
  const spamId = rows("SELECT id FROM news WHERE t0 = 'Delta coupon spam'")[0].id;
  ok(r.j.items.length === 1 && r.j.items[0].a === 1 && r.j.gone.includes(spamId), 'AI 정리 뒤: 정리된 기사 + 숨길 기사 번호(gone)', r.j);
  // 더 보기
  r = await get('/news?before=' + (clock - 6 * 60e3));
  ok(r.j.items.length > 0 && r.j.items.every((x) => x.ts < clock - 6 * 60e3) && r.j.more === false, '더 보기(before): 그보다 오래된 기사', r.j.items.length);
  r = await get('/news?before=' + (clock + 1) + '&m=kr');
  ok(r.j.items.length > 0 && r.j.items.every((x) => x.m === 'kr'), '더 보기 + 나라(m=kr)', r.j.items.map((x) => x.m));
  r = await get('/news/status');
  ok(r.j.feeds.length === N.NEWS_FEEDS.length && r.j.ai === true && r.j.aiCap === N.AI_DAILY_CAP && r.j.feeds.find((f) => f.k === 'cnbc').err === 'HTTP 403', '/news/status: 원본별 상태·AI', r.j.feeds.length);
  r = await worker.fetch(new Request('https://w/news', { method: 'POST' }), env, {});
  ok(r.status === 405, 'POST /news → 405');
  // 묶음 크기·200건
  for (let i = 0; i < 230; i++) db.prepare("INSERT INTO news (id, th, src, mk, ts, seen, u, url, t0, st) VALUES (?, ?, 'sa', 'us', ?, ?, ?, ?, ?, 2)").run('bulk' + i, 'bulkth' + i, clock - 3600e3 - i * 1000, clock, clock + 1, 'https://b.com/' + i, 'Bulk ' + i);
  min(1); await N.newsTick(env, clock, { feeds: 0, noAi: true, forceSnap: true });
  r = await get('/news');
  ok(r.j.items.length === 200 && JSON.stringify(r.j).length < 200 * 900, '묶음은 최신 200건 · 크기', [r.j.items.length, JSON.stringify(r.j).length]);
  // 같은 isolate: 버전이 같으면 큰 묶음을 다시 읽지 않음
  reads = 0; await get('/news'); const rd = reads;
  ok(rd <= 2, '같은 버전 → D1 한 줄(버전)만 읽음', rd);

  // ── 5. cron 연결 (index.js)
  fetchLog = []; db.exec('UPDATE news_feed SET next = 0');
  const wu = []; const ctx = { waitUntil: (p) => wu.push(p) };
  await worker.scheduled({ cron: '* * * * *', scheduledTime: clock }, env, ctx); await Promise.all(wu);
  ok(fetchLog.length === N.FEEDS_PER_TICK, "cron '* * * * *' → 뉴스 수집", fetchLog.length);
  fetchLog = []; wu.length = 0; db.exec('UPDATE news_feed SET next = 0');
  await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: clock }, env, ctx); await Promise.all(wu.map((p) => p.catch(() => 0)));
  ok(!fetchLog.some((u) => N.NEWS_FEEDS.some((f) => f.u === u)), "cron '*/15' → 뉴스 수집 안 함(기존 15분 작업만)", fetchLog);
  // 03:07 KST 정리
  db.prepare("INSERT INTO news (id, th, src, mk, ts, seen, u, url, t0, st) VALUES ('old1','oldth1','sa','us',?,?,?,'https://o.com','Old',2)").run(clock - 91 * 86400e3, clock, clock);
  const c307 = Date.UTC(2026, 9, 26, 18, 7);   // 27일 03:07 KST
  wu.length = 0; await worker.scheduled({ cron: '* * * * *', scheduledTime: c307 }, env, ctx); await Promise.all(wu);
  ok(!rows("SELECT id FROM news WHERE id='old1'").length, '매일 03:07 → 90일 지난 기사 정리');
  // 시간 (CPU 대략): 6개 원본 × 120건
  const big = rss(Array.from({ length: 120 }, (_, i) => item({ title: 'Speed item ' + i + ' &amp; more', link: 'https://s.com/' + i + '?utm_source=a', date: rfc(clock - i * 60e3), desc: '<p>' + 'word '.repeat(60) + '</p>' })));
  for (const k of ['sa', 'invs', 'inve', 'invr', 'invc', 'nq']) FEEDS[FU[k]] = { body: big.replace(/s\.com\//g, k + '.com/') };
  db.exec('UPDATE news_feed SET next = 0, wm = 0');
  const t0 = performance.now(); await N.newsTick(env, clock, { noAi: true }); const ms = performance.now() - t0;
  console.log(`  (참고) 원본 6개 × 120건 처음 수집 ${ms.toFixed(1)}ms — node 기준, 기사 넣기·해시 포함`);
  const n1 = rows('SELECT COUNT(*) AS c FROM news')[0].c;
  const t1 = performance.now(); min(5); db.exec('UPDATE news_feed SET next = 0'); const r2 = await N.newsTick(env, clock, { noAi: true }); const ms2 = performance.now() - t1;
  console.log(`  (참고) 같은 원본 다시(새 기사 없음) ${ms2.toFixed(1)}ms`);
  ok(r2.added === 0 && rows('SELECT COUNT(*) AS c FROM news')[0].c === n1 && n1 > 60, '다시 받을 때는 이미 있는 기사를 거르고 넣지 않음', [r2.added, n1]);

  Date.now = realNow;
  console.log(`worker_news_test: ${oks}개 통과 · ${fails}개 실패`);
  process.exit(fails ? 1 : 0);
}
