// Merging a duplicate listing into the one to keep (src/lib/firm-merge.js): what stops a merge, that every table holding a firm's slug is accounted for, and the wiring.
//   node scripts/test-firm-merge.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { mergeFirms, MERGE_MOVED, MERGE_DROPPED } from '../src/lib/firm-merge.js';
import { SLUG_TABLES } from '../src/lib/firm-slug.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };
const read = (p) => readFileSync(p, 'utf8');

// every table with a firm_slug column is either moved to the kept listing or deliberately dropped with the duplicate
const found = new Set();
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql'))) {
  const sql = read(`migrations/${f}`);
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\)[^;\n]*;/g)) if (/\bfirm_slug\b/.test(m[2])) found.add(m[1]);
  for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN firm_slug\b/g)) found.add(m[1]);
}
const handled = new Set([...MERGE_MOVED, ...MERGE_DROPPED]);
const missing = [...found].filter((t) => !handled.has(t)), extra = [...handled].filter((t) => !found.has(t));
ok(missing.length === 0, `every table that stores a firm's slug is moved or dropped on purpose${missing.length ? ' (not handled: ' + missing.join(', ') + ')' : ` (${found.size} tables)`}`);
ok(extra.length === 0 && handled.size === MERGE_MOVED.length + MERGE_DROPPED.length, `the lists name no table that does not exist, and none twice${extra.length ? ' (unknown: ' + extra.join(', ') + ')' : ''}`);
ok([...handled].sort().join() === [...SLUG_TABLES].sort().join(), 'the merge and the page-address change know the same tables');

// each moved table is actually moved by the code, and each dropped one is left to the delete
const src = read('src/lib/firm-merge.js');
const batchText = src.slice(src.indexOf('db.batch('));
ok(MERGE_MOVED.every((t) => new RegExp(`(?:UPDATE(?: OR IGNORE)? ${t} SET firm_slug|INSERT INTO ${t} )`).test(batchText)), 'every table listed as moved has a statement that moves it');
ok(MERGE_DROPPED.every((t) => !batchText.includes(t)) && /DELETE FROM firms WHERE slug = \?/.test(batchText), 'the dropped tables are cleared by deleting the duplicate (their foreign keys cascade)');

// a recording stand-in for the database
function fakeEnv({ firms = {}, subs = 0, pics = 0, owners = [] } = {}) {
  const log = [];
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => {
      if (/FROM firms WHERE slug/.test(sql)) return firms[args[0]] || null;
      if (/FROM firm_subscriptions/.test(sql)) return { n: subs };
      if (/FROM firm_images/.test(sql)) return { n: pics };
      return null;
    },
    all: async () => ({ results: owners.map((email) => ({ email })) }),
    run: async () => ({}),
    sql, args,
  });
  return { log, DB: { prepare: (sql) => stmt(sql), batch: async (list) => { log.push(...list.map((s) => ({ sql: s.sql, args: s.args }))); return []; } } };
}
const firms = { dup: { slug: 'dup', name: 'Preszler (Toronto)' }, keep: { slug: 'keep', name: 'Preszler Injury Lawyers', status: 'live' } };
const fail = async (env, from, into) => { try { await mergeFirms(env, { id: 1 }, from, into); return null; } catch (e) { return e.status || String(e); } };
ok(await fail(fakeEnv({ firms }), 'dup', 'dup') === 422, 'a listing cannot be merged into itself');
ok(await fail(fakeEnv({ firms }), 'nope', 'keep') === 404 && await fail(fakeEnv({ firms }), 'dup', 'nowhere') === 404, 'both listings must exist');
ok(await fail(fakeEnv({ firms }), 'dup', 'Bad Address!') === 422, 'the address to keep must be a valid address');
ok(await fail(fakeEnv({ firms, subs: 1 }), 'dup', 'keep') === 409, 'a listing with a paid Featured subscription is not merged away');
ok(await fail(fakeEnv({ firms, pics: 2 }), 'dup', 'keep') === 409, 'a listing with pictures is not merged away (their files would be left behind)');
const env = fakeEnv({ firms, owners: ['jeffrey@example.com'] });
const done = await mergeFirms(env, { id: 1 }, 'dup', 'keep');
ok(env.log.length > 8 && env.log[0].sql.includes('defer_foreign_keys') && env.log.every((s) => !/UPDATE (leads|firm_members)/.test(s.sql) || s.args.includes('keep')), 'a refused merge changes nothing, and an allowed one runs as one batch with foreign keys checked at the end');
ok(done.slug === 'keep' && done.from === 'dup' && done.owners.join() === 'jeffrey@example.com', 'it reports the kept listing and who to tell');
ok(env.log.some((s) => /INSERT OR REPLACE INTO firm_redirects/.test(s.sql) && s.args[0] === 'dup' && s.args[1] === 'keep'), "the duplicate's address redirects to the kept listing");

// the wiring
ok(/route\('POST', '\/api\/admin\/firms\/:slug\/merge', admin\.firmMerge\)/.test(read('src/worker.js')) && /export async function firmMerge[\s\S]*?requireAdmin/.test(read('src/routes/admin.js')), 'the route is registered and admin only');
ok(/Merge into another listing/.test(read('admin/profile-editor.js')) && /\/merge`/.test(read('admin/profile-editor.js')), 'the admin Edit Profile page has the control');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nfirm merge checks passed');
