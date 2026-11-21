// Builds the body of the province practice pages (<province>/<practice>-lawyers.html, for example ontario/traffic-ticket-lawyers.html) from the firm data:
// a hero with the numbers, the Featured firms and then every firm as a card with its logo, rating, the line LawDB has about it and its lawyers, who
// is listed in the city, a plain-language guide (data/province-page-content.json), a licensing note, answers to common questions and links to the other
// practice areas. The hand-written opening paragraphs of each page and its links to the other provinces are kept as they are.
//   node scripts/build-province-pages.mjs          rewrites the pages
//   node scripts/build-province-pages.mjs --check  fails if a page is out of date (npm run check runs this)
// Firms come from scripts/lib/site-firms.mjs (the same list the city pages use); the lawyers each card shows come from data/firm-lawyers.json (only
// facts that pass src/lib/lawyers.js; a photo is shown only once it is confirmed, otherwise the lawyer's initials).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROV, TYPES, esc, fmt, ranked, plural, stats, loadFirms } from './practice-pages-core.mjs';
import { lawyersOf } from '../src/lib/lawyers.js';

const CHECK = process.argv.includes('--check');
const firms = loadFirms();
const content = JSON.parse(readFileSync('data/province-page-content.json', 'utf8')).types;
const extraAll = existsSync('data/province-page-extra.json') ? JSON.parse(readFileSync('data/province-page-extra.json', 'utf8')).pages : {};
const copy = existsSync('data/firm-copy.json') ? JSON.parse(readFileSync('data/firm-copy.json', 'utf8')) : {};
const lawyersFile = existsSync('data/firm-lawyers.json') ? JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8')) : {};
const hash = (f) => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
const CSS_V = hash('province-pages.css'), JS_V = hash('province-pages.js');

const PROVINCE = {
  ON: { name: 'Ontario', regulator: 'Law Society of Ontario', legalAid: 'Legal Aid Ontario' },
  AB: { name: 'Alberta', regulator: 'Law Society of Alberta', legalAid: 'Legal Aid Alberta' },
  BC: { name: 'British Columbia', regulator: 'Law Society of British Columbia', legalAid: 'Legal Aid BC' },
  MB: { name: 'Manitoba', regulator: 'Law Society of Manitoba', legalAid: 'Legal Aid Manitoba' },
  QC: { name: 'Quebec', regulator: 'Barreau du Québec', legalAid: 'the Commission des services juridiques (legal aid)' },
};
const SHOW = 12;   // cards shown at first; the rest sit behind "Show more"
const MAX = 48;    // cards on one page; the page links to the full search for the rest

const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const phoneText = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''; };
const firmsPhrase = (sent) => (/ law$/.test(sent) ? `${sent} firms` : `${sent} law firms`);
const initialsOf = (name) => {
  let t = String(name).split(/[\s&,.\-/()]+/).filter((w) => /[A-Za-zÀ-ɏ]/.test(w) && !/^(the|and|of|law|llp|lp|pc|professional|corporation)$/i.test(w));
  if (!t.length) t = String(name).split(/\s+/);
  return ((t[0] || '?').charAt(0) + (t.length > 1 ? t[1].charAt(0) : '')).toUpperCase();
};
const personInitials = (n) => { const w = String(n).split(/\s+/).filter((x) => /^\p{Lu}/u.test(x)); return (((w[0] || '')[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

// the line about a firm: the first sentence of the description LawDB has for it (data/firm-copy.json), else a plain sentence from its listed facts
function blurb(f) {
  const first = String(copy[f.slug] || '').split('\n\n')[0].replace(/\s+/g, ' ').trim();
  if (first) { const m = first.match(/^(.{40,230}?[.!?])(?:\s|$)/); return m ? m[1] : first.slice(0, 200).replace(/\s+\S*$/, '') + '…'; }
  const tags = (f.tags || []).filter(Boolean).slice(0, 3);
  return tags.length ? `A ${f.city} law firm with listed focus areas in ${tags.join(', ')}.` : '';
}

function logoTile(f) {
  const mono = initialsOf(f.name);
  const real = f.type === 'logo' && /^(?:images\/logos\/[\w.-]+|img\/[\w-]+)$/.test(f.src || '') && (f.src.startsWith('img/') || existsSync(f.src));
  return real
    ? `<a class="pp-lg" href="/firms/${f.slug}" tabindex="-1" aria-hidden="true"><img src="/${esc(f.src)}" alt="" loading="lazy" decoding="async" data-mono="${esc(mono)}"></a>`
    : `<a class="pp-lg pp-mono" href="/firms/${f.slug}" tabindex="-1" aria-hidden="true"><b aria-hidden="true">${esc(mono)}</b></a>`;
}

function card(f, feat) {
  const rated = f.rating > 0;
  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(f.rating))));
  const tags = (f.tags || []).filter(Boolean).slice(0, 3);
  const tel = String(f.phone || '').replace(/[^\d+]/g, '');
  const lw = lawyersOf({ lawyers: lawyersFile[f.slug] });
  const people = lw.slice(0, 4).map((l) => `<span class="pp-av">${l.photo ? `<img src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy" referrerpolicy="no-referrer" width="60" height="60">` : esc(personInitials(l.name))}</span>`).join('');
  const b = blurb(f);
  return `<article class="pp-card${feat ? ' pp-feat' : ''}"><div class="pp-top">${logoTile(f)}<div class="pp-id">` +
    (f.featured ? `<span class="pp-ribbon"><span class="pp-tick" aria-hidden="true">&#10003;</span>Featured</span>` : '') +
    `<h3><a href="/firms/${f.slug}">${esc(f.name)}</a></h3>` +
    (rated ? `<p class="pp-rate"><span class="pp-star" aria-hidden="true">${stars}</span><b>${f.rating.toFixed(1)}</b> <span>from ${fmt(f.count)} Google reviews</span></p>` : `<p class="pp-rate"><span>New on LawDB, no Google rating yet</span></p>`) +
    `<p class="pp-where">${esc(f.city)}, ${esc(PROVINCE[f.province].name)}</p></div></div>` +
    (tags.length ? `<ul class="pp-tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '') +
    (b ? `<p class="pp-blurb">${esc(b)}</p>` : '') +
    (lw.length ? `<p class="pp-law"><span class="pp-avs">${people}</span><span>${lw.length} ${plural(lw.length, 'lawyer', 'lawyers')} &middot; <a href="/firms/${f.slug}/lawyers">Meet the lawyers</a></span></p>` : '') +
    `<div class="pp-btns"><a class="pp-view" href="/firms/${f.slug}">View profile</a>${tel ? `<a class="pp-call" href="tel:${esc(tel)}" aria-label="Call ${esc(f.name)}">Call ${esc(phoneText(f.phone))}</a>` : ''}</div></article>`;
}

const between = (html, a, b) => { const i = html.indexOf(a), j = html.indexOf(b); return i >= 0 && j > i ? html.slice(i + a.length, j) : null; };

function build(file, code, dir, typeRow) {
  const [key, label, slug, sent] = typeRow;
  const old = readFileSync(file, 'utf8');
  const extra = extraAll[file.replace(/\.html$/, '')]; // Alberta and Manitoba: the text that is specific to the province (data/province-page-extra.json)
  if (/class="seo-tablewrap"/.test(old) && !old.includes('<!--pp-intro-->') && !extra) return null;
  const P = PROVINCE[code];
  const guide = content[key];
  if (!guide) throw new Error(`${file}: no guide text for ${key} in data/province-page-content.json`);

  // the hand-written parts: the opening paragraphs, the eyebrow and the links to the other provinces (kept from the page, wherever they are now)
  const intro = (extra ? extra.intro.map((x) => `<p>${esc(x)}</p>`).join('') : '') || (between(old, '<!--pp-intro-->', '<!--/pp-intro-->') ?? (old.match(/<div class="intro">([\s\S]*?)<\/div>/) || [])[1]);
  const eyebrow = between(old, '<span class="pp-eyebrow">', '</span>') ?? (old.match(/<div class="hero-banner"[^>]*><span>([\s\S]*?)<\/span>/) || [])[1] ?? `${esc(P.name)} &middot; ${esc(label)}`;
  const heroImg = (old.match(/<header class="pp-hero" data-img="([^"]+)"/) || old.match(/<img class="hero-img" src="([^"]+)"/) || [])[1] || '';
  const seeAlso = extra
    ? Object.entries(PROV).filter(([d2]) => d2 !== dir && existsSync(`${d2}/${slug}.html`)).map(([d2, c2]) => `<a href="/${d2}/${slug}">See ${esc(PROVINCE[c2].name)} listings &rarr;</a>`).join('')
    : between(old, '<!--pp-see-->', '<!--/pp-see-->') ?? ((old.match(/<div class="see-also"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
  const h1 = (old.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  if (!intro || !h1) throw new Error(`${file}: could not find the opening paragraphs or the heading`);
  const title = h1.replace(/\s+/g, ' ').trim();

  const list = ranked(firms.filter((f) => f.province === code && (f.caseTypes || []).includes(key)));
  const s = stats(list);
  const cityCount = new Map();
  for (const f of list) cityCount.set(f.city, (cityCount.get(f.city) || 0) + 1);
  const cities = [...cityCount].map(([c, n]) => ({ c, n })).sort((a, b) => b.n - a.n || a.c.localeCompare(b.c));
  const feat = list.filter((f) => f.featured);
  const rest = list.filter((f) => !f.featured);
  const shown = rest.slice(0, MAX);
  const reviews = fmt(s.reviews);

  const cityChip = ({ c, n }) => {
    const cs = slugify(c);
    const href = existsSync(`${dir}/${cs}/${slug}.html`) ? `/${dir}/${cs}/${slug}` : existsSync(`${dir}/${cs}/index.html`) ? `/${dir}/${cs}/` : '';
    return href ? `<a href="${href}">${esc(c)} <em>${n}</em></a>` : `<span>${esc(c)} <em>${n}</em></span>`;
  };
  const others = TYPES.map((t) => ({ t, n: firms.filter((f) => f.province === code && (f.caseTypes || []).includes(t[0])).length })).filter((x) => x.n > 0 && existsSync(`${dir}/${x.t[2]}.html`));

  const faqs = [
    [`How do I choose a ${sent} lawyer in ${P.name}?`, `${guide.choose[0]} ${guide.choose[guide.choose.length - 1]}`],
    [`What does a ${sent} lawyer cost in ${P.name}?`, (extra && extra.cost) || guide.cost],
    ...(extra ? [[`What should I know about ${sent} law in ${P.name}?`, extra.intro.slice(1).join(' ') || extra.intro[0]]] : []),
    [`How many ${sent} firms does LawDB list in ${P.name}?`, `LawDB lists ${s.n} ${plural(s.n, firmsPhrase(sent).replace(/ firms$/, ' firm'), firmsPhrase(sent))} in ${P.name}${cities.length > 1 ? `, across ${cities.length} cities` : ''}, with an average Google rating of ${s.avg} across ${reviews} reviews.`],
    ['Where do the ratings on this page come from?', "Each rating is the firm's public Google rating, shown with the number of Google reviews behind it, as last refreshed by LawDB. LawDB does not change a rating. A firm marked new on LawDB has no Google rating yet."],
  ];

  const body =
`<div class="wrap pp">
  <div class="crumb"><a href="/">Home</a> &rsaquo; <a href="/${dir}/">${esc(P.name)}</a> &rsaquo; ${esc(label)} Lawyers</div>
  <header class="pp-hero"${heroImg ? ` data-img="${esc(heroImg)}" style="background-image:linear-gradient(135deg,rgba(42,42,42,.86) 0%,rgba(58,58,58,.74) 100%),url(${esc(heroImg)});background-size:cover;background-position:center"` : ''}>
    <span class="pp-eyebrow">${eyebrow}</span>
    <h1>${title}</h1>
    <p class="pp-sub">${s.n ? `Compare ${s.n} ${plural(s.n, firmsPhrase(sent).replace(/ firms$/, ' firm'), firmsPhrase(sent))} in ${esc(P.name)} by Google rating, location and focus. Open any profile to see the lawyers, the office and how to get in touch.` : `LawDB does not list a ${esc(sent)} firm in ${esc(P.name)} yet. This is a newer area for us, and the guide below is general information.`}</p>
    ${s.n ? `<div class="pp-stats"><div class="pp-stat"><b>${s.n}</b><span>${plural(s.n, 'firm', 'firms')} listed</span></div><div class="pp-stat"><b>${s.avg}</b><span>average Google rating</span></div><div class="pp-stat"><b>${reviews}</b><span>Google reviews</span></div><div class="pp-stat"><b>${cities.length}</b><span>${plural(cities.length, 'city', 'cities')}</span></div></div>` : ''}
  </header>
${s.n ? '' : `  <div class="pp-intro"><!--pp-intro-->${intro}<!--/pp-intro--></div>\n`}  <div class="pp-cta"><p>Want firms close to a specific city or courthouse instead of all of ${esc(P.name)}?</p><a class="pp-btn" href="/find-lawyers?case=${key}">Search by location</a></div>
${feat.length ? `\n  <h2 class="pp-h">Featured ${esc(sent)} firms <small>${feat.length}</small></h2>\n  <div class="pp-grid">${feat.map((f) => card(f, true)).join('')}</div>\n` : ''}
${s.n ? `  <h2 class="pp-h">All ${esc(sent)} ${plural(s.n, 'firm', 'firms')} in ${esc(P.name)} <small>${s.n}</small></h2>
  <div class="pp-grid">${shown.slice(0, SHOW).map((f) => card(f, false)).join('')}</div>${shown.length > SHOW ? `\n  <details class="pp-more"><summary>Show ${shown.length - SHOW} more ${plural(shown.length - SHOW, 'firm', 'firms')}</summary><div class="pp-grid">${shown.slice(SHOW).map((f) => card(f, false)).join('')}</div></details>` : ''}${rest.length > shown.length ? `\n  <a class="pp-all" href="/find-lawyers?case=${key}">See all ${s.n} ${esc(sent)} firms in ${esc(P.name)} &rarr;</a>` : ''}` : `
  <div class="pp-empty"><p>We do not have a match for this yet in our ${esc(P.name)} listings. Try the full location search, or browse the other practice areas below.</p><a class="pp-btn" href="/find-lawyers">Find your lawyer</a></div>`}
${s.n ? `\n  <h2 class="pp-h">About ${esc(/ law$/.test(sent) ? sent : sent + ' law')} in ${esc(P.name)}</h2>\n  <div class="pp-intro"><!--pp-intro-->${intro}<!--/pp-intro--></div>\n` : ''}${cities.length > 1 ? `\n  <h2 class="pp-h">Where ${esc(sent)} firms are in ${esc(P.name)}</h2>\n  <div class="pp-chips">${cities.slice(0, 24).map(cityChip).join('')}</div>\n` : ''}
${s.n ? `  <h2 class="pp-h">${esc(label)} lawyers in ${esc(P.name)}: a short guide</h2>
  <div class="pp-cols">
    <div class="pp-box"><h3>What ${esc(sent)} lawyers help with</h3><ul class="pp-ul">${guide.helps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="pp-box"><h3>How to choose a ${esc(sent)} lawyer</h3><ol class="pp-ol">${guide.choose.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
    <div class="pp-box"><h3>Questions to ask at your first call</h3><ul class="pp-ul">${guide.ask.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="pp-box"><h3>What to bring</h3><ul class="pp-ul">${guide.bring.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>${extra && extra.process ? `
    <div class="pp-box pp-wide"><h3>How the process usually works</h3><ol class="pp-ol">${extra.process.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
  </div>` : ''}
  <div class="pp-note"><span class="pp-note-ic" aria-hidden="true">&#9878;</span><p><b>Check before you hire.</b> You can confirm that a lawyer is licensed with the ${esc(P.regulator)}. If cost is a worry, ask whether ${esc(P.legalAid)} could help with your matter. LawDB is an independent directory: this page is general information, not legal advice.</p></div>

${s.n ? `  <h2 class="pp-h">Common questions</h2>
  <div class="pp-faq">${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>` : ''}

  <h2 class="pp-h">Other practice areas in ${esc(P.name)}</h2>
  <div class="pp-chips">${others.map(({ t, n }) => (t[0] === key ? `<span class="here">${esc(t[1])} lawyers <em>${n}</em></span>` : `<a href="/${dir}/${t[2]}">${esc(t[1])} lawyers <em>${n}</em></a>`)).join('')}</div>
${extra && extra.guides.length ? `  <h2 class="pp-h">Related guides</h2>\n  <ul class="pp-guides">${extra.guides.map((g) => `<li><a href="${esc(g.href)}">${esc(g.text)}</a></li>`).join('')}</ul>\n` : ''}  <div class="pp-see"><!--pp-see-->${seeAlso}<!--/pp-see--></div>
</div>`;

  let html = old;
  const i0 = html.indexOf('<div class="wrap');
  const foot = html.indexOf('<footer class="site-footer">');
  if (i0 < 0 || foot < 0) throw new Error(`${file}: the page frame was not found`);
  const end = html.lastIndexOf('</div>', foot) + '</div>'.length;
  html = html.slice(0, i0) + body + html.slice(end);

  // the style sheet and the script
  html = html.replace(/<link rel="stylesheet" href="\.\.\/province-pages\.css[^"]*">\s*/g, '').replace(/<script src="\.\.\/province-pages\.js[^"]*" defer><\/script>\s*/g, '');
  html = html.replace(/(<link rel="stylesheet" href="\.\.\/site\.css[^"]*">)/, `$1\n<link rel="stylesheet" href="../province-pages.css?v=${CSS_V}">`);
  html = html.replace(/(<script src="\.\.\/site\.js"[^>]*><\/script>)/, `<script src="../province-pages.js?v=${JS_V}" defer></script>\n$1`);
  if (extra) {
    // these pages used to carry the number of firms they listed at the time in the title, the description and the structured data: bring them up to date
    const t = `${esc(label)} Lawyers in ${esc(P.name)} | ${s.n ? `${s.n} ${plural(s.n, 'Firm', 'Firms')} | ` : ''}LawDB.ca`;
    const d = `Compare ${s.n ? `${s.n} ${plural(s.n, firmsPhrase(sent).replace(/ firms$/, ' firm'), firmsPhrase(sent))}` : `${sent} lawyers`} in ${esc(P.name)}. See Google ratings, review counts, addresses and phone numbers, and how to choose a lawyer.`;
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
      .replace(/(<meta name="description" content=")[^"]*"/, `$1${d}"`)
      .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${t}"`)
      .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${d}"`);
    html = html.replace(/<script type="application\/ld\+json"(?: id="pp-ld")?>\s*\[?\s*\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "CollectionPage"[\s\S]*?<\/script>\s*/, '').replace(/<script type="application\/ld\+json" id="pp-ld">[\s\S]*?<\/script>\s*/g, '');
    const url = `https://lawdb.ca/${dir}/${slug}`;
    html = html.replace('</head>', `<script type="application/ld+json" id="pp-ld">${jsonLd([
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: t.replace(/&amp;/g, '&'), url, description: d.replace(/&amp;/g, '&'), isPartOf: { '@type': 'WebSite', name: 'LawDB.ca', url: 'https://lawdb.ca/' } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [['Home', 'https://lawdb.ca/'], [P.name, `https://lawdb.ca/${dir}/`], [`${label} Lawyers`, url]].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name: name.replace(/&amp;/g, '&'), item })) },
    ])}</script>\n</head>`);
  }
  // the questions as structured data
  html = html.replace(/<script type="application\/ld\+json" id="pp-faq">[\s\S]*?<\/script>\s*/g, '');
  html = html.replace('</head>', `<script type="application/ld+json" id="pp-faq">${jsonLd({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })}</script>\n</head>`);
  return { old, html, n: s.n };
}

let stale = 0, pages = 0;
for (const [dir, code] of Object.entries(PROV)) {
  for (const t of TYPES) {
    const file = `${dir}/${t[2]}.html`;
    if (!existsSync(file)) continue;
    pages++;
    const built = build(file, code, dir, t);
    if (!built) { pages--; continue; }
    const { old, html } = built;
    if (html === old) continue;
    stale++;
    if (CHECK) { if (stale <= 5) console.error(`out of date: ${file}`); } else writeFileSync(file, html);
  }
}
if (CHECK) {
  if (stale) { console.error(`${stale} province practice ${plural(stale, 'page is', 'pages are')} out of date: run node scripts/build-province-pages.mjs`); process.exit(1); }
  console.log(`province practice pages are up to date (${pages} pages)`);
} else console.log(`province practice pages written: ${stale} of ${pages} changed`);
