// A firm card for the "Firms to explore" strip on the home page. One template, used by scripts/build-home-firms.mjs (the cards saved in index.html)
// and by the Worker (the cards it picks each day, src/routes/home-firms.js), so the two always look the same.
import { PROVINCES } from './firm-page.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const phone = (p) => { const m = String(p || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(p || ''); };

// f: a firm record { slug, name, tags, rating, count, city, province, phone, src (logo), heroImage (cover) }
export function homeFirmCard(f) {
  const href = '/firms/' + esc(f.slug);
  const tel = f.phone ? '<a class="lc-call" href="tel:' + esc(f.phone) + '">Call now</a>' : '';
  return '<article class="lc">' +
    '<a class="lc-media" href="' + href + '" tabindex="-1" aria-hidden="true"><img src="' + esc(f.heroImage) + '" alt="" loading="lazy"><span class="lc-logo"><img src="' + esc(f.src) + '" alt="' + esc(f.name) + ' logo" loading="lazy"></span></a>' +
    '<div class="lc-body">' +
    '<span class="lc-cat">' + esc((f.tags || [])[0]) + '</span>' +
    '<h3><a href="' + href + '">' + esc(f.name) + '</a></h3>' +
    '<p class="lc-rate"><b>&#9733; ' + Number(f.rating).toFixed(1) + '</b> from ' + Number(f.count).toLocaleString('en-CA') + ' Google reviews</p>' +
    '<p class="lc-serves">' + esc(f.city) + ', ' + esc(PROVINCES[f.province] || f.province) + '</p>' +
    (f.phone ? '<p class="lc-phone">' + esc(phone(f.phone)) + '</p>' : '') +
    '<div class="lc-btns"><a class="lc-view" href="' + href + '">See profile</a>' + tel + '</div>' +
    '</div></article>';
}
