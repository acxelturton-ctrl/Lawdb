// The "Profiles" box on a firm's page: only real profile addresses become icons, in a fixed order, escaped, with no box at all when there are none;
// a database page carries it right under the description (or where it would be) and drops the generic "Find on LinkedIn" search link once the firm's own LinkedIn page is shown.
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
const at = withAll.indexOf('data-profiles');
ok(at > withAll.indexOf('class="article"') && at < withAll.indexOf('class="services"') && at > withAll.indexOf('</section>'), 'a database page shows the box right under the description, not in the header card');
const noAbout = renderFirmPage({ firm: { ...firm, about: '', social: all } });
ok(noAbout.includes('data-profiles') && noAbout.indexOf('data-profiles') > noAbout.indexOf('</section>') && noAbout.indexOf('data-profiles') < noAbout.indexOf('class="services"'), 'a firm with no description yet still shows the box, where the description would be');
ok(!withAll.includes('linkedin.com/search/results'), 'with the firm\'s own LinkedIn page, the generic LinkedIn search link is gone');
const none = renderFirmPage({ firm });
ok(!none.includes('data-profiles') && none.includes('linkedin.com/search/results'), 'with no profiles there is no box and the search link stays');
const noLi = renderFirmPage({ firm: { ...firm, social: { x: all.x } } });
ok(noLi.includes('data-profiles') && noLi.includes('linkedin.com/search/results'), 'without a LinkedIn page the search link stays next to the box');
const hostile = renderFirmPage({ firm: { ...firm, social: { x: 'https://x.com/a"><script>alert(1)</script>' } } });
ok(!hostile.includes('<script>alert(1)') && !hostile.includes('data-profiles'), 'a hostile address is refused, not injected');

// Offices: every office is listed with its address as a link to directions, and the by-appointment note shows; a firm with no offices gets no section.
const withOffices = renderFirmPage({ firm: { name: 'Foo Law', city: 'Surrey', province: 'BC', address: '1 Main St, Surrey, BC V3S 1A1', offices: [{ name: 'Surrey', address: '1 Main St, Surrey, BC V3S 1A1' }, { name: 'Vancouver', address: '#1300 - 1500 West Georgia Street, Vancouver, BC V6G 2Z6' }], appointmentOnly: true, slug: 'foo-law', type: 'mono' }, hours: null, images: [], posts: [], nearby: [], origin: 'https://lawdb.ca', stats: null });
const officeBlock = (withOffices.match(/<section class="offices"[\s\S]*?<\/section>/) || [''])[0];
ok(officeBlock.includes('<span class="office-name">Vancouver</span>') && (officeBlock.match(/<li>/g) || []).length === 2, 'both offices are listed under Offices');
ok((officeBlock.match(/href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=/g) || []).length === 2, 'each office address is a link to directions');
ok(officeBlock.includes('All offices are by appointment only.'), 'the by-appointment note shows under the offices');
const noOffices = renderFirmPage({ firm: { name: 'Bar Law', city: 'Surrey', province: 'BC', address: '2 Main St, Surrey, BC V3S 1A1', slug: 'bar-law', type: 'mono' }, hours: null, images: [], posts: [], nearby: [], origin: 'https://lawdb.ca', stats: null });
ok(!noOffices.includes('<section class="offices"'), 'a firm with no offices gets no Offices section');

// The contact form sits directly under the description and above the photos; a firm with no description keeps it in the same place, under its header card.
const formIdx = (h) => h.indexOf('<div class="lead-slim">');
const aboutText = 'We practise family law in Surrey.';
const formFirm = renderFirmPage({ firm: { name: 'Form Law', city: 'Surrey', province: 'BC', slug: 'form-law', type: 'mono', about: aboutText }, hours: null, images: [{ id: '0123456789abcdef01234567', alt: 'Team' }], posts: [], nearby: [], origin: 'https://lawdb.ca', stats: null });
ok(formIdx(formFirm) > formFirm.indexOf(aboutText) && formIdx(formFirm) < formFirm.indexOf('<div class="photos">'), 'the contact form comes after the description and before the photos');
const plainFirm = renderFirmPage({ firm: { name: 'Quiet Law', city: 'Surrey', province: 'BC', slug: 'quiet-law', type: 'mono' }, hours: null, images: [], posts: [], nearby: [], origin: 'https://lawdb.ca', stats: null });
ok(formIdx(plainFirm) > plainFirm.indexOf('<section class="li-card"') && formIdx(plainFirm) < plainFirm.indexOf('<footer'), 'a firm with no description has the contact form in the same place, under its header card');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nprofile checks passed');
