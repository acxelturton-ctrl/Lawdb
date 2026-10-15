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

// Rough middle of each province or territory: the last resort for a pin.
const PROVINCE_CENTRES = { AB: [53.55, -113.49], BC: [49.28, -123.12], MB: [49.9, -97.14], NB: [45.96, -66.64], NL: [47.56, -52.71], NS: [44.65, -63.58], NT: [62.45, -114.37], NU: [63.75, -68.52], ON: [43.65, -79.38], PE: [46.24, -63.13], QC: [46.81, -71.21], SK: [50.45, -104.62], YT: [60.72, -135.05] };
const inCanada = (lat, lng) => lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52;

// A map position for a listing, so nobody has to look up coordinates by hand: the exact address when it can be found, otherwise the middle of
// the city (the average of the firms already listed there, or a city lookup, or the province). `approx` says the pin is not the exact address.
export async function placeFor(env, { address, city, province }) {
  const exact = address ? await geocode(env, { address, city, province }) : null;
  if (exact) return { ...exact, approx: false };
  try {
    const near = await env.DB.prepare("SELECT AVG(lat) AS lat, AVG(lng) AS lng, COUNT(*) AS n FROM firms WHERE status = 'live' AND city = ? AND province = ? AND lat IS NOT NULL AND lng IS NOT NULL").bind(city, province).first();
    if (near && near.n > 0 && inCanada(near.lat, near.lng)) return { lat: near.lat, lng: near.lng, approx: true };
  } catch { /* fall through */ }
  const town = await geocode(env, { city, province });
  if (town) return { ...town, approx: true };
  const c = PROVINCE_CENTRES[String(province).toUpperCase()];
  return c ? { lat: c[0], lng: c[1], approx: true } : null;
}
