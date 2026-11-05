// Everything that validates, creates or edits a firm. Shared by the admin area (admins edit any
// firm) and the owner dashboard (approved owners edit their own firm, with fewer fields).

import { HttpError } from './http.js';
import { audit } from './audit.js';
import { checkOwnerText } from './content-rules.js';
import { cleanBookingUrl } from './booking.js';
import { PROVINCES } from '../render/firm-page.js';
import { NETWORKS, cleanSocialUrl } from './social.js';
import { placeFor } from './geocode.js';
import { trialAdminChanged } from './trial.js';

export function str(v, min, max) {
  if (typeof v !== 'string') throw new HttpError(422, 'Expected text');
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(422, `Text must be ${min}-${max} characters`);
  return s;
}

export const CASE_TYPES = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation'];

export const FIRM_FIELDS = {
  name: (v) => str(v, 1, 200),
  blurb: (v) => str(v, 0, 500),
  phone: (v) => {
    const s = str(v, 0, 30);
    if (s && !/^\+?[0-9 ()\-.]{7,30}$/.test(s)) throw new HttpError(422, 'phone: use digits, spaces and + ( ) - only');
    return s;
  },
  website: (v) => {
    const s = str(v, 0, 300);
    if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw new HttpError(422, 'website must start with http:// or https://');
    return s;
  },
  address: (v) => str(v, 0, 300),
  // The firm's own online booking link: it turns on the Book a call button on its page. Blank turns it off again.
  bookingUrl: (v) => {
    const s = str(v, 0, 500);
    if (!s) return '';
    const clean = cleanBookingUrl(s);
    if (!clean) throw new HttpError(422, 'booking link must be a web address starting with https:// (your own calendar or booking page)');
    return clean;
  },
  featured: (v) => {
    if (typeof v !== 'boolean') throw new HttpError(422, 'featured must be true or false');
    return v;
  },
  tags: (v) => {
    if (!Array.isArray(v) || v.length > 10) throw new HttpError(422, 'tags must be a list of at most 10 items');
    return v.map((t) => str(t, 1, 60));
  },
  caseTypes: (v) => {
    if (!Array.isArray(v) || v.length > 10 || v.some((c) => !CASE_TYPES.includes(c))) {
      throw new HttpError(422, `caseTypes must be a list of: ${CASE_TYPES.join(', ')}`);
    }
    return [...new Set(v)];
  },
  // Where the firm is. Admins only (see ADMIN_ONLY): moving a firm to another city also moves it between the city pages.
  city: (v) => str(v, 2, 80),
  province: (v) => {
    const s = str(v, 2, 2).toUpperCase();
    if (!(s in PROVINCES)) throw new HttpError(422, `province must be one of: ${Object.keys(PROVINCES).join(', ')}`);
    return s;
  },
  // The firm's profile pages on Facebook, Instagram, LinkedIn, X and YouTube: { facebook: 'https://...', ... }. Only real profile addresses are kept
  // (the same rules as the finder: https, the network's own address, never a share button or a single post); a blank one removes it.
  social: (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(422, 'social must be an object like { "facebook": "https://www.facebook.com/yourfirm" }');
    const out = {};
    for (const [key, raw] of Object.entries(v)) {
      const net = NETWORKS.find((n) => n.key === key);
      if (!net) throw new HttpError(422, `social: unknown network ${key}`);
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) continue;
      const clean = cleanSocialUrl(key, text);
      if (!clean) throw new HttpError(422, `${net.label}: please enter the address of the firm's ${net.label} profile or page.`);
      out[key] = clean;
    }
    return out;
  },
  // Other offices: [{ name, address }], up to 8. A row with no address is dropped.
  offices: (v) => {
    if (!Array.isArray(v) || v.length > 8) throw new HttpError(422, 'offices must be a list of at most 8 offices');
    return v.map((o) => {
      if (!o || typeof o !== 'object') throw new HttpError(422, 'each office needs an address');
      const address = str(o.address ?? '', 0, 300);
      const name = str(o.name ?? '', 0, 80);
      return address ? { ...(name ? { name } : {}), address } : null;
    }).filter(Boolean);
  },
  appointmentOnly: (v) => {
    if (typeof v !== 'boolean') throw new HttpError(422, 'appointmentOnly must be true or false');
    return v;
  },
};

// Only an admin can change these. `lat`/`lng` and `status` are handled on their own in applyFirmEdit (they are columns as well as data).
export const ADMIN_ONLY = ['featured', 'city', 'province'];
export const FIRM_STATUSES = ['live', 'hidden'];
const inCanada = (lat, lng) => lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52;

// Opening hours: { "1": [["08:30","17:00"]], ... } where 1 = Monday ... 7 = Sunday; omitted/empty day = closed.
export function normalizeHours(h) {
  if (h === null) return null;
  if (typeof h !== 'object' || Array.isArray(h)) throw new HttpError(422, 'hours must be an object keyed by day 1-7');
  const out = {};
  for (const [day, ivs] of Object.entries(h)) {
    if (!/^[1-7]$/.test(day)) throw new HttpError(422, 'hours days must be 1 (Monday) to 7 (Sunday)');
    if (!Array.isArray(ivs) || ivs.length > 3) throw new HttpError(422, 'each day takes up to 3 time ranges');
    const clean = ivs.map((iv) => {
      if (!Array.isArray(iv) || iv.length !== 2 || !iv.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || iv[0] >= iv[1]) {
        throw new HttpError(422, 'time ranges look like ["08:30","17:00"], opening before closing');
      }
      return [iv[0], iv[1]];
    });
    if (clean.length) out[day] = clean;
  }
  return Object.keys(out).length ? out : null;
}

// The address a Featured firm's enquiries are also sent to. One plain address; blank turns it off. Kept apart from the public firm data.
export function cleanEnquiryEmail(v) {
  const s = str(v ?? '', 0, 254).toLowerCase();
  if (!s) return '';
  if (!/^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) throw new HttpError(422, 'enquiry email must be one email address, like intake@yourfirm.ca');
  return s;
}

// ---------------------------------------------------------------- edit
const OWNER_TEXT_FIELDS = { name: 'Firm name', blurb: 'Short description', tags: 'Practice areas' };

// An owner on the Basic plan edits the facts (name, phone, address, website, hours, practice areas) and writes the page's description and
// tagline. What needs Featured: a booking link, a second enquiry address and pictures (see addImage). A Basic owner can still clear a booking link.
export const FEATURED_LOCK = 'is a Featured benefit. Upgrade to Featured from your dashboard to customize your page.';
const CUSTOMIZING = { bookingUrl: 'Adding a booking link', enquiryEmail: 'Sending enquiries to another address' };

// `admin` may also change the featured flag, the city and province, the map position and whether the firm is shown (status); owners may not.
export async function applyFirmEdit(env, actor, slug, body, { admin }) {
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(422, 'Nothing to update');
  const fieldKeys = Object.keys(FIRM_FIELDS).filter((k) => admin || !ADMIN_ONLY.includes(k));
  const extra = admin ? ['hours', 'about', 'lat', 'lng', 'status', 'enquiryEmail'] : ['hours', 'about', 'enquiryEmail'];
  const unknown = keys.filter((k) => !fieldKeys.includes(k) && !extra.includes(k));
  if (unknown.length) throw new HttpError(422, `Cannot edit: ${unknown.join(', ')}`);

  const row = await env.DB.prepare('SELECT data, hours, about, status, enquiry_email FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  const firm = JSON.parse(row.data);
  const customizing = admin || !!firm.featured;

  const changes = {};
  let aboutText = row.about;
  let status = row.status;
  if ('about' in body) {
    const next = str(body.about, 0, 2000) || null;
    if (next !== (row.about || null) && !admin) checkOwnerText('About the firm', next);
    if (next !== (row.about || null)) { changes.about = { from: row.about || null, to: next }; aboutText = next; }
  }
  // Show or hide the firm. A firm waiting for its owner request to be approved ('pending') is not switched here: that happens in Approvals.
  if (admin && 'status' in body) {
    if (!FIRM_STATUSES.includes(body.status)) throw new HttpError(422, `status must be one of: ${FIRM_STATUSES.join(', ')}`);
    if (row.status === 'pending') throw new HttpError(409, 'This listing is waiting for approval. Approve it under Approvals first.');
    if (body.status !== row.status) { changes.status = { from: row.status, to: body.status }; status = body.status; }
  }
  let enquiryEmail = row.enquiry_email || null;
  if ('enquiryEmail' in body) {
    const next = cleanEnquiryEmail(body.enquiryEmail) || null;
    if (next !== enquiryEmail) {
      if (next && !customizing) throw new HttpError(403, `${CUSTOMIZING.enquiryEmail} ${FEATURED_LOCK}`);
      changes.enquiryEmail = { from: enquiryEmail, to: next };
      enquiryEmail = next;
    }
  }
  let hoursJson = row.hours;
  if ('hours' in body) {
    const next = normalizeHours(body.hours);
    const nextJson = next ? JSON.stringify(next) : null;
    if (nextJson !== row.hours) { changes.hours = { from: row.hours ? JSON.parse(row.hours) : null, to: next }; hoursJson = nextJson; }
  }
  for (const k of keys.filter((k) => fieldKeys.includes(k))) {
    const next = FIRM_FIELDS[k](body[k]);
    if (JSON.stringify(firm[k]) !== JSON.stringify(next)) {
      if (CUSTOMIZING[k] && next && !customizing) throw new HttpError(403, `${CUSTOMIZING[k]} ${FEATURED_LOCK}`);
      if (!admin && OWNER_TEXT_FIELDS[k]) checkOwnerText(OWNER_TEXT_FIELDS[k], next);
      changes[k] = { from: firm[k] ?? null, to: next };
      firm[k] = next;
    }
  }
  // Map position (admin): both numbers, inside Canada. Otherwise a changed address (or city) looks up the new spot, and only an exact find moves the pin.
  if (admin && ('lat' in body || 'lng' in body)) {
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!inCanada(lat, lng)) throw new HttpError(422, 'lat and lng are both required and must be inside Canada');
    if (lat !== firm.lat || lng !== firm.lng) { changes.lat = { from: firm.lat ?? null, to: lat }; changes.lng = { from: firm.lng ?? null, to: lng }; firm.lat = lat; firm.lng = lng; delete firm.approxCoords; }
  } else if ('address' in changes || 'city' in changes || 'province' in changes) {
    const place = await placeFor(env, { address: firm.address, city: firm.city, province: firm.province });
    if (place && !place.approx && inCanada(place.lat, place.lng) && (place.lat !== firm.lat || place.lng !== firm.lng)) {
      changes.lat = { from: firm.lat ?? null, to: place.lat }; changes.lng = { from: firm.lng ?? null, to: place.lng };
      firm.lat = place.lat; firm.lng = place.lng; delete firm.approxCoords;
    }
  }
  // Derived: the directions link follows the address; the region follows the city, so the directory filters and hub pages group the firm correctly.
  if ('address' in changes) firm.dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(firm.address || `${firm.name} ${firm.city}`).replace(/%20/g, '+')}`;
  if ('city' in changes || 'province' in changes) {
    const known = await env.DB.prepare('SELECT region FROM firms WHERE city = ? COLLATE NOCASE AND province = ? AND region IS NOT NULL AND slug != ? LIMIT 1').bind(firm.city, firm.province, slug).first();
    firm.region = known ? known.region : '';
  }
  if (!Object.keys(changes).length) return { changed: [], firm: { ...firm, about: aboutText || '' }, status };

  // `data` is the source of truth; the indexed columns are derived from it.
  const moved = 'city' in changes || 'province' in changes;
  await env.DB.prepare("UPDATE firms SET data = ?, name = ?, city = ?, province = ?, region = COALESCE(?, region), featured = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng), hours = ?, about = ?, status = ?, enquiry_email = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(JSON.stringify(firm), firm.name, firm.city, firm.province, moved ? firm.region ?? '' : null, firm.featured ? 1 : 0, firm.lat ?? null, firm.lng ?? null, hoursJson, aboutText, status, enquiryEmail, slug)
    .run();
  await audit(env, actor, 'firm.update', 'firm', slug, changes);
  if ('featured' in changes) await trialAdminChanged(env, slug, !!firm.featured); // a free month running at the time must not undo (or outlive) the admin's choice
  return { changed: Object.keys(changes), firm: { ...firm, about: aboutText || '' }, status };
}

// ---------------------------------------------------------------- create
const FOLD = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export const slugify = (text) =>
  String(text).normalize('NFKD').replace(FOLD, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const MONO_COLORS = ['#2b3a4c']; // every monogram is the same navy (the palette); the field stays so older records keep their shape
const initialsOf = (name) => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(law|llp|the|and|of|office|offices|firm|professional|corporation)$/i.test(w));
  return ((words[0] || name)[0] + ((words[1] || '')[0] || '')).toUpperCase();
};

// Validates a new listing and builds the full firm record. Coordinates are checked when given;
// `coords` supplies a fallback (e.g. from address lookup) and `requireCoords` makes them mandatory.
export async function prepareNewFirm(env, body, { requireCoords, coords, checkText } = {}) {
  const name = str(body.name, 2, 200);
  const city = str(body.city, 2, 80);
  const province = typeof body.province === 'string' ? body.province.toUpperCase() : '';
  if (!(province in PROVINCES)) throw new HttpError(422, `province must be one of: ${Object.keys(PROVINCES).join(', ')}`);

  let lat = null, lng = null;
  if (body.lat != null || body.lng != null || requireCoords) {
    lat = Number(body.lat); lng = Number(body.lng);
    if (!(lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52)) throw new HttpError(422, 'lat and lng are required and must be inside Canada');
  } else if (coords) ({ lat, lng } = coords);
  const approx = !!(coords && coords.approx && body.lat == null && body.lng == null);

  const firm = {
    name, city, featured: false,
    tags: 'tags' in body ? FIRM_FIELDS.tags(body.tags) : [],
    caseTypes: 'caseTypes' in body ? FIRM_FIELDS.caseTypes(body.caseTypes) : [],
    province, lat, lng, ...(approx ? { approxCoords: true } : {}),
    address: 'address' in body ? FIRM_FIELDS.address(body.address) : '',
    phone: 'phone' in body ? FIRM_FIELDS.phone(body.phone) : '',
    rating: 0, count: 0,
    website: 'website' in body ? FIRM_FIELDS.website(body.website) : '',
    type: 'mono', initials: initialsOf(name),
  };
  // Same region as other firms in that city, so the directory filters and hub pages group it correctly.
  const known = await env.DB.prepare('SELECT region FROM firms WHERE city = ? COLLATE NOCASE AND province = ? AND region IS NOT NULL LIMIT 1').bind(city, province).first();
  firm.region = known ? known.region : '';

  // Unique, URL-safe address.
  const base = slugify(`${name} ${city}`) || 'firm';
  let slug = base;
  for (let i = 2; await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ?').bind(slug).first(); i++) {
    if (i > 50) throw new HttpError(409, 'Could not find a free address for this firm');
    slug = `${base}-${i}`;
  }
  firm.slug = slug;
  firm.color = MONO_COLORS[[...slug].reduce((a, c) => a + c.charCodeAt(0), 0) % MONO_COLORS.length];
  const q = encodeURIComponent(`${name} ${city} ${PROVINCES[province]}`).replace(/%20/g, '+');
  firm.mapsUrl = `https://www.google.com/maps/search/${q}`;
  firm.dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(firm.address || `${name} ${city}`).replace(/%20/g, '+')}`;
  firm.blurb = firm.tags[0] ? `${firm.tags[0]} in ${city}.` : `Law firm in ${city}.`;

  const hours = 'hours' in body ? normalizeHours(body.hours) : null;
  const about = 'about' in body ? str(body.about, 0, 2000) || null : null;
  if (checkText) {
    checkOwnerText('Firm name', name);
    checkOwnerText('Practice areas', firm.tags);
    if (about) checkOwnerText('About the firm', about);
  }
  return { firm, hours, about };
}

export async function insertFirm(env, { firm, hours, about }, { status, createdBy }) {
  await env.DB.prepare(
    "INSERT INTO firms (slug,name,city,province,region,featured,rating,review_count,lat,lng,data,hours,about,page_mode,status,created_by) VALUES (?,?,?,?,?,0,0,0,?,?,?,?,?,'dynamic',?,?)"
  )
    .bind(firm.slug, firm.name, firm.city, firm.province, firm.region, firm.lat, firm.lng, JSON.stringify(firm), hours ? JSON.stringify(hours) : null, about, status, createdBy ?? null)
    .run();
}
