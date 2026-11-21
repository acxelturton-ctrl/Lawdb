// A small browser worker for scripts/find-firm-lawyers.py --browser=1: reads one JSON request per line on stdin ({"id":1,"url":"https://..."}) and answers one JSON
// line per request on stdout ({"id":1,"ok":true,"url":"final address","html":"..."}), with the page drawn by a real browser so sites that build their team
// page with scripts can be read. It identifies itself like the other readers, runs at most 8 pages at once, and blocks fonts and media.
import { createRequire } from 'node:module';
import readline from 'node:readline';

const { chromium } = createRequire(import.meta.url)('playwright'); // the browser library is installed globally on the machines this runs on

const UA = 'LawDB-ProfileReader/1.0 (+https://lawdb.ca; info@lawdb.ca)';
const MAX = 8;
const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
// no fonts, media, ads, analytics, chat widgets, maps or video players: they slow the page and add nothing to a team page
const NOISE = /google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.(?:com|net)|connect\.facebook|youtube|ytimg|vimeo|clarity\.ms|hotjar|addtoany|sharethis|leadconnector|maps\.googleapis|gstatic\.com\/(?:recaptcha|maps)|recaptcha|tiktok|linkedin\.com\/(?:li|px)|licdn|hs-scripts|hsforms|hubspot|intercom|tawk|drift|crisp\.chat|livechat|calendly|stripe|paypal|twitter\.com|t\.co\/|x\.com|instagram|pinterest|snapchat|bing\.com|criteo|taboola|outbrain|trustpilot|birdeye|podium|elfsight|trustindex|cookiebot|onetrust|osano|usercentrics/i;
await ctx.route('**/*', (r) => (['media', 'font'].includes(r.request().resourceType()) || NOISE.test(r.request().url()) ? r.abort() : r.continue()));
let active = 0;
const queue = [];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

async function run({ id, url }) {
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = resp ? resp.status() : 0;
    if (status !== 200) { out({ id, ok: false, error: String(status) }); return; }
    try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch { /* some pages never go quiet */ }
    await page.evaluate(async () => {
      const h = Math.min(document.body.scrollHeight, 9000);
      for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 100)); }
      window.scrollTo(0, 0);
    });
    const html = (await page.content()).slice(0, 1_200_000);
    out({ id, ok: true, url: page.url(), html });
  } catch (e) {
    out({ id, ok: false, error: String(e.message || e).slice(0, 100) });
  } finally {
    await page.close().catch(() => {});
  }
}
function pump() {
  while (active < MAX && queue.length) { active++; run(queue.shift()).finally(() => { active--; pump(); }); }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { try { queue.push(JSON.parse(line)); pump(); } catch { /* ignore a bad line */ } });
rl.on('close', async () => { while (active || queue.length) await new Promise((r) => setTimeout(r, 200)); await browser.close(); process.exit(0); });
