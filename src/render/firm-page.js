// Renders a firm profile page from a database record. Built from the same chunks as the hand-built pages
// (see scripts/extract-firm-template.mjs), so a rendered page looks like the originals.
import { cleanDetails } from '../lib/details.js';
import * as C from './firm-chunks.generated.js';
import { renderFirmArticles } from './blog-cards.js';
import { profilesBox, hasLinkedIn } from './profiles.js';
import { CITY_HUBS } from './city-hubs.generated.js';

export const PROVINCES = { ON: 'Ontario', QC: 'Quebec', BC: 'British Columbia', AB: 'Alberta', MB: 'Manitoba' };
const TZ = { ON: 'America/Toronto', QC: 'America/Toronto', BC: 'America/Vancouver', AB: 'America/Edmonton', MB: 'America/Winnipeg' };
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
  const col = '#2b3a4c'; // one navy for every monogram (a firm's own colour is not used)
  return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${ini}"><rect width="60" height="60" rx="10.8" fill="${col}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="24.0" fill="#ffffff" letter-spacing="0.02em">${ini}</text></svg>`;
}

// Image URLs we are willing to put in a page: our own paths, or https.
export const safeUrl = (u) => (typeof u === 'string' && (/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/?[A-Za-z0-9_\-./]+$/.test(u)) ? u : '');
const localImg = (u) => (/^https:/.test(u) || u.startsWith('/') ? u : `../${u}`);

function logoSpan(f) {
  const src = safeUrl(f.src);
  const remote = safeUrl(f.logoUrl);
  if (src) return `<span class="li-logo"><img src="${esc(localImg(src))}" alt="${esc(f.name)} logo" width="96" height="96"></span>`;
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
  else if (src) cover = `<div class="lc-cover brand${n.dark ? ' dark' : ''}"><img src="${esc(localImg(src))}" alt="${esc(n.name)} logo" loading="lazy"></div>`;
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
  // A full stop after St., Ste., Inc., Ltd. and similar abbreviations does not end the sentence.
  const first = String(about || '').trim().split(/(?<!\b(?:St|Ste|Mt|Dr|Mr|Mrs|Ms|Inc|Ltd|Co|Corp|No|vs|Prof)\.)(?<=[.!?])\s+(?=[A-Z"“])/)[0] || '';
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

const PHOTO_CSS = '<style>.photos{margin:22px 0}.photos h2{font-size:18px;margin:0 0 10px}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.photo-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block;background:#edeae1}</style>';
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
    `<p class="article-teaser">${esc(String(b.teaser).slice(0, 500))}</p><a class="read-link" href="${esc(b.href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(String(b.linkText || 'Read more').slice(0, 120))}</a></div>`;
}

const PRACTICE_CSS = '<style>.pa-wrap{margin-bottom:20px}.pa-wrap h2{font-family:\'Source Serif 4\',serif;font-size:16px;margin:0 0 10px}.pa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.pa-card{display:block;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--brass);border-radius:8px;padding:14px 16px;text-decoration:none;color:var(--ink)}.pa-card:hover{border-color:var(--brass);box-shadow:0 2px 10px rgba(20,36,52,0.08)}.pa-card b{display:block;font-size:15px;margin-bottom:4px}.pa-card span{display:block;font-size:12.5px;color:var(--ink-soft);line-height:1.45}.pa-card em{display:block;font-style:normal;font-size:12.5px;font-weight:700;color:var(--brass-deep);margin-top:8px}</style>';

// Cards to the province practice pages for the firm's case types (only pages that exist), with how many firms each page compares.
function practiceHtml(f, cards) {
  if (!cards.length) return '';
  const prov = PROVINCES[f.province] || f.province;
  return `\n    <div class="pa-wrap"><h2>Practice areas</h2><div class="pa-grid">${cards.map((c) => `<a class="pa-card" href="${esc(c.href)}"><b>${esc(c.label)}</b><span>${c.count} ${c.count === 1 ? 'firm' : 'firms'} listed across ${esc(prov)}, compared by real Google ratings.</span><em>Compare all &rarr;</em></a>`).join('')}</div></div>`;
}

const GLANCE_CSS = '<style>.glance{margin:22px 0}.glance h2{font-size:18px;margin:0 0 10px}.glance dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:8px 18px;font-size:15px;line-height:1.5}.glance dt{font-weight:700;color:#586170}.glance dd{margin:0}.glance ul{margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px 14px}@media(max-width:520px){.glance dl{grid-template-columns:1fr;gap:2px}.glance dd{margin-bottom:8px}}</style>';
const OFFICES_CSS = '<style>.offices{margin:22px 0}.offices h2{font-size:18px;margin:0 0 10px}.offices ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:15px;line-height:1.5}.offices li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}.offices .office-name{font-weight:700;color:#142434}.offices a{color:#142434;text-decoration:underline;text-decoration-color:#c9a050;text-underline-offset:3px}.offices a:hover{text-decoration-color:#142434}.offices-note{margin:10px 0 0;font-size:14px;color:#586170}</style>';
const IMG_ID = /^[0-9a-f]{24}$/;

// Facts the firm's own website states (see src/lib/details.js): shown as a plain list, never as claims of our own.
function glanceHtml(f) {
  const d = cleanDetails(f.details);
  if (!d) return '';
  const row = (label, html) => `<dt>${label}</dt><dd>${html}</dd>`;
  const rows = [
    d.founded ? row('Founded', String(d.founded)) : '',
    d.lawyers ? row('Lawyers named by the firm', `<ul>${d.lawyers.map((l) => `<li>${esc(l.name)}${l.title ? ` <span style="color:#586170">(${esc(l.title)})</span>` : ''}</li>`).join('')}</ul>`) : '',
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

// "199 Bay St #5300, Toronto, ON M5L 1B9" -> street, and postal code, the way schema.org wants them.
function postal(f) {
  const a = String(f.address || '');
  const m = a.match(/^(.*?),\s*([^,]+?),\s*([A-Z]{2})\s+([A-Z]\d[A-Z][ -]?\d[A-Z]\d)\s*$/i);
  const street = m && m[3].toUpperCase() === f.province ? m[1] : a;
  return { '@type': 'PostalAddress', streetAddress: street, addressLocality: f.city, addressRegion: f.province, ...(m && m[3].toUpperCase() === f.province ? { postalCode: m[4].toUpperCase().replace(/^(\w{3})-?(\w{3})$/, '$1 $2') } : {}), addressCountry: 'CA' };
}

// The Location card on a profile, right under the contact card ("Contact <firm>" / Send message): the map (MapLibre, the same map as the Find page) with a "Maps" chip that
// opens the same place on Google Maps, and under it the address with a Directions link. The map shows the office pin and a shaded, dotted area around it
// that shows the rough area the firm serves (an approximation, not the firm's exact service boundary). Google's embed cannot draw an area and the site has
// no Google Maps key, so the map is drawn here. A firm with no usable coordinates still gets the address row.
const SERVICE_RADIUS_M = 8000;
function firmMapHtml(f, mapsSearch) {
  const lat = Number(f.lat), lng = Number(f.lng);
  const script = `(function(){var lng=${lng},lat=${lat};` +
    'function circle(r){var pts=[];for(var i=0;i<=64;i++){var a=i/64*2*Math.PI;pts.push([lng+r*Math.sin(a)/(111320*Math.cos(lat*Math.PI/180)),lat+r*Math.cos(a)/111320]);}return pts;}' +
    "window.addEventListener('load',function(){var el=document.getElementById('firmMap');if(!el||!window.maplibregl)return;" +
    "var map=new maplibregl.Map({container:el,style:'https://tiles.openfreemap.org/styles/liberty',center:[lng,lat],zoom:12,dragRotate:false,touchPitch:false});" +
    "map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');" +
    "map.on('load',function(){" +
    `map.addSource('area',{type:'geojson',data:{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[circle(${SERVICE_RADIUS_M})]}}});` +
    "map.addLayer({id:'area-fill',type:'fill',source:'area',paint:{'fill-color':'#e2bd6a','fill-opacity':0.3}});" +
    "map.addLayer({id:'area-line',type:'line',source:'area',paint:{'line-color':'#c9a050','line-width':2,'line-dasharray':[2,2]}});" +
    `var c=circle(${SERVICE_RADIUS_M}),xs=c.map(function(p){return p[0]}),ys=c.map(function(p){return p[1]});map.fitBounds([[Math.min.apply(null,xs),Math.min.apply(null,ys)],[Math.max.apply(null,xs),Math.max.apply(null,ys)]],{padding:24,duration:0,maxZoom:13});new maplibregl.Marker({color:'#c9a050'}).setLngLat([lng,lat]).addTo(map);});});})();`;
  return '<div class="pf-map">\n      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.12.0/maplibre-gl.min.css">\n' +
    '      <style>.firm-map{overflow:hidden;background:#edeae1;max-width:100%}</style>\n' +
    `      <a class="pf-maps" href="${esc(mapsSearch)}" target="_blank" rel="noopener">Maps ${IC.out}</a>\n` +
    `      <div id="firmMap" class="firm-map" role="img" aria-label="Map of ${esc(f.name)} and the area around its office"></div>\n` +
    '      <script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.12.0/maplibre-gl.min.js" defer></script>\n' +
    `      <script>${script}</script>\n    </div>`;
}

function locationHtml(f, { mapsSearch, dir, withMap }) {
  const addr = f.address ? `<div class="pf-addr">${C.ICONS.pin}<span><b>${esc(f.address)}</b></span><a class="pf-btn pf-sm pf-dir" href="${esc(dir)}" target="_blank" rel="noopener">Directions</a></div>` : '';
  const map = withMap ? firmMapHtml(f, mapsSearch) : '';
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

function breadcrumb(f, prov) {
  const ps = PROV_SLUG[f.province];
  const cs = citySlug(f.city);
  const sep = '<span class="sep" aria-hidden="true">&rsaquo;</span>';
  return '<nav class="pf-crumb" aria-label="Breadcrumb">' +
    `<a class="pf-crumb-home" href="/" aria-label="LawDB home"><img src="/images/logo-icon.png" alt="" width="20" height="20"></a>${sep}` +
    `<a href="/find-lawyers">Canada</a>${sep}` +
    (ps ? `<a href="/${ps}/">${esc(prov)}</a>` : `<span>${esc(prov)}</span>`) + sep +
    (ps && CITY_HUBS.has(`${ps}/${cs}`) ? `<a href="/${ps}/${cs}/">${esc(f.city)}</a>` : `<span>${esc(f.city)}</span>`) +
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

// The Message button opens the contact form it scrolls to.
const CONTACT_JS = "<script>(function(){var b=document.querySelector('[data-open-contact]'),s=document.querySelector('.lead-slim');if(b&&s)b.addEventListener('click',function(){s.classList.add('open');});})();</script>";

export function renderFirmPage({ firm: f, hours, images = [], posts = [], nearby = [], origin = 'https://lawdb.ca', stats = null }) {
  const prov = PROVINCES[f.province] || f.province;
  const customCover = /^img\/[0-9a-f]{24}$/.test(f.heroImage || '');
  const ogImage = customCover ? `${origin}/${f.heroImage}` : `${origin}/images/og-default.jpg`;
  const url = `${origin}/firms/${f.slug}`;
  const about = typeof f.about === 'string' ? f.about.trim() : '';
  const desc = metaFromAbout(about) || description(f);
  const rated = num(f.rating) > 0 && num(f.count) > 0;
  const title = `${esc(f.name)} | ${esc(f.city)}, ${esc(f.province)} Lawyers | LawDB`;
  const website = /^https?:\/\/[^\s"'<>]+$/i.test(f.website || '') ? f.website : '';
  const q = encodeURIComponent(`${f.name} ${f.city} ${prov}`).replace(/%20/g, '+');
  const mapsSearch = `https://www.google.com/maps/search/${q}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(f.address || `${f.name} ${f.city}`).replace(/%20/g, '+')}`;

  const glance = cleanDetails(f.details);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: f.name,
    description: about || desc,
    address: postal(f),
    ...(f.phone ? { telephone: f.phone } : {}),
    ...(num(f.lat) && num(f.lng) && !f.approxCoords ? { geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng } } : {}),
    ...(rated ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: f.rating, reviewCount: f.count } } : {}),
    url,
    ...(customCover ? { image: ogImage } : {}),
    ...(website ? { sameAs: [website] } : {}),
    ...(glance ? { ...(glance.founded ? { foundingDate: String(glance.founded) } : {}), ...(glance.languages ? { knowsLanguage: glance.languages } : {}), ...(glance.serving ? { areaServed: glance.serving } : {}) } : {}),
  };

  // Buttons, as on MSPdatabase: Follow (filled), Message, Book a call (the Worker puts it in the slot), and the phone number. The website is in the icon row and
  // Directions is on the location card.
  const actions =
    '<div class="li-actions pf-actions">' +
    `<button class="lw-fbtn pf-btn pf-follow" type="button" data-follow="${esc(f.slug)}">+ Follow</button>` +
    `<a class="pf-btn" href="#contact" data-open-contact>${IC.msg}<span>Message</span></a>` +
    '<span class="pf-slot" data-slot="book"></span>' +
    (f.phone ? `<a class="pf-btn" href="tel:${esc(f.phone)}">${C.ICONS.phone}<span>${esc(showPhone(f.phone))}</span></a>` : '') +
    '</div>';

  const planLine = f.featured
    ? ''
    : '<p class="li-meta pf-plan">Basic listing &middot; <a href="/list-your-firm">Own this firm? Get featured</a></p>';

  // The icon row: where the firm is, its website, its Google rating, and how many members follow it.
  const meta =
    `<div class="pf-meta"><span class="pf-mi">${C.ICONS.pin}${esc(f.city)}, ${esc(prov)}, Canada</span>` +
    (website ? `<a class="pf-mi" href="${esc(website)}" target="_blank" rel="noopener">${IC.link}${esc(hostOf(website))}</a>` : '') +
    (rated ? `<a class="pf-mi" href="${esc(mapsSearch)}" target="_blank" rel="noopener">${C.ICONS.star}<b>${num(f.rating).toFixed(1)}</b> from ${num(f.count)} Google reviews</a>` : '') +
    `<span class="pf-mi lw-fcount" data-fcount="${esc(f.slug)}"></span></div>`;

  const card =
    `<section class="li-card pf-card" aria-label="${esc(f.name)} profile">\n      ${coverDiv(f)}\n      <div class="li-body">\n        ${f.featured ? '<span class="pf-feat li-feat">Featured on LawDB</span>\n        ' : ''}${logoSpan(f)}\n` +
    `        <h1 class="li-name">${esc(f.name)}${f.featured ? ' ' + C.TICK : ''}</h1>\n        <p class="pf-handle">@${esc(f.slug)}</p>\n        <p class="li-tag">${tagline(f)}</p>\n` +
    `        ${meta}\n        ${actions}${planLine ? '\n        ' + planLine : ''}\n      </div>\n    </section>`;

  const aboutHtml = about ? `\n    <div class="article">${esc(about).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` : '';
  // The Profiles box (the firm's social icons) sits right under the description; a firm without one still has it where the description would be.
  const profilesHtml = profilesBox(f.social, f.name);
  // A picture that does not suit the cover goes under the description, like a bio or blog picture.
  const bio = safeUrl(f.bioImage);
  const bioHtml = bio ? `\n    <figure style="margin:0 0 18px;"><img src="${esc(localImg(bio))}" alt="${esc(f.name)}, ${esc(f.city)}" loading="lazy" style="display:block;width:100%;max-width:520px;height:auto;border-radius:12px;"></figure>` : '';
  const photoTags = images.filter((i) => IMG_ID.test(i.id)).map((i) => `<img src="/img/${i.id}" alt="${esc(i.alt || `${f.name} photo`)}" loading="lazy" width="320" height="240">`);
  const photosHtml = photoTags.length ? `\n    <div class="photos"><h2>Photos</h2><div class="photo-grid">${photoTags.join('')}</div></div>` : '';
  const tags = (f.tags || []).filter(Boolean);
  const cards = stats?.practice || [];
  const services = tags.length ? `\n    <div class="services">\n      <h2>${cards.length ? 'Services' : 'Practice areas'}</h2>\n      <ul>${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>\n    </div>` : '';
  const hoursHtml = hoursCard(hours, f.province);
  // Same text on every firm of a case type, so only Featured firms show it (see also the Worker, which does the same for hand-built pages).
  const guide = f.featured ? (C.GUIDES[(f.caseTypes || [])[0]] || '') : '';

  const socials =
    `<div class="socials">\n      <a href="${esc(mapsSearch)}" target="_blank" rel="noopener">${C.ICONS.star}<span>Read Google Reviews</span></a>\n` +
    // the Profiles box in the header card has the firm's real LinkedIn page; this search link is only for firms without one
    (hasLinkedIn(f.social) ? '' : `      <a href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(f.name)}" target="_blank" rel="noopener">${C.ICONS.linkedin}<span>Find on LinkedIn</span></a>\n`) +
    `      <a href="${esc(mapsSearch)}" target="_blank" rel="noopener">${C.ICONS.pin2}<span>View on Google Maps</span></a>\n    </div>`;

  const toks = { NAME: esc(f.name), SLUG: esc(f.slug), LAT: esc(f.lat), LNG: esc(f.lng) };
  const locHtml = locationHtml(f, { mapsSearch, dir, withMap: !!(num(f.lat) && num(f.lng) && !f.approxCoords) });
  // The firm's own articles come after the profile, as on MSPdatabase.
  const articlesHtml = renderFirmArticles({ firmName: f.name, posts });
  // The lead script is JavaScript, so the name goes in as a JS-safe string, not HTML.
  const jsName = String(f.name).replace(/[\\'"<>&\n\r]/g, ' ');
  const leadScript = fill(C.LEAD_SCRIPT, { SLUG: String(f.slug).replace(/[^a-z0-9-]/g, ''), NAME: jsName });

  return [
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' + C.FAVICONS + '\n<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${title}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:title" content="${esc(f.name)}, ${esc(f.city)}, ${esc(f.province)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    '<meta property="og:type" content="business.business">',
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    '<meta property="og:site_name" content="LawDB.ca">\n<meta property="og:locale" content="en_CA">',
    `<meta property="og:image" content="${ogImage}">${customCover ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}`,
    `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${esc(f.name)}, ${esc(f.city)}, ${esc(f.province)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">\n<meta name="twitter:image" content="${ogImage}">`,
    `<script type="application/ld+json">\n${jsonForHtml(ld)}\n</script>`,
    C.STYLE + PHOTO_CSS + GLANCE_CSS + OFFICES_CSS + (f.block && f.block.image ? BLOCK_CSS : '') + ((stats?.practice || []).length ? PRACTICE_CSS : '') + '\n<link rel="stylesheet" href="../desktop.css">\n<link rel="stylesheet" href="../site.css">\n</head>',
    '<body class="pg-firm pg-msp">\n  ' + C.HEADER,
    '  <div class="wrap pf-wrap">\n   <div class="pf-main">\n    ' + breadcrumb(f, prov) + card + aboutHtml + '\n    <span id="contact" class="pf-anchor"></span>' + fill(C.LEAD_SLIM, toks) + (locHtml ? '\n    ' + locHtml : '') + officesHtml(f) + '\n    <span class="pf-rate-slot" data-slot="rate"></span>' + profilesHtml + bioHtml + glanceHtml(f) + blockHtml(f.block) + practiceHtml(f, cards) + services + photosHtml + (hoursHtml ? '\n    ' + hoursHtml : '') + (guide ? '\n    ' + guide : '') + '\n\n    ' + socials,
    articlesHtml ? '\n    ' + articlesHtml : '',
    carousel(f, nearby),
    '\n\n    ' + leadScript,
    '\n    ' + CONTACT_JS,
    '\n   </div>' + likeAside(nearby) + '\n  </div>\n  ' + C.FOOTER,
  ].join('\n');
}
