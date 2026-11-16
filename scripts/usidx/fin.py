#!/usr/bin/env python3
"""[USIDX] 기업별 분기·연간 재무 표 (SEC XBRL · 처음 낸 값) — 반도체 지수 분석(SEMIS)과 같은 항목
· 매출 = 여러 매출 태그 중 그 기간 가장 큰 값(총매출) · 영업이익이 없으면 매출 − 매출원가 − 연구개발비 − 판관비(oi_est)
· 분기 표의 이자보상배율·ROE·PER·배당수익률·주주환원율 = 최근 4개 분기 합 · 연간 표 = 그 해
· 시가총액 = 발행주식 수(표지 dei, 없으면 희석 가중평균 주식 수) × 그 기간 말 실제 종가 — 1,000배 등 단위 오류는 앞뒤 기간과 비교해 바로잡음"""
import os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D   # noqa: E402
import fund   # noqa: E402
from calc import quarters, days, fx_at, unit_fix, ADR, SHARE_MULT   # noqa: E402

FLOW = ['rev', 'oi', 'ni', 'ocf', 'intexp', 'div', 'buy']
INST = ['liab', 'eq', 'la', 'eqt']
FACT = (1e3, 1e6, 1e9)


QFORMS = ('10-Q', '10-Q/A', '6-K', '6-K/A')


def _dur(fc, key, cur, mode='first', annual=False):
    """{(s,e): 값} — mode 'first' = 태그 우선순위 · 'max' = 그 기간 가장 큰 값(매출)
    · annual=True: 분기 보고서(10-Q·6-K)에 처음 나온 값은 뺌 — 아마존처럼 10-Q 에 '최근 12개월' 현금흐름을 적는 회사의 값이 연간 줄로 들어가지 않게"""
    out = {}
    for tag, unit, rows in (fc.get('c') or {}).get(key, []):
        if unit != cur:
            continue
        for row in rows:
            s, e, v, filed, form = row[:5]
            if not s or (annual and form in QFORMS):
                continue
            k = (s, e)
            if k not in out or (mode == 'max' and v > out[k]):
                out[k] = v
    return out


def _inst(fc, key, cur=None):
    out = {}
    for tag, unit, rows in (fc.get('c') or {}).get(key, []):
        if cur and unit != cur and key != 'sho':
            continue
        for row in rows:
            s, e, v, filed, form = row[:5]
            if not s and e not in out:
                out[e] = v
    return out


def merge_close(store, tol):
    """끝 날짜가 tol 일 안으로 붙은 기간(같은 분기를 공시마다 3월 31일·4월 1일처럼 다르게 적음 — 워터스·록히드마틴 등)을 하나로
    · 값이 더 많은 쪽(같으면 뒤 날짜)을 남기고 빈 칸은 다른 쪽 값으로"""
    ks = sorted(store)
    i = 0
    while i < len(ks):
        j = i
        while j + 1 < len(ks) and days(ks[j], ks[j + 1]) <= tol:
            j += 1
        if j > i:
            grp = ks[i:j + 1]
            keep = max(grp, key=lambda k: (sum(1 for v in store[k].values() if v is not None), k))
            for k in grp:
                if k != keep:
                    for f, v in store[k].items():
                        if store[keep].get(f) is None and v is not None:
                            store[keep][f] = v
                    del store[k]
        i = j + 1
    return store


def near(e, keys, tol, after=0):
    """keys 중 e 에서 -tol ~ +after 일 안의 가장 가까운 것"""
    best = None
    for k in keys:
        n = (D(k) - D(e)).days
        if -tol <= n <= max(tol, after) and (best is None or abs(n) < abs((D(best) - D(e)).days)):
            best = k
    return best


def collect(ciks):
    """[(cik, 이 날짜 뒤만)] → (통화, 분기 {끝: rec}, 연간 {끝: rec})"""
    Q, A, cur = {}, {}, None
    for n, ck in enumerate(ciks):
        fc = fund.facts(ck)
        c = fc.get('cur')
        if not c:
            continue
        if cur and c != cur:
            continue
        cur = cur or c
        lastq = max(Q) if Q else ''
        lasta = max(A) if A else ''
        part_q, part_a = {}, {}
        for k in FLOW + ['cogs', 'rnd', 'sga']:
            q, _ = quarters(_dur(fc, k, cur, 'max' if k == 'rev' else 'first'))
            _, a = quarters(_dur(fc, k, cur, 'max' if k == 'rev' else 'first', annual=True))
            for e, (s, v, src) in q.items():
                part_q.setdefault(e, {})[k] = abs(v) if k in ('div', 'buy', 'intexp') else v
            for e, (s, v) in a.items():
                part_a.setdefault(e, {})[k] = abs(v) if k in ('div', 'buy', 'intexp') else v
        for store in (part_q, part_a):
            for e, r in store.items():
                if 'oi' not in r and r.get('rev') is not None and all(r.get(x) is not None for x in ('cogs', 'rnd', 'sga')):
                    r['oi'] = r['rev'] - r['cogs'] - r['rnd'] - r['sga']
                    r['oi_est'] = 1
                for x in ('cogs', 'rnd', 'sga'):
                    r.pop(x, None)
                if 'ocf' in r:
                    r.setdefault('div', 0.0)
                    r.setdefault('buy', 0.0)
        merge_close(part_q, 8)
        merge_close(part_a, 14)
        ins = {k: _inst(fc, k, cur) for k in INST}
        sho = unit_fix(_inst(fc, 'sho'))
        dsh = unit_fix({e: v for (s, e), v in _dur(fc, 'dsh', 'shares').items() if 80 <= days(s, e) <= 380})
        for store in (part_q, part_a):
            for e, r in store.items():
                for k in INST:
                    kk = near(e, ins[k], 5)
                    if kk:
                        r[k] = ins[k][kk]
                if 'liab' not in r and r.get('la') is not None and r.get('eqt') is not None:
                    r['liab'] = r['la'] - r['eqt']
                r.pop('la', None)
                r.pop('eqt', None)
                kk = near(e, sho, 0, after=75)          # 표지 발행주식 수(보고서 제출 무렵)
                a, b = (sho[kk] if kk else None), dsh.get(e)
                if a and b and a / b < 0.75:      # 표지 수가 희석 가중평균보다 25% 넘게 적음 = 한 클래스만 적힘(버크셔 A주 등) → 가중평균(전 클래스)
                    a = None                       # (표지 수가 더 큰 쪽은 합병 등으로 주식이 늘어난 것 → 표지 수 그대로)
                if a or b:
                    r['sh'] = a or b
        for e, r in part_q.items():
            if n == 0 or e > lastq:
                Q[e] = r
        for e, r in part_a.items():
            if n == 0 or e > lasta:
                A[e] = r
    return cur, Q, A


def _prev(lst, i, want, tol):
    for j in range(i - 1, -1, -1):
        g = (D(lst[i]) - D(lst[j])).days
        if abs(g - want) <= tol:
            return lst[j]
        if g > want + tol:
            return None
    return None


def derive(cur, Q, A, px, sym):
    """px: 실제 종가 함수(날짜 → 달러) · 기간 표 줄 만들기"""
    mult = ADR.get(sym or '', 1.0) * SHARE_MULT.get(sym or '', 1.0)   # 버크셔 B주: 주식 수(A주 환산) × 1,500

    def build(store, ttm_mode):
        ks = sorted(store)
        out = []

        def ttm(i, k):
            vals, j = [], i
            for n in range(4):
                if j is None or store[ks[j]].get(k) is None:
                    return None
                vals.append(store[ks[j]][k])
                if n < 3:
                    p = _prev(ks, j, 91, 30)          # 61~121일 — 16주 분기(코스트코 4분기·크로거 1분기) 포함
                    j = ks.index(p) if p else None
            return sum(vals)
        for i, e in enumerate(ks):
            r = store[e]
            g = (lambda k: ttm(i, k)) if ttm_mode else (lambda k: r.get(k))
            o = {'end': e}
            for k in ('rev', 'oi', 'ni', 'ocf'):
                o[k] = r.get(k)
            if r.get('oi_est'):
                o['oi_est'] = 1
            p = _prev(ks, i, 365, 25)
            if r.get('rev') is not None and p and store[p].get('rev'):
                o['rev_g'] = (r['rev'] / store[p]['rev'] - 1) * 100
            if r.get('rev') and r.get('oi') is not None:
                o['opm'] = r['oi'] / r['rev'] * 100
            ni, oi, ie, dv, by = g('ni'), g('oi'), g('intexp'), g('div'), g('buy')
            if oi is not None and ie:
                o['icr'] = oi / ie
            if r.get('liab') is not None and r.get('eq'):
                o['debt'] = r['liab'] / r['eq'] * 100
            eq0 = store[p].get('eq') if p else None
            if ni is not None and r.get('eq'):
                avg = (r['eq'] + eq0) / 2 if eq0 else r['eq']
                if avg > 0:
                    o['roe'] = ni / avg * 100
            pr = px(e)
            fx = fx_at(cur, e) if cur != 'USD' else 1.0
            if pr and r.get('sh') and fx:
                mc = r['sh'] * pr / mult * fx          # 재무 통화 기준 시가총액
                o['mcap'] = mc
                if ni and ni > 0:
                    o['per'] = mc / ni
                if r.get('eq') and r['eq'] > 0:
                    o['pbr'] = mc / r['eq']
                if dv is not None:
                    o['dy'] = dv / mc * 100
            if ni and ni > 0 and dv is not None and by is not None:
                o['sr'] = (dv + by) / ni * 100
            if ttm_mode:
                for k, v in (('rev_ttm', g('rev')), ('oi_ttm', oi), ('ni_ttm', ni), ('div_ttm', dv), ('buy_ttm', by), ('ie_ttm', ie)):
                    if v is not None:
                        o[k] = v
                o['eq'], o['liab'], o['sh'] = r.get('eq'), r.get('liab'), r.get('sh')
            out.append(o)
        fix_units(out)
        return out
    return build(Q, True), build(A, False)


def fix_units(rows):
    """시가총액이 앞뒤 기간 중앙값의 1천·100만·10억 배 근처면 그 배수로 나눔(표지 주식 수 단위 오류) — per·pbr 도 같이, dy 는 곱함"""
    mc = [r.get('mcap') for r in rows]
    for i, v in enumerate(mc):
        if not v or v <= 0:
            continue
        nb = [x for j, x in enumerate(mc) if j != i and abs(j - i) <= 4 and x and x > 0]
        if len(nb) < 2:
            continue
        ratio = v / statistics.median(nb)
        f = next((f for f in FACT if 0.5 * f <= ratio <= 2 * f), None)
        if not f:
            f2 = next((f for f in FACT if 0.5 / f <= ratio <= 2 / f), None)
            f = 1 / f2 if f2 else None
        if f:
            r = rows[i]
            r['mcap'] /= f
            if r.get('sh'):
                r['sh'] /= f
            for k in ('per', 'pbr'):
                if r.get(k) is not None:
                    r[k] /= f
            if r.get('dy') is not None:
                r['dy'] *= f
