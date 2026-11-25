# LawDB Marketplace: legal and privacy notes (DRAFT, for a lawyer to review before launch)

LawDB is not a law firm and this file is not legal advice. It says what the code does, what it deliberately does not do yet, and the wording that is drafted
for Phase 1. **Nothing in the "Draft wording" section is on the live site.** Acxel plans a short consult with a lawyer who knows Canadian law society
advertising rules before the Marketplace opens.

## What is live (Phase 0)

- `/marketplace`: a "coming soon" page for law firms. It shows one clearly labelled example card ("Example lead, not a real inquiry") and no consumer data.
- A waitlist form on that page. It stores, in the `leads` table with `form = 'marketplace-waitlist'`: name, work email, firm name, an optional law society
  reference, ticked practice areas and provinces, and a **consent record** (time, form version, the exact wording of that version, a short browser string).
  The wording is written by the server from `src/lib/consent.js`; a browser cannot change it. The IP address is kept only as the one-way hash every form
  already keeps for 7 days. The box must be ticked (not ticked in advance).
- One confirmation email to the person (transactional: they are on the list, nothing is charged, reply to be removed) and one note to the admin.
- Retention: like every row in `leads`, the personal fields are removed automatically after 12 months (`src/lib/backup.js`). The Privacy Policy says so.
- The Privacy Policy lists the waitlist (what is collected, why, how long). The Terms say the Marketplace is not open and that joining is not a contract.

## What is deliberately NOT done yet

- **The firm-page enquiry form keeps its current wording**: "By submitting, you agree LawDB may contact you about your inquiry and will share these details
  with {firm} so they can respond." That is exactly what happens today. The brief asked for wording about sharing with "a law firm that pays to receive it"
  on that form, but until Phase 1 builds that sharing, saying it would tell people something that is not true yet. In Phase 1 it becomes a **separate,
  optional, unticked checkbox** ("marketplace-inquiry" in `src/lib/consent.js`), so a person who only wants to contact the firm they are looking at is
  never opted in to anything wider.
- No lead is shown, stored for sale or sent to any firm. There is no price, no credit and no unlock yet.

## Rules the build follows (from the brief)

- The price of an inquiry is a **flat advertising fee**. It never depends on whether the person becomes a client: no percentage of fees, no success bonus,
  no outcome-based refund. Refunds are only for clearly junk inquiries (disconnected number, spam, fake) within 48 hours, as credit, after an admin decides.
- Wording: "inquiry", "unlock", "advertising". Not "referral", "commission" or "client for sale". `scripts/test-marketplace.mjs` fails if the page uses them.
- Previews never identify a person and sit behind a firm login; only verified firms can unlock.

## Draft wording for Phase 1 (not published)

**Consent shown with the general "find me a lawyer" form** (`marketplace-inquiry`, version `mp-inquiry-2026-11-v1`):
"I agree that LawDB may share my inquiry and contact details with one law firm that pays to receive it. Only one firm will receive it. LawDB may also
contact me about my inquiry."

**Privacy Policy, new paragraphs to add when the Marketplace opens:**
- What we collect: "If you ask LawDB to find you a lawyer: your name, email, phone number (if given), the description you write, the kind of help, your city
  and province, how urgent it is, and a record of your consent."
- How we use it: "We check each request, write a one-line summary that does not name you, and show that summary (without your name, email or phone) to law
  firms that LawDB has verified. One firm may pay to unlock your details; only that firm receives them."
- Who we share it with: "The one law firm that unlocks your inquiry. We do not sell your information to anyone else, and we do not share it with firms that
  have not unlocked it."
- Retention: a period to be decided with the lawyer (the 12 months used for other requests is the starting point).
- Sensitive information: say plainly that people should not put more sensitive detail than needed in the description (PIPEDA: meaningful consent).

**Terms, a Marketplace section for firms:** verified firms only; one buyer per inquiry; flat fee, prepaid credits, no refund tied to the outcome; the junk-
inquiry rule and its 48-hour window; the firm stays responsible for its own law society's rules on advertising and soliciting; no resale of an inquiry;
contact the person only about their inquiry (CASL).

## Items for a lawyer to review before launch

1. Whether a **flat per-inquiry fee** from a firm to a non-lawyer directory is acceptable under each province's rules, in particular Ontario, Quebec, BC and
   Alberta (referral fees, fee-splitting, and "pay to be recommended" rules differ), and whether the words "advertising fee" are the right description.
2. Whether giving **Featured firms a head start** on new inquiries (Phase 2) changes that analysis.
3. The consent wording above, and whether a **separate optional checkbox** on firm-page forms is enough for a firm-specific enquiry to be shared more widely.
4. **CASL**: the waitlist is express consent to email about the Marketplace. Later launch and alert emails need the sender's name and mailing address and a
   working unsubscribe in the message itself (the confirmation only says "reply to be removed").
5. **PIPEDA and Quebec Law 25**: meaningful consent, sensitive information, retention, access and deletion requests, and the privacy-officer contact.
6. **Prepaid credits**: whether they are "gift card / prepaid" under any consumer rules, how unused credits are treated when an account closes, and tax
   (GST/HST/QST) on a credit sale and on an unlock.
7. **Verification**: what LawDB may say about a firm it has "verified" and what it should not imply.
8. **Email domain**: the site sends through Brevo from info@lawdb.ca. Confirm SPF, DKIM and DMARC for lawdb.ca in the DNS before alert emails (Phase 2).
