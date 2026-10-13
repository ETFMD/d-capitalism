"""밸류리밸런싱 VR 5.0 백테스트 회귀 검사 — run_regression.py 가 부름 (check)

  · 엔진: node tests/vr_bt_test.js (기존 엔진과 같은 결과 · 라오어 공개 수치 재현 · 매수표·매도표 = 체결 · 세금 독립 계산 …)
  · /vr-backtest/ 화면: 주소로 조건 복원·자동 실행 · 핵심 6칸 · 유형 3 · 접이식 7 · 세금·수수료 포함/미포함 · 표 3가지 ·
    화면 숫자 = 같은 자료로 엔진을 직접 돌린 값(수수료·SEC·원천징수·양도세 연결 확인) · 유형 바꾸기(적립식 = 공식 시작값 · IRR) · 실행 기록 ·
    주소 왕복(모든 조건) · 접이식(처음 상태·요약 글자·파란색·펼침 기억·입력 즉시 요약) · 모두 펼친 채 화면 폭 넘침 · 알림(인출로 멈춤·30개 미만) · 상장 전
  · /vr/ 기록 화면: '이 설정으로 백테스트' 카드 숫자 = '자세히 보기'로 연 시뮬레이터 숫자
"""
import json, os, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MAIN_JS = """async (local) => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const res = () => window.VBTdebug && VBTdebug.R(), $ = q => document.querySelector(q), $$ = q => document.querySelectorAll(q);
  for (let i = 0; i < 360 && !(res() && (!res().pre || res().pre.err)); i++) await W(250);
  const r = res(); if (!r) return [{ name: '백테스트 결과 없음 (90초)', ok: false, info: ($('#vb-res') || {}).innerText }];
  ok('주소(#ty=hold&t=TQQQ…)로 조건 복원·자동 실행', r.S.type === 'hold' && r.tk === 'TQQQ' && r.S.G === 10 && r.S.band === 15 && r.S.limit === 50 && r.S.pre === true, JSON.stringify([r.S.type, r.tk, r.S.G, r.S.band, r.S.limit, r.S.pre]));
  ok('핵심 6칸 · 유형 3 · 종목 6 · 접이식 7', $$('#vb-res .mb-k').length === 6 && $$('#vb-set .mb-ver').length === 3 && $$('#vb-set .mb-tk').length === 6 && $$('#vb-set .mb-acc').length === 7);
  ok('세금·수수료 포함 보기만 수수료·세금 (미포함은 0)', r.sn.fees > 0 && r.sg.fees === 0 && r.sg.tax === 0 && r.net.taxes.length > 0 && !r.gross.taxes.length, JSON.stringify([r.sn.fees, r.sg.fees, r.sn.tax]));
  ok('연도별 표', $$('#vb-tb tbody tr').length >= 5, $$('#vb-tb tbody tr').length);
  ok('상장 전: 재현을 붙였으면 오차 카드, 아니면 안내', (r.pre && r.pre.err && $('#vb-res .mb-pre')) || (!r.pre && /상장 전/.test(r.note || '')), r.pre ? JSON.stringify(r.pre.err) : r.note);
  /* 일봉 자료: 시가·고가·저가로 체결 판단 (실사이트 = 야후 원문) · 없으면 안내 · 상장 전 재현 구간은 시가 없음 */
  { const D = r.D, L = r.pre ? r.pre.L : 0;
    if (!local) {
      let nb = 0; for (let i = L; i < D.d.length; i++) if (D.o == null || D.o[i] == null) nb++;
      ok('실사이트: 야후 일봉 원문(시가·고가·저가) · 빠진 날 5일 이하', D.src === 'y' && D.o && nb <= 5 && !/받지 못해/.test(r.note || ''), JSON.stringify([D.src, !!D.o, nb, r.note]));
      /* 종가로 판단(상장 전 재현 구간 방식) vs 실제 시가·고가·저가 — 상장 뒤 실제 일봉으로 같은 조건 연수익 차이 (설명글: 보통 0.1%p 안팎 · 크게는 0.5%p) */
      const pick = x => x ? x.slice(L) : x, Dr = { d: D.d.slice(L), c: D.c.slice(L), h: pick(D.h), l: pick(D.l), o: pick(D.o), dv: pick(D.dv) }, oo = { from: 0, capital: 10000, norm: 'auto', rows: false };
      const ia = window.VRE.summary(window.VRE.run(r.cfg, Dr, oo), Dr, 10000).irr, ib = window.VRE.summary(window.VRE.run(r.cfg, Object.assign({}, Dr, { o: null }), oo), Dr, 10000).irr;
      ok('실제 일봉: 종가로 판단한 연수익이 시가·고가·저가로 계산한 값과 0.6%p 안', Math.abs(ia - ib) < 0.006, [ia, ib].map(x => (x * 100).toFixed(3)).join(' vs '));
    } else ok('시가·고가·저가가 없으면 종가로 판단 안내', D.o ? true : /종가로 판단/.test(r.note || ''), r.note);
    if (r.pre) ok('상장 전 재현 구간: 시가 없음 · 고가 = 저가 = 종가', D.c.slice(0, L).every((x, i) => D.h[i] === x && D.l[i] === x && (!D.o || D.o[i] == null)), L);
    if (r.pre && r.pre.err) { const t = ($('#vb-res .mb-pre') || {}).innerText || ''; ok('상장 전 오차 카드: 종가로 체결 판단 설명 (분위 추정 문구 없음)', /종가로 체결을 판단|종가로 판단/.test(t) && !/분위/.test(t), t.slice(0, 120)); }
  }
  /* VBD.ohlY — 야후 원문의 시가·저가·고가를 날짜에 맞춤 · 어긋난 날은 종가 판단 (같은 날 두 줄이면 뒤 줄) */
  { const t0 = 1700000000, T = k => t0 + k * 86400, q = { open: [10, 12.2, 8.97, 15, 20, 21, 30, 5], high: [11, 12, 9.5, 16, 21, 22, 31, 16], low: [9, 11, 9, null, 19, 20, 29, 5], close: [10.5, 11.5, 9.2, 15.5, 20.5, 21.5, 31.5, 6] };
    const txt = JSON.stringify({ chart: { result: [{ meta: { gmtoffset: -14400 }, timestamp: [T(0), T(1), T(2), T(3), T(4), T(4) + 3600, T(5), T(6)], indicators: { quote: [q] } }] } });
    const D = window.MBT.parseY(txt), X = D && window.VBD.ohlY(txt, D), J = x => JSON.stringify(x);
    ok('VBD.ohlY: 시가·저가·고가 맞춤 · 어긋난 날 3일 = 종가 판단', D && X && D.d.length === 7 && J(X.o) === J([10, null, 9, null, 21, 30, null]) && J(X.l) === J([9, 11.5, 9, 15.5, 20, 29, 6]) && J(X.h) === J([11, 11.5, 9.5, 15.5, 22, 31.5, 6]) && X.bad === 3,
       X && J([D.d.length, X.o, X.l, X.h, X.bad]));
    /* VBD.trimLive — 장중에 받아 둔 원문을 마감 뒤 40분 안에 읽으면 그날 봉을 뺌 (마감 뒤 새 원문 · 40분 지남 · 장중은 그대로) */
    const tl = (rmt, now) => { const j = JSON.parse(txt), m = j.chart.result[0].meta; m.regularMarketTime = rmt; m.currentTradingPeriod = { regular: { start: T(6), end: T(6) + 23400 } };
      const D2 = window.MBT.parseY(j), X2 = window.VBD.ohlY(j, D2); D2.o = X2.o; D2.l = X2.l; D2.h = X2.h; const cut = window.VBD.trimLive(j, D2, now);
      return [cut, D2.d.length, D2.c.length, D2.o.length, D2.l.length, D2.h.length, D2.dv.length].join(','); };
    const E2 = T(6) + 23400;
    ok('VBD.trimLive: 장중 원문을 마감 뒤 40분 안에 읽으면 그날 봉을 뺌 · 그 밖엔 그대로', tl(E2 - 3600, E2 + 600) === 'true,6,6,6,6,6,6' && tl(E2, E2 + 600) === 'false,7,7,7,7,7,7' && tl(E2 - 3600, E2 + 3000) === 'false,7,7,7,7,7,7' && tl(E2 - 3600, E2 - 60) === 'false,7,7,7,7,7,7',
       [tl(E2 - 3600, E2 + 600), tl(E2, E2 + 600), tl(E2 - 3600, E2 + 3000), tl(E2 - 3600, E2 - 60)].join(' / '));
    const n0 = JSON.stringify({ chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [T(0), T(1)], indicators: { quote: [{ open: [1, 2], close: [1, 2] }] } }] } });
    ok('VBD.ohlY: 고가·저가가 없는 원문은 null (종가 판단)', window.VBD.ohlY(n0, window.MBT.parseY(n0)) === null);
    const cj = await window.mdLoad('etfcagr.json'), C = window.VBD.fromCagrD(cj.series.TQQQ), M = window.MBT.fromCagr(cj.series.TQQQ);
    ok('VBD.fromCagrD (Worker 를 못 쓸 때 TQQQ·SOXL): 시가 없음 · 날짜·종가 = MBT.fromCagr · 저가 ≤ 종가', C && C.o === null && C.src === 'c' && J(C.d) === J(M.d) && J(C.c) === J(M.c) && C.l.length === C.d.length && C.l.every((x, i) => x <= C.c[i]), C && [C.d.length, M.d.length].join(' '));
  }
  /* 화면 숫자 = 같은 자료·같은 조건으로 엔진을 직접 돌린 값 */
  const E = window.VRE, B = window.MBT, S = r.S, D = r.D, Dn = S.divs ? D : Object.assign({}, D, { dv: null });
  const F = await B.fxData().catch(() => null), fx = F ? B.fxFor(D.d, F) : null;
  const base = { from: r.net.from, to: r.net.to, capital: S.cap, norm: S.norm, rows: false };
  const n2 = E.summary(E.run(r.cfg, Dn, Object.assign({}, base, { fee: S.fee / 100, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: S.method, harvest: S.harvest } : null })), D, S.cap);
  const g2 = E.summary(E.run(r.cfg, Dn, Object.assign({}, base, { fee: 0, sec: 0, divTax: 0, tax: null })), D, S.cap);
  const same = (a, b) => ['final', 'cagr', 'irr', 'mdd', 'cash', 'fees', 'tax'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
  ok('화면 숫자 = 엔진 직접 계산 (포함·미포함)', same(r.sn, n2) && same(r.sg, g2) && fx, JSON.stringify([r.sn.cagr, n2.cagr, r.sg.cagr, g2.cagr]));
  { const kb = [...$$('#vb-res .mb-k b')].map(b => b.textContent || ''), wt = ($('#vb-res .mb-warns') || {}).innerText || '';
    ok('연평균 칸 = 계산값 (소수 둘째 자리 · 최종 자산 0 이하면 —)', r.sn.cagr == null ? kb[1] === '—' : kb[1].replace('−', '-').replace('+', '') === (r.sn.cagr * 100).toFixed(2) + '%', kb[1]);
    /* 최종 자산 0 이하(양도세 함정 — 실제 TQQQ 상장 전 1985~ 거치식 G 10 이 그럼) · 보유 0개로 멈춤은 알림 · 총수익률·MDD 는 '−100% 이하' */
    ok('최종 자산 0 이하·보유 0개 멈춤 표시', (r.sn.final > 0 || (kb[0] === '−100% 이하' && (!(r.net.taxExt > 0) || /원금을 다 잃고 세금 빚/.test(wt)))) && (r.net.idle == null || /보유가 0개라 VR 이 멈췄어요/.test(wt)) && (r.sn.mdd >= -1 || kb[2] === '−100% 이하'), JSON.stringify([r.sn.final, r.net.idle, kb.slice(0, 3)])); }
  const k0 = $('#vb-res .mb-kpi').innerText;
  $('#vb-res [data-view="gross"]').click(); await W(100);
  ok('보기 전환(미포함)', $('#vb-res .mb-kpi').innerText !== k0);
  $('#vb-res [data-tab="cycle"]').click(); await W(100);
  const nc = $$('#vb-tb tbody tr').length;
  $('#vb-res [data-tab="day"]').click(); await W(100);
  ok('사이클별(50줄씩)·일자별(50줄씩) 표', nc === Math.min(50, r.gross.cycles.length) && $$('#vb-tb tbody tr').length === Math.min(50, r.gross.rows.length), nc + ' / ' + r.gross.cycles.length);
  { /* 상장 뒤 사이클 하나를 골라 그 날들의 '시가 · 저가 ~ 고가' 칸 = 자료 × 가격 단위 (없는 날은 '없음 · 종가로 판단') */
    const L = r.pre ? r.pre.L : 0, cy = r.gross.cycles.find(c => c.from >= L + 20 && c.from > r.gross.from), sel = $('#vb-cyc');
    if (cy && sel) { sel.value = String(cy.no); sel.dispatchEvent(new Event('change', { bubbles: true })); await W(100); }
    const px = v => { const a = Math.abs(v); return (v < 0 ? '−$' : '$') + (a >= 1 ? a.toFixed(2) : a.toPrecision(3)); };
    const rs = cy ? r.gross.rows.filter(x => x.n === cy.no) : [], trs = [...$$('#vb-tb tbody tr')], D = r.D;
    const bad = trs.map((tr, k) => { const x = rs[k], t = tr.children[4].innerText.trim(); if (!x) return 'no row ' + k; const i = x.i;
      const want = D.o && D.o[i] != null ? px(D.o[i] * x.k) + ' · ' + px(D.l[i] * x.k) + ' ~ ' + px(D.h[i] * x.k) : '없음 · 종가로 판단'; return t === want ? null : D.d[i] + ' ' + t + ' ≠ ' + want; }).filter(Boolean);
    ok('일자별 표: 상장 뒤 사이클의 시가 · 저가 ~ 고가 칸 = 자료 (없는 날은 종가로 판단)', /시가 · 저가 ~ 고가/.test($('#vb-tb thead').innerText) && cy && trs.length === rs.length && trs.length > 0 && !bad.length, JSON.stringify([cy && cy.no, trs.length, rs.length, bad.slice(0, 2)])); }
  /* 유형 바꾸기 → 그 유형의 공식 시작값 · 적립식은 IRR */
  $('#vb-set [data-ty="acc"]').click(); await W(50);
  const pre = $('#vb-pre'); pre.checked = false; pre.dispatchEvent(new Event('change', { bubbles: true }));
  const S1 = VBTdebug.S();
  ok('적립식 고르면 공식 시작값 (G 10 · 한도 75% · 적립 $250)', S1.type === 'acc' && S1.G === 10 && S1.limit === 75 && S1.amt === 250, JSON.stringify([S1.type, S1.G, S1.limit, S1.amt]));
  $('#vb-set [data-act="run"]').click();
  for (let i = 0; i < 240 && !(res() && res().S.type === 'acc'); i++) await W(250);
  const r2 = res();
  ok('적립식 실행 · 주소 갱신 · 내 돈 기준 연수익(IRR) 칸', r2 && r2.S.type === 'acc' && /ty=acc/.test(location.hash) && /a=250/.test(location.hash) && r2.sn.flows && isFinite(r2.sn.irr) && /IRR/.test($$('#vb-res .mb-k span')[1].textContent), location.hash);
  ok('적립식: 넣은 돈 = 원금 + 적립 · 그냥 보유도 같은 돈', r2 && Math.abs(r2.sn.put - (r2.S.cap + r2.net.contrib)) < 1e-6 && r2.net.flows.length === r2.net.cycles.length - 1 && r2.sn.bh.irr != null, r2 && JSON.stringify([r2.sn.put, r2.net.contrib, r2.net.flows.length, r2.net.cycles.length]));
  ok('실행 기록 저장 (이 기기)', (JSON.parse(localStorage.getItem('vbt-history') || '[]')).length >= 2);
  ok('실제 자료 기본값: 30개 미만·인출 멈춤·밖에서 낸 세금 알림 없음 · Pool ≥ 0', r2 && !r2.net.coarse && r2.net.dead == null && !r2.net.taxExt && r2.net.pool.every(x => x > -0.005), r2 && JSON.stringify([r2.net.coarse, r2.net.dead, r2.net.taxExt]));
  return R;
}"""

CARD_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), $ = q => document.querySelector(q);
  const fill = (q, v) => { const e = $(q); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
  fill('[data-vi="setup.n"]', '100'); fill('[data-vi="setup.pool"]', '1000'); fill('[data-vi="setup.px"]', '50');
  $('[data-va="setup-ok"]').click(); await W(300);
  let r = null; for (let i = 0; i < 240; i++) { r = Object.values(VRdebug.bt.cache).filter(x => x.st === 'ok' || x.st === 'err')[0]; if (r) break; await W(250); }
  if (!r || r.st !== 'ok') return { err: r ? r.msg || 'err' : '카드 계산 안 끝남' };
  const a = $('#vr-bt a'); return { href: a && a.getAttribute('href'), n: r.net, g: r.gross, from: r.from, to: r.to, cap: r.cap, txt: $('#vr-bt').innerText };
}"""

ST = "() => [...document.querySelectorAll('#vb-set .mb-acc')].map(d => ({ k: d.dataset.sec, open: d.open, v: d.querySelector('.inc-sec-v').textContent, on: d.querySelector('.inc-sec-v').classList.contains('on') }))"


def _wait(page, ms=90000):
    page.wait_for_function('window.VBTdebug && VBTdebug.R() && VBTdebug.R().sn', timeout=ms)


def _open(page, base, h):
    page.goto('about:blank'); page.goto(base + 'vr-backtest/' + h, wait_until='load')   # 주소 #만 바뀌면 새로 열리지 않으므로 빈 화면을 거쳐 다시 엶


def check(page, base, local, fail, errs, ignorable, widths, OVERFLOW_JS):
    # 엔진 (node)
    if shutil.which('node'):
        r = subprocess.run(['node', os.path.join(ROOT, 'tests', 'vr_bt_test.js')], capture_output=True, text=True, timeout=900)
        print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else 'vr_bt_test: 출력 없음', flush=True)
        if r.returncode != 0:
            fail('vr-backtest', '엔진 검사 실패: ' + (' | '.join(l for l in r.stdout.splitlines() if l.startswith('FAIL')) or r.stderr.strip())[:400])
    print('[VR-BT] 밸류리밸런싱 VR 5.0 백테스트', flush=True)
    errs.clear()
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.goto(base + 'vr-backtest/', wait_until='load')
    page.evaluate("() => { ['vbt-open', 'vbt-settings', 'vbt-history'].forEach(k => localStorage.removeItem(k)); }")
    _open(page, base, '#ty=hold&t=TQQQ&c=10000&g=10&b=15&l=50&p=1')
    for t in page.evaluate(MAIN_JS, bool(local)):
        if not t['ok']:
            fail('vr-backtest', '%s%s' % (t['name'], (' — ' + t['info']) if t.get('info') else ''))
    # 주소만으로 같은 조건 (모든 칸) — 다시 열면 그대로 · 주소에도 그대로 남음
    for h, want in [('#ty=acc&t=SOXL&c=20000&g=12&b=10&l=60&a=300&p0=20&f=2015-01-02&e=2020-12-31&gs=1&th=100&m=simple&cy=td&nu=0&fe=0.1&tm=avg&hv=1&dv=0',
                     {'type': 'acc', 'tk': 'SOXL', 'cap': 20000, 'G': 12, 'band': 10, 'limit': 60, 'amt': 300, 'pool0': 20, 'from': '2015-01-02', 'to': '2020-12-31', 'gStep': 1, 'toHold': 100,
                      'mode': 'simple', 'cycle': 'td', 'norm': 'none', 'fee': 0.1, 'tax': True, 'method': 'avg', 'harvest': True, 'divs': False}),
                    ('#ty=wd&t=TQQQ&c=10000&g=20&b=15&l=25&a=40&fe=0.25&tx=0', {'type': 'wd', 'amt': 40, 'tax': False, 'mode': 'ladder', 'cycle': 'cal', 'norm': 'auto', 'toHold': 0})]:
        _open(page, base, h); _wait(page)
        got = page.evaluate("(() => ({ S: VBTdebug.R().S, cfg: VBTdebug.R().cfg, hash: location.hash }))()")
        bad = [k for k, v in want.items() if got['S'].get(k) != v]
        hs = got['hash'].lstrip('#').split('&')
        if bad or any(x not in hs for x in h.lstrip('#').split('&')):
            fail('vr-backtest', '주소 조건 복원/유지 실패 %s — %s · 주소 %s' % (h[:40], ', '.join('%s=%r' % (k, got['S'].get(k)) for k in bad), got['hash'][:200]))
        c = got['cfg']
        if h.startswith('#ty=acc') and not (c['band'] == 0.1 and c['limit'] == 0.6 and c['pool0'] == 0.2 and c['toHold'] == 100 and c['gStep'] == 1 and c['mode'] == 'simple' and c['cycle'] == 'td'):
            fail('vr-backtest', '계산 조건(cfg)이 화면 조건과 다름 %r' % c)
    # 알림: 인출로 V 가 0 이하 → 멈춤 · 원금이 작아 30개 미만
    for h, pat, k in [('#ty=wd&t=TQQQ&c=10000&g=20&b=15&l=25&a=2000&f=2021-06-01', 'VR 이 멈췄어요', 'dead'), ('#ty=hold&t=TQQQ&c=300&g=10&b=15&l=50&f=2020-01-02', '30개 미만', 'coarse')]:
        _open(page, base, h); _wait(page)
        w = page.evaluate("k => [(document.querySelector('#vb-res .mb-warns') || {}).innerText || '', VBTdebug.R().net[k]]", k)
        if pat not in w[0] or not w[1]:
            fail('vr-backtest', '알림 "%s" 이 없음 (%s) — %s' % (pat, h[:30], w[0][:120]))
    # 주소 해시가 이상해도 화면이 그려짐 (유형 이름이 Object 속성 · 잘못된 %) · G 0.1~·밴드 ~99% 는 기록 화면 설정 범위라 그대로 · 첫날 1개도 못 사면 알림
    for h, want in [('#ty=toString&t=TQQQ', None), ('#ty=constructor', None), ('#ty=hold&t=%E0&g=10', {'tk': 'TQQQ'}), ('#ty=hold&t=TQQQ&g=0.5&b=60', {'G': 0.5, 'band': 60})]:
        _open(page, base, h)
        try:
            page.wait_for_function("document.querySelectorAll('#vb-set .mb-acc').length === 7 && window.VBTdebug", timeout=30000)
            if want:
                _wait(page)
        except Exception as e:
            fail('vr-backtest', '이상한 주소 %s 에서 화면이 안 그려짐: %s' % (h, str(e)[:120])); continue
        if want:
            got = page.evaluate("() => VBTdebug.R().S")
            bad = [k for k, v in want.items() if got.get(k) != v]
            if bad:
                fail('vr-backtest', '주소 %s 조건이 다름: %s' % (h, ', '.join('%s=%r' % (k, got.get(k)) for k in bad)))
        st = page.evaluate("() => ({ ty: VBTdebug.S().type, sum: (document.getElementById('vb-sum-ty') || {}).textContent || '' })")
        if st['ty'] not in ('hold', 'acc', 'wd') or not st['sum']:
            fail('vr-backtest', '이상한 주소 %s 에서 설정 화면이 깨짐 %r' % (h, st))
    _open(page, base, '#ty=hold&t=TQQQ&c=100&p0=90')   # 1개 가격은 자동 단위라도 $10 이상 → $10 으로는 수수료 포함 0개
    try:
        page.wait_for_function("document.querySelector('#vb-res .mb-msg.bad') || (window.VBTdebug && VBTdebug.R())", timeout=60000)
    except Exception:
        pass
    m0 = page.evaluate("() => (document.querySelector('#vb-res .mb-msg.bad') || {}).innerText || ''")
    if '1개도 살 수 없어요' not in m0:
        fail('vr-backtest', '원금으로 첫날 1개도 못 살 때 알림이 없음: %r' % m0[:120])
    # 접이식 — 처음엔 1번만 펼침 · 요약 · 기본값은 회색 · 펼침 기억 · 입력 즉시 요약
    page.evaluate("() => { localStorage.removeItem('vbt-open'); localStorage.removeItem('vbt-settings'); }")
    _open(page, base, '')
    page.wait_for_function("document.querySelectorAll('#vb-set .mb-acc').length === 7", timeout=30000)
    a0 = page.evaluate(ST)
    if [x['k'] for x in a0] != ['ty', 'tk', 'per', 'rule', 'mode', 'tax', 'adv'] or [x['open'] for x in a0] != [True] + [False] * 6 or not all(x['v'] for x in a0) or any(x['on'] for x in a0):
        fail('vr-backtest', '설정 접이식 처음 상태가 다름 (1번만 펼침 · 요약 · 기본값은 회색) %r' % a0)
    ACC_DONE = "([k, o]) => { const d = document.querySelector('#vb-set .mb-acc[data-sec=\"' + k + '\"]'); return d && d.open === o && d._accTarget == null; }"   # 여닫는 모션이 끝날 때까지 (고정 대기는 느린 기계에서 간헐 실패)

    def acc_wait(k, o):
        try:
            page.wait_for_function(ACC_DONE, arg=[k, o], timeout=5000)
        except Exception:
            pass   # 아래 상태 검사가 실패로 알림
    page.click('#vb-set .mb-acc[data-sec="rule"] > summary'); acc_wait('rule', True)
    page.evaluate("() => document.querySelector('#vb-set [data-ty=\"wd\"]').click()"); page.wait_for_timeout(150)
    a1 = page.evaluate(ST)
    _open(page, base, '')
    page.wait_for_function("document.querySelectorAll('#vb-set .mb-acc').length === 7", timeout=30000)
    a2 = page.evaluate(ST)
    page.focus('#vb-set .mb-acc[data-sec="ty"] > summary'); page.keyboard.press('Enter'); acc_wait('ty', False)
    page.evaluate("""() => { const e = document.getElementById('vb-cap'); e.value = '25000'; e.dispatchEvent(new Event('input', { bubbles: true }));
                             const g = document.getElementById('vb-g'); g.value = '25'; g.dispatchEvent(new Event('input', { bubbles: true })); }""")
    a3 = {x['k']: x for x in page.evaluate(ST)}
    op = [True, False, False, True, False, False, False]
    if [x['open'] for x in a1] != op or [x['open'] for x in a2] != op or not a2[0]['v'].startswith('인출식') or a3['ty']['open'] \
            or '$25,000' not in a3['per']['v'] or not a3['per']['on'] or 'G 25' not in a3['rule']['v'] or not a3['rule']['on']:
        fail('vr-backtest', '설정 접이식 펼침 기억·입력 즉시 요약 실패 — 다시 그림 %r · 새로 엶 %r · 입력 뒤 %r' % ([x['open'] for x in a1], [x['open'] for x in a2], a3))
    _open(page, base, '#ty=acc&t=SOXL&c=20000&g=12&b=10&l=60&a=300&p0=20&f=2015-01-02&e=2020-12-31&gs=1&th=100&m=simple&cy=td&nu=0&fe=0.1&tm=avg&hv=1&dv=0'); _wait(page)
    a4 = {x['k']: x for x in page.evaluate(ST)}
    want = {'ty': ('적립식 · 매 사이클 적립', False), 'tk': ('SOXL · 반도체 3배', True), 'per': ('2015-01-02 ~ 2020-12-31 · $20,000 · 시작 현금 20%', True),
            'rule': ('G 12 · ±10% · 한도 60% · 적립 $300 · 해마다 G +1 · 적립금 × 100 에 거치식', True), 'mode': ('단순 모델(라오어 공개 백테스트) · 10거래일마다', True),
            'tax': ('수수료 0.1% · 양도세 22%(이동평균) · 연말 절세 · 분배금 끔', True), 'adv': ('가격 단위: 수정주가 그대로', True)}
    badw = ['%s %r' % (k, a4[k]) for k, (t, on) in want.items() if a4[k]['v'] != t or a4[k]['on'] != on]
    if badw:
        fail('vr-backtest', '주소로 연 조건의 접은 요약이 다름: ' + ' / '.join(badw))
    # 모두 펼친 채 유형마다 화면 폭 넘침 없음 (설정 칸은 스크롤 상자라 안쪽 폭도 따로 봄)
    page.evaluate("() => { localStorage.setItem('vbt-open', JSON.stringify({ ty: true, tk: true, per: true, rule: true, mode: true, tax: true, adv: true })); localStorage.removeItem('vbt-settings'); }")
    _open(page, base, '')
    page.wait_for_function("document.querySelectorAll('#vb-set .mb-acc[open]').length === 7", timeout=30000)
    for ty in ['acc', 'hold', 'wd']:
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.evaluate("t => document.querySelector('#vb-set [data-ty=\"' + t + '\"]').click()", ty); page.wait_for_timeout(120)
        if ty == 'acc':
            page.evaluate("() => { const e = document.getElementById('vb-th'); e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); }"); page.wait_for_timeout(120)
        for w in widths:
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(80)
            r = page.evaluate(OVERFLOW_JS)
            sw = page.evaluate("() => { const e = document.getElementById('vb-set'); return [e.scrollWidth, e.clientWidth]; }")
            if r['sw'] > r['vw'] + 1 or r['out'] or sw[0] > sw[1] + 1:
                fail('vr-backtest', '%s 설정 모두 펼침 %dpx 넘침 (문서 %dpx · 설정 칸 %d > %dpx)%s' % (ty, w, r['sw'], sw[0], sw[1], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
    # 결과까지 그린 화면도 좁은 폭에서 넘침 없음
    _open(page, base, '#ty=acc&t=TQQQ&c=10000&g=10&b=15&l=75&a=250&th=260'); _wait(page)
    for w in widths:
        page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(80)
        r = page.evaluate(OVERFLOW_JS)
        if r['sw'] > r['vw'] + 1 or r['out']:
            fail('vr-backtest', '결과 화면 %dpx 넘침 (문서 %dpx)%s' % (w, r['sw'], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.evaluate("() => { ['vbt-open', 'vbt-settings'].forEach(k => localStorage.removeItem(k)); }")
    for t in [t for t, u in errs if not ignorable(t, u)][:3]:
        fail('vr-backtest', '콘솔 오류: ' + t[:200])
    # 기록 화면 카드 = 시뮬레이터 (같은 조건이 주소로 넘어가는지)
    errs.clear()
    page.set_viewport_size({'width': 430, 'height': 900})
    page.goto(base + 'vr/', wait_until='load'); page.wait_for_timeout(800)
    page.evaluate("() => { localStorage.removeItem('vr5-store'); localStorage.removeItem('vr5-sync'); }")
    page.reload(wait_until='load'); page.wait_for_timeout(2000)
    card = page.evaluate(CARD_JS)
    if card.get('err') or not card.get('href'):
        fail('vr', "기록 화면 '이 설정으로 백테스트' 카드 계산 실패: %s" % card.get('err'))
    else:
        if 'c=6000' not in card['href'] or 'p0=16.7' not in card['href'] or 'ty=acc' not in card['href'] or 'a=250' not in card['href']:
            fail('vr', '자세히 보기 주소에 카드 조건이 빠짐: ' + card['href'][:200])
        page.goto('about:blank'); page.goto(base + card['href'], wait_until='load'); _wait(page)
        sim = page.evaluate("(() => { const R = VBTdebug.R(); return { n: R.sn, g: R.sg, from: R.D.d[R.net.from], to: R.D.d[R.net.to] }; })()")
        keys = ['final', 'irr', 'cagr', 'mdd', 'cash']
        diff = [k for k in keys if abs((sim['n'][k] or 0) - (card['n'][k] or 0)) > 1e-9 * max(1, abs(card['n'][k] or 0)) or abs((sim['g'][k] or 0) - (card['g'][k] or 0)) > 1e-9 * max(1, abs(card['g'][k] or 0))]
        if diff or sim['from'] != card['from'] or sim['to'] != card['to']:
            fail('vr', '기록 화면 카드와 시뮬레이터 숫자가 다름 %s — 카드 %s~%s · 시뮬레이터 %s~%s' % (diff, card['from'], card['to'], sim['from'], sim['to']))
    page.goto(base + 'vr/', wait_until='load'); page.wait_for_timeout(500)
    page.evaluate("() => { localStorage.removeItem('vr5-store'); localStorage.removeItem('vbt-history'); }")
    for t in [t for t, u in errs if not ignorable(t, u)][:3]:
        fail('vr', '카드 콘솔 오류: ' + t[:200])
    page.set_viewport_size({'width': 1440, 'height': 900})
