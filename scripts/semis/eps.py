#!/usr/bin/env python3
"""[SEMIS] 종목별 조정 EPS 순서(분기 실제 + 다음 분기 예상) — 실적 발표가 나오면 바로 이어 붙임 (표준 라이브러리만)

기준(base.json 의 pe.eps — 2026-11-07 파이프라인)
  · 실제 = 회사 발표 기준 조정 EPS — 야후(LSEG) earningsHistory epsActual 과 같은 값(2026-11-19 확인: 겹치는 분기 모두 같음)
  · 예상 = 분기 컨센서스 4개
  ※ 나스닥(Zacks) earnings-surprise 는 2026-11 무렵부터 일부 종목(AVGO·AMD·QCOM·INTC·MPWR 등 주식 보상 비용이 큰 회사)을
    주식 보상을 비용으로 넣은 낮은 기준으로 바꿈(같은 분기 실제 EPS 가 0.1~0.7달러 낮음) → 실제 EPS 는 나스닥을 쓰지 않음

갱신 규칙 (같은 기준을 지키는 것이 먼저)
  · 새 실제 분기 = 야후 earningsHistory 중 기준(또는 지난번)보다 뒤 분기 — 겹치는 분기 값이 기준과 같을 때만(다르면 주식 분할·기준 변경 → 그 종목은 그대로 두고 알림)
  · 다음 4개 분기 예상 = 야후 earningsTrend 0q·+1q(분기 컨센서스) + 그 뒤 2개 분기는 나스닥 분기 예상에 (야후 − 나스닥) 같은 분기 평균 차이를 더함
    (나스닥과 야후 실제 EPS 가 같은 종목 = 기준이 같은 종목은 나스닥 분기 예상 4개를 그대로 — 기준 파이프라인과 같은 방식)
    나스닥이 없으면 야후 연간 예상(0y·+1y)에서 남은 분기를 고르게 나눔 · 둘 다 없으면 지난 예상 그대로
  · 발표일 = 실적발표 캘린더(data/earnings.json 의 pa·ls) → 나스닥 dateReported → 오늘(뉴욕 날짜)
  · 실적을 발표했는데(캘린더 ls.d) 야후에 아직 그 분기 실제 EPS 가 없으면 → 기다림(wait — 화면 '반영 대기')

  python3 scripts/semis/eps.py NVDA AMAT     # 확인용 — 받아서 결과만 출력(쓰지 않음)"""
import datetime as dt, http.cookiejar, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
NY = ZoneInfo('America/New_York')
NHDR = {'Accept': 'application/json, text/plain, */*', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/', 'User-Agent': UA}
MON = {m: i + 1 for i, m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}


def log(*a):
    print(*a, flush=True, file=sys.stderr)


def qi(ym):
    """'YYYY-MM' → 기준 파일의 분기 번호(연 × 12 + 월)"""
    return int(ym[:4]) * 12 + int(ym[5:7])


def ymq(q):
    return '%04d-%02d' % ((q - 1) // 12, (q - 1) % 12 + 1)


def _get(url, op=None, headers=None, tries=3, timeout=25):
    err = None
    h = {'User-Agent': UA, 'Accept': '*/*'}
    h.update(headers or {})
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with (op.open(req, timeout=timeout) if op else urllib.request.urlopen(req, timeout=timeout)) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404):
                break
            time.sleep(1.5 * (i + 1))
        except Exception as e:
            err = e
            time.sleep(1.5 * (i + 1))
    raise err


class Yahoo:
    """야후 quoteSummary (쿠키 + crumb)"""

    def __init__(self, rounds=3):
        """crumb 받기 — 야후가 잠깐 막으면(429) 쉬었다가 다시(최대 rounds 번 · 15초·45초) · query1·query2 둘 다"""
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.crumb, err = None, None
        for n in range(rounds):
            if n:
                time.sleep(15 * 3 ** (n - 1))
            for u in ('https://fc.yahoo.com', 'https://finance.yahoo.com/'):
                try:
                    _get(u, self.op, tries=1, timeout=20)
                except Exception:
                    pass
                for h in ('query1', 'query2'):
                    try:
                        c = _get('https://%s.finance.yahoo.com/v1/test/getcrumb' % h, self.op, tries=1).decode().strip()
                        if c and '<' not in c and len(c) < 40:
                            self.crumb = c
                            return
                    except Exception as e:
                        err = e
        raise RuntimeError('야후 crumb 실패 (%s)' % err)

    def summary(self, sym):
        u = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/%s?modules=earningsHistory,earningsTrend&crumb=%s' % (
            urllib.parse.quote(sym), urllib.parse.quote(self.crumb))
        try:
            d = json.loads(_get(u, self.op).decode('utf-8', 'replace'))
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10)
            d = json.loads(_get(u.replace('query1.', 'query2.'), self.op).decode('utf-8', 'replace'))
        r = ((d.get('quoteSummary') or {}).get('result') or [None])[0]
        if not r:
            return None
        hist = []
        for x in (r.get('earningsHistory') or {}).get('history') or []:
            q, a = (x.get('quarter') or {}).get('fmt'), (x.get('epsActual') or {}).get('raw')
            if q and a is not None:
                hist.append([q[:7], round(a, 4)])
        tr = {}
        for t in (r.get('earningsTrend') or {}).get('trend') or []:
            p, e, v = t.get('period'), t.get('endDate'), ((t.get('earningsEstimate') or {}).get('avg') or {}).get('raw')
            if p in ('0q', '+1q', '0y', '+1y') and e and v is not None:
                tr[p] = [e[:7], round(v, 4)]
        return {'hist': sorted(hist), 'trend': tr}


def nasdaq(sym):
    """나스닥 실제(최근 4개 분기·발표일) · 분기 예상"""
    s = sym.replace('-', '.')
    out = {'sur': [], 'fq': []}
    try:
        a = (json.loads(_get('https://api.nasdaq.com/api/company/%s/earnings-surprise' % s, headers=NHDR)) or {}).get('data') or {}
        b = (json.loads(_get('https://api.nasdaq.com/api/analyst/%s/earnings-forecast' % s, headers=NHDR)) or {}).get('data') or {}
    except Exception as e:
        log('  나스닥 실패', sym, e)
        return None

    def ym(x):
        try:
            m, y = (x or '').split()
            return '%04d-%02d' % (int(y), MON[m[:3]])
        except Exception:
            return None

    def f(x):
        try:
            return float(str(x).replace('$', '').replace(',', ''))
        except (TypeError, ValueError):
            return None
    for r in ((a.get('earningsSurpriseTable') or {}).get('rows') or []):
        q, e, d = ym(r.get('fiscalQtrEnd')), f(r.get('eps')), r.get('dateReported') or ''
        try:
            mm, dd, yy = d.split('/')
            d = '%04d-%02d-%02d' % (int(yy), int(mm), int(dd))
        except ValueError:
            d = None
        if q and e is not None:
            out['sur'].append([q, e, d])
    for r in (((b.get('quarterlyForecast') or {}).get('rows')) or []):
        q, e = ym(r.get('fiscalEnd')), f(r.get('consensusEPSForecast'))
        if q and e is not None:
            out['fq'].append([q, e])
    out['sur'].sort()
    out['fq'].sort()
    return out


def cal_dates(rec):
    """실적발표 캘린더 한 종목 → 지난 발표일 목록(오름차순)"""
    ds = set()
    for d, k in (rec or {}).get('pa') or []:
        if k == 'rep' and d:
            ds.add(d)
    ls = (rec or {}).get('ls') or {}
    if ls.get('d'):
        ds.add(ls['d'])
    return sorted(ds)


def near_month(a, b):
    """같은 분기로 볼 수 있는 달(분기 끝을 회사마다 그달 말·다음 달 초로 적음) — 1달 차이까지"""
    return abs(qi(a) - qi(b)) <= 1


def build(sym, prev, Y, N, cal, today=None):
    """prev = {'d': [발표일…], 's': [[분기, EPS, 예상?], …]} (기준 또는 지난번) → (새 순서, 상태)
    상태 = {'new': [[분기 'YYYY-MM', 실제, 발표일, 출처]], 'wait': 발표일 | None, 'est': '예상 출처', 'src': '실제 출처', 'warn': [...]}"""
    today = today or dt.datetime.now(NY).date().isoformat()
    st = {'new': [], 'wait': None, 'est': None, 'warn': [], 'src': None}
    if not prev or not prev.get('s'):
        st['warn'].append('기준 EPS 없음')
        return None, st
    act = [x for x in prev['s'] if not x[2]]
    dates = list(prev['d'])
    if len(dates) != len(act):
        st['warn'].append('발표일 수 ≠ 실제 분기 수')
        return prev, st
    # ① 실제 EPS 출처 고르기 — 겹치는 분기(최근 4개)가 기준과 모두 같은 쪽(야후 먼저 · 다음 나스닥)
    #    야후: 회사 발표 기준(대부분) · 나스닥: ASML·UMC 처럼 야후가 현지 통화로 주는 해외 종목은 나스닥(달러)이 기준과 같음
    amap = {x[0]: x[1] for x in act}

    def agree(lst):
        n_same, n_diff, diffs = 0, 0, []
        for ym, v in lst:
            q = qi(ym)
            hit = next((k for k in (q, q - 1, q + 1) if k in amap), None)
            if hit is None:
                continue
            if abs(amap[hit] - v) <= 0.0105:
                n_same += 1
            else:
                n_diff += 1
                diffs.append('%s %s→%s' % (ym, amap[hit], v))
        return n_same, n_diff, diffs
    srcs = []
    if not Y:
        st['warn'].append('야후 자료를 못 받음')
    for nm, lst in (('야후', [[x[0], x[1]] for x in ((Y or {}).get('hist') or [])]), ('나스닥', [[x[0], x[1]] for x in ((N or {}).get('sur') or [])])):
        n_same, n_diff, diffs = agree(lst)
        if n_same >= 2 and n_diff == 0:
            srcs.append((nm, lst))
        elif lst:
            st['warn'].append('%s 실제 EPS 가 기준과 다름(%s)' % (nm, ', '.join(diffs[:3]) or '겹치는 분기 부족'))
    if not srcs:                       # 기준과 같은 출처가 없음(주식 분할·기준 변경) → 이 종목은 그대로 두고 알림
        return dict(prev), st
    st['warn'] = []                    # 한쪽이라도 같으면 다른 쪽 차이는 경고 아님(기준이 다른 출처)
    st['src'] = srcs[0][0]
    caldates = cal_dates(cal)
    nsd = {x[0]: x[2] for x in ((N or {}).get('sur') or [])}
    seq_act = [list(x) for x in act]
    while True:                        # 다음 분기 실제 — 고른 출처 순서대로 찾음
        nxt = None
        for nm, lst in srcs:
            for ym, v in lst:
                q = qi(ym)
                if seq_act[-1][0] + 2 <= q <= seq_act[-1][0] + 4:
                    nxt = (ym, v, nm)
                    break
            if nxt:
                break
        if not nxt:
            break
        ym, v, nm = nxt
        q = seq_act[-1][0] + 3                                   # 기준과 같은 달 간격(3달)으로
        d = next((c for c in caldates if c > dates[-1]), None) or next((v2 for k, v2 in nsd.items() if v2 and near_month(k, ym) and v2 > dates[-1]), None) or today
        seq_act.append([q, v, 0])
        dates.append(d)
        st['new'].append([ymq(q), v, d, nm])
    # 실적을 발표했는데 아직 야후에 없음 → 기다림
    lsd = ((cal or {}).get('ls') or {}).get('d')
    if lsd and lsd > dates[-1]:
        st['wait'] = lsd
    # ② 다음 4개 분기 예상
    fut = [seq_act[-1][0] + 3 * i for i in range(1, 5)]
    y_ok = any(nm == '야후' for nm, _ in srcs)          # 야후가 기준과 다른 종목(현지 통화 등)은 야후 예상도 쓰지 않음
    tr = ((Y or {}).get('trend') or {}) if y_ok else {}
    yq = {}
    for k in ('0q', '+1q'):
        if k in tr:
            yq[qi(tr[k][0])] = tr[k][1]

    def at(m, q):          # 1달 차이까지 같은 분기
        return next((m[k] for k in (q, q - 1, q + 1) if k in m), None)
    nf = {qi(x[0]): x[1] for x in ((N or {}).get('fq') or [])}
    na = {qi(x[0]): x[1] for x in ((N or {}).get('sur') or [])}
    # 나스닥 실제 = 야후(=기준) 실제 → 같은 기준 → 나스닥 분기 예상 그대로
    pairs = [(v, at(na, q)) for q, v, _ in seq_act[-4:]]
    pairs = [(a, b) for a, b in pairs if b is not None]
    same_basis = len(pairs) >= 2 and all(abs(a - b) <= 0.0105 for a, b in pairs)
    est = []
    if same_basis and all(at(nf, q) is not None for q in fut):
        est = [at(nf, q) for q in fut]
        st['est'] = '나스닥 분기 예상(기준 같음)'
    elif all(at(yq, q) is not None for q in fut[:2]):
        y1, y2 = at(yq, fut[0]), at(yq, fut[1])
        n1, n2 = at(nf, fut[0]), at(nf, fut[1])
        if n1 is not None and n2 is not None and at(nf, fut[2]) is not None and at(nf, fut[3]) is not None:
            off = ((y1 - n1) + (y2 - n2)) / 2
            est = [y1, y2, at(nf, fut[2]) + off, at(nf, fut[3]) + off]
            st['est'] = '야후 0q·+1q + 나스닥 분기 예상(차이 %.3f 더함)' % off
        else:   # 야후 연간 예상에서 남은 분기 고르게
            rest = []
            for k in ('0y', '+1y'):
                if k not in tr:
                    continue
                fy = qi(tr[k][0])
                qs = [fy - 9, fy - 6, fy - 3, fy]
                known = {q: v for q, v, _ in seq_act}
                known.update({fut[0]: y1, fut[1]: y2})
                kv = [next((known[k2] for k2 in (q, q - 1, q + 1) if k2 in known), None) for q in qs]
                miss = [q for q, v in zip(qs, kv) if v is None]
                if miss:
                    each = (tr[k][1] - sum(v for v in kv if v is not None)) / len(miss)
                    rest += [(q, each) for q in miss]
            rm = dict(rest)
            e3, e4 = at(rm, fut[2]), at(rm, fut[3])
            if e3 is not None and e4 is not None:
                est = [y1, y2, e3, e4]
                st['est'] = '야후 0q·+1q + 연간 예상에서 남은 분기'
    if not est:                         # 지난 예상 그대로(새 실제가 없을 때만 의미 있음)
        old = {q: v for q, v, e in prev['s'] if e}
        if all(q in old for q in fut):
            est = [old[q] for q in fut]
            st['est'] = '지난 예상 그대로(새 예상 못 받음)'
        else:
            st['warn'].append('다음 4개 분기 예상을 못 만듦')
            return dict(prev), st
    seq = seq_act + [[q, round(v, 4), 1] for q, v in zip(fut, est)]
    return {'d': dates, 's': seq}, st


if __name__ == '__main__':
    with open(os.path.join(ROOT, 'data', 'semis', 'base.json'), encoding='utf-8') as f:
        base = json.load(f)
    with open(os.path.join(ROOT, 'data', 'earnings.json'), encoding='utf-8') as f:
        cal = {r['s']: r for r in json.load(f).get('us') or []}
    y = Yahoo()
    for s in sys.argv[1:]:
        prev = base['etf']['SOXX']['pe']['eps'].get(s) or base['etf']['SOXQ']['pe']['eps'].get(s)
        Y, N = y.summary(s), nasdaq(s)
        seq, st = build(s, prev, Y, N, cal.get(s))
        print(s, json.dumps(st, ensure_ascii=False))
        if seq:
            print('   old', [(ymq(q), v, e) for q, v, e in prev['s'][-6:]], prev['d'][-2:])
            print('   new', [(ymq(q), v, e) for q, v, e in seq['s'][-6:]], seq['d'][-2:])
