#!/usr/bin/env python3
"""
[RATES] 전세계 기준금리 — 국가별 정책금리 전체 역사 · 금리 결정 기록 · 다가오는 발표 일정 (GitHub Actions 하루 4번 · 표준 라이브러리만)

만드는 파일
  data/rates.json : 화면이 쓰는 전부 (국가별 금리 변화점 · 결정 기록 · 다음 발표 일정 · 출처)

자료 (모두 공식 기관 · 받지 못한 부분은 직전 data/rates.json 값을 그대로 둠)
  · 금리 역사(전 국가) ...... BIS 중앙은행 정책금리 통계 WS_CBPOL (일별 · 1946년~ · 나라마다 정책금리 정의가 바뀐 시점은 BIS 설명 그대로)
  · 대만 .................... 대만 중앙은행(CBC) 공개자료 EG28D01.csv (재할인율 변경 전체 · 1989~) — BIS 에 대만이 없음
  · 최신값 보강(BIS 는 며칠 늦음) — 결정 당일·다음 날 바로 반영되게
      미국  뉴욕연은 EFFR API 의 목표 범위(targetRateFrom/To) · 유로존 ECB 데이터 API 예금금리(DFR) · 영국 BoE 통계 Bank Rate(IUDBEDR)
      한국  한국은행 '한국은행 기준금리 추이'(변경 전체 · 1999~) · 중국 chinamoney LPR(1년) 공시
  · 결정 회의 일정(지난 회의 = 동결 포함 · 앞으로 회의)
      미국  연준 FOMC 일정(fomccalendars · 1994~ fomchistorical 연도별) · 유로존 ECB 통화정책 결정(1999~) · 회의 달력
      일본  BOJ 정책위원회 일정(현재 · 의사록 연도별 목록) · 한국  한국은행 통화정책방향 결정회의 연도별 일정(1999~ · 다음 해 일정 포함)
      중국  LPR 공시(매달 20일 · 휴일이면 다음 영업일 · 2019.8~ 공시일 그대로)
      그 밖 cbrates.com '중앙은행 회의 일정' 모음(각 중앙은행 발표 모음 — 영국·스위스·스웨덴·노르웨이·폴란드·캐나다·호주 등 앞으로 회의)
      대만  분기 마지막 달(3·6·9·12월) 이사회 — 공식 날짜 자료가 없어 '달'만 (추정 표시)

규칙
  · 변화점만 저장(값이 바뀐 날) — 시장금리 구간(한 해에 40번 넘게 바뀜: 예 미국 1985년 전 실효금리)은 달 평균으로 줄이고 결정 기록에서 뺌
  · 미국은 2008.12.16 부터 목표 '범위' → 그래프·현재값은 상단(언론 표기), 범위(하단~상단)도 함께
  · 결정 기록: 회의 일정이 있는 나라(미국·유로존·일본·한국·중국)는 회의마다 인상·인하·동결 + 회의 밖 변경 = '임시' · 그 밖은 금리가 바뀐 날만
  · 지난 회의 목록(무거움)은 처음 한 번 받아 data/rates.json 에 두고, 뒤로는 올해·내년만 다시 받음
"""
import csv, datetime, html, io, json, os, re, ssl, sys, time, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

KST = ZoneInfo('Asia/Seoul')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
OUT = os.path.join(ROOT, 'rates.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
NOW = datetime.datetime.now(KST)
TODAY = NOW.date()
LOG = []
MKT_YEAR = 40          # 한 해에 이보다 많이 바뀌면 시장금리 구간으로 봄(달 평균 · 결정 기록에서 뺌)
MT_VER = 2             # 지난 회의 목록을 읽는 방식이 바뀌면 올림 → 다음 실행에서 전부 다시 받음 (2: FOMC 'Jan/Feb 31-1' 두 달 회의)
CORE = ('US', 'KR', 'JP', 'CN', 'TW', 'XM', 'GB')
LAG = {'US': 1, 'XM': 7, 'XMR': 7, 'JP': 1}   # 결정 뒤 자료에 새 금리가 들어올 때까지(날) — 그 전에는 '결과 대기'(동결로 쓰지 않음)
US_RANGE_FROM = '2008-12-16'
REAL_ON_BREAK = {'GB': {'2006-08-03'}}   # 정의 바뀐 날이지만 실제 결정(영란은행 2006.8.3 4.5→4.75 인상)


def log(*a):
    s = ' '.join(str(x) for x in a); LOG.append(s); print(s, flush=True)


# 인증서 검증은 그대로 하되, 파이썬 3.13 의 '엄격 X.509' 검사만 끔 — 대만 중앙은행 인증서가 Subject Key Identifier 를 빠뜨려 거부됨(브라우저·curl 은 통과)
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)


def fetch(url, data=None, headers=None, tries=3, timeout=60):
    h = {'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'}
    h.update(headers or {})
    err = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            err = e
            if e.code in (400, 401, 403, 404): break
        except Exception as e:
            err = e
        time.sleep(2 * (i + 1))
    raise err


def text(b, enc='utf-8'):
    return b.decode(enc, errors='ignore')


def strip(s):
    s = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', s, flags=re.S)
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def D(s):
    return datetime.date.fromisoformat(s)


def iso(d):
    return d.isoformat()


# ── 나라 정보 (BIS 코드) — ko: 이름 · bank: 중앙은행 · rg: 지역 · main: 화면 기본 강조 · eu: 유로 가입으로 끝난 나라 ──
C = {
    'US': ('미국', '연준(Fed)', 'am', 1), 'KR': ('한국', '한국은행', 'as', 1), 'JP': ('일본', '일본은행(BOJ)', 'as', 1),
    'CN': ('중국', '중국인민은행(LPR)', 'as', 1), 'TW': ('대만', '대만 중앙은행', 'as', 1), 'XM': ('유로존', '유럽중앙은행(ECB)', 'eu', 1),
    'XMR': ('유로존 MRO', 'ECB 기준금리(MRO)', 'eu', 0),
    'GB': ('영국', '영란은행(BoE)', 'eu', 1), 'CH': ('스위스', '스위스 중앙은행(SNB)', 'eu', 1), 'SE': ('스웨덴', '스웨덴 중앙은행', 'eu', 1),
    'NO': ('노르웨이', '노르웨이 중앙은행', 'eu', 1), 'DK': ('덴마크', '덴마크 중앙은행', 'eu', 1), 'PL': ('폴란드', '폴란드 중앙은행', 'eu', 1),
    'CZ': ('체코', '체코 중앙은행', 'eu', 1), 'HU': ('헝가리', '헝가리 중앙은행', 'eu', 1), 'IS': ('아이슬란드', '아이슬란드 중앙은행', 'eu', 0),
    'RO': ('루마니아', '루마니아 중앙은행', 'eu', 0), 'RS': ('세르비아', '세르비아 중앙은행', 'eu', 0), 'MK': ('북마케도니아', '북마케도니아 중앙은행', 'eu', 0),
    'RU': ('러시아', '러시아 중앙은행', 'eu', 0), 'TR': ('튀르키예', '튀르키예 중앙은행', 'eu', 0),
    'DE': ('독일', '독일 연방은행', 'eu', 0), 'FR': ('프랑스', '프랑스 중앙은행', 'eu', 0), 'IT': ('이탈리아', '이탈리아 중앙은행', 'eu', 0),
    'ES': ('스페인', '스페인 중앙은행', 'eu', 0), 'NL': ('네덜란드', '네덜란드 중앙은행', 'eu', 0), 'BE': ('벨기에', '벨기에 중앙은행', 'eu', 0),
    'AT': ('오스트리아', '오스트리아 중앙은행', 'eu', 0), 'PT': ('포르투갈', '포르투갈 중앙은행', 'eu', 0), 'GR': ('그리스', '그리스 중앙은행', 'eu', 0),
    'HR': ('크로아티아', '크로아티아 중앙은행', 'eu', 0),
    'CA': ('캐나다', '캐나다 중앙은행', 'am', 0), 'MX': ('멕시코', '멕시코 중앙은행', 'am', 0), 'BR': ('브라질', '브라질 중앙은행', 'am', 0),
    'AR': ('아르헨티나', '아르헨티나 중앙은행', 'am', 0), 'CL': ('칠레', '칠레 중앙은행', 'am', 0), 'CO': ('콜롬비아', '콜롬비아 중앙은행', 'am', 0),
    'PE': ('페루', '페루 중앙은행', 'am', 0),
    'HK': ('홍콩', '홍콩 금융관리국', 'as', 0), 'IN': ('인도', '인도 중앙은행', 'as', 0), 'ID': ('인도네시아', '인도네시아 중앙은행', 'as', 0),
    'MY': ('말레이시아', '말레이시아 중앙은행', 'as', 0), 'TH': ('태국', '태국 중앙은행', 'as', 0), 'PH': ('필리핀', '필리핀 중앙은행', 'as', 0),
    'AU': ('호주', '호주 중앙은행(RBA)', 'oc', 0), 'NZ': ('뉴질랜드', '뉴질랜드 중앙은행', 'oc', 0),
    'IL': ('이스라엘', '이스라엘 중앙은행', 'me', 0), 'SA': ('사우디아라비아', '사우디 중앙은행', 'me', 0), 'KW': ('쿠웨이트', '쿠웨이트 중앙은행', 'me', 0),
    'ZA': ('남아프리카공화국', '남아공 중앙은행', 'me', 0), 'MA': ('모로코', '모로코 중앙은행', 'me', 0),
}
# 정책금리 정의 (BIS 설명을 우리말로 줄임 — 화면 '이 금리는' 칸)
NOTE = {
    'US': '1985.12.19부터 연준 목표금리(2008.12.16부터는 목표 범위 — 그래프·현재값은 범위 상단) · 그 전은 연방기금 실효금리(시장금리 · 달 평균)',
    'KR': '2008.3.7부터 한국은행 기준금리 · 1999.5.6~2008.3.6 콜금리 목표',
    'JP': '일본은행 정책금리(무담보 콜금리 유도 목표 등 — 시기마다 기준이 다름 · BIS 기준)',
    'CN': '2019.8.20부터 대출우대금리(LPR) 1년 · 그 전은 1년 대출 기준금리',
    'TW': '대만 중앙은행 재할인율(1989~ · 대만 중앙은행 공개자료)',
    'XM': 'ECB 예금금리(DFR) — 2024.9.18부터 ECB 가 정책 방향을 알리는 금리(그 전에는 기준금리 MRO 가 대표 · \'유로존 MRO\' 로 따로 볼 수 있음)',
    'XMR': 'ECB 기준금리(MRO · 주요 재융자 금리) — 1999~2000.6·2008.10.15~ 고정금리 · 2000.6~2008.10 변동금리 입찰 최저금리',
    'GB': '2006.8.3부터 Bank Rate · 그 전 레포금리 등',
    'CH': '2019.6.13부터 SNB 정책금리 · 2000~2019 목표 범위 가운데 · 그 전 재할인율',
    'SE': '1994.6부터 레포금리(정책금리)', 'NO': '1993.6.11부터 예금금리(정책금리)', 'DK': '1992.4부터 예금증서 금리',
}
REGION = {'as': '아시아', 'eu': '유럽', 'am': '미주', 'oc': '오세아니아', 'me': '중동·아프리카'}


# ── 1. BIS 정책금리 (전 국가 · 일별) ──
def bis():
    url = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.?format=csv&detail=dataonly'
    raw = text(fetch(url, timeout=180))
    out = {}
    for r in csv.DictReader(io.StringIO(raw)):
        v = r.get('OBS_VALUE', '')
        try:
            x = float(v)
        except ValueError:
            continue
        if x != x:      # NaN
            continue
        out.setdefault(r['REF_AREA'], []).append((r['TIME_PERIOD'], x))
    for k in out:
        out[k].sort()
    log('BIS', len(out), '나라 ·', sum(len(v) for v in out.values()), '관측')
    return out


def bis_meta():
    url = 'https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.?format=csv&lastNObservations=1'
    m = {}
    for r in csv.DictReader(io.StringIO(text(fetch(url, timeout=120)))):
        m[r['REF_AREA']] = r.get('COMPILATION', '').strip()
    return m


# ── 2. 대만 (CBC 재할인율 변경 목록) ──
def taiwan():
    b = fetch('https://www.cbc.gov.tw/public/data/OpenData/' + urllib.parse.quote('經研處') + '/EG28D01.csv')
    rows = list(csv.reader(io.StringIO(b.decode('utf-8-sig'))))
    pts = []
    for r in rows[1:]:
        if len(r) >= 2 and re.fullmatch(r'\d{8}', r[0]):
            pts.append((r[0][:4] + '-' + r[0][4:6] + '-' + r[0][6:], float(r[1])))
    pts.sort()
    if len(pts) < 50:
        raise ValueError('대만 자료 %d줄' % len(pts))
    log('대만 CBC', len(pts), '변경 ·', pts[-1])
    return pts


# ── 3. 최신값 보강 ──
def us_latest():
    """뉴욕연은 EFFR — 날마다 목표 범위 (from, to)"""
    j = json.loads(fetch('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/40.json'))
    out = []
    for r in j.get('refRates', []):
        if r.get('targetRateFrom') is not None and r.get('targetRateTo') is not None:
            out.append((r['effectiveDate'], float(r['targetRateFrom']), float(r['targetRateTo'])))
    out.sort()
    return out


def _frac(t):
    """'3-3/4' → 3.75 · '4' → 4 · '1/4' → 0.25"""
    m = re.fullmatch(r'(\d+)(?:-(\d)/(\d))?|(\d)/(\d)', t.strip())
    if not m:
        raise ValueError(t)
    if m.group(4):
        return int(m.group(4)) / int(m.group(5))
    return int(m.group(1)) + (int(m.group(2)) / int(m.group(3)) if m.group(2) else 0)


def fomc_statement(d):
    """FOMC 결정 당일 성명서 → (하단, 상단) — 뉴욕연은 자료는 다음 영업일 아침에야 새 범위가 나와서 당일 반영용"""
    s = text(fetch('https://www.federalreserve.gov/newsevents/pressreleases/monetary%sa.htm' % d.replace('-', ''), tries=1))
    s = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s)))
    m = re.search(r'(?:raise|lower|maintain)[^.]{0,40}?target range for the federal funds rate[^.]{0,40}? (?:to|at) ([\d/-]+) to ([\d/-]+) percent', s)
    if not m:
        raise ValueError('성명서에서 목표 범위를 찾지 못함')
    return _frac(m.group(1)), _frac(m.group(2))


def ecb_series(key):
    """ECB 데이터 API 일별 전체 (1999~) — DFR 예금금리 · MRR_FR 기준금리(MRO 고정) · MRR_MBR(MRO 입찰 최저 — 2000.6~2008.10)"""
    raw = text(fetch('https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.%s.LEV?format=csvdata' % key, timeout=120))
    out = []
    for r in csv.DictReader(io.StringIO(raw)):
        try:
            out.append((r['TIME_PERIOD'], float(r['OBS_VALUE'])))
        except (KeyError, ValueError):
            pass
    return sorted(out)


def boe_rate():
    d0 = (TODAY - datetime.timedelta(days=60)).strftime('%d/%b/%Y')
    raw = text(fetch('https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=' + d0 +
                     '&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TN&UsingCodes=Y'))
    out = []
    for r in csv.reader(io.StringIO(raw)):
        if len(r) == 2 and re.match(r'\d{2} \w{3} \d{4}', r[0]):
            try:
                out.append((datetime.datetime.strptime(r[0], '%d %b %Y').date().isoformat(), float(r[1])))
            except ValueError:
                pass
    return sorted(out)


def bok_changes():
    """한국은행 기준금리 추이 — 변경일·금리 전체 (1999~)"""
    t = text(fetch('https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643'))
    out = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        c = [strip(x) for x in re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)]
        if len(c) >= 3 and re.fullmatch(r'\d{4}', c[0]):
            m = re.match(r'(\d{1,2})월\s*(\d{1,2})일', c[1])
            if m:
                out.append(('%s-%02d-%02d' % (c[0], int(m.group(1)), int(m.group(2))), float(c[2])))
    out.sort()
    if len(out) < 40:
        raise ValueError('한국은행 기준금리 추이 %d줄' % len(out))
    return out


def lpr_history(prev):
    """chinamoney LPR 공시 (1년·5년) — 한 번에 1년치만 줌 → 2019.8 부터 해마다 (이미 받은 해는 건너뜀 · 올해만 다시)"""
    have = {r[0]: r for r in (prev or [])}
    y0 = 2019
    out = dict(have)
    for y in range(y0, TODAY.year + 1):
        s, e = datetime.date(y, 1, 1), datetime.date(y, 12, 31)
        if y == 2019:
            s = datetime.date(2019, 8, 20)
        if e > TODAY:
            e = TODAY
        if y < TODAY.year - 1 and any(k.startswith(str(y)) for k in have):
            continue
        body = urllib.parse.urlencode({'lang': 'CN', 'strStartDate': s.isoformat(), 'strEndDate': e.isoformat()}).encode()
        j = json.loads(fetch('https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis', data=body,
                             headers={'Referer': 'https://www.chinamoney.com.cn/chinese/bklpr/', 'Content-Type': 'application/x-www-form-urlencoded'}))
        for r in j.get('records', []):
            d = r.get('showDateCN', '')[:10]
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
                out[d] = [d, float(r['1Y']), float(r['5Y'])]
        time.sleep(0.5)
    rows = sorted(out.values())
    if len(rows) < 12:
        raise ValueError('LPR %d개' % len(rows))
    return rows


# ── 4. 회의 일정 ──
MON = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])}
MON3 = {k[:3]: v for k, v in MON.items()}


def fomc_calendar():
    """현재 일정 페이지(최근 5~6년 + 내년) → [(날짜(마지막 날), 예정 여부)] · notation vote 는 뺌"""
    s = text(fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'))
    out = []
    for m in re.finditer(r'<h4><a id="\d+">(\d{4}) FOMC Meetings</a></h4>(.*?)(?=<h4><a id=|panel-footer)', s, re.S):
        y = int(m.group(1))
        for mo, dd in re.findall(r'fomc-meeting__month[^>]*>\s*<strong>(.*?)</strong>.*?fomc-meeting__date[^>]*>(.*?)</div>', m.group(2), re.S):
            mo, dd = strip(mo), strip(dd)
            if 'notation' in dd.lower() or 'cancel' in dd.lower():
                continue
            mons = [MON.get(x.strip()) or MON3.get(x.strip()[:3]) for x in mo.split('/')]
            days = re.findall(r'\d+', dd)
            if not days or not mons[-1]:
                continue
            out.append(datetime.date(y, mons[-1], int(days[-1])).isoformat())   # 'Apr/May 30-1' → 5월 1일 (마지막 날 = 결정 발표)
    return sorted(set(out))


def fomc_history(y):
    s = text(fetch('https://www.federalreserve.gov/monetarypolicy/fomchistorical%d.htm' % y))
    out = []
    for h in re.findall(r'<h5[^>]*>(.*?)</h5>', s, re.S):
        h = strip(h)
        # 'January 27-28 Meeting - 2015' · 'Jan/Feb 31-1 Meeting - 2017' · 'January 31-February 1 Meeting - 2006' · 'March 2 (unscheduled) Meeting - 2020'
        m = re.match(r'([A-Z][a-z]+)(?:/([A-Z][a-z]+))? (\d+)(?:-(?:([A-Z][a-z]+) )?(\d+))? (?:\((unscheduled)\) )?Meeting - (\d{4})', h)
        if not m or 'cancel' in h.lower():
            continue
        name = m.group(4) or m.group(2) or m.group(1)      # 회의 마지막 날의 달
        mo = MON.get(name) or MON3.get(name[:3])
        if mo:
            out.append(datetime.date(int(m.group(7)), mo, int(m.group(5) or m.group(3))).isoformat())
    return out


ECB_LINK = {}   # 결정일 → 보도자료 주소 (최근 결정의 금리를 바로 읽을 때)


def ecb_decisions(y):
    s = text(fetch('https://www.ecb.europa.eu/press/govcdec/mopo/%d/html/index_include.en.html' % y))
    out = []
    for d, h, t in re.findall(r'<div class="date">(.*?)</div>.*?<div class="title">\s*<a href="([^"]+)"[^>]*>(.*?)</a>', s, re.S):
        if strip(t).lower().startswith('monetary policy decision'):
            try:
                dd = datetime.datetime.strptime(strip(d), '%d %B %Y').date().isoformat()
            except ValueError:
                continue
            out.append(dd)
            ECB_LINK[dd] = urllib.parse.urljoin('https://www.ecb.europa.eu/press/govcdec/mopo/%d/html/' % y, h)
    return sorted(set(out))


def ecb_decision_rates(url):
    """ECB 결정 보도자료 → (예금금리, MRO) — 새 금리는 다음 주에야 적용·자료에 들어오므로 결정 당일 결과를 바로 읽음
       문장 순서가 보도자료마다 달라서(예금·MRO·한계 / MRO·한계·예금) 문장 안에서 금리 이름이 나온 순서대로 값을 맞춤
       · 2024.9 처럼 예금금리와 MRO 를 따로 쓴 경우: 'deposit facility … to 3.50%' + 'main refinancing … 3.65%' 를 각각 읽음"""
    s = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', text(fetch(url, tries=2)))))
    NAMES = (('d', 'deposit facility'), ('m', 'main refinancing'), ('l', 'marginal lending'))
    got = {}
    for sent in re.split(r'(?<=[a-z0-9%)])\. (?=[A-Z])', s):     # '… will remain unchanged at 2.00%, 2.15% and 2.40% respectively' 같은 문장만
        vals = re.findall(r'(-?\d+(?:\.\d+)?)\s?%', sent)
        if not vals or ' will ' not in sent:
            continue
        pos = sorted((sent.find(n), k) for k, n in NAMES if sent.find(n) >= 0)
        if not pos:
            continue
        if len(vals) == 3 and len(pos) == 3:
            for (_, k), v in zip(pos, vals):
                got.setdefault(k, float(v))
        elif len(pos) == 1 and len(vals) == 1:
            got.setdefault(pos[0][1], float(vals[0]))
        elif len(pos) == 2 and len(vals) == 2:
            for (_, k), v in zip(pos, vals):
                got.setdefault(k, float(v))
        if 'd' in got and 'm' in got:
            return got['d'], got['m']
    raise ValueError('보도자료에서 금리를 찾지 못함')


def ecb_calendar():
    t = strip(text(fetch('https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html')))
    out = []
    rows = [(datetime.datetime.strptime(d, '%d/%m/%Y').date(), rest) for d, rest in
            re.findall(r'(\d{2}/\d{2}/\d{4})\s+Governing Council of the ECB: (monetary policy meeting[^)/]{0,80}\)?)', t)]
    day2 = {d for d, r in rows if 'Day 2' in r}
    for d, r in rows:   # 이틀 회의 = 둘째 날(결정 발표) · '(Day …)' 표기 없는 날은 다음 날이 Day 2 가 아니면 하루 회의
        if 'Day 2' in r or ('Day' not in r and d + datetime.timedelta(days=1) not in day2):
            out.append(d.isoformat())
    return sorted(set(out))


def boj_schedule():
    s = text(fetch('https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm')).replace('&nbsp;', ' ')
    out = []
    for cap, body in re.findall(r'<caption[^>]*>(.*?)</caption>(.*?)</table>', s, re.S):
        ym = re.search(r'(\d{4})', strip(cap))
        if not ym:
            continue
        y = int(ym.group(1))
        for r in re.findall(r'<tr[^>]*>(.*?)</tr>', body, re.S):
            c = re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)
            if not c:
                continue
            first = strip(c[0])
            ds = re.findall(r'([A-Z][a-z]+)\.? (\d+) \([A-Za-z.]+\)(?:, (\d+) \([A-Za-z.]+\))?', first)
            if not ds:
                continue
            mo_name, d1, d2 = ds[-1]
            mo = MON3.get(mo_name[:3])
            if not mo:
                continue
            out.append(datetime.date(y, mo, int(d2 or d1)).isoformat())
    return sorted(set(out))


def boj_history(y):
    s = text(fetch('https://www.boj.or.jp/en/mopo/mpmsche_minu/minu_%d/index.htm' % y))
    out = []
    for yy, mm, dd in re.findall(r'minu_\d{4}/g(\d{2})(\d{2})(\d{2})\.(?:htm|pdf)', s):
        out.append('%d-%s-%s' % (2000 + int(yy) if int(yy) < 90 else 1900 + int(yy), mm, dd))
    return sorted(set(out))


def bok_meetings(y):
    t = text(fetch('https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755&pYear=%d' % y))
    out = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        c = re.findall(r'<th[^>]*scope="row"[^>]*>(.*?)</th>', r, re.S)   # 회의일자 = 줄 머리(th)
        if c:
            m = re.match(r'(\d{1,2})월\s*(\d{1,2})일', strip(c[0]))
            if m:
                out.append('%d-%02d-%02d' % (y, int(m.group(1)), int(m.group(2))))
    return sorted(set(out))


CB_NAME = {   # cbrates.com 이름 → BIS 코드
    'USA': 'US', 'Eurozone': 'XM', 'Japan': 'JP', 'South Korea': 'KR', 'United Kingdom': 'GB', 'Switzerland': 'CH', 'Sweden': 'SE',
    'Norway': 'NO', 'Denmark': 'DK', 'Poland': 'PL', 'Czech Republic': 'CZ', 'Czechia': 'CZ', 'Hungary': 'HU', 'Iceland': 'IS', 'Romania': 'RO',
    'Serbia': 'RS', 'Russia': 'RU', 'Türkiye': 'TR', 'Turkey': 'TR', 'Canada': 'CA', 'Mexico': 'MX', 'Brazil': 'BR', 'Chile': 'CL',
    'Colombia': 'CO', 'Peru': 'PE', 'India': 'IN', 'Indonesia': 'ID', 'Malaysia': 'MY', 'Thailand': 'TH', 'Philippines': 'PH',
    'Australia': 'AU', 'New Zealand': 'NZ', 'Israel': 'IL', 'South Africa': 'ZA', 'Hong Kong': 'HK', 'China': 'CN', 'Taiwan': 'TW',
    'Saudi Arabia': 'SA', 'Kuwait': 'KW', 'Morocco': 'MA', 'Argentina': 'AR', 'North Macedonia': 'MK',
}


def cbrates_meetings():
    t = strip(text(fetch('https://www.cbrates.com/meetings.htm'), 'latin-1'))
    out, y, lastm = [], TODAY.year, 0
    for tok in re.finditer(r'\b(20\d{2})\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\s+([A-Za-zü\s]+?):', t):
        if tok.group(1):
            yy = int(tok.group(1))
            if TODAY.year <= yy <= TODAY.year + 2:
                y, lastm = yy, 0
            continue
        mo, dd, name = MON3[tok.group(2)], int(tok.group(3)), tok.group(4).strip()
        if mo < lastm:
            y += 1
        lastm = mo
        code = CB_NAME.get(name)
        if code:
            try:
                out.append((code, datetime.date(y, mo, dd).isoformat()))
            except ValueError:
                pass
    return sorted(set(out))


# ── 5. 시계열 → 변화점 ──
def to_steps(daily):
    """[(날짜, 값)] 일별 → 변화점 [[날짜, 값]] · 시장금리 해(한 해 변화 > MKT_YEAR)는 달 평균 · 그 해 목록 반환"""
    by_y = {}
    prev = None
    for d, v in daily:
        if prev is None or v != prev:
            by_y[d[:4]] = by_y.get(d[:4], 0) + 1
        prev = v
    mkt = {y for y, n in by_y.items() if n > MKT_YEAR}
    out, prev = [], None
    mon = {}
    for d, v in daily:
        if d[:4] in mkt:
            mon.setdefault(d[:7], []).append(v)
            continue
        if mon:
            for k in sorted(mon):
                a = round(sum(mon[k]) / len(mon[k]), 3)
                if prev is None or a != prev:
                    out.append([k + '-01', a]); prev = a
            mon = {}
        if prev is None or v != prev:
            out.append([d, v]); prev = v
    for k in sorted(mon):
        a = round(sum(mon[k]) / len(mon[k]), 3)
        if prev is None or a != prev:
            out.append([k + '-01', a]); prev = a
    return out, sorted(mkt)


def merge_tail(daily, extra):
    """BIS 일별 끝 뒤에 다른 공식 자료의 (날짜, 값) 을 이어 붙임 (같은 날 이후만)"""
    if not extra:
        return daily
    last = daily[-1][0] if daily else ''
    return daily + [(d, v) for d, v in extra if d > last]


def val_at(steps, d):
    """변화점 목록에서 날짜 d 의 값"""
    v = None
    for s, x in steps:
        if s > d:
            break
        v = x
    return v


# ── 6. 결정 기록 ──
MON_ANY = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}


def breaks_of(note):
    """BIS 설명의 'From 2 Aug 1990 …' 같은 정의 바뀐 날짜들 (그날 바뀐 값은 결정이 아니라 '기준 변경')"""
    out = set()
    for d, m, y in re.findall(r'[Ff]rom (\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})', note or ''):
        mo = MON_ANY.get(m[:3].lower())
        if mo:
            try:
                out.add(datetime.date(int(y), mo, int(d)).isoformat())
            except ValueError:
                pass
    return out


def decisions(steps, mkt_years, meetings, start_policy=None, brk=(), last=None, lag=0, pend_today=False, known=None, real=()):
    """회의 목록이 있으면: 회의마다 [날짜, 결정 뒤 값, 결정 전 값, 'm'] + 회의 밖 변경 [.., 'x']
       없으면: 변화점마다 [날짜, 값, 이전 값, 'c']
       · 정의가 바뀐 날(±1일)의 변화 = 'b'(기준 변경 · 결정 아님) — real 에 적은 날만 그날 실제 결정으로 봄
         (공식 발표로 확인한 것만: 영국 2006.8.3 Bank Rate 로 이름이 바뀐 날 실제 0.25%p 인상 · 터키 2010.5.20 6.5→7.0 은 금리 종류 변경이라 기준 변경)
       · 회의는 했지만 자료가 아직 그 뒤(회의일 + lag)까지 없으면 'p'(결과 대기 — 동결로 쓰지 않음) · pend_today: 오늘 회의는 아직 발표 전으로 봄"""
    def near_brk(d):
        dd = D(d)
        return any(abs((dd - D(b)).days) <= 1 for b in brk)
    chg, ev, bdays = [], [], []
    for i in range(1, len(steps)):
        d, v, p = steps[i][0], steps[i][1], steps[i - 1][1]
        if d[:4] in mkt_years or steps[i - 1][0][:4] in mkt_years or (start_policy and d <= start_policy):
            continue
        if near_brk(d) and d not in real:
            ev.append([d, v, p, 'b']); bdays.append(D(d)); continue
        chg.append((d, v, p))
    if not meetings:
        return sorted(ev + [[d, v, p, 'c'] for d, v, p in chg])
    ms = sorted(set(m for m in meetings if m <= iso(TODAY) and (not start_policy or m > start_policy) and m >= steps[0][0]
                    and not any(abs((D(m) - b).days) <= 1 for b in bdays)))   # 기준 변경일의 회의는 따로 '동결'로 쓰지 않음
    # 변경마다 '가장 가까운 앞 회의'(회의 하루 전 ~ 8일 뒤 적용 — ECB 는 다음 주 수요일 적용이던 때가 있음)에 붙임
    # · 그 회의에 이미 다른 변경이 붙었으면 회의 밖 변경(임시) — 예: 2008.10.8 ECB 긴급 인하 다음 날 금리 통로 조정
    hit = {}
    for i, (d, v, p) in enumerate(chg):
        dd = D(d)
        cand = [m for m in ms if D(m) - datetime.timedelta(days=1) <= dd <= D(m) + datetime.timedelta(days=8)]
        if cand and cand[-1] not in hit:
            hit[cand[-1]] = i
    used = set(hit.values())
    for m in ms:
        if m in hit:
            d, v, p = chg[hit[m]]
            ev.append([m, v, p, 'm'])
        else:
            v = val_at(steps, m)
            if v is None:
                continue
            if known and m in known:                # 결정 보도자료로 읽은 결과(적용 전) — 자료에 들어오면 위에서 변경과 짝지어짐
                ev.append([m, known[m], v, 'm']); continue
            waiting = (last is not None and iso(D(m) + datetime.timedelta(days=lag)) > last) or (pend_today and m == iso(TODAY))
            ev.append([m, v, v, 'p' if waiting else 'm'])
    for i, (d, v, p) in enumerate(chg):
        if i not in used:
            ev.append([d, v, p, 'x' if ms and d >= ms[0] else 'c'])
    ev.sort()
    return ev


def lpr_next(after):
    """다음 LPR 공시일 (after 다음 날 이후 첫 20일 · 주말이면 월요일)"""
    y, m = after.year, after.month
    for _ in range(3):
        d = datetime.date(y, m, 20)
        while d.weekday() >= 5:
            d += datetime.timedelta(days=1)
        if d > after:
            return d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return None


def main():
    prev = {}
    try:
        prev = json.load(open(OUT, encoding='utf-8'))
    except Exception:
        pass
    pc = {c['c']: c for c in prev.get('countries', [])}
    errs = []

    def tryf(name, f, *a):
        try:
            return f(*a)
        except Exception as e:
            errs.append('%s: %s' % (name, str(e)[:160])); log('실패', name, str(e)[:160]); return None

    B = tryf('BIS', bis)
    meta = tryf('BIS 설명', bis_meta) or {}
    if not B or len(B) < 40:
        if not prev.get('countries'):
            sys.exit('BIS 자료 없음')
        log('BIS 를 받지 못해 BIS 나라는 직전 자료 유지'); B = None
    tw = tryf('대만', taiwan)
    us = tryf('미국 최신', us_latest)
    dfr = tryf('ECB 예금금리', ecb_series, 'DFR')
    mfr = tryf('ECB MRO 고정', ecb_series, 'MRR_FR')
    mbr = tryf('ECB MRO 입찰', ecb_series, 'MRR_MBR')
    mro = sorted(dict((mfr or []) + (mbr or [])).items()) if mfr and mbr else None
    gb = tryf('영국 최신', boe_rate)
    kr = tryf('한국 기준금리 추이', bok_changes)
    lpr = tryf('LPR', lpr_history, prev.get('lpr'))
    if lpr is None:
        lpr = prev.get('lpr') or []

    # ── 회의 목록 (지난 것은 data/rates.json 에 둔 것 · 올해·내년만 다시) ──
    # 지난 회의 목록: 받은 해는 mty 에 적어 두고 다시 받지 않음(실패한 해는 다음 실행에 다시) · 올해·내년은 늘 다시
    # · 이미 지난 회의는 지우지 않음(새 목록은 '더하기'만) — 앞으로의 회의만 새 일정으로 바꿈(날짜가 옮겨진 회의 반영)
    # · MT_VER 가 바뀌면(읽는 방식 고침) 전부 다시 받음
    fresh = prev.get('mtv') != MT_VER
    mt = {} if fresh else {k: list(v) for k, v in prev.get('mt', {}).items()}
    mty = {} if fresh else {k: set(v) for k, v in prev.get('mty', {}).items()}
    y, t0 = TODAY.year, iso(TODAY)

    def hist(bank, years, f, label):
        got = set(mt.get(bank, []))
        ok = mty.setdefault(bank, set())
        for yy in years:
            if yy in ok and yy < y - 1:
                continue
            r = tryf('%s %d' % (label, yy), f, yy)
            if r is not None and (r or yy < y):
                got |= {d for d in r if d <= t0} if yy >= y - 1 else set(r)
                if r: ok.add(yy)
            time.sleep(0.3)
        return got

    def upcoming(got, r):
        return {d for d in got if d <= t0} | set(r) if r else got
    mt['US'] = sorted(upcoming(hist('US', range(1994, 2021), fomc_history, 'FOMC'), tryf('FOMC 일정', fomc_calendar)))
    mt['XM'] = sorted(upcoming(hist('XM', range(1999, y + 1), ecb_decisions, 'ECB'), tryf('ECB 달력', ecb_calendar)))
    mt['JP'] = sorted(upcoming(hist('JP', range(1998, y), boj_history, 'BOJ'), tryf('BOJ 일정', boj_schedule)))
    kr_got = set(mt.get('KR', []))
    kr_ok = mty.setdefault('KR', set())
    for yy in range(1999, y + 2):                 # 한국은행 연도별 일정(다음 해 일정 포함) — 그 해 목록 전체를 그대로 씀
        if yy in kr_ok and yy < y - 1:
            continue
        r = tryf('한국은행 %d' % yy, bok_meetings, yy)
        if r:
            kr_got = {d for d in kr_got if not d.startswith(str(yy)) or d <= t0} | set(r)
            kr_ok.add(yy)
        time.sleep(0.3)
    mt['KR'] = sorted(kr_got)
    cbm = tryf('cbrates 일정', cbrates_meetings)
    if not cbm:
        cbm = [tuple(x) for x in prev.get('cb', [])]

    # ── 나라별 시계열 ──
    MEET = {'US': 'US', 'XM': 'XM', 'XMR': 'XM', 'JP': 'JP', 'KR': 'KR'}
    LEGACY = ('AT', 'BE', 'DE', 'ES', 'FR', 'GR', 'IT', 'NL', 'PT', 'HR')
    if not meta:
        meta = prev.get('meta') or {}            # BIS 설명을 못 받으면 직전 것 (없으면 '기준 변경'이 진짜 인상·인하로 보일 수 있음)
    ecb_known = {}                               # 최근 ECB 결정(10일 안): 보도자료의 새 예금금리·MRO
    for m in [x for x in mt.get('XM', []) if iso(TODAY - datetime.timedelta(days=10)) <= x <= iso(TODAY)]:
        if m in ECB_LINK:
            r = tryf('ECB 보도자료 %s' % m, ecb_decision_rates, ECB_LINK[m])
            if r: ecb_known[m] = r
    countries = []
    codes = sorted((set((B or {}).keys()) - {'XM'}) | {'TW', 'XM', 'XMR'} | set(pc.keys()), key=lambda k: (0 if C.get(k, ('', '', '', 0))[3] else 1, k))
    for code in codes:
        if code not in C:
            log('이름 없는 나라 건너뜀', code); continue
        ko, bank, rg, main_ = C[code]
        old = pc.get(code)
        oldd = [tuple(x) for x in old['s']] if old else None      # 직전 변화점 (원본을 못 받았을 때 바탕)
        daily, last_d = None, None
        if code == 'TW':
            daily, last_d = (tw, iso(TODAY)) if tw else (oldd, old and old['last'])
        elif code == 'XM':
            daily, last_d = (dfr, None) if dfr else (oldd, old and old['last'])
        elif code == 'XMR':
            daily, last_d = (mro, None) if mro else (oldd, old and old['last'])
        else:
            base = B.get(code) if B else None
            if code == 'US' and base:
                base = [(d, round(v + 0.125, 4) if d >= US_RANGE_FROM else v) for d, v in base]   # BIS = 범위 가운데 → 2008.12.16 부터 상단
            if not base and oldd:
                base, last_d = oldd, old['last']
            daily = base
            if daily and code == 'US':
                if us:
                    daily = merge_tail(daily, [(d, b) for d, a, b in us])      # 뉴욕연은 목표 범위 상단
                for m in [x for x in mt.get('US', []) if iso(TODAY - datetime.timedelta(days=10)) <= x <= iso(TODAY)][-1:]:
                    try:                                                   # 결정 당일: 성명서의 새 범위(상단)를 다음 날부터 (자료가 아직 없을 때만)
                        st = fomc_statement(m)
                    except Exception as e:                                 # 발표 전(미국 오후 2시 전)이면 아직 없음 — 실패로 치지 않음
                        st = None; log('FOMC 성명서 아직 없음', m, str(e)[:80])
                    eff = iso(D(m) + datetime.timedelta(days=1))
                    if st and eff > daily[-1][0] and st[1] != daily[-1][1]:
                        daily = daily + [(eff, st[1])]; log('FOMC 성명서로 미국 반영', m, st)
                    if st and eff > daily[-1][0]:
                        last_d = eff
                # 1985.12 이후 목표금리는 1/16%p 단위 — BIS 원본의 오타 하나(1986.4.2 7.3215 → 7.3125)를 바로잡음
                daily = [(d, round(round(v * 16) / 16, 4) if d >= '1985-12-19' and abs(v * 16 - round(v * 16)) < 0.2 else v) for d, v in daily]
            elif daily and code == 'GB' and gb:
                daily = merge_tail(daily, gb)
            elif daily and code == 'CN' and lpr:   # 2019.8.20(LPR 개편)부터는 공시 원본(공시일·값) — BIS 는 날짜가 하루이틀 다를 때가 있음
                daily = [x for x in daily if x[0] < '2019-08-20'] + [(r[0], r[1]) for r in lpr]
                last_d = max(last_d or '', lpr[-1][0])
            elif daily and code == 'KR' and kr:
                daily = merge_tail(daily, [(d, x) for d, x in kr])
                last_d = iso(TODAY)      # 한국은행 '기준금리 추이'는 오늘까지의 변경 전체 → 오늘까지 유효
        if not daily:
            continue
        if code == 'TW':          # 변경 목록에는 다른 금리(담보·단기 융통)만 바뀐 날도 있음 → 재할인율이 같으면 뺌
            steps, mkt = [], []
            for x in daily:
                if not steps or steps[-1][1] != x[1]:
                    steps.append(list(x))
        else:
            steps, mkt = to_steps(daily)
            if old:
                mkt = sorted(set(mkt) | set(old.get('mkt', [])))     # 시장금리 해는 과거라 바뀌지 않음 (직전 자료로 다시 만들 때 달 평균이 '결정'으로 보이지 않게)
        last_d = max(last_d or '', daily[-1][0])
        if code == 'KR' and kr:        # 한국은행 공식 변경 목록 = 변화점이어야 함 (다르면 실패 기록)
            off = [(d, x) for d, x in kr if val_at(steps, d) != x]
            if off:
                errs.append('한국: BIS 와 한국은행 기준금리 추이가 다름 %s' % off[:4]); log('한국 다름', off[:4])
        ended = code in LEGACY or (code == 'AR' and last_d < iso(TODAY - datetime.timedelta(days=60)))
        cur = steps[-1][1]
        rng = [round(cur - 0.25, 4), cur] if code == 'US' and last_d >= US_RANGE_FROM else None
        note = NOTE.get(code) or meta.get(code, '')
        brk = breaks_of(meta.get(code, '')) if code not in ('XM', 'XMR', 'TW', 'JP') else set()   # 일본: BIS 설명이 정의가 아니라 결정마다의 목표(From …: around 1.25%)라서 뺌
        brk.discard(US_RANGE_FROM)
        meets = mt.get(MEET[code]) if code in MEET else ([r[0] for r in lpr] if code == 'CN' and lpr else None)
        start_policy = {'US': '1985-12-19', 'KR': '1999-05-06'}.get(code)
        hour = NOW.hour + NOW.minute / 60
        pend = (code == 'KR' and hour < 12) or (code == 'JP' and hour < 13.5)   # 오늘 회의 발표 전·공식 목록 반영 전(한국은행 오전 10시경 · 일본은행 정오 무렵)
        known = {m: r[0 if code == 'XM' else 1] for m, r in ecb_known.items()} if code in ('XM', 'XMR') else None
        ev = decisions(steps, set(mkt), meets, start_policy, brk, last_d, LAG.get(code, 0), pend, known, REAL_ON_BREAK.get(code, ()))
        nx = []
        if not ended:
            if code in MEET:
                nx = [{'d': d} for d in mt.get(MEET[code], []) if d >= iso(TODAY)][:12]
            elif code == 'CN':
                d = lpr_next(TODAY - datetime.timedelta(days=1))
                if d:
                    nx = [{'d': d.isoformat(), 'e': '매달 20일 9시 15분(중국) · 주말·휴일이면 다음 영업일 — 중국 공휴일은 반영하지 못함'}]
            elif code == 'TW':     # 분기 마지막 달 셋째 주 무렵 이사회 → 그 달 25일이 지나면 다음 분기
                mo = next((m for m in (3, 6, 9, 12) if m > TODAY.month or (m == TODAY.month and TODAY.day <= 25)), None)
                nx = [{'m': '%d-%02d' % (TODAY.year if mo else TODAY.year + 1, mo or 3), 'e': '분기 마지막 달(3·6·9·12월) 이사회 — 공식 날짜 자료가 없어 달만 표시'}]
            nx += [{'d': d, 's': 'cb'} for cc, d in cbm if cc == code and d >= iso(TODAY) and code not in MEET and code != 'CN']
            nx.sort(key=lambda x: x.get('d') or x.get('m'))
        countries.append({
            'c': code, 'ko': ko, 'bank': bank, 'rg': rg, 'main': main_, 'note': note,
            'from': steps[0][0], 'last': last_d, 'end': ended, 's': steps, 'cur': cur, 'rng': rng, 'mkt': mkt, 'ev': ev, 'nx': nx,
        })
    # ── 검사 (틀리면 저장하지 않음) ──
    by = {c['c']: c for c in countries}
    for k in CORE:
        if k not in by:
            sys.exit('주요국 자료 없음: ' + k)
        age = (TODAY - D(by[k]['last'])).days
        if age > 21:
            errs.append('%s 자료가 %d일 전 것' % (k, age))

    data = {
        'updated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'today': iso(TODAY),
        'src': 'BIS 중앙은행 정책금리 통계(WS_CBPOL) · ECB 데이터 포털 · 대만 중앙은행 공개자료 · 뉴욕연은 · 영란은행 · 한국은행 · chinamoney(LPR) · 각 중앙은행 회의 일정 · cbrates.com 회의 모음',
        'countries': countries, 'mt': mt, 'mtv': MT_VER, 'mty': {k: sorted(v) for k, v in mty.items()}, 'meta': meta, 'lpr': lpr, 'cb': [list(x) for x in cbm], 'errs': errs,
    }
    old = json.dumps({k: v for k, v in prev.items() if k not in ('updated', 'today')}, ensure_ascii=False, sort_keys=True)
    new = json.dumps({k: v for k, v in data.items() if k not in ('updated', 'today')}, ensure_ascii=False, sort_keys=True)
    if old == new and prev.get('today') == data['today']:
        log('변경 없음'); return
    os.makedirs(ROOT, exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    log('저장', OUT, os.path.getsize(OUT) // 1024, 'KB ·', len(countries), '나라 · 실패', len(errs))


if __name__ == '__main__':
    main()
