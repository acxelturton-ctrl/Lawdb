#!/usr/bin/env python3
"""How many client comments (reviews / testimonials) can be read from each firm's OWN website? A feasibility count, not an importer.

  python3 -I scripts/find-firm-comments.py <out-dir> [--limit=N] [--workers=12]

For every firm with a website it reads the home page and up to two pages that look like a reviews or testimonials page (public https, the same site only)
and looks for comments the firm itself published, in three machine-readable ways:
  1. schema.org Review markup (JSON-LD),
  2. microdata (itemprop="reviewBody"),
  3. testimonial / review blocks and block quotes (plain HTML).
Review widgets that draw their comments with JavaScript (Elfsight, Trustindex, Birdeye, ...) cannot be read this way; they are only counted.

Polite by design: it identifies itself, honours robots.txt, waits between requests to the same site and never sends more than 4 requests per site.
Nothing is written to the repository: <out-dir>/<slug>.json per firm, <out-dir>/summary.json and <out-dir>/summary.csv. Google, Yelp, Avvo and Facebook are NOT
read: their terms forbid scraping (see the notes in the chat that came with this script).
"""
import csv, glob, json, os, re, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

UA = 'LawDB-CommentReader/1.0 (+https://lawdb.ca; info@lawdb.ca)'
TIMEOUT = 10
PAUSE = 0.6  # seconds between two requests to the same site
MAX_BYTES = 900_000

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = dict(a[2:].split('=', 1) for a in sys.argv[1:] if a.startswith('--') and '=' in a)
if not args:
    sys.exit(__doc__)
OUT = args[0]
LIMIT = int(opt.get('limit', 0)) or None
PROVINCE = opt.get('province')
ONLY = set(open(opt['slugs']).read().split()) if opt.get('slugs') else None
WORKERS = int(opt.get('workers', 12))
os.makedirs(OUT, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({'user-agent': UA, 'accept': 'text/html,application/xhtml+xml'})

PAGE_HINT = re.compile(r't[ée]moignage|avis[-_ ]?(client|des[-_ ]clients)?|commentaires?[-_ ]?(client|des)|ce que (disent )?(nos )?clients|nos[-_ ]clients|testimonial|review|client[-_ ]?(feedback|stories|says|comments|voices)|what[-_ ]?(our[-_ ]?)?clients|success[-_ ]?stor|kind[-_ ]?words|praise|reputation|feedback', re.I)
PAGE_SKIP = re.compile(r'blog|news|article|/20\d\d/|tag/|category|privacy|terms|login|career|\.pdf|wp-content|sitemap|cart|shop', re.I)
BLOCK_CLASS = re.compile(r't[ée]moignage|avis|testimonial|review|feedback|client[-_]?(say|quote|story|comment)|quote|praise', re.I)
BLOCK_CLASS_SKIP = re.compile(r'review[-_]?(title|heading|header|link|button|btn|form|count|summary|cta|badge|logo|rating-summary|stars?)$|reviews?[-_]?(section|wrapper|container|list|grid|slider|carousel)$|reviewer|write[-_]?a[-_]?review', re.I)
PRESS = re.compile(r'meilleur(s|es)? (cabinet|avocat)|palmar[eè]s|prix |laur[ée]at|best (law )?firms?|best lawyers|lexpert|chambers|globe and mail|canadian lawyer|legal 500|ranked|top[- ]\d+|award|winner|recogni[sz]ed|listed (in|as)|member of|accredited|certified specialist|rated (by|in)', re.I)
BOILERPLATE = re.compile(r'[ée]crire un avis|laisser un avis|tous les avis|lire plus|cliquez ici|tous droits r[ée]serv[ée]s|politique de confidentialit[ée]|write a review|leave (us )?a review|read more reviews|see all reviews|view all reviews|click here|cookie|privacy policy|©|all rights reserved|schedule a (free )?consultation|call us|contact us|results may vary|past results|do not constitute|attorney advertising|lorem ipsum|add your review|submit your review|reviews? from|powered by|average rating', re.I)
WIDGETS = {
    'elfsight': re.compile(r'elfsight', re.I), 'trustindex': re.compile(r'trustindex', re.I), 'birdeye': re.compile(r'birdeye', re.I),
    'podium': re.compile(r'podium\.com|podiumwebchat', re.I), 'grade.us': re.compile(r'grade\.us', re.I), 'reviewsonmywebsite': re.compile(r'reviewsonmywebsite', re.I),
    'google-reviews-plugin': re.compile(r'wp-google-reviews|grw-|rplg|google-reviews|gr-reviews', re.I), 'yotpo/other': re.compile(r'yotpo|embedsocial|featurable|shapo|sociablekit', re.I),
}


UI_TEXT = re.compile(r"^(don'?t just take our word|what (our )?clients|hear from|learn more|read (all|more)|client experience|public review|\u2605|posted on|testimonials?\b|reviews?\b|see what|our clients (say|consistently)|clients? (say|love)|ce que (disent )?(nos )?clients|t[ée]moignages?\b|lire (tous|plus))|trustindex verifies|public review theme|\bread (all|more) testimonials", re.I)
FIRST_PERSON = re.compile(r"\b(I|I'm|I've|I'd|I\u2019m|I\u2019ve|I\u2019d|my|me|we|we're|we've|our|us|myself|je|j'|j\u2019|mon|ma|mes|nous|notre|nos|moi)\b", re.I)
POSITIVE = re.compile(r"recommend|excellent|professional|helpful|great|amazing|thank|grateful|outstanding|knowledgeable|responsive|friendly|caring|best|happy|impress|patient|compassion|honest|trust|fantastic|wonderful|supportive|exceptional|appreciate|satisfied|pleasure|efficient|reliable|thorough|perfect|incredible|brilliant|stress|relief|worth|confident|comfortable|clear|recommande|merci|professionnel|comp[ée]tent|rapide|efficace|[ée]coute|satisf|disponible|rigoureu|humain|bienveillan|remercie|rassur|exceptionnel|formidable|g[ée]nial", re.I)


def genuine(c, repeated):
    """A client's own words, not a heading, a case study, a corporate blurb or text copied across firms."""
    t = c['text']
    return not UI_TEXT.search(t) and repeated.get(re.sub(r'\W+', '', t.lower())[:80], 1) == 1 and bool(FIRST_PERSON.search(t)) and bool(POSITIVE.search(t))


def words(s):
    return len(re.findall(r"\b[\w'’-]+\b", s))


def clean(s):
    return re.sub(r'\s+', ' ', (s or '').replace('\xa0', ' ')).strip()


class Site:
    """One website: robots.txt, a pause between requests, and a cap on how many requests it gets."""
    def __init__(self, origin):
        self.origin, self.last, self.count, self.robots = origin, 0.0, 0, None

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

    def get(self, url):
        if self.count >= 4:
            raise RuntimeError('request cap')
        if not self.allowed(url):
            raise PermissionError('robots')
        self.count += 1
        self.wait()
        r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True, stream=True)
        try:
            if r.status_code != 200:
                raise RuntimeError(str(r.status_code))
            if 'html' not in r.headers.get('content-type', 'html'):
                raise RuntimeError('not html')
            if urlparse(r.url).scheme != 'https':
                raise RuntimeError('not https')
            body = r.raw.read(MAX_BYTES, decode_content=True)
            enc = r.encoding or 'utf-8'
            return body.decode(enc, errors='replace'), r.url
        finally:
            r.close()


def jsonld_reviews(soup):
    found = []
    for tag in soup.find_all('script', type=re.compile('ld\\+json', re.I)):
        raw = (tag.string or tag.get_text() or '').strip()
        try:
            data = json.loads(raw)
        except Exception:
            try:
                data = json.loads(re.sub(r'[\x00-\x1f]+', ' ', raw))
            except Exception:
                continue

        def walk(n):
            if isinstance(n, list):
                for x in n:
                    walk(x)
            elif isinstance(n, dict):
                t = ' '.join(n.get('@type', [])) if isinstance(n.get('@type'), list) else str(n.get('@type', ''))
                if 'Review' in t and isinstance(n.get('reviewBody'), str):
                    a = n.get('author')
                    a = a.get('name') if isinstance(a, dict) else a if isinstance(a, str) else ''
                    rr = n.get('reviewRating')
                    rating = rr.get('ratingValue') if isinstance(rr, dict) else None
                    found.append({'text': clean(n['reviewBody']), 'author': clean(str(a or '')), 'rating': rating, 'source': 'jsonld'})
                for v in n.values():
                    if isinstance(v, (dict, list)):
                        walk(v)
        walk(data)
    return found


def split_author(text):
    """'Great lawyer, very kind. - Maria G.' -> ('Great lawyer, very kind.', 'Maria G.')"""
    m = re.search(r'^(.{30,}?[.!?”"’\'])\s*[-–—~]\s*([A-Z][\w.\'’ -]{1,40})$', text)
    if m:
        return m.group(1), m.group(2)
    return text, ''


EMPTY_STAR = re.compile(r'empty|outline|inactive|\boff\b|-o\b|regular|far\b|unfilled|gray|grey', re.I)


def stars_near(el):
    """The star rating a firm printed with one comment (1-5), or None. Looks inside the comment's block, then at its parent card."""
    for node in (el, el.parent):
        if node is None or node.name in ('body', 'html', 'main'):
            continue
        v = node.find(attrs={'itemprop': 'ratingValue'})
        if v is not None:
            try:
                x = float(str(v.get('content') or v.get_text()).strip())
                if 1 <= x <= 5:
                    return x
            except ValueError:
                pass
        for t in node.find_all(attrs={'aria-label': re.compile(r'(\d(?:\.\d)?)\s*(?:out of 5\s*)?stars?', re.I)}, limit=2):
            m = re.search(r'(\d(?:\.\d)?)\s*(?:out of 5\s*)?stars?', t['aria-label'], re.I)
            if m and 1 <= float(m.group(1)) <= 5:
                return float(m.group(1))
        r = node.get('data-rating') or (node.find(attrs={'data-rating': True}) or {}).get('data-rating') if hasattr(node, 'get') else None
        try:
            if r and 1 <= float(r) <= 5:
                return float(r)
        except (TypeError, ValueError):
            pass
        n = node.get_text(' ').count('\u2605')
        if 1 <= n <= 5 and words(clean(node.get_text(' '))) < 190:
            return float(n)
        icons = [i for i in node.find_all(class_=re.compile(r'star', re.I)) if not i.find(class_=re.compile(r'star', re.I)) and not EMPTY_STAR.search(' '.join(i.get('class', [])))]
        if 1 <= len(icons) <= 5 and node is el.parent and words(clean(node.get_text(' '))) < 190:
            return float(len(icons))
    return None


def block_comments(soup, page_is_reviews):
    found = []
    seen = set()
    for el in soup.find_all(['blockquote', 'div', 'li', 'article', 'section', 'p']):
        if any(p.name in ('nav', 'footer', 'header') for p in el.parents):
            continue
        cls = ' '.join(el.get('class', [])) + ' ' + (el.get('id') or '')
        is_block = el.name == 'blockquote' or (BLOCK_CLASS.search(cls) and not BLOCK_CLASS_SKIP.search(cls))
        if not is_block:
            continue
        # the innermost block only: if a child is also a block with its own text, the child is the comment
        if any(c is not el and (c.name == 'blockquote' or (BLOCK_CLASS.search(' '.join(c.get('class', []))) and not BLOCK_CLASS_SKIP.search(' '.join(c.get('class', []))))) and words(clean(c.get_text(' '))) >= 12 for c in el.find_all(['blockquote', 'div', 'li', 'article', 'p'])):
            continue
        text = clean(el.get_text(' '))
        if el.name == 'blockquote' and not page_is_reviews and not el.find(['cite', 'footer']) and not BLOCK_CLASS.search(cls):
            continue  # a stray quotation on an ordinary page is not a client comment
        n = words(text)
        if n < 12 or n > 170 or BOILERPLATE.search(text):
            continue
        body, author = split_author(text)
        key = re.sub(r'\W+', '', body.lower())[:60]
        if key in seen:
            continue
        seen.add(key)
        found.append({'text': body, 'author': author, 'rating': stars_near(el), 'source': 'blocks'})
    return found


def microdata(soup):
    out = []
    for el in soup.find_all(attrs={'itemprop': 'reviewBody'}):
        t = clean(el.get_text(' '))
        if words(t) >= 8:
            out.append({'text': t, 'author': '', 'rating': None, 'source': 'microdata'})
    return out


def candidate_links(html, base):
    soup = BeautifulSoup(html, 'lxml')
    origin = urlparse(base).netloc
    found = {}
    for a in soup.find_all('a', href=True):
        try:
            u = urljoin(base, a['href'].split('#')[0])
            p = urlparse(u)
        except Exception:
            continue
        if p.scheme != 'https' or p.netloc.replace('www.', '') != origin.replace('www.', '') or p.path in ('', '/'):
            continue
        label = clean(a.get_text(' '))[:60]
        if PAGE_SKIP.search(p.path) or len([x for x in p.path.split('/') if x]) > 3:
            continue
        if PAGE_HINT.search(p.path) or PAGE_HINT.search(label):
            rank = 0 if re.search(r'testimonial|review|t[ée]moignage|avis', p.path + label, re.I) else 1
            found.setdefault(p.scheme + '://' + p.netloc + p.path, rank)
    return [u for u, _ in sorted(found.items(), key=lambda kv: kv[1])][:2]


def widgets_in(html):
    return [k for k, rx in WIDGETS.items() if rx.search(html)]


def read_firm(f):
    rec = {'slug': f['slug'], 'name': f.get('name', ''), 'website': f.get('website', ''), 'status': 'ok', 'pages': [], 'widgets': [], 'comments': []}
    site_url = (f.get('website') or '').strip()
    if not site_url:
        rec['status'] = 'no_website'
        return rec
    site_url = re.sub(r'^http://', 'https://', site_url, flags=re.I)
    if not site_url.lower().startswith('https://'):
        site_url = 'https://' + site_url
    try:
        home_url = site_url
        site = Site(urlparse(site_url).scheme + '://' + urlparse(site_url).netloc)
        try:
            html, final = site.get(home_url)
        except PermissionError:
            rec['status'] = 'blocked_by_robots'
            return rec
        if urlparse(final).netloc != site.origin.split('://')[1]:
            site = Site(urlparse(final).scheme + '://' + urlparse(final).netloc)
        pages = [(final, html, False)]
        links = candidate_links(html, final)
        if not links:
            links = [urljoin(final, '/testimonials'), urljoin(final, '/reviews')] if not re.search(r'/fr(/|$)|\.qc\.ca|-qc\b', final) else [urljoin(final, '/temoignages'), urljoin(final, '/avis')]
        for u in links[:2]:
            try:
                h, fu = site.get(u)
                pages.append((fu, h, bool(re.search(r'testimonial|review|feedback|client|t[ée]moignage|avis', urlparse(fu).path, re.I))))
            except PermissionError:
                rec['status'] = 'some_pages_blocked_by_robots'
            except Exception:
                pass
        seen = set()
        for url, h, is_reviews in pages:
            soup = BeautifulSoup(h, 'lxml')
            rec['pages'].append(url)
            for w in widgets_in(h):
                if w not in rec['widgets']:
                    rec['widgets'].append(w)
            for c in jsonld_reviews(soup) + microdata(soup) + block_comments(soup, is_reviews):
                n = words(c['text'])
                if n < 8 or n > 200 or BOILERPLATE.search(c['text']) or PRESS.search(c['text'][:90]) or PRESS.search(c['author']):
                    continue
                key = re.sub(r'\W+', '', c['text'].lower())[:60]
                if key in seen:
                    continue
                seen.add(key)
                c['url'] = url
                rec['comments'].append(c)
    except Exception as e:
        rec['status'] = 'unreachable'
        rec['error'] = str(e)[:80]
    return rec


def load_firms():
    firms = {f['slug']: f for f in json.load(open('firms_data.json'))}
    for fn in sorted(glob.glob('data/firms-batch-*.json')):
        for f in json.load(open(fn)):
            firms.setdefault(f['slug'], f)
    return list(firms.values())


def main():
    firms = load_firms()
    todo = [f for f in firms if not os.path.exists(f"{OUT}/{f['slug']}.json") and (not PROVINCE or f.get('province') == PROVINCE) and (not ONLY or f['slug'] in ONLY)]
    if LIMIT:
        todo = todo[:LIMIT]
    done = 0
    lock = threading.Lock()

    def job(f):
        nonlocal done
        rec = read_firm(f)
        with lock:
            json.dump(rec, open(f"{OUT}/{rec['slug']}.json", 'w'))
            done += 1
            if done % 25 == 0:
                print(f'  {done}/{len(todo)}', flush=True)

    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(job, todo))

    recs = [json.load(open(p)) for p in glob.glob(f'{OUT}/*.json') if not p.endswith('summary.json')]
    repeated = {}
    for r in recs:
        for c in r['comments']:
            k = re.sub(r'\W+', '', c['text'].lower())[:80]
            repeated[k] = repeated.get(k, 0) + 1
    by_slug = {f['slug']: f for f in firms}
    for r in recs:
        r['genuine'] = [c for c in r['comments'] if genuine(c, repeated)]
        r['province'] = by_slug.get(r['slug'], {}).get('province', '')
    summary = summarise(recs)
    if opt.get('export'):
        # the candidates for the profile pages (up to 6 per firm); scripts/apply-firm-comments.mjs makes the final choice with the site's own text rules
        cand = {r['slug']: {'site': r['website'], 'comments': [{'text': c['text'], 'author': c['author'], 'url': c['url']} for c in r['genuine'][:6]]} for r in recs if r['genuine']}
        json.dump(dict(sorted(cand.items())), open(opt['export'], 'w'), ensure_ascii=False, indent=1)
        print(f"exported {len(cand)} firms to {opt['export']}")
    json.dump(summary, open(f'{OUT}/summary.json', 'w'), indent=1)
    with open(f'{OUT}/summary.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['slug', 'name', 'province', 'website', 'comments_readable_up_to_3', 'comments_found_total', 'crawl_status', 'source', 'review_widget_seen'])
        for r in sorted(recs, key=lambda r: (-min(len(r['genuine']), 3), -len(r['genuine']), r['slug'])):
            w.writerow([r['slug'], r['name'], r['province'], r['website'], min(len(r['genuine']), 3), len(r['genuine']), r['status'], '+'.join(sorted({c['source'] for c in r['genuine']})), '+'.join(r['widgets'])])
    print(json.dumps(summary, indent=1))


def summarise(recs):
    n = len(recs)
    by = lambda k: sum(1 for r in recs if len(r['genuine']) >= k)
    status = {}
    for r in recs:
        status[r['status']] = status.get(r['status'], 0) + 1
    prov = {}
    for r in recs:
        p = prov.setdefault(r['province'] or '?', {'firms': 0, 'with_3': 0, 'with_1_or_2': 0, 'with_0': 0})
        p['firms'] += 1
        k = len(r['genuine'])
        p['with_3' if k >= 3 else 'with_1_or_2' if k else 'with_0'] += 1
    return {'firms': n, 'with_3_or_more': by(3), 'with_2': by(2) - by(3), 'with_1': by(1) - by(2), 'with_0': n - by(1),
            'status': status, 'by_province': prov,
            'review_widget_seen_but_nothing_readable': sum(1 for r in recs if r['widgets'] and not r['genuine'])}


if __name__ == '__main__':
    main()
