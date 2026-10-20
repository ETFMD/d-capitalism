#!/usr/bin/env python3
"""
TQQQ 장중 흐름 자료 — data/stratsim/intraday-5m.csv · intraday-1m.csv · intraday-updated.txt
(표준 라이브러리만 사용 · GitHub Actions 에서 실행 · 화면: src/ssintra/*.js → /tqqq-intraday/)

가져오는 곳
  · 야후 파이낸스 v8 chart (query1 → 실패하면 query2) — TQQQ 5분봉 range=60d · 1분봉 range=5d, 정규장만(includePrePost=false)
  · 처음 기록(2023-09-25 ~ 2026-10-19)은 networthcast 가 공개한 장중 기록(tqqq-5m.tsv · tqqq-today-1m.tsv)을
    아래 형식으로 바꿔 넣은 것 — 같은 형식의 TSV 는 --import-tsv 로 다시 합칠 수 있음 (60일 넘게 못 받아 생긴 공백 메우기 등)

파일 형식 (CSV · 한 줄 = 한 거래일 · 날짜순)
  1행   # tqqq-intraday bar=5m from=09:30 tz=America/New_York split=2025-11-20
          bar = 봉 길이 · from = 첫 봉 시작 시각(뉴욕) · split = 이 날짜까지 일어난 주식 분할이 가격에 반영돼 있음
  2행   date,open,close...
  3행~  20230925,17.66,17.58,17.72,...
          날짜(YYYYMMDD, 뉴욕 날짜), 그날 첫 봉의 시가, 그다음부터 봉마다 종가 — k번째 종가 칸 = 09:30 + k × 봉 길이에 시작한 봉
          · 빈칸 = 그 봉 없음 · 마지막 봉 뒤로는 칸이 없음 (조기 폐장일은 12:55 봉에서 끝나 줄이 짧음)
          · 가격은 달러, 소수 넷째 자리까지 (끝의 0 은 뺌) · 화면이 쓰지 않는 고가·저가·거래량은 저장하지 않음
  intraday-5m.csv     5분봉 (09:30 ~ 15:55 에 시작한 봉, 하루 최대 78칸) — 계속 쌓이는 기록
  intraday-1m.csv     1분봉 (09:30 ~ 15:59 에 시작한 봉, 최대 390칸) — 가장 최근 거래일 하나 (장중이면 지금까지)
  intraday-updated.txt  위 두 파일 중 하나라도 바뀐 마지막 시각 (UTC, 예: 2026-10-20T14:35:12Z)

합치는 규칙
  · 새로 받은 봉이 같은 자리의 저장된 봉을 덮어씀 (새 자료 우선) · 받은 범위 밖의 저장된 봉은 그대로 둠
  · 그날 시가 = 그날 가장 이른 봉의 시가 · 정규장 판단은 뉴욕 시각(zoneinfo, 서머타임 반영) + 야후가 알려 주는 그날 정규장 시간
    (조기 폐장일은 13:00 전 봉까지만 남음)
  · 장중 응답 끝에 붙는 '지금 가격' 점(봉 경계가 아닌 시각)은 그 시각이 속한 봉의 종가로 넣음
  · 야후 분할 정보(events=split)에 split= 날짜보다 새 분할이 있으면, 그 날짜 전의 저장된 가격을 분할 비율로 나눠 맞춘 뒤 합침
  · 1분봉은 받은 마지막 거래일이 저장된 날과 같으면 봉 단위로 합치고, 더 새 날이면 바꿈

파일을 하나도 쓰지 않고 실패(종료 코드 1)로 끝나는 경우
  · 받기 실패 · 빈 자료 · 시각이 거꾸로 · 0 이하이거나 터무니없는 가격 (봉 사이 −40% · +67% 넘게, 전일 종가 대비 시가 −45% · +80% 넘게)
  · 저장된 봉과 겹치는 구간의 가격 수준이 다름 (중앙값 0.5% 넘게 — 반영 안 된 분할 등) · 겹치는 구간이 아예 없음 (공백)
  · 합친 결과의 봉·날짜 수가 전보다 적음 · 1분봉 날짜가 저장된 날보다 옛날 · 같은 날 1분봉과 5분봉 가격이 다름

종료 코드  0 = 갱신함 또는 바뀐 것 없음 · 1 = 실패 (파일은 그대로)
사용  python3 scripts/update_stratsim_intraday.py [--dry-run]
      python3 scripts/update_stratsim_intraday.py --no-fetch --import-tsv tqqq-5m.tsv --import-tsv-1m tqqq-today-1m.tsv --basis 2025-11-20
"""
import argparse, datetime, json, os, statistics, sys, time, urllib.parse, urllib.request
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
TICKER = 'TQQQ'
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'stratsim')
# 야후는 같은 요청이라도 UA 에 따라 429 로 막을 때가 있어 짧은 UA → 브라우저 UA 를 번갈아 시도 (scripts/update_stratsim.py 와 같음)
UAS = ('Mozilla/5.0',
       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
OPEN_MIN = 9 * 60 + 30                                   # 09:30 뉴욕
KIND = {   # 봉 길이(분) → 파일 · 마지막으로 남기는 봉의 시작 시각 · 야후 요청
    5: {'file': 'intraday-5m.csv', 'last': 15 * 60 + 55, 'query': 'range=60d&interval=5m&includePrePost=false&events=split'},
    1: {'file': 'intraday-1m.csv', 'last': 15 * 60 + 59, 'query': 'range=5d&interval=1m&includePrePost=false&events=split'},
}
UPDATED_FILE = 'intraday-updated.txt'
Q4 = Decimal('0.0001')
GAP_LO, GAP_HI = 0.55, 1.8          # 전일 종가 → 시가 (−45% · +80%)
STEP_LO, STEP_HI = 0.6, 1 / 0.6     # 봉 → 다음 봉 (−40% · +67%)
LEVEL_TOL = 0.005                   # 겹치는 구간 가격 수준 (중앙값)
DIFF_TOL, DIFF_SHARE = 0.01, 0.05   # 겹치는 봉 중 1% 넘게 다른 봉이 5% 넘으면 이상


class Broken(Exception):
    """자료가 이상함 → 아무 파일도 쓰지 않음"""


class Day:
    __slots__ = ('open', 'closes')

    def __init__(self, open_, closes):
        self.open = open_          # Decimal — 그날 가장 이른 봉의 시가
        self.closes = closes       # {칸 번호: Decimal 종가}

    def copy(self):
        return Day(self.open, dict(self.closes))


# ── 파일 읽기·쓰기 ──────────────────────────────────────────────

def dec(s, where):
    try:
        v = Decimal(s)
    except InvalidOperation:
        raise Broken(f'{where}: 숫자가 아님 ({s!r})')
    if not v.is_finite() or v <= 0:
        raise Broken(f'{where}: 0 이하이거나 잘못된 가격 ({s!r})')
    return v


def fmt_price(v):
    return format(v.quantize(Q4).normalize(), 'f')


def read_store(path, bar):
    """CSV → (머리줄 정보 dict, {YYYYMMDD: Day}) · 파일이 없으면 빈 기록"""
    meta, days = {}, {}
    if not os.path.exists(path):
        return meta, days
    prev = None
    with open(path, encoding='utf-8') as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip('\n')
            if line.startswith('#'):
                meta.update(tok.split('=', 1) for tok in line[1:].split() if '=' in tok)
                continue
            if not line or not line[0].isdigit():
                continue
            c = line.split(',')
            date = c[0]
            if len(date) != 8 or not date.isdigit() or len(c) < 3:
                raise Broken(f'{os.path.basename(path)} {n}행: 형식이 다름')
            if prev is not None and date <= prev:
                raise Broken(f'{os.path.basename(path)} {n}행: 날짜 순서가 다름')
            prev = date
            closes = {k: dec(s, f'{date} {k}칸') for k, s in enumerate(c[2:]) if s != ''}
            if not closes:
                raise Broken(f'{os.path.basename(path)} {n}행: 봉이 없음')
            days[date] = Day(dec(c[1], f'{date} 시가'), closes)
    if meta.get('bar') not in (None, f'{bar}m'):
        raise Broken(f'{os.path.basename(path)}: 봉 길이가 다름 ({meta.get("bar")})')
    return meta, days


def store_text(days, bar, basis):
    out = [f'# tqqq-intraday bar={bar}m from=09:30 tz=America/New_York split={basis}', 'date,open,close...']
    for date in sorted(days):
        d = days[date]
        last = max(d.closes)
        cells = [fmt_price(d.closes[k]) if k in d.closes else '' for k in range(last + 1)]
        out.append(date + ',' + fmt_price(d.open) + ',' + ','.join(cells))
    return '\n'.join(out) + '\n'


def read_text(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path, text):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    os.replace(tmp, path)


# ── 야후 ──────────────────────────────────────────────────────

def get_json(url, tries=3):
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UAS[i % len(UAS)], 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:      # noqa: BLE001 — 다시 시도한 뒤 마지막 오류를 올림
            err = e
            time.sleep(2 * (i + 1))
    raise err


def yahoo_chart(query):
    err = None
    for host in ('query1', 'query2'):
        try:
            d = get_json(f'https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(TICKER)}?{query}')
            res = ((d.get('chart') or {}).get('result') or [None])[0]
            if res:
                return res
            err = RuntimeError(str((d.get('chart') or {}).get('error')))
        except Exception as e:      # noqa: BLE001
            err = e
    raise RuntimeError(f'야후 받기 실패: {err}')


def regular_periods(meta):
    """야후가 알려 주는 날마다의 정규장 [시작, 끝) (유닉스 초) — 뉴욕 날짜 → (시작, 끝)"""
    tp = meta.get('tradingPeriods')
    if isinstance(tp, dict):
        tp = tp.get('regular')
    out = {}
    for row in tp or []:
        for p in (row if isinstance(row, list) else [row]):
            if isinstance(p, dict) and isinstance(p.get('start'), (int, float)) and isinstance(p.get('end'), (int, float)):
                out[datetime.datetime.fromtimestamp(p['start'], NY).strftime('%Y%m%d')] = (p['start'], p['end'])
    return out


def parse_chart(res, bar):
    """야후 응답 → {YYYYMMDD: Day} (정규장 봉만) · 분할 [(YYYYMMDD, 분자, 분모)]"""
    ts = res.get('timestamp') or []
    q = ((res.get('indicators') or {}).get('quote') or [{}])[0]
    op, cl = q.get('open') or [], q.get('close') or []
    if not ts:
        raise Broken(f'{bar}분봉: 빈 자료')
    if len(op) != len(ts) or len(cl) != len(ts):
        raise Broken(f'{bar}분봉: 시각·가격 개수가 다름')
    periods = regular_periods(res.get('meta') or {})
    last_start = KIND[bar]['last']
    bars, skipped = {}, 0
    for i, t in enumerate(ts):
        if i and t <= ts[i - 1]:
            raise Broken(f'{bar}분봉: 시각 순서가 거꾸로 ({t})')
        o, c = op[i], cl[i]
        if o is None or c is None:
            continue
        if not (isinstance(o, (int, float)) and isinstance(c, (int, float))) or not (0 < o < 1e6 and 0 < c < 1e6):
            skipped += 1
            continue
        dt = datetime.datetime.fromtimestamp(t, NY)
        live = dt.second != 0 or dt.minute % bar != 0          # 장중 '지금 가격' 점
        if live and i != len(ts) - 1:
            skipped += 1
            continue
        start = dt.replace(minute=dt.minute - dt.minute % bar, second=0, microsecond=0)
        minute = start.hour * 60 + start.minute
        if minute < OPEN_MIN or minute > last_start:
            continue
        date = start.strftime('%Y%m%d')
        p = periods.get(date)
        if p and not (p[0] <= start.timestamp() < p[1]):
            continue
        key = (date, (minute - OPEN_MIN) // bar)
        oc, cc = Decimal(repr(round(o, 4))), Decimal(repr(round(c, 4)))
        if live and key in bars:
            bars[key][1] = cc                                 # 진행 중인 봉의 종가 = 지금 가격
        else:
            bars[key] = [oc, cc]
    if skipped:
        print(f'  {bar}분봉: 이상한 점 {skipped}개는 뺌')
    days = {}
    for (date, slot), (o, c) in sorted(bars.items()):
        if date not in days:
            days[date] = Day(o, {})
        days[date].closes[slot] = c
    if not days:
        raise Broken(f'{bar}분봉: 정규장 봉이 없음')
    splits = []
    for s in ((res.get('events') or {}).get('splits') or {}).values():
        try:
            num, den = Decimal(str(s['numerator'])), Decimal(str(s['denominator']))
            when = datetime.datetime.fromtimestamp(int(s['date']), NY).strftime('%Y%m%d')
        except (KeyError, TypeError, ValueError, InvalidOperation):
            raise Broken(f'분할 정보 형식이 다름: {s}')
        if num > 0 and den > 0 and num != den:
            splits.append((when, num, den))
    return days, sorted(splits)


def parse_tsv(path, bar):
    """networthcast 형식 TSV (Date=봉 시작 뉴욕 시각 M/D/YYYY HH:MM:SS, Open, High, Low, Close, Volume) → {YYYYMMDD: Day}"""
    bars = {}
    with open(path, encoding='utf-8') as f:
        head = f.readline().rstrip('\n').split('\t')
        if head[:1] != ['Date'] or 'Open' not in head or 'Close' not in head:
            raise Broken(f'{path}: 머리줄이 다름')
        io, ic = head.index('Open'), head.index('Close')
        for n, line in enumerate(f, 2):
            p = line.rstrip('\n').split('\t')
            if len(p) != len(head):
                continue
            t = datetime.datetime.strptime(p[0], '%m/%d/%Y %H:%M:%S')
            minute = t.hour * 60 + t.minute
            if t.second or minute % bar or not OPEN_MIN <= minute <= KIND[bar]['last']:
                raise Broken(f'{path} {n}행: 정규장 봉 시각이 아님 ({p[0]})')
            key = (t.strftime('%Y%m%d'), (minute - OPEN_MIN) // bar)
            if key in bars:
                raise Broken(f'{path} {n}행: 같은 봉이 두 번 ({p[0]})')
            bars[key] = (dec(p[io], f'{path} {n}행 시가'), dec(p[ic], f'{path} {n}행 종가'))
    days = {}
    for (date, slot), (o, c) in sorted(bars.items()):
        if date not in days:
            days[date] = Day(o, {})
        days[date].closes[slot] = c
    if not days:
        raise Broken(f'{path}: 빈 자료')
    return days


# ── 합치기·점검 ────────────────────────────────────────────────

def merge(base, new):
    """base 에 new 를 덮어씀 (봉 단위, new 우선) — 그날 시가는 합친 뒤 가장 이른 봉의 시가"""
    out = {d: day.copy() for d, day in base.items()}
    for date, nd in new.items():
        od = out.get(date)
        if od is None:
            out[date] = nd.copy()
            continue
        closes = dict(od.closes)
        closes.update(nd.closes)
        first = min(closes)
        out[date] = Day(nd.open if first == min(nd.closes) else od.open, closes)
    return out


def apply_splits(days, splits, basis):
    """basis(YYYYMMDD) 보다 새 분할을 저장된 가격에 반영 → 새 basis"""
    for when, num, den in splits:
        if when <= basis:
            continue
        f = den / num
        n = 0
        for date, d in days.items():
            if date < when:
                d.open = (d.open * f).quantize(Q4)
                d.closes = {k: (v * f).quantize(Q4) for k, v in d.closes.items()}
                n += 1
        print(f'  분할 {when} ({num.normalize()}:{den.normalize()}) — 그 전 {n}일 가격을 나눠 맞춤')
        basis = when
    return basis


def check_level(old, new, what):
    """겹치는 봉끼리 가격 수준이 같은지 (분할 반영 차이·깨진 자료 잡기)"""
    ratios = [float(old[d].closes[k]) / float(c) for d, nd in new.items() if d in old
              for k, c in nd.closes.items() if k in old[d].closes]
    if not ratios:
        raise Broken(f'{what}: 저장된 기록과 겹치는 봉이 없음 (공백이 생김 — --import-tsv 로 메운 뒤 다시)')
    med = statistics.median(ratios)
    if abs(med - 1) > LEVEL_TOL:
        raise Broken(f'{what}: 겹치는 구간 가격 수준이 {med - 1:+.2%} 다름 (반영 안 된 분할?)')
    off = sum(1 for r in ratios if abs(r - 1) > DIFF_TOL) / len(ratios)
    if off > DIFF_SHARE:
        raise Broken(f'{what}: 겹치는 봉의 {off:.1%} 가 1% 넘게 다름')
    return len(ratios)


def check_sane(days, what, prev_close=None):
    """0 이하·터무니없는 가격, 봉 사이·밤사이 급변"""
    for date in sorted(days):
        d = days[date]
        seq = [float(d.open)] + [float(d.closes[k]) for k in sorted(d.closes)]
        if any(not 0 < v < 1e6 for v in seq):
            raise Broken(f'{what} {date}: 0 이하이거나 터무니없는 가격')
        if prev_close is not None and not GAP_LO <= seq[0] / prev_close <= GAP_HI:
            raise Broken(f'{what} {date}: 시가가 전일 종가 대비 {seq[0] / prev_close - 1:+.1%}')
        for a, b in zip(seq, seq[1:]):
            if not STEP_LO <= b / a <= STEP_HI:
                raise Broken(f'{what} {date}: 봉 사이 {b / a - 1:+.1%} 급변')
        prev_close = seq[-1]


def check_1m_vs_5m(d1, date, days5):
    """같은 날 1분봉 종가(5분 경계 직전 1분)와 5분봉 종가가 같은 수준인지"""
    d5 = days5.get(date)
    if not d5:
        return
    ratios = [float(c) / float(d1.closes[k * 5 + 4]) for k, c in d5.closes.items() if k * 5 + 4 in d1.closes]
    if ratios and abs(statistics.median(ratios) - 1) > LEVEL_TOL:
        raise Broken(f'1분봉 {date}: 5분봉과 가격 수준이 {statistics.median(ratios) - 1:+.2%} 다름')


def nbars(days):
    return sum(len(d.closes) for d in days.values())


def span(days):
    ds = sorted(days)
    return f'{ds[0][:4]}-{ds[0][4:6]}-{ds[0][6:]} ~ {ds[-1][:4]}-{ds[-1][4:6]}-{ds[-1][6:]}' if ds else '-'


def run(args):
    path5, path1 = (os.path.join(args.data_dir, KIND[b]['file']) for b in (5, 1))
    meta5, old5 = read_store(path5, 5)
    _, old1 = read_store(path1, 1)
    if len(old1) > 1:
        raise Broken('1분봉 파일에 날짜가 둘 이상')
    basis = (meta5.get('split') or '').replace('-', '')
    if old5 and not (len(basis) == 8 and basis.isdigit()):
        raise Broken('5분봉 파일 머리줄에 분할 기준(split=)이 없음')

    new5 = {d: day.copy() for d, day in old5.items()}
    new1 = {d: day.copy() for d, day in old1.items()}
    if args.import_tsv:                       # 넣는 TSV 는 빈 자리만 채움 (저장된 봉 우선)
        tsv5 = parse_tsv(args.import_tsv, 5)
        if new5:
            check_level(new5, tsv5, 'TSV 5분봉')
        else:
            if not args.basis:
                raise Broken('빈 기록에 TSV 를 넣을 때는 --basis (그 TSV 에 반영된 마지막 분할 날짜)가 필요')
            basis = args.basis.replace('-', '')
        new5 = merge(tsv5, new5)
        print(f'  TSV 5분봉 {len(tsv5)}일 {nbars(tsv5)}봉 ({span(tsv5)}) 합침')
    fresh1 = None
    if not args.no_fetch:
        fresh5, splits = parse_chart(yahoo_chart(KIND[5]['query']), 5)
        fresh1, _ = parse_chart(yahoo_chart(KIND[1]['query']), 1)
        print(f'  받음: 5분봉 {len(fresh5)}일 {nbars(fresh5)}봉 ({span(fresh5)}) · 1분봉 마지막 거래일 {max(fresh1)}')
        if new5:
            basis = apply_splits(new5, splits, basis)
            n = check_level(new5, fresh5, '5분봉')
            print(f'  저장된 기록과 겹치는 봉 {n}개 — 가격 수준 같음')
        else:
            basis = max(fresh5)               # 지금 받은 자료는 오늘까지의 분할이 모두 반영돼 있음
        new5 = merge(new5, fresh5)
    if not new5:
        raise Broken('5분봉 기록이 비어 있음')
    check_sane(new5, '5분봉')
    if nbars(new5) < nbars(old5) or len(new5) < len(old5):
        raise Broken('합친 5분봉이 전보다 적음')

    # 1분봉: 가장 최근 거래일 하나
    for src, what in ((parse_tsv(args.import_tsv_1m, 1) if args.import_tsv_1m else None, 'TSV 1분봉'), (fresh1, '1분봉')):
        if not src:
            continue
        date = max(src)
        cur = max(new1) if new1 else None
        if cur and date < cur:
            if what == 'TSV 1분봉':
                print(f'  {what} {date} 는 저장된 {cur} 보다 옛날이라 넣지 않음')
                continue
            raise Broken(f'{what}: 받은 마지막 거래일 {date} 가 저장된 {cur} 보다 옛날')
        new1 = merge(new1, {date: src[date]}) if cur == date else {date: src[date].copy()}
    if new1:
        date1 = max(new1)
        prev5 = [d for d in new5 if d < date1]
        check_sane(new1, '1분봉', float(new5[max(prev5)].closes[max(new5[max(prev5)].closes)]) if prev5 else None)
        check_1m_vs_5m(new1[date1], date1, new5)

    out = {path5: store_text(new5, 5, f'{basis[:4]}-{basis[4:6]}-{basis[6:]}')}
    if new1:
        out[path1] = store_text(new1, 1, f'{basis[:4]}-{basis[4:6]}-{basis[6:]}')
    changed = [p for p, t in out.items() if read_text(p) != t]
    print(f'  5분봉 {len(new5)}일 {nbars(new5)}봉 ({span(new5)}) · 새 날 {len(set(new5) - set(old5))} · 새 봉 {nbars(new5) - nbars(old5)}')
    if new1:
        d1 = new1[max(new1)]
        last = OPEN_MIN + max(d1.closes)
        print(f'  1분봉 {span(new1)[:10]} · {len(d1.closes)}봉 (마지막 봉 {last // 60:02d}:{last % 60:02d} 시작)')
    if not changed:
        print('  바뀐 것 없음')
        return 0
    if args.dry_run:
        print('  [시험] 바뀔 파일: ' + ', '.join(os.path.basename(p) for p in changed) + ' — 쓰지 않음')
        return 0
    os.makedirs(args.data_dir, exist_ok=True)
    for p in changed:
        write_atomic(p, out[p])
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    write_atomic(os.path.join(args.data_dir, UPDATED_FILE), stamp + '\n')
    print('  저장: ' + ', '.join(os.path.basename(p) for p in changed) + f', {UPDATED_FILE} ({stamp})')
    return 0


def main():
    ap = argparse.ArgumentParser(description='TQQQ 장중 흐름 자료(5분봉 기록 · 최근 거래일 1분봉) 갱신')
    ap.add_argument('--dry-run', action='store_true', help='받고 점검만 하고 파일은 쓰지 않음')
    ap.add_argument('--no-fetch', action='store_true', help='야후에서 받지 않음 (--import-tsv 만 합칠 때)')
    ap.add_argument('--import-tsv', help='networthcast 형식 5분봉 TSV 를 빈 자리에 합침')
    ap.add_argument('--import-tsv-1m', help='networthcast 형식 1분봉 TSV (한 거래일)')
    ap.add_argument('--basis', help='빈 기록에 TSV 를 넣을 때 그 TSV 에 반영된 마지막 분할 날짜 (YYYY-MM-DD)')
    ap.add_argument('--data-dir', default=DATA_DIR, help='자료 폴더 (기본 data/stratsim)')
    args = ap.parse_args()
    print(f'TQQQ 장중 흐름 자료 — {os.path.normpath(args.data_dir)}')
    try:
        return run(args)
    except (Broken, RuntimeError, OSError, ValueError) as e:
        print(f'실패 — 파일을 쓰지 않음: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
