#!/usr/bin/env python3
"""[RATES] 전세계 금리 — data/rates.json 검사 + update_rates.py 계산 함수 단독 확인 (네트워크 없음)
(python3 tests/rates_test.py · run_regression.py · Actions '전세계 금리 갱신' 이 커밋 전에 부름 — 하나라도 틀리면 커밋하지 않음)"""
import datetime, json, os, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import update_rates as U

fails = oks = 0


def ok(c, m, i=''):
    global fails, oks
    if c: oks += 1
    else: fails += 1; print('FAIL', m, str(i)[:300])


# ── 1. 계산 함수 ──
ok(U._frac('3-3/4') == 3.75 and U._frac('4') == 4 and U._frac('1/4') == 0.25 and U._frac('0') == 0, '성명서 분수 읽기')
ok(U.lpr_next(datetime.date(2026, 10, 19)) == datetime.date(2026, 10, 20) and U.lpr_next(datetime.date(2026, 10, 20)) == datetime.date(2026, 11, 20)
   and U.lpr_next(datetime.date(2026, 6, 19)) == datetime.date(2026, 6, 22), '다음 LPR 공시일 (20일 · 주말이면 월요일)')
daily = [('2000-01-%02d' % d, 5.0 + (d % 3) * 0.01) for d in range(1, 29)] + [('2001-01-01', 4.0), ('2001-01-02', 4.0), ('2001-03-05', 3.5)]
U.MKT_YEAR, keep = 5, U.MKT_YEAR
st, mkt = U.to_steps(daily)
U.MKT_YEAR = keep
ok(mkt == ['2000'] and st[0][0] == '2000-01-01' and st[-2:] == [['2001-01-01', 4.0], ['2001-03-05', 3.5]], '시장금리 해 → 달 평균 · 나머지는 변화점', (st, mkt))
steps = [['2020-01-01', 1.0], ['2020-03-05', 0.75], ['2020-04-10', 0.5], ['2020-06-03', 0.75]]
ev = U.decisions(steps, set(), ['2020-03-04', '2020-05-01', '2020-06-01'], None, set())
ok(ev == [['2020-03-04', 0.75, 1.0, 'm'], ['2020-04-10', 0.5, 0.75, 'x'], ['2020-05-01', 0.5, 0.5, 'm'], ['2020-06-01', 0.75, 0.5, 'm']], '회의마다 인상·인하·동결 + 회의 밖 변경 = 임시', ev)
ev = U.decisions([['2020-01-01', 1.0], ['2020-03-05', 0.75], ['2020-04-10', 0.43], ['2020-06-03', 0.68]], set(), None, None, {'2020-04-10'})
ok(ev == [['2020-03-05', 0.75, 1.0, 'c'], ['2020-04-10', 0.43, 0.75, 'b'], ['2020-06-03', 0.68, 0.43, 'c']], '회의 목록 없음 → 변경만 · 정의 바뀐 날 = 기준 변경', ev)
ev = U.decisions(steps, set(), ['2020-03-04', '2020-05-01', '2020-06-01'], None, set(), last='2020-05-01', lag=1)
ok([e[3] for e in ev] == ['m', 'x', 'p', 'm'] and ev[2][:3] == ['2020-05-01', 0.5, 0.5], '자료가 회의일+지연 전까지만 있으면 결과 대기(동결로 쓰지 않음)', ev)
ev = U.decisions(steps, set(), ['2020-03-04', '2020-05-01', '2020-06-01'], None, set(), last='2020-05-01', lag=1, known={'2020-05-01': 0.25})
ok(ev[2] == ['2020-05-01', 0.25, 0.5, 'm'], '결정 보도자료로 읽은 결과(적용 전)는 결정으로', ev)
ev = U.decisions([['2006-01-01', 4.5], ['2006-08-03', 4.75], ['2010-05-20', 5.25]], set(), None, None, {'2006-08-03', '2010-05-20'}, real={'2006-08-03'})
ok([e[3] for e in ev] == ['c', 'b'], '정의 바뀐 날 = 기준 변경 · 공식 확인한 날(real)만 실제 결정', ev)
ev = U.decisions([['2019-01-01', 4.31], ['2019-08-20', 4.25], ['2019-09-20', 4.2]], set(), ['2019-08-20', '2019-09-20'], None, {'2019-08-20'})
ok(ev == [['2019-08-20', 4.25, 4.31, 'b'], ['2019-09-20', 4.2, 4.25, 'm']], '기준 변경일의 회의는 따로 동결로 쓰지 않음', ev)
_f = U.fetch
U.fetch = lambda *a, **k: ('<nav>Key ECB interest rates Euro short-term rate</nav><p>The Governing Council today decided to keep the three key ECB interest rates unchanged. '
                           'Key ECB interest rates The interest rates on the deposit facility, the main refinancing operations and the marginal lending facility will remain unchanged at 2.00%, 2.15% and 2.40% respectively. Asset purchase</p>').encode()
ok(U.ecb_decision_rates('x') == (2.0, 2.15), 'ECB 보도자료 읽기 (예금·MRO·한계 순서)')
U.fetch = lambda *a, **k: (b'<p>Accordingly, the interest rate on the main refinancing operations and the interest rates on the marginal lending facility and the deposit facility '
                           b'will be decreased to 4.25%, 4.50% and 3.75% respectively, with effect from 12 June 2024. The APP</p>')
ok(U.ecb_decision_rates('x') == (3.75, 4.25), 'ECB 보도자료 읽기 (MRO·한계·예금 순서)')
U.fetch = lambda *a, **k: b'<p>The Governing Council decided to lower the three key ECB interest rates by 25 basis points.</p>'
try:
    U.ecb_decision_rates('x'); ok(False, 'ECB 보도자료: 금리 숫자가 없으면 실패로(추측하지 않음)')
except ValueError:
    ok(True, '')
U.fetch = _f
ok(U.breaks_of('From 2 Aug 1990 onwards: cash rate target; from 23 Jan 1990 to 1 Aug 1990: mid; from 1 Sept 2006 onwards') == {'1990-08-02', '1990-01-23', '2006-09-01'}, 'BIS 설명에서 정의 바뀐 날짜 읽기')

# ── 2. data/rates.json ──
P = os.path.join(ROOT, 'data', 'rates.json')
try:
    d = json.load(open(P, encoding='utf-8'))
except Exception as e:
    print('FAIL 자료 파일을 읽지 못함', e); sys.exit(1)
today = d.get('today', '')
C = {c['c']: c for c in d.get('countries', [])}
ok(len(C) >= 45, '나라 수 45 이상', len(C))
MAIN = ['US', 'KR', 'JP', 'CN', 'TW', 'XM', 'GB', 'CH', 'SE', 'NO', 'DK', 'PL', 'CZ', 'HU']
ok(all(k in C for k in MAIN + ['XMR']), '주요국 모두 있음', [k for k in MAIN if k not in C])
for k, c in C.items():
    s = c['s']
    good = bool(s) and all(isinstance(x[1], (int, float)) and -2 <= x[1] <= 1e6 for x in s) and all(s[i][0] < s[i + 1][0] for i in range(len(s) - 1)) \
        and all(s[i][1] != s[i + 1][1] for i in range(len(s) - 1))
    ok(good, '%s 변화점: 날짜 오름차순·값 범위(−2~100만%% — 1992 스웨덴 500%%·1989 브라질 초인플레이션 수십만%% 등 실제 값)·연속 같은 값 없음' % k, s[:3])
    ok(c['from'] == s[0][0] and c['cur'] == s[-1][1] and c['last'] >= s[-1][0], '%s 시작·현재·기준일' % k, (c['from'], c['cur'], c['last']))
    if not c['end']:
        age = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(c['last'])).days
        ok(age <= (45 if k in U.CORE else 120), '%s 자료가 너무 오래됨 (%d일)' % (k, age))   # 원본 하나가 잠깐 멈춘 것(21일 넘으면 errs 에 기록)으로 다른 나라 갱신까지 막지 않게 — 그보다 오래면 실패로 알림
    evs = c['ev']
    ok(all(evs[i][0] <= evs[i + 1][0] for i in range(len(evs) - 1)) and all(e[3] in 'mxcbp' for e in evs), '%s 결정 기록 정렬·종류' % k)
    for e in evs:
        dt, v, p, kind = e
        recent = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(dt)).days <= 14
        if kind == 'p':
            good = recent and v == p == U.val_at(s, dt)        # 결과 대기는 최근 회의만 · 값은 그대로
        elif kind == 'm' and v != p and recent and U.val_at(s, dt) == p and U.val_at(s, today) == p:
            good = True                                         # 결정 보도자료로 읽은 결과 — 적용 전(새 금리가 아직 자료에 없음)
        elif kind == 'm':
            if v == p:
                good = U.val_at(s, dt) == v
            else:
                dd = datetime.date.fromisoformat(dt)
                good = any(U.val_at(s, (dd + datetime.timedelta(days=j)).isoformat()) == v for j in range(-1, 9)) and U.val_at(s, (dd - datetime.timedelta(days=2)).isoformat()) == p
        else:
            good = U.val_at(s, dt) == v and U.val_at(s, (datetime.date.fromisoformat(dt) - datetime.timedelta(days=1)).isoformat()) == p
        if not good:
            ok(False, '%s 결정 기록이 금리 흐름과 다름' % k, e); break
    for x in c['nx']:
        ok((x.get('d', '') >= today) or (x.get('m', '') >= today[:7]), '%s 다음 일정이 지난 날짜' % k, x)
ok(C['US']['rng'] == [round(C['US']['cur'] - 0.25, 4), C['US']['cur']], '미국 목표 범위 = 상단 − 0.25 ~ 상단', C['US']['rng'])
for k, n in (('US', 250), ('XM', 300), ('JP', 350), ('KR', 280), ('CN', 80)):
    ok(sum(1 for e in C[k]['ev'] if e[3] == 'm') >= n, '%s 지난 회의(동결 포함) %d개 이상' % (k, n), sum(1 for e in C[k]['ev'] if e[3] == 'm'))
for k in ('US', 'XM', 'JP', 'KR', 'CN'):
    ok(len(C[k]['nx']) >= 1, '%s 다음 발표 일정 있음' % k)
ok(C['TW']['nx'] and C['TW']['nx'][0].get('m') and C['TW']['nx'][0].get('e'), '대만 다음 이사회 = 달만(추정 표시)')
# 알려진 결정 (공식 발표와 대조해 둔 고정 기준값 — 계산이 바뀌어도 이것은 그대로여야 함)
KNOWN = [('US', '2024-09-18', 5.0, 5.5), ('US', '2008-12-16', 0.25, 1.0), ('KR', '2024-10-11', 3.25, 3.5), ('KR', '2025-05-29', 2.5, 2.75),
         ('XM', '2024-06-06', 3.75, 4.0), ('XMR', '2024-09-12', 3.65, 4.25), ('JP', '2024-03-19', 0.05, -0.1), ('JP', '2024-07-31', 0.25, 0.05),
         ('CN', '2024-10-21', 3.1, 3.35), ('TW', '2024-03-22', 2.0, 1.875), ('GB', '2024-08-01', 5.0, 5.25), ('GB', '2006-08-03', 4.75, 4.5)]
for k, dt, v, p in KNOWN:
    e = [x for x in C[k]['ev'] if x[0] == dt]
    ok(e and e[0][1] == v and e[0][2] == p, '알려진 결정 %s %s %s→%s' % (k, dt, p, v), e)
ok([e[3] for e in C['TR']['ev'] if e[0] == '2010-05-20'] == ['b'], '터키 2010.5.20 금리 종류 변경 = 기준 변경')
ok(not [e for e in C['KR']['ev'] if e[3] in 'xc'], '한국: 기준금리 변경이 모두 금통위 회의 날짜와 맞음', [e for e in C['KR']['ev'] if e[3] in 'xc'][:3])
ok(os.path.getsize(P) < 900 * 1024, '자료 파일 900KB 미만', os.path.getsize(P))
print('rates_test: %d개 통과 · %d개 실패' % (oks, fails))
sys.exit(1 if fails else 0)
