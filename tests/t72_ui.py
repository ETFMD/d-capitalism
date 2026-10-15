"""72루틴 회귀 검사 — run_regression.py 가 부름 (check)

  /72/ = 무한매수법 기록 화면(mhApp)을 고정 규칙 프로필([T72] P.lock)로 쓴 화면
  · 시작 화면: 고정 규칙 7줄 · 세부옵션 접이식(수수료 기본 0.25% · 직접 입력 누르면 0.1% · 일부분 복리 비율 50% · 양도세 하위 옵션 ·
    범위 밖 값이면 시작 꺼짐) → 시작 = V1.0 · SOXL · 72분할 · 목표 52.5% · 상단 매수선 13% · 평단 매수선 0% · 소진 recover · 1주 단위
  · 현재 화면·주문표·⋮ 메뉴(수수료 기본/직접 입력 0.1% · 반영 비율)·도움말·기록 시트(3일 기록) · 기록 그래프 '수익률'(잔금 + 보유 × 종가)
  · 화면 어디에도 무한매수법·라오어·큰수·괴리율·T값·별지점·전반전/후반전 같은 말이 없음 (설명글 포함)
  · 백테스트 카드 = 엔진 직접(일부분 복리·RSI·절세·분배금 빼기 조건) · 기본 설정 카드 = 같은 조건 무한매수법 백테스트 화면 ·
    상장 전 포함(배포: SOXL 재현 이어 붙임 · 상장일 표시 · |차이| ≥ 5%p 면 ⚠ / 로컬: 합성 자료엔 SOXL 식이 없어 안내) ·
    크게 보기(전체 구간 숫자 = 카드 · 연도별 = 직접 계산 · 줄 누르면 그해 · 기간 단추 · 끌어서 확대 · 로그 눈금 · 포함/미포함 전환)
  · 실시간 확인(시세가 그대로면 다시 그리지 않음 · 바뀌면 다시 그림) · 중간 진입(72회 다 씀 → 처음부터 소진 대응 · 매수 주문 없음)
  · 저장 키 분리(r72-store · 무한매수법 muhan4-store 그대로) · 로그인 자동 저장(가짜 로그인 → GET·POST /udata/r72 · /udata/muhan 안 부름)
  · 폭 넘침(시작 화면 세부옵션 펼침 · 현재 화면 · 크게 보기) · 콘솔 오류
  ㉜: 시작 원금 비우면 $100,000 · 시장 지표 카드(RSI·종가 추이·VIX·공포탐욕) 맨 아래 · 그 4개 + 백테스트 카드 접기(요약 · 접으면 그래프·계산 안 함 · 기억)
      · 공포탐욕·VIX 그라데이션 띠 · 오늘의 주문 강조 · RSI 기본 와일더 · LOC 매수 상한 실시간 시세(가짜 /q — 장별 이름 · 카드만 고침 · 손으로 고친 값 그대로 ·
        ↻ 자동 = 바로 조회 · 실패하면 시세 자료 · 카드가 없으면 멈춤 · 배포 사이트는 진짜 /q 도) · 백테스트 기간설정·상장 전 켜기(20·30년)·포함/미포함 한 줄 ·
        크게 보기 휠·두 손가락 확대(그래프를 새로 만들지 않음)
  ㉝: 오늘의 주문 — 매수 지정가 > 지금 한도(LOC 카드 기준가 × 1.2)면 그 줄 아래 경고·입력 가격·요약(실시간 시세·손으로 고친 기준가와 함께 · 카드는 다시 그리지 않음)
      · 백테스트 '증권사 주문 거부' 3가지 = 엔진 직접(로컬은 시가를 만들어 넣음 · 배포는 실제 시가) · 고르면 카드 숫자·그래프 · 기억 · 무한매수법 화면엔 끔
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLEAR = "() => { Object.keys(localStorage).filter(k => /^(r72-|t72-)/.test(k)).forEach(k => localStorage.removeItem(k)); }"

PRE = """
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const T = window.T72debug, MH = T.MH, rt = () => document.getElementById('t7-root'), $ = q => rt().querySelector(q), $$ = q => [...rt().querySelectorAll(q)];
  const click = q => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.click(); };
  const fill = (q, v) => { const e = $(q); if (!e) throw new Error('없음 ' + q); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  const BAD = /무한매수법|라오어|큰수|괴리율|T값|별지점|전반전|후반전|쿼터|리버스|무한/;
  const bad = t => { const m = String(t || '').match(BAD); return m ? m[0] + ' … ' + String(t).slice(Math.max(0, m.index - 30), m.index + 30) : ''; };
  const ses = () => T.store.sessions.filter(x => x.id === T.store.activeSessionId)[0];
  const card = () => { const s = ses().settings, c = T.bt.cache[T.btKey(s)]; return c && (c.st === 'ok' || c.st === 'err') ? c : null; };
  const waitCard = async (ms) => { for (let i = 0; i < (ms || 180000) / 250 && !card(); i++) await W(250); return card(); };
  const pc = (v, dd) => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(dd == null ? 1 : dd) + '%';
"""

SETUP_JS = """async () => {""" + PRE + """
  try {
    for (let i = 0; i < 100 && !$('[data-act="su-start"]'); i++) await W(100);
    const rules = document.getElementById('mh-rules'), rtx = rules ? rules.innerText : '';
    ok('시작 화면: 제목 72루틴 · 고정 규칙 7줄 (종목·분할·목표·평단 매수선·상단 매수선·소진 대응·주문 수량)',
       /72루틴/.test($('h1').textContent) && rules && rules.querySelectorAll('.mh-row').length === 7 &&
       ['SOXL', '72번', '+52.5%', '평단 매수선', '상단 매수선', '어제 종가 +13%', '−10%', '1주 단위'].every(w => rtx.includes(w)), rtx);
    const pt = document.getElementById('page-t72').innerText;
    ok('시작 화면·설명글에 무한매수법 용어 없음', !bad(pt), bad(pt));
    const ci = $('[data-in="su:cap"]'), dy0 = document.getElementById('mh-su-dyn').innerText;
    ok('시작 원금: 칸 안내 100,000 · 비어 있으면 요약 "원금 (기본값) $100,000" · 1회 $1388.89 · 시작하기 켜짐 · "비워 두면" 안내',
       ci && ci.placeholder === '100,000' && ci.value === '' && /원금 \\(기본값\\)\\s*\\$100,000/.test(dy0) && /\\$1388\\.89/.test(dy0) && !$('[data-act="su-start"]').disabled && /비워 두면 \\$100,000/.test(ci.parentNode.innerText), (ci && ci.placeholder) + ' | ' + dy0.slice(0, 80));
    ok('세부옵션 처음엔 접힘 · 요약 "지금은 모두 기본값"', !MH.setup.more && /모두 기본값/.test($('.mh-sumore').innerText) && !$('[data-act="su-feemode"]'));
    click('[data-act="su-more"]'); await W(50);
    const n = a => $$('[data-act="' + a + '"]').length;
    ok('세부옵션 칸: 1회 매수금·새 사이클·수수료·양도세·취득가액·연말 절세·분배금 (버전·종목·분할·목표·상단 매수선 칸 없음)',
       n('su-money') === 2 && n('su-restart') === 2 && n('su-feemode') === 2 && n('su-tax') === 2 && n('su-method') === 2 && n('su-harv') === 2 && n('su-divs') === 2 &&
       !n('su-ver') && !n('su-ticker') && !n('su-splits') && !$('[data-in="su:target"]') && !$('[data-in="su:big"]') && !$('[data-in="su:avgOff"]'));
    const fb = $('[data-act="su-feemode"][data-v="def"]');
    ok('수수료 기본 0.25% 선택됨', fb.classList.contains('mh-btn-sel') && /기본 0\\.25%/.test(fb.textContent) && MH.setup.feeMode === 'def' && !$('[data-in="su:feeC"]'), fb.textContent);
    click('[data-act="su-feemode"][data-v="custom"]'); await W(40);
    const fc = $('[data-in="su:feeC"]');
    ok('직접 입력을 누르면 0.1% 가 들어 있음 · 요약에 수수료 0.1%', fc && fc.value === '0.1' && /수수료 0\\.1%/.test($('.mh-sumore').innerText), fc && fc.value);
    fill('[data-in="su:cap"]', '20000'); fill('[data-in="su:feeC"]', '2.5'); await W(30);
    const dis1 = $('[data-act="su-start"]').disabled;
    fill('[data-in="su:feeC"]', '0.1'); await W(30);
    ok('수수료 범위 밖(2.5%)이면 시작하기 꺼짐 · 0.1% 면 켜짐', dis1 && !$('[data-act="su-start"]').disabled);
    click('[data-act="su-money"][data-v="part"]'); await W(40);
    const mx = $('[data-in="su:mix"]');
    ok('일부분 복리: 반영 비율 기본 50%', mx && mx.value === '50', mx && mx.value);
    fill('[data-in="su:mix"]', '120'); await W(30); const dis2 = $('[data-act="su-start"]').disabled;
    fill('[data-in="su:mix"]', '30'); await W(30);
    ok('반영 비율 범위 밖(120%)이면 시작하기 꺼짐 · 30% 면 켜짐', dis2 && !$('[data-act="su-start"]').disabled);
    click('[data-act="su-tax"][data-v="0"]'); await W(40); const hid = !n('su-method') && !n('su-harv');
    click('[data-act="su-tax"][data-v="1"]'); await W(40);
    ok('양도세 미포함이면 취득가액·연말 절세 칸 숨김 · 포함이면 보임', hid && n('su-method') === 2 && n('su-harv') === 2);
    click('[data-act="su-restart"][data-v="rsi"]'); await W(20); click('[data-act="su-harv"][data-v="1"]'); await W(20); click('[data-act="su-divs"][data-v="0"]'); await W(40);
    const sm = $('.mh-sumore').innerText;
    ok('요약: 일부분 복리 30% · RSI 60 이하 · 수수료 0.1% · 연말 절세 · 분배금 재투자 안 함', /일부분 복리 30%/.test(sm) && /RSI 60 이하/.test(sm) && /수수료 0\\.1%/.test(sm) && /연말 절세/.test(sm) && /재투자 안 함/.test(sm), sm);
    const hint = document.getElementById('mh-su-dyn').innerText;
    ok('시작 원금 안내: 지금 SOXL 가격 기준 하루 몇 주', !MH.market.SOXL || /SOXL 약 \\$[\\d.]+ 기준 1회 매수금으로 하루 \\d+주/.test(hint), hint);
    click('[data-act="su-start"]'); await W(300);
    const s = ses().settings, c = T.vcfg(s), o = T.btOpts(s);
    ok('시작 → 고정 규칙으로 저장 (V1.0 · SOXL · 72 · 52.5 · 13 · 하방 0줄 · 1주 · recover) · 세션 이름 72루틴',
       s.version === '1.0' && s.ticker === 'SOXL' && s.splits === 72 && s.targetProfit === 52.5 && s.bigNumPercent === 13 && s.lowerLocLines === 0 && s.lowerLocShares === 1 &&
       s.exhaust === 'recover' && s.totalCapital === 20000 && ses().name === '72루틴', JSON.stringify(s) + ' ' + ses().name);
    ok('계산 조건: 평단 매수선 0% · 일부분 복리 0.3 · RSI 60 · 소진 recover · 1주 단위',
       c.ver === '1.0' && c.ticker === 'SOXL' && c.splits === 72 && c.target === 52.5 && c.big === 13 && c.avgOff === 0 && c.exhaust === 'recover' && !c.ideal && c.lines === 0 &&
       c.money === 'part' && Math.abs(c.mix - 0.3) < 1e-12 && c.restart === 'rsi', JSON.stringify(c));
    ok('카드 조건: 수수료 0.1 · 양도세 선입선출 · 연말 절세 · 분배금 빼기', o.fee === 0.1 && o.tax && o.method === 'fifo' && o.harvest && !o.divs, JSON.stringify(o));
    const c2 = T.vcfg(Object.assign({}, s, { splits: 40, targetProfit: 10, bigNumPercent: 5, version: '4.0', exhaust: 'sellall', lowerLocLines: 8 }));
    ok('저장된 값이 달라도 계산은 고정 규칙 (72 · 52.5 · 13 · V1.0 · recover · 하방 0줄)', c2.ver === '1.0' && c2.splits === 72 && c2.target === 52.5 && c2.big === 13 && c2.exhaust === 'recover' && c2.lines === 0, JSON.stringify(c2));
    ok('저장 키 r72-store · 계정 키 /udata/r72', T.P.key === 'r72-store' && T.P.sync === '/udata/r72' && JSON.parse(localStorage.getItem('r72-store') || '{}').sessions.length === 1 && window.MHdebug && MHdebug.P.key === 'muhan4-store');
  } catch (e) { ok('시작 화면 흐름 오류', false, String(e && e.message)); }
  return R;
}"""

NOW_JS = """async () => {""" + PRE + """
  try {
    const top = document.querySelector('#t7-root .mh-top').innerText;
    ok('머리: 72루틴 · SOXL · 72분할 칩 한 번 · 원금 $20,000', /^72루틴/.test(top.trim()) && (top.match(/SOXL · 72분할/g) || []).length === 1 && /원금 \\$20,000/.test(top), top);
    const t0 = rt().innerText;
    ok('현재 화면: 매수 회차 · 72번 중 · 처음 매수 · 무한매수법 용어 없음', /매수 회차 · 72번 중/.test(t0) && /처음 매수/.test(t0) && !bad(t0), bad(t0) || t0.slice(0, 160));
    /* 도움말(ⓘ) 모두 */
    const keys = [...new Set($$('[data-act^="i-"]').map(e => e.getAttribute('data-act')))], badI = [];
    for (const k of keys) { MH.sheet = { kind: k }; T.render(); await W(30); const sh = document.querySelector('#t7-root .mh-sheet'); const b = bad(sh && sh.innerText); if (!sh || b) badI.push(k + ':' + (b || '창 없음')); }
    MH.sheet = null; T.render();
    ok('도움말 ' + keys.length + '개 (RSI·VIX·공포탐욕 …) 열림 · 무한매수법 용어 없음', keys.length >= 3 && !badI.length, badI.join(' | ') || keys.join(','));
    /* ⋮ 메뉴: 수수료 직접 입력(0.1%) 선택됨 · 기본 ↔ 직접 입력 · 반영 비율 */
    MH.menu = true; T.render(); await W(30);
    let mt = document.querySelector('#t7-root .mh-menu').innerText;
    ok('⋮ 메뉴: 고정 규칙 안내 · 무한매수법 용어 없음', /고정 규칙/.test(mt) && /바꿀 수 없어요/.test(mt) && !bad(mt), bad(mt));
    const sel = v => { const b = $('.mh-menu [data-act="m-feemode"][data-v="' + v + '"]'); return b && b.classList.contains('mh-btn-sel'); };
    ok('메뉴 수수료: 직접 입력 선택 · 칸 0.1', sel('custom') && !sel('def') && $('#mh-m-btfee') && $('#mh-m-btfee').value === '0.1', $('#mh-m-btfee') && $('#mh-m-btfee').value);
    click('.mh-menu [data-act="m-feemode"][data-v="def"]'); await W(40); MH.menu = true; T.render();
    const f1 = T.btOpts(ses().settings).fee, d1 = sel('def') && !$('#mh-m-btfee');
    click('.mh-menu [data-act="m-feemode"][data-v="custom"]'); await W(40); MH.menu = true; T.render();
    const f2 = T.btOpts(ses().settings).fee;
    ok('메뉴 수수료: 기본 → 0.25 · 다시 직접 입력 → 0.1 이 들어감', f1 === 0.25 && d1 && f2 === 0.1 && $('#mh-m-btfee').value === '0.1', [f1, d1, f2]);
    fill('.mh-menu #mh-m-mix', '40'); click('.mh-menu [data-act="ap-mix"]'); await W(40);
    ok('메뉴 반영 비율 40% → 계산 조건 mix 0.4', Math.abs(T.vcfg(ses().settings).mix - 0.4) < 1e-12 && T.vcfg(ses().settings).money === 'part', JSON.stringify(T.vcfg(ses().settings)));
    MH.menu = true; T.render(); fill('.mh-menu #mh-m-mix', '30'); click('.mh-menu [data-act="ap-mix"]'); await W(40);
    MH.menu = false; T.render();
    /* 기록 3일 (미국 거래일 + 1일 = 한국 날짜) → 기록 그래프 '수익률' */
    const px = MH.market.SOXL && MH.market.SOXL.prices || [];
    if (px.length >= 4) {
      const us = px.slice(-3).map(p => p.date), kst = us.map(d => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); });
      for (const k of kst) {
        click('[data-act="rec-open"]'); await W(150);
        const di = document.querySelector('#t7-root [data-ch="vr-date"]'); di.value = k; di.dispatchEvent(new Event('change', { bubbles: true })); await W(150);
        const sh = document.querySelector('#t7-root .mh-sheet').innerText;
        if (bad(sh)) ok('기록 시트 ' + k + ' 무한매수법 용어 없음', false, bad(sh));
        document.getElementById('mh-vr-save').click(); await W(200);
      }
      const D = T.curD();
      ok('기록 3일 저장 (날짜 바꿔 기록 · 시세대로 미리 체크된 체결)', D.txs.length === 3 && D.hist.length === 3 && D.txs.every(t => t.close > 0), D.txs.map(t => t.date + ' ' + (t.fills || []).length).join(' | '));
      const cv = rt().querySelector('canvas[data-chart="avg"]'), ch = cv && window.Chart && Chart.getChart(cv);
      const tabOn = ($('[data-act="avg-tab"].on') || {}).getAttribute ? $('[data-act="avg-tab"].on').getAttribute('data-v') : '';
      const r2 = x => Math.round(x * 100) / 100, cap = D.s.totalCapital, c0 = D.txs[0].close;
      const A = D.hist.map((h, i) => r2(((h.remainingCapital + h.totalQuantity * D.txs[i].close) / cap - 1) * 100)), B = D.txs.map(t => r2((t.close / c0 - 1) * 100));
      ok('기록 그래프: 처음 탭 = 수익률 · 72루틴 수익률 = (잔금 + 보유 × 그날 종가) ÷ 원금 − 1 · SOXL 그냥 보유',
         tabOn === 'ret' && ch && ch.data.datasets[0].label === '72루틴 수익률' && ch.data.datasets[1].label === 'SOXL 그냥 보유' &&
         JSON.stringify(ch.data.datasets[0].data) === JSON.stringify(A) && JSON.stringify(ch.data.datasets[1].data) === JSON.stringify(B),
         ch ? JSON.stringify([tabOn, ch.data.datasets[0].data, A, ch.data.datasets[1].data, B]) : '그래프 없음');
      click('[data-act="avg-tab"][data-v="tq"]'); await W(60);
      const ch2 = Chart.getChart(rt().querySelector('canvas[data-chart="avg"]'));
      ok('기록 그래프 탭 바꾸기 (회차 / 보유) · 이름에 T값 없음', ch2 && ch2.data.datasets.some(d => /회차/.test(d.label)) && !ch2.data.datasets.some(d => /T값/.test(d.label)), ch2 && ch2.data.datasets.map(d => d.label).join(','));
      click('[data-act="avg-tab"][data-v="ret"]'); await W(40);
      const t1 = rt().innerText, ord = document.querySelector('#t7-root').innerText;
      ok('기록 뒤 현재 화면: 주문 이름 = 목표 +52.5% 지정가 (전량) · 평단/상단 매수선 · 단계 "매수 중" · 용어 없음',
         /목표 \\+52\\.5% 지정가 \\(전량\\)/.test(ord) && /(평단 매수선|상단 매수선)/.test(ord) && /매수 중/.test(t1) && !bad(t1), bad(t1));
      /* ㉜ 카드 순서: 시장 지표 4개는 거래 히스토리 아래 맨 끝 (RSI → 종가 추이 → VIX → 공포탐욕) */
      const cards = $$('.mh-card').filter(c => !c.closest('.mh-sheet')), at = f => cards.findIndex(f);
      const iHist = at(c => /거래 히스토리/.test((c.querySelector('.mh-h3') || {}).textContent || '')), iBt = at(c => c.id === 'mh-bt'), iOrd = at(c => c.id === 'mh-orders');
      const ind = ['rsi', 'close', 'vix', 'fear'].map(k => at(c => c.getAttribute('data-fold') === k)), have = ind.filter(i => i >= 0);
      ok('시장 지표 카드(RSI·종가 추이·VIX·공포탐욕) = 거래 히스토리·백테스트 아래 맨 끝 · 그 순서',
         iHist >= 0 && have.length >= 2 && ind[0] >= 0 && ind[1] >= 0 && have.every(i => i > iHist && i > iBt && i > iOrd) && have.join() === have.slice().sort((a, b) => a - b).join() && have[have.length - 1] === cards.length - 1,
         JSON.stringify({ iOrd, iBt, iHist, ind, n: cards.length }));
      const oc = $('#mh-orders');
      ok('오늘의 주문 강조 (파란 테두리·왼쪽 띠 · 큰 제목 · 건수 칩)', oc && oc.classList.contains('mh-ordhl') && /오늘의 주문/.test(oc.querySelector('.mh-ordhl-t').textContent) && /\\d+건/.test(oc.innerText) &&
         /linear-gradient/.test(getComputedStyle(oc).backgroundImage) && getComputedStyle(oc, '::before').width === '4px' && !$('.mh-card:not(.mh-ordhl) .mh-ordhl-t'), oc && getComputedStyle(oc).backgroundImage);
      ok('RSI 표시 기본 = 와일더 (새 사이클 판단과 같은 방식)', MH.rsiMethod === 'wilder' && /와일더\\(원전\\)/.test(($('[data-fold="rsi"]') || {}).innerText || ''), MH.rsiMethod);
      const vb = $('[data-fold="vix"] .mh-gbar'), fg = $('[data-fold="fear"] .mh-gauge'), stops = el => ((el && el.style.background || '').match(/rgb\\(/g) || []).length;
      ok('VIX·공포탐욕 띠 = 그라데이션 (구간 사이가 자연스럽게 · 6색 지점)', vb && /linear-gradient/.test(vb.style.background) && stops(vb) === 6 && fg && /linear-gradient/.test(fg.style.background) && stops(fg) === 6,
         (vb && vb.style.background) + ' | ' + (fg && fg.style.background));
      /* 접기: 4개 + 백테스트 — 접으면 제목 줄 + 요약만(그래프 없음) · 이 기기에 기억 · 다시 펴기 */
      const fbad = [], keys = ['rsi', 'close', 'vix', 'fear'].filter(k => $('[data-fold="' + k + '"]')).concat(['bt']);
      for (const k of keys) {
        const b = $('[data-fold="' + k + '"] [data-act="fold"]'); if (!b) { fbad.push(k + ': 접기 단추 없음'); continue; }
        b.click(); await W(80);
        const sh = $('.mh-fold-shut[data-fold="' + k + '"]'), sum = sh && sh.querySelector('.mh-fold-sum').innerText;
        if (!sh || !sum || sh.querySelector('canvas') || !JSON.parse(localStorage.getItem('r72-fold') || '{}')[k]) fbad.push(k + ': 접힘 ' + !!sh + ' 요약 ' + sum);
      }
      const nCv = $$('canvas[data-chart="close"], canvas[data-chart="fear"]').length, btKeys = Object.keys(T.bt.cache).length;
      T.render(); await W(150); T.render(); await W(150);
      const sums = $$('.mh-fold-shut .mh-fold-sum').map(e => e.innerText).join(' | ');
      ok('카드 접기 (RSI·종가 추이·VIX·공포탐욕·백테스트): 제목 줄 + 요약 · 그래프 없음 · 접은 채 다시 그려도 그대로 · 백테스트 계산 안 함',
         !fbad.length && nCv === 0 && $$('.mh-fold-shut').length === keys.length && !$('#mh-bt') && Object.keys(T.bt.cache).length === btKeys && /[+−]\\d/.test(sums), fbad.join(' / ') || sums);
      for (const k of keys) { const h = $('.mh-fold-shut[data-fold="' + k + '"] .mh-fold-h'); if (h) { h.click(); await W(60); } }
      ok('다시 펴기 → 원래 카드 (그래프·백테스트 카드)', !$$('.mh-fold-shut').length && $('#mh-bt') && $('canvas[data-chart="close"]') && Object.values(JSON.parse(localStorage.getItem('r72-fold') || '{}')).every(v => !v), localStorage.getItem('r72-fold'));
    } else ok('기록 검사에 쓸 시세 없음', false, px.length);
    /* 설명 단추 → 아래 설명글로 */
    window.scrollTo(0, 0); click('.mh-top [data-act="guide"], [data-act="guide"]'); await W(700);
    const g = document.getElementById('g-t72-h'), gy = g ? g.getBoundingClientRect().top : -1;
    ok('설명 단추 → 설명글 제목으로 이동', g && gy >= -5 && gy < innerHeight, gy);
    window.scrollTo(0, 0);
  } catch (e) { ok('현재 화면 흐름 오류', false, String(e && e.message)); }
  return R;
}"""

LIVE_JS = """async () => {""" + PRE + """
  try {
    MH.sheet = null; MH.menu = false; T.render(); await W(30);
    const mark = rt().firstElementChild; mark.__keep = 1;
    const a = await T.liveTick(), same = rt().firstElementChild === mark;
    const m = MH.market.SOXL; m.quote = Object.assign({}, m.quote || {}, { price: 0.01 });
    const b = await T.liveTick(), redrawn = rt().firstElementChild !== mark, back = MH.market.SOXL.quote && MH.market.SOXL.quote.price !== 0.01;
    ok('실시간 확인: 시세 그대로면 다시 그리지 않음 · 바뀌면 다시 그림(새 시세로)', a === false && same && b === true && redrawn && back, JSON.stringify([a, same, b, redrawn, back]));
    MH.sheet = { kind: 'i-rsi' }; T.render(); const c = await T.liveTick(); MH.sheet = null; T.render();
    ok('실시간 확인: 창이 열려 있으면 건너뜀', c === undefined, c);
    const md = window.mdLoad, n0 = MH.market.SOXL.prices.length; window.mdLoad = () => Promise.reject(new Error('network'));
    let f = null; try { f = await T.liveTick(); } finally { window.mdLoad = md; }
    ok('실시간 확인이 잠깐 실패하면 있던 시세 그대로 (주문표가 사라지지 않음)', f === false && MH.market.SOXL.prices.length === n0 && n0 > 0 && !/불러오지 못/.test(rt().innerText), JSON.stringify([f, n0, MH.market.SOXL.prices.length]));
    /* 테마: 같은 테마를 다시 적용하면 그대로(입력 중인 칸이 다시 그려지지 않게) · 바꾸면 다시 그림(그래프 색) */
    const hd = document.documentElement, t0 = hd.getAttribute('data-theme'), m1 = rt().firstElementChild;
    if (t0) { hd.setAttribute('data-theme', t0); await W(60); }
    const keep = rt().firstElementChild === m1;
    hd.setAttribute('data-theme', t0 === 'light' ? 'dark' : 'light'); await W(80);
    const redo = rt().firstElementChild !== m1;
    if (t0) hd.setAttribute('data-theme', t0); else hd.removeAttribute('data-theme'); await W(80);
    ok('테마: 같은 테마 다시 적용 → 그대로 · 바꾸면 → 다시 그림', keep && redo, JSON.stringify([t0, keep, redo]));
  } catch (e) { ok('실시간 확인 오류', false, String(e && e.message)); }
  return R;
}"""

# ㉜ LOC 매수 상한 실시간 시세 — Worker /q 응답을 이 검사 안에서 가짜로 (fetch 가로채기 · 진짜 서버 안 부름)
LQ_JS = """async () => {""" + PRE + r"""
  const of = window.fetch; let QV = { p: 131.25, ses: 'post', ps: 'post' }, qn = 0, qfail = false;
  window.fetch = function (u) { if (typeof u === 'string' && /\/q\?s=SOXL$/.test(u)) { qn++;
      return Promise.resolve(qfail ? new Response('{"error":"upstream"}', { status: 502 }) : new Response(JSON.stringify(Object.assign({ s: 'SOXL', t: Math.floor(Date.now() / 1000) - 20, rp: 125, pc: 128 }, QV)), { status: 200, headers: { 'Content-Type': 'application/json' } })); }
    return of.apply(this, arguments); };
  const L = T.lq, money = v => '$' + (Math.floor(Math.round(v * 100) * 12 / 10) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });   /* 센트 정수로 셈 (부동소수 오차 없이) */
  const val = () => ($('#mh-loc [data-in="cap"]') || {}).value, hint = () => ($('#mh-loc-hint') || {}).innerText || '', chip = () => ($('#mh-loc-ses') || {}).textContent;
  const tick = async () => { L.tried = Date.now() - 25000; T.lqKick(); await W(250); };
  try {
    MH.sheet = null; MH.menu = false; MH.view = 'now'; MH.capEdited = false;
    for (let i = 0; i < 60 && L.busy; i++) await W(200);   /* 진짜 서버로 가던 조회가 끝나기를 */
    L.v = null; L.err = 0; L.tried = 0; T.render(); await W(300);
    ok('LOC 상한: 카드가 보이면 바로 실시간 시세 조회 · 기준가 = 애프터장 현재가 · 장 칩 · 상한 = ×1.2',
       qn === 1 && val() === '131.25' && /애프터장 현재가/.test(hint()) && /실시간/.test(hint()) && chip() === '애프터장' && $('#mh-cap-out').textContent === money(131.25), JSON.stringify([qn, val(), hint(), chip()]));
    const card = $('#mh-loc'); card.__keep = 1; QV.p = 140; await tick();
    ok('주기 갱신: 카드의 숫자만 바꿈 (화면을 다시 그리지 않음)', $('#mh-loc') === card && val() === '140' && $('#mh-cap-out').textContent === money(140) && qn === 2, JSON.stringify([val(), qn, $('#mh-loc') === card]));
    fill('#mh-loc [data-in="cap"]', '100'); QV.p = 150; await tick();
    ok('손으로 고친 기준가는 갱신해도 그대로 · 자동 값만 바뀜(수동 수정됨)', val() === '100' && /수동 수정됨/.test(hint()) && /자동 \$150\.00/.test(hint()) && $('#mh-cap-out').textContent === money(100), JSON.stringify([val(), hint()]));
    const n0 = qn; QV.p = 151.5; L.tried = Date.now(); click('[data-act="cap-auto"]'); await W(300);
    ok('↻ 자동 = 지금 바로 다시 조회해 채움 (20초를 기다리지 않음)', qn === n0 + 1 && val() === '151.5' && !MH.capEdited && $('#mh-cap-out').textContent === money(151.5), JSON.stringify([qn - n0, val()]));
    const ses = []; for (const v of [{ p: 120.5, ses: 'pre', ps: 'pre' }, { p: 121, ses: 'reg', ps: 'reg' }, { p: 122, ses: 'closed', ps: 'post' }]) { QV = v; await tick(); ses.push(chip() + ' / ' + hint().split('\n')[0]); }
    ok('장마다 이름: 프리장 현재가 · 정규장 현재가 · 장 마감이면 마지막 체결가(애프터장) · 마감 중엔 5분마다', /^프리장 \/ .*프리장 현재가/.test(ses[0]) && /^정규장 \/ .*정규장 현재가/.test(ses[1]) && /^장 마감 \/ .*마지막 체결가 \(애프터장\)/.test(ses[2]) && val() === '122' && /5분마다/.test($('#mh-loc-note').textContent), ses.join(' | '));
    qfail = true; L.v = null; await tick();
    const q0 = MH.market.SOXL && MH.market.SOXL.quote;
    ok('실시간 시세를 못 받으면 시세 자료 값 · 다음 조회는 늦게(20초 → 40초 …)', L.err >= 1 && /못 받아 시세 자료 값/.test(hint()) && !/실시간 ·/.test(hint()) && (!q0 || Number(val()) > 0), JSON.stringify([L.err, hint(), val()]));
    qfail = false; QV = { p: 133, ses: 'reg', ps: 'reg' }; await tick();
    ok('다시 받아지면 실시간으로', L.err === 0 && val() === '133' && /정규장 현재가/.test(hint()), hint());
    QV = { p: null }; await tick(); const busy = !!L.busy, e1 = L.err; QV = { p: 134, ses: 'reg', ps: 'reg' }; L.v = null; await tick();
    ok('이상한 응답(가격 없음)도 실패로 처리 · 다음 조회가 막히지 않음', !busy && e1 >= 1 && L.err === 0 && val() === '134', JSON.stringify([busy, e1, L.err, val()]));
    /* ㉝ 오늘의 주문 — 매수 지정가가 지금 한도(LOC 카드 기준가 × 1.2 · 1센트 버림)를 넘으면 그 줄 아래 경고 + 입력 가격 · 요약 · 실시간 시세·손으로 고친 기준가와 함께 (카드는 다시 그리지 않음) */
    { const ws = () => $$('#mh-orders .mh-rjw[data-rjp]'), sum = () => $('#mh-rjsum'), bp = ws().map(w => Number(w.getAttribute('data-rjp')));
      ok('오늘의 주문: 매수 줄마다 한도 경고 칸 (매도 줄엔 없음)', bp.length > 0 && bp.every(x => x > 0) && $$('#mh-orders .mh-obox.buy').length === bp.length, JSON.stringify(bp));
      if (bp.length) {
        const mx = Math.max(...bp), lowP = Math.floor(mx / 1.2 * 0.97 * 100) / 100, oc = $('#mh-orders'), usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        QV = { p: lowP, ses: 'reg', ps: 'reg' }; MH.capEdited = false; await tick();
        const capL = T.capOf(lowP), vis = ws().filter(w => !w.hidden), exp = bp.filter(x => x > capL + 1e-9).length;
        ok('지금 가격이 낮아 한도를 넘는 줄만 경고 · 입력 가격 = 기준가 × 1.2 1센트 버림(= LOC 카드 상한) · 요약에 한도 계산 · 주문 카드는 그대로',
           capL === Math.floor(Math.round(lowP * 100) * 12 / 10) / 100 && vis.length === exp && exp > 0 && vis.every(w => w.innerText.includes(usd(capL))) && $('#mh-cap-out').textContent === usd(capL) &&
           sum() && !sum().hidden && sum().classList.contains('warn') && sum().innerText.includes(usd(capL)) && sum().innerText.includes(usd(lowP)) && $('#mh-orders') === oc,
           JSON.stringify([lowP, capL, vis.length, exp, sum() && sum().innerText]));
        QV = { p: Math.ceil(mx / 1.2 * 1.05 * 100) / 100, ses: 'reg', ps: 'reg' }; await tick();
        ok('가격이 오르면 경고가 사라지고 ✓ 요약', ws().every(w => w.hidden) && !sum().hidden && !sum().classList.contains('warn') && /✓/.test(sum().innerText) && $('#mh-orders') === oc, sum().innerText);
        fill('#mh-loc [data-in="cap"]', String(Math.floor(mx / 1.2 * 0.9 * 100) / 100));
        ok('기준가를 손으로 고치면 경고도 바로', ws().some(w => !w.hidden) && sum().classList.contains('warn') && sum().innerText.includes(usd(T.capOf(Math.floor(mx / 1.2 * 0.9 * 100) / 100))), sum().innerText);
        click('[data-act="cap-auto"]'); await W(300);
      }
      ok('무한매수법 화면 프로필엔 끔 (오늘의 주문 경고·백테스트 거부 비교)', !window.MHdebug || (!MHdebug.P.rejWarn && !MHdebug.P.btRej)); }
    MH.view = 'an'; T.render(); await W(80); const stop = !L.timer;
    MH.view = 'now'; T.render(); await W(80);
    ok('LOC 카드가 없는 화면(분석)에선 조회를 멈추고 · 돌아오면 다시', stop && !!L.timer, JSON.stringify([stop, L.timer]));
  } catch (e) { ok('실시간 시세 흐름 오류', false, String(e && e.message)); }
  finally { window.fetch = of; }
  return R;
}"""

# 배포 사이트: 진짜 Worker /q 가 이 사이트에서 답하는지 (CORS · 야후 1분봉) — 카드가 실시간 값을 받기까지
LQ_REAL_JS = """async () => {""" + PRE + r"""
  try {
    const L = T.lq; MH.sheet = null; MH.menu = false; MH.view = 'now'; L.v = null; L.err = 0; L.tried = 0; T.render();
    for (let i = 0; i < 60 && !(L.v && L.v.p > 0) && L.err === 0; i++) await W(250);
    ok('배포 Worker /q 실시간 시세 (사이트에서 바로 · 프리·정규·애프터 장 표시)', L.v && L.v.p > 0 && /^(pre|reg|post|closed)$/.test(L.v.ses) && /실시간/.test(($('#mh-loc-hint') || {}).innerText || ''), JSON.stringify([L.v, L.err]));
  } catch (e) { ok('배포 /q 확인 오류', false, String(e && e.message)); }
  return R;
}"""

BT_JS = """async (live) => {""" + PRE + """
  try {
    const s = ses().settings;
    let r = await waitCard();
    ok('카드 기본 기간 = 전체 · 계산 끝', r && r.st === 'ok' && $('#mh-bt [data-act="bt-per"][data-v="all"]').classList.contains('mh-btn-sel'), r && (r.st + ' ' + (r.msg || '')));
    if (!r || r.st !== 'ok') return R;
    const bt = document.getElementById('mh-bt').innerText;
    ok('카드: 수수료 0.1% · 무한매수법 백테스트 링크 없음 · 크게 보기 단추 · 상장 전 포함 단추', /수수료 0\\.1%/.test(bt) && !document.querySelector('#mh-bt a[href*="muhan-backtest"]') && $('[data-act="btz-open"]') && $('#mh-bt [data-act="bt-pre"]') && !bad(bt), bad(bt) || bt.slice(0, 200));
    /* ㉜ 단추: 기간 1·3·5·10년·전체·기간설정 (상장 전 포함을 켜야 20·30년) · 세금·수수료 포함/미포함은 늘 한 줄에 나란히 */
    const chips = () => $$('#mh-bt [data-act="bt-per"]').map(b => b.getAttribute('data-v')).join(','), vw = () => $$('#mh-bt [data-act="bt-view"]');
    const row1 = () => { const v = vw(); return v.length === 2 && Math.abs(v[0].getBoundingClientRect().top - v[1].getBoundingClientRect().top) < 2; };
    ok('기간 단추 1·3·5·10년·전체·기간설정 (20·30년 숨김) · 상장 전 포함 꺼짐 · 포함/미포함 한 줄', chips() === '1y,3y,5y,10y,all,custom' && !T.bt.pre && $('#mh-bt [data-act="bt-pre"]').getAttribute('aria-pressed') === 'false' && row1(), chips());
    /* 카드 숫자 = 엔진 직접 (같은 자료 · 일부분 복리 0.3 · RSI · 절세 · 분배금 빼기) */
    const D = await MBT.load('SOXL'), F = await MBT.fxData().catch(() => null), o = T.btOpts(s), c = T.vcfg(s), cap = s.totalCapital, fx = F && o.tax ? MBT.fxFor(D.d, F) : null;
    const Dn = o.divs ? D : Object.assign({}, D, { dv: null }), base = { from: 1, to: D.d.length - 1, capital: cap, norm: 'auto', rows: false };
    const Rn = MHV.run(c, Dn, Object.assign({}, base, { fee: o.fee / 100, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: o.method, harvest: o.harvest } : null }));
    const Rg = MHV.run(c, Dn, Object.assign({}, base, { fee: 0, sec: 0, divTax: 0, tax: null }));
    const n2 = MBT.stats(Rn, D, cap), g2 = MBT.stats(Rg, D, cap), eq = (a, b) => ['final', 'cagr', 'mdd', 'fees', 'tax'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
    ok('카드 숫자 = 엔진 직접 (포함·미포함 · 일부분 복리·RSI·절세·분배금 빼기)', fx && eq(r.net, n2) && eq(r.gross, g2) && r.from === D.d[1], JSON.stringify([r.net.cagr, n2.cagr, r.gross.cagr, g2.cagr]));
    /* 크게 보기 — 전체 구간 = 카드 숫자 */
    click('[data-act="btz-open"]'); await W(400);
    const st = () => document.getElementById('mh-btz-st').innerText, cell = (row, col) => { const tr = [...document.querySelectorAll('#mh-btz-st tbody tr')].filter(x => x.cells[0].textContent === row)[0]; return tr ? tr.cells[col].textContent : null; };
    const cvz = rt().querySelector('canvas[data-chart="btz"]'), chz = () => Chart.getChart(rt().querySelector('canvas[data-chart="btz"]'));
    ok('크게 보기 창: 그래프 · 기간 단추 5개(전체 선택) · 연도별 표', cvz && chz() && $$('[data-act="btz-per"]').length === 5 && $('[data-act="btz-per"][data-v="0"]').classList.contains('mh-btn-sel') && $$('.mh-btz-y tbody tr[data-act="btz-year"]').length > 10);
    ok('크게 보기 전체 구간 = 카드 (수익률·연평균·낙폭 · 그냥 보유 포함 · 시작 = 원금)',
       cell('수익률', 1) === pc(r.net.ret) && cell('연평균 (CAGR)', 1) === pc(r.net.cagr, 2) && cell('최대 낙폭 (MDD)', 1) === pc(r.net.mdd) &&
       cell('수익률', 2) === pc(r.net.bh.ret) && cell('연평균 (CAGR)', 2) === pc(r.net.bh.cagr, 2) && cell('최대 낙폭 (MDD)', 2) === pc(r.net.bh.mdd) && /^\\$20,000 →/.test(cell('시작 → 끝', 1)),
       st().replace(/\\s+/g, ' ') + ' | card ' + [pc(r.net.ret), pc(r.net.cagr, 2), pc(r.net.mdd), pc(r.net.bh.ret), pc(r.net.bh.cagr, 2)].join(' '));
    /* 연도별: 그해 마지막 거래일 ÷ 그 전해 마지막 거래일 (첫해는 원금) — 직접 계산 */
    const d = r.ch.d, s1 = r.ch.net, bh = r.ch.bh, ends = []; d.forEach((x, i) => { if (i === d.length - 1 || d[i + 1].slice(0, 4) !== x.slice(0, 4)) ends.push(i); });
    const yrRow = y => [...document.querySelectorAll('.mh-btz-y tbody tr[data-act="btz-year"]')].filter(tr => tr.cells[0].textContent.slice(0, 4) === String(y))[0];
    let badY = [];
    ends.forEach((i1, k) => { const i0 = k ? ends[k - 1] : -1, v0 = i0 < 0 ? r.cap : s1[i0], b0 = i0 < 0 ? r.cap : bh[i0], tr = yrRow(d[i1].slice(0, 4));
      if (!tr || tr.cells[1].textContent !== pc(s1[i1] / v0 - 1) || tr.cells[2].textContent !== pc(bh[i1] / b0 - 1) || tr.getAttribute('data-v') !== i0 + ':' + i1) badY.push(d[i1].slice(0, 4)); });
    ok('연도별 수익률 ' + ends.length + '년 = 직접 계산 (첫해는 원금 기준)', ends.length >= 10 && !badY.length, badY.join(','));
    const ym = ends[Math.floor(ends.length / 2)], yy = d[ym].slice(0, 4), tr = yrRow(yy), want = tr.cells[1].textContent;
    const capFull = chz().data.datasets.length === 3 && !chz().data.datasets[2].hidden && rt().querySelector('.mh-btz-cap').style.display !== 'none';
    tr.click(); await W(200);
    { const [i0, i1] = tr.getAttribute('data-v').split(':').map(Number), vis = []; for (let i = Math.max(0, i0); i <= i1; i++) vis.push(s1[i], bh[i]);
      const lo = Math.min(...vis), hi = Math.max(...vis), on = r.cap >= lo / 1.5 && r.cap <= hi * 1.5;
      ok('원금 선: 전체 구간엔 보이고 · 확대 구간이 원금과 멀면 숨김(눈금이 눌리지 않게)', capFull && !!chz().data.datasets[2].hidden === !on && (rt().querySelector('.mh-btz-cap').style.display === 'none') === !on, JSON.stringify([capFull, on, chz().data.datasets[2].hidden, Math.round(lo)])); }
    ok('연도 줄을 누르면 그해로 확대 (구간 수익률 = 표 값 · 기간 단추 선택 풀림)', cell('수익률', 1) === want && T.btz.per === null && !$$('[data-act="btz-per"].mh-btn-sel').length && new RegExp(yy + '-12-').test(st()), st().slice(0, 80) + ' / ' + want);
    click('[data-act="btz-per"][data-v="1"]'); await W(200);
    const y1 = (st().match(/· ([\\d.]+)년/) || [])[1];
    ok('기간 1년 단추 → 1년 구간 · 단추 선택 표시', T.btz.per === '1' && $('[data-act="btz-per"][data-v="1"]').classList.contains('mh-btn-sel') && Math.abs(Number(y1) - 1) <= 0.05, y1);
    click('[data-act="btz-per"][data-v="0"]'); await W(200);
    const a0 = T.btz.a, b0 = T.btz.b, rc = rt().querySelector('canvas[data-chart="btz"]').getBoundingClientRect(), y = rc.top + rc.height / 2;
    const pe = (t, x) => rt().querySelector('canvas[data-chart="btz"]').dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
    pe('pointerdown', rc.left + rc.width * 0.3); pe('pointermove', rc.left + rc.width * 0.5); pe('pointermove', rc.left + rc.width * 0.6); pe('pointerup', rc.left + rc.width * 0.6); await W(200);
    ok('그래프를 끌면 고른 구간만 확대', a0 === -1 && T.btz.a > 0 && T.btz.b < b0 && T.btz.b - T.btz.a > 5 && T.btz.per === null, JSON.stringify([a0, b0, T.btz.a, T.btz.b]));
    const lg = document.getElementById('mh-btz-log'), l0 = chz().options.scales.y.type; lg.click(); await W(200);
    ok('로그 눈금 끄고 켜기', chz().options.scales.y.type !== l0 && document.getElementById('mh-btz-log').checked === (chz().options.scales.y.type === 'logarithmic'), l0 + ' → ' + chz().options.scales.y.type);
    /* ㉜ 마우스 휠·두 손가락 — 그래프를 새로 만들지 않고 구간만 바꿈 · 전체에서 더 줄이면 화면 스크롤로 넘김 */
    click('[data-act="btz-per"][data-v="0"]'); await W(150);
    { const cv = rt().querySelector('canvas[data-chart="btz"]'), ch0 = chz(), rc = cv.getBoundingClientRect(), y = rc.top + rc.height / 2, n = r.ch.d.length;
      const fxOf = x => { const ca = chz().chartArea; return Math.max(0, Math.min(1, (x - rc.left - ca.left) / (ca.right - ca.left))); };   /* 그래프 안 가로 비율 (화면 코드와 같은 계산) */
      const wh = (dy, x, extra) => { const e = new WheelEvent('wheel', Object.assign({ deltaY: dy, deltaMode: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }, extra || {})); cv.dispatchEvent(e); return e.defaultPrevented; };
      const pOut = wh(120, rc.left + rc.width / 2); await W(80);
      const full = T.btz.a === -1 && T.btz.b === n - 1;
      const xw = rc.left + rc.width * 0.75, fw = fxOf(xw), pIn = wh(-300, xw); await W(150);
      const a1 = T.btz.a, b1 = T.btz.b, w1 = b1 - a1;
      ok('휠 위로 → 확대 (마우스 자리의 날은 그대로 · 그래프 새로 만들지 않음 · 보는 구간 표 바뀜) · 전체에서 휠 아래 → 화면 스크롤로',
         !pOut && full && pIn && w1 < (n - 1) * 0.8 && w1 > 10 && Math.abs(a1 + w1 * fxOf(xw) - (n - 1) * fw) <= (n - 1) * 0.02 + 2 && chz() === ch0 && T.btz.per === null && new RegExp('^보는 구간').test(st()), JSON.stringify([pOut, full, a1, b1, n, fw]));
      wh(-200, 0, { shiftKey: true, deltaY: -200 }); await W(150);
      ok('Shift + 휠 → 옆으로 이동 (너비 그대로)', T.btz.a < a1 && T.btz.b - T.btz.a === w1 && chz() === ch0, JSON.stringify([a1, b1, T.btz.a, T.btz.b]));
      for (let i = 0; i < 12; i++) wh(400, rc.left + rc.width / 2); await W(200);
      ok('휠 아래로 계속 → 전체(원금 기준)로 돌아감 · 전체 단추 선택', T.btz.a === -1 && T.btz.b === n - 1 && T.btz.per === '0' && $('[data-act="btz-per"][data-v="0"]').classList.contains('mh-btn-sel'), JSON.stringify([T.btz.a, T.btz.b, T.btz.per]));
      const pe = (t, id, x) => cv.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary: id === 1 })), cx = rc.left + rc.width / 2;
      const fs = fxOf(cx); pe('pointerdown', 1, cx - 20); pe('pointerdown', 2, cx + 20); for (let k = 1; k <= 8; k++) { pe('pointermove', 1, cx - 20 - k * 12); pe('pointermove', 2, cx + 20 + k * 12); }
      pe('pointerup', 1, cx - 116); pe('pointerup', 2, cx + 116); await W(200);
      const a2 = T.btz.a, b2 = T.btz.b, sel = rt().querySelector('.mh-btz-sel'), fc = fxOf(cx);
      ok('두 손가락 벌리기 → 확대 (두 손가락 가운데의 날은 그대로) · 끌어서 고르기 상자는 안 생김 · 그래프 그대로', a2 > 0 && b2 < n - 1 && (b2 - a2) < (n - 1) / 3 && Math.abs(a2 + (b2 - a2) * fc - (n - 1) * fs) <= (n - 1) * 0.02 + 2 && sel.hidden && chz() === ch0, JSON.stringify([a2, b2, n, fc]));
      pe('pointerdown', 1, cx - 120); pe('pointerdown', 2, cx + 120); for (let k = 1; k <= 8; k++) { pe('pointermove', 1, cx - 120 + k * 12); pe('pointermove', 2, cx + 120 - k * 12); }
      pe('pointerup', 1, cx - 24); pe('pointerup', 2, cx + 24); await W(200);
      ok('두 손가락 오므리기 → 축소', T.btz.b - T.btz.a > (b2 - a2) * 2, JSON.stringify([a2, b2, T.btz.a, T.btz.b]));
      click('[data-act="btz-per"][data-v="0"]'); await W(150); }
    const ka = T.btz.a, kb = T.btz.b, sN = st();
    click('.mh-sheet [data-act="bt-view"][data-v="gross"]'); await W(300);
    ok('창 안에서 미포함으로 바꿔도 구간 그대로 · 숫자는 미포함', T.btz.a === ka && T.btz.b === kb && st() !== sN && rt().querySelector('.mh-sheet [data-act="bt-view"][data-v="gross"]').classList.contains('mh-btn-sel'));
    click('.mh-sheet [data-act="bt-view"][data-v="net"]'); await W(200);
    const sht = document.querySelector('#t7-root .mh-sheet').innerText;
    ok('크게 보기 창 무한매수법 용어 없음', !bad(sht), bad(sht));
    MH.sheet = null; T.render(); await W(50);
    /* ㉜ 기간설정 — 시작일 ~ 끝일 (지금 보던 결과의 기간으로 채워 줌 · 숫자 = 엔진 직접 · 거꾸로 고르면 안내) */
    click('#mh-bt [data-act="bt-per"][data-v="custom"]'); await W(100); r = await waitCard();
    const cf = $('#mh-bt #mh-bt-cf'), ct = $('#mh-bt #mh-bt-ct');
    ok('기간설정: 날짜 칸 두 개 · 처음엔 보던 결과의 기간', cf && ct && cf.value === D.d[1] && ct.value === D.d[D.d.length - 1] && r && r.st === 'ok' && r.from === D.d[1], JSON.stringify([cf && cf.value, ct && ct.value, r && r.from]));
    $('#mh-bt #mh-bt-cf').value = '2020-01-01'; $('#mh-bt #mh-bt-ct').value = '2019-01-01'; click('#mh-bt [data-act="bt-apply"]'); await W(80);
    ok('시작일이 끝일보다 뒤면 안내 · 계산 안 함', /시작일이 끝일보다 앞이어야/.test($('#mh-bt-rhelp').textContent) && T.bt.cf !== '2020-01-01', $('#mh-bt-rhelp').textContent);
    $('#mh-bt #mh-bt-cf').value = '2015-01-01'; $('#mh-bt #mh-bt-ct').value = '2020-12-31'; click('#mh-bt [data-act="bt-apply"]'); await W(100); r = await waitCard();
    { let f = 1, t = D.d.length - 1; for (let i = 1; i < D.d.length; i++) if (D.d[i] >= '2015-01-01') { f = i; break; } for (let j = D.d.length - 1; j >= 1; j--) if (D.d[j] <= '2020-12-31') { t = j; break; }
      const b2 = { from: f, to: t, capital: cap, norm: 'auto', rows: false }, R2 = MHV.run(c, Dn, Object.assign({}, b2, { fee: o.fee / 100, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: o.method, harvest: o.harvest } : null }));
      const n3 = MBT.stats(R2, D, cap);
      ok('기간설정 2015-01-01 ~ 2020-12-31 → 그 사이 거래일만 · 숫자 = 엔진 직접', r && r.st === 'ok' && r.from === D.d[f] && r.to === D.d[t] && eq(r.net, n3) && r.ch.d.length === t - f + 1 && /2015-01-0\\d ~ 2020-12-3\\d/.test(document.getElementById('mh-bt').innerText),
         JSON.stringify([r && r.from, r && r.to, r && r.net.cagr, n3.cagr])); }
    $('#mh-bt #mh-bt-cf').value = '2000-01-01'; $('#mh-bt #mh-bt-ct').value = '2009-12-31'; click('#mh-bt [data-act="bt-apply"]'); await W(100); r = await waitCard();
    ok('상장 전(2010-03 전) 기간을 상장 전 포함 없이 고르면 "자료 없음" 안내 · 켜라는 안내', r && r.st === 'err' && /고른 기간에 자료가 없어요/.test(r.msg) && /상장 전 포함.?을 켜/.test(document.getElementById('mh-bt').innerText), r && r.msg);
    /* 상장 전 포함 (켜기·끄기 — 기간은 그대로 · 20·30년 단추) */
    click('#mh-bt [data-act="bt-per"][data-v="all"]'); await W(100); await waitCard();
    click('#mh-bt [data-act="bt-pre"]'); await W(100);
    ok('상장 전 포함 켜면 20·30년 단추가 생김 · 전체 그대로 · 포함/미포함 한 줄', T.bt.pre && chips() === '1y,3y,5y,10y,20y,30y,all,custom' && $('#mh-bt [data-act="bt-per"][data-v="all"]').classList.contains('mh-btn-sel') && row1(), chips());
    r = await waitCard(240000);
    const tp = document.getElementById('mh-bt').innerText;
    if (r && r.st === 'ok' && r.pre) {
      const big = r.pre.d != null && Math.abs(r.pre.d) >= 0.05;
      ok('상장 전 포함: 1990년대부터 재현 이어 붙임 · 상장일 표시 · 재현 구간 안내', r.preL > 0 && r.from < '2000-01-01' && /상장 전 재현/.test(tp) && /상장일/.test(tp) && r.pre.end < '2010-03-12', JSON.stringify(r.pre) + ' ' + r.from);
      ok('상장 전 포함: |재현 차이| ≥ 5%p ⇔ ⚠ 안내', big === /⚠ 상장 전 구간 결과는 믿기 어려워요/.test(tp), r.pre.d);
      click('[data-act="btz-open"]'); await W(400);
      const s2 = document.querySelector('#t7-root .mh-sheet').innerText;
      ok('상장 전 크게 보기: 재현 표시(연도 줄 · 구간 안내) · 20·30년 단추', /재현/.test(s2) && /상장 전 재현 가격/.test(s2) && cell('연평균 (CAGR)', 1) === pc(r.net.cagr, 2) && $('[data-act="btz-per"][data-v="30"]'), s2.slice(0, 160));
      MH.sheet = null; T.render();
      click('#mh-bt [data-act="bt-per"][data-v="30y"]'); await W(100); r = await waitCard(240000);
      const y30 = r && r.from ? (new Date(r.to) - new Date(r.from)) / 3.15576e10 : 0;
      ok('상장 전 포함 + 30년 → 30년 전부터 (재현 + 실제)', r && r.st === 'ok' && Math.abs(y30 - 30) < 0.05 && r.preL > 0 && r.pre && !r.pre.all, JSON.stringify([r && r.from, r && r.to, y30]));
      click('#mh-bt [data-act="bt-per"][data-v="custom"]'); await W(60);
      $('#mh-bt #mh-bt-cf').value = '2000-01-01'; $('#mh-bt #mh-bt-ct').value = '2009-12-31'; click('#mh-bt [data-act="bt-apply"]'); await W(100); r = await waitCard(240000);
      const tc = document.getElementById('mh-bt').innerText;
      ok('상장 전 포함 + 기간설정 2000~2009 → 전부 재현 가격 · 상장일 선 없음 · 안내', r && r.st === 'ok' && r.from >= '2000-01-03' && r.to <= '2009-12-31' && r.pre && r.pre.all && !document.querySelector('#mh-bt svg line[stroke="var(--m-warn)"]') && /이 기간 전부/.test(tc), JSON.stringify([r && r.from, r && r.to, r && r.pre]));
      click('#mh-bt [data-act="bt-per"][data-v="all"]'); await W(100); await waitCard(240000);
    } else ok(live ? '상장 전 포함: 배포 사이트에선 SOXL 재현이 붙어야 함' : '상장 전 포함: 재현 식이 없으면 실제 일봉만 · 안내', !live && r && r.st === 'ok' && /실제 일봉만 썼어요/.test(tp), (r && (r.st + ' ' + (r.msg || r.preNote || ''))) + ' ' + tp.slice(0, 160));
    click('#mh-bt [data-act="bt-pre"]'); await W(100); await waitCard();
    ok('상장 전 포함 끄면 20·30년 단추 숨김 · 실제 일봉', !T.bt.pre && chips() === '1y,3y,5y,10y,all,custom' && card() && !card().preL, chips());
  } catch (e) { ok('백테스트 카드 흐름 오류', false, String(e && e.message)); }
  return R;
}"""

# ㉟ 오늘의 주문 '마감 30분 전 다시 걸기' — 지금 가격(LOC 카드 기준가 · 손으로 넣어 정함)으로 세 경우 · 넣을 가격 · 한도 안 · 마감 시각(휴장일·조기 폐장·서머타임)
RCK_JS = """async () => {""" + PRE + r"""
  try {
    MH.sheet = null; MH.menu = false; MH.view = 'now'; T.render(); await W(120);
    const R = MH.rck, box = () => $('#mh-rck'), rows = () => $$('#mh-rck .mh-rck-r').map(e => Number(e.getAttribute('data-rck'))), kase = () => { const e = $('#mh-rck [data-rck-k]'); return e ? e.getAttribute('data-rck-k') : ''; };
    const D = T.curD(), C = D && D.close, loc = (D ? D.orders : []).filter(o => o.type === 'buy' && o.method === 'LOC' && o.price > 0 && o.quantity > 0);
    ok('오늘의 주문 아래 \'마감 30분 전 다시 걸기\' 상자 · 매수 LOC 줄마다 · 전일 종가 = 주문표 기준 · 72 프로필만', box() && R && R.c === C && R.big === 13 && R.rows.length === loc.length && loc.length > 0 &&
       R.rows.every((r, i) => r.p === loc[i].price && r.q === loc[i].quantity) && T.P.recheck && T.P.recheck.min === 30 && T.P.recheck.lo === 1.7 && T.P.recheck.up === 10 && T.P.recheck.band === 15 && (!window.MHdebug || !MHdebug.P.recheck), JSON.stringify([R, C, loc.length]));
    if (!R || !(C > 0)) return R;
    const orig = R.rows.map(r => r.p), top = Math.max(...orig), usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ok('가장 높은 매수 줄 = 전일 종가 +13% (사용자 절차의 \'원래 가격\')', Math.abs(top - C * 1.13) <= 0.0051, top + ' vs ' + C * 1.13);
    const setP = async v => { fill('#mh-loc [data-in="cap"]', String(v)); await W(60); };
    const chk = async (v, k, name) => { await setP(v); const np = Math.floor(v * 110 + 1e-7) / 100, cap = Math.floor(v * 115 + 1e-7) / 100, got = rows();
      const want = orig.map(p => { const x = k === '3' ? Math.min(p, np) : p; return x > cap + 1e-9 && np < x ? np : x; }), low = want.filter((x, i) => x < orig[i] - 1e-9).length;   /* 한도(지금 × 1.15)를 넘는 줄은 지금 가격 +10% (안전장치) */
      const capEl = $('#mh-rck [data-rck-cap]'), txt = box().innerText;
      ok(name + ' — 지금 ' + v + ' (' + ((v / C - 1) * 100).toFixed(2) + '%) → 경우 ' + k, kase() === k && got.length === want.length && got.every((p, i) => Math.abs(p - want[i]) < 1e-9) && got.every(p => p <= cap + 1e-9) &&
         capEl && Number(capEl.getAttribute('data-rck-cap')) === cap && /✓ 모두 지금 한도 .*지금 가격 × 1\.15\) 안 — 한도가 \+15%인 증권사에서도/.test(capEl.innerText) && txt.includes(usd(v)) && txt.includes(usd(C)) &&
         $$('#mh-rck .mh-rck-r s').length === low && (k !== '3' || (txt.includes(usd(np)) && low === orig.filter(p => p > np).length)),
         JSON.stringify([kase(), got, want, cap]));
    };
    await chk(Math.round(C * 1.05 * 100) / 100, '1', '−1.7% ~ +13% 사이 → 원래 가격 그대로');
    await chk(Math.ceil(C * 0.983 * 100) / 100, '1', '경계 −1.7% (그 위) → 원래 가격 · 지금 가격 × 1.15 안');
    await chk(Math.floor(C * 0.983 * 100) / 100 - 0.01, '3', '경계 −1.7% 아래 → 지금 가격 +10%');
    await chk(Math.round(C * 0.981 * 100) / 100, '3', '−1.9% (예전 경계 −2% 안 · +15% 한도 밖) → 지금 가격 +10%');
    await chk(Math.floor(C * 1.13 * 100) / 100, '1', '경계 +13% (그 아래) → 원래 가격');
    await chk(Math.ceil(C * 1.13 * 100) / 100 + 0.01, '2', '+13% 넘음 → 원래 가격 (지금 가격보다 낮음)');
    await chk(Math.round(C * 1.4 * 100) / 100, '2', '+40% → 원래 가격');
    await chk(Math.round(C * 0.9 * 100) / 100, '3', '−10% → 지금 가격 +10% · 그보다 높은 줄도 같은 가격 · 수량 그대로');
    let v6 = Math.round(C * 0.6 * 100) / 100; while ((Math.round(v6 * 100) * 110) % 100 < 50) v6 = Math.round(v6 * 100 + 1) / 100;   /* × 1.10 의 1센트 아래가 0.5 넘는 가격 — 버림/반올림이 갈리게 */
    await chk(v6, '3', '−40% (사용자 예: 100 → 60) → 지금 가격 +10% (1센트 버림 · +13% 아님)');
    { const lo0 = T.P.recheck.lo; try { T.P.recheck.lo = 3; const v = Math.round(C * 0.975 * 100) / 100, np = Math.floor(v * 110 + 1e-7) / 100, cap = Math.floor(v * 115 + 1e-7) / 100; await setP(v);
        const got = rows(), want = orig.map(p => p > cap + 1e-9 ? np : p), capEl = $('#mh-rck [data-rck-cap]');
        ok('안전장치: 다시 걸 가격이 지금 가격 × 1.15 를 넘는 줄은 지금 가격 +10% (경계를 −3% 로 넓혀 −2.5% 에서 시험)', kase() === '1' && orig.some(p => p > cap) && got.every((p, i) => Math.abs(p - want[i]) < 1e-9) && got.every(p => p <= cap + 1e-9) && capEl && /낮췄어요/.test(capEl.innerText), JSON.stringify([kase(), got, want, cap]));
      } finally { T.P.recheck.lo = lo0; } }
    ok('수량은 그대로 (줄마다 원래 수량 표시)', $$('#mh-rck .mh-rck-r').every((e, i) => e.innerText.includes(Number(R.rows[i].q).toLocaleString() + '주')), $$('#mh-rck .mh-rck-r').map(e => e.innerText).join(' | '));
    /* 마감 30분 전 시각 — 미국 동부 15:30 · 한국시간 서머타임 04:30 · 그 밖 05:30 · 휴장일 건너뜀 · 조기 폐장(13:00) 12:30 */
    const cb = (iso) => { const t = T.closeBefore(Date.parse(iso), 30); return [t.ds, t.kst, t.et, t.early, t.now]; };
    const tc = [['2026-10-15T00:00:00Z', ['2026-10-15', '10/16(금) 04:30', '15:30', false, false]], ['2026-12-15T15:00:00Z', ['2026-12-15', '12/16(수) 05:30', '15:30', false, false]],
                ['2026-11-26T15:00:00Z', ['2026-11-27', '11/28(토) 02:30', '12:30', true, false]], ['2026-10-17T15:00:00Z', ['2026-10-19', '10/20(화) 04:30', '15:30', false, false]],
                ['2026-10-15T19:45:00Z', ['2026-10-15', '10/16(금) 04:30', '15:30', false, true]], ['2026-10-15T19:29:00Z', ['2026-10-15', '10/16(금) 04:30', '15:30', false, false]],
                ['2026-10-15T20:00:00Z', ['2026-10-16', '10/17(토) 04:30', '15:30', false, false]], ['2026-07-02T20:30:00Z', ['2026-07-06', '7/7(화) 04:30', '15:30', false, false]],
                ['2026-11-27T17:45:00Z', ['2026-11-27', '11/28(토) 02:30', '12:30', true, true]], ['2026-03-09T13:00:00Z', ['2026-03-09', '3/10(화) 04:30', '15:30', false, false]]];
    const badT = tc.filter(([iso, w]) => JSON.stringify(cb(iso)) !== JSON.stringify(w)).map(([iso]) => iso + ' ' + JSON.stringify(cb(iso)));
    ok('마감 30분 전 시각 10가지 (서머타임·표준시·추수감사절 휴장 → 다음 날 조기 폐장·주말·마감 뒤·휴장 7/3·서머타임 시작 주)', !badT.length, badT.join(' | '));
    const hol = [['2026-04-03', 1], ['2026-07-03', 1], ['2027-07-05', 1], ['2027-06-18', 1], ['2027-12-24', 1], ['2028-01-01', 0], ['2026-11-26', 1], ['2026-10-14', 0]].filter(([d, w]) => +T.nyHoliday(d) !== w);
    const ear = [['2026-11-27', 1], ['2026-12-24', 1], ['2026-07-02', 0], ['2027-07-02', 0], ['2027-11-26', 1], ['2027-12-24', 0], ['2028-07-03', 1], ['2028-11-24', 1], ['2025-07-03', 1], ['2025-12-24', 1]].filter(([d, w]) => +T.nyEarly(d) !== w);
    ok('뉴욕증권거래소 휴장일·조기 폐장 = 발표 달력 (2025~2028)', !hol.length && !ear.length, JSON.stringify([hol, ear]));
    const real = Date.now; try { Date.now = () => Date.parse('2026-10-15T19:45:00Z'); T.rckPaint();
      ok('그 시간대(마감 30분 전 ~ 마감)엔 \'지금 확인할 때\' 강조', box().classList.contains('now') && /지금 확인할 때/.test($('#mh-rck-t').textContent), $('#mh-rck-t').textContent);
      Date.now = () => Date.parse('2026-10-15T21:00:00Z'); T.rckPaint();
      ok('그 밖엔 다음 마감 30분 전 시각만', !box().classList.contains('now') && /한국시간 10\/17\(토\) 04:30/.test($('#mh-rck-t').textContent) && !/지금 확인할 때/.test($('#mh-rck-t').textContent), $('#mh-rck-t').textContent);
    } finally { Date.now = real; T.rckPaint(); }
    const tx = box().innerText;
    ok('설명: 세 경우(−1.7% 아래 → 지금 가격 +10%) · 한도 +15% 증권사도 · 15:30 · 04:30 · 05:30 · 수량 그대로 · 접수 마감 · 무한매수법 용어 없음', /−1\.7% ~ \+13%/.test(tx) && /−1\.7% 아래 → 지금 가격 \+10%/.test(tx) && /한도가 \+15%인 증권사에서도/.test(tx) && !/−2%/.test(tx) && /15:30/.test(tx) && /04:30/.test(tx) && /05:30/.test(tx) && /수량은 그대로/.test(tx) && /접수 마감/.test(tx) && !bad(tx), bad(tx) || tx.slice(0, 160));
    await setP(Math.round(C * 0.6 * 100) / 100);
    ok('지금 한도 경고 요약에 \'마감 30분 전 다시 걸기\' 안내', /마감 30분 전 다시 걸기/.test(($('#mh-rjsum') || {}).innerText || ''), ($('#mh-rjsum') || {}).innerText);
  } catch (e) { ok('마감 30분 전 다시 걸기 오류', false, String(e && e.message)); }
  return R;
}"""

# ㉝ 백테스트 '증권사 주문 거부' — 반영 안 함 · 한도로 낮춰 넣기 · 그날 건너뛰기 = 엔진 직접 (같은 자료 · 로컬은 시가를 만들어 넣어 거부가 생기게, 배포는 실제 시가)
RJ_JS = """async (live) => {""" + PRE + r"""
  try {
    const s = ses().settings;
    const D = await MBT.load('SOXL');
    if (!live) D.o = D.c.map((c, i) => i ? (i % 3 === 0 ? D.c[i - 1] * 0.93 : D.c[i - 1]) : c);   /* 3일마다 시가 = 전날 × 0.93 → 한도 1.116 < 상단 매수선 1.13 */
    else await MBT.withOpen(D);
    if (MH.fold) MH.fold.bt = false; MH.sheet = null; MH.menu = false; MH.view = 'now';
    T.bt.per = 'all'; T.bt.pre = false; T.bt.rj = 'none'; T.bt.fl = 'none'; for (const k in T.bt.cache) delete T.bt.cache[k]; T.render();
    const r = await waitCard(), M = r && r.m ? { none: r.m['none|none'], clamp: r.m['none|clamp'], skip: r.m['none|skip'] } : {};
    ok('카드: 세 가지 처리 모두 계산 · 거부 비교 표 3줄', r && r.st === 'ok' && M.none && M.clamp && M.skip && $$('#mh-rjc tbody tr').length === 3, r && (r.st + ' ' + (r.msg || '')));
    if (!r || r.st !== 'ok' || !M.skip) return R;
    const F = await MBT.fxData().catch(() => null), o = T.btOpts(s), c = T.vcfg(s), cap = s.totalCapital, fx = F && o.tax ? MBT.fxFor(D.d, F) : null;
    const Dn = o.divs ? D : Object.assign({}, D, { dv: null }), base = { from: 1, to: D.d.length - 1, capital: cap, norm: 'auto', rows: false };
    const run = (rej, net) => MHV.run(c, Dn, Object.assign({}, base, net ? { fee: o.fee / 100, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: o.method, harvest: o.harvest } : null } : { fee: 0, sec: 0, divTax: 0, tax: null }, { rej }));
    const eq = (a, b) => ['final', 'cagr', 'mdd'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
    const badM = [];
    for (const m of ['none', 'clamp', 'skip']) { const rj = m === 'none' ? null : { mode: m, cap: 1.2 }, A = run(rj, true), G = run(rj, false);
      if (!eq(M[m].net, MBT.stats(A, D, cap)) || !eq(M[m].gross, MBT.stats(G, D, cap)) || JSON.stringify(M[m].rjN) !== JSON.stringify(A.rj) || JSON.stringify(M[m].rjG) !== JSON.stringify(G.rj)) badM.push(m); }
    ok('세 가지 = 엔진 직접 (포함·미포함 · 거부 통계)', !badM.length, badM.join(','));
    const Sc = M.clamp.rjN, Ss = M.skip.rjN;
    ok('거부가 실제로 생김 (' + (live ? '실제 시가' : '만든 시가') + ') · 달라진 날 ≤ 거부된 날 · 반영 안 함과 숫자가 다름', Sc.days > 0 && Sc.miss <= Sc.days && Ss.days > 0 && Ss.miss <= Ss.days && M.skip.net.final !== M.none.net.final, JSON.stringify([Sc, Ss]));
    const rows = $$('#mh-rjc tbody tr');
    ok('표 = 계산 값 (연평균·MDD · 거부 일수)', ['none', 'clamp', 'skip'].every((m, i) => rows[i].cells[1].textContent === pc(M[m].net.cagr, 2) && rows[i].cells[2].textContent === pc(M[m].net.mdd, 1)) &&
       rows[1].cells[4].textContent.startsWith(Sc.days.toLocaleString() + '일') && rows[2].cells[4].textContent.startsWith(Ss.days.toLocaleString() + '일'), rows.map(tr => tr.innerText.replace(/\s+/g, ' ')).join(' | '));
    ok('기본 = 반영 안 함 (카드 숫자 = 반영 안 함 · 단추 눌림)', T.bt.rj === 'none' && r.net === M.none.net && r.ch.net === M.none.eqN && $('#mh-rjc [data-act="bt-rj"][data-v="none"]').getAttribute('aria-pressed') === 'true');
    click('#mh-rjc [data-act="bt-rj"][data-v="skip"]'); await W(150);
    const kg = $('#mh-bt .mb-kg').innerText, help = $('#mh-bt .mh-help').innerText;
    ok('그날 건너뛰기를 고르면 위 숫자·그래프 = 그 처리 · 이 기기에 기억 · 설명 줄에 처리 이름', T.bt.rj === 'skip' && r.net === M.skip.net && r.ch.net === M.skip.eqN && kg.includes(pc(M.skip.net.cagr, 2)) &&
       localStorage.getItem('r72-bt-rj') === 'skip' && $('#mh-rjc tr.on').getAttribute('data-rj') === 'skip' && /증권사 주문 거부 그날 건너뛰기/.test(help), kg.slice(0, 120) + ' | ' + help.slice(0, 160));
    click('[data-act="bt-view"][data-v="gross"]'); await W(150);
    ok('미포함 보기: 표·위 숫자도 미포함 값', $$('#mh-rjc tbody tr')[2].cells[1].textContent === pc(M.skip.gross.cagr, 2) && $('#mh-bt .mb-kg').innerText.includes(pc(M.skip.gross.cagr, 2)));
    click('[data-act="bt-view"][data-v="net"]'); await W(100);
    click('#mh-rjc [data-act="bt-rj"][data-v="clamp"]'); await W(120);
    ok('한도로 낮춰 넣기로 바꿈 → 위 숫자 = 그 처리', T.bt.rj === 'clamp' && r.net === M.clamp.net && $('#mh-bt .mb-kg').innerText.includes(pc(M.clamp.net.cagr, 2)));
    click('#mh-rjc [data-act="bt-rj"][data-v="none"]'); await W(100);
    const tx = $('#mh-rjc').innerText;
    ok('되돌림 · 설명(시가 × 1.2 · 매도 그대로) · 무한매수법 용어 없음', T.bt.rj === 'none' && r.net === M.none.net && /시가 × 1\.2/.test(tx) && /매도 주문은 그대로/.test(tx) && !bad(tx), bad(tx) || tx.slice(0, 120));
  } catch (e) { ok('거부 비교 오류', false, String(e && e.message)); }
  return R;
}"""

# ㉞ 백테스트 '주문 넣는 때' — 기존 계산 · 정규장 시작 전(갭 상승 = 시가) · 프리장 시작(전날 종가 · 주문 거부 기준 전날 종가) = 엔진 직접
#   로컬은 이틀마다 시가 = 그날 고가로 만들어 넣어(그날 고가가 지정가에 닿으면 고가에 팔림) 차이가 생기게 · 배포는 실제 시가
FL_JS = """async (live) => {""" + PRE + r"""
  try {
    const s = ses().settings;
    const D = await MBT.load('SOXL');
    if (!live) D.o = D.c.map((c, i) => i % 2 === 0 && D.h ? Math.max(D.h[i], c) : i ? D.c[i - 1] : c);
    else await MBT.withOpen(D);
    if (MH.fold) MH.fold.bt = false; MH.sheet = null; MH.menu = false; MH.view = 'now';
    T.bt.per = 'all'; T.bt.pre = false; T.bt.rj = 'none'; T.bt.fl = 'none'; for (const k in T.bt.cache) delete T.bt.cache[k]; T.render();
    const r = await waitCard();
    const ks = () => Object.keys((r && r.m) || {}).sort().join(',');
    ok('카드: 주문 넣는 때 비교 표 3줄 · 거부 표 3줄 · 계산한 조합 = 고른 것 + 두 표에 필요한 것만 (5개)', r && r.st === 'ok' && $$('#mh-flc tbody tr').length === 3 && $$('#mh-rjc tbody tr').length === 3 && ks() === 'none|clamp,none|none,none|skip,open|none,pre|none', r && (r.st + ' ' + (r.msg || '') + ' ' + ks()));
    if (!r || r.st !== 'ok' || !r.m['open|none']) return R;
    const F = await MBT.fxData().catch(() => null), o = T.btOpts(s), c = T.vcfg(s), cap = s.totalCapital, fx = F && o.tax ? MBT.fxFor(D.d, F) : null;
    const Dn = o.divs ? D : Object.assign({}, D, { dv: null }), base = { from: 1, to: D.d.length - 1, capital: cap, norm: 'auto', rows: false };
    const run = (fill, rej, net) => MHV.run(c, Dn, Object.assign({}, base, net ? { fee: o.fee / 100, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: o.method, harvest: o.harvest } : null } : { fee: 0, sec: 0, divTax: 0, tax: null }, { rej, fill }));
    const eq = (a, b) => ['final', 'cagr', 'mdd'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
    const chk = (k) => { const [fl, rj] = k.split('|'), f = fl === 'none' ? null : fl, j = rj === 'none' ? null : { mode: rj, cap: 1.2 }, A = run(f, j, true), G = run(f, j, false), x = r.m[k];
      return !!x && eq(x.net, MBT.stats(A, D, cap)) && eq(x.gross, MBT.stats(G, D, cap)) && JSON.stringify(x.fxN) === JSON.stringify(A.fx) && JSON.stringify(x.fxG) === JSON.stringify(G.fx) && JSON.stringify(x.rjN) === JSON.stringify(A.rj); };
    const badK = ['none|none', 'open|none', 'pre|none'].filter(k => !chk(k));
    ok('세 가지 시각 = 엔진 직접 (포함·미포함 · 비싸게 팔린 날 통계)', !badK.length, badK.join(','));
    const Fo = r.m['open|none'].fxN;
    ok('정규장 시작 전: 비싸게 팔린 날 있음 (' + (live ? '실제 시가' : '만든 시가') + ') · 숫자가 기존과 다름 · 기존은 통계 없음', Fo.days > 0 && r.m['open|none'].net.final !== r.m['none|none'].net.final && r.m['none|none'].fxN === null, JSON.stringify(Fo));
    const rows = $$('#mh-flc tbody tr');
    ok('표 = 계산 값 (연평균·MDD · 비싸게 팔린 날) · 줄 이름', ['none', 'open', 'pre'].every((m, i) => rows[i].cells[1].textContent === pc(r.m[m + '|none'].net.cagr, 2) && rows[i].cells[2].textContent === pc(r.m[m + '|none'].net.mdd, 1) && rows[i].getAttribute('data-fl') === m) &&
       rows[1].cells[4].textContent === Fo.days.toLocaleString() + '일' && rows[0].cells[4].textContent === '—' && /기존 계산/.test(rows[0].cells[0].textContent) && /프리장 시작/.test(rows[2].cells[0].textContent) && /한국 17~18시/.test(rows[2].cells[0].textContent),
       rows.map(tr => tr.innerText.replace(/\s+/g, ' ')).join(' | '));
    ok('기본 = 기존 계산 (카드 숫자 = 기존 · 단추 눌림)', T.bt.fl === 'none' && r.net === r.m['none|none'].net && $('#mh-flc [data-act="bt-fl"][data-v="none"]').getAttribute('aria-pressed') === 'true');
    click('#mh-flc [data-act="bt-fl"][data-v="open"]'); await W(150);
    let kg = $('#mh-bt .mb-kg').innerText, help = $('#mh-bt .mh-help').innerText;
    ok('정규장 시작 전을 고르면 위 숫자·그래프 = 그 시각 · 이 기기에 기억 · 설명 줄 · 거부 표도 그 시각으로 계산', T.bt.fl === 'open' && r.net === r.m['open|none'].net && r.ch.net === r.m['open|none'].eqN && kg.includes(pc(r.m['open|none'].net.cagr, 2)) &&
       localStorage.getItem('r72-bt-fl') === 'open' && $('#mh-flc tr.on').getAttribute('data-fl') === 'open' && /정규장 시작 전에 넣었다고 봄/.test(help) && !!r.m['open|clamp'] && !!r.m['open|skip'] && $$('#mh-rjc tbody tr').length === 3 && /그날 시가 × 1\.2/.test($('#mh-rjc').innerText),
       kg.slice(0, 100) + ' | ' + help.slice(0, 160) + ' | ' + ks());
    ok('정규장 시작 전 × 주문 거부 = 엔진 직접', ['open|clamp', 'open|skip'].every(chk));
    click('#mh-flc [data-act="bt-fl"][data-v="pre"]'); await W(150);
    help = $('#mh-bt .mh-help').innerText; const rjt = $('#mh-rjc').innerText;
    ok('프리장 시작: 위 숫자 = 그 시각 · 거부 표 기준 = 전날 종가 × 1.2 · 설명', T.bt.fl === 'pre' && r.net === r.m['pre|none'].net && /프리장 시작\(한국 오후 5~6시\)에 넣었다고 봄/.test(help) && /전날 종가 × 1\.2/.test(rjt) && /주문 넣는 때 가격\(전날 종가\)/.test(rjt), help.slice(0, 160) + ' | ' + rjt.slice(0, 160));
    const Pc = r.m['pre|clamp'], Ps = r.m['pre|skip'];
    ok('프리장 시작 × 주문 거부 = 엔진 직접 · 상단 매수선 +13% < 전날 종가 × 1.2 → 거부 0일 · 세 처리 숫자 같음', ['pre|clamp', 'pre|skip'].every(chk) && Pc.rjN.days === 0 && Ps.rjN.days === 0 && Pc.net.final === r.m['pre|none'].net.final && Ps.net.final === r.m['pre|none'].net.final &&
       $$('#mh-rjc tbody tr')[2].cells[4].textContent.startsWith('0일'), JSON.stringify([Pc.rjN, Ps.rjN]));
    click('[data-act="bt-per"][data-v="5y"]'); const r5 = await waitCard();
    ok('프리장 시작을 고른 채 기간 5년 → 새 결과도 프리장 시작 (카드 숫자 = r.m[pre|none] · 표 3줄)', r5 && r5 !== r && r5.st === 'ok' && r5.net === r5.m['pre|none'].net && $('#mh-flc tr.on').getAttribute('data-fl') === 'pre' && $$('#mh-flc tbody tr').length === 3, r5 && Object.keys(r5.m || {}).join(','));
    click('[data-act="bt-per"][data-v="all"]'); await W(150);
    click('#mh-flc [data-act="bt-fl"][data-v="open"]'); await W(150);
    ok('전체 기간에서 정규장 시작 전으로 바꿔도 5년 결과는 그대로(보여 줄 때 계산) → 5년을 다시 열면 정규장 시작 전', r.net === r.m['open|none'].net && r5.pk === 'pre|none' && !r5.m['open|clamp'], r5.pk);
    click('[data-act="bt-per"][data-v="5y"]'); await W(200);
    ok('5년 다시 열기 → 정규장 시작 전 결과', card() === r5 && r5.pk === 'open|none' && r5.net === r5.m['open|none'].net, r5.pk);
    click('[data-act="bt-per"][data-v="all"]'); await W(150); click('#mh-flc [data-act="bt-fl"][data-v="pre"]'); await W(150);
    click('#mh-rjc [data-act="bt-rj"][data-v="skip"]'); await W(150);
    ok('거부 처리를 바꾸면 시각 표가 그 처리로 (줄마다 r.m[시각|skip]) · 머리말에 처리 이름', ['none', 'open', 'pre'].every((m, i) => r.m[m + '|skip'] && $$('#mh-flc tbody tr')[i].cells[1].textContent === pc(r.m[m + '|skip'].net.cagr, 2)) && /주문 거부 그날 건너뛰기/.test($('#mh-flc .mh-rjc-h').innerText) && $$('#mh-flc thead th').length === 5);
    click('[data-act="bt-view"][data-v="gross"]'); await W(150);
    ok('미포함 보기: 시각 표도 미포함 값', $$('#mh-flc tbody tr')[1].cells[1].textContent === pc(r.m['open|skip'].gross.cagr, 2) && $$('#mh-flc tbody tr')[1].cells[4].textContent === r.m['open|skip'].fxG.days.toLocaleString() + '일');
    click('[data-act="bt-view"][data-v="net"]'); await W(100);
    click('#mh-rjc [data-act="bt-rj"][data-v="none"]'); await W(100); click('#mh-flc [data-act="bt-fl"][data-v="none"]'); await W(120);
    const tx = $('#mh-flc').innerText;
    ok('되돌림 · 설명(LOC 매수는 셋 다 종가 · 프리장 고가 모름) · 무한매수법 용어 없음', T.bt.fl === 'none' && T.bt.rj === 'none' && r.net === r.m['none|none'].net && /LOC 매수는 셋 다 종가/.test(tx) && /프리장 고가는 몰라/.test(tx) && localStorage.getItem('r72-bt-fl') === 'none' && !bad(tx) && !bad($('#mh-bt').innerText), bad(tx) || bad($('#mh-bt').innerText) || tx.slice(0, 120));
    click('#mh-flc [data-act="bt-fl"][data-v="pre"]'); await W(150);
    ok('프리장 시작: 거부 기준은 전날 종가로 근사라고 설명 · 거부 표에 \'마감 30분 전 다시 걸기를 지키면 반영 안 함과 거의 같음\'', /전날 종가로 근사/.test($('#mh-flc').innerText) && /마감 30분 전 다시 걸기를 지키면/.test($('#mh-rjc').innerText) && !bad($('#mh-bt').innerText), $('#mh-flc').innerText.slice(-200));
    click('#mh-flc [data-act="bt-fl"][data-v="none"]'); await W(120);
  } catch (e) { ok('주문 넣는 때 비교 오류', false, String(e && e.message)); }
  return R;
}"""

MID_JS = """async () => {""" + PRE + """
  try {
    MH.menu = true; T.render(); click('.mh-menu [data-act="ses-add"]'); await W(150);
    click('[data-act="su-mid"][data-v="1"]'); await W(40);
    fill('[data-in="su:avg"]', '50'); fill('[data-in="su:qty"]', '100'); fill('[data-in="su:cash"]', '3000'); fill('[data-in="su:t"]', '72'); await W(40);
    const hm = document.getElementById('mh-su-dyn').innerText;
    ok('중간 진입 시작 화면: 72회를 다 썼으면 소진 대응으로 시작한다고 안내', /72회를 다 써서/.test(hm) && /원금 소진 대응으로 시작/.test(hm) && !/하루 \\d+주/.test(hm), hm);
    click('[data-act="su-start"]'); await W(400);
    const D = T.curD(), tx = rt().innerText, tags = D.orders.map(o => o.tag);
    ok('중간 진입 72회 다 씀 → 처음부터 소진 대응 · 매수 주문 없음 · 목표 지정가 + 평단 −10% LOC 전량',
       D.st.mode === 'xrec' && !D.orders.some(o => o.type === 'buy') && tags.indexOf('tp') >= 0 && tags.indexOf('xrec') >= 0, D.st.mode + ' ' + tags.join(','));
    ok('소진 안내: 회복 기다림 · 72루틴 고정 규칙 · 단계 "원금 소진" · 용어 없음', /소진 — 회복 기다림/.test(tx) && /72루틴 고정 규칙/.test(tx) && /원금 소진/.test(tx) && /평단 −10% LOC \\(전량\\)/.test(tx) && !bad(tx), bad(tx) || tx.slice(0, 200));
    ok('두 번째 세션 이름 72루틴 2', ses().name === '72루틴 2', ses().name);
  } catch (e) { ok('중간 진입 흐름 오류', false, String(e && e.message)); }
  return R;
}"""


CYCLE_JS = """async () => {""" + PRE + """
  try {
    const sid = 'cyc-test', st = T.store;
    st.sessions.push({ id: sid, name: '72루틴 3', settings: { ticker: 'SOXL', splits: 72, targetProfit: 52.5, bigNumPercent: 13, lowerLocShares: 1, lowerLocLines: 0, version: '1.0', exhaust: 'recover', btFee: 0.25, cycleNo: 2, totalCapital: 26000, base: 20000 },
      transactions: [{ id: 'c1', date: '2026-09-01T12:00:00', close: 100, fills: [{ side: 'B', p: 100, q: 2, tag: 'first', m: 'LOC' }] },
                     { id: 'c2', date: '2026-09-02T12:00:00', close: 150, fills: [{ side: 'S', p: 152.5, q: 2, tag: 'tp', m: 'LMT' }] }],
      isReverseMode: false, reverseStarPrice: null, archivedCycles: [], midEntry: null });
    st.activeSessionId = sid; MH.sheet = null; T.render(); await W(150);
    const bs = $$('[data-act="restart"], [data-act="cel-restart"]').map(b => [b.getAttribute('data-act'), b.getAttribute('data-v'), b.textContent.trim()]);
    const base = bs.filter(b => /처음 원금으로 재시작/.test(b[2])), cont = bs.filter(b => /이어서 재시작/.test(b[2]));
    ok('사이클 끝: 처음 원금으로 재시작 = 처음 원금 $20,000 (이번 원금 $26,000 아님) · 이어서 재시작 = 원금 + 번 돈',
       base.length >= 1 && base.every(b => b[1] === '20000' && /\\$20,000/.test(b[2])) && cont.length >= 1 && cont.every(b => Math.abs(Number(b[1]) - 26105) < 1e-6), JSON.stringify(bs));
    const tx = rt().innerText;
    ok('사이클 끝 화면·축하 창 무한매수법 용어 없음', !bad(tx), bad(tx));
    MH.sheet = null; T.render(); await W(50);
    $$('[data-act="restart"]').filter(b => /처음 원금으로 재시작/.test(b.textContent))[0].click(); await W(150);
    const s2 = ses().settings;
    ok('처음 원금으로 재시작 → 새 사이클 원금 $20,000 · 지난 사이클 보관', s2.totalCapital === 20000 && s2.base === 20000 && ses().archivedCycles.length === 1 && !ses().transactions.length, JSON.stringify([s2.totalCapital, s2.base, ses().archivedCycles.length]));
  } catch (e) { ok('사이클 끝 흐름 오류', false, String(e && e.message)); }
  return R;
}"""



# ㊵ 최소 원금 안내 (자동매매 프로그램 mincap.js 와 같은 기준) — 시작 화면 원금 칸 아래 단계 · 오늘의 주문 안내(함수)
MC_JS = """async () => {""" + PRE + r"""
  try {
    const pxOf = () => { const m = MH.market.SOXL; return m && m.quote && m.quote.price > 0 ? m.quote.price : m && m.prices && m.prices.length ? m.prices[m.prices.length - 1].close : null; };
    for (let i = 0; i < 150 && !pxOf(); i++) await W(100);
    const px = pxOf();
    ok('최소 원금: 지금 시세가 있음', px > 0, px);
    if (px > 0) {
      const usd = x => '$' + Number(x).toLocaleString('en-US'), need = k => Math.ceil(72 * k * px - 1e-9);
      const LOSS = [[1, 33], [2, 25], [3, 16], [4, 12], [5, 9], [6, 8], [8, 6], [10, 5], [15, 4], [20, 3]], loss = n => { let v = null; LOSS.forEach(x => { if (n >= x[0]) v = x[1]; }); return v; };
      const LV = n => n < 1 ? 'none' : n < 2 ? 'one' : n < 10 ? 'low' : 'ok', res = [];
      for (const cap of [Math.floor(72 * px * 0.6), need(1) - 1, need(1), need(2) - 1, need(2), need(5) + 3, need(9), need(10) - 1, need(10), need(25)]) {
        fill('[data-in="su:cap"]', String(cap)); await W(30);
        const e = document.getElementById('mh-mc'), n = Math.floor(cap / 72 / px + 1e-9), t = e ? e.innerText : '', want = LV(n);
        const more = want === 'none' ? ['⛔', '1주도 못 사서', '원금 최소 ' + usd(need(1)), '권장 ' + usd(need(10))] : want === 'one' ? ['⚠', '두 줄로 나눠 사지 못해', '두 줄이 되려면 ' + usd(need(2)), '권장 ' + usd(need(10))]
          : want === 'low' ? ['△', '백테스트에서 연 수익률이 평균 ' + loss(n) + '%p 낮았어요', '권장 ' + usd(need(10))] : ['✓', '권장(1회 10주 · ' + usd(need(10)) + ') 이상'];
        res.push([cap, n, e && e.getAttribute('data-mc'), e && e.getAttribute('data-mc') === want && t.includes('하루 ' + n + '주') && more.every(w => t.includes(w)) ? 'ok' : 'BAD ' + t.slice(0, 200)]);
      }
      ok('시작 화면 최소 원금: 0주 ⛔ · 1주 ⚠ · 2~9주 △(백테스트 손해 %p) · 10주 ✓ — 경계(72·144·720 × 가격 올림)·금액이 따로 한 계산과 같음', res.every(r => r[3] === 'ok') && res.map(r => r[2]).join() === 'none,none,one,one,low,low,low,low,ok,ok', JSON.stringify(res));
    }
    fill('[data-in="su:cap"]', ''); await W(40);
    const D0 = { close: 110, P: { one: 100 }, st: { mode: 'normal' }, cur: 'USD' }, f = x => T.mcOrd(Object.assign({}, D0, x));
    const o = [f({}), f({ P: { one: 150 }, st: { mode: 'idle' } }), f({ P: { one: 220 } }), f({ st: { mode: 'xrec' } }), f({ P: { one: 100, wait: true } }), f({ close: null })];
    ok('오늘의 주문 안내: 0주 = 매수 주문 없음 + 최소·권장 원금 · 1주 = 두 줄 원금 · 2주 이상·원금 소진·RSI 대기·종가 없음 = 없음',
       /data-mc="none"/.test(o[0]) && /1주\(전일 종가 \$110\.00\)도 못 사서 오늘은 매수 주문이 없어요/.test(o[0]) && /원금 최소 \$7,920 · 권장 \$79,200 \(1회 10주\)/.test(o[0]) &&
       /data-mc="one"/.test(o[1]) && /하루 1주만 살 수 있어/.test(o[1]) && /두 줄이 되려면 원금 \$15,840/.test(o[1]) && o.slice(2).every(x => x === ''), o.map(x => x.slice(0, 140)).join(' | '));
    ok('최소 원금 문구에 무한매수법 용어 없음', !bad(o[0] + o[1]) && !bad((document.getElementById('mh-su-dyn') || {}).innerText), bad(o[0] + o[1]));
  } catch (e) { ok('최소 원금 안내 흐름 오류', false, String(e && e.message)); }
  return R;
}"""


# 시작한 뒤 오늘의 주문 카드 — 1회 매수금으로 0주·1주면 #mh-mcord (원금 = 72 × 가격 × k)
ORD_JS = """async (want) => {""" + PRE + r"""
  try {
    for (let i = 0; i < 100 && !(T.curD() && T.curD().P); i++) await W(100);
    const D = T.curD(), n = Math.floor(D.P.one / D.close + 1e-9), e = document.getElementById('mh-mcord'), lv = e && e.getAttribute('data-mc');
    ok('오늘의 주문 최소 원금 안내 ' + want + ' (1회 ' + D.P.one.toFixed(2) + ' ÷ 전일 종가 ' + D.close + ' = ' + n + '주)', (n < 1 ? 'none' : n < 2 ? 'one' : 'x') === want && lv === want &&
       (want === 'none' ? !D.orders.some(x => x.type === 'buy') : D.orders.filter(x => x.type === 'buy').reduce((a, x) => a + x.quantity, 0) === 1), [n, lv, D.orders.map(x => x.type + x.quantity).join(',')]);
  } catch (e) { ok('오늘의 주문 안내 흐름 오류', false, String(e && e.message)); }
  return R;
}"""


# ⋮ 원금 바꾸기 — 중간 진입 세션도 남은 현금·1회 매수금에 (자동매매 프로그램 ledger.addCapital 과 같은 계산) · 잔금보다 많이 못 줄임
CAP_JS = """async () => {""" + PRE + r"""
  const c0 = window.confirm, a0 = window.alert, al = [];
  try {
    window.confirm = () => true; window.alert = m => al.push(String(m));
    const st = T.store, mk = (id, mid, txs) => { st.sessions.push({ id, name: id, settings: { ticker: 'SOXL', splits: 72, targetProfit: 52.5, bigNumPercent: 13, lowerLocShares: 1, lowerLocLines: 0, version: '1.0', exhaust: 'recover', btFee: 0.25, totalCapital: 15000 },
      transactions: txs || [], isReverseMode: false, reverseStarPrice: null, archivedCycles: [], midEntry: mid }); st.activeSessionId = id; MH.sheet = null; MH.menu = true; T.render(); };
    const cap = async v => { fill('#mh-m-cap', String(v)); click('[data-act="ap-cap"]'); await W(80); MH.menu = true; T.render(); await W(30); };
    const C = () => T.vCompute(ses().settings, ses().transactions, ses().midEntry);
    mk('cap-mid', { tValue: 20, avgPrice: 100, totalQuantity: 40, remainingCapital: 11000, one: 15000 / 72, xc: 1 });
    const a = C(); await cap(75000); const b = C(), m = ses().midEntry;
    ok('중간 진입 세션 원금 15,000 → 75,000: 잔금 11,000 → 71,000 · 1회 208.33 → 1,041.67 · 회차 20 그대로',
       ses().settings.totalCapital === 75000 && Math.abs(a.remainingCapital - 11000) < 1e-9 && Math.abs(b.remainingCapital - 71000) < 1e-9 && Math.abs(a.buyAmount - 208.33) < 0.006 && Math.abs(b.buyAmount - 1041.67) < 0.006 &&
       b.tValue === 20 && m.remainingCapital === 71000 && Math.abs(m.one - (15000 + 60000) / 72) < 1e-9, JSON.stringify([a.remainingCapital, b.remainingCapital, a.buyAmount, b.buyAmount, b.tValue, m]));
    al.length = 0; await cap(1000);
    ok('잔금(71,000)보다 많이 줄이면 막음 · 그대로', al.length === 1 && /많이 줄일 수 없어요/.test(al[0]) && ses().settings.totalCapital === 75000 && ses().midEntry.remainingCapital === 71000, al.join(' | '));
    await cap(70000); const c = C();
    ok('줄이기(−5,000)도 같은 계산: 잔금 66,000 · 1회 = 1,041.67 − 5,000 ÷ 72', Math.abs(c.remainingCapital - 66000) < 1e-9 && Math.abs(ses().midEntry.one - 70000 / 72) < 1e-9, JSON.stringify([c.remainingCapital, ses().midEntry.one]));
    mk('cap-new', null, [{ id: 'n1', date: '2026-09-01T12:00:00', close: 100, fills: [{ side: 'B', p: 100, q: 2, tag: 'first', m: 'LOC' }] }]);
    const d = C(); await cap(75000); const e2 = C();
    ok('새로 시작 세션도 같은 결과: 잔금 +60,000 · 1회 = 지금 1회 + 60,000 ÷ 72', Math.abs(e2.remainingCapital - d.remainingCapital - 60000) < 1e-9 && Math.abs(e2.buyAmount - (d.buyAmount + 60000 / 72)) < 0.011 && ses().midEntry === null, JSON.stringify([d.remainingCapital, e2.remainingCapital, d.buyAmount, e2.buyAmount]));
    st.sessions = st.sessions.filter(x => x.id !== 'cap-mid' && x.id !== 'cap-new'); st.activeSessionId = st.sessions[0].id; MH.menu = false; T.render();
    localStorage.setItem(T.P.key, JSON.stringify(st));   /* 검사용 세션을 지운 상태로 저장 (뒤 '새로고침 뒤 세션 3개' 검사) */
  } catch (e) { ok('원금 바꾸기 흐름 오류', false, String(e && e.message)); }
  finally { window.confirm = c0; window.alert = a0; }
  return R;
}"""

# 원금 넣고 시작 — 한 번의 실행 안에서(입력 → 시작) 끝내야 함: 따로 하면 그 사이 비동기 다시 그리기(로그인 준비·테마)가
# 입력칸을 새로 만들어 입력이 사라짐 (CI 에서 시작하기가 꺼진 채 30초 기다림)
START_JS = """(cap) => { const r = document.getElementById('t7-root'), e = r.querySelector('[data-in="su:cap"]'); if (!e) return false;
  e.value = cap; e.dispatchEvent(new Event('input', { bubbles: true })); const b = r.querySelector('[data-act="su-start"]'); if (!b || b.disabled) return false;
  b.click(); return !!(T72debug.store.sessions[0] && T72debug.store.sessions[0].settings); }"""


def _fresh(page, base):
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
    page.evaluate(CLEAR)
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
    page.wait_for_function("window.T72debug && document.querySelector('#t7-root [data-act=\"su-start\"]')", timeout=60000)


def _sync(page, base, fail):
    """가짜 로그인으로 계정 자동 저장 경로 확인 — Worker 요청은 모두 이 검사 안에서 가로채 답함 (실제 계정·서버 안 건드림)"""
    calls = []
    hd = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Content-Type': 'application/json'}

    def wk(route):
        q = route.request
        if '/etf?' in q.url:
            return route.fallback()
        path = re.sub(r'^https?://[^/]+', '', q.url).split('?')[0]
        if q.method == 'OPTIONS':
            return route.fulfill(status=204, headers=hd, body='')
        if path.endswith('/auth/config'):
            return route.fulfill(status=200, headers=hd, body=json.dumps({'providers': {'kakao': {'id': 'test'}}}))
        if path.startswith('/udata/'):
            calls.append((q.method, path, q.post_data or ''))
            if q.method == 'GET':
                return route.fulfill(status=200, headers=hd, body=json.dumps({'v': None, 't': 0}))
            return route.fulfill(status=200, headers=hd, body=json.dumps({'t': 1700000000000 + len(calls)}))
        return route.fulfill(status=200, headers=hd, body='{}')
    pat = re.compile(r'^https://[^/]*workers\.dev/.*')
    page.route(pat, wk)
    try:
        page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
        page.evaluate(CLEAR)
        page.evaluate("() => localStorage.setItem('dc_auth', JSON.stringify({ token: 'test.test.test', exp: 4102444800, user: { id: 'u-test', nickname: '검사' } }))")
        page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
        page.wait_for_function("window.T72debug && document.querySelector('#t7-root [data-act=\"su-start\"]')", timeout=60000)
        page.wait_for_timeout(1200)
        t0 = page.evaluate("() => document.getElementById('t7-root').innerText")
        if not page.evaluate(START_JS, '15000'):
            raise RuntimeError('원금 $15,000 으로 시작하지 못함')
        page.wait_for_timeout(2500)
        posts = [c for c in calls if c[0] == 'POST' and c[1] == '/udata/r72']
        v = json.loads(posts[-1][2]).get('v') if posts else None
        if not any(c[0] == 'GET' and c[1] == '/udata/r72' for c in calls):
            fail('72 계정', '로그인 상태로 열었는데 계정 기록을 읽지 않음 (GET /udata/r72) %r' % calls[:4])
        if not v or v['sessions'][0]['settings'].get('version') != '1.0' or v['sessions'][0]['settings'].get('totalCapital') != 15000 or v['sessions'][0]['name'] != '72루틴':
            fail('72 계정', '시작한 기록이 계정에 자동 저장되지 않음 (POST /udata/r72) %r' % [(c[0], c[1]) for c in calls])
        if any('/udata/muhan' in c[1] or '/udata/vr' in c[1] for c in calls):
            fail('72 계정', '72루틴 화면이 다른 기록 키를 부름 %r' % [(c[0], c[1]) for c in calls])
        if '로그인 상태 — 계정에 자동 저장' not in t0:
            fail('72 계정', '시작 화면에 로그인 자동 저장 안내가 없음')
        print('    계정 자동 저장: %s' % ' → '.join('%s %s' % (c[0], c[1]) for c in calls[:4]), flush=True)
    except Exception as e:
        fail('72 계정', '로그인 자동 저장 검사 오류: %s' % str(e)[:160])
    finally:
        page.evaluate("() => { localStorage.removeItem('dc_auth'); }")
        page.evaluate(CLEAR)
        page.unroute(pat, wk)


def check(page, base, local, fail, errs, ignorable, widths, OVERFLOW_JS):
    print('[T72] 72루틴', flush=True)
    errs.clear()
    page.set_viewport_size({'width': 430, 'height': 900})
    n = [0, 0]

    def report(where, ts):
        for t in ts:
            n[0] += 1
            if not t['ok']:
                n[1] += 1
                fail(where, '%s%s' % (t['name'], (' — ' + t['info']) if t.get('info') else ''))

    def overflow(what):
        for w in widths:
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(120)
            r = page.evaluate(OVERFLOW_JS)
            if r['sw'] > r['vw'] + 1 or r['out']:
                fail('72', '%s %dpx 넘침 (문서 %dpx)%s' % (what, w, r['sw'], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
        page.set_viewport_size({'width': 430, 'height': 900}); page.wait_for_timeout(120)

    _fresh(page, base)
    mh0 = page.evaluate("() => localStorage.getItem('muhan4-store')")
    # 예전 '72매매법' 화면 기록이 남아 있으면 안내 (옮기지 못함 · 중간 진입) · [알림 지우기] = 예전 키 삭제
    page.evaluate("() => { localStorage.setItem('t72-log', JSON.stringify({ start: '2025-03-03', ov: {} })); localStorage.setItem('t72-set', '{}'); }")
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
    page.wait_for_function("window.T72debug && document.querySelector('#t7-root [data-act=\"su-start\"]')", timeout=60000)
    lg = page.evaluate("() => { const n = document.getElementById('mh-legacy'); return n ? n.innerText : ''; }")
    n[0] += 1
    if '2025-03-03' not in lg or '중간 진입' not in lg:
        n[1] += 1; fail('72 시작', '예전 화면 기록 안내가 없음 %r' % lg[:120])
    if not page.evaluate("() => { const b = document.querySelector('#mh-legacy [data-act=\"legacy-x\"]'); if (b) b.click(); return !!b; }"):
        page.evaluate(CLEAR)   # 안내가 없으면(위에서 이미 실패) 예전 키만 지우고 계속
    page.wait_for_timeout(150)
    n[0] += 1
    if page.evaluate("() => !!document.getElementById('mh-legacy') || !!localStorage.getItem('t72-log') || !!localStorage.getItem('t72-set')"):
        n[1] += 1; fail('72 시작', '[알림 지우기] 뒤에도 예전 기록 안내·키가 남음')
    page.evaluate("() => { const T = T72debug; T.MH.setup.more = true; T.render(); }")
    overflow('시작 화면(세부옵션 펼침)')
    page.evaluate("() => { const T = T72debug; T.MH.setup.more = false; T.render(); }")
    report('72 최소 원금', page.evaluate(MC_JS))
    report('72 시작', page.evaluate(SETUP_JS))
    report('72 현재', page.evaluate(NOW_JS))
    overflow('현재 화면(기록 3일)')
    report('72 실시간', page.evaluate(LIVE_JS))
    report('72 실시간 시세', page.evaluate(LQ_JS))
    report('72 마감 30분 전 다시 걸기', page.evaluate(RCK_JS))
    overflow('현재 화면(마감 30분 전 다시 걸기 · −40% → 지금 가격 +10%)')
    page.evaluate("() => { const T = T72debug; T.MH.capEdited = false; T.MH.capBase = null; T.render(); }")
    if not local:
        report('72 실시간 시세', page.evaluate(LQ_REAL_JS))
    report('72 백테스트', page.evaluate(BT_JS, not local))
    report('72 백테스트 주문 거부', page.evaluate(RJ_JS, not local))
    overflow('현재 화면(백테스트 주문 거부 비교)')
    report('72 백테스트 주문 넣는 때', page.evaluate(FL_JS, not local))
    CLK = "(q) => { const e = document.querySelector('#t7-root ' + q); if (e) e.click(); return !!e; }"
    n[0] += 1
    if not (page.evaluate(CLK, '#mh-flc [data-act="bt-fl"][data-v="pre"]') and page.evaluate(CLK, '#mh-rjc [data-act="bt-rj"][data-v="skip"]')):
        n[1] += 1; fail('72 백테스트', '주문 넣는 때·거부 처리 단추를 찾지 못함')
    page.wait_for_timeout(300)
    overflow('현재 화면(주문 넣는 때 프리장 시작 + 그날 건너뛰기)')
    page.evaluate(CLK, '#mh-rjc [data-act="bt-rj"][data-v="none"]'); page.evaluate(CLK, '#mh-flc [data-act="bt-fl"][data-v="none"]'); page.wait_for_timeout(200)
    # ㉜ 좁은 화면에서도 '세금·수수료 포함'·'미포함' 두 단추는 한 줄에 나란히 (따로 줄바꿈되지 않음)
    ROW1 = "() => { const v = [...document.querySelectorAll('#t7-root #mh-bt [data-act=\"bt-view\"]')]; return v.length === 2 && Math.abs(v[0].getBoundingClientRect().top - v[1].getBoundingClientRect().top) < 2; }"
    for w, fs in ((320, 1), (360, 1), (390, 1), (320, 1.3)):   # 글자 크기 130%(⋮ 메뉴 글자 크기)면 줄이 모자라 단추가 다음 줄로 — 그때도 두 단추는 함께
        page.set_viewport_size({'width': w, 'height': 900}); page.evaluate("(fs) => { T72debug.MH.fontScale = fs; T72debug.render(); }", fs); page.wait_for_timeout(150)
        n[0] += 1
        if not page.evaluate(ROW1):
            n[1] += 1; fail('72 백테스트', '%dpx · 글자 %d%% 에서 세금·수수료 포함/미포함 단추가 한 줄에 나란히 있지 않음' % (w, fs * 100))
    page.evaluate("() => { T72debug.MH.fontScale = 1; T72debug.render(); }")
    page.set_viewport_size({'width': 430, 'height': 900}); page.wait_for_timeout(120)
    page.evaluate("() => { const T = T72debug; T.MH.sheet = { kind: 'btz', key: T.btKey(T.store.sessions[0].settings) }; T.render(); }")
    page.wait_for_timeout(400)
    overflow('크게 보기 창')
    page.evaluate("() => { T72debug.MH.sheet = null; T72debug.render(); }")
    report('72 중간 진입', page.evaluate(MID_JS))
    report('72 사이클 끝', page.evaluate(CYCLE_JS))
    report('72 원금 바꾸기', page.evaluate(CAP_JS))
    # 새로고침 뒤 그대로 (세션 3개 · 첫 세션 기록 3일 · 접은 카드)
    page.evaluate("() => localStorage.setItem('r72-fold', JSON.stringify({ vix: true }))")
    page.reload(wait_until='load')
    try:
        page.wait_for_function("window.T72debug && T72debug.store.sessions.length === 3 && document.querySelector('#t7-root .mh-top')", timeout=30000)
        if page.evaluate("() => T72debug.store.sessions[0].transactions.length") != 3:
            fail('72', '새로고침 뒤 첫 세션 기록 3일이 남지 않음')
        n[0] += 1
        if page.evaluate("() => T72debug.MH.vix.length > 0 && !document.querySelector('#t7-root .mh-fold-shut[data-fold=\"vix\"]')"):
            n[1] += 1; fail('72', '새로고침 뒤 접어 둔 VIX 카드가 펼쳐져 있음 (접기 기억 안 됨)')
    except Exception as e:
        fail('72', '새로고침 뒤 기록이 남지 않음: %s' % str(e)[:120])
    page.evaluate("() => localStorage.removeItem('r72-fold')")
    if page.evaluate("() => localStorage.getItem('muhan4-store')") != mh0:
        fail('72', '72루틴 화면이 무한매수법 기록(muhan4-store)을 바꿈')
    # ㉜ 시작 원금 칸을 비우고 시작 → $100,000
    _fresh(page, base)
    n[0] += 1
    if not page.evaluate(START_JS, '') or page.evaluate("() => T72debug.store.sessions[0].settings.totalCapital") != 100000:
        n[1] += 1; fail('72 시작', '시작 원금 칸을 비우고 시작했는데 원금이 $100,000 이 아님')
    # 기본 설정(원금 $10,000 · 수수료 0.25%) 카드 = 같은 조건 무한매수법 백테스트 화면 (같은 엔진·같은 자료 · 고정 규칙이 V1.0 설정 그대로)
    _fresh(page, base)
    try:
        if not page.evaluate(START_JS, '10000'):
            raise RuntimeError('원금 $10,000 으로 시작하지 못함')
        page.wait_for_function("() => { const T = T72debug, s = T.store.sessions[0].settings, c = s && T.bt.cache[T.btKey(s)]; return c && (c.st === 'ok' || c.st === 'err'); }", timeout=180000)
        c = page.evaluate("() => { const T = T72debug, r = T.bt.cache[T.btKey(T.store.sessions[0].settings)]; return r.st === 'ok' ? { cagr: r.net.cagr, mdd: r.net.mdd, final: r.net.final, gc: r.gross.cagr, from: r.from, to: r.to, fee: r.o.fee } : { err: r.msg || 'err' }; }")
        if c.get('err') or c.get('fee') != 0.25:
            fail('72', '기본 설정 카드 계산 실패 또는 수수료가 0.25%%가 아님 %r' % c)
        elif os.path.isdir(os.path.join(ROOT, 'muhan-backtest')) or not local:
            page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=1.0&t=SOXL&c=10000&sp=72&tg=52.5&bg=13&fe=0.25&x=recover', wait_until='load')
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().sn', timeout=180000)
            m = page.evaluate("(() => { const R = MBTdebug.R(); return { cagr: R.sn.cagr, mdd: R.sn.mdd, final: R.sn.final, gc: R.sg.cagr, from: R.D.d[R.net.from], to: R.D.d[R.net.to] }; })()")
            bad = [k for k in ('cagr', 'mdd', 'final', 'gc') if abs(m[k] - c[k]) > 1e-9 * max(1, abs(m[k]))]
            if bad or m['from'] != c['from'] or m['to'] != c['to']:
                fail('72', '기본 설정 카드와 같은 조건 무한매수법 백테스트 화면 숫자가 다름 %s — 72 %s · 시뮬레이터 %s' % (bad, json.dumps(c), json.dumps(m)))
            else:
                print('    72 카드 = 시뮬레이터 (기본 설정 · 수수료 0.25%%): CAGR %.2f%% · MDD %.2f%%' % (c['cagr'] * 100, c['mdd'] * 100), flush=True)
    except Exception as e:
        fail('72', '기본 설정 카드·시뮬레이터 비교 오류: %s' % str(e)[:160])
    # ㊵ 시작한 뒤 오늘의 주문 — 1회 매수금으로 0주(원금 = 72 × 가격 × 0.5)·1주(× 1.5)면 이유와 필요한 원금
    PX_JS = "() => { const m = T72debug.MH.market.SOXL; return m && m.prices && m.prices.length ? m.prices[m.prices.length - 1].close : null; }"
    for k, want in ((0.5, 'none'), (1.5, 'one')):
        _fresh(page, base)
        try:
            page.wait_for_function("() => { const m = T72debug.MH.market.SOXL; return m && m.prices && m.prices.length; }", timeout=30000)
            if not page.evaluate(START_JS, str(int(72 * page.evaluate(PX_JS) * k))):
                raise RuntimeError('작은 원금으로 시작하지 못함')
            page.wait_for_timeout(300)
            report('72 최소 원금 주문', page.evaluate(ORD_JS, want))
        except Exception as e:
            n[0] += 1; n[1] += 1; fail('72 최소 원금 주문', '오류: %s' % str(e)[:160])
    # 로그인 자동 저장
    _sync(page, base, fail)
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
    page.evaluate(CLEAR)
    for t in [t for t, u in errs if not ignorable(t, u)][:3]:
        fail('72', '콘솔 오류: ' + t[:200])
    print('  72루틴 화면 검사 %d개 · 실패 %d' % (n[0], n[1]), flush=True)
    page.set_viewport_size({'width': 1440, 'height': 900})
