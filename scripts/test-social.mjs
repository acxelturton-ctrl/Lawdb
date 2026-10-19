// Social profile links: which addresses are kept (src/lib/social.js) and how the story card shows them.
import { cleanSocialUrl, cleanSocial } from '../src/lib/social.js';
import { storyBody } from '../src/render/story-page.js';

let failed = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failed++; };

const keep = [
  ['facebook', 'https://www.facebook.com/danielbrownlaw/', 'https://www.facebook.com/danielbrownlaw'],
  ['facebook', 'https://m.facebook.com/pages/Foo-Law/123456?ref=x', 'https://www.facebook.com/pages/Foo-Law/123456'],
  ['facebook', 'https://www.facebook.com/profile.php?id=100012345678901&ref=x', 'https://www.facebook.com/profile.php?id=100012345678901'],
  ['instagram', 'https://instagram.com/foolaw?hl=en', 'https://www.instagram.com/foolaw'],
  ['linkedin', 'https://ca.linkedin.com/company/foo-law', 'https://www.linkedin.com/company/foo-law'],
  ['x', 'https://twitter.com/foolaw', 'https://x.com/foolaw'],
  ['x', 'https://x.com/@foolaw', 'https://x.com/foolaw'],
  ['youtube', 'https://www.youtube.com/@foolaw', 'https://www.youtube.com/@foolaw'],
  ['youtube', 'https://youtube.com/channel/UC123', 'https://www.youtube.com/channel/UC123'],
];
for (const [n, raw, want] of keep) ok(cleanSocialUrl(n, raw) === want, `${n}: ${raw} is kept as ${want}`);
const drop = [
  ['facebook', 'https://www.facebook.com/sharer/sharer.php?u=x'], ['facebook', 'https://www.facebook.com/foo/posts/123'], ['facebook', 'https://www.facebook.com/profile.php?id=abc'],
  ['facebook', 'javascript:alert(1)'], ['facebook', 'https://evil.com/facebook.com/foo'], ['facebook', 'https://facebook.com.evil.com/foo'], ['facebook', 'https://user:pw@facebook.com/foo'],
  ['instagram', 'https://www.instagram.com/p/AbC/'], ['linkedin', 'https://www.linkedin.com/shareArticle?url=x'], ['linkedin', 'https://www.linkedin.com/feed/'],
  ['x', 'https://twitter.com/intent/tweet?text=x'], ['x', 'https://x.com/share'], ['youtube', 'https://www.youtube.com/watch?v=abc'], ['youtube', 'https://www.youtube.com/embed/abc'],
  ['facebook', 42], ['facebook', null],
];
for (const [n, raw] of drop) ok(cleanSocialUrl(n, raw) === null, `${n}: ${raw} is refused`);
ok(JSON.stringify(cleanSocial({ youtube: 'https://youtube.com/@b', x: 'https://evil.com/a', facebook: 'https://facebook.com/a' })) === '{"facebook":"https://www.facebook.com/a","youtube":"https://www.youtube.com/@b"}', 'a list keeps only valid addresses, in a fixed order');
ok(JSON.stringify(cleanSocial(null)) === '{}' && JSON.stringify(cleanSocial('x')) === '{}', 'anything that is not a list gives an empty one');

const post = { id: 1, title: 'A title', url: 'https://example.com/a', publishedAt: '2026-10-01 10:00:00', excerpt: 'A preview.', image: '' };
const firm = { slug: 'foo-law', name: 'Foo Law', city: 'Toronto', province: 'ON', featured: false, tags: ['Family'], phone: '', website: 'https://example.com' };
const withSocial = storyBody({ post, firm: { ...firm, social: { facebook: 'https://www.facebook.com/foolaw', linkedin: 'https://www.linkedin.com/company/foo-law', x: 'https://evil.com/foolaw', instagram: 'javascript:alert(1)' } }, more: [], nearby: [] });
ok((withSocial.match(/<div class="st-soc">/g) || []).length === 1 && (withSocial.match(/<a href="https:\/\/www\.(facebook|linkedin)\.com\/[^"]+" target="_blank" rel="noopener nofollow" aria-label="Foo Law on (Facebook|LinkedIn)"/g) || []).length === 2, 'the card shows one round link per valid profile, opening in a new tab');
ok(!withSocial.includes('evil.com') && !withSocial.includes('javascript:') && !withSocial.includes('Foo Law on X') && !withSocial.includes('Foo Law on Instagram'), 'invalid addresses are never shown');
ok(withSocial.indexOf('class="st-soc"') > withSocial.indexOf('See their LawDB profile') && withSocial.indexOf('class="st-soc"') < withSocial.indexOf('</article>'), 'the icons sit in the "About the firm" box, under the profile link');
const none = storyBody({ post, firm, more: [], nearby: [] });
ok(!none.includes('st-soc"') && none.includes('About Foo Law'), 'a firm without social links shows no icon row');
const bad = storyBody({ post, firm: { ...firm, social: 'not an object' }, more: [], nearby: [] });
ok(!bad.includes('st-soc"'), 'a damaged value shows nothing and does not break the card');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('All checks passed');
