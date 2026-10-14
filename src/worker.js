// LawDB Worker. Static pages are served by Cloudflare directly; only /api/* reaches this code.
//
// src/lib/      shared helpers (http, crypto, auth, email, audit, firm-edit)
// src/routes/   public.js (no login), auth.js (sign in/out), account.js (firm owners), admin.js (admins only)

import { json, HttpError, assertSameOrigin } from './lib/http.js';
import * as pub from './routes/public.js';
import * as auth from './routes/auth.js';
import * as admin from './routes/admin.js';
import * as account from './routes/account.js';
import * as dyn from './routes/dynamic.js';
import { firmPage } from './routes/firm-page.js';
import { reportPage } from './routes/report-page.js';
import { serveImage } from './routes/images.js';
import { nightly } from './lib/backup.js';

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
  // Answers 503 when the database cannot be read, so an uptime monitor pointed here sees real outages.
  route('GET', '/api/health', async ({ env }) => {
    try {
      await env.DB.prepare('SELECT 1').first();
      return json({ ok: true, db: true, time: new Date().toISOString() }, 200, { 'cache-control': 'no-store' });
    } catch (err) {
      console.error('health check: database unreachable', err);
      return json({ ok: false, db: false }, 503, { 'cache-control': 'no-store' });
    }
  }),

  route('GET', '/api/firms', pub.listFirms),
  route('GET', '/api/firms/:slug', pub.getFirm),
  route('GET', '/api/blog', pub.listBlog),
  route('POST', '/api/leads', pub.createLead),

  route('POST', '/api/auth/request-link', auth.requestLink),
  route('POST', '/api/auth/verify', auth.verify),
  route('POST', '/api/auth/logout', auth.logout),
  route('POST', '/api/auth/logout-all', auth.logoutAll),
  route('GET', '/api/auth/me', auth.me),

  route('GET', '/api/admin/stats', admin.stats),
  route('GET', '/api/admin/leads', admin.listLeads),
  route('PATCH', '/api/admin/leads/:id', admin.updateLead),
  route('GET', '/api/admin/firms', admin.listFirms),
  route('GET', '/api/admin/firms/:slug', admin.getFirm),
  route('POST', '/api/admin/firms', admin.createFirm),
  route('PATCH', '/api/admin/firms/:slug', admin.updateFirm),
  route('GET', '/api/admin/members', admin.listMembers),
  route('PATCH', '/api/admin/members/:id', admin.decideMember),
  route('GET', '/api/admin/audit', admin.listAudit),
  route('POST', '/api/admin/audit/:id/revert', admin.revertEdit),
  route('GET', '/api/admin/firms/:slug/images', admin.imagesList),
  route('POST', '/api/admin/firms/:slug/images', admin.imagesAdd),
  route('DELETE', '/api/admin/firms/:slug/images/:id', admin.imagesRemove),
  route('GET', '/api/admin/users', admin.listUsers),
  route('PATCH', '/api/admin/users/:id', admin.setUserDisabled),
  route('POST', '/api/admin/backup', admin.backupNow),

  route('GET', '/api/account/me', account.me),
  route('GET', '/api/account/search', account.search),
  route('POST', '/api/account/claims', account.claim),
  route('POST', '/api/account/firms', account.createListing),
  route('GET', '/api/account/firms/:slug', account.getFirm),
  route('PATCH', '/api/account/firms/:slug', account.updateFirm),
  route('GET', '/api/account/firms/:slug/leads', account.listLeads),
  route('GET', '/api/account/firms/:slug/images', account.imagesList),
  route('POST', '/api/account/firms/:slug/images', account.imagesAdd),
  route('DELETE', '/api/account/firms/:slug/images/:id', account.imagesRemove),
  route('PATCH', '/api/account/leads/:id', account.updateLead),
];

export default {
  // Cloudflare cron trigger (nightly): housekeeping and backup.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (!path.startsWith('/api/')) {
        // Only GET/HEAD reach here for site content; everything else is passed to the static files.
        if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
        const handler = DATA_FILES[path] || (path === '/report-listing' ? reportPage : path.startsWith('/img/') ? serveImage : path.startsWith('/firms/') ? firmPage : dyn.page);
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
