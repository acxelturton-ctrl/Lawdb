// The logo on a hand-built firm page is baked into the file, so a logo saved later in the admin or owner screens
// (stored as r2 "img/<id>" on the firm's record) never reached it. This is the picture the Worker puts in its place.
import { esc, safeUrl } from './firm-page.js';

// The inside of the page's <span class="li-logo">, or '' when the record has no logo to show.
export function staticLogoHtml(rec) {
  if (!rec || rec.type !== 'logo') return '';
  const src = safeUrl(rec.src);
  if (!src) return '';
  const href = src.startsWith('/') || src.startsWith('https:') ? src : `/${src}`; // absolute, so /firms/x and /firms/x/ both work
  return `<img src="${esc(href)}" alt="${esc(rec.name || 'Firm')} logo" width="96" height="96">`;
}
