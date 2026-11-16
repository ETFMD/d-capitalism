#!/usr/bin/env python3
"""[USIDX] 게시 자료 만들기 — data/usidx/
  summary.json            두 지수 지금 PER(회계 기준 일별 계산의 마지막 날 + 나스닥 조정 EPS 기준) · 역대 위치 · 실시간 바구니
  ndx_pe.json · spx_pe.json   일별 [날짜, ETF 종가, 후행, 혼합, 선행, 계산 비중, 예상 비중, 보유 기준일]
  ndx_fin.json · spx_fin.json 구성 종목 표 (지금 바구니)
  co/<티커>.json          기업 상세 (분기·연간 재무 표 · 14개 차트 자료) — 고를 때만 받음
사용: update_usidx.py 가 원자료를 새로 받은 뒤 build.run() 을 부름"""
import bisect, datetime as dt, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT, jload, jsave, rpath, log   # noqa: E402
import calc, consensus, current, dimeps, fin, prices   # noqa: E402

ETFS = {'ndx': ('qqq', 'QQQ'), 'spx': ('spy', 'SPY')}
FCOLS = ['sym', 'ko', 'name', 'seg', 'weight', 'cur', 'mcap_usd', 'px', 'pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap', 'pbr', 'roe', 'rev_ttm', 'rev_g',
         'opm', 'ni_ttm', 'debt', 'icr', 'dy', 'sr', 'last_q', 'since_q', 'since_a', 'nq', 'na', 'pxd', 'eps_d', 'pend', 'dup']
PCOLS = ['end', 'label', 'rev', 'rev_g', 'oi', 'opm', 'ni', 'ocf', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr', 'mcap', 'oi_est']


def R(v, n):
    return None if v is None else round(v, n)


def label_q(e, fye):
    """분기 이름 — 회계연도 기준이 달라 '2026.09' 처럼 기간 말 연·월로"""
    return e[:4] + '.' + e[5:7]


def ko_names():
    """한국어 이름: 실적 캘린더(update_earnings.py US_KO) + scripts/usidx/names_ko.json"""
    import importlib.util
    out = {}
    try:
        spec = importlib.util.spec_from_file_location('ue', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update_earnings.py'))
        src = open(spec.origin, encoding='utf-8').read()
        i = src.index('US_KO = {')
        j = src.index('}', i)
        out.update(eval(src[i + 8:j + 1]))
    except Exception as e:
        log('US_KO 못 읽음', e)
    out.update(jload(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'names_ko.json'), {}))
    return out


def adj_pe(px, ns):
    """나스닥 조정 EPS 기준 PER (후행 = 최근 4개 분기 실제 · 혼합 = 최근 2개 + 다음 2개 예상 · 선행 = 다음 4개 예상) + EPS 기준 날짜"""
    if not ns or not px:
        return None, None, None, None
    sur = ns.get('sur') or []
    last = sur[-1][0] if sur else None
    fq = [r for r in (ns.get('fq') or []) if r[1] is not None and (not last or r[0] > last)]
    t = sum(r[2] for r in sur[-4:]) if len(sur) >= 4 else None
    m = (sum(r[2] for r in sur[-2:]) + sum(r[1] for r in fq[:2])) if len(sur) >= 2 and len(fq) >= 2 else None
    f = sum(r[1] for r in fq[:4]) if len(fq) >= 4 else None
    pe = lambda e: R(px / e, 1) if e and e > 0 else None
    return pe(t), pe(m), pe(f), (sur[-1][1] if sur else None)


def make_co(c, cmc, p, sym, cur, ns, today, last):
    """증권 EPS — 지금 구성 종목인데 마지막 거래일 PER 을 못 내면(최근 분기 EPS 가 클래스별로만 공시됨) 공시 원문에서 클래스 EPS 를 읽어 다시"""
    def mk(dim=None):
        co = calc.Co(c, cmc, p, sym, dim)
        if cur:
            co.extend(ns, today)
            co.pad(today)
        else:
            co.pad()
        co.arrays()
        return co
    co = mk()
    if cur and co.at(last) is None and sym not in dimeps.SPECIAL:
        dim = {}
        for k in [x for x in (cmc.get('cik'), cmc.get('cur')) if x]:
            r = dimeps.auto(k, sym)
            if r:
                dim[k] = r
        if dim:
            co2 = mk(dim)
            if co2.at(last) is not None:
                log('클래스별 EPS 로 채움', sym, list(dim))
                return co2
    return co


def run(today=None, write=True):
    today = today or dt.date.today().isoformat()
    import holdings, cik as CK
    H = {e: holdings.all_holdings(e, refresh=False) for e in ('qqq', 'spy')}
    tick = jload(rpath('tick.json'))
    cm = jload(rpath('cikmap.json'))
    t2c, c2t = CK.ticker_maps()
    S = current.screener()
    try:
        G = current.gics()
    except Exception as e:
        log('위키 GICS 실패 — 나스닥 섹터로', e)
        G = {}
    KO = ko_names()

    # ── 지금 바구니 (SPY 운용사 · QQQ 구성 + N-PORT) ──
    spyn = current.spy_now()
    lastq = [h for h in H['qqq'] if h['form'] == 'NPORT-P'][-1]

    def pxat(t, d):
        o = prices.chart(t, max_age=6 * 3600)
        return prices.actual(o, d) if o else None
    qqqn = current.qqq_now(lastq, tick, pxat)
    bytick = {}                                   # 티커 → 예전 보유 내역의 CUSIP (가장 최근 것) — 지주회사 전환 등으로 CUSIP·CIK 만 바뀐 회사(엑슨모빌 2026 등)
    for e in H:
        for h in H[e]:
            for r in h['rows']:
                if r.get('cusip') and tick.get(r['cusip']):
                    bytick[tick[r['cusip']]] = r['cusip']
    for snap in (spyn, qqqn):
        for r in snap['rows']:
            c = r.get('cusip') or ('T:' + r['tick'])
            if r.get('cusip') and tick.get(c) and tick[c] != r['tick']:   # 같은 CUSIP 인데 티커가 바뀜 → 지금 티커
                tick[c] = r['tick']
            r['cusip'] = c
            if not tick.get(c):
                tick[c] = r['tick']
            k = t2c.get(r['tick'])
            if c not in cm or not cm[c].get('cik'):
                old = cm.get(bytick.get(r['tick'])) or {}
                cm[c] = {'cik': old.get('cik') or k, 'cur': k or old.get('cur'), 'cands': [x for x in (old.get('cik'), k) if x]}
            elif k and cm[c].get('cur') != k:
                cm[c]['cur'] = k
    H2 = {'qqq': [h for h in H['qqq']] + [qqqn], 'spy': [h for h in H['spy']] + [spyn]}
    cur_syms = {r['tick'] for s in (spyn, qqqn) for r in s['rows']}

    # ── 가격: 지금 구성 종목·ETF 는 새로(최근 45일 이어 붙임) · 나머지(옛 종목)는 보관본 ──
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(lambda t: prices.chart(t, max_age=6 * 3600), sorted(cur_syms | {'QQQ', 'SPY'})))
    # ── 증권별 가격·EPS ──
    days, _ = prices.trade_days()
    days = [d for d in days if d >= calc.START]
    pxs, cos = {}, {}
    NS = consensus.get_all(sorted(cur_syms))
    for e in H2:
        for h in H2[e]:
            for r in h['rows']:
                c = r.get('cusip')
                if not c or c in pxs:
                    continue
                p = calc.px_series(c, tick)
                pxs[c] = p
                if not p or not (cm.get(c) or {}).get('cik') and not (cm.get(c) or {}).get('cur'):
                    continue
                sym = tick.get(c)
                co = make_co(c, cm[c], p, sym, sym in cur_syms, NS.get(sym), today, days[-1])
                cos[c] = co
    log('증권', len(pxs), '· 가격 있음', sum(1 for p in pxs.values() if p), '· EPS', len(cos))

    out, summ = {}, {}
    for key, (etf, ETF) in ETFS.items():
        ep = calc.Px(prices.chart(ETF))
        rows, bk = calc.daily(H2[etf], cos, pxs, ep, days)
        out[key + '_pe.json'] = {'etf': ETF, 'asof': rows[-1][0], 'c': ['date', etf, 'pe_ttm', 'pe_mix', 'pe_ntm', 'cov', 'est', 'hold'], 'r': rows}
        t, snap, items, num, dt_, dm, dn = bk
        last = rows[-1]
        sm = {'date': last[0], 'px': last[1], 'cov': last[5], 'est': last[6], 'hold': snap['date'], 'n': len(snap['rows'])}
        for i, k in ((2, 'pe_ttm'), (3, 'pe_mix'), (4, 'pe_ntm')):
            vals = [r[i] for r in rows if r[i] is not None]
            v = last[i]
            sm[k] = v
            sm[k + '_p'] = R(sum(1 for x in vals if x < v) / len(vals) * 100, 1) if v is not None and vals else None
            sm[k + '_lo'] = min(vals) if vals else None
            sm[k + '_hi'] = max(vals) if vals else None
        sm['live'] = {'d': t, 'pos': [[tick.get(c), R(n * p / num, 6), R(p, 4)] for c, n, p, *_ in sorted(items, key=lambda x: -x[1] * x[2])]}
        summ[key] = sm
        log(ETF, last)

    # ── 구성 종목 표·기업 상세 ──
    hint = share_hint((spyn, qqqn), S)
    coinfo = {}
    for key, (etf, ETF) in ETFS.items():
        snap = spyn if etf == 'spy' else qqqn
        tot = sum(r['val'] for r in snap['rows'])
        comp = []
        for r in snap['rows']:
            c, t = r['cusip'], r['tick']
            p = pxs.get(c)
            row = {'sym': t, 'ko': KO.get(t) or KO.get(t.replace('-', '.')), 'name': (S.get(t) or ('',))[0] or r['name'], 'seg': current.sector_of(t, G, S),
                   'weight': R(r['val'] / tot * 100, 3), 'cur': 'USD'}
            pr = p.at(today, 7) if p else None
            pd_ = p.d[-1] if p else None
            if t not in coinfo:
                coinfo[t] = company(t, c, cm.get(c) or {}, p, cos.get(c), NS.get(t), S, hint.get(t), today)
            ci = coinfo[t]
            row.update({k: ci.get(k) for k in ('cur', 'mcap_usd', 'pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap', 'pbr', 'roe', 'rev_ttm', 'rev_g', 'opm', 'ni_ttm', 'debt',
                                               'icr', 'dy', 'sr', 'last_q', 'since_q', 'since_a', 'nq', 'na', 'eps_d', 'pend')})
            row['px'] = R(pr, 2)
            row['pxd'] = pd_
            comp.append(row)
        comp.sort(key=lambda x: -(x['weight'] or 0))
        uniq = {id(c) for c in comp_u(comp)}
        for c in comp:
            c['dup'] = None if id(c) in uniq else 1          # 같은 회사의 두 번째 클래스(GOOG·FOX·NWS) — 시가총액 합계에서 뺌
        out[key + '_fin.json'] = {'etf': ETF, 'asof': snap['date'], 'hold': snap['date'], 'nport': snap.get('nport'),
                                  'c': {'c': FCOLS, 'r': [[x.get(k) for k in FCOLS] for x in comp]}}
        summ[key]['adj'] = basket_adj(comp)
        summ[key]['syms'] = len(comp)
        summ[key]['mcap'] = R(sum(c.get('mcap_usd') or 0 for c in comp_u(comp)), 0)
        summ[key]['live']['syms'] = [[c['sym'], c.get('mcap_usd'), c.get('px'), c.get('pxd')] for c in comp_u(comp)]   # 화면 실시간 시가총액(회사 하나에 클래스 여럿이면 하나만)
        summ[key]['pend'] = sorted([[c['sym'], c['pend']] for c in comp if c.get('pend')], key=lambda x: (x[1], x[0]))
    summ['fx'] = fx_now()
    if not write:
        return out, summ, coinfo
    write_all(out, summ, coinfo)
    return out, summ, coinfo


def comp_u(comp):
    """시가총액 합계용 — 같은 회사의 여러 클래스(GOOGL·GOOG, FOXA·FOX, NWSA·NWS)는 한 번만(이름 기준)"""
    seen, out = set(), []
    for c in comp:
        k = (c.get('name') or c['sym']).split(' Class')[0].split(' Common')[0].split(' Capital')[0]
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
    return out


def fx_now():
    o = prices.chart('KRW=X', start='2026-01-01', force=True)
    m = (o or {}).get('meta') or {}
    if not (m.get('regularMarketPrice') and m.get('regularMarketTime')):
        return None
    at = dt.datetime.fromtimestamp(m['regularMarketTime'], dt.timezone.utc)
    from zoneinfo import ZoneInfo
    return {'pair': 'USD/KRW', 'rate': round(m['regularMarketPrice'], 2), 'at': at.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'at_kst': at.astimezone(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M'), 'source': 'Yahoo Finance KRW=X'}


def share_hint(snaps, S):
    """ETF 가 가진 주식 수로 거꾸로 짐작한 회사 주식 수(유동 주식 기준) {티커: 주식 수}
    · SPY(먼저)·QQQ 는 모든 구성 종목의 유동 주식을 거의 같은 비율로 가짐 → 비율 = 중앙값(ETF 보유 주식 ÷ 나스닥 주식 수)
    · 표지 주식 수 × 가격과 나스닥 시가총액이 25% 넘게 다를 때 어느 쪽이 맞는지 가르는 데만 씀
      (나스닥 시가총액이 틀린 경우 — 윌리엄스 2026-11 두 배 · 합병 직후 표지 주식 수가 옛것인 경우 — 킴벌리클라크 켄뷰 인수)"""
    out = {}
    for snap in snaps:
        rs = [(r['tick'], r['sh']) for r in snap['rows'] if r.get('sh') and not r.get('est')]
        rat = sorted(n / (S[t][2] / S[t][3]) for t, n in rs if S.get(t) and S[t][2] and S[t][3])
        if len(rat) < 50:
            continue
        f = rat[len(rat) // 2]
        for t, n in rs:
            out.setdefault(t, n / f)
    return out


def basket_adj(comp):
    """지금 바구니의 조정 EPS 기준 PER — 비중 ÷ PER 합의 역수(= 시가총액 합 ÷ 이익 합과 같은 가중 조화평균) · 적자(음수 PER 없음)는 이익 0 으로"""
    out = {}
    for k in ('pe_ttm', 'pe_mix', 'pe_ntm'):
        w = s = 0.0
        for c in comp:
            if c.get('weight') is None:
                continue
            w += c['weight']
            if c.get(k):
                s += c['weight'] / c[k]
        cov = sum(c['weight'] for c in comp if c.get(k)) / w * 100 if w else 0
        out[k] = R(w / s, 2) if s > 0 else None
        out[k + '_cov'] = R(cov, 1)
    return out


def co_eps(co, e, tol=10):
    """증권 EPS 시계열(co)에서 분기 말 e(±tol일) 의 (그 분기 EPS, 4개 분기 합) — 오늘 주식 수 기준 달러 · 회계 공시('x')·발표 뒤 환산('a') 만"""
    if not co or not getattr(co, 'E', None):
        return None, None
    i = bisect.bisect_left(co.E, e)
    best = None
    for j in (i - 1, i):
        if 0 <= j < len(co.E) and abs(calc.days(co.E[j], e)) <= tol and (best is None or abs(calc.days(co.E[j], e)) < abs(calc.days(co.E[best], e))):
            best = j
    if best is None:
        return None, None
    q = co.V[best] if co.S[best] == 'x' else None
    if best < 3 or any(co.V[j] is None or co.S[j] not in ('x', 'a') for j in range(best - 3, best + 1)):
        return q, None
    return q, sum(co.V[best - 3:best + 1])


def implied_sh(Q, co, p, cur, t):
    """분기 순이익 ÷ 분기 EPS = 그 EPS 가 기준으로 삼은 주식 수(원주) — 표지·가중평균 주식 수가 없거나 엉뚱할 때(여러 클래스·단위 오류) 씀
    · 같은 부호 · |EPS| ≥ 0.05달러(반올림 오차) · 재무 통화 → 달러 · 그때 주식 수 기준(뒤 분할 되돌림) · ADR·버크셔 배수"""
    mult = calc.ADR.get(t, 1.0) * calc.SHARE_MULT.get(t, 1.0)
    for e, r in Q.items():
        ni = r.get('ni')
        q, _ = co_eps(co, e, 7)
        if not ni or not q or (ni > 0) != (q > 0) or abs(q) < 0.05:
            continue
        fx = calc.fx_at(cur, e) if cur and cur != 'USD' else 1.0
        if not fx:
            continue
        imp = (ni / fx) / (q * calc.sfac(p.s, e)) * mult
        sh = r.get('sh')
        if not sh:
            r['sh'], r['sh_imp'] = imp, 1
        elif not (1 / 3 <= sh / imp <= 3) and abs(q) >= 0.10:     # 세 배 넘게 다름 = 한 클래스만(이리 인뎀니티 B주 2,542주 등) → 순이익 기준
            r['sh'], r['sh_imp'] = imp, 1


def company(t, c, cmc, p, co, ns, S, hint=None, today=None):
    """기업 한 곳의 표 칸 + 상세 파일 내용
    · 회계 PER(pe_gaap) = 오늘 종가 ÷ 최근 4개 분기 회계 EPS 합(증권 EPS 시계열 — 지수 PER 과 같은 값) · 없으면 시가총액 ÷ 순이익
    · 기간 표 PER = 그 분기 말 종가 ÷ 4개 분기 회계 EPS · 시가총액 = 주식 수 × 종가(주식 수가 없거나 엉뚱하면 순이익 ÷ EPS)"""
    ciks = [k for k in (cmc.get('cik'), cmc.get('cur')) if k]
    if len(ciks) == 2 and ciks[0] == ciks[1]:
        ciks = ciks[:1]
    out = {'cur': 'USD'}
    pr = p.c[-1] if p else None
    out['pe_ttm'], out['pe_mix'], out['pe_ntm'], out['eps_d'] = adj_pe(pr, ns)
    if not ciks or not p:
        out['mcap_usd'] = (S.get(t) or (None, None, None))[2]
        return out
    cur, Q, A = fin.collect(ciks)
    out['cur'] = cur or 'USD'
    implied_sh(Q, co, p, cur or 'USD', t)
    for e, r in A.items():                                             # 연간 줄 = 같은 날 끝나는 분기 줄의 주식 수
        if e in Q and Q[e].get('sh_imp'):
            r['sh'] = Q[e]['sh']
    pxf = lambda d: (p.at(d, 7) * calc.sfac(p.s, d)) if p.at(d, 7) else None   # 그날 실제 종가
    qr, ar = fin.derive(cur or 'USD', Q, A, pxf, t)
    for rows in (qr, ar):                                              # 기간 표 PER = 종가 ÷ 4개 분기 회계 EPS (주식 수 기준이 달라도 맞음)
        for o in rows:
            _, ttm = co_eps(co, o['end'])
            px_e = p.at(o['end'], 7)
            if ttm is not None and px_e:
                o['per'] = px_e / ttm if ttm > 0 else None
    lq = qr[-1] if qr else {}
    mc_now = None
    if lq.get('sh') and pr:
        sh_now = lq['sh'] * calc.sfac(p.s, lq['end'])                 # 그 뒤 분할 반영(오늘 주식 수 기준)
        mc_now = sh_now * pr / calc.ADR.get(t, 1.0) / calc.SHARE_MULT.get(t, 1.0)
    scr = (S.get(t) or (None, None, None))[2]
    if scr and (not mc_now or abs(mc_now / scr - 1) > 0.25):        # 나스닥 시가총액과 25% 넘게 다름
        if mc_now and hint and pr:                                      # ETF 보유 주식으로 짐작한 주식 수에 더 가까운 쪽
            hm = hint * pr
            if abs(math.log(scr / hm)) < abs(math.log(mc_now / hm)):
                mc_now = scr
        else:                                                           # 표지 주식 수 없음 → 나스닥 시가총액(회사 전체)
            mc_now = scr
    out['mcap_usd'] = R(mc_now, 0)
    fxn = 1.0 if (cur or 'USD') == 'USD' else (calc.fx_at(cur, dt.date.today().isoformat()) or None)
    mcl = mc_now * fxn if mc_now and fxn else None                     # 재무 통화 기준
    ni = lq.get('ni_ttm')
    a = co.at(today or dt.date.today().isoformat()) if co and getattr(co, 'E', None) else None
    if a and pr:                                                        # 오늘 종가 ÷ 최근 4개 분기 회계 EPS
        out['pe_gaap'] = R(pr / a[0], 1) if a[0] > 0 else None
    else:
        out['pe_gaap'] = R(mcl / ni, 1) if mcl and ni and ni > 0 else None
    out['pbr'] = R(mcl / lq['eq'], 2) if mcl and lq.get('eq') and lq['eq'] > 0 else None
    out['dy'] = R(lq['div_ttm'] / mcl * 100, 2) if mcl and lq.get('div_ttm') is not None else None
    for k in ('roe', 'rev_g', 'opm', 'debt', 'icr', 'sr'):
        out[k] = R(lq.get(k), 1)
    out['rev_ttm'], out['ni_ttm'] = R(lq.get('rev_ttm'), 0), R(ni, 0)
    out['last_q'] = lq.get('end')
    out['since_q'] = qr[0]['end'] if qr else None
    out['since_a'] = ar[0]['end'] if ar else None
    out['nq'], out['na'] = len(qr), len(ar)
    if ns and ns.get('sur') and lq.get('end'):
        y, rd = ns['sur'][-1][0], ns['sur'][-1][1]
        mi = lambda s: int(s[:4]) * 12 + int(s[5:7])
        if mi(y) > mi(lq['end']) + 1:                                 # 나스닥 분기 이름(끝 달)이 마지막 공시 분기보다 2달 넘게 뒤 = 다음 분기
            out['pend'] = rd                                            # 실적은 발표했지만 SEC 재무(10-Q) 아직 없음
    cols = PCOLS
    out['_detail'] = {'sym': t, 'cur': out['cur'], 'q': {'c': cols, 'r': [rowv(r, cols) for r in qr]}, 'a': {'c': cols, 'r': [rowv(r, cols) for r in ar]}}
    return out


def rowv(r, cols):
    o = []
    for k in cols:
        v = r.get(k)
        if k == 'label':
            v = r['end'][:4] + '.' + r['end'][5:7]
        elif isinstance(v, float):
            v = round(v, 2) if k in ('rev_g', 'opm', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr') else round(v)
        o.append(v)
    return o


def write_all(out, summ, coinfo):
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    os.makedirs(os.path.join(OUT, 'co'), exist_ok=True)
    changed = []

    def put(name, o):
        p = os.path.join(OUT, name)
        old = jload(p, {})
        a = dict(old)
        a.pop('updated', None)
        if a != o:
            o = dict(o, updated=now)
            jsave(p, o)
            changed.append(name)
    for n, o in out.items():
        put(n, o)
    live = set()
    for t, ci in coinfo.items():
        d = ci.get('_detail')
        if d:
            fn = 'co/' + t + '.json'
            live.add(t + '.json')
            put(fn, d)
    for f in os.listdir(os.path.join(OUT, 'co')):     # 바구니에서 빠진 기업의 상세 파일은 지움
        if f.endswith('.json') and f not in live:
            os.remove(os.path.join(OUT, 'co', f))
            changed.append('co/' + f + ' (삭제)')
    put('summary.json', {'fx': summ.get('fx'), 'ndx': summ['ndx'], 'spx': summ['spx']})
    log('바뀐 파일', len(changed), changed[:12])
    return changed


if __name__ == '__main__':
    run()
