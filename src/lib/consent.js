// The exact consent wording shown next to a form, and the record kept when someone agrees to it.
//
// The wording lives here, with a version id, so the text a person agreed to can always be looked up from the record: the record keeps the version, the exact
// text, the time, the form and a short browser string, never the person's IP address (a one-way hash of it is kept with the lead itself, as for every form).
// A visitor cannot change the wording that is stored: the form sends "yes", and the server writes the canonical text for the version it was shown.
//
//   MARKETPLACE_WAITLIST   a law firm asks to be emailed about LawDB Marketplace (live from Phase 0).
//   MARKETPLACE_INQUIRY    a person agrees that their inquiry may be shared with ONE law firm that pays to receive it (Phase 1: not shown anywhere yet).
//                          It is deliberately not on the firm-page enquiry form today: that form shares an enquiry only with the firm named on the page, and
//                          its own wording ("will share these details with {firm}") says exactly that. See docs/MARKETPLACE_LEGAL.md.
export const CONSENTS = {
  'marketplace-waitlist': {
    version: 'mp-waitlist-2026-11-v1',
    text: 'Email me about LawDB Marketplace, including when it opens. I can withdraw this at any time by replying to any of these emails.',
  },
  'marketplace-inquiry': {
    version: 'mp-inquiry-2026-11-v1',
    text: 'I agree that LawDB may share my inquiry and contact details with one law firm that pays to receive it. Only one firm will receive it. LawDB may also contact me about my inquiry.',
  },
};

// What is stored for one agreement. `form` is a key of CONSENTS; `now` and `userAgent` are passed in so the function is pure.
export function consentRecord(form, { now = new Date(), userAgent = '' } = {}) {
  const c = CONSENTS[form];
  if (!c) throw new Error(`no consent wording for the form "${form}"`);
  return { form, version: c.version, text: c.text, at: now.toISOString(), userAgent: String(userAgent || '').slice(0, 200) };
}
