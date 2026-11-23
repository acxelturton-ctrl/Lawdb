// "Things to consider" on a lawyer's page, and the compare table on a firm's Lawyers page.
//
// Both are made only of what the firm or the lawyer has told us about the lawyer, and each fact appears once: the page already says who the lawyer is and where they
// work (the title and the firm are in the heading), the firm's rating and the size of the team are on the firm's own page, so none of that is repeated here. What is left
// is the lawyer's own background: how long they have been in practice (from the year they were called to the bar), where they studied, the languages they work in, and
// the awards and achievements a Featured firm has listed for them. A fact we do not have is left out; with nothing to say there is no section, rather than a thin one.
//
// It is deliberately not an opinion: a directory may not call a lawyer the best, a specialist or the right choice (law societies restrict those claims, see
// content-rules.js), so nothing here is a judgement and nothing compares one lawyer with another.
import { inPractice } from './lawyers.js';

const joinAnd = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');

// The lawyer's background as { facts, achievements }: two lists of plain lines, either of which may be empty.
export function considerLawyer(l, { thisYear = new Date().getFullYear() } = {}) {
  const facts = [];
  const p = inPractice(l.callYear, thisYear);
  if (p) facts.push(p.years >= 2 ? `${p.years} years in practice, since ${p.since}.` : `In practice since ${p.since}.`);
  if (l.education && l.education.length) facts.push(`Education: ${l.education.slice(0, 3).join('; ')}.`);
  if (l.languages && l.languages.length) facts.push(`Works in ${joinAnd(l.languages)}.`);
  return { facts, achievements: (l.achievements || []).slice() };
}

// The compare table of a firm's lawyers: only the columns at least one lawyer has something in, and nothing at all unless two or more lawyers have a fact beyond their name.
export function compareLawyers(lw, { thisYear = new Date().getFullYear() } = {}) {
  const cols = [
    ['role', 'Role', (l) => l.title || ''],
    ['practice', 'In practice', (l) => { const p = inPractice(l.callYear, thisYear); return p ? p.text.replace(/^s/, 'S') : ''; }],
    ['languages', 'Languages', (l) => (l.languages ? joinAnd(l.languages) : '')],
    ['education', 'Education', (l) => (l.education ? l.education.slice(0, 2).join('; ') : '')],
  ];
  const withFacts = lw.filter((l) => cols.some(([, , get]) => get(l)));
  if (lw.length < 2 || withFacts.length < 2) return null;
  const used = cols.filter(([, , get]) => lw.some((l) => get(l)));
  return { columns: used.map(([key, label]) => ({ key, label })), rows: lw.map((l) => ({ lawyer: l, cells: used.map(([, , get]) => get(l)) })) };
}
