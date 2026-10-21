# Swathline

Nationwide live map of United States hail, wind, and tornado reports. Reports come from the National Weather Service, the Storm Prediction Center, and Iowa Environmental Mesonet local storm reports. Nearby reports of the same hazard are fused, with confidence ordered **NWS > spotter > MESH > community**. Hail size colors hail markers. Wind markers use a wind glyph and a speed color. Tornado markers use a funnel glyph and an EF color when the office published one. Clusters of hail within about 45 km and 3 hours become a buffered report swath. Wind and tornado reports do not become swaths. A separate radar layer draws NOAA MRMS MESH swaths (estimated hail size) for the last hour, the last 24 hours, the last 3 or 7 days, or a selected past date. Counties can be shaded by Census ACS median household income.

The map opens on the last 7 days. SPC and IEM local storm reports are stored as NWS or spotter confidence, including public and mPING reports that an NWS office published. Community confidence is for file import, the community webhook, and in-app photo reports. SPC files used are `*_rpts_hail.csv`, `*_rpts_wind.csv`, and `*_rpts_torn.csv`. IEM local storm reports keep hail, thunderstorm and non-thunderstorm wind, and tornado types. Other LSR types are ignored.

Phone alerts use the Web Push API. A service worker asks the browser for a subscription, and the server checks radar hail, spotter reports, and NWS warnings every few minutes. Watch areas belong to that subscription, not to a team account. Add Swathline to the iPhone Home Screen (iOS 16.4 or newer) before turning alerts on. The same worker and VAPID keys work in Android Chrome and inside a Play Store Trusted Web Activity.

Swathline does not scrape social networks. Spotter observations arrive through the spotter webhook. Community observations arrive through the community webhook, CSV/GeoJSON import, or a photo report submitted in the app.

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
| `HAILMAP_MESH_URL` | Optional GeoJSON of extra MESH points, ingested at confidence `mesh`. The radar swath layer does not use it. |
| `HAILMAP_WEBHOOK_SECRET` | Required in production for `/api/webhooks/spotter` and `/api/webhooks/community`. Photo reports do not use this secret. |
| `HAILMAP_PHOTO_HOURLY_LIMIT` | Public photo reports per hashed client IP per hour. Default 8. |
| `HAILMAP_PHOTO_DAILY_LIMIT` | Public photo reports per hashed client IP per day. Default 30. |
| `HAILMAP_PHOTO_MAX_BYTES` | Max photo upload size, capped at 8 MB. Default 8388608. |
| `HAILMAP_USER_AGENT` | Contact string for the NWS API, the Census geocoder, and Nominatim. |
| `HAILMAP_TEAM_PASSCODE` | Shared passcode for Field notes, damage photos, and the watch list. Unset disables sign-in. |
| `HAILMAP_AUTH_SECRET` | Signs the session cookie. Falls back to the team passcode when unset. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional Web Push keys. When unset, the first boot writes `vapid.json` in the data directory. |
| `VAPID_SUBJECT` | `mailto:` or `https:` contact on each push. Defaults to the project mailbox. |
| `HAILMAP_ALERT_INTERVAL_MS` | Alert loop interval. Default 3 minutes, clamped between 2 and 5. |
| `HAILMAP_HISTORY_BACKFILL` | Set to `0` to skip the background fill of SPC daily files after the annual severe-weather database. |
| `HAILMAP_MESH_BACKFILL` | Set to `1` to cache one past MESH day every 20 seconds. Leave unset on a small volume. |
| `CAPACITOR_SERVER_URL` | HTTPS origin loaded by the Android WebView. |

## HTTP API

- `GET /api/reports` — fused reports for the last 7 days. A report with a photo includes `photoUrl`.
- `POST /api/reports` — public photo report. Multipart fields: `photo`, `lat`, `lon`, `sizeIn`, optional `remark`, `occurredAt`, `location`, `county`, `state`. Always stored as community. Rate-limited per hashed IP.
- `GET /api/photos/[id]` — the stored image. `id` is the file id without an extension.
- `GET /api/swaths` — GeoJSON swaths from those reports
- `GET /api/mesh?hours=` or `GET /api/mesh?date=YYYY-MM-DD` — NOAA MRMS MESH hail swaths. `hours` follows the map windows (last hour for Live, 1 hour, and 6 hours; last 24 hours; daily composite for 3 and 7 days). A date uses that day’s 24-hour maximum. Results are cached under `$HAILMAP_DATA_DIR/mesh`.
- `GET /api/honey?date=YYYY-MM-DD&west=&south=&east=&north=` or `hours=` instead of `date` — Money Hole ranks for that storm day inside the map view. Optional `lat` and `lon` set the distance origin. Targets come from OpenStreetMap (dealerships, large parking lots, apartments, malls, fleet and rental yards) and Census ACS housing units. Cached under `$HAILMAP_DATA_DIR/honey`. A wide view asks you to zoom in. `status` is `partial` while OpenStreetMap or Census tiles are still loading, and `complete` when the ranking is finished. A partial response is not a finished list. The server also warms lots and home counts around recent hail days, paced for Overpass, and stores them on that same volume.
- `GET /api/replay?date=YYYY-MM-DD&west=&south=&east=&north=` — one convective day prepared for playback. Returns 15-minute frame times, spotter reports, and archived severe-thunderstorm and tornado warning polygons inside the box. Reports come from the history index when that day is already stored, otherwise from that day’s SPC CSV. Warnings come from the IEM storm-based warning archive.
- `GET /api/replay/frame?date=&at=&west=&south=&east=&north=` — radar for one replay time. The swath is MRMS `MESH_Max_1440min` minus the 12:00 UTC baseline, so hail builds through the day. A brighter pulse is the instantaneous MESH scan nearest that time. Scans are cached under `$HAILMAP_DATA_DIR/mesh/replay`.
- `GET /api/mesh/at?lat=&lon=&hours=` — radar-estimated maximum hail at a point for each storm date in the window
- `POST /api/dealers` — car dealerships and named auto lots inside a swath polygon, from OpenStreetMap
- `POST /api/forecast` — storm-to-cash estimate for a swath or Money Hole. Exposure is Census ACS housing units and vehicles inside each hail band, or the Money Hole count when tract centroids miss the spot. Dollars are exposure times a damage share times a ticket, shown as a range and labeled an estimate. Each band also shows its measured area in square miles. `GET /api/forecast/prices` and `POST /api/forecast/prices` store the team's per-car and per-roof prices. Sources and default rates live in `src/lib/forecast-sources.ts`.
- `GET /api/income` — county polygons with ACS median household income
- `GET /api/threats` — active NWS severe watches and warnings, plus the SPC Day 1 categorical outlook and significant-severe areas. Cached for about 10 minutes.
- `GET /api/health` — process check for Railway
- `GET /api/geocode?q=` — US address, city, or ZIP. Census geocoder first, Nominatim if Census has no match. Results are cached. `lat` and `lon` reverse-geocode a street name.
- `GET /api/place?lat=&lon=&radiusKm=&hours=` — property storm history and damage probability for a live map window. `hours` is 0.75, 1, 6, 24, 72, or 168. `radiusKm` is 1–80.
- `GET /api/history/reports?start=&end=&west=&south=&east=&north=` — hail, wind, and tornado reports for a map view. Dates can go back to 1950. Long ranges come back as clusters.
- `GET /api/history/days?start=&end=&west=&south=&east=&north=` — hail dates in that view, largest hail first, with counts and any cached radar maximum.
- `GET /api/history/place?lat=&lon=&radiusKm=&years=` — address history. `years` defaults to 2 (max 80). `start` and `end` override it. Optional `scoreDate` picks which storm the damage score uses.
- `GET /api/history/coverage` — probed archive start dates, index counts, and bytes under the history directory. `?build=1` builds the SPC index first.
- `GET /api/auth/session`, `POST /api/auth/session`, `DELETE /api/auth/session` — team sign-in. Body `{ "name", "passcode" }`.
- `GET /api/watch`, `POST /api/watch`, `DELETE /api/watch/[id]` — per-user address watch list.
- `GET /api/alerts/vapid` — public VAPID key for the browser Push API.
- `POST /api/alerts/subscribe`, `DELETE /api/alerts/subscribe` — save or remove this phone's push subscription. No account. Later calls send `x-hailmap-device`.
- `GET /api/alerts/state`, `PATCH /api/alerts/settings` — watch areas, inbox, quiet hours, and the last GPS fix used by Near me.
- `GET /api/alerts/areas`, `POST /api/alerts/areas`, `PATCH /api/alerts/areas/[id]`, `DELETE /api/alerts/areas/[id]` — a saved address or map point with a 5/10/25/50 mile radius, a whole state, or Near me. Each area has a hail-size threshold and toggles for radar hail, spotter reports, NWS hail warnings, and an optional SPC outlook.
- `POST /api/alerts/test` — send one test notification to this phone.
- `GET /api/alerts/health` — VAPID source, subscription counts, and the last alert-loop run.
- `GET /api/alerts/replay?date=YYYY-MM-DD&lat=&lon=&radiusMi=&state=&minSizeIn=` — what the engine would have sent for a past convective day. It does not send pushes.
- `GET /api/field/pins`, `POST /api/field/pins`, `PATCH /api/field/pins/[id]`, `DELETE /api/field/pins/[id]` — house pins (`damage`, `talked`, `away`, `lead`).
- `POST /api/field/pins/[id]/photos` — damage photo on a pin. Multipart `photo`, `damageType` (`hail`, `wind`, `roof`, `siding`, `vehicle`, `gutters`), optional `note` and `takenAt`. Same EXIF stripping and rate limits as community photos. Not shown as an official report.
- `GET /api/storm-reports`, `POST /api/storm-reports` — printable storm report. `GET /reports/[id]` is the page. Print or save as PDF from the browser. Address reports include MRMS hail size by date, nearby NWS warnings, and a map snapshot. A body with `start` and `end` uses the multi-year archive: date-of-loss candidates are listed, and the damage score is the selected `scoreDate` or the strongest hail day.
- `POST /api/import` — CSV or GeoJSON (`lat`, `lon`, optional `size`, `time`, `location`, `county`, `state`, `remark`, `confidence`)
- `POST /api/webhooks/spotter` and `POST /api/webhooks/community` — JSON body `{ "lat", "lon", "size", "occurredAt", "location", "remark" }` with `Authorization: Bearer $HAILMAP_WEBHOOK_SECRET`

Imports are stored as community reports, or spotter when the file says so. They cannot claim NWS or MESH confidence. Official SPC and IEM reports cannot be stored as community. Photo reports are community only, even if the form asks for another rank.

The map pin is the latitude and longitude the user confirms. Swathline does not read GPS from the photo. JPEG, PNG, and WebP location metadata is removed before the file is saved under `$HAILMAP_DATA_DIR/photos/<uuid>.<ext>`. HEIC is stored as uploaded. Nearby official reports are not replaced: a photo stays on its own pin.

## Railway

The Railway project **HailMap** already exists for diamondstatepdr. Point a service at this repository. The product name is Swathline.

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

## Money holes

For one storm day — Live through 24 hours, or a day from the hail calendar — Money Holes rank where a tech should go first. The Money Hole score multiplies hail size, target density, recency, and confidence. Hail size is the MRMS MESH sample at the stop, raised when a nearby spotter or NWS report is larger. A spotter or NWS report that agrees with radar scores higher than radar alone. Recency favors the latest hail that day, and a live window favors hail that just fell. Density is estimated vehicles (PDR) or homes (Roofing). Parking vehicles are lot area divided by about 30 m². Homes are Census ACS housing units, with named apartment buildings when a tract is not the useful stop.

The list shows the name or neighborhood, hail size, estimated vehicles or homes, a 0–100 score, and distance. Tap a row to zoom. PDR and Roofing are a toggle. The heat layer is optional. OpenStreetMap requests are cached on the data volume and paced so a metro view does not hammer Overpass. The first look at a city fills in over a few requests.

## Damage probability

The score is documented in `src/lib/probability.ts`. It is not a trained model, a roof inspection, or an insurance decision.

Each nearby report gets points from hail size, wind speed, or tornado rating, then multiplied by distance, recency, and source confidence (NWS 1, spotter 0.85, MESH 0.65, community 0.4). The strongest report is kept. Extra reports within 10 km add up to 12 points. A hail swath over the point adds coverage points. NOAA MRMS MESH at the address is added on the same hail-size scale: 1 in or larger is above Low, and 2 in or larger is High, then blended with the spotter, wind, and tornado points. Active warnings are listed and are not scored, because a county warning is not a measurement at the address. Missing radar data adds nothing.

Bands: 0–17 Low, 18–39 Moderate, 40–64 High, 65–100 Very High. The optional Damage areas layer scores the same model on a coarse grid.

On a multi-year address history, the score is only the selected storm (the strongest hail day until a date is chosen). It is not a blend of every hail day in the span. The card also shows the largest hail in the span. The date-of-loss list is separate: spotter or radar hail of at least 1.00 in, wind of at least 58 mph, or any tornado. Days with no hail report are not checked for radar hail.

## Address search

Search uses the US Census geocoder. If that returns no match, Swathline asks Nominatim with `HAILMAP_USER_AGENT`, at most about one request per second, and caches the result. There is no paid geocoder key.

## Later phase

Roof and property records are not in this build. `src/lib/seams.ts` records that flag as off so a later change can turn it on without inventing answers now.

## Map

Light theme is the default. Dark is a toggle and is remembered on the device. On a phone, Map, Storms, Addresses, Field, and Reports sit in a bottom bar. On a wide screen they sit in a side rail. Filters open in a sheet. Layer switches control reports, radar hail (MRMS MESH), report swaths, damage areas, NWS severe threats, the SPC Day 1 outlook, and the income choropleth. Radar hail, threats, and the outlook are on by default. Radar hail draws underneath markers, with a size legend at 0.75, 1, 1.5, and 2 inches or larger. A date field loads a past convective day from the Iowa State MRMS archive. State borders and names stay on the map. The site is a mobile PWA (`public/manifest.webmanifest`).

Replay plays one convective day. From the hail calendar or the selected-day bar, Replay watches the current map view. On an address history storm, Replay zooms to that address. Play, pause, a scrubber, 15-minute or 1-hour steps, and 1x, 2x, or 4x sit on a glass bar. The clock is local to the storm. The radar swath builds from 12:00 UTC, spotter reports appear at their times, and warning polygons show while they were in effect.

Replay plays one convective day. From the hail calendar or the selected-day bar, Replay watches the current map view. On an address history storm, Replay zooms to that address. Play, pause, a scrubber, 15-minute or 1-hour steps, and 1x, 2x, or 4x sit on a glass bar. The clock is local to the storm. The radar swath builds from 12:00 UTC, spotter reports appear at their times, and warning polygons show while they were in effect.

Field mode can list car dealerships and named auto lots inside a tapped hail swath, or inside the visible map, using OpenStreetMap. Pins show the name, address, and distance.

## Radar hail

MRMS MESH is the free NOAA estimate of maximum hail size. Swathline reads the latest 60-minute and 24-hour GRIB2 products from `mrms.ncep.noaa.gov` and older days from the Iowa Environmental Mesonet archive. No API key is required. Grids are decoded on the server, binned, contoured, and cached so the map does not call NOAA on every pan. A listed past date is the 24-hour maximum ending at 12:00 UTC the next day, which covers that afternoon and evening in the United States. The same radar size is included in the damage score for that address. Archive swaths start on 2019-09-28. See [docs/history-coverage.md](docs/history-coverage.md).

## Storm history

The Live, 1h, 6h, 24h, 3d, and 7d chips stay on the 7-day feed. **30 days**, **90 days**, **1 year**, **Custom**, and **Pick a day** read the SPC severe-weather database (hail and wind from 1955, tornadoes from 1950) plus SPC daily files for the year that database does not include yet. Wide views are clustered so a year of reports stays a few hundred dots. **Pick a day** opens a month calendar. Days with hail in the current map view are marked, and the dot grows from 1 inch to 1.75 inches to 2.5 inches. Month and year controls jump across the archive. Tapping a day loads that day’s reports and the radar swath. The same calendar sits on an address history, marked with the days that hit that point. **Hail days** lists dates in the current map view, largest hail first.

An address search opens a history card. The default span is 2 years, and it can run out to the start of the archive. Each date shows the radar MESH maximum where the archive covers it, the spotter maximum, wind, tornadoes, and nearby warnings, as a timeline and a table. The storm report for that span lists date-of-loss candidates and keeps the damage score on the newest or selected event.

The index is built on first use under `$HAILMAP_DATA_DIR/history`. The 1950–2025 database plus 2026 daily files measured 281 MB. Past days are cached. Details, including the dates that were actually probed, are in [docs/history-coverage.md](docs/history-coverage.md).

## Tests

Vitest covers hail size parsing (including SPC hundredths), wind and tornado LSR parsing, damage tags, dedupe/fusion (photo pins stay separate, different hazards stay separate), the damage score, address geocode parsing, field sign-in, photo storage, and swath clustering, hulls, and buffers.
