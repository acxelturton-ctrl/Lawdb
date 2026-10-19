// The home page news feed: which firm's article comes first, at most two per firm, only articles with a picture, and the practice-area filter.
import { firmStrength, freshness, rankPosts, isPracticeType, PER_FIRM } from '../src/lib/home-feed.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL ', msg); } };

const strong = { featured: true, rating: 5, reviewCount: 300, aboutWords: 90, hasDetails: true, hasLogo: true, hasCover: true, hasHours: true };
const thin = { featured: false, rating: 0, reviewCount: 0, aboutWords: 0 };
ok(Math.round(firmStrength(strong)) === 100 && firmStrength(thin) === 0, 'a complete Featured firm with a 5.0 from 300 reviews scores 100; a bare listing scores 0');
ok(firmStrength({ ...thin, rating: 4.9, reviewCount: 500 }) > firmStrength({ ...thin, rating: 4.9, reviewCount: 5 }) && firmStrength({ ...thin, rating: 5, reviewCount: 3 }) < firmStrength({ ...thin, rating: 4.7, reviewCount: 200 }), 'more reviews count for more, and a 5.0 from 3 reviews does not beat a 4.7 from 200');
ok(firmStrength({ ...thin, aboutWords: 60 }) > firmStrength({ ...thin, aboutWords: 45 }) && firmStrength({ ...thin, aboutWords: 45 }) > firmStrength({ ...thin, aboutWords: 10 }), 'a written profile counts');

const now = Date.parse('2026-06-01T00:00:00Z');
ok(freshness('2026-06-01 00:00:00', now) === 20 && freshness('2026-04-01 00:00:00', now) < 11 && freshness('2025-01-01 00:00:00', now) === 0 && freshness('garbage', now) === 0, 'freshness is 20 today and fades to 0 over four months');

const row = (id, firm, firmFields, publishedAt, caseTypes = []) => ({ id, firmSlug: firm, publishedAt, caseTypes, title: 't' + id, url: 'https://x.example/' + id, ...firmFields });
const rows = [
  row(1, 'new-thin', thin, '2026-06-01 00:00:00'),
  row(2, 'top', strong, '2026-05-20 00:00:00', ['family']),
  row(3, 'top', strong, '2026-05-10 00:00:00', ['family']),
  row(4, 'top', strong, '2026-05-01 00:00:00', ['family']),
  row(5, 'mid', { featured: false, rating: 4.7, reviewCount: 120, aboutWords: 70, hasLogo: true }, '2026-05-28 00:00:00', ['injury']),
];
const ranked = rankPosts(rows, { now });
ok(ranked[0].firmSlug === 'top' && ranked[ranked.length - 1].firmSlug === 'new-thin', 'the strongest firm leads even though a thin firm posted today, and the thin firm comes last');
ok(ranked.filter((r) => r.firmSlug === 'top').length === PER_FIRM && !ranked.some((r) => r.id === 4), `at most ${PER_FIRM} articles per firm, the newest ones`);
ok(rankPosts(rows, { type: 'injury', now }).map((r) => r.id).join() === '5' && rankPosts(rows, { type: 'family', now }).length === 2, 'the practice-area filter keeps only that area');
ok(isPracticeType('family') && !isPracticeType('constructor') && !isPracticeType('') && !isPracticeType('__proto__'), 'only real practice areas are accepted');

if (failed) process.exit(1);
console.log('home feed checks passed');
