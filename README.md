# LawDB.ca

Canadian lawyer directory. Static pages served by Cloudflare, plus a Worker API backed by a D1 (SQLite) database.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Website | `*.html`, `site.css`, `images/`, city/province folders | Served directly by Cloudflare (fast, free). |
| API | `src/worker.js` | Runs only for `/api/*` requests. |
| Database | Cloudflare D1, schema in `migrations/` | Stores firms, blog posts and form leads. |
| Seed data | `firms_data.json`, `firms_hours.json`, `blog_data.json` | Source for the initial database contents (`scripts/build-seed.mjs`). |

### API

- `GET /api/health`
- `GET /api/firms?province=ON&city=Toronto&q=smith&featured=1&limit=50&offset=0`
- `GET /api/firms/:slug` (includes opening hours)
- `GET /api/blog?province=ON`
- `POST /api/leads` (JSON or form-encoded: `name`, `email` required; `phone`, `message`, `form`, `page` optional; any extra fields are kept)

## Local development

```bash
npm install
npm run db:migrate:local   # create tables in a local test database
npm run db:seed:local      # load firms + blog posts
npm run dev                # http://localhost:8787
```

## Deploying

Pushing to `master` deploys through Cloudflare (Workers Builds). First-time database setup, once:

```bash
npx wrangler login
npx wrangler d1 create lawdb          # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npm run db:seed:remote
```

Reading submitted leads: `npx wrangler d1 execute DB --remote --command "SELECT * FROM leads ORDER BY id DESC LIMIT 20"`

## Working on changes

1. Make a branch: `git checkout -b my-change`
2. Commit, push, open a Pull Request into `master`.
3. The **CI** check must pass before merging.

Database changes go in a new numbered file in `migrations/` (e.g. `0002_add_x.sql`), never by editing an old one.
