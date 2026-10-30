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
  `<p><a href="${esc(link)}" style="background:#e2bd6a;color:#142434;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
const small = (text) => `<p style="color:#586170;font-size:13px">${esc(text)}</p>`;

export function loginEmail(link) {
  return {
    subject: 'Your LawDB sign-in link',
    text: `Use this link to sign in to LawDB. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    html: `<p>Use this button to sign in to LawDB. The link works once and expires in 15 minutes.</p>${button(link, 'Sign in to LawDB')}${small('If you did not ask for this, you can ignore this email.')}`,
  };
}

export const sendLoginEmail = (env, to, link) => sendMail(env, { to, ...loginEmail(link) });

export function inviteEmail(link, { firmName, days }) {
  return {
    subject: `Your ${firmName} profile on LawDB is ready`,
    text: `Hello,\n\nAs we discussed, your firm's profile on LawDB.ca is ready for you to manage. Use this link to sign in and edit ${firmName}: your description, practice areas, hours, photos and more.\n\n${link}\n\nThe link works once and expires in ${days} days. After the first time you can sign in with Google or LinkedIn using this same email address.\n\nIf you were not expecting this, you can ignore this email.`,
    html: `<p>As we discussed, your firm's profile on LawDB.ca is ready for you to manage. Use the button below to sign in and edit <b>${esc(firmName)}</b>: your description, practice areas, hours, photos and more.</p>${button(link, 'Open my profile')}${small(`The link works once and expires in ${days} days. After the first time you can sign in with Google or LinkedIn using this same email address. If you were not expecting this, you can ignore this email.`)}`,
  };
}

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

// Sent once, when an account is created (by email link, Google or LinkedIn).
export function welcomeEmail(origin, { name }) {
  const link = `${origin}/account/#profile`;
  const hi = name ? `Hi ${name.split(/\s+/)[0]},` : 'Hi,';
  const things = [
    'Follow law firms and see their latest stories in your own feed',
    'Save the stories you want to come back to',
    'Rate firms you have worked with, to help others choose',
    'Claim or manage your firm\'s listing, if you are a lawyer',
  ];
  return {
    subject: 'Welcome to LawDB: your member account is active',
    text: `${hi}\n\nYour LawDB member account is active. Continue setting up your profile here:\n${link}\n\nWhat you can do with LawDB:\n${things.map((t) => '- ' + t).join('\n')}\n\nHave questions? Just reply to this email.\n\nThe LawDB team`,
    html: `<p>${esc(hi)}</p><p>Your LawDB member account is active, and you can now use LawDB to follow law firms, save stories and build your profile.</p>` +
      `<div style="border-left:4px solid #c9a050;background:#f4ecd8;padding:12px 16px;margin:16px 0"><b>Continue setting up your profile</b><br>Add your name and tell us who you are, so firms and other members recognise you.</div>` +
      `${button(link, 'Continue setting up your profile')}<p style="margin-top:24px"><b>What you can do with LawDB</b></p><ul>${things.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` +
      `<p style="color:#586170">Have questions? Just reply to this email.</p>`,
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
      .map(([k, v]) => `<tr><td style="color:#586170;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`)
      .join('')}</table>${button(link, 'Open my enquiries')}`,
  };
}

export function leadDigestEmail(origin, { firmName, week, fresh, featured }) {
  const link = `${origin}/account/#leads`;
  const n = (c, w) => `${c} ${c === 1 ? w : w + 's'}`;
  const pitch = featured
    ? `${fresh} ${fresh === 1 ? 'is' : 'are'} still marked new. Open your dashboard to reply, add notes or export them.`
    : `Featured firms are listed above Basic firms in their city and case type, and read and manage enquiries in a dashboard, with notes, filters and a spreadsheet export. Your enquiry emails keep coming either way.`;
  return {
    subject: `${firmName}: ${n(week, 'enquiry').replace('enquirys', 'enquiries')} on LawDB this week`,
    text: `${firmName} received ${n(week, 'enquiry').replace('enquirys', 'enquiries')} through LawDB in the last 7 days.\n\n${pitch}\n\n${featured ? 'Open your enquiries' : 'See your plan'}: ${link}`,
    html: `<p><b>${esc(firmName)}</b> received <b>${esc(n(week, 'enquiry').replace('enquirys', 'enquiries'))}</b> through LawDB in the last 7 days.</p><p>${esc(pitch)}</p>${button(link, featured ? 'Open my enquiries' : 'See my plan')}`,
  };
}

export function reportEmail(origin, { slug, reason, name, email, message }) {
  const link = `${origin}/admin/#leads`;
  const firm = slug ? `${origin}/firms/${slug}` : '(no firm given)';
  const lines = [['Listing', firm], ['Reason', reason], ['From', `${name} <${email}>`], ['Details', message]].filter(([, v]) => v);
  return {
    subject: `Listing reported${slug ? ': ' + slug : ''}`,
    text: `A visitor reported a listing.\n\n${lines.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReview it in the admin: ${link}`,
    html: `<p>A visitor reported a listing.</p><table cellpadding="4">${lines.map(([k, v]) => `<tr><td style="color:#586170;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>${button(link, 'Open the admin')}`,
  };
}

// What a Featured firm gets, as the site does it today (the same list the owner's plan card shows).
const FEATURED_GETS = [
  'Listed above Basic firms in search results for your city and case type, with a Featured Partner card at the top of the Find results',
  'First in the live search box, with a gold Featured badge',
  'A gold pin on the map, and a gold tick and Featured badge on your profile',
  'Listed first among nearby firms on other firms\' profiles and story pages',
  'An enquiries dashboard with filters, private notes, one-tap reply and a spreadsheet export',
  'A Featured badge on your stories in LawDB News, a LawDB page search engines can find for each article, and higher placement in the home page news strip',
];

export function featuredOnEmail(origin, { firmName }) {
  const link = `${origin}/account/`;
  return {
    subject: `${firmName} is now Featured on LawDB`,
    text: `Thank you. Your payment went through and ${firmName} is now a Featured listing. Here is what it includes:\n\n${FEATURED_GETS.map((g) => `- ${g}`).join('\n')}\n\nManage your listing: ${link}`,
    html: `<p>Thank you. Your payment went through and <b>${esc(firmName)}</b> is now a <b>Featured</b> listing. Here is what it includes:</p><ul>${FEATURED_GETS.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>${button(link, 'Open my dashboard')}`,
  };
}

export function featuredOffEmail(origin, { firmName }) {
  const link = `${origin}/account/`;
  return {
    subject: `${firmName}: Featured listing ended`,
    text: `The Featured subscription for ${firmName} has ended, so the listing is back to Basic. You can upgrade again any time from your dashboard: ${link}`,
    html: `<p>The Featured subscription for <b>${esc(firmName)}</b> has ended, so the listing is back to Basic. You can upgrade again any time.</p>${button(link, 'Open my dashboard')}`,
  };
}

export function paymentReviewEmail(origin, { email, firmName }) {
  const link = `${origin}/admin/#payments`;
  return {
    subject: 'A Featured payment needs your review',
    text: `${email} paid for Featured (${firmName}), but we could not match the payment to an approved owner of that firm. Nothing was changed.\n\nReview it: ${link}`,
    html: `<p><b>${esc(email)}</b> paid for Featured (${esc(firmName)}), but we could not match the payment to an approved owner of that firm. Nothing was changed.</p>${button(link, 'Review the payment')}`,
  };
}

export function paymentFailedEmail(origin, { firmName }) {
  const link = `${origin}/account/`;
  return {
    subject: `Payment problem for ${firmName}`,
    text: `The latest Featured payment for ${firmName} did not go through. Stripe will try the card again. To update the card, open the billing page from your dashboard: ${link}`,
    html: `<p>The latest Featured payment for <b>${esc(firmName)}</b> did not go through. Stripe will try the card again. To update the card, open the billing page from your dashboard.</p>${button(link, 'Open my dashboard')}`,
  };
}
