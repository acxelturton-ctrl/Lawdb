# LawDB Marketplace: legal and privacy notes (DRAFT, for a lawyer to review before launch)

LawDB is not a law firm and this file is not legal advice. It says what the code does, what is live, how the build differs from the brief, and what a lawyer
should review. Acxel plans a short consult with a lawyer who knows Canadian law society advertising rules before the Lead Marketplace is opened.

## What is built, and what is live

- **Built and tested:** the whole marketplace (see docs/ARCHITECTURE.md, "Lead Marketplace"). It is **closed until the admin opens it** (Admin, Lead Marketplace, Open), so none of the consent wording below is shown to anyone, and no request is taken, until then. Today the public sees only `/marketplace`, which says nothing is available yet and collects nothing.
- **The consent wording** ("I agree that LawDB may share my inquiry and contact details with one law firm that pays to receive it. Only one firm will receive it. LawDB may also contact me about my inquiry.") is on the "tell us what you need" request and on an **optional, unticked box on each firm's contact form**. It appears only when the marketplace is open, so it never describes sharing that is not happening. A firm's own sentence ("will share these details with {firm} so they can respond") is unchanged, because that enquiry still goes to that firm whether or not the box is ticked. An enquiry sent through a firm's form with the box ticked is also offered to **one other** firm, never the one it was sent to.
- **The Privacy Policy, Terms and Refund Policy already describe it** (they were updated in the same release), worded for when it is open ("if you use the request, or tick the box..."). Check them with your lawyer before you open it.
- **Stored per inquiry:** the consent record (form, version, exact wording, time, a short browser string, the hashed network address, never the address itself). Retention: details deleted when an unlocked-by-nobody inquiry expires (7 days) or is rejected, and 12 months after an unlock; the consent record and the ledger are kept.

## Where the build differs from the brief, and why

- The brief asked for Resend or Postmark. Brevo sends everything else on the site, so alerts use **Resend if `RESEND_API_KEY` is set, else Brevo**; Resend needs an account and a verified sending domain, which only you can set up.
- The brief's `leads` table name is taken by firm enquiries, so the tables are `marketplace_*`.
- The brief suggested "1 to 2 free credits" for new firms; a credit is a dollar, so the welcome grant is a setting (`welcomeCredits`, default 0).
- The brief's waitlist was dropped at your request: nothing is collected while it is closed.
- The "tell us what you need" page is `noindex` and not in the sitemap until you decide you want it found.

## Rules the build follows (from the brief)

- The price of an inquiry is a **flat advertising fee**. It never depends on whether the person becomes a client: no percentage of fees, no success bonus,
  no outcome-based refund. Refunds are only for clearly junk inquiries (disconnected number, spam, fake) within 48 hours, as credit, after an admin decides.
- Wording: "inquiry", "unlock", "advertising". Not "referral", "commission" or "client for sale". `scripts/test-marketplace.mjs` fails if the page uses them.
- Previews never identify a person and sit behind a firm login; only verified firms can unlock.

## Where the wording is

Privacy Policy ("Lead Marketplace requests", "Lead Marketplace (law firms)", who it is shared with, retention), Terms ("Lead Marketplace", for people and for firms) and Refund Policy ("Lead Marketplace credits"), all dated November 25, 2026; the consent wording is `CONSENT` in `src/lib/marketplace.js`. Change the wording only by changing its version id there, so a stored agreement can always be matched to the words that were shown.

## Items for a lawyer to review before launch

1. Whether a **flat per-inquiry fee** from a firm to a non-lawyer directory is acceptable under each province's rules, in particular Ontario, Quebec, BC and
   Alberta (referral fees, fee-splitting, and "pay to be recommended" rules differ), and whether the words "advertising fee" are the right description.
2. Whether giving **Featured firms a head start** on new inquiries changes that analysis.
3. The consent wording above, and whether a **separate optional checkbox** on firm-page forms is enough for a firm-specific enquiry to be shared more widely.
4. **CASL**: alert emails to firms need express consent, the sender's name and mailing address, and a working unsubscribe in the message itself.
5. **PIPEDA and Quebec Law 25**: meaningful consent, sensitive information, retention, access and deletion requests, and the privacy-officer contact.
6. **Prepaid credits**: whether they are "gift card / prepaid" under any consumer rules, how unused credits are treated when an account closes, and tax
   (GST/HST/QST) on a credit sale and on an unlock.
7. **Verification**: what LawDB may say about a firm it has "verified" and what it should not imply.
8. **Email domain**: the site sends through Brevo from info@lawdb.ca. Confirm SPF, DKIM and DMARC for lawdb.ca in the DNS before alert volume grows.
