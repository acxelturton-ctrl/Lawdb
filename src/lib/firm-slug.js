// Changing a firm's page address (its slug): lawdb.ca/firms/<slug>. Admin only.
//
// The slug is the firm's key in many tables, so a change has to move every one of them in one step, and the old address must keep working:
// it becomes a permanent redirect (firm_redirects), for the page and for the firm's story pages, so no link or search result breaks.
// Everything happens in one batch (all or nothing); foreign keys are checked at the end of it, so the tables can be moved in any order.
import { HttpError } from './http.js';
import { audit } from './audit.js';

export const SLUG_MIN = 3, SLUG_MAX = 80;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Every table that stores a firm's slug in a column called firm_slug. scripts/test-firm-slug.mjs reads the migrations and fails if a table with such a
// column is missing here, so a table added later cannot be forgotten.
export const SLUG_TABLES = ['firm_members', 'firm_images', 'firm_feeds', 'firm_posts', 'firm_subscriptions', 'follows', 'firm_ratings', 'firm_invites',
  'firm_stats_daily', 'firm_trials', 'firm_verifications', 'leads', 'outreach'];

export function cleanSlug(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s.length < SLUG_MIN || s.length > SLUG_MAX || !SLUG_RE.test(s)) {
    throw new HttpError(422, `The address can have lowercase letters, digits and single dashes, ${SLUG_MIN} to ${SLUG_MAX} characters (for example preszler-injury-lawyers-toronto).`);
  }
  return s;
}

// Where an old address now lives (only when that firm is still listed), or null.
export async function redirectTarget(env, oldSlug) {
  const r = await env.DB.prepare('SELECT r.new_slug AS slug FROM firm_redirects r JOIN firms f ON f.slug = r.new_slug WHERE r.old_slug = ?').bind(oldSlug).first();
  return r ? r.slug : null;
}

export async function renameFirmSlug(env, admin, oldSlug, rawNew) {
  const next = cleanSlug(rawNew);
  if (next === oldSlug) throw new HttpError(422, 'That is already the firm\'s address.');
  const firm = await env.DB.prepare('SELECT slug, name FROM firms WHERE slug = ?').bind(oldSlug).first();
  if (!firm) throw new HttpError(404, 'Firm not found');
  if (await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ?').bind(next).first()) throw new HttpError(409, 'Another firm already has that address.');
  const formerly = await env.DB.prepare('SELECT new_slug FROM firm_redirects WHERE old_slug = ?').bind(next).first();
  if (formerly && formerly.new_slug !== oldSlug) throw new HttpError(409, 'That address used to belong to another firm, whose old links still point to it.');

  const move = SLUG_TABLES.map((t) => env.DB.prepare(`UPDATE ${t} SET firm_slug = ? WHERE firm_slug = ?`).bind(next, oldSlug));
  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...move,
    env.DB.prepare("UPDATE firms SET slug = ?, data = json_set(data, '$.slug', ?), updated_at = datetime('now') WHERE slug = ?").bind(next, next, oldSlug),
    env.DB.prepare('UPDATE firm_locations SET location_slug = ? WHERE location_slug = ?').bind(next, oldSlug),   // office-page links (not firm_slug columns, so not in SLUG_TABLES)
    env.DB.prepare('UPDATE firm_locations SET main_slug = ? WHERE main_slug = ?').bind(next, oldSlug),
    env.DB.prepare('DELETE FROM firm_redirects WHERE old_slug = ?').bind(next),                            // an address taken back is live again, not a redirect
    env.DB.prepare('UPDATE firm_redirects SET new_slug = ? WHERE new_slug = ?').bind(next, oldSlug),       // earlier old addresses follow the firm to the new one (no chains)
    env.DB.prepare('INSERT INTO firm_redirects (old_slug, new_slug, created_by) VALUES (?, ?, ?)').bind(oldSlug, next, admin?.id ?? null),
  ]);
  await audit(env, admin, 'firm.rename_slug', 'firm', next, { from: oldSlug, to: next, name: firm.name });
  return { slug: next, oldSlug };
}
