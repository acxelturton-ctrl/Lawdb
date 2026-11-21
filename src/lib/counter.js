// Counts one thing for today in stats_daily and says how many there have been (one write per count). Used for the throttles on LawDB AI.
export async function bump(env, kind, k1, k2) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    'INSERT INTO stats_daily (day, kind, k1, k2, n) VALUES (?, ?, ?, ?, 1) ON CONFLICT (day, kind, k1, k2) DO UPDATE SET n = n + 1 RETURNING n'
  ).bind(day, kind, k1, k2).first();
  return row ? row.n : 1;
}
