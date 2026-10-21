// The Outreach desk: its rules (stages, days, link tidying, the LinkedIn welcome post) and that it is wired in everywhere (table, routes, admin tab, nightly backup).
// The desk working end to end (add, edit, due first, delete, who may use it) is in smoke.mjs.
import { readFileSync } from 'node:fs';
import { STAGES, CHANNELS, STAGE_KEYS, CHANNEL_KEYS, isDay, addDays, cleanLink, welcomePost } from '../src/lib/outreach.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

ok(JSON.stringify(STAGE_KEYS) === '["connected","messaged","replied","call","agreed","not-now"]' && JSON.stringify(CHANNEL_KEYS) === '["linkedin","phone","email","in-person","other"]' && STAGES.every(([, label]) => label) && CHANNELS.every(([, label]) => label), 'the stages run from Connected to Not now and the channels are LinkedIn, phone, email, in person, other');

// days
ok(isDay('2026-10-21') && isDay('2028-02-29') && !isDay('2026-02-29') && !isDay('2026-13-01') && !isDay('2026-10-32') && !isDay('26-10-21') && !isDay('2026-10-21T10:00') && !isDay(20261021) && !isDay(null), 'only a real calendar day is accepted as a follow-up date');
ok(addDays('2026-10-21', 7) === '2026-10-28' && addDays('2026-10-28', 7) === '2026-11-04' && addDays('2026-12-28', 7) === '2027-01-04' && addDays('2028-02-25', 7) === '2028-03-03' && addDays('2026-03-08', 1) === '2026-03-09' && addDays('2026-11-01', -1) === '2026-10-31', 'adding days crosses month ends, year ends, leap days and clock changes correctly');

// links
ok(cleanLink('https://www.linkedin.com/in/lawdb?utm_source=share_via&utm_content=profile&utm_medium=member_ios') === 'https://www.linkedin.com/in/lawdb' && cleanLink(' https://www.linkedin.com/company/qbl/ ') === 'https://www.linkedin.com/company/qbl/', 'a LinkedIn share link becomes the plain profile address');
ok(['http://x.com/a', 'javascript:alert(1)', 'https://user:pw@x.com/', 'linkedin.com/in/x', '', null, 5].every((v) => cleanLink(v) === ''), 'anything that is not an https address is dropped');

// the LinkedIn post
const post = welcomePost({ name: 'Quantum Business Law', city: 'Markham', province: 'ON', tags: ['Business Law', 'Wills & Estates', 'Civil Litigation'], slug: 'quantum-business-law-markham', origin: 'https://lawdb.ca' });
ok(post === 'Welcome to LawDB, Quantum Business Law! \u{1F389}\n\nTheir profile is now live on Canada\'s legal directory: Business Law and Wills & Estates in Markham, Ontario.\n\nSee their profile: https://lawdb.ca/firms/quantum-business-law-markham', 'the welcome post names the firm, its first two practice areas and where it is, and links its page');
ok(welcomePost({ name: 'A Law', city: 'Surrey', province: 'BC', tags: [], slug: 'a-law-surrey', origin: 'https://lawdb.ca' }).includes('law firm in Surrey, British Columbia.') && welcomePost({ name: 'B Law', city: '', province: '', tags: null, slug: 'b', origin: 'https://lawdb.ca' }).includes('directory: law firm.'), 'a firm with no practice areas or no place still gets a sensible post');
ok(!/best|top|leading|specialist|expert|guarantee/i.test(post), 'the post makes no claims about the firm that law societies restrict');

// wired in everywhere
const mig = read('migrations/0031_outreach.sql');
ok(/CREATE TABLE outreach/.test(mig) && STAGE_KEYS.every((k) => mig.includes(`'${k}'`)) && CHANNEL_KEYS.every((k) => mig.includes(`'${k}'`)) && /UPDATE projects SET status = 'doing'/.test(mig), 'the migration creates the table with the same stages and channels, and moves the outreach idea to In progress on the projects page');
const worker = read('src/worker.js');
ok(/'GET', '\/api\/admin\/outreach'/.test(worker) && /'POST', '\/api\/admin\/outreach'/.test(worker) && /'PATCH', '\/api\/admin\/outreach\/:id'/.test(worker) && /'DELETE', '\/api\/admin\/outreach\/:id'/.test(worker), 'the four Outreach routes are registered');
const route = read('src/routes/outreach.js');
ok((route.match(/await requireAdmin\(env, request\)/g) || []).length === 4, 'every Outreach route checks for an admin first');
ok(/outreach: 'SELECT \* FROM outreach/.test(read('src/lib/backup.js')), 'the desk is part of the nightly backup');
ok(read('admin/admin.js').includes("['outreach', 'Outreach']") && /outreach: viewOutreach/.test(read('admin/admin.js')), 'the admin area has the Outreach tab');
ok(!/innerHTML/.test(read('admin/admin.js').slice(read('admin/admin.js').indexOf('async function viewOutreach'), read('admin/admin.js').indexOf('async function viewProjects'))), 'the Outreach tab never builds markup from what was typed');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\noutreach desk checks passed');
