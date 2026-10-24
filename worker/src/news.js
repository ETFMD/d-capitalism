/* [NEWS] 디코딩 뉴스 — 미국·국내 주식 투자 뉴스를 1분마다 모아 한국어로 짧게 정리 (사이트 /news/)
 *
 * 흐름 (모두 이 Worker 안 · GitHub Actions 안 거침 → 원문이 올라오고 1~3분 안에 화면에)
 *   1분 cron → newsTick(): 차례가 된 RSS 몇 개(한 번에 최대 FEEDS_PER_TICK)만 받아 새 기사만 D1 news 에 넣음
 *            → AI(Cloudflare Workers AI 바인딩 env.AI · 무료 하루 10,000 뉴런 안)로 새 기사 몇 개씩 한국어 제목·요약·종목·중요도
 *            → 바뀐 것이 있으면 최신 200건 묶음(snap)을 news_kv 한 줄로 다시 만듦
 *   GET /news            → 최신 묶음 (브라우저는 30초마다 ?after=<마지막 u> 로 바뀐 것만)
 *   GET /news?before=ts  → 그보다 오래된 기사 50건(더 보기) · &m=us|kr
 *   GET /news/status     → 원본별 마지막 수집·오류 · AI 사용량 (점검용 · 비밀 없음)
 *
 * 저작권·약관 원칙 (원본마다 p 로 정함 — 화면에도 표시)
 *   · 'full' 해외 기사·보도자료·공공기관: RSS 가 공개한 제목·요약문만 AI 가 한국어로 옮기고 1~2문장으로 정리 + 원문 링크(본문은 받지 않음)
 *   · 'tag'  국내 언론: 제목·링크만 그대로 보여 주고, AI 는 제목으로 관련 종목·중요도만 붙임(요약문을 다시 쓰지 않음)
 *   · 'none' RSS 에 'AI 학습 및 활용 금지'를 밝힌 곳(연합뉴스): AI 를 전혀 쓰지 않고 제목·링크만
 *
 * 무료 플랜 한도: 요청마다 CPU 10ms · 하위 요청 50개 → 한 번에 RSS 최대 6개 + AI 1번 · 글자 처리는 정규식 한 번씩
 *   · workers.dev 에서는 Cache API 가 동작하지 않아 묶음을 D1 한 줄로 두고, 같은 isolate 에서는 메모리에 둠(버전이 같으면 다시 안 읽음)
 */

export const NEWS_FEEDS = [
  // 미국·해외 (영어 → AI 한국어 정리)
  { k: 'sa', n: 'Seeking Alpha', m: 'us', p: 'full', every: 1, u: 'https://seekingalpha.com/market_currents.xml' },
  { k: 'invs', n: 'Investing.com', m: 'us', p: 'full', every: 2, tz: 'Z', u: 'https://www.investing.com/rss/news_25.rss' },
  { k: 'inve', n: 'Investing.com', m: 'us', p: 'full', every: 4, tz: 'Z', u: 'https://www.investing.com/rss/news_14.rss' },
  { k: 'invr', n: 'Investing.com', m: 'us', p: 'full', every: 4, tz: 'Z', u: 'https://www.investing.com/rss/news_1062.rss' },
  { k: 'invc', n: 'Investing.com', m: 'us', p: 'full', every: 6, tz: 'Z', u: 'https://www.investing.com/rss/news_11.rss' },
  { k: 'cnbc', n: 'CNBC', m: 'us', p: 'full', every: 3, u: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
  { k: 'cnbt', n: 'CNBC', m: 'us', p: 'full', every: 4, u: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
  { k: 'cnbe', n: 'CNBC', m: 'us', p: 'full', every: 6, u: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135' },
  { k: 'wsj', n: 'WSJ', m: 'us', p: 'full', every: 4, u: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain' },
  { k: 'nq', n: 'Nasdaq', m: 'us', p: 'full', every: 4, u: 'https://www.nasdaq.com/feed/rssoutbound?category=Markets' },
  { k: 'fox', n: 'Fox Business', m: 'us', p: 'full', every: 6, u: 'https://moxie.foxbusiness.com/google-publisher/markets.xml' },
  { k: 'ilv', n: 'investingLive', m: 'us', p: 'full', every: 3, u: 'https://www.forexlive.com/feed/news' },
  { k: 'prne', n: 'PR Newswire', m: 'us', p: 'full', every: 5, u: 'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss' },
  { k: 'prnm', n: 'PR Newswire', m: 'us', p: 'full', every: 8, u: 'https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss' },
  { k: 'fed', n: '미국 연준', m: 'us', p: 'full', every: 10, u: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  // 국내 (제목 그대로 · AI 는 종목·중요도만)
  { k: 'hk', n: '한국경제', m: 'kr', p: 'tag', every: 3, u: 'https://www.hankyung.com/feed/finance' },
  { k: 'asiae', n: '아시아경제', m: 'kr', p: 'tag', every: 3, u: 'https://www.asiae.co.kr/rss/stock.htm' },
  { k: 'hd', n: '헤럴드경제', m: 'kr', p: 'tag', every: 5, tz: '+09:00', u: 'https://biz.heraldcorp.com/rss/google/finance' },
  { k: 'sed', n: '서울경제', m: 'kr', p: 'tag', every: 5, u: 'https://www.sedaily.com/rss/finance' },
  { k: 'cb', n: '조선비즈', m: 'kr', p: 'tag', every: 5, u: 'https://biz.chosun.com/arc/outboundfeeds/rss/category/stock/?outputType=xml' },
  { k: 'ed', n: '이데일리', m: 'kr', p: 'tag', every: 5, u: 'http://rss.edaily.co.kr/stock_news.xml' },
  { k: 'fn', n: '파이낸셜뉴스', m: 'kr', p: 'tag', every: 6, u: 'https://www.fnnews.com/rss/r20/fn_realnews_stock.xml' },
  { k: 'ynm', n: '연합뉴스', m: 'kr', p: 'none', every: 3, u: 'https://www.yna.co.kr/rss/market.xml' },
  { k: 'yne', n: '연합뉴스', m: 'kr', p: 'none', every: 4, u: 'https://www.yna.co.kr/rss/economy.xml' },
  { k: 'bok', n: '한국은행', m: 'kr', p: 'full', every: 30, u: 'https://www.bok.or.kr/portal/bbs/B0000501/news.rss?menuNo=201264' },
];
const FEED = Object.fromEntries(NEWS_FEEDS.map((f) => [f.k, f]));
export const FEEDS_PER_TICK = 6;          // 한 번(1분)에 받는 RSS 최대 개수 (무료 플랜 CPU·하위 요청) — 원본 주기 합 ≈ 분당 6.6개라 가장 밀린 것부터 (실제 간격은 약 10% 늘어남)
const ITEM_MAX_AGE = 48 * 3600e3;          // 이보다 오래된 기사는 넣지 않음
const KEEP_DAYS = 90;                      // 보관 기간
const SNAP_N = 200;                        // 묶음에 넣는 최신 기사 수
const AI_BATCH = 6;                        // AI 한 번에 정리하는 기사 수
const AI_WINDOW = 24 * 3600e3;             // 이보다 오래 기다린 기사는 AI 없이(원문 그대로) 보여 줌
const AI_TRIES = 3;
export const AI_DAILY_CAP = 9000;          // 하루(UTC) 뉴런 상한 — 무료 10,000 안에서 여유
/* Workers AI 모델 (앞에서부터 시도 · 실패하면 다음) — 값: [입력·출력 100만 토큰당 뉴런] (Cloudflare 가격표) */
export const AI_MODELS = [
  ['@cf/google/gemma-4-26b-a4b-it', 9091, 27273],
  ['@cf/qwen/qwen3-30b-a3b-fp8', 4625, 30475],
  ['@cf/meta/llama-3.1-8b-instruct-fp8-fast', 4119, 34868],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* ── 표 (처음 부를 때 만듦 · schema.sql 에도 같은 문) ── */
export const NEWS_SQL = [
  'CREATE TABLE IF NOT EXISTS news (id TEXT PRIMARY KEY, th TEXT NOT NULL, src TEXT NOT NULL, mk TEXT NOT NULL, ts INTEGER NOT NULL, seen INTEGER NOT NULL, u INTEGER NOT NULL, url TEXT NOT NULL, t0 TEXT NOT NULL, d0 TEXT, hint TEXT, t TEXT, s TEXT, tk TEXT, imp INTEGER, sen INTEGER, st INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0)',
  'CREATE UNIQUE INDEX IF NOT EXISTS news_th ON news (th)',
  'CREATE INDEX IF NOT EXISTS news_ts ON news (ts)',
  'CREATE INDEX IF NOT EXISTS news_st ON news (st, ts)',
  'CREATE TABLE IF NOT EXISTS news_feed (k TEXT PRIMARY KEY, next INTEGER NOT NULL DEFAULT 0, etag TEXT, lm TEXT, last INTEGER, ok INTEGER, err TEXT, n INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0, wm INTEGER)',
  'CREATE TABLE IF NOT EXISTS news_kv (k TEXT PRIMARY KEY, v TEXT, t INTEGER)',
];
let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.batch(NEWS_SQL.map((q) => env.DB.prepare(q)));
  ready = true;
}

/* ── 글자 처리 ── */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·' };
export function decodeEnt(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
const unCdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
export function plain(s) {
  // CDATA 풀기 → 태그 빼기 → 글자 참조 풀기(한 번 더: &amp;lt; 같은 이중 인코딩) → 공백 하나로
  let t = unCdata(s).replace(/<[^>]*>/g, ' ');
  t = decodeEnt(t);
  if (/&(#x?[0-9a-f]+|[a-z]+);/i.test(t)) t = decodeEnt(t.replace(/<[^>]*>/g, ' '));
  return t.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
const TAGRE = new Map();
function tag(x, name) {
  let re = TAGRE.get(name);
  if (!re) { re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'); TAGRE.set(name, re); }
  const m = x.match(re);
  return m ? m[1] : '';
}
/* 날짜: RFC 822(쉼표 뒤 공백 없음도) · ISO · 'YYYY-MM-DD HH:MM:SS'(원본 tz) */
export function parseDate(s, tz) {
  s = plain(s);
  if (!s) return NaN;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}${m[8] ? (m[8] === 'Z' ? 'Z' : m[8].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : (tz || 'Z')}`);
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);   // 20250921161916+0900
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? m[7].slice(0, 3) + ':' + m[7].slice(3) : (tz || 'Z')}`);
  s = s.replace(/,(\S)/, ', $1').replace(/\bKST\b/, '+0900');
  const t = Date.parse(s);
  return t;
}
/* 주소 정리: 추적용 꼬리(utm_*, mod, time …)만 빼고 그대로 — 같은 기사 두 번 막기 */
export function cleanUrl(u) {
  u = plain(u);
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|mod$|time$|feed_item_type$|cmpid$|__source$|source$|ref$)/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString();
  } catch (e) { return ''; }
}
const BOILER = [/The post .{0,300}? appeared first on .{0,80}?\.?(\s*Visit .*)?$/i, /\s*Continue reading.*$/i, /\s*Read more.*$/i, /\s*\(?Reuters\)?\s*-\s*/];
/* RSS·Atom → [{url, t0, d0, ts, hint}] · since: 그보다 이른 날짜의 기사는 읽지 않음(다시 받을 때 CPU 아끼기) */
export function parseFeed(xml, feed, since = 0) {
  const out = [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  for (const x of blocks.slice(0, 60)) {
    const ts = parseDate(tag(x, 'pubDate') || tag(x, 'dc:date') || tag(x, 'published') || tag(x, 'updated'), feed.tz);
    if (since && Number.isFinite(ts) && ts < since) continue;
    const t0 = plain(tag(x, 'title')).slice(0, 300);
    let link = plain(tag(x, 'link'));
    if (!link) { const m = x.match(/<link\b[^>]*href="([^"]+)"/i); link = m ? decodeEnt(m[1]) : ''; }
    if (!link) { const g = x.match(/<guid[^>]*isPermaLink="true"[^>]*>([\s\S]*?)<\/guid>/i) || x.match(/<guid[^>]*>(https?:[\s\S]*?)<\/guid>/i); link = g ? plain(g[1]) : ''; }
    const url = cleanUrl(link);
    if (!t0 || !url) continue;
    let d0 = '';
    if (feed.p === 'full') {
      d0 = plain(tag(x, 'description') || tag(x, 'summary') || '');
      for (const re of BOILER) d0 = d0.replace(re, ' ').trim();
      if (d0 && (d0 === t0 || t0.startsWith(d0) || d0.length < 12)) d0 = '';
      d0 = d0.slice(0, 600);
    }
    const hint = [];
    const nt = plain(tag(x, 'nasdaq:tickers'));
    if (nt) hint.push(...nt.split(/[,\s]+/));
    for (const m of x.matchAll(/<category[^>]*domain="https:\/\/seekingalpha\.com\/symbol\/([A-Z0-9.\-]{1,10})"/g)) hint.push(m[1]);
    const tks = [...new Set(hint.map((s) => s.toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))].slice(0, 8);
    out.push({ url, t0, d0, ts: Number.isFinite(ts) ? ts : NaN, hint: tks.join(',') });
  }
  return out;
}
/* 짧은 해시 16자리 (32비트 두 개 — 같은 기사 판단용 · 암호용 아님) — WebCrypto 는 기사마다 비동기라 무료 플랜 CPU 를 많이 씀 */
export function h16(s) {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  a ^= s.length; b = Math.imul(b ^ (b >>> 13), 0xc2b2ae35) ^ a;
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
/* 같은 기사 판단용 제목: 글자·숫자만(대소문자 무시) — 원본이 달라도 제목이 같으면 한 번만 */
export const normTitle = (t) => String(t).toLowerCase().replace(/\[[^\]]{0,20}\]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

/* ── RSS 받기 ── */
async function fetchFeed(env, f, st, now) {
  const since = st && st.wm ? st.wm - 2 * 3600e3 : now - ITEM_MAX_AGE;
  const headers = { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5', 'Accept-Language': f.m === 'kr' ? 'ko-KR,ko;q=0.9' : 'en-US,en;q=0.9' };
  if (st && st.etag) headers['If-None-Match'] = st.etag;
  if (st && st.lm) headers['If-Modified-Since'] = st.lm;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 9000);
  try {
    const r = await fetch(f.u, { headers, signal: ac.signal, redirect: 'follow', cf: { cacheTtl: 0 } });
    if (r.status === 304) return { status: 304, items: [], etag: st.etag, lm: st.lm };
    if (!r.ok) return { status: r.status, err: 'HTTP ' + r.status };
    const xml = (await r.text()).slice(0, 1_500_000);
    return { status: 200, items: parseFeed(xml, f, since), etag: r.headers.get('ETag') || '', lm: r.headers.get('Last-Modified') || '' };
  } catch (e) {
    return { status: 0, err: String(e && e.message || e).slice(0, 120) };
  } finally { clearTimeout(to); }
}

/* ── 1분 cron ── */
export async function newsTick(env, now = Date.now(), opts = {}) {
  await ensure(env);
  const res = { fetched: [], added: 0, ai: 0, snap: false };
  const rows = (await env.DB.prepare('SELECT k, next, etag, lm, n, fails, wm FROM news_feed').all()).results || [];
  const S = Object.fromEntries(rows.map((r) => [r.k, r]));
  const due = NEWS_FEEDS.filter((f) => !S[f.k] || S[f.k].next <= now)
    .sort((a, b) => ((S[a.k] && S[a.k].next) || 0) - ((S[b.k] && S[b.k].next) || 0) || a.every - b.every)
    .slice(0, opts.feeds || FEEDS_PER_TICK);
  const got = await Promise.all(due.map((f) => fetchFeed(env, f, S[f.k], now)));
  /* 새 기사 후보: 원본마다 '지난번 가장 새 기사 시각 − 2시간' 이후만(늦게 올라온 기사 여유) → 그 주소들 중 D1 에 없는 것만 넣음 */
  const cand = [];
  const feedSt = [];
  for (let i = 0; i < due.length; i++) {
    const f = due[i], g = got[i], st = S[f.k] || { n: 0, fails: 0 };
    const first = !st.n;   // 처음 받는 원본: 날짜 없는 기사는 넣지 않음(옛 기사가 '방금'으로 보이지 않게)
    let wm = st.wm || 0;
    if (g.status === 200) {
      for (const it of g.items) {
        let ts = it.ts;
        if (!Number.isFinite(ts)) { if (first) continue; ts = now; }
        if (ts > now + 5 * 60e3) ts = now;              // 미래 시각(원본 시간대 오류) → 받은 시각
        if (ts < now - ITEM_MAX_AGE || ts < (st.wm || 0) - 2 * 3600e3) continue;
        wm = Math.max(wm, ts);
        cand.push({ f, it, ts: Math.round(ts) });
      }
    }
    const ok = g.status === 200 || g.status === 304;
    const fails = ok ? 0 : (st.fails || 0) + 1;
    const wait = ok ? f.every * 60e3 : Math.min(60, f.every * 2 ** Math.min(fails, 5)) * 60e3;   // 실패하면 점점 드물게(최대 1시간)
    feedSt.push(env.DB.prepare('INSERT INTO news_feed (k, next, etag, lm, last, ok, err, n, fails, wm) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(k) DO UPDATE SET next=excluded.next, etag=excluded.etag, lm=excluded.lm, last=excluded.last, ok=COALESCE(excluded.ok, news_feed.ok), err=excluded.err, n=news_feed.n+excluded.n, fails=excluded.fails, wm=excluded.wm')
      .bind(f.k, now + wait - 5e3, ok ? (g.etag || null) : (st.etag || null), ok ? (g.lm || null) : (st.lm || null), now, ok ? now : null, ok ? null : (g.err || 'HTTP ' + g.status), ok ? 1 : 0, fails, wm || null));
    res.fetched.push(f.k + ':' + (g.status || 'ERR') + (g.items ? '/' + g.items.length : ''));
  }
  const ins = [];
  if (cand.length) {
    for (const c of cand) { c.id = h16(c.it.url); c.th = h16((normTitle(c.it.t0) || c.it.url) + '|' + new Date(c.ts).toISOString().slice(0, 10)); }   // 같은 날 같은 제목 = 같은 기사 (매일 같은 제목의 정기 기사는 날마다 따로)
    const have = new Set();
    for (let i = 0; i < cand.length; i += 45) {   // D1 바인드 100개 한도 (번호·제목 해시 두 개씩 = 90)
      const part = cand.slice(i, i + 45);
      const r = await env.DB.prepare(`SELECT id, th FROM news WHERE id IN (${part.map(() => '?').join(',')}) OR th IN (${part.map(() => '?').join(',')})`)
        .bind(...part.map((c) => c.id), ...part.map((c) => c.th)).all();
      for (const x of r.results || []) { have.add(x.id); have.add('t' + x.th); }
    }
    for (const c of cand) {
      if (have.has(c.id) || have.has('t' + c.th)) continue;
      have.add(c.id); have.add('t' + c.th);           // 같은 번에 두 원본이 같은 기사 → 한 번만
      const f = c.f, it = c.it;
      ins.push(env.DB.prepare('INSERT OR IGNORE INTO news (id, th, src, mk, ts, seen, u, url, t0, d0, hint, tk, st) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(c.id, c.th, f.k, f.m, c.ts, now, now, it.url, it.t0, it.d0 || null, it.hint || null, f.p === 'none' ? (it.hint || null) : null, f.p === 'none' ? 2 : 0));
    }
  }
  if (ins.length || feedSt.length) {
    const out = await env.DB.batch([...ins, ...feedSt]);
    for (let i = 0; i < ins.length; i++) if (out[i] && out[i].meta && out[i].meta.changes > 0) res.added++;
  }
  let changed = res.added > 0;
  if (!opts.noAi) {
    const a = await aiStep(env, now);
    res.ai = a.n; res.aiInfo = a.info;
    if (a.n) changed = true;
  }
  if (changed || opts.forceSnap || !(await env.DB.prepare("SELECT 1 AS x FROM news_kv WHERE k='snap'").first())) {
    await buildSnap(env, now); res.snap = true;
  }
  return res;
}

/* ── AI 정리 ── */
const SYS = `너는 한국 개인 투자자를 위한 금융 뉴스 편집자다. 받은 기사 목록을 한국어로 정리해 JSON 배열만 출력한다(설명·코드블록 없이).
각 기사마다 {"i":번호,"t":"한국어 제목","s":"요약","k":["종목"],"imp":중요도,"sen":방향,"rel":true/false} 를 만든다.
규칙:
- t: 원문 제목을 자연스러운 한국어로 옮긴 제목(45자 안팎). 숫자·회사명·티커는 그대로 살리고, 과장·추측을 더하지 않는다. mode 가 "tag" 이면 t 는 "" (원문 제목을 그대로 쓴다).
- s: mode 가 "full" 이고 원문 요약문(d)이 있을 때만, d 와 제목에 있는 사실만으로 1~2문장(110자 이하) 한국어 요약. 원문에 없는 수치·원인·전망을 지어내지 않는다. d 가 없거나 mode 가 "tag" 면 "".
- k: 기사가 직접 다루는 상장 종목·ETF 최대 5개. 미국은 대문자 티커(Apple→AAPL, 엔비디아→NVDA), 한국은 종목명(삼성전자). 확실하지 않으면 넣지 않는다. 지수·원자재·코인만 다루면 [].
- imp: 3 = 시장 전체를 움직일 뉴스(연준·한국은행 금리 결정, 물가·고용 지표 발표, 지수 급등락, 초대형주 실적·전쟁 등 큰 사건), 2 = 개별 대형주·업종에 중요한 뉴스(실적, 인수합병, 규제, 가이던스), 1 = 그 밖.
- sen: 관련 종목·시장 기준 1 = 호재, -1 = 악재, 0 = 중립·알 수 없음.
- rel: 주식·채권·환율·금리·원자재·경제지표·기업·중앙은행 등 투자와 관련 있으면 true, 생활 정보·광고성 글·투자와 무관한 사건이면 false.`;

function neurons(model, usage, inChars, outChars) {
  const m = AI_MODELS.find((x) => x[0] === model) || AI_MODELS[0];
  const pi = usage && Number(usage.prompt_tokens) > 0 ? Number(usage.prompt_tokens) : inChars / 2.2;
  const po = usage && Number(usage.completion_tokens) > 0 ? Number(usage.completion_tokens) : outChars / 1.6;
  return (pi * m[1] + po * m[2]) / 1e6;
}
export function aiText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  const c = r.choices && r.choices[0];
  if (c && c.message && typeof c.message.content === 'string') return c.message.content;
  if (c && typeof c.text === 'string') return c.text;
  if (typeof r.result === 'object') return aiText(r.result);
  return '';
}
/* 모델 답에서 JSON 배열 꺼내기 (생각 태그·코드블록·앞뒤 말 무시) */
export function aiParse(txt) {
  let s = String(txt || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) {
    const o = s.indexOf('{'), p = s.lastIndexOf('}');
    if (o >= 0 && p > o) { try { const v = JSON.parse(s.slice(o, p + 1)); if (Array.isArray(v.items)) return v.items; if (v && v.i != null) return [v]; } catch (e) {} }
    return null;
  }
  try { const v = JSON.parse(s.slice(a, b + 1)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export function aiClean(o, mode) {
  const t = mode === 'full' ? clip(o && o.t, 90) : '';
  const s = mode === 'full' ? clip(o && o.s, 220) : '';
  let k = Array.isArray(o && o.k) ? o.k : (typeof (o && o.k) === 'string' ? o.k.split(/[,\s]+/) : []);
  k = [...new Set(k.map((x) => String(x).trim().replace(/^\$/, '')).filter((x) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(x) || /^[가-힣A-Za-z0-9&.\-·]{2,20}$/.test(x)).map((x) => (/^[a-z.\-]+$/i.test(x) && x.length <= 6 ? x.toUpperCase() : x)))].slice(0, 5);
  const imp = [1, 2, 3].includes(Number(o && o.imp)) ? Number(o.imp) : 1;
  const sen = [-1, 0, 1].includes(Number(o && o.sen)) ? Number(o.sen) : 0;
  const rel = !(o && (o.rel === false || o.rel === 'false'));
  return { t, s, k, imp, sen, rel };
}
async function kvGet(env, k) { const r = await env.DB.prepare('SELECT v, t FROM news_kv WHERE k = ?').bind(k).first(); return r || null; }
const kvPut = (env, k, v, t) => env.DB.prepare('INSERT INTO news_kv (k, v, t) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, t=excluded.t').bind(k, v, t);

async function aiStep(env, now) {
  const info = {};
  if (!env.AI || typeof env.AI.run !== 'function') {
    // AI 를 쓸 수 없으면(바인딩 없음) 기다리는 기사를 원문 그대로 보이게
    const r = await env.DB.prepare('UPDATE news SET st = 2, u = ? WHERE st = 0 AND seen < ?').bind(now, now - 2 * 60e3).run();
    return { n: (r.meta && r.meta.changes) || 0, info: { off: 1 } };
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const used = await kvGet(env, 'ai:' + day);
  let spent = used ? Number(used.v) || 0 : 0;
  const block = await kvGet(env, 'ai:block');
  // 오래 기다린 기사(AI_WINDOW)·여러 번 실패한 기사 → 원문 그대로
  const old = await env.DB.prepare('UPDATE news SET st = 2, u = ? WHERE st = 0 AND (seen < ? OR tries >= ?)').bind(now, now - AI_WINDOW, AI_TRIES).run();
  let n = (old.meta && old.meta.changes) || 0;
  if (spent >= (Number(env.NEWS_AI_CAP) || AI_DAILY_CAP) || (block && block.v === day)) {
    // 오늘 한도를 다 쓰면: 10분 넘게 기다린 기사는 원문 그대로 보이게(내일 0시 UTC 에 다시 AI)
    const r = await env.DB.prepare('UPDATE news SET st = 2, u = ? WHERE st = 0 AND seen < ?').bind(now, now - 10 * 60e3).run();
    return { n: n + ((r.meta && r.meta.changes) || 0), info: { cap: 1, spent: Math.round(spent) } };
  }
  // 오늘 한도의 60% 를 넘으면 해외 기사(번역이 꼭 필요한 것)만 AI 로 — 국내 기사는 한국어 제목이라 종목·중요도 없이 원문 그대로(10분 뒤)
  const cap = Number(env.NEWS_AI_CAP) || AI_DAILY_CAP, saving = spent > cap * 0.6;
  if (saving) {
    const keys = NEWS_FEEDS.filter((f) => f.p === 'tag').map((f) => f.k);
    const r = await env.DB.prepare(`UPDATE news SET st = 2, u = ? WHERE st = 0 AND seen < ? AND src IN (${keys.map(() => '?').join(',')})`).bind(now, now - 10 * 60e3, ...keys).run();
    n += (r.meta && r.meta.changes) || 0;
  }
  const fullKeys = NEWS_FEEDS.filter((f) => f.p === 'full').map((f) => f.k);
  const list = (await (saving
    ? env.DB.prepare(`SELECT id, src, t0, d0, hint FROM news WHERE st = 0 AND src IN (${fullKeys.map(() => '?').join(',')}) ORDER BY ts DESC LIMIT ?`).bind(...fullKeys, AI_BATCH)
    : env.DB.prepare('SELECT id, src, t0, d0, hint FROM news WHERE st = 0 ORDER BY ts DESC LIMIT ?').bind(AI_BATCH)).all()).results || [];
  if (!list.length) return { n, info };
  const items = list.map((r, i) => {
    const f = FEED[r.src] || { p: 'full', m: 'us' };
    const o = { i: i + 1, mode: f.p === 'tag' ? 'tag' : 'full', src: f.n, title: r.t0 };
    if (o.mode === 'full' && r.d0) o.d = r.d0;
    if (r.hint) o.tickers = r.hint;
    return o;
  });
  const user = JSON.stringify(items);
  const pref = await kvGet(env, 'ai:model');
  const order = AI_MODELS.map((m) => m[0]);
  if (pref && pref.v && order.includes(pref.v) && pref.t > now - 86400e3) order.unshift(...order.splice(order.indexOf(pref.v), 1));
  let parsed = null, model = '', err = '';
  for (const md of order) {
    try {
      const r = await env.AI.run(md, {
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: (md.includes('qwen3') ? '/no_think\n' : '') + user }],
        max_tokens: 1600, temperature: 0.2,
      });
      const txt = aiText(r);
      spent += neurons(md, r && r.usage, SYS.length + user.length, txt.length);
      parsed = aiParse(txt);
      if (parsed && parsed.length) { model = md; break; }
      err = 'parse:' + md;
    } catch (e) {
      const msg = String(e && e.message || e);
      err = md + ': ' + msg.slice(0, 140);
      if (/4006|daily free allocation|neurons|quota|limit/i.test(msg)) { await kvPut(env, 'ai:block', day, now).run(); break; }
    }
  }
  const stmts = [kvPut(env, 'ai:' + day, String(Math.round(spent * 10) / 10), now)];
  if (model) stmts.push(kvPut(env, 'ai:model', model, now));
  if (err) stmts.push(kvPut(env, 'ai:err', err, now));
  const byI = new Map((parsed || []).map((o) => [Number(o && o.i), o]));
  for (let i = 0; i < list.length; i++) {
    const r = list[i], f = FEED[r.src] || { p: 'full' }, o = byI.get(i + 1);
    if (!o) { stmts.push(env.DB.prepare('UPDATE news SET tries = tries + 1 WHERE id = ?').bind(r.id)); continue; }
    const c = aiClean(o, f.p === 'tag' ? 'tag' : 'full');
    stmts.push(env.DB.prepare('UPDATE news SET t = ?, s = ?, tk = ?, imp = ?, sen = ?, st = ?, u = ? WHERE id = ?')
      .bind(c.t || null, c.s || null, c.k.length ? c.k.join(',') : (r.hint || null), c.imp, c.sen, c.rel ? 1 : 3, now, r.id));
    n++;
  }
  await env.DB.batch(stmts);
  info.model = model; info.spent = Math.round(spent); if (err) info.err = err;
  return { n, info };
}

/* ── 묶음(최신 SNAP_N 건) ── */
export function rowOut(r) {
  const f = FEED[r.src] || { n: r.src, p: 'full' };
  const o = { i: r.id, ts: r.ts, u: r.u, m: r.mk, s: r.src, l: r.url, t: r.t || r.t0 };
  if (r.t && r.t !== r.t0) o.o = r.t0;
  if (r.s) o.x = r.s;
  const tk = r.tk || r.hint;
  if (tk) o.k = tk.split(',').filter(Boolean);
  if (r.imp) o.p = r.imp;
  if (r.sen) o.e = r.sen;
  o.a = r.st === 0 ? 0 : (r.st === 1 && f.p !== 'none' ? 1 : 2);   // 0 정리 중 · 1 AI 정리 · 2 원문 그대로
  return o;
}
export const SRC_OUT = () => Object.fromEntries(NEWS_FEEDS.map((f) => [f.k, [f.n, f.p]]));
async function buildSnap(env, now) {
  const rows = (await env.DB.prepare('SELECT id, src, mk, ts, u, url, t0, t, s, tk, hint, imp, sen, st FROM news WHERE st IN (0,1,2) ORDER BY ts DESC LIMIT ?').bind(SNAP_N).all()).results || [];
  const items = rows.map(rowOut);
  // AI 가 '투자와 무관'으로 뺀 기사(st 3): 이미 화면에 '정리 중'으로 떠 있던 브라우저가 지우도록 최근 6시간 것의 번호와 시각
  const gone = ((await env.DB.prepare('SELECT id, u FROM news WHERE st = 3 AND u > ? ORDER BY u DESC LIMIT 300').bind(now - 6 * 3600e3).all()).results || []);
  const ver = Math.max(items.reduce((m, x) => Math.max(m, x.u), 0), gone.reduce((m, x) => Math.max(m, x.u), 0)) || now;
  await kvPut(env, 'snap', JSON.stringify({ v: ver, at: now, items, gone: gone.map((x) => [x.id, x.u]) }), ver).run();
  return ver;
}

/* ── 정리 (매일 한 번) ── */
export async function newsClean(env, now = Date.now()) {
  await ensure(env);
  await env.DB.prepare('DELETE FROM news WHERE ts < ?').bind(now - KEEP_DAYS * 86400e3).run();
  await env.DB.prepare("DELETE FROM news_kv WHERE k LIKE 'ai:20%' AND t < ?").bind(now - 14 * 86400e3).run();
}

/* ── GET /news ── */
let MEM = null;   // {t, obj} — 같은 isolate 에서 같은 버전이면 D1 에서 큰 묶음을 다시 읽지 않음
export async function news(req, env, url, json) {
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  await ensure(env);
  const now = Date.now();
  if (url.pathname === '/news/status') {
    const rows = (await env.DB.prepare('SELECT k, next, last, ok, err, n, fails FROM news_feed').all()).results || [];
    const day = new Date(now).toISOString().slice(0, 10);
    const [ai, md, er, cnt] = await Promise.all([kvGet(env, 'ai:' + day), kvGet(env, 'ai:model'), kvGet(env, 'ai:err'),
      env.DB.prepare('SELECT st, COUNT(*) AS c FROM news GROUP BY st').all()]);
    return json({ now, ai: !!env.AI, aiUsed: ai ? Number(ai.v) : 0, aiCap: Number(env.NEWS_AI_CAP) || AI_DAILY_CAP, model: md && md.v, aiErr: er && { v: er.v, at: er.t },
      count: Object.fromEntries(((cnt.results) || []).map((r) => [r.st, r.c])),
      feeds: NEWS_FEEDS.map((f) => { const r = rows.find((x) => x.k === f.k) || {}; return { k: f.k, n: f.n, m: f.m, p: f.p, last: r.last || null, ok: r.ok || null, err: r.err || null, items: r.n || 0, fails: r.fails || 0 }; }) });
  }
  const before = Number(url.searchParams.get('before'));
  if (before > 0) {
    const mk = url.searchParams.get('m');
    const q = mk === 'us' || mk === 'kr'
      ? env.DB.prepare('SELECT id, src, mk, ts, u, url, t0, t, s, tk, hint, imp, sen, st FROM news WHERE st IN (0,1,2) AND mk = ? AND ts < ? ORDER BY ts DESC LIMIT 50').bind(mk, before)
      : env.DB.prepare('SELECT id, src, mk, ts, u, url, t0, t, s, tk, hint, imp, sen, st FROM news WHERE st IN (0,1,2) AND ts < ? ORDER BY ts DESC LIMIT 50').bind(before);
    const items = ((await q.all()).results || []).map(rowOut);
    return json({ items, more: items.length === 50 });
  }
  const head = await env.DB.prepare("SELECT t FROM news_kv WHERE k='snap'").first();
  if (!head) return json({ v: 0, at: 0, items: [], src: SRC_OUT() });
  if (!MEM || MEM.t !== head.t) {
    const r = await kvGet(env, 'snap');
    MEM = { t: head.t, obj: JSON.parse(r.v) };
  }
  const snap = MEM.obj;
  const after = Number(url.searchParams.get('after'));
  if (after > 0) {
    if (after >= snap.v) return json({ v: snap.v, at: snap.at, same: 1 });
    return json({ v: snap.v, at: snap.at, items: snap.items.filter((x) => x.u > after), gone: (snap.gone || []).filter((g) => g[1] > after).map((g) => g[0]), part: 1 });
  }
  return json({ v: snap.v, at: snap.at, items: snap.items, src: SRC_OUT() });
}
