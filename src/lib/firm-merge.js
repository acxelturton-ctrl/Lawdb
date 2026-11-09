// Merging a duplicate listing into the one to keep. Admin only.
//
// A firm that lists itself while LawDB already has a page for it ends up with two listings. Merging removes the duplicate ("from") and keeps the
// other ("into"): the people who managed the duplicate now manage the kept one, their leads, followers, ratings, blog feed and counters move
// across, the duplicate disappears, and its address becomes a permanent redirect to the kept page (firm_redirects, the same table a page-address
// change uses), so no link or search result breaks.
//
// Everything happens in one batch (all or nothing). What cannot move safely stops the merge before anything is touched:
//  - an active or past-due Featured subscription on the duplicate (the admin deals with the payment first);
//  - pictures on the duplicate (their files would be left behind in storage; delete them from the editor first).
// What stays with the kept listing and is NOT carried over from the duplicate: its profile text, its plan, its free-month trial and its LawDB
// verification (verifying is a check of the firm's registration, so it is done again for the kept listing if needed).
import { HttpError } from './http.js';
import { audit } from './audit.js';
import { cleanSlug } from './firm-slug.js';

// Where every table that has a firm_slug column goes in a merge. scripts/test-firm-merge.mjs reads the migrations and fails if a table with such a
// column is in neither list, so a table added later cannot be forgotten.
export const MERGE_MOVED = ['firm_members', 'firm_feeds', 'firm_posts', 'firm_subscriptions', 'follows', 'firm_ratings', 'firm_invites', 'firm_stats_daily', 'leads', 'outreach'];
export const MERGE_DROPPED = ['firm_images', 'firm_trials', 'firm_verifications'];

export async function mergeFirms(env, admin, fromSlug, rawInto) {
  const into = cleanSlug(rawInto);
  if (into === fromSlug) throw new HttpError(422, 'A listing cannot be merged into itself. Enter the address of the listing to keep.');
  const [from, keep] = await Promise.all([
    env.DB.prepare('SELECT slug, name FROM firms WHERE slug = ?').bind(fromSlug).first(),
    env.DB.prepare('SELECT slug, name, status FROM firms WHERE slug = ?').bind(into).first(),
  ]);
  if (!from) throw new HttpError(404, 'Firm not found');
  if (!keep) throw new HttpError(404, `There is no listing at /firms/${into}. Enter the address of the listing to keep.`);

  if (await env.DB.prepare('SELECT 1 FROM firm_locations WHERE main_slug = ?').bind(fromSlug).first()) throw new HttpError(409, 'This listing has office pages of its own. Unlink them first, then merge.');
  const [subs, pics] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM firm_subscriptions WHERE firm_slug = ? AND status IN ('active', 'past_due')").bind(fromSlug).first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM firm_images WHERE firm_slug = ?').bind(fromSlug).first(),
  ]);
  if (subs.n) throw new HttpError(409, 'This listing has a paid Featured subscription. Move or cancel the payment first, then merge.');
  if (pics.n) throw new HttpError(409, `This listing has ${pics.n} picture${pics.n === 1 ? '' : 's'}. Delete them from its editor first, then merge (so no file is left behind).`);

  // People who will manage the kept listing afterwards (for the email), read before anything moves.
  const owners = (await env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(fromSlug).all()).results.map((r) => r.email);

  const db = env.DB;
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = on'),
    // People: someone who already has a request on the kept listing gets it approved; everyone else's approved or pending request moves over.
    db.prepare(`UPDATE firm_members SET status = 'approved', decided_at = datetime('now'), decided_by = ?
                WHERE firm_slug = ? AND status != 'approved' AND user_id IN (SELECT user_id FROM firm_members WHERE firm_slug = ? AND status = 'approved')`).bind(admin?.id ?? null, into, fromSlug),
    db.prepare("UPDATE OR IGNORE firm_members SET firm_slug = ? WHERE firm_slug = ? AND status IN ('approved', 'pending')").bind(into, fromSlug),
    // Their work: leads, outreach notes, invitations, who follows the firm, ratings.
    db.prepare('UPDATE leads SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    db.prepare('UPDATE outreach SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    db.prepare('UPDATE firm_invites SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    db.prepare('UPDATE OR IGNORE follows SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    db.prepare('UPDATE OR IGNORE firm_ratings SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    // The blog feed and its posts come along only if the kept listing has no feed of its own (one feed per firm).
    db.prepare('UPDATE OR IGNORE firm_posts SET firm_slug = ? WHERE firm_slug = ? AND NOT EXISTS (SELECT 1 FROM firm_feeds WHERE firm_slug = ?)').bind(into, fromSlug, into),
    db.prepare('UPDATE OR IGNORE firm_feeds SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    // Counters add up day by day. Past payments keep their history on the kept listing.
    db.prepare('INSERT INTO firm_stats_daily (firm_slug, day, metric, k, n) SELECT ?, day, metric, k, n FROM firm_stats_daily WHERE firm_slug = ? ON CONFLICT (firm_slug, day, metric, k) DO UPDATE SET n = n + excluded.n').bind(into, fromSlug),
    db.prepare('UPDATE firm_subscriptions SET firm_slug = ? WHERE firm_slug = ?').bind(into, fromSlug),
    // The duplicate goes (its leftover rows go with it), and its address, and any older address that pointed at it, now lead to the kept listing.
    db.prepare('DELETE FROM firms WHERE slug = ?').bind(fromSlug),
    db.prepare('DELETE FROM firm_redirects WHERE old_slug = ?').bind(into),
    db.prepare('UPDATE firm_redirects SET new_slug = ? WHERE new_slug = ?').bind(into, fromSlug),
    db.prepare('INSERT OR REPLACE INTO firm_redirects (old_slug, new_slug, created_by) VALUES (?, ?, ?)').bind(fromSlug, into, admin?.id ?? null),
  ]);
  await audit(env, admin, 'firm.merge', 'firm', into, { from: fromSlug, fromName: from.name, into, intoName: keep.name, owners });
  return { slug: into, name: keep.name, from: fromSlug, owners };
}
