#!/usr/bin/env python3
"""[USIDX] 주식 종류(클래스)별로만 EPS 를 공시하는 회사 — 공시 원문 XBRL 에서 그 클래스의 EPS 를 직접 읽음
· SEC companyfacts 는 '차원 없는' 값만 모아 주는데, 버크셔(A·B주)·비자(A·B·C주)는 EPS 를 클래스별(StatementClassOfStockAxis)로만 냄
  → 10-Q·10-K 마다 XBRL 인스턴스(…_htm.xml 또는 옛 …-YYYYMMDD.xml)를 받아 그 클래스 멤버의 희석(없으면 기본) EPS 를 모음
· RAW/dimeps/<cik>-<멤버>.json = {done: [접수번호…], rows: [[시작, 끝, 값, 제출일, 양식]]}
· 결과는 companyfacts 와 같은 줄 꼴 → calc.Co 가 그 증권의 EPS 로 씀(SPECIAL)"""
import os, re, sys, time
from xml.etree import ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import fetch, jfetch, jload, jsave, rpath, log   # noqa: E402
import fund   # noqa: E402

SPECIAL = {'BRK-B': (1067983, r'(Common|Equivalent)?ClassBMember$'), 'V': (1403161, r'^(Common)?ClassAMember$')}   # 멤버 이름(정규식) — 버크셔는 2017년 무렵부터 EquivalentClassBMember
TAGS = ('EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic',
        'IncomeLossFromContinuingOperationsPerDilutedShare',                 # 리전시센터스(REIT·운영 파트너십 공동 보고) — 2019년 뒤 이 태그로만
        'NetIncomeLossNetOfTaxPerOutstandingLimitedPartnershipUnitDiluted')  # 아레스 매니지먼트(옛 합자회사 태그를 A주에 그대로)
NODIM = ''          # 멤버 '' = 차원 없는 값(companyfacts 에 없는 태그로만 낸 경우)


def _instance(cik, acc):
    base = 'https://www.sec.gov/Archives/edgar/data/%d/%s/' % (cik, acc.replace('-', ''))
    idx = jfetch(base + 'index.json', 'sec')
    names = [x['name'] for x in idx.get('directory', {}).get('item', [])]
    pick = [n for n in names if n.endswith('_htm.xml')] or \
           [n for n in names if re.search(r'\.xml$', n) and not re.search(r'(_cal|_def|_lab|_pre|FilingSummary|MetaLinks|\.xsd)', n, re.I) and re.search(r'\d{8}', n)]
    return (base + pick[0]) if pick else None


def parse(xml, member):
    """XBRL 인스턴스 → [(시작, 끝, 값)] — 차원이 'StatementClassOfStockAxis = member' 하나뿐인 EPS (희석 우선)
    · member 가 '^$'(NODIM) 이면 차원 없는 값"""
    root = ET.fromstring(xml)
    ctx = {}
    for c in root.iter():
        if not c.tag.endswith('}context'):
            continue
        cid = c.get('id')
        st = en = None
        dims = []
        for x in c.iter():
            t = x.tag.split('}')[-1]
            if t == 'startDate':
                st = x.text.strip()
            elif t in ('endDate', 'instant'):
                en = x.text.strip()
            elif t == 'explicitMember':
                dims.append((x.get('dimension', '').split(':')[-1], (x.text or '').strip().split(':')[-1]))
        ctx[cid] = (st, en, dims)
    best = {}
    for el in root:
        t = el.tag.split('}')[-1]
        if t not in TAGS:
            continue
        cx = ctx.get(el.get('contextRef'))
        if not cx or not cx[0]:
            continue
        if member == '^$':
            if cx[2]:
                continue
        elif len(cx[2]) != 1 or cx[2][0][0] != 'StatementClassOfStockAxis' or not re.search(member, cx[2][0][1]):
            continue
        try:
            v = float(el.text)
        except (TypeError, ValueError):
            continue
        k = (cx[0], cx[1])
        if k not in best or TAGS.index(t) < best[k][1]:
            best[k] = (v, TAGS.index(t))
    return [(k[0], k[1], v[0]) for k, v in best.items()]


def rows(cik, member, refresh_subs=False):
    p = rpath('dimeps', '%d-%s.json' % (cik, re.sub(r'[^A-Za-z]', '', member)))
    o = jload(p) or {'done': [], 'rows': []}
    sub = fund.subs(cik, refresh=refresh_subs or not (fund.subs(cik).get('v') == 2))
    done = set(o['done'])
    new = 0
    for x in sub['r']:
        if x[0] not in ('10-Q', '10-K', '10-Q/A', '10-K/A') or len(x) < 5 or x[1] < '2009-07-01' or x[4] in done:
            continue
        try:
            u = _instance(cik, x[4])
            got = parse(fetch(u, 'sec', timeout=120), member) if u else []
        except Exception as e:
            log('XBRL 인스턴스 실패', cik, x[4], e)
            continue
        for s, e, v in got:
            o['rows'].append([s, e, v, x[1], x[0]])
        o['done'].append(x[4])
        new += 1
    if new:
        jsave(p, o)
    return o['rows']


def members(cik):
    """최근 정기 보고서의 클래스별 EPS 멤버 {멤버: 개수}"""
    sub = fund.subs(cik, refresh=not (fund.subs(cik).get('v') == 2))
    for x in reversed(sub['r']):
        if x[0] in ('10-Q', '10-K') and len(x) >= 5:
            u = _instance(cik, x[4])
            if not u:
                continue
            root = ET.fromstring(fetch(u, 'sec', timeout=120))
            ctx = {}
            for c in root.iter():
                if c.tag.endswith('}context'):
                    dims = [(y.get('dimension', '').split(':')[-1], (y.text or '').strip().split(':')[-1]) for y in c.iter() if y.tag.endswith('}explicitMember')]
                    ctx[c.get('id')] = dims
            out = {}
            for el in root:
                if el.tag.split('}')[-1] in TAGS:
                    d = ctx.get(el.get('contextRef')) or []
                    if len(d) == 1 and d[0][0] == 'StatementClassOfStockAxis':
                        out[d[0][1]] = out.get(d[0][1], 0) + 1
                    elif not d:
                        out[NODIM] = out.get(NODIM, 0) + 1
            return out
    return {}


def auto(cik, sym):
    """EPS 를 클래스별로만 낸 회사(허쉬·컨스텔레이션 브랜즈 등) — 그 티커의 클래스 멤버를 골라 companyfacts 꼴 줄로
    · 티커가 B 주식(…-B)이면 ClassB, 아니면 CommonStockMember → CommonClassA → 가장 많이 나온 멤버"""
    p = rpath('dimeps', 'auto.json')
    a = jload(p, {})
    k = str(cik)
    if k not in a or (a[k] is None and time.time() - a.get('t:' + k, 0) > 7 * 86400):     # 못 찾았으면 1주일 뒤 다시
        try:
            ms = members(cik)
        except Exception as e:
            log('클래스 멤버 찾기 실패', cik, e)
            return None
        pick = None
        if ms:
            if sym.endswith('-B'):
                pick = next((m for m in ms if 'ClassB' in m), None)
            pick = pick or next((m for m in ms if m in ('CommonStockMember',)), None) or next((m for m in ms if 'ClassA' in m), None) \
                or (NODIM if NODIM in ms else None) or max(ms, key=ms.get)
        a[k] = pick
        a['t:' + k] = time.time()
        jsave(p, a)
    if a[k] is None:
        return None
    return _first(rows(cik, '^' + re.escape(a[k]) + '$'))


def _first(rs):
    first = {}
    for s, e, v, filed, form in rs:
        k = (s, e)
        f = first.get(k)
        if f is None:
            first[k] = [s, e, v, filed, form, v, filed]
        else:
            if filed < f[3]:
                f[2], f[3], f[4] = v, filed, form
            if filed >= f[6]:
                f[5], f[6] = v, filed
    return sorted(first.values(), key=lambda r: (r[1], r[0]))


def eps_rows(sym):
    """그 티커가 SPECIAL 이면 companyfacts 꼴의 EPS 줄 [시작, 끝, 처음 값, 처음 낸 날, 양식, 마지막 값, 마지막 낸 날]"""
    if sym not in SPECIAL:
        return None
    cik, member = SPECIAL[sym]
    return _first(rows(cik, member))


if __name__ == '__main__':
    for t in SPECIAL:
        r = eps_rows(t)
        print(t, len(r), r[:3], r[-3:])
