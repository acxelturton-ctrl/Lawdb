// Reads opening hours that firms publish on their own websites (schema.org data in the page: openingHoursSpecification or openingHours)
// for firms that have no hours yet, and records them in data/hours-found.json ({ slug: { hours, from } }).
//   NODE_USE_ENV_PROXY=1 node scripts/find-hours.mjs
// Only hours the firm itself publishes are taken. Nothing is guessed, and anything that does not read cleanly is skipped.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { normalizeHours } from '../src/lib/firm-edit.js';

const UA = 'LawDB-HoursReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const firms = JSON.parse(readFileSync('firms_data.json', 'utf8'));
const hours = JSON.parse(readFileSync('firms_hours.json', 'utf8'));
const targets = firms.filter((f) => f.website && !hours[f.slug]).map((f) => ({ slug: f.slug, website: f.website }));
for (const file of readdirSync('data').filter((f) => /^firms-batch-\d+\.json$/.test(f))) {
  for (const f of JSON.parse(readFileSync(`data/${file}`, 'utf8'))) if (f.website && !f.hours) targets.push({ slug: f.slug, website: f.website });
}
const OUT = 'data/hours-found.json';
const found = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const DAYS = { monday: 1, mon: 1, mo: 1, tuesday: 2, tue: 2, tu: 2, wednesday: 3, wed: 3, we: 3, thursday: 4, thu: 4, th: 4, friday: 5, fri: 5, fr: 5, saturday: 6, sat: 6, sa: 6, sunday: 7, sun: 7, su: 7 };

async function get(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(String(res.status));
  if (!/html/i.test(res.headers.get('content-type') || 'html')) throw new Error('not html');
  return { html: (await res.text()).slice(0, 600_000), url: res.url };
}
const t24 = (s) => {
  const m = String(s).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] || '00';
  if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  return h > 23 ? null : `${String(h).padStart(2, '0')}:${min}`;
};
const dayNum = (d) => DAYS[String(d).split('/').pop().toLowerCase().replace(/[^a-z]/g, '')];
function fromObject(o, out) {
  const spec = o.openingHoursSpecification;
  for (const s of [].concat(spec || [])) {
    const a = t24(s.opens), b = t24(s.closes);
    if (!a || !b || a >= b) continue;
    for (const d of [].concat(s.dayOfWeek || [])) { const n = dayNum(d); if (n) (out[n] ||= []).push([a, b]); }
  }
  for (const line of [].concat(o.openingHours || [])) {
    const m = String(line).match(/^([A-Za-z,\- ]+?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i);
    if (!m) continue;
    const a = t24(m[2]), b = t24(m[3]); if (!a || !b || a >= b) continue;
    const order = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
    for (const part of m[1].split(',')) {
      const [x, y] = part.trim().split('-').map((v) => v && order.indexOf(v.trim().slice(0, 2).toLowerCase()));
      if (x === undefined || x < 0) continue;
      for (let i = x; i <= (y === undefined ? x : y); i++) (out[i + 1] ||= []).push([a, b]);
    }
  }
}
function hoursOf(html) {
  const out = {};
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); if (n.openingHoursSpecification || n.openingHours) fromObject(n, out); Object.values(n).forEach(walk); };
    walk(j);
  }
  try { return normalizeHours(Object.fromEntries(Object.entries(out).map(([d, v]) => [d, [...new Map(v.map((x) => [x.join(), x])).values()].slice(0, 3)])), true); } catch { return null; }
}
async function one(t) {
  let site = t.website.replace(/\/+$/, '');
  if (/^http:/i.test(site)) { try { const r = await fetch(site.replace(/^http:/i, 'https:'), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) }); if (r.ok) site = site.replace(/^http:/i, 'https:'); } catch { /* keep */ } }
  const pages = [site + '/'];
  for (let i = 0; i < pages.length && i < 3; i++) {
    try {
      const { html, url } = await get(pages[i]);
      const h = hoursOf(html);
      if (h && Object.keys(h).length >= 3) return { slug: t.slug, hours: h, from: url };
      if (i === 0) {
        const origin = new URL(url).origin; const seen = new Set(pages);
        for (const a of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>/gi)) {
          if (!/contact|location|office|about/i.test(a[1])) continue;
          let u; try { u = new URL(a[1], url); } catch { continue; }
          if (u.origin !== origin || seen.has(u.href)) continue;
          seen.add(u.href); pages.push(u.href); if (pages.length >= 3) break;
        }
      }
    } catch { /* next page */ }
  }
  return null;
}
const todo = targets.filter((t) => !found[t.slug]);
let i = 0; let n = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) { const t = todo[i++]; const r = await one(t); if (r) { found[r.slug] = { hours: r.hours, from: r.from }; n++; } process.stdout.write('.'); writeFileSync(OUT, JSON.stringify(found, null, 1) + '\n'); } }));
console.log(`\nhours found for ${n} of ${todo.length} firms`);
