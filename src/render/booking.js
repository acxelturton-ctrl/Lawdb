// The "Book a call" button on a firm's page, under the Call / Website / Directions buttons. A firm that has given an online booking link gets an
// active, light-gold button that opens it; every other firm gets the same button greyed out, and tapping it explains how the firm can add one.
// Like the Profiles box, the snippet carries its own style so it looks the same on database pages and on the hand-built pages the Worker adds it to.
import { cleanBookingUrl } from '../lib/booking.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const CAL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M9 14.5l2 2 4-4"/></svg>';
const LOCK = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

const CSS = '<style>.li-book-row{margin:10px 0 0;max-width:470px}' +
  '.li-book-row .li-btn{width:100%;flex:none;gap:8px;cursor:pointer;font-family:inherit}' +
  '.li-book-row .ic{width:19px;height:19px;flex:none}' +
  '.li-book{background:#fdf3d6;border:1.5px solid #e6c36a;color:#6b4300}' +
  '.li-book .ic{color:#b7791f}' +
  '.li-book-off .ic{color:#9aa0a8}' +
  '.li-book:hover{background:#fbe9b5;color:#5a3700}' +
  '.li-book-off{background:#f3f1ec;border:1.5px dashed #cdc8bc;color:#8a8f98}' +
  '.li-book-off:hover{background:#eeebe4;color:#6b7078;transform:none;box-shadow:none;filter:none}' +
  '.lw-book-note{margin:8px 0 0;max-width:470px;font:500 13.5px/1.5 Inter,system-ui,sans-serif;color:#636870}' +
  '.lw-book-note a{color:#b45309;font-weight:600;text-decoration:underline;text-underline-offset:2px}.lw-book-note a:hover{color:#1f2328}</style>';

// The button row for one firm. `url` is whatever is stored; only a valid one makes the button active.
export function bookingRow({ url, slug, name }) {
  const good = cleanBookingUrl(url || '');
  if (good) {
    return `${CSS}<div class="li-book-row"><a class="li-btn li-book" href="${esc(good)}" target="_blank" rel="noopener nofollow" title="Opens ${esc(name)}'s own booking page">${CAL}<span>Book a call</span></a></div>`;
  }
  const claim = `/account/#find/${esc(String(slug).replace(/[^a-z0-9-]/g, ''))}`;
  return `${CSS}<div class="li-book-row"><button type="button" class="li-btn li-book li-book-off" aria-disabled="true" aria-expanded="false" aria-controls="lw-book-note">${LOCK}<span>Book a call</span></button>` +
    `<p class="lw-book-note" id="lw-book-note" hidden>${esc(name)} hasn&#x27;t added an online booking link yet. <a href="${claim}" data-claim="${esc(String(slug).replace(/[^a-z0-9-]/g, ''))}">Own this firm? Claim your listing to add one.</a></p></div>`;
}
