#!/usr/bin/env python3
"""ETF 차트 비교 — 검색 목록과 원/달러 환율 (매일 GitHub Actions: update-etf-list.yml)

data/etf_list.json
  kr: [[코드, 이름, 분류코드], ...]  국내 상장 ETF 전체 · 네이버 증권 ETF 목록(시가총액 큰 순)
      분류코드 1 국내 시장지수 · 2 국내 업종/테마 · 3 국내 파생 · 4 해외 주식 · 5 원자재 · 6 채권 · 7 기타
  us: [[티커, 이름, 거래소, 한글 별칭], ...]  미국 상장 ETF 전체 · 나스닥 트레이더 상장 종목 목록(nasdaqtraded.txt, ETF=Y, 시험 종목 제외)
      인기 종목(POP_US, 한글 별칭 포함)을 앞에, 나머지는 티커 순 · 티커의 '.' 은 Yahoo 표기('-')로
data/usdkrw.json
  한국은행 ECOS 원/미국달러 매매기준율(731Y001, 일별) — '원화 환산' 비교용 · {d0: 첫 날(1970-01-01 기준 일수), dd: 날짜 간격, c: 환율}

가격(일봉)은 여기서 받지 않음: 화면이 Worker /etf 로 그때그때 받아 30분 보관 (국내 네이버 수정주가 · 미국 Yahoo adjclose)
한 출처가 실패하면 그 부분은 직전 파일 값을 그대로 둠 (빈 목록으로 덮어쓰지 않음)
"""
import csv, datetime, io, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'etf_list.json')
FX_OUT = os.path.join(ROOT, 'data', 'usdkrw.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
ECOS_KEY = 'RVTLLDCO3IW1YUKQSSPJ'   # update_market_data.py 와 같은 공개 인증키

# 자주 찾는 미국 ETF — 검색 결과에서 앞에 보이고, 한글로도 찾을 수 있게 (한글 별칭 · 티커가 바뀐 종목은 옛 티커도 별칭에: SPLG → SPYM)
POP_US = [
    ('SPY', 'S&P500 에스앤피 스파이'), ('VOO', 'S&P500 에스앤피 뱅가드'), ('IVV', 'S&P500 에스앤피 아이셰어즈'), ('SPYM', 'S&P500 에스앤피 SPLG'),
    ('QQQ', '나스닥100 나스닥 큐큐큐'), ('QQQM', '나스닥100 나스닥'), ('TQQQ', '나스닥100 3배 레버리지'), ('SQQQ', '나스닥100 3배 인버스'),
    ('QLD', '나스닥100 2배 레버리지'), ('SCHD', '배당 다우존스 슈드'), ('JEPI', '커버드콜 월배당 제피'), ('JEPQ', '나스닥 커버드콜 월배당 제프큐'),
    ('QYLD', '나스닥 커버드콜 월배당'), ('XYLD', 'S&P500 커버드콜 월배당'), ('DIVO', '배당 커버드콜'), ('SOXL', '반도체 3배 레버리지 속슬'),
    ('SOXS', '반도체 3배 인버스'), ('SOXX', '반도체 필라델피아'), ('SMH', '반도체 반에크'), ('DIA', '다우존스 다우 30'), ('VTI', '미국 전체 시장 토탈'),
    ('VT', '전세계 주식'), ('VEA', '선진국 주식'), ('VWO', '신흥국 주식 이머징'), ('EEM', '신흥국 주식 이머징'), ('EWY', '한국 주식 MSCI'),
    ('VIG', '배당성장'), ('DGRO', '배당성장'), ('VYM', '고배당'), ('HDV', '고배당'), ('SPYD', 'S&P500 고배당'), ('NOBL', '배당귀족'),
    ('TLT', '미국 국채 20년 장기채'), ('TMF', '미국 국채 20년 3배'), ('IEF', '미국 국채 7-10년 중기채'), ('SHY', '미국 국채 1-3년 단기채'),
    ('SGOV', '미국 국채 0-3개월 초단기 현금'), ('BIL', '미국 국채 1-3개월 초단기'), ('BND', '미국 채권 종합'), ('AGG', '미국 채권 종합'),
    ('LQD', '회사채 투자등급'), ('HYG', '하이일드 회사채'), ('GLD', '금 골드'), ('IAU', '금 골드'), ('SLV', '은 실버'), ('USO', '원유 WTI'),
    ('XLK', '기술주 섹터'), ('XLF', '금융 섹터'), ('XLE', '에너지 섹터'), ('XLV', '헬스케어 섹터'), ('XLY', '경기소비재 섹터'), ('XLP', '필수소비재 섹터'),
    ('XLI', '산업재 섹터'), ('XLU', '유틸리티 섹터'), ('XLRE', '부동산 리츠 섹터'), ('VNQ', '리츠 부동산'), ('ARKK', '아크 혁신 캐시우드'),
    ('IWM', '러셀2000 소형주'), ('MGK', '메가캡 성장'), ('VUG', '성장주'), ('VTV', '가치주'), ('SCHG', '대형 성장주'), ('RSP', 'S&P500 동일가중'),
    ('UPRO', 'S&P500 3배 레버리지'), ('SSO', 'S&P500 2배 레버리지'), ('SPXL', 'S&P500 3배 레버리지'), ('TECL', '기술주 3배 레버리지'),
    ('FNGU', '빅테크 3배 레버리지'), ('BITO', '비트코인 선물'), ('IBIT', '비트코인 현물 블랙록'), ('FBTC', '비트코인 현물 피델리티'),
    ('ETHA', '이더리움 현물'), ('KWEB', '중국 인터넷'), ('FXI', '중국 대형주'), ('EWJ', '일본 주식'), ('INDA', '인도 주식'), ('URA', '우라늄'),
    ('LIT', '리튬 2차전지'), ('ICLN', '클린에너지'), ('TAN', '태양광'), ('BOTZ', '로봇 AI'), ('CIBR', '사이버보안'), ('XBI', '바이오'),
]


def get(url, tries=3, timeout=40):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def load(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except Exception:
        return {}


def kr_list():
    b = get('https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc')
    try:
        d = json.loads(b.decode('euc-kr'))
    except UnicodeDecodeError:
        d = json.loads(b.decode('utf-8', 'replace'))
    out, seen = [], set()
    for x in d['result']['etfItemList']:
        code, name = str(x.get('itemcode') or '').strip().upper(), re.sub(r'\s+', ' ', str(x.get('itemname') or '')).strip()
        if not re.fullmatch(r'[0-9A-Z]{6}', code) or not name or code in seen:
            continue
        seen.add(code)
        out.append([code, name, int(x.get('etfTabCode') or 7)])
    if len(out) < 500:
        raise ValueError(f'국내 ETF 목록이 너무 적음 ({len(out)}개)')
    return out


def us_list():
    txt = get('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt').decode('utf-8', 'replace')
    rows = list(csv.reader(io.StringIO(txt), delimiter='|'))
    head = rows[0]
    alias = dict(POP_US)
    found = {}
    for r in rows[1:]:
        if len(r) != len(head):
            continue
        d = dict(zip(head, r))
        if d.get('ETF') != 'Y' or d.get('Test Issue') != 'N':
            continue
        sym = d['Symbol'].strip().upper().replace('.', '-')
        if not re.fullmatch(r'[A-Z][A-Z0-9-]{0,9}', sym):
            continue
        name = re.sub(r'\s+', ' ', d['Security Name']).strip()
        found[sym] = [sym, name, d.get('Listing Exchange', '').strip()[:1], alias.get(sym, '')]
    if len(found) < 2000:
        raise ValueError(f'미국 ETF 목록이 너무 적음 ({len(found)}개)')
    pop = [found[s] for s, _ in POP_US if s in found]
    rest = sorted((v for k, v in found.items() if k not in alias), key=lambda v: v[0])
    return pop + rest


def usdkrw():
    today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)).strftime('%Y%m%d')
    d = json.loads(get(f'https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_KEY}/json/kr/1/20000/731Y001/D/19900101/{today}/0000001'))
    rows = (d.get('StatisticSearch') or {}).get('row') or []
    pts = []
    for r in rows:
        try:
            day = datetime.date(int(r['TIME'][:4]), int(r['TIME'][4:6]), int(r['TIME'][6:8])).toordinal() - 719163
            v = float(r['DATA_VALUE'])
        except Exception:
            continue
        if v > 0 and (not pts or day > pts[-1][0]):
            pts.append((day, v))
    if len(pts) < 5000:
        raise ValueError(f'원/달러 환율 자료가 너무 적음 ({len(pts)}개)')
    return {'unit': 'day', 'src': 'ECOS 731Y001 원/미국달러 매매기준율', 'd0': pts[0][0], 'dd': [b[0] - a[0] for a, b in zip(pts, pts[1:])],
            'c': [round(p[1], 2) for p in pts]}


def save_if_changed(path, obj, old, keys):
    """내용(keys)이 같으면 파일을 다시 쓰지 않음 (updated 만 바뀌는 커밋 방지) — 단, 하루 지나면 updated 를 새로 씀"""
    same = old and all(old.get(k) == obj.get(k) for k in keys)
    if same and old.get('updated', '')[:10] == obj['updated'][:10]:
        print(f'  {os.path.basename(path)}: 변경 없음')
        return
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(f'  {os.path.basename(path)}: 저장 ({os.path.getsize(path):,} bytes)')


def main():
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    old = load(OUT)
    out = {'updated': now, 'kr': old.get('kr') or [], 'us': old.get('us') or [], 'src': {}}
    try:
        out['kr'] = kr_list()
        print(f'  국내 ETF {len(out["kr"])}개')
    except Exception as e:
        print('  국내 ETF 목록 실패(직전값 유지):', e)
    try:
        out['us'] = us_list()
        print(f'  미국 ETF {len(out["us"])}개')
    except Exception as e:
        print('  미국 ETF 목록 실패(직전값 유지):', e)
    out['src'] = {'kr': '네이버 증권 ETF 목록', 'us': 'Nasdaq Trader 상장 종목 목록(nasdaqtraded.txt)'}
    if not out['kr'] or not out['us']:
        print('목록이 비어 있어 저장하지 않음'); sys.exit(1)
    save_if_changed(OUT, out, old, ('kr', 'us'))
    oldfx = load(FX_OUT)
    try:
        fx = usdkrw(); fx['updated'] = now
        save_if_changed(FX_OUT, fx, oldfx, ('d0', 'dd', 'c'))
        print(f'  원/달러 {len(fx["c"])}일 · 마지막 {fx["c"][-1]}')
    except Exception as e:
        print('  원/달러 환율 실패(직전값 유지):', e)


if __name__ == '__main__':
    main()
