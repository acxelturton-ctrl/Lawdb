// Best-effort address lookup for owner-submitted listings (OpenStreetMap Nominatim, free, no key).
// Returns { lat, lng } inside Canada, or null. Never throws: when it fails the admin enters the
// coordinates while approving. Skipped in local development so tests never depend on the internet.
export async function geocode(env, { address, city, province }) {
  if (env.DEV_ECHO_LINK === '1') return null;
  try {
    const q = [address, city, province, 'Canada'].filter(Boolean).join(', ');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(q)}`, {
      headers: { 'user-agent': 'LawDB.ca listing verification (info@lawdb.ca)', accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const hit = (await res.json())[0];
    const lat = Number(hit?.lat), lng = Number(hit?.lon);
    return lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52 ? { lat, lng } : null;
  } catch {
    return null;
  }
}
