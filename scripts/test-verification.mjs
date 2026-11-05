// Verified by LawDB: the law society list, what a firm may send, what the public sees (and never sees), and the page.
//   node scripts/test-verification.mjs
import { readFileSync } from 'node:fs';
import { LAW_SOCIETIES, VERIFICATION_REQUIRES_FEATURED, cleanRequest, publicView, fullView } from '../src/lib/verification.js';
import { renderFirmPage, PROVINCES } from '../src/render/firm-page.js';

let bad = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) bad++; };
const refused = (fn) => { try { fn(); return false; } catch (e) { return e && e.status === 422; } };

// the law societies
ok(Object.keys(PROVINCES).every((p) => Object.hasOwn(LAW_SOCIETIES, p)) && Object.keys(LAW_SOCIETIES).every((p) => Object.hasOwn(PROVINCES, p)), 'there is a law society for every province the directory covers, and no other');
const HOST = { ON: 'lso.ca', QC: 'barreau.qc.ca', BC: 'lawsociety.bc.ca', AB: 'lawsociety.ab.ca', MB: 'lawsociety.mb.ca' };
ok(Object.entries(LAW_SOCIETIES).every(([code, s]) => { const u = new URL(s.directory); return u.protocol === 'https:' && (u.hostname === HOST[code] || u.hostname.endsWith('.' + HOST[code])) && s.name.length > 5; }), "each directory link is https and on the law society's own website");
ok(VERIFICATION_REQUIRES_FEATURED === false, 'verification is free for every firm');

// what a firm sends
const good = cleanRequest({ registrant: '  Marie   Achkar ', registrationRef: ' P12345 ' }, 'on');
ok(good.lawSociety === 'ON' && good.registrant === 'Marie Achkar' && good.registrationRef === 'P12345', 'the law society defaults to the firm\'s province, spaces are tidied');
ok(cleanRequest({ registrant: 'Élodie Côté-Tremblay' }, 'QC').registrant === 'Élodie Côté-Tremblay' && cleanRequest({ registrant: "Pat O'Neil Jr." }, 'BC').registrationRef === null, 'accents, hyphens and apostrophes are fine; the number is optional');
ok(refused(() => cleanRequest({ registrant: 'Pat Smith', lawSociety: 'XX' }, 'ON')) && refused(() => cleanRequest({ registrant: 'Pat Smith', lawSociety: 'constructor' }, 'ON')) && refused(() => cleanRequest({ registrant: 'Pat Smith' }, 'NB')), 'an unknown law society is refused');
ok(refused(() => cleanRequest({ registrant: '' }, 'ON')) && refused(() => cleanRequest({ registrant: '<b>Pat</b>' }, 'ON')) && refused(() => cleanRequest({ registrant: 'A' }, 'ON')) && refused(() => cleanRequest({ registrant: 'x'.repeat(81) }, 'ON')) && refused(() => cleanRequest({}, 'ON')), 'a missing, too short, too long or marked-up name is refused');
ok(refused(() => cleanRequest({ registrant: 'Pat Smith', registrationRef: 'a;b' }, 'ON')) && refused(() => cleanRequest({ registrant: 'Pat Smith', registrationRef: '1'.repeat(31) }, 'ON')), 'a number with odd characters or too long is refused');

// what the public sees
const row = { firm_slug: 'x', status: 'verified', law_society: 'ON', registrant_name: 'Marie Achkar', registration_ref: 'P12345', checked_identity: 1, checked_registration: 1, checked_office: 0, verified_at: '2026-11-05 14:00:00', note: 'phoned the office' };
const pub = publicView(row);
ok(pub && pub.at === '2026-11-05' && pub.society.code === 'ON' && pub.checked.registration === true && pub.checked.office === false, 'the public view has the date, the law society and what was checked');
ok(!JSON.stringify(pub).includes('Achkar') && !JSON.stringify(pub).includes('P12345') && !JSON.stringify(pub).includes('phoned'), "the public view never has the name, the number or the admin's note");
ok(publicView(null) === null && publicView({ ...row, status: 'requested' }) === null, 'a firm that only asked shows nothing');
const full = fullView(row, 'ON');
ok(full.registrant === 'Marie Achkar' && full.registrationRef === 'P12345' && full.note === 'phoned the office' && full.societies.length === 5, 'the owner and the admin see everything, with the list of law societies');
ok(fullView(null, 'BC').status === 'none' && fullView(null, 'BC').lawSociety.code === 'BC' && fullView(null, 'ZZ').lawSociety.code === 'ON', 'no record means status none, with the firm\'s province as the default society');

// the page
const firm = { name: 'Achkar Law', slug: 'achkar-law', city: 'Ottawa', province: 'ON', address: '1 Main St, Ottawa, ON', phone: '+16135550100', tags: ['Family Law'], caseTypes: ['family'], about: 'We act for families in Ottawa.' };
const html = renderFirmPage({ firm, verified: pub });
ok(html.includes('class="pf-chip is-verified"') && html.includes('<a href="#verified">Verified by LawDB</a>') && html.includes('id="verified"'), 'a verified page has the chip and the box');
ok(html.includes('Checked in November 2026') && html.includes('The person who manages this profile is who they say they are') && html.includes('public directory') && !html.includes('The office address and phone number match'), 'the box says when and lists only what was checked');
ok(html.includes(LAW_SOCIETIES.ON.directory) && html.includes('rel="noopener nofollow"') && html.includes('It is not an endorsement'), 'the box links to the law society\'s directory and says it is not an endorsement');
ok(!html.includes('Marie Achkar') && !html.includes('P12345'), 'the page never has the name or number the firm gave');
const plain = renderFirmPage({ firm });
ok(!plain.includes('is-verified') && !plain.includes('id="verified"') && !plain.includes('Verified by LawDB') && !plain.includes('.verified{'), 'a firm that is not verified has none of it on its page (no markup, no styles)');

// the wiring
const worker = readFileSync('src/worker.js', 'utf8');
ok(['GET', 'PUT', 'DELETE'].every((m) => worker.includes(`route('${m}', '/api/admin/firms/:slug/verification'`)) && ['GET', 'POST'].every((m) => worker.includes(`route('${m}', '/api/account/firms/:slug/verification'`)), 'the owner and admin routes are registered');
ok(/Verification \(law firms only\)/.test(readFileSync('privacy-policy.html', 'utf8')), 'the privacy policy says what we keep when a firm asks to be verified');
ok(/verificationPanel/.test(readFileSync('admin/profile-editor.js', 'utf8')) && /api\('PUT', url/.test(readFileSync('admin/verification-panel.js', 'utf8')), 'the editor has the verification panel');
ok(/firm_verifications: 'SELECT \* FROM firm_verifications/.test(readFileSync('src/lib/backup.js', 'utf8')), 'verifications are part of the nightly backup (losing them would remove every badge)');
ok(/Get verified by LawDB/.test(readFileSync('for-firms.html', 'utf8')) && /Get verified by LawDB/.test(readFileSync('list-your-firm.html', 'utf8')), 'the Free or Featured table lists verification as free');

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nverification checks passed');
