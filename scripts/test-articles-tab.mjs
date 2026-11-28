// A firm's Articles page (/<slug>/articles; src/lib/articles.js, src/render/firm-page.js, src/routes/firm-page.js, src/routes/firm-sitemap.js):
//   node --no-warnings scripts/test-articles-tab.mjs
// Every firm with enough articles has the tab and none at the bottom of its Overview; it lists what LawDB News lists, is its own page (title, description, h1, canonical,
// markup, sitemap), only a Featured firm's page is offered to search engines, and a firm without enough articles has no tab, no link and a 404, never an empty page.
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { MIN_ARTICLES, MAX_ARTICLES, shownArticles, articlesTabOn, articlesIndexable, listArticles, indexableArticleSlugs } from '../src/lib/articles.js';
import { renderFirmPage } from '../src/render/firm-page.js';
import { firmSitemap } from '../src/routes/firm-sitemap.js';
import { firmPage } from '../src/routes/firm-page.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

// ---- what counts as an article
const post = (n, extra = {}) => ({ id: n, title: `Article number ${n} about the law`, url: `https://firm.example/blog/${n}`, publishedAt: `2026-11-${String(30 - n).padStart(2, '0')} 10:00:00`, excerpt: `Preview ${n}`, image: `https://firm.example/img/photo-${n}.jpg`, ...extra });
ok(MIN_ARTICLES === 3 && MAX_ARTICLES === 20, 'three articles make a page; at most twenty are shown (the stories kept per firm)');
{
  const rows = [post(1), post(2, { title: 'Hello world!' }), post(3, { image: 'https://firm.example/uploads/team/headshot-ann.jpg' }), post(4, { title: 'Ann welcomes a new partner to the firm' }), post(5, { image: '' }), post(6, { url: 'https://firm.example/blog/1' }), post(7)];
  const shown = shownArticles(rows, 'a-firm');
  ok(shown.map((a) => a.id).join() === '1,7', 'an untouched "Hello world", a headshot, a "welcomes" announcement, an article with no picture and a repeat of the same address are left out');
  ok(shown.every((a) => /^\/news\/a-firm\/[a-z0-9-]+-\d+$/.test(a.storyHref)), 'each article gets the address of its LawDB story page');
  ok(shownArticles(Array.from({ length: 30 }, (_, i) => post(i + 1)), 'x').length === 20, 'no more than 20');
  ok(shownArticles(null, 'x').length === 0, 'nothing in, nothing out');
  const ent = shownArticles([post(1, { title: 'Wills &amp; estates &#8211; the basics', excerpt: 'By Ann &middot; Barrister &amp; Solicitor &middot; Firm&reg; &middot; October 2026 Short answer: yes.' })], 'a-firm')[0];
  ok(ent.title === 'Wills & estates \u2013 the basics' && ent.excerpt === 'By Ann \u00b7 Barrister & Solicitor \u00b7 Firm\u00ae \u00b7 October 2026 Short answer: yes.', 'raw entities in a headline or preview are shown as the characters they stand for');
  ok(ent.storyHref === `/news/a-firm/${'wills-amp-estates-8211-the-basics'}-1` || /^\/news\/a-firm\/wills-[a-z0-9-]+-1$/.test(ent.storyHref), 'and the story address is still made from the stored title');
}
// ---- when the tab exists
{
  const three = shownArticles([post(1), post(2), post(3)], 'f');
  ok(articlesTabOn(three), 'a firm with three articles has the tab, Featured or not');
  ok(!articlesTabOn(three.slice(0, 2)) && !articlesTabOn([]), 'two articles are not enough');
  ok(!articlesTabOn(null) && !articlesTabOn(undefined) && !articlesTabOn('x'), 'no list: no tab');
  ok(articlesIndexable({ featured: true }) && !articlesIndexable({ featured: false }) && !articlesIndexable({}) && !articlesIndexable(null), 'only a Featured firm\'s page is offered to search engines');
}

// ---- the queries, on a real database
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE firms (slug TEXT PRIMARY KEY, handle TEXT, data TEXT, status TEXT, about TEXT, updated_at TEXT, featured INTEGER DEFAULT 0)");
db.exec('CREATE TABLE firm_feeds (firm_slug TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, page_only INTEGER DEFAULT 0, source TEXT DEFAULT \'auto\')');
db.exec('CREATE TABLE firm_posts (id INTEGER PRIMARY KEY, firm_slug TEXT, title TEXT, url TEXT, published_at TEXT, excerpt TEXT, image_url TEXT)');
const d1 = { prepare(sql) { const st = db.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; }, async first() { return st.get(...a) ?? null; }, async all() { return { results: st.all(...a) }; } }; return o; } };
const env = { DB: d1, SITE_ORIGIN: 'https://lawdb.ca' };
const words = 'x '.repeat(60);
let nextId = 100;
const addFirm = (slug, featured, { feed = 1, posts = 0, status = 'live', lawyers = null } = {}) => {
  db.prepare('INSERT INTO firms (slug, data, status, about, updated_at, featured) VALUES (?,?,?,?,?,?)').run(slug, JSON.stringify({ slug, name: slug, ...(lawyers ? { lawyers } : {}) }), status, words, '2026-11-20 10:00:00', featured ? 1 : 0);
  db.prepare('INSERT INTO firm_feeds (firm_slug, enabled) VALUES (?,?)').run(slug, feed);
  for (let i = 1; i <= posts; i++) { const p = post(i); db.prepare('INSERT INTO firm_posts (id, firm_slug, title, url, published_at, excerpt, image_url) VALUES (?,?,?,?,?,?,?)').run(nextId++, slug, p.title, p.url, p.publishedAt, p.excerpt, p.image); }
};
addFirm('feat-many', true, { posts: 8 });
addFirm('feat-two', true, { posts: 2 });
addFirm('feat-off', true, { posts: 6, feed: 0 });
addFirm('basic-many', false, { posts: 10 });
addFirm('feat-closed', true, { posts: 6, status: 'closed' });
addFirm('basic-hold', false, { posts: 5 });
db.prepare('UPDATE firm_feeds SET page_only = 1 WHERE firm_slug = ?').run('basic-hold'); // an admin holds this Basic firm's blog to its own page
{
  const list = await listArticles(env, 'feat-many');
  ok(list.length === 8 && list.every((a, i) => i === 0 || list[i - 1].publishedAt >= a.publishedAt), 'a firm\'s articles, newest first');
  ok(list.every((a) => a.storyHref.startsWith('/news/feat-many/')), 'each with its story page');
  ok((await listArticles(env, 'feat-off')).length === 0, 'a blog that is switched off has none');
  ok((await listArticles(env, 'nobody')).length === 0, 'an unknown firm has none');
  const basic = await listArticles(env, 'basic-many');
  ok(basic.length === 10 && basic.every((a) => a.storyHref.startsWith('/news/basic-many/')), 'a Basic firm has its articles too, each with its story page');
  const held = await listArticles(env, 'basic-hold');
  ok(held.length === 5 && held.every((a) => !a.storyHref && !a.id && /^https:\/\/firm\.example\/blog\//.test(a.url)), 'a Basic firm held to its own page has no story pages: its cards go straight to the firm\'s article');
  ok((await listArticles(env, 'feat-closed')).length === 0, 'a closed firm has none');
  const slugs = await indexableArticleSlugs(env);
  ok([...slugs].join() === 'feat-many', 'for the sitemap: only a live, Featured firm with enough articles and its blog on (not two articles, not a switched-off blog, not a Basic firm, not a closed firm)');
}

// ---- the page
const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
for (const f of readdirSync('data').filter((x) => /^firms-batch-\d+\.json$/.test(x))) all.push(...JSON.parse(readFileSync(`data/${f}`, 'utf8')));
const copy = JSON.parse(readFileSync('data/firm-copy.json', 'utf8'));
const lawyersData = JSON.parse(readFileSync('data/firm-lawyers.json', 'utf8'));
const base = all.find((x) => x.slug === 'mincher-koeman-law-chambers-calgary');
const slug = base.slug;
const arts = shownArticles(Array.from({ length: 6 }, (_, i) => post(i + 1, i === 1 ? { title: 'Why <b>you</b> need "a will" & a plan' } : {})), slug);
const featured = { ...base, about: copy[slug], featured: true };
const basic = { ...base, about: copy[slug], featured: false };
const render = (firm, view, articles = arts) => renderFirmPage({ firm, hours: null, images: [], articles, nearby: [], locations: [], origin: 'https://lawdb.ca', view });
const parts = (html) => ({
  title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '',
  desc: ((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  canon: (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || '',
  h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => m[1]),
  ld: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }),
});
const tabs = (h) => (h.match(/<nav class="pf-tabs"[\s\S]*?<\/nav>/) || [''])[0];
const ov = render(featured, null), pg = render(featured, { tab: 'articles' });
const P = parts(pg), O = parts(ov);
ok(/<a href="\/[^"]+">Overview<\/a>/.test(tabs(pg)) && /href="\/[^"]+\/articles" aria-current="page">Articles <span class="n">6<\/span>/.test(tabs(pg)), 'the tab bar has Overview and Articles with their count, and Articles is the open one (plain links)');
ok(/href="\/[^"]+\/articles">Articles <span class="n">6<\/span>/.test(tabs(ov)) && /aria-current="page">Overview/.test(tabs(ov)), 'the Overview has the same bar with Overview open');
ok(!ov.includes('class="fa"') && !ov.includes('class="fa-row"') && !ov.includes('Recent articles') && !ov.includes('Article number'), 'the Overview has no articles on it: they are all on the Articles page');
ok(P.canon === `https://lawdb.ca/${slug}/articles` && O.canon === `https://lawdb.ca/${slug}`, 'the page is its own canonical');
ok(P.title === `${base.name} – Articles from ${base.city} | LawDB` && P.title !== O.title && P.desc !== O.desc, `its own title: "${P.title}", and its own description`);
ok(P.h1.length === 1 && P.h1[0] === `Articles by ${base.name}`, 'one h1: "Articles by <firm>"');
ok(P.desc.length >= 60 && P.desc.length <= 160 && /6 recent articles/.test(P.desc), `the description fits a search result (${P.desc.length} characters)`);
{
  const q = shownArticles([post(1, { title: 'Who can witness a will in Ontario?' }), post(2, { title: 'Closing day!' }), post(3)], slug);
  const d = parts(render(featured, { tab: 'articles' }, q)).desc;
  ok(!/[?!.]\.\s/.test(d) && !/[?!]\./.test(d) && /Previews on LawDB\.$/.test(d) && d.length <= 160, `no doubled punctuation after a headline that ends in ? or ! ("${d}")`);
}
ok(P.ld.every(Boolean) && P.ld.some((j) => j['@type'] === 'LegalService') && P.ld.some((j) => j['@type'] === 'BreadcrumbList'), 'the markup is valid JSON, with the firm and the breadcrumbs');
const col = P.ld.find((j) => j['@type'] === 'CollectionPage');
ok(col && col.mainEntity['@type'] === 'ItemList' && col.mainEntity.itemListElement.length === 6 && col.mainEntity.itemListElement.every((e, i) => e.position === i + 1 && /^https:\/\/lawdb\.ca\/news\/[a-z0-9-]+\/[a-z0-9-]+-\d+$/.test(e.url) && e.name), 'a CollectionPage lists every article by the full address of its story page');
const crumbs = P.ld.find((j) => j['@type'] === 'BreadcrumbList').itemListElement;
ok(crumbs.at(-1).name === 'Articles' && crumbs.at(-2).name === base.name && crumbs.every((c, i) => c.position === i + 1) && crumbs.length === 6, 'breadcrumbs: Home, Canada, Province, City, Firm, Articles');
ok(articlesHrefs(pg).length === 6 && articlesHrefs(pg).every((h) => /^\/news\/[a-z0-9-]+\/[a-z0-9-]+-\d+$/.test(h)), 'every article links to its LawDB story page');
function articlesHrefs(h) { return [...h.matchAll(/<a class="fa-main" href="([^"]+)"/g)].map((m) => m[1]); }
ok(!pg.includes('<b>you</b>') && !pg.includes('&lt;b&gt;') && pg.includes('Why you need &quot;a will&quot; &amp; a plan'), 'markup in a headline is removed and the rest is shown as text');
ok(!/(?:href|src)="\.\.\//.test(pg), 'no relative "../" links on the nested page');
ok(pg.includes(`href="/${slug}#contact"`) && !pg.includes('data-open-contact'), 'the Request a consultation buttons (card and phone bar) go to the firm\'s contact form on the Overview');
ok(/<p class="li-name">/.test(pg) && !/<h1[^>]*class="li-name"/.test(pg), 'the firm card does not add a second h1');

// pages that must not exist, and tabs that must not show
{
  const b = render(basic, { tab: 'articles' }), P2 = parts(b);
  ok(b !== null && /href="\/[^"]+\/articles" aria-current="page">Articles <span class="n">6<\/span>/.test(tabs(b)) && articlesHrefs(b).length === 6, 'a Basic firm with six articles has the Articles page and tab too, with its articles on it');
  const bo = render(basic, null);
  ok(/href="\/[^"]+\/articles">Articles <span class="n">6<\/span>/.test(tabs(bo)) && !bo.includes('class="fa-row"'), 'and its Overview shows the tab but no articles');
  ok(P2.canon === `https://lawdb.ca/${slug}/articles` && P2.h1.length === 1, 'with its own canonical and one h1');
}
for (const [label, firm] of [['Featured', featured], ['Basic', basic]]) {
  ok(render(firm, { tab: 'articles' }, arts.slice(0, 2)) === null && !render(firm, null, arts.slice(0, 2)).includes(`/${slug}/articles`), `a ${label} firm with two articles: no page, no tab, no link`);
  ok(render(firm, { tab: 'articles' }, []) === null && !tabs(render(firm, null, [])), `a ${label} firm with none: no page, and with only an Overview there is no tab bar at all`);
  ok(renderFirmPage({ firm, view: { tab: 'articles' } }) === null, `${label}: with no articles passed at all, no page`);
  ok(!render(firm, null, arts.slice(0, 2)).includes('class="fa-row"'), `${label}: the two articles it has are not dumped on the Overview either`);
}

// together with the Lawyers tab
const withLawyers = { ...featured, lawyers: lawyersData[slug] };
{
  const h = render(withLawyers, null);
  const names = [...tabs(h).matchAll(/<a href="[^"]+"[^>]*>([A-Za-z]+)/g)].map((m) => m[1]);
  ok(names.join() === 'Overview,Lawyers,Articles', 'with lawyers and articles the tabs are Overview, Lawyers, Articles, in that order');
  const L = render(withLawyers, { tab: 'lawyers' }), A = render(withLawyers, { tab: 'articles' });
  ok(/aria-current="page">Lawyers/.test(tabs(L)) && /aria-current="page">Articles/.test(tabs(A)), 'the open tab is marked on each');
  const t = [O.title, parts(L).title, parts(A).title];
  ok(new Set(t).size === 3 && new Set([O.canon, parts(L).canon, parts(A).canon]).size === 3, 'the three pages have different titles and canonicals');
  const lawyerPage = lawyersData[slug].length && render(withLawyers, { tab: 'lawyer', lawyer: 'abhinav-lilothia' });
  ok(!lawyerPage || /aria-current="page">Lawyers/.test(tabs(lawyerPage)) && /href="[^"]+\/articles">Articles/.test(tabs(lawyerPage)), 'a lawyer\'s page keeps the Lawyers tab open and shows the Articles tab');
}
// a basic firm has the same three tabs
{
  const h = render({ ...basic, lawyers: lawyersData[slug] }, null);
  const names = [...tabs(h).matchAll(/<a href="[^"]+"[^>]*>([A-Za-z]+)/g)].map((m) => m[1]);
  ok(names.join() === 'Overview,Lawyers,Articles', 'a Basic firm with lawyers and articles has Overview, Lawyers, Articles too');
  ok(/Lawyers/.test(tabs(render({ ...basic, lawyers: lawyersData[slug] }, null, arts.slice(0, 2)))) && !/Articles/.test(tabs(render({ ...basic, lawyers: lawyersData[slug] }, null, arts.slice(0, 2)))), 'with two articles it keeps the Lawyers tab and has no Articles tab');
}

// ---- the sitemap
{
  const res = await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env });
  const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(locs.includes('https://lawdb.ca/feat-many') && locs.includes('https://lawdb.ca/feat-many/articles'), 'the sitemap lists a Featured firm with enough articles and its Articles page');
  ok(!locs.some((u) => /\/(feat-two|feat-off|basic-many|feat-closed)\/articles$/.test(u)) && locs.includes('https://lawdb.ca/basic-many'), 'and no Articles page for a firm with two articles, a switched-off blog, a closed firm or the Basic plan (a Basic firm\'s Articles page is for visitors, noindex; the firm\'s own page stays)');
  ok(new Set(locs).size === locs.length, 'no address twice');
  const broken = await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env: { ...env, DB: { prepare(sql) { if (/firm_posts/.test(sql)) throw new Error('boom'); return d1.prepare(sql); } } } });
  ok(broken.status === 200 && (await broken.text()).includes('/feat-many</loc>'), 'if the article lookup fails the sitemap is still served, without Articles pages');
}

// ---- the address
{
  const calls = [];
  const assets = { fetch: async (r) => { calls.push(new URL(r.url).pathname); return new Response('', { status: 404 }); } };
  const envR = { ASSETS: assets, PUBLIC_CACHE_TTL: '0', DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }), first: async () => null, all: async () => ({ results: [] }) }) } };
  const slash = await firmPage({ request: new Request('https://lawdb.ca/a-firm/articles/?x=1'), env: envR });
  ok(slash.status === 301 && slash.headers.get('location') === '/a-firm/articles?x=1', 'a trailing slash goes to the one address (301)');
  await firmPage({ request: new Request('https://lawdb.ca/a-firm/articles/second'), env: envR });
  ok(calls.includes('/a-firm/articles/second'), 'there is nothing under /articles: a longer address is not a page');
  await firmPage({ request: new Request('https://lawdb.ca/no-such-firm/articles'), env: envR });
  ok(calls.includes('/no-such-firm/articles'), 'an unknown firm\'s Articles address is a 404');
}

// ---- the wiring and the product copy
const route = readFileSync('src/routes/firm-page.js', 'utf8');
ok(/\(lawyers\|articles\)/.test(route) && /await listArticles\(env, slug\)/.test(route) && !/row\.featured \? await listArticles/.test(route) && !/feedPosts/.test(route), 'the route knows the address and asks for every firm\'s articles (no separate list for the Overview)');
ok(/view\?\.tab === 'articles' && !articlesIndexable\(row\)/.test(route), 'a Basic firm\'s Articles page gets the noindex tag and header');
ok(/CACHE_GENERATION = (?:[89]|\d\d)\b/.test(route), 'pages drawn with articles on the Overview are not served from the cache');
{
  const perks = [readFileSync('src/lib/email.js', 'utf8'), readFileSync('admin/ui.js', 'utf8')];
  ok(perks.every((t) => !/an Articles tab on your profile/.test(t) && /Articles page on your profile that search engines can find/.test(t)), 'the Featured perks the owner and the emails list no longer sell the tab (every firm has it): they say a Featured firm\'s Articles page is one search engines can find');
}

console.log(bad ? `\n${bad} check(s) failed` : '\nall articles tab checks passed');
process.exit(bad ? 1 : 0);
