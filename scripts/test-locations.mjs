// Office pages (src/lib/locations.js): one Featured plan for a firm with several offices. What the data link looks like, and that every place that
// changes Featured, moves a firm's address, merges firms, takes payments or describes Featured knows about it. The behaviour end to end is in scripts/smoke.mjs.
//   node scripts/test-locations.mjs
import { readFileSync } from 'node:fs';
import { MAX_LOCATIONS } from '../src/lib/locations.js';
import { FEATURED } from './apply-plan-table.mjs';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };
const read = (p) => readFileSync(p, 'utf8');

const mig = read('migrations/0043_firm_locations.sql');
ok(/CREATE TABLE firm_locations/.test(mig) && /location_slug TEXT PRIMARY KEY REFERENCES firms \(slug\) ON DELETE CASCADE/.test(mig) && /main_slug\s+TEXT NOT NULL REFERENCES firms \(slug\) ON DELETE CASCADE/.test(mig) && /CHECK \(location_slug <> main_slug\)/.test(mig),
  'an office page is in the table once, belongs to one main listing, and cannot be its own main listing');
ok(MAX_LOCATIONS === 5, 'a firm can have five office pages from the owner side (the admin can link more by hand)');

const lib = read('src/lib/locations.js');
ok(/export async function syncLocationFeatured/.test(lib) && /export async function linkLocation/.test(lib) && /export async function unlinkLocation/.test(lib), 'the library has sync, link and unlink');
ok(/is itself an office of/.test(lib) && /has office pages of its own/.test(lib) && /own paid Featured plan/.test(lib) && /own free month/.test(lib), 'linking refuses nesting, a listing with its own plan, and one in its own free month');

// every place that writes Featured also moves the office pages, or refuses for an office page
const stripe = read('src/lib/stripe.js');
ok(/if \(await mainOf\(env, slug\)\) return false;/.test(stripe) && /await syncLocationFeatured\(env, slug, actor, why\)/.test(stripe), 'subscriptions, the free month and cancellations (setFeatured) move every office page, and never set an office page by itself');
ok(/ofMain\.slug; \/\/ paid from an office page/.test(stripe) && /const target = \(await mainOf\(env, String\(slug/.test(stripe), 'a payment made from or assigned to an office page is credited to the main listing');
ok(/includedWith: \{ slug: ofMain\.slug/.test(stripe), "an office page's plan card says it is included with the main listing");
const edit = read('src/lib/firm-edit.js');
ok(/Featured follows \$\{ofMain\.name\}/.test(edit) && /await syncLocationFeatured\(env, slug, actor, 'changed by hand'\)/.test(edit), "the admin's Featured switch moves the office pages, and is refused on an office page");
ok(/const ofMain = await mainOf\(env, slug\);\s*\n\s*if \(ofMain\) throw new HttpError\(409/.test(read('src/lib/trial.js')), 'an office page cannot start a free month of its own');

// the links move with a firm's address, a firm with office pages is not merged away, and the table is in the nightly backup
const slug = read('src/lib/firm-slug.js');
ok(/UPDATE firm_locations SET location_slug = \? WHERE location_slug = \?/.test(slug) && /UPDATE firm_locations SET main_slug = \? WHERE main_slug = \?/.test(slug), 'changing a firm\'s address keeps its office pages linked');
ok(/FROM firm_locations WHERE main_slug = \?/.test(read('src/lib/firm-merge.js')), 'a firm with office pages is not merged away');
ok(/firm_locations: 'SELECT/.test(read('src/lib/backup.js')), 'the links are in the nightly backup');

// the routes
const worker = read('src/worker.js'), admin = read('src/routes/admin.js'), account = read('src/routes/account.js');
ok(/route\('PUT', '\/api\/admin\/firms\/:slug\/location', admin\.firmLocationLink\)/.test(worker) && /route\('DELETE', '\/api\/admin\/firms\/:slug\/location', admin\.firmLocationUnlink\)/.test(worker)
  && /export async function firmLocationLink[\s\S]*?requireAdmin/.test(admin) && /export async function firmLocationUnlink[\s\S]*?requireAdmin/.test(admin), 'linking and unlinking are admin only');
ok(/route\('GET', '\/api\/account\/firms\/:slug\/locations', account\.locationsGet\)/.test(worker) && /route\('POST', '\/api\/account\/firms\/:slug\/locations', account\.locationAdd\)/.test(worker)
  && /export async function locationAdd[\s\S]*?requireOwner/.test(account) && /A page for every office is included with Featured/.test(account), 'an owner can list and add office pages, and only on a Featured firm');
ok(/status: 'pending', createdBy: user\.id/.test(account.slice(account.indexOf('export async function locationAdd'))) , 'a new office page waits for approval like any new listing');

// the pages and the screens
ok(/function locationsHtml/.test(read('src/render/firm-page.js')) && /locations: await siblingsOf/.test(read('src/routes/firm-page.js')), "each page links to the firm's other pages");
const editor = read('admin/profile-editor.js');
ok(/function locationControl/.test(editor) && /function locationsPanel/.test(editor) && /\/location`/.test(editor), 'the admin editor and the owner editor have the controls');
ok(/mainSlug/.test(read('admin/admin.js')), 'Approvals says which firm a new office page belongs to');

// what Featured is said to include is in step everywhere
ok(FEATURED.groups.some(([, rows]) => rows.some(([t]) => /page for every office/i.test(t))), 'the Free or Featured table lists a page for every office as a Featured feature');
ok(/page for every office/i.test(read('admin/ui.js')) && /page for every office/i.test(read('src/lib/email.js')) && /Offices in several cities/.test(read('how-it-works.html')), "the plan card, the Featured email and How it works say so too");

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\noffice page checks passed');
