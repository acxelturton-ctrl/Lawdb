// Featured lawyer billing (src/lib/lawyer-billing.js) through the real webhook handler.
//   node --no-warnings scripts/test-lawyer-billing.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleStripeEvent } from '../src/lib/stripe.js';
import { parseLawyerRef, lawyerCheckoutUrl } from '../src/lib/lawyer-billing.js';
import { lawyersOf } from '../src/lib/lawyers.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, disabled INTEGER NOT NULL DEFAULT 0)');
db.exec("CREATE TABLE firms (slug TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'live', featured INTEGER NOT NULL DEFAULT 0, name TEXT, city TEXT, province TEXT, about TEXT, hours TEXT, updated_at TEXT)");
db.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_user_id INTEGER, actor_email TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT)');
db.exec("CREATE TABLE firm_members (firm_slug TEXT, user_id INTEGER, status TEXT)");
db.exec('CREATE TABLE firm_subscriptions (subscription_id TEXT PRIMARY KEY, customer_id TEXT, firm_slug TEXT, payer_email TEXT, status TEXT, amount_cents INTEGER, currency TEXT, period_end TEXT, cancel_at_period_end INTEGER DEFAULT 0, featured_before INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime(\'now\')), updated_at TEXT DEFAULT (datetime(\'now\')))');
db.exec("CREATE TABLE firm_trials (firm_slug TEXT, status TEXT, ended_at TEXT)");
db.exec(readFileSync(new URL('../migrations/0043_firm_locations.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../migrations/0045_lawyer_subscriptions.sql', import.meta.url), 'utf8'));
const firm = { name: 'Lee Law', slug: 'lee-law', featured: true, lawyers: [
  { name: 'Ann Lee', slug: 'ann-lee', title: 'Partner', callYear: 2005, education: ['J.D., University of Calgary'] },
  { name: 'Bo Chan', slug: 'bo-chan', title: 'Associate', callYear: 2015, featured: true },
] };
db.prepare("INSERT INTO firms (slug, data, featured) VALUES ('lee-law', ?, 1)").run(JSON.stringify(firm));
db.prepare("INSERT INTO users (id, email) VALUES (1, 'owner@lee.example')").run();
db.prepare("INSERT INTO firm_members VALUES ('lee-law', 1, 'approved')").run();
const d1 = { prepare(sql) { const st = db.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; }, async first() { return st.get(...a) ?? null; }, async all() { return { results: st.all(...a) }; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
const env = { DB: d1, ADMIN_EMAILS: '', STRIPE_LAWYER_PAYMENT_LINK: 'https://buy.stripe.com/test_abc' };
const exec = { waitUntil() {} };
const featured = (slug) => JSON.parse(db.prepare("SELECT data FROM firms WHERE slug = 'lee-law'").get().data).lawyers.find((l) => l.slug === slug).featured === true;
const checkout = (sub, ref, email) => ({ id: 'evt_' + sub, type: 'checkout.session.completed', data: { object: { id: 'cs_' + sub, mode: 'subscription', subscription: sub, payment_status: 'paid', customer: 'cus_1', client_reference_id: ref, customer_details: { email }, amount_total: 9900, currency: 'cad' } } });
const subEvent = (type, sub, status) => ({ id: 'evt_' + type + sub + status, type, data: { object: { id: sub, status, customer: 'cus_1', items: { data: [{ price: { unit_amount: 9900 }, quantity: 1 }] } } } });

eq(parseLawyerRef('lawyer:lee-law:ann-lee'), { firm: 'lee-law', lawyer: 'ann-lee' }, 'ref parses');
eq(parseLawyerRef('lee-law'), null, 'a firm ref is not a lawyer ref');
eq(parseLawyerRef('lawyer:a:b:c'), null, 'extra parts refused');
ok(lawyerCheckoutUrl(env, 'lee-law', 'ann-lee', 'o@x.ca').includes('client_reference_id=lawyer%3Alee-law%3Aann-lee'), 'checkout url names the lawyer');
eq(lawyerCheckoutUrl({}, 'lee-law', 'ann-lee'), null, 'no link set: no url');
eq(lawyerCheckoutUrl({ STRIPE_LAWYER_PAYMENT_LINK: 'http://evil.example/x' }, 'a', 'b'), null, 'only stripe links');

// a payment from someone who does not own the firm waits for the admin
await handleStripeEvent(env, checkout('sub_x', 'lawyer:lee-law:ann-lee', 'stranger@x.example'), exec, 'https://lawdb.ca');
eq(db.prepare("SELECT status FROM lawyer_subscriptions WHERE subscription_id = 'sub_x'").get().status, 'needs_review', 'stranger parked');
ok(!featured('ann-lee'), 'stranger does not feature the lawyer');
eq(db.prepare('SELECT COUNT(*) AS n FROM firm_subscriptions').get().n, 0, 'never touches the firm plan table');

// an owner's payment switches the lawyer on
await handleStripeEvent(env, checkout('sub_1', 'lawyer:lee-law:ann-lee', 'Owner@Lee.example'), exec, 'https://lawdb.ca');
ok(featured('ann-lee'), 'owner payment features the lawyer');
ok(lawyersOf(JSON.parse(db.prepare("SELECT data FROM firms WHERE slug='lee-law'").get().data)).some((l) => l.slug === 'ann-lee' && l.featured), 'and the page shows them as Featured');
eq(db.prepare("SELECT featured FROM firms WHERE slug = 'lee-law'").get().featured, 1, 'firm plan untouched');

// past due keeps it, cancel removes it
await handleStripeEvent(env, subEvent('customer.subscription.updated', 'sub_1', 'past_due'), exec, 'https://lawdb.ca');
ok(featured('ann-lee'), 'past_due keeps Featured');
await handleStripeEvent(env, subEvent('customer.subscription.deleted', 'sub_1', 'canceled'), exec, 'https://lawdb.ca');
ok(!featured('ann-lee'), 'cancel switches Featured off');
eq(db.prepare('SELECT COUNT(*) AS n FROM firm_subscriptions').get().n, 0, 'subscription events never land in the firm table');

// a lawyer an admin made Featured by hand stays Featured after a cancelled subscription
await handleStripeEvent(env, checkout('sub_2', 'lawyer:lee-law:bo-chan', 'owner@lee.example'), exec, 'https://lawdb.ca');
eq(db.prepare("SELECT featured_before FROM lawyer_subscriptions WHERE subscription_id = 'sub_2'").get().featured_before, 1, 'remembers it was Featured already');
await handleStripeEvent(env, subEvent('customer.subscription.deleted', 'sub_2', 'canceled'), exec, 'https://lawdb.ca');
ok(featured('bo-chan'), 'hand-set Featured is never undone');

// unknown lawyer: parked, nobody changes
await handleStripeEvent(env, checkout('sub_3', 'lawyer:lee-law:nobody', 'owner@lee.example'), exec, 'https://lawdb.ca');
eq(db.prepare("SELECT status FROM lawyer_subscriptions WHERE subscription_id = 'sub_3'").get().status, 'needs_review', 'unknown lawyer parked');

// a firm subscription still takes the old path
await handleStripeEvent(env, checkout('sub_f', 'lee-law', 'owner@lee.example'), exec, 'https://lawdb.ca');
eq(db.prepare("SELECT status FROM firm_subscriptions WHERE subscription_id = 'sub_f'").get().status, 'active', 'firm plan path unchanged');

console.log(`lawyer billing: ${n} checks passed`);
