#!/usr/bin/env python3
"""[SEMIS] 실적 발표 자료(8-K 2.02 의 EX-99 보도자료 HTML) → 그 분기(·4분기면 그 해) 재무 숫자 — 정식 공시(10-Q·10-K XBRL) 전 '발표' 줄
· 손익계산서(STATEMENTS OF INCOME/OPERATIONS/EARNINGS) · 재무상태표(BALANCE SHEETS) · 현금흐름표(CASH FLOWS) 표를 찾아 항목 이름으로 줄을 고르고
  그 줄의 첫 숫자 = 이번 분기(3개월) · 4분기 보고서의 두 번째 묶음(12개월·회계연도) = 그 해
· 단위: 표 머리·바로 앞 글의 '(In millions …)' · '(in thousands …)' — 못 찾으면 쓰지 않음
· 검산(하나라도 틀리면 쓰지 않음 · 화면은 '재무 공시 대기'): 분기 끝 날짜 = 지난 분기 + 75~105일 · 매출 > 0 · |영업이익| ≤ 매출 ·
  희석 EPS × 희석 주식 수 ≈ 순이익(7% 안 — 열·단위가 맞는지) · 지난 분기와 매출 0.33~3배
  python3 scripts/semis/press.py <보도자료.htm> …   # 확인용"""
import datetime as dt, html as H, re, sys
from html.parser import HTMLParser

VERSION = 3           # 읽는 규칙이 바뀌면 올림 — 보관해 둔 읽은 결과(RAW/press)를 다시 만듦
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'])}
NUM = re.compile(r'^\(?-?\$?\s*\(?\d[\d,]*(\.\d+)?\)?$')


class _T(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack, self.cell, self.row, self.text = [], [], None, None, []

    def handle_starttag(self, tag, a):
        if tag == 'table':
            self.stack.append({'rows': [], 'pre': ' '.join(self.text[-40:])})
        elif tag == 'tr' and self.stack:
            self.row = []
        elif tag in ('td', 'th') and self.stack:
            self.cell = []
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' ')

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.stack and self.cell is not None and self.row is not None:
            self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'tr' and self.stack and self.row is not None:
            if any(self.row):
                self.stack[-1]['rows'].append(self.row)
            self.row = None
        elif tag == 'table' and self.stack:
            t = self.stack.pop()
            if self.stack:                       # 표 안의 표 — 바깥 표에 줄로 붙임
                self.stack[-1]['rows'].extend(t['rows'])
            else:
                self.tables.append(t)

    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)
        else:
            t = d.strip()
            if t:
                self.text.append(t)


def tables(doc):
    p = _T()
    p.feed(doc)
    return p.tables


def _li(row):
    """이름 칸 위치 — 앞의 빈 칸(들여쓰기) 건너뜀"""
    for i, c in enumerate(row):
        if c and c not in ('$',):
            return i
    return 0


def nums(row):
    """줄의 숫자들(괄호 = 음수 · '—' = 0) — 이름 칸 뒤"""
    out = []
    cells = [c for c in row[_li(row) + 1:] if c not in ('', '$', '%')]
    i = 0
    while i < len(cells):
        c = cells[i].replace('—', '—').replace('–', '—').strip()
        if c in ('—', '-', '— ', '–'):
            out.append(0.0)
        else:
            c2 = c.replace('$', '').replace(' ', '')
            if c2 == '(' and i + 1 < len(cells):                 # '(' '1,234' ')' 로 나뉜 칸
                c2 = '(' + cells[i + 1].replace('$', '').strip()
                i += 1
            if c2.endswith('(') or c2 == ')':
                i += 1
                continue
            neg = c2.startswith('(') or c2.startswith('-')
            c3 = c2.strip('()-').replace(',', '')
            if c3.endswith(')'):
                c3 = c3[:-1]
            try:
                v = float(c3)
                out.append(-v if neg else v)
            except ValueError:
                pass
        i += 1
    return out


def lab(row):
    c = row[_li(row)] if row else ''
    if NUM.match(c.replace(' ', '')):            # 이름 칸 없이 숫자로 시작 = 이름 없음
        return ''
    l = re.sub(r'\s+', ' ', H.unescape(c)).strip().lower().replace('’', "'").replace('\u2019', "'").replace('\u2014', '-').replace('\u2013', '-')
    l = re.sub(r'\s*\((\d|[a-z])\)\s*$', '', l.rstrip(':').strip())     # 각주 '(1)' '(a)'
    l = re.sub(r'(?<=[a-z\)])\d{1,2}$', '', l)                            # 각주 위첨자 'diluted1'
    return l.rstrip(':').strip()


KIND = [('is', re.compile(r'statements? of (consolidated )?(income|operations|earnings|comprehensive income)|income statements?|statements? of operations')),
        ('bs', re.compile(r'balance sheets?|statements? of financial position')),
        ('cf', re.compile(r'statements? of cash flows?|cash flows? statements?'))]


def kind_of(t, prev_pre=None):
    """표 종류 — 표 안 첫 몇 줄의 제목 → 없으면 표 바로 앞 글의 마지막 제목(앞 표와 사이에 새 글이 있을 때만)"""
    head = ' '.join(' '.join(r) for r in t['rows'][:6]).lower()
    for k, rx in KIND:
        if rx.search(head) and 'reconciliation' not in head:
            return k
    if prev_pre is not None and t['pre'] == prev_pre:     # 앞 표와 사이에 글이 없음 = 이어지는 표(부르는 쪽이 앞 표 종류로)
        return None
    pre = t['pre'][-220:].lower()
    best, pos = None, -1
    for k, rx in KIND:
        for m in rx.finditer(pre):
            if m.start() > pos:
                best, pos = k, m.start()
    if best and 'reconciliation' not in pre[max(0, pos - 80):] and not re.search(r'reconciliation|non-gaap|segment', pre[pos:]):
        return best
    return None


def scale_of(t):
    s = (' '.join(' '.join(r) for r in t['rows'][:10]) + ' ' + t['pre'][-260:]).lower()
    m = re.search(r'\b(millions|thousands|billions)\b', s)
    if not m:
        return None
    return {'thousands': 1e3, 'millions': 1e6, 'billions': 1e9}[m.group(1)]


MRX = r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?'


def _mon(x):
    return MONTHS.get(next((m for m in MONTHS if m.startswith(x.lower().rstrip('.')[:3])), ''), None)


def head_dates(t):
    """표 머리의 날짜들(열 순서) — 'October 25, 2026' · 'October 25,' + 다음 줄 '2026' · 'September 30,' + '2026' '2025'(같은 달·일)"""
    md, ys = [], []
    for r in t['rows'][:10]:
        txt = ' '.join(c for c in r if c)
        full = re.findall(MRX + r'\s+(\d{1,2})\s*,?\s*(\d{4})', txt, re.I)
        if full:
            out = []
            for m, d, y in full:
                try:
                    out.append(dt.date(int(y), _mon(m), int(d)).isoformat())
                except (ValueError, TypeError):
                    pass
            if out:
                return out
        part = re.findall(MRX + r'\s+(\d{1,2})\b', txt, re.I)
        if part and not md:
            md = part
            continue
        if md and not ys:
            yy = re.findall(r'\b(20\d\d)\b', txt)
            if yy and not re.search(MRX + r'\s+\d', txt, re.I):
                ys = yy
                break
    if md and ys:
        if len(md) == 1:
            md = md * len(ys)
        out = []
        for (m, d), y in zip(md, ys):
            try:
                out.append(dt.date(int(y), _mon(m), int(d)).isoformat())
            except (ValueError, TypeError):
                pass
        return out
    return []


def end_date(t):
    ds = head_dates(t)
    return ds[0] if ds else None


def groups(t):
    """머리의 기간 묶음 순서 — ['3m', '12m'] 등"""
    head = ' '.join(' '.join(r) for r in t['rows'][:10]).lower()
    out = []
    for m in re.finditer(r'(three|six|nine|twelve)[ -]months?|(thirteen|13|twenty-six|26|thirty-nine|39|fifty-two|52|fifty-three|53)[ -]weeks?|quarters? ended|\b(1st|2nd|3rd|4th|first|second|third|fourth) (qtr|quarter)|fiscal (year|years) ended|years? ended', head):
        g = m.group(0)
        k = '3m' if re.match(r'three|thirteen|13|quarter|1st|2nd|3rd|4th|first|second|third|fourth', g) else '6m' if re.match(r'six|twenty-six|26', g) else '9m' if re.match(r'nine|thirty-nine|39', g) else '12m'
        if not out or out[-1][0] != k:
            out.append((k, m.start()))
    return [k for k, _ in out]


RX = {
    'rev': re.compile(r"^(total )?(net )?(revenue|revenues|sales)( net)?$|^net (revenue|revenues|sales)$|^total (net )?(revenue|revenues|sales)$"),
    'oi': re.compile(r"^(total )?(operating income|income from operations|operating income \(loss\)|income \(loss\) from operations|operating profit|operating \(loss\) income|\(loss\) income from operations|loss from operations|operating loss)$"),
    'ni': re.compile(r"^net income( \(loss\))?$|^net \(loss\) income$|^net loss$|^net (income|earnings)( \(loss\))? attributable to [a-z].*|^net earnings( \(loss\))?$"),
    'intexp': re.compile(r"^interest expense(, net)?$"),
    'nci': re.compile(r"(attributable to|attributed to) non-?controlling interests?$|^less: net income( \(loss\))? attributable to non-?controlling"),
    'ni_c': re.compile(r"^net (income|earnings)( \(loss\))? (available|attributable) (for|to) [a-z0-9 .,&'-]*common (stockholders|shareholders)$"),
    'cogs': re.compile(r"^(total )?costs? of (revenues?|sales|goods sold|products sold)( expenses?)?$"),
    'rnd': re.compile(r"^research(,)? (and|&) development( expenses?)?$|^research, development and engineering( expenses?)?$"),
    'sga': re.compile(r"^(selling|sales), general(,)? and administrative( expenses?)?$"),
    'lcur': re.compile(r"^total current liabilities$"),
    'lnc': re.compile(r"^total non-?current liabilities$|^total long-term liabilities$"),
    'liab': re.compile(r"^total liabilities$"),
    'eq': re.compile(r"^total (stockholders|shareholders)'? ?equity$|^(stockholders|shareholders)'? ?equity$|^total (?!liabilities)[a-z0-9&.,' -]+ (stockholders|shareholders)'? ?equity$|^total equity attributable to [a-z].*$|^total (?!liabilities|equity|mezzanine|temporary|redeemable)[a-z0-9&.,' -]+ equity$"),
    'la': re.compile(r"^total liabilities and (stockholders|shareholders)'? ?equity$|^total liabilities and equity$|^total liabilities, .*equity$"),
    'eqt': re.compile(r"^total equity$"),
    'ocf': re.compile(r"^(net )?cash( flows?)? (provided|generated|used|from)[a-z() ,]* operating activities$|^(net )?cash( flows?)? (provided by|from|generated by|generated from) operations$|^cash flows? from operating activities$"),
    'div': re.compile(r"dividends? paid|dividend payments|^payments? (of|for) (cash )?dividends|^(cash )?dividends paid|^payment of dividends|^dividends$|dividends to (stockholders|shareholders)|^cash dividends"),
    'buy': re.compile(r"treasury stock purchases|purchases? of treasury stock|repurchases? (and retirements? )?of (common )?(stock|shares)|purchases? of (treasury|common) stock|common stock repurchases|payments? (for|related to) (the )?repurchases?|repurchase of common stock|share repurchases?|stock repurchases?|repurchases? of (ordinary|company) shares"),
}


def pick(rows, key, idx=0):
    cand = []
    for r in rows:
        l = lab(r)
        if key == 'buy' and ('withholding' in l or 'tax' in l and 'excise' not in l):   # 직원 주식 세금 원천징수분은 자사주 매입 아님
            continue
        if key in ('div', 'buy') and re.search(r'non-?controlling|preferred|subsidiar', l):
            continue
        if RX[key].search(l):
            v = nums(r)
            if len(v) > idx:
                cand.append((l, v[idx]))
    if not cand:
        return None
    if key == 'rev':
        tot = [c for c in cand if c[0].startswith('total')]
        return (tot or cand)[0][1]
    if key == 'ni':     # XBRL NetIncomeLoss 와 같게 = 지배주주 몫(비지배 지분 뺌) · 우선주 배당 빼기 전('보통주에 귀속' 줄 아님)
        att = [c for c in cand if 'attributable to' in c[0] and not re.search(r'non-?controlling|common|ordinary|participating', c[0])]
        plain = [c for c in cand if 'attributable to' not in c[0]]
        return (att or plain or cand)[0][1]
    if key == 'eq':     # 회사 이름이 든 '지배주주 자본 합계'가 따로 있으면 그것(비지배 지분 뺀 값)
        cand = [c for c in cand if not re.search(r'mezzanine|temporary|redeemable', c[0])] or cand
        named = [c for c in cand if re.match(r"^total (?!stockholders|shareholders|equity)", c[0]) or 'attributable to' in c[0]]
        return (named or cand)[0][1]
    return cand[0][1]


def diluted(rows, idx=0):
    """희석 EPS · 희석 주식 수 — 'Diluted' 줄이 두 번(주당 이익 · 가중평균 주식 수) · 이름에 '주식 수'가 들어간 줄"""
    eps, sh, sec = None, None, ''
    for r in rows:
        l = lab(r)
        v = nums(r)
        if not v:
            if l:
                sec = l
            continue
        if len(v) <= idx:
            continue
        sec_sh = 'shares' in sec or 'weighted' in sec or 'average' in sec or 'number of' in sec
        is_sh = ('diluted' in l and ('shares' in l or 'weighted' in l or 'average' in l or 'number of' in l)) or (l in ('diluted', 'diluted shares') and sec_sh)
        is_eps = not is_sh and (('diluted' in l and ('per share' in l or 'per common share' in l or 'per diluted share' in l or 'eps' in l or 'earnings' in l or l == 'diluted'))
                                or l in ('net income per diluted share', 'earnings per diluted share'))
        if is_sh and sh is None:
            sh = v[idx]
        elif is_eps and eps is None and abs(v[idx]) < 1000:
            eps = v[idx]
    return eps, sh


def parse(docs):
    """보도자료 HTML 여러 개(EX-99.1 · 99.2 …) → {'end', 'q': {...}, 'a': {...}|None, 'eps', 'dsh', 'why': [...]}"""
    out = {'q': {}, 'a': None, 'why': []}
    got = {}
    for doc in docs:
        prev_pre, cur = None, None          # cur = 지금 모으는 표 종류(이어지는 표는 같은 종류에 줄을 붙임)
        for t in tables(doc):
            k = kind_of(t, prev_pre)
            if k is None and cur and t['pre'] == prev_pre and cur in got and got[cur][0] is not None:
                got[cur][0]['rows'].extend(t['rows'])            # 앞 표의 이어짐(재무활동 현금흐름 등이 다음 표로)
                prev_pre = t['pre']
                continue
            prev_pre = t['pre']
            if not k or k in got:
                cur = None
                continue
            sc = scale_of(t)
            if not sc:
                cur = None
                continue
            g = groups(t) if k != 'bs' else ['bs']
            got[k] = ({'rows': list(t['rows']), 'pre': t['pre']}, sc, g)
            cur = k
    if 'is' not in got:
        out['why'].append('손익계산서 표 없음')
        return out
    t, sc, g = got['is']
    out['end'] = end_date(t)
    rows = t['rows']
    if g and g[0] != '3m':
        out['why'].append('손익계산서 첫 묶음이 3개월이 아님 %s' % g)
        return out
    q = out['q']
    for k in ('rev', 'oi', 'ni', 'intexp'):
        v = pick(rows, k)
        if v is not None:
            q[k] = abs(v) if k == 'intexp' else v
            q[k] *= sc
    # 순이익 = 지배주주 몫 — '회사에 귀속' 줄이 없고 비지배 지분 줄이 있으면 전체 − 비지배
    att = [r for r in rows if 'attributable to' in lab(r) and RX['ni'].search(lab(r)) and not re.search(r'non-?controlling|common', lab(r)) and nums(r)]
    nci = pick(rows, 'nci')
    if not att and nci is not None and q.get('ni') is not None:
        q['ni'] -= nci * sc
    nc = pick(rows, 'ni_c')
    if nc is not None:
        out['ni_c'] = nc * sc
    if 'oi' not in q and q.get('rev') is not None:
        c3 = [pick(rows, k) for k in ('cogs', 'rnd', 'sga')]
        if all(v is not None for v in c3):
            q['oi'] = q['rev'] - sum(abs(v) * sc for v in c3)
            q['oi_est'] = 1
    out['eps'], dsh = diluted(rows)
    if dsh is not None:
        out['dsh'] = dsh * sc
        if out['eps'] and q.get('ni'):
            r = (q['ni'] / out['dsh']) / out['eps']
            for f in (1e3, 1e-3, 1e6, 1e-6):           # 주식 수만 다른 단위(NXPI '천 주')
                if 0.85 <= r * f <= 1.15:
                    out['dsh'] /= f
                    break
    # 4분기: 두 번째 묶음이 12개월이면 그 해 — 첫 묶음의 열 수 = 매출 줄 숫자 수 ÷ 묶음 수
    a_idx = None
    if len(g) >= 2 and g[1] == '12m':
        hd = head_dates(t)
        if hd and hd.count(hd[0]) >= 2:
            a_idx = hd.index(hd[0], 1)
    if a_idx:
        a = {}
        for k in ('rev', 'oi', 'ni', 'intexp'):
            v = pick(rows, k, a_idx)
            if v is not None:
                a[k] = (abs(v) if k == 'intexp' else v) * sc
        out['a'] = a
        out['a_eps'], _ = diluted(rows, a_idx)
    if 'bs' in got:
        t2, sc2, _ = got['bs']
        if end_date(t2) == out['end']:
            for k in ('liab', 'eq', 'la', 'eqt', 'lcur', 'lnc'):
                v = pick(t2['rows'], k)
                if v is not None:
                    q[k] = v * sc2
            if 'eqt' not in q:
                gen = [nums(r)[0] for r in t2['rows'] if re.match(r"^total (stockholders|shareholders)'? ?equity$", lab(r)) and nums(r)]
                named = [r for r in t2['rows'] if re.match(r"^total (?!stockholders|shareholders|equity|liabilities)[a-z0-9&.,' -]+ (stockholders|shareholders)'? ?equity$", lab(r))]
                if gen and named:                 # 회사 몫 줄 + 일반 합계 줄 = 일반 합계가 비지배 포함 총계
                    q['eqt'] = gen[0] * sc2
            if 'eq' not in q and q.get('eqt') is not None:          # 지배·비지배 구분 없는 회사(마이크론 등) = 자본 총계
                q['eq'] = q['eqt']
            if 'liab' not in q and q.get('la') is not None and (q.get('eqt') if q.get('eqt') is not None else q.get('eq')) is not None:
                q['liab'] = q['la'] - (q['eqt'] if q.get('eqt') is not None else q['eq'])
            if 'liab' not in q and q.get('lcur') is not None and q.get('lnc') is not None:
                q['liab'] = q['lcur'] + q['lnc']
            q.pop('lcur', None)
            q.pop('lnc', None)
        else:
            out['why'].append('재무상태표 날짜 다름 %s' % end_date(t2))
    if 'cf' in got:
        t3, sc3, g3 = got['cf']
        if end_date(t3) == out['end'] and g3:
            rows3 = t3['rows']
            cf = {}
            for k in ('ocf', 'div', 'buy'):
                v = pick(rows3, k)
                if v is not None:
                    cf[k] = abs(v) * sc3 if k in ('div', 'buy') else v * sc3
            if g3[0] == '3m':
                q.update(cf)
                if a_idx and len(g3) >= 2 and g3[1] == '12m':
                    for k in ('ocf', 'div', 'buy'):
                        v = pick(rows3, k, a_idx)
                        if v is not None and out['a'] is not None:
                            out['a'][k] = abs(v) * sc3 if k in ('div', 'buy') else v * sc3
            else:
                out['cf_ytd'] = (g3[0], cf)        # 누적(6·9·12개월)만 — 부르는 쪽이 지난 분기 값을 빼서 이번 분기로
                if g3[0] == '12m' and out['a'] is not None:
                    out['a'].update(cf)
        else:
            out['why'].append('현금흐름표 날짜·기간 다름')
    return out


def check(p, prev_end, prev_rev=None):
    """쓰기 전 검산 — 통과 못 하면 이유 목록"""
    bad = []
    q = p.get('q') or {}
    e = p.get('end')
    if not e:
        return ['분기 끝 날짜 없음']
    if prev_end:
        n = (dt.date.fromisoformat(e) - dt.date.fromisoformat(prev_end)).days
        if not 75 <= n <= 105:
            bad.append('분기 간격 %d일' % n)
    if not q.get('rev') or q['rev'] <= 0:
        bad.append('매출 없음')
    elif q.get('oi') is not None and not (-10 * q['rev'] <= q['oi'] <= q['rev']):
        bad.append('영업이익이 매출보다 큼(또는 손실이 매출의 10배 넘음)')
    if q.get('ni') is None:
        bad.append('순이익 없음')
    if prev_rev and q.get('rev') and not 1 / 3 <= q['rev'] / prev_rev <= 3:
        bad.append('매출이 지난 분기의 %.2f배' % (q['rev'] / prev_rev))
    eps, dsh = p.get('eps'), p.get('dsh')
    if eps is None or not dsh:
        bad.append('희석 EPS·주식 수 없음(검산 불가)')
    elif q.get('ni') is not None:
        ok = False
        for ni in (q['ni'], p.get('ni_c')):        # 보통주 귀속 순이익(우선주 배당 뺀 값)으로 EPS 를 내는 회사
            if ni is not None and abs(ni / dsh - eps) <= max(0.02, abs(eps) * 0.07):     # 희석 분자 조정(전환사채 등)으로 몇 % 다를 수 있음 — 열·단위가 틀리면 훨씬 크게 다름
                ok = True
        if not ok:
            bad.append('순이익 ÷ 주식 수 %.3f ≠ 희석 EPS %.3f' % (q['ni'] / dsh, eps))
    a = p.get('a')
    if a and a.get('rev') and q.get('rev') and not a['rev'] >= q['rev']:
        bad.append('연간 매출 < 분기 매출')
    return bad


if __name__ == '__main__':
    import json
    for f in sys.argv[1:]:
        with open(f, encoding='utf-8', errors='replace') as fh:
            r = parse([fh.read()])
        print(f, json.dumps(r, ensure_ascii=False, default=str)[:900])
        print('  검산', check(r, None))
