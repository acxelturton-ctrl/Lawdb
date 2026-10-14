// Following and saving. Signed-in people follow law firms (their LawDB listings) and save stories; "My feed" is the stories of the firms they follow.
// Follows and saves are private: the only thing the public ever sees is how many people follow a firm.
import { json, readJson, NO_STORE, HttpError } from '../lib/http.js';
import { getUser, requireUser } from '../lib/auth.js';
import { storyPath } from '../lib/stories.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);
export const SOCIAL_LIMITS = { follows: 500, saves: 500, actionsPerHour: 60 };

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const slugsOf = (raw) => [...new Set(String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => SLUG.test(s)))].slice(0, 40);
const idsOf = (raw) => [...new Set(String(raw || '').split(',').map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 60);
const marks = (n) => Array(n).fill('?').join(',');

async function followerCount(env, slug) {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE firm_slug = ?').bind(slug).first()).n;
}

// For the Follow and Save buttons on public pages: who is looking, which of these firms they follow and how many follow each, which of these stories they saved.
export async function status({ request, env, url }) {
  const user = await getUser(env, request);
  const slugs = slugsOf(url.searchParams.get('slugs'));
  const ids = idsOf(url.searchParams.get('posts'));
  const follows = {};
  if (slugs.length) {
    const counts = (await env.DB.prepare(`SELECT firm_slug AS slug, COUNT(*) AS n FROM follows WHERE firm_slug IN (${marks(slugs.length)}) GROUP BY firm_slug`).bind(...slugs).all()).results;
    for (const s of slugs) follows[s] = { followers: counts.find((c) => c.slug === s)?.n || 0, following: false };
    if (user) for (const r of (await env.DB.prepare(`SELECT firm_slug FROM follows WHERE user_id = ? AND firm_slug IN (${marks(slugs.length)})`).bind(user.id, ...slugs).all()).results) follows[r.firm_slug].following = true;
  }
  const saved = {};
  if (user && ids.length) for (const r of (await env.DB.prepare(`SELECT post_id FROM saved_stories WHERE user_id = ? AND post_id IN (${marks(ids.length)})`).bind(user.id, ...ids).all()).results) saved[r.post_id] = true;
  return reply({ signedIn: !!user, follows, saved });
}

async function tooMany(env, user) {
  const r = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM follows WHERE user_id = ? AND created_at > datetime('now','-1 hour')) + (SELECT COUNT(*) FROM saved_stories WHERE user_id = ? AND created_at > datetime('now','-1 hour')) AS n`
  ).bind(user.id, user.id).first();
  return r.n >= SOCIAL_LIMITS.actionsPerHour;
}

export async function follow({ request, env }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 300);
  const slug = String(body.slug || '').toLowerCase();
  if (!SLUG.test(slug)) throw new HttpError(422, 'Choose a firm to follow.');
  if (!(await env.DB.prepare("SELECT 1 FROM firms WHERE slug = ? AND status = 'live'").bind(slug).first())) throw new HttpError(404, 'Firm not found');
  const already = await env.DB.prepare('SELECT 1 FROM follows WHERE user_id = ? AND firm_slug = ?').bind(user.id, slug).first();
  if (!already) {
    if (await tooMany(env, user)) throw new HttpError(429, 'You are going a little fast. Try again in a few minutes.');
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM follows WHERE user_id = ?').bind(user.id).first()).n >= SOCIAL_LIMITS.follows) throw new HttpError(422, `You can follow up to ${SOCIAL_LIMITS.follows} firms.`);
    await env.DB.prepare('INSERT OR IGNORE INTO follows (user_id, firm_slug) VALUES (?, ?)').bind(user.id, slug).run();
  }
  return reply({ following: true, followers: await followerCount(env, slug) });
}

export async function unfollow({ request, env, params }) {
  const user = await requireUser(env, request);
  const slug = String(params.slug || '').toLowerCase();
  if (!SLUG.test(slug)) throw new HttpError(422, 'Not a firm.');
  await env.DB.prepare('DELETE FROM follows WHERE user_id = ? AND firm_slug = ?').bind(user.id, slug).run();
  return reply({ following: false, followers: await followerCount(env, slug) });
}

export async function following({ request, env }) {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT f.slug, f.name, f.city, f.province, f.featured, (SELECT COUNT(*) FROM follows x WHERE x.firm_slug = f.slug) AS followers
     FROM follows w JOIN firms f ON f.slug = w.firm_slug AND f.status = 'live' WHERE w.user_id = ? ORDER BY w.created_at DESC, f.name`
  ).bind(user.id).all();
  return reply({ firms: results.map((r) => ({ ...r, featured: !!r.featured })) });
}

const withSaved = async (env, user, rows) => {
  const ids = rows.map((r) => r.id);
  const saved = new Set(ids.length ? (await env.DB.prepare(`SELECT post_id FROM saved_stories WHERE user_id = ? AND post_id IN (${marks(ids.length)})`).bind(user.id, ...ids).all()).results.map((r) => r.post_id) : []);
  return rows.map((r) => ({ id: r.id, title: r.title, excerpt: r.excerpt, publishedAt: r.publishedAt, image: r.image, firm: { slug: r.firmSlug, name: r.firmName, featured: !!r.featured }, href: storyPath(r.firmSlug, r.id, r.title), saved: saved.has(r.id) }));
};
const STORY_COLS = `p.id, p.title, p.excerpt, p.published_at AS publishedAt, p.image_url AS image, p.firm_slug AS firmSlug, json_extract(f.data, '$.name') AS firmName, f.featured`;
const LIVE = `JOIN firm_feeds ff ON ff.firm_slug = p.firm_slug AND ff.enabled = 1 JOIN firms f ON f.slug = p.firm_slug AND f.status = 'live'`;

// The stories of the firms this person follows, newest first.
export async function feed({ request, env }) {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT ${STORY_COLS} FROM firm_posts p ${LIVE} JOIN follows w ON w.firm_slug = p.firm_slug AND w.user_id = ?
     ORDER BY p.published_at DESC, p.id DESC LIMIT 40`
  ).bind(user.id).all();
  return reply({ stories: await withSaved(env, user, results) });
}

export async function savedList({ request, env }) {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT ${STORY_COLS} FROM saved_stories s JOIN firm_posts p ON p.id = s.post_id ${LIVE} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100`
  ).bind(user.id).all();
  return reply({ stories: await withSaved(env, user, results) });
}

export async function save({ request, env }) {
  const user = await requireUser(env, request);
  const body = await readJson(request, 300);
  const id = Number(body.postId);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(422, 'Choose a story to save.');
  if (!(await env.DB.prepare(`SELECT 1 FROM firm_posts p ${LIVE} WHERE p.id = ?`).bind(id).first())) throw new HttpError(404, 'Story not found');
  const already = await env.DB.prepare('SELECT 1 FROM saved_stories WHERE user_id = ? AND post_id = ?').bind(user.id, id).first();
  if (!already) {
    if (await tooMany(env, user)) throw new HttpError(429, 'You are going a little fast. Try again in a few minutes.');
    if ((await env.DB.prepare('SELECT COUNT(*) AS n FROM saved_stories WHERE user_id = ?').bind(user.id).first()).n >= SOCIAL_LIMITS.saves) throw new HttpError(422, `You can save up to ${SOCIAL_LIMITS.saves} stories.`);
    await env.DB.prepare('INSERT OR IGNORE INTO saved_stories (user_id, post_id) VALUES (?, ?)').bind(user.id, id).run();
  }
  return reply({ saved: true });
}

export async function unsave({ request, env, params }) {
  const user = await requireUser(env, request);
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(422, 'Not a story.');
  await env.DB.prepare('DELETE FROM saved_stories WHERE user_id = ? AND post_id = ?').bind(user.id, id).run();
  return reply({ saved: false });
}
