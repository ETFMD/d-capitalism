"""ETF 차트 비교 — 상장 전 백테스트 회귀 테스트용 합성 자료와 기대값

화면(src/index.html btLevels·btCC·btSplice·btJoin)이 만든 백테스트를, scripts/etf_bt_fit.py 의 bt_levels(파이썬 기준 구현)로 같은 합성 자료에서
따로 계산한 값과 맞춰 봄. 합성 자료는 run_regression.py 의 합성 일봉(etf_body)을 그대로 쓰고, 식 묶음·금리·환율·S&P TR 앞부분 파일만 여기서 만듦.

식 (모두 실제 목록에 있는 ETF — 기존 ETF 시나리오가 쓰지 않는 것만):
  K:133690  SPY × 원/달러 (환 노출 'u' · 시차 1 · 원/달러 15:30 종가 파일)
  K:122630  KODEX 200 + 위클리 콜 매도 덧씌우기 (국내 목요일 만기 · 1% OTM)
  U:QLD     QQQ 2배               ← U:TQQQ 의 후보 (체인: TQQQ 백테스트가 QLD 백테스트를 이어 붙여 QQQ 상장일까지)
  U:TQQQ    QLD 1.5배
  U:SSO     S&P 500 TR 2배 (X:SPXTR = 앞부분 파일 + ^SP500TR)
  U:IWM     자료가 없는 후보(U:NODATA) → 재료를 못 받아 실제 기간만 + 경고
  U:QYLD    옵션 전략 지수 C:BXNT (data/etfbt/r/C_BXNT.json)
  D:O2903P  한국거래소 옵션 지수(코스피 200 커버드콜 ATM) 자체의 식 — 코스피 200 + 월간 콜 매도 + 모의 커버드콜 Z:M00L90
            (지수 기준일 전 재현 · 이 식만 쓰는 재료 · 모의 커버드콜은 파이썬이 만든 파일 data/etfbt/r/Z_M00L90.json)
  K:289480  D:O2903P 1배 ← 체인: 지수 파일(data/etfbt/r/D_O2903P.json)에 지수 식의 백테스트를 이어 붙여 기준일(2013) 전까지 · 이름 '한글|영문'
"""
import datetime as _dt
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_EP = _dt.date(1970, 1, 1)
NSHARD = 16

BT_FIRST = {'K133690': _dt.date(2010, 10, 18), 'K122630': _dt.date(2010, 2, 22), 'UQLD': _dt.date(2006, 6, 21), 'UTQQQ': _dt.date(2010, 2, 11),
            'USSO': _dt.date(2006, 6, 21), 'UIWM': _dt.date(2000, 5, 26), 'K091160': _dt.date(2012, 1, 2), 'UQYLD': _dt.date(2013, 12, 12),
            'K289480': _dt.date(2018, 2, 9)}
CBOE_FROM = _dt.date(1994, 12, 30)                # 합성 Cboe 옵션 전략 지수(C:BXNT) 시작 (미국 달력 안)
KRX_FROM = _dt.date(2013, 1, 2)                   # 합성 한국거래소 옵션 지수(D:O2903P) 기준일 (국내 달력 안)
ZSIM_FROM = _dt.date(2003, 1, 2)                  # 합성 모의 커버드콜(Z:M00L90) 시작 — 실제처럼 VKOSPI 시작일 (국내 달력 안)
ZSIM_NAME = '코스피 200 커버드콜 모의(월간 ATM · VKOSPI×0.9)|KOSPI 200 covered call model (monthly ATM, VKOSPI×0.9)'
DEP_FIRST = {'K005930': _dt.date(1996, 1, 3),   # 후보 종목 합성 일봉 시작 (자료 오류를 일부러 넣음 — run_regression.etf_series)
             'KKPI200': _dt.date(1996, 1, 3)}   # 코스피 200 (한국거래소 옵션 지수 식만 쓰는 후보 — 지수 식의 재료까지 받는지)
CAL_FIRST = {'KKOSPI': _dt.date(1995, 1, 3), 'U^GSPC': _dt.date(1985, 1, 2), 'U^SP500TR': _dt.date(1990, 1, 2)}
SPX_PRE_FROM = _dt.date(1986, 1, 2)          # 앞부분 파일 시작 (^GSPC 달력 안)


def day(d):
    return (d - _EP).days


def btshard(key):
    return sum(ord(c) for c in key) % NSHARD


def recipes():
    dv4 = {'y': 0.012, 'f': 4, 'm': [1, 4, 7, 10], 'dom': 28, 'tx': 1.0}
    R = {
        'K:133690': {'s': day(BT_FIRST['K133690']), 'c': 'KRW', 'n': 900, 'dv': dv4, 'm': [['U:SPY', 1, 0.98, 'u', 'USD', 'SPY']], 'd': 0.004,
                     'e': [0.003, 0.02, 0.0202, 3], 'k': 'fit', 'ec': 0.0202},
        'K:122630': {'s': day(BT_FIRST['K122630']), 'c': 'KRW', 'n': 900, 'm': [['K:069500', 0, 0.9, 'n', 'KRW', 'KODEX 200'],
                     ['K:069500', 0, 0.3, 'n', 'KRW', 'KODEX 200', ['W', 0.01, 1.0]]], 'd': -0.01, 'e': [0.01, 0.03, 0.0316, 3], 'k': 'fit', 'cc': 1, 'ec': 0.0316},
        'U:QLD': {'s': day(BT_FIRST['UQLD']), 'c': 'USD', 'n': 900, 'm': [['U:QQQ', 0, 2.0, 'n', 'USD', 'QQQ']], 'd': -0.02, 'e': [0.002, 0.01, 0.0102, 3],
                  'k': 'fit', 'ec': 0.0102},
        'U:TQQQ': {'s': day(BT_FIRST['UTQQQ']), 'c': 'USD', 'n': 900, 'dv': {'y': 0.004, 'f': 4, 'm': [3, 6, 9, 12], 'dom': 22, 'tx': 1.0},
                   'm': [['U:QLD', 0, 1.5, 'n', 'USD', 'QLD']], 'd': 0.001, 'e': [0.001, 0.006, 0.0061, 3], 'k': 'fit', 'ec': 0.012},
        'U:SSO': {'s': day(BT_FIRST['USSO']), 'c': 'USD', 'n': 900, 'm': [['X:SPXTR', 0, 2.0, 'n', 'USD', 'S&P 500 TR']], 'd': -0.015,
                  'e': [0.004, 0.012, 0.0126, 3], 'k': 'fit', 'ec': 0.0126},
        'U:IWM': {'s': day(BT_FIRST['UIWM']), 'c': 'USD', 'n': 900, 'm': [['U:NODATA', 0, 1.0, 'n', 'USD', 'NODATA']], 'd': 0.0, 'e': [0.001, 0.01, 0.0101, 3],
                  'k': 'fit', 'ec': 0.0101},
        # Cboe 옵션 전략 지수 후보 — 화면이 data/etfbt/r/C_BXNT.json 을 받아 같은 값으로 계산하는지
        'U:QYLD': {'s': day(BT_FIRST['UQYLD']), 'c': 'USD', 'n': 900, 'dv': {'y': 0.12, 'f': 12, 'm': list(range(1, 13)), 'dom': 20, 'tx': 1.0},
                   'm': [['C:BXNT', 0, 0.99, 'n', 'USD', 'NASDAQ-100 BuyWrite V2(BXNT)']], 'd': -0.004, 'e': [0.0, 0.0105, 0.0105, 3], 'k': 'fit', 'ec': 0.0105},
        # 한국거래소 옵션 지수 — 지수 자체의 식(기준일 전 재현)과 그 지수를 쓰는 ETF (체인 · 지수 파일 · 한·영 이름)
        'D:O2903P': {'s': day(KRX_FROM), 'c': 'KRW', 'n': 900, 'm': [['N:KPI200', 0, 0.75, 'n', 'KRW', '코스피 200'],
                     ['N:KPI200', 0, 0.9, 'n', 'KRW', '코스피 200', ['M', 0.0, 1.0]], ['Z:M00L90', 0, 0.2, 'n', 'KRW', ZSIM_NAME]], 'd': -0.012, 'e': [0.004, 0.025, 0.0253, 3], 'k': 'fit', 'cc': 1, 'ec': 0.0253},
        'K:289480': {'s': day(BT_FIRST['K289480']), 'c': 'KRW', 'n': 900, 'dv': {'y': 0.07, 'f': 12, 'm': list(range(1, 13)), 'dom': 28, 'tx': 0.3},
                     'm': [['D:O2903P', 0, 1.0, 'n', 'KRW', '코스피 200 커버드콜 ATM 지수|KOSPI 200 Covered Call ATM']], 'd': -0.004,
                     'e': [0.001, 0.008, 0.0081, 3], 'k': 'fit', 'ec': 0.02657},
        # 국내 종목 후보(합성 일봉에 튀었다 돌아온 값·가격제한폭 밖 끊김을 넣음) — 화면이 자료 정리(btClean)를 거쳐 쓰는지
        'K:091160': {'s': day(BT_FIRST['K091160']), 'c': 'KRW', 'n': 900, 'm': [['K:005930', 0, 1.2, 'n', 'KRW', '삼성전자']], 'd': -0.003,
                     'e': [0.002, 0.012, 0.0122, 3], 'k': 'fit', 'ec': 0.0122},
    }
    for r in R.values():                                  # 예상 오차 (scripts/etf_bt_fit.py x_err 와 같은 식)
        r['x'] = round(math.sqrt((1.65 * r['e'][2]) ** 2 + 0.004 ** 2), 5)
        r['xc'] = round(math.sqrt((1.65 * r['ec']) ** 2 + 0.004 ** 2), 5)
    return R


def shard_body(i):
    e = {k: r for k, r in recipes().items() if btshard(k) == i}
    return json.dumps({'updated': _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'e': e}, ensure_ascii=False)


class Synth:
    """run_regression 의 합성 일봉(etf_series·etf_body)을 받아 화면이 보는 값(depOf)과 같은 시계열·금리 파일을 만듦"""

    def __init__(self, etf_series, etf_body):
        self.etf_series, self.etf_body = etf_series, etf_body
        self._c = {}

    def raw(self, key):                                   # 화면이 Worker 로 받는 일봉 → depOf 와 같은 { d, a, cur }
        if key in self._c:
            return self._c[key]
        p, sym = key[0], key[2:]
        if p in ('K', 'N'):
            body = self.etf_body('K' + sym)
            rows = json.loads(body)[1:]
            d = [day(_dt.date(int(r[0][:4]), int(r[0][4:6]), int(r[0][6:]))) for r in rows]
            a = [float(r[4]) for r in rows]
            out = {'d': d, 'a': a, 'cur': 'KRW'}
        else:
            j = json.loads(self.etf_body('U' + sym))['chart']['result'][0]
            off = j['meta']['gmtoffset']
            cl, ac = j['indicators']['quote'][0]['close'], j['indicators']['adjclose'][0]['adjclose']
            d, a, r_ = [], [], 1.0
            for t, c, q in zip(j['timestamp'], cl, ac):
                if q and c:
                    r_ = q / c
                d.append((t + off) // 86400); a.append(c * r_)
            out = {'d': d, 'a': a, 'cur': 'USD'}
        self._c[key] = out
        return out

    def cal_days(self, key):
        return self.raw(key)['d']

    def rate(self, key):
        """R:KRW (국내 달력 · CD91 처럼) · R:USD (미국 달력) — 금리 %"""
        d = self.cal_days('N:KOSPI' if key == 'R:KRW' else 'Y:^GSPC')
        y = [round(3.0 + 1.5 * math.sin(t / 400.0) if key == 'R:KRW' else 4.0 + 2.0 * math.sin(t / 500.0), 4) for t in range(len(d))]
        return {'k': key, 'mat': 0, 'cur': 'KRW' if key == 'R:KRW' else 'USD', 'd': d, 'y': y}

    def usdkrw(self):
        d = self.cal_days('N:KOSPI')
        return {'d': d, 'c': [round(1100 + 150 * math.sin(t / 300.0) + 30 * math.sin(t / 37.0), 2) for t in range(len(d))]}

    def spx_pre(self):
        g = self.cal_days('Y:^GSPC'); base = self.cal_days('Y:^SP500TR')
        d = [x for x in g if day(SPX_PRE_FROM) <= x <= base[0]]
        a = [math.exp(0.0004 * t + 0.03 * math.sin(t / 50.0)) for t in range(len(d))]
        return {'d': d, 'a': [round(x / a[-1], 12) for x in a]}

    def cboe(self, key):
        """합성 Cboe 옵션 전략 지수 (미국 달력 · CBOE_FROM 부터 · 소수 6자리 — 실제 파일과 같은 자릿수)"""
        g = [x for x in self.cal_days('Y:^GSPC') if x >= day(CBOE_FROM)]
        return {'d': g, 'a': [round(500.0 * math.exp(0.00025 * t + 0.05 * math.sin(t / 61.0) + 0.01 * math.sin(t / 7.0)), 6) for t in range(len(g))]}

    def krx(self, key):
        """합성 한국거래소 옵션 지수 (국내 달력 · KRX_FROM 부터 · 소수 2자리 — 실제 지수 값 자릿수)"""
        g = [x for x in self.cal_days('N:KOSPI') if x >= day(KRX_FROM)]
        return {'d': g, 'a': [round(1000.0 * math.exp(0.0002 * t + 0.04 * math.sin(t / 53.0) + 0.008 * math.sin(t / 5.0)), 2) for t in range(len(g))]}

    def zsim(self, key):
        """합성 모의 커버드콜 (국내 달력 · ZSIM_FROM 부터 · 소수 6자리 — 파이썬이 만든 파일과 같은 자릿수)"""
        g = [x for x in self.cal_days('N:KOSPI') if x >= day(ZSIM_FROM)]
        return {'d': g, 'a': [round(1000.0 * math.exp(0.00018 * t + 0.03 * math.sin(t / 71.0) + 0.006 * math.sin(t / 4.0)), 6) for t in range(len(g))]}

    def file(self, name):
        """data/etfbt/r/<name> 본문"""
        def ser(d):
            return d[0], [d[i] - d[i - 1] for i in range(1, len(d))]
        up = _dt.datetime.now(_dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')   # 화면이 '새 자료'로 보고 깃허브 원본을 따로 받지 않게
        if name in ('R_KRW.json', 'R_USD.json'):
            r = self.rate(name[:-5].replace('_', ':'))
            d0, dd = ser(r['d'])
            return json.dumps({'updated': up, 'k': r['k'], 'mat': 0, 'cur': r['cur'], 'd0': d0, 'dd': dd, 'y': r['y']})
        if name == 'F_USDKRW.json':
            f = self.usdkrw(); d0, dd = ser(f['d'])
            return json.dumps({'updated': up, 'k': 'F:USDKRW', 'd0': d0, 'dd': dd, 'c': f['c']})
        if name.startswith('C_') and name[2:-5] == 'BXNT':
            c = self.cboe('C:BXNT'); d0, dd = ser(c['d'])
            return json.dumps({'updated': up, 'k': 'C:BXNT', 'd0': d0, 'dd': dd, 'a': c['a']})
        if name == 'D_O2903P.json':
            c = self.krx('D:O2903P'); d0, dd = ser(c['d'])
            return json.dumps({'updated': up, 'k': 'D:O2903P', 'd0': d0, 'dd': dd, 'a': c['a']})
        if name == 'Z_M00L90.json':
            c = self.zsim('Z:M00L90'); d0, dd = ser(c['d'])
            return json.dumps({'updated': up, 'k': 'Z:M00L90', 'd0': d0, 'dd': dd, 'a': c['a']})
        if name == 'X_SPXTR.json':
            p = self.spx_pre(); d0, dd = ser(p['d'])
            return json.dumps({'updated': up, 'k': 'X:SPXTR', 'base': 'Y:^SP500TR', 'd0': d0, 'dd': dd, 'a': p['a']})
        return None


def expected(syn):
    """파이썬 기준 구현(scripts/etf_bt_fit.bt_levels)으로 백테스트 수준 → 화면 btJoin 과 같은 규칙으로 가격·분배까지
    → { 키: { d: 날짜, a: 백테스트 총수익 수준(체인 포함), iS, list } }"""
    import numpy as np                                    # 로컬 검사에서만 (배포 사이트 점검은 numpy 없이)
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import etf_bt_fit as F
    R = recipes()

    class FakeD(F.Data):
        def __init__(self):
            self.uni, self.rates, self.fx, self._s, self.meta_kr, self.meta_us, self.spx_pre = {}, {}, {}, {}, {}, {}, None

        def series(self, key):
            if key in self._s:
                return self._s[key]
            if key in ('R:KRW', 'R:USD'):
                r = syn.rate(key); d = np.array(r['d'], np.int64); y = np.array(r['y'], np.float64)
                lv = F.syn_levels(d, y, 0)
                s = {'d': d, 'a': lv, 'c': lv, 'y': y}
            elif key == 'F:USDKRW':
                f = syn.usdkrw(); s = {'d': np.array(f['d'], np.int64), 'a': np.array(f['c'], np.float64), 'c': np.array(f['c'], np.float64)}
            elif key[:2] in ('C:', 'D:', 'Z:'):
                c = syn.cboe(key) if key[0] == 'C' else syn.krx(key) if key[0] == 'D' else syn.zsim(key)
                s = {'d': np.array(c['d'], np.int64), 'a': np.array(c['a'], np.float64), 'c': np.array(c['a'], np.float64)}
            elif key == 'X:SPXTR':
                pre, base = syn.spx_pre(), self.series('Y:^SP500TR')      # 뒷부분 = 자료 오류를 정리한 ^SP500TR (화면 btSplice 와 같게)
                k = base['a'][0] / pre['a'][-1]
                s = {'d': np.concatenate([np.array(pre['d'][:-1], np.int64), base['d']]), 'a': np.concatenate([np.array([x * k for x in pre['a'][:-1]], np.float64), base['a']])}
                s['c'] = s['a']
            else:
                r = syn.raw(key)
                d_, a_ = F.clean_dep(key, np.array(r['d'], np.int64), np.array(r['a'], np.float64))   # 화면 btClean 과 같은 정리
                s = {'d': d_, 'a': a_, 'c': a_}
            self._s[key] = s
            return s

        def info(self, key):
            return {'cur': 'KRW' if key[0] in 'KNDZ' or key in ('R:KRW', 'F:USDKRW') else 'USD'}

    D = FakeD()
    E = F.Engine(D)
    out = {}

    def levels(key, depth):
        rc = R[key]
        getF = lambda k: ext(k, depth)
        r = F.bt_levels(D, E, rc, getF=getF)
        return r

    def ext(k, depth):
        """후보 k 의 총수익 — 자기 식이 있으면(3단까지) 그 백테스트를 앞에 이어 붙임 (화면 btGet)"""
        base = D.series(k)
        if depth > 3 or k not in R or k[0] not in 'KUD':
            return base
        r = levels(k, depth + 1)
        if r is None:
            return base
        d, a = r
        i0 = int(np.searchsorted(base['d'], d[-1]))
        if i0 >= len(base['d']) or base['d'][i0] != d[-1]:
            return base
        kk = base['a'][i0] / a[-1]
        return {'d': np.concatenate([d[:-1], base['d'][i0:]]), 'a': np.concatenate([a[:-1] * kk, base['a'][i0:]])}

    for key in R:
        if key == 'U:IWM' or key[0] == 'D':
            continue
        r = levels(key, 1)
        if r is None:
            continue
        d, a = r
        out[key] = {'d': [int(x) for x in d], 'a': [float(x) for x in a], 'iS': len(d) - 1, 'list': int(d[-1])}
    return out


def fit_selfcheck():
    """scripts/etf_bt_fit.py 의 모의 커버드콜·받기 실패 안전장치 점검 (자료 없이 합성으로) → 실패 문구 목록
    · zsim_levels(벡터 계산) = 날마다 도는 순수 파이썬 기준 구현 (월간·위클리 · 행사가 · 변동성 배수 · 만기일 내재가치 · 열린 마지막 구간)
    · hosted_missing: 모의 커버드콜(Z:)은 목록(universe)에 없어도 계산되면 '있음' · 재료가 없으면 '없음' · 정의를 뺀 Z 키는 세지 않음"""
    import numpy as np
    sys.path.insert(0, os.path.join(ROOT, 'scripts'))
    import etf_bt_fit as F
    out = []
    # 합성 국내 달력 (평일 · 몇몇 휴일 · 만기일이 휴일인 달 포함) — 2003-01-02 ~ 2005-06-30
    d0, d1 = day(_dt.date(2003, 1, 2)), day(_dt.date(2005, 6, 30))
    hol = {day(_dt.date(2003, 1, 9)), day(_dt.date(2004, 9, 9)), day(_dt.date(2005, 2, 9))}   # 2003-01 둘째 목요일 등
    cal = np.array([x for x in range(d0, d1 + 1) if (x + 3) % 7 < 5 and x not in hol], np.int64)
    t = np.arange(len(cal), dtype=np.float64)
    S = 100.0 * np.exp(0.0003 * t + 0.12 * np.sin(t / 37.0) + 0.03 * np.sin(t / 3.0))
    sig = 0.22 + 0.08 * np.sin(t / 23.0) + 0.02 * np.sin(t / 2.0)
    S[:3] = np.nan                                   # 재료가 늦게 시작 — 첫 '재료가 있는 만기일'부터

    def ncdf(x):
        tt = 1.0 / (1.0 + 0.2316419 * abs(x)); dd = 0.3989422804014327 * math.exp(-x * x / 2)
        pp = dd * tt * (0.319381530 + tt * (-0.356563782 + tt * (1.781477937 + tt * (-1.821255978 + tt * 1.330274429))))
        return 1 - pp if x >= 0 else pp

    def call(sv, K, T, v):
        if T <= 0 or v <= 0:
            return max(sv - K, 0.0)
        sq = v * math.sqrt(T); a1 = (math.log(sv / K) + 0.5 * v * v * T) / sq
        return sv * ncdf(a1) - K * ncdf(a1 - sq)

    def ref(P, k, l):
        fut, x = [], int(cal[-1])
        while len(fut) < 45:
            x += 1
            if (x + 3) % 7 < 5:
                fut.append(x)
        calx = [int(v) for v in cal] + fut
        ex = [int(i) for i in np.where(F.expiry_flags(np.array(calx, np.int64), P, 'KR'))[0]]
        n = len(cal); lv = [float('nan')] * n; on = False
        for a, b in zip(ex[:-1], ex[1:]):
            if a >= n:
                break
            if not on:
                if not (S[a] > 0 and sig[a] > 0):
                    continue
                lv[a] = 1000.0; on = True
            K = S[a] * (1 + k); base = S[a] - call(S[a], K, (calx[b] - calx[a]) / 365.0, sig[a] * l)
            for i in range(a + 1, min(b, n - 1) + 1):
                lv[i] = lv[a] * (S[i] - call(S[i], K, (calx[b] - calx[i]) / 365.0, sig[i] * l)) / base
        return np.array(lv)

    for P, k, l in (('M', 0.0, 1.0), ('M', 0.05, 0.8), ('W', 0.01, 0.9)):
        a_ = F.zsim_levels(cal, S, sig, P, k, l); b_ = ref(P, k, l)
        if not np.array_equal(np.isnan(a_), np.isnan(b_)):
            out.append('모의 커버드콜 %s k=%s l=%s: 값이 있는 날이 기준 구현과 다름' % (P, k, l)); continue
        ok = ~np.isnan(b_)
        if ok.sum() < 300:
            out.append('모의 커버드콜 %s: 값 %d일뿐' % (P, int(ok.sum()))); continue
        rel = float(np.max(np.abs(a_[ok] / b_[ok] - 1)))
        if rel > 1e-12:
            out.append('모의 커버드콜 %s k=%s l=%s: 기준 구현과 최대 상대 차 %.1e' % (P, k, l, rel))
    # 받기 실패 안전장치 (hosted_missing)
    zk = sorted(F.ZSIM)[0]

    class FD:
        def __init__(self, have):
            self.uni = {'D:O2903P': {'n': 900}, 'C:BXM': {'n': 900}}
            self.have = have

        def series(self, k):
            if k.startswith('Z:'):
                return {'d': np.arange(100)} if self.have else None
            return {'d': np.arange(100)} if k in self.uni else None
    old = {'K:1': {'m': [[zk, 0, 1.0]]}, 'K:2': {'m': [['Z:M99L99', 0, 1.0]]}, 'K:3': {'m': [['D:O2903P', 0, 1.0], ['C:BXM', 0, 1.0]]}}
    u, m = F.hosted_missing(old, FD(True), 'Z:')
    if m:
        out.append('안전장치: 계산되는 모의 커버드콜을 없다고 봄 %s (목록에 없어서) — 다음 갱신이 멈춤' % m)
    u, m = F.hosted_missing(old, FD(False), 'Z:')
    if m != [zk]:
        out.append('안전장치: 재료가 없을 때 없는 모의 커버드콜 %s (기대 [%s] — 정의를 뺀 Z:M99L99 는 세지 않음)' % (m, zk))
    for pre in ('C:', 'D:'):
        u, m = F.hosted_missing(old, FD(True), pre)
        if m or len(u) != 1:
            out.append('안전장치 %s: 쓴 %s · 없음 %s' % (pre, u, m))
    # 맞추는 구간 끝(fresh_end): 늦게 나오는 지수의 오늘이 없으면 그 전날까지 — 2026-10 국내 달력(9일 한글날 휴장) · 미국 달력
    kr = np.array([day(_dt.date(2026, 10, x)) for x in (5, 6, 7, 8, 12)], np.int64)
    us = np.array([day(_dt.date(2026, 10, x)) for x in (5, 6, 7, 8, 9)], np.int64)
    us2 = np.append(us, day(_dt.date(2026, 10, 12)))
    for args, want, why in (((kr, day(_dt.date(2026, 10, 8)), 0, us), 3, '국내 지수 8일까지(12일 값 아직) → 8일'),
                            ((kr, day(_dt.date(2026, 10, 12)), 0, us), 4, '국내 지수 12일까지 → 12일'),
                            ((kr, day(_dt.date(2026, 10, 9)), 1, us), 4, '미국 지수 9일(미국 달력 끝)까지 → 국내 12일 값(= 9일 종가)도 됨'),
                            ((kr, day(_dt.date(2026, 10, 8)), 1, us), 3, '미국 지수 8일까지(9일 값 아직) → 국내 8일까지'),
                            ((kr, day(_dt.date(2026, 10, 9)), 1, us2), 4, '미국 12일 장이 있어도 국내 12일 값은 9일 종가 → 12일')):
        got = F.fresh_end(*args)
        if got != want:
            out.append('맞추는 구간 끝(fresh_end) %s: %s (기대 %s)' % (why, got, want))
    return out


NAVER_FROM = (_dt.date(1990, 3, 2) - _dt.date(1970, 1, 1)).days     # scripts/etf_bt_fit.py NAVER_FROM · 화면 BT_NAVER_FROM
LIM_DAY = (_dt.date(2015, 6, 15) - _dt.date(1970, 1, 1)).days       # 가격제한폭 ±15% → ±30% (KR_LIM_DAY · BT_LIM_DAY)


def clean_ref(key, d, a):
    """자료 오류 정리 기준 구현 (순수 파이썬 · numpy 없이) — 화면 btClean · scripts/etf_bt_fit.clean_dep 와 같은 규칙 (국내 K·N 만)"""
    d, a = list(d), list(a)
    if key[:2] not in ('K:', 'N:'):
        return d, a
    if d and d[0] < NAVER_FROM:
        i0 = next((i for i, x in enumerate(d) if x >= NAVER_FROM), len(d))
        d, a = d[i0:], a[i0:]
    n = len(a)
    sp, bk = [], []
    for i in range(1, n):
        r = a[i] / a[i - 1] - 1
        if i < n - 1 and abs(r) > 0.4 and abs(a[i + 1] / a[i - 1] - 1) < 0.02:
            sp.append(i)
        elif abs(r) > (0.31 if d[i] < LIM_DAY else 0.61):
            bk.append(i)
    for i in sp:
        a[i] = a[i - 1]
    for b in reversed(bk):
        f = a[b] / a[b - 1]
        for i in range(b):
            a[i] *= f
    return d, a


def clean_cases():
    """일부러 자료 오류를 넣은 합성 일봉 — 1990-03-02 전 값(버림) · 튀었다 돌아온 값 · 가격제한폭 밖 끊김(2015-06-15 전 ±31% · 뒤 ±61%) · 기준값 바로 안팎 · 미국(그대로)"""
    def series(k, start, n, events):
        d0 = (start - _dt.date(1970, 1, 1)).days
        d = [d0 + i + 2 * (i // 5) for i in range(n)]
        a, v = [], 100.0
        for i in range(n):
            v *= 1.0 + 0.004 * math.sin(i / 7.0) + 0.0005
            a.append(v)
        for i, kind, x in events:
            if kind == 'spike':      # 그날만 x 배로 잘못 찍힘 (다음 날 거의 제자리)
                a[i] = a[i] * x
            elif kind == 'jump':     # 그날부터 끝까지 x 배 (끊김 또는 실제 큰 변화)
                a[i:] = [y * x for y in a[i:]]
        return {'name': k + ' ' + ','.join('%s@%d' % (e[1], e[0]) for e in events), 'k': k, 'd': d, 'a': [round(y, 6) for y in a]}
    return [
        series('K:TESTA', _dt.date(1989, 12, 1), 160, [(60, 'jump', 0.01), (120, 'spike', 1.65)]),
        series('K:TESTB', _dt.date(2003, 1, 6), 300, [(40, 'spike', 1.5), (41, 'spike', 1.3), (100, 'jump', 2.5), (101, 'spike', 0.5),
                                                     (200, 'jump', 1.29), (230, 'jump', 1.36), (298, 'spike', 1.6)]),
        series('U:TESTC', _dt.date(1989, 12, 1), 200, [(30, 'spike', 0.5), (90, 'jump', 1.8), (150, 'jump', 0.3)]),
        series('N:TESTD', _dt.date(1995, 1, 3), 120, []),
        series('N:TESTE', _dt.date(1990, 2, 26), 50, [(3, 'jump', 0.9)]),
        # 2015-06-15 뒤 · 기준값 바로 안팎: 돌아옴 2.8%(안 지움)·1.2%(지움) · +45%(지움)·+35%(제자리로 돌아와도 안 지움) · +70%(끊김)·+50%(그대로)
        series('K:TESTF', _dt.date(2016, 1, 4), 200, [(30, 'spike', 1.45), (31, 'jump', 1.035), (60, 'spike', 1.45), (61, 'jump', 1.005),
                                                     (90, 'spike', 1.35), (120, 'jump', 1.7), (150, 'jump', 1.5)]),
    ]


def ex_idx(d, iS, prof):
    """화면 btExIdx 와 같음 — 분배 습관대로 그달 그 날짜(없으면 그달 마지막 거래일) 첫 거래일"""
    out = []
    if not prof or not (prof.get('y', 0) > 0) or not prof.get('m') or iS < 2:
        return out
    months = set(prof['m'])
    dt = lambda x: _EP + _dt.timedelta(int(x))
    i = 1
    while i < iS:
        y, mo = dt(d[i]).year, dt(d[i]).month
        j = i
        while j < iS and dt(d[j]).month == mo and dt(d[j]).year == y:
            j += 1
        if mo in months:
            pick = -1
            for k in range(i, j):
                if dt(d[k]).day >= (prof.get('dom') or 1):
                    pick = k; break
            if pick < 0:
                pick = j - 1
            if 1 <= pick < iS:
                out.append(pick)
        i = j
    return out


def joined_prices(exp, rc, p0):
    """btJoin: 백테스트 구간 가격 (상장 첫날 실제 가격 p0 에서 거꾸로 · 분배 습관대로 가상의 분배를 뺌)"""
    d, a, iS = exp['d'], exp['a'], exp['iS']
    prof = rc.get('dv')
    ex = set(ex_idx(d, iS, prof))
    dl = prof['y'] / max(1, prof.get('f') or 1) if prof and prof.get('y', 0) > 0 else 0.0
    P = [0.0] * (iS + 1); P[iS] = p0
    for i in range(iS, 0, -1):
        g = a[i] / a[i - 1]
        P[i - 1] = P[i] / (g * (1 - (dl if i in ex else 0)))
    return P[:iS], sorted(ex)


BT_JS = """async (args) => {
  const R = [], ok = (name, c, info) => R.push({ name, ok: !!c, info }), W = ms => new Promise(r => setTimeout(r, ms));
  const S = window.ECXdebug && ECXdebug.S, X = window.ECX, $ = id => document.getElementById(id);
  if (!S || !X) return { R: [{ name: 'ECX 없음', ok: false }] };
  const busy = () => Object.keys(S.pend).length || Object.keys(S.distP).length || Object.keys(S.exP).length || Object.keys(S.pgP).length || Object.keys(S.btP).length || Object.keys(S.depP).length;
  const done = async () => { for (let i = 0; i < 600; i++) { if (!busy() && S.sel.every(s => !S.data[s.k + s.c] || ECXdebug.prepOf(s))) { await W(50); if (!busy()) return; } await W(100); } };
  const out = { R, s: {}, rows: [], ds: [], note: '', w: null, off: null };
  location.hash = args.hash; await W(250); await done();
  const r = S.last;
  S.sel.forEach(it => { const s = ECXdebug.prepOf(it); out.s[it.k + it.c] = s ? { d: s.d.slice(0, (s.bt || 0) + 3), p: s.p.slice(0, (s.bt || 0) + 3), bt: s.bt || 0, list: s.list || null, n: s.d.length, dv: (s.dv || []).filter(e => e.k === 's').map(e => [e.x, e.i, e.a, e.t]).slice(0, 40), first: s.d[0] } : null; });
  out.w = r && r.w ? { S: r.w.S, E: r.w.E } : null;
  out.rows = r && r.list ? r.list.map(o => { const it = S.sel[o.i], tr = [...document.querySelectorAll('#ecx-stats tr')].find(t => t.querySelector('.n b') && t.textContent.indexOf(S.by[it.k + it.c] ? (S.by[it.k + it.c].n || it.c) : it.c) >= 0);
    return { key: it.k + it.c, bt: o.st.bt, list: o.st.list, first: o.st.first, pDay: o.st.pDay, pKind: o.st.pKind, p0: o.st.p0, pE: o.st.pE, ret: o.st.ret, baseDay: o.st.baseDay,
             info: tr && tr.querySelector('.ecx-bt') ? tr.querySelector('.ecx-bt').textContent : '', cls: tr && tr.querySelector('.ecx-bt') ? tr.querySelector('.ecx-bt').className : '', cell: tr && tr.cells[6] ? tr.cells[6].textContent : '' }; }) : [];
  out.ds = S.chart ? S.chart.data.datasets.map(ds => ({ label: ds.label, lx: ds.lx == null ? null : ds.lx, dash: ds.segment ? [ds.segment.borderDash({ p1: { parsed: { x: (ds.lx || 0) - 1 } } }), ds.segment.borderDash({ p1: { parsed: { x: (ds.lx || 0) + 1 } } })] : null })) : [];
  out.note = $('ecx-range').textContent; out.hash = location.hash; out.box = $('ecx-bt').checked;
  // 끄기 → 실제 기간만 · 주소 bt=0 · 다시 켜기
  $('ecx-bt').click(); await W(150); await done();
  out.off = { hash: location.hash, w: S.last && S.last.w ? S.last.w.S : null, bt: S.sel.map(it => { const s = ECXdebug.prepOf(it); return s ? (s.bt || 0) : -1; }), firsts: S.sel.map(it => { const s = ECXdebug.prepOf(it); return s ? s.d[0] : null; }), dashed: S.chart ? S.chart.data.datasets.filter(ds => ds.lx != null).length : -1 };
  $('ecx-bt').click(); await W(150); await done();
  out.back = { hash: location.hash, w: S.last && S.last.w ? S.last.w.S : null };
  // 주소로 끈 상태 열기(공유 링크 &bt=0) → 체크 해제 · 백테스트 없음
  location.hash = args.hash + '&bt=0'; await W(250); await done();
  out.parse = { bt: S.bt, box: $('ecx-bt').checked, any: S.sel.some(it => { const s = ECXdebug.prepOf(it); return !!(s && s.bt > 0); }), hash: location.hash };
  return out;
}"""
