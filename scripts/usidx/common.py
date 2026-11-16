#!/usr/bin/env python3
"""[USIDX] 'NASDAQ 100과 S&P500 지수 분석' 자료 공통 도구 — 내려받기·보관·날짜 (표준 라이브러리만)

· RAW = 원자료 보관 폴더(저장소 밖 · Actions 에선 actions/cache) — 환경변수 USIDX_RAW, 없으면 ~/.cache/usidx
· OUT = 게시 자료 data/usidx/ (저장소)
· User-Agent 에 사용자 이메일을 넣지 않음 — SEC 는 'research-bot admin@example.com', 야후·나스닥은 일반 브라우저 문자열
· SEC 는 초당 10회 제한 → 요청 사이 0.12초 이상"""
import datetime as dt, gzip, json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'usidx')
RAW = os.environ.get('USIDX_RAW') or os.path.join(os.path.expanduser('~'), '.cache', 'usidx')
SEC_UA = 'research-bot admin@example.com'
WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
_last = {'sec': 0.0, 'web': 0.0}


def log(*a):
    print(*a, flush=True, file=sys.stderr)


def fetch(url, kind='web', headers=None, tries=4, timeout=40):
    """bytes 를 돌려줌 · 실패하면 예외(404 는 바로) · 429·5xx 는 기다렸다 다시"""
    gap = 0.12 if kind == 'sec' else 0.05
    h = {'User-Agent': SEC_UA if kind == 'sec' else WEB_UA, 'Accept-Encoding': 'gzip'}
    if kind == 'sec':
        h['Host'] = urllib.request.urlparse(url).netloc
    h.update(headers or {})
    err = None
    for i in range(tries):
        w = _last[kind] + gap - time.time()
        if w > 0:
            time.sleep(w)
        _last[kind] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    b = gzip.decompress(b)
                return b
        except urllib.error.HTTPError as e:
            err = e
            if e.code == 404:
                raise
            time.sleep(2 * (i + 1) if e.code in (429, 403, 500, 502, 503, 504) else 1)
        except Exception as e:   # 연결 끊김 등
            err = e
            time.sleep(2 * (i + 1))
    raise err


def jfetch(url, kind='web', **k):
    return json.loads(fetch(url, kind, **k).decode('utf-8', 'replace'))


def rpath(*p):
    f = os.path.join(RAW, *p)
    os.makedirs(os.path.dirname(f), exist_ok=True)
    return f


def jload(path, dflt=None):
    try:
        if path.endswith('.gz'):
            with gzip.open(path, 'rt', encoding='utf-8') as f:
                return json.load(f)
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return dflt


def jsave(path, obj, compact=True):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = '%s.%d.tmp' % (path, os.getpid())
    if path.endswith('.gz'):
        with gzip.open(tmp, 'wt', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    else:
        with open(tmp, 'w', encoding='utf-8') as f:
            if compact:
                json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
            else:
                json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def D(s):
    return dt.date.fromisoformat(s)


def iso(d):
    return d.isoformat()


def third_friday(y, m):
    d = dt.date(y, m, 15)
    return d + dt.timedelta(days=(4 - d.weekday()) % 7)


def rebal_window(d):
    """지수 정기 조정(3·6·9·12월 셋째 금요일) 구간 번호 — 같은 번호 = 같은 구성"""
    if isinstance(d, str):
        d = D(d)
    y, n = d.year, 0
    for m in (3, 6, 9, 12):
        if d > third_friday(y, m):
            n += 1
    return y * 4 + n


def xlsx_rows(b):
    """엑셀(xlsx) bytes → 첫 시트의 줄 목록(문자열·숫자) — 표준 라이브러리만"""
    import io, re, zipfile
    from xml.etree import ElementTree as ET
    z = zipfile.ZipFile(io.BytesIO(b))
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])))
    sheet = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))[0]
    out = []
    for row in ET.fromstring(z.read(sheet)).iter('{%s}row' % ns['m']):
        cells = {}
        for c in row.findall('m:c', ns):
            ref, t = c.get('r'), c.get('t')
            col = 0
            for ch in re.match(r'[A-Z]+', ref).group(0):
                col = col * 26 + ord(ch) - 64
            v = c.find('m:v', ns)
            if t == 's' and v is not None:
                val = ss[int(v.text)]
            elif t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter('{%s}t' % ns['m']))
            elif v is not None:
                try:
                    val = float(v.text)
                except ValueError:
                    val = v.text
            else:
                val = None
            cells[col - 1] = val
        if cells:
            out.append([cells.get(i) for i in range(max(cells) + 1)])
    return out
