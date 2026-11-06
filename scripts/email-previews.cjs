// Takes a picture of the top of each firm's page (its card, with the "Claim this listing" link) for the claim-your-listing invitation email.
//   node scripts/email-previews.cjs slugs.txt          one firm address per line; writes email-previews/<slug>.jpg from the live site
//   node scripts/email-previews.cjs slugs.txt http://127.0.0.1:8799     from a local copy instead
// Playwright is already installed in the build image; nothing here changes the site, it only reads pages and writes files.
const { chromium } = require('playwright');
const fs = require('fs');
const slugs = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
const BASE = (process.argv[3] || 'https://lawdb.ca').replace(/\/+$/, '');
const OUT = 'email-previews';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  let next = 0; const failed = [];
  await Promise.all(Array.from({ length: 5 }, async () => {
    const p = await (await b.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1 })).newPage();
    while (next < slugs.length) {
      const slug = slugs[next++];
      try {
        await p.goto(`${BASE}/firms/${slug}`, { waitUntil: 'load', timeout: 40000 });
        const card = p.locator('section.li-card').first();
        await card.waitFor({ timeout: 15000 });
        await p.waitForTimeout(900);
        const box = await card.boundingBox();
        await p.screenshot({ path: `${OUT}/${slug}.jpg`, type: 'jpeg', quality: 72, fullPage: true, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 560) } });
      } catch (e) { failed.push(slug); }
    }
  }));
  await b.close();
  console.log(`${slugs.length - failed.length} pictures written to ${OUT}/` + (failed.length ? `; failed: ${failed.join(', ')}` : ''));
})();
