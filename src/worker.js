// LawDB Worker. Static pages are served by Cloudflare directly; only /api/* reaches this code.
//
// src/lib/      shared helpers (http, crypto, auth, email, audit)
// src/routes/   public.js (no login), auth.js (sign in/out), admin.js (admins only)

import { json, HttpError, assertSameOrigin } from './lib/http.js';
import * as pub from './routes/public.js';
import * as auth from './routes/auth.js';
import * as admin from './routes/admin.js';
import * as dyn from './routes/dynamic.js';

const route = (method, pattern, handler) => ({
  method,
  handler,
  regex: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
});

// Static files that are now served from the database (the static copies are the fallback).
const DATA_FILES = {
  '/firms_data.json': dyn.firmsJson,
  '/blog_data.json': dyn.blogJson,
  '/firms_hours.json': dyn.hoursJson,
};

const ROUTES = [
  route('GET', '/api/health', () => json({ ok: true, time: new Date().toISOString() })),

  route('GET', '/api/firms', pub.listFirms),
  route('GET', '/api/firms/:slug', pub.getFirm),
  route('GET', '/api/blog', pub.listBlog),
  route('POST', '/api/leads', pub.createLead),

  route('POST', '/api/auth/request-link', auth.requestLink),
  route('POST', '/api/auth/verify', auth.verify),
  route('POST', '/api/auth/logout', auth.logout),
  route('GET', '/api/auth/me', auth.me),

  route('GET', '/api/admin/stats', admin.stats),
  route('GET', '/api/admin/leads', admin.listLeads),
  route('PATCH', '/api/admin/leads/:id', admin.updateLead),
  route('GET', '/api/admin/firms', admin.listFirms),
  route('GET', '/api/admin/firms/:slug', admin.getFirm),
  route('PATCH', '/api/admin/firms/:slug', admin.updateFirm),
  route('GET', '/api/admin/audit', admin.listAudit),
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (!path.startsWith('/api/')) {
        // Only GET/HEAD reach here for site content; everything else is passed to the static files.
        if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
        const handler = DATA_FILES[path] || dyn.page;
        return await handler({ request, env, ctx });
      }
      const method = request.method === 'HEAD' ? 'GET' : request.method;
      if (method !== 'GET') assertSameOrigin(request);

      let pathMatched = false;
      for (const r of ROUTES) {
        const m = path.match(r.regex);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        return await r.handler({ request, env, url, params: m.groups || {}, exec: (p) => ctx.waitUntil(p) });
      }
      throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('API error', err);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
