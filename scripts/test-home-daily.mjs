// The home page's daily top-rated firms: who can be picked, that the day's pick is fixed for the day and different tomorrow, that it is a spread, and
// that the page keeps its saved cards when the database cannot answer.   node scripts/test-home-daily.mjs
import { pickDaily, lookScore, dailyCards, withDailyFirms, SHOWN, TOP, PER_CITY, PER_KIND, PER_PROVINCE } from '../src/routes/home-firms.js';
import { HOME_POOL } from '../src/render/home-pool.generated.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };

// synthetic firms: 200 firms over 5 provinces, 20 cities, 6 kinds of practice
const PROVS = ['ON', 'QC', 'BC', 'AB', 'MB'], KINDS = ['Family Law', 'Criminal Law', 'Immigration Law', 'Personal Injury', 'Real Estate', 'Wills & Estates'];
const firms = Array.from({ length: 200 }, (_, i) => ({ slug: `firm-${i}`, name: `Firm ${i}`, city: `City ${i % 20}`, province: PROVS[(i % 20) % 5], tags: [KINDS[i % 6]], rating: 4.8 + (i % 3) / 10, count: 50 + i, look: 4.8 + (i % 50) / 100 }));
const days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'];
const slugs = (list) => list.map((f) => f.slug);

const today = pickDaily(firms, days[0]);
ok(today.length === SHOWN && new Set(slugs(today)).size === SHOWN, 'a day gets 12 different firms');
ok(JSON.stringify(slugs(pickDaily(firms, days[0]))) === JSON.stringify(slugs(today)) && JSON.stringify(slugs(pickDaily([...firms].reverse(), days[0]))) === JSON.stringify(slugs(today)), 'the same day always gives the same strip, whatever order the firms come in');
const overlaps = days.slice(1).map((d) => slugs(pickDaily(firms, d)).filter((s) => slugs(today).includes(s)).length);
ok(overlaps.every((n) => n <= 7) && days.slice(1).some((d) => JSON.stringify(slugs(pickDaily(firms, d))) !== JSON.stringify(slugs(today))), `another day gives another strip (overlap with today: ${overlaps.join(', ')} of 12)`);
const seen = new Set(); for (let d = 1; d <= 30; d++) for (const f of pickDaily(firms, `2026-12-${String(d).padStart(2, '0')}`)) seen.add(f.slug);
ok(seen.size >= 80, `over a month the strip shows many different firms (${seen.size} of the top ${TOP})`);
const count = (list, key) => list.reduce((m, f) => ((m[key(f)] = (m[key(f)] || 0) + 1), m), {});
for (const d of days) {
  const p = pickDaily(firms, d);
  if (Math.max(...Object.values(count(p, (f) => `${f.city}|${f.province}`))) > PER_CITY || Math.max(...Object.values(count(p, (f) => f.tags[0]))) > PER_KIND || Math.max(...Object.values(count(p, (f) => f.province))) > PER_PROVINCE) { ok(false, `${d}: a limit per city, kind or province was broken`); }
}
ok(true, `no strip has more than ${PER_CITY} firms in a city, ${PER_KIND} of one kind of practice or ${PER_PROVINCE} in a province`);
const weak = firms.map((f, i) => (i < 70 ? { ...f, look: 4.5 } : f)); // 130 better profiles, more than the 120 it draws from
ok(Array.from({ length: 20 }, (_, d) => pickDaily(weak, `2027-01-${String(d + 1).padStart(2, '0')}`)).flat().every((f) => f.look > 4.5), 'only the best-looking profiles are drawn from: a weaker profile is never picked while there are enough better ones');
const few = firms.slice(0, 5).map((f) => ({ ...f, city: 'Same City', province: 'ON', tags: ['Family Law'] }));
ok(pickDaily(few, days[0]).length === 5 && pickDaily(firms.slice(0, 30).map((f) => ({ ...f, city: 'Same City', province: 'ON', tags: ['Family Law'] })), days[0]).length === SHOWN, 'with too few firms, or too little variety, it still fills the strip rather than leaving it short');
ok(lookScore({ rating: 4.9, count: 400 }, 60) > lookScore({ rating: 4.9, count: 60 }, 60) && lookScore({ rating: 4.9, count: 100 }, 90) > lookScore({ rating: 4.9, count: 100 }, 30) && lookScore({ rating: 4.8, count: 60 }, 0) > 4.5, 'the look score rises with the number of reviews and with how complete the profile is');

// the page: cards injected between the markers, from a fake database
const SAVED = '<!--more-firms--><article class="lc saved"></article><!--/more-firms-->';
const page = `<html><body>${'<article class="lc hand"></article>'}${SAVED}</body></html>`;
const about = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
const row = (slug, extra = {}, rowExtra = {}) => ({ slug, about, hours: null, data: JSON.stringify({ slug, name: slug.toUpperCase(), city: `City ${slug.length}`, province: 'ON', type: 'logo', src: 'images/x.png', heroImage: 'images/y.jpg', phone: '+16135550100', tags: ['Family Law'], rating: 4.9, count: 120, ...extra }), ...rowExtra });
const poolRows = HOME_POOL.slice(0, 60).map((s, i) => row(s, { city: `City ${i % 15}`, province: ['ON', 'QC', 'BC', 'AB', 'MB'][i % 5], tags: [KINDS[i % 6]] }));
let queries = 0;
const env = (rows) => ({ DB: { prepare: () => ({ all: async () => { queries++; return { results: rows }; } }) } });
const out = await withDailyFirms(page, env(poolRows));
const between = out.match(/<!--more-firms-->([\s\S]*)<!--\/more-firms-->/)[1];
const cardSlugs = [...between.matchAll(/<article class="lc">[\s\S]*?href="\/firms\/([^"]+)"/g)].map((m) => m[1]);
ok((between.match(/<article class="lc">/g) || []).length === SHOWN && !between.includes('saved') && out.includes('class="lc hand"') && cardSlugs.every((s) => HOME_POOL.includes(s)), "the page gets today's 12 cards between the markers; the hand-written cards before them are untouched");
const before = queries; await withDailyFirms(page, env(poolRows)); await withDailyFirms(page, env(poolRows));
ok(queries === before, 'the database is asked once for the day, not once for every visit');
const odd = [row(HOME_POOL[0], {}, { about: 'too short to count' }), row(HOME_POOL[1], { featured: true }), row(HOME_POOL[2], { phone: '' }), row('not-in-the-pool'), row(HOME_POOL[3], { src: '' }), row(HOME_POOL[4], { heroImage: '' }), row(HOME_POOL[5], { type: 'monogram' }), row(HOME_POOL[6], { tags: [] }), ...poolRows.slice(7, 30)];
const picked = await dailyCards(env(odd), '2030-03-03');
ok(!['too short', 'FEATURED'].some((x) => picked.includes(x)) && !picked.includes('not-in-the-pool') && [HOME_POOL[0], HOME_POOL[1], HOME_POOL[2], HOME_POOL[3], HOME_POOL[4], HOME_POOL[5], HOME_POOL[6]].every((s) => !picked.includes(`/firms/${s}"`)), 'a firm with a short description, a Featured firm, one with no phone, logo, cover or practice area, or one outside the pool is never picked');
ok(await withDailyFirms('<html>no markers</html>', env(poolRows)) === '<html>no markers</html>', 'a page without the markers is left alone');
const dead = { DB: { prepare: () => ({ all: async () => { throw new Error('database down'); } }) } };
const origError = console.error; console.error = () => {};
const fallback = await withDailyFirms(page, dead);
const tooFew = await withDailyFirms(page, env(poolRows.slice(0, 2)));
console.error = origError;
ok(fallback === page && tooFew === page, 'if the database fails, or has too few firms, the page keeps the saved cards');
ok(HOME_POOL.length >= 60 && HOME_POOL.length === new Set(HOME_POOL).size, `the pool has enough firms and no repeats (${HOME_POOL.length})`);

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\ndaily home firms checks passed');
