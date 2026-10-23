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
     · 72루틴 시작일별 연평균 수익률·최대 낙폭 분포(tests/r72dist_test.js — [T72-DIST] R72D 순수 함수 · 카드 계산과 같음 · 문서 숫자 대조 · 나눠 실행)
  6. ETF 차트 비교 — 보기 2가지(시장가·기준가) · 기간(1M·3M·6M·YTD·1Y·MAX·기간설정) 기준일 · MAX = 가장 늦게 상장한 ETF 첫 거래일 ·
     기준 가격(1M~1Y·YTD = 기준일 종가 · MAX·기간설정 = 시작일 시가 · 끝 = 끝날 종가) · 국내 ETF 는 실제 거래 가격(수정주가 역산 아님) ·
     수익률·세금·재투자 수수료·CAGR·연환산·최대 낙폭·변동성 계산 · 표의 기준·끝 가격 · 표 정렬 · 수수료 입력 · 검색 · 최대 10개 · 국내·미국 지수 ·
     원화 환산 · 주소(#e=…) 복원 · 묶음 버튼 · 자료 없음 표시 · 영어판
     (로컬 검사는 Worker /etf 와 국내 분배 이력 묶음을 합성 자료로 대신해 숫자까지 맞춰 봄 — 네이버 수정주가의 반올림·조정 오차까지 넣어 역산하면 틀리게 만듦)
  7. --etf-audit (배포된 사이트 · 매일 Actions) — ETF 차트 비교 화면의 기준·끝 가격을 독립 출처의 실제 가격(네이버 일별 시세 · 야후 일봉)과 맞춰 봄
  8. 투자전략 시뮬레이터 — 계산 기준값(tests/stratsim_test.cjs · 고정 구간) · 라이브러리 써 보기(격리 Worker) · 분석 표 · 공유 링크 복원 ·
     9sig/SMA 과최적화 탐색기(탭·행 수 · '열기' 링크 숫자 일치) · TQQQ 장중 흐름
  9. 관리자 'SMA 200 백테스트'(/sma200/) — 엔진(tests/sma200_test.cjs: 시뮬레이터와 끝 금액 차이 0 · 실전·양도세 독립 검산) ·
     화면(기본값 = 라이브러리 SMA 200 · 접는 설정 묶음 · 그래프 휠 확대 · 화면 숫자 = 엔진 · 표·CSV · '상장 전 포함' · 검증용 자료 = 투자전략 시뮬레이터) · 잠김(관리자 아니면 빈 화면)
 10. 관리자 '72루틴 백테스트'(/72-backtest/) — 설정 = 프로그램 cfg72 · 화면 숫자 = 따로 돌린 MHV(프로그램과 같은 방식) · 표·CSV · 분포 · 상장 전 포함 · 체결 가정

사용법
  pip install playwright && python -m playwright install chromium
  python tests/run_regression.py              # 저장소 루트를 임시 서버로 띄워 검사
  python tests/run_regression.py --base https://d-capitalism.com/   # 배포된 사이트 검사
  python tests/run_regression.py --quick      # 화면 폭 4개만
  python tests/run_regression.py --base https://d-capitalism.com/ --etf-audit   # ETF 차트 비교 실제 가격 점검만
실패가 하나라도 있으면 종료 코드 1
"""
import re, argparse, html, functools, http.server, json, os, shutil, socketserver, subprocess, sys, tempfile, threading, time, urllib.error, urllib.parse, urllib.request

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
  // 실행 기록: 실행만으로는 남지 않고 [📌 실행 기록에 저장]을 누른 것만 (같은 결과는 한 번만)
  const H = () => JSON.parse(localStorage.getItem('mbt-history') || '[]'), sb = () => document.getElementById('mb-save');
  const nA = H().length, sb0 = sb();
  ok('실행해도 실행 기록 자동 저장 안 함 · 저장 단추', nA === 0 && sb0 && !sb0.disabled && /실행 기록에 저장/.test(sb0.textContent), nA + ' ' + (sb0 && sb0.textContent));
  sb0.click(); await W(80); sb() && sb().click(); await W(80);
  ok('저장 단추 → 1건 저장 · 저장됨 표시 · 다시 눌러도 그대로', H().length === nA + 1 && sb().disabled && /저장됨/.test(sb().textContent) && H()[0].S.ver === '2.2' && document.querySelectorAll('#mb-hist .mb-hi').length === nA + 1, H().length + ' ' + sb().textContent);
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
  ok('다시 실행해도 자동 저장 안 함 · 저장 단추 다시 켜짐', H().length === nA + 1 && sb() && !sb().disabled, H().length);
  sb().click(); await W(80);
  ok('두 번째 결과 저장 → 2건 (새 것이 위) · 기록마다 무한매수법 시작 단추', H().length === nA + 2 && H()[0].S.ver === '1.0' && H()[0].tk === 'SOXL' && document.querySelectorAll('#mb-hist [data-hgo]').length === nA + 2, H().map(x => x.S.ver + x.tk).join(','));
  document.querySelector('#mb-hist [data-hdel="0"]').click(); await W(80);
  ok('지금 결과의 기록을 지우면 저장 단추가 다시 켜짐', H().length === nA + 1 && !sb().disabled, H().length);
  document.querySelector('#mb-set [data-ver="3.0"]').click(); await W(50);
  const rb = document.getElementById('mb-rebase');
  ok('V3.0: 손실이 커지면 1회 매수금 다시 정하기 (원문에 없음 표시 · 기본 꺼짐)', rb && !rb.checked && /원문에 없음/.test(rb.parentElement.textContent));
  if (rb) { rb.checked = true; document.querySelector('#mb-set [data-act="run"]').click(); }
  for (let i = 0; i < 120 && !(res() && res().S.ver === '3.0'); i++) await W(250);
  const r3 = res();
  ok('V3.0 다시 정하기 켬 → 계산 설정·주소(rb=1)', r3 && r3.S.ver === '3.0' && r3.S.rebase === true && r3.cfg.rebase === true && /rb=1/.test(location.hash), location.hash);
  ok('실제 자료 기본값: 계산 알림(1주 못 삼·액면 병합·밖에서 낸 세금) 없음', r3 && !r3.net.nob && !r3.net.rs && !r3.net.taxExt && r3.net.rows.every(x => x.cash > -1e-9), r3 && JSON.stringify([r3.net.nob, r3.net.rs, r3.net.taxExt]));
  return R;
}"""

MUHANV_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), $ = q => document.querySelector(q);
  const click = q => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.click(); }, fill = (q, v) => { const e = $(q); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  try {
    ok('설정: 버전 6개 (V1.0~V4.0) · 50~100분할 단추 없음', document.querySelectorAll('[data-act="su-ver"]').length === 6 && !document.querySelector('[data-act="su-splits"][data-v="50"]'));
    ok('새 세션 기본 종목 SOXL (목표 20%)', MH.setup.ticker === 'SOXL' && !MH.setup.custom && MH.setup.target === '20' && $('[data-act="su-ticker"][data-v="SOXL"]').classList.contains('mh-btn-sel'), JSON.stringify([MH.setup.ticker, MH.setup.target]));
    fill('[data-in="su:cap"]', '20000'); fill('[data-in="su:target"]', '75');
    ok('목표 수익률 50% 초과(75%)도 시작하기 켜짐 (백테스트 범위 0.5~100%)', !$('[data-act="su-start"]').disabled, $('[data-in="su:target"]').getAttribute('max'));
    fill('[data-in="su:target"]', '100.5');
    ok('목표 수익률 100% 초과는 시작하기 꺼짐', $('[data-act="su-start"]').disabled);
    fill('[data-in="su:target"]', '20'); fill('[data-in="su:cap"]', '');
    click('[data-act="su-ver"][data-v="2.2"]'); await W(50);
    ok('V2.2 SOXL 기본값 (40분할 · R 12 · 큰수 15)', MH.setup.splits === 40 && MH.setup.target === '12' && MH.setup.big === '15', JSON.stringify(MH.setup));
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
    {  // 카드 그래프: 총자산·그냥 보유 선 · 끝값 = 카드 숫자 · 보기(포함/미포함)를 바꾸면 선도 바뀜 · 수수료 0.25%
      const ln = () => [...document.querySelectorAll('#mh-bt .mh-bt-ch polyline')].map(p => p.getAttribute('points'));
      const r0 = Object.values(MHdebug.bt.cache).filter(x => x && x.st === 'ok' && x.ch)[0], l0 = ln();
      const endOk = r0 && Math.abs(r0.ch[MHdebug.bt.view === 'net' ? 'net' : 'gross'].slice(-1)[0] - (MHdebug.bt.view === 'net' ? r0.net : r0.gross).final) < 1e-6 && r0.ch.d.length === r0.ch.net.length && r0.ch.d[0] === r0.from;
      ok('카드 그래프 (총자산·그냥 보유 2선 · 끝값 = 최종 자산 · 날짜 수 = 자료)', l0.length === 2 && l0.every(p => p.split(' ').length >= 2) && endOk && /수수료 0\\.25%/.test($('#mh-bt').innerText), l0.length + ' ' + endOk);
      const vb = $('#mh-bt [data-act="bt-view"]:not(.mh-btn-sel)'); vb.click(); await W(150); const l1 = ln();
      ok('카드 그래프: 포함/미포함 보기 전환 → 총자산 선 바뀜 · 그냥 보유 그대로', l1.length === 2 && l1[1] !== l0[1] && l1[0] === l0[0]);
      $('#mh-bt [data-act="bt-view"]:not(.mh-btn-sel)').click(); await W(100);
      /* 보기를 바꾼 뒤 카드가 다시 그려질 때까지(바쁜 시험 PC 에선 0.1초가 모자람 — 2026-10-20) 가리키기를 되풀이 · 끝내 값이 안 나오면 아래에서 실패 */
      for (let i = 0; i < 40; i++) { const svg = $('#mh-bt .mh-bt-ch svg'), rc = svg.getBoundingClientRect();
        svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rc.left + rc.width / 2, clientY: rc.top + 20 })); await W(50);
        if (/^\\d{4}-\\d{2}-\\d{2} · \\$/.test($('#mh-bt .mh-bt-hv').textContent)) break; }
      ok('카드 그래프: 가리키면 그날 값', /^\\d{4}-\\d{2}-\\d{2} · \\$/.test($('#mh-bt .mh-bt-hv').textContent) && $('#mh-bt .mh-bt-cur').getAttribute('visibility') === 'visible', $('#mh-bt .mh-bt-hv').textContent);
    }
    {  // ⋮ 메뉴 글자 크기: 끌면 옆 %도 바로 · 화면 확대
      MH.menu = true; MHdebug.render(); const sl = $('.mh-menu [data-in="font"]');
      sl.value = '1.3'; sl.dispatchEvent(new Event('input', { bubbles: true })); await W(30);
      const t1 = $('#mh-font-v').textContent, z1 = document.getElementById('mh-root').style.zoom;
      sl.value = '1.15'; sl.dispatchEvent(new Event('input', { bubbles: true })); await W(30);
      const t2 = $('#mh-font-v').textContent;
      sl.value = '1'; sl.dispatchEvent(new Event('input', { bubbles: true })); await W(30);
      ok('글자 크기: 슬라이더를 옮기면 % 표시가 바로 바뀜 (130% · 115% · 100%)', t1 === '130%' && t2 === '115%' && $('#mh-font-v').textContent === '100%' && z1 === '1.3' && localStorage.getItem('muhan4-fontScale') === '1', [t1, t2, z1].join(' '));
      MH.menu = false; MHdebug.render();
    }
    MH.menu = true; MHdebug.render(); click('.mh-menu [data-act="ses-add"]'); await W(100);
    fill('[data-in="su:spc"]', '25'); fill('[data-in="su:cap"]', '20000'); click('[data-act="su-start"]'); await W(300);
    D = MHdebug.curD();
    ok('V4.0 분할 직접 입력 25 → 비추천 표시 · 주문표', !D.old && D.s.splits === 25 && /비추천/.test($('.mh-top').innerText) && (D.close == null || D.orders.length > 0), D.s.splits);
  } catch (e) { ok('기록 화면 흐름 오류', false, String(e && e.message)); }
  return R;
}"""

# 무한매수법 기록 화면 — 무한매수법 백테스트와 같은 세부 규칙·세금·수수료 (시작 화면·⋮ 메뉴·주문표·RSI 대기·재시작·카드 계산 조건)
MUHANOPT_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), $ = q => document.querySelector(q), $$ = q => [...document.querySelectorAll(q)];
  const click = q => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.click(); }, fill = (q, v) => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  const st = () => MHdebug.store, ses = () => st().sessions.filter(x => x.id === st().activeSessionId)[0];
  const cf0 = window.confirm; window.confirm = () => true;
  try {
    // ① 시작 화면 세부 규칙 — 버전마다 백테스트와 같은 칸
    const has = a => !!$('[data-act="' + a + '"]');
    const kinds = {};
    for (const v of ['1.0', '2.1', '2.2', '3.0', '4.0']) {
      click('[data-act="su-ver"][data-v="' + v + '"]'); await W(40); if (!MH.setup.more) { click('[data-act="su-more"]'); await W(40); }
      kinds[v] = { ao: !!$('[data-in="su:avgOff"]'), money: has('su-money'), restart: has('su-restart'), rebase: has('su-rebase'), ideal: has('su-ideal'), tround: has('su-tround'), nobig: has('su-nobig'), fee: has('su-fee'), tax: has('su-tax'), divs: has('su-divs') };
    }
    const want = { '1.0': [1,1,1,0,1,0,0], '2.1': [1,1,1,0,1,0,0], '2.2': [0,1,1,0,1,1,0], '3.0': [0,0,1,1,1,1,0], '4.0': [0,0,0,0,0,0,1] };
    const badK = Object.keys(want).filter(v => { const k = kinds[v], w = want[v]; return [k.ao, k.money, k.restart, k.rebase, k.ideal, k.tround, k.nobig].map(Number).join() !== w.join() || !k.fee || !k.tax || !k.divs; });
    ok('시작 화면 세부 규칙 칸 = 백테스트와 같음 (평단 괴리율 V1.0~V2.1 · 단리 V1.0~V2.2 · RSI V1.0~V3.0 · 다시 정하기 V3.0 · 정액 V1~V3 · T 반올림 V2.2/V3.0 · 큰수 미사용 V4.0 · 세금·수수료 모두)', badK.length === 0, JSON.stringify(kinds));
    // ② V2.1 + 모든 선택으로 시작 → 세션 설정 · 계산 설정(vcfg) · 카드 조건(btOpts)
    click('[data-act="su-ver"][data-v="2.1"]'); await W(40); if (!MH.setup.more) { click('[data-act="su-more"]'); await W(40); }
    fill('[data-in="su:avgOff"]', '-1.5'); click('[data-act="su-money"][data-v="simple"]'); await W(20); click('[data-act="su-restart"][data-v="rsi"]'); await W(20); click('[data-act="su-ideal"][data-v="1"]'); await W(20);
    click('[data-act="su-fee"][data-v="0.1"]'); await W(20); click('[data-act="su-method"][data-v="avg"]'); await W(20); click('[data-act="su-harv"][data-v="1"]'); await W(20); click('[data-act="su-divs"][data-v="0"]'); await W(20);
    fill('[data-in="su:avgOff"]', '25'); const disA = $('[data-act="su-start"]').disabled; fill('[data-in="su:avgOff"]', '-1.5');
    fill('[data-in="su:cap"]', '20000');
    const sum = ($('.mh-sumore') || {}).innerText || '';
    ok('세부 규칙 요약 (기본값과 다른 것) · 범위 밖 평단 괴리율이면 시작하기 꺼짐', disA && /평단 괴리 −1\\.5%/.test(sum) && /단리/.test(sum) && /RSI 60 이하/.test(sum) && /정액/.test(sum) && /수수료 0\\.1%/.test(sum) && /이동평균/.test(sum) && /연말 절세/.test(sum) && /분배금 끔/.test(sum), sum.slice(0, 200));
    click('[data-act="su-start"]'); await W(300);
    /* 시작한 세션(SOXL)의 시세 받기가 다 끝난 뒤 — 시작 화면에선 시세를 받지 않음 · 주문표(정액) 확인 · 뒤늦은 응답이 ④ 합성 시세를 덮지 않게 */
    for (let i = 0; i < 120 && !(MH.market.SOXL && MH.market.SOXL.prices.length && !MH.loading); i++) await W(250); await W(2500);
    for (let i = 0; i < 40 && MH.loading; i++) await W(250);
    MHdebug.render(); await W(50);
    let s = ses().settings, c = MHdebug.vcfg(s), o = MHdebug.btOpts(s);
    ok('시작 → 세션 설정에 세부 규칙·세금·수수료 저장', s.version === '2.1' && s.avgOff === -1.5 && s.money === 'simple' && s.restart === 'rsi' && s.ideal === true && s.btFee === 0.1 && s.btMethod === 'avg' && s.btHarvest === true && s.btDivs === false && s.btTax !== false && s.cycleNo === 1 && s.base === 20000, JSON.stringify(s));
    ok('계산 설정(vcfg)·카드 조건(btOpts) = 백테스트 cfgOf 와 같은 값', c.avgOff === -1.5 && c.money === 'simple' && c.restart === 'rsi' && c.ideal === true && !c.rebase && o.fee === 0.1 && o.tax && o.method === 'avg' && o.harvest && !o.divs, JSON.stringify([c, o]));
    let D = MHdebug.curD();
    ok('시작한 세션 시세 받음 (주문표 기준 전날 종가)', D.close != null, [!!MH.market.SOXL, MH.loading]);
    if (D.close != null) {
      const fr = D.orders.filter(x => x.tag === 'first')[0];
      ok('정액(소수 주) 주문표 — 처음 매수 = (처음 원금 ÷ 분할) ÷ 주문가 · 하방 LOC 없음 · 설명', fr && Math.abs(fr.quantity - (20000 / 40) / fr.price) < 1e-9 && fr.quantity % 1 !== 0 && D.orders.length === 1 && /정액 주문\\(소수 주\\)/.test(($$('.mh-card').filter(x => /오늘의 주문/.test(x.innerText))[0] || {}).innerText || ''), fr && [fr.quantity, fr.price]);
      click('[data-act="rec-open"]'); await W(200);
      const step = $('[data-in^="vr:"][data-in$=":fq"]'); ok('기록 시트: 정액이면 수량 소수 입력 (step any)', MH.sheet && MH.sheet.ideal && (!step || step.getAttribute('step') === 'any'), step && step.getAttribute('step'));
      MH.sheet = null; MHdebug.render();
    }
    // ③ ⋮ 메뉴 — 같은 선택을 시작한 뒤에도 바꿈
    MH.menu = true; MHdebug.render(); await W(50);
    const mt = ($('.mh-menu') || {}).innerText || '';
    ok('⋮ 메뉴에 세부 규칙·세금·수수료', ['평단 LOC 괴리율', '1회 매수금', '새 사이클 시작', '주문 수량', '백테스트 카드', '양도소득세', '연말 절세', '분배금 받기'].every(k => mt.includes(k)) && !mt.includes('T값 반올림') && !mt.includes('다시 정하기'), mt.slice(0, 120));
    click('.mh-menu [data-act="m-money"][data-v="compound"]'); await W(60); MH.menu = true; MHdebug.render();
    click('.mh-menu [data-act="m-ideal"][data-v="0"]'); await W(60); MH.menu = true; MHdebug.render();
    fill('#mh-m-avgoff', '2'); click('.mh-menu [data-act="ap-avgoff"]'); await W(60); MH.menu = true; MHdebug.render();
    click('.mh-menu [data-act="tg-bttax"]'); await W(60); MH.menu = true; MHdebug.render();
    fill('#mh-m-btfee', '0.33'); click('.mh-menu [data-act="ap-btfee"]'); await W(60); MH.menu = true; MHdebug.render();
    s = ses().settings; o = MHdebug.btOpts(s);
    ok('⋮ 메뉴로 바꾸기 (복리 · 1주 · 평단 괴리 +2% · 양도세 빼기 · 수수료 0.33%)', s.money == null && s.ideal == null && s.avgOff === 2 && o.tax === false && o.fee === 0.33 && !o.harvest && o.method === 'fifo', JSON.stringify(s));
    const a0 = $('.mh-menu a[href*="muhan-backtest/#"]'), href = a0 ? a0.getAttribute('href') : '';
    ok('⋮ 메뉴 \\'이 설정으로 백테스트\\' 주소에 세부 규칙·세금·수수료', /ao=2(&|$)/.test(href) && /r=rsi/.test(href) && !/m=simple/.test(href) && !/id=1/.test(href) && /fe=0\\.33/.test(href) && /tx=0/.test(href) && /dv=0/.test(href), href);
    click('.mh-menu [data-act="m-money"][data-v="simple"]'); await W(60);
    MH.menu = true; MHdebug.render(); fill('#mh-m-cap', '25000'); click('.mh-menu [data-act="ap-cap"]'); await W(60);
    s = ses().settings; let C = MHdebug.vCompute(s, [], null);
    ok('원금 바꾸기(추가 입금) → 단리 기준 처음 원금도 같은 만큼 · 1회 = 처음 원금 ÷ 분할', s.totalCapital === 25000 && s.base === 25000 && Math.abs(C.buyAmount - 25000 / 40) < 0.01, JSON.stringify([s.totalCapital, s.base, C.buyAmount]));
    MH.menu = false; MHdebug.render();
    // ④ 새 사이클 RSI 60 이하 — 첫 사이클은 바로 · 다음 사이클부터 와일더 RSI(14) > 60 이면 대기 (합성 시세로 두 경우 모두)
    const mk0 = MH.market.SOXL;
    const synth = up => { const L = []; let d = new Date(Date.UTC(2026, 0, 2)), x = 50;
      for (let i = 0; i < 120; i++) { while (d.getUTCDay() % 6 === 0) d.setUTCDate(d.getUTCDate() + 1); x = x * (up ? 1.01 : 0.99); L.push({ date: d.toISOString().slice(0, 10), close: Math.round(x * 100) / 100 }); d.setUTCDate(d.getUTCDate() + 1); }
      return { ticker: 'SOXL', long: L, prices: L.slice(-25).map(z => ({ date: z.date, close: z.close, dayHigh: z.close })), quote: null }; };
    const gate = async (up, no) => { MH.market.SOXL = synth(up); ses().settings = Object.assign({}, ses().settings, { cycleNo: no }); ses().transactions = []; MHdebug.render(); await W(60);
      const D2 = MHdebug.curD(); return { wait: !!(D2.gate && D2.gate.wait), first: !!(D2.gate && D2.gate.first), rsi: D2.gate && D2.gate.rsi, rows: D2.orders.length, card: !!$('#mh-rsi-wait'), okc: !!$('#mh-rsi-ok') }; };
    const g1 = await gate(true, 2), g2 = await gate(false, 2), g3 = await gate(true, 1);
    ok('RSI 대기: 2번째 사이클 · RSI 100 → 주문 없음 · 대기 카드', g1.wait && g1.rsi === 100 && g1.rows === 0 && g1.card && !g1.okc, JSON.stringify(g1));
    ok('RSI 대기: 2번째 사이클 · RSI 0 → 첫 매수 · 충족 안내', !g2.wait && g2.rsi === 0 && g2.rows > 0 && !g2.card && g2.okc, JSON.stringify(g2));
    ok('RSI 대기: 첫 사이클은 RSI 100 이어도 바로 시작 (백테스트와 같음)', g3.first && !g3.wait && g3.rows > 0 && !g3.card, JSON.stringify(g3));
    await gate(true, 2); click('[data-act="rec-open"]'); await W(200);
    ok('RSI 대기 중 기록 시트: 주문표 줄 없음 · 안내 · 직접 추가 가능', MH.sheet && MH.sheet.wait && MH.sheet.rows.length === 0 && /RSI 대기/.test(($('.mh-sheet') || document.body).innerText) && !!$('[data-act="vr-xadd"]'), MH.sheet && JSON.stringify([MH.sheet.wait, MH.sheet.rows.length]));
    MH.sheet = null; MH.market.SOXL = mk0; ses().settings = Object.assign({}, ses().settings, { cycleNo: 1 }); MHdebug.render();
    // ⑤ 재시작: 사이클 번호 · V3.0 반복리 완충 바닥 → '다시 정하기' 켬(새 원금) / 끔(경고) · 단리 1회 매수금 그대로
    const endTx = [{ id: 't1', date: '2026-01-05T12:00:00', close: 50, fills: [{ side: 'B', p: 50, q: 100, tag: 'first', m: 'LOC' }] }, { id: 't2', date: '2026-01-06T12:00:00', close: 40, fills: [{ side: 'S', p: 40, q: 100, tag: 'tp', m: 'LMT' }] }];
    const v3 = rb => { ses().settings = { ticker: 'TQQQ', splits: 20, totalCapital: 20000, base: 20000, cum0: 0, max0: 4000, targetProfit: 15, bigNumPercent: 15, lowerLocShares: 1, lowerLocLines: 8, version: '3.0', exhaust: 'official', rebase: rb || undefined, cycleNo: 1 };
      ses().transactions = JSON.parse(JSON.stringify(endTx)); ses().archivedCycles = []; MH.notice = null; MHdebug.render(); };
    v3(true); const ph = MHdebug.curD().st.phase; MHdebug.restart(19000); let s3 = ses().settings, n3 = MH.notice;
    ok('V3.0 다시 정하기 켬: 현금 19,000 < 원금 + 최대 누적 ÷ 2(22,000) → 새 원금 19,000 · 누적 0 · 사이클 2', ph === '종료' && s3.base === 19000 && s3.cum0 === 0 && s3.max0 === 0 && s3.totalCapital === 19000 && s3.cycleNo === 2 && n3 && /다시 정함/.test(n3.title) && ses().archivedCycles.length === 1, JSON.stringify([ph, s3, n3]));
    v3(false); MHdebug.restart(19000); s3 = ses().settings; n3 = MH.notice;
    ok('V3.0 다시 정하기 끔: 원금·최대 누적 그대로(누적 −1,000) · 완충 바닥 경고', s3.base === 20000 && s3.cum0 === -1000 && s3.max0 === 4000 && n3 && n3.warn && /완충/.test(n3.title), JSON.stringify([s3, n3]));
    ses().settings = { ticker: 'TQQQ', splits: 40, totalCapital: 20000, base: 20000, targetProfit: 10, bigNumPercent: 15, partPct: 5, capPct: 5, lowerLocShares: 1, lowerLocLines: 8, version: '2.1', exhaust: 'official', money: 'simple', cycleNo: 1 };
    ses().transactions = JSON.parse(JSON.stringify(endTx)).map(t => Object.assign(t, { fills: t.fills.map(f => Object.assign(f, f.side === 'S' ? { p: 60 } : {})) })); ses().archivedCycles = []; MHdebug.render();
    MHdebug.restart(21000); let s2 = ses().settings; C = MHdebug.vCompute(s2, [], null);
    ok('단리 재시작(복리 원금 21,000): 1회 = 처음 원금 20,000 ÷ 40 그대로 · 사이클 2', s2.totalCapital === 21000 && s2.base === 20000 && Math.abs(C.buyAmount - 500) < 1e-9 && s2.cycleNo === 2, JSON.stringify([s2, C.buyAmount]));
    s2.money = undefined; C = MHdebug.vCompute(s2, [], null);
    ok('복리면 1회 = 지금 원금 21,000 ÷ 40', Math.abs(C.buyAmount - 525) < 1e-9, C.buyAmount);
  } catch (e) { ok('세부 규칙 흐름 오류', false, String(e && e.message)); }
  window.confirm = cf0;
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
  // 1. 처음 화면: 기본 4개 · MAX · 시장가
  const rows = () => [...document.querySelectorAll('#ecx-stats tr')];
  ok('처음: 기본 4개 · MAX(기간 단추도 MAX 만 켜짐) · 시장가(버튼 2개 중 시장가) · 주소', JSON.stringify(keys()) === '["K069500","K360750","USPY","UQQQ"]' && S.per === 'MAX' && [...document.querySelectorAll('#ecx-per .chart-tab.active')].map(b => b.dataset.per).join() === 'MAX' && S.mode === 'px' && location.hash === '#e=K069500,K360750,USPY,UQQQ&p=MAX' && document.querySelectorAll('#ecx-mode button').length === 2 && document.querySelector('#ecx-mode button.on').dataset.m === 'px', [keys(), S.per, S.mode, location.hash]);
  ok('처음: 표 4줄 × 7칸(기간 수익률·CAGR·연환산·최대 낙폭·변동성) · 범례 4 · 차트 선 4(굵기 1)', rows().length === 4 && rows().every(r => r.cells.length === 7 && /%/.test(r.cells[1].textContent)) && document.querySelectorAll('#ecx-head th').length === 7 && document.querySelectorAll('#ecx-leg span').length === 4 && S.chart && S.chart.data.datasets.length === 4 && S.chart.data.datasets.every(d => d.borderWidth === 1), rows().map(r => r.textContent.slice(0, 50)));
  ok('기간설정 날짜 칸은 처음에 숨김 · 재투자 수수료 칸은 시장가에서 숨김', getComputedStyle($('ecx-custom')).display === 'none' && $('ecx-fees').hidden && getComputedStyle($('ecx-fees')).display === 'none', '');
  ok('상장 전 백테스트: 처음부터 켜짐(체크) · 주소에 bt 없음', $('ecx-bt').checked && S.bt === true && !/&bt=/.test(location.hash), [$('ecx-bt').checked, S.bt, location.hash]);
  // 아래는 실제 가격 시나리오(상장일·실제 거래 가격 기준) → 백테스트를 끄고 확인 (백테스트는 따로 BT_JS 에서)
  $('ecx-bt').click(); await W(80); await done();
  ok('백테스트 끄기 → 주소 &bt=0', S.bt === false && /&bt=0/.test(location.hash), location.hash);
  await per('1Y'); await done();   /* 아래 실제 가격 시나리오는 1Y 기준 */
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



def bot_etfcagr_check(fail):
    """시세 수집기(scripts/update_market_data.py) data/etfcagr.json — 무한매수법 백테스트의 TQQQ·SOXL 일봉
    · 종가가 확정되지 않은 오늘 일봉(정규장 끝 + 15분 전 = 장중 값)은 넣지 않음 · 16:15 ET 뒤엔 바로 확정 일봉을 받음
    · 확인할 때 TQQQ 하나만 먼저 받아 보고 같으면 나머지 11종목은 받지 않음 · 한 종목이라도 뒤처졌거나 값이 바뀌면 모두 다시 받음
    (가짜 야후 응답과 바꿔 끼운 시각으로 — 네트워크 안 씀)"""
    import importlib.util, tempfile, contextlib, io, datetime as dt
    F = lambda m: fail('muhan-backtest', '시세 수집기 etfcagr: ' + m)
    spec = importlib.util.spec_from_file_location('umd_check', os.path.join(ROOT, 'scripts', 'update_market_data.py'))
    M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)
    at = lambda y, mo, d, h, mi: dt.datetime(y, mo, d, h, mi, tzinfo=M.NY).timestamp()      # 뉴욕 시각 → 유닉스 초
    days, x = [], dt.date(2025, 9, 1)
    while x <= dt.date(2026, 10, 12):                                                          # 평일 일봉 (마지막 = 10-12 월)
        if x.weekday() < 5:
            days.append(x)
        x += dt.timedelta(days=1)
    reg = {'start': at(2026, 10, 12, 9, 30), 'end': at(2026, 10, 12, 16, 0)}
    st, calls = {'close': 150.0, 'down': ()}, []
    def chart(sym, q):
        calls.append(sym)
        if sym in st['down']:
            raise RuntimeError('야후 오류(시험)')
        ts = [int(dt.datetime(d.year, d.month, d.day, 9, 30, tzinfo=M.NY).timestamp()) for d in days]
        c = [100 + i * 0.1 for i in range(len(days))]; c[-1] = st['close']
        op = [v * 0.995 for v in c]; op[5] = c[5] * 1.5; op[6] = c[6] * 1.012; op[7] = None; op[8] = c[8] * 0.986   # 시가: 범위 밖 0.5% 넘음 → 0 · 조금 위 → 고가로 · 없음 → 0 · 조금 아래 → 저가로
        return {'meta': {'currentTradingPeriod': {'regular': reg}}, 'timestamp': ts,
                'indicators': {'quote': [{'close': c, 'high': [v * 1.01 for v in c], 'low': [v * 0.99 for v in c], 'open': op}]},
                'events': {'dividends': {'a': {'date': ts[-30], 'amount': 0.05}}}}
    M.yahoo_chart = chart
    M.ETFCAGR = os.path.join(tempfile.mkdtemp(), 'etfcagr.json')
    def run(when, close=None, down=()):
        calls.clear(); st['down'] = down
        if close is not None:
            st['close'] = close
        t = at(*when); M.utc_now = lambda: dt.datetime.fromtimestamp(t, dt.timezone.utc).replace(tzinfo=None)
        with contextlib.redirect_stdout(io.StringIO()):
            M.build_etfcagr()
        return json.load(open(M.ETFCAGR, encoding='utf-8'))
    last = lambda s: dt.date.fromordinal(719163 + s['d0'] + sum(s['dd'])).isoformat()
    n = len(M.ETF_CAGR)
    def same(name, ok, info):
        if not ok:
            F('%s — %s' % (name, info))
    j = run((2026, 10, 12, 9, 45))                                   # 처음(파일 없음) · 장중 → 모두 받고 오늘 일봉은 뺌
    same('처음 장중 수집', len(calls) == n and all(last(j['series'][k]) == '2026-10-09' for k in M.ETF_CAGR) and j['series']['TQQQ'].get('h'),
         '받은 %d회 · TQQQ 마지막 %s' % (len(calls), last(j['series']['TQQQ'])))
    run((2026, 10, 12, 13, 0)); same('장중·6시간 안 → 확인 안 함', calls == [], calls)
    j2 = run((2026, 10, 12, 16, 5))                                  # 6시간 지남 · 마감 15분 전(종가 미확정) → TQQQ 만 확인, 그대로
    same('마감 직후(16:05) → TQQQ 하나만 확인·그대로', calls == ['TQQQ'] and j2 == j, calls)
    j = run((2026, 10, 12, 16, 20))                                  # 16:15 뒤 → 확정 일봉 생김 → 모두 받음 (TQQQ 는 한 번만)
    same('16:20 → 확정 일봉 받기', calls == ['TQQQ'] + [k for k in M.ETF_CAGR if k != 'TQQQ'] and all(last(j['series'][k]) == '2026-10-12' for k in M.ETF_CAGR)
         and j['series']['SOXL']['c'][-1] == 150.0, '받은 %s · TQQQ 마지막 %s' % (calls, last(j['series']['TQQQ'])))
    run((2026, 10, 12, 16, 35), close=151.0); same('확정 뒤 15분 → 확인 안 함', calls == [], calls)
    j = run((2026, 10, 12, 22, 30))                                  # 6시간 뒤 → 정정된 종가(151) → 모두 다시 받음
    same('6시간 뒤 정정 반영', len(calls) == n and j['series']['UPRO']['c'][-1] == 151.0, calls)
    j2 = run((2026, 10, 13, 10, 0)); same('다음 날 장중 · 새 일봉 없음 → TQQQ 하나만', calls == ['TQQQ'] and j2 == j, calls)
    run((2026, 10, 17, 17, 0)); same('토요일 · 6시간 안 아님 → TQQQ 하나만', calls == ['TQQQ'], calls)
    j['updated'] = '2026-10-12T19:46:00Z'                                             # 예전 수집기가 장중(15:46)에 넣은 일봉 (모든 종목)
    for k in M.ETF_CAGR:
        j['series'][k]['c'][-1] = 149.0
    json.dump(j, open(M.ETFCAGR, 'w', encoding='utf-8'))
    j = run((2026, 10, 12, 16, 20)); same('장중에 저장된 값 → 16:15 뒤 확정값으로', len(calls) == n and all(j['series'][k]['c'][-1] == 151.0 for k in M.ETF_CAGR), calls)
    j['series']['SOXL'] = dict(j['series']['SOXL'], dd=j['series']['SOXL']['dd'][:-1], c=j['series']['SOXL']['c'][:-1], h=j['series']['SOXL']['h'][:-1], l=j['series']['SOXL']['l'][:-1])
    j['updated'] = '2026-10-12T21:00:00Z'; json.dump(j, open(M.ETFCAGR, 'w', encoding='utf-8'))
    j = run((2026, 10, 13, 4, 0), down=('SPY',))                     # SOXL 하루 뒤처짐 → TQQQ 가 같아도 모두 다시 · SPY 실패는 직전값 유지
    same('뒤처진 종목 → 모두 다시 받기', len(calls) == n and last(j['series']['SOXL']) == '2026-10-12' and last(j['series']['SPY']) == '2026-10-12', calls)
    T = j['series']['TQQQ'] if 'TQQQ' in j['series'] else {}
    want = [round((100 + i * 0.1) * 0.995, 4) for i in range(5)] + [0, round((100 + 6 * 0.1) * 1.01, 4), 0, round((100 + 8 * 0.1) * 0.99, 4), round((100 + 9 * 0.1) * 0.995, 4)]
    same('시가 o (TQQQ·SOXL 만 · 종가와 같은 길이 · 저가~고가 밖 0.5% 넘으면 0 · 조금 벗어나면 안으로 · 없으면 0)',
         T.get('o') is not None and len(T['o']) == len(T['c']) and T['o'][:10] == want and j['series']['SOXL'].get('o') and len(j['series']['SOXL']['o']) == len(j['series']['SOXL']['c'])
         and all('o' not in j['series'][k] for k in M.ETF_CAGR if k not in M.ETFCAGR_HIGH), (T.get('o') or [])[:10])
    del j['series']['SOXL']['o']; j['updated'] = '2026-10-13T08:30:00Z'; json.dump(j, open(M.ETFCAGR, 'w', encoding='utf-8'))
    j = run((2026, 10, 13, 5, 0))                                    # 30분 전 갱신이지만 시가(o)가 없는 예전 형식 → 모두 다시 받아 채움
    same('시가 없는 예전 형식 → 바로 모두 다시 받기', len(calls) == n and j['series']['SOXL'].get('o'), calls)
    ops = M.open_session_start({'meta': {'currentTradingPeriod': {'regular': reg}}}, at(2026, 10, 12, 16, 14)), M.open_session_start({'meta': {'currentTradingPeriod': {'regular': reg}}}, at(2026, 10, 12, 16, 16)), M.open_session_start({}, at(2026, 10, 12, 11, 0))
    same('정규장 끝 + 15분 경계', ops == (reg['start'], None, None), ops)


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


KCMP_SYMS = {'simulator': ('kodex', '498400.KS'), 'sol': ('sol', '0167B0.KS'), 'tiger': ('tiger', '0104N0.KS'),
             'tigerdiv': ('tigerdiv', '472150.KS'), 'tigersemi': ('tigersemi', '0177R0.KS')}


def admin_page(ctx, attach):
    """관리자 전용 화면(자산 속도·72루틴) 검사용 탭 — 시작 스크립트로 window.__dcAdminTest = 1 → [ADMIN] 화면 잠금만 풂 (계정·서버는 건드리지 않음)"""
    pg = ctx.new_page()
    pg.add_init_script('window.__dcAdminTest = 1;')
    attach(pg)
    return pg


def admin_lock_check(page, base, fail, routes):
    """로그인하지 않은 방문자: 관리자 전용 화면은 잠김 안내만 · 시작 함수(자료 받기·계정 동기화)를 부르지 않음 · 홈·허브·하단 사이트맵·sitemap.xml 에 링크 없음"""
    adm = [r for r in routes if r.get('admin')]
    if not adm:
        fail('admin', 'routes.json 에 관리자 전용 화면("admin": true)이 없음'); return
    page.goto(base + 'robots.txt'); page.evaluate("() => { localStorage.removeItem('dc_auth'); }")
    for r in adm:
        page.goto(base + r['path'] + '/', wait_until='load'); page.wait_for_timeout(1200)
        x = page.evaluate("""(id) => { const pg = document.getElementById(id), lk = pg && pg.querySelector(':scope > .adm-lock');
            return { pg: !!pg, lock: !!lk && getComputedStyle(lk).display !== 'none', txt: lk ? lk.innerText : '',
                     vis: pg ? [...pg.children].filter(c => c !== lk && getComputedStyle(c).display !== 'none').length : -1, ok: pg && pg.classList.contains('adm-ok'),
                     as: !!(window.ASPEED && ASPEED.state().ready), t7: (document.getElementById('t7-root') || { innerHTML: '' }).innerHTML.length,
                     s2: (document.getElementById('s2-root') || { innerHTML: '' }).innerHTML.length + (window.S2debug && S2debug.last() ? 1 : 0)
                         + (document.getElementById('tb-root') || { innerHTML: '' }).innerHTML.length + (window.TBdebug && TBdebug.last() ? 1 : 0),
                     robots: (document.querySelector('meta[name=robots]') || {}).content || '' }; }""", 'page-' + r['tab'])
        if not x['pg'] or not x['lock'] or x['vis'] or x['ok'] or '관리자 전용' not in x['txt']:
            fail(r['path'], '관리자 전용 화면이 잠기지 않음: %s' % x)
        if x['as'] or x['t7'] or x['s2']:
            fail(r['path'], '잠긴 화면인데 시작 함수가 돌았음: %s' % x)
        if 'noindex' not in x['robots']:
            fail(r['path'], '관리자 전용 화면에 noindex 없음')
    page.goto(base, wait_until='load'); page.wait_for_timeout(300)
    hrefs = page.evaluate("() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")
    bad = [h for h in hrefs for r in adm if h.rstrip('/').split('/')[-1] == r['path'] and 'learn' not in h]
    if bad:
        fail('', '홈에 관리자 전용 화면 링크: %s' % bad[:3])
    try:
        sm = urllib.request.urlopen(urllib.request.Request(base + 'sitemap.xml', headers={'User-Agent': 'Mozilla/5.0'}), timeout=30).read().decode('utf-8')
        for r in adm:
            if '/' + r['path'] + '/</loc>' in sm:
                fail('sitemap', '관리자 전용 화면이 sitemap.xml 에 있음: ' + r['path'])
    except Exception as e:
        fail('sitemap', 'sitemap.xml 을 읽지 못함: %s' % e)


ADS_TAG = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8051182229751523'
STATIC_PAGES = ('about/', 'terms/', 'privacy/', 'disclaimer/')
AUTOSUM_OF = {'mcap': 'mcap', 'fx': 'fx', 'aptrank': 'apt', 'earn': 'earn'}   # 탭 → [AUTOSUM:키] (자료 화면 자동 요약 · scripts/data_facts.py)
HUB_GUIDE = ('me', 'pay', 'realty', 'capital')                              # 단계 해설 [HUB-GUIDE] 을 넣은 허브(영역)


def social_cfg():
    """routes.json "social" — 하단 공식 SNS 바로가기 [SNS-LINKS] 기준 주소"""
    return json.load(open(os.path.join(ROOT, 'scripts', 'routes.json'), encoding='utf-8')).get('social', [])


def raw_body(raw):
    return re.sub(r'<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->', '', raw, flags=re.S)


def seo_raw_check(path, raw, fail, route):
    """[ADSENSE·SEO] 처음 받은 HTML(스크립트 실행 전 · 검색엔진·애드센스 심사가 보는 그대로)
    · 애드센스 스크립트: 관리자 잠금 화면·routes.json "noads"(회원 게시판)에는 없고 나머지에는 있음
    · robots: 관리자 = noindex, nofollow · "noindex" = noindex, follow · 그 밖에는 없음
    · 제목(h1) 정확히 1개(관리자 잠금 화면 제외) · 공유 이미지(og:image) · 채우지 않은 {{…}} 없음
    · 자료 화면 자동 요약 [AUTOSUM] · 허브 단계 해설 [HUB-GUIDE] 이 비지 않았는지
    route: routes.json 항목(도구 화면) 또는 None(홈·영어판·투자 공부·서재·독립 페이지)"""
    r = route or {}
    adm, noads, noidx = bool(r.get('admin')), bool(r.get('noads')), bool(r.get('noindex'))
    has = ADS_TAG in raw
    if (adm or noads) and has:
        fail(path, '광고를 넣지 않기로 한 화면(관리자 잠금·회원 게시판)에 애드센스 스크립트가 있음')
    if not (adm or noads) and not has:
        fail(path, '애드센스 스크립트 없음')
    m = re.search(r'<meta name="robots" content="([^"]*)">', raw)
    rob, want = (m.group(1) if m else ''), ('noindex, nofollow' if adm else 'noindex, follow' if noidx else '')
    if rob != want:
        fail(path, 'robots %r (기대 %r)' % (rob, want))
    body = raw_body(raw)
    n = len(re.findall(r'<h1\b', body))
    if not adm and n != 1:
        fail(path, '처음 받은 HTML 의 제목(h1) %d개 (기대 1개 — 검색엔진이 보는 제목)' % n)
    if not re.search(r'<meta property="og:image" content="https://[^"]+">', raw):
        fail(path, '공유 미리보기 이미지(og:image) 없음')
    if re.search(r'\{\{[a-zA-Z0-9_.]+\}\}', body):
        fail(path, '채우지 않은 자동 값 {{…}} 이 HTML 에 남음')
    soc = social_cfg()   # [SNS-LINKS] 모든 페이지 하단: routes.json 순서·주소 그대로 · 새 창 · rel=me
    if soc:
        nav = re.findall(r'<nav class="sns-links"[^>]*>(.*?)</nav>', raw, re.S)
        got = re.findall(r'<a href="([^"]+)" target="_blank" rel="noopener me" data-sns="([a-z]+)"', nav[0]) if len(nav) == 1 else []
        if [(x['url'], x['id']) for x in soc] != [(html.unescape(u), i) for u, i in got]:
            fail(path, '하단 SNS 바로가기가 routes.json "social" 과 다름 (줄 %d개 · 링크 %s)' % (len(nav), got))
        objs = []
        def walk(o):
            if isinstance(o, list):
                for x in o: walk(x)
            elif isinstance(o, dict):
                objs.append(o); walk(o.get('@graph', []))
        for x in re.findall(r'<script type="application/ld\+json">(.*?)</script>', raw, re.S):
            try: walk(json.loads(x))
            except ValueError: pass
        ours = [o['publisher'] for o in objs if isinstance(o.get('publisher'), dict) and o['publisher'].get('name') in ('디코딩 자본주의', 'Decoding Capitalism')]
        if any(p_.get('sameAs') != [x['url'] for x in soc] for p_ in ours):
            fail(path, '구조화 데이터(사이트 publisher)의 sameAs 가 공식 SNS 주소와 다름')
    key = AUTOSUM_OF.get(r.get('tab'))
    if key and not path.startswith('en/'):
        b = re.search(r'<!--AUTOSUM:%s-->(.*?)<!--/AUTOSUM-->' % key, raw, re.S)
        t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', b.group(1))) if b else ''
        rows = len(re.findall(r'<tr>', b.group(1))) if b else 0
        if len(t) < 600 or rows < 4 or not re.search(r'\d{4}년 \d{1,2}월 \d{1,2}일', t) or re.search(r'NaN|None|undefined|Infinity', t):
            fail(path, '자동 요약 [AUTOSUM:%s] 이 비었거나 이상함 (글자 %d · 표 %d줄)' % (key, len(t), rows))
    if r.get('hub') and r.get('group') in HUB_GUIDE:
        b = re.search(r'<section class="guide hub-guide"[^>]*>(.*?)</section>', raw, re.S)
        t = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', b.group(1))) if b else ''
        if len(t) < 1200 or (b and b.group(1).count('class="g-faq"') < 4):
            fail(path, '허브 단계 해설 [HUB-GUIDE] 이 없거나 짧음 (%d자)' % len(t))


def static_pages_check(page, base, fail, widths, routes, local):
    """[ADSENSE·SEO] 독립 페이지(소개·약관·개인정보·면책) — 광고·h1·og:image(빌드가 채움) · 넘침 · 소개 페이지 항목·도구 목록(빌드가 채움)
    · 투자 공부 글쓴이 → 소개 #operator · sitemap.xml: 독립 페이지 있음 · noindex 화면(회원 게시판)·관리자 화면 없음"""
    for p in STATIC_PAGES:
        resp = page.goto(base + p, wait_until='load', timeout=60000)
        raw = resp.text() if resp else ''
        if not raw:
            fail(p, '페이지를 열지 못함'); continue
        seo_raw_check(p, raw, fail, None)
        if not re.search(r'<!--OG-->\s*<meta property="og:type"', raw):
            fail(p, '공유 미리보기 블록(<!--OG-->)이 빌드로 채워지지 않음')
        for w in widths:
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(80)
            o = page.evaluate(OVERFLOW_JS)
            if o['sw'] > o['vw'] + 1 or o['out']:
                fail(p, '%dpx 가로 넘침·화면 밖 요소 (문서 %dpx) %s' % (w, o['sw'], o['out'][:3]))
        page.set_viewport_size({'width': 1440, 'height': 900})
        if p == 'about/':
            a = page.evaluate("""() => ({ ids: ['operator', 'areas', 'data', 'method', 'policy', 'ads', 'report'].filter(i => !document.getElementById(i)),
                li: document.querySelectorAll('ul.amap > li').length, links: document.querySelectorAll('ul.amap a[href^="/"]').length,
                rows: document.querySelectorAll('#data ~ .tbl tbody tr').length, txt: document.querySelector('main').innerText.length,
                sug: !!document.querySelector('a[href="/suggest/"]'), cp: document.body.innerText.includes('쿠팡 파트너스') })""")
            if a['ids'] or a['li'] < 8 or a['links'] < 60 or a['rows'] < 8 or a['txt'] < 3500 or not a['sug'] or not a['cp']:
                fail(p, '소개 페이지 항목 이상 (빠진 절·도구 목록·출처 표·광고/제휴 안내): %s' % a)
            want = len([r for r in routes if not r.get('admin') and not r.get('hub')])
            hubs = ['/' + r['path'] + '/' for r in routes if r.get('hub')]
            got = page.evaluate("(hubs) => new Set([...document.querySelectorAll('ul.amap a[href^=\"/\"]')].map(a => a.getAttribute('href')).filter(h => !h.startsWith('/learn/') && h !== '/books/' && !hubs.includes(h))).size", hubs)
            idx = len([r for r in routes if r['tab'] in IDX_KEYS])
            if got + idx != want:
                fail(p, '소개 페이지 도구 목록 %d개 + 지수 %d개 (routes.json 공개 도구 %d개) — 빌드의 [ABOUTMAP] 이 메뉴와 어긋남' % (got, idx, want))
    for p in ('fx/', 'about/', 'learn/', 'books/', 'en/compound/'):   # 하단 SNS 바로가기: 4개 모두 보이고 화면 안 · 휴대폰 폭에서도
        for w in (320, 1440):
            page.set_viewport_size({'width': w, 'height': 900}); page.goto(base + p, wait_until='load'); page.wait_for_timeout(150)
            r = page.evaluate("""() => { const a = [...document.querySelectorAll('.sns-links a')];
                return { n: a.length, vis: a.filter(x => { const b = x.getBoundingClientRect(); return x.offsetParent && b.width > 40 && b.left >= 0 && b.right <= innerWidth; }).length,
                         txt: a.map(x => x.innerText.trim()).join(',') }; }""")
            if r['n'] != len(social_cfg()) or r['vis'] != r['n'] or not all(r['txt'].split(',')):
                fail(p, '%dpx 하단 SNS 바로가기 이상: %s' % (w, r))
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.goto(base + 'learn/', wait_until='load'); page.wait_for_timeout(150)
    if not page.evaluate("() => !!document.querySelector('a[href=\"/about/#operator\"]')"):
        fail('learn/', "글쓴이(운영자) 링크가 소개 페이지 '운영자'(#operator)로 가지 않음")
    try:
        sm = open(os.path.join(ROOT, 'sitemap.xml'), encoding='utf-8').read() if local else http_text(base + 'sitemap.xml')
    except Exception as e:
        fail('sitemap', 'sitemap.xml 을 읽지 못함: %s' % e); return
    for p in STATIC_PAGES:
        if '/' + p + '</loc>' not in sm:
            fail('sitemap', '독립 페이지가 sitemap.xml 에 없음: ' + p)
    for r in routes:
        if (r.get('noindex') or r.get('admin')) and '/' + r['path'] + '/</loc>' in sm:
            fail('sitemap', 'noindex 화면이 sitemap.xml 에 있음: ' + r['path'])


def visit_hit_check(br, fail):
    """[VISIT-HIT] 방문자 수를 네이버 애널리틱스와 같은 페이지·기준으로 세는지 — 실제 도메인 주소를 저장소 파일로 흉내(실사이트·Worker 에 요청하지 않음)
    · 도구 페이지·투자 공부 글: POST /hit {id: 32자리 번호} 한 번 · 다시 열면(같은 날) 안 보냄 · 맨 위 숫자는 그 답으로 그림
    · 번호는 실시간 접속 번호(dc_live_id)와 같음 · 소개 페이지(네이버 스크립트 없음)는 세지 않음"""
    SITE = 'https://d-capitalism.com/'
    EPX = 'https://visit-test.example.workers.dev'
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR')
    ctx.route(TRACK_RE, lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    hits, lives = [], []
    def site(route):
        u = urllib.parse.urlparse(route.request.url).path
        if u == '/data/counter.json':
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'endpoint': EPX}))
        f = os.path.join(ROOT, u.lstrip('/'))
        if u.endswith('/'):
            f = os.path.join(f, 'index.html')
        if not os.path.isfile(f):
            return route.fulfill(status=404, body='')
        ct = 'text/html; charset=utf-8' if f.endswith('.html') else 'application/javascript' if f.endswith('.js') else 'text/css' if f.endswith('.css') else 'application/json' if f.endswith('.json') else None
        route.fulfill(status=200, body=open(f, 'rb').read(), **({'content_type': ct} if ct else {}))
    ctx.route(re.compile(r'^https://d-capitalism\.com/.*'), site)
    def ep(route):
        q = route.request
        body = q.post_data or ''
        if q.url.endswith('/hit'):
            hits.append(body)
        elif q.url.endswith('/live'):
            lives.append(body)
        route.fulfill(status=200, headers={'Access-Control-Allow-Origin': 'https://d-capitalism.com'}, content_type='application/json',
                      body=json.dumps({'day': '2026-10-20', 'today': 7, 'yesterday': 31, 'total': 165, 'max': 33, 'maxDay': '2026-10-14', 'live': 2}))
    ctx.route(re.compile(r'^https://visit-test\.example\.workers\.dev/.*'), ep)
    pg = ctx.new_page()
    pg.goto(SITE + 'fx/', wait_until='load'); pg.wait_for_timeout(1500)
    st = pg.evaluate("() => ({ id: localStorage.getItem('dc_live_id'), day: localStorage.getItem('etfmd-visit-day'), today: (document.getElementById('visit-today') || {}).textContent, total: (document.getElementById('visit-total') || {}).textContent })")
    if len(hits) != 1 or not re.fullmatch(r'\{"id":"[a-f0-9]{32}"\}', hits[0] if hits else '') or json.loads(hits[0])['id'] != st['id']:
        fail('visits', '도구 페이지: /hit 을 브라우저 번호(dc_live_id)로 한 번 보내야 함 — 보낸 것 %s · 번호 %s' % (hits, st['id']))
    if st['today'] != '7' or st['total'] != '165':
        fail('visits', '맨 위 방문자 수가 /hit 답으로 그려지지 않음: %s' % st)
    if not any(st['id'] and st['id'] in x for x in lives):
        fail('visits', '실시간 접속(/live)이 같은 브라우저 번호를 쓰지 않음: %s' % lives[:2])
    n0 = len(hits)
    pg.goto(SITE + 'loan/', wait_until='load'); pg.wait_for_timeout(800)
    pg.goto(SITE + 'learn/compound-interest/', wait_until='load'); pg.wait_for_timeout(800)
    if len(hits) != n0:
        fail('visits', '같은 날 다른 페이지를 열어도 다시 세면 안 됨 (/hit %d번 더)' % (len(hits) - n0))
    pg.evaluate("() => localStorage.removeItem('etfmd-visit-day')")
    pg.goto(SITE + 'learn/compound-interest/', wait_until='load'); pg.wait_for_timeout(1000)
    if len(hits) != n0 + 1:
        fail('visits', '투자 공부 글(네이버 애널리틱스가 있는 페이지)에서도 세야 함: /hit %d번' % (len(hits) - n0))
    pg.evaluate("() => localStorage.removeItem('etfmd-visit-day')")
    n1 = len(hits)
    pg.goto(SITE + 'about/', wait_until='load'); pg.wait_for_timeout(800)
    if len(hits) != n1:
        fail('visits', '소개 페이지(네이버 애널리틱스 없음)에서는 세지 않아야 함')
    ctx.close()


def ssr_h1_check(br, page, base, fail):
    """무한매수법·VR: 처음 HTML 의 제목(h1 · [SSR-H1])이 JS 가 그린 뒤에는 숨고 보이는 h1 은 하나 · JS 를 끄면 그 제목이 보임"""
    for p, root in (('muhan/', 'mh-root'), ('vr/', 'vr-root')):
        page.goto(base + p, wait_until='load'); page.wait_for_timeout(1500)
        r = page.evaluate("""(id) => { const s = document.querySelector('.ssr-h1'), root = document.getElementById(id);
            const vis = [...document.querySelectorAll('h1')].filter(h => { const b = h.getBoundingClientRect(); return h.offsetParent && b.width > 2 && b.height > 2; });
            return { root: root ? root.childElementCount : -1, ssr: s ? getComputedStyle(s).display : 'missing', vis: vis.length, txt: vis.map(h => h.textContent.trim()).join(' | ') }; }""", root)
        if r['root'] < 1 or r['ssr'] != 'none' or r['vis'] != 1:
            fail(p, '그린 뒤 제목(h1): 숨긴 정적 제목 %s · 보이는 h1 %d개(기대 1) · 화면 %d — %s' % (r['ssr'], r['vis'], r['root'], r['txt'][:80]))
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}, locale='ko-KR', java_script_enabled=False)
    ctx.route(TRACK_RE, lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    pg = ctx.new_page()
    for p in ('muhan/', 'vr/'):
        pg.goto(base + p, wait_until='load')
        if not pg.locator('.ssr-h1').is_visible():
            fail(p, '자바스크립트를 끈 화면에서 정적 제목(h1)이 보이지 않음')
    ctx.close()


AS10 = "() => { localStorage.setItem('as.cfg2', JSON.stringify({ sel: ['^KS11', 'SPY', 'APT-seoul', 'APT-gangnam', 'GC=F', 'SI=F', 'BTC-USD', 'ETH-USD', 'M2', 'CPI'] })); }"


def aspeed_check(page, base, fail, local):
    """/asset-speed/ — 처음 기본 = 코스피·S&P 500 + 바로 더하기 단추 · (10개 자산 저장값으로) 거치식 결과 = 그때 샀더라면(WIF.calc)과 같은 값 · 적립식 넣은 돈 · 정한 초 동안 재생 · 검색
    · 배포 사이트에서는 검색한 종목(Worker 일봉)을 실제로 더해 계산되는지까지"""
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'robots.txt'); page.evaluate("() => { localStorage.removeItem('as.cfg2'); localStorage.removeItem('as.bgm'); }")
    page.goto(base + 'asset-speed/', wait_until='load')
    try:
        page.wait_for_function("window.ASPEED && ASPEED.state().sim", timeout=20000)
        d0 = page.evaluate("() => { const s = ASPEED.state().sim; return { sel: ASPEED.state().sel, qa: document.querySelectorAll('#as-qa button').length, bgm: document.getElementById('as-bgm').checked, sec: s.o.sec, months: s.e0 - s.s0 }; }")
        if d0['sel'] != ['^KS11', 'SPY'] or d0['qa'] < 8 or not d0['bgm'] or d0['sec'] != 20 or d0['months'] != 240:   # 그리는 시간 20초 · 시작 20년 전 (사용자 지정 2026-10-20)
            fail('asset-speed', '처음 기본값 이상 (기대: 코스피·S&P 500 · 바로 더하기 · 배경음악 켬 · 20초 · 20년 전): %s' % d0)
    except Exception:
        fail('asset-speed', '시뮬레이터가 계산되지 않음 (처음 기본값)'); return
    page.evaluate(AS10)
    page.goto(base + 'asset-speed/', wait_until='load')
    try:
        page.wait_for_function("window.ASPEED && ASPEED.state().sim", timeout=20000)
    except Exception:
        fail('asset-speed', '시뮬레이터가 계산되지 않음'); return
    r = page.evaluate("""() => { const S = ASPEED.state(), sim = S.sim, W = S.W, bad = [];
        if (sim.err) return { err: sim.err };
        sim.list.forEach(x => { const a = W.assets.find(z => z.id === x.key); if (!a || a.yearly) return;
          const c = WIF.calc(a, W.fx, { start: sim.s0, amount: sim.o.amt, mode: 'lump', div: sim.o.div, krw: true });
          const p = c.pts && c.pts.find(q => q[0] === sim.e0);
          if (!p || Math.abs(p[1] / x.final - 1) > 1e-9) bad.push(x.key + ' ' + x.final + ' vs ' + (p && p[1])); });
        return { n: sim.list.length, keys: sim.list.map(x => x.key), N: sim.N, bad, macro: sim.list.filter(x => x.key === 'M2' || x.key === 'CPI').length,
                 rows: document.querySelectorAll('#as-tbody tr').length, rank: document.querySelectorAll('#as-rank li').length }; }""")
    if r.get('err'): fail('asset-speed', '계산 오류: ' + r['err']); return
    if r['n'] != 10 or r['macro'] != 2: fail('asset-speed', '기본 자산 %d개 (기대 10, M2·물가 %d)' % (r['n'], r['macro']))
    if r['N'] < 24: fail('asset-speed', '비교 기간 %d개월 (너무 짧음)' % r['N'])
    if r['bad']: fail('asset-speed', '거치식 결과가 그때 샀더라면 계산과 다름: %s' % r['bad'][:3])
    if r['rows'] != r['n'] or r['rank'] != r['n']: fail('asset-speed', '결과표 %d줄 · 순위 %d줄 (기대 %d)' % (r['rows'], r['rank'], r['n']))
    d = page.evaluate("""async () => { document.querySelector('#as-mode [data-v="dca"]').click(); await new Promise(r => setTimeout(r, 200));
        const sim = ASPEED.state().sim; return { mode: sim.o.mode, inv: sim.inv[sim.N - 1], want: sim.o.amt * sim.N, err: sim.err }; }""")
    if d['err'] or d['mode'] != 'dca' or abs(d['inv'] - d['want']) > 0.5: fail('asset-speed', '적립식 넣은 돈 이상: %s' % d)
    a = page.evaluate("""async () => { const sec = document.getElementById('as-sec'); sec.value = '2'; sec.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500)); document.getElementById('as-reset').click();
        await new Promise(r => setTimeout(r, 1000)); const mid = ASPEED.state().t;
        await new Promise(r => setTimeout(r, 1700)); const S = ASPEED.state();
        return { mid, end: S.t, playing: S.playing, date: document.getElementById('as-date').textContent }; }""")
    if not (0.25 < a['mid'] < 0.8) or a['end'] != 1 or a['playing']: fail('asset-speed', '2초 재생 진행 이상: %s' % a)
    page.fill('#as-q', '삼성')
    page.wait_for_timeout(1500)
    names = page.evaluate("[...document.querySelectorAll('#as-res button')].map(b => b.innerText)")
    if not any('삼성전자' in n for n in names): fail('asset-speed', '검색 "삼성" 결과에 삼성전자 없음: %s' % names[:5])
    if not local:   # 배포 사이트: 검색 종목을 Worker 에서 받아 더하기 (KODEX 200)
        page.fill('#as-q', '069500'); page.wait_for_timeout(1500)
        page.evaluate("""() => { const box = document.getElementById('as-res'), i = box._items.findIndex(x => x.s === '069500'); if (i >= 0) document.querySelector('#as-res button[data-i="' + i + '"]').click(); }""")
        try:
            page.wait_for_function("ASPEED.state().sim && ASPEED.state().sim.list.some(x => x.key === 'k:069500')", timeout=30000)
        except Exception:
            fail('asset-speed', '검색한 KODEX 200(069500) 시세를 불러와 더하지 못함')
    aspeed2_check(page, base, fail, local)
    page.evaluate("() => { try { localStorage.removeItem('as.cfg2'); } catch (e) {} }")


def aspeed2_check(page, base, fail, local):
    """자산 속도 2차 — 검색 목록 불투명 · 매일 적립(영업일 수 × 금액) · 상장 전 가상 데이터 · 전체보기 · MP4(16:9) 내려받기"""
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'robots.txt'); page.evaluate(AS10)
    page.goto(base + 'asset-speed/', wait_until='load')
    try:
        page.wait_for_function("window.ASPEED && ASPEED.state().sim && !ASPEED.state().sim.err", timeout=30000)
    except Exception:
        fail('asset-speed', '(2차) 시뮬레이터가 계산되지 않음'); return
    page.fill('#as-q', 'QQQ'); page.wait_for_timeout(1200)
    r = page.evaluate("() => { const b = document.getElementById('as-res'), cs = getComputedStyle(b); return { bg: cs.backgroundColor, hidden: b.hidden, n: b.querySelectorAll('button').length }; }")
    if r['hidden'] or not r['n'] or 'rgba' in r['bg'] or r['bg'] == 'transparent':
        fail('asset-speed', '검색 목록이 불투명하지 않거나 보이지 않음: %s' % r)
    page.keyboard.press('Escape'); page.fill('#as-q', '')
    # 매일 적립: 넣은 돈 = 금액 × 영업일 수 · 매달과 연평균이 크게 다르지 않음
    page.click('#as-mode [data-v="dca"]'); page.wait_for_timeout(300)
    mon = page.evaluate("() => { const s = ASPEED.state().sim; return s.err ? {} : Object.fromEntries(s.list.map(x => [x.key, x.cagr])); }")
    if page.evaluate("() => document.getElementById('as-freq-f').hidden"): fail('asset-speed', '적립식인데 적립 주기(매달·매일)가 보이지 않음')
    page.click('#as-freq [data-v="d"]')
    try:
        page.wait_for_function("ASPEED.state().sim && ASPEED.state().sim.o.daily && !ASPEED.state().busy", timeout=120000)
    except Exception:
        fail('asset-speed', '매일 적립 계산이 끝나지 않음'); return
    d = page.evaluate("""() => { const s = ASPEED.state().sim; if (s.err) return { err: s.err };
        let wd = 0; for (let g = s.G0; g <= s.G1; g++) { const w = new Date(g * 864e5).getUTCDay(); if (w > 0 && w < 6) wd++; }
        return { amt: s.o.amt, days: s.days, wd, inv: s.inv[s.N - 1], lost: s.lost, n: s.list.length, cagr: Object.fromEntries(s.list.map(x => [x.key, x.cagr])),
                 lab: document.getElementById('as-amt-l').textContent }; }""")
    if d.get('err'): fail('asset-speed', '매일 적립 오류: ' + d['err'])
    else:
        if d['amt'] != 50000 or '매일' not in d['lab']: fail('asset-speed', '매일 적립 기본 금액·이름 이상: %s' % {k: d[k] for k in ('amt', 'lab')})
        if d['days'] != d['wd'] or abs(d['inv'] - d['amt'] * d['days']) > 1: fail('asset-speed', '매일 적립 넣은 돈 ≠ 금액 × 영업일 수: %s' % {k: d[k] for k in ('amt', 'days', 'wd', 'inv')})
        if d['lost'] or d['n'] != 10: fail('asset-speed', '매일 적립에서 빠진 자산: %s (자산 %d개)' % (d['lost'], d['n']))
        if not local:   # 실제 시세: 매일·매달 적립 연평균 차이가 작아야 (같은 자산·비슷한 기간)
            far = ['%s %.3f/%.3f' % (k, v, mon[k]) for k, v in d['cagr'].items() if v is not None and mon.get(k) is not None and abs(v - mon[k]) > 0.03]
            if far: fail('asset-speed', '매일·매달 적립 연평균 차이가 큼: %s' % far)
    page.click('#as-mode [data-v="lump"]'); page.wait_for_timeout(300)
    # 상장 전 가상 데이터: 비트코인·이더리움·금·은·아파트가 앞으로 이어지고, 실제 구간은 그대로
    page.check('#as-pre')
    try:
        page.wait_for_function("ASPEED.state().sim && ASPEED.state().sim.o.pre && !ASPEED.state().busy", timeout=180000)
    except Exception:
        fail('asset-speed', '상장 전 가상 데이터 계산이 끝나지 않음'); return
    r = page.evaluate("""() => { const out = {};
        ['APT-seoul', 'APT-gangnam', 'GC=F', 'SI=F', 'BTC-USD', 'ETH-USD'].forEach(k => { const a = ASPEED.mseries(k, true, false), b = ASPEED.mseries(k, true, true);
          if (!a || !b) { out[k] = null; return; } const R = b.real - b.start;
          out[k] = { pre: R, same: a.v.length === b.v.length - R && a.v.every((v, i) => v === b.v[R + i]), jump: R > 0 ? b.v[R] / b.v[R - 1] : 1 }; });
        return out; }""")
    for k, v in r.items():
        if not v or v['pre'] < 6 or not v['same'] or not 0.6 < v['jump'] < 1.7:
            fail('asset-speed', '상장 전 가상 데이터 이상 %s: %s' % (k, v))
    page.click('#as-start-q [data-ago="max"]'); page.wait_for_timeout(1500)
    page.wait_for_function("ASPEED.state().sim && !ASPEED.state().busy", timeout=120000)
    r = page.evaluate("() => { const s = ASPEED.state().sim; return { err: s.err, s0: s.s0, pre: s.list.filter(x => x.preTo).length, dash: !!(ASPEED.state().chart && ASPEED.state().chart.data.datasets.some(d => d.segment)) }; }")
    if r['err'] or r['s0'] != 2015 * 12 + 7 or not r['pre'] or not r['dash']:
        fail('asset-speed', "상장 전 포함 '가장 처음부터' 이상 (기대: 이더리움 Coin Metrics 2015.08부터 · 점선): %s" % r)
    page.uncheck('#as-pre'); page.wait_for_timeout(300)
    # 전체보기
    page.click('#as-full'); page.wait_for_timeout(700)
    r = page.evaluate("() => { const ov = document.getElementById('as-ov'), c = document.getElementById('as-chart'); return { ov: !!ov, inside: !!ov && ov.contains(c), h: c.clientHeight }; }")
    if not r['ov'] or not r['inside'] or r['h'] < 300: fail('asset-speed', '전체보기 창 이상: %s' % r)
    page.keyboard.press('Escape'); page.wait_for_timeout(500)
    if page.evaluate("() => !!document.getElementById('as-ov') || !document.getElementById('page-aspeed').contains(document.getElementById('as-chart'))"):
        fail('asset-speed', '전체보기를 닫아도 그래프가 제자리로 돌아오지 않음')
    # 세로 축이 한 장에 크게 튀지 않음 (예전: 눈금 단위로 2억 → 5억) · 긴 이름은 두 줄
    ys = page.evaluate("() => { const vm = ASPEED.videoMaker('h'), M = Math.round(ASPEED.state().sim.o.sec * 30), out = []; for (let i = 0; i <= M + 75; i++) { vm.frame(Math.min(1, i / (M - 1)), i ? 1 / 30 : 0); out.push(vm.ymax()); } vm.done(); return out; }")   # 실제 영상과 같은 장 수
    jm = max(abs(ys[i] / ys[i - 1] - 1) for i in range(1, len(ys)))
    if jm > 0.10: fail('asset-speed', '영상 세로 축이 한 장에 %.1f%% 바뀜 (부드럽게 줄고 늘어야 함 · 미리 보기 0.8초 + 0.35초 완화면 한 장 10%% 안)' % (jm * 100))
    # 영상 가장자리 여백: 16:9 가장자리 5% · 9:16 왼쪽 64·오른쪽 192·위 128·아래 420(유튜브 쇼츠 오른쪽 단추 줄·아래 글) — 그 밖은 배경색뿐
    # · 9:16 날짜·순위 칸은 쇼츠·릴스 UI 가 덮지 않는 가운데 칸(가로 48~888 · 세로 288~1248) 안 · 그래프는 그 아래 · 선 끝 이름은 그래프 칸 안 · 순위는 9:16 도 8줄(5위 이상 늘 보임)
    # · 마지막 장면은 배경음악 출처 줄(긴 출처)까지 넣고 같은 검사
    # · 그래프 선 끝 이름도 5개 이상 · 기간·조건 줄: '과거 수익률은 미래를 보장하지 않음' 이 잘리지 않고 들어감 · 점선 안내는 실제 상장 전 가상 구간이 있을 때만
    for kind in ('h', 'v'):
        r = page.evaluate("""(k) => { const out = []; for (const frac of [0.45, 1]) { const vm = ASPEED.videoMaker(k, frac === 1 ? '♪ Adventures of Flying Jack — Alexander Nakarada (incompetech.com) · CC BY 4.0' : ''), S = vm.safe, W = vm.cv.width, H = vm.cv.height, M = Math.round(ASPEED.state().sim.o.sec * 30), n = Math.round((18 + M + 75) * frac);
              for (let i = 0; i < n; i++) vm.frame(i < 18 ? 0 : Math.min(1, (i - 18) / (M - 1)), i ? 1 / 30 : 0);
              const d = vm.ctx.getImageData(0, 0, W, H).data, bg = vm.bg.match(/[0-9a-f]{2}/gi).map(h => parseInt(h, 16)); let bad = 0;
              for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x >= S.x0 && x < S.x1 && y >= S.y0 && y < S.y1) continue; const o = (y * W + x) * 4; if (d[o] !== bg[0] || d[o + 1] !== bg[1] || d[o + 2] !== bg[2]) bad++; }
              const lb = vm.labels(); out.push({ frac, box: vm.box, bad, lbad: lb.lab.filter(b => b[0] < -0.5 || b[1] > lb.h + 0.5).length, S, n: lb.lab.length, ranks: vm.ranks, assets: ASPEED.state().sim.list.length, meta: vm.meta, pre: ASPEED.state().sim.list.some(x => x.preTo), credit: vm.credit, cpx: vm.creditPx }); vm.done(); } return out; }""", kind)
        for x in r:
            mt = ' / '.join(x['meta'])
            if '과거 수익률은 미래를 보장하지 않음' not in mt or '세금·수수료 제외' not in mt:   # 잘리면(…) 여기서 걸림
                fail('asset-speed', '영상 %s 기간·조건 줄에 경고 문구가 없거나 잘림: %s' % (kind, mt))
            if ('점선 = 상장 전 가상' in mt) != bool(x['pre']):
                fail('asset-speed', '영상 %s 점선 안내가 실제 상장 전 구간 유무(%s)와 다름: %s' % (kind, x['pre'], mt))
            if x['frac'] == 1 and (not x['credit'] or x['cpx'] < 14):   # 배경음악 출처 줄 (긴 출처도 글자 14px 이상으로 여백 안)
                fail('asset-speed', '영상 %s 배경음악 출처 줄 이상: %s %spx' % (kind, x['credit'], x['cpx']))
            if x['ranks'] < min(5, x['assets']):
                fail('asset-speed', '영상 %s 순위가 %d위까지만 보임 (자산 %d개 · 5위 이상 보여야 함)' % (kind, x['ranks'], x['assets']))
            if x['n'] < min(5, x['assets']):
                fail('asset-speed', '영상 %s 그래프 선 끝 이름이 %d개만 보임 (자산 %d개 · 5개 이상 보여야 함)' % (kind, x['n'], x['assets']))
            if kind == 'v':
                b = x['box']; rk, dt, chb = b['rank'], b['date'], b['chart']
                if not (rk['x'] >= 48 and rk['x'] + rk['w'] <= 888 and rk['y'] >= 288 and rk['y'] + rk['h'] <= 1248 and dt['y0'] >= 288 and dt['y1'] <= rk['y']):
                    fail('asset-speed', '영상 9:16 날짜·순위가 쇼츠 UI 에 가릴 수 있는 곳에 있음 (가운데 칸 48~888 × 288~1248 밖): 날짜 %s · 순위 %s' % (dt, rk))
                if not (chb['y'] >= rk['y'] + rk['h'] and chb['x'] + chb['w'] <= 888 and chb['h'] >= 300):
                    fail('asset-speed', '영상 9:16 그래프 칸 이상 (순위 아래 · 오른쪽 888 안 · 높이 300 이상): %s' % chb)
            if x['bad'] or x['lbad']:
                fail('asset-speed', '영상 %s 안전 여백 이상 (장면 %d%%): 안전 영역 밖 그림 %d점 · 칸 밖 이름 %d개 · 안전 영역 %s' % (kind, x['frac'] * 100, x['bad'], x['lbad'], x['S']))
        sf = r[0]['S']
        want = {'h': (96, 60, 1824, 1020), 'v': (64, 128, 888, 1500)}[kind]
        if (sf['x0'], sf['y0'], sf['x1'], sf['y1']) != want:
            fail('asset-speed', '영상 %s 안전 영역이 바뀜: %s (기대 %s)' % (kind, sf, want))
    # MP4 16:9 (2초 · 이 브라우저에 H.264 인코더가 없으면 내장 인코더) — 파일이 H.264 MP4 이고 프레임 수가 맞는지
    page.evaluate("() => { const s = document.getElementById('as-sec'); s.value = '2'; s.dispatchEvent(new Event('input', { bubbles: true })); }"); page.wait_for_timeout(600)
    try:
        with page.expect_download(timeout=300000) as dl:
            page.click('#as-vid-h')
        path = dl.value.path(); data = open(path, 'rb').read()
        info = page.evaluate("() => ASPEED.state().vlast")
        want = int(round(30 * 0.6)) + 60 + int(round(30 * 2.5))
        if not info or (b'Opus' not in data and b'mp4a' not in data) or info.get('audio') not in ('aac', 'opus'):
            fail('asset-speed', 'MP4 에 배경음악(AAC·Opus) 없음: %s' % (info and info.get('audio')))
        if data[4:8] != b'ftyp' or b'avc1' not in data or not info or info.get('frames') != want or len(data) < 50000:
            fail('asset-speed', 'MP4 16:9 이상: %d바이트 · ftyp=%s · avc1=%s · %s (기대 프레임 %d)' % (len(data), data[4:8], b'avc1' in data, info and {k: info.get(k) for k in ('frames', 'how', 'codec')}, want))
        if not dl.value.suggested_filename.endswith('1920x1080_' + dl.value.suggested_filename[-12:-4] + '.mp4'):
            fail('asset-speed', 'MP4 파일 이름 이상: ' + dl.value.suggested_filename)
    except Exception as e:
        fail('asset-speed', 'MP4 16:9 내려받기 실패: %s' % str(e)[:160])
    # 배경음악(assets/bgm · scripts/fetch_bgm.py): 무료 곡 목록(CC0·CC BY 4.0 · 출처 문구 · 파일) · 곡 처음부터 그대로(편집 없음) · 끝 1.2초만 줄임
    #  · 영상에 쓴 곡 = 출처 줄 · 다음 영상은 다른 곡 · 물가 선은 흰색(밝은 테마는 거의 검정)
    try:
        r = page.evaluate("""async () => { const B = ASPEED.bgm, L = await B.load(), bad = [];
            for (const t of L) {
              if (!['CC0', 'CC BY 4.0'].includes(t.lic) || !t.credit || t.credit.indexOf(t.t) < 0 || (t.lic !== 'CC0' && t.credit.indexOf('Creative Commons') < 0)) bad.push('라이선스·출처 ' + t.id);
              const st = await new Promise(res => { const q = new XMLHttpRequest(); q.open('HEAD', 'assets/bgm/' + t.f); q.onload = () => res([q.status, +q.getResponseHeader('content-length')]); q.onerror = () => res([0, 0]); q.send(); });
              if (st[0] !== 200 || !(st[1] > 100000)) bad.push('파일 ' + t.f + ' ' + st); }
            const t = L.find(x => x.d >= 30 && x.full <= 1), D = 12.1, SR = 48000, src = await B.decode(t), out = await B.render(t, D), a = src.getChannelData(0), b = out.getChannelData(0);
            let diff = 0, tail = 0, mid = 0;
            for (let i = Math.round(0.05 * SR); i < Math.round((D - 1.3) * SR); i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
            for (let i = b.length - Math.round(0.01 * SR); i < b.length; i++) tail = Math.max(tail, Math.abs(b[i]));
            for (let i = SR; i < 3 * SR; i++) mid = Math.max(mid, Math.abs(b[i]));
            const v = ASPEED.state().vlast || {}, ds = ASPEED.state().chart.data.datasets.find(d => d.label === '물가');
            return { n: L.length, bad, id: t.id, diff, tail, mid, len: out.length / SR, used: v.bgm && v.bgm.id, usedT: v.bgm && v.bgm.t, credit: v.credit, next: B.next() && B.next().id,
                     cpi: ds && ds.borderColor, light: document.documentElement.getAttribute('data-theme') === 'light' }; }""")
        if r['n'] < 30 or r['bad']: fail('asset-speed', '배경음악 목록 이상: %d곡 · %s' % (r['n'], r['bad'][:5]))
        if r['diff'] > 1e-6 or abs(r['len'] - 12.1) > 1 / 48000 or r['tail'] > r['mid'] * 0.02 + 1e-4 or r['mid'] < 0.05:
            fail('asset-speed', '배경음악이 곡 처음부터 그대로가 아니거나 끝이 줄지 않음: %s' % {k: r[k] for k in ('id', 'diff', 'len', 'tail', 'mid')})
        if not r['used'] or not r['credit'] or r['usedT'] not in r['credit'] or r['next'] == r['used']:
            fail('asset-speed', '영상 배경음악 기록 이상 (쓴 곡·출처 줄·다음 곡): %s' % {k: r[k] for k in ('used', 'credit', 'next')})
        if r['cpi'] != ('#191f28' if r['light'] else '#ffffff'):
            fail('asset-speed', '물가 선 색이 흰색(밝은 테마는 #191f28)이 아님: %s' % r['cpi'])
    except Exception as e:
        fail('asset-speed', '배경음악 검사 실패: %s' % str(e)[:160])
    sns_ui_check(page, fail)


S2_INDEP_JS = """([mode, fee, tax, itax, lag]) => { const L = S2debug.last(), D = L.D, cap = S2debug.S().cap;
    const o = { from: L.from, to: L.to, capital: cap, mode, fee: fee / 100, sec: mode === 'real' ? 0.0000206 : 0, divTax: mode === 'real' ? 0.15 : 0, intTax: itax ? 0.154 : 0,
                tax: tax === 'none' ? null : { fx: i => D.fx[i], method: tax }, rows: true, lag: lag };
    const R = SMB.run(D, S2debug.S().p, o), st = SMB.stats(R), h = SMB.bh(D, R.K.ul, L.from, L.to, cap, o);
    const kv = {}; document.querySelectorAll('#s2-kv > div').forEach(e => { const s = e.querySelectorAll('small'); kv[s[0].innerText] = { b: e.querySelector('b').innerText, sub: s[1] ? s[1].innerText : '' }; });
    const usd = x => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(2) + '%';
    const exp = { '최종 평가금': usd(R.final), '기간 총 수익률': pct(R.final / cap - 1), '연평균(CAGR)': pct(st.cagr), '최대 낙폭(MDD)': pct(st.mdd), '끝날 전부 팔면': usd(R.liq),
                  [{ tqqq: 'TQQQ', qqq: 'QQQ', spy: 'SPY', qld: 'QLD', sso: 'SSO', spxl: 'SPXL', sqqq: 'SQQQ' }[R.K.ul] + ' 그냥 보유']: pct(h.cagr), '낸 수수료·세금': usd(R.fees + R.taxPaid) };
    if (tax !== 'none') exp['아직 안 낸 양도세'] = usd(R.taxDue);
    const diff = Object.keys(exp).filter(k => !kv[k] || kv[k].b !== exp[k]).map(k => [k, kv[k] && kv[k].b, exp[k]]);
    const same = L.R.final === R.final && L.R.liq === R.liq && L.R.eq.length === R.eq.length && L.R.eq.every((v, i) => v === R.eq[i]);
    const nB = R.rows.filter(r => r.b.length).length, sub = kv['보유 기간'] ? kv['보유 기간'].sub : '';
    return { diff, same, cnt: sub.indexOf('매수 ' + nB + '일 · 전량 매도 ' + R.nSell + '번') >= 0, fin: R.final, from: D.d[L.from], to: D.d[L.to], n: R.eq.length, mdd: st.mdd }; }"""

S2_SIM_JS = r"""/* 투자전략 시뮬레이터 엔진(scripts/stratsim_fit.cjs)으로 SMA 200 프리셋 — 끝 금액·최대 낙폭 */
const F = require(process.argv[1]), M = F.M, [ed, xd, cap, pj] = process.argv.slice(2), p = JSON.parse(pj), cp = M.ssCleanParams('sma', p);
const r = M.ssRunSma(Object.assign({ initial: +cap, monthly: 0, raise: 0, rate: M.ssRate9(cp), dd: true, ed, xd }, M.ssOptsSma(cp)));
console.log(JSON.stringify({ fin: r.points[r.points.length - 1].value, mdd: -M.ssDailyDDMulti(r.dd).pct, first: r.points[0].date, last: r.points[r.points.length - 1].date, n: r.dd.length }));"""


def sma200_check(page, base, fail, local):
    """/sma200/ 관리자 'SMA 200 백테스트' — 처음 기본값 = 시뮬레이터 라이브러리 SMA 200 프리셋 + 팔았을 때 SPY · 이자 0%(2026-10-22) · 실전(실제 일봉·1주 단위·수수료 0.25%·선입선출 양도세·이자세)
    · 화면 9칸 = 따로 돌린 엔진(SMB) · 그래프·표(연도별·보유 구간별·일자별 쪽 넘김)·CSV · 조건 바꿔 다시 계산 = 엔진 · 빈 칸 → 기본값
    · 설정은 접는 묶음 6개(처음엔 모두 접힘 · 모두 펼치기) · 그래프 휠 확대(chartjs-plugin-zoom) · 단추는 계산·기본값 (실전)만('상장 전 포함' 단추는 뺌 — 자료 칸에서 고르면 같은 조건 + 상장 전 재현)
    · 맨 아래 규칙 설명서(기본 설정 기준 · 양도세 5월 1일) · 예전 기본값(현금 · 4%) 그대로였던 저장값은 한 번 새 기본값으로 · 직접 바꾼 값은 그대로
    · 자료 칸 '검증용' = 투자전략 시뮬레이터 SMA 200 끝 금액·최대 낙폭(로컬: 저장소 자료로 Node 시뮬레이터 엔진과 대조)
    (엔진 자체의 시뮬레이터 대조 수천 번·세금 독립 검산은 tests/sma200_test.cjs)"""
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'robots.txt'); page.evaluate("() => { ['s2-set', 's2-scale', 's2-open'].forEach(k => localStorage.removeItem(k)); }")
    page.goto(base + 'sma200/', wait_until='load')
    ready = "() => window.S2debug && S2debug.last() && S2debug.last() !== window.__s2p && document.querySelector('#s2-kv')"
    def wait_new():
        page.wait_for_function(ready, timeout=60000); page.evaluate("() => { window.__s2p = S2debug.last(); }"); page.wait_for_timeout(100)
    try:
        wait_new()
    except Exception:
        fail('sma200', 'SMA 200 백테스트 결과가 나오지 않음 (60초)'); return
    try:
        d = page.evaluate("""() => { const S = S2debug.S(), ui = {}; document.querySelectorAll('#s2-root select[data-k]').forEach(e => ui[e.dataset.k] = e.value);
            const pre = Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0' }); delete pre.cost;
            return { ok: JSON.stringify(Object.keys(ui).sort().map(k => [k, ui[k]])) === JSON.stringify(Object.keys(pre).sort().map(k => [k, pre[k]])),
                     v: [document.getElementById('s2-cap').value, document.getElementById('s2-mode').value, document.getElementById('s2-fee').value, document.getElementById('s2-tax').value, document.getElementById('s2-itax').value,
                         [...document.querySelectorAll('#s2-per button.on')].map(b => b.dataset.p).join()] }; }""")
        if not d['ok'] or d['v'] != ['100000', 'real', '0.25', 'fifo', 'on', 'all']:
            fail('sma200', '처음 기본값 이상 (기대: 라이브러리 SMA 200 조건 + 팔았을 때 SPY · 이자 0% · 원금 100000 · 실전 · 0.25% · 선입선출 · 이자세 · 전체): %s' % d)
        u = page.evaluate("""() => ({ secs: [...document.querySelectorAll('#s2-set details.s2-sec')].map(x => x.dataset.sec + (x.open ? '+' : '')).join(),
            btn: [...document.querySelectorAll('#s2-set .s2-btn')].map(x => x.innerText).join('|'), modes: [...document.querySelectorAll('#s2-mode option')].map(o => o.value).join() })""")
        if u != {'secs': 'sig,rsi,out,ease,bub,cost', 'btn': '계산|기본값 (실전)', 'modes': 'real,pre,sim'}:
            fail('sma200', '설정 묶음·단추·자료 칸 이상 (기대: 접힌 묶음 6개 · 계산|기본값 (실전) · real,pre,sim): %s' % u)
        # 맨 아래 규칙 설명서 — 기본 설정과 같은 값 · 양도세 5월 1일
        g = page.evaluate("() => { const e = document.getElementById('g-sma200'); if (!e) return null; const r = e.getBoundingClientRect(), x = document.getElementById('s2-root').getBoundingClientRect(); return { t: e.innerText, below: r.top >= x.bottom - 1, vis: r.height > 200 }; }")
        need = ['SMA 200 백테스트 규칙 설명서', '$100,000', '2010년 11월 24일', 'QQQ 200일 이동평균', '9일 RSI 90 이상', '7일 RSI 80 미만', 'SPY · 현금 이자 연 0%', '15거래일', '40% 이상', '0.25%', '5월 1일', '250만 원']
        if not g or not g['below'] or not g['vis'] or [w for w in need if w not in g['t']]:
            fail('sma200', '규칙 설명서가 없거나 화면 아래가 아니거나 기본 설정 값이 빠짐: %s' % (g and {'below': g['below'], 'vis': g['vis'], 'miss': [w for w in need if w not in g['t']]}))
        page.click('#s2-set [data-secall="1"]'); page.wait_for_timeout(100)   # 아래에서 조건을 바꾸려고 모두 펼침
        page.wait_for_function("() => window.Chart && Chart.getChart('s2-c')", timeout=30000)
        z = page.evaluate("() => { const c = Chart.getChart('s2-c'); return !!(window.ChartZoom && c.options.plugins.zoom && c.options.plugins.zoom.zoom.wheel.enabled && c.options.plugins.zoom.pan.enabled); }")
        if not z: fail('sma200', '그래프 휠 확대(chartjs-plugin-zoom)가 켜지지 않음 — assets/vendor 를 받지 못했거나 설정이 빠짐')
        r = page.evaluate(S2_INDEP_JS, ['real', 0.25, 'fifo', True, 0])
        if r['diff'] or not r['same'] or not r['cnt']:
            fail('sma200', '실전 기본 결과가 따로 돌린 엔진과 다름: %s' % {k: r[k] for k in ('diff', 'same', 'cnt', 'from', 'to')})
        fin0 = r['fin']
        c = page.evaluate("""() => { const ch = Chart.getChart('s2-c'), R = S2debug.last().R; return ch ? [ch.data.labels.length === R.eq.length, ch.data.datasets[4].data.filter(v => v != null).length === R.rows.filter(r => r.b.length).length,
            ch.data.datasets[5].data.filter(v => v != null).length === R.nSell] : null; }""")
        if not c or not all(c): fail('sma200', '그래프 점 수·매수·매도 표시가 엔진과 다름: %s' % c)
        # 표: 연도별(마지막 연말 = 최종) · 보유 구간별(구간 수) · 일자별(50줄 · 2쪽 첫날 · 마지막 쪽 총자산 = 최종)
        t = page.evaluate("""() => { const L = S2debug.last(), R = L.R, D = L.D, usd = x => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const out = {}; let tr = [...document.querySelectorAll('#s2-tb tbody tr')];
            out.year = tr.length === new Set(R.rows.map(r => D.d[r.i].slice(0, 4))).size && tr[tr.length - 1].children[1].innerText === usd(R.final);
            document.querySelector('#s2-tab button[data-v=per]').click(); tr = [...document.querySelectorAll('#s2-tb tbody tr')]; out.per = tr.length === R.periods.length;
            let pl = 0; R.periods.forEach(p => { pl += (p.open ? p.net + p.val : p.net) - p.spend; }); out.perSum = Math.abs(R.final - R.cap - (pl + R.divs + R.intr - R.taxPaid)) < 1e-6 * R.final;
            document.querySelector('#s2-tab button[data-v=day]').click(); tr = [...document.querySelectorAll('#s2-day tbody tr')]; out.day1 = tr.length === Math.min(50, R.rows.length) && tr[0].children[0].innerText === D.d[R.rows[0].i];
            const nx = document.querySelector('#s2-tb .s2-pager .dv-pg[data-pg="2"]'); if (nx) { nx.click(); out.day2 = document.querySelector('#s2-day tbody tr').children[0].innerText === D.d[R.rows[50].i]; }
            const lp = Math.ceil(R.rows.length / 50), lb = document.querySelector('#s2-tb .s2-pager .dv-pg[data-pg="' + lp + '"]'); if (lb) lb.click();
            tr = [...document.querySelectorAll('#s2-day tbody tr')]; out.dayEnd = tr[tr.length - 1].children[0].innerText === D.d[L.to] && tr[tr.length - 1].children[12].innerText === usd(R.final);
            out.bad = [...document.querySelectorAll('#s2-root td, #s2-kv b')].map(e => e.innerText).filter(x => /undefined|NaN|Infinity/.test(x)).slice(0, 3);
            document.querySelector('#s2-tab button[data-v=year]').click(); return out; }""")
        if not all(t[k] for k in ('year', 'per', 'perSum', 'day1', 'dayEnd')) or t.get('day2') is False or t['bad']:
            fail('sma200', '표(연도별·보유 구간별·일자별) 이상: %s' % t)
        with page.expect_download(timeout=15000) as dl:
            page.click('#s2-csv')
        raw = open(dl.value.path(), 'rb').read().decode('utf-8')
        lines = raw.lstrip('﻿').split('\r\n')
        cv = page.evaluate("() => { const L = S2debug.last(); return [L.R.rows.length, L.R.final.toFixed(2)]; }")
        if not raw.startswith('﻿') or len(lines) != cv[0] + 1 or not lines[-1].endswith(',' + cv[1]) or re.search(r'undefined|NaN', raw):
            fail('sma200', 'CSV 이상: %d줄(기대 %d) · 끝 %s' % (len(lines), cv[0] + 1, lines[-1][-30:]))
        # 조건 바꿔 다시 계산 (빈 수수료 칸 → 0.25 · 대기 종목 QQQ · 150일 · 이동평균 · 이자세 끔)
        page.select_option('#s2-k-win', '150'); page.select_option('#s2-k-out', 'qqq'); page.select_option('#s2-k-cs', '2')
        page.select_option('#s2-tax', 'avg'); page.select_option('#s2-itax', 'off'); page.fill('#s2-fee', '')
        page.click('#s2-run'); wait_new()
        r = page.evaluate(S2_INDEP_JS, ['real', 0.25, 'avg', False, 0])
        q = page.evaluate("() => [document.getElementById('s2-fee').value, S2debug.S().p.win, S2debug.S().p.out, S2debug.last().R.K.out]")
        if r['diff'] or not r['same'] or q != ['0.25', '150', 'qqq', 'qqq']:
            fail('sma200', '조건을 바꾼 결과가 엔진과 다름: %s · %s' % ({k: r[k] for k in ('diff', 'same')}, q))
        # 신호 → 체결 '다음 거래일 종가'(하루 늦게): 바꾸면 바로 다시 계산 · 시작 가능일 하루 뒤 · 결과 = 엔진(lag 1)
        fv0 = page.evaluate("() => S2debug.last().fv")
        page.select_option('#s2-lag', '1'); wait_new()
        r = page.evaluate(S2_INDEP_JS, ['real', 0.25, 'avg', False, 1])
        q = page.evaluate("() => [S2debug.S().lag, S2debug.last().o.lag, S2debug.last().fv, [...document.querySelectorAll('#s2-tb thead th, #s2-day thead th')].map(t => t.innerText).join('|')]")
        if r['diff'] or not r['same'] or q[0] != 1 or q[1] != 1 or q[2] != fv0 + 1:
            fail('sma200', "'하루 늦게' 결과가 엔진(lag 1)과 다르거나 시작 가능일이 하루 뒤가 아님: %s · %s" % ({k: r[k] for k in ('diff', 'same')}, q[:3]))
        page.select_option('#s2-lag', '0'); wait_new()
        # 상장 전 포함 — 단추는 뺐고(2026-10-22) 자료 칸에서 고름: 기본값 뒤 자료 칸만 바꾸면 기본값과 같은 조건 · 자료만 상장 전 재현 + 실제 일봉 (로컬은 Worker 대신 합성 자료라 시작일만 확인)
        page.click('#s2-def'); wait_new()
        page.select_option('#s2-mode', 'pre'); page.wait_for_function(ready, timeout=120000); page.evaluate("() => { window.__s2p = S2debug.last(); }"); page.wait_for_timeout(100)
        q = page.evaluate("() => { const L = S2debug.last(), S = S2debug.S(); return { mode: S.mode, fee: S.fee, tax: S.tax, itax: S.itax, lag: S.lag, same: JSON.stringify(S.p) === JSON.stringify(Object.assign({}, SMB.PRESET, { out: 'spy', cr: '0' })), from: L.D.d[L.from], noPre: L.D.noPre }; }")
        if q['mode'] != 'pre' or q['fee'] != 0.25 or q['tax'] != 'fifo' or q['itax'] != 'on' or q['lag'] != 0 or not q['same'] or (not local and (q['noPre'] or q['from'] >= '2000-01-01')):
            fail('sma200', "자료 칸 '상장 전 포함' 이상 (기대: 기본값과 같은 조건 · 상장 전 재현으로 2000년 전 시작): %s" % q)
        page.click('#s2-def'); wait_new()
        # 검증용 자료(투자전략 시뮬레이터 자료 · 소수 주) + 수수료 0.02% · 세금 없음 = 투자전략 시뮬레이터
        page.select_option('#s2-mode', 'sim'); wait_new()
        page.fill('#s2-fee', '0.02'); page.select_option('#s2-tax', 'none'); page.select_option('#s2-itax', 'off'); page.click('#s2-run'); wait_new()
        q = page.evaluate("""() => { const L = S2debug.last(), S = S2debug.S(); return { from: L.D.d[L.from], to: L.D.d[L.to], fin: L.R.final, mdd: L.st.mdd, n: L.R.eq.length, p: S.p,
            ui: [S.mode, S.fee, S.tax, S.itax, [...document.querySelectorAll('#s2-k-ul option')].some(o => o.value === 'sqqq' && o.disabled)] }; }""")
        if q['ui'] != ['sim', 0.02, 'none', 'off', False]:
            fail('sma200', "검증용 자료 설정 이상 (기대: 시뮬 방식 · 0.02% · 세금 미포함 · SQQQ 선택 가능): %s" % q['ui'])
        if local and shutil.which('node'):
            pr = subprocess.run(['node', '-e', S2_SIM_JS, os.path.join(ROOT, 'scripts', 'stratsim_fit.cjs'), q['from'], q['to'], '100000', json.dumps(q['p'])], capture_output=True, text=True, timeout=120)
            try:
                sm = json.loads(pr.stdout.strip().splitlines()[-1])
                if sm['first'] != q['from'] or sm['last'] != q['to'] or sm['n'] != q['n'] or abs(sm['fin'] - q['fin']) > 1e-9 * sm['fin'] or abs(sm['mdd'] - q['mdd']) > 1e-12:
                    fail('sma200', "검증용 자료 결과가 투자전략 시뮬레이터와 다름: 화면 %s · 시뮬레이터 %s" % ({k: q[k] for k in ('from', 'to', 'fin', 'mdd')}, sm))
            except Exception as e:
                fail('sma200', '시뮬레이터 엔진 대조 실패: %s %s' % (e, (pr.stderr or pr.stdout)[-200:]))
        # 기본값 (실전) 단추 → 처음 결과
        page.click('#s2-def'); wait_new()
        if abs(page.evaluate("() => S2debug.last().R.final") - fin0) > 1e-9:
            fail('sma200', "'기본값 (실전)' 단추 뒤 결과가 처음과 다름")
        # 분포 상자(표본 단계부터 숫자) · 좁은 화면 넘침
        page.wait_for_function("() => document.querySelectorAll('#s2-dbox .r7d-k').length >= 6", timeout=60000)
        bx = page.evaluate("() => { const b = document.getElementById('s2-dbox'); return /undefined|NaN/.test(b.innerText) ? b.innerText.slice(0, 200) : ''; }")
        if bx: fail('sma200', '시작일별 분포 상자에 이상한 값: %s' % bx)
        for w in (360, 768):
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(250)
            ov = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if ov > 0: fail('sma200', '%dpx 에서 가로 넘침 %dpx' % (w, ov))
        page.set_viewport_size({'width': 1280, 'height': 900})
        # 예전 저장값: 예전 기본값(현금 · 4% · 판 표시 없음) 그대로였으면 한 번 새 기본값(SPY · 0%) · 직접 바꾼 값(QQQ · 2%)은 그대로 · 새 판(v 2)에 저장된 현금 · 4%도 그대로
        mig = []
        for old, want in (({'sig': 'qqq', 'out': 'cash', 'cr': '4', 'win': '150'}, ['spy', '0', '150']), ({'out': 'qqq', 'cr': '2'}, ['qqq', '2', '200']), ({'v': 2, 'out': 'cash', 'cr': '4'}, ['cash', '4', '200'])):
            v = old.pop('v', None); j = {'mode': 'real', 'p': old}
            if v: j['v'] = v
            page.evaluate("(j) => localStorage.setItem('s2-set', JSON.stringify(j))", j)
            page.goto(base + 'sma200/', wait_until='load')
            page.wait_for_function(ready, timeout=60000); page.evaluate("() => { window.__s2p = S2debug.last(); }")
            got = page.evaluate("() => { const S = S2debug.S(); return [S.p.out, S.p.cr, S.p.win, S.v, JSON.parse(localStorage.getItem('s2-set')).v]; }")
            if got[:3] != want or got[3] != 2 or got[4] != 2: mig.append([j, got])
        if mig: fail('sma200', '예전 저장값 옮기기 이상 (기대: 예전 기본값만 SPY · 0% · 저장값 판 2): %s' % mig)
        page.evaluate("() => { ['s2-set', 's2-scale', 's2-open'].forEach(k => localStorage.removeItem(k)); }")
    except Exception as e:
        fail('sma200', 'SMA 200 백테스트 검사 실패: %s' % str(e)[:200])


T72BT_INDEP_JS = """() => { const L = TBdebug.last(), S = TBdebug.S(), D = L.D, cap = S.cap;
    /* 프로그램 cfg72 그대로 (routine72-auto src/ui/public/app.js) + 화면에서 고른 1회 매수금·새 사이클 */
    const c = MHV.defaults('1.0', 'SOXL'); Object.assign(c, { splits: 72, target: 52.5, big: 13, avgOff: 0, exhaust: 'recover', ideal: false, lines: 0, shares: 1, tround: 'r2', restart: S.rs === 'rsi' ? 'rsi' : 'next' });
    if (S.money === 'part') { c.money = 'part'; c.mix = S.mix / 100; } else c.money = 'compound';
    const R = MHV.run(c, D, Object.assign({}, L.o, { from: L.from, to: L.to, capital: cap }));
    const days = R72D.dnum(D.d[L.to]) - R72D.dnum(D.d[L.from - 1]), cg = R72D.cagr(cap, R.final, days), md = R72D.dd(R.eq, 0, R.eq.length - 1);
    const kv = {}; document.querySelectorAll('#tb-kv > div').forEach(e => kv[e.querySelector('small').innerText] = e.querySelector('b').innerText);
    const pct = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(2) + '%', usd = x => (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const exp = { '최종 평가금': usd(R.final), '연평균(CAGR)': pct(cg), '최대 낙폭(MDD)': pct(md), '사이클': R.cycles.length + '번' };
    return { diff: Object.keys(exp).filter(k => kv[k] !== exp[k]).map(k => [k, kv[k], exp[k]]), same: R.eq.length === L.R.eq.length && R.eq.every((x, i) => x === L.R.eq[i]),
             from: D.d[L.from], to: D.d[L.to], fin: R.final }; }"""


def t72bt_check(page, base, fail, local):
    """/72-backtest/ 관리자 '72루틴 백테스트' — 72루틴 자동매매 프로그램 백테스트 탭과 같은 양식
    · 처음: 실전(SOXL 실제 일봉) · 전체 기간 · 원금 100000 · 복리 · 다음 날 · 기존 계산 · 0.25% · 선입선출 · 분배금 · 접는 묶음 3개 · 그래프 휠 확대
    · 화면 숫자(최종·연평균·MDD·사이클) = 프로그램 cfg72 로 따로 돌린 MHV(날마다 총자산 같음) · 표(사이클별 = 엔진 사이클 수 · 일자별 50줄) · CSV · 분포 상자
    · 일부분 복리·RSI 새 사이클로 바꿔도 = 따로 돌린 MHV · '상장 전 포함' = 기본값과 같은 조건 + 재현(배포: 2010 전 시작)"""
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'robots.txt'); page.evaluate("() => { ['tb-set', 'tb-scale', 'tb-open'].forEach(k => localStorage.removeItem(k)); }")
    page.goto(base + '72-backtest/', wait_until='load')
    ready = "() => window.TBdebug && TBdebug.last() && TBdebug.last() !== window.__tbp && document.querySelector('#tb-kv')"
    def wait_new(t=60000):
        page.wait_for_function(ready, timeout=t); page.evaluate("() => { window.__tbp = TBdebug.last(); }"); page.wait_for_timeout(100)
    try:
        wait_new()
    except Exception:
        fail('t72bt', '72루틴 백테스트 결과가 나오지 않음 (60초)'); return
    try:
        d = page.evaluate("""() => { const S = TBdebug.S(); return { v: [S.mode, S.per, S.cap, S.money, S.rs, S.fl, S.rj, S.fee, S.tax, S.hv, S.dv].join(),
            secs: [...document.querySelectorAll('#tb-set details.s2-sec')].map(x => x.dataset.sec + (x.open ? '+' : '')).join(), btn: [...document.querySelectorAll('#tb-set .s2-btn')].map(x => x.innerText).join('|'),
            first: TBdebug.last().D.d[TBdebug.last().from] }; }""")
        if d['v'] != 'real,all,100000,compound,next,none,none,0.25,fifo,off,on' or d['secs'] != 'rule,fill,cost' or d['btn'] != '계산|기본값 (실전)|상장 전 포함' or d['first'] != '2010-03-12':
            fail('t72bt', '처음 기본값·모양 이상: %s' % d)
        r = page.evaluate(T72BT_INDEP_JS)
        if r['diff'] or not r['same']:
            fail('t72bt', '화면 숫자가 프로그램 방식으로 따로 돌린 MHV 와 다름: %s' % r)
        page.wait_for_function("() => window.Chart && Chart.getChart('tb-c')", timeout=30000)
        z = page.evaluate("() => { const c = Chart.getChart('tb-c'); return !!(window.ChartZoom && c.options.plugins.zoom && c.options.plugins.zoom.zoom.wheel.enabled); }")
        if not z: fail('t72bt', '그래프 휠 확대가 켜지지 않음')
        t = page.evaluate("""() => { const R = TBdebug.last().R, out = {}; document.querySelector('#tb-tab button[data-v=cycle]').click(); out.cyc = document.querySelectorAll('#tb-tb tbody tr').length === R.cycles.length;
            document.querySelector('#tb-tab button[data-v=day]').click(); out.day = document.querySelectorAll('#tb-day tbody tr').length === Math.min(50, R.rows.length);
            out.bad = [...document.querySelectorAll('#tb-root td, #tb-kv b')].map(e => e.innerText).filter(x => /undefined|NaN|Infinity/.test(x)).slice(0, 3);
            document.querySelector('#tb-tab button[data-v=year]').click(); out.year = document.querySelectorAll('#tb-tb tbody tr').length > 10; return out; }""")
        if not (t['cyc'] and t['day'] and t['year']) or t['bad']: fail('t72bt', '표 이상: %s' % t)
        with page.expect_download(timeout=15000) as dl:
            page.click('#tb-csv')
        raw = open(dl.value.path(), 'rb').read().decode('utf-8'); lines = raw.lstrip('\ufeff').split('\r\n')
        n = page.evaluate("() => TBdebug.last().R.rows.length")
        if not raw.startswith('\ufeff') or len(lines) != n + 1 or re.search(r'undefined|NaN', raw): fail('t72bt', 'CSV 이상: %d줄(기대 %d)' % (len(lines), n + 1))
        page.wait_for_function("() => document.querySelectorAll('#tb-r7d .r7d-k').length >= 4", timeout=60000)
        # 일부분 복리 50% · RSI 새 사이클 · 이동평균 → 따로 돌린 MHV 와 같음
        page.click('#tb-set [data-secall="1"]'); page.wait_for_timeout(100)
        page.select_option('#tb-money', 'part'); page.select_option('#tb-rs', 'rsi'); page.select_option('#tb-tax', 'avg'); page.click('#tb-run'); wait_new()
        r = page.evaluate(T72BT_INDEP_JS)
        q = page.evaluate("() => [TBdebug.last().cfg.money, TBdebug.last().cfg.mix, TBdebug.last().cfg.restart, TBdebug.last().o.tax && TBdebug.last().o.tax.method]")
        if r['diff'] or not r['same'] or q != ['part', 0.5, 'rsi', 'avg']: fail('t72bt', '조건을 바꾼 결과가 따로 돌린 MHV 와 다름: %s · %s' % (r, q))
        # 상장 전 포함 단추
        page.click('#tb-pre'); wait_new(120000)
        q = page.evaluate("() => { const L = TBdebug.last(), S = TBdebug.S(); return { mode: S.mode, money: S.money, rs: S.rs, tax: S.tax, fee: S.fee, from: L.D.d[L.from], L: L.D.L || 0 }; }")
        if q['mode'] != 'pre' or q['money'] != 'compound' or q['rs'] != 'next' or q['tax'] != 'fifo' or q['fee'] != 0.25 or (not local and (q['L'] <= 0 or q['from'] >= '2010-01-01')):
            fail('t72bt', "'상장 전 포함' 단추 이상: %s" % q)
        else:
            r = page.evaluate(T72BT_INDEP_JS)
            if r['diff'] or not r['same']: fail('t72bt', '상장 전 포함 결과가 따로 돌린 MHV 와 다름: %s' % r)
        for w in (360, 768):
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(250)
            ov = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if ov > 0: fail('t72bt', '%dpx 에서 가로 넘침 %dpx' % (w, ov))
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.evaluate("() => { ['tb-set', 'tb-scale', 'tb-open'].forEach(k => localStorage.removeItem(k)); }")
    except Exception as e:
        fail('t72bt', '72루틴 백테스트 검사 실패: %s' % str(e)[:200])


SNS_RE = re.compile(r'^https://[^/]+\.workers\.dev/sns/')


def sns_ui_check(page, fail):
    """[SNS] 자산 속도의 SNS 자동 게시(관리자 · worker/src/sns.js) 화면 — 이 검사 안에서만 가짜 Worker 응답(실제 SNS·Worker 에는 요청하지 않음):
    연결 상태 4곳 · 안내에 콜백 주소 · 9:16 영상 → SNS 마다 글(메인 홈 링크 · 과거 수익률 경고 · 유튜브 제목 100자·#shorts · 스레드 500자·주제 태그 1개)
    · 소리가 Opus 면 유튜브만 · 올리기(작업 → 조각 → 시작 → 단계) → 게시됨 링크 · 같은 영상을 다시 올리면 조각 없이 '이미 올린 영상'"""
    S = {'calls': [], 'have': set(), 'post': {}}
    plan = {'yt': ['up', 'done'], 'ig': ['wait', 'done'], 'th': ['done'], 'fb': ['wait', 'done']}

    def h(route):
        q = route.request; path = urllib.parse.urlparse(q.url).path
        hd = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json'}
        if q.method == 'OPTIONS': return route.fulfill(status=204, headers=hd)
        buf = q.post_data_buffer or b''
        b = json.loads(buf) if buf and '/sns/part/' not in path else {}
        S['calls'].append((path, b or len(buf), q.headers.get('authorization')))
        J = lambda o: route.fulfill(status=200, headers=hd, body=json.dumps(o))
        if path == '/sns/status':
            return J({'key': True, 'kv': True, 'worker': 'W', 'meta': {'deauth': 'W/sns/meta/deauth', 'del': 'W/sns/meta/delete'},
                      'p': {p: {'ready': True, 'conn': True, 'name': '디코딩 자본주의', 'cb': 'W/sns/cb/' + p} for p in ('yt', 'ig', 'th', 'fb')}})
        if path == '/sns/job':
            S['size'] = b.get('size'); n = -(-b['size'] // (24 << 20))
            return J({'id': b['id'], 'part': 24 << 20, 'parts': n, 'have': ''.join('1' if k in S['have'] else '0' for k in range(n)), 'posts': []})
        m = re.match(r'^/sns/part/\w+/(\d+)$', path)
        if m: S['have'].add(int(m.group(1))); return J({'ok': True})
        p = b.get('p'); key = (b.get('job'), p)
        if path == '/sns/pub':
            if S['post'].get(key) == ['done']: return J({'p': p, 'st': 'done', 'url': 'https://example.com/' + p, 'dup': True})
            S['post'][key] = list(plan[p])
        if path in ('/sns/pub', '/sns/step'):
            seq = S['post'][key]; st = seq.pop(0) if len(seq) > 1 else seq[0]
            return J({'p': p, 'st': st, 'url': 'https://example.com/' + p if st == 'done' else None})
        return route.fulfill(status=404, headers=hd, body='{}')
    page.route(SNS_RE, h)
    try:
        page.evaluate("() => { window.__snsGet = dcAuth.get; dcAuth.get = () => ({ token: 'regression' }); return ASPEED.sns.load(); }")
        page.wait_for_function("document.querySelectorAll('#as-sns-acc .as-sns-a').length === 4", timeout=15000)
        r = page.evaluate("""() => { const v = ASPEED.state().vlast, g = document.getElementById('as-sns-guide').textContent, out = { blob: !!(v && v.blob), go0: document.getElementById('as-sns-go').disabled,
              cb: ['yt', 'ig', 'th', 'fb'].every(p => g.indexOf('W/sns/cb/' + p) >= 0) && g.indexOf('W/sns/meta/delete') >= 0,
              gmiss: ['YouTube Data API v3', '데이터 액세스', '프로덕션', 'instagram_business_content_publish', 'Instagram 테스터', 'pages_manage_posts', '사용자 액세스 토큰',
                      'threads_content_publish', 'Threads 테스터', 'IG_APP_ID', 'IG_APP_SECRET', 'FB_APP_ID', 'FB_APP_SECRET', 'FB_CONFIG_ID', 'TH_APP_ID', 'TH_APP_SECRET'].filter(k => g.indexOf(k) < 0),
              gsec: document.querySelectorAll('#as-sns-guide details.as-sns-g').length, gok: (g.match(/✓ 연결됨/g) || []).length };
            if (!out.blob) return out;
            ASPEED.sns.video(Object.assign({}, v, { w: 1080, h: 1920, audio: 'opus' }));
            out.opus = [...document.querySelectorAll('[data-sns-use]')].filter(c => !c.disabled).map(c => c.dataset.snsUse);
            ASPEED.sns.video(Object.assign({}, v, { w: 1080, h: 1920, audio: 'aac' }));
            out.aac = [...document.querySelectorAll('[data-sns-use]')].filter(c => !c.disabled && c.checked).map(c => c.dataset.snsUse);
            const cs = [...document.querySelectorAll('[data-sns-use]')], ch = () => cs.forEach(c => c.dispatchEvent(new Event('change', { bubbles: true })));
            out.go1 = document.getElementById('as-sns-go').disabled; cs.forEach(c => { c.checked = false; }); ch();
            out.go2 = document.getElementById('as-sns-go').disabled; cs.forEach(c => { c.checked = true; }); ch();
            out.title = document.querySelector('[data-sns-t="yt"]').value;
            out.tx = Object.fromEntries([...document.querySelectorAll('[data-sns-x]')].map(c => [c.dataset.snsX, c.value])); return out; }""")
        if not r['blob']: fail('asset-speed', 'SNS 자동 게시 검사: 앞에서 만든 영상이 없음'); return
        if not r['go0']: fail('asset-speed', 'SNS 자동 게시: 9:16 영상이 없는데 올리기 단추가 켜져 있음 (16:9 영상은 올리지 않음)')
        if not r['cb']: fail('asset-speed', "SNS 자동 게시 '처음 한 번' 안내에 콜백·삭제 주소가 없음")
        if r['gmiss'] or r['gsec'] != 5 or r['gok'] != 4:   # SNS 별 접기 4칸 + GitHub 1칸 · 연결 상태 표시(가짜 응답 = 4곳 모두 연결)
            fail('asset-speed', "SNS '처음 한 번' 안내 이상: 빠진 항목 %s · 접기 칸 %d개(기대 5) · '✓ 연결됨' %d개(기대 4)" % (r['gmiss'], r['gsec'], r['gok']))
        if r['opus'] != ['yt']: fail('asset-speed', 'SNS 자동 게시: 소리가 Opus 인 영상은 유튜브만 골라져야 함 (인스타·스레드·페이스북은 AAC 만): %s' % r['opus'])
        if r['aac'] != ['yt', 'ig', 'th', 'fb']: fail('asset-speed', 'SNS 자동 게시: 연결된 4곳이 골라지지 않음: %s' % r['aac'])
        if r['go1'] or not r['go2']: fail('asset-speed', 'SNS 올리기 단추: 고른 곳이 있으면 켜지고 모두 끄면 꺼져야 함 (켜짐 %s · 모두 끔 %s)' % (not r['go1'], not r['go2']))
        if len(r['title']) > 100 or '#shorts' not in r['title']: fail('asset-speed', 'SNS 유튜브 제목 이상 (100자 · #shorts): %s' % r['title'])
        for p, t in r['tx'].items():
            if '과거 수익률은 미래를 보장하지 않' not in t or '→' not in t or 'undefined' in t or 'NaN' in t:
                fail('asset-speed', 'SNS %s 글 이상 (결과 숫자·경고): %s' % (p, t[:120]))
            if p != 'ig' and 'https://d-capitalism.com/' not in t: fail('asset-speed', 'SNS %s 글에 메인 홈 링크 없음' % p)
        if len(r['tx']['th']) > 500 or r['tx']['th'].count('#') != 1: fail('asset-speed', 'SNS 스레드 글 (500자 · 주제 태그 1개) 이상: %d자 · # %d개' % (len(r['tx']['th']), r['tx']['th'].count('#')))
        size = page.evaluate("() => ASPEED.sns.state().vid.blob.size")
        for n in (1, 2):
            S['calls'].clear()
            page.once('dialog', lambda d: d.accept())
            page.evaluate("() => { document.getElementById('as-sns-st').textContent = ''; }")   # 앞 결과 글이 남아 바로 끝난 것으로 보지 않게
            page.click('#as-sns-go')
            try:
                page.wait_for_function("/모두|실패|못했/.test(document.getElementById('as-sns-st').textContent) && !/중…?$/.test(document.getElementById('as-sns-st').textContent)", timeout=60000)
            except Exception:
                fail('asset-speed', 'SNS 올리기 %d번째가 끝나지 않음: %s' % (n, page.inner_text('#as-sns-st'))); break
            st, rows = page.inner_text('#as-sns-st'), page.inner_text('#as-sns-prog')
            parts = [c for c in S['calls'] if c[0].startswith('/sns/part/')]
            pubs = sorted(c[1]['p'] for c in S['calls'] if c[0] == '/sns/pub')
            if '4곳 모두' not in st or rows.count('보기') != 4 or pubs != ['fb', 'ig', 'th', 'yt'] or any(not (c[2] or '').startswith('Bearer ') for c in S['calls']):
                fail('asset-speed', 'SNS 올리기 %d번째 결과 이상: %s / %s / 시작 %s' % (n, st, rows.replace('\n', ' '), pubs))
            if n == 1 and (len(parts) != -(-size // (24 << 20)) or sum(c[1] for c in parts) != size):
                fail('asset-speed', 'SNS 영상 조각 올리기 이상: %s (영상 %d바이트)' % ([c[1] for c in parts], size))
            if n == 2 and (parts or rows.count('이미 올린 영상') != 4):
                fail('asset-speed', '같은 영상을 다시 올렸는데 조각을 다시 보내거나 이미 올린 영상 표시가 없음: 조각 %d · %s' % (len(parts), rows.replace('\n', ' ')))
    except Exception as e:
        fail('asset-speed', 'SNS 자동 게시 화면 검사 실패: %s' % str(e)[:200])
    finally:
        try: page.unroute(SNS_RE, h)
        except Exception: pass
        try: page.evaluate("() => { if (window.__snsGet) dcAuth.get = window.__snsGet; }")
        except Exception: pass


def kcmp_check(page, base, fail, local):
    """커버드콜 시뮬레이터 '코스피 대비 수익률 비교' — ETF 가격이 실제 거래 종가(분배금 미반영)인지
    · compare.json basis:'raw' · 상장일·마지막 종가 = 네이버 일별 시세(독립 출처) · 화면: 분배금 포함 > 주가(분배금 제외)"""
    try:
        j = json.load(open(os.path.join(ROOT, 'data', 'compare.json'), encoding='utf-8')) if local else json.loads(http_text(base + 'data/compare.json'))
    except Exception as e:
        fail('kcmp', 'compare.json 읽기 실패: %s' % e); return
    if j.get('basis') != 'raw':
        fail('kcmp', "compare.json basis 가 'raw' 아님 (수정주가 자료일 수 있음): %s" % j.get('basis'))
    A = Actual()
    for tab, (path, sym) in KCMP_SYMS.items():
        ser = (j.get('series') or {}).get(sym) or []
        if len(ser) < 5: fail(path, 'compare.json %s 일봉 부족' % sym); continue
        # 장중(한국 시간 16시 전)의 오늘 값은 아직 확정 종가가 아님 — 시세 봇(15분마다)과 네이버 현재가가 몇 분 차이로 달라 '수정주가 의심'으로
        # 잘못 실패하던 것(2026-10-20 장중 5건) → 그때는 전 거래일 종가로 대조 (마감 뒤에는 오늘 종가 그대로)
        kst = time.gmtime(time.time() + 9 * 3600)
        last = ser[-1]
        if time.strftime('%Y%m%d', time.gmtime(last[0] * 86400)) == time.strftime('%Y%m%d', kst) and kst.tm_hour < 16:
            last = ser[-2]
        for d, c in (ser[0], last):
            ymd = time.strftime('%Y%m%d', time.gmtime(d * 86400))
            try:
                act = A.kr('stock', sym.split('.')[0], ymd)
            except Exception as e:
                print('  ! 네이버 일별 시세 %s 받기 실패 (대조 건너뜀): %s' % (sym, str(e)[:80]), flush=True); break
            if act and act[1] and abs(c / act[1] - 1) > 0.005:
                fail(path, '%s %s 종가 %s ≠ 실제 거래 종가 %s (수정주가 의심)' % (sym, ymd, c, act[1]))
        page.goto(base + path + '/', wait_until='load'); page.wait_for_timeout(800)
        r = page.evaluate("""async (k) => { for (let i = 0; i < 40 && !(document.getElementById((k === 'simulator' ? '' : k + '-') + 'kcmp-ret-etf') || {}).textContent.match(/\\d/); i++) await new Promise(r => setTimeout(r, 250));
            const g = id => (document.getElementById((k === 'simulator' ? '' : k + '-') + 'kcmp-' + id) || {}).textContent || '';
            const v = () => parseFloat(g('ret-etf').replace(/[^\\d.+-]/g, ''));
            window.kcmpSetPeriod(k, 'MAX'); window.kcmpSetMode(k, false); const p = v(); window.kcmpSetMode(k, true); const t = v(); window.kcmpSetMode(k, false);
            return { p, t, note: g('note') }; }""", tab)
        if not (r['t'] > r['p'] + 1): fail(path, '코스피 비교: 분배금 포함(%s%%)이 주가 기준(%s%%)보다 1%%p 이상 높지 않음 — 분배금이 반영되지 않았거나 수정주가' % (r['t'], r['p']))
        if '분배금 제외' not in r['note']: fail(path, '코스피 비교 설명에 "분배금 제외" 없음')


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


BK_IMG_ALL = "[...document.images].every(i => i.complete)"
BK_IMG_RETRY = """() => { const bad = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src'));
  bad.forEach(i => { const s = i.getAttribute('src'); i.src = s + (s.includes('?') ? '&' : '?') + 'retry=1'; });
  return bad.map(i => i.getAttribute('src')); }"""


BK_NET = []   # 표지 요청 실패·HTTP 오류 기록 (다시 불러올 때 원인을 함께 알림)


def bk_net_watch(page):
    def rf(q):
        if '/books/cover/' in q.url: BK_NET.append('%s %s' % (q.url.split('/books/cover/')[1][:40], q.failure))
    def rs(r):
        if '/books/cover/' in r.url and r.status >= 400: BK_NET.append('%s HTTP %d' % (r.url.split('/books/cover/')[1][:40], r.status))
    page.on('requestfailed', rf); page.on('response', rs)


def bk_img_settle(page, timeout):
    """자본가 서재 표지: 늦게 불러오기(lazy)를 풀고 모두 받을 때까지 기다림 → 안 열린 그림은 한 번만 다시 불러옴
    (실사이트에서 네트워크가 한 번 끊겨 생기는 거짓 실패 방지 — 2026-10-20 learn/cagr-start-point 1건. 파일이 정말 깨졌으면 다시 불러와도 0 이라 그대로 실패)
    → 다시 불러온 그림 주소 목록(알림용)"""
    page.evaluate("() => { document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager'); return true; }")
    try: page.wait_for_function(BK_IMG_ALL, timeout=timeout)
    except Exception: pass   # 아래 그림 크기 검사가 실패로 알림
    again = page.evaluate(BK_IMG_RETRY)
    if again:
        try: page.wait_for_function(BK_IMG_ALL, timeout=10000)
        except Exception: pass
        print('    알림: 처음에 안 열린 그림 %d개를 한 번 다시 불러옴 — %s · 원인 %s' % (len(again), ', '.join(again[:3]), '; '.join(BK_NET[-4:]) or '기록 없음'), flush=True)
    return again


def books_check(page, base, fail, local):
    """[BOOKS] 자본가 서재 /books/ (scripts/build_books.py · content/books/books.json)
    · 단계·책 수가 자료와 같음 · 표 줄 = 책 카드 · 책마다 저자·출판사·한줄평·이어 하기 · 단계 바로 가기가 실제 칸으로
    · 구매 링크: 쿠팡 단축 주소만 · rel=sponsored nofollow noopener · 하나라도 있으면 맨 위(첫 단계보다 앞)에 경제적 이해관계 문구 / 없으면 문구·단추 없음
    · '최저가' 표현 없음 · 애드센스·canonical·구조화 데이터(ItemList 책 수) · 사이트 안 링크가 실제 파일(로컬)
    · 투자 공부 글의 '이 글과 함께 읽으면 좋은 책' → 실제 책 칸 · 하단 사이트맵·홈에 자본가 서재 링크
    · 책 표지(scripts/fetch_book_covers.py → books/cover · content/books/covers.json): 단계마다 표지 책장(책 수 = 자료) · 카드 표지 · 글 아래 작은 표지가
      실제로 열림(그림 크기 > 0) · 주소 = 그 책 파일 · alt 에 책 제목 · 보이는 크기(PC 카드 140px↑ · 책장 100px↑ / 320px 폭 카드 90px↑ · 책장 75px↑)
      · 표지 목록에 없는 책은 실패가 아니라 알림(표지 갱신 Actions 가 받아 오는 사이) — 목록에 있는데 그림이 안 열리면 실패
      · 표지를 누르면 구매 링크(링크 있는 책만) — 단추와 같은 형식·rel"""
    src = json.load(open(os.path.join(ROOT, 'content', 'books', 'books.json'), encoding='utf-8'))
    n_st, n_bk, n_cp = len(src['stages']), len(src['books']), sum(1 for b in src['books'] if b.get('cp'))
    cvp = os.path.join(ROOT, 'content', 'books', 'covers.json')
    cvl = json.load(open(cvp, encoding='utf-8')).get('covers', {}) if os.path.isfile(cvp) else {}
    has_cv = {b['id'] for b in src['books'] if b['id'] in cvl and os.path.isfile(os.path.join(ROOT, 'books', 'cover', b['id'] + '.webp'))}
    titles = {b['id']: b['title'] for b in src['books']}
    page.set_viewport_size({'width': 1280, 'height': 900})
    bk_net_watch(page)
    page.goto(base + 'books/', wait_until='load'); page.wait_for_timeout(300)
    bk_img_settle(page, 20000)
    r = page.evaluate("""() => {
      const q = s => [...document.querySelectorAll(s)], first = document.querySelector('.bk-stage'), disc = document.getElementById('bk-disc');
      const ld = q('script[type="application/ld+json"]').map(s => { try { return JSON.parse(s.textContent); } catch (e) { return 'ERR'; } }).flat();
      const il = (ld.find(x => x && x['@type'] === 'CollectionPage') || {}).mainEntity || {};
      return { h1: (document.querySelector('h1') || {}).textContent || '', stages: q('.bk-stage').length, cards: q('.bk-card').length, rows: q('.bk-tbl tbody tr').length,
        empty: q('.bk-card').filter(c => !c.querySelector('h3').textContent.trim() || !c.querySelector('.bk-by').textContent.trim() || c.querySelector('.bk-line').textContent.trim().length < 20 || c.querySelector('.bk-use').textContent.trim().length < 20).map(c => c.id),
        steps: q('.bk-steps a').map(a => a.getAttribute('href')).filter(h => !document.querySelector(h)), nsteps: q('.bk-steps a').length,
        rowlinks: q('.bk-tbl a.bk-row').map(a => a.getAttribute('href')).filter(h => !document.querySelector(h)),
        buys: q('a[href*="coupang"]').map(a => [a.getAttribute('href'), a.getAttribute('rel'), a.getAttribute('target'), a.className]),
        shelf: q('.bk-stage').map(s => s.querySelectorAll('.bk-shelf li').length),
        simgs: q('.bk-shelf a').map(a => { const i = a.querySelector('img'); return [a.getAttribute('href').slice(3), i ? i.getAttribute('src') : null, i ? i.naturalWidth : 0, i ? i.alt : '', i ? Math.round(i.getBoundingClientRect().width) : 0]; }),
        cimgs: q('.bk-card').map(c => { const i = c.querySelector('.bk-cover img'); return [c.id.slice(2), i ? i.getAttribute('src') : null, i ? i.naturalWidth : 0, i ? i.alt : '', i ? Math.round(i.getBoundingClientRect().width) : 0, !!c.querySelector('.bk-rk')]; }),
        disc: disc ? { t: disc.textContent, before: !!first && !!(disc.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING), vis: !!disc.offsetParent } : null,
        cheap: /최저가/.test(document.body.innerText), ads: !!document.querySelector('script[src*="adsbygoogle.js?client=ca-pub-8051182229751523"]'),
        canon: (document.querySelector('link[rel=canonical]') || {}).href || '', types: ld.map(x => x && x['@type']), items: (il.itemListElement || []).length,
        links: q('a[href^="/"]').map(a => a.getAttribute('href').split('#')[0]) };
    }""")
    if '자본가 서재' not in r['h1']: fail('books/', '제목(h1) 이상: ' + r['h1'][:40])
    if r['stages'] != n_st or r['cards'] != n_bk or r['rows'] != n_bk: fail('books/', '단계 %d·책 카드 %d·표 줄 %d (자료 %d단계 %d권)' % (r['stages'], r['cards'], r['rows'], n_st, n_bk))
    if r['empty']: fail('books/', '저자·한줄평·이어 하기가 비었거나 너무 짧은 책: %s' % r['empty'][:5])
    if r['nsteps'] != n_st or r['steps'] or r['rowlinks']: fail('books/', '단계 바로 가기·표 링크가 없는 칸을 가리킴: %s %s' % (r['steps'], r['rowlinks'][:3]))
    n_cvl = sum(1 for b in src['books'] if b.get('cp') and b['id'] in has_cv)
    nb = sum(1 for b in r['buys'] if b[3] == 'bk-buy'); nc = sum(1 for b in r['buys'] if b[3] == 'bk-cvl')
    if nb != n_cp or nc != n_cvl or len(r['buys']) != n_cp + n_cvl:
        fail('books/', '구매 링크: 단추 %d·표지 %d·전체 %d개 (자료의 링크 %d개 · 표지 있는 것 %d개)' % (nb, nc, len(r['buys']), n_cp, n_cvl))
    bad = [b for b in r['buys'] if not re.match(r'^https://link\.coupang\.com/a/[A-Za-z0-9]+$', b[0] or '') or b[1] != 'sponsored nofollow noopener' or b[2] != '_blank']
    if bad: fail('books/', '구매 링크 형식·rel 이상: %s' % bad[:3])
    if n_cp and not (r['disc'] and r['disc']['before'] and r['disc']['vis'] and '쿠팡 파트너스' in r['disc']['t'] and '수수료' in r['disc']['t']):
        fail('books/', '구매 링크가 있는데 맨 위에 경제적 이해관계 문구가 없음(공정위 지침 — 제목 또는 첫 부분): %s' % r['disc'])
    if not n_cp and r['disc']: fail('books/', '구매 링크가 없는데 제휴 문구가 보임')
    # 책 표지
    want_n = [sum(1 for b in src['books'] if b['stage'] == s['id']) for s in src['stages']]
    if r['shelf'] != want_n: fail('books/', '단계별 표지 책장 권수 %s (자료 %s)' % (r['shelf'], want_n))
    for kind, rows, minw in (('책장', r['simgs'], 100), ('카드', r['cimgs'], 140)):
        for x in rows:
            bid, s_, nw, alt, w = x[:5]
            if bid in has_cv:
                if not (s_ or '').startswith('/books/cover/%s.webp?v=' % bid) or nw <= 0 or titles.get(bid, '?') not in alt or w < minw:
                    fail('books/', '%s 표지 이상 %s: 주소 %s · 그림 너비 %s · alt %r · 보이는 너비 %dpx(%dpx 이상)' % (kind, bid, s_, nw, alt[:30], w, minw))
            elif s_:
                fail('books/', '%s: 표지 목록에 없는 책 %s 에 그림 %s' % (kind, bid, s_))
        if kind == '카드' and any(x[0] in has_cv and not x[5] for x in rows): fail('books/', '카드 표지에 순위 표시가 없음')
    miss = [b['id'] for b in src['books'] if b['id'] not in has_cv]
    if miss: print('    알림: 표지가 아직 없는 책 %d권(순위 숫자 상자로 대신) — %s' % (len(miss), ', '.join(miss[:6])), flush=True)
    if r['cheap']: fail('books/', "'최저가' 표현이 있음 (도서정가제 — 확인할 수 없는 표현)")
    if not r['ads'] or not r['canon'].endswith('/books/') or 'CollectionPage' not in r['types'] or 'BreadcrumbList' not in r['types'] or r['items'] != n_bk:
        fail('books/', '애드센스·canonical·구조화 데이터 이상: ads %s · %s · %s · 목록 %d' % (r['ads'], r['canon'], r['types'], r['items']))
    if local:
        for h in sorted(set(r['links'])):
            f = os.path.join(ROOT, h.strip('/'), 'index.html') if h.endswith('/') else os.path.join(ROOT, h.lstrip('/'))
            if h != '/' and not os.path.isfile(f): fail('books/', '깨진 링크 ' + h)
    for w in (320, 390):   # 휴대폰 폭: 넘침 없음 (표는 가로 스크롤 상자 안) · 표지가 너무 작아지지 않음
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(150)
        o = page.evaluate(OVERFLOW_JS)
        if o['sw'] > o['vw'] + 1 or o['out']: fail('books/', '%dpx 넘침 %s' % (w, o['out'][:3]))
        sz = page.evaluate("[Math.min(...[...document.querySelectorAll('.bk-shelf img')].map(i => i.getBoundingClientRect().width), 999), "
                           "Math.min(...[...document.querySelectorAll('.bk-cover img')].map(i => i.getBoundingClientRect().width), 999)]")
        if has_cv and (sz[0] < 75 or sz[1] < 90): fail('books/', '%dpx 폭에서 표지가 너무 작음: 책장 %.0fpx · 카드 %.0fpx (75·90px 이상)' % (w, sz[0], sz[1]))
    page.set_viewport_size({'width': 1280, 'height': 900})
    # 투자 공부 글 → 책 칸
    ids = {b['id'] for b in src['books']}
    rel = sorted({a for b in src['books'] for a in b.get('learn', [])})
    for slug in rel[:4]:
        page.goto(base + 'learn/' + slug + '/', wait_until='load'); page.wait_for_timeout(100)
        hs = page.evaluate("[...document.querySelectorAll('a[href^=\"/books/#b-\"]')].map(a => a.getAttribute('href').slice(10))")
        want = [b['id'] for b in src['books'] if slug in b.get('learn', [])][:4]
        if hs != want or any(h not in ids for h in hs): fail('learn/' + slug, "'이 글과 함께 읽으면 좋은 책' 이상: %s (기대 %s)" % (hs, want))
        bk_img_settle(page, 15000)
        th = page.evaluate("[...document.querySelectorAll('a[href^=\"/books/#b-\"]')].map(a => { const i = a.querySelector('img'); return [a.getAttribute('href').slice(10), i ? i.naturalWidth : -1]; })")
        badt = [x for x in th if (x[0] in has_cv) != (x[1] > 0)]
        if badt: fail('learn/' + slug, "'함께 읽으면 좋은 책' 작은 표지 이상(-1 = 그림 없음 · 0 = 안 열림): %s" % badt)
    page.goto(base + 'learn/', wait_until='load'); page.wait_for_timeout(100)
    if not page.evaluate("!!document.querySelector('.box a[href=\"/books/\"]')"): fail('learn/', '투자 공부 목록에 자본가 서재 안내가 없음')
    page.goto(base + 'compound/', wait_until='load'); page.wait_for_timeout(200)
    t = page.evaluate("(document.querySelector('.sf-map .sf-learn') || {}).innerText || ''")
    if '자본가 서재' not in t: fail('compound/', '하단 사이트맵 투자 공부 열에 자본가 서재가 없음')
    page.goto(base, wait_until='load'); page.wait_for_timeout(200)
    if not page.evaluate("!!document.querySelector('.learn-home a[href=\"books/\"]')"): fail('', '홈 투자 공부 칸에 자본가 서재 링크가 없음')
    print('    자본가 서재: %d단계 · %d권 · 표지 %d권 · 구매 링크 %d개' % (n_st, n_bk, len(has_cv), n_cp), flush=True)


BOARD_OV_JS = OVERFLOW_JS


def board_check(ctx, base, fail, local, attach):
    """[COMMUNITY] 건의 게시판 /suggest/ — 실제 Worker 코드(worker/src/*.js)를 node:sqlite 로 띄운 가짜 서버(tests/worker_board_test.mjs --serve)에
    이 검사 탭의 workers.dev 요청을 모두 보냄 → 실제 회원 자료·게시판·방문자 수는 건드리지 않음 (실사이트 검사도 같음)
    · 손님 목록 · 회원 글쓰기(바로 전 화면 미리 고름·임시 저장·검사 문구·HTML 글자 그대로·주소 링크·기기 정보) · 댓글 · 공감(다른 회원) · 비밀글 · 관리자(상태·운영자 답변·답변 대기)
    · 휴대폰 폭에서 목록·글·글쓰기 화면 넘침 없음 · 실사이트는 먼저 진짜 Worker 로 목록이 열리는지(D1 표 배포 확인)"""
    if not shutil.which('node'):
        fail('suggest', 'node 가 없어 건의 게시판 화면 검사를 못 함'); return
    if not local:   # 진짜 Worker(배포본)로 손님 목록이 열리는지 — 읽기만
        pg = ctx.new_page(); errs0 = []
        pg.on('pageerror', lambda e: errs0.append(str(e)))
        try:
            pg.goto(base + 'suggest/', wait_until='load', timeout=60000)
            pg.wait_for_function("document.querySelector('#sg-items .sg-list, #sg-root .sg-empty b') && !document.querySelector('#sg-items .sg-loading')", timeout=30000)
            t = pg.evaluate("document.getElementById('sg-root').innerText")
            if '불러오지 못했습니다' in t: fail('suggest', '실제 Worker 로 게시판 목록을 불러오지 못함: ' + t[:120])
            if errs0: fail('suggest', '스크립트 오류(실제 Worker): ' + errs0[0][:160])
        except Exception as e:
            fail('suggest', '실제 Worker 목록 확인 오류: ' + str(e)[:160])
        finally:
            pg.close()
    origin = re.match(r'^(https?://[^/]+)', base).group(1)
    node = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'worker_board_test.mjs'), '--serve', '0', origin], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = node.stdout.readline()
        if not line.startswith('{'):
            fail('suggest', '게시판 가짜 서버를 못 띄움 (node:sqlite — Node 22.13+ 필요): ' + (line + node.stderr.read(300))[:200]); return
        info = json.loads(line); npt = info['port']; TK = info['tokens']
        calls = []

        def wk(route):
            q = route.request
            path = re.sub(r'^https?://[^/]+', '', q.url)
            h = {k: v for k, v in q.headers.items() if k.lower() in ('origin', 'authorization', 'content-type', 'user-agent')}
            body = q.post_data_buffer if q.method not in ('GET', 'HEAD', 'OPTIONS') else None
            rq = urllib.request.Request('http://127.0.0.1:%d' % npt + path, data=body, method=q.method, headers=h)
            try:
                r = urllib.request.urlopen(rq, timeout=20); st, hd, bd = r.status, dict(r.headers), r.read()
            except urllib.error.HTTPError as e:
                st, hd, bd = e.code, dict(e.headers), e.read()
            calls.append((q.method, path.split('?')[0], st))
            route.fulfill(status=st, headers=hd, body=bd)
        for o in ctx.pages:   # 같은 출처의 다른 탭(무한매수법·VR 기록 화면 등)은 dc_auth 바뀜(storage 이벤트)에 반응해 진짜 Worker 에 가짜 토큰을 보내고 401 → 로그아웃시킴 → 비워 둠 (72루틴 검사와 같은 이유)
            try: o.goto('about:blank')
            except Exception: pass
        pg = ctx.new_page(); perr = []
        pg.on('pageerror', lambda e: perr.append(str(e)))
        pg.on('console', lambda m: perr.append(m.text) if m.type == 'error' and not m.text.startswith('Failed to load resource') else None)   # 손님 비밀글 403 처럼 일부러 받는 오류 응답의 브라우저 알림은 뺌(응답 코드는 calls 로 따로 확인)
        pg.route(re.compile(r'^https://[^/]*workers\.dev/.*'), wk)

        def login(who, uid, nick, admin=False):
            pg.evaluate("a => localStorage.setItem('dc_auth', JSON.stringify({ token: a[0], exp: 4102444800, user: { id: a[1], nick: a[2], admin: a[3] } }))", [TK[who], uid, nick, admin])

        step = ['시작']

        def ready(sel, ms=30000):
            step[0] = '%s 기다림 (%s)' % (sel, pg.url.replace(base, '/'))
            pg.wait_for_selector(sel, timeout=ms)
            pg.wait_for_timeout(200)

        def wide(where):
            for w in (320, 390):
                pg.set_viewport_size({'width': w, 'height': 900}); pg.wait_for_timeout(150)
                r = pg.evaluate(BOARD_OV_JS)
                if r['sw'] > r['vw'] + 1 or r['out']: fail('suggest', '%s %dpx 넘침 (문서 %d) %s' % (where, w, r['sw'], r['out'][:3]))
            pg.set_viewport_size({'width': 1280, 'height': 900})
        pg.set_viewport_size({'width': 1280, 'height': 900})
        pg.goto(base + 'suggest/', wait_until='load'); pg.evaluate("() => { localStorage.removeItem('dc_auth'); localStorage.removeItem('dc_sg_draft'); }")
        # ── 손님 목록
        pg.goto(base + 'suggest/', wait_until='load'); ready('#sg-items .sg-empty')
        g = pg.evaluate("""() => ({ empty: document.querySelector('#sg-items .sg-empty').innerText, write: document.getElementById('sg-write').innerText,
            stats: document.querySelectorAll('#sg-stats .sg-stat').length, cats: document.querySelectorAll('#sg-cats .sg-chip').length,
            nav: [...document.querySelectorAll('#mainNav > .tab-group')].map(x => x.id).slice(-2).join(','), drop: !!document.querySelector('#grp-community-drop #drop-suggest'),
            act: document.getElementById('grp-community-btn').classList.contains('has-active'), save: !!document.getElementById('dca-save') })""")
        if '아직 올라온 글이 없습니다' not in g['empty']: fail('suggest', '빈 목록 안내 이상: ' + g['empty'][:60])
        if g['write'].strip() != '로그인하고 글쓰기': fail('suggest', '손님 글쓰기 단추 글자 이상: ' + g['write'])
        if g['stats'] != 4 or g['cats'] != 4: fail('suggest', '처리 상태 %d개·분류 %d개 (기대 4·4 — 손님은 내 글 없음)' % (g['stats'], g['cats']))
        if g['nav'] != 'grp-passive,grp-community' or not g['drop'] or not g['act']: fail('suggest', "상단 메뉴 '커뮤니티'(불로소득 바로 뒤 · 건의 게시판 · 선택 표시) 이상: %s" % g)
        if g['save']: fail('suggest', "게시판에 '내 저장함에 저장' 단추가 붙음")
        wide('손님 목록')
        # ── 회원 5(홍길동): 글쓰기 — 바로 전 화면(연봉 계산기) 미리 고름 · 검사 문구 · 임시 저장
        login('a', 5, '홍길동')
        pg.goto(base + 'suggest/?w=new', wait_until='load', referer=base + 'salary/'); ready('#sg-wform')
        if pg.evaluate("document.getElementById('sg-page').value") != 'salary': fail('suggest', "글쓰기 '관련 화면'에 바로 전 화면(salary)이 미리 골라지지 않음: %r" % pg.evaluate("document.getElementById('sg-page').value"))
        wide('글쓰기')
        pg.click('#sg-wsend'); pg.wait_for_timeout(200)
        if '분류를 골라' not in pg.evaluate("document.getElementById('sg-wmsg').innerText"): fail('suggest', '분류 없이 올리기 → 안내가 없음')
        TITLE = '<img src=x onerror=window.__xss=1>연봉 계산기 0원'
        pg.click('[data-wcat="bug"]'); pg.fill('#sg-title', TITLE); pg.fill('#sg-body', '연봉 5,000만원을 넣으면\n실수령액이 0원입니다. https://d-capitalism.com/salary/ 참고')
        pg.wait_for_timeout(500)
        d = pg.evaluate("JSON.parse(localStorage.getItem('dc_sg_draft') || 'null')")
        if not d or d.get('title') != TITLE or d.get('cat') != 'bug': fail('suggest', '쓰던 글 임시 저장이 안 됨: %r' % d)
        pg.reload(wait_until='load'); ready('#sg-wform')
        if pg.evaluate("document.getElementById('sg-title').value") != TITLE: fail('suggest', '새로 고친 뒤 쓰던 글이 돌아오지 않음')
        pg.click('#sg-wsend'); pg.wait_for_function("/[?&]p=\\d+/.test(location.search) && document.querySelector('#sg-pv')", timeout=20000); pg.wait_for_timeout(300)
        v = pg.evaluate("""() => ({ url: location.search, ttl: document.querySelector('.sg-v-ttl').textContent, img: document.querySelectorAll('#sg-pv img').length, xss: !!window.__xss,
            a: [...document.querySelectorAll('#sg-pv .sg-body a')].map(a => [a.getAttribute('href'), a.rel, a.target]), info: !!document.querySelector('#sg-pv .sg-info'),
            page: (document.querySelector('.sg-v-meta a') || {}).textContent || '', vote: document.getElementById('sg-vote').disabled, draft: localStorage.getItem('dc_sg_draft') })""")
        if v['ttl'] != TITLE or v['img'] or v['xss']: fail('suggest', '제목의 HTML 이 글자 그대로가 아님(스크립트 끼워 넣기 위험): %r' % v)
        if v['a'] != [['https://d-capitalism.com/salary/', 'nofollow ugc noopener noreferrer', '_blank']]: fail('suggest', '본문 주소 링크 이상: %r' % v['a'])
        if not v['info'] or '연봉' not in v['page'] or not v['vote'] or v['draft']: fail('suggest', '글 보기(기기 정보·관련 화면·내 글 공감 막음·임시 저장 지움) 이상: %r' % v)
        pid = re.search(r'p=(\d+)', v['url']).group(1)
        pg.fill('#sg-cbody', '크롬에서도 같습니다'); pg.click('#sg-csend')
        pg.wait_for_function("document.querySelectorAll('.sg-cmt').length === 1", timeout=20000)
        wide('글 보기')
        pg.click('[data-act="list"]'); ready('#sg-items .sg-item')
        L = pg.evaluate("""() => ({ n: document.querySelectorAll('#sg-items .sg-item').length, t: document.querySelector('#sg-items .sg-item').innerText,
            open: document.querySelector('[data-st="open"] b').textContent, mine: !!document.querySelector('[data-mine]'), w: document.getElementById('sg-write').innerText.trim() })""")
        if L['n'] != 1 or '[1]' not in L['t'] or '내 글' not in L['t'] or '홍*동' not in L['t'] or L['open'] != '1' or not L['mine'] or L['w'] != '글쓰기':
            fail('suggest', '회원 목록 이상(댓글 수·내 글·가린 닉네임·접수 1): %r' % L)
        wide('회원 목록')
        # ── 회원 6(김철수): 공감 · 비밀글
        login('b', 6, '김철수')
        pg.goto(base + 'suggest/?p=' + pid, wait_until='load'); ready('#sg-vote')
        if pg.evaluate("!!document.querySelector('#sg-pv .sg-info')"): fail('suggest', '다른 회원에게 기기 정보가 보임')
        pg.click('#sg-vote'); pg.wait_for_timeout(1200)
        pg.reload(wait_until='load'); ready('#sg-vote')
        r = pg.evaluate("[document.getElementById('sg-vote').getAttribute('aria-pressed'), document.getElementById('sg-vn').textContent]")
        if r != ['true', '1']: fail('suggest', '공감 누른 뒤 다시 열면 공감 1·눌림 표시 기대: %r' % r)
        pg.goto(base + 'suggest/?w=new', wait_until='load'); ready('#sg-wform')
        pg.click('[data-wcat="etc"]'); pg.fill('#sg-title', '내 계정 기록 문의'); pg.fill('#sg-body', '비밀 내용입니다 12345'); pg.check('#sg-secret')
        pg.click('#sg-wsend'); pg.wait_for_function("document.querySelector('#sg-pv')", timeout=20000)
        sid = re.search(r'p=(\d+)', pg.evaluate('location.search')).group(1)
        # ── 손님: 비밀글은 목록에서 제목 숨김 · 열면 안내
        pg.evaluate("localStorage.removeItem('dc_auth')")
        pg.goto(base + 'suggest/', wait_until='load'); ready('#sg-items .sg-item')
        t = pg.evaluate("document.getElementById('sg-items').innerText")
        if '비밀글입니다' not in t or '내 계정 기록 문의' in t: fail('suggest', '손님 목록에 비밀글 제목이 보임')
        pg.goto(base + 'suggest/?p=' + sid, wait_until='load'); ready('#sg-root .sg-empty b')
        if '글쓴이와 운영자만' not in pg.evaluate("document.querySelector('#sg-root .sg-empty b').textContent"): fail('suggest', '손님이 비밀글을 열 때 안내 이상')
        # ── 관리자: 처리 상태 · 운영자 답변 · 답변 대기
        login('admin', 2, '현경흠', True)
        pg.goto(base + 'suggest/?p=' + pid, wait_until='load'); ready('#sg-st')
        pg.evaluate("() => { const s = document.getElementById('sg-st'); s.value = 'done'; s.dispatchEvent(new Event('change', { bubbles: true })); }")
        pg.wait_for_function("document.querySelector('#sg-pv .sg-tag.s-done')", timeout=20000)
        pg.fill('#sg-cbody', '확인했습니다. 고쳐서 반영했어요.'); pg.click('#sg-csend')
        pg.wait_for_function("document.querySelectorAll('.sg-cmt.admin').length === 1", timeout=20000)
        a = pg.evaluate("""() => ({ tag: document.querySelector('.sg-cmt.admin .sg-tag.staff').textContent, nick: document.querySelector('.sg-v-meta').innerText })""")
        if a['tag'] != '운영자 답변' or '홍길동' not in a['nick'] or '회원 5' not in a['nick']: fail('suggest', '관리자 글 보기(운영자 답변·전체 닉네임·회원 번호) 이상: %r' % a)
        pg.click('[data-act="list"]'); ready('#sg-items .sg-item')
        a = pg.evaluate("""() => ({ wait: (document.querySelector('[data-wait] em') || {}).textContent, done: document.querySelector('[data-st="done"] b').textContent,
            ans: document.getElementById('sg-items').innerText.includes('운영자 답변') })""")
        if a != {'wait': '1', 'done': '1', 'ans': True}: fail('suggest', '관리자 목록(답변 대기 1 = 비밀글 · 완료 1 · 운영자 답변 표시) 이상: %r' % a)
        if perr: fail('suggest', '게시판 화면 스크립트 오류: ' + perr[0][:160])
        bad = [c for c in calls if c[2] >= 400 and not (c[0] == 'GET' and c[1] == '/board/' + sid and c[2] == 403)]
        if bad: fail('suggest', '게시판 서버 오류 응답(손님 비밀글 403 말고): %r' % bad[:4])
        print('    건의 게시판: %s' % ' → '.join('%s %s %d' % c for c in calls if c[1].startswith('/board'))[:300], flush=True)
    except Exception as e:
        try:
            now = pg.evaluate("(document.getElementById('sg-root') || document.body).innerText.slice(0, 160)")
        except Exception:
            now = '?'
        fail('suggest', '건의 게시판 화면 검사 오류 — %s: %s · 화면: %s · 요청: %s' % (step[0] if 'step' in dir() else '?', str(e).splitlines()[0][:120], now.replace('\n', ' '), calls[-4:] if 'calls' in dir() else []))
    finally:
        try:
            pg.evaluate("() => { localStorage.removeItem('dc_auth'); localStorage.removeItem('dc_sg_draft'); }"); pg.close()
        except Exception:
            pass
        node.terminate()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


MHZ_K = "const zf = cv.currentCSSZoom > 0 ? cv.currentCSSZoom : r.width / cv.offsetWidth;"   # 화면 px ÷ CSS px — 정확한 배율 먼저(offsetWidth 는 정수 반올림)
MHZ_TIP = """(cv) => { const c = Chart.getChart(cv), r = cv.getBoundingClientRect(), a = c.tooltip.getActiveElements(); """ + MHZ_K + """ return a.length ? Math.abs(r.left + a[0].element.x * zf - window.__mx) : null; }"""
MHZ_GEO = """(cv) => { const c = Chart.getChart(cv), r = cv.getBoundingClientRect(); """ + MHZ_K + """ return { L: r.left + c.chartArea.left * zf, R: r.left + c.chartArea.right * zf, T: r.top + c.chartArea.top * zf, B: r.top + c.chartArea.bottom * zf, n: c.data.labels.length }; }"""
MHZ_DATE = """([cv, px]) => { const c = Chart.getChart(cv), r = cv.getBoundingClientRect(); """ + MHZ_K + """ const i = Math.round(c.scales.x.getValueForPixel((px - r.left) / zf)); return c.data.labels[Math.max(0, Math.min(c.data.labels.length - 1, i))]; }"""


def mh_zoom_check(pg, base, path, fail):
    """무한매수법 기록·72루틴 화면 '글자 크기'(뿌리 요소 CSS zoom) 130% 에서 마우스 정확도 (2026-10-19 — 툴팁 최대 118px·크게 보기 307px 어긋남 · ⋮ 메뉴가 단추에서 떨어져 뜸 · 크게 보기 휠 중심·끌어 고르기 어긋남)
       그래프 툴팁 점 = 마우스 아래(브라우저가 받은 좌표로 견줌) · ⋮ 메뉴 = 단추 바로 아래 · 72루틴 크게 보기: 툴팁 · 휠 확대·축소(여러 자리·이어서) 뒤 마우스 아래 날짜 그대로 · 끌어 고른 구간 = 끈 자리의 날짜 · 고르기 상자 = 마우스 자리 (크게 보기 마우스 자리는 정수 px — 2026-10-21)"""
    where, t72 = ('t72' if path.startswith('72') else 'muhan'), path.startswith('72')
    keys = ['r72-store', 'r72-fontScale'] if t72 else ['muhan4-store', 'muhan4-fontScale']
    vp0 = pg.viewport_size; pg.set_viewport_size({'width': 1280, 'height': 900})   # 마우스를 쓰는 PC 폭 — 앞 검사가 바꿔 둔 폭(휴대폰 430 등)과 무관하게 · 끝나면 되돌림
    pg.goto(base + path, wait_until='load'); pg.evaluate("(ks) => ks.forEach(k => localStorage.removeItem(k))", keys)
    pg.goto('about:blank'); pg.goto(base + path, wait_until='load'); pg.wait_for_timeout(1500)
    pg.evaluate("(t72) => { window.__D = t72 ? window.T72debug : window.MHdebug; window.__M = __D.MH; document.addEventListener('mousemove', e => { window.__mx = e.clientX; }, true); }", t72)
    try:
        def start(cap):
            if pg.locator('[data-in="su:cap"]').count():
                pg.fill('[data-in="su:cap"]', cap); pg.wait_for_timeout(100); pg.click('[data-act="su-start"]')
        start('20000')
        pg.wait_for_function("() => __M.market && Object.values(__M.market).some(m => m && m.prices && m.prices.length) && !__M.loading", timeout=90000)
        pg.wait_for_function("() => { const c = document.querySelector('canvas[data-chart=close]'); return c && Chart.getChart(c); }", timeout=60000)
        pg.evaluate("() => { __M.menu = true; __D.render(); }"); pg.wait_for_timeout(100)   # 세션 탭(⋮)은 세션 2개부터
        pg.click('.mh-menu [data-act="ses-add"]'); pg.wait_for_timeout(300); start('10000'); pg.wait_for_timeout(2500)
        pg.evaluate("() => { __M.menu = false; __M.fontScale = 1.3; __D.render(); }"); pg.wait_for_timeout(800)
        if pg.evaluate("() => document.querySelector('#mh-root, #t7-root').style.zoom") != '1.3':
            fail(where, '글자 크기 130% 가 뿌리 요소 zoom 으로 걸리지 않음 — 이 검사의 전제가 바뀜'); return

        def tips(sel, name):
            cv = pg.locator(sel).first; cv.evaluate("e => e.scrollIntoView({ block: 'center' })"); pg.wait_for_timeout(200)   # 화면 가운데로 — 아래 가장자리의 떠 있는 단추에 가리지 않게
            h = cv.element_handle(); g = pg.evaluate(MHZ_GEO, h); y = (g['T'] + g['B']) / 2; step = (g['R'] - g['L']) / max(1, g['n'] - 1); gaps = []
            for f in (0.05, 0.5, 0.95):
                x = g['L'] + (g['R'] - g['L']) * f
                if not pg.evaluate("([cv, x, y]) => document.elementFromPoint(x, y) === cv", [h, x, y]):
                    fail(where, '글자 크기 130%%: %s 의 %d%% 지점이 다른 요소에 가려짐 — 검사 자리 확인 필요' % (name, f * 100)); gaps.append(-1); continue
                pg.mouse.move(x, y); pg.wait_for_timeout(80); gaps.append(pg.evaluate(MHZ_TIP, h))
            pg.mouse.move(2, 2)
            if -1 in gaps: return h, g, y
            if not all(v is not None and v <= step / 2 + 0.05 for v in gaps):
                fail(where, '글자 크기 130%%: %s 툴팁 점이 마우스 아래가 아님 (차이 %s px · 한 칸 %.2f px)' % (name, [None if v is None else round(v, 2) for v in gaps], step))
            return h, g, y
        tips('canvas[data-chart=close]', '종가 그래프')
        sm = pg.locator('[data-act="ses-menu"]').first; sm.scroll_into_view_if_needed(); bb = sm.bounding_box(); sm.click(); pg.wait_for_timeout(200)
        pb = pg.locator('.mh-pop').bounding_box(); bot = bb['y'] + bb['height']
        if not pb or not (bot - 1 <= pb['y'] <= bot + 10) or abs(pb['x'] - bb['x']) > 2:
            fail(where, '글자 크기 130%%: ⋮ 세션 메뉴가 단추 바로 아래가 아님 (단추 아래 %.1f · 왼쪽 %.1f → 메뉴 %s)' % (bot, bb['x'], pb and (round(pb['y'], 1), round(pb['x'], 1))))
        pg.click('.mh-overlay'); pg.wait_for_timeout(150)
        if t72:
            ob = pg.locator('[data-act="btz-open"]').first; ob.scroll_into_view_if_needed(); ob.click()
            pg.wait_for_function("() => { const c = document.querySelector('canvas[data-chart=btz]'); return c && Chart.getChart(c); }", timeout=60000); pg.wait_for_timeout(500)
            h, g, y = tips('canvas[data-chart=btz]', '크게 보기 그래프')
            # 마우스 자리는 정수 px — 실제 마우스·휠 사건의 clientX 는 정수라(브라우저가 반올림) 소수 자리로 재면 눈금 사이 절반에서 어느 날인지 갈림
            # 휠: 여러 자리에서 확대·축소를 이어서 — 마우스 아래 날이 그대로 (구간이 자료 끝에 닿은 경우는 맞출 수 없어 뺌 · 2026-10-21 예전 코드는 0.05·0.2 자리에서 2~4주 어긋남)
            y = round(y)
            for fr, dy in ((0.05, -400), (0.2, -400), (0.8, -400), (0.5, 250), (0.33, -300), (0.93, 150)):
                if dy == -400:   # 전체에서 새로 확대 (나머지는 앞 상태에서 이어서 확대·축소)
                    pg.evaluate("() => { const b = document.querySelector('[data-act=\"btz-per\"][data-v=\"0\"]'); if (b) b.click(); }"); pg.wait_for_timeout(400)
                h = pg.locator('canvas[data-chart=btz]').first.element_handle(); g = pg.evaluate(MHZ_GEO, h)
                x = round(g['L'] + (g['R'] - g['L']) * fr); pg.mouse.move(x, y); pg.wait_for_timeout(60)
                d0 = pg.evaluate(MHZ_DATE, [h, x]); pg.mouse.wheel(0, dy); pg.wait_for_timeout(500)
                d1 = pg.evaluate(MHZ_DATE, [pg.locator('canvas[data-chart=btz]').first.element_handle(), x])
                st = pg.evaluate("() => { const B = T72debug.btz; return [B.a, B.b, B.W ? B.W.d.length : 0]; }")
                if d0 != d1 and not (st[0] <= 0 or st[1] >= st[2] - 1):
                    fail(where, '글자 크기 130%%: 크게 보기 휠 %s 뒤 마우스 아래 날짜가 바뀜 (%d%% 자리 %s → %s)' % ('확대' if dy < 0 else '축소', fr * 100, d0, d1))
            pg.evaluate("() => { const b = document.querySelector('[data-act=\"btz-per\"][data-v=\"0\"]'); if (b) b.click(); }"); pg.wait_for_timeout(500)
            h = pg.locator('canvas[data-chart=btz]').first.element_handle(); g = pg.evaluate(MHZ_GEO, h)
            x0, x1 = round(g['L'] + (g['R'] - g['L']) * 0.3), round(g['L'] + (g['R'] - g['L']) * 0.7)
            want = [pg.evaluate(MHZ_DATE, [h, x0]), pg.evaluate(MHZ_DATE, [h, x1])]
            pg.mouse.move(x0, y); pg.mouse.down()
            for i in range(1, 11):
                pg.mouse.move(x0 + (x1 - x0) * i / 10, y); pg.wait_for_timeout(15)
            sb = pg.locator('.mh-btz-sel').bounding_box(); pg.mouse.up(); pg.wait_for_timeout(600)
            got = pg.evaluate("(cv) => { const c = Chart.getChart(cv); return [c.data.labels[0], c.data.labels[c.data.labels.length - 1]]; }", pg.locator('canvas[data-chart=btz]').first.element_handle())
            if got != want or not sb or abs(sb['x'] - x0) > 2 or abs(sb['x'] + sb['width'] - x1) > 2:
                fail(where, '글자 크기 130%%: 크게 보기 끌어 고르기 어긋남 (끈 자리 %s → 고른 구간 %s · 상자 %s · 마우스 %s)' % (want, got, sb and [round(sb['x'], 1), round(sb['x'] + sb['width'], 1)], [round(x0, 1), round(x1, 1)]))
    finally:
        pg.evaluate("(ks) => { try { if (window.__M) { __M.fontScale = 1; __M.sheet = null; } } catch (e) {} ks.forEach(k => localStorage.removeItem(k)); }", keys)
        pg.goto('about:blank')
        if vp0: pg.set_viewport_size(vp0)


APR_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), $ = q => document.querySelector(q), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info });
  for (let i = 0; i < 160 && !(window.APdebug && APdebug.S.rows && document.querySelector('#ap-body tr.dv-row')); i++) await W(250);
  if (!window.APdebug || !APdebug.S.rows) return [{ name: '자료를 불러오지 못함', ok: false }];
  const S = APdebug.S, all = S.rows, N = all.length, PER = 50;
  const ord = a => a.slice().sort((x, y) => y.p - x.p || (y.d < x.d ? -1 : y.d > x.d ? 1 : 0)).slice(0, PER).map(r => r.k);   // 실거래가순 첫 쪽 (같은 금액은 최근 계약 먼저)
  const want = (lo, hi, sido, q) => { q = (q || '').toLowerCase().replace(/\\s+/g, ''); return all.filter(r => (lo == null || r.p >= lo) && (hi == null || r.p <= hi) && (!sido || r.sido === sido) && (!q || r.s.indexOf(q) >= 0)); };
  const shown = () => [...document.querySelectorAll('#ap-body tr.dv-row')].map(t => t.getAttribute('data-k'));
  const cnt = () => { const m = /\\/\\s*([\\d,]+)단지/.exec(($('#ap-pager .dv-pg-info') || {}).textContent || ''); return m ? +m[1].replace(/,/g, '') : shown().length; };
  const note = () => $('#ap-pr-note').hidden ? '' : $('#ap-pr-txt').textContent;
  const put = async (a, b, how) => { $('#ap-pmin').value = a; $('#ap-pmax').value = b; $(how === 'input' ? '#ap-pmin' : '#ap-pmax').dispatchEvent(new Event(how || 'change', { bubbles: true })); await W(how === 'input' ? 600 : 120); };
  const same = (lo, hi, sido, q) => { const w = want(lo, hi, sido, q), s = shown(), o = ord(w); return { ok: cnt() === w.length && s.length === Math.min(PER, w.length) && s.join() === o.join(), n: cnt(), w: w.length, first: s.slice(0, 3), wfirst: o.slice(0, 3) }; };
  const fmt = n => n.toLocaleString('ko-KR');
  try {
    $('#ap-search').value = ''; $('#ap-search').dispatchEvent(new Event('input', { bubbles: true })); await W(250);
    const c0 = $('#ap-chips .dv-chip[data-sido=""]'); if (c0) { c0.click(); await W(80); }
    const so = $('#page-aptrank .ap-sort [data-sort="price"]'); if (so) { so.click(); await W(80); }
    let x = await put('5', '10'); x = same(50000, 100000);
    ok('직접 입력 5억~10억 → 그 사이 단지만 · 단지 수 · 첫 쪽 순서 = 자료', x.ok && /5억원 ~ 10억원/.test(note()) && note().indexOf('전국 ' + fmt(x.w) + '개 단지') >= 0, [x, note()]);
    ok('표의 모든 줄 실거래가가 구간 안 · 순위는 전국 순위 그대로', APdebug.list().slice(0, PER).every(r => r.p >= 50000 && r.p <= 100000) && APdebug.list()[0].rank === all.filter(r => r.p > APdebug.list()[0].p).length + 1, APdebug.list()[0] && [APdebug.list()[0].p, APdebug.list()[0].rank]);
    await put('10', '5'); x = same(50000, 100000);
    ok('최소가 최대보다 크면 바꿔 적용 · 안내', x.ok && /바꿔 적용/.test(note()), [x, note()]);
    await put('', '3'); x = same(null, 30000); ok('최대만 3억 → 3억원 이하', x.ok && /3억원 이하/.test(note()), [x, note()]);
    await put('30', ''); x = same(300000, null); ok('최소만 30억 → 30억원 이상', x.ok && /30억원 이상/.test(note()), [x, note()]);
    await put('3.5', '3.5'); x = same(35000, 35000); ok('소수 3.5억 = 3억 5,000만원 정확히', x.ok && /3억 5,000만원 ~ 3억 5,000만원/.test(note()), [x, note()]);
    await put('7', '8', 'input'); x = same(70000, 80000); ok('치는 동안(input)도 잠시 뒤 적용', x.ok, x);
    const pre = $('.ap-pr-pre .dv-chip[data-pmin="15"]'); pre.click(); await W(120); x = same(150000, 300000);
    ok('빠른 단추 15~30억 → 칸에 15·30 · 단추 켜짐 · 결과', x.ok && $('#ap-pmin').value === '15' && $('#ap-pmax').value === '30' && pre.classList.contains('active'), [x, $('#ap-pmin').value, $('#ap-pmax').value]);
    pre.click(); await W(120);
    ok('같은 단추를 한 번 더 → 지움(전체)', $('#ap-pmin').value === '' && $('#ap-pmax').value === '' && cnt() === N && $('#ap-pr-note').hidden && !pre.classList.contains('active'), [cnt(), N]);
    await put('5', '10');
    const se = $('#ap-chips .dv-chip[data-sido="서울"]'), ws = want(50000, 100000, '서울');
    ok('지역 칩 숫자 = 가격 구간 안의 단지 수', se && +se.querySelector('small').textContent.replace(/,/g, '') === ws.length, se && [se.textContent, ws.length]);
    se.click(); await W(120); x = same(50000, 100000, '서울'); ok('가격 구간 + 지역(서울) 함께', x.ok, x);
    $('#ap-search').value = '래미안'; $('#ap-search').dispatchEvent(new Event('input', { bubbles: true })); await W(300);
    x = same(50000, 100000, '서울', '래미안'); ok('가격 구간 + 지역 + 검색(래미안) 함께', x.ok, x);
    $('#ap-search').value = ''; $('#ap-search').dispatchEvent(new Event('input', { bubbles: true })); await W(250);
    $('#ap-chips .dv-chip[data-sido=""]').click(); await W(80);
    $('#page-aptrank .ap-sort [data-sort="pyeong"]').click(); await W(120);
    const L = APdebug.list(); ok('정렬(평당가순)을 바꿔도 구간 유지', cnt() === want(50000, 100000).length && L.every(r => r.p >= 50000 && r.p <= 100000) && L.every((r, i) => !i || L[i - 1].py >= r.py), cnt());
    $('#page-aptrank .ap-sort [data-sort="price"]').click(); await W(80);
    await put('1000', ''); ok('맞는 단지가 없으면 안내', !shown().length && /조건에 맞는 아파트가 없습니다/.test($('#ap-body').textContent) && $('#ap-pager').hidden, $('#ap-body').textContent.slice(0, 80));
    $('#ap-pr-x').click(); await W(120);
    const se2 = $('#ap-chips .dv-chip[data-sido="서울"]');
    ok('[가격 구간 지우기] → 칸 비움 · 안내 숨김 · 전체 · 지역 칩 숫자 원래대로', $('#ap-pmin').value === '' && $('#ap-pmax').value === '' && $('#ap-pr-note').hidden && cnt() === N && +se2.querySelector('small').textContent.replace(/,/g, '') === all.filter(r => r.sido === '서울').length, [cnt(), N]);
  } catch (e) { ok('검사 중 오류', false, String(e).slice(0, 200)); }
  return R;
}"""


def apt_range_check(page, base, fail):
    """국내 나의 아파트 시세 순위 — 가격 구간(최소~최대 억 원) 필터 (2026-10-20): 화면 결과 = 자료(APdebug.S.rows)로 따로 거른 결과 · 휴대폰 폭 넘침 없음"""
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'apt-rank/', wait_until='load')
    for t in page.evaluate(APR_JS):
        if not t['ok']:
            fail('apt-rank', '가격 구간 %s%s' % (t['name'], (' — ' + str(t.get('info'))[:300]) if t.get('info') else ''))
    page.set_viewport_size({'width': 360, 'height': 780}); page.wait_for_timeout(300)
    page.evaluate("() => { const a = document.getElementById('ap-pmin'), b = document.getElementById('ap-pmax'); a.value = '12.5'; b.value = '30'; b.dispatchEvent(new Event('change', { bubbles: true })); }")
    page.wait_for_timeout(300)
    w = page.evaluate("""() => { const m = document.querySelector('#page-aptrank .dv-card').getBoundingClientRect(), bad = [...document.querySelectorAll('#page-aptrank .ap-pr *, #ap-pr-note *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > m.right + 1 || r.left < m.left - 1); }).map(e => e.id || e.className || e.tagName).slice(0, 4);
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, bad }; }""")
    if w['sw'] > w['iw'] or w['bad']:
        fail('apt-rank', '가격 구간: 휴대폰(360px)에서 칸·안내가 카드 밖으로 넘침 %s' % w)
    page.evaluate("() => { const x = document.getElementById('ap-pr-x'); if (x) x.click(); }")
    page.set_viewport_size({'width': 1440, 'height': 900})


KAKAO_STUB = """(() => {   /* 카카오 SDK 대역: 실제 카카오 서버에 보내지 않고 보낼 내용만 기록 */
  window.__ksent = []; window.__kup = 0;
  window.Kakao = { isInitialized: () => true, init: () => {},
    Share: { sendDefault: o => { window.__ksent.push(JSON.parse(JSON.stringify(o))); },
             uploadImage: () => { window.__kup++; return Promise.resolve({ infos: { original: { url: 'https://k.kakaocdn.net/dn/share-test.png' } } }); } } };
})();"""

SH_ETF_READY = ("() => window.ECXdebug && ECXdebug.S.ready && ECXdebug.S.sel.length && !Object.keys(ECXdebug.S.pend).length"
                " && !Object.keys(ECXdebug.S.distP).length && !Object.keys(ECXdebug.S.exP).length && !Object.keys(ECXdebug.S.pgP).length"
                " && !Object.keys(ECXdebug.S.btP).length && !Object.keys(ECXdebug.S.depP).length && (!ECXdebug.S.fx || ECXdebug.S.fxd)"
                " && !!(window.dcShareSpec && dcShareSpec['etf-compare'] && dcShareSpec['etf-compare'].big)")
SH_ETF_STATE = """() => { const S = ECXdebug.S, c = window.shareCard && shareCard.spec();
  return { sel: S.sel.map(s => s.k + s.c), per: S.per, fx: !!S.fx, mode: S.mode, feeK: S.feeK, hash: location.hash, search: location.search, path: location.pathname,
           notice: !!document.getElementById('dsh-notice'), spec: c && { key: c.key, chip: c.chip, title: c.title, label: c.label, big: c.big, sub: c.sub, rows: c.rows } }; }"""


def share_ctx(br, base, local):
    """공유 검사용 브라우저 묶음: 카카오 SDK 대역(보낸 내용 기록) · 로컬이면 실제 도메인을 저장소 파일로 + 가짜 Worker(로그인·저장함·ETF 합성 일봉 · 나머지 Worker 길은 빈 답)
    돌려줌: (ctx, SITE, saves{번호: 저장}, gets[읽은 번호])"""
    SITE = 'https://d-capitalism.com/' if local else base
    EPX = 'https://share-test.example.workers.dev'
    ctx = br.new_context(viewport={'width': 1280, 'height': 900}, locale='ko-KR')
    ctx.route(TRACK_RE, lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    ctx.add_init_script(KAKAO_STUB)
    saves, gets = {}, []
    if local:
        def site(route):
            u = urllib.parse.urlparse(route.request.url).path
            if u == '/data/counter.json':
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'endpoint': EPX}))
            f = os.path.join(ROOT, urllib.parse.unquote(u).lstrip('/'))
            if u.endswith('/'):
                f = os.path.join(f, 'index.html')
            if not os.path.isfile(f):
                return route.fulfill(status=404, body='')
            ct = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'}.get(os.path.splitext(f)[1])
            route.fulfill(status=200, body=open(f, 'rb').read(), **({'content_type': ct} if ct else {}))
        ctx.route(re.compile(r'^https://d-capitalism\.com/.*'), site)
        def ep(route):
            q = route.request
            pu = urllib.parse.urlparse(q.url)
            if pu.path == '/etf':
                return etf_route(route)
            hd = {'Access-Control-Allow-Origin': 'https://d-capitalism.com', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
                  'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Content-Type': 'application/json'}
            if q.method == 'OPTIONS':
                return route.fulfill(status=204, headers=hd, body='')
            body = {}
            if pu.path == '/auth/config':
                body = {'providers': {'kakao': {'client_id': 'share-test'}}, 'kakao_js': 'share-test'}
            elif pu.path == '/auth/me':
                body = {'user': {'id': 1, 'nick': '검사'}}
            elif pu.path == '/saves' and q.method == 'POST':
                d = json.loads(q.post_data or '{}'); n = 7 + len(saves)
                saves[n] = {'id': n, 'page': d.get('page'), 'title': d.get('title'), 'data': d.get('data')}
                body = {'ok': True, 'id': n}
            elif re.fullmatch(r'/saves/\d+', pu.path):
                n = int(pu.path.rsplit('/', 1)[1]); gets.append(n)
                if n not in saves:
                    return route.fulfill(status=404, headers=hd, body='{"error":"not found"}')
                body = {'save': saves[n]}
            route.fulfill(status=200, headers=hd, body=json.dumps(body))
        ctx.route(re.compile(r'^https://share-test\.example\.workers\.dev/.*'), ep)
        ctx.route(re.compile(r'.*/data/etfdist/\d\.json.*'), etf_dist_route)
        ctx.route(re.compile(r'.*/data/etfbt/.*\.json.*'), etf_bt_route)
        ctx.route(re.compile(r'.*allorigins\.win/.*'), lambda r: r.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, body=''))
    return ctx, SITE, saves, gets


def share_hash_check(br, base, local, fail):
    """[SHARE] 공유 링크·내 저장함이 주소 # 의 화면 상태(ETF 차트 비교 #e=…&p=… 등)까지 담는지 (2026-10-20 — 전에는 기본값으로 열림)
    · ETF 차트 비교 결과 카드(dcShareSpec) = 화면 표의 수익률 · 카카오톡 공유의 [결과 보기] 링크 = …/?s=입력값&hs=화면상태 (카카오가 # 뒤를 버려도 열리게)
    · 그 링크로 열면 머리 [SHARE-ARRIVE] 가 ?hs= 를 # 로 → 같은 ETF·기간·보기·수수료·결과 카드 + '공유받은 계산 결과' 안내
    · 내 저장함: 저장 자료에 h(화면 상태) · ?load=번호 로 열면 한 번 다시 열어(hz=1) 그 상태로 · 화면이 # 를 고쳐 써도 되풀이 없음 · h 없는 예전 저장도 그대로
    로컬: 실제 도메인을 저장소 파일로 흉내 + 가짜 Worker(로그인·저장함·ETF 합성 일봉) · 배포: ?hs= 링크로 여는 것과 카카오 링크만 (저장함은 실제 계정이 필요해 로컬에서만)"""
    ctx, SITE, saves, gets = share_ctx(br, base, local)
    F = lambda m: fail('share-state', m)
    perr = []
    def newpage():
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: perr.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept('ETF 비교 저장 검사') if d.type == 'prompt' else d.accept())
        return pg
    def etf_wait(pg, what):
        try:
            pg.wait_for_function(SH_ETF_READY, timeout=60000)
            return pg.evaluate(SH_ETF_STATE)
        except Exception as ex:
            F('%s: ETF 차트 비교 결과가 준비되지 않음 (%s)' % (what, str(ex)[:160])); return None
    def kakao_send(pg, what):
        """공유 버튼 → 창(카드 미리보기·카카오에 카드 올리기 끝날 때까지) → 카카오톡 공유 → 보낸 내용"""
        pg.click('.dsh-fab')
        try:
            pg.wait_for_function("() => window.__kup > 0", timeout=20000)
        except Exception:
            F('%s: 공유 창을 열어도 결과 카드를 카카오에 올리지 않음' % what)
        pg.wait_for_timeout(400)
        pg.click('#dsh-pop [data-a="kakao"]')
        pg.wait_for_timeout(200)
        s = pg.evaluate("() => window.__ksent.slice(-1)[0] || null")
        pg.keyboard.press('Escape')
        if not s:
            F('%s: 카카오톡 공유를 눌러도 보낸 것이 없음' % what)
        return s
    def link_of(s):
        return ((s or {}).get('content') or {}).get('link', {}).get('webUrl', '')
    def hs_of(u):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
        return (q.get('hs') or [''])[0], (q.get('s') or [''])[0]

    # ① ETF 차트 비교: 기본과 다른 상태(종목 3개·1년·원화 환산·기준가·국내 수수료 0.02%)
    H0 = 'e=K069500,USPY,UQQQ&p=1Y&fx=1&m=nav&fk=0.02'
    pg = newpage()
    pg.goto(SITE + 'etf-compare/#' + H0, wait_until='load')
    a = etf_wait(pg, '① 상태 주소로 열기')
    if a:
        if a['hash'] != '#' + H0:
            F('① 화면이 주소 # 를 다르게 고쳐 씀: %s (기대 #%s)' % (a['hash'], H0))
        c = a['spec'] or {}
        if c.get('key') != 'etf-compare' or c.get('chip') != 'ETF 차트 비교':
            F('① 결과 카드가 ETF 차트 비교 카드가 아님: %s' % c)
        else:
            if not c.get('title', '').count(' vs ') == 2:
                F('① 카드 제목에 고른 ETF 3개가 없음: %s' % c.get('title'))
            lab = c.get('label', '')
            if '1년' not in lab and '1Y' not in lab:
                F('① 카드 설명에 기간(1년)이 없음: %s' % lab)
            if '기준가' not in lab or '원화 환산' not in lab:
                F('① 카드 설명에 보기(기준가)·원화 환산이 없음: %s' % lab)
            rows = c.get('rows') or []
            if len(rows) != 3:
                F('① 카드 줄이 ETF 3개가 아님: %s' % rows)
            else:
                nums = [float(re.match(r'[+\-−]?[\d,.]+', r[1].replace('−', '-')).group(0).replace(',', '')) for r in rows]
                if nums != sorted(nums, reverse=True):
                    F('① 카드 줄이 수익률 높은 순이 아님: %s' % rows)
                if not c.get('big') or c['big'] != rows[0][1].split(' · ')[0]:
                    F('① 카드 큰 숫자 ≠ 최고 수익률 줄: %s · %s' % (c.get('big'), rows[0]))
                if rows[0][0] not in (c.get('sub') or ''):
                    F('① 카드 아래 설명에 최고 ETF 이름이 없음: %s' % c.get('sub'))
            # 카드 숫자 = 화면 표 숫자 (표의 이름·기간 수익률 칸)
            tbl = pg.evaluate("""() => [...document.querySelectorAll('#page-etfcmp table tbody tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean)""")
            for r in rows:
                if not any(r[0] in t and r[1].split(' · ')[0] in t for t in tbl):
                    F('① 카드 줄(%s %s)이 화면 표에 없음: %s' % (r[0], r[1], tbl[:4])); break
        s = kakao_send(pg, '① 카카오톡 공유')
        u = link_of(s)
        hs, sv = hs_of(u)
        if not u.startswith(SITE + 'etf-compare/?') or hs != H0:
            F('① 카카오 [결과 보기] 링크에 화면 상태(hs=)가 없거나 다름: %s' % u[:200])
        if s:
            btn = [b for b in s.get('buttons') or [] if b.get('title') == '결과 보기']
            if not btn or btn[0]['link']['webUrl'] != u:
                F('① 카카오 [결과 보기] 버튼이 없거나 링크가 다름: %s' % s.get('buttons'))
            ct = s.get('content') or {}
            if ct.get('imageUrl') != 'https://k.kakaocdn.net/dn/share-test.png' or ct.get('imageWidth') != 1080 or ct.get('imageHeight') != 1350:
                F('① 카카오 메시지 이미지가 결과 카드가 아님: %s %sx%s' % (ct.get('imageUrl'), ct.get('imageWidth'), ct.get('imageHeight')))
            if c.get('big') and c['big'] not in ct.get('title', ''):
                F('① 카카오 메시지 제목에 결과 숫자가 없음: %s' % ct.get('title'))
            if '#' in u:
                F('① 링크에 # 가 남음(카카오가 버릴 수 있음): %s' % u[:200])
        # ② 받은 사람: 그 링크(# 없음)로 열기 → 같은 상태·같은 카드·안내
        if u:
            pg2 = newpage()
            pg2.goto(u, wait_until='load')
            b = etf_wait(pg2, '② 받은 링크로 열기')
            if b:
                if b['hash'] != '#' + H0 or 'hs=' in b['search'] or 's=' in b['search']:
                    F('② 받은 링크로 연 주소가 상태 # 로 바뀌지 않음: %s%s' % (b['search'], b['hash']))
                if b['sel'] != ['K069500', 'USPY', 'UQQQ'] or b['per'] != '1Y' or not b['fx'] or b['mode'] != 'nav' or abs(b['feeK'] - 0.02) > 1e-12:
                    F('② 받은 쪽 화면 상태가 보낸 쪽과 다름: %s' % {k: b[k] for k in ('sel', 'per', 'fx', 'mode', 'feeK')})
                if not b['notice']:
                    F('② 공유받은 결과 안내가 없음')
                if (b['spec'] or {}) != c:
                    F('② 받은 쪽 결과 카드가 보낸 쪽과 다름: %s ≠ %s' % ((b['spec'] or {}).get('big'), c.get('big')))
            pg2.close()
        # ②-1 카카오가 # 를 지키는 경우(# 와 ?hs= 둘 다) · 잘못된 hs(= 없음)는 무시하고 원래 # 그대로
        pg3 = newpage()
        pg3.goto(SITE + 'etf-compare/?hs=' + urllib.parse.quote('e=USPY&p=MAX') + '#' + H0, wait_until='load')
        b = etf_wait(pg3, '②-1 # 와 hs 함께')
        if b and (b['sel'] != ['USPY'] or b['per'] != 'MAX'):
            F('②-1 hs= 가 # 보다 먼저여야 함: %s %s' % (b['sel'], b['per']))
        pg3.goto(SITE + 'etf-compare/?hs=garbage#' + H0, wait_until='load')
        b = etf_wait(pg3, '②-1 잘못된 hs')
        if b and (b['sel'] != ['K069500', 'USPY', 'UQQQ'] or 'hs=' in b['search']):
            F('②-1 잘못된 hs= 가 원래 # 를 망치거나 주소에 남음: %s %s' % (b['sel'], b['search']))
        pg3.close()
        # ③ 내 저장함 (로컬만): 저장 → 다른 상태로 바꾼 뒤 ?load=번호 로 열기
        if local:
            pg.evaluate("() => localStorage.setItem('dc_auth', JSON.stringify({ token: 'share.test', exp: Math.floor(Date.now() / 1000) + 3600, user: { id: 1, nick: '검사' } }))")
            pg.goto(SITE + 'etf-compare/#' + H0, wait_until='load')
            etf_wait(pg, '③ 저장 전')
            try:
                pg.wait_for_selector('#dca-save', timeout=15000)
                pg.click('#dca-save')
                pg.wait_for_function("() => /내 저장함에 저장/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=10000)
            except Exception as ex:
                F('③ 저장 버튼으로 저장하지 못함: %s' % str(ex)[:160])
            sv1 = saves.get(7)
            if not sv1 or sv1['page'] != 'etf-compare' or (sv1['data'] or {}).get('h') != H0:
                F('③ 저장 자료에 화면 상태(h)가 없음: %s' % json.dumps(sv1, ensure_ascii=False)[:300])
            else:
                pg.goto(SITE + 'etf-compare/#e=K360750&p=MAX', wait_until='load')   # 다른 상태로 바꿔 둠 (그대로 남아 있어 통과하는 일이 없게)
                etf_wait(pg, '③ 다른 상태')
                del gets[:]
                pg.goto(SITE + 'etf-compare/?load=7', wait_until='load')
                pg.wait_for_function("() => /불러옴/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=30000)
                b = etf_wait(pg, '③ 내 저장함에서 열기')
                pg.wait_for_timeout(2500)
                if b:
                    b = pg.evaluate(SH_ETF_STATE)
                    if b['sel'] != ['K069500', 'USPY', 'UQQQ'] or b['per'] != '1Y' or not b['fx'] or b['mode'] != 'nav' or abs(b['feeK'] - 0.02) > 1e-12:
                        F('③ 내 저장함에서 연 화면이 저장한 상태가 아님: %s' % {k: b[k] for k in ('sel', 'per', 'fx', 'mode', 'feeK')})
                    if b['search'] or b['hash'] != '#' + H0:
                        F('③ 불러온 뒤 주소 정리 안 됨: %s%s' % (b['search'], b['hash']))
                    if b['notice']:
                        F('③ 내 저장함에서 열었는데 \'공유받은 결과\' 안내가 뜸')
                    if (b['spec'] or {}) != c:
                        F('③ 내 저장함에서 연 결과 카드가 저장할 때와 다름: %s ≠ %s' % ((b['spec'] or {}).get('big'), c.get('big')))
                if gets != [7, 7]:
                    F('③ 저장 자료를 두 번(처음 · 상태 주소로 다시 연 뒤) 읽어야 함: %s' % gets)
                # ③-1 화면이 # 를 고쳐 쓰는 저장(소문자) → 한 번만 다시 열고 멈춤 · 상태는 맞게
                saves[8] = {'id': 8, 'page': 'etf-compare', 'title': '소문자', 'data': {'v': {}, 'g': {}, 'u': {}, 'h': 'e=k069500,uspy&p=1y&m=nav'}}
                del gets[:]
                pg.goto(SITE + 'etf-compare/?load=8', wait_until='load')
                pg.wait_for_function("() => /불러옴/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=30000)
                b = etf_wait(pg, '③-1 고쳐 쓰는 #')
                pg.wait_for_timeout(2500)
                if b and (b['sel'] != ['K069500', 'USPY'] or b['per'] != '1Y' or b['mode'] != 'nav'):
                    F('③-1 고쳐 쓰는 # 저장의 상태가 다름: %s' % {k: b[k] for k in ('sel', 'per', 'mode')})
                if gets != [8, 8]:
                    F('③-1 다시 열기가 한 번에서 멈추지 않음(또는 안 함): %s' % gets)
                # ③-2 예전 저장(h 없음): 다시 열지 않고 입력값만
                saves[9] = {'id': 9, 'page': 'etf-compare', 'title': '예전', 'data': {'v': {}, 'g': {}, 'u': {}}}
                del gets[:]
                pg.goto(SITE + 'etf-compare/?load=9', wait_until='load')
                pg.wait_for_function("() => /불러옴/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=30000)
                pg.wait_for_timeout(1500)
                if gets != [9] or 'load=' in pg.url:
                    F('③-2 h 없는 예전 저장을 다시 열거나 주소를 정리하지 않음: %s %s' % (gets, pg.url))
    pg.close()
    # ④ 다른 # 상태 화면도 같은 방법으로 (직업 수명 #job=)
    if os.path.isdir(os.path.join(ROOT, 'job-life')):
        pg = newpage()
        pg.goto(SITE + 'job-life/#job=' + urllib.parse.quote('간호사'), wait_until='load'); pg.wait_for_timeout(2500)
        s = kakao_send(pg, '④ 직업 수명 공유') if pg.locator('.dsh-fab').count() else None
        hs, _ = hs_of(link_of(s))
        if hs != 'job=' + urllib.parse.quote('간호사'):
            F('④ 직업 수명 공유 링크에 #job= 상태가 없음: %s' % link_of(s)[:200])
        else:
            pg.goto(link_of(s), wait_until='load'); pg.wait_for_timeout(2500)
            j = pg.evaluate("() => ({ q: (document.getElementById('jl-q') || {}).value, res: !(document.getElementById('jl-res') || { hidden: true }).hidden, hash: decodeURIComponent(location.hash), n: !!document.getElementById('dsh-notice') })")
            if j['q'] != '간호사' or not j['res'] or j['hash'] != '#job=간호사' or not j['n']:
                F('④ 받은 직업 수명 링크가 그 직업으로 열리지 않음: %s' % j)
        pg.close()
    for e in perr[:3]:
        F('페이지 오류: ' + e)
    ctx.close()


SHARE_PERTURB = r"""() => {   /* 화면 설정 바꾸기: 켜진 버튼이 하나인 선택 묶음 3개까지 다른 버튼 · 숫자 입력칸 2개까지 1.37배 */
  const pg = document.querySelector('.app-page.active'), done = [];
  const skip = e => e.closest('.dsh-pop, .dsh-fab, .dsh-notice, nav, header, footer, table, .learn-rel, .site-search, [data-share-skip], #dc-auth, .crumbs, details:not([open])');
  const on = b => b.classList.contains('active') || b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true';
  const m = new Map();
  pg.querySelectorAll('button, [role=tab]').forEach(b => { if (b.classList.contains('unit-btn') || skip(b) || !b.offsetParent || b.disabled) return; const p = b.parentElement; if (!m.has(p)) m.set(p, []); m.get(p).push(b); });
  let n = 0;
  m.forEach((bs, p) => { if (n >= 3 || bs.length < 2) return; if (bs.filter(on).length !== 1) return;
    const t = bs.filter(b => !on(b) && !/전체 보기|초기화|지우기|삭제|×|✕|닫기|갱신|↺/.test(b.textContent))[0]; if (!t) return;
    t.click(); n++; done.push((p.id || p.className) + ' → ' + t.textContent.trim().slice(0, 14)); });
  let k = 0;
  pg.querySelectorAll('input[id]').forEach(e => { if (k >= 2 || skip(e) || !e.offsetParent || e.readOnly || e.disabled || (e.type !== 'text' && e.type !== 'number')) return;
    const v = parseFloat(String(e.value).replace(/,/g, '')); if (!isFinite(v) || v <= 0) return;
    e.value = String(Math.round(v * 1.37 * 100) / 100); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); k++; done.push(e.id); });
  if (window.fcRender) try { fcRender(); } catch (er) {}
  return done;
}"""
SHARE_SNAP = r"""() => { const d = dcState.snapshot(false), sp = window.shareCard && shareCard.spec(), pg = document.querySelector('.app-page.active'), act = [];
  Object.keys(d.v || {}).forEach(k => { if (typeof d.v[k] === 'string') d.v[k] = d.v[k].replace(/,/g, '').trim(); });
  /* 켜진 버튼 목록을 dcState 와 따로 셈 (담기·되살리기 장치가 통째로 빠져도 잡히게) */
  pg.querySelectorAll('button.active, button.on, button[aria-pressed="true"], [role=tab][aria-selected="true"]').forEach(b => {
    if (!b.offsetParent || b.closest('.dsh-pop, .dsh-fab, .dsh-notice, nav, header, footer, table, #dc-auth, .crumbs')) return;
    const id = [...b.attributes].filter(x => /^data-/.test(x.name)).map(x => x.name + '=' + x.value).join(',') || b.textContent.trim().slice(0, 20);
    act.push((b.parentElement.id || b.parentElement.className) + ' > ' + id); });
  return { d: d, hash: dcState.hash(), act: act.sort(), card: sp ? { key: sp.key, title: sp.title, big: sp.big, label: sp.label, sub: sp.sub } : null, notice: !!document.getElementById('dsh-notice') }; }"""


def share_all_check(br, base, local, fail):
    """[SHARE] 모든 화면 공유 (2026-10-20 — '같은 문제가 있는 기능 전부'): 설정을 바꾼 뒤 카카오톡 공유 링크로 열면 같은 설정·같은 결과 카드
    · 버튼 묶음 2(기간 탭·통화 단위·정렬·지역 칩·세금 방식 등 .mode-btn 밖) · 화면별 고리 d.x(해외주식 종목 줄·ETF CAGR 종목·달력 고른 날·쪽)
    · 목록 검색어(data-share-keep) · 새 카드(환율·공포탐욕·가치 속도·ETF CAGR·시가총액·분배 달력·아파트 순위·실적발표·백테스트 2·국내 지수 3)
    · ETF 차트 비교 로그 눈금(lg=1 · 축·눈금·확대 되돌리기·링크) · 내 저장함이 버튼 묶음 2 를 담고 되살림"""
    ctx, SITE, saves, gets = share_ctx(br, base, local)
    F = lambda m: fail('share-all', m)
    perr = []
    def newpage():
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: perr.append(str(e)[:200]))
        pg.on('dialog', lambda d: d.accept('검사 저장') if d.type == 'prompt' else d.accept())
        return pg
    def send(pg):
        pg.click('.dsh-fab'); pg.wait_for_timeout(700)
        pg.click('#dsh-pop [data-a="kakao"]'); pg.wait_for_timeout(200)
        s = pg.evaluate("() => window.__ksent.slice(-1)[0] || null")
        pg.keyboard.press('Escape')
        return ((s or {}).get('content') or {}).get('link', {}).get('webUrl', '')
    def cmp(name, a, b, card=True, big=True):
        bad = []
        for k in ('v', 'g', 'u', 't'):
            A, B = a['d'].get(k) or {}, b['d'].get(k) or {}
            bad += ['%s.%s %r→%r' % (k, x, A.get(x), B.get(x)) for x in sorted(set(A) | set(B)) if A.get(x) != B.get(x)]
        if json.dumps(a['d'].get('x'), sort_keys=True) != json.dumps(b['d'].get('x'), sort_keys=True):
            bad.append('x %s→%s' % (json.dumps(a['d'].get('x'), ensure_ascii=False)[:120], json.dumps(b['d'].get('x'), ensure_ascii=False)[:120]))
        if a['hash'] != b['hash']:
            bad.append('# %s→%s' % (a['hash'], b['hash']))
        if a['act'] != b['act']:
            bad.append('켜진 버튼 %s → %s' % (sorted(set(a['act']) - set(b['act']))[:3], sorted(set(b['act']) - set(a['act']))[:3]))
        if card:
            ca, cb = a['card'] or {}, b['card'] or {}
            if not ca.get('big'):
                bad.append('보낸 쪽 결과 카드 없음')
            elif ca.get('title') != cb.get('title') or (big and ca.get('big') != cb.get('big')) or (not big and (ca.get('sub') or '').split(' (')[0] != (cb.get('sub') or '').split(' (')[0]):
                bad.append('카드 %s|%s|%s → %s|%s|%s' % (ca.get('title'), ca.get('big'), (ca.get('sub') or '')[:20], cb.get('title'), cb.get('big'), (cb.get('sub') or '')[:20]))
        if not b['notice']:
            bad.append('공유받은 결과 안내 없음')
        for m in bad[:4]:
            F('%s: 공유 링크로 연 화면이 다름 — %s' % (name, m))
    def trip(path, prep, name, wait=3000, wait2=None, card=True, big=True, need_change=True):
        """열기 → prep(설정 바꾸기) → 카카오 링크 → 새 창으로 열기 → 같은지"""
        pg = newpage()
        try:
            pg.goto(SITE + path, wait_until='load'); pg.wait_for_timeout(wait)
            did = prep(pg)
            pg.wait_for_timeout(1500)
            a = pg.evaluate(SHARE_SNAP)
            u = send(pg)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)
            if need_change and not q.get('s') and not q.get('hs'):
                F('%s: 설정을 바꿨는데 공유 링크에 설정값(s=·hs=)이 없음 (%s · %s)' % (name, u[:120], did))
            pg2 = newpage()
            pg2.goto(u, wait_until='load'); pg2.wait_for_timeout(wait2 or wait + 2000)
            b = pg2.evaluate(SHARE_SNAP)
            cmp(name, a, b, card, big)
            pg2.close()
            return a, b
        except Exception as ex:
            F('%s: 검사 실행 실패 %s' % (name, str(ex)[:160]))
        finally:
            pg.close()
    # ① 일반 화면: 아무 선택 묶음·숫자 칸이나 바꿔도 그대로 (환율 단위·차트 탭·세금 방식·지수 기간 탭 등)
    for path in ('fx/', 'kodex/', 'dividend-calculator/', 'compound/', 'nasdaq/'):
        trip(path, lambda pg: pg.evaluate(SHARE_PERTURB), path, big=path != 'nasdaq/')   # 지수 화면은 현재 지수를 바깥에서 받아 두 번 연 값이 다를 수 있음
    # 국내 지수 3개: 결과 카드(전에는 없었음)
    for path in ('kospi/', 'kospi200/', 'kosdaq/'):
        pg = newpage(); pg.goto(SITE + path, wait_until='load'); pg.wait_for_timeout(3000)
        c = pg.evaluate("() => { const s = shareCard.spec(); return s && [s.big, s.label]; }")
        if not c or '%' not in c[0] or 'CAGR' not in (c[1] or ''):
            F('%s: 연평균 성장률 결과 카드가 없음 %s' % (path, c))
        pg.close()
    # ② 해외주식 양도세: 종목 줄(id 없는 칸) — 줄 추가·값까지
    def ost(pg):
        pg.click('#ost-add'); pg.wait_for_timeout(200)
        return pg.evaluate("""() => { const r = [...document.querySelectorAll('#ost-rows .ost-row')].pop(), v = { buy: '5,000', buyfx: '1,350', sell: '7,500', sellfx: '1,420', fee: '7' };
          r.querySelector('.ost-name').value = 'TSLA'; Object.keys(v).forEach(k => { const e = r.querySelector('[data-k="' + k + '"]'); e.value = v[k]; e.dispatchEvent(new Event('input', { bubbles: true })); }); fcRender(); return document.querySelectorAll('#ost-rows .ost-row').length; }""")
    r = trip('stocktax/', ost, '해외주식 양도세 종목 줄')
    if r and (not isinstance(r[1]['d'].get('x'), list) or len(r[1]['d']['x']) < 2 or r[1]['d']['x'][-1][0] != 'TSLA'):
        F('해외주식 양도세: 받은 쪽 종목 줄이 다름 %s' % json.dumps(r[1]['d'].get('x'), ensure_ascii=False)[:200])
    # ③ ETF CAGR: 고른 종목(칩 — 꺼짐 표시가 class off 라 화면별 고리) · 기간설정 날짜 · 분배금 포함
    def ec(pg):
        pg.wait_for_function("() => window.dcShareSpec && dcShareSpec.etfcagr && dcShareSpec.etfcagr()", timeout=30000)
        pg.evaluate("() => { ecToggle('QLD'); ecToggle('TQQQ'); ecSetMode(true); document.getElementById('ec-from').value = '2015-01-02'; document.getElementById('ec-to').value = '2024-12-31'; ecSetPeriod('CUSTOM'); }")
        return 'ec'
    r = trip('etfcagr/', ec, 'ETF CAGR 고른 종목·기간설정', wait=2500)
    if r:
        x = r[1]['d'].get('x') or {}
        if 'QLD' in (x.get('on') or ['QLD']) or x.get('p') != 'CUSTOM' or not x.get('tot'):
            F('ETF CAGR: 받은 쪽 종목·기간·분배금 포함이 다름 %s' % json.dumps(x)[:200])
        if '기간설정' not in (r[1]['card'] or {}).get('label', '') or '분배금 재투자' not in (r[1]['card'] or {}).get('label', ''):
            F('ETF CAGR: 카드 설명에 기간설정·분배금 재투자가 없음 %s' % (r[1]['card'] or {}).get('label'))
    # ④ 목록 화면: 칩·정렬·검색어·고른 날·쪽
    def mc(pg):
        pg.wait_for_function("() => document.querySelectorAll('#mc-chips .mc-chip').length > 2", timeout=20000)
        pg.click('#mc-chips .mc-chip[data-cty="United States"]'); pg.click('#page-mcap .mc-sort .chart-tab[data-sort="up"]')
        pg.fill('#mc-search', 'a'); return 'mc'
    r = trip('marketcap/', mc, '시가총액 나라·정렬·검색')
    if r and (r[1]['card'] or {}).get('title', '').find('미국 시가총액 상승률 순 · “a”') < 0:
        F('시가총액: 카드 제목에 나라·정렬·검색어가 없음 %s' % (r[1]['card'] or {}).get('title'))
    def dv(pg):
        pg.wait_for_function("() => document.querySelectorAll('#dv-chips .dv-chip').length > 2 && document.querySelector('#dv-cal .dv-day[data-day]')", timeout=20000)
        pg.click('#page-etfdiv .dv-sort .chart-tab[data-sort="ttm"]')
        pg.locator('#dv-chips .dv-chip').nth(1).click()
        return pg.evaluate("() => { const d = [...document.querySelectorAll('#dv-cal .dv-day[data-day]')].filter(b => b.querySelector('.dv-ev'))[0]; if (d) d.click(); return d && d.getAttribute('data-day'); }")
    r = trip('dividend-calendar/', dv, '분배 달력 정렬·운용사·고른 날')
    if r and not (r[1]['d'].get('x') or {}).get('d'):
        F('분배 달력: 받은 쪽에 달력에서 고른 날이 없음 %s' % r[1]['d'].get('x'))
    def ap(pg):
        pg.wait_for_function("() => document.querySelectorAll('#ap-chips .dv-chip').length > 2", timeout=20000)
        pg.click('#ap-chips .dv-chip[data-sido="서울"]'); pg.click('#page-aptrank .ap-sort .chart-tab[data-sort="pyeong"]')
        pg.fill('#ap-pmin', '10'); pg.dispatch_event('#ap-pmin', 'change'); pg.fill('#ap-search', '래미안'); pg.wait_for_timeout(500); return 'ap'
    r = trip('apt-rank/', ap, '아파트 순위 지역·정렬·가격·검색')
    if r and (r[1]['card'] or {}).get('title') != '서울 아파트 시세 순위 · 10억원 이상 · “래미안”':
        F('아파트 순위: 카드 제목에 지역·가격 구간·검색어가 없음 %s' % (r[1]['card'] or {}).get('title'))
    def er(pg):
        pg.wait_for_function("() => window.ERdebug && ERdebug.S.d && document.querySelector('#er-cal .er-day[data-d]')", timeout=20000)
        pg.locator('#page-earn .er-mk .chart-tab[data-mk="us"]').first.click(); pg.click('#page-earn .er-sort .er-chip[data-sort="cap"]')
        return pg.evaluate("() => { const d = [...document.querySelectorAll('#er-cal .er-day[data-d]')].filter(b => b.querySelector('.er-ev'))[0]; if (d) d.click(); return d && d.getAttribute('data-d'); }")
    r = trip('earnings-calendar/', er, '실적발표 시장·정렬·고른 날')
    if r and not (r[1]['d'].get('x') or {}).get('sel'):
        F('실적발표: 받은 쪽에 달력에서 고른 날이 없음 %s' % r[1]['d'].get('x'))
    def co(pg):
        pg.wait_for_function("() => window.ERdebug && ERdebug.S.d", timeout=20000)
        return pg.evaluate("() => { const k = ERdebug.listRows()[0].r.key; ERdebug.openCo(k, true); return k; }")
    r = trip('earnings-calendar/', co, '실적발표 기업 상세(#co=)')
    if r and not (r[1]['card'] or {}).get('title', '').endswith('실적발표'):
        F('실적발표 기업 상세: 받은 쪽 카드가 그 기업이 아님 %s' % r[1]['card'])
    # ⑤ 백테스트 2: 실행 → 결과 카드 · 링크로 열면 같은 결과 (#v= · #ty=)
    for path, nm in (('muhan-backtest/', '무한매수법 백테스트'), ('vr-backtest/', 'VR 백테스트')):
        def bt(pg):
            pg.wait_for_selector('.mb-run:not([disabled])', timeout=30000); pg.click('.mb-run')
            pg.wait_for_function("() => { const s = shareCard.spec(); return s && s.big; }", timeout=90000); return 'run'
        trip(path, bt, nm, wait=2500, wait2=25000)
    # ⑥ 새 카드: 공포탐욕(바깥 자료) · 가치 속도 — 자료를 받았을 때만 카드
    for path, key in (('fear/', 'fear'), ('moneyspeed/', 'moneyspeed')):
        pg = newpage(); pg.goto(SITE + path, wait_until='load'); pg.wait_for_timeout(6000)
        c = pg.evaluate("(k) => { const f = window.dcShareSpec && dcShareSpec[k]; const o = typeof f === 'function' ? f() : f; return { has: typeof f === 'function', o: o && { big: o.big, rows: (o.rows || []).length } }; }", key)
        if not c['has']:
            F('%s: 결과 카드 함수가 없음' % path)
        elif key == 'moneyspeed' and not (c['o'] and '%' in c['o']['big'] and c['o']['rows'] >= 3):
            F('%s: 가치 속도 카드가 비었음 %s' % (path, c))
        pg.close()
    # ⑦ ETF 차트 비교 로그 눈금: 축·눈금·끄고 켜기·주소·링크·확대 되돌리기
    pg = newpage()
    try:
        pg.goto(SITE + 'etf-compare/#e=K069500,USPY,UQQQ&p=MAX&lg=1', wait_until='load')
        pg.wait_for_function(SH_ETF_READY, timeout=60000)
        Y = "() => { const y = ECXdebug.S.chart.scales.y; return { type: y.type, min: y.min, max: y.max, ticks: y.ticks.map(t => t.label), box: document.getElementById('ecx-log').checked, hash: location.hash, data: ECXdebug.S.chart.data.datasets.every(d => d.data.every(p => p.y == null || p.y > 0)) }; }"
        a = pg.evaluate(Y)
        if a['type'] != 'logarithmic' or not a['box'] or not (a['min'] > 0) or len(a['ticks']) < 2 or not all(t.endswith('%') for t in a['ticks']) or not a['data']:
            F('ETF 로그 눈금: 축·눈금·점이 이상함 %s' % json.dumps(a, ensure_ascii=False)[:300])
        if '0%' not in a['ticks']:
            F('ETF 로그 눈금: 0% 눈금(출발선)이 없음 %s' % a['ticks'])
        tip = pg.evaluate("() => { const c = ECXdebug.S.chart, ds = c.data.datasets[0], i = ds.data.findIndex(p => p.y != null && Math.abs(p.y - 100) > 1); const t = c.options.plugins.tooltip.callbacks.label.call(c.tooltip, { parsed: { x: ds.data[i].x, y: ds.data[i].y }, dataset: ds }); return { t: t, y: ds.data[i].y }; }")
        exp = tip['y'] - 100
        if ('%+.2f' % exp).replace('-', '−').lstrip('+') not in tip['t'].replace('+', ''):
            F('ETF 로그 눈금: 풍선 수익률이 점(100 = 0%%)과 다름 %s (기대 %.2f%%)' % (tip['t'], exp))
        box = pg.locator('#ecx-chart').bounding_box()
        pg.mouse.move(box['x'] + box['width'] * 0.7, box['y'] + box['height'] / 2)
        for _ in range(4):
            pg.mouse.wheel(0, -300); pg.wait_for_timeout(100)
        pg.wait_for_timeout(400)
        z = pg.evaluate(Y)
        if z['type'] != 'logarithmic' or not (z['min'] > 0) or not (z['max'] / z['min'] < a['max'] / a['min']):
            F('ETF 로그 눈금: 확대해도 세로 범위가 좁아지지 않음 %s → %s' % ([a['min'], a['max']], [z['min'], z['max']]))
        pg.locator('#page-etfcmp .zp-reset').first.click(); pg.wait_for_timeout(300)
        rz = pg.evaluate(Y)
        if abs(rz['min'] - a['min']) > 1e-9 * a['max'] or abs(rz['max'] - a['max']) > 1e-9 * a['max']:
            F('ETF 로그 눈금: 전체 보기로 되돌려도 처음 범위가 아님 %s → %s' % ([a['min'], a['max']], [rz['min'], rz['max']]))
        pg.click('#ecx-log'); pg.wait_for_timeout(500)
        b = pg.evaluate(Y)
        if b['type'] != 'linear' or 'lg=1' in b['hash']:
            F('ETF 로그 눈금: 끄면 보통 눈금·주소에서 lg 빠져야 함 %s %s' % (b['type'], b['hash']))
        pg.click('#ecx-log'); pg.wait_for_timeout(500)
        u = send(pg)
        hs = (urllib.parse.parse_qs(urllib.parse.urlparse(u).query).get('hs') or [''])[0]
        if 'lg=1' not in hs:
            F('ETF 로그 눈금: 공유 링크에 lg=1 이 없음 %s' % u[:200])
        pg2 = newpage(); pg2.goto(u, wait_until='load'); pg2.wait_for_function(SH_ETF_READY, timeout=60000)
        c = pg2.evaluate(Y)
        if c['type'] != 'logarithmic' or not c['box']:
            F('ETF 로그 눈금: 받은 링크로 열면 로그 눈금이 아님 %s' % c['type'])
        pg2.close()
    except Exception as ex:
        F('ETF 로그 눈금 검사 실행: %s' % str(ex)[:200])
    pg.close()
    # ⑧ 내 저장함: 버튼 묶음 2(세금 방식 탭)·차트 탭까지 저장하고 되살림 (로컬만 — 가짜 Worker)
    if local:
        pg = newpage()
        try:
            pg.goto(SITE + 'kodex/', wait_until='load')
            pg.evaluate("() => localStorage.setItem('dc_auth', JSON.stringify({ token: 'share.test', exp: Math.floor(Date.now() / 1000) + 3600, user: { id: 1, nick: '검사' } }))")
            pg.goto(SITE + 'kodex/', wait_until='load'); pg.wait_for_timeout(2500)
            pg.evaluate("() => { const t = [...document.querySelectorAll('#page-simulator .tax-mode-tab')].find(b => !b.classList.contains('active')); t.click(); const c = [...document.querySelectorAll('#page-simulator .chart-tabs .chart-tab')].find(b => /월간/.test(b.textContent)); if (c) c.click(); }")
            pg.wait_for_timeout(500)
            a = pg.evaluate(SHARE_SNAP)
            pg.wait_for_selector('#dca-save', timeout=15000); pg.click('#dca-save')
            pg.wait_for_function("() => /내 저장함에 저장/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=10000)
            n = max(saves) if saves else None
            if not n or not (saves[n]['data'] or {}).get('t'):
                F('내 저장함: 저장 자료에 버튼 묶음 2(t)가 없음 %s' % json.dumps(saves.get(n), ensure_ascii=False)[:200])
            else:
                pg.goto(SITE + 'kodex/', wait_until='load'); pg.wait_for_timeout(1500)
                pg.goto(SITE + 'kodex/?load=%d' % n, wait_until='load')
                pg.wait_for_function("() => /불러옴/.test((document.getElementById('dca-toast') || {}).textContent || '')", timeout=20000)
                pg.wait_for_timeout(3500)
                b = pg.evaluate(SHARE_SNAP)
                for k in sorted(set(a['d']['t']) | set(b['d']['t'])):
                    if a['d']['t'].get(k) != b['d']['t'].get(k):
                        F('내 저장함: 불러온 버튼 묶음이 다름 %s %r→%r' % (k, a['d']['t'].get(k), b['d']['t'].get(k)))
                if (a['card'] or {}).get('big') != (b['card'] or {}).get('big'):
                    F('내 저장함: 불러온 결과가 다름 %s → %s' % ((a['card'] or {}).get('big'), (b['card'] or {}).get('big')))
        except Exception as ex:
            F('내 저장함(버튼 묶음 2) 검사 실행: %s' % str(ex)[:200])
        pg.close()
    for e in perr[:3]:
        F('페이지 오류: ' + e)
    ctx.close()


# 같은 가격 자료(화면이 받은 prices.csv 글)로 Node 시뮬레이터 엔진(scripts/stratsim_fit.cjs)이 낸 '9sig·SMA 기본'(2010 1분기~2025 4분기) 숫자
SS_NODE_GOLD_JS = r"""const F = require(process.argv[1]), M = F.M, S = M.S;
S.saved = [['9sig', {}], ['sma', {}]].map(([t, p], k) => ({ id: 'g' + k, type: t, name: t + k, params: M.ssCleanParams(t, Object.assign(M.ssDefaults(t), p)), color: '#ffffff', hidden: false }));
const Q = M.DS.q; S.e = Q.findIndex((r) => r[0] === '2010-03-31'); S.x = Q.findIndex((r) => r[0] === '2025-12-31'); S.iPos = 333; S.mPos = M.ssMonthlyToPos(500); S.raise = '0'; S.ed = ''; S.xd = ''; S.editing = null; S.panel = null; S.infl = false; S.log = false; S.tx = null;
M.ssRender(); const m = M.R.metrics;
console.log(JSON.stringify({ n: M.R.labels.length, bh: [m.bh.cagr, m.bh.maxDD], cfg: [[m['cfg:g0'].cagr, m['cfg:g0'].maxDD], [m['cfg:g1'].cagr, m['cfg:g1'].maxDD]] }));"""

SS_GOLD_JS = """() => { const m = SSM.R.metrics; return { ready: SSM.ready(), n: SSM.R.labels.length, l0: SSM.R.labels[0], l1: SSM.R.labels[SSM.R.labels.length - 1],
  bh: [m.bh.cagr, m.bh.maxDD], inv: [m.invested.cagr], cfg: SSM.S.saved.map(c => { const x = m['cfg:' + c.id] || {}; return [c.type, x.cagr, x.maxDD, !!x.pending, x.error || null]; }) }; }"""


def stratsim_check(br, base, fail, ignorable):
    """[STRATSIM] 투자전략 시뮬레이터(/strategy-simulator/) · 9sig/SMA 과최적화 탐색기 · TQQQ 장중 흐름
    · 고정 구간(2010 1분기~2025 4분기) 9sig·SMA 기본 숫자 = 화면이 받은 같은 가격 자료로 돌린 Node 시뮬레이터 엔진 값(화면 코드가 Node 계산과 같은지 —
      상장 전 구간이 재현 식 갱신으로 조금 바뀌어도 그대로 맞음 · 엔진 자체의 고정 기준값은 tests/stratsim_test.cjs 가 고정 자료로 확인)
    · 전략 라이브러리 44개 · 써 보기(사용자 코드 전략은 격리 Worker 에서 계산 끝) · 분석 표 열림 · 분석 표 풍선 연평균 = 본 화면 연평균 · 로그 단추
    · 링크 복사 → 새 창 같은 숫자
    · 탐색기: 탭 6개 · 첫 탭 행 수 · '열기' 링크로 연 시뮬레이터(청산 2025 4분기)가 표의 연평균과 같음 · 장중 흐름 그려짐"""
    import base64
    ctx = br.new_context(viewport={'width': 1400, 'height': 900})
    try:
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=base.rstrip('/'))
    except Exception:
        pass
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(('스크립트 오류 ' + str(e)[:200], '')))
    pg.on('console', lambda m: errs.append((m.text, m.location.get('url', '') if m.location else '')) if m.type == 'error' else None)
    tok = lambda o: 'j' + base64.urlsafe_b64encode(json.dumps(o, ensure_ascii=False).encode()).decode().rstrip('=')
    try:
        # 1) 고정 구간 기준값 (tests/stratsim_test.cjs '9sig·SMA 기본') — 주소는 q0 없는 예전(1953 기준 분기 번호 e=228·x=291) 링크: 자료가 1971 부터로 바뀐 뒤에도 같은 분기(2010 1분기~2025 4분기)로 읽는지
        st = {'v': 1, 'i': 333, 'm': 500, 'a': '0', 'r': 4, 'e': 228, 'x': 291, 'hd': [], 'sc': [{'t': '9sig', 'n': '9sig', 'p': {}, 'c': '#e879f9'}, {'t': 'sma', 'n': 'SMA', 'p': {}, 'c': '#f59e0b'}]}
        pg.goto(base + 'strategy-simulator/#ss=' + tok(st), wait_until='load'); pg.wait_for_timeout(3500)
        g = pg.evaluate(SS_GOLD_JS)
        want = None
        try:
            txt = pg.evaluate("() => fetch('data/stratsim/prices.csv', { cache: 'no-store' }).then(r => r.text())")
            tf = os.path.join(tempfile.gettempdir(), 'ss_gold_prices_%d.csv' % os.getpid())
            with open(tf, 'w', encoding='utf-8') as f:
                f.write(txt)
            pr = subprocess.run(['node', '-e', SS_NODE_GOLD_JS, os.path.join(ROOT, 'scripts', 'stratsim_fit.cjs')], capture_output=True, text=True, timeout=180,
                                env=dict(os.environ, STRATSIM_PRICES=tf))
            os.remove(tf)
            want = json.loads(pr.stdout.strip().splitlines()[-1])
        except Exception as e:
            fail('strategy-simulator', 'Node 엔진 대조값 계산 실패: %s' % str(e)[:200])
        if want:
            ok = g['ready'] and g['n'] == 65 == want['n'] and g['l0'] == '2009-12-31' and g['l1'] == '2025-12-31' \
                and abs(g['bh'][0] - want['bh'][0]) < 1e-6 and abs(g['bh'][1] - want['bh'][1]) < 1e-6 and abs(g['bh'][0] - 40.12) < 0.5 \
                and len(g['cfg']) == 2 and abs(g['cfg'][0][1] - want['cfg'][0][0]) < 1e-6 and abs(g['cfg'][1][1] - want['cfg'][1][0]) < 1e-3
            if not ok:
                fail('strategy-simulator', '고정 구간 숫자가 Node 엔진과 다름: 화면 %s · Node %s' % (json.dumps(g, ensure_ascii=False)[:240], json.dumps(want)[:200]))
        # 2) 라이브러리 · 써 보기 (사용자 코드 전략)
        pg.evaluate("() => { for (const k of Object.keys(localStorage)) if (k.startsWith('dc_ss_')) localStorage.removeItem(k); }")
        pg.goto(base + 'strategy-simulator/', wait_until='load'); pg.wait_for_timeout(2500)
        pg.click('#ss-libbtn'); pg.wait_for_timeout(1200)
        lib = pg.evaluate("() => ({ cards: document.querySelectorAll('.ss-lib-card').length, tries: [...document.querySelectorAll('.ss-lib-try')].map(b => +b.dataset.try) })")
        if lib['cards'] < 1 or not lib['tries']:
            fail('strategy-simulator', '전략 라이브러리 카드·써 보기 없음: %s' % lib)
        else:
            pg.click('.ss-lib-try[data-try="%d"]' % lib['tries'][-1]); pg.wait_for_timeout(5000)
            c = pg.evaluate(SS_GOLD_JS)['cfg']
            if len(c) != 1 or c[0][3] or c[0][4] or c[0][1] is None:
                fail('strategy-simulator', '라이브러리 써 보기 결과 이상: %s' % c)
        # 3) 분석 표
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        pg.click('#ss-an-open'); pg.wait_for_timeout(6000)
        an = pg.evaluate("() => ({ open: SSM.S.an.open, cells: document.querySelectorAll('[data-an-cell], .ss-an-cell, .ssa-cell').length })")
        if not an['open']:
            fail('strategy-simulator', '분석 표가 열리지 않음: %s' % an)
        pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        # 3-1) 분석 표 칸 풍선의 기간 연평균(전략·비교) = 같은 구간으로 맞춘 본 화면 '연평균 수익률' · 로그 단추 = 본 차트 로그와 같은 설정
        try:
            sa = {'v': 1, 'i': 333, 'm': 500, 'a': '0', 'r': 4, 'e': 228, 'x': 291, 'hd': [], 'sc': [{'t': 'sma', 'n': 'SMA', 'p': {}, 'c': '#f59e0b'}], 'am': 1, 'as': 'cfg:0', 'ab': 'compounded'}
            pg.evaluate("() => { for (const k of Object.keys(localStorage)) if (k.startsWith('dc_ss_')) localStorage.removeItem(k); }")   # 앞 단계에서 저장한 전략이 섞이지 않게
            pa = ctx.new_page()
            pa.goto(base + 'strategy-simulator/#ss=' + tok(sa), wait_until='load')
            pa.wait_for_function("() => window.SSM && SSM.ready() && window.SSAN && document.querySelector('#ss-an-grid td[data-v]') && !SSAN.busy()", timeout=90000)
            pa.wait_for_timeout(300)
            cell = pa.query_selector('#ss-an-grid td[data-yp="2000:20"]')
            cell.scroll_into_view_if_needed(); cell.hover(); pa.wait_for_timeout(200)
            tt = pa.inner_text('#ss-an-tip')
            m1, m2 = re.search(r'연평균 ([+−-]?[\d.]+)%', tt), re.search(r'\(연 ([+−-]?[\d.]+)%\)', tt)
            pa.mouse.move(3, 3); pa.click('#ss-an-log'); pa.wait_for_timeout(400)
            cell.hover(); pa.wait_for_timeout(200)
            lg = pa.evaluate("() => ({ s: SSM.S.log, main: document.getElementById('ss-log').getAttribute('aria-pressed'), cap: !!document.querySelector('#ss-an-tip .ss-an-mlg') })")
            mm = pa.evaluate("""() => { const Q = SSM.DS.q, last = (y) => { let k = -1; Q.forEach((r, i) => { if (+r[0].slice(0, 4) === y) k = i; }); return k; };
              const S = SSM.S, k = S.an.strategy; S.an.open = false; document.getElementById('ss-an').hidden = true; S.e = last(1999) + 1; S.x = last(2019); SSM.render(); const M = SSM.R.metrics;
              return { st: M[k] ? M[k].cagr : NaN, bl: M.invested.cagr, d0: SSM.R.ctx.entryDate, d1: SSM.R.ctx.exitDate }; }""")
            pa.close()
            got = [float(m.group(1).replace('−', '-')) if m else None for m in (m1, m2)]
            if None in got or abs(round(mm['st'], 2) - got[0]) > 0.0051 or abs(round(mm['bl'], 2) - got[1]) > 0.0051:
                fail('strategy-simulator', '분석 표 풍선 연평균 %s 이 본 화면(%s~%s) %.4f / %.4f 와 다름' % (got, mm['d0'], mm['d1'], mm['st'], mm['bl']))
            if not (lg['s'] and lg['main'] == 'true' and lg['cap']):
                fail('strategy-simulator', '분석 창 로그 단추 이상: %s' % lg)
        except Exception as ex:
            fail('strategy-simulator', '분석 표 연평균·로그 검사 오류: %s' % str(ex)[:200])
        # 4) 링크 복사 → 새 창
        pg.click('#ss-share'); pg.wait_for_timeout(700)
        url = pg.evaluate("() => navigator.clipboard.readText().catch(() => '')")
        if '#ss=' not in (url or ''):
            fail('strategy-simulator', '링크 복사 결과 이상: %s' % (url or '')[:120])
        else:
            a1 = pg.evaluate(SS_GOLD_JS)
            p2 = ctx.new_page()
            p2.goto(base + 'strategy-simulator/' + url[url.index('#'):], wait_until='load'); p2.wait_for_timeout(6000)
            a2 = p2.evaluate(SS_GOLD_JS)
            if json.dumps(a1['cfg']) != json.dumps(a2['cfg']) or a1['bh'] != a2['bh']:
                fail('strategy-simulator', '공유 링크로 연 화면 숫자가 다름: %s / %s' % (a1['cfg'], a2['cfg']))
            p2.close()
        # 5) 과최적화 탐색기
        for path, n0 in (('9sig-overfit/', 168), ('sma-overfit/', 1512)):
            pg.goto(base + path, wait_until='load'); pg.wait_for_timeout(2500)
            t = pg.evaluate("() => ({ tabs: document.querySelectorAll('.ssf-tab').length, rows: document.querySelectorAll('#ssf-tbl tbody tr').length, "
                            "href: (document.querySelector('#ssf-tbl tbody tr a.ssf-go') || {}).getAttribute ? document.querySelector('#ssf-tbl tbody tr a.ssf-go').getAttribute('href') : '', "
                            "cagr: (document.querySelector('#ssf-tbl tbody tr td:nth-child(3)') || {}).innerText })")
            if t['tabs'] != 6 or t['rows'] != n0:
                fail(path, '탭 %d개 · 첫 탭 %d행 (기대 6 · %d)' % (t['tabs'], t['rows'], n0))
                continue
            o = json.loads(base64.urlsafe_b64decode(t['href'].split('#ss=j')[1] + '=='))
            # 끝 = 2025-12-31 (맞춘 구간 끝) — 분기 번호는 링크의 q0(자료 첫 분기말)부터 셈 · q0 없으면 예전 1953-03-31 기준
            qk = lambda d: int(d[:4]) * 4 + (int(d[5:7]) - 1) // 3
            o['x'] = qk('2025-12-31') - qk(o.get('q0') or '1953-03-31')
            # 앞 단계(라이브러리 써 보기)가 이 브라우저에 저장한 전략이 목록 앞에 남지 않게 — 링크로 받은 전략만 보이도록
            pg.evaluate("() => { for (const k of Object.keys(localStorage)) if (k.startsWith('dc_ss_')) localStorage.removeItem(k); }")
            p3 = ctx.new_page()
            p3.goto(base + 'strategy-simulator/#ss=' + tok(o), wait_until='load'); p3.wait_for_timeout(4000)
            c3 = p3.evaluate(SS_GOLD_JS)['cfg']
            p3.close()
            if not c3 or ('+%.1f%%' % c3[0][1]) != t['cagr']:
                fail(path, "'열기'로 연 시뮬레이터 연평균 %s 가 표(%s)와 다름" % (c3[0][1] if c3 else None, t['cagr']))
        # 6) 장중 흐름
        pg.goto(base + 'tqqq-intraday/', wait_until='load'); pg.wait_for_timeout(4000)
        ii = pg.evaluate("() => { const r = document.getElementById('ssi-app'); return r ? { svg: r.querySelectorAll('svg path, svg polyline').length, txt: r.innerText.length } : null; }")
        if not ii or ii['svg'] < 5:
            fail('tqqq-intraday', '장중 흐름이 그려지지 않음: %s' % ii)
    except Exception as ex:
        fail('strategy-simulator', '화면 검사 실행 오류: %s' % str(ex)[:300])
    for t, u in errs:
        if not ignorable(t, u):
            fail('strategy-simulator', '콘솔 오류: ' + t[:200])
            break
    ctx.close()


def serve(root):
    handler = functools.partial(Quiet, directory=root)
    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, 'http://127.0.0.1:%d/' % httpd.server_address[1]


def earn_data_check(fail, d, where='earn'):
    """data/earnings.json 형식·내용 (로컬은 저장소 파일, 배포는 사이트가 받은 자료)"""
    import datetime as _dt
    kr, usall = d.get('kr') or [], d.get('us') or []
    us = [r for r in usall if not r.get('x')]          # 미국 TOP 100 (x = TOP 100 밖 SOX 종목)
    sox = (d.get('sox') or {}).get('s') or []
    if not 20 <= len(sox) <= 40: fail(where, '필라델피아 반도체(SOX) 구성 종목 수 이상: %d' % len(sox))
    flagged = sorted(r['s'] for r in usall if r.get('sox'))
    if flagged != sorted(sox): fail(where, 'SOX 표시 종목이 구성 목록과 다름: 빠짐 %s · 더 있음 %s' % (sorted(set(sox) - set(flagged))[:8], sorted(set(flagged) - set(sox))[:8]))
    if any(r.get('x') and not r.get('sox') for r in usall): fail(where, 'TOP 100 밖인데 SOX 도 아닌 미국 종목이 섞임')
    if any(r.get('x') and r.get('r') is not None for r in usall): fail(where, 'TOP 100 밖 종목에 순위가 붙음')
    # 시가총액 = 확정 종가 × 주식 수 · 종가 날짜가 있고 최근
    try: upd = _dt.datetime.fromisoformat(d['updated'].replace('Z', '+00:00')).date()
    except Exception: upd = None
    for mk, rows_, key, tol in (('kr', kr, 'c', 1.0), ('us', usall, 's', None)):
        bad = [r[key] for r in rows_ if r.get('sh') and r.get('p') and abs(r['m'] - r['sh'] * r['p']) > (tol if tol else r['m'] * 0.002)]
        if bad: fail(where, '%s 시가총액 ≠ 종가 × 주식 수: %s' % (mk, bad[:6]))
        nosh = [r[key] for r in rows_ if not r.get('sh')]
        if len(nosh) > 3: fail(where, '%s 주식 수 없는 종목 %d개: %s' % (mk, len(nosh), nosh[:6]))
        old = [r[key] for r in rows_ if not r.get('pd') or (upd and (upd - _dt.date.fromisoformat(r['pd'])).days > 6)]
        if len(old) > 3: fail(where, '%s 종가 날짜 없음·오래됨 %d개: %s' % (mk, len(old), old[:6]))
    if len(kr) < 90 or len(us) < 90: fail(where, '기업 수 부족: 국내 %d · 미국 %d (각 90 이상)' % (len(kr), len(us)))
    try:
        age = (_dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(d['updated'].replace('Z', '+00:00'))).total_seconds() / 3600
        if age > 80: fail(where, '자료가 %.0f시간 묵음 (updated %s) — Actions 갱신 확인' % (age, d['updated']))
    except Exception as ex: fail(where, 'updated 형식 오류: %r' % ex)
    for mk, rows, key in (('kr', kr, 'c'), ('us', us, 's')):
        ks = [r.get(key) for r in rows]
        if len(set(ks)) != len(ks): fail(where, '%s 중복 종목' % mk)
        if [r.get('r') for r in rows] != list(range(1, len(rows) + 1)): fail(where, '%s 순위가 1부터 차례가 아님' % mk)
        if any(not (r.get('m') or 0) > 0 for r in rows): fail(where, '%s 시가총액 없는 종목' % mk)
        caps = [r['m'] for r in rows]
        if caps != sorted(caps, reverse=True): fail(where, '%s 시가총액 순서가 아님' % mk)
        bad_d = [r[key] for r in rows if r.get('nx') and not re.match(r'^\d{4}-\d\d-\d\d$', r['nx'].get('d') or '')]
        if bad_d: fail(where, '%s 다음 발표일 형식 오류: %s' % (mk, bad_d[:5]))
        no_nx = [r[key] for r in rows if not r.get('nx')]
        if len(no_nx) > len(rows) * 0.15: fail(where, '%s 다음 발표일 없는 종목이 너무 많음 %d개: %s' % (mk, len(no_nx), no_nx[:8]))
        no_k = [r[key] for r in rows if not (r.get('k') or {})]
        if len(no_k) > len(rows) * 0.1: fail(where, '%s 핵심 지표 없는 종목 %d개: %s' % (mk, len(no_k), no_k[:8]))
        no_per = [r[key] for r in rows if not any((r.get('per') or {}).get(x) for x in 'tbf')]
        if len(no_per) > len(rows) * 0.15: fail(where, '%s PER 이 하나도 없는 종목 %d개: %s' % (mk, len(no_per), no_per[:8]))
        for r in rows:
            for x in 'tbf':
                v = (r.get('per') or {}).get(x)
                if v is not None and not (0 < v < 5000): fail(where, '%s %s PER(%s) 범위 밖 %s' % (mk, r[key], x, v))
    for r in kr:
        if re.search(r'(\d?우[A-C]?)$', r['n']) or not r['c'].endswith('0'): fail(where, '국내 목록에 우선주: %s %s' % (r['c'], r['n']))
        e, p_, v = (r.get('eps') or {}), r.get('p'), (r.get('per') or {})
        for x in 'tbf':   # 국내 PER = 주가 ÷ EPS (화면 숫자와 자료가 같은 식인지)
            if e.get(x) and e[x] > 0 and p_ and v.get(x) is not None and abs(v[x] - round(p_ / e[x], 2)) > 0.011:
                fail(where, '국내 %s PER(%s) %s ≠ 주가 %s ÷ EPS %s' % (r['c'], x, v[x], p_, e[x]))
    return len(kr), len(us)


def earn_check(page, base, fail, errs, ignorable):
    errs.clear()
    if base.startswith('http://127.0.0.1') or base.startswith('http://localhost'):
        d = json.load(open(os.path.join(ROOT, 'data', 'earnings.json'), encoding='utf-8'))
        dk = json.load(open(os.path.join(ROOT, 'data', 'earnings_kr.json'), encoding='utf-8'))
        du = json.load(open(os.path.join(ROOT, 'data', 'earnings_us.json'), encoding='utf-8'))
        earn_data_check(fail, d)
        miss = [r['c'] for r in d['kr'] if not (dk['co'].get(r['c']) or {}).get('fin')] + [r['s'] for r in d['us'] if not (du['co'].get(r['s']) or {}).get('fin')]
        if len(miss) > 20: fail('earn', '재무표 없는 기업 %d개: %s' % (len(miss), miss[:10]))
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.goto(base + 'earnings-calendar/', wait_until='load'); page.wait_for_timeout(600)
    page.evaluate("() => { try { localStorage.removeItem('er-fav'); } catch (e) {} }")
    r = page.evaluate("""async () => {
      for (let i = 0; i < 60 && !(window.ERdebug && ERdebug.S.d); i++) await new Promise(r => setTimeout(r, 200));
      if (!window.ERdebug || !ERdebug.S.d) return { none: true };
      const D = ERdebug.S.d, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
      const out = { kr0: D.kr[0].c, kr0n: D.kr[0].n, kr: D.kr.length, us: D.us.filter(x => !x.x).length, soxN: D.us.filter(x => x.sox).length, cells: $$('#er-cal .er-day').length, rows: $$('#er-body tr[data-key]').length,
        kpi: ['er-k-today', 'er-k-week', 'er-k-next', 'er-k-last'].map(id => document.getElementById(id).textContent),
        tips: [...new Set([...document.documentElement.innerHTML.matchAll(/data-tip="([a-z]+)"/g)].map(m => m[1]))],
        terms: $$('#er-gloss details.er-term').map(x => x.id), keyterms: $$('#er-gloss details.er-term.er-key').length,
        kst1: ERdebug.nyToKst('2026-10-29', 16, 5), kst2: ERdebug.nyToKst('2026-11-02', 16, 5), kst3: ERdebug.nyToKst('2027-03-15', 7, 0) };
      /* 시장 선택 · 날짜 선택 */
      $('#page-earn .er-mk [data-mk="us"]').click(); await new Promise(r => setTimeout(r, 50));
      out.usOnly = $$('#er-body tr[data-key]').every(tr => tr.dataset.key.startsWith('us-')) && $$('#er-body tr[data-key]').length > 0;
      $('#page-earn .er-mk [data-mk="all"]').click();
      $('#page-earn .er-mode [data-mode="all"]').click(); await new Promise(r => setTimeout(r, 50));
      out.allTitle = $('#er-list-t').textContent;
      out.allRows = $$('#er-body tr[data-key]').length;
      const keys1 = $$('#er-body tr[data-key]').map(t => t.dataset.key);
      out.pgBtns = $$('#er-pager .er-pg').map(b => b.textContent); out.pgInfo = ($('#er-pager .er-pg-info') || {}).textContent || '';
      /* 쪽 번호 입력으로 이동 · 다음 쪽 단추 · 마지막 쪽 */
      $('#er-pg-in').value = '3'; $('#er-pg-btn').click(); await new Promise(r => setTimeout(r, 50));
      out.p3 = { page: ERdebug.S.page, rows: $$('#er-body tr[data-key]').length, cur: ($('#er-pager .er-pg.on') || {}).textContent, info: $('#er-pager .er-pg-info').textContent,
                 overlap: $$('#er-body tr[data-key]').some(t => keys1.indexOf(t.dataset.key) >= 0) };
      $('#er-pg-in').value = '999'; $('#er-pg-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise(r => setTimeout(r, 50));
      out.pLast = { page: ERdebug.S.page, rows: $$('#er-body tr[data-key]').length };
      $('#er-pager [aria-label="첫 쪽"]').click(); await new Promise(r => setTimeout(r, 50)); out.pFirst = ERdebug.S.page;
      /* 목록 안 국내/미국 나눠 보기 */
      const lmk = mk => { [...document.querySelectorAll('#er-list-card .er-mk .chart-tab')].find(b => b.dataset.mk === mk).click(); };
      lmk('kr'); await new Promise(r => setTimeout(r, 50));
      out.lkr = { rows: $$('#er-body tr[data-key]').length, allKr: $$('#er-body tr[data-key]').every(t => t.dataset.key.startsWith('kr-')), info: $('#er-pager .er-pg-info').textContent,
                  calSync: ($('#page-earn .card .er-mk .chart-tab.active') || {}).dataset.mk };
      lmk('us'); await new Promise(r => setTimeout(r, 50));
      out.lus = $$('#er-body tr[data-key]').length > 0 && $$('#er-body tr[data-key]').every(t => t.dataset.key.startsWith('us-'));
      /* 필라델피아 반도체(SOX)만: 전체 기업 보기에서 구성 종목 수 그대로 · 미국 100 보기에는 TOP 100 밖 종목 없음 */
      $('#page-earn .er-mode [data-mode="all"]').click(); lmk('sox'); await new Promise(r => setTimeout(r, 50));
      out.lsox = { keys: $$('#er-body tr[data-key]').map(t => t.dataset.key), title: $('#er-list-t').textContent, info: $('#er-pager .er-pg-info').textContent,
                   flags: $$('#er-body tr[data-key]').every(t => !!t.querySelector('.er-sox')), cal: $$('#er-cal .er-ev').length };
      lmk('us'); out.usNoX = $$('#er-body tr[data-key]').every(t => !(D.us.find(x => 'us-' + x.s === t.dataset.key) || {}).x);
      lmk('all'); $('#page-earn .er-mode [data-mode="up"]').click();
      /* 목록 검색칸 */
      const ls = $('#er-lsearch'); ls.value = D.kr[0].n; ls.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 50));
      out.lsearch = { keys: $$('#er-body tr[data-key]').map(t => t.dataset.key), sync: $('#er-search').value, title: $('#er-list-t').textContent };
      ls.value = 'AAPL'; ls.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 50));
      out.lsearch2 = $$('#er-body tr[data-key]').map(t => t.dataset.key);
      ls.value = ''; ls.dispatchEvent(new Event('input', { bubbles: true }));
      $('#page-earn .er-mode [data-mode="up"]').click();
      const day = $$('#er-cal .er-day').find(b => b.querySelector('.er-ev'));
      if (day) { day.click(); await new Promise(r => setTimeout(r, 50));
        const ds = day.dataset.d; out.dayOk = $$('#er-body tr[data-key]').length > 0 && $('#er-list-t').textContent.indexOf('실적발표') >= 0 && !$('#er-filter').hidden;
        out.dayRows = $$('#er-body tr[data-key]').map(tr => tr.querySelector('.er-c-d b').textContent);
        $('#er-unsel').click(); }
      /* 관심 기업 */
      const fb = $('#er-body .er-fav'); const fk = fb && fb.dataset.fav; fb && fb.click();
      out.fav = JSON.parse(localStorage.getItem('er-fav') || '[]'); $('#er-favonly').click(); await new Promise(r => setTimeout(r, 50));
      out.favRows = $$('#er-body tr[data-key]').map(t => t.dataset.key); $('#er-favonly').click(); out.favKey = fk;
      /* 기업 상세: 국내 1위 · 미국 1위 */
      out.modal = [];
      for (const key of ['kr-' + D.kr[0].c, 'us-' + D.us[0].s]) {
        ERdebug.openCo(key);
        for (let i = 0; i < 60 && !$('#er-m-body .er-ft, #er-m-body .er-unit:not(:empty)'); i++) await new Promise(r => setTimeout(r, 200));
        for (let i = 0; i < 40 && /불러오는 중/.test($('#er-m-body').textContent); i++) await new Promise(r => setTimeout(r, 200));
        const m = { key, open: !$('#er-modal').hidden, hash: location.hash, kc: $$('#er-m-body .er-kc').length, pc: $$('#er-m-body .er-pc').length,
          ftRows: $$('#er-m-body .er-ft tbody tr:not(.grp)').length, keyRows: $$('#er-m-body .er-ft tr.key').length, cols: $$('#er-m-body .er-ft thead th').length - 1,
          eCols: $$('#er-m-body .er-ft thead th.e').length, next: ($('#er-m-body .er-m-next') || {}).textContent || '' };
        $('#er-m-body [data-ftab="y"]').click(); await new Promise(r => setTimeout(r, 50));
        m.yRows = $$('#er-m-body .er-ft tbody tr:not(.grp)').length;
        const tip = $('#er-m-body [data-tip="fcf"]'); if (tip) { tip.click(); m.tip = (($('#er-m-body tr.tip') || {}).textContent || '').slice(0, 30); }
        $('#er-m-body [data-ftab="q"]').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await new Promise(r => setTimeout(r, 50));
        m.closed = $('#er-modal').hidden && !/co=/.test(location.hash);
        out.modal.push(m);
      }
      return out; }""")
    if r.get('none'):
        fail('earn', '자료를 불러오지 못함(ERdebug.S.d 없음)'); return
    if r['kr'] < 90 or r['us'] < 90: fail('earn', '화면 기업 수 국내 %d · 미국 %d' % (r['kr'], r['us']))
    if r['cells'] not in (35, 42): fail('earn', '달력 칸 %d개' % r['cells'])
    if r['rows'] < 1: fail('earn', '다가오는 발표 목록이 비어 있음')
    if any(k in ('—', '') for k in r['kpi'][:2]): fail('earn', 'KPI 비어 있음: %s' % r['kpi'])
    miss = [t for t in r['tips'] if 'er-t-' + t not in r['terms']]
    if miss: fail('earn', '표의 용어 설명(data-tip)에 맞는 용어 사전 항목 없음: %s' % miss)
    if r['keyterms'] != 8: fail('earn', '★ 핵심 용어 %d개 (기대 8: 영업이익·FCF·부채비율·이자보상배율·ROE·ROIC·PER·EV/EBITDA)' % r['keyterms'])
    if r['kst1'] != '10/30(금) 05:05' or r['kst2'] != '11/3(화) 06:05' or r['kst3'] != '3/15(월) 20:00':
        fail('earn', '미국 → 한국 시간 변환(서머타임) 오류: %s · %s · %s' % (r['kst1'], r['kst2'], r['kst3']))
    if not r['usOnly']: fail('earn', '미국만 보기에 국내 기업이 섞임')
    tot = r['kr'] + r['us']; pages = -(-tot // 50); d_kr0, ls_name = r['kr0'], r['kr0n']
    if '전체 기업' not in r['allTitle'] or r['allRows'] != 50: fail('earn', '전체 기업 보기 이상: %s · %d줄 (한 쪽 50곳)' % (r['allTitle'], r['allRows']))
    if not r['pgBtns'] or r['pgBtns'][-1] != '»' or ('전체 %d곳 중 1~50번째' % tot) not in r['pgInfo']: fail('earn', '쪽 넘김 단추 이상: %s / %s' % (r['pgBtns'], r['pgInfo']))
    p3 = r['p3']
    if p3['page'] != 3 or p3['rows'] != min(50, tot - 100) or p3['cur'] != '3' or p3['overlap'] or ('101~' not in p3['info']): fail('earn', '쪽 번호 입력(3쪽) 이동 이상: %s' % p3)
    if r['pLast']['page'] != pages or r['pLast']['rows'] != tot - 50 * (pages - 1): fail('earn', '없는 쪽(999) 입력 → 마지막 쪽(%d)으로 가지 않음: %s' % (pages, r['pLast']))
    if r['pFirst'] != 1: fail('earn', '첫 쪽 단추 이상: %s' % r['pFirst'])
    if not r['lkr']['allKr'] or r['lkr']['rows'] != 50 or ('전체 %d곳' % r['kr']) not in r['lkr']['info'] or r['lkr']['calSync'] != 'kr': fail('earn', '목록 국내만 보기 이상: %s' % r['lkr'])
    if not r['lus']: fail('earn', '목록 미국만 보기 이상')
    ls_ = r['lsox']
    if len(ls_['keys']) != r['soxN'] or not all(k.startswith('us-') for k in ls_['keys']) or not ls_['flags'] or 'SOX' not in ls_['title'] or ('전체 %d곳' % r['soxN']) not in ls_['info']:
        fail('earn', '필라델피아 반도체(SOX)만 보기 이상: %d곳(기대 %d) · %s · %s' % (len(ls_['keys']), r['soxN'], ls_['title'], ls_['info']))
    if not r['usNoX']: fail('earn', '미국 100 보기에 TOP 100 밖 종목이 섞임')
    ls = r['lsearch']
    if not ls['keys'] or not all(k == 'kr-' + d_kr0 for k in ls['keys'][:1]) or ls['sync'] != ls_name or '검색' not in ls['title']: fail('earn', '목록 검색칸 이상: %s' % ls)
    if 'us-AAPL' not in r['lsearch2']: fail('earn', '목록 검색 AAPL 결과에 애플 없음: %s' % r['lsearch2'][:5])
    if not r.get('dayOk'): fail('earn', '달력 날짜 선택 → 목록 이상 (%s)' % r.get('dayRows'))
    if not r['favKey'] or r['fav'] != [r['favKey']] or r['favRows'] != [r['favKey']]: fail('earn', '관심 기업 저장·보기 이상: %s / %s' % (r['fav'], r['favRows']))
    for m in r['modal']:
        w = 'earn ' + m['key']
        if not m['open'] or m['hash'] != '#co=' + m['key']: fail(w, '상세가 안 열리거나 주소(#co=) 이상: %s' % m['hash'])
        if m['kc'] != 8 or m['pc'] != 3: fail(w, '★ 핵심 카드 %d(기대 8) · PER 카드 %d(기대 3)' % (m['kc'], m['pc']))
        if m['ftRows'] < 15 or m['keyRows'] < 6 or m['cols'] < 5: fail(w, '분기 표 이상: 행 %d · ★행 %d · 열 %d' % (m['ftRows'], m['keyRows'], m['cols']))
        if m['eCols'] < 1: fail(w, '분기 표에 예상(E) 열이 없음')
        if m['yRows'] < 12: fail(w, '연간 표 행 %d' % m['yRows'])
        if '잉여현금흐름' not in (m.get('tip') or '') and '설비투자' not in (m.get('tip') or ''): fail(w, '표 행 설명(?)이 안 나옴: %r' % m.get('tip'))
        if '다음 실적발표' not in m['next']: fail(w, '다음 발표 상자 이상: %s' % m['next'][:60])
        if not m['closed']: fail(w, 'Esc 로 닫히지 않음')
    # 주소로 바로 열기 + 휴대폰 폭 상세 화면 넘침
    page.set_viewport_size({'width': 360, 'height': 780})
    page.goto(base + 'earnings-calendar/#co=us-AAPL', wait_until='load'); page.wait_for_timeout(2500)
    q = page.evaluate("""() => ({ open: !document.getElementById('er-modal').hidden, name: (document.getElementById('er-m-name') || {}).textContent || '',
        sw: document.documentElement.scrollWidth, vw: innerWidth,
        box: (b => b ? Math.round(b.getBoundingClientRect().right) : 0)(document.querySelector('.er-modal-box')) })""")
    if not q['open'] or 'AAPL' not in q['name']: fail('earn', '#co=us-AAPL 주소로 상세가 안 열림 (%s)' % q['name'][:40])
    if q['sw'] > q['vw'] + 1 or q['box'] > q['vw'] + 1: fail('earn', '360px 상세 화면 가로 넘침 (문서 %d · 상자 %d · 화면 %d)' % (q['sw'], q['box'], q['vw']))
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.evaluate("() => { try { localStorage.removeItem('er-fav'); } catch (e) {} }")
    for t in [t for t, u in errs if not ignorable(t, u)][:3]:
        fail('earn', '콘솔 오류: ' + t[:200])


IDX_KEYS = ['nasdaq', 'nasdaq100', 'dowjones', 'sp500', 'sox', 'djsemi', 'kospi', 'kospi200', 'kosdaq', 'n225', 'topix', 'sse',
            'csi300', 'szse', 'chinext', 'star50', 'hsi', 'hscei', 'hstech', 'taiex']


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
    learn = sorted(d for d in os.listdir(os.path.join(ROOT, 'learn')) if os.path.isfile(os.path.join(ROOT, 'learn', d, 'index.html'))) if os.path.isdir(os.path.join(ROOT, 'learn')) else []
    n_src = len([f for f in os.listdir(os.path.join(ROOT, 'content', 'learn')) if f.endswith('.html')]) if os.path.isdir(os.path.join(ROOT, 'content', 'learn')) else 0
    paths = [''] + [r['path'] + '/' for r in routes] + ['en/' + d + '/' for d in en] + (['learn/'] if learn or n_src else []) + ['learn/' + d + '/' for d in learn]
    if os.path.isfile(os.path.join(ROOT, 'content', 'books', 'books.json')):   # 자본가 서재(단계별 추천 도서 · scripts/build_books.py)
        paths.append('books/')
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
    # 라오어 공식 카페 글 번호: 사용자가 준 원문 PDF 머리글 주소(cafes/30372164/articles/<번호>)로 확인한 번호만 링크
    #   (㉑ 처음 배포 때 '<번호>?menuid' 의 '?' 를 '2' 로 잘못 읽어 끝에 2가 붙은 번호 8개를 링크했던 것을 바로잡으며 추가)
    CAFE_OK = {7398, 10092, 10792, 15158, 21554, 21650, 23962, 25600, 27906, 31450, 35632, 36050, 36602, 36699, 36924, 41720, 42247,
               46445, 48743, 48765, 51593, 52930, 53077, 55636, 59826, 59921, 64842, 66627, 67080, 77247, 79251, 79263, 79264, 79277, 85652,   # 무한매수법
               30918, 38944, 38945, 38947, 39070, 41908, 45493, 48851, 53752, 54744, 55637, 66498, 67082, 78505, 82129}                          # VR
    for _id in sorted(set(int(x) for x in re.findall(r'cafe\.naver\.com/infinitebuying/(\d+)', _src)) - CAFE_OK):
        fail('src', '라오어 카페 글 번호 %d 이(가) 원문 PDF 로 확인한 목록(CAFE_OK)에 없음' % _id)
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
    # 72루틴 시작일별 연평균 수익률·최대 낙폭 분포([T72-DIST] R72D — 순수 함수·카드 계산과 같음·문서 숫자 대조·나눠 실행·화면 문자열) — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'r72dist_test.js')], capture_output=True, text=True, timeout=300)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'r72dist_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('72', '시작일별 분포 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:400])
    # Worker ETF 실제 가격 경로(야후 줄 변환·네이버 일별 시세 쪽 찾기) 단독 확인 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_etf_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_etf_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', 'ETF 실제 가격 경로 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])
    # Worker 72루틴 PC 생존 감시(/hb · 알림 대상 암호화 · 놓친 주문 시각 알림 · 두 PC 경고) 단독 확인 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_hb_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_hb_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', '생존 감시(/hb) 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])
    # Worker 72루틴 PC 여러 대(/grp · 주문 권한 한 대만 · 이어받기 · 공유 상태 ver · 토큰·비밀값) 단독 확인 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_grp_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_grp_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', 'PC 여러 대(/grp) 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])
    # Worker SNS 자동 게시(/sns · 관리자만 · 연결 OAuth · 영상 조각·공개 주소 Range · 유튜브·인스타·스레드·페이스북 게시 단계 · 한 번만) 단독 확인 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_sns_test.mjs')], capture_output=True, text=True, timeout=300)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_sns_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', 'SNS 자동 게시(/sns) 검사 실패: ' + (' | '.join(l.strip() for l in _r.stdout.splitlines() if '✗' in l) or _r.stderr.strip())[:300])

    # Worker 건의 게시판(/board · 읽기·쓰기·고치기·지우기·공감·댓글·처리 상태·비밀글·닉네임 가림·횟수 제한·탈퇴 삭제) 단독 확인 — 진짜 SQLite(node:sqlite)
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_board_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_board_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', '건의 게시판(/board) 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stdout.strip()[-200:] or _r.stderr.strip())[:300])

    # Worker 방문자 수(/hit · 네이버 애널리틱스 기준 — 브라우저마다 하루 1번 · 남용 한도 · 봇 제외 · 해시만 저장) 단독 확인 — 진짜 SQLite(node:sqlite)
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'worker_visit_test.mjs')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'worker_visit_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('worker', '방문자 수(/hit) 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])

    # [STRATSIM] 투자전략 시뮬레이터 계산(고정 구간 기준값 — 원본과 대조 끝난 엔진) · 과최적화 탐색기 자료(행 수 · 다시 계산 일치) — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'stratsim_test.cjs')], capture_output=True, text=True, timeout=300)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'stratsim_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('stratsim', '계산·탐색기 자료 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:400])

    # [SMA200-ENG] SMA 200 백테스트 엔진 — 투자전략 시뮬레이터와 끝 금액 차이 0(무작위 조건·기간 700번) · 실전·양도세 독립 검산 250번 · 자료·프리셋 — node 가 있으면
    if not a.etf_audit and shutil.which('node'):
        _r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'sma200_test.cjs')], capture_output=True, text=True, timeout=300)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'sma200_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('sma200', '엔진 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:400])

    # 실적발표 캘린더: 야후가 늦은 미국 실적을 나스닥 달력 값으로 먼저(nq_merge) — 네트워크 없이
    if not a.etf_audit:
        _r = subprocess.run([sys.executable, os.path.join(ROOT, 'tests', 'earn_nq_test.py')], capture_output=True, text=True, timeout=120)
        print(_r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else 'earn_nq_test: 출력 없음', flush=True)
        if _r.returncode != 0:
            fail('earn', '나스닥 잠정 실적(nq_merge) 검사 실패: ' + (' | '.join(l for l in _r.stdout.splitlines() if l.startswith('FAIL')) or _r.stderr.strip())[:300])

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
        def attach(pg):   # 콘솔 오류·페이지 오류·HTTP 오류 수집 (관리자 검사 탭도 같은 목록에)
            pg.on('console', lambda m: errs.append((m.text, (m.location or {}).get('url', ''))) if m.type == 'error' else None)
            pg.on('pageerror', page_err)
            pg.on('response', bad_resp)
            pg.on('requestfailed', req_failed)
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
        def req_failed(q):
            if 'ERR_ABORTED' not in str(q.failure) and not any(d in q.url for d in THIRD) and not (local and ('workers.dev' in q.url or 'raw.githubusercontent' in q.url)):
                errs.append(('요청 실패 %s %s' % (q.failure, q.url[:160]), base))
        page.on('requestfailed', req_failed)

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
        RT = {r['path'] + '/': r for r in routes}
        for path in paths:
            errs.clear()
            page.set_viewport_size({'width': 1440, 'height': 900})
            resp = page.goto(base + path, wait_until='load', timeout=60000)
            try:
                raw = resp.text() if resp else ''
            except Exception:
                raw = ''
            if raw:
                seo_raw_check(path, raw, fail, RT.get(path))   # 처음 받은 HTML (광고·robots·h1·og:image·자동 요약·허브 해설)
            else:
                fail(path, '처음 받은 HTML 을 읽지 못함')
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
        pub = [r for r in routes if not r.get('admin')]          # 관리자 전용(자산 속도·72루틴)은 상단 메뉴에 없어야 함
        n = page.evaluate("document.querySelectorAll('[id^=\"drop-\"]').length")
        if n != len(pub) + 1:
            fail('', '메뉴 항목 %d개 (기대 %d = 홈 + 도구 %d)' % (n, len(pub) + 1, len(pub)))
        missing = page.evaluate("tabs => tabs.filter(t => !document.getElementById('drop-' + t))", [r['tab'] for r in pub])
        if missing:
            fail('', '메뉴에 없는 도구: ' + ', '.join(missing))
        shown = page.evaluate("tabs => tabs.filter(t => document.getElementById('drop-' + t))", [r['tab'] for r in routes if r.get('admin')])
        if shown:
            fail('', '관리자 전용 화면이 상단 메뉴에 보임: ' + ', '.join(shown))
        for q, want in [('연봉', '연봉'), ('무한', '무한매수법'), ('취득세', '취득세'), ('배당', '배당')]:
            res = page.evaluate("""async q => { const i = document.getElementById('ss-input'); i.focus(); i.value = q;
                i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 300));
                const l = document.getElementById('ss-list'); return { hidden: l.hidden, items: [...l.children].map(c => c.textContent) }; }""", q)
            if res['hidden'] or not any(want in t for t in res['items']):
                fail('', '검색 "%s" 결과에 "%s" 없음 (%s)' % (q, want, res['items'][:5]))
        for hub in [r for r in routes if r.get('hub')]:
            want = len([r for r in routes if r['group'] == hub['group'] and not r.get('hub') and not r.get('admin')])   # 관리자 전용은 허브에 없음
            page.goto(base + hub['path'] + '/', wait_until='load'); page.wait_for_timeout(500)
            got = page.evaluate("[...document.querySelectorAll('.app-page')].filter(p => getComputedStyle(p).display !== 'none').reduce((a, p) => a + p.querySelectorAll('.hub-card').length, 0)")
            if got != want:
                fail(hub['path'], '허브 카드 %d개 (같은 그룹 도구 %d개)' % (got, want))
            if hub['group'] in HUB_GUIDE:
                g = page.evaluate("() => { const s = document.querySelector('.hub-guide'); return s ? { vis: !!s.offsetParent, faq: s.querySelectorAll('details.g-faq').length, after: !!s.nextElementSibling && s.nextElementSibling.classList.contains('hub-next') } : null; }")
                if not g or not g['vis'] or g['faq'] < 4 or not g['after']:
                    fail(hub['path'], "허브 단계 해설(.hub-guide)이 안 보이거나 FAQ 4개 미만·'다음 단계' 앞이 아님: %s" % g)

        # 투자 공부 글 (애드센스 '가치 있는 콘텐츠' 보완) — 목록·글·도구 페이지 연결
        if n_src:
            print('[2-1] 투자 공부 글 %d편' % n_src, flush=True)
            if len(learn) != n_src:
                fail('learn', '글 페이지 %d개 (원본 content/learn %d편)' % (len(learn), n_src))
            page.goto(base + 'learn/', wait_until='load'); page.wait_for_timeout(300)
            got = page.evaluate("new Set([...document.querySelectorAll('a[href^=\"/learn/\"]')].map(a => a.getAttribute('href')).filter(h => /^\\/learn\\/[a-z0-9-]+\\/$/.test(h))).size")
            if got != n_src:
                fail('learn/', '목록의 글 링크 %d개 (기대 %d)' % (got, n_src))
            if page.evaluate("/\\d{4}년 \\d{1,2}월 \\d{1,2}일/.test(document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText)"):
                fail('learn/', '목록 카드에 날짜가 보임 (목록에서는 숨기기로 함)')
            seen = set()
            for d in learn:
                page.goto(base + 'learn/' + d + '/', wait_until='load'); page.wait_for_timeout(150)
                r = page.evaluate("""() => ({ h1: (document.querySelector('h1') || {}).textContent || '',
                    ads: !!document.querySelector('script[src*="adsbygoogle.js?client=ca-pub-8051182229751523"]'),
                    canon: (document.querySelector('link[rel=canonical]') || {}).href || '',
                    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { const j = JSON.parse(s.textContent); return (Array.isArray(j) ? j : [j]).map(x => x['@type']); } catch (e) { return ['ERR']; } }).flat(),
                    body: (document.querySelector('article') || {}).innerText || '',
                    links: [...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href').split('#')[0]) })""")
                if not r['h1'].strip(): fail('learn/' + d, '제목(h1) 없음')
                if not r['ads']: fail('learn/' + d, '애드센스 스크립트 없음')
                if not r['canon'].endswith('/learn/' + d + '/'): fail('learn/' + d, 'canonical 주소 이상: ' + r['canon'])
                if 'ERR' in r['ld'] or 'Article' not in r['ld']: fail('learn/' + d, '구조화 데이터 이상: %s' % r['ld'])
                if len(r['body']) < 1200: fail('learn/' + d, '본문이 짧음 (%d자)' % len(r['body']))
                if '—' == r['body'].strip() or '조회 중' in r['body']: fail('learn/' + d, '본문에 빈 값 표시')
                seen.update(r['links'])
            if local:   # 글에 있는 사이트 안 링크가 모두 실제 파일인지 (배포 사이트는 빌드 단계에서 검사)
                for h in sorted(seen):
                    f = os.path.join(ROOT, h.strip('/'), 'index.html') if h.endswith('/') else os.path.join(ROOT, h.lstrip('/'))
                    if h != '/' and not os.path.isfile(f):
                        fail('learn', '깨진 링크 ' + h)
            page.goto(base, wait_until='load'); page.wait_for_timeout(300)
            if page.evaluate("document.querySelectorAll('.learn-home .lr-card').length") < 6:
                fail('', '홈의 투자 공부 글 카드 6개 미만')
            # 자동 숫자({{키}})가 모두 채워졌는지 · 자동 갱신 글에 자료 기준일 표시
            for d in learn:
                page.goto(base + 'learn/' + d + '/', wait_until='load'); page.wait_for_timeout(100)
                r = page.evaluate("({ raw: document.body.innerHTML.includes('{{'), auto: !!document.querySelector('.meta .auto') })")
                if r['raw']: fail('learn/' + d, '채워지지 않은 자동 값 {{…}} 남음')
                if d in ('index-investing', 'leveraged-etf', 'reading-earnings', 'market-cap-world') and not r['auto']:
                    fail('learn/' + d, '자동 갱신 기준일 표시(.meta .auto) 없음')
        if 'books/' in paths:
            print('[2-1b] 자본가 서재', flush=True)
            books_check(page, base, fail, local)
        # 상단 메뉴 '투자 공부' · 좁은 화면에서도 메뉴 한 줄에 다 들어가는지 · 영어판에는 없음
        # 메뉴 9개(홈·투자 공부·영역 6개·커뮤니티)가 가로로 넘치지 않는지 — 320~1300px 를 10px 마다 + 줄바꿈 기준 바로 위·아래 (460px 아래는 두 줄)
        NAV_W = sorted(set(list(range(320, 1301, 10)) + [361, 461, 601, 871, 1141, 1251]))
        NAV_JS = """() => { const n = document.getElementById('mainNav'), c = document.getElementById('grp-community-btn');
                const nr = n.getBoundingClientRect(), cr = c ? c.getBoundingClientRect() : null, tops = new Set([...n.querySelectorAll(':scope > .tab-group')].map(g => Math.round(g.getBoundingClientRect().top)));
                return { sw: n.scrollWidth, cw: n.clientWidth, href: [...document.querySelectorAll('#grp-learn-drop a')].map(x => x.getAttribute('href')).join(','), rows: tops.size,
                         cin: !!cr && cr.width > 0 && cr.left >= nr.left - 1 && cr.right <= nr.right + 1,
                         order: [...n.querySelectorAll(':scope > .tab-group')].map(g => g.id).slice(0, 3).join(',') }; }"""
        page.goto(base + 'compound/', wait_until='load'); page.wait_for_timeout(300)
        bad = []
        for w in NAV_W:
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(60)
            r = page.evaluate(NAV_JS)
            if w in (320, 1440) and r['order'] != 'grp-home,grp-learn,grp-me': fail('compound/', "상단 메뉴 순서 이상 (홈 → 투자 공부 → 내 위치 기대): " + r['order'])
            if w == 320 and r['href'] != 'learn/,books/': fail('compound/', "상단 메뉴 '투자 공부' 드롭다운 링크 이상 (투자 공부 글 · 자본가 서재 기대): %s" % r['href'])
            if r['sw'] > r['cw'] + 1 or not r['cin'] or r['rows'] != (2 if w <= 460 else 1): bad.append('%d(%d>%d·커뮤니티 %s·%d줄)' % (w, r['sw'], r['cw'], r['cin'], r['rows']))
        if bad: fail('compound/', '상단 메뉴가 넘치거나 줄 수가 다름 (460px 이하 2줄 · 그 위 1줄 기대): ' + ', '.join(bad[:8]))
        if en:   # 영어판(메뉴 8개 · 750px 아래 두 줄) — 360px 이상 넘침 없음
            page.goto(base + 'en/' + en[0] + '/', wait_until='load'); page.wait_for_timeout(300)
            bad = []
            for w in [x for x in NAV_W if x >= 360]:
                page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(60)
                r = page.evaluate(NAV_JS)
                if r['sw'] > r['cw'] + 1 or not r['cin']: bad.append('%d(%d>%d)' % (w, r['sw'], r['cw']))
            if bad: fail('en/' + en[0], '영어판 상단 메뉴 넘침: ' + ', '.join(bad[:8]))
            page.goto(base + 'compound/', wait_until='load'); page.wait_for_timeout(300)
        page.set_viewport_size({'width': 1440, 'height': 900})
        r = page.evaluate("""() => ({ cols: [...document.querySelectorAll('.sf-map .sf-cols > .sf-col')].length,
            first: ((document.querySelector('.sf-map .sf-cols > .sf-col .sf-h') || {}).textContent || '').trim(),
            band: document.querySelectorAll('.sf-map .sf-band .sf-grp a').length })""")
        n_idx = sum(1 for x in routes if x['group'] == 'invest' and x['tab'] in IDX_KEYS)
        if r['first'] != '투자 공부': fail('compound/', "하단 사이트맵 첫 열이 '투자 공부'가 아님: " + r['first'])
        if r['cols'] != 8 or r['band'] != n_idx:   # 투자 공부 + 영역 6개 + 커뮤니티
            fail('compound/', '하단 사이트맵 열 %d개(기대 8) · 지수 묶음 %d개(기대 %d)' % (r['cols'], r['band'], n_idx))
        if en:
            page.goto(base + 'en/' + en[0] + '/', wait_until='load'); page.wait_for_timeout(200)
            if page.evaluate("!!document.getElementById('grp-learn') || !!document.getElementById('grp-learn-drop')"): fail('en/' + en[0], "영어판 상단 메뉴에 '투자 공부'(또는 드롭다운)가 남음")
        # 지수 20쪽 고유 해설 + 자동 통계
        for k in IDX_KEYS:
            page.goto(base + next(x['path'] for x in routes if x['tab'] == k) + '/', wait_until='load'); page.wait_for_timeout(150)
            r = page.evaluate("""() => { const s = document.querySelector('.idx-note'); if (!s || !s.offsetParent) return null;
                return { txt: s.querySelector('.in-text').innerText.length, rows: s.querySelectorAll('.in-tbl tr').length,
                         raw: s.innerHTML.includes('{{'), auto: s.querySelectorAll('.in-auto li').length }; }""")
            if not r: fail(k, '지수 해설(.idx-note)이 보이지 않음'); continue
            if r['txt'] < 500 or r['rows'] < 6 or r['raw'] or not r['auto']:
                fail(k, '지수 해설 이상: %s' % r)
        print('[2-4] 독립 페이지(소개·약관·개인정보·면책) · sitemap · 무한매수법·VR 정적 제목 · 자료 화면 자동 요약', flush=True)
        static_pages_check(page, base, fail, widths, routes, local)
        ssr_h1_check(br, page, base, fail)
        if local:   # 방문자 수 [VISIT-HIT] — 실제 도메인을 저장소 파일로 흉내 (실사이트에는 요청 안 함)
            visit_hit_check(br, fail)
        for r in [x for x in routes if x['tab'] in AUTOSUM_OF]:
            page.goto(base + r['path'] + '/', wait_until='load'); page.wait_for_timeout(300)
            a = page.evaluate("() => { const s = document.querySelector('.auto-sum'); return s ? { vis: !!s.offsetParent, rows: s.querySelectorAll('tbody tr').length, li: s.querySelectorAll('.in-auto li').length } : null; }")
            if not a or not a['vis'] or a['rows'] < 4 or a['li'] < 2:
                fail(r['path'], '자료 화면 자동 요약(.auto-sum)이 안 보이거나 비어 있음: %s' % a)
        print('[2-3] 관리자 전용 화면 잠금 · 자산 속도 시뮬레이터 · SMA 200 백테스트 · 72루틴 백테스트', flush=True)
        admin_lock_check(page, base, fail, routes)
        apage = admin_page(ctx, attach)
        aspeed_check(apage, base, fail, local)
        sma200_check(apage, base, fail, local)
        t72bt_check(apage, base, fail, local)
        print('[2-2] 커버드콜 코스피 비교 — 실제 종가(분배금 미반영)', flush=True)
        kcmp_check(page, base, fail, local)
        print('[2-5] 아파트 시세 순위 — 가격 구간', flush=True)
        apt_range_check(page, base, fail)
        print('[2-6] 공유 링크·내 저장함 — 주소 # 의 화면 상태(ETF 차트 비교 등)', flush=True)
        share_hash_check(br, base, local, fail)
        print('[2-7] 모든 화면 공유 — 설정값(버튼 묶음·화면별 상태·검색어)·결과 카드 · ETF 로그 눈금', flush=True)
        share_all_check(br, base, local, fail)
        for pth in ['compound/', 'earnings-calendar/', 'fire/']:
            page.goto(base + pth, wait_until='load'); page.wait_for_timeout(300)
            k = page.evaluate("[...document.querySelectorAll('.learn-rel .lr-card')].filter(a => a.offsetParent).length")
            if not k: fail(pth, '\'함께 읽으면 좋은 글\' 카드가 보이지 않음')

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
        # 화면 안 백테스트 카드 숫자 = '자세히 보기'로 연 시뮬레이터 숫자 (사이클이 끝나 센트 단위가 된 원금 · V2.2 T 올림까지 같은 조건으로 넘어가는지)
        if os.path.isdir(os.path.join(ROOT, 'muhan-backtest')):
            card = page.evaluate("""async () => {
              const W = ms => new Promise(r => setTimeout(r, ms)), st = MHdebug.store;
              const ses = st.sessions.filter(s => !s.archived && s.settings && s.settings.version === '2.2')[0];
              if (!ses) return { err: 'V2.2 세션 없음' };
              st.activeSessionId = ses.id; ses.settings = Object.assign({}, ses.settings, { totalCapital: 12345.67, tround: 'c1' });
              MHdebug.render();
              let r = null;
              for (let i = 0; i < 160; i++) { await W(250); r = Object.values(MHdebug.bt.cache).filter(x => x && x.cap === 12345.67 && (x.st === 'ok' || x.st === 'err'))[0]; if (r) break; }
              const a = document.querySelector('#mh-bt a');
              const out = r && r.st === 'ok' ? { href: a && a.getAttribute('href'), cagr: r.net.cagr, mdd: r.net.mdd, gcagr: r.gross.cagr, from: r.from, to: r.to } : { err: r ? r.msg || 'err' : '계산 안 끝남' };
              // 원금이 몇 센트만 바뀌어도(반올림하면 같은 12,346) · T 반올림만 바꿔도 카드를 다시 계산하는지 (예전 열쇠는 원금 반올림·T 반올림 없음 → 옛 결과를 그대로 보여 줌)
              const C = MHdebug.bt.cache, keys = () => Object.keys(C), done = k => C[k] && (C[k].st === 'ok' || C[k].st === 'err');
              const step = async (patch) => { const n0 = keys().length; ses.settings = Object.assign({}, ses.settings, patch); MHdebug.render();
                const k = keys()[keys().length - 1]; for (let i = 0; i < 160 && keys().length > n0 && !done(k); i++) await W(250);
                const b = document.querySelector('#mh-bt a'); return { added: keys().length - n0, cap: keys().length > n0 ? C[k].cap : null, href: b ? b.getAttribute('href') : '' }; };
              out.cents = await step({ totalCapital: 12345.89 }); out.tr = await step({ tround: 'r2' });
              return out;
            }""")
            if card.get('err') or not card.get('href'):
                fail('muhan', '화면 안 백테스트 카드 계산 실패: %s' % card.get('err'))
            else:
                if 'c=12345.67' not in card['href'] or 'tr=c1' not in card['href']:
                    fail('muhan', '자세히 보기 주소에 카드 조건이 빠짐 (원금 센트·T 올림): ' + card['href'][:200])
                ce, tr_ = card.get('cents') or {}, card.get('tr') or {}
                if ce.get('added') != 1 or ce.get('cap') != 12345.89 or 'c=12345.89' not in ce.get('href', '') or tr_.get('added') != 1 or 'tr=c1' in tr_.get('href', 'tr=c1'):
                    fail('muhan', '설정이 조금 바뀌어도 카드를 다시 계산해야 함 (원금 센트 %r · T 반올림 %r)' % (ce, tr_))
                page.goto('about:blank'); page.goto(base + card['href'], wait_until='load')
                page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().sn', timeout=90000)
                sim = page.evaluate("(() => { const R = MBTdebug.R(); return { cagr: R.sn.cagr, mdd: R.sn.mdd, gcagr: R.sg.cagr, from: R.D.d[R.net.from], to: R.D.d[R.net.to], cap: R.S.cap, tround: R.cfg.tround }; })()")
                if abs(sim['cagr'] - card['cagr']) > 1e-9 or abs(sim['mdd'] - card['mdd']) > 1e-9 or abs(sim['gcagr'] - card['gcagr']) > 1e-9 or sim['from'] != card['from'] or sim['to'] != card['to']:
                    fail('muhan', '화면 안 백테스트 카드와 시뮬레이터 숫자가 다름 — 카드 %r · 시뮬레이터 %r' % (card, sim))
            page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(1500)
        # 무한매수법 백테스트와 같은 세부 규칙·세금·수수료 (빈 저장소의 새 세션에서 — 위 V2.2 세션 검사가 끝난 뒤)
        page.evaluate("() => { localStorage.removeItem('muhan4-store'); }")
        page.goto('about:blank'); page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(1500)
        for t in page.evaluate(MUHANOPT_JS):
            if not t['ok']:
                fail('muhan', '세부 규칙 %s%s' % (t['name'], (' — ' + str(t.get('info'))[:300]) if t.get('info') else ''))
        page.goto('about:blank'); page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(500)
        page.evaluate("() => { localStorage.removeItem('muhan4-store'); }")
        bad = [t for t, u in errs if not ignorable(t, u)]
        for t in bad[:3]:
            fail('muhan', '버전 기록 콘솔 오류: ' + t[:200])
        # 글자 크기(CSS zoom) 130% 에서 그래프·⋮ 메뉴·72루틴 크게 보기 마우스 정확도 — 무한매수법 기록 · 72루틴(관리자 전용 화면)
        mh_zoom_check(page, base, 'muhan/', fail)
        zpage = admin_page(ctx, attach)
        mh_zoom_check(zpage, base, '72/', fail)
        zpage.close()
        page.goto(base + 'muhan/', wait_until='load'); page.wait_for_timeout(500)
        # 무한매수법 백테스트 화면
        if os.path.isdir(os.path.join(ROOT, 'muhan-backtest')):
            print('[3b] 무한매수법 백테스트', flush=True)
            errs.clear()
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&p=1', wait_until='load')
            for t in page.evaluate(MUHANBT_JS):
                if not t['ok']:
                    fail('muhan-backtest', '%s%s' % (t['name'], (' — ' + str(t.get('info'))[:200]) if t.get('info') else ''))
            # 닷컴버블 최고점 단추 — '상장 전 백테스트 포함'을 켰을 때만 눌러짐 · 누르면 1999~2000년 중 (재현) 종가가 가장 높았던 날이 시작일
            dot = page.evaluate("""async () => {
              const W = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), out = {};
              const setPre = async v => { const pre = $('mb-pre'); pre.checked = v; pre.dispatchEvent(new Event('change', { bubbles: true })); await W(80); };
              await setPre(false); out.offDis = !!($('mb-dot') && $('mb-dot').disabled);
              await setPre(true); out.onDis = $('mb-dot').disabled;
              // 기대값은 같은 종목을 상장 전 포함으로 돌린 결과의 일봉(재현 + 실제)에서 따로 구함
              document.querySelector('#mb-set [data-tk="TQQQ"]').click(); await W(80);   // TQQQ: 로컬 합성 재현도 1999년부터 있음
              const r0 = MBTdebug.R(); document.querySelector('#mb-set [data-act="run"]').click();
              for (let i = 0; i < 240 && !(MBTdebug.R() !== r0 && MBTdebug.R().S.pre); i++) await W(250);
              const D = MBTdebug.R().D; out.tk = MBTdebug.R().tk;
              let best = -1; for (let i = 0; i < D.d.length; i++) { if (D.d[i] < '1999-01-01' || D.d[i] > '2000-12-31') continue; if (best < 0 || D.c[i] > D.c[best]) best = i; }
              out.want = best >= 0 ? D.d[best] : null;
              $('mb-dot').click();
              for (let i = 0; i < 160 && ($('mb-dot').disabled || !$('mb-dot-msg')); i++) await W(250);
              out.from = MBTdebug.S().from; out.inp = $('mb-from').value; out.msg = ($('mb-dot-msg') || {}).textContent || '';
              return out; }""")
            if not dot['offDis'] or dot['onDis']:
                fail('muhan-backtest', "닷컴버블 최고점 단추가 '상장 전 포함'에 따라 켜지고 꺼지지 않음 %r" % dot)
            elif dot['want'] and (dot['from'] != dot['want'] or dot['inp'] != dot['want'] or dot['want'] not in dot['msg']):
                fail('muhan-backtest', '닷컴버블 최고점 시작일이 다름 (기대 %s) %r' % (dot['want'], dot))
            elif not dot['want'] and (local or '닷컴버블' not in dot['msg']):   # 로컬 합성 TQQQ 는 1999-03 부터라 반드시 찾아야 함
                fail('muhan-backtest', '닷컴버블 구간이 없는데 안내가 없음 %r' % dot)
            print('    닷컴버블 최고점: %s (%s)' % (dot['from'], dot['msg'][:60]), flush=True)
            # 기본값: 종목 SOXL · 수수료 0.25% (예전 기본 0.07% 로 저장된 조건은 한 번 0.25% 로 · 새로 고른 0.07% 는 그대로)
            dfl = []
            for seed, want_fee in [(None, 0.25), ('{"ver":"2.2","tk":"TQQQ","fee":0.07}', 0.25), ('{"ver":"2.2","tk":"TQQQ","fee":0.07,"sv":2}', 0.07), ('{"ver":"2.2","tk":"TQQQ","fee":0.1}', 0.1)]:
                page.evaluate("v => { localStorage.removeItem('mbt-settings'); if (v) localStorage.setItem('mbt-settings', v); }", seed)
                page.goto('about:blank'); page.goto(base + 'muhan-backtest/', wait_until='load')
                page.wait_for_function('window.MBTdebug && MBTdebug.S()', timeout=30000)
                g = page.evaluate("(() => { const S = MBTdebug.S(); return { tk: S.tk, custom: S.custom, fee: S.fee, on: !!document.querySelector('#mb-set [data-fee=\"0.25\"].on') }; })()")
                want_tk = 'SOXL' if seed is None else 'TQQQ'
                if g['tk'] != want_tk or g['custom'] or abs(g['fee'] - want_fee) > 1e-12 or (want_fee == 0.25) != g['on']:
                    dfl.append('%s → %r (기대 %s · %s%%)' % (seed, g, want_tk, want_fee))
            page.evaluate("() => localStorage.removeItem('mbt-settings')")
            for x in dfl:
                fail('muhan-backtest', '기본값(SOXL · 수수료 0.25%%) 이상: %s' % x)
            # 실행 기록 → '이 조건으로 무한매수법 시작': 기록 화면 새 세션(진행 중 세션은 그대로)의 시작 화면에 조건이 채워지고, 시작하면 그 설정
            if os.path.isdir(os.path.join(ROOT, 'muhan')):
                page.evaluate("""() => { localStorage.removeItem('mbt-history');
                  localStorage.setItem('muhan4-store', JSON.stringify({ activeSessionId: 'a1', sessions: [{ id: 'a1', name: 'TQQQ 40분할', settings: { ticker: 'TQQQ', splits: 40, totalCapital: 20000, targetProfit: 15, bigNumPercent: 12, lowerLocLines: 8, lowerLocShares: 1 },
                    transactions: [], isReverseMode: false, reverseStarPrice: null, archivedCycles: [], midEntry: null }] })); }""")
                PH = '#v=2.1&t=SOXL&c=20000&sp=10&tg=100&pt=4&cp=6&bg=10&ln=5&sh=2&x=hold&r=rsi&ao=-1.5&m=simple&id=1&fe=0.1&tm=avg&hv=1&dv=0'   # 세부 규칙·세금·수수료까지 모두 바꾼 조건
                page.goto('about:blank'); page.goto(base + 'muhan-backtest/' + PH, wait_until='load')
                pr = None
                try:
                    page.wait_for_function('window.MBTdebug && MBTdebug.R() && document.getElementById("mb-save")', timeout=90000)
                    page.evaluate("() => document.getElementById('mb-save').click()"); page.wait_for_timeout(100)
                    with page.expect_navigation(timeout=30000):
                        page.evaluate("() => document.querySelector('#mb-hist [data-hgo=\"0\"]').click()")
                    page.wait_for_function('window.MH && MH.setup && MH.setup.preset', timeout=30000)
                except Exception as e:
                    fail('muhan-backtest', '실행 기록 → 무한매수법 시작: 저장·이동·조건 채우기 실패 (%s)' % str(e).split('\n')[0][:160])
                pr = (page.evaluate("""async () => { const u = MH.setup, W = ms => new Promise(r => setTimeout(r, ms)), st = MHdebug.store;
                  const o = { u: { ver: u.ver, ticker: u.ticker, custom: u.custom, splits: u.splits, spc: u.spc, target: u.target, big: u.big, part: u.part, capP: u.capP, lines: u.lines, shares: u.shares, exhaust: u.exhaust, cap: u.cap,
                      avgOff: u.avgOff, money: u.money, restart: u.restart, rebase: u.rebase, ideal: u.ideal, fee: u.fee, tax: u.tax, method: u.method, harvest: u.harvest, divs: u.divs, more: u.more },
                    note: (document.getElementById('mh-preset') || {}).innerText || '', dis: document.querySelector('[data-act="su-start"]').disabled, live: st.sessions.filter(s => !s.archived).length, left: localStorage.getItem('muhan4-preset'),
                    sum: (document.querySelector('.mh-sumore') || {}).innerText || '', pre: Object.keys(MHdebug.bt.cache) };   /* 넘어온 조건 전에 예전 세션(a1)을 먼저 그려 그 카드를 계산하면 안 됨 */
                  document.querySelector('[data-act="su-start"]').click(); await W(300);
                  const a = st.sessions.filter(s => s.id === st.activeSessionId)[0], old = st.sessions.filter(s => s.id === 'a1')[0];
                  o.s = a.settings; o.oldOk = !!(old && old.settings && old.settings.ticker === 'TQQQ' && old.settings.splits === 40); o.n = st.sessions.length;
                  /* 시작한 세션의 '이 설정으로 백테스트' 카드 — 같은 조건 그대로 계산 (아래에서 시뮬레이터 숫자와 비교) */
                  /* 지금 화면 카드의 열쇠(data-btk)로 찾음 — 원금이 같은 다른 세션(a1 TQQQ $20,000) 카드와 섞이지 않게 */
                  let r = null; for (let i = 0; i < 240; i++) { const ch = document.querySelector('#mh-bt .mh-bt-ch'), x = ch && MHdebug.bt.cache[ch.getAttribute('data-btk')]; if (x && (x.st === 'ok' || x.st === 'err')) { r = x; break; }
                    const er = document.querySelector('#mh-bt .mh-bad'); if (er) { r = { st: 'err', msg: er.textContent }; break; } await W(250); }
                  const ah = document.querySelector('#mh-bt a');
                  o.card = r && r.st === 'ok' ? { href: ah && ah.getAttribute('href'), cagr: r.net.cagr, mdd: r.net.mdd, gcagr: r.gross.cagr, from: r.from, to: r.to, sub: ((document.querySelector('#mh-bt') || {}).innerText || '').slice(0, 300) } : { err: r ? r.msg || 'err' : '계산 안 끝남' };
                  return o; }""") if page.evaluate("() => !!(window.MH && MH.setup && MH.setup.preset)") else None)
                wu = {'ver': '2.1', 'ticker': 'SOXL', 'custom': False, 'splits': 10, 'spc': '10', 'target': '100', 'big': '10', 'part': '4', 'capP': '6', 'lines': '5', 'shares': '2', 'exhaust': 'hold', 'cap': '20000',
                      'avgOff': '-1.5', 'money': 'simple', 'restart': 'rsi', 'rebase': False, 'ideal': True, 'fee': '0.1', 'tax': True, 'method': 'avg', 'harvest': True, 'divs': False, 'more': True}
                if pr is None: pr = {'u': {}, 'dis': True, 'live': 0, 'left': None, 'note': '', 'oldOk': False, 's': {}, 'sum': '', 'pre': [], 'card': {'err': '시작 화면 없음'}}
                bu = [k for k, v in wu.items() if pr['u'].get(k) != v]
                s_ = pr.get('s') or {}
                ws = {'version': '2.1', 'targetProfit': 100, 'splits': 10, 'partPct': 4, 'capPct': 6, 'lowerLocLines': 5, 'lowerLocShares': 2, 'exhaust': 'hold', 'totalCapital': 20000, 'ticker': 'SOXL',
                      'avgOff': -1.5, 'money': 'simple', 'restart': 'rsi', 'ideal': True, 'btFee': 0.1, 'btMethod': 'avg', 'btHarvest': True, 'btDivs': False, 'cycleNo': 1}
                bs = [k for k, v in ws.items() if s_.get(k) != v] + [k for k in ('btTax', 'rebase', 'tround') if k in s_]
                note = pr['note']
                nbad = [w for w in ('RSI 60 이하', '평단 괴리 −1.5%', '단리', '정액(소수 주)', '수수료 0.1%', '이동평균', '연말 절세', '분배금 끔', '그대로') if w not in note] + [w for w in ('빼고',) if w in note]
                if bu or bs or nbad or pr['dis'] or pr['live'] != 2 or pr['left'] is not None or not pr['oldOk']:
                    fail('muhan-backtest', '실행 기록 → 무한매수법 시작 이상 — 다른 칸 %s · 저장 설정 %s · 안내 %s · %r' % (bu, bs, nbad, {k: pr[k] for k in ('u', 'dis', 'live', 'left', 'oldOk', 's', 'note')}))
                if pr.get('pre'):
                    fail('muhan-backtest', '실행 기록 → 무한매수법: 넘어온 조건보다 예전 세션이 먼저 그려져 그 백테스트 카드까지 계산함 %r' % pr['pre'][:2])
                cd = pr.get('card') or {}
                if cd.get('err') or not cd.get('href'):
                    fail('muhan-backtest', '실행 기록으로 시작한 세션의 백테스트 카드 계산 실패: %s' % cd.get('err'))
                else:
                    miss = [x for x in ('ao=-1.5', 'm=simple', 'r=rsi', 'id=1', 'fe=0.1', 'tm=avg', 'hv=1', 'dv=0', 'x=hold', 'pt=4', 'cp=6', 'ln=5', 'sh=2') if x not in cd['href'].split('#', 1)[-1].split('&')]
                    page.goto('about:blank'); page.goto(base + cd['href'], wait_until='load')
                    page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().sn', timeout=90000)
                    sim = page.evaluate("(() => { const R = MBTdebug.R(); return { cagr: R.sn.cagr, mdd: R.sn.mdd, gcagr: R.sg.cagr, from: R.D.d[R.net.from], to: R.D.d[R.net.to], S: { avgOff: R.S.avgOff, money: R.S.money, restart: R.S.restart, ideal: R.S.ideal, fee: R.S.fee, method: R.S.method, harvest: R.S.harvest, divs: R.S.divs } }; })()")
                    if miss or abs(sim['cagr'] - cd['cagr']) > 1e-9 or abs(sim['mdd'] - cd['mdd']) > 1e-9 or abs(sim['gcagr'] - cd['gcagr']) > 1e-9 or sim['from'] != cd['from'] or sim['to'] != cd['to']:
                        fail('muhan-backtest', '실행 기록으로 시작한 세션의 카드 ≠ 시뮬레이터 — 주소에 빠짐 %s · 카드 %r · 시뮬레이터 %r' % (miss, cd, sim))
                    print('    실행 기록 → 기록 화면 카드 = 시뮬레이터: CAGR %.4f%% · MDD %.4f%% (%s~%s)' % (cd['cagr'] * 100, cd['mdd'] * 100, cd['from'], cd['to']), flush=True)
                page.evaluate("() => { localStorage.removeItem('muhan4-store'); localStorage.removeItem('mbt-history'); }")
            # 주소만으로 같은 조건 — 평단 괴리율·취득가액·연말 절세·분배금(V2.1) · T 반올림(V2.2) 이 주소에 남고 다시 열면 그대로
            for h, want in [('#v=2.1&t=SOXL&c=20000&sp=33&tg=12.5&pt=4&cp=6&bg=10&fe=0.1&ln=5&sh=2&x=hold&r=rsi&ao=-1.5&tm=avg&hv=1&dv=0',
                             {'ver': '2.1', 'tk': 'SOXL', 'cap': 20000, 'splits': 33, 'target': 12.5, 'part': 4, 'capP': 6, 'big': 10, 'fee': 0.1, 'lines': 5, 'shares': 2, 'exhaust': 'hold', 'restart': 'rsi', 'avgOff': -1.5, 'method': 'avg', 'harvest': True, 'divs': False}),
                            ('#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&tr=c1&m=simple', {'ver': '2.2', 'tround': 'c1', 'money': 'simple', 'method': 'fifo', 'harvest': False, 'divs': True})]:
                page.goto('about:blank'); page.goto(base + 'muhan-backtest/' + h, wait_until='load')   # 주소 #만 바뀌면 새로 열리지 않으므로 빈 화면을 거쳐 다시 엶
                page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().S', timeout=60000)
                got = page.evaluate("(() => { const S = MBTdebug.R().S; return { S: S, hash: location.hash }; })()")
                bad_k = [k for k, v in want.items() if got['S'].get(k) != v]
                hs = got['hash'].lstrip('#').split('&')
                if bad_k or any(x not in hs for x in h.lstrip('#').split('&')):
                    fail('muhan-backtest', '주소 조건 복원/유지 실패 %s — %s · 주소 %s' % (h[:40], ', '.join('%s=%r' % (k, got['S'].get(k)) for k in bad_k), got['hash'][:160]))
            # 계산(cfgOf)에 쓰는 버전별 설정은 화면에도 칸이 있어야 함 — 주소로만 바뀌고 안 보이는 값이 없게 (V2.0·V2.1 평단 괴리율이 빠져 있었음)
            NEED = {'1.0': ['mb-tg', 'mb-big', 'mb-avgoff'], '2.0': ['mb-tg', 'mb-big', 'mb-pt', 'mb-cp', 'mb-avgoff'], '2.1': ['mb-tg', 'mb-big', 'mb-pt', 'mb-cp', 'mb-avgoff', 'mb-ln', 'mb-sh'],
                    '2.2': ['mb-tg', 'mb-big', 'mb-ln', 'mb-sh'], '3.0': ['mb-tg', 'mb-big', 'mb-ln', 'mb-sh', 'mb-rebase'], '4.0': ['mb-tg', 'mb-big', 'mb-ln', 'mb-sh', 'mb-nobig']}
            NOT = ['mb-tg', 'mb-big', 'mb-pt', 'mb-cp', 'mb-avgoff', 'mb-ln', 'mb-sh', 'mb-rebase', 'mb-nobig']
            for ver, ids in NEED.items():
                h = '#v=%s&t=TQQQ&c=10000&sp=40&tg=10%s' % (ver, '&ao=-2' if 'mb-avgoff' in ids else '')
                page.goto('about:blank'); page.goto(base + 'muhan-backtest/' + h, wait_until='load')
                page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().S', timeout=60000)
                got = page.evaluate("ids => ids.map(i => { const e = document.getElementById(i); return e ? (e.type === 'checkbox' ? 'chk' : e.value) : null; })", NOT)
                have = {i: v for i, v in zip(NOT, got) if v is not None}
                miss = [i for i in ids if i not in have]; extra = [i for i in have if i not in ids]
                if miss or extra or ('mb-avgoff' in ids and have.get('mb-avgoff') != '-2'):
                    fail('muhan-backtest', 'V%s 설정 칸이 계산과 다름 — 빠짐 %s · 남음 %s · 평단 괴리율 칸 %r' % (ver, miss, extra, have.get('mb-avgoff')))
            # 설정 1~7 접이식(종합소득세 계산기와 같은 .inc-sec) — 처음엔 1번만 펼침 · 접은 요약 = 지금 조건(기본값과 다르면 파란색) · 펼친 상태는 다시 그려도·새로 열어도 그대로 ·
            # 입력하는 동안 요약 갱신 · 모두 펼친 채 버전마다 좁은 화면 넘침 없음 · V4.0 고급엔 정액 단추 없음
            ST = "() => [...document.querySelectorAll('#mb-set .mb-acc')].map(d => ({ k: d.dataset.sec, open: d.open, v: d.querySelector('.inc-sec-v').textContent, on: d.querySelector('.inc-sec-v').classList.contains('on') }))"
            page.evaluate("() => { localStorage.removeItem('mbt-open'); localStorage.removeItem('mbt-settings'); }")
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/', wait_until='load')
            page.wait_for_function("document.querySelectorAll('#mb-set .mb-acc').length === 7", timeout=30000)
            a0 = page.evaluate(ST)
            if [x['k'] for x in a0] != ['ver', 'tk', 'per', 'rule', 'exh', 'tax', 'adv'] or [x['open'] for x in a0] != [True] + [False] * 6 or not all(x['v'] for x in a0) or any(x['on'] for x in a0):
                fail('muhan-backtest', '설정 접이식 처음 상태가 다름 (1번만 펼침 · 요약 · 기본값은 회색) %r' % a0)
            page.click('#mb-set .mb-acc[data-sec="rule"] > summary'); page.wait_for_timeout(450)
            page.evaluate("""() => document.querySelector('#mb-set [data-ver="2.1"]').click()"""); page.wait_for_timeout(150)
            a1 = page.evaluate(ST)
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/', wait_until='load')
            page.wait_for_function("document.querySelectorAll('#mb-set .mb-acc').length === 7", timeout=30000)
            a2 = page.evaluate(ST)
            page.focus('#mb-set .mb-acc[data-sec="ver"] > summary'); page.keyboard.press('Enter')
            try:   # 닫는 모션(220ms)이 끝날 때까지 — 고정 450ms 는 페이지가 바쁠 때(큰 스크립트·자료 처리) 모자라 가끔 '안 닫힘'으로 잘못 실패했음
                page.wait_for_function("() => { const d = document.querySelector('#mb-set .mb-acc[data-sec=\"ver\"]'); return d && !d.open && d._accTarget == null; }", timeout=5000)
            except Exception:
                pass   # 정말 안 닫히면 아래 a3 검사가 실패로 알림
            page.evaluate("""() => { const e = document.getElementById('mb-cap'); e.value = '25000'; e.dispatchEvent(new Event('input', { bubbles: true }));
                                     const t = document.getElementById('mb-tg'); t.value = '12.5'; t.dispatchEvent(new Event('input', { bubbles: true })); }""")
            a3 = {x['k']: x for x in page.evaluate(ST)}
            op = [True, False, False, True, False, False, False]
            if [x['open'] for x in a1] != op or [x['open'] for x in a2] != op or not a2[0]['v'].startswith('V2.1') or a3['ver']['open'] \
                    or '$25,000' not in a3['per']['v'] or not a3['per']['on'] or '최종 12.5%' not in a3['rule']['v'] or not a3['rule']['on']:
                fail('muhan-backtest', '설정 접이식 펼침 기억·입력 즉시 요약 실패 — 다시 그림 %r · 새로 엶 %r · 입력 뒤 %r' % ([x['open'] for x in a1], [x['open'] for x in a2], a3))
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.1&t=SOXL&c=20000&sp=33&tg=12.5&pt=4&cp=6&bg=10&fe=0.1&ln=5&sh=2&x=hold&r=rsi&ao=-1.5&tm=avg&hv=1&dv=0', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().S', timeout=60000)
            a4 = {x['k']: x for x in page.evaluate(ST)}
            want = {'tk': ('SOXL · 반도체 3배', False), 'per': ('처음부터 오늘까지 · $20,000', True),
                    'rule': ('33분할 · 최종 12.5% · 1차 4% · 큰수 10% · 큰수 상한 +6% · 평단 괴리 −1.5% · 하방 LOC 5줄×2주', True),
                    'exh': ('목표가까지 보유 · 새 사이클 RSI 60 이하', True), 'tax': ('수수료 0.1% · 양도세 22%(이동평균) · 연말 절세 · 분배금 끔', True), 'adv': ('실제 주문(1주 단위)', False)}
            badw = ['%s %r' % (k, a4[k]) for k, (t, on) in want.items() if a4[k]['v'] != t or a4[k]['on'] != on]
            if badw:
                fail('muhan-backtest', '주소로 연 조건의 접은 요약이 다름: ' + ' / '.join(badw))
            # ㉝ 증권사 주문 거부(rj) — 주소 rj=s 왕복 · 7. 고급 설정 요약 · 결과의 세 가지 비교 = 엔진 직접(옵션·자료를 따로 만들어) · 로컬은 시가를 만들어 넣어 거부가 생기게
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=1.0&t=SOXL&c=100000&sp=72&tg=52.5&bg=13&fe=0.25&x=recover&rj=s', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().cmp', timeout=90000)
            rjs = page.evaluate("""async (live) => {
              const W = ms => new Promise(r => setTimeout(r, ms)), out = [], okk = (n, c, i) => out.push([n, !!c, i == null ? '' : String(i).slice(0, 300)]);
              let R = MBTdebug.R(); const S = MBTdebug.S(), sa = document.getElementById('mb-sum-adv');
              okk('주소 rj=s → 그날 건너뛰기 · 고급 설정 요약(파란 글씨) · 주소 왕복', S.rej === 'skip' && R.rej && R.rej.mode === 'skip' && /(^|&|#)rj=s(&|$)/.test(location.hash) && /주문 거부 그날 건너뛰기/.test(sa.textContent) && sa.classList.contains('on'), location.hash + ' | ' + sa.textContent);
              if (!live) { const D0 = await MBT.load('SOXL'); D0.o = D0.c.map((c, i) => i ? (i % 3 === 0 ? D0.c[i - 1] * 0.93 : D0.c[i - 1]) : c);
                document.querySelector('#mb-set [data-act="run"]').click(); for (let i = 0; i < 400; i++) { const r2 = MBTdebug.R(); if (r2 && r2 !== R && r2.cmp) break; await W(150); } R = MBTdebug.R(); }
              const D = await MBT.load('SOXL'), F = R.S.tax ? await MBT.fxData().catch(() => null) : null, fx = F ? MBT.fxFor(D.d, F) : null, cap = 100000, cfg = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, exhaust: 'recover', ideal: false });
              const base = { from: 1, to: D.d.length - 1, capital: cap, norm: 'auto', rows: false }, eq = (a, b) => ['final', 'cagr', 'mdd'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
              const bad = [], vals = {};
              for (const m of ['none', 'clamp', 'skip']) { const rj = m === 'none' ? null : { mode: m, cap: 1.2 };
                const A = MHV.run(cfg, D, Object.assign({}, base, { fee: 0.0025, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: 'fifo', harvest: false } : null, rej: rj })), G = MHV.run(cfg, D, Object.assign({}, base, { fee: 0, sec: 0, divTax: 0, tax: null, rej: rj }));
                const a = MBT.stats(A, D, cap), g = MBT.stats(G, D, cap); vals[m] = [a.cagr, A.rj && A.rj.days];
                if (!R.cmp || !eq(R.cmp[m].sn, a) || !eq(R.cmp[m].sg, g) || JSON.stringify(R.cmp[m].rjN) !== JSON.stringify(A.rj)) bad.push(m); }
              okk('결과 거부 비교 3가지 = 엔진 직접 (포함·미포함 · 통계)', !bad.length && eq(R.sn, R.cmp.skip.sn), bad.join(',') + ' ' + JSON.stringify(vals));
              okk('거부가 실제로 생김 · 위 결과 = 그날 건너뛰기 · 거부 일수 표시', R.net.rj && R.net.rj.days > 0 && R.net.rj.miss <= R.net.rj.days && document.querySelector('.mb-rj').innerText.includes(R.net.rj.days.toLocaleString() + '일') && document.querySelector('.mb-rj tr.on').getAttribute('data-rj') === 'skip', JSON.stringify(R.net.rj));
              const tr = [...document.querySelectorAll('.mb-rj tbody tr')], pc = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(2) + '%';
              okk('비교 표 3줄 = 계산 값', tr.length === 3 && ['none', 'clamp', 'skip'].every((m, i) => tr[i].cells[1].textContent === pc(R.cmp[m].sn.cagr)), tr.map(x => x.innerText.replace(/\\s+/g, ' ')).join(' | '));
              okk('계산 가정에 거부 설명', /증권사 주문 거부\\(그날 건너뛰기\\)/.test(document.querySelector('.mb-assume').innerText));
              return out; }""", not local)
            for nm, okv, info in rjs:
                if not okv:
                    fail('muhan-backtest', '주문 거부 ' + nm + (' — ' + info if info else ''))
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&rj=c&e=2012-12-31', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().cmp', timeout=90000)
            rjc = page.evaluate("() => [MBTdebug.S().rej, /(^|&|#)rj=c(&|$)/.test(location.hash), document.querySelectorAll('.mb-rj tbody tr').length, document.querySelector('.mb-rj tr.on').getAttribute('data-rj')]")
            if rjc != ['clamp', True, 3, 'clamp']:
                fail('muhan-backtest', '주소 rj=c → 한도로 낮춰 넣기 복원·비교 표 실패 %r' % rjc)
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&e=2012-12-31', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().S', timeout=90000)
            if page.evaluate("() => [MBTdebug.S().rej, !!MBTdebug.R().rej, !!document.querySelector('.mb-rj'), /rj=/.test(location.hash)]") != ['', False, False, False]:
                fail('muhan-backtest', '주소에 rj 가 없으면 거부 반영 안 함(카드 없음)이어야 함')
            # ㉞ 주문 넣는 때(ft) — 주소 ft=p 왕복 · 고급 설정 요약 · 결과의 세 시각 비교 = 엔진 직접(거부 처리 그날 건너뛰기와 함께) · 프리장 시작이면 거부 기준 = 전날 종가
            #   로컬은 이틀마다 시가 = 그날 고가로 만들어 넣어 정규장 시작 전과 차이가 생기게, 배포는 실제 시가
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=1.0&t=SOXL&c=100000&sp=72&tg=52.5&bg=13&fe=0.25&x=recover&rj=s&ft=p', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().cmp && MBTdebug.R().fcmp', timeout=90000)
            fls = page.evaluate("""async (live) => {
              const W = ms => new Promise(r => setTimeout(r, ms)), out = [], okk = (n, c, i) => out.push([n, !!c, i == null ? '' : String(i).slice(0, 300)]);
              let R = MBTdebug.R(); const S = MBTdebug.S(), sa = document.getElementById('mb-sum-adv');
              okk('주소 ft=p → 프리장 시작 주문 · 고급 설정 요약(파란 글씨) · 주소 왕복(rj=s 와 함께)', S.fill === 'pre' && R.fill === 'pre' && /(^|&|#)ft=p(&|$)/.test(location.hash) && /(^|&|#)rj=s(&|$)/.test(location.hash) && /프리장 시작 주문/.test(sa.textContent) && sa.classList.contains('on'), location.hash + ' | ' + sa.textContent);
              if (!live) { const D0 = await MBT.load('SOXL'); D0.o = D0.c.map((c, i) => i % 2 === 0 && D0.h ? Math.max(D0.h[i], c) : i ? D0.c[i - 1] : c);
                document.querySelector('#mb-set [data-act="run"]').click(); for (let i = 0; i < 400; i++) { const r2 = MBTdebug.R(); if (r2 && r2 !== R && r2.cmp && r2.fcmp) break; await W(150); } R = MBTdebug.R(); }
              const D = await MBT.load('SOXL'), F = R.S.tax ? await MBT.fxData().catch(() => null) : null, fx = F ? MBT.fxFor(D.d, F) : null, cap = 100000, cfg = Object.assign(MHV.defaults('1.0', 'SOXL'), { splits: 72, target: 52.5, big: 13, exhaust: 'recover', ideal: false });
              const base = { from: 1, to: D.d.length - 1, capital: cap, norm: 'auto', rows: false }, eq = (a, b) => ['final', 'cagr', 'mdd'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
              const run = (fill, rj, net) => MHV.run(cfg, D, Object.assign({}, base, net ? { fee: 0.0025, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: 'fifo', harvest: false } : null } : { fee: 0, sec: 0, divTax: 0, tax: null }, { rej: rj, fill }));
              const bad = [], vals = {};
              for (const m of ['none', 'open', 'pre']) { const f = m === 'none' ? null : m, A = run(f, { mode: 'skip', cap: 1.2 }, true), G = run(f, { mode: 'skip', cap: 1.2 }, false), a = MBT.stats(A, D, cap), g = MBT.stats(G, D, cap); vals[m] = [a.cagr, A.fx && A.fx.days, A.rj.days];
                const x = R.fcmp && R.fcmp[m]; if (!x || !eq(x.sn, a) || !eq(x.sg, g) || JSON.stringify(x.fxN) !== JSON.stringify(A.fx) || JSON.stringify(x.fxG) !== JSON.stringify(G.fx) || JSON.stringify(x.rjN) !== JSON.stringify(A.rj)) bad.push(m); }
              okk('결과 주문 넣는 때 비교 3가지 = 엔진 직접 (그날 건너뛰기와 함께 · 포함·미포함 · 통계) · 위 결과 = 프리장 시작', !bad.length && eq(R.sn, R.fcmp.pre.sn), bad.join(',') + ' ' + JSON.stringify(vals));
              okk('정규장 시작 전: 비싸게 팔린 날 있음 · 기존 계산은 통계 없음 · 정규장 시작 전·기존은 그날 시가 기준이라 거부 있음', R.fcmp.open.fxN.days > 0 && R.fcmp.none.fxN === null && R.fcmp.open.rjN.days > 0 && R.fcmp.none.rjN.days > 0, JSON.stringify(vals));
              const badr = [];
              for (const m of ['none', 'clamp', 'skip']) { const rj = m === 'none' ? null : { mode: m, cap: 1.2 }, A = run('pre', rj, true); if (!R.cmp || !eq(R.cmp[m].sn, MBT.stats(A, D, cap)) || JSON.stringify(R.cmp[m].rjN) !== JSON.stringify(A.rj)) badr.push(m); }
              okk('프리장 시작 × 거부 비교 3가지 = 엔진 직접 · 기준 전날 종가 → 상단 매수선 +13% 거부 0일 · 세 처리 같음', !badr.length && R.cmp.clamp.rjN.days === 0 && R.cmp.skip.rjN.days === 0 && R.cmp.skip.sn.final === R.cmp.none.sn.final, badr.join(',') + ' ' + JSON.stringify([R.cmp.clamp.rjN, R.cmp.skip.rjN]));
              const fc = document.querySelector('.mb-fl'), tr = fc ? [...fc.querySelectorAll('tbody tr')] : [], pc = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(2) + '%';
              okk('주문 넣는 때 표 3줄 = 계산 값 · 고른 줄 = 프리장 시작 · 거부 열 · 카드 순서(주문 넣는 때 → 거부)', tr.length === 3 && ['none', 'open', 'pre'].every((m, i) => tr[i].cells[1].textContent === pc(R.fcmp[m].sn.cagr) && tr[i].getAttribute('data-fl') === m) && fc.querySelector('tr.on').getAttribute('data-fl') === 'pre' &&
                  tr[1].cells[4].textContent === R.fcmp.open.fxN.days.toLocaleString() + '일' && tr[0].cells[4].textContent === '—' && fc.querySelectorAll('thead th').length === 6 && !!(fc.compareDocumentPosition(document.querySelector('.mb-rj')) & 4), tr.map(x => x.innerText.replace(/\\s+/g, ' ')).join(' | '));
              const rjh = document.querySelector('.mb-rj').innerText, asm = document.querySelector('.mb-assume').innerText;
              okk('거부 카드 기준 = 전날 종가 × 1.2 · 계산 가정에 프리장 시작 · 거부 기준 전날 종가(근사라는 설명)', /전날 종가 × 1\\.2 \\(프리장 시작 주문\\)/.test(rjh) && /프리장 시작\\(한국 오후 5~6시\\) 주문/.test(asm) && /주문 넣는 때 가격\\(전날 종가 — 프리장 시작 주문\\)/.test(asm) && /프리장 시작의 전날 종가 기준은 근사/.test(asm) && /전날 종가로 근사/.test(document.querySelector('.mb-fl').innerText), rjh.slice(0, 120) + ' | ' + asm.slice(0, 200));
              document.querySelector('#mb-set [data-fill="open"]').click(); await W(80);
              const hp = [...document.querySelectorAll('#mb-set .mh-help')].map(e => e.textContent).join(' ');   /* 접힌 칸 안 글자도 (innerText 는 접힌 칸에서 빈 글자) */
              okk('7. 고급 설정 단추로 정규장 시작 전 → 조건·설명·요약 바뀜 (주소는 실행 때)', MBTdebug.S().fill === 'open' && /정규장 시작 전 주문: 정규장이/.test(hp) && /정규장 시작 전 주문/.test(document.getElementById('mb-sum-adv').textContent) && /주문 넣는 때 가격\\(그날 시가\\)/.test(hp), [MBTdebug.S().fill, /정규장 시작 전 주문: 정규장이/.test(hp), document.getElementById('mb-sum-adv').textContent, /주문 넣는 때 가격\\(그날 시가\\)/.test(hp)].join(' | '));
              document.querySelector('#mb-set [data-fill=""]').click(); await W(60);
              okk('기존 계산으로 되돌림 → 요약에서 빠짐', MBTdebug.S().fill === '' && !/정규장|프리장/.test(document.getElementById('mb-sum-adv').textContent), document.getElementById('mb-sum-adv').textContent);
              return out; }""", not local)
            for nm, okv, info in fls:
                if not okv:
                    fail('muhan-backtest', '주문 넣는 때 ' + nm + (' — ' + info if info else ''))
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&ft=o&e=2012-12-31', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().fcmp', timeout=90000)
            flo = page.evaluate("() => [MBTdebug.S().fill, /(^|&|#)ft=o(&|$)/.test(location.hash), document.querySelectorAll('.mb-fl tbody tr').length, document.querySelector('.mb-fl tr.on').getAttribute('data-fl'), !!document.querySelector('.mb-rj'), document.querySelectorAll('.mb-fl thead th').length]")
            if flo != ['open', True, 3, 'open', False, 5]:
                fail('muhan-backtest', '주소 ft=o → 정규장 시작 전 복원·비교 표 실패 %r' % flo)
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&e=2012-12-31', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().S', timeout=90000)
            if page.evaluate("() => [MBTdebug.S().fill, !!MBTdebug.R().fill, !!document.querySelector('.mb-fl'), /ft=/.test(location.hash), MBTdebug.R().net.fx]") != ['', False, False, False, None]:
                fail('muhan-backtest', '주소에 ft 가 없으면 기존 계산(카드 없음 · fx 통계 없음)이어야 함')
            page.evaluate("() => localStorage.setItem('mbt-open', JSON.stringify({ ver: true, tk: true, per: true, rule: true, exh: true, tax: true, adv: true }))")
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/', wait_until='load')
            page.wait_for_function("document.querySelectorAll('#mb-set .mb-acc[open]').length === 7", timeout=30000)
            for ver in ['1.0', '2.0', '2.1', '2.2', '3.0', '4.0']:
                page.set_viewport_size({'width': 1280, 'height': 900})
                page.evaluate("v => document.querySelector('#mb-set [data-ver=\"' + v + '\"]').click()", ver); page.wait_for_timeout(120)
                for w in widths:
                    page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(80)
                    r = page.evaluate(OVERFLOW_JS)
                    sw = page.evaluate("() => { const e = document.getElementById('mb-set'); return [e.scrollWidth, e.clientWidth]; }")   # 설정 칸은 스크롤 상자라 OVERFLOW_JS 가 안을 보지 않음
                    if r['sw'] > r['vw'] + 1 or r['out'] or sw[0] > sw[1] + 1:
                        fail('muhan-backtest', 'V%s 설정 모두 펼침 %dpx 넘침 (문서 %dpx · 설정 칸 %d > %dpx)%s' % (ver, w, r['sw'], sw[0], sw[1], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
            adv = page.evaluate("() => { const d = document.querySelector('#mb-set .mb-acc[data-sec=\"adv\"]'); return [!!d.querySelector('[data-ideal]'), d.querySelector('.inc-sec-in').innerText]; }")
            if adv[0] or '1주 단위' not in adv[1]:
                fail('muhan-backtest', 'V4.0 고급 설정에 계산에 안 쓰는 정액 단추가 있음 %r' % adv)
            page.set_viewport_size({'width': 1280, 'height': 900})
            page.evaluate("() => { localStorage.removeItem('mbt-open'); localStorage.removeItem('mbt-settings'); }")
            # 장중에 저장된 오늘 일봉은 백테스트에서 뺌 (TQQQ·SOXL = etfcagr.json 경로 · 뉴욕 평일 16:00 ET 전)
            oc = page.evaluate("""() => { const B = window.MBT, U = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi), dn = s => B.dnum(s), R = [];
              const s = { d0: dn('2026-10-12'), dd: [1], c: [10, 11], h: [10.5, 11.5], div: [[dn('2026-10-12'), 0.05], [dn('2026-10-13'), 0.1]] };
              const a = B.fromCagr(s, U(2026, 10, 13, 18, 0)), b = B.fromCagr(s, U(2026, 10, 13, 20, 30)), c = B.fromCagr(s, U(2026, 10, 14, 13, 0));
              R.push(['openDayNY 화 14:00 EDT', B.openDayNY(U(2026, 10, 13, 18, 0)) === '2026-10-13'], ['openDayNY 16:30 EDT', B.openDayNY(U(2026, 10, 13, 20, 30)) === ''],
                     ['openDayNY 토요일', B.openDayNY(U(2026, 10, 17, 15, 0)) === ''], ['openDayNY 15:30 EST', B.openDayNY(U(2026, 12, 15, 20, 30)) === '2026-12-15'],
                     ['장중 → 오늘 일봉 뺌', a.d.length === 1 && a.c.length === 1 && a.h.length === 1 && a.dv.length === 1 && a.dv[0] === 0.05],
                     ['마감 뒤 → 오늘 일봉 씀', b.d.length === 2 && b.d[1] === '2026-10-13' && b.c[1] === 11 && b.h[1] === 11.5 && b.dv[1] === 0.1],
                     ['다음 날 → 그대로', c.d.length === 2]);
              return R.filter(x => !x[1]).map(x => x[0]); }""")
            for t in oc:
                fail('muhan-backtest', '장중 일봉 빼기 검사 실패: ' + t)
            if local:   # 시세 수집기가 etfcagr.json 에 장중 값을 넣지 않고, 마감 15분 뒤 확정 일봉을 받는지 (네트워크 없이)
                bot_etfcagr_check(fail)
            # 상장 전 결과가 재현 가격·추정 고가 탓으로 크게 달라지면(오차 카드 ② |d| ≥ 5%p) 결과 위 ⚠ 알림 — 알림 ⇔ |d| ≥ 5%p
            # (로컬 합성 자료는 상장 뒤 재현이 없어 d 가 비므로, 계산된 결과의 d 를 바꿔 다시 그려 확인)
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=2.2&t=TQQQ&c=10000&sp=40&tg=10&p=1', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().pre && MBTdebug.R().pre.err', timeout=90000)
            w = page.evaluate("""async () => { const W = ms => new Promise(r => setTimeout(r, ms)), R = MBTdebug.R(), out = { d0: R.pre.err.d == null ? null : R.pre.err.d };
              const has = () => { const w = document.querySelector('.mb-warns'); return !!w && /상장 전 구간 결과는 믿기 어려워요/.test(w.innerText); };
              const redraw = async () => { document.querySelector('[data-view="gross"]').click(); await W(80); document.querySelector('[data-view="net"]').click(); await W(80); };
              out.w0 = has(); R.pre.err.d = 0.2; await redraw(); out.w20 = has() && document.querySelector('.mb-warns').innerText.includes('+20.0%p');
              R.pre.err.d = -0.051; await redraw(); out.wm = has(); R.pre.err.d = 0.01; await redraw(); out.w1 = has(); return out; }""")
            print('    상장 전 재현 차이 알림: 로컬 d %s · 20%%p → %s · −5.1%%p → %s · 1%%p → %s' % (w['d0'], w['w20'], w['wm'], w['w1']), flush=True)
            if w['w0'] != (w['d0'] is not None and abs(w['d0']) >= 0.05) or not w['w20'] or not w['wm'] or w['w1']:
                fail('muhan-backtest', '상장 전 재현 차이 알림이 d 와 맞지 않음 %r' % w)
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
        # 밸류리밸런싱 VR 5.0 백테스트 — 엔진(tests/vr_bt_test.js) · 화면 · 기록 화면 카드 (tests/vr_bt_ui.py)
        if os.path.isdir(os.path.join(ROOT, 'vr-backtest')):
            import vr_bt_ui
            vr_bt_ui.check(page, base, local, fail, errs, ignorable, widths, OVERFLOW_JS)
        # 72루틴 — 무한매수법 기록 화면(mhApp) 고정 규칙 프로필: 시작 화면·수수료 기본값·용어·기록 그래프·실시간 · 카드 = 엔진·시뮬레이터 · 상장 전 · 크게 보기 · 중간 진입 · 계정 저장 (tests/t72_ui.py)
        if os.path.isdir(os.path.join(ROOT, '72')):
            import t72_ui
            page.goto('about:blank')   # 같은 출처의 다른 탭(앞 검사의 VR 화면)이 가짜 로그인(localStorage 공유)에 반응해 실제 Worker 401 → 로그아웃시키지 않게
            t72_ui.check(apage, base, local, fail, errs, ignorable, widths, OVERFLOW_JS)   # 관리자 전용 — 검사용 탭(잠금 해제)에서
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
        # [EARN] 실적발표 캘린더 — 자료 형식·PER 3종 계산·달력·목록·기업 상세·관심 기업·휴대폰 상세 화면 넘침
        if 'earnings-calendar/' in paths:
            print('[5] 실적발표 캘린더', flush=True)
            earn_check(page, base, fail, errs, ignorable)
        # [COMMUNITY] 건의 게시판 — 실제 Worker 코드를 가짜 서버로 띄워 손님·회원·관리자 흐름 (실제 계정·게시판 안 건드림)
        if 'suggest/' in paths:
            print('[6] 건의 게시판', flush=True)
            board_check(ctx, base, fail, local, attach)
        # [STRATSIM] 투자전략 시뮬레이터 + 자료실 3쪽 — 고정 구간 숫자 · 라이브러리 · 분석 표 · 공유 링크 · 탐색기 표·열기 · 장중 흐름
        if 'strategy-simulator/' in paths:
            print('[7] 투자전략 시뮬레이터', flush=True)
            stratsim_check(br, base, fail, ignorable)
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
