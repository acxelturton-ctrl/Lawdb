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

## Blog cards ("Latest from the firm")

- Source: the firm's public RSS/Atom feed, found automatically from its website (`<link rel="alternate">`, then common paths like `/feed`) or entered by hand.
  Stored in `firm_feeds` (settings, status) and `firm_posts` (migration 0008): at most the 6 newest posts, each with a headline, date, a plain-text excerpt of at most 600
  characters and a link. Full articles are never stored or shown; if a feed only publishes full text, just the opening words are kept.
- Safety (`src/lib/feeds.js`): https only, no IP addresses or internal names, no logins or odd ports, every redirect re-checked, 8 s timeout, 1.5 MB cap; all markup is stripped;
  a post is kept only if its link points at the firm's own website (or the feed's host), so a feed cannot push links elsewhere.
- Display (`src/render/blog-cards.js`): up to 3 cards (headline, date, a short teaser that expands to the longer excerpt with a native `<details>` control, and a link to the article on
  the firm's site). Database-built pages include them in the template; hand-built pages get them injected at the edge with `HTMLRewriter` (after the "From the Firm" block, or
  before the fine print). Pages work unchanged if the lookup fails.
- Who gets them: Featured firms automatically (nightly cron `refreshAllFeeds`), any other firm when its owner or the admin switches them on. Owners and admins can switch cards off,
  enter the feed address, and check now (owners at most every 5 minutes) from the Blog cards panel. Local development never contacts real websites; it only re-reads feeds entered by hand.
- **Card pictures** (migration 0011, `firm_posts.image_url`): the picture the firm chose for each article. WordPress: the featured image (`_embed=wp:featuredmedia`, a medium-large size first, `jetpack_featured_media_url` as a backup;
  sites that refuse `_embed` are read the plain way). RSS/Atom: `media:content`, `media:thumbnail`, an image `enclosure`, else the first picture inside the item. Only the **address** is stored, never the file; it is loaded by the
  visitor's browser from the firm's own site (lazy, no referrer, 16:9 crop, dropped if it fails to load). Addresses must be public https (http is upgraded), no logins, no SVG/GIF, no tracking pixels; a picture repeated on several
  posts of one blog (a stand-in or logo) is ignored.

## Firm pictures

- Files live in the private R2 bucket `lawdb-images` (binding `IMAGES`, key `img/<id>`); the `firm_images` table (migration 0007) decides what is shown.
  The public address is `/img/<id>` (Worker route, cached 1 day in browsers). Only pictures still listed in the table, for live firms, are served; removal
  deletes the row and the file and clears the edge cache.
- Kinds: `logo` (one), `cover` (one), `photo` (up to 6). A new logo/cover replaces the old one. The logo and cover are written into the firm's public record
  using the fields the hand-built pages already use (`type: 'logo'`, `src: 'img/<id>'`, `heroImage`), so directory cards, the map, hubs and search show them; the
  original file names are remembered (`origSrc`, `origHero`) and restored when the picture is removed. Photos appear in a gallery on database-built pages.
- Upload safety (`src/lib/images.js`): the format is read from the file's own bytes (JPEG, PNG, WebP only, never SVG), 3 MB maximum, 64-8000 pixels per side,
  20 uploads per person per hour, owner descriptions pass the content rules. Pictures are served with `nosniff` and a sandboxing CSP.
- Admins can manage any firm's pictures; owners only their own. Every add/remove is in the activity log. The backup includes the `firm_images` rows; the files are in the bucket.

## Featured payments (Stripe)

- **No API key.** Stripe sends signed webhooks to `POST /api/stripe/webhook`; `src/lib/stripe.js` checks the `Stripe-Signature` header (HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`, 5-minute tolerance,
  constant-time comparison) before anything else. No secret configured = 503; bad signature = 400. Each event id is stored (`stripe_events`) so a repeat is applied once; a failure removes the id so Stripe retries.
- **Who gets Featured:** the owner's "Upgrade to Featured" button opens the Stripe payment link with `client_reference_id=<firm slug>` and `prefilled_email=<owner email>` (`STRIPE_PAYMENT_LINK`, one plan: $199/month).
  On `checkout.session.completed` the firm is made Featured only if the payer's email is an approved owner of that firm. Otherwise the payment is parked as `needs_review` (admin Payments tab: assign to a firm or dismiss).
- **Lifecycle** (`firm_subscriptions`, migration 0009): subscription events keep status (`active`, `past_due`, `canceled`), renewal date and cancel-at-period-end. `past_due` keeps the firm Featured while Stripe retries the card.
  When no live subscription remains the firm returns to Basic, unless it was already Featured before paying (`featured_before`, e.g. set by hand), which is never undone. Events may arrive in any order.
- **Owner side:** `GET /api/account/firms/:slug/plan` feeds the plan card (Basic/Featured, renewal date, upgrade link, manage-billing link from `STRIPE_PORTAL_URL`). **Admin side:** Payments tab, Overview totals (count and monthly amount).
- Setup steps for the live account are in `docs/STRIPE_SETUP.md`. Local tests sign events with `STRIPE_WEBHOOK_SECRET=whsec_smoke_test_secret` from `.dev.vars`.

## LawDB News and the menu

- **LawDB News** (`/news`, rendered by `src/routes/news-page.js` + `src/render/news-page.js`) is the page of member firms' blog cards: firm name (Featured badge), date, headline, a short preview that expands,
  and a link to the full article on the firm's own website. Filter by firm with `?firm=<slug>`. A static copy (`news.html`, built by `scripts/build-news-fallback.mjs`, checked by `npm run check`) is served if the database is down.
- **Masthead artwork ("The Press"):** a light, paper-textured masthead with a slowly turning gold seal (scales of justice in the middle), a headline that underlines itself, and up to four of the page's own latest stories (firm name and headline, taken from the database) drifting up the right side on wide screens (`pressArt` in `src/render/news-page.js`). Pure SVG/CSS, no image files, `aria-hidden`, still when the visitor prefers reduced motion.
- **Edge to edge:** a dark masthead (title, a short welcome, real counts of firms and articles and the latest story date), "how it works" in three steps, the strip of firms writing here, filter chips, then the feed filling the full screen width (cards from 380px, the lead story, the newest post with a picture, as one wide card). The counts and the firm strip are computed from the database, never invented.
- **A picture feed:** the page is laid out like a social feed (`.lw-feed`): one large card at a time on a phone (post header with the firm's logo or initial, Featured badge and date; a big 4:3 picture; headline; longer preview), two columns on a wide screen.
  Every post with a picture is shown, but at most 3 posts without one (the newest) so it never becomes a wall of text (`limitWithoutPicture` in `src/routes/news-page.js`).
- **Which blogs:** every firm with blog cards switched on (`firm_feeds.enabled`). Featured firms are added automatically each night; the admin **News** tab adds or removes any firm and has the switch
  `news_featured_only` (`site_settings`) to limit the page to Featured members only. The page fills itself: when someone visits, blogs never read (or not for 12 hours) are read in the background, a few per visit;
  the nightly job also refreshes them.
- **Sources** (`src/lib/feeds.js`): a WordPress site's public post list (`/wp-json/wp/v2/posts`, tried first: headline, date and the site's own excerpt in one request) or an RSS/Atom feed. Switching a firm's blog address clears its old posts, so the same article can never appear twice.
  Blogs checked by hand are seeded by migration 0010 (Barbarian Law, Weaver Simmons, Nelligan, Daniel Brown; Blottman is found automatically).
- **Court decisions explained** (the 12 LawDB-written articles, now under `/court-decisions/`) are listed on `/court-decisions` and are linked from the footer and each article's breadcrumb.
- **Menu:** three items (Find Your Lawyer, LawDB News, For Law Firms) plus the consultation button, on every page. `/for-firms.html` is the single hub for firms (list free, Featured, manage listing, grow your practice).
  The footer's columns follow the same structure with no repeated destinations.

## Google Search Console (Search tab)

- `src/lib/gsc.js` signs a short-lived token request with a Google **service account** key (secret `GSC_SERVICE_ACCOUNT_JSON`, RS256 via Web Crypto), then calls the Search Console API: list properties (picks `sc-domain:lawdb.ca`, else the https URL-prefix ones; `GSC_SITE` overrides),
  `sitemaps.submit` + status, and **URL Inspection** (`index:inspect`). No key = every call is skipped and the Search tab shows the setup steps.
- A second cron, `37 7 * * *`, runs `searchNightly`: sends the sitemap and inspects 40 pages (4 key pages plus the next 36 of our own sitemap, round and round via `site_settings.gsc_cursor`). It is its own cron run so it stays inside the platform's limit on outgoing requests.
  Results are kept in `search_pages` (migration 0012); the latest sitemap status and run outcome are in `site_settings` (`gsc_sitemap`, `gsc_last_run`). Stops at the first 401/403/429.
- Admin: `GET /api/admin/search`, `POST /api/admin/search/run {part: all|sitemap|inspect}`, `POST /api/admin/search/inspect {url}` (lawdb.ca pages only). Admin tab **Search**. The key is never returned by any API.
- Not possible by API: "Request indexing" for ordinary pages (Google's Indexing API is for jobs/livestreams only). Setup: `docs/SEARCH_CONSOLE_SETUP.md`.
- Tests run against a fake Google on port 8798 (`scripts/gen-test-gsc.mjs` adds a throw-away key to `.dev.vars`); `GSC_API_BASE`/`GSC_TOKEN_URL` are only honoured in local development (`DEV_ECHO_LINK=1`).

## URLs: one clean address per page

- No ".html" anywhere. Every page has exactly one address: `/list-your-firm`, `/firms/<slug>`, `/ontario/toronto/` (hubs keep their trailing slash), `/ontario/family-lawyers`, `/news`, `/court-decisions/<case>`.
  The canonical tag, `og:url`, the sitemap and every internal link use that address; `npm run check` runs `scripts/check-links.mjs`, which fails the build if a page links to an old-style address, a link is broken, or a canonical/sitemap entry disagrees with the page's own address.
- Province-wide practice-area pages are `/<province>/<practice>-lawyers` for every province (they used to be `/services/bc-family`, `/services/qc-family`, `/services/family`, which only covered three provinces and did not say where). LawDB News moved from `/legal-news.html` to `/news`; the court-decision articles from `/legal-news/<case>` to `/court-decisions/<case>`.
- Old addresses answer with a permanent **301** redirect (`src/lib/redirects.js`, applied in the Worker before anything else; `wrangler.jsonc` sends every `*.html` request to the Worker first). The platform's own `.html` redirect is a temporary 307 and was previously what visitors and search engines got.
- Firm slugs (`/firms/<name>`) were already lowercase, hyphenated and descriptive (a city is added only to tell same-named firms apart) and are unchanged.
- Adding a page: save it as `some-page.html`, link to `/some-page`, canonical `https://lawdb.ca/some-page`, add it to `sitemap.xml`, run `npm run check`.

## Story pages (every blog card has its own page)

- `/news/<firm>/<headline-words>-<id>` (`src/routes/story-page.js`, `src/render/story-page.js`, address helpers in `src/lib/stories.js`): the picture, headline, the short preview the firm publishes (never the full article), the firm with a link to its LawDB profile,
  a clear "Read the full article on <their site>" button, more stories from the same firm and more firms in the same city. Self-canonical, `og:*` tags and a breadcrumb list. The id makes the address stable; wrong or old wording redirects (301) to the right one.
- Why own pages: they are internal links into firm profiles and city pages and give search engines fresh, crawlable pages per story, without copying anyone's article (which would be duplicate content and the firms' copyright). They will not outrank the firms' own articles for the article's topic.
  Watch Search Console: if most are reported "Crawled, not indexed", switch the page to `noindex` (one line in `renderStoryPage`) and keep the expanded view.
- The News page opens a story over the page: a `<dialog>` loads `<story address>?partial=1` (just the story, `X-Robots-Tag: noindex`) and pushes the story's own address into the browser history, so Back or Escape closes it and the link can be shared. Without JavaScript the cards are ordinary links to the story pages.
- Up to 20 stories per firm are kept (was 6) so story pages live for weeks; a story that rotates off, or a firm whose cards are switched off, returns 404. `/sitemap-news.xml` lists every story; `robots.txt` announces it and the nightly Search Console run submits it.

## Following, saving and the feed

- Any signed-in person (the same passwordless accounts as firm owners) can **follow a firm** (its LawDB listing) and **save a story**. Tables `follows` and `saved_stories` (migration 0015, included in the nightly backup). Follows and saves are private; the only public number is how many people follow a firm.
- API (`src/routes/social.js`): `GET /api/social/status?slugs=..&posts=..` (public; says who is looking, which of those firms they follow with totals, which stories they saved), `POST /api/account/follow {slug}`, `DELETE /api/account/follow/:slug`,
  `GET /api/account/following`, `GET /api/account/feed` (latest 40 stories of followed firms), `GET|POST /api/account/saved`, `DELETE /api/account/saved/:id`. Limits: 500 follows, 500 saves, 60 new follows or saves per person per hour. Only live firms and stories of firms with cards switched on can be followed or saved.
- Buttons: `/follow.js` turns any `data-follow="<slug>"` or `data-save="<story id>"` element into a Follow or Save button. Firm pages (hand-built and database-built) get a Follow button next to Call / Website / Directions injected at the edge (`withFollow` in `src/routes/firm-page.js`); LawDB News cards and story pages carry Follow and Save. Signed-out visitors are sent to `/account/` and the action is finished after they sign in (`localStorage.lawdb_pending`).
- `/account/` has tabs Feed, Following, Saved, My firms. People who do not manage a firm land on Feed. The header menu has a "Sign in" link on every page.
- Not built yet (ideas, in order): a weekly email of new stories from the firms you follow, lawyers' own posts on LawDB, follower lists with consent.

## Safeguards (hardening pass)

- **Ownership signal:** the Approvals card compares the claimant's email domain with the firm's website
  (`emailMatch` in `src/routes/admin.js`): match / personal email / mismatch / no website. It informs the decision; it never approves on its own.
- **Owner text rules** (`src/lib/content-rules.js`, owners only, only for text being changed): no HTML, no links, no regulated advertising
  claims ("best", "#1", "top-rated", "guaranteed", "specialist"). Everyone who claims or adds a firm must accept the firm terms
  (`/terms#firm-terms`); the time is stored in `firm_members.terms_accepted_at`.
- **Reports:** every profile page links to `/report-listing?firm=<slug>`. Reports are leads with form `report-listing`; they are never shown
  or emailed to the firm. The admin is emailed. **Undo:** the Activity tab can restore the values an edit replaced (`POST /api/admin/audit/:id/revert`).
- **People:** the People tab disables/enables owner accounts (disabling ends all their sessions). "Sign out everywhere" is available to everyone.
  `ADMIN_EMAILS` is authoritative on every request: removing an address demotes that admin immediately.
- **Abuse limits:** 15 enquiries per requester address per hour (hash kept 7 days), 20 enquiry emails per firm per hour, sign-up limits (see above).
- **Backups and housekeeping:** a Cloudflare cron (`07:17 UTC`, `wrangler.jsonc`) runs `src/lib/backup.js`: it applies the retention rules, then copies every table into the
  `lawdb-backups` KV namespace (binding `BACKUPS`, each key expires after 35 days). "Back up now" is on the Overview tab; a stale backup or failed
  emails show as warnings there. D1 also keeps 30 days of point-in-time history (restore with `wrangler d1 time-travel restore`).
  **Retention (stated in the privacy policy):** enquiry personal details removed after 12 months (firm, date and status kept), abuse hashes 7 days,
  activity log 24 months, backups 35 days.
- **Health:** `GET /api/health` answers 503 if the database cannot be read; point an uptime monitor at it.
- Local test of the nightly job: `wrangler dev --test-scheduled`, then request `/__scheduled`.

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
4. Firm dashboard: edit own profile, own enquiries, lead emails. (done)
4b. Hardening: ownership signal, content rules, reports and undo, people controls, backups, retention. (done)
4c. Picture uploads: logo, cover, photos (R2). (done)
5. Featured billing (Stripe webhooks flip `featured`).

## Known limits

- Removing an email from `ADMIN_EMAILS` does not demote an existing admin row yet (disable the user in D1).
- Public API responses are cached for 5 minutes, so an admin edit can take that long to appear in the API.
