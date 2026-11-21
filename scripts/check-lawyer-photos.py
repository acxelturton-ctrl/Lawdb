#!/usr/bin/env python3
"""Is the picture found for a lawyer really a head-and-shoulders photo of one person? Checks the pictures listed in <out-dir>/people.json (from find-firm-lawyers.py).

  python3 -I scripts/check-lawyer-photos.py <out-dir> [--cascade=<haarcascade_frontalface_default.xml>] [--workers=16] [--retry=1]

For every person marked solid: downloads the picture (public https, at most 3 MB, one request, identified), and records width, height and whether it is
  - big enough (shorter side 120 px or more) and not a banner or a tall strip (width / height between 0.5 and 1.6),
  - not a picture the firm shows for many people (a logo or a placeholder: the same address on 3 or more people),
  - one face: with OpenCV's frontal face finder (optional: needs opencv-python-headless and the cascade file); one clear face is a headshot, none or several is not.
Nothing is stored in the repository and nothing is published: this only adds `photo_check` to each person in <out-dir>/people.json and writes <out-dir>/photos.csv.
"""
import csv, io, json, os, sys, threading, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests
from PIL import Image

try:
    import cv2, numpy as np
except Exception:  # face finding is optional
    cv2 = None

UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if not args:
    sys.exit(__doc__)
OUT = args[0]
WORKERS = int(opt.get('workers', 16))
cascade = cv2.CascadeClassifier(opt['cascade']) if cv2 and opt.get('cascade') and os.path.exists(opt['cascade']) else None
SESSION = requests.Session()
SESSION.headers.update({'user-agent': UA, 'accept': 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5'})
last = {}
lock = threading.Lock()
face_lock = threading.Lock()


def pause(host):
    with lock:
        d = 0.25 - (time.time() - last.get(host, 0))
        last[host] = time.time() + max(d, 0)
    if d > 0:
        time.sleep(d)


def check(url, shared):
    res = {'ok': False}
    if urlparse(url).scheme != 'https':
        res['reason'] = 'not https'
        return res
    if shared.get(url, 0) >= 3:
        res['reason'] = 'the same picture is shown for %d people (a logo or placeholder)' % shared[url]
        return res
    try:
        pause(urlparse(url).hostname)
        r = SESSION.get(url, timeout=12, stream=True)
        if r.status_code != 200:
            res['reason'] = 'status %d' % r.status_code
            return res
        body = r.raw.read(3_000_000 + 1, decode_content=True)
        r.close()
        if len(body) > 3_000_000:
            res['reason'] = 'over 3 MB'
            return res
        im = Image.open(io.BytesIO(body))
        im.load()
    except Exception as e:
        res['reason'] = 'cannot load: ' + str(e)[:40]
        return res
    w, h = im.size
    res.update(width=w, height=h, format=im.format, bytes=len(body))
    if min(w, h) < 120:
        res['reason'] = 'too small'
        return res
    if not (0.5 <= w / h <= 1.6):
        res['reason'] = 'not a portrait or square shape'
        return res
    if cascade is not None:
        g = np.array(im.convert('L'))
        scale = 640 / max(g.shape)
        if scale < 1:
            g = cv2.resize(g, None, fx=scale, fy=scale)
        m = max(30, int(0.12 * min(g.shape)))
        try:
            with face_lock:  # the face finder keeps working buffers: one picture at a time
                faces = cascade.detectMultiScale(g, scaleFactor=1.1, minNeighbors=5, minSize=(m, m))
        except Exception:
            res['reason'] = 'face finder failed on this picture'
            return res
        res['faces'] = int(len(faces))
        if len(faces) == 0:
            res['reason'] = 'no face found'
            return res
        if len(faces) > 1:
            big = sorted(faces, key=lambda f: -f[2] * f[3])
            if big[1][2] * big[1][3] > 0.5 * big[0][2] * big[0][3]:
                res['reason'] = 'several faces'
                return res
    res['ok'] = True
    return res


def main():
    people = json.load(open(os.path.join(OUT, 'people.json')))
    solid = [p for p in people if p.get('tier') == 'solid' and p.get('photo_url')]
    if opt.get('retry'):  # only the pictures the face finder failed on
        solid = [p for p in solid if (p.get('photo_check') or {}).get('reason', '').startswith('face finder failed')]
    shared = Counter((p['firm_slug'], p['photo_url']) for p in solid)
    def work(p):
        p['photo_check'] = check(p['photo_url'], {u: n for (s, u), n in shared.items() if s == p['firm_slug']})
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(work, solid))
    json.dump(people, open(os.path.join(OUT, 'people.json'), 'w'), ensure_ascii=False)
    with open(os.path.join(OUT, 'photos.csv'), 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['firm_slug', 'name', 'photo_url', 'ok', 'width', 'height', 'faces', 'reason'])
        for p in [q for q in people if q.get('photo_check')]:
            c = p['photo_check']
            w.writerow([p['firm_slug'], p['name'], p['photo_url'], c['ok'], c.get('width', ''), c.get('height', ''), c.get('faces', ''), c.get('reason', '')])
    done = [q for q in people if q.get('photo_check')]
    good = sum(1 for p in done if p['photo_check']['ok'])
    why = Counter(p['photo_check'].get('reason', 'ok').split(' (')[0] for p in done if not p['photo_check']['ok'])
    print('solid lawyers with a picture address:', len(done), '| real headshots:', good, '| face finder:', 'on' if cascade is not None else 'off', '| not usable:', dict(why))


if __name__ == '__main__':
    main()
