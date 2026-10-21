# Graceful Gifts Manila chat setup

## What the repository now contains

- `chat/customer.js`: anonymous sign-in when chat opens, one persistent conversation per browser Auth UID, watch attachments, real-time messages, unread badge, history paging (40 messages), loading and sending states.
- `chat/admin.js`: individual email/password sign-in, real-time inbox, staff-only assigned queries, owner/admin assignment, status changes, replies, owner staff management, activity view, and a staff sound-alert setting. Admin routes are `/admin/chat` and `/admin/staff`.
- `chat/firebase.js`: shared Firebase connection and transactional message writes. On Firebase Hosting it reads the public web configuration from `/__/firebase/init.json`. No service account or privileged credential goes to the browser.
- `firestore.rules` and `firestore.indexes.json`: enforce anonymous customer isolation, active staff roles, assigned staff scope, message validation, timestamps, a three-second customer send interval, immutable messages, immutable owner access, and audit records for assignment/status changes. Roles live in Firestore `staff/{uid}` documents and are checked by rules on protected operations.
- The original Google Sheet catalog build, search, filters, favorites storage, product images, theme, and scheduled deployment workflow are retained.

## Production state and required setup

**Production state (October 21, 2026):** The default Firestore database exists in the free-tier `nam5` location. A Firebase CLI `--dry-run` unexpectedly created it during initial setup; do not create a second database. Anonymous and Email/Password Authentication are enabled, and the current email/password owner user has an active `staff/{uid}` profile. With the owner's approval, `firestore.rules` and `firestore.indexes.json` were deployed. The deployed rules match this repository, and the composite index is Ready. With the owner's later approval, Hosting was deployed to https://graceful-gifts-manila.web.app. The live catalog fingerprint matched the tested build, the browser catalog journey passed, a real anonymous chat opened with an attached watch, and the admin route required login. Production staff login and message exchange still require a manual check with the owner's private credentials.

Steps 1–5 are complete. Step 6 is the remaining owner action:

1. **Firestore (complete):** The `(default)` database exists in `nam5`. The deployed rules replace the initial deny-all rules with customer and staff authorization.
2. **Authentication (complete):** Anonymous and Email/Password providers are enabled. Phone sign-in and Identity Platform are not needed.
3. **Initial owner (complete):** The current email/password Auth user's UID has a matching Firestore `staff/{OWNER_UID}` document with:

   | Field | Type | Value |
   | --- | --- | --- |
   | `displayName` | string | Your name |
   | `email` | string | Same email as the Auth user |
   | `role` | string | `owner` |
   | `active` | boolean | `true` |
   | `createdAt` | timestamp | Current time |
   | `createdBy` | string | `initial-setup` |

   The current owner profile was created through authenticated privileged project access after verifying the Auth UID. Public clients cannot create an owner. Rules prevent the only owner from being disabled, deleted, or changed through the dashboard. Keep Firebase Console access restricted to the actual owner.
4. **Rules and index (complete):** `firebase deploy --only firestore:rules,firestore:indexes --project graceful-gifts-manila` completed successfully. The `assignedStaffUid` + `lastMessageAt` composite index reached **Ready** before Hosting publication.
5. **Hosting (complete):** After explicit approval, `npm ci`, `npm run build:firebase`, and the tests below passed. `firebase deploy --only hosting --project graceful-gifts-manila` published the new site. The existing GitHub Action continues to refresh the catalog from the public Sheet.
6. **Staff onboarding:** Create a separate email/password user for each staff member in Authentication **Users**. Copy that user's UID. Sign in as owner at `/admin/staff`, enter the UID, name, email, and `staff` or `admin` role, and grant access. Deliver each person's own initial password through a private channel and ask them to change it. Staff creation in the dashboard grants access to an already created Auth user; it does not create Auth credentials. Disable a person in the owner dashboard to deny future protected Firestore operations immediately, even if their Auth session remains signed in.

Firebase Hosting supplies the public web app configuration through its [reserved init JSON URL](https://firebase.google.com/docs/hosting/reserved-urls). It contains identifiers, not administrator secrets. For a non-Hosting preview, use a gitignored `firebase-config.local.json`; the build copies it to `hosting-dist/firebase-config.json`. Never put administrator passwords, service-account JSON, private keys, or privileged tokens in that file. The client uses `/__/firebase/init.json` first on Hosting. The local emulator configuration is read only on `localhost` or `127.0.0.1`.

## Data model

- `conversations/{customerUid}`: customer UID, optional customer-provided name/contact, status (`new`, `open`, `pending`, `resolved`), assigned staff UID or null, product references, latest message summary, sender, timestamps, and customer/staff read timestamps. The deterministic ID avoids duplicate conversations from the same retained anonymous session.
- `conversations/{customerUid}/messages/{messageId}`: immutable sender UID/role, text, server timestamp, and watch references. Message and summary are written in one transaction; rules require them to agree.
- `staff/{authUid}`: owner, admin, or staff role; active flag; name, email, and creation metadata. Roles are enforced by Firestore rules, not by UI visibility.
- `auditLogs/{logId}`: immutable, rule-linked status and assignment records visible to the owner.
- `settings/chat`: owner-controlled, staff-readable optional sound alert preference for new customer messages while the dashboard is open.

The client listens to at most 50 inbox summaries and 40 recent messages per open conversation. Older messages and inbox pages load on request. Staff queries include the assigned UID; rules reject wider reads. Listeners are removed when accounts or selected conversations change.

## Local checks

Use Node.js 24 or later for the documented build environment. The test machine also ran these checks with Node.js 22. To test live chat locally, start Auth and Firestore emulators using the `firebase.json` configuration and a Java 21 runtime. Set `firebase-config.local.json` to:

```json
{"apiKey":"demo-key","authDomain":"demo-graceful-gifts-manila.firebaseapp.com","projectId":"demo-graceful-gifts-manila","appId":"1:123456789:web:demo","emulator":true}
```

Then run:

```powershell
firebase emulators:start --only auth,firestore --project demo-graceful-gifts-manila
npm ci
npm run build:firebase
npm run dev
npm run test:chat-rules
npm run test:chat-browser
npm run test:unit
npm run test:live
npm run test:browser
npm run test:history
npm run test:search
npm run test:opening
```

The browser chat test uses local emulators and Microsoft Edge. It creates test Auth users and Firestore records only in the emulators. The catalog build still reads the public Google Sheet.

## Costs, monitoring, and limits

The implementation uses Spark-compatible Firebase Authentication, Cloud Firestore, and Hosting; it does **not** enable Blaze or deploy Cloud Functions. [Firestore's free database quota](https://firebase.google.com/docs/firestore/pricing) is currently 50,000 document reads/day, 20,000 writes/day, 1 GiB stored, and 10 GiB outbound/month. A message normally writes one message plus one conversation summary, so 1,000 messages/day are roughly 2,000 writes before status, assignment, and read acknowledgments. Listener reads vary with the number of open dashboards and messages; monitor actual usage rather than treating that example as a bill prediction. The existing catalog images also consume [Hosting storage and transfer](https://firebase.google.com/docs/hosting/usage-quotas-pricing). On Spark, service requests may stop at quota rather than incur overage charges. Firebase usage cost is separate from development cost.

Use Firebase Console **Firestore → Usage**, **Authentication → Usage/Users**, **Hosting → Usage**, and **Firestore → Indexes** after launch. The UI shows permission, connection, and send errors; the local tests cover role denial and revocation. Real-time in-page indicators work while the site or dashboard is open. Background push, automatic Auth-user creation from the owner dashboard, and stronger abuse controls such as server-side IP throttling would require a trusted backend; [Cloud Functions requires Blaze](https://firebase.google.com/docs/functions). No paid backend has been introduced. Anonymous customers recover history only while their browser retains its Firebase Auth storage; clearing storage or switching browsers creates a new conversation. The three-second rule rate limit reduces repeat sends by one anonymous identity but cannot stop a determined user from creating fresh anonymous identities. Consider Firebase App Check before higher traffic or abuse exposure.
