#!/usr/bin/env python3
"""[USIDX] 지금 바구니 — 날마다 갱신
· SPY: 운용사(State Street) 일별 보유 내역 엑셀 — 종목명·티커·CUSIP·비중·주식 수 (실제 보유)
· QQQ: 나스닥 100 지금 구성 종목(나스닥) + 마지막 QQQ N-PORT 의 주식 수(분할 반영) · 그 뒤 새로 들어온 종목은
       기존 종목들의 '보유액 ÷ 시가총액' 중앙값 × 시가총액 으로 주식 수를 추정(est 표시)
· 나스닥 스크리너: 전 종목 섹터·시가총액(회사 전체 — 여러 클래스 주식 포함)
· 위키백과 S&P 500 목록: GICS 섹터 (없으면 나스닥 섹터를 GICS 이름으로 바꿈)
결과: RAW/hold/<etf>/now-<기준일>.json (보유 내역과 같은 꼴 · form 'NOW') — 일별 PER 의 마지막 구간·실시간 바구니"""
import datetime as dt, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import fetch, jfetch, jload, jsave, rpath, log, xlsx_rows   # noqa: E402

SSGA = 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx'
NDX = 'https://api.nasdaq.com/api/quote/list-type/nasdaq100'
SCREENER = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true'
WIKI = 'https://en.wikipedia.org/w/index.php?title=List_of_S%26P_500_companies&action=raw'
NH = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/'}
MON = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}

GICS_KO = {'Information Technology': '정보기술', 'Health Care': '헬스케어', 'Financials': '금융', 'Consumer Discretionary': '경기소비재',
           'Communication Services': '커뮤니케이션', 'Industrials': '산업재', 'Consumer Staples': '필수소비재', 'Energy': '에너지',
           'Utilities': '유틸리티', 'Real Estate': '부동산', 'Materials': '소재'}
NAS2GICS = {'Technology': 'Information Technology', 'Telecommunications': 'Communication Services', 'Health Care': 'Health Care', 'Finance': 'Financials',
            'Consumer Discretionary': 'Consumer Discretionary', 'Consumer Staples': 'Consumer Staples', 'Industrials': 'Industrials', 'Energy': 'Energy',
            'Utilities': 'Utilities', 'Real Estate': 'Real Estate', 'Basic Materials': 'Materials'}
GICS_FIX = {   # S&P 500 밖 나스닥 100 종목(위키 목록에 없음) — 나스닥 섹터가 GICS 와 다른 회사
    'ASML': 'Information Technology', 'ARM': 'Information Technology', 'AZN': 'Health Care', 'PDD': 'Consumer Discretionary', 'MELI': 'Consumer Discretionary',
    'SHOP': 'Information Technology', 'CCEP': 'Consumer Staples', 'TRI': 'Industrials', 'TEAM': 'Information Technology', 'ZS': 'Information Technology',
    'MDB': 'Information Technology', 'GFS': 'Information Technology', 'BIDU': 'Communication Services', 'JD': 'Consumer Discretionary', 'NTES': 'Communication Services',
    'TCOM': 'Consumer Discretionary', 'LULU': 'Consumer Discretionary', 'MRVL': 'Information Technology', 'ROP': 'Information Technology', 'CTAS': 'Industrials',
    'PAYX': 'Industrials', 'ADP': 'Industrials', 'CPRT': 'Industrials', 'FAST': 'Industrials', 'ODFL': 'Industrials', 'PCAR': 'Industrials',
    'CSGP': 'Real Estate', 'DASH': 'Consumer Discretionary', 'ABNB': 'Consumer Discretionary', 'APP': 'Information Technology', 'AXON': 'Industrials',
    'DDOG': 'Information Technology', 'WDAY': 'Information Technology', 'TTD': 'Communication Services', 'PLTR': 'Information Technology', 'CRWD': 'Information Technology'}


def ytick(s):
    return (s or '').strip().upper().replace('.', '-').replace('/', '-')


def _num(x):
    try:
        return float(str(x).replace('$', '').replace(',', '').strip())
    except (TypeError, ValueError):
        return None


def spy_now():
    """→ {date, form:'NOW', rows:[{name, cusip, tick, sh, val(=비중 %), w}]}"""
    rows = xlsx_rows(fetch(SSGA, timeout=60))
    asof = None
    for r in rows[:6]:
        if r and str(r[0]).startswith('Holdings') and len(r) > 1:
            m = re.search(r'(\d{1,2})-([A-Za-z]{3})-(\d{4})', str(r[1]))
            if m:
                asof = '%s-%02d-%02d' % (m.group(3), MON[m.group(2).title()], int(m.group(1)))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == 'Name')
    h = rows[hi]
    ix = {k: h.index(k) for k in ('Name', 'Ticker', 'Identifier', 'Weight', 'Shares Held')}
    out = []
    for r in rows[hi + 1:]:
        if not r or len(r) <= ix['Shares Held'] or not r[ix['Name']]:
            continue
        w, sh, cu = _num(r[ix['Weight']]), _num(r[ix['Shares Held']]), str(r[ix['Identifier']] or '').strip().upper()
        t = ytick(r[ix['Ticker']])
        if not (w and sh and sh > 0 and t) or not re.fullmatch(r'[A-Z]{1,5}(-[A-Z])?', t):   # 현금·선물·권리(CVR 등 '2602335D') 제외
            continue
        out.append({'name': str(r[ix['Name']]).strip(), 'cusip': cu if len(cu) == 9 else None, 'tick': t, 'sh': sh, 'val': w, 'w': w})
    tw = sum(x['w'] for x in out)
    if not asof or len(out) < 480 or not 95 <= tw <= 101.5:
        raise RuntimeError('SPY 보유 내역 이상: %s 종목 %d 비중 합 %.1f' % (asof, len(out), tw))
    return {'etf': 'spy', 'date': asof, 'form': 'NOW', 'rows': out}


def ndx_now():
    """→ (기준일, [(티커, 이름, 시가총액, 가격)]) — 나스닥이 잠깐 빈 응답이면 몇 번 다시 · 그래도 안 되면 지난번 목록(RAW/ndx_list.json)"""
    import time
    d = None
    for i in range(4):
        try:
            d = (jfetch(NDX, headers=NH) or {}).get('data')
        except Exception as e:
            log('나스닥 100 목록 실패', e)
        if d and (d.get('data') or {}).get('rows'):
            break
        d = None
        time.sleep(5 * (i + 1))
    p = rpath('ndx_list.json')
    if d is None:
        o = jload(p)
        if not o:
            raise RuntimeError('나스닥 100 구성 종목을 받지 못함')
        log('나스닥 100 목록: 지난번 것', o[0])
        return o[0], [tuple(x) for x in o[1]]
    out = None
    m = re.match(r'([A-Za-z]{3}) (\d{1,2}), (\d{4})', d.get('date') or '')
    asof = '%s-%02d-%02d' % (m.group(3), MON[m.group(1)], int(m.group(2))) if m else dt.date.today().isoformat()
    out = [(ytick(r['symbol']), r.get('companyName') or '', _num(r.get('marketCap')), _num(r.get('lastSalePrice'))) for r in d['data']['rows']]
    if not 95 <= len(out) <= 110:
        raise RuntimeError('나스닥 100 구성 종목 수 이상: %d' % len(out))
    jsave(p, [asof, out])
    return asof, out


def qqq_now(last_nport, tick, pxat):
    """last_nport: 마지막 QQQ N-PORT · tick {cusip: 티커} · pxat(티커, 날짜) → 실제 종가
    → 보유 내역 꼴 {date, form:'NOW', rows:[{name, cusip, tick, sh, val, est?}]}"""
    asof, lst = ndx_now()
    by = {}
    for r in last_nport['rows']:
        t = tick.get(r.get('cusip'))
        if t:
            by[t] = r
    rows, ratios = [], []
    for t, nm, mc, p in lst:
        r = by.get(t)
        pr = pxat(t, asof) or p
        if r and pr:
            from prices import chart     # N-PORT 날 뒤 분할이 있으면 실제 주식 수도 그만큼 바뀜
            o = chart(t)
            f = 1.0
            for sd, k in (o or {}).get('s', []):
                if last_nport['date'] < sd <= asof:
                    f *= k
            sh = r['sh'] * f
            rows.append({'name': r['name'], 'cusip': r['cusip'], 'tick': t, 'sh': sh, 'val': sh * pr})
            if mc:
                ratios.append(sh * pr / mc)
        else:
            rows.append({'name': nm, 'cusip': None, 'tick': t, 'sh': None, 'val': None, '_mc': mc, '_p': pr})
    k = sorted(ratios)[len(ratios) // 2] if ratios else None
    for r in rows:
        if r['sh'] is None:
            if not (k and r.get('_mc') and r.get('_p')):
                raise RuntimeError('QQQ 새 종목 주식 수 추정 불가: %s' % r['tick'])
            r['val'] = r['_mc'] * k
            r['sh'] = r['val'] / r['_p']
            r['est'] = 1
        r.pop('_mc', None)
        r.pop('_p', None)
    return {'etf': 'qqq', 'date': asof, 'form': 'NOW', 'rows': rows, 'nport': last_nport['date']}


def screener():
    """{티커: (이름, 섹터(나스닥), 시가총액, 가격)}"""
    j = jfetch(SCREENER, headers=NH, timeout=60)
    out = {}
    for r in j['data']['rows']:
        out[ytick(r['symbol'])] = (r.get('name') or '', r.get('sector') or '', _num(r.get('marketCap')), _num(r.get('lastsale')))
    if len(out) < 3000:
        raise RuntimeError('나스닥 스크리너 종목 수 이상: %d' % len(out))
    return out


def gics():
    """위키백과 S&P 500 목록 → {티커: (GICS 섹터, 세부 산업, CIK)}"""
    t = fetch(WIKI).decode('utf-8', 'replace')
    i = t.find('id="constituents"')
    blk = t[i:t.find('\n|}', i)]
    out = {}
    for row in blk.split('\n|-')[1:]:
        cells = [c.strip() for c in re.split(r'\n\|\|?|\|\|', row) if c.strip()]
        if len(cells) < 7:
            continue
        m = re.search(r'\{\{\s*\w*Symbol\s*\|\s*([A-Za-z.\-]+)', cells[0])
        if not m:
            continue
        cik = re.search(r'(\d{10})', row)
        out[ytick(m.group(1))] = (cells[2], cells[3], int(cik.group(1)) if cik else None)
    if len(out) < 480:
        raise RuntimeError('위키 S&P 500 목록 이상: %d' % len(out))
    return out


def sector_of(t, G, S):
    g = (G.get(t) or (None,))[0] or GICS_FIX.get(t) or NAS2GICS.get((S.get(t) or ('', ''))[1])
    return GICS_KO.get(g, '기타')
