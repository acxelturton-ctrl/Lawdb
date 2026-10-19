// "At a glance" facts for a firm profile: year founded, languages, the lawyers it names, the practice areas it lists and the places it says it serves.
// They come from the firm's own website (scripts/gather-firm-details.mjs and extract-firm-details.mjs, where every fact must be quoted word for word
// from the firm's page before it is kept), and are stored in the firm record as `details`. cleanDetails keeps only what is well formed and plain,
// so nothing odd can reach a page, whatever is in the data.
import { checkOwnerText } from './content-rules.js';

export const LANGUAGES = ['English', 'French', 'Spanish', 'Punjabi', 'Hindi', 'Urdu', 'Gujarati', 'Tamil', 'Bengali', 'Arabic', 'Persian', 'Farsi', 'Mandarin', 'Cantonese', 'Korean', 'Vietnamese', 'Tagalog', 'Portuguese', 'Italian', 'Polish', 'Russian', 'Ukrainian', 'Greek', 'German', 'Dutch', 'Turkish', 'Japanese', 'Hebrew', 'Somali', 'Amharic', 'Swahili'];
const NAME = /^(?:Me|Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]+(?: [A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]*){1,3}$/;
const NOT_A_NAME = /\b(?:law|llp|lawyers?|attorneys?|team|contact|about|office|group|professional|corporation|services?|practice|our|the|and|call|email|read|more|learn|view|home|news|blog)\b/i;
const TITLE = /^[A-Za-zÀ-ÿ&,' /.-]{2,60}$/;

const one = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const plain = (s) => { try { checkOwnerText('details', s); return true; } catch { return false; } };
const keep = (arr, ok, max) => {
  const seen = new Set();
  return (Array.isArray(arr) ? arr : []).filter((x) => { const k = JSON.stringify(x).toLowerCase(); if (seen.has(k) || !ok(x)) return false; seen.add(k); return true; }).slice(0, max);
};

export function cleanDetails(d, thisYear = new Date().getFullYear()) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  const founded = Number(d.founded);
  if (Number.isInteger(founded) && founded >= 1850 && founded <= thisYear) out.founded = founded;
  const languages = keep(d.languages, (l) => LANGUAGES.includes(l), 8);
  if (languages.length) out.languages = languages;
  const lawyers = keep((d.lawyers || []).map((l) => ({ name: one(l && l.name, 60), ...(l && l.title ? { title: one(l.title, 60) } : {}) })),
    (l) => NAME.test(l.name) && !NOT_A_NAME.test(l.name) && (!l.title || (TITLE.test(l.title) && plain(l.title))), 12);
  if (lawyers.length) out.lawyers = lawyers;
  const label = (max) => (s) => typeof s === 'string' && s.length >= 3 && s.length <= max && !/[<>@]|https?:|www\./i.test(s) && plain(s);
  const areas = keep((d.areas || []).map((s) => one(s, 60)), label(60), 10);
  if (areas.length) out.areas = areas;
  const serving = keep((d.serving || []).map((s) => one(s, 40)), (s) => label(40)(s) && /^[A-ZÀ-Ý]/.test(s), 8);
  if (serving.length) out.serving = serving;
  return Object.keys(out).length ? out : null;
}
