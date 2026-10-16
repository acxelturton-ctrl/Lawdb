// Renders a firm profile page from a database record. Built from the same chunks as the hand-built pages
// (see scripts/extract-firm-template.mjs), so a rendered page looks like the originals.
import * as C from './firm-chunks.generated.js';
import { renderBlogCards } from './blog-cards.js';

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
  const col = /^#[0-9a-fA-F]{6}$/.test(f.color || '') ? f.color : '#5d5f63';
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

function coverDiv(f) {
  const hero = safeUrl(f.heroImage);
  if (hero) return `<div class="li-cover"><img src="${esc(localImg(hero))}" alt="${esc(f.name)}" style="object-position:center;"></div>`;
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
  if (!tags.length) return `Law firm in ${esc(f.city)}, ${esc(prov)}.`;
  return `${esc(tags.join(' and '))} lawyers serving ${esc(f.city)}, ${esc(prov)}.`;
}

function description(f) {
  const prov = PROVINCES[f.province] || f.province;
  const lead = `${f.name} is a law firm in ${f.city}, ${prov}`;
  const rated = num(f.rating) > 0 && num(f.count) > 0;
  return rated
    ? `${lead} with a ${num(f.rating).toFixed(1)}-star Google rating from ${num(f.count)} reviews. Practice areas, address, phone, directions and reviews on LawDB.`
    : `${lead}. Practice areas, address, phone and directions on LawDB.`;
}

const PHOTO_CSS = '<style>.photos{margin:22px 0}.photos h2{font-size:18px;margin:0 0 10px}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.photo-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block;background:#eee}</style>';
const IMG_ID = /^[0-9a-f]{24}$/;

export function renderFirmPage({ firm: f, hours, images = [], posts = [], nearby = [], origin = 'https://lawdb.ca' }) {
  const prov = PROVINCES[f.province] || f.province;
  const customCover = /^img\/[0-9a-f]{24}$/.test(f.heroImage || '');
  const ogImage = customCover ? `${origin}/${f.heroImage}` : `${origin}/images/og-default.jpg`;
  const url = `${origin}/firms/${f.slug}`;
  const desc = description(f);
  const about = typeof f.about === 'string' ? f.about.trim() : '';
  const rated = num(f.rating) > 0 && num(f.count) > 0;
  const title = `${esc(f.name)} | ${esc(f.city)}, ${esc(f.province)} Lawyers | LawDB`;
  const website = /^https?:\/\/[^\s"'<>]+$/i.test(f.website || '') ? f.website : '';
  const q = encodeURIComponent(`${f.name} ${f.city} ${prov}`).replace(/%20/g, '+');
  const mapsSearch = `https://www.google.com/maps/search/${q}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(f.address || `${f.name} ${f.city}`).replace(/%20/g, '+')}`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: f.name,
    description: about || desc,
    address: { '@type': 'PostalAddress', streetAddress: f.address || '', addressLocality: f.city, addressRegion: f.province, addressCountry: 'CA' },
    ...(f.phone ? { telephone: f.phone } : {}),
    ...(num(f.lat) && num(f.lng) && !f.approxCoords ? { geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng } } : {}),
    ...(rated ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: f.rating, reviewCount: f.count } } : {}),
    url,
    ...(customCover ? { image: ogImage } : {}),
    ...(website ? { sameAs: [website] } : {}),
  };

  const actions =
    '<div class="li-actions">' +
    (f.phone ? `<a class="li-btn li-primary" href="tel:${esc(f.phone)}">${C.ICONS.phone}<span>Call now</span></a>` : '') +
    (website ? `<a class="li-btn li-ghost" href="${esc(website)}" target="_blank" rel="noopener">${C.ICONS.globe}<span>Website</span></a>` : '') +
    `<a class="li-btn li-ghost" href="${esc(dir)}" target="_blank" rel="noopener">${C.ICONS.pin}<span>Directions</span></a></div>`;

  const planLine = f.featured
    ? '<p class="li-meta li-feat">Featured on LawDB</p>'
    : '<p class="li-meta">Basic listing &middot; <a href="/list-your-firm">Own this firm? Get featured</a></p>';

  const card =
    `<section class="li-card" aria-label="${esc(f.name)} profile">\n      ${coverDiv(f)}\n      <div class="li-body">\n        ${logoSpan(f)}\n` +
    `        <h1 class="li-name">${esc(f.name)}${f.featured ? ' ' + C.TICK : ''}</h1>\n        <p class="li-tag">${tagline(f)}</p>\n` +
    `        <p class="li-meta">Law Practice &middot; ${esc(f.city)}, ${esc(f.province)}${rated ? ` &middot; <b>${num(f.rating)} &#9733;</b> from ${num(f.count)} Google reviews` : ''}</p>\n` +
    `        ${f.address ? `<p class="li-meta">${esc(f.address)}</p>` : ''}${planLine}\n        ${actions}\n      </div>\n    </section>`;

  const aboutHtml = about ? `\n    <div class="article">${esc(about).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` : '';
  const photoTags = images.filter((i) => IMG_ID.test(i.id)).map((i) => `<img src="/img/${i.id}" alt="${esc(i.alt || `${f.name} photo`)}" loading="lazy" width="320" height="240">`);
  const photosHtml = photoTags.length ? `\n    <div class="photos"><h2>Photos</h2><div class="photo-grid">${photoTags.join('')}</div></div>` : '';
  const tags = (f.tags || []).filter(Boolean);
  const services = tags.length ? `\n    <div class="services">\n      <h2>Practice areas</h2>\n      <ul>${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>\n    </div>` : '';
  const hoursHtml = hoursCard(hours, f.province);
  // Same text on every firm of a case type, so only Featured firms show it (see also the Worker, which does the same for hand-built pages).
  const guide = f.featured ? (C.GUIDES[(f.caseTypes || [])[0]] || '') : '';

  const socials =
    `<div class="socials">\n      <a href="${esc(mapsSearch)}" target="_blank" rel="noopener">${C.ICONS.star}<span>Read Google Reviews</span></a>\n` +
    `      <a href="https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(f.name)}" target="_blank" rel="noopener">${C.ICONS.linkedin}<span>Find on LinkedIn</span></a>\n` +
    `      <a href="${esc(mapsSearch)}" target="_blank" rel="noopener">${C.ICONS.pin2}<span>View on Google Maps</span></a>\n    </div>`;

  const toks = { NAME: esc(f.name), SLUG: esc(f.slug), LAT: esc(f.lat), LNG: esc(f.lng) };
  const mapHtml = num(f.lat) && num(f.lng) && !f.approxCoords ? fill(C.MAP_EMBED, toks) : '';
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
    C.STYLE + PHOTO_CSS + '\n<link rel="stylesheet" href="../desktop.css">\n<link rel="stylesheet" href="../site.css">\n</head>',
    '<body class="pg-firm">\n  ' + C.HEADER,
    '  <div class="wrap">\n    ' + card + aboutHtml + services + renderBlogCards({ firmName: f.name, posts }) + photosHtml + (hoursHtml ? '\n    ' + hoursHtml : '') + (guide ? '\n    ' + guide : '') + '\n\n    ' + socials,
    '    ' + fill(C.LEAD_SLIM, toks),
    carousel(f, nearby),
    '\n\n    ' + leadScript,
    mapHtml ? '\n    ' + mapHtml : '',
    '    ' + fill(C.FINE, toks) + '\n  </div>\n  ' + C.FOOTER,
  ].join('\n');
}
