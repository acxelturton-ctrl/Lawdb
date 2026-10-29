// Which posts count as a blog article with its own photo. A post is left out only when its picture is clearly a headshot, logo,
// template or social card, or its headline is a welcome, award, event or people announcement. Everything else stays, so legal
// articles such as "Tribunal Awards $50,000" or "Spousal Sponsorship" are not caught by accident.

// Matched against the lower-cased path of the picture.
const PICTURE_NOT_ARTICLE = /(headshot|portrait|avatar|[-_/]profile|author[-_.]|our-team|meet-the|team-photo|staff-photo|logo|favicon|feature-image-socials|social-card|socials-\d|blog-bg-|thumbnail-default|default-(image|post|featured)|placeholder|image-template|template-blank|og-image)/;

// Matched against the headline.
const TITLE_NOT_ARTICLE = /\b(welcomes?|congratulat\w*|celebrat(es|ing|ed)|sponsors (the|a|an)|goodbye|we'?re hiring|best lawyers|super lawyers|lunching\s?with\s?lawyers|recogni[sz]ed (by|in)|top \d+ lawyers|king[’']s counsel|kc designation|receives? (his|her|their) kc)\b/i;

export function isBlogPhotoPost(p) {
  if (!p || !p.image) return false;
  let path;
  try { path = decodeURIComponent(new URL(p.image).pathname).toLowerCase(); } catch { return false; }
  if (PICTURE_NOT_ARTICLE.test(path)) return false;
  return !TITLE_NOT_ARTICLE.test(String(p.title || ''));
}
