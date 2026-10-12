#!/usr/bin/env python3
"""ETF 차트 비교 — 상장 전 백테스트용 자료 모으기 (scripts/etf_bt_fit.py 가 이 자료로 ETF 마다 '과거를 재현할 방법'을 고름)

모으는 것 (캐시 폴더 --cache, 기본 .btcache — 저장소에는 올리지 않음 · Actions 는 actions/cache 로 이어 씀)
  series/<키>.npz   일봉 d(1970-01-01 기준 일수) · c(종가) · a(분배·배당 재투자 수정가, 없으면 c) · v_d/v_a(분배락일·분배금)
      키: K:<코드>  국내 ETF·주식 (네이버 siseJson 수정주가 — ETF 는 분배까지 반영된 값)
          N:<기호>  국내 지수 (네이버: KOSPI·KOSDAQ·KPI200)
          U:<티커>  미국 상장 ETF·주식 (야후 v8 — c 종가 · a adjclose · 분배 내역)
          Y:<기호>  지수·선물·환율·코인 (야후 — 가격)
          C:<기호>  Cboe 옵션 전략 지수 (BuyWrite·PutWrite·칼라·버퍼·커버드콜 등 약 200개 · cdn-api.cboe.com 일별 종가 CSV — 매번 전체 기간)
          D:<지수 ID> 한국거래소 옵션 전략 지수 (코스피 200 커버드콜 ATM·위클리 커버드콜·타겟 위클리 커버드콜·고배당·반도체·코스닥 150 커버드콜·
                    양매도·풋매도·버퍼 등 약 56개 · KRX 지수 누리집(index.krx.co.kr) '파생상품지수 > 옵션' 일별 종가 — 매번 전체 기간)
  meta/kr/<코드>.json  네이버 ETF 분석 (기초지수·상장일·총보수·상위 10 구성종목·분배)
  meta/us/<티커>.json  야후 quoteSummary (상위 10 보유 종목·분류·보수)
  rates.json           한국은행 ECOS 시장금리(일별) — CD91·콜·국고채 1~30년·회사채·통안증권
  universe.json        모든 키의 시장·통화·첫날·마지막 날

사용
  python3 scripts/etf_bt_data.py                 # 있는 것은 최근 구간만 이어 받고 새 종목은 처음부터
  python3 scripts/etf_bt_data.py --full          # 모두 처음부터
  python3 scripts/etf_bt_data.py --only U:SPY,K:069500
  python3 scripts/etf_bt_data.py --skip-meta --src cboe   # Cboe 옵션 전략 지수만
  python3 scripts/etf_bt_data.py --skip-meta --src krx    # 한국거래소 옵션 전략 지수만
"""
import argparse, concurrent.futures as cf, datetime, json, math, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from http import cookiejar

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
ECOS_KEY = 'RVTLLDCO3IW1YUKQSSPJ'   # 공개 인증키 (update_market_data.py 와 같음)
EPOCH = datetime.date(1970, 1, 1)

# 지수·선물·환율·코인 (야후) — [기호, 시장, 통화, 설명]
#   시장: 종가 시각 순서를 정할 때 씀 (KR 15:30 KST · AS 아시아 · EU 유럽 · US 미국 · CX 코인 00:00 UTC)
YAHOO_IDX = [
    ('^GSPC', 'US', 'USD', 'S&P 500'), ('^SP500TR', 'US', 'USD', 'S&P 500 TR'), ('^NDX', 'US', 'USD', 'Nasdaq-100'), ('^NDXT', 'US', 'USD', 'Nasdaq-100 Tech Sector'),
    ('^IXIC', 'US', 'USD', 'Nasdaq Composite'), ('^DJI', 'US', 'USD', 'Dow Jones'), ('^RUT', 'US', 'USD', 'Russell 2000'), ('^RUTTR', 'US', 'USD', 'Russell 2000 TR'),
    ('^SOX', 'US', 'USD', 'PHLX Semiconductor'), ('^NYA', 'US', 'USD', 'NYSE Composite'), ('^SPXEW', 'US', 'USD', 'S&P 500 EW'), ('^SP400', 'US', 'USD', 'S&P 400'),
    ('^SP600', 'US', 'USD', 'S&P 600'), ('^W5000', 'US', 'USD', 'Wilshire 5000'), ('^OEX', 'US', 'USD', 'S&P 100'), ('^DJT', 'US', 'USD', 'Dow Transports'),
    ('^DJU', 'US', 'USD', 'Dow Utilities'), ('^NYFANG', 'US', 'USD', 'NYSE FANG+'), ('^SP500-60', 'US', 'USD', 'S&P 500 Real Estate'), ('^XOI', 'US', 'USD', 'NYSE Arca Oil'),
    ('^HUI', 'US', 'USD', 'Gold Bugs'), ('^BKX', 'US', 'USD', 'KBW Bank'), ('^NBI', 'US', 'USD', 'Nasdaq Biotech'), ('^XAU', 'US', 'USD', 'PHLX Gold/Silver'),
    ('^SPGSCI', 'US', 'USD', 'S&P GSCI'), ('DX-Y.NYB', 'US', 'USD', 'Dollar Index'), ('^PUT', 'US', 'USD', 'S&P 500 PutWrite'),
    ('^N225', 'AS', 'JPY', 'Nikkei 225'), ('^HSI', 'AS', 'HKD', 'Hang Seng'), ('^HSCE', 'AS', 'HKD', 'Hang Seng China Ent.'), ('000001.SS', 'AS', 'CNY', 'Shanghai Composite'),
    ('399001.SZ', 'AS', 'CNY', 'Shenzhen Component'), ('^TWII', 'AS', 'TWD', 'TAIEX'), ('^STI', 'AS', 'SGD', 'Straits Times'), ('^AXJO', 'AS', 'AUD', 'ASX 200'),
    ('^BSESN', 'AS', 'INR', 'Sensex'), ('^NSEI', 'AS', 'INR', 'Nifty 50'), ('^KS11', 'KR', 'KRW', 'KOSPI (Yahoo)'), ('^KQ11', 'KR', 'KRW', 'KOSDAQ (Yahoo)'),
    ('^STOXX50E', 'EU', 'EUR', 'Euro Stoxx 50'), ('^STOXX', 'EU', 'EUR', 'Stoxx 600'), ('^GDAXI', 'EU', 'EUR', 'DAX'), ('^FTSE', 'EU', 'GBP', 'FTSE 100'), ('^FCHI', 'EU', 'EUR', 'CAC 40'),
    ('^GSPTSE', 'US', 'CAD', 'TSX'), ('^BVSP', 'US', 'BRL', 'Bovespa'), ('^MXX', 'US', 'MXN', 'IPC Mexico'),
    ('GC=F', 'US', 'USD', 'Gold futures'), ('SI=F', 'US', 'USD', 'Silver futures'), ('CL=F', 'US', 'USD', 'WTI futures'), ('BZ=F', 'US', 'USD', 'Brent futures'),
    ('NG=F', 'US', 'USD', 'Natural gas futures'), ('HG=F', 'US', 'USD', 'Copper futures'), ('PL=F', 'US', 'USD', 'Platinum futures'), ('PA=F', 'US', 'USD', 'Palladium futures'),
    ('ZC=F', 'US', 'USD', 'Corn futures'), ('ZW=F', 'US', 'USD', 'Wheat futures'), ('ZS=F', 'US', 'USD', 'Soybean futures'),
    ('BTC-USD', 'CX', 'USD', 'Bitcoin'), ('ETH-USD', 'CX', 'USD', 'Ether'), ('SOL-USD', 'CX', 'USD', 'Solana'), ('XRP-USD', 'CX', 'USD', 'XRP'),
    ('^IRX', 'US', 'USD', '13-week T-bill yield'), ('^FVX', 'US', 'USD', '5-year Treasury yield'), ('^TNX', 'US', 'USD', '10-year Treasury yield'), ('^TYX', 'US', 'USD', '30-year Treasury yield'),
    ('^VIX', 'US', 'USD', 'VIX'),
    # 통화 (USD 대비) — 다른 통화 지수를 원화·달러로 바꿀 때
    ('JPY=X', 'FX', 'JPY', 'USD/JPY'), ('CNY=X', 'FX', 'CNY', 'USD/CNY'), ('HKD=X', 'FX', 'HKD', 'USD/HKD'), ('TWD=X', 'FX', 'TWD', 'USD/TWD'), ('SGD=X', 'FX', 'SGD', 'USD/SGD'),
    ('INR=X', 'FX', 'INR', 'USD/INR'), ('AUDUSD=X', 'FX', 'AUD', 'AUD/USD'), ('EURUSD=X', 'FX', 'EUR', 'EUR/USD'), ('GBPUSD=X', 'FX', 'GBP', 'GBP/USD'),
    ('CAD=X', 'FX', 'CAD', 'USD/CAD'), ('BRL=X', 'FX', 'BRL', 'USD/BRL'), ('MXN=X', 'FX', 'MXN', 'USD/MXN'), ('KRW=X', 'FX', 'KRW', 'USD/KRW (Yahoo)'),
    ('CHF=X', 'FX', 'CHF', 'USD/CHF'), ('SEK=X', 'FX', 'SEK', 'USD/SEK'), ('DKK=X', 'FX', 'DKK', 'USD/DKK'), ('NOK=X', 'FX', 'NOK', 'USD/NOK'),
    ('ZAR=X', 'FX', 'ZAR', 'USD/ZAR'), ('ILS=X', 'FX', 'ILS', 'USD/ILS'), ('NZDUSD=X', 'FX', 'NZD', 'NZD/USD'), ('IDR=X', 'FX', 'IDR', 'USD/IDR'),
    ('THB=X', 'FX', 'THB', 'USD/THB'), ('MYR=X', 'FX', 'MYR', 'USD/MYR'), ('PLN=X', 'FX', 'PLN', 'USD/PLN'), ('TRY=X', 'FX', 'TRY', 'USD/TRY'),
    ('SAR=X', 'FX', 'SAR', 'USD/SAR'), ('PHP=X', 'FX', 'PHP', 'USD/PHP'), ('CLP=X', 'FX', 'CLP', 'USD/CLP'), ('VND=X', 'FX', 'VND', 'USD/VND'),
    ('KWD=X', 'FX', 'KWD', 'USD/KWD'), ('AED=X', 'FX', 'AED', 'USD/AED'), ('QAR=X', 'FX', 'QAR', 'USD/QAR'), ('CZK=X', 'FX', 'CZK', 'USD/CZK'),
    ('HUF=X', 'FX', 'HUF', 'USD/HUF'), ('COP=X', 'FX', 'COP', 'USD/COP'), ('EGP=X', 'FX', 'EGP', 'USD/EGP'),
]
# 통화 기호 → 야후 USD 교차 (False: 'USD 당 통화' 표기 XXX=X · True: '통화 당 USD' 표기 XXXUSD=X) — 화면 FXSYM 과 같게
FX_PAIR = {r[2]: (r[0], r[0].endswith('USD=X')) for r in YAHOO_IDX if r[1] == 'FX'}
# 야후 통화 표기 정리 (펜스·센트 단위 → 원래 통화 · 수익률에는 단위가 상관없음)
CUR_FIX = {'GBp': 'GBP', 'GBX': 'GBP', 'ZAc': 'ZAR', 'ZAC': 'ZAR', 'ILA': 'ILS', 'USX': 'USD', 'KWF': 'KWD'}


def norm_cur(c):
    c = str(c or 'USD')
    c = CUR_FIX.get(c, c)
    return c.upper()


def mk_of_tz(tz):
    """거래소 시간대 → 마감 시각 묶음 (KR 15:30 KST · AS 아시아·오세아니아 · EU 유럽·중동·아프리카 · US 미주)"""
    tz = tz or ''
    if tz == 'Asia/Seoul':
        return 'KR'
    if tz.startswith('America/'):
        return 'US'
    if tz.startswith(('Europe/', 'Africa/', 'Atlantic/')) or tz in ('Asia/Jerusalem', 'Asia/Tel_Aviv', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Kuwait',
                                                                   'Asia/Bahrain', 'Asia/Istanbul', 'Asia/Muscat', 'Asia/Amman', 'Asia/Beirut', 'Asia/Karachi'):
        return 'EU'
    if tz.startswith(('Asia/', 'Australia/', 'Pacific/')):
        return 'AS'
    return 'US'


# 단일 종목 ETF(레버리지·인버스·옵션 인컴)의 기초 종목 — 보유 종목에 스와프만 있어 이름에서 찾음
SINGLE_MARK = re.compile(r'\d(?:\.\d+)?[xX]\b|Daily Target|\bBull\b|\bBear\b|\bLong\b|\bShort\b|Inverse|Option Income|YieldBOOST|YieldMax|Income Strategy|WeeklyPay|Covered Call', re.I)
SINGLE_STOP = {'ETF', 'ETFS', 'ETN', 'USD', 'US', 'USA', 'AI', 'II', 'III', 'IV', 'TR', 'NAV', 'ESG', 'REIT', 'REITS', 'LLC', 'INC', 'PLC', 'SPDR', 'MSCI', 'FTSE',
               'CBOE', 'NYSE', 'DJ', 'EM', 'EAFE', 'UK', 'EU', 'IPO', 'ARK', 'KBW', 'FANG', 'BDC', 'MLP', 'LP', 'ADR', 'ADRS', 'OTM', 'ATM', 'MAX', 'TM', 'SP', 'CEF'}
KR_SINGLE = [('삼성전자', 'K:005930'), ('SK하이닉스', 'K:000660'), ('하이닉스', 'K:000660'), ('현대차', 'K:005380'), ('삼성바이오', 'K:207940'), ('LG에너지솔루션', 'K:373220'),
             ('셀트리온', 'K:068270'), ('네이버', 'K:035420'), ('NAVER', 'K:035420'), ('카카오', 'K:035720'), ('한화에어로', 'K:012450'), ('두산에너빌리티', 'K:034020'),
             ('HD현대중공업', 'K:329180'), ('테슬라', 'U:TSLA'), ('엔비디아', 'U:NVDA'), ('애플', 'U:AAPL'), ('마이크로소프트', 'U:MSFT'), ('아마존', 'U:AMZN'),
             ('알파벳', 'U:GOOGL'), ('구글', 'U:GOOGL'), ('메타', 'U:META'), ('브로드컴', 'U:AVGO'), ('팔란티어', 'U:PLTR'), ('TSMC', 'U:TSM'), ('코인베이스', 'U:COIN'),
             ('스트래티지', 'U:MSTR'), ('넷플릭스', 'U:NFLX'), ('일라이릴리', 'U:LLY'), ('아이온큐', 'U:IONQ'), ('AMD', 'U:AMD'), ('버크셔', 'U:BRK-B')]


def single_stock_keys(name, kr=False):
    """단일 종목 ETF 이름 → 기초 종목 키 목록 (국내: 정해 둔 이름표 · 미국: 이름 속 대문자 2~5자 티커, 레버리지·인컴 표시가 있을 때만)"""
    name = str(name or '')
    if kr:
        return [k for nm, k in KR_SINGLE if nm in name and ('단일종목' in name or '레버리지' in name or '커버드콜' in name or '채권혼합' in name or '인버스' in name or '밸런스' in name)][:1]
    if not SINGLE_MARK.search(name):
        return []
    toks = [t for t in re.findall(r'(?<![A-Za-z0-9&.-])([A-Z]{2,5})(?![A-Za-z0-9&])', name) if t not in SINGLE_STOP]
    return ['U:' + t for t in dict.fromkeys(toks)][:2]


def yahoo_holding_key(sym):
    """야후 상위 보유 종목 기호 → 캐시 키 (한국 종목 005930.KS·.KQ → K:005930 네이버 · 그 밖은 기호 그대로 U:)"""
    sym = str(sym or '').strip().upper()
    m = re.match(r'^([0-9]{6})\.(KS|KQ)$', sym)
    if m:
        return 'K:' + m.group(1)
    if re.match(r'^[A-Z0-9][A-Z0-9.=\-]{0,15}$', sym) and (sym[0].isalpha() or '.' in sym):
        return 'U:' + sym
    return None
NAVER_IDX = [('KOSPI', 'KR', 'KRW', '코스피'), ('KOSDAQ', 'KR', 'KRW', '코스닥'), ('KPI200', 'KR', 'KRW', '코스피 200')]
# ECOS 817Y002 시장금리(일별) — [항목 코드, 이름]
ECOS_RATES = [('010502000', 'CD91'), ('010101000', 'CALL'), ('010190000', 'KTB1'), ('010200000', 'KTB3'), ('010200001', 'KTB5'), ('010210000', 'KTB10'),
              ('010220000', 'KTB20'), ('010230000', 'KTB30'), ('010240000', 'KTB50'), ('010300000', 'CORP3'), ('010400000', 'MSB91'), ('010400001', 'MSB1'),
              ('010400002', 'MSB2'), ('010901000', 'KOFR'), ('010503000', 'CP91')]

_lock = threading.Lock()


def log(*a):
    with _lock:
        print(*a, flush=True)


def day(dt):
    return (dt - EPOCH).days


def get(url, tries=4, timeout=40, opener=None, headers=None, data=None):
    last = None
    for i in range(tries):
        try:
            h = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'}
            h.update(headers or {})
            req = urllib.request.Request(url, headers=h, data=data)
            with (opener.open(req, timeout=timeout) if opener else urllib.request.urlopen(req, timeout=timeout)) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 404):
                raise
            time.sleep(min(60, 3 * (2 ** i)) if e.code == 429 else 2 + 2 * i)
        except Exception as e:
            last = e
            time.sleep(2 + 2 * i)
    raise last


def fkey(key):
    """키 → 파일 이름 (기호 ^ = . : 를 안전한 글자로)"""
    return re.sub(r'[^0-9A-Za-z_-]', lambda m: '_%02x' % ord(m.group(0)), key)


class Cache:
    def __init__(self, root):
        self.root = root
        for d in ('series', 'meta/kr', 'meta/us'):
            os.makedirs(os.path.join(root, d), exist_ok=True)

    def path(self, key):
        return os.path.join(self.root, 'series', fkey(key) + '.npz')

    def load(self, key):
        p = self.path(key)
        if not os.path.exists(p):
            return None
        z = np.load(p, allow_pickle=False)
        return {k: z[k] for k in z.files}

    def save(self, key, s):
        tmp = self.path(key) + '.tmp.npz'
        np.savez_compressed(tmp, **s)
        os.replace(tmp, self.path(key))

    def meta_path(self, mk, code):
        return os.path.join(self.root, 'meta', mk, fkey(code) + '.json')


def merge(old, new):
    """이어 받은 구간(new)을 기존(old)에 합침 — 겹치는 날은 새 값
    새 분배(네이버 수정주가)·분할(야후 종가)·새 배당(야후 수정가)으로 과거 값이 통째로 바뀌므로, 겹치는 첫날의 새/옛 비율로 옛 구간을 맞춤 (종가·수정가 따로)"""
    if old is None or not len(old['d']):
        return new
    if not len(new['d']):
        return old
    nd0 = int(new['d'][0])
    keep = old['d'] < nd0
    oa, na = old.get('a', old['c']), new.get('a', new['c'])
    kc = ka = 1.0
    common = np.intersect1d(old['d'], new['d'])
    if len(common):
        i_o = int(np.searchsorted(old['d'], common[0])); i_n = int(np.searchsorted(new['d'], common[0]))
        if old['c'][i_o] > 0 and new['c'][i_n] > 0:
            kc = new['c'][i_n] / old['c'][i_o]
        if oa[i_o] > 0 and na[i_n] > 0:
            ka = na[i_n] / oa[i_o]
    out = {'d': np.concatenate([old['d'][keep], new['d']]).astype(np.int32),
           'c': np.concatenate([old['c'][keep] * kc, new['c']]), 'a': np.concatenate([oa[keep] * ka, na])}
    ovd = old.get('v_d', np.zeros(0, np.int32)); ova = old.get('v_a', np.zeros(0))
    out['v_d'] = np.concatenate([ovd[ovd < nd0], new.get('v_d', np.zeros(0, np.int32))]).astype(np.int32)
    out['v_a'] = np.concatenate([ova[ovd < nd0], new.get('v_a', np.zeros(0))])
    return out


# ───────────── 네이버 ─────────────
def naver_series(sym, start='19900101'):
    end = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=33)).strftime('%Y%m%d')
    t = get('https://api.finance.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=%s&endTime=%s&timeframe=day' % (sym, start, end)).decode('utf-8', 'replace')
    d, c = [], []
    for m in re.finditer(r'\["(\d{8})",\s*(?:-?[\d.]+|null),\s*(?:-?[\d.]+|null),\s*(?:-?[\d.]+|null),\s*(-?[\d.]+)', t):
        v = float(m.group(2))
        if v <= 0:
            continue
        x = day(datetime.date(int(m.group(1)[:4]), int(m.group(1)[4:6]), int(m.group(1)[6:])))
        if d and x <= d[-1]:
            if x == d[-1]:
                c[-1] = v
            continue
        d.append(x); c.append(v)
    s = {'d': np.array(d, np.int32), 'c': np.array(c, np.float64)}
    s['a'] = s['c'].copy()
    s['v_d'], s['v_a'] = np.zeros(0, np.int32), np.zeros(0)
    return s


def naver_meta(code):
    j = json.loads(get('https://m.stock.naver.com/api/stock/%s/etfAnalysis' % code))
    keep = ('itemCode', 'itemName', 'listedDate', 'issuerName', 'etfBaseIndex', 'totalFee', 'chaseErrorRate', 'taxationTypeCode', 'etfTop10MajorConstituentAssets',
            'dividend', 'assetPortfolioList', 'countryPortfolioList', 'marketValueRaw')
    return {k: j.get(k) for k in keep}


# ───────────── Cboe 옵션 전략 지수 (BuyWrite·PutWrite·칼라·버퍼·커버드콜 …) ─────────────
# 실제 옵션 가격으로 계산한 지수 — 커버드콜·버퍼(만기 결과 정의)·옵션 인컴 ETF 의 재현 후보 · 키 'C:<기호>' · 미국 장 마감 기준
CBOE_DEF = 'https://cdn-api.cboe.com/api/global/us_indices/definitions/all_indices.json'
CBOE_CSV = 'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/%s_History.csv'
CBOE_INC = re.compile(r'buywrite|buy-write|covered call|putwrite|put-write|call writing|defined income|collar|condor|butterfly|risk reversal|'
                      r'target income|buffer protect|enhanced growth|premium strategy|volatility risk premia', re.I)
CBOE_EXC = re.compile(r'\bCAD\b|\bJPY\b|UCITS|Intraday Indicative|INAV|Box Rate|Settlement', re.I)


def cboe_list():
    """Cboe 지수 정의 목록에서 옵션 전략 지수만 → {기호: 이름} (캐나다 달러·엔화·UCITS 판·ETF 추정 가치·박스 금리·결제 기호는 뺌)"""
    out = {}
    for x in json.loads(get(CBOE_DEF)):
        s, nm = (x.get('index_symbol') or '').strip(), (x.get('name') or '').strip()
        if re.match(r'^[A-Z0-9]{2,12}$', s) and CBOE_INC.search(nm) and not CBOE_EXC.search(nm):
            out[s] = nm
    return out


def cboe_series(sym):
    """Cboe 일별 종가 CSV ('DATE,…,종가' · 날짜 MM/DD/YYYY) → 일봉 (값은 소수 6자리 — 화면이 받는 파일과 같게)"""
    t = get(CBOE_CSV % sym).decode('utf-8', 'replace').splitlines()
    if not t or not t[0].upper().startswith('DATE'):
        raise ValueError('형식')
    m = {}
    for l in t[1:]:
        f = l.strip().split(',')
        if len(f) < 2:
            continue
        try:
            mo, dd, yy = f[0].split('/')
            v = float(f[-1])
            x = day(datetime.date(int(yy), int(mo), int(dd)))
        except Exception:
            continue
        if v > 0 and math.isfinite(v):
            m[x] = round(v, 6)
    d = sorted(m)
    s = {'d': np.array(d, np.int32), 'c': np.array([m[x] for x in d], np.float64)}
    s['a'] = s['c'].copy()
    s['v_d'], s['v_a'] = np.zeros(0, np.int32), np.zeros(0)
    return s


# ───────────── 한국거래소 옵션 전략 지수 (코스피 200 커버드콜·위클리 커버드콜·양매도·버퍼 …) ─────────────
# KRX 지수 누리집(로그인 없이 보는 화면)이 쓰는 방식 그대로: 일회용 코드(GenerateOTP) → 표 자료(IDX99000001) · 키 'D:<지수 ID>' · 국내 장 마감 기준
KRX_IDX = 'https://index.krx.co.kr'
KRX_LIST_BLD = '/IDX/03/0304/03040100/mkd03040100'         # 파생상품지수 목록 (upclss 02 · midclss 02 = 옵션)
KRX_HIST_BLD = '/IDX/03/0304/03040101/mkd03040101T2_02'    # 지수 상세 > 데이터 > 일자별 (기간 전체를 한 번에)


def krx_grid(bld, params):
    code = get(KRX_IDX + '/contents/COM/GenerateOTP.jspx?' + urllib.parse.urlencode({'bld': bld, 'name': 'grid'}),
               headers={'X-Requested-With': 'XMLHttpRequest'}).decode().strip()
    if not code or len(code) < 10 or code.startswith('<'):
        raise ValueError('OTP')
    p = dict(params); p['code'] = code
    j = json.loads(get(KRX_IDX + '/contents/IDX/99/IDX99000001.jspx', data=urllib.parse.urlencode(p).encode(),
                       headers={'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}))
    if not isinstance(j, dict) or not j:
        raise ValueError('형식')
    return j[list(j)[0]] or []


def krx_list():
    """한국거래소 옵션 전략 지수 목록 → {지수 ID: {nm 한글 이름, en 영문 이름, cd 지수 코드(구분+번호), tp 구분}}"""
    bz = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    out = {}
    for lang in ('ko', 'en'):
        for x in krx_grid(KRX_LIST_BLD, {'idx_upclss_cd': '02', 'idx_midclss_cd': '02', 'lang': lang, 'add_data_yn': 'N', 'bz_dd': bz.strftime('%Y%m%d')}):
            iid, tp, ind = (x.get('idx_id') or '').strip(), (x.get('ind_tp_cd') or '').strip(), (x.get('idx_ind_cd') or '').strip()
            if not re.match(r'^[A-Z0-9]{4,8}$', iid) or not tp or not ind:
                continue
            o = out.setdefault(iid, {'cd': tp + ind, 'tp': tp, 'ind': ind})
            o['nm' if lang == 'ko' else 'en'] = re.sub(r'\s+', ' ', (x.get('idx_nm') or '').strip())
    out = {k: v for k, v in out.items() if v.get('nm')}
    if len(out) < 20:
        raise ValueError('목록 %d개' % len(out))
    return out


def krx_series(info):
    """지수 하나의 일별 종가 (기준일부터 전체) → 일봉"""
    today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).strftime('%Y%m%d')
    rows = krx_grid(KRX_HIST_BLD, {'idx_cd': info['cd'], 'ind_tp_cd': info['tp'], 'idx_ind_cd': info['ind'], 'add_data_yn': '', 'bz_dd': '',
                                   'fromdate': '19900101', 'todate': today})
    m = {}
    for r in rows:
        try:
            yy, mo, dd = (r.get('trd_dd') or '').split('/')
            v = float((r.get('clsprc_idx') or '').replace(',', ''))
            x = day(datetime.date(int(yy), int(mo), int(dd)))
        except Exception:
            continue
        if v > 0 and math.isfinite(v):
            m[x] = round(v, 4)
    if len(m) < 2:
        raise ValueError('자료 %d일' % len(m))
    d = sorted(m)
    s = {'d': np.array(d, np.int32), 'c': np.array([m[x] for x in d], np.float64)}
    s['a'] = s['c'].copy()
    s['v_d'], s['v_a'] = np.zeros(0, np.int32), np.zeros(0)
    return s


# ───────────── 야후 ─────────────
class Yahoo:
    def __init__(self):
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookiejar.CookieJar()))
        self.crumb = None
        self.lock = threading.Lock()

    def get_crumb(self, force=False):
        with self.lock:
            if self.crumb and not force:
                return self.crumb
            try:
                get('https://fc.yahoo.com', tries=1, opener=self.op)
            except Exception:
                pass
            self.crumb = get('https://query1.finance.yahoo.com/v1/test/getcrumb', opener=self.op).decode().strip()
            return self.crumb

    def series(self, sym, start_day=None):
        p1 = -2208988800 if start_day is None else max(-2208988800, (start_day - 15) * 86400)
        u = 'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%d&period2=%d&interval=1d&includePrePost=false&events=div%%7Csplit' % (
            urllib.parse.quote(sym), p1, int(time.time()) + 86400)
        j = json.loads(get(u))
        r = (j.get('chart') or {}).get('result') or []
        if not r:
            raise ValueError('no result')
        r = r[0]
        ts = r.get('timestamp') or []
        q = ((r.get('indicators') or {}).get('quote') or [{}])[0]
        ac = (((r.get('indicators') or {}).get('adjclose') or [{}])[0]).get('adjclose')
        off = (r.get('meta') or {}).get('gmtoffset') or 0
        # 화면 parseU + depOf 와 똑같이: 종가·수정 종가 중 하나라도 있으면 그날을 두고(같은 날 둘이면 뒤 값),
        # 종가가 빠진 날은 앞쪽 가장 가까운 '종가·수정 종가가 다 있는 날'의 비율로 메움 → a = 종가 × (수정 종가 ÷ 종가, 빠지면 직전 비율)
        cl_ = q.get('close') or [None] * len(ts)
        d, v, aa = [], [], []
        for i, t in enumerate(ts):
            c0 = cl_[i] if i < len(cl_) and cl_[i] is not None and cl_[i] > 0 else None
            q0 = ac[i] if ac and i < len(ac) and ac[i] is not None and ac[i] > 0 else None
            if c0 is None and q0 is None:
                continue
            x = int((t + off) // 86400)
            if d and x <= d[-1]:
                if x == d[-1]:
                    v[-1], aa[-1] = c0, q0
                continue
            d.append(x); v.append(c0); aa.append(q0)
        D_, V_, A_ = [], [], []
        for i in range(len(d)):
            c2 = v[i]
            if c2 is None:
                k2 = i - 1
                while k2 >= 0 and c2 is None:
                    if v[k2] is not None and aa[k2] is not None and aa[i] is not None:
                        c2 = v[k2] * aa[i] / aa[k2]
                    k2 -= 1
            if c2 is None or not (c2 > 0):
                continue
            D_.append(d[i]); V_.append(c2); A_.append(aa[i])
        d, c, a = D_, V_, []
        ratio = 1.0
        for i in range(len(d)):
            if A_[i] is not None and A_[i] > 0 and c[i] > 0:
                ratio = A_[i] / c[i]
            a.append(c[i] * ratio)
        dv = sorted(((int((v['date'] + off) // 86400), float(v['amount'])) for v in ((r.get('events') or {}).get('dividends') or {}).values()
                     if v.get('amount') and v.get('date')), key=lambda x: x[0])
        m = r.get('meta') or {}
        s = {'d': np.array(d, np.int32), 'c': np.array(c, np.float64), 'a': np.array(a, np.float64),
             'v_d': np.array([x[0] for x in dv], np.int32), 'v_a': np.array([x[1] for x in dv], np.float64)}
        info = {'cur': norm_cur(m.get('currency')), 'type': m.get('instrumentType'), 'exch': m.get('exchangeName'), 'tz': m.get('exchangeTimezoneName'), 'off': off,
                'first': m.get('firstTradeDate'), 'name': m.get('longName') or m.get('shortName')}
        return s, info

    def meta(self, sym):
        for attempt in range(3):
            crumb = self.get_crumb(force=attempt > 0)
            u = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=topHoldings,fundProfile,summaryDetail,quoteType&crumb=%s' % (
                urllib.parse.quote(sym), urllib.parse.quote(crumb))
            try:
                j = json.loads(get(u, opener=self.op, tries=2))
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    continue
                if e.code == 404:
                    return {}
                raise
            r = ((j.get('quoteSummary') or {}).get('result') or [{}])[0]
            th, fp, sd, qt = r.get('topHoldings') or {}, r.get('fundProfile') or {}, r.get('summaryDetail') or {}, r.get('quoteType') or {}
            raw = lambda o: (o or {}).get('raw') if isinstance(o, dict) else o
            return {'holdings': [[h.get('symbol'), raw(h.get('holdingPercent')), h.get('holdingName')] for h in th.get('holdings') or []],
                    'stock': raw(th.get('stockPosition')), 'bond': raw(th.get('bondPosition')), 'cash': raw(th.get('cashPosition')),
                    'category': fp.get('categoryName'), 'family': fp.get('family'),
                    'er': raw(((fp.get('feesExpensesInvestment') or {}).get('annualReportExpenseRatio'))),
                    'yield': raw(sd.get('yield')), 'name': qt.get('longName') or qt.get('shortName'), 'inception': raw(qt.get('firstTradeDateEpochUtc'))}
        return {}


# ───────────── ECOS ─────────────
def ecos_rates(old=None):
    """한국은행 ECOS 시장금리(일별) → ({이름: {d, v}}, ECOS 무응답 여부)
    · 못 받았거나 지난 값보다 크게 짧아진 금리는 지난 값 그대로 (일부만 실패해도 금리가 빠지지 않게)
    · 두 번 잇따라 실패하면 ECOS 가 응답하지 않는 것으로 보고 나머지는 건너뜀 (금리마다 3분씩 기다리지 않게)"""
    today = datetime.date.today().strftime('%Y%m%d')
    out = dict(old or {})
    fails = 0
    for code, name in ECOS_RATES:
        try:
            j = json.loads(get('https://ecos.bok.or.kr/api/StatisticSearch/%s/json/kr/1/100000/817Y002/D/19900101/%s/%s' % (ECOS_KEY, today, code)))
            rows = (j.get('StatisticSearch') or {}).get('row') or []
            dd, vv = [], []
            for r in rows:
                t = r.get('TIME'); v = r.get('DATA_VALUE')
                try:
                    x = day(datetime.date(int(t[:4]), int(t[4:6]), int(t[6:8]))); v = float(v)
                except Exception:
                    continue
                if dd and x <= dd[-1]:
                    continue
                dd.append(x); vv.append(v)
            fails = 0
            prev = (out.get(name) or {}).get('d') or []
            if len(dd) < 0.9 * len(prev):
                log('ECOS', name, '이번 값(%d일)이 지난 값(%d일)보다 크게 짧아 지난 값 그대로' % (len(dd), len(prev)))
                continue
            out[name] = {'d': dd, 'v': vv}
            log('ECOS', name, len(dd), (EPOCH + datetime.timedelta(dd[0])).isoformat() if dd else '-')
        except Exception as e:
            log('ECOS 실패', name, e)
            fails += 1
            if fails >= 2:
                log('ECOS 응답 없음 — 남은 금리·환율은 지난 값 그대로')
                return out, True
    return out, False


def ecos_fx():
    """한국은행 ECOS 731Y003 원/달러 종가(15:30) — 국내 ETF 종가(15:30)와 같은 시각의 환율 (1990-03 ~)"""
    today = datetime.date.today().strftime('%Y%m%d')
    j = json.loads(get('https://ecos.bok.or.kr/api/StatisticSearch/%s/json/kr/1/100000/731Y003/D/19900101/%s/0000003' % (ECOS_KEY, today)))
    dd, vv = [], []
    for r in (j.get('StatisticSearch') or {}).get('row') or []:
        t = r.get('TIME')
        try:
            x = day(datetime.date(int(t[:4]), int(t[4:6]), int(t[6:8]))); v = float(r.get('DATA_VALUE'))
        except Exception:
            continue
        if v > 0 and (not dd or x > dd[-1]):
            dd.append(x); vv.append(v)
    log('ECOS 원/달러 15:30', len(dd), (EPOCH + datetime.timedelta(dd[0])).isoformat() if dd else '-')
    return {'USDKRW': {'d': dd, 'v': vv}} if len(dd) > 1000 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.btcache'))
    ap.add_argument('--full', action='store_true')
    ap.add_argument('--only', help='쉼표로 나눈 키 (K:069500,U:SPY …)')
    ap.add_argument('--threads', type=int, default=6)
    ap.add_argument('--skip-meta', action='store_true')
    ap.add_argument('--meta-days', type=int, default=7, help='이 날수보다 오래된 구성 정보만 다시 받음')
    ap.add_argument('--src', choices=('all', 'yahoo', 'naver', 'cboe', 'krx'), default='all', help='이 출처의 일봉만')
    ap.add_argument('--retry-err', action='store_true', help='지난번 실패한 키만')
    a = ap.parse_args()
    C = Cache(a.cache)
    Y = Yahoo()
    lst = json.load(open(os.path.join(ROOT, 'data', 'etf_list.json'), encoding='utf-8'))
    kr = [r[0] for r in lst['kr']]
    us = [r[0] for r in lst['us']]
    uni_path = os.path.join(a.cache, 'universe.json')
    try:
        uni = json.load(open(uni_path, encoding='utf-8'))
    except Exception:
        uni = {}
    t0 = time.time()

    # 1. 구성 정보 (국내 네이버 · 미국 야후) — 상위 10 종목을 주식 일봉 대상으로
    def meta_one(mk, code):
        p = C.meta_path(mk, code)
        if os.path.exists(p) and time.time() - os.path.getmtime(p) < a.meta_days * 86400:
            return 'keep'
        try:
            m = naver_meta(code) if mk == 'kr' else Y.meta(code)
        except Exception as e:
            return 'fail %s' % str(e)[:60]
        json.dump(m, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
        return 'ok'

    if not a.skip_meta and not a.only:
        jobs = [('kr', c) for c in kr] + [('us', t) for t in us]
        cnt = {}
        with cf.ThreadPoolExecutor(a.threads) as ex:
            for i, r in enumerate(ex.map(lambda x: meta_one(*x), jobs)):
                k = r.split(' ')[0]; cnt[k] = cnt.get(k, 0) + 1
                if (i + 1) % 500 == 0:
                    log('구성 정보 %d/%d %s · %.0fs' % (i + 1, len(jobs), cnt, time.time() - t0))
        log('구성 정보 끝', cnt)

    # 2. 일봉 대상 키
    keys = {}
    for c in kr:
        keys['K:' + c] = ('naver', c, 'KR', 'KRW', 'etf')
    for t in us:
        keys['U:' + t] = ('yahoo', t, 'US', 'USD', 'etf')
    for s, mk, cur, nm in YAHOO_IDX:
        keys['Y:' + s] = ('yahoo', s, mk, cur, 'idx')
    for s, mk, cur, nm in NAVER_IDX:
        keys['N:' + s] = ('naver', s, mk, cur, 'idx')
    cboe_names = {}
    if not a.only and a.src in ('all', 'cboe'):
        try:
            cboe_names = cboe_list()
        except Exception as e:
            log('Cboe 지수 목록 실패 — 지난 목록으로', str(e)[:80])
            cboe_names = {k[2:]: v.get('name') or k[2:] for k, v in uni.items() if k.startswith('C:') and not v.get('err')}
    elif a.only:
        cboe_names = {k[2:]: (uni.get(k) or {}).get('name') or k[2:] for k in a.only.split(',') if k.startswith('C:')}
    for s, nm in cboe_names.items():
        keys['C:' + s] = ('cboe', s, 'US', 'USD', 'idx')
    krx_info = {}
    if not a.only and a.src in ('all', 'krx'):
        try:
            krx_info = krx_list()
        except Exception as e:
            log('한국거래소 옵션 지수 목록 실패 — 지난 목록으로', str(e)[:80])
            krx_info = {k[2:]: v['krx'] for k, v in uni.items() if k.startswith('D:') and (v.get('krx') or {}).get('cd')}
    elif a.only:
        krx_info = {k[2:]: (uni.get(k) or {}).get('krx') for k in a.only.split(',') if k.startswith('D:') and (uni.get(k) or {}).get('krx')}
    for s, inf in krx_info.items():
        keys['D:' + s] = ('krx', s, 'KR', 'KRW', 'idx')
    # 상위 보유 종목 (주식) — 국내: 6자리 코드(ETF 목록에 없는 것) · 미국: 야후 기호
    kr_set, us_set = set(kr), set(us)
    for c in kr:
        try:
            m = json.load(open(C.meta_path('kr', c), encoding='utf-8'))
        except Exception:
            continue
        for h in m.get('etfTop10MajorConstituentAssets') or []:
            ic = str(h.get('itemCode') or '')
            if re.match(r'^[0-9][0-9A-Z]{5}$', ic) and ic not in kr_set:
                keys.setdefault('K:' + ic, ('naver', ic, 'KR', 'KRW', 'stk'))
    for t in us:
        try:
            m = json.load(open(C.meta_path('us', t), encoding='utf-8'))
        except Exception:
            continue
        for h in m.get('holdings') or []:
            hk = yahoo_holding_key(h[0])
            if not hk or hk[2:] in (kr_set if hk[0] == 'K' else us_set):
                continue
            keys.setdefault(hk, ('naver', hk[2:], 'KR', 'KRW', 'stk') if hk[0] == 'K' else ('yahoo', hk[2:], 'US', 'USD', 'stk'))
    # 단일 종목 ETF 의 기초 종목 (이름으로) — 국내 · 미국
    for c in kr:
        try:
            nm = json.load(open(C.meta_path('kr', c), encoding='utf-8')).get('itemName')
        except Exception:
            nm = ''
        for k in single_stock_keys(nm, kr=True):
            if k[2:] not in (kr_set if k[0] == 'K' else us_set):
                keys.setdefault(k, ('naver', k[2:], 'KR', 'KRW', 'stk') if k[0] == 'K' else ('yahoo', k[2:], 'US', 'USD', 'stk'))
    for t in us:
        nm = (uni.get('U:' + t) or {}).get('name') or ''
        for k in single_stock_keys(nm):
            if k[2:] not in us_set:
                keys.setdefault(k, ('yahoo', k[2:], 'US', 'USD', 'stk'))
    # 예전 규칙(점 → 하이픈)으로 만든 잘못된 키 등 이제 대상이 아닌 실패 키는 지움
    for k in [k for k, v in uni.items() if v.get('err') and k not in keys]:
        del uni[k]
    if a.only:
        want = set(a.only.split(','))
        keys = {k: v for k, v in keys.items() if k in want}
    if a.src != 'all':
        keys = {k: v for k, v in keys.items() if v[0] == a.src}
    if a.retry_err:
        keys = {k: v for k, v in keys.items() if k not in uni or uni[k].get('err')}
    log('일봉 대상 %d개 (국내 ETF %d · 미국 ETF %d · 지수 등 %d · Cboe 옵션 전략 지수 %d · 한국거래소 옵션 전략 지수 %d · 주식 %d)' % (
        len(keys), len(kr), len(us), len(YAHOO_IDX) + len(NAVER_IDX), sum(1 for v in keys.values() if v[0] == 'cboe'),
        sum(1 for v in keys.values() if v[0] == 'krx'), sum(1 for v in keys.values() if v[4] == 'stk')))

    # 3. 일봉
    def series_one(key):
        src, sym, mk, cur, kind = keys[key]
        old = None if a.full else C.load(key)
        last = int(old['d'][-1]) if old is not None and len(old['d']) else None
        try:
            if src == 'naver':
                st = (EPOCH + datetime.timedelta(last - 15)).strftime('%Y%m%d') if last else '19900101'
                new, info = naver_series(sym, st), {'cur': cur}
            elif src == 'cboe':
                new, info = cboe_series(sym), {'cur': 'USD', 'name': cboe_names.get(sym) or sym}
                old = None                                            # Cboe CSV 는 늘 전체 기간 → 통째로 바꿈 (지수 회사가 고친 과거 값도 반영)
            elif src == 'krx':
                inf = krx_info[sym]
                new, info = krx_series(inf), {'cur': 'KRW', 'name': inf.get('nm') or sym, 'name_en': inf.get('en') or '', 'krx': inf}
                old = None                                            # 기준일부터 전체를 한 번에 받음 → 통째로 바꿈
            else:
                new, info = Y.series(sym, last)
        except Exception as e:
            st = ('http %d' % e.code) if isinstance(e, urllib.error.HTTPError) else ('fail %s' % str(e)[:60])
            if old is not None and len(old['d']) and not (uni.get(key) or {}).get('err') and (uni.get(key) or {}).get('n'):
                return key, 'stale', None                 # 이번에 못 받았지만 지난 자료가 있음 → 그대로 씀 (일시 오류로 식이 빠지지 않게)
            return key, st, None
        s = merge(old, new) if old is not None else new
        if not len(s['d']):
            return key, 'empty', None
        C.save(key, s)
        if src == 'yahoo' and kind in ('stk', 'etf') and info.get('tz'):
            mk = mk_of_tz(info['tz'])                                 # 해외 상장 종목(7203.T·ASML.AS …)은 그 거래소 마감 시각대로
        info.update({'mk': mk, 'kind': kind, 'src': src, 'cur': norm_cur(info.get('cur') or cur), 'start': int(s['d'][0]), 'end': int(s['d'][-1]), 'n': int(len(s['d']))})
        return key, 'ok', info

    cnt = {}
    with cf.ThreadPoolExecutor(a.threads) as ex:
        for i, (key, st, info) in enumerate(ex.map(series_one, sorted(keys))):
            cnt[st.split(' ')[0]] = cnt.get(st.split(' ')[0], 0) + 1
            if info:
                info.pop('err', None)
                uni[key] = info
            elif st not in ('ok', 'stale'):
                uni.setdefault(key, {}).update({'err': st})
            if (i + 1) % 500 == 0:
                log('일봉 %d/%d %s · %.0fs' % (i + 1, len(keys), cnt, time.time() - t0))
                json.dump(uni, open(uni_path, 'w', encoding='utf-8'))
    json.dump(uni, open(uni_path, 'w', encoding='utf-8'))
    log('일봉 끝', cnt)

    # 4. 금리·환율 (ECOS)
    if not a.only and a.src in ('all', 'naver'):
        update_ecos(a.cache)
    log('완료 %.0fs' % (time.time() - t0))


def update_ecos(cache):
    """캐시의 rates.json(시장금리)·fx.json(원/달러 15:30 종가)을 ECOS 로 갱신 — 못 받은 것·크게 짧아진 것은 지난 값 그대로"""
    rp, fp = os.path.join(cache, 'rates.json'), os.path.join(cache, 'fx.json')
    try:
        old = json.load(open(rp, encoding='utf-8')) if os.path.exists(rp) else {}
    except Exception:
        old = {}
    r, down = ecos_rates(old)
    if r and r != old:
        json.dump(r, open(rp, 'w', encoding='utf-8'))
    if down:
        return
    try:
        fx = ecos_fx()
        n_old = len(json.load(open(fp, encoding='utf-8'))['USDKRW']['d']) if fx and os.path.exists(fp) else 0
        if fx and len(fx['USDKRW']['d']) < 0.9 * n_old:
            log('ECOS 원/달러 이번 값(%d일)이 지난 값(%d일)보다 크게 짧아 지난 값 그대로' % (len(fx['USDKRW']['d']), n_old))
        elif fx:
            json.dump(fx, open(fp, 'w', encoding='utf-8'))
    except Exception as e:
        log('ECOS 환율 실패', e)


if __name__ == '__main__':
    main()
