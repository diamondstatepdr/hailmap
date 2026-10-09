# HailMap

Nationwide live map of United States hail, wind, and tornado reports. Reports come from the National Weather Service, the Storm Prediction Center, and Iowa Environmental Mesonet local storm reports. Nearby reports of the same hazard are fused, with confidence ordered **NWS > spotter > MESH > community**. Hail size colors hail markers. Wind markers show a W and a speed color. Tornado markers show a T and an EF color when the office published one. Clusters of hail within about 45 km and 3 hours become a buffered hail swath. Wind and tornado reports do not become swaths. Counties can be shaded by Census ACS median household income.

The map opens on the last 7 days. SPC and IEM local storm reports are stored as NWS or spotter confidence, including public and mPING reports that an NWS office published. Community confidence is for file import, the community webhook, and in-app photo reports. SPC files used are `*_rpts_hail.csv`, `*_rpts_wind.csv`, and `*_rpts_torn.csv`. IEM local storm reports keep hail, thunderstorm and non-thunderstorm wind, and tornado types. Other LSR types are ignored.

HailMap does not scrape social networks. Spotter observations arrive through the spotter webhook. Community observations arrive through the community webhook, CSV/GeoJSON import, or a photo report submitted in the app.

## Local run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The first request syncs the live feeds (about 7 days) into SQLite. Until a feed responds, a small seed set is shown so the map is not empty.

```bash
npm test
npm run build
npm start
```

`npm start` listens on `0.0.0.0` and the `PORT` environment variable.

SQLite is created in `HAILMAP_DATA_DIR`, or in `.data/` when that variable is unset. Photo files are written to `$HAILMAP_DATA_DIR/photos/`. On Railway, set `HAILMAP_DATA_DIR=/data` so both the database and photos live on the volume and survive restarts. The bundled Census cache stays in `data/census/` and is not the database directory.

## Environment

| Variable | Purpose |
| --- | --- |
| `HAILMAP_DATA_DIR` | SQLite directory. Use `/data` on Railway. |
| `CENSUS_API_KEY` | Optional. Refreshes county median household income (ACS B19013). |
| `HAILMAP_MESH_URL` | Optional GeoJSON of MRMS MESH hail. Ingested at confidence `mesh`. |
| `HAILMAP_WEBHOOK_SECRET` | Required in production for `/api/webhooks/spotter` and `/api/webhooks/community`. Photo reports do not use this secret. |
| `HAILMAP_PHOTO_HOURLY_LIMIT` | Public photo reports per hashed client IP per hour. Default 8. |
| `HAILMAP_PHOTO_DAILY_LIMIT` | Public photo reports per hashed client IP per day. Default 30. |
| `HAILMAP_PHOTO_MAX_BYTES` | Max photo upload size, capped at 8 MB. Default 8388608. |
| `HAILMAP_USER_AGENT` | Contact string for the NWS API, the Census geocoder, and Nominatim. |
| `HAILMAP_TEAM_PASSCODE` | Shared passcode for Field notes, damage photos, and the watch list. Unset disables sign-in. |
| `HAILMAP_AUTH_SECRET` | Signs the session cookie. Falls back to the team passcode when unset. |
| `CAPACITOR_SERVER_URL` | HTTPS origin loaded by the Android WebView. |

## HTTP API

- `GET /api/reports` — fused reports for the last 7 days. A report with a photo includes `photoUrl`.
- `POST /api/reports` — public photo report. Multipart fields: `photo`, `lat`, `lon`, `sizeIn`, optional `remark`, `occurredAt`, `location`, `county`, `state`. Always stored as community. Rate-limited per hashed IP.
- `GET /api/photos/[id]` — the stored image. `id` is the file id without an extension.
- `GET /api/swaths` — GeoJSON swaths from those reports
- `GET /api/income` — county polygons with ACS median household income
- `GET /api/threats` — active NWS severe watches and warnings, plus the SPC Day 1 categorical outlook and significant-severe areas. Cached for about 10 minutes.
- `GET /api/health` — process check for Railway
- `GET /api/geocode?q=` — US address, city, or ZIP. Census geocoder first, Nominatim if Census has no match. Results are cached. `lat` and `lon` reverse-geocode a street name.
- `GET /api/place?lat=&lon=&radiusKm=&hours=` — property storm history and damage probability. `hours` is a map window (0.75, 1, 6, 24, 72, 168). `radiusKm` is 1–80.
- `GET /api/auth/session`, `POST /api/auth/session`, `DELETE /api/auth/session` — team sign-in. Body `{ "name", "passcode" }`.
- `GET /api/watch`, `POST /api/watch`, `DELETE /api/watch/[id]` — per-user address watch list.
- `GET /api/field/pins`, `POST /api/field/pins`, `PATCH /api/field/pins/[id]`, `DELETE /api/field/pins/[id]` — house pins (`damage`, `talked`, `away`, `lead`).
- `POST /api/field/pins/[id]/photos` — damage photo on a pin. Multipart `photo`, `damageType` (`hail`, `wind`, `roof`, `siding`, `vehicle`, `gutters`), optional `note` and `takenAt`. Same EXIF stripping and rate limits as community photos. Not shown as an official report.
- `GET /api/storm-reports`, `POST /api/storm-reports` — printable storm report. `GET /reports/[id]` is the page. Print or save as PDF from the browser.
- `POST /api/import` — CSV or GeoJSON (`lat`, `lon`, optional `size`, `time`, `location`, `county`, `state`, `remark`, `confidence`)
- `POST /api/webhooks/spotter` and `POST /api/webhooks/community` — JSON body `{ "lat", "lon", "size", "occurredAt", "location", "remark" }` with `Authorization: Bearer $HAILMAP_WEBHOOK_SECRET`

Imports are stored as community reports, or spotter when the file says so. They cannot claim NWS or MESH confidence. Official SPC and IEM reports cannot be stored as community. Photo reports are community only, even if the form asks for another rank.

The map pin is the latitude and longitude the user confirms. HailMap does not read GPS from the photo. JPEG, PNG, and WebP location metadata is removed before the file is saved under `$HAILMAP_DATA_DIR/photos/<uuid>.<ext>`. HEIC is stored as uploaded. Nearby official reports are not replaced: a photo stays on its own pin.

## Railway

The Railway project **HailMap** already exists for diamondstatepdr. Point a service at this repository.

1. Builder: Dockerfile (`railway.toml`). `nixpacks.toml` is included if you switch builders.
2. Attach a volume with mount path **`/data`**.
3. Set `HAILMAP_DATA_DIR=/data`. The image also sets this. Photos are stored in `/data/photos` on that volume.
4. Optionally set `CENSUS_API_KEY`, `HAILMAP_MESH_URL`, `HAILMAP_WEBHOOK_SECRET`, `HAILMAP_USER_AGENT`, `HAILMAP_TEAM_PASSCODE`, and `HAILMAP_AUTH_SECRET`.
5. Generate a public domain. Health check path is `/api/health`.
6. Set `CAPACITOR_SERVER_URL` to that **https** URL before building the Android release. Example shape: `https://<service>.up.railway.app`.

## Android (Play Console)

Package id: `com.hailmap.app`. The release app is an HTTPS-only WebView. Cleartext is off.

```bash
export CAPACITOR_SERVER_URL=https://YOUR-RAILWAY-DOMAIN
npm run android:setup
```

Create the upload keystore **outside git**. Keystores, `keystore.properties`, and `scripts/*keystore*.sh` are gitignored.

```bash
mkdir -p "$HOME/hailmap-keys"
keytool -genkeypair -v \
  -keystore "$HOME/hailmap-keys/upload-keystore.jks" \
  -alias hailmap \
  -keyalg RSA -keysize 2048 -validity 10000
```

In Android Studio, generate a signed App Bundle with that keystore. Play Console steps, listing copy, and the data-safety form are in [docs/play-listing.md](docs/play-listing.md) and [docs/data-safety.md](docs/data-safety.md). Publish the privacy policy at `https://YOUR-RAILWAY-DOMAIN/privacy`.

## Sign-in

Field notes, field photos, and the watch list belong to a name plus the team passcode (`HAILMAP_TEAM_PASSCODE`). The public map, address search, and damage score work without signing in. The name is the account: two people who type the same name share that field data. Notes are not published on the map. A storm report link is unlisted; field photos are included only when the person who generated it was signed in.

Set `HAILMAP_AUTH_SECRET` in production so the cookie key is not the passcode itself.

## Damage probability

The score is documented in `src/lib/probability.ts`. It is not a trained model, a roof inspection, or an insurance decision.

Each nearby report gets points from hail size, wind speed, or tornado rating, then multiplied by distance, recency, and source confidence (NWS 1, spotter 0.85, MESH 0.65, community 0.4). The strongest report is kept. Extra reports within 10 km add up to 12 points. A hail swath over the point adds coverage points. Active warnings are listed and are not scored, because a county warning is not a measurement at the address. Missing MESH data adds nothing.

Bands: 0–17 Low, 18–39 Moderate, 40–64 High, 65–100 Very High. The optional Damage areas layer scores the same model on a coarse grid.

## Address search

Search uses the US Census geocoder. If that returns no match, HailMap asks Nominatim with `HAILMAP_USER_AGENT`, at most about one request per second, and caches the result. There is no paid geocoder key.

## Later phase

Roof and property records are not in this build. `src/lib/seams.ts` records that flag as off so a later change can turn it on without inventing answers now.

## Map

Light theme is the default. Dark is a toggle and is remembered on the device. On a phone, Map, Storms, Addresses, Field, and Reports sit in a bottom bar. On a wide screen they sit in a side rail. Filters open in a sheet. Layer switches control reports, hail swaths, damage areas, NWS severe threats, the SPC Day 1 outlook, and the income choropleth. Threats and the outlook are on by default and draw underneath markers. State borders and names stay on the map. The site is a mobile PWA (`public/manifest.webmanifest`).

## Tests

Vitest covers hail size parsing (including SPC hundredths), wind and tornado LSR parsing, damage tags, dedupe/fusion (photo pins stay separate, different hazards stay separate), the damage score, address geocode parsing, field sign-in, photo storage, and swath clustering, hulls, and buffers.
