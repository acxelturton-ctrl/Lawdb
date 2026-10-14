# Google Search Console: connecting it (about 10 minutes, once)

After this, the site talks to Google by itself: every night (07:37 UTC) it sends the sitemap and asks Google about the next 40 pages
("is this page on Google, and if not, why?"). The admin **Search** tab shows the answers and has buttons to do it on demand.

**What cannot be automated:** "Request indexing" for a single page. Google offers no API for it (its Indexing API is only for job postings and
livestreams). That one button stays manual in Search Console; the Search tab lists the pages that need it.

**Never paste the key file into a chat, email or the repo.** It goes only into Cloudflare, as a secret.

1. **Google Cloud** (console.cloud.google.com, same Google account as Search Console): create a project (e.g. "LawDB").
   *APIs & Services, Library* → search **Google Search Console API** → Enable.
2. *IAM & Admin, Service accounts* → **Create service account** (name "lawdb-search", no roles needed) → open it → *Keys* → **Add key, Create new key, JSON**.
   A `.json` file downloads. Note the account's email (`lawdb-search@<project>.iam.gserviceaccount.com`).
3. **Search Console** (search.google.com/search-console) → your lawdb.ca property → *Settings, Users and permissions, Add user*:
   paste the service account's email, permission **Full** (use **Owner** if Google offers it and Full is refused).
4. **Cloudflare**: Workers & Pages → lawdb → Settings → Variables and Secrets → **Add**, type **Secret**, name `GSC_SERVICE_ACCOUNT_JSON`,
   value = the entire contents of the `.json` file. Save and deploy.
   (Only if you have several properties and the wrong one is picked: add a plain-text variable `GSC_SITE` with the exact property, e.g. `sc-domain:lawdb.ca` or `https://lawdb.ca/`.)
5. Open **/admin → Search → Check connection**. It should say *Connected*. Press **Send sitemap now** and **Check the next 40 pages**.

If it says Google refused (403), step 3 is the usual cause (the email must be a user of the property). If it says Google did not accept the key, re-copy the whole JSON file into the secret and check that the Search Console API is enabled (step 1).

Limits worth knowing: the URL Inspection API allows 2,000 checks per property per day; we use 40 per night (about two weeks to cover the whole site).
