# LawDB.ca

Canadian lawyer directory. Static pages served by Cloudflare, plus a Worker API backed by a D1 (SQLite) database.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Website | `*.html`, `site.css`, `images/`, city/province folders | Served directly by Cloudflare (fast, free). |
| API | `src/worker.js` | Runs only for `/api/*` requests. |
| Database | Cloudflare D1, schema in `migrations/` | Stores firms, blog posts and form leads. |
| Pictures | Cloudflare R2 bucket `lawdb-images` | Firm logos, covers and photos, served at `/img/<id>`. |
| Seed data | `firms_data.json`, `firms_hours.json`, `blog_data.json` | Initial database contents (`scripts/build-seed.mjs`) and the fallback if the database is down. At runtime the Worker serves these from the database. |

### API

- `GET /api/health`
- `GET /api/firms?province=ON&city=Toronto&q=smith&featured=1&limit=50&offset=0`
- `GET /api/firms/:slug` (includes opening hours)
- `GET /api/blog?province=ON`
- `POST /api/leads` (JSON or form-encoded: `name`, `email` required; `phone`, `message`, `form`, `page` optional; any extra fields are kept)
- `POST /api/auth/request-link`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/admin/{stats,leads,firms,firms/:slug,audit}`, `POST /api/admin/firms` (create a firm), `GET /api/admin/{members,users}`, `PATCH /api/admin/{leads/:id,firms/:slug,members/:id,users/:id}`, `POST /api/admin/{audit/:id/revert,backup}`, `GET|PATCH /api/admin/news`, `GET|PATCH /api/admin/firms/:slug/feed`, `POST /api/admin/firms/:slug/feed/refresh`, `GET|POST|DELETE /api/admin/firms/:slug/images[/:id]` (admins only)
- `GET /api/account/{me,search,firms/:slug,firms/:slug/leads}`, `POST /api/account/{claims,firms}`, `PATCH /api/account/{firms/:slug,leads/:id}`, `GET|PATCH /api/account/firms/:slug/feed`, `POST /api/account/firms/:slug/feed/refresh`, `GET|POST|DELETE /api/account/firms/:slug/images[/:id]` (signed-in firm owners; firm routes need an approved membership)

## Local development

```bash
npm install
printf 'ADMIN_EMAILS=you@example.com\nDEV_ECHO_LINK=1\n' > .dev.vars   # local only, never committed
npm run db:migrate:local   # create tables in a local test database
npm run db:seed:local      # load firms + blog posts
npm run dev                # http://localhost:8787
npm run smoke              # end-to-end test (needs ADMIN_EMAILS=smoke-admin@example.com in .dev.vars, BASE=http://localhost:8787)
```

With `DEV_ECHO_LINK=1` the sign-in API returns the link in its response instead of emailing it,
so you can sign in at `/admin/` without email set up. Never set it in production.

## Admin area

`/admin/` (sign-in by emailed one-time link): leads inbox with status tracking, firm editing,
activity log. Setup and design decisions are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Deploying

Pushing to `master` deploys through Cloudflare (Workers Builds). In the Cloudflare dashboard
(Workers & Pages -> lawdb -> Settings -> Builds) the **Deploy command** is:

```
npm run deploy:ci
```

That applies any new database migrations, adds any new firms/blog posts from the JSON files
(existing rows are never overwritten), then deploys. The D1 database is called `lawdb`
(its id is in `wrangler.jsonc`).

To deliberately overwrite database rows from the JSON files: `npm run db:seed:update:remote`
(needs `npx wrangler login` locally).

Reading submitted leads: `npx wrangler d1 execute DB --remote --command "SELECT * FROM leads ORDER BY id DESC LIMIT 20"`

## Working on changes

1. Make a branch: `git checkout -b my-change`
2. Commit, push, open a Pull Request into `master`.
3. The **CI** check must pass before merging.

Database changes go in a new numbered file in `migrations/` (e.g. `0002_add_x.sql`), never by editing an old one.
