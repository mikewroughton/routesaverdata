/**
 * Pure helpers for turning Fuel Finder API records into the RouteSaver feed. No network, no I/O.
 *
 * Feed format (version 1), served as stations.json:
 *   {
 *     "version": 1,
 *     "generatedAt": "2026-11-25T14:07:00.000Z",
 *     "source": "UK Fuel Finder", "licence": "...OGL v3.0...",
 *     "count": 8123,
 *     "stations": [
 *       { "id", "name", "brand", "address", "postcode", "lat", "lon", "motorway", "supermarket",
 *         "prices": { "E10": 139.9, "B7_STANDARD": 145.9 } }   // pence per litre
 *     ]
 *   }
 */

export const FEED_VERSION = 1;
export const LICENCE =
  'Contains public sector information licensed under the Open Government Licence v3.0 (UK Fuel Finder).';

/** Prices outside this range are data errors (the RAC found sub-2p and £15+ entries in early data). */
const MIN_PENCE = 80;
const MAX_PENCE = 300;

/** Normalise a price to pence per litre; null if missing or implausible. */
export function toPence(raw) {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (n == null || !Number.isFinite(n)) return null;
  const pence = n < 10 ? n * 100 : n; // some retailers report pounds
  return pence >= MIN_PENCE && pence <= MAX_PENCE ? Math.round(pence * 10) / 10 : null;
}

/** API responses are either a bare array or { data: [...] }. */
export function recordsOf(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.data) ? body.data : [];
}

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Open stations with coordinates and at least one plausible price. */
export function joinStations(pfs, prices) {
  const priceById = new Map();
  for (const r of prices) {
    if (!r?.node_id) continue;
    const entry = {};
    for (const fp of r.fuel_prices ?? []) {
      const p = toPence(fp?.price);
      if (fp?.fuel_type && p !== null) entry[String(fp.fuel_type).toUpperCase()] = p;
    }
    priceById.set(r.node_id, entry);
  }
  const out = [];
  for (const r of pfs) {
    if (!r?.node_id || r.temporary_closure || r.permanent_closure) continue;
    const lat = Number(r.location?.latitude);
    const lon = Number(r.location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    // The UK and its crown dependencies; anything else is a bad coordinate.
    if (lat < 49 || lat > 61.5 || lon < -9 || lon > 2.5) continue;
    const stationPrices = priceById.get(r.node_id);
    if (!stationPrices || Object.keys(stationPrices).length === 0) continue;
    out.push({
      id: r.node_id,
      name: r.trading_name?.trim() || r.brand_name?.trim() || 'Fuel station',
      brand: r.brand_name?.trim() ?? '',
      address: [r.location?.address_line_1, r.location?.city].filter(Boolean).join(', '),
      postcode: r.location?.postcode ?? '',
      lat: round(lat, 5),
      lon: round(lon, 5),
      motorway: !!r.is_motorway_service_station,
      supermarket: !!r.is_supermarket_service_station,
      prices: stationPrices,
    });
  }
  return out;
}

export function buildFeed(stations, now = new Date()) {
  return {
    version: FEED_VERSION,
    generatedAt: now.toISOString(),
    source: 'UK Fuel Finder',
    licence: LICENCE,
    count: stations.length,
    stations,
  };
}

/** Refuse to publish an obviously broken feed (the last good one stays live on Pages). */
export function checkFeed(feed, minStations) {
  const problems = [];
  if (feed.count < minStations) problems.push(`only ${feed.count} stations (expected at least ${minStations})`);
  const withE10 = feed.stations.filter((s) => typeof s.prices.E10 === 'number').length;
  if (feed.count > 0 && withE10 / feed.count < 0.5) problems.push(`only ${withE10} stations have an E10 price`);
  return problems;
}
