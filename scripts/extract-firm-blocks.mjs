// One-time reader of the small hand-written blocks on the hand-built firm pages ("From the Firm" / "Related reading": a headline, a
// teaser, an optional picture and one link), so the database page can show them too. Writes data/firm-blocks.json ({ slug: block }).
//   node scripts/extract-firm-blocks.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const un = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').trim();
const out = {};
const bad = [];
for (const f of firms) {
  const html = readFileSync(`firms/${f.slug}.html`, 'utf8');
  const m = html.match(/<div class="from-firm">([\s\S]*?)<\/div>\s*(?=<(?:section|div|\/div))/);
  if (!html.includes('class="from-firm"')) continue;
  if (!m) { bad.push(f.slug); continue; }
  const b = m[1];
  const heading = (b.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1];
  const title = (b.match(/<div class="post-title">([\s\S]*?)<\/div>/) || [])[1];
  const img = b.match(/<img class="article-photo" src="([^"]+)" alt="([^"]*)"/);
  const teaser = (b.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1];
  const link = b.match(/<a class="read-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!heading || !title || !teaser || !link) { bad.push(f.slug); continue; }
  out[f.slug] = {
    heading: un(heading), title: un(title), teaser: un(teaser), href: un(link[1]), linkText: un(link[2]),
    ...(img ? { image: un(img[1]).replace(/^\.\.\//, ''), alt: un(img[2]) } : {}),
  };
}
writeFileSync('data/firm-blocks.json', JSON.stringify(out, null, 1) + '\n');
console.log(`${Object.keys(out).length} blocks${bad.length ? `; could not read: ${bad.join(', ')}` : ''}`);
