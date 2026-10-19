// The "At a glance" facts: junk is dropped, plain facts are kept, and the profile page shows them escaped (no section at all when there are none).
import { cleanDetails } from '../src/lib/details.js';
import { renderFirmPage } from '../src/render/firm-page.js';

let bad = 0;
const ok = (c, label) => { if (!c) { bad++; console.error('FAIL', label); } };

const messy = cleanDetails({
  founded: 1998, languages: ['English', 'French', 'Klingon', 'French'],
  lawyers: [{ name: 'Daniel Badre', title: 'Founder' }, { name: 'Contact Us' }, { name: 'Me Marie Tremblay', title: 'Partner' }, { name: '<b>Evil</b> Name' }, { name: 'Sam Lee', title: 'Best lawyer in Canada' }],
  areas: ['Car accidents', 'a', 'Visit https://x.ca', 'Slip and fall'], serving: ['Ottawa', 'gatineau', 'Kanata'],
}, 2026);
ok(messy.founded === 1998, 'founded kept');
ok(JSON.stringify(messy.languages) === '["English","French"]', 'languages: only known ones, once each');
ok(JSON.stringify(messy.lawyers.map((l) => l.name)) === '["Daniel Badre","Me Marie Tremblay"]', `lawyers: real names only, got ${JSON.stringify(messy.lawyers)}`);
ok(JSON.stringify(messy.areas) === '["Car accidents","Slip and fall"]', 'areas: no links, no one-letter junk');
ok(JSON.stringify(messy.serving) === '["Ottawa","Kanata"]', 'serving: capitalised place names only');
ok(cleanDetails({ founded: 3000 }, 2026) === null && cleanDetails(null) === null && cleanDetails({ languages: ['Klingon'] }) === null, 'nothing valid means no details');

const firm = { name: 'Smoke <b>Law</b>', slug: 'smoke-law', city: 'Ottawa', province: 'ON', address: '1 Main St, Ottawa, ON', phone: '+16135550100', website: 'https://example.com',
  lat: 45.4, lng: -75.7, rating: 4.8, count: 40, tags: ['Family Law'], caseTypes: ['family'], about: 'Smoke Law acts for families in Ottawa.', details: messy };
const html = renderFirmPage({ firm });
ok(html.includes('<h2>At a glance</h2>') && html.includes('<dt>Founded</dt><dd>1998</dd>') && html.includes('Daniel Badre') && html.includes('Me Marie Tremblay'), 'profile shows the facts');
ok(html.includes('English, French') && html.includes('Ottawa, Kanata') && html.includes('Slip and fall'), 'profile shows languages, places and areas');
ok(!html.includes('<b>Evil</b>') && !html.includes('Smoke <b>Law</b>'), 'nothing is injected as HTML');
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/)[1]);
ok(ld.foundingDate === '1998' && ld.knowsLanguage.join() === 'English,French' && ld.areaServed.join() === 'Ottawa,Kanata', 'structured data carries them');
const plain = renderFirmPage({ firm: { ...firm, details: undefined } });
ok(!plain.includes('class="glance"') && !JSON.parse(plain.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/)[1]).foundingDate, 'no facts, no section');
const hostile = renderFirmPage({ firm: { ...firm, details: { lawyers: [{ name: 'Ann Lee', title: '"><script>alert(1)</script>' }] } } });
ok(!hostile.includes('<script>alert(1)</script>') && !hostile.includes('Ann Lee <span'), 'a hostile title is dropped');
if (bad) process.exit(1);
console.log('firm details ok');
