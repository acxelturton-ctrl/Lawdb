// Rules that keep LawDB acceptable to Google, and that stop the sitemaps from silently shrinking as the site grows.
//   node scripts/test-seo-rules.mjs
//  - a link out to a firm's own website or article is never a plain followed link (nofollow, or sponsored for a Featured firm, whose placement is paid for);
//  - a firm page's structured data carries a breadcrumb that matches the visible one, and no rating of its own;
//  - a story page always has a real meta description;
//  - the firms and stories sitemaps have room to grow, say so when they are cut off, and a story's lastmod is when it was published, not when we last fetched it.
import { readFileSync } from 'node:fs';
import { renderFirmPage } from '../src/render/firm-page.js';
import { renderStoryPage } from '../src/render/story-page.js';
import { cardHtml, renderFirmArticles } from '../src/render/blog-cards.js';
import { firmSitemap, FIRM_SITEMAP_LIMIT } from '../src/routes/firm-sitemap.js';
import { storySitemap, STORY_SITEMAP_LIMIT } from '../src/routes/story-page.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };

const firm = { name: 'Zubic Law', slug: 'zubic-law', city: 'Niagara Falls', province: 'ON', address: '1 Main St', phone: '+19055550100', website: 'https://zubic.example', tags: ['Family Law'], caseTypes: ['family'], about: 'We act for families.' };
const anchors = (html, host) => [...html.matchAll(/<a\b[^>]*href="https?:\/\/(?:www\.)?([^"/]+)[^"]*"[^>]*>/g)].filter((m) => m[1].includes(host)).map((m) => m[0]);
const relOf = (a) => (a.match(/rel="([^"]*)"/) || [, ''])[1];
const followedPlain = (a) => !/\b(nofollow|sponsored|ugc)\b/.test(relOf(a));

// outbound links
const basic = renderFirmPage({ firm });
const paid = renderFirmPage({ firm: { ...firm, featured: true } });
ok(anchors(basic, 'zubic.example').length > 0 && anchors(basic, 'zubic.example').every((a) => /\bnofollow\b/.test(relOf(a))), "a free firm's website link on its page is nofollow");
ok(anchors(paid, 'zubic.example').length > 0 && anchors(paid, 'zubic.example').every((a) => /\bsponsored\b/.test(relOf(a)) && /\bnoopener\b/.test(relOf(a))), "a Featured firm's website link is sponsored (its placement is paid for), and still noopener");
const post = { id: 7, title: 'A story title that is long enough', url: 'https://zubic.example/blog/story', publishedAt: '2026-01-02 10:00:00', excerpt: 'x '.repeat(60), image: null };
const card = cardHtml(post, { byline: 'Zubic Law' });
ok(anchors(card, 'zubic.example').length > 0 && anchors(card, 'zubic.example').every((a) => !followedPlain(a)), 'a blog card\'s links to the firm\'s own article are nofollow');
ok(anchors(renderFirmArticles({ firmName: 'Zubic Law', posts: [post] }), 'zubic.example').every((a) => !followedPlain(a)), 'the articles row on a page links out with nofollow too');
const story = (f) => renderStoryPage({ post: { ...post, excerpt: 'Short.' }, firm: { slug: 'zubic-law', name: 'Zubic Law', city: 'Niagara Falls', province: 'ON', ...f }, more: [], nearby: [] });
ok(anchors(story({}), 'zubic.example').every((a) => /\bnofollow\b/.test(relOf(a))) && anchors(story({ featured: true }), 'zubic.example').every((a) => /\bsponsored\b/.test(relOf(a))), 'the story page links to the full article with nofollow (sponsored for a Featured firm)');
const mapJs = readFileSync('lawdb-map.js', 'utf8');
ok(/f\.featured \? 'noopener sponsored' : 'noopener nofollow'/.test(mapJs), 'the map popup\'s Website link is nofollow or sponsored');

// structured data
const blocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)].map((m) => JSON.parse(m[1]));
const [svc, crumbs] = blocks(basic);
ok(svc['@type'] === 'LegalService' && !('aggregateRating' in svc) && !('review' in svc), 'the firm page still has no rating of its own in its structured data');
ok(crumbs && crumbs['@type'] === 'BreadcrumbList' && crumbs.itemListElement.map((i) => i.position).join() === '1,2,3,4,5' && crumbs.itemListElement.at(-1).item === 'https://lawdb.ca/firms/zubic-law'
  && crumbs.itemListElement.map((i) => i.name).join('|') === 'LawDB|Canada|Ontario|Niagara Falls|Zubic Law', 'the firm page has a breadcrumb in its structured data: home, Canada, province, city, the firm, numbered in order');
const noHub = blocks(renderFirmPage({ firm: { ...firm, city: 'Smallville' } }))[1];
ok(noHub.itemListElement.length === 4 && noHub.itemListElement.every((i) => i.name !== 'Smallville'), 'a city with no page of its own is left out of the breadcrumb, as in the visible one');
ok(noHub.itemListElement.every((i) => /^https:\/\/lawdb\.ca\//.test(i.item)), 'every breadcrumb address is a LawDB address');

// story description
const desc = (html) => html.match(/<meta name="description" content="([^"]*)"/)[1];
ok(desc(story({})).length >= 50 && desc(story({})).includes('Zubic Law') && desc(story({})).length <= 155, 'a story with a very short excerpt still gets a real description that names the firm');
const long = renderStoryPage({ post: { ...post, excerpt: 'A real excerpt that is easily long enough to stand as the page description for this story. '.repeat(3) }, firm: { slug: 'zubic-law', name: 'Zubic Law', city: 'Niagara Falls', province: 'ON' }, more: [], nearby: [] });
ok(desc(long).startsWith('A real excerpt that is easily long enough') && !desc(long).includes('A story from'), 'a story with a proper excerpt keeps it as its description');

// sitemaps
const fakeEnv = (rows) => ({ SITE_ORIGIN: 'https://lawdb.ca', DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } });
const about = 'word '.repeat(60);
const rows = (n) => Array.from({ length: n }, (_, i) => ({ slug: `firm-${i}`, updatedAt: '2026-10-01 10:00:00', about }));
ok(FIRM_SITEMAP_LIMIT >= 10000 && FIRM_SITEMAP_LIMIT <= 45000 && STORY_SITEMAP_LIMIT >= 20000 && STORY_SITEMAP_LIMIT <= 45000, 'the sitemap limits have room to grow and stay under the 50,000 addresses one file may hold');
const small = await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env: fakeEnv([...rows(3), { slug: 'thin', updatedAt: '2026-10-01 10:00:00', about: 'too short' }]) });
const smallXml = await small.text();
ok(small.status === 200 && (smallXml.match(/<url>/g) || []).length === 3 && !smallXml.includes('/firms/thin<') && !small.headers.has('x-sitemap-truncated') && /<lastmod>2026-10-01<\/lastmod>/.test(smallXml), 'the firms sitemap lists indexable firms with their dates, leaves out a thin one, and does not claim to be cut off');
const origError = console.error; let logged = ''; console.error = (...a) => { logged += a.join(' '); };
const big = await firmSitemap({ request: new Request('https://lawdb.ca/sitemap-firms.xml'), env: fakeEnv(rows(FIRM_SITEMAP_LIMIT)) });
console.error = origError;
ok(big.headers.get('x-sitemap-truncated') === '1' && /reached its limit/.test(logged) && (await big.text()).match(/<url>/g).length === FIRM_SITEMAP_LIMIT, 'a firms sitemap that hits its limit says so (a header and the log) instead of silently cutting firms off');
const sRows = [{ id: 5, slug: 'zubic-law', title: 'An older story', publishedAt: '2026-01-02 10:00:00', fetchedAt: '2026-11-04 09:00:00' }, { id: 6, slug: 'zubic-law', title: 'No fetch date', publishedAt: '2026-03-04 10:00:00', fetchedAt: null }];
const st = await (await storySitemap({ request: new Request('https://lawdb.ca/sitemap-news.xml'), env: fakeEnv(sRows) })).text();
ok(/<lastmod>2026-01-02<\/lastmod>/.test(st) && /<lastmod>2026-03-04<\/lastmod>/.test(st) && !st.includes('2026-11-04'), "a story's lastmod is the day it was published, not the day our crawler last fetched it");

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nSEO rule checks passed');
