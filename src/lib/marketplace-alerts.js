// Lead Marketplace alerts: email only (no SMS), and only to firms the inquiry matches (practice area and province, and city if the firm set cities).
// A new inquiry goes out in capped waves a few minutes apart, Featured firms first; Basic firms are told only after the Featured head start. A firm can choose
// instant emails, a daily digest or none. Every send is recorded (marketplace_alerts), so no firm is told about the same inquiry twice.
// Run by the five-minute cron (processAlerts) and the hourly cron (sendDigests).
import { getConfig, isOpen, sqlTime, parseSql, AREAS, AREA_LABEL, URGENCY, priceFor } from './marketplace.js';
import { sendMail, marketplaceAlertEmail } from './email.js';
import { audit } from './audit.js';

const list = (s) => String(s || '').split(',').filter(Boolean);

// Live, verified firms that opted in (have a marketplace row) and have not turned alerts off.
async function optedInFirms(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.firm_slug AS slug, f.name, f.featured, f.province, f.data, m.practice_areas, m.provinces, m.cities, m.alerts, m.digest_at
     FROM marketplace_firms m JOIN firms f ON f.slug = m.firm_slug JOIN firm_verifications v ON v.firm_slug = m.firm_slug AND v.status = 'verified'
     WHERE f.status = 'live' AND m.alerts != 'off' ORDER BY f.featured DESC, m.firm_slug`
  ).all();
  return results.map((r) => {
    const own = (JSON.parse(r.data).caseTypes || []).filter((a) => AREAS.includes(a));
    return { slug: r.slug, name: r.name, featured: !!r.featured, alerts: r.alerts, digestAt: r.digest_at,
      areas: list(r.practice_areas).length ? list(r.practice_areas) : own, provinces: list(r.provinces).length ? list(r.provinces) : [r.province], cities: list(r.cities).map((c) => c.toLowerCase()) };
  });
}
export const matches = (firm, lead) => firm.areas.includes(lead.practice_area) && firm.provinces.includes(lead.province) && (!firm.cities.length || firm.cities.includes(String(lead.city || '').toLowerCase()));

async function owners(env, slug) {
  const { results } = await env.DB.prepare("SELECT u.email FROM firm_members m JOIN users u ON u.id = m.user_id WHERE m.firm_slug = ? AND m.status = 'approved' AND u.disabled = 0").bind(slug).all();
  return [...new Set(results.map((r) => r.email.toLowerCase()))];
}
async function send(env, message) {
  try { await sendMail(env, { ...message, transport: 'alerts' }); } catch (err) {
    console.error('marketplace mail failed', err);
    await audit(env, null, 'mail.failed', 'email', [].concat(message.to).join(','), { subject: message.subject, error: String(err.message || err).slice(0, 300) });
  }
}
const preview = (cfg, lead, now) => {
  const p = priceFor(cfg, lead.practice_area, lead.approved_at, now);
  return { practiceAreaLabel: AREA_LABEL[lead.practice_area], city: lead.city, province: lead.province, urgencyLabel: URGENCY[lead.urgency] || URGENCY.unspecified, summary: lead.summary_public, price: p.credits, ageMinutes: Math.max(0, Math.round((now - parseSql(lead.approved_at)) / 60000)) };
};

// One pass of the five-minute job: for each approved inquiry whose next wave is due, tell the next firms (up to the wave size).
export async function processAlerts(env, now = new Date()) {
  if (!(await isOpen(env))) return { waves: 0, emails: 0 };
  const cfg = await getConfig(env);
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  const { results: due } = await env.DB.prepare("SELECT * FROM marketplace_leads WHERE status = 'approved' AND alert_next_at IS NOT NULL AND alert_next_at <= ? AND expires_at > ? ORDER BY id LIMIT 20").bind(sqlTime(now), sqlTime(now)).all();
  if (!due.length) return { waves: 0, emails: 0 };
  const firms = await optedInFirms(env);
  let waves = 0, emails = 0;
  for (const lead of due) {
    const told = new Set((await env.DB.prepare('SELECT firm_slug FROM marketplace_alerts WHERE lead_id = ?').bind(lead.id).all()).results.map((r) => r.firm_slug));
    const headEnd = new Date(parseSql(lead.approved_at).getTime() + cfg.headStartMinutes * 60000);
    const pastHead = now >= headEnd;
    const pool = firms.filter((f) => f.alerts === 'instant' && f.slug !== lead.source_firm && !told.has(f.slug) && matches(f, lead)); // Featured firms come first (the query's order)
    const pick = pool.filter((f) => f.featured || pastHead).slice(0, cfg.alertWaveSize);
    const wave = lead.alert_wave + 1;
    let next = null;
    if (pick.length) {
      const body = preview(cfg, lead, now);
      for (const f of pick) {
        const to = await owners(env, f.slug);
        if (to.length) { await send(env, { to, ...marketplaceAlertEmail(origin, { firmName: f.name, slug: f.slug, leads: [body], headStart: f.featured && !pastHead }) }); emails++; }
        await env.DB.prepare('INSERT OR IGNORE INTO marketplace_alerts (lead_id, firm_slug, wave) VALUES (?, ?, ?)').bind(lead.id, f.slug, wave).run();
      }
      waves++;
      const left = pool.length - pick.length;
      if (left > 0 && wave < cfg.alertMaxWaves) {
        // Only Basic firms are left and the head start is not over: they are told when it ends. Otherwise the next wave is one gap later.
        next = sqlTime(!pastHead && pool.slice(pick.length).every((f) => !f.featured) ? headEnd : new Date(now.getTime() + cfg.alertGapMinutes * 60000));
      }
    } else if (!pastHead && pool.some((f) => !f.featured) && wave <= cfg.alertMaxWaves) {
      next = sqlTime(headEnd); // only Basic firms are left, and the head start is not over: try again when it is
    }
    await env.DB.prepare('UPDATE marketplace_leads SET alert_wave = ?, alert_next_at = ? WHERE id = ?').bind(pick.length ? wave : lead.alert_wave, next, lead.id).run();
  }
  return { waves, emails };
}

// The daily digest: firms that chose "daily" get one email (once in about 24 hours, from 13:00 UTC) with the matching inquiries of the last day.
export async function sendDigests(env, now = new Date()) {
  if (!(await isOpen(env)) || now.getUTCHours() < 13) return { digests: 0 };
  const cfg = await getConfig(env);
  const origin = env.SITE_ORIGIN || 'https://lawdb.ca';
  const firms = (await optedInFirms(env)).filter((f) => f.alerts === 'daily' && (!f.digestAt || parseSql(f.digestAt) <= new Date(now.getTime() - 20 * 3600e3))).slice(0, 25);
  if (!firms.length) return { digests: 0 };
  const { results: leads } = await env.DB.prepare("SELECT * FROM marketplace_leads WHERE status = 'approved' AND expires_at > ? AND approved_at >= ? ORDER BY approved_at DESC LIMIT 200").bind(sqlTime(now), sqlTime(new Date(now.getTime() - 24 * 3600e3))).all();
  let digests = 0;
  for (const f of firms) {
    const mine = leads.filter((l) => l.source_firm !== f.slug && matches(f, l) && (f.featured || now - parseSql(l.approved_at) >= cfg.headStartMinutes * 60000)).slice(0, 20);
    await env.DB.prepare("UPDATE marketplace_firms SET digest_at = ? WHERE firm_slug = ?").bind(sqlTime(now), f.slug).run();
    if (!mine.length) continue;
    const to = await owners(env, f.slug);
    if (to.length) { await send(env, { to, ...marketplaceAlertEmail(origin, { firmName: f.name, slug: f.slug, leads: mine.map((l) => preview(cfg, l, now)), digest: true }) }); digests++; }
  }
  return { digests };
}
