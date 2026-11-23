// Renders a firm profile page from a database record: the one page every firm has. Built from the same chunks as the saved copies of the pages
// (see scripts/extract-firm-template.mjs), so a rendered page looks like the originals.
import { cleanDetails } from '../lib/details.js';
import { lawyersOf, lawyerHasPage, lawyerLead, inPractice } from '../lib/lawyers.js';
import { considerLawyer } from '../lib/why-consider.js';
import { FIRM_PRICE, LAWYER_PRICE } from '../lib/plans.js';
import { cleanComments } from '../lib/comments.js';
import { AVAILABILITY } from '../lib/profile-strength.js';
import * as C from './firm-chunks.generated.js';
import { renderArticlesList } from './blog-cards.js';
import { articlesTabOn } from '../lib/articles.js';
import { profilesBox, hasLinkedIn } from './profiles.js';
import { CITY_HUBS } from './city-hubs.generated.js';
import { PRACTICE } from '../lib/practice.js';

export const PROVINCES = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island' };
const TZ = { ON: 'America/Toronto', QC: 'America/Toronto', BC: 'America/Vancouver', AB: 'America/Edmonton', MB: 'America/Winnipeg', SK: 'America/Regina', NS: 'America/Halifax', NB: 'America/Moncton', NL: 'America/St_Johns', PE: 'America/Halifax' };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const fill = (tpl, map) => tpl.replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (k in map ? map[k] : m));
const jsonForHtml = (o) => JSON.stringify(o, null, 2).replace(/</g, '\\u003c');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Hours come in two shapes in the source data: "08:30" strings, or minutes after midnight (510 = 8:30).
const hm = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  const [h, m = '00'] = String(v).split(':');
  return `${String(Number(h) || 0).padStart(2, '0')}:${String(Number(m) || 0).padStart(2, '0')}`;
};

// "08:30" -> "8:30 am", "17:00" -> "5 pm"
function t12(hhmm) {
  const [h, m] = hm(hhmm).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${ap}` : `${hh} ${ap}`;
}

export function hoursCard(hours, province) {
  if (!hours || typeof hours !== 'object') return '';
  const rows = DAYS.map((name, i) => {
    const ivs = Array.isArray(hours[String(i + 1)]) ? hours[String(i + 1)] : [];
    if (!ivs.length) return `<li data-d="${i + 1}" data-iv=""><span class="hd">${name}</span><span class="ht closed">Closed</span></li>`;
    const iv = ivs.map(([a, b]) => `${hm(a)}-${hm(b)}`).join(';');
    const label = ivs.map(([a, b]) => `${t12(a)} – ${t12(b)}`).join(', ');
    return `<li data-d="${i + 1}" data-iv="${iv}"><span class="hd">${name}</span><span class="ht">${label}</span></li>`;
  });
  if (!hours || !Object.values(hours).some((v) => Array.isArray(v) && v.length)) return '';
  return fill(C.HOURS_HEAD, { TZ: TZ[province] || 'America/Toronto' }) + '<ul class="hc-list">' + rows.join('') + '</ul>' + C.HOURS_TAIL.replace('Hours as shown on the firm&rsquo;s Google listing.', 'Hours as provided by the firm.');
}

function monogram(f) {
  const ini = esc((f.initials || f.name || '?').slice(0, 3).toUpperCase());
  const col = '#3a3a3a'; // one navy for every monogram (a firm's own colour is not used)
  return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ini}"><rect width="60" height="60" rx="10.8" fill="${col}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="24.0" fill="#ffffff" letter-spacing="0.02em">${ini}</text></svg>`;
}

// Image URLs we are willing to put in a page: our own paths, or https.
export const safeUrl = (u) => (typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/?[A-Za-z0-9_\-./]+$/.test(u)) ? u : '');
const localImg = (u) => (/^https:/.test(u) || u.startsWith('/') ? u : `../${u}`);

// A logo that is drawn on its own colour (a white wordmark on black, say) says so with `logoBg` (#rrggbb): it then fills the whole badge, with no white padding around it.
const logoBgOf = (f) => (/^#[0-9a-fA-F]{6}$/.test(f?.logoBg || '') ? f.logoBg : '');

function logoSpan(f) {
  const src = safeUrl(f.src);
  const remote = safeUrl(f.logoUrl);
  const bg = logoBgOf(f);
  if (src) return `<span class="li-logo${bg ? ' li-logo-full' : ''}"${bg ? ` style="background:${bg}"` : ''}><img src="${esc(localImg(src))}" alt="${esc(f.name)} logo" width="96" height="96"></span>`;
  if (remote) return `<span class="li-logo">${monogram(f)}<img src="${esc(remote)}" alt="${esc(f.name)} logo" width="96" height="96" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
  return `<span class="li-logo">${monogram(f)}</span>`;
}

// Which part of a picture the banner shows, e.g. "center 25%" (default: the middle).
const coverPos = (p) => (/^(?:center|\d{1,3}%)(?: (?:center|top|bottom|\d{1,3}%))?$/.test(p || '') ? p : 'center');

function coverDiv(f) {
  const hero = safeUrl(f.heroImage);
  if (hero) return `<div class="li-cover"><img src="${esc(localImg(hero))}" alt="${esc(f.name)}" style="object-position:${coverPos(f.heroPos)};"></div>`;
  return `<div class="li-cover gen"><span class="li-cover-city">${esc(f.city)}, ${esc(f.province)}</span></div>`;
}

function carouselCard(n) {
  const feat = n.featured ? '<span class="lc-feat">Featured</span>' : '';
  const hero = safeUrl(n.heroImage), src = safeUrl(n.src), remote = safeUrl(n.logoUrl);
  let cover, logo = '';
  if (hero) cover = `<div class="lc-cover"><img src="${esc(localImg(hero))}" alt="" loading="lazy"></div>`;
  else if (src) { const bg = logoBgOf(n); cover = `<div class="lc-cover brand${n.dark ? ' dark' : ''}"${bg ? ` style="background:${bg};border-bottom-color:${bg}"` : ''}><img src="${esc(localImg(src))}" alt="${esc(n.name)} logo" loading="lazy"></div>`; }
  else if (remote) cover = `<div class="lc-cover brand${n.dark ? ' dark' : ''}"><img src="${esc(remote)}" alt="${esc(n.name)} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
  else {
    cover = `<div class="lc-cover gen"><span>${esc(n.city)}</span></div>`;
    logo = `<span class="lc-logo mono">${esc((n.initials || n.name || '?').slice(0, 3).toUpperCase())}</span>`;
  }
  const rate = num(n.rating) > 0 && num(n.count) > 0 ? `<span class="lc-rate"><b>&#9733; ${num(n.rating).toFixed(1)}</b> <i>(${num(n.count)})</i></span>` : '';
  const tags = (n.tags || []).slice(0, 2).map((t) => `<span>${esc(t)}</span>`).join('');
  const call = n.phone ? `<a class="lc-call" href="tel:${esc(n.phone)}">Call</a>` : '';
  return `<article class="lc">${feat}${cover}${logo}<div class="lc-body"><h3><a href="${esc(n.slug)}">${esc(n.name)}</a></h3>${rate}<div class="lc-addr">${esc(n.address || '')}</div><div class="lc-tags">${tags}</div><div class="lc-btns">${call}<a class="lc-view" href="${esc(n.slug)}">View profile</a></div></div></article>`;
}

function carousel(f, nearby) {
  if (!nearby || !nearby.length) return '';
  return (
    `<section class="lw-car" aria-label="Lawyers in ${esc(f.city)}"><div class="lw-car-head"><h2>Browse other lawyers in ${esc(f.city)}</h2><div class="lw-car-nav"><button type="button" class="lw-prev" aria-label="Previous">&#8249;</button><button type="button" class="lw-next" aria-label="Next">&#8250;</button></div></div><div class="lw-track" tabindex="0">` +
    nearby.map(carouselCard).join('') +
    '</div></section>'
  );
}

function tagline(f) {
  const prov = PROVINCES[f.province] || f.province;
  const tags = (f.tags || []).filter(Boolean).slice(0, 2);
  if (!tags.length) return `Law firm serving ${esc(f.city)}, ${esc(prov)}.`;
  return `${esc(tags.join(' and '))} lawyers serving ${esc(f.city)}, ${esc(prov)}.`;
}

// The search-result description is the first sentence of the firm's own written profile when that sentence reads as a summary
// (50 to 160 characters); otherwise the generic line below is used.
export function metaFromAbout(about) {
  // A full stop after St., Ste., Inc., Ltd. and similar abbreviations, or after a single initial ("Jennifer L. MacDonald"), does not end the sentence.
  const first = String(about || '').trim().split(/(?<!\b(?:St|Ste|Mt|Dr|Mr|Mrs|Ms|Inc|Ltd|Co|Corp|No|vs|Prof|[A-Z])\.)(?<=[.!?])\s+(?=[A-Z"“])/)[0] || '';
  return first.length >= 50 && first.length <= 160 && !/[\n<>]/.test(first) ? first : '';
}

function description(f) {
  const prov = PROVINCES[f.province] || f.province;
  const lead = `${f.name} is a law firm in ${f.city}, ${prov}`;
  const rated = num(f.rating) > 0 && num(f.count) > 0;
  return rated
    ? `${lead} with a ${num(f.rating).toFixed(1)}-star Google rating from ${num(f.count)} reviews. Practice areas, address, phone, directions and reviews on LawDB.`
    : `${lead}. Practice areas, address, phone and directions on LawDB.`;
}

const PHOTO_CSS = '<style>.photos{margin:22px 0}.photos h2{font-size:18px;margin:0 0 10px}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.photo-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block;background:#f7f1e0}</style>';
const BLOCK_CSS = '<style>.article-photo{width:100%;height:auto;border-radius:6px;margin:12px 0;display:block}</style>';

// A small hand-written block under the description ("From the Firm", "Related reading"): headline, teaser, optional picture, one link.
// It comes from the hand-built page this firm used to have (data/firm-blocks.json); every part is checked before it is shown.
const okLink = (u) => typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/[A-Za-z0-9_\-./]*$/.test(u));
function blockHtml(b) {
  if (!b || typeof b !== 'object' || !b.title || !b.teaser || !okLink(b.href)) return '';
  const img = safeUrl(b.image);
  const ext = /^https:/.test(b.href);
  return `\n    <div class="from-firm"><h2>${esc(String(b.heading || 'From the Firm').slice(0, 60))}</h2><div class="post-title">${esc(String(b.title).slice(0, 220))}</div>` +
    (img ? `<img class="article-photo" src="${esc(localImg(img))}" alt="${esc(String(b.alt || '').slice(0, 200))}" loading="lazy">` : '') +
    `<p class="article-teaser">${esc(String(b.teaser).slice(0, 500))}</p><a class="read-link" href="${esc(b.href)}"${ext ? ' target="_blank" rel="noopener nofollow"' : ''}>${esc(String(b.linkText || 'Read more').slice(0, 120))}</a></div>`;
}

const PRACTICE_CSS = '<style>.pa-wrap{margin-bottom:20px}.pa-wrap h2{font-family:\'Source Serif 4\',serif;font-size:16px;margin:0 0 10px}.pa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.pa-card{display:block;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--brass);border-radius:8px;padding:14px 16px;text-decoration:none;color:var(--ink)}.pa-card:hover{border-color:var(--brass);box-shadow:0 2px 10px rgba(42,42,42,0.08)}.pa-card b{display:block;font-size:15px;margin-bottom:4px}.pa-card span{display:block;font-size:12.5px;color:var(--ink-soft);line-height:1.45}.pa-card em{display:block;font-style:normal;font-size:12.5px;font-weight:700;color:var(--brass-deep);margin-top:8px}.pa-tags{list-style:none;margin:0 0 12px;padding:0;display:flex;flex-wrap:wrap;gap:8px}.pa-tags li{background:#f4ecd8;border:1px solid #e6d4a4;border-radius:999px;padding:6px 14px;font:600 13.5px Inter,system-ui,sans-serif;color:#2a2a2a}</style>';

// The "Practice areas" block, right under the description: the areas the firm practises as pills (its own list, or the categories it is filed under when it
// has none), then cards to the province practice pages for its case types (only pages that exist), with how many firms each page compares.
function practiceHtml(f, cards) {
  const tags = (f.tags || []).filter(Boolean);
  const areas = tags.length ? tags : (f.caseTypes || []).map((t) => (PRACTICE[t] ? PRACTICE[t][1] : '')).filter(Boolean);
  if (!areas.length && !cards.length) return '';
  const prov = PROVINCES[f.province] || f.province;
  const list = areas.length ? `<ul class="pa-tags">${areas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  const grid = cards.length ? `<div class="pa-grid">${cards.map((c) => `<a class="pa-card" href="${esc(c.href)}"><b>${esc(c.label)}</b><span>${c.count} ${c.count === 1 ? 'firm' : 'firms'} listed across ${esc(prov)}, compared by real Google ratings.</span><em>Compare all &rarr;</em></a>`).join('')}</div>` : '';
  return `\n    <div class="pa-wrap"><h2>Practice areas</h2>${list}${grid}</div>`;
}

// Two things a visitor wants to know before calling: is the firm taking new clients, and does it do consultations online. Both are set by the firm's owner.
const CHIPS_CSS = '<style>.pf-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0;padding:0;list-style:none}.pf-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 11px;border:1px solid #e6d4a4;border-radius:999px;background:#f4ecd8;color:#2a2a2a;font-size:13px;font-weight:600;line-height:1.4}.pf-chip i{width:8px;height:8px;border-radius:50%;background:#2a2a2a;flex:none}.pf-chip.is-limited i{background:#e2bd6a}.pf-chip.is-closed i{background:#8c8c8c}</style>';
const TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function chipsHtml(f, v) {
  const chips = [];
  if (v) chips.push(`<li class="pf-chip is-verified">${TICK_SVG}<a href="#verified">Verified by LawDB</a></li>`);
  if (Object.hasOwn(AVAILABILITY, f.availability)) chips.push(`<li class="pf-chip is-${f.availability}"><i aria-hidden="true"></i>${esc(AVAILABILITY[f.availability])}</li>`);
  if (f.virtual === true) chips.push('<li class="pf-chip">Virtual consultations available</li>');
  return chips.length ? `        <ul class="pf-chips" aria-label="Good to know">${chips.join('')}</ul>\n` : '';
}

// "Verified by LawDB": what the admin checked, when, and a link to the law society's own directory. It never shows the name or number the firm gave us,
// and says plainly that it is a check made on a date, not an endorsement (see src/lib/verification.js).
const VERIFIED_CSS = '<style>.pf-chip.is-verified{background:#2a2a2a;border-color:#2a2a2a;color:#fffdf8}.pf-chip.is-verified svg{width:14px;height:14px;flex:none;color:#e2bd6a}.pf-chip a{color:inherit;text-decoration:none}.verified{margin:22px 0;padding:16px 18px;border:1px solid #e6d4a4;border-radius:12px;background:#f4ecd8;color:#2a2a2a}.verified h2{display:flex;align-items:center;gap:8px;font-size:18px;margin:0 0 6px}.verified h2 svg{width:20px;height:20px;flex:none}.verified p{margin:6px 0 0;font-size:14.5px;line-height:1.55}.verified ul{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px;font-size:14.5px;line-height:1.5}.verified li:before{content:"\\2713";margin-right:8px;font-weight:700}.verified .vf-note{font-size:13px;color:#5f5f5f}.verified a{color:#2a2a2a;font-weight:600}</style>';
function verifiedHtml(v) {
  if (!v) return '';
  let when = v.at;
  try { const d = new Date(`${v.at}T12:00:00Z`); if (!Number.isNaN(d.getTime())) when = d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { /* keep the plain date */ }
  const items = [
    v.checked.identity && 'The person who manages this profile is who they say they are',
    v.checked.registration && `The lawyer is listed in the ${v.society.name}\u2019s public directory`,
    v.checked.office && 'The office address and phone number match',
  ].filter(Boolean);
  return `\n    <section class="verified" id="verified" aria-label="Verified by LawDB"><h2>${TICK_SVG}Verified by LawDB</h2><p>Checked in ${esc(when)}:</p><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` +
    `<p>Look for yourself: <a href="${esc(v.society.directory)}" target="_blank" rel="noopener nofollow">${esc(v.society.name)} directory</a>.</p>` +
    '<p class="vf-note">This is a check that was made on that date. It is not an endorsement of the firm or its lawyers, and a lawyer\u2019s status can change, so check the directory before you hire anyone.</p></section>';
}
const GLANCE_CSS = '<style>.glance{margin:22px 0}.glance h2{font-size:18px;margin:0 0 10px}.glance dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font-size:15px;line-height:1.5}.glance dt{font-weight:700;color:#5f5f5f}.glance dd{margin:0}.glance ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px 14px}@media(max-width:520px){.glance dl{grid-template-columns:1fr;gap:2px}.glance dd{margin-bottom:8px}}</style>';
const OFFICES_CSS = '<style>.offices{margin:22px 0}.offices h2{font-size:18px;margin:0 0 10px}.offices ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:15px;line-height:1.5}.offices li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.offices .office-name{font-weight:700;color:#2a2a2a}.offices a{color:#2a2a2a;text-decoration:underline;text-decoration-color:#c9a050;text-underline-offset:3px}.offices a:hover{text-decoration-color:#2a2a2a}.offices-note{margin:10px 0 0;font-size:14px;color:#5f5f5f}</style>';
const COMMENTS_CSS = `<style>
.cm{position:relative;margin:26px 0;padding:28px 26px 22px;border-radius:22px;overflow:hidden;color:#fff;background:linear-gradient(135deg,#2a2a2a 0%,#2a2a2a 100%);box-shadow:0 24px 50px -28px #2a2a2a}
.cm::before{content:"\\201C";position:absolute;right:18px;top:-30px;font:700 230px/1 Georgia,serif;color:#3a3a3a;pointer-events:none}
.cm-head{position:relative;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px}
.cm-eyebrow{margin:0 0 6px;font:700 11px/1.2 Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#e2bd6a}
.cm h2{margin:0;font-size:26px;line-height:1.15;color:#fff}
.cm-ctl{display:none;gap:10px;flex:none}
.cm-ar{width:42px;height:42px;padding:0;border-radius:50%;border:1.5px solid #c9a050;background:transparent;color:#e2bd6a;display:grid;place-items:center;cursor:pointer;transition:background .2s,color .2s}
.cm-ar:hover:not([disabled]){background:#c9a050;color:#2a2a2a}
.cm-ar[disabled]{opacity:.35;cursor:default}
.cm-track{position:relative;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.cm-track.n2{grid-template-columns:repeat(2,minmax(0,1fr))}
.cm-track.n1{grid-template-columns:minmax(0,1fr)}
.cm-track.n1 blockquote{max-width:46em}
.cm-card{position:relative;margin:0;padding:26px 20px 18px;border-radius:16px;background:#2a2a2a;border:1px solid #3a3a3a;display:flex;flex-direction:column;gap:14px;transition:transform .25s,border-color .25s}
.cm-card:hover{transform:translateY(-3px);border-color:#c9a050}
.cm-card::before{content:"";position:absolute;left:20px;top:-1px;width:44px;height:3px;border-radius:0 0 3px 3px;background:#e2bd6a}
.cm-card blockquote{margin:0;font:400 16px/1.6 "Source Serif 4",Georgia,serif;color:#fff}
.cm-card blockquote::before{content:"\\201C";color:#e2bd6a;font-size:1.35em;line-height:0;margin-right:3px;vertical-align:-.25em}
.cm-js .cm-card:not(.open) blockquote{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:8;line-clamp:8;overflow:hidden}
.cm-foot{margin-top:auto;display:flex;flex-direction:column;align-items:flex-start;gap:10px}
.cm-more{display:none;padding:0 0 1px;border:0;border-bottom:1px solid #c9a050;background:none;color:#e2bd6a;font:600 13.5px Inter,sans-serif;cursor:pointer}
.cm-js .cm-card.cut .cm-more{display:inline-block}
.cm-more:hover{color:#fff}
.cm-by{font:600 13px Inter,sans-serif;color:#e2bd6a}
.cm-by::before{content:"\\2014\\00a0"}
.cm-dots{display:none;justify-content:center;gap:8px;margin-top:16px}
.cm-dots button{width:8px;height:8px;padding:0;border:0;border-radius:99px;background:#3a3a3a;cursor:pointer;transition:width .3s,background .3s}
.cm-dots button[aria-current="true"]{width:26px;background:#e2bd6a}
.cm-note{position:relative;margin:18px 0 0;font-size:12.5px;line-height:1.55;color:#bdbdbd}
.cm-note a{color:#e2bd6a;font-weight:600}
.cm-track:focus-visible,.cm-ar:focus-visible,.cm-more:focus-visible,.cm-dots button:focus-visible{outline:2px solid #e2bd6a;outline-offset:3px}
@media(max-width:760px){
.cm{padding:24px 16px 20px}
.cm h2{font-size:22px}
.cm-ctl{display:flex}
.cm-dots{display:flex}
.cm-track,.cm-track.n2,.cm-track.n1{display:flex;align-items:flex-start;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;padding:4px 2px 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.cm-track::-webkit-scrollbar{display:none}
.cm-card{flex:0 0 88%;scroll-snap-align:center}
.cm-js .cm-card:not(.open) blockquote{-webkit-line-clamp:7;line-clamp:7}
.cm-track.n1 .cm-card{flex-basis:100%}
.cm-card:hover{transform:none}
}
@media(prefers-reduced-motion:reduce){.cm-card,.cm-ar,.cm-dots button{transition:none}}
</style>`;
// The behaviour of the section: "See more" on a comment that is cut short, and on phones the strip (swipe, arrows, dots and arrow keys move the same strip).
// Without JavaScript nothing is cut short and the cards simply show the whole comment.
const COMMENTS_JS = "<script>(function(){var s=document.currentScript.parentNode,t=s.querySelector('.cm-track'),c=t.children,p=s.querySelector('[data-cm=prev]'),n=s.querySelector('[data-cm=next]'),d=s.querySelectorAll('.cm-dots button'),rm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches,q=0;s.classList.add('cm-js');" +
  "function fit(){var k,e,b;for(k=0;k<c.length;k++){e=c[k];if(e.classList.contains('open'))continue;b=e.querySelector('blockquote');e.classList.toggle('cut',b.scrollHeight>b.clientHeight+1)}}" +
  "function at(){var m=t.scrollLeft+t.clientWidth/2,b=0,x=1e9,k,y;for(k=0;k<c.length;k++){y=Math.abs(c[k].offsetLeft+c[k].offsetWidth/2-m);if(y<x){x=y;b=k}}return b}" +
  "function go(i){i=Math.max(0,Math.min(c.length-1,i));t.scrollTo({left:c[i].offsetLeft+c[i].offsetWidth/2-t.clientWidth/2,behavior:rm?'auto':'smooth'})}" +
  "function sync(){q=0;var i=at(),k;for(k=0;k<d.length;k++)d[k].setAttribute('aria-current',k===i?'true':'false');if(p)p.disabled=i===0;if(n)n.disabled=i===c.length-1}" +
  "s.addEventListener('click',function(e){var m=e.target.closest&&e.target.closest('.cm-more');if(!m)return;var card=m.closest('.cm-card'),o=card.classList.toggle('open');m.textContent=o?'See less':'See more';m.setAttribute('aria-expanded',o?'true':'false');if(!o)fit()});" +
  "t.addEventListener('scroll',function(){if(!q)q=requestAnimationFrame(sync)},{passive:true});" +
  "if(p)p.addEventListener('click',function(){go(at()-1)});if(n)n.addEventListener('click',function(){go(at()+1)});" +
  "d.forEach(function(b,k){b.addEventListener('click',function(){go(k)})});" +
  "t.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){e.preventDefault();go(at()-1)}else if(e.key==='ArrowRight'){e.preventDefault();go(at()+1)}});" +
  "window.addEventListener('resize',function(){fit();sync()});window.addEventListener('load',fit);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);fit();sync()})()</script>";
// "What clients say": up to three comments the firm itself publishes on its own website (see src/lib/comments.js), chosen to be about the same length.
// Three cards side by side on a wide screen; a swipeable strip with arrows and dots on a phone. A comment that is longer than a few lines is cut with
// "See more". Only a reviewer's name (first name and last initial) is shown, never a label like "A client"; one link under the section goes to the page the
// firm published them on. A firm whose record says commentsOff shows none. LawDB has not verified the comments, and the section says so.
export function commentsHtml(f) {
  if (f.commentsOff === true) return '';
  const list = cleanComments(f.comments, { website: f.website });
  if (!list) return '';
  const many = list.length > 1;
  const cards = list.map((c, i) => `<figure class="cm-card" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${list.length}"><blockquote>${esc(c.text)}</blockquote><div class="cm-foot"><button type="button" class="cm-more" aria-expanded="false">See more</button>${c.author ? `<figcaption class="cm-by">${esc(c.author)}</figcaption>` : ''}</div></figure>`).join('');
  const arrow = (dir, label, d) => `<button type="button" class="cm-ar" data-cm="${dir}" aria-label="${label}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg></button>`;
  const ctl = many ? `<div class="cm-ctl">${arrow('prev', 'Previous comment', 'M15 5l-7 7 7 7')}${arrow('next', 'Next comment', 'M9 5l7 7-7 7')}</div>` : '';
  const dots = many ? `<div class="cm-dots">${list.map((_, i) => `<button type="button" aria-label="Show comment ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>` : '';
  return `\n    <section class="cm" aria-labelledby="cmH" aria-roledescription="carousel"><div class="cm-head"><div><p class="cm-eyebrow">Client comments</p><h2 id="cmH">What clients say</h2></div>${ctl}</div><div class="cm-track n${list.length}" tabindex="0" role="group" aria-label="Client comments">${cards}</div>${dots}<p class="cm-note">Shown as the firm published them. LawDB has not verified these comments. <a href="${esc(list[0].url)}" target="_blank" rel="nofollow noopener">Read more on the firm&rsquo;s website &#8599;</a> &middot; Firm owner? <a href="/contact">Ask us to change or remove this</a>.</p>${COMMENTS_JS}</section>`;
}
const IMG_ID = /^[0-9a-f]{24}$/;

// Facts the firm's own website states (see src/lib/details.js): shown as a plain list, never as claims of our own.
function glanceHtml(f) {
  const d = cleanDetails(f.details);
  if (!d) return '';
  const row = (label, html) => `<dt>${label}</dt><dd>${html}</dd>`;
  const rows = [
    d.founded ? row('Founded', String(d.founded)) : '',
    d.lawyers ? row('Lawyers named by the firm', `<ul>${d.lawyers.map((l) => `<li>${esc(l.name)}${l.title ? ` <span style="color:#5f5f5f">(${esc(l.title)})</span>` : ''}</li>`).join('')}</ul>`) : '',
    d.languages ? row('Languages', esc(d.languages.join(', '))) : '',
    d.serving ? row('Places served', esc(d.serving.join(', '))) : '',
    d.areas ? row('Areas of law listed', `<ul>${d.areas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`) : '',
  ].filter(Boolean);
  return rows.length ? `\n    <section class="glance" aria-label="${esc(f.name)} at a glance"><h2>At a glance</h2><dl>${rows.join('')}</dl></section>` : '';
}

// Every office of the firm, each address a link to directions. Shown only when the record has offices (most firms have one address).
function officesHtml(f) {
  const offices = (Array.isArray(f.offices) ? f.offices : []).filter((o) => o && typeof o.address === 'string' && o.address.trim()).slice(0, 8);
  if (!offices.length) return '';
  const items = offices.map((o) => {
    const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address.trim()).replace(/%20/g, '+')}`;
    return `<li>${o.name ? `<span class="office-name">${esc(o.name)}</span>` : ''}<a href="${esc(dir)}" target="_blank" rel="noopener">${esc(o.address.trim())}</a></li>`;
  }).join('');
  const note = f.appointmentOnly ? '<p class="offices-note">All offices are by appointment only.</p>' : '';
  return `\n    <section class="offices" aria-label="${esc(f.name)} offices"><h2>Offices</h2><ul>${items}</ul>${note}</section>`;
}

// The firm's other office pages (a firm with an office in several cities has one page per office): links to the other live pages, main page first.
function locationsHtml(f, locations) {
  const list = (Array.isArray(locations) ? locations : []).filter((l) => l && l.slug && l.slug !== f.slug).slice(0, 12);
  if (!list.length) return '';
  const items = list.map((l) => `<li><a href="/firms/${esc(l.slug)}" class="office-name">${esc(l.name)}</a><span>${esc([l.city, PROVINCES[l.province] ? l.province : ''].filter(Boolean).join(', '))}</span></li>`).join('');
  return `\n    <section class="offices other-locations" aria-label="Other ${esc(f.name)} locations"><h2>Other locations</h2><ul>${items}</ul></section>`;
}

// "199 Bay St #5300, Toronto, ON M5L 1B9" -> street, and postal code, the way schema.org wants them.
function postal(f) {
  const a = String(f.address || '');
  const m = a.match(/^(.*?),\s*([^,]+?),\s*([A-Z]{2})\s+([A-Z]\d[A-Z][ -]?\d[A-Z]\d)\s*$/i);
  const street = m && m[3].toUpperCase() === f.province ? m[1] : a;
  return { '@type': 'PostalAddress', streetAddress: street, addressLocality: f.city, addressRegion: f.province, ...(m && m[3].toUpperCase() === f.province ? { postalCode: m[4].toUpperCase().replace(/^(\w{3})-?(\w{3})$/, '$1 $2') } : {}), addressCountry: 'CA' };
}

// The Location card on a profile, right under the contact card ("Contact <firm>" / Send message): the map (MapLibre, drawn in the same green, Google-style look as the Find page
// map: map-style.js) and under it the address with a Directions link. The map shows the office pin only: no shaded service-area circle
// (the owner does not want one anywhere on the site). The site has no Google Maps key, so the map is drawn here. A firm with no usable coordinates still gets the address row.
function firmMapHtml(f) {
  const lat = Number(f.lat), lng = Number(f.lng);
  const script = `(function(){var lng=${lng},lat=${lat};` +
    "window.addEventListener('load',function(){var el=document.getElementById('firmMap');if(!el||!window.maplibregl)return;" +
    "var st=window.LawdbMapStyle?window.LawdbMapStyle.load('bright'):Promise.resolve('https://tiles.openfreemap.org/styles/bright');" +
    "st.then(function(style){var map=new maplibregl.Map({container:el,style:style,center:[lng,lat],zoom:14,dragRotate:false,touchPitch:false});" +
    "map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');" +
    "map.on('load',function(){" +
    "new maplibregl.Marker({color:'#c9a050'}).setLngLat([lng,lat]).addTo(map);});});});})();";
  return '<div class="pf-map">\n      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.12.0/maplibre-gl.min.css">\n' +
    '      <style>.firm-map{overflow:hidden;background:#dcefd4;max-width:100%}</style>\n' +
    '      <script src="/map-style.js" defer></script>\n' +
    `      <div id="firmMap" class="firm-map" role="img" aria-label="Map of ${esc(f.name)} and the area around its office"></div>\n` +
    '      <script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.12.0/maplibre-gl.min.js" defer></script>\n' +
    `      <script>${script}</script>\n    </div>`;
}

function locationHtml(f, { dir, withMap }) {
  const addr = f.address ? `<div class="pf-addr">${C.ICONS.pin}<span><b>${esc(f.address)}</b></span><a class="pf-btn pf-sm pf-dir" href="${esc(dir)}" target="_blank" rel="noopener">Directions</a></div>` : '';
  const map = withMap ? firmMapHtml(f) : '';
  if (!map && !addr) return '';
  return `<section class="pf-loc" aria-label="Location of ${esc(f.name)}">\n      ${map}${addr}\n    </section>`;
}

// ---- the page frame, as on MSPdatabase: a breadcrumb above the card, and a "firms you may like" column beside the page on a wide screen ----
const PROV_SLUG = { ON: 'ontario', QC: 'quebec', BC: 'british-columbia', AB: 'alberta', MB: 'manitoba' };
const citySlug = (c) => String(c).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// +14168268610 -> (416) 826-8610 for display; the tel: link keeps the stored number. Anything that is not a plain North American number is shown as stored.
const showPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); const m = d.length === 11 && d[0] === '1' ? d.slice(1) : d; return m.length === 10 ? `(${m.slice(0, 3)}) ${m.slice(3, 6)}-${m.slice(6)}` : String(p || ''); };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const rootImg = (u) => (/^https:/.test(u) || u.startsWith('/') ? u : `/${u}`);
const SVG = (inner) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const IC = {
  link: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  msg: SVG('<path d="M4 5.5h16v11H9.5L5 20.5v-4H4z"/>'),
  out: SVG('<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>'),
};

function breadcrumb(f, prov, extra = []) {
  const ps = PROV_SLUG[f.province];
  const cs = citySlug(f.city);
  const sep = '<span class="sep" aria-hidden="true">&rsaquo;</span>';
  return '<nav class="pf-crumb" aria-label="Breadcrumb">' +
    `<a class="pf-crumb-home" href="/" aria-label="LawDB home"><img src="/images/logo-icon.png" alt="" width="20" height="20"></a>${sep}` +
    `<a href="/find-lawyers">Canada</a>${sep}` +
    (ps ? `<a href="/${ps}/">${esc(prov)}</a>` : `<span>${esc(prov)}</span>`) + sep +
    (ps && CITY_HUBS.has(`${ps}/${cs}`) ? `<a href="/${ps}/${cs}/">${esc(f.city)}</a>` : `<span>${esc(f.city)}</span>`) +
    (extra.length ? sep + `<a href="/firms/${esc(f.slug)}">${esc(f.name)}</a>` + extra.map(([label, href]) => sep + (href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`)).join('') : '') +
    '</nav>';
}

// "Firms you may like": three nearby firms with a Follow button. Beside the page on a wide screen; on a phone the "other lawyers" row at the bottom does this job.
function likeAside(nearby) {
  const rows = (nearby || []).slice(0, 3).map((n) => {
    const src = safeUrl(n.src), remote = safeUrl(n.logoUrl);
    const av = src ? `<img src="${esc(rootImg(src))}" alt="" loading="lazy">` : remote ? `<img src="${esc(remote)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : monogram(n);
    const sub = (n.tags || []).filter(Boolean)[0] || 'Law practice';
    return `<div class="pf-like-row"><a class="pf-like-av" href="/firms/${esc(n.slug)}" tabindex="-1" aria-hidden="true">${av}</a><div class="pf-like-t"><a href="/firms/${esc(n.slug)}"><b>${esc(n.name)}</b></a><span>${esc(sub)} &middot; ${esc(n.city)}</span><button class="lw-fbtn pf-btn pf-sm" type="button" data-follow="${esc(n.slug)}">+ Follow</button></div></div>`;
  }).join('');
  return rows ? `\n   <aside class="pf-aside" aria-label="Firms you may like"><section class="pf-like"><h2>Firms you may like</h2>${rows}</section></aside>` : '';
}

// The Request a consultation buttons (the one in the header card and the one in the bar at the bottom of a phone) open the contact form they scroll to.
// A visitor who arrives from LawDB AI's "Request consultation" button has a short, neutral note about the need put in the message box (the form opens).
const CONTACT_JS = "<script>(function(){var bs=document.querySelectorAll('[data-open-contact]'),s=document.querySelector('.lead-slim');if(s)for(var i=0;i<bs.length;i++)bs[i].addEventListener('click',function(){s.classList.add('open');});var q=new URLSearchParams(location.search),a=(q.get('ask')||'').slice(0,240),m=document.querySelector('.lead-slim textarea[name=message]');if(a&&m&&s){if(!m.value)m.value=(q.get('lang')==='fr'?'Bonjour, j\\u2019ai trouv\\u00e9 votre cabinet gr\\u00e2ce \\u00e0 LawDB AI. (J\\u2019\\u00e9cris en fran\\u00e7ais.) ':'Hello, I found your firm through LawDB AI. ')+a;s.classList.add('open');}})();</script>";


// On a phone a bar stays at the bottom with Call and Request a consultation, as on lawdb.ai. Another tab of the firm sends the button to the contact form on the Overview.
function stickyBar(f, tab) {
  const call = f.phone ? `<a class="sk-call" href="tel:${esc(f.phone)}" aria-label="Call ${esc(f.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>Call</a>` : '';
  const ask = tab === 'overview' ? '<a class="sk-msg" href="#contact" data-open-contact>Request a consultation</a>' : `<a class="sk-msg" href="/firms/${esc(f.slug)}#contact">Request a consultation</a>`;
  return `<div class="pf-sticky">${call}${ask}</div>\n  `;
}
// ---- the tabs of a firm's profile: Overview (the firm's own address) and Lawyers (/lawyers), and a page for each lawyer with enough to say (/lawyers/<lawyer>) ----
const TABS_CSS = '<style>.pf-tabs{display:flex;gap:4px;margin:0 0 20px;border-bottom:1px solid #ece6d3;overflow-x:auto;scrollbar-width:none}.pf-tabs::-webkit-scrollbar{display:none}.pf-tabs a{flex:none;display:inline-flex;align-items:center;gap:7px;padding:12px 16px;font:600 15px Inter,sans-serif;color:#5f5f5f;text-decoration:none;border-bottom:3px solid transparent;margin-bottom:-1px;white-space:nowrap}.pf-tabs a:hover{color:#2a2a2a}.pf-tabs a[aria-current="page"]{color:#2a2a2a;border-bottom-color:#c9a050}.pf-tabs .n{font:700 12px Inter,sans-serif;background:#f4ecd8;color:#c9a050;border-radius:999px;padding:2px 8px}' +
  '.pf-h1{margin:0 0 8px;font:700 clamp(24px,3vw,32px)/1.15 "Source Serif 4",Georgia,serif;color:#2a2a2a}.pf-lede{margin:0 0 18px;color:#5f5f5f;font-size:15.5px;line-height:1.55}.pf-note{margin:6px 0 24px;font-size:13.5px;line-height:1.5;color:#5f5f5f}.pf-note a{color:#c9a050;font-weight:600}' +
  '.lw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin:0 0 18px}.lw-person{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid #ece6d3;border-radius:14px;padding:14px}.lw-av{flex:none;width:64px;height:64px;border-radius:50%;background:#2a2a2a;color:#e2bd6a;display:grid;place-items:center;font:700 20px "Source Serif 4",Georgia,serif;overflow:hidden}.lw-av img{width:100%;height:100%;object-fit:cover;display:block}.lw-av-lg{width:96px;height:96px;font-size:30px}' +
  '.lw-person b{display:block;font:700 16px/1.25 Inter,sans-serif;color:#2a2a2a}.lw-person b a{color:inherit;text-decoration:none}.lw-person b a:hover{text-decoration:underline;text-decoration-color:#c9a050;text-underline-offset:3px}.lw-person span.t{display:block;margin-top:3px;font:500 13.5px/1.4 Inter,sans-serif;color:#5f5f5f}.lw-person span.f{display:block;margin-top:5px;font:500 12.5px/1.4 Inter,sans-serif;color:#5f5f5f}.lw-person .lw-feat{display:inline-block;margin:0 0 5px;font:700 10.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;background:#c9a050;color:#2a2a2a;border-radius:999px;padding:2px 9px}.lw-person .call{display:block;margin-top:6px;font:700 13.5px Inter,sans-serif;color:#2a2a2a;text-decoration:none}.lw-person a.call:hover{color:#c9a050}.lw-person .go{display:inline-block;margin-top:8px;font:700 13px Inter,sans-serif;color:#c9a050;text-decoration:none}' +
  '.pf-lawyers{margin:22px 0}.pf-lawyers h2{font-size:18px;margin:0 0 10px}.pf-lawyers ul{margin:0 0 10px;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px}.pf-lawyers li a,.pf-lawyers li span{display:inline-block;padding:7px 12px;border:1px solid #ece6d3;border-radius:999px;background:#fff;font:600 14px Inter,sans-serif;color:#2a2a2a;text-decoration:none}.pf-lawyers li a:hover{border-color:#c9a050}.pf-lawyers .all{font:700 14px Inter,sans-serif;color:#c9a050;text-decoration:none}' +
  '.lp-head{display:flex;gap:18px;align-items:center;margin:0 0 16px}.lp-head .pf-h1{margin:0}.lp-head .t{margin:4px 0 0;color:#5f5f5f;font:500 15.5px/1.4 Inter,sans-serif}.lp-facts{margin:18px 0;display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font-size:15px;line-height:1.5}.lp-facts dt{font-weight:700;color:#5f5f5f}.lp-facts dd{margin:0}.lp-links{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px}.lp-back{margin:0 0 18px}.lp-back a{font:700 14px Inter,sans-serif;color:#c9a050;text-decoration:none}@media(max-width:520px){.lp-facts{grid-template-columns:1fr;gap:2px}.lp-facts dd{margin-bottom:8px}.lp-head{flex-direction:column;align-items:flex-start}}.lc-box{margin:26px 0;background:#fff;border:1px solid #ece6d3;border-radius:18px;overflow:hidden;scroll-margin-top:84px}.lc-bar{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;justify-content:space-between;padding:18px 22px;background:#f7f1e0}.lc-bar h2{margin:0;font:700 20px/1.25 "Source Serif 4",Georgia,serif;color:#2a2a2a}.lc-bar .pf-btn{flex:none}.lc-panel{padding:20px 22px 22px;border-top:1px solid #ece6d3}.lc-panel[hidden]{display:none}.lc-intro{margin:0 0 14px;font:500 14.5px/1.55 Inter,sans-serif;color:#5f5f5f}.lc-status{display:flex;gap:10px;align-items:flex-start;margin:0 0 16px;padding:12px 14px;border:1px solid #ece6d3;border-radius:12px;background:#fffdf8;font:500 13.5px/1.5 Inter,sans-serif;color:#5f5f5f}.lc-status.ok{border-color:#e6d4a4;background:#f7f1e0;color:#3a3a3a}.lc-status i{flex:none;width:10px;height:10px;margin-top:5px;border-radius:50%;background:#bdbdbd}.lc-status.ok i{background:#c9a050}.lc-status b{color:#2a2a2a}.lc-status a,.lc-intro a{color:#c9a050;font-weight:700}.lc-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 12px}.lc-panel label{display:block;font:600 12.5px Inter,sans-serif;color:#5f5f5f}.lc-panel input,.lc-panel select{display:block;width:100%;margin-top:5px;padding:12px;border:1px solid #ece6d3;border-radius:10px;background:#fffdf8;font:500 15px Inter,sans-serif;color:#2a2a2a;box-sizing:border-box}.lc-panel input:focus,.lc-panel select:focus{outline:2px solid #e6d4a4;outline-offset:1px;border-color:#c9a050}.lc-panel .pf-btn{width:100%;justify-content:center}.lc-fine{margin:10px 0 0;font:500 12.5px/1.5 Inter,sans-serif;color:#8c8c8c}.lc-msg{margin:10px 0 0;min-height:1.4em;font:600 14px/1.5 Inter,sans-serif;color:#5f5f5f}.lc-msg.err{color:#2a2a2a}.lc-done{padding:20px 22px;border:1px solid #e6d4a4;border-radius:14px;background:#f7f1e0}.lc-done h3{margin:0 0 8px;font:700 19px/1.25 "Source Serif 4",Georgia,serif;color:#2a2a2a}.lc-done p{margin:0 0 8px;font:500 14.5px/1.55 Inter,sans-serif;color:#3a3a3a}.lc-done p:last-child{margin:0}@media(max-width:560px){.lc-row{grid-template-columns:1fr}.lc-bar{padding:16px}.lc-bar .pf-btn{width:100%;justify-content:center}.lc-panel{padding:18px 16px 20px}}</style>';

// first letter of the first name and of the last name ("Martin Y. St-Onge" -> MS, not MY)
const initialsOf = (n) => { const w = String(n).split(/\s+/).filter((x) => /^\p{Lu}/u.test(x)); return ((w[0] || '')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); };
function lawyerAvatar(l, big) {
  return `<span class="lw-av${big ? ' lw-av-lg' : ''}">${l.photo ? `<img src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy" referrerpolicy="no-referrer" width="96" height="96">` : esc(initialsOf(l.name))}</span>`;
}
const joinAnd = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');

// The pages of a firm's profile: the Overview first, then each page the firm has (Lawyers, Articles; a Jobs page will be one more entry here). The bar shows only
// when there is more than one. Each tab is a plain link to its own page.
function profileTabs(f, lw, articles) {
  const base = `/firms/${f.slug}`;
  return [
    { k: 'overview', label: 'Overview', href: base },
    ...(lw.length ? [{ k: 'lawyers', label: 'Lawyers', n: lw.length, href: `${base}/lawyers` }] : []),
    ...(articlesTabOn(articles) ? [{ k: 'articles', label: 'Articles', n: articles.length, href: `${base}/articles` }] : []),
  ];
}
function tabsHtml(f, tabs, tab) {
  if (tabs.length < 2) return '';
  const here = tab === 'lawyer' ? 'lawyers' : tab; // a lawyer's own page is under the Lawyers tab
  return `<nav class="pf-tabs" aria-label="${esc(f.name)} sections">${tabs.map((t) => `<a href="${esc(t.href)}"${t.k === here ? ' aria-current="page"' : ''}>${esc(t.label)}${t.n ? ` <span class="n">${t.n}</span>` : ''}</a>`).join('')}</nav>`;
}

// On the Overview: the lawyers by name, linking to the Lawyers page and to each lawyer's own page.
function lawyersTeaser(f, lw) {
  if (!lw.length) return '';
  const shown = lw.slice(0, 8).map((l) => `<li>${lawyerHasPage(l) ? `<a href="/firms/${esc(f.slug)}/lawyers/${esc(l.slug)}">${esc(l.name)}</a>` : `<span>${esc(l.name)}</span>`}</li>`).join('');
  return `\n    <section class="pf-lawyers" aria-label="Lawyers at ${esc(f.name)}"><h2>Lawyers at ${esc(f.name)}</h2><ul>${shown}</ul><a class="all" href="/firms/${esc(f.slug)}/lawyers">${lw.length > 8 ? `See all ${lw.length} lawyers` : 'See the lawyers page'} &rarr;</a></section>`;
}

// What the page says about where the facts come from: the firm confirmed them, or they were read from its own website. Neither is checked with the law society.
function lawyerNote(list) {
  const tell = 'Something to correct or remove? <a href="/contact">Tell us</a>.';
  if (list.length && list.every((x) => x.confirmed)) return `Confirmed by the firm and not checked with the law society. ${tell}`;
  if (list.some((x) => x.confirmed)) return `Some details were confirmed by the firm; the rest are taken from its own website. None is checked with the law society. ${tell}`;
  return `Taken from the firm's own website and not checked with the law society. ${tell}`;
}

// "Things to consider" on a lawyer's page (src/lib/why-consider.js): the lawyer's background, each fact once and only when we have it; no section when there is nothing to say.
function considerHtml(l) {
  const { facts, achievements } = considerLawyer(l);
  if (!facts.length && !achievements.length) return '';
  const title = `Things to consider about ${l.name}`;
  return `\n    <section class="pf-why" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${facts.length ? `<ul>${facts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${achievements.length ? `<h3>Awards and achievements</h3><ul>${achievements.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`;
}
const callLink = (l, cls) => (l.phone ? `<a class="${cls}" href="tel:${esc(l.phone)}">Call ${esc(showPhone(l.phone))}</a>` : '');

function lawyersTabHtml(f, lw, prov) {
  const cards = lw.map((l) => {
    const has = lawyerHasPage(l);
    const p = inPractice(l.callYear);
    const facts = [p ? (p.years >= 2 ? `${p.years} years in practice` : `In practice ${p.text}`) : '', l.languages ? joinAnd(l.languages) : ''].filter(Boolean).join(' · ');
    return `<li class="lw-person">${lawyerAvatar(l)}<div>${l.featured ? '<span class="lw-feat">Featured</span>' : ''}<b>${has ? `<a href="/firms/${esc(f.slug)}/lawyers/${esc(l.slug)}">${esc(l.name)}</a>` : esc(l.name)}</b>${l.title ? `<span class="t">${esc(l.title)}</span>` : ''}${facts ? `<span class="f">${esc(facts)}</span>` : ''}${callLink(l, 'call')}${has ? `<a class="go" href="/firms/${esc(f.slug)}/lawyers/${esc(l.slug)}">View profile &rarr;</a>` : ''}</div></li>`;
  }).join('');
  // no lead sentence: the heading, the tab's count and the firm's own page already say who the lawyers are and what the firm does
  return `\n    <h1 class="pf-h1">Lawyers at ${esc(f.name)}</h1>\n    <ul class="lw-grid" style="list-style:none;padding:0">${cards}</ul>${claimHtml(f, lw)}\n    <p class="pf-note">${lawyerNote(lw)}</p>`;
}

// "Are you a lawyer at ...?": one heading and one button under the lawyers, and nothing else on the page (a block of the same sentences on every firm's page would be
// repeated text for search engines). The form is built by /lawyer-claim.js when the button is pressed, from the data on the section: the firm, its lawyers (for the "which
// lawyer are you?" list), whether it is Featured and the two prices. Without JavaScript the button is a link to the lawyers section of For Law Firms. The request goes to
// the admin (form "lawyer-claim"), who checks the person against the law society before anything changes.
function claimHtml(f, lw) {
  const data = esc(JSON.stringify(lw.map((l) => [l.slug, l.name])));
  return `\n    <section class="lc-box" id="claim-lawyer" data-claim-box data-firm="${esc(f.slug)}" data-firm-name="${esc(f.name)}" data-featured="${f.featured ? 1 : 0}" data-firm-price="${FIRM_PRICE}" data-lawyer-price="${LAWYER_PRICE}" data-lawyers="${data}"><div class="lc-bar"><h2>Are you a lawyer at ${esc(f.name)}?</h2><a class="pf-btn pf-primary" href="/for-firms#lawyers" data-claim-open aria-expanded="false" aria-controls="lc-panel">Claim your listing</a></div><div class="lc-panel" id="lc-panel" hidden></div><script src="/lawyer-claim.js" defer></script></section>`;
}

function articlesPageHtml(f, articles, prov) {
  return `\n    <h1 class="pf-h1">Articles by ${esc(f.name)}</h1>\n    <p class="pf-lede">${articles.length} recent articles by ${esc(f.name)}, a firm in ${esc(f.city)}, ${esc(prov)}. Each shows the headline and a short preview the firm published; the full article is on ${esc(f.name)}'s own website.</p>\n    ${renderArticlesList({ firmName: f.name, articles })}\n    <p class="pf-note">The articles belong to ${esc(f.name)}. LawDB shows the headline and a short preview and links to the firm's own page. This is general information, not legal advice.</p>`;
}

function lawyerPageHtml(f, lw, l, prov) {
  const others = lw.filter((x) => x.slug !== l.slug).slice(0, 6).map((x) => `<li>${lawyerHasPage(x) ? `<a href="/firms/${esc(f.slug)}/lawyers/${esc(x.slug)}">${esc(x.name)}</a>` : `<span>${esc(x.name)}</span>`}</li>`).join('');
  const links = callLink(l, 'pf-btn') + (l.linkedin ? `<a class="pf-btn" href="${esc(l.linkedin)}" target="_blank" rel="noopener nofollow">LinkedIn</a>` : '') + (l.site ? `<a class="pf-btn" href="${esc(l.site)}" target="_blank" rel="noopener nofollow">On the firm's website</a>` : '') + `<a class="pf-btn pf-primary" href="/firms/${esc(f.slug)}#contact">Request a consultation</a>`;
  // The heading already says who the lawyer is and where they work, so the page does not say it again: what follows is only what is not already on the page.
  return `\n    <p class="lp-back"><a href="/firms/${esc(f.slug)}/lawyers">&larr; All lawyers at ${esc(f.name)}</a></p>\n    <div class="lp-head">${lawyerAvatar(l, true)}<div><h1 class="pf-h1">${esc(l.name)}</h1>${l.title ? `<p class="t">${esc(l.title)} at <a href="/firms/${esc(f.slug)}" style="color:inherit">${esc(f.name)}</a>, ${esc(f.city)}, ${esc(prov)}</p>` : ''}</div></div>${considerHtml(l)}\n    <div class="lp-links">${links}</div>\n    ${others ? `<section class="pf-lawyers" aria-label="More lawyers at ${esc(f.name)}"><h2>More lawyers at ${esc(f.name)}</h2><ul>${others}</ul><a class="all" href="/firms/${esc(f.slug)}/lawyers">See all lawyers &rarr;</a></section>` : ''}\n    <p class="pf-note">${lawyerNote([l])}</p>`;
}

export function renderFirmPage({ firm: f, hours, images = [], articles = [], nearby = [], locations = [], origin = 'https://lawdb.ca', stats = null, verified = null, view = null }) {
  const prov = PROVINCES[f.province] || f.province;
  const customCover = /^img\/[0-9a-f]{24}$/.test(f.heroImage || '');
  const ogImage = customCover ? `${origin}/${f.heroImage}` : `${origin}/images/og-default.jpg`;
  // Which page of the profile: the Overview, the Lawyers page, or one lawyer's page. null when that page has nothing to show (the route answers 404, never an empty page).
  const lw = lawyersOf(f);
  const tabs = profileTabs(f, lw, articles);
  const tab = view && view.tab === 'lawyers' ? 'lawyers' : view && view.tab === 'lawyer' ? 'lawyer' : view && view.tab === 'articles' ? 'articles' : 'overview';
  const lawyer = tab === 'lawyer' ? lw.find((x) => x.slug === view.lawyer) : null;
  if ((tab === 'lawyers' && !lw.length) || (tab === 'lawyer' && !(lawyer && lawyerHasPage(lawyer))) || (tab === 'articles' && !articlesTabOn(articles))) return null;
  const base = `${origin}/firms/${f.slug}`;
  const url = tab === 'overview' ? base : tab === 'lawyers' ? `${base}/lawyers` : tab === 'articles' ? `${base}/articles` : `${base}/lawyers/${lawyer.slug}`;
  const about = typeof f.about === 'string' ? f.about.trim() : '';
  // The search result shows about 155 characters: as many names as fit, then "and N more".
  const lawyersDesc = () => {
    const where = `${f.name} in ${f.city}, ${PROVINCES[f.province] || f.province}`;
    const build = (k) => `${lw.length} lawyers at ${where}: ${joinAnd(lw.slice(0, k).map((l) => l.name))}${lw.length > k ? ` and ${lw.length - k} more` : ''}. Titles and details on LawDB.`;
    let k = Math.min(4, lw.length);
    while (k > 1 && build(k).length > 158) k--;
    const d = build(k);
    return d.length <= 160 ? d : `The ${lw.length} lawyers at ${where}, with their titles and details, on LawDB.`.slice(0, 160);
  };
  // the longest of these that fits a search result
  const lawyerDesc = () => {
    const prov = PROVINCES[f.province] || f.province;
    const tries = [`${lawyerLead(lawyer, f, prov)} See the profile on LawDB.`, lawyerLead(lawyer, f, prov), `${lawyer.name}${lawyer.title ? `, ${lawyer.title}` : ''} at ${f.name} in ${f.city}, ${prov}.`, `${lawyer.name} at ${f.name} in ${f.city}, ${prov}.`];
    return tries.find((d) => d.length <= 160) || tries[3].slice(0, 160);
  };
  // as many headlines as fit in a search result, then fewer
  const articlesDesc = () => {
    const where = `${f.name} in ${f.city}, ${PROVINCES[f.province] || f.province}`;
    const cut = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t);
    const stop = (t) => (/[.!?\u2026]$/.test(t) ? t : t + '.'); // a headline that ends in ? or ! needs no full stop after it
    const heads = articles.slice(0, 2).map((a) => cut(a.title, 55));
    const tries = [`${articles.length} recent articles by ${where}: ${heads.map((h, i) => (i < heads.length - 1 ? h.replace(/[.!?]$/, '') : h)).join('; ')}`, `${articles.length} recent articles by ${where}: ${heads[0]}`, `Recent articles by ${where}`].map((d) => `${stop(d)} Previews on LawDB.`);
    return tries.find((d) => d.length <= 160) || tries[2].slice(0, 160);
  };
  const desc = tab === 'overview' ? metaFromAbout(about) || description(f) : tab === 'lawyers' ? lawyersDesc() : tab === 'articles' ? articlesDesc() : lawyerDesc();
  const rated = num(f.rating) > 0 && num(f.count) > 0;
  const title = tab === 'overview' ? `${esc(f.name)} | ${esc(f.city)}, ${esc(f.province)} Lawyers | LawDB` : tab === 'lawyers' ? `${esc(f.name)} \u2013 Lawyers in ${esc(f.city)} | LawDB` : tab === 'articles' ? `${esc(f.name)} \u2013 Articles from ${esc(f.city)} | LawDB` : `${esc(lawyer.name)}${lawyer.title ? ` \u2013 ${esc(lawyer.title)}` : ''} at ${esc(f.name)} | LawDB`;
  const website = /^https?:\/\/[^\s"'<>]+$/i.test(f.website || '') ? f.website : '';
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(f.address || `${f.name} ${f.city}`).replace(/%20/g, '+')}`;

  const glance = cleanDetails(f.details);
  // The same trail as the visible breadcrumb (Canada, province, city when it has a page, the firm), so search engines can show it under the result.
  const ps = PROV_SLUG[f.province], cs = citySlug(f.city);
  const trail = [['LawDB', `${origin}/`], ['Canada', `${origin}/find-lawyers`], ...(ps ? [[prov, `${origin}/${ps}/`]] : []), ...(ps && CITY_HUBS.has(`${ps}/${cs}`) ? [[f.city, `${origin}/${ps}/${cs}/`]] : []), [f.name, base], ...(tab === 'lawyers' || tab === 'lawyer' ? [['Lawyers', `${base}/lawyers`]] : tab === 'articles' ? [['Articles', `${base}/articles`]] : []), ...(tab === 'lawyer' ? [[lawyer.name, url]] : [])];
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: trail.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) };
  // No aggregateRating here on purpose: the rating on the page is Google's, collected on Google, and Google's structured data rules say ratings that are
  // marked up must come from the site itself (a business's own reviews of itself are not eligible either). The visible Google rating stays, named as Google's.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: f.name,
    description: about || desc,
    address: postal(f),
    ...(f.phone ? { telephone: f.phone } : {}),
    ...(num(f.lat) && num(f.lng) && !f.approxCoords ? { geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng } } : {}),
    url: base,
    ...(customCover ? { image: ogImage } : {}),
    ...(tab === 'lawyers' ? { employee: lw.map((l) => ({ '@type': 'Person', name: l.name, ...(l.title ? { jobTitle: l.title } : {}), ...(lawyerHasPage(l) ? { url: `${base}/lawyers/${l.slug}` } : {}) })) } : {}),
    ...(website ? { sameAs: [website] } : {}),
    ...(glance ? { ...(glance.founded ? { foundingDate: String(glance.founded) } : {}), ...(glance.languages ? { knowsLanguage: glance.languages } : {}), ...(glance.serving ? { areaServed: glance.serving } : {}) } : {}),
  };

  // The Articles page is a list of the firm's articles (their LawDB story pages)
  const collectionLd = tab === 'articles' ? {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Articles by ${f.name}`, url,
    about: { '@type': 'LegalService', name: f.name, url: base },
    mainEntity: { '@type': 'ItemList', itemListElement: articles.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}${a.storyHref}`, name: a.title })) },
  } : null;
  const personLd = tab === 'lawyer' ? {
    '@context': 'https://schema.org', '@type': 'Person', name: lawyer.name, ...(lawyer.title ? { jobTitle: lawyer.title } : {}), url,
    worksFor: { '@type': 'LegalService', name: f.name, url: base },
    ...([lawyer.linkedin, lawyer.site].filter(Boolean).length ? { sameAs: [lawyer.linkedin, lawyer.site].filter(Boolean) } : {}),
    ...(lawyer.languages ? { knowsLanguage: lawyer.languages } : {}), ...(lawyer.photo ? { image: lawyer.photo.startsWith('/') ? origin + lawyer.photo : lawyer.photo } : {}),
  } : null;

  // Buttons, as on lawdb.ai: Request a consultation (the main one, opens the contact form), the phone number, Book a call (the Worker puts it in the slot) and Follow.
  // The website is in the icon row and Directions is on the location card.
  const actions =
    '<div class="li-actions pf-actions">' +
    `<a class="pf-btn pf-primary" href="${tab === 'overview' ? '#contact' : `/firms/${esc(f.slug)}#contact`}"${tab === 'overview' ? ' data-open-contact' : ''}>${IC.msg}<span>Request a consultation</span></a>` +
    (f.phone ? `<a class="pf-btn" href="tel:${esc(f.phone)}">${C.ICONS.phone}<span>${esc(showPhone(f.phone))}</span></a>` : '') +
    '<span class="pf-slot" data-slot="book"></span>' +
    `<button class="lw-fbtn pf-btn pf-follow" type="button" data-follow="${esc(f.slug)}">+ Follow</button>` +
    '</div>';

  const planLine = f.featured
    ? ''
    : '<p class="li-meta pf-plan">Basic listing &middot; <a href="/list-your-firm">Own this firm? Get featured</a></p>';

  // The icon row: where the firm is, its website, its Google rating, and how many members follow it.
  const meta =
    `<div class="pf-meta"><span class="pf-mi">${C.ICONS.pin}${esc(f.city)}, ${esc(prov)}, Canada</span>` +
    (website ? `<a class="pf-mi" href="${esc(website)}" target="_blank" rel="${f.featured ? 'noopener sponsored' : 'noopener nofollow'}">${IC.link}${esc(hostOf(website))}</a>` : '') +
    (rated ? `<span class="pf-mi">${C.ICONS.star}<b>${num(f.rating).toFixed(1)}</b> from ${num(f.count)} Google reviews</span>` : '') +
    // The LawDB member rating, apart from the Google one: the Worker's script (follow.js) fills in the average and count, or invites the first rating.
    `<a class="pf-mi pf-lrate" href="#rate" data-lawdb-rating="${esc(f.slug)}">${C.ICONS.star}<span>Rate this firm on LawDB</span></a>` +
    `<span class="pf-mi lw-fcount" data-fcount="${esc(f.slug)}"></span></div>`;

  const card =
    `<section class="li-card pf-card" aria-label="${esc(f.name)} profile">\n      ${coverDiv(f)}\n      <div class="li-body">\n        ${f.featured ? '<span class="pf-feat li-feat">Featured on LawDB</span>\n        ' : ''}${logoSpan(f)}\n` +
    `        <${tab === 'overview' ? 'h1' : 'p'} class="li-name">${esc(f.name)}${f.featured ? ' ' + C.TICK : ''}</${tab === 'overview' ? 'h1' : 'p'}>\n        <p class="pf-handle">@${esc(f.slug)}</p>\n        <p class="li-tag">${tagline(f)}</p>\n${chipsHtml(f, verified)}` +
    `        ${meta}\n        ${actions}${planLine ? '\n        ' + planLine : ''}\n      </div>\n    </section>`;

  const aboutHtml = about ? `\n    <div class="article">${esc(about).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` : '';
  // The Profiles box (the firm's social icons) sits right under the description; a firm without one still has it where the description would be.
  const profilesHtml = profilesBox(f.social, f.name);
  // A picture that does not suit the cover goes under the description, like a bio or blog picture.
  const bio = safeUrl(f.bioImage);
  const bioHtml = bio ? `\n    <figure style="margin:0 0 18px;"><img src="${esc(localImg(bio))}" alt="${esc(f.name)}, ${esc(f.city)}" loading="lazy" style="display:block;width:100%;max-width:520px;height:auto;border-radius:12px;"></figure>` : '';
  const photoTags = images.filter((i) => IMG_ID.test(i.id)).map((i) => `<img src="/img/${i.id}" alt="${esc(i.alt || `${f.name} photo`)}" loading="lazy" width="320" height="240">`);
  const photosHtml = photoTags.length ? `\n    <div class="photos"><h2>Photos</h2><div class="photo-grid">${photoTags.join('')}</div></div>` : '';
  const cards = stats?.practice || [];
  const hoursHtml = hoursCard(hours, f.province);
  // Same text on every firm of a case type, so only Featured firms show it (see also the Worker, which does the same for hand-built pages).
  const guide = f.featured ? (C.GUIDES[(f.caseTypes || [])[0]] || '') : '';

  const toks = { NAME: esc(f.name), SLUG: esc(f.slug), LAT: esc(f.lat), LNG: esc(f.lng) };
  const locHtml = locationHtml(f, { dir, withMap: !!(num(f.lat) && num(f.lng) && !f.approxCoords) });
  // The lead script is JavaScript, so the name goes in as a JS-safe string, not HTML.
  const jsName = String(f.name).replace(/[\\'"<>&\n\r]/g, ' ');
  const leadScript = fill(C.LEAD_SCRIPT, { SLUG: String(f.slug).replace(/[^a-z0-9-]/g, ''), NAME: jsName });

  const overviewRest = '\n    <span id="contact" class="pf-anchor"></span>' + fill(C.LEAD_SLIM, toks) + (locHtml ? '\n    ' + locHtml : '') + officesHtml(f) + locationsHtml(f, locations) + '\n    <span class="pf-rate-slot" data-slot="rate"></span>' + profilesHtml + bioHtml + verifiedHtml(verified) + glanceHtml(f) + blockHtml(f.block) + photosHtml + (hoursHtml ? '\n    ' + hoursHtml : '') + (guide ? '\n    ' + guide : '');
  const out = [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${title}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:title" content="${esc(f.name)}, ${esc(f.city)}, ${esc(f.province)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="${tab === 'lawyer' ? 'profile' : 'business.business'}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    '<meta property="og:site_name" content="LawDB.ca">\n<meta property="og:locale" content="en_CA">',
    `<meta property="og:image" content="${ogImage}">${customCover ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}`,
    `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${esc(f.name)}, ${esc(f.city)}, ${esc(f.province)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">\n<meta name="twitter:image" content="${ogImage}">`,
    ...[tab === 'lawyer' ? personLd : ld, ...(collectionLd ? [collectionLd] : []), crumbLd].map((o) => `<script type="application/ld+json">\n${jsonForHtml(o)}\n</script>`),
    C.STYLE + (tab === 'overview' ? PHOTO_CSS + GLANCE_CSS + OFFICES_CSS : '') + (tabs.length > 1 ? TABS_CSS : '') + (tab === 'overview' && commentsHtml(f) ? COMMENTS_CSS : '') + (chipsHtml(f, verified) ? CHIPS_CSS : '') + (verified ? VERIFIED_CSS : '') + (tab === 'overview' && f.block && f.block.image ? BLOCK_CSS : '') + (tab === 'overview' && practiceHtml(f, cards) ? PRACTICE_CSS : '') + '\n<link rel="stylesheet" href="../desktop.css">\n<link rel="stylesheet" href="../site.css">\n</head>',
    '<body class="pg-firm pg-msp">\n  ' + C.HEADER,
    '  <div class="wrap pf-wrap">\n   <div class="pf-main">\n    ' + breadcrumb(f, prov, tab === 'overview' ? [] : tab === 'lawyers' ? [['Lawyers', null]] : tab === 'articles' ? [['Articles', null]] : [['Lawyers', `/firms/${f.slug}/lawyers`], [lawyer.name, null]]) + card + tabsHtml(f, tabs, tab) + (tab === 'lawyers' ? lawyersTabHtml(f, lw, prov) : tab === 'articles' ? articlesPageHtml(f, articles, prov) : tab === 'lawyer' ? lawyerPageHtml(f, lw, lawyer, prov) : aboutHtml + practiceHtml(f, cards) + lawyersTeaser(f, lw) + commentsHtml(f) + overviewRest),
    carousel(f, nearby),
    tab === 'overview' ? '\n\n    ' + leadScript : '',
    tab === 'overview' ? '\n    ' + CONTACT_JS : '',
    '\n   </div>' + likeAside(nearby) + '\n  </div>\n  ' + stickyBar(f, tab) + C.FOOTER,
  ].join('\n');
  // The saved page parts use addresses like ../site.css, written for /firms/<slug>; one level deeper they would point at the wrong folder, so they become absolute.
  return tab === 'overview' ? out : out.replace(/(href|src)="\.\.\//g, '$1="/');
}
