"""72매매법 회귀 검사 — run_regression.py 가 부름 (check)

  · /72/ 백테스트: 기본값(수수료 0.75% 등) · 화면 숫자 = 같은 자료로 엔진(MHV.run)을 직접 돌린 값(포함·미포함) ·
    같은 조건을 무한매수법 백테스트 화면 주소로 연 숫자와 같음(고정 7가지 = V1.0 72분할 52.5% 큰수 13% 괴리 0% 소진 recover 1주) ·
    시작한 해별 표 = 엔진 · 보기·표 전환 · 기간 빠른 단추 · 세부옵션(접이식·양도세 미포함이면 하위 옵션 꺼짐·일부분 복리·수수료 직접 입력)
  · /72/ 기록: 화면에서 시작 → 시세대로 채운 날마다 평가금 = 같은 날 시작한 백테스트(양도세 빼고) · RSI 대기 · 주문표 = 엔진 ·
    체결 고치기(빼기·직접 추가·되돌리기) · 중간 진입 · 백업 내려받기/불러오기 · 새로고침 뒤 유지 · 휴장일 계산 · 지금 시세 RSI
  · 폭 넘침(설정 모두 펼침 · 기록 · 백테스트) · 콘솔 오류
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = "['t72-set', 't72-log', 't72-tab', 't72-open']"

BT_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const $ = q => document.querySelector(q), $$ = q => document.querySelectorAll(q), T = window.T72debug, V = window.MHV, B = window.MBT;
  for (let i = 0; i < 240 && !(T && T.R() && T.R().sn); i++) await W(250);
  const r = T.R(); if (!r) return [{ name: '백테스트 결과 없음 (60초)', ok: false, info: ($('#t7-btres') || {}).innerText }];
  const S = r.S, c = r.cfg;
  ok('기본값: 원금 $10,000 · 복리 · 다음 날 · 수수료 0.75% · 양도세 선입선출 · 절세 안함 · 분배금 재투자 · 새로 시작 · 기간 처음부터',
     S.cap === 10000 && S.money === 'compound' && S.restart === 'next' && r.fee === 0.75 && S.tax && S.method === 'fifo' && !S.harvest && S.divs && S.entry === 'new' && !S.from && !S.to, JSON.stringify([S, r.fee]));
  ok('고정 7가지 (계산 조건): V1.0 · 72분할 · 52.5% · 큰수 13% · 평단 괴리 0% · 소진 recover · 1주 단위 · SOXL',
     c.ver === '1.0' && c.splits === 72 && c.target === 52.5 && c.big === 13 && c.avgOff === 0 && c.exhaust === 'recover' && !c.ideal && c.lines === 0 && c.ticker === 'SOXL', JSON.stringify(c));
  ok('기본 탭 = 백테스트 (기록이 없을 때)', $('#t7-tabs [data-tab="bt"]').classList.contains('on'));
  /* 화면 숫자 = 엔진 직접 */
  const D = r.D, F = await B.fxData().catch(() => null), fx = F ? B.fxFor(D.d, F) : null;
  const base = { from: r.net.from, to: r.net.to, capital: S.cap, norm: 'auto', rows: true };
  const Rn = V.run(c, D, Object.assign({}, base, { fee: 0.0075, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: 'fifo', harvest: false } : null }));
  const Rg = V.run(c, D, Object.assign({}, base, { fee: 0, sec: 0, divTax: 0, tax: null }));
  const n2 = B.stats(Rn, D, S.cap), g2 = B.stats(Rg, D, S.cap), same = (a, b) => ['final', 'cagr', 'mdd', 'fees', 'tax', 'maxCost'].every(k => Math.abs((a[k] || 0) - (b[k] || 0)) <= 1e-9 * Math.max(1, Math.abs(a[k] || 0)));
  ok('화면 숫자 = 엔진 직접 계산 (세금·수수료 포함·미포함)', fx && same(r.sn, n2) && same(r.sg, g2) && r.net.taxes.length > 0, JSON.stringify([r.sn.cagr, n2.cagr, r.sg.cagr, g2.cagr]));
  const kb = [...$$('#t7-btres .mb-k b')].map(b => b.textContent);
  ok('핵심 6칸 · 연평균 칸 = 계산값', kb.length === 6 && kb[1].replace('−', '-').replace('+', '') === (r.sn.cagr * 100).toFixed(2) + '%', kb.join(' | '));
  /* 시작한 해별 = 엔진 (한 해 골라 직접) */
  const rr = r.roll, mid = rr[Math.floor(rr.length / 2)], f = D.d.indexOf(mid.d);
  const X = V.run(c, D, { from: f, to: r.net.to, capital: S.cap, norm: 'auto', rows: false, fee: 0.0075, sec: 0.0000206, divTax: 0.15, tax: fx ? { fx: i => fx[i], method: 'fifo', harvest: false } : null });
  const cg = B.cagr(S.cap, X.final, B.dnum(D.d[r.net.to]) - B.dnum(D.d[f - 1]));
  ok('시작한 해별 표: 2011년부터 해마다 한 줄 · 고른 해 = 엔진', rr.length >= 10 && rr[0].y === 2011 && rr.every((x, k) => !k || x.y === rr[k - 1].y + 1) && Math.abs(cg - mid.cagr) < 1e-12 && $$('.t7-roll tbody tr').length === rr.length, JSON.stringify([rr.length, mid.y, cg, mid.cagr]));
  /* 보기·표 전환 */
  const k0 = $('#t7-btres .mb-kpi').innerText;
  $('#t7-btres [data-view="gross"]').click(); await W(80);
  ok('보기 전환 (미포함)', $('#t7-btres .mb-kpi').innerText !== k0 && /분배금/.test($('#t7-btres .mb-kpi').innerText));
  $('#t7-btres [data-btab="cycle"]').click(); await W(80);
  ok('사이클별 표 = 사이클 수', $$('#t7-tb tbody tr').length === r.gross.cycles.length, $$('#t7-tb tbody tr').length + ' / ' + r.gross.cycles.length);
  $('#t7-btres [data-view="net"]').click(); $('#t7-btres [data-btab="year"]').click(); await W(80);
  ok('연도별 표', $$('#t7-tb tbody tr').length >= 15, $$('#t7-tb tbody tr').length);
  ok('그래프 (Chart.js)', typeof Chart === 'undefined' || !!Chart.getChart(document.getElementById('t7-cb')));
  /* 기간 빠른 단추 → 다시 계산 */
  $('.t7-per [data-qf="2020-01-01"]').click();
  for (let i = 0; i < 80 && !(T.R() && T.R().S.from === '2020-01-01'); i++) await W(100);
  ok('기간 빠른 단추 2020~ → 2020년 첫 거래일부터', T.R() && T.R().D.d[T.R().net.from] >= '2020-01-01' && T.R().D.d[T.R().net.from - 1] < '2020-01-01', T.R() && T.R().D.d[T.R().net.from]);
  $('.t7-per [data-qf=""]').click();
  for (let i = 0; i < 80 && !(T.R() && T.R().S.from === ''); i++) await W(100);
  /* 세부옵션 */
  const acc = $('#t7-set .mb-acc');
  ok('세부옵션: 접이식 · 처음엔 접힘 · 요약 회색', acc && !acc.open && /수수료 0\\.75%/.test($('#t7-sum').textContent) && !$('#t7-sum').classList.contains('on'), $('#t7-sum').textContent);
  $('#t7-set [data-k="tax"][data-v="0"]').click(); await W(60);
  ok('양도세 미포함 → 취득가액·연말 절세 단추 꺼짐 · 요약 파랑', [...$$('#t7-set [data-k="method"], #t7-set [data-k="harvest"]')].every(b => b.disabled) && $('#t7-sum').classList.contains('on'));
  for (let i = 0; i < 80 && !(T.R() && !T.R().S.tax); i++) await W(100);
  ok('양도세 미포함 → 백테스트 양도세 0', T.R() && !T.R().taxOn && T.R().sn.tax === 0);
  $('#t7-set [data-k="tax"][data-v="1"]').click(); await W(60);
  ok('양도세 포함 → 하위 옵션 켜짐', [...$$('#t7-set [data-k="method"], #t7-set [data-k="harvest"]')].every(b => !b.disabled));
  $('#t7-set [data-k="money"][data-v="part"]').click(); await W(60);
  const mx = $('#t7-mix'); ok('일부분 복리 → 비율 칸 (기본 50%)', mx && +mx.value === 50);
  mx.value = '30'; mx.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 80 && !(T.R() && T.R().cfg.money === 'part' && T.R().cfg.mix === 0.3); i++) await W(100);
  const rp = T.R(); ok('일부분 복리 30% → 계산 조건 money part · mix 0.3 · 결과가 복리와 다름', rp && rp.cfg.money === 'part' && rp.cfg.mix === 0.3 && Math.abs(rp.sn.final - r.sn.final) > 1, rp && JSON.stringify([rp.cfg.money, rp.cfg.mix, rp.sn.final]));
  $('#t7-set [data-k="money"][data-v="compound"]').click(); await W(60);
  $('#t7-set [data-k="feeMode"][data-v="custom"]').click(); await W(60);
  const fc = $('#t7-feec'); fc.value = '0.07'; fc.dispatchEvent(new Event('input', { bubbles: true }));
  $('#t7-set [data-k="restart"][data-v="rsi"]').click(); await W(60); $('#t7-set [data-k="harvest"][data-v="1"]').click(); await W(60);
  for (let i = 0; i < 80 && !(T.R() && T.R().fee === 0.07 && T.R().cfg.restart === 'rsi' && T.R().S.harvest); i++) await W(100);
  const rf = T.R(); return { R, sim: { cagr: rf.sn.cagr, mdd: rf.sn.mdd, final: rf.sn.final, gc: rf.sg.cagr, fee: rf.fee, restart: rf.cfg.restart, hv: rf.S.harvest, from: rf.D.d[rf.net.from], to: rf.D.d[rf.net.to] } };
}"""

LOG_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const $ = q => document.querySelector(q), $$ = q => document.querySelectorAll(q), T = window.T72debug, V = window.MHV, B = window.MBT;
  for (let i = 0; i < 240 && !(T && T.M.D); i++) await W(250);
  if (!T || !T.M.D) return [{ name: '기록: 일봉 없음', ok: false }];
  $('#t7-tabs [data-tab="log"]').click(); await W(80);
  ok('기록 탭: 시작 카드 · 시작일 기본 = 다음 거래일', $('#t7-start') && $('#t7-start').value > T.M.D.d[T.M.D.d.length - 1], $('#t7-start') && $('#t7-start').value);
  const st = $('#t7-start'); st.value = '2025-03-03'; $('[data-act="jstart"]').click();
  for (let i = 0; i < 80 && !(T.JR() && T.JR().days.length); i++) await W(100);
  const JR = T.JR(), D = T.M.D, S = T.S(), cfg = T.cfg();
  ok('화면에서 기록 시작 (2025-03-03) → 날마다 기록', JR && JR.days.length > 100 && JR.days[0].d === '2025-03-03' && T.J().start === '2025-03-03', JR && JR.days.length);
  /* 시세대로 = 같은 날 시작한 백테스트(양도세 빼고) */
  const run = () => V.run(cfg, D, { from: T.JR().i0, capital: S.cap, norm: 'auto', rows: true, fee: S.feeMode === 'custom' ? S.feeC / 100 : 0.0075, sec: 0.0000206, divTax: 0.15, tax: null });
  const eqOk = () => { const J2 = T.JR(), X = run(); return J2.days.length === X.eq.length && J2.days.every((x, k) => Math.abs(x.eq - X.eq[k]) < 1e-6) && J2.cycles.length === X.cycles.length; };
  ok('시세대로 채운 기록 = 같은 날 시작한 백테스트 (날마다 평가금 · 사이클 수 · RSI 대기 ' + JR.days.filter(x => x.wait).length + '일)', eqOk() && JR.days.some(x => x.wait), JR.cycles.length);
  /* 다음 주문표 = 엔진 (마지막 상태 + 마지막 종가) */
  const N = JR.next, L = D.d.length - 1, s2 = JSON.parse(JSON.stringify(JR.st));
  if (s2.qty === 0) V.begin(cfg, s2);
  const P = N.wait ? { rows: [] } : V.plan(cfg, s2, { prev: D.c[L] }), rows = P.rows.map(x => [x.side, x.m, x.p, x.q, x.tag].join(':')).join(' ');
  ok('다음 거래일 주문표 = 엔진 · 날짜 = 다음 거래일 · 화면 줄 수', N.prev === D.c[L] && N.date > D.d[L] && rows === N.P.rows.map(x => [x.side, x.m, x.p, x.q, x.tag].join(':')).join(' ') && $$('#t7-ord .mh-obox').length === N.P.rows.length, rows);
  ok('상태 · 그래프 · 날짜별 표 (20줄씩)', $('#t7-stat') && (typeof Chart === 'undefined' || !!Chart.getChart(document.getElementById('t7-cj'))) && $$('#t7-days tbody tr').length === Math.min(20, JR.days.length));
  /* 체결 고치기: 첫 매수일을 '체결 없음'으로 → 그날 매수 0 · 뒤가 다시 계산 · 되돌리면 그대로 */
  const d1 = JR.days.find(x => x.ev.buyQ > 0).d, pg = () => $$('#t7-days .mb-pg button')[1];
  for (let k = 0; k < 40 && !$('#t7-days [data-d="' + d1 + '"]') && pg() && !pg().disabled; k++) { pg().click(); await W(30); }
  $('#t7-days [data-d="' + d1 + '"]').click(); await W(60);
  ok('수정 창 열림 · 주문표 줄마다 체크', $('#t7-sheet .mh-sheet') && $$('#t7-sheet [data-eon]').length >= 1, $$('#t7-sheet [data-eon]').length);
  $$('#t7-sheet [data-eon]').forEach(b => { b.checked = false; });
  $('#t7-sheet [data-act="ed-save"]').click(); await W(120);
  const x1 = T.JR().days.find(x => x.d === d1);
  ok('고친 날: 체결 없음 → 그날 매수 0 · ✎ 표시 · 저장', !$('#t7-sheet .mh-sheet') && x1.ov && x1.ev.buyQ === 0 && JSON.stringify(T.J().ov[d1]) === '[]' && JSON.parse(localStorage.getItem('t72-log')).ov[d1].length === 0, JSON.stringify(T.J().ov));
  ok('고친 날 뒤가 다시 계산 (시세대로와 달라짐)', !eqOk());
  /* 직접 추가: 다음 날 주문표에 없던 매수 */
  const d2 = T.JR().days.find(x => x.d > d1).d;
  for (let k = 0; k < 40 && !$('#t7-days [data-d="' + d2 + '"]') && pg() && !pg().disabled; k++) { pg().click(); await W(30); }
  $('#t7-days [data-d="' + d2 + '"]').click(); await W(60);
  $$('#t7-sheet [data-eon]').forEach(b => { b.checked = false; });
  $('#t7-sheet [data-act="ed-add"]').click(); await W(60);
  const ks = $$('#t7-sheet [data-eq]'), kk = ks.length - 1;
  ks[kk].value = '3'; $('#t7-sheet [data-ep="' + kk + '"]').value = '20'; $('#t7-sheet [data-act="ed-save"]').click(); await W(120);
  const x2 = T.JR().days.find(x => x.d === d2);
  ok('직접 추가 매수 3주 × $20 → 그날 매수 · 평단 $20 · 회차', x2.ev.buyQ === 3 && Math.abs(x2.avg - 20) < 1e-9 && x2.qty === 3 && x2.T > 0, JSON.stringify([x2.ev.buyQ, x2.avg, x2.qty, x2.T]));
  /* 팔 수 있는 것보다 많이 팔기 → 막음 */
  for (let k = 0; k < 40 && !$('#t7-days [data-d="' + d2 + '"]') && pg() && !pg().disabled; k++) { pg().click(); await W(30); }
  $('#t7-days [data-d="' + d2 + '"]').click(); await W(60);
  $('#t7-sheet [data-act="ed-add"]').click(); await W(60);
  const ks2 = $$('#t7-sheet [data-eq]'), k2 = ks2.length - 1; $('#t7-sheet [data-eside="' + k2 + '"]').value = 'S'; ks2[k2].value = '999'; $('#t7-sheet [data-act="ed-save"]').click(); await W(80);
  ok('아침 보유보다 많이 팔기 → 저장 안 됨 · 안내', $('#t7-sheet .mh-sheet') && /팔 수 없어요/.test($('#t7-ed-msg').textContent), $('#t7-ed-msg') && $('#t7-ed-msg').textContent);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await W(60);
  ok('Esc → 수정 창 닫힘', !$('#t7-sheet .mh-sheet'));
  /* 되돌리기 */
  for (const d of [d2, d1]) {
    for (let k = 0; k < 40 && !$('#t7-days [data-d="' + d + '"]') && pg() && !pg().disabled; k++) { pg().click(); await W(30); }
    $('#t7-days [data-d="' + d + '"]').click(); await W(60); $('#t7-sheet [data-act="ed-auto"]').click(); await W(120);
  }
  ok('시세대로 되돌리기 → 다시 백테스트와 같음', !Object.keys(T.J().ov).length && eqOk());
  return R;
}"""

MID_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const $ = q => document.querySelector(q), T = window.T72debug, V = window.MHV;
  for (let i = 0; i < 240 && !(T && T.JR()); i++) await W(250);
  const JR = T.JR(); if (!JR) return [{ name: '중간 진입: 기록 없음', ok: false, info: ($('#t7-pane') || {}).innerText }];
  const x0 = JR.days[0], D = T.M.D, cfg = T.cfg();
  ok('중간 진입: 평단 $40 · 30주 · 10회 · 남은 현금 비움(원금 − 평단×수량) → 시작 상태', JR.mid && JR.mid.avg === 40 && JR.mid.qty === 30 && JR.mid.T === 10 && JR.mid.cash === 20000 - 1200 && JR.base === 20000, JSON.stringify(JR.mid));
  /* 첫날 주문표 = 그 상태로 엔진 */
  const s = V.init(cfg, 20000); V.begin(cfg, s); Object.assign(s, { qty: 30, avg: 40, cash: 18800, T: 10, mode: 'normal' });
  const P = V.plan(cfg, s, { prev: D.c[x0.i - 1] });
  ok('중간 진입 첫날 주문 = 엔진 (평단·큰수 LOC + 목표 지정가)', JSON.stringify(P.rows.map(r => [r.side, r.p, r.q, r.tag])) === JSON.stringify(x0.P.rows.map(r => [r.side, r.p, r.q, r.tag])) && x0.P.rows.some(r => r.tag === 'tp' && r.q === 30), JSON.stringify(x0.P.rows.map(r => [r.side, r.p, r.q, r.tag])));
  ok('중간 진입 회차 이어 감 (첫날 10회 이상)', x0.T >= 10, x0.T);
  /* 잘못 넣으면 안내 */
  const q = $('#t7-mqty'); q.value = '1.5'; q.dispatchEvent(new Event('input', { bubbles: true })); await W(500);
  ok('보유 수량 1.5 → 안내 · 기록 대신 알림', /정수/.test(($('#t7-midh') || {}).textContent || '') && /중간 진입 값을 확인/.test($('#t7-pane').innerText), ($('#t7-midh') || {}).textContent);
  q.value = '30'; q.dispatchEvent(new Event('input', { bubbles: true })); await W(500);
  ok('바로잡으면 다시 기록', T.JR() && T.JR().mid && T.JR().mid.qty === 30);
  return R;
}"""

MISC_JS = """async () => {
  const W = ms => new Promise(r => setTimeout(r, ms)), R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info: info == null ? '' : String(info).slice(0, 300) });
  const $ = q => document.querySelector(q), T = window.T72debug, V = window.MHV;
  for (let i = 0; i < 240 && !(T && T.M.D); i++) await W(250);
  const D = T.M.D, L = D.d.length - 1, live = $('#t7-live').innerText, r1 = V.rsiW(D.c, L);
  ok('지금 시세: 최근 종가 · RSI(14) = 엔진 와일더 RSI', live.includes('$' + D.c[L].toFixed(2)) && live.includes(r1.toFixed(1)), live.slice(0, 160));
  /* 휴장일: 다음 거래일 계산 (추수감사절·성금요일·토요일 독립기념일 → 7/3·성탄 전날·2027 준틴스 대체) · 실제 일봉 날짜는 휴장일이 아님 · 일봉이 없는 평일 = 휴장일(임시 휴장 4일 빼고) */
  const nb = T.nextBiz, cases = [['2026-11-25', '2026-11-27'], ['2026-04-02', '2026-04-06'], ['2026-07-02', '2026-07-06'], ['2026-12-24', '2026-12-28'], ['2027-06-17', '2027-06-21'], ['2026-10-09', '2026-10-12'], ['2026-12-31', '2027-01-04']];
  const badN = cases.filter(c => nb(c[0]) !== c[1]).map(c => c[0] + '→' + nb(c[0]));
  const have = new Set(D.d), badH = D.d.filter(x => T.isHoliday(x)), miss = [];
  for (let t = new Date(D.d[0] + 'T12:00:00Z'); t.toISOString().slice(0, 10) <= D.d[L]; t.setUTCDate(t.getUTCDate() + 1)) { const ds = t.toISOString().slice(0, 10), w = t.getUTCDay(); if (w && w < 6 && !have.has(ds) && !T.isHoliday(ds)) miss.push(ds); }
  const SPECIAL = ['2012-10-29', '2012-10-30', '2018-12-05', '2025-01-09'];   /* 허리케인 샌디 · 부시·카터 전 대통령 장례 (임시 휴장) */
  ok('휴장일 계산: 다음 거래일 7가지 · 일봉 날짜에 휴장일 없음 · 일봉 없는 평일 = 휴장일(임시 휴장 빼고)', !badN.length && !badH.length && miss.every(x => SPECIAL.includes(x)), JSON.stringify([badN, badH, miss.filter(x => !SPECIAL.includes(x))]));
  return R;
}"""


def _wait_bt(page, ms=90000):
    page.wait_for_function('window.T72debug && T72debug.R() && T72debug.R().sn', timeout=ms)


def _fresh(page, base, setup=None):
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')
    page.evaluate("() => { %s.forEach(k => localStorage.removeItem(k)); }" % KEYS)
    if setup:
        page.evaluate(setup)
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load')


def check(page, base, local, fail, errs, ignorable, widths, OVERFLOW_JS):
    print('[T72] 72매매법', flush=True)
    errs.clear()
    page.set_viewport_size({'width': 1280, 'height': 900})

    n = [0, 0]

    def report(where, ts):
        for t in ts:
            n[0] += 1
            if not t['ok']:
                n[1] += 1
                fail(where, '%s%s' % (t['name'], (' — ' + t['info']) if t.get('info') else ''))
    # 백테스트 (기본값 · 엔진 · 표 · 세부옵션) — 마지막엔 찾은 설정(수수료 0.07% · RSI · 연말 절세)으로 바꿔 둠
    _fresh(page, base); _wait_bt(page)
    out = page.evaluate(BT_JS)
    report('72', out['R'] if isinstance(out, dict) else out)
    sim = out.get('sim') if isinstance(out, dict) else None
    # 같은 조건을 무한매수법 백테스트 화면 주소로 → 숫자가 같아야 함 (같은 엔진·같은 자료 · 고정 7가지가 V1.0 설정 그대로인지)
    if sim:
        page.goto('about:blank'); page.goto(base + 'muhan-backtest/#v=1.0&t=SOXL&c=10000&sp=72&tg=52.5&bg=13&fe=0.07&x=recover&r=rsi&hv=1', wait_until='load')
        try:
            page.wait_for_function('window.MBTdebug && MBTdebug.R() && MBTdebug.R().sn', timeout=90000)
            m = page.evaluate("(() => { const R = MBTdebug.R(); return { cagr: R.sn.cagr, mdd: R.sn.mdd, final: R.sn.final, gc: R.sg.cagr, from: R.D.d[R.net.from], to: R.D.d[R.net.to] }; })()")
            bad = [k for k in ('cagr', 'mdd', 'final', 'gc') if abs(m[k] - sim[k]) > 1e-9 * max(1, abs(m[k]))]
            if bad or m['from'] != sim['from'] or m['to'] != sim['to']:
                fail('72', '같은 조건 무한매수법 백테스트 화면과 숫자가 다름 %s — 72 %s · 시뮬레이터 %s' % (bad, json.dumps(sim), json.dumps(m)))
            else:
                print('  72 = 시뮬레이터 (수수료 0.07%% · RSI · 연말 절세): CAGR %.2f%% · MDD %.2f%%' % (sim['cagr'] * 100, sim['mdd'] * 100), flush=True)
        except Exception as e:
            fail('72', '무한매수법 백테스트 화면 비교 실패: %s' % str(e)[:150])
    # 설정이 이 기기에 남음 (새로 열어도 그대로)
    page.goto('about:blank'); page.goto(base + '72/', wait_until='load'); _wait_bt(page)
    s = page.evaluate("() => T72debug.S()")
    if not (s['feeMode'] == 'custom' and s['feeC'] == 0.07 and s['restart'] == 'rsi' and s['harvest']):
        fail('72', '설정이 새로 연 뒤 남지 않음 %r' % s)
    # 기록 (원금 $20,000 · RSI 새 사이클 · 수수료 기본 0.75%)
    _fresh(page, base, "() => localStorage.setItem('t72-set', JSON.stringify({ cap: 20000, restart: 'rsi' }))")
    page.wait_for_function('window.T72debug && T72debug.M.D', timeout=90000)
    report('72 기록', page.evaluate(LOG_JS))
    # 새로고침 뒤 기록 유지 · 기록 탭으로 열림
    page.reload(wait_until='load')
    try:
        page.wait_for_function('window.T72debug && T72debug.JR() && T72debug.JR().days.length > 100', timeout=60000)
        if not page.evaluate("() => document.querySelector('#t7-tabs [data-tab=\"log\"]').classList.contains('on') && T72debug.J().start === '2025-03-03'"):
            fail('72 기록', '새로고침 뒤 기록 탭·시작일이 남지 않음')
    except Exception as e:
        fail('72 기록', '새로고침 뒤 기록이 없음: %s' % str(e)[:120])
    # 백업 내려받기 → 지우기 → 불러오기
    try:
        with page.expect_download(timeout=15000) as dl:
            page.click('[data-act="exp"]')
        path = dl.value.path()
        bk = json.load(open(path, encoding='utf-8'))
        if bk.get('app') != '72매매법' or bk['log']['start'] != '2025-03-03' or bk['set']['cap'] != 20000:
            fail('72 기록', '백업 파일 내용이 다름 %r' % {k: bk.get(k) for k in ('app', 'v')})
        page.once('dialog', lambda d: d.accept())
        page.click('[data-act="jdel"]'); page.wait_for_timeout(200)
        if page.evaluate("() => !!T72debug.J() || !!localStorage.getItem('t72-log') || !document.getElementById('t7-start')"):
            fail('72 기록', '기록 지우기 뒤에도 기록이 남음')
        page.set_input_files('#t7-imp', path); page.wait_for_timeout(500)
        if not page.evaluate("() => T72debug.J() && T72debug.J().start === '2025-03-03' && T72debug.JR() && T72debug.JR().days.length > 100"):
            fail('72 기록', '백업 불러오기 실패')
        bad_path = os.path.join(os.path.dirname(path), 'bad.json')
        open(bad_path, 'w', encoding='utf-8').write('{"app":"x"}')
        msgs = []
        page.once('dialog', lambda d: (msgs.append(d.message), d.accept()))
        page.set_input_files('#t7-imp', bad_path); page.wait_for_timeout(400)
        if not msgs or '백업 파일이 아니에요' not in msgs[0] or not page.evaluate("() => T72debug.J() && T72debug.J().start === '2025-03-03'"):
            fail('72 기록', '잘못된 백업 파일 안내·기존 기록 보존 실패 %r' % msgs)
    except Exception as e:
        fail('72 기록', '백업 내려받기/불러오기 검사 오류: %s' % str(e)[:160])
    # 중간 진입
    _fresh(page, base, "() => { localStorage.setItem('t72-set', JSON.stringify({ cap: 20000, entry: 'mid', mAvg: '40', mQty: '30', mT: '10', mCash: '' })); localStorage.setItem('t72-log', JSON.stringify({ start: '2025-03-03', ov: {} })); localStorage.setItem('t72-open', 'true'); }")
    report('72 중간 진입', page.evaluate(MID_JS))
    report('72 시세', page.evaluate(MISC_JS))
    # 폭 넘침 — 세부옵션 모두 펼친 기록 화면 · 백테스트 화면
    for tab in ('log', 'bt'):
        page.evaluate("t => document.querySelector('#t7-tabs [data-tab=\"' + t + '\"]').click()", tab)
        if tab == 'bt':
            try:
                _wait_bt(page, 60000)
            except Exception:
                fail('72', '중간 진입 상태에서 백테스트 탭 결과 없음')
        page.wait_for_timeout(200)
        for w in widths:
            page.set_viewport_size({'width': w, 'height': 900}); page.wait_for_timeout(100)
            r = page.evaluate(OVERFLOW_JS)
            if r['sw'] > r['vw'] + 1 or r['out']:
                fail('72', '%s 화면 %dpx 넘침 (문서 %dpx)%s' % ('기록' if tab == 'log' else '백테스트', w, r['sw'], (' · ' + ', '.join(r['out'])) if r['out'] else ''))
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.evaluate("() => { %s.forEach(k => localStorage.removeItem(k)); }" % KEYS)
    for t in [t for t, u in errs if not ignorable(t, u)][:3]:
        fail('72', '콘솔 오류: ' + t[:200])
    print('  72매매법 화면 검사 %d개 · 실패 %d' % (n[0], n[1]), flush=True)
    page.set_viewport_size({'width': 1440, 'height': 900})
