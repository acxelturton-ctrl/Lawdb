// A firm's public address handle (lawdb.ca/firm/<handle>): the slug without the city on the end ("lawpoint-north-york" -> "lawpoint"). The rule itself is in src/lib/firm-handle.js
// (the Worker uses it for a firm that lists itself later). data/firm-handles.json holds every firm's handle ({ <slug>: <handle> }); once a firm has one it never changes here (an
// admin changes it on purpose), so an address that was shared or indexed keeps working. Two firms that would get the same handle (the same firm's offices in two cities, or two
// firms with the same name): the one whose slug is already the handle keeps it, then the one with more Google reviews, then the slug in A-Z order; the others get -2, -3 (never a city).
import { readFileSync, existsSync } from 'node:fs';
import { HANDLE_RE, slugify, candidateHandle } from '../../src/lib/firm-handle.js';

export const HANDLES_FILE = new URL('../../data/firm-handles.json', import.meta.url);
export const RENAMES_FILE = new URL('../../data/firm-renames.json', import.meta.url);
export { HANDLE_RE, slugify, candidateHandle };

export function loadHandles() {
  return existsSync(HANDLES_FILE) ? JSON.parse(readFileSync(HANDLES_FILE, 'utf8')) : {};
}

// firms: [{ slug, city, count? }]. existing: the handles already given. Returns the handles for the firms that have none yet.
export function assignHandles(firms, existing = {}) {
  const taken = new Set(Object.values(existing));
  const fresh = firms.filter((f) => !existing[f.slug]);
  const cand = new Map(fresh.map((f) => [f.slug, candidateHandle(f.slug, f.city)]));
  const order = [...fresh].sort((a, b) => (cand.get(b.slug) === b.slug) - (cand.get(a.slug) === a.slug) || (Number(b.count) || 0) - (Number(a.count) || 0) || a.slug.localeCompare(b.slug));
  const out = {};
  // pass 1: the firm that comes first for a handle gets it, if no earlier firm has it, so a numbered handle never takes another firm's clean one
  for (const f of order) {
    const h = cand.get(f.slug);
    if (!taken.has(h)) { taken.add(h); out[f.slug] = h; }
  }
  // pass 2: the others get -2, -3 ... (never a city)
  for (const f of order) {
    if (out[f.slug]) continue;
    const h = cand.get(f.slug);
    for (let n = 2; ; n++) { const alt = `${h}-${n}`; if (!taken.has(alt)) { taken.add(alt); out[f.slug] = alt; break; } }
  }
  return out;
}
