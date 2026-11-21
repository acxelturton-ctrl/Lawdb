#!/usr/bin/env python3
"""Which individual lawyers can be read from each firm's OWN website, with their picture and the links they publish? A feasibility count, not an importer.

  python3 -I scripts/find-firm-lawyers.py <out-dir> [--limit=N] [--workers=16] [--slugs=<file>] [--province=ON]

For every firm with a website it reads the pages that look like a team / lawyers / people page (home page links, sitemap.xml), finds the people on them
(schema.org Person markup first, then name cards in the HTML), follows each person's own profile page on the same site, and records, per person:
  name, role, the page it was found on, the person's own profile page, a picture address, the links the page publishes for them (LinkedIn, X, Facebook,
  Instagram, YouTube, the law society's lawyer directory, a personal site) and, in plain facts only, the year called to the bar, schools and languages.
LinkedIn, Google, Facebook and the like are NOT read: only links that the firm's own page already shows are recorded. Email addresses and phone numbers are
not stored (only whether an email is shown).

Polite by design: identifies itself, honours robots.txt, waits between requests to the same site, caps requests per site, public https and the same site only.
Nothing is written to the repository: <out-dir>/<slug>.json per firm, <out-dir>/summary.csv and <out-dir>/people.json (every person, with a tier).
Tiers:  solid = a name that really is a person's name, evidence that the person is a lawyer (a lawyer title, or the bio says called to the bar / LL.B. / J.D.),
        on the firm's own site, with their own profile page that has a real bio or with a usable picture;  other = everything else found (kept, not trusted).
"""
import csv, glob, json, os, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)'
TIMEOUT = 10
PAUSE = 0.8 if '--browser=1' in sys.argv else 0.3
MAX_BYTES = 700_000
SITE_CAP = 42  # requests per site

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if not args:
    sys.exit(__doc__)
OUT = args[0]
LIMIT = int(opt.get('limit', 0)) or None
PROVINCE = opt.get('province')
ONLY = set(open(opt['slugs']).read().split()) if opt.get('slugs') else None
WORKERS = int(opt.get('workers', 16))
BROWSER = opt.get('browser') == '1'  # draw pages in a real browser (scripts/lib/render-helper.mjs), for sites that build their team page with scripts
ONLY_UNSOLVED = opt.get('unsolved')  # a folder of an earlier run: only the firms that run found no solid lawyer for
os.makedirs(OUT, exist_ok=True)
SESSION = requests.Session()
SESSION.headers.update({'user-agent': UA, 'accept': 'text/html,application/xhtml+xml'})

# ---------------------------------------------------------------- what is a name, a lawyer
STOP = set('''law legal firm group llp llc lawyers lawyer attorneys attorney avocats avocat avocate associates associate partner partners services service practice practices areas area
our team contact about home family criminal real estate estates wills immigration injury personal business corporate litigation employment read more learn view profile call email meet
the and of for with office offices news blog careers career join us get free consultation book now welcome counsel barristers barrister solicitors solicitor professional corporation inc ltd
mediation notary public tax civil divorce separation custody support child spousal bail dui traffic tickets why choose how what who we help when where faq faqs testimonials reviews
results cases success stories resources articles publications media awards community involvement education experience languages bar admissions years phone fax tel direct line address hours
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december canada canadian ontario quebec alberta manitoba
british columbia toronto vancouver calgary edmonton ottawa montreal winnipeg mississauga brampton hamilton london surrey burnaby north york scarborough markham vaughan oakville
click here learn view all see apply online forms form download pdf privacy policy terms conditions disclaimer sitemap menu search login sign register subscribe newsletter follow share tweet
linkedin facebook twitter instagram youtube whatsapp wechat page article post posted updated category tag previous next back top skip content main navigation footer header
senior junior managing principal founder founding president chair chief executive officer director manager coordinator assistant clerk paralegal student articling secretary receptionist
administrator bookkeeper accountant intern marketing intake specialist consultant advisor representative agent broker mortgage insurance appeal appeals tribunal court courts justice
rights protection planning probate trust trusts powers attorney guardianship executor administration dispute resolution arbitration collaborative negotiation settlement claims claim
accident accidents automobile motor vehicle slip fall medical malpractice wrongful death dismissal termination severance harassment discrimination human workplace labour labor
purchase sale sales closing closings title mortgage refinance landlord tenant condo condominium leasing lease construction commercial industrial residential
visa visas permit permits citizenship sponsorship refugee express entry work study visitor super spousal parental
assault drug drugs impaired driving theft fraud weapons firearms domestic violence sexual offences charges charge youth
la le les du des de un une et en au aux pour avec sans notre nos votre vos nous droit droits cabinet bureau equipe famille immigration succession successions travail immobilier
assaults crimes internet young offenders magazine location housing society directors board three best rated readers chronicle journal choice award review rating ratings top ranked recognized excellence leaders leader
specialists specialist experts expert highly trusted unique approach values vision mission commitment values welcome thank thanks
region regions understand elder abuse western eastern northern southern atlantic prairies pacific national international global regional managing editorial insights updates alerts
notaire notaires notary'''.split())
PARTICLES = {'de', 'la', 'le', 'du', 'des', 'del', 'della', 'di', 'da', 'van', 'von', 'der', 'den', 'al', 'el', 'bin', 'ben', 'st', 'mac', 'mc', 'dos', 'das', 'ter', "d'", "o'"}
PREFIX = re.compile(r'^(?:me|maître|maitre|mr|mrs|ms|mme|mlle|dr|hon|honourable|the hon|justice|prof)\.?\s+', re.I)
CRED = re.compile(r',?\s*\(?\b(?:k\.?c\.?|q\.?c\.?|ll\.?[bm]\.?|j\.?d\.?|b\.?a\.?(?:\s*\(hons?\.?\))?|b\.?sc\.?|b\.?comm?\.?|mba|cpa|cfa|llb|jd|mediator|arb\.?\s*c|c\.?arb|c\.?med|ad\.?\s*e\.?|pc|p\.c\.)\b\.?\)?', re.I)
TOKEN = re.compile(r"^[A-ZÀ-ÝŠŽ][A-Za-zÀ-ÿŠšŽž'’\-]+$")
LAWYER_ROLE = re.compile(r'\b(lawyer|attorney|partner|associate|counsel|barrister|solicitor|avocat|avocate|litigator|of counsel|k\.?c\.?|q\.?c\.?)\b', re.I)
NOT_LAWYER = re.compile(r'\b(notaire|paralegal|parajuriste|clerk|assistant|student|articling|receptionist|administrator|coordinator|manager|bookkeep|secretary|intake|marketing|accountant|translator|intern|notary public|legal assistant|case worker|caseworker|licensed immigration consultant|rcic|immigration consultant|office manager|executive assistant|technician|support staff|operations)\b', re.I)
BAR_EVIDENCE = re.compile(r'called to the [\w\s,]{0,40}bar|admitted to the [\w\s,]{0,40}bar|member of the law society|law society of (?:ontario|alberta|british columbia|manitoba|saskatchewan|upper canada)|barreau du qu[ée]bec|\bLL\.?\s?B\b|\bJ\.?D\.?\b|juris doctor|bachelor of laws|licence en droit|baccalaur[ée]at en droit|admis au barreau|membre du barreau', re.I)
ROLE_WORD = re.compile(r'\b(lawyer|attorney|partner|associate|counsel|barrister|solicitor|avocat|avocate|litigator|principal|founder|managing|senior|paralegal|clerk|assistant|student|articling|receptionist|administrator|coordinator|manager|director|notary|consultant|mediator|president|owner|chair)\b', re.I)
TEAM_HINT = re.compile(r'team|lawyer|attorney|people|professional|partner|associate|counsel|bio|profile|avocat|equipe|[ée]quipe|about|our-firm|firm|who-we|staff|meet', re.I)
TEAM_SKIP = re.compile(r'blog|news|article|/20\d\d/|tag/|category|privacy|terms|login|career|job|\.pdf|wp-content|sitemap|cart|shop|testimonial|review|case-result|contact|disclaimer|forms?/|resource|faq|calculator|practice-area|services?/', re.I)
SOCIALS = [('linkedin', re.compile(r'linkedin\.com/(?:in|pub)/', re.I)), ('twitter', re.compile(r'(?:twitter|x)\.com/(?!intent|share|home|search|hashtag)[\w.]+', re.I)),
           ('facebook', re.compile(r'facebook\.com/(?!sharer|share|dialog|plugins|tr\?)[\w.\-]+', re.I)), ('instagram', re.compile(r'instagram\.com/[\w.]+', re.I)),
           ('youtube', re.compile(r'youtube\.com/(?:@|channel|user|c)/?[\w\-]+', re.I)), ('tiktok', re.compile(r'tiktok\.com/@[\w.]+', re.I))]
LAW_SOCIETY = re.compile(r'(?:lso\.ca|lsbc\.org|lawsociety\.ab\.ca|lawsociety\.mb\.ca|barreau\.qc\.ca|lawsociety\.sk\.ca|lawsocietyontario|lsuc\.on\.ca)', re.I)
CASE_LAW = re.compile(r'canlii\.(?:org|ca)', re.I)
JUNK_IMG = re.compile(r'logo|icon|sprite|banner|arrow|pattern|placeholder|spacer|blank|bg[-_]|background|badge|award|seal|shield|favicon|map|button|\.svg|\.gif|loading|default[-_]?avatar|no[-_]?photo|coming[-_]?soon|facebook|twitter|linkedin|instagram', re.I)


def clean(s):
    return re.sub(r'\s+', ' ', (s or '').replace('\xa0', ' ')).strip()


def parse_name(text):
    """A person's name from a short text, or None. Honorific and degrees are cut; 2 to 5 words; no word from the stop list."""
    t = clean(text)
    if not (4 <= len(t) <= 70):
        return None
    t = re.split(r'\s+[|–—•·]\s+|\s+-\s+|\n', t)[0]
    t = re.sub(r'\([^)]*\)', ' ', t)
    t = clean(t)
    t = PREFIX.sub('', t)
    t = CRED.sub('', t).strip(' ,.-–—')
    if t.isupper() and len(t) > 5:
        t = ' '.join(w.capitalize() if w.lower() not in PARTICLES else w.lower() for w in t.split())
    words = t.split()
    if not (2 <= len(words) <= 5):
        return None
    full = 0
    for w in words:
        lw = w.lower().strip('.,')
        if lw in STOP:
            return None
        if lw in PARTICLES:
            continue
        if re.match(r'^[A-Z]\.?$', w):
            continue
        if not TOKEN.match(w):
            return None
        full += 1
    if full < 2 and not (full == 1 and any(re.match(r'^[A-Z]\.?$', w) for w in words)):
        return None
    if re.search(r'\d|@|&|/|\bllp\b', t, re.I):
        return None
    return ' '.join(words)


def norm(n):
    return re.sub(r'[^a-z]', '', n.lower().replace('é', 'e').replace('è', 'e').replace('ê', 'e').replace('ï', 'i').replace('ô', 'o').replace('ç', 'c').replace('à', 'a'))


# ---------------------------------------------------------------- polite fetching
class BrowserPool:
    """One browser worker process (scripts/lib/render-helper.mjs) shared by all threads."""
    def __init__(self):
        self.proc = subprocess.Popen(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib', 'render-helper.mjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.lock, self.waiting, self.n = threading.Lock(), {}, 0
        threading.Thread(target=self.reader, daemon=True).start()

    def reader(self):
        for line in self.proc.stdout:
            try:
                d = json.loads(line)
            except Exception:
                continue
            w = self.waiting.get(d.get('id'))
            if w:
                w['resp'] = d
                w['evt'].set()

    def get(self, url):
        with self.lock:
            self.n += 1
            i, w = self.n, {'evt': threading.Event()}
            self.waiting[i] = w
            self.proc.stdin.write(json.dumps({'id': i, 'url': url}) + '\n')
            self.proc.stdin.flush()
        if not w['evt'].wait(100):
            raise RuntimeError('browser timeout')
        d = w['resp']
        self.waiting.pop(i, None)
        if not d.get('ok'):
            raise RuntimeError(d.get('error', 'browser error'))
        return d['html'], d['url']


POOL = BrowserPool() if BROWSER else None


class Site:
    def __init__(self, origin):
        self.origin, self.last, self.count, self.robots, self.cap = origin, 0.0, 0, None, SITE_CAP

    def allowed(self, url):
        if self.robots is None:
            rp = RobotFileParser()
            try:
                self.wait()
                r = SESSION.get(self.origin + '/robots.txt', timeout=6)
                rp.parse(r.text.splitlines() if r.status_code == 200 else [])
            except Exception:
                rp.parse([])
            self.robots = rp
        return self.robots.can_fetch(UA, url)

    def wait(self):
        d = PAUSE - (time.time() - self.last)
        if d > 0:
            time.sleep(d)
        self.last = time.time()

    def get(self, url, kind='text/html'):
        if self.count >= self.cap:
            raise RuntimeError('request cap')
        if not self.allowed(url):
            raise PermissionError('robots')
        self.count += 1
        self.wait()
        if POOL and not url.split('?')[0].endswith('.xml'):
            return POOL.get(url)
        r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True, stream=True)
        try:
            if r.status_code != 200:
                raise RuntimeError(str(r.status_code))
            if urlparse(r.url).scheme != 'https':
                raise RuntimeError('not https')
            body = r.raw.read(MAX_BYTES, decode_content=True)
            return body.decode(r.encoding or 'utf-8', errors='replace'), r.url
        finally:
            r.close()


def same_site(a, b):
    ha, hb = urlparse(a).hostname or '', urlparse(b).hostname or ''
    strip = lambda h: re.sub(r'^www\.', '', h.lower())
    return strip(ha) == strip(hb)


def absurl(base, u):
    if not u:
        return None
    u = u.strip()
    if u.startswith('data:') or u.startswith('javascript:'):
        return None
    try:
        return urldefrag(urljoin(base, u))[0]
    except Exception:
        return None


# ---------------------------------------------------------------- reading a page
def strip_noise(soup):
    for t in soup.find_all(['script', 'style', 'noscript', 'svg', 'iframe', 'form']):
        t.decompose()


CHROME_TOKEN = re.compile(r'^(nav|navbar|navigation|menu|menu-item|main-menu|primary-menu|footer|site-footer|breadcrumbs?|topbar|dropdown|mega-menu|widget-area|cookie[\w-]*)$|^menu-|-menu$|-nav$|^nav-menu|navbar', re.I)


def in_chrome(el):
    for p in el.parents:
        if p.name in ('main', 'article', 'body', 'html', '[document]'):
            return False
        if p.name in ('nav', 'footer', 'header', 'aside'):
            return True
        toks = list(p.get('class') or []) + [p.get('id') or '']
        if any(CHROME_TOKEN.search(t) for t in toks if t):
            return True
    return False


def img_candidates(el, base, name=None):
    out = []
    for bg in el.find_all(style=re.compile(r'background(?:-image)?\s*:[^;]*url\(', re.I)):
        m = re.search(r'url\(\s*["\']?([^"\')]+)', bg.get('style') or '')
        u = absurl(base, m.group(1)) if m else None
        if u and not JUNK_IMG.search(u.split('?')[0]):
            out.append((1, u))
    for im in el.find_all('img'):
        src = im.get('data-src') or im.get('data-lazy-src') or im.get('data-original') or im.get('src')
        ss = im.get('srcset') or im.get('data-srcset')
        if ss:
            best = None
            for part in ss.split(','):
                bits = part.strip().split()
                if bits:
                    w = int(re.sub(r'\D', '', bits[1])) if len(bits) > 1 and re.sub(r'\D', '', bits[1]) else 0
                    if best is None or w > best[0]:
                        best = (w, bits[0])
            if best and (not src or src.startswith('data:')):
                src = best[1]
        u = absurl(base, src)
        if not u or JUNK_IMG.search(u.split('?')[0]) or JUNK_IMG.search(im.get('alt') or '') and not (name and norm(name.split()[-1]) in norm(im.get('alt') or '')):
            continue
        score = 0
        alt = norm(im.get('alt') or '')
        fn = norm(u.rsplit('/', 1)[-1])
        if name:
            parts = [norm(p) for p in name.split() if len(p) > 2]
            if parts and sum(p in alt for p in parts) >= 1:
                score += 3
            if parts and sum(p in fn for p in parts) >= 1:
                score += 2
        try:
            w, h = int(re.sub(r'\D', '', im.get('width') or '0') or 0), int(re.sub(r'\D', '', im.get('height') or '0') or 0)
            if w and h:
                if w < 80 or h < 80:
                    score -= 3
                if 0.6 <= w / h <= 1.3:
                    score += 1
        except Exception:
            pass
        if re.search(r'headshot|portrait|team|lawyer|attorney|staff|bio|profile|people|photo', u, re.I):
            score += 1
        out.append((score, u))
    return out


def links_in(el, base):
    res = []
    for a in el.find_all('a', href=True):
        u = absurl(base, a['href'])
        if u:
            res.append((u, clean(a.get_text(' ', strip=True)), a))
    return res


def classify_links(pairs, site_url):
    soc, other, vcard, email = {}, [], None, False
    for u, text, _ in pairs:
        if u.startswith('mailto:'):
            email = True
            continue
        if u.startswith('tel:') or u.startswith('sms:'):
            continue
        if u.lower().endswith('.vcf'):
            vcard = u
            continue
        done = False
        for kind, rx in SOCIALS:
            if rx.search(u) and not re.search(r'/company/|/school/|/share|sharer|shareArticle|intent/', u, re.I):
                soc.setdefault(kind, u)
                done = True
                break
        if done:
            continue
        if LAW_SOCIETY.search(u):
            other.append({'kind': 'law-society', 'url': u})
        elif CASE_LAW.search(u):
            other.append({'kind': 'case-law', 'url': u})
        elif not same_site(u, site_url) and re.match(r'https?://', u) and not re.search(r'google\.|gstatic|calendly|youtu\.be|wa\.me|maps\.|apple\.com|bing\.|cloudflare|wp\.com|w\.org|schema\.org|wordpress|addthis|sharethis|mailchimp|hubspot|lexpert|canadianlawyer', u, re.I):
            other.append({'kind': 'site', 'url': u})
    seen, uniq = set(), []
    for o in other:
        if o['url'] not in seen:
            seen.add(o['url'])
            uniq.append(o)
    return soc, uniq[:8], vcard, email


def jsonld_people(soup, base):
    people = []
    for tag in soup.find_all('script', type=re.compile('ld\\+json', re.I)):
        try:
            data = json.loads((tag.string or tag.get_text() or '').strip())
        except Exception:
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            n = stack.pop()
            if isinstance(n, list):
                stack.extend(n)
            elif isinstance(n, dict):
                stack.extend(v for v in n.values() if isinstance(v, (dict, list)))
                t = n.get('@type')
                t = t if isinstance(t, list) else [t]
                if 'Person' in t and n.get('name'):
                    img = n.get('image')
                    img = img.get('url') if isinstance(img, dict) else (img[0] if isinstance(img, list) and img else img)
                    same = n.get('sameAs') or []
                    same = [same] if isinstance(same, str) else same
                    people.append({'name': clean(n['name']), 'role': clean(n.get('jobTitle') or ''), 'photo': absurl(base, img) if isinstance(img, str) else None, 'url': absurl(base, n.get('url')), 'sameAs': [absurl(base, s) for s in same if isinstance(s, str)]})
    return people


def find_cards(soup, base):
    """People on a team page: every short text that is a name, grouped with the smallest block that holds only that one name."""
    nodes = []
    for el in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'a', 'span', 'p', 'div', 'li', 'dt', 'figcaption', 'em']):
        if el.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'ul', 'table']):
            continue
        if in_chrome(el):
            continue
        name = parse_name(el.get_text(' ', strip=True))
        if name:
            nodes.append((name, el))
    for h in soup.find_all(['h1', 'h2', 'h3', 'h4']):
        m = re.match(r'^(?:about|meet|à propos de|a propos de|about me,?)\s+(?:me\s+)?(.+)$', clean(h.get_text(' ', strip=True)), re.I)
        if m and not in_chrome(h):
            nm = parse_name(m.group(1))
            if nm and not any(norm(nm) == norm(n) for n, _ in nodes):
                nodes.append((nm, h))
    if not nodes:
        return []
    counts = {}
    chains = []
    for name, el in nodes:
        chain = []
        for p in el.parents:
            if p.name in ('body', 'html', '[document]'):
                break
            chain.append(p)
            if len(chain) >= 7:
                break
        chains.append(chain)
        for p in chain:
            counts.setdefault(id(p), set()).add(norm(name))
    cards, seen = [], set()
    for (name, el), chain in zip(nodes, chains):
        if norm(name) in seen:
            continue
        box = el
        for p in chain:
            if len(counts[id(p)]) == 1 and len(p.get_text(' ', strip=True)) <= 1400:
                box = p
            else:
                break
        seen.add(norm(name))
        cards.append((name, el, box))
    return cards


LAWYER_SECTION = re.compile(r'lawyers?|attorneys?|partners?|associates?|counsel|avocat|legal team|our team of|barristers?', re.I)
STAFF_SECTION = re.compile(r'staff|support|paralegals?|administration|clerks?|assistants?|operations|office team|team members', re.I)


def section_of(box):
    t = ''
    for h in box.find_all_previous(['h1', 'h2', 'h3'], limit=8):  # the section heading, not another person's name above this card
        tx = clean(h.get_text(' ', strip=True))
        if tx and not parse_name(tx):
            t = tx
            break
    if STAFF_SECTION.search(t) and not re.search(r'lawyers?|attorneys?|avocat', t, re.I):
        return 'staff'
    if LAWYER_SECTION.search(t):
        return 'lawyers'
    return ''


def card_record(name, el, box, base, page_url):
    lines = [clean(t) for t in box.stripped_strings]
    role = ''
    for ln in lines:
        if ln == name or ln.startswith(name) and len(ln) < len(name) + 4:
            continue
        if 3 <= len(ln) <= 110 and ROLE_WORD.search(ln) and not parse_name(ln):
            role = ln
            break
    pairs = links_in(box, base)
    profile = None
    for u, text, a in pairs:
        if same_site(u, page_url) and urlparse(u).path.strip('/') and u.rstrip('/') != page_url.rstrip('/') and not u.lower().endswith(('.pdf', '.jpg', '.png')):
            if not profile or (norm(name.split()[-1]) in norm(u)):
                profile = u
    imgs = [(sc + 2, u) for sc, u in img_candidates(box, base, name)]  # a card holds one person: its picture is theirs
    imgs.sort(key=lambda x: -x[0])
    soc, other, vcard, email = classify_links(pairs, base)
    raw = clean(el.get_text(' ', strip=True))
    ctext = clean(box.get_text(' ', strip=True))[:700]
    return {'section': section_of(box), 'card_text': ctext, 'raw_name': raw[:80], 'cred': bool(re.search(r'\b(LL\.?B|J\.?D|LL\.?M|K\.?C|Q\.?C)\b', raw)), 'honorific': bool(re.match(r'^(me|maître|maitre)\b', raw, re.I)), 'card_bar': bool(BAR_EVIDENCE.search(ctext)), 'name': name, 'role': role, 'profile_url': profile, 'photo_url': imgs[0][1] if imgs else None, 'photo_score': imgs[0][0] if imgs else None, 'socials': soc, 'links': other, 'has_email': email, 'vcard': vcard}


def read_profile(html, url, name):
    soup = BeautifulSoup(html, 'lxml')
    ld = jsonld_people(soup, url)
    og = soup.find('meta', property='og:image')
    og_img = absurl(url, og.get('content')) if og and og.get('content') else None
    title_el = soup.find('title')
    strip_noise(soup)
    main = soup.find('main') or soup.find('article') or soup.body or soup
    chrome = [t for t in main.find_all(['nav', 'footer', 'header', 'aside'])]
    for t in chrome:
        t.decompose()
    text = clean(main.get_text(' ', strip=True))
    pairs = links_in(main, url)
    soc, other, vcard, email = classify_links(pairs, url)
    for p in ld:
        if norm(p['name']) == norm(name):
            for s in p['sameAs']:
                for kind, rx in SOCIALS:
                    if rx.search(s or ''):
                        soc.setdefault(kind, s)
    imgs = img_candidates(main, url, name)
    imgs.sort(key=lambda x: -x[0])
    photo = imgs[0][1] if imgs and imgs[0][0] >= 2 else None
    pscore = imgs[0][0] if imgs else None
    if not photo:
        for p in ld:
            if norm(p['name']) == norm(name) and p['photo']:
                photo, pscore = p['photo'], 3
    if not photo and og_img and not JUNK_IMG.search(og_img):
        photo, pscore = og_img, 1
    call = re.search(r'called to the [\w\s,]{0,40}bar (?:in|of)?\s*(?:[A-Z][a-z]+ )?(\d{4})|admitted to the [\w\s,]{0,40}bar (?:in|of)?\s*(?:[A-Z][a-z]+ )?(\d{4})|called to the [\w\s]{0,30}(?:Bar|bar) in (?:[A-Z][a-z]+ )?(\d{4})|admis au barreau (?:du Qu[ée]bec )?en (\d{4})|barreau du qu[ée]bec en (\d{4})', text, re.I)
    year = next((int(g) for g in (call.groups() if call else ()) if g), None)
    edu = []
    for m in re.finditer(r'((?:LL\.?\s?[BM]\.?|J\.?D\.?|Juris Doctor|Bachelor of Laws|Master of Laws|B\.?A\.?(?: \(Hons?\))?|B\.?Sc\.?|B\.?Comm\.?|M\.?B\.?A\.?|Ph\.?D\.?)[^.;|]{0,70}?(?:University|Université|College|School|Institute)[^.;,|]{0,50})', text):
        e = clean(m.group(1))
        if e not in edu and len(e) < 140:
            edu.append(e)
        if len(edu) >= 4:
            break
    langs = []
    ctx = re.findall(r'(?:languages?(?: spoken)?|speaks|fluent in|fluent|bilingual|parle|langues?)[:\s\-–]{0,3}([^.|\n]{0,120})', text, re.I)
    for chunk in ctx[:3]:
        for lang in ('English', 'French', 'Spanish', 'Punjabi', 'Hindi', 'Urdu', 'Gujarati', 'Tamil', 'Bengali', 'Arabic', 'Persian', 'Farsi', 'Mandarin', 'Cantonese', 'Korean', 'Vietnamese', 'Tagalog', 'Portuguese', 'Italian', 'Polish', 'Russian', 'Ukrainian', 'Greek', 'German', 'Dutch', 'Turkish', 'Japanese', 'Hebrew', 'Somali', 'Amharic', 'Swahili', 'Anglais', 'Français', 'Espagnol'):
            if re.search(r'\b' + lang + r'\b', chunk, re.I) and lang not in langs:
                langs.append(lang)
    role = ''
    for p in ld:
        if norm(p['name']) == norm(name) and p['role']:
            role = p['role']
    return {'bio_cities': sorted({c for c in CITIES if ' ' + c + ' ' in words_of(text[:6000])}), 'bio_words': len(text.split()), 'bar_evidence': bool(BAR_EVIDENCE.search(text)), 'call_year': year, 'education': edu, 'languages': langs[:6], 'photo_url': photo, 'photo_score': pscore,
            'socials': soc, 'links': other, 'vcard': vcard, 'has_email': email, 'role': role, 'text_head': text[:1500], 'lawyer_word': bool(re.search(r'\b(lawyer|attorney|barrister|avocat|solicitor)\b', text[:2500], re.I))}


# ---------------------------------------------------------------- one firm
def team_urls(site, home_html, home_url):
    soup = BeautifulSoup(home_html, 'lxml')
    urls = {}
    for u, text, a in links_in(soup, home_url):
        if same_site(u, home_url) and urlparse(u).path.strip('/') and not TEAM_SKIP.search(urlparse(u).path) and (TEAM_HINT.search(urlparse(u).path) or TEAM_HINT.search(text)):
            if urlparse(u).path.count('/') <= 3:
                urls[u.split('?')[0]] = 1
    try:
        sm, _ = site.get(site.origin + '/sitemap.xml')
        locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', sm)
        subs = [l for l in locs if l.endswith('.xml')][:3]
        for sub in subs:
            try:
                more, _ = site.get(sub)
                locs.extend(re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', more))
            except Exception:
                pass
        for l in locs:
            p = urlparse(l).path
            if same_site(l, home_url) and p.strip('/') and re.search(r'team|lawyers?|attorneys?|people|our-professionals|professionals|partners|avocats|equipe|[ée]quipe', p, re.I) and not TEAM_SKIP.search(p) and p.count('/') <= 3:
                urls[l] = 1
    except Exception:
        pass
    order = sorted(urls, key=lambda u: (0 if re.search(r'team|lawyers?|attorneys?|people|professionals|avocats|equipe', u, re.I) else 1, len(u)))
    return order[:7]


LAW_CTX = re.compile(r'\b(lawyer|attorney|barrister|solicitor|avocat|avocate|partner|associate|counsel|litigator)\b|called to the|admitted to the|\bLL\.?B\b|\bJ\.?D\b|juris doctor|barreau', re.I)
CLIENT_VOICE = re.compile(r'\b(my lawyer|our lawyer|thank|thanks|recommend|helped me|helped us|highly|review|testimonial|reviewed|stars?|rating|great experience|best lawyer|worked with)\b', re.I)
FIRM_ROLE = re.compile(r'\b(barrister|solicitor|lawyer|attorney|avocat|avocate|counsel)\b', re.I)


def lawyer_evidence(p):
    """Why this person is taken to be a lawyer: a lawyer title, Me, degrees or the bar in the name or card, a bio that says so, or the firm's own words about them."""
    role = p.get('role') or ''
    lawyer_role = bool(role and LAWYER_ROLE.search(role) and not NOT_LAWYER.search(role))
    if role and NOT_LAWYER.search(role) and not re.search(r'\b(lawyer|attorney|barrister|avocat|solicitor)\b', role, re.I):
        return False
    if p.get('section') == 'staff' and not lawyer_role:
        return False
    return bool(lawyer_role or (p.get('section') == 'lawyers' and not role) or p.get('cred') or p.get('honorific') or p.get('card_bar') or (p.get('bar_evidence') and p.get('lawyer_word')) or p.get('ctx_ev') or p.get('solo'))


def context_for(name, texts):
    """A sentence on the firm's own pages that names the person and says what they are (not a client's review)."""
    parts = [t for t in name.replace('.', ' ').split() if len(t) > 1]
    if len(parts) < 2:
        return None
    pat = re.compile(re.escape(parts[0]) + r'(?:\s+\w\.?)?(?:\s+[\w\-\']+)?\s+' + re.escape(parts[-1]), re.I)
    for t in texts:
        for m in pat.finditer(t):
            seg = t[max(0, m.start() - 140): m.end() + 200]
            if LAW_CTX.search(seg) and not CLIENT_VOICE.search(seg):
                return clean(seg)[:220]
    return None


def name_from_firm(firm):
    """'Anton M. Katz Barrister & Solicitor' -> 'Anton M. Katz'; None when the firm is not named after one person."""
    t = PREFIX.sub('', clean(re.sub(r'\([^)]*\)', ' ', firm)))
    toks = []
    for w in re.split(r'[\s,]+', t):
        lw = w.lower().strip('.,&')
        if not w or lw in STOP or lw in ('pc', 'p.c', 'llp', 'professional', 'corporation', 'inc', 'ltd', 'law', 'office'):
            break
        toks.append(w)
    return parse_name(' '.join(toks)) if len(toks) >= 2 else None


def photo_for(name, pages):
    best = None
    for url, html, soup, text in pages:
        for sc, u in img_candidates(soup, url, name):
            toks = [norm(t) for t in name.split() if len(t) > 2]
            if toks and any(t in norm(u.rsplit('/', 1)[-1]) for t in toks) or sc >= 3:
                if not best or sc > best[0]:
                    best = (sc, u)
    return best


def person_from_pages(name, role, pages, via, firm_role_ok=False):
    """A person the firm's own pages talk about without a card: a solo lawyer named in the firm's name, or a name from the firm's earlier details."""
    texts = [t for _, _, _, t in pages]
    ctx = context_for(name, texts)
    if not (ctx or firm_role_ok or (role and LAWYER_ROLE.search(role) and not NOT_LAWYER.search(role))):
        return None
    toks = [norm(t) for t in name.split() if len(t) > 2]
    best = None
    for url, html, soup, text in pages:
        n = sum(norm(text).count(t) for t in toks[-1:]) if toks else 0
        if n and (not best or n > best[0]):
            best = (n, url, html)
    if not best:
        return None
    url, html = best[1], best[2]
    prof = read_profile(html, url, name)
    ph = photo_for(name, pages)
    return {'name': name, 'role': role or prof['role'], 'section': '', 'card_text': '', 'cred': False, 'honorific': False, 'card_bar': False, 'profile_url': url, 'found_on': url, 'via': via,
            'photo_url': ph[1] if ph else prof['photo_url'], 'photo_score': (ph[0] if ph else prof['photo_score']), 'socials': prof['socials'], 'links': prof['links'], 'has_email': prof['has_email'], 'vcard': prof['vcard'],
            'bio_words': prof['bio_words'], 'bar_evidence': prof['bar_evidence'], 'call_year': prof['call_year'], 'education': prof['education'], 'languages': prof['languages'], 'text_head': prof['text_head'],
            'lawyer_word': prof['lawyer_word'], 'ctx_ev': bool(ctx), 'context': ctx, 'solo': via == 'firm-name'}


def home_variants(url):
    u = urlparse(url.replace('http://', 'https://'))
    host = u.netloc
    alt = host[4:] if host.startswith('www.') else 'www.' + host
    yield u.geturl()
    yield u._replace(netloc=alt).geturl()


def do_firm(f):
    rec = {'slug': f['slug'], 'name': f['name'], 'city': f['city'], 'province': f['province'], 'site': f['website'], 'ok': False, 'people': [], 'pages': []}
    try:
        site, home_html, home_url, last_err = None, None, None, None
        for variant in home_variants(f['website']):
            site = Site('{0.scheme}://{0.netloc}'.format(urlparse(variant)))
            try:
                home_html, home_url = site.get(variant)
                break
            except PermissionError:
                raise
            except Exception as e:
                last_err = e
        if home_html is None:
            raise last_err or RuntimeError('unreadable')
        rec['ok'] = True
        site.origin = '{0.scheme}://{0.netloc}'.format(urlparse(home_url))
        people = {}
        pages = []  # (url, html, soup without scripts, plain text without menus)
        for page in [home_url] + team_urls(site, home_html, home_url):
            if site.count >= site.cap - 8:
                break
            try:
                html, url = (home_html, home_url) if page == home_url else site.get(page)
            except Exception:
                continue
            soup = BeautifulSoup(html, 'lxml')
            found = 0
            for p in jsonld_people(soup, url):
                nm = parse_name(p['name'])
                if nm and norm(nm) not in people:
                    people[norm(nm)] = {'name': nm, 'role': p['role'], 'profile_url': p['url'] if p['url'] and same_site(p['url'], url) else None, 'photo_url': p['photo'], 'photo_score': 3 if p['photo'] else None, 'socials': {}, 'links': [], 'has_email': False, 'vcard': None, 'found_on': url, 'via': 'schema.org'}
                    found += 1
            strip_noise(soup)
            for name, el, box in find_cards(soup, url):
                if norm(name) in people:
                    continue
                c = card_record(name, el, box, url, url)
                c['found_on'], c['via'] = url, 'cards'
                people[norm(name)] = c
                found += 1
            tsoup = BeautifulSoup(html, 'lxml')
            strip_noise(tsoup)
            for t in tsoup.find_all(['nav', 'footer', 'header', 'aside']):
                t.decompose()
            pages.append((url, html, soup, clean(tsoup.get_text(' ', strip=True))[:60000]))
            rec['pages'].append({'url': url, 'found': found})
        texts = [t for _, _, _, t in pages]
        # a firm with a long list of lawyers (several offices) gets more requests, so every person's own page can tell which office they are in
        n_ev = sum(1 for p in people.values() if lawyer_evidence(p) or p.get('profile_url'))
        big = n_ev > 30
        if big:
            site.cap = 190
        profile_cap = 110 if big else 22
        cap = 0
        for key, p in list(people.items()):
            if not p.get('profile_url') or cap >= profile_cap or site.count >= site.cap:
                continue
            if p['role'] and NOT_LAWYER.search(p['role']) and not LAWYER_ROLE.search(p['role']):
                continue
            plausible = (p['role'] and LAWYER_ROLE.search(p['role'])) or p.get('section') == 'lawyers' or p.get('cred') or p.get('honorific') or p.get('card_bar') or norm(p['name'].split()[-1]) in norm(p['profile_url'])
            if not plausible:
                continue
            try:
                html, url = site.get(p['profile_url'])
            except Exception:
                continue
            cap += 1
            prof = read_profile(html, url, p['name'])
            p['profile_url'] = url
            for k in ('bio_words', 'bar_evidence', 'call_year', 'education', 'languages', 'text_head', 'lawyer_word'):
                p[k] = prof[k]
            if prof['role'] and not p['role']:
                p['role'] = prof['role']
            if prof['photo_url'] and (not p.get('photo_url') or (prof['photo_score'] or 0) > (p.get('photo_score') or 0)):
                p['photo_url'], p['photo_score'] = prof['photo_url'], prof['photo_score']
            for k, v in prof['socials'].items():
                p['socials'].setdefault(k, v)
            known = {o['url'] for o in p['links']}
            p['links'] += [o for o in prof['links'] if o['url'] not in known]
            p['vcard'] = p.get('vcard') or prof['vcard']
            p['has_email'] = p['has_email'] or prof['has_email']
        # what the firm's own pages say about a person whose card has no title (never a client's review: the person needs a picture or a page of their own)
        for p in people.values():
            if not lawyer_evidence(p) and (p.get('photo_url') or p.get('profile_url')):
                ctx = context_for(p['name'], texts)
                if ctx:
                    p['ctx_ev'], p['context'] = True, ctx
        # people the firm's earlier details name, and a solo lawyer whose name is the firm's name
        for h in f.get('hints') or []:
            nm = parse_name(h.get('name') or '')
            if nm and norm(nm) not in people:
                pp = person_from_pages(nm, clean(h.get('title') or ''), pages, 'details')
                if pp:
                    people[norm(nm)] = pp
        if not any(lawyer_evidence(p) for p in people.values()):
            nm = name_from_firm(f['name'])
            if nm and norm(nm) not in people:
                pp = person_from_pages(nm, '', pages, 'firm-name', firm_role_ok=bool(FIRM_ROLE.search(f['name'])))
                if pp:
                    people[norm(nm)] = pp
        solo_name = name_from_firm(f['name'])
        if solo_name and norm(solo_name) in people:
            old = people[norm(solo_name)]
            pp = person_from_pages(old['name'], old.get('role') or '', pages, 'firm-name', firm_role_ok=bool(FIRM_ROLE.search(f['name'])))
            if pp:
                if not pp.get('photo_url') and old.get('photo_url'):
                    pp['photo_url'], pp['photo_score'] = old['photo_url'], old.get('photo_score')
                people[norm(solo_name)] = pp
        home_links = {u.rstrip('/').lower() for u, _, _ in links_in(BeautifulSoup(home_html, 'lxml'), home_url)}
        keys = list(people)
        for k in keys:
            for k2 in keys:
                if k != k2 and k in people and k2 in people and len(k) < len(k2) and (k2.endswith(k) or k2.startswith(k)):
                    del people[k]
                    break
        plist = list(people.values())
        freq = {}
        for p in plist:
            for u in list(p['socials'].values()) + [o['url'] for o in p['links']]:
                freq[u.rstrip('/').lower()] = freq.get(u.rstrip('/').lower(), 0) + 1
        for p in plist:
            firm_level = lambda u: (u.rstrip('/').lower() in home_links or freq.get(u.rstrip('/').lower(), 0) >= 2) and not re.search(r'linkedin\.com/(?:in|pub)/', u, re.I)
            p['socials'] = {k: u for k, u in p['socials'].items() if not firm_level(u)}
            p['links'] = [o for o in p['links'] if not firm_level(o['url'])]
            toks = [norm(t) for t in p['name'].split() if len(t) > 2]
            p['name_in_url'] = bool(p.get('profile_url') and any(t and t in norm(p['profile_url'].split('//', 1)[-1].split('/', 1)[-1]) for t in toks))
            p['name_in_photo'] = bool(p.get('photo_url') and any(t and t in norm(p['photo_url'].rsplit('/', 1)[-1]) for t in toks))
        rec['people'] = plist
        rec['requests'] = site.count
    except Exception as e:
        rec['error'] = str(e)[:80]
    return rec


CITIES = set()


def words_of(s):
    t = (s or '').lower()
    for a, b in (('é', 'e'), ('è', 'e'), ('ê', 'e'), ('ë', 'e'), ('à', 'a'), ('â', 'a'), ('î', 'i'), ('ï', 'i'), ('ô', 'o'), ('ù', 'u'), ('û', 'u'), ('ç', 'c')):
        t = t.replace(a, b)
    return ' ' + re.sub(r'[^a-z]+', ' ', t).strip() + ' '


def tier(p, firm_name, firm_city, n_people, multi=False):
    """solid: a lawyer at this office, with their own page or a picture. firm: the same, at a firm with several offices where the page does not say which one.
    listed: named as a lawyer on the firm's own page but with no page of their own and no picture (a thin entry). other: everything else found, kept but not trusted."""
    nm = norm(p['name'])
    if (nm in norm(firm_name) or norm(firm_name) in nm) and not p.get('solo'):
        return 'other', 'is the firm name'
    role = p.get('role') or ''
    lawyer_role = bool(role and LAWYER_ROLE.search(role) and not NOT_LAWYER.search(role))
    if role and NOT_LAWYER.search(role) and not re.search(r'\b(lawyer|attorney|barrister|avocat|solicitor)\b', role, re.I):
        return 'other', 'not a lawyer: ' + role[:40]
    if role and re.search(r'\b(best|top|great|excellent|amazing|future lawyer|lawyer of the year|rated|trusted)\b', role, re.I):
        return 'other', 'the text is marketing, not a title'
    if p.get('section') == 'staff' and not lawyer_role:
        return 'other', 'listed with the staff'
    if not lawyer_evidence(p):
        return 'other', 'no lawyer evidence'
    here = words_of(firm_city)
    card = words_of(p.get('card_text'))
    bio = words_of((p.get('text_head') or '')[:1200]) + ' ' + ' '.join(' ' + c + ' ' for c in (p.get('bio_cities') or []))
    other_city = [c for c in CITIES if c != here.strip() and ' ' + c + ' ' in card]
    if other_city and here not in card:
        return 'other', 'another office: ' + other_city[0]
    has_page = bool(p.get('profile_url') and (p.get('bio_words') or 0) >= 60)
    has_photo = bool(p.get('photo_url') and (p.get('photo_score') or 0) >= 2)
    if not (has_page or has_photo):
        return 'listed', 'a lawyer on the firm\'s own page, but no page of their own and no picture'
    if not ((lawyer_role and has_photo) or (p.get('ctx_ev') and has_photo) or p.get('name_in_url') or p.get('name_in_photo') or (has_page and p.get('bar_evidence')) or p.get('solo')):
        return 'other', 'nothing ties the page or picture to the name'
    if (n_people > 35 or multi) and here not in card and here not in bio:
        return 'firm', 'multi-office firm, office not shown'
    return 'solid', 'ok'


def main():
    firms = []
    seen = set()
    for f in json.load(open('firms_data.json')):
        firms.append(f)
    for fn in sorted(glob.glob('data/firms-batch-*.json')):
        firms.extend(json.load(open(fn)))
    for f in firms:
        c = words_of(f.get('city')).strip()
        if len(c) >= 4:
            CITIES.add(c)
    CITIES.update({'toronto', 'montreal', 'quebec', 'vancouver', 'calgary', 'edmonton', 'ottawa', 'winnipeg', 'halifax', 'saskatoon', 'regina', 'victoria', 'kelowna', 'hamilton', 'london', 'kitchener', 'waterloo', 'laval', 'gatineau', 'sherbrooke'})
    todo = [f for f in firms if f.get('website') and f['slug'] not in seen and not seen.add(f['slug'])]
    try:
        details = json.load(open('data/firm-details.json'))  # people an earlier pass named from the firm's own pages
    except Exception:
        details = {}
    for f in todo:
        f['hints'] = (details.get(f['slug']) or {}).get('lawyers') or []
    if ONLY_UNSOLVED:
        solved = set()
        for fn in glob.glob(os.path.join(ONLY_UNSOLVED, '*.json')):
            if os.path.basename(fn) in ('people.json', 'summary.json'):
                continue
            r = json.load(open(fn))
            if any(p.get('tier') in ('solid', 'firm', 'listed') for p in r['people']):
                solved.add(r['slug'])
        todo = [f for f in todo if f['slug'] not in solved]
    if PROVINCE:
        todo = [f for f in todo if f.get('province') == PROVINCE]
    if ONLY:
        todo = [f for f in todo if f['slug'] in ONLY]
    todo = [f for f in todo if not os.path.exists(os.path.join(OUT, f['slug'] + '.json'))]
    if LIMIT:
        todo = todo[:LIMIT]
    lock, done = threading.Lock(), [0]

    def work(f):
        rec = do_firm(f)
        seen_cities = set()
        for p in rec['people']:
            t = words_of((p.get('card_text') or '') + ' ' + (p.get('text_head') or '')[:600])
            seen_cities.update(c for c in CITIES if ' ' + c + ' ' in t)
        multi = len(seen_cities) >= 3
        n_law = sum(1 for p in rec['people'] if (p.get('role') and LAWYER_ROLE.search(p['role'])) or p.get('cred') or p.get('honorific') or p.get('card_bar') or p.get('section') == 'lawyers')
        for p in rec['people']:
            p['tier'], p['why'] = tier(p, f['name'], f['city'], n_law, multi)
        with open(os.path.join(OUT, f['slug'] + '.json'), 'w') as fh:
            json.dump(rec, fh, ensure_ascii=False)
        with lock:
            done[0] += 1
            if done[0] % 25 == 0:
                print(done[0], 'of', len(todo), flush=True)
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(work, todo))
    # summary of everything in the folder
    rows, people = [], []
    for fn in sorted(glob.glob(os.path.join(OUT, '*.json'))):
        if os.path.basename(fn) in ('people.json', 'summary.json'):
            continue
        r = json.load(open(fn))
        for p in r['people']:
            p['firm_slug'], p['firm_name'], p['city'], p['province'] = r['slug'], r['name'], r['city'], r['province']
            people.append(p)
        s = [p for p in r['people'] if p.get('tier') == 'solid']
        fw = [p for p in r['people'] if p.get('tier') == 'firm']
        rows.append([r['slug'], r['ok'], len(r['people']), len(s) + len(fw), sum(1 for p in s if p.get('photo_url')), sum(1 for p in s if p['socials'].get('linkedin')), r.get('error', '')])
    with open(os.path.join(OUT, 'summary.csv'), 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['slug', 'site_read', 'people_found', 'solid_or_firmwide', 'solid_with_photo', 'solid_with_linkedin', 'error'])
        w.writerows(rows)
    json.dump(people, open(os.path.join(OUT, 'people.json'), 'w'), ensure_ascii=False)
    solid = [p for p in people if p.get('tier') == 'solid']
    firmwide = [p for p in people if p.get('tier') == 'firm']
    listed = [p for p in people if p.get('tier') == 'listed']
    print('firms read', sum(1 for r in rows if r[1]), 'of', len(rows), '| firms with a solid lawyer', sum(1 for r in rows if r[3]), '| people found', len(people), '| solid lawyers', len(solid), '| firm-wide (office not shown)', len(firmwide), '| listed only (no page, no picture)', len(listed),
          '| with photo', sum(1 for p in solid if p.get('photo_url')), '| with LinkedIn', sum(1 for p in solid if p['socials'].get('linkedin')), '| with any social', sum(1 for p in solid if p['socials']))


if __name__ == '__main__':
    main()
