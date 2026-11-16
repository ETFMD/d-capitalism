#!/usr/bin/env python3
"""[USIDX] QQQ(나스닥 100)·SPY(S&P 500) 보유 내역 — SEC 공시
· 2019-09 이후: N-PORT(분기 · XML · 종목명·CUSIP·ISIN·주식 수·평가액)
· 그 전: 연간·반기 보고서 본문의 투자 명세(QQQ N-30B-2 = 매년 9월 말 · SPY N-30D = 3월·9월 말) — 종목명·주식 수·평가액만(CUSIP 없음 → ids.py 가 이름·가격으로 맞춤)
· 결과: RAW/hold/<etf>/<기준일>.json = {etf, date, form, acc, filed, rows:[{name, cusip?, isin?, sh, val}]}
  python3 scripts/usidx/holdings.py            # 없는 것만 받기
  python3 scripts/usidx/holdings.py --check    # 받은 것 요약(종목 수·평가액 합)"""
import datetime as dt, html, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D, fetch, jfetch, jload, jsave, rpath, log, RAW   # noqa: E402

ETFS = {'qqq': {'cik': 1067839, 'old': ('N-30B-2', 'N-30D', 'N-CSR', 'N-CSRS')},
        'spy': {'cik': 884394, 'old': ('N-30D', 'N-CSR', 'N-CSRS')}}
FIRST = '2011-03-31'      # 이보다 앞 기준일은 안 받음 (일별 PER 은 2012년부터)
NPORT_FROM = '2019-09-30'


def filings(etf):
    """[(form, reportDate, filed, acc, primaryDoc)] — 같은 기준일은 N-PORT 우선 · 같은 종류면 먼저 낸 것"""
    c = ETFS[etf]['cik']
    j = jfetch('https://data.sec.gov/submissions/CIK%010d.json' % c, 'sec')
    rows = []
    blocks = [j['filings']['recent']] + [jfetch('https://data.sec.gov/submissions/' + f['name'], 'sec') for f in j['filings'].get('files', [])]
    for f in blocks:
        for i in range(len(f['form'])):
            rows.append((f['form'][i], f['reportDate'][i], f['filingDate'][i], f['accessionNumber'][i], f['primaryDocument'][i]))
    pick = {}
    for form, rd, fd, acc, doc in sorted(rows, key=lambda r: r[2]):
        if form != 'NPORT-P' and rd and (D(fd) - D(rd)).days > 200:   # 기준일을 잘못 적은 보고서(SPY 2014-12-01 제출분이 2013-09-30 으로 적힘) → 제출일 45일 이상 앞의 마지막 3·9월 말
            d = D(fd) - dt.timedelta(days=45)
            rd = max(x for x in (dt.date(d.year, 3, 31), dt.date(d.year, 9, 30), dt.date(d.year - 1, 9, 30)) if x <= d).isoformat()
        if not rd or rd < FIRST:
            continue
        if form == 'NPORT-P':
            if rd >= NPORT_FROM:
                pick[rd] = (form, rd, fd, acc, doc)   # 같은 기준일 N-PORT 가 여러 번이면 나중 것(정정)
        elif form in ETFS[etf]['old'] and rd < NPORT_FROM and rd not in pick:
            pick[rd] = (form, rd, fd, acc, doc)
    return [pick[k] for k in sorted(pick)]


def parse_nport(x):
    out = []
    for blk in re.findall(r'<invstOrSec>(.*?)</invstOrSec>', x, re.S):
        g = lambda t: (re.search(r'<%s>(.*?)</%s>' % (t, t), blk, re.S) or [None, None])[1]
        cat, units = g('assetCat'), g('units')
        if cat not in ('EC', 'EP') or units != 'NS':   # 보통주(EC)·우선주(EP)만 · 주식 수 단위
            continue
        isin = re.search(r'<isin value="([^"]+)"', blk)
        out.append({'name': html.unescape(g('name') or g('title') or '').strip(), 'cusip': (g('cusip') or '').strip().upper(),
                    'isin': isin.group(1) if isin else None, 'sh': float(g('balance') or 0), 'val': float(g('valUSD') or 0)})
    return out


_NUM = re.compile(r'^\$?\s*\(?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\)?$')


def _toks(h):
    t = re.sub(r'(?is)<(script|style).*?</\1>', ' ', h)
    t = re.sub(r'(?i)<br\s*/?>|</(td|th|p|div|tr|font)>', '\n', t)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', t)).replace('\xa0', ' ')
    toks = [re.sub(r'\s+', ' ', x).strip() for x in t.split('\n')]
    return [x for x in toks if x and x != '$']


def _num(x):
    m = _NUM.match(x)
    return int(m.group(1).replace(',', '')) if m else None


def _clean(nm):
    return re.sub(r'(\s*\((?:[a-h]|\d)\))+\s*$', '', nm).strip()


def parse_old(h):
    """보고서 HTML → ([{name, sh, val}], 명세 합계)
    · 투자 명세 구간만: 'Common Stock(s)' 머리 ~ 'Total Investments'/'Total Common Stocks'
    · 줄 순서는 보고서마다 다름 — '이름 · 주식 수 · 평가액'(SPY·옛 QQQ) 또는 '주식 수 · 이름 · 평가액'(2016~2018 QQQ) → 둘 다 해 보고 맞는 줄이 많은 쪽
    · 이름이 두 덩어리로 갈라진 줄(T-Mobile / US, Inc.)은 이어 붙임 · 가격(평가액 ÷ 주식 수)이 0.2~20,000달러 밖이면 버림"""
    toks = _toks(h)
    st = None
    for i, x in enumerate(toks):
        if re.match(r'(?i)^common stocks?\b', x) and any(re.match(r'(?i)^(shares|number|of shares)', y) for y in toks[max(0, i - 4):i + 6]):
            st = i
            break
    if st is None:
        return [], None
    en, tot = len(toks), None
    for i in range(st, len(toks)):
        if re.match(r'(?i)^total (investments|common stocks?)\b', toks[i]):
            en = i
            for y in toks[i + 1:i + 5]:
                v = _num(y)
                if v and v > 1e6:
                    tot = v
                    break
            break
    T = toks[st:en]
    bad = re.compile(r'(?i)^(total|net assets|liabilities|other assets|investments|common stocks?|shares|value|number|of shares|security description)\b')

    def run(order):
        out, i = [], 0
        while i < len(T):
            if order == 'nsv':   # 이름 → 주식 수 → 평가액
                j = i
                while j < len(T) and j - i < 3 and _num(T[j]) is None:
                    j += 1
                if j == i or j + 1 >= len(T):
                    i += 1
                    continue
                nm, sh, val = ' '.join(T[i:j]), _num(T[j]), _num(T[j + 1])
                if sh and val and not bad.match(nm) and re.search(r'[A-Za-z]{2}', nm) and 0.2 <= val / sh <= 20000 and '%' not in nm:
                    out.append({'name': _clean(nm), 'sh': sh, 'val': val})
                    i = j + 2
                    continue
                i += 1
            else:                # 주식 수 → 이름 → 평가액
                sh = _num(T[i])
                if sh is None:
                    i += 1
                    continue
                j = i + 1
                while j < len(T) and j - i <= 3 and _num(T[j]) is None:
                    j += 1
                if j >= len(T) or j == i + 1:
                    i += 1
                    continue
                nm, val = ' '.join(T[i + 1:j]), _num(T[j])
                if sh and val and not bad.match(nm) and re.search(r'[A-Za-z]{2}', nm) and 0.2 <= val / sh <= 20000 and '%' not in nm:
                    out.append({'name': _clean(nm), 'sh': sh, 'val': val})
                    i = j + 1
                    continue
                i += 1
        return out

    best = max((run('nsv'), run('snv')), key=lambda r: (abs(sum(x['val'] for x in r) - tot) < 0.01 * tot if tot else 0, len(r)))
    return best, tot


def dedupe(rows):
    """같은 종목이 두 번(요약 표 + 전체 명세) 나오면 하나만 — 이름이 같고 주식 수가 같으면 같은 줄"""
    seen, out = set(), []
    for r in rows:
        k = (r['name'].upper(), round(r['sh']))
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def get(etf, f):
    form, rd, fd, acc, doc = f
    path = rpath('hold', etf, rd + '.json')
    old = jload(path)
    if old and old.get('acc') == acc and old.get('v') == 2:
        return old
    c = ETFS[etf]['cik']
    base = 'https://www.sec.gov/Archives/edgar/data/%d/%s/' % (c, acc.replace('-', ''))
    if form == 'NPORT-P':
        rows = parse_nport(fetch(base + 'primary_doc.xml', 'sec').decode('utf-8', 'replace'))
    else:
        rows, tot = parse_old(fetch(base + doc, 'sec').decode('latin-1', 'replace'))
        rows = dedupe(rows)
    o = {'v': 2, 'etf': etf, 'date': rd, 'form': form, 'acc': acc, 'filed': fd, 'rows': rows}
    if form != 'NPORT-P':
        o['total'] = tot   # 보고서의 'Total Investments' — 합과 비교(--check)
    jsave(path, o)
    log(etf, rd, form, len(rows), '종목', round(sum(r['val'] for r in rows) / 1e9, 2), '십억 달러')
    return o


def all_holdings(etf, refresh=True):
    fl = filings(etf) if refresh else []
    out = [get(etf, f) for f in fl]
    if not refresh:
        d = rpath('hold', etf, 'x')
        for n in sorted(os.listdir(os.path.dirname(d))):
            if n.endswith('.json'):
                out.append(jload(os.path.join(os.path.dirname(d), n)))
    return out


if __name__ == '__main__':
    for e in ETFS:
        for o in all_holdings(e, refresh='--check' not in sys.argv):
            sv = sum(r['val'] for r in o['rows'])
            print(e, o['date'], o['form'], o['filed'], len(o['rows']), round(sv / 1e9, 2), ('합계 %.2f · 차이 %.3f%%' % (o['total'] / 1e9, (sv / o['total'] - 1) * 100)) if o.get('total') else '')
