#!/usr/bin/env python3
"""[USIDX] data/usidx/*.json 자료 검사 — 갱신 워크플로(update-usidx.yml)가 커밋 전에 돌림 · 회귀 테스트에서도 돌림
· 요약 · 일별 PER · 구성 종목 표 · 기업 상세 파일의 꼴과 값의 범위, 서로 맞는지(요약 = 일별 PER 마지막 줄 · 표 종목 = 상세 파일)
  python3 tests/usidx_test.py"""
import datetime as dt, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIR = os.path.join(ROOT, 'data', 'usidx')
FAIL, N = [], [0]
FCOLS = ['sym', 'ko', 'name', 'seg', 'weight', 'cur', 'mcap_usd', 'px', 'pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap', 'pbr', 'roe', 'rev_ttm', 'rev_g',
         'opm', 'ni_ttm', 'debt', 'icr', 'dy', 'sr', 'last_q', 'since_q', 'since_a', 'nq', 'na', 'pxd', 'eps_d', 'pend', 'dup']
PCOLS = ['end', 'label', 'rev', 'rev_g', 'oi', 'opm', 'ni', 'ocf', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr', 'mcap', 'oi_est']


def ok(c, msg):
    N[0] += 1
    if not c:
        FAIL.append(msg)


def load(n):
    with open(os.path.join(DIR, n), encoding='utf-8') as f:
        return json.load(f)


def isdate(s):
    try:
        dt.date.fromisoformat(s)
        return True
    except Exception:
        return False


def main():
    sm = load('summary.json')
    ok(set(sm) >= {'updated', 'fx', 'ndx', 'spx'}, 'summary 키')
    fx = sm.get('fx') or {}
    ok(fx.get('rate') and 800 < fx['rate'] < 3000, 'summary 환율 %s' % fx.get('rate'))
    for e, etf, n0, n1, cov0 in (('ndx', 'qqq', 95, 110, 75), ('spx', 'spy', 480, 520, 90)):
        s = sm[e]
        for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
            ok(s.get(k) and 5 < s[k] < 120, '%s %s %s' % (e, k, s.get(k)))
            ok(s.get(k + '_p') is not None and 0 <= s[k + '_p'] <= 100, '%s %s_p' % (e, k))
            ok(s.get(k + '_lo') and s.get(k + '_hi') and s[k + '_lo'] <= s[k] <= s[k + '_hi'], '%s %s 범위 안' % (e, k))
        ok(s.get('cov') and s['cov'] >= cov0, '%s 계산 비중 %s' % (e, s.get('cov')))
        ok(n0 <= s.get('syms', 0) <= n1, '%s 종목 수 %s' % (e, s.get('syms')))
        ok(s.get('mcap') and s['mcap'] > 1e13, '%s 시가총액 %s' % (e, s.get('mcap')))
        lv = s.get('live') or {}
        pos = lv.get('pos') or []
        ok(len(pos) >= n0 * 0.7 and abs(sum(p[1] for p in pos) - 1) < 0.01, '%s live.pos %d 비중 합 %.4f' % (e, len(pos), sum(p[1] for p in pos)))
        ok(all(p[0] and p[2] and p[2] > 0 for p in pos), '%s live.pos 티커·가격')
        ok(isdate(lv.get('d') or '') and lv.get('d') == s['date'], '%s live.d = 요약 날짜' % e)
        adj = s.get('adj') or {}
        ok(adj.get('pe_ntm') and 5 < adj['pe_ntm'] < 80 and adj.get('pe_ntm_cov', 0) > 80, '%s 조정 EPS 선행 PER %s' % (e, adj))
        # 일별 PER
        pe = load(e + '_pe.json')
        ok(pe.get('c') == ['date', etf, 'pe_ttm', 'pe_mix', 'pe_ntm', 'cov', 'est', 'hold'], '%s_pe 칸' % e)
        r = pe['r']
        ok(len(r) >= 3500 and r[0][0] <= '2012-01-31', '%s_pe 줄 %d · 시작 %s' % (e, len(r), r[0][0]))
        ok(all(r[i][0] < r[i + 1][0] for i in range(len(r) - 1)), '%s_pe 날짜 순서' % e)
        ok(r[-1][0] == s['date'] and r[-1][2] == s['pe_ttm'] and r[-1][4] == s['pe_ntm'] and r[-1][1] == s['px'], '%s 요약 = 일별 마지막 줄' % e)
        bad = [x for x in r if any(v is not None and not (0 < v < 300) for v in x[2:5])]
        ok(len(bad) < len(r) * 0.002, '%s_pe 범위 밖 PER %d줄 %s' % (e, len(bad), bad[:3]))
        bad = [x for x in r if not (x[5] is not None and 50 <= x[5] <= 100.0001)]
        ok(not bad, '%s_pe 계산 비중 50~100%% 밖 %d줄 %s' % (e, len(bad), bad[:2]))
        bad = [x for x in r if x[6] is None or not (0 <= x[6] <= 100.0001) or not isdate(x[7]) or (x[7] > x[0] and (dt.date.fromisoformat(x[7]) - dt.date.fromisoformat(x[0])).days > 100)]   # 같은 정기 조정 구간의 보유 내역은 그 구간 앞날에도 씀(최대 약 3개월)
        ok(not bad, '%s_pe est·보유 기준일 %s' % (e, bad[:2]))
        jumps = [(r[i][0], r[i - 1][4], r[i][4]) for i in range(1, len(r)) if r[i][4] and r[i - 1][4] and abs(r[i][4] / r[i - 1][4] - 1) > 0.25]
        ok(len(jumps) <= 3, '%s_pe 하루 25%% 넘는 선행 PER 변화 %d번 %s' % (e, len(jumps), jumps[:4]))
        # 구성 종목 표
        fin = load(e + '_fin.json')
        ok(fin['c']['c'] == FCOLS, '%s_fin 칸' % e)
        rows = [dict(zip(FCOLS, x)) for x in fin['c']['r']]
        ok(n0 <= len(rows) <= n1, '%s_fin 종목 수 %d' % (e, len(rows)))
        ok(len({x['sym'] for x in rows}) == len(rows), '%s_fin 티커 중복' % e)
        w = sum(x['weight'] or 0 for x in rows)
        ok(99 <= w <= 101, '%s_fin 비중 합 %.2f' % (e, w))
        ok(all(x['seg'] for x in rows), '%s_fin 업종 없음 %s' % (e, [x['sym'] for x in rows if not x['seg']][:5]))
        ok(sum(1 for x in rows if x['px'] and x['px'] > 0) >= len(rows) - 2, '%s_fin 가격 없는 종목 %s' % (e, [x['sym'] for x in rows if not x['px']]))
        ok(sum(1 for x in rows if x['mcap_usd'] and x['mcap_usd'] > 1e9) >= len(rows) - 3, '%s_fin 시가총액 없음 %s' % (e, [x['sym'] for x in rows if not x['mcap_usd']]))
        ok(sum(1 for x in rows if x['pe_ntm']) >= len(rows) * 0.9, '%s_fin 선행 PER 있는 종목 %d' % (e, sum(1 for x in rows if x['pe_ntm'])))
        ok(sum(1 for x in rows if x['ko']) >= len(rows) * 0.97, '%s_fin 한국어 이름 없는 종목 %s' % (e, [x['sym'] for x in rows if not x['ko']][:10]))
        for x in rows:
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap'):
                if x[k] is not None and not (0 < x[k] < 5000):
                    FAIL.append('%s %s %s %s' % (e, x['sym'], k, x[k]))
            if x['since_q']:
                p = os.path.join(DIR, 'co', x['sym'] + '.json')
                ok(os.path.exists(p), '%s 상세 파일 없음 %s' % (e, x['sym']))
        for x in sorted(rows, key=lambda x: -(x['weight'] or 0))[:60]:    # 기업 상세 마지막 분기 시가총액이 지금 시가총액과 같은 크기(주식 수 단위 오류·한 클래스만 — 2026-11 맥도날드 2억 달러 같은 것)
            p = os.path.join(DIR, 'co', x['sym'] + '.json')
            if x['cur'] != 'USD' or not x['mcap_usd'] or not os.path.exists(p):
                continue
            q = [dict(zip(PCOLS, r)) for r in load('co/' + x['sym'] + '.json')['q']['r']]
            m = [r for r in q if r['mcap']]
            ok(m and 0.4 <= m[-1]['mcap'] / x['mcap_usd'] <= 2.5, '%s %s 상세 마지막 시가총액 %s vs 지금 %s' % (e, x['sym'], m[-1]['mcap'] if m else None, x['mcap_usd']))
        top = sorted(rows, key=lambda x: -(x['weight'] or 0))[:10]
        ok(all(x['last_q'] and x['last_q'] >= (dt.date.fromisoformat(s['date']) - dt.timedelta(days=200)).isoformat() for x in top if x['sym'] not in ('ASML', 'PDD', 'SPCX')),
           '%s 비중 상위 10종목 최근 분기 %s' % (e, [(x['sym'], x['last_q']) for x in top]))
    # 기업 상세
    cof = sorted(os.listdir(os.path.join(DIR, 'co')))
    ok(len(cof) >= 500, '상세 파일 %d개' % len(cof))
    for n in cof:
        d = load('co/' + n)
        ok(d.get('sym') + '.json' == n and d['q']['c'] == PCOLS and d['a']['c'] == PCOLS, '상세 꼴 %s' % n)
        for blk, gap in (('q', 10), ('a', 60)):
            ends = [x[0] for x in d[blk]['r']]
            ok(ends == sorted(ends) and len(set(ends)) == len(ends), '상세 %s %s 기간 순서' % (n, blk))
            close = [(a, b) for a, b in zip(ends, ends[1:]) if (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days < gap]
            ok(not close, '상세 %s %s 끝 날짜가 %d일 안에 붙은 기간(같은 분기 중복·10-Q 의 최근 12개월 값) %s' % (n, blk, gap, close[:2]))
    a = load('co/AAPL.json')
    q = {x[0]: dict(zip(PCOLS, x)) for x in a['q']['r']}
    ok(len(q) >= 60 and min(q) <= '2010-12-31', 'AAPL 분기 %d개 시작 %s' % (len(q), min(q)))
    last = q[max(q)]
    ok(last['rev'] and last['rev'] > 5e10 and last['ni'] and last['ni'] > 1e10 and last['mcap'] and last['mcap'] > 1e12, 'AAPL 마지막 분기 값 %s' % last)
    print('usidx_test: 검사 %d개 · 실패 %d개' % (N[0], len(FAIL)))
    for f in FAIL[:40]:
        print('  FAIL', f)
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
