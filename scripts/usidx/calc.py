#!/usr/bin/env python3
"""[USIDX] 계산 — 회사별 분기 회계 EPS · QQQ(나스닥 100)·SPY(S&P 500) 일별 PER

EPS (증권 = CUSIP 마다)
· SEC XBRL 의 희석 EPS — 기간마다 '처음 낸 값'(나중 정정 버림) · 분기 값이 없으면 누적(6·9·12개월) 값의 차이(4분기 = 연간 − 9개월)
· 주식 분할: 그 값을 낸 날 뒤의 분할 비율로 나눔 → 오늘 주식 수 기준(야후 종가와 같은 기준)
· 달러가 아닌 통화는 분기 말 환율(야후)로 달러로 · ADR 은 ADR 1주가 담은 원주 수(ADR) 곱함
· 그 시절 발행사(cik)가 공시를 멈춘 뒤(지주회사 전환·합병)는 지금 티커의 CIK(cur) 공시로 이어 붙임
· 알게 된 날(known) = 분기 말 뒤 75일 안 첫 실적 발표(8-K 2.02) 또는 그 분기 공시 제출일 중 빠른 날 → 그 다음 날부터 반영
· 아직 공시(10-Q)가 없는 분기: 나스닥 실제 조정 EPS(발표됨) 또는 예상 EPS(컨센서스) × 최근 4개 분기 '회계 ÷ 조정' 비율 · 그것도 없으면 1년 전 같은 분기

일별 PER (ETF 마다)
· 그날이 든 지수 정기 조정 구간의 보유 내역(없으면 그날 이전 마지막 보유 내역) — 종목별 주식 수(분할 반영) × 그날 종가 합 ÷ 같은 주식 수 × EPS 합
· 후행 = 그날까지 알려진 최근 4개 분기 · 혼합 = 최근 2개 + 다음 2개 · 선행 = 다음 4개 (과거 날짜의 다음 분기는 그 뒤 실제 공시 값)
· cov = 계산에 넣은 종목의 보유 비중(가격·EPS 가 다 있는 종목) · est = 선행 EPS 중 예상치(아직 발표 안 됨) 비중"""
import bisect, datetime as dt, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import D, jload, rpath, log, rebal_window   # noqa: E402
import prices, fund, consensus, dimeps   # noqa: E402

START = '2012-01-03'
ADR = {'AZN': 0.5, 'PDD': 4}   # ADR 1주 = 원주 몇 주 (아스트라제네카 0.5 · 핀둬둬 4) — 이 표에 없는 해외 기업은 분기 XBRL 이 없어 대부분 빠짐(비중은 cov 에)
SHARE_MULT = {'BRK-B': 1 / 1500}   # 버크셔 B주 = A주 1/1,500 (옛 EPS·주식 수는 A주 기준)
MAX_STALE = 200             # 마지막으로 알려진 분기 말에서 이만큼(일) 넘게 지나면 그 종목은 그날 계산에서 뺌(공시 중단)


def sfac(splits, d):
    """d 뒤 분할의 곱"""
    f = 1.0
    for sd, k in splits:
        if sd > d:
            f *= k
    return f


_FX = {}


def fx_at(cur, d):
    """1달러 = ? 통화 (그날 또는 그 전 마지막)"""
    if cur == 'USD':
        return 1.0
    if cur not in _FX:
        _FX[cur] = prices.chart(cur + '=X', start='2009-01-01')
    o = _FX[cur]
    if not o:
        return None
    i = bisect.bisect_right(o['d'], d) - 1
    return o['c'][i] if i >= 0 else None


def _dur(fc, key, unit_ok=None):
    """{(s, e): (값, 처음 낸 날, 단위)} — 태그 우선순위대로, 같은 기간은 앞 태그"""
    out = {}
    for tag, unit, rows in (fc.get('c') or {}).get(key, []):
        if unit_ok and not unit_ok(unit):
            continue
        for row in rows:
            s, e, v, filed, form = row[:5]
            if s and (s, e) not in out:
                out[(s, e)] = (v, filed, unit)
    return out


def _dur2(fc, key, unit_ok=None):
    """{(s, e): (처음 값, 처음 낸 날, 마지막 값, 마지막 낸 날, 단위)} — 태그 우선순위대로"""
    out = {}
    for tag, unit, rows in (fc.get('c') or {}).get(key, []):
        if unit_ok and not unit_ok(unit):
            continue
        for row in rows:
            s, e, v, filed = row[:4]
            v2, f2 = (row[5], row[6]) if len(row) >= 7 else (v, filed)
            if s and (s, e) not in out:
                out[(s, e)] = (v, filed, v2, f2, unit)
    return out


def _inst(fc, key):
    out = {}
    for tag, unit, rows in (fc.get('c') or {}).get(key, []):
        for row in rows:
            s, e, v, filed, form = row[:5]
            if not s and e not in out:
                out[e] = (v, filed, unit)
    return out


def days(s, e):
    return (D(e) - D(s)).days


def quarters(dur):
    """{(s,e): v} → (분기 {e: (s, v, 'q'|'d')}, 연간 {e: (s, v)})
    · 분기 = 80~120일 기간(코스트코·펩시코처럼 16주 분기 포함) · 연간 = 340~380일
    · 같은 날 시작하는 누적(6·9·12개월)의 차이로 빠진 분기를 채움 — 누적 둘 사이가 두 분기(160~230일)이고 뒤 분기를 알면 앞 분기도"""
    q, ann = {}, {}
    for (s, e), v in dur.items():
        n = days(s, e)
        if 340 <= n <= 380:
            ann[e] = (s, v)
        elif 80 <= n <= 120:
            q[e] = (s, v, 'q')
    bys, der = {}, {}
    for (s, e), v in dur.items():
        bys.setdefault(s, []).append((e, v))
    for s, lst in bys.items():
        lst.sort()
        pe, pv = (D(s) - dt.timedelta(days=1)).isoformat(), 0.0      # 시작 전날 = 누적 0 (6개월 값 − 2분기 값 = 1분기 값도 채움)
        for e, v in lst:
            n = days(s, e)
            if n < 80 or n > 380:
                continue
            if True:
                g = days(pe, e)
                if 80 <= g <= 120 and pv:
                    der.setdefault(e, ((D(pe) + dt.timedelta(days=1)).isoformat(), v - pv, 'd'))
                if 80 <= g <= 120 and e not in q:
                    q[e] = ((D(pe) + dt.timedelta(days=1)).isoformat(), v - pv, 'd')
                elif 160 <= g <= 230 and e in q:            # 두 분기 차이 − 뒤 분기 = 앞 분기 (그 분기 공시가 빠진 경우)
                    mid = next((x for x in q if 70 <= days(pe, x) <= 130 and days(x, e) >= 70), None)
                    if mid is None:
                        me = (D(e) - dt.timedelta(days=days(q[e][0], e) + 1)).isoformat()
                        q[me] = ((D(pe) + dt.timedelta(days=1)).isoformat(), v - pv - q[e][1], 'd')
            pe, pv = e, v
    for e, (s, v, src) in list(q.items()):             # 분기 값에 누적(6·9·12개월) 값을 그대로 잘못 적은 경우(예: 트랙터서플라이 2025년 4분기 순이익 = 연간 값) → 누적 차이로
        if src == 'q' and e in der and v and any(abs(w - v) <= 1e-4 * abs(v) for (s2, e2), w in dur.items() if e2 == e and days(s2, e2) >= 160) \
                and abs(v) > 1.5 * abs(der[e][1]):           # 누적 값이 분기 값보다 큼 — 반올림·우연의 일치(1분기 ≈ 0)는 그대로
            q[e] = der[e]
    return q, ann


def known_dates(sub, ends):
    """분기 말 → 처음 알려진 날(실적 발표 8-K 2.02 또는 정기 보고서)"""
    rel = sorted(x[1] for x in (sub or {}).get('r', []) if x[0] == '8-K')
    reps = sorted(x[1] for x in (sub or {}).get('r', []) if x[0] in ('10-Q', '10-K', '10-Q/A', '10-K/A', '10-KT', '20-F', '40-F', '6-K'))
    out = {}
    for e in ends:
        lim = (D(e) + dt.timedelta(days=75)).isoformat()
        i = bisect.bisect_right(rel, e)
        r = rel[i] if i < len(rel) and rel[i] <= lim else None
        j = bisect.bisect_right(reps, e)
        p = reps[j] if j < len(reps) and reps[j] <= (D(e) + dt.timedelta(days=200)).isoformat() else None
        out[e] = min(x for x in (r, p) if x) if (r or p) else None
    return out


def _lmed(vals):
    v = sorted(math.log(abs(x)) for x in vals if x)
    return v[len(v) // 2] if v else None


def consistent(d, years=3):
    """{(s,e): (처음, 마지막)} → {(s,e): 값} — 두 값이 30배 넘게 다르면(한쪽 단위 오류) 같은 회사 앞뒤 3년 값들의 (로그) 중앙값에 가까운 쪽"""
    out = {}
    allv = [(e, x) for (s, e), (a, b) in d.items() for x in (a, b) if x]
    for (s, e), (a, b) in d.items():
        if not a or not b or a == b or max(abs(a), abs(b)) / min(abs(a), abs(b)) <= 30:
            out[(s, e)] = a if a is not None else b
            continue
        lo, hi = (D(e) - dt.timedelta(days=365 * years)).isoformat(), (D(e) + dt.timedelta(days=365 * years)).isoformat()
        m = _lmed([x for ee, x in allv if lo <= ee <= hi])
        out[(s, e)] = a if m is None or abs(math.log(abs(a)) - m) <= abs(math.log(abs(b)) - m) else b
    return out


def unit_fix(d):
    """주식 수 단위 오기 고치기 — 회사가 XBRL 에 '백만 주'를 그냥 주로 적는 일(예: 맥도날드 2023년 뒤 희석 가중평균 713.5)
    · 같은 계열 중앙값과 1,000배·100만배(±0.2 로그) 차이 나는 값만 중앙값 쪽 단위로 바꿈(진짜 주식 수 변화로는 이만큼 안 바뀜)"""
    vs = sorted(v for v in d.values() if v and v > 0)
    if not vs:
        return d
    med = vs[len(vs) // 2]
    out = {}
    for e, v in d.items():
        if v and v > 0:
            r = math.log10(med / v)
            k = round(r)
            if k and k % 3 == 0 and abs(r - k) < 0.2:
                v = v * 10 ** k
        out[e] = v
    return out


def plausible(v, s, e, px):
    """주당순이익이 그 기간 길이에 비해 주가보다 터무니없이 크지 않은가(분기 EPS ≤ 주가의 절반) — 가격이 없으면 None(모름)"""
    if v is None:
        return False
    p = px.at(e, 7) if px else None
    if not p:
        return None
    return abs(v) <= 0.5 * p * max(1.0, days(s, e) / 91)


class Co:
    """증권 하나(CUSIP)의 분기 EPS 시계열 — 오늘 주식 수 기준 · 달러
    · 기간마다 처음 낸 EPS → 주가에 비해 터무니없으면(단위 오류) 나중 값 → 그것도 아니면 순이익 ÷ 희석 주식 수 → 없으면 버림
    · EPS 가 그럴듯해도 '순이익 ÷ 주식 수'와 정확히 10·100·1000…배 다르면 단위 오류로 보고 순이익 ÷ 주식 수"""

    def __init__(self, cusip, cm, px, sym=None, dim=None):
        self.cusip, self.sym, self.px = cusip, sym, px
        splits = px.s if px else []
        self.q = []            # [(끝, 시작, eps, known, 출처 'x'(XBRL)|'a'(나스닥 실제 조정×비율)|'f'(예상×비율)|'y'(1년 전 같은 분기))]
        self.ratio = None
        ciks = [c for c in (cm.get('cik'), cm.get('cur')) if c]
        if len(ciks) == 2 and ciks[0] == ciks[1]:
            ciks = ciks[:1]
        mult = ADR.get(sym or '', 1.0) * SHARE_MULT.get(sym or '', 1.0)
        Q = {}
        last = None
        self.fixed = []        # 바로잡은 분기 [(끝, 원래 값, 쓴 값, 이유)]
        for n, ck in enumerate(ciks):
            fc = fund.facts(ck)
            sub = fund.subs(ck)
            eps = {k: v + (mult,) for k, v in _dur2(fc, 'eps', lambda u: u.endswith('/shares')).items()}
            sp = dimeps.eps_rows(sym) if (sym in dimeps.SPECIAL and dimeps.SPECIAL[sym][0] == ck) else (dim or {}).get(ck)
            if sp:                                         # 클래스별로만 공시한 EPS(버크셔 B·비자 A) — 그 클래스 값 그대로(배수 없음)가 우선
                adr = ADR.get(sym or '', 1.0)
                for r in sp:
                    eps[(r[0], r[1])] = (r[2], r[3], r[5], r[6], 'USD/shares', adr)
            nic = fc.get('cur') or 'USD'
            ni = consistent({k: (x[0], x[2]) for k, x in _dur2(fc, 'ni', lambda u: u == nic).items()})
            dsh = unit_fix(consistent({k: (x[0] * sfac(splits, x[1]) if x[0] else None, x[2] * sfac(splits, x[3]) if x[2] else None)
                                       for k, x in _dur2(fc, 'dsh', lambda u: u == 'shares').items()}))
            norm = {}
            for (s_, e), (v1, f1, v2, f2, unit, mu) in eps.items():
                r = fx_at(unit.split('/')[0].upper(), e)
                if not r:
                    continue
                n1 = v1 / r / sfac(splits, f1) * mu
                n2 = v2 / r / sfac(splits, f2) * mu
                p1, p2 = plausible(n1, s_, e, px), plausible(n2, s_, e, px)
                if p1 is None:            # 가격이 없는 기간: 30배 넘게 다르면 앞뒤 값과 가까운 쪽
                    norm[(s_, e)] = consistent({(s_, e): (n1, n2)}).get((s_, e))
                elif p1:
                    norm[(s_, e)] = n1
                elif p2:
                    norm[(s_, e)] = n2
                    self.fixed.append((e, n1, n2, '나중 값'))
            alt = {}
            for k, v in ni.items():          # 순이익 ÷ 희석 가중평균 주식 수 (같은 기간)
                sh = dsh.get(k)
                r = fx_at(nic.upper(), k[1])
                if sh and sh > 0 and r and v is not None:
                    alt[k] = v / r / sh * mult
            q, ann = quarters(norm)
            qa, _ = quarters(alt)
            niq = quarters({k: v for k, v in ni.items() if v is not None})[0]
            for e, (s_, v, src) in list(q.items()):
                a = qa[e][1] if e in qa else None
                if a is None and e in niq:                       # 4분기(연간 − 9개월) 등: 그 기간 끝의 연간·누적 주식 수로 근사
                    sh = next((dsh[k] for k in sorted(dsh, key=lambda k: days(*k)) if k[1] == e and dsh[k]), None)
                    r = fx_at(nic.upper(), e)
                    if sh and r:
                        a = niq[e][1] / r / sh * mult
                pv = plausible(v, s_, e, px)
                pa = plausible(a, s_, e, px) if a is not None else False
                if pv is False:
                    if pa:
                        self.fixed.append((e, v, a, 'NI/주식수'))
                        q[e] = (s_, a, src)
                    else:
                        self.fixed.append((e, v, None, '주가 대비 과대'))
                        del q[e]
                elif a is not None and pa is not False and v and a:
                    lr = math.log10(abs(v / a))
                    if abs(lr) >= 0.9 and abs(lr - round(lr)) < 0.1:      # 정확히 10ⁿ 배 → 단위 오류
                        self.fixed.append((e, v, a, '10^%d배' % round(lr)))
                        q[e] = (s_, a, src)
            for e, (s_, a, src) in qa.items():               # EPS 를 (차원 없이) 공시하지 않은 분기 — 순이익 ÷ 희석 주식 수 (몬스터·제너럴다이내믹스 등)
                if e not in q and plausible(a, s_, e, px) is not False:
                    q[e] = (s_, a, src)
                    self.fixed.append((e, None, a, 'EPS 없음'))
            vs = sorted(abs(x[1]) for x in q.values())
            med = vs[len(vs) // 2] if vs else 0
            for e, (s_, v, src) in list(q.items()):                # 가격도 순이익도 없이 다른 분기보다 터무니없이 큰 값 → 버림
                if abs(v) > 50 and abs(v) > 100 * max(med, 0.01) and plausible(v, s_, e, px) is None and e not in qa:
                    self.fixed.append((e, v, None, '튐'))
                    del q[e]
            kn = known_dates(sub, list(q))
            first = {}
            for (s_, e), x in eps.items():
                first[e] = min(first.get(e, '9999'), x[1])
            for e, (s_, v, src) in q.items():
                if n == 1 and last and e <= last:      # 이어 붙이는 CIK 는 앞 CIK 의 마지막 분기 뒤만
                    continue
                k = kn.get(e) or first.get(e)
                if k and first.get(e):
                    k = min(k, first[e])
                if not k or k <= e:
                    continue
                Q[e] = (e, s_, v, k, 'x')
            if Q:
                last = max(Q)
        self.q = [Q[e] for e in sorted(Q)]
        self._grid()

    def _grid(self):
        """분기 말 간격이 80~100일이 아닌 곳(빠진 분기)은 None 으로 채워 4개 합이 엉뚱한 분기를 더하지 않게"""
        g = []
        for x in self.q:
            if g:
                gap = days(g[-1][0], x[0])
                if gap < 70:                     # 회계연도 변경 등으로 겹치는 분기 → 뒤 것만
                    g[-1] = x
                    continue
                while gap > 130:
                    pe = (D(g[-1][0]) + dt.timedelta(days=91)).isoformat()
                    g.append((pe, None, None, None, 'n'))
                    gap = days(pe, x[0])
            g.append(x)
        self.q = g

    def extend(self, ns, today):
        """나스닥 자료로 아직 XBRL 이 없는 분기(발표됨·예상)를 회계 기준으로 붙임"""
        if not self.q:
            return
        mi = lambda s: int(s[:4]) * 12 + int(s[5:7])
        xs = [x for x in self.q if x[2] is not None]
        sur = (ns or {}).get('sur') or []
        pairs = []
        for ym, rd, adj, cons in sur:
            best = min(xs, key=lambda x: abs(mi(x[0]) - mi(ym)), default=None)
            if best and abs(mi(best[0]) - mi(ym)) <= 1:
                pairs.append((best[2], adj))
        rs = sorted(g / a for g, a in pairs[-4:] if a > 0)        # 분기별 '회계 ÷ 조정' 의 중앙값 — 한 분기의 일회성 손실(감액 등)에 덜 흔들림
        if len(rs) >= 2:
            m = len(rs) // 2
            self.ratio = max(0.2, min(1.5, rs[m] if len(rs) % 2 else (rs[m - 1] + rs[m]) / 2))
        elif pairs:
            self.ratio = 1.0
        r = self.ratio
        if r is not None:                                 # 최근 공시 분기 사이 빈 칸(그 분기 10-Q 의 XBRL 이 SEC 자료에 없음) → 나스닥 실제 조정 EPS × 비율
            for i, x in enumerate(self.q):
                if x[2] is None and x[4] == 'n':
                    for ym, rd, adj, cons in sur:
                        if abs(mi(ym) - mi(x[0])) <= 1 and rd and rd > x[0]:
                            self.q[i] = (x[0], None, adj * r, rd, 'a')
                            break
        lastx = self.q[-1][0]
        nxt = []
        if r is not None:
            for ym, rd, adj, cons in sur:            # 발표됐지만 XBRL 이 아직 없는 분기
                if mi(ym) > mi(lastx) + 1 and rd:
                    nxt.append((ym, adj * r, rd, 'a'))
            lastm = max([mi(lastx)] + [mi(x[0]) for x in nxt])
            for row in (ns or {}).get('fq') or []:
                ym, cons = row[0], row[1]
                if mi(ym) > lastm and cons is not None:
                    nxt.append((ym, cons * r, None, 'f'))
        e0 = lastx
        for ym, v, rd, src in sorted(nxt):
            pe = (D(e0) + dt.timedelta(days=91)).isoformat()
            if abs(mi(pe) - mi(ym)) > 1:             # 순서가 어긋나면(한 분기 건너뜀) 거기서 멈춤
                break
            k = rd if rd and rd > e0 else None
            self.q.append((pe, None, v, k, src))
            e0 = pe

    def pad(self, today=None):
        """마지막 공시 분기 뒤로 4개 분기(today 를 주면 today 뒤로 6개 분기)까지 — 예상이 없는 자리는 1년 전 같은 분기 값('y')"""
        if len(self.q) < 4:
            return
        lx = max((i for i, x in enumerate(self.q) if x[4] == 'x'), default=len(self.q) - 1)
        while len(self.q) - 1 - lx < 4 or (today and sum(1 for x in self.q if x[0] > today) < 6):
            pe = (D(self.q[-1][0]) + dt.timedelta(days=91)).isoformat()
            y4 = self.q[-4][2]
            self.q.append((pe, None, y4, None, 'y' if y4 is not None else 'n'))

    def arrays(self):
        """계산용 배열 · KM = 알게 된 날의 누적 최댓값(중간에 빠진 분기는 다음 분기 날짜) → bisect 로 '그날 알려진 마지막 분기'"""
        self.E = [x[0] for x in self.q]
        self.V = [x[2] for x in self.q]
        self.S = [x[4] for x in self.q]
        K = [x[3] for x in self.q]
        nxt = None
        for i in range(len(K) - 1, -1, -1):
            if K[i] is None and nxt is not None and self.S[i] == 'n':
                K[i] = nxt
            if K[i] is not None:
                nxt = K[i]
        km, m = [], ''
        for k in K:
            if k is None:
                km.append('9999-99-99')
                m = '9999-99-99'
            else:
                m = max(m, k)
                km.append(m)
        self.KM = km

    def at(self, t):
        """그날(t) 후행·혼합·선행 EPS 와 선행 4개 분기 중 회계 공시 실적이 아닌(예상·환산) 분기 수 — 없으면 None"""
        k = bisect.bisect_left(self.KM, t) - 1
        if k < 3 or k + 4 >= len(self.V) or (D(t) - D(self.E[k])).days > MAX_STALE:
            return None
        seg = self.V[k - 3:k + 5]
        if any(v is None for v in seg):
            return None
        est = sum(1 for j in range(k + 1, k + 5) if self.S[j] != 'x')
        return sum(seg[0:4]), sum(seg[2:6]), sum(seg[4:8]), est


# ───────────────────────── 지수 일별 PER ─────────────────────────
class Px:
    """증권 가격(오늘 주식 수 기준 종가) — 야후 또는 FTD"""

    def __init__(self, o):
        self.d, self.c, self.s = o['d'], o['c'], o.get('s') or []
        self.est = o.get('est')

    def at(self, t, lag=5):
        i = bisect.bisect_right(self.d, t) - 1
        if i < 0:
            return None
        if self.d[i] != t and (D(t) - D(self.d[i])).days > lag:
            return None
        return self.c[i]


def px_series(c, tick):
    t = tick.get(c)
    o = prices.chart(t) if t else jload(rpath('pxf', c + '.json.gz'))
    return Px(o) if o and o.get('d') else None


def pick_snap(snaps, t):
    """그날 쓸 보유 내역: 같은 정기 조정 구간의 (가장 늦은) 보유 내역 → 없으면 그날 이전 마지막 → 그것도 없으면 첫 보유 내역"""
    w = rebal_window(t)
    same = [s for s in snaps if s['_w'] == w]
    if same:
        return same[-1]
    before = [s for s in snaps if s['date'] <= t]
    return before[-1] if before else snaps[0]


def daily(snaps, cos, pxs, etf_px, days):
    """→ 줄 [날짜, ETF 종가, 후행, 혼합, 선행, cov, est, 보유 기준일] · 마지막 날의 바구니(live 용)"""
    for s in snaps:
        s['_w'] = rebal_window(s['date'])
        s['_pos'] = []
        for r in s['rows']:
            c = r.get('cusip')
            p = pxs.get(c) if c else None
            n = r['sh'] * sfac(p.s, s['date']) if p else None
            s['_pos'].append((c, n, r['val']))
        s['_tot'] = sum(r['val'] for r in s['rows'])
    rows, basket = [], None
    for t in days:
        s = pick_snap(snaps, t)
        num = dt_ = dm = dn = estw = incv = absn = 0.0
        bk = []
        for c, n, val in s['_pos']:
            co, p = cos.get(c), pxs.get(c)
            if not co or not p or n is None:
                continue
            pr = p.at(t)
            if pr is None:
                continue
            e = co.at(t)
            if e is None:
                continue
            ttm, mix, ntm, est = e
            num += n * pr
            dt_ += n * ttm
            dm += n * mix
            dn += n * ntm
            estw += n * abs(ntm) * est / 4
            absn += n * abs(ntm)
            incv += val
            bk.append((c, n, pr, ttm, mix, ntm))
        if num <= 0:
            continue
        f = lambda den: round(num / den, 2) if den > 0 else None
        ep = etf_px.at(t, 0)
        rows.append([t, round(ep, 2) if ep else None, f(dt_), f(dm), f(dn), round(incv / s['_tot'] * 100, 1), round(estw / absn * 100, 1) if absn > 0 else None, s['date']])
        basket = (t, s, bk, num, dt_, dm, dn)
    return rows, basket
