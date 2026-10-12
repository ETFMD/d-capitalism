"""무한매수법 설정 탐색용 자료 꺼내기 — 시뮬레이터 화면(/muhan-backtest/)이 쓰는 일봉을 그대로 파일로
python scripts/muhan_opt/dump.py   (저장소 맨 위에서 · 먼저 scripts/build_pages.py 로 페이지를 만들어 둘 것)
→ scripts/muhan_opt/data/<종목>_act.json (상장 이후 실제) · _pre.json (상장 전 재현 + 실제, L = 상장일 위치) · _late.json (상장 이후 날짜의 재현 종가 + 추정 고가)
· 저장소를 127.0.0.1 로 열고 화면의 window.MBT(load·preload·join·hiAlpha·lateSeries·fxFor)를 그대로 부름 — 엔진·자료 가공이 사이트와 같음
· 상장 전 재현에 쓰는 지수 일봉은 화면처럼 Worker /etf 에서 받음(인터넷 필요)
· 광고·방문 분석 요청은 막음(tests/run_regression.py 의 TRACK_RE 와 같은 목록) — 사이트 통계·애드센스에 남지 않게
· 그다음: node scripts/muhan_opt/prep.js - - scripts/muhan_opt/data src/index.html  (재현 믿음도용 <종목>_hyb.json)"""
import re, os, json, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
TRACK_RE = re.compile(r'^https?://([^/?#]*\.)?(googlesyndication\.com|doubleclick\.net|google-analytics\.com|googletagmanager\.com'
                      r'|googleadservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com|adservice\.google\.[a-z.]+'
                      r'|clarity\.ms|wcs\.naver\.(?:net|com))(:\d+)?([/?#]|$)', re.I)
TICKERS = ['TQQQ', 'SOXL', 'UPRO', 'TECL']
JS = """async (tk) => {
  const B = window.MBT, D0 = await B.load(tk); if (!D0.h) D0.h = D0.c.slice();
  const F = await B.fxData(), P = await B.preload(tk), alpha = B.hiAlpha(D0, 1), J = P && alpha != null ? B.join(D0, P, alpha) : null, late = P && alpha != null ? B.lateSeries(D0, P, alpha) : null;
  const pick = D => ({ d: D.d, c: D.c, h: D.h, dv: D.dv || null, L: D.L || 0, fx: B.fxFor(D.d, F) });
  return { act: pick(D0), pre: J ? pick(J) : null, late: late ? { d: late.d, c: late.c, h: late.h, dv: late.dv, L: 0, fx: B.fxFor(late.d, F) } : null, alpha };
}"""

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
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://127.0.0.1:8766/muhan-backtest/', wait_until='load'); pg.wait_for_timeout(1500)
        for tk in TICKERS:
            r = pg.evaluate(JS, tk)
            for per in ['act', 'pre', 'late']:
                D = r[per]
                if not D: print(tk, per, '없음'); continue
                json.dump(D, open(os.path.join(OUT, '%s_%s.json' % (tk, per)), 'w'))
                print(tk, per, len(D['d']), D['d'][0], '→', D['d'][-1], 'L', D['L'], 'alpha', r['alpha'])
        br.close()
    srv.shutdown()
    print('페이지 오류', errs[:3], '· 광고·분석 요청 차단', blocked['n'], '건')

if __name__ == '__main__':
    main()
