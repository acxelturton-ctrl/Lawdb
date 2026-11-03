// The practice-area cards on a database-built profile. There is no "How X ranks in <city>" panel any more, on any profile.
import { practiceCards } from '../src/lib/firm-stats.js';
import * as stats from '../src/lib/firm-stats.js';
import { practicePath } from '../src/lib/practice.js';
import { renderFirmPage } from '../src/render/firm-page.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };

ok(!('computeRank' in stats) && !('MIN_RANKED' in stats), 'the ranking calculation is gone');

ok(practicePath('ON', 'family') === '/ontario/family-lawyers' && practicePath('ON', 'nope') === null && practicePath('XX', 'family') === null, 'only known practice pages are linked');
const cards = practiceCards('ON', ['business', 'business', 'family', 'wills', 'traffic', 'injury'], { business: 8, family: 1 });
ok(cards.length === 4 && cards[0].count === 8 && cards[1].count === 1 && new Set(cards.map((c) => c.href)).size === 4, 'at most four distinct cards, with how many firms each page compares');

const firm = { slug: 'x-law', name: 'X <Law>', city: 'Toronto', province: 'ON', rating: 4.9, count: 50, tags: ['Family Law'], caseTypes: ['family'], about: 'X Law is a family law firm in Toronto.', lat: 43.7, lng: -79.4, address: '1 Bay St', phone: '+14165551234', website: 'https://x.example' };
const html = renderFirmPage({ firm, stats: { rank: { rank: 2, of: 5, rating: 4.9, avg: 4.4, count: 50 }, practice: cards } });
ok(!/rank-panel|rank-grid|How X &lt;Law&gt; ranks/.test(html) && !html.includes('.rank-'), 'the page never shows a ranking panel, even when handed ranking numbers');
ok(html.includes('<a class="pa-card" href="/ontario/business-lawyers"><b>Business / Corporate</b><span>8 firms listed across Ontario') && html.includes('<h2>Practice areas</h2>') && !html.includes('<h2>Services</h2>') && html.includes('.pa-card{') && html.includes('<ul class="pa-tags"><li>Family Law</li></ul>'), 'the page shows one Practice areas block: the firm\'s own areas as pills, then the compare cards, with their styles; there is no separate Services list');
const at = (t, k) => t.indexOf(k);
ok(at(html, 'class="article"') < at(html, 'class="pa-wrap"') && at(html, 'class="pa-wrap"') < at(html, 'class="lead-slim"'), 'the Practice areas block sits right under the description, above the contact card');
const plain = renderFirmPage({ firm, stats: { rank: null, practice: [] } });
ok(!plain.includes('rank-panel') && !plain.includes('class="pa-card"') && plain.includes('<h2>Practice areas</h2>') && plain.includes('class="pa-tags"'), 'without cards the page still lists its practice areas as pills');
const byCategory = renderFirmPage({ firm: { ...firm, tags: [], caseTypes: ['family', 'wills'] } });
ok(byCategory.includes('<ul class="pa-tags"><li>Family Law / Divorce</li><li>Wills &amp; Estates</li></ul>'), 'a firm with no practice areas of its own shows the categories it is filed under');
ok(!renderFirmPage({ firm: { ...firm, tags: [], caseTypes: [] } }).includes('class="pa-wrap"'), 'a firm with neither shows no Practice areas block');
const none = renderFirmPage({ firm });
ok(!none.includes('rank-panel') && none.includes('<h2>Practice areas</h2>') && none.includes('class="pa-tags"'), 'and works with no stats at all');

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
