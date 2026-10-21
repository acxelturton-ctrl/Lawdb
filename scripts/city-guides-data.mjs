// Reads every province file in data/city-guides/ into one object keyed by city page directory ('manitoba/winnipeg').
import { readFileSync, readdirSync } from 'node:fs';

export function loadGuides() {
  const out = {};
  for (const f of readdirSync('data/city-guides').filter((x) => x.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(`data/city-guides/${f}`, 'utf8'));
    for (const [key, g] of Object.entries(data)) {
      if (key.startsWith('_')) continue;
      if (out[key]) throw new Error(`${key} is in two guide files`);
      out[key] = g;
    }
  }
  return out;
}
