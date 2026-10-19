// The migrations that move hand-built firm pages to the database page (migrations/*flip_originals*): every firm in them must be a
// real original firm with a hand-built file to fall back on, none may be one of the hand-built pages that must stay (data/keep-handbuilt.json),
// and no firm may appear twice.
import { readFileSync, readdirSync, existsSync } from 'node:fs';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };
const originals = new Set(JSON.parse(readFileSync('firms_data.json', 'utf8')).map((f) => f.slug));
const keep = new Set(JSON.parse(readFileSync('data/keep-handbuilt.json', 'utf8')).slugs);
ok(keep.size > 0 && [...keep].every((s) => originals.has(s)), 'the hand-built list names real original firms');
const seen = new Set();
let total = 0;
for (const f of readdirSync('migrations').filter((x) => /flip_originals/.test(x)).sort()) {
  const slugs = [...readFileSync(`migrations/${f}`, 'utf8').matchAll(/^\s+'([a-z0-9-]+)',?$/gm)].map((m) => m[1]);
  ok(slugs.length > 0, `${f} lists firms`);
  for (const s of slugs) {
    ok(originals.has(s), `${f}: ${s} is an original firm`);
    ok(existsSync(`firms/${s}.html`), `${f}: ${s} has a hand-built page to fall back on`);
    ok(!keep.has(s), `${f}: ${s} must stay hand-built`);
    ok(!seen.has(s), `${f}: ${s} is moved only once`);
    seen.add(s);
  }
  total += slugs.length;
}
if (failed) process.exit(1);
console.log(`page moves checked: ${total} firms`);
