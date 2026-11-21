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

// Firms whose lawyers a page shows, with what is still to be decided. The firms with the strongest lawyer profiles come first (they are the ones the
// homepage and the search show), then the rest by name; `after` is the cursor the previous answer gave.
export async function photoQueue(env, after = '', limit = 5) {
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
  const page = todo.filter((f) => f.cursor > after).slice(0, limit);
  return {
    firms: page.map(({ cursor, people, ...f }) => ({ ...f, lawyers: people.map(({ photo, ...p }) => p) })),
    next: page.length ? page[page.length - 1].cursor : after,
    left, accepted, erased, firmsLeft: todo.length,
  };
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
