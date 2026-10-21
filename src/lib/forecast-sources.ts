/**
 * Sources and constants for the storm-to-cash estimate.
 * Dollars from this file are a guide, not measured damage, claims, or earnings.
 * Any surface that prints them — the sheet, a copy, or a hail proof PDF —
 * has to show ESTIMATE_BADGE and ESTIMATE_GUIDE with the figures.
 *
 * Rates are the share of exposed vehicles or housing units inside a hail band
 * that are treated as damaged. A lab coupon percent is not a claim rate.
 */

export type RateBasis = "sourced" | "assumption" | "storm";

export interface DamageBand {
  /** Inclusive lower bound, inches. The top band has no ceiling. */
  minIn: number;
  label: string;
  vehicleRate: number;
  roofRate: number;
  vehicleBasis: RateBasis;
  roofBasis: RateBasis;
}

export interface SourceLink {
  name: string;
  url: string;
  detail: string;
}

export const ESTIMATE_TITLE = "Storm-to-Cash Estimate";
export const ESTIMATE_BADGE = "ESTIMATE · GUIDE ONLY";
export const ESTIMATE_GUIDE = "A rough guide based on averages. Not actual damage, claims or earnings.";

/** Share of damaged units one crew might book. Not part of the market total. */
export const CREW_CAPTURE_RATE = 0.05;
export const CREW_CAPTURE_LABEL = "One crew, about 5% of damaged units";
export const CREW_CAPTURE_NOTE = "Assumption. Not the market total.";

/**
 * July 28, 2016 Colorado Springs "hail bomb" (golf- and tennis-ball hail).
 * RMIIA: 51,300 auto claims at more than $164.6 million and 33,200 property
 * claims at more than $188.2 million, totaling $352.8 million.
 * http://www.rmiia.org/news_room/catastrophe_news/2016_08_22_Insurance_News_Colorado_Springs_Hail_Bomb.asp
 *
 * Exposure is ACS 2023 5-year El Paso County, Colorado (2019–2023), not a 2016 count.
 * The county is larger than the core, so these shares are a low reading of a direct hit.
 * Housing units B25001_001E 296,753. Vehicles available B25046_001E 570,755.
 * https://data.census.gov/table/ACSDT5Y2023.B25001?g=050XX00US08041
 * https://data.census.gov/table/ACSDT5Y2023.B25046?g=050XX00US08041
 */
export const COS_AUTO_CLAIMS = 51300;
export const COS_AUTO_LOSS = 164_600_000;
export const COS_PROPERTY_CLAIMS = 33200;
export const COS_PROPERTY_LOSS = 188_200_000;
export const COS_TOTAL_LOSS = 352_800_000;
export const COS_HOUSING_UNITS = 296753;
export const COS_VEHICLES = 570755;

export const VEHICLE_RATE_2IN = COS_AUTO_CLAIMS / COS_VEHICLES;
export const ROOF_RATE_2IN = COS_PROPERTY_CLAIMS / COS_HOUSING_UNITS;

/**
 * May 8, 2017 Denver metro hail. Claims Journal, May 9, 2018: losses were
 * restated from $1.4 billion to $2.3 billion, from about 167,000 auto claims
 * and 100,600 homeowners claims. No dollar split was published.
 * https://www.claimsjournal.com/news/west/2018/05/09/284581.htm
 */
export const DENVER_AUTO_CLAIMS = 167000;
export const DENVER_PROPERTY_CLAIMS = 100600;
export const DENVER_TOTAL_LOSS = 2_300_000_000;

/**
 * Conservative assumptions where no in-swath claim share is published.
 * Kept below the Colorado Springs county rates. Marshall coupon percents
 * and the NWS "nearly all shingle types at 1.25 in" line are lab results,
 * not the share of roofs that are claimed.
 */
export const VEHICLE_RATE_1IN = 0.01;
export const ROOF_RATE_1IN = 0.02;
export const VEHICLE_RATE_1_5IN = 0.04;
export const ROOF_RATE_1_5IN = 0.06;
export const VEHICLE_RATE_2_5IN = 0.15;
export const ROOF_RATE_2_5IN = 0.18;

export const DAMAGE_BANDS: DamageBand[] = [
  {
    minIn: 0,
    label: '<1"',
    vehicleRate: 0,
    roofRate: 0,
    vehicleBasis: "sourced",
    roofBasis: "sourced",
  },
  {
    minIn: 1,
    label: '1"',
    vehicleRate: VEHICLE_RATE_1IN,
    roofRate: ROOF_RATE_1IN,
    vehicleBasis: "assumption",
    roofBasis: "assumption",
  },
  {
    minIn: 1.5,
    label: '1.5"',
    vehicleRate: VEHICLE_RATE_1_5IN,
    roofRate: ROOF_RATE_1_5IN,
    vehicleBasis: "assumption",
    roofBasis: "assumption",
  },
  {
    minIn: 2,
    label: '2"',
    vehicleRate: VEHICLE_RATE_2IN,
    roofRate: ROOF_RATE_2IN,
    vehicleBasis: "storm",
    roofBasis: "storm",
  },
  {
    minIn: 2.5,
    label: '2.5"+',
    vehicleRate: VEHICLE_RATE_2_5IN,
    roofRate: ROOF_RATE_2_5IN,
    vehicleBasis: "assumption",
    roofBasis: "assumption",
  },
];

/**
 * Default tickets. A team can edit these. They are not hail-only invoices.
 * - PDR low: III, 2024 average comprehensive claim severity $2,306.
 *   https://www.iii.org/fact-statistic/facts-statistics-auto-insurance
 * - PDR high: top of DentAdvisor's severe paintless-dent band ($2,500–$5,000+).
 *   The plus means some jobs cost more. Trade guide, not an insurer average.
 *   https://dentadvisor.org/guides/hail-damage-assessment
 * - Roof low / high: Verisk U.S. Roof Report (2025 data), average repair $4,699
 *   and average replacement $17,631.
 *   https://www.verisk.com/49be6d/siteassets/media/campaigns/gated/underwriting/the-state-of-americas-roofs.pdf
 */
export const DEFAULT_PRICES = {
  pdrLow: 2306,
  pdrHigh: 5000,
  roofLow: 4699,
  roofHigh: 17631,
};

export const ESTIMATE_METHOD = [
  "Homes and vehicles are Census tract counts inside each hail band, or the Money Hole count when no tract centroid falls in the spot.",
  "Under 1 inch, the share damaged is zero. The 2 inch share is July 28, 2016 Colorado Springs claims divided by El Paso County housing and vehicles. Other sizes are conservative assumptions.",
  "Dollars are that share times a ticket. Defaults are an III comprehensive average, a DentAdvisor PDR high, and Verisk roof repair and replacement. Edit them below.",
];

export const ESTIMATE_SOURCES: SourceLink[] = [
  {
    name: "Marshall, Herzog, and Smith 2002",
    url: "https://ams.confex.com/ams/pdfpapers/45858.pdf",
    detail: "No roof damage at 0.75 inch in lab tests",
  },
  {
    name: "NWS La Crosse damage assessment",
    url: "https://www.weather.gov/arx/stormdamage",
    detail: "No shingle damage at 3/4 inch; cars typically dent at 1.75 inch golf ball",
  },
  {
    name: "RMIIA Colorado Springs hail bomb",
    url: "http://www.rmiia.org/news_room/catastrophe_news/2016_08_22_Insurance_News_Colorado_Springs_Hail_Bomb.asp",
    detail: "July 28, 2016 claim counts and insured losses",
  },
  {
    name: "Claims Journal Denver hail",
    url: "https://www.claimsjournal.com/news/west/2018/05/09/284581.htm",
    detail: "May 8, 2017 metro Denver claim counts and $2.3 billion loss",
  },
  {
    name: "Census ACS 2023 5-year",
    url: "https://data.census.gov/table/ACSDT5Y2023.B25001?g=050XX00US08041",
    detail: "Housing units (B25001) and vehicles available (B25046)",
  },
  {
    name: "Insurance Information Institute",
    url: "https://www.iii.org/fact-statistic/facts-statistics-auto-insurance",
    detail: "2024 average comprehensive claim severity",
  },
  {
    name: "DentAdvisor hail PDR guide",
    url: "https://dentadvisor.org/guides/hail-damage-assessment",
    detail: "Published PDR price bands by severity",
  },
  {
    name: "Verisk U.S. Roof Report",
    url: "https://www.verisk.com/49be6d/siteassets/media/campaigns/gated/underwriting/the-state-of-americas-roofs.pdf",
    detail: "Average roof repair and replacement cost",
  },
];

export interface BacktestStorm {
  id: string;
  name: string;
  date: string;
  autoClaims: number;
  propertyClaims: number;
  /** Published auto dollars, when the source split them. */
  autoLoss: number | null;
  propertyLoss: number | null;
  totalLoss: number;
  sourceName: string;
  sourceUrl: string;
  note: string;
}

export const BACKTESTS: BacktestStorm[] = [
  {
    id: "cos-2016",
    name: "Colorado Springs hail bomb",
    date: "2016-07-28",
    autoClaims: COS_AUTO_CLAIMS,
    propertyClaims: COS_PROPERTY_CLAIMS,
    autoLoss: COS_AUTO_LOSS,
    propertyLoss: COS_PROPERTY_LOSS,
    totalLoss: COS_TOTAL_LOSS,
    sourceName: "RMIIA",
    sourceUrl: "http://www.rmiia.org/news_room/catastrophe_news/2016_08_22_Insurance_News_Colorado_Springs_Hail_Bomb.asp",
    note: "RMIIA said the auto and property totals were more than these amounts. They add up to the $352.8 million storm total. MESH swaths in this app start in 2019, so the check is published claims times the ticket range.",
  },
  {
    id: "denver-2017",
    name: "Denver metro hail",
    date: "2017-05-08",
    autoClaims: DENVER_AUTO_CLAIMS,
    propertyClaims: DENVER_PROPERTY_CLAIMS,
    autoLoss: null,
    propertyLoss: null,
    totalLoss: DENVER_TOTAL_LOSS,
    sourceName: "Claims Journal",
    sourceUrl: "https://www.claimsjournal.com/news/west/2018/05/09/284581.htm",
    note: "Updated insured loss was $2.3 billion, with no published split between auto and homeowners. The same ticket range is applied to the published claim counts.",
  },
];
