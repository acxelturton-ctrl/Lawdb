// A lawyer's own page lives at /lawyer/<name> (not under the firm): lawdb.ca/lawyer/tatiana-gulyaeva. Only a Featured lawyer at a Featured firm has one (src/lib/lawyers.js,
// lawyerHasPage), so the list is short and is read from the Featured firms alone. The name part is the lawyer's own slug; when two Featured lawyers anywhere share a name the
// second one (firms in A-Z order of their slug) gets -2, -3. A lawyer's page keeps one address as long as the same Featured lawyers exist.
import { lawyersOf, lawyerHasPage } from './lawyers.js';

// { byAddr: Map<address, { firm: slug, lawyer: lawyer slug }>, byFirm: Map<firm slug, { <lawyer slug>: address }> }
export async function lawyerDirectory(env) {
  const { results } = await env.DB.prepare("SELECT slug, handle, data FROM firms WHERE status = 'live' AND featured = 1 ORDER BY slug").all();
  const byAddr = new Map();
  const byFirm = new Map();
  for (const r of results) {
    let firm;
    try { firm = { ...JSON.parse(r.data), featured: true }; } catch { continue; }
    for (const l of lawyersOf(firm)) {
      if (!lawyerHasPage(l)) continue;
      let addr = l.slug;
      for (let n = 2; byAddr.has(addr); n++) addr = `${l.slug}-${n}`;
      byAddr.set(addr, { firm: r.slug, lawyer: l.slug });
      if (!byFirm.has(r.slug)) byFirm.set(r.slug, {});
      byFirm.get(r.slug)[l.slug] = addr;
    }
  }
  return { byAddr, byFirm };
}
