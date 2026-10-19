#!/usr/bin/env python3
"""
자본가 서재 책 표지 받기 — content/books/books.json → books/cover/<책 id>.webp + content/books/covers.json(목록)

· 출처 1순위: 예스24 — 자료의 src(판·ISBN 을 확인한 바로 그 상품 페이지)의 상품 번호 → https://image.yes24.com/goods/<번호>/XL
· 2순위: 교보문고 — ISBN 표지 https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/<ISBN>.jpg
  · 두 곳 모두 받히면 서로 비교(작게 줄인 그림의 상관계수 similar()) → 같으면 check 'same', 다르면 'diff'(사람이 확인할 것 · 예스24 것을 씀)
  · 한 곳만 받히면 'one'
· 그림 검사: 그림 형식 · 가로 200px 이상 · 세로/가로 1.05~1.9 · 거의 한 색(빈 그림·'이미지 준비중' 그림) 아님 · JPEG 화소당 0.03바이트 이상
· 가로 320px WebP 로 줄여 저장(화면에서 가장 크게 160px × 고해상도 2배) · 목록에 가로·세로·출처·버전(v — 파일 해시 앞 8자, 주소 뒤 ?v= 로 캐시 갱신)
· 이미 받은 책은 다시 받지 않음(출처 상품 번호가 같고 파일이 있으면) · 자료에서 빠진 책의 표지는 지움
  · --refresh : 모두 다시 받기(그림이 사실상 같으면 파일·버전은 그대로 — 쓸데없는 커밋 없음) · --only <id> : 그 책만
· 받지 못한 책이 하나라도 있으면 종료 코드 1 (Actions 실패 알림으로 알 수 있게) — 받은 표지·목록은 그대로 저장
· 필요: Pillow (Actions 는 워크플로에서 설치)
· 표지 그림의 저작권은 출판사·저작권자에게 있음 — 페이지에 책 소개 목적임을 밝힘(build_books.py)
"""
import argparse, hashlib, io, json, os, re, sys, time, urllib.request

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BOOKS = os.path.join(ROOT, 'content', 'books', 'books.json')
LIST = os.path.join(ROOT, 'content', 'books', 'covers.json')
DIR = os.path.join(ROOT, 'books', 'cover')
WIDTH = 320
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
SAME = 0.9    # 두 서점 표지의 닮음(상관계수)이 이 값 이상이면 같은 표지


def yes24_no(src):
    m = re.fullmatch(r'https://www\.yes24\.com/(?:product/goods|Product/Goods)/(\d+)', src or '')
    return m.group(1) if m else None


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'})
            with urllib.request.urlopen(req, timeout=25) as r:
                ct = r.headers.get('Content-Type', '')
                body = r.read()
            if not ct.startswith('image/'):
                raise ValueError(f'그림이 아님 ({ct})')
            return body
        except Exception as e:   # 네트워크 일시 오류는 다시 시도
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f'{url} — {last}')


def open_ok(body, where):
    """그림 열기 + 검사 → RGB 그림 (틀리면 ValueError)"""
    im = Image.open(io.BytesIO(body))
    im.load()
    fmt = im.format
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        bg = Image.new('RGB', im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[3])
        im = bg
    else:
        im = im.convert('RGB')
    w, h = im.size
    if w < 200:
        raise ValueError(f'{where}: 너무 작음 {w}×{h}')
    if not 1.05 <= h / w <= 1.9:
        raise ValueError(f'{where}: 책 표지 비율이 아님 {w}×{h}')
    g = im.convert('L').resize((32, 48))
    px = _px(g)
    mean = sum(px) / len(px)
    sd = (sum((p - mean) ** 2 for p in px) / len(px)) ** .5
    if sd < 6:
        raise ValueError(f'{where}: 거의 한 색인 그림(빈 그림·이미지 없음 그림으로 보임)')
    # 두 번째 안전장치: 예스24 '이미지 준비중' 그림(420×600 JPEG 약 5KB)은 화소당 0.02바이트 — 실제 표지는 0.07 이상(2026-10-20 실측)
    if fmt == 'JPEG' and len(body) / (w * h) < 0.03:
        raise ValueError(f'{where}: 내용이 거의 없는 그림(이미지 준비중 그림으로 보임) {len(body)}바이트 {w}×{h}')
    return im


def _px(im):
    return list(im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata())


def similar(a, b):
    """두 표지의 닮음(상관계수 −1~1 · 색 채널별 밝기·대비를 맞춘 뒤 16×24 로 비교) — 크기·압축이 달라도 같은 표지면 0.9 이상
    (2026-10-20 30권 실측: 같은 책 0.915~1.0 · 다른 책끼리 최대 0.866 · 교보문고가 입체 사진을 주는 책은 0.44 → 'diff' 로 사람이 확인)"""
    def vec(im):
        v = []
        for ch in im.resize((16, 24), Image.BILINEAR).split():
            px = _px(ch)
            m = sum(px) / len(px)
            sd = (sum((p - m) ** 2 for p in px) / len(px)) ** .5 or 1
            v += [(p - m) / sd for p in px]
        return v
    va, vb = vec(a), vec(b)
    return sum(x * y for x, y in zip(va, vb)) / len(va)


def fetch(b):
    """한 권 받기 → (그림, 출처, check, 메모)"""
    no = yes24_no(b.get('src'))
    got = {}
    errs = []
    if no:
        try:
            got['yes24'] = open_ok(get(f'https://image.yes24.com/goods/{no}/XL'), '예스24')
        except Exception as e:
            errs.append(str(e))
    else:
        errs.append('src 가 예스24 상품 주소가 아님')
    if b.get('isbn'):
        try:
            got['kyobo'] = open_ok(get(f'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/{b["isbn"]}.jpg'), '교보문고')
        except Exception as e:
            errs.append(str(e))
    if not got:
        raise RuntimeError(' / '.join(errs))
    if len(got) == 2:
        r = similar(got['yes24'], got['kyobo'])
        check, memo = ('same' if r >= SAME else 'diff'), f'두 서점 표지 닮음 {r:.3f}'
    else:
        check, memo = 'one', ' / '.join(errs)
    key = 'yes24' if 'yes24' in got else 'kyobo'
    src = f'yes24:{no}' if key == 'yes24' else f'kyobo:{b["isbn"]}'
    return got[key], src, check, memo


def save(im, path, old_v=None):
    """줄여서 WebP 저장 → ((가로, 세로), 버전) · 이미 있는 파일과 그림이 사실상 같으면(다른 Pillow 판의 압축 차이 등) 쓰지 않고 예전 버전 그대로"""
    w, h = im.size
    if w > WIDTH:
        im = im.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
    if old_v and os.path.isfile(path):
        try:
            cur = Image.open(path).convert('RGB')
            if cur.size == im.size and similar(cur, im) >= 0.995:
                return cur.size, old_v
        except Exception:
            pass   # 깨진 파일이면 새로 씀
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=82, method=6)
    data = buf.getvalue()
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)
    return im.size, hashlib.sha256(data).hexdigest()[:8]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true', help='이미 받은 표지도 모두 다시 받기')
    ap.add_argument('--only', help='이 책 id 만')
    a = ap.parse_args()

    books = json.load(open(BOOKS, encoding='utf-8'))['books']
    old = json.load(open(LIST, encoding='utf-8')).get('covers', {}) if os.path.isfile(LIST) else {}
    os.makedirs(DIR, exist_ok=True)
    ids = {b['id'] for b in books}
    out, bad, new = {}, [], set()
    for b in books:
        bid = b['id']
        path = os.path.join(DIR, f'{bid}.webp')
        o = old.get(bid)
        have = bool(o and os.path.isfile(path))
        # 같은 상품(예스24 번호) 또는 같은 ISBN(교보문고)에서 받은 표지면 그대로 — 판이 바뀌어 src·isbn 이 바뀌면 다시 받음
        same = have and o.get('from') in (f'yes24:{yes24_no(b.get("src"))}', f'kyobo:{b.get("isbn")}')
        redo = (bid == a.only) if a.only else (a.refresh or not same)
        if not redo:
            if have:
                out[bid] = o
            continue
        try:
            im, src, check, memo = fetch(b)
            (w, h), v = save(im, path, o.get('v') if have else None)
            out[bid] = {'w': w, 'h': h, 'from': src, 'v': v, 'check': check}
            new.add(bid)
            print(f'  ✓ {bid} {w}×{h} {src} {check} · {memo}')
        except Exception as e:
            bad.append(bid)
            if o and os.path.isfile(path):
                out[bid] = o   # 다시 받기에 실패하면 전에 받은 표지를 그대로
            print(f'  ✗ {bid} 표지를 받지 못함 — {e}')
    for f in os.listdir(DIR):   # 자료에서 빠진 책의 표지 지우기
        m = re.fullmatch(r'(.+)\.webp', f)
        if m and m.group(1) not in ids:
            os.remove(os.path.join(DIR, f))
            print(f'  - {f} 지움 (자료에 없는 책)')
    order = [b['id'] for b in books]
    res = {'_comment': 'scripts/fetch_book_covers.py 가 만드는 파일 — 손으로 고치지 않음. check: same = 예스24·교보문고 표지가 같음 · '
                       'diff = 서로 다름(사람이 확인) · one = 한 곳에서만 받음',
           'covers': {k: out[k] for k in order if k in out}}
    txt = json.dumps(res, ensure_ascii=False, indent=1) + '\n'
    if not os.path.isfile(LIST) or open(LIST, encoding='utf-8').read() != txt:
        with open(LIST, 'w', encoding='utf-8') as f:
            f.write(txt)
    n_diff = [k for k, c in res['covers'].items() if c.get('check') == 'diff' and k in new]   # 이번에 받은 것만 (확인한 책을 매번 다시 알리지 않게)
    print(f'표지 {len(res["covers"])}/{len(books)}권' + (f' · 서점끼리 다른 표지 {len(n_diff)}권(확인 필요): {", ".join(n_diff)}' if n_diff else '')
          + (f' · 받지 못함 {len(bad)}권: {", ".join(bad)}' if bad else ''))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
