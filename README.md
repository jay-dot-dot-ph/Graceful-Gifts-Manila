# Graceful Gifts Manila watch catalog

Responsive watch showroom backed by the **2026 WATCHES - GRACE** Google Sheet. The site has no accounts, cart, checkout, or payment collection. Customers browse the catalog, save favorites in their browser, copy an inquiry, then continue in Messenger.

Live website: https://graceful-gifts-manila.web.app

## Local preview

Use Node.js 24 or later from this directory. The private Sheet must be shared as Viewer with the service account in `GOOGLE_SERVICE_ACCOUNT_JSON`. Keep that JSON out of the repository.

```powershell
npm.cmd install
npm.cmd run build:firebase
npm.cmd run dev
```

Open `http://127.0.0.1:4173`. The preview serves the generated static export. `npm.cmd run test:unit` checks the private-source adapter; `npm.cmd run test:live` checks the exported catalog and image files. `npm.cmd run test:browser` runs the desktop/mobile journey against the preview and requires Microsoft Edge on Windows.

## Data flow

- `scripts/private-catalog.mjs` reads the brand tabs of the [private spreadsheet](https://docs.google.com/spreadsheets/d/1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8/edit) with the Firebase service account. It skips the `Brands` index tab, maps product fields by header name, and downloads the workbook to recover embedded photos.
- The build writes a public product snapshot to `hosting-dist/`. Website visitors do not access the private spreadsheet or its credentials.
- Product URLs use `/watch/{watchId}`. Watch ID, price, stock, and specifications come from the Sheet. Blank stock is shown as availability on request; zero stock is shown as sold out.
- `worker/client.js` renders the interface. Favorites are saved in browser local storage. Inquiry messages include each selected watch's ID, price, and exact page URL.

The current Sheet has `Date Added` values for sorting. Featured Watches still has a placeholder because the Sheet has no featured markers. Customer feedback images were not supplied; the gallery and timed floating feedback activate when verified image URLs are added to `feedbackImages` in `window.GGM_CONFIG` in `worker/index.js`. Do not use unverified testimonials.

Browser QA injects a temporary zero-stock test fixture if needed to check the sold-out display and inquiry message; it does not change the Sheet or customer catalog.

The site shows Sheet images unchanged. Keep the Sheet's General access set to Restricted and give the service account Viewer access. The build needs permission to download the workbook to copy embedded photos. The site does not write to the Sheet or change its sharing settings.

## Firebase Hosting

The Firebase project is `graceful-gifts-manila`. Its Spark plan supports the static Hosting export in `hosting-dist/`; the Firebase Web SDK snippet is not needed for this catalog. Run `npm.cmd run build:firebase` with `GOOGLE_SERVICE_ACCOUNT_JSON` set to read the Sheet and generate product HTML pages, catalog JSON, and locally hosted copies of the spreadsheet images. `firebase.json` serves these files with clean product URLs. The export fails if the private Sheet or workbook photos cannot be downloaded, so an incomplete catalog is not deployed silently.

The authenticated build reads image anchors from the workbook XLSX export and saves photos against their Watch IDs.

The GitHub workflow in `.github/workflows/firebase-hosting.yml` refreshes and deploys the catalog every six hours. Its encrypted `FIREBASE_SERVICE_ACCOUNT_GRACEFUL_GIFTS_MANILA` secret supplies the same service account for private Sheet access and Hosting deployment. Google Sheets API and Drive API must be enabled for the Firebase project. Image filenames change when a source image changes, allowing refreshed photos to replace older cached versions.

For full-site refreshes shortly after staff edits the Sheet, install the bound [Sheet edit trigger](automation/README.md). It dispatches the same GitHub workflow after nearby edits settle. The six-hour schedule remains a fallback for changes made by scripts or APIs. The trigger requires a one-time Google Apps Script authorization and a repository-scoped GitHub Actions token stored in Apps Script Script Properties.

For a manual deployment from this folder, use the Firebase CLI after `npm.cmd run build:firebase`:

```powershell
firebase deploy --only hosting --project graceful-gifts-manila
```
