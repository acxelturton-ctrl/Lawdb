// The two paid plans and what they cost, in one place. Pages, emails, the owner's dashboard and the pitch pages (scripts/apply-featured-promo.mjs, apply-plan-table.mjs) all read
// these numbers, so a price changes here and nowhere else (then run the two apply scripts, which rewrite the pages).
//
//   Basic                free: the firm and every lawyer it lists (name, role, years in practice)
//   Featured firm        FIRM_PRICE per month: priority placement, the firm's own page, analytics, enquiries (the Featured benefits), and the right for its lawyers to go Featured too
//   Featured lawyer      LAWYER_PRICE per month, only at a Featured firm: a profile page of their own, education, languages, awards, a direct phone number and their own pin on the map
//
// The two Stripe payment links are set in wrangler.jsonc (STRIPE_PAYMENT_LINK for the firm plan, STRIPE_LAWYER_PAYMENT_LINK for the lawyer plan); docs/STRIPE_SETUP.md says how.
export const FIRM_PRICE = 199;
export const LAWYER_PRICE = 99;
export const TRIAL_DAYS = 30;
export const FIRM_PRICE_LABEL = '$' + FIRM_PRICE + ' / month';
export const LAWYER_PRICE_LABEL = '$' + LAWYER_PRICE + ' / month';
export const priceText = (n) => '$' + n + ' a month';
