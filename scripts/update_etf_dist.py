#!/usr/bin/env python3
"""ETF 차트 비교 — 국내 상장 ETF 분배 이력 (분배락일 · 분배금 · 주당 과세표준 · 분배락 전날 종가)
GitHub Actions 'ETF 분배 이력 갱신'(update-etf-dist.yml)이 매일 실행 · 표준 라이브러리만 사용

출력 data/etfdist/{0..7}.json  (묶음 번호 = 종목코드 글자 코드 합 % 8 — 화면이 고른 종목의 묶음만 받음)
  {"updated": "...", "e": {"498400": {"r": [[20260914, 300, 2, 20370], ...], "z": [20261008, 19805]}}}
  r: [분배락일 YYYYMMDD, 1좌당 분배금(원), 1좌당 과세표준(원 · 모르면 null), 분배락 전 거래일 종가(원 · 모르면 null)]
  z: [마지막 거래일, 그날 종가] — 화면이 '이 자료에 아직 없는 새 분배'를 알아채는 기준 (네이버 수정주가의 마지막 구간 = 실제 종가)
상태 data/etfdist/state.json (화면은 읽지 않음): 종목별 마지막 수집일 · TIGER 월별 표 수집 · 운용사 상품 번호 등

자료
  · 분배 이력(분배락일·분배금) ...... FunETF 분배금 내역 (상장 이후 전체 · KODEX·KoAct 는 과세표준도) — 종목마다 7일에 한 번 + 새 공시 종목은 바로
  · 확정 공시(분배 전) .............. KRX KIND '분배금안내(일괄공시)' 전 종목 · 분배락일은 'ETF 분배락 기준가격 안내'(없으면 기준일 전 영업일)
  · 주당 과세표준 ................... FunETF · data/etfdiv.json(월분배 종목, 15분마다) · 운용사 공개 자료 전체 이력(scripts/etf_tax.py: TIGER 월별 표
                                      · ACE · SOL · KIWOOM · WON · TIME · PLUS · RISE·DAISHIN(한국 PC 수집기)) — 운용사가 공개하지 않은 회차는 null
  · 분배락 전날 종가 ................ 네이버 일별 시세(최근) · 오래된 회차는 네이버 수정주가 ÷ 야후 종가 비율(같은 구간 중앙값)로 복원
원칙: 실패한 자료는 직전 값을 유지 · 내용이 바뀌었을 때만 파일을 다시 씀 · 과세표준은 한 번 알게 되면 지우지 않음
사용: python3 scripts/update_etf_dist.py [--all]   (--all: 모든 종목 분배 이력을 FunETF 에서 다시 받음)
"""
import bisect, datetime, json, os, re, statistics, sys, time, urllib.parse, concurrent.futures as cf
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import etf_tax as TX          # 운용사별 과세표준 (전체 이력: n=None)
import update_etfdiv as DV    # KIND 공시 읽기 · 영업일 계산 (함수만 씀)

ROOT = os.path.dirname(HERE)
DIR = os.path.join(ROOT, 'data', 'etfdist')
NSHARD = 8
KST = ZoneInfo('Asia/Seoul')
UA = TX.UA
E0 = datetime.date(1970, 1, 1)
FUN_EVERY = 7          # FunETF 분배 이력 다시 받는 간격(일)
TAX_RETRY = 30         # 과세표준을 못 찾은 회차: 운용사 자료를 다시 보는 간격(일) — 최근 45일 안 회차는 매번
NEW_DAYS = 45


def shard(code): return sum(ord(c) for c in code) % NSHARD
def ymd_i(d): return d.year * 10000 + d.month * 100 + d.day
def i_date(i): return datetime.date(i // 10000, i // 100 % 100, i % 100)
def s_date(s):
    s = re.sub(r'\D', '', str(s or ''))
    return datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8])) if len(s) == 8 else None


def before(d):
    """d 전 거래일 (휴장일 표가 있는 2025년부터는 정확히, 그 전은 주말만 건너뜀)"""
    if d.year >= 2025: return DV.prev_bday(d)
    d -= datetime.timedelta(days=1)
    while d.weekday() >= 5: d -= datetime.timedelta(days=1)
    return d


def after(d):
    if d.year >= 2025: return DV.next_bday(d)
    d += datetime.timedelta(days=1)
    while d.weekday() >= 5: d += datetime.timedelta(days=1)
    return d


def load(path, empty):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except Exception: return empty


def get(url, **kw):
    kw.setdefault('tries', 2); kw.setdefault('timeout', 30)
    return TX._get(url, **kw)


# ───────────── 자료 받기 ─────────────
def naver_now():
    """전 종목 현재가 (장 마감 뒤면 그날 종가) — 종목코드 → 가격"""
    b = DV.http_get('https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc')
    try: d = json.loads(b.decode('euc-kr'))
    except UnicodeDecodeError: d = json.loads(b.decode('utf-8', 'replace'))
    out = {}
    for x in d['result']['etfItemList']:
        c = str(x.get('itemcode') or '').strip().upper()
        try: v = float(x.get('nowVal'))
        except Exception: continue
        if re.fullmatch(r'[0-9A-Z]{6}', c) and v > 0: out[c] = v
    return out


def funetf(code):
    """FunETF 분배금 내역 → [(분배락일 date, 분배금, 과세표준|None)] (상장 이후 전체)"""
    d = get('https://www.funetf.co.kr/api/public/product/view/etfdividend?itemId=' + TX._isin(code), as_json=True,
            headers={'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.funetf.co.kr/product/etf/view/' + TX._isin(code)}) or []
    out = []
    for x in d:
        ex, amt = s_date(x.get('gijunYmd')), TX._num(x.get('divAmt'))
        if ex and amt and amt > 0:
            tax = TX._num(x.get('taxDividAmt')) if x.get('taxDividAmt') is not None else None
            out.append((ex, amt, tax))
    return out


def naver_adj(code):
    """네이버 수정주가 일봉 → (날짜 목록, 종가 목록)"""
    t = get('https://api.finance.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=19900101&endTime=%s&timeframe=day'
            % (code, (datetime.datetime.now(KST) + datetime.timedelta(days=1)).strftime('%Y%m%d')))
    rows = re.findall(r'\["(\d{8})",\s*(?:-?[\d.]+|null),\s*(?:-?[\d.]+|null),\s*(?:-?[\d.]+|null),\s*(-?[\d.]+)', t)
    dd, vv = [], []
    for a, b in rows:
        v = float(b)
        if v > 0 and (not dd or s_date(a) > dd[-1]): dd.append(s_date(a)); vv.append(v)
    return dd, vv


def yahoo_raw(code):
    """야후 .KS 실제 종가(분배 미반영) → {date: 종가} (2007년 이후 · 없으면 {})"""
    try:
        j = json.loads(get('https://query1.finance.yahoo.com/v8/finance/chart/%s.KS?period1=315532800&period2=%d&interval=1d'
                           % (code, int(time.time()) + 86400), tries=1))
        r = j['chart']['result'][0]; off = r['meta'].get('gmtoffset') or 32400
        return {E0 + datetime.timedelta((t + off) // 86400): c for t, c in zip(r['timestamp'], r['indicators']['quote'][0]['close']) if c}
    except Exception:
        return {}


def mstock(code, page):
    """네이버 일별 시세(실제 종가) 한 쪽 = 60거래일 · 1쪽이 가장 최근"""
    d = json.loads(get('https://m.stock.naver.com/api/stock/%s/price?pageSize=60&page=%d' % (code, page)))
    return {s_date(x['localTradedAt']): float(str(x['closePrice']).replace(',', '')) for x in d or [] if x.get('closePrice')}


# ───────────── KIND 확정 공시 (전 종목) ─────────────
def kind_events(today, st):
    frm, to = DV.dstr(today - datetime.timedelta(days=45)), DV.dstr(today + datetime.timedelta(days=1))
    seen = set(st.setdefault('kindSeen', []))
    evs = st.setdefault('kindEv', {})                  # "코드|기준일" → [기준일, 분배금, 종목명]
    lst = [x for x in DV.kind_search('분배금', frm, to) if '분배금안내' in x['title'].replace(' ', '')]
    for x in sorted([x for x in lst if x['acpt'] not in seen], key=lambda x: x['time']):
        try: rows = DV.kind_rows(x['acpt'])
        except Exception as e:
            print('KIND 공시 읽기 실패', x['acpt'], e, file=sys.stderr); continue
        n = 0
        for r in rows:
            t = DV.isin_ticker(r[0] if r else '')
            if not t or len(r) < 5: continue
            rec, amt = r[2], DV.to_num(r[4])
            if re.match(r'^\d{4}-\d\d-\d\d$', rec) and amt and amt > 0:
                evs[t + '|' + rec] = [rec, amt, r[1]]; n += 1
        seen.add(x['acpt'])
        print('KIND 분배금 공시 %s %s — %d종목' % (x['time'], x['who'], n))
    exmap = st.setdefault('exMap', {})                 # 종목명(정규화) → [분배락일...]
    try:
        for x in DV.kind_search('분배락 기준가격', DV.dstr(today - datetime.timedelta(days=12)), to, size=200)[:150]:
            if x['acpt'] in seen: continue
            try:
                kv = {r[0]: r[1] for r in DV.kind_rows(x['acpt']) if len(r) >= 2}
                name = next((v for k, v in kv.items() if '종목명' in k), None)
                day = next((v for k, v in kv.items() if '적용일' in k), None)
                if name and day and re.match(r'^\d{4}-\d\d-\d\d$', day):
                    L = exmap.setdefault(DV.norm(name), [])
                    if day not in L: L.append(day)
                seen.add(x['acpt'])
            except Exception: pass
    except Exception as e:
        print('KIND 분배락 안내 실패:', e, file=sys.stderr)
    cut = DV.dstr(today - datetime.timedelta(days=60))
    for k in [k for k, v in evs.items() if v[0] < cut]: del evs[k]
    for k in list(exmap):
        exmap[k] = [d for d in exmap[k] if d >= cut]
        if not exmap[k]: del exmap[k]
    st['kindSeen'] = sorted(seen)[-400:]
    out = []
    for key, (rec, amt, name) in evs.items():
        code, rd = key.split('|')[0], DV.ddate(rec)
        ex = next((DV.ddate(d) for d in exmap.get(DV.norm(name), []) if 0 < (rd - DV.ddate(d)).days <= 7), None) or DV.prev_bday(rd)
        out.append((code, ex, amt))
    return out


# ───────────── 기록 합치기 ─────────────
def find(rec, ex, days=6):
    """같은 분배로 볼 기록(분배락일 ±days 일) — 키(YYYYMMDD) 또는 None"""
    best = None
    for k in rec:
        dd = abs((i_date(k) - ex).days)
        if dd <= days and (best is None or dd < best[0]): best = (dd, k)
    return best and best[1]


def upsert(rec, ex, amt, tax=None, src_main=False):
    """rec: {YYYYMMDD: [분배금, 과세표준, 전날 종가]} · src_main: FunETF(분배락일·분배금이 정답 — 확정 공시로 미리 넣은 기록을 바로잡음)"""
    k = find(rec, ex)
    key = ymd_i(ex)
    if k is None:
        rec[key] = [amt, tax, None]; return True
    v = rec[k]; ch = False
    if src_main and k != key:                          # 분배락일이 다르면 FunETF 날짜로 옮기고 전날 종가는 다시 구함
        del rec[k]; v = [v[0], v[1], None]; rec[key] = v; ch = True
    if src_main and v[0] != amt:                       # 분배금이 바뀌면(정정 공시) 예전 과세표준은 버림
        v[0] = amt; v[1] = None; ch = True
    if tax is not None and v[1] != tax: v[1] = tax; ch = True
    return ch


def match_tax(rec, rows):
    """운용사 표 [[기준일 'YYYY-MM-DD', 분배금, 과세표준], ...] → 분배락일 ≤ 기준일 ≤ 분배락일+10일 · 분배금 같은 기록에 과세표준
    (분배 간격은 최소 몇 주라 이 범위에 두 회차가 들어올 수 없음)"""
    n = 0
    for r in rows or []:
        try: rd, amt, tax = DV.ddate(r[0]), float(r[1]), r[2]
        except Exception: continue
        if tax is None or tax < 0: continue
        cand = [k for k in rec if 0 <= (rd - i_date(k)).days <= 10 and abs(rec[k][0] - amt) < 0.5]
        if not cand: continue
        k = max(cand)
        if rec[k][1] != float(tax): rec[k][1] = float(tax); n += 1
    return n


# ───────────── 분배락 전날 종가 ─────────────
def raw_prev(code, rec, ltd):
    """분배락 전 거래일 실제 종가가 비어 있는 회차를 채움 · 최근 80일 안 회차는 네이버 일별 시세, 그 전은 수정주가 ÷ 야후 종가"""
    todo = sorted(k for k, v in rec.items() if v[2] is None and before(i_date(k)) <= ltd)
    if not todo: return 0
    n = 0
    recent = [k for k in todo if (ltd - i_date(k)).days <= 80]
    old = [k for k in todo if k not in recent]
    if recent:
        px = {}
        for pg in (1, 2):
            try: px.update(mstock(code, pg))
            except Exception: break
            days = sorted(px)
            if days and all(any(d < i_date(k) for d in days) for k in recent): break
        days = sorted(px)
        for k in recent:
            prev = [d for d in days if d < i_date(k)]
            want = before(i_date(k))                         # 휴장일 표가 있는 해(2025~)는 정확한 전 거래일과 맞는지 확인
            if prev and (i_date(k) - prev[-1]).days <= 14 and (i_date(k).year < 2025 or prev[-1] == want):
                rec[k][2] = px[prev[-1]]; n += 1
    if old:
        try: nd, na = naver_adj(code)
        except Exception as e:
            print('  %s 수정주가 실패: %s' % (code, e), file=sys.stderr); return n
        if not nd: return n
        yr = yahoo_raw(code)
        pos = {d: i for i, d in enumerate(nd)}
        exs = sorted(rec)
        page_cache = {}
        for k in old:
            ex = i_date(k)
            i = bisect.bisect_left(nd, ex)                   # 분배락일(또는 그 뒤 첫 거래일)
            if i <= 0 or i >= len(nd): continue
            d1 = nd[i - 1]                                   # 분배락 전 거래일
            j = exs.index(k)
            lo = i_date(exs[j - 1]) if j > 0 else datetime.date(1900, 1, 1)
            seg = [nd[t] for t in range(i - 1, -1, -1) if nd[t] >= lo][:25]   # 같은 구간(직전 분배락일 ~ 전날), 가까운 날부터
            q = [na[pos[d]] / yr[d] for d in seg if d in yr and yr[d] > 0]
            if len(q) >= 3:
                rec[k][2] = round(na[i - 1] / statistics.median(q)); n += 1
                continue
            rank = len(nd) - i                               # d1 뒤 거래일 수 → 일별 시세 쪽 번호
            for pg in sorted({rank // 60 + 1, rank // 60 + 2, max(1, rank // 60)}):
                if pg not in page_cache:
                    try: page_cache[pg] = mstock(code, pg)
                    except Exception: page_cache[pg] = {}
                if d1 in page_cache[pg]:
                    rec[k][2] = page_cache[pg][d1]; n += 1; break
    return n


# ───────────── 운용사 과세표준 (전체 이력) ─────────────
def plus_full(codes, cache, relay):
    pm = cache.get('plusMap') or {}
    def one(t):
        if t not in pm: return t, None
        rows = []
        for pg in range(0, 40):
            try:
                d = TX._get(TX._via('https://www.plusetf.co.kr/api/v1/product/dividend/list?n=%s&page=%d' % (pm[t], pg), relay), as_json=True, tries=2, timeout=30)
            except Exception: return t, rows or None
            c = d.get('content') or []
            rows += [[TX._ymd(x.get('wkdate')), TX._num(x.get('dividend')), TX._num(x.get('taxBase'))] for x in c if TX._ymd(x.get('wkdate'))]
            if not c or pg + 1 >= (d.get('totalPages') or 1): break
        return t, rows
    return TX._pool(one, codes, 4)


def tiger_months(codes, months, relay):
    """TIGER 월별 분배 표(전 종목) — 달마다 병렬"""
    out = {}
    def one(ym):
        return ym, TX.tiger(codes, [ym], relay)
    with cf.ThreadPoolExecutor(6) as ex:
        for ym, r in ex.map(one, months):
            for t, rows in (r or {}).items(): out.setdefault(t, []).extend(rows)
    return out


def issuer_taxes(arc, names, st, today, relay, full):
    """과세표준이 빈 회차가 있는 종목만 운용사 자료를 봄 (최근 회차는 매번, 오래된 회차는 30일마다)"""
    tc = st.setdefault('taxCache', {})
    base = load(os.path.join(ROOT, 'data', 'etfdiv.json'), {}).get('taxCache') or {}
    for k, v in base.items():                        # 월분배 달력이 찾아 둔 운용사 상품 번호를 함께 씀
        if isinstance(v, dict): tc.setdefault(k, {}).update({a: b for a, b in v.items() if a not in tc.get(k, {})})
    tried = st.setdefault('taxTry', {})
    by = {}
    for code, a in arc.items():
        miss = [k for k, v in a['r'].items() if v[1] is None]
        if not miss: continue
        newest = min((today - i_date(k)).days for k in miss)
        last = tried.get(code)
        if not full and newest > NEW_DAYS and last and (today - DV.ddate(last)).days < TAX_RETRY: continue
        by.setdefault((names.get(code) or '').split(' ')[0], []).append(code)
    got = {}
    jobs = {
        'ACE': lambda L: TX.ace(L, tc, n=None), 'SOL': lambda L: TX.sol(L, tc, n=None), 'KIWOOM': lambda L: TX.kiwoom(L, n=None),
        'WON': lambda L: TX.won(L, tc, n=None), 'TIME': lambda L: TX.time_(L, tc, n=None), 'PLUS': lambda L: plus_full(L, tc, relay),
        'RISE': lambda L: TX.rise(L, names, relay, tc, n=None), 'DAISHIN': lambda L: TX.daishin(L, relay, tc, n=None),
    }
    for b, L in by.items():
        if b == 'TIGER':
            months = set()
            for c in L:
                for k, v in arc[c]['r'].items():
                    if v[1] is None:                             # 기준일(분배락일 다음 영업일)이 속한 달 — 경계면 두 달 모두
                        ex = i_date(k)
                        for d in (ex, after(ex)): months.add((d.year, d.month))
            mon_done = st.setdefault('tigerMon', {})
            todo = sorted(m for m in months if full or '%d-%02d' % m not in mon_done
                          or (today - DV.ddate(mon_done['%d-%02d' % m])).days >= TAX_RETRY
                          or (today - datetime.date(m[0], m[1], 1)).days <= NEW_DAYS + 31)
            if todo and relay:
                r = tiger_months(L, todo, relay)
                for m in todo: mon_done['%d-%02d' % m] = DV.dstr(today)
                got.update(r)
                print('과세표준 TIGER: %d개월 · %d종목' % (len(todo), len(r)))
        elif b in jobs:
            try:
                r = {t: v for t, v in jobs[b](sorted(L)).items() if v}
                got.update(r)
                print('과세표준 %s: %d/%d종목' % (b, len(r), len(L)))
            except Exception as e:
                print('과세표준 %s 실패: %s' % (b, e), file=sys.stderr)
        for c in L: tried[c] = DV.dstr(today)
    n = 0
    for code, rows in got.items():
        if code in arc: n += match_tax(arc[code]['r'], rows)
    return n


# ───────────── 실행 ─────────────
def main():
    t0 = time.time()
    full = '--all' in sys.argv
    now = datetime.datetime.now(KST); today = now.date()
    after_close = DV.is_bday(today) and now.time() >= datetime.time(15, 45)
    ltd = today if after_close else DV.prev_bday(today)          # 종가가 확정된 마지막 거래일
    universe = load(os.path.join(ROOT, 'data', 'etf_list.json'), {}).get('kr') or []
    if len(universe) < 500: print('ETF 목록이 비어 있어 중단'); sys.exit(1)
    names = {c: n for c, n, t in universe}
    only = [c for c in os.environ.get('ETFDIST_ONLY', '').split(',') if c]      # 시험 실행: 몇 종목만
    if only: names = {c: names[c] for c in only if c in names}
    relay = (load(os.path.join(ROOT, 'data', 'counter.json'), {}) or {}).get('endpoint')
    os.makedirs(DIR, exist_ok=True)
    old = {i: load(os.path.join(DIR, '%d.json' % i), {}) for i in range(NSHARD)}
    arc = {}
    for i in range(NSHARD):
        for code, v in (old[i].get('e') or {}).items():
            arc[code] = {'r': {int(r[0]): [r[1], r[2], r[3]] for r in v.get('r') or []}, 'z': v.get('z')}
    st = load(os.path.join(DIR, 'state.json'), {})
    for c in names: arc.setdefault(c, {'r': {}, 'z': None})
    if only: arc = {c: arc[c] for c in names}

    # ① 확정 공시 (분배 전에 미리)
    kev = []
    try:
        kev = kind_events(today, st)
        for code, ex, amt in kev:
            if code in arc: upsert(arc[code]['r'], ex, amt)
        print('KIND 확정 공시: %d건' % len(kev))
    except Exception as e:
        print('KIND 실패(직전 값 유지):', e, file=sys.stderr)

    # ② FunETF 분배 이력 (7일마다 · 새 공시 종목 · 처음 보는 종목)
    fun = st.setdefault('fun', {})
    hot = {c for c, ex, amt in kev}
    todo = [c for c in names if full or c in hot or c not in fun or (today - DV.ddate(fun[c])).days >= FUN_EVERY]
    def f1(c):
        try: return c, funetf(c)
        except Exception: return c, None
    nf = 0
    with cf.ThreadPoolExecutor(6) as ex:
        for c, rows in ex.map(f1, todo):
            if rows is None: continue
            fun[c] = DV.dstr(today); nf += 1
            for exd, amt, tax in rows: upsert(arc[c]['r'], exd, amt, tax, src_main=True)
    print('FunETF 분배 이력: %d/%d종목' % (nf, len(todo)))

    # ③ 과세표준: 월분배 달력(15분마다 운용사 자료) → 운용사 전체 이력
    dv = load(os.path.join(ROOT, 'data', 'etfdiv.json'), {})
    n1 = sum(match_tax(arc[c]['r'], rows) for c, rows in (dv.get('taxMap') or {}).items() if c in arc)
    n2 = issuer_taxes(arc, names, st, today, relay, full)
    print('과세표준 반영: 월분배 달력 %d회 · 운용사 %d회' % (n1, n2))

    # ④ 분배락 전날 종가
    codes = [c for c, a in arc.items() if any(v[2] is None and before(i_date(k)) <= ltd for k, v in a['r'].items())]
    def f2(c):
        try: return c, raw_prev(c, arc[c]['r'], ltd)
        except Exception as e:
            print('  %s 전날 종가 실패: %s' % (c, e), file=sys.stderr); return c, 0
    nr = 0
    with cf.ThreadPoolExecutor(4) as ex:
        for c, n in ex.map(f2, codes): nr += n
    print('분배락 전날 종가: %d회 (%d종목)' % (nr, len(codes)))

    # ⑤ 마지막 거래일 종가 (장 마감 뒤 · 휴일에만)
    try:
        if after_close or not DV.is_bday(today):
            for c, v in naver_now().items():
                if c in arc: arc[c]['z'] = [ymd_i(ltd), v]
    except Exception as e:
        print('현재가 실패(직전 값 유지):', e, file=sys.stderr)

    # ⑥ 저장 (바뀐 묶음만)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    tot = 0
    for i in range(NSHARD):
        e = {}
        for code in sorted(c for c in arc if shard(c) == i):
            a = arc[code]
            if not a['r'] and not a['z']: continue
            e[code] = {'r': [[k] + a['r'][k] for k in sorted(a['r'])], 'z': a['z']}
            tot += len(a['r'])
        obj = {'updated': stamp, 'e': e}
        path = os.path.join(DIR, '%d.json' % i)
        if (old[i].get('e') or {}) == json.loads(json.dumps(e)) and old[i].get('updated', '')[:10] == stamp[:10]:
            continue
        with open(path, 'w', encoding='utf-8') as f: json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(DIR, 'state.json'), 'w', encoding='utf-8') as f: json.dump(st, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    have = sum(1 for a in arc.values() for v in a['r'].values() if v[1] is not None)
    raw = sum(1 for a in arc.values() for v in a['r'].values() if v[2] is not None)
    print('저장: 분배 %d회 · 과세표준 %d회 · 전날 종가 %d회 · %.0f초' % (tot, have, raw, time.time() - t0))


if __name__ == '__main__':
    main()
