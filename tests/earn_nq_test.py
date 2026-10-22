#!/usr/bin/env python3
"""실적발표 캘린더 — 야후가 늦게 반영한 미국 실적을 나스닥 달력 값으로 먼저 보여 주는 nq_merge()·숫자 읽기 단독 확인
(python3 tests/earn_nq_test.py · run_regression.py 가 부름 · 네트워크 없음)"""
import os, re, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import update_earnings as U

fails = oks = 0
def ok(c, m, i=None):
    global fails, oks
    if c: oks += 1
    else: fails += 1; print('FAIL', m, i)

ok(U._nq_money('$7.25') == 7.25 and U._nq_money('($0.12)') == -0.12 and U._nq_money('N/A') is None and U._nq_money('') is None, '금액 읽기 $·괄호 음수·N/A')
ok(U._nq_pe('Sep/2026') == '2026.09' and U._nq_pe('Dec/2025') == '2025.12' and U._nq_pe('x') is None, '회계 분기 끝 읽기')
H = [{'d': '2026-04-29', 'pe': '2026.03', 'a': 10.44, 'e': 6.66, 'sp': 56.8}, {'d': '2026-07-29', 'pe': '2026.06', 'a': 6.18, 'e': 7.22, 'sp': -14.4}]
fin = {'q': {'p': []}, 'hist': H}
R = {('META', '2026-10-21'): {'a': 7.25, 'e': 4.98, 'pe': '2026.09'}}
f2 = U.nq_merge('META', fin, '2026-10-22', R)
l = f2['hist'][-1]
ok(f2 is not fin and l == {'d': '2026-10-21', 'pe': '2026.09', 'a': 7.25, 'e': 4.98, 'sp': 45.6, 'src': 'nasdaq'} and len(f2['hist']) == 3, '야후에 없는 이번 발표 → 나스닥 값으로 붙임', l)
ok(fin['hist'] is H and len(H) == 2, '원래 fin 은 그대로(복사본에 붙임)')
ok(U.nq_merge('META', f2, '2026-10-22', R)['hist'] == f2['hist'], '다시 실행해도 한 줄만(중복 없음)')
H2 = H + [{'d': '2026-10-21', 'pe': '2026.09', 'a': 7.30, 'e': 5.01, 'sp': 45.7}]
f3 = U.nq_merge('META', {'q': {}, 'hist': H2 + [l]}, '2026-10-22', R)
ok(f3['hist'] == H2, '야후가 반영하면 나스닥 줄은 빠지고 야후 값만', f3['hist'][-2:])
fS = {'hist': [{'d': '2026-10-19', 'pe': '2026.09', 'a': 2.15, 'e': 1.996, 'sp': 7.7}]}
ok(U.nq_merge('SCCO', fS, '2026-10-22', {('SCCO', '2026-10-21'): {'a': 2.15, 'e': 2.04, 'pe': '2026.09'}}) is fS, '같은 분기를 야후가 다른 날짜로 이미 넣었으면 붙이지 않음')
ok(U.nq_merge('META', fin, '2026-10-20', R) is fin, '미국 날짜로 아직 발표 전(미래)이면 붙이지 않음')
ok(U.nq_merge('IBM', fin, '2026-10-22', R) is fin, '다른 종목 결과는 쓰지 않음')
ok(U.nq_merge('META', fin, '2026-10-22', {('META', '2026-10-21'): {'a': None, 'e': 4.98, 'pe': '2026.09'}}) is fin, '실제 EPS 가 없으면(아직 발표 전 줄) 붙이지 않음')
f4 = U.nq_merge('META', fin, '2026-10-22', {('META', '2026-10-21'): {'a': -0.5, 'e': None, 'pe': None}})
ok(f4['hist'][-1]['sp'] is None and f4['hist'][-1]['a'] == -0.5, '예상치 없음 → 서프라이즈 없음 · 회계 분기 모르면 30일 넘게 지난 발표만', f4['hist'][-1])
ok(U.nq_merge('META', {'hist': [{'d': '2026-10-10', 'pe': None}]}, '2026-10-22', {('META', '2026-10-21'): {'a': 1.0, 'e': 1.0, 'pe': None}})['hist'][-1].get('src') is None, '회계 분기 모르고 30일 안이면 같은 발표로 보고 붙이지 않음')
# 워크플로: 앞 실행을 기다린 실행도 main 최신본에서 시작(옛 커밋에서 다시 만들면 같은 자료 파일끼리 충돌해 실패) · 자기 그룹에서 차례대로
W = open(os.path.join(ROOT, '.github', 'workflows', 'update-earnings.yml'), encoding='utf-8').read()
ok(re.search(r'actions/checkout@v\d+\n\s+with:\n(?:\s+#.*\n)*\s+ref: \$\{\{ github\.ref \}\}', W) is not None, '실적 워크플로 checkout 이 main 최신본(ref: github.ref)')
ok(re.search(r'group: earnings\n\s+cancel-in-progress: false', W) is not None, '실적 워크플로 자기 그룹 · 진행 중 취소 안 함')
print('earn_nq_test: %d개 통과 · %d개 실패' % (oks, fails))
sys.exit(1 if fails else 0)
