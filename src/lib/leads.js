// The enquiries dashboard: who may read enquiries (Featured firms), the numbers on top, the spreadsheet export and the weekly summary email.
import { sendMail, leadDigestEmail } from './email.js';
import { audit } from './audit.js';

export const LEAD_STATUSES = ['new', 'contacted', 'closed', 'spam'];

export async function isFeatured(env, slug) {
  return !!(await env.DB.prepare('SELECT 1 FROM firms WHERE slug = ? AND featured = 1').bind(slug).first());
}

// Spam never counts towards the numbers.
export async function leadSummary(env, slug) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'new'), 0) AS fresh,
            COALESCE(SUM(status = 'new' AND seen_at IS NULL), 0) AS unread,
            COALESCE(SUM(created_at > datetime('now','-7 days')), 0) AS week,
            COALESCE(SUM(created_at > datetime('now','-30 days')), 0) AS month
     FROM leads WHERE firm_slug = ? AND status != 'spam'`
  ).bind(slug).first();
  return { total: r.total, new: r.fresh, unread: r.unread, week: r.week, month: r.month };
}

// A spreadsheet opens "=cmd..." cells as formulas, so any cell that starts like one is made harmless.
const cell = (v) => {
  let s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
export function leadsCsv(rows) {
  const head = ['Received (UTC)', 'Name', 'Email', 'Phone', 'Message', 'Status', 'Your note'];
  const lines = rows.map((r) => [r.created_at, r.name, r.email, r.phone, r.message, r.status, r.note].map(cell).join(','));
  return '﻿' + [head.map(cell).join(','), ...lines].join('\r\n') + '\r\n';
}

// Mondays (every night when running locally for tests): each owner whose firm got enquiries in the last week gets one summary.
export async function sendLeadDigests(env) {
  if (new Date().getUTCDay() !== 1 && env.DEV_ECHO_LINK !== '1') return { skipped: 'not Monday' };
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.firm_slug AS slug, u.email, f.name, f.featured AS featured,
            (SELECT COUNT(*) FROM leads l WHERE l.firm_slug = m.firm_slug AND l.status != 'spam' AND l.created_at > datetime('now','-7 days')) AS week,
            (SELECT COUNT(*) FROM leads l WHERE l.firm_slug = m.firm_slug AND l.status = 'new') AS fresh
     FROM firm_members m JOIN users u ON u.id = m.user_id JOIN firms f ON f.slug = m.firm_slug
     WHERE m.status = 'approved' AND u.disabled = 0 AND f.status = 'live' AND (m.digest_at IS NULL OR m.digest_at < datetime('now','-5 days')) LIMIT 300`
  ).all();
  let sent = 0, failed = 0;
  for (const r of results) {
    if (!r.week) continue;
    try {
      await sendMail(env, { to: r.email, ...leadDigestEmail(origin, { firmName: r.name, week: r.week, fresh: r.fresh, featured: !!r.featured }) });
      await env.DB.prepare("UPDATE firm_members SET digest_at = datetime('now') WHERE id = ?").bind(r.id).run();
      sent++;
    } catch (err) {
      failed++;
      console.error('lead summary email failed', err);
    }
  }
  await audit(env, null, 'leads.digest', 'system', 'weekly', { sent, failed });
  return { sent, failed };
}
