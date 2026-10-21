# Graceful Gifts Manila watch catalog

Responsive watch showroom backed by the **2026 WATCHES - GRACE** Google Sheet. Customers browse the catalog, save favorites in their browser, and use built-in live chat to inquire. Staff use individual Firebase Authentication accounts at `/admin/chat`. There is no cart, checkout, or payment collection.

**Chat deployment and owner setup:** [CHAT_SETUP.md](CHAT_SETUP.md). Do not push this change to `main` or deploy Hosting until the Firebase setup and Firestore rules are ready; the existing workflow deploys pushes to `main` automatically.

Live website: https://graceful-gifts-manila.web.app

## Local preview

Use Node.js 24 or later from this directory. The Sheet's General access must be **Anyone with the link → Viewer** so the build can read its public CSV and workbook exports.

```powershell
npm.cmd install
npm.cmd run build:firebase
npm.cmd run dev
```

Open `http://127.0.0.1:4173`. The preview serves the generated static export. `npm.cmd run test:unit` checks the public-source adapter; `npm.cmd run test:live` checks the exported catalog and image files. `npm.cmd run test:browser` runs the desktop/mobile journey against the preview and requires Microsoft Edge on Windows.

## Data flow

- `scripts/public-catalog.mjs` reads the brand tabs of the [spreadsheet](https://docs.google.com/spreadsheets/d/1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8/edit) through public Viewer access. It skips the `Brands` index tab, maps product fields by header name, and uses public photo links or a brand-tab workbook export to recover embedded photos.
- The build writes a product snapshot to `hosting-dist/`. Website visitors read this snapshot; they do not need Google API credentials.
- Product URLs use `/watch/{watchId}`. Watch ID, price, stock, and specifications come from the Sheet. Blank stock is shown as availability on request; zero stock is shown as sold out.
- `worker/client.js` renders the interface. Favorites are saved in browser local storage. Inquiry actions open `chat/customer.js`, which sends selected watch references and customer messages to Firestore. `chat/admin.js` handles the private dashboard.

The current Sheet has `Date Added` values for sorting. Featured Watches still has a placeholder because the Sheet has no featured markers. Customer feedback images were not supplied; the gallery and timed floating feedback activate when verified image URLs are added to `feedbackImages` in `window.GGM_CONFIG` in `worker/index.js`. Do not use unverified testimonials.

Browser QA injects a temporary zero-stock test fixture if needed to check the sold-out display and inquiry message; it does not change the Sheet or customer catalog.

The site shows Sheet images unchanged. Keep the Sheet's General access set to **Anyone with the link → Viewer**. The build downloads public brand-tab exports to copy embedded photos. The site does not write to the Sheet or change its sharing settings.

## Firebase Hosting

The Firebase project is `graceful-gifts-manila`. Hosting serves the static catalog and the Firebase Web SDK bundle for chat. Run `npm.cmd run build:firebase` to read the public Sheet and generate product HTML pages, catalog JSON, locally hosted copies of the spreadsheet images, and the chat/dashboard bundles. The browser reads the project's public Firebase web configuration from Hosting's `/__/firebase/init.json`; a local `firebase-config.local.json` can be used for emulator preview. `firebase.json` serves clean product and admin URLs. The export fails if the Sheet or workbook photos cannot be downloaded, so an incomplete catalog is not deployed silently.

The build uses public Sheet image links when available. For rows beyond Google's page preview, it reads image anchors from that brand tab's XLSX export and saves photos against their Watch IDs.

The GitHub workflow in `.github/workflows/firebase-hosting.yml` checks the Sheet every five minutes and runs a full rebuild hourly. Its encrypted `FIREBASE_SERVICE_ACCOUNT_GRACEFUL_GIFTS_MANILA` secret is used only for Firebase Hosting deployment and release retention. The live channel keeps one previous release so older rollback files do not fill the free Hosting storage. Google Sheets and Drive APIs are not required for the public Sheet build. Image filenames change when a source image changes, allowing refreshed photos to replace older cached versions.

For full-site refreshes shortly after staff edits the Sheet, install the bound [Sheet edit trigger](automation/README.md). It dispatches the same GitHub workflow after nearby edits settle. The five-minute scheduled checks remain a fallback for product changes made by scripts or APIs, and an hourly full build checks photos. The trigger requires a one-time Google Apps Script authorization and a repository-scoped GitHub Actions token stored in Apps Script Script Properties.

For a manual deployment from this folder, use the Firebase CLI after `npm.cmd run build:firebase`:

```powershell
firebase deploy --only hosting --project graceful-gifts-manila
```
