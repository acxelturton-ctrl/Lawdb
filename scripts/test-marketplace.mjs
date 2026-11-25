// The Lead Marketplace "coming soon" page (marketplace.html):  node --no-warnings scripts/test-marketplace.mjs
// It says nothing is available yet and that inquiries are coming; it has no form and collects nothing (the owner does not want a waitlist; the working marketplace
// behind it is opened by the admin);
// it shows no consumer data; its words follow the rules in docs/MARKETPLACE_LEGAL.md; and the rest of the site links to it.
import { readFileSync } from 'node:fs';
import { LEAD_SLIM } from '../src/render/firm-chunks.generated.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const html = readFileSync('marketplace.html', 'utf8');
const main = html.slice(html.indexOf('<div class="wrap3 mk">'), html.indexOf('<footer class="site-footer">'));
const mainText = main.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

// ---- SEO
const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
ok(title.length >= 30 && title.length <= 65 && /Lead Marketplace/.test(title) && title.endsWith('| LawDB.ca'), `the title names the Lead Marketplace and the site (${title.length} characters)`);
ok(desc.length >= 100 && desc.length <= 160 && /Lead Marketplace/.test(desc) && /coming soon/i.test(desc), `the meta description says what it is and that it is coming soon (${desc.length} characters)`);
ok(html.includes('<link rel="canonical" href="https://lawdb.ca/marketplace">') && html.includes('<meta property="og:url" content="https://lawdb.ca/marketplace">') && html.includes('<meta property="og:title"') && html.includes('<meta name="twitter:card"'), 'canonical, Open Graph and Twitter tags are set');
ok(!/noindex/i.test(html), 'the page is open to search engines');
ok((html.match(/<h1\b/g) || []).length === 1 && /<h1[^>]*>LawDB Lead Marketplace<\/h1>/.test(html), 'one h1: "LawDB Lead Marketplace"');
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const faq = ld.find((d) => d['@type'] === 'FAQPage');
ok(ld.some((d) => d['@type'] === 'WebPage' && d.url === 'https://lawdb.ca/marketplace') && faq && faq.mainEntity.length === (html.match(/<details>/g) || []).length && faq.mainEntity.length >= 5, 'structured data: a WebPage and an FAQPage with every visible question');
ok(/<loc>https:\/\/lawdb\.ca\/marketplace<\/loc>/.test(readFileSync('sitemap.xml', 'utf8')), 'it is in the sitemap');
ok(/href="\/marketplace"/.test(readFileSync('for-firms.html', 'utf8')) && /Lead Marketplace: coming soon/.test(readFileSync('for-firms.html', 'utf8')), 'the For Law Firms page links to it');
const FOOT = '<li><a href="/marketplace">Lead Marketplace</a></li>';
ok(html.includes(FOOT) && readFileSync('scripts/case-page.shell.html', 'utf8').includes(FOOT) && readFileSync('src/render/firm-chunks.generated.js', 'utf8').includes('href=\\"/marketplace\\">Lead Marketplace</a>'), 'the footer has the Lead Marketplace link (page, template, the pages the Worker draws)');

// ---- what the page says
ok(/Nothing available right now/.test(main) && /Inquiries will come soon/.test(main) && /role="status"/.test(main), 'it says nothing is available right now and that inquiries will come soon');
ok(!/waitlist|wait list|join the|sign up|subscribe|notify me/i.test(mainText), 'there is no waitlist and no sign-up wording');
ok(!/<form\b|<input\b|<textarea\b|<select\b/i.test(main) && (main.match(/<button\b/g) || []).length === 1 && /<button class="mk-unlock" type="button" disabled>/.test(main), 'the page has no form: its only button is the switched-off Unlock button of the sample');
ok(JSON.stringify([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])) === '["site.js"]' && !/\/api\//.test(main), 'the only script is the site\'s own, and the page sends nothing anywhere');
ok(/Example lead, not a real inquiry/.test(main) && /aria-label="Example inquiry card, not a real inquiry"/.test(main), 'the sample card is labelled "Example lead, not a real inquiry"');
ok(!/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i.test(main) && !/\(\d{3}\) \d{3}-\d{4}/.test(main.replace(/\(555\) 010-0100/g, '')), 'no real-looking consumer data: the only email is @example.com and the only phone is a 555 example');
ok(/class="mk-hide" aria-hidden="true"/.test(main) && /\.mk-blur\{[^}]*filter:blur/.test(html), 'the contact details in the sample are blurred and hidden from screen readers');
ok(/How it will work/.test(main) && (main.match(/<li><span class="mk-n"/g) || []).length === 3, 'a three-step "How it will work"');
for (const b of ['Exclusive inquiries', 'Pay only when you unlock', 'Matched to your practice', 'Verified firms only']) ok(main.includes(`<h3>${b}</h3>`), `benefit: ${b}`);
ok(/href="\/list-your-firm"/.test(main) && /href="\/for-firms"/.test(main), 'the only thing to do for now is to list or claim a firm, and see what Featured adds');
const withoutReferralAnswer = mainText.replace(/Is this a referral service\?/g, '').replace(/No\. LawDB is an independent directory[^.]*\./, '');
ok(!/\b(referral|referrals|commission|client for sale|clients for sale|success fee|percentage of)\b/i.test(withoutReferralAnswer), 'the page avoids "referral", "commission" and "client for sale" (it says "inquiry", "unlock", "advertising")');
ok(/flat advertising fee set by LawDB\. It does not depend on whether the person hires you, and LawDB takes no share of any fee/.test(mainText), 'it says the fee is flat and never depends on whether the person hires the firm');
ok(!/\b(best|top-rated|guarantee[sd]?|#1|leading)\b/i.test(mainText), 'no restricted advertising claims on the page');
ok(!/\$\s?\d/.test(mainText) && !/\b\d+\s*(leads|inquiries) (a|per) (week|month|day)\b/i.test(mainText), 'no prices and no volume claims before they are real');

// ---- the page itself is inert: the working parts (request page, firm tab, admin) are tested in test-lead-marketplace.mjs and scripts/smoke.mjs
ok(LEAD_SLIM.includes('will share these details with {{NAME}} so they can respond'), 'a firm\'s own form still says the enquiry goes to that firm (the optional box for the marketplace is separate and hidden until it opens)');

console.log(bad ? `\n${bad} check(s) failed` : '\nmarketplace checks passed');
process.exit(bad ? 1 : 0);
