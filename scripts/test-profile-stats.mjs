// The "How X ranks" panel and the practice-area cards on a database-built profile.
import { computeRank, practiceCards, MIN_RANKED } from '../src/lib/firm-stats.js';
import { practicePath } from '../src/lib/practice.js';
import { renderFirmPage } from '../src/render/firm-page.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };

const rows = [
  { slug: 'a', rating: 5, count: 39, caseTypes: ['business'] },
  { slug: 'b', rating: 5, count: 80, caseTypes: ['business', 'family'] },
  { slug: 'c', rating: 4.5, count: 10, caseTypes: ['business'] },
  { slug: 'd', rating: 4, count: 200, caseTypes: ['family'] },
  { slug: 'e', rating: 3.5, count: 5, caseTypes: ['family'] },
  { slug: 'f', rating: 0, count: 0, caseTypes: [] },
];
const r = computeRank(rows, 'a', 60);
ok(r && r.rank === 2 && r.of === 5, 'ranked by rating, then by review count (unrated firms are not counted)');
ok(r.avg === 4.4 && r.delta.tone === 'up' && r.delta.text === '▲ 0.6 above average', 'area average and difference');
ok(r.reviews === 'Below the provincial average' && r.count === 39, 'reviews against the provincial average');
ok(r.byType && r.byType.rank === 2 && r.byType.of === 3 && r.byType.label === 'business / corporate', 'rank among the firms of its own practice area');
ok(computeRank(rows.slice(0, MIN_RANKED - 1), 'a', 60) === null, 'no ranking among fewer than five firms');
ok(computeRank(rows, 'f', 60) === null && computeRank(rows, 'nobody', 60) === null, 'an unrated or unknown firm gets no ranking');
ok(computeRank(rows, 'c', 60).delta.tone === 'neutral' && computeRank(rows, 'd', 60).delta.tone === 'down', 'a rating close to the average says so');

ok(practicePath('ON', 'family') === '/ontario/family-lawyers' && practicePath('ON', 'nope') === null && practicePath('XX', 'family') === null, 'only known practice pages are linked');
const cards = practiceCards('ON', ['business', 'business', 'family', 'wills', 'traffic', 'injury'], { business: 8, family: 1 });
ok(cards.length === 4 && cards[0].count === 8 && cards[1].count === 1 && new Set(cards.map((c) => c.href)).size === 4, 'at most four distinct cards, with how many firms each page compares');

const firm = { slug: 'x-law', name: 'X <Law>', city: 'Toronto', province: 'ON', rating: 4.9, count: 50, tags: ['Family Law'], caseTypes: ['family'], about: 'X Law is a family law firm in Toronto.', lat: 43.7, lng: -79.4, address: '1 Bay St', phone: '+14165551234', website: 'https://x.example' };
const html = renderFirmPage({ firm, stats: { rank: computeRank(rows, 'a', 60), practice: cards } });
ok(html.includes('<div class="rank-panel">') && html.includes('How X &lt;Law&gt; ranks in Toronto') && html.includes('#2 <small>of 5</small>') && html.includes('.rank-panel{'), 'the page shows the ranking, escaped, with its styles');
ok(html.includes('<a class="pa-card" href="/ontario/business-lawyers"><b>Business / Corporate</b><span>8 firms listed across Ontario') && html.includes('<h2>Services</h2>'), 'the page shows practice-area cards and keeps its own list as Services');
const plain = renderFirmPage({ firm, stats: { rank: null, practice: [] } });
ok(!plain.includes('rank-panel') && !plain.includes('pa-card') && plain.includes('<h2>Practice areas</h2>') && !plain.includes('.rank-panel{'), 'without them the page is as before');
const none = renderFirmPage({ firm });
ok(!none.includes('rank-panel') && none.includes('<h2>Practice areas</h2>'), 'and works with no stats at all');

const withBlock = renderFirmPage({ firm: { ...firm, block: { heading: 'Related reading', title: 'A guide <b>', teaser: 'Short text.', href: '/blog/a-guide', linkText: 'Read the LawDB guide', image: 'images/x.jpg', alt: 'A "picture"' } }, stats: null });
ok(withBlock.includes('<div class="from-firm"><h2>Related reading</h2><div class="post-title">A guide &lt;b&gt;</div><img class="article-photo" src="../images/x.jpg" alt="A &quot;picture&quot;"') && withBlock.includes('<a class="read-link" href="/blog/a-guide">Read the LawDB guide</a>') && withBlock.includes('.article-photo{'), 'a hand-written block is shown, escaped, with its picture and an internal link');
const extBlock = renderFirmPage({ firm: { ...firm, block: { heading: 'From the Firm', title: 'News', teaser: 'Text.', href: 'https://x.example/n', linkText: 'Read it' } } });
ok(extBlock.includes('href="https://x.example/n" target="_blank" rel="noopener"'), 'an outside link opens in a new tab safely');
ok(!renderFirmPage({ firm: { ...firm, block: { title: 'T', teaser: 't', href: 'javascript:alert(1)' } } }).includes('from-firm"'), 'a block with an unsafe link is not shown');
const cover = renderFirmPage({ firm: { ...firm, heroImage: 'images/hero/x.webp', heroPos: 'center 25%' } });
ok(cover.includes('src="../images/hero/x.webp" alt="X &lt;Law&gt;" style="object-position:center 25%;"') && renderFirmPage({ firm: { ...firm, heroImage: 'images/hero/x.webp', heroPos: 'x;color:red' } }).includes('object-position:center;'), 'a cover can pick which part of the picture shows; anything else is ignored');
const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(renderFirmPage({ firm: { ...firm, address: '199 Bay St #5300, Toronto, ON M5L 1B9' } }))[1]);
ok(ld.address.streetAddress === '199 Bay St #5300' && ld.address.postalCode === 'M5L 1B9', 'the address is split into street and postal code for search engines');

if (failed) process.exit(1);
console.log('profile stats checks passed');
