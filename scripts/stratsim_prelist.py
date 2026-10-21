#!/usr/bin/env python3
"""[STRATSIM-PRE] 투자전략 시뮬레이터 상장 전 구간 — data/stratsim/prelist.csv

투자전략 시뮬레이터(data/stratsim/prices.csv)의 각 ETF 상장 전 값을, 사이트의 다른 상장 전 재현(ETF 차트 비교 · 무한매수법 ·
72루틴 · VR · 자산 속도 시뮬레이터 · SMA 200 백테스트 '상장 전 포함')과 **같은 식 · 같은 자료**로 만든다.
  · 식 = data/etfbt 의 재현 식(scripts/etf_bt_fit.py 가 상장 뒤 실제 값과 교차 검증해 고른 식) — 화면 btLevels · MBT.preKey 와 같은 계산
      하루 값 = (1 + 현금 + Σ 비중 × (후보 수익 − 현금)) × e^(d/252) · 현금 = 미국 13주 국채 금리(^IRX, 실제 날수/365)
      후보 ETF 가 자기 재현 식을 가지면(연 오차 5% 이하 · 최대 3단) 그 앞을 이어 붙임
      (TQQQ ← QLD ← QQQ ← 나스닥 100 · SQQQ ← QID ← 나스닥 100 · SPXL ← SSO ← S&P 500 배당 재투자 · SPY ← S&P 500 배당 재투자)
  · 1980년(화면 달력 시작)부터: 화면과 같은 값 — 같은 자료(data/etfbt/r 의 금리·S&P 500 TR 앞부분, 야후 일봉)
  · 그 전(1953 ~ 1979)은 같은 식에 재료만 앞으로 이어 붙임
      - S&P 500 배당 재투자: ^GSPC 종가 + 실러 월 배당(연율 ÷ 365 × 날수) — etf_bt_fit.py spx_prefix 와 같은 식 (1952-12 ~ 1979-12 표)
      - 나스닥 100: 1985-10-01 전 = 나스닥 종합(^IXIC · 1971-02-05 ~) · 1971-02-05 전 = 예전 자료의 하루 변화
        (scripts/stratsim_ndx_pre1971.csv · Stooq 가 만든 가상 지수 · 검증할 실제 자료 없음)
      - 현금 금리: 1960-01-04 전 = 미국 3개월 국채 월 금리(FRED TB3MS)
  · 결과: 날짜(야후 ^GSPC 거래일 · 1953-01-02 ~) × 7종목 '상장 첫날 = 1' 총수익 수준 · 상장 뒤 날은 빈칸
    → scripts/update_stratsim.py 가 '야후 상장 첫날 수정 종가 × 이 값'으로 prices.csv 상장 전 줄을 씀(상장 첫날 하루 변화도 식 그대로)
  · 재현 식이 바뀌는 매주(update-etf-bt.yml) 다시 계산 — 지금 파일과 어느 값이든 0.5% 넘게 다르거나 날짜·상장 첫날이 바뀐 경우에만 씀
    (매주의 작은 다시 맞춤은 1953년 값까지 쌓여도 0.3% 안팎 — 그때마다 시뮬레이터 가격 전체·탐색기 표를 다시 만들지 않게.
     화면의 재현과의 차이는 늘 0.5% 안(57년 동안 쌓인 값 기준 · 연으로는 0.01%p 안))
사용: python3 scripts/stratsim_prelist.py --cache .btcache [--out data/stratsim/prelist.csv] [--check] [--force]
  (--check: 쓰지 않고 지금 파일과의 차이만 · 0.5% 넘게 다르면 종료 코드 1 / --force: 차이가 작아도 씀)
"""
import argparse, csv, datetime, glob, io, json, math, os, re, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EPOCH = datetime.date(1970, 1, 1)
COLS = ['qqq', 'tqqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq']           # prices.csv 열 순서
IPO = {'qqq': '1999-03-10', 'tqqq': '2010-02-11', 'spy': '1993-01-29', 'qld': '2006-06-21', 'sso': '2006-06-21', 'spxl': '2008-11-05', 'sqqq': '2010-02-11'}   # update_stratsim.py 와 같음
START = (datetime.date(1953, 1, 2) - EPOCH).days                      # prices.csv 첫날
CHAIN_EC = 0.05                                                       # 화면 BT_CHAIN_EC · etf_bt_fit.py CHAIN_EC
MAX_DEPTH = 3                                                         # 화면 btGet/getF 의 depth 상한
TOL = 0.005                                                           # 지금 파일과 이보다 크게 다를 때만 씀
NDX_PRE = os.path.join(ROOT, 'scripts', 'stratsim_ndx_pre1971.csv')

# 미국 3개월 국채 월 금리(%) — FRED TB3MS 1952-12 ~ 1959-12 (^IRX 일봉이 1960-01-04 부터라 그 전만)
TB3_0 = (1952, 12)
TB3 = [
    2.09, 1.96, 1.97, 2.01, 2.19, 2.16, 2.11, 2.04, 2.04, 1.79, 1.38, 1.44, 1.60, 1.18, 0.97, 1.03, 0.97, 0.76, 0.64, 0.72,
    0.92, 1.01, 0.98, 0.93, 1.15, 1.22, 1.17, 1.28, 1.59, 1.45, 1.41, 1.60, 1.90, 2.07, 2.23, 2.24, 2.54, 2.41, 2.32, 2.25,
    2.60, 2.61, 2.49, 2.31, 2.60, 2.84, 2.90, 2.99, 3.21, 3.11, 3.10, 3.08, 3.07, 3.06, 3.29, 3.16, 3.37, 3.53, 3.58, 3.31,
    3.04, 2.44, 1.53, 1.30, 1.13, 0.91, 0.83, 0.91, 1.69, 2.44, 2.63, 2.67, 2.77, 2.82, 2.70, 2.80, 2.95, 2.84, 3.21, 3.20,
    3.38, 4.04, 4.05, 4.15, 4.49,
]
# S&P 500 배당(연율, 지수 단위) — 실러 'U.S. Stock Markets 1871-Present'(github.com/datasets/s-and-p-500) 1952-12 ~ 1979-12
# (1979-12 뒤는 data/etfbt/r/X_SPXTR.json — etf_bt_fit.py SPX_DIV 와 같은 출처 · 1979-12 값 5.65 도 같음)
DIV_0 = (1952, 12)
DIV = [
    1.41, 1.41, 1.41, 1.41, 1.41333, 1.41667, 1.42, 1.42, 1.42, 1.42, 1.43, 1.44, 1.45, 1.45667, 1.46333, 1.47,
    1.46333, 1.45667, 1.45, 1.45667, 1.46333, 1.47, 1.49333, 1.51667, 1.54, 1.54667, 1.55333, 1.56, 1.56333, 1.56667, 1.57, 1.58667,
    1.60333, 1.62, 1.62667, 1.63333, 1.64, 1.67, 1.7, 1.73, 1.75333, 1.77667, 1.8, 1.81333, 1.82667, 1.84, 1.80667, 1.77333,
    1.74, 1.73667, 1.73333, 1.73, 1.73, 1.73, 1.73, 1.74, 1.75, 1.76, 1.77, 1.78, 1.79, 1.78333, 1.77667, 1.77,
    1.75667, 1.74333, 1.73, 1.73, 1.73, 1.73, 1.73667, 1.74333, 1.75, 1.75667, 1.76333, 1.77, 1.77667, 1.78333, 1.79, 1.79667,
    1.80333, 1.81, 1.81667, 1.82333, 1.83, 1.86667, 1.90333, 1.94, 1.94333, 1.94667, 1.95, 1.95, 1.95, 1.95, 1.95, 1.95,
    1.95, 1.94667, 1.94333, 1.94, 1.94, 1.94, 1.94, 1.94667, 1.95333, 1.96, 1.98, 2, 2.02, 2.02667, 2.03333, 2.04,
    2.04667, 2.05333, 2.06, 2.06667, 2.07333, 2.08, 2.09667, 2.11333, 2.13, 2.13667, 2.14333, 2.15, 2.16667, 2.18333, 2.2, 2.20333,
    2.20667, 2.21, 2.23333, 2.25667, 2.28, 2.29667, 2.31333, 2.33, 2.34667, 2.36333, 2.38, 2.4, 2.42, 2.44, 2.46, 2.48,
    2.5, 2.51667, 2.53333, 2.55, 2.57, 2.59, 2.61, 2.62667, 2.64333, 2.66, 2.68, 2.7, 2.72, 2.74, 2.76, 2.78,
    2.79667, 2.81333, 2.83, 2.85, 2.87, 2.89, 2.88333, 2.87667, 2.87, 2.88, 2.89, 2.9, 2.9, 2.9, 2.9, 2.90667,
    2.91333, 2.92, 2.92, 2.92, 2.92, 2.93, 2.94, 2.95, 2.96333, 2.97667, 2.99, 3.00333, 3.01667, 3.03, 3.04333, 3.05667,
    3.07, 3.08, 3.09, 3.1, 3.11, 3.12, 3.13, 3.13667, 3.14333, 3.15, 3.15333, 3.15667, 3.16, 3.16333, 3.16667, 3.17,
    3.17333, 3.17667, 3.18, 3.18333, 3.18667, 3.19, 3.17333, 3.15667, 3.14, 3.13, 3.12, 3.11, 3.10667, 3.10333, 3.1, 3.09667,
    3.09333, 3.09, 3.08333, 3.07667, 3.07, 3.07, 3.07, 3.07, 3.07, 3.07, 3.07, 3.07333, 3.07667, 3.08, 3.10333, 3.12667,
    3.15, 3.15667, 3.16333, 3.17, 3.18667, 3.20333, 3.22, 3.23667, 3.25333, 3.27, 3.30667, 3.34333, 3.38, 3.4, 3.42, 3.44,
    3.46, 3.48, 3.5, 3.53, 3.56, 3.59, 3.59333, 3.59667, 3.6, 3.62333, 3.64667, 3.67, 3.68333, 3.69667, 3.71, 3.71,
    3.71, 3.71, 3.7, 3.69, 3.68, 3.68333, 3.68667, 3.69, 3.71333, 3.73667, 3.76, 3.79, 3.82, 3.85, 3.91667, 3.98333,
    4.05, 4.09667, 4.14333, 4.19, 4.24667, 4.30333, 4.36, 4.40667, 4.45333, 4.5, 4.55667, 4.61333, 4.67, 4.71333, 4.75667, 4.8,
    4.83667, 4.87333, 4.91, 4.94667, 4.98333, 5.02, 5.03667, 5.05333, 5.07, 5.11333, 5.15667, 5.2, 5.24667, 5.29333, 5.34, 5.39667,
    5.45333, 5.51, 5.55667, 5.60333, 5.65,
]


def dnum(s):
    return (datetime.date.fromisoformat(s) - EPOCH).days


def ymd(n):
    return (EPOCH + datetime.timedelta(int(n))).isoformat()


def month_idx(n, base):
    dt = EPOCH + datetime.timedelta(int(n))
    return (dt.year - base[0]) * 12 + dt.month - base[1]


class Fail(Exception):
    pass


# ───────────── 화면(btAlign · btRets · btSplice · btCash · btLevels · getF)과 같은 계산 ─────────────
def align(d, a, cal, lag):
    """lag 0: 그날까지 마지막 값 · 1: 전날까지 마지막 값 · 첫날 전 NaN (화면 btAlign)"""
    idx = np.searchsorted(d, cal, side='right') - 1 if lag == 0 else np.searchsorted(d, cal, side='left') - 1
    out = np.full(len(cal), np.nan)
    ok = idx >= 0
    out[ok] = a[idx[ok]]
    return out


def rets(lv):
    r = np.full(len(lv), np.nan)
    r[1:] = lv[1:] / lv[:-1] - 1.0
    return r


def splice(pre, base):
    """앞부분 pre 의 마지막 날 = base 의 그날 → 앞부분을 그 비율로 맞춰 이어 붙임 (화면 btSplice)"""
    last = pre['d'][-1]
    i0 = int(np.searchsorted(base['d'], last))
    if i0 >= len(base['d']) or base['d'][i0] != last:
        raise Fail('이어 붙일 날(%s)이 뒷부분에 없음' % ymd(last))
    k = base['a'][i0] / pre['a'][-1]
    return {'d': np.concatenate([pre['d'][:-1], base['d'][i0:]]), 'a': np.concatenate([pre['a'][:-1] * k, base['a'][i0:]])}


def extend_back(base, pre):
    """base 첫날 전을 pre 로 (base 첫날이 pre 에 있어야 함 · 그날 비율로 맞춤)"""
    d0 = base['d'][0]
    i = int(np.searchsorted(pre['d'], d0))
    if i >= len(pre['d']) or pre['d'][i] != d0:
        raise Fail('앞으로 이어 붙일 자료에 %s 이 없음' % ymd(d0))
    k = base['a'][0] / pre['a'][i]
    return {'d': np.concatenate([pre['d'][:i], base['d']]), 'a': np.concatenate([pre['a'][:i] * k, base['a']])}


def rate_levels(d, y):
    """금리(%) → 현금 지수 (첫날 1 · 전날 금리 × 날수/365) — 화면 btSynLevels(만기 0)"""
    lv = np.ones(len(d))
    for i in range(1, len(d)):
        lv[i] = lv[i - 1] * (1.0 + y[i - 1] / 100.0 * (d[i] - d[i - 1]) / 365.0)
    return lv


def cash_ret(rate, cal):
    """화면 btCash — 금리 자료 첫날 전은 첫 금리로"""
    r = rets(align(rate['d'], rate['a'], cal, 0))
    out = np.zeros(len(cal))
    ok = np.where(~np.isnan(r))[0]
    first = int(ok[0]) if len(ok) else -1
    y0 = rate['y'][0] / 100.0
    for i in range(len(cal)):
        if first >= 0 and i < first:
            out[i] = y0 * (0 if i == 0 else cal[i] - cal[i - 1]) / 365.0
        else:
            out[i] = 0.0 if math.isnan(r[i]) else r[i]
    return out


class Builder:
    def __init__(self, cache, etfbt):
        self.cache, self.etfbt = cache, etfbt
        self.E = {}
        for f in sorted(glob.glob(os.path.join(etfbt, '[0-9]*.json'))):
            self.E.update(json.load(open(f, encoding='utf-8'))['e'])
        if len(self.E) < 1000:
            raise Fail('재현 식이 너무 적음 (%d) — data/etfbt 확인' % len(self.E))
        self._raw, self._memo = {}, {}
        g = self.raw('Y:^GSPC')
        self.cal = g['d'][g['d'] >= START]
        if not len(self.cal) or self.cal[0] != START:
            raise Fail('^GSPC 일봉이 1953-01-02 부터가 아님')
        self.gspc = g
        self.rate = self.usd_rate()
        self.spxtr = self.spx_tr()
        self.ndx = self.ndx_ext()

    # ── 자료 ──
    def raw(self, key):
        """캐시 일봉(etf_bt_data.py) → {'d','a'} (수정 종가 — 지수는 종가)"""
        if key in self._raw:
            return self._raw[key]
        fn = re.sub(r'[^0-9A-Za-z_-]', lambda m: '_%02x' % ord(m.group(0)), key)
        p = os.path.join(self.cache, 'series', fn + '.npz')
        if not os.path.exists(p):
            raise Fail('캐시에 %s 일봉이 없음 (%s)' % (key, p))
        z = np.load(p)
        d, a = z['d'].astype(np.int64), z['a'].astype(np.float64)
        ok = np.isfinite(a) & (a > 0)
        s = {'d': d[ok], 'a': a[ok]}
        if len(s['d']) < 100 or np.any(np.diff(s['d']) <= 0):
            raise Fail('%s 일봉 이상 (%d개)' % (key, len(s['d'])))
        self._raw[key] = s
        return s

    def rfile(self, name):
        j = json.load(open(os.path.join(self.etfbt, 'r', name + '.json'), encoding='utf-8'))
        d = [j['d0']]
        for x in j['dd']:
            d.append(d[-1] + x)
        return j, np.array(d, np.int64)

    def usd_rate(self):
        """R:USD(^IRX · data/etfbt/r/R_USD.json) + 그 전 달력 날은 TB3MS 월 금리"""
        j, d = self.rfile('R_USD')
        y = np.array(j['y'], np.float64)
        early = self.gspc['d'][(self.gspc['d'] >= START - 10) & (self.gspc['d'] < d[0])]
        ey = []
        for x in early:
            m = month_idx(x, TB3_0)
            if not (0 <= m < len(TB3)):
                raise Fail('TB3MS 표 밖의 달 %s' % ymd(x))
            ey.append(TB3[m])
        dd = np.concatenate([early, d])
        yy = np.concatenate([np.array(ey, np.float64), y])
        return {'d': dd, 'y': yy, 'a': rate_levels(dd, yy)}

    def spx_tr(self):
        """X:SPXTR(화면: r/X_SPXTR.json 앞부분 + ^SP500TR) + 그 전은 ^GSPC + 실러 배당"""
        j, d = self.rfile('X_SPXTR')
        pre = {'d': d, 'a': np.array(j['a'], np.float64)}
        if len(pre['a']) != len(d):
            raise Fail('X_SPXTR.json 길이 이상')
        base = splice(pre, self.raw('Y:^SP500TR'))
        g = self.gspc
        i0, i1 = int(np.searchsorted(g['d'], START - 10)), int(np.searchsorted(g['d'], d[0]))
        if i1 >= len(g['d']) or g['d'][i1] != d[0]:
            raise Fail('^GSPC 에 X_SPXTR 첫날(%s)이 없음' % ymd(d[0]))
        gd, gp = g['d'][i0:i1 + 1], g['a'][i0:i1 + 1]
        lv = np.ones(len(gd))
        for k in range(1, len(gd)):
            m = month_idx(gd[k], DIV_0)
            if not (0 <= m < len(DIV)):
                raise Fail('배당 표 밖의 달 %s' % ymd(gd[k]))
            lv[k] = lv[k - 1] * (gp[k] + DIV[m] * (gd[k] - gd[k - 1]) / 365.0) / gp[k - 1]
        return extend_back(base, {'d': gd, 'a': lv})

    def ndx_ext(self):
        """Y:^NDX + 1985-10-01 전 ^IXIC + 1971-02-05 전 예전 자료(고정 파일)"""
        nd = extend_back(self.raw('Y:^NDX'), self.raw('Y:^IXIC'))
        rows = list(csv.reader(open(NDX_PRE, encoding='utf-8')))
        if rows[0] != ['date', 'level']:
            raise Fail('stratsim_ndx_pre1971.csv 머리줄 이상')
        pd_ = np.array([dnum('%s-%s-%s' % (r[0][:4], r[0][4:6], r[0][6:])) for r in rows[1:]], np.int64)
        pa = np.array([float(r[1]) for r in rows[1:]], np.float64)
        return extend_back(nd, {'d': pd_, 'a': pa})

    # ── 화면 getF · levels ──
    def getF(self, key, depth):
        if key == 'X:SPXTR':
            return self.spxtr
        if key == 'Y:^NDX':
            return self.ndx
        if key == 'R:USD':                                            # 현금 자체가 후보인 식 (그 열은 늘 0)
            return {'d': self.rate['d'], 'a': self.rate['a']}
        c0 = key[0]
        if c0 not in 'UYKD':
            raise Fail('지원하지 않는 후보 %s' % key)
        raw = self.raw(key)
        if depth > MAX_DEPTH or c0 not in 'KUD':
            return raw
        rc = self.E.get(key)
        if not rc or rc.get('ec') is None or rc['ec'] > CHAIN_EC:
            return raw
        mk = (key, depth)
        if mk in self._memo:
            return self._memo[mk]
        out = raw
        lev = self.levels(rc, depth + 1)
        if lev is not None and lev[2] >= 1:
            ld, la, iS = lev
            i0 = int(np.searchsorted(raw['d'], ld[iS]))
            if i0 < len(raw['d']) and raw['d'][i0] == ld[iS]:
                k = raw['a'][i0] / la[iS]
                out = {'d': np.concatenate([ld[:iS], raw['d'][i0:]]), 'a': np.concatenate([la[:iS] * k, raw['a'][i0:]])}
        self._memo[mk] = out
        return out

    def levels(self, rc, depth):
        """→ (날짜, 수준(상장 첫날 = 1), 상장 첫날 위치) · 화면 btLevels 와 같은 식 (미국 달러 식만)"""
        if rc.get('c') != 'USD':
            raise Fail('달러가 아닌 식')
        s = int(rc['s'])
        cal = self.cal
        if s not in set(cal.tolist()):                                # 상장 첫날이 달력에 없으면 끼워 넣음 (화면 levels 와 같음)
            cal = np.sort(np.append(cal, s))
        iS = int(np.searchsorted(cal, s))
        if iS < 1:
            return None
        cash = cash_ret(self.rate, cal)
        m0 = cash.copy()
        for t in rc['m']:
            key, lag, w, var, fcur = t[0], int(t[1]), float(t[2]), t[3], t[4] or rc['c']
            if (len(t) > 6 and t[6]) or fcur != 'USD':                # 달러 대상 · 달러 후보면 'n'·'u'·'h' 모두 '후보 − 현금' (화면 btLevels 와 같음)
                raise Fail('지원하지 않는 식 열 %s (다른 통화·콜 매도) — 이 스크립트를 넓혀야 함' % (t,))
            f = self.getF(key, depth)
            m0 = m0 + w * (rets(align(f['d'], f['a'], cal, lag)) - cash)
        dd = math.exp(float(rc.get('d') or 0.0) / 252.0)
        lv = np.full(iS + 1, np.nan)
        lv[iS] = 1.0
        j0 = 0
        for i in range(iS, 0, -1):
            g = (1.0 + m0[i]) * dd
            if not (g > 0) or math.isnan(g):
                j0 = i
                break
            lv[i - 1] = lv[i] / g
        return cal[j0:iS + 1], lv[j0:iS + 1], iS - j0

    def build(self):
        out = {}
        for c in COLS:
            rc = self.E.get('U:' + c.upper())
            if not rc:
                raise Fail('%s 재현 식이 없음' % c.upper())
            if ymd(rc['s']) != IPO[c]:
                raise Fail('%s 재현 식의 상장 첫날 %s 가 %s 와 다름' % (c.upper(), ymd(rc['s']), IPO[c]))
            self._memo = {}
            lev = self.levels(rc, 1)
            if lev is None:
                raise Fail('%s 재현 실패' % c.upper())
            d, a, iS = lev
            if d[0] != START:
                raise Fail('%s 재현이 %s 부터 — 1953-01-02 까지 닿지 않음 (재료 자료 확인)' % (c.upper(), ymd(d[0])))
            if not (np.all(np.isfinite(a)) and np.all(a > 0)):
                raise Fail('%s 재현 값 이상' % c.upper())
            out[c] = (d, a, int(rc['s']))
        return out


def to_csv(res):
    last = max(s for _, _, s in res.values())
    dates = sorted({int(x) for d, _, _ in res.values() for x in d if x <= last})
    look = {c: dict(zip((int(x) for x in d), a)) for c, (d, a, _) in res.items()}
    buf = io.StringIO()
    buf.write('date,' + ','.join(COLS) + '\n')
    for x in dates:
        cells = []
        for c in COLS:
            v = look[c].get(x)
            cells.append('' if v is None or x > res[c][2] else ('1' if x == res[c][2] else '%.12g' % v))
        buf.write(ymd(x).replace('-', '') + ',' + ','.join(cells) + '\n')
    return buf.getvalue()


def summary(res):
    for c in COLS:
        d, a, s = res[c]
        yrs = (d[-1] - d[0]) / 365.25
        cg = (a[-1] / a[0]) ** (1 / yrs) - 1
        r_list = a[-1] / a[-2] - 1
        print('  %-4s %s ~ %s  연평균 %+7.2f%%  상장 첫날 하루 %+.4f%%' % (c.upper(), ymd(d[0]), ymd(s), cg * 100, r_list * 100))


def diff(cur, text):
    """지금 파일 글 vs 새 글 → (크게 다른가, 최대 상대 차이, 까닭)"""
    if not cur:
        return True, None, '지금 파일 없음'
    a, b = cur.splitlines(), text.splitlines()
    if a[0] != b[0] or len(a) != len(b):
        return True, None, '머리줄·줄 수가 다름'
    mx = 0.0
    for la, lb in zip(a[1:], b[1:]):
        ca, cb = la.split(','), lb.split(',')
        if ca[0] != cb[0] or [x == '' for x in ca] != [x == '' for x in cb] or [x == '1' for x in ca] != [x == '1' for x in cb]:
            return True, None, '날짜·상장 첫날이 다름 (%s)' % cb[0]
        for x, y in zip(ca[1:], cb[1:]):
            if x and y:
                mx = max(mx, abs(float(y) / float(x) - 1.0))
    return mx > TOL, mx, '최대 차이 %.4f%%' % (mx * 100)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default='.btcache')
    ap.add_argument('--etfbt', default=os.path.join(ROOT, 'data', 'etfbt'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'data', 'stratsim', 'prelist.csv'))
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    try:
        res = Builder(a.cache, a.etfbt).build()
    except Fail as e:
        print('상장 전 구간: 만들지 못함 — %s (지금 파일 그대로 둠)' % e)
        return 1
    text = to_csv(res)
    summary(res)
    cur = open(a.out, encoding='utf-8').read() if os.path.exists(a.out) else ''
    big, mx, why = diff(cur, text)
    if a.check:
        print('prelist.csv: 지금 파일과 %s — %s' % ('크게 다름' if big else '0.5% 안', why))
        return 1 if big else 0
    if text == cur:
        print('prelist.csv: 바뀐 것 없음')
        return 0
    if not big and not a.force:
        print('prelist.csv: 재현 식이 조금 바뀜(%s) — 0.5%% 안이라 그대로 둠' % why)
        return 0
    with open(a.out + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(a.out + '.tmp', a.out)
    print('prelist.csv: 저장 (%d줄 · %s)' % (text.count('\n') - 1, why))
    return 0


if __name__ == '__main__':
    sys.exit(main())
