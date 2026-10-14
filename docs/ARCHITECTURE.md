# LawDB architecture and decisions

## Shape

```
visitor / admin / (soon) firm owner
        |
   Cloudflare edge  --  static pages (HTML/CSS/JS/images), served directly, free
        |
   Worker (/api/*)  --  src/worker.js router -> src/routes/{public,auth,admin}.js
        |
   D1 (SQLite)      --  firms, blog_posts, leads, users, sessions, login_tokens, audit_log
        |
   Brevo            --  transactional email (sign-in links), sender info@lawdb.ca
```

## Decisions

| Decision | Why |
|---|---|
| Cloudflare Workers + D1, no servers | Scales globally and to zero, no ops, cost grows with usage. Fits the existing deploy. |
| Static pages stay static; only `/api/*` runs code | Fast and cheap for SEO pages; the database is only hit when needed. |
| One user table with roles (`admin`, `member`) | The same login will serve firm owners later. No second auth system. |
| Passwordless email links, no passwords | Nothing to leak or reset. Tokens are 256-bit random, stored only as SHA-256 hashes, single use, 15 min. |
| Link opens a page; a button POSTs the token | Email scanners that pre-fetch links cannot burn the one-time token. Token is in the URL `#fragment`, never sent to servers or logs. |
| Sessions in D1, HttpOnly + SameSite=Lax + `__Host-` cookie, 14 days | Revocable server-side (logout deletes the row); cookie unreadable by scripts. |
| Only known users or `ADMIN_EMAILS` can receive a link; always answer `ok` | No account enumeration, and strangers cannot make us email arbitrary addresses. |
| Same-origin check on every non-GET API call | CSRF protection on top of SameSite. |
| `data` JSON is the source of truth for a firm; indexed columns are derived | The API returns the exact shape the website already uses. |
| Whitelisted editable fields with validation | Admin edits cannot corrupt ratings, slugs or coordinates. |
| Append-only `audit_log` for every admin write | Accountability, and a base for firm-owner activity later. |
| Admin UI is plain JS with a strict CSP (no inline script, no third-party) | No build step to maintain; visitor text is only ever inserted as text, never HTML. |
| Migrations in `migrations/`, applied automatically on deploy | Schema changes are reviewed in PRs and cannot drift between environments. |
| CI runs migrations, seed and an end-to-end smoke test | Auth and security rules are regression-tested on every change. |

## How public pages read the database

The site was built with the firm list baked into the pages. Rather than rewrite 65 pages, the Worker swaps the
live list in on the way out (`src/routes/dynamic.js`):

- `/firms_data.json`, `/blog_data.json`, `/firms_hours.json` are served from D1 (used by search suggestions,
  the map's opening hours and the blog lists).
- `/find-lawyers`, the province hubs (`/alberta/`, `/manitoba/`) and every city hub (`/<province>/<city>/`) carry the
  whole firm list in an inline `<script>`. The Worker replaces that one line with the database's list.
- Responses are cached at the edge for 60 seconds (`PUBLIC_CACHE_TTL`, seconds; 0 disables), so a busy site reads the
  database about once a minute per location, not once per visitor.
- **Safety net:** if the database cannot be read, or a page does not contain exactly one inline list, the original
  static file is served unchanged. The pre-built JSON files and pages stay in the repo as that fallback and as the seed.
- `run_worker_first` in `wrangler.jsonc` lists the paths that reach the Worker; everything else is served as free static files.
- CI proves the database output equals the static files byte-for-byte (as data), preserves order, and that an admin edit
  appears on the public pages.

## Firm profile pages (`/firms/<slug>`)

Each firm has a `page_mode` column:

- `static` (default for all 370 original firms): the hand-built HTML page is served unchanged, so nothing looks different
  until a firm is switched.
- `dynamic` (default for firms created in the admin area): the Worker renders the page from the database
  (`src/routes/firm-page.js` + `src/render/firm-page.js`). The page skeleton (header, cover, services, hours card, guide,
  carousel, lead form, footer) is extracted verbatim from the existing pages by `scripts/extract-firm-template.mjs` into
  `src/render/firm-chunks.generated.js`; `npm run check` fails if that file drifts from the source pages.

Writing for a firm page lives in the `about` column (kept out of the `data` JSON so the public firm list stays small).
`migrations/0004_import_about.sql` and the seed fill it from the existing pages. Firms are created with
`POST /api/admin/firms` (admin form "Add a firm") and can be switched either way from the edit form. Profile pages are
cached 60 seconds like the other public pages, and fall back to the static file if the database cannot be read.
`/firms/*` therefore always passes through the Worker.

The 7 Featured firms' richer tabbed layout is not reproduced by the dynamic template; keep those on `static` for now.

The per-practice-area pages are still pre-built HTML.

Capacity note: the Worker now handles these page views. On the free Workers plan that is 100,000 requests a day; the
Workers Paid plan ($5/month) raises it to 10 million a month. Plain static pages remain free and unlimited.

## Firm owners (Phase B)

- **Sign-up:** `/account/` is the owner area. The same one-time email link signs in or creates a plain `member` account
  (`signup: true` on `/api/auth/request-link`). Brand-new addresses are limited to 6 links per requester per hour and
  150 per day (Brevo's free plan sends 300 emails a day); a limit hit is logged as `signup.throttled`.
- **Nothing happens without approval:** `firm_members` holds one row per (person, firm) with status `pending`,
  `approved` or `rejected`. Owners ask to manage an existing firm (`POST /api/account/claims`) or submit a new one
  (`POST /api/account/firms`, stored with `firms.status = 'pending'` and hidden from every public query until approved).
  The admin approves or rejects on the Approvals tab; approving a new listing needs a map position (looked up from the
  address with OpenStreetMap when possible, otherwise entered by the admin). Approval can also switch a hand-built page
  to the database page so the owner's edits show on it.
- **What owners can do:** edit their own firm (same fields as admin except `featured`, page style and rating) and read/update
  the enquiries for it. Access is checked on every request against an approved membership of that exact firm.
- **Lead routing:** a form on a firm's profile page sends `firm=<slug>`; the lead is stored with `leads.firm_slug`, shown in
  the owner's dashboard immediately and emailed to the firm's approved owners (max 20 emails per firm per hour).
  The admin is emailed when a request needs approval, and the requester when it is decided.
- Shared code: `src/lib/firm-edit.js` (validation, create, edit), `src/lib/email.js` (all mail), `admin/ui.js` (UI helpers).
- Local development sends no mail; each message is recorded in the audit log as `mail.dev` instead.

## Setup that lives outside the repo (Cloudflare dashboard)

Workers & Pages -> lawdb -> Settings -> Variables and Secrets:

- `BREVO_API_KEY` (secret): Brevo API key with transactional email permission.
- `ADMIN_EMAILS` (secret): comma-separated emails allowed to sign in as admin.

Local development: copy the values from `.dev.vars` in the README (never committed).

## Roadmap

1. Admin area: sign-in, leads inbox, firm editing, activity log. (done)
2. Public directory pages and data files rendered from the database. (done)
   2b. Firm profile pages rendered from the database, with an `about` text and a create-firm form. (done)
3. Firm accounts: sign-up, claim/create a listing, admin approval, `firm_members` table. (done)
4. Firm dashboard: edit own profile, own enquiries, lead emails. (done; picture uploads next, via Cloudflare R2)
5. Featured billing (Stripe webhooks flip `featured`).

## Known limits

- Removing an email from `ADMIN_EMAILS` does not demote an existing admin row yet (disable the user in D1).
- Public API responses are cached for 5 minutes, so an admin edit can take that long to appear in the API.
