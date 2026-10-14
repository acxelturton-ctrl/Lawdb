// Rules for text that firm owners write (admins are trusted and skip them).
// Law societies restrict how lawyers may advertise, and a directory that shows unchecked claims,
// spam links or markup is a liability, so owner text is checked before it is saved. Only text that
// is actually being changed is checked, so wording already on a page never blocks an unrelated edit.

import { HttpError } from './http.js';

const URLISH = /https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\.(?:com|ca|net|org|io|co|info|biz|law|xyz|ly|me)\b/i;
const MARKUP = /<\s*\/?\s*[a-z!]/i;
// Claims regulated by law societies' advertising rules (comparative or guaranteed claims, restricted titles).
const CLAIMS = /(?:\bbest\s+(?:\w+\s+){0,2}(?:lawyers?|attorneys?|law\s*firms?|firms?|in\s+(?:the\s+)?(?:city|town|province|canada|ontario|quebec|alberta|manitoba|british\s+columbia))\b|#\s?1\b|\bnumber\s+(?:one|1)\b|\btop[\s-]+rated\b|\btop\s+(?:\w+\s+){0,2}(?:lawyers?|law\s*firms?)\b|\bguarantee[sd]?\b|\bcertified\s+specialists?\b|\bspecialists?\b|\bnever\s+lose\b|\balways\s+win\b|\bwin\s+rate\b)/i;

export function checkOwnerText(label, value, { allowLinks = false } = {}) {
  const text = Array.isArray(value) ? value.join(' \n ') : String(value ?? '');
  if (!text) return;
  if (MARKUP.test(text)) throw new HttpError(422, `${label}: plain text only, please remove any HTML or formatting codes.`);
  if (!allowLinks && URLISH.test(text)) throw new HttpError(422, `${label}: links and web addresses are not allowed in this text. Your website has its own field.`);
  if (CLAIMS.test(text)) {
    throw new HttpError(422, `${label}: law societies restrict claims such as "best", "#1", "top-rated", "guaranteed" or "specialist". Please rephrase, or email info@lawdb.ca if the claim is accurate and permitted.`);
  }
}
