// A firm with several offices: one page per office, one Featured plan for all of them.
//
// Each office is an ordinary listing (its own address, phone, website and page, in its own city's list and on the map). What ties them together is a row in
// firm_locations: the MAIN listing holds the plan, the LOCATIONS follow it. Whenever the main listing's Featured flag changes (a payment, the free month starting
// or ending, a cancellation, the admin) syncLocationFeatured copies it to every location, so all the Featured benefits (badge, placement, pictures, booking link,
// enquiries dashboard, analytics) apply to every office page with no second payment. A location never has a plan of its own: its plan card says so, a payment
// made from it is credited to the main listing, and its Featured flag cannot be set by hand.
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { cleanSlug } from './firm-slug.js';

export const MAX_LOCATIONS = 5; // extra office pages one firm may have (the admin can link more by hand)

export async function mainOf(env, slug) {
  const r = await env.DB.prepare('SELECT l.main_slug AS slug, f.name, f.city, f.province FROM firm_locations l JOIN firms f ON f.slug = l.main_slug WHERE l.location_slug = ?').bind(slug).first();
  return r || null;
}

export async function locationsOf(env, mainSlug) {
  return (await env.DB.prepare(
    `SELECT f.slug, f.name, f.city, f.province, f.status, f.featured FROM firm_locations l JOIN firms f ON f.slug = l.location_slug
     WHERE l.main_slug = ? ORDER BY f.province, f.city, f.name`
  ).bind(mainSlug).all()).results.map((r) => ({ ...r, featured: !!r.featured }));
}

// The other LIVE pages of the same firm (the main and the other locations), for the links on each page.
export async function siblingsOf(env, slug) {
  const main = await mainOf(env, slug);
  const root = main ? main.slug : slug;
  return (await env.DB.prepare(
    `SELECT slug, name, city, province FROM firms
     WHERE status = 'live' AND slug != ? AND (slug = ? OR slug IN (SELECT location_slug FROM firm_locations WHERE main_slug = ?))
     ORDER BY (slug = ?) DESC, province, city, name`
  ).bind(slug, root, root, root).all()).results;
}

async function writeFeatured(env, slug, value, actor, why) {
  const row = await env.DB.prepare('SELECT data FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) return false;
  const firm = JSON.parse(row.data);
  if (!!firm.featured === value) return false;
  firm.featured = value;
  await env.DB.prepare("UPDATE firms SET data = ?, featured = ?, updated_at = datetime('now') WHERE slug = ?").bind(JSON.stringify(firm), value ? 1 : 0, slug).run();
  await audit(env, actor, 'firm.featured', 'firm', slug, { featured: value, why });
  return true;
}

// Copies the main listing's Featured flag to all of its locations. Does nothing for a firm with no locations.
export async function syncLocationFeatured(env, mainSlug, actor, why) {
  const main = await env.DB.prepare('SELECT featured FROM firms WHERE slug = ?').bind(mainSlug).first();
  if (!main) return 0;
  const { results } = await env.DB.prepare('SELECT location_slug AS slug FROM firm_locations WHERE main_slug = ?').bind(mainSlug).all();
  let n = 0;
  for (const r of results) if (await writeFeatured(env, r.slug, !!main.featured, actor, `follows ${mainSlug}${why ? ': ' + why : ''}`)) n++;
  return n;
}

// Admin: make an existing listing an office page of another firm.
export async function linkLocation(env, admin, locationSlug, rawMain) {
  const mainSlug = cleanSlug(rawMain);
  if (mainSlug === locationSlug) throw new HttpError(422, 'A listing cannot be an office of itself. Enter the address of the firm\'s main listing.');
  const [loc, main] = await Promise.all([
    env.DB.prepare('SELECT slug, name FROM firms WHERE slug = ?').bind(locationSlug).first(),
    env.DB.prepare('SELECT slug, name FROM firms WHERE slug = ?').bind(mainSlug).first(),
  ]);
  if (!loc) throw new HttpError(404, 'Firm not found');
  if (!main) throw new HttpError(404, `There is no listing at /firms/${mainSlug}. Enter the address of the firm's main listing.`);
  const current = await mainOf(env, locationSlug);
  if (current) {
    if (current.slug === mainSlug) return { slug: locationSlug, main: mainSlug, unchanged: true };
    throw new HttpError(409, `This listing is already an office of ${current.name}. Unlink it first.`);
  }
  const outer = await mainOf(env, mainSlug);
  if (outer) throw new HttpError(409, `${main.name} is itself an office of ${outer.name}. Use that firm's main listing.`);
  if ((await locationsOf(env, locationSlug)).length) throw new HttpError(409, 'This listing has office pages of its own. Unlink them first.');
  if (await env.DB.prepare("SELECT 1 FROM firm_subscriptions WHERE firm_slug = ? AND status IN ('active', 'past_due')").bind(locationSlug).first()) {
    throw new HttpError(409, 'This listing has its own paid Featured plan. Cancel or move that payment first, so the firm does not pay twice.');
  }
  if (await env.DB.prepare("SELECT 1 FROM firm_trials WHERE firm_slug = ? AND status = 'active'").bind(locationSlug).first()) {
    throw new HttpError(409, 'This listing is in its own free month. End that first, so it does not switch Featured off by itself later.');
  }
  await env.DB.prepare('INSERT INTO firm_locations (location_slug, main_slug, created_by) VALUES (?, ?, ?)').bind(locationSlug, mainSlug, admin?.id ?? null).run();
  await syncLocationFeatured(env, mainSlug, admin, 'linked');
  await audit(env, admin, 'firm.location_link', 'firm', locationSlug, { main: mainSlug, name: loc.name });
  return { slug: locationSlug, main: mainSlug };
}

// Admin: the office becomes an ordinary listing again, Featured only if it pays for itself.
export async function unlinkLocation(env, admin, locationSlug) {
  const current = await mainOf(env, locationSlug);
  if (!current) throw new HttpError(404, 'This listing is not an office of another firm.');
  await env.DB.prepare('DELETE FROM firm_locations WHERE location_slug = ?').bind(locationSlug).run();
  const own = await env.DB.prepare("SELECT 1 FROM firm_subscriptions WHERE firm_slug = ? AND status IN ('active', 'past_due')").bind(locationSlug).first();
  await writeFeatured(env, locationSlug, !!own, admin, `unlinked from ${current.slug}`);
  await audit(env, admin, 'firm.location_unlink', 'firm', locationSlug, { main: current.slug });
  return { slug: locationSlug };
}
