import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · HailMap",
  description: "How HailMap handles weather reports and the data it does not collect.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-[100dvh] max-w-2xl px-5 py-8">
      <p className="mb-6">
        <Link href="/" className="text-sm font-medium text-accent">
          ← Back to the map
        </Link>
      </p>
      <article className="prose-hail space-y-3">
        <h1>Privacy policy</h1>
        <p>Effective September 21, 2026. HailMap is operated by Diamond State Hail Solutions.</p>
        <p>
          Contact: <a href="mailto:diamondstatepdr@gmail.com">diamondstatepdr@gmail.com</a>
        </p>

        <h2>What HailMap is</h2>
        <p>
          HailMap shows recent United States hail reports on a map, draws report-derived swaths, and
          can shade counties by Census median household income. It is a weather display. It is not a
          social network and it does not scrape social media, forums, or private accounts.
        </p>

        <h2>Data we do not collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>No account, name, phone number, or precise device location is required to use the map.</li>
          <li>The app does not request GPS permission and does not read contacts, photos, or SMS.</li>
          <li>We do not sell personal information and we do not show third-party ads.</li>
          <li>We do not pull posts from X, Facebook, Instagram, or any other social platform.</li>
        </ul>

        <h2>Weather data</h2>
        <p>
          Live hail locations come from public National Weather Service alerts, Storm Prediction
          Center hail reports, and Iowa Environmental Mesonet local storm reports. A county income
          layer uses a bundled American Community Survey cache (table B19013, median household
          income). An optional Census API key can refresh that cache on the server. Map tiles are
          loaded from OpenFreeMap.
        </p>
        <p>
          Those sources describe weather and public statistics. They are not a profile of the person
          viewing the map.
        </p>

        <h2>Reports you submit</h2>
        <p>
          Spotter and community webhooks, and CSV or GeoJSON import, store the hail observation you
          send: location, time, size, and optional place name or remark. Webhooks in production
          require a shared secret. Imported files are treated as community or spotter observations
          and cannot overwrite official NWS confidence.
        </p>
        <p>
          Do not include a person&apos;s name, phone number, address of a private residence beyond
          the hail location, or any other personal data in a remark. If you did, email us and we
          will delete that stored report.
        </p>

        <h2>Retention</h2>
        <p>
          Official feed rows older than eight days are removed on sync. Reports you import or post
          to a webhook stay until you ask us to delete them or we remove the database. The database
          lives on the server volume, not on the phone, except for a short-lived cache of the app
          shell in the browser.
        </p>

        <h2>The Android app</h2>
        <p>
          The HailMap Android package <strong>com.hailmap.app</strong> is a WebView of the HTTPS
          site. It does not add a separate analytics SDK. Cleartext HTTP is disabled. Play data-safety
          answers that match this policy are in the repository under <strong>docs/data-safety.md</strong>.
        </p>

        <h2>Children</h2>
        <p>HailMap is not directed at children under 13 and we do not knowingly collect their personal information.</p>

        <h2>Changes</h2>
        <p>If this policy changes, the updated text will be published at this page with a new effective date.</p>
      </article>
    </main>
  );
}
