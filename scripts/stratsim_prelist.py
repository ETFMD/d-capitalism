#!/usr/bin/env python3
"""[STRATSIM-PRE] 투자전략 시뮬레이터 상장 전 구간 — data/stratsim/prelist.csv

투자전략 시뮬레이터(data/stratsim/prices.csv)의 각 ETF 상장 전 값을, 사이트의 다른 상장 전 재현(ETF 차트 비교 · 무한매수법 ·
72루틴 · VR · 자산 속도 시뮬레이터 · SMA 200 백테스트 '상장 전 포함')과 **같은 식 · 같은 자료**로 만든다.
  · 식 = data/etfbt 의 재현 식(scripts/etf_bt_fit.py 가 상장 뒤 실제 값과 교차 검증해 고른 식) — 화면 btLevels · MBT.preKey 와 같은 계산
      하루 값 = (1 + 현금 + Σ 비중 × (후보 수익 − 현금)) × e^(d/252)
      현금 = 미국 13주 국채 금리(^IRX, 실제 날수/365) · 레버리지·인버스 식('cr')은 연방기금 금리(FRED DFF, 실제 날수/360)
      후보 ETF 가 자기 재현 식을 가지면(연 오차 5% 이하 · 최대 3단) 그 앞을 이어 붙임
      (TQQQ ← QLD ← QQQ ← 나스닥 100 · SQQQ ← QID ← 나스닥 100 · SPXL ← SSO ← S&P 500 배당 재투자 · SPY ← S&P 500 배당 재투자)
  · 1980년(화면 달력 시작)부터: 화면과 같은 값 — 같은 자료(data/etfbt/r 의 금리·S&P 500 TR 앞부분, 야후 일봉)
  · 그 전(1971-02-05 ~ 1979)은 같은 식에 재료만 앞으로 이어 붙임
      - S&P 500 배당 재투자: ^GSPC 종가 + 실러 월 배당(연율 ÷ 365 × 날수) — etf_bt_fit.py spx_prefix 와 같은 식 (1970-12 ~ 1979-12 표)
      - 나스닥 100: 1985-10-01 전 = 나스닥 종합(^IXIC · 1971-02-05 첫날)
  · 시작 = 1971-02-05 (나스닥 종합지수 첫날 — 그 전 나스닥 값은 검증할 실제 자료가 없는 가상값이라 쓰지 않음 · 시뮬레이터 전체가 이 날부터)
  · 결과: 날짜(야후 ^GSPC 거래일 · 1971-02-05 ~) × 7종목 '상장 첫날 = 1' 총수익 수준 · 상장 뒤 날은 빈칸
    → scripts/update_stratsim.py 가 '야후 상장 첫날 수정 종가 × 이 값'으로 prices.csv 상장 전 줄을 씀(상장 첫날 하루 변화도 식 그대로 ·
      이 파일 첫날 전 줄은 지움)
  · 재현 식이 바뀌는 매주(update-etf-bt.yml) 다시 계산 — 지금 파일과 어느 값이든 0.5% 넘게 다르거나 날짜·상장 첫날이 바뀐 경우에만 씀
    (매주의 작은 다시 맞춤은 1971년 값까지 쌓여도 0.3% 안팎 — 그때마다 시뮬레이터 가격 전체·탐색기 표를 다시 만들지 않게.
     화면의 재현과의 차이는 늘 0.5% 안(50년 넘게 쌓인 값 기준 · 연으로는 0.01%p 안))
사용: python3 scripts/stratsim_prelist.py --cache .btcache [--out data/stratsim/prelist.csv] [--check] [--force]
  (--check: 쓰지 않고 지금 파일과의 차이만 · 0.5% 넘게 다르면 종료 코드 1 / --force: 차이가 작아도 씀)
"""
import argparse, datetime, glob, io, json, math, os, re, sys
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
EPOCH = datetime.date(1970, 1, 1)
COLS = ['qqq', 'tqqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq']           # prices.csv 열 순서
IPO = {'qqq': '1999-03-10', 'tqqq': '2010-02-11', 'spy': '1993-01-29', 'qld': '2006-06-21', 'sso': '2006-06-21', 'spxl': '2008-11-05', 'sqqq': '2010-02-11'}   # update_stratsim.py 와 같음
START = (datetime.date(1971, 2, 5) - EPOCH).days                      # prices.csv 첫날 = 나스닥 종합지수(^IXIC) 첫날 — update_stratsim.py DATA_START 와 같이
CHAIN_EC = 0.05                                                       # 화면 BT_CHAIN_EC · etf_bt_fit.py CHAIN_EC
MAX_DEPTH = 3                                                         # 화면 btGet/getF 의 depth 상한
TOL = 0.005                                                           # 지금 파일과 이보다 크게 다를 때만 씀

# S&P 500 배당(연율, 지수 단위) — 실러 'U.S. Stock Markets 1871-Present'(github.com/datasets/s-and-p-500) 1970-12 ~ 1979-12
# (1979-12 뒤는 data/etfbt/r/X_SPXTR.json — etf_bt_fit.py SPX_DIV 와 같은 출처 · 1979-12 값 5.65 도 같음)
DIV_0 = (1970, 12)
DIV = [
    3.14, 3.13, 3.12, 3.11, 3.10667, 3.10333, 3.1, 3.09667, 3.09333, 3.09, 3.08333, 3.07667, 3.07, 3.07, 3.07, 3.07,
    3.07, 3.07, 3.07, 3.07333, 3.07667, 3.08, 3.10333, 3.12667, 3.15, 3.15667, 3.16333, 3.17, 3.18667, 3.20333, 3.22, 3.23667,
    3.25333, 3.27, 3.30667, 3.34333, 3.38, 3.4, 3.42, 3.44, 3.46, 3.48, 3.5, 3.53, 3.56, 3.59, 3.59333, 3.59667,
    3.6, 3.62333, 3.64667, 3.67, 3.68333, 3.69667, 3.71, 3.71, 3.71, 3.71, 3.7, 3.69, 3.68, 3.68333, 3.68667, 3.69,
    3.71333, 3.73667, 3.76, 3.79, 3.82, 3.85, 3.91667, 3.98333, 4.05, 4.09667, 4.14333, 4.19, 4.24667, 4.30333, 4.36, 4.40667,
    4.45333, 4.5, 4.55667, 4.61333, 4.67, 4.71333, 4.75667, 4.8, 4.83667, 4.87333, 4.91, 4.94667, 4.98333, 5.02, 5.03667, 5.05333,
    5.07, 5.11333, 5.15667, 5.2, 5.24667, 5.29333, 5.34, 5.39667, 5.45333, 5.51, 5.55667, 5.60333, 5.65,
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


def rate_levels(d, y, basis=365):
    """금리(%) → 현금 지수 (첫날 1 · 전날 금리 × 날수/basis) — 화면 btSynLevels(만기 0)"""
    lv = np.ones(len(d))
    for i in range(1, len(d)):
        lv[i] = lv[i - 1] * (1.0 + y[i - 1] / 100.0 * (d[i] - d[i - 1]) / float(basis))
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
            raise Fail('^GSPC 일봉에 %s 이 없음' % ymd(START))
        self.gspc = g
        self.rates = {}                                               # 금리 키 → {d, y, a} (R:USD · 레버리지 식의 R:FF)
        self.rate = self.rate_of('R:USD')
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

    def rate_of(self, key):
        """금리 파일(data/etfbt/r/<키>.json — 화면이 받는 것과 같음) → {d, y, a} · 첫날이 시작일 뒤면 실패"""
        if key not in self.rates:
            try:
                j, d = self.rfile(key.replace(':', '_'))
            except FileNotFoundError:
                raise Fail('금리 파일 %s 이 없음' % key)
            if j.get('mat', 0) != 0:
                raise Fail('%s 은 현금 금리가 아님' % key)
            y = np.array(j['y'], np.float64)
            if len(y) != len(d) or d[0] > START:
                raise Fail('%s 금리 파일 이상 (첫날 %s)' % (key, ymd(d[0])))
            self.rates[key] = {'d': d, 'y': y, 'a': rate_levels(d, y, j.get('b') or 365)}
        return self.rates[key]

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
        """Y:^NDX + 1985-10-01 전 ^IXIC (1971-02-05 부터)"""
        nd = extend_back(self.raw('Y:^NDX'), self.raw('Y:^IXIC'))
        if nd['d'][0] > START:
            raise Fail('^IXIC 이 %s 부터가 아님 (%s)' % (ymd(START), ymd(nd['d'][0])))
        return nd

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
        cash = cash_ret(self.rate_of(rc.get('cr') or 'R:USD'), cal)   # 레버리지·인버스 식은 'cr'(연방기금 금리) — 화면과 같음
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
                raise Fail('%s 재현이 %s 부터 — %s 까지 닿지 않음 (재료 자료 확인)' % (c.upper(), ymd(d[0]), ymd(START)))
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
