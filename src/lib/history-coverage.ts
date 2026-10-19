/**
 * Date coverage checked against the public archives on 2026-10-19.
 * The probes and disk notes live in docs/history-coverage.md.
 * Do not widen these without fetching the archive again.
 */

/** SPC severe-weather database: hail and wind begin in 1955. First row in the 1950s hail file is 1955-01-17. */
export const SPC_HAIL_WIND_START = "1955-01-01";

/** SPC severe-weather database: tornado rows begin in 1950. */
export const SPC_TORNADO_START = "1950-01-01";

/** Earliest SPC daily LSR CSV that returned a real file (`climo/reports/YYMMDD_rpts_*.csv`). 2004-02-01 was 404. */
export const SPC_DAILY_START = "2004-03-01";

/**
 * IEM LSR GeoJSON returned events on 2004-01-01 and none for the 2003 weeks that were sampled.
 * One response is capped at 10,000 features.
 */
export const IEM_LSR_START = "2004-01-01";

/**
 * First Iowa Environmental Mesonet directory for MRMS MESH_Max_1440min.
 * 2019-09-26 was 404. 2019-09-28 was 200.
 */
export const MESH_ARCHIVE_START = "2019-09-28";

/**
 * IEM `vtec_events_bypoint.py` returned a severe thunderstorm warning for Dallas on 1986-02-05.
 * Earlier than that was not probed. Treat 1986-01-01 as the start of the point archive.
 */
export const VTEC_POINT_START = "1986-01-01";

/**
 * IEM storm-based warning polygons (`sbw.py`) returned features for 2002-01-01.
 * NWS storm-based warnings became operational on 2007-10-01. Quiet days return an empty collection.
 */
export const SBW_POLYGON_START = "2002-01-01";

/** SPC published the 1950/1955–2025 severe database on 24 April 2026. 2026 is not in that release. */
export const SPC_SVRGIS_PROBED_YEAR = 2025;

export const HISTORY_COVERAGE_CHECKED = "2026-10-19";
