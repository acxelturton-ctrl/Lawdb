// The hourly cron (wrangler.jsonc: "7 * * * *"): ends free months that ran out, warns the ones about to, and sends the weekly owner reports.
// Each part works through a small batch and remembers its place in the database, so a busy hour is simply finished by the next one.
import { audit } from './audit.js';
import { processTrials } from './trial.js';
import { sendWeeklyReports } from './owner-reports.js';

export async function hourly(env) {
  const failed = async (what, err) => { console.error(`${what} failed`, err); await audit(env, null, `${what}.failed`, 'system', 'hourly', { error: String(err.message || err).slice(0, 300) }); };
  try { await processTrials(env); } catch (err) { await failed('trial', err); }
  try { await sendWeeklyReports(env); } catch (err) { await failed('reports', err); }
}
