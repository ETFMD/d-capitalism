#!/usr/bin/env python3
"""[USIDX] 보유 종목 → 증권(CUSIP) 맞추기 (SEC 결제 불이행 자료 FTD: 반달마다 CUSIP·티커·종목명·전일 종가)
· N-PORT 줄(CUSIP 있음): 그대로 · ISIN 이 US 로 시작하면 그 안의 CUSIP
· 옛 보고서 줄(이름만): ① N-PORT 때(또는 다른 날짜에) 같은 이름으로 나온 CUSIP — 그날 FTD 가격이 있으면 ±5% 확인
                        ② 그날 앞뒤 FTD 에서 가격(평가액 ÷ 주식 수 ±4%)과 이름이 가장 잘 맞는 보통주
· 결과: RAW/ids.json = {cusip: {sym: 그때 티커, cur: 최근 FTD 티커 또는 None, name, names:[보유 내역 이름들]}}
· 가격 검증(야후 종가 × 분할 = 보유 내역의 평가액 ÷ 주식 수)은 prices.py 에서"""
import bisect, io, os, re, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D, fetch, jload, jsave, rpath, log   # noqa: E402

LIST = 'https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data'
FTD_FROM = '201101a'


def ftd_list():
    h = fetch(LIST, 'sec').decode('utf-8', 'replace')
    out = {}
    for u in re.findall(r'href="([^"]*cnsfails(\d{6}[ab])\.zip)"', h):
        out[u[1]] = 'https://www.sec.gov' + u[0] if u[0].startswith('/') else u[0]
    return dict(sorted(out.items()))


def ftd(per, url):
    """{cusip: [sym, desc, {결제일: 가격}]} — RAW/ftd/<기간>.json.gz · 가격 = 결제일 전 거래일 종가"""
    p = rpath('ftd', per + '.json.gz')
    o = jload(p)
    if o is not None:
        return o
    old = rpath('ftd', per + '.json')          # 예전 보관본(압축 안 함) → 옮김
    o = jload(old)
    if o is None:
        z = zipfile.ZipFile(io.BytesIO(fetch(url, 'sec', timeout=120)))
        o = {}
        for n in z.namelist():
            for ln in z.read(n).decode('latin-1').splitlines()[1:]:
                f = ln.split('|')
                if len(f) < 6 or not f[1].strip():
                    continue
                c, sym, desc = f[1].strip().upper(), f[2].strip(), f[4].strip()
                try:
                    px = float(f[5])
                except ValueError:
                    px = None
                e = o.setdefault(c, [sym, desc, {}])
                e[0], e[1] = sym or e[0], desc or e[1]
                if px:
                    e[2][f[0][:4] + '-' + f[0][4:6] + '-' + f[0][6:8]] = px
    jsave(p, o)
    if os.path.exists(old):
        os.remove(old)
    return o


def ftd_all(L=None):
    L = L or ftd_list()
    for i, per in enumerate(L):
        if per >= FTD_FROM:
            ftd(per, L[per])
        if i % 40 == 0:
            log('FTD', per)
    return L


def near_pers(d, n=1):
    """기준일이 든 반달 + 앞뒤 n개"""
    y, m, h = int(d[:4]), int(d[5:7]), 0 if int(d[8:10]) <= 15 else 1
    k = (y * 12 + m - 1) * 2 + h
    return ['%04d%02d%s' % ((j // 2) // 12, (j // 2) % 12 + 1, 'ab'[j % 2]) for j in range(k - n, k + n + 1)]


# ── 이름 비교 ──
LEGAL = {'INC': 'INC', 'INCORPORATED': 'INC', 'CORP': 'CORP', 'CORPORATION': 'CORP', 'CO': 'CO', 'COMPANY': 'CO', 'COS': 'CO', 'COMPANIES': 'CO',
         'LTD': 'LTD', 'LIMITED': 'LTD', 'PLC': 'PLC', 'NV': 'NV', 'SA': 'SA', 'AG': 'AG', 'LP': 'LP', 'LLC': 'LLC', 'SE': 'SE'}
SOFT = set('THE OF AND COM COMMON STOCK STK NEW SHS SHARES SH ORD ORDINARY CL CLASS SPECIAL CAP USD PAR VALUE REIT ADR ADS SPONSORED SPON DE DEL'.split()) | set('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
ABBR = {'INTL': 'INTERNATIONAL', 'HLDGS': 'HOLDINGS', 'HLDG': 'HOLDINGS', 'HOLDING': 'HOLDINGS', 'GRP': 'GROUP', 'FINL': 'FINANCIAL', 'SVCS': 'SERVICES', 'SVC': 'SERVICES',
        'MGMT': 'MANAGEMENT', 'MGT': 'MANAGEMENT', 'TECH': 'TECHNOLOGIES', 'TECHNOLOGY': 'TECHNOLOGIES', 'PHARMA': 'PHARMACEUTICALS', 'PHARMACEUTICAL': 'PHARMACEUTICALS',
        'INVT': 'INVESTMENT', 'COMMUNICATIONS': 'COMMUNICATION', 'COMMUNS': 'COMMUNICATION', 'COMMUN': 'COMMUNICATION', 'SYS': 'SYSTEMS', 'LABS': 'LABORATORIES',
        'BANCORPORATION': 'BANCORP', 'ENTMT': 'ENTERTAINMENT', 'PPTYS': 'PROPERTIES', 'RES': 'RESOURCES', 'INDS': 'INDUSTRIES', 'IND': 'INDUSTRIES', 'ENRGY': 'ENERGY', 'GP': 'GROUP', 'GRP': 'GROUP', 'NATL': 'NATIONAL', 'AMERN': 'AMERICAN',
        'AMER': 'AMERICAN', 'MTRS': 'MOTORS', 'ELEC': 'ELECTRIC', 'PETE': 'PETROLEUM', 'ENTERPRISES': 'ENTERPRISE', 'PRODS': 'PRODUCTS', 'CHEM': 'CHEMICALS', 'CHEMICAL': 'CHEMICALS',
        'PULTE': 'PULTEGROUP', 'QUINTILES': 'IQVIA', 'PPOG': 'PPG', 'GEN': 'GENERAL', 'MFG': 'MANUFACTURING'}   # 약어·사명 변경·보고서 오타(PPoG)
GENERIC = set('''GROUP HOLDINGS INTERNATIONAL FINANCIAL SERVICES ENERGY TECHNOLOGIES SYSTEMS INDUSTRIES RESOURCES PRODUCTS AMERICAN NATIONAL GENERAL
UNITED FIRST CAPITAL BANCORP BANK BANCSHARES COMMUNICATION ENTERPRISE MANAGEMENT PROPERTIES TRUST PHARMACEUTICALS LABORATORIES MOTORS ELECTRIC PETROLEUM
CHEMICALS MANUFACTURING HEALTH HEALTHCARE MEDICAL SOLUTIONS NETWORKS SOFTWARE DATA POWER OIL GAS INSURANCE REALTY INVESTMENT INVESTORS PARTNERS STORES
BRANDS FOODS FOOD WORLDWIDE GLOBAL CORPORATE MEDIA ENTERTAINMENT SCIENCES SCIENCE BIOSCIENCES THERAPEUTICS DEVICES INSTRUMENTS SEMICONDUCTOR MICRO
COMPUTER DIGITAL ONLINE NETWORK PACIFIC ATLANTIC SOUTHERN NORTHERN WESTERN EASTERN CENTRAL STATE STATES US USA AMERICA NORTH SOUTH WEST EAST'''.split())
NONCOMMON = re.compile(r'\b(PFD|PREF|PREFERRED|WT|WTS|WARRANTS?|RTS?|RIGHTS|UNITS?|NOTES?|DEB|DEBS|DEP SHS|DEPOSITARY SH|ETF|FUND|CONV)\b')
CLASS = re.compile(r'\b(?:CLASS|CL|SERIES|SER)\s*([A-C])\b|\(([A-C])\)')


def ntoks(s):
    """(핵심 낱말 목록, 법인 형태 집합)"""
    s = s.upper().replace('&', ' AND ').replace("'", '').replace('’', '')
    s = re.sub(r'/[A-Z ]{1,6}(/|$)', ' ', s.strip())             # SEC·N-PORT 이름의 '/DE/'·'/NY' 같은 꼬리표
    s = re.sub(r'\bDU PONT\b', 'DUPONT', s)
    s = re.sub(r'\(\s*[A-Z]{1,5}\s*(\)|$)', ' ', s)                    # FTD 종목명 끝의 설립지 표시 '(DE)'·'(IRE'
    s = re.sub(r'\b([A-Z])\.(?=[A-Z]\.)', r'\1', s).replace('.', '')   # V.F. → VF
    s = re.sub(r'\s*\*+\s*', ' ', s)
    core, legal = [], set()
    w = re.sub(r'[^A-Z0-9 ]', ' ', s).split()
    j = []                                                     # 홀로 선 글자 둘 이상은 이어 붙임: 'BARD C R' → BARD CR · 'HEINZ H J' → HEINZ HJ
    for x in w:
        if len(x) == 1 and j and re.fullmatch(r'[A-Z]+\x00', j[-1]):
            j[-1] = j[-1][:-1] + x + '\x00'
        else:
            j.append(x + '\x00' if len(x) == 1 else x)
    w = [x[:-1] if x.endswith('\x00') else x for x in j]
    for x in w:
        if x in LEGAL:
            legal.add(LEGAL[x])
            continue
        if x in SOFT or x == 'IMS' or re.fullmatch(r'(USD|EUR|GBP|CHF|NPV)?\d*', x):   # 액면가·통화 표기(USD0.01·NPV)와 숫자만인 낱말
            continue
        x = ABBR.get(x, x)
        if x:
            core.append(x)
    return core, legal


def nkey(s):
    return ' '.join(ntoks(s)[0])


def cls_of(s):
    m = CLASS.search(s.upper())
    return (m.group(1) or m.group(2)) if m else None


def _tm(a, b):
    return a == b or (len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a)))


def score(hold, desc):
    """보유 내역 이름 ↔ FTD 종목명 → 0~1.2 (맞는 낱말 비율 + 법인 형태) · 다른 종류 주식(우선주·워런트·다른 클래스)이면 -1"""
    if NONCOMMON.search(desc.upper()):
        return -1
    ch, cd = cls_of(hold), cls_of(desc)
    if ch and cd and ch != cd:
        return -1
    (th, lh), (td, ld) = ntoks(hold), ntoks(desc)
    if not th or not td:
        return 0
    m = [t for t in th if any(_tm(t, u) for u in td)]
    if not any(len(t) >= 3 and t not in GENERIC for t in m) and th != td:   # 흔한 낱말(GROUP·ENERGY…)만 겹치면 안 됨 · 짧은 이름(CA 등)은 낱말이 똑같을 때만
        return 0
    s = len(m) / len(th)
    if s < 0.6 and th[0] in m and len(th[0]) >= 5 and th[0] not in GENERIC and td and _tm(th[0], td[0]):
        s = 0.6                                         # 첫 낱말(회사 고유 이름)이 둘 다 맨 앞에서 같으면 — 'LyondellBasell Industries' ↔ 'LYONDELLBASELL IND' · 'Adobe Systems' ↔ 'ADOBE INC'
    if s < 0.6:
        return 0
    if lh and ld:                                       # 법인 형태(INC·CORP·PLC…)는 순위에만
        s += 0.2 if lh & ld else -0.3
    return s


CINS_CC = {'BM', 'KY', 'VG'}   # ISIN 안에 CINS(G 로 시작)가 그대로 든 나라 (버뮤다·케이맨·영국령 버진아일랜드)


def cusip_ok(c):
    """CUSIP 9자리 검증 숫자"""
    if len(c) != 9 or not c[8].isdigit():
        return False
    t = 0
    for i, ch in enumerate(c[:8]):
        v = int(ch) if ch.isdigit() else (ord(ch) - 55 if 'A' <= ch <= 'Z' else {'*': 36, '@': 37, '#': 38}.get(ch))
        if v is None:
            return False
        if i % 2:
            v *= 2
        t += v // 10 + v % 10
    return (10 - t % 10) % 10 == int(c[8])


def _okc(c):
    return bool(c) and len(c) == 9 and c != '000000000' and c.upper() != 'N/A'


def build(holds):
    """holds: {etf: [보유 내역 dict]} → (ids, 못 맞춘 줄) — 줄마다 r['cusip'] 를 채움"""
    L = ftd_list()
    pers = sorted(L)
    R = {}
    for per in pers[-12:]:
        for c, e in ftd(per, L[per]).items():
            R[c] = e[0]                      # 뒤 파일이 이김 = 가장 최근 티커
    DESC = {}
    for per in pers:
        if per >= FTD_FROM:
            for c, e in ftd(per, L[per]).items():
                DESC[c] = e[1]
    ids, byname, FIRST = {}, {}, {}
    rows = [(etf, h, r) for etf, hl in holds.items() for h in hl for r in h['rows']]
    for etf, h, r in rows:                   # 1단계: CUSIP 이 적힌 줄(N-PORT) — ISIN 안의 CUSIP(미국·버뮤다·케이맨 등 CINS)이 검증 숫자까지 맞는데 적힌 CUSIP 과 다르면 ISIN 쪽(N-PORT 의 CUSIP 오기: NCLH·인베스코 등)
        if 'cusip0' not in r:                # 공시에 적힌 원래 CUSIP (아래에서 r['cusip'] 를 바꿔 저장하므로 따로 둠)
            r['cusip0'] = r.get('cusip') if h['form'] == 'NPORT-P' else None
        c = (r.get('cusip0') or '').upper()
        isin = (r.get('isin') or '').upper()
        ic = isin[2:11] if len(isin) == 12 and (isin[:2] in ('US', 'CA') or (isin[:2] in CINS_CC and isin[2] == 'G')) and cusip_ok(isin[2:11]) else None
        if ic and ic != c and (not _okc(c) or (DESC.get(c) and score(r['name'], DESC[c]) <= 0 and (not DESC.get(ic) or score(r['name'], DESC[ic]) > 0))):
            c = isin[2:11]
        r['cusip'] = c if _okc(c) else None
        if r['cusip']:
            byname.setdefault(nkey(r['name']), set()).add(r['cusip'])
            FIRST[r['cusip']] = min(FIRST.get(r['cusip'], '9999'), h['date'])
    cache = {}

    def near_ftd(d):
        if d not in cache:
            F = {}
            for per in near_pers(d, 1):
                if per in L:
                    F.update(ftd(per, L[per]))
            P = sorted((p, cc) for cc, (sym, desc, prs) in F.items() for dd, p in prs.items() if abs((D(dd) - D(d)).days) <= 6)
            cache[d] = (F, P, [x[0] for x in P])
        return cache[d]

    cache2 = {}

    def near_ftd2(d):
        if d not in cache2:
            F = {}
            for per in near_pers(d, 2):
                if per in L:
                    for cc, e in ftd(per, L[per]).items():
                        if cc in F:
                            F[cc] = [e[0], e[1], dict(F[cc][2], **e[2])]
                        else:
                            F[cc] = e
            cache2[d] = F
        return cache2[d]

    for pass_ in (1, 2):                    # 두 번: 첫 번째에 익힌 이름(다른 날짜 줄)으로 남은 줄을 한 번 더
     miss = []
     for etf, h, r in sorted(rows, key=lambda x: x[1]['date'], reverse=True):   # 2단계: 이름만 있는 줄 — 최근 날짜부터(가까운 날짜의 이름을 먼저 익힘)
         if r['cusip']:
             continue
         F, P, PV = near_ftd(h['date'])
         px = r['val'] / r['sh']
         best = None
         for cc in sorted(byname.get(nkey(r['name']), ())):   # ① 같은 이름의 CUSIP — 그날 가격이 있으면 맞는지 확인
             prs = [p for dd, p in (F.get(cc) or [None, None, {}])[2].items() if abs((D(dd) - D(h['date'])).days) <= 6]
             if prs and min(abs(p / px - 1) for p in prs) < 0.05:
                 best = (9, 0, cc)
                 break
         if not best:                         # ② 그날 앞뒤 가격 ±4% 인 보통주 중 이름이 가장 잘 맞는 것
             for p, cc in P[bisect.bisect_left(PV, px * 0.96):bisect.bisect_right(PV, px * 1.04)]:
                 s = score(r['name'], F[cc][1])
                 if s >= 0.6 and (best is None or (s, -abs(p / px - 1)) > best[:2]):
                     best = (s, -abs(p / px - 1), cc)
         if not best:                         # ③ 그날 가격 자료가 없으면 같은 이름 CUSIP — 여럿이면 클래스(A·B·C)가 맞고 N-PORT 에 가장 먼저 나온 것
             ch = cls_of(r['name'])
             cs = [cc for cc in byname.get(nkey(r['name']), ()) if not (ch and cls_of(DESC.get(cc, '')) and cls_of(DESC.get(cc, '')) != ch)]
             if cs:
                 best = (1, 0, min(cs, key=lambda cc: (FIRST.get(cc, '9999'), cc)))
         if not best:                         # ④ 앞뒤 한 달 FTD 에서 이름이 거의 같고(0.9 이상) 가격이 ±8% 안에 든 날이 있는 보통주
             for cc, (sym, desc, prs) in near_ftd2(h['date']).items():
                 s = score(r['name'], desc)
                 if s >= 0.9 and any(abs(p / px - 1) < 0.08 for p in prs.values()) and (best is None or s > best[0]):
                     best = (s, 0, cc)
         r['cusip'] = best[2] if best else None
         if r['cusip']:
             byname.setdefault(nkey(r['name']), set()).add(r['cusip'])
         else:
             miss.append((etf, h['date'], r['name'], round(px, 2), r['val']))
    for etf, h, r in rows:
        c = r['cusip']
        if not c:
            continue
        e = ids.setdefault(c, {'sym': None, 'cur': R.get(c), 'name': r['name'], 'names': [], 'desc': DESC.get(c)})
        if r['name'] not in e['names']:
            e['names'].append(r['name'])
        if not e['sym']:
            F = near_ftd(h['date'])[0]
            if F.get(c):
                e['sym'] = F[c][0]
    return ids, miss


if __name__ == '__main__':
    import holdings
    H = {e: holdings.all_holdings(e, refresh=False) for e in holdings.ETFS}
    if '--all-ftd' in sys.argv:
        ftd_all()
    ids, miss = build(H)
    jsave(rpath('ids.json'), ids)
    for e in H:   # 줄마다 붙인 CUSIP 를 보유 내역 파일에도 저장
        for h in H[e]:
            jsave(rpath('hold', e, h['date'] + '.json'), h)
    print('CUSIP', len(ids), '· 최근 티커 없음', sum(1 for v in ids.values() if not v['cur']), '· 못 맞춘 옛 줄', len(miss))
    tot = {}
    for m in miss:
        tot.setdefault((m[0], m[1]), [0, 0])
        tot[(m[0], m[1])][0] += 1
    for k, v in sorted(tot.items()):
        print(' ', k, v[0])
    for m in sorted(miss, key=lambda x: -x[4])[:60]:
        print('   ', m)
