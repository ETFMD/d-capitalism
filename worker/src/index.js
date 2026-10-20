/* 디코딩 자본주의 방문자 수 카운터 (Cloudflare Worker + D1)
 * · 네이버 애널리틱스 '방문자수'와 같은 기준: 브라우저마다 하루(한국 시간 기준) 1번만 셉니다 (2026-10-20 부터 · 아래 hit())
 *   (예전에는 같은 IP를 1명으로 셌음 — 같은 와이파이·회사·통신사 IP를 쓰는 여러 사람이 1명으로 묶여 네이버보다 적게 나왔음)
 * · 원문은 저장하지 않습니다: SHA-256(SALT + 날짜 + 브라우저 번호) 해시만 그날 하루 중복 확인용으로 보관하고,
 *   매일 새벽 정리 작업이 2일 지난 해시를 지웁니다. 날짜마다 해시가 달라 다른 날과 연결할 수도 없습니다.
 * · POST /hit {id} → 오늘 처음 온 브라우저면 1 증가 후 {today, yesterday, max, maxDay, total} 반환
 *   GET  /     → 세지 않고 같은 값만 반환
 * · 허용된 사이트(ALLOWED_ORIGINS)에서 온 요청만 셉니다. 검색봇·크롤러는 세지 않습니다.
 *
 * /auth/* · /saves  → 카카오·네이버·구글 간편 로그인과 내 저장함 (worker/src/auth.js)
 * /board            → 건의 게시판 — 버그 신고·기능 제안 (worker/src/board.js · 쓰기는 회원만)
 *
 * GET /geo  → {country} 접속 국가 코드 (기본 언어 선택용 · 기록하지 않음)
 *
 * GET /fear → CNN 공포·탐욕 지수 (점수·과거값·7개 구성 지표·1년 추이)를 실시간에 가깝게 전달
 *   · CNN 은 브라우저에서 직접 부를 수 없어(CORS) 이 Worker 가 대신 받아 옵니다.
 *   · 5분 동안은 D1 에 저장한 값을 다시 씁니다 (workers.dev 에서는 Cache API 가 동작하지 않음).
 *
 * 한국 수집기 (/kr) — 해외 접속을 막는 운용사 사이트(RISE 등)를 한국에 있는 PC(Windows 예약 작업 · scripts/kr_agent.ps1)가 대신 받아 둠
 *   · GET  /kr?u=…        저장된 응답 반환 + '계속 받아 달라'고 표시 (허용 주소만 · 처음이면 202 → 몇 분 뒤 다시)
 *   · GET  /kr/jobs?k=…&a=PC이름  (수집기 전용) 30분 넘게 묵은 요청 주소 목록 · 여러 PC가 동시에 돌면 4분 동안 나눠 맡음
 *   · POST /kr/put?k=…    (수집기 전용) [{u, st, v}] 받은 내용 저장
 *   · GET  /kr/status     PC별 마지막 접속 시각·국가 · 주소 수
 *   · 수집기 열쇠는 원문 대신 SHA-256 값만 이 코드에 둠 · 3일 동안 아무도 찾지 않은 주소는 정리
 *
 * GET /etf?m=k|u&s=코드 → ETF 일봉 원문(수정주가)을 대신 받아 30분 보관 — ETF 차트 비교 (브라우저는 CORS 로 직접 못 부름)
 *   · m=k 국내: 네이버 증권 siseJson (상장일부터 · 분배금 반영 수정주가) · m=u 미국: Yahoo Finance v8 chart (adjclose)
 *   · 이 사이트(ALLOWED_ORIGINS)에서 온 요청만 · 코드 형식 검사(다른 주소로는 못 보냄) · 원문을 그대로 D1 cache 에 보관(가공 없이 → CPU 적게)
 *   · 받아 오지 못하면 직전 보관본 · 매일 03시에 7일 넘게 안 쓴 보관본 정리
 * GET /q?s=SOXL → 실시간 시세 (야후 1분봉 마지막 체결가 · 프리장·정규장·애프터장) — 무한매수법·72루틴 'LOC 매수 상한' ↻ 자동 · 15초 메모리 보관
 * GET /apt?sgg=11650&seq=시군구|법정동|지번|단지명 → 아파트 한 단지의 최근 1년 매매 실거래 [[계약일, 금액(만원), 전용㎡, 층], ...]
 *   · 자료는 GitHub Actions 가 2시간마다 POST /apt/put 으로 올린 시군구·월별 실거래 (D1)
 *
 * POST /hb · GET /hb → 72루틴 자동매매 PC 프로그램 생존 신호 · 주문 시각이 지났는데 신호가 없으면 15분 cron 이 텔레그램으로 알림 (worker/src/hb.js)
 * POST /grp · GET /grp → 72루틴 자동매매 PC 여러 대 — 주문 권한(한 대만)·이어받기·암호화한 공유 상태 (worker/src/grp.js)
 * /sns/* → SNS 자동 게시(유튜브 쇼츠·인스타그램 릴스·스레드·페이스북 릴스) — 관리자 전용 · 영상 공개 주소 /sns/m/<id>.mp4 · OAuth 콜백 /sns/cb/<sns> (worker/src/sns.js)
 *
 * 15분마다(cron) GitHub Actions '시세 데이터 갱신'을 직접 실행시킴 (GitHub 자체 예약 실행은 자주 늦어지거나 누락됨)
 *   · 한국장과 공시 시간(평일 09~20시)·미국장(평일 22~07시, 한국 시간) 15분마다, 그 밖에는 3시간마다
 *   · GH_TOKEN(저장소 1개·Actions 쓰기 권한만 있는 토큰) 비밀값이 있을 때만 동작 · GET /status 로 마지막 실행 결과 확인
 */
import { auth, adminUser } from './auth.js';
import { hb, hbScan } from './hb.js';   /* 72루틴 자동매매 PC 프로그램 생존 감시 (/hb) */
import { grp, grpScan } from './grp.js';   /* 72루틴 자동매매 PC 여러 대 (/grp) */
import { sns } from './sns.js';   /* SNS 자동 게시 — 관리자 전용 (/sns/*) */
import { board } from './board.js';   /* 건의 게시판 (/board · 사이트 /suggest/) */
const REPO = 'ETFMD/d-capitalism';
const WORKFLOW = 'update-market-data.yml';
const APT_WORKFLOW = 'update-apt-rank.yml';   // 아파트 시세 순위 (2시간마다)
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|kakaotalk-scrap|yeti|daum|headless|lighthouse|preview|python|curl|wget|java\/|go-http|axios|node-fetch/i;

const CNN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const CNN_PARTS = [['market_momentum_sp500', '주가 모멘텀'], ['stock_price_strength', '주가 강도'], ['stock_price_breadth', '주가 폭'],
  ['put_call_options', '풋/콜 비율'], ['market_volatility_vix', '시장 변동성 (VIX)'], ['safe_haven_demand', '안전자산 수요'], ['junk_bond_demand', '정크본드 수요']];
const FEAR_TTL = 300;   // 초
const RELAY_HOSTS = ['www.tigeretf.com', 'investments.miraeasset.com', 'www.riseetf.co.kr', 'riseetf.co.kr', 'www.plusetf.co.kr'];   // /relay 허용 주소
const KR_HOSTS = ['www.riseetf.co.kr', 'riseetf.co.kr', 'www.kbam.co.kr', 'kbam.co.kr',             // 한국 수집기 허용 주소 (운용사 공개 페이지만)
  'www.nhamundi.com', 'nhamundi.com', 'www.hanaroetf.com', 'www.hanaam.com', 'hanaam.com', 'www.1qetf.com', '1qetf.com',
  'www.daishin-am.co.kr', 'daishin-am.co.kr', 'www.daishinam.co.kr', 'daishinam.co.kr', 'www.viam.co.kr', 'viam.co.kr', 'www.vi-am.co.kr', 'vi-am.co.kr',
  'asset.daishin.com', 'www.viamc.kr', 'viamc.kr', 'dart.fss.or.kr', 'opendart.fss.or.kr'];
const KR_HTTP = ['www.viamc.kr', 'viamc.kr'];   // https 를 받지 않는 운용사 (http 허용)
const KR_KEY = '66862eb910881b358a466876f4303e5ff3d92c59';     // SHA-256(수집기 열쇠) 앞 40자 (sha256() 과 같은 길이)
const KR_TTL = 1800, KR_KEEP = 3 * 86400, KR_MAX = 600;                                  // 다시 받는 주기 · 보관 · 최대 주소 수(초·개)
const r1 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 10) / 10);

async function cnnFear() {
  const since = new Date(Date.now() - 370 * 86400e3).toISOString().slice(0, 10);
  const headers = { 'User-Agent': CNN_UA, Referer: 'https://edition.cnn.com/markets/fear-and-greed', Origin: 'https://edition.cnn.com',
    Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8', 'Cache-Control': 'no-cache' };
  let err = null;
  for (const url of [`https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${since}`, 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata']) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error('CNN ' + r.status);
      const d = await r.json(), fg = d.fear_and_greed;
      if (!fg || fg.score == null) throw new Error('CNN 형식');
      return {
        source: 'CNN', score: r1(fg.score), rating: fg.rating || null, time: fg.timestamp || null,
        prev: { close: r1(fg.previous_close), w1: r1(fg.previous_1_week), m1: r1(fg.previous_1_month), y1: r1(fg.previous_1_year) },
        components: CNN_PARTS.filter(([k]) => d[k] && d[k].score != null).map(([k, n]) => ({ key: k, name: n, score: r1(d[k].score), rating: d[k].rating || null })),
        historical: ((d.fear_and_greed_historical || {}).data || []).map((p) => ({ date: new Date(p.x).toISOString().slice(0, 10), score: r1(p.y) })),
      };
    } catch (e) { err = e; }
  }
  throw err;
}
async function fear(env) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT t, v FROM cache WHERE k = ?').bind('fear').first();
  if (row && now - row.t < FEAR_TTL) return { ...JSON.parse(row.v), fetched: row.t, cached: true };
  try {
    const v = await cnnFear();
    await env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v').bind('fear', now, JSON.stringify(v)).run();
    return { ...v, fetched: now, cached: false };
  } catch (e) {
    if (row) return { ...JSON.parse(row.v), fetched: row.t, cached: true, stale: true };   // CNN 일시 오류 → 직전 값
    throw e;
  }
}

async function dispatch(env, workflow) {
  let status = 0, detail = '';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow || WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                 'User-Agent': 'etfmd-counter', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    status = r.status;
    if (status !== 204) detail = (await r.text()).slice(0, 200);
  } catch (e) { detail = String(e && e.message || e).slice(0, 200); }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v')
    .bind(workflow ? 'dispatch:' + workflow : 'dispatch', now, JSON.stringify({ status, ok: status === 204, detail })).run();
}

function kstDay(ms) {
  return new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);   // YYYY-MM-DD (한국 시간)
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}
/* ── 실시간 접속 ──
 * 사이트를 보고 있는 브라우저가 45초마다 POST /live {id} (id: 브라우저별 무작위 번호 · IP 는 쓰지 않음)
 * 최근 LIVE_SEC 초 안에 신호를 보낸 브라우저 수 = 실시간 · 탭을 닫거나 숨기면 {id, bye:1} 로 바로 빠짐 */
const LIVE_SEC = 100;
async function live(req, env, cors, json, day) {
  let b = {};
  try { b = JSON.parse(await req.text()); } catch (e) {}
  const id = String(b.id || '');
  const ua = req.headers.get('User-Agent') || '';
  if (cors.ok && /^[a-f0-9]{16,40}$/.test(id) && ua && !BOT.test(ua)) {
    const now = Math.floor(Date.now() / 1000);
    if (b.bye) await env.DB.prepare('DELETE FROM live WHERE s = ?').bind(id).run();
    else await env.DB.prepare('INSERT INTO live (s, t) VALUES (?, ?) ON CONFLICT(s) DO UPDATE SET t = excluded.t').bind(id, now).run();
    if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM live WHERE t < ?').bind(now - 600).run();   /* 오래된 기록 정리 */
  }
  if (b.bye) return new Response(null, { status: 204, headers: cors.headers });
  return json(await counts(env, day));
}
/* ── 방문자 수 (네이버 애널리틱스 '방문자수'와 같은 기준) ──
 * 사이트 머리의 [ANALYTICS] 스크립트(네이버 애널리틱스와 같은 페이지 · 실제 도메인에서만)가 브라우저마다 하루 1번 POST /hit {id}
 *   · id = 브라우저 무작위 번호(dc_live_id · 실시간 접속과 같은 번호 · 그 기기에만 저장) — 네이버의 쿠키 방식처럼 브라우저마다 1명
 *   · 저장: SHA-256(SALT|날짜|v|번호) 해시만 그날 중복 확인용(visits · 2일 뒤 삭제) — 번호 원문·IP 원문은 저장하지 않음
 *   · 남용 막기: 같은 IP(해시)에서 하루 새 번호 VISIT_IP_MAX 개까지만 센다 (번호를 바꿔 가며 숫자를 부풀리는 것 방지 · vcap)
 *   · 번호 없는 요청(예전 화면이 브라우저 캐시에 남은 경우)은 예전처럼 IP 기준
 *   · 검색봇·크롤러(BOT)·허용되지 않은 사이트에서 온 요청은 세지 않음 */
const VISIT_IP_MAX = 40;
async function hit(req, env, cors, json, day) {
  let b = {};
  try { const t = await req.text(); if (t) b = JSON.parse(t); } catch (e) {}
  const ip = req.headers.get('CF-Connecting-IP') || '';
  const ua = req.headers.get('User-Agent') || '';
  const id = String((b && b.id) || '');
  if (cors.ok && ip && ua && !BOT.test(ua)) {
    const ih = await sha256((env.SALT || '') + '|' + day + '|' + ip);
    let key = ih, room = true;
    if (/^[a-f0-9]{32}$/.test(id)) {
      key = 'v' + (await sha256((env.SALT || '') + '|' + day + '|v|' + id)).slice(1);   // IP 해시(16진수만)와 섞이지 않게 'v' 로 시작
      const c = await env.DB.prepare('SELECT n FROM vcap WHERE day = ? AND h = ?').bind(day, ih).first();
      room = !c || c.n < VISIT_IP_MAX;
    }
    if (room) {
      const r = await env.DB.prepare('INSERT OR IGNORE INTO visits (day, h) VALUES (?, ?)').bind(day, key).run();
      if (r.meta && r.meta.changes > 0) {
        const ops = [env.DB.prepare('INSERT INTO daily (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1').bind(day)];
        if (key !== ih) ops.push(env.DB.prepare('INSERT INTO vcap (day, h, n) VALUES (?, ?, 1) ON CONFLICT(day, h) DO UPDATE SET n = n + 1').bind(day, ih));
        await env.DB.batch(ops);
      }
    }
  }
  return json(await counts(env, day));
}
async function counts(env, day) {
  const yday = kstDay(Date.parse(day + 'T00:00:00+09:00') - 86400e3);
  const [t, y, s, m, l] = await env.DB.batch([
    env.DB.prepare('SELECT n FROM daily WHERE day = ?').bind(day),
    env.DB.prepare('SELECT n FROM daily WHERE day = ?').bind(yday),
    env.DB.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM daily'),
    env.DB.prepare('SELECT day, n FROM daily ORDER BY n DESC, day DESC LIMIT 1'),   // 하루 최대 방문자 (같으면 최근 날)
    env.DB.prepare('SELECT COUNT(*) AS n FROM live WHERE t > ?').bind(Math.floor(Date.now() / 1000) - LIVE_SEC),   // 실시간 접속 (최근 신호)
  ]);
  const one = (r) => (r && r.results && r.results[0]) || null;
  const T = one(t), Y = one(y), S = one(s), M = one(m), L = one(l);
  return { day, today: T ? T.n : 0, yesterday: Y ? Y.n : 0, total: S ? S.n : 0, max: M ? M.n : 0, maxDay: M ? M.day : null, live: L ? L.n : 0 };
}

/* ── 아파트 실거래 (단지 상세 그래프) ──
 * 2시간마다 GitHub Actions(아파트 시세 순위 갱신)가 국토교통부 실거래를 받아 시군구·월별로 POST /apt/put 에 올림 (D1 보관)
 * 사이트는 GET /apt?sgg=&seq= 로 그 단지의 최근 1년 거래만 받아 그래프를 그림 — 이 Worker 는 공공 API 를 직접 부르지 않음 */
const APT_HASH = '7ab8044e53b745fdfd553b67d64bf8fb8bb4c104';         // SHA-256(공공데이터포털 인증키) 앞 40자 — 올리는 쪽 확인용
function aptMonths(n) {                                              // 한국 시간 이번 달부터 거꾸로 n개 'YYYYMM'
  const k = new Date(Date.now() + 9 * 3600e3); let y = k.getUTCFullYear(), m = k.getUTCMonth() + 1; const out = [];
  for (let i = 0; i < n; i++) { out.push(y + String(m).padStart(2, '0')); if (--m === 0) { m = 12; y--; } }
  return out;
}
async function apt(req, env, url, json) {
  if (url.pathname === '/apt/put' && req.method === 'POST') {
    if ((await sha256(url.searchParams.get('k') || '')) !== APT_HASH) return json({ error: 'forbidden' }, 403);
    const items = await req.json(), now = Math.floor(Date.now() / 1000);
    const ok = (Array.isArray(items) ? items : []).filter((x) => x && /^\d{5}$/.test(x.sgg) && /^\d{6}$/.test(x.ym) && Array.isArray(x.v));
    if (ok.length) await env.DB.batch(ok.map((x) => env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v')
      .bind('apt:' + x.sgg + ':' + x.ym, now, JSON.stringify(x.v))));
    return json({ ok: ok.length });
  }
  if (url.pathname !== '/apt' || req.method !== 'GET') return json({ error: 'not found' }, 404);
  const sgg = url.searchParams.get('sgg') || '', seq = url.searchParams.get('seq') || '';
  if (!/^\d{5}$/.test(sgg) || !seq || seq.length > 160) return json({ error: 'bad params' }, 400);
  const months = aptMonths(13), cut = new Date(Date.now() + 9 * 3600e3 - 366 * 86400e3).toISOString().slice(0, 10);
  const r = await env.DB.prepare('SELECT k, t, v FROM cache WHERE k IN (' + months.map(() => '?').join(',') + ')').bind(...months.map((ym) => 'apt:' + sgg + ':' + ym)).all();
  const deals = []; let at = 0;
  const all = url.searchParams.get('all') === '1';                  // all=1: 13개월 창 전체 (1년 자르기 없음)
  (r.results || []).forEach((row) => { at = Math.max(at, row.t); JSON.parse(row.v).forEach((d) => { if (d[0] === seq && !d[5] && (all || d[1] >= cut)) deals.push([d[1], d[2], d[3], d[4]]); }); });
  deals.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // from: 이 응답이 맡는 첫 달 (그 이전은 사이트가 data/apt_hist/ 연도 파일에서 읽음)
  return json({ seq, deals, from: months[months.length - 1], months: (r.results || []).length, updated: at ? new Date(at * 1000).toISOString() : null });
}

async function kr(req, env, url, json) {
  const now = Math.floor(Date.now() / 1000);
  const authed = async () => (await sha256(url.searchParams.get('k') || '')) === KR_KEY;
  if (url.pathname === '/kr' && req.method === 'GET') {
    let target;
    try { target = new URL(url.searchParams.get('u') || ''); } catch (e) { return json({ error: 'bad url' }, 400); }
    if (!KR_HOSTS.includes(target.hostname) || !(target.protocol === 'https:' || (target.protocol === 'http:' && KR_HTTP.includes(target.hostname))))
      return json({ error: 'host not allowed' }, 403);
    const u = target.toString();
    const row = await env.DB.prepare('SELECT t, st, v FROM kr WHERE u = ?').bind(u).first();
    if (row) await env.DB.prepare('UPDATE kr SET want = ? WHERE u = ?').bind(now, u).run();
    else {
      const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM kr').first();
      if (c && c.n >= KR_MAX) return json({ error: 'full' }, 429);
      await env.DB.prepare('INSERT OR IGNORE INTO kr (u, want) VALUES (?, ?)').bind(u, now).run();
    }
    if (!row || row.t == null) return json({ pending: true }, 202);
    return new Response(row.v, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'X-KR-At': String(row.t), 'X-KR-Status': String(row.st || 0) } });   // 원래 응답 상태는 X-KR-Status (0 = 접속 실패)
  }
  if (url.pathname === '/kr/jobs' && req.method === 'GET') {
    if (!(await authed())) return json({ error: 'forbidden' }, 403);
    const id = (url.searchParams.get('a') || 'pc').replace(/[^\w-]/g, '').slice(0, 24) || 'pc';   // 수집기(PC)마다 다른 이름
    await env.DB.batch([
      env.DB.prepare('DELETE FROM kr WHERE want < ?').bind(now - KR_KEEP),
      env.DB.prepare('DELETE FROM kr_lease WHERE until < ?').bind(now),
      env.DB.prepare('DELETE FROM cache WHERE k LIKE ? AND t < ?').bind('kr_agent:%', now - 14 * 86400),
      env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v')
        .bind('kr_agent:' + id, now, JSON.stringify({ country: (req.cf && req.cf.country) || null, info: (url.searchParams.get('i') || '').replace(/[^\w-]/g, '').slice(0, 40) || null })),
    ]);
    // 처음 · 30분 지난 것 · 실패한 것(4분 뒤 다시) — 다른 PC가 4분 안에 가져간 주소는 빼고 나눠 받음
    const r = await env.DB.prepare('SELECT u FROM kr WHERE (t IS NULL OR t < ? OR (st <> 200 AND t < ?)) AND u NOT IN (SELECT u FROM kr_lease) ORDER BY t IS NOT NULL, t LIMIT 40')
      .bind(now - KR_TTL, now - 240).all();
    const urls = (r.results || []).map((x) => x.u);
    if (urls.length) await env.DB.batch(urls.map((u) => env.DB.prepare('INSERT OR REPLACE INTO kr_lease (u, until) VALUES (?, ?)').bind(u, now + 240)));
    return json({ urls });
  }
  if (url.pathname === '/kr/put' && req.method === 'POST') {
    if (!(await authed())) return json({ error: 'forbidden' }, 403);
    const items = await req.json();
    const ok = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.u === 'string' && typeof x.v === 'string');
    const st = ok.flatMap((x) => [env.DB.prepare('UPDATE kr SET t = ?, st = ?, v = ? WHERE u = ?').bind(now, x.st | 0, x.v.slice(0, 1500000), x.u),
      env.DB.prepare('DELETE FROM kr_lease WHERE u = ?').bind(x.u)]);
    if (st.length) await env.DB.batch(st);
    return json({ ok: ok.length });
  }
  if (url.pathname === '/kr/status' && req.method === 'GET') {
    const [a, c] = await env.DB.batch([
      env.DB.prepare('SELECT k, t, v FROM cache WHERE k LIKE ? ORDER BY t DESC').bind('kr_agent:%'),
      env.DB.prepare('SELECT COUNT(*) AS n, SUM(st = 200) AS ok FROM kr'),
    ]);
    const C = (c.results && c.results[0]) || {};
    return json({ agents: (a.results || []).map((x) => ({ id: x.k.slice(9), ...JSON.parse(x.v), at: new Date(x.t * 1000).toISOString() })),
      urls: C.n || 0, ok: C.ok || 0 });
  }
  return json({ error: 'not found' }, 404);
}

/* ── ETF 차트 비교: 일봉 원문 중계 + 30분 보관 ── */
const ETF_TTL = 1800;   // 초
const KP_TTL = 6 * 86400;   // 지난 날의 실제 가격(네이버 일별 시세 한 쪽)은 바뀌지 않음 → 길게 (보관본은 7일 지나면 정리)
const numK = (x) => parseFloat(String(x == null ? '' : x).replace(/,/g, ''));
/* 야후 일봉 → "YYYYMMDD,시가,종가" 줄 (국내 ETF 실제 거래 가격 — 분배로 낮춰 잡은 수정주가가 아님) */
function yahooRows(v) {
  const j = JSON.parse(v), r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp || !r.indicators || !r.indicators.quote) return '';
  const off = (r.meta && +r.meta.gmtoffset) || 0, q = r.indicators.quote[0] || {}, out = [];
  r.timestamp.forEach((t, i) => {
    const c = q.close && q.close[i], o = q.open && q.open[i];
    if (c > 0) out.push(new Date((t + off) * 1000).toISOString().slice(0, 10).replace(/-/g, '') + ',' + (o > 0 ? +o.toFixed(4) : '') + ',' + +c.toFixed(4));
  });
  return out.join('\n');
}
function etfSource(m, s) {
  const now = Math.floor(Date.now() / 1000);
  if (m === 'kr' && /^[0-9][0-9A-Z]{5}$/.test(s)) {                       // 국내 ETF 실제 시가·종가 (야후 일봉, 분배 반영 안 됨)
    return { url: `https://query1.finance.yahoo.com/v8/finance/chart/${s}.KS?period1=315532800&period2=${now + 86400}&interval=1d&includePrePost=false`,
             ok: (v) => v.indexOf('"timestamp"') >= 0, ref: 'https://finance.yahoo.com/', out: yahooRows };
  }
  if (m === 'k' && /^[0-9A-Z]{5,6}$/.test(s)) {                            // 국내 ETF 6자리 · 국내 지수(KOSPI·KOSDAQ·KPI200)
    const end = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10).replace(/-/g, '');   // 한국 날짜 + 1일 (오늘 장중 값 포함)
    return { url: `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(s)}&requestType=1&startTime=19900101&endTime=${end}&timeframe=day`,
             ok: (v) => /\["\d{8}",/.test(v), ref: 'https://finance.naver.com/' };
  }
  if (m === 'u' && /^\^?[A-Z0-9][A-Z0-9.=-]{0,15}$/.test(s)) {           // 미국 ETF·주식 티커 · 지수(^GSPC 등) · 선물·환율(GC=F·JPY=X) · 해외 지수(000001.SS) — 상장 전 백테스트 재료
    // events=div: 분배금(배당) 내역 — 화면의 '가격(분배금 제외)·세후' 계산에 씀 (quote.close = 분배 미반영 종가, adjclose = 분배 재투자)
    return { url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=315532800&period2=${now + 86400}&interval=1d&includePrePost=false&events=div`,
             ok: (v) => v.indexOf('"timestamp"') >= 0 && v.indexOf('"adjclose"') >= 0, ref: 'https://finance.yahoo.com/' };
  }
  return null;
}
/* 네이버 일별 시세 한 쪽(60거래일, 1쪽 = 가장 최근)의 실제 시가·종가 — 야후에 빠진 날을 정확히 채울 때 (m=kp&s=코드&d=YYYYMMDD&g=추정 쪽)
   추정 쪽에 그 날짜가 없으면 앞뒤 쪽으로 옮겨 최대 6번 · 결과는 그 쪽 전체 "YYYYMMDD,시가,종가" 줄
   그 날짜가 일별 시세 자료가 시작하기 전이면 200 "first=자료 첫날" (예: 069500 은 2003-04-04 부터 · 보관) → 화면은 그 전 날들을 다시 묻지 않음
   (정상인 '자료 없음'이라 404 로 보내지 않음 — 브라우저 콘솔 오류가 되지 않게) */
async function etfPage(env, url, cors, json) {
  const s = (url.searchParams.get('s') || '').toUpperCase(), d = url.searchParams.get('d') || '';
  let g = Math.max(1, Math.min(500, parseInt(url.searchParams.get('g'), 10) || 1));
  if (!/^[0-9][0-9A-Z]{5}$/.test(s) || !/^\d{8}$/.test(d)) return json({ error: 'bad symbol' }, 400);
  const key = 'etf:kp:' + s + ':' + d, now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT t, v FROM cache WHERE k = ?').bind(key).first();
  const send = (v, how) => new Response(v, { headers: { ...cors.headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=3600', 'X-Etf-Cache': how,
    'Access-Control-Expose-Headers': 'X-Etf-Cache' } });
  if (row && now - row.t < KP_TTL) return send(row.v, 'hit');
  try {
    let older = '', first = '';
    for (let k = 0; k < 6; k++) {
      const r = await fetch(`https://m.stock.naver.com/api/stock/${s}/price?pageSize=60&page=${g}`, { headers: { 'User-Agent': CNN_UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } });
      if (!r.ok) throw new Error('upstream ' + r.status);
      const a = await r.json();
      const rows = (Array.isArray(a) ? a : []).map((x) => [String(x.localTradedAt || '').replace(/-/g, ''), numK(x.openPrice), numK(x.closePrice)]).filter((x) => /^\d{8}$/.test(x[0]) && x[2] > 0);
      if (!rows.length) {                                                     // 빈 쪽 = 자료 끝(가장 옛날 쪽)을 지남
        if (older) { first = older; break; }                                  //   바로 앞 쪽이 마지막 쪽 → 자료 첫날 = 그 쪽의 가장 옛날 날짜
        if (g > 1) { g = Math.max(1, g - 2); continue; }                      //   추정 쪽이 너무 뒤 → 앞으로
        break;
      }
      const hi = rows[0][0], lo = rows[rows.length - 1][0];
      if (d > hi) { if (g === 1) break; g--; continue; }                     // 더 최근 쪽
      if (d < lo) { if (rows.length < 60) { first = lo; break; } older = lo; g++; continue; }   // 더 옛날 쪽 (60줄이 안 되는 쪽 = 마지막 쪽)
      const v = rows.map((x) => x[0] + ',' + (x[1] > 0 ? x[1] : '') + ',' + x[2]).join('\n');
      await env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v').bind(key, now, v).run();
      return send(v, 'miss');
    }
    if (first) {
      const v = 'first=' + first;
      await env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v').bind(key, now, v).run();
      return send(v, 'miss');
    }
    if (row) return send(row.v, 'stale');
    return json({ error: 'not found' }, 404);
  } catch (e) {
    if (row) return send(row.v, 'stale');
    return json({ error: 'upstream', detail: String(e && e.message || e).slice(0, 120) }, 502);
  }
}
async function etfChart(env, url, cors, json) {
  if (!cors.ok) return json({ error: 'origin' }, 403);
  const m = url.searchParams.get('m') || '', s = (url.searchParams.get('s') || '').toUpperCase();
  if (m === 'kp') return etfPage(env, url, cors, json);
  const src = etfSource(m, s);
  if (!src) return json({ error: 'bad symbol' }, 400);
  const key = 'etf:' + (m === 'u' ? 'u2' : m) + ':' + s, now = Math.floor(Date.now() / 1000);   // u2: 분배 내역이 들어간 응답 (예전 보관본과 섞이지 않게)
  const row = await env.DB.prepare('SELECT t, v FROM cache WHERE k = ?').bind(key).first();
  const send = (v, how) => new Response(v, { headers: { ...cors.headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, max-age=600', 'X-Etf-Cache': how,
    'Access-Control-Expose-Headers': 'X-Etf-Cache' } });
  if (row && now - row.t < ETF_TTL) return send(row.v, 'hit');
  try {
    const r = await fetch(src.url, { headers: { 'User-Agent': CNN_UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8', Referer: src.ref } });
    let v = await r.text();
    if (!r.ok || !src.ok(v)) {
      if (r.status === 404 || /No data found|delisted/i.test(v)) { if (!row) return json({ error: 'not found' }, 404); }
      throw new Error('upstream ' + r.status);
    }
    if (src.out) { v = src.out(v); if (!v) { if (!row) return json({ error: 'not found' }, 404); throw new Error('empty'); } }   // 줄 형식으로 줄여 보관
    if (v.length < 1900000) await env.DB.prepare('INSERT INTO cache (k, t, v) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t, v = excluded.v').bind(key, now, v).run();
    return send(v, 'miss');
  } catch (e) {
    if (row) return send(row.v, 'stale');                                  // 원본 일시 오류 → 직전 보관본
    return json({ error: 'upstream', detail: String(e && e.message || e).slice(0, 120) }, 502);
  }
}
/* ── 실시간 시세 GET /q?s=SOXL ── 무한매수법·72루틴 'LOC 매수 상한'의 ↻ 자동 · 화면 주기 갱신
 *   · 야후 1분봉(프리장·애프터장 포함)의 마지막 체결가 → 프리장·정규장·애프터장 어느 때나 지금 가격
 *   · 응답 {s, p: 가격, t: 체결 시각(유닉스 초), ps: 그 가격의 장 pre|reg|post, ses: 지금 장 pre|reg|post|closed, rp: 정규장 가격, pc: 전일 종가}
 *   · 이 사이트(ALLOWED_ORIGINS)에서 온 요청만 · 기호 형식 검사(다른 주소로는 못 보냄)
 *   · 같은 기호는 15초 동안 이 Worker 메모리에 보관 → 보는 사람이 많아도 원본 호출은 15초에 한 번 (workers.dev 는 Cache API 가 없음 · D1 쓰기도 안 함)
 *   · 원본이 잠깐 안 되면 보관본(stale: 1) · 없으면 502 */
const Q_TTL = 15000, QC = new Map();
function qSes(tp, off, x) {                                                 // 시각 x(초)가 어느 장인지 — 거래소 시간표(오늘) 안이면 그대로, 아니면 미국 동부 시계(4:00·9:30·16:00·20:00)
  if (!x) return null;
  const inP = (k) => tp[k] && x >= tp[k].start && x < tp[k].end;
  if (tp.pre && tp.post && x >= tp.pre.start && x < tp.post.end) return inP('pre') ? 'pre' : inP('regular') ? 'reg' : 'post';
  const mi = Math.floor((((x + off) % 86400) + 86400) % 86400 / 60);
  return mi >= 240 && mi < 570 ? 'pre' : mi >= 570 && mi < 960 ? 'reg' : mi >= 960 && mi < 1200 ? 'post' : null;
}
function yQuote(v, now) {
  let j; try { j = JSON.parse(v); } catch (e) { return null; }
  const r = j && j.chart && j.chart.result && j.chart.result[0], m = r && r.meta;
  if (!m) return null;
  const ts = r.timestamp || [], q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}, c = q.close || [];
  let p = null, t = null;
  for (let i = ts.length - 1; i >= 0; i--) if (c[i] > 0) { p = c[i]; t = ts[i]; break; }   // 마지막 1분봉 (아직 체결 없는 분은 null → 건너뜀)
  if (!(p > 0) && m.regularMarketPrice > 0) { p = m.regularMarketPrice; t = m.regularMarketTime || null; }
  if (!(p > 0)) return null;
  const tp = m.currentTradingPeriod || {}, off = +m.gmtoffset || 0, r4 = (x) => (x > 0 ? Math.round(x * 1e4) / 1e4 : null);
  const inDay = tp.pre && tp.post && now >= tp.pre.start && now < tp.post.end;
  return { s: m.symbol || '', p: r4(p), t: t || null, ps: qSes(tp, off, t) || 'post', ses: inDay ? qSes(tp, off, now) : 'closed',
    rp: r4(m.regularMarketPrice), pc: r4(m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose) };
}
async function liveQuote(url, cors, json) {
  if (!cors.ok) return json({ error: 'origin' }, 403);
  const s = (url.searchParams.get('s') || '').toUpperCase();
  if (!/^\^?[A-Z0-9][A-Z0-9.=-]{0,15}$/.test(s)) return json({ error: 'bad symbol' }, 400);
  const now = Date.now(), c = QC.get(s);
  if (c && now - c.at < Q_TTL) return json(c.v);
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1m&range=1d&includePrePost=true`,
      { headers: { 'User-Agent': CNN_UA, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://finance.yahoo.com/' } });
    if (r.status === 404 && !c) return json({ error: 'not found' }, 404);
    if (!r.ok) throw new Error('upstream ' + r.status);
    const v = yQuote(await r.text(), Math.floor(now / 1000));
    if (!v) throw new Error('empty');
    if (QC.size >= 64) QC.clear();
    QC.set(s, { at: now, v });
    return json(v);
  } catch (e) {
    if (c) return json({ ...c.v, stale: 1 });                              // 원본 일시 오류 → 직전 값
    return json({ error: 'upstream', detail: String(e && e.message || e).slice(0, 120) }, 502);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors.headers });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors.headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    const day = kstDay(Date.now());
    try {
      if (url.pathname === '/hit' && req.method === 'POST') return await hit(req, env, cors, json, day);
      if (url.pathname === '/' && req.method === 'GET') return json(await counts(env, day));
      if (url.pathname === '/live' && req.method === 'POST') return await live(req, env, cors, json, day);
      /* GET /geo → 접속 국가 (Cloudflare 가 IP 로 판별한 ISO 국가 코드) — 사이트 기본 언어 선택용, 저장하지 않음 */
      if (url.pathname === '/geo' && req.method === 'GET') return json({ country: (req.cf && req.cf.country) || null });
      if (url.pathname === '/hb') return await hb(req, env, json);   /* 72루틴 PC 프로그램 생존 신호 (PC 프로그램이 부름 · 브라우저 아님) */
      if (url.pathname === '/grp') return await grp(req, env, json);   /* 72루틴 PC 여러 대 — 주문 권한·공유 상태 (PC 프로그램이 부름) */
      if (url.pathname === '/status' && req.method === 'GET') {
        const [row, ap] = await env.DB.batch([env.DB.prepare('SELECT t, v FROM cache WHERE k = ?').bind('dispatch'), env.DB.prepare('SELECT t, v FROM cache WHERE k = ?').bind('dispatch:' + APT_WORKFLOW)]);
        const one = (x) => { const r = x.results && x.results[0]; return r ? { ...JSON.parse(r.v), at: new Date(r.t * 1000).toISOString() } : null; };
        return json({ token: !!env.GH_TOKEN, lastDispatch: one(row), aptDispatch: one(ap) });
      }
      if (url.pathname === '/etf' && req.method === 'GET') return await etfChart(env, url, cors, json);
      if (url.pathname === '/q' && req.method === 'GET') return await liveQuote(url, cors, json);   /* 실시간 시세 (프리·정규·애프터) */
      /* GET /relay?u=… → 해외 서버(GitHub Actions)를 막는 운용사 사이트의 공개 분배금 자료만 대신 받아 옴 (허용 주소만 · GET 만) */
      if (url.pathname === '/relay' && req.method === 'GET') {
        let target;
        try { target = new URL(url.searchParams.get('u') || ''); } catch (e) { return json({ error: 'bad url' }, 400); }
        if (target.protocol !== 'https:' || !RELAY_HOSTS.includes(target.hostname)) return json({ error: 'host not allowed' }, 403);
        const r = await fetch(target.toString(), { headers: { 'User-Agent': CNN_UA, Accept: req.headers.get('Accept') || '*/*', 'Accept-Language': 'ko-KR,ko;q=0.9',
          Referer: target.origin + '/' }, redirect: 'follow' });
        return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'text/plain', 'Cache-Control': 'no-store' } });
      }
      if (url.pathname === '/board' || url.pathname.startsWith('/board/')) {   /* 건의 게시판 (worker/src/board.js) — 사이트(허용 출처)에서만 */
        if (!cors.ok) return json({ error: 'origin' }, 403);
        return await board(req, env, url, json);
      }
      if (url.pathname.startsWith('/auth/') || url.pathname === '/saves' || url.pathname.startsWith('/saves/') || url.pathname.startsWith('/udata/')) {   /* 간편 로그인 · 내 저장함 (worker/src/auth.js) */
        if (url.pathname !== '/auth/config' && !cors.ok) return json({ error: 'origin' }, 403);
        return await auth(req, env, url, json);
      }
      if (url.pathname.startsWith('/sns/')) return await sns(req, env, url, json, cors, adminUser);   /* SNS 자동 게시 (worker/src/sns.js · 관리자 전용 + 영상 공개 주소·OAuth 콜백) */
      if (url.pathname.startsWith('/kr')) return await kr(req, env, url, json);
      if (url.pathname === '/apt' || url.pathname === '/apt/put') return await apt(req, env, url, json);
      if (url.pathname === '/fear' && req.method === 'GET') {
        try { return json(await fear(env)); } catch (e) { return json({ error: 'cnn', detail: String(e && e.message || e) }, 502); }
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'server' }, 500);
    }
  },
  /* 15분마다: 시세 수집 실행 + 하루 한 번 오래된 방문 해시 정리 */
  async scheduled(event, env, ctx) {
    const t = new Date(event.scheduledTime || Date.now());
    const k = new Date(t.getTime() + 9 * 3600e3);                       // 한국 시간
    const h = k.getUTCHours(), m = k.getUTCMinutes(), dow = k.getUTCDay();   // 0=일
    if (h === 3 && m < 15) {                                             // 매일 03:00~03:14 (한국 시간)
      const cut = kstDay(Date.now() - 2 * 86400e3);
      ctx.waitUntil(env.DB.prepare('DELETE FROM visits WHERE day < ?').bind(cut).run());
      ctx.waitUntil(env.DB.prepare('DELETE FROM vcap WHERE day < ?').bind(cut).run());   // 방문자 수 IP별 새 번호 개수(남용 막기)
      ctx.waitUntil(env.DB.prepare("DELETE FROM cache WHERE k LIKE 'etf:%' AND t < ?").bind(Math.floor(Date.now() / 1000) - 7 * 86400).run());   // ETF 차트 보관본: 7일 넘게 안 쓴 것
      ctx.waitUntil(grpScan(env, Date.now()).catch(() => 0));          // 72루틴 PC 여러 대: 60일 넘게 조용한 묶음·PC 정리
    }
    ctx.waitUntil(hbScan(env, Date.now()).catch(() => 0));               // 72루틴 PC 생존 감시: 놓친 주문 시각·오래 조용함 (HB_KEY 있을 때만)
    if (!env.GH_TOKEN) return;
    if (h % 2 === 0 && m < 15) ctx.waitUntil(dispatch(env, APT_WORKFLOW));     // 아파트 실거래: 2시간마다 (공공 API 하루 한도 안에서 가장 자주)
    const weekday = dow >= 1 && dow <= 5, usOpen = (h >= 22 && dow >= 1 && dow <= 5) || (h < 7 && dow >= 2 && dow <= 6);
    const market = (weekday && h >= 9 && h < 20) || usOpen;           // 09~20시: 한국장 + 장 마감 뒤 ETF 분배금 공시 시간
    if (!market && !(h % 3 === 0 && m < 15)) return;                    // 장 밖에는 3시간마다
    ctx.waitUntil(dispatch(env));
  },
};
