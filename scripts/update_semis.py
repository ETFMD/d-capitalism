#!/usr/bin/env python3
"""[SEMIS] 'SOX와 NYSE 반도체 지수 분석' 자동 갱신 — 미국장 마감 뒤 종가·환율로 PER·시가총액·비중·일별 PER 을 다시 계산 (표준 라이브러리만)

자료 (data/semis/)
  base.json        고정값 — scripts/semis/extract_base.py 가 SOXX·SOXQ 대시보드 파이프라인에서 만듦(EPS·재무 기준일 eps_asof)
  soxx_fin.json · soxq_fin.json   구성 종목 표(c) · 분기(q) · 연간(a) — 이 스크립트는 c(가격에 따라 바뀌는 칸)·fx·stale 만 다시 씀
  soxx_pe.json  · soxq_pe.json    일별 PER — frozen(기준일)까지는 파이프라인 값 그대로, 그 뒤 날짜는 매번 다시 계산
  summary.json                    맨 위 요약(지수 PER 지금 값·역대 위치·합계)

계산 (파이프라인과 같은 식 — 기준일 값을 똑같이 다시 만들어 보고 다르면 멈춤)
  · 기업 PER(후행·혼합·선행) = 미국 상장 가격 ÷ 조정 EPS(고정) → 기준 PER × (오늘 가격 ÷ 기준일 가격)   ※ 같은 내려받기 안의 비율이라 그 사이 주식 분할에도 맞음
  · 시가총액(현지 통화) = 기준 시가총액 × 현지 가격 비율 · 달러 환산 = × 그날 환율(대만달러·유로·원) · 회계 PER = 시가총액 ÷ 최근 4개 분기 순이익 · PBR·배당수익률도 같은 비율
  · ETF 비중 = 보유 주식 수(SOXX: Zacks 2026-09-30 · SOXQ: Zacks 2026-10-02) × 가격 → 합 100%
  · 일별 PER = Σ 보유 주식 수 × 그날 종가 ÷ Σ 보유 주식 수 × EPS (적자 포함 합산 · 마지막 보유 내역 · 종목별 EPS 는 발표 순서로 그날까지 발표된 분기)
  · EPS·재무(분기·연간 실적)는 eps_asof 이후 실적 발표를 반영하지 못함 → stale(그 뒤 실적을 발표한 종목 · data/earnings.json 의 발표일)로 화면에 알림
    → 반영하려면 파이프라인을 다시 돌리고 extract_base.py 로 base.json·자료를 다시 만듦

  python3 scripts/update_semis.py                 # 야후(→ 실패하면 사이트 Worker) 종가로 갱신
  python3 scripts/update_semis.py --replay <ws>   # 파이프라인 작업 공간의 저장된 종가로 기준일을 다시 계산해 게시본과 같은지만 확인(쓰지 않음)
"""
import datetime, json, math, os, sys, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIR = os.path.join(ROOT, 'data', 'semis')
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


def pe_rows(etf, B):
    """마지막 보유 내역을 쓰는 첫날(B['from'])부터 오늘까지 일별 PER 다시 계산 (daily.py · soxq_daily.py 와 같은 식·반올림)"""
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
        pos.append((x['t'], x['v'] / p0, p0 / x['p0'], c, P['eps'].get(x['t'])))   # n = 보유액 ÷ 오늘 받은 보유일 가격 · EPS 배율 = 분할 보정
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


def companies(etf, B, D, fin):
    """구성 종목 표의 가격 칸 — D(그날 미국 종가 날짜) 기준"""
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
        ru, rl = pu1 / pu0, pl1 / pl0
        f = b['fx'] if REPLAY else fx.get(b['cur'])
        if f is None:
            raise RuntimeError(f'{b["cur"]} 환율 없음')
        ml = b['mcap_local'] * rl if b['mcap_local'] else None
        c['px'] = R(pu1 if not REPLAY else b['px_us'] * ru, 2)
        c['mcap_local'] = R(ml, 0)
        c['mcap_usd'] = R(ml * f, 0) if ml else None
        for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
            c[k] = R(b[k] * ru, 1) if b.get(k) is not None else None
        ni = b.get('ni_ttm')
        c['pe_gaap'] = R(ml / ni, 1) if ni and ni > 0 and ml else None
        c['pbr'] = R(b['pbr'] * rl, 2) if b.get('pbr') is not None else None
        c['dy'] = R(b['dy'] / rl, 2) if b.get('dy') is not None else None
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


def stale_of(syms, eps_asof):
    """eps_asof 뒤에 실적을 발표한 종목 (실적발표 캘린더 자료 data/earnings.json 의 최근 발표일)"""
    try:
        with open(os.path.join(ROOT, 'data', 'earnings.json'), encoding='utf-8') as f:
            us = {r['s']: r for r in json.load(f).get('us') or []}
    except Exception:
        return []
    out = []
    for s in syms:
        r = us.get(s)
        d = ((r or {}).get('ls') or {}).get('d')
        if d and d > eps_asof:
            out.append([s, d])
    return sorted(out, key=lambda x: (x[1], x[0]))


B_BASIS = None


def main():
    global REPLAY, B_BASIS
    if '--replay' in sys.argv:
        REPLAY = os.path.abspath(sys.argv[sys.argv.index('--replay') + 1])
    base = load('base.json')
    B_BASIS = base['basis']
    frozen = base['basis']
    out, summ, bad = {}, {}, []
    for etf in ('SOXX', 'SOXQ'):
        e = etf.lower()
        B = base['etf'][etf]
        pe = load(e + '_pe.json')
        cols = pe['c']
        old = [dict(zip(cols, r)) for r in pe['r']]
        new, parts = pe_rows(etf, B)
        if not new:
            raise RuntimeError(etf + ' 일별 PER 을 하나도 못 만듦')
        # 기준일까지(파이프라인 값)와 다시 계산한 값이 같아야 함 — 가격 칸은 그 뒤 분할이 있으면 배율만큼 다름
        om = {r['date']: r for r in old}
        pk = 'soxx' if etf == 'SOXX' else 'soxq'
        f_split = 1.0
        ob, nb = om.get(frozen), next((r for r in new if r['date'] == frozen), None)
        if ob and nb and ob.get(pk) and nb.get(pk):
            f_split = nb[pk] / ob[pk]
            if abs(f_split - 1) < 0.02:
                f_split = 1.0
        for r in new:
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
            log(f'  {etf} 일별 PER: 재현 {sum(1 for r in new if r["date"] <= frozen)}일 같음 · 마지막 {new[-1]["date"]}')
        out[e + '_pe.json'] = dict(pe, asof=rows[-1]['date'], r=[[r.get(c) for c in cols] for r in rows])
        D = rows[-1]['date']   # 기업 표 기준일 = 이 ETF 의 마지막 PER 날짜
        fin = load(e + '_fin.json')
        comp, fx, miss = companies(etf, B, D, fin)
        if REPLAY:   # 기준일 재현: 기업 표 = 게시본
            want = {r[0]: dict(zip(fin['c']['c'], r)) for r in fin['c']['r']}
            dif = [(c['sym'], k, want[c['sym']].get(k), c.get(k)) for c in comp for k in fin['c']['c'] if c.get(k) != want[c['sym']].get(k)]
            if dif:
                for x in dif[:20]:
                    log('  기업 표 재현 다름', x)
                raise SystemExit(f'{etf} 기업 표 재현 {len(dif)}곳 다름')
            log(f'  {etf} 기업 표: 30종목 · {len(fin["c"]["c"])}칸 모두 같음')
        cc = fin['c']['c'] + (['pxd'] if 'pxd' not in fin['c']['c'] else [])
        nf = dict(fin, asof=D, c={'c': cc, 'r': [[c.get(k) for k in cc] for c in comp]}, stale=stale_of([c['sym'] for c in comp], base['eps_asof']), miss=miss)
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
        #   화면: 실시간 PER = 마지막 PER × Σ 비중 × (지금 가격 ÷ 그날 종가)  (EPS 고정이라 PER 은 바구니 가격에 비례)
        if last['date'] not in parts:
            raise RuntimeError(f'{etf} 마지막 날 {last["date"]} 바구니가 없음')
        cv, pp = parts[last['date']]
        sm['live'] = {'d': last['date'], 'pos': [[t, round(v / cv, 6), round(p, 4)] for t, v, p in sorted(pp, key=lambda x: -x[1])],
                      'syms': [[c['sym'], c.get('mcap_usd'), c.get('px'), c.get('pxd') or D] for c in comp]}   # 기업 표: 티커·시가총액(달러)·종가·그 날짜
        sm['stale'] = nf['stale']
        summ[e] = sm
    if REPLAY:
        log('재현 확인 끝 — 기준일 일별 PER·기업 표가 게시본과 같음 (쓰지 않음)')
        return
    # 바뀐 것만 씀 (updated 는 내용이 바뀔 때만)
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    changed = []
    for n, o in out.items():
        cur = load(n)
        a = dict(cur); a.pop('updated', None)
        b = dict(o); b.pop('updated', None)
        if a != b:
            o['updated'] = now
            save(n, o)
            changed.append(n)
    sm = {'updated': now, 'basis': base['basis'], 'eps_asof': base['eps_asof'], 'fx': out['soxx_fin.json']['fx'], 'soxx': summ['soxx'], 'soxq': summ['soxq']}
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
        '· SOXQ', summ['soxq']['date'], summ['soxq']['pe_ttm'], summ['soxq']['pe_mix'], summ['soxq']['pe_ntm'])


if __name__ == '__main__':
    main()
