#!/usr/bin/env python3
"""[SEMIS] 'SOX와 NYSE 반도체 지수 분석' 자동 갱신 — 종가·환율 + 실적 발표(EPS·분기 재무)를 바로 반영 (표준 라이브러리만)

자료 (data/semis/)
  base.json        기준 고정값 — scripts/semis/extract_base.py 가 SOXX·SOXQ 대시보드 파이프라인에서 만듦(2026-11-07 · EPS 기준 eps_asof)
  eps.json         기준 뒤 실적 반영분(scripts/semis/eps.py) — 종목별 새 실제 분기 EPS·발표일 · 다음 4개 분기 예상 · 출처 · 재무 표 상태
  soxx_fin.json · soxq_fin.json   구성 종목 표(c) · 분기(q) · 연간(a) — 새 분기 줄은 scripts/semis/stmt.py(정식 공시 XBRL · 그 전 보도자료 '발표' 줄 · 해외 = 야후)
  soxx_pe.json  · soxq_pe.json    일별 PER — frozen(마지막 보유 내역을 쓰기 전날)까지는 파이프라인 값 그대로, 그 뒤 날짜는 매번 다시 계산(종가 + 그날까지 발표된 실제 EPS + 최신 예상)
  summary.json                    맨 위 요약(지수 PER 지금 값·역대 위치·합계·실적 반영 상태)

계산 (파이프라인과 같은 식 — 기준일 값을 기준 EPS 로 똑같이 다시 만들어 보고 다르면 멈춤)
  · 기업 PER(후행·혼합·선행) = 미국 상장 가격 ÷ 그날 EPS 창(최근 4개 실제 · 최근 2개 + 다음 2개 · 다음 4개 예상) — 기준 뒤 분할은 같은 내려받기 안의 가격 비율로 보정
  · 시가총액(현지 통화) = 기준 시가총액 × 현지 가격 비율 · 달러 환산 = × 그날 환율 · 회계 PER = 시가총액 ÷ 최근 4개 분기 순이익 · PBR·배당수익률 = 최근 분기 자본·배당 기준
  · ETF 비중 = 보유 주식 수(SOXX: Zacks 2026-09-30 · SOXQ: Zacks 2026-10-02) × 가격 → 합 100%
  · 일별 PER = Σ 보유 주식 수 × 그날 종가 ÷ Σ 보유 주식 수 × EPS (적자 포함 합산 · 마지막 보유 내역 · 종목별 EPS 는 발표 순서로 그날까지 발표된 분기)
  · 실적 반영: 실적발표 캘린더(data/earnings.json)에 새 발표가 보이면 → 야후(·나스닥) 실제 EPS 가 기준과 같은 기준인지 확인하고 붙임 → 8-K 보도자료로 분기 재무('발표' 줄) → 정식 공시가 나오면 XBRL 값으로

  python3 scripts/update_semis.py                 # 전체(종가 · 모든 종목 EPS 예상·재무 확인) — 평일 아침·토요일
  python3 scripts/update_semis.py --quick         # 실적발표 캘린더 갱신 뒤: 새로 발표한 종목이 있을 때만(없으면 아무것도 안 함)
  python3 scripts/update_semis.py --replay <ws>   # 파이프라인 작업 공간의 저장된 종가로 기준일을 다시 계산해 게시본과 같은지만 확인(쓰지 않음)
"""
import datetime, json, math, os, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIR = os.path.join(ROOT, 'data', 'semis')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'semis'))
ET = ZoneInfo('America/New_York')
UAS = ('Mozilla/5.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
WORKER = 'https://etfmd-counter.gusrudgma.workers.dev/etf?m=u&s='   # 사이트 Worker — 야후 일봉 그대로(야후가 막힐 때만)
FXSYM = {'TWD': 'TWD=X', 'EUR': 'EURUSD=X', 'KRW': 'KRW=X'}
REPLAY = None


def log(*a):
    print(*a, flush=True)


def get(url, headers=None, tries=3):
    err = None
    for i in range(tries):
        try:
            h = {'User-Agent': UAS[i % len(UAS)], 'Accept': 'application/json,*/*'}
            h.update(headers or {})
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=40) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 404):
                break
            time.sleep(2 * (i + 1))
        except Exception as e:
            err = e
            time.sleep(2 * (i + 1))
    raise err


_cache = {}


def chart(sym, kind='pe'):
    """야후 v8 일봉 → {'c': {날짜: 종가(분할 반영)}, 'meta': ...} · 날짜 = 거래소 시간대 · 장중 막대(오늘 장이 끝나기 전)는 뺌
    kind: 재현(--replay) 때 어느 저장 일봉을 쓸지 — 'pe' 일별 PER(dl8/yh) · 'co' 기업 표(dl5/px) · 실제 갱신에서는 같은 야후 일봉"""
    ck = (sym, kind if REPLAY else '')
    if ck in _cache:
        return _cache[ck]
    if REPLAY:
        res = _replay(sym, kind)
    else:
        p1 = int(time.time()) - 500 * 86400
        q = f'period1={p1}&period2={int(time.time()) + 86400}&interval=1d&events=split&includePrePost=false'
        res, err = None, None
        for u in [f'https://{h}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{q}' for h in ('query2', 'query1')] + [WORKER + urllib.parse.quote(sym)]:
            try:
                d = json.loads(get(u, {'Origin': 'https://d-capitalism.com'} if u.startswith(WORKER) else None))
                res = ((d.get('chart') or {}).get('result') or [None])[0]
                if res and res.get('timestamp'):
                    break
                res = None
            except Exception as e:
                err = e
        if not res:
            raise RuntimeError(f'{sym}: 일봉을 못 받음 ({err})')
    meta = res.get('meta') or {}
    tz = ZoneInfo(meta.get('exchangeTimezoneName') or 'America/New_York')
    cl = ((res.get('indicators') or {}).get('quote') or [{}])[0].get('close') or []
    out = {}
    for t, v in zip(res.get('timestamp') or [], cl):
        if v is None or not math.isfinite(v) or v <= 0:
            continue
        out[datetime.datetime.fromtimestamp(t, tz if not REPLAY else datetime.timezone.utc).date().isoformat()] = float(v)
    if not REPLAY and out:
        now = datetime.datetime.now(tz)
        last = max(out)
        reg = ((meta.get('currentTradingPeriod') or {}).get('regular') or {})
        if last == now.date().isoformat() and reg.get('end') and time.time() < reg['end'] + 600:   # 오늘 장이 아직 안 끝남(끝난 뒤 10분 전) → 오늘 막대 뺌
            del out[last]
    r = {'c': out, 'meta': meta}
    _cache[ck] = r
    return r


def _replay(sym, kind):
    """파이프라인 작업 공간의 저장된 일봉(dl8/yh: 일별 PER · dl5/px: 기업 표 — snapshot.py 와 같은 파일)"""
    fn = sym.replace('^', '_')
    for sub in (('dl8/yh',) if kind == 'pe' else ('dl5/px',)):
        p = os.path.join(REPLAY, sub, fn + '.json')
        if os.path.isfile(p):
            with open(p) as f:
                return json.load(f)['chart']['result'][0]
    raise RuntimeError('replay: 일봉 파일 없음 ' + sym)


def on_or_before(c, d, days=10):
    x = datetime.date.fromisoformat(d)
    for k in range(days + 1):
        v = c.get((x - datetime.timedelta(days=k)).isoformat())
        if v:
            return v
    return None


def load(name):
    with open(os.path.join(DIR, name), encoding='utf-8') as f:
        return json.load(f)


def save(name, obj):
    p = os.path.join(DIR, name)
    with open(p + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(p + '.tmp', p)


def R(v, n):
    return None if v is None else round(v, n)


def R1(v):
    """저장된 소수 둘째 자리 값 → 첫째 자리 (반올림 0.05 → 올림: 105.85 → 105.9 — 파이프라인 표와 같게)"""
    import decimal
    return None if v is None else float(decimal.Decimal(repr(v)).quantize(decimal.Decimal('0.1'), rounding=decimal.ROUND_HALF_UP))


# ── 종목별 EPS 창 (work3/daily.py EPS.at 그대로) ──
def eps_at(e, d):
    """그날까지 발표된 분기 수 k → 최근 4개(후행)·최근 2+다음 2(혼합)·다음 4개(선행) · 예상치 개수"""
    if not e:
        return None
    a, lo, hi = e['d'], 0, len(e['d'])
    while lo < hi:            # bisect.bisect_right(dates, d) 와 똑같이 (발표일 목록은 분기 순서라 날짜가 드물게 앞뒤가 바뀜)
        mid = (lo + hi) // 2
        if d < a[mid]:
            hi = mid
        else:
            lo = mid + 1
    k = lo
    if k < 4:
        return None
    q = e['s'][k - 4:k + 4]
    if len(q) < 8 or any(q[i + 1][0] - q[i][0] != 3 for i in range(7)):
        return None
    return (sum(x[1] for x in q[:4]), q[2][1] + q[3][1] + q[4][1] + q[5][1], sum(x[1] for x in q[4:]), sum(1 for x in q[4:] if x[2]))


def pe_rows(etf, B, EM=None):
    """마지막 보유 내역을 쓰는 첫날(B['from'])부터 오늘까지 일별 PER 다시 계산 (daily.py · soxq_daily.py 와 같은 식·반올림)
    EM = 종목별 EPS 순서(기준 + 실적 반영) — None 이면 기준 EPS(재현 확인용)"""
    P = B['pe']
    ref = chart('^SOX' if P['ref'] == '_SOX' else P['ref'])['c']
    etfp = chart(P['px'])['c']
    s0 = on_or_before(ref, P['hold'], 5)
    pos = []
    for x in P['pos']:
        c = chart(x['t'])['c']
        p0 = on_or_before(c, P['hold'], 5)
        if p0 is None:
            raise RuntimeError(f'{etf} 바구니 {x["t"]}: 보유일 가격 없음')
        pos.append((x['t'], x['v'] / p0, p0 / x['p0'], c, (EM if EM is not None else P['eps']).get(x['t'])))   # n = 보유액 ÷ 오늘 받은 보유일 가격 · EPS 배율 = 분할 보정
    days = sorted(d for d in ref if d >= P['from'])
    out, parts = [], {}
    for d in days:
        cov = allv = Et = Em = En = estw = 0.0
        pp = []
        for t, n, f, c, e in pos:
            p = c.get(d)
            if p is None:
                continue
            v = n * p
            allv += v
            r = eps_at(e, d)
            if r is None:
                continue
            ttm, mix, ntm, est = r
            ttm, mix, ntm = ttm * f, mix * f, ntm * f
            cov += v; Et += n * ttm; Em += n * mix; En += n * ntm
            pp.append((t, v, p))
            estw += n * ntm * est / 4 if ntm else 0
        if cov == 0:
            continue
        uncv = P['unc'] * (ref[d] / s0)
        row = {'date': d, 'cov': round(cov / (allv + uncv) * 100, 1),
               'pe_ttm': round(cov / Et, 2) if Et > 0 else None, 'pe_mix': round(cov / Em, 2) if Em > 0 else None, 'pe_ntm': round(cov / En, 2) if En > 0 else None,
               'est': round(estw / En * 100, 1) if En > 0 else None, 'hold': P['hold']}
        if etf == 'SOXX':
            if d not in etfp:
                continue
            row['soxx'] = round(round(etfp[d], 4), 2)
        else:
            row['soxq'] = round(etfp[d], 2) if d in etfp else None
            row['sox'] = round(ref[d], 2)
            row['basis'] = 'SOXQ'
        out.append(row)
        parts[d] = (cov, pp)
    return out, parts


def companies(etf, B, D, fin, EM=None, ROWS=None, upd=()):
    """구성 종목 표의 가격 칸 — D(그날 미국 종가 날짜) 기준
    · EM: 종목별 EPS 순서(기준 + 실적 반영) → PER = 지금 가격 ÷ 그날 EPS 창 · 없는 종목(SKHY·CBRS)은 기준 PER × 가격 비율
    · upd: 새 분기 줄이 붙은 종목 — 매출·순이익(최근 4개 분기)·마진·부채·ROE·PBR·배당 등을 그 줄들로 다시(ROWS = {종목: (분기 줄, 연간 줄)})"""
    C = {r[0]: dict(zip(fin['c']['c'], r)) for r in fin['c']['r']}
    fx = {'USD': 1.0}
    if not REPLAY:
        for cur, s in FXSYM.items():
            v = on_or_before(chart(s)['c'], D, 7)
            if v:
                fx[cur] = 1 / v if cur in ('TWD', 'KRW') else v
    rows, wv, miss = [], {}, []
    for b in B['companies']:
        c = dict(C[b['sym']])
        try:
            us, lc = chart(b['us'], 'co')['c'], chart(b['loc'], 'co')['c']
            pu0, pu1 = on_or_before(us, B_BASIS), on_or_before(us, D)
            pl0, pl1 = on_or_before(lc, B_BASIS), on_or_before(lc, D)
            if not (pu0 and pu1 and pl0 and pl1):
                raise RuntimeError('가격 없음')
        except Exception as e:
            miss.append(b['sym']); log('  가격 못 받음 — 지난 값 그대로', b['sym'], e)
            rows.append(c); wv[b['sym']] = (c.get('weight') or 0, True)
            continue
        # 가격 비율의 기준 = 기준 자료에 저장된 기준일 가격(px_us·px_loc — 기준 시가총액·PBR·배당이 이 가격으로 계산됨)
        #   오늘 받은 기준일 가격과 20% 넘게 다르면 그 사이 주식 분할 → 오늘 받은 기준일 가격(분할 반영)
        #   (ASML.AS: 기준 자료 px_loc 1,250 = 11월 5일 종가 · 야후 11월 6일 종가 1,283.6 — 오늘 받은 값으로 나누면 시가총액이 2.6% 작게 나옴)
        bu = b['px_us'] if b.get('px_us') and 0.8 < pu0 / b['px_us'] < 1.25 else pu0
        bl = b['px_loc'] if b.get('px_loc') and 0.8 < pl0 / b['px_loc'] < 1.25 else pl0
        ru, rl = pu1 / bu, pl1 / bl
        f = b['fx'] if REPLAY else fx.get(b['cur'])
        if f is None:
            raise RuntimeError(f'{b["cur"]} 환율 없음')
        ml = b['mcap_local'] * rl if b['mcap_local'] else None
        c['px'] = R(pu1 if not REPLAY else b['px_us'] * ru, 2)
        c['mcap_local'] = R(ml, 0)
        c['mcap_usd'] = R(ml * f, 0) if ml else None
        e = (EM or {}).get(b['sym'])
        win = eps_at(e, D) if e and EM is not None else None
        if win and b.get('px_us'):
            sp = bu / b['px_us']                # 기준일 뒤 주식 분할 — 분할이면 오늘 받은 기준일 가격 ÷ 저장된 기준일 가격(EPS 를 같은 배율로) · 아니면 1
            for k, E in zip(('pe_ttm', 'pe_mix', 'pe_ntm'), win[:3]):
                c[k] = R(pu1 / (E * sp), 1) if E > 0 else None
        else:
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
                c[k] = R(b[k] * ru, 1) if b.get(k) is not None else None
        ni = b.get('ni_ttm')
        if b['sym'] in upd and ROWS and ROWS.get(b['sym']):
            q, a, yh, cv = ROWS[b['sym']]
            l = q[-1]
            last4 = q[-4:]
            # 최근 4개 분기 합 — 분기가 이어질 때만(세레브라스처럼 상장 전 분기가 빠진 종목은 비움: 파이프라인 표와 같음)
            ok4 = len(last4) == 4 and all(75 <= (datetime.date.fromisoformat(last4[i + 1]['end']) - datetime.date.fromisoformat(last4[i]['end'])).days <= 105 for i in range(3))
            c['rev_ttm'] = sum(r['rev'] for r in last4) if ok4 and all(r.get('rev') is not None for r in last4) else None
            c['ni_ttm'] = sum(r['ni'] for r in last4) if ok4 and all(r.get('ni') is not None for r in last4) else None
            la = next((r for r in a if abs((datetime.date.fromisoformat(r['end']) - datetime.date.fromisoformat(l['end'])).days) <= 8), None)

            def cur(k):
                # 파이프라인 표와 같은 규칙: 최근 분기 값 → 없으면 같은 날 끝난 연간 값(메이컴 이자보상배율) → 없으면 바로 전 분기(SK하이닉스 3분기 '2분기 기준')
                #   해외(야후 재무) 주주환원율 = 최근 연간 값(분기 현금흐름이 일부만 있어 — ASML·ST)
                #   최근 분기 값은 만들 때의 반올림 전 값(cv)으로 — 저장값(소수 둘째 자리)을 다시 반올림하면 x.x5 에서 0.1 어긋남
                if yh and k == 'sr' and a:
                    return a[-1].get(k)
                v = l.get(k)
                if v is not None and cv and cv.get('end') == l['end'] and cv.get(k) is not None and round(cv[k], 2) == v:
                    return cv[k]
                if v is None and la:
                    v = la.get(k)
                if v is None and len(q) >= 2:
                    v = q[-2].get(k)
                return v
            for k in ('rev_g', 'opm', 'debt', 'icr', 'roe', 'sr'):
                c[k] = R1(cur(k))
            c['last_q'], c['nq'], c['na'] = l['end'], len(q), len(a)
            c['since_q'] = q[0]['end'] if q else None
            c['since_a'] = a[0]['end'] if a else None
            lp = l if l.get('pbr') and l.get('mcap') else q[-2] if len(q) >= 2 else {}
            eq = lp['mcap'] / lp['pbr'] if lp.get('mcap') and lp.get('pbr') else None
            c['pbr'] = R(ml / eq, 2) if eq and ml else R(b['pbr'] * rl, 2) if b.get('pbr') is not None else None   # 자본 줄이 없으면(세레브라스 상장 전 분기) 기준값 × 가격 비율
            # 배당수익률 = 최근 4개 분기 배당 ÷ 지금 시가총액 · 해외(야후 재무)는 최근 연간 배당(분기 배당 자료가 일부만 있어 — 파이프라인 표와 같음)
            ld = (a[-1] if a else {}) if yh else l if l.get('dy') is not None and l.get('mcap') else q[-2] if len(q) >= 2 else {}
            dv = ld['dy'] * ld['mcap'] / 100 if ld.get('dy') is not None and ld.get('mcap') else None
            c['dy'] = R(dv / ml * 100, 2) if dv is not None and ml else R(b['dy'] / rl, 2) if b.get('dy') is not None else None
            ni = c['ni_ttm']
        else:
            c['pbr'] = R(b['pbr'] * rl, 2) if b.get('pbr') is not None else None
            c['dy'] = R(b['dy'] / rl, 2) if b.get('dy') is not None else None
        c['pe_gaap'] = R(ml / ni, 1) if ni and ni > 0 and ml else None
        c['pxd'] = max(d for d in us if d <= D)
        rows.append(c)
        wv[b['sym']] = (b['wsh'] * b['px_us'] * ru if b.get('wsh') else None, False)
    # 비중: 가격을 받은 종목은 보유 주식 수 × 가격 → 받지 못한 종목의 지난 비중을 뺀 나머지를 나눔
    fixed = sum(v for v, keep in wv.values() if keep and v)
    tot = sum(v for v, keep in wv.values() if not keep and v)
    for c in rows:
        v, keep = wv[c['sym']]
        if not keep:
            c['weight'] = R(v / tot * (100 - fixed), 2) if v and tot else None
    rows.sort(key=lambda x: -(x['weight'] or 0))
    return rows, fx, miss


def pctl(vals, now):
    v = [x for x in vals if x is not None]
    return (sum(1 for x in v if x < now) / len(v) * 100) if v and now is not None else None


# ── 실적 반영 (EPS · 분기 재무) ──
QCOLS = ['sym', 'end', 'label', 'rev', 'rev_g', 'oi', 'opm', 'ni', 'ocf', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr', 'mcap', 'oi_est', 'supp']


def calendar():
    """실적발표 캘린더(data/earnings.json) 미국 종목 {티커: 줄}"""
    try:
        with open(os.path.join(ROOT, 'data', 'earnings.json'), encoding='utf-8') as f:
            return {r['s']: r for r in json.load(f).get('us') or []}
    except Exception:
        return {}


def base_eps(base):
    out = {}
    for etf in ('SOXX', 'SOXQ'):
        for t, e in base['etf'][etf]['pe']['eps'].items():
            if e and t not in out:
                out[t] = e
    return out


def merge_eps(be, x):
    """기준 EPS 순서 + 반영분 {a: [[분기, EPS]], d: [발표일], e: [[분기, 예상]]} → 전체 순서
    기준 마지막 실제 분기 바로 다음(3달 뒤)부터 이어지는 것만 붙임 — 기준을 새로 뽑아 이미 들어간 분기는 건너뜀(겹치면 EPS 창이 깨짐)"""
    if not be:
        return None
    if not x:
        return be
    act = [list(v) for v in be['s'] if not v[2]]
    d = list(be['d'])
    for (q, v), dd in zip(x.get('a') or [], x.get('d') or []):
        if q == act[-1][0] + 3 and dd > d[-1]:
            act.append([q, v, 0])
            d.append(dd)
    est = [[q, v, 1] for q, v in x.get('e') or []]
    if not est or est[0][0] != act[-1][0] + 3:
        est = [list(v) for v in be['s'] if v[2] and v[0] > act[-1][0]]
    return {'d': d, 's': act + est}


def delta_of(be, seq):
    """전체 순서 → 기준 뒤 반영분"""
    n = sum(1 for v in be['s'] if not v[2])
    act = [v for v in seq['s'] if not v[2]]
    return {'a': [[q, v] for q, v, _ in act[n:]], 'd': seq['d'][len(be['d']):], 'e': [[q, v] for q, v, e in seq['s'] if e]}


def rows_of(fin, kk):
    cc = fin[kk]['c']
    out = {}
    for r in fin[kk]['r']:
        o = dict(zip(cc, r))
        out.setdefault(o['sym'], []).append(o)
    for v in out.values():
        v.sort(key=lambda o: o['end'])
    return out


def merge_rows(old, new):
    """기존 줄 + 새로 만든 줄 → (줄, 바뀜?) — 기존 정식 줄은 그대로 · 마지막 정식 줄 뒤 분기만 붙임 · '발표' 줄은 새 값(정식 공시면 그 값)으로 바꿈
    · 같은 분기 = 끝 날짜 8일 안(회사마다 그달 말·다음 달 초)"""
    def near(a, b):
        return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days) <= 8
    out = [dict(o) for o in old]
    firm = [o['end'] for o in out if not o.get('supp')]
    last_firm = max(firm) if firm else ''
    ch = False
    for r in sorted(new, key=lambda o: o['end']):
        if r['end'] <= last_firm or any(near(r['end'], e) for e in firm):
            continue
        i = next((j for j, o in enumerate(out) if near(o['end'], r['end'])), None)
        rr = {k: r.get(k) for k in QCOLS if k != 'sym'}
        rr['sym'] = out[0]['sym'] if out else r.get('sym')
        rr['supp'] = 1 if r.get('supp') else None
        if i is None:
            if out and r['end'] < out[-1]['end']:
                continue
            out.append(rr)
            ch = True
        elif out[i].get('supp'):
            if {k: out[i].get(k) for k in QCOLS} != {k: rr.get(k) for k in QCOLS}:
                out[i] = rr
                ch = True
    out.sort(key=lambda o: o['end'])
    lf = max((o['end'] for o in out if not o.get('supp')), default='')
    keep = [o for o in out if not (o.get('supp') and o['end'] < lf)]   # 정식 줄이 그 뒤 분기까지 왔는데 남은 '발표' 줄(끝 날짜가 8일 넘게 달랐던 경우) = 지난 값
    return keep, ch or len(keep) != len(out)


def round_row(o):
    out = {}
    for k in QCOLS:
        v = o.get(k)
        if isinstance(v, float):
            v = round(v, 2) if k in ('rev_g', 'opm', 'icr', 'debt', 'roe', 'per', 'pbr', 'sr') else round(v, 3) if k == 'dy' else round(v, 0) if k == 'mcap' else int(round(v)) if k in ('rev', 'oi', 'ni', 'ocf', 'oi_est') else v
        out[k] = v
    return out


def earnings(base, prevx, cal, quick):
    """실적 반영 단계 — (반영분 eps.json 내용, 종목별 새 줄 {종목: (분기 줄, 연간 줄, 상태)}, 이번에 본 종목) · quick 이면 새 발표가 있는 종목만"""
    import eps as EP
    BE = base_eps(base)
    comp = {}
    for etf in ('SOXX', 'SOXQ'):
        for c in base['etf'][etf]['companies']:
            comp.setdefault(c['sym'], c)
    syms = sorted(set(BE) | set(comp))
    X = {k: dict(v) for k, v in (prevx.get('c') or {}).items()}
    FS = dict(prevx.get('fin') or {})
    today = datetime.datetime.now(ET).date().isoformat()

    def last_rep(sym):
        m = merge_eps(BE.get(sym), X.get(sym))
        return m['d'][-1] if m and m.get('d') else ''

    def due(sym):
        lsd = (((cal.get(sym) or {}).get('ls') or {}).get('d')) or ''
        if lsd and lsd > last_rep(sym):
            return True                                               # 발표했는데 EPS 아직
        fs = FS.get(sym) or {}
        if sym in comp and fs.get('pending') and lsd and (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(lsd)).days <= 10:
            return True                                               # EPS 는 반영 · 재무 표(보도자료) 아직
        return False
    tg = [s_ for s_ in syms if due(s_)] if quick else syms
    log('실적 반영 대상', len(tg), '종목' + (' (새 발표: ' + ', '.join(tg) + ')' if quick else ''))
    if not tg:
        return None, {}, []
    y = None
    try:
        y = EP.Yahoo()
    except Exception as e:
        log('  야후 연결 실패 — EPS 는 나스닥만', e)
    for sym in tg:
        if sym not in BE:
            continue
        prev = merge_eps(BE[sym], X.get(sym))
        Y = None
        if y:
            try:
                Y = y.summary(sym)
            except Exception as e:
                log('  야후 실패', sym, e)
        N = EP.nasdaq(sym)
        seq, st = EP.build(sym, prev, Y, N, cal.get(sym), today)
        o = dict(X.get(sym) or {})
        if seq and not st['warn']:
            d = delta_of(BE[sym], seq)
            if st['new']:
                log('  새 실제 EPS', sym, st['new'])
            o.update(d)
            o['src'], o['est_src'] = st.get('src'), st.get('est')
            o['at'] = today
        o['warn'] = st['warn'] or None
        o['wait'] = st['wait']
        X[sym] = {k: v for k, v in o.items() if v not in (None, [], '')}
    # 분기 재무 표
    import stmt as SM
    tc = SM.fund.ticker_cik()
    NEW = {}
    for sym in tg:
        if sym not in comp:
            continue
        fs = dict(FS.get(sym) or {})
        try:
            cik = tc.get(sym)
            sub = SM.subs(cik, 600 if quick else 3 * 3600) if cik else None   # 빠른 갱신 = 방금 낸 8-K 를 보려고 공시 목록을 10분 넘으면 다시 받음
            if sub and SM.is_xbrl(sub):
                cur, qr, ar, st = SM.us_rows(sym, cik, sub)
            else:
                b = comp[sym]
                shh = b['mcap_local'] / b['px_loc'] if b.get('mcap_local') and b.get('px_loc') else None
                cur, qr, ar, st = SM.foreign_rows(y, sym, b['loc'], shh) if y else (None, [], [], {'why': '야후 연결 실패'})
            NEW[sym] = ([dict(round_row(o), sym=sym) for o in qr], [dict(round_row(o), sym=sym) for o in ar], st)
            lq = qr[-1] if qr else None   # 표의 비율 칸을 반올림 전 값으로 (companies cur)
            cv = dict({k: round(lq[k], 4) for k in ('rev_g', 'opm', 'debt', 'icr', 'roe', 'sr') if isinstance(lq.get(k), (int, float))}, end=lq['end']) if lq else None
            fs.update({'src': st.get('src'), 'why': st.get('why'), 'press_fail': st.get('press_fail'), 'at': today, 'cv': cv})
        except Exception as e:
            log('  재무 실패', sym, e)
            fs.update({'why': str(e)[:200], 'at': today})
        FS[sym] = {k: v for k, v in fs.items() if v not in (None, [], '')}
    return {'c': X, 'fin': FS}, NEW, tg


B_BASIS = None


def qkey(ym):
    """'YYYY-MM' 분기 달 ↔ 분기 끝 날짜가 가까운지 (회사마다 그달 말·다음 달 초)"""
    return datetime.date.fromisoformat(ym + '-15')


def has_row(rows, q):
    """EPS 분기(y*12+월) 에 맞는 분기 재무 줄이 있나"""
    ym = '%04d-%02d' % ((q - 1) // 12, (q - 1) % 12 + 1)
    return next((o for o in reversed(rows or []) if abs((datetime.date.fromisoformat(o['end']) - qkey(ym)).days) <= 25), None)


def status_lists(X, cal, Qrows, syms, BE):
    """화면 알림용 — stale: 발표했는데 실제 EPS 아직 [티커, 발표일]
    rep: 기준 뒤 반영한 실적 [티커, 발표일, 분기 'YYYY-MM', 실제 EPS, 재무 줄 'press'(보도자료)|'sec'(정식 공시)|'yahoo'|None(아직)]"""
    stale, rep = [], []
    for sym in syms:
        x = (X.get('c') or {}).get(sym) or {}
        m = merge_eps(BE.get(sym), x)
        last = m['d'][-1] if m and m.get('d') else None
        lsd = (((cal.get(sym) or {}).get('ls') or {}).get('d'))
        if lsd and last and lsd > last:
            stale.append([sym, lsd])
        if x.get('a'):
            q, v = x['a'][-1]
            row = has_row(Qrows.get(sym), q)
            src = None
            if row:
                src = 'press' if row.get('supp') else ('yahoo' if (((X.get('fin') or {}).get(sym) or {}).get('src') == 'yahoo') else 'sec')
            rep.append([sym, x['d'][-1], '%04d-%02d' % ((q - 1) // 12, (q - 1) % 12 + 1), v, src])
    return sorted(stale, key=lambda x: (x[1], x[0])), sorted(rep, key=lambda x: (x[1], x[0]), reverse=True)


def main():
    global REPLAY, B_BASIS
    quick = '--quick' in sys.argv
    if '--replay' in sys.argv:
        REPLAY = os.path.abspath(sys.argv[sys.argv.index('--replay') + 1])
    base = load('base.json')
    B_BASIS = base['basis']
    frozen = base['basis']
    BE = base_eps(base)
    try:
        prevx = load('eps.json')
    except Exception:
        prevx = {}
    if prevx.get('basis') != base['basis']:      # 처음 · 기준(base.json)을 새로 뽑음 → 반영분을 처음부터(기준에 이미 들어간 분기는 다시 받지 않음)
        if prevx:
            log('기준이 바뀜', prevx.get('basis'), '→', base['basis'], '— 실적 반영분을 처음부터')
        prevx = {'c': {}, 'fin': {}}
    cal = calendar()
    # ① 실적 반영(EPS · 분기 재무) — 재현 확인 때는 하지 않음
    NEW, X = {}, prevx
    if not REPLAY:
        X0, NEW, tg = earnings(base, prevx, cal, quick)
        if X0 is None:
            if quick:
                log('새로 발표한 종목 없음 — 할 일 없음')
                return
            X0 = prevx
        X = X0
    EM = {t: merge_eps(BE[t], (X.get('c') or {}).get(t)) for t in BE} if not REPLAY else None
    # 기준 분기(처음 실행 때 지금 파일의 마지막 분기) — 그 뒤 줄이 붙은 종목은 표 칸을 줄에서 다시
    bq = dict(prevx.get('base_q') or {})
    if not bq:
        for e in ('soxx', 'soxq'):
            for sym, v in rows_of(load(e + '_fin.json'), 'q').items():
                bq[sym] = max(bq.get(sym, ''), v[-1]['end'])
    X = dict(X, base_q=bq, basis=base['basis'])
    out, summ, bad = {}, {}, []
    FS = dict(X.get('fin') or {})
    QALL = {}
    for etf in ('SOXX', 'SOXQ'):
        e = etf.lower()
        B = base['etf'][etf]
        pe = load(e + '_pe.json')
        cols = pe['c']
        old = [dict(zip(cols, r)) for r in pe['r']]
        chk, _ = pe_rows(etf, B)                     # 기준 EPS 로 다시 계산 = 기준일까지 저장값과 같아야(가격·바구니 확인)
        new, parts = pe_rows(etf, B, EM) if EM is not None else (chk, _)
        if not new or not chk:
            raise RuntimeError(etf + ' 일별 PER 을 하나도 못 만듦')
        om = {r['date']: r for r in old}
        pk = 'soxx' if etf == 'SOXX' else 'soxq'
        f_split = 1.0
        ob, nb = om.get(frozen), next((r for r in chk if r['date'] == frozen), None)
        if ob and nb and ob.get(pk) and nb.get(pk):
            f_split = nb[pk] / ob[pk]
            if abs(f_split - 1) < 0.02:
                f_split = 1.0
        for r in chk:
            if r['date'] > frozen or r['date'] not in om:
                continue
            o = om[r['date']]
            for k in ('pe_ttm', 'pe_mix', 'pe_ntm', 'cov', 'est', 'hold', 'sox') + ((pk,) if REPLAY else ()):
                if k not in r:
                    continue
                a, b = o.get(k), r.get(k)
                if a == b:
                    continue
                tol = 0 if REPLAY else 0.011 if k.startswith('pe') else 0.11   # 재현은 한 자리도 같아야 · 실제 갱신은 야후가 지난 종가를 아주 조금 고친 경우만 허용(반올림 한 칸)
                if not (isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= tol):
                    bad.append((etf, r['date'], k, a, b))
        if bad:
            for x in bad[:20]:
                log('  기준일 재현 다름', x)
            raise SystemExit(f'멈춤: 기준일까지 다시 계산한 일별 PER 이 저장값과 {len(bad)}곳 다름 — 가격 자료가 바뀌었거나 바구니가 틀림 (쓰지 않음)')
        if f_split != 1.0:
            log(f'  {etf}: 기준일 뒤 분할 {f_split:.4f} — 저장된 가격 칸을 같은 배율로 맞춤')
            for r in old:
                if r.get(pk) is not None:
                    r[pk] = round(r[pk] * f_split, 2)
        keep = [r for r in old if r['date'] <= frozen]
        add = [r for r in new if r['date'] > frozen]
        rows = keep + add
        if REPLAY:
            log(f'  {etf} 일별 PER: 재현 {sum(1 for r in chk if r["date"] <= frozen)}일 같음 · 마지막 {chk[-1]["date"]}')
        out[e + '_pe.json'] = dict(pe, asof=rows[-1]['date'], r=[[r.get(c) for c in cols] for r in rows])
        D = rows[-1]['date']   # 기업 표 기준일 = 이 ETF 의 마지막 PER 날짜
        fin = load(e + '_fin.json')
        # 새 분기 줄 붙이기
        Q, A = rows_of(fin, 'q'), rows_of(fin, 'a')
        for sym, (qr, ar, st) in NEW.items():
            if sym not in Q:
                continue
            Q[sym], c1 = merge_rows(Q[sym], qr)
            A[sym], c2 = merge_rows(A.get(sym, []), ar)
            if c1 or c2:
                log(f'  {etf} {sym}: 분기·연간 줄 반영 → 마지막 {Q[sym][-1]["end"]}' + (' (발표 자료)' if Q[sym][-1].get('supp') else ''))
                FS.setdefault(sym, {})['upd'] = 1
        for sym, v in Q.items():
            QALL[sym] = v
        upd = {sym for sym, v in Q.items() if v and (v[-1]['end'] > bq.get(sym, '9999') or (FS.get(sym) or {}).get('upd'))}
        comp, fx, miss = companies(etf, B, D, fin, EM, {k: (Q[k], A.get(k, []), (FS.get(k) or {}).get('src') == 'yahoo', (FS.get(k) or {}).get('cv')) for k in upd}, upd)
        if REPLAY:   # 기준일 재현: 기업 표 = 게시본
            want = {r[0]: dict(zip(fin['c']['c'], r)) for r in fin['c']['r']}
            dif = [(c['sym'], k, want[c['sym']].get(k), c.get(k)) for c in comp for k in fin['c']['c'] if c.get(k) != want[c['sym']].get(k)]
            if dif:
                for x in dif[:20]:
                    log('  기업 표 재현 다름', x)
                raise SystemExit(f'{etf} 기업 표 재현 {len(dif)}곳 다름')
            log(f'  {etf} 기업 표: 30종목 · {len(fin["c"]["c"])}칸 모두 같음')
        cc = fin['c']['c'] + (['pxd'] if 'pxd' not in fin['c']['c'] else [])
        qc = fin['q']['c']
        syms_c = [c['sym'] for c in comp]
        stale, rep = status_lists(dict(X, fin=FS), cal, Q, syms_c, BE)
        nf = dict(fin, asof=D, c={'c': cc, 'r': [[c.get(k) for k in cc] for c in comp]},
                  q={'c': qc, 'r': [[o.get(k) for k in qc] for sym in Q for o in Q[sym]]},
                  a={'c': fin['a']['c'], 'r': [[o.get(k) for k in fin['a']['c']] for sym in A for o in A[sym]]},
                  stale=stale, rep=rep, miss=miss)
        if not REPLAY:
            krw = chart('KRW=X')['meta']
            if krw.get('regularMarketPrice') and krw.get('regularMarketTime'):
                at = datetime.datetime.fromtimestamp(krw['regularMarketTime'], datetime.timezone.utc)
                nf['fx'] = {'pair': 'USD/KRW', 'rate': round(krw['regularMarketPrice'], 2), 'at': at.strftime('%Y-%m-%dT%H:%M:%SZ'),
                            'at_kst': at.astimezone(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M'), 'source': 'Yahoo Finance KRW=X'}
        out[e + '_fin.json'] = nf
        last = rows[-1]
        sm = {'date': last['date'], 'px': last.get(pk), 'cov': last.get('cov'), 'est': last.get('est')}
        for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
            vals = [r.get(k) for r in rows]
            v = [x for x in vals if x is not None]
            sm[k] = last.get(k)
            sm[k + '_p'] = R(pctl(vals, last.get(k)), 1)
            sm[k + '_lo'] = min(v) if v else None
            sm[k + '_hi'] = max(v) if v else None
        sm['mcap'] = R(sum(c.get('mcap_usd') or 0 for c in comp), 0)
        # 화면 실시간 반영용 ([SEMIS] computeLive · Worker /qs) — 마지막 날 지수 PER 바구니(계산에 넣은 종목)의 보유액 비중·그날 종가 · 기업 표 종목
        #   화면: 실시간 PER = 마지막 PER × Σ 비중 × (지금 가격 ÷ 그날 종가)  (그날 EPS 는 같으므로 PER 은 바구니 가격에 비례)
        if last['date'] not in parts:
            raise RuntimeError(f'{etf} 마지막 날 {last["date"]} 바구니가 없음')
        cv, pp = parts[last['date']]
        sm['live'] = {'d': last['date'], 'pos': [[t, round(v / cv, 6), round(p, 4)] for t, v, p in sorted(pp, key=lambda x: -x[1])],
                      'syms': [[c['sym'], c.get('mcap_usd'), c.get('px'), c.get('pxd') or D] for c in comp]}   # 기업 표: 티커·시가총액(달러)·종가·그 날짜
        sm['stale'], sm['rep'] = stale, rep[:12]
        summ[e] = sm
    if REPLAY:
        log('재현 확인 끝 — 기준일 일별 PER·기업 표가 게시본과 같음 (쓰지 않음)')
        return
    # 재무 표 대기: 실제 EPS 는 반영했는데 그 분기 재무 줄이 아직 없음(보도자료 표를 못 읽음 · 해외 회사 야후 재무 늦음) → 빠른 갱신 때 다시 봄
    for sym, rows in QALL.items():
        e = (EM or {}).get(sym)
        acts = [v for v in (e or {}).get('s', []) if not v[2]]
        fs = dict(FS.get(sym) or {})
        if acts and not has_row(rows, acts[-1][0]):
            fs['pending'] = 1
        else:
            fs.pop('pending', None)
        if fs:
            FS[sym] = fs
    X = dict(X, fin=FS)
    # 바뀐 것만 씀 (updated 는 내용이 바뀔 때만)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    out['eps.json'] = dict(X)
    changed = []
    for n, o in out.items():
        try:
            cur = load(n)
        except Exception:
            cur = {}
        a = dict(cur); a.pop('updated', None)
        b = dict(o); b.pop('updated', None)
        if a != b:
            o['updated'] = now
            save(n, o)
            changed.append(n)
    ats = [v.get('at') for v in (X.get('c') or {}).values() if v.get('at')]
    sm = {'updated': now, 'basis': base['basis'], 'eps_asof': base['eps_asof'], 'eps_at': max(ats) if ats else base['eps_asof'],
          'fx': out['soxx_fin.json']['fx'], 'soxx': summ['soxx'], 'soxq': summ['soxq']}
    try:
        cur = load('summary.json')
    except Exception:
        cur = {}
    a = dict(cur); a.pop('updated', None)
    b = dict(sm); b.pop('updated', None)
    if a != b:
        save('summary.json', sm)
        changed.append('summary.json')
    log('바뀐 파일:', changed or '없음', '· SOXX', summ['soxx']['date'], summ['soxx']['pe_ttm'], summ['soxx']['pe_mix'], summ['soxx']['pe_ntm'],
        '· SOXQ', summ['soxq']['date'], summ['soxq']['pe_ttm'], summ['soxq']['pe_mix'], summ['soxq']['pe_ntm'],
        '· 반영 대기', summ['soxx']['stale'] + summ['soxq']['stale'] or '없음')


if __name__ == '__main__':
    main()
