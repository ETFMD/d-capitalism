#!/usr/bin/env python3
"""[SEMIS] 분기·연간 시가총액의 단위 오류 바로잡기 (2026-11-08)

SEC XBRL 표지(dei)의 발행주식 수가 1,000배·100만배로 잘못 들어간 분기가 있어(예: AMD 2012-06 · QCOM 2011-03·09 · ON 2012-06·09·2013-03),
그 분기 시가총액(= 종가 × 발행주식 수)이 앞뒤 분기보다 정확히 1천·100만·10억 배 가까이 큼 → 화면 차트가 한 점만 치솟아 나머지가 안 보임.
· 찾는 법: 같은 기업 앞뒤(최대 4개씩) 기간 시가총액 중앙값과의 비율이 10^3·10^6·10^9 의 0.5~2배 안이면 그 배수로 나눔
· 함께 고치는 값: mcap ÷ f · pbr ÷ f · per ÷ f (모두 시가총액에 비례) · dy × f (배당 ÷ 시가총액)
· 쓰는 곳: scripts/semis/extract_base.py (기준 자료 만들 때) · 한 번 고친 자료는 update_semis.py 가 그대로 이어 씀(분기·연간 표는 건드리지 않음)
  python3 scripts/semis/units.py data/semis   → 이미 만든 *_fin.json 을 제자리에서 고치고 고친 줄을 출력"""
import json, os, statistics, sys

FACT = (1e3, 1e6, 1e9)


def fix(cols, rows):
    """rows: 줄 배열(cols 순서) — 제자리에서 고치고 [(sym, end, 배수, 고치기 전 시가총액)] 돌려줌"""
    ix = {c: i for i, c in enumerate(cols)}
    by = {}
    for r in rows:
        by.setdefault(r[ix['sym']], []).append(r)
    out = []
    for sym, rs in by.items():
        rs.sort(key=lambda r: r[ix['end']])
        mc = [r[ix['mcap']] for r in rs]
        bad = set()
        for i, v in enumerate(mc):
            if v is None or v <= 0:
                continue
            nb = [x for j, x in enumerate(mc) if j != i and abs(j - i) <= 4 and x is not None and x > 0]
            if len(nb) < 2:
                continue
            ratio = v / statistics.median(nb)
            f = next((f for f in FACT if 0.5 * f <= ratio <= 2 * f), None)
            if f:
                bad.add((i, f))
        for i, f in sorted(bad):
            r = rs[i]
            out.append((sym, r[ix['end']], int(f), r[ix['mcap']]))
            r[ix['mcap']] = r[ix['mcap']] / f
            for k in ('pbr', 'per'):
                if r[ix[k]] is not None:
                    r[ix[k]] = round(r[ix[k]] / f, 2)
            if r[ix['dy']] is not None:
                r[ix['dy']] = round(r[ix['dy']] * f, 3)
    return out


def main(d):
    for e in ('soxx', 'soxq'):
        p = os.path.join(d, e + '_fin.json')
        with open(p, encoding='utf-8') as f:
            o = json.load(f)
        ch = []
        for kk in ('q', 'a'):
            for c in fix(o[kk]['c'], o[kk]['r']):
                ch.append((kk,) + c)
        for c in ch:
            print(e, *c)
        if ch:
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(o, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main(sys.argv[1])
