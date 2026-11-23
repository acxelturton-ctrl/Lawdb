// The two paid plans and their prices (src/lib/plans.js): every page that talks about what Featured costs says the same two numbers.
//   node --no-warnings scripts/test-plans.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FIRM_PRICE, LAWYER_PRICE, FIRM_PRICE_LABEL, LAWYER_PRICE_LABEL, TRIAL_DAYS } from '../src/lib/plans.js';
import { FEATURED_PRICE_LABEL } from '../src/lib/stripe.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

ok(FIRM_PRICE === 199 && LAWYER_PRICE === 99 && FIRM_PRICE_LABEL === '$199 / month' && LAWYER_PRICE_LABEL === '$99 / month' && FEATURED_PRICE_LABEL === FIRM_PRICE_LABEL && TRIAL_DAYS === 30, 'a firm is $199 a month, a lawyer $99 a month, and the billing code reads the firm price from the same place');
const PROMO = readFileSync('index.html', 'utf8').match(/<div class="menu-promo">[\s\S]*?\n  <\/div>/)[0]; // the box is the same on every page (apply-featured-promo.mjs --check says so)
ok(PROMO.includes('$199 a month for a firm') && PROMO.includes('$99 a month') && PROMO.includes('>Get Featured<') && PROMO.includes('Lawyers: claim your profile'), 'the menu box names both prices, speaks to lawyers and keeps its Get Featured button');

// every page and source file that states a price next to the word Featured states one of the two
const SKIP = new Set(['node_modules', '.wrangler', '.git', '.github', 'images', 'data', 'db', 'migrations', 'email-previews']);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(html|js|mjs|md|jsonc)$/.test(e.name) && !/generated|ARCHITECTURE|STRIPE_SETUP|test-/.test(e.name)) files.push(p);
  }
})('.');
const PRICE = /\$\s?(\d{2,4})(?:\.\d\d)?\s*(?:\/\s*month|a month|per month|\/month)/g;
const wrong = [];
let stated = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(PRICE)) {
    const around = text.slice(Math.max(0, m.index - 140), m.index + 60);
    if (!/Featured|subscribe|billed/i.test(around)) continue; // a price in some other sentence (a guide on marketing costs) is not ours
    stated++;
    if (![FIRM_PRICE, LAWYER_PRICE].includes(Number(m[1]))) wrong.push(`${f}: ${m[0]}`);
  }
}
ok(stated > 600 && wrong.length === 0, `${stated} price statements about Featured in ${files.length} files, none but $${FIRM_PRICE} and $${LAWYER_PRICE}${wrong.length ? ` (${wrong.slice(0, 4).join(' | ')})` : ''}`);

// the pitch pages
const page = (f) => readFileSync(f, 'utf8');
const fx = page('for-firms.html'), ly = page('list-your-firm.html'), how = page('how-it-works.html');
ok(/class="pc-price">\$199<small> \/ month/.test(fx) && /class="pc-price">\$199<small> \/ month/.test(ly) && fx.includes('Featured firm') && fx.includes('Your lawyers can add their own Featured listing'), 'the plan table on For Law Firms and List Your Firm is the Featured firm at $199 and has a row for the firm\'s lawyers');
ok(/id="lawyers"/.test(fx) && fx.includes('For lawyers: claim your profile') && fx.includes('$99<small> / month') && fx.includes('data-lawyer-claim') && fx.includes('/lawyer-claim.js') && fx.includes('Your own pin on the LawDB map'), 'For Law Firms has a lawyers section with the free and Featured lawyer listings, the claim form and the pin');
ok(/I am a lawyer at a listed firm\. Can I claim my profile\?/.test(ly) && (ly.match(/I am a lawyer at a listed firm\. Can I claim my profile\?/g) || []).length === 2, 'the FAQ answers lawyers, in the page and in its structured data');
ok(how.includes('$99 a month') && how.includes('$199 a month for a firm'), 'How it works says what a firm and a lawyer pay');
ok(page('refund-policy.html').includes('$199 per month for a firm and $99 per month for a Featured lawyer listing') && page('terms.html').includes('Featured lawyer listing'), 'the terms and the refund policy cover the lawyer listing');

// the claim form
const js = page('lawyer-claim.js');
ok(js.includes("form: 'lawyer-claim'") && js.includes('/api/leads') && !/innerHTML/.test(js), 'the claim form posts to the leads endpoint as a lawyer-claim and writes only text');

console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
