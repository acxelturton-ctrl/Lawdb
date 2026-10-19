// LawDB News with every firm's blog: story pages of non-Featured firms stay out of search engines, and the page stays short however many firms write.
import { isIndexableStory, STORY_INDEXABLE_SQL } from '../src/lib/stories.js';
import { renderNewsPage } from '../src/render/news-page.js';
import { renderStoryPage } from '../src/render/story-page.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };

ok(isIndexableStory({ featured: 1, source: 'auto' }) && isIndexableStory({ featured: 0, source: 'manual' }) && !isIndexableStory({ featured: 0, source: 'auto' }), 'only Featured firms and hand-added blogs are indexable');
ok(/f\.featured = 1/.test(STORY_INDEXABLE_SQL) && /source = 'manual'/.test(STORY_INDEXABLE_SQL), 'the story sitemap uses the same rule');

const firm = { slug: 'x-law', name: 'X Law', city: 'Ottawa', province: 'ON' };
const post = { id: 7, title: 'A real headline for a story', url: 'https://x.example/a', publishedAt: '2026-01-02 03:04:05', excerpt: 'A short preview of the article.', image: '' };
ok(!/name="robots"/.test(renderStoryPage({ post, firm, more: [], nearby: [], indexable: true })), 'an indexable story page has no robots tag');
ok(/<meta name="robots" content="noindex,follow">/.test(renderStoryPage({ post, firm, more: [], nearby: [], indexable: false })), 'a story page of a non-Featured firm is noindex, follow');

const firms = Array.from({ length: 90 }, (_, i) => ({ slug: `firm-${i}`, name: `Firm ${i}`, logo: null, latest: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` }));
const posts = [{ firmSlug: 'firm-1', firmName: 'Firm 1', featured: false, indexable: false, logo: null, title: 'Hello world article', url: 'https://f1.example/hello', publishedAt: '2026-01-05', excerpt: 'Preview text.', image: '', storyHref: '/news/firm-1/hello-world-article-1', id: 1 },
  { firmSlug: 'firm-2', firmName: 'Firm 2', featured: true, indexable: true, logo: null, title: 'Featured article here', url: 'https://f2.example/a', publishedAt: '2026-01-04', excerpt: 'Preview text.', image: '', storyHref: '/news/firm-2/featured-article-here-2', id: 2 }];
const html = renderNewsPage({ posts, firms, people: firms.slice(0, 16), stats: { firms: 90, articles: 400, latest: '2026-01-05' } });
ok((html.match(/<option value="firm-/g) || []).length === 90 && html.includes('All 90 firms'), 'the filter lists every firm that writes');
ok((html.match(/class="news-people"[\s\S]*?<\/div>/)[0].match(/<a href="\/news\?firm=/g) || []).length === 16 && html.includes('and 74 more'), 'the "firms writing here" strip shows 16 and says how many more');
const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
ok(ld.mainEntity.itemListElement.length === 1 && ld.mainEntity.itemListElement[0].url.endsWith('featured-article-here-2'), 'only indexable stories are listed in the page\'s structured data');
ok(!/Featured law firms|Featured members\' blogs/.test(html), 'the page no longer says only Featured firms appear');

if (failed) process.exit(1);
console.log('news checks passed');
