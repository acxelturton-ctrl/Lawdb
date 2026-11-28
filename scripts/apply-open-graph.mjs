// The share picture (Open Graph / Twitter card) and the Open Graph type of every page.
//   node scripts/apply-open-graph.mjs            rewrites the pages
//   node scripts/apply-open-graph.mjs --check    fails if any page still points at the old picture or still says og:type "business.business" (npm run check runs this)
// The picture is images/og-lawdb.jpg (1200 x 630, no firm count on it, so it never goes out of date). The old images/og-default.jpg said "Browse 277 Canadian law firms".
// The type is "website" on every page except news stories ("article"): a firm page is a web page, not a business object.
// A page that carries the picture also says how big it is (1200 x 630, so Facebook can show it the first time it is shared) and gives it to Twitter cards.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHECK = process.argv.includes('--check');
const SKIP = new Set(['node_modules', '.wrangler', '.git', 'migrations', 'data', 'docs']);
const OLD_IMAGE = 'https://lawdb.ca/images/og-default.jpg', NEW_IMAGE = 'https://lawdb.ca/images/og-lawdb.jpg';
const OLD_TYPE = '<meta property="og:type" content="business.business">', NEW_TYPE = '<meta property="og:type" content="website">';

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else if (name.endsWith('.html')) yield p;
  }
}

const IMG_TAG = `<meta property="og:image" content="${NEW_IMAGE}">`, SIZE_TAGS = '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">';
const CARD_TAG = '<meta name="twitter:card" content="summary_large_image">', TW_IMAGE_TAG = `<meta name="twitter:image" content="${NEW_IMAGE}">`;
const SMALL_CARD = '<meta name="twitter:card" content="summary">';
function complete(html) {
  let out = html;
  if (out.includes(IMG_TAG) && out.includes(SMALL_CARD)) out = out.replace(SMALL_CARD, CARD_TAG); // the picture is wide, so the card is the large one
  if (out.includes(IMG_TAG) && !out.includes('property="og:image:width"')) out = out.replace(IMG_TAG, IMG_TAG + '\n' + SIZE_TAGS);
  if (out.includes(IMG_TAG) && out.includes(CARD_TAG) && !out.includes('name="twitter:image"')) out = out.replace(CARD_TAG, CARD_TAG + '\n' + TW_IMAGE_TAG);
  return out;
}

let changed = 0, stale = [];
for (const file of walk('.')) {
  const html = readFileSync(file, 'utf8');
  const out = complete(html.split(OLD_IMAGE).join(NEW_IMAGE).split(OLD_TYPE).join(NEW_TYPE));
  if (out === html) continue;
  changed++;
  if (CHECK) stale.push(file); else writeFileSync(file, out);
}
if (CHECK) {
  if (stale.length) { console.error(`${stale.length} page(s) still use the old share picture or og:type "business.business", e.g. ${stale[0]} (run node scripts/apply-open-graph.mjs)`); process.exit(1); }
  console.log('open graph: every page uses images/og-lawdb.jpg and a website/article type');
} else console.log(`open graph: ${changed} page(s) updated`);
