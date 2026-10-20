// Records which pull requests have gone live, for the daily journal (ship_log table, read by src/lib/journal.js).
//   node scripts/record-deploy.mjs             at deploy time (npm run deploy:ci): adds the merged pull requests in the recent git history to the live database
//   node scripts/record-deploy.mjs --history   prints SQL for the whole git history (this is how db/ship-history.sql was made, for days before the first recorded deploy)
// A pull request is one row, keyed by its number, so running this on every deploy is harmless. It must never stop a deploy, so every failure ends in exit 0.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const torontoDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
const humanise = (branch) => { const w = branch.split('/').pop().replace(/[-_]+/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : 'Update'; };

// `git log --merges --format=%H%x1f%cI%x1f%B%x1e` -> [{ pr, day, at, title }]. GitHub's merge commits read "Merge pull request #N from owner/branch" and then the pull request's title.
export function parseMerges(text) {
  const rows = [];
  for (const rec of String(text).split('\x1e')) {
    const [, iso, body = ''] = rec.trim().split('\x1f');
    if (!iso) continue;
    const lines = body.split('\n').map((l) => l.trim());
    const m = /^Merge pull request #(\d+) from (\S+)/.exec(lines[0] || '');
    const when = new Date(iso);
    if (!m || Number.isNaN(when.getTime())) continue;
    const title = clean(lines.slice(1).find((l) => l) || humanise(m[2]));
    rows.push({ pr: Number(m[1]), day: torontoDay(when), at: when.toISOString().slice(0, 19).replace('T', ' '), title });
  }
  return rows;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const toSql = (rows) => rows.map((r) => `INSERT OR IGNORE INTO ship_log (pr, day, at, title) VALUES (${r.pr}, ${q(r.day)}, ${q(r.at)}, ${q(r.title)});`).join('\n') + (rows.length ? '\n' : '');

function gitMerges(limit) {
  return execFileSync('git', ['log', '--merges', ...(limit ? ['-n', String(limit)] : []), '--format=%H%x1f%cI%x1f%B%x1e'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--history')) {
      const rows = parseMerges(gitMerges(0)).sort((a, b) => a.pr - b.pr);
      process.stdout.write(`-- Pull requests merged before the deploy hook existed (made by: node scripts/record-deploy.mjs --history). Safe to load again: each is keyed by its number.\n${toSql(rows)}`);
    } else {
      const rows = parseMerges(gitMerges(80));
      if (!rows.length) console.log('record-deploy: no merged pull requests in this checkout, nothing to record');
      else {
        const dir = mkdtempSync(join(tmpdir(), 'lawdb-ship-'));
        const file = join(dir, 'ship.sql');
        writeFileSync(file, toSql(rows));
        try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '--file', file], { stdio: 'inherit' }); console.log(`record-deploy: ${rows.length} merged pull request(s) noted for the journal`); }
        finally { rmSync(dir, { recursive: true, force: true }); }
      }
    }
  } catch (err) {
    console.error('record-deploy: skipped (the journal will simply miss this one):', String(err.message || err).slice(0, 200));
  }
  process.exit(0);
}
