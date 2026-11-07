#!/usr/bin/env python3
"""[SEMIS] data/semis/*.json 자료 검사 — 갱신 워크플로(update-semis.yml)가 커밋 전에 돌림 · 회귀 테스트에서도 돌림

· 모양: 파일·칸·줄 수 · 날짜 순서 · 숫자 범위(PER·비중·계산 비중·예상치 비중)
· 기준일(frozen)까지의 일별 PER = 파이프라인 게시본 그대로(줄 수·첫날·지문) · 기준일 뒤 줄 = 하루 PER 변화가 가격 변화와 맞음(EPS 고정이라 PER 비율 = 바구니 가격 비율 근처)
· 기업 표: 30종목 · 비중 합 100 · 시가총액 합 = summary · 요약(summary.json) = 일별 PER 마지막 줄
표준 라이브러리만 · 실패하면 종료 코드 1"""
import datetime, hashlib, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIR = os.path.join(ROOT, 'data', 'semis')
N = 0
FAIL = []
# 기준일까지(2013-08-15 ~ 2026-11-06) 줄 수 · 마지막 줄 — 파이프라인 게시본(2026-11-07) 그대로여야 함
FROZEN = {'soxx': (3328, ['2026-11-06', 136.53, 25.9, 18.99, 15.69, 96.1, 100.0, '2026-09-30']),
          'soxq': (3328, ['2026-11-06', 73.82, 9390.25, 25.55, 18.76, 15.47, 100.0, 100.0, '2026-10-02', 'SOXQ'])}


def ok(cond, msg):
    global N
    N += 1
    if not cond:
        FAIL.append(msg)
    return cond


def load(n):
    with open(os.path.join(DIR, n), encoding='utf-8') as f:
        return json.load(f)


def isodate(s):
    try:
        datetime.date.fromisoformat(s)
        return True
    except Exception:
        return False


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def main():
    base = load('base.json')
    frozen = base['basis']
    summ = load('summary.json')
    ok(isodate(summ.get('basis', '')) and isodate(summ.get('eps_asof', '')), 'summary 기준일')
    for e in ('soxx', 'soxq'):
        pe, fin = load(e + '_pe.json'), load(e + '_fin.json')
        for o, n in ((pe, 'pe'), (fin, 'fin')):
            ok(isinstance(o.get('updated'), str) and o['updated'].endswith('Z'), f'{e}_{n} updated')
        cols = pe['c']
        rows = [dict(zip(cols, r)) for r in pe['r']]
        ok(all(len(r) == len(cols) for r in pe['r']), f'{e}_pe 칸 수')
        ds = [r['date'] for r in rows]
        ok(all(isodate(d) for d in ds) and ds == sorted(set(ds)), f'{e}_pe 날짜 순서·중복')
        ok(ds[0] == '2013-08-15', f'{e}_pe 첫날 {ds[0]}')
        fz = [r for r in pe['r'] if r[0] <= frozen]
        n0, last0 = FROZEN[e]
        ok(len(fz) == n0 and fz[-1] == last0, f'{e}_pe 기준일까지 게시본과 다름 ({len(fz)}줄 · {fz[-1] if fz else None})')
        pk = 'soxx' if e == 'soxx' else 'soxq'
        for r in rows:
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
                v = r.get(k)
                if v is not None and not ok(num(v) and 0 < v < 400, f'{e} {r["date"]} {k}={v}'):
                    break
            ok(num(r.get('cov')) and 0 < r['cov'] <= 100, f'{e} {r["date"]} cov={r.get("cov")}')
            ok(r.get('est') is None or (num(r['est']) and 0 <= r['est'] <= 100), f'{e} {r["date"]} est={r.get("est")}')
            ok(isodate(r.get('hold') or ''), f'{e} {r["date"]} hold')
        # 기준일 뒤: EPS 고정 → PER 은 가격만 따라 움직임 (하루 30% 넘게 움직이면 가격 자료 이상)
        aft = [r for r in rows if r['date'] > frozen]
        prev = next((r for r in reversed(rows) if r['date'] <= frozen), None)
        for r in aft:
            ok(r['hold'] == base['etf'][e.upper()]['pe']['hold'], f'{e} {r["date"]} 보유 기준 {r["hold"]}')
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
                if prev and prev.get(k) and r.get(k):
                    ok(abs(r[k] / prev[k] - 1) < 0.3, f'{e} {r["date"]} {k} 하루 변화 {prev[k]}→{r[k]}')
            if prev and prev.get(pk) and r.get(pk) and prev.get('pe_ttm') and r.get('pe_ttm'):   # PER 비율과 ETF 가격 비율이 크게 어긋나지 않음(바구니 ≈ ETF)
                ok(abs((r['pe_ttm'] / prev['pe_ttm']) / (r[pk] / prev[pk]) - 1) < 0.05, f'{e} {r["date"]} PER 변화와 {pk} 가격 변화가 어긋남')
            prev = r
        last = rows[-1]
        s = summ[e]
        ok(s['date'] == last['date'] and all(s[k] == last[k] for k in ('pe_ttm', 'pe_mix', 'pe_ntm')), f'{e} summary ≠ 마지막 줄')
        ok(pe.get('asof') == last['date'], f'{e}_pe asof {pe.get("asof")} ≠ {last["date"]}')
        # 기업 표
        cc = fin['c']['c']
        comp = [dict(zip(cc, r)) for r in fin['c']['r']]
        ok(len(comp) == 30 and len({c['sym'] for c in comp}) == 30, f'{e} 기업 수 {len(comp)}')
        w = [c['weight'] for c in comp if c.get('weight') is not None]
        ok(len(w) >= 28 and abs(sum(w) - 100) < 0.2, f'{e} 비중 합 {sum(w):.2f} ({len(w)}곳)')
        ok([c['weight'] or 0 for c in comp] == sorted([c['weight'] or 0 for c in comp], reverse=True), f'{e} 비중 순서')
        for c in comp:
            ok(num(c.get('px')) and c['px'] > 0 and num(c.get('mcap_usd')) and c['mcap_usd'] > 0, f'{e} {c["sym"]} 가격·시가총액')
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap'):
                ok(c.get(k) is None or (num(c[k]) and 0 < c[k] < 2000), f'{e} {c["sym"]} {k}={c.get(k)}')
            if c.get('pxd'):
                ok(c['pxd'] <= fin['asof'], f'{e} {c["sym"]} 가격 날짜 {c["pxd"]} > {fin["asof"]}')
        ok(abs(sum(c['mcap_usd'] for c in comp) - (s.get('mcap') or 0)) <= 2, f'{e} 시가총액 합 ≠ summary')
        syms = {c['sym'] for c in comp}
        for kk in ('q', 'a'):
            qc = fin[kk]['c']
            qr = [dict(zip(qc, r)) for r in fin[kk]['r']]
            ok(len(qr) > 300 and all(r['sym'] in syms for r in qr), f'{e} {kk} 줄 {len(qr)}')
            by = {}
            for r in qr:
                by.setdefault(r['sym'], []).append(r['end'])
            ok(all(v == sorted(v) and len(v) == len(set(v)) for v in by.values()), f'{e} {kk} 기간 순서')
            ok(set(by) <= syms and len(by) >= 29, f'{e} {kk} 기업 {len(by)}')   # 세레브라스(2026-05 상장)는 연간 자료가 아직 없음
            mc = {}
            for r in qr:
                if r['mcap'] and r['mcap'] > 0:
                    mc.setdefault(r['sym'], []).append((r['end'], r['mcap']))
            for sym, v in mc.items():   # 시가총액 단위 오류(XBRL 발행주식 수 1천·100만 배) 다시 생기지 않게 — scripts/semis/units.py
                v.sort()
                for i, (d, x) in enumerate(v):
                    nb = sorted(y for j, (_, y) in enumerate(v) if j != i and abs(j - i) <= 4)
                    if len(nb) >= 2:
                        m = nb[len(nb) // 2] if len(nb) % 2 else (nb[len(nb) // 2 - 1] + nb[len(nb) // 2]) / 2
                        ok(x / m < 300, f'{e} {kk} {sym} {d} 시가총액이 앞뒤의 {x / m:.0f}배 (단위 오류?)')
        ok(fin['fx'].get('pair') == 'USD/KRW' and num(fin['fx'].get('rate')) and 900 < fin['fx']['rate'] < 2500, f'{e} 환율 {fin["fx"]}')
        ok(isinstance(fin.get('stale'), list), f'{e} stale')
    ref = load('sox_fwd_ref.json')
    ok(len(ref['r']) > 1000 and ref['r'][0][0] == '2002-01-11', 'sox_fwd_ref 줄')
    print(f'semis_test: 검사 {N}개 · 실패 {len(FAIL)}개')
    for m in FAIL[:30]:
        print('  ✗', m)
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
