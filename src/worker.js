// LawDB API. Static pages are served by Cloudflare directly; only /api/* reaches this Worker.
//
//   GET  /api/health
//   GET  /api/firms?province=ON&city=Toronto&q=smith&featured=1&limit=50&offset=0
//   GET  /api/firms/:slug          (includes opening hours)
//   GET  /api/blog?province=ON
//   POST /api/leads                (JSON or form-encoded; stored in D1)

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });

const cached = (body, seconds = 300) =>
  json(body, 200, { 'cache-control': `public, max-age=${seconds}, s-maxage=${seconds}` });

const clampInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

async function listFirms(url, env) {
  const p = url.searchParams;
  const where = [];
  const args = [];
  if (p.get('province')) { where.push('province = ?'); args.push(p.get('province').toUpperCase()); }
  if (p.get('city')) { where.push('city = ? COLLATE NOCASE'); args.push(p.get('city')); }
  if (p.get('region')) { where.push('region = ?'); args.push(p.get('region')); }
  if (p.get('featured') === '1') where.push('featured = 1');
  if (p.get('q')) {
    where.push("(name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')");
    const like = `%${p.get('q').replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const limit = clampInt(p.get('limit'), 500, 1, 500);
  const offset = clampInt(p.get('offset'), 0, 0, 100000);
  const sql =
    `SELECT data FROM firms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ` +
    `ORDER BY featured DESC, rating DESC, review_count DESC, name LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...args, limit, offset).all();
  return cached(results.map((r) => JSON.parse(r.data)));
}

async function getFirm(slug, env) {
  const row = await env.DB.prepare('SELECT data, hours FROM firms WHERE slug = ?').bind(slug).first();
  if (!row) return json({ error: 'Firm not found' }, 404);
  return cached({ ...JSON.parse(row.data), hours: row.hours ? JSON.parse(row.hours) : null });
}

async function listBlog(url, env) {
  const province = url.searchParams.get('province');
  const stmt = province
    ? env.DB.prepare('SELECT data FROM blog_posts WHERE province = ? ORDER BY sort_order').bind(province.toUpperCase())
    : env.DB.prepare('SELECT data FROM blog_posts ORDER BY sort_order');
  const { results } = await stmt.all();
  return cached(results.map((r) => JSON.parse(r.data)));
}

const LIMITS = { name: 200, email: 254, phone: 50, message: 5000, page: 300, field: 2000, fields: 40 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function createLead(request, env) {
  // Same-origin only: blocks other websites from posting to this endpoint from a browser.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Forbidden' }, 403);

  let input;
  try {
    const type = request.headers.get('content-type') || '';
    if (type.includes('application/json')) input = await request.json();
    else input = Object.fromEntries((await request.formData()).entries());
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid request body' }, 400);

  // Honeypot: real people never fill the hidden "botcheck" field. Pretend success to bots.
  if (input.botcheck) return json({ ok: true });

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = str(input.name, LIMITS.name);
  const email = str(input.email, LIMITS.email);
  const phone = str(input.phone, LIMITS.phone);
  const message = str(input.message, LIMITS.message);
  const form = str(input.form, 50) || 'contact';
  const page = str(input.page, LIMITS.page) || request.headers.get('referer') || '';

  if (!name) return json({ error: 'Name is required' }, 422);
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 422);

  // Everything else submitted is kept (capped) so no form field is ever lost.
  const extra = {};
  for (const [k, v] of Object.entries(input).slice(0, LIMITS.fields)) {
    if (['access_key', 'botcheck', 'name', 'email', 'phone', 'message', 'form', 'page'].includes(k)) continue;
    if (typeof v === 'string') extra[k.slice(0, 60)] = v.slice(0, LIMITS.field);
  }

  // Basic throttle: max 5 submissions per email per 10 minutes.
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM leads WHERE email = ? AND created_at > datetime('now','-10 minutes')"
  ).bind(email).first();
  if (recent && recent.n >= 5) return json({ error: 'Too many submissions, please try again later' }, 429);

  await env.DB.prepare(
    'INSERT INTO leads (form,name,email,phone,message,payload,page) VALUES (?,?,?,?,?,?,?)'
  ).bind(form, name, email, phone || null, message || null, JSON.stringify(extra), page || null).run();

  return json({ ok: true }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      if (path === '/api/health') return json({ ok: true, time: new Date().toISOString() });

      if (request.method === 'GET') {
        if (path === '/api/firms') return await listFirms(url, env);
        const m = path.match(/^\/api\/firms\/([a-z0-9-]+)$/);
        if (m) return await getFirm(m[1], env);
        if (path === '/api/blog') return await listBlog(url, env);
      }
      if (request.method === 'POST' && path === '/api/leads') return await createLead(request, env);

      if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    } catch (err) {
      console.error('API error', err);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
