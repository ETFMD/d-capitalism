#!/usr/bin/env python3
"""[USIDX] 'NASDAQ 100과 S&P500 지수 분석' 자료 갱신 — data/usidx/ (GitHub Actions '나스닥 100·S&P 500 지수 분석 갱신')

순서 (원자료는 USIDX_RAW 폴더 = Actions 캐시 · 없으면 처음부터 모두 받음 — 첫 실행 1시간 안팎)
  1. 보유 내역  — QQQ·SPY 의 SEC 공시(연차·반기 보고서, N-PORT) · 새 공시만 받음                     scripts/usidx/holdings.py
  2. 종목 식별  — 새 보유 내역·새 결제 불이행(FTD) 자료가 있을 때만 CUSIP 맞추기·야후 티커 확인·
                  상장폐지 종목 가격(FTD)·발행사 CIK 다시                                          ids.py · prices.py · cik.py
  3. 재무       — SEC 일별 제출 목록(daily-index)에서 추적하는 회사의 새 10-Q·10-K·8-K(2.02) 등을 찾아
                  그 회사의 XBRL(companyfacts)·제출 목록만 다시 받고, SEC 자료에 빠진 보고서는 원문 XBRL 로 채움   fund.py
  4. 계산·쓰기  — 지금 바구니(SPY 운용사 보유 내역 · 나스닥 100 구성 종목), 나스닥 조정 EPS·컨센서스, 야후 종가로
                  일별 지수 PER·구성 종목 표·기업 상세·요약을 다시 계산해 바뀐 파일만 씀                build.py
  · 받아 온 자료가 이상하면(바구니 종목 수·비중 합·PER 범위) 멈추고 쓰지 않음 — tests/usidx_test.py 가 커밋 전에 다시 확인
  python3 scripts/update_usidx.py            # 평소
  python3 scripts/update_usidx.py --full     # 종목 식별·재무를 처음부터 다시(캐시 무시하지 않고 모든 단계 강제)"""
import datetime as dt, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'usidx'))
from common import D, fetch, jload, jsave, rpath, log   # noqa: E402
import holdings, ids, prices, cik as CK, fund, build   # noqa: E402

FORMS_WATCH = {'10-Q', '10-K', '10-Q/A', '10-K/A', '10-KT', '8-K', '20-F', '40-F', '6-K', 'S-1', 'S-1/A', '10-12B', '10-12B/A'}


def daily_index(since, until):
    """SEC 일별 제출 목록 → {cik: {양식}} (since 다음 날 ~ until)"""
    out = {}
    d = D(since) + dt.timedelta(days=1)
    while d <= D(until):
        if d.weekday() < 5:
            q = (d.month - 1) // 3 + 1
            url = 'https://www.sec.gov/Archives/edgar/daily-index/%d/QTR%d/master.%s.idx' % (d.year, q, d.strftime('%Y%m%d'))
            try:
                txt = fetch(url, 'sec', tries=2).decode('latin-1')
            except Exception as e:
                if getattr(e, 'code', None) not in (404, 403):
                    log('일별 제출 목록 실패', d, e)
                txt = ''
            for ln in txt.splitlines():
                f = ln.split('|')
                if len(f) == 5 and f[0].isdigit() and f[2] in FORMS_WATCH:
                    out.setdefault(int(f[0]), set()).add(f[2])
        d += dt.timedelta(days=1)
    return out


def main():
    full = '--full' in sys.argv
    t0 = time.time()
    st = jload(rpath('state.json'), {})
    cold = not st                                    # 캐시가 비었음(첫 실행) — 원문 XBRL 보충도 모든 회사
    today = dt.date.today().isoformat()

    # 1. 보유 내역
    H = {e: holdings.all_holdings(e, refresh=True) for e in holdings.ETFS}
    hk = {e: [h['date'] + ':' + h['acc'] for h in H[e]] for e in H}
    L = ids.ftd_list()
    fk = sorted(p for p in L if p >= ids.FTD_FROM)
    new_hold = full or hk != st.get('hold') or not os.path.exists(rpath('ids.json'))
    new_ftd = full or fk != st.get('ftd')
    log('보유 내역', {e: len(H[e]) for e in H}, '· 새 보유 내역' if new_hold else '', '· 새 FTD' if new_ftd else '')

    # 2. 종목 식별 (새 보유 내역·FTD 가 있을 때만)
    if new_hold or new_ftd:
        ids.ftd_all(L)
        im, miss = ids.build(H)
        jsave(rpath('ids.json'), im)
        for e in H:
            for h in H[e]:
                jsave(rpath('hold', e, h['date'] + '.json'), h)
        log('CUSIP', len(im), '· 못 맞춘 옛 줄', len(miss))
        idx = CK.names_index(refresh=full)
        t2c, c2t = CK.ticker_maps(refresh=True)
        old = jload(rpath('tick.json'), {})
        todo = {c: v for c, v in im.items() if full or c not in old}
        ncik = {c: set(CK.name_ciks(v['names'] + ([v['desc']] if v.get('desc') else []), idx)) for c, v in todo.items()}
        extra = {c: [t for k in sorted(ks) for t in c2t.get(k, [])] for c, ks in ncik.items()}
        tk, bad = prices.resolve(H, todo, extra, ncik, t2c)
        tick = {c: old.get(c) for c in im if c in old and not full}
        tick.update(tk)
        jsave(rpath('tick.json'), tick)
        log('야후 티커', sum(1 for v in tick.values() if v), '/', len(tick))
        log('상장폐지 종목 가격(FTD)', prices.delisted(H, tick))
        CK.build_map(H, im, tick)
    st['hold'], st['ftd'] = hk, fk

    # 3. 재무 — 새 공시가 있는 회사만 다시
    cm = jload(rpath('cikmap.json'))
    import current
    t2c, _ = CK.ticker_maps(refresh=not (new_hold or new_ftd))
    track = set(fund.all_ciks(cm))
    try:
        cur_ticks = {r['tick'] for r in current.spy_now()['rows']} | {x[0] for x in current.ndx_now()[1]}
        track |= {t2c[t] for t in cur_ticks if t in t2c}
    except Exception as e:
        log('지금 바구니 목록 실패(재무 대상은 보유 내역 기준만)', e)
    last = st.get('dindex') or (dt.date.today() - dt.timedelta(days=7)).isoformat()
    hit = daily_index(last, today)
    upd = sorted(c for c in track if c in hit)
    log('추적 회사', len(track), '· 새 공시', len(upd))
    for c in sorted(track):
        if c in hit or full:
            fund.facts(c, refresh=True)
            fund.subs(c, refresh=True)
        else:
            fund.facts(c)
            fund.subs(c)
    for c in upd:                  # companyfacts 를 새로 받으면 원문 보충분이 사라지므로(8-K 만 낸 날도) 다시 보충 — 빠진 보고서만 받음
        fund.patch(c)
    if full or cold:
        for c in sorted(track):
            fund.patch(c)
    st['dindex'] = today
    jsave(rpath('state.json'), st)

    # 4. 계산·쓰기
    out, summ, coinfo = build.run(today=today, write=False)
    sanity(out, summ)
    build.write_all(out, summ, coinfo)
    log('끝', round(time.time() - t0), '초')


def sanity(out, summ):
    """쓰기 전 확인 — 이상하면 멈춤(지난 자료 그대로)"""
    bad = []
    for k, n0 in (('ndx', 95), ('spx', 480)):
        s = summ[k]
        if s['syms'] < n0:
            bad.append('%s 종목 %d' % (k, s['syms']))
        for x in ('pe_ttm', 'pe_mix', 'pe_ntm'):
            if not (s.get(x) and 5 < s[x] < 120):
                bad.append('%s %s %s' % (k, x, s.get(x)))
        if not s.get('cov') or s['cov'] < 70:
            bad.append('%s 계산 비중 %s' % (k, s.get('cov')))
        rows = out[k + '_pe.json']['r']
        if len(rows) < 3000 or rows[0][0] > '2012-01-31':
            bad.append('%s 일별 PER %d줄 · 시작 %s' % (k, len(rows), rows[0][0]))
        w = sum(r[out[k + '_fin.json']['c']['c'].index('weight')] or 0 for r in out[k + '_fin.json']['c']['r'])
        if not 95 <= w <= 101:
            bad.append('%s 비중 합 %.1f' % (k, w))
    if bad:
        raise SystemExit('멈춤 — 자료 이상: ' + ' · '.join(bad))


if __name__ == '__main__':
    main()
