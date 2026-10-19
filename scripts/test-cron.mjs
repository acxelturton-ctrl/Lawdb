// Every cron trigger in wrangler.jsonc must have its own branch in the Worker's scheduled() handler. A schedule the handler does not
// recognise falls through to the nightly job, which would then run on that schedule (this happened when the blog finder moved from every
// 15 minutes to every 5 and only the config was changed).
import { readFileSync } from 'node:fs';

const config = readFileSync('wrangler.jsonc', 'utf8');
const crons = JSON.parse('[' + (config.match(/"crons":\s*\[([^\]]*)\]/) || [, ''])[1] + ']');
const worker = readFileSync('src/worker.js', 'utf8');
const handled = [...worker.matchAll(/event\.cron === '([^']+)'/g)].map((m) => m[1]);
let failed = 0;
for (const c of crons) {
  const nightly = c === '17 7 * * *'; // the default branch
  if (!nightly && !handled.includes(c)) { failed++; console.error(`FAIL  the cron "${c}" in wrangler.jsonc has no branch in src/worker.js (it would run the nightly job)`); }
}
for (const h of handled) if (!crons.includes(h)) { failed++; console.error(`FAIL  src/worker.js handles "${h}" but wrangler.jsonc does not schedule it`); }
if (failed) process.exit(1);
console.log(`cron schedules match the handler: ${crons.length} schedules`);
