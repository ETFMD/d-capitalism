#!/usr/bin/env python3
"""[USIDX] 증권(CUSIP) → 발행 회사(SEC CIK)
· 이름: SEC 전체 회사 이름 목록(cik-lookup-data.txt — 예전 이름 포함)에서 보유 내역·FTD 종목명과 핵심 낱말이 같은 CIK
· 티커: SEC 지금 티커 목록(company_tickers.json)의 그 티커 CIK
· 고르기(pick): 이름으로 찾은 CIK 중 보유 기간 무렵 분기 EPS 공시가 있는 것(그 시절 발행사) → 없으면 티커 CIK
  그 시절 발행사가 공시를 멈춘 뒤(지주회사 전환·합병으로 CIK 가 바뀜)는 티커 CIK 의 공시로 이어 붙임(calc.py)
· RAW/ciknames.json.gz = {핵심 낱말: [cik, …]}"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import fetch, jload, jsave, rpath, log   # noqa: E402
from ids import ntoks   # noqa: E402


def nkey(s):
    """낱말 순서와 무관한 이름 열쇠 ('DU PONT E I DE NEMOURS' = 'E.I. du Pont de Nemours')"""
    return ' '.join(sorted(ntoks(s)[0]))

LOOKUP = 'https://www.sec.gov/Archives/edgar/cik-lookup-data.txt'


def names_index(refresh=False):
    p = rpath('ciknames.json.gz')
    o = jload(p)
    if o and not refresh:
        return o
    raw = rpath('cik-lookup-data.txt')
    if refresh or not os.path.exists(raw):
        with open(raw, 'wb') as f:
            f.write(fetch(LOOKUP, 'sec', timeout=600))
    o = {}
    with open(raw, encoding='latin-1') as f:
        for ln in f:
            ln = ln.rstrip('\n')
            if not ln.endswith(':'):
                continue
            nm, _, rest = ln[:-1].rpartition(':')
            try:
                c = int(rest)
            except ValueError:
                continue
            k = nkey(nm)
            if k:
                lst = o.setdefault(k, [])
                if c not in lst:
                    lst.append(c)
    jsave(p, o)
    return o


def ticker_maps(refresh=False):
    p = rpath('company_tickers.json')
    j = jload(p)
    if not j or refresh:
        from common import jfetch
        j = jfetch('https://www.sec.gov/files/company_tickers.json', 'sec')
        jsave(p, j)
    t2c, c2t = {}, {}
    for v in j.values():
        t = v['ticker'].upper().replace('.', '-')
        t2c[t] = int(v['cik_str'])
        c2t.setdefault(int(v['cik_str']), []).append(t)
    return t2c, c2t


def name_ciks(names, idx):
    out = []
    for n in names:
        for c in idx.get(nkey(n), []):
            if c not in out:
                out.append(c)
    return out


_FR = {}


def frame_ciks(y, q):
    """그 분기(달력 기준)에 순이익(NetIncomeLoss·ProfitLoss)을 XBRL 로 낸 CIK 집합 — RAW/frames/<y>Q<q>.json"""
    if (y, q) in _FR:
        return _FR[(y, q)]
    p = rpath('frames', '%dQ%d.json' % (y, q))
    o = jload(p)
    if o is None:
        from common import jfetch
        s = set()
        for tag in ('NetIncomeLoss', 'ProfitLoss'):
            try:
                j = jfetch('https://data.sec.gov/api/xbrl/frames/us-gaap/%s/USD/CY%dQ%d.json' % (tag, y, q), 'sec')
                s |= {d['cik'] for d in j.get('data', [])}
            except Exception as e:
                if getattr(e, 'code', None) != 404:
                    raise
        o = sorted(s)
        import datetime as dt
        if dt.date(y, q * 3, 1) < dt.date.today().replace(day=1) - dt.timedelta(days=200):   # 끝난 지 오래된 분기만 보관(최근 분기는 아직 공시가 들어오는 중)
            jsave(p, o)
    _FR[(y, q)] = set(o)
    return _FR[(y, q)]


def filed_near(c, dates):
    """그 CIK 가 보유 날짜 앞뒤 200일 안에 낸 10-Q·10-K·20-F·40-F 수 (회계연도가 달력과 달라 frames 에 안 잡히는 회사용)"""
    import fund
    try:
        r = fund.subs(c)['r']
    except Exception:
        return 0
    from common import D
    fd = [D(x[1]) for x in r if x[0] in ('10-Q', '10-K', '20-F', '40-F', '10-KT')]
    return sum(1 for d in dates if any(abs((f - D(d)).days) <= 200 for f in fd))


def pick(dates, cands, prefer):
    """보유 날짜들 무렵(그 분기·앞 분기) 순이익 공시가 가장 많이 있는 후보 CIK · 같으면 prefer(티커 CIK)
    · 아무도 frames 에 없으면(회계연도가 달력과 어긋남·달러 외 통화) 보유 날짜 앞뒤로 정기 보고서를 낸 후보 · 그래도 없으면 prefer"""
    best = pick1(dates, cands, prefer, lambda c, d: _inframe(c, d))
    if best is None and cands:
        sc = [(filed_near(c, dates), c == prefer, c) for c in cands]
        sc = [x for x in sc if x[0] > 0]
        if sc:
            return max(sc)[2]
    return best if best is not None else prefer


def _inframe(c, d):
    y, m = int(d[:4]), int(d[5:7])
    q = (m - 1) // 3 + 1
    py, pq = (y, q - 1) if q > 1 else (y - 1, 4)
    return c in frame_ciks(y, q) or c in frame_ciks(py, pq)


def pick1(dates, cands, prefer, has):
    best = None
    for c in cands:
        n = sum(1 for d in dates if has(c, d))
        k = (n, c == prefer)
        if n and (best is None or k > best[0]):
            best = (k, c)
    return best[1] if best else None


def build_map(holds, ids, tick):
    """{cusip: {cik: 그 시절 발행사, cur: 지금 티커의 CIK, cands}} — RAW/cikmap.json"""
    idx = names_index()
    t2c, _ = ticker_maps()
    dates = {}
    for e in holds:
        for h in holds[e]:
            for r in h['rows']:
                if r.get('cusip'):
                    dates.setdefault(r['cusip'], set()).add(h['date'])
    res = {}
    for c, v in ids.items():
        t = tick.get(c)
        pref = t2c.get(t) if t else None
        cands = name_ciks(v['names'] + ([v['desc']] if v.get('desc') else []), idx)
        if pref and pref not in cands:
            cands.append(pref)
        res[c] = {'cik': pick(sorted(dates.get(c, [])), cands, pref), 'cur': pref, 'cands': cands}
    jsave(rpath('cikmap.json'), res)
    return res
