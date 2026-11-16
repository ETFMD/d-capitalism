#!/usr/bin/env python3
"""[USIDX] 재무(SEC XBRL companyfacts) · 실적 발표일(SEC 제출 목록의 8-K 2.02) — 기업(CIK)별 보관
· RAW/cf/<cik>.json.gz = {at, v:3, name, cur, c: {항목: [[태그, 단위, [[시작|None, 끝, 처음 값, 처음 낸 날, 양식, 마지막 값, 마지막 낸 날], …]], …]}}
  - 기본은 '처음 낸 값'(그때 사람들이 본 숫자) · 처음 값이 단위 오류(1,000·100만 배 등)면 나중 값으로(calc.py)
  - 주당순이익은 그때 주식 수 기준 → 계산할 때 그 뒤 주식 분할로 나눔(calc.py)
· RAW/sub/<cik>.json.gz = {at, v:2, name, tickers, r: [[양식, 제출일, 기준일, 8-K 항목, 접수번호, 본문 파일]]}  (10-Q·10-K·20-F·40-F·6-K·8-K(2.02))
· 다시 받기: 마지막으로 받은 뒤 SEC 일별 제출 목록(daily-index)에 그 CIK 의 공시가 올라왔을 때만 (update_usidx.py)"""
import datetime as dt, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D, fetch, jfetch, jload, jsave, rpath, log   # noqa: E402

CONC = {
    'eps': [('us-gaap', 'EarningsPerShareDiluted'), ('us-gaap', 'EarningsPerShareBasicAndDiluted'), ('ifrs-full', 'DilutedEarningsLossPerShare'),
            ('us-gaap', 'EarningsPerShareBasic'), ('ifrs-full', 'BasicEarningsLossPerShare')],
    'dsh': [('us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'), ('us-gaap', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'),
            ('us-gaap', 'WeightedAverageNumberOfSharesOutstandingBasic'), ('ifrs-full', 'AdjustedWeightedAverageShares'), ('ifrs-full', 'WeightedAverageShares')],
    'sho': [('dei', 'EntityCommonStockSharesOutstanding')],
    'rev': [('us-gaap', 'Revenues'), ('us-gaap', 'RevenueFromContractWithCustomerExcludingAssessedTax'), ('us-gaap', 'RevenueFromContractWithCustomerIncludingAssessedTax'),
            ('us-gaap', 'SalesRevenueNet'), ('us-gaap', 'SalesRevenueGoodsNet'), ('us-gaap', 'SalesRevenueServicesNet'), ('us-gaap', 'RevenuesNetOfInterestExpense'),
            ('us-gaap', 'RegulatedAndUnregulatedOperatingRevenue'), ('us-gaap', 'ElectricUtilityRevenue'), ('us-gaap', 'RealEstateRevenueNet'),
            ('us-gaap', 'OperatingLeasesIncomeStatementLeaseRevenue'), ('ifrs-full', 'Revenue'), ('ifrs-full', 'RevenueFromContractsWithCustomers')],
    'oi': [('us-gaap', 'OperatingIncomeLoss'), ('ifrs-full', 'ProfitLossFromOperatingActivities')],
    'ni': [('us-gaap', 'NetIncomeLoss'), ('us-gaap', 'NetIncomeLossAvailableToCommonStockholdersBasic'), ('us-gaap', 'ProfitLoss'),
           ('ifrs-full', 'ProfitLossAttributableToOwnersOfParent'), ('ifrs-full', 'ProfitLoss')],
    'ocf': [('us-gaap', 'NetCashProvidedByUsedInOperatingActivities'), ('us-gaap', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'),
            ('ifrs-full', 'CashFlowsFromUsedInOperatingActivities')],
    'intexp': [('us-gaap', 'InterestExpense'), ('us-gaap', 'InterestExpenseNonoperating'), ('us-gaap', 'InterestExpenseDebt'), ('us-gaap', 'InterestAndDebtExpense'),
               ('us-gaap', 'InterestExpenseBorrowings'), ('us-gaap', 'InterestExpenseOperating'), ('ifrs-full', 'InterestExpense'), ('ifrs-full', 'FinanceCosts')],
    'div': [('us-gaap', 'PaymentsOfDividendsCommonStock'), ('us-gaap', 'PaymentsOfDividends'), ('us-gaap', 'PaymentsOfOrdinaryDividends'),
            ('ifrs-full', 'DividendsPaidClassifiedAsFinancingActivities'), ('ifrs-full', 'DividendsPaid')],
    'buy': [('us-gaap', 'PaymentsForRepurchaseOfCommonStock'), ('us-gaap', 'PaymentsForRepurchaseOfEquity'), ('ifrs-full', 'PaymentsToAcquireOrRedeemEntitysShares')],
    'liab': [('us-gaap', 'Liabilities'), ('ifrs-full', 'Liabilities')],
    'eq': [('us-gaap', 'StockholdersEquity'), ('us-gaap', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'),
           ('ifrs-full', 'EquityAttributableToOwnersOfParent'), ('ifrs-full', 'Equity')],
    'la': [('us-gaap', 'LiabilitiesAndStockholdersEquity'), ('ifrs-full', 'EquityAndLiabilities')],
    'eqt': [('us-gaap', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'), ('us-gaap', 'StockholdersEquity'), ('ifrs-full', 'Equity')],
    'cogs': [('us-gaap', 'CostOfRevenue'), ('us-gaap', 'CostOfGoodsAndServicesSold'), ('us-gaap', 'CostOfGoodsSold')],
    'rnd': [('us-gaap', 'ResearchAndDevelopmentExpense'), ('us-gaap', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost')],
    'sga': [('us-gaap', 'SellingGeneralAndAdministrativeExpense')],
}
FORMS = {'10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT', '10-QT', '20-F', '20-F/A', '40-F', '40-F/A', '6-K', '6-K/A',
         'S-1', 'S-1/A', 'F-1', 'F-1/A', '10-12B', '10-12B/A', '10-12G', '10-12G/A'}   # 상장(S-1·F-1)·분사(Form 10) 신고서의 상장 전 분기 실적도
SUBF = {'10-K', '10-Q', '10-K/A', '10-Q/A', '10-KT', '20-F', '40-F', '6-K', '8-K'}


def extract(j):
    """companyfacts → 필요한 항목만 · 기간별 처음 낸 값"""
    f = j.get('facts') or {}
    out, curs = {}, {}
    for k, tags in CONC.items():
        lst = []
        for ns, tag in tags:
            body = (f.get(ns) or {}).get(tag)
            if not body:
                continue
            for unit, facts in (body.get('units') or {}).items():
                first = {}
                for x in facts:
                    if x.get('form') not in FORMS or x.get('val') is None:
                        continue
                    key = (x.get('start'), x['end'])
                    fr = first.get(key)
                    if fr is None:
                        first[key] = [x.get('start'), x['end'], x['val'], x['filed'], x['form'], x['val'], x['filed']]
                        continue
                    if x['filed'] < fr[3]:
                        fr[2], fr[3], fr[4] = x['val'], x['filed'], x['form']
                    if x['filed'] >= fr[6]:
                        fr[5], fr[6] = x['val'], x['filed']
                if first:
                    lst.append([ns + ':' + tag, unit, sorted(first.values(), key=lambda r: (r[1], r[0] or ''))])
                    if k in ('ni', 'rev'):
                        curs[unit] = curs.get(unit, 0) + len(first)
        if lst:
            out[k] = lst
    cur = max(curs, key=curs.get) if curs else None
    return out, cur


def _sync(o):
    """여러 항목이 같은 태그를 쓰는 경우(자본 'eq'·'eqt' 의 StockholdersEquity 등) 그 태그의 줄을 항목끼리 합침
    · 예전 patch() 가 공유 태그를 한 항목에만 넣던 것(2026-11 윌리엄스·리전시 최근 분기 자본 빠짐) 바로잡기 — 불러올 때마다(가벼움)"""
    byt = {}
    for k, lst in (o.get('c') or {}).items():
        for ent in lst:
            byt.setdefault((ent[0], ent[1]), []).append(ent)
    for ents in byt.values():
        if len(ents) < 2:
            continue
        rows = {}
        for ent in ents:
            for r in ent[2]:
                rows.setdefault((r[0], r[1]), r)
        if any(len(ent[2]) != len(rows) for ent in ents):
            allr = sorted(rows.values(), key=lambda r: (r[1], r[0] or ''))
            for ent in ents:
                ent[2] = [list(r) for r in allr]
    return o


def facts(cik, refresh=False):
    p = rpath('cf', '%d.json.gz' % cik)
    o = jload(p)
    if o and not refresh and o.get('v') == 3:
        return _sync(o)
    try:
        j = jfetch('https://data.sec.gov/api/xbrl/companyfacts/CIK%010d.json' % cik, 'sec')
    except Exception as e:   # 404 = XBRL 재무가 없는 회사
        if getattr(e, 'code', None) != 404:
            raise
        j = {}
    c, cur = extract(j)
    o = {'at': time.time(), 'v': 3, 'cik': cik, 'name': j.get('entityName'), 'cur': cur, 'c': c}
    jsave(p, o)
    return o


def subs(cik, refresh=False):
    p = rpath('sub', '%d.json.gz' % cik)
    o = jload(p)
    if o and not refresh:
        return o
    j = jfetch('https://data.sec.gov/submissions/CIK%010d.json' % cik, 'sec')
    blocks = [j['filings']['recent']]
    for f in j['filings'].get('files', []):
        if f.get('filingTo', '9999') >= '2010-01-01':
            blocks.append(jfetch('https://data.sec.gov/submissions/' + f['name'], 'sec'))
    r = []
    for b in blocks:
        for i in range(len(b['form'])):
            fm = b['form'][i]
            if fm not in SUBF:
                continue
            it = b.get('items', [''] * len(b['form']))[i] or ''
            if fm == '8-K' and '2.02' not in it:
                continue
            r.append([fm, b['filingDate'][i], b['reportDate'][i] or '', '2.02' if fm == '8-K' else '', b['accessionNumber'][i], b['primaryDocument'][i]])
    r.sort(key=lambda x: x[1])
    o = {'at': time.time(), 'v': 2, 'cik': cik, 'name': j.get('name'), 'tickers': j.get('tickers') or [], 'fye': j.get('fiscalYearEnd'), 'r': r}
    jsave(p, o)
    return o


def _inst_facts(xml):
    """XBRL 인스턴스(XML) → [(ns:태그, 단위, 시작|None, 끝, 값)] — 차원 없는 값만 · CONC 에 있는 태그만"""
    from xml.etree import ElementTree as ET
    want = {t for v in CONC.values() for t in v}
    root = ET.fromstring(xml)
    ctx, units = {}, {}
    for c in root.iter():
        t = c.tag.split('}')[-1]
        if t == 'context':
            st = en = None
            dim = False
            for y in c.iter():
                yt = y.tag.split('}')[-1]
                if yt == 'startDate':
                    st = y.text.strip()
                elif yt in ('endDate', 'instant'):
                    en = y.text.strip()
                elif yt in ('explicitMember', 'typedMember'):
                    dim = True
            ctx[c.get('id')] = None if dim else (st, en)
        elif t == 'unit':
            ms = [y.text.strip().split(':')[-1] for y in c.iter() if y.tag.split('}')[-1] == 'measure' and y.text]
            dv = any(y.tag.split('}')[-1] == 'divide' for y in c.iter())
            units[c.get('id')] = (ms[0] + '/' + ms[1]) if dv and len(ms) == 2 else (ms[0] if ms else None)
    nsmap = {'http://fasb.org/us-gaap': 'us-gaap', 'http://xbrl.ifrs.org/taxonomy': 'ifrs-full', 'http://xbrl.sec.gov/dei': 'dei'}
    out = []
    for el in root:
        if '}' not in el.tag:
            continue
        uri, name = el.tag[1:].split('}')
        ns = next((v for k, v in nsmap.items() if uri.startswith(k)), None)
        if not ns or (ns, name) not in want:
            continue
        cx = ctx.get(el.get('contextRef'))
        if not cx or not cx[1]:
            continue
        try:
            v = float(el.text)
        except (TypeError, ValueError):
            continue
        out.append((ns + ':' + name, units.get(el.get('unitRef')), cx[0], cx[1], v))
    return out


def patch(cik, since='2023-01-01'):
    """companyfacts 에 빠진 정기 보고서(SEC 자료 처리 누락 — 예: 2026년 AEP·URI 일부 10-Q)를 공시 원문 XBRL 에서 직접 읽어 채움
    · SEC 제출 목록의 10-Q·10-K 중 그 제출일 값이 하나도 없는 것만 · 처리한 접수번호는 xa 에 기록"""
    import dimeps
    o = facts(cik)
    sub = subs(cik)
    if sub.get('v') != 2:
        sub = subs(cik, refresh=True)
    have = set()
    for k, lst in o['c'].items():
        for tag, unit, rows in lst:
            for r in rows:
                have.add(r[3])
                if len(r) >= 7:
                    have.add(r[6])
    xa = set(o.get('xa') or [])
    tagkey = {}
    for k, tags in CONC.items():
        for ns, t in tags:
            tagkey.setdefault(ns + ':' + t, []).append(k)     # 같은 태그를 여러 항목이 씀(eq·eqt) → 모두에
    added = 0
    for x in sub['r']:
        if x[0] not in ('10-Q', '10-K', '10-Q/A', '10-K/A', '20-F', '40-F') or x[1] < since or len(x) < 5 or x[1] in have or x[4] in xa:
            continue
        try:
            u = dimeps._instance(cik, x[4])
            got = _inst_facts(fetch(u, 'sec', timeout=120)) if u else []
        except Exception as e:
            log('공시 원문 XBRL 실패', cik, x[4], e)
            continue
        for tag, unit, st, en, v in got:
            if not unit:
                continue
            for k in tagkey.get(tag, []):
                lst = o['c'].setdefault(k, [])
                ent = next((e for e in lst if e[0] == tag and e[1] == unit), None)
                if ent is None:
                    ent = [tag, unit, []]
                    lst.append(ent)
                rows = ent[2]
                r0 = next((r for r in rows if r[0] == st and r[1] == en), None)
                if r0 is None:
                    rows.append([st, en, v, x[1], x[0], v, x[1]])
                    added += 1
                elif len(r0) >= 7 and x[1] > r0[6]:
                    r0[5], r0[6] = v, x[1]
        for k in o['c']:                                   # 태그 우선순위 순서 유지
            order = {ns + ':' + t: i for i, (ns, t) in enumerate(CONC[k])}
            o['c'][k].sort(key=lambda e: order.get(e[0], 99))
            for e in o['c'][k]:
                e[2].sort(key=lambda r: (r[1], r[0] or ''))
        xa.add(x[4])
        log('공시 원문으로 채움', cik, x[0], x[1], len(got))
    if xa != set(o.get('xa') or []):
        o['xa'] = sorted(xa)
        jsave(rpath('cf', '%d.json.gz' % cik), o)
    return added


def ticker_cik(refresh=False):
    p = rpath('company_tickers.json')
    j = jload(p)
    if not j or refresh:
        j = jfetch('https://www.sec.gov/files/company_tickers.json', 'sec')
        jsave(p, j)
    return {v['ticker'].upper().replace('.', '-'): int(v['cik_str']) for v in j.values()}


def all_ciks(cm):
    return sorted({k for v in cm.values() for k in (v.get('cik'), v.get('cur')) if k})


if __name__ == '__main__':
    cm = jload(rpath('cikmap.json'))
    ciks = all_ciks(cm)
    log('CIK', len(ciks))
    for i, c in enumerate(ciks):
        facts(c)
        subs(c)
        if i % 50 == 0:
            log('재무', i, len(ciks))
