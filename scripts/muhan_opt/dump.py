"""무한매수법 설정 탐색용 자료 꺼내기 — 시뮬레이터 화면(/muhan-backtest/)이 쓰는 일봉을 그대로 파일로
python scripts/muhan_opt/dump.py   (저장소 맨 위에서 · 먼저 scripts/build_pages.py 로 페이지를 만들어 둘 것)
→ scripts/muhan_opt/data/<종목>_act.json (상장 이후 실제) · _pre.json (상장 전 재현 + 실제, L = 상장일 위치) · _late.json (상장 이후 날짜의 재현 종가 + 추정 고가)
  · 시가 o (증권사 주문 거부 계산 REJ 용): 실제 = 야후 일봉 시가(MBT.withOpen) · 재현 구간 = 같은 지수 ETF 시가 변화 × 3(MBT.preOpen — 없는 날 0 = 전날 종가로 봄)
· 저장소를 127.0.0.1 로 열고 화면의 window.MBT(load·preload·join·hiAlpha·lateSeries·fxFor)를 그대로 부름 — 엔진·자료 가공이 사이트와 같음
· 야후 일봉(UPRO·TECL·대리 ETF·재현 재료)은 화면이 Worker /etf(사이트 주소만 허용) → 공개 프록시로 받는데, 여기선 그 요청을 가로채
  이 파이썬이 야후 v8 을 직접 받아 그대로 돌려줌(같은 원문 · 인터넷 필요 · GitHub Actions 에서도 됨)
· 광고·방문 분석 요청은 막음(tests/run_regression.py 의 TRACK_RE 와 같은 목록) — 사이트 통계·애드센스에 남지 않게
· 그다음: node scripts/muhan_opt/prep.js - - scripts/muhan_opt/data src/index.html  (재현 믿음도용 <종목>_hyb.json)"""
import re, os, json, time, threading, functools, http.server, socketserver, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
TRACK_RE = re.compile(r'^https?://([^/?#]*\.)?(googlesyndication\.com|doubleclick\.net|google-analytics\.com|googletagmanager\.com'
                      r'|googleadservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com|adservice\.google\.[a-z.]+'
                      r'|clarity\.ms|wcs\.naver\.(?:net|com))(:\d+)?([/?#]|$)', re.I)
TICKERS = ['TQQQ', 'SOXL', 'UPRO', 'TECL']
JS = """async (tk) => {
  const B = window.MBT, D0 = await B.load(tk); if (!D0.h) D0.h = D0.c.slice();
  await B.withOpen(D0);
  const F = await B.fxData(), P = await B.preload(tk), alpha = B.hiAlpha(D0, 1), J = P && alpha != null ? B.join(D0, P, alpha) : null, late = P && alpha != null ? B.lateSeries(D0, P, alpha) : null;
  if (J) await B.preOpen(J, tk, J.L);
  if (late) await B.preOpen(late, tk, late.d.length);
  const pick = D => ({ d: D.d, c: D.c, h: D.h, o: D.o || null, dv: D.dv || null, L: D.L || 0, fx: B.fxFor(D.d, F) });
  const cnt = D => D && D.o ? D.o.filter(x => x > 0).length : 0;
  return { act: pick(D0), pre: J ? pick(J) : null, late: late ? { d: late.d, c: late.c, h: late.h, o: late.o || null, dv: late.dv, L: 0, fx: B.fxFor(late.d, F) } : null, alpha,
           oCnt: { act: cnt(D0), pre: cnt(J), preSyn: J ? J.o.slice(0, J.L).filter(x => x > 0).length : 0, late: cnt(late) } };
}"""
YC = {}
def yahoo(sym):
    """야후 v8 일봉 원문 (화면 MBT.upstream 과 같은 주소 · 브라우저 User-Agent)"""
    if sym not in YC:
        u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(sym) + '?period1=315532800&period2=%d&interval=1d&includePrePost=false&events=div' % (int(time.time()) + 86400)
        for k in range(3):
            try:
                YC[sym] = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read(); break
            except Exception as e:
                if k == 2: raise
                time.sleep(3)
    return YC[sym]
def etf(route):
    u = route.request.url; q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query); hd = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    if 'allorigins' in u:   # 공개 프록시 경로 → 원래 야후 주소의 기호
        q = {'m': ['u'], 's': [urllib.parse.unquote(urllib.parse.urlparse(urllib.parse.unquote((q.get('url') or [''])[0])).path.split('/')[-1])]}
    m, sym = (q.get('m') or [''])[0], (q.get('s') or [''])[0]
    if m != 'u' or not sym:
        return route.fulfill(status=404, headers=hd, body='{"error":"not found"}')
    try:
        return route.fulfill(status=200, headers=hd, body=yahoo(sym))
    except Exception as e:
        print('  야후 받기 실패', sym, e); return route.fulfill(status=502, headers=hd, body='{"error":"upstream"}')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def main():
    os.makedirs(OUT, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 8766), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    blocked = {'n': 0}
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(locale='ko-KR')
        def blk(route): blocked['n'] += 1; route.fulfill(status=200, content_type='application/javascript', body='')
        ctx.route(TRACK_RE, blk)
        ctx.route(re.compile(r'^https://[^/]*workers\.dev/etf\?.*'), etf); ctx.route(re.compile(r'^https://api\.allorigins\.win/.*'), etf)
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8766/muhan-backtest/', wait_until='load'); pg.wait_for_timeout(1500)
        for tk in TICKERS:
            r = pg.evaluate(JS, tk)
            for per in ['act', 'pre', 'late']:
                D = r[per]
                if not D: print(tk, per, '없음'); continue
                json.dump(D, open(os.path.join(OUT, '%s_%s.json' % (tk, per)), 'w'))
                print(tk, per, len(D['d']), D['d'][0], '→', D['d'][-1], 'L', D['L'], 'alpha', r['alpha'], '시가 있는 날', r['oCnt'].get(per), ('(재현 구간 %d / %d)' % (r['oCnt']['preSyn'], D['L'])) if per == 'pre' else '')
        br.close()
    srv.shutdown()
    print('페이지 오류', errs[:3], '· 광고·분석 요청 차단', blocked['n'], '건')

if __name__ == '__main__':
    main()
