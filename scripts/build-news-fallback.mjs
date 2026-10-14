// Writes news.html: the static copy of the LawDB News page (no posts). The live page is built from the database by the Worker;
// this file is what visitors get if the database is ever unavailable. `--check` fails if it is out of date (it follows the header/footer
// chunks, which follow the hand-built firm pages).
import { readFileSync, writeFileSync } from 'node:fs';
import { renderNewsPage } from '../src/render/news-page.js';

const target = new URL('../news.html', import.meta.url);
const html = renderNewsPage({ posts: [], firms: [], selected: '' });
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== html) { console.error('news.html is out of date: run  node scripts/build-news-fallback.mjs'); process.exit(1); }
  console.log('news.html is up to date');
} else {
  writeFileSync(target, html);
  console.log('wrote news.html (' + html.length + ' bytes)');
}
