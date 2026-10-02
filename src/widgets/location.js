// Lieu partagé par les briques Météo, Soleil et Lune.
// Valeur stockée : { mode: "auto" } ou { mode: "city", name, lat, lon }.

export const LOCATION_DEFAULT = { mode: "auto" };

/** Résout un lieu en coordonnées. Le mode automatique utilise la géolocalisation par adresse IP. */
export async function resolveLocation(loc, api) {
  if (loc?.mode === "city" && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    return { lat: loc.lat, lon: loc.lon, name: (loc.name || "").split(",")[0] };
  }
  try {
    const r = await api.httpJson("https://ipwho.is/?fields=success,latitude,longitude,city,region", 6 * 3600);
    if (r && r.success !== false && r.latitude != null) return { lat: +r.latitude, lon: +r.longitude, name: r.city || r.region || "" };
  } catch {}
  const r = await api.httpJson("https://get.geojs.io/v1/ip/geo.json", 6 * 3600);
  return { lat: +r.latitude, lon: +r.longitude, name: r.city || r.region || "" };
}

/** Recherche de villes (Open-Meteo, en français). */
export async function searchPlaces(q, api) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=fr&format=json`;
  const r = await api.httpJson(url, 86400);
  return (r?.results || []).map((p) => ({
    mode: "city",
    name: [p.name, p.admin1, p.country].filter(Boolean).join(", "),
    lat: p.latitude,
    lon: p.longitude,
  }));
}
