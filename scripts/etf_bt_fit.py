#!/usr/bin/env python3
"""ETF 차트 비교 — 상장 전 백테스트 '재현 방법' 고르기 (자료: scripts/etf_bt_data.py 캐시)

ETF(대상 T)마다 상장 후 실제 일별 총수익(분배 재투자 수정가)을, 더 오래된 시계열(후보)로 재현하는 식을 찾는다.
  일별 초과수익 모형   r_T − c_T  =  Σ w_j · x_j  +  d          (c_T: T 통화의 현금 수익 = 원화 CD91 · 달러 T-bill)
     x_j = 후보 j 의 같은 날 수익 − 현금 (환 노출 'u': 대상 통화로 바꾼 수익 − T 통화 현금 · 환헤지 'h': 원래 통화 수익 − 그 통화 현금)
     원/달러는 한국은행 원/달러 종가(15:30) — 국내 ETF 종가와 같은 시각 · 그 밖의 통화는 야후 USD 교차
     w = 노출 배수(레버리지·인버스 포함) · d = 보수·추적 차이(연 단위로 저장)
  후보: 더 오래된 국내·미국 ETF · 지수(네이버·야후 — S&P 500 은 배당 재투자 지수, 1988년 전은 실러 배당으로 이어 붙임)
        · 옵션 전략 지수 — C: Cboe(BuyWrite·PutWrite·칼라·버퍼 등) · D: 한국거래소(코스피 200 커버드콜·위클리 커버드콜·양매도 등, 국내 상장만)
          커버드콜·버퍼·옵션 인컴 ETF 는 모두 시험하되, 지수를 넣어 고른 식과 빼고 고른 식 중 나은 쪽 (앞에서부터 고르는 방식이라 넣어서 나빠지지 않게)
          D: 지수는 지수 자체의 식도 골라(기준일 전 재현) 오차 5% 이하면 그 지수를 쓰는 ETF 백테스트에 이어 붙임
        · 상위 보유 종목 · 금리로 만든 채권·현금 지수 · (구성 비중 그대로의 '구성종목 바스켓')
  시차: 대상 시장 마감 때 이미 알려진 값(lag) — 국내 ETF ↔ 미국 자산처럼 마감 시각이 다른 후보는 w 를 5거래일 합으로 추정(시차 잡음 제거)
  고르기: 주간 상관으로 후보를 좁힌 뒤 최대 3개 항을 앞으로 하나씩 더하며, 상장 후 기간을 시간 순 3(또는 2)등분한 교차 검증
          (나머지 구간으로 w·d 를 정하고 빠진 구간에서 오차를 잼)으로 '연 오차' = √(연 수익률 차² + 1개월 단위 추적오차²) 가 가장 작은 식
          (수익률 차는 빠진 구간 평균의 표본 잡음을 뺀 값 · d 는 폴드 안에서도 최종 식처럼 사전값 쪽으로 당김)
          · 콜 매도 ETF(이름)는 기초자산에 콜 매도(만기 주기·행사가·변동성 배수) 덧씌우기 · 운용 방식이 바뀐 ETF 는 바뀐 뒤 구간으로
          · 배수 상한 3.5 · 오차가 연 50% 를 넘으면 버림 · 후보 ETF 백테스트(오차 5% 이하)를 이어 붙여 더 먼 과거까지(최대 3단)
          · 오차가 거의 같으면(15% 또는 0.15%p 안) 더 먼 과거까지 재현되는 후보 · 자료 오류(하루 튀었다 돌아온 값)는 빼고 추정
  결과: data/etfbt/<묶음>.json (ETF 마다 식·검증 오차·백테스트 시작일·분배 습관) · data/etfbt/r/<키>.json (화면이 현금·채권 지수·환율·이어 붙인 지수를 만들 때)

사용  python3 scripts/etf_bt_fit.py [--cache .btcache] [--only K:498400,U:JEPQ] [--explain]
"""
import argparse, datetime, json, math, os, re, sys, time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EPOCH = datetime.date(1970, 1, 1)
OUT = os.path.join(ROOT, 'data', 'etfbt')
NSHARD = 16
MIN_DAYS = 40           # 상장 후 이 거래일 수 이상: 정식 교차 검증(3항까지)
MIN_SHORT = 15          # 15 ~ 39 거래일: 1항 · 2등분 검증(짧은 검증 표시) — 국내는 같은 기초지수 ETF 를 먼저
MAX_TERMS = 3
TOPK = 30
TE_H = 21               # 추적오차를 재는 기간(거래일) — 화면에서 고르는 가장 짧은 기간(1개월)
NEAR_REL, NEAR_ABS = 0.15, 0.0015    # 이만큼 안이면 '오차가 거의 같음' → 더 먼 과거까지 재현되는 후보
NEAR_GAIN = 365         # 그 후보가 가장 잘 맞는 후보보다 이 날수 이상 더 먼 과거까지 될 때만
OFFSET_CORR = 0.9       # 이보다 상관이 큰 두 항을 서로 반대 방향(상쇄)으로 쓰지 않음
CBOE_WMIN, CBOE_WMAX = 0.2, 1.6   # 옵션 전략 지수(C: Cboe · D: 한국거래소) 항의 배수 범위
ACC_REL, ACC_ABS = 0.92, 0.001       # 항을 더할 때: 오차가 8% 이상 · 0.1%p 이상 줄어야
RES_K = 15              # 2번째 항부터: 지금 식의 잔차와 상관이 큰 후보를 이만큼 더 시험
RES_REL, RES_ABS = 0.85, 0.002       # 잔차로 찾은 후보는 더 엄격히(15% · 0.2%p) — 후보가 많아 우연히 맞는 것을 막음
MIN_W = 0.03            # 더하는 항의 배수가 이보다 작으면(사실상 0) 쓰지 않음
W_MAX, WZ_MAX = 3.5, 1.5  # 배수 상한 (가장 큰 레버리지 3배 + 여유 · 콜 매도 덧씌우기) — 현금 같은 후보에 수십 배를 곱해 잡음을 맞추는 것을 막음
E_DROP = 0.5            # 검증 오차가 연 50%를 넘으면 재현이라 할 수 없어 백테스트를 붙이지 않음
CHAIN_EC = 0.05         # 후보 ETF 의 백테스트(이어 붙인 앞 구간 포함 오차)가 연 5% 이하일 때만 이어 붙임 (화면 BT_CHAIN_EC)
# 보수·추적 차이 d 줄이기 · 교차 검증 · 예상 오차 보정 — '젊은 ETF 흉내' 시험(10년 넘은 ETF 300개를 최근 120·250·450거래일만 있는 것처럼
# 식을 고른 뒤 그 전 최대 10년 실제 값과 비교)에서 정함
#   d = 맞춘 d 를 사전값 d0 쪽으로 당긴 사후 평균 · d0 = −보수 + Σ 배수 × 후보 ETF 보수 · SE = 추적오차 ÷ √년
#       사전 분포 = 정규(τ, 90%) + 넓은 정규(8%, 10%) · τ = √(1%² + Σ(배수 × 빠진 수익 2.5%)² + 덧씌우기 없는 콜 매도 5%²)
#   교차 검증도 폴드마다 같은 방법으로 d 를 당기고, 수익률 차에서 빠진 구간 평균의 표본 잡음을 뺌
#     → 상장 전 구간 연 수익률 차 중앙값 1.24% → 0.85%(120일) · 0.94% → 0.68%(250일) · 0.76% → 0.65%(450일)
#   예상 오차 = √((1.65 × 검증 오차)² + 0.4%²)  (상장 전 구간 실제 오차의 중앙값과 맞음 · 86~90% 가 이 값의 2배 안)
D_TAU = 0.01
PI_SIG = 0.025          # 배당·이자가 빠진 후보(가격 지수·국내 종목·선물·환율)는 d0 이 그 수익을 몰라 τ 에 (배수 × 이 값)² 를 더함
OPT_SIG = 0.05          # 콜 매도 ETF 를 덧씌우기 없이 맞춘 식: d0 이 옵션 매도 손익을 몰라 τ 에 이 값² 를 더함
D_TAU2, D_PI = 0.08, 0.1   # 넓은 사전 분포(레버리지 조달 비용·전략 차이처럼 d0 에서 먼 ETF) — 자료가 충분하면 거의 당기지 않음
X_MUL, X_FLOOR = 1.65, 0.004
FEE_DEFAULT = 0.004
CV_NOISE = True         # 교차 검증 수익률 차에서 빠진 구간 평균의 표본 잡음(추적오차² ÷ 구간 연수)을 뺌 — 짧은 자료의 잡음이 '오차'로 잡히지 않게
CV_SHRINK = True        # 교차 검증의 각 폴드에서도 d 를 최종 식과 같은 방법으로 d0 쪽으로 당김 — 검증이 실제로 쓰는 식을 재게
KR_CAL_KEY, US_CAL_KEY = 'N:KOSPI', 'Y:^GSPC'
US_CAL_FROM = (datetime.date(1980, 1, 1) - EPOCH).days   # 화면이 받는 야후 일봉이 1980년부터(Worker period1) → 같게

# 시장 마감 순서 (같은 날짜 안에서 UTC 기준) — 대상 시장보다 늦게 끝나는 시장의 '그날 값'은 대상 마감 때 아직 모름
CLOSE_UTC = {'KR': 6.5, 'AS': 7.5, 'EU': 16.5, 'US': 21.0, 'FX': 22.0, 'CX': 24.0, 'RK': 6.5, 'RU': 21.0}

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from etf_bt_data import YAHOO_IDX, NAVER_IDX, FX_PAIR, norm_cur, single_stock_keys, krx_en_name   # noqa: E402
YIDX_NAMES = {x[0]: x[3] for x in YAHOO_IDX + NAVER_IDX}

# 금리·변동성 수준·중복 지수는 후보에서 뺌 (^GSPC·^SP500TR → 배당 재투자 S&P 500 'X:SPXTR' · 원/달러 → 'F:USDKRW')
EXCLUDE = {'Y:^GSPC', 'Y:^SP500TR', 'Y:^VIX', 'Y:^IRX', 'Y:^FVX', 'Y:^TNX', 'Y:^TYX', 'Y:KRW=X', 'Y:^KS11', 'Y:^KQ11',
           # 장외 신탁(프리미엄·할인이 크게 출렁임)에서 ETF 로 바뀐 그레이스케일 상품 — 바뀌기 전 가격이 기초자산을 따르지 않아 후보로 쓰지 않음
           'U:GBTC', 'U:ETHE', 'U:GDLC', 'U:GSOL', 'U:GLNK', 'U:GXRP', 'U:GDOG'}

# S&P 500 배당(연율, 지수 단위 · 실러 자료 1979-12 ~ 1988-02, 월별) — ^SP500TR(1988-01-04 ~) 전 구간을 배당 재투자로 만들 때
# 출처: Robert Shiller 'U.S. Stock Markets 1871-Present' (github.com/datasets/s-and-p-500) · 1989~2022 ^SP500TR 과 연 0.1%p 안으로 일치 확인
SPX_DIV0 = (1979, 12)
SPX_DIV = [5.65, 5.7, 5.75, 5.8, 5.84667, 5.89333, 5.94, 5.98333, 6.02667, 6.07, 6.1, 6.13, 6.16, 6.2, 6.24, 6.28, 6.31667, 6.35333, 6.39, 6.43333,
           6.47667, 6.52, 6.55667, 6.59333, 6.63, 6.66, 6.69, 6.72, 6.75, 6.78, 6.81, 6.82333, 6.83667, 6.85, 6.85667, 6.86333, 6.87, 6.88333, 6.89667,
           6.91, 6.92, 6.93, 6.94, 6.96, 6.98, 7.0, 7.03, 7.06, 7.09, 7.12, 7.15, 7.18, 7.22333, 7.26667, 7.31, 7.33333, 7.35667, 7.38, 7.43, 7.48,
           7.53, 7.57333, 7.61667, 7.66, 7.68667, 7.71333, 7.74, 7.77333, 7.80667, 7.84, 7.86, 7.88, 7.9, 7.94, 7.98, 8.02, 8.04667, 8.07333, 8.1,
           8.14333, 8.18667, 8.23, 8.24667, 8.26333, 8.28, 8.3, 8.32, 8.34, 8.4, 8.46, 8.52, 8.56667, 8.61333, 8.66, 8.71, 8.76, 8.81, 8.85667, 8.90333]


def ymd(x):
    return (EPOCH + datetime.timedelta(int(x))).isoformat()


# 후보 일봉 자료 오류 정리 (화면 btClean 과 같은 식) — 국내(네이버 K:·N:) 일봉만
NAVER_FROM = (datetime.date(1990, 3, 2) - EPOCH).days   # 네이버 일봉의 1990-03-02 전은 수정주가 반영 전 값이 섞임(삼성전자 하루 −99% 등)
SPIKE_R, SPIKE_BACK = 0.4, 0.02                         # 하루 ±40% 넘게 튀었다가 다음 날 2% 안으로 돌아오면 잘못 찍힌 값
KR_LIM_DAY, KR_LIM0, KR_LIM1 = (datetime.date(2015, 6, 15) - EPOCH).days, 0.31, 0.61   # 가격제한폭(±15% → ±30%, 2배 상품은 그 2배) 밖 = 끊김


def clean_dep(key, d, a):
    """→ (d, a) · 국내(K:·N:)만: 1990-03-02 전은 버림 · 튀었다 돌아온 값은 전날 값으로 · 가격제한폭으로 불가능한 하루 변화(2015-06-15 전 ±31% ·
    그 뒤 ±61%)는 끊김 → 그 전 값을 이어 맞춤 (화면 btClean 과 같은 순서·식) · 미국·해외(야후)는 레버리지·변동성 상품의 실제 급등락과 구분이 어려워 그대로"""
    if key[:2] == 'C:':
        return clean_cboe(d, a)
    if key[:2] not in ('K:', 'N:'):
        return d, a
    if len(d) and d[0] < NAVER_FROM:
        i0 = int(np.searchsorted(d, NAVER_FROM))
        d, a = d[i0:], a[i0:]
    n = len(a)
    if n < 2:
        return d, a
    r = a[1:] / a[:-1] - 1.0                         # r[i-1] = i 번째 날 수익
    sp = np.zeros(n, bool)
    if n >= 3:
        sp[1:n - 1] = (np.abs(r[:-1]) > SPIKE_R) & (np.abs(a[2:] / a[:-2] - 1.0) < SPIKE_BACK)
    bk = np.zeros(n, bool)
    bk[1:] = np.abs(r) > np.where(np.asarray(d[1:]) < KR_LIM_DAY, KR_LIM0, KR_LIM1)
    bk &= ~sp
    if not sp.any() and not bk.any():
        return d, a
    a = np.array(a, dtype=np.float64, copy=True)
    for i in np.where(sp)[0]:
        a[i] = a[i - 1]
    for b in np.where(bk)[0][::-1]:
        f = a[b] / a[b - 1]
        a[:b] *= f
    return d, a


CBOE_GAP, CBOE_SPIKE, CBOE_BACK = 10, 0.2, 0.02


def clean_cboe(d, a):
    """Cboe 옵션 전략 지수 일봉 정리 → (d, a) — 화면은 이 결과를 그대로 담은 파일(data/etfbt/r/C_<기호>.json)을 받음
    · 날 간격이 10일 넘게 비는 마지막 곳 뒤부터(옛 구간이 월말 값뿐인 지수 — PutWrite 1991~2006 등) · 하루 ±20% 넘게 튀었다가 다음 날 2% 안으로
      돌아온 값은 전날 값으로 (BXY 2013-03-11 −26% → 다음 날 +35% 같은 잘못 찍힌 값)"""
    n = len(d)
    if n >= 2:
        g = np.where(np.diff(np.asarray(d, dtype=np.int64)) > CBOE_GAP)[0]
        if len(g):
            d, a = d[g[-1] + 1:], a[g[-1] + 1:]
            n = len(d)
    if n < 3:
        return d, a
    r = a[1:] / a[:-1] - 1.0
    sp = np.zeros(n, bool)
    sp[1:n - 1] = (np.abs(r[:-1]) > CBOE_SPIKE) & (np.abs(a[2:] / a[:-2] - 1.0) < CBOE_BACK)
    if not sp.any():
        return d, a
    a = np.array(a, dtype=np.float64, copy=True)
    for i in np.where(sp)[0]:
        a[i] = a[i - 1]
    return d, a


# ───────────── 모의 커버드콜 지수 Z: (코스피 200 − 콜, 매일 블랙-숄즈로 다시 평가 · 변동성 = VKOSPI × l) ─────────────
# 한국거래소 커버드콜 지수(월간 ATM 2013~ · 5% OTM 2007~ 등)를 기준일 전으로 재현할 후보 — VKOSPI 가 시작하는 2003년부터
# 만기일에 행사가 = 그날 코스피 200 × (1 + k) 인 콜을 1개 팔고(프리미엄은 다시 투자 — BXM 방식), 만기까지 매일 (지수 − 콜 가치)로 평가
# 덧씌우기(cc_col)는 옵션 손익을 만기일에만 반영해 매일 값이 다른 지수를 잘 따라가지 못함(월간 ATM 1개월 추적오차 7.7% → 이 모의 3.3% — 시험)
ZSIM_UNDER, ZSIM_VOL = 'D:K2G01P', 'D:O2901P'      # 한국거래소 코스피 200(가격) · 코스피 200 변동성지수(VKOSPI)
KRX_AUX = {ZSIM_UNDER, ZSIM_VOL}                   # 재료로만 — 후보·대상이 아님 (VKOSPI 는 수익이 아닌 변동성 수준)
ZSIM = {}
for _P, _ks in (('M', (0.0, 0.02, 0.05)), ('W', (0.0, 0.01))):
    for _k in _ks:
        for _l in (0.8, 0.9, 1.0):
            ZSIM['Z:%s%02dL%02d' % (_P, round(_k * 1000), round(_l * 100))] = (_P, _k, _l)
ZSIM_BASE = 1000.0


def zsim_levels(cal, S, sig, P, k, l):
    """모의 커버드콜 수준 (달력 cal 위 · 첫 만기 전과 재료가 없는 날은 NaN) — S 코스피 200 · sig VKOSPI(소수) · P 'M'/'W' · k 행사가 OTM · l 변동성 배수
    만기 a 에 행사가 K = S_a(1+k) 콜을 팔고 a~다음 만기 b 동안 수준 = 수준_a × (S_t − C_t) ÷ (S_a − C_a) — C_t = 블랙-숄즈(남은 날 ÷ 365, sig_t × l, 금리 0),
    만기일 b 는 내재가치 · 마지막 만기 뒤(아직 오지 않은 만기)는 평일 달력으로 이어 그 다음 만기까지 남은 날을 셈"""
    cal = np.asarray(cal, dtype=np.int64)
    n = len(cal)
    fut = []                                           # 앞으로의 평일 45일 (마지막 만기 뒤 기간의 다음 만기·남은 날)
    x = int(cal[-1])
    while len(fut) < 45:
        x += 1
        if (x + 3) % 7 < 5:
            fut.append(x)
    calx = np.concatenate([cal, np.array(fut, np.int64)])
    ex = np.where(expiry_flags(calx, P, 'KR'))[0]
    lv = np.full(n, np.nan)
    on = False
    for a, b in zip(ex[:-1], ex[1:]):
        if a >= n:
            break
        if not on:
            if not (S[a] > 0) or not (sig[a] > 0):
                continue
            lv[a] = ZSIM_BASE
            on = True
        if not (lv[a] > 0):
            break
        K = S[a] * (1.0 + k)
        base = S[a] - S[a] * float(bs_call(K / S[a], (calx[b] - calx[a]) / 365.0, sig[a] * l))
        t = np.arange(a + 1, min(b, n - 1) + 1)
        if not len(t):
            continue
        St = S[t]
        Ct = St * bs_call(K / St, (calx[b] - cal[t]) / 365.0, sig[t] * l)
        lv[t] = lv[a] * (St - Ct) / base
    return lv


def is_kr(key):
    """국내 달력·원화 키 — 국내 ETF·종목(K:) · 한국거래소 옵션 전략 지수(D:)"""
    return key[:2] in ('K:', 'D:')


def opt_idx(key):
    """옵션 전략 지수 키 — C: Cboe(미국) · D: 한국거래소(국내) · Z: 모의 커버드콜 — 전략이 이미 든 지수라 콜 매도 덧씌우기·음수·큰 배수를 쓰지 않음"""
    return key[:2] in ('C:', 'D:', 'Z:')


def shard_of(key):
    """화면 btShard 와 같음 — 키('K:069500') 글자 코드 합 % 16"""
    return sum(ord(c) for c in key) % NSHARD


# ───────────── 금리 → 현금·채권 지수 (화면 JS 와 같은 식) ─────────────
def par_bond_ret(y0, y1, mat, days):
    """만기 mat 년 반기 이표 국채를 y0 금리에 액면으로 사서 days 일 뒤 y1 금리로 평가한 수익 (이자 포함) — 금리는 소수(0.035)"""
    carry = y0 * days / 365.0
    if mat <= 0.5:                                # 3개월물 등: 듀레이션 ≈ 만기
        return carry - mat * (y1 - y0)
    n = 2.0 * mat
    r = y1 / 2.0
    if abs(r) < 1e-9:
        price = y0 / 2.0 * n + 1.0
    else:
        price = (y0 / 2.0) * (1.0 - (1.0 + r) ** (-n)) / r + (1.0 + r) ** (-n)
    return price - 1.0 + carry


# 키 → (원자료 금리 이름, 만기 년(0 = 현금), 통화)
SYN = {'R:KRW': ('CD91', 0, 'KRW'), 'R:CALL': ('CALL', 0, 'KRW'), 'R:USD': ('^IRX', 0, 'USD'), 'R:FF': ('DFF', 0, 'USD'),
       'B:MSB1': ('MSB1', 1, 'KRW'), 'B:KTB1': ('KTB1', 1, 'KRW'), 'B:MSB2': ('MSB2', 2, 'KRW'), 'B:KTB3': ('KTB3', 3, 'KRW'), 'B:CORP3': ('CORP3', 3, 'KRW'),
       'B:KTB5': ('KTB5', 5, 'KRW'), 'B:KTB10': ('KTB10', 10, 'KRW'), 'B:KTB20': ('KTB20', 20, 'KRW'), 'B:KTB30': ('KTB30', 30, 'KRW'), 'B:KTB50': ('KTB50', 50, 'KRW'),
       'B:UST5': ('^FVX', 5, 'USD'), 'B:UST10': ('^TNX', 10, 'USD'), 'B:UST30': ('^TYX', 30, 'USD')}
SYN_NAME = {'R:KRW': 'CD91 금리', 'R:CALL': '콜금리', 'R:USD': '미국 단기국채 금리', 'R:FF': '미국 연방기금 금리', 'B:MSB1': '통안채 1년', 'B:KTB1': '국고채 1년', 'B:MSB2': '통안채 2년',
            'B:KTB3': '국고채 3년', 'B:CORP3': '회사채 3년(AA-)', 'B:KTB5': '국고채 5년', 'B:KTB10': '국고채 10년', 'B:KTB20': '국고채 20년',
            'B:KTB30': '국고채 30년', 'B:KTB50': '국고채 50년', 'B:UST5': '미국채 5년', 'B:UST10': '미국채 10년', 'B:UST30': '미국채 30년',
            'F:USDKRW': '원/달러 환율', 'X:SPXTR': 'S&P 500 TR'}


# 현금 금리의 날수 기준 (없으면 365) — 연방기금 금리는 실제 날수/360 으로 붙는 금리
SYN_BASIS = {'R:FF': 360}
# 식 고르기 후보에서 빼는 합성 금리 — R:FF 는 레버리지·인버스 식의 현금 금리로만 씀(아래 LEV_*)
SYN_NOCAND = {'R:FF'}
# 레버리지·인버스 미국 ETF(야후 분류 'Trading--Leveraged…'·'Trading--Inverse…' · 달러 식 · 노출 합 W ≥ LEV_HI 또는 ≤ LEV_LO):
#   현금·빌린 돈 이자를 단기국채(R:USD) 대신 연방기금 금리(R:FF)로 — (분류를 함께 보는 까닭: 채권·고베타 ETF 도 W 가 1.2 넘게 맞춰지곤 함 — 빌린 돈이 아님)
#   식 r = f + Σw·(x − f) + d (f = 연방기금) · 1993~2009 레버리지·인버스 펀드 15개(뮤추얼펀드 포함)를 2010년 뒤 자료로 맞춰 그 전 해마다 견준
#   검증에서 오차가 작았음(평균 |오차| 1.58 → 1.50%p · 인버스 1.94 → 1.77%p · 2007~08 국채 금리가 급락한 때 크게 나음 · 롱은 비슷) — 식에 'cr' 로 적음
LEV_HI, LEV_LO = 1.2, -0.2
LEV_RATE = 'R:FF'
LEV_CATS = ('Trading--Leveraged', 'Trading--Inverse')


LEV_PREV = set()      # 지난 실행에서 연방기금 금리(cr)로 맞춘 식 — 이번에 야후 분류를 못 받았을 때만 씀 (main 이 채움)


def is_lev_etf(D, tk):
    """레버리지·인버스 상품인가 — 미국 ETF 의 야후 분류(meta/us · category)로 · 분류가 비었으면 지난 식이 그랬는지로
    (분류 하나를 못 받았다고 그 주에만 단기국채 금리 식으로 바뀌어 상장 전 값이 오락가락하지 않게)"""
    if not tk.startswith('U:'):
        return False
    cat = str(D.meta(tk).get('category') or '')
    return cat.startswith(LEV_CATS) if cat else tk in LEV_PREV


def syn_levels(dates, yields_pct, mat, basis=365):
    """금리 시계열(%) → 총수익 지수(첫날 1) · basis: 현금(만기 0)의 날수 기준"""
    lv = np.ones(len(dates))
    for i in range(1, len(dates)):
        y0, y1 = yields_pct[i - 1] / 100.0, yields_pct[i] / 100.0
        dd = dates[i] - dates[i - 1]
        r = (y0 * dd / float(basis)) if mat == 0 else par_bond_ret(y0, y1, mat, dd)
        lv[i] = lv[i - 1] * (1.0 + r)
    return lv


def spx_prefix(g, base_d0):
    """^GSPC 종가 + 실러 월 배당(연율 ÷ 365 × 날수) → 배당 재투자 지수 (base_d0 날까지, 그날 = 1) — 화면 btSpxPrefix 와 같은 식"""
    d, p = g['d'], g['c']
    i0 = int(np.searchsorted(d, (datetime.date(*SPX_DIV0, 1) - EPOCH).days))
    i1 = int(np.searchsorted(d, base_d0))
    if i1 >= len(d) or d[i1] != base_d0 or i1 <= i0:
        return None
    lv = np.ones(i1 - i0 + 1)
    for k in range(1, len(lv)):
        i = i0 + k
        dt = EPOCH + datetime.timedelta(int(d[i]))
        m = (dt.year - SPX_DIV0[0]) * 12 + dt.month - SPX_DIV0[1]
        dv = SPX_DIV[min(max(m, 0), len(SPX_DIV) - 1)]
        lv[k] = lv[k - 1] * (p[i] + dv * (d[i] - d[i - 1]) / 365.0) / p[i - 1]
    lv = np.round(lv / lv[-1], 12)                    # 화면이 받는 파일(data/etfbt/r/X_SPXTR.json)과 같은 자릿수
    return d[i0:i1 + 1].astype(np.int64), lv


class Data:
    def __init__(self, cache):
        self.cache = cache
        self.uni = json.load(open(os.path.join(cache, 'universe.json'), encoding='utf-8'))
        rp, fp = os.path.join(cache, 'rates.json'), os.path.join(cache, 'fx.json')
        self.rates = json.load(open(rp, encoding='utf-8')) if os.path.exists(rp) else {}
        self.fx = json.load(open(fp, encoding='utf-8')) if os.path.exists(fp) else {}
        self._s = {}
        self.meta_kr, self.meta_us = {}, {}
        self.spx_pre = None

    def fkey(self, key):
        return re.sub(r'[^0-9A-Za-z_-]', lambda m: '_%02x' % ord(m.group(0)), key)

    def series(self, key):
        """키 → {d, c, a, v_d, v_a} (합성 키 R:/B: 는 금리로 · F:USDKRW 한국은행 15:30 종가 · X:SPXTR 이어 붙인 S&P 500 TR)"""
        if key in self._s:
            return self._s[key]
        s = None
        z0 = np.zeros(0, np.int32)
        if key in SYN:
            src, mat, cur = SYN[key]
            if src.startswith('^'):
                y = self.series('Y:' + src)
                if y is not None and len(y['d']):
                    yv = np.round(y['c'], 4)                  # 화면이 받는 금리 파일과 같은 자릿수
                    lv = syn_levels(y['d'], yv, mat, SYN_BASIS.get(key, 365))
                    s = {'d': y['d'], 'c': lv, 'a': lv, 'v_d': z0, 'v_a': np.zeros(0), 'y': yv}
            else:
                r = self.rates.get(src)
                if r and r['d']:
                    d = np.array(r['d'], np.int32); v = np.round(np.array(r['v'], np.float64), 4)
                    lv = syn_levels(d, v, mat, SYN_BASIS.get(key, 365))
                    s = {'d': d, 'c': lv, 'a': lv, 'v_d': z0, 'v_a': np.zeros(0), 'y': v}
        elif key in ZSIM:
            cal = self.series(KR_CAL_KEY)['d'].astype(np.int64)
            su, sv = self.series(ZSIM_UNDER), self.series(ZSIM_VOL)
            if su is not None and sv is not None and len(su['d']) and len(sv['d']):
                S = align_level(su, cal, 0)
                sg = align_level(sv, cal, 0) / 100.0
                P, k, l = ZSIM[key]
                lv = zsim_levels(cal, S, sg, P, k, l)
                ok = np.where(~np.isnan(lv))[0]
                # 끝 = 재료 둘 다 값이 있는 마지막 날 (그 뒤 달력 날은 값을 이어 쓴 것일 뿐 — 하루가 '변화 없음'으로 잡히지 않게)
                i_end = int(np.searchsorted(cal, min(int(su['d'][-1]), int(sv['d'][-1])), side='right')) - 1
                ok = ok[ok <= i_end]
                if len(ok) > 30:
                    i0, i1 = int(ok[0]), int(ok[-1])
                    v = np.round(lv[i0:i1 + 1], 6)             # 화면이 받는 파일(r/Z_*.json)과 같은 자릿수
                    s = {'d': cal[i0:i1 + 1].astype(np.int32), 'c': v, 'a': v, 'v_d': z0, 'v_a': np.zeros(0)}
        elif key == 'F:USDKRW':
            f = self.fx.get('USDKRW')
            if f and f['d']:
                v = np.array(f['v'], np.float64)
                s = {'d': np.array(f['d'], np.int32), 'c': v, 'a': v, 'v_d': z0, 'v_a': np.zeros(0)}
        elif key == 'X:SPXTR':
            base, g = self.series('Y:^SP500TR'), self.series('Y:^GSPC')
            if base is not None and g is not None:
                pre = spx_prefix(g, int(base['d'][0]))
                if pre is not None:
                    pd_, pl = pre
                    k = base['a'][0]
                    self.spx_pre = (pd_, pl)
                    d = np.concatenate([pd_[:-1], base['d']]).astype(np.int32)
                    a = np.concatenate([pl[:-1] * k, base['a']])
                    s = {'d': d, 'c': a, 'a': a, 'v_d': z0, 'v_a': np.zeros(0)}
        else:
            p = os.path.join(self.cache, 'series', self.fkey(key) + '.npz')
            if os.path.exists(p):
                z = np.load(p)
                s = {k: z[k] for k in z.files}
                d2, a2 = clean_dep(key, s['d'], s['a'])         # 자료 오류 정리 (화면과 같게)
                if len(d2) != len(s['d']):
                    s['c'] = s['c'][len(s['d']) - len(d2):]
                s['d'], s['a'] = d2, a2
        self._s[key] = s
        return s

    def info(self, key):
        if key in ZSIM:
            s = self.series(key)
            return {'mk': 'KR', 'cur': 'KRW', 'kind': 'idx', 'start': int(s['d'][0]) if s is not None else None,
                    'end': int(s['d'][-1]) if s is not None else None, 'n': len(s['d']) if s is not None else 0, 'name': name_of(self, key)}
        if key in SYN:
            src, mat, cur = SYN[key]
            s = self.series(key)
            return {'mk': 'RU' if cur == 'USD' else 'RK', 'cur': cur, 'kind': 'syn', 'start': int(s['d'][0]) if s is not None else None,
                    'end': int(s['d'][-1]) if s is not None else None, 'n': len(s['d']) if s is not None else 0}
        if key in ('F:USDKRW', 'X:SPXTR'):
            s = self.series(key)
            return {'mk': 'KR' if key == 'F:USDKRW' else 'US', 'cur': 'KRW' if key == 'F:USDKRW' else 'USD', 'kind': 'idx',
                    'start': int(s['d'][0]) if s is not None else None, 'end': int(s['d'][-1]) if s is not None else None, 'n': len(s['d']) if s is not None else 0}
        u = self.uni.get(key) or {}
        if key.startswith('Y:') and key.endswith('=X') and u:
            u = dict(u); u['cur'] = 'USD'; u['mk'] = 'FX'         # 환율 교차는 '달러로 잰 값'으로 후보에 (달러 지수·통화 ETF)
        elif u.get('cur'):
            u = dict(u); u['cur'] = norm_cur(u['cur'])
        return u

    def kr_names(self):
        """국내 종목 코드 → 이름 (국내 ETF 상위 10 구성종목 목록에서)"""
        if getattr(self, '_krn', None) is None:
            self._krn = {}
            d = os.path.join(self.cache, 'meta', 'kr')
            for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                try:
                    j = json.load(open(os.path.join(d, f), encoding='utf-8'))
                except Exception:
                    continue
                for h in j.get('etfTop10MajorConstituentAssets') or []:
                    ic, nm = str(h.get('itemCode') or ''), h.get('itemName')
                    if ic and nm and ic not in self._krn:
                        self._krn[ic] = nm
        return self._krn

    def meta(self, key):
        mk, code = key[0], key[2:]
        store, sub = (self.meta_kr, 'kr') if mk == 'K' else (self.meta_us, 'us')
        if code not in store:
            p = os.path.join(self.cache, 'meta', sub, self.fkey(code) + '.json')
            try:
                store[code] = json.load(open(p, encoding='utf-8'))
            except Exception:
                store[code] = {}
        return store[code]


def align_level(s, cal, lag):
    """시계열 s(값 a)을 달력 cal 에 맞춤: lag 0 = 그날까지의 마지막 값 · lag 1 = 전날까지의 마지막 값 · 첫날 전은 NaN"""
    d, a = s['d'], s['a']
    idx = np.searchsorted(d, cal, side='right') - 1 if lag == 0 else np.searchsorted(d, cal, side='left') - 1
    out = np.full(len(cal), np.nan)
    ok = idx >= 0
    out[ok] = a[idx[ok]]
    return out


def rets(level):
    r = np.full(len(level), np.nan)
    r[1:] = level[1:] / level[:-1] - 1.0
    return r


# ───────────── 옵션(콜 매도) 덧씌우기 — 커버드콜 ETF (화면 btCC 와 같은 식) ─────────────
CC_X = {'KR': 3, 'US': 4}            # 주간 만기 요일(월 0): 국내 목요일 · 미국 금요일
CC_M = {'KR': (2, 3), 'US': (3, 4)}  # 월간 만기: 국내 둘째 목요일 · 미국 셋째 금요일
CC_VOL_N = 21                        # 실현 변동성 창(거래일)


def ncdf(x):
    """표준정규 누적분포 — Abramowitz-Stegun 26.2.17 (화면과 같은 근사)"""
    x = np.asarray(x, dtype=np.float64)
    t = 1.0 / (1.0 + 0.2316419 * np.abs(x))
    y = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    p = 1.0 - 0.3989422804014327 * np.exp(-x * x / 2.0) * y
    return np.where(x >= 0, p, 1.0 - p)


def bs_call(K, T, v):
    """기초자산 1, 행사가 K, 만기 T 년, 변동성 v, 금리 0 의 콜 가격"""
    K = np.asarray(K, dtype=np.float64); T = np.asarray(T, dtype=np.float64); v = np.asarray(v, dtype=np.float64)
    ok = (T > 0) & (v > 0)
    sq = np.where(ok, v * np.sqrt(np.where(T > 0, T, 1.0)), 1.0)
    d1 = (-np.log(K) + 0.5 * v * v * T) / sq
    d2 = d1 - sq
    return np.where(ok, ncdf(d1) - K * ncdf(d2), np.maximum(1.0 - K, 0.0))


def expiry_flags(cal, P, cal_name):
    """만기일 표시 (달력 날 번호 cal) — 'D' 매일 · 'W' 그 주 만기 요일 이하의 마지막 거래일 · 'M' 그 달 만기일(n째 요일) 이하의 마지막 거래일"""
    cal = np.asarray(cal, dtype=np.int64)
    n = len(cal)
    f = np.zeros(n, bool)
    if P == 'D':
        f[1:] = True
        return f
    dow = (cal + 3) % 7                               # 월 0 … 일 6 (1970-01-01 = 목요일)
    if P == 'W':
        X = CC_X[cal_name]
        wk = (cal + 3) // 7
        nxt_wk = np.append(wk[1:], -1); nxt_dow = np.append(dow[1:], 9)
        f = (dow <= X) & ((nxt_wk != wk) | (nxt_dow > X))
        f[-1] = False                                 # 다음 거래일을 모르는 마지막 날은 만기로 보지 않음
        return f
    nth, X = CC_M[cal_name]
    ys = np.array([(EPOCH + datetime.timedelta(int(x))).year * 12 + (EPOCH + datetime.timedelta(int(x))).month - 1 for x in cal])
    i = 0
    while i < n:
        j = i
        while j < n and ys[j] == ys[i]:
            j += 1
        y, m = divmod(int(ys[i]), 12)
        first = (datetime.date(y, m + 1, 1) - EPOCH).days
        fd = (first + 3) % 7
        nominal = first + (X - fd) % 7 + 7 * (nth - 1)
        k = -1
        for t in range(i, j):
            if cal[t] <= nominal:
                k = t
        if k >= 0 and (k < n - 1 or cal[k] == nominal):
            f[k] = True
        i = j
    return f


def cc_col(r, cal, flags, k, l):
    """콜 매도 덧씌우기 열 z (커버 1 = 기초자산 1 단위에 콜 1개): 만기일에만 값 = (받은 프리미엄 − 만기 지급액) ÷ 그 전날까지 기간 가치
    프리미엄 = 기간 시작일까지 21거래일 실현 변동성 × l 의 블랙-숄즈 콜(행사가 = 시작가 × (1 + k), 금리 0) · 변동성을 모르는 기간은 0
    기초자산 수익 r 이 없는 날(NaN)은 NaN — 회귀에서 w = 커버 비율 × 노출"""
    n = len(r)
    z = np.where(np.isnan(r), np.nan, 0.0)
    ex = np.where(flags)[0]
    if len(ex) < 2:
        return z
    lr = np.log1p(np.where(np.isnan(r), 0.0, r))
    cum = np.concatenate([[0.0], np.cumsum(lr)])       # cum[i+1] = Σ lr[0..i]
    rr = np.where(np.isnan(r), 0.0, r)
    c1 = np.concatenate([[0.0], np.cumsum(rr)]); c2 = np.concatenate([[0.0], np.cumsum(rr * rr)])
    cn = np.concatenate([[0], np.cumsum(np.isnan(r).astype(np.int64))])
    s, e = ex[:-1], ex[1:]
    R = np.exp(cum[e + 1] - cum[s + 1]) - 1.0
    V = np.exp(cum[e] - cum[s + 1])
    a = s - CC_VOL_N + 1                               # 실현 변동성: r[s−20..s]
    okv = (a >= 0) & (cn[np.maximum(a, 0)] == cn[s + 1]) if True else None
    a0 = np.maximum(a, 0)
    m = CC_VOL_N
    sm = c1[s + 1] - c1[a0]; sq = c2[s + 1] - c2[a0]
    var = np.maximum(0.0, (sq - sm * sm / m) / (m - 1))
    sig = np.sqrt(var * 252.0)
    T = (cal[e] - cal[s]) / 365.0
    prem = bs_call(1.0 + k, T, sig * l)
    val = (prem - np.maximum(R - k, 0.0)) / V
    val = np.where(okv, val, 0.0)
    bad = (cn[e + 1] - cn[s + 1]) > 0                  # 기간 안에 자료가 없는 날 → NaN
    z[e] = np.where(bad, np.nan, val)
    return z


class Engine:
    def __init__(self, D):
        self.D = D
        self.cal = {}
        k = D.series(KR_CAL_KEY); u = D.series(US_CAL_KEY)
        self.cal['KR'] = k['d'].astype(np.int64)
        self.cal['US'] = u['d'][u['d'] >= US_CAL_FROM].astype(np.int64)
        self.usdkrw = D.series('F:USDKRW')
        if self.usdkrw is None:
            raise SystemExit('원/달러 15:30 종가(fx.json)가 없음 — etf_bt_data.py 먼저')
        self._lv = {}

    def level(self, key, cal_name, lag):
        k = (key, cal_name, lag)
        if k not in self._lv:
            if len(self._lv) > 3000:                      # 메모리: 달력 위 값 보관은 3,000개까지 (넘으면 비우고 다시)
                self._lv = {kk: vv for kk, vv in self._lv.items() if kk[0] in ('FX', 'CASH')}
            s = self.D.series(key)
            self._lv[k] = None if s is None or not len(s['d']) else align_level(s, self.cal[cal_name], lag)
        return self._lv[k]

    def fx_level(self, cur, cal_name, lag, to):
        """통화 cur 1단위의 to 통화 가격 (달력 위) — 원/달러는 한국은행 15:30 종가(두 달력 모두 그날 값) · 나머지는 야후 USD 교차(lag)"""
        if cur == to:
            return None
        k = ('FX', cur, to, cal_name, lag)
        if k in self._lv:
            return self._lv[k]

        def usd_per(c):   # c 1단위 = ? 달러
            if c == 'USD':
                return np.ones(len(self.cal[cal_name]))
            if c == 'KRW':
                return 1.0 / align_level(self.usdkrw, self.cal[cal_name], 0)
            pair = FX_PAIR.get(c)
            if not pair:
                return None
            s = self.D.series('Y:' + pair[0])
            if s is None:
                return None
            lv = align_level(s, self.cal[cal_name], lag)
            return lv if pair[1] else 1.0 / lv
        a, b = usd_per(cur), usd_per(to)
        out = None if a is None or b is None else a / b
        self._lv[k] = out
        return out

    def cash_ret(self, cur, cal_name, key=None):
        """현금 일 수익 (달력 위) — key: 쓸 금리(없으면 통화의 기본 현금 R:KRW·R:USD · 레버리지 식은 R:FF)"""
        k = ('CASH', cur, cal_name, key)
        if k not in self._lv:
            if key is None:
                key = 'R:KRW' if cur == 'KRW' else 'R:USD' if cur == 'USD' else None
            if key is None:
                self._lv[k] = np.zeros(len(self.cal[cal_name]))
            else:
                s = self.D.series(key)
                if s is None:                              # 식이 고른 금리(cr)가 캐시에 없음 — 다른 금리로 조용히 바꿔 틀린 값을 내지 않게 멈춤
                    raise ValueError('금리 자료 없음: %s' % key)
                lv = align_level(s, self.cal[cal_name], 0)
                r = rets(lv)
                # 금리 자료 첫날 전: 첫 금리로 (화면 btCash 와 같음)
                first = np.where(~np.isnan(r))[0]
                if len(first):
                    y0 = s['y'][0] / 100.0
                    dd = np.diff(self.cal[cal_name], prepend=self.cal[cal_name][0])
                    r[:first[0]] = y0 * dd[:first[0]] / 365.0
                r[np.isnan(r)] = 0.0
                self._lv[k] = r
        return self._lv[k]

    def column(self, key, cal_name, tcur, lag, var):
        """후보 열: 대상 달력·통화 기준 초과수익 x — var 'n' 같은 통화 · 'u' 환 노출(대상 통화로 변환) · 'h' 환헤지(원래 통화 그대로)"""
        cur = self.D.info(key).get('cur') or 'USD'
        lv = self.level(key, cal_name, lag)
        if lv is None:
            return None
        r = rets(lv)
        if var == 'u' and cur != tcur:
            fx = self.fx_level(cur, cal_name, lag, tcur)
            if fx is None:
                return None
            r = (1.0 + r) * (1.0 + rets(fx)) - 1.0
            return r - self.cash_ret(tcur, cal_name)
        if var == 'h' or cur != tcur:
            return r - self.cash_ret(cur, cal_name)
        return r - self.cash_ret(tcur, cal_name)

    @staticmethod
    def known_lag(fmk, cal_name):
        tmk = 'KR' if cal_name == 'KR' else 'US'
        return 0 if CLOSE_UTC.get(fmk, 21.0) <= CLOSE_UTC[tmk] + 0.01 else 1


def same_market(fmk, cal_name):
    return fmk in (('KR', 'RK') if cal_name == 'KR' else ('US', 'RU'))


def lags_for(fmk, cal_name):
    """후보 시차: 같은 시장 = 그날 값 · 국내 대상의 아시아(일본·대만은 국내보다 먼저 마감)·코인·환율 = 그날·전날 둘 다 시험
    · 미국 대상의 코인·환율(야후 일봉 마감이 미국 마감 뒤) = 둘 다 · 그 밖 = 대상 마감 때 알려진 값 하나"""
    kl = Engine.known_lag(fmk, cal_name)
    if same_market(fmk, cal_name):
        return [kl]
    if (cal_name == 'KR' and fmk in ('AS', 'CX', 'FX')) or (cal_name == 'US' and fmk in ('CX', 'FX')):
        return [kl, 1 - kl]
    return [kl]


def ols(X, y, lam=1e-6, wt=None):
    """최소제곱 (아주 작은 릿지 · wt 가중) — X: n×k"""
    k = X.shape[1]
    if wt is not None:
        sw = np.sqrt(wt)
        X, y = X * sw[:, None], y * sw
    A = X.T @ X
    A = A + lam * np.eye(k) * max(1e-12, float(np.trace(A)) / max(1, k))
    return np.linalg.solve(A, X.T @ y)


def blocks_te(e, size=5):
    """5거래일 묶음 합의 표준편차 × √(252/5) — 하루 시차 잡음을 걸러낸 추적오차"""
    n = len(e) // size
    if n < 3:
        return float(np.std(e) * math.sqrt(252)) if len(e) > 2 else 0.0
    b = e[:n * size].reshape(n, size).sum(1)
    return float(np.std(b, ddof=1) * math.sqrt(252.0 / size))


def bad_days(y):
    """자료 오류: 하루 크게 튀었다가 다음 날 거의 그대로 돌아온 값(액면분할·수정주가 오류 등) → 그 두 날을 추정·채점에서 뺌"""
    n = len(y)
    bad = np.zeros(n, bool)
    if n < 10:
        return bad
    med = float(np.median(y))
    s = 1.4826 * float(np.median(np.abs(y - med))) or float(np.std(y)) or 0.01
    thr = max(0.05, 10.0 * s)
    for i in np.where(np.abs(y) > thr)[0]:
        if i + 1 < n:
            back = (1.0 + y[i]) * (1.0 + y[i + 1]) - 1.0
            if abs(back) < max(0.3 * abs(y[i]), 3.0 * s):
                bad[i] = bad[i + 1] = True
    return bad


def te_of(e):
    """추적오차(연): 21거래일 겹치는 합의 표준편차 × √(252/21) — 하루 시차 잡음은 거의 사라지고 1개월 이상 비교에서 생기는 차이를 잼
    (63거래일 미만 구간은 5거래일 묶음)"""
    n = len(e)
    if n < 3 * TE_H:
        return blocks_te(e)
    c = np.concatenate([[0.0], np.cumsum(e)])
    w = c[TE_H:] - c[:-TE_H]
    return float(np.std(w, ddof=1) * math.sqrt(252.0 / TE_H))


def agg_for(n_train):
    """w 를 추정할 겹치는 창 길이 — 길수록 시장 마감 시각 차이(국내 ETF ↔ 미국 자산)로 w 가 작게 잡히는 것을 막음"""
    return 20 if n_train >= 200 else 10 if n_train >= 100 else 5


def est_w(ex, X, tr, agg=None, wt=None):
    """w 추정: 학습 날(tr)의 일 초과수익 ex 를 X 로 최소제곱 — 학습 날로만 이뤄진 agg 거래일 합(겹치는 창)으로
    · 2단계: 잔차가 아주 큰 창(강건 표준편차 6배 밖)을 빼고 다시"""
    k = X.shape[1]
    if not k:
        return np.zeros(0)
    if agg is None:
        agg = agg_for(int(tr.sum()))
    Xa = ya = wa = None
    if agg > 1:
        ok = tr.astype(np.int64)
        c_ok = np.concatenate([[0], np.cumsum(ok)])
        full = (c_ok[agg:] - c_ok[:-agg]) == agg
        if full.sum() >= max(8, 3 * k):
            Xz = np.where(tr[:, None], X, 0.0); ez = np.where(tr, ex, 0.0)
            CX = np.vstack([np.zeros((1, k)), np.cumsum(Xz, 0)]); CE = np.concatenate([[0.0], np.cumsum(ez)])
            Xa = (CX[agg:] - CX[:-agg])[full]; ya = (CE[agg:] - CE[:-agg])[full]
            wa = None if wt is None else wt[agg - 1:][full]
    if Xa is None:
        Xa, ya, wa = X[tr], ex[tr], (wt[tr] if wt is not None else None)
    w = ols(Xa, ya, wt=wa)
    res = ya - Xa @ w
    s = 1.4826 * float(np.median(np.abs(res - np.median(res))))
    if s > 0:
        keep = np.abs(res) <= 6.0 * s
        if keep.sum() < len(keep) and keep.sum() > 5 * k:
            w = ols(Xa[keep], ya[keep], wt=None if wa is None else wa[keep])
    return w


def prior_d(prior, w):
    """d 를 당길 사전값 → (d0 연, τ) · prior: (대상 보수, 열별 후보 ETF 보수, 열별 빠진 수익 불확실성, 그 밖 불확실성) — None 이면 당기지 않음
    d0 = −대상 보수 + Σ 배수 × 후보 ETF 보수 · τ² = D_TAU² + Σ (배수 × 빠진 수익 불확실성)² + 그 밖²"""
    if prior is None:
        return None
    ft, f, s, xs = prior
    k = len(f)
    wk = np.asarray(w[:k], dtype=np.float64)
    d0 = -ft + (float(np.dot(f, wk)) if k else 0.0)
    tau = math.sqrt(D_TAU * D_TAU + (float(np.sum(np.square(wk * s))) if k else 0.0) + xs * xs)
    return d0, tau


def shrink_to(d, d0, te, yrs, tau):
    """맞춘 d(연)를 사전값 d0 쪽으로 → 사후 평균(연) · SE = 추적오차 ÷ √년
    사전 분포 = 좁은 정규(표준편차 τ, 비중 1 − D_PI) + 넓은 정규(D_TAU2, D_PI) 의 섞임
    · SE 가 크면(짧은 자료) 거의 d0 · d0 에서 SE 보다 훨씬 멀면(레버리지 조달 비용·전략 차이) 거의 맞춘 값 그대로"""
    se = max(1e-4, te) / math.sqrt(max(0.25, yrs))
    dl = d - d0
    v1, v2 = tau * tau + se * se, D_TAU2 * D_TAU2 + se * se
    l1 = (1.0 - D_PI) * math.exp(-0.5 * dl * dl / v1) / math.sqrt(v1)
    l2 = D_PI * math.exp(-0.5 * dl * dl / v2) / math.sqrt(v2)
    p1 = l1 / (l1 + l2) if l1 + l2 > 0 else 0.0
    return d0 + dl * (p1 * tau * tau / v1 + (1.0 - p1) * D_TAU2 * D_TAU2 / v2)


def fold_d(r, prior, w):
    """폴드의 학습 날 로그 차이 r(일) → d(일) — CV_SHRINK 면 최종 식(shrink_d)과 같은 방법으로 d0 쪽으로 당김"""
    d = float(np.mean(r))
    p = prior_d(prior, w) if CV_SHRINK else None
    if p is None:
        return d
    return shrink_to(d * 252.0, p[0], te_of(r), len(r) / 252.0, p[1]) / 252.0


def evaluate(yt, cash, X, folds, good, prior=None, wfix=None):
    """교차 검증: 각 폴드를 빼고 w(est_w)·d(누적 차이, prior 가 있으면 d0 쪽으로 당김)를 맞춘 뒤 빠진 폴드의 연 수익률 차·추적오차(1개월 기준)
    → (연 오차, 수익률 차, 추적오차, 폴드별 오차, 폴드별 w)
    · 수익률 차² 는 빠진 구간 평균의 표본 잡음(추적오차² ÷ 구간 연수)을 빼고 잼(0 아래는 0) — 짧은 구간 평균의 우연이 '재현 오차'로 잡히지 않게
    yt: 대상 총수익(일) · cash: 대상 통화 현금(일) · X: 초과수익 열(n×k, k=0 가능) · good: 자료 오류가 아닌 날 · wfix: 정해 둔 w(바스켓)"""
    ly = np.log1p(yt)
    ex = yt - cash
    k = X.shape[1]
    g2s, tes, ws = [], [], []
    for te_idx in folds:
        tr = good.copy(); tr[te_idx] = False
        w = np.asarray(wfix, dtype=np.float64) if wfix is not None else est_w(ex, X, tr)
        m0 = cash + (X @ w if k else 0.0)
        lm = np.log1p(np.maximum(m0, -0.99))
        d = fold_d(ly[tr] - lm[tr], prior, w) if tr.any() else 0.0
        e = ly[te_idx] - (lm[te_idx] + d)
        e = np.where(good[te_idx], e, 0.0)
        L = len(te_idx)
        g = float(np.sum(e)) / L * 252.0
        t = te_of(e)
        g2s.append(g * g - (t * t * 252.0 / L if CV_NOISE else 0.0))
        tes.append(t)
        ws.append(w)
    g2 = max(0.0, float(np.mean(g2s)))
    te = float(np.mean(tes))
    per = [math.sqrt(max(0.0, a) + t * t) for a, t in zip(g2s, tes)]   # 폴드별 오차 (항을 더할 때 모든 구간에서 나아지는지)
    return math.sqrt(g2 + te * te), math.sqrt(g2), te, per, ws


def make_folds(n, k):
    edges = np.linspace(0, n, k + 1).astype(int)
    return [np.arange(edges[i], edges[i + 1]) for i in range(k)]


def fit_final(yt, cash, X, good):
    """최종 w·d (모든 날)"""
    ex = yt - cash
    w = est_w(ex, X, good)
    m0 = cash + (X @ w if X.shape[1] else 0.0)
    d = float(np.mean((np.log1p(yt) - np.log1p(np.maximum(m0, -0.99)))[good]))
    return w, d


def break_point(yt, cash, X, good):
    """운용 방식이 바뀐 날 찾기 (레버리지 1.5배 → 2배 · 기초지수 교체 등): 5거래일 합으로 앞·뒤를 따로 맞췄을 때
    잔차 제곱합이 크게(F > 30 · 20% 이상) 줄고 w 가 10% 넘게 다르면 그 날(앞뒤 각각 60거래일 이상) → 날 번호 · 없으면 None"""
    n, k = X.shape
    if k == 0 or n < 160:
        return None
    nb = n // 5
    off = n - nb * 5
    ex = np.where(good, yt - cash, 0.0)[off:].reshape(nb, 5).sum(1)
    Xb = np.where(good[:, None], X, 0.0)[off:].reshape(nb, 5, k).sum(1)
    Xc = np.column_stack([Xb, np.ones(nb)])

    def sse(a, b):
        w = np.linalg.lstsq(Xc[a:b], ex[a:b], rcond=None)[0]
        r = ex[a:b] - Xc[a:b] @ w
        return float(r @ r), w
    s0, _ = sse(0, nb)
    best = None
    for c in range(12, nb - 12):
        s1, w1 = sse(0, c); s2, w2 = sse(c, nb)
        if best is None or s1 + s2 < best[0]:
            best = (s1 + s2, c, w1, w2)
    if best is None or best[0] <= 0:
        return None
    ss, c, w1, w2 = best
    F = ((s0 - ss) / (k + 1)) / (ss / max(1, nb - 2 * (k + 1)))
    dw = np.max(np.abs(w2[:k] - w1[:k]) / np.maximum(np.maximum(np.abs(w1[:k]), np.abs(w2[:k])), 0.3))
    if F > 30 and (s0 - ss) / s0 > 0.2 and dw > 0.1:
        return off + c * 5
    return None


def _freq(days):
    """분배 날짜(일수) 목록 → 연 횟수 (간격 중앙값 → 1·2·4·12 중 가까운 값, 주간 분배는 52)"""
    if len(days) < 2:
        return 1
    gaps = np.diff(np.array(sorted(days)))
    g = float(np.median(gaps[gaps > 0])) if np.any(gaps > 0) else 365.0
    per = 365.25 / max(1.0, g)
    return min((1, 2, 4, 12, 52), key=lambda f: abs(math.log(per / f)))


def dist_profile(D, key, s):
    """분배 습관: 연 분배율 y · 연 횟수 f · 분배 달 m · 보통 날짜 dom · 과세 비율 tx (국내: data/etfdist 묶음 · 미국: 야후 분배 내역)
    최근 2년(없으면 전체)의 회당 분배율(분배금 ÷ 분배락 전날 종가) 평균 × 연 횟수"""
    E2 = lambda x: (EPOCH + datetime.timedelta(int(x)))
    if key.startswith('K:'):
        code = key[2:]
        sh = sum(ord(c) for c in code) % 8
        try:
            e = json.load(open(os.path.join(ROOT, 'data', 'etfdist', '%d.json' % sh), encoding='utf-8'))['e'].get(code)
        except Exception:
            e = None
        ev = [((datetime.date(r[0] // 10000, r[0] // 100 % 100, r[0] % 100) - EPOCH).days, r[1], r[2], r[3]) for r in ((e or {}).get('r') or []) if r[1] and r[3]]
        if not ev:
            return None
        last = ev[-1][0]
        recent = [x for x in ev if x[0] > last - 731] or ev
        f = _freq([x[0] for x in recent])
        yld = float(np.mean([a / p for _, a, _, p in recent])) * f
        tb = [(a, t) for _, a, t, _ in ev if t is not None]
        tax = (sum(t for a, t in tb) / sum(a for a, t in tb)) if tb and sum(a for a, t in tb) > 0 else 1.0
    else:
        vd, va = s.get('v_d'), s.get('v_a')
        if vd is None or not len(vd):
            return None
        last = int(vd[-1])
        ev = [(int(x), float(a)) for x, a in zip(vd, va) if x > last - 731] or [(int(vd[-1]), float(va[-1]))]
        f = _freq([x for x, _ in ev])
        c, d = s['c'], s['d']
        ys = []
        for x, amt in ev:
            i = int(np.searchsorted(d, x)) - 1
            if 0 <= i < len(c) and c[i] > 0:
                ys.append(amt / c[i])
        if not ys:
            return None
        yld = float(np.mean(ys)) * f
        recent = [(x, a, None, None) for x, a in ev]
        tax = 1.0
    months = list(range(1, 13)) if f >= 12 else sorted({E2(x[0]).month for x in recent})
    dom = int(np.median([E2(x[0]).day for x in recent]))
    return {'y': round(yld, 5), 'f': int(min(f, 12)), 'm': months, 'dom': dom, 'tx': round(min(1.0, max(0.0, tax)), 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.btcache'))
    ap.add_argument('--only')
    ap.add_argument('--explain', action='store_true')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--dump', help='--only 실행 결과 식을 이 파일(JSON)로')
    ap.add_argument('--force', action='store_true', help='식이 크게 줄어도 씀')
    a = ap.parse_args()
    t0 = time.time()
    D = Data(a.cache)
    E = Engine(D)
    log = lambda *x: print(*x, flush=True)
    uni = D.uni
    # 대상: 국내·미국 ETF (상장 순서대로 — 체인으로 늘어난 '더 먼 과거' 시작일을 앞서 고른 식에서 씀)
    targets = [k for k, v in uni.items() if (v.get('kind') == 'etf' or k.startswith('D:')) and v.get('n', 0) > 1 and not v.get('err') and k not in KRX_AUX]
    # D: 한국거래소 옵션 전략 지수도 대상 — 지수 기준일 전을 같은 방법(코스피 200 + 콜 매도 등)으로 재현해 두면, 그 지수를 쓰는 ETF 백테스트가 체인으로 더 먼 과거까지
    if a.only:
        targets = a.only.split(',')
    targets.sort(key=lambda k: ((uni.get(k) or {}).get('start') or 0, k))
    cands = sorted(k for k, v in uni.items() if v.get('n', 0) > 30 and not v.get('err') and k not in EXCLUDE and k not in KRX_AUX) + sorted(k for k in SYN if k not in SYN_NOCAND) + ['F:USDKRW', 'X:SPXTR'] \
        + sorted(z for z in ZSIM if D.series(z) is not None)     # 모의 커버드콜 (코스피 200·VKOSPI 가 있을 때)
    log('대상 %d · 후보 %d' % (len(targets), len(cands)))
    LEV_PREV.update(k for k, r in load_recipes(a.out).items() if isinstance(r, dict) and r.get('cr'))
    if D.series(LEV_RATE) is None:                   # GitHub Actions 화면에 경고로 — 레버리지·인버스 식이 예전 단기국채 금리로 맞춰짐
        log('::warning::연방기금 금리(FRED DFF) 자료가 없어 레버리지·인버스 미국 ETF 식을 단기국채 금리로 맞춤 (scripts/etf_bt_data.py FRED 받기 확인)')
    elif 'US' in E.cal and int(D.series(LEV_RATE)['d'][-1]) < int(E.cal['US'][-1]) - 10:   # FRED 받기가 여러 번 실패 — 마지막 날 뒤는 현금 수익 0 으로 맞춰짐
        log('::warning::연방기금 금리(FRED DFF) 마지막 날 %s 이 미국 마지막 거래일 %s 보다 10일 넘게 앞섬 (FRED 받기 확인)' % (ymd(int(D.series(LEV_RATE)['d'][-1])), ymd(int(E.cal['US'][-1]))))
    # 안전장치: 지난 식이 쓰던 옵션 전략 지수(C: Cboe · D: 한국거래소 — 화면이 r/<키>.json 으로 받는 것)의 절반 넘게 이번 자료에 없으면
    #   (받기 막힘 + 캐시 없음) 계산하지 않고 멈춤 — 식·r/*.json 이 지난 것 그대로 남아 화면은 계속 맞고, 다음 실행이 다시 받음
    #   (지수 몇 개만 없어진 경우는 그 지수 없이 다시 고름 · 출처마다 따로 셈 · --force 로 무시)
    if not a.only and not a.force:
        old_r = load_recipes(a.out)
        for pre, nm_ in (('C:', 'Cboe'), ('D:', '한국거래소'), ('Z:', '모의 커버드콜(한국거래소 코스피 200·VKOSPI)')):
            used_c, miss = hosted_missing(old_r, D, pre)
            if len(used_c) >= 3 and len(miss) * 2 > len(used_c):
                raise SystemExit('지난 식이 쓰던 %s 옵션 전략 지수 %d개 중 %d개가 이번 자료에 없어 멈춤 (받기 실패 의심 · --force 로 무시): %s'
                                 % (nm_, len(used_c), len(miss), ' '.join(miss[:10])))

    # 달력별 '그날 알 수 있는 값' 기준 후보 초과수익 행렬 (상관으로 후보를 좁힐 때) — float32 · 첫날 전은 NaN
    mats = {}
    for cal_name, tcur in (('KR', 'KRW'), ('US', 'USD')):
        if not any(is_kr(k) == (cal_name == 'KR') for k in targets):
            continue
        cols, keys, starts, ends = [], [], [], []
        for k in cands:
            if k == 'F:USDKRW' and cal_name == 'US':
                continue
            info = D.info(k)
            fmk = info.get('mk') or 'US'
            var = 'u' if (info.get('cur') or 'USD') != tcur else 'n'
            col = E.column(k, cal_name, tcur, E.known_lag(fmk, cal_name), var)
            if col is None:
                continue
            ok = np.where(~np.isnan(col))[0]
            if not len(ok):
                continue
            s_ = D.series(k)
            cols.append(col.astype(np.float32)); keys.append(k)
            starts.append(int(ok[0]))
            ends.append(int(np.searchsorted(E.cal[cal_name], s_['d'][-1], side='right')) - 1)
        M = np.ascontiguousarray(np.vstack(cols).T)          # 날짜 × 후보
        mats[cal_name] = {'M': M, 'keys': keys, 'starts': np.array(starts), 'ends': np.array(ends), 'kidx': {k: i for i, k in enumerate(keys)}}
        log('%s 달력 %d일 × 후보 %d (%.0fs)' % (cal_name, M.shape[0], M.shape[1], time.time() - t0))
        del cols

    recipes, stats = {}, {}
    for ti, tk in enumerate(targets):
        try:
            r = fit_target(D, E, mats, tk, recipes, a.explain, log)
        except Exception as e:
            import traceback
            log('실패', tk, repr(e)[:200]); traceback.print_exc()
            r = None
        if r is None:
            stats['none'] = stats.get('none', 0) + 1
        else:
            r['st'] = max(chain_start(recipes, D, tk, r, 0), first_possible(D, E, r))
            r['ec'] = chain_err(recipes, D, tk, r, 0)
            r['xc'] = x_err(r['ec'])
            recipes[tk] = r
            kk = r['k'] + ('-short' if r.get('short') else '')
            stats[kk] = stats.get(kk, 0) + 1
        if (ti + 1) % 250 == 0:
            log('%d/%d %s (%.0fs)' % (ti + 1, len(targets), stats, time.time() - t0))
    if a.dump:
        json.dump(recipes, open(a.dump, 'w', encoding='utf-8'), ensure_ascii=False)
    write_out(a.out, recipes, D, a.only, a.force)
    log('끝 %s · %.0fs' % (stats, time.time() - t0))


def chain_start(recipes, D, tk, r, depth):
    """백테스트 시작일: 식의 후보가 모두 시작하는 날 (후보 ETF 가 자기 백테스트를 가지면 그 시작일까지 — 최대 3단, 화면 btGet 과 같음)"""
    st = []
    for f in r['m']:
        k = f[0]
        s0 = D.info(k).get('start')
        if s0 is None:
            return int(r['s'])
        if depth < 3 and k in recipes and k != tk and chainable(recipes[k]):
            s0 = min(s0, chain_start(recipes, D, k, recipes[k], depth + 1))
        st.append(s0)
    return int(max(st)) if st else int(r['s'])


def chainable(rk):
    """후보 ETF 의 백테스트를 이어 붙여도 되나 — 연 오차(이어 붙인 앞 구간 포함)가 CHAIN_EC 이하 (화면 btGet 과 같음)"""
    return rk.get('ec') is not None and rk['ec'] <= CHAIN_EC


def first_possible(D, E, r):
    """달력·환율 자료가 허락하는 가장 이른 날 (국내 달력 1990 · 미국 1980 · 원화 환산이 들면 원/달러 15:30 종가 1990-03)"""
    cal = E.cal['KR' if r['c'] == 'KRW' else 'US']
    st = int(cal[0])
    if any(t[3] == 'u' and (t[4] == 'KRW' or r['c'] == 'KRW') and t[4] != r['c'] and len(t) < 7 for t in r['m']):
        st = max(st, int(E.usdkrw['d'][0]))
    return st


def chain_err(recipes, D, tk, r, depth):
    """이어 붙인 구간까지 포함한 연 오차 상한: √(이 식 오차² + 이어 쓴 후보 백테스트 오차²의 최댓값)"""
    if not r.get('e'):
        return None
    own = r['e'][2]
    worst = 0.0
    for f in r['m']:
        k = f[0]
        if depth < 3 and k in recipes and k != tk and chainable(recipes[k]) and (D.info(k).get('start') or 0) > r['st']:
            sub = chain_err(recipes, D, k, recipes[k], depth + 1)
            if sub is None:
                return None
            worst = max(worst, sub)
    return round(math.sqrt(own * own + worst * worst), 5)


def eff_start(recipes, D, k, raw):
    """후보 k 가 재현할 수 있는 가장 먼 날 (자기 백테스트가 있고 그 오차(이어 붙인 구간 포함)가 연 5% 이하면 그 시작일)"""
    r = recipes.get(k)
    if r and r.get('st') is not None and chainable(r):
        return min(raw, r['st'])
    return raw


CBOE_OFF = False        # 시험용: Cboe 옵션 전략 지수를 후보에서 뺌
KRX_OFF = False         # 시험용: 한국거래소 옵션 전략 지수를 후보에서 뺌
OPT_BUF_US = re.compile(r'buffer|defined outcome|\bfloor\b|accelerat|barrier|\bcollar|put ?-?write|buy ?-?write|hedged equity|premium|option|'
                        r'covered call|target income|enhanced growth|yieldmax|income strateg|high income|enhanced (?:dividend )?income|weeklypay', re.I)
OPT_BUF_KR = re.compile(r'버퍼|커버드콜|프리미엄|옵션|콜매도|풋|인컴|타겟|위클리')


def keys_of(mt):
    return mt['keys']


def wants_cboe(D, tk):
    """커버드콜·버퍼(만기 결과 정의)·옵션 인컴 ETF 인가 — 옵션 전략 지수(C:·D:)를 모두 후보로 시험할지 (이름으로) · D: 옵션 지수 자체는 늘 그렇다"""
    if tk.startswith('D:'):
        return True
    if is_option_etf(D, tk):
        return True
    if tk.startswith('K:'):
        return bool(OPT_BUF_KR.search(D.meta(tk).get('itemName') or ''))
    return bool(OPT_BUF_US.search((D.info(tk).get('name') or '') + ' ' + (D.meta(tk).get('name') or '')))


OPT_KR = re.compile(r'커버드콜|콜매도|프리미엄|위클리|데일리옵션|인컴')
OPT_US = re.compile(r'covered call|buy-?write|option income|premium income|equity premium|option strateg|income strateg|enhanced income|yieldmax|buywrite|option overlay', re.I)


def is_option_etf(D, tk):
    """콜 매도(커버드콜) 전략 ETF 인가 — 이름으로 (국내 네이버 · 미국 야후 · D: 한국거래소 옵션 지수는 콜을 파는 지수(커버드콜·콜매도·양매도))"""
    if tk.startswith('D:'):
        nm = D.info(tk).get('name') or ''
        return '콜' in nm or '양매도' in nm
    if tk.startswith('K:'):
        nm = D.meta(tk).get('itemName') or ''
        bi = D.meta(tk).get('etfBaseIndex') or ''
        return bool(OPT_KR.search(nm) and ('콜' in nm + bi or '프리미엄' in nm + bi or 'Covered' in bi or 'Premium' in bi))
    nm = (D.info(tk).get('name') or '') + ' ' + (D.meta(tk).get('name') or '')
    return bool(OPT_US.search(nm))


# 콜 매도 ETF 의 기초자산 (이름·기초지수 글자 → 후보 키) — 앞에서부터 처음 맞는 것
OPT_UNDER = [(r'코스피\s?200|KOSPI\s?200', ['K:069500', 'N:KPI200']), (r'코스닥\s?150|KOSDAQ\s?150', ['K:229200']), (r'코스피|KOSPI', ['N:KOSPI']),
             (r'나스닥\s?-?100|Nasdaq[- ]?100|NASDAQ[- ]?100', ['Y:^NDX', 'U:QQQ']), (r'S&P\s?500', ['X:SPXTR', 'U:SPY']),
             (r'Russell 2000|러셀\s?2000', ['U:IWM']), (r'다우존스 30|Dow Jones Industrial|\bDow\b', ['U:DIA']),
             (r'배당다우존스|Dividend 100', ['U:SCHD']), (r'미국\s?30년|20\+ Year|20년\+|TLT', ['U:TLT']), (r'테슬라', ['U:TSLA']), (r'엔비디아', ['U:NVDA']),
             (r'(?<![A-Za-z])금(?!융)|Gold', ['U:GLD']), (r'Bitcoin|비트코인', ['Y:BTC-USD'])]


def option_underlyings(D, tk):
    """콜 매도 ETF 의 기초자산 후보 키 — 이름·기초지수에 지수·종목이 보이면 그것, 미국 단일 종목 인컴 ETF(YieldMax 등)는 이름 속 티커"""
    if tk.startswith('K:'):
        m = D.meta(tk)
        txt = (m.get('itemName') or '') + ' ' + (m.get('etfBaseIndex') or '')
    elif tk.startswith('D:'):
        txt = D.info(tk).get('name') or ''
    else:
        txt = (D.info(tk).get('name') or '') + ' ' + (D.meta(tk).get('name') or '')
    for pat, ks in OPT_UNDER:
        if re.search(pat, txt):
            return ks
    if tk.startswith('U:'):
        for tok in re.findall(r'\b([A-Z]{2,5})\b', txt):
            k = 'U:' + tok
            if tok not in ('ETF', 'YIELDMAX', 'NEOS', 'USD') and (D.uni.get(k) or {}).get('kind') in ('stk', 'etf') and k != tk:
                return [k]
    return []


CC_GRID = {'D': (0.0, 0.0025, 0.005, 0.01), 'W': (0.0, 0.005, 0.01, 0.02, 0.03), 'M': (0.0, 0.01, 0.02, 0.03, 0.05)}
CC_L = (0.8, 1.0, 1.25)


def fresh_end(cal, dl, lag, us_cal):
    """달력 cal 위에서 마지막 값의 날(dl)까지 '다 나온' 마지막 날 번호
    · 시차 0(같은 시장): dl 이하 마지막 날 · 시차 1(국내 대상의 미국 값 — 그날 값 = 그 전 미국 거래일 종가): dl 다음 미국 거래일 이하 마지막 날
      (미국 달력이 dl 에서 끝나면 아직 다음 미국 거래일이 없어 끝까지)"""
    if lag == 0:
        return int(np.searchsorted(cal, dl, side='right')) - 1
    i = int(np.searchsorted(us_cal, dl, side='right'))
    return len(cal) - 1 if i >= len(us_cal) else int(np.searchsorted(cal, int(us_cal[i]), side='right')) - 1


def fit_target(D, E, mats, tk, recipes, explain, log):
    cal_name, tcur = ('KR', 'KRW') if is_kr(tk) else ('US', 'USD')
    mt = mats.get(cal_name)
    s = D.series(tk)
    if s is None or mt is None or len(s['d']) < 3:
        return None
    cal = E.cal[cal_name]
    first = int(np.searchsorted(cal, s['d'][0]))
    last = int(np.searchsorted(cal, s['d'][-1], side='right')) - 1
    if first >= len(cal) or last <= first + 1:
        return None
    y = rets(align_level(s, cal, 0))
    lo, hi = first + 1, last + 1                            # 상장 다음 거래일 ~ 마지막 거래일
    if np.isnan(y[lo:hi]).any():
        return None
    n_all = hi - lo
    prof = dist_profile(D, tk, s)
    base = {'s': int(s['d'][0]), 'c': tcur, 'n': n_all}
    if prof:
        base['dv'] = prof
    short = n_all < MIN_DAYS
    if short:
        if tk.startswith('K:'):
            r = short_recipe(D, tk, base)
            if r is not None or n_all < MIN_SHORT:
                return r
        elif n_all < MIN_SHORT:
            return None
    M, keys, starts, ends = mt['M'], mt['keys'], mt['starts'], mt['ends']
    # 후보 자격: 상장 15거래일 전부터 자료가 있고(과거를 늘릴 수 있어야) 지금까지 이어짐
    elig = (starts < first - 15) & (ends >= last - 5)
    cidx, didx = mt.get('cidx'), mt.get('didx')
    if cidx is None:                                    # 옵션 전략 지수 열 번호 (한 번만) — C: Cboe · D: 한국거래소
        cidx = mt['cidx'] = np.array([i for i, k in enumerate(keys_of(mt)) if k.startswith('C:')], np.int64)
        didx = mt['didx'] = np.array([i for i, k in enumerate(keys_of(mt)) if k[:2] in ('D:', 'Z:')], np.int64)   # 한국거래소 옵션 지수 · 모의 커버드콜
    opt_all = wants_cboe(D, tk)
    cboe_all = (not CBOE_OFF) and opt_all and not tk.startswith('D:')        # 국내 지수(D:)를 재현할 때는 미국 Cboe 지수를 쓰지 않음
    krx_all = (not KRX_OFF) and opt_all and is_kr(tk)                         # 한국거래소 옵션 지수는 국내 상장 옵션 ETF·지수에만
    if not cboe_all and len(cidx):                       # 옵션 전략 지수는 커버드콜·버퍼·옵션 인컴 ETF 에만 (옵션을 쓰지 않는 ETF 에는 우연히 맞는 후보일 뿐 — 시험으로 확인)
        elig[cidx] = False
    if not krx_all and len(didx):
        elig[didx] = False
    ti_ = mt['kidx'].get(tk)
    if ti_ is not None:
        elig[ti_] = False
    if not elig.any():
        return None
    # 맞추는 구간의 끝 = 옵션 전략 지수 후보(C: Cboe · D: 한국거래소 · Z: 그 재료로 만든 모의)가 모두 값을 낸 마지막 날
    #   한국거래소 옵션 지수는 저녁에 나와(네이버 ETF 일봉은 15:40 뒤 확정), 그 사이에 받으면 지수의 오늘이 없음 → 맞출 때 '변화 0'으로 이어 써져
    #   그날 ETF 의 실제 오르내림이 통째로 오차로 잡힘 → 상장이 짧은 ETF 는 교차 검증에서 지수 식이 밀려남(2026-10-12 18:19 KST 실행: 498400 ±2.5 → ±5.6)
    #   · 시차 1 후보(국내 대상의 미국 지수 — 그날 값 = 그 전 미국 거래일 종가)는 마지막 값의 다음 미국 거래일과 같은 날까지가 '다 나온' 날
    if np.any(elig[cidx]) or np.any(elig[didx]):
        cut = min(fresh_end(cal, int(D.series(keys[j])['d'][-1]), E.known_lag(D.info(keys[j]).get('mk') or 'US', cal_name), E.cal['US'])
                  for j in np.concatenate([cidx, didx]) if elig[j]) + 1
        if cut < hi:
            hi = max(cut, lo + 2)
            n_all = hi - lo
            base['n'] = n_all
    hold = holdings(D, tk)
    single = single_stock_keys(D.meta(tk).get('itemName') if tk.startswith('K:') else D.info(tk).get('name'), kr=is_kr(tk))
    kstart = lambda k: eff_start(recipes, D, k, int(cal[starts[mt['kidx'][k]]])) if k in mt['kidx'] else 0
    asy = {}
    optT, pcache = is_option_etf(D, tk), {}
    pri = lambda keys_, zs=None: prior_of(D, tk, keys_, zs, optT, pcache)     # 교차 검증에서 d 를 당길 사전값 (최종 식과 같게)

    def col(key, lag, var, a0):
        c = E.column(key, cal_name, tcur, lag, var)
        if c is None:
            return None
        c = c[a0:hi]
        if np.isnan(c).any():
            return None
        return c

    def variants_of(keys_, a0):
        out = []
        for key in keys_:
            fi = D.info(key)
            fmk, fcur = fi.get('mk') or 'US', fi.get('cur') or 'USD'
            asy[key] = not same_market(fmk, cal_name)
            for v in (['n'] if fcur == tcur else ['u', 'h']):
                for lg in lags_for(fmk, cal_name):
                    c = col(key, lg, v, a0)
                    if c is not None:
                        out.append(((key, lg, v), c))
        return out

    def wcorr(vec, a0):
        """5거래일 합 기준 상관 (대상 구간 a0~hi) — vec: 그 구간 일 수익"""
        n = hi - a0
        nb = n // 5
        X5 = M[hi - nb * 5:hi].reshape(nb, 5, M.shape[1]).sum(1, dtype=np.float64)
        ye = vec[n - nb * 5:].reshape(nb, 5).sum(1)
        yc = ye - ye.mean()
        num = yc @ X5
        sx = X5.sum(0)
        var = np.einsum('ij,ij->j', X5, X5) - sx * sx / nb
        return num / np.sqrt(np.maximum(var, 1e-30) * max(1e-30, float((yc * yc).sum())))

    def select(a0, use_opt=True):
        """구간 a0~hi 로 식 고르기 → (sel, score, method, bask_w, folds, cash_score, corr, order) · use_opt=False: 옵션 전략 지수(C:·D:) 후보 없이"""
        yt = y[a0:hi]; n = len(yt)
        cash = E.cash_ret(tcur, cal_name)[a0:hi]
        good = ~bad_days(yt)
        corr = wcorr(np.where(good, yt - cash, 0.0), a0)
        el = elig & ~np.isnan(corr)
        if not use_opt:
            for ix in (cidx, didx):
                if len(ix):
                    el[ix] = False
        idx = np.where(el)[0]
        if not len(idx):
            return None
        order = idx[np.argsort(-np.abs(corr[idx]))[:TOPK]]
        pool = [keys[i] for i in order]
        # 상관이 맨 위와 거의 같은(0.01 안) 후보 중 자료가 가장 오래된 10개도 — 같은 지수를 따르는 ETF 가 많아 지수·오래된 ETF 가 30위 밖으로 밀리지 않게
        top = float(np.max(np.abs(corr[idx])))
        nearc = idx[np.abs(corr[idx]) >= top - 0.01]
        for i in nearc[np.argsort(starts[nearc])][:10]:
            if keys[i] not in pool:
                pool.append(keys[i])
        for hk, w in hold:
            j = mt['kidx'].get(hk)
            if j is not None and el[j] and hk not in pool:
                pool.append(hk)
        for hk in single:                               # 단일 종목 ETF 의 기초 종목(이름에서)
            j = mt['kidx'].get(hk)
            if j is not None and el[j] and hk not in pool:
                pool.append(hk)
        for on, ix in ((cboe_all, cidx), (krx_all, didx)):   # 커버드콜·버퍼·옵션 인컴 ETF: 옵션 전략 지수를 모두 시험 (상관 상위 밖이어도)
            if on and use_opt:
                for j in ix:
                    if el[j] and keys[j] not in pool:
                        pool.append(keys[j])
        folds = make_folds(n, 3 if n >= 180 else 2)
        variants = variants_of(pool, a0)
        # 잔차로 더 찾을 후보는 지수·ETF·금리·환율(넓은 요인)과 보유 종목만 — 수많은 개별 종목 중 우연히 맞는 것을 막음
        hk_ = {k for k, _ in hold}
        broad = np.array([(D.info(k).get('kind') != 'stk') or (k in hk_) or (k in single) for k in keys])
        cur_sel, cur_score = [], evaluate(yt, cash, np.zeros((n, 0)), folds, good, pri([]))
        cash_score = cur_score
        step_keys = None
        top1 = []
        # 상장 후 자료가 짧으면 항을 적게(우연히 맞는 항 방지): 120거래일 미만 1개 · 250 미만 2개 · 그 이상 3개
        n_terms = 1 if short or n < 120 else 2 if n < 250 else MAX_TERMS
        for step in range(n_terms):
            if step_keys is None:
                cands_ = variants
            else:
                # 2번째 항부터: 첫 단계 상위 후보 + 지금 식의 잔차와 상관이 큰 후보(바스켓·전략 차이를 메울 후보)
                Xs = np.column_stack([c for _, c in cur_sel])
                w_ = est_w(yt - cash, Xs, good)
                res = np.where(good, (yt - cash) - Xs @ w_, 0.0)
                rc = wcorr(res, a0)
                ri = np.where(el & broad & ~np.isnan(rc))[0]
                extra = [keys[i] for i in ri[np.argsort(-np.abs(rc[ri]))[:RES_K]] if keys[i] not in step_keys]
                have = {vk[0] for vk, _ in variants}
                new_v = variants_of([k for k in extra if k not in have], a0)
                variants = variants + new_v
                ks = set(step_keys) | set(extra)
                cands_ = [v for v in variants if v[0][0] in ks]
            scored, corr_of = [], {}
            for vk, c in cands_:
                if any(vk[0] == s0[0][0] for s0 in cur_sel):
                    continue                              # 같은 후보를 두 번(환헤지·환노출 · 두 시차) 쓰지 않음
                with np.errstate(invalid='ignore', divide='ignore'):     # 변동이 없는 열은 상관 NaN → 걸러지지 않음
                    cors = [float(np.corrcoef(c, c2)[0, 1]) for _, c2 in cur_sel]
                if any(abs(x) > 0.97 for x in cors):
                    continue                              # 이미 고른 항과 거의 같은 움직임(같은 지수 ETF·인버스 등) → 배수만 크게 엇갈려 불안정
                corr_of[vk] = cors
                X2 = np.column_stack([c2 for _, c2 in cur_sel] + [c])
                scored.append((evaluate(yt, cash, X2, folds, good, pri([s0[0][0] for s0 in cur_sel] + [vk[0]])), (vk, c)))
            if not scored:
                break
            if step_keys is None:                         # 다음 단계: 첫 단계 점수 상위 12개 후보 (+ 잔차 상관 후보)
                top1 = [z[1] for z in sorted(scored, key=lambda z: z[0][0])[:5]]
                step_keys = []
                for sc_, (vk, _) in sorted(scored, key=lambda z: z[0][0]):
                    if vk[0] not in step_keys:
                        step_keys.append(vk[0])
                    if len(step_keys) >= 12:
                        break
                step_keys0 = set(step_keys)
                first_step = True
            else:
                first_step = False
            # 더할 수 있는 항: 오차가 8%·0.1%p 이상(잔차로 찾은 후보는 15%·0.2%p) 줄고, 모든 폴드에서 나빠지지 않고(5% 안), 배수가 사실상 0 이 아님
            def ok_(z):
                sc_, (vk, _) = z
                strict = not first_step and (vk[0] not in step_keys0 or n < 250)   # 잔차로 찾은 후보 · 짧은 자료는 더 엄격히
                rel, ab = (RES_REL, RES_ABS) if strict else (ACC_REL, ACC_ABS)
                if not (sc_[0] <= cur_score[0] * rel and cur_score[0] - sc_[0] >= ab):
                    return False
                if cur_sel and any(p1 > p0 * 1.05 + 1e-4 for p1, p0 in zip(sc_[3], cur_score[3])):
                    return False
                if any(np.any(np.abs(w_) > W_MAX) for w_ in sc_[4]):
                    return False
                cors, ks = corr_of.get(vk) or [], [s0[0][0] for s0 in cur_sel] + [vk[0]]
                for w_ in sc_[4]:
                    # 움직임이 거의 같은(|상관| 0.9 넘는) 두 항을 서로 상쇄하는 방향으로 → 둘의 작은 차이로 잡음을 맞춘 것(과적합)
                    if any(abs(cj) > OFFSET_CORR and cj * w_[j] * w_[-1] < 0 for j, cj in enumerate(cors)):
                        return False
                    # 옵션 전략 지수(C:·D:)는 전략 그대로(0.2~1.6배)만 — 음수·큰 배수는 다른 기초자산을 흉내 낸 우연한 맞춤
                    if any(opt_idx(kk) and not (CBOE_WMIN <= w_[j] <= CBOE_WMAX) for j, kk in enumerate(ks)):
                        return False
                return all(abs(w_[-1]) >= MIN_W for w_ in sc_[4])
            okz = [z for z in scored if ok_(z)]
            if not okz:
                break
            best = min(z[0][0] for z in okz)
            # 오차가 가장 작은 것과 거의 같으면 더 먼 과거까지 재현되는 후보 (체인 포함 시작일) — 1년 넘게 더 먼 과거일 때만 (몇 달 차이로 덜 맞는 후보를 고르지 않게)
            near = [z for z in okz if z[0][0] <= best * (1 + NEAR_REL) + NEAR_ABS]
            sel_start = max([kstart(s0[0][0]) for s0 in cur_sel] or [-10 ** 9])
            zbest = min(okz, key=lambda z: z[0][0])
            s_best = max(sel_start, kstart(zbest[1][0][0]))
            far = [z for z in near if max(sel_start, kstart(z[1][0][0])) <= s_best - NEAR_GAIN]
            pick = min(far, key=lambda z: (max(sel_start, kstart(z[1][0][0])), z[0][0])) if far else zbest
            if os.environ.get('BT_DEBUG'):
                print('  step', step, 'cur %.4f' % cur_score[0], 'best %.4f' % best, 'near', [(z[1][0][0], z[1][0][1], z[1][0][2], round(z[0][0], 4), ymd(kstart(z[1][0][0]))) for z in sorted(near, key=lambda z: z[0][0])[:12]],
                      '→', pick[1][0], flush=True)
            cur_sel = cur_sel + [pick[1]]
            cur_score = pick[0]
        method, sel, score, bw = 'fit', cur_sel, cur_score, None
        bask = None if short else basket_model(D, E, hold, cal_name, tcur, mt, el, yt, cash, folds, lambda k_, lg, v: col(k_, lg, v, a0), good, pri)
        if bask is not None and bask[1][0] < score[0] * (1 - NEAR_REL) - NEAR_ABS:   # 바스켓은 체인이 없어 과거가 짧은 편 → 분명히 나을 때만
            sel, score, method, bw = bask[0], bask[1], 'basket', bask[2]
        return {'sel': sel, 'score': score, 'method': method, 'bw': bw, 'folds': folds, 'cash': cash_score, 'corr': corr, 'order': order,
                'bask': bask, 'yt': yt, 'cashr': cash, 'good': good, 'top': top1, 'a0': a0}

    def overlay(R, a0):
        """콜 매도 덧씌우기: 기초자산(이름·기초지수가 가리키는 지수·종목, 없으면 콜 매도가 없는 상위 후보 — 노출이 양수)에 만기 주기·행사가·변동성 배수를
        바꿔 가며 z 열을 더해 교차 검증 → 지금 식보다 오차가 작으면 바꿈 · 오차가 거의 같으면 더 먼 과거까지 재현되는 기초자산"""
        if not R or not R['sel'] or R['method'] != 'fit':
            return R
        yt, cash, good, folds = R['yt'], R['cashr'], R['good'], R['folds']
        base_sc = R['score']
        unders, seen_k = [], set()
        mapped = [k for k in option_underlyings(D, tk) if k in mt['kidx'] and elig[mt['kidx'][k]]]
        if mapped:                                     # 이름·기초지수가 가리키는 기초자산이 있으면 그것만 (통계로만 맞는 엉뚱한 기초자산 방지)
            for k in mapped:
                fi = D.info(k)
                fmk, fcur = fi.get('mk') or 'US', fi.get('cur') or 'USD'
                nm_ = (D.meta(tk).get('itemName') or '') if tk.startswith('K:') else ''
                v = 'n' if fcur == tcur else ('h' if '(H)' in nm_ else 'u')
                c = col(k, Engine.known_lag(fmk, cal_name), v, a0)
                if c is not None:
                    unders.append(((k, Engine.known_lag(fmk, cal_name), v), c))
        for vk, c in ([] if unders else R['sel'][:1] + R.get('top', [])):
            key = vk[0]
            if key in seen_k or len(vk) > 3 or opt_idx(key) or (key[:2] in ('K:', 'U:') and is_option_etf(D, key)):
                continue                                   # 이미 옵션 전략이 든 후보(콜 매도 ETF · 옵션 전략 지수)에는 덧씌우지 않음
            seen_k.add(key)
            w1 = est_w(yt - cash, c[:, None], good)
            if w1[0] > 0.2:
                unders.append((vk, c))
            if len(unders) >= 4:
                break
        res = []
        for vk, c in unders:
            key, lg, var = vk
            lv = E.level(key, cal_name, lg)
            if lv is None:
                continue
            rf = rets(lv)
            bestk = None
            for P in ('D', 'W', 'M'):
                fl = expiry_flags(cal, P, cal_name)
                for kk in CC_GRID[P]:
                    for ll in CC_L:
                        z = cc_col(rf, cal, fl, kk, ll)[a0:hi]
                        if np.isnan(z).any() or not np.any(z):
                            continue
                        sel2 = [(vk, c), ((key, lg, var, (P, kk, ll)), z)]
                        sc2 = evaluate(yt, cash, np.column_stack([c, z]), folds, good, pri([key, key], [False, True]))
                        if bestk is None or sc2[0] < bestk[0][0]:
                            bestk = (sc2, sel2)
            if bestk is not None:
                res.append(bestk)
        if os.environ.get('BT_DEBUG'):
            print('  overlay base %.4f' % base_sc[0], [(b[1][1][0][0], b[1][1][0][3], round(b[0][0], 4), [np.round(w_, 2).tolist() for w_ in b[0][4]]) for b in res], flush=True)
        # 콜 매도 ETF 라는 것을 이미 알므로(이름) 오차가 줄기만 하면 덧씌움 — 노출 > 0.2 · 커버(z 배수) > 0 (모든 폴드)
        ok = [z for z in res if z[0][0] < base_sc[0] and all(0.2 < w_[0] <= W_MAX and 0 < w_[1] <= WZ_MAX for w_ in z[0][4])]
        if not ok:
            return R
        best = min(z[0][0] for z in ok)
        near = [z for z in ok if z[0][0] <= best * (1 + NEAR_REL) + NEAR_ABS]
        zb = min(ok, key=lambda z: z[0][0])                # 식 고르기와 같게: 1년 넘게 더 먼 과거까지 될 때만 덜 맞는 기초자산
        far = [z for z in near if kstart(z[1][0][0][0]) <= kstart(zb[1][0][0][0]) - NEAR_GAIN]
        sc2, sel2 = min(far, key=lambda z: (kstart(z[1][0][0][0]), z[0][0])) if far else zb
        # 지금 식이 옵션 전략 지수(C:·D: — 전략 그 자체)로 시작하고, 덧씌운 식과 오차가 거의 같으며 1년 넘게 더 먼 과거까지 되면 지수 식 그대로
        # (덧씌우기는 전략을 흉내 낸 근사 · 지수가 아닌 식에까지 넓히면 이어 붙인 앞 구간 오차가 커져 체인이 끊기는 경우가 생겨 지수일 때만 — 시험으로 확인)
        if opt_idx(R['sel'][0][0][0]) and base_sc[0] <= sc2[0] * (1 + NEAR_REL) + NEAR_ABS \
                and max(kstart(s0[0][0]) for s0 in R['sel']) <= kstart(sel2[0][0][0]) - NEAR_GAIN:
            return R
        R = dict(R); R['sel'] = sel2; R['score'] = sc2; R['cc'] = 1
        return R

    opt = is_option_etf(D, tk) and not short

    def r_start(R_):
        """고른 식이 재현할 수 있는 가장 먼 날 (체인 포함) — 식이 없으면 아주 늦은 날"""
        return max([kstart(s0[0][0]) for s0 in R_['sel']] or [10 ** 9]) if R_ and R_['sel'] else 10 ** 9

    def best_select(a0):
        """옵션 전략 지수(C:·D:)를 넣은 고르기와 뺀 고르기 중 교차 검증 오차가 작은 쪽 (거의 같으면 1년 넘게 더 먼 과거까지 되는 쪽)
        — 항을 앞에서부터 하나씩 고르는 방식이라, 강한 후보(지수) 하나가 첫 항을 차지하면 최종 식이 오히려 나빠질 수 있어서 (넣어서 나빠지지 않게)"""
        Ra = select(a0)
        if Ra is not None and opt:
            Ra = overlay(Ra, a0)
        if not (cboe_all or krx_all):
            return Ra
        Rb = select(a0, use_opt=False)
        if Rb is not None and opt:
            Rb = overlay(Rb, a0)
        if Ra is None or not Ra['sel']:
            return Rb if Rb is not None and Rb['sel'] else Ra
        if Rb is None or not Rb['sel']:
            return Ra
        sa, sb = Ra['score'][0], Rb['score'][0]
        lo_, hi_ = (Ra, Rb) if sa <= sb else (Rb, Ra)
        if max(sa, sb) <= min(sa, sb) * (1 + NEAR_REL) + NEAR_ABS and r_start(hi_) <= r_start(lo_) - NEAR_GAIN:
            return hi_
        return lo_

    R = best_select(lo)
    if R is None:
        return None
    # 운용 방식이 바뀌었으면(레버리지·기초지수 교체) 바뀐 뒤 구간으로 다시 — 백테스트는 '지금의 상품' 기준
    #   콜 매도 ETF 는 오르내림에 따라 노출이 달라 보여 빼고, D: 한국거래소 옵션 지수도 뺌 (규칙이 정해진 지수라 운용 방식이 바뀌지 않음 —
    #   풋매도·커버드풋 지수는 급락 때 노출이 크게 달라져 2020년 3월 같은 때를 '바뀐 날'로 잘못 잡음)
    rg = None
    if R['sel'] and R['method'] == 'fit' and not short and not opt and not tk.startswith('D:'):
        c0 = break_point(R['yt'], R['cashr'], np.column_stack([c for _, c in R['sel']]), R['good'])
        if c0 is not None and n_all - c0 >= MIN_DAYS * 2:
            R2 = best_select(lo + c0)
            if R2 is not None and R2['sel']:
                R, rg = R2, int(cal[lo + c0])
    sel, score, method = R['sel'], R['score'], R['method']
    yt, cash, good = R['yt'], R['cashr'], R['good']
    n = len(yt)
    if not sel:
        if R['cash'][0] > 0.02:
            return None
        method = 'cash'
    Xs = np.column_stack([c for _, c in sel]) if sel else np.zeros((n, 0))
    cr = None
    if method == 'basket':
        w = np.array(R['bw'])
        d = float(np.mean((np.log1p(yt) - np.log1p(cash + Xs @ w))[good]))
    else:
        w, d = fit_final(yt, cash, Xs, good)
        W = float(sum(float(wi) for (vk, _), wi in zip(sel, w) if len(vk) <= 3))     # 노출 합 (콜 매도 덧씌우기 열 빼고)
        if method == 'fit' and tcur == 'USD' and sel and (W >= LEV_HI or W <= LEV_LO) and is_lev_etf(D, tk) and D.series(LEV_RATE) is not None:
            #   (FRED 를 한 번도 못 받아 연방기금 금리가 없으면 예전처럼 단기국채 금리 — 식이 통째로 빠지지 않게)
            # 레버리지·인버스: 현금·이자 = 연방기금 금리 — 대상 통화 현금을 뺀 열('n'·'u')은 x − f = (x − c) − (f − c) 로 바꿔 같은 후보로 다시 맞춤
            a0 = R['a0']
            fr = E.cash_ret(tcur, cal_name, LEV_RATE)[a0:a0 + n]
            dlt = fr - cash
            Xf = np.column_stack([c - dlt if len(vk) <= 3 and vk[2] in ('n', 'u') else c for vk, c in sel])
            score = evaluate(yt, fr, Xf, R['folds'], good, pri([vk[0] for vk, _ in sel], [len(vk) > 3 for vk, _ in sel]))
            w, d = fit_final(yt, fr, Xf, good)
            cr = LEV_RATE
    if any(abs(float(wi)) > (WZ_MAX if len(vk) > 3 else W_MAX) for (vk, _), wi in zip(sel, w)) or score[0] > E_DROP:
        if explain:
            log(tk, '버림: 배수 %s · 오차 %.3f' % (np.round(w, 2).tolist(), score[0]))
        return None
    r = dict(base)
    r['m'] = [[vk[0], int(vk[1]), round(float(wi), 5), vk[2], fcur_of(D, vk[0]), name_of(D, vk[0])] + ([[vk[3][0], vk[3][1], vk[3][2]]] if len(vk) > 3 else [])
              for (vk, _), wi in zip(sel, w)]
    r['d'] = round(d * 252.0, 6)
    r['e'] = [round(score[1], 5), round(score[2], 5), round(score[0], 5), len(R['folds'])]
    r['k'] = method
    if cr:
        r['cr'] = cr                                      # 현금·이자 금리 (없으면 통화 기본 R:USD·R:KRW)
    if short:
        r['short'] = 1
    if R.get('cc'):
        r['cc'] = 1
    if rg is not None:
        r['rg'] = rg
        r['nf'] = n                                       # 맞춘 날 수 (바뀐 뒤)
    if (~good).any():
        r['bad'] = int((~good).sum())
    dn, d0 = shrink_d(D, tk, r)                       # 짧은 기간에 맞춘 d 의 우연을 줄임 (상장 전 구간 시험으로 확인한 방법)
    r['dh'] = r['d']; r['d'] = round(dn, 6)
    r['x'] = x_err(score[0])
    if explain:
        corr, order, keys_ = R['corr'], R['order'], keys
        top = sorted(((abs(corr[i]), keys_[i]) for i in order), reverse=True)[:6]
        log(tk, json.dumps(r, ensure_ascii=False), '\n   corr top:', ', '.join('%s %.3f' % (k, c) for c, k in top),
            '\n   cash-only %.4f' % R['cash'][0], '· basket %s' % ('%.4f' % R['bask'][1][0] if R['bask'] else '-'), '· regime %s' % (ymd(rg) if rg else '-'))
    return r


def fee_of(D, key):
    """연 보수(소수) — 국내 네이버 totalFee(%) · 미국 야후 er · 지수(D: 한국거래소 옵션 지수)는 0 · 모르면 None"""
    if key.startswith('D:'):
        return 0.0
    try:
        m = D.meta(key)
        if key.startswith('K:'):
            v = m.get('totalFee')
            return float(v) / 100.0 if v not in (None, '', '-') else None
        if key.startswith('U:'):
            v = m.get('er')
            return float(v) if v is not None else None
    except Exception:
        return None
    return None


def inc_sig(D, key):
    """후보 시계열에 빠진 수익(배당·이자·선물 롤)을 d0 이 모르는 정도(연)
    · 0: 분배 재투자 수정가(국내 ETF 네이버 · 미국 ETF·종목 야후)·S&P 500 TR·금리 합성·코인 · PI_SIG: 가격 지수·국내 종목(네이버 가격)·선물·환율"""
    if key in SYN or key == 'X:SPXTR' or key.startswith('U:') or key.startswith('C:'):
        return 0.0                                    # C: Cboe 옵션 전략 지수 = 배당·이자를 담은 총수익 지수
    if key.startswith('D:'):                          # 한국거래소 옵션 지수: ID 끝 T = 총수익(TR) · P = 가격 지수(배당 빠짐)
        return 0.0 if key.endswith('T') else PI_SIG
    if key.startswith('Z:'):                          # 모의 커버드콜: 코스피 200 가격 지수 기반(배당 빠짐) · 모의 프리미엄과 실제의 차이
        return PI_SIG
    if key.startswith('K:'):
        return 0.0 if D.info(key).get('kind') == 'etf' else PI_SIG
    if key.startswith('Y:'):
        s = key[2:]
        return 0.0 if s in ('^RUTTR', '^SP500TR', '^PUT') or s.endswith('-USD') else PI_SIG
    return PI_SIG


def fee_etf(D, key):
    """후보가 ETF 면 그 연 보수(모르면 0) · ETF 가 아니면 0"""
    if D.info(key).get('kind') != 'etf':
        return 0.0
    f = fee_of(D, key)
    return f if f is not None else 0.0


def prior_of(D, tk, keys, zs=None, opt=None, cache=None):
    """d 를 당길 사전값 재료 (대상 보수, 열별 후보 ETF 보수, 열별 빠진 수익 불확실성, 그 밖 불확실성)
    · 콜 매도 ETF 를 덧씌우기(z) 없이 맞춘 식은 옵션 매도 손익을 d0 이 몰라 OPT_SIG 를 더함 · keys: 열의 후보 키 · zs: 열마다 콜 매도 덧씌우기 열인가"""
    zs = list(zs) if zs is not None else [False] * len(keys)
    if opt is None:
        opt = is_option_etf(D, tk)
    xs = OPT_SIG if opt and not any(zs) else 0.0
    ft = fee_of(D, tk)
    f, s = [], []
    for k, z in zip(keys, zs):
        if z:
            f.append(0.0); s.append(0.0)
            continue
        v = cache.get(k) if cache is not None else None
        if v is None:
            v = (fee_etf(D, k), inc_sig(D, k))
            if cache is not None:
                cache[k] = v
        f.append(v[0]); s.append(v[1])
    return (FEE_DEFAULT if ft is None else ft), np.array(f, np.float64), np.array(s, np.float64), xs


def shrink_d(D, tk, r):
    """맞춘 d(연)를 사전값 d0 쪽으로 당김 → (d, d0) · r: m(항)·d·e(검증)·n(nf) — 교차 검증(fold_d)과 같은 방법 · 검증이 없는 식은 그대로"""
    pr = prior_of(D, tk, [t[0] for t in r['m']], [len(t) >= 7 for t in r['m']])
    d0, tau = prior_d(pr, np.array([t[2] for t in r['m']], np.float64))
    if not r.get('e'):
        return r['d'], d0
    return shrink_to(r['d'], d0, r['e'][1], (r.get('nf') or r['n']) / 252.0, tau), d0


def x_err(e):
    """예상 오차(연): 검증 오차를 상장 전 구간 시험 결과로 보정"""
    return None if e is None else round(math.sqrt((X_MUL * e) ** 2 + X_FLOOR ** 2), 5)


def fcur_of(D, key):
    return D.info(key).get('cur') or 'USD'


def name_of(D, key):
    """식 설명에 쓸 짧은 이름 — 국내 ETF·종목은 이름, 미국은 티커, 지수·합성은 정해 둔 이름"""
    if key in SYN_NAME:
        return SYN_NAME[key]
    if key.startswith('Y:') or key.startswith('N:'):
        return YIDX_NAMES.get(key[2:]) or key[2:]
    if key.startswith('C:'):                          # 'S&P 500 30-Delta BuyWrite(BXMD)' — 영문 지수 이름(한·영 화면 공통) · 지수 회사 이름은 뺌
        nm = re.sub(r'\s*\bIndex\b', '', D.info(key).get('name') or key[2:])
        nm = re.sub(r'\s+', ' ', re.sub(r'\bcboe\b', ' ', nm, flags=re.I)).strip() or key[2:]
        return '%s(%s)' % (nm, key[2:])
    if key in ZSIM:                                   # '코스피 200 커버드콜 모의(월간 ATM · VKOSPI×0.9)|KOSPI 200 covered call model (monthly ATM, VKOSPI×0.9)'
        P, k, l = ZSIM[key]
        kk = 'ATM' if k == 0 else '%g%% OTM' % (k * 100)
        return '코스피 200 커버드콜 모의(%s %s · VKOSPI×%g)|KOSPI 200 covered call model (%s %s, VKOSPI×%g)' % (
            '월간' if P == 'M' else '위클리', kk, l, 'monthly' if P == 'M' else 'weekly', kk, l)
    if key.startswith('D:'):                          # '코스피 200 커버드콜 ATM 지수|KOSPI 200 Covered Call ATM' — 한글|영문 (화면이 언어에 맞춰 고름)
        i = D.info(key)
        ko = re.sub(r'\s+', ' ', re.sub(r'\bcboe\b', ' ', i.get('name') or key[2:], flags=re.I)).strip()
        en = re.sub(r'\s+', ' ', re.sub(r'\bcboe\b', ' ', re.sub(r'\s*\bIndex\b', '', i.get('name_en') or ''), flags=re.I)).strip()
        if not en or re.match(r'^[A-Z]-KOSPI', en):        # 영문 이름이 없거나 약칭(C-KOSPI 200-5O)이면 낱말을 바꾼 이름
            en = krx_en_name(ko) or en
        return ko + '|' + (en or 'KRX option index ' + key[2:])
    if key.startswith('K:'):
        m = D.meta(key)
        if m.get('itemName'):
            return m['itemName']
        return D.kr_names().get(key[2:]) or D.info(key).get('name') or key[2:]
    return key[2:]


def holdings(D, tk):
    """상위 보유 종목 [(후보 키, 비중)] — 국내 네이버 · 미국 야후 (한국 종목 .KS·.KQ → K:)"""
    from etf_bt_data import yahoo_holding_key
    m = D.meta(tk)
    out = []
    if tk.startswith('K:'):
        for h in m.get('etfTop10MajorConstituentAssets') or []:
            ic = str(h.get('itemCode') or '')
            try:
                w = float(str(h.get('etfWeight') or '0').replace('%', '').replace(',', '')) / 100.0
            except Exception:
                w = 0.0
            if re.match(r'^[0-9][0-9A-Z]{5}$', ic) and w > 0:
                out.append(('K:' + ic, w))
    else:
        for sym, w, nm in m.get('holdings') or []:
            hk = yahoo_holding_key(sym)
            try:
                w = float(w or 0)
            except Exception:
                w = 0.0
            if hk and w > 0:
                out.append((hk, w))
    return out


def basket_model(D, E, hold, cal_name, tcur, mt, elig, yt, cash, folds, col, good, pri=None):
    """상위 보유 종목을 지금 비중 그대로(합 = 1 로 맞춤) 매일 재조정한 바스켓 — 쓸 수 있는 종목 비중 합이 60% 이상일 때만 (사용자 요청 방식 · 같은 기준으로 비교)
    · 교차 검증은 식 고르기와 같은 evaluate (w 는 비중 그대로 · d 는 폴드마다 맞추고 사전값 쪽으로 당김)"""
    hs = [(k, w) for k, w in hold if k in mt['kidx'] and elig[mt['kidx'][k]]]
    tot = sum(w for _, w in hs)
    if not hs or tot < 0.6:
        return None
    sel, ws = [], []
    for k, w in hs:
        fi = D.info(k)
        fmk, fcur = fi.get('mk') or 'US', fi.get('cur') or 'USD'
        v = 'n' if fcur == tcur else 'u'
        lg = E.known_lag(fmk, cal_name)
        c = col(k, lg, v)
        if c is None:
            return None
        sel.append(((k, lg, v), c)); ws.append(w / tot)
    X = np.column_stack([c for _, c in sel]); w = np.array(ws)
    sc = evaluate(yt, cash, X, folds, good, pri([k for (k, _, _), _ in sel]) if pri else None, wfix=w)
    return sel, sc, ws


def short_recipe(D, tk, base):
    """상장 40거래일 미만 국내 ETF: 같은 기초지수를 따르는 더 오래된 국내 ETF 가 있으면 그대로 (환헤지 여부도 같아야) — 검증 기간이 짧다고 표시"""
    m = D.meta(tk)
    bi = (m.get('etfBaseIndex') or '').strip()
    if not bi:
        return None
    nm = m.get('itemName') or ''
    hedged = '(H)' in nm
    best = None
    for k, v in D.uni.items():
        if not k.startswith('K:') or k == tk or v.get('kind') != 'etf' or v.get('err'):
            continue
        mm = D.meta(k)
        if (mm.get('etfBaseIndex') or '').strip() != bi or (('(H)' in (mm.get('itemName') or '')) != hedged):
            continue
        if v.get('start', 1e9) < base['s'] - 30 and v.get('end', 0) >= base['s'] and (best is None or v['start'] < best[1]):
            best = (k, v['start'])
    if not best:
        return None
    r = dict(base)
    try:
        fee_t, fee_s = float(m.get('totalFee') or 0), float(D.meta(best[0]).get('totalFee') or 0)
    except Exception:
        fee_t = fee_s = 0.0
    r.update({'m': [[best[0], 0, 1.0, 'n', 'KRW', name_of(D, best[0])]], 'd': round(-(fee_t - fee_s) / 100.0, 6), 'e': None, 'k': 'index', 'short': 1})
    return r


def bt_levels(D, E, r, getF=None):
    """화면 btLevels 와 같은 계산 (회귀 테스트·대조용) — 달력 위 백테스트 총수익 수준 (상장 첫날 = 1) → (날짜, 수준)
    getF(키) → {'d','a'} (체인으로 늘린 시계열을 줄 때) · 없으면 캐시 자료"""
    cal_name = 'KR' if r['c'] == 'KRW' else 'US'
    tcur = r['c']
    cal = E.cal[cal_name]
    iS = int(np.searchsorted(cal, r['s']))
    if iS < 1 or iS >= len(cal):
        return None
    cash = E.cash_ret(tcur, cal_name, r.get('cr'))       # 레버리지·인버스 식은 'cr'(연방기금 금리) — 화면 btBuildLevels·MBT levels 와 같음
    m0 = cash.copy()
    for t in r['m']:
        key, lag, w, var, fcur = t[0], int(t[1]), float(t[2]), t[3], t[4]
        s = getF(key) if getF else None
        if s is None:
            s = D.series(key)
        rr = rets(align_level(s, cal, lag))
        if len(t) > 6 and t[6]:                           # 콜 매도 덧씌우기 열 (통화 변환·현금 없음)
            P, kk, ll = t[6]
            m0 = m0 + w * cc_col(rr, cal, expiry_flags(cal, P, cal_name), kk, ll)
            continue
        if var == 'u' and fcur != tcur:
            fx = E.fx_level(fcur, cal_name, lag, tcur)
            x = (1.0 + rr) * (1.0 + rets(fx)) - 1.0 - cash
        elif var == 'h' or fcur != tcur:
            x = rr - E.cash_ret(fcur, cal_name)
        else:
            x = rr - cash
        m0 = m0 + w * x
    dd = math.exp(r.get('d', 0.0) / 252.0)
    lv = np.full(iS + 1, np.nan); lv[iS] = 1.0
    j0 = 0
    for i in range(iS, 0, -1):
        g = (1.0 + m0[i]) * dd
        if not (g > 0) or math.isnan(g):
            j0 = i; break
        lv[i - 1] = lv[i] / g
    return cal[j0:iS + 1], lv[j0:iS + 1]


def _ser(d, vals, nd):
    d = [int(x) for x in d]
    return {'d0': d[0], 'dd': [d[i] - d[i - 1] for i in range(1, len(d))], 'v': [round(float(x), nd) for x in vals]}


def hosted_missing(old, D, pre):
    """지난 식들이 쓰던 옵션 전략 지수(pre = 'C:' Cboe · 'D:' 한국거래소 · 'Z:' 모의 커버드콜) → (그 목록, 그중 이번 자료에 없는 것 — 받기 실패·캐시 없음)"""
    used = sorted({f[0] for r in old.values() for f in r['m'] if f[0].startswith(pre)})

    def gone(k):
        if k.startswith('Z:'):                    # 모의 커버드콜은 목록(uni)에 없음 — 재료(코스피 200·VKOSPI)로 계산되는지만 (정의를 뺀 키는 받기 실패가 아니라 셈하지 않음)
            if k not in ZSIM:
                return False
            s = D.series(k)
            return s is None or len(s['d']) <= 30
        u = D.uni.get(k) or {}
        return bool(u.get('err')) or u.get('n', 0) <= 30 or D.series(k) is None
    return used, [k for k in used if gone(k)]


def load_recipes(out):
    """지난 실행이 쓴 식 (묶음 파일 0~15.json) → {키: 식}"""
    old = {}
    for i in range(NSHARD):
        try:
            old.update(json.load(open(os.path.join(out, '%d.json' % i), encoding='utf-8'))['e'])
        except Exception:
            pass
    return old


def write_out(out, recipes, D, only, force=False):
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(out, 'r'), exist_ok=True)
    if only:
        print(json.dumps(recipes, ensure_ascii=False, indent=1)[:8000])
        return
    # 안전장치: 자료 받기가 크게 실패해 식이 지금 것의 90% 아래로 줄면 쓰지 않음 (화면의 백테스트가 한꺼번에 사라지지 않게 · --force 로 무시)
    old_n = len(load_recipes(out))
    if not force and old_n >= 1000 and len(recipes) < 0.9 * old_n:
        raise SystemExit('식이 %d → %d 로 크게 줄어 쓰지 않음 (자료 받기 실패 의심 · --force 로 무시)' % (old_n, len(recipes)))
    shards = [{} for _ in range(NSHARD)]
    for k, r in recipes.items():
        shards[shard_of(k)][k] = r
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for i, sh in enumerate(shards):
        json.dump({'updated': now, 'e': sh}, open(os.path.join(out, '%d.json' % i), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    # 화면이 받는 보조 자료 — 금리(현금·채권 지수를 같은 식으로) · 원/달러 15:30 종가 · S&P 500 TR 앞부분
    used = {f[0] for r in recipes.values() for f in r['m']} | {'R:KRW', 'R:USD'} | {r['cr'] for r in recipes.values() if r.get('cr')}
    for k in sorted(k for k in used if opt_idx(k)):    # 옵션 전략 지수 C: Cboe · D: 한국거래소 (정리한 일봉 그대로 — 화면이 같은 값으로 계산)
        s = D.series(k)
        if s is None or not len(s['d']):
            continue
        j = _ser(s['d'], s['a'], 6)
        json.dump({'updated': now, 'k': k, 'd0': j['d0'], 'dd': j['dd'], 'a': j['v']},
                  open(os.path.join(out, 'r', k.replace(':', '_') + '.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    # 이제 어느 식도 쓰지 않는 옵션 전략 지수 파일은 지움 (오래된 값이 남아 있지 않게 · 워크플로가 지운 파일도 커밋)
    keep = {k.replace(':', '_') + '.json' for k in used if opt_idx(k)}
    for f in sorted(os.listdir(os.path.join(out, 'r'))):
        if re.match(r'^[CDZ]_[A-Za-z0-9]+\.json$', f) and f not in keep:
            os.remove(os.path.join(out, 'r', f))
    for k in sorted(used & set(SYN)):
        s = D.series(k)
        if s is None:
            continue
        j = _ser(s['d'], s['y'], 4)
        json.dump(dict({'updated': now, 'k': k, 'mat': SYN[k][1], 'cur': SYN[k][2], 'd0': j['d0'], 'dd': j['dd'], 'y': j['v']}, **({'b': SYN_BASIS[k]} if k in SYN_BASIS else {})),
                  open(os.path.join(out, 'r', k.replace(':', '_') + '.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    f = D.series('F:USDKRW')
    j = _ser(f['d'], f['c'], 2)
    json.dump({'updated': now, 'k': 'F:USDKRW', 'd0': j['d0'], 'dd': j['dd'], 'c': j['v']}, open(os.path.join(out, 'r', 'F_USDKRW.json'), 'w', encoding='utf-8'), separators=(',', ':'))
    D.series('X:SPXTR')
    if D.spx_pre is not None:
        pd_, pl = D.spx_pre
        j = _ser(pd_, pl, 12)
        json.dump({'updated': now, 'k': 'X:SPXTR', 'base': 'Y:^SP500TR', 'd0': j['d0'], 'dd': j['dd'], 'a': j['v']},
                  open(os.path.join(out, 'r', 'X_SPXTR.json'), 'w', encoding='utf-8'), separators=(',', ':'))


if __name__ == '__main__':
    main()
