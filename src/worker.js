// LawDB Worker. Static pages are served by Cloudflare directly; only /api/* reaches this code.
//
// src/lib/      shared helpers (http, crypto, auth, email, audit, firm-edit)
// src/routes/   public.js (no login), auth.js (sign in/out), account.js (firm owners), admin.js (admins only)

import { json, HttpError, assertSameOrigin } from './lib/http.js';
import * as pub from './routes/public.js';
import * as auth from './routes/auth.js';
import * as admin from './routes/admin.js';
import * as account from './routes/account.js';
import * as stripe from './routes/stripe.js';
import * as dyn from './routes/dynamic.js';
import { firmPage } from './routes/firm-page.js';
import { reportPage } from './routes/report-page.js';
import { serveImage } from './routes/images.js';
import { newsPage } from './routes/news-page.js';
import { nightly } from './lib/backup.js';
import { searchNightly } from './lib/gsc.js';
import { legacyRedirect } from './lib/redirects.js';
import { storyPage, storySitemap } from './routes/story-page.js';
import * as social from './routes/social.js';

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

  route('POST', '/api/stripe/webhook', stripe.webhook),

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
  route('GET', '/api/admin/payments', admin.paymentsList),
  route('POST', '/api/admin/payments/:id/assign', admin.paymentsAssign),
  route('POST', '/api/admin/payments/:id/dismiss', admin.paymentsDismiss),
  route('GET', '/api/admin/search', admin.searchGet),
  route('POST', '/api/admin/search/run', admin.searchRun),
  route('POST', '/api/admin/search/inspect', admin.searchInspect),
  route('GET', '/api/admin/news', admin.newsGet),
  route('PATCH', '/api/admin/news', admin.newsSettings),
  route('GET', '/api/admin/firms/:slug/feed', admin.feedGet),
  route('PATCH', '/api/admin/firms/:slug/feed', admin.feedUpdate),
  route('POST', '/api/admin/firms/:slug/feed/refresh', admin.feedRefresh),
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
  route('GET', '/api/account/firms/:slug/plan', account.planGet),
  route('GET', '/api/account/firms/:slug/feed', account.feedGet),
  route('PATCH', '/api/account/firms/:slug/feed', account.feedUpdate),
  route('POST', '/api/account/firms/:slug/feed/refresh', account.feedRefresh),
  route('GET', '/api/account/firms/:slug/images', account.imagesList),
  route('POST', '/api/account/firms/:slug/images', account.imagesAdd),
  route('DELETE', '/api/account/firms/:slug/images/:id', account.imagesRemove),
  route('PATCH', '/api/account/leads/:id', account.updateLead),
  route('PATCH', '/api/account/profile', account.updateProfile),
  route('GET', '/api/auth/providers', auth.providers),
  route('GET', '/api/auth/google/start', auth.oauthStart('google')),
  route('GET', '/api/auth/google/callback', auth.oauthCallback('google')),
  route('GET', '/api/auth/linkedin/start', auth.oauthStart('linkedin')),
  route('GET', '/api/auth/linkedin/callback', auth.oauthCallback('linkedin')),
  route('GET', '/api/social/status', social.status),
  route('POST', '/api/account/follow', social.follow),
  route('DELETE', '/api/account/follow/:slug', social.unfollow),
  route('GET', '/api/account/following', social.following),
  route('GET', '/api/account/feed', social.feed),
  route('GET', '/api/account/saved', social.savedList),
  route('POST', '/api/account/saved', social.save),
  route('DELETE', '/api/account/saved/:id', social.unsave),
];

export default {
  // Cloudflare cron triggers: 07:17 UTC housekeeping, blogs and backup; 07:37 UTC Google Search Console (sitemap and page checks).
  // They are separate runs so each stays within the platform's limit on outgoing requests.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '37 7 * * *' ? searchNightly(env).catch((err) => console.error('search console run failed', err)) : nightly(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (!path.startsWith('/api/')) {
        // Only GET/HEAD reach here for site content; everything else is passed to the static files.
        if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);
        const moved = legacyRedirect(url); // old addresses go to the clean one, permanently
        if (moved) return moved;
        const handler = DATA_FILES[path] || (path === '/report-listing' ? reportPage : path === '/news' ? newsPage : path === '/sitemap-news.xml' ? storySitemap : path.startsWith('/news/') ? storyPage : path.startsWith('/img/') ? serveImage : path.startsWith('/firms/') ? firmPage : dyn.page);
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
