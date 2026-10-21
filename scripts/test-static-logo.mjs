// A logo saved in the admin or owner screens must show on the firm's hand-built page. (The page rewrite itself is checked in smoke.mjs.)
import { staticLogoHtml } from '../src/render/logo.js';

let bad = 0;
const ok = (c, label) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };

ok(staticLogoHtml({ name: 'Preszler Injury Lawyers', type: 'logo', src: 'img/6c50c61b15e9d365556c3b24' }) === '<img src="/img/6c50c61b15e9d365556c3b24" alt="Preszler Injury Lawyers logo" width="96" height="96">', 'an uploaded logo becomes an image with an absolute address');
ok(staticLogoHtml({ name: 'Barbarian Law', type: 'logo', src: 'images/logos/barbarian-law.jpg' }) === '<img src="/images/logos/barbarian-law.jpg" alt="Barbarian Law logo" width="96" height="96">', 'a logo file in the repository is handled the same way');
ok(staticLogoHtml({ name: 'A', type: 'logo', src: 'https://example.ca/a.png' }).includes('src="https://example.ca/a.png"'), 'a full https address is kept as it is');
ok(['mono', undefined, '', 'cover'].every((type) => staticLogoHtml({ name: 'A', type, src: 'img/6c50c61b15e9d365556c3b24' }) === ''), 'a firm showing initials (or anything but a logo) keeps the page as it is');
ok([undefined, '', null, 7, 'javascript:alert(1)', 'img/x" onerror="alert(1)', 'data:image/png;base64,AAAA', 'http://example.ca/a.png', 'img/a b'].every((src) => staticLogoHtml({ name: 'A', type: 'logo', src }) === ''), 'a missing or unsafe address changes nothing');
ok(staticLogoHtml(null) === '' && staticLogoHtml({}) === '', 'an empty record changes nothing');
const nasty = staticLogoHtml({ name: '<img src=x onerror=alert(1)> "Q" & Co', type: 'logo', src: 'img/6c50c61b15e9d365556c3b24' });
ok(!/<img src=x/.test(nasty) && nasty.includes('&lt;img') && nasty.includes('&quot;Q&quot; &amp; Co'), 'the firm name is escaped in the picture text');

if (bad) { console.error(`${bad} check(s) failed`); process.exit(1); }
console.log('All checks passed');
