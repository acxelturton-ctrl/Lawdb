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

## Setup that lives outside the repo (Cloudflare dashboard)

Workers & Pages -> lawdb -> Settings -> Variables and Secrets:

- `BREVO_API_KEY` (secret): Brevo API key with transactional email permission.
- `ADMIN_EMAILS` (secret): comma-separated emails allowed to sign in as admin.

Local development: copy the values from `.dev.vars` in the README (never committed).

## Roadmap

1. Admin area (this release): sign-in, leads inbox, firm editing, activity log.
2. Public pages read firms and blog from the API instead of the JSON files.
3. Firm accounts: owner invites / "claim this listing", admin approval, `firm_members` table.
4. Firm dashboard: own leads (lead -> firm routing), edit own profile.
5. Featured billing (Stripe webhooks flip `featured`).

## Known limits

- Removing an email from `ADMIN_EMAILS` does not demote an existing admin row yet (disable the user in D1).
- Public API responses are cached for 5 minutes, so an admin edit can take that long to appear in the API.
