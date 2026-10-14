"""설정 탐색 결과를 실제 시뮬레이터 화면에서 확인 (㉝) — 로컬 화면(광고·분석 요청 차단 · 저장소 맨 위에서 build_pages.py 로 만든 페이지)에서
  python3 verify.py snap <data폴더>             : 화면이 지금 받는 자료(야후 일봉 · ysnap/ 에 저장)로 dump.py 와 같은 JS 를 돌려 data 폴더와 한 칸씩 비교 · 지금 화면 자료를 data_now/ 에 씀
  python3 verify.py picks <final.json> [...]     : 뽑힌 설정을 시뮬레이터 주소(rj=·ft=·e= 포함)로 열어 CAGR·MDD 가 탐색 값과 같은지
  python3 verify.py urls <목록.json>             : [{url, cagr, mdd, per, label}] 주소마다 화면 값이 기대값과 같은지
야후 요청(Worker /etf · allorigins)은 ysnap/<기호>.json 이 있으면 그것으로, 없으면 야후 v8 을 직접 받아 저장(덤프 때와 같은 원문)."""
import re, os, sys, json, time, threading, functools, http.server, socketserver, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HERE = os.environ.get('VERIFY_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify')   # ysnap/ · data_now/ 를 둘 곳(.gitignore)
SNAP = os.path.join(HERE, 'ysnap'); os.makedirs(SNAP, exist_ok=True)
CHJS = os.environ.get('CHARTJS', '')   # Chart.js 4.4.1 로컬본(있으면 cdnjs 대신 · 없으면 cdnjs 그대로)
TRACK_RE = re.compile(r'^https?://([^/?#]*\.)?(googlesyndication\.com|doubleclick\.net|google-analytics\.com|googletagmanager\.com'
                      r'|googleadservices\.com|adtrafficquality\.google|fundingchoicesmessages\.google\.com|adservice\.google\.[a-z.]+'
                      r'|clarity\.ms|wcs\.naver\.(?:net|com))(:\d+)?([/?#]|$)', re.I)
PORT = 8767
def yahoo(sym):
    f = os.path.join(SNAP, sym.replace('^', '_') + '.json')
    if os.path.exists(f): return open(f, 'rb').read()
    u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(sym) + '?period1=315532800&period2=%d&interval=1d&includePrePost=false&events=div' % (int(time.time()) + 86400)
    for k in range(3):
        try:
            b = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read(); open(f, 'wb').write(b); return b
        except Exception:
            if k == 2: raise
            time.sleep(3)
STAT = {'blocked': 0, 'yahoo': set(), 'ext404': []}
def etf(route):
    u = route.request.url; q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query); hd = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    if 'allorigins' in u: q = {'m': ['u'], 's': [urllib.parse.unquote(urllib.parse.urlparse(urllib.parse.unquote((q.get('url') or [''])[0])).path.split('/')[-1])]}
    m, sym = (q.get('m') or [''])[0], (q.get('s') or [''])[0]
    if m != 'u' or not sym: return route.fulfill(status=404, headers=hd, body='{"error":"not found"}')
    try:
        STAT['yahoo'].add(sym); return route.fulfill(status=200, headers=hd, body=yahoo(sym))
    except Exception as e:
        print('  야후 받기 실패', sym, e); return route.fulfill(status=502, headers=hd, body='{"error":"upstream"}')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def handle(self):
        try: super().handle()
        except (BrokenPipeError, ConnectionResetError): pass
def ctx_of(p):
    br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 1000}, locale='ko-KR')
    chjs = open(CHJS).read() if CHJS and os.path.exists(CHJS) else None
    def ext(route):
        u = route.request.url
        if TRACK_RE.match(u): STAT['blocked'] += 1; return route.fulfill(status=200, content_type='application/javascript', body='')
        if re.match(r'^https://[^/]*workers\.dev/etf\?', u) or u.startswith('https://api.allorigins.win/'): return etf(route)
        if chjs and re.match(r'^https://cdnjs\.cloudflare\.com/ajax/libs/Chart\.js/4\.4\.1/chart\.umd\.js$', u): return route.fulfill(status=200, content_type='application/javascript', body=chjs)
        if u.startswith('https://cdnjs.cloudflare.com/'): return route.continue_()
        if u.startswith('http://127.0.0.1') or 'fonts.googleapis' in u or 'fonts.gstatic' in u: return route.continue_()
        STAT['ext404'].append(u[:90]); return route.fulfill(status=404, body='')
    ctx.route(re.compile(r'^https?://.*'), ext)   # 한 route 에서 광고·분석 차단까지 (나중 등록 route 가 먼저 받는 문제 없게)
    return br, ctx
DUMPJS = """async (tk) => {
  const B = window.MBT, D0 = await B.load(tk); if (!D0.h) D0.h = D0.c.slice();
  await B.withOpen(D0);
  const F = await B.fxData(), P = await B.preload(tk), alpha = B.hiAlpha(D0, 1), J = P && alpha != null ? B.join(D0, P, alpha) : null, late = P && alpha != null ? B.lateSeries(D0, P, alpha) : null;
  if (J) await B.preOpen(J, tk, J.L);
  if (late) await B.preOpen(late, tk, late.d.length);
  const pick = D => ({ d: D.d, c: D.c, h: D.h, o: D.o || null, dv: D.dv || null, L: D.L || 0, fx: B.fxFor(D.d, F) });
  return { act: pick(D0), pre: J ? pick(J) : null, late: late ? { d: late.d, c: late.c, h: late.h, o: late.o || null, dv: late.dv, L: 0, fx: B.fxFor(late.d, F) } : null };
}"""
GET = """(() => { const R = window.MBTdebug && MBTdebug.R(); if (!R || !R.sn) return null; const E = R.pre && R.pre.err;
  return { tk: R.tk, ver: R.S.ver, rej: R.S.rej || '', fill: R.S.fill || '', from: R.D.d[R.net.from], to: R.D.d[R.net.to], L: R.pre ? R.D.d[R.pre.L] : null, cagr: R.sn.cagr, mdd: R.sn.mdd, fin: R.sn.final,
    nob: R.net.nob, rj: R.net.rj ? { days: R.net.rj.days, miss: R.net.rj.miss } : null, cmp: !!R.cmp, err: E ? (E.d != null ? E.d : 1) : null, hash: location.hash,
    warns: [...document.querySelectorAll('.mb-warns li, .mb-warns p')].map(e => e.textContent.trim()).slice(0, 4) } })()"""
def num(x): return '%.10g' % x
def hash_of(tk, p, per, rj, end, fill=None):
    """final.js hashOf 와 같은 주소 (rj=·ft=·e= 포함)"""
    v = p['ver']; h = ['v=' + v, 't=' + tk, 'c=10000', 'sp=' + num(p['splits']), 'tg=' + num(p['target'])]
    if v in ('2.0', '2.1'): h += ['pt=' + num(p['part']), 'cp=' + num(p['capP'])]
    h += ['bg=' + num(p['big']), 'fe=0.07']
    if v not in ('1.0', '2.0'): h += ['ln=' + num(p['lines']), 'sh=' + num(p['shares'])]
    if v == '4.0' and p.get('noBig'): h.append('nb=1')
    if v in ('1.0', '2.0', '2.1', '2.2') and p.get('money') != 'compound': h.append('m=' + p['money'])
    if v != '4.0' and p.get('exhaust') != 'official': h.append('x=' + p['exhaust'])
    if v != '4.0' and p.get('restart') == 'rsi': h.append('r=rsi')
    if per == 'pre': h.append('p=1')
    if v == '3.0' and p.get('rebase'): h.append('rb=1')
    if v in ('1.0', '2.0', '2.1') and p.get('avgOff'): h.append('ao=' + num(p['avgOff']))
    if v in ('2.2', '3.0') and p.get('tround') == 'c1': h.append('tr=c1')
    if p.get('method') == 'avg': h.append('tm=avg')
    if p.get('harvest'): h.append('hv=1')
    if rj in ('clamp', 'skip'): h.append('rj=' + rj[0])
    if fill in ('open', 'pre'): h.append('ft=' + fill[0])
    h.append('e=' + end)
    return 'https://d-capitalism.com/muhan-backtest/#' + '&'.join(h)
def main():
    mode = sys.argv[1]
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    errs = []; bad = 0; n = 0
    with sync_playwright() as p:
        br, ctx = ctx_of(p)
        if mode == 'snap':
            DATA = sys.argv[2]
            pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto('http://127.0.0.1:%d/muhan-backtest/' % PORT, wait_until='load'); pg.wait_for_timeout(1500)
            for tk in ['TQQQ', 'SOXL', 'UPRO', 'TECL']:
                r = pg.evaluate(DUMPJS, tk)
                for per in ['act', 'pre', 'late']:
                    A = r[per]; B = json.load(open(os.path.join(DATA, '%s_%s.json' % (tk, per)))); os.makedirs(os.path.join(HERE, 'data_now'), exist_ok=True); json.dump(A, open(os.path.join(HERE, 'data_now', '%s_%s.json' % (tk, per)), 'w'))
                    diff = [k for k in ['d', 'c', 'h', 'o', 'dv', 'L', 'fx'] if A.get(k) != B.get(k)]
                    n += 1; bad += bool(diff)
                    print(('같음 ' if not diff else '다름 ') + tk, per, len(A['d']), A['d'][0], '→', A['d'][-1], ('다른 칸 ' + ','.join(diff)) if diff else '', flush=True)
        elif mode == 'urls':   # [{url, cagr, mdd, per, label}] — 주소마다 화면 CAGR·MDD 가 기대값과 같은지
            for it in json.load(open(sys.argv[2])):
                pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
                pg.goto('http://127.0.0.1:%d/muhan-backtest/#%s' % (PORT, it['url'].split('#', 1)[1]), wait_until='load')
                r = None
                for i in range(600):
                    pg.wait_for_timeout(250); r = pg.evaluate(GET)
                    if r and (it['per'] == 'act' or r['L'] is not None): break
                if it['per'] == 'pre': pg.wait_for_timeout(1500); r = pg.evaluate(GET)
                n += 1
                ok = bool(r) and abs(r['cagr'] - it['cagr']) < 5e-5 and abs(r['mdd'] - it['mdd']) < 5e-5
                bad += not ok
                print(('같음 ' if ok else '다름 ') + it['label'], ('| 화면 %.4f%% / %.2f%% 거부 %s' % (r['cagr'] * 100, r['mdd'] * 100, r['rj'])) if r else '| 화면 없음',
                      '| 계산 %.4f%% / %.2f%%' % (it['cagr'] * 100, it['mdd'] * 100), '| 기간', r and r['from'], '~', r and r['to'], '| 오차 ②', r and r['err'], flush=True)
                pg.close()
        else:
            todo = []; nocsv = 0
            for f in sys.argv[2:]:
                F = json.load(open(f)); rj = F.get('rej') or 'none'; fl = F.get('fill') or 'none'
                cf = os.path.join(os.path.dirname(f), '무한매수법_설정탐색_후보.csv')
                urls = set(re.findall(r'https://d-capitalism\.com/muhan-backtest/#[^,\s"]+', open(cf, encoding='utf-8-sig').read())) if os.path.exists(cf) else set()
                for key, R in F['RES'].items():
                    seen = set()
                    for nm in ['raw', 'rawAny', 'rob', 'bal', 'credRob', 'credBal']:
                        x = R.get(nm)
                        if not x or not x.get('p') or json.dumps(x['p'], sort_keys=True) in seen: continue
                        seen.add(json.dumps(x['p'], sort_keys=True)); url = hash_of(R['tk'], x['p'], R['per'], rj, R['to'], fl)
                        if urls and url not in urls: nocsv += 1; print('  CSV 에 없는 주소', url)
                        todo.append((rj, fl, key, R['per'], nm, x, url))
            print('확인할 설정', len(todo), '· CSV 주소와 다른 것', nocsv, flush=True)
            for rj, fl, key, per, nm, x, url in todo:
                h = url.split('#', 1)[1]
                pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append('PAGEERR ' + str(e)))
                pg.goto('http://127.0.0.1:%d/muhan-backtest/#%s' % (PORT, h), wait_until='load')
                r = None
                for i in range(600):
                    pg.wait_for_timeout(250); r = pg.evaluate(GET)
                    if r and (per == 'act' or r['L'] is not None): break
                if per == 'pre': pg.wait_for_timeout(1500); r = pg.evaluate(GET)
                n += 1
                ok = bool(r) and abs(r['cagr'] - x['r']['cagr']) < 5e-5 and abs(r['mdd'] - x['r']['mdd']) < 5e-5 and (r['rej'] or 'none') == rj and (r['fill'] or 'none') == fl
                bad += not ok
                print(('같음 ' if ok else '다름 ') + rj + ('·' + fl if fl != 'none' else ''), key, nm, 'V' + x['p']['ver'], x['p']['splits'], x['p']['target'],
                      ('| 화면 %.4f%% / %.2f%% 거부 %s' % (r['cagr'] * 100, r['mdd'] * 100, r['rj'])) if r else '| 화면 없음',
                      '| 탐색 %.4f%% / %.2f%%' % (x['r']['cagr'] * 100, x['r']['mdd'] * 100), '| 기간', r and r['from'], '~', r and r['to'], '| nob', r and r['nob'],
                      '| 상장 전 오차 ②', r and r['err'], '| ⚠', r and r['warns'], flush=True)
                pg.close()
        br.close()
    srv.shutdown()
    print('확인 %d건 · 다름 %d건 · 페이지 오류 %d건 · 광고·분석 요청 차단 %d건 · 야후 기호 %s · 막은 외부 요청 %d건' % (n, bad, len(errs), STAT['blocked'], sorted(STAT['yahoo']), len(STAT['ext404'])))
    for e in errs[:5]: print(e)
    for u in sorted(set(STAT['ext404']))[:8]: print('  외부 404:', u)
if __name__ == '__main__':
    main()
