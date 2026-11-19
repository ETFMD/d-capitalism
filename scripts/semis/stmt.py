#!/usr/bin/env python3
"""[SEMIS] 구성 종목 분기·연간 재무 표 줄 — 실적 발표 뒤 바로 (표준 라이브러리만)

출처(기준 자료 base 와 같은 정의 — 2026-11-19 확인: 기존 줄을 다시 만들면 같은 값)
  · 미국 공시 회사(10-Q·10-K XBRL): scripts/usidx 의 fund·fin (SEC companyfacts · 빠진 보고서는 원문 XBRL) → fin.derive 와 같은 칸
  · 그 전(실적 발표 ~ 정식 공시): 8-K 2.02 보도자료(EX-99) 의 손익·재무상태·현금흐름 표(press.py) → '발표' 줄(supp) — 정식 공시가 나오면 그 값으로 바뀜
  · 해외 회사(20-F·6-K — TSM·ASML·UMC·ASX·STM·TSEM·ARM·SKHY 등 분기 XBRL 없음): 야후 fundamentals-timeseries(현지 통화) — 기준 자료와 같은 출처

  python3 scripts/semis/stmt.py NVDA AMAT TSM      # 확인용 — 만든 줄을 출력(쓰지 않음)"""
import datetime as dt, json, os, re, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
os.environ.setdefault('USIDX_RAW', os.environ.get('SEMIS_RAW') or os.path.join(os.path.expanduser('~'), '.cache', 'semis'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'usidx'))
sys.path.insert(0, HERE)
import fund, fin, prices          # noqa: E402  (USIDX — 원자료 보관 폴더 = SEMIS_RAW)
from common import fetch, jload, jsave, rpath   # noqa: E402
import press                      # noqa: E402

PC = ['end', 'label', 'rev', 'rev_g', 'oi', 'opm', 'ni', 'ocf', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr', 'mcap', 'oi_est']
YT = {'rev': 'TotalRevenue', 'oi': 'OperatingIncome', 'ni': 'NetIncomeCommonStockholders', 'ocf': 'OperatingCashFlow', 'intexp': 'InterestExpense',
      'liab': 'TotalLiabilitiesNetMinorityInterest', 'eq': 'StockholdersEquity', 'div': 'CashDividendsPaid', 'buy': 'RepurchaseOfCapitalStock', 'sh': 'DilutedAverageShares'}


def log(*a):
    print(*a, flush=True, file=sys.stderr)


def D(s):
    return dt.date.fromisoformat(s)


def label(e, annual, fye=None):
    return ('FY' + e[:4]) if annual else e[:4] + '.' + e[5:7]


def round_row(o):
    out = {}
    for k in PC:
        v = o.get(k)
        if isinstance(v, float):
            v = round(v, 2) if k in ('rev_g', 'opm', 'icr', 'debt', 'roe', 'per', 'pbr', 'sr') else round(v, 3) if k == 'dy' else round(v, 0) if k == 'mcap' else v
        out[k] = v
    return out


# ── 미국 공시 회사 ──
def subs(cik, max_age=3 * 3600):
    o = jload(rpath('sub', '%d.json.gz' % cik))
    if o and o.get('v') == 2 and time.time() - o.get('at', 0) < max_age:
        return o
    return fund.subs(cik, refresh=True)


def is_xbrl(sub):
    """최근 400일 안에 10-Q·10-K 를 낸 회사 = 분기 XBRL 이 있는 미국 공시 회사"""
    lim = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    return any(x[0] in ('10-Q', '10-K') and x[1] >= lim for x in sub.get('r') or [])


def facts_fresh(cik, sub):
    """마지막으로 받은 뒤 10-Q·10-K(정정 포함)가 새로 나왔으면 companyfacts 를 다시 받고 빠진 값은 원문 XBRL 로"""
    o = jload(rpath('cf', '%d.json.gz' % cik))
    last = max((x[1] for x in sub.get('r') or [] if x[0] in ('10-Q', '10-K', '10-Q/A', '10-K/A')), default='')
    at = dt.datetime.fromtimestamp(o['at'], dt.timezone.utc).date().isoformat() if o and o.get('at') else ''
    if not o or o.get('v') != 3 or last >= at:
        fund.facts(cik, refresh=True)
        try:
            fund.patch(cik, since=(dt.date.today() - dt.timedelta(days=500)).isoformat())
        except Exception as e:
            log('  원문 XBRL 보충 실패', cik, e)


def pxf_of(sym):
    p = prices.chart(sym, max_age=6 * 3600)
    return (lambda d: prices.actual(p, d)) if p else (lambda d: None)


def exhibits(cik, acc):
    """8-K 첨부 중 EX-99.x HTML 본문들"""
    a = acc.replace('-', '')
    idx = fetch('https://www.sec.gov/Archives/edgar/data/%d/%s/%s-index.htm' % (cik, a, acc), 'sec').decode('utf-8', 'replace')
    docs = []
    for m in re.finditer(r'<tr[^>]*>(.*?)</tr>', idx, re.S | re.I):
        row = m.group(1)
        t = re.search(r'>\s*(EX-99[.\d]*)\s*<', row)
        h = re.search(r'href="([^"]+\.html?)"', row, re.I)
        if t and h:
            u = h.group(1)
            u = u if u.startswith('http') else 'https://www.sec.gov' + u
            if '/ix?doc=' in u:
                u = 'https://www.sec.gov' + u.split('/ix?doc=')[1]
            docs.append((t.group(1), u))
    out = []
    for t, u in sorted(docs):
        try:
            out.append(fetch(u, 'sec', timeout=60).decode('utf-8', 'replace'))
        except Exception as e:
            log('  보도자료 받기 실패', u, e)
    return out


def press_rec(cik, sub, Q, A, after):
    """정식 공시 전 실적 발표(8-K 2.02 · after 보다 뒤) → (분기 끝, 분기 기록, 연간 기록|None, 이유)"""
    # 마지막 정식 공시(10-Q·10-K) 제출일보다 뒤에 낸 실적 발표만 — 그 전 발표는 이미 정식 공시 값이 있음
    filed = max([x[1] for x in sub.get('r') or [] if x[0] in ('10-Q', '10-K', '10-Q/A', '10-K/A')] or [after])
    ks = [x for x in sub.get('r') or [] if x[0] == '8-K' and '2.02' in str(x[3]).split(',') and x[1] > max(after, filed)]
    if not ks:
        return None, None, None, None
    x = ks[-1]
    p = jload(rpath('press', '%s.json' % x[4]))
    if not p or p.get('v') != press.VERSION:
        docs = exhibits(cik, x[4])
        p = press.parse(docs) if docs else {'why': ['보도자료 없음']}
        p['acc'], p['filed'], p['v'] = x[4], x[1], press.VERSION
        jsave(rpath('press', '%s.json' % x[4]), p)
    ends = sorted(Q)
    prev_e = ends[-1] if ends else None
    bad = list(p.get('why') or []) + press.check(p, prev_e, Q[prev_e].get('rev') if prev_e else None)
    if p.get('end') and p['end'] > x[1]:
        bad.append('분기 끝이 발표일 뒤')
    if p.get('end') and prev_e and abs((D(p['end']) - D(prev_e)).days) <= 8:
        return None, None, None, None          # 이미 정식 공시가 있는 분기(같은 날 낸 10-Q 등) — 실패가 아님
    hard = [b for b in bad if not b.startswith(('현금흐름표', '재무상태표'))]
    if hard:
        return p.get('end'), None, None, hard
    q = dict(p['q'])
    yq = p.get('cf_ytd')
    if yq and 'ocf' not in q:                      # 현금흐름표가 누적(6·9개월)만 → 지난 분기들을 빼서 이번 분기
        n = {'6m': 1, '9m': 2, '12m': 3}.get(yq[0])
        prevs = [e for e in ends if 0 < (D(p['end']) - D(e)).days < 3 * 92][-n:] if n else []
        if n and len(prevs) == n and all(Q[e].get(k) is not None for e in prevs for k in yq[1]):
            for k, v in yq[1].items():
                q[k] = v - sum(Q[e].get(k) or 0 for e in prevs)
    if 'liab' not in q and q.get('la') is not None and q.get('eqt') is not None:
        q['liab'] = q['la'] - q['eqt']
    last4 = [Q[e] for e in ends[-4:]]
    if 'ocf' in q:                      # 현금흐름표는 있는데 배당·자사주 줄이 없음 — 지난 4개 분기 모두 0 이었으면 0, 아니면 모름(None)
        for k in ('div', 'buy'):
            if k not in q and last4 and all(not r.get(k) for r in last4):
                q[k] = 0.0
    # (이자비용 줄이 없는 보도자료는 이자보상배율을 비워 둠 — 지난 분기 값으로 채우면 차입이 바뀐 분기에 크게 틀림: NVDA 2026-07 584 vs 실제 427)
    # 시가총액 주식 수 = 지난 정식 공시의 표지 발행주식 수(보도자료의 희석 가중평균보다 정식 공시 값에 가까움)
    #   단 희석 가중평균과 20% 넘게 다르면(그 사이 주식 분할·상장 직후 등 — KLAC 2026-06 10:1 분할) 희석 가중평균
    sh0, dsh = (Q[prev_e].get('sh') if prev_e else None), p.get('dsh')
    q['sh'] = sh0 if sh0 and (not dsh or 0.8 <= sh0 / dsh <= 1.25) else (dsh or sh0)
    q.pop('la', None)
    q.pop('eqt', None)
    a = None
    if p.get('a') and p['a'].get('rev'):
        a = dict(p['a'])
        for k in ('liab', 'eq'):
            if q.get(k) is not None:
                a[k] = q[k]
        a['sh'] = q['sh']
        for k in ('div', 'buy'):
            if 'ocf' in a and k not in a and q.get(k) == 0.0:
                a[k] = 0.0
    return p['end'], q, a, None


def us_rows(sym, cik, sub, use_press=True):
    """미국 공시 회사 → (통화, 분기 줄, 연간 줄, 상태)"""
    facts_fresh(cik, sub)
    cur, Q, A = fin.collect([cik])
    if not Q:
        return None, [], [], {'why': 'XBRL 분기 없음'}
    st = {'src': 'sec', 'last_xbrl': max(Q)}
    supp_q = supp_a = None
    if use_press:
        e, q, a, why = press_rec(cik, sub, Q, A, max(Q))
        if why:
            st['press_fail'] = [e, why]
        elif q:
            Q[e] = q
            supp_q = e
            if a:
                A[e] = a
                supp_a = e
    qr, ar = fin.derive(cur or 'USD', Q, A, pxf_of(sym), sym)
    for rows, se, ann in ((qr, supp_q, False), (ar, supp_a, True)):
        for o in rows:
            o['label'] = label(o['end'], ann)
            if se and o['end'] == se:
                o['supp'] = 1
    if supp_q:
        st['src'] = 'press'
        st['press_end'] = supp_q
    return cur, qr, ar, st


# ── 해외 회사 (야후) ──
def yahoo_series(y, sym):
    ty = ','.join('quarterly' + v for v in YT.values()) + ',' + ','.join('annual' + v for v in YT.values())
    # 재무 시계열은 crumb 없이도 받아짐(야후 quoteSummary 가 막혀도 — 2026-11-20 확인) · crumb 이 있으면 붙임
    u = ('https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/%s?symbol=%s&type=%s&period1=%d&period2=%d'
         % (urllib.parse.quote(sym), urllib.parse.quote(sym), ty, 1483228800, int(time.time()) + 86400)) + ('&crumb=' + urllib.parse.quote(y.crumb) if y and y.crumb else '')
    import eps as E
    try:
        d = json.loads(E._get(u, y.op if y else None).decode('utf-8', 'replace'))
    except Exception:
        d = json.loads(E._get(u.replace('query1.', 'query2.'), y.op if y else None).decode('utf-8', 'replace'))
    inv = {v: k for k, v in YT.items()}
    Q, A, cur = {}, {}, None
    for r in (d.get('timeseries') or {}).get('result') or []:
        t = (r.get('meta') or {}).get('type', [''])[0]
        ann = t.startswith('annual')
        k = inv.get(t[len('annual'):] if ann else t[len('quarterly'):])
        if not k:
            continue
        for x in r.get(t) or []:
            if not x or not x.get('asOfDate'):
                continue
            v = (x.get('reportedValue') or {}).get('raw')
            if v is None:
                continue
            if k not in ('sh',):
                cur = cur or x.get('currencyCode')
            (A if ann else Q).setdefault(x['asOfDate'], {})[k] = abs(v) if k in ('div', 'buy', 'intexp') else v
    for store in (Q, A):
        for e, r in store.items():
            if 'ocf' in r:
                r.setdefault('div', 0.0)
                r.setdefault('buy', 0.0)
    return cur, Q, A


def foreign_rows(y, sym, loc, sh=None):
    """해외 회사 — 야후 재무(현지 통화) · 시가총액 = 주식 수 × 현지 종가
    sh = 현지 주식 수(기준 자료의 현지 시가총액 ÷ 현지 가격) — 야후 주식 수는 ADR 기준인 종목이 있어(TSM = 원주 ÷ 5) 쓰지 않음"""
    cur, Q, A = yahoo_series(y, sym)
    if not Q:
        return None, [], [], {'why': '야후 분기 재무 없음'}
    for store in (Q, A):
        for r in store.values():
            if sh:
                r['sh'] = sh
            else:
                r.pop('sh', None)
    p = prices.chart(loc, max_age=6 * 3600)
    pxf = (lambda d: prices.actual(p, d)) if p else (lambda d: None)
    qr, ar = fin.derive('USD', Q, A, pxf, None)     # 'USD' = 환산 없음(현지 가격 × 현지 주식 수 = 현지 통화 시가총액)
    for rows, ann in ((qr, False), (ar, True)):
        for o in rows:
            o['label'] = label(o['end'], ann)
    return cur, qr, ar, {'src': 'yahoo', 'last': max(Q)}


if __name__ == '__main__':
    import eps as E
    with open(os.path.join(ROOT, 'data', 'semis', 'base.json'), encoding='utf-8') as f:
        base = json.load(f)
    loc = {c['sym']: c['loc'] for etf in base['etf'].values() for c in etf['companies']}
    tc = fund.ticker_cik()
    y = None
    for s in sys.argv[1:]:
        cik = tc.get(s)
        sub = subs(cik) if cik else None
        if sub and is_xbrl(sub):
            cur, qr, ar, st = us_rows(s, cik, sub)
        else:
            y = y or E.Yahoo()
            b = next(c for e in base['etf'].values() for c in e['companies'] if c['sym'] == s)
            cur, qr, ar, st = foreign_rows(y, s, loc.get(s, s), b['mcap_local'] / b['px_loc'] if b.get('px_loc') else None)
        print(s, cur, json.dumps(st, ensure_ascii=False))
        for o in qr[-2:]:
            print('   q', json.dumps(round_row(o)), o.get('supp'))
        for o in ar[-1:]:
            print('   a', json.dumps(round_row(o)), o.get('supp'))
