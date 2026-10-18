#!/usr/bin/env python3
"""
'자산 속도 시뮬레이터' 거시 자료 — data/assetspeed.json (그때 샀더라면 자료 갱신 워크플로에서 하루 2번 · 표준 라이브러리만)

  · M2 광의통화(평잔, 원계열, 월) — 한국은행 ECOS 101Y004(1986.01~2004.09) + 161Y006(2003.10~) 를
    겹치는 달(2003.10~2004.09)의 평균 비율로 이어 붙임 (통계 개편 전후의 수준 차이 보정) · 단위 십억원
  · 소비자물가지수(총지수, 2020=100, 월) — ECOS 901Y009
  · 주식·코인·금·은·아파트·환율 월봉은 data/whatif.json 을 그대로 씀 (이 파일에는 없음)
  · 받기에 실패하면 직전 값을 유지 (화면이 비지 않게) · 자료가 갑자기 짧아지면 저장하지 않음
  · pre — '상장 전 가상 데이터' 옵션용 (시세 자료가 시작되기 전 구간을 이어 붙일 재료 · 화면이 첫 실제 값에 비율로 맞춰 앞에 붙임)
      kb     KB 아파트 매매가격지수(서울, 월) — ECOS 901Y062/P63ACA (1986.01~) → 서울·강남 아파트 2006년 전
      gold   금 국제 가격(달러/트로이온스, 월평균) — 세계은행 Pink Sheet (1981.01~) → 금 선물 2000.09 전
      silver 은 국제 가격(달러/트로이온스, 월평균) — 세계은행 Pink Sheet (1981.01~) → 은 선물 2000.09 전
      btc    비트코인 일별 가격(달러) — Coin Metrics 공개 자료 (2010.07.18~2014.12) → 야후 BTC-USD 2014.09 전
      eth    이더리움 일별 가격(달러) — Coin Metrics 공개 자료 (2015.08.08~2017.12) → 야후 ETH-USD 2017.11 전
"""
import datetime, io, json, os, re, sys, time, urllib.request, zipfile, xml.etree.ElementTree as ET

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


def get(url, timeout=60, tries=4):
    err = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            err = e
            time.sleep(3 * (i + 1))
    raise err


def xlsx_rows(blob, sheet):
    """표준 라이브러리만으로 .xlsx 한 시트 → [[셀 값, ...], ...] (문자열·숫자)"""
    z = zipfile.ZipFile(io.BytesIO(blob))
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
          'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rid = next(x.get('{%s}id' % ns['r']) for x in wb.find('m:sheets', ns) if x.get('name') == sheet)
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = next(x.get('Target') for x in rels if x.get('Id') == rid).lstrip('/')
    target = target if target.startswith('xl/') else 'xl/' + target
    out = []
    for row in ET.fromstring(z.read(target)).iter('{%s}row' % ns['m']):
        cells = {}
        for c in row.findall('m:c', ns):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            n = 0
            for ch in col:
                n = n * 26 + ord(ch) - 64
            v = c.find('m:v', ns)
            if v is None:
                isv = c.find('m:is', ns)
                val = ''.join(t.text or '' for t in isv.iter('{%s}t' % ns['m'])) if isv is not None else None
            elif c.get('t') == 's':
                val = ss[int(v.text)]
            else:
                try:
                    val = float(v.text)
                except (TypeError, ValueError):
                    val = v.text
            cells[n - 1] = val
        out.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
    return out


def wb_metals():
    """세계은행 Pink Sheet 월별 가격(명목 달러) → 금·은 {'start', 'v'} (1981.01~) — 파일 주소가 달마다 바뀌어 안내 쪽에서 찾음"""
    page = get('https://www.worldbank.org/en/research/commodity-markets').decode('utf-8', 'replace')
    m = re.search(r'https://thedocs\.worldbank\.org/[^"\']*CMO-Historical-Data-Monthly\.xlsx', page)
    if not m:
        raise ValueError('Pink Sheet 월별 파일 주소를 찾지 못함')
    rows = xlsx_rows(get(m.group(0), timeout=120), 'Monthly Prices')
    head = next(r for r in rows if r and 'Gold' in r and 'Silver' in r)
    gi, si = head.index('Gold'), head.index('Silver')
    gold, silver = {}, {}
    for r in rows:
        if r and isinstance(r[0], str) and re.fullmatch(r'\d{4}M\d{2}', r[0]) and r[0] >= '1981M01':
            k = r[0][:4] + '-' + r[0][5:]
            if len(r) > gi and isinstance(r[gi], float) and r[gi] > 0:
                gold[k] = r[gi]
            if len(r) > si and isinstance(r[si], float) and r[si] > 0:
                silver[k] = r[si]
    if len(gold) < 200 or len(silver) < 200:
        raise ValueError(f'Pink Sheet 금·은 자료 부족 {len(gold)}·{len(silver)}')
    return to_series(gold), to_series(silver)


def coin(sym, until):
    """Coin Metrics 공개 CSV(github.com/coinmetrics/data) PriceUSD → {'d0': 첫날, 'v': 날마다 값} (빈 날은 직전 값)"""
    txt = get(f'https://raw.githubusercontent.com/coinmetrics/data/master/csv/{sym}.csv', timeout=120).decode('utf-8')
    lines = txt.splitlines()
    head = lines[0].split(',')
    ti, pi = head.index('time'), head.index('PriceUSD')
    d = {}
    for ln in lines[1:]:
        f = ln.split(',')
        if len(f) > pi and f[pi] and f[ti][:10] <= until:
            try:
                p = float(f[pi])
            except ValueError:
                continue
            if p > 0:
                d[f[ti][:10]] = p
    if len(d) < 300:
        raise ValueError(f'{sym} 자료 부족 {len(d)}')
    ks = sorted(d)
    day = datetime.date.fromisoformat(ks[0])
    end = datetime.date.fromisoformat(ks[-1])
    v, last = [], None
    while day <= end:
        last = d.get(day.isoformat(), last)
        v.append(float(f'{last:.6g}'))
        day += datetime.timedelta(days=1)
    return {'d0': ks[0], 'v': v}


def build_pre(this_ym, old):
    pre, prev = {}, (old or {}).get('pre') or {}

    def keep(k, fn, n_of):
        try:
            x = fn()
            if prev.get(k) and n_of(x) < n_of(prev[k]) * 0.9:
                raise ValueError(f'자료가 짧아짐 {n_of(prev[k])} → {n_of(x)}')
            pre[k] = x
            print(f'  pre.{k} {x.get("start") or x.get("d0")}부터 {n_of(x)}개')
        except Exception as e:
            print(f'  pre.{k} 실패(직전값 유지): {e}', file=sys.stderr)
            if prev.get(k):
                pre[k] = prev[k]
    n = lambda x: len(x['v'])
    keep('kb', lambda: to_series(ecos_month('901Y062', 'P63ACA', '198601', this_ym)), n)
    metals = {}

    def metal(k):
        if not metals:
            metals['gold'], metals['silver'] = wb_metals()
        return metals[k]
    keep('gold', lambda: metal('gold'), n)
    keep('silver', lambda: metal('silver'), n)
    keep('btc', lambda: coin('btc', '2014-12-31'), n)
    keep('eth', lambda: coin('eth', '2017-12-31'), n)
    return pre


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
    out['src']['pre'] = ('상장 전 가상 데이터 재료 — KB 아파트 매매가격지수(서울, 한국은행 ECOS 901Y062) · 금·은 월평균(세계은행 Pink Sheet) · '
                         '비트코인·이더리움 일별(Coin Metrics 공개 자료)')
    out['pre'] = build_pre(this_ym, old)
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
