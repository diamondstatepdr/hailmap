# Storm history coverage

Checked against the public archives on **2026-10-21**. Swathline does not use a paid hail provider. Every source below is a free NOAA or Iowa Environmental Mesonet file. No API key is required.

The constants in `src/lib/history-coverage.ts` match this page. Widen a start date only after fetching the archive again.

## What each source actually covers

| Data | Source | First date that returned data | How Swathline uses it |
| --- | --- | --- | --- |
| Hail and wind reports | SPC severe-weather database (`/wcm/data/1955-YYYY_hail.csv.zip` and `_wind.csv.zip`) | **1955-01-17** hail, **1955-02-01** wind. The 1955–1959 hail file’s first row is 1955-01-17, 0.75 in, Texas. | Bulk index through the published year. Probed release is **1955–2025**, posted 24 April 2026 (`Last-Modified` on the hail zip). 2026 annual files were 404. |
| Tornado reports | SPC `1950-YYYY_actual_tornadoes.csv` (one row per tornado, not state segments) | **1950-01-03** | Same index. Magnitude 0–5 is an F rating before 2007 and an EF rating from 2007. Unknown (`-9`) is stored with no rating. |
| Recent daily reports | SPC `climo/reports/YYMMDD_rpts_{hail,wind,torn}.csv` | **2004-03-01**. 2004-02-01 was 404. Quiet days are a 49-byte header. | Fills the year the annual database does not include yet (2026-01-01 through yesterday, and any day after the published year). Past convective days are cached and not refetched after 18:00 UTC the next day. |
| Live local storm reports | IEM `geojson/lsr.py` plus the same SPC daily files and active NWS alerts | IEM returned events on **2004-01-01**. Sampled weeks in 2003 returned none. One response is capped at **10,000** features (a May 2026 month hit that cap exactly). | The existing 7-day map only. Not the multi-year index. |
| Radar hail (MESH), 24-hour maximum | Iowa State `mtarchive` `MESH_Max_1440min`, falling back to NCEP for the last ~40 hours | **2019-09-28**. 2019-09-27 had instantaneous `MESH` and no `MESH_Max_1440min` folder. Early files are named `MRMS_Max_1440min_00.50_*.grib2.gz`. By 2022-10-02 the prefix is `MESH_Max_1440min`. | On demand, and one day at a time in the background index. The file valid at 12:00 UTC the next calendar day covers that US storm day. |
| Warnings at a point | IEM `vtec_events_bypoint.py` | A severe thunderstorm warning for Dallas was returned for **1986-02-05**. Earlier than 1986 was not probed. | Address history, one request per point and span. Cached on disk when the end date is before today. |
| Warning polygons | IEM `geojson/sbw.py` | Features on **2002-01-01** (tornado and severe thunderstorm). NWS storm-based warnings became operational on **2007-10-01**. Quiet days are an empty collection. | Address history uses the point archive. Storm Replay draws severe thunderstorm and tornado warning polygons (`SV.W`, `TO.W`) for the convective day and shows each polygon between `polygon_begin` and `polygon_end`. |
| Radar hail, hourly sample | Iowa State `mtarchive` instantaneous `MESH` | **2019-08-20**. 2019-08-19 had MRMS products and no `MESH` folder. The first day starts around 16:46 UTC, so it is a partial day. Swathline keeps the largest of up to eight scans from 12:00 UTC through 12:00 UTC the next day. | Fills 2019-08-20 through 2019-09-27, where the 24-hour product does not exist yet. This is not a full 2-minute maximum. |
| Earlier MRMS, not hail | Iowa State `mrms/ncep` and `mrms/reanalysis` | NCEP tree from **2014-11-01** (2014-10-31 was 404). 2011-05-24 and 2001-06-01 reanalysis folders contain `PrecipRate` only. 2015 through 2019-08-19 samples had QPE products and no MESH. | Not used for hail size. There is no free nationwide MESH grid for 2011. |
| NOAA AWS MRMS | `s3://noaa-mrms-pds` `CONUS/MESH_Max_1440min_00.50` | Earliest listed key **2020-10-14**. | Same 24-hour product Iowa State already has from 2019-09-28. Not an earlier source. |
| Replay radar | Iowa State `MESH_Max_1440min` every 30 minutes, plus instantaneous `MESH` about every 2 minutes | Same **2019-09-28** start as the daily MESH composite. | Storm Replay subtracts the 12:00 UTC 24-hour maximum from the scan at the playhead so the day’s swath builds. |

SPC severe-database times are Central Standard Time all year (UTC−6), including summer. Hail magnitude is inches (values above 20 are hundredths of an inch). Wind magnitude is knots, stored as miles per hour.

## What the app keeps on disk

Measured on 2026-10-19 after ingesting the 1955/1950–2025 SPC database and the 2026 daily files into `$HAILMAP_DATA_DIR/history` (local `.data/history` in development, `/data/history` on Railway):

| Piece | Size | Notes |
| --- | --- | --- |
| `history.sqlite` | **200 MB**, plus a 46 MB write-ahead log that checkpoints into the same file | Annual database alone is 1,050,024 reports: 414,478 hail (1955-01-17–2025-12-28), 562,088 wind (1955-02-01–2025-12-28), 73,458 tornadoes (1950-01-03–2025-12-28). The 2026 daily rows are in this file too. |
| SPC zip + tornado CSV | **28 MB** | Kept so a restart does not re-download. Extracted CSVs are deleted after insert. |
| Daily SPC files for 2026 | **7.4 MB** | Header-only quiet days are 49 bytes. Files were fetched for 2025-12-29 through 2026-10-19. |
| Viewed MESH days | **6.8 MB** for the days opened while checking May 9, 2024 and spring 2026 | JSON under `mesh/`, plus a coarse `mesh_cells` index. Cells below 0.5 in are dropped. Bins are 0.1°. |
| Warning JSON | kilobytes per address span | Written only when the span already ended. A span that includes today is not cached. |

The history directory measured **281 MB** before any multi-year radar index. A Railway Hobby volume (commonly 5 GB, and usable well below 1 GB) has room for the spotter index plus a bounded hail index.

## Radar index size, measured before a bulk write

Two real Iowa State files were decoded in memory on 2026-10-21. Nothing from them was inserted into the database, and the gzip files were not kept.

| Convective day | File | Gzip bytes | 0.1° bins at or above 0.5 in |
| --- | --- | --- | --- |
| 2024-05-09 | `MESH_Max_1440min_00.50_20240510-120000.grib2.gz`, valid 2024-05-10T12:00:00Z | 709,432 | **2,701** (largest hail in the file 3.93 in) |
| 2024-02-01 | `MESH_Max_1440min_00.50_20240202-120000.grib2.gz`, valid 2024-02-02T12:00:00Z | 79,458 | **30** (largest hail 1.43 in) |

Each stored bin is planned at 96 bytes. From 2019-08-20 through 2026-10-20 is **2,619 days**.

- At the 9 May 2024 rate, every day would be about **648 MB**. That is over the **320 MB** cap, so the walk would stop after about 1,294 days at that rate.
- At the 1 February 2024 rate, the same span would be about **7.2 MB**.

`GET /api/history/coverage` returns `meshEstimate` from the high rate (2,701 cells a day) before any of those days are written. The background job uses the real cell count for each day, logs that estimate at startup, and stops when the coarse index would pass the cap. Set `HAILMAP_MESH_BACKFILL=0` to leave it off. Set `HAILMAP_MESH_BUDGET_BYTES` to change the cap. Raw GRIB is discarded after the bins are counted.

Immutable past days stay cached. The annual SPC zip is re-checked by `Last-Modified` only when the index is rebuilt (the published year is revised; the 2024 annual file was touched again on 1 October 2026). The running app treats a completed index year as current until the process builds again and the meta year is missing.

## Fetching

- Map windows through 7 days still use `/api/reports` (IEM LSR, SPC daily, active NWS).
- 30 days, 90 days, 1 year, a custom range, and a picked day use `/api/history/reports` for the visible map bounds.
- Requests to the same host are serialized: about 120 ms between SPC calls, 350 ms for the MESH archive, 400 ms for IEM.
- The first history request downloads and indexes the SPC database if `history/history.sqlite` has no `svrgisYear`. Later requests only fill SPC daily files after that year.
- Long ranges aggregate points on the server when there are more than 2,500 reports, or more than 900 across a view at least 8° wide. The browser does not cluster those dots again. A query returns at most 60,000 raw rows before aggregating; a nationwide multi-decade view is a sample of that cap. A state or metro view of one year is inside the cap.
- Address history defaults to 2 years (`/api/history/place`). Spans of 1, 5, and 10 years, or the full archive back to 1950, are on the card. Radar MESH is sampled for the largest hail dates in the span (up to 14 dates, at most 8 uncached days per request). The damage score uses the selected date, or the strongest hail day when none is selected.

## Rebuild

The server builds the index on first use. To build it by hand:

```bash
HAILMAP_DATA_DIR=/data ./node_modules/.bin/vite-node -c scripts/vite-node.config.mjs scripts/build-history-index.ts
```

Daily files for the gap after the annual database:

```bash
HAILMAP_DATA_DIR=/data ./node_modules/.bin/vite-node -c scripts/vite-node.config.mjs scripts/backfill-daily.ts
```

`HAILMAP_HISTORY_BACKFILL=0` skips the background daily tail. The radar index runs unless `HAILMAP_MESH_BACKFILL=0`. It handles one convective day every 20 seconds, newest first, and stops at the byte budget above.
