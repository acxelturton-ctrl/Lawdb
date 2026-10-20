// The "Profiles" box on a firm's page: only real profile addresses become icons, in a fixed order, escaped, with no box at all when there are none;
// a database page carries it in its header card and drops the generic "Find on LinkedIn" search link once the firm's own LinkedIn page is shown.
import { profilesBox, hasLinkedIn } from '../src/render/profiles.js';
import { renderFirmPage } from '../src/render/firm-page.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const all = {
  youtube: 'https://www.youtube.com/@foolaw', instagram: 'https://www.instagram.com/foolaw', facebook: 'https://www.facebook.com/foolaw',
  x: 'https://x.com/foolaw', linkedin: 'https://www.linkedin.com/company/foo-law',
};
const box = profilesBox(all, 'Foo <b>Law</b>');
const hrefs = [...box.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
ok(hrefs.join() === [all.linkedin, all.x, all.facebook, all.instagram, all.youtube].join(), 'five icons, in the order LinkedIn, X, Facebook, Instagram, YouTube');
ok((box.match(/rel="noopener nofollow"/g) || []).length === 5 && (box.match(/target="_blank"/g) || []).length === 5, 'each opens in a new tab, noopener nofollow');
ok(box.includes('aria-label="Foo &lt;b&gt;Law&lt;/b&gt; on LinkedIn"') && !box.includes('<b>Law</b>'), 'the firm name is escaped and each icon is labelled');
ok(box.includes('>Profiles</p>') && box.includes('data-profiles'), 'the box has its Profiles heading');

ok(profilesBox({ linkedin: all.linkedin, x: 'javascript:alert(1)', facebook: 'https://www.facebook.com/sharer/sharer.php?u=x', youtube: 'https://evil.com/youtube.com/@a' }, 'Foo').match(/<a href/g).length === 1, 'only valid profile addresses are shown');
ok(profilesBox({ facebook: 'https://www.facebook.com/sharer/sharer.php' }, 'Foo') === '' && profilesBox({}, 'Foo') === '' && profilesBox(null, 'Foo') === '' && profilesBox('x', 'Foo') === '', 'no profiles, no box');
ok(hasLinkedIn(all) && !hasLinkedIn({ x: all.x }) && !hasLinkedIn(null), 'a real LinkedIn page is told apart');

const firm = { name: 'Smoke Law', slug: 'smoke-law', city: 'Ottawa', province: 'ON', address: '1 Main St, Ottawa, ON', phone: '+16135550100', website: 'https://example.com',
  lat: 45.4, lng: -75.7, rating: 4.8, count: 40, tags: ['Family Law'], caseTypes: ['family'], about: 'Smoke Law acts for families in Ottawa.' };
const withAll = renderFirmPage({ firm: { ...firm, social: all } });
ok(withAll.includes('data-profiles') && withAll.indexOf('data-profiles') < withAll.indexOf('class="article"'), 'a database page shows the box in its header card, above the description');
ok(!withAll.includes('linkedin.com/search/results'), 'with the firm\'s own LinkedIn page, the generic LinkedIn search link is gone');
const none = renderFirmPage({ firm });
ok(!none.includes('data-profiles') && none.includes('linkedin.com/search/results'), 'with no profiles there is no box and the search link stays');
const noLi = renderFirmPage({ firm: { ...firm, social: { x: all.x } } });
ok(noLi.includes('data-profiles') && noLi.includes('linkedin.com/search/results'), 'without a LinkedIn page the search link stays next to the box');
const hostile = renderFirmPage({ firm: { ...firm, social: { x: 'https://x.com/a"><script>alert(1)</script>' } } });
ok(!hostile.includes('<script>alert(1)') && !hostile.includes('data-profiles'), 'a hostile address is refused, not injected');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nprofile checks passed');
