#!/usr/bin/env python3
"""[STRATSIM] 투자전략 시뮬레이터 분배금 자료(data/stratsim/divs.csv) 검사 — python3 tests/stratsim_divs_test.py
   · scripts/update_stratsim.py 의 야후 분배금 읽기(yahoo_daily(sym, divs))를 가짜 야후 응답으로:
     분배락일(거래소 시간대 날짜) · 전날 종가(분할만 반영 close) · 일봉에 없는 날·첫날·이상한 값 건너뜀 · 응답에 분배금이 없으면 빈 목록
   · update_divs(): 받은 종목은 새 줄 · 받지 못한 종목은 예전 줄 그대로 · 상장일 전 분배금 뺌 · 바뀐 것이 없으면 쓰지 않음(False)
   (2026-11-28 — 시뮬레이터 '분배금 미국 원천징수 15%'·양도세 원가)
   실패하면 'FAIL …' 줄과 종료 코드 1"""
import importlib.util, json, os, sys, tempfile, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMP = tempfile.mkdtemp(prefix='ssdiv-')
os.environ['STRATSIM_DIR'] = TMP
spec = importlib.util.spec_from_file_location('us', os.path.join(ROOT, 'scripts', 'update_stratsim.py'))
U = importlib.util.module_from_spec(spec)
spec.loader.exec_module(U)

ok = bad = 0


def check(name, cond, info=None):
    global ok, bad
    if cond:
        ok += 1
    else:
        bad += 1
        print('FAIL ' + name + ('' if info is None else ' — ' + repr(info)[:300]))


def ts(d):   # 미국 동부 09:30 (야후 일봉 시각) → 유닉스 초
    return int(datetime.datetime.fromisoformat(d + 'T09:30:00').replace(tzinfo=U.ET).timestamp())


def chart(days, closes, divs, tz='America/New_York'):
    adj = [(c if c else 100.0) * 0.9 for c in closes]
    ev = {str(ts(d)): {'amount': a, 'date': ts(d)} for d, a in divs}
    return json.dumps({'chart': {'result': [{'meta': {'exchangeTimezoneName': tz}, 'timestamp': [ts(d) for d in days],
                                               'indicators': {'adjclose': [{'adjclose': adj}], 'quote': [{'close': closes}]},
                                               'events': {'dividends': ev} if divs else {}}]}}).encode()


# 거래일 120개 (주말 뺌)
days, d = [], datetime.date(2024, 1, 2)
while len(days) < 120:
    if d.weekday() < 5:
        days.append(d.isoformat())
    d += datetime.timedelta(days=1)
closes = [100 + i for i in range(120)]
divs = [(days[10], 0.5), (days[0], 0.3), ('2024-01-06', 0.2), (days[20], 80.0), (days[30], -1.0), (days[40], 0.25)]
U.get = lambda url, tries=3, ua=None: chart(days, closes, divs)
dl = []
out = U.yahoo_daily('TQQQ', dl)
check('수정 종가 그대로', len(out) == 120 and abs(out[days[5]] - closes[5] * 0.9) < 1e-9)
check('분배금: 날짜·금액·전날 종가 (첫날·일봉에 없는 날·이상한 비율·음수 건너뜀)',
      dl == [(days[10], 0.5, closes[9]), (days[40], 0.25, closes[39])], dl)
dl2 = []
U.get = lambda url, tries=3, ua=None: chart(days, closes, [])
U.yahoo_daily('SPY', dl2)
check('분배금 없는 응답 → 빈 목록', dl2 == [], dl2)
dl3 = []
U.get = lambda url, tries=3, ua=None: chart(days, [None if i == 9 else c for i, c in enumerate(closes)], [(days[10], 0.5)])
U.yahoo_daily('QQQ', dl3)
check('전날 종가가 빈 날 → 그 앞 거래일 종가', dl3 == [(days[10], 0.5, closes[8])], dl3)

# update_divs
old = 'date,asset,div,prev_close\n20200110,qqq,0.4,200\n20200110,spy,1.2,300\n20200210,xlk,0.3,90\n'
open(U.DIVS, 'w', encoding='utf-8').write(old)
U.DIV_GOT.clear()
U.DIV_GOT['qqq'] = [('2024-01-17', 0.5, 108.0)]
U.DIV_GOT['spy'] = []
ch = U.update_divs()
txt = open(U.DIVS, encoding='utf-8').read()
check('받은 종목 새 줄 · 못 받은 종목(xlk) 예전 줄 · 받았는데 없는 종목(spy) 줄 없음 · 날짜순',
      ch and txt == 'date,asset,div,prev_close\n20200210,xlk,0.3,90\n20240117,qqq,0.5,108\n', txt)
check('바뀐 것이 없으면 쓰지 않음', U.update_divs() is False)
U.DIV_GOT.clear()
U.DIV_GOT['tqqq'] = [(d, a, p) for d, a, p in [('2010-01-04', 0.1, 50.0), ('2010-03-01', 0.1, 50.0)] if d >= U.IPO['tqqq']]
check('상장일 전 분배금은 넣지 않음(update_prices 와 같은 거름)', U.DIV_GOT['tqqq'] == [('2010-03-01', 0.1, 50.0)])

# 실제 파일 모양: data/stratsim/divs.csv — 머리줄 · 4칸 · 아는 종목 · 날짜순 · 양수 · 비율 0~50% · 상장일 뒤
real = os.path.join(ROOT, 'data', 'stratsim', 'divs.csv')
if os.path.exists(real):
    L = open(real, encoding='utf-8').read().splitlines()
    rows = [r.split(',') for r in L[1:] if r]
    good = L[0] == 'date,asset,div,prev_close' and all(len(r) == 4 and r[1] in U.IPO and float(r[2]) > 0 and float(r[3]) > 0
                                                     and float(r[2]) / float(r[3]) < 0.5 and f'{r[0][:4]}-{r[0][4:6]}-{r[0][6:]}' >= U.IPO[r[1]] for r in rows)
    check('data/stratsim/divs.csv 모양 (' + str(len(rows)) + '줄)', good and len(rows) >= 300 and [r[0] for r in rows] == sorted(r[0] for r in rows))
else:
    check('data/stratsim/divs.csv 있음', False)

print(('FAIL ' if bad else '') + f'stratsim_divs_test: {ok}개 통과 · {bad}개 실패')
sys.exit(1 if bad else 0)
