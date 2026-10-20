#!/usr/bin/env python3
"""
'자본가 서재' — AI 시대, 노동자에서 자본가로 가는 단계별 추천 도서 (content/books/books.json → books/index.html)

· scripts/build_pages.py 가 불러 씀: load(routes, arts) → 자료(검사 통과한 것만) · write_page(...) → [(주소, 수정일)]
  · build_learn.write_all(books=…) 가 글 페이지에 '이 글과 함께 읽으면 좋은 책'을 넣음 (책의 learn 목록)
· 순위 = 단계 안에서 읽는 순서(운영자 선정 · 선정 기준을 페이지에 공개) — 제휴 수수료와 무관
· 구매 링크(cp, 쿠팡 파트너스 단축 주소 https://link.coupang.com/a/…)
  · 하나라도 있으면 페이지 맨 위(제목 바로 아래)에 경제적 이해관계 문구를 넣음 — 공정위 '추천·보증 등에 관한 표시·광고 심사지침'(2024-12-01 시행: 제목 또는 첫 부분)
  · 단추는 rel="sponsored nofollow noopener" · 새 창 · '최저가' 같은 확인할 수 없는 표현은 쓰지 않음(도서정가제)
  · 링크가 없는 책은 단추를 그리지 않음 (준비 중)
· 책 정보(제목·저자·옮긴이·출판사·출간 연도·ISBN)는 교보문고·예스24 등 판매 페이지로 확인한 값만 (src 출처 주소를 자료에 남김)
· 책 표지: scripts/fetch_book_covers.py 가 받아 둔 books/cover/<id>.webp + content/books/covers.json(가로·세로·버전)
  · 단계마다 표지 책장(단계의 책 7권을 PC 한 줄에 · 휴대폰 3칸씩, 남는 칸은 가운데로) + 책 카드 왼쪽에 큰 표지 · 글 아래 '함께 읽으면 좋은 책'에도 작은 표지(build_learn)
  · 표지가 아직 없는 책은 순위 숫자 상자로 대신 그리고 빌드 기록에 알림 (Actions '자본가 서재 책 표지 갱신'이 받아 오면 다시 빌드됨)
· 표준 라이브러리만
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_learn as BL

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'content', 'books', 'books.json')
COVERS = os.path.join(ROOT, 'content', 'books', 'covers.json')
OUT = 'books'
CP_RE = re.compile(r'^https://link\.coupang\.com/a/[A-Za-z0-9]+$')
LEVEL = {1: '입문', 2: '보통', 3: '깊이'}
esc = BL.esc


def _isbn_ok(s):
    if not re.fullmatch(r'97[89]\d{10}', s):
        return False
    t = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(s[:12]))
    return (10 - t % 10) % 10 == int(s[12])


def load(routes, arts):
    """책 자료 읽기 + 검사 (틀리면 빌드 실패 — 깨진 링크·없는 도구·잘못된 ISBN·순위 빠짐 방지)"""
    if not os.path.isfile(SRC):
        return None
    d = json.load(open(SRC, encoding='utf-8'))
    tools = {r['path']: r for r in routes if not r.get('admin')}
    slugs = {a['slug'] for a in arts}
    st_ids = [s['id'] for s in d['stages']]
    if len(set(st_ids)) != len(st_ids):
        sys.exit('books.json: 단계 id 중복')
    ids = set()
    for s in d['stages']:
        for k in ('id', 'no', 'name', 'q', 'goal'):
            if s.get(k) in (None, ''):
                sys.exit(f'books.json 단계 {s.get("id")}: {k} 없음')
        for t in s.get('tools', []):
            if t not in tools:
                sys.exit(f'books.json 단계 {s["id"]}: 없는(또는 관리자 전용) 도구 {t}')
    for b in d['books']:
        w = f'books.json 책 {b.get("id")}'
        for k in ('id', 'stage', 'rank', 'title', 'author', 'pub', 'year', 'level', 'for', 'key', 'line', 'use', 'src'):
            if b.get(k) in (None, '', []):
                sys.exit(f'{w}: {k} 없음')
        if not re.fullmatch(r'[a-z0-9-]+', b['id']) or b['id'] in ids:
            sys.exit(f'{w}: id 형식 오류 또는 중복')
        ids.add(b['id'])
        if b['stage'] not in st_ids:
            sys.exit(f'{w}: 없는 단계 {b["stage"]}')
        if b['level'] not in LEVEL:
            sys.exit(f'{w}: 난이도는 1~3')
        if b.get('isbn') and not _isbn_ok(b['isbn']):
            sys.exit(f'{w}: ISBN-13 형식·검사 숫자 오류 {b["isbn"]}')
        if b.get('cp') and not CP_RE.match(b['cp']):
            sys.exit(f'{w}: 쿠팡 파트너스 링크는 https://link.coupang.com/a/… 단축 주소만 ({b["cp"]})')
        if not str(b['src']).startswith('https://'):
            sys.exit(f'{w}: 확인한 판매 페이지 주소(src) 없음')
        for t in b.get('tools', []):
            if t not in tools:
                sys.exit(f'{w}: 없는(또는 관리자 전용) 도구 {t}')
        for a in b.get('learn', []):
            if a not in slugs:
                sys.exit(f'{w}: 없는 투자 공부 글 {a}')
        if re.search(r'최저가|최대 할인|무조건', b['line'] + b['use'] + b['for']):
            sys.exit(f'{w}: 확인할 수 없는 표현(최저가 등)')
    for s in d['stages']:
        rs = sorted(b['rank'] for b in d['books'] if b['stage'] == s['id'])
        if rs != list(range(1, len(rs) + 1)):
            sys.exit(f'books.json 단계 {s["id"]}: 순위가 1부터 빠짐없이 이어지지 않음 {rs}')
    d['books'].sort(key=lambda b: (st_ids.index(b['stage']), b['rank']))
    d['tools'] = tools
    cv = json.load(open(COVERS, encoding='utf-8')).get('covers', {}) if os.path.isfile(COVERS) else {}
    miss = []
    for b in d['books']:   # 표지: 목록에 있고 파일도 있을 때만 (가로·세로는 그림 자리를 미리 잡아 화면이 밀리지 않게)
        c = cv.get(b['id'])
        if (c and isinstance(c.get('w'), int) and isinstance(c.get('h'), int) and re.fullmatch(r'[0-9a-f]{8}', str(c.get('v', '')))
                and os.path.isfile(os.path.join(ROOT, OUT, 'cover', f'{b["id"]}.webp'))):
            b['cover'] = {'src': f'/{OUT}/cover/{b["id"]}.webp?v={c["v"]}', 'w': c['w'], 'h': c['h']}
        else:
            miss.append(b['id'])
    if miss:
        print(f'  ⚠ 자본가 서재: 표지가 없는 책 {len(miss)}권 — 순위 숫자 상자로 대신 그림 (python scripts/fetch_book_covers.py): {", ".join(miss[:8])}')
    return d


def cover_img(b, cls='', lazy=True):
    """책 표지 <img> (없으면 '') — 글자 그대로 넣는 값은 모두 esc"""
    c = b.get('cover')
    if not c:
        return ''
    cl = f' class="{cls}"' if cls else ''
    return (f'<img{cl} src="{esc(c["src"])}" width="{c["w"]}" height="{c["h"]}" '
            f'alt="『{esc(b["title"])}』 표지"' + (' loading="lazy"' if lazy else '') + ' decoding="async">')


def by_article(books, slug):
    return [b for b in (books or {}).get('books', []) if slug in b.get('learn', [])]


CSS = '''
  .wrap.bk { max-width:960px; }
  .bk-disc { font-size:13px; color:var(--text2); background:var(--bg2); border:1px solid var(--border); border-radius:10px; padding:9px 12px; margin:0 0 18px; }
  .bk-steps { display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 26px; }
  .bk-steps a { font-size:13px; color:var(--text2); text-decoration:none; background:var(--bg2); border:1px solid var(--border); border-radius:999px; padding:6px 12px; }
  .bk-steps a b { color:var(--accent); margin-right:4px; }
  .bk-steps a:hover { border-color:rgba(49,130,246,.5); color:var(--text); }
  .bk-stage { margin:46px 0 0; scroll-margin-top:70px; }
  .bk-no { display:inline-block; font-size:12px; font-weight:700; color:#fff; background:var(--accent); border-radius:999px; padding:3px 10px; margin-bottom:8px; }
  .bk-stage h2 { font-size:22px; line-height:1.45; font-weight:700; margin:0 0 6px; letter-spacing:-.2px; }
  .bk-q { font-size:16px; color:var(--text); font-weight:600; margin:0 0 6px; }
  .bk-goal { color:var(--text2); margin:0 0 14px; }
  .bk-go { font-size:13.5px; color:var(--text3); margin:-4px 0 16px; }
  .bk-go a { margin-right:10px; white-space:nowrap; }
  .bk-tbl td:first-child, .bk-tbl th:first-child { text-align:center; width:44px; }
  .bk-tbl td b { color:var(--text); font-weight:600; }
  .bk-tbl td small { display:block; color:var(--text3); font-size:12.5px; }
  .bk-tbl a.bk-row { color:var(--text); text-decoration:none; } .bk-tbl a.bk-row:hover { color:var(--accent); }
  .bk-lv { white-space:nowrap; color:var(--text2); }
  .bk-shelf { list-style:none; margin:8px 0 22px; padding:0; display:flex; flex-wrap:wrap; justify-content:center; gap:20px 14px; }
  .bk-shelf li { min-width:0; flex:0 0 calc((100% - 6 * 14px) / 7); }
  .bk-shelf a { display:block; color:var(--text); text-decoration:none; }
  .bk-im { display:block; position:relative; aspect-ratio:2/3; }
  .bk-im img { position:absolute; left:0; right:0; bottom:0; margin:0 auto; max-width:100%; max-height:100%; width:auto; height:auto; transition:transform .15s ease; }
  .bk-shelf a:hover .bk-im img { transform:translateY(-4px); }
  .bk-st { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; font-size:13px; line-height:1.45; color:var(--text2); margin-top:9px; overflow-wrap:anywhere; }
  .bk-st b { color:var(--accent); margin-right:5px; }
  .bk-shelf a:hover .bk-st { color:var(--text); }
  .bk-im img, .bk-cover img { border-radius:2px 5px 5px 2px; background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.08), 0 6px 18px rgba(0,0,0,.3); }
  .bk-ph { position:absolute; inset:0; border-radius:3px 6px 6px 3px; background:linear-gradient(135deg, var(--accent), #7c5cf2); color:#fff; display:flex; align-items:center; justify-content:center; text-align:center; padding:10px; font-size:13px; font-weight:700; line-height:1.4; box-shadow:inset 5px 0 0 rgba(0,0,0,.18); overflow:hidden; overflow-wrap:anywhere; }
  .bk-cards { display:grid; grid-template-columns:1fr; gap:14px; margin-top:16px; }
  .bk-card { background:var(--bg2); border:1px solid var(--border); border-radius:14px; padding:18px 20px; scroll-margin-top:70px;
    display:grid; grid-template-columns:150px minmax(0,1fr); grid-template-areas:"cv hd" "cv dt"; grid-template-rows:auto 1fr; column-gap:22px; align-items:start; }
  .bk-card:target { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-dim); }
  .bk-cover { grid-area:cv; position:relative; }
  .bk-cover img { display:block; width:100%; height:auto; }
  .bk-cover a { display:block; }
  .bk-cover.bk-nocv { aspect-ratio:2/3; }
  .bk-rk { position:absolute; top:-9px; left:-9px; min-width:28px; height:28px; padding:0 8px; border-radius:999px; background:var(--accent); color:#fff; font-size:14px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.4); pointer-events:none; }
  .bk-head { grid-area:hd; min-width:0; }
  .bk-detail { grid-area:dt; min-width:0; margin-top:4px; }
  .bk-card h3 { font-size:17.5px; line-height:1.45; font-weight:700; margin:0; color:var(--text); }
  .bk-card h3 small { font-size:13px; font-weight:400; color:var(--text3); margin-left:4px; }
  .bk-by { font-size:13px; color:var(--text3); margin:2px 0 6px; }
  .bk-tags { display:flex; flex-wrap:wrap; gap:5px; margin:2px 0 8px; }
  .bk-tags span { font-size:12px; color:var(--text2); background:var(--bg3); border:1px solid var(--border); border-radius:999px; padding:2px 9px; }
  .bk-tags span.lv { color:var(--accent); border-color:rgba(49,130,246,.35); background:var(--accent-dim); }
  .bk-line { color:var(--text); margin:0 0 6px; font-size:15.5px; }
  .bk-use { color:var(--text2); margin:0 0 8px; font-size:14.5px; }
  .bk-for { font-size:13.5px; color:var(--text3); margin:0 0 10px; }
  .bk-links { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .bk-links a.t { font-size:13px; color:var(--text2); text-decoration:none; border:1px solid var(--border); border-radius:8px; padding:5px 10px; }
  .bk-links a.t:hover { border-color:rgba(49,130,246,.5); color:var(--accent); }
  .bk-buy { font-size:13.5px; font-weight:700; color:#fff !important; background:var(--accent); border-radius:9px; padding:7px 14px; text-decoration:none; margin-left:auto; }
  .bk-buy:hover { filter:brightness(1.08); }
  .bk-rule ol { padding-left:22px; margin:8px 0 0; color:var(--text2); } .bk-rule li { margin:5px 0; }
  @media (max-width:899px) {
    .bk-shelf li { flex-basis:calc((100% - 3 * 14px) / 4); }
  }
  @media (max-width:599px) {
    .bk-shelf { gap:18px 12px; }
    .bk-shelf li { flex-basis:calc((100% - 2 * 12px) / 3); }
  }
  @media (max-width:640px) {
    .bk-card { padding:14px; grid-template-columns:112px minmax(0,1fr); grid-template-areas:"cv hd" "dt dt"; grid-template-rows:auto auto; column-gap:14px; }
    .bk-detail { margin-top:14px; }
    .bk-rk { top:-7px; left:-7px; min-width:24px; height:24px; padding:0 6px; font-size:12.5px; }
    .bk-buy { margin-left:0; }
    .bk-tbl .bk-hide { display:none; }
  }
  @media (max-width:360px) {
    .bk-card { grid-template-columns:96px minmax(0,1fr); column-gap:12px; }
    .bk-shelf { gap:16px 10px; }
    .bk-shelf li { flex-basis:calc((100% - 2 * 10px) / 3); }
  }
'''


def write_page(d, site, analytics, write):
    """books/index.html 쓰기 → [(주소, 수정일)]"""
    if not d:
        return []
    url = f'{site}{OUT}/'
    tools = d['tools']
    books, stages = d['books'], d['stages']
    any_cp = any(b.get('cp') for b in books)
    title = '자본가 서재 — AI 시대, 노동자에서 자본가로 가는 단계별 추천 도서'
    desc = 'AI 시대 노동의 변화부터 돈의 본질, 주식·ETF, 부동산·경매, 배당·연금까지 — 노동자에서 자본가로 가는 단계별 추천 도서 순위.'
    if len(desc) > 80:
        sys.exit(f'books 설명 {len(desc)}자 (80자 이하)')

    nav = ''.join(f'<a href="#s-{esc(s["id"])}"><b>{s["no"]}단계</b>{esc(s["name"])}</a>' for s in stages)
    secs = ''
    for s in stages:
        xs = [b for b in books if b['stage'] == s['id']]
        rows = ''.join(
            f'<tr><td class="n">{b["rank"]}</td><td><a class="bk-row" href="#b-{esc(b["id"])}"><b>{esc(b["title"])}</b></a><small>{esc(b["author"])}</small></td>'
            f'<td class="bk-lv">{LEVEL[b["level"]]}</td><td class="bk-hide">{esc(b["for"])}</td></tr>' for b in xs)
        shelf = ''.join(
            f'<li><a href="#b-{esc(b["id"])}"><span class="bk-im">'
            + (cover_img(b, lazy=s is not stages[0]) or f'<span class="bk-ph">{esc(b["title"])}</span>')
            + f'</span><span class="bk-st"><b>{b["rank"]}</b>{esc(b["title"])}</span></a></li>' for b in xs)
        cards = ''
        for b in xs:
            by = esc(b['author']) + (f' · {esc(b["trans"])} 옮김' if b.get('trans') else '') + f' · {esc(b["pub"])} · {b["year"]}'
            tags = f'<span class="lv">{LEVEL[b["level"]]}</span>' + ''.join(f'<span>{esc(k)}</span>' for k in b['key'])
            go = ''.join(f'<a class="t" href="/{esc(t)}/">{esc(BL.tool_name(tools[t]))}</a>' for t in b.get('tools', []))
            go += ''.join(f'<a class="t" href="/learn/{esc(a)}/">관련 글 읽기</a>' for a in b.get('learn', [])[:1])
            buy = (f'<a class="bk-buy" href="{esc(b["cp"])}" target="_blank" rel="sponsored nofollow noopener" data-bk="{esc(b["id"])}">쿠팡에서 보기</a>'
                   if b.get('cp') else '')
            img = cover_img(b)
            if img and b.get('cp'):   # 표지를 눌러도 구매 링크로 (단추와 같은 제휴 표시·rel)
                img = (f'<a class="bk-cvl" href="{esc(b["cp"])}" target="_blank" rel="sponsored nofollow noopener" data-bk="{esc(b["id"])}" '
                       f'aria-label="『{esc(b["title"])}』 쿠팡에서 보기">{img}</a>')
            cover = (f'<div class="bk-cover">{img}<b class="bk-rk" title="단계 안 순위">{b["rank"]}</b></div>' if img else
                     f'<div class="bk-cover bk-nocv" aria-hidden="true"><span class="bk-ph">{b["rank"]}</span></div>')
            cards += (f'<article class="bk-card" id="b-{esc(b["id"])}">{cover}<div class="bk-head">'
                      f'<h3>{esc(b["title"])}' + (f'<small>{esc(b["sub"])}</small>' if b.get('sub') else '') + '</h3>'
                      f'<p class="bk-by">{by}</p><div class="bk-tags">{tags}</div></div><div class="bk-detail">'
                      f'<p class="bk-line">{esc(b["line"])}</p><p class="bk-use"><b>사이트에서 이어 하기</b> — {esc(b["use"])}</p>'
                      f'<p class="bk-for">이런 분께: {esc(b["for"])}</p><div class="bk-links">{go}{buy}</div></div></article>')
        go = ''.join(f'<a href="/{esc(t)}/">{esc(BL.tool_name(tools[t]))} →</a>' for t in s.get('tools', []))
        secs += (f'<section class="bk-stage" id="s-{esc(s["id"])}" aria-labelledby="h-{esc(s["id"])}"><span class="bk-no">{s["no"]}단계</span>'
                 f'<h2 id="h-{esc(s["id"])}">{esc(s["name"])}</h2><p class="bk-q">{esc(s["q"])}</p><p class="bk-goal">{esc(s["goal"])}</p>'
                 + (f'<p class="bk-go">이 단계의 도구: {go}</p>' if go else '') +
                 f'<ol class="bk-shelf" aria-label="{s["no"]}단계 책 {len(xs)}권 표지">{shelf}</ol>'
                 f'<div class="tbl bk-tbl"><table><thead><tr><th>순위</th><th>책</th><th>난이도</th><th class="bk-hide">이런 분께</th></tr></thead>'
                 f'<tbody>{rows}</tbody></table></div><div class="bk-cards">{cards}</div></section>\n')
    ld = [{'@context': 'https://schema.org', '@type': 'CollectionPage', 'name': '자본가 서재', 'description': desc, 'url': url, 'inLanguage': 'ko-KR',
           'mainEntity': {'@type': 'ItemList', 'numberOfItems': len(books), 'itemListElement': [
               {'@type': 'ListItem', 'position': i + 1, 'url': f'{url}#b-{b["id"]}', 'item': dict(
                   {'@type': 'Book', 'name': b['title'], 'author': {'@type': 'Person', 'name': b['author'].split(',')[0].split('·')[0].strip()},
                    'publisher': {'@type': 'Organization', 'name': b['pub']}, 'datePublished': str(b['year'])}, **({'isbn': b['isbn']} if b.get('isbn') else {}),
                   **({'image': site.rstrip('/') + b['cover']['src']} if b.get('cover') else {}))}
               for i, b in enumerate(books)]}},
          {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
              {'@type': 'ListItem', 'position': 1, 'name': '홈', 'item': site},
              {'@type': 'ListItem', 'position': 2, 'name': '투자 공부', 'item': f'{site}learn/'},
              {'@type': 'ListItem', 'position': 3, 'name': '자본가 서재', 'item': url}]}]
    head = BL._head(site, f'{title} | 디코딩 자본주의', desc, url, analytics, ld).replace('</style>', CSS + '</style>', 1)
    disc = f'<p class="bk-disc" id="bk-disc">{esc(d["disclosure"])}</p>\n' if any_cp else ''
    page = (head + BL._top('books/') +
            '<main class="wrap bk">\n<nav class="crumb" aria-label="현재 위치"><a href="/">홈</a> › <a href="/learn/">투자 공부</a> › 자본가 서재</nav>\n'
            f'<h1>자본가 서재 — 노동자에서 자본가로 가는 단계별 추천 도서</h1>\n{disc}'
            f'<p class="meta">{len(stages)}단계 · {len(books)}권 · 운영자 <a href="/about/#operator">{BL.AUTHOR}</a> 선정 · {BL._ymd(d["updated"])} 갱신</p>\n'
            f'<div class="lead">{d["lead"]}</div>\n'
            f'<nav class="bk-steps" aria-label="단계 바로 가기">{nav}</nav>\n'
            f'{secs}'
            f'<div class="box bk-rule" id="rule"><b>순위는 이렇게 정했습니다</b><ol>' + ''.join(f'<li>{r}</li>' for r in d['rules']) + '</ol></div>\n'
            '<p class="disc">책 정보(제목·저자·출판사·출간 연도)는 서점 판매 페이지로 확인한 값입니다. 책 표지 그림의 저작권은 각 출판사·저작권자에게 있으며, 책을 소개하기 위해 싣습니다. '
            '한줄평은 운영자의 의견이며, 책의 내용을 대신하지 않습니다. '
            '투자 판단과 책임은 본인에게 있습니다 — <a href="/disclaimer/">투자 면책</a>. 틀린 정보나 추천하고 싶은 책은 <a href="/suggest/">건의 게시판</a>에 남겨 주세요.</p>\n'
            f'{BL.FOOT}\n</main>\n</body>\n</html>\n')
    write(f'{OUT}/index.html', page)
    print(f'  자본가 서재 {len(stages)}단계 · {len(books)}권 · 구매 링크 {sum(1 for b in books if b.get("cp"))}개')
    return [(url, d['updated'])]
