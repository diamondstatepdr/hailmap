# Play Data safety — HailMap

Answer the Data safety form from this sheet. The Android package `com.hailmap.app` is a WebView of the HTTPS HailMap site. It does not add a location SDK, ad SDK, or account system.

## Overview

- Does the app collect or share any of the required user data types? **Yes**, only when someone submits a photo hail report. Viewing the map does not collect those fields.
- Is all user data encrypted in transit? **Yes.** The release WebView loads only `https://` (`CAPACITOR_SERVER_URL`, cleartext disabled).
- Do you provide a way for users to request data deletion? **Yes.** Email diamondstatepdr@gmail.com. Imported, webhook, and photo hail reports can be deleted. Viewers do not have accounts.
- Privacy policy URL: `https://YOUR-RAILWAY-DOMAIN/privacy`

## Data types

| Data type | Collected | Shared | Notes |
| --- | --- | --- | --- |
| Location (precise or approximate) | Yes, optional | No | Only if the user submits a photo report and allows GPS, or taps a pin. The confirmed coordinates are the hail location shown on the map. Viewing the map does not request location. Photo EXIF GPS is not used. |
| Personal info (name, email, phone, address) | No | No | No account. Do not put personal data in a hail remark or photo. |
| Financial info | No | No | County income is Census statistics, not the user's finances. |
| Photos | Yes, optional | No | Only the photo the user attaches to a hail report. Stored on the server volume and shown on the map. Contacts, SMS, and calendar are not accessed. |
| App activity / web history | No | No | No analytics SDK. |
| Device or other IDs | No | No | Not collected by HailMap. |
| Files | No | No | A CSV/GeoJSON the user imports is uploaded to the HailMap server as hail observations. Treat the file contents as user-provided content, not as personal files stored on device. |

## Data the server stores when someone submits a report

When someone imports a file, calls a webhook, or submits a photo report:

- Latitude, longitude, time, hail size
- Optional place name, county, state, remark
- For a photo report: the image file, stored under `HAILMAP_DATA_DIR/photos` (Railway volume `/data/photos`)
- A hashed client IP, kept about a day, to rate-limit photo submits
- Source label: `spotter`, `community`, `import`, or `photo`

This is not collected from people who only open the map. Webhooks require `HAILMAP_WEBHOOK_SECRET` in production. Photo reports are public with an hourly and daily cap. They are always community confidence.

Official NWS, SPC, and IEM rows are public weather products, not user data. They are deleted after eight days.

## Security practices

- Encrypted in transit (HTTPS only)
- Data is not sold
- Data is not used for advertising or credit decisions
- No social-network scraping

## Independent security review

Not applicable.
