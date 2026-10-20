// Admin only: the Future projects list and the daily journal (tables in migration 0029; the journal itself is written by src/lib/journal.js).
import { json, readJson, NO_STORE, HttpError } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { journalView, journalNightly, compileDay } from '../lib/journal.js';

const reply = (body, status = 200) => json(body, status, NO_STORE);
export const STATUSES = ['idea', 'next', 'doing', 'done'];
const SOURCES = ['you', 'claude'];
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const COLS = 'id, title, detail, source, asked_on AS askedOn, status, sort, created_at AS createdAt, done_at AS doneAt';

export async function listProjects({ request, env }) {
  await requireAdmin(env, request);
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM projects ORDER BY sort, id`).all();
  return reply({ projects: results });
}

export async function createProject({ request, env }) {
  await requireAdmin(env, request);
  const b = await readJson(request, 4000);
  const title = text(b.title, 120);
  if (!title) throw new HttpError(422, 'A project needs a title');
  const status = STATUSES.includes(b.status) ? b.status : 'idea';
  const source = SOURCES.includes(b.source) ? b.source : 'you';
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM projects').first();
  const r = await env.DB.prepare(`INSERT INTO projects (title, detail, source, asked_on, status, sort, done_at) VALUES (?, ?, ?, ?, ?, ?, ${status === 'done' ? "datetime('now')" : 'NULL'}) RETURNING ${COLS}`)
    .bind(title, text(b.detail, 1200), source, /^\d{4}-\d{2}-\d{2}$/.test(b.askedOn || '') ? b.askedOn : null, status, max.m + 10).first();
  return reply({ project: r }, 201);
}

export async function updateProject({ request, env, params }) {
  await requireAdmin(env, request);
  const id = Number.parseInt(params.id, 10);
  const row = Number.isFinite(id) ? await env.DB.prepare('SELECT id, status FROM projects WHERE id = ?').bind(id).first() : null;
  if (!row) throw new HttpError(404, 'No such project');
  const b = await readJson(request, 4000);
  const sets = [];
  const args = [];
  if ('title' in b) { const t = text(b.title, 120); if (!t) throw new HttpError(422, 'A project needs a title'); sets.push('title = ?'); args.push(t); }
  if ('detail' in b) { sets.push('detail = ?'); args.push(text(b.detail, 1200)); }
  if ('source' in b) { if (!SOURCES.includes(b.source)) throw new HttpError(422, 'Unknown source'); sets.push('source = ?'); args.push(b.source); }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) throw new HttpError(422, 'Unknown status');
    sets.push('status = ?'); args.push(b.status);
    if (b.status === 'done' && row.status !== 'done') sets.push("done_at = datetime('now')");
    if (b.status !== 'done') sets.push('done_at = NULL');
  }
  if (b.move === 'up' || b.move === 'down') { // swap places with the neighbour above or below
    const nb = await env.DB.prepare(`SELECT id, sort FROM projects WHERE ${b.move === 'up' ? 'sort < (SELECT sort FROM projects WHERE id = ?) ORDER BY sort DESC' : 'sort > (SELECT sort FROM projects WHERE id = ?) ORDER BY sort ASC'} LIMIT 1`).bind(id).first();
    if (nb) {
      const mine = await env.DB.prepare('SELECT sort FROM projects WHERE id = ?').bind(id).first();
      await env.DB.batch([env.DB.prepare('UPDATE projects SET sort = ? WHERE id = ?').bind(nb.sort, id), env.DB.prepare('UPDATE projects SET sort = ? WHERE id = ?').bind(mine.sort, nb.id)]);
    }
  }
  if (sets.length) await env.DB.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...args, id).run();
  const { results } = await env.DB.prepare(`SELECT ${COLS} FROM projects ORDER BY sort, id`).all();
  return reply({ projects: results });
}

export async function deleteProject({ request, env, params }) {
  await requireAdmin(env, request);
  const id = Number.parseInt(params.id, 10);
  const r = Number.isFinite(id) ? await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run() : null;
  if (!r || !r.meta.changes) throw new HttpError(404, 'No such project');
  return reply({ ok: true });
}

// ---- journal
export async function journalGet({ request, env }) {
  await requireAdmin(env, request);
  return reply(await journalView(env));
}

export async function journalNote({ request, env, params }) {
  await requireAdmin(env, request);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.day)) throw new HttpError(400, 'Not a date');
  const b = await readJson(request, 2000);
  const note = text(b.note, 500);
  const row = await env.DB.prepare('SELECT day FROM journal WHERE day = ?').bind(params.day).first();
  if (row) await env.DB.prepare('UPDATE journal SET note = ? WHERE day = ?').bind(note, params.day).run();
  else await env.DB.prepare('INSERT INTO journal (day, body, note) VALUES (?, ?, ?)').bind(params.day, JSON.stringify(await compileDay(env, params.day)), note).run(); // a note on a day the nightly job has not written yet
  return reply({ ok: true, note });
}

export async function journalRebuild({ request, env }) {
  await requireAdmin(env, request);
  return reply({ ok: true, written: await journalNightly(env) });
}
