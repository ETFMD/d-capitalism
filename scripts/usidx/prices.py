#!/usr/bin/env python3
"""[USIDX] 야후 일별 종가(분할 반영)·분할 — 보유 종목 티커 확정(보유 내역의 평가액 ÷ 주식 수 와 맞는지)
· RAW/px/<야후 티커>.json.gz = {d:[날짜], c:[종가(분할 반영)], s:[[날짜, 비율]], at}
· 실제 그날 가격 = 종가 × 그 뒤 분할 비율의 곱 → 보유 내역 가격과 ±5% 안이 70% 넘고 중앙값 차이 3% 안이면 그 티커로 확정
· RAW/tick.json = {cusip: 야후 티커 또는 null}"""
import bisect, datetime as dt, os, re, sys, time, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D, fetch, jfetch, jload, jsave, rpath, log   # noqa: E402

START = '2011-01-01'
CLASS = {'BRKB': 'BRK-B', 'BRKA': 'BRK-A', 'BFB': 'BF-B', 'BFA': 'BF-A', 'LENB': 'LEN-B', 'HEIA': 'HEI-A', 'TAPA': 'TAP-A', 'MOGA': 'MOG-A', 'MOGB': 'MOG-B'}


def ysym(s):
    if not s:
        return None
    s = s.upper().replace('.', '-').replace('/', '-')
    return CLASS.get(s, s)


def chart(sym, start=START, force=False, max_age=None):
    """야후 일별 · 보관본이 max_age(초)보다 새것이면 그대로 · 오래됐으면 최근 45일만 받아 이어 붙임(겹치는 날 종가가 같고 새 분할이 없을 때 — 아니면 전체 다시)"""
    p = rpath('px', sym.replace('^', '_') + '.json.gz')
    o = jload(p)
    if o and not force and (max_age is None or time.time() - o.get('at', 0) < max_age):
        return o if o.get('d') else None
    if o and o.get('d') and not force and o['d'][0] <= start:
        n = _fetch(sym, (D(o['d'][-1]) - dt.timedelta(days=45)).isoformat())
        if n is not None and n.get('d'):
            i = bisect.bisect_left(o['d'], n['d'][0])
            same = all(abs(a / b - 1) < 0.005 for a, b in zip(o['c'][i:], n['c']) if a and b)
            news = [x for x in n['s'] if x not in o['s']]
            if same and not news and i < len(o['d']):
                o['d'], o['c'] = o['d'][:i] + n['d'], o['c'][:i] + n['c']
                o['at'], o['meta'] = time.time(), n.get('meta') or o.get('meta')
                jsave(p, o)
                return o
    elif o and not o.get('d') and not force and max_age is not None and time.time() - o.get('at', 0) < 7 * 86400:
        return None                                     # 상장폐지(빈 자료)는 1주일에 한 번만 다시 확인
    n = _fetch(sym, start)
    if n is None:          # 연결 오류·차단 — 빈 자료로 보관하지 않음(다음에 다시)
        return o if o and o.get('d') else None
    jsave(p, n)
    return n if n['d'] else None


def _fetch(sym, start):
    """야후 일별 종가·분할 → {d, c, s, at, meta} · 404 = 빈 자료 · 연결 오류 = None"""
    p1 = int(dt.datetime.combine(D(start), dt.time()).replace(tzinfo=dt.timezone.utc).timestamp())
    p2 = int(time.time()) + 86400
    j = None
    for host in ('query2', 'query1'):
        try:
            j = jfetch('https://%s.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&events=split&includePrePost=false' % (host, sym, p1, p2))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                j = {'chart': {'result': None}}
                break
        except Exception:
            continue
    if j is None:
        return None
    res = ((j or {}).get('chart') or {}).get('result') or []
    o = {'d': [], 'c': [], 's': [], 'at': time.time()}
    if res:
        r = res[0]
        tz = (r.get('meta') or {}).get('gmtoffset') or 0
        ts, q = r.get('timestamp') or [], ((r.get('indicators') or {}).get('quote') or [{}])[0]
        last = None
        for t, c in zip(ts, q.get('close') or []):
            if c is None:
                continue
            d = dt.datetime.fromtimestamp(t + tz, dt.timezone.utc).date().isoformat()
            if d == last:
                o['c'][-1] = c
                continue
            o['d'].append(d)
            o['c'].append(round(c, 4))
            last = d
        for s in sorted(((r.get('events') or {}).get('splits') or {}).values(), key=lambda x: x['date']):
            ratio = s['numerator'] / s['denominator'] if s.get('denominator') else None
            if ratio and ratio > 0:
                o['s'].append([dt.datetime.fromtimestamp(s['date'] + tz, dt.timezone.utc).date().isoformat(), ratio])
        o['meta'] = {k: (r.get('meta') or {}).get(k) for k in ('currency', 'exchangeName', 'instrumentType', 'regularMarketPrice', 'regularMarketTime', 'longName')}
    return o


def actual(o, d):
    """그날(없으면 그 전 마지막 거래일) 실제 가격 = 분할 반영 종가 × 그 뒤 분할 비율"""
    import bisect
    i = bisect.bisect_right(o['d'], d) - 1
    if i < 0 or (D(d) - D(o['d'][i])).days > 6:
        return None
    f = 1.0
    for sd, r in o['s']:
        if sd > o['d'][i]:
            f *= r
    return o['c'][i] * f


def check(o, pts):
    """pts: [(날짜, 보유 내역 가격)] → (맞음?, 중앙 차이)"""
    diffs = []
    for d, p in pts:
        a = actual(o, d)
        if a:
            diffs.append(abs(a / p - 1))
    if not diffs:
        return False, None
    diffs.sort()
    med = diffs[len(diffs) // 2]
    return (med < 0.03 and sum(1 for x in diffs if x < 0.05) >= 0.7 * len(diffs)), med


def resolve(holds, ids, extra=None, ncik=None, t2c=None):
    """extra: {cusip: [티커, …]} — 이름으로 찾은 회사(CIK)의 지금 티커(사명·티커가 바뀐 회사: CenturyLink → LUMN 등)
    ncik: {cusip: {이름으로 찾은 CIK}} · t2c: SEC 티커 → CIK — 티커의 회사가 이름으로 찾은 회사와 다르면 버림(가격이 우연히 맞은 다른 회사·ETF)"""
    pts = {}
    for etf, hl in holds.items():
        for h in hl:
            for r in h['rows']:
                if r.get('cusip') and r['sh'] > 0:
                    pts.setdefault(r['cusip'], []).append((h['date'], r['val'] / r['sh']))
    out, bad = {}, []
    for i, (c, v) in enumerate(sorted(ids.items())):
        cands = []
        for s in [v.get('cur'), v.get('sym')] + list((extra or {}).get(c, [])):
            if s and not re.search(r'(XXX|ZZZ)', s):
                for y in (ysym(s), (ysym(s)[:-1] + '-' + ysym(s)[-1]) if len(s) >= 4 and s[-1] in 'AB' else None):
                    if y and y not in cands:
                        cands.append(y)
        ok = None
        nc = (ncik or {}).get(c) or set()
        for y in cands:
            o = chart(y)
            if not o:
                continue
            good, med = check(o, pts.get(c, []))
            if good and len(pts.get(c, [])) == 1 and y not in (ysym(v.get('cur')), ysym(v.get('sym'))) and med > 0.01:
                good = False      # 이름으로만 찾은 티커가 한 번만 맞으면 우연일 수 있음 → 1% 안일 때만
            if good:
                ok = y
                break
        out[c] = ok
        if not ok:
            bad.append((c, v.get('name'), cands, round(sum(p for _, p in pts.get(c, [])) and max(p for _, p in pts.get(c, [])), 2)))
        if i % 100 == 0:
            log('티커 확인', i, len(ids))
    return out, bad


# ── 상장폐지 종목: SEC 결제 불이행(FTD) 자료의 실제 종가 + 보유 내역 가격 ──
def trade_days():
    o = chart('SPY')
    return o['d'], o['c']


def ftd_points(cusips):
    """{cusip: {거래일: 종가}} — FTD 가격은 결제일 전 거래일 종가"""
    import bisect, ids as I
    days, _ = trade_days()
    L = I.ftd_list()
    out = {c: {} for c in cusips}
    for per in L:
        if per < I.FTD_FROM:
            continue
        f = I.ftd(per, L[per])
        for c in cusips:
            e = f.get(c)
            if not e:
                continue
            for sd, p in e[2].items():
                i = bisect.bisect_left(days, sd) - 1
                if i >= 0 and p > 0:
                    out[c][days[i]] = p
    return out


SPLITK = (2, 3, 4, 5, 10, 8, 6, 7, 20)


def ftd_series(pts, snaps, days, M, maxgap=30):
    """pts {거래일: FTD 종가} + snaps [(날짜, 보유 내역 가격)] → chart 와 같은 꼴 {d, c(분할 반영), s, src:'ftd', est:[추정한 날 표시]}
    · 주식 분할: 이웃한 두 점(거래일 3일 이내)의 가격이 정확히 2·3·4·5·10배 등(±4%)으로 바뀌면 분할로 봄 → 그 앞 가격을 나눔
    · 튄 값 버림: 시장(SPY) 대비 가격이 앞뒤 7개 점의 중앙값과 30% 넘게 다르면 버림(FTD 가격 오기 · $0.01 등)
    · 알려진 가격 사이 빈 날(거래일 30일 이하)은 시장 움직임으로 잇고, 두 끝의 차이는 날짜에 비례해 나눔(로그)"""
    import bisect, math, statistics
    di = {d: i for i, d in enumerate(days)}
    P = dict(pts)
    for d, p in snaps:
        i = bisect.bisect_right(days, d) - 1
        if i >= 0 and days[i] not in P:
            P[days[i]] = p
    K = sorted((di[d], p) for d, p in P.items() if d in di and p > 0)
    if len(K) < 2:
        return None
    lm = [math.log(x) for x in M]
    splits = []
    for j in range(1, len(K)):
        (i0, p0), (i1, p1) = K[j - 1], K[j]
        d = math.log(p1 / p0)
        if abs(d) > 0.6 and i1 - i0 <= 3:
            for k in SPLITK:
                if abs(abs(d) - math.log(k)) < 0.04:
                    nxt = [math.log(p / p0) for _, p in K[j:j + 4]]    # 바뀐 값이 이어져야 함(한 점만 튄 것 아님)
                    if len(nxt) >= 2 and all(abs(x - d) < 0.15 for x in nxt[:3]):
                        splits.append((i1, k if d < 0 else 1 / k))
                    break
    rel = []
    for i, p in K:
        a = sum(math.log(k) for si, k in splits if si > i)       # 그 뒤 분할 → 마지막 기준
        rel.append((i, math.log(p) - a - lm[i]))
    keep = []
    for j in range(len(rel)):
        w = [x[1] for x in rel[max(0, j - 3):j + 4]]
        keep.append(len(w) < 3 or abs(rel[j][1] - statistics.median(w)) <= 0.3)
    rel = [x for x, k in zip(rel, keep) if k]
    if len(rel) < 2:
        return None
    adj = [0.0] * len(rel)
    out = {'d': [], 'c': [], 's': [[days[i], k] for i, k in splits], 'src': 'ftd', 'est': []}
    for j in range(len(rel)):
        i0, r0 = rel[j][0], rel[j][1] - adj[j]
        out['d'].append(days[i0]); out['c'].append(round(math.exp(r0 + lm[i0]), 4)); out['est'].append(0)
        if j + 1 < len(rel):
            i1, r1 = rel[j + 1][0], rel[j + 1][1] - adj[j + 1]
            if 1 < i1 - i0 <= maxgap:
                for i in range(i0 + 1, i1):
                    r = r0 + (r1 - r0) * (i - i0) / (i1 - i0)
                    out['d'].append(days[i]); out['c'].append(round(math.exp(r + lm[i]), 4)); out['est'].append(1)
    return out


def delisted(holds, tick):
    """야후 가격이 없는 CUSIP → RAW/pxf/<cusip>.json.gz"""
    snaps = {}
    for etf, hl in holds.items():
        for h in hl:
            for r in h['rows']:
                if r.get('cusip') and r['sh'] > 0 and not tick.get(r['cusip']):
                    snaps.setdefault(r['cusip'], []).append((h['date'], r['val'] / r['sh']))
    days, M = trade_days()
    pts = ftd_points(sorted(snaps))
    n = 0
    for c in sorted(snaps):
        o = ftd_series(pts[c], snaps[c], days, M)
        if o:
            jsave(rpath('pxf', c + '.json.gz'), o)
            n += 1
    return n, len(snaps)


if __name__ == '__main__' and '--ftd' in sys.argv:
    import holdings
    H = {e: holdings.all_holdings(e, refresh=False) for e in holdings.ETFS}
    print('FTD 가격', delisted(H, jload(rpath('tick.json'))))
    sys.exit(0)

if __name__ == '__main__':
    import holdings, cik
    H = {e: holdings.all_holdings(e, refresh=False) for e in holdings.ETFS}
    ids = jload(rpath('ids.json'))
    idx = cik.names_index()
    t2c, c2t = cik.ticker_maps()
    ncik = {c: set(cik.name_ciks(v['names'] + ([v['desc']] if v.get('desc') else []), idx)) for c, v in ids.items()}
    extra = {c: [t for k in sorted(ks) for t in c2t.get(k, [])] for c, ks in ncik.items()}
    tick, bad = resolve(H, ids, extra, ncik, t2c)
    jsave(rpath('tick.json'), tick)
    print('확정', sum(1 for v in tick.values() if v), '/', len(tick), '· 못 정함', len(bad))
    for b in bad[:60]:
        print('  ', b)
