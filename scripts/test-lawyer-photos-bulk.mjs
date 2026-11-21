// The admin's "Accept all remaining" on the Lawyer photos tab (acceptFirm and photoFirms in src/lib/lawyer-photos.js):
//   node --no-warnings scripts/test-lawyer-photos-bulk.mjs
// It is the check mark pressed on every pending picture, firm by firm, with more caution: only plain headshots are accepted, the rest stay in the queue with a reason,
// decisions made at the same moment by someone else are never overwritten, a failed write leaves no copies behind, and every decision is marked bulk.
import { readFileSync } from 'node:fs';
import { acceptFirm, photoFirms, photoQueue, BULK_MAX, BULK_RULES } from '../src/lib/lawyer-photos.js';
import { lawyersOf, photoCandidates, HOSTED_PHOTO } from '../src/lib/lawyers.js';
import { LAWYER_PHOTO_RULES } from '../src/lib/lawyer-edit.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const fails = async (fn, status) => { try { await fn(); return false; } catch (e) { return e.status === status; } };

// ---- pretend database, storage and firm websites
const png = (w, h) => { const b = new Uint8Array(48); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); b.set([0x49, 0x48, 0x44, 0x52], 12); const v = new DataView(b.buffer); v.setUint32(16, w); v.setUint32(20, h); return b; };
const firms = new Map();
const addFirm = (slug, data, status = 'live') => firms.set(slug, { slug, status, city: 'Calgary', province: 'AB', data: { name: slug, ...data } });
const audits = [];
let failWrite = false;
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
        if (/^UPDATE firms SET data = json_set\(data, '\$\.lawyerPhotos', json\(\?\)\)/.test(sql)) { if (failWrite) throw new Error('database down'); firms.get(args[1]).data.lawyerPhotos = JSON.parse(args[0]); return {}; }
        if (/^INSERT INTO audit_log/.test(sql)) { audits.push({ action: args[2], detail: JSON.parse(args[5]) }); return {}; }
        throw new Error('unexpected run: ' + sql);
      },
    };
    return q;
  },
};
const store = new Map();
const IMAGES = { async put(key, bytes, opts) { store.set(key, { bytes, httpMetadata: opts.httpMetadata }); }, async get(key) { const o = store.get(key); return o ? { body: new Blob([o.bytes]).stream(), httpMetadata: o.httpMetadata } : null; }, async delete(key) { store.delete(key); } };
const env = { DB: db, IMAGES };
const admin = { id: 1, email: 'admin@lawdb.ca' };
const site = {}; // address -> bytes
const hooks = {}; // address -> function run just before that picture is served
const realFetch = globalThis.fetch;
const fetched = [];
globalThis.fetch = async (url) => { const u = String(url); fetched.push(u); if (hooks[u]) hooks[u](); return site[u] ? new Response(site[u], { status: 200, headers: { 'content-type': 'image/png' } }) : new Response('nope', { status: 404 }); };
const person = (first, extra = {}) => ({ name: `${first} Lee`, title: 'Partner', callYear: 2005, photo: `https://firm.example/${first.toLowerCase()}.jpg`, ...extra });
const serve = (...firstNames) => firstNames.forEach((n) => { site[`https://firm.example/${n.toLowerCase()}.jpg`] = png(300, 360); });

// ---- the rules are the same as the firm's own upload
ok(BULK_RULES.minSide === LAWYER_PHOTO_RULES.minSide && BULK_RULES.minRatio === LAWYER_PHOTO_RULES.minRatio && BULK_RULES.maxRatio === LAWYER_PHOTO_RULES.maxRatio, 'the shape rules are the same as for a picture the firm uploads itself');
ok(BULK_MAX >= 10 && BULK_MAX <= 50, `a call takes at most ${BULK_MAX} pictures`);

// ---- who is waiting
addFirm('strong-firm', { lawyers: ['Ann', 'Bea', 'Cal', 'Dee'].map((n) => person(n)) });
addFirm('plain-firm', { lawyers: [{ name: 'Eve Moss', title: 'Associate', photo: 'https://firm.example/eve.jpg' }, { name: 'Fay Nye', title: 'Associate', photo: 'https://firm.example/fay.jpg' }] });
addFirm('no-pictures', { lawyers: [{ name: 'Gus Hill', title: 'Partner' }, { name: 'Hal Ode', title: 'Partner' }] });
addFirm('closed-firm', { lawyers: [person('Ian'), person('Jo')] }, 'closed');
{
  const t = await photoFirms(env);
  ok(t.firms.map((f) => f.slug).join() === 'strong-firm,plain-firm' && t.firms[0].pending === 4 && t.pictures === 6 && t.accepted === 0, 'the list holds only live firms with pictures to decide, strongest first, with how many');
  ok(!JSON.stringify(t).includes('firm.example'), 'it never sends the address of a picture to the screen');
  const q = await photoQueue(env, '', 5);
  ok(q.left === 6 && q.firms.length === 2, 'and the tab\'s own queue still works the same way');
}

// ---- accepting a whole firm
serve('Ann', 'Bea', 'Cal', 'Dee');
{
  const before = fetched.length;
  const r = await acceptFirm(env, admin, 'strong-firm');
  const photos = firms.get('strong-firm').data.lawyerPhotos;
  ok(r.accepted === 4 && r.failed.length === 0 && r.more === 0 && r.left === 0, 'all four pictures were accepted in one call');
  ok(Object.keys(photos).length === 4 && Object.values(photos).every((d) => d.status === 'ok' && HOSTED_PHOTO.test(d.photo) && d.bulk === true && /^https:\/\/firm\.example\//.test(d.from)), 'each is recorded as a copy kept on LawDB, marked bulk, with where it came from');
  ok(Object.values(photos).every((d) => store.has(`lawyer/${d.photo.split('/').pop()}`) && store.get(`lawyer/${d.photo.split('/').pop()}`).httpMetadata.contentType === 'image/png') && store.size === 4, 'the copies are in storage with their real picture type');
  ok(lawyersOf(firms.get('strong-firm').data).every((l) => l.photo && HOSTED_PHOTO.test(l.photo)), 'every lawyer\'s page now shows the copy');
  ok(photoCandidates(firms.get('strong-firm').data).length === 0, 'and they are out of the queue');
  ok(fetched.length - before === 4, 'each picture was fetched once');
  ok(audits.length === 1 && audits[0].action === 'lawyer_photo.accept_all' && audits[0].detail.accepted === 4 && audits[0].detail.lawyers.length === 4, 'the activity log has one entry for the firm, with the lawyers');
  const again = await acceptFirm(env, admin, 'strong-firm');
  ok(again.accepted === 0 && again.more === 0 && store.size === 4, 'running it again does nothing and leaves nothing new behind');
}

// ---- what is not accepted stays in the queue, with the reason
{
  site['https://firm.example/eve.jpg'] = png(100, 100);            // small
  site['https://firm.example/fay.jpg'] = png(800, 150);            // a banner
  const r = await acceptFirm(env, admin, 'plain-firm');
  ok(r.accepted === 0 && r.failed.length === 2 && /small/.test(r.failed[0].why) && /portrait or square/.test(r.failed[1].why), 'a small picture and a banner are left, each with its reason');
  ok(photoCandidates(firms.get('plain-firm').data).length === 2 && !firms.get('plain-firm').data.lawyerPhotos && store.size === 4, 'they are still in the queue, and nothing was stored');
  ok(!audits.some((a) => a.detail && a.detail.lawyers && a.detail.lawyers.includes('eve-moss')), 'and nothing is logged as accepted for them');
}
{
  addFirm('mixed', { lawyers: [person('Kay'), person('Lou'), person('Max'), person('Ned'), person('Oz')] });
  serve('Kay', 'Lou');
  site['https://firm.example/max.jpg'] = new TextEncoder().encode('<html>not a picture</html>'.padEnd(60, ' '));
  // Ned's picture cannot be opened (404); Oz gets a very large picture
  site['https://firm.example/oz.jpg'] = png(9000, 9000);
  const r = await acceptFirm(env, admin, 'mixed');
  const why = Object.fromEntries(r.failed.map((f) => [f.lawyer, f.why]));
  ok(r.accepted === 2 && r.failed.length === 3 && /JPEG, PNG or WebP/.test(why['max-lee']) && why['ned-lee'] && /large/.test(why['oz-lee']), 'two good pictures accepted; a file that is not a picture, one that cannot be opened and an enormous one are left');
  ok(r.left === 3 && photoCandidates(firms.get('mixed').data).map((c) => c.slug).sort().join() === 'max-lee,ned-lee,oz-lee', 'the three are still waiting');
}
{
  addFirm('twins', { lawyers: [person('Pam'), { ...person('Quin'), photo: 'https://firm.example/pam.jpg' }, person('Rex')] });
  serve('Pam', 'Rex');
  const r = await acceptFirm(env, admin, 'twins');
  ok(r.accepted === 1 && r.failed.length === 2 && r.failed.every((f) => /several lawyers/.test(f.why)), 'one picture used for two lawyers (a logo, a placeholder, a group photo) is left for both, the third lawyer is accepted');
}

// ---- a call takes at most the limit, and what failed is not tried again
{
  addFirm('big', { lawyers: Array.from({ length: 7 }, (_, i) => person(`Zed${String.fromCharCode(97 + i)}`)) });
  serve(...Array.from({ length: 7 }, (_, i) => `Zed${String.fromCharCode(97 + i)}`));
  site['https://firm.example/zeda.jpg'] = png(50, 50);
  const r1 = await acceptFirm(env, admin, 'big', { limit: 3 });
  ok(r1.accepted === 2 && r1.failed.length === 1 && r1.more === 4, 'with a limit of 3, three pictures are tried and four are left for the next call');
  const skip = r1.failed.map((f) => f.lawyer);
  const r2 = await acceptFirm(env, admin, 'big', { limit: 3, skip });
  ok(r2.accepted === 3 && r2.failed.length === 0 && r2.more === 1, 'the next call skips the one that failed and takes the next three');
  const r3 = await acceptFirm(env, admin, 'big', { limit: 3, skip });
  ok(r3.accepted === 1 && r3.more === 0 && r3.left === 1, 'the last call finishes; only the failed one is still waiting');
  const fetchedBefore = fetched.length;
  await acceptFirm(env, admin, 'big', { skip });
  ok(fetched.length === fetchedBefore, 'a skipped lawyer is not fetched again');
  const r4 = await acceptFirm(env, admin, 'big', { limit: 1000, skip: ['x'.repeat(300), 5, null, '../x'] });
  ok(r4.more === 0 && (await acceptFirm(env, admin, 'big', { limit: -4, skip })).accepted === 0, 'a silly limit or skip list is tamed');
}

// ---- someone decided on a lawyer while the pictures were being fetched
{
  addFirm('busy', { lawyers: [person('Sal'), person('Tia'), person('Uma')] });
  serve('Sal', 'Tia', 'Uma');
  hooks['https://firm.example/tia.jpg'] = () => { firms.get('busy').data.lawyerPhotos = { 'tia-lee': { status: 'no', from: 'https://firm.example/tia.jpg', at: '2026-11-22' } }; };
  const copiesBefore = store.size;
  const r = await acceptFirm(env, admin, 'busy');
  const p = firms.get('busy').data.lawyerPhotos;
  ok(r.accepted === 2 && p['tia-lee'].status === 'no' && p['sal-lee'].status === 'ok' && p['uma-lee'].status === 'ok', 'an erase pressed at the same moment is kept; the other two are accepted');
  ok(store.size === copiesBefore + 2, 'the copy made for the lawyer who was erased meanwhile was removed again');
  delete hooks['https://firm.example/tia.jpg'];
}

// ---- a failed write leaves nothing behind
{
  addFirm('unlucky', { lawyers: [person('Vic'), person('Wes')] });
  serve('Vic', 'Wes');
  const before = store.size;
  failWrite = true;
  let threw = false; try { await acceptFirm(env, admin, 'unlucky'); } catch (e) { threw = /database down/.test(e.message); }
  failWrite = false;
  ok(threw && store.size === before && !firms.get('unlucky').data.lawyerPhotos, 'when the database cannot save, the copies are removed and the error is passed on');
  ok(photoCandidates(firms.get('unlucky').data).length === 2, 'so the pictures are still waiting');
}

// ---- decisions already made are left alone
{
  addFirm('decided', { lawyers: [person('Xan'), person('Yul')], lawyerPhotos: { 'xan-lee': { status: 'no', from: 'x', at: '2026-11-01' } } });
  serve('Xan', 'Yul');
  const r = await acceptFirm(env, admin, 'decided');
  ok(r.accepted === 1 && firms.get('decided').data.lawyerPhotos['xan-lee'].status === 'no', 'a picture the admin erased is not brought back, one accepted earlier by hand is not touched');
}

// ---- what is refused
ok(await fails(() => acceptFirm(env, admin, 'closed-firm'), 404) && await fails(() => acceptFirm(env, admin, 'nope'), 404) && await fails(() => acceptFirm(env, admin, '../x'), 404) && await fails(() => acceptFirm(env, admin, ''), 404), 'a firm that is not live, does not exist or has a bad address is a 404');
ok(await fails(() => acceptFirm({ ...env, IMAGES: null }, admin, 'strong-firm'), 503), 'without picture storage it says so');

// ---- the wiring: admin only, one button, no inline styles
const worker = readFileSync('src/worker.js', 'utf8'), adminJs = readFileSync('src/routes/admin.js', 'utf8'), ui = readFileSync('admin/admin.js', 'utf8');
ok(worker.includes("route('GET', '/api/admin/lawyer-photo-firms', admin.lawyerPhotoFirms)") && worker.includes("route('POST', '/api/admin/firms/:slug/lawyer-photos/accept-all', admin.lawyerPhotoAcceptFirm)"), 'both routes are registered under /api/admin');
ok(/export async function lawyerPhotoFirms[\s\S]{0,120}requireAdmin/.test(adminJs) && /export async function lawyerPhotoAcceptFirm[\s\S]{0,120}requireAdmin/.test(adminJs), 'both check that the person is an admin first');
const viewPart = ui.slice(ui.indexOf('async function viewLawyerPhotos'), ui.indexOf('// ---------------------------------------------------------------- logos'));
ok(/Accept all remaining/.test(viewPart) && /confirm\(`Accept \$\{todo\.pictures\}/.test(viewPart) && /Stop/.test(viewPart) && /lawyer-photo-firms/.test(viewPart) && /accept-all/.test(viewPart), 'the tab has the button, asks first, can be stopped, and uses the two routes');
ok(/h\('progress'/.test(viewPart) && !/style:/.test(viewPart) && !/innerHTML/.test(viewPart), 'progress is a progress element (no inline style, which the admin\'s security rules forbid) and nothing is put in with innerHTML');

globalThis.fetch = realFetch;
console.log(bad ? `\n${bad} check(s) failed` : '\nall bulk photo checks passed');
process.exit(bad ? 1 : 0);
