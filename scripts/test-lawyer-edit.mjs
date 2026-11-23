// A firm's own control over its lawyers (src/lib/lawyer-edit.js): confirm, correct, hide, add, remove, pictures.
//   node --no-warnings scripts/test-lawyer-edit.mjs
// Runs against a real in-memory SQLite database (the same SQL as the Worker's D1), a fake picture bucket and a stubbed network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getLawyers, saveLawyer, addLawyer, removeLawyer, setLawyersOff, setLawyerPhoto, removeLawyerPhoto, cleanLawyerInput } from '../src/lib/lawyer-edit.js';
import { cleanLawyers, lawyersOf, lawyerHasPage, photoCandidates, sourcePhoto, photoStateOf } from '../src/lib/lawyers.js';
import { renderFirmPage } from '../src/render/firm-page.js';
import { serveImage } from '../src/routes/images.js';
import { getFirm as publicFirm } from '../src/routes/public.js';
import { SLUG_TABLES } from '../src/lib/firm-slug.js';
import { MERGE_DROPPED } from '../src/lib/firm-merge.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const refused = async (fn, status = 422) => { try { await fn(); return false; } catch (e) { return !!e && e.status === status; } };

// ---- a database like the Worker's
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');
db.exec("CREATE TABLE firms (slug TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'live', featured INTEGER NOT NULL DEFAULT 0, about TEXT, hours TEXT, updated_at TEXT)");
db.exec('CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_user_id INTEGER, actor_email TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT)');
db.exec('CREATE TABLE firm_images (id TEXT PRIMARY KEY, firm_slug TEXT, content_type TEXT)');
db.exec(readFileSync(new URL('../migrations/0044_lawyer_photos.sql', import.meta.url), 'utf8'));
db.prepare('INSERT INTO users (id, email) VALUES (1, ?)').run('owner@firm.example');
const d1 = { prepare(sql) { const st = db.prepare(sql); let args = []; const o = { bind(...a) { args = a; return o; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { st.run(...args); return {}; } }; return o; } };
const files = new Map();
const IMAGES = { async put(k, v) { files.set(k, v); }, async delete(k) { for (const x of [].concat(k)) files.delete(x); }, async get(k) { return files.has(k) ? { body: files.get(k) } : null; } };
globalThis.caches = { default: { async match() { return undefined; }, async put() {}, async delete() { return true; } } };
const env = { DB: d1, IMAGES, PUBLIC_CACHE_TTL: '0' };
const actor = { id: 1, email: 'owner@firm.example' };

const FOUND = 'https://cdn.firm.example/team/ann.jpg';
const stored = [
  { name: 'Ann Lee', slug: 'ann-lee', title: 'Partner', callYear: 2005, site: 'https://firm.example/team/ann-lee', photo: FOUND, photoConfirmed: false },
  { name: 'Bo Chan', slug: 'bo-chan', title: 'Associate', callYear: 2015, languages: ['French'] },
  { name: 'Cy Diaz', slug: 'cy-diaz', title: 'Associate' },
];
const firmRecord = (extra = {}) => ({ slug: 'firm-x', name: 'Firm X', city: 'Calgary', province: 'AB', website: 'https://www.firm.example', featured: false, lawyers: stored, ...extra });
const put = (slug, rec, featured = 0) => { db.prepare('INSERT OR REPLACE INTO firms (slug, data, status, featured, about) VALUES (?,?,?,?,?)').run(slug, JSON.stringify(rec), 'live', featured, 'x '.repeat(60)); };
const rec = (slug) => JSON.parse(db.prepare('SELECT data FROM firms WHERE slug = ?').get(slug).data);
const audits = (slug) => db.prepare("SELECT action FROM audit_log WHERE entity_id = ?").all(slug).map((r) => r.action);

// a small valid JPEG header of the given size (the checker reads the real format and size from the file itself)
const jpeg = (w, h, pad = 64) => { const b = new Uint8Array(pad); b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3]); return b; };
const upload = (bytes) => new Request('https://lawdb.ca/x', { method: 'POST', body: bytes, headers: { 'content-type': 'image/jpeg' } });
const stubFetch = (fn) => { globalThis.fetch = fn; };

// ================================================================ what a firm may send
const C = (b, o) => cleanLawyerInput(b, o);
eq(C({ name: '  Pat   Q.  Smith ' }).name, 'Pat Q. Smith', 'a name is tidied');
ok(await refused(async () => C({ name: '<b>Pat</b> Smith' })) && await refused(async () => C({ name: 'pat@firm.example' })) && await refused(async () => C({ name: 'Pat' })) && await refused(async () => C({ name: 'Pat Smith 2' })), 'a name with markup, an address, one word or a figure is refused');
eq(C({ title: 'Senior Associate' }).title, 'Senior Associate', 'a title is kept');
ok(await refused(async () => C({ title: 'Associate, $325/hr' })) && await refused(async () => C({ title: 'Partner <i>' })) && await refused(async () => C({ title: 'x'.repeat(71) })), 'a title with a fee, markup or too long is refused');
ok(await refused(async () => C({ title: 'Best lawyer in Calgary' })) && await refused(async () => C({ title: 'Certified specialist' })), "a title with a claim law societies restrict is refused for an owner");
eq(C({ title: 'Best lawyer in Calgary' }, { admin: true }).title, 'Best lawyer in Calgary', 'an admin may enter what an owner may not (the plain-text rules still apply)');
eq(C({ callYear: '2012' }).callYear, 2012, 'a year is a number');
eq(C({ callYear: '' }).callYear, null, 'no year clears it');
ok(await refused(async () => C({ callYear: 1899 })) && await refused(async () => C({ callYear: 3000 })) && await refused(async () => C({ callYear: 'soon' })), 'an impossible year is refused');
eq(C({ education: ['J.D., University of Calgary', '  ', 'J.D., University of Calgary'] }).education, ['J.D., University of Calgary'], 'education lines are tidied and not repeated');
ok(await refused(async () => C({ education: ['https://evil.example'] })) && await refused(async () => C({ education: ['a', 'b', 'c', 'd'] })) && await refused(async () => C({ education: [`<b>x</b>`] })), 'education with a link, markup or more than 3 lines is refused');
eq(C({ languages: ['English', 'French', 'English'] }).languages, ['English', 'French'], 'languages come from the list');
ok(await refused(async () => C({ languages: ['Klingon'] })), 'a language that is not on the list is refused');
eq(C({ linkedin: 'https://www.linkedin.com/in/pat-smith/?trk=x' }).linkedin, 'https://www.linkedin.com/in/pat-smith/', 'a LinkedIn address loses its tracking part');
ok(await refused(async () => C({ linkedin: 'https://evil.example/in/x' })) && await refused(async () => C({ linkedin: 'javascript:alert(1)' })) && await refused(async () => C({ linkedin: 'https://www.linkedin.com/company/acme' })), 'only a lawyer\'s own LinkedIn profile is accepted');
const W = { website: 'https://www.firm.example' };
eq(C({ site: 'https://firm.example/team/pat' }, W).site, 'https://firm.example/team/pat', "a page on the firm's own website is accepted (www or not)");
ok(await refused(async () => C({ site: 'https://other.example/pat' }, W)) && await refused(async () => C({ site: 'http://firm.example/pat' }, W)) && await refused(async () => C({ site: 'https://user:pw@firm.example/pat' }, W)) && await refused(async () => C({ site: 'https://firm.example.evil.example/pat' }, W)), 'a page on another website, plain http, one with a password, or a look-alike address is refused');
ok(await refused(async () => C({ hidden: 'yes' })), 'hidden must be true or false');

// ================================================================ confirm, correct, hide
put('firm-x', firmRecord());
let v = await getLawyers(env, 'firm-x');
eq(v.lawyers.map((l) => l.slug), ['ann-lee', 'bo-chan', 'cy-diaz'], 'the editor lists every lawyer');
eq(v.lawyers[0].photo, { state: 'found', url: FOUND }, 'a picture found on the website is offered, not shown');
ok(v.pageExists && v.shown === 3 && v.lawyers[0].hasPage === false && v.lawyers[1].hasPage === true && v.limits.max === 120 && v.languages.includes('English') && !v.locked, 'the view says whether the Lawyers page exists and which lawyer has a page');

v = await saveLawyer(env, actor, 'firm-x', 'bo-chan', { confirmed: true }, { admin: false });
ok(v.lawyers[1].confirmed && rec('firm-x').lawyersLocked === true && audits('firm-x').includes('firm.lawyer'), '"Looks right" confirms, locks the list against the bulk update and is recorded in the audit log');
ok(rec('firm-x').lawyers.length === 3 && !('photo' in rec('firm-x').lawyers[1]), 'the rest of the record is kept');
const before = JSON.stringify(rec('firm-x'));
await saveLawyer(env, actor, 'firm-x', 'bo-chan', { confirmed: true }, { admin: false });
ok(JSON.stringify(rec('firm-x')) === before, 'confirming again changes nothing');

v = await saveLawyer(env, actor, 'firm-x', 'cy-diaz', { name: 'Cyrus Diaz', title: 'Senior Associate', callYear: 2010, education: ['J.D., University of Calgary'], languages: ['English', 'Spanish'], linkedin: 'https://www.linkedin.com/in/cy-diaz/', site: 'https://firm.example/team/cy' }, { admin: false });
const cy = v.lawyers.find((l) => l.slug === 'cy-diaz');
ok(cy && cy.name === 'Cyrus Diaz' && cy.confirmed && cy.title === 'Senior Associate' && cy.education[0] === 'J.D., University of Calgary' && cy.hasPage, 'a correction keeps the lawyer\'s address, confirms them and gives them a page');
const pub = lawyersOf(rec('firm-x')).find((l) => l.slug === 'cy-diaz');
ok(pub && pub.name === 'Cyrus Diaz' && pub.education[0] === 'J.D., University of Calgary' && pub.languages.includes('Spanish') && lawyerHasPage(pub), 'the public page shows the firm\'s words under the same address');
ok(await refused(() => saveLawyer(env, actor, 'firm-x', 'nobody', { title: 'Partner' }, { admin: false }), 404) && await refused(() => saveLawyer(env, actor, 'nofirm', 'ann-lee', { title: 'Partner' }, { admin: false }), 404), 'an unknown lawyer or firm is a 404');
ok(await refused(() => saveLawyer(env, actor, 'firm-x', 'ann-lee', { photo: 'https://evil.example/x.jpg' }, { admin: false })) && await refused(() => saveLawyer(env, actor, 'firm-x', 'ann-lee', { slug: 'other' }, { admin: false })) && await refused(() => saveLawyer(env, actor, 'firm-x', 'ann-lee', {}, { admin: false })), 'a picture address, a new page address or nothing at all cannot be sent');
ok(await refused(() => saveLawyer(env, actor, 'firm-x', 'ann-lee', { title: 'Associate, $325/hr' }, { admin: false })), 'a bad value is refused and nothing is saved');
eq(rec('firm-x').lawyers.find((l) => l.slug === 'ann-lee').title, 'Partner', 'a refused change leaves the lawyer as they were');

// saving the form without changing anything still confirms (the form sends confirmed: true with the facts)
put('save-firm', firmRecord({ slug: 'save-firm' }));
v = await saveLawyer(env, actor, 'save-firm', 'cy-diaz', { name: 'Cy Diaz', title: 'Associate', callYear: null, education: [], languages: [], linkedin: '', site: '', confirmed: true }, { admin: false });
ok(v.lawyers.find((l) => l.slug === 'cy-diaz').confirmed === true && rec('save-firm').lawyersLocked === true, 'saving the form unchanged still confirms the details');
v = await saveLawyer(env, actor, 'save-firm', 'cy-diaz', { confirmed: false }, { admin: false });
ok(v.lawyers.find((l) => l.slug === 'cy-diaz').confirmed === true, 'an owner cannot take a confirmation back');
v = await saveLawyer(env, { id: 1, email: 'admin@lawdb.ca' }, 'save-firm', 'cy-diaz', { confirmed: false }, { admin: true });
ok(v.lawyers.find((l) => l.slug === 'cy-diaz').confirmed === false, 'an admin can');

// hide
v = await saveLawyer(env, actor, 'firm-x', 'ann-lee', { hidden: true }, { admin: false });
ok(v.lawyers[0].hidden && !v.lawyers[0].confirmed, 'hiding does not confirm');
eq(lawyersOf(rec('firm-x')).map((l) => l.slug), ['bo-chan', 'cy-diaz'], 'a hidden lawyer is on no page');
ok(!renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view: { tab: 'lawyers' } }).includes('Ann Lee'), 'the Lawyers page does not show a hidden lawyer');
v = await saveLawyer(env, actor, 'firm-x', 'bo-chan', { hidden: true }, { admin: false });
ok(!v.pageExists && v.shown === 1 && renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view: { tab: 'lawyers' } }) === null, 'with fewer than two lawyers shown there is no Lawyers page at all');
await saveLawyer(env, actor, 'firm-x', 'bo-chan', { hidden: false }, { admin: false });
v = await saveLawyer(env, actor, 'firm-x', 'ann-lee', { hidden: false }, { admin: false });
ok(v.pageExists && v.shown === 3, 'showing a lawyer again brings the page back');

// the public page says who stands behind the facts
const page = (view) => renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view });
ok(page({ tab: 'lawyers' }).includes('Some details were confirmed by the firm') && page({ tab: 'lawyer', lawyer: 'cy-diaz' }).includes('Confirmed by the firm and not checked with the law society'), 'the page says what the firm confirmed, and that none of it is checked with the law society');

// ================================================================ add, remove, switch off
v = await addLawyer(env, actor, 'firm-x', { name: 'Dee Evans', title: 'Counsel', languages: ['English'] }, { admin: false });
const dee = v.lawyers.find((l) => l.slug === 'dee-evans');
ok(dee && dee.confirmed && v.lawyers.length === 4 && audits('firm-x').includes('firm.lawyer.add'), 'a lawyer the website did not show can be added, and counts as confirmed');
v = await addLawyer(env, actor, 'firm-x', { name: 'Dee Evans' }, { admin: false });
ok(v.lawyers.some((l) => l.slug === 'dee-evans-2') && v.lawyers.length === 5, 'a second person with the same name gets an address of their own');
ok(await refused(() => addLawyer(env, actor, 'firm-x', { title: 'Partner' }, { admin: false })) && await refused(() => addLawyer(env, actor, 'firm-x', { name: 'Eve' }, { admin: false })) && await refused(() => addLawyer(env, actor, 'firm-x', { name: 'Eve Fox', hidden: true }, { admin: false })), 'a lawyer needs a proper name, and only facts can be sent');
v = await removeLawyer(env, actor, 'firm-x', 'dee-evans-2');
ok(v.lawyers.length === 4 && !v.lawyers.some((l) => l.slug === 'dee-evans-2') && audits('firm-x').includes('firm.lawyer.remove'), 'a lawyer can be removed');
ok(await refused(() => removeLawyer(env, actor, 'firm-x', 'dee-evans-2'), 404), 'removing someone twice is a 404');
v = await setLawyersOff(env, actor, 'firm-x', true);
ok(v.lawyersOff && !v.pageExists && rec('firm-x').lawyersOff === true && lawyersOf(rec('firm-x')).length === 0, 'the whole Lawyers page can be switched off');
ok(page({ tab: 'lawyers' }) === null && !page(null).includes('/lawyers"'), 'switched off: no Lawyers page, no tab, no link');
v = await setLawyersOff(env, actor, 'firm-x', false);
ok(!v.lawyersOff && !('lawyersOff' in rec('firm-x')) && v.pageExists, 'and switched on again');
ok(await refused(() => setLawyersOff(env, actor, 'firm-x', 'no')), 'on or off, nothing else');

// the bulk update leaves a list the firm has touched alone (the same SQL the deploy runs)
const upd = readFileSync(new URL('../db/lawyers-updates.sql', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('UPDATE'));
const slugOf = upd.match(/WHERE slug = '([^']+)'/)[1];
put(slugOf, { slug: slugOf, name: 'Bulk', lawyers: [{ name: 'Old Entry' }], lawyersLocked: true });
put('open-firm', { slug: 'open-firm', name: 'Open' });
db.exec(upd);
eq(rec(slugOf).lawyers, [{ name: 'Old Entry' }], 'the bulk update does not overwrite a list the firm has edited (lawyersLocked)');
db.prepare("UPDATE firms SET data = json_set(data, '$.lawyersLocked', NULL) WHERE slug = ?").run(slugOf);
db.exec(upd.replace(/json_extract\(data, '\$\.lawyersLocked'\) IS NULL/, '1'));
ok(true, 'the update statement is plain SQL a database accepts');

// ================================================================ pictures
// a firm on the Basic plan cannot add pictures (a Featured benefit); an admin always can
put('basic-firm', firmRecord({ slug: 'basic-firm', featured: false }), 0);
ok(await refused(() => setLawyerPhoto(env, actor, 'basic-firm', 'bo-chan', { request: upload(jpeg(300, 300)) }, { admin: false }), 403), 'a Basic firm cannot add a lawyer picture (a Featured benefit)');
ok(files.size === 0 && db.prepare('SELECT COUNT(*) AS n FROM lawyer_photos').get().n === 0, 'and nothing is stored');

put('firm-x', { ...rec('firm-x'), featured: true }, 1);
v = await setLawyerPhoto(env, actor, 'firm-x', 'bo-chan', { request: upload(jpeg(300, 400)) }, { admin: false });
const bo = rec('firm-x').lawyers.find((l) => l.slug === 'bo-chan');
const boId = /^\/?img\/([0-9a-f]{24})$/.exec(bo.photo)?.[1];
ok(boId && bo.photoConfirmed === true && files.has(`img/${boId}`) && db.prepare('SELECT * FROM lawyer_photos WHERE id = ?').get(boId).lawyer_slug === 'bo-chan', 'an uploaded picture is stored, tied to the lawyer and confirmed by the firm');
ok(v.lawyers.find((l) => l.slug === 'bo-chan').photo.state === 'confirmed' && lawyersOf(rec('firm-x')).find((l) => l.slug === 'bo-chan').photo === `/img/${boId}`, 'the public page gets the picture under /img/<id>');
const html = renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view: { tab: 'lawyers' } });
ok(html.includes(`src="/img/${boId}"`), 'the Lawyers page shows it');
ok(renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view: { tab: 'lawyer', lawyer: 'bo-chan' } }).includes(`"image": "https://lawdb.ca/img/${boId}"`) || renderFirmPage({ firm: { ...rec('firm-x'), about: 'x '.repeat(60) }, view: { tab: 'lawyer', lawyer: 'bo-chan' } }).includes(`"image":"https://lawdb.ca/img/${boId}"`), 'and the lawyer\'s markup has the picture with its full address');
// served by the same address as the firm pictures
let res = await serveImage({ request: new Request(`https://lawdb.ca/img/${boId}`), env, ctx: { waitUntil() {} } });
ok(res.status === 200 && res.headers.get('content-type') === 'image/jpeg' && res.headers.get('x-content-type-options') === 'nosniff', '/img/<id> serves a lawyer picture, safely');
db.prepare("UPDATE firms SET status = 'hidden' WHERE slug = 'firm-x'").run();
res = await serveImage({ request: new Request(`https://lawdb.ca/img/${boId}`), env, ctx: { waitUntil() {} } });
ok(res.status === 404, 'and not once the firm is switched off');
db.prepare("UPDATE firms SET status = 'live' WHERE slug = 'firm-x'").run();
db.prepare("INSERT INTO firm_images (id, firm_slug, content_type) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa', 'firm-x', 'image/png')").run();
files.set('img/aaaaaaaaaaaaaaaaaaaaaaaa', 'png');
res = await serveImage({ request: new Request('https://lawdb.ca/img/aaaaaaaaaaaaaaaaaaaaaaaa'), env, ctx: { waitUntil() {} } });
ok(res.status === 200 && res.headers.get('content-type') === 'image/png', 'firm pictures are served as before');

// replacing and removing
v = await setLawyerPhoto(env, actor, 'firm-x', 'bo-chan', { request: upload(jpeg(256, 256)) }, { admin: false });
const bo2 = rec('firm-x').lawyers.find((l) => l.slug === 'bo-chan');
ok(bo2.photo !== bo.photo && !files.has(`img/${boId}`) && db.prepare('SELECT COUNT(*) AS n FROM lawyer_photos WHERE lawyer_slug = ?').get('bo-chan').n === 1, 'a new picture replaces the old one, and the old file is deleted');
v = await removeLawyerPhoto(env, actor, 'firm-x', 'bo-chan');
ok(v.lawyers.find((l) => l.slug === 'bo-chan').photo.state === 'none' && files.size === 1 && db.prepare('SELECT COUNT(*) AS n FROM lawyer_photos').get().n === 0, 'removing a picture deletes the file and the record');

// the picture found on the firm's website: copied only when the firm says to
stubFetch(async (u) => { ok(u === FOUND, 'the stored address is the one fetched'); return new Response(jpeg(320, 320), { status: 200, headers: { 'content-type': 'image/jpeg' } }); });
v = await setLawyerPhoto(env, actor, 'firm-x', 'ann-lee', { fromFound: true }, { admin: false });
let ann = rec('firm-x').lawyers.find((l) => l.slug === 'ann-lee');
ok(ann.photoConfirmed === true && /^\/?img\//.test(ann.photo) && ann.photoFound === FOUND && files.has(`img/${/([0-9a-f]{24})$/.exec(ann.photo)[1]}`), '"Use this picture" copies the picture into our own storage and confirms it; the website address is kept');
v = await removeLawyerPhoto(env, actor, 'firm-x', 'ann-lee');
eq(v.lawyers.find((l) => l.slug === 'ann-lee').photo, { state: 'found', url: FOUND }, 'removing the firm\'s own picture brings the found one back as "found", not shown');
v = await removeLawyerPhoto(env, actor, 'firm-x', 'ann-lee');
eq(v.lawyers.find((l) => l.slug === 'ann-lee').photo, { state: 'none' }, '"Not this one" removes the found picture for good');
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-x', 'ann-lee', { fromFound: true }, { admin: false })), 'with no found picture there is nothing to use');
// what is refused
stubFetch(async () => new Response('not found', { status: 404 }));
put('firm-y', firmRecord({ slug: 'firm-y', featured: true }), 1);
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'ann-lee', { fromFound: true }, { admin: false })), 'a picture that cannot be fetched is refused with a clear message');
stubFetch(async () => new Response('<html>hello</html>'.padEnd(80, ' '), { status: 200 }));
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'ann-lee', { fromFound: true }, { admin: false }), 415), 'a file that is not a picture is refused');
stubFetch(async () => { throw new Error('boom'); });
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'ann-lee', { fromFound: true }, { admin: false })), 'a network failure is a plain refusal, not a crash');
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'bo-chan', { request: upload(new Uint8Array(40)) }, { admin: false }), 415) && await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'bo-chan', { request: upload(jpeg(50, 50)) }, { admin: false })) && await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'bo-chan', { request: upload(jpeg(600, 120)) }, { admin: false })) && await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'bo-chan', { request: upload(new Uint8Array(0)) }, { admin: false }), 422), 'something that is not a picture, a tiny one, a wide banner, or nothing is refused');
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'nobody', { request: upload(jpeg(300, 300)) }, { admin: false }), 404), 'a picture for an unknown lawyer is a 404');
const big = new Uint8Array(3 * 1024 * 1024 + 1); big.set(jpeg(300, 300));
ok(await refused(() => setLawyerPhoto(env, actor, 'firm-y', 'bo-chan', { request: upload(big) }, { admin: false }), 413), 'a picture over 3 MB is refused');
ok(db.prepare("SELECT COUNT(*) AS n FROM lawyer_photos WHERE firm_slug = 'firm-y'").get().n === 0, 'a refused picture leaves nothing behind');
// a removed lawyer takes their picture with them
put('firm-z', firmRecord({ slug: 'firm-z', featured: true }), 1);
await setLawyerPhoto(env, actor, 'firm-z', 'bo-chan', { request: upload(jpeg(300, 300)) }, { admin: false });
const countFiles = files.size;
await removeLawyer(env, actor, 'firm-z', 'bo-chan');
ok(files.size === countFiles - 1 && db.prepare("SELECT COUNT(*) AS n FROM lawyer_photos WHERE firm_slug = 'firm-z'").get().n === 0, 'removing a lawyer deletes their picture');
// an admin is not held to the Featured limit
put('firm-a', firmRecord({ slug: 'firm-a', featured: false }), 0);
await setLawyerPhoto(env, { id: 1, email: 'admin@lawdb.ca' }, 'firm-a', 'bo-chan', { request: upload(jpeg(300, 300)) }, { admin: true });
ok(rec('firm-a').lawyers.find((l) => l.slug === 'bo-chan').photoConfirmed === true, 'an admin can add a picture to any firm');
ok(audits('firm-x').filter((a) => a === 'firm.lawyer.photo').length >= 3 && audits('firm-x').includes('firm.lawyer.photo.remove'), 'every picture change is in the audit log');

// ================================================================ together with the admin's Lawyer photos tab (src/lib/lawyer-photos.js)
// The admin accepts (a copy at lawyer/<id>, shown at /img/lawyer/<id>) or erases the pictures found on a firm's website; the decisions are kept in `lawyerPhotos`.
const HOST = (c) => `/img/lawyer/${c.repeat(24)}`;
const decisions = { 'ann-lee': { status: 'ok', photo: HOST('b'), from: FOUND, at: '2026-11-20' }, 'bo-chan': { status: 'no', from: 'https://cdn.firm.example/bo.jpg', at: '2026-11-20' } };
files.set(`lawyer/${'b'.repeat(24)}`, 'accepted copy');
const withFound = (extra) => ({ slug: 'adm-firm', name: 'Adm Firm', city: 'Calgary', province: 'AB', website: 'https://firm.example', featured: true, lawyerPhotos: decisions, ...extra,
  lawyers: [{ name: 'Ann Lee', slug: 'ann-lee', title: 'Partner', callYear: 2005, photo: FOUND, photoConfirmed: false }, { name: 'Bo Chan', slug: 'bo-chan', title: 'Associate', callYear: 2015, photo: 'https://cdn.firm.example/bo.jpg', photoConfirmed: false },
    { name: 'Cy Diaz', slug: 'cy-diaz', title: 'Associate', photo: 'https://cdn.firm.example/cy.jpg', photoConfirmed: false }] });
put('adm-firm', withFound(), 1);
v = await getLawyers(env, 'adm-firm');
const ph = (slug) => v.lawyers.find((l) => l.slug === slug).photo;
eq(ph('ann-lee'), { state: 'confirmed', url: HOST('b') }, 'a picture the admin accepted is shown as confirmed in the firm\'s editor');
eq(ph('bo-chan'), { state: 'none' }, 'one the admin erased is not offered');
eq(ph('cy-diaz'), { state: 'found', url: 'https://cdn.firm.example/cy.jpg' }, 'one nobody has decided on is "found"');
ok(lawyersOf(rec('adm-firm')).find((l) => l.slug === 'ann-lee').photo === HOST('b') && !lawyersOf(rec('adm-firm')).find((l) => l.slug === 'bo-chan').photo && !lawyersOf(rec('adm-firm')).find((l) => l.slug === 'cy-diaz').photo, 'the page shows the accepted picture only');
eq(photoCandidates(rec('adm-firm')).map((c) => c.slug), ['cy-diaz'], "the admin's queue holds only the picture nobody has decided on");
eq(sourcePhoto(rec('adm-firm'), 'cy-diaz'), 'https://cdn.firm.example/cy.jpg', 'the admin can look at the picture found on the website');

// saving an edit never loses the found address or the admin's decisions, and writes only the keys it owns
db.prepare("UPDATE firms SET data = json_set(data, '$.bookingUrl', 'https://book.example/x') WHERE slug = 'adm-firm'").run();
await saveLawyer(env, actor, 'adm-firm', 'ann-lee', { title: 'Senior Partner' }, { admin: false });
let r = rec('adm-firm');
ok(r.lawyerPhotos['ann-lee'].status === 'ok' && r.lawyerPhotos['bo-chan'].status === 'no' && r.bookingUrl === 'https://book.example/x' && r.name === 'Adm Firm', 'an edit keeps the admin\'s decisions and every other part of the record');
ok(r.lawyers.find((l) => l.slug === 'cy-diaz').photo === 'https://cdn.firm.example/cy.jpg' && r.lawyers.find((l) => l.slug === 'ann-lee').photo === FOUND && lawyersOf(r).find((l) => l.slug === 'ann-lee').photo === HOST('b'), 'and the found picture addresses (an edit used to drop them)');
eq(photoCandidates(r).map((c) => c.slug), ['cy-diaz'], 'a lawyer the firm edited is still judged the same way in the queue');

// the firm's own picture beats the admin's erase, and replaces one the admin accepted
ok(await refused(() => setLawyerPhoto(env, actor, 'adm-firm', 'bo-chan', { fromFound: true }, { admin: false })), '"use this picture" is not offered for one the admin erased');
await setLawyerPhoto(env, actor, 'adm-firm', 'bo-chan', { request: upload(jpeg(300, 300)) }, { admin: false });
r = rec('adm-firm');
const boOwn = lawyersOf(r).find((l) => l.slug === 'bo-chan').photo;
ok(/^\/img\/[0-9a-f]{24}$/.test(boOwn) && !boOwn.startsWith('/img/lawyer/') && r.lawyerPhotos['bo-chan'].status === 'no', "the firm's own upload is shown even though the admin erased the found picture");
eq(photoCandidates(r).map((c) => c.slug), ['cy-diaz'], "a lawyer with a picture of their own is not in the admin's queue");
await setLawyerPhoto(env, actor, 'adm-firm', 'ann-lee', { request: upload(jpeg(300, 300)) }, { admin: false });
r = rec('adm-firm');
ok(lawyersOf(r).find((l) => l.slug === 'ann-lee').photo !== HOST('b') && !(r.lawyerPhotos && r.lawyerPhotos['ann-lee']) && !files.has(`lawyer/${'b'.repeat(24)}`), "the firm's own picture replaces one the admin accepted: the copy and the decision are removed");
ok(r.lawyerPhotos['bo-chan'].status === 'no', "the admin's other decisions are kept");
v = await removeLawyerPhoto(env, actor, 'adm-firm', 'ann-lee');
eq(ph('ann-lee') && v.lawyers.find((l) => l.slug === 'ann-lee').photo, { state: 'found', url: FOUND }, "removing the firm's own picture brings the found one back as undecided");

// a picture the admin accepted can be taken off by the firm: it is erased the way the admin's cross erases it
put('adm2', withFound({ slug: 'adm2', lawyerPhotos: { 'ann-lee': { status: 'ok', photo: HOST('c'), from: FOUND, at: '2026-11-20' } } }), 1);
files.set(`lawyer/${'c'.repeat(24)}`, 'accepted copy');
v = await removeLawyerPhoto(env, actor, 'adm2', 'ann-lee');
r = rec('adm2');
ok(r.lawyerPhotos['ann-lee'].status === 'no' && !files.has(`lawyer/${'c'.repeat(24)}`) && v.lawyers.find((l) => l.slug === 'ann-lee').photo.state === 'none' && !lawyersOf(r).find((l) => l.slug === 'ann-lee').photo, 'removing an accepted picture erases it and deletes the copy');
// and removing a lawyer takes the admin's copy and decision with them
put('adm3', withFound({ slug: 'adm3', lawyerPhotos: { 'ann-lee': { status: 'ok', photo: HOST('d'), from: FOUND, at: '2026-11-20' }, 'cy-diaz': { status: 'no', from: 'x', at: '2026-11-20' } } }), 1);
files.set(`lawyer/${'d'.repeat(24)}`, 'accepted copy');
await removeLawyer(env, actor, 'adm3', 'ann-lee');
r = rec('adm3');
ok(!files.has(`lawyer/${'d'.repeat(24)}`) && !('ann-lee' in r.lawyerPhotos) && r.lawyerPhotos['cy-diaz'].status === 'no', 'removing a lawyer deletes the accepted copy and that decision, and keeps the others');
// the one rule for what is shown
eq(photoStateOf({ photo: '/img/' + 'e'.repeat(24), photoConfirmed: true }, { status: 'no' }), { state: 'confirmed', url: '/img/' + 'e'.repeat(24), by: 'firm' }, "the firm's own picture comes first");
eq(photoStateOf({ photo: FOUND, photoConfirmed: false }, { status: 'ok', photo: HOST('f') }).by, 'admin', 'then the admin\'s accepted copy');
eq(photoStateOf({ photo: FOUND, photoConfirmed: false }, { status: 'no' }), { state: 'none' }, 'an erased picture is not shown or offered');
eq(photoStateOf({ photo: FOUND, photoConfirmed: false }, null), { state: 'found', url: FOUND }, 'an undecided one is only "found"');
eq(photoStateOf({ photo: 'http://x/y.jpg', photoConfirmed: false }, null), { state: 'none' }, 'and only over https');
ok(!JSON.stringify(lawyersOf(rec('adm-firm'))).includes('cdn.firm.example'), 'no address on the firm\'s own website ever reaches a page');

// ================================================================ what the public can see
put('pub-firm', firmRecord({ slug: 'pub-firm', lawyersLocked: true, lawyersOff: false, lawyerPhotos: { 'ann-lee': { status: 'no', from: FOUND, at: '2026-11-21' } } }));
const api = await publicFirm({ params: { slug: 'pub-firm' }, env });
const body = await api.json();
ok(!('lawyers' in body) && !('lawyersLocked' in body) && !('lawyersOff' in body) && !('lawyerPhotos' in body) && body.name === 'Firm X', 'the public firm API never returns the stored lawyers list (unconfirmed pictures, hidden lawyers)');
ok(!JSON.stringify(lawyersOf(rec('pub-firm'))).includes(FOUND), 'an unconfirmed picture never reaches a page');
const hiddenFirm = firmRecord({ lawyers: [{ ...stored[0], hidden: true }, stored[1], stored[2]] });
ok(!JSON.stringify(lawyersOf(hiddenFirm)).includes('Ann Lee'), 'a hidden lawyer never reaches a page');

// ================================================================ the cleaning rules still hold for what the firm confirmed
ok(cleanLawyers([{ name: 'Fay Green', confirmed: true, title: 'Associate, $325/hr' }])[0].title === undefined, 'a confirmed title with a fee is still left out of a page');
ok(cleanLawyers([{ name: 'Gus Hall', confirmed: true, title: 'Best lawyer in Calgary' }])[0].title === undefined, 'a confirmed title with a restricted claim is still left out of a page');
ok(cleanLawyers([{ name: 'Gus Hall', confirmed: true, slug: 'gus-h', education: ['https://x.example', 'J.D., University of Calgary'] }])[0].education.join() === 'J.D., University of Calgary' && cleanLawyers([{ name: 'Gus Hall', confirmed: true, slug: 'gus-h' }])[0].slug === 'gus-h', 'a confirmed lawyer keeps the page address; a link in education is left out');
ok(cleanLawyers([{ name: 'Hal Irving', slug: 'something-else' }])[0].slug === 'hal-irving', 'an unconfirmed entry always gets its address from the name');
const twice = cleanLawyers([{ name: 'Ivy Jones', confirmed: true, slug: 'ivy-j', title: 'Partner', photo: 'img/' + 'a'.repeat(24), photoConfirmed: true, hidden: true }]);
eq(cleanLawyers(twice.map((l) => ({ ...l, photoConfirmed: true }))), twice, 'cleaning twice gives the same result, pictures and flags included');

// ================================================================ the wiring
const worker = readFileSync('src/worker.js', 'utf8');
for (const who of ['admin', 'account']) {
  for (const [m, p] of [['GET', ''], ['POST', ''], ['PATCH', ''], ['PATCH', '/:lawyer'], ['DELETE', '/:lawyer'], ['POST', '/:lawyer/picture'], ['DELETE', '/:lawyer/picture']]) {
    ok(worker.includes(`route('${m}', '/api/${who}/firms/:slug/lawyers${p}',`), `${who}: ${m} lawyers${p} is registered`);
  }
}
ok(/lawyersPanel/.test(readFileSync('admin/profile-editor.js', 'utf8')) && /mode, featured|featured: !!firm.featured/.test(readFileSync('admin/profile-editor.js', 'utf8')), 'the profile editor has the Lawyers panel for owners and admins');
ok(SLUG_TABLES.includes('lawyer_photos') && MERGE_DROPPED.includes('lawyer_photos') && /lawyer_photos: 'SELECT/.test(readFileSync('src/lib/backup.js', 'utf8')), 'a renamed or merged firm and the nightly backup know about lawyer pictures');
ok(/lawyersPanel|lawyers-panel/.test(readFileSync('admin/profile-editor.js', 'utf8')) && !/\.innerHTML|innerHTML\s*=|insertAdjacentHTML|outerHTML/.test(readFileSync('admin/lawyers-panel.js', 'utf8')), 'the panel never uses innerHTML');

// ================================================================ awards and a direct phone number (Featured benefits)
put('paid-basic', firmRecord({ slug: 'paid-basic', featured: false }), 0);
ok(await refused(() => saveLawyer(env, actor, 'paid-basic', 'bo-chan', { achievements: ['Lexpert Rising Star, 2023'] }, { admin: false }), 403), 'a Basic firm cannot list awards (a Featured benefit)');
ok(await refused(() => saveLawyer(env, actor, 'paid-basic', 'bo-chan', { phone: '(403) 555-0100' }, { admin: false }), 403), "and cannot add a lawyer's direct phone number");
ok(!rec('paid-basic').lawyers.some((l) => l.achievements || l.phone), 'and nothing is stored');
await saveLawyer(env, actor, 'paid-basic', 'bo-chan', { achievements: [], phone: '' }, { admin: false });
ok(true, 'clearing them is always allowed');
await saveLawyer(env, actor, 'paid-basic', 'bo-chan', { achievements: ['Lexpert Rising Star, 2023'], phone: '(403) 555-0100' }, { admin: true });
ok(rec('paid-basic').lawyers.find((l) => l.slug === 'bo-chan').phone === '+14035550100', 'an admin is never limited, and the number is stored as +1 and ten digits');
put('paid-feat', firmRecord({ slug: 'paid-feat', featured: true }), 1);
v = await saveLawyer(env, actor, 'paid-feat', 'bo-chan', { achievements: ['Lexpert Rising Star, 2023', 'Chair, Family Law Section, 2021', 'Lexpert Rising Star, 2023'], phone: '403-555-0100' }, { admin: false });
const paid = rec('paid-feat').lawyers.find((l) => l.slug === 'bo-chan');
eq(paid.achievements, ['Lexpert Rising Star, 2023', 'Chair, Family Law Section, 2021'], 'a Featured firm lists awards (a repeat is dropped)');
ok(paid.phone === '+14035550100' && v.lawyers.find((l) => l.slug === 'bo-chan').phone === '+14035550100' && v.lawyers.find((l) => l.slug === 'bo-chan').achievements.length === 2, 'and a direct number; the editor gets both back');
const paidPage = (r, view) => renderFirmPage({ firm: { ...r, about: 'x '.repeat(60) }, view });
const featPage = paidPage(rec('paid-feat'), { tab: 'lawyer', lawyer: 'bo-chan' });
ok(featPage.includes('<h3>Awards and achievements</h3>') && featPage.includes('Lexpert Rising Star, 2023') && featPage.includes('href="tel:+14035550100">Call (403) 555-0100</a>'), "the lawyer's page lists the awards and has a Call button");
ok(paidPage(rec('paid-feat'), { tab: 'lawyers' }).includes('class="call" href="tel:+14035550100"'), "and the lawyer's card on the Lawyers page has the number too");
const lapsed = { ...rec('paid-feat'), featured: false };
const lapsedPage = paidPage(lapsed, { tab: 'lawyer', lawyer: 'bo-chan' });
ok(!lapsedPage.includes('Awards and achievements') && !lapsedPage.includes('tel:+14035550100') && !paidPage(lapsed, { tab: 'lawyers' }).includes('tel:+14035550100'), 'when the firm is no longer Featured the pages stop showing them (they stay on record)');
ok(rec('paid-feat').lawyers.find((l) => l.slug === 'bo-chan').phone === '+14035550100', 'and they are still on record for when it comes back');
for (const bad of ['555', '(035) 171-7773', '123-456-7890', 'call me', '+44 20 7946 0958']) ok(await refused(() => saveLawyer(env, actor, 'paid-feat', 'bo-chan', { phone: bad }, { admin: false })), `"${bad}" is not accepted as a phone number`);
ok(await refused(() => saveLawyer(env, actor, 'paid-feat', 'bo-chan', { achievements: ['See https://example.com for awards'] }, { admin: false })), 'an award with a link is refused');
ok(await refused(() => saveLawyer(env, actor, 'paid-feat', 'bo-chan', { achievements: ['The best criminal lawyer in Calgary'] }, { admin: false })), 'an award that is a claim the law societies restrict is refused');
ok(await refused(() => saveLawyer(env, actor, 'paid-feat', 'bo-chan', { achievements: ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `Award ${x} 2020`) }, { admin: false })), 'at most five lines');
ok(cleanLawyers([{ name: 'Di Poe', slug: 'di-poe', title: 'Associate', achievements: ['Lexpert Rising Star, 2023'], phone: '+14035550100' }]).every((l) => !l.achievements && !l.phone), 'awards and a phone number that were not stated by the firm itself are never shown');

console.log(`lawyer editing: ${n} checks passed`);
