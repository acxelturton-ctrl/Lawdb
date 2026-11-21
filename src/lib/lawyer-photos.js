// The admin's Lawyer photos tab: lawyers' pictures were read from each firm's own website and are not shown on any page until the admin has looked at them.
// For each picture the admin presses a check mark (accept) or a cross (erase):
//   accept  LawDB fetches the picture, checks that it is a real JPEG, PNG or WebP, and keeps its own copy (R2, lawyer/<id>, served at /img/lawyer/<id>), so what
//           was looked at is what is shown, whatever the firm does to its own site later;
//   erase   the picture is never shown and does not come back in the queue.
// The decisions are kept in the firm's record as `lawyerPhotos` (see src/lib/lawyers.js), apart from the list of lawyers, so loading that list again does not undo them.
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { fetchPicture } from './logo-finder.js';
import { IMAGE_RULES } from './images.js';
import { HOSTED_PHOTO, photoCandidates, sourcePhoto, strongLawyerProfile } from './lawyers.js';

const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const objectOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
const hostedId = (p) => (HOSTED_PHOTO.test(p || '') ? p.split('/').pop() : '');

// Firms whose lawyers a page shows, with what is still to be decided, in the order the admin sees them: the firms with the strongest lawyer profiles first (they are
// the ones the homepage and the search show), then the rest by name. Also the totals decided so far.
async function queueRows(env) {
  const { results } = await env.DB.prepare(
    `SELECT slug, json_extract(data, '$.name') AS name, city, province, json_extract(data, '$.lawyers') AS lawyers,
            json_extract(data, '$.lawyerPhotos') AS photos, json_extract(data, '$.lawyersOff') AS off
       FROM firms WHERE status = 'live' AND json_extract(data, '$.lawyers') IS NOT NULL`
  ).all();
  const todo = [];
  let accepted = 0, erased = 0, left = 0;
  for (const r of results) {
    const firm = { lawyers: parse(r.lawyers), lawyerPhotos: objectOf(parse(r.photos)), lawyersOff: Number(r.off) === 1 || r.off === 'true' };
    for (const d of Object.values(firm.lawyerPhotos)) { if (d && d.status === 'ok') accepted++; else if (d && d.status === 'no') erased++; }
    const people = photoCandidates(firm);
    if (!people.length) continue;
    left += people.length;
    todo.push({ cursor: `${strongLawyerProfile(firm) ? 0 : 1}:${r.slug}`, slug: r.slug, name: r.name, city: r.city, province: r.province, people });
  }
  todo.sort((a, b) => (a.cursor < b.cursor ? -1 : 1));
  return { todo, accepted, erased, left };
}

// `after` is the cursor the previous answer gave.
export async function photoQueue(env, after = '', limit = 5) {
  const { todo, accepted, erased, left } = await queueRows(env);
  const page = todo.filter((f) => f.cursor > after).slice(0, limit);
  return {
    firms: page.map(({ cursor, people, ...f }) => ({ ...f, lawyers: people.map(({ photo, ...p }) => p) })),
    next: page.length ? page[page.length - 1].cursor : after,
    left, accepted, erased, firmsLeft: todo.length,
  };
}

// For "Accept all remaining": every firm that still has pictures to decide, in the same order, with how many (no addresses of pictures leave the server).
export async function photoFirms(env) {
  const { todo, accepted, erased, left } = await queueRows(env);
  return { firms: todo.map((f) => ({ slug: f.slug, name: f.name, pending: f.people.length })), pictures: left, accepted, erased };
}

// The picture on the firm's own site, for the admin to look at (the admin pages may not load pictures from other sites directly).
export async function previewPhoto(env, slug, lawyer) {
  if (!SLUG.test(slug) || !SLUG.test(lawyer)) throw new HttpError(404, 'Not found');
  const row = await env.DB.prepare("SELECT data FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first();
  const firm = row && parse(row.data);
  const src = firm && sourcePhoto(firm, lawyer);
  if (!src) throw new HttpError(404, 'No picture for this lawyer');
  return fetchPicture(env, src);
}

// decision: 'accept' | 'erase' | 'undo' (puts the lawyer back in the queue). Returns the lawyer's state.
export async function decidePhoto(env, admin, slug, lawyer, decision) {
  if (!['accept', 'erase', 'undo'].includes(decision)) throw new HttpError(422, 'decision must be accept, erase or undo');
  if (!SLUG.test(slug) || !SLUG.test(lawyer)) throw new HttpError(404, 'Not found');
  const row = await env.DB.prepare("SELECT data FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first();
  const firm = row && parse(row.data);
  if (!firm) throw new HttpError(404, 'Firm not found');
  const photos = { ...objectOf(firm.lawyerPhotos) };
  const prev = photos[lawyer];
  const src = sourcePhoto(firm, lawyer);
  const at = new Date().toISOString().slice(0, 10);
  let made = ''; // the id of a copy made now, removed again if saving fails

  if (decision === 'undo') delete photos[lawyer];
  else if (!src) throw new HttpError(404, 'This lawyer has no picture to decide on');
  else if (decision === 'erase') photos[lawyer] = { status: 'no', from: src.slice(0, 300), at };
  else {
    if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
    const { bytes, info } = await fetchPicture(env, src);
    if (!(info.width >= IMAGE_RULES.minSide && info.height >= IMAGE_RULES.minSide)) throw new HttpError(422, `The picture is too small (each side must be at least ${IMAGE_RULES.minSide} pixels). Erase it.`);
    if (info.width > IMAGE_RULES.maxSide || info.height > IMAGE_RULES.maxSide) throw new HttpError(422, 'The picture is too large. Erase it.');
    made = hex(12);
    await env.IMAGES.put(`lawyer/${made}`, bytes, { httpMetadata: { contentType: MIME[info.format] } });
    photos[lawyer] = { status: 'ok', photo: `/img/lawyer/${made}`, from: src.slice(0, 300), at };
  }

  try {
    if (Object.keys(photos).length) await env.DB.prepare("UPDATE firms SET data = json_set(data, '$.lawyerPhotos', json(?)), updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(photos), slug).run();
    else await env.DB.prepare("UPDATE firms SET data = json_remove(data, '$.lawyerPhotos'), updated_at = datetime('now') WHERE slug = ?").bind(slug).run();
  } catch (err) {
    if (made && env.IMAGES) await env.IMAGES.delete(`lawyer/${made}`).catch(() => {});
    throw err;
  }
  // a copy that is no longer used (erased, undone or replaced) is removed from storage
  const old = hostedId(prev && prev.photo);
  if (old && old !== made && env.IMAGES) await env.IMAGES.delete(`lawyer/${old}`).catch((err) => console.error('lawyer picture delete failed', old, err));
  await audit(env, admin, `lawyer_photo.${decision}`, 'firm', slug, { lawyer, from: (src || (prev && prev.from) || '').slice(0, 200), ...(made ? { id: made } : {}) });
  return { lawyer, status: photos[lawyer] ? photos[lawyer].status : 'undecided' };
}

// ---- "Accept all remaining": every pending picture of ONE firm in one go -------------------------------------------------------------------------------------
// The admin presses one button and the screen goes through the firms one at a time (this function, for one firm). It is the same as pressing the check mark on each
// picture, with these differences, all in the direction of caution:
//   - a picture is only accepted when it is plainly a headshot: a real JPEG, PNG or WebP, at least 120 px on the shorter side, roughly square or portrait (not a banner),
//     and not the same picture for more than one lawyer of the firm (a logo, a placeholder or a group photo). Everything else is left in the queue for the admin to look at,
//     and reported with the reason. (Each picture was also checked, before it was ever listed, for one clear face.)
//   - at most BULK_MAX pictures per call, three at a time, so a call stays short and polite to the firm's website; `more` says whether to call again, and `skip` carries the
//     lawyers that were left out so they are not tried again;
//   - the decisions are written in ONE statement per firm, after re-reading the firm's current decisions: a lawyer the admin decided in the meantime keeps that decision;
//   - every decision made here carries bulk: true, so a whole run can be found (and undone) later;
//   - nothing is half done: copies made for a write that fails are removed again.
export const BULK_MAX = 30;
const BULK_SHAPE = { minSide: 120, minRatio: 0.5, maxRatio: 1.6 }; // the same as the firm's own picture upload (LAWYER_PHOTO_RULES in src/lib/lawyer-edit.js)
export const BULK_RULES = BULK_SHAPE;

export async function acceptFirm(env, admin, slug, { skip = [], limit = BULK_MAX } = {}) {
  if (!SLUG.test(slug)) throw new HttpError(404, 'Not found');
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  const row = await env.DB.prepare("SELECT data FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first();
  const firm = row && parse(row.data);
  if (!firm) throw new HttpError(404, 'Firm not found');
  const pending = photoCandidates(firm);
  const skipped = new Set((Array.isArray(skip) ? skip : []).filter((x) => typeof x === 'string' && SLUG.test(x)).slice(0, 200));
  const todo = pending.filter((p) => !skipped.has(p.slug));
  const n = Math.min(Math.max(Math.floor(Number(limit)) || BULK_MAX, 1), BULK_MAX);
  const batch = todo.slice(0, n);
  const used = new Map();
  for (const p of pending) used.set(p.photo, (used.get(p.photo) || 0) + 1);

  const made = []; // { lawyer, id, from }
  const failed = [];
  const one = async (p) => {
    try {
      if (used.get(p.photo) > 1) throw new Error('the same picture is used for several lawyers (a logo, a placeholder or a group photo)');
      const { bytes, info } = await fetchPicture(env, p.photo);
      if (Math.min(info.width, info.height) < BULK_SHAPE.minSide) throw new Error(`the picture is small (${info.width} x ${info.height})`);
      const ratio = info.width / info.height;
      if (ratio < BULK_SHAPE.minRatio || ratio > BULK_SHAPE.maxRatio) throw new Error(`the picture is not a portrait or square shape (${info.width} x ${info.height})`);
      if (info.width > IMAGE_RULES.maxSide || info.height > IMAGE_RULES.maxSide) throw new Error('the picture is too large');
      const id = hex(12);
      await env.IMAGES.put(`lawyer/${id}`, bytes, { httpMetadata: { contentType: MIME[info.format] } });
      made.push({ lawyer: p.slug, id, from: p.photo });
    } catch (err) {
      failed.push({ lawyer: p.slug, name: p.name, why: String((err && err.message) || err).slice(0, 140) });
    }
  };
  let next = 0;
  await Promise.all([0, 1, 2].map(async () => { while (next < batch.length) await one(batch[next++]); }));

  // write the decisions: read what is decided now, add ours only for lawyers nobody has decided on in the meantime, one statement
  let accepted = 0;
  const removeCopies = async (list) => { if (env.IMAGES) for (const m of list) await env.IMAGES.delete(`lawyer/${m.id}`).catch(() => {}); };
  if (made.length) {
    const fresh = await env.DB.prepare("SELECT data FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first();
    const freshFirm = fresh && parse(fresh.data);
    const photos = { ...objectOf(freshFirm && freshFirm.lawyerPhotos) };
    const at = new Date().toISOString().slice(0, 10);
    const lost = [];
    for (const m of made) {
      if (photos[m.lawyer]) { lost.push(m); continue; }
      photos[m.lawyer] = { status: 'ok', photo: `/img/lawyer/${m.id}`, from: m.from.slice(0, 300), at, bulk: true };
      accepted++;
    }
    try {
      if (accepted) await env.DB.prepare("UPDATE firms SET data = json_set(data, '$.lawyerPhotos', json(?)), updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(photos), slug).run();
    } catch (err) {
      await removeCopies(made);
      throw err;
    }
    await removeCopies(lost);
    if (accepted) await audit(env, admin, 'lawyer_photo.accept_all', 'firm', slug, { accepted, failed: failed.length, lawyers: made.filter((m) => !lost.includes(m)).map((m) => m.lawyer).slice(0, 100) });
  }
  return { accepted, failed, more: todo.length - batch.length, left: pending.length - accepted };
}
