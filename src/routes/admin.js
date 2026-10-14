import { json, readJson, clampInt, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { PROVINCES } from '../render/firm-page.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function stats({ request, env }) {
  await requireAdmin(env, request);
  const [firms, posts, leads, week] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n, SUM(featured) AS featured FROM firms'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts'),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status'),
    env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now','-7 days')"),
  ]);
  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
  for (const r of leads.results) byStatus[r.status] = r.n;
  return reply({
    firms: firms.results[0].n,
    featured: firms.results[0].featured || 0,
    blogPosts: posts.results[0].n,
    leads: byStatus,
    leadsLast7Days: week.results[0].n,
  });
}

// Keyset pagination (stable while new leads arrive): pass the previous page's `next` as `before`.
export async function listLeads({ request, env, url }) {
  await requireAdmin(env, request);
  const status = url.searchParams.get('status');
  if (status && !LEAD_STATUSES.includes(status)) throw new HttpError(422, 'Unknown status');
  const limit = clampInt(url.searchParams.get('limit'), 30, 1, 100);
  const before = clampInt(url.searchParams.get('before'), 0, 0, Number.MAX_SAFE_INTEGER);

  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (before) { where.push('id < ?'); args.push(before); }
  const { results } = await env.DB.prepare(
    `SELECT id, form, name, email, phone, message, payload, page, status, created_at FROM leads
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  )
    .bind(...args, limit + 1)
    .all();
  const page = results.slice(0, limit).map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
  return reply({ leads: page, next: results.length > limit ? page[page.length - 1].id : null });
}

export async function updateLead({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 1000);
  if (!LEAD_STATUSES.includes(body.status)) throw new HttpError(422, `status must be one of: ${LEAD_STATUSES.join(', ')}`);
  const id = Number.parseInt(params.id, 10);
  const before = await env.DB.prepare('SELECT status FROM leads WHERE id = ?').bind(id).first();
  if (!before) throw new HttpError(404, 'Lead not found');
  await env.DB.prepare('UPDATE leads SET status = ? WHERE id = ?').bind(body.status, id).run();
  await audit(env, admin, 'lead.status', 'lead', id, { from: before.status, to: body.status });
  return reply({ ok: true });
}

export async function listFirms({ request, env, url }) {
  await requireAdmin(env, request);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = clampInt(url.searchParams.get('limit'), 25, 1, 100);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const { results } = await env.DB.prepare(
    `SELECT slug, name, city, province, featured, rating, review_count, updated_at FROM firms
     WHERE ? = '' OR name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' ORDER BY name LIMIT ? OFFSET ?`
  )
    .bind(q, like, like, limit, offset)
    .all();
  return reply({ firms: results.map((r) => ({ ...r, featured: !!r.featured })) });
}

export async function getFirm({ request, env, params }) {
  await requireAdmin(env, request);
  const row = await env.DB.prepare('SELECT data, hours, page_mode, about, updated_at FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  return reply({ firm: { ...JSON.parse(row.data), about: row.about || '' }, hours: row.hours ? JSON.parse(row.hours) : null, pageMode: row.page_mode, updatedAt: row.updated_at });
}

// Only these fields can be edited from the admin page. Everything else (slug, rating, review
// count, coordinates) is controlled by import scripts, not by hand.
const FIRM_FIELDS = {
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
};

export const CASE_TYPES = ['traffic', 'criminal', 'family', 'injury', 'realestate', 'wills', 'business', 'employment', 'immigration', 'litigation'];

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

function str(v, min, max) {
  if (typeof v !== 'string') throw new HttpError(422, 'Expected text');
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(422, `Text must be ${min}-${max} characters`);
  return s;
}

export async function updateFirm({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 10000);
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(422, 'Nothing to update');
  const unknown = keys.filter((k) => !(k in FIRM_FIELDS) && k !== 'pageMode' && k !== 'hours' && k !== 'about');
  if (unknown.length) throw new HttpError(422, `Cannot edit: ${unknown.join(', ')}`);

  const row = await env.DB.prepare('SELECT data, hours, page_mode, about FROM firms WHERE slug = ?').bind(params.slug).first();
  if (!row) throw new HttpError(404, 'Firm not found');
  const firm = JSON.parse(row.data);

  const changes = {};
  let pageMode = row.page_mode;
  let aboutText = row.about;
  if ('about' in body) {
    const next = str(body.about, 0, 2000) || null;
    if (next !== (row.about || null)) { changes.about = { from: row.about || null, to: next }; aboutText = next; }
  }
  if ('pageMode' in body) {
    if (body.pageMode !== 'static' && body.pageMode !== 'dynamic') throw new HttpError(422, "pageMode must be 'static' or 'dynamic'");
    if (body.pageMode !== row.page_mode) { changes.pageMode = { from: row.page_mode, to: body.pageMode }; pageMode = body.pageMode; }
  }
  let hoursJson = row.hours;
  if ('hours' in body) {
    const next = normalizeHours(body.hours);
    const nextJson = next ? JSON.stringify(next) : null;
    if (nextJson !== row.hours) { changes.hours = { from: row.hours ? JSON.parse(row.hours) : null, to: next }; hoursJson = nextJson; }
  }
  for (const k of keys.filter((k) => k in FIRM_FIELDS)) {
    const next = FIRM_FIELDS[k](body[k]);
    if (JSON.stringify(firm[k]) !== JSON.stringify(next)) {
      changes[k] = { from: firm[k] ?? null, to: next };
      firm[k] = next;
    }
  }
  if (!Object.keys(changes).length) return reply({ ok: true, changed: [] });

  // `data` is the source of truth; the indexed columns are derived from it.
  await env.DB.prepare("UPDATE firms SET data = ?, name = ?, featured = ?, hours = ?, page_mode = ?, about = ?, updated_at = datetime('now') WHERE slug = ?")
    .bind(JSON.stringify(firm), firm.name, firm.featured ? 1 : 0, hoursJson, pageMode, aboutText, params.slug)
    .run();
  await audit(env, admin, 'firm.update', 'firm', params.slug, changes);
  return reply({ ok: true, changed: Object.keys(changes), firm: { ...firm, about: aboutText || '' } });
}

export async function listAudit({ request, env, url }) {
  await requireAdmin(env, request);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 200);
  const { results } = await env.DB.prepare('SELECT id, at, actor_email, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return reply({ entries: results.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
}


// ---------------------------------------------------------------- create a firm
const FOLD = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export const slugify = (text) =>
  String(text).normalize('NFKD').replace(FOLD, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const MONO_COLORS = ['#3a3a1c', '#6b5a45', '#2e4a43', '#4a3a5c', '#5c3a3a', '#35506b', '#4f4a2e', '#5a4636'];
const initialsOf = (name) => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(law|llp|the|and|of|office|offices|firm|professional|corporation)$/i.test(w));
  return ((words[0] || name)[0] + ((words[1] || '')[0] || '')).toUpperCase();
};

export async function createFirm({ request, env }) {
  const admin = await requireAdmin(env, request);
  const body = await readJson(request, 20000);

  const name = str(body.name, 2, 200);
  const city = str(body.city, 2, 80);
  const province = typeof body.province === 'string' ? body.province.toUpperCase() : '';
  if (!(province in PROVINCES)) throw new HttpError(422, `province must be one of: ${Object.keys(PROVINCES).join(', ')}`);
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!(lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52)) throw new HttpError(422, 'lat and lng are required and must be inside Canada');

  const firm = {
    name, city, featured: false,
    tags: 'tags' in body ? FIRM_FIELDS.tags(body.tags) : [],
    caseTypes: 'caseTypes' in body ? FIRM_FIELDS.caseTypes(body.caseTypes) : [],
    province, lat, lng,
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
  await env.DB.prepare(
    "INSERT INTO firms (slug,name,city,province,region,featured,rating,review_count,lat,lng,data,hours,about,page_mode) VALUES (?,?,?,?,?,0,0,0,?,?,?,?,?,'dynamic')"
  )
    .bind(slug, name, city, province, firm.region, lat, lng, JSON.stringify(firm), hours ? JSON.stringify(hours) : null, about)
    .run();
  await audit(env, admin, 'firm.create', 'firm', slug, { name, city, province });
  return reply({ ok: true, slug, url: `/firms/${slug}` }, 201);
}
