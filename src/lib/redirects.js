// One address per page. Old addresses (".html", the old /services/... pages, the old /legal-news pages) are sent to the
// new clean address with a permanent (301) redirect, so search engines move the page and its history over.
const SERVICES = { business: 'business-lawyers', criminal: 'criminal-defence-lawyers', employment: 'employment-lawyers', family: 'family-lawyers', immigration: 'immigration-lawyers', injury: 'personal-injury-lawyers', litigation: 'litigation-lawyers', realestate: 'real-estate-lawyers', traffic: 'traffic-ticket-lawyers', wills: 'wills-estate-lawyers' };
const PROVINCE = { '': 'ontario', 'bc-': 'british-columbia', 'qc-': 'quebec' };

// Returns the clean path for an old path, or null when the path is already right (or is not ours to move).
export function cleanPath(pathname) {
  if (/^\/(api|admin|account|img)\//.test(pathname)) return null;
  let p = pathname;
  if (p.endsWith('.html')) p = p.slice(0, -5);
  if (p.endsWith('/index')) p = p.slice(0, -5) || '/';
  if (p === '/index') p = '/';
  const svc = /^\/services\/(bc-|qc-)?([a-z]+)$/.exec(p);
  if (svc && SERVICES[svc[2]]) p = `/${PROVINCE[svc[1] || '']}/${SERVICES[svc[2]]}`;
  else if (p === '/legal-news') p = '/news';
  return p === pathname ? null : p;
}

// Full redirect response for a request URL, or null.
export function legacyRedirect(url) {
  const to = cleanPath(url.pathname);
  return to ? Response.redirect(url.origin + to + url.search, 301) : null;
}
