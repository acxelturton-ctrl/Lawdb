// Tests for "What clients say" (src/lib/comments.js, commentsHtml in src/render/firm-page.js, db/comments-updates.sql) on a real in-memory SQLite database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { cleanComments, tidyAuthor, shorten, MAX_COMMENTS, TARGET_CHARS } from '../src/lib/comments.js';
import { commentsHtml } from '../src/render/firm-page.js';
import { DROPPED_FIELDS } from '../src/routes/dynamic.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const SITE = 'https://testlaw.ca';
const c = (text, extra = {}) => ({ text, author: '', url: 'https://testlaw.ca/testimonials/', ...extra });
const good = 'We had a wonderful experience with this firm and would recommend them to anyone who needs help with a legal matter.';

// ---- what is kept
let r = cleanComments([c(good)], { website: SITE });
eq(r.map((x) => x.text), [good], 'a plain, positive comment is kept as it is');
eq(cleanComments([c(`“${good}”`)], { website: SITE })[0].text, good, 'quotation marks around the whole comment are removed');
eq(cleanComments([c(good), c(good)], { website: SITE }).length, 1, 'the same comment twice is shown once');
eq(cleanComments(Array.from({ length: 6 }, (_, i) => c(`Comment number ${i} was written by a very happy client who liked the service a lot.`)), { website: SITE }).length, MAX_COMMENTS, 'at most three');
eq(cleanComments(null), null, 'nothing in, nothing out');
eq(cleanComments([], { website: SITE }), null, 'an empty list is nothing');

// ---- what is never kept
const drops = (text, why, extra) => eq(cleanComments([c(text, extra)], { website: SITE }), null, why);
drops('Great firm.', 'too short to be a comment');
drops('Visit https://other.example for more about how wonderful this lawyer and the team are every day.', 'links are not allowed');
drops('Visit www.example.com for more about how wonderful this lawyer and the team are every day, truly.', 'web addresses are not allowed');
drops('Call me on 416 555 0199 to hear how wonderful this lawyer and the whole team were with my case.', 'phone numbers are not shown');
drops('Write to me at maria@example.com to hear how wonderful this lawyer and the whole team really were.', 'email addresses are not shown');
drops('<b>Wonderful</b> lawyer and a wonderful team who helped us through every single step of our matter.', 'markup is not allowed');
drops('He is the best lawyer in Ontario and a wonderful person who helped us through every step of our matter.', 'law society advertising claims are not shown ("best lawyer in Ontario")');
drops('They guaranteed a great result and delivered it, a wonderful team who helped us through every step.', '"guaranteed" is a restricted claim');
drops('A certified specialist who helped us through every single step of our matter, wonderful to work with.', '"specialist" is a restricted title');
drops('When our daughter was killed in a crash we hired this firm and were treated with great kindness throughout.', 'a death is not put in a card');
drops('After the sexual assault charge they were calm, professional and wonderful to deal with at every step.', 'sexual and violent crime stories are not shown');
drops(good, 'a source that is not on the firm’s own website is refused', { url: 'https://evil.example/testimonials/' });
drops(good, 'no source address is refused', { url: '' });
drops(good, 'a javascript: source is refused', { url: 'javascript:alert(1)' });
eq(cleanComments([c(good)], { website: '' }), null, 'with no website to check against nothing is shown');
eq(cleanComments([c(good, { url: 'https://www.testlaw.ca/about' })], { website: SITE }).length, 1, 'www and sub-pages of the firm’s site are fine');
eq(cleanComments([c(good, { url: 'https://reviews.testlaw.ca/x' })], { website: SITE }).length, 1, 'a sub-domain of the firm’s site is fine');
eq(cleanComments([c(good, { url: 'https://testlaw.ca.evil.io/x' })], { website: SITE }), null, 'a look-alike address is not the firm’s site');
eq(cleanComments(['x', 5, null, { text: 5 }], { website: SITE }), null, 'odd data is ignored, not trusted');

// ---- the cards come out about the same size
const sentence = (n) => Array.from({ length: n }, (_, k) => `Word${k}`).join(' ') + ' made us very happy with this firm.';
const mk = (label, n) => c(`${label} ${sentence(n)}`);
const pool = [mk('Aaa', 4), mk('Bbb', 52), mk('Ccc', 26), mk('Ddd', 9), mk('Eee', 30), mk('Fff', 28), mk('Ggg', 2)];
const picked = cleanComments(pool, { website: SITE });
eq(picked.map((x) => x.text.slice(0, 3)), ['Ccc', 'Eee', 'Fff'], 'with more than three to choose from, the three closest to the target length are kept, in their original order');
const spread = (l) => Math.max(...l.map((x) => x.text.length)) - Math.min(...l.map((x) => x.text.length));
ok(spread(picked) < spread(cleanComments(pool.slice(0, 3), { website: SITE })), 'and they are closer in length than the first three would have been');
eq(cleanComments(pool.slice(0, 3), { website: SITE }).map((x) => x.text.slice(0, 3)), ['Aaa', 'Bbb', 'Ccc'], 'with three or fewer, they are all kept as they are');
ok(TARGET_CHARS > 100 && TARGET_CHARS < 300, 'the target is a few lines of text');

// ---- names and length
eq(tidyAuthor('Maria Gonzalez'), 'Maria G.', 'first name and last initial');
eq(tidyAuthor('Jean-Luc de la Cruz'), '', 'a name that is not plainly First Last is not shown');
eq(tidyAuthor('H.M.'), 'H.M.', 'initials stay');
eq(tidyAuthor('H. M.'), 'H.M.', 'spaced initials are tidied');
eq(tidyAuthor('Maria'), 'Maria', 'a first name stays');
eq(tidyAuthor('Verified client'), '', 'a label is not a name');
eq(tidyAuthor('Sam <script>'), '', 'markup is not a name');
eq(tidyAuthor('a'.repeat(50)), '', 'too long');
eq(tidyAuthor(undefined), '', 'nothing');
const long = Array.from({ length: 30 }, () => 'This is a good sentence about the service.').join(' ');
ok(shorten(long).split(/\s+/).length <= 60 && /[.…]$/.test(shorten(long)), 'a long comment is cut to at most 60 words at a sentence end');
eq(shorten('Short one.'), 'Short one.', 'a short comment is left alone');
const noStop = Array.from({ length: 90 }, (_, i) => `word${i}`).join(' ');
ok(shorten(noStop).endsWith('…') && shorten(noStop).split(/\s+/).length === 60, 'no sentence end: cut at a word with an ellipsis');

// ---- the page section
const firm = { name: 'Test <b>Law</b> LLP', website: SITE, comments: [c(good, { author: 'Maria Gonzalez' }), c('Their team was kind and explained every single step of the process to us very clearly.')] };
const html = commentsHtml(firm);
ok(html.includes('What clients say') && html.includes('cm-track n2') && (html.match(/<figure class="cm-card"/g) || []).length === 2, 'the section shows two cards for two comments');
ok(/<script>/.test(html) && !/Maria|wonderful/.test(html.slice(html.indexOf('<script>'))), 'the script (See more, and the swipe strip on phones) is there and holds no comment text');
ok((html.match(/class="cm-ar"/g) || []).length === 2 && (html.match(/<div class="cm-dots">/g) || []).length === 1 && (html.match(/aria-label="Show comment/g) || []).length === 2, 'two comments: previous and next arrows and two dots (for the swipe strip on a phone)');
const one = commentsHtml({ ...firm, comments: [c(good)] });
ok(one.includes('cm-track n1') && !/class="cm-ar"|class="cm-dots"/.test(one), 'one comment: no arrows and no dots');
ok(html.includes('<figcaption class="cm-by">Maria G.</figcaption>'), 'a reviewer with a name is shown by first name and last initial');
ok((html.match(/<figcaption/g) || []).length === 1, 'a comment with no name shows no name line at all');
ok(!/A client|from the firm&rsquo;s site|cm-av|cm-who/.test(html + one), 'no "A client" label, no per-card site link, no avatar');
ok((html.match(/class="cm-more"/g) || []).length === 2 && html.includes('>See more</button>'), 'each card carries a See more button (shown only when a comment is cut short)');
ok(html.includes('Read more on the firm&rsquo;s website') && html.includes('href="https://testlaw.ca/testimonials/"'), 'one link under the section goes to the page the firm published them on');
ok(/LawDB has not verified/.test(html), 'the page says the comments are not verified');
ok(!/publishes on its own website|cm-sub/.test(html), 'no "comments from the company\u2019s own website" line under the heading');
ok(!html.includes('<b>Law</b>') && !html.includes('Test &lt;b&gt;'), 'the firm name is not shown in the section at all, so it cannot break the markup');
ok(!/★|stars?\b/i.test(html), 'no stars');
eq(commentsHtml({ ...firm, commentsOff: true }), '', 'a firm marked commentsOff shows nothing');
eq(commentsHtml({ name: 'x', website: SITE }), '', 'no comments, no section');
eq(commentsHtml({ ...firm, comments: [c(good, { url: 'https://evil.example/x' })] }), '', 'stored data is cleaned again when the page is made');
ok(DROPPED_FIELDS.includes('comments') && DROPPED_FIELDS.includes('commentsOff'), 'the Find page list does not carry the comments');

// ---- the database updates apply cleanly and leave opted-out firms alone
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE firms (slug TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
const sql = readFileSync(new URL('../db/comments-updates.sql', import.meta.url), 'utf8');
const stmts = sql.split('\n').filter((l) => l.startsWith('UPDATE'));
ok(stmts.length > 100, `there are updates (${stmts.length})`);
const slugOf = (s) => s.match(/WHERE slug = '([^']+)'/)[1];
const slugs = stmts.map(slugOf);
const ins = db.prepare('INSERT INTO firms (slug, data) VALUES (?, ?)');
for (const s of slugs) ins.run(s, JSON.stringify({ slug: s, name: s }));
db.prepare('UPDATE firms SET data = ? WHERE slug = ?').run(JSON.stringify({ slug: slugs[0], commentsOff: true }), slugs[0]);
for (const s of stmts) db.exec(s);
const row = (s) => JSON.parse(db.prepare('SELECT data FROM firms WHERE slug = ?').get(s).data);
ok(Array.isArray(row(slugs[1]).comments) && row(slugs[1]).comments.length >= 1 && row(slugs[1]).comments.length <= 3 && row(slugs[1]).name === slugs[1], 'the comments are added to the firm record, the rest of it is kept');
ok(!('comments' in row(slugs[0])), 'a firm whose record says commentsOff is not touched');
for (const s of slugs.slice(1)) for (const x of row(s).comments) ok(typeof x.text === 'string' && /^https:\/\//.test(x.url), `${s}: text and a source address`);

console.log(`firm comments: ${n} checks passed`);
