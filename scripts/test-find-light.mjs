// /find-lawyers used to carry the whole firm list inside the page (over half a megabyte of script in the HTML). It now fetches /firms_data.json on demand,
// shared with the search box, so the page is light. This keeps it that way: no list inside the page, the cities the search needs are written in, and
// nothing reads a field that the shared list no longer carries.
import { readFileSync, statSync } from 'node:fs';
import { DROPPED_FIELDS } from '../src/routes/dynamic.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

const html = readFileSync('find-lawyers.html', 'utf8');
ok(!/^const firms = \[/m.test(html), 'the page has no firm list inside it');
ok(statSync('find-lawyers.html').size < 150000, `the page is light (${Math.round(statSync('find-lawyers.html').size / 1000)} KB, under 150 KB)`);
ok(html.includes("fetch('/firms_data.json')") && html.includes('function loadFirms()'), 'the page fetches the firm list on demand');
ok(html.includes('firms: loadFirms,'), 'the search box shares that download (no second request)');
ok(/typeof opt\.firms==='function'/.test(readFileSync('suggest.js', 'utf8')), 'the search box accepts the list as a function');
const seed = JSON.parse((html.match(/\/\*city-seed\*\/const CITY_SEED = (\[.*?\]);\/\*\/city-seed\*\//s) || [])[1] || '[]');
ok(seed.length >= 60 && seed.every((c) => c.name && c.province && c.region && Number.isFinite(c.lat) && Number.isFinite(c.lng)), `${seed.length} cities are written into the page (name, province, region, position)`);
ok(/if\(!firms\.length \|\| !pageScriptsDone\)\{[\s\S]{0,500}Promise\.all\(\[loadFirms\(\), pageScriptsP\]\)\.then\(\(\) => showResults\(skipScroll\)\)/.test(html), 'results wait for the list and the map scripts, then draw themselves');
// the map library is not allowed to hold up the page: both map scripts defer and its stylesheet is not render-blocking
ok(/maplibre-gl\.min\.js" defer>/.test(html) && /lawdb-map\.js\?v=\d+" defer>/.test(html), 'the map library and lawdb-map.js are deferred');
ok(/maplibre-gl\.min\.css" media="print" onload="this\.media='all'"/.test(html), 'the map stylesheet does not block the first paint');
ok(html.indexOf('maplibre-gl.min.js') < html.indexOf('lawdb-map.js?v='), 'maplibre runs before lawdb-map.js (which needs it)');

// the shared list leaves out the social links, so no page that loads it may read them
ok(DROPPED_FIELDS.includes('social'), 'the shared firm list leaves out the social links');
const readers = ['find-lawyers.html', 'suggest.js', 'lawdb-map.js', 'lw-app.js', 'site.js', 'index.html', 'lawdb-places.js'].filter((f) => /\b(f|firm)\.social\b|\.social\b/.test(readFileSync(f, 'utf8')));
ok(readers.length === 0, `no page or script that loads the shared list reads the social links${readers.length ? ` (found in ${readers.join(', ')})` : ''}`);

// no "popular searches" on the Find page: neither the "Try one" chips under the box nor the Popular search rows in its drop-down
ok(!html.includes('id="fyTry"') && !html.includes('Try one:') && /popular: false/.test(html) && /opt\.popular!==false/.test(readFileSync('suggest.js', 'utf8')), 'the Find page has no popular searches (no "Try one" chips, and its drop-down leaves out the Popular search rows)');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
