#!/usr/bin/env python3
"""[STRATSIM] 투자전략 시뮬레이터 가격 자료 갱신 — data/stratsim/prices.csv · nfci.csv · updated.txt

· 일봉: 야후 파이낸스 수정주가(분할·분배금 반영) QQQ·TQQQ·SPY·QLD·SSO·SPXL·SQQQ
  - 각 ETF 상장일부터는 야후 값으로 바꿔 씀(야후가 고친 지난 값도 따라감)
  - 상장 전(지수·금리로 재현한 합성 구간)은 파일에 있는 값을 그대로 두되, 야후가 분배금으로 지난 값을
    다시 조정하면 상장 첫날에서 끊기지 않게 합성 구간 전체를 같은 비율로 맞춤
  - 장중에 돌면 오늘의 아직 끝나지 않은 일봉도 넣음(화면이 '아직 끝나지 않은 값'으로 표시) — 마감 뒤 다음 실행이 확정값으로 바꿈
· NFCI: 미국 시카고 연은 금융 여건 지수(FRED, 주간) — 실패해도 가격 갱신은 그대로
· 검사: 7종목이 모두 있는 날만 새로 붙임 · 값은 양수·유한 · 상장 첫날이 예상과 다르거나 행이 줄거나
  하루 변동이 ±70% 를 넘으면(분할 미반영 등) 아무것도 쓰지 않고 멈춤
· 바뀔 때만 씀 — 값 차이가 상대 5e-6 이하면 예전 줄 글자를 그대로 둠(야후 값의 소수 끝자리 흔들림으로 매번 수천 줄이 바뀌지 않게)
· updated.txt = 마지막으로 자료가 바뀐 시각(UTC) — 화면 위쪽 '가격 자료 갱신' 시각
사용: python3 scripts/update_stratsim.py   (종료 코드 0 = 정상(바뀐 것 없음 포함), 1 = 실패)
"""
import csv, datetime, io, json, math, os, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DIR = os.environ.get('STRATSIM_DIR') or os.path.join(ROOT, 'data', 'stratsim')   # 시험할 때만 다른 폴더
PRICES, NFCI, STAMP = os.path.join(DIR, 'prices.csv'), os.path.join(DIR, 'nfci.csv'), os.path.join(DIR, 'updated.txt')
COLS = ['qqq', 'tqqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq']          # 파일 열 순서 (date 다음)
IPO = {'qqq': '1999-03-10', 'tqqq': '2010-02-11', 'spy': '1993-01-29', 'qld': '2006-06-21', 'sso': '2006-06-21', 'spxl': '2008-11-05', 'sqqq': '2010-02-11'}
NOISE = 5e-6
MAX_MOVE = 0.70
# 야후는 같은 요청이라도 UA 에 따라 429 로 막을 때가 있어 짧은 UA → 브라우저 UA 를 번갈아 시도
UAS = ('Mozilla/5.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
UA_FRED = 'd-capitalism-data/1.0 (+https://d-capitalism.com/)'   # FRED 는 'Mozilla/5.0' 만 있는 요청을 끊음
ET = ZoneInfo('America/New_York')


def get(url, tries=3, ua=None):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua or UAS[i % len(UAS)], 'Accept': 'application/json,text/csv,*/*'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:      # 일시 오류는 잠시 뒤 다시
            err = e
            time.sleep(3 * (i + 1))
    raise err


def yahoo_daily(sym):
    """야후 v8 차트 → {YYYY-MM-DD: 수정 종가} (거래소 시간대 날짜)"""
    now = int(time.time()) + 86400
    q = f'period1=0&period2={now}&interval=1d&events=div%7Csplit&includeAdjustedClose=true&includePrePost=false'
    err = None
    for host in ('query1', 'query2'):
        try:
            d = json.loads(get(f'https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{q}'))
            res = ((d.get('chart') or {}).get('result') or [None])[0]
            if not res:
                raise RuntimeError(str((d.get('chart') or {}).get('error')))
            tz = ZoneInfo((res.get('meta') or {}).get('exchangeTimezoneName') or 'America/New_York')
            ts = res.get('timestamp') or []
            adj = (((res.get('indicators') or {}).get('adjclose') or [{}])[0] or {}).get('adjclose') or []
            out = {}
            for t, v in zip(ts, adj):
                if v is None or not math.isfinite(v) or v <= 0:
                    continue
                out[datetime.datetime.fromtimestamp(t, tz).strftime('%Y-%m-%d')] = float(v)
            if len(out) < 100:
                raise RuntimeError(f'{sym}: 일봉이 너무 적음 ({len(out)})')
            return out
        except Exception as e:
            err = e
    raise err


def fmt(v):
    return '%.12g' % v


def read_prices():
    rows = {}
    with open(PRICES, encoding='utf-8') as f:
        rd = csv.reader(f)
        head = next(rd)
        if head != ['date'] + COLS:
            raise SystemExit(f'prices.csv 머리줄이 예상과 다름: {head}')
        for r in rd:
            if len(r) != 1 + len(COLS):
                raise SystemExit(f'prices.csv 칸 수 이상: {r}')
            rows[f'{r[0][:4]}-{r[0][4:6]}-{r[0][6:]}'] = r[1:]
    return rows


def update_prices():
    old = read_prices()
    dates_old = sorted(old)
    new_vals = {d: [float(x) for x in old[d]] for d in dates_old}
    real = {}
    for i, c in enumerate(COLS):
        real[c] = yahoo_daily(c.upper())
        first = min(real[c])
        if abs((datetime.date.fromisoformat(first) - datetime.date.fromisoformat(IPO[c])).days) > 5:
            raise SystemExit(f'{c}: 야후 첫 일봉 {first} 가 상장일 {IPO[c]} 과 다름 — 자료가 잘렸을 수 있어 멈춤')
        # 합성 구간을 상장 첫날에서 이어지게 (야후가 분배금으로 지난 값을 다시 조정한 만큼)
        k = 1.0
        if first in old and real[c][first] > 0:
            k = real[c][first] / float(old[first][i])
            if abs(k - 1) <= NOISE:
                k = 1.0
        for d in dates_old:
            if d < first:
                new_vals[d][i] = float(old[d][i]) * k
            elif d in real[c]:
                new_vals[d][i] = real[c][d]
        if k != 1.0:
            print(f'  {c}: 상장 전 합성 구간을 {k:.8f} 배로 맞춤 (상장 첫날 {first})')
    # 새 날: 7종목이 모두 있는 날만
    last = dates_old[-1]
    added = []
    for d in sorted(set.intersection(*[set(real[c]) for c in COLS])):
        if d > last:
            new_vals[d] = [real[c][d] for c in COLS]
            added.append(d)
    dates = sorted(new_vals)
    # 검사
    for d in dates:
        for v in new_vals[d]:
            if not (math.isfinite(v) and v > 0):
                raise SystemExit(f'{d}: 값 이상 {new_vals[d]}')
    for j in range(max(1, len(dates_old) - 5), len(dates)):
        a, b = new_vals[dates[j - 1]], new_vals[dates[j]]
        for i, c in enumerate(COLS):
            if abs(b[i] / a[i] - 1) > MAX_MOVE:
                raise SystemExit(f'{dates[j]} {c}: 하루 변동 {b[i] / a[i] - 1:+.1%} — 분할 미반영 등 의심, 멈춤')
    if len(dates) < len(dates_old):
        raise SystemExit('행 수가 줄어 멈춤')
    # 쓰기 (차이가 작으면 예전 글자 그대로)
    out = io.StringIO()
    out.write('date,' + ','.join(COLS) + '\n')
    changed = 0
    for d in dates:
        cells = []
        for i, v in enumerate(new_vals[d]):
            o = old.get(d)
            if o is not None:
                ov = float(o[i])
                if ov == v or abs(v - ov) <= NOISE * abs(ov):
                    cells.append(o[i])
                    continue
                changed += 1
            cells.append(fmt(v))
        out.write(d.replace('-', '') + ',' + ','.join(cells) + '\n')
    text = out.getvalue()
    cur = open(PRICES, encoding='utf-8').read()
    if text == cur:
        print(f'prices.csv: 바뀐 것 없음 ({len(dates)}일, 마지막 {dates[-1]})')
        return False
    with open(PRICES + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(PRICES + '.tmp', PRICES)
    print(f'prices.csv: 저장 — 새 날 {len(added)}개 {added[-3:]} · 바뀐 값 {changed}개 · 마지막 {dates[-1]}')
    return True


def update_nfci():
    raw = get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=NFCI', ua=UA_FRED).decode('utf-8', 'replace')
    rows = []
    for ln in raw.splitlines()[1:]:
        p = ln.strip().split(',')
        if len(p) != 2 or p[1] in ('', '.'):
            continue
        v = float(p[1])
        if not (-10 < v < 20):
            raise ValueError(f'NFCI 값 이상: {ln}')
        rows.append((p[0].replace('-', ''), p[1]))
    if len(rows) < 2000 or rows != sorted(rows):
        raise ValueError(f'NFCI 행 이상 ({len(rows)})')
    old = open(NFCI, encoding='utf-8').read() if os.path.exists(NFCI) else ''
    if old and len(rows) < old.count('\n') - 1:
        raise ValueError('NFCI 행 수가 줄어듦')
    text = 'date,nfci\n' + ''.join(f'{d},{v}\n' for d, v in rows)
    if text == old:
        print(f'nfci.csv: 바뀐 것 없음 (마지막 {rows[-1][0]})')
        return False
    with open(NFCI + '.tmp', 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(NFCI + '.tmp', NFCI)
    print(f'nfci.csv: 저장 — {len(rows)}주, 마지막 {rows[-1][0]}')
    return True


def main():
    ch = update_prices()
    try:
        ch = update_nfci() or ch
    except Exception as e:
        print(f'nfci.csv: FRED 실패 — 그대로 둠 ({e})')
    if ch:
        with open(STAMP, 'w', encoding='utf-8', newline='\n') as f:
            f.write(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + '\n')
        print('updated.txt: 갱신')


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f'실패: {e!r}')
        sys.exit(1)
