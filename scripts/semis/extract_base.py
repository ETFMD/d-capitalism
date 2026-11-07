#!/usr/bin/env python3
"""[SEMIS] 'SOX와 NYSE 반도체 지수 분석' 기준 자료 만들기 — SOXX·SOXQ 대시보드 파이프라인(작업 공간)에서 한 번 실행

  python3 scripts/semis/extract_base.py <파이프라인 workspace> <저장소 data/semis>

· 파이프라인 = 사용자 자료 soxx_soxq_handover.zip + soxx_soxq_raw_big.zip (setup.sh 실행 뒤 · 인수인계 문서 4장 순서로 runall·snapshot·daily·soxq_daily 를 먼저 돌림)
· 만드는 파일 (data/semis/)
    base.json        자동 갱신(scripts/update_semis.py)이 쓰는 고정값 — 기업별 기준 가격·PER·시가총액(반올림 전)·비중 주식 수,
                     지수 PER 바구니(마지막 보유 내역의 종목별 보유액·기준 가격·EPS 발표 순서) — EPS·재무가 바뀌면(실적 발표) 파이프라인을 다시 돌려 이 파일을 다시 만듦
    soxx_fin.json · soxq_fin.json   구성 종목 표·분기·연간 실적 (게시본 companies·quarterly·annual 그대로 · 줄 = 배열 · 시가총액 단위 오류만 units.py 로 바로잡음)
    soxx_pe.json  · soxq_pe.json    일별 PER (게시본 pe_daily 그대로 · 줄 = 배열)
    sox_fwd_ref.json                참고: History of Market SOX 선행 PER 주간
    summary.json                    맨 위 요약(지수 PER 지금 값) — update_semis.py 가 다시 씀
· 게시본(대시보드 JSON)과 한 값도 다르면 멈춤(파이프라인 재현 확인)"""
import sys, os, json, datetime as dt, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import units   # noqa: E402 — 분기·연간 시가총액 단위 오류 바로잡기

WS, OUT = sys.argv[1], sys.argv[2]
WS = os.path.abspath(WS)
for p in ('fin', 'work3', 'work2', 'work'):
    sys.path.insert(0, os.path.join(WS, p))
os.chdir(os.path.join(WS, 'fin'))
D = dt.date.fromisoformat
UPDATED = '2026-11-07T22:19:00Z'   # 게시본(대시보드) 만든 시각 — 첫 자료의 updated
EPS_ASOF = '2026-11-07'            # Zacks·Nasdaq EPS 받은 날(이 날까지의 실적 발표 반영)
BASIS = '2026-11-06'               # 기준 종가 날짜


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def rows_of(lst, cols):
    return [[r.get(c) for c in cols] for r in lst]


FINC = ['sym', 'ko', 'seg', 'weight', 'cur', 'cur_ko', 'mcap_usd', 'mcap_local', 'px', 'pe_ttm', 'pe_mix', 'pe_ntm', 'pe_gaap', 'pbr', 'roe', 'rev_ttm', 'rev_g', 'opm',
        'ni_ttm', 'debt', 'icr', 'dy', 'sr', 'last_q', 'since_q', 'since_a', 'nq', 'na']
QC = ['sym', 'end', 'label', 'rev', 'rev_g', 'oi', 'opm', 'ni', 'ocf', 'icr', 'debt', 'roe', 'per', 'pbr', 'dy', 'sr', 'mcap', 'oi_est', 'supp']


def main():
    import daily as Dm, soxq_daily as Sq
    base = {'updated': UPDATED, 'basis': BASIS, 'eps_asof': EPS_ASOF, 'etf': {}}
    out = {}
    for etf in ('SOXX', 'SOXQ'):
        e = etf.lower()
        co = load('companies.json' if etf == 'SOXX' else 'companies_soxq.json')
        snap = load('snap.json' if etf == 'SOXX' else 'snap_soxq.json')
        pub = os.path.join(WS, '..', 'published', e + '_fin')
        comp, Q, A, fx = (load(os.path.join(pub, n + '.json')) for n in ('companies', 'quarterly', 'annual', 'fx'))
        # 비중 주식 수: SOXX = Zacks 2026-09-30 보유 · SOXQ = Zacks 2026-10-02 보유(weights.json)
        if etf == 'SOXX':
            wsh = {x['ticker']: float(x['shares'].replace(',', '')) for x in load(os.path.join(WS, 'dl4/hold.json'))}
        else:
            wsh = {x['ticker']: float(x['shares'].replace(',', '')) for x in load(os.path.join(WS, 'dl7/weights.json'))}
        FXC = {'USD': 1.0, 'TWD': 1 / 33.1093, 'EUR': 1.1228, 'KRW': 1 / 1356.34}   # snapshot.py 의 FX 그대로
        cb = []
        for c in comp:
            s, info = snap[c['sym']], co[c['sym']]
            usym = {'SKHY': 'SKHY', 'TSM': 'TSM', 'ASML': 'ASML', 'UMC': 'UMC', 'ASX': 'ASX'}.get(c['sym'], c['sym'])
            cb.append({'sym': c['sym'], 'us': usym, 'loc': info['pt'], 'cur': s['cur'], 'fx': FXC[s['cur']],
                       'px_us': s.get('px_us'), 'px_loc': s.get('px_local'), 'mcap_local': s.get('mcap_local'),
                       'pe_ttm': s.get('pe_ttm'), 'pe_mix': s.get('pe_mix'), 'pe_ntm': s.get('pe_ntm'), 'pbr': s.get('pbr'), 'dy': s.get('dy'),
                       'ni_ttm': s.get('ni_ttm'), 'wsh': wsh.get(c['sym'])})
        # 지수 PER 바구니 — 마지막 보유 내역(그 뒤 날짜는 모두 이 보유 내역) + 종목별 EPS 발표 순서(daily.EPS.at 그대로 재현)
        if etf == 'SOXX':
            res, E = Dm.main(); import hold as H
            snaps = H.snapshots()
            zh = load(os.path.join(WS, 'dl4/hold.json')); d930 = D('2026-09-30'); rows = []
            for x in zh:
                t = x['ticker']
                if t in ('XTSLA', 'USD', 'WFFUT', 'IXTZ6'): continue
                sh = float(x['shares'].replace(',', '')); p = Dm.px_on_or_before(t, d930)
                rows.append((t + '*', float(x['weight']), t) if p is None else (t, sh * p, t))
            cw = sum(float(x['weight']) for x in zh if x['ticker'] not in ('XTSLA', 'USD', 'WFFUT', 'IXTZ6') and not any(r[0] == x['ticker'] + '*' for r in rows))
            cv = sum(v for t, v, n in rows if not t.endswith('*'))
            rows = [(t, (v * cv / cw if t.endswith('*') else v), n) for t, v, n in rows]
            hd, ref, px_t = '2026-09-30', 'SOXX', 'SOXX'
        else:
            res, E, snaps = Sq.main()
            hd = max(snaps); src, rows = snaps[hd]; ref, px_t = '_SOX', 'SOXQ'
        hdd = D(hd); pos = []; unc = 0.0
        for t, v, n in rows:
            if v is None or t.endswith('*'): unc += (v or 0); continue
            p0 = Dm.px_on_or_before(t, hdd)
            if p0 is None: unc += v; continue
            pos.append({'t': t, 'v': v, 'p0': p0})
        eps = {}
        for x in pos:
            ob = E.get(x['t']) or Dm.EPS(x['t'])
            eps[x['t']] = {'d': [d.isoformat() for d in ob.dates], 's': [[m, v, 1 if est else 0] for m, v, est in ob.seq]} if ob.ok else None
        s0 = Dm.px_on_or_before(ref, hdd)
        # 이 보유 내역을 쓰는 첫날 (같은 분기 조정 구간)
        keys = sorted(r['hold'] for r in res)
        first = next(r['date'] for r in res if r['hold'] == hd)
        base['etf'][etf] = {'companies': cb, 'pe': {'hold': hd, 'from': first, 'ref': ref, 'px': px_t, 's0': s0, 'unc': unc, 'pos': pos, 'eps': eps}}
        # 화면 자료 (게시본 그대로 · 줄 = 배열)
        qr, ar = rows_of(Q, QC), rows_of(A, QC)
        for c in units.fix(QC, qr) + units.fix(QC, ar):   # XBRL 발행주식 수 단위 오류(1천·100만 배) — scripts/semis/units.py
            print(etf, '시가총액 단위 바로잡음', *c)
        out[e + '_fin.json'] = {'updated': UPDATED, 'asof': BASIS, 'eps_asof': EPS_ASOF, 'etf': etf,
                                'fx': fx[0], 'c': {'c': FINC, 'r': rows_of(comp, FINC)}, 'q': {'c': QC, 'r': qr}, 'a': {'c': QC, 'r': ar}, 'stale': []}
        pd_ = load(os.path.join(WS, '..', 'published', e + '_pe', 'pe_daily.json'))
        pc = ['date', 'soxx', 'pe_ttm', 'pe_mix', 'pe_ntm', 'cov', 'est', 'hold'] if etf == 'SOXX' else ['date', 'soxq', 'sox', 'pe_ttm', 'pe_mix', 'pe_ntm', 'cov', 'est', 'hold', 'basis']
        out[e + '_pe.json'] = {'updated': UPDATED, 'asof': BASIS, 'eps_asof': EPS_ASOF, 'etf': etf, 'frozen': BASIS, 'c': pc, 'r': rows_of(pd_, pc)}
        # 게시본 = 파이프라인 결과 확인 (daily.json → export 와 같은 반올림)
        if etf == 'SOXX':
            chk = [{'date': r['date'], 'soxx': round(r['soxx'], 2), 'pe_ttm': r['pe_ttm'], 'pe_mix': r['pe_mix'], 'pe_ntm': r['pe_ntm'], 'cov': r['cov'], 'est': r['est_share'], 'hold': r['hold']} for r in res if r['date'] >= '2013-08-15']
        else:
            chk = [{k: r[k] for k in pc} for r in res if r['date'] >= '2013-08-15']
        if chk != pd_:
            sys.exit(etf + ' 일별 PER: 파이프라인 결과가 게시본과 다름')
    ref = load(os.path.join(WS, '..', 'published', 'soxx_pe', 'sox_fwd_ref.json'))
    out['sox_fwd_ref.json'] = {'updated': UPDATED, 'src': 'History of Market (historyofmarket.com) — 필라델피아 반도체 지수 섹터 선행 PER(주간)', 'c': ['date', 'pe'], 'r': rows_of(ref, ['date', 'pe'])}
    os.makedirs(OUT, exist_ok=True)
    for n, o in out.items():
        with open(os.path.join(OUT, n), 'w', encoding='utf-8') as f:
            json.dump(o, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, 'base.json'), 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, separators=(',', ':'))
    print('written', sorted(out), 'base.json')


if __name__ == '__main__':
    main()
