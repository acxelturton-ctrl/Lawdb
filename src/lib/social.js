// A firm's social profile links (Facebook, Instagram, LinkedIn, X, YouTube): which addresses are accepted. Shared by the finder script,
// the apply script and the story popup, so what is stored and what is shown follow the same rules: https only, the network's own
// address, a profile or page (never a share button, a single post, a video or a login), tracking parameters dropped.
export const NETWORKS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X' },
  { key: 'youtube', label: 'YouTube' },
];

const HOST = {
  facebook: /^(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.com)$/,
  instagram: /^(?:www\.)?instagram\.com$/,
  linkedin: /^(?:[a-z]{2,3}\.|www\.)?linkedin\.com$/,
  x: /^(?:www\.|mobile\.)?(?:twitter\.com|x\.com)$/,
  youtube: /^(?:www\.|m\.)?youtube\.com$/,
};
const BASE = { facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com', linkedin: 'https://www.linkedin.com', x: 'https://x.com', youtube: 'https://www.youtube.com' };

const NOT_A_PAGE = {
  facebook: new Set(['sharer', 'sharer.php', 'share', 'share.php', 'dialog', 'plugins', 'tr', 'login', 'login.php', 'policies', 'privacy', 'help', 'l.php', 'watch', 'events', 'groups', 'hashtag', 'marketplace', 'gaming', 'stories', 'reel', 'reels', 'photo', 'photo.php', 'permalink.php', 'story.php', 'tr', 'public', 'home.php', 'recover', 'r.php']),
  instagram: new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct', 'about', 'legal', 'share', 'web', 'developer']),
  x: new Set(['intent', 'share', 'home', 'search', 'hashtag', 'i', 'login', 'explore', 'settings', 'privacy', 'tos', 'about', 'widgets.js', 'messages', 'notifications']),
};

// The address to keep for `network`, or null when `raw` is not a profile or page of that network.
export function cleanSocialUrl(network, raw) {
  if (!HOST[network] || typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (!HOST[network].test(u.hostname.toLowerCase())) return null;
  const seg = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s.replace(/%(?![0-9a-f]{2})/gi, '%25')));
  if (!seg.length || seg.some((s) => !/^[A-Za-z0-9._\-@+%]{1,80}$/.test(s))) return null;
  const first = seg[0].toLowerCase();
  let path;
  if (network === 'facebook') {
    if (first === 'profile.php') { const id = u.searchParams.get('id'); if (!/^\d{5,20}$/.test(id || '')) return null; return `${BASE.facebook}/profile.php?id=${id}`; }
    if (first === 'pages' && seg.length >= 2 && seg.length <= 3) path = seg.join('/');
    else if (seg.length === 1 && !NOT_A_PAGE.facebook.has(first)) path = seg[0];
    else return null;
  } else if (network === 'instagram') {
    if (seg.length !== 1 || NOT_A_PAGE.instagram.has(first)) return null;
    path = seg[0];
  } else if (network === 'x') {
    const h = seg[0].replace(/^@/, '');
    if (seg.length !== 1 || NOT_A_PAGE.x.has(h.toLowerCase()) || !/^\w{1,15}$/.test(h)) return null;
    path = h;
  } else if (network === 'linkedin') {
    if (!['company', 'in', 'school', 'showcase'].includes(first) || seg.length !== 2) return null;
    path = seg.join('/');
  } else { // youtube
    if (/^@/.test(seg[0]) && seg.length === 1) path = seg[0];
    else if (['channel', 'c', 'user'].includes(first) && seg.length === 2) path = seg.join('/');
    else return null;
  }
  if (path.length > 100) return null;
  return `${BASE[network]}/${path}`;
}

// `{ facebook, instagram, linkedin, x, youtube }` with only the valid addresses, in a fixed order; {} for anything else.
export function cleanSocial(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const { key } of NETWORKS) {
    const url = cleanSocialUrl(key, obj[key]);
    if (url) out[key] = url;
  }
  return out;
}
