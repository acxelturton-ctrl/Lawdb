// Counting without hammering the database.
//
// Every page view and click is "add one to a counter". Written one by one that is several database writes per visitor, which is fine for a few
// thousand visitors a day and would not be for thousands of firms' worth. So the counts are gathered in memory for a few seconds and written together:
// a burst of 500 views of the same page becomes ONE add-500 per counter, and the rows go in as multi-row statements. At low traffic nothing changes
// (each message simply waits a few seconds, kept alive by waitUntil); the more traffic, the bigger the saving.
//
// Nothing about a person is in here, only counter names and numbers. If a worker is stopped before it writes, those few seconds of counts are lost,
// which is acceptable for statistics (the platform keeps a worker alive for waitUntil work, so this is rare).

export const FLUSH_MS = 4000;
const ROWS_PER_STATEMENT = 20; // 5 values per row; the database accepts 100 values in one statement
const MAX_PENDING = 20000;     // a runaway burst is dropped, never allowed to grow without limit
const SEP = '\u0001';

let site = new Map();  // "day,kind,k1,k2" -> n
let firms = new Map(); // "slug,day,metric,k" -> n
let armed = false;

export const pendingCounts = () => site.size + firms.size;
const add = (map, key, n = 1) => map.set(key, (map.get(key) || 0) + n);

// Which firm addresses exist, remembered for a few minutes so a flush rarely needs to ask.
const known = new Map(); // slug -> { ok, until }
async function existing(env, slugs) {
  const now = Date.now();
  const ask = slugs.filter((s) => !(known.get(s)?.until > now));
  for (let i = 0; i < ask.length; i += 50) {
    const chunk = ask.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT slug FROM firms WHERE slug IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    const found = new Set(results.map((r) => r.slug));
    for (const s of chunk) known.set(s, { ok: found.has(s), until: now + (found.has(s) ? 10 * 60000 : 60000) });
  }
  if (known.size > 5000) for (const [k, v] of known) if (v.until < now) known.delete(k);
  return new Set(slugs.filter((s) => known.get(s)?.ok));
}

const chunks = (rows) => { const out = []; for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) out.push(rows.slice(i, i + ROWS_PER_STATEMENT)); return out; };

// Writes everything gathered so far. Safe to call at any time, from anywhere.
export async function flush(env) {
  armed = false;
  if (!site.size && !firms.size) return 0;
  const siteRows = [...site].map(([k, n]) => [...k.split(SEP), n]);
  const firmRows = [...firms].map(([k, n]) => [...k.split(SEP), n]);
  site = new Map();
  firms = new Map();
  try {
    const slugs = [...new Set(firmRows.map((r) => r[0]))];
    const live = slugs.length ? await existing(env, slugs) : new Set();
    const statements = [];
    for (const part of chunks(siteRows)) {
      statements.push(env.DB.prepare(`INSERT INTO stats_daily (day, kind, k1, k2, n) VALUES ${part.map(() => '(?,?,?,?,?)').join(',')} ON CONFLICT (day, kind, k1, k2) DO UPDATE SET n = n + excluded.n`).bind(...part.flat()));
    }
    for (const part of chunks(firmRows.filter((r) => live.has(r[0])))) {
      statements.push(env.DB.prepare(`INSERT INTO firm_stats_daily (firm_slug, day, metric, k, n) VALUES ${part.map(() => '(?,?,?,?,?)').join(',')} ON CONFLICT (firm_slug, day, metric, k) DO UPDATE SET n = n + excluded.n`).bind(...part.flat()));
    }
    if (statements.length) await env.DB.batch(statements);
    return siteRows.length + firmRows.length;
  } catch (err) {
    // A firm whose address has just changed can still be in this server's list of known firms for a few minutes, and its rows are refused. Forget the list and keep
    // the site-wide counts of the same batch (the few per-firm counts of that moment are lost).
    console.error('stats write failed', err);
    known.clear();
    try {
      const only = [];
      for (const part of chunks(siteRows)) only.push(env.DB.prepare(`INSERT INTO stats_daily (day, kind, k1, k2, n) VALUES ${part.map(() => '(?,?,?,?,?)').join(',')} ON CONFLICT (day, kind, k1, k2) DO UPDATE SET n = n + excluded.n`).bind(...part.flat()));
      if (only.length) await env.DB.batch(only);
      return siteRows.length;
    } catch (err2) { console.error('stats write failed again', err2); return 0; }
  }
}

// One message's counters. site: [[kind, k1, k2], ...] and firm: [[slug, metric, k], ...] (see stats.js).
// When running locally for tests (DEV_ECHO_LINK) or with STATS_FLUSH_MS=0 the counts are written straight away, so a test can read them at once.
export function countInBackground(env, exec, day, siteIncs, firmIncs = []) {
  if (pendingCounts() > MAX_PENDING) return;
  for (const [kind, k1, k2] of siteIncs || []) add(site, [day, kind, k1, k2].join(SEP));
  for (const [slug, metric, k] of firmIncs) add(firms, [slug, day, metric, k].join(SEP));
  const wait = env.DEV_ECHO_LINK === '1' ? 0 : Number.isFinite(Number(env.STATS_FLUSH_MS)) && env.STATS_FLUSH_MS !== undefined && env.STATS_FLUSH_MS !== '' ? Number(env.STATS_FLUSH_MS) : FLUSH_MS;
  if (wait <= 0) return exec(flush(env));
  if (armed) return;
  armed = true;
  exec(new Promise((resolve) => setTimeout(resolve, wait)).then(() => flush(env)));
}
