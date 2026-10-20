// Builds src/render/firm-chunks.generated.js from the existing hand-built profile pages, so that pages
// rendered from the database are made of exactly the same pieces (styles, header, footer, contact form,
// guidance text) as the original pages.
//   node scripts/extract-firm-template.mjs          (rewrite the generated file)
//   node scripts/extract-firm-template.mjs --check  (fail if the committed file is out of date)
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const firms = JSON.parse(read('firms_data.json'));
const page = (slug) => read(`firms/${slug}.html`);
const REF_SLUG = 'torkin-manes-llp'; // standard layout, svg monogram, hours card
const REF = page(REF_SLUG);
const refFirm = firms.find((f) => f.slug === REF_SLUG);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

function must(v, what) {
  if (v == null || v === -1) throw new Error(`template extraction failed: ${what}`);
  return v;
}
// Returns the balanced <tag ...>...</tag> block that starts at `start`.
function balanced(html, start, tag = 'div') {
  const open = new RegExp(`<${tag}[\\s>]`, 'g');
  const close = new RegExp(`</${tag}>`, 'g');
  let depth = 0, i = start;
  for (;;) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(html), c = close.exec(html);
    if (!c) throw new Error(`unbalanced <${tag}> at ${start}`);
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; i = c.index + 1; if (depth === 0) return html.slice(start, c.index + `</${tag}>`.length); }
  }
}
const block = (html, marker, tag = 'div') => balanced(html, must(html.indexOf(marker), marker), tag);
// Replace this firm's own values by tokens so the chunk is reusable.
const tokenize = (s, f) =>
  s.split(esc(f.name)).join('{{NAME}}').split(f.name).join('{{NAME}}')
   .split(f.slug).join('{{SLUG}}')
   .split(String(f.lat)).join('{{LAT}}').split(String(f.lng)).join('{{LNG}}');

const chunks = {};

chunks.FAVICONS = must(REF.split('\n').find((l) => l.startsWith('<link rel="icon" type="image/png" sizes="32x32"')), 'favicons');
{
  const a = must(REF.indexOf('<style>'), 'style'), b = must(REF.indexOf('</style>', a), 'style end');
  chunks.STYLE = REF.slice(a, b + 8);
}
{
  const a = must(REF.indexOf('<header class="site-header">'), 'header');
  const d = must(REF.indexOf('<nav class="menu-drawer"'), 'drawer');
  chunks.HEADER = REF.slice(a, REF.indexOf('</nav>', d) + 6);
}
chunks.FOOTER = REF.slice(must(REF.indexOf('<footer class="site-footer">'), 'footer'));
chunks.LEAD_SLIM = tokenize(block(REF, '<div class="lead-slim">'), refFirm);
chunks.MAP_EMBED = tokenize(block(REF, '<div class="map-embed">'), refFirm);
chunks.FINE = tokenize(block(REF, '<div class="fine">'), refFirm);
{
  const a = must(REF.indexOf("<script>\n    (function(){\n      var form = document.getElementById('leadForm-"), 'lead script');
  let s = REF.slice(a, REF.indexOf('</script>', a) + 9);
  s = tokenize(s, refFirm);
  // Also keep a copy in our own database (best effort: Web3Forms email stays the source of truth).
  const hook = "fetch('https://api.web3forms.com/submit'";
  must(s.indexOf(hook) >= 0 ? 1 : -1, 'web3forms hook');
  s = s.replace(hook,
    "try{ fetch('/api/leads', { method: 'POST', headers: {'Content-Type':'application/json'}, keepalive: true, body: JSON.stringify({ form: 'firm-profile', name: form.name.value, email: form.email.value, phone: form.phone.value, message: form.message.value, firm: '{{SLUG}}', firmName: '{{NAME}}', botcheck: form.botcheck.checked ? '1' : '', page: location.pathname }) }).catch(function(){}); }catch(_){}\n        " + hook);
  chunks.LEAD_SCRIPT = s;
}
{
  // hours card: head (up to the list) and note
  const sec = block(REF, '<section class="hours-card"', 'section');
  const ulStart = sec.indexOf('<ul class="hc-list">');
  chunks.HOURS_HEAD = sec.slice(0, ulStart).replace(/data-tz="[^"]+"/, 'data-tz="{{TZ}}"');
  chunks.HOURS_TAIL = sec.slice(sec.indexOf('</ul>') + 5);
}
{
  const svgs = (s) => [...s.matchAll(/<svg class="ic".*?<\/svg>/gs)].map((m) => m[0]);
  const act = block(REF, '<div class="li-actions">');
  const [phone, globe, pin] = svgs(act);
  const soc = block(REF, '<div class="socials">');
  const [star, linkedin, pin2] = svgs(soc);
  chunks.ICONS = { phone: must(phone, 'phone icon'), globe: must(globe, 'globe icon'), pin: must(pin, 'pin icon'), star: must(star, 'star'), linkedin: must(linkedin, 'linkedin'), pin2: must(pin2, 'pin2') };
  const dan = page('barbarian-law'); // a firm that is still Featured, so its page still has the tick
  const tick = must(dan.match(/<span class="li-tick".*?<\/svg><\/span>/s), 'tick')[0];
  chunks.TICK = tick;
}
{
  // Guidance block per primary case type: the most common version among existing pages.
  const tally = {};
  for (const f of firms) {
    const ct = f.caseTypes && f.caseTypes[0];
    if (!ct) continue;
    const h = page(f.slug);
    const i = h.indexOf('<div class="guide">');
    if (i < 0) continue;
    const g = tokenize(balanced(h, i), f);
    // skip versions that mention any other firm-specific value
    if (g.includes(f.city) && f.city.length > 3) continue;
    (tally[ct] ||= new Map()).set(g, (tally[ct].get(g) || 0) + 1);
  }
  chunks.GUIDES = {};
  for (const [ct, m] of Object.entries(tally)) chunks.GUIDES[ct] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const out =
  '// GENERATED by scripts/extract-firm-template.mjs from the existing profile pages. Do not edit by hand.\n' +
  Object.entries(chunks).map(([k, v]) => `export const ${k} = ${JSON.stringify(v, null, 0)};\n`).join('');

const target = new URL('src/render/firm-chunks.generated.js', root);
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(target, 'utf8'); } catch {}
  if (current !== out) { console.error('src/render/firm-chunks.generated.js is out of date: run node scripts/extract-firm-template.mjs'); process.exit(1); }
  console.log('firm template chunks are up to date');
} else {
  writeFileSync(target, out);
  console.log(`wrote ${target.pathname}  (${out.length} bytes)  guides: ${Object.keys(chunks.GUIDES).join(', ')}`);
}
