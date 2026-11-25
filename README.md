# routesaverdata

Publishes the UK fuel price feed used by the [RouteSaver](https://github.com/mikewroughton) app:

**https://mikewroughton.github.io/routesaverdata/stations.json**

A GitHub Actions workflow downloads every forecourt and price from the government's
[Fuel Finder](https://www.gov.uk/guidance/access-the-latest-fuel-prices-and-forecourt-data-via-api-or-email) API
twice an hour, keeps open stations with plausible prices, and publishes one JSON file on GitHub Pages. The app
only ever reads that file, so the Fuel Finder credentials stay in this repository's secrets and never reach a phone,
and one download serves every user (the API allows 100 requests a minute per client; a full refresh is ~38).

Contains public sector information licensed under the Open Government Licence v3.0.

## One-time setup

1. **Fuel Finder credentials.** Sign in to the [Fuel Finder developer portal](https://www.developer.fuel-finder.service.gov.uk/)
   with GOV.UK One Login, register as an *information recipient*, and create an application for the **live**
   service. Note the client ID and client secret.
2. **Repository secrets.** On GitHub: *Settings → Secrets and variables → Actions → New repository secret*:
   - `FUEL_FINDER_CLIENT_ID`
   - `FUEL_FINDER_CLIENT_SECRET`
3. **Pages.** *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
4. **Push** this repository to `main`. The push runs the workflow once; after that it runs at :07 and :37 every hour.
   You can also run it by hand: *Actions → Publish fuel prices → Run workflow*.

Check it worked: the workflow's *Build feed* step logs the batch counts, and the URL above returns JSON.

## How it behaves

- **Fails safe:** if the API is down, the secrets are wrong, or the result looks broken (fewer than 5,000 stations,
  or most without an E10 price), the run fails and the previous feed stays live. GitHub emails you about failed runs.
- **Schedule:** GitHub may run scheduled jobs a few minutes late. Scheduled workflows in public repos are switched
  off after 60 days without activity, so `keepalive.yml` commits a timestamp on the 1st of each month.
- **Limits:** public repositories get unlimited free Actions minutes; each run takes about a minute.

## Feed format (version 1)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-11-25T14:07:33.495Z",
  "source": "UK Fuel Finder",
  "licence": "Contains public sector information licensed under the Open Government Licence v3.0 (UK Fuel Finder).",
  "count": 8123,
  "stations": [
    {
      "id": "…", "name": "Tesco Extra", "brand": "TESCO", "address": "1 High St, Newmarket", "postcode": "CB8 1AA",
      "lat": 52.24123, "lon": 0.4, "motorway": false, "supermarket": true,
      "prices": { "E10": 139.9, "E5": 151.9, "B7_STANDARD": 145.9 }   // pence per litre
    }
  ]
}
```

Fuel types are Fuel Finder's codes (`E10`, `E5`, `B7_STANDARD`, `B7_PREMIUM`, …). Prices under 80p or over £3 are
dropped as data errors. A breaking change to the format bumps `version`.

## Local development

```bash
npm test                                   # unit tests (node:test, no dependencies)
npm run mock                               # fake Fuel Finder API on :8787 with made-up prices
FUEL_FINDER_URL=http://127.0.0.1:8787/api/v1 FUEL_FINDER_CLIENT_ID=x FUEL_FINDER_CLIENT_SECRET=x \
  MIN_STATIONS=1000 npm run build          # writes public/stations.json
```

With real credentials, `FUEL_FINDER_CLIENT_ID=… FUEL_FINDER_CLIENT_SECRET=… npm run build` builds the real feed
locally. Never commit credentials; use the repository secrets.
