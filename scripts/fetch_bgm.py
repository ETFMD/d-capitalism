#!/usr/bin/env python3
"""자산 속도 시뮬레이터 영상(MP4) 배경음악 모음 만들기 → assets/bgm/*.mp3 · assets/bgm/bgm.json · assets/bgm/CREDITS.txt

곡 고르는 기준: 무료로 쓸 수 있고(퍼블릭 도메인 CC0 또는 CC BY 4.0) 웅장하면서 기대감 있는(epic) 곡
  · FreePD.com — 퍼블릭 도메인(CC0 1.0) · 2025년 사이트 종료 → archive.org/details/freepd 보관본에서 받고 md5 로 확인
      작곡가가 확인되는 곡만(Rafael Krux · Kevin MacLeod · Bryan Teoh). 작곡가 불명 곡은 뺌(예: 'Cornfield Chase' 는 다른 영화음악 제목과 같아 위험)
      Alexander Nakarada 곡은 FreePD 에 있지만 파일 태그가 'CC BY 4.0' → 안전하게 CC BY 4.0 으로 보고 출처 표시
  · incompetech.com — Kevin MacLeod · CC BY 4.0 (출처 표시가 조건: 영상 안에 곡 출처를 자동으로 씀 + 내려받은 뒤 '설명란용 출처 복사')
      feel 에 Epic 이 있고 어둡거나(Eerie·Unnerving·Somber) 우스운(Humorous) 느낌이 아닌 곡 위주로 골라 담음
처리(ffmpeg): 앞 무음 자르기 → 125초까지만(영상 최대 123.1초) → 통합 음량을 재서 −14 LUFS 로 맞추는 고정 이득(곡의 강약·도입부 그대로)
      → 넘치는 순간 봉우리만 리미터(−2 dBFS) → MP3 128k 44.1kHz 스테레오  (loudnorm 동적 모드는 조용한 도입부를 키워 곡을 바꿔 버려 쓰지 않음)
'full' = 곡이 처음으로 크게 울리는 시점(초) — 짧은 영상에서 조용한 도입부만 나오는 곡은 고르지 않게(화면의 고르기 조건)

사용: python scripts/fetch_bgm.py [--force] [--cache DIR]   (한 번 만들어 커밋 — 곡 목록을 바꿀 때만 다시)
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'bgm')
MAXLEN = 125.0
INC = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/'
FPD = 'https://archive.org/download/freepd/'
FPD_META = 'https://archive.org/metadata/freepd'
BY = 'CC BY 4.0'
CC0 = 'CC0'

# (id, 제목, 작곡가, 라이선스, 출처 종류, 출처 파일, ISRC)
TRACKS = [
    # FreePD (퍼블릭 도메인 CC0)
    ('adventure', 'Adventure', 'Rafael Krux', CC0, 'fpd', 'epic/Adventure.mp3', None),
    ('epic-blockbuster-2', 'Epic Blockbuster 2', 'Rafael Krux', CC0, 'fpd', 'epic/Epic Blockbuster 2.mp3', None),
    ('emotional-blockbuster-2', 'Emotional Blockbuster 2', 'Rafael Krux', CC0, 'fpd', 'epic/Emotional Blockbuster 2.mp3', None),
    ('rulers-of-our-lands', 'Rulers of Our Lands', 'Rafael Krux', CC0, 'fpd', 'epic/Rulers of Our Lands.mp3', None),
    ('black-knight', 'Black Knight', 'Rafael Krux', CC0, 'fpd', 'epic/Black Knight.mp3', None),
    ('strength-of-the-titans', 'Strength of the Titans', 'Kevin MacLeod', CC0, 'fpd', 'epic/Strength of the Titans.mp3', None),
    ('new-hero-in-town', 'New Hero in Town', 'Kevin MacLeod', CC0, 'fpd', 'epic/New Hero in Town.mp3', None),
    ('honor-bound', 'Honor Bound', 'Bryan Teoh', CC0, 'fpd', 'epic/Honor Bound.mp3', None),
    # FreePD 보관본이지만 파일 태그가 CC BY 4.0 → CC BY 4.0 으로 출처 표시
    ('adventures-of-flying-jack', 'Adventures of Flying Jack', 'Alexander Nakarada', BY, 'fpd', 'epic/Adventures of Flying Jack.mp3', None),
    ('fanfare-x', 'Fanfare X', 'Alexander Nakarada', BY, 'fpd', 'epic/Fanfare X.mp3', None),
    # incompetech (Kevin MacLeod · CC BY 4.0)
    ('heroic-age', 'Heroic Age', 'Kevin MacLeod', BY, 'inc', 'Heroic Age.mp3', 'USUAN1100848'),
    ('undaunted', 'Undaunted', 'Kevin MacLeod', BY, 'inc', 'Undaunted.mp3', 'USUAN1400025'),
    ('five-armies', 'Five Armies', 'Kevin MacLeod', BY, 'inc', 'Five Armies.mp3', 'USUAN1100875'),
    ('at-launch', 'At Launch', 'Kevin MacLeod', BY, 'inc', 'At Launch.mp3', 'USUAN1100539'),
    ('our-story-begins', 'Our Story Begins', 'Kevin MacLeod', BY, 'inc', 'Our Story Begins.mp3', 'USUAN1100856'),
    ('americana', 'Americana', 'Kevin MacLeod', BY, 'inc', 'Americana.mp3', 'USUAN1200092'),
    ('dark-star', 'Dark Star', 'Kevin MacLeod', BY, 'inc', 'Dark Star.mp3', 'USUAN1100534'),
    ('fanfare-for-space', 'Fanfare for Space', 'Kevin MacLeod', BY, 'inc', 'Fanfare for Space.mp3', 'USUAN1300026'),
    ('take-a-chance', 'Take a Chance', 'Kevin MacLeod', BY, 'inc', 'Take a Chance.mp3', 'USUAN1300024'),
    ('clenched-teeth', 'Clenched Teeth', 'Kevin MacLeod', BY, 'inc', 'Clenched Teeth.mp3', 'USUAN1100705'),
    ('mighty-and-meek', 'Mighty and Meek', 'Kevin MacLeod', BY, 'inc', 'Mighty and Meek.mp3', 'USUAN1100500'),
    ('movement-proposition', 'Movement Proposition', 'Kevin MacLeod', BY, 'inc', 'Movement Proposition.mp3', 'USUAN1100778'),
    ('hiding-your-reality', 'Hiding Your Reality', 'Kevin MacLeod', BY, 'inc', 'Hiding Your Reality.mp3', 'USUAN1700081'),
    ('urban-gauntlet', 'Urban Gauntlet', 'Kevin MacLeod', BY, 'inc', 'Urban Gauntlet.mp3', 'USUAN1500009'),
    ('arcane', 'Arcane', 'Kevin MacLeod', BY, 'inc', 'Arcane.mp3', 'USUAN1100831'),
    ('rynos-theme', 'Rynos Theme', 'Kevin MacLeod', BY, 'inc', 'Rynos Theme.mp3', 'USUAN1600016'),
    ('full-on', 'Full On', 'Kevin MacLeod', BY, 'inc', 'Full On.mp3', 'USUAN1300005'),
    ('rising-game', 'Rising Game', 'Kevin MacLeod', BY, 'inc', 'Rising Game.mp3', 'USUAN1100593'),
    ('prelude-and-action', 'Prelude and Action', 'Kevin MacLeod', BY, 'inc', 'Prelude and Action.mp3', 'USUAN1100887'),
    ('anglozulu', 'AngloZulu', 'Kevin MacLeod', BY, 'inc', 'AngloZulu.mp3', 'USUAN1100411'),
    ('a-mission', 'A Mission', 'Kevin MacLeod', BY, 'inc', 'A Mission.mp3', 'USUAN1100343'),
    ('the-curtain-rises', 'The Curtain Rises', 'Kevin MacLeod', BY, 'inc', 'The Curtain Rises.mp3', 'USUAN1500011'),
    ('truth-of-the-legend', 'Truth of the Legend', 'Kevin MacLeod', BY, 'inc', 'Truth of the Legend.mp3', 'USUAN1100592'),
    ('achilles', 'Achilles', 'Kevin MacLeod', BY, 'inc', 'Achilles.mp3', 'USUAN1100463'),
    ('call-to-adventure', 'Call to Adventure', 'Kevin MacLeod', BY, 'inc', 'Call to Adventure.mp3', 'USUAN1300022'),
]


def site_of(t):
    _id, title, artist, lic, kind, path, isrc = t
    if kind == 'inc': return 'incompetech.com'
    if artist == 'Alexander Nakarada': return 'alexandernakarada.bandcamp.com'
    return 'FreePD.com'


def source_url(t):
    _id, title, artist, lic, kind, path, isrc = t
    return (INC if kind == 'inc' else FPD) + urllib.parse.quote(path)


def credit_full(t):
    """영상 설명란에 붙여 넣을 출처 (CC BY 4.0 은 이용 조건)"""
    _id, title, artist, lic, kind, path, isrc = t
    if lic == CC0:
        return 'Music: "%s" by %s (FreePD.com)\nPublic Domain (CC0 1.0) https://creativecommons.org/publicdomain/zero/1.0/' % (title, artist)
    if kind == 'inc':   # Kevin MacLeod 이 정한 형식 (incompetech.com FAQ)
        return 'Music: %s Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/' % title
    return 'Music: "%s" by %s (%s)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/' % (title, artist, site_of(t))


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode: raise RuntimeError('%s\n%s' % (' '.join(cmd[:6]), r.stderr[-800:]))
    return r


def download(url, out, md5=None):
    if os.path.exists(out) and (md5 is None or hashlib.md5(open(out, 'rb').read()).hexdigest() == md5) and os.path.getsize(out) > 50000:
        return
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (d-capitalism.com bgm builder)'})
    with urllib.request.urlopen(req, timeout=180) as r, open(out + '.part', 'wb') as f:
        shutil.copyfileobj(r, f)
    os.replace(out + '.part', out)
    if md5 and hashlib.md5(open(out, 'rb').read()).hexdigest() != md5:
        raise RuntimeError('md5 다름: ' + url)


def measure(src, chain):
    """통합 음량(LUFS)·최대 순간 봉우리(dBTP)"""
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', src, '-af', chain + ',ebur128=peak=true', '-f', 'null', '-'])
    I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)[-1]); tp = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', r.stderr)[-1])
    return I, tp


def full_point(mp3):
    """곡이 처음으로 크게 울리는 시점(초): 1초 RMS 가 곡 상위 10% 크기 − 8 dB 에 처음 닿는 때"""
    import numpy as np
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp3, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], capture_output=True)
    x = np.frombuffer(r.stdout, dtype=np.float32)
    w = 22050; n = len(x) // w
    db = 20 * np.log10(np.array([np.sqrt(np.mean(x[i * w:(i + 1) * w] ** 2) + 1e-12) for i in range(n)]))
    p90 = np.percentile(db, 90)
    i = next((k for k in range(n) if db[k] >= p90 - 8), n)
    return round(float(i), 1), round(len(x) / 22050.0, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='이미 만든 파일도 다시')
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'dcap_bgm_cache'), help='원본 내려받기 폴더')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True); os.makedirs(a.cache, exist_ok=True)
    ids = [t[0] for t in TRACKS]
    assert len(ids) == len(set(ids)), '같은 id'
    meta = json.loads(urllib.request.urlopen(urllib.request.Request(FPD_META, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read())
    md5 = {f['name']: f.get('md5') for f in meta.get('files', [])}
    items = []
    for t in TRACKS:
        tid, title, artist, lic, kind, path, isrc = t
        src = os.path.join(a.cache, kind + '__' + path.replace('/', '__'))
        download(source_url(t), src, md5.get(path) if kind == 'fpd' else None)
        if kind == 'fpd' and not md5.get(path): raise RuntimeError('archive.org 목록에 없음: ' + path)
        dst = os.path.join(OUT, tid + '.mp3')
        if a.force or not os.path.exists(dst):
            dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).stdout.strip())
            chain = 'silenceremove=start_periods=1:start_duration=0:start_threshold=-55dB:detection=peak,atrim=0:%g' % MAXLEN
            if dur > MAXLEN + 0.5: chain += ',afade=t=out:st=%g:d=0.8' % (MAXLEN - 0.8)
            I0, tp0 = measure(src, chain)
            g = -14.0 - I0                                     # 고정 이득 (곡 안의 강약은 그대로)
            ln = 'volume=%.2fdB,alimiter=limit=0.794:attack=5:release=80:level=0' % g   # −2 dBFS 넘는 봉우리만 눌러 줌
            run(['ffmpeg', '-hide_banner', '-y', '-i', src, '-map', '0:a:0', '-af', chain + ',' + ln, '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
                 '-map_metadata', '-1', '-id3v2_version', '3', '-metadata', 'title=' + title, '-metadata', 'artist=' + artist,
                 '-metadata', 'comment=%s · %s · edited (trimmed, loudness normalized) for d-capitalism.com' % (lic, source_url(t)), dst])
        full, d = full_point(dst)
        lu = run(['ffmpeg', '-hide_banner', '-nostats', '-i', dst, '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr
        I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', lu)[-1]); pk = float(re.findall(r'Peak:\s+(-?[\d.]+) dBFS', lu)[-1])
        items.append({'id': tid, 't': title, 'a': artist, 'lic': lic, 'site': site_of(t), 'f': tid + '.mp3', 'd': d, 'full': full,
                      'src': source_url(t), 'isrc': isrc, 'credit': credit_full(t), 'lufs': round(I, 1), 'peak': round(pk, 1)})
        print('%-26s %-10s %6.1f초 full %5.1f  %5.1f LUFS  peak %5.1f dBFS  %4d KB' % (tid, lic, d, full, I, pk, os.path.getsize(dst) // 1024), flush=True)
    keep = {i['f'] for i in items}
    for f in os.listdir(OUT):   # 목록에서 뺀 곡 파일 정리
        if f.endswith('.mp3') and f not in keep: os.remove(os.path.join(OUT, f)); print('삭제', f)
    json.dump({'v': 1, 'note': 'scripts/fetch_bgm.py 가 만듦 — 곡마다 라이선스·출처 (CC BY 4.0 은 출처 표시 조건)', 'list': items},
              open(os.path.join(OUT, 'bgm.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('d-capitalism.com 자산 속도 시뮬레이터 — 영상 배경음악 출처 (scripts/fetch_bgm.py)\n')
        f.write('편집: 앞 무음·125초 뒤를 잘라 냄, 음량 맞춤(−14 LUFS), MP3 128 kbps 로 다시 인코딩\n\n')
        for i in items:
            f.write('%s (%s)\n  원본: %s%s\n  %s\n\n' % (i['f'], i['lic'], i['src'], ('  ISRC ' + i['isrc']) if i['isrc'] else '', i['credit'].replace('\n', '\n  ')))
    tot = sum(os.path.getsize(os.path.join(OUT, i['f'])) for i in items)
    print('곡 %d개 · %.1f MB' % (len(items), tot / 1e6))


if __name__ == '__main__':
    main()
