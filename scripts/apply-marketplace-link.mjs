// The "Lead Marketplace" link in the footer's For Law Firms column, on every page (it sits under Get Featured), so a firm can find the Marketplace
// page (marketplace.html) from anywhere. Pages that are drawn from a template (case-page.shell.html, and through extract-firm-template.mjs the firm
// pages the Worker draws) get it from the template; this script fixes the saved pages and the template, and `--check` fails if one lacks it.
//   node scripts/apply-marketplace-link.mjs          adds what is missing
//   node scripts/apply-marketplace-link.mjs --check  fails if a page lacks it (a new page copied from an old template)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHECK = process.argv.includes('--check');
const AFTER = '<li><a href="/list-your-firm?plan=featured">Get Featured</a></li>';
const LINK = '<li><a href="/marketplace">Lead Marketplace</a></li>';

function pagesIn(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.wrangler', 'images', 'scripts', 'src', 'data', 'db', 'docs', 'migrations'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pagesIn(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const stale = [];
for (const file of [...pagesIn('.'), 'scripts/case-page.shell.html']) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('class="site-footer"') || !html.includes(AFTER)) continue; // not a page with the standard footer
  if (html.includes(LINK)) continue;
  stale.push(file);
  if (!CHECK) writeFileSync(file, html.replace(AFTER, () => `${AFTER}\n        ${LINK}`));
}

if (CHECK) {
  if (stale.length) { console.error(`the footer has no Lead Marketplace link on ${stale.length} page(s), e.g. ${stale.slice(0, 3).join(', ')} (run: node scripts/apply-marketplace-link.mjs)`); process.exit(1); }
  console.log('every page has the Lead Marketplace footer link');
} else console.log(`Lead Marketplace footer link added to ${stale.length} page(s)`);
