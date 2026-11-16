#!/usr/bin/env python3
"""[USIDX] 나스닥 애널리스트 자료 — 최근 4개 분기 실제 조정 EPS(발표일 포함) · 다음 분기들·연도 예상 EPS(컨센서스)
· RAW/ns/<티커>.json = {at, sur: [[분기 끝 'YYYY-MM', 발표일, 실제 EPS, 예상 EPS]], fq: [['YYYY-MM', 예상, 최고, 최저, 애널리스트 수]], fy: [['YYYY-MM', 예상, 수]]}
· 조정 EPS(회사 발표 기준) — 회계(GAAP) EPS 와 다름 → calc.py 가 최근 4개 분기 '회계 ÷ 조정' 비율로 회계 기준으로 바꿔 씀
  python3 scripts/usidx/consensus.py AAPL MSFT"""
import datetime as dt, os, sys, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import jfetch, jload, jsave, rpath, log   # noqa: E402

HDR = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
MON = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}


def ym(s):
    try:
        m, y = s.split()
        return '%04d-%02d' % (int(y), MON[m[:3]])
    except Exception:
        return None


def _f(x):
    try:
        return float(str(x).replace('$', '').replace(',', ''))
    except (TypeError, ValueError):
        return None


def nsym(sym):
    return sym.replace('-', '.')


def clean(o):
    """예상 EPS 한 분기가 터무니없이 큰 경우(애널리스트 한 명의 오기로 평균이 튐 — 예: 2026년 11월 HBAN·BSX 한 분기 최고 예상 44·76달러)
    → 그 분기 평균이 다른 분기들 중앙값의 3배를 넘고 최고·최저 예상 차이가 4배를 넘으면 다른 분기 중앙값으로 바꿈(줄 끝에 'fix')"""
    if not o or not o.get('fq'):
        return o
    fq = o['fq']
    for i, r in enumerate(fq):
        oth = sorted(abs(x[1]) for j, x in enumerate(fq) if j != i and x[1] is not None)
        if len(oth) < 2:
            continue
        med = oth[len(oth) // 2]
        hi, lo = r[2], r[3]
        if abs(r[1]) > 3 * max(med, 0.05) and hi is not None and lo is not None and abs(hi) > 4 * max(abs(lo), 0.01):
            sgn = 1 if sum(x[1] for j, x in enumerate(fq) if j != i) >= 0 else -1
            fq[i] = [r[0], sgn * med, hi, lo, r[4], 'fix']
    return o


def get(sym, max_age=20 * 3600):
    p = rpath('ns', sym + '.json')
    o = jload(p)
    if o and time.time() - o.get('at', 0) < max_age:
        return clean(o)
    s = nsym(sym)
    try:
        a = (jfetch('https://api.nasdaq.com/api/company/%s/earnings-surprise' % s, 'web', headers=HDR, tries=3, timeout=25) or {}).get('data') or {}
        b = (jfetch('https://api.nasdaq.com/api/analyst/%s/earnings-forecast' % s, 'web', headers=HDR, tries=3, timeout=25) or {}).get('data') or {}
    except Exception as e:
        log('나스닥 실패', sym, e)
        return clean(o)     # 실패하면 지난 자료 그대로
    sur = []
    for r in ((a.get('earningsSurpriseTable') or {}).get('rows') or []):
        q, d, e = ym(r.get('fiscalQtrEnd') or ''), r.get('dateReported') or '', _f(r.get('eps'))
        try:
            mm, dd, yy = d.split('/')
            d = '%04d-%02d-%02d' % (int(yy), int(mm), int(dd))
        except ValueError:
            d = None
        if q and e is not None:
            sur.append([q, d, e, _f(r.get('consensusForecast'))])
    fq = [[ym(r.get('fiscalEnd') or ''), _f(r.get('consensusEPSForecast')), _f(r.get('highEPSForecast')), _f(r.get('lowEPSForecast')), _f(r.get('noOfEstimates'))]
          for r in (((b.get('quarterlyForecast') or {}).get('rows')) or [])]
    fy = [[ym(r.get('fiscalEnd') or ''), _f(r.get('consensusEPSForecast')), _f(r.get('noOfEstimates'))]
          for r in (((b.get('yearlyForecast') or {}).get('rows')) or [])]
    o = {'at': time.time(), 'sym': sym, 'sur': sorted(sur), 'fq': [x for x in fq if x[0] and x[1] is not None], 'fy': [x for x in fy if x[0] and x[1] is not None]}
    jsave(p, o)
    return clean(o)


def get_all(syms, max_age=20 * 3600, workers=4):
    out = {}
    with ThreadPoolExecutor(workers) as ex:
        for s, o in zip(syms, ex.map(lambda s: get(s, max_age), syms)):
            out[s] = o
    return out


if __name__ == '__main__':
    import json
    for s in sys.argv[1:]:
        print(json.dumps(get(s, 0), ensure_ascii=False))
