#!/usr/bin/env python3
"""
[SNS-LINKS] 사이트 공식 SNS(유튜브·인스타그램·스레드·페이스북) 바로가기 — 모든 페이지 하단에 같은 아이콘 줄

· 주소는 scripts/routes.json 의 "social" 한 곳에만 적음 → 도구 페이지(build_pages)·투자 공부·자본가 서재(build_learn FOOT)·
  소개·약관·개인정보·면책(build_pages.static_pages) 하단과 구조화 데이터(Organization sameAs)가 모두 여기서 만들어짐
· 주소를 바꾸거나 SNS 를 더하려면 routes.json "social" 만 고치고 빌드 (아이콘은 ICON 에 같은 id 로)
· 아이콘은 특정 회사 로고가 아닌 단순한 일반 그림(재생·카메라·@·사람들) + 이름 글자
· 표준 라이브러리만
"""
import html, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HOSTS = {'yt': ('www.youtube.com',), 'ig': ('www.instagram.com',), 'th': ('www.threads.com', 'www.threads.net'), 'fb': ('www.facebook.com',)}
_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{}</svg>'
ICON = {
    'yt': _SVG.format('<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none"/>'),                       # 재생
    'ig': _SVG.format('<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>'),                                      # 카메라
    'th': _SVG.format('<circle cx="12" cy="12" r="3.6"/><path d="M15.6 9v4.3a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7"/>'),               # @
    'fb': _SVG.format('<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.4a4.4 4.4 0 0 1 5 4.6"/>'),   # 사람들
}
_cache = None


def load():
    """routes.json "social" → [{id, name, en, url}] (주소·아이콘 검사 — 틀리면 빌드 중단)"""
    global _cache
    if _cache is None:
        cfg = json.load(open(os.path.join(ROOT, 'scripts', 'routes.json'), encoding='utf-8'))
        out = []
        for s in cfg.get('social', []):
            sid, url = s.get('id'), s.get('url', '')
            if sid not in ICON or not s.get('name') or not s.get('en'):
                sys.exit(f'routes.json social: 알 수 없는 id 이거나 이름 빠짐 — {s}')
            m = re.fullmatch(r'https://([a-z.]+)/\S+', url)
            if not m or m.group(1) not in HOSTS[sid]:
                sys.exit(f'routes.json social {sid}: 주소가 https://{HOSTS[sid][0]}/… 형식이 아님 — {url}')
            out.append(s)
        if len({s['id'] for s in out}) != len(out):
            sys.exit('routes.json social: 같은 id 가 두 번 있음')
        _cache = out
    return _cache


def urls():
    return [s['url'] for s in load()]


def links(en=False):
    """하단 아이콘 줄 HTML — <nav class="sns-links"> (새 창 · rel=me: 사이트와 같은 운영자의 계정임을 알림)"""
    items = load()
    if not items:
        return ''
    lab = 'Decoding Capitalism on social media' if en else '디코딩 자본주의 SNS'
    a = ''.join(f'<a href="{html.escape(s["url"], quote=True)}" target="_blank" rel="noopener me" data-sns="{s["id"]}" '
                f'aria-label="{html.escape((s["en"] if en else s["name"]) + (" (opens in a new tab)" if en else " — 디코딩 자본주의 (새 창)"), quote=True)}">'
                f'{ICON[s["id"]]}<span>{html.escape(s["en"] if en else s["name"])}</span></a>' for s in items)
    return f'<nav class="sns-links" aria-label="{lab}">{a}</nav>'


# 하단 아이콘 줄 모양 — 도구 페이지(src CSS [SNS-LINKS])와 같은 값을 독립 페이지·투자 공부·서재(자체 CSS)에도
CSS = ('  .sns-links { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin:0 0 14px; }\n'
       '  .sns-links a { display:inline-flex; align-items:center; gap:6px; padding:6px 12px 6px 10px; border:1px solid var(--border); border-radius:999px; '
       'font-size:12.5px; line-height:1.2; color:var(--text2); text-decoration:none; white-space:nowrap; }\n'
       '  .sns-links a:hover, .sns-links a:focus-visible { color:var(--accent); border-color:rgba(49,130,246,.5); }\n'
       '  .sns-links svg { flex:none; }\n'
       '  @media (max-width:480px) { .sns-links { display:grid; grid-template-columns:repeat(2, 130px); justify-content:center; } .sns-links a { justify-content:center; } }\n')
