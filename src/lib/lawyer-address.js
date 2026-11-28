// A lawyer's own page lives at lawdb.ca/<name> (no /lawyer/ and no firm in front; like a firm's page, letters and digits only): lawdb.ca/tatianagulyaeva. Only a Featured lawyer at a
// Featured firm has one (src/lib/lawyers.js, lawyerHasPage), so the list is short and is read from the Featured firms alone. Firms and lawyers share one namespace
// (src/lib/firm-handle.js), so the name is the lawyer's own slug without its dashes, and when it is a word the site uses, another firm's handle or another Featured lawyer's name,
// the second one gets 2, 3 on the end (the Featured firms are read in A-Z order of slug).
import { lawyersOf, lawyerHasPage } from './lawyers.js';
import { isFree } from './firm-handle.js';

const addressOf = (slug) => slug.replace(/-/g, '');

// { byAddr: Map<address, { firm: slug, lawyer: lawyer slug }>, byFirm: Map<firm slug, { <lawyer slug>: address }> }
export async function lawyerDirectory(env) {
  const { results } = await env.DB.prepare("SELECT slug, handle, data FROM firms WHERE status = 'live' AND featured = 1 ORDER BY slug").all();
  const wanted = [];
  for (const r of results) {
    let firm;
    try { firm = { ...JSON.parse(r.data), featured: true }; } catch { continue; }
    for (const l of lawyersOf(firm)) if (lawyerHasPage(l)) wanted.push({ firm: r.slug, lawyer: l.slug, base: addressOf(l.slug) });
  }
  const byAddr = new Map();
  const byFirm = new Map();
  if (!wanted.length) return { byAddr, byFirm };
  // the addresses (and 2 ... 9 on the end of each) that a firm already has
  const variants = [...new Set(wanted.flatMap((w) => [w.base, ...Array.from({ length: 8 }, (_, i) => `${w.base}${i + 2}`)]))];
  const firmHas = new Set();
  for (let i = 0; i < variants.length; i += 90) {
    const part = variants.slice(i, i + 90);
    for (const row of (await env.DB.prepare(`SELECT handle FROM firms WHERE handle IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results) firmHas.add(row.handle);
  }
  for (const w of wanted) {
    let addr = w.base;
    for (let n = 2; !isFree(addr) || firmHas.has(addr) || byAddr.has(addr); n++) addr = `${w.base}${n}`;
    byAddr.set(addr, { firm: w.firm, lawyer: w.lawyer });
    if (!byFirm.has(w.firm)) byFirm.set(w.firm, {});
    byFirm.get(w.firm)[w.lawyer] = addr;
  }
  return { byAddr, byFirm };
}
