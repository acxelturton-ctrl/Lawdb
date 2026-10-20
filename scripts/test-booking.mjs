// The "Book a call" button: which links are accepted, what the button looks like with and without one, what the owner and admin forms accept,
// and that the links loaded from firms' own websites are all clean. (The page itself, hand-built and database-built, is checked in smoke.mjs.)
import { readFileSync, readdirSync } from 'node:fs';
import { cleanBookingUrl } from '../src/lib/booking.js';
import { bookingRow } from '../src/render/booking.js';
import { FIRM_FIELDS } from '../src/lib/firm-edit.js';
import { EVENTS, eventIncs } from '../src/lib/stats.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- which links are accepted
ok(cleanBookingUrl('https://calendly.com/torys/30min') === 'https://calendly.com/torys/30min', 'a calendar link is kept as it is');
ok(cleanBookingUrl(' https://calendly.com/torys/30min?month=2023-02&back=1&utm_source=x&hide_event_type_details=1#top ') === 'https://calendly.com/torys/30min', 'the month, tracking and layout parts and the fragment are dropped so an old link still opens today');
ok(cleanBookingUrl('https://example.ca/book?service=consult&utm_campaign=a') === 'https://example.ca/book?service=consult', 'a part that selects something is kept');
ok(['http://calendly.com/x', 'javascript:alert(1)', 'https://user:pw@calendly.com/x', 'https://127.0.0.1/book', 'https://localhost/book', 'https://lawdb.ca/book', 'https://calendly.com/a b', 'ftp://x.com/a', 'calendly.com/x', '', '   ', null, 7, 'https://' + 'a'.repeat(120) + '.com/' + 'b'.repeat(400)].every((u) => cleanBookingUrl(u) === ''), 'plain http, scripts, sign-in details, addresses of this computer or of LawDB itself, spaces, non-text and over-long addresses are refused');
ok(cleanBookingUrl('https://ablink.send.calendly.com/ls/click?upn=abc') === '' && cleanBookingUrl('https://click.mailer.example.com/x') === '', 'email tracking redirects are not booking pages');

// ---- the button (the markup, without the snippet's own style, which names both states)
const markup = (h) => h.replace(/<style>[\s\S]*?<\/style>/, '');
const on = bookingRow({ url: 'https://calendly.com/torys/30min', name: 'Torys LLP' });
ok(/<a class="li-btn li-book" href="https:\/\/calendly\.com\/torys\/30min" target="_blank" rel="noopener nofollow"/.test(markup(on)) && markup(on).includes('<span>Book a call</span>') && !markup(on).includes('li-book-off'), 'a firm with a link gets an active button that opens it in a new tab');
const off = markup(bookingRow({ url: '', name: 'Torys LLP' }));
ok(off.includes('class="li-btn li-book li-book-off"') && off.includes('aria-disabled="true"') && off.includes('aria-controls="lw-book-note"') && /<p class="lw-book-note" id="lw-book-note" hidden>/.test(off) && off.includes('use &ldquo;Claim this listing&rdquo; below') && !off.includes('<a ') && !off.includes('href='), 'a firm without one gets the greyed-out button and a hidden note that points to the Claim line under it, and nothing to open');
const offManaged = markup(bookingRow({ url: '', name: 'Torys LLP', managed: true }));
ok(offManaged.includes('hasn&#x27;t added an online booking link yet.') && !offManaged.includes('Claim this listing'), 'a firm that is already managed is not told to claim itself');
ok([{ url: 'javascript:alert(1)' }, { url: 'http://x.com/book' }, {}].every((o) => markup(bookingRow({ ...o, name: 'A' })).includes('class="li-btn li-book li-book-off"')), 'whatever is stored, only a valid link turns the button on');
const nasty = markup(bookingRow({ url: '', name: '<img src=x onerror=alert(1)> "Q" & Co' }));
ok(!/<script|<img/.test(nasty) && nasty.includes('&lt;img') && nasty.includes('&quot;Q&quot; &amp; Co'), 'the firm name and address are escaped in both states');
const nameOn = bookingRow({ url: 'https://calendly.com/x', name: 'O"Brien <b>' });
ok(nameOn.includes('title="Opens O&quot;Brien &lt;b&gt;&#x27;s own booking page"') || nameOn.includes('O&quot;Brien &lt;b&gt;'), 'the name is escaped in the button tooltip too');
ok(/li-book\{background:#fdf3d6;border:1\.5px solid #e6c36a/.test(on) && /li-book-off\{background:#f3f1ec/.test(on), 'the active button is light gold (not solid gold) and the locked one is light grey');

// ---- the owner and admin forms
ok(FIRM_FIELDS.bookingUrl('') === '' && FIRM_FIELDS.bookingUrl('  ') === '' && FIRM_FIELDS.bookingUrl('https://calendly.com/a/b?month=2020-01') === 'https://calendly.com/a/b', 'the edit form takes a blank (button off) or a clean https link');
ok(throws(() => FIRM_FIELDS.bookingUrl('http://calendly.com/a')) && throws(() => FIRM_FIELDS.bookingUrl('not a link')) && throws(() => FIRM_FIELDS.bookingUrl(5)), 'the edit form refuses anything else with a message');

// ---- the clicks
ok(EVENTS.has('book') && EVENTS.has('book-locked') && JSON.stringify(eventIncs({ t: 'ev', e: 'book', p: '/firms/a-law' })) === '[["ev","book","/firms/a-law"]]' && JSON.stringify(eventIncs({ t: 'ev', e: 'book-locked', p: '/firms/a-law' })) === '[["ev","book-locked","/firms/a-law"]]', 'clicks on the active and the greyed-out button are counted');
const siteJs = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
ok(/classList\.contains\('li-book'\)/.test(siteJs) && /'book-locked'/.test(siteJs), 'the page script counts both buttons');
const follow = readFileSync(new URL('../follow.js', import.meta.url), 'utf8');
ok(/\.li-book-off/.test(follow) && /lw-book-note/.test(follow) && !/innerHTML/.test(follow), 'tapping the greyed-out button opens its note (plain script, no markup built from data)');

// ---- the links found on firms' own websites
const links = JSON.parse(readFileSync(new URL('../data/firm-booking.json', import.meta.url), 'utf8'));
const slugs = new Set(JSON.parse(readFileSync(new URL('../firms_data.json', import.meta.url), 'utf8')).map((f) => f.slug));
const dir = new URL('../data/', import.meta.url);
for (const f of readdirSync(dir).filter((x) => /^firms-batch-\d+\.json$/.test(x))) for (const r of JSON.parse(readFileSync(new URL(f, dir), 'utf8'))) slugs.add(r.slug);
const entries = Object.entries(links);
ok(entries.length >= 200 && entries.every(([s]) => slugs.has(s)), `${entries.length} firms have a booking link and every one is a listed firm`);
ok(entries.every(([, v]) => cleanBookingUrl(v.url) === v.url && ['calendar', 'page'].includes(v.kind) && /^\d{4}-\d{2}-\d{2}$/.test(v.checked)), 'every stored link is clean, has a kind and a date it was checked');
ok(entries.every(([, v]) => !(v.kind === 'page' && new URL(v.url).pathname === '/')), 'no "page" link is only a home page (that is not a booking page)');
// two offices of one firm may share a link; two different firms should not
const site = new Map();
for (const r of JSON.parse(readFileSync(new URL('../firms_data.json', import.meta.url), 'utf8'))) site.set(r.slug, r.website);
for (const f of readdirSync(dir).filter((x) => /^firms-batch-\d+\.json$/.test(x))) for (const r of JSON.parse(readFileSync(new URL(f, dir), 'utf8'))) site.set(r.slug, r.website);
const byUrl = new Map();
for (const [s, v] of entries) byUrl.set(v.url, [...(byUrl.get(v.url) || []), s]);
ok([...byUrl.values()].filter((a) => a.length > 1).every((a) => new Set(a.map((s) => new URL(site.get(s)).hostname.replace(/^www\./, ''))).size === 1), 'a booking link is shared only by offices of the same firm');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nbooking button checks passed');
