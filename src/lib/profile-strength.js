// Profile strength: how complete a firm's profile is, as a number out of 100 and a checklist of what is still missing.
//
// It counts only what ANY owner can fill in for free (a Basic firm can earn all 100): the description, tagline, practice areas, phone, website,
// street address, opening hours, a social profile, the languages the firm serves clients in, the year it started practising, and whether it is
// accepting new clients. Pictures, a booking link and the like are Featured benefits, so they are not in the score.
//
// It is a measure of completeness, nothing else. It is shown to the firm's owners (and to the admin) to help them finish the profile, never to
// visitors, and it says nothing about a lawyer's ability or about where Google will rank the page.
import { MIN_ABOUT_WORDS, aboutWords } from './indexing.js';
import { cleanDetails } from './details.js';

export const AVAILABILITY = { accepting: 'Accepting new clients', limited: 'Limited availability', closed: 'Not accepting new clients' };

const hasHours = (h) => {
  let o = h;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  return !!o && typeof o === 'object' && Object.values(o).some((v) => Array.isArray(v) && v.length > 0);
};
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// [key, what to do, points, done?, hint when not done]. The points add up to 100.
const ITEMS = [
  ['about', 'Write your description', 25, (f, x) => aboutWords(x.about) >= MIN_ABOUT_WORDS, (f, x) => `${aboutWords(x.about)} of ${MIN_ABOUT_WORDS} words. With ${MIN_ABOUT_WORDS} or more, Google can list your page.`],
  ['blurb', 'Add a one-line tagline', 8, (f) => text(f.blurb).length > 0, () => 'It shows in lists and search results.'],
  ['tags', 'List at least two practice areas', 10, (f) => Array.isArray(f.tags) && f.tags.filter((t) => text(t)).length >= 2, () => 'It is how clients find you by case type.'],
  ['phone', 'Add your phone number', 7, (f) => text(f.phone).length > 0, () => 'The Call button needs it.'],
  ['website', 'Add your website', 7, (f) => text(f.website).length > 0, () => 'Visitors can go straight to your site.'],
  ['address', 'Add your street address', 10, (f) => text(f.address).length > 0, () => 'It places your pin on the map and powers Directions.'],
  ['hours', 'Add your opening hours', 10, (f, x) => hasHours(x.hours), () => 'Clients see whether you are open right now.'],
  ['social', 'Link a social profile', 6, (f) => !!f.social && typeof f.social === 'object' && Object.values(f.social).some((u) => text(u)), () => 'LinkedIn, Facebook, Instagram, X or YouTube.'],
  ['languages', 'Say which languages you serve clients in', 6, (f) => !!(cleanDetails(f.details) || {}).languages, () => 'Many clients search for a lawyer who speaks their language.'],
  ['founded', 'Add the year you started practising', 4, (f) => !!(cleanDetails(f.details) || {}).founded, () => 'Shown under "At a glance".'],
  ['availability', 'Say whether you are accepting new clients', 7, (f) => Object.hasOwn(AVAILABILITY, f.availability), () => 'Clients can see it before they contact you.'],
];
export const STRENGTH_TOTAL = ITEMS.reduce((n, i) => n + i[2], 0);

// firm: the firm record (JSON `data`); extra: { about, hours } from the firm's columns.
export function profileStrength(firm, extra = {}) {
  const f = firm || {};
  const items = ITEMS.map(([key, label, points, done, hint]) => {
    const ok = !!done(f, extra);
    return { key, label, points, done: ok, ...(ok ? {} : { hint: hint(f, extra) }) };
  });
  const score = items.reduce((n, i) => n + (i.done ? i.points : 0), 0);
  const todo = items.filter((i) => !i.done).sort((a, b) => b.points - a.points);
  return { score, items, todo: todo.map(({ key, label, points, hint }) => ({ key, label, points, hint })), complete: todo.length === 0 };
}
