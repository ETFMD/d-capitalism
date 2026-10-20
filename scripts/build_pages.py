#!/usr/bin/env python3
"""도구(탭)별 고유 주소 페이지·sitemap.xml·robots.txt·404.html 생성

· 원본은 src/index.html 하나(모든 도구가 든 한 파일) — 이 스크립트가 홈(루트 index.html)과 scripts/routes.json 의 도구마다
  <경로>/index.html 을 만들고, 각 페이지의 <head> 에 고유 제목·설명·공유 미리보기(OG)·canonical 을 넣습니다.
· 도구별 페이지 분리: 각 페이지의 HTML 에는 그 도구 화면(app-page) 하나만 남기고, 큰 CSS·JS 는
  assets/app.<해시>.css · assets/app.<해시>.js 로 빼서 모든 페이지가 같은 파일을 캐시로 함께 씀
  (다른 도구로 가면 메뉴가 그 주소로 이동 — src/index.html 의 [ROUTER] 참고)
· 푸터의 전체 도구 링크(<!--FOOTMAP-->)를 routes.json 으로 채움 (검색엔진이 모든 도구 주소를 따라갈 수 있게)
· 하위 페이지는 <base href="../"> 로 data/*.json 등 상대 경로를 루트 기준으로 맞추고,
  처음부터 해당 도구 화면이 보이도록 active 탭을 바꿔 둡니다 (검색엔진·JS 없는 환경도 같은 화면).
· 자체 도메인을 쓰려면 저장소 루트에 CNAME 파일(예: decoding.kr)만 두면 주소가 자동으로 바뀝니다.
사용: python3 scripts/build_pages.py   (GitHub Actions 'build-pages' 가 src/index.html 변경 시 자동 실행)
"""
import datetime, hashlib, html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_learn as BL   # '투자 공부' 글 모음 (content/learn → learn/)
import build_books as BB   # '자본가 서재' 단계별 추천 도서 (content/books/books.json → books/)
import data_facts as DF    # 자동 갱신 숫자 (data/*.json) · 지수 고유 해설 [IDXNOTE]
import social as SO        # 하단 공식 SNS 바로가기 [SNS-LINKS] (routes.json "social")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'src', 'index.html')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'routes.json'), encoding='utf-8'))
BEGIN, END = '<!--SEO:BEGIN-->', '<!--SEO:END-->'


def site_url():
    cname = os.path.join(ROOT, 'CNAME')
    if os.path.exists(cname):
        host = open(cname, encoding='utf-8').read().strip().splitlines()[0].strip()
        if host:
            return f'https://{host}/'
    url = CFG['site']
    return url if url.endswith('/') else url + '/'


SITE = site_url()
DESC_MAX = 80   # 네이버 서치어드바이저 권장: 설명문 80자 이내
for _r in [CFG['home']] + CFG['routes']:
    if len(_r['desc']) > DESC_MAX:
        sys.exit(f"설명이 {DESC_MAX}자를 넘습니다 ({len(_r['desc'])}자): {_r.get('path') or 'home'} — scripts/routes.json 의 desc 를 줄여 주세요")
    if 'en' in _r and len(_r['en']['desc']) > 160:
        sys.exit(f"영어 설명이 160자를 넘습니다: {_r.get('path')}")
BRAND = CFG['brand']
BRAND_EN = CFG.get('brand_en', 'Decoding Capitalism')
EN_FILE = os.path.join(ROOT, 'scripts', 'i18n', 'en.json')
EN = json.load(open(EN_FILE, encoding='utf-8')) if os.path.exists(EN_FILE) else {'text': {}, 'guides': {}}
HOME = dict(CFG['home'], path='')
ROUTES = CFG['routes']
ALL = [HOME] + ROUTES
ARTS = BL.load()          # 투자 공부 글 (order 순)
BOOKS = BB.load(ROUTES, ARTS)   # 자본가 서재 (자료 검사 통과한 것 · 파일 없으면 None)
PATH_OF = {r['tab']: r['path'] for r in ROUTES}
ADMIN = {r['tab'] for r in ROUTES if r.get('admin')}   # 관리자 전용 화면(routes.json "admin": true) — 상단 메뉴·허브·하단 사이트맵·sitemap.xml 에서 빼고 noindex (계정 메뉴 '관리자 기능'에서만 들어감)
# 광고 스크립트를 넣지 않는 화면 — 관리자 잠금 화면(방문자에게는 잠김 안내뿐) + routes.json "noads": true(회원 글 게시판 등)
#   애드센스 정책: 콘텐츠가 없거나(잠김 안내) 사용자가 쓴 글이 중심인 화면에는 광고를 두지 않음 — 심사에서 '가치 없는 화면'으로 보이지 않게
NOADS = ADMIN | {r['tab'] for r in ROUTES if r.get('noads')}
ADS_RE = re.compile(r'<script async src="https://pagead2\.googlesyndication\.com/pagead/js/adsbygoogle\.js\?client=ca-pub-\d+" crossorigin="anonymous"></script>\n?')


def esc(s):
    return html.escape(s, quote=True)


def og_image(r):
    rel = f"assets/og/{r['path'] or 'home'}.png"
    if not os.path.exists(os.path.join(ROOT, rel)):
        rel = 'assets/og/home.png'
    # 이미지가 바뀌면 주소도 바뀌게(?v=내용 해시) — 카카오톡·페이스북 등이 예전 미리보기 이미지를 계속 쓰지 않도록
    v = hashlib.sha256(open(os.path.join(ROOT, rel), 'rb').read()).hexdigest()[:8]
    return f'{SITE}{rel}?v={v}'


NAV_LABEL = {}   # 탭 id → 메뉴에 보이는 탭 이름 (index.html 의 드롭다운 버튼 글자에서 읽음)
NAV_ICON = {}    # 탭 id → 메뉴 버튼의 아이콘 SVG (허브 페이지 카드에 그대로 씀)


def plain(h):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', h))).strip()


def load_nav_labels(src):
    for m in re.finditer(r'<button class="drop-item[^"]*"\s+id="drop-([a-z0-9]+)"[^>]*>(.*?)</button>', src, re.S):
        body = re.sub(r'<span class="drop-all">.*?</span>', '', m.group(2))   # 허브 버튼의 '전체' 표시는 이름이 아님
        NAV_LABEL[m.group(1)] = plain(body)
        ic = re.search(r'<svg\b.*?</svg>', body, re.S)
        if ic:
            NAV_ICON[m.group(1)] = ic.group(0)
    for x in ROUTES:   # 관리자 전용 화면은 상단 메뉴에 없음 → 이름은 routes.json 의 short
        if x['tab'] in ADMIN:
            if x['tab'] in NAV_LABEL:
                sys.exit(f"관리자 전용 화면 drop-{x['tab']} 이 상단 메뉴에 있습니다 — 메뉴에서 빼 주세요")
            NAV_LABEL[x['tab']] = x['short']
    missing = [x['tab'] for x in ALL if not NAV_LABEL.get(x['tab'])]
    if missing:
        sys.exit(f'메뉴에서 탭 이름을 찾지 못했습니다: {missing}')


def fill_icons(src):
    """<i class="dc-ico" data-ico="drop-salary"></i> → 그 id 를 가진 메뉴 버튼의 아이콘(SVG)을 그대로 넣음.
    홈 카드·탭 아이콘이 메뉴 아이콘과 한 곳(메뉴 버튼)에서만 정의되도록 (메뉴 아이콘을 바꾸면 따라 바뀜)"""
    def one(m):
        i = src.find(f'id="{m.group(1)}"')
        if i < 0:
            sys.exit(f'아이콘 원본 id="{m.group(1)}" 이 없습니다 (data-ico)')
        a = src.find('<svg', i); b = src.find('</svg>', a) + 6
        svg = src[a:b]; e = svg.index('>') + 1                        # 여는 태그에서만 크기·인라인 스타일을 뺌 (크기는 CSS 가 정함)
        svg = re.sub(r'\s(?:style|width|height)="[^"]*"', '', svg[:e]) + svg[e:]
        return f'<i class="dc-ico"{m.group(2) or ""} aria-hidden="true">{svg}</i>'
    return re.sub(r'<i class="dc-ico" data-ico="([\w-]+)"([^>]*)></i>', one, src)


def tab_title(r):
    """브라우저 탭 제목: '디코딩 자본주의 | 탭 이름' (탭 이름은 메뉴 글자 그대로 — 메뉴를 바꾸면 제목도 따라 바뀜)"""
    if r['tab'] == 'home':   # 홈은 메뉴 글자('홈') 대신 사이트 한 줄 소개 — 검색 결과 제목
        return f"{BRAND} | {r['short']}"
    return f"{BRAND} | {NAV_LABEL[r['tab']]}"


def url_of(r, lang='ko'):
    return SITE + ('en/' if lang == 'en' else '') + (r['path'] + '/' if r['path'] else '')


def head_block(r, lang='ko'):
    en = lang == 'en'
    url = url_of(r, lang)
    if en:
        title = f"{BRAND_EN} | {r['en']['short']}"
        share, desc = r['en']['title'], r['en']['desc']
    else:
        title = tab_title(r)                                                      # <title> · 검색 결과 제목
        share = r['title'] if not r['path'] else f"{r['title']} | {BRAND}"     # 공유 미리보기 제목 (설명형)
        desc = r['desc']
    ld = {
        '@context': 'https://schema.org',
        '@type': 'WebSite' if not r['path'] else 'WebApplication',
        'name': (BRAND_EN if en else BRAND) if not r['path'] else (r['en']['short'] if en else r['short']),
        'url': url, 'description': desc, 'inLanguage': 'en' if en else 'ko-KR',
    }
    ld['publisher'] = {'@type': 'Organization', 'name': BRAND_EN if en else BRAND, 'url': SITE,
                       'logo': {'@type': 'ImageObject', 'url': SITE + 'assets/logo-512.png', 'width': 512, 'height': 512}}
    if SO.urls():   # 공식 SNS 계정 — 검색엔진이 사이트와 같은 운영자의 계정으로 묶도록
        ld['publisher']['sameAs'] = SO.urls()
    if r.get('hub'):
        ld['@type'] = 'CollectionPage'
        ld['mainEntity'] = {'@type': 'ItemList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'url': url_of(x, lang) if (not en or 'en' in x) else url_of(x), 'name': NAV_LABEL[x['tab']]}
            for i, x in enumerate(hub_tools(r['group']))]}
    elif r['path']:
        ld.update({'applicationCategory': 'FinanceApplication', 'operatingSystem': 'Web',
                   'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'KRW'},
                   'isPartOf': {'@type': 'WebSite', 'name': BRAND_EN if en else BRAND, 'url': SITE}})
    registry = []
    for x in ALL:
        e = {'path': x['path'], 'tab': x['tab'], 'group': x['group'],
             'title': tab_title(x), 'share': x['title'] if not x['path'] else f"{x['title']} | {BRAND}", 'desc': x['desc']}
        if 'en' in x:
            e.update({'en': True, 'enTitle': f"{BRAND_EN} | {x['en']['short']}", 'enDesc': x['en']['desc']})
        registry.append(e)
    lines = [
        BEGIN,
        f'<base href="{("../../" if en else "../") if r["path"] else "./"}">',
        # 주소가 pushState 로 바뀌어도 data/ 등 상대 경로가 사이트 루트를 가리키도록 base 를 절대 주소로 고정
        '<script>(function(){var b=document.querySelector("base");if(b)b.setAttribute("href",b.href);})();</script>',
        f'<title>{esc(title)}</title>',
        f'<meta name="description" content="{esc(desc)}">',
        f'<link rel="canonical" href="{esc(url)}">',
    ]
    if r.get('admin'):   # 관리자 전용 — 검색 결과에 나오지 않게
        lines.append('<meta name="robots" content="noindex, nofollow">')
    elif r.get('noindex'):   # 회원 글 게시판 등(routes.json "noindex": true) — 검색 결과에서 빼되 안의 링크는 따라가게
        lines.append('<meta name="robots" content="noindex, follow">')
    if 'en' in r:   # 한국어·영어 두 판이 있는 도구: 검색엔진에 서로의 언어판을 알려 줌
        lines += [f'<link rel="alternate" hreflang="ko" href="{esc(url_of(r))}">',
                  f'<link rel="alternate" hreflang="en" href="{esc(url_of(r, "en"))}">',
                  f'<link rel="alternate" hreflang="x-default" href="{esc(url_of(r))}">']
    lines += [
        f'<meta name="etfmd-route" content="{esc(r["path"])}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:site_name" content="{esc(BRAND_EN if en else BRAND)}">',
        f'<meta property="og:locale" content="{"en_US" if en else "ko_KR"}">',
        f'<meta property="og:title" content="{esc(share)}">',
        f'<meta property="og:description" content="{esc(desc)}">',
        f'<meta property="og:url" content="{esc(url)}">',
        f'<meta property="og:image" content="{esc(og_image(r))}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(share)}">',
        f'<meta name="twitter:description" content="{esc(desc)}">',
        f'<meta name="twitter:image" content="{esc(og_image(r))}">',
        '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>',
    ]
    if r['path'] and not en:   # 경로 표시(홈 › 영역 › 도구) — 검색 결과에 사이트 구조가 보이게
        crumbs = [('홈' , SITE)]
        hub = HUB.get(r['group'])
        if hub and hub is not r:
            crumbs.append((AREA[r['group']], url_of(hub)))
        crumbs.append((AREA[r['group']] if r.get('hub') else NAV_LABEL[r['tab']], url))
        lines.append('<script type="application/ld+json">' + json.dumps({'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(crumbs)]}, ensure_ascii=False) + '</script>')
    lines += [
        '<script id="etfmd-routes" type="application/json">' + json.dumps(registry, ensure_ascii=False).replace('</', '<\\/') + '</script>',
        END,
    ]
    return '\n'.join(lines)


def with_head(src, r, lang='ko'):
    block = head_block(r, lang)
    if BEGIN in src:
        return re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END), lambda m: block, src, count=1, flags=re.S)
    # 처음 한 번: 기존 <title> 을 SEO 구간으로 바꿈
    out, n = re.subn(r'<title>.*?</title>', lambda m: block, src, count=1, flags=re.S)
    if n != 1:
        sys.exit('index.html 에서 <title> 을 찾지 못했습니다')
    return out


def activate(src, r):
    """하위 페이지: 처음 보이는 화면(app-page·드롭다운·그룹 버튼)을 해당 도구로"""
    tab, grp = r['tab'], r['group']
    out = re.sub(r'class="app-page active" id="page-', 'class="app-page" id="page-', src)
    out, n = re.subn(rf'class="app-page" id="page-{tab}"', f'class="app-page active" id="page-{tab}"', out, count=1)
    if n != 1:
        sys.exit(f'page-{tab} 을 찾지 못했습니다')
    out = re.sub(r'(<button class="tab-group-btn) has-active(")', r'\1\2', out)
    if tab not in ADMIN:
        out = out.replace(f'<button class="tab-group-btn" id="grp-{grp}-btn"', f'<button class="tab-group-btn has-active" id="grp-{grp}-btn"', 1)
    out = re.sub(r'class="drop-item active"', 'class="drop-item"', out)
    out, n = re.subn(rf'class="drop-item"(\s+)id="drop-{tab}"', rf'class="drop-item active"\1id="drop-{tab}"', out, count=1)
    if n != 1 and tab not in ADMIN:   # 관리자 전용 화면은 상단 메뉴 버튼이 없음
        sys.exit(f'drop-{tab} 버튼을 찾지 못했습니다')
    hub = HUB.get(grp)
    if hub:   # 화면 위쪽 경로 표시: 홈 › 영역(허브) [› 도구] — 허브 페이지로 들어가는 내부 링크
        area = f'<span aria-current="page">{esc(AREA[grp])}</span>' if r.get('hub') else f'<a href="{esc(hub["path"])}/">{esc(AREA[grp])}</a>'
        nav = f'<nav class="crumbs" aria-label="현재 위치"><a href="./">홈</a><i>›</i>{area}</nav>'
        out = out.replace(f'class="app-page active" id="page-{tab}">', f'class="app-page active" id="page-{tab}">\n    {nav}', 1)
    return out


# ───────────── 도구별 페이지 분리 ─────────────
AREA = {'me': '내 위치', 'pay': '노동자', 'invest': '투자', 'realty': '부동산', 'capital': '자본가', 'passive': '불로소득', 'community': '커뮤니티'}   # 노동자→자본가 여정 순서 + 커뮤니티(건의 게시판) (상단 메뉴와 같음)
HUB = {r['group']: r for r in ROUTES if r.get('hub')}   # 영역 → 허브 페이지 route (routes.json 의 "hub": true)
HUB_TOP = {'me': '진단 도구', 'pay': '노동자 계산기', 'invest': '투자 계산기·도구', 'realty': '부동산 계산기', 'capital': '자본가 계산기', 'passive': '불로소득 도구', 'community': '커뮤니티'}
DROP = {}   # 영역 → [(소제목, [탭…]), …] — 상단 메뉴 드롭다운 구조 그대로 (메뉴를 바꾸면 허브도 따라 바뀜)


def load_drop_tree(src):
    by_tab = {x['tab'] for x in ROUTES}
    for g in AREA:
        m = re.search(r'<div class="tab-dropdown" id="grp-%s-drop">' % g, src)
        if not m:
            sys.exit(f'grp-{g}-drop 을 찾지 못했습니다')
        i, depth = m.end(), 1
        for t in re.finditer(r'<div\b|</div>', src[i:]):
            depth += 1 if t.group(0) == '<div' else -1
            if depth == 0:
                body = src[i:i + t.start()]
                break
        secs, top = [], []
        parents = list(re.finditer(r'<div class="drop-parent"[^>]*>(.*?)</div></div>\s*</div>', body, re.S))
        rest = body
        for pm in parents:
            rest = rest.replace(pm.group(0), '')
        for t in re.findall(r'<button class="drop-item[^"]*"\s+id="drop-([a-z0-9]+)"', rest):
            if t in by_tab and not HUB.get(g, {}).get('tab') == t:
                top.append(t)
        if top:
            secs.append((HUB_TOP[g], top))
        for pm in parents:
            name = plain(re.search(r'<button[^>]*drop-parent-btn[^>]*>(.*?)</button>', pm.group(1), re.S).group(1)).replace('▼', '').strip()
            items = [t for t in re.findall(r'id="drop-([a-z0-9]+)"', pm.group(1)) if t in by_tab]
            if items:
                secs.append((name, items))
        DROP[g] = secs
    listed = {t for g in DROP for _, ts in DROP[g] for t in ts}
    lost = [x['tab'] for x in ROUTES if not x.get('hub') and x['tab'] not in listed and x['tab'] not in ADMIN]
    if lost:
        sys.exit(f'허브에 빠진 도구(메뉴에 없음): {lost}')


def hub_tools(g):
    by = {x['tab']: x for x in ROUTES}
    return [by[t] for _, ts in DROP.get(g, []) for t in ts]


def hub_grid(g, en=False):
    T = tr_text if en else (lambda t: t)
    by = {x['tab']: x for x in ROUTES}
    out = ''
    for name, ts in DROP[g]:
        cards = ''.join(f'<a class="hub-card" href="{esc(by[t]["path"])}/"><b>{NAV_ICON.get(t, "")}{esc(T(NAV_LABEL[t]))}</b><span>{esc(by[t]["desc"])}</span></a>' for t in ts)
        out += f'<section class="hub-sec"><h2 class="hub-h">{esc(T(name))} <small>{len(ts)}개</small></h2><div class="hub-grid">{cards}</div></section>'
    return out
ASSET = {}   # 'css' / 'js' → assets/app.<해시>.<확장자> (main 에서 원본으로 만듦)


def main_script_span(src):
    """원본의 큰 앱 스크립트(<script> /* [I18N] 영어 페이지 …) 위치"""
    a = src.index('<script>\n/* [I18N] 영어 페이지')
    return a, src.index('</script>', a) + len('</script>')


def style_span(src):
    m = re.search(r'<style>\n.*?</style>', src, re.S)
    if not m or len(m.group(0)) < 50000:
        sys.exit('원본의 큰 <style> 블록을 찾지 못했습니다')
    return m.start(), m.end()


def make_assets(src):
    """원본의 큰 CSS·JS 를 assets/app.<해시>.css/js 로 저장 (내용이 같으면 같은 이름 → 브라우저 캐시 재사용)"""
    a, b = style_span(src)
    css = src[a:b][len('<style>\n'):-len('</style>')]
    a, b = main_script_span(src)
    js = src[a:b][len('<script>\n'):-len('</script>')]
    keep = set()
    for kind, body in (('css', css), ('js', js)):
        name = f"assets/app.{hashlib.sha256(body.encode('utf-8')).hexdigest()[:10]}.{kind}"
        write_if_changed(name, body)
        ASSET[kind] = name
        keep.add(os.path.basename(name))
    for f in os.listdir(os.path.join(ROOT, 'assets')):   # 예전 해시 파일 정리
        if re.fullmatch(r'app\.[0-9a-f]{10}\.(css|js)', f) and f not in keep:
            os.remove(os.path.join(ROOT, 'assets', f))
            print('  삭제', f'assets/{f}')


MODS = {}    # [MOD] 화면 하나만 쓰는 큰 코드 — 이름 → {'js': assets/<이름>.<해시>.js, 'css': …} (make_mod_assets)
MOD_RE = re.compile(r'<!--MOD:([a-z0-9]+)-->')


def make_mod_assets(src):
    """[MOD] src/<이름>/ 폴더의 *.js 를 파일 이름 순서로 이어 즉시 실행 함수 하나로 감싸고(전역 오염 없음) *.css 도 이어서
    assets/<이름>.<해시>.js · .css 로 저장 → 그 화면 원본의 <!--MOD:이름--> 자리에만 넣음 (다른 화면은 받지 않음)"""
    keep = set()
    for name in sorted(set(MOD_RE.findall(src))):
        d = os.path.join(ROOT, 'src', name)
        if not os.path.isdir(d):
            sys.exit(f'<!--MOD:{name}--> 의 코드 폴더 src/{name}/ 이 없습니다')
        files = sorted(os.listdir(d))
        js = [f for f in files if f.endswith('.js')]
        if not js:
            sys.exit(f'src/{name}/ 에 .js 파일이 없습니다')
        out = {}
        body = (f"/* 자동 생성 — src/{name}/*.js 를 이은 것 (scripts/build_pages.py [MOD]) · 직접 고치지 말고 src/{name}/ 을 고칠 것 */\n"
                "(function () {\n'use strict';\n"
                + ''.join(f'\n/* ═══ {f} ═══ */\n' + open(os.path.join(d, f), encoding='utf-8').read() for f in js) + '\n})();\n')
        css = ''.join(open(os.path.join(d, f), encoding='utf-8').read() + '\n' for f in files if f.endswith('.css'))
        for kind, text in (('js', body), ('css', css)):
            if not text.strip():
                continue
            path = f"assets/{name}.{hashlib.sha256(text.encode('utf-8')).hexdigest()[:10]}.{kind}"
            write_if_changed(path, text)
            out[kind] = path
            keep.add(os.path.basename(path))
        MODS[name] = out
    for f in os.listdir(os.path.join(ROOT, 'assets')):   # 예전 해시 파일 정리 (빠진 화면 코드 포함)
        m = re.fullmatch(r'([a-z0-9]+)\.[0-9a-f]{10}\.(css|js)', f)
        if m and m.group(1) != 'app' and f not in keep:
            os.remove(os.path.join(ROOT, 'assets', f))
            print('  삭제', f'assets/{f}')


def mod_tags(html_text):
    """그 화면에 남은 <!--MOD:이름--> → <script defer> (그 자리) + <link rel=stylesheet> (</head> 앞)"""
    names = MOD_RE.findall(html_text)
    for name in names:
        m = MODS[name]
        html_text = html_text.replace(f'<!--MOD:{name}-->', f'<script defer src="{m["js"]}"></script>', 1)
        if m.get('css'):
            html_text = html_text.replace('</head>', f'<link rel="stylesheet" href="{m["css"]}">\n</head>', 1)
    return html_text


def footmap(en=False):
    """모든 페이지 맨 아래 사이트맵 — 영역별 열(도구) + 투자 공부 열 + 아래 '지수 성장률' 한 줄 묶음 (긴 지수 목록을 열에서 빼서 깔끔하게)"""
    T = tr_text if en else (lambda t: t)
    by = {x['tab']: x for x in ROUTES}
    cols, band = [], []

    def link(r, label=None):
        return f'<a href="{esc(r["path"])}/">{esc(label or T(NAV_LABEL[r["tab"]]))}</a>'
    for g, name in AREA.items():
        head = f'<a href="{esc(HUB[g]["path"])}/">{esc(T(name))}</a>' if g in HUB else esc(T(name))
        parts = []
        for i, (sec, tabs) in enumerate(DROP.get(g, [])):
            rs = [by[t] for t in tabs if t in by]
            if '지수 성장률' in sec:   # 지수 20쪽은 아래 한 줄 묶음으로
                lab = sec.replace(' 지수 성장률', '')
                band.append(f'<span class="sf-grp"><b>{esc(T(lab))}</b>' + ''.join(link(r, T(NAV_LABEL[r["tab"]]).replace(' 성장률', '').replace(' growth', '').replace(' Growth', '')) for r in rs) + '</span>')
                continue
            if i:
                parts.append(f'<span class="sf-sub">{esc(T(sec))}</span>')
            parts.extend(link(r) for r in rs)
        cols.append(f'<div class="sf-col"><p class="sf-h">{head}</p>{"".join(parts)}</div>')
    if ARTS and not en:   # 투자 공부 글 (한국어 페이지만)
        links = ''.join(f'<a href="learn/{esc(a["slug"])}/">{esc(a.get("short") or a["title"].split(" — ")[0])}</a>' for a in ARTS)
        if BOOKS:   # 자본가 서재(추천 도서)를 투자 공부 열 맨 위에
            links = f'<a href="books/">자본가 서재 · 추천 도서 {len(BOOKS["books"])}권</a>' + links
        cols.insert(0, f'<div class="sf-col sf-learn"><p class="sf-h"><a href="learn/">투자 공부</a></p>{links}</div>')   # 상단 메뉴처럼 맨 앞(왼쪽)
    out = f'<nav class="sf-map" aria-label="{esc(T("전체 도구"))}"><div class="sf-cols">' + ''.join(cols) + '</div>'
    if band:
        out += f'<div class="sf-band"><p class="sf-h"><a href="{esc(HUB["invest"]["path"])}/">{esc(T("지수 성장률"))}</a></p><div class="sf-grps">' + ''.join(band) + '</div></div>'
    return out + '</nav>'


_IDX = {}


def idx_note(key):
    """지수 페이지 고유 해설(content/index/<키>.html) + 자동 통계 — 지수마다 한 번만 계산"""
    if key not in _IDX:
        f = os.path.join(ROOT, 'content', 'index', key + '.html')
        if not os.path.isfile(f):
            sys.exit(f'지수 해설 원본이 없습니다: content/index/{key}.html')
        text = open(f, encoding='utf-8').read().strip()
        valid = {r['path'] for r in ROUTES if not r.get('admin')} | {'learn/' + a['slug'] for a in ARTS} | {'books', 'learn'}
        for h in re.findall(r'href="([^"#]*)"', text):   # 해설 안 링크는 상대 주소(<base href>) — 실제 페이지인지 확인
            if h.rstrip('/') not in valid:
                sys.exit(f'content/index/{key}.html: 없는 주소 링크 {h}')
        try:
            _IDX[key] = DF.index_block(key, text)
        except SystemExit:
            raise
        except Exception as e:   # 시세 자료 이상 — 빌드는 계속, 지난 페이지의 해설을 그대로 씀(없으면 사람이 쓴 해설만)
            print(f'  ※ {key} 지수 통계 계산 실패 — 지난 해설 유지: {e!r}')
            path = next(r['path'] for r in ROUTES if r['tab'] == key)
            old = os.path.join(ROOT, path, 'index.html')
            m = re.search(r'<!--IDXNOTE:%s-->(.*?)<!--/IDXNOTE-->' % key, open(old, encoding='utf-8').read(), re.S) if os.path.isfile(old) else None
            _IDX[key] = m.group(1) if m and m.group(1).strip() else (
                f'<section class="guide idx-note"><div class="g-card in-text">{re.sub(r"{{[a-zA-Z0-9_.]+}}", "—", text)}</div></section>')
    return _IDX[key]


def learn_cards(arts, limit=None):
    xs = arts[:limit] if limit else arts
    return ''.join(f'<a class="g-card lr-card" href="learn/{esc(a["slug"])}/"><b>{esc(a["title"])}</b><span>{esc(a["desc"])}</span></a>' for a in xs)


def learn_hub(g):
    """허브 페이지(영역)에 넣을 그 영역 도구를 쓰는 글"""
    paths = {r['path'] for r in ROUTES if r['group'] == g and not r.get('hub')}
    xs = [a for a in ARTS if paths & set(a['tools'])]
    if not xs:
        return ''
    return (f'<section class="guide learn-rel"><h2>이 단계에서 읽어 볼 글</h2><div class="g-grid">{learn_cards(xs)}</div>'
            f'<p class="lr-all"><a href="learn/">투자 공부 글 전체 보기 →</a></p></section>')


_ASUM = {}


def autosum(key, tab):
    """[AUTOSUM] 자료 화면 자동 요약(data_facts.autosum) — 자료 이상이면 빌드는 계속, 지난 페이지의 요약을 그대로 씀"""
    if key not in _ASUM:
        try:
            _ASUM[key] = DF.autosum(key)
        except SystemExit:
            raise
        except Exception as e:
            print(f'  ※ {key} 자동 요약 계산 실패 — 지난 요약 유지: {e!r}')
            path = next(r['path'] for r in ROUTES if r['tab'] == tab)
            old = os.path.join(ROOT, path, 'index.html')
            m = re.search(r'<!--AUTOSUM:%s-->(.*?)<!--/AUTOSUM-->' % key, open(old, encoding='utf-8').read(), re.S) if os.path.isfile(old) else None
            _ASUM[key] = m.group(1) if m else ''
    return _ASUM[key]


def finalize(html_text, tab, en=False):
    """한 페이지 출력: 그 도구 화면만 남기고, 큰 CSS·JS 는 공용 파일로"""
    tabs = re.findall(r'<div class="app-page[^"]*" id="page-([a-z0-9]+)">', html_text)
    if tab not in tabs:
        sys.exit(f'page-{tab} 을 찾지 못했습니다')
    for t in tabs:
        if t != tab:
            a, b = section_span(html_text, t)
            html_text = html_text[:a] + html_text[b:]
    a, b = main_script_span(html_text)
    html_text = html_text[:a] + f'<script src="{ASSET["js"]}"></script>' + html_text[b:]
    a, b = style_span(html_text)
    html_text = html_text[:a] + f'<link rel="stylesheet" href="{ASSET["css"]}">' + html_text[b:]
    html_text = mod_tags(html_text)   # [MOD] 이 화면만 쓰는 코드(투자전략 시뮬레이터 등)
    html_text = re.sub(r'<!--HUBGRID:([a-z]+)-->.*?<!--/HUBGRID-->', lambda m: f'<!--HUBGRID:{m.group(1)}-->' + hub_grid(m.group(1), en) + '<!--/HUBGRID-->', html_text, flags=re.S)
    if en:   # 투자 공부 글은 한국어만 — 영어판 상단 메뉴에서 뺌
        html_text, k = re.subn(r'\s*<!-- \[LEARN\] 투자 공부 글 모음.*?<div class="tab-group" id="grp-learn">.*?</div>', '', html_text, count=1, flags=re.S)
        if not k:
            sys.exit('상단 메뉴 grp-learn 을 찾지 못했습니다')
        html_text, k = re.subn(r'\s*<!-- \[LEARN-DROP\].*?<div class="tab-dropdown" id="grp-learn-drop">.*?</div>', '', html_text, count=1, flags=re.S)
        if not k:
            sys.exit('투자 공부 드롭다운 grp-learn-drop 을 찾지 못했습니다')
    else:
        html_text = re.sub(r'<!--IDXNOTE:([a-z0-9]+)-->.*?<!--/IDXNOTE-->', lambda m: f'<!--IDXNOTE:{m.group(1)}-->' + idx_note(m.group(1)) + '<!--/IDXNOTE-->', html_text, flags=re.S)
        html_text = re.sub(r'<!--AUTOSUM:([a-z]+)-->.*?<!--/AUTOSUM-->', lambda m: f'<!--AUTOSUM:{m.group(1)}-->' + autosum(m.group(1), tab) + '<!--/AUTOSUM-->', html_text, flags=re.S)
        rel = BL.related_block(ARTS, PATH_OF.get(tab, ''))
        if rel:
            html_text = html_text.replace(f'<!-- /page-{tab} -->', rel + f'  <!-- /page-{tab} -->', 1) if f'<!-- /page-{tab} -->' in html_text else html_text
        html_text = re.sub(r'<!--LEARNLIST-->.*?<!--/LEARNLIST-->', lambda m: '<!--LEARNLIST-->' + learn_cards(ARTS, 6) + '<!--/LEARNLIST-->', html_text, flags=re.S)
        html_text = re.sub(r'<!--LEARNHUB:([a-z]+)-->.*?<!--/LEARNHUB-->', lambda m: f'<!--LEARNHUB:{m.group(1)}-->' + learn_hub(m.group(1)) + '<!--/LEARNHUB-->', html_text, flags=re.S)
    html_text, n = re.subn(r'<!--FOOTMAP-->.*?<!--/FOOTMAP-->', lambda m: '<!--FOOTMAP-->' + footmap(en) + '<!--/FOOTMAP-->', html_text, count=1, flags=re.S)
    if n != 1:
        sys.exit('<!--FOOTMAP--> 표시를 찾지 못했습니다')
    html_text, n = re.subn(r'<!--SNSLINKS-->.*?<!--/SNSLINKS-->', lambda m: '<!--SNSLINKS-->' + SO.links(en) + '<!--/SNSLINKS-->', html_text, count=1, flags=re.S)
    if n != 1:
        sys.exit('<!--SNSLINKS--> 표시(하단 SNS 바로가기)를 찾지 못했습니다')
    if tab in NOADS:
        html_text, n = ADS_RE.subn('', html_text, count=1)
        if n != 1:
            sys.exit(f'{tab}: 빼야 할 애드센스 스크립트를 찾지 못했습니다 (src/index.html [ADSENSE] 줄이 바뀌었으면 ADS_RE 를 맞춰 주세요)')
    return html_text


# ───────────── 영어 페이지 (/en/<도구>/) ─────────────
TOP_A, TOP_B = '<div class="wrap">', '<!-- ── 홈 (메인 화면) ── [HOME] ── -->'
BOT_A = '<!-- ── 카카오톡 바로가기 (오른쪽 아래 공유 버튼 위'   # 하단 공통 영역 시작(카카오 버튼·푸터·드롭다운 메뉴) — 영어판 번역 범위
KO = re.compile(r'[가-힣]')
_missing = set()


def tr_text(t):
    core = t.strip()
    if not core or not KO.search(core):
        return t
    if core in EN['text']:
        i = t.index(core)
        return t[:i] + EN['text'][core] + t[i + len(core):]
    _missing.add(core)
    return t


def translate_html(frag):
    """스크립트·스타일·주석을 뺀 나머지의 글자 덩어리와 일부 속성(title·aria-label·placeholder)만 바꿈"""
    # translate="no" 인 짧은 span(일부러 남기는 한국어 원어)은 번역하지 않음 — 같은 글자가 메뉴 등 다른 곳에서는 번역되도록
    parts = re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<!--.*?-->|<span\b[^>]*\btranslate="no"[^>]*>[^<]*</span>)', frag, flags=re.S)
    for i in range(0, len(parts), 2):
        seg = re.sub(r'>([^<>]+)<', lambda m: '>' + tr_text(m.group(1)) + '<', parts[i])
        seg = re.sub(r'((?:title|aria-label|placeholder)=")([^"]*)(")', lambda m: m.group(1) + tr_text(m.group(2)) + m.group(3), seg)
        parts[i] = seg
    return ''.join(parts)


def section_span(src, tab):
    """page-<tab> 의 여는 태그부터 짝이 맞는 닫는 </div> 까지 (시작, 끝) 위치"""
    m = re.search(r'<div class="app-page[^"]*" id="page-%s">' % tab, src)
    if not m:
        sys.exit(f'page-{tab} 을 찾지 못했습니다')
    i, depth = m.end(), 1
    for t in re.finditer(r'<div\b|</div>', src[i:]):
        depth += 1 if t.group(0) == '<div' else -1
        if depth == 0:
            return m.start(), i + t.end()
    sys.exit(f'page-{tab} 닫는 태그를 찾지 못했습니다')


def check_structure(src):
    """원본 HTML 구조 검사 — 화면(app-page)마다 여는·닫는 태그 짝이 맞고, 화면끼리 형제로 나란히 있어야 함.
    닫는 </div> 가 하나라도 남으면 바깥 .container 가 일찍 닫혀 그 뒤 모든 화면이 화면 폭 전체로 퍼짐(2026-10 재산세 FAQ 사고)."""
    body = re.sub(r'<script\b.*?</script>|<style\b.*?</style>', lambda m: ' ' * len(m.group(0)), src, flags=re.S)
    starts = [m for m in re.finditer(r'<div class="app-page[^"]*" id="page-([a-z0-9]+)">', body)]
    errs = []
    for k, m in enumerate(starts):
        tab = m.group(1)
        a, b = section_span(body, tab)
        nxt = starts[k + 1].start() if k + 1 < len(starts) else None
        gap = body[b:nxt] if nxt is not None else body[b:body.index('</div>', b) + 6]
        rest = re.sub(r'<!--.*?-->|\s', '', gap, flags=re.S)
        if nxt is not None and rest:
            errs.append(f'page-{tab}: 화면이 일찍 닫힘(짝 없는 </div>) — 뒤에 남은 내용: {rest[:80]}')
        if nxt is None and rest != '</div>':
            errs.append(f'page-{tab}(마지막): 화면 묶음(.container) 닫힘이 맞지 않음 — {rest[:80]}')
        seg = body[a:b]
        for t in ('details', 'section', 'table', 'label', 'summary', 'article', 'nav', 'ul', 'ol', 'p'):
            o, c = len(re.findall(r'<%s\b' % t, seg)), len(re.findall(r'</%s>' % t, seg))
            if o != c:
                errs.append(f'page-{tab}: <{t}> 여는 {o}개 · 닫는 {c}개')
    if errs:
        sys.exit('원본 HTML 구조 오류:\n  ' + '\n  '.join(errs))


def english_page(html):
    out = html.replace('<html lang="ko">', '<html lang="en">', 1)
    # 영어판이 있는 도구 화면: 설명글은 영어판으로 통째로, 나머지 글자는 사전으로
    for x in ROUTES:
        if 'en' not in x:
            continue
        a, b = section_span(out, x['tab'])
        sec = out[a:b]
        g = EN['guides'].get(x['path'])
        if g:
            sec, n = re.subn(r'<!-- \[GUIDE:%s\].*?<!-- \[/GUIDE:%s\] -->\n' % (x['tab'], x['tab']), lambda m: g, sec, count=1, flags=re.S)
        gb = EN.get('guidebooks', {}).get(x['path'])          # 가이드북(있으면) 도 영어판으로 통째로
        if gb:
            sec, n = re.subn(r'    <!-- \[GUIDEBOOK:%s\].*?<!-- \[/GUIDEBOOK:%s\] -->\n' % (x['tab'], x['tab']), lambda m: gb, sec, count=1, flags=re.S)
            if n != 1:
                sys.exit(f'{x["path"]}: 영어 가이드북으로 바꿀 [GUIDEBOOK] 구간을 찾지 못했습니다')
        out = out[:a] + translate_html(sec) + out[b:]
    # 상단(방문자 수·메뉴)과 하단(후원·푸터·드롭다운 메뉴)
    a, b = out.index(TOP_A), out.index(TOP_B)
    out = out[:a] + translate_html(out[a:b]) + out[b:]
    a, b = out.index(BOT_A), out.index('</body>')
    out = out[:a] + translate_html(out[a:b]) + out[b:]
    return out


STATIC = ('about', 'terms', 'disclaimer', 'privacy')   # 탭이 아닌 독립 페이지(사람이 쓴 HTML) — 공유 미리보기·소개 페이지 도구 목록만 빌드가 채움


def about_map():
    """[ABOUTMAP] 소개 페이지의 '사이트 구성' — 상단 메뉴와 같은 자료(DROP)로 만들어 도구가 늘거나 바뀌면 함께 바뀜"""
    by = {x['tab']: x for x in ROUTES}
    items = []
    for g, name in AREA.items():
        links, idx = [], []
        for sec, tabs in DROP.get(g, []):
            rs = [by[t] for t in tabs if t in by and t not in ADMIN]
            if '지수 성장률' in sec:   # 지수 20쪽은 이름만 묶어서
                idx += rs
                continue
            links += [f'<a href="/{esc(r["path"])}/">{esc(NAV_LABEL[r["tab"]])}</a>' for r in rs]
        if idx:
            links.append(f'지수 성장률 {len(idx)}개(' + '·'.join(esc(NAV_LABEL[r["tab"]].replace(" 성장률", "")) for r in idx[:4]) + ' 등)')
        n = len(links) - (1 if idx else 0) + len(idx)
        if not n:
            continue
        head = f'<a href="/{esc(HUB[g]["path"])}/">{esc(name)}</a>' if g in HUB else esc(name)
        items.append(f'<li><b>{head}</b> <small>{n}개</small><br><span class="tools">{" · ".join(links)}</span></li>')
    if ARTS:
        extra = f' · <a href="/books/">자본가 서재</a> <small>추천 도서 {len(BOOKS["books"])}권</small>' if BOOKS else ''
        items.insert(0, f'<li><b><a href="/learn/">투자 공부</a></b> <small>글 {len(ARTS)}편</small>{extra}<br><span class="tools">'
                        + ' · '.join(f'<a href="/learn/{esc(a["slug"])}/">{esc(a.get("short") or a["title"].split(" — ")[0])}</a>' for a in ARTS) + '</span></li>')
    return '<ul class="amap">' + ''.join(items) + '</ul>'


def static_pages():
    """독립 페이지: <!--OG--> 공유 미리보기(제목·설명·대표 이미지) + 소개 페이지 <!--ABOUTMAP--> 도구 목록"""
    img = og_image(HOME)
    for d in STATIC:
        f = os.path.join(ROOT, d, 'index.html')
        if not os.path.isfile(f):
            sys.exit(f'{d}/index.html 이 없습니다')
        s = open(f, encoding='utf-8').read()
        t = re.search(r'<title>(.*?)</title>', s, re.S)
        ds = re.search(r'<meta name="description" content="([^"]*)">', s)
        cu = re.search(r'<link rel="canonical" href="([^"]*)">', s)
        if not (t and ds and cu):
            sys.exit(f'{d}/index.html: title·description·canonical 중 없는 것이 있습니다')
        title, desc, url = html.unescape(t.group(1)), html.unescape(ds.group(1)), html.unescape(cu.group(1))
        og = '\n'.join([
            '<!--OG-->',
            '<meta property="og:type" content="website">',
            f'<meta property="og:site_name" content="{esc(BRAND)}">',
            '<meta property="og:locale" content="ko_KR">',
            f'<meta property="og:title" content="{esc(title)}">',
            f'<meta property="og:description" content="{esc(desc)}">',
            f'<meta property="og:url" content="{esc(url)}">',
            f'<meta property="og:image" content="{esc(img)}">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{esc(title)}">',
            f'<meta name="twitter:description" content="{esc(desc)}">',
            f'<meta name="twitter:image" content="{esc(img)}">',
            '<!--/OG-->'])
        s, n = re.subn(r'<!--OG-->.*?<!--/OG-->', lambda m: og, s, flags=re.S)
        if n != 1:
            sys.exit(f'{d}/index.html: <!--OG--><!--/OG--> 표시가 1개가 아닙니다 ({n}개)')
        s, n = re.subn(r'<!--SNSLINKS-->.*?<!--/SNSLINKS-->', lambda m: '<!--SNSLINKS-->' + SO.links() + '<!--/SNSLINKS-->', s, flags=re.S)
        s, k = re.subn(r'/\*SNSCSS\*/.*?/\*/SNSCSS\*/', lambda m: '/*SNSCSS*/\n' + SO.CSS + '  /*/SNSCSS*/', s, flags=re.S)
        if n != 1 or k != 1:
            sys.exit(f'{d}/index.html: 하단 SNS 바로가기 표시(<!--SNSLINKS-->)·CSS 표시(/*SNSCSS*/)가 1개씩이 아닙니다 ({n}·{k})')
        if d == 'about':
            s, n = re.subn(r'<!--ABOUTMAP-->.*?<!--/ABOUTMAP-->', lambda m: '<!--ABOUTMAP-->' + about_map() + '<!--/ABOUTMAP-->', s, flags=re.S)
            if n != 1:
                sys.exit('about/index.html: <!--ABOUTMAP--> 표시가 없습니다')
        write_if_changed(f'{d}/index.html', s)


def write_if_changed(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    old = open(full, encoding='utf-8').read() if os.path.exists(full) else None
    if old != text:
        with open(full, 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
        print('  저장', path)
        return True
    return False


def main():
    src = open(SRC, encoding='utf-8').read()
    src = fill_icons(src)
    check_structure(src)
    load_nav_labels(src)
    load_drop_tree(src)
    # 원본에 이미 들어 있는 하위 페이지 표시(앞선 빌드 결과)가 있으면 루트 기준으로 되돌린 뒤 시작
    make_assets(src)
    make_mod_assets(src)
    home = with_head(src, HOME)
    write_if_changed('index.html', finalize(home, HOME['tab']))
    paths = set()
    for r in ROUTES:
        if r['path'] in paths or not re.fullmatch(r'[a-z0-9-]+', r['path']):
            sys.exit(f"경로 오류: {r['path']}")
        paths.add(r['path'])
        write_if_changed(f"{r['path']}/index.html", finalize(activate(with_head(home, r), r), r['tab']))
        if 'en' in r:
            write_if_changed(f"en/{r['path']}/index.html", finalize(english_page(activate(with_head(home, r, 'en'), r)), r['tab'], en=True))
    # 예전 빌드에 있었으나 routes.json 에서 빠진 경로 정리
    marker = '<meta name="etfmd-route" content="'
    for d in sorted(os.listdir(ROOT)):
        f = os.path.join(ROOT, d, 'index.html')
        if d not in paths and d != 'src' and os.path.isfile(f) and marker in open(f, encoding='utf-8').read(8192 * 4):
            os.remove(f)
            print('  삭제', f'{d}/index.html')
    en_paths = {r['path'] for r in ROUTES if 'en' in r}
    if os.path.isdir(os.path.join(ROOT, 'en')):
        for d in sorted(os.listdir(os.path.join(ROOT, 'en'))):
            f = os.path.join(ROOT, 'en', d, 'index.html')
            if d not in en_paths and os.path.isfile(f):
                os.remove(f)
                print('  삭제', f'en/{d}/index.html')
    if _missing:
        print(f'  ※ 영어 번역이 없는 문구 {len(_missing)}개 (자동 번역으로 보임 — scripts/i18n/make_en.py 에 추가):')
        for t in sorted(_missing)[:40]:
            print('     ·', t[:70])
    # 투자 공부 글 (src 의 [ANALYTICS] 스크립트를 그대로 넣어 방문 집계)
    am = re.search(r'<script>\n/\* \[ANALYTICS\].*?</script>', src, re.S)
    if not am:
        sys.exit('[ANALYTICS] 스크립트를 찾지 못했습니다')
    learn_urls = BL.write_all(ARTS, SITE, ROUTES, am.group(0), write_if_changed, books=BOOKS) if ARTS else []
    learn_urls += BB.write_page(BOOKS, SITE, am.group(0), write_if_changed)   # 자본가 서재 /books/
    ldir = os.path.join(ROOT, 'learn')
    if os.path.isdir(ldir):   # 원본에서 빠진 글 정리
        for d in sorted(os.listdir(ldir)):
            f = os.path.join(ldir, d, 'index.html')
            if os.path.isfile(f) and d not in {a['slug'] for a in ARTS}:
                os.remove(f); print('  삭제', f'learn/{d}/index.html')
    today = datetime.date.today().isoformat()
    urls = ''.join(f'  <url><loc>{esc(SITE + (r["path"] + "/" if r["path"] else ""))}</loc><lastmod>{today}</lastmod>'
                   f'<changefreq>{"daily" if not r["path"] else "weekly"}</changefreq><priority>{"1.0" if not r["path"] else "0.9" if r.get("hub") else "0.8"}</priority></url>\n'
                   for r in ALL if not r.get('admin') and not r.get('noindex'))
    for u, lm in learn_urls:
        urls += f'  <url><loc>{esc(u)}</loc><lastmod>{lm}</lastmod><changefreq>monthly</changefreq><priority>{"0.9" if u.endswith("/learn/") else "0.8"}</priority></url>\n'
    for r in ROUTES:   # 영어판 페이지
        if 'en' in r:
            urls += f'  <url><loc>{esc(url_of(r, "en"))}</loc><lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n'
    # 탭이 아닌 독립 페이지(개인정보처리방침 등): 공유 미리보기·소개 도구 목록을 채우고 sitemap 에 포함
    static_pages()
    for extra in STATIC:
        if os.path.isfile(os.path.join(ROOT, extra, 'index.html')):
            urls += f'  <url><loc>{esc(SITE + extra + "/")}</loc><lastmod>{today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>\n'
    sitemap = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'
    old = open(os.path.join(ROOT, 'sitemap.xml'), encoding='utf-8').read() if os.path.exists(os.path.join(ROOT, 'sitemap.xml')) else ''
    if re.sub(r'<lastmod>[^<]*</lastmod>', '', old) != re.sub(r'<lastmod>[^<]*</lastmod>', '', sitemap):
        write_if_changed('sitemap.xml', sitemap)          # 주소 목록이 바뀔 때만 (날짜만 바뀌는 커밋 방지)
    write_if_changed('robots.txt', f'User-agent: *\nAllow: /\nDisallow: /src/\nDisallow: /auth/\nDisallow: /saved/\n\nSitemap: {SITE}sitemap.xml\n')
    write_if_changed('404.html', f'''<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>페이지를 찾을 수 없습니다 | {esc(BRAND)}</title>
<script>location.replace({json.dumps(SITE)});</script></head>
<body style="font-family:sans-serif;background:#111;color:#ddd;text-align:center;padding:60px 16px;">
<p>페이지를 찾을 수 없습니다. <a href="{esc(SITE)}" style="color:#3182f6;">{esc(BRAND)} 홈으로 이동</a></p></body></html>
''')
    print(f'완료 — 주소 {len(ALL)}개 + 영어 {sum(1 for r in ROUTES if "en" in r)}개 + 투자 공부 {len(learn_urls)}쪽 · {SITE}')


if __name__ == '__main__':
    main()
