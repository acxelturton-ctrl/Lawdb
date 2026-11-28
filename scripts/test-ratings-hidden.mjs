// LawDB member ratings are hidden for now (src/lib/features.js, LAWDB_RATINGS):  node --no-warnings scripts/test-ratings-hidden.mjs
// The page has no "Rate this firm on LawDB" link and no stars box, the Google rating stays, a member's profile has no "Your ratings", and the backend is still there for the day they come back.
import { readFileSync } from 'node:fs';
import { renderFirmPage } from '../src/render/firm-page.js';
import { LAWDB_RATINGS } from '../src/lib/features.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const firm = { slug: 'some-firm', name: 'Some Firm', city: 'Toronto', province: 'ON', featured: false, caseTypes: ['family'], phone: '+14165551234', address: '1 Main St, Toronto, ON', rating: 4.9, count: 30, about: 'Plain words about the firm. '.repeat(10) };
const html = renderFirmPage({ firm, hours: null, images: [], articles: [], nearby: [], locations: [], origin: 'https://lawdb.ca' });
if (LAWDB_RATINGS) {
  ok(html.includes('data-lawdb-rating="some-firm"') && html.includes('pf-rate-slot'), 'ratings are switched on: the page has the LawDB rating link and the box slot');
} else {
  ok(!html.includes('data-lawdb-rating') && !html.includes('pf-lrate') && !html.includes('Rate this firm') && !html.includes('pf-rate-slot') && !html.includes('data-slot="rate"'), 'a firm page has no "Rate this firm on LawDB" link and no member-ratings slot');
  ok(html.includes('<b>4.9</b> from 30 Google reviews'), 'and the Google rating is still there: 4.9 from 30 Google reviews');
  ok(html.includes('data-fcount="some-firm"'), 'and the followers count is still there');
}

// the member's profile has its own copy of the switch (a browser script): the two must agree
const account = readFileSync('account/account.js', 'utf8');
const copy = /const RATINGS_VISIBLE = (true|false);/.exec(account);
ok(!!copy && (copy[1] === 'true') === LAWDB_RATINGS, 'the member profile (account/account.js) uses the same switch as the pages');
ok(/RATINGS_VISIBLE \? \[h\('h2', null, 'Your ratings'\)/.test(account), 'and "Your ratings" is behind it');

// nothing was removed: the stars box, the ratings API, the tables and the admin's review screen are all still there
const worker = readFileSync('src/worker.js', 'utf8');
ok(/'\/api\/firms\/:slug\/ratings'/.test(worker) && /'\/api\/account\/ratings'/.test(worker) && /\/api\/admin\/reviews/.test(worker), 'the ratings API and the admin review screen are still there');
ok(/\.lw-rate\{/.test(readFileSync('follow.js', 'utf8')) && /firm_ratings/.test(readFileSync('src/lib/backup.js', 'utf8')), 'the stars box script and the stored ratings are still there (and still backed up)');

console.log(bad ? `\n${bad} check(s) failed` : '\nratings-hidden checks passed');
process.exit(bad ? 1 : 0);
