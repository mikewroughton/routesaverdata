#!/usr/bin/env node
/**
 * Local stand-in for the Fuel Finder API, for testing without credentials. Serves ~9,000 made-up stations
 * scattered over Great Britain with made-up prices, in the real API's shape (OAuth token, then
 * /pfs and /pfs/fuel-prices in batches of 500). Any client ID / secret is accepted.
 *
 *   node scripts/mock-fuel-finder.mjs            # listens on http://127.0.0.1:8787
 *   FUEL_FINDER_URL=http://127.0.0.1:8787/api/v1 FUEL_FINDER_CLIENT_ID=x FUEL_FINDER_CLIENT_SECRET=x \
 *     node scripts/build-feed.mjs public
 *
 * The prices are NOT real.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const COUNT = 9000;
const BATCH = 500;

// Deterministic pseudo-random numbers so every run serves the same stations.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const brands = [
  ['TESCO', true], ['ASDA', true], ['SAINSBURYS', true], ['MORRISONS', true],
  ['BP', false], ['SHELL', false], ['ESSO', false], ['TEXACO', false], ['JET', false], ['GULF', false],
];

const pfs = [];
const prices = [];
for (let i = 0; i < COUNT; i++) {
  const [brand, supermarket] = brands[Math.floor(rand() * brands.length)];
  const lat = 50.1 + rand() * 8.4;
  const lon = -5.6 + rand() * 7.3;
  const id = `mock-${i.toString().padStart(5, '0')}`;
  const motorway = rand() < 0.04;
  pfs.push({
    node_id: id,
    trading_name: `${brand[0]}${brand.slice(1).toLowerCase()} ${motorway ? 'Services' : 'Filling Station'} ${i}`,
    brand_name: brand,
    temporary_closure: rand() < 0.01,
    permanent_closure: null,
    is_motorway_service_station: motorway,
    is_supermarket_service_station: supermarket,
    location: {
      address_line_1: `${1 + Math.floor(rand() * 200)} Mock Road`,
      city: 'Mocktown',
      country: 'England',
      postcode: `MK${1 + Math.floor(rand() * 20)} ${Math.floor(rand() * 9)}AB`,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lon.toFixed(6)),
    },
  });
  const e10 = 128 + rand() * 20 - (supermarket ? 4 : 0) + (motorway ? 18 : 0);
  const fuel = [
    { fuel_type: 'E10', price: e10 },
    { fuel_type: 'E5', price: e10 + 10 + rand() * 6 },
    { fuel_type: 'B7_STANDARD', price: e10 + 3 + rand() * 6 },
  ];
  if (!supermarket && rand() < 0.5) fuel.push({ fuel_type: 'B7_PREMIUM', price: e10 + 18 + rand() * 6 });
  prices.push({
    node_id: id,
    trading_name: pfs[i].trading_name,
    public_phone_number: null,
    fuel_prices: fuel.map((f) => ({
      ...f,
      price: f.price.toFixed(1),
      price_last_updated: new Date().toISOString(),
    })),
  });
}

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(req.method, url.pathname + url.search);
    if (req.method === 'POST' && url.pathname === '/api/v1/oauth/generate_access_token') {
      return send(res, 200, { success: true, data: { access_token: 'mock-token', expires_in: 3600, token_type: 'Bearer' } });
    }
    if (req.headers.authorization !== 'Bearer mock-token') {
      return send(res, 403, { success: false, data: { error: 'Unauthorized', message: 'Invalid or expired token' } });
    }
    const list = url.pathname === '/api/v1/pfs' ? pfs : url.pathname === '/api/v1/pfs/fuel-prices' ? prices : null;
    if (!list) return send(res, 404, { success: false, message: 'Not found' });
    const batch = Number(url.searchParams.get('batch-number') ?? 1);
    const slice = list.slice((batch - 1) * BATCH, batch * BATCH);
    if (slice.length === 0) return send(res, 404, { success: false, message: 'Invalid batch number' });
    return send(res, 200, { data: slice });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Mock Fuel Finder on http://127.0.0.1:${PORT}/api/v1 (${COUNT} made-up stations)`));
