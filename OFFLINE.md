# Krishi — offline mode (SQLite)

`src/environments/environment*.ts` has `offline: true`. In that mode nothing calls
`http://localhost:8080/api`: data lives in a SQLite database on the phone, seeded on the
first launch with the dummy data from `src/app/core/mock-db/seed/`.

## Build the APK

    npm install
    npx cap add android          # first time only
    npm run cap:sync             # ng build + cap sync
    npx cap open android         # Android Studio → Build → Build APK(s)

## Sign in (offline, no password check)

Username = first name, full name, or the username chosen at offline sign-up:
`rezaul` (Administrator), `ashfakul` / `nurul` (Land Owner), `abdul` / `jashim` / `monir` /
`shahjahan` (Sharecropper). Password is ignored.

## Where the code is

- `core/offline/local-db.ts` — SQLite store (in-memory copy in a desktop browser).
- `core/offline/offline-api.ts` — list/get/create/update/remove plus the decision actions.
- `core/http/http-api.ts`, `core/session.ts` — delegate to the above when `offline` is true.

To go back to the real backend set `offline: false`. To reset the dummy data on a phone,
clear the app's storage or call `LocalDb.reset()`.
