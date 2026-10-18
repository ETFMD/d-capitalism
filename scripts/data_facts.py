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
