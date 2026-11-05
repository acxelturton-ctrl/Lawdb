// Profile strength and the owner's profile details (languages, year started practising, availability, virtual consultations).
//   node scripts/test-profile-strength.mjs
import { readFileSync } from 'node:fs';
import { profileStrength, STRENGTH_TOTAL, AVAILABILITY } from '../src/lib/profile-strength.js';
import { cleanLanguages, cleanFounded, LANGUAGES } from '../src/lib/details.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };
const throws = (fn) => { try { fn(); return false; } catch (e) { return e && e.status === 422; } };

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const FULL = {
  firm: { name: 'A', blurb: 'We help people', tags: ['Divorce', 'Child custody'], phone: '613-555-0100', website: 'https://a.example', address: '1 Main St, Ottawa, ON',
    social: { linkedin: 'https://www.linkedin.com/company/a' }, details: { languages: ['English', 'French'], founded: 2009 }, availability: 'accepting' },
  extra: { about: words(40), hours: JSON.stringify({ 1: [['09:00', '17:00']] }) },
};

ok(STRENGTH_TOTAL === 100, 'the points add up to 100');
const full = profileStrength(FULL.firm, FULL.extra);
ok(full.score === 100 && full.complete && full.todo.length === 0 && full.items.every((i) => i.done), 'a complete profile scores 100 with nothing left to do');
const empty = profileStrength({}, {});
ok(empty.score === 0 && !empty.complete && empty.todo.length === empty.items.length, 'an empty profile scores 0 with everything left to do');
ok(empty.todo[0].points >= empty.todo[empty.todo.length - 1].points && empty.todo[0].key === 'about', 'what is left is listed biggest first (the description first)');
ok(profileStrength(null).score === 0, 'a missing record does not throw');

const drop = (key, from = FULL) => { const f = JSON.parse(JSON.stringify(from.firm)); const x = { ...from.extra }; if (key in f) delete f[key]; else if (key in x) delete x[key]; return profileStrength(f, x); };
ok(profileStrength(FULL.firm, { ...FULL.extra, about: words(39) }).items.find((i) => i.key === 'about').done === false, 'a 39-word description is not enough (40 words is the bar for being listed on Google)');
ok(profileStrength(FULL.firm, { ...FULL.extra, about: words(40) }).items.find((i) => i.key === 'about').done === true, 'a 40-word description counts');
ok(drop('about').score === 75 && drop('blurb').score === 92 && drop('hours').score === 90 && drop('availability').score === 93, 'each missing piece takes off its own points');
ok(profileStrength({ ...FULL.firm, tags: ['Divorce'] }, FULL.extra).items.find((i) => i.key === 'tags').done === false, 'one practice area is not enough');
ok(profileStrength(FULL.firm, { ...FULL.extra, hours: '{}' }).items.find((i) => i.key === 'hours').done === false && profileStrength(FULL.firm, { ...FULL.extra, hours: 'not json' }).items.find((i) => i.key === 'hours').done === false, 'empty or broken opening hours do not count');
ok(profileStrength(FULL.firm, { ...FULL.extra, hours: { 2: [['10:00', '12:00']] } }).items.find((i) => i.key === 'hours').done === true, 'opening hours given as an object count too');
ok(profileStrength({ ...FULL.firm, social: { linkedin: '' } }, FULL.extra).items.find((i) => i.key === 'social').done === false, 'an empty social link does not count');
ok(profileStrength({ ...FULL.firm, availability: 'constructor' }, FULL.extra).items.find((i) => i.key === 'availability').done === false, 'availability must be one of the real choices');
ok(profileStrength({ ...FULL.firm, details: { languages: ['Klingon'], founded: 1700 } }, FULL.extra).score === 90, 'details that are not valid (an unknown language, a year before 1850) do not count');
ok(full.items.every((i) => !('hint' in i)) && empty.items.every((i) => typeof i.hint === 'string' && i.hint.length > 0), 'a hint comes with every item that is not done');
ok(empty.items.find((i) => i.key === 'about').hint.includes('0 of 40 words'), 'the description hint says how many words there are');

// what an owner may send
ok(JSON.stringify(cleanLanguages(['English', 'French', 'English'])) === '["English","French"]' && cleanLanguages([]).length === 0, 'languages: known ones, no repeats, an empty list clears them');
ok(throws(() => cleanLanguages(['Klingon'])) && throws(() => cleanLanguages('English')) && throws(() => cleanLanguages(LANGUAGES.slice(0, 9))), 'languages: unknown, not a list, or more than 8 are refused');
ok(cleanFounded(2009) === 2009 && cleanFounded('2009') === 2009 && cleanFounded(null) === null && cleanFounded('') === null, 'year: a number or text year is kept, blank clears it');
ok(throws(() => cleanFounded(1700)) && throws(() => cleanFounded(2999)) && throws(() => cleanFounded(2009.5)) && throws(() => cleanFounded('abc')), 'year: before 1850, in the future, with a fraction or not a number is refused');

// the editor (a browser file) carries its own copy of the lists: keep them the same
const editor = readFileSync('admin/profile-editor.js', 'utf8');
const lang = editor.match(/export const LANGUAGES = (\[[^\]]*\]);/);
ok(lang && JSON.stringify(eval(lang[1])) === JSON.stringify(LANGUAGES), "the editor's language list is the same as the server's");
const av = editor.match(/export const AVAILABILITY = (\{[^}]*\});/);
ok(av && JSON.stringify(eval(`(${av[1]})`)) === JSON.stringify(AVAILABILITY), "the editor's availability choices are the same as the server's");

// the page's chips and the plan table row exist
const page = readFileSync('src/render/firm-page.js', 'utf8');
ok(/function chipsHtml/.test(page) && /Object\.hasOwn\(AVAILABILITY, f\.availability\)/.test(page) && /Virtual consultations available/.test(page), 'the firm page shows availability and virtual consultations');
ok(/strength/.test(readFileSync('src/routes/account.js', 'utf8')) && /strength/.test(readFileSync('src/routes/admin.js', 'utf8')), 'the owner and admin endpoints return the strength');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nprofile strength checks passed');
