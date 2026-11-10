// Copies the firms that listed THEMSELVES on LawDB (they live only in the database) into data/owner-firms.json, so the baked city hubs and
// city case-type pages can list them and count them (see scripts/lib/site-firms.mjs). Run it before refreshing the pages:
//   node scripts/sync-owner-firms.mjs                    reads https://lawdb.ca/firms_data.json (the live directory)
//   node scripts/sync-owner-firms.mjs --from file.json   reads a saved copy of that list instead
//   node scripts/sync-owner-firms.mjs --check            checks the committed file (shape, no duplicates, every firm's city has a page); offline
// Only firms in a city that has a hub page are kept: that is where a baked page can mention them. The pages themselves also load the live
// list in the browser (city-pages.js), so a firm that listed itself an hour ago shows up before this file is refreshed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadRepoFirms, loadOwnerFirms, OWNER_FILE } from './lib/site-firms.mjs';

const CHECK = process.argv.includes('--check');
const FROM = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
const URL_LIVE = process.env.LIVE_FIRMS_URL || 'https://lawdb.ca/firms_data.json';
const DIRS = { ON: 'ontario', QC: 'quebec', BC: 'british-columbia', AB: 'alberta', MB: 'manitoba' };
const FIELDS = ['slug', 'name', 'city', 'province', 'region', 'address', 'phone', 'rating', 'count', 'caseTypes', 'tags', 'featured', 'website'];

export const slugOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const hasHub = (f) => !!DIRS[f.province] && existsSync(`${DIRS[f.province]}/${slugOf(f.city || '')}/index.html`);
const slim = (f) => Object.fromEntries(FIELDS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

if (CHECK) {
  const repo = new Set(loadRepoFirms().map((f) => f.slug));
  const owner = loadOwnerFirms();
  const seen = new Set();
  const bad = [];
  for (const f of owner) {
    if (!f.slug || !f.name || !f.city || !f.province) bad.push(`${f.slug || '(no slug)'}: slug, name, city and province are required`);
    else if (seen.has(f.slug)) bad.push(`${f.slug}: listed twice`);
    else if (!hasHub(f)) bad.push(`${f.slug}: no city page for ${f.city}, ${f.province}`);
    if (!Array.isArray(f.caseTypes)) bad.push(`${f.slug}: caseTypes must be a list`);
    seen.add(f.slug);
  }
  const dup = owner.filter((f) => repo.has(f.slug)).length;
  if (bad.length) { for (const b of bad) console.error('owner firms:', b); process.exit(1); }
  console.log(`owner firms: ${owner.length} listed${dup ? ` (${dup} also in the repository data, counted once)` : ''}`);
  process.exit(0);
}

const live = FROM ? JSON.parse(readFileSync(FROM, 'utf8')) : await (await fetch(URL_LIVE)).json();
if (!Array.isArray(live) || live.length < 100) { console.error('the live list looks wrong (not a list of firms); nothing written'); process.exit(1); }
const repo = new Set(loadRepoFirms().map((f) => f.slug));
const mine = live.filter((f) => f.slug && !repo.has(f.slug) && hasHub(f)).map(slim).sort((a, b) => a.slug.localeCompare(b.slug));
const text = JSON.stringify(mine, null, 1) + '\n';
const before = existsSync(OWNER_FILE) ? readFileSync(OWNER_FILE, 'utf8') : '';
if (text === before) console.log(`owner firms: up to date (${mine.length})`);
else { writeFileSync(OWNER_FILE, text); console.log(`owner firms: ${mine.length} written to ${OWNER_FILE}`); }
