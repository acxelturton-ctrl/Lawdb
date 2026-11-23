// Shared helpers for the firm research pipeline (scripts/research-ingest.mjs, research-verify.mjs, research-apply.mjs):
// the checks every new sentence of a profile has to pass, and a polite page fetcher used to confirm the facts against the pages they came from.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Names of independent third-party publications. They are real titles, not claims (the owner-text rules would otherwise reject "Best Lawyers"),
// so they are taken out before the rules run. Only these exact names are exempt.
export const PUBLICATION_NAMES = /\b(?:the\s+)?best\s+lawyers(?:\s+in\s+canada)?(?:\s*(?:™|\(TM\)))?|\bbest\s+law\s+firms(?:\s+in\s+canada)?|\bcanada(?:'|’)s\s+best\s+law\s+firms|\bbest\s+lawyers:\s+ones\s+to\s+watch(?:\s+in\s+canada)?/gi;
export const withoutPublicationNames = (text) => String(text).replace(PUBLICATION_NAMES, 'a ranking guide');

// Who may be named as having recognised a firm: independent editorial, peer-review and professional bodies. Paid badges and directories never count.
export const AWARD_ISSUER_OK = /best\s+lawyers|best\s+law\s+firms|lexpert|chambers|legal\s*500|canadian\s+lawyer|benchmark|globe\s+and\s+mail|law\s+society|barreau|bar\s+association|canadian\s+bar|trial\s+lawyers|university|faculty\s+of\s+law|chamber\s+of\s+commerce|chambre\s+de\s+commerce|doyle|iflr|who'?s\s+who\s+legal|national\s+post|financial\s+post|the\s+lawyer'?s\s+daily|law\s+times|canadian\s+legal\s+lexpert|ranking\s+guide|pro\s+bono\s+ontario/i;
export const AWARD_ISSUER_BAD = /quality\s+business|expertise\.com|top\s+choice|three\s+best|avvo|yelp|google|bbb|better\s+business|clio|super\s+lawyers|martindale|\blawyers\.com|justia|findlaw|nolo|trustanalytica|consumer\s+choice|best\s+of\s+the\s+best|business\s+award|top\s+rated|lawyerinfo|lawonline|lawzen|zoominfo|rocketreach/i;

const WORDS_BAD = /\b(?:best|top|leading|leader|premier|elite|expert|experts|expertise|specialist|specialists|specialise[sd]?|specialising|specialize[sd]?|specializing|award[- ]winning|trusted|proven|aggressive|aggressively|guarantee[sd]?|renowned|prestigious|exceptional|outstanding|unparalleled|unmatched|finest|foremost|highly\s+(?:rated|recommended|regarded)|reputable|top[- ]rated|number\s+one|#\s?1)\b/i;
const PHRASES_BAD = /\b(?:describes\s+itself|states\s+that|claims\s+(?:that|to)|free\s+consultations?|contingency|google|(?:client|customer|online|five[- ]star|\d+)\s+reviews?|star\s+rating|five[- ]star|linkedin|zoominfo|rocketreach|workforce|headcount|contact\s+us|call\s+us|reach\s+out|book\s+a|schedule\s+a|click|visit\s+(?:its|our|the)\s+website|we|our|us|your|you)\b/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const URLISH = /https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\.(?:com|ca|net|org|io|co|info|law|ly|me)\b/i;
const STREET = /\b\d{1,5}\s+(?:[A-Z][\w.'-]*\s+){0,3}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Way|Place|Suite|Unit)\b/;

// The problems with one sentence ([] when it is fine). `text` is a sentence or a whole paragraph.
export function lintText(text) {
  const t = withoutPublicationNames(text);
  const out = [];
  if (WORDS_BAD.test(t)) out.push(`word: ${(t.match(WORDS_BAD) || [])[0]}`);
  if (PHRASES_BAD.test(t)) out.push(`phrase: ${(t.match(PHRASES_BAD) || [])[0]}`);
  if (PHONE.test(t)) out.push('phone number');
  if (EMAIL.test(t)) out.push('email address');
  if (URLISH.test(t)) out.push('web address');
  if (STREET.test(t)) out.push('street address');
  if (/[<>{}\[\]]/.test(t)) out.push('markup');
  return out;
}

// Splits text into sentences without breaking after initials and abbreviations ("James H. Brown", "K.C.,", "Inc.", "E. coli").
const ABBR = /\b(?:[A-Z]|Dr|Mr|Ms|Mrs|Me|Mtre|Inc|Ltd|Co|Corp|St|Ste|Jr|Sr|vs|No|Hon|Prof)\.(?=\s)/g;
export const splitSentences = (text) => {
  const t = String(text).replace(/\s+/g, ' ').trim()
    .replace(/\b(?:[A-Za-z]{1,2}\.){2,}/g, (m) => m.replace(/\./g, '\u0001'))
    .replace(ABBR, (m) => m.slice(0, -1) + '\u0001');
  return t.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý"'“(])/).map((x) => x.replace(/\u0001/g, '.').trim()).filter(Boolean);
};

export const normText = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---- pages
const UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const DECODE = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;|&mdash;/g, '-').replace(/&[a-z]+;/g, ' ');
export const htmlToText = (html) => DECODE(html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const publicHost = (host) => !/^(?:localhost|.*\.local|.*\.internal)$/i.test(host) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && !host.includes(':') && host.includes('.');

// The text of a public web page (cached on disk so a run can be repeated), or '' when it cannot be read (not found, blocked, not text, too slow).
let browserPromise = null;
async function browserText(href) {
  try {
    if (!browserPromise) {
      const { createRequire } = await import('node:module');
      const { chromium } = createRequire('/opt/node-tools/')('playwright');
      const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
      browserPromise = chromium.launch(proxy ? { proxy: { server: proxy } } : {}).then(async (b) => ({ b, ctx: await b.newContext({ ignoreHTTPSErrors: true, userAgent: UA }) }));
    }
    const { ctx } = await browserPromise;
    const page = await ctx.newPage();
    try {
      await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(1500);
      return (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim().slice(0, 400_000);
    } finally { await page.close(); }
  } catch { return ''; }
}
export async function closeBrowser() { if (browserPromise) { const { b } = await browserPromise.catch(() => ({})); await b?.close().catch(() => {}); browserPromise = null; } }

export async function pageText(url, cacheDir) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol) || !publicHost(u.hostname)) return '';
  const key = createHash('sha1').update(u.href).digest('hex');
  const file = cacheDir && `${cacheDir}/${key}.txt`;
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  let text = '';
  try {
    const res = await fetch(u.href, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(12000) });
    if (res.ok && /html|text|xml/i.test(res.headers.get('content-type') || 'html')) text = htmlToText((await res.text()).slice(0, 900_000));
  } catch { /* unreadable */ }
  if (!text) text = await browserText(u.href); // a site that turns away plain requests is read the way a visitor's browser reads it
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, text); }
  return text;
}

export const urlsIn = (s) => [...new Set((String(s || '').match(/https?:\/\/[^\s|)"'<>]+/g) || []).map((u) => u.replace(/[.,;]+$/, '')))];
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
