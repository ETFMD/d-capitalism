#!/usr/bin/env python3
"""
실적발표 캘린더 — 코스피 시가총액 TOP 100 · 미국 상장 시가총액 TOP 100 (GitHub Actions 에서 2시간마다 · 표준 라이브러리만)

만드는 파일
  data/earnings.json     : 달력·목록용 요약 (기업별 다음 발표일·지난 발표일·PER 3종·핵심 지표 최신값)
  data/earnings_kr.json  : 국내 기업별 분기·연간 실적표 (억원)
  data/earnings_us.json  : 미국 기업별 분기·연간 실적표 (해당 통화 1억 단위)

자료
  국내  · 종목·시가총액·주가 ......... 네이버 증권 m.stock (코스피 시가총액 순 · ETF·우선주 제외)
        · 확정 실적발표(IR) 일정 ...... 네이버 증권 종목 통합 정보 irScheduleInfo
        · 지난 발표일·잠정실적 수치 ... 네이버 증권 공시 목록·본문 (거래소 공시 '영업(잠정)실적(공정공시)')
        · 분기·연간 재무·컨센서스 ...... 와이즈리포트(네이버 기업정보) 재무요약 cF1001 · 투자지표 cF4002
  미국  · 종목·시가총액 ............... companiesmarketcap.com (회사 단위 · 같은 회사 여러 주식은 하나) ∩ 나스닥 스크리너(미국 거래소 상장)
        · 발표일·시각·예상치·실적 ...... Yahoo Finance quote · quoteSummary · fundamentals-timeseries, 나스닥 실적 달력(장 전·장 후)
원칙
  · 받아 온 자료가 이상하면 그 부분은 직전 값을 그대로 둔다 (목록이 90개 미만이면 목록 전체를 직전 것으로)
  · 재무표(무거움)는 20시간이 지났거나 최근 4일 안에 실적을 발표한 기업만 다시 받는다 (실행마다 시간 예산 안에서)
"""
import csv, html, http.cookiejar, io, json, os, re, sys, time, datetime, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

KST, NY = ZoneInfo('Asia/Seoul'), ZoneInfo('America/New_York')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUT, OUT_KR, OUT_US = (os.path.join(ROOT, f) for f in ('earnings.json', 'earnings_kr.json', 'earnings_us.json'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
TOP = 100
STALE_H = 20                       # 재무표 다시 받는 간격(시간)
BUDGET = float(os.environ.get('EARN_BUDGET', '480'))   # 재무표 받기에 쓸 최대 시간(초)
T0 = time.time()
NOW_KST = datetime.datetime.now(KST)
TODAY = NOW_KST.date()
LOG = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    LOG.append(s); print(s, flush=True)


def fetch(url, headers=None, tries=3, timeout=30, opener=None):
    err = None
    h = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'}
    h.update(headers or {})
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404): break
            time.sleep(1.5 * (i + 1))
        except Exception as e:
            err = e; time.sleep(1.5 * (i + 1))
    raise err


def jget(url, **k):
    return json.loads(fetch(url, **k).decode('utf-8-sig', 'replace'))


def load(path, dflt=None):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception: return dflt


def save(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def num(s):
    """'1,234.5' · '9.82배' · '22,292원' · '-' · 'N/A' → float | None"""
    if s is None: return None
    if isinstance(s, (int, float)): return float(s) if s == s else None
    t = re.sub(r'[,\s원배%]', '', str(s))
    if t in ('', '-', 'N/A', 'NA', 'null'): return None
    try: return float(t)
    except ValueError: return None


def r2(x, d=2):
    return None if x is None else round(x, d)


def qend(d):
    """날짜 d 직전(그날 미포함)의 분기 말일"""
    y, m = d.year, d.month
    for qm in (12, 9, 6, 3):
        e = datetime.date(y, qm, 31 if qm in (3, 12) else 30)
        if e < d: return e
    return datetime.date(y - 1, 12, 31)


def add_months(pe, n):
    """분기 말일 pe 에서 n 개월 뒤 말일"""
    m = pe.month - 1 + n
    y, m = pe.year + m // 12, m % 12 + 1
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return nxt - datetime.timedelta(days=1)


def pkey(d):
    return '%04d.%02d' % (d.year, d.month)


# ══════════════════════════════ 국내 ══════════════════════════════
NV = 'https://m.stock.naver.com/api'
WR = 'https://navercomp.wisereport.co.kr/v2/company/'
PREF_RE = re.compile(r'(\d?우[A-C]?|우\(전환\))$')


def kr_universe():
    out = []
    for page in range(1, 6):
        d = jget(NV + '/stocks/marketValue/KOSPI?page=%d&pageSize=100' % page)
        for s in d.get('stocks') or []:
            c, n = s.get('itemCode') or '', (s.get('stockName') or '').strip()
            if s.get('stockEndType') != 'stock' or not c or not n: continue
            if not c.endswith('0') or PREF_RE.search(n) or '스팩' in n: continue     # 우선주·스팩 제외 (보통주 코드는 0 으로 끝남)
            mv = num(s.get('marketValue'))
            if not mv: continue
            out.append({'c': c, 'n': n, 'm': mv * 1e8, 'p': num(s.get('closePrice')), 'ch': num(s.get('fluctuationsRatio')),
                        'ts': s.get('localTradedAt')})
            if len(out) >= TOP + 10: break
        if len(out) >= TOP + 10: break
    out.sort(key=lambda x: -x['m'])      # 네이버 목록 순서는 받은 시각 차이로 조금 어긋날 수 있어 받은 시가총액으로 다시 줄 세움
    return out[:TOP]


def kr_info(c):
    """종목 통합 정보 → IR 일정 · PER/EPS(후행·추정) · PBR"""
    d = jget(NV + '/stock/%s/integration' % c)
    ti = {x.get('code'): x.get('value') for x in d.get('totalInfos') or []}
    ir = d.get('irScheduleInfo') or None
    return {'ir': {'d': ir.get('irScheduleDate'), 't': ir.get('title')} if ir and ir.get('irScheduleDate') else None,
            'per': num(ti.get('per')), 'eps': num(ti.get('eps')), 'cper': num(ti.get('cnsPer')), 'ceps': num(ti.get('cnsEps')),
            'pbr': num(ti.get('pbr')), 'bps': num(ti.get('bps'))}


PRE_RE = re.compile(r'영업\(잠정\)실적')
ANN_RE = re.compile(r'매출액또는손익구조')
def kr_disclosures(c, pages=1, size=100, until=None):
    """실적 공시만: 영업(잠정)실적(분기·월간 섞임 — 월간은 뒤에서 본문 기간으로 거름) · 매출액또는손익구조 변경(연간 결산)"""
    out = []
    for p in range(1, pages + 1):
        d = jget(NV + '/stock/%s/disclosure?page=%d&pageSize=%d' % (c, p, size))
        if not isinstance(d, list) or not d: break
        out += d
        if until and d[-1].get('datetime', '')[:10] < until: break
    res = []
    for x in out:
        t = x.get('title') or ''
        pre = PRE_RE.search(t) and '전망' not in t
        ann = ANN_RE.search(t) and '자회사' not in t
        if pre or ann:
            e = {'id': x.get('disclosureId'), 'd': (x.get('datetime') or '')[:10], 'tm': (x.get('datetime') or '')[11:16],
                 'fix': '(정정)' in t}
            if ann: e['ann'] = 1; e['q'] = 1                # 연간 결산(4분기 포함) 공시
            elif '연결재무제표기준' in t: e['q'] = 1        # 연결 잠정실적 = 분기 실적
            res.append(e)
    return res


def kr_doc(c, did):
    """공시 본문 표 → 줄 목록"""
    d = jget(NV + '/stock/%s/disclosure/%s' % (c, did))
    h = (d.get('disclosure') or {}).get('contents') or ''
    return [[re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', td))).strip() for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
            for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', h, re.S)]


def kr_period_days(rows):
    for r in rows:
        if r and r[0] == '당기실적' and len(r) >= 4 and re.match(r'\d{4}-\d\d-\d\d$', r[1]) and re.match(r'\d{4}-\d\d-\d\d$', r[3]):
            return (datetime.date.fromisoformat(r[3]) - datetime.date.fromisoformat(r[1])).days
    return None
    return res


UNIT = {'조원': 1e4, '억원': 1, '백만원': 1e-2, '천원': 1e-5, '원': 1e-8}
def kr_prelim(c, did, rows=None):
    """잠정실적 공시 본문 → {pe, rev, op, ni, revY, opY} (억원 · 당해 분기)"""
    rows = rows if rows is not None else kr_doc(c, did)
    res, unit = {}, None
    for r in rows:
        if r and r[0] == '당기실적' and len(r) >= 4 and re.match(r'\d{4}-\d\d-\d\d$', r[3]): res['pe'] = r[3]
        for cell in r:
            m = re.search(r'단위\s*:\s*(조원|억원|백만원|천원|원)', cell)
            if m and unit is None: unit = UNIT[m.group(1)]
        if len(r) >= 7 and r[1] == '당해실적':
            k = {'매출액': 'rev', '영업수익': 'rev', '수익(매출액)': 'rev', '영업이익': 'op', '당기순이익': 'ni'}.get(r[0].replace(' ', ''))
            if k and k not in res:
                v, vy = num(r[2]), num(r[6]) if len(r) > 6 else None
                if v is not None and unit is not None:
                    res[k] = round(v * unit, 2)
                    if vy is not None: res[k + 'Y'] = round(vy * unit, 2)
    return res if res.get('pe') and unit is not None and ('rev' in res or 'op' in res) else None


def _wr(url, ref):
    return fetch(url, headers={'Referer': ref, 'X-Requested-With': 'XMLHttpRequest'}).decode('utf-8', 'replace')


ENC = {'v': None}
def wr_enc(c):
    t = _wr(WR + 'c1010001.aspx?cmp_cd=%s' % c, 'https://navercomp.wisereport.co.kr/')
    m = re.search(r"encparam\s*:\s*'([^']+)'", t)
    if m: ENC['v'] = m.group(1)
    return ENC['v']


def _plabel(s):
    """'2026/09(E) (IFRS연결)' → ('2026.09', True)"""
    m = re.search(r'(\d{4})/(\d{2})(\(E\))?', s)
    return (m.group(1) + '.' + m.group(2), bool(m.group(3))) if m else (None, False)


F1 = {'매출액': 'rev', '영업이익(발표기준)': 'op', '영업이익': 'adjop', '당기순이익(지배)': 'ni', 'EPS(원)': 'eps', '영업활동현금흐름': 'ocf',
      'CAPEX': 'capex', 'FCF': 'fcf', '영업이익률': 'opm', '부채비율': 'debt', 'ROE(%)': 'roe', 'PER(배)': 'per', 'PBR(배)': 'pbr',
      '부채총계': 'liab', '자본총계': 'eq', '현금DPS(원)': 'dps'}
F4 = {1: {'EBITDA': 'ebitda', 'ROIC': 'roic'}, 3: {'유동비율': 'cur', '당좌비율': 'quick', '이자보상배율': 'icr'}, 5: {'EV/EBITDA': 'eveb', 'EV': 'ev'}}


def wr_cf1001(c, freq):
    url = WR + 'ajax/cF1001.aspx?cmp_cd=%s&fin_typ=0&freq_typ=%s&encparam=%s' % (c, freq, ENC['v'])
    t = _wr(url, WR + 'c1010001.aspx?cmp_cd=%s' % c)
    heads = [_plabel(re.sub(r'<[^>]+>|&nbsp;|\s+', ' ', x)) for x in re.findall(r'<th[^>]*>(.*?)</th>', t, re.S)]
    heads = [h for h in heads if h[0]]
    if not heads: return None
    seen, cols = set(), []
    for h in heads:
        if h[0] not in seen: seen.add(h[0]); cols.append(h)
    v = {}
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        th, td = re.findall(r'<th[^>]*>(.*?)</th>', tr, re.S), re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
        if not th or not td: continue
        name = re.sub(r'<[^>]+>|&nbsp;|\s', '', th[0])
        k = F1.get(name)
        if k and k not in v:
            v[k] = [num(re.sub(r'<[^>]+>|&nbsp;|\s', '', x)) for x in td[:len(cols)]]
    return {'p': [c_[0] for c_ in cols], 'e': [1 if c_[1] else 0 for c_ in cols], 'v': v}


def wr_cf4002(c, rpt, freq):
    q = urllib.parse.urlencode({'cmp_cd': c, 'frq': freq, 'rpt': rpt, 'finGubun': 'MAIN', 'frqTyp': freq, 'cn': '', 'encparam': ENC['v']})
    t = _wr(WR + 'cF4002.aspx?' + q, WR + 'c1040001.aspx?cmp_cd=%s' % c)
    d = json.loads(t.lstrip('﻿')) if t.strip() else None
    if not d or not d.get('YYMM'): return {}
    labels = [_plabel(x)[0] for x in d['YYMM']]
    out = {}
    for row in d.get('DATA') or []:
        nm = re.sub(r'\s', '', row.get('ACC_NM') or '')
        k = F4[rpt].get(nm) or (F4[rpt].get(nm.split('＜')[0]) if '＜' in nm else None)
        if not k or k in out: continue
        vals = {}
        for i, lb in enumerate(labels):
            if lb: vals[lb] = row.get('DATA%d' % (i + 1))
        out[k] = vals
    return out


def kr_fin(c):
    if not ENC['v']: wr_enc(c)
    res = {}
    for freq, f4 in (('Q', '1'), ('Y', '0')):
        t = None
        for attempt in range(2):
            t = wr_cf1001(c, freq)
            if t: break
            wr_enc(c)                                   # 비어 있으면 그 회사 화면으로 encparam 다시 받기
        if not t: return None
        for rpt in (1, 3, 5):
            try: ex = wr_cf4002(c, rpt, f4)
            except Exception: ex = {}
            for k, vals in ex.items():
                t['v'][k] = [r2(num(vals.get(p)), 2) for p in t['p']]
        if freq == 'Q' and t['v'].get('eveb'):    # 분기 EV/EBITDA 는 그 분기 EBITDA 하나로 나눈 값 → 1년 기준(÷4)으로 맞춤
            t['v']['eveb'] = [None if x is None else x / 4 for x in t['v']['eveb']]
        if freq == 'Q' and t['v'].get('roic'):    # 와이즈리포트 분기 ROIC 는 그 분기 NOPLAT ÷ 투하자본(연환산 아님) → ×4
            t['v']['roic'] = [None if x is None else x * 4 for x in t['v']['roic']]
        for k in list(t['v']):
            t['v'][k] = [None if x is None else round(x, 2) for x in t['v'][k]]
        res['q' if freq == 'Q' else 'y'] = t
    return res


# ══════════════════════════════ 미국 ══════════════════════════════
CMC = 'https://companiesmarketcap.com/?download=csv'
US_KO = {'NVDA': '엔비디아', 'AAPL': '애플', 'GOOG': '알파벳(구글)', 'GOOGL': '알파벳(구글)', 'MSFT': '마이크로소프트', 'AMZN': '아마존', 'TSM': 'TSMC',
    'SPCX': '스페이스X', 'META': '메타(페이스북)', 'AVGO': '브로드컴', 'TSLA': '테슬라', 'BRK-B': '버크셔 해서웨이', 'LLY': '일라이 릴리', 'MU': '마이크론 테크놀로지',
    'AMD': 'AMD', 'WMT': '월마트', 'JPM': 'JP모건 체이스', 'V': '비자', 'XOM': '엑슨모빌', 'ASML': 'ASML', 'JNJ': '존슨앤드존슨', 'MA': '마스터카드', 'INTC': '인텔',
    'ABBV': '애브비', 'PLTR': '팔란티어', 'CSCO': '시스코', 'CVX': '셰브론', 'COST': '코스트코', 'ORCL': '오라클', 'KO': '코카콜라', 'PG': 'P&G(프록터앤드갬블)',
    'MRK': '머크', 'BAC': '뱅크오브아메리카', 'LRCX': '램리서치', 'UNH': '유나이티드헬스', 'AMAT': '어플라이드 머티어리얼즈', 'CAT': '캐터필러', 'DELL': '델 테크놀로지스',
    'HSBC': 'HSBC', 'PM': '필립모리스', 'GE': 'GE 에어로스페이스', 'PANW': '팔로알토 네트웍스', 'HD': '홈디포', 'NFLX': '넷플릭스', 'SHEL': '셸', 'MS': '모건스탠리',
    'NVS': '노바티스', 'SAP': 'SAP', 'BABA': '알리바바', 'RY': '캐나다 왕립은행(RBC)', 'MUFG': '미쓰비시UFJ 파이낸셜', 'TXN': '텍사스 인스트루먼트', 'GS': '골드만삭스',
    'CRWD': '크라우드스트라이크', 'ARM': 'ARM 홀딩스', 'RTX': 'RTX', 'AZN': '아스트라제네카', 'GEV': 'GE 버노바', 'TMO': '써모피셔 사이언티픽', 'ANET': '아리스타 네트웍스',
    'TM': '도요타', 'WFC': '웰스파고', 'KLAC': 'KLA', 'AMGN': '암젠', 'LIN': '린데', 'SHOP': '쇼피파이', 'MRVL': '마벨 테크놀로지', 'IBM': 'IBM', 'BHP': 'BHP 그룹',
    'AXP': '아메리칸 익스프레스', 'C': '씨티그룹', 'SNDK': '샌디스크', 'APH': '암페놀', 'TTE': '토탈에너지스', 'ADI': '아날로그 디바이스', 'CRM': '세일즈포스', 'SAN': '산탄데르',
    'TD': 'TD 은행', 'GILD': '길리어드 사이언스', 'DIS': '디즈니', 'VZ': '버라이즌', 'QCOM': '퀄컴', 'ABT': '애보트', 'PEP': '펩시코', 'DE': '디어앤드컴퍼니(존디어)',
    'COP': '코노코필립스', 'UNP': '유니언 퍼시픽', 'TMUS': 'T-모바일 US', 'NVO': '노보 노디스크', 'MCD': '맥도날드', 'SCCO': '서던 코퍼', 'SCHW': '찰스 슈왑',
    'WELL': '웰타워', 'PBR': '페트로브라스', 'PFE': '화이자', 'BLK': '블랙록', 'NEE': '넥스트에라 에너지', 'STX': '시게이트 테크놀로지', 'ETN': '이튼', 'DHR': '다나허',
    'SMFG': '미쓰이스미토모 파이낸셜', 'T': 'AT&T', 'TJX': 'TJX', 'BUD': 'AB 인베브', 'ISRG': '인튜이티브 서지컬', 'UBS': 'UBS', 'BBVA': 'BBVA', 'BA': '보잉',
    'NOW': '서비스나우', 'SONY': '소니그룹', 'ACN': '액센츄어', 'UBER': '우버', 'UL': '유니레버', 'MPC': '마라톤 페트롤리엄', 'WDC': '웨스턴 디지털', 'ADBE': '어도비',
    'INTU': '인튜이트', 'BX': '블랙스톤', 'BKNG': '부킹 홀딩스', 'SPGI': 'S&P 글로벌', 'HON': '허니웰', 'LMT': '록히드마틴', 'BSX': '보스턴 사이언티픽', 'SYK': '스트라이커',
    'LOW': '로우스', 'HDB': 'HDFC 은행', 'INFY': '인포시스', 'IBN': 'ICICI 은행', 'BP': 'BP', 'RIO': '리오틴토', 'ENB': '엔브리지', 'VRTX': '버텍스 파마슈티컬스',
    'MELI': '메르카도리브레', 'APP': '앱러빈', 'COIN': '코인베이스', 'HOOD': '로빈후드', 'SPOT': '스포티파이', 'CMCSA': '컴캐스트', 'MDT': '메드트로닉',
    'BMY': 'BMS(브리스톨마이어스스퀴브)', 'NKE': '나이키', 'PGR': '프로그레시브', 'CB': '처브', 'KKR': 'KKR', 'PDD': 'PDD 홀딩스(테무)', 'NTES': '넷이즈', 'JD': 'JD닷컴',
    'SE': '씨(Sea)', 'CEG': '컨스텔레이션 에너지', 'VRT': '버티브', 'MSTR': '스트래티지', 'SNPS': '시놉시스', 'CDNS': '케이던스', 'RACE': '페라리', 'CVS': 'CVS 헬스',
    'MO': '알트리아', 'SBUX': '스타벅스', 'UPS': 'UPS', 'GD': '제너럴 다이내믹스', 'NOC': '노스럽 그러먼', 'PH': '파커 하니핀', 'MMM': '3M', 'ADP': 'ADP', 'PLD': '프롤로지스',
    'AMT': '아메리칸 타워', 'ICE': '인터컨티넨탈 익스체인지', 'CME': 'CME 그룹', 'MCO': '무디스', 'ZTS': '조에티스', 'REGN': '리제네론', 'ELV': '엘레번스 헬스', 'CI': '시그나',
    'SO': '서던 컴퍼니', 'DUK': '듀크 에너지', 'WM': '웨이스트 매니지먼트', 'EQIX': '에퀴닉스', 'KMI': '킨더 모건', 'WMB': '윌리엄스', 'EOG': 'EOG 리소시스', 'SLB': 'SLB(슐럼버거)',
    'FCX': '프리포트 맥모란', 'NEM': '뉴몬트', 'ABNB': '에어비앤비', 'DASH': '도어대시', 'NET': '클라우드플레어', 'SNOW': '스노우플레이크', 'DDOG': '데이터독', 'FTNT': '포티넷',
    'ORLY': '오라일리 오토모티브', 'AZO': '오토존', 'CTAS': '신타스', 'HCA': 'HCA 헬스케어', 'MCK': '맥케슨', 'COR': '센코라', 'CL': '콜게이트', 'MDLZ': '몬델리즈',
    'USB': 'US 뱅코프', 'PNC': 'PNC 파이낸셜', 'COF': '캐피털 원', 'APO': '아폴로', 'MMC': '마시 맥레넌', 'AON': '에이온', 'TRV': '트래블러스', 'ALL': '올스테이트',
    'EMR': '에머슨', 'ITW': '일리노이 툴 웍스', 'CSX': 'CSX', 'NSC': '노퍽 서던', 'FDX': '페덱스', 'GM': 'GM', 'F': '포드', 'RCL': '로열 캐리비안', 'MAR': '메리어트',
    'HLT': '힐튼', 'CMG': '치폴레', 'TGT': '타깃', 'KR': '크로거', 'LULU': '룰루레몬', 'TT': '트레인 테크놀로지스', 'JCI': '존슨 컨트롤즈', 'CARR': '캐리어', 'HWM': '하우멧',
    'TDG': '트랜스다임', 'LHX': 'L3해리스', 'MSI': '모토로라 솔루션스', 'KDP': '큐리그 닥터페퍼', 'MNST': '몬스터 베버리지', 'AJG': '아서 J. 갤러거', 'BK': 'BNY',
    'ROP': '로퍼 테크놀로지스', 'ECL': '이콜랩', 'SHW': '셔윈윌리엄스', 'APD': '에어프로덕츠', 'WDAY': '워크데이', 'TEAM': '아틀라시안', 'ADSK': '오토데스크',
    'NXPI': 'NXP 반도체', 'MCHP': '마이크로칩', 'ON': '온세미', 'CRH': 'CRH', 'CPRT': '코파트', 'PCAR': '파카', 'RSG': '리퍼블릭 서비스', 'AEP': '아메리칸 일렉트릭 파워',
    'SRE': '셈프라', 'D': '도미니언 에너지', 'EXC': '엑셀론', 'VST': '비스트라', 'O': '리얼티 인컴', 'SPG': '사이먼 프로퍼티', 'PSA': '퍼블릭 스토리지', 'DLR': '디지털 리얼티',
    'CCI': '크라운 캐슬', 'PSX': '필립스 66', 'VLO': '발레로', 'OXY': '옥시덴탈', 'HES': '헤스', 'GLW': '코닝', 'TEL': 'TE 커넥티비티', 'IT': '가트너', 'FI': '파이서브',
    'PYPL': '페이팔', 'SQ': '블록', 'XYZ': '블록', 'RBLX': '로블록스', 'EA': '일렉트로닉 아츠', 'TTWO': '테이크투', 'WBD': '워너 브러더스 디스커버리', 'CHTR': '차터',
    'MET': '메트라이프', 'AIG': 'AIG', 'PRU': '프루덴셜', 'AFL': '애플랙', 'HUM': '휴매나', 'IDXX': '아이덱스', 'EW': '에드워즈 라이프사이언스', 'GEHC': 'GE 헬스케어',
    'BDX': '벡톤 디킨슨', 'A': '애질런트', 'IQV': '아이큐비아', 'DXCM': '덱스컴', 'RMD': '레스메드', 'KHC': '크래프트 하인즈', 'GIS': '제너럴 밀스', 'HSY': '허쉬',
    'STZ': '컨스텔레이션 브랜즈', 'KMB': '킴벌리클라크', 'EL': '에스티로더', 'DG': '달러 제너럴', 'DLTR': '달러 트리', 'ROST': '로스 스토어스', 'YUM': '얌 브랜즈',
    'DHI': 'D.R. 호튼', 'LEN': '레나', 'NUE': '뉴코어', 'URI': '유나이티드 렌털스', 'FAST': '패스널', 'GWW': 'W.W. 그레인저', 'ODFL': '올드 도미니언', 'AXON': '액손',
    'FICO': 'FICO', 'MPWR': '모놀리식 파워', 'ALAB': '아스테라 랩스', 'CIEN': '시에나', 'COHR': '코히어런트', 'CRWV': '코어위브', 'NBIS': '네비우스', 'RDDT': '레딧',
    'SMCI': '슈퍼마이크로', 'TER': '테라다인', 'KEYS': '키사이트', 'FLEX': '플렉스', 'JBL': '자빌', 'CLS': '셀레스티카', 'CSGP': '코스타 그룹', 'ZS': '지스케일러',
    'HPE': 'HPE', 'HPQ': 'HP', 'NTAP': '넷앱', 'PSTG': '퓨어 스토리지', 'CCJ': '카메코', 'OKLO': '오클로', 'IONQ': '아이온큐', 'RKLB': '로켓랩', 'ASTS': 'AST 스페이스모바일',
    'TSCO': '트랙터 서플라이', 'CVNA': '카바나', 'EBAY': '이베이', 'ETSY': '엣시', 'ZM': '줌', 'OKTA': '옥타', 'MDB': '몽고DB', 'HUBS': '허브스팟', 'VEEV': '비바 시스템스',
    'ARES': '아레스', 'IBKR': '인터랙티브 브로커스', 'NDAQ': '나스닥', 'MSCI': 'MSCI', 'FIS': 'FIS', 'GPN': '글로벌 페이먼츠', 'WTW': '윌리스 타워스 왓슨', 'TRGP': '타르가'}
SECTOR_KO = {'Technology': '기술', 'Health Care': '헬스케어', 'Finance': '금융', 'Consumer Discretionary': '소비재', 'Consumer Staples': '필수소비재', 'Industrials': '산업재',
             'Energy': '에너지', 'Telecommunications': '통신', 'Utilities': '유틸리티', 'Real Estate': '부동산', 'Basic Materials': '소재', 'Miscellaneous': '기타'}


def us_listed():
    """나스닥 스크리너 → 미국 거래소(나스닥·NYSE·AMEX) 상장 기호 {기호: (이름, 섹터, 국가)}"""
    d = jget('https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&offset=0&download=true', headers={'Accept': 'application/json'})
    out = {}
    for r in (d.get('data') or {}).get('rows') or []:
        s = (r.get('symbol') or '').strip().replace('/', '-')
        if s: out[s] = (r.get('name') or '', r.get('sector') or '', r.get('country') or '')
    return out


def us_universe():
    listed = us_listed()
    if len(listed) < 3000: raise RuntimeError('나스닥 스크리너 행 부족 %d' % len(listed))
    text = fetch(CMC).decode('utf-8', 'replace')
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try: m, p = float(r['marketcap']), float(r['price (USD)'])
        except (KeyError, ValueError): continue
        s = (r.get('Symbol') or '').strip()
        if m <= 0 or not s or s not in listed: continue
        nm, sec, cty = listed[s]
        rows.append({'s': s, 'n': html.unescape(r['Name']).strip(), 'm': m, 'p': p, 'cty': (r.get('country') or cty or '').strip(),
                     'sec': SECTOR_KO.get(sec, sec or '')})
    rows.sort(key=lambda x: -x['m'])
    return rows[:TOP]


class Yahoo:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self.crumb = None
        for u in ('https://fc.yahoo.com', 'https://finance.yahoo.com/'):
            try: fetch(u, opener=self.op, tries=1, timeout=20)
            except Exception: pass
            try:
                self.crumb = fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', opener=self.op, tries=2).decode().strip()
                if self.crumb and '<' not in self.crumb: break
            except Exception: self.crumb = None
        if not self.crumb: raise RuntimeError('Yahoo crumb 실패')

    def get(self, url):
        sep = '&' if '?' in url else '?'
        return json.loads(fetch(url + sep + 'crumb=' + urllib.parse.quote(self.crumb), opener=self.op).decode('utf-8', 'replace'))

    def quotes(self, syms):
        out = {}
        for i in range(0, len(syms), 50):
            d = self.get('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + urllib.parse.quote(','.join(syms[i:i + 50]), safe=','))
            for q in (d.get('quoteResponse') or {}).get('result') or []: out[q.get('symbol')] = q
        return out

    def summary(self, s):
        mods = 'calendarEvents,earningsHistory,earningsTrend,defaultKeyStatistics,financialData,earnings'
        d = self.get('https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=%s' % (urllib.parse.quote(s), mods))
        r = (d.get('quoteSummary') or {}).get('result') or []
        return r[0] if r else None

    def series(self, s):
        T = ['TotalRevenue', 'OperatingIncome', 'TotalOperatingIncomeAsReported', 'EBITDA', 'NetIncomeCommonStockholders', 'DilutedEPS',
             'OperatingCashFlow', 'CapitalExpenditure', 'FreeCashFlow', 'TotalLiabilitiesNetMinorityInterest', 'StockholdersEquity',
             'CurrentAssets', 'CurrentLiabilities', 'Inventory', 'InterestExpense', 'InvestedCapital', 'TaxRateForCalcs']
        ty = ','.join(['quarterly' + t for t in T] + ['annual' + t for t in T])
        d = json.loads(fetch('https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/%s?symbol=%s&type=%s&period1=1420070400&period2=%d'
                             % (urllib.parse.quote(s), urllib.parse.quote(s), ty, int(time.time()) + 86400), opener=self.op).decode())
        out = {'q': {}, 'y': {}}
        cur = None
        for r in (d.get('timeseries') or {}).get('result') or []:
            t = (r.get('meta') or {}).get('type', [''])[0]
            f = 'q' if t.startswith('quarterly') else 'y'
            k = t[len('quarterly'):] if f == 'q' else t[len('annual'):]
            for x in r.get(t) or []:
                if not x or not x.get('asOfDate'): continue
                v = (x.get('reportedValue') or {}).get('raw')
                if v is None: continue
                out[f].setdefault(x['asOfDate'], {})[k] = v
                cur = cur or x.get('currencyCode')
        out['cur'] = cur
        return out


def raw(o, *ks):
    for k in ks:
        if not isinstance(o, dict): return None
        o = o.get(k)
    if isinstance(o, dict): o = o.get('raw')
    return o if isinstance(o, (int, float)) else None


def nasdaq_times(days=45):
    """앞으로 days 일의 나스닥 실적 달력 → {(기호, 날짜): 'bmo'|'amc'|None}"""
    out = {}
    d0 = datetime.datetime.now(NY).date()
    bad = 0
    for i in range(-3, days):
        if bad >= 3: log('나스닥 달력 연속 실패 — 나머지 날짜는 건너뜀 (야후 시각으로 대신)'); break
        d = d0 + datetime.timedelta(days=i)
        if d.weekday() >= 5: continue
        try:
            j = jget('https://api.nasdaq.com/api/calendar/earnings?date=%s' % d.isoformat(), headers={'Accept': 'application/json'}, tries=2, timeout=20)
        except Exception as e:
            log('나스닥 달력 실패', d, e); bad += 1; continue
        bad = 0
        for r in ((j.get('data') or {}).get('rows') or []):
            t = r.get('time') or ''
            out[((r.get('symbol') or '').replace('/', '-'), d.isoformat())] = 'bmo' if 'pre' in t else 'amc' if 'after' in t else None
        time.sleep(0.15)
    return out


def us_fin(y, s):
    sm = y.summary(s)
    ts = y.series(s)
    return {'sm': sm, 'ts': ts}


def us_tables(f, q):
    """야후 자료 → 분기·연간 표 (통화 1억 단위) + 지난 발표·서프라이즈"""
    ts, sm = f['ts'], f['sm'] or {}
    E8 = 1e8

    def build(per, nmax):
        ds = sorted(per)[-nmax:]
        v = {k: [] for k in ('rev', 'op', 'adjop', 'ebitda', 'ni', 'eps', 'ocf', 'capex', 'fcf', 'opm', 'debt', 'icr', 'cur', 'quick', 'roe', 'roic')}
        for i, d in enumerate(ds):
            x = per[d]
            g = x.get
            rev, opr, adj = g('TotalRevenue'), g('TotalOperatingIncomeAsReported'), g('OperatingIncome')
            if opr is None: opr = adj
            ni, liab, eq = g('NetIncomeCommonStockholders'), g('TotalLiabilitiesNetMinorityInterest'), g('StockholdersEquity')
            ca, cl, inv, ie = g('CurrentAssets'), g('CurrentLiabilities'), g('Inventory'), g('InterestExpense')
            ic, tax = g('InvestedCapital'), g('TaxRateForCalcs')
            ann = 4 if per is ts['q'] else 1
            prev = per[ds[i - 1]] if i > 0 else None
            def avg(key):
                a, b = x.get(key), prev.get(key) if prev else None
                return (a + b) / 2 if a is not None and b is not None else a
            eqa, ica = avg('StockholdersEquity'), avg('InvestedCapital')
            v['rev'].append(r2(rev / E8) if rev is not None else None)
            v['op'].append(r2(opr / E8) if opr is not None else None)
            v['adjop'].append(r2(adj / E8) if adj is not None else None)
            v['ebitda'].append(r2(g('EBITDA') / E8) if g('EBITDA') is not None else None)
            v['ni'].append(r2(ni / E8) if ni is not None else None)
            v['eps'].append(r2(g('DilutedEPS'), 3))
            v['ocf'].append(r2(g('OperatingCashFlow') / E8) if g('OperatingCashFlow') is not None else None)
            cx = g('CapitalExpenditure')
            v['capex'].append(r2(-cx / E8) if cx is not None else None)
            v['fcf'].append(r2(g('FreeCashFlow') / E8) if g('FreeCashFlow') is not None else None)
            v['opm'].append(r2(opr / rev * 100) if opr is not None and rev else None)
            v['debt'].append(r2(liab / eq * 100) if liab is not None and eq and eq > 0 else None)
            v['icr'].append(r2(opr / ie) if opr is not None and ie and ie > 0 else None)
            v['cur'].append(r2(ca / cl * 100) if ca is not None and cl else None)
            v['quick'].append(r2((ca - (inv or 0)) / cl * 100) if ca is not None and cl else None)
            v['roe'].append(r2(ni * ann / eqa * 100) if ni is not None and eqa and eqa > 0 else None)
            nop = (adj if adj is not None else opr)
            v['roic'].append(r2(nop * (1 - (tax if tax is not None and 0 <= tax < 0.6 else 0.21)) * ann / ica * 100) if nop is not None and ica and ica > 0 else None)
        return {'p': [d[:7].replace('-', '.') for d in ds], 'e': [0] * len(ds), 'v': v}

    out = {'q': build(ts['q'], 6) if ts['q'] else None, 'y': build(ts['y'], 5) if ts['y'] else None}
    # 예상치(E) 열: 이번·다음 분기 / 올해·내년 EPS·매출
    tr = (sm.get('earningsTrend') or {}).get('trend') or []
    for t in tr:
        per, ed = t.get('period'), t.get('endDate')
        if not ed or per not in ('0q', '+1q', '0y', '+1y'): continue
        tb = out['q' if per.endswith('q') else 'y']
        if not tb: continue
        lab = ed[:7].replace('-', '.')
        if lab in tb['p']: continue
        if tb['p'] and lab < tb['p'][-1]: continue
        tb['p'].append(lab); tb['e'].append(1)
        for k in tb['v']: tb['v'][k].append(None)
        ee, re_ = raw(t, 'earningsEstimate', 'avg'), raw(t, 'revenueEstimate', 'avg')
        tb['v']['eps'][-1] = r2(ee, 3)
        tb['v']['rev'][-1] = r2(re_ / E8) if re_ else None
    for tb in (out['q'], out['y']):
        if tb and len(tb['p']) > 1:   # 날짜순 정렬 유지
            idx = sorted(range(len(tb['p'])), key=lambda i: tb['p'][i])
            tb['p'] = [tb['p'][i] for i in idx]; tb['e'] = [tb['e'][i] for i in idx]
            for k in tb['v']: tb['v'][k] = [tb['v'][k][i] for i in idx]
    # 지난 발표: earnings.earningsChart.quarterly (발표일·EPS 실제/예상)
    hist = []
    for x in ((sm.get('earnings') or {}).get('earningsChart') or {}).get('quarterly') or []:
        rd, pe = raw(x, 'reportedDate'), raw(x, 'periodEndDate')
        a, e = raw(x, 'actual'), raw(x, 'estimate')
        if not rd: continue
        hist.append({'d': datetime.datetime.fromtimestamp(rd, NY).date().isoformat(), 'pe': datetime.datetime.fromtimestamp(pe, datetime.timezone.utc).date().isoformat()[:7].replace('-', '.') if pe else None,
                     'a': r2(a, 3), 'e': r2(e, 3), 'sp': r2((a - e) / abs(e) * 100, 1) if a is not None and e else None})
    out['hist'] = sorted(hist, key=lambda h: h['d'])
    out['cur'] = ts.get('cur') or q.get('financialCurrency')
    return out


# ══════════════════════════════ 조립 ══════════════════════════════
def ttm(tb, k):
    """분기표에서 실제(E 아님) 최근 4개 분기 합"""
    if not tb: return None
    vals = [v for v, e in zip(tb['v'].get(k) or [], tb['e']) if not e]
    vals = [v for v in vals[-4:]]
    return round(sum(vals), 2) if len(vals) == 4 and all(v is not None for v in vals) else None


def nz(a, b):
    return a if a is not None else b


def avg4(tb, k):
    """분기표 실제 최근 4개 분기 평균 (넷 다 있을 때만)"""
    if not tb: return None
    vals = [v for v, e in zip(tb['v'].get(k) or [], tb['e']) if not e][-4:]
    return round(sum(vals) / 4, 2) if len(vals) == 4 and all(v is not None for v in vals) else None


def last_actual(tb, k):
    if not tb: return None
    for v, e in reversed(list(zip(tb['v'].get(k) or [], tb['e']))):
        if not e and v is not None: return v
    return None


def kr_next(info, discs, fin, prelim_last):
    """다음 실적 발표일 — 확정 IR 일정 > 작년 같은 분기 발표일 + 1년 > 법정 제출 기한"""
    ir = info.get('ir') if info else None
    if ir and ir.get('d') and ir['d'] >= TODAY.isoformat() and re.search(r'실적|결산|분기|경영', ir.get('t') or ''):
        return {'d': ir['d'], 'k': 'ir', 'tt': ir.get('t')}
    pres = [x for x in discs if not x['fix']]
    # 마지막으로 발표된 분기
    last_pe = None
    if prelim_last and prelim_last.get('pe'): last_pe = datetime.date.fromisoformat(prelim_last['pe'])
    elif pres: last_pe = qend(datetime.date.fromisoformat(pres[0]['d']))
    if fin and fin.get('q'):
        acts = [p for p, e in zip(fin['q']['p'], fin['q']['e']) if not e]
        if acts:
            y, m = map(int, acts[-1].split('.'))
            a = add_months(datetime.date(y, m, 1), 0)
            if not last_pe or a > last_pe: last_pe = a
    if not last_pe: return None
    tgt = add_months(last_pe, 3)
    lab = pkey(tgt)
    # 작년 같은 분기 잠정실적 공시일 + 364일(같은 요일)
    same = sorted(x['d'] for x in pres if qend(datetime.date.fromisoformat(x['d'])) == add_months(tgt, -12))
    if same:   # 그 분기 첫 실적 공시일
        dd = datetime.date.fromisoformat(same[0])
        g = dd + datetime.timedelta(days=364)
        if g >= TODAY: return {'d': g.isoformat(), 'k': 'est', 'pd': lab, 'b': same[0]}
    due = tgt + datetime.timedelta(days=90 if tgt.month == 12 else 45)
    while due.weekday() >= 5: due += datetime.timedelta(days=1)   # 기한이 주말이면 다음 월요일
    if due >= TODAY: return {'d': due.isoformat(), 'k': 'due', 'pd': lab}
    return None


def uniq(pairs):
    out, seen = [], set()
    for p in pairs:
        if p[0] in seen: continue      # 같은 날 여러 건(지주·자회사·정정)은 하나만
        seen.add(p[0]); out.append(p)
    return out


def sane(k):
    """요약 지표 범위 점검 — 분모가 0에 가까워 생기는 터무니없는 값은 비움 (상세 표는 원자료 그대로)"""
    lim = {'roe': 300, 'roic': 200, 'eveb': 500, 'icr': 100000, 'debt': 100000, 'cur': 100000, 'quick': 100000, 'opm': 1000}
    for kk, m in lim.items():
        v = k.get(kk)
        if v is not None and abs(v) > m: k[kk] = None
    if k.get('eveb') is not None and k['eveb'] <= 0: k['eveb'] = None
    return k


def build_kr(prev_sum, prev_det):
    try:
        uni = kr_universe()
    except Exception as e:
        log('국내 목록 실패:', e); uni = []
    if len(uni) < 90:
        log('국내 목록 %d개 — 직전 목록 유지' % len(uni))
        return (prev_sum or {}).get('kr') or [], prev_det or {'co': {}}
    det = prev_det if prev_det and isinstance(prev_det.get('co'), dict) else {'co': {}}

    def light(u):
        c = u['c']
        old = det['co'].setdefault(c, {})
        try:
            info = kr_info(c); old['info'] = info
        except Exception as e:
            info = old.get('info'); log('KR 정보 실패', c, e)
        try:
            full = not old.get('dsc') or (time.time() - (old.get('dt') or 0)) > STALE_H * 3600
            discs = kr_disclosures(c, pages=4 if full else 1, size=100 if full else 30,
                                   until=(TODAY - datetime.timedelta(days=420)).isoformat() if full else None)
            if not full:   # 앞쪽만 새로 받고 나머지는 직전 목록과 합침
                ids = {x['id'] for x in discs}
                discs = discs + [x for x in old.get('dsc') or [] if x['id'] not in ids]
            else:
                old['dt'] = time.time()
            # 본문 기간으로 분기 실적인지 판별 (현대차·기아 같은 월간 판매 '영업(잠정)실적' 거르기) — 한 번 본 공시는 기억
            known = {x['id']: x for x in old.get('dsc') or []}
            for x in discs:
                if 'q' in x: continue
                k = known.get(x['id'])
                if k and 'q' in k: x['q'] = k['q']; continue
                try:
                    days = kr_period_days(kr_doc(c, x['id']))
                    x['q'] = 1 if days is None or days >= 80 else 0
                except Exception as e:
                    log('KR 공시 본문 실패', c, x['id'], e)
            discs = [x for x in discs if x.get('q', 1)]
            discs = sorted(discs, key=lambda x: (x['d'], x.get('tm') or ''), reverse=True)[:24]
        except Exception as e:
            discs = old.get('dsc') or []; log('KR 공시 실패', c, e)
        time.sleep(0.05)
        return c, info, discs

    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(light, uni))
    log('국내 정보·공시 %d개' % len(res))

    # 재무표: 오래됐거나 최근 발표한 기업 우선
    def need(c, discs):
        o = det['co'].get(c) or {}
        recent = any(x['d'] >= (TODAY - datetime.timedelta(days=4)).isoformat() for x in discs)
        age = time.time() - (o.get('ft') or 0)
        return (0 if not o.get('fin') else 1 if recent and age > 1800 else 2 if age > STALE_H * 3600 else 9, -age)
    order = sorted([(need(c, d), c) for c, _, d in res])
    todo = [c for k, c in order if k[0] < 9]
    done = 0
    log('국내 정보·공시 끝 %.0f초 · 재무표 받을 기업 %d개' % (time.time() - T0, len(todo)))

    def one(c):
        try:
            f = kr_fin(c)
            return c, f if f and f.get('q') and f.get('y') else None
        except Exception as e:
            log('KR 재무 실패', c, e); return c, None
    for i in range(0, len(todo), 4):
        if time.time() - T0 > BUDGET: log('국내 재무표 시간 예산 초과 — 남은 %d개는 다음 실행' % (len(todo) - i)); break
        with ThreadPoolExecutor(4) as ex:
            for c, f in ex.map(one, todo[i:i + 4]):
                if f:
                    o = det['co'].setdefault(c, {}); o['fin'] = f; o['ft'] = time.time(); done += 1
                else: log('KR 재무 비어 있음', c)
    log('국내 재무표 %d개 새로 받음 (%.0f초)' % (done, time.time() - T0))

    rows = []
    for rank, (u, (c, info, discs)) in enumerate(zip(uni, res), 1):
        o = det['co'].setdefault(c, {})
        o['dsc'] = discs
        o['n'] = u['n']
        # 가장 최근 잠정실적 본문(새 공시면 다시 읽음)
        pres = [x for x in discs if not x['fix'] and not x.get('ann')]
        pl = o.get('pl')
        if pres and (not pl or pl.get('id') != pres[0]['id']):
            try:
                p = kr_prelim(c, pres[0]['id'])
                if p: p['id'] = pres[0]['id']; p['d'] = pres[0]['d']; p['tm'] = pres[0].get('tm'); o['pl'] = pl = p
            except Exception as e: log('KR 잠정실적 본문 실패', c, e)
        fin = o.get('fin')
        q = fin.get('q') if fin else None
        y = fin.get('y') if fin else None
        info = info or {}
        p = u['p']
        # PER 3종: 후행(최근 4분기 EPS) · 혼합(올해 EPS = 발표된 분기 실제 + 남은 분기 예상) · 선행(내년 예상 EPS)
        eps_t = info.get('eps')
        eps_b = info.get('ceps')
        eps_f = None
        if y:
            yr = NOW_KST.year
            for lab, e, v in zip(y['p'], y['e'], y['v'].get('eps') or []):
                if lab.startswith(str(yr + 1)) and e and v: eps_f = v
                if eps_b is None and lab.startswith(str(yr)) and e and v: eps_b = v
        per = {'t': r2(p / eps_t) if p and eps_t and eps_t > 0 else None, 'b': r2(p / eps_b) if p and eps_b and eps_b > 0 else None,
               'f': r2(p / eps_f) if p and eps_f and eps_f > 0 else None}
        epsd = {'t': eps_t, 'b': eps_b, 'f': eps_f}
        nx = kr_next(info, discs, fin, pl)
        # 지난 발표(최근) + 서프라이즈(잠정 영업이익 vs 그 분기 컨센서스)
        ls = None
        if pl:
            lab = pl['pe'][:7].replace('-', '.')
            ls = {'d': pl['d'], 'tm': pl.get('tm'), 'pd': lab, 'rev': pl.get('rev'), 'op': pl.get('op'), 'ni': pl.get('ni'),
                  'revY': pl.get('revY'), 'opY': pl.get('opY')}
            if q and lab in q['p']:
                i = q['p'].index(lab)
                if q['e'][i]:
                    oe, rve = (q['v'].get('op') or [None] * 99)[i], (q['v'].get('rev') or [None] * 99)[i]
                    ls['opE'], ls['revE'] = oe, rve
                    if oe and pl.get('op') is not None and oe > 0: ls['sp'] = r2((pl['op'] - oe) / oe * 100, 1)
        k = {}
        if q:
            k = {'opm': last_actual(q, 'opm'), 'debt': last_actual(q, 'debt'), 'icr': nz(avg4(q, 'icr'), last_actual(y, 'icr')),
                 'roe': nz(last_actual(q, 'roe'), last_actual(y, 'roe')), 'roic': nz(avg4(q, 'roic'), last_actual(y, 'roic')),
                 'fcf': ttm(q, 'fcf'), 'op': ttm(q, 'op'), 'rev': ttm(q, 'rev'), 'eveb': None,
                 'cur': last_actual(q, 'cur'), 'quick': last_actual(q, 'quick')}
            # EV/EBITDA(현재): 와이즈리포트 올해(E) 열의 EV(현재 주가 기준) ÷ 최근 4분기 EBITDA
            eb = ttm(q, 'ebitda')
            evn = None
            if y and y['v'].get('ev'):
                for lab, e, v in zip(y['p'], y['e'], y['v']['ev']):
                    if e and v and lab.startswith(str(NOW_KST.year)): evn = v
            if evn and eb and eb > 0: k['eveb'] = r2(evn / eb)
            elif y and eb is not None and eb > 0: k['eveb'] = last_actual(y, 'eveb')
            if ls and ls.get('pd') in q['p'] and q['e'][q['p'].index(ls['pd'])]:
                # 잠정실적이 나온 분기(분기보고서 전): 매출·영업이익 최근 4분기 합과 영업이익률은 예상치 대신 잠정치로
                i = q['p'].index(ls['pd'])
                qp = {'p': q['p'][:i + 1], 'e': q['e'][:i] + [0], 'v': {kk: (q['v'].get(kk) or [None] * len(q['p']))[:i] + [ls.get(kk)] for kk in ('rev', 'op')}}
                k['op'], k['rev'] = ttm(qp, 'op'), ttm(qp, 'rev')
                if ls.get('op') is not None and ls.get('rev'): k['opm'] = r2(ls['op'] / ls['rev'] * 100)
        rows.append({'c': c, 'n': u['n'], 'r': rank, 'm': u['m'], 'p': p, 'ch': u['ch'], 'per': per, 'eps': epsd, 'pbr': info.get('pbr'),
                     'nx': nx, 'ls': ls, 'k': sane(k),
                     'pa': uniq([[x['d'], 'ann' if x.get('ann') else 'fix' if x['fix'] else 'pre'] for x in discs])[:12]})
    # 목록에서 빠진 회사의 상세는 지움
    keep = {r['c'] for r in rows}
    det['co'] = {c: v for c, v in det['co'].items() if c in keep}
    return rows, det


def build_us(prev_sum, prev_det):
    det = prev_det if prev_det and isinstance(prev_det.get('co'), dict) else {'co': {}}
    try:
        uni = us_universe()
    except Exception as e:
        log('미국 목록 실패:', e); uni = []
    if len(uni) < 90:
        log('미국 목록 %d개 — 직전 목록 유지' % len(uni))
        old = (prev_sum or {}).get('us') or []
        uni = [{'s': r['s'], 'n': r['n'], 'm': r['m'], 'p': r['p'], 'cty': r.get('cty'), 'sec': r.get('sec')} for r in old]
        if not uni: return [], det
    y = Yahoo()
    q = y.quotes([u['s'] for u in uni])
    log('Yahoo 시세 %d/%d' % (len(q), len(uni)))
    try: times = nasdaq_times()
    except Exception as e: times = {}; log('나스닥 달력 실패', e)

    def need(s):
        o = det['co'].get(s) or {}
        qq = q.get(s) or {}
        et = qq.get('earningsTimestamp')
        h = ((o.get('fin') or {}).get('hist') or [{}])[-1].get('d') or ''
        recent = (et and -86400 <= time.time() - et < 4 * 86400) or h >= (TODAY - datetime.timedelta(days=4)).isoformat()
        age = time.time() - (o.get('ft') or 0)
        return (0 if not o.get('fin') else 1 if recent and age > 1800 else 2 if age > STALE_H * 3600 else 9, -age)
    order = sorted([(need(u['s']), u['s']) for u in uni])
    todo = [s for k, s in order if k[0] < 9]
    done = 0

    def work(s):
        try:
            f = us_fin(y, s)
            return s, us_tables(f, q.get(s) or {}), f['sm']
        except Exception as e:
            log('US 재무 실패', s, e); return s, None, None
    for i in range(0, len(todo), 4):
        if time.time() - T0 > BUDGET * 1.6: log('미국 재무표 시간 예산 초과 — 남은 %d개는 다음 실행' % (len(todo) - i)); break
        with ThreadPoolExecutor(4) as ex:
            for s, tb, sm in ex.map(work, todo[i:i + 4]):
                if tb and (tb.get('q') or tb.get('y')):
                    o = det['co'].setdefault(s, {}); o['fin'] = tb; o['ft'] = time.time()
                    ce = (sm or {}).get('calendarEvents') or {}
                    ern = ce.get('earnings') or {}
                    o['cal'] = {'ds': [raw(x) for x in (ern.get('earningsDate') or []) if isinstance(x, dict)],
                                'est': bool(ern.get('isEarningsDateEstimate')),
                                'epsE': raw(ern, 'earningsAverage'), 'revE': raw(ern, 'revenueAverage')}
                    ks = (sm or {}).get('defaultKeyStatistics') or {}
                    o['ev'] = raw(ks, 'enterpriseValue'); o['eveb'] = raw(ks, 'enterpriseToEbitda')
                    done += 1
        time.sleep(0.2)
    log('미국 재무표 %d개 새로 받음' % done)

    rows = []
    for rank, u in enumerate(uni, 1):
        s = u['s']; qq = q.get(s) or {}; o = det['co'].setdefault(s, {})
        fin = o.get('fin') or {}
        o['n'] = u['n']
        price = qq.get('regularMarketPrice') or u['p']
        per = {'t': r2(qq.get('trailingPE')), 'b': r2(qq.get('priceEpsCurrentYear')), 'f': r2(qq.get('forwardPE'))}
        epsd = {'t': qq.get('epsTrailingTwelveMonths'), 'b': qq.get('epsCurrentYear'), 'f': qq.get('epsForward')}
        for k_ in ('t', 'b', 'f'):
            if per[k_] is not None and (per[k_] <= 0 or per[k_] > 5000): per[k_] = None
        adr = (qq.get('currency') or 'USD') != (qq.get('financialCurrency') or fin.get('cur') or 'USD')
        if adr and per['t']:   # 미국 예탁증서: 야후가 주가(달러)와 EPS(본국 통화)를 섞어 계산한 혼합·선행 PER 은 버림
            for k_ in ('b', 'f'):
                if per[k_] and not (per['t'] / 3 < per[k_] < per['t'] * 3): per[k_] = None; epsd[k_] = None
        # 다음 발표일: quote 의 earningsTimestamp(Start/End) — 지났으면 quoteSummary 달력 — 그래도 없으면 지난 발표 + 91일(추정)
        cand = []
        for t_ in (qq.get('earningsTimestampStart'), qq.get('earningsTimestamp')):
            if t_: cand.append(t_)
        cal = o.get('cal') or {}
        cand += [t_ for t_ in cal.get('ds') or [] if t_]
        nowts = time.time()
        lastrep = ((fin.get('hist') or [{}])[-1] or {}).get('d') or ''
        fut = sorted(t_ for t_ in cand if t_ >= nowts - 20 * 3600
                     and datetime.datetime.fromtimestamp(t_, NY).date().isoformat() > lastrep)   # 이미 발표가 끝난 날짜(야후가 아직 안 넘긴 것)는 제외
        nx = None
        est = qq.get('isEarningsDateEstimate')
        if est is None: est = cal.get('est')
        if fut:
            t_ = fut[0]
            dt = datetime.datetime.fromtimestamp(t_, NY)
            d = dt.date().isoformat()
            tm = times.get((s, d))
            if tm is None and not est:
                hm = dt.hour * 60 + dt.minute
                tm = 'bmo' if 0 < hm < 9 * 60 + 30 else 'amc' if hm >= 16 * 60 else None
            nx = {'d': d, 'k': 'est' if est else 'conf', 'tm': tm,
                  'epsE': r2(cal.get('epsE'), 3), 'revE': r2(cal.get('revE') / 1e8) if cal.get('revE') else None}
            # 범위로 나온 예상일
            end = qq.get('earningsTimestampEnd')
            if est and end and end - t_ > 86400: nx['d2'] = datetime.datetime.fromtimestamp(end, NY).date().isoformat()
        else:
            h = fin.get('hist') or []
            if h:
                g = datetime.date.fromisoformat(h[-1]['d']) + datetime.timedelta(days=91)
                while g.weekday() >= 5: g += datetime.timedelta(days=1)
                if g >= TODAY - datetime.timedelta(days=1): nx = {'d': g.isoformat(), 'k': 'guess'}
        h = fin.get('hist') or []
        ls = None
        if h:
            l = h[-1]
            ls = {'d': l['d'], 'pd': l.get('pe'), 'eps': l.get('a'), 'epsE': l.get('e'), 'sp': l.get('sp')}
        tq, ty = fin.get('q'), fin.get('y')
        k = {}
        if tq or ty:
            k = {'opm': last_actual(tq, 'opm'), 'debt': last_actual(tq, 'debt'), 'icr': None, 'roe': None, 'roic': None,
                 'fcf': ttm(tq, 'fcf'), 'op': ttm(tq, 'op'), 'rev': ttm(tq, 'rev'), 'eveb': r2(o.get('eveb')),
                 'cur': last_actual(tq, 'cur'), 'quick': last_actual(tq, 'quick')}
            # 최근 4분기 합으로 ROE·ROIC·이자보상배율 (연간 기준)
            k['roic'] = nz(avg4(tq, 'roic'), last_actual(ty, 'roic'))
            k['roe'] = nz(avg4(tq, 'roe'), last_actual(ty, 'roe'))
            k['icr'] = nz(avg4(tq, 'icr'), last_actual(ty, 'icr'))
            if k['eveb'] is not None and (k['eveb'] <= 0 or k['eveb'] > 2000): k['eveb'] = None
            if adr: k['eveb'] = None    # 예탁증서: 야후 EV(달러)와 EBITDA(본국 통화) 단위가 달라 계산 불가
        rows.append({'s': s, 'n': u['n'], 'ko': US_KO.get(s), 'r': rank, 'm': u['m'], 'p': r2(price), 'ch': r2(qq.get('regularMarketChangePercent')),
                     'cur': qq.get('currency') or 'USD', 'fc': fin.get('cur') or qq.get('financialCurrency') or 'USD', 'cty': u.get('cty'), 'sec': u.get('sec'),
                     'per': per, 'eps': epsd, 'pbr': r2(qq.get('priceToBook')), 'nx': nx, 'ls': ls, 'k': sane(k),
                     'pa': [[x['d'], 'rep'] for x in reversed(h)][:12]})
    keep = {r['s'] for r in rows}
    det['co'] = {s: v for s, v in det['co'].items() if s in keep}
    return rows, det


def main():
    prev = load(OUT, {}) or {}
    pkr, pus = load(OUT_KR, {'co': {}}), load(OUT_US, {'co': {}})
    base = json.loads(json.dumps([prev, pkr, pus]))     # 비교용 사본 (아래에서 pkr·pus 를 고쳐 쓰므로)
    only = (sys.argv[1] if len(sys.argv) > 1 else '').lower()
    kr, dkr = (build_kr(prev, pkr) if only in ('', 'kr') else (prev.get('kr') or [], pkr))
    try:
        us, dus = (build_us(prev, pus) if only in ('', 'us') else (prev.get('us') or [], pus))
    except Exception as e:
        log('미국 전체 실패 — 직전 값 유지:', e); us, dus = prev.get('us') or [], pus
    if not kr and not us: sys.exit('국내·미국 모두 비어 있음 — 저장하지 않음')
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    summ = {'updated': now, 'today': TODAY.isoformat(),
            'source': '국내: 네이버 증권·와이즈리포트(컨센서스·재무)·거래소 공시 / 미국: Yahoo Finance·나스닥·companiesmarketcap',
            'kr': kr, 'us': us}
    # 내용(갱신 시각·받은 시각 제외)이 직전과 같으면 저장하지 않음 → 주말·휴장일에 빈 커밋을 만들지 않음
    def strip(o):
        if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k not in ('updated', 'dt', 'ft')}
        if isinstance(o, list): return [strip(v) for v in o]
        return o
    same = strip(summ) == strip(base[0]) and strip(dkr) == strip(base[1]) and strip(dus) == strip(base[2])
    if same:
        log('내용 변화 없음 — 저장하지 않음 (%.0f초)' % (time.time() - T0)); return
    dkr['updated'] = dus['updated'] = now
    save(OUT, summ); save(OUT_KR, dkr); save(OUT_US, dus)
    log('저장: 국내 %d · 미국 %d · %.0f초' % (len(kr), len(us), time.time() - T0))


if __name__ == '__main__':
    main()
