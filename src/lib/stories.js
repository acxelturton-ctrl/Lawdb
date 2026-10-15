// Every blog card has its own LawDB page: /news/<firm>/<headline-words>-<id>. The id makes the address stable and unique;
// the words are for people and search engines (a wrong or old wording redirects to the right one).
export const slugify = (s) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '') || 'story';

export const storyPath = (firmSlug, id, title) => `/news/${firmSlug}/${slugify(title)}-${id}`;

export function parseStoryPath(pathname) {
  const m = /^\/news\/([a-z0-9][a-z0-9-]*)\/([a-z0-9-]*?)-?(\d{1,12})\/?$/.exec(pathname);
  return m ? { firmSlug: m[1], slug: m[2], id: Number(m[3]) } : null;
}
