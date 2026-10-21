// Admin only: the Outreach desk (table in migration 0031). Who the owner has contacted about listing, claiming or upgrading, where each conversation
// stands and when to follow up. The desk also shows what has happened on the firm's own page since (claimed, Featured), so nothing is kept up by hand.
import { json, readJson, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { torontoDay } from '../lib/stats.js';
import { STAGE_KEYS, CHANNEL_KEYS, isDay, cleanLink, welcomePost } from '../lib/outreach.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const MAX_ROWS = 5000;

async function view(env) {
  const today = torontoDay();
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.person, o.firm_slug AS firmSlug, o.firm_name AS firmName, o.channel, o.link, o.stage, o.note, o.follow_up AS followUp, o.last_contact AS lastContact,
            f.name AS listedName, f.city, f.province, f.featured, f.status AS firmStatus, json_extract(f.data, '$.tags') AS tags,
            EXISTS (SELECT 1 FROM firm_members m WHERE m.firm_slug = o.firm_slug AND m.status = 'approved') AS managed
     FROM outreach o LEFT JOIN firms f ON f.slug = o.firm_slug
     ORDER BY (o.follow_up IS NOT NULL AND o.follow_up <= ?) DESC, o.follow_up IS NULL, o.follow_up, COALESCE(o.updated_at, o.created_at) DESC, o.id DESC`
  ).bind(today).all();
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  const rows = results.map((r) => {
    let tags = [];
    try { tags = JSON.parse(r.tags || '[]'); } catch { /* none */ }
    const listed = !!r.listedName && r.firmStatus === 'live';
    return {
      id: r.id, person: r.person, firmSlug: r.firmSlug, firmName: r.listedName || r.firmName, channel: r.channel, link: r.link, stage: r.stage, note: r.note,
      followUp: r.followUp, lastContact: r.lastContact, due: !!r.followUp && r.followUp <= today && r.stage !== 'not-now',
      firmState: !r.firmSlug ? '' : !listed ? 'unlisted' : r.featured ? 'featured' : r.managed ? 'claimed' : 'listed',
      post: listed ? welcomePost({ name: r.listedName, city: r.city, province: r.province, tags, slug: r.firmSlug, origin }) : '',
    };
  });
  const counts = Object.fromEntries(STAGE_KEYS.map((k) => [k, rows.filter((r) => r.stage === k).length]));
  return { today, rows, counts, due: rows.filter((r) => r.due).length };
}

// A firm address or name from the form, kept only when it is one of the listed firms.
async function firmFor(env, slug) {
  if (slug == null || slug === '') return null;
  const s = text(slug, 120);
  const row = /^[a-z0-9-]+$/.test(s) ? await env.DB.prepare('SELECT slug, name FROM firms WHERE slug = ?').bind(s).first() : null;
  if (!row) throw new HttpError(422, 'That firm is not listed on LawDB');
  return row;
}

function fields(b, partial) {
  const out = {};
  if (!partial || 'person' in b) { out.person = text(b.person, 120); if (!out.person) throw new HttpError(422, 'Who is this? A contact needs a name'); }
  if ('firmName' in b) out.firm_name = text(b.firmName, 120);
  if ('channel' in b) { if (!CHANNEL_KEYS.includes(b.channel)) throw new HttpError(422, 'Unknown channel'); out.channel = b.channel; }
  if ('stage' in b) { if (!STAGE_KEYS.includes(b.stage)) throw new HttpError(422, 'Unknown stage'); out.stage = b.stage; }
  if ('link' in b) {
    const raw = text(b.link, 500);
    out.link = raw ? cleanLink(raw) : '';
    if (raw && !out.link) throw new HttpError(422, 'The link must be a web address starting with https://');
  }
  if ('note' in b) out.note = text(b.note, 1000);
  if ('followUp' in b) {
    if (b.followUp === null || b.followUp === '') out.follow_up = null;
    else if (isDay(b.followUp)) out.follow_up = b.followUp;
    else throw new HttpError(422, 'The follow-up date must look like 2026-11-03');
  }
  return out;
}

export async function listOutreach({ request, env }) {
  await requireAdmin(env, request);
  return reply(await view(env));
}

export async function createOutreach({ request, env }) {
  const admin = await requireAdmin(env, request);
  const b = await readJson(request, 6000);
  const f = fields(b, false);
  const firm = await firmFor(env, b.firmSlug);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM outreach').first();
  if (n.n >= MAX_ROWS) throw new HttpError(429, 'The desk is full; delete finished conversations first');
  const cols = { channel: 'linkedin', stage: 'connected', link: '', note: '', firm_name: '', follow_up: null, ...f, firm_slug: firm ? firm.slug : null, last_contact: torontoDay() };
  const r = await env.DB.prepare('INSERT INTO outreach (person, firm_slug, firm_name, channel, link, stage, note, follow_up, last_contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(cols.person, cols.firm_slug, firm ? '' : cols.firm_name, cols.channel, cols.link, cols.stage, cols.note, cols.follow_up, cols.last_contact).first();
  await audit(env, admin, 'outreach.add', 'outreach', String(r.id), { stage: cols.stage, firm: cols.firm_slug });
  return reply({ ...(await view(env)), id: r.id }, 201);
}

export async function updateOutreach({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const id = Number.parseInt(params.id, 10);
  const row = Number.isFinite(id) ? await env.DB.prepare('SELECT id, stage FROM outreach WHERE id = ?').bind(id).first() : null;
  if (!row) throw new HttpError(404, 'No such contact');
  const b = await readJson(request, 6000);
  const f = fields(b, true);
  const sets = Object.keys(f).map((k) => `${k} = ?`);
  const args = Object.values(f);
  if ('firmSlug' in b) {
    const firm = await firmFor(env, b.firmSlug);
    sets.push('firm_slug = ?'); args.push(firm ? firm.slug : null);
    if (firm) { sets.push("firm_name = ''"); }
  }
  if (b.touched === true || (f.stage && f.stage !== row.stage)) { sets.push('last_contact = ?'); args.push(torontoDay()); } // a stage change or "contacted today" counts as contact
  if (sets.length) await env.DB.prepare(`UPDATE outreach SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...args, id).run();
  if (f.stage && f.stage !== row.stage) await audit(env, admin, 'outreach.stage', 'outreach', String(id), { from: row.stage, to: f.stage });
  return reply(await view(env));
}

export async function deleteOutreach({ request, env, params }) {
  const admin = await requireAdmin(env, request);
  const id = Number.parseInt(params.id, 10);
  const r = Number.isFinite(id) ? await env.DB.prepare('DELETE FROM outreach WHERE id = ?').bind(id).run() : null;
  if (!r || !r.meta.changes) throw new HttpError(404, 'No such contact');
  await audit(env, admin, 'outreach.delete', 'outreach', String(id), {});
  return reply({ ok: true });
}
