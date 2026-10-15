# "Continue with Google" and "Continue with LinkedIn": setting them up (once each)

The buttons appear on the sign-in page by themselves as soon as a provider's two values are in Cloudflare (until then only the email link shows).
**Never paste a client secret into a chat, an email or the repo.** Put it only in Cloudflare: Workers & Pages → lawdb → Settings → Variables and Secrets.

## Google (about 10 minutes)
1. console.cloud.google.com → your **LawDB** project (the same one used for Search Console) → *APIs & Services* → **OAuth consent screen**.
   User type **External**; app name "LawDB"; support email info@lawdb.ca; authorised domain `lawdb.ca`. Scopes: `openid`, `email`, `profile` (nothing else).
   Then press **Publish app** (Testing mode only allows named test users).
2. *APIs & Services* → **Credentials** → **Create credentials** → **OAuth client ID** → type **Web application**.
   **Authorised redirect URI:** `https://lawdb.ca/api/auth/google/callback` (exactly).
3. Copy the **Client ID** and **Client secret**. In Cloudflare add:
   - `GOOGLE_CLIENT_ID` (type Text or Secret)
   - `GOOGLE_CLIENT_SECRET` (type **Secret**)

## LinkedIn (about 10 minutes)
1. linkedin.com/developers → **Create app** (name "LawDB", a LinkedIn Page for LawDB is required; logo; accept terms).
2. *Products* tab → request **Sign In with LinkedIn using OpenID Connect** (approved instantly).
3. *Auth* tab → **Authorized redirect URLs for your app:** `https://lawdb.ca/api/auth/linkedin/callback` (exactly).
4. Copy the **Client ID** and **Primary Client Secret**. In Cloudflare add `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` (**Secret**).

## Check it
Open `https://lawdb.ca/account/` in a private window. The buttons show. Press one, choose an account: you land on your dashboard ("Welcome, <first name>!") and receive the welcome email.

## How it stays safe
- Standard OpenID Connect (authorization code + PKCE) done on the server; the secret never reaches the browser.
- Every attempt has a one-time `state` (hash stored, valid 10 minutes). Reused, expired or invented states are refused.
- An account is matched by email address, and only when the provider says the address is **verified**. Nothing else (no contacts, no password) is requested.
- `ADMIN_EMAILS` still decides who is an admin; disabled accounts cannot sign in; at most 150 new accounts a day.
