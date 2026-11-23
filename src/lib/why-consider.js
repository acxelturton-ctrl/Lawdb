// "Why people consider ..." for a firm and for a lawyer: a short list of reasons, each one a fact the page already holds (the role, the year called to the bar, the languages, what
// the firm focuses on, its Google rating and number of reviews, where it works, how many lawyers it lists). It is deliberately not an opinion: a directory may not call a
// lawyer the best, a specialist or the right choice (law societies restrict those claims, see content-rules.js), so nothing here is a judgement and nothing compares one
// lawyer with another. A list is only shown when it has enough to say (MIN_REASONS).
import { cleanDetails } from './details.js';

export const MIN_REASONS = 3;
const joinAnd = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
const lower = (s) => String(s).toLowerCase();
const num = (v) => Number(v) || 0;

// What the firm focuses on, from its practice-area tags (a general practice says so).
function focus(f) {
  const tags = (f.tags || []).filter(Boolean);
  if (!tags.length) return '';
  if (tags.length === 1 && /^general practice$/i.test(tags[0])) return 'The firm has a general practice.';
  return `The firm focuses on ${joinAnd(tags.filter((t) => !/^general practice$/i.test(t)).slice(0, 3).map(lower))}.`;
}
const rated = (f) => (num(f.rating) > 0 && num(f.count) > 0 ? `${num(f.rating).toFixed(1)} out of 5 from ${num(f.count)} Google reviews` : '');

// Reasons to consider one lawyer. `team` is how many lawyers the firm lists on LawDB.
export function whyLawyer(l, f, prov, { team = 0, thisYear = new Date().getFullYear() } = {}) {
  const out = [];
  if (l.title) out.push(`${l.title} at ${f.name}, in ${f.city}, ${prov}.`);
  if (l.callYear) {
    const years = thisYear - Number(l.callYear);
    out.push(`Called to the bar in ${l.callYear}${years >= 2 ? `, ${years} years ago` : ''}.`);
  }
  if (l.education && l.education.length) out.push(`Education: ${l.education.slice(0, 3).join('; ')}.`);
  if (l.languages && l.languages.length) out.push(`Works in ${joinAnd(l.languages)}.`);
  const fx = focus(f);
  if (fx) out.push(fx);
  if (team >= 3) out.push(`One of ${team} lawyers listed at ${f.name}.`);
  const r = rated(f);
  if (r) out.push(`${f.name} is rated ${r}.`);
  return out.length >= MIN_REASONS ? out.slice(0, 7) : [];
}

// Reasons to consider a firm. It needs at least one fact beyond the ones the top of the page already shows (the rating and the place), so a firm whose page has nothing
// more to add gets no list rather than the same facts twice.
export function whyFirm(f, lw, prov) {
  const d = cleanDetails(f.details) || {};
  const extra = [];
  const out = [];
  const fx = focus(f);
  if (fx) out.push(fx);
  if (d.founded) { out.push(`Founded in ${d.founded}.`); extra.push(1); }
  if (lw && lw.length >= 2) { out.push(`${lw.length} lawyers are listed on LawDB, including ${joinAnd(lw.slice(0, 3).map((x) => x.name))}.`); extra.push(1); }
  if (d.languages && d.languages.length) { out.push(`Works in ${joinAnd(d.languages)}.`); extra.push(1); }
  if (d.serving && d.serving.length) { out.push(`Serves ${joinAnd(d.serving.slice(0, 4))}.`); extra.push(1); }
  const r = rated(f);
  if (r) out.push(`Rated ${r}.`);
  out.push(`Based in ${f.city}, ${prov}.`);
  return extra.length && out.length >= MIN_REASONS ? out.slice(0, 7) : [];
}

// The compare table of a firm's lawyers: only the columns at least one lawyer has something in, and nothing at all unless two or more lawyers have a fact beyond their name.
export function compareLawyers(lw) {
  const cols = [
    ['role', 'Role', (l) => l.title || ''],
    ['called', 'Called to the bar', (l) => (l.callYear ? String(l.callYear) : '')],
    ['languages', 'Languages', (l) => (l.languages ? joinAnd(l.languages) : '')],
    ['education', 'Education', (l) => (l.education ? l.education.slice(0, 2).join('; ') : '')],
  ];
  const withFacts = lw.filter((l) => cols.some(([, , get]) => get(l)));
  if (lw.length < 2 || withFacts.length < 2) return null;
  const used = cols.filter(([, , get]) => lw.some((l) => get(l)));
  return { columns: used.map(([key, label]) => ({ key, label })), rows: lw.map((l) => ({ lawyer: l, cells: used.map(([, , get]) => get(l)) })) };
}
