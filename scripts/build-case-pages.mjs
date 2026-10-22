// Builds the national case-type guide pages (/family-lawyers, /criminal-defence-lawyers ... ten of them) from data/case-types.json, the
// "Browse lawyers by case type" picture cards on /find-lawyers (between <!--case-cards--> markers) and the "Or pick a case type" list on the
// home page (index.html, between <!--home-cases--> markers; the icons are symbols in the page's own sprite). Each guide is answer-first, general
// information about one kind of case, with plain links down to every province page and city page that exists for it, so the national page,
// the province page and the city page of a case type form one chain: /family-lawyers -> /ontario/family-lawyers -> /ontario/toronto/family-lawyers.
//   node scripts/build-case-pages.mjs          rewrites the pages and the cards
//   node scripts/build-case-pages.mjs --check  fails if anything is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const CHECK = process.argv.includes('--check');
const DATA = JSON.parse(readFileSync('data/case-types.json', 'utf8'));
const TYPES = Object.entries(DATA.types);
const SHELL = readFileSync('scripts/case-page.shell.html', 'utf8');
const SITE = 'https://lawdb.ca';
const PROVINCES = [['ontario', 'Ontario'], ['quebec', 'Quebec'], ['british-columbia', 'British Columbia'], ['alberta', 'Alberta'], ['manitoba', 'Manitoba']];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const indexable = (html) => !/<meta[^>]+name="robots"[^>]+noindex/i.test(html);
const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// the province pages and city pages that exist (and are indexable) for one case type, with the heading each page uses
function pagesFor(slug) {
  const out = [];
  for (const [dir, name] of PROVINCES) {
    const h1Of = (file) => {
      if (!existsSync(file)) return null;
      const html = readFileSync(file, 'utf8');
      const h = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      return h && indexable(html) ? unesc(h[1].trim()) : null;
    };
    const prov = h1Of(`${dir}/${slug}.html`);
    const cities = [];
    if (existsSync(dir)) {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || !existsSync(`${dir}/${d.name}/index.html`)) continue;
        const hub = readFileSync(`${dir}/${d.name}/index.html`, 'utf8').match(/<h2>Law firms in ([^<,]+), ([^<]+)<\/h2>/);
        const label = h1Of(`${dir}/${d.name}/${slug}.html`);
        if (hub && label) cities.push({ city: unesc(hub[1]), label, href: `/${dir}/${d.name}/${slug}` });
      }
    }
    cities.sort((a, b) => a.city.localeCompare(b.city, 'en'));
    if (prov || cities.length) out.push({ dir, name, prov: prov ? { label: prov, href: `/${dir}/${slug}` } : null, cities });
  }
  return out;
}

const EXTRA_CSS = `<style>
  .case-hero{ margin:4px 0 16px; border-radius:14px; overflow:hidden; max-width:520px; background:#f4ecd8; }
  .case-hero img{ display:block; width:100%; height:auto; }
  @media(min-width:860px){ .case-hero{ float:right; width:340px; margin:6px 0 16px 28px; } }
  .case-updated{ font-size:12.5px; color:var(--ink-soft); margin:2px 0 0; }
  .wrap h3{ font-family:'Source Serif 4',serif; font-size:18px; margin:22px 0 8px; }
  .case-prov-block{ clear:both; }
</style>`;

function pageHtml([id, t]) {
  const url = `${SITE}/${t.slug}`;
  const title = `${t.h1} | LawDB.ca`;
  const pages = pagesFor(t.slug);
  const crumbName = `${t.name} Lawyers`;
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: t.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const pageLd = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, url, description: t.description, dateModified: DATA.updated, isPartOf: { '@type': 'WebSite', name: 'LawDB.ca', url: `${SITE}/` } };
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Find a lawyer', item: `${SITE}/find-lawyers` },
    { '@type': 'ListItem', position: 3, name: crumbName, item: url }] };
  const ld = [pageLd, crumbLd, faqLd].map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 1)}\n</script>`).join('\n');
  const head = [
    '<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/images/apple-touch-icon.png">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(t.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website"><meta property="og:url" content="${url}"><meta property="og:site_name" content="LawDB.ca"><meta property="og:locale" content="en_CA">`,
    `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(t.description)}">`,
    `<meta property="og:image" content="${SITE}/images/og-default.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`,
    ld, EXTRA_CSS].join('\n');

  const ul = (items) => `<ul class="seo-ul">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const chips = pages.filter((p) => p.prov).map((p) => `<a class="seo-chip" href="${p.prov.href}">${esc(p.prov.label)}</a>`).join('');
  const byCity = pages.filter((p) => p.cities.length).map((p) => `<div class="case-prov-block"><h3>${esc(p.name)}</h3><ul class="seo-all">${p.cities.map((c) => `<li><a href="${c.href}">${esc(c.label)}</a></li>`).join('')}</ul></div>`).join('');
  const others = TYPES.filter(([k]) => k !== id).map(([, o]) => `<a class="seo-chip" href="/${o.slug}">${esc(o.name)}</a>`).join('');
  const faq = t.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');

  const body = `
<div class="wrap">
  <div class="crumb"><a href="/">Home</a> &rsaquo; <a href="/find-lawyers">Find a lawyer</a> &rsaquo; ${esc(crumbName)}</div>
  <h1>${esc(t.h1)}</h1>
  <figure class="case-hero"><img src="/images/cases/${t.image}" alt="${esc(t.alt)}" width="640" height="400" fetchpriority="high"></figure>
  <div class="seo-text"><p>${esc(t.lede)}</p></div>
  <p class="case-updated">Last updated ${longDate(DATA.updated)}. General information, not legal advice.</p>
  <h2 class="seo-h">Find a ${esc(t.noun)} by province</h2>
  <div class="seo-chips">${chips}</div>
  <h2 class="seo-h">When to speak to a ${esc(t.noun)}</h2>
  ${ul(t.when)}
  <h2 class="seo-h">What a ${esc(t.noun)} does</h2>
  ${ul(t.does)}
  <h2 class="seo-h">How the rules differ across Canada</h2>
  <div class="seo-text"><p>${esc(t.differ)}</p></div>
  <h2 class="seo-h">Questions to ask before you hire a ${esc(t.noun)}</h2>
  ${ul(t.ask)}
  <h2 class="seo-h">${esc(t.name)} lawyers by city</h2>
  ${byCity}
  <h2 class="seo-h">Frequently asked questions</h2>
  <div class="seo-faq">${faq}</div>
  <h2 class="seo-h">Other practice areas</h2>
  <div class="seo-chips">${others}</div>
  <p class="seo-note">This page is general information about legal topics in Canada, not legal advice. Laws change and differ by province, so speak to a licensed lawyer about your situation. LawDB is an independent directory: ratings shown are public Google ratings, and a firm cannot pay to change them. <a href="/find-lawyers">Search by city or case type</a>.</p>
</div>`;
  return SHELL.replace('%%HEAD%%', () => head).replace('%%BODY%%', () => body);
}

// the picture cards on /find-lawyers
function cardsHtml() {
  const cards = TYPES.map(([, t]) => `<a class="case-card" href="/${t.slug}"><img src="/images/cases/${t.image}" alt="" width="640" height="400" loading="lazy" decoding="async"><div class="cc-body"><h3>${esc(t.name)}</h3><p>${esc(t.card)}</p><span class="cc-go">Read the guide</span></div></a>`).join('');
  return '<!--case-cards--><section class="cases" id="cases" aria-labelledby="casesH"><h2 id="casesH">Not sure where to start? Browse by case type</h2>'
    + '<p class="cases-sub">Each guide explains when to hire a lawyer, what the lawyer does and what to ask, and links to firms by province and city.</p>'
    + `<div class="case-cards">${cards}</div></section><!--/case-cards-->`;
}

// the "Or pick a case type" list on the home page
function homeCasesHtml() {
  const li = ([, t]) => `<li><a href="/${t.slug}"><span class="h4-ic"><svg width="22" height="22" aria-hidden="true"><use href="#i-${t.icon}"/></svg></span><span class="h4-cl">${esc(t.homeLabel)}</span><svg class="h4-chev" width="16" height="16" aria-hidden="true"><use href="#i-chev"/></svg></a></li>`;
  const order = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation']; // the order the case types have always had on the site
  return `<!--home-cases--><ul class="h4-case-grid">${order.map((k) => li([k, DATA.types[k]])).join('')}</ul><!--/home-cases-->`;
}

let stale = 0, written = 0;
const put = (file, html) => {
  const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (old === html) return;
  if (CHECK) { stale++; console.error(`out of date: ${file}`); return; }
  writeFileSync(file, html); written++;
};
for (const entry of TYPES) put(`${entry[1].slug}.html`, pageHtml(entry));

const find = readFileSync('find-lawyers.html', 'utf8');
if (!find.includes('<!--case-cards-->')) { console.error('find-lawyers.html has no <!--case-cards--> marker'); process.exit(1); }
put('find-lawyers.html', find.replace(/<!--case-cards-->[\s\S]*?<!--\/case-cards-->/, () => cardsHtml()));

const home = readFileSync('index.html', 'utf8');
if (!home.includes('<!--home-cases-->')) { console.error('index.html has no <!--home-cases--> marker'); process.exit(1); }
put('index.html', home.replace(/<!--home-cases-->[\s\S]*?<!--\/home-cases-->/, () => homeCasesHtml()));

if (CHECK) { if (stale) process.exit(1); console.log(`case pages and cards are up to date (${TYPES.length} pages)`); }
else console.log(`${written} file(s) written (${TYPES.length} case pages, the cards on /find-lawyers and the list on the home page)`);
