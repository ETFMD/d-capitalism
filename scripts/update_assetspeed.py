#!/usr/bin/env python3
"""
'자산 속도 시뮬레이터' 거시 자료 — data/assetspeed.json (그때 샀더라면 자료 갱신 워크플로에서 하루 2번 · 표준 라이브러리만)

  · M2 광의통화(평잔, 원계열, 월) — 한국은행 ECOS 101Y004(1986.01~2004.09) + 161Y006(2003.10~) 를
    겹치는 달(2003.10~2004.09)의 평균 비율로 이어 붙임 (통계 개편 전후의 수준 차이 보정) · 단위 십억원
  · 소비자물가지수(총지수, 2020=100, 월) — ECOS 901Y009
  · 주식·코인·금·은·아파트·환율 월봉은 data/whatif.json 을 그대로 씀 (이 파일에는 없음)
  · 받기에 실패하면 직전 값을 유지 (화면이 비지 않게) · 자료가 갑자기 짧아지면 저장하지 않음
"""
import datetime, json, os, sys, time, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUT = os.path.join(ROOT, 'assetspeed.json')
ECOS_KEY = 'RVTLLDCO3IW1YUKQSSPJ'          # 사이트·시세 봇이 쓰는 것과 같은 공개 인증키


def ecos_month(stat, item, t0, t1):
    """ECOS 월 통계 → {'YYYY-MM': 값} — 응답이 크면 연결이 끊기는 경우가 있어 5년씩 나눠 받음"""
    out, y = {}, int(t0[:4])
    while y <= int(t1[:4]):
        a = t0 if y == int(t0[:4]) else f'{y}01'
        b = min(t1, f'{y + 4}12')
        try:
            out.update(_ecos_chunk(stat, item, a, b))
        except ValueError as e:
            if '자료 없음' not in str(e):
                raise
        y += 5
    if not out:
        raise ValueError(f'ECOS {stat}/{item} 자료 없음')
    return out


def _ecos_chunk(stat, item, t0, t1):
    url = f'https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_KEY}/json/kr/1/100/{stat}/M/{t0}/{t1}/{item}'
    err = None
    for i in range(6):   # ECOS 는 가끔 연결을 끊음 → 넉넉히 다시 시도
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=40) as r:
                j = json.loads(r.read().decode('utf-8'))
            rows = (j.get('StatisticSearch') or {}).get('row') or []
            out = {}
            for x in rows:
                t, v = x.get('TIME', ''), x.get('DATA_VALUE')
                if len(t) == 6 and v not in (None, ''):
                    out[f'{t[:4]}-{t[4:]}'] = float(v)
            if not out:
                raise ValueError(f'ECOS {stat}/{item} 자료 없음: {str(j)[:200]}')
            return out
        except Exception as e:
            err = e
            if isinstance(e, ValueError) and '자료 없음' in str(e):
                break
            time.sleep(2 * (i + 1))
    raise err


def months(a, b):
    y, m = int(a[:4]), int(a[5:7])
    while f'{y:04d}-{m:02d}' <= b:
        yield f'{y:04d}-{m:02d}'
        m += 1
        if m > 12:
            y, m = y + 1, 1


def to_series(d):
    """{'YYYY-MM': v} → {'start', 'v'} (빈 달이 있으면 그 앞까지만)"""
    ks = sorted(d)
    v = []
    for k in months(ks[0], ks[-1]):
        if k not in d:
            break
        v.append(round(d[k], 3))
    return {'start': ks[0], 'v': v}


def build_m2(this_ym):
    old = ecos_month('101Y004', 'BBHA00', '198601', '200409')
    new = ecos_month('161Y006', 'BBHA00', '200310', this_ym)
    over = [k for k in new if k in old]
    if len(over) < 6:
        raise ValueError(f'M2 겹치는 달 부족 {len(over)}')
    ratio = sum(new[k] / old[k] for k in over) / len(over)
    merged = {k: v * ratio for k, v in old.items() if k < min(new)}
    merged.update(new)
    print(f'  M2 옛 계열 {min(old)}~{max(old)} · 새 계열 {min(new)}~{max(new)} · 이음 비율 {ratio:.4f} (겹친 {len(over)}달)')
    return to_series(merged)


def main():
    old = {}
    if os.path.isfile(OUT):
        with open(OUT, encoding='utf-8') as f:
            old = json.load(f)
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    this_ym = now.strftime('%Y%m')
    out = {'unit': 'month', 'src': {'m2': '한국은행 ECOS 101Y004·161Y006 M2(평잔, 원계열) · 십억원',
                                    'cpi': '한국은행 ECOS 901Y009 소비자물가지수(총지수, 2020=100)'}}
    for key, fn in (('m2', lambda: build_m2(this_ym)), ('cpi', lambda: to_series(ecos_month('901Y009', '0', '198501', this_ym)))):
        try:
            s = fn()
            if old.get(key) and len(s['v']) < len(old[key]['v']) * 0.9:
                raise ValueError(f'자료가 짧아짐 {len(old[key]["v"])} → {len(s["v"])}')
            out[key] = s
            print(f'  {key} {s["start"]}부터 {len(s["v"])}달 · 마지막 {s["v"][-1]}')
        except Exception as e:
            print(f'  {key} 실패(직전값 유지): {e}', file=sys.stderr)
            if old.get(key):
                out[key] = old[key]
    if not out.get('m2') or not out.get('cpi'):
        sys.exit('M2·물가 자료가 없습니다')
    body = {k: v for k, v in out.items()}
    if body == {k: v for k, v in old.items() if k != 'updated'}:
        print('  assetspeed.json: 변경 없음')
        return
    out['updated'] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  assetspeed.json 저장 ({os.path.getsize(OUT):,} bytes)')


if __name__ == '__main__':
    main()
