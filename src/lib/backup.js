// Nightly housekeeping and backup (Cloudflare cron trigger, see wrangler.jsonc).
//
// Backup: every table that holds real content is exported into the private lawdb-backups KV store,
// in pieces of 2,000 rows under lawdb-<date>/<table>.<part>. Each key expires on its own after 35 days,
// so nothing needs pruning. (Cloudflare D1 also keeps 30 days of point-in-time history by itself; this copy
// is the one we can inspect, hand around, or restore from by hand.)
// Housekeeping: removes expired sign-in records and applies the data-retention promises in the privacy policy.

import { audit } from './audit.js';
import { refreshAllFeeds } from './feeds.js';

export const RETENTION = { leadMonths: 12, ipHashDays: 7, auditMonths: 24, backupDays: 30 };

const TABLES = {
  firms: 'SELECT * FROM firms ORDER BY rowid',
  blog_posts: 'SELECT * FROM blog_posts ORDER BY rowid',
  firm_members: 'SELECT * FROM firm_members ORDER BY id',
  firm_subscriptions: 'SELECT * FROM firm_subscriptions ORDER BY created_at',
  firm_feeds: 'SELECT * FROM firm_feeds ORDER BY firm_slug',
  site_settings: 'SELECT * FROM site_settings ORDER BY key',
  users: 'SELECT id, email, role, disabled, created_at, last_login_at FROM users ORDER BY id', // never tokens or sessions
  firm_images: 'SELECT * FROM firm_images ORDER BY created_at, id', // the files themselves are in the lawdb-images bucket
  leads: 'SELECT * FROM leads ORDER BY id',
  firm_ratings: 'SELECT * FROM firm_ratings ORDER BY user_id, firm_slug',
  follows: 'SELECT * FROM follows ORDER BY user_id, firm_slug',
  saved_stories: 'SELECT * FROM saved_stories ORDER BY user_id, post_id',
  audit_log: 'SELECT * FROM audit_log ORDER BY id',
};
const PAGE = 2000;

async function readAll(env, sql) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await env.DB.prepare(`${sql} LIMIT ${PAGE} OFFSET ${offset}`).all();
    rows.push(...results);
    if (results.length < PAGE) return rows;
  }
}

export async function runBackup(env, actor) {
  if (!env.BACKUPS) throw new Error('Backup storage (BACKUPS KV namespace) is not configured');
  const day = new Date().toISOString().slice(0, 10);
  const ttl = { expirationTtl: RETENTION.backupDays * 86400 + 5 * 86400 };
  const counts = {};
  let bytes = 0;
  for (const [name, sql] of Object.entries(TABLES)) {
    const rows = await readAll(env, sql);
    counts[name] = rows.length;
    const parts = Math.max(1, Math.ceil(rows.length / PAGE));
    for (let i = 0; i < parts; i++) {
      const body = JSON.stringify(rows.slice(i * PAGE, (i + 1) * PAGE));
      bytes += body.length;
      await env.BACKUPS.put(`lawdb-${day}/${name}.${String(i + 1).padStart(3, '0')}`, body, ttl);
    }
  }
  const manifest = { createdAt: new Date().toISOString(), rows: counts, bytes };
  await env.BACKUPS.put(`lawdb-${day}/manifest`, JSON.stringify(manifest), ttl);
  await audit(env, actor, 'backup.ok', 'backup', `lawdb-${day}`, manifest);
  return { key: `lawdb-${day}`, bytes, rows: counts };
}

export async function housekeeping(env) {
  const run = (sql) => env.DB.prepare(sql).run();
  const [sessions, tokens, ips1, ips2, leads, logs] = await Promise.all([
    run("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    run("DELETE FROM login_tokens WHERE expires_at < datetime('now', '-1 day')"),
    run(`UPDATE login_tokens SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < datetime('now', '-${RETENTION.ipHashDays} days')`),
    run(`UPDATE leads SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at < datetime('now', '-${RETENTION.ipHashDays} days')`),
    // Enquiries keep only "which firm, when, what status" once they are old, so reports still add up.
    run(`UPDATE leads SET name = NULL, email = NULL, phone = NULL, message = NULL, payload = '{}', page = NULL
         WHERE created_at < datetime('now', '-${RETENTION.leadMonths} months') AND (email IS NOT NULL OR name IS NOT NULL OR message IS NOT NULL OR phone IS NOT NULL)`),
    run(`DELETE FROM audit_log WHERE at < datetime('now', '-${RETENTION.auditMonths} months')`),
    run("DELETE FROM stripe_events WHERE received_at < datetime('now', '-90 days')"),
  ]);
  const n = (r) => r.meta?.changes ?? 0;
  const detail = { sessions: n(sessions), tokens: n(tokens), ipHashes: n(ips1) + n(ips2), leadsAnonymised: n(leads), auditDeleted: n(logs) };
  await audit(env, null, 'housekeeping.ok', 'system', 'nightly', detail);
  return detail;
}

export async function nightly(env) {
  try { await housekeeping(env); } catch (err) { console.error('housekeeping failed', err); await audit(env, null, 'housekeeping.failed', 'system', 'nightly', { error: String(err.message || err).slice(0, 300) }); }
  try { await refreshAllFeeds(env); } catch (err) { console.error('feed refresh failed', err); await audit(env, null, 'feeds.failed', 'system', 'nightly', { error: String(err.message || err).slice(0, 300) }); }
  try { await runBackup(env, null); } catch (err) { console.error('backup failed', err); await audit(env, null, 'backup.failed', 'backup', 'nightly', { error: String(err.message || err).slice(0, 300) }); }
}
