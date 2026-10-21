// The Outreach desk's rules (admin only): the stages and channels, how a day is added to, and the LinkedIn "now live" post for a firm that is listed.
import { PROVINCES } from '../render/firm-page.js';
import { cleanBookingUrl } from './booking.js';

export const STAGES = [['connected', 'Connected'], ['messaged', 'Messaged'], ['replied', 'Replied'], ['call', 'Call'], ['agreed', 'Said yes'], ['not-now', 'Not now']];
export const CHANNELS = [['linkedin', 'LinkedIn'], ['phone', 'Phone'], ['email', 'Email'], ['in-person', 'In person'], ['other', 'Other']];
export const STAGE_KEYS = STAGES.map(([k]) => k);
export const CHANNEL_KEYS = CHANNELS.map(([k]) => k);

export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

// `day` plus `n` days, as YYYY-MM-DD (days are calendar days, so no clock or time zone is involved)
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// A profile or page address kept for the owner's reference: the same rule as a booking link (https only, no sign-in details, tracking parts dropped,
// so a LinkedIn share link with ?utm_source=share_via becomes the plain profile address).
export const cleanLink = (v) => cleanBookingUrl(typeof v === 'string' ? v : '');

// The LinkedIn post that goes with the "now live on LawDB" card. Only what the directory itself knows: the firm's name, its practice areas as listed and where it is.
export function welcomePost({ name, city, province, tags, slug, origin }) {
  const kinds = (Array.isArray(tags) ? tags : []).filter(Boolean).slice(0, 2).join(' and ');
  const where = [city, PROVINCES[province] || province].filter(Boolean).join(', ');
  const what = kinds ? `${kinds}${where ? ` in ${where}` : ''}` : where ? `law firm in ${where}` : 'law firm';
  return `Welcome to LawDB, ${name}! \u{1F389}\n\nTheir profile is now live on Canada's legal directory: ${what}.\n\nSee their profile: ${origin}/firms/${slug}`;
}
