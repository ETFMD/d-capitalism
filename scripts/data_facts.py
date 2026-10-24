#!/usr/bin/env python3
"""
자동 갱신 숫자 — data/*.json(시세·시가총액·실적 봇이 매일 갱신) → 빌드 때 글·지수 해설의 숫자를 채움

· 투자 공부 글(content/learn/*.html) 본문의 {{키}} 를 facts() 값으로 바꿈 — 없는 키면 빌드 실패(오타 방지)
· 지수 성장률 20쪽의 [IDXNOTE] 해설: content/index/<지수>.html(사람이 쓴 고유 해설, {{키}} 사용 가능) + hist_stats() 표
· build-pages.yml 이 데이터 갱신 워크플로가 끝날 때마다(workflow_run)·매일 다시 빌드 → 숫자가 최신 자료를 따라감
· 표준 라이브러리만
"""
import datetime, html, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'data')
EPOCH = datetime.date(1970, 1, 1)
_cache = {}


def esc(t):
    return html.escape(str(t), quote=True)


def _load(name):
    if name not in _cache:
        with open(os.path.join(DATA, name), encoding='utf-8') as f:
            _cache[name] = json.load(f)
    return _cache[name]


def day(n):
    return EPOCH + datetime.timedelta(days=int(n))


def ymd_ko(d):
    """2026-10-16 → 2026년 10월 16일"""
    if isinstance(d, str):
        d = datetime.date.fromisoformat(d[:10])
    return f'{d.year}년 {d.month}월 {d.day}일'


def ymd_dot(d):
    if isinstance(d, str):
        d = datetime.date.fromisoformat(d[:10])
    return f'{d.year}.{d.month}.{d.day}'


def pct(x, d=1, sign=False):
    """0.182 → 18.2% · 음수는 − (유니코드 빼기)"""
    v = round(x * 100, d)
    if v == 0:
        v = 0.0
    s = f'{abs(v):.{d}f}%'
    if v < 0:
        return '−' + s
    return ('+' + s) if sign else s


def num(x, d=0):
    s = f'{abs(x):,.{d}f}'
    return ('−' + s) if x < 0 else s


def cagr(v0, v1, days):
    return (v1 / v0) ** (365.25 / days) - 1 if v0 > 0 and v1 > 0 and days > 0 else None


def mdd(series):
    """[(일, 값)] → (낙폭, 고점일, 저점일, 회복일 또는 None)"""
    peak, pd_, best = series[0][1], series[0][0], (0.0, None, None)
    for d, v in series:
        if v > peak:
            peak, pd_ = v, d
        dd = v / peak - 1
        if dd < best[0]:
            best = (dd, pd_, d)
    rec = None
    if best[1] is not None:
        pv = dict(series)[best[1]]
        for d, v in series:
            if d > best[2] and v >= pv:
                rec = d
                break
    return best + (rec,)


# ── ETF 일별 종가 (data/etfcagr.json · 시세 봇) ──
def etf_series(sym):
    x = _load('etfcagr.json')['series'][sym]
    d = [x['d0']]
    for v in x['dd']:
        d.append(d[-1] + v)
    return list(zip(d, x['c']))


def etf_stats(sym, from_day):
    s = [(d, c) for d, c in etf_series(sym) if d >= from_day]
    m = mdd(s)
    return {'start': s[0][0], 'end': s[-1][0], 'cagr': cagr(s[0][1], s[-1][1], s[-1][0] - s[0][0]), 'mdd': m[0]}


def etf_window(sym, d0, d1):
    s = [(d, c) for d, c in etf_series(sym) if d0 <= d <= d1]
    return s[-1][1] / s[0][1] - 1


# ── 지수 주간 종가 (data/history.json · 시세 봇) ──
IDX_SYM = {'nasdaq': '^IXIC', 'nasdaq100': '^NDX', 'dowjones': '^DJI', 'sp500': '^GSPC', 'sox': '^SOX', 'djsemi': '^DJUSSC',
           'kospi': '^KS11', 'kospi200': '^KS200', 'kosdaq': '^KQ11', 'n225': '^N225', 'topix': '^TOPX', 'sse': '000001.SS',
           'csi300': '000300.SS', 'szse': '399001.SZ', 'chinext': '399006.SZ', 'star50': '000688.SS', 'hsi': '^HSI',
           'hscei': '^HSCE', 'hstech': 'HSTECH.HK', 'taiex': '^TWII'}


def hist(key):
    return [(int(d), float(v)) for d, v in _load('history.json')['series'][IDX_SYM[key]] if v and v > 0]


def _at_or_before(s, d):
    best = None
    for x in s:
        if x[0] <= d:
            best = x
        else:
            break
    return best


def hist_stats(key):
    s = hist(key)
    last_d, last_v = s[-1]
    first_d = s[0][0]
    hi_d, hi_v = max(s, key=lambda x: x[1])
    out = {'first': first_d, 'last': last_d, 'v': last_v, 'hi': hi_v, 'hi_d': hi_d, 'from_hi': last_v / hi_v - 1, 'ret': {}}
    for n in (1, 3, 5, 10, 20, 30):
        p = _at_or_before(s, last_d - round(n * 365.25))
        if p and last_d - p[0] <= n * 365.25 + 14 and p[0] >= first_d and (last_d - first_d) >= n * 365.25 - 14:
            out['ret'][n] = cagr(p[1], last_v, last_d - p[0])
    m = mdd(s)
    out['mdd'], out['mdd_peak'], out['mdd_low'], out['mdd_rec'] = m
    ye = {}
    for d, v in s:
        ye[day(d).year] = v
    years = sorted(ye)
    yr = {y: ye[y] / ye[y - 1] - 1 for y in years[1:] if y - 1 in ye and y < day(last_d).year}
    # 첫해는 데이터가 연중에 시작하므로 제외(전년 말 값이 없음) · 올해는 진행 중이라 제외
    out['years'] = yr
    if yr:
        out['best_y'] = max(yr.items(), key=lambda x: x[1])
        out['worst_y'] = min(yr.items(), key=lambda x: x[1])
        out['up_y'] = sum(1 for v in yr.values() if v > 0)
    ytd0 = ye.get(day(last_d).year - 1)
    out['ytd'] = last_v / ytd0 - 1 if ytd0 else None
    # 10년 보유 결과 분포 (주간 시작점마다 10년 뒤 연평균)
    roll, j = [], 0
    for i, (d, v) in enumerate(s):
        t = d + round(10 * 365.25)
        if t > last_d:
            break
        while j < len(s) - 1 and s[j][0] < t:
            j += 1
        if abs(s[j][0] - t) <= 10:
            roll.append(cagr(v, s[j][1], s[j][0] - d))
    if len(roll) >= 156:   # 시작 시점이 3년치(156주) 이상 있을 때만 — 표본이 적으면 오해를 줌
        out['roll10'] = (min(roll), max(roll), sum(1 for r in roll if r > 0) / len(roll), len(roll))
    return out


IDX_NAME = {'nasdaq': '나스닥 종합', 'nasdaq100': '나스닥 100', 'dowjones': '다우존스', 'sp500': 'S&P 500', 'sox': '필라델피아 반도체',
            'djsemi': '다우존스 미국 반도체', 'kospi': '코스피', 'kospi200': '코스피 200', 'kosdaq': '코스닥', 'n225': '닛케이 225',
            'topix': 'TOPIX', 'sse': '상해종합', 'csi300': 'CSI 300', 'szse': '선전성분', 'chinext': '창업판', 'star50': '과창판50',
            'hsi': '항셍', 'hscei': '홍콩H', 'hstech': '항셍테크', 'taiex': '대만 가권'}
IDX_PEER = {'nasdaq': 'sp500', 'nasdaq100': 'sp500', 'dowjones': 'sp500', 'sp500': 'kospi', 'sox': 'nasdaq100', 'djsemi': 'sox',
            'kospi': 'sp500', 'kospi200': 'kospi', 'kosdaq': 'kospi', 'n225': 'topix', 'topix': 'n225', 'sse': 'csi300',
            'csi300': 'sse', 'szse': 'sse', 'chinext': 'szse', 'star50': 'chinext', 'hsi': 'hscei', 'hscei': 'hsi', 'hstech': 'hsi', 'taiex': 'kospi'}


def josa(word, a='이', b='가'):
    """받침 있으면 a(이·은·을), 없으면 b(가·는·를) — 숫자·영문 끝 글자는 읽는 소리 기준"""
    c = word.strip()[-1]
    if '가' <= c <= '힣':
        return a if (ord(c) - 0xAC00) % 28 else b
    if c.isdigit():
        return a if c in '013678' else b
    return a if c.upper() in 'LMNR' else b


def _fmt_v(v):
    return num(v, 2) if v < 1000 else num(v, 0)


def index_facts(key):
    """지수 해설 본문에서 쓰는 {{키}} 값"""
    st = hist_stats(key)
    f = {'name': IDX_NAME[key], 'asof': ymd_ko(day(st['last'])), 'first': ymd_ko(day(st['first'])), 'first_y': str(day(st['first']).year),
         'v': _fmt_v(st['v']), 'hi': _fmt_v(st['hi']), 'hi_d': ymd_ko(day(st['hi_d'])), 'from_hi': pct(st['from_hi']), 'below_hi': pct(-st['from_hi']),
         'mdd': pct(st['mdd']), 'mdd_peak': ymd_ko(day(st['mdd_peak'])), 'mdd_low': ymd_ko(day(st['mdd_low'])),
         'mdd_rec': (ymd_ko(day(st['mdd_rec'])) + '에 고점 회복') if st['mdd_rec'] else '아직 그 고점을 회복하지 못함'}
    for n, r in st['ret'].items():
        f[f'cagr{n}'] = pct(r) if n > 1 else pct(r, sign=True)
    return f, st


def index_block(key, text_html):
    """[IDXNOTE] — 사람이 쓴 해설 + 자동 통계 표 + 자동 비교 문장"""
    f, st = index_facts(key)
    name = f['name']
    body = fill(text_html, f, where=f'content/index/{key}.html')
    rows = []
    rows.append(('최근 주간 종가', f'{f["v"]} <small>({f["asof"]})</small>'))
    if st.get('ytd') is not None:
        rows.append(('올해 들어 (작년 말 대비)', pct(st['ytd'], sign=True)))
    for n in (1, 3, 5, 10, 20, 30):
        if n in st['ret']:
            rows.append((f'최근 {n}년' + (' 수익률' if n == 1 else ' 연평균'), pct(st['ret'][n], sign=(n == 1))))
    rows.append((f'{f["first_y"]}년 이후 최고치', f'{f["hi"]} <small>({f["hi_d"]})</small> · 지금은 고점 대비 {f["from_hi"]}'))
    rows.append((f'{f["first_y"]}년 이후 가장 크게 떨어진 구간', f'{f["mdd"]} <small>({ymd_dot(day(st["mdd_peak"]))} → {ymd_dot(day(st["mdd_low"]))} · {f["mdd_rec"]})</small>'))
    if st.get('years'):
        n_y = len(st['years'])
        rows.append(('가장 좋았던 해 / 나빴던 해', f'{st["best_y"][0]}년 {pct(st["best_y"][1], sign=True)} / {st["worst_y"][0]}년 {pct(st["worst_y"][1], sign=True)}'))
        rows.append(('오른 해의 비율', f'{n_y}년 중 {st["up_y"]}년 ({pct(st["up_y"] / n_y, 0)})'))
    if st.get('roll10'):
        lo, hi, pos, cnt = st['roll10']
        rows.append(('아무 주에나 사서 10년 보유했다면', f'연평균 {pct(lo, sign=True)} ~ {pct(hi, sign=True)} · 이익으로 끝난 비율 {pct(pos, 0)}'))
    tbl = ''.join(f'<tr><td>{a}</td><td class="n">{b}</td></tr>' for a, b in rows)
    # 자동 비교 문장 (숫자가 바뀌면 문장도 따라 바뀜)
    notes = []
    peer = IDX_PEER.get(key)
    cc, yrs = None, 10
    if peer:   # 두 페이지 표에 나오는 '최근 N년 연평균'을 그대로 비교 (페이지마다 숫자가 같게)
        ps = hist_stats(peer)
        for yrs in (10, 5):
            if yrs in st['ret'] and yrs in ps['ret']:
                cc = (st['ret'][yrs], ps['ret'][yrs])
                break
    if cc:
        a, b = cc
        pn = IDX_NAME[peer]
        gap = round(a * 100, 1) - round(b * 100, 1)   # 표에 보이는 반올림 값끼리 빼서 문장과 표가 맞게
        if abs(gap) < 0.5:
            notes.append(f'최근 {yrs}년 연평균은 {name} {pct(a)}, {pn} {pct(b)}로 두 지수가 비슷했습니다.')
        else:
            notes.append(f'최근 {yrs}년 연평균은 {name} {pct(a)}, {pn} {pct(b)}로 {name}{josa(name)} 연 {abs(gap):.1f}%p {"높았" if gap > 0 else "낮았"}습니다.')
    if st['from_hi'] > -0.03:
        notes.append(f'지금 지수는 {f["first_y"]}년 이후 최고치 근처에 있습니다. 최고치 근처에서는 기대가 이미 가격에 많이 반영돼 있을 수 있어, 한 번에 사기보다 나눠 사는 방법이 위험을 줄입니다.')
    elif st['from_hi'] < -0.3:
        notes.append(f'지금 지수는 {f["first_y"]}년 이후 최고치보다 {pct(-st["from_hi"])} 낮습니다. 고점을 회복하려면 지금보다 {pct(st["hi"] / st["v"] - 1)} 올라야 합니다.')
    if st.get('roll10'):
        lo, hi, pos, cnt = st['roll10']
        loss = 1 - pos
        if loss >= 0.01:
            notes.append(f'10년을 들고 있어도 시작 시점에 따라 손실로 끝난 경우가 {pct(loss, 0)} 있었습니다. 같은 지수라도 언제 샀는지가 결과를 크게 바꿉니다.')
        elif loss > 0:
            notes.append(f'10년을 들고 있었다면 대부분 이익으로 끝났지만, 손실로 끝난 시작 시점도 드물게(1% 미만) 있었습니다. 연평균은 {pct(lo)}에서 {pct(hi)}까지 시작 시점에 따라 크게 달랐습니다.')
        else:
            notes.append(f'{f["first_y"]}년 이후 데이터에서는 어느 주에 샀든 10년을 들고 있었다면 이익으로 끝났습니다. 다만 연평균은 {pct(lo)}에서 {pct(hi)}까지 시작 시점에 따라 크게 달랐습니다.')
    out = (f'\n    <!-- [IDXNOTE] {esc(name)} 고유 해설 + 자동 갱신 통계 (scripts/data_facts.py · content/index/{key}.html) -->\n'
           f'    <section class="guide idx-note" aria-labelledby="in-{key}-h">'
           f'<h2 id="in-{key}-h">{esc(name)} 지수 해설과 데이터로 본 특징</h2>'
           f'<div class="g-card in-text">{body}</div>'
           f'<div class="g-card in-data"><h3>숫자로 보는 {esc(name)} <small>주간 종가 · {f["asof"]} 기준 · 자동 갱신</small></h3>'
           f'<div class="table-scroll"><table class="g-tbl in-tbl"><tbody>{tbl}</tbody></table></div>'
           + ('<ul class="g-list in-auto">' + ''.join(f'<li>{esc(n)}</li>' for n in notes) + '</ul>' if notes else '') +
           f'<p class="in-src">자료: 이 사이트가 매일 모으는 {esc(name)} 주간 종가({esc(_load("history.json")["src"].get(IDX_SYM[key], ""))}) — '
           f'{f["first"]}부터. 가격 지수 기준(배당 제외)이며, 과거 성과가 미래 수익을 보장하지 않습니다.</p></div></section>\n')
    return out


# ── 투자 공부 글에 쓰는 값 ──
def _mcap_rows():
    m = _load('mcap.json')
    return m, m['rows']


def _ko_names(src_text):
    m = re.search(r'var KO = \{(.*?)\};', src_text, re.S)
    out = {}
    if m:
        for a, b, c in re.findall(r"(?:'([^']+)'|([A-Za-z0-9_]+))\s*:\s*'([^']*)'", m.group(1)):
            out[a or b] = c
    return out


COUNTRY_KO = {'United States': '미국', 'China': '중국', 'Taiwan': '대만', 'South Korea': '한국', 'Japan': '일본', 'Saudi Arabia': '사우디아라비아',
              'Netherlands': '네덜란드', 'Switzerland': '스위스', 'Germany': '독일', 'France': '프랑스', 'United Kingdom': '영국', 'Hong Kong': '홍콩',
              'Canada': '캐나다', 'India': '인도', 'Denmark': '덴마크', 'Spain': '스페인', 'Ireland': '아일랜드', 'Australia': '호주',
              'United Arab Emirates': '아랍에미리트', 'Italy': '이탈리아', 'Sweden': '스웨덴', 'Belgium': '벨기에', 'Brazil': '브라질'}


def _jo(x):
    """달러 → '약 5.17조 달러'"""
    return f'약 {x / 1e12:.2f}조 달러'


def learn_facts(src_text=None):
    if src_text is None:
        with open(os.path.join(ROOT, 'src', 'index.html'), encoding='utf-8') as fh:
            src_text = fh.read()
    f = {}
    # 06 레버리지 ETF
    tq0, sx0 = etf_series('TQQQ')[0][0], etf_series('SOXL')[0][0]
    e = {}
    for sym, d0 in (('QQQ', tq0), ('TQQQ', tq0), ('SOXX', sx0), ('SOXL', sx0)):
        e[sym] = etf_stats(sym, d0)
        f[f'etf.{sym}.cagr'] = pct(e[sym]['cagr'])
        f[f'etf.{sym}.mdd'] = pct(e[sym]['mdd'])
        f[f'etf.{sym}.from'] = ymd_dot(day(e[sym]['start'])) + '~'
    f['etf.asof'] = ymd_ko(day(min(x['end'] for x in e.values())))
    lev_up = e['TQQQ']['cagr'] > e['QQQ']['cagr'] and e['SOXL']['cagr'] > e['SOXX']['cagr']
    f['etf.lev_vs_1x'] = ('첫째, 이 기간은 기술주·반도체의 큰 상승기가 길게 이어져 3배 ETF의 장기 연평균이 1배보다 높았습니다.' if lev_up else
                          '첫째, 이 기간에는 3배 ETF의 장기 연평균이 1배보다 높지 않은 경우도 있었습니다. 변동성 끌림이 상승분을 깎아 먹은 결과입니다.')
    lo, hi = sorted([e['TQQQ']['mdd'], e['SOXL']['mdd']])
    f['etf.lev_mdd'] = f'{pct(hi)}~{pct(lo)}'
    d21, d22 = (datetime.date(2021, 11, 19) - EPOCH).days, (datetime.date(2022, 12, 30) - EPOCH).days
    for sym in ('QQQ', 'TQQQ', 'SOXX', 'SOXL'):
        f[f'etf.{sym}.bear'] = pct(etf_window(sym, d21, d22), 0)
    # 10·05 시가총액
    m, rows = _mcap_rows()
    ko = _ko_names(src_text)
    tot = sum(r['m'] for r in rows)
    f['mcap.asof'] = ymd_ko(m['asOf'])
    f['mcap.total'] = f'약 {tot / 1e12:.1f}조 달러'
    by = {}
    for r in rows:
        c = COUNTRY_KO.get(r['c'], r['c'])
        n, s = by.get(c, (0, 0))
        by[c] = (n + 1, s + r['m'])
    us = by.get('미국', (0, 0))
    f['mcap.us.n'] = f'{us[0]}곳'
    f['mcap.us.share'] = f'약 {us[1] / tot * 100:.0f}%'
    others = sorted(((c, v) for c, v in by.items() if c != '미국'), key=lambda x: -x[1][1])[:3]
    if not any(c == '한국' for c, _ in others) and '한국' in by:
        others.append(('한국', by['한국']))
    f['mcap.others'] = ', '.join(f'{c} {n}곳(약 {s / tot * 100:.1f}%)' for c, (n, s) in others)
    kr = [r for r in rows if r['c'] == 'South Korea']
    f['mcap.kr.n'] = f'{len(kr)}곳' if kr else '한 곳도 없습니다'

    def name(r):
        return ko.get(r['s'], r['n'])
    top = rows[:6]
    show = top + [r for r in kr if r not in top]
    f['mcap.table'] = ''.join(
        f'<tr><td class="n">{r["r"]}</td><td>{esc(name(r))}</td><td>{esc(COUNTRY_KO.get(r["c"], r["c"]))}</td><td class="n">{_jo(r["m"])}</td></tr>' for r in show)
    f['mcap.top1'] = name(rows[0])
    f['mcap.top1.cap'] = _jo(rows[0]['m'])
    # 코스피 상위 100 합계 (실적발표 캘린더 자료: 원화) vs 세계 1위
    ea = _load('earnings.json')
    krw = sum(r['m'] for r in ea['kr'] if r.get('m'))
    fx = None
    try:
        fx = float(_load('history.json')['series']['USDKRW=X'][-1][1])
    except Exception:
        pass
    q = _load('market.json').get('quotes', {})
    for k in ('USDKRW=X', 'USDKRW', 'usdkrw'):
        v = q.get(k)
        if isinstance(v, dict) and (v.get('p') or v.get('price')):
            fx = float(v.get('p') or v.get('price'))
            break
    f['kr100.krw'] = f'약 {krw / 1e12:,.0f}조 원'
    f['kr100.fx'] = f'{fx:,.1f}원'
    usd = krw / fx
    f['kr100.usd'] = f'약 {usd / 1e12:.1f}조 달러'
    f['kr100.vs_top1'] = ('보다 작았습니다' if usd < rows[0]['m'] else '보다 컸습니다')
    # 09 실적 (삼성전자 — 실적발표 캘린더 자료)
    ss = next(r for r in ea['kr'] if r['c'] == '005930')
    ls = ss['ls']
    pdq = ls['pd']                       # '2026.09'
    yy, mm = int(pdq[:4]), int(pdq[5:7])
    qn = (mm + 2) // 3
    f['ss.q'] = f'{yy}년 {qn}분기'
    f['ss.d'] = ymd_ko(ls['d'])
    kind = next((k for d, k in ss.get('pa', []) if d == ls['d']), 'pre')
    f['ss.kind'] = '잠정실적' if kind == 'pre' else '확정 실적'
    jo = lambda x: f'{x / 10000:,.2f}조 원'
    f['ss.rev'], f['ss.op'] = jo(ls['rev']), jo(ls['op'])
    f['ss.revY'], f['ss.opY'] = jo(ls['revY']), jo(ls['opY'])
    f['ss.revYoY'] = pct(ls['rev'] / ls['revY'] - 1, sign=True)
    f['ss.opYoY'] = pct(ls['op'] / ls['opY'] - 1, sign=True)
    f['ss.opE'] = jo(ls['opE']) if ls.get('opE') else '없음'
    sp = ls['op'] / ls['opE'] - 1 if ls.get('opE') else None
    f['ss.sp'] = pct(sp, sign=True) if sp is not None else '—'
    f['ss.cons'] = (f'이 분기 영업이익 컨센서스는 약 {f["ss.opE"]}(와이즈리포트 기준)이었고, 실제는 {f["ss.op"]}으로 <b>예상 대비 {f["ss.sp"]}</b>였습니다.'
                    if sp is not None else f'이 분기 실제 영업이익은 {f["ss.op"]}이었습니다(비교할 컨센서스 자료 없음).')
    if sp is None:
        f['ss.sp_word'] = '이번 분기는 비교할 예상치가 없었습니다.'
    elif sp >= 0.10:
        f['ss.sp_word'] = '예상을 10% 넘게 웃돈 어닝 서프라이즈였습니다.'
    elif sp <= -0.10:
        f['ss.sp_word'] = '예상을 10% 넘게 밑돈 어닝 쇼크였습니다.'
    else:
        f['ss.sp_word'] = '예상 범위 안에 들어온 실적이었습니다.'
    g = ls['op'] / ls['opY']
    f['ss.op_mult'] = (f'1년 만에 영업이익이 약 {g:.1f}배가 되어도' if g >= 1.5 else
                       f'영업이익이 1년 전보다 {pct(g - 1, sign=True)} 달라져도')
    f['ss.opm'] = pct(ls['op'] / ls['rev'])
    f['ss.opmY'] = pct(ls['opY'] / ls['revY'])
    f['ss.opm_word'] = '높아졌습니다' if ls['op'] / ls['rev'] > ls['opY'] / ls['revY'] else '낮아졌습니다'
    f['ss.p'] = f'{ss["p"]:,.0f}원'
    f['ss.pd'] = ymd_ko(ss['pd'])
    for k in ('t', 'b', 'f'):
        f[f'ss.per.{k}'] = f'약 {ss["per"][k]:.1f}배' if ss['per'].get(k) else '없음'
    t, b, fw = (ss['per'].get(k) for k in ('t', 'b', 'f'))
    if t and b and fw and t > b > fw:
        f['ss.per_word'] = '후행 → 혼합 → 선행으로 갈수록 PER이 작아진다는 것은, 증권사들이 <b>앞으로 이익이 더 커질 것</b>으로 예상한다는 뜻입니다.'
    elif t and fw and fw > t:
        f['ss.per_word'] = '선행 PER이 후행 PER보다 크다는 것은, 증권사들이 <b>앞으로 이익이 줄어들 것</b>으로 예상한다는 뜻입니다.'
    else:
        f['ss.per_word'] = '세 PER의 차이는 증권사들이 예상하는 이익의 방향을 보여 줍니다.'
    f['earn.asof'] = ymd_ko(ss['pd'])
    # 지수 통계 (15 한국 증시 등) — idx.<지수>.cagr<N> · .y<연도> · .from_hi · .asof · .first_y · .up(오른 해 비율)
    idx_last = []
    for key in ('kospi', 'kosdaq', 'sp500', 'nasdaq100', 'n225', 'taiex'):
        try:
            st = hist_stats(key)
        except Exception:
            continue
        idx_last.append(st['last'])
        for n, r in st['ret'].items():
            f[f'idx.{key}.cagr{n}'] = pct(r) if n > 1 else pct(r, sign=True)
        for y, r in st['years'].items():
            f[f'idx.{key}.y{y}'] = pct(r, sign=True)
        f[f'idx.{key}.from_hi'] = pct(st['from_hi'])
        f[f'idx.{key}.below_hi'] = pct(-st['from_hi'])
        f[f'idx.{key}.asof'] = ymd_ko(day(st['last']))
        f[f'idx.{key}.first_y'] = str(day(st['first']).year)
        f[f'idx.{key}.up'] = f"{len(st['years'])}년 중 {st['up_y']}년" if st.get('years') else '—'
        if st.get('roll10'):
            lo, hi, pos, cnt = st['roll10']
            f[f'idx.{key}.roll10'] = f'연평균 {pct(lo, sign=True)} ~ {pct(hi, sign=True)}'
            f[f'idx.{key}.roll10loss'] = pct(1 - pos, 0)
    if 'idx.kospi.cagr30' in f and 'idx.sp500.cagr30' in f:
        k30, s30 = hist_stats('kospi')['ret'][30], hist_stats('sp500')['ret'][30]
        f['idx.kospi_vs_sp500.x30'] = f'{(1 + k30) ** 30:.1f}배'
        f['idx.sp500.x30'] = f'{(1 + s30) ** 30:.1f}배'
    dates = [m['asOf'], ss['pd'], day(min(x['end'] for x in e.values())).isoformat()] + ([day(min(idx_last)).isoformat()] if idx_last else [])
    return f, max(dates)


def fill(text, facts, where=''):
    def rep(mm):
        k = mm.group(1).strip()
        if k not in facts:
            sys.exit(f'{where}: 알 수 없는 자동 값 {{{{{k}}}}}')
        return str(facts[k])
    return re.sub(r'\{\{([a-zA-Z0-9_.]+)\}\}', rep, text)


# ── 자료 화면 자동 요약 [AUTOSUM] ──
# 시가총액·환율·아파트 순위·실적 캘린더는 표를 자바스크립트가 채워, 처음 받은 HTML(검색엔진·스크립트 꺼진 화면)에는 숫자가 없음.
# 빌드 때 같은 data/*.json 으로 요약 글·표를 만들어 넣음 → 자료가 갱신될 때마다(build-pages.yml workflow_run·예약 실행) 글도 따라 바뀜
KST = datetime.timezone(datetime.timedelta(hours=9))
WD = '월화수목금토일'


def _kst(iso):
    return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(KST)


def _when(iso):
    k = _kst(iso)
    return f'{ymd_ko(k.date())} {k:%H:%M}'


def _md(d):
    """'2026-10-21' → '10.21(수)'"""
    x = datetime.date.fromisoformat(d[:10])
    return f'{x.month}.{x.day}({WD[x.weekday()]})'


def _ro(word):
    """'으로'/'로' — 받침 없음·ㄹ 받침이면 '로' (숫자 끝은 읽는 소리: 영·삼·육 → 으로)"""
    c = word.strip()[-1]
    if '가' <= c <= '힣':
        return '로' if (ord(c) - 0xAC00) % 28 in (0, 8) else '으로'
    if c.isdigit():
        return '으로' if c in '036' else '로'
    return '로'


def _sp(x, d=2):
    """% 값(1.38 → +1.38%) — 반올림해서 0이면 부호 없이"""
    return pct(x / 100, d, sign=round(x, d) != 0)


def _sec(key, title, sub, inner, src):
    return (f'\n    <!-- [AUTOSUM] {esc(title)} — 빌드 때 data/*.json 으로 채움 (scripts/data_facts.py · 자동 갱신) -->\n'
            f'    <section class="guide idx-note auto-sum" id="asum-{key}" aria-labelledby="asum-{key}-h">'
            f'<h2 id="asum-{key}-h">{esc(title)}</h2>'
            f'<div class="g-card in-data"><h3>{sub}</h3>{inner}<p class="in-src">{src}</p></div></section>\n')


def _tbl(head, rows):
    return ('<div class="table-scroll"><table class="g-tbl asum-tbl"><thead><tr>'
            + ''.join(f'<th class="{h[1]}">{h[0]}</th>' if isinstance(h, tuple) else f'<th>{h}</th>' for h in head) + '</tr></thead><tbody>'
            + ''.join('<tr>' + ''.join(f'<td class="{c[1]}">{c[0]}</td>' if isinstance(c, tuple) else f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
            + '</tbody></table></div>')   # 칸이 (글자, 'n') 이면 숫자 칸(오른쪽 정렬·줄바꿈 없음)


def _ul(items):
    return '<ul class="g-list in-auto">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>' if items else ''


def autosum_mcap(src_text):
    m, rows = _mcap_rows()
    if len(rows) < 20:
        raise ValueError(f'mcap.json 기업 {len(rows)}곳')
    ko = _ko_names(src_text)
    name = lambda r: ko.get(r['s'], r['n'])
    cty = lambda r: COUNTRY_KO.get(r['c'], r['c'])
    tot = sum(r['m'] for r in rows)

    def move(r):
        if r.get('pr') is None:
            return 'NEW'
        d = r['pr'] - r['r']
        return f'▲{d}' if d > 0 else f'▼{-d}' if d < 0 else '—'
    top = rows[:10]
    tb = _tbl(['순위', '기업 · 나라', ('시가총액', 'n'), ('전일 대비', 'n'), ('순위', 'n')],
              [[str(r['r']), f'{esc(name(r))}<br><small>{esc(cty(r))}</small>', (f'{r["m"] / 1e12:.2f}조 달러', 'n'),
                (_sp(r['ch']) if isinstance(r.get('ch'), (int, float)) else '—', 'n'), (move(r), 'n')] for r in top])
    by = {}
    for r in rows:
        n, s = by.get(cty(r), (0, 0))
        by[cty(r)] = (n + 1, s + r['m'])
    order = sorted(by.items(), key=lambda x: -x[1][1])
    t10 = sum(r['m'] for r in top)
    li = [f'상위 100개 기업의 시가총액 합계는 약 {tot / 1e12:.1f}조 달러이고, 1위 {esc(name(rows[0]))}{josa(name(rows[0]), "이", "가")} 그중 {pct(rows[0]["m"] / tot)}, '
          f'상위 10개 기업이 {pct(t10 / tot)}를 차지합니다.',
          '나라별로는 ' + ', '.join(f'{esc(c)} {n}곳({pct(s / tot)})' for c, (n, s) in order[:4]) + ' 순으로 많습니다.']
    kr = [r for r in rows if r['c'] == 'South Korea']
    if kr:
        li.append(f'한국 기업은 {len(kr)}곳이 100위 안에 있습니다: ' + ', '.join(f'{esc(name(r))} {r["r"]}위' for r in kr) + '.')
    else:
        li.append('오늘은 100위 안에 든 한국 기업이 없습니다.')
    hc = [r for r in rows if isinstance(r.get('ch'), (int, float))]
    up, dn = (max(hc, key=lambda r: r['ch']), min(hc, key=lambda r: r['ch'])) if hc else (None, None)
    if up and up['ch'] > 0 and dn['ch'] < 0:
        li.append(f'전 거래일보다 주가가 가장 많이 오른 기업은 {esc(name(up))}({pct(up["ch"] / 100, 2, sign=True)}), '
                  f'가장 많이 내린 기업은 {esc(name(dn))}({pct(dn["ch"] / 100, 2, sign=True)})입니다.')
    new = [r for r in rows if r.get('pr') is None]
    jump = [r for r in rows if r.get('pr') is not None and r['pr'] - r['r'] >= 3]
    if new:
        li.append('새로 100위 안에 들어온 기업: ' + ', '.join(f'{esc(name(r))}({r["r"]}위)' for r in new) + '.')
    if jump:
        jump.sort(key=lambda r: r['r'] - r['pr'])
        li.append('순위가 3계단 이상 오른 기업: ' + ', '.join(f'{esc(name(r))}({r["pr"]}위 → {r["r"]}위)' for r in jump[:5]) + '.')
    return _sec('mcap', '오늘의 세계 시가총액 순위 요약', f'{ymd_ko(m["asOf"])} 종가 기준 TOP 10 <small>자동 갱신</small>', tb + _ul(li),
                f'자료: {esc(m.get("source", "companiesmarketcap.com · Yahoo Finance"))} — {ymd_ko(m["asOf"])} 종가(전 거래일 {ymd_ko(m["prevDate"])} 순위와 비교). '
                '시가총액은 같은 날 환율로 바꾼 미국 달러 기준이고, 위 표는 페이지를 열 때 최신 자료로 다시 그려집니다.')


FX_LIST = [('USD', '미국 달러', 1), ('EUR', '유로', 1), ('JPY', '일본 엔', 100), ('CNY', '중국 위안', 1), ('GBP', '영국 파운드', 1), ('HKD', '홍콩 달러', 1),
           ('SGD', '싱가포르 달러', 1), ('AUD', '호주 달러', 1), ('CAD', '캐나다 달러', 1), ('CHF', '스위스 프랑', 1), ('THB', '태국 바트', 1), ('VND', '베트남 동', 100)]


def _fx_quote(code):
    """원화 환율(1 외화 = N원) — (최신값, 시각 ISO, 전 거래일 종가, [(날짜, 종가)…]) · 베트남 동은 USD/KRW ÷ USD/VND"""
    q = _load('market.json')['quotes']
    if code == 'VND':
        a, b = q['USDKRW=X'], q['USDVND=X']
        da = {datetime.datetime.fromtimestamp(t, KST).date(): v for t, v in a['daily']}
        db = {datetime.datetime.fromtimestamp(t, KST).date(): v for t, v in b['daily']}
        ser = [(d, da[d] / db[d]) for d in sorted(set(da) & set(db))]
        return a['price'] / b['price'], min(a['time'], b['time']), a['prev'] / b['prev'], ser
    x = q[code + 'KRW=X']
    ser = [(datetime.datetime.fromtimestamp(t, KST).date(), v) for t, v in x['daily']]
    return x['price'], x['time'], x['prev'], ser


def _usdkrw_ecos():
    u = _load('usdkrw.json')
    d, days = u['d0'], [u['d0']]
    for x in u['dd']:
        d += x
        days.append(d)
    if len(days) != len(u['c']):
        raise ValueError('usdkrw.json 날짜·종가 개수 다름')
    return [(day(a), v) for a, v in zip(days, u['c'])], u


def autosum_fx():
    rows, chg = [], []
    t_last = 0
    for code, nm, unit in FX_LIST:
        p, t, prev, ser = _fx_quote(code)
        if not (p > 0 and prev > 0):
            raise ValueError(f'{code} 환율 이상: {p}')
        t_last = max(t_last, t)
        d1 = p / prev - 1 if prev != p else None
        m1 = None
        if len(ser) >= 2:
            last = ser[-1][0]
            old = [v for dd, v in ser if (last - dd).days >= 28]
            base = old[-1] if old else (ser[0][1] if (last - ser[0][0]).days >= 20 else None)
            if base:
                m1 = p / base - 1
                chg.append((nm, m1))
        rows.append([f'{esc(nm)}<br><small>{unit} {code}</small>', (f'<b>{p * unit:,.2f}원</b>', 'n'),
                     (pct(d1, 2, sign=True) if d1 is not None else '—', 'n'), (pct(m1, 1, sign=True) if m1 is not None else '—', 'n')])
    when = datetime.datetime.fromtimestamp(t_last, KST)
    tb = _tbl(['통화', ('원화 환율', 'n'), ('전일 대비', 'n'), ('약 1개월', 'n')], rows)
    usd_p, _, usd_prev, _ = _fx_quote('USD')
    li = []
    d = usd_p / usd_prev - 1
    if abs(d) >= 0.00005:
        li.append(f'원·달러 환율은 {usd_p:,.2f}원으로 전 거래일 종가보다 {pct(abs(d), 2)} {"올랐" if d > 0 else "내렸"}습니다. '
                  f'환율이 {"오르면 같은 1달러를 사는 데 원화가 더 들어 원화 가치가 떨어진 것(원화 약세)" if d > 0 else "내리면 같은 1달러를 더 적은 원화로 살 수 있어 원화 가치가 오른 것(원화 강세)"}입니다.')
    if len(chg) >= 3:
        chg.sort(key=lambda x: x[1])
        a, b = chg[-1], chg[0]   # 원화 대비 가장 많이 오른(덜 내린) 통화 · 가장 많이 내린(덜 오른) 통화
        nn = f'{len(chg)}개 통화' if len(chg) == len(FX_LIST) else f'1개월 전 시세가 있는 {len(chg)}개 통화'
        if a[1] < 0:
            li.append(f'최근 약 1개월 동안 {nn}가 모두 원화 대비 내렸습니다(원화 강세). 가장 많이 내린 통화는 {esc(b[0])}({pct(b[1], 1, sign=True)}), '
                      f'가장 적게 내린 통화는 {esc(a[0])}({pct(a[1], 1, sign=True)})입니다.')
        elif b[1] > 0:
            li.append(f'최근 약 1개월 동안 {nn}가 모두 원화 대비 올랐습니다(원화 약세). 가장 많이 오른 통화는 {esc(a[0])}({pct(a[1], 1, sign=True)}), '
                      f'가장 적게 오른 통화는 {esc(b[0])}({pct(b[1], 1, sign=True)})입니다.')
        else:
            li.append(f'최근 약 1개월 동안 원화 대비 가장 많이 오른 통화는 {esc(a[0])}({pct(a[1], 1, sign=True)}), 가장 많이 내린 통화는 {esc(b[0])}({pct(b[1], 1, sign=True)})입니다.')
    ser, u = _usdkrw_ecos()
    ld, lv = ser[-1]
    y1 = [(dd, v) for dd, v in ser if (ld - dd).days <= 365]
    hi, lo = max(y1, key=lambda x: x[1]), min(y1, key=lambda x: x[1])
    y10 = [v for dd, v in ser if (ld - dd).days <= 3653]
    avg10 = sum(y10) / len(y10)
    top = max(ser, key=lambda x: x[1])
    gfc = max(((dd, v) for dd, v in ser if datetime.date(2008, 1, 1) <= dd <= datetime.date(2009, 12, 31)), key=lambda x: x[1], default=None)
    li.append(f'한국은행 매매기준율로 보면 {ymd_ko(ld)} 원·달러 환율은 {lv:,.1f}원입니다. 최근 1년 최고는 {hi[1]:,.1f}원({ymd_dot(hi[0])}), 최저는 {lo[1]:,.1f}원({ymd_dot(lo[0])})이었고, '
              f'최근 10년 평균 {avg10:,.1f}원보다 {pct(abs(lv / avg10 - 1))} {"높" if lv > avg10 else "낮"}습니다.')
    crisis = '외환위기' if top[0].year in (1997, 1998) else ''
    li.append(f'1990년 이후 가장 높았던 날은 {ymd_ko(top[0])}{"(" + crisis + ")" if crisis else ""}의 {top[1]:,.1f}원'
              + (f'이고, 2008년 글로벌 금융위기 때는 {ymd_ko(gfc[0])} {gfc[1]:,.1f}원까지 올랐습니다.' if gfc else '입니다.')
              + ' 환율은 위기 때 짧은 기간에 크게 오르는 경향이 있어, 해외 자산은 환율 변동까지 함께 생각해야 합니다.')
    return _sec('fx', '주요 통화 원화 환율 요약', f'{ymd_ko(when.date())} {when:%H:%M} 기준 · 12개 통화 <small>자동 갱신</small>', tb + _ul(li),
                f'자료: Yahoo Finance 외환 시세(data/market.json · 베트남 동은 달러 환율로 교차 계산) · 한국은행 ECOS 원/미국달러 매매기준율(data/usdkrw.json, {ymd_ko(ld)}까지). '
                '엔·동은 100단위로 표시합니다. 은행에서 실제로 바꿀 때는 여기에 환전 수수료(스프레드)가 붙습니다.')


def _man(n):
    """만원 → '25억 3,000만원' (아파트 순위 화면과 같은 표기)"""
    e, m = int(n // 10000), int(round(n - (n // 10000) * 10000))
    return f'{m:,}만원' if not e else f'{e:,}억' + (f' {m:,}만원' if m else '원')


def autosum_apt():
    a = _load('apt_rank.json')
    R = sorted(a['rows'], key=lambda r: r[4], reverse=True)   # 화면과 같은 순서: 금액 높은 순 · 같은 금액은 최근 계약 먼저
    R.sort(key=lambda r: -r[2])
    if len(R) < 1000:
        raise ValueError(f'apt_rank.json 단지 {len(R)}곳')
    rank, prev = [], None
    for i, r in enumerate(R):
        rank.append(rank[-1] if prev is not None and prev[2] == r[2] else i + 1)
        prev = r
    py = lambda r: r[2] / (r[3] / 3.3058) if r[3] > 0 else 0
    tb = _tbl(['순위', '아파트 · 지역', ('실거래가', 'n'), ('전용면적', 'n'), ('계약일', 'n')],
              [[str(rank[i]), f'{esc(r[1])}<br><small>{esc(r[7])} {esc(r[8])} {esc(r[9].split(" ")[0])}</small>', (_man(r[2]), 'n'),
                (f'{r[3]:g}㎡<br><small>{r[3] / 3.3058:.0f}평</small>', 'n'), (ymd_dot(r[4]), 'n')] for i, r in enumerate(R[:10])])
    med = R[len(R) // 2]
    se = sorted([r[2] for r in R if r[7] == '서울'], reverse=True)
    ex = sorted([r[2] for r in R if r[7] != '서울'], reverse=True)
    cnt = sum(r[12] or 0 for r in R)
    over = [r for r in R if r[2] >= 100000]
    li = [f'최근 1년 동안 매매가 신고된 전국 아파트 단지는 {len(R):,}곳, 거래는 모두 {cnt:,}건입니다. 단지마다 가장 최근 실거래가를 줄 세우면 가운데 단지(중위)는 {_man(med[2])}입니다.']
    if se and ex:
        li.append(f'서울 단지 {len(se):,}곳의 중위 실거래가는 {_man(se[len(se) // 2])}, 서울을 뺀 지역 {len(ex):,}곳은 {_man(ex[len(ex) // 2])}{_ro(_man(ex[len(ex) // 2]))} '
                  f'서울이 약 {se[len(se) // 2] / ex[len(ex) // 2]:.1f}배입니다.')
    if over:
        so = sum(1 for r in over if r[7] == '서울')
        li.append(f'최근 실거래가가 10억원 이상인 단지는 {len(over):,}곳(전체의 {pct(len(over) / len(R))})이고, 그중 {so:,}곳({pct(so / len(over), 0)})이 서울입니다.')
    big = [r for r in R if r[3] >= 59]   # 아주 작은 면적의 높은 평당가가 1위가 되지 않게 전용 59㎡ 이상에서
    if big:
        b = max(big, key=py)
        li.append(f'전용 59㎡ 이상에서 평당가(전용 3.3㎡당)가 가장 높은 단지는 {esc(b[7])} {esc(b[8])} {esc(b[1])}{_ro(b[1])}, 전용 {b[3]:g}㎡가 {_man(b[2])}에 거래돼 평당 약 {py(b) / 1e4:,.2f}억원입니다.')
    last = max(r[4] for r in R)
    li.append(f'가장 최근 계약일은 {ymd_ko(last)}입니다. 실거래 신고 기한이 계약 후 30일이라 최근 몇 주 거래는 앞으로 더 늘어날 수 있습니다.')
    return _sec('apt', '전국 아파트 실거래가 순위 요약', f'최근 1년 실거래 기준 TOP 10 <small>{_when(a["updated"])} 갱신 · 자동 갱신</small>', tb + _ul(li),
                f'자료: {esc(a.get("source", "국토교통부 아파트 매매 실거래가"))} (data/apt_rank.json). 단지마다 가장 최근 1건(계약 해제 제외)의 금액이며, '
                '시세·호가와 다를 수 있습니다. 위 순위표는 페이지를 열 때 최신 자료로 다시 그려집니다.')


def autosum_earn():
    e = _load('earnings.json')
    if len(e.get('kr') or []) < 50 or len(e.get('us') or []) < 50:
        raise ValueError(f'earnings.json 기업 수 이상 (국내 {len(e.get("kr") or [])} · 미국 {len(e.get("us") or [])})')
    td = datetime.date.fromisoformat(e['today'])
    nm = lambda x, mk: x.get('n') if mk == 'kr' else (x.get('ko') or x.get('n'))
    up = {}
    n_est = {'kr': 0, 'us': 0}
    for mk in ('kr', 'us'):
        for x in e[mk]:
            n = x.get('nx') or {}
            if not n.get('d'):
                continue
            dd = (datetime.date.fromisoformat(n['d']) - td).days
            if not 0 <= dd <= 14:
                continue
            if n.get('k') in ('ir', 'conf'):
                up.setdefault(n['d'], {'kr': [], 'us': []})[mk].append(x)
            else:
                n_est[mk] += 1
    rows = []
    for d in sorted(up):
        cell = lambda mk: ', '.join(esc(nm(x, mk)) for x in sorted(up[d][mk], key=lambda x: x.get('r') or 999)) or '—'
        rows.append([_md(d), cell('kr'), cell('us')])
    n_kr = sum(len(v['kr']) for v in up.values())
    n_us = sum(len(v['us']) for v in up.values())
    inner = (_tbl(['날짜', '국내 (시가총액 순)', '미국 (시가총액 순)'], rows) if rows else '<p class="in-src">앞으로 2주 안에 회사가 확정해 알린 발표 일정이 없습니다.</p>')
    li = [f'앞으로 2주(오늘 포함) 안에 발표일이 확정된 기업은 국내 {n_kr}곳, 미국 {n_us}곳입니다.'
          + (f' 이 밖에 국내 {n_est["kr"]}곳·미국 {n_est["us"]}곳은 작년 발표일·법정 기한으로 추정한 예상 일정이라 표에서 뺐습니다.' if n_est['kr'] or n_est['us'] else '')]
    rec = []
    for mk in ('kr', 'us'):
        for x in e[mk]:
            ls = x.get('ls') or {}
            if ls.get('d') and 0 <= (td - datetime.date.fromisoformat(ls['d'])).days <= 14 and isinstance(ls.get('sp'), (int, float)):
                rec.append((ls['d'], mk, x, ls['sp']))
    rec.sort(key=lambda t: (t[1] != 'kr', t[2].get('r') or 999))   # 같은 날은 국내 먼저 · 시가총액 순
    rec.sort(key=lambda t: t[0], reverse=True)                        # 최근 발표 먼저 (정렬 안정성으로 위 순서 유지)
    rt = ''
    if rec:
        beat = sum(1 for t in rec if t[3] > 0)
        rt = _tbl(['발표일', '기업', ('예상 대비', 'n')], [[_md(d), f'{esc(nm(x, mk))}<br><small>{"국내 · 영업이익" if mk == "kr" else "미국 · 주당순이익(EPS)"}</small>',
                                                (_sp(sp, 1), 'n')] for d, mk, x, sp in rec[:20]])
        li.append(f'최근 2주 동안 실적을 발표한 {len(rec)}곳 중 {beat}곳이 증권가 예상(컨센서스)보다 좋게, {len(rec) - beat}곳이 같거나 나쁘게 나왔습니다.'
                  ' 국내는 영업이익, 미국은 주당순이익(EPS)을 예상치와 비교했습니다.')
        big = max(rec, key=lambda t: abs(t[3]))
        li.append(f'예상과 가장 크게 달랐던 곳은 {esc(nm(big[2], big[1]))}{_ro(nm(big[2], big[1]))}, 예상 대비 {pct(big[3] / 100, 1, sign=True)}였습니다. '
                  '예상과의 차이가 클수록 발표 직후 주가가 크게 움직이는 경우가 많습니다.')
    inner += _ul(li)
    if rt:
        inner += '<h3>최근 2주 발표 결과 <small>예상 대비 · 최근 순</small></h3>' + rt
    return _sec('earn', '실적발표 일정 요약 — 앞으로 2주와 최근 발표', f'앞으로 2주 확정 일정 <small>{_when(e["updated"])} 갱신 · 자동 갱신</small>', inner,
                f'자료: {esc(e.get("source", ""))} (data/earnings.json). 국내 시가총액 상위 {len(e["kr"])}곳·미국 {len(e["us"])}곳 대상이며, '
                '확정 일정은 회사 공시(IR)·회사 발표 날짜만 넣었습니다. 아래 캘린더는 페이지를 열 때 최신 자료로 다시 그려집니다.')


def _rt(v):
    """금리 3.5 → 3.50% · 1.875 → 1.875%"""
    t = f'{v:.3f}'.rstrip('0')
    if len(t.split('.')[1]) < 2:
        t = f'{v:.2f}'
    return t + '%'


def _rtp(v):
    r = round(v, 3)
    return ('+' if r > 0 else '−' if r < 0 else '') + _rt(abs(r)).replace('%', '%p')


def autosum_rates():
    """[RATES] 전세계 금리 — 주요국 지금 기준금리 · 최근 변경 · 다음 발표 · 한미 금리 차 · 최근 60일 결정"""
    r = _load('rates.json')
    C = {c['c']: c for c in r.get('countries') or []}
    keys = [k for k in ('KR', 'US', 'XM', 'JP', 'CN', 'TW', 'GB', 'CH', 'SE', 'NO', 'PL', 'CZ', 'HU') if k in C]
    if len(keys) < 10:
        raise ValueError(f'rates.json 주요국 {len(keys)}개')
    td = datetime.date.fromisoformat(r['today'])
    rows = []
    for k in keys:
        c = C[k]
        last = next((e for e in reversed(c['ev']) if e[1] != e[2] and e[3] != 'b'), None)
        nx = (c.get('nx') or [None])[0]
        cur = (_rt(c['rng'][0]).rstrip('%') + '~' + _rt(c['rng'][1])) if c.get('rng') else _rt(c['cur'])
        rows.append([f'{esc(c["ko"])}<br><small>{esc(c["bank"])}</small>', (cur, 'n'),
                     (f'{ymd_dot(last[0])} {_rtp(last[1] - last[2])}' if last else '—', 'n'),
                     (_md(nx['d']) if nx and nx.get('d') else (f'{int(nx["m"][5:7])}월 중(추정)' if nx and nx.get('m') else '—'), 'n')])
    li = []
    kr, us = C['KR']['cur'], C['US']['cur']
    li.append(f'{ymd_ko(td)} 기준 한국 기준금리는 {_rt(kr)}, 미국 연방기금금리 목표 범위는 {_rt(C["US"]["rng"][0]).rstrip("%")}~{_rt(us)}로 '
              f'한미 금리 차(한국 − 미국 상단)는 {_rtp(kr - us)}입니다.' + (' 한국 금리가 미국보다 낮은 역전 상태입니다.' if kr < us else ''))
    hi = max((C[k] for k in keys), key=lambda c: c['cur']); lo = min((C[k] for k in keys), key=lambda c: c['cur'])
    li.append(f'표의 주요 {len(keys)}개 나라·지역 가운데 기준금리가 가장 높은 곳은 {esc(hi["ko"])}({_rt(hi["cur"])}), 가장 낮은 곳은 {esc(lo["ko"])}({_rt(lo["cur"])})입니다.')
    rec = []
    for c in C.values():
        if c.get('end') or c['c'] == 'XMR':
            continue
        for e in c['ev']:
            if e[3] != 'b' and e[1] != e[2] and 0 <= (td - datetime.date.fromisoformat(e[0])).days <= 60:
                rec.append((e[0], c, e))
    rec.sort(key=lambda t: t[0], reverse=True)
    if rec:
        up = sum(1 for t in rec if t[2][1] > t[2][2])
        li.append(f'최근 60일 동안 금리를 바꾼 곳은 {len(rec)}번(인상 {up} · 인하 {len(rec) - up})입니다: '
                  + ', '.join(f'{esc(c["ko"])} {ymd_dot(d)} {_rtp(e[1] - e[2])}' for d, c, e in rec[:8]) + (' 등' if len(rec) > 8 else '') + '.')
    else:
        li.append('최근 60일 동안 금리를 바꾼 나라는 없습니다.')
    up30 = sorted(((x['d'], C[k]) for k in keys for x in (C[k].get('nx') or []) if x.get('d') and 0 <= (datetime.date.fromisoformat(x['d']) - td).days <= 30), key=lambda t: (t[0], keys.index(t[1]['c'])))
    if up30:
        li.append('앞으로 30일 안의 금리 발표: ' + ', '.join(f'{_md(d)} {esc(c["ko"])}' for d, c in up30) + '.')
    inner = _tbl(['나라 · 중앙은행', ('지금 금리', 'n'), ('최근 변경', 'n'), ('다음 발표', 'n')], rows) + _ul(li)
    return _sec('rates', '주요국 기준금리 요약 — 지금 금리와 다가오는 발표', f'주요국 기준금리 <small>{_when(r["updated"])} 갱신 · 자동 갱신</small>', inner,
                f'자료: {esc(r.get("src", ""))} (data/rates.json). 미국은 목표 범위(표의 숫자는 상단), 유로존은 ECB 예금금리, 중국은 LPR 1년, 대만은 재할인율입니다. '
                '아래 차트·일정·결정 기록은 페이지를 열 때 최신 자료로 다시 그려집니다.')


AUTOSUM = {'mcap': autosum_mcap, 'fx': autosum_fx, 'apt': autosum_apt, 'earn': autosum_earn, 'rates': autosum_rates}


def autosum(key, src_text=None):
    if key not in AUTOSUM:
        sys.exit(f'알 수 없는 자동 요약 {key} (<!--AUTOSUM:키--> · scripts/data_facts.py AUTOSUM)')
    if key == 'mcap':
        if src_text is None:
            with open(os.path.join(ROOT, 'src', 'index.html'), encoding='utf-8') as fh:
                src_text = fh.read()
        return AUTOSUM[key](src_text)
    return AUTOSUM[key]()
