// Extracts a firm's written description from its hand-built page (<div class="article">...</div>).
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', middot: '·', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', acirc: 'â', ocirc: 'ô', icirc: 'î', ucirc: 'û', euml: 'ë', iuml: 'ï' };
const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&([a-z]+);/gi, (m, n) => (n in NAMED ? NAMED[n] : (() => { throw new Error('unknown entity ' + m); })()));

export function aboutFromPage(slug) {
  const path = new URL(`firms/${slug}.html`, root);
  if (!existsSync(path)) return null;
  const m = readFileSync(path, 'utf8').match(/<div class="article">([\s\S]*?)<\/div>/);
  if (!m) return null;
  const text = decode(m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trim();
  return text && text.length <= 2000 ? text : null;
}
