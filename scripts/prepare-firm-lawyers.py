#!/usr/bin/env python3
"""Turns data/lawyers-candidates.json (what find-firm-lawyers.py read, with the picture check from check-lawyer-photos.py) into data/firm-lawyers.json: the lawyers
that may be put on a firm's page. Only solid lawyers (shown at this firm's office) whose picture passed the face check, whose name passes a name check
(the first word is a known first name, or at least not a plain English word, so headings such as "Latest Posts" are dropped) and firms with two or more such
lawyers (a Lawyers page with one name would be thin). Facts only: no biography text is kept. Pictures are kept as addresses and are NOT shown until a lawyer
or the firm confirms (photoConfirmed). Needs gender-guesser and wordfreq (pip install gender-guesser wordfreq).
  python3 -I scripts/prepare-firm-lawyers.py
"""
import json, re, unicodedata
from collections import defaultdict
import gender_guesser.detector as g
from wordfreq import zipf_frequency

GENDER = g.Detector(case_sensitive=False)
LEAD = re.compile(r'^(?:by|par|advocate|attorney|lawyer|counsel|barrister|me|maître|maitre|mr|mrs|ms|dr)\.?\s+(?:me\s+)?', re.I)
GENERIC = re.compile(r'^(?:lawyers?|avocats?|avocates?|staff|team|our team|attorneys?)$', re.I)


def clean_name(n):
    n = re.sub(r'\s+', ' ', n or '').strip()
    prev = None
    while prev != n:
        prev, n = n, LEAD.sub('', n)
    return n


def name_ok(n):
    toks = [t for t in re.split(r'[\s.]+', n) if len(t) > 1]
    if len(toks) < 2:
        return False
    first = toks[0].replace('-', ' ').split()[0]
    if GENDER.get_gender(first) == 'unknown' and zipf_frequency(first.lower(), 'en') >= 3.0:
        return False
    # two words that are both plain English words and neither a known first name ("Private Equity", "Quick Inquiry")
    if all(GENDER.get_gender(t.replace('-', ' ').split()[0]) == 'unknown' and zipf_frequency(t.lower(), 'en') >= 3.3 for t in toks[:2]):
        return False
    if re.search(r'university|college|school|hub|posts|agreements?|strateg|services?|equity|prep|inquiry|cart|bio\b|biograph|journey|pathway|orders|property|evaluation|host\b', n, re.I):
        return False
    return True


def title_of(role):
    r = re.split(r'\s*[|•·]\s*', role or '')[0].strip()
    r = re.sub(r'\s+', ' ', r)
    if not r or GENERIC.match(r) or len(r) > 70 or re.search(r'\b(region|office|best|top)\b', r, re.I):
        return ''
    if r.isupper() or r.islower():
        r = r.title()
    return r


def slug_of(n):
    s = unicodedata.normalize('NFKD', n).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


cands = json.load(open('data/lawyers-candidates.json'))
by = defaultdict(list)
dropped = 0
for q in cands:
    if q['tier'] != 'solid' or not (q.get('photo') and q['photo'].get('headshot')):
        continue
    name = clean_name(q['name'])
    if not name_ok(name):
        dropped += 1
        continue
    by[q['firm_slug']].append((name, q))
out = {}
for slug, items in by.items():
    seen, lawyers = set(), []
    for name, q in items:
        s = slug_of(name)
        if not s or s in seen:
            continue
        seen.add(s)
        li = (q.get('socials') or {}).get('linkedin')
        lw = {'name': name, 'slug': s, 'title': title_of(q.get('role')), 'photo': q['photo']['url'], 'photoConfirmed': False}
        if q.get('call_year'): lw['callYear'] = q['call_year']
        if q.get('education'): lw['education'] = [e[:120] for e in q['education'][:3]]
        if q.get('languages'): lw['languages'] = q['languages'][:5]
        if li and re.match(r'https?://[^\s"\'<>]*linkedin\.com/(?:in|pub)/', li): lw['linkedin'] = li
        if q.get('profile_url') and q['profile_url'].startswith('https://'): lw['site'] = q['profile_url']
        lawyers.append(lw)
    if len(lawyers) >= 2:
        out[slug] = lawyers
json.dump(out, open('data/firm-lawyers.json', 'w'), ensure_ascii=False, indent=0)
n = sum(len(v) for v in out.values())
print('names dropped by the name check:', dropped, '| firms with 2+ publishable lawyers:', len(out), '| lawyers:', n)
