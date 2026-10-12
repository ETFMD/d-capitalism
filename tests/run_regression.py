#!/usr/bin/env python3
"""디코딩 자본주의 회귀 테스트 (Playwright · Chromium)

검사 항목
  1. 모든 주소(홈 + routes.json 68개 + 영어 페이지)를 16개 화면 폭에서 열어
     가로 넘침(문서 폭 > 화면 폭)과 화면 밖으로 잘리는 요소(가로 스크롤 상자 안은 제외)를 찾음
  2. 콘솔 오류·페이지 스크립트 오류 0 (로컬에서 막히는 외부 Worker 호출의 CORS·네트워크 오류는 제외)
  3. 메뉴 항목 수(홈 + 도구 수) · 검색 결과 · 허브 카드 수(같은 그룹 도구 수)
  5. 나의 직업 수명 — 776개 직업·21분야 데이터·모델 방향·연구 순서·검색·순위·주소·공유
  4. 무한매수법 — 라오어 카페 원문 예시 숫자로 계산 엔진 검사, 기록 화면 그리기, 가이드북(23장 · 용어 31개 · 자동 숫자 · 장 열기 · 3-6 실제 일봉 백테스트 표)
     · 버전 V1.0~V3.0 엔진(tests/muhan_ver_test.js — 원문 주문표·LABU 2021·TQQQ 소진 횟수·V4 동등성·양도세) · 백테스트 화면(실행·보기 전환·표·상장 전)
     · 기록 화면 버전별 시작·기록·직접 입력 분할·화면 안 백테스트
  6. ETF 차트 비교 — 보기 2가지(시장가·기준가) · 기간(1M·3M·6M·YTD·1Y·MAX·기간설정) 기준일 · MAX = 가장 늦게 상장한 ETF 첫 거래일 ·
     기준 가격(1M~1Y·YTD = 기준일 종가 · MAX·기간설정 = 시작일 시가 · 끝 = 끝날 종가) · 국내 ETF 는 실제 거래 가격(수정주가 역산 아님) ·
     수익률·세금·재투자 수수료·CAGR·연환산·최대 낙폭·변동성 계산 · 표의 기준·끝 가격 · 표 정렬 · 수수료 입력 · 검색 · 최대 10개 · 국내·미국 지수 ·
     원화 환산 · 주소(#e=…) 복원 · 묶음 버튼 · 자료 없음 표시 · 영어판
     (로컬 검사는 Worker /etf 와 국내 분배 이력 묶음을 합성 자료로 대신해 숫자까지 맞춰 봄 — 네이버 수정주가의 반올림·조정 오차까지 넣어 역산하면 틀리게 만듦)
  7. --etf-audit (배포된 사이트 · 매일 Actions) — ETF 차트 비교 화면의 기준·끝 가격을 독립 출처의 실제 가격(네이버 일별 시세 · 야후 일봉)과 맞춰 봄

사용법
  pip install playwright && python -m playwright install chromium
  python tests/run_regression.py              # 저장소 루트를 임시 서버로 띄워 검사
  python tests/run_regression.py --base https://d-capitalism.com/   # 배포된 사이트 검사
  python tests/run_regression.py --quick      # 화면 폭 4개만
  python tests/run_regression.py --base https://d-capitalism.com/ --etf-audit   # ETF 차트 비교 실제 가격 점검만
실패가 하나라도 있으면 종료 코드 1
"""
import re, argparse, functools, http.server, json, os, shutil, socketserver, subprocess, sys, threading, time, urllib.parse, urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTHS = [320, 360, 375, 390, 412, 414, 430, 480, 600, 768, 820, 1024, 1280, 1366, 1440, 1920]
QUICK = [320, 390, 768, 1440]

# 광고·방문 분석 서버 (검사 브라우저에서 요청을 막음 — 애드센스 무효 트래픽·통계 오염 방지)
TRACK_RE = re.compile(r'^https?://([^/?#]*\.)?(googlesyndication\.com|doubleclick\.net|google-analytics\.com|googletagmanager\.com'
                      r'|googleadservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com|adservice\.google\.[a-z.]+'
                      r'|clarity\.ms|wcs\.naver\.(?:net|com))(:\d+)?([/?#]|$)', re.I)
# 이름에 이런 낱말이 든 서버로 나가는 요청이 TRACK_RE 에 안 걸리면 실패 → 사이트가 새 광고·분석 도구를 붙였을 때 놓치지 않게
TRACK_HINT = ('syndication', 'doubleclick', 'analytics', 'tagmanager', 'adservice', 'adtraffic', 'clarity', 'wcs.naver', 'fundingchoices')

OVERFLOW_JS = """() => {
  const vw = document.documentElement.clientWidth, out = [];
  const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    if (el.closest('[hidden],[aria-hidden="true"]')) continue;
    if (clipped(el)) continue;
    out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''))
             + ' [' + Math.round(r.left) + '~' + Math.round(r.right) + ']');
    if (out.length >= 5) break;
  }
  return { sw: document.documentElement.scrollWidth, vw, out };
}"""

MUHAN_JS = """async () => {
  const E = window.MHE, R = [];
  const eq = (name, got, exp) => { const ok = JSON.stringify(got) === JSON.stringify(exp); R.push({ name, ok, got: ok ? undefined : got, exp: ok ? undefined : exp }); };
  const r2 = x => Math.round(x * 100) / 100;
  const S = o => Object.assign({ ticker: 'TQQQ', splits: 40, totalCapital: 20000, lowerLocLines: 8, lowerLocShares: 1 }, o);
  const pq = l => l.map(o => [o.label.replace(/\\s/g, ''), o.method, o.price, o.quantity]);
  const L = ps => ps.map(p => ['', 'LOC', p, 1]);
  if (!E) return [{ name: 'MHE 없음', ok: false }];
  // 카페 79263 (일반모드)
  eq('별% 4종', [E.starPercent('TQQQ', 20, 4), E.starPercent('TQQQ', 40, 4), r2(E.starPercent('SOXL', 20, 8.6)), r2(E.starPercent('SOXL', 40, 8.6))], [9, 12, 2.8, 11.4]);
  eq('별지점 38.30→39.37', E.priceAt(38.30, E.starPercent('SOXL', 20, 8.6)), 39.37);
  eq('1회매수금 19522/39', E.compute(S({}), [{ date: '2026-03-16', type: 'full_buy', price: 47.8, quantity: 10 }]).buyAmount, 500.56);
  eq('처음매수 617.89', pq(E.orders({ phase: '처음매수', buyAmount: 617.89 }, S({}), undefined, 45.93)), [['★처음매수', 'LOC', 51.44, 12]].concat(L([47.53, 44.13, 41.19, 38.61, 36.34, 34.32, 32.52])));
  eq('전반전 539.23', pq(E.orders({ phase: '전반전', buyAmount: 539.23, buyPoint: 78.11, avgPrice: 69.75, isFirstHalf: true, totalQuantity: 0 }, S({}), undefined, 75)), [['★별지점', 'LOC', 78.11, 3], ['평단가', 'LOC', 69.75, 4]].concat(L([67.40, 59.91, 53.92, 49.02, 44.93, 41.47, 38.51])));
  eq('후반전 568.50', pq(E.orders({ phase: '후반전', buyAmount: 568.50, buyPoint: 59.54, avgPrice: 66, isFirstHalf: false, totalQuantity: 0 }, S({}), undefined, 58)), [['★별지점', 'LOC', 59.54, 9]].concat(L([56.85, 51.68, 47.37, 43.73, 40.60, 37.90, 35.53, 33.44])));
  eq('매도 141주', pq(E.orders({ phase: '후반전', buyAmount: 0, buyPoint: 0, totalQuantity: 141, sellPoint: 59.55, limitSellPrice: 75.76 }, S({}), undefined, 58)), [['★쿼터매도', 'LOC', 59.55, 35], ['15%지정가', '지정가', 75.76, 106]]);
  // 카페 79264 (리버스모드)
  eq('리버스 쿼터매수 544.47', pq(E.orders({ phase: '소진모드', remainingCapital: 544.47 * 4, totalQuantity: 220 }, S({}), { starPrice: 48.62, isFirstDay: false }, 47)), [['★리버스매도', 'LOC', 48.62, 11], ['★쿼터매수', 'LOC', 48.61, 11]].concat(L([45.37, 41.88, 38.89, 36.29, 34.02, 32.02, 30.24, 28.65])));
  const sq = (n, q) => E.orders({ phase: '소진모드', remainingCapital: 0, totalQuantity: q }, S({ splits: n }), { starPrice: 50, isFirstDay: true }, 47)[0].quantity;
  eq('리버스 첫날 MOC 수량', [sq(40, 200), sq(40, 190), sq(40, 181), sq(40, 172), sq(20, 200), sq(20, 198)], [10, 9, 9, 8, 20, 19]);
  eq('쿼터매수 1주 불가 → MOC', pq(E.orders({ phase: '소진모드', remainingCapital: 100, totalQuantity: 200 }, S({}), { starPrice: 50, isFirstDay: false }, 47)), [['MOC매도', 'MOC', 0, 10]]);
  const t1 = E.nextT(39.5, 'reverse_sell', 40), t2 = E.nextT(t1, 'reverse_quarter_buy', 40);
  eq('T값 규칙', [E.nextT(7, 'full_buy', 40), E.nextT(7, 'half_buy', 40), r2(E.nextT(7, 'quarter_sell', 40)), E.nextT(8, 'limit_sell_buy_full', 40), E.nextT(8, 'limit_sell_buy_half', 40), Math.round(t1 * 1e6) / 1e6, Math.round(t2 * 1e6) / 1e6], [8, 7.5, 5.25, 3, 2.5, 37.525, 38.14375]);
  eq('단계 경계 40분할', [19.99, 20, 39, 39.01].map(t => E.compute(S({}), [], { tValue: t, avgPrice: 50, totalQuantity: 10 }).phase), ['전반전', '후반전', '후반전', '소진모드']);
  // 카페 53077 (큰수 매수)
  const st53 = { phase: '전반전', buyAmount: 1000, buyPoint: 41.34, avgPrice: 39.71, isFirstHalf: true, totalQuantity: 0 };
  eq('큰수 33.33 → 30주', pq(E.orders(st53, S({ bigNumPercent: 11.1 }), undefined, 30)), [['★큰수', 'LOC', 33.33, 30]].concat(L([32.25, 31.25, 30.3, 29.41, 28.57, 27.77, 27.02])));
  eq('큰수 34.48 → 29주', pq(E.orders(st53, S({ bigNumPercent: 14.9333 }), undefined, 30)).slice(0, 3), [['★큰수', 'LOC', 34.48, 29]].concat(L([33.33, 32.25])));
  // 모의 계산 (가이드북 3-1) — 리버스 진입·복귀가 일어나는지
  const G = window.mhGuideFill;
  if (G) {
    const P = G.simPaths(), sim = (k, n) => E.simulate(S({ splits: n }), P[k]);
    const d20 = sim('down', 20), v20 = sim('v', 20), v40 = sim('v', 40);
    eq('모의: 꾸준한 하락 20분할 소진일·리버스', [d20.exhaustDay, d20.reverse, d20.revDays > 0], [20, true, true]);
    eq('모의: V자 20분할 소진→복귀→회차 종료', [v20.exhaustDay > 0, v20.backs > 0, v20.endDay > 0], [true, true, true]);
    eq('모의: V자 40분할 소진 없이 종료', [v40.exhaustDay, v40.endDay > 0, v40.pnlPct > 0], [0, true, true]);
  } else R.push({ name: 'mhGuideFill 없음', ok: false });
  // 고가 체결 (3-6 백테스트) — 지정가만 장중 체결되면 ¾ 매도·¼ 남김(T×0.25), 같은 날 LOC 매수도 되면 '지정가+매수'
  const base = [50, 50, 49, 48];                                  // 처음매수 → 매수 2번 (평단 약 49)
  // ① 큰수(전날 종가 +5%)보다 높고 별지점보다 낮게 마감 → 매수·쿼터매도 없이 지정가만: ¾ 매도·¼ 남김
  const SB = S({ splits: 20, targetProfit: 15, bigNumPercent: 5 });
  const f1 = E.compute(SB, E.simulate(SB, base).txs);
  const c1 = Math.round((f1.starPrice - 0.5) * 100) / 100, b1 = E.simulate(SB, base.concat([c1]), base.concat([60])), l1 = b1.txs[b1.txs.length - 1];
  eq('고가 체결: 지정가만 → ¾ 매도·¼ 남김', [c1 > base[3] * 1.05, l1.type, l1.quantity, l1.price, E.compute(SB, b1.txs).totalQuantity],
     [true, 'limit_sell', f1.totalQuantity - Math.max(1, Math.floor(f1.totalQuantity / 4)), f1.limitSellPrice, Math.max(1, Math.floor(f1.totalQuantity / 4))]);
  // ② 별지점 이상 마감 + 고가가 지정가에 닿음 → 쿼터매도 + 지정가 → 보유 0 · 회차 종료
  const b4 = E.simulate(SB, base.concat([Math.round((f1.starPrice + 0.5) * 100) / 100]), base.concat([60]));
  eq('고가 체결: 쿼터매도 + 지정가 → 회차 종료', [b4.endDay, E.compute(SB, b4.txs).totalQuantity], [4, 0]);
  // ③ 고가가 지정가에 닿은 뒤 급락해 LOC 매수도 체결 → '지정가+매수' (T×0.25+1/0.5)
  const b2 = E.simulate(S({ splits: 20, targetProfit: 15 }), base.concat([47]), base.concat([60])), l2 = b2.txs[b2.txs.length - 1];
  eq('고가 체결: 지정가 + 종가 매수', [l2.type.indexOf('limit_sell_buy') === 0, l2.sellPrice, l2.sellQuantity > 0, l2.quantity > 0], [true, f1.limitSellPrice, true, true]);
  const b3 = E.simulate(S({ splits: 20, targetProfit: 15 }), base.concat([52]));
  eq('고가 없으면 종가로 판단 (지정가 미체결)', b3.txs.some(t => t.type === 'limit_sell'), false);
  // 여러 회차 백테스트: 매일 평가금 = 엔진 compute 결과와 일치
  const px = [], hx = []; for (let i = 0; i < 400; i++) { const p = 50 * Math.exp(0.35 * Math.sin(i / 23) + i / 900) ; px.push(Math.round(p * 100) / 100); hx.push(Math.round(p * 1.02 * 100) / 100); }
  const bt = E.backtest(S({ splits: 20 }), px, 20000, hx), c0 = bt.cycles[0];
  const s0 = E.simulate(S({ splits: 20, totalCapital: 20000 }), px.map(x => x * 50 / px[0]), hx.map(x => x * 50 / px[0]));
  const v0 = E.compute(S({ splits: 20, totalCapital: 20000 }), s0.txs);
  eq('백테스트: 회차 여러 번 · 첫 회차 평가금 일치', [bt.cycles.length > 2, Math.abs(bt.eq[c0.days] - v0.remainingCapital) < 0.01, bt.eq.filter(v => v == null).length], [true, true, 0]);
  return R;
}"""

MUHANBT_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info });
  const res = () => window.MBTdebug && MBTdebug.R();
  for (let i = 0; i < 240 && !(res() && (!res().pre || res().pre.err)); i++) await W(250);
  const r = res(); if (!r) return [{ name: '백테스트 결과 없음 (60초)', ok: false, info: document.getElementById('mb-res') && document.getElementById('mb-res').innerText.slice(0, 200) }];
  ok('주소(#v=2.2&t=TQQQ…)로 조건 복원·자동 실행', r.S.ver === '2.2' && r.tk === 'TQQQ' && r.S.splits === 40 && r.S.target === 10, JSON.stringify([r.S.ver, r.tk, r.S.splits, r.S.target]));
  ok('핵심 숫자 6칸 · 버전 6개', document.querySelectorAll('#mb-res .mb-k').length === 6 && document.querySelectorAll('#mb-set .mb-ver').length === 6);
  ok('세금·수수료 포함 보기만 수수료·세금 계산 (미포함 보기는 0)', r.sn.fees > 0 && r.sg.fees === 0 && r.sg.tax === 0 && r.net.taxes.length > 0 && !r.gross.taxes.length, JSON.stringify([r.sn.fees, r.sg.fees, r.sn.tax]));
  ok('연도별 표', document.querySelectorAll('#mb-tb tbody tr').length >= 5);
  ok('상장 전: 재현을 붙였으면 오차 카드, 아니면 안내', (r.pre && r.pre.err && document.querySelector('.mb-pre')) || (!r.pre && /상장 전/.test(r.note || '')), r.pre ? JSON.stringify(r.pre.err) : r.note);
  const k0 = document.querySelector('#mb-res .mb-kpi').innerText;
  document.querySelector('#mb-res [data-view="gross"]').click(); await W(100);
  ok('보기 전환(미포함)', document.querySelector('#mb-res .mb-kpi').innerText !== k0);
  document.querySelector('#mb-res [data-tab="cycle"]').click(); await W(100);
  const nc = document.querySelectorAll('#mb-tb tbody tr').length;
  document.querySelector('#mb-res [data-tab="day"]').click(); await W(100);
  ok('사이클별·일자별 표', nc === r.gross.cycles.length && document.querySelectorAll('#mb-tb tbody tr').length === 50, nc + ' / ' + r.gross.cycles.length);
  document.querySelector('#mb-set [data-ver="1.0"]').click(); await W(50);
  document.querySelector('#mb-set [data-tk="SOXL"]').click(); await W(50);
  document.getElementById('mb-pre').checked = false; document.getElementById('mb-pre').dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#mb-set [data-act="run"]').click();
  for (let i = 0; i < 120 && !(res() && res().S.ver === '1.0' && res().tk === 'SOXL'); i++) await W(250);
  const r2 = res();
  ok('V1.0 SOXL 다시 실행 · 기본값(40분할·10%·큰수 15%) · 주소 갱신', r2.S.ver === '1.0' && r2.S.splits === 40 && r2.S.target === 10 && r2.S.big === 15 && /v=1\\.0/.test(location.hash) && /t=SOXL/.test(location.hash), location.hash);
  ok('실행 기록 저장', (JSON.parse(localStorage.getItem('mbt-history') || '[]')).length >= 2);
  return R;
}"""

MUHANV_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), $ = q => document.querySelector(q);
  const click = q => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.click(); }, fill = (q, v) => { const e = $(q); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  try {
    ok('설정: 버전 6개 (V1.0~V4.0) · 50~100분할 단추 없음', document.querySelectorAll('[data-act="su-ver"]').length === 6 && !document.querySelector('[data-act="su-splits"][data-v="50"]'));
    click('[data-act="su-ver"][data-v="2.2"]'); await W(50);
    ok('V2.2 기본값 (40분할 · R 10 · 큰수 15)', MH.setup.splits === 40 && MH.setup.target === '10' && MH.setup.big === '15', JSON.stringify(MH.setup));
    fill('[data-in="su:cap"]', '20000'); click('[data-act="su-start"]'); await W(300);
    let D = MHdebug.curD();
    ok('V2.2 세션 시작 → 처음 매수 주문', D.old && D.ver === '2.2' && D.st.phase === '처음매수' && (D.close == null || D.orders.some(o => o.tag === 'first')), D.st.phase + ' ' + D.orders.length);
    if (D.close != null) {
      click('[data-act="rec-open"]'); await W(200);
      ok('기록 시트 (주문표 줄마다 체결 체크)', MH.sheet && MH.sheet.kind === 'vrec' && MH.sheet.rows.length > 0);
      click('#mh-vr-save'); await W(200); D = MHdebug.curD();
      ok('기록 저장 → 오늘 기록 ✓', D.txs.length === 1 && D.recorded);
    }
    for (let i = 0; i < 80 && !/총수익률|받지 못/.test(($('#mh-bt') || {}).innerText || ''); i++) await W(250);
    ok('화면 안 백테스트 (V2.2 · 기간 단추 · 자세히 링크)', /총수익률/.test($('#mh-bt').innerText) && document.querySelectorAll('#mh-bt [data-act="bt-per"]').length === 5 && /muhan-backtest\\/#v=2\\.2/.test($('#mh-bt a').getAttribute('href')), ($('#mh-bt') || {}).innerText);
    MH.menu = true; MHdebug.render(); click('.mh-menu [data-act="ses-add"]'); await W(100);
    fill('[data-in="su:spc"]', '25'); fill('[data-in="su:cap"]', '20000'); click('[data-act="su-start"]'); await W(300);
    D = MHdebug.curD();
    ok('V4.0 분할 직접 입력 25 → 비추천 표시 · 주문표', !D.old && D.s.splits === 25 && /비추천/.test($('.mh-top').innerText) && (D.close == null || D.orders.length > 0), D.s.splits);
  } catch (e) { ok('기록 화면 흐름 오류', false, String(e && e.message)); }
  return R;
}"""

ETF_JS = """async (local) => {
  const R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), W = ms => new Promise(r => setTimeout(r, ms));
  const S = window.ECXdebug && ECXdebug.S, X = window.ECX, $ = id => document.getElementById(id);
  if (!S || !X || !S.L) return { R: [{ name: 'ECX·ECXdebug·목록 없음', ok: false }], m: {}, S1y: 0, maxS: 0, late: false, ix: {} };
  const done = async () => { for (let i = 0; i < 450; i++) { if (!Object.keys(S.pend).length && !Object.keys(S.distP).length && !Object.keys(S.exP).length && !Object.keys(S.pgP).length && (!S.fx || S.fxd) && S.sel.every(s => !S.data[s.k + s.c] || ECXdebug.prepOf(s))) return; await W(100); } };
  const keys = () => S.sel.map(s => s.k + s.c), last = () => S.last, click = q => document.querySelector(q).click();
  const type = async q => { const i = $('ecx-q'); i.focus(); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await W(60); };
  const enter = async () => { $('ecx-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await W(80); };
  const per = async p => { click('#ecx-per [data-per="' + p + '"]'); await W(60); };
  const mode = async m => { click('#ecx-mode [data-m="' + m + '"]'); await W(60); };
  const rets = () => { const o = {}; last().list.forEach(x => { const t = x.st; o[S.sel[x.i].k + S.sel[x.i].c] = { ret: t.ret, cagr: t.cagr, ann: t.ann, tax: t.tax, fee: t.fee, n: t.n, nk: t.nk, na: t.na, nf: t.nf,
    mdd: t.mdd, vol: t.vol, p0: t.p0, pE: t.pE, pDay: t.pDay, pKind: t.pKind, endDay: t.endDay, xb: t.xb, xe: t.xe, open: t.open }; }); return o; };
  // 표 '기준 가격 → 끝 가격' 칸 = 계산에 쓴 날짜·시가/종가·가격 (정렬 안 한 표는 고른 순서대로) → 틀린 칸 목록
  const P2 = x => Math.round(x * 100) / 100, num2 = t => +t.replace(/,/g, '');
  const cellBad = () => last().list.filter(o => { const tr = [...document.querySelectorAll('#ecx-stats tr')][o.i], c = tr && tr.cells[6], st = o.st;
    const m = c && /^(\\d{4})[.-](\\d\\d)[.-](\\d\\d) (시가|종가|open|close) [$₩]?([\\d,]+(?:\\.\\d+)?)원?→ (\\d{4})[.-](\\d\\d)[.-](\\d\\d) (종가|close) [$₩]?([\\d,]+(?:\\.\\d+)?)/.exec(c.textContent);
    return !m || m[1] + '-' + m[2] + '-' + m[3] !== X.ymdOf(st.pDay) || /시가|open/.test(m[4]) !== (st.pKind === 'o') || Math.abs(num2(m[5]) - P2(st.p0)) > 1e-9
      || m[6] + '-' + m[7] + '-' + m[8] !== X.ymdOf(st.endDay) || Math.abs(num2(m[10]) - P2(st.pE)) > 1e-9; }).map(o => { const tr = [...document.querySelectorAll('#ecx-stats tr')][o.i]; return tr && tr.cells[6] ? tr.cells[6].textContent.slice(0, 90) : o.i; });
  const isK = o => S.sel[o.i].k === 'K';
  await done();
  // 1. 처음 화면: 기본 4개 · 1Y · 시장가
  const rows = () => [...document.querySelectorAll('#ecx-stats tr')];
  ok('처음: 기본 4개 · 1Y · 시장가(버튼 2개 중 시장가) · 주소', JSON.stringify(keys()) === '["K069500","K360750","USPY","UQQQ"]' && S.per === '1Y' && S.mode === 'px' && location.hash === '#e=K069500,K360750,USPY,UQQQ&p=1Y' && document.querySelectorAll('#ecx-mode button').length === 2 && document.querySelector('#ecx-mode button.on').dataset.m === 'px', [keys(), S.per, S.mode, location.hash]);
  ok('처음: 표 4줄 × 7칸(기간 수익률·CAGR·연환산·최대 낙폭·변동성) · 범례 4 · 차트 선 4(굵기 1)', rows().length === 4 && rows().every(r => r.cells.length === 7 && /%/.test(r.cells[1].textContent)) && document.querySelectorAll('#ecx-head th').length === 7 && document.querySelectorAll('#ecx-leg span').length === 4 && S.chart && S.chart.data.datasets.length === 4 && S.chart.data.datasets.every(d => d.borderWidth === 1), rows().map(r => r.textContent.slice(0, 50)));
  ok('기간설정 날짜 칸은 처음에 숨김 · 재투자 수수료 칸은 시장가에서 숨김', getComputedStyle($('ecx-custom')).display === 'none' && $('ecx-fees').hidden && getComputedStyle($('ecx-fees')).display === 'none', '');
  ok('상장 전 백테스트: 처음부터 켜짐(체크) · 주소에 bt 없음', $('ecx-bt').checked && S.bt === true && !/&bt=/.test(location.hash), [$('ecx-bt').checked, S.bt, location.hash]);
  // 아래는 실제 가격 시나리오(상장일·실제 거래 가격 기준) → 백테스트를 끄고 확인 (백테스트는 따로 BT_JS 에서)
  $('ecx-bt').click(); await W(80); await done();
  ok('백테스트 끄기 → 주소 &bt=0', S.bt === false && /&bt=0/.test(location.hash), location.hash);
  let r = last(); const E = Math.max(...r.list.map(o => o.s.d[o.s.d.length - 1]));
  ok('1Y: E = 가장 최근 거래일 · S = 그 12개월 전', r.w.E === E && r.w.S === X.addMonths(E, -12), [X.ymdOf(r.w.S), X.ymdOf(r.w.E)]);
  const infos = () => rows().map(tr => (tr.querySelector('.ecx-info') || {}).textContent || '');
  const M = { px: rets() }, iPx = infos(); await mode('nav'); M.nav = rets(); const hNav = location.hash, fNav = !$('ecx-fees').hidden, iNav = infos(); await mode('px');
  ok('보기 2가지: 시장가 < 기준가(분배 있는 종목, 없으면 같음) · 주소 m=nav · 시장가(기본)는 주소에 m 없음 · 수수료 칸은 기준가에서만', Object.keys(M.px).every(k => M.nav[k].n === 0 ? Math.abs(M.nav[k].ret - M.px[k].ret) < 1e-12 : M.px[k].ret < M.nav[k].ret) && /&m=nav/.test(hNav) && !/&m=/.test(location.hash) && fNav && $('ecx-fees').hidden, [hNav, location.hash, M.px, M.nav]);
  ok('시장가: 세금·수수료 0 · 기준가: 세금·재투자 수수료 > 0 (분배 있는 종목)', Object.keys(M.px).every(k => M.px[k].tax === 0 && M.px[k].fee === 0 && (M.nav[k].n === 0 || (M.nav[k].tax > 0 && M.nav[k].fee > 0))), '');
  const kr = /과세표준 (운용사 공개 \\d+회|공개 \\d+\\/\\d+회)|taxable base (published ×\\d+|\\d+\\/\\d+ published)/, avg = /나머지는 공개 회차 평균 비율|rest at the published average ratio/, nOf = i => M.px[keys()[i]].n;
  ok('표 이름 아래 — 시장가: 분배 n회 제외 · 기준가: 재투자 회차·과세표준 공개 회차(모르는 회차는 평균 비율 표시)·미국 배당세 15.4%·원금 대비 세금·재투자 수수료', iPx.every((t, i) => nOf(i) === 0 ? t === '' : /^분배 \\d+회 제외$|^\\d+ distributions? excluded$/.test(t)) && [0, 1].every(i => nOf(i) === 0 || (kr.test(iNav[i]) && avg.test(iNav[i]) === (M.nav[keys()[i]].na > 0))) && [2, 3].every(i => nOf(i) === 0 || /배당세 15\\.4%|15\\.4% dividend tax/.test(iNav[i])) && iNav.every((t, i) => nOf(i) === 0 ? t === '' : /원금 대비 세금 (\\d+\\.\\d\\d%|0\\.01% 미만) · 재투자 수수료 (\\d+\\.\\d\\d%|0\\.01% 미만)$|tax (\\d+\\.\\d\\d%|under 0\\.01%) · reinvestment fees (\\d+\\.\\d\\d%|under 0\\.01%) of principal$/.test(t)), [iPx, iNav]);
  const pts = r.pts; ok('차트: 같은 날짜 축 · 끝 = 표 수익률', pts.y.every(y => y.length === pts.x.length) && r.list.every((o, k) => { const y = pts.y[k]; return Math.abs(y[y.length - 1] - Math.round(o.st.ret * 1e4) / 100) < 0.011; }), '');
  ok('1Y: 기준 = 기준일(그날 또는 그 전 마지막 거래일) 종가 · 끝 = 마지막 거래일 종가 · 시장가 수익률 = 끝 가격 ÷ 기준 가격 − 1', r.list.every(o => !o.st.open && o.st.pKind === 'c' && o.st.pDay === o.st.baseDay && o.st.baseDay <= r.w.S && o.st.endDay === o.s.d[o.s.d.length - 1] && Math.abs(o.st.ret - (o.st.pE / o.st.p0 - 1)) < 1e-12), r.list.map(o => [X.ymdOf(o.st.pDay), o.st.pKind, o.st.p0, o.st.pE]));
  ok('국내 ETF 기준·끝 가격 = 실제 거래 가격으로 확인됨(수정주가 역산 아님)', r.list.filter(isK).every(o => o.st.xb && o.st.xe), r.list.filter(isK).map(o => [S.sel[o.i].c, o.st.xb, o.st.xe]));
  ok('표: 머리 "기준 가격 → 끝 가격" · 칸 = 계산에 쓴 날짜·종가·가격', /기준 가격 → 끝 가격|Start → end price/.test(document.querySelectorAll('#ecx-head th')[6].textContent) && cellBad().length === 0, cellBad());
  const S1y = r.w.S;
  // 2. 정렬: 표 머리 → 내림차순 → 오름차순 · 값 없는 줄은 맨 뒤
  const col = k => rows().map(tr => { const t = tr.cells[1 + ['ret', 'cagr', 'ann', 'mdd', 'vol'].indexOf(k)]; return t ? t.textContent : ''; });
  const num = t => t === '—' ? null : parseFloat(t.replace('−', '-').replace('+', ''));
  click('#ecx-head [data-sort="ret"]'); await W(60); const d1 = col('ret').map(num);
  click('#ecx-head [data-sort="ret"]'); await W(60); const a1 = col('ret').map(num);
  ok('정렬: 기간 수익률 내림차순 → 오름차순', d1.every((v, i) => i === 0 || v <= d1[i - 1]) && a1.every((v, i) => i === 0 || v >= a1[i - 1]) && document.querySelector('#ecx-head [data-sort="ret"]').textContent.indexOf('▲') > 0, [d1, a1]);
  click('#ecx-head [data-sort="mdd"]'); await W(60); const m1 = col('mdd').map(num);
  ok('정렬: 다른 머리 누르면 그 칸 내림차순', m1.every((v, i) => i === 0 || v <= m1[i - 1]), m1);
  S.sort = null; ECXdebug.render();
  // 3. 재투자 수수료 바꾸기 (기준가) → 국내 ETF 만 바뀜 · 주소 fk · 시장가는 수수료와 무관
  await mode('nav'); const before = rets(); const fk = $('ecx-fk'); fk.value = '0.5'; fk.dispatchEvent(new Event('input', { bubbles: true })); await W(400);
  const after = rets(); await mode('px'); const pxAfter = rets(); const hFee = location.hash;
  ok('기준가: 국내 재투자 수수료 0.5% → 국내 ETF 수익률 낮아짐 · 미국은 그대로 · 주소 fk=0.5 · 시장가는 그대로', (nOf(0) === 0 || after.K069500.ret < before.K069500.ret) && Math.abs(after.USPY.ret - before.USPY.ret) < 1e-12 && /&fk=0.5/.test(hFee) && Math.abs(pxAfter.K069500.ret - M.px.K069500.ret) < 1e-12, [before.K069500.ret, after.K069500.ret, hFee]);
  await mode('nav'); fk.value = '0.015'; fk.dispatchEvent(new Event('input', { bubbles: true })); await W(400); fk.blur(); await mode('px');
  // 4. 검색 · 추가 · 최대 10개
  await type('spy'); const sug = [...document.querySelectorAll('#ecx-sug li[data-key]')].map(l => l.dataset.key);
  ok('검색 spy → 첫 줄 SPY', sug[0] === 'USPY', sug.slice(0, 3));
  await enter(); ok('이미 고른 ETF → 안내 · 그대로 4개', /이미|Already/.test(($('ecx-toast') || {}).textContent || '') && S.sel.length === 4, '');
  await type('0167A0'); await enter(); await done();
  ok('종목코드 0167A0 → 추가 (5개) · 검색칸 비움', keys().length === 5 && keys()[4] === 'K0167A0' && $('ecx-q').value === '', keys());
  $('ecx-toast').textContent = '-'; await enter();
  ok('빈 검색칸에서 Enter → 지난 제안이 다시 추가되지 않음', keys().length === 5 && $('ecx-toast').textContent === '-', [keys(), $('ecx-toast').textContent]);
  ['UVOO', 'UIVV', 'UQQQM', 'UDIA', 'USCHD'].forEach(k => ECXdebug.add(k)); await done();
  ok('10개까지 추가 · 색 10가지 모두 다름', S.sel.length === 10 && new Set(S.sel.map(s => s.color)).size === 10 && $('ecx-count').textContent.trim() === '10 / 10', [S.sel.length, $('ecx-count').textContent]);
  await type('iwm'); await enter();
  ok('11번째 → 최대 10개 안내 · 그대로 10개', /최대 10개|Up to 10/.test($('ecx-toast').textContent) && S.sel.length === 10, $('ecx-toast').textContent);
  $('ecx-q').value = ''; $('ecx-q').dispatchEvent(new Event('input', { bubbles: true })); $('ecx-q').blur();
  ['UVOO', 'UIVV', 'UQQQM', 'UDIA', 'USCHD'].forEach(k => ECXdebug.remove(k));
  // 4b. 지수: 시장 단추 '지수' · 검색 · 추가 · 칩·표 표시 · 시장가 = 기준가 · 주소
  const idxN = S.L.filter(x => x.k === 'I');
  ok('지수 12개(국내 3 · 미국 9) 목록에 들어 있음 · 소개 문구 숫자', idxN.length === 12 && idxN.filter(x => x.rg === 'K').length === 3 && $('ecx-nidx').textContent === '12', idxN.map(x => x.key));
  click('.ecx-mk button[data-mk="I"]'); await type('코스피');
  const sugI = [...document.querySelectorAll('#ecx-sug li[data-key]')].map(l => l.dataset.key);
  ok('지수 단추 + "코스피" → 지수만 · 첫 줄 코스피', sugI.length > 0 && sugI.every(k => k[0] === 'I') && sugI[0] === 'IKOSPI', sugI);
  await enter(); click('.ecx-mk button[data-mk="all"]'); $('ecx-q').value = ''; $('ecx-q').blur(); ECXdebug.add('ISPX'); await done();
  const idxRows = () => rows().filter(tr => /가격 지수|price index/.test(tr.textContent));
  ok('지수 2개 추가 → 7개 · 칩 배지 "지수" · 표: 가격 지수·배당 미포함 · 자료 시작(상장 아님) · 주소', JSON.stringify(keys().slice(-2)) === '["IKOSPI","ISPX"]' && keys().length === 7 && document.querySelectorAll('#ecx-sel .ecx-mkb.I').length === 2 && idxRows().length === 2 && idxRows().every(tr => /자료 시작|Data from/.test(tr.cells[6].textContent) && !/상장|listing/.test(tr.cells[6].textContent)) && /,IKOSPI,ISPX&/.test(location.hash), [keys(), location.hash]);
  const IX = { px: rets() }; await mode('nav'); IX.nav = rets(); await mode('px');
  ok('지수: 시장가 = 기준가 · 세금·수수료 0 · 분배 0', ['IKOSPI', 'ISPX'].every(k => IX.px[k] && IX.nav[k] && Math.abs(IX.px[k].ret - IX.nav[k].ret) < 1e-12 && IX.nav[k].tax === 0 && IX.nav[k].fee === 0 && IX.nav[k].n === 0), [IX.px.IKOSPI, IX.nav.ISPX]);
  ok('지수 있을 때 차트 아래 설명: 직접 살 수 없는 기준 지표 · 가격 지수 배당 미포함', /직접 살 수 없는 기준 지표|benchmarks you cannot buy/.test($('ecx-range').textContent), $('ecx-range').textContent.slice(-200));
  ECXdebug.remove('IKOSPI'); ECXdebug.remove('ISPX');
  // 5. MAX = 고른 ETF 중 가장 늦게 상장한 ETF 의 첫 거래일
  await per('MAX'); r = last(); const firsts = r.list.map(o => o.s.d[0]), maxS = r.w.S;
  ok('MAX: 기준일 = 가장 늦게 상장한 ETF 첫 거래일 · 모두 그날(또는 그 뒤 첫 거래일) 시가부터', maxS === Math.max(...firsts) && r.list.length === 5 && r.list.every(o => !o.st.late && o.st.open && o.st.baseDay >= maxS && o.st.baseDay - maxS < 7 && (o.st.pKind === 'o' ? o.st.pDay === o.st.baseDay : o.st.pDay < o.st.baseDay)), [X.ymdOf(maxS), firsts.map(X.ymdOf), r.list.map(o => [X.ymdOf(o.st.pDay), o.st.pKind])]);
  ok('MAX: 차트는 기준일 반나절 앞(시가) 0% 에서 출발 · 표 칸 = 시가·가격', r.list.every((o, k) => { const t = r.pts.x.indexOf(o.st.x0); return o.st.x0 === o.st.baseDay - 0.5 && t >= 0 && r.pts.y[k][t] === 0 && (t === 0 || r.pts.y[k][t - 1] == null); }) && r.pts.x[0] === Math.min(...r.list.map(o => o.st.x0)) && cellBad().length === 0, cellBad());
  ok('MAX: 설명에 가장 늦게 상장한 ETF·첫 거래일', /가장 늦게 상장한|most recently listed/.test($('ecx-range').textContent) && $('ecx-range').textContent.indexOf(X.ymdOf(maxS).replace(/-/g, '.')) >= 0, $('ecx-range').textContent.slice(0, 160));
  // 6. 1M·3M·6M·YTD·1Y
  for (const [p, n] of [['1M', 1], ['3M', 3], ['6M', 6]]) { await per(p); r = last(); ok(p + ': S = E 의 ' + n + '개월 전 · 버튼 표시', r.w.S === X.addMonths(r.w.E, -n) && document.querySelector('#ecx-per .chart-tab.active').dataset.per === p, X.ymdOf(r.w.S)); }
  await per('YTD'); r = last(); const y0 = new Date(r.w.E * 864e5).getUTCFullYear() - 1;
  ok('YTD: S = 지난해 12월 31일 · 기준 = 그날 또는 그 전 마지막 거래일 종가', X.ymdOf(r.w.S) === y0 + '-12-31' && r.list.filter(o => !o.st.late).every(o => X.ymdOf(o.st.baseDay).slice(0, 4) === String(y0) && o.st.pKind === 'c' && o.st.pDay === o.st.baseDay), X.ymdOf(r.w.S));
  ok('YTD: 1년 미만 → CAGR 없음(—) · 연환산 있음', r.list.every(o => o.st.cagr === null && o.st.ann !== null), '');
  await per('1Y'); r = last(); const late = r.list.some(o => o.st.late);
  ok('1Y: 기간 시작 뒤 상장한 ETF 는 상장일 시가부터(표에 기간 중 상장) · 나머지는 기준일 종가', r.list.every(o => o.st.late === (o.s.d[0] > r.w.S) && (o.st.late ? o.st.pKind === 'o' && o.st.pDay === o.s.d[0] : o.st.pKind === 'c')) && (!late || /기간 중 상장|Listed in period/.test($('ecx-stats').textContent)) && cellBad().length === 0, cellBad());
  // 7. 기간설정
  await per('C'); ok('기간설정 → 날짜 칸 보임 · 지금 범위로 채움', getComputedStyle($('ecx-custom')).display !== 'none' && $('ecx-from').value === X.ymdOf(last().w.S), [$('ecx-from').value, $('ecx-to').value]);
  const f = X.ymdOf(X.addMonths(last().w.E, -5)), t = X.ymdOf(X.addMonths(last().w.E, -1));
  $('ecx-from').value = f; $('ecx-to').value = t; click('#ecx-apply'); await W(60); r = last();
  await done(); r = last();
  ok('기간설정 적용 → 기준(시작일 또는 그 뒤 첫 거래일 시가)·끝(끝날 또는 그 전 종가) · 주소', X.ymdOf(r.w.S) === f && X.ymdOf(r.w.E) === t && r.list.every(o => o.st.open && o.st.pKind === 'o' && o.st.baseDay >= r.w.S && o.st.endDay <= r.w.E) && location.hash.indexOf('&p=C' + f.replace(/-/g, '') + '-' + t.replace(/-/g, '')) > 0, [X.ymdOf(r.w.S), X.ymdOf(r.w.E), location.hash]);
  $('ecx-from').value = t; $('ecx-to').value = f; click('#ecx-apply'); await W(60);
  ok('기간설정: 시작 ≥ 끝 → 안내 · 이전 범위 유지', /앞이어야|must be before/.test($('ecx-err').textContent) && X.ymdOf(last().w.S) === f, $('ecx-err').textContent);
  await per('1Y');
  // 8. 빼기 · 원화 환산
  click('#ecx-sel [data-del="K0167A0"]'); await W(60);
  ok('빼기 → 4개', S.sel.length === 4 && keys().indexOf('K0167A0') < 0, keys());
  const b1 = rets(); click('#ecx-fx'); await done(); await W(60); const b2 = rets();
  const fxOf = () => { const it = S.sel.find(s => s.c === 'SPY'), s = ECXdebug.prepOf(it), o = ECXdebug.optOf(it, s), w = last().w, x = last().list.find(o => S.sel[o.i].c === 'SPY'); if (!o.fx || !x) return false;
    const bi = X.idxLE(s.d, w.S), ei = X.idxLE(s.d, w.E), v = X.valueSeries(s, bi, ei, S.mode, { fee: S.feeU / 100 }); return Math.abs(x.st.ret - (v.v[v.v.length - 1] * o.fx[ei] / o.fx[bi] - 1)) < 1e-12; };
  let fxOk = fxOf(); await mode('nav'); fxOk = fxOk && fxOf(); await mode('px');
  ok('원화 환산: 미국 ETF 가치 × 그날 원/달러 ÷ 시작일 원/달러 · 국내는 그대로 · 주소 fx=1', fxOk && Math.abs(b2.K069500.ret - b1.K069500.ret) < 1e-12 && Math.abs(b2.USPY.ret - b1.USPY.ret) > 1e-9 && /&fx=1/.test(location.hash), [b1.USPY.ret, b2.USPY.ret]);
  click('#ecx-fx'); await W(60);
  // 9. 묶음 버튼 · 검색 순서 · 목록
  const pb = [...document.querySelectorAll('#ecx-presets button[data-p]')];
  ok('자주 비교하는 조합 9개', pb.length === 9, pb.length);
  const ip = pb.find(b => /국내·미국 대표 지수|Major indices/.test(b.textContent)); if (ip) { ip.click(); await done(); }
  ok('묶음 "국내·미국 대표 지수" → 지수 6개', JSON.stringify(keys()) === '["IKOSPI","IKOSDAQ","ISPX","ICOMP","INDX","IDJI"]' && last().list.length === 6, keys());
  const kp = pb.find(b => /코스피 vs S&P500|KOSPI vs S&P 500/.test(b.textContent)); if (kp) { kp.click(); await done(); }
  ok('묶음 "코스피 vs S&P500" → 3개', JSON.stringify(keys()) === '["K069500","K360750","USPY"]', keys());
  const top = (q, mk, n) => X.search(S.L, q, mk || 'all', n || 30).map(x => x.k + x.c);
  ok('검색: 티커·코드 정확히 먼저 · 한글 별칭 · 띄어 쓴 낱말', top('SPY')[0] === 'USPY' && top('069500')[0] === 'K069500' && top('슈드')[0] === 'USCHD' && top('kodex 200')[0] === 'K069500' && top('나스닥 3배').indexOf('UTQQQ') >= 0, [top('SPY')[0], top('슈드')[0], top('나스닥 3배').slice(0, 3)]);
  const sp = top('s&p500', 'all', 6); ok('검색 "s&p500": 국내·미국이 함께', sp.some(k => k[0] === 'K') && sp.some(k => k[0] === 'U'), sp);
  ok('검색: 지수 이름·별칭이 먼저 (코스피·S&P500·나스닥·나스닥 100·다우)', top('코스피')[0] === 'IKOSPI' && top('S&P500')[0] === 'ISPX' && top('나스닥')[0] === 'ICOMP' && top('나스닥 100')[0] === 'INDX' && top('다우')[0] === 'IDJI' && top('코스피', 'U').indexOf('IKOSPI') < 0, [top('코스피')[0], top('S&P500')[0], top('나스닥')[0]]);
  ok('목록: 국내 1,000개 이상 · 미국 3,000개 이상', S.L.filter(x => x.k === 'K').length > 1000 && S.L.filter(x => x.k === 'U').length > 3000, '');
  // 10. 기간설정(시가 기준) 주소로 열기 — 국내 ETF 3 · 미국 1 · 지수 1 (야후에 빠진 기준·끝날은 네이버 일별 시세 한 쪽으로 채워 실제 가격 확인)
  S.sort = null; location.hash = '#e=K069500,K360750,K498400,USPY,IKOSPI&p=C20260509-20260909&bt=0'; await W(200); await done(); r = last();
  const C = rets(), KC = r.list.filter(isK);
  ok('주소로 기간설정 열기 → 5개 · 시작일(또는 그 뒤 첫 거래일) 시가 → 끝날(또는 그 전 마지막 거래일) 종가', keys().join() === 'K069500,K360750,K498400,USPY,IKOSPI' && S.per === 'C' && r.list.length === 5 && r.list.every(o => o.st.open && o.st.pKind === 'o' && o.st.pDay === o.st.baseDay && o.st.baseDay >= r.w.S && o.st.endDay <= r.w.E), [keys(), S.per, r.list.map(o => [X.ymdOf(o.st.pDay), o.st.pKind, X.ymdOf(o.st.endDay)])]);
  ok('기간설정: 국내 ETF 기준·끝 가격 모두 실제 거래 가격으로 확인 · 표 칸 = 계산 가격 · 시장가 수익률 = 끝 ÷ 기준 − 1', KC.length === 3 && KC.every(o => o.st.xb && o.st.xe) && cellBad().length === 0 && r.list.every(o => Math.abs(o.st.ret - (o.st.pE / o.st.p0 - 1)) < 1e-12), [KC.map(o => [S.sel[o.i].c, o.st.xb, o.st.xe]), cellBad()]);
  // 11. 사용자가 찾은 사례(2026-10): 분배가 잦은 국내 ETF + 코스피 · MAX → 둘 다 그 ETF 상장일 시가 → 마지막 거래일 종가
  location.hash = '#e=K498400,IKOSPI&p=MAX&bt=0'; await W(200); await done(); r = last();
  const XM = rets(), tt = S.chart && S.chart.options.plugins.tooltip.callbacks.title, x0 = r.w.S - 0.5;
  ok('MAX(분배 잦은 국내 ETF + 코스피): 둘 다 상장일 시가 → 마지막 거래일 종가 · 실제 가격 확인 · 표 칸 = 계산 가격', r.list.length === 2 && r.list.every(o => o.st.pKind === 'o' && o.st.pDay === r.w.S && o.st.endDay === o.s.d[o.s.d.length - 1] && Math.abs(o.st.ret - (o.st.pE / o.st.p0 - 1)) < 1e-12) && r.list[0].st.xb && r.list[0].st.xe && cellBad().length === 0, [r.list.map(o => [X.ymdOf(o.st.pDay), o.st.pKind, o.st.p0, o.st.pE, o.st.xb, o.st.xe]), cellBad()]);
  ok('MAX 차트: 상장일 반나절 앞 0% 에서 출발 · 툴팁 "… 시가"', r.pts.x[0] === x0 && r.pts.y.every(y => y[0] === 0) && !!tt && /시가|open/.test(tt([{ parsed: { x: x0 } }])) && !/시가|open/.test(tt([{ parsed: { x: r.w.S } }])), [r.pts.x[0], x0, tt && tt([{ parsed: { x: x0 } }])]);
  // 12. 실제 가격이 어디에도 없는 날(야후 빈 날 + 일별 시세 자료 시작 전)이 기준일 → 근사로 두고 표 가격 앞 ≈ · 기간 설명에 종목·날 수(같은 날을 두 번 세지 않음)
  //     같은 쪽의 다음 빈 날(2010-06-17)은 'first=' 답 뒤에 다시 받아 실제 가격으로 · 같은 날을 다시 묻지 않음
  if (local) {   // 합성 자료의 '야후 빈 날 + 일별 시세 자료 전' 날 (실제 자료에는 이 날이 정상이라 로컬에서만)
  location.hash = '#e=K069500&p=C20100615-20100630&bt=0'; await W(200); await done(); r = last();
  const o12 = r.list[0], n12 = (() => { let c = 0; if (o12) for (let t = o12.st.bi; t <= o12.st.ei; t++) if (!o12.s.xc[t]) c++; return c; })(), rg12 = $('ecx-range').textContent, c12 = rows()[0] && rows()[0].cells[6] ? rows()[0].cells[6].textContent : '';
  ok('실제 가격이 없는 기준일 → 근사 · 표 "2010.06.15 시가 ≈…" · 끝 가격은 실제(≈ 없음) · 설명 "근사한 날 … KODEX 200 1일"', !!o12 && n12 === 1 && !o12.st.xb && o12.st.xe && o12.st.pKind === 'o' && /^2010\\.06\\.15 시가 ≈[\\d,]+원→ 2010\\.06\\.30 종가 [\\d,]+원/.test(c12) && /근사한 날|approximated/.test(rg12) && /KODEX 200 1일/.test(rg12), [n12, c12, rg12.slice(-170)]);
  }
  return { R, m: M, S1y, maxS, late, ix: IX, c: C, xm: XM };
}"""

# ── ETF 차트 비교: 로컬 검사용 합성 자료 (Worker /etf · 국내 분배 이력 묶음 data/etfdist 대신) ──
#   실제 시가·종가·분배금이 정해져 있어 두 가지 보기(시장가·기준가)의 기대값을 여기서 직접 계산해 화면 숫자와 맞춰 봄
#   · 국내는 2025-10-03~09·2026-10-09 휴장(실제 달력과 같게)
#   · 국내 ETF 실제 가격 = 호가 단위(2,000원 이상 5원) 정수 · 네이버 수정주가(m=k) = 실제 가격 × 분배 조정 비율을 정수로 반올림하고
#     조정 오차(±0.05%)까지 넣음 → 수정주가 ÷ 구간 비율로 되살리면 틀린 가격이 나옴 (2026-10 사용자가 찾은 오류를 그대로 재현)
#     화면은 실제 거래 가격(m=kr 야후 일봉 · 빠진 날은 m=kp 네이버 일별 시세 한 쪽)을 써야 숫자가 맞음
#   · 야후(m=kr)에 빠진 날 ETF_YGAP: 1Y 기준일(K069500 2025-10-02 종가) · 기간설정 기준일(K360750 2026-05-11 시가)·끝날(K498400 2026-09-09 종가)
#     → 화면이 보고 있는 기간 안의 빈 날만 m=kp 로 받아 채워야 함 · 2010-06-15 는 일별 시세에도 없는 날(ETF_KPFIRST) → 근사로 두고 설명에 날 수 표시
#       같은 쪽의 2010-06-17(일별 시세 자료 첫날 뒤)은 'first=' 답을 받은 뒤 다시 받아 실제 가격으로 채워야 함
#   · K069500: 4회마다 과세표준 비공개(→ 같은 ETF 공개 회차 평균 비율로 계산) · K360750: 과세표준 = 분배금
#     K498400: 21거래일마다 큰 분배(전날 종가의 1.2%, 과세표준 10% · 5회마다 비공개) · 미국: 배당 15.4%
import datetime as _dt, math as _math
ETF_END = _dt.date(2026, 10, 9)
ETF_FIRST = {'K069500': _dt.date(2002, 10, 14), 'K360750': _dt.date(2020, 8, 7), 'USPY': _dt.date(1993, 1, 29),
             'UQQQ': _dt.date(1999, 3, 10), 'K0167A0': _dt.date(2026, 3, 17), 'K498400': _dt.date(2024, 12, 3)}
ETF_DIV = {'K069500': (30, 63, 0.006), 'K360750': (30, 63, 0.006), 'USPY': (30, 63, 0.006), 'UQQQ': (30, 63, 0.006),
           'K498400': (8, 21, 0.012)}   # (첫 분배락 거래일 번호, 간격(거래일), 분배금 ÷ 전날 종가)
ETF_KR_OFF = {_dt.date(2025, 10, d) for d in range(3, 10)} | {_dt.date(2026, 10, 9)}
ETF_NODATA = {'UNODATA'}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bt_synth   # noqa: E402  상장 전 백테스트 합성 식·금리·환율 + 파이썬 기준 기대값
ETF_FIRST.update(bt_synth.BT_FIRST); ETF_FIRST.update(bt_synth.CAL_FIRST); ETF_FIRST.update(bt_synth.DEP_FIRST)   # 백테스트 대상·후보 상장일 · 국내(코스피)·미국(^GSPC·^SP500TR) 달력 시작 · 후보 종목
ETF_FEE = {'K': 0.015 / 100, 'U': 0.25 / 100}
ETF_YGAP = {'K069500': {_dt.date(2010, 6, 15), _dt.date(2010, 6, 17), _dt.date(2025, 10, 2)}, 'K360750': {_dt.date(2026, 5, 11)}, 'K498400': {_dt.date(2026, 9, 9)}}
ETF_LOG = []   # 화면이 부른 실제 가격 주소 (m, 코드, 날짜, 화면이 추정한 쪽, 실제 쪽)
ETF_KPFIRST = {'K069500': '20100616'}   # 네이버 일별 시세 자료 첫날 (실제 069500 은 2003-04-04 부터) → 그 전 야후 빈 날(2010-06-15)은 실제 가격이 어디에도 없음
KR_ETF = re.compile(r'^K[0-9][0-9A-Z]{5}$')
_EP = _dt.date(1970, 1, 1)


def _seed(key):
    return sum(ord(c) * (i + 1) for i, c in enumerate(key))


def _tick(x):
    """국내 ETF 호가 단위 (2,000원 이상 5원 · 미만 1원)"""
    t = 5 if x >= 2000 else 1
    return int(_math.floor(x / t + 0.5)) * t


def _px(key, x):
    return _tick(x) if KR_ETF.match(key) else round(x, 2 if key[0] == 'K' else 4)   # 국내 ETF 정수 · 국내 지수 소수 2자리 · 미국 4자리


def etf_series(key):
    """key = 'K069500' · 'USPY' · 'KKOSPI'(국내 지수) … → (날짜 목록, 실제 종가 목록) · 목록에 없는 종목도 이름으로 정해지는 합성 값"""
    seed = _seed(key)
    d0 = ETF_FIRST.get(key) or _dt.date(2004 + seed % 16, 1 + seed % 12, 1 + seed % 27)
    days, d = [], d0
    while d <= ETF_END:
        if d.weekday() < 5 and not (key[0] == 'K' and d in ETF_KR_OFF):
            days.append(d)
        d += _dt.timedelta(1)
    a, b, c = 0.00015 + (seed % 7) * 0.00004, 0.06 + (seed % 5) * 0.02, 35 + (seed % 11) * 4
    k = 100.0 if key[0] == 'K' else 1.0
    out = [_px(key, 100 * k * _math.exp(a * t + b * _math.sin(t / c + seed))) for t in range(len(days))]
    if key == 'U^SP500TR':     # 미국 후보의 큰 하루 변화(30% 튀었다 돌아옴)는 정리하지 않음 — 화면·파이썬 모두 그대로 쓰는지 (USSO 백테스트)
        out[500] = _px(key, out[500] * 1.3)
    if key == 'K005930':       # 국내 후보의 자료 오류: 2003 튀었다 돌아옴(+55%) · 2007 가격제한폭(±15%) 밖 끊김(+40%) — 화면 btClean·파이썬 clean_dep 이 함께 정리하는지 (K091160 백테스트)
        out[1820] = _px(key, out[1820] * 1.55)
        out[2860:] = [_px(key, x * 1.4) for x in out[2860:]]
    return days, out


def etf_opens(key, raw):
    """실제 시가 — 전날 종가에서 ±0.4% 안쪽으로 출발 (상장일 시가는 그날 종가보다 약 1% 낮게)"""
    seed = _seed(key)
    return [_px(key, (raw[t - 1] if t else raw[0] * 0.99) * (1 + 0.004 * _math.sin(t * 1.7 + seed))) for t in range(len(raw))]


def etf_dists(key, raw):
    """[(분배락일 인덱스, 분배금, 주당 과세표준|None)]"""
    if key not in ETF_DIV: return []
    i0, step, rate = ETF_DIV[key]
    out = []
    for n, i in enumerate(range(i0, len(raw), step)):
        amt = round(raw[i - 1] * rate, 0 if key[0] == 'K' else 4)
        tax = (None if key[0] == 'U' else amt if key == 'K360750' else (None if n % 5 == 4 else round(amt * 0.1, 1)) if key == 'K498400'
               else (None if n % 4 == 3 else round(amt * 0.8, 1)))
        out.append((i, amt, tax))
    return out


def etf_factors(raw, dv):
    """분배 조정 비율 (그날 뒤의 분배락마다 × (1 − 분배금 ÷ 분배락 전날 종가)) — 마지막 분배락 뒤 = 1"""
    f, out, j = 1.0, [1.0] * len(raw), len(dv) - 1
    for t in range(len(raw) - 1, -1, -1):
        while j >= 0 and dv[j][0] > t: f *= 1 - dv[j][1] / raw[dv[j][0] - 1]; j -= 1
        out[t] = f
    return out


def etf_body(key):
    days, raw = etf_series(key)
    op, dv = etf_opens(key, raw), etf_dists(key, raw)
    f = etf_factors(raw, dv)
    if key[0] == 'K':   # 네이버 siseJson 모양 — 국내 ETF 는 수정주가(정수 반올림 + 조정 오차, 마지막 분배락 뒤는 실제 가격 그대로) · 지수는 그대로
        if KR_ETF.match(key):
            seed = _seed(key)
            adj = lambda t, x: x if f[t] == 1 else int(_math.floor(x * f[t] * (1 + 0.0005 * _math.sin(t * 0.37 + seed)) + 0.5))
            ac, ao = [adj(t, x) for t, x in enumerate(raw)], [adj(t, x) for t, x in enumerate(op)]
        else:
            ac, ao = raw, op
        return '[["날짜", "시가", "고가", "저가", "종가", "거래량", "외국인소진율"],\n' + ',\n'.join(
            '["%s", %s, %s, %s, %s, 1000, 0.0]' % (d.strftime('%Y%m%d'), o, max(o, c), min(o, c), c) for d, o, c in zip(days, ao, ac)) + ']'
    ts = [(d - _EP).days * 86400 + 48600 for d in days]   # 뉴욕 09:30 = UTC 13:30, gmtoffset −4시간
    ev = {str(ts[i]): {'amount': amt, 'date': ts[i]} for i, amt, tax in dv}
    return json.dumps({'chart': {'result': [{'meta': {'currency': 'USD', 'symbol': key[1:], 'gmtoffset': -14400}, 'timestamp': ts,
                       'events': {'dividends': ev}, 'indicators': {'quote': [{'open': op, 'close': raw}],
                       'adjclose': [{'adjclose': [round(x * f[t], 6) for t, x in enumerate(raw)]}]}}], 'error': None}})


def etf_exact(key):
    """국내 ETF 실제 거래 가격 줄 [(YYYYMMDD, 시가, 종가)] — Worker m=kr(야후)·m=kp(네이버 일별 시세)가 주는 값"""
    days, raw = etf_series(key)
    return [(d.strftime('%Y%m%d'), o, c) for d, o, c in zip(days, etf_opens(key, raw), raw)]


def etf_shard(i):
    """국내 분배 이력 묶음 i (화면과 같은 묶음 번호 = 글자 코드 합 % 8)"""
    e = {}
    for key in sorted(k for k in ETF_FIRST if KR_ETF.match(k)):
        c = key[1:]
        if sum(ord(x) for x in c) % 8 != i: continue
        days, raw = etf_series(key)
        e[c] = {'r': [[int(days[j].strftime('%Y%m%d')), amt, tax, raw[j - 1]] for j, amt, tax in etf_dists(key, raw)],
                'z': [int(days[-1].strftime('%Y%m%d')), raw[-1]]}
    return json.dumps({'updated': _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'e': e})


def etf_route(route):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
    g1 = lambda k: (q.get(k) or [''])[0]
    m, s = g1('m'), g1('s')
    hd = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8'}
    nf = lambda: route.fulfill(status=404, headers=hd, body='{"error":"not found"}')
    if m in ('k', 'u'):   # 일봉 원문 (지수: KKOSPI · U^GSPC)
        key = m.upper() + s
        return nf() if not s or key in ETF_NODATA else route.fulfill(status=200, headers=hd, body=etf_body(key))
    key = 'K' + s
    if m not in ('kr', 'kp') or not KR_ETF.match(key):
        return route.fulfill(status=400, headers=hd, body='{"error":"bad symbol"}')
    rows = etf_exact(key)
    if m == 'kr':   # 야후 일봉의 실제 시가·종가 — 빠진 날(ETF_YGAP)이 있음
        ETF_LOG.append(('kr', s, '', '', ''))
        gap = {d.strftime('%Y%m%d') for d in ETF_YGAP.get(key, ())}
        return route.fulfill(status=200, headers=hd, body='\n'.join('%s,%s,%s' % r for r in rows if r[0] not in gap))
    d, n = g1('d'), len(rows)   # m=kp: 그 날짜가 든 네이버 일별 시세 한 쪽(60거래일 · 1쪽 = 가장 최근) — Worker 가 쪽을 맞춰 찾은 결과
    if key in ETF_KPFIRST and d < ETF_KPFIRST[key]:   # 일별 시세 자료가 시작하기 전 날 → Worker 와 같은 200 "first=자료 첫날"
        ETF_LOG.append(('kp', s, d, g1('g'), 'first'))
        return route.fulfill(status=200, headers=hd, body='first=' + ETF_KPFIRST[key])
    t = max([i for i, r in enumerate(rows) if r[0] <= d] or [-1])
    if t < 0 or rows[t][0] != d:
        ETF_LOG.append(('kp', s, d, g1('g'), '')); return nf()
    g = (n - 1 - t) // 60 + 1
    ETF_LOG.append(('kp', s, d, g1('g'), str(g)))
    page = [r for r in rows[max(0, n - g * 60): n - (g - 1) * 60][::-1] if r[0] >= ETF_KPFIRST.get(key, '')]   # 일별 시세 자료 첫날 전 줄은 없음
    return route.fulfill(status=200, headers=hd, body='\n'.join('%s,%s,%s' % r for r in page))


BT_SYN = None


def etf_bt_route(route):
    """data/etfbt/<0~15>.json 식 묶음 · data/etfbt/r/<키>.json 금리·환율·S&P TR 앞부분 — 로컬 합성 (bt_synth)"""
    global BT_SYN
    if BT_SYN is None:
        BT_SYN = bt_synth.Synth(etf_series, etf_body)
    u = urllib.parse.urlparse(route.request.url).path
    m = re.search(r'/etfbt/(\d+)\.json$', u)
    if m:
        return route.fulfill(status=200, headers={'Content-Type': 'application/json'}, body=bt_synth.shard_body(int(m.group(1))))
    m = re.search(r'/etfbt/r/([A-Za-z0-9_]+\.json)$', u)
    body = BT_SYN.file(m.group(1)) if m else None
    return route.fulfill(status=200 if body else 404, headers={'Content-Type': 'application/json'}, body=body or '{}')


def etf_dist_route(route):
    m = re.search(r'/etfdist/(\d)\.json', route.request.url)
    route.fulfill(status=200, headers={'Content-Type': 'application/json'}, body=etf_shard(int(m.group(1))) if m else '{}')


def bt_check(fail, b, local):
    """백테스트 화면 값 점검 — 로컬: 파이썬 기준 구현(scripts/etf_bt_fit.bt_levels + btJoin 규칙)과 날짜·가격·가상 분배까지 · 배포: 모양·문구·켜고 끄기"""
    F = lambda m: fail('etf-backtest', m)
    S_, rows, ds = b.get('s') or {}, b.get('rows') or [], b.get('ds') or []
    if not S_ or not rows:
        return F('화면 값 없음: %s' % json.dumps(b, ensure_ascii=False)[:300])
    want = ['K133690', 'K122630', 'UTQQQ', 'USSO', 'K091160', 'UQYLD', 'K289480'] if local else ['K498400', 'K360750', 'UTQQQ']   # 배포: 셋 다 MAX(가장 늦은 백테스트 시작) 뒤에 상장
    for k in want:
        s = S_.get(k)
        if not s or not s['bt'] or s['list'] is None or s['first'] >= s['list']:
            F('%s 백테스트 없음 또는 시작일이 상장일 뒤: %s' % (k, s and {x: s[x] for x in ('bt', 'list', 'first', 'n')})); continue
        if s['d'][s['bt']] != s['list']:
            F('%s 백테스트 마지막 다음 날 ≠ 상장일 (%s · %s)' % (k, s['d'][s['bt']], s['list']))
    # 표: 이름 아래 백테스트 줄(방법·검증 오차·색) · 기준 칸 '백테스트' · 차트 점선(상장일 전)·세로선 · 설명
    for o in rows:
        if o['key'] in want:
            if not re.search(r'(백테스트|Backtest): .+ · ((예상 오차 연 ±|expected error ±)\d+\.\d|상장 후 자료가 짧아)', o['info']) or not re.search(r'ecx-bt [gmb]$', o['cls']):
                F('%s 표 백테스트 줄 이상: %s · %s' % (o['key'], o['info'][:120], o['cls']))
            if o['bt'] <= 0 or o['list'] is None:
                F('%s 기간 안 백테스트 날 수 %s · 상장일 %s' % (o['key'], o['bt'], o['list']))
            if o['pDay'] < o['list'] and not re.search(r'^\d{4}[.-]\d\d[.-]\d\d (백테스트|backtest)', o['cell']):
                F('%s 기준 칸에 백테스트 표시 없음: %s' % (o['key'], o['cell'][:80]))
            if not re.search(r'(상장|Listed) \d{4}[.-]\d\d[.-]\d\d · ((백테스트|backtest from) \d{4}|<em>|기간 중|backtest starts)', o['cell']):
                F('%s 기준 칸 아래 상장·백테스트 시작 표시 없음: %s' % (o['key'], o['cell'][-80:]))
    lab = {o['key']: o for o in rows}
    for d_ in ds:
        o = next((x for x in rows if x['key'] in want and x['list'] == d_['lx']), None)
        if d_['lx'] is not None and (not d_['dash'] or d_['dash'][0] != [4, 3] or d_['dash'][1] is not None):
            F('차트 점선 구간 이상(상장일 전 점선 · 뒤 실선): %s' % d_)
    if sum(1 for d_ in ds if d_['lx'] is not None) < len(want):
        F('차트 상장일 세로선(lx) 수 %d (기대 %d 이상)' % (sum(1 for d_ in ds if d_['lx'] is not None), len(want)))
    if not re.search(r'(점선|Dashed) = (상장 전 백테스트|pre-listing backtest)', b.get('note', '')):
        F('기간 설명에 점선·백테스트 설명 없음: %s' % b.get('note', '')[-200:])
    firsts = [S_[k]['first'] for k in S_ if S_[k]]
    if b.get('w') and firsts and b['w']['S'] != max(firsts):
        F('MAX 기준일 %s ≠ 백테스트 포함 가장 늦은 시작 %s' % (b['w']['S'], max(firsts)))
    off = b.get('off') or {}
    if not off or '&bt=0' not in off.get('hash', '') or any(x != 0 for x in off.get('bt', [1])) or off.get('dashed') != 0:
        F('백테스트 끄기 → 실제 기간만·주소 bt=0·점선 없음 이 아님: %s' % off)
    elif off.get('w') != max(x for x in off.get('firsts', [0]) if x is not None):
        F('끈 뒤 MAX 기준일 %s ≠ 가장 늦은 상장일 %s' % (off.get('w'), off.get('firsts')))
    if not b.get('back') or '&bt=' in b['back'].get('hash', '') or b['back'].get('w') != (b.get('w') or {}).get('S'):
        F('다시 켜기 → 처음과 같은 MAX·주소 bt 없음 이 아님: %s' % b.get('back'))
    pz = b.get('parse') or {}
    if pz.get('bt') is not False or pz.get('box') is not False or pz.get('any') is not False or '&bt=0' not in pz.get('hash', ''):
        F('주소 &bt=0 으로 열기 → 백테스트 꺼짐(체크 해제·점선 없음)이 아님: %s' % pz)
    if not local:
        return
    # ── 로컬: 숫자까지 ──
    if 'IWM' not in b.get('note', '') or not re.search(r'백테스트 재료를 불러오지 못해|Backtest data unavailable', b.get('note', '')):
        F('재료 없는 식(UIWM) → 실제 기간만 + 경고 문구 없음: %s' % b.get('note', '')[-200:])
    if (S_.get('UIWM') or {}).get('bt'):
        F('재료 없는 UIWM 에 백테스트가 붙음')
    syn = BT_SYN or bt_synth.Synth(etf_series, etf_body)
    try:
        exp = bt_synth.expected(syn)
    except Exception as ex:
        return F('파이썬 기대값 계산 실패: %r' % ex)
    R = bt_synth.recipes()
    for k in want:
        key = k[0] + ':' + k[1:]
        e, s = exp.get(key), S_.get(k)
        if not e or not s or not s['bt']:
            F('%s 기대값·화면 값 없음' % k); continue
        if s['bt'] != e['iS'] or s['d'][:e['iS']] != e['d'][:e['iS']]:
            F('%s 백테스트 날짜 다름: 화면 %d일(%s~) · 기대 %d일(%s~)' % (k, s['bt'], s['d'][0], e['iS'], e['d'][0])); continue
        days, raw = etf_series(k)
        P, ex_ = bt_synth.joined_prices(e, R[key], raw[0])
        worst = max(abs(a / b_ - 1) for a, b_ in zip(s['p'][:e['iS']], P))
        print('    %s 백테스트 %d일 (%s~) · 가격 최대 상대 차 %.1e · 가상 분배 %d회' % (k, e['iS'], (_EP + _dt.timedelta(e['d'][0])).isoformat(), worst, len(s.get('dv') or [])), flush=True)
        if worst > 1e-9:
            F('%s 백테스트 가격(분배 뺀 시장가) 최대 상대 차 %.2e (기대 1e-9 이하)' % (k, worst))
        if s['p'][e['iS']] != raw[0]:
            F('%s 상장 첫날 가격 %s ≠ 실제 %s' % (k, s['p'][e['iS']], raw[0]))
        prof = R[key].get('dv')
        dvs = s.get('dv') or []
        if prof:
            want_ex = [e['d'][i] for i in ex_][:len(dvs)]
            if [x[0] for x in dvs] != want_ex or not dvs:
                F('%s 가상 분배 날짜 다름: 화면 %s · 기대 %s' % (k, [x[0] for x in dvs][:5], want_ex[:5]))
            else:
                dl = prof['y'] / prof['f']; tx = (prof.get('tx', 1) * 0.154) if k[0] == 'K' else 0.154
                bad = [x for x in dvs if abs(x[2] - dl * P[x[1] - 1]) > 1e-9 * max(1, x[2]) or abs(x[3] - x[2] * tx) > 1e-9 * max(1, x[3])]
                if bad:
                    F('%s 가상 분배금·세금 다름: %s' % (k, bad[:3]))
        elif dvs:
            F('%s 분배 습관이 없는데 가상 분배가 있음' % k)
    # 체인: TQQQ 백테스트는 QLD 백테스트를 이어 붙여 QQQ 상장일(합성 1999-03-10) 뒤 첫 거래일 무렵까지
    if S_.get('UTQQQ') and S_['UTQQQ']['first'] >= (bt_synth.BT_FIRST['UQLD'] - _EP).days:
        F('체인 안 됨: TQQQ 백테스트 시작 %s 가 QLD 상장일(%s) 뒤' % (S_['UTQQQ']['first'], bt_synth.BT_FIRST['UQLD']))
    # 한국거래소 옵션 지수 체인: TIGER 200커버드콜(K289480) 백테스트는 지수 식의 재현을 이어 붙여 지수 기준일(합성 2013-01-02) 전까지
    if S_.get('K289480') and S_['K289480']['first'] >= (bt_synth.KRX_FROM - _EP).days:
        F('체인 안 됨: K289480 백테스트 시작 %s 가 한국거래소 옵션 지수 기준일(%s) 뒤' % (S_['K289480']['first'], bt_synth.KRX_FROM))
    # 방법 문구: 환 노출 · 콜 매도 · 배수
    want_lab = {'K133690': r'SPY×원/달러 · 예상 오차 연 ±3\.4%p$', 'K122630': r'KODEX 200 0\.90배 \+ 위클리 콜 매도\(커버 33% · 1\.0% OTM\) · 예상 오차 연 ±5\.2%p$',
                'UTQQQ': r'QLD 1\.5배 · 예상 오차 연 ±1\.1%p \(이어 붙인 앞 구간 ±2\.0%p\)$', 'USSO': r'S&P 500 TR 2\.0배 · 예상 오차 연 ±2\.1%p$',
                'UQYLD': r'^백테스트: NASDAQ-100 BuyWrite V2\(BXNT\) · 예상 오차 연 ±1\.8%p$',
                'K289480': r'^백테스트: 코스피 200 커버드콜 ATM 지수 · 예상 오차 연 ±1\.4%p \(이어 붙인 앞 구간 ±4\.4%p\)$'}
    for k, pat in want_lab.items():
        if not re.search(pat, (lab.get(k) or {}).get('info', '')):
            F('%s 방법 문구 %r 없음: %s' % (k, pat, (lab.get(k) or {}).get('info', '')[:140]))
    # 색 = 예상 오차(이어 붙인 앞 구간이 더 크면 그것) 연 3% 미만 초록 g · 8% 미만 노랑 m · 그 밖 빨강 b
    want_cls = {'K133690': 'm', 'K122630': 'm', 'UTQQQ': 'g', 'USSO': 'g', 'UQYLD': 'g', 'K289480': 'm'}
    for k, c in want_cls.items():
        if not (lab.get(k) or {}).get('cls', '').endswith('ecx-bt ' + c):
            F('%s 오차 색 %r 아님: %s' % (k, c, (lab.get(k) or {}).get('cls')))


def bt_data_check(fail):
    """저장소의 백테스트 식 묶음(data/etfbt) 점검 — 지수 식 이름에 지수 회사 이름(Cboe) 없음 · 한국거래소 옵션 지수(D:)·모의 커버드콜(Z:) 이름은
    '한글|영문'(영문에 한글 없음) · 식이 쓰는 옵션 전략 지수(C:·D:·Z:)는 화면이 받을 파일(data/etfbt/r/<키>.json)이 있음 · 쓰지 않는 지수 파일은 없음"""
    F = lambda m: fail('etf-backtest', m)
    d = os.path.join(ROOT, 'data', 'etfbt')
    used, bad = set(), []
    for i in range(16):
        try:
            e = json.load(open(os.path.join(d, '%d.json' % i), encoding='utf-8'))['e']
        except Exception as ex:
            F('식 묶음 %d 읽기 실패: %r' % (i, ex)); continue
        for k, r in e.items():
            for t in r.get('m') or []:
                if t[0][:2] in ('C:', 'D:', 'Z:'):
                    used.add(t[0])
                nm = t[5] if len(t) > 5 else ''
                if t[0][:2] not in ('K:', 'U:') and re.search('cboe', nm, re.I):     # 지수 이름만 (Cboe Global Markets 주식 'CBOE' 같은 보유 종목은 그대로)
                    bad.append('%s 이름에 Cboe: %s' % (k, nm))
                if t[0][:2] in ('D:', 'Z:'):
                    en = nm.split('|')[1] if '|' in nm else ''
                    if not en or re.search(r'[가-힣]', en):
                        bad.append('%s 의 %s 영문 이름 없음: %s' % (k, t[0], nm))
    for x in bad[:5]:
        F('식 이름 점검: ' + x)
    have = {f[:-5].replace('_', ':', 1) for f in os.listdir(os.path.join(d, 'r')) if re.match(r'^[CDZ]_[A-Za-z0-9]+\.json$', f)}
    if used - have:
        F('식이 쓰는 옵션 전략 지수 파일 없음: %s' % sorted(used - have)[:5])
    if have - used:
        F('쓰지 않는 옵션 전략 지수 파일 남음: %s' % sorted(have - used)[:5])


# 배포 사이트: 모의 커버드콜(Z:)을 쓰는 ETF 백테스트 — 화면이 읽은 식(S.btS)과 받은 재료(S.dep)를 그대로 돌려줌
BTZ_JS = """async (n) => {
  const W = ms => new Promise(r => setTimeout(r, ms)), S = window.ECXdebug && ECXdebug.S;
  if (!S) return { none: true };
  const busy = () => Object.keys(S.pend).length || Object.keys(S.distP).length || Object.keys(S.exP).length || Object.keys(S.pgP).length || Object.keys(S.btP).length || Object.keys(S.depP).length;
  for (let i = 0; i < 900; i++) { if (S.ready && S.sel.length === n && !busy() && S.sel.every(s => !S.data[s.k + s.c] || ECXdebug.prepOf(s))) { await W(80); if (!busy()) break; } await W(100); }
  const sh = k => { let s = 0; for (let i = 0; i < k.length; i++) s += k.charCodeAt(i); return s % 16; };
  const rcOf = k => (S.btS[sh(k)] || {})[k] || null;
  ${ROW_OF}
  return { s: S.sel.map(it => {
      const s = ECXdebug.prepOf(it), key = it.k + ':' + it.c, rc = rcOf(key);
      const tr = rowOf(S, it), b = tr && tr.querySelector('.ecx-bt'), need = [];
      const walk = (r, depth) => r.m.forEach(t => { need.push(t[0]); const c0 = t[0].charAt(0), fr = rcOf(t[0]);
        if (depth <= 3 && (c0 === 'K' || c0 === 'U' || c0 === 'D') && fr && fr.ec != null && fr.ec <= 0.05) walk(fr, depth + 1); });
      if (rc) walk(rc, 1);
      return { key, first: s ? s.d[0] : null, bt: s ? (s.bt || 0) : 0, info: b ? b.textContent : '', cls: b ? b.className : '',
               rc: rc ? { st: rc.st, x: rc.x, xc: rc.xc, names: rc.m.map(t => [t[5] || '', !!t[6]]) } : null, need }; }),
    dep: Object.keys(S.dep), depErr: Object.keys(S.depErr), btErr: Object.keys(S.btErr) };
}""".replace('${ROW_OF}', bt_synth.ROW_OF_JS)


def bt_zsim_live(page, base, fail, errs, ignorable):
    """배포 사이트 점검 — 모의 커버드콜(Z:)을 직접 쓰거나 Z 를 쓰는 한국거래소 지수 식을 이어 붙이는 국내 ETF(저장소 식에서 최대 3개)
    · 백테스트 시작일(화면이 재료로 계산) = 식의 st(파이썬) · 재료 받기 오류 없음 · 이어 붙인 식이 쓰는 Z·D 파일을 실제로 받음
    · 방법 문구: 한국어판 = 지수 이름 한글 · 영어판 = 영문 · 예상 오차(앞 구간 포함)·색이 식 값과 같음 — 기대값은 화면이 읽은 식에서(배포 시차에도 맞게)"""
    F = lambda m: fail('etf-backtest', m)
    d = os.path.join(ROOT, 'data', 'etfbt')
    R = {}
    for i in range(16):
        R.update(json.load(open(os.path.join(d, '%d.json' % i), encoding='utf-8'))['e'])
    zd = {k for k, r in R.items() if k.startswith('D:') and any(t[0].startswith('Z:') for t in r['m']) and r.get('ec') is not None and r['ec'] <= 0.05}
    picks = sorted((k for k, r in R.items() if k.startswith('K:') and any(t[0].startswith('Z:') or t[0] in zd for t in r['m'])), key=lambda k: (R[k]['st'], k))[:3]
    if not picks:
        return F('모의 커버드콜(Z:)을 쓰는 국내 ETF 식이 저장소에 없음')
    hash_ = '#e=%s&p=MAX' % ','.join('K' + k[2:] for k in picks)
    ep = _dt.date(1970, 1, 1)
    for lang, pre in (('ko', ''), ('en', 'en/')):
        errs.clear()
        page.goto('about:blank'); page.goto(base + pre + 'etf-compare/' + hash_, wait_until='load')
        try:
            z = page.evaluate(BTZ_JS, len(picks))
        except Exception as ex:
            F('[%s] 모의 커버드콜 점검 실행 실패: %r' % (lang, ex)); continue
        if z.get('none'):
            F('[%s] ECXdebug 없음' % lang); continue
        if z['depErr'] or z['btErr']:
            F('[%s] 백테스트 재료·식 받기 실패: %s · %s' % (lang, z['depErr'][:5], z['btErr'][:5]))
        used_z = False
        for o in z['s']:
            rc = o['rc']
            if not rc:
                F('[%s] %s 화면이 백테스트 식을 못 읽음' % (lang, o['key'])); continue
            if not o['bt'] or o['first'] != rc['st']:
                F('[%s] %s 백테스트 시작 %s ≠ 식 %s (백테스트 %d일)' % (lang, o['key'], o['first'] and (ep + _dt.timedelta(o['first'])).isoformat(),
                                                              (ep + _dt.timedelta(rc['st'])).isoformat(), o['bt']))
            zk = [k for k in o['need'] if k[:2] in ('Z:', 'D:')]
            used_z = used_z or any(k.startswith('Z:') for k in zk)
            miss = [k for k in zk if k not in z['dep']]
            if miss:
                F('[%s] %s 이어 붙인 식의 옵션 지수·모의 파일을 받지 않음: %s' % (lang, o['key'], miss[:5]))
            x, xc = rc['x'], rc.get('xc')
            if x is None:
                F('[%s] %s 식에 예상 오차가 없음' % (lang, o['key'])); continue
            shown = xc if (xc is not None and xc > x * 1.05 + 0.0005) else None
            names = [nm.split('|')[1 if lang == 'en' else 0] for nm, cc in rc['names'] if '|' in nm and not cc]   # 옵션 지수·모의('한글|영문') 이름
            want = ('Backtest: ' if lang == 'en' else '백테스트: ', ('expected error ±%.1fpp/yr' if lang == 'en' else '예상 오차 연 ±%.1f%%p') % (100 * x))
            tail = (' (chained earlier part ±%.1fpp)' if lang == 'en' else ' (이어 붙인 앞 구간 ±%.1f%%p)') % (100 * shown) if shown else ''
            if not o['info'].startswith(want[0]) or (want[1] + tail) not in o['info'] or not o['info'].endswith(want[1] + tail) \
                    or any(nm not in o['info'] for nm in names):
                F('[%s] %s 방법 문구가 식과 다름: %s (기대 이름 %s · %s%s)' % (lang, o['key'], o['info'][:160], names, want[1], tail))
            w_ = max(x, shown or 0)
            if not o['cls'].endswith('ecx-bt ' + ('g' if w_ < 0.03 else 'm' if w_ < 0.08 else 'b')):
                F('[%s] %s 오차 색 %s (예상 오차 %.4f)' % (lang, o['key'], o['cls'], w_))
            if lang == 'en' and any(re.search(r'[가-힣]', nm) for nm in names):
                F('[en] %s 지수 이름에 한글: %s' % (o['key'], names))
        if not used_z:
            F('[%s] 고른 ETF(%s)의 식이 모의 커버드콜 파일(Z:)을 쓰지 않음 — 화면 식: %s' % (lang, ','.join(picks), [o['need'] for o in z['s']]))
        for t in [t for t, u in errs if not ignorable(t, u)][:3]:
            F('[%s] 모의 커버드콜 점검 콘솔 오류: %s' % (lang, t[:200]))
    print('    모의 커버드콜 실사이트 점검: %s' % ', '.join('%s(%s~)' % (k[2:], (ep + _dt.timedelta(R[k]['st'])).isoformat()) for k in picks), flush=True)


def etf_expect(keys, S, mode, E=None, open_=False):
    """기대값 {종목: {ret, tax, fee, n, nk, na, nf, span, mdd, vol, p0, pE, pDay, pKind, endDay}} — 화면 stats·valueSeries 와 같은 규칙을 따로 구현
       S·E: 1970-01-01 기준 일수 (E 없으면 마지막 거래일)
       open_=False (1M·3M·6M·1Y·YTD): 기준 = S 이하 마지막 거래일 종가 (S 뒤에 상장했으면 상장일 시가)
       open_=True  (MAX·기간설정)    : 기준 = S 이상 첫 거래일 시가 · 끝 = E 이하 마지막 거래일 종가
       mode: px 시장가(실제 가격 변화만, 세금·수수료 없음) · nav 기준가(분배금에서 세금을 떼고 재투자 수수료를 뺀 만큼 분배락 전날 종가 − 분배금에 재투자,
             국내 과세표준 × 15.4% · 미국 배당 × 15.4% · 처음 매수·마지막 매도 수수료 없음)"""
    out = {}
    for k in keys:
        days, raw = etf_series(k)
        op = etf_opens(k, raw)
        dn = [(d - _EP).days for d in days]
        ei = max(i for i, x in enumerate(dn) if x <= (dn[-1] if E is None else E))
        if open_:
            bi, ob = min(i for i, x in enumerate(dn) if x >= S), True
        else:
            le = [i for i, x in enumerate(dn) if x <= S]
            bi, ob = (le[-1], False) if le else (0, True)
        p0 = op[bi] if ob else raw[bi]
        alld = etf_dists(k, raw)
        dv = [(i, a, t) for i, a, t in alld if bi < i <= ei]
        known = [(a, t) for i, a, t in alld if t is not None]
        ratio = sum(t for a, t in known) / sum(a for a, t in known) if known else None
        o = {'n': len(dv), 'nk': 0, 'na': 0, 'nf': 0, 'tax': 0.0, 'fee': 0.0, 'span': dn[ei] - dn[bi] + (1 if ob else 0),
             'p0': p0, 'pE': raw[ei], 'pDay': dn[bi], 'pKind': 'o' if ob else 'c', 'endDay': dn[ei]}
        if k[0] == 'K':
            for i, a, t in dv:
                o['nk' if t is not None else 'na' if ratio is not None else 'nf'] += 1
        fee, u, j, v = ETF_FEE[k[0]], 1 / p0, 0, []
        for t in range(bi, ei + 1):
            while j < len(dv) and dv[j][0] == t:
                i, a, tx = dv[j]; j += 1
                if mode == 'nav':
                    x = raw[i - 1] - a
                    tax = a * 0.154 if k[0] == 'U' else (tx if tx is not None else a * (ratio if ratio is not None else 1.0)) * 0.154
                    cash = u * (a - tax); buy = cash / (1 + fee)
                    o['tax'] += u * tax; o['fee'] += cash - buy
                    u += buy / x
            v.append(u * raw[t] if mode == 'nav' else raw[t] / p0)
        pk, mdd, cnt, sm, sq = 1.0, 0.0, 0, 0.0, 0.0
        for t, x in enumerate(v):
            pk = max(pk, x); mdd = min(mdd, x / pk - 1)
            if t > 0:
                r = _math.log(x / v[t - 1]); cnt += 1; sm += r; sq += r * r
        o['ret'], o['mdd'] = v[-1] - 1, mdd
        o['vol'] = _math.sqrt(max(0.0, (sq - sm * sm / cnt) / (cnt - 1))) * _math.sqrt(252) if cnt >= 5 else None
        out[k] = o
    return out


def etf_cmp(fail, where, got, exp, fields=('ret', 'tax', 'fee', 'mdd', 'vol', 'p0', 'pE', 'pDay', 'pKind', 'endDay')):
    """화면 값(got)과 기대값(exp) 비교 · 수익률·CAGR·연환산·분배 횟수까지"""
    for f in fields:
        g, e = got.get(f), exp.get(f)
        if isinstance(e, str) or e is None or g is None:
            if g != e: fail('etf-compare', '%s %s: 화면 %s · 기대 %s' % (where, f, g, e))
        elif abs(g - e) > 1e-9 * max(1.0, abs(e)):
            fail('etf-compare', '%s %s: 화면 %.10f · 기대 %.10f' % (where, f, g, e))
    if [got.get('n'), got.get('nk'), got.get('na'), got.get('nf')] != [exp['n'], exp['nk'], exp['na'], exp['nf']]:
        fail('etf-compare', '%s 분배 횟수(전체·공개·평균·전액) 화면 %s · 기대 %s' % (where, [got.get('n'), got.get('nk'), got.get('na'), got.get('nf')], [exp['n'], exp['nk'], exp['na'], exp['nf']]))
    cg = (1 + exp['ret']) ** (365.25 / exp['span']) - 1 if exp['span'] >= 365 else None
    an = exp['ret'] * 365.25 / exp['span']
    if (got.get('cagr') is None) != (cg is None) or (cg is not None and abs(got['cagr'] - cg) > 1e-9) or got.get('ann') is None or abs(got['ann'] - an) > 1e-9:
        fail('etf-compare', '%s CAGR·연환산: 화면 %s · %s · 기대 %s · %s' % (where, got.get('cagr'), got.get('ann'), cg, an))


# ── ETF 차트 비교 실제 가격 점검 (--etf-audit · 배포된 사이트) ──
#   화면이 표에 보여 주고 계산에 쓴 기준·끝 가격을 독립 출처와 맞춰 봄: 국내 ETF·지수 = 네이버 일별 시세(m.stock) · 미국 = 야후 일봉
#   (화면은 국내 ETF 실제 가격을 야후 일봉(Worker m=kr)으로, 빠진 날만 네이버 일별 시세(m=kp)로 받음 → 출처가 달라도 같아야 함)
#   (조합, {종목: (기준 날짜, 시가 o·종가 c)} 정답) — 2024-12-03 = KODEX 200타겟위클리커버드콜(498400) 상장일
ETF_AUDIT = [('#e=K498400,IKOSPI&p=MAX&bt=0', {'K498400': ('2024-12-03', 'o'), 'IKOSPI': ('2024-12-03', 'o')}),   # 실제 가격 점검이라 상장 전 백테스트는 끔
             ('#e=K069500,K360750,K498400,USPY,ISPX&p=1Y&bt=0', None),
             ('#e=K069500,K498400,IKOSPI,USPY&p=C20250102-20250630&bt=0', None)]
ETF_AUDIT_JS = """() => { const S = window.ECXdebug && ECXdebug.S, R = S && S.last, X = window.ECX; if (!R || !R.list) return null;
  const tr = [...document.querySelectorAll('#ecx-stats tr')];
  return { per: S.per, mode: S.mode, err: R.err || null, n: S.sel.length, rows: R.list.map(o => { const it = S.sel[o.i], x = S.by[it.k + it.c] || {}, st = o.st;
    return { key: it.k + it.c, k: it.k, c: it.c, sym: x.sym || '', rg: x.rg || it.k, pDay: X.ymdOf(st.pDay), pKind: st.pKind, p0: st.p0, endDay: X.ymdOf(st.endDay), pE: st.pE,
             xb: st.xb, xe: st.xe, ret: st.ret, cell: tr[o.i] && tr[o.i].cells[6] ? tr[o.i].cells[6].textContent : '' }; }) }; }"""


def http_text(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}), timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:
            if i == tries - 1: raise
            time.sleep(2 + i * 3)


class Actual:
    """독립 출처의 실제 가격 {YYYYMMDD: (시가, 종가)} — 국내 ETF: m.stock api/stock · 국내 지수: api/index · 미국: 야후 일봉"""
    def __init__(self):
        self.c = {}

    def kr(self, kind, sym, ymd):
        m = self.c.setdefault((kind, sym), {'rows': {}, 'g': 0, 'end': False})
        f = lambda v: float(str(v).replace(',', '')) if v not in (None, '') else None
        while ymd not in m['rows'] and not m['end'] and m['g'] < 60 and (not m['rows'] or min(m['rows']) > ymd):   # 1쪽 = 가장 최근 → 그 날짜가 나올 때까지 옛날 쪽으로
            m['g'] += 1
            a = json.loads(http_text('https://m.stock.naver.com/api/%s/%s/price?pageSize=60&page=%d' % (kind, sym, m['g'])))
            if not a: m['end'] = True; break
            for x in a:
                m['rows'][str(x.get('localTradedAt', '')).replace('-', '')] = (f(x.get('openPrice')), f(x.get('closePrice')))
        return m['rows'].get(ymd)

    def us(self, sym, ymd):
        if sym not in self.c:
            try:
                now = int(time.time())
                j = json.loads(http_text('https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&includePrePost=false'
                                         % (urllib.parse.quote(sym), now - 3 * 366 * 86400, now + 86400)))
                r = j['chart']['result'][0]; off = r['meta'].get('gmtoffset') or 0; q = r['indicators']['quote'][0]
                self.c[sym] = {time.strftime('%Y%m%d', time.gmtime(t + off)): (o, c) for t, o, c in zip(r['timestamp'], q['open'], q['close']) if c}
            except Exception as e:
                print('  ! 야후 %s 받기 실패 (미국 가격 대조 건너뜀): %s' % (sym, str(e)[:80]), flush=True)
                self.c[sym] = None
        return 'skip' if self.c[sym] is None else self.c[sym].get(ymd)


def etf_audit(page, base, fail):
    """배포된 /etf-compare/ — 기준·끝 가격이 실제 거래 가격과 같은지 · 날짜·시가/종가 규칙 · 수익률 = 끝 ÷ 기준 − 1 · 표 칸 표시"""
    A, n = Actual(), 0
    ready = ("() => window.ECXdebug && ECXdebug.S.ready && ECXdebug.S.sel.length && !Object.keys(ECXdebug.S.pend).length && !Object.keys(ECXdebug.S.distP).length"
             " && !Object.keys(ECXdebug.S.exP).length && !Object.keys(ECXdebug.S.pgP).length && ECXdebug.S.last && ECXdebug.S.last.list")
    for h, want in ETF_AUDIT:
        x = None
        for tryn in range(2):   # 원본 일시 오류 대비 한 번 더
            page.goto('about:blank'); page.goto(base + 'etf-compare/' + h, wait_until='load', timeout=60000)
            try:
                page.wait_for_function(ready, timeout=60000); page.wait_for_timeout(500)
                x = page.evaluate(ETF_AUDIT_JS)
            except Exception as e:
                x = None; print('  ! %s 준비 안 됨 (%s)' % (h, str(e)[:80]), flush=True)
            if x and x['n'] == len(x['rows']) and all(r['k'] != 'K' or (r['xb'] and r['xe']) for r in x['rows']): break
            page.wait_for_timeout(20000)
        where = 'etf-audit ' + h
        if not x or x.get('err') or x['n'] != len(x['rows']):
            fail(where, '표를 그리지 못함: %s' % (x and {k: x[k] for k in ('err', 'n')})); continue
        for r in x['rows']:
            tag = '%s %s' % (r['key'], h.split('&p=')[1])
            if want and r['key'] in want and (r['pDay'], r['pKind']) != want[r['key']]:
                fail(where, '%s 기준 %s %s (기대 %s %s)' % (r['key'], r['pDay'], r['pKind'], *want[r['key']]))
            if abs(r['ret'] - (r['pE'] / r['p0'] - 1)) > 1e-12:
                fail(where, '%s 시장가 수익률 %.8f ≠ 끝 ÷ 기준 − 1 (%.8f)' % (r['key'], r['ret'], r['pE'] / r['p0'] - 1))
            if r['k'] == 'K' and not (r['xb'] and r['xe']):
                fail(where, '%s 기준·끝 가격을 실제 거래 가격으로 확인하지 못함 (xb %s · xe %s) — 수정주가 역산 근사로 계산됨' % (r['key'], r['xb'], r['xe']))
            d0, d1 = r['pDay'].replace('-', ''), r['endDay'].replace('-', '')
            if r['k'] == 'K' or (r['k'] == 'I' and r['rg'] == 'K'):
                kind, sym, tol = ('stock', r['c'], 1e-9) if r['k'] == 'K' else ('index', r['sym'], 0.005)
                try:
                    a0, a1 = A.kr(kind, sym, d0), A.kr(kind, sym, d1)
                except Exception as e:
                    print('  ! 네이버 일별 시세 %s 받기 실패 (대조 건너뜀): %s' % (sym, str(e)[:80]), flush=True); continue
            else:   # 미국 ETF·지수: 야후 일봉 (소수 가격 → 상대 오차 1e-6)
                sym, tol = (r['sym'] if r['k'] == 'I' else r['c']), 1e-6 * max(r['p0'], r['pE'])
                a0, a1 = A.us(sym, d0), A.us(sym, d1)
                if a0 == 'skip' or a1 == 'skip': continue
            if not a0 or not a1:
                fail(where, '%s 독립 출처에 %s · %s 가격 없음' % (tag, r['pDay'], r['endDay'])); continue
            e0 = a0[0] if r['pKind'] == 'o' else a0[1]
            if e0 is None or abs(r['p0'] - e0) > tol:
                fail(where, '%s 기준 %s %s 가격: 화면 %s · 실제 %s' % (tag, r['pDay'], '시가' if r['pKind'] == 'o' else '종가', r['p0'], e0))
            if abs(r['pE'] - a1[1]) > tol:
                fail(where, '%s 끝 %s 종가: 화면 %s · 실제 %s' % (tag, r['endDay'], r['pE'], a1[1]))
            if not re.match(r'^%s (시가|종가) [₩$]?[\d,.]+원?→ %s 종가' % (re.escape(r['pDay'].replace('-', '.')), re.escape(r['endDay'].replace('-', '.'))), r['cell']):
                fail(where, '%s 표 칸 표시 이상: %s' % (tag, r['cell'][:90]))
            n += 1
            print('  %s %s %s %s → %s %s · 실제 가격 일치' % (tag, r['pDay'], '시가' if r['pKind'] == 'o' else '종가', r['p0'], r['endDay'], r['pE']), flush=True)
    return n


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve(root):
    handler = functools.partial(Quiet, directory=root)
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % httpd.server_address[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', help='검사할 사이트 주소 (기본: 저장소 루트를 임시 서버로)')
    ap.add_argument('--quick', action='store_true', help='화면 폭 4개만')
    ap.add_argument('--only', help='이 문자열이 들어간 경로만')
    ap.add_argument('--selftest', action='store_true', help='일부러 넘침·콘솔 오류를 넣어 검사가 잡아내는지 확인')
    ap.add_argument('--etf-audit', action='store_true', help='배포된 사이트의 ETF 차트 비교 기준·끝 가격을 실제 거래 가격과 대조 (--base 필요)')
    a = ap.parse_args()
    httpd = None
    base = a.base
    if not base:
        httpd, base = serve(ROOT)
    if not base.endswith('/'):
        base += '/'
    local = base.startswith('http://127.0.0.1') or base.startswith('http://localhost')
    if a.etf_audit and local:
        print('--etf-audit 는 배포된 사이트 주소(--base)가 필요합니다 (로컬은 합성 자료라 실제 가격과 대조할 수 없음)'); sys.exit(2)

    cfg = json.load(open(os.path.join(ROOT, 'scripts', 'routes.json'), encoding='utf-8'))
    routes = cfg['routes']
    en = sorted(d for d in os.listdir(os.path.join(ROOT, 'en')) if os.path.isfile(os.path.join(ROOT, 'en', d, 'index.html')))
    paths = [''] + [r['path'] + '/' for r in routes] + ['en/' + d + '/' for d in en]
    if a.only:
        paths = [p for p in paths if a.only in p]
    widths = QUICK if a.quick else WIDTHS
    fails, t0 = [], time.time()

    def fail(where, what):
        fails.append('%s — %s' % (where or '/', what))
        print('  ✗ %s — %s' % (where or '/', what), flush=True)

    # 계정 자동 저장 키: 화면이 쓰는 /udata/<키> 가 Worker 허용 목록(UDATA_KEYS)에 모두 있어야 함 (없으면 로그인 사용자에게 '저장 실패')
    _src = open(os.path.join(ROOT, 'src', 'index.html'), encoding='utf-8').read()
    _ks = set(re.findall(r"/udata/([a-z0-9-]+)'", _src))
    _al = re.search(r"UDATA_KEYS = \[([^\]]*)\]", open(os.path.join(ROOT, 'worker', 'src', 'auth.js'), encoding='utf-8').read())
    _al = set(re.findall(r"'([a-z0-9-]+)'", _al.group(1))) if _al else set()
    for k in sorted(_ks - _al):
        fail('worker', '계정 저장 키 /udata/%s 가 worker/src/auth.js UDATA_KEYS 에 없음' % k)
    # window.fcRegister 를 부르는 모듈은 정의([FC-UI]) 뒤에 있어야 함 — 앞에 두면 공용 스크립트가 거기서 멈춰 모든 페이지가 깨짐
    _def = _src.find('window.fcRegister = function')
    for _m in re.finditer(r"window\.fcRegister\('([a-z0-9]+)'", _src):
        if _def < 0 or _m.start() < _def:
            fail('src', "window.fcRegister('%s') 호출이 정의보다 앞에 있음 (스크립트 전체가 멈춤)" % _m.group(1))

    # 무한매수법 버전 엔진 (원문 숫자·V4 동등성·기록 다시 계산·양도세) — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'muhan_ver_test.js')], capture_output=True, text=True, timeout=300)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'muhan_ver_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('muhan', '버전 엔진 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:400])
    # Worker ETF 실제 가격 경로(야후 줄 변환·네이버 일별 시세 쪽 찾기) 단독 확인 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_etf_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_etf_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', 'ETF 실제 가격 경로 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])

    # 외부 광고·방문 분석 서버(일시 오류가 잦고 사이트 기능과 무관) — 실패해도 사이트 오류로 보지 않음
    THIRD = ('clarity.ms', 'bing.com', 'naver.com', 'naver.net', 'pstatic.net', 'googlesyndication', 'doubleclick',
             'google-analytics', 'googletagmanager', 'adtrafficquality', 'googleadservices', 'gstatic.com', 'kakao', 'withgoogle.com')

    def ignorable(msg_text, url):
        t = msg_text or ''
        if t.startswith('Failed to load resource'):   # 주소가 없는 브라우저 메시지 → 아래 응답 기록(주소 포함)으로 대신 판단
            return True
        if t.startswith('[Report Only]') or 'report-only Content Security Policy' in t:
            return True   # 광고 iframe(google.com)의 CSP '보고 전용' 위반 알림 — 아무것도 막지 않음 · Chromium 판마다 문구가 달라 둘 다 (2026-10 부터 간헐 발생)
        if not local:
            return False
        return ('workers.dev' in t or 'CORS' in t or 'ERR_FAILED' in t or 'ERR_NAME_NOT_RESOLVED' in t
                or (url and not url.startswith(base)) or t.startswith('Failed to load resource'))

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 900}, locale='ko-KR')
        # 광고·방문 분석 요청은 브라우저 밖으로 나가지 않게 막음 (로컬·배포 사이트·ETF 점검 모두)
        #  · 자동 검사가 애드센스 광고를 불러오면 '무효 트래픽'(자동화 도구가 만든 노출)이 되어 계정 제한 위험
        #  · GA4·Clarity·네이버 애널리틱스에 검사 방문이 사람 방문처럼 쌓이는 것도 막음
        #  · 스크립트는 빈 내용으로 응답 → 사이트 코드(gtag·clarity 대기열·wcs_do 확인)는 오류 없이 그대로 동작
        blocked = {'n': 0}
        def track_block(route):
            blocked['n'] += 1
            route.fulfill(status=200, content_type='application/javascript', body='')
        ctx.route(TRACK_RE, track_block)
        def track_leak(q):
            u = q.url
            if not TRACK_RE.match(u) and any(k in (urllib.parse.urlparse(u).hostname or '') for k in TRACK_HINT):
                fail('track', '광고·분석 요청이 차단 목록을 벗어남: ' + u[:160])
        ctx.on('request', track_leak)
        if local:   # ETF 차트 비교 일봉: 로컬 주소는 Worker 가 막으므로(허용 출처 아님) 합성 자료로 대신 · 공개 프록시도 부르지 않게
            ctx.route(re.compile(r'.*workers\.dev/etf\?.*'), etf_route)
            ctx.route(re.compile(r'.*/data/etfdist/\d\.json.*'), etf_dist_route)
            ctx.route(re.compile(r'.*/data/etfbt/.*\.json.*'), etf_bt_route)
            ctx.route(re.compile(r'.*allorigins\.win/.*'), lambda r: r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, body=''))
        page = ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append((m.text, (m.location or {}).get('url', ''))) if m.type == 'error' else None)
        def page_err(e):
            st = getattr(e, 'stack', '') or ''
            urls = [u for u in __import__('re').findall(r'https?://[^\s)]+', st)]
            if urls and all(any(d in u for d in THIRD) for u in urls):
                return                                      # 외부 광고·분석 스크립트 안에서만 난 오류 → 사이트 오류 아님
            errs.append(('pageerror: ' + str(e) + (' @ ' + urls[0][:120] if urls else ' (스택 없음)'), base))
        page.on('pageerror', page_err)
        def bad_resp(r):
            u = r.url
            if r.status >= 400 and not any(d in u for d in THIRD) and not (local and 'workers.dev' in u):
                errs.append(('HTTP %d %s' % (r.status, u[:160]), base))
        page.on('response', bad_resp)
        page.on('requestfailed', lambda q: errs.append(('요청 실패 %s %s' % (q.failure, q.url[:160]), base))
                if 'ERR_ABORTED' not in str(q.failure) and not any(d in q.url for d in THIRD) and not (local and ('workers.dev' in q.url or 'raw.githubusercontent' in q.url)) else None)

        if a.etf_audit:
            print('[ETF 실제 가격 점검] %s' % base, flush=True)
            k = etf_audit(page, base, fail)
            br.close()
            if not blocked['n']:
                fail('track', '광고·분석 요청 차단 0건 — 차단 목록이 사이트의 실제 주소와 어긋났을 수 있음')
            print('광고·분석 요청 차단 %d건' % blocked['n'])
            print('\n대조 %d줄 · %.0f초 · 실패 %d건' % (k, time.time() - t0, len(fails)))
            sys.exit(1 if fails or not k else 0)

        if a.selftest:
            page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(800); errs.clear()
            page.evaluate("""() => { const d = document.createElement('div'); d.style.cssText = 'width:2000px;height:10px';
                document.querySelector('.app-page:not([style*="none"]) .card, .wrap').appendChild(d); setTimeout(() => { throw new Error('selftest'); }); }""")
            page.wait_for_timeout(300)
            r = page.evaluate(OVERFLOW_JS)
            caught = r['sw'] > r['vw'] + 1 and any('selftest' in t for t, u in errs)
            print('자체 확인: 넘침 감지 %s (문서 %dpx > 화면 %dpx) · 스크립트 오류 감지 %s' % (
                r['sw'] > r['vw'] + 1, r['sw'], r['vw'], any('selftest' in t for t, u in errs)))
            br.close()
            sys.exit(0 if caught else 1)

        # 1·2. 전 경로 × 화면 폭
        print('[1] 전 경로 %d개 × 화면 폭 %d개' % (len(paths), len(widths)), flush=True)
        for path in paths:
            errs.clear()
            page.set_viewport_size({'width': 1440, 'height': 900})
            page.goto(base + path, wait_until='load', timeout=60000)
            page.wait_for_timeout(1200)
            for w in widths:
                page.set_viewport_size({'width': w, 'height': 900})
                page.wait_for_timeout(120)
                r = page.evaluate(OVERFLOW_JS)
                if r['sw'] > r['vw'] + 1:
                    fail(path, '%dpx 가로 넘침 (문서 %dpx)%s' % (w, r['sw'], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
                elif r['out']:
                    fail(path, '%dpx 화면 밖 요소: %s' % (w, ', '.join(r['out'])))
            bad = [t for t, u in errs if not ignorable(t, u)]
            for t in bad[:3]:
                fail(path, '콘솔 오류: ' + t[:200])

        # 3. 메뉴 · 검색 · 허브 카드
        print('[2] 메뉴 · 검색 · 허브 카드', flush=True)
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.goto(base, wait_until='load'); page.wait_for_timeout(800)
        n = page.evaluate("document.querySelectorAll('[id^=\"drop-\"]').length")
        if n != len(routes) + 1:
            fail('', '메뉴 항목 %d개 (기대 %d = 홈 + 도구 %d)' % (n, len(routes) + 1, len(routes)))
        missing = page.evaluate("tabs => tabs.filter(t => !document.getElementById('drop-' + t))", [r['tab'] for r in routes])
        if missing:
            fail('', '메뉴에 없는 도구: ' + ', '.join(missing))
        for q, want in [('연봉', '연봉'), ('무한', '무한매수법'), ('취득세', '취득세'), ('배당', '배당')]:
            res = page.evaluate("""async q => { const i = document.getElementById('ss-input'); i.focus(); i.value = q;
                i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 300));
                const l = document.getElementById('ss-list'); return { hidden: l.hidden, items: [...l.children].map(c => c.textContent) }; }""", q)
            if res['hidden'] or not any(want in t for t in res['items']):
                fail('', '검색 "%s" 결과에 "%s" 없음 (%s)' % (q, want, res['items'][:5]))
        for hub in [r for r in routes if r.get('hub')]:
            want = len([r for r in routes if r['group'] == hub['group'] and not r.get('hub')])
            page.goto(base + hub['path'] + '/', wait_until='load'); page.wait_for_timeout(500)
            got = page.evaluate("[...document.querySelectorAll('.app-page')].filter(p => getComputedStyle(p).display !== 'none').reduce((a, p) => a + p.querySelectorAll('.hub-card').length, 0)")
            if got != want:
                fail(hub['path'], '허브 카드 %d개 (같은 그룹 도구 %d개)' % (got, want))

        # 4. 무한매수법 엔진 · 화면 · 가이드북
        print('[3] 무한매수법 엔진 · 기록 화면 · 가이드북', flush=True)
        errs.clear()
        page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(2500)
        for t in page.evaluate(MUHAN_JS):
            if not t['ok']:
                fail('muhan', '엔진 %s: got=%s exp=%s' % (t['name'], json.dumps(t.get('got'), ensure_ascii=False), json.dumps(t.get('exp'), ensure_ascii=False)))
        g = page.evaluate("""async () => {
          const g = document.getElementById('mhg'); if (!g) return { none: true };
          const root = document.getElementById('mh-root');
          const asof = [...g.querySelectorAll('[data-mk="asof"]')].map(e => e.textContent);
          const sim = [...g.querySelectorAll('[data-sim]')].filter(e => !e.textContent.trim()).length;
          window.mhGuide('mhg-3-1'); await new Promise(r => setTimeout(r, 400));
          const prog = document.getElementById('mhg-prog-txt').textContent;
          const bt = () => { const b = document.getElementById('mhbt-body'); return b ? { rows: b.querySelectorAll('.mhbt-tbl tbody tr').length, cards: b.querySelectorAll('.mhbt-card').length, txt: b.textContent } : null; };
          for (let i = 0; i < 40 && !(bt() && /계산 \\d{4}-/.test(bt().txt) && document.getElementById('mhbt')._bt); i++) await new Promise(r => setTimeout(r, 250));
          const bt0 = bt(); document.querySelector('#mhbt [data-bt-tk="SOXL"]').click(); await new Promise(r => setTimeout(r, 300));
          const bt1 = bt(); document.querySelector('#mhbt [data-bt-bg="5"]').click(); await new Promise(r => setTimeout(r, 300));
          const bt2 = bt(), btOn = [...document.querySelectorAll('#mhbt .mhbt-seg button.on')].map(b => b.textContent);
          return { chapters: g.querySelectorAll('details.mhg-ch').length, terms: g.querySelectorAll('dl.mhg-dl dt').length,
                   bt0, bt1, bt2, btOn, asof, sim, opened: document.getElementById('mhg-3-1').open, hash: location.hash, prog,
                   ui: root ? root.children.length : 0, store: !!(window.MHdebug && window.MHdebug.store) };
        }""")
        if g.get('none'):
            fail('muhan', '가이드북(#mhg) 없음')
        else:
            if g['chapters'] != 23: fail('muhan', '가이드북 장 %d개 (기대 23)' % g['chapters'])
            if g['terms'] != 31: fail('muhan', '용어 %d개 (기대 31)' % g['terms'])
            if not g['asof'] or not all(s.strip() for s in g['asof']): fail('muhan', 'PART 1·3 자동 숫자 미적용 (기준일 표시 없음): %s' % g['asof'])
            if g['sim']: fail('muhan', '3-1 모의 계산 빈 칸 %d개' % g['sim'])
            b0, b1, b2 = g.get('bt0') or {}, g.get('bt1') or {}, g.get('bt2') or {}
            if b0.get('rows') != 10 or b0.get('cards') != 4: fail('muhan', '3-6 백테스트 표 이상 (행 %s · 카드 %s, 기대 10 · 4)' % (b0.get('rows'), b0.get('cards')))
            if 'SOXL' not in (b1.get('txt') or '') or b1.get('txt') == b0.get('txt'): fail('muhan', '3-6 종목 전환(SOXL) 안 됨')
            if b2.get('txt') == b1.get('txt') or b2.get('rows') != 10: fail('muhan', '3-6 큰수 전환(5%) 안 됨')
            if g.get('btOn') != ['SOXL', '5%']: fail('muhan', '3-6 선택 버튼 표시 이상: %s' % g.get('btOn'))
            if not g['opened'] or g['hash'] != '#mhg-3-1': fail('muhan', 'mhGuide 장 열기 실패 (%s, %s)' % (g['opened'], g['hash']))
            if not g['prog'].endswith('1개 읽음'): fail('muhan', '읽음 진행률 표시 이상 (새 브라우저에서 1개 장을 열었는데): ' + g['prog'])
            if not g['ui']: fail('muhan', '기록 화면(#mh-root)이 그려지지 않음')
            if not g['store']: fail('muhan', '기록 저장소(MHdebug.store) 없음')
        bad = [t for t, u in errs if not ignorable(t, u)]
        for t in bad[:3]:
            fail('muhan', '콘솔 오류: ' + t[:200])
        # 무한매수법 버전별 기록 (빈 저장소에서 V2.2 시작 · 기록 · 화면 안 백테스트 · 분할 직접 입력)
        errs.clear()
        page.set_viewport_size({'width': 430, 'height': 900})
        page.evaluate("() => { localStorage.removeItem('muhan4-store'); }")
        page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(2500)
        for t in page.evaluate(MUHANV_JS):
            if not t['ok']:
                fail('muhan', '버전 기록 %s%s' % (t['name'], (' — ' + str(t.get('info'))[:200]) if t.get('info') else ''))
        page.evaluate("() => { localStorage.removeItem('muhan4-store'); }")
        bad = [t for t, u in errs if not ignorable(t, u)]
        for t in bad[:3]:
            fail('muhan', '버전 기록 콘솔 오류: ' + t[:200])
        # 무한매수법 백테스트 화면
        if os.path.isdir(os.path.join(ROOT, 'muhan-backtest')):
            print('[3b] 무한매수법 백테스트', flush=True)
            errs.clear()
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&p=1', wait_until='load')
            for t in page.evaluate(MUHANBT_JS):
                if not t['ok']:
                    fail('muhan-backtest', '%s%s' % (t['name'], (' — ' + str(t.get('info'))[:200]) if t.get('info') else ''))
            bad = [t for t, u in errs if not ignorable(t, u)]
            for t in bad[:3]:
                fail('muhan-backtest', '콘솔 오류: ' + t[:200])
        # 밸류리밸런싱 VR 5.0 — 엔진(라오어 원문 표·공식 그대로)·백테스트 재현·기록 화면 흐름
        if os.path.isdir(os.path.join(ROOT, 'vr')):
            print('[VR] 밸류리밸런싱', flush=True)
            errs.clear()
            page.set_viewport_size({'width': 390, 'height': 844})
            page.goto(base + 'vr/', wait_until='load'); page.wait_for_timeout(1500)
            page.evaluate("localStorage.removeItem('vr5-store'); localStorage.removeItem('vr5-sync')")
            page.reload(wait_until='load'); page.wait_for_timeout(2500)
            v = page.evaluate("""async () => {
              const R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), W = ms => new Promise(r => setTimeout(r, ms)), E = window.VRE, $ = s => document.querySelector(s);
              if (!E || !window.VRdebug) return [{ name: 'VRE·VRdebug 없음', ok: false }];
              const t1 = E.buyTable(10509.46, 176, 383.14, 1e9, 5).map(r => r.price + '/' + r.pool).join(' ');
              ok('원문 매수표 ① (최소값 10,509.46 · 176개)', t1 === '59.71/323.43 59.38/264.05 59.04/205.01 58.71/146.3 58.39/87.91', t1);
              const t2 = E.buyTable(4599.89, 98, 929.09, 1e9, 12).map(r => r.price).join(' ');
              ok('원문 매수표 ② (최소값 4,599.89 · 98개)', t2 === '46.94 46.46 46 45.54 45.1 44.66 44.23 43.81 43.4 42.99 42.59 42.2', t2);
              const nx = E.next(9000, 1000, 10, 'acc', 250);
              ok('원문 V 계산 예 (9,000 + 1,000/10 + 250 = 9,350)', nx.V === 9350 && nx.pool === 1250, nx);
              ok('밴드 ±15% · 인출은 Pool 이 있는 만큼만', E.band(10000, 0.15).min === 8500 && E.band(10000, 0.15).max === 11500 && E.next(10000, 50, 20, 'wd', 100).flow === -50, '');
              ok('Pool 한도 안에서만 매수표', E.buyTable(8500, 100, 1000, 500, 999).reduce((s, r) => s + r.price, 0) <= 500.0001, '');
              const mx = E.sellTable(11500, 100, 0, 3); ok('매도표 = 최대값 ÷ 팔기 전 개수', mx[0].price === 115 && mx[1].price === 116.16 && mx[0].n === 99, mx);
              for (let i = 0; i < 40 && document.querySelectorAll('#vrbt tbody tr').length < 15; i++) await W(250);
              const rows = [...document.querySelectorAll('#vrbt table')].map(t => t.querySelectorAll('tbody tr').length);
              ok('백테스트 표 (그냥 보유 + G 7개 · 원문 비교 7줄)', rows[0] === 8 && rows[1] === 7, rows);
              const diffs = [...document.querySelectorAll('#vrbt table')][1] ? [...[...document.querySelectorAll('#vrbt table')][1].querySelectorAll('tbody tr')].map(tr => parseFloat(tr.cells[3].textContent.replace('−', '-'))) : [];
              ok('라오어 공개 수치 재현 (G 10~100, 연평균 차이 0.3%p 이내)', diffs.length === 7 && diffs.slice(1).every(d => Math.abs(d) <= 0.3), diffs);
              $('[data-vi="setup.n"]').value = '100'; $('[data-vi="setup.n"]').dispatchEvent(new Event('input', { bubbles: true }));
              const p = $('[data-vi="setup.pool"]'); p.value = '1000'; p.dispatchEvent(new Event('input', { bubbles: true }));
              const px = $('[data-vi="setup.px"]'); px.value = '50'; px.dispatchEvent(new Event('input', { bubbles: true }));
              $('[data-va="setup-ok"]').click(); await W(200);
              const c1 = VRdebug.store.accs[0].cycles[0], d = VRdebug.derive();
              ok('계좌 시작: V = 개수 × 현재가 · 밴드 · 매수 한도 75%', c1 && c1.V === 5000 && d.bd.min === 4250 && d.bd.max === 5750 && d.lim === 750 && d.bt.length > 0 && d.bt[0].price === 42.5, c1);
              $('[data-va="close-open"]').click(); await W(150);
              const n = $('[data-vi="close.n"]'); n.value = '100'; n.dispatchEvent(new Event('input', { bubbles: true }));
              const cp = $('[data-vi="close.pool"]'); cp.value = '1000'; cp.dispatchEvent(new Event('input', { bubbles: true })); await W(100);
              $('[data-va="close-ok"]').click(); await W(200);
              const cs = VRdebug.store.accs[0].cycles;
              ok('사이클 마감 → 다음 V = 5,000 + 1,000/10 + 250 = 5,350 · Pool 1,250', cs.length === 2 && cs[0].end && cs[1].V === 5350 && cs[1].pool === 1250 && cs[1].flow === 250, cs.map(c => [c.V, c.pool]));
              $('[data-va="view"][data-v="hist"]').click(); await W(300);
              ok('기록 탭: 그래프·표', !!document.getElementById('vr-chart') && document.querySelectorAll('.vr-tbl.hist .vr-tr').length === 3, '');
              ok('저장 (이 기기)', JSON.parse(localStorage.getItem('vr5-store')).accs[0].cycles.length === 2, '');
              return R;
            }""")
            for t in v:
                if not t['ok']:
                    fail('vr', '%s: %s' % (t['name'], json.dumps(t.get('info'), ensure_ascii=False)))
            page.reload(wait_until='load'); page.wait_for_timeout(1200)
            if page.evaluate("window.VRdebug ? VRdebug.store.accs[0].cycles.length : -1") != 2:
                fail('vr', '새로고침 뒤 기록이 남아 있지 않음')
            page.evaluate("localStorage.removeItem('vr5-store')")
            for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                fail('vr', '콘솔 오류: ' + t[:200])
            page.set_viewport_size({'width': 1440, 'height': 900})
        # 홈 첫 화면 — AI 시대, 노동자에서 자본가로: 두 힘·하나의 답 숫자 · 데이터 탭 · 직업 검색
        print('[홈] 첫 화면', flush=True)
        errs.clear()
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.goto(base, wait_until='load'); page.wait_for_timeout(2500)
        h = page.evaluate("""async () => {
          const R = [], ok = (name, v, info) => R.push({ name, ok: !!v, info }), t = id => (document.getElementById(id) || {}).textContent || '', W = ms => new Promise(r => setTimeout(r, ms));
          ok('제목에 "노동자에서 자본가로"', /노동자에서 자본가로/.test(document.querySelector('#page-home h1').textContent) && /AI/.test(document.querySelector('#page-home h1').textContent), '');
          ok('두 힘·하나의 답 카드 3개 · 숫자 채워짐', document.querySelectorAll('.hm-f').length === 3 && ['hm-k-cpi', 'hm-k-seoul', 'hm-k-spy'].every(id => /^연 [+−-]?\\d/.test(t(id))), ['hm-k-cpi', 'hm-k-seoul', 'hm-k-spy'].map(t));
          ok('아이콘: 메뉴와 같은 선 아이콘(SVG) · 그림 문자 없음', document.querySelectorAll('.hm-tools .dc-ico svg').length === 12 && document.querySelectorAll('.hm-f-k .dc-ico svg, .hm-dtabs .dc-ico svg').length === 7 && !/\\p{Extended_Pictographic}/u.test(document.getElementById('page-home').textContent), (document.getElementById('page-home').textContent.match(/\\p{Extended_Pictographic}/gu) || []).slice(0, 5));
          ok('많이 찾는 도구 12개(ETF 차트 비교 포함 · 무한매수법 자리) · 6단계', document.querySelectorAll('.hm-tools .hm-tool').length === 12 && !!document.querySelector('.hm-tools a[href="etf-compare/"] svg') && !document.querySelector('.hm-tools a[href="muhan/"]') && document.querySelectorAll('.hm-ps').length === 6, '');
          const panels = () => [...document.querySelectorAll('[data-hp-panel]')].map(p => p.hidden);
          ok('데이터 탭: 처음엔 첫 주제만', JSON.stringify(panels()) === '[false,true,true,true]', panels());
          document.querySelector('.hm-dtabs [data-hp="3"]').click(); await W(400);
          const c = document.getElementById('hm-c-chart').getBoundingClientRect();
          ok('데이터 탭 전환 → 숨어 있던 차트가 칸에 맞게 그려짐', JSON.stringify(panels()) === '[true,true,true,false]' && c.width > 200 && c.height > 100, [panels(), c.width, c.height]);
          document.querySelector('.hm-dtabs [data-hp="0"]').click();
          const q = document.getElementById('hm-job-q'); q.value = '자산운용가'; q.dispatchEvent(new Event('input', { bubbles: true })); await W(80);
          ok('직업 검색 제안 → 직업 수명 주소', /job-life\\/#job=%ED%8E%80%EB%93%9C/.test((document.querySelector('#hm-job-sug a') || {}).href || ''), (document.querySelector('#hm-job-sug a') || {}).href);
          return R;
        }""")
        for t in h:
            if not t['ok']:
                fail('home', '%s: %s' % (t['name'], json.dumps(t.get('info'), ensure_ascii=False)))
        for t in [t for t, u in errs if not ignorable(t, u)][:3]:
            fail('home', '콘솔 오류: ' + t[:200])
        # 나의 직업 수명 — 데이터(776개·21분야)·모델 방향·연구 순서·검색·순위·주소·공유
        if os.path.isdir(os.path.join(ROOT, 'job-life')):
            print('[4] 나의 직업 수명', flush=True)
            errs.clear()
            page.goto(base + 'job-life/#job=' + '간호사', wait_until='load'); page.wait_for_timeout(2000)
            z = page.evaluate("""async () => {
              const J = window.JL, D = window.JLdebug, R = [], W = ms => new Promise(r => setTimeout(r, ms));
              if (!J || !D) return [{ name: 'JL·JLdebug 없음', ok: false }];
              const ok = (name, v, info) => R.push({ name, ok: !!v, info });
              const jobs = D.jobs(), on = (x, sp) => { const r = J.calc(x, sp || 'mid'); return r.onset == null ? 99 : r.onset; };
              const names = new Set(jobs.map(x => x.n)), als = jobs.flatMap(x => x.al);
              ok('직업 776개 · 업무 합 10 · 값 범위 · 이름 중복 없음', jobs.length === 776 && names.size === 776 && jobs.every(x => x.D + x.P + x.H === 10 && x.R >= 1 && x.R <= 5 && x.J >= 1 && x.J <= 5 && x.L >= 0 && x.L <= 3), jobs.length);
              ok('별칭이 다른 직업 이름·별칭과 겹치지 않음', new Set(als).size === als.length && als.every(a => !names.has(a)), '');
              ok('분야 21개 · 분야마다 직업·잃을 일/남을 일 있음', J.CATS.length === 21 && J.CATS.every(k => jobs.some(x => x.c === k) && J.LOSE_KEEP[k] && J.LOSE_KEEP[k][0].length && J.LOSE_KEEP[k][1].length), J.CATS.length);
              let mono = 0;
              jobs.forEach(x => {
                const a = on(x), j = on(Object.assign({}, x, { J: Math.min(5, x.J + 1) })), l = on(Object.assign({}, x, { L: Math.min(3, x.L + 1) })), r = on(Object.assign({}, x, { R: Math.max(1, x.R - 1) }));
                if (j < a - 1e-9 || l < a - 1e-9 || r < a - 1e-9 || !(on(x, 'fast') <= a && a <= on(x, 'slow'))) mono++;
              });
              ok('모델 방향: 판단·면허↑ 반복성↓ 이면 늦어짐 · 빠름 ≤ 보통 ≤ 느림', mono === 0, mono + '개 위반');
              const by = n => { const x = J.byName(n); return x ? on(x) : -1; };
              const early = ['콜센터 상담원', '번역가', '데이터 입력원', '경리'].map(by), late = ['요양보호사', '배관공', '간호사', '외과 의사', '헤어디자이너'].map(by);
              ok('연구 순서: 고노출(상담·번역·입력·경리) < 저노출(돌봄·설비·간호·외과·미용)', Math.min(...early) >= 0 && Math.max(...early) < Math.min(...late), [early, late]);
              ok('한국은행 고노출 직업(회계사·펀드매니저)이 돌봄·현장보다 이름', by('공인회계사') >= 0 && Math.max(by('공인회계사'), by('펀드매니저')) < Math.min(by('요양보호사'), by('배관공')), '');
              ok('검색: 별칭·부분 일치', J.find('자산운용가').n === '펀드매니저' && J.find('개발자').n === '소프트웨어 개발자' && J.suggest('간호', 8).length >= 3 && J.POP.every(n => J.byName(n)), '');
              const t = id => document.getElementById(id).textContent, res = document.getElementById('jl-res');
              ok('주소 #job=간호사 로 결과가 열림', !res.hidden && t('jl-r-name') === '간호사' && /\\d/.test(t('jl-r-big')) && document.querySelectorAll('#jl-r-tl li').length >= 3, t('jl-r-name'));
              ok('분야 아이콘: 선 아이콘(SVG) · 그림 문자 없음', document.querySelectorAll('#jl-all .jl-ico svg').length === 30 && document.querySelectorAll('#jl-pop .e svg').length === 8 && document.querySelectorAll('#jl-cats svg').length === 21 && !!document.querySelector('#jl-r-ico svg') && !/\\p{Extended_Pictographic}/u.test(['jl-pop', 'jl-top', 'jl-all', 'jl-cats', 'jl-rand', 'jl-r-ico'].map(t).join('')), '');
              ok('많이 찾는 직업 8개 · TOP 5 · 순위 30줄 · 분야 버튼 22개', document.querySelectorAll('#jl-pop .jl-card').length === 8 && document.querySelectorAll('#jl-top .jl-row').length === 5 && document.querySelectorAll('#jl-all .jl-row').length === 30 && document.querySelectorAll('#jl-cats button').length === 22, '');
              const q = document.getElementById('jl-q'); q.value = '자산운용가'; q.dispatchEvent(new Event('input', { bubbles: true })); await W(80);
              const first = (document.querySelector('#jl-sug li[data-job]') || {}).textContent || '';
              q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await W(150);
              ok('검색창: 제안 → Enter 로 결과', /펀드매니저/.test(first) && t('jl-r-name') === '펀드매니저' && document.getElementById('jl-sug').hidden, [first, t('jl-r-name')]);
              const mid = t('jl-r-big'); document.querySelector('.fc-seg[data-name="jl-spd"] [data-v="slow"]').click(); await W(150);
              ok('속도 느림으로 바꾸면 수명이 바뀜', t('jl-r-big') !== mid, [mid, t('jl-r-big')]);
              document.querySelector('.fc-seg[data-name="jl-spd"] [data-v="mid"]').click(); await W(100);
              document.querySelector('#jl-cats [data-cat="med"]').click(); await W(100);
              const medOk = [...document.querySelectorAll('#jl-all .jl-row')].every(li => J.byName(li.dataset.job).c === 'med');
              document.querySelector('#jl-sort [data-v="desc"]').click(); await W(100);
              const rows = [...document.querySelectorAll('#jl-all .jl-row')].map(li => by(li.dataset.job));
              ok('분야 거르기 · 늦은 순 정렬', medOk && rows.length > 5 && rows[0] >= rows[rows.length - 1], rows.slice(0, 3));
              document.querySelector('#jl-cats [data-cat="all"]').click(); document.querySelector('#jl-sort [data-v="asc"]').click(); await W(80);
              document.getElementById('jl-morebtn').click(); await W(100);
              const nRows = () => document.querySelectorAll('#jl-all .jl-row').length, no1 = () => +(document.querySelector('#jl-all .jl-no') || {}).textContent;
              ok('더 보기 (30 → 60줄, 페이지 1·2 함께 표시)', nRows() === 60 && document.querySelectorAll('#jl-pager .dv-pg.active').length === 2, nRows());
              document.querySelector('#jl-pager .dv-pg[data-pg="3"]').click(); await W(100);
              ok('페이지 3 → 61~90위만', nRows() === 30 && no1() === 61 && /61–90 \\/ 776/.test(t('jl-pager')), [nRows(), no1(), t('jl-pager')]);
              const gi = document.querySelector('#jl-pager .dv-pg-go input'); gi.value = 26; document.querySelector('#jl-pager .dv-pg-gobtn').click(); await W(150);
              ok('번호 입력 이동(26쪽 = 마지막 26줄) · 다음 버튼 꺼짐', nRows() === 26 && no1() === 751 && document.getElementById('jl-morebtn').hidden && document.querySelector('#jl-pager [aria-label="다음 페이지"]').disabled, [nRows(), no1()]);
              document.querySelector('#jl-pager .dv-pg[data-pg="1"]').click(); await W(100);
              const row = document.querySelectorAll('#jl-all .jl-row')[3]; row.click(); await W(150);
              ok('순위 줄을 누르면 그 직업 결과', t('jl-r-name') === row.dataset.job && location.hash === '#job=' + encodeURIComponent(row.dataset.job), [t('jl-r-name'), location.hash]);
              ok('은퇴 비교(4% 규칙)·공유 카드', /4% 규칙/.test(t('jl-cap')) && window.dcShareSpec && window.dcShareSpec['job-life'] && window.dcShareSpec['job-life'].title.indexOf(row.dataset.job) === 0, '');
              const d = document.getElementById('jl-d'); d.value = 0; d.dispatchEvent(new Event('input', { bubbles: true })); await W(80);
              ok('내 일에 맞게 조정 → 표시', /조정/.test(t('jl-r-cat')), t('jl-r-cat'));
              document.getElementById('jl-close').click(); await W(80);
              ok('닫기 → 결과·공유 카드 비움', res.hidden && window.dcShareSpec['job-life'] === null && !/job=/.test(location.hash), '');
              return R;
            }""")
            for t in z:
                if not t['ok']:
                    fail('job-life', '%s: %s' % (t['name'], json.dumps(t.get('info'), ensure_ascii=False)))
            for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                fail('job-life', '콘솔 오류: ' + t[:200])
        # ETF 차트 비교 — 보기 2가지(시장가·기준가)·기간·MAX(가장 늦게 상장한 ETF 기준)·계산·정렬·재투자 수수료·검색·최대 10개·원화 환산·주소 복원·묶음 버튼·자료 없음
        if os.path.isdir(os.path.join(ROOT, 'etf-compare')):
            print('[ETF] ETF 차트 비교', flush=True)
            errs.clear()
            epoch = _dt.date(1970, 1, 1)
            ready = ("() => window.ECXdebug && ECXdebug.S.ready && ECXdebug.S.sel.length && !Object.keys(ECXdebug.S.pend).length"
                     " && !Object.keys(ECXdebug.S.distP).length && !Object.keys(ECXdebug.S.exP).length && !Object.keys(ECXdebug.S.pgP).length"
                     " && !Object.keys(ECXdebug.S.btP).length && !Object.keys(ECXdebug.S.depP).length"   # 상장 전 백테스트 식 묶음·재료까지
                     " && ECXdebug.S.sel.every(s => !ECXdebug.S.data[s.k + s.c] || ECXdebug.prepOf(s))"
                     " && (!ECXdebug.S.fx || ECXdebug.S.fxd)")
            del ETF_LOG[:]
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.goto('about:blank'); page.goto(base + 'etf-compare/', wait_until='load')
            try:
                page.wait_for_function(ready, timeout=45000)
                x = page.evaluate(ETF_JS, local)
            except Exception as ex:
                x = {'R': [{'name': '화면 준비·검사 실행', 'ok': False, 'info': str(ex)[:200]}], 'm': {}, 'S1y': 0, 'maxS': 0, 'late': False, 'ix': {}}
            for t in x['R']:
                if not t['ok']:
                    fail('etf-compare', '%s: %s' % (t['name'], json.dumps(t.get('info'), ensure_ascii=False)))
            if local:   # 합성 일봉·분배 → 숫자까지 (실제 달력처럼 국내 2025-10-03~09 휴장 → 1Y 기준은 10-02 종가)
                log = list(ETF_LOG)
                if x['S1y'] != (_dt.date(2025, 10, 9) - epoch).days:
                    fail('etf-compare', '1Y 기준일 %s (기대 2025-10-09)' % x['S1y'])
                keys = ['K069500', 'K360750', 'USPY', 'UQQQ']
                for mode in ('px', 'nav'):
                    got, exp = x['m'].get(mode, {}), etf_expect(keys, x['S1y'], mode)
                    if sorted(got) != sorted(keys):
                        fail('etf-compare', '%s 1Y 표 종목 %s (기대 %s)' % (mode, sorted(got), keys)); continue
                    for k in keys:
                        etf_cmp(fail, '%s 1Y %s' % (mode, k), got[k], exp[k])
                n = etf_expect(keys, x['S1y'], 'nav')
                if not (n['K069500']['nk'] > 0 and n['K069500']['na'] > 0 and n['K360750']['nk'] == n['K360750']['n'] > 0 and n['USPY']['n'] > 0):
                    fail('etf-compare', '합성 자료가 과세표준 공개·평균 비율·미국 배당을 모두 담지 못함: %s' % {k: [v['n'], v['nk'], v['na']] for k, v in n.items()})
                for ik, rk in (('IKOSPI', 'KKOSPI'), ('ISPX', 'U^GSPC')):   # 지수: 네이버 KOSPI · 야후 ^GSPC 합성 일봉의 종가 비율
                    e1, g1 = etf_expect([rk], x['S1y'], 'px')[rk], (x.get('ix') or {}).get('px', {}).get(ik)
                    if not g1 or abs(g1['ret'] - e1['ret']) > 1e-9 or abs(((x.get('ix') or {}).get('nav', {}).get(ik) or {}).get('ret', 9) - e1['ret']) > 1e-9:
                        fail('etf-compare', '지수 %s 1Y 수익률: 화면 %s · 기대 %.10f' % (ik, g1 and g1['ret'], e1['ret']))
                if x['maxS'] != (ETF_FIRST['K0167A0'] - epoch).days or not x['late']:
                    fail('etf-compare', 'MAX 기준일 %s (기대 2026-03-17 = 가장 늦게 상장한 0167A0) · 1Y 기간 중 상장 %s' % (x['maxS'], x['late']))
                # 기간설정 2026-05-09 ~ 2026-09-09 (시가 기준) — 야후에 빠진 기준일(K360750 05-11)·끝날(K498400 09-09)도 실제 가격으로
                want = {'K069500': 'K069500', 'K360750': 'K360750', 'K498400': 'K498400', 'USPY': 'USPY', 'IKOSPI': 'KKOSPI'}
                ce = etf_expect(list(want.values()), (_dt.date(2026, 5, 9) - epoch).days, 'px', E=(_dt.date(2026, 9, 9) - epoch).days, open_=True)
                if sorted(x.get('c') or {}) != sorted(want):
                    fail('etf-compare', '기간설정 표 종목 %s (기대 %s)' % (sorted(x.get('c') or {}), sorted(want)))
                else:
                    for k, sk in want.items():
                        etf_cmp(fail, '기간설정 %s' % k, x['c'][k], ce[sk])
                # 사용자가 찾은 사례: 분배가 잦은 국내 ETF(K498400) + 코스피 · MAX → K498400 상장일(2024-12-03) 시가 → 마지막 거래일 종가
                me = etf_expect(['K498400', 'KKOSPI'], (ETF_FIRST['K498400'] - epoch).days, 'px', open_=True)
                if sorted(x.get('xm') or {}) != ['IKOSPI', 'K498400']:
                    fail('etf-compare', 'MAX(K498400·코스피) 표 종목 %s' % sorted(x.get('xm') or {}))
                else:
                    etf_cmp(fail, 'MAX K498400', x['xm']['K498400'], me['K498400']); etf_cmp(fail, 'MAX 코스피', x['xm']['IKOSPI'], me['KKOSPI'])
                # 합성 자료가 정말 '역산하면 틀리는' 조건인지 (수정주가 ÷ 구간 비율 → 호가 단위 근사가 실제 가격과 다른 날이 기준·끝날에 있음)
                bad = 0
                for k in ('K069500', 'K360750', 'K498400'):
                    days, raw = etf_series(k); f = etf_factors(raw, etf_dists(k, raw))
                    adj = json.loads(etf_body(k).replace("'", '"'))[1:]
                    bad += sum(1 for t, r in enumerate(adj) if f[t] != 1 and _tick(r[4] / f[t]) != raw[t])
                if bad < 50:
                    fail('etf-compare', '합성 수정주가가 너무 정확해 역산 오류를 재현하지 못함 (틀리는 날 %d)' % bad)
                # 실제 가격 요청: m=kr = 분배로 수정주가가 달라진 국내 ETF 만(분배 없는 0167A0 은 안 부름) · m=kp = 야후에 빠진 기준·끝날만 (화면이 추정한 쪽 = 실제 쪽)
                kr = sorted({r[1] for r in log if r[0] == 'kr'}); kp = sorted((r[1], r[2]) for r in log if r[0] == 'kp')
                if kr != ['069500', '360750', '498400']:
                    fail('etf-compare', '실제 거래 가격(m=kr) 요청 종목 %s (기대 069500·360750·498400)' % kr)
                if kp != [('069500', '20100615'), ('069500', '20100617'), ('069500', '20251002'), ('360750', '20260511'), ('498400', '20260909')]:
                    fail('etf-compare', '일별 시세 한 쪽(m=kp) 요청 %s (기대 069500 2010-06-15(자료 전 → 한 번만)·06-17(같은 쪽 나머지) · 2025-10-02 · 360750 2026-05-11 · 498400 2026-09-09)' % kp)
                if any(r[3] != r[4] for r in log if r[0] == 'kp' and r[4] != 'first'):
                    fail('etf-compare', '화면이 추정한 일별 시세 쪽 번호가 실제와 다름: %s' % [r for r in log if r[0] == 'kp'])
            # 주소로 열기(공유 링크): 종목·기간·원화 환산 복원 (로컬은 자료 없는 종목도 섞어 '자료 없음' 표시 확인)
            page.goto('about:blank')
            page.goto(base + 'etf-compare/#e=USPY,K069500,ISPX%s&p=MAX&fx=1&m=tr' % (',UNODATA' if local else ''), wait_until='load')   # 예전 주소의 m=tr → 기준가
            try:
                page.wait_for_function(ready, timeout=45000)
            except Exception:
                pass
            h = page.evaluate("""() => { const S = window.ECXdebug && ECXdebug.S, r = S && S.last; if (!S) return {};
                return { sel: S.sel.map(s => s.k + s.c), per: S.per, fx: S.fx, box: document.getElementById('ecx-fx').checked, mode: S.mode, hash: location.hash,
                  active: [...document.querySelectorAll('#ecx-per .chart-tab.active')].map(b => b.dataset.per), S: r && r.w ? r.w.S : null,
                  firsts: r && r.list ? r.list.map(o => o.s.d[0]) : [], chips: document.getElementById('ecx-sel').innerText, tbl: document.getElementById('ecx-stats').innerText }; }""")
            want = ['USPY', 'K069500', 'ISPX'] + (['UNODATA'] if local else [])
            if h.get('sel') != want or h.get('per') != 'MAX' or not h.get('fx') or not h.get('box') or h.get('active') != ['MAX'] or h.get('mode') != 'nav' or '&m=nav' not in (h.get('hash') or ''):
                fail('etf-compare', '주소 복원 실패: %s' % json.dumps({k: h.get(k) for k in ('sel', 'per', 'fx', 'box', 'active', 'mode', 'hash')}, ensure_ascii=False))
            if not h.get('firsts') or h.get('S') != max(h['firsts']):
                fail('etf-compare', '주소 복원 MAX 기준일 %s · 첫 거래일 %s' % (h.get('S'), h.get('firsts')))
            if local and (h.get('chips', '').count('자료 없음') != 1 or '자료 없음' not in h.get('tbl', '')):
                fail('etf-compare', "자료 없는 종목 → '자료 없음' 표시 안 됨: %s" % h.get('chips', '')[:120])
            # 같은 페이지에서 주소의 #e=… 만 바뀐 경우(주소창 수정·뒤로 가기): 라우터가 먼저 다시 그려도 새 주소가 이겨야 함
            page.evaluate("location.hash = '#e=UQQQ&p=3M'"); page.wait_for_timeout(300)
            try:
                page.wait_for_function(ready, timeout=30000)
            except Exception:
                pass
            hc = page.evaluate("() => { const S = ECXdebug.S; return [S.sel.map(s => s.k + s.c), S.per, S.fx, S.mode, location.hash]; }")
            if hc != [['UQQQ'], '3M', False, 'px', '#e=UQQQ&p=3M']:
                fail('etf-compare', '주소의 #e= 만 바꾼 경우 반영 안 됨: %s' % hc)
            # 좁은 화면: 표는 옆으로 밀기(이름 칸 고정) + 안내 · 넓은 화면은 안내 없음
            page.set_viewport_size({'width': 390, 'height': 844})
            try:   # 창 크기 바뀜 → 250ms 뒤 다시 그림 (CI 가 느려도 고정 대기 대신 상태를 기다림)
                page.wait_for_function("() => !document.getElementById('ecx-swipe').hidden", timeout=8000)
            except Exception:
                pass
            m = page.evaluate("""() => ({ hint: !document.getElementById('ecx-swipe').hidden, sticky: getComputedStyle(document.querySelector('#ecx-stats td')).position,
                  scroll: (s => s.scrollWidth > s.clientWidth)(document.querySelector('#page-etfcmp .table-scroll')) })""")
            if not (m['hint'] and m['sticky'] == 'sticky' and m['scroll']):
                fail('etf-compare', '390px 표 옆으로 밀기·이름 고정·안내 이상: %s' % m)
            page.set_viewport_size({'width': 1280, 'height': 900})
            try:
                page.wait_for_function("() => document.getElementById('ecx-swipe').hidden", timeout=8000)
            except Exception:
                pass
            if not page.evaluate("document.getElementById('ecx-swipe').hidden"):
                fail('etf-compare', '1280px 에서 옆으로 밀기 안내가 보임')
            for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                fail('etf-compare', '콘솔 오류: ' + t[:200])
            # 영어판 /en/etf-compare/ — 언어·보기 버튼·표 머리·표 설명·기간 설명이 영어 · 목록·표가 그려짐 · 종목 이름 말고는 한글 없음
            if os.path.isdir(os.path.join(ROOT, 'en', 'etf-compare')):
                errs.clear()
                page.goto('about:blank'); page.goto(base + 'en/etf-compare/#e=K069500,K360750,USPY,UQQQ,ISPX&p=1Y&m=nav', wait_until='load')
                try:
                    page.wait_for_function(ready, timeout=45000)
                except Exception:
                    pass
                e = page.evaluate("""() => { const S = window.ECXdebug && ECXdebug.S, g = document.getElementById('page-etfcmp'); if (!S || !g) return { none: true };
                    const info = [...document.querySelectorAll('#ecx-stats .ecx-info')].map(x => x.textContent);
                    const c = g.cloneNode(true); c.querySelectorAll('#ecx-sel, #ecx-leg, #ecx-stats td:first-child, #ecx-range, #ecx-sug, [translate="no"]').forEach(x => x.remove());
                    return { lang: document.documentElement.lang, modes: [...document.querySelectorAll('#ecx-mode button')].map(b => b.textContent.trim()),
                      head: [...document.querySelectorAll('#ecx-head th')].map(t => t.textContent.replace(/[▼▲↕]/g, '').trim()), rows: document.querySelectorAll('#ecx-stats tr').length,
                      list: !!(S.L && S.L.length > 4000), info, range: document.getElementById('ecx-range').textContent, ko: (c.textContent.match(/[가-힣]+/g) || []).slice(0, 8),
                      koInfo: info.some(t => /[가-힣]/.test(t)), presets: [...document.querySelectorAll('#ecx-presets button')].map(b => b.textContent).join('|'),
                      mk: [...document.querySelectorAll('.ecx-mk button')].map(b => b.textContent.trim()), idxName: (S.by.ISPX || {}).n, cells: [...document.querySelectorAll('#ecx-stats tr')].map(tr => tr.cells[6] ? tr.cells[6].textContent : '') }; }""")
                if e.get('none'):
                    fail('en/etf-compare', 'ECXdebug·페이지 없음')
                else:
                    if e['lang'] != 'en': fail('en/etf-compare', 'html lang=%s' % e['lang'])
                    if e['modes'] != ['Market price', 'Reinvested (after tax)']: fail('en/etf-compare', '보기 버튼 %s' % e['modes'])
                    if e['head'] != ['ETF', 'Return', 'CAGR', 'Annualized', 'Max drawdown', 'Volatility (ann.)', 'Start → end price']: fail('en/etf-compare', '표 머리 %s' % e['head'])
                    if len(e['cells']) != 5 or not all(re.match(r'^\d{4}-\d\d-\d\d (open|close) [₩$]?[\d,.]+→ \d{4}-\d\d-\d\d close [₩$]?[\d,.]+(Data from|Listed in period|Data starts in period|Listed \d{4}-\d\d-\d\d · backtest (from|starts))', c) for c in e['cells']):
                        fail('en/etf-compare', '기준·끝 가격 칸이 영어 형식이 아님: %s' % [c[:80] for c in e['cells']])
                    if not e['list'] or e['rows'] != 5: fail('en/etf-compare', '목록 %s · 표 %d줄 (기대 5)' % (e['list'], e['rows']))
                    if len(e['info']) != 5 or e['koInfo'] or not all('of principal' in t for t in e['info'][:4]) or 'price index' not in e['info'][4]: fail('en/etf-compare', '표 이름 아래 설명이 영어가 아님: %s' % e['info'])
                    if e['mk'] != ['All', 'Korea', 'U.S.', 'Indices'] or e['idxName'] != 'S&P 500': fail('en/etf-compare', '시장 단추·지수 이름이 영어가 아님: %s · %s' % (e['mk'], e['idxName']))
                    if 'From' not in e['range'] or 'Reinvested (after tax)' not in e['range']: fail('en/etf-compare', '기간 설명이 영어가 아님: %s' % e['range'][:160])
                    if e['ko']: fail('en/etf-compare', '영어 화면에 한글 남음: %s' % e['ko'])
                    if 'KOSPI vs S&P 500' not in e['presets']: fail('en/etf-compare', '묶음 버튼이 영어가 아님: %s' % e['presets'][:120])
                for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                    fail('en/etf-compare', '콘솔 오류: ' + t[:200])
                if local:   # 백테스트 방법 문구의 한국거래소 옵션 지수 이름('한글|영문')이 영어판에서 영문으로 (합성 식 K289480 — 체인 포함)
                    page.goto('about:blank'); page.goto(base + 'en/etf-compare/#e=K289480&p=MAX', wait_until='load')
                    try:
                        page.wait_for_function("() => window.ECXdebug && ECXdebug.S.ready && document.querySelector('#ecx-stats .ecx-bt')", timeout=45000)
                    except Exception:
                        pass
                    t_ = page.evaluate("() => (document.querySelector('#ecx-stats .ecx-bt') || {}).textContent || ''")
                    if not re.match(r'^Backtest: KOSPI 200 Covered Call ATM · expected error ±1\.4pp/yr \(chained earlier part ±4\.4pp\)$', t_):
                        fail('en/etf-compare', '백테스트 방법 문구(한국거래소 옵션 지수 영문 이름)가 영어가 아님: %s' % t_[:160])
            # 상장 전 백테스트 — 로컬: 합성 식(환 노출·체인·콜 매도 덧씌우기·S&P TR 이어 붙이기·재료 없음)을 파이썬 기준 구현과 숫자까지 · 배포: 실제 식 점검
            print('[ETF] 상장 전 백테스트', flush=True)
            errs.clear()
            page.goto('about:blank'); page.goto(base + 'etf-compare/', wait_until='load')
            try:
                page.wait_for_function(ready, timeout=45000)
            except Exception:
                pass
            hash_ = '#e=K133690,K122630,UTQQQ,USSO,UIWM,K091160,UQYLD,K289480&p=MAX' if local else '#e=K498400,K360750,UTQQQ&p=MAX'
            try:
                b = page.evaluate(bt_synth.BT_JS, {'hash': hash_})
            except Exception as ex:
                b = {'R': [{'name': '백테스트 검사 실행', 'ok': False, 'info': str(ex)[:200]}]}
            for t in b.get('R', []):
                if not t['ok']:
                    fail('etf-backtest', '%s: %s' % (t['name'], json.dumps(t.get('info'), ensure_ascii=False)))
            bt_check(fail, b, local)
            bt_data_check(fail)
            if not local:   # 실제 식·자료: 모의 커버드콜(Z:)을 쓰는 ETF 백테스트가 식대로 그려지는지 (한·영)
                bt_zsim_live(page, base, fail, errs, ignorable)
            if local:   # 식 고르기 스크립트의 모의 커버드콜 계산·받기 실패 안전장치 (합성 자료로)
                try:
                    for m_ in bt_synth.fit_selfcheck():
                        fail('etf-backtest', m_)
                except Exception as ex:
                    fail('etf-backtest', '식 고르기 스크립트 점검 실패: %r' % ex)
            # 후보 일봉 자료 오류 정리(btClean): 화면 JS = 순수 파이썬 기준 구현(= 로컬은 scripts/etf_bt_fit.clean_dep 까지) — 일부러 넣은 오류로
            try:
                cases = bt_synth.clean_cases()
                got = page.evaluate("cs => cs.map(c => { const r = ECX.btClean(c.k, { d: c.d, a: c.a, cur: 'KRW' }); return { d: r.d, a: r.a }; })", cases)
                ref_np = None
                if local:
                    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
                    import numpy as _np, etf_bt_fit as _F
                    ref_np = lambda c: [x.tolist() for x in _F.clean_dep(c['k'], _np.array(c['d'], _np.int64), _np.array(c['a'], _np.float64))]
                close = lambda x, y: len(x) == len(y) and all(abs(p - q) <= 1e-12 * max(1.0, abs(q)) for p, q in zip(x, y))
                for c, g in zip(cases, got):
                    ed, ea = bt_synth.clean_ref(c['k'], c['d'], c['a'])
                    if g['d'] != ed or not close(g['a'], ea):
                        fail('etf-backtest', '자료 오류 정리(btClean)가 기준과 다름: %s · 날 %d/%d' % (c['name'], len(g['d']), len(ed)))
                    if ref_np:
                        nd, na = ref_np(c)
                        if nd != ed or not close(na, ea):
                            fail('etf-backtest', '자료 오류 정리(clean_dep 파이썬)가 기준과 다름: %s' % c['name'])
                    same = ea == [round(y, 6) for y in c['a']][-len(ea):]
                    if same and c['k'] in ('K:TESTA', 'K:TESTB', 'K:TESTF'):
                        fail('etf-backtest', '자료 오류 정리 시험 자료에 정리할 오류가 없음: %s' % c['name'])
                    if not same and c['k'][0] == 'U':
                        fail('etf-backtest', '미국 일봉은 정리하지 않아야 함: %s' % c['name'])
            except Exception as ex:
                fail('etf-backtest', '자료 오류 정리 검사 실행: %s' % str(ex)[:200])
            for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                fail('etf-backtest', '콘솔 오류: ' + t[:200])
        # 영어판 무한매수법 — 가이드북·3-6·자동 숫자가 영어로, 일부러 남긴 원어(translate=no) 밖에는 한글 없음
        if os.path.isdir(os.path.join(ROOT, 'en', 'muhan')):
            errs.clear()
            page.goto(base + 'en/muhan/', wait_until='load'); page.wait_for_timeout(2500)
            e = page.evaluate("""async () => {
              const g = document.getElementById('mhg'); if (!g) return { none: true };
              for (let i = 0; i < 40 && !/computed \\d{4}-/.test((document.getElementById('mhbt-body') || {}).textContent || ''); i++) await new Promise(r => setTimeout(r, 250));
              const c = g.cloneNode(true); c.querySelectorAll('[translate="no"]').forEach(x => x.remove());
              const ko = (c.textContent.match(/[가-힣]+/g) || []).slice(0, 5);
              const asof = [...g.querySelectorAll('[data-mk="asof"]')].map(x => x.textContent);
              return { lang: document.documentElement.lang, chapters: g.querySelectorAll('details.mhg-ch').length, terms: g.querySelectorAll('dl.mhg-dl dt').length,
                       ko, asof, rows: document.querySelectorAll('#mhbt-body .mhbt-tbl tbody tr').length, bt: (document.getElementById('mhbt-body') || {}).textContent || '',
                       prog: document.getElementById('mhg-prog-txt').textContent, sim: (g.querySelector('[data-sim="down:20"]') || {}).textContent || '' };
            }""")
            if e.get('none'): fail('en/muhan', '영어 가이드북(#mhg) 없음')
            else:
                if e['lang'] != 'en': fail('en/muhan', 'html lang=%s' % e['lang'])
                if e['chapters'] != 23 or e['terms'] != 31: fail('en/muhan', '영어 가이드북 장 %d · 용어 %d (기대 23 · 31)' % (e['chapters'], e['terms']))
                if e['ko']: fail('en/muhan', '영어 가이드북에 한글 남음: %s' % e['ko'])
                if not all('as of' in x for x in e['asof']): fail('en/muhan', '자동 숫자 기준일이 영어가 아님: %s' % e['asof'])
                if e['rows'] != 10 or 'Buy and hold' not in e['bt'] or 'Buy &' not in e['bt'] or 'computed' not in e['bt']: fail('en/muhan', '3-6 영어 표 이상 (행 %s)' % e['rows'])
                if 'chapters read' not in e['prog'] or 'Ran out' not in e['sim']: fail('en/muhan', '진행률·3-1 문구가 영어가 아님: %s / %s' % (e['prog'], e['sim']))
            for t in [t for t, u in errs if not ignorable(t, u)][:3]:
                fail('en/muhan', '콘솔 오류: ' + t[:200])
        br.close()
    if httpd:
        httpd.shutdown()
    if not blocked['n']:
        fail('track', '광고·분석 요청 차단 0건 — 차단 목록이 사이트의 실제 주소와 어긋났을 수 있음')
    print('광고·분석 요청 차단 %d건' % blocked['n'])
    print('\n검사 %d개 경로 × %d개 폭 · %.0f초 · 실패 %d건' % (len(paths), len(widths), time.time() - t0, len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
