// LawDB Marketplace, Phase 0 (the "coming soon" page and its waitlist):  node --no-warnings scripts/test-marketplace.mjs
// The page is public and shows no consumer data; the waitlist stores a consent record; the words follow the rules in docs/MARKETPLACE_LEGAL.md;
// and the consent wording on the page is the wording the server stores (src/lib/consent.js).
import { readFileSync } from 'node:fs';
import { CONSENTS, consentRecord } from '../src/lib/consent.js';
import { marketplaceWaitlistEmail, marketplaceWaitlistAdminEmail } from '../src/lib/email.js';
import { LEAD_SLIM } from '../src/render/firm-chunks.generated.js';
import { PRACTICE } from '../src/lib/practice.js';
import { WAITLIST_PROVINCES } from '../src/routes/public.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

const html = readFileSync('marketplace.html', 'utf8');
const js = readFileSync('marketplace.js', 'utf8');
const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const main = html.slice(html.indexOf('<div class="wrap3 mk">'), html.indexOf('<footer class="site-footer">'));
const mainText = main.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

// ---- SEO
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
ok(title.length >= 30 && title.length <= 65 && /Marketplace/.test(title) && title.endsWith('| LawDB.ca'), `the title names the page and the site (${title.length} characters)`);
ok(desc.length >= 100 && desc.length <= 160, `the meta description is 100 to 160 characters (${desc.length})`);
ok(html.includes('<link rel="canonical" href="https://lawdb.ca/marketplace">') && html.includes('<meta property="og:url" content="https://lawdb.ca/marketplace">') && html.includes('<meta property="og:title"') && html.includes('<meta name="twitter:card"'), 'canonical, Open Graph and Twitter tags are set');
ok(!/noindex/i.test(html), 'the page is open to search engines');
ok((html.match(/<h1\b/g) || []).length === 1, 'one h1');
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const faq = ld.find((d) => d['@type'] === 'FAQPage');
ok(ld.some((d) => d['@type'] === 'WebPage' && d.url === 'https://lawdb.ca/marketplace') && faq && faq.mainEntity.length === (html.match(/<details>/g) || []).length && faq.mainEntity.length >= 5, 'structured data: a WebPage and an FAQPage with every visible question');
ok(/<loc>https:\/\/lawdb\.ca\/marketplace<\/loc>/.test(readFileSync('sitemap.xml', 'utf8')), 'it is in the sitemap');
ok(/href="\/marketplace"/.test(readFileSync('for-firms.html', 'utf8')), 'the For Law Firms page links to it');
ok(readFileSync('scripts/case-page.shell.html', 'utf8').includes('<li><a href="/marketplace">LawDB Marketplace</a></li>') && html.includes('<li><a href="/marketplace">LawDB Marketplace</a></li>'), 'the footer has the link (page, template)');

// ---- what the page shows
ok(/Example lead, not a real inquiry/.test(main) && /aria-label="Example inquiry card, not a real inquiry"/.test(main), 'the sample card is labelled "Example lead, not a real inquiry"');
ok(!/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i.test(main.replace(/info@lawdb\.ca/g, '')) && !/\(\d{3}\) \d{3}-\d{4}/.test(main.replace(/\(555\) 010-0100/g, '')), 'no real-looking consumer data: the only email is @example.com and the only phone is a 555 example');
ok(/class="mk-hide" aria-hidden="true"/.test(main) && /\.mk-blur\{[^}]*filter:blur/.test(html) && /<button class="mk-unlock" type="button" disabled>/.test(main), 'the contact details in the sample are blurred and hidden from screen readers, and the unlock button is switched off');
ok(/How it works/.test(main) && (main.match(/<li><span class="mk-n"/g) || []).length === 3, 'a three-step "How it works"');
for (const b of ['Exclusive inquiries', 'Pay only when you unlock', 'Matched to your practice', 'Verified firms only']) ok(main.includes(`<h3>${b}</h3>`), `benefit: ${b}`);
ok(!/\b(referral|referrals|commission|client for sale|clients for sale|success fee|percentage of)\b/i.test(mainText.replace(/Is this a referral service\?/g, '').replace(/No\. LawDB is an independent directory[^.]*\./, '')), 'the page avoids "referral", "commission" and "client for sale" (it says "inquiry", "unlock", "advertising")');
ok(/flat advertising fee set by LawDB\. It does not depend on whether the person hires you, and LawDB takes no share of any fee/.test(mainText), 'it says the fee is flat and never depends on whether the person hires the firm');
ok(!/\b(best|top-rated|guarantee[sd]?|#1|leading)\b/i.test(mainText), 'no restricted advertising claims on the page');
ok(!/\$\s?\d/.test(mainText) && !/\b\d+\s*(leads|inquiries) (a|per) (week|month|day)\b/i.test(mainText), 'no prices and no volume claims before they are real');

// ---- the waitlist form
const names = [...main.matchAll(/<input[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
ok(['botcheck', 'name', 'email', 'firmName', 'lawSociety', 'practiceAreas', 'provinces', 'consent'].every((n) => names.includes(n)), 'the form has every field the server reads');
const areas = [...main.matchAll(/name="practiceAreas" value="([^"]+)"/g)].map((m) => m[1]);
const provs = [...main.matchAll(/name="provinces" value="([^"]+)"/g)].map((m) => m[1]);
ok(areas.length === Object.keys(PRACTICE).length && areas.every((a) => a in PRACTICE), 'the practice-area boxes are the site\'s ten practice areas');
ok(provs.length === WAITLIST_PROVINCES.length && provs.every((p) => WAITLIST_PROVINCES.includes(p)), 'the province boxes are the ones the server accepts');
ok(/name="botcheck" class="mk-hp"/.test(main) && /type="checkbox" name="consent" value="yes" required/.test(main) && !/name="consent"[^>]*checked/.test(main), 'a hidden spam trap, and the consent box is required and not ticked in advance');
const consent = CONSENTS['marketplace-waitlist'];
ok(main.includes(`<span id="mpConsentText">${esc(consent.text)}</span>`), 'the consent wording on the page is exactly the wording the server stores');
ok(/form: 'marketplace-waitlist'/.test(js) && js.includes('/api/leads') && js.includes("consent: 'yes'") && !/innerHTML/.test(js) && !/localStorage|document\.cookie/.test(js), 'the script posts the waitlist form to /api/leads, writes only text, and keeps nothing in the browser');

// ---- consent module
const rec = consentRecord('marketplace-waitlist', { now: new Date('2026-11-25T12:00:00Z'), userAgent: 'x'.repeat(500) });
ok(rec.version === consent.version && rec.text === consent.text && rec.at === '2026-11-25T12:00:00.000Z' && rec.userAgent.length === 200 && !('ip' in rec), 'a consent record has the version, the exact wording, the time and a short browser string, and no IP address');
ok((() => { try { consentRecord('nope'); return false; } catch { return true; } })(), 'a form with no wording on file cannot be recorded');
ok(CONSENTS['marketplace-inquiry'].text.includes('pays to receive it') && CONSENTS['marketplace-inquiry'].text.includes('Only one firm will receive it'), 'the wording for sharing an inquiry with a paying firm says so, and says only one firm receives it');
ok(LEAD_SLIM.includes('will share these details with {{NAME}} so they can respond') && !LEAD_SLIM.includes('pays to receive'), 'the firm-page enquiry form still says what really happens today (shared with the one firm named); the wider wording waits for Phase 1');

// ---- emails
const conf = marketplaceWaitlistEmail('https://lawdb.ca', { name: 'Ann Lee', firmName: 'Lee LLP' });
ok(/waitlist/i.test(conf.subject) && conf.text.includes('Lee LLP is on the waitlist') && /reply to this email/i.test(conf.text) && conf.html.includes('https://lawdb.ca/marketplace') && !/\$\s?\d/.test(conf.text), 'the confirmation says they are on the list, how to be taken off, links the page, and quotes no price');
const adm = marketplaceWaitlistAdminEmail('https://lawdb.ca', { name: 'Ann Lee', email: 'ann@lee.example', firmName: 'Lee LLP', lawSociety: 'LSO 1', practiceAreas: 'family', provinces: 'ON', consentVersion: consent.version });
ok(adm.text.includes('Lee LLP') && adm.text.includes('LSO 1') && adm.text.includes(consent.version) && adm.html.includes('/admin/#leads'), 'the admin note has the firm, the law society reference and the consent version');

// ---- policies
const privacy = readFileSync('privacy-policy.html', 'utf8'), terms = readFileSync('terms.html', 'utf8');
ok(/Marketplace waitlist \(law firms\)/.test(privacy) && /Marketplace waitlist:<\/strong> your details are kept for 12 months/.test(privacy) && /LawDB Marketplace \(not open yet\)/.test(terms), 'the Privacy Policy covers the waitlist and the Terms say the Marketplace is not open yet');

console.log(bad ? `\n${bad} check(s) failed` : '\nmarketplace checks passed');
process.exit(bad ? 1 : 0);
