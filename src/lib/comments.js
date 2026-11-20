// "What clients say" on a firm profile: up to three comments that the firm itself publishes on its own website, shown as the firm published them.
// They are read by scripts/find-firm-comments.py (polite, honours robots.txt, only the firm's own site), chosen by scripts/apply-firm-comments.mjs with
// the rules below, and stored in the firm record as `comments`. cleanComments keeps only what is well formed, plain and safe to show, so nothing odd can
// reach a page whatever is in the data.
//
// What is never kept: text that law societies' advertising rules restrict ("best", "#1", "top-rated", "guaranteed", "specialist": the same check owner text
// gets), links, addresses or phone numbers, markup, comments about a death or a violent or sexual crime, and a source address that is not on the firm's own
// website. A reviewer is shown by first name and last initial at most. LawDB has not verified any comment, and the page says so.
import { checkOwnerText } from './content-rules.js';

export const MAX_COMMENTS = 3;
const MIN_WORDS = 8;
const MAX_WORDS = 60;
// The cards sit side by side, so the three comments chosen are the ones closest to this length (in characters): no card much longer or shorter than the others.
export const TARGET_CHARS = 190;

// Grief and crime: a family's worst day is not something to put in a card on a directory page, even when the firm published it.
const SENSITIVE = /\b(?:kill(?:ed|ing)?|die[sd]?|dying|death|dead|deceased|passed\s+away|funeral|murder(?:ed)?|suicide|rape[sd]?|sexual(?:ly)?|assault(?:ed)?|molest\w*|abus(?:e|ed|ive)|grie[fv]\w*|lost\s+(?:my|our)\s+(?:son|daughter|husband|wife|child|mother|father|baby|brother|sister)|wrongful\s+death|décéd\w*|mort|meurtre|suicid\w*|agression|viol)\b/i;
const PHONE_OR_EMAIL = /@|\b\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}\b/;

const words = (s) => (s.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 60);

// Quotation marks around the whole comment are layout, not part of it.
const unquote = (t) => t.replace(/^[\s"“”«»'‘’]+|[\s"“”«»'‘’]+$/g, '').trim();

// Longer than MAX_WORDS: cut at the last sentence end that leaves a real comment, else at a word, with an ellipsis. The full text is on the firm's own page.
export function shorten(text, max = MAX_WORDS) {
  const w = text.split(/\s+/);
  if (w.length <= max) return text;
  const head = w.slice(0, max).join(' ');
  const m = head.match(/^(.*[.!?])(?=\s|$)/s);
  if (m && words(m[1]) >= 16) return m[1];
  return head.replace(/[\s,;:–—-]+$/, '') + '…';
}

// "Maria Gonzalez" -> "Maria G."; initials ("H.M.") stay; anything else (digits, a company, a sentence) -> "" (shown as "A client").
export function tidyAuthor(a) {
  const s = String(a ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 40 || /[\d@<>:/]/.test(s)) return '';
  if (/^(?:\p{Lu}\.){1,3}$/u.test(s.replace(/\s/g, ''))) return s.replace(/\s/g, '');
  const parts = s.split(' ').filter(Boolean);
  if (parts.length < 1 || parts.length > 3 || !parts.every((p) => /^\p{Lu}[\p{L}'’.-]*$/u.test(p))) return '';
  if (/\b(?:law|llp|lawyers?|attorneys?|clients?|team|office|group|firm|anonymous|google|verified)\b/i.test(s)) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const sameSite = (url, website) => {
  const a = hostOf(url), b = hostOf(website);
  return !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
};

// list: [{ text, author?, url }] in order of preference. website: the firm's own site (a comment's source must be on it).
// Returns up to MAX_COMMENTS of { text, author, url }, or null when none is fit to show. When there are more than three that qualify, the three whose
// length is closest to TARGET_CHARS are kept (in their original order), so the cards come out about the same size.
export function cleanComments(list, { website = '' } = {}) {
  if (!Array.isArray(list)) return null;
  const valid = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object' || typeof c.text !== 'string') continue;
    const text = shorten(unquote(c.text.replace(/\s+/g, ' ').trim()));
    const n = words(text.replace(/…$/, ''));
    if (n < MIN_WORDS || n > MAX_WORDS + 1) continue;
    if (SENSITIVE.test(text) || PHONE_OR_EMAIL.test(text)) continue;
    try { checkOwnerText('comment', text); } catch { continue; } // links, markup, restricted claims
    const url = typeof c.url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(c.url) ? c.url : '';
    if (!url || !sameSite(url, website)) continue;
    const key = norm(text);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ text, author: tidyAuthor(c.author), url, order: valid.length });
  }
  if (!valid.length) return null;
  const chosen = valid.length <= MAX_COMMENTS ? valid : [...valid].sort((a, b) => Math.abs(a.text.length - TARGET_CHARS) - Math.abs(b.text.length - TARGET_CHARS) || a.order - b.order).slice(0, MAX_COMMENTS).sort((a, b) => a.order - b.order);
  return chosen.map(({ text, author, url }) => ({ text, author, url }));
}
