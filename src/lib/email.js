import { HttpError } from './http.js';

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Transactional email through Brevo (sender info@lawdb.ca is verified there).
export async function sendLoginEmail(env, to, link) {
  if (!env.BREVO_API_KEY) throw new HttpError(500, 'Email is not configured');
  const text = `Use this link to sign in to LawDB. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`;
  const html =
    `<p>Use this button to sign in to LawDB. The link works once and expires in 15 minutes.</p>` +
    `<p><a href="${esc(link)}" style="background:#b8863b;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Sign in to LawDB</a></p>` +
    `<p style="color:#666;font-size:13px">If you did not ask for this, you can ignore this email.</p>`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env.MAIL_FROM_NAME || 'LawDB', email: env.MAIL_FROM_EMAIL || 'info@lawdb.ca' },
      to: [{ email: to }],
      subject: 'Your LawDB sign-in link',
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) throw new Error(`Brevo responded ${res.status}`);
}
