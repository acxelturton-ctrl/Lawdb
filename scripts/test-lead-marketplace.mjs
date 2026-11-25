// The Lead Marketplace rules that need no database (src/lib/marketplace.js, marketplace-alerts.js, the request page):  node --no-warnings scripts/test-lead-marketplace.mjs
// What needs the database (one buyer and one charge, refunds, expiry, the board, alerts) is in scripts/smoke.mjs, against a real local database.
import { readFileSync } from 'node:fs';
import * as mk from '../src/lib/marketplace.js';
import { matches } from '../src/lib/marketplace-alerts.js';
import { LEAD_SLIM } from '../src/render/firm-chunks.generated.js';
import { marketplaceAlertEmail, marketplaceReceivedEmail } from '../src/lib/email.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const cfg = mk.DEFAULTS;

// ---- the one-line summary is made only from a fixed vocabulary, never from the person's words
const adversarial = 'My name is Jane Q. Roe, I work at Acme Robotics on 12 Elm St, my ex Bob Smith (bob@acme.com, 416-555-0100) left on March 3, 2025 and wants custody of our kids and child support';
const sum = mk.publicSummary({ practiceArea: 'family', city: 'Toronto', province: 'ON', description: adversarial });
ok(sum === 'Family Law / Divorce inquiry in Toronto, ON: parenting time and support.', `the summary uses topics only: "${sum}"`);
ok(!/Jane|Roe|Acme|Elm|Bob|Smith|@|\d{3}|March|2025/.test(sum), 'no name, employer, address, email, phone or date can get into a summary');
ok(mk.publicSummary({ practiceArea: 'injury', city: 'Calgary', province: 'AB', description: 'nothing useful here at all, just a long enough sentence' }) === 'Personal Injury inquiry in Calgary, AB.', 'with no known topic the summary is just the area and the place');
ok(mk.publicSummary({ practiceArea: 'criminal', city: 'Ot<b>tawa</b>', province: 'ON', description: 'a DUI' }).includes('an impaired driving charge') && !mk.publicSummary({ practiceArea: 'criminal', city: 'Ot<b>tawa</b>', province: 'ON', description: '' }).includes('<'), 'a city is cleaned of anything but letters');

// ---- automatic approval, with a manual review flag
const good = { name: 'Ann Lee', email: 'ann@example.org', phone: '', description: 'I was rear-ended last week and my car is a write-off. I need advice about an insurance claim.', practiceArea: 'injury', province: 'ON' };
ok(mk.screenInquiry(good, cfg).verdict === 'approved', 'a complete, plausible request is approved automatically');
ok(mk.screenInquiry({ ...good, name: '' }, cfg).verdict === 'rejected' && mk.screenInquiry({ ...good, email: 'nope' }, cfg).verdict === 'rejected', 'no name, or no plausible email: rejected');
ok(mk.screenInquiry({ ...good, email: 'x@mailinator.com' }, cfg).verdict === 'rejected', 'a disposable email address is rejected');
ok(mk.screenInquiry({ ...good, description: 'help' }, cfg).verdict === 'rejected' && mk.screenInquiry({ ...good, description: '' }, cfg).verdict === 'rejected', 'a missing or one-word description is rejected');
ok(mk.screenInquiry({ ...good, description: 'Buy cheap viagra and crypto casino now, click here for a loan offer please' }, cfg).verdict === 'rejected', 'spam wording is rejected');
ok(mk.screenInquiry({ ...good, description: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa asdf' }, cfg).verdict === 'rejected' && mk.screenInquiry({ ...good, description: 'see https://a.example and https://b.example for what I need from a lawyer' }, cfg).verdict === 'rejected', 'gibberish and link stuffing are rejected');
ok(mk.screenInquiry({ ...good, phone: '12345' }, cfg).verdict === 'rejected', 'a phone number that cannot be real is rejected');
for (const text of ['I am afraid for my safety and my husband hit me last night, I need a lawyer to help me leave', 'I have thought about suicide since the divorce started and need help with the papers', 'my 15 year old daughter was charged and we need a lawyer to speak with the police']) {
  ok(mk.screenInquiry({ ...good, practiceArea: 'family', description: text }, cfg).verdict === 'held', `sensitive wording waits for the admin: "${text.slice(0, 38)}..."`);
}
ok(mk.screenInquiry({ ...good, description: 'A car hit me while I was crossing the street last month and I need advice about an insurance claim.' }, cfg).verdict === 'approved', 'an ordinary injury claim ("a car hit me") is not held as a violence report');
ok(mk.screenInquiry(good, { ...cfg, holdAreas: ['injury'] }).verdict === 'held' && mk.screenInquiry({ ...good, practiceArea: 'family' }, { ...cfg, holdAreas: ['injury'] }).verdict === 'approved', 'a practice area the admin chose to hold waits for review');

// ---- the price: full for 48 hours, then discounted, then gone after seven days
const at = '2026-11-25 12:00:00', t = (h) => new Date(Date.parse('2026-11-25T12:00:00Z') + h * 3600e3);
ok(mk.priceFor(cfg, 'injury', at, t(1)).credits === 150 && mk.priceFor(cfg, 'injury', at, t(47.9)).tier === 'full', 'full price in the first 48 hours');
ok(mk.priceFor(cfg, 'injury', at, t(48)).credits === 90 && mk.priceFor(cfg, 'injury', at, t(48)).tier === 'discount' && mk.priceFor(cfg, 'wills', at, t(100)).credits === 36, 'then 40% off (150 becomes 90, 60 becomes 36)');
ok(mk.priceFor(cfg, 'injury', at, t(24 * 7 - 0.1)).expired === false && mk.priceFor(cfg, 'injury', at, t(24 * 7)).expired === true && mk.priceFor(cfg, 'injury', at, t(24 * 8)).credits === 0, 'gone after seven days');
ok(mk.priceFor({ ...cfg, prices: { ...cfg.prices, family: 80 } }, 'family', at, t(0)).credits === 80 && Object.keys(cfg.prices).sort().join() === mk.AREAS.slice().sort().join(), 'every practice area has a price, and the admin can change one');
ok(cfg.prices.criminal >= 100 && cfg.prices.criminal <= 150 && cfg.prices.injury >= 150 && cfg.prices.business > cfg.prices.injury && [cfg.prices.immigration, cfg.prices.wills, cfg.prices.family].every((p) => p >= 60 && p <= 100), 'the starting prices follow the brief');

// ---- the consent record
const rec = mk.consentRecord('firm-page', { userAgent: 'x'.repeat(500), ipHash: 'abc', now: new Date('2026-11-25T12:00:00Z') });
ok(rec.version === mk.CONSENT.version && rec.text === mk.CONSENT.text && rec.at === '2026-11-25T12:00:00.000Z' && rec.userAgent.length === 200 && rec.ipHash === 'abc' && rec.form === 'firm-page' && !('ip' in rec), 'a consent record has the form, version, exact wording, time, a short browser string and the hashed address (never the address)');
ok(/pays to receive it/.test(mk.CONSENT.text) && /Only one firm will receive it/.test(mk.CONSENT.text) && /may share/.test(mk.CONSENT.text), 'the wording says the inquiry may be shared with a firm that pays to receive it, and that only one firm will receive it');
const esc = (s) => s.replace(/&/g, '&amp;');
const request = readFileSync('request-a-lawyer.html', 'utf8');
ok(request.includes(`<span id="rlConsentText">${esc(mk.CONSENT.text)}</span>`), 'the consent wording on the request page is exactly the stored wording');
ok(LEAD_SLIM.includes(`<span id="marketShareText">${mk.CONSENT.text}</span>`), 'the optional box on a firm\'s form carries exactly the stored wording');
ok(/data-market-open="flex" hidden/.test(LEAD_SLIM) && /name="shareWider" value="yes"/.test(LEAD_SLIM) && !/name="shareWider"[^>]*checked/.test(LEAD_SLIM) && !/shareWider[^>]*required/.test(LEAD_SLIM), 'the box on a firm\'s form is hidden until the marketplace is open, optional, and not ticked in advance');
ok(LEAD_SLIM.includes('will share these details with {{NAME}} so they can respond'), 'the firm\'s own sentence is unchanged: the enquiry goes to the firm it is sent to');
ok(/shareWider: form\.shareWider/.test(readFileSync('src/render/firm-chunks.generated.js', 'utf8')) && /\[data-market-open\]/.test(readFileSync('site.js', 'utf8')), 'the form sends the box, and site.js shows it only when the marketplace is open');

// ---- the request page
ok(/<meta name="robots" content="noindex,follow">/.test(request) && !/<loc>[^<]*request-a-lawyer/.test(readFileSync('sitemap.xml', 'utf8')), 'the request page is kept out of search results and the sitemap');
ok(/name="botcheck" class="mk-hp"/.test(request) && /type="checkbox" name="consent" value="yes" required/.test(request) && !/name="consent"[^>]*checked/.test(request), 'a hidden spam trap, and the consent box is required and not ticked in advance');
ok((request.match(/<option value="[a-z]+">[^<]+<\/option>/g) || []).filter((o) => mk.AREAS.includes(o.match(/value="([a-z]+)"/)[1])).length === mk.AREAS.length, 'the request page offers the ten practice areas');
ok(/data-market-open="block" hidden/.test(readFileSync('find-lawyers.html', 'utf8')) && /href="\/request-a-lawyer"/.test(readFileSync('find-lawyers.html', 'utf8')), 'the Find Your Lawyer page links to the request page only when the marketplace is open');
const js = readFileSync('request-a-lawyer.js', 'utf8');
ok(js.includes('/api/marketplace/inquiries') && js.includes("consent: 'yes'") && !/innerHTML/.test(js) && !/localStorage|document\.cookie/.test(js), 'the request script posts to the inquiry route, writes only text, and keeps nothing in the browser');

// ---- settings
ok((() => { try { mk.cleanConfig({ nope: 1 }); return false; } catch { return true; } })() && (() => { try { mk.cleanConfig({ prices: { family: 0 } }); return false; } catch { return true; } })() && (() => { try { mk.cleanConfig({ open: 'yes' }); return false; } catch { return true; } })(), 'the admin cannot set an unknown setting, a zero price, or a non-true/false switch');
ok(mk.cleanConfig({ open: true, discountPercent: 50, prices: { family: 99 }, holdAreas: ['criminal'] }).prices.family === 99 && DEFAULTS_OPEN_IS_FALSE(), 'valid settings pass, and the marketplace is closed until the admin opens it');
function DEFAULTS_OPEN_IS_FALSE() { return mk.DEFAULTS.open === false; }

// ---- who is told
const firm = { areas: ['injury', 'family'], provinces: ['ON'], cities: [] };
const lead = { practice_area: 'injury', province: 'ON', city: 'Toronto' };
ok(matches(firm, lead) && !matches(firm, { ...lead, province: 'BC' }) && !matches(firm, { ...lead, practice_area: 'criminal' }) && matches({ ...firm, cities: ['toronto'] }, lead) && !matches({ ...firm, cities: ['ottawa'] }, lead), 'an alert goes only to firms whose practice areas and provinces (and cities, if set) match');
const alert = marketplaceAlertEmail('https://lawdb.ca', { firmName: 'X LLP', slug: 'x', leads: [{ practiceAreaLabel: 'Family Law', city: 'Toronto', province: 'ON', urgencyLabel: 'This week', summary: 'Family Law inquiry in Toronto, ON: separation.', price: 80 }] });
ok(!/@|\(\d{3}\)/.test(alert.text) && /first to unlock it/.test(alert.text) && alert.html.includes('/account/#market/x') && /alerts setting/.test(alert.text), 'an alert email has only the preview, says one firm gets it, and says how to change the alerts');
const got = marketplaceReceivedEmail('https://lawdb.ca', { name: 'Ann Lee', practiceAreaLabel: 'Family Law' });
ok(/one law firm that pays to receive it/.test(got.text) && /cannot promise/.test(got.text) && /not a law firm/.test(got.text) && /reply to this email/.test(got.text), 'the person gets a plain confirmation: it may be offered to one paying firm, no promise, not legal advice, and how to withdraw');

console.log(bad ? `\n${bad} check(s) failed` : '\nlead marketplace checks passed');
process.exit(bad ? 1 : 0);
