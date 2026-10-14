import { audit } from './audit.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Transactional email through Brevo (sender info@lawdb.ca is verified there).
export async function sendMail(env, { to, subject, text, html }) {
  const recipients = [].concat(to).filter(Boolean);
  if (!recipients.length) return;
  // Local development: do not send, leave a trace the tests (and a developer) can read.
  if (env.DEV_ECHO_LINK === '1') return audit(env, null, 'mail.dev', 'email', recipients.join(','), { subject });
  const apiKey = (env.BREVO_API_KEY || '').trim(); // tolerate a stray space or newline from pasting
  if (!apiKey) throw new Error('BREVO_API_KEY secret is missing or empty');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env.MAIL_FROM_NAME || 'LawDB', email: env.MAIL_FROM_EMAIL || 'info@lawdb.ca' },
      to: recipients.map((email) => ({ email })),
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!res.ok) {
    // Brevo explains itself, e.g. {"code":"unauthorized","message":"Key not found"}. Never includes our key.
    let why = '';
    try {
      const body = await res.json();
      why = body.message || body.code || '';
    } catch {}
    throw new Error(`Brevo ${res.status}: ${String(why).slice(0, 200)}`);
  }
}

// Fire-and-forget: a mail problem is written to the audit log (Activity tab) and never blocks the action.
export const mailInBackground = (env, exec, message) =>
  exec(
    sendMail(env, message).catch((err) => {
      console.error('mail failed', err);
      return audit(env, null, 'mail.failed', 'email', [].concat(message.to).join(','), { subject: message.subject, error: String(err.message || err).slice(0, 300) });
    })
  );

const button = (link, label) =>
  `<p><a href="${esc(link)}" style="background:#b8863b;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
const small = (text) => `<p style="color:#666;font-size:13px">${esc(text)}</p>`;

export function loginEmail(link) {
  return {
    subject: 'Your LawDB sign-in link',
    text: `Use this link to sign in to LawDB. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    html: `<p>Use this button to sign in to LawDB. The link works once and expires in 15 minutes.</p>${button(link, 'Sign in to LawDB')}${small('If you did not ask for this, you can ignore this email.')}`,
  };
}

export const sendLoginEmail = (env, to, link) => sendMail(env, { to, ...loginEmail(link) });

export function newClaimEmail(origin, { email, contactName, jobTitle, firmName, city, isNew }) {
  const link = `${origin}/admin/#approvals`;
  const who = `${contactName}${jobTitle ? ` (${jobTitle})` : ''}, ${email}`;
  const what = isNew ? `wants to list a new firm: ${firmName}, ${city}` : `wants to manage: ${firmName}, ${city}`;
  return {
    subject: `Approval needed: ${firmName}`,
    text: `${who} ${what}.\n\nReview it (one tap to approve or reject): ${link}`,
    html: `<p><b>${esc(contactName)}</b>${jobTitle ? ` (${esc(jobTitle)})` : ''}, ${esc(email)} ${esc(what)}.</p>${button(link, 'Review in LawDB admin')}`,
  };
}

export function decisionEmail(origin, { firmName, approved }) {
  const link = `${origin}/account/`;
  return approved
    ? {
        subject: `You can now manage ${firmName} on LawDB`,
        text: `Your request was approved. You can now edit ${firmName} and see its enquiries here:\n\n${link}`,
        html: `<p>Your request was approved. You can now edit <b>${esc(firmName)}</b> and see its enquiries.</p>${button(link, 'Open my dashboard')}`,
      }
    : {
        subject: `About your request for ${firmName} on LawDB`,
        text: `We could not approve your request for ${firmName}. If you think this is a mistake, reply to this email or write to info@lawdb.ca.`,
        html: `<p>We could not approve your request for <b>${esc(firmName)}</b>. If you think this is a mistake, reply to this email or write to info@lawdb.ca.</p>`,
      };
}

export function leadEmail(origin, firmName, lead) {
  const link = `${origin}/account/#leads`;
  const lines = [
    ['Name', lead.name], ['Email', lead.email], ['Phone', lead.phone], ['Message', lead.message],
  ].filter(([, v]) => v);
  return {
    subject: `New enquiry for ${firmName}`,
    text: `Someone contacted ${firmName} through LawDB.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nAll enquiries: ${link}`,
    html: `<p>Someone contacted <b>${esc(firmName)}</b> through LawDB.</p><table cellpadding="4" style="border-collapse:collapse">${lines
      .map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
      .join('')}</table>${button(link, 'Open my enquiries')}`,
  };
}

export function reportEmail(origin, { slug, reason, name, email, message }) {
  const link = `${origin}/admin/#leads`;
  const firm = slug ? `${origin}/firms/${slug}` : '(no firm given)';
  const lines = [['Listing', firm], ['Reason', reason], ['From', `${name} <${email}>`], ['Details', message]].filter(([, v]) => v);
  return {
    subject: `Listing reported${slug ? ': ' + slug : ''}`,
    text: `A visitor reported a listing.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReview it in the admin: ${link}`,
    html: `<p>A visitor reported a listing.</p><table cellpadding="4">${lines.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>${button(link, 'Open the admin')}`,
  };
}
