export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BASE = { 'x-content-type-options': 'nosniff' };

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...BASE, ...headers },
  });

// Authenticated or personal data must never be stored by browsers or shared caches.
export const NO_STORE = { 'cache-control': 'no-store' };

export const cached = (body, seconds = 300) =>
  json(body, 200, { 'cache-control': `public, max-age=${seconds}, s-maxage=${seconds}` });

export const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

export async function readJson(request, maxChars = 20000) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const text = await request.text();
  if (text.length > maxChars) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

// Browsers always send Origin on cross-site POST/PATCH/DELETE. Reject any that is not us.
// (Requests with no Origin come from non-browser clients, which cannot ride a victim's cookies.)
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new HttpError(403, 'Forbidden');
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
