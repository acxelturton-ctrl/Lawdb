// The "Book a call" button on a firm's page, under the Call / Website / Directions buttons. Booking is a Featured benefit: a Featured firm that has given an
// online booking link gets an active, light-gold button that opens it; every other firm gets the same button greyed out with a padlock and a "Featured" tag, and
// tapping it explains how the firm can unlock it. (A link a firm has saved stays saved: it goes live again the moment the firm is Featured.)
// Like the Profiles box, the snippet carries its own style so it looks the same on database pages and on the hand-built pages the Worker adds it to.
import { cleanBookingUrl } from '../lib/booking.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const CAL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M9 14.5l2 2 4-4"/></svg>';
const LOCK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

const CSS = '<style>.li-book-row{margin:10px 0 0;max-width:470px}' +
  '.li-book-row .li-btn{width:100%;flex:none;gap:8px;cursor:pointer;font-family:inherit}' +
  '.li-book-row .ic{width:19px;height:19px;flex:none}' +
  '.li-book{background:#f4ecd8;border:1.5px solid #c9a050;color:#2b3a4c}' +
  '.li-book .ic{color:#e2bd6a}' +
  '.li-book-off .ic{color:#8a919b}' +
  '.li-book:hover{background:#e6d4a4;color:#2b3a4c}' +
  '.li-book-off{background:#edeae1;border:1.5px dashed #e3dfd3;color:#8a919b}' +
  '.li-book-off:hover{background:#edeae1;color:#586170;transform:none;box-shadow:none;filter:none}' +
  '.li-book-tag{margin-left:2px;padding:1px 8px;border-radius:999px;background:#f4ecd8;border:1px solid #c9a050;color:#2b3a4c;font:700 11px/1.5 Inter,system-ui,sans-serif;font-style:normal;letter-spacing:.02em}' +
  '.lw-book-note{margin:8px 0 0;max-width:470px;font:500 13.5px/1.5 Inter,system-ui,sans-serif;color:#586170}' +
  '</style>';

// The button row for one firm. `url` is whatever is stored; it only counts when the firm is `featured` and the link is valid.
export function bookingRow({ url, name, managed = false, featured = false }) {
  const good = cleanBookingUrl(url || '');
  if (featured && good) {
    return `${CSS}<div class="li-book-row"><a class="li-btn li-book" href="${esc(good)}" target="_blank" rel="noopener nofollow" title="Opens ${esc(name)}'s own booking page">${CAL}<span>Book a call</span></a></div>`;
  }
  // The page already has its own "Claim this listing" line right under the buttons, so the note points to it instead of repeating the link.
  const note = !featured
    ? (managed
      ? `Online booking is a Featured feature. The owner of ${esc(name)} can unlock it from the dashboard (the first month is free).`
      : `Online booking is a Featured feature. If you run ${esc(name)}, use &ldquo;Claim this listing&rdquo; below to start a free month and add your booking link.`)
    : (managed
      ? `${esc(name)} hasn&#x27;t added an online booking link yet.`
      : `${esc(name)} hasn&#x27;t added an online booking link yet. If you run this firm, use &ldquo;Claim this listing&rdquo; below to add one.`);
  return `${CSS}<div class="li-book-row"><button type="button" class="li-btn li-book li-book-off" aria-disabled="true" aria-expanded="false" aria-controls="lw-book-note">${LOCK}<span>Book a call</span>${featured ? '' : '<em class="li-book-tag">Featured</em>'}</button>` +
    `<p class="lw-book-note" id="lw-book-note" hidden>${note}</p></div>`;
}
