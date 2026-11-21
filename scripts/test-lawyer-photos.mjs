// The admin's Lawyer photos tab (src/lib/lawyer-photos.js) and the rules for showing a picture (src/lib/lawyers.js):
//   node --no-warnings scripts/test-lawyer-photos.mjs
// A picture is shown only when the admin accepted it (a copy kept on LawDB), never one that was erased, never an address on another site; accepting keeps
// a copy and checks the file; erasing and undoing leave nothing behind; the queue starts with the strongest firms and does not show what is decided.
import { cleanLawyers, lawyersOf, photoCandidates, sourcePhoto, HOSTED_PHOTO } from '../src/lib/lawyers.js';
import { photoQueue, decidePhoto, previewPhoto } from '../src/lib/lawyer-photos.js';
import { serveImage } from '../src/routes/images.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const fails = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };

const person = (name, extra = {}) => ({ name, title: 'Associate', photo: `https://firm.example/${name.split(' ')[0].toLowerCase()}.jpg`, ...extra });

// ---- what a page may show ----
{
  const list = [person('Ann Lee'), person('Bob Ray', { photoConfirmed: true }), person('Cy Dunn')];
  const shown = (decisions) => Object.fromEntries(cleanLawyers(list, undefined, decisions).map((l) => [l.slug, l.photo || null]));
  ok(Object.values(shown(null)).filter(Boolean).length === 1 && shown(null)['bob-ray'] === 'https://firm.example/bob.jpg', 'with no decision only an older photoConfirmed picture shows');
  const id = 'b'.repeat(24);
  ok(shown({ 'ann-lee': { status: 'ok', photo: `/img/lawyer/${id}` } })['ann-lee'] === `/img/lawyer/${id}`, 'an accepted picture shows as the copy kept on LawDB');
  ok(shown({ 'ann-lee': { status: 'ok', photo: 'https://evil.example/x.png' } })['ann-lee'] === null, 'an accepted record that points at another site shows nothing');
  ok(shown({ 'ann-lee': { status: 'ok', photo: '/img/lawyer/not-an-id' } })['ann-lee'] === null && shown({ 'ann-lee': { status: 'ok', photo: '/img/' + id } })['ann-lee'] === null, 'only /img/lawyer/<24 hex> is accepted as a copy');
  ok(shown({ 'bob-ray': { status: 'no' } })['bob-ray'] === null, 'an erased picture never shows, even when an older record had it confirmed');
  ok(HOSTED_PHOTO.test(`/img/lawyer/${id}`) && !HOSTED_PHOTO.test(`/img/lawyer/${id}/x`) && !HOSTED_PHOTO.test(`//evil.example/img/lawyer/${id}`), 'the address pattern is exact');
  const firm = { lawyers: list, lawyerPhotos: { 'cy-dunn': { status: 'ok', photo: `/img/lawyer/${id}` } } };
  ok(lawyersOf(firm).find((l) => l.slug === 'cy-dunn').photo === `/img/lawyer/${id}`, 'lawyersOf passes the firm\'s decisions on');
}

// ---- who still needs a decision ----
{
  const firm = { lawyers: [person('Ann Lee'), person('Bob Ray'), { name: 'Cy Dunn', title: 'Partner' }], lawyerPhotos: { 'bob-ray': { status: 'no' } } };
  const c = photoCandidates(firm);
  ok(c.length === 1 && c[0].slug === 'ann-lee' && c[0].photo === 'https://firm.example/ann.jpg', 'the queue has lawyers with a picture and no decision (not the decided, not those without a picture)');
  ok(!photoCandidates({ ...firm, lawyersOff: true }).length, 'a firm that switched its lawyers off has none');
  ok(!photoCandidates({ lawyers: [person('Ann Lee')] }).length, 'a firm with one lawyer (no lawyers page) has none');
  ok(sourcePhoto(firm, 'ann-lee') === 'https://firm.example/ann.jpg' && sourcePhoto(firm, 'cy-dunn') === '' && sourcePhoto(firm, 'nobody') === '' && sourcePhoto(null, 'x') === '', 'the source picture of a lawyer is found, or empty');
}

// ---- a small database and storage in memory, and a firm website that serves one picture ----
const png = (w, h) => { const b = new Uint8Array(48); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); b.set([0x49, 0x48, 0x44, 0x52], 12); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
const firms = new Map();
const addFirm = (slug, data, status = 'live') => firms.set(slug, { slug, status, name: data.name || slug, city: 'Calgary', province: 'AB', data: { name: slug, ...data } });
const audits = [];
const db = {
  prepare(sql) {
    let args = [];
    const q = {
      bind(...a) { args = a; return q; },
      async first() {
        if (/^SELECT data FROM firms WHERE slug = \? AND status = 'live'/.test(sql)) { const f = firms.get(args[0]); return f && f.status === 'live' ? { data: JSON.stringify(f.data) } : null; }
        throw new Error('unexpected first: ' + sql);
      },
      async all() {
        if (/FROM firms WHERE status = 'live' AND json_extract\(data, '\$.lawyers'\) IS NOT NULL/.test(sql)) {
          return { results: [...firms.values()].filter((f) => f.status === 'live' && f.data.lawyers).map((f) => ({ slug: f.slug, name: f.data.name, city: f.city, province: f.province, lawyers: JSON.stringify(f.data.lawyers), photos: f.data.lawyerPhotos ? JSON.stringify(f.data.lawyerPhotos) : null, off: f.data.lawyersOff ? 1 : null })) };
        }
        throw new Error('unexpected all: ' + sql);
      },
      async run() {
        if (/^UPDATE firms SET data = json_set\(data, '\$\.lawyerPhotos', json\(\?\)\)/.test(sql)) { firms.get(args[1]).data.lawyerPhotos = JSON.parse(args[0]); return {}; }
        if (/^UPDATE firms SET data = json_remove\(data, '\$\.lawyerPhotos'\)/.test(sql)) { delete firms.get(args[0]).data.lawyerPhotos; return {}; }
        if (/^INSERT INTO audit_log/.test(sql)) { audits.push(args[2]); return {}; }
        throw new Error('unexpected run: ' + sql);
      },
    };
    return q;
  },
};
const store = new Map();
const IMAGES = {
  async put(key, bytes, opts) { store.set(key, { bytes, httpMetadata: opts.httpMetadata }); },
  async get(key) { const o = store.get(key); return o ? { body: new Blob([o.bytes]).stream(), httpMetadata: o.httpMetadata } : null; },
  async delete(key) { store.delete(key); },
};
const env = { DB: db, IMAGES, PUBLIC_CACHE_TTL: '0' };
const admin = { id: 1, email: 'admin@lawdb.ca' };
const pictures = { 'https://firm.example/ann.jpg': png(300, 300), 'https://firm.example/bob.jpg': png(300, 300), 'https://firm.example/cy.jpg': png(32, 32), 'https://firm.example/di.jpg': new TextEncoder().encode('<html>not a picture, but long enough to pass the length check</html>') };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => (pictures[String(url)] ? new Response(pictures[String(url)], { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('nope', { status: 404 }));

const strong = (name) => ({ name, title: 'Partner', callYear: 2005, photo: `https://firm.example/${name.split(' ')[0].toLowerCase()}.jpg` });
addFirm('strong-firm', { lawyers: [strong('Ann Lee'), strong('Bob Ray'), strong('Cy Dunn'), strong('Di Fox')] });
addFirm('a-plain-firm', { lawyers: [person('Eve Moss'), person('Fay Nye')] }); // no facts: not "strong", so it comes after
addFirm('a-firm-without-pictures', { lawyers: [{ name: 'Gus Hill', title: 'Partner' }, { name: 'Hal Ode', title: 'Partner' }] });
addFirm('a-hidden-firm', { lawyersOff: true, lawyers: [person('Ian Poe'), person('Jo Quinn')] });
addFirm('a-closed-firm', { lawyers: [person('Kim Roe'), person('Lou Sand')] }, 'closed');

// ---- the queue ----
{
  const q = await photoQueue(env, '', 5);
  ok(q.firms.map((f) => f.slug).join() === 'strong-firm,a-plain-firm', 'the queue lists only live firms whose lawyers a page shows and that have pictures, strongest profile first');
  ok(q.left === 6 && q.firmsLeft === 2 && q.accepted === 0 && q.erased === 0, 'it says how many pictures are left');
  ok(!JSON.stringify(q).includes('firm.example'), 'it never sends the address of a picture to the screen');
  const page1 = await photoQueue(env, '', 1);
  const page2 = await photoQueue(env, page1.next, 1);
  ok(page1.firms[0].slug === 'strong-firm' && page2.firms[0].slug === 'a-plain-firm' && !(await photoQueue(env, page2.next, 1)).firms.length, 'the cursor goes on to the next firm and ends');
}

// ---- accept ----
{
  const r = await decidePhoto(env, admin, 'strong-firm', 'ann-lee', 'accept');
  const d = firms.get('strong-firm').data.lawyerPhotos['ann-lee'];
  ok(r.status === 'ok' && d.status === 'ok' && HOSTED_PHOTO.test(d.photo), 'accept keeps a copy and records the address of the copy');
  const key = `lawyer/${d.photo.split('/').pop()}`;
  ok(store.has(key) && store.get(key).httpMetadata.contentType === 'image/png' && store.get(key).bytes.length === 48, 'the copy is in storage with its real picture type');
  ok(d.from === 'https://firm.example/ann.jpg', 'the record remembers where it came from');
  ok(lawyersOf(firms.get('strong-firm').data).find((l) => l.slug === 'ann-lee').photo === d.photo, 'the lawyer\'s page shows the copy');
  ok(!photoCandidates(firms.get('strong-firm').data).some((l) => l.slug === 'ann-lee'), 'and the lawyer leaves the queue');
  ok(audits.includes('lawyer_photo.accept'), 'it is in the activity log');

  // the copy is served to the public, and only while it is in storage
  const get = (path) => serveImage({ request: new Request('https://lawdb.ca' + path), env, ctx: { waitUntil() {} } });
  const res = await get(d.photo);
  ok(res.status === 200 && res.headers.get('content-type') === 'image/png' && res.headers.get('x-content-type-options') === 'nosniff', 'GET /img/lawyer/<id> serves it as a picture, never as anything else');
  ok((await get('/img/lawyer/' + 'c'.repeat(24))).status === 404 && (await get('/img/lawyer/../x')).status === 404 && (await get('/img/lawyer/' + d.photo.split('/').pop() + 'z')).status === 404, 'an unknown or malformed address is 404');
  store.get(key).httpMetadata.contentType = 'text/html';
  ok((await get(d.photo)).status === 404, 'a file that is not a picture type is never served');
  store.get(key).httpMetadata.contentType = 'image/png';

  // undo removes the copy and puts the lawyer back in the queue
  const u = await decidePhoto(env, admin, 'strong-firm', 'ann-lee', 'undo');
  ok(u.status === 'undecided' && !store.has(key) && !firms.get('strong-firm').data.lawyerPhotos, 'undo removes the copy and the record');
  ok(photoCandidates(firms.get('strong-firm').data).some((l) => l.slug === 'ann-lee') && (await get(d.photo)).status === 404, 'the lawyer is back in the queue and the old address is 404');
}

// ---- erase ----
{
  const before = store.size;
  const r = await decidePhoto(env, admin, 'strong-firm', 'bob-ray', 'erase');
  ok(r.status === 'no' && store.size === before && firms.get('strong-firm').data.lawyerPhotos['bob-ray'].status === 'no', 'erase keeps nothing');
  ok(!photoCandidates(firms.get('strong-firm').data).some((l) => l.slug === 'bob-ray') && !lawyersOf(firms.get('strong-firm').data).find((l) => l.slug === 'bob-ray').photo, 'the erased picture is not in the queue and is never shown');
  // erasing one that was accepted removes the copy
  await decidePhoto(env, admin, 'strong-firm', 'ann-lee', 'accept');
  const keyA = `lawyer/${firms.get('strong-firm').data.lawyerPhotos['ann-lee'].photo.split('/').pop()}`;
  await decidePhoto(env, admin, 'strong-firm', 'ann-lee', 'erase');
  ok(!store.has(keyA) && firms.get('strong-firm').data.lawyerPhotos['ann-lee'].status === 'no' && !lawyersOf(firms.get('strong-firm').data).find((l) => l.slug === 'ann-lee').photo, 'erasing an accepted picture removes its copy');
  ok(audits.includes('lawyer_photo.erase'), 'it is in the activity log');
}

// ---- what is refused ----
{
  const before = store.size;
  const stateBefore = JSON.stringify(firms.get('strong-firm').data);
  ok(await fails(() => decidePhoto(env, admin, 'strong-firm', 'cy-dunn', 'accept'), 422), 'a picture under 64 pixels is refused');
  ok(store.size === before && JSON.stringify(firms.get('strong-firm').data) === stateBefore, 'and nothing is kept');
  firms.get('strong-firm').data.lawyers[3].photo = 'https://firm.example/di.jpg';
  ok(await fails(() => decidePhoto(env, admin, 'strong-firm', 'di-fox', 'accept'), 415), 'a file that is not a JPEG, PNG or WebP is refused');
  ok(await fails(() => decidePhoto(env, admin, 'a-firm-without-pictures', 'gus-hill', 'accept'), 404), 'a lawyer with no picture has nothing to accept');
  ok(await fails(() => decidePhoto(env, admin, 'strong-firm', 'ann-lee', 'maybe'), 422), 'only accept, erase and undo are decisions');
  ok(await fails(() => decidePhoto(env, admin, 'a-closed-firm', 'kim-roe', 'accept'), 404) && await fails(() => decidePhoto(env, admin, 'nope', 'x', 'accept'), 404) && await fails(() => decidePhoto(env, admin, '../x', 'y', 'accept'), 404), 'a firm that is not live, does not exist or is not a plain address is 404');
  ok(await fails(() => decidePhoto({ ...env, IMAGES: null }, admin, 'strong-firm', 'cy-dunn', 'accept'), 503), 'without picture storage it says so');
  ok(await fails(() => previewPhoto(env, 'strong-firm', 'nobody'), 404), 'the preview of a lawyer with no picture is 404');
  const pv = await previewPhoto(env, 'a-plain-firm', 'eve-moss').catch((e) => e);
  ok(pv instanceof Error && pv.status === 422, 'the preview fetches only the stored address (this one is not on the test website)');
}

globalThis.fetch = realFetch;
console.log(bad ? `\n${bad} check(s) failed` : '\nall lawyer photo checks passed');
process.exit(bad ? 1 : 0);
