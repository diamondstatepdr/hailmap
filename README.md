# HailMap

Nationwide live map of United States hail. Reports come from the National Weather Service, the Storm Prediction Center, and Iowa Environmental Mesonet local storm reports. Nearby reports are fused, with confidence ordered **NWS > spotter > MESH > community**. Size colors the markers. Clusters within about 45 km and 3 hours become a buffered hail swath. Counties can be shaded by Census ACS median household income.

The map opens on the last 7 days. SPC and IEM local storm reports are stored as NWS or spotter confidence, including public and mPING reports that an NWS office published. Community confidence is for file import, the community webhook, and in-app photo reports.

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
| `HAILMAP_USER_AGENT` | Contact string for the NWS API. |
| `CAPACITOR_SERVER_URL` | HTTPS origin loaded by the Android WebView. |

## HTTP API

- `GET /api/reports` — fused reports for the last 7 days. A report with a photo includes `photoUrl`.
- `POST /api/reports` — public photo report. Multipart fields: `photo`, `lat`, `lon`, `sizeIn`, optional `remark`, `occurredAt`, `location`, `county`, `state`. Always stored as community. Rate-limited per hashed IP.
- `GET /api/photos/[id]` — the stored image. `id` is the file id without an extension.
- `GET /api/swaths` — GeoJSON swaths from those reports
- `GET /api/income` — county polygons with ACS median household income
- `GET /api/health` — process check for Railway
- `POST /api/import` — CSV or GeoJSON (`lat`, `lon`, optional `size`, `time`, `location`, `county`, `state`, `remark`, `confidence`)
- `POST /api/webhooks/spotter` and `POST /api/webhooks/community` — JSON body `{ "lat", "lon", "size", "occurredAt", "location", "remark" }` with `Authorization: Bearer $HAILMAP_WEBHOOK_SECRET`

Imports are stored as community reports, or spotter when the file says so. They cannot claim NWS or MESH confidence. Official SPC and IEM reports cannot be stored as community. Photo reports are community only, even if the form asks for another rank.

The map pin is the latitude and longitude the user confirms. HailMap does not read GPS from the photo. JPEG, PNG, and WebP location metadata is removed before the file is saved under `$HAILMAP_DATA_DIR/photos/<uuid>.<ext>`. HEIC is stored as uploaded. Nearby official reports are not replaced: a photo stays on its own pin.

## Railway

The Railway project **HailMap** already exists for diamondstatepdr. Point a service at this repository.

1. Builder: Dockerfile (`railway.toml`). `nixpacks.toml` is included if you switch builders.
2. Attach a volume with mount path **`/data`**.
3. Set `HAILMAP_DATA_DIR=/data`. The image also sets this. Photos are stored in `/data/photos` on that volume.
4. Optionally set `CENSUS_API_KEY`, `HAILMAP_MESH_URL`, `HAILMAP_WEBHOOK_SECRET`, and `HAILMAP_USER_AGENT`.
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

## Map

Light theme is the default. Dark is a toggle and is remembered on the device. Filters open in a bottom sheet. Layer switches control hail points, swaths, and the income choropleth. The site is a mobile PWA (`public/manifest.webmanifest`).

## Tests

Vitest covers hail size parsing (including SPC hundredths), damage tags, dedupe/fusion (photo pins stay separate), photo storage, and swath clustering, hulls, and buffers.
