// POST /api/ai/match: LawDB AI, the help bot on every public page. Body: { messages: [{role:'user', content}], context, pick }. See src/lib/ai-match.js.
import { json, readJson, HttpError, NO_STORE } from '../lib/http.js';
import { sha256Hex } from '../lib/crypto.js';
import { answer } from '../lib/ai-match.js';
import { bump } from '../lib/counter.js';

const PER_VISITOR_HOUR = 30;      // requests one visitor can make per hour
const DEFAULT_DAILY_MODEL_CAP = 3000; // model calls per day across the site; past it the keyword matcher answers (it costs nothing)

export async function match({ request, env }) {
  const body = await readJson(request, 6000);
  const ip = await sha256Hex('ai:' + (request.headers.get('cf-connecting-ip') || 'local'));
  const hour = String(new Date().getUTCHours());
  if ((await bump(env, 'ai-visitor', ip.slice(0, 20), hour)) > PER_VISITOR_HOUR) throw new HttpError(429, 'Too many questions for now. Please try again in a little while.');
  const cap = Number(env.AI_DAILY_CAP) || DEFAULT_DAILY_MODEL_CAP;
  const useModel = !!env.AI && (await bump(env, 'ai-model', '', '')) <= cap;
  const out = await answer(useModel ? env : { ...env, AI: undefined }, body);
  return json(out, 200, NO_STORE);
}
