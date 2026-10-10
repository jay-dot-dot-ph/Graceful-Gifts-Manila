# Graceful Gifts Manila watch catalog

Responsive watch showroom backed by the existing **2026 WATCHES** Google Sheet. The site has no accounts, cart, checkout, or payment collection. Customers browse the catalog, save favorites in their browser, copy an inquiry, then continue in Messenger.

## Local preview

Use Node.js 24 or later from this directory:

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run dev
```

Open `http://127.0.0.1:4173`. The preview requires an internet connection to read the live Sheet. `npm.cmd run test:unit` checks parsing and stock states; `npm.cmd run test:live` checks the real public Sheet and an embedded image. `npm.cmd run test:browser` runs the desktop/mobile journey against the preview and requires Microsoft Edge on Windows.

## Data flow

- `worker/index.js` reads all 21 brand tabs using Google's public CSV view. It reads the corresponding public HTML views to locate images embedded in cells, then serves those images through `/image/{watchId}`.
- `/api/catalog` refreshes at most every five minutes per running Worker isolate. It keeps the last good catalog during temporary source failures and flags partial data in the interface.
- Product URLs use `/watch/{watchId}`. Watch ID, price, stock, and specifications come from the Sheet. Blank stock is shown as availability on request; zero stock is shown as sold out.
- `worker/client.js` renders the interface. Favorites are saved in browser local storage. Inquiry messages include each selected watch's ID, price, and exact page URL.

The current Sheet has no usable recent `Date Added` values or featured markers, so New Arrivals and Featured Watches have honest placeholder states. Customer feedback images were not supplied; the gallery and timed floating feedback activate when verified image URLs are added to `feedbackImages` in `window.GGM_CONFIG` in `worker/index.js`. Do not use unverified testimonials.

The live Sheet currently has no watch with zero stock. Browser QA injects a temporary zero-stock test fixture to check the sold-out display and inquiry message; it does not change the Sheet or customer catalog.

Several supplied watch images visibly contain `LUXX Collection` branding and a different contact number. The site shows Sheet images unchanged. Those images should be reviewed or replaced in the spreadsheet before a customer-facing launch.

The Sheet was already publicly readable when this build began. The site does not write to it or change its sharing settings. If its sharing or HTML format changes, the read adapter will need updating.

## Firebase Hosting

The Firebase project is `graceful-gifts-manila`. Its Spark plan supports the static Hosting export in `hosting-dist/`; the Firebase Web SDK snippet is not needed for this catalog. Run `npm.cmd run build:firebase` to read the Sheet and generate 696 product HTML pages, catalog JSON, and locally hosted copies of the spreadsheet images. `firebase.json` serves these files with clean product URLs. The export fails if a brand tab or watch image cannot be fetched, so an incomplete catalog is not deployed silently.

The GitHub workflow in `.github/workflows/firebase-hosting.yml` can refresh and deploy the catalog every six hours after the repository receives the source and the encrypted `FIREBASE_SERVICE_ACCOUNT_GRACEFUL_GIFTS_MANILA` secret. Until that workflow is active, Sheet changes require a new export and Firebase deployment. Image filenames change when a source image changes, allowing refreshed photos to replace older cached versions.

For a manual deployment from this folder, use the Firebase CLI after `npm.cmd run build:firebase`:

```powershell
firebase deploy --only hosting --project graceful-gifts-manila
```
