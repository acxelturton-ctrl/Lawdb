// The firms the baked pages (city hubs, city case-type pages, the home page's city directory) are built from:
//   - firms_data.json plus the released data/firms-batch-N.json files (the firms LawDB added itself), and
//   - data/owner-firms.json: firms that listed THEMSELVES on LawDB. They exist only in the database, so without this file no baked page
//     would ever mention them (scripts/sync-owner-firms.mjs refreshes the file from the live directory).
// One loader for every script that counts or lists firms, so a page and the number next to it can never disagree.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadHandles } from './firm-handles.mjs';

export const OWNER_FILE = 'data/owner-firms.json';

export function loadRepoFirms() {
  const all = JSON.parse(readFileSync('firms_data.json', 'utf8'));
  const released = new Set(JSON.parse(readFileSync('data/release.json', 'utf8')).released);
  for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f)).sort()) {
    if (released.has(Number(file.match(/\d+/)[0]))) all.push(...JSON.parse(readFileSync(`data/${file}`, 'utf8')));
  }
  return all;
}

export function loadOwnerFirms() {
  return existsSync(OWNER_FILE) ? JSON.parse(readFileSync(OWNER_FILE, 'utf8')) : [];
}

// A firm that is in both (a batch released later than the firm listed itself) is counted once, from the repository's record.
export function loadSiteFirms() {
  const all = loadRepoFirms();
  const seen = new Set(all.map((f) => f.slug));
  for (const f of loadOwnerFirms()) if (!seen.has(f.slug)) { seen.add(f.slug); all.push(f); }
  // each firm carries its public address handle (data/firm-handles.json), so a page links to /firm/<handle> (src/lib/firm-handle.js firmPath)
  const handles = loadHandles();
  return all.map((f) => (handles[f.slug] ? { ...f, handle: handles[f.slug] } : f));
}

export const rated = (f) => Number(f.rating) > 0;
