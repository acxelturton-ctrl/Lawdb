// A firm's own online booking link (a calendar such as Calendly or Clio, or the page on its website where a call or consultation is booked).
// Shared by the owner and admin edit forms, the script that loads the links found on firms' websites, and the page button, so what is stored
// and what is shown follow the same rule: https only, a real web address, no sign-in or login details in it, and the tracking and
// "which month to open" parts dropped so a link found years ago still opens the calendar today.
const DROP_PARAMS = /^(utm_[a-z]+|fbclid|gclid|msclkid|mc_[a-z]+|_ga|month|back|hide_[a-z_]+|noframe|skipheaderfooter)$/i;
const TRACKING_HOST = /(^|\.)(ablink\.send\.calendly\.com|click\.[a-z0-9.-]+|links?\.[a-z0-9.-]*mailchimp\.com|list-manage\.com|sendgrid\.net|mandrillapp\.com)$/i;

// The address to keep, or '' when `raw` is not a usable booking link.
export function cleanBookingUrl(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s || s.length > 500 || /\s/.test(s)) return '';
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || host === 'lawdb.ca' || host.endsWith('.lawdb.ca')) return '';
  if (TRACKING_HOST.test(host)) return '';
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (DROP_PARAMS.test(k)) u.searchParams.delete(k);
  const out = u.toString();
  return out.length <= 500 ? out : '';
}
