# Play Data safety — HailMap

Answer the Data safety form from this sheet. The Android package `com.hailmap.app` is a WebView of the HTTPS HailMap site. It does not add a location SDK, ad SDK, or account system.

## Overview

- Does the app collect or share any of the required user data types? **No**, for the person using the app.
- Is all user data encrypted in transit? **Yes.** The release WebView loads only `https://` (`CAPACITOR_SERVER_URL`, cleartext disabled).
- Do you provide a way for users to request data deletion? **Yes.** Email diamondstatepdr@gmail.com. Imported or webhook hail reports can be deleted. Viewers do not have accounts.
- Privacy policy URL: `https://YOUR-RAILWAY-DOMAIN/privacy`

## Data types

| Data type | Collected | Shared | Notes |
| --- | --- | --- | --- |
| Location (precise or approximate) | No | No | The app does not request GPS or read device location. Hail coordinates are weather-report fields, not the viewer's location. |
| Personal info (name, email, phone, address) | No | No | No account. Do not put personal data in a hail remark. |
| Financial info | No | No | County income is Census statistics, not the user's finances. |
| Photos, contacts, SMS, calendar | No | No | Not accessed. |
| App activity / web history | No | No | No analytics SDK. |
| Device or other IDs | No | No | Not collected by HailMap. |
| Files | No | No | A CSV/GeoJSON the user imports is uploaded to the HailMap server as hail observations. Treat the file contents as user-provided content, not as personal files stored on device. |

## Data the server stores when someone submits a report

Only if the operator or a spotter uses import or a webhook:

- Latitude, longitude, time, hail size
- Optional place name, county, state, remark
- Source label: `spotter`, `community`, or `import`

This is not collected from Play users who only open the map. Webhooks require `HAILMAP_WEBHOOK_SECRET` in production.

Official NWS, SPC, and IEM rows are public weather products, not user data. They are deleted after eight days.

## Security practices

- Encrypted in transit (HTTPS only)
- Data is not sold
- Data is not used for advertising or credit decisions
- No social-network scraping

## Independent security review

Not applicable.
