// Blog posts shown on LawDB News, firm cards and the home strip must be articles with their own photo:
// no headshots, logos, templates, social cards, welcome or award announcements. Legal articles stay even when a word like "awards" appears.
import { isBlogPhotoPost } from '../src/lib/post-photos.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };
const post = (title, image) => ({ title, image, url: 'https://firm.example/a', publishedAt: '2026-10-01 10:00:00' });
const photo = 'https://firm.example/wp-content/uploads/2026/10/';

ok(!isBlogPhotoPost(post('A real article', '')), 'a post with no picture is not shown');
ok(!isBlogPhotoPost(post('A real article', null)), 'a post with a null picture is not shown');

for (const name of ['Harry-headshot.jpg', 'jane-doe-portrait.jpg', 'our-team-2026.jpg', 'Team-Photo-2025.jpg', 'profile-anna.webp', 'author-kim.png', 'firm-logo.png', 'favicon-96.png', 'Feature-Image-Socials-1200-x-630-PX-8.png', 'blog-bg-1.jpg', 'blog-thumbnail-default.jpg', 'Blog-Featured-Image-Template-BLANK-1.png', 'og-image.jpg', 'placeholder.jpg']) {
  ok(!isBlogPhotoPost(post('Ordinary article about wills', photo + name)), `a picture named ${name} is not an article photo`);
}

for (const title of ['Welcome, Sarah Barradas!', 'Welcome to Minken Employment Lawyers', 'Greg Monforton & Partners Celebrates $104,534 Raised', 'Kimberly Howe @ Vintage Chophouse | #LunchingWithLawyers', 'Merovitz Potechin LLP Recognized in Best Lawyers Canada 2026', 'Devinder Shory receives his King’s Counsel designation!', 'Davidson Cahill Morrison LLP Sponsors the 2026 OTLA Cup', 'Goodbye… for now.', 'Top 25 lawyers in Canada named']) {
  ok(!isBlogPhotoPost(post(title, photo + 'picture.jpg')), `announcement "${title}" is left out`);
}

for (const title of ['Human Rights Tribunal Awards $50,000 + Lost Wages for Sexual Harassment at Work', 'A New Sanctum for Survivors: Why the Supreme Court of Canada Recognized the Tort of Intimate Partner Violence', 'Spousal Sponsorship: What Sponsors Must Prove', 'Can an Executor Be Ordered to Pay Damages Personally?', 'Default Judgment in Ontario: What Happens If You Miss the Deadline', 'Authority to Sign the Agreement of Purchase and Sale']) {
  ok(isBlogPhotoPost(post(title, photo + 'default-judgment-authority.jpg')), `legal article "${title}" stays`);
}

ok(isBlogPhotoPost(post('Agreement of Purchase and Sale Explained', 'https://davylaw.ca/wp-content/uploads/2024/01/Agreement-of-Purchase-and-Sale-Explained-Cover.webp')), 'a deal article with its own picture stays');
ok(isBlogPhotoPost(post('How to Contest a Will in Ontario', 'https://images.unsplash.com/photo-1563986768609-322da13575f2?w=1600&h=900&fit=crop')), 'a stock picture on an article stays');

if (failed) process.exit(1);
console.log('post photo checks passed');
