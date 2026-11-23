// A firm's own control over its lawyers: confirm what was read from its website, correct it, hide a lawyer (or all of them), add a lawyer the website
// did not show, remove one, and add a lawyer's picture. Shared by the owner dashboard (an approved owner of the firm) and the admin area (any firm).
//
//  - The list lives in the firm record as `lawyers` (src/lib/lawyers.js has the rules). The first change by a firm sets `lawyersLocked`, so the bulk update
//    (db/lawyers-updates.sql) never overwrites it again; `lawyersOff` hides the whole list.
//  - What a firm types is its own statement (confirmed: true): it is shown as written under plain-text rules (no markup, links, figures or the advertising
//    claims law societies restrict). A lawyer keeps the page address they already had when the name is corrected, so an indexed address never breaks.
//  - Pictures are the firm's to confirm: one is shown only after the firm uploads it or says "use this one" for the picture found on its own website
//    (the file is then copied into our own storage, so it cannot break or change). Adding a picture is part of customizing the page, a Featured benefit,
//    like the firm's own pictures (LAWYER_PHOTOS_FEATURED); an admin is never limited.
//  - The admin's Lawyer photos tab (src/lib/lawyer-photos.js) can accept or erase the same found pictures, and keeps its decisions in `lawyerPhotos`. Both ways
//    meet in photoStateOf (src/lib/lawyers.js): the firm's own picture is shown first, then one the admin accepted; a firm that removes a picture the admin
//    accepted erases it; a firm that adds its own replaces the admin's. This file writes only the keys it owns (json_set), never the whole record, so it cannot
//    overwrite an admin's decision made at the same moment.
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { checkOwnerText } from './content-rules.js';
import { cleanLanguages, LANGUAGES } from './details.js';
import { FEATURED_LOCK } from './firm-edit.js';
import { imageInfo, IMAGE_RULES, imageCacheKey } from './images.js';
import { cleanLawyers, photoStateOf, HOSTED_PHOTO, cleanName, cleanLinkedIn, cleanPhone, lawyerSlug, lawyerHasPage, OWNER_TITLE, OWNER_EDUCATION, OWNER_ACHIEVEMENT, MAX_ACHIEVEMENTS, MAX_LAWYERS, MIN_FIRM_LAWYERS, MIN_PAGE_FACTS } from './lawyers.js';

export const LAWYER_PHOTOS_FEATURED = true;
export const LAWYER_PHOTO_RULES = { minSide: 120, minRatio: 0.5, maxRatio: 1.6, maxBytes: IMAGE_RULES.maxBytes, perUserPerHour: 20, fetchMs: 8000 };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FACTS = ['name', 'title', 'callYear', 'education', 'languages', 'linkedin', 'site', 'achievements', 'phone'];
// Two facts only a Featured firm may add (an admin is never limited): the awards and achievements listed for a lawyer, and the lawyer's direct phone number. Clearing them is always allowed.
export const LAWYER_PAID_FACTS = { achievements: 'Listing awards and achievements', phone: "Adding a lawyer's direct phone number" };
const FIELDS = [...FACTS, 'hidden', 'confirmed'];

// ---------------------------------------------------------------- what a firm may send
const text = (v, label, max) => {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') throw new HttpError(422, `${label}: expected text`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) throw new HttpError(422, `${label}: at most ${max} characters`);
  return s;
};

export function cleanLawyerInput(body, { admin = false, website = '' } = {}) {
  const out = {};
  if ('name' in body) {
    const n = cleanName(text(body.name, 'Name', 90));
    if (!n) throw new HttpError(422, "Name: use the lawyer's name as the law society lists it, for example Pat Q. Smith (letters only, no titles, numbers or e-mail addresses).");
    out.name = n;
  }
  if ('title' in body) {
    const t = text(body.title, 'Title', 70);
    if (t && !OWNER_TITLE.test(t)) throw new HttpError(422, 'Title: letters and ordinary punctuation only, for example Partner or Senior Associate (no numbers, fees or links).');
    if (t && !admin) checkOwnerText('Title', t);
    out.title = t;
  }
  if ('callYear' in body) {
    const raw = body.callYear;
    if (raw === null || raw === '' || raw === undefined) out.callYear = null;
    else {
      const y = Number(raw);
      if (!Number.isInteger(y) || y < 1950 || y > new Date().getFullYear()) throw new HttpError(422, `Year called to the bar: a year from 1950 to ${new Date().getFullYear()}`);
      out.callYear = y;
    }
  }
  if ('education' in body) {
    if (!Array.isArray(body.education) || body.education.length > 3) throw new HttpError(422, 'Education: up to 3 lines');
    out.education = body.education.map((e) => text(e, 'Education', 120)).filter(Boolean).map((e) => {
      if (!OWNER_EDUCATION.test(e)) throw new HttpError(422, 'Education: letters, numbers and ordinary punctuation only, for example "J.D., University of Calgary" (no links).');
      if (!admin) checkOwnerText('Education', e);
      return e;
    });
    out.education = out.education.filter((e, i, all) => all.indexOf(e) === i);
  }
  if ('languages' in body) out.languages = cleanLanguages(body.languages);
  if ('achievements' in body) {
    if (!Array.isArray(body.achievements) || body.achievements.length > MAX_ACHIEVEMENTS) throw new HttpError(422, `Awards and achievements: up to ${MAX_ACHIEVEMENTS} lines`);
    out.achievements = body.achievements.map((a) => text(a, 'Awards and achievements', 140)).filter(Boolean).map((a) => {
      if (!OWNER_ACHIEVEMENT.test(a)) throw new HttpError(422, 'Awards and achievements: letters, numbers and ordinary punctuation only, for example "Lexpert Rising Star, 2023" (no links).');
      if (!admin) checkOwnerText('Awards and achievements', a);
      return a;
    }).filter((a, i, all) => all.indexOf(a) === i);
  }
  if ('phone' in body) {
    const raw = text(body.phone, 'Phone', 30);
    const ph = raw ? cleanPhone(raw) : '';
    if (raw && !ph) throw new HttpError(422, 'Phone: a Canadian or US number with its area code, for example (403) 555-0100.');
    out.phone = ph;
  }
  if ('linkedin' in body) {
    const raw = text(body.linkedin, 'LinkedIn', 300);
    const li = raw ? cleanLinkedIn(raw) : '';
    if (raw && !li) throw new HttpError(422, "LinkedIn: paste the address of the lawyer's own profile, for example https://www.linkedin.com/in/pat-smith");
    out.linkedin = li;
  }
  if ('site' in body) {
    const raw = text(body.site, 'Page on your website', 300);
    if (raw) {
      let host = '';
      try { const u = new URL(raw); host = u.hostname.toLowerCase().replace(/^www\./, ''); if (u.protocol !== 'https:' || u.username || u.password) host = ''; } catch { host = ''; }
      if (!host || !/^https:\/\/[^\s"'<>]+$/.test(raw)) throw new HttpError(422, "Page on your website: the address of the lawyer's page, starting with https://");
      let own = '';
      try { own = new URL(website).hostname.toLowerCase().replace(/^www\./, ''); } catch { own = ''; }
      if (own && host !== own && !host.endsWith('.' + own)) throw new HttpError(422, `Page on your website: this must be a page on ${own}.`);
    }
    out.site = raw;
  }
  for (const k of ['hidden', 'confirmed']) {
    if (k in body) { if (typeof body[k] !== 'boolean') throw new HttpError(422, `${k} must be true or false`); out[k] = body[k]; }
  }
  return out;
}

// Awards and a direct phone number are Featured benefits: a firm that is not Featured may clear them but not set them.
function requireFeatured(input, firm, admin) {
  if (admin || firm.featured) return;
  for (const [k, what] of Object.entries(LAWYER_PAID_FACTS)) if (input[k] && input[k].length) throw new HttpError(403, `${what} ${FEATURED_LOCK}`);
}

// ---------------------------------------------------------------- reading and writing the list
async function load(env, slug) {
  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return JSON.parse(row.data);
}
const listOf = (firm) => cleanLawyers(firm.lawyers, undefined, null, { stored: true });
const decisionsOf = (firm) => (firm.lawyerPhotos && typeof firm.lawyerPhotos === 'object' && !Array.isArray(firm.lawyerPhotos) ? firm.lawyerPhotos : {});

// Writes only the keys this file owns, so a decision the admin makes at the same moment (`lawyerPhotos`) or another edit of the firm is never overwritten.
// The first change by a firm sets lawyersLocked: the bulk update leaves a list the firm has touched alone.
//   lawyers: the whole list; lawyersOff: true / false; lawyerPhotos: the whole decisions object (an empty one removes the key).
async function store(env, slug, { lawyers, lawyersOff, lawyerPhotos } = {}) {
  const sets = ["'$.lawyersLocked', json('true')"];
  const binds = [];
  const removes = [];
  if (lawyers) { sets.push("'$.lawyers', json(?)"); binds.push(JSON.stringify(lawyers)); }
  if (lawyersOff === true) sets.push("'$.lawyersOff', json('true')"); else if (lawyersOff === false) removes.push("'$.lawyersOff'");
  if (lawyerPhotos && Object.keys(lawyerPhotos).length) { sets.push("'$.lawyerPhotos', json(?)"); binds.push(JSON.stringify(lawyerPhotos)); } else if (lawyerPhotos) removes.push("'$.lawyerPhotos'");
  let expr = `json_set(data, ${sets.join(', ')})`;
  if (removes.length) expr = `json_remove(${expr}, ${removes.join(', ')})`;
  await env.DB.prepare(`UPDATE firms SET data = ${expr}, updated_at = datetime('now') WHERE slug = ?`).bind(...binds, slug).run();
  return lawyersView(await load(env, slug));
}

// What the editor shows: every lawyer, hidden ones too, with where each stands.
export function lawyersView(firm) {
  const list = listOf(firm);
  const decided = decisionsOf(firm);
  const shown = list.filter((l) => !l.hidden);
  const pageExists = shown.length >= MIN_FIRM_LAWYERS && !firm.lawyersOff;
  return {
    lawyers: list.map((l) => {
      const p = photoStateOf(l, decided[l.slug]);
      return {
        slug: l.slug, name: l.name, title: l.title || '', callYear: l.callYear || null, education: l.education || [], languages: l.languages || [], linkedin: l.linkedin || '', site: l.site || '', achievements: l.achievements || [], phone: l.phone || '',
        hidden: !!l.hidden, confirmed: !!l.confirmed,
        hasPage: pageExists && !l.hidden && lawyerHasPage(l),
        photo: p.state === 'none' ? { state: 'none' } : { state: p.state, url: p.url },
      };
    }),
    lawyersOff: !!firm.lawyersOff,
    locked: !!firm.lawyersLocked,
    shown: shown.length,
    pageExists,
    limits: { max: MAX_LAWYERS, minForPage: MIN_FIRM_LAWYERS, minFacts: MIN_PAGE_FACTS },
    languages: LANGUAGES,
  };
}

export async function getLawyers(env, slug) {
  return lawyersView(await load(env, slug));
}

function apply(next, input) {
  const changes = {};
  for (const [k, v] of Object.entries(input)) {
    const empty = v === '' || v === null || (Array.isArray(v) && !v.length);
    const before = next[k];
    if (JSON.stringify(before ?? null) === JSON.stringify(empty ? null : v)) continue;
    changes[k] = { from: before ?? null, to: empty ? null : v };
    if (k === 'hidden' || k === 'confirmed') { if (v) next[k] = true; else delete next[k]; } else if (empty) delete next[k]; else next[k] = v;
  }
  return changes;
}

export async function saveLawyer(env, actor, slug, lawyerSlugParam, body, { admin }) {
  const keys = Object.keys(body || {});
  if (!keys.length) throw new HttpError(422, 'Nothing to update');
  const unknown = keys.filter((k) => !FIELDS.includes(k));
  if (unknown.length) throw new HttpError(422, `Cannot edit: ${unknown.join(', ')}`);
  const firm = await load(env, slug);
  const list = listOf(firm);
  const i = list.findIndex((l) => l.slug === lawyerSlugParam);
  if (i < 0) throw new HttpError(404, 'Lawyer not found');
  const input = cleanLawyerInput(body, { admin, website: firm.website });
  requireFeatured(input, firm, admin);
  if ('confirmed' in input && !input.confirmed && !admin) delete input.confirmed; // only an admin takes a confirmation back
  const next = { ...list[i] };
  const changes = apply(next, input);
  if (!Object.keys(changes).length) return lawyersView(firm);
  // Saying what a fact is, or that the details are right, is the firm's confirmation.
  if (FACTS.some((k) => k in changes) || input.confirmed === true) next.confirmed = true;
  next.slug = list[i].slug; // the page address never changes when a name is corrected
  const clean = cleanLawyers([next], undefined, null, { stored: true })[0];
  if (!clean) throw new HttpError(422, 'That leaves nothing to show for this lawyer.');
  list[i] = clean;
  const view = await store(env, slug, { lawyers: list });
  await audit(env, actor, 'firm.lawyer', 'firm', slug, { lawyer: lawyerSlugParam, changes });
  return view;
}

export async function addLawyer(env, actor, slug, body, { admin }) {
  const unknown = Object.keys(body || {}).filter((k) => !FACTS.includes(k));
  if (unknown.length) throw new HttpError(422, `Cannot add with: ${unknown.join(', ')}`);
  if (!body || !('name' in body)) throw new HttpError(422, 'Name is required');
  const firm = await load(env, slug);
  const list = listOf(firm);
  if (list.length >= MAX_LAWYERS) throw new HttpError(409, `A firm can list up to ${MAX_LAWYERS} lawyers.`);
  const input = cleanLawyerInput(body, { admin, website: firm.website });
  requireFeatured(input, firm, admin);
  const base = lawyerSlug(input.name) || 'lawyer';
  let s = base;
  for (let n = 2; list.some((l) => l.slug === s); n++) s = `${base}-${n}`;
  const next = { slug: s };
  apply(next, input);
  next.confirmed = true;
  const clean = cleanLawyers([next], undefined, null, { stored: true })[0];
  if (!clean) throw new HttpError(422, 'That lawyer cannot be listed. Check the name.');
  list.push(clean);
  const view = await store(env, slug, { lawyers: list });
  await audit(env, actor, 'firm.lawyer.add', 'firm', slug, { lawyer: clean.slug, name: clean.name });
  return view;
}

export async function removeLawyer(env, actor, slug, lawyerSlugParam) {
  const firm = await load(env, slug);
  const list = listOf(firm);
  const i = list.findIndex((l) => l.slug === lawyerSlugParam);
  if (i < 0) throw new HttpError(404, 'Lawyer not found');
  const [gone] = list.splice(i, 1);
  const decided = { ...decisionsOf(firm) };
  if (decided[gone.slug]) await dropHostedPhoto(env, decided[gone.slug].photo);
  delete decided[gone.slug];
  await dropOwnPhoto(env, gone.photoConfirmed ? gone.photo : '');
  const view = await store(env, slug, { lawyers: list, lawyerPhotos: decided });
  await audit(env, actor, 'firm.lawyer.remove', 'firm', slug, { lawyer: gone.slug, name: gone.name });
  return view;
}

// Show or hide the whole Lawyers part of the profile.
export async function setLawyersOff(env, actor, slug, off) {
  if (typeof off !== 'boolean') throw new HttpError(422, 'lawyersOff must be true or false');
  const firm = await load(env, slug);
  if (!!firm.lawyersOff === off) return lawyersView(firm);
  const view = await store(env, slug, { lawyersOff: off });
  await audit(env, actor, 'firm.lawyers.switch', 'firm', slug, { lawyersOff: off });
  return view;
}

// ---------------------------------------------------------------- pictures
const ownId = (photo) => { const m = /^\/?img\/([0-9a-f]{24})$/.exec(photo || ''); return m ? m[1] : ''; };
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
const today = () => new Date().toISOString().slice(0, 10);

// the firm's own picture: the file and its record
async function dropOwnPhoto(env, photo) {
  const id = ownId(photo);
  if (!id) return;
  await env.DB.prepare('DELETE FROM lawyer_photos WHERE id = ?').bind(id).run();
  if (env.IMAGES) await env.IMAGES.delete(`img/${id}`).catch((err) => console.error('lawyer picture delete failed', id, err));
  await caches.default.delete(imageCacheKey(id)).catch(() => {});
}
// a picture the admin accepted (kept at lawyer/<id>, src/lib/lawyer-photos.js)
async function dropHostedPhoto(env, photo) {
  if (!HOSTED_PHOTO.test(photo || '')) return;
  const id = photo.split('/').pop();
  if (env.IMAGES) await env.IMAGES.delete(`lawyer/${id}`).catch((err) => console.error('lawyer picture delete failed', id, err));
  await caches.default.delete(imageCacheKey(id)).catch(() => {});
}

// The picture found on the firm's own website, read once, only when the firm says to use it.
async function fetchFound(url) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url)) throw new HttpError(422, 'There is no picture found on your website for this lawyer. Please upload one.');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LAWYER_PHOTO_RULES.fetchMs);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)', accept: 'image/jpeg,image/png,image/webp' } });
    if (!res.ok || (res.url && !res.url.startsWith('https://'))) throw new Error(`status ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    if (declared && declared > LAWYER_PHOTO_RULES.maxBytes) throw new HttpError(413, 'The picture on your website is over 3 MB. Please upload a smaller one.');
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LAWYER_PHOTO_RULES.maxBytes) { await reader.cancel().catch(() => {}); throw new HttpError(413, 'The picture on your website is over 3 MB. Please upload a smaller one.'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { body.set(c, o); o += c.length; }
    return body;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'We could not fetch the picture from your website. Please upload it instead.');
  } finally { clearTimeout(timer); }
}

export async function setLawyerPhoto(env, actor, slug, lawyerSlugParam, { request, fromFound }, { admin }) {
  if (!env.IMAGES) throw new HttpError(503, 'Picture storage is not available right now.');
  const firm = await load(env, slug);
  if (LAWYER_PHOTOS_FEATURED && !admin && !firm.featured) throw new HttpError(403, `Adding lawyer pictures ${FEATURED_LOCK}`);
  const list = listOf(firm);
  const i = list.findIndex((l) => l.slug === lawyerSlugParam);
  if (i < 0) throw new HttpError(404, 'Lawyer not found');
  const cur = list[i];
  const decided = { ...decisionsOf(firm) };
  const decision = decided[cur.slug];

  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM lawyer_photos WHERE uploaded_by = ? AND created_at > datetime('now','-1 hour')").bind(actor?.id ?? null).first();
  if (recent.n >= (admin ? 300 : LAWYER_PHOTO_RULES.perUserPerHour)) throw new HttpError(429, 'Too many uploads this hour. Please try again later.');

  let body;
  if (fromFound) {
    // a picture the admin erased is not offered again; one the firm has not decided on is
    const candidate = decision && decision.status === 'no' ? '' : cur.photoConfirmed ? cur.photoFound : cur.photo || cur.photoFound;
    body = await fetchFound(candidate || '');
  } else {
    const declared = Number(request.headers.get('content-length'));
    if (declared && declared > LAWYER_PHOTO_RULES.maxBytes + 1024) throw new HttpError(413, `Pictures can be up to ${LAWYER_PHOTO_RULES.maxBytes / 1024 / 1024} MB.`);
    body = new Uint8Array(await request.arrayBuffer());
    if (!body.length) throw new HttpError(422, 'No picture was sent.');
    if (body.length > LAWYER_PHOTO_RULES.maxBytes) throw new HttpError(413, `Pictures can be up to ${LAWYER_PHOTO_RULES.maxBytes / 1024 / 1024} MB.`);
  }
  const info = imageInfo(body);
  if (!info) throw new HttpError(415, 'Please use a JPEG, PNG or WebP picture.');
  const { width, height } = info;
  if (Math.min(width, height) < LAWYER_PHOTO_RULES.minSide) throw new HttpError(422, `The picture is too small. Each side must be at least ${LAWYER_PHOTO_RULES.minSide} pixels.`);
  if (width > IMAGE_RULES.maxSide || height > IMAGE_RULES.maxSide) throw new HttpError(422, `The picture is too large. Each side can be at most ${IMAGE_RULES.maxSide} pixels.`);
  const ratio = width / height;
  if (ratio < LAWYER_PHOTO_RULES.minRatio || ratio > LAWYER_PHOTO_RULES.maxRatio) throw new HttpError(422, 'Please use a head-and-shoulders photo of one person, roughly square or portrait (not a wide banner).');

  const id = hex(12);
  const contentType = MIME[info.format];
  await env.IMAGES.put(`img/${id}`, body, { httpMetadata: { contentType } });
  try {
    await env.DB.prepare('INSERT INTO lawyer_photos (id, firm_slug, lawyer_slug, content_type, bytes, width, height, uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, slug, cur.slug, contentType, body.length, width, height, actor?.id ?? null).run();
  } catch (err) {
    await env.IMAGES.delete(`img/${id}`).catch(() => {});
    throw err;
  }
  const next = { ...cur };
  // the address found on the firm's website is kept, so removing the firm's own picture can bring it back for another try
  const found = cur.photoConfirmed ? cur.photoFound : cur.photo || cur.photoFound;
  await dropOwnPhoto(env, cur.photoConfirmed ? cur.photo : '');
  // the firm's own picture replaces one the admin accepted (its copy is removed and the decision with it)
  let photos;
  if (decision && decision.status === 'ok') { await dropHostedPhoto(env, decision.photo); delete decided[cur.slug]; photos = decided; }
  if (found) next.photoFound = found; else delete next.photoFound;
  next.photo = `img/${id}`;
  next.photoConfirmed = true;
  list[i] = cleanLawyers([next], undefined, null, { stored: true })[0] || cur;
  const view = await store(env, slug, { lawyers: list, ...(photos ? { lawyerPhotos: photos } : {}) });
  await audit(env, actor, 'firm.lawyer.photo', 'firm', slug, { lawyer: cur.slug, id, bytes: body.length, width, height, fromFound: !!fromFound });
  return view;
}

export async function removeLawyerPhoto(env, actor, slug, lawyerSlugParam) {
  const firm = await load(env, slug);
  const list = listOf(firm);
  const i = list.findIndex((l) => l.slug === lawyerSlugParam);
  if (i < 0) throw new HttpError(404, 'Lawyer not found');
  const cur = list[i];
  const decided = { ...decisionsOf(firm) };
  const state = photoStateOf(cur, decided[cur.slug]);
  if (state.state === 'none') return lawyersView(firm);
  const next = { ...cur };
  let photos;
  if (state.by === 'admin') {
    // a picture the admin accepted: the firm says no, so it is erased the way the admin's cross erases it
    const d = decided[cur.slug];
    await dropHostedPhoto(env, d.photo);
    decided[cur.slug] = { status: 'no', from: String(d.from || '').slice(0, 300), at: today() };
    photos = decided;
  } else if (state.by === 'firm') {
    await dropOwnPhoto(env, cur.photo);
    // the firm's own picture goes and the one found on its website comes back as "found" (shown nowhere)
    if (cur.photoFound) { next.photo = cur.photoFound; next.photoConfirmed = false; delete next.photoFound; } else { delete next.photo; delete next.photoConfirmed; }
  } else {
    // a picture found on the firm's website that the firm does not want, or an older confirmed address: it goes for good
    delete next.photo; delete next.photoConfirmed; delete next.photoFound;
  }
  list[i] = cleanLawyers([next], undefined, null, { stored: true })[0] || cur;
  const view = await store(env, slug, { lawyers: list, ...(photos ? { lawyerPhotos: photos } : {}) });
  await audit(env, actor, 'firm.lawyer.photo.remove', 'firm', slug, { lawyer: cur.slug });
  return view;
}
