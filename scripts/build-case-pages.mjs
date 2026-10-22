// Builds the national case-type guide pages (/family-lawyers, /criminal-defence-lawyers ... ten of them) from data/case-types.json, the
// "Browse lawyers by case type" cards on /find-lawyers (between <!--case-cards--> markers) and the "Or pick a case type" list on the
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
  /* the guide: a navy header with one next step, then a few calm cards (palette colours only) */
  .cg-hero{ background:#142434; color:#fff; padding:26px 20px 34px; border-bottom:3px solid #c9a050; }
  .cg-in{ max-width:1040px; margin:0 auto; }
  .cg-crumb{ margin:0 0 20px; font-size:12.5px; color:#b4bac4; }
  .cg-crumb a{ color:#e2bd6a; text-decoration:none; }
  .cg-eyebrow{ margin:0 0 10px; font:600 12px/1.6 Inter,sans-serif; letter-spacing:.2em; text-transform:uppercase; color:#e2bd6a; }
  .cg-hero h1{ margin:0 0 14px; font:700 clamp(30px,7.6vw,46px)/1.1 'Source Serif 4',serif; letter-spacing:-.01em; color:#fff; max-width:19em; text-wrap:balance; }
  .cg-lede{ margin:0 0 22px; max-width:40em; font-size:16.5px; line-height:1.6; color:#edeae1; }
  .cg-cta{ display:flex; flex-wrap:wrap; align-items:center; gap:12px 22px; }
  .cg-btn{ display:inline-flex; align-items:center; justify-content:center; gap:10px; min-height:52px; padding:0 28px; border-radius:999px; background:linear-gradient(180deg,#e2bd6a 0%,#c9a050 100%); color:#142434; font:600 16.5px Inter,sans-serif; text-decoration:none; box-shadow:0 8px 20px rgba(20,36,52,0.3); }
  .cg-btn:hover{ background:#e2bd6a; }
  .cg-jump{ color:#e2bd6a; font:600 15px Inter,sans-serif; text-decoration:none; }
  .cg-jump:hover{ text-decoration:underline; }
  .cg-updated{ margin:20px 0 0; font-size:12.5px; line-height:1.5; color:#b4bac4; }
  .cg-body{ max-width:1040px; margin:0 auto; padding:26px 20px 56px; display:grid; gap:18px; }
  .cg-row{ display:grid; grid-template-columns:minmax(0,1fr); gap:18px; align-items:start; }
  .cg-card{ background:#fff; border:1px solid #e3dfd3; border-radius:20px; padding:22px 22px 18px; }
  .cg-card h2, .cg-where > h2, .cg-faq > h2, .cg-more > h2{ margin:0 0 14px; font:700 21px/1.25 'Source Serif 4',serif; color:#142434; text-wrap:balance; }
  .cg-list{ list-style:none; margin:0; padding:0; }
  .cg-list li{ position:relative; margin:0 0 11px; padding-left:30px; font-size:15.5px; line-height:1.55; color:#2b3a4c; }
  .cg-list li::before{ content:'\\2713'; position:absolute; left:0; top:1px; width:20px; height:20px; border-radius:50%; background:#f4ecd8; color:#8a6224; font:700 12px/20px Inter,sans-serif; text-align:center; }
  ol.cg-list{ counter-reset:q; }
  ol.cg-list li{ counter-increment:q; }
  ol.cg-list li::before{ content:counter(q); background:#c9a050; color:#142434; }
  .cg-note{ background:#f4ecd8; border:1px solid #e6d4a4; border-radius:20px; padding:22px 22px 18px; border-left:5px solid #c9a050; }
  .cg-note h2{ margin:0 0 10px; font:700 21px/1.25 'Source Serif 4',serif; color:#142434; text-wrap:balance; }
  .cg-note p{ margin:0 0 6px; font-size:15.5px; line-height:1.65; color:#2b3a4c; }
  .cg-where > p{ margin:-6px 0 16px; font-size:15px; color:#586170; }
  .cg-provs{ background:#fff; border:1px solid #e3dfd3; border-radius:20px; padding:2px 20px; }
  .cg-prov{ display:grid; grid-template-columns:minmax(0,1fr); gap:10px; padding:16px 0; border-top:1px solid #e3dfd3; }
  .cg-prov:first-child{ border-top:0; }
  .cg-prov h3{ margin:0; font:700 17px/1.3 'Source Serif 4',serif; }
  .cg-prov h3 a{ color:#142434; text-decoration:none; border-bottom:2px solid #e6d4a4; }
  .cg-prov h3 a:hover{ border-bottom-color:#c9a050; }
  .cg-pills{ display:flex; flex-wrap:wrap; gap:7px; }
  .cg-pills a, .cg-chips a{ display:inline-block; padding:7px 13px; border:1px solid #e3dfd3; border-radius:999px; background:#f5f3ec; color:#142434; font:600 13.5px/1.3 Inter,sans-serif; text-decoration:none; }
  .cg-pills a:hover, .cg-chips a:hover{ background:#f4ecd8; border-color:#c9a050; }
  .cg-faq details{ background:#fff; border:1px solid #e3dfd3; border-radius:14px; margin:0 0 8px; }
  .cg-faq summary{ cursor:pointer; padding:15px 18px; font:600 15.5px/1.4 Inter,sans-serif; color:#142434; }
  .cg-faq details[open] summary{ color:#8a6224; }
  .cg-faq p{ margin:0; padding:0 18px 16px; font-size:15px; line-height:1.7; color:#2b3a4c; }
  .cg-chips{ display:flex; flex-wrap:wrap; gap:8px; }
  .cg-small{ margin:6px 0 0; font-size:12.5px; line-height:1.6; color:#586170; }
  .cg-small a{ color:#8a6224; }
  @media(max-width:759px){
    .cg-lede{ font-size:16px; line-height:1.55; }
    .cg-card, .cg-note{ padding:18px 18px 10px; }
    .cg-card h2, .cg-note h2, .cg-where > h2, .cg-faq > h2, .cg-more > h2{ font-size:19.5px; margin-bottom:12px; }
    .cg-list li{ margin-bottom:9px; padding-left:28px; font-size:15px; line-height:1.5; }
    .cg-body{ gap:14px; }
    .cg-row{ gap:14px; }
  }
  @media(min-width:760px){
    .cg-hero{ padding:34px 32px 44px; }
    .cg-body{ padding:34px 32px 72px; gap:22px; }
    .cg-row{ grid-template-columns:repeat(2,minmax(0,1fr)); gap:22px; }
    .cg-card{ padding:26px 28px 20px; }
    .cg-provs{ padding:4px 28px; }
    .cg-prov{ grid-template-columns:minmax(0,290px) minmax(0,1fr); gap:28px; align-items:center; }
  }
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

  const list = (items, tag = 'ul') => `<${tag} class="cg-list">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`;
  // one block per province: the province page (full descriptive link) and a pill for each city page
  const where = pages.filter((p) => p.prov || p.cities.length).map((p) => `<div class="cg-prov"><h3>${p.prov ? `<a href="${p.prov.href}">${esc(p.prov.label)}</a>` : esc(p.name)}</h3>${p.cities.length ? `<div class="cg-pills">${p.cities.map((c) => `<a href="${c.href}" title="${esc(c.label)}">${esc(c.city)}</a>`).join('')}</div>` : ''}</div>`).join('');
  const others = TYPES.filter(([k]) => k !== id).map(([, o]) => `<a href="/${o.slug}">${esc(o.name)}</a>`).join('');
  const faq = t.faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');

  const body = `
<header class="cg-hero">
  <div class="cg-in">
    <div class="cg-crumb"><a href="/">Home</a> &rsaquo; <a href="/find-lawyers">Find a lawyer</a> &rsaquo; ${esc(crumbName)}</div>
    <p class="cg-eyebrow">Case guide</p>
    <h1>${esc(t.h1)}</h1>
    <p class="cg-lede">${esc(t.lede)}</p>
    <div class="cg-cta"><a class="cg-btn" href="/find-lawyers?case=${id}">Find a ${esc(t.noun)}</a><a class="cg-jump" href="#where">Browse by province and city &darr;</a></div>
    <p class="cg-updated">Last updated ${longDate(DATA.updated)}. General information, not legal advice.</p>
  </div>
</header>
<main class="cg-body">
  <div class="cg-row">
    <section class="cg-card"><h2>When to speak to a ${esc(t.noun)}</h2>${list(t.when)}</section>
    <section class="cg-card"><h2>What a ${esc(t.noun)} does</h2>${list(t.does)}</section>
  </div>
  <div class="cg-row">
    <section class="cg-note"><h2>How the rules differ across Canada</h2><p>${esc(t.differ)}</p></section>
    <section class="cg-card"><h2>Questions to ask before you hire a ${esc(t.noun)}</h2>${list(t.ask, 'ol')}</section>
  </div>
  <section class="cg-where" id="where"><h2>${esc(t.name)} lawyers by province and city</h2><p>Pick a province for every firm we list there, or a city to go straight to its lawyers.</p><div class="cg-provs">${where}</div></section>
  <section class="cg-faq"><h2>Frequently asked questions</h2>${faq}</section>
  <section class="cg-more"><h2>Other practice areas</h2><div class="cg-chips">${others}</div></section>
  <p class="cg-small">This page is general information about legal topics in Canada, not legal advice. Laws change and differ by province, so speak to a licensed lawyer about your situation. LawDB is an independent directory: ratings shown are public Google ratings, and a firm cannot pay to change them. <a href="/find-lawyers">Search by city or case type</a>.</p>
</main>`;
  return SHELL.replace('%%HEAD%%', () => head).replace('%%BODY%%', () => body);
}

// the cards on /find-lawyers
function cardsHtml() {
  const cards = TYPES.map(([, t]) => `<a class="case-card" href="/${t.slug}"><div class="cc-body"><h3>${esc(t.name)}</h3><p>${esc(t.card)}</p><span class="cc-go">Read the guide</span></div></a>`).join('');
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
