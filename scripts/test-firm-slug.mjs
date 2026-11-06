// Changing a firm's page address (src/lib/firm-slug.js): what an address may look like, that every table holding a firm's slug is moved, and the wiring.
//   node scripts/test-firm-slug.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { cleanSlug, SLUG_TABLES, SLUG_MIN, SLUG_MAX } from '../src/lib/firm-slug.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };
const refused = (v) => { try { cleanSlug(v); return false; } catch (e) { return e && e.status === 422; } };

ok(cleanSlug('preszlerinjurylawyers') === 'preszlerinjurylawyers' && cleanSlug('preszler-injury-lawyers-toronto') === 'preszler-injury-lawyers-toronto' && cleanSlug('  Mixed-Case-1  ') === 'mixed-case-1' && cleanSlug('a1b') === 'a1b', 'addresses of letters, digits and single dashes are fine (tidied to lowercase)');
ok(cleanSlug('x'.repeat(SLUG_MAX)).length === SLUG_MAX && refused('x'.repeat(SLUG_MAX + 1)) && refused('x'.repeat(SLUG_MIN - 1)) && refused(''), `an address is ${SLUG_MIN} to ${SLUG_MAX} characters`);
ok(['Has Space', 'under_score', '-lead', 'trail-', 'double--dash', 'a/b', '../x', 'café-law', 'dot.dot', 'a?b', '<b>x</b>'].every(refused) && [null, undefined, 42, {}, []].every(refused), 'spaces, underscores, edge or double dashes, slashes, accents, dots, markup and non-text are refused');

// every table with a firm_slug column is in the list (a table added in a later migration cannot be forgotten)
const found = new Set();
for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql'))) {
  const sql = readFileSync(`migrations/${f}`, 'utf8');
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\)[^;\n]*;/g)) if (/\bfirm_slug\b/.test(m[2])) found.add(m[1]);
  for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN firm_slug\b/g)) found.add(m[1]);
}
const missing = [...found].filter((t) => !SLUG_TABLES.includes(t)), extra = SLUG_TABLES.filter((t) => !found.has(t));
ok(missing.length === 0, `every table that stores a firm's slug is moved with it${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ` (${found.size} tables)`}`);
ok(extra.length === 0 && new Set(SLUG_TABLES).size === SLUG_TABLES.length, `the list names no table that does not exist, and none twice${extra.length ? ' (unknown: ' + extra.join(', ') + ')' : ''}`);

// the wiring
const read = (p) => readFileSync(p, 'utf8');
ok(/route\('PUT', '\/api\/admin\/firms\/:slug\/slug', admin\.firmRename\)/.test(read('src/worker.js')) && /export async function firmRename[\s\S]*?requireAdmin/.test(read('src/routes/admin.js')), 'the route is registered and admin only');
ok(/redirectTarget\(env, m\[1\]\)[\s\S]*?status: 301/.test(read('src/routes/firm-page.js')) && /redirectTarget\(env, ref\.firmSlug\)/.test(read('src/routes/story-page.js')), "an old address redirects, for the firm's page and for its stories (a 301, before the saved copy is served)");
ok(/firm_redirects: 'SELECT/.test(read('src/lib/backup.js')) && /PRAGMA defer_foreign_keys = on/.test(read('src/lib/firm-slug.js')) && /json_set\(data, '\$\.slug'/.test(read('src/lib/firm-slug.js')), 'the redirects are backed up, the move is one batch with foreign keys checked at the end, and the address inside the firm record is updated');
ok(/'\/api\/admin\/firms\/\$\{slug\}\/slug'|\/slug`/.test(read('admin/profile-editor.js')) && /Change the page address/.test(read('admin/profile-editor.js')), 'the admin Edit Profile page has the control');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nfirm address checks passed');
