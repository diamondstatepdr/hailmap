# Play Console listing — HailMap

Package name: `com.hailmap.app`

Category: Weather

## Title

HailMap

## Short description

Live nationwide hail reports, swaths, and county income context.

## Full description

HailMap is a nationwide map of recent United States hail.

- Live reports from National Weather Service alerts, Storm Prediction Center hail reports, and Iowa Environmental Mesonet local storm reports
- Reports are fused and de-duplicated. Official NWS reports outrank spotter reports, which outrank radar MESH, which outrank community submissions
- Markers are colored by hail size
- Hail swaths are drawn from report clusters (about 45 km and 3 hours) as a buffered hull
- Optional county shading uses Census median household income
- Light theme by default, with a dark toggle
- Filter by time, size, confidence, and state
- Import your own CSV or GeoJSON. Spotter and community feeds are webhook-only

HailMap does not scrape social networks. It does not require an account and it does not request GPS permission. The Android app is a secure WebView of the HTTPS site.

Privacy policy: https://YOUR-RAILWAY-DOMAIN/privacy

## Graphic assets

Use the icon in `public/icons/icon-512.png`. Take a phone screenshot of the map with points and the filter sheet open for the phone screenshots. A 7-inch and 10-inch tablet screenshot can be the same map in landscape.

## Content rating

No violence, no user chat, no social sharing, no unrestricted web (the WebView loads only the HailMap HTTPS origin). Questionnaire result should be Everyone / PEGI 3.

## Release

1. Deploy the web app and copy its `https://` URL.
2. Set `CAPACITOR_SERVER_URL` to that URL.
3. Run `npm run android:setup`.
4. Create an upload keystore outside the repo (see README). `*.jks` and keystore scripts are gitignored.
5. Build an Android App Bundle in Android Studio (`Build > Generate Signed Bundle`).
6. Upload the AAB to the production or internal testing track.
7. Complete Data safety using `docs/data-safety.md`.
8. Set the privacy policy URL to `https://YOUR-RAILWAY-DOMAIN/privacy`.
