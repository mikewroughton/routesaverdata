#!/usr/bin/env node
/**
 * Downloads every station and price from the UK Fuel Finder API and writes <outDir>/stations.json
 * (plus a small index.html). Run by .github/workflows/publish.yml every 30 minutes.
 *
 * Env:
 *   FUEL_FINDER_CLIENT_ID, FUEL_FINDER_CLIENT_SECRET  (required; repository secrets in CI)
 *   FUEL_FINDER_URL   base URL, default https://www.fuel-finder.service.gov.uk/api/v1
 *   MIN_STATIONS      refuse to publish below this many stations (default 5000)
 *
 * API limits: 100 requests a minute and one at a time per client, so batches are fetched sequentially.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildFeed, checkFeed, joinStations, LICENCE, recordsOf } from './feed.mjs';

const BASE = (process.env.FUEL_FINDER_URL ?? 'https://www.fuel-finder.service.gov.uk/api/v1').replace(/\/$/, '');
const MIN_STATIONS = Number(process.env.MIN_STATIONS ?? 5000);
const MAX_BATCHES = 60;
const USER_AGENT = 'RouteSaverData/1 (+https://github.com/mikewroughton/routesaverdata)';

async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...init.headers },
      signal: AbortSignal.timeout(60_000),
    });
    // Back off on rate limiting and transient server errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (attempt + 1);
      console.warn(`${res.status} from ${url}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, body };
  }
}

async function token(clientId, clientSecret) {
  const { status, body } = await request(`${BASE}/oauth/generate_access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  const t = body?.data?.access_token ?? body?.access_token;
  if (status >= 400 || !t) throw new Error(`Token request failed (${status}): ${JSON.stringify(body)?.slice(0, 300)}`);
  return t;
}

async function allBatches(endpoint, accessToken) {
  const out = [];
  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const { status, body } = await request(`${BASE}${endpoint}?batch-number=${batch}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (status === 404) break; // past the last batch
    if (status >= 400) throw new Error(`${endpoint} batch ${batch} failed (${status}): ${JSON.stringify(body)?.slice(0, 300)}`);
    const records = recordsOf(body);
    out.push(...records);
    console.log(`${endpoint} batch ${batch}: ${records.length}`);
    if (records.length < 500) break;
  }
  return out;
}

function indexHtml(feed) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RouteSaver fuel price feed</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}code{background:#f0f0f3;padding:.1em .3em;border-radius:4px}</style>
</head><body>
<h1>RouteSaver fuel price feed</h1>
<p>${feed.count.toLocaleString('en-GB')} UK fuel stations, updated ${feed.generatedAt}.</p>
<p>Data: <a href="stations.json"><code>stations.json</code></a> (prices in pence per litre).</p>
<p>${LICENCE}</p>
</body></html>
`;
}

async function main() {
  const outDir = process.argv[2] ?? 'public';
  const { FUEL_FINDER_CLIENT_ID: id, FUEL_FINDER_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('Set FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET');

  const accessToken = await token(id, secret);
  const pfs = await allBatches('/pfs', accessToken);
  const prices = await allBatches('/pfs/fuel-prices', accessToken);
  const feed = buildFeed(joinStations(pfs, prices));
  console.log(`${pfs.length} forecourts, ${prices.length} price records -> ${feed.count} stations in the feed`);

  const problems = checkFeed(feed, MIN_STATIONS);
  if (problems.length) throw new Error(`Not publishing: ${problems.join('; ')}`);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'stations.json'), JSON.stringify(feed));
  await writeFile(path.join(outDir, 'index.html'), indexHtml(feed));
  await writeFile(path.join(outDir, '.nojekyll'), '');
  console.log(`Wrote ${path.join(outDir, 'stations.json')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
