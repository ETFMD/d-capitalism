#!/usr/bin/env python3
"""
'투자 공부' 글 모음 — content/learn/*.html(원본) → learn/index.html(목록) · learn/<글>/index.html(글)

원본 형식 (파일 맨 위 한 줄 = 글 정보 JSON, 그 아래 = 본문 HTML 조각)
  <!--{"slug":"compound-interest","title":"…","desc":"…(80자 이하)","cat":"invest","date":"2026-10-17","updated":"2026-10-17",
       "tools":["compound","cagr"],"order":3}-->
  <p class="lead">…</p>
  <h2>…</h2> …

· scripts/build_pages.py 가 불러 씀: load() → 글 목록 · write_all() → 글·목록 페이지 쓰기 · related(경로) → 도구 페이지 아래 '함께 읽으면 좋은 글'
· 본문 안 링크(/경로/)는 routes.json 의 도구 주소나 다른 글 주소여야 함 — 없는 주소면 빌드 실패(깨진 링크 방지)
· 모든 글: 작성자·작성일·수정일·읽는 시간·목차·관련 계산기·다른 글·출처/면책 — 표준 라이브러리만
"""
import html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import data_facts as DF   # 본문 {{키}} → data/*.json 최신 값 (자동 갱신)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC_DIR = os.path.join(ROOT, 'content', 'learn')
OUT_DIR = 'learn'
AUTHOR = '아키텍트'
CATS = [('capital', '자본주의 이해'), ('invest', '지수·ETF 투자'), ('company', '기업·실적 읽기'), ('tax', '세금·절세'), ('plan', '은퇴·자산 계획')]
CAT_NAME = dict(CATS)


def esc(t):
    return html.escape(str(t), quote=True)


def plain(t):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t))).strip()


def load():
    """원본 글 목록 (order 순) — 형식 오류는 빌드 실패"""
    arts = []
    if not os.path.isdir(SRC_DIR):
        return arts
    facts = asof = None
    for fn in sorted(os.listdir(SRC_DIR)):
        if not fn.endswith('.html'):
            continue
        raw = open(os.path.join(SRC_DIR, fn), encoding='utf-8').read()
        m = re.match(r'\s*<!--(\{.*?\})-->\s*', raw, re.S)
        if not m:
            sys.exit(f'글 정보(JSON 주석)가 없습니다: content/learn/{fn}')
        meta = json.loads(m.group(1))
        for k in ('slug', 'title', 'desc', 'cat', 'date', 'tools'):
            if not meta.get(k):
                sys.exit(f'글 정보 {k} 가 없습니다: {fn}')
        if meta['cat'] not in CAT_NAME:
            sys.exit(f'알 수 없는 분류 {meta["cat"]}: {fn}')
        if not re.fullmatch(r'[a-z0-9-]+', meta['slug']):
            sys.exit(f'slug 형식 오류: {meta["slug"]}')
        if len(meta['desc']) > 80:
            sys.exit(f'설명이 80자를 넘습니다({len(meta["desc"])}자): {fn}')
        body = raw[m.end():].strip()
        if '{{' in body:   # 자동 갱신 숫자: 자료 기준일을 글에 표시 · 검색엔진 수정일(dateModified)·sitemap lastmod 도 그날로
            if facts is None:
                try:
                    facts, asof = DF.learn_facts()
                except Exception as e:   # 데이터 파일 이상(봇 실패 등) — 사이트 빌드 전체를 멈추지 않고 이 글들은 지난 페이지를 그대로 둠
                    print(f'  ※ 자동 숫자 자료를 읽지 못해 자동 숫자 글은 지난 페이지를 유지: {e!r}')
                    facts, asof = {}, None
            if facts:
                body = DF.fill(body, facts, where=f'content/learn/{fn}')
                meta['asof'] = asof
            else:
                DF.fill(body, {k: '' for k in re.findall(r'\{\{([a-zA-Z0-9_.]+)\}\}', body)})
                body = re.sub(r'\{\{[a-zA-Z0-9_.]+\}\}', '—', body)
                meta['stale'] = True
        meta['body'] = body
        meta['chars'] = len(plain(body).replace(' ', ''))
        meta.setdefault('updated', meta['date'])
        meta['mod'] = max(meta['updated'], meta.get('asof') or '')   # 검색엔진 수정일 = 글 수정일과 자동 숫자 기준일 중 늦은 날
        meta.setdefault('order', 999)
        arts.append(meta)
    slugs = [a['slug'] for a in arts]
    if len(set(slugs)) != len(slugs):
        sys.exit('글 slug 중복')
    arts.sort(key=lambda a: (a['order'], a['slug']))
    return arts


def related(arts, path):
    """도구 경로 → 그 도구를 쓰는 글 목록"""
    return [a for a in arts if path in a['tools']]


def _toc(body):
    """<h2> 에 id 를 붙이고 목차 만들기"""
    items, n = [], [0]

    def rep(m):
        n[0] += 1
        attrs, inner = m.group(1) or '', m.group(2)
        hid = re.search(r'id="([^"]+)"', attrs)
        hid = hid.group(1) if hid else f's{n[0]}'
        items.append((hid, plain(inner)))
        if 'id=' not in attrs:
            attrs = f' id="{hid}"' + attrs
        return f'<h2{attrs}>{inner}</h2>'
    body = re.sub(r'<h2(\s[^>]*)?>(.*?)</h2>', rep, body, flags=re.S)
    return body, items


CSS = '''
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  :root { --bg:#101013; --bg2:#17171c; --bg3:#1e1e24; --border:rgba(255,255,255,.08); --text:#e4e4e5; --text2:#a9a9b0; --text3:#6f6f78; --accent:#3182f6; --accent-dim:rgba(49,130,246,.12); --warn:#f5a524; --up:#f04452; }
  html[data-theme="light"] { --bg:#f2f4f6; --bg2:#ffffff; --bg3:#f7f8fa; --border:rgba(0,27,55,.10); --text:#191f28; --text2:#4e5968; --text3:#8b95a1; --accent-dim:rgba(49,130,246,.08); }
  html { scroll-behavior:smooth; }
  body { background:var(--bg); color:var(--text); font-family:'Noto Sans KR',sans-serif; font-size:16px; line-height:1.85; word-break:keep-all; overflow-wrap:anywhere; }
  a { color:var(--accent); }
  .top { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid var(--border); }
  .top-in { max-width:1040px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:14px; }
  .logo { display:flex; align-items:center; gap:8px; font-weight:700; font-size:16px; color:var(--text); text-decoration:none; white-space:nowrap; }
  .logo img { width:28px; height:28px; border-radius:7px; }
  .tnav { display:flex; gap:4px; overflow-x:auto; scrollbar-width:none; margin-left:auto; }
  .tnav::-webkit-scrollbar { display:none; }
  .tnav a { font-size:13px; color:var(--text2); text-decoration:none; padding:6px 10px; border-radius:8px; white-space:nowrap; }
  .tnav a:hover, .tnav a.on { color:var(--text); background:var(--accent-dim); }
  .tnav a.on { color:var(--accent); font-weight:600; }
  .wrap { max-width:760px; margin:0 auto; padding:28px 16px 64px; }
  .crumb { font-size:12.5px; color:var(--text3); margin-bottom:14px; }
  .crumb a { color:var(--text3); text-decoration:none; } .crumb a:hover { color:var(--accent); }
  .cat { display:inline-block; font-size:12px; font-weight:600; color:var(--accent); background:var(--accent-dim); border-radius:999px; padding:3px 10px; margin-bottom:10px; text-decoration:none; }
  h1 { font-size:28px; line-height:1.4; font-weight:700; margin-bottom:10px; letter-spacing:-.3px; }
  .meta { font-size:13px; color:var(--text3); margin-bottom:22px; }
  .meta .auto { color:var(--accent); }
  .lead { font-size:16.5px; color:var(--text); background:var(--bg2); border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:12px; padding:16px 18px; margin:0 0 22px; }
  .toc { background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:14px 18px; margin:0 0 28px; font-size:14px; }
  .toc b { display:block; font-size:13px; color:var(--text3); font-weight:600; margin-bottom:6px; }
  .toc ol { padding-left:20px; } .toc li { margin:3px 0; color:var(--text2); } .toc a { color:var(--text2); text-decoration:none; } .toc a:hover { color:var(--accent); }
  article h2 { font-size:21px; line-height:1.45; font-weight:700; margin:40px 0 12px; scroll-margin-top:70px; letter-spacing:-.2px; }
  article h3 { font-size:17px; font-weight:700; margin:26px 0 8px; }
  article p { color:var(--text2); margin:0 0 14px; }
  article ul, article ol { padding-left:22px; margin:0 0 14px; color:var(--text2); }
  article li { margin:5px 0; }
  article b, article strong { color:var(--text); font-weight:600; }
  .tbl { overflow-x:auto; margin:6px 0 18px; border:1px solid var(--border); border-radius:12px; }
  table { width:100%; border-collapse:collapse; font-size:14px; background:var(--bg2); }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--border); vertical-align:top; color:var(--text2); }
  th { color:var(--text); font-weight:600; background:var(--bg3); white-space:nowrap; }
  td.n, th.n { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  .note { font-size:12.5px; color:var(--text3); margin:-10px 0 18px; }
  .box { border-radius:12px; padding:14px 16px; margin:18px 0; border:1px solid var(--border); background:var(--bg2); }
  .box p:last-child, .box ul:last-child { margin-bottom:0; }
  /* 그림(인라인 SVG) — 색은 테마 변수를 따름 · 좁은 화면에서도 글자가 읽히게 세로형(viewBox 폭 360)으로 그림 */
  .fig { margin:18px 0 22px; text-align:center; }
  .fig svg { width:100%; max-width:480px; height:auto; font-family:inherit; }
  .fig .bx { fill:var(--bg2); stroke:var(--border); stroke-width:1.2; }
  .fig .bx.hl { fill:var(--accent-dim); stroke:var(--accent); }
  .fig .bx.warn { fill:rgba(245,165,36,.10); stroke:rgba(245,165,36,.55); }
  .fig .bx.key { fill:var(--bg3); stroke:var(--border); }
  .fig .ln { stroke:var(--text3); stroke-width:1.5; fill:none; }
  .fig .t { fill:var(--text); font-size:13px; }
  .fig .t.b { font-weight:700; font-size:14px; }
  .fig .t.s { font-size:11.5px; fill:var(--text2); }
  .fig .t.m { fill:var(--text3); }
  .fig figcaption { font-size:13px; color:var(--text3); line-height:1.6; margin-top:8px; text-align:left; }
  .box ul, .box ol { padding-left:22px; margin:8px 0 0; color:var(--text2); } .box li { margin:5px 0; } .box li::marker { color:var(--text3); }
  .box.key { border-color:rgba(49,130,246,.4); background:var(--accent-dim); }
  .box.warn { border-color:rgba(245,165,36,.45); background:rgba(245,165,36,.07); }
  .box > b:first-child { display:block; margin-bottom:6px; color:var(--text); }
  .formula { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:14px; background:var(--bg3); border:1px solid var(--border); border-radius:10px; padding:10px 14px; margin:6px 0 16px; color:var(--text); overflow-x:auto; white-space:nowrap; }
  .tools { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin:10px 0 0; }
  .tool { display:block; background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:12px 14px; text-decoration:none; }
  .tool:hover { border-color:rgba(49,130,246,.5); }
  .tool b { display:block; color:var(--text); font-size:14.5px; margin-bottom:2px; }
  .tool span { display:block; color:var(--text3); font-size:12.5px; line-height:1.6; }
  .sec-h { font-size:18px; font-weight:700; margin:44px 0 6px; }
  .more { list-style:none; padding:0; margin:8px 0 0; }
  .more li { border-bottom:1px solid var(--border); }
  .more a { display:block; padding:11px 2px; text-decoration:none; color:var(--text); font-size:15px; }
  .more a small { display:block; color:var(--text3); font-size:12.5px; margin-top:2px; }
  .more a:hover { color:var(--accent); }
  .disc { margin-top:36px; font-size:12.5px; color:var(--text3); background:var(--bg2); border:1px solid var(--border); border-radius:12px; padding:12px 14px; line-height:1.75; }
  .list-cat { margin:34px 0 8px; font-size:18px; font-weight:700; }
  .cards { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
  .card { display:block; background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:16px 18px; text-decoration:none; }
  .card:hover { border-color:rgba(49,130,246,.5); }
  .card b { display:block; color:var(--text); font-size:16px; line-height:1.5; margin-bottom:6px; }
  .card span { display:block; color:var(--text2); font-size:13.5px; line-height:1.7; }
  .card small { display:block; color:var(--text3); font-size:12px; margin-top:8px; }
  footer { margin-top:48px; padding-top:18px; border-top:1px solid var(--border); font-size:12px; color:var(--text3); text-align:center; }
  footer a { color:var(--text3); white-space:nowrap; }
  @media (max-width:640px) {
    body { font-size:15.5px; }
    h1 { font-size:23px; }
    article h2 { font-size:19px; }
    .tools, .cards { grid-template-columns:1fr; }
    .tnav { margin-left:0; }
    .top-in { gap:8px; }
    .logo span { display:none; }
  }
'''

NAV = [('', '홈'), ('learn/', '투자 공부'), ('my-position/', '내 위치'), ('labor/', '노동자'), ('invest/', '투자'),
       ('real-estate/', '부동산'), ('capitalist/', '자본가'), ('passive-income/', '불로소득')]


def _head(site, title, desc, url, analytics, extra_ld):
    theme = ('(function(){try{var m=localStorage.getItem("site-theme")||"dark";var l=m==="light"||(m==="auto"&&window.matchMedia&&'
             'matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.setAttribute("data-theme",l?"light":"dark");}'
             'catch(e){document.documentElement.setAttribute("data-theme","dark");}})();')
    return f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<!-- [ADSENSE] Google 애드센스 (사이트 소유 확인 · 광고) -->
<meta name="google-adsense-account" content="ca-pub-8051182229751523">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8051182229751523" crossorigin="anonymous"></script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="디코딩 자본주의">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:image" content="{esc(site)}assets/og/home.png">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/logo-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
<script>{theme}</script>
{analytics}
<script type="application/ld+json">{json.dumps(extra_ld, ensure_ascii=False)}</script>
<style>{CSS}</style>
</head>
<body>
'''


def _top(active):
    on = ' class="on"'
    links = ''.join(f'<a href="/{p}"{on if p == active else ""}>{esc(n)}</a>' for p, n in NAV)
    return (f'<header class="top"><div class="top-in"><a class="logo" href="/"><img src="/assets/logo-96.png" alt="" width="28" height="28">'
            f'<span>디코딩 자본주의</span></a><nav class="tnav" aria-label="사이트 메뉴">{links}</nav></div></header>\n')


FOOT = ('<footer><a href="/">홈</a> · <a href="/learn/">투자 공부</a> · <a href="/about/">소개</a> · <a href="/terms/">이용약관</a> · '
        '<a href="/disclaimer/">투자 면책</a> · <a href="/privacy/">개인정보처리방침</a><br>© 디코딩 자본주의 · 운영자 아키텍트 · '
        '문의 <a href="mailto:gusrudgma@gmail.com">gusrudgma@gmail.com</a></footer>')


def tool_name(r):
    if r.get('short'): return r['short']
    return re.sub(r'^디코딩 자본주의 \| ', '', r['title']).split(' — ')[0]


def _ymd(d):
    y, m, dd = d.split('-')
    return f'{int(y)}년 {int(m)}월 {int(dd)}일'


def _check_links(body, slug, valid):
    for href in re.findall(r'href="([^"]+)"', body):
        if href.startswith(('http://', 'https://', 'mailto:', '#')):
            continue
        p = href.strip('/').split('#')[0]
        if p not in valid:
            sys.exit(f'글 {slug}: 없는 주소로 가는 링크 {href}')


def write_all(arts, site, routes, analytics, write):
    """글·목록 페이지 쓰기 → [(주소, 수정일)]"""
    by_path = {r['path']: r for r in routes}
    valid = set(by_path) | {'learn'} | {f'learn/{a["slug"]}' for a in arts} | {'', 'about', 'terms', 'disclaimer', 'privacy'}
    urls = []
    for a in arts:
        _check_links(a['body'], a['slug'], valid)
        for t in a['tools']:
            if t not in by_path:
                sys.exit(f'글 {a["slug"]}: 관련 도구 주소 {t} 가 routes.json 에 없음')
        url = f'{site}learn/{a["slug"]}/'
        body, toc = _toc(a['body'])
        mins = max(3, round(a['chars'] / 600))
        ld = [{'@context': 'https://schema.org', '@type': 'Article', 'headline': a['title'], 'description': a['desc'],
               'datePublished': a['date'], 'dateModified': a['mod'], 'inLanguage': 'ko-KR', 'mainEntityOfPage': url,
               'author': {'@type': 'Person', 'name': AUTHOR, 'url': f'{site}about/'},
               'publisher': {'@type': 'Organization', 'name': '디코딩 자본주의', 'logo': {'@type': 'ImageObject', 'url': f'{site}assets/logo-512.png'}}},
              {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
                  {'@type': 'ListItem', 'position': 1, 'name': '홈', 'item': site},
                  {'@type': 'ListItem', 'position': 2, 'name': '투자 공부', 'item': f'{site}learn/'},
                  {'@type': 'ListItem', 'position': 3, 'name': a['title'], 'item': url}]}]
        tools = ''.join(f'<a class="tool" href="/{esc(t)}/"><b>{esc(tool_name(by_path[t]))}</b>'
                        f'<span>{esc(by_path[t]["desc"])}</span></a>' for t in a['tools'])
        same = [b for b in arts if b['slug'] != a['slug'] and b['cat'] == a['cat']]
        other = same + [b for b in arts if b['slug'] != a['slug'] and b['cat'] != a['cat']]
        more = ''.join(f'<li><a href="/learn/{esc(b["slug"])}/">{esc(b["title"])}<small>{esc(CAT_NAME[b["cat"]])} · {esc(b["desc"])}</small></a></li>' for b in other[:6])
        tochtml = ''.join(f'<li><a href="#{esc(i)}">{esc(t)}</a></li>' for i, t in toc)
        page = (_head(site, f'{a["title"]} | 디코딩 자본주의', a['desc'], url, analytics, ld) + _top('learn/') +
                f'<main class="wrap">\n<nav class="crumb" aria-label="현재 위치"><a href="/">홈</a> › <a href="/learn/">투자 공부</a> › {esc(CAT_NAME[a["cat"]])}</nav>\n'
                f'<a class="cat" href="/learn/#{esc(a["cat"])}">{esc(CAT_NAME[a["cat"]])}</a>\n<h1>{esc(a["title"])}</h1>\n'
                f'<p class="meta">글 <a href="/about/">{AUTHOR}</a> · 작성 {_ymd(a["date"])}' + (f' · 수정 {_ymd(a["updated"])}' if a['updated'] != a['date'] else '') +
                f' · 읽는 데 약 {mins}분' + (f' · <span class="auto">숫자는 {_ymd(a["asof"])} 자료 기준 자동 갱신</span>' if a.get('asof') else '') + '</p>\n'
                + (f'<nav class="toc" aria-label="목차"><b>목차</b><ol>{tochtml}</ol></nav>\n' if len(toc) >= 3 else '') +
                f'<article>\n{body}\n</article>\n'
                f'<h2 class="sec-h">이 글과 함께 쓰는 계산기·자료</h2>\n<div class="tools">{tools}</div>\n'
                f'<h2 class="sec-h">다른 글</h2>\n<ul class="more">{more}</ul>\n'
                f'<p class="disc">이 글은 공부를 돕기 위한 일반적인 설명이며 특정 상품의 매수·매도 권유가 아닙니다. 세법·요율은 바뀔 수 있으니 실제 신고·투자 전에는 '
                f'국세청·금융회사 등 공식 자료를 확인하세요. 글에 쓴 숫자는 표시한 기준일 기준이며, 틀린 곳을 알려 주시면 바로 고칩니다 '
                f'(<a href="mailto:gusrudgma@gmail.com">gusrudgma@gmail.com</a>). 자세한 내용은 <a href="/disclaimer/">투자 면책</a>을 확인하세요.</p>\n'
                f'{FOOT}\n</main>\n</body>\n</html>\n')
        if a.get('stale') and os.path.isfile(os.path.join(ROOT, OUT_DIR, a['slug'], 'index.html')):
            print(f'  ※ learn/{a["slug"]}/ 는 자료 문제로 지난 페이지 유지')
        elif a.get('stale'):
            sys.exit(f'learn/{a["slug"]}: 자동 숫자 자료를 읽지 못했고 지난 페이지도 없음')
        else:
            write(f'{OUT_DIR}/{a["slug"]}/index.html', page)
        urls.append((url, a['mod']))
    # 목록 페이지
    url = f'{site}learn/'
    desc = '노동소득과 자본소득, 복리·CAGR, 지수·레버리지·월배당 ETF, 실적 읽는 법, 절세까지 — 계산기와 함께 읽는 투자 공부 글 모음입니다.'
    secs = ''
    for c, name in CATS:
        xs = [a for a in arts if a['cat'] == c]
        if not xs:
            continue
        cards = ''.join(f'<a class="card" href="/learn/{esc(a["slug"])}/"><b>{esc(a["title"])}</b><span>{esc(a["desc"])}</span>'
                        f'<small>읽는 데 약 {max(3, round(a["chars"] / 600))}분</small></a>' for a in xs)   # 목록에는 날짜를 넣지 않음(작성·수정일은 글 페이지에 그대로)
        secs += f'<h2 class="list-cat" id="{esc(c)}">{esc(name)}</h2>\n<div class="cards">{cards}</div>\n'
    ld = {'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': '투자 공부', 'description': desc, 'url': url, 'inLanguage': 'ko-KR',
          'hasPart': [{'@type': 'Article', 'headline': a['title'], 'url': f'{site}learn/{a["slug"]}/'} for a in arts]}
    total = sum(a['chars'] for a in arts)
    page = (_head(site, '투자 공부 — 노동자에서 자본가로 가는 글 모음 | 디코딩 자본주의', desc, url, analytics, ld) + _top('learn/') +
            '<main class="wrap">\n<nav class="crumb" aria-label="현재 위치"><a href="/">홈</a> › 투자 공부</nav>\n<h1>투자 공부</h1>\n'
            f'<p class="meta">글 {len(arts)}편 · 운영자 <a href="/about/">{AUTHOR}</a>가 직접 쓰고 고칩니다</p>\n'
            '<div class="lead">계산기는 답을 주지만, <b>왜 그런 답이 나오는지</b>는 알려 주지 않습니다. 이곳의 글은 디코딩 자본주의의 계산기와 데이터를 '
            '<b>어떻게 읽고 내 결정에 쓰는지</b>를 처음 공부하는 사람 눈높이로 풀어 씁니다. 모든 글은 공식 통계·공시·실제 시세로 계산한 숫자를 쓰고, '
            '기준일과 출처를 함께 적습니다.</div>\n'
            '<div class="box"><b>글을 쓰는 원칙</b><ul><li>숫자는 사이트가 직접 계산한 값이나 공공기관·거래소·운용사 공식 자료에서 가져오고, 기준일을 적습니다.</li>'
            '<li>좋은 점만 쓰지 않습니다. 위험과 한계, 흔히 하는 착각을 함께 씁니다.</li><li>특정 종목을 사라고 권하지 않습니다. 스스로 판단할 수 있는 기준을 드리는 것이 목표입니다.</li>'
            '<li>세법·제도가 바뀌면 글을 고치고 수정일을 표시합니다.</li></ul></div>\n'
            f'{secs}{FOOT}\n</main>\n</body>\n</html>\n')
    write(f'{OUT_DIR}/index.html', page)
    urls.insert(0, (url, max([a['mod'] for a in arts] or ['2026-10-17'])))
    print(f'  투자 공부 글 {len(arts)}편 · 본문 {total:,}자')
    return urls


def related_block(arts, path):
    """도구 페이지 아래에 넣을 '함께 읽으면 좋은 글' (없으면 빈 문자열)"""
    xs = related(arts, path)
    if not xs:
        return ''
    cards = ''.join(f'<a class="g-card lr-card" href="learn/{esc(a["slug"])}/"><b>{esc(a["title"])}</b><span>{esc(a["desc"])}</span></a>' for a in xs[:4])
    return (f'\n    <!-- [LEARN-REL] 이 도구와 함께 읽으면 좋은 글 (scripts/build_learn.py 가 넣음) -->\n'
            f'    <section class="guide learn-rel" aria-label="함께 읽으면 좋은 글"><h2>함께 읽으면 좋은 글</h2><div class="g-grid">{cards}</div>'
            f'<p class="lr-all"><a href="learn/">투자 공부 글 전체 보기 →</a></p></section>\n')
