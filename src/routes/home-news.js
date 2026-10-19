// The LawDB News feed on the home page (ranking in src/lib/home-feed.js): the first cards are put into the page when it is served, the
// rest come from GET /api/home-news?offset=&type= as the visitor scrolls or picks a practice area.
import { loadCandidates, rankPosts, isPracticeType } from '../lib/home-feed.js';
import { newsCardsHtml, DIALOG_CSS, STORY_JS, dialogHtml } from '../render/news-page.js';
import { BLOG_CSS } from '../render/blog-cards.js';
import { storyPath } from '../lib/stories.js';

export const FIRST = 6; // cards in the page itself
export const STEP = 6;  // cards per "show more"
export const MAX = 60;  // the feed ends here; News has the rest

const ttlOf = (env) => {
  const n = Number(env.PUBLIC_CACHE_TTL ?? 60);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

// One slice of the ranked feed: { html, next (offset of the following slice, or null at the end), total }.
export async function homeNewsSlice(env, { offset = 0, type = '', limit = STEP } = {}) {
  const posts = rankPosts(await loadCandidates(env), { type: isPracticeType(type) ? type : '' }).slice(0, MAX);
  const slice = posts.slice(offset, offset + limit).map((p) => ({ ...p, storyHref: storyPath(p.firmSlug, p.id, p.title) }));
  return { html: newsCardsHtml(slice), next: offset + slice.length < posts.length ? offset + slice.length : null, total: posts.length };
}

export async function homeNewsApi({ request, env, exec }) {
  const url = new URL(request.url);
  const offset = Math.min(Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0), MAX);
  const type = isPracticeType(url.searchParams.get('type') || '') ? url.searchParams.get('type') : '';
  const ttl = ttlOf(env);
  const key = new Request(`${url.origin}/api/home-news?offset=${offset}&type=${type}`, { method: 'GET' });
  if (ttl > 0) {
    const hit = await caches.default.match(key);
    if (hit) return hit;
  }
  const slice = await homeNewsSlice(env, { offset, type });
  const res = new Response(JSON.stringify(slice), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': ttl > 0 ? `public, max-age=${ttl}` : 'no-cache', 'x-content-type-options': 'nosniff' } });
  if (ttl > 0) exec(caches.default.put(key, res.clone()));
  return res;
}

// Puts the first cards (and what they need: card styles, the story dialog and its script) into the home page. The section is
// hidden in the file and only shown here, so if the database cannot answer the page is the same as before, minus the feed.
export async function withHomeNews(html, env) {
  if (!html.includes('id="homeNews"')) return html;
  let first;
  try { first = await homeNewsSlice(env, { offset: 0, limit: FIRST }); } catch (err) { console.error('home news failed, page served without it', err); return html; }
  if (!first.html) return html;
  return new HTMLRewriter()
    .on('head', { element(el) { el.append(BLOG_CSS + DIALOG_CSS, { html: true }); } })
    .on('section#homeNews', { element(el) { el.removeAttribute('hidden'); } })
    .on('div#homeNewsGrid', { element(el) { el.setInnerContent(first.html, { html: true }); el.setAttribute('data-next', first.next == null ? '' : String(first.next)); } })
    .on('div#homeNewsDlg', { element(el) { el.setInnerContent(dialogHtml + '<script>' + STORY_JS + '</script><script src="/follow.js" defer></script>', { html: true }); } })
    .transform(new Response(html)).text();
}
