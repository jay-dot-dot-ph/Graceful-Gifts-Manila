# Graceful Gifts Manila chat setup

## What the repository now contains

- `chat/customer.js`: anonymous sign-in when chat opens, one persistent conversation per browser Auth UID, watch attachments, real-time messages, unread badge, history paging (40 messages), loading and sending states.
- `chat/admin.js`: individual email/password sign-in, real-time inbox, staff-only assigned queries, owner/admin assignment, status changes, replies, owner staff management, activity view, and a per-device sound control. Admin routes are `/admin/chat` and `/admin/staff`.
- `chat/firebase.js`: shared Firebase connection and transactional message writes. On Firebase Hosting it reads the public web configuration from `/__/firebase/init.json`. No service account or privileged credential goes to the browser.
- `firestore.rules` and `firestore.indexes.json`: enforce anonymous customer isolation, active staff roles, assigned staff scope, message validation, timestamps, a three-second customer send interval, immutable messages, immutable owner access, and audit records for assignment/status changes. Roles live in Firestore `staff/{uid}` documents and are checked by rules on protected operations.
- The original Google Sheet catalog build, search, filters, favorites storage, product images, theme, and scheduled deployment workflow are retained.

## Production state and required setup

**Production state (October 21, 2026):** The default Firestore database exists in the free-tier `nam5` location. A Firebase CLI `--dry-run` unexpectedly created it during initial setup; do not create a second database. Anonymous and Email/Password Authentication are enabled, and the current email/password owner user has an active `staff/{uid}` profile. The earlier chat and catalog are live at https://graceful-gifts-manila.web.app. The notification and receipt changes in this worktree are **local only**; their updated rules and Hosting files have not been deployed. The existing composite index is Ready. No new index is needed for receipts.

The original setup steps 1–5 were completed for the earlier live version. The notification release described below is still pending approval:

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
4. **Rules and index (earlier release complete):** The previous rules and the `assignedStaffUid` + `lastMessageAt` index were deployed. The updated receipt rules in this worktree still need deployment after approval; the existing index remains sufficient.
5. **Hosting (earlier release complete):** The previous site was deployed after approval. The current notification UI is local only. Rebuild the complete catalog artifact and deploy Hosting only after the updated rules are live and the owner approves release. The existing GitHub Action continues to refresh the catalog from the public Sheet.
6. **Staff onboarding:** Create a separate email/password user for each staff member in Authentication **Users**. Copy that user's UID. Sign in as owner at `/admin/staff`, enter the UID, name, email, and `staff` or `admin` role, and grant access. Deliver each person's own initial password through a private channel and ask them to change it. Staff creation in the dashboard grants access to an already created Auth user; it does not create Auth credentials. Disable a person in the owner dashboard to deny future protected Firestore operations immediately, even if their Auth session remains signed in.

Firebase Hosting supplies the public web app configuration through its [reserved init JSON URL](https://firebase.google.com/docs/hosting/reserved-urls). It contains identifiers, not administrator secrets. For a non-Hosting preview, use a gitignored `firebase-config.local.json`; the build copies it to `hosting-dist/firebase-config.json`. Never put administrator passwords, service-account JSON, private keys, or privileged tokens in that file. The client uses `/__/firebase/init.json` first on Hosting. The local emulator configuration is read only on `localhost` or `127.0.0.1`.

## Data model

- `conversations/{customerUid}`: customer UID, optional customer-provided name/contact, status (`new`, `open`, `pending`, `resolved`), assigned staff UID or null, product references, latest message summary, sender, timestamps, and customer/staff read timestamps. The deterministic ID avoids duplicate conversations from the same retained anonymous session.
- `conversations/{customerUid}/messages/{messageId}`: immutable sender UID/role, text, server timestamp, and watch references. Message and summary are written in one transaction; rules require them to agree.
- `conversations/{customerUid}/receipts/{messageId}`: recipient-authenticated delivery time and optional seen time/reader UID. The sender can read the receipt but cannot write it. The recipient writes Delivered after a server-backed listener receives the message or its inbox summary; Seen is written only after the correct thread renders the bubble while the tab is visible and focused. The small circular marker means an authorized store representative saw a customer message, or the customer saw a staff reply. It does not imply that the owner personally read it.
- `staff/{authUid}`: owner, admin, or staff role; active flag; name, email, and creation metadata. Roles are enforced by Firestore rules, not by UI visibility.
- `auditLogs/{logId}`: immutable, rule-linked status and assignment records visible to the owner.
- `settings/chat`: optional owner-controlled `storeAvatarUrl` pointing to a same-site `/images/` asset. Sound preference is stored separately in each browser's local storage and needs a click on **Enable sounds** in that browser.

The client listens to at most 50 inbox summaries, 40 recent messages, and 100 recent receipts per open conversation. Older messages and their receipts, plus inbox pages, load on request. Staff queries include the assigned UID; rules reject wider reads. Listeners are removed when accounts or selected conversations change. The red inbox badge counts unread eligible conversations in the loaded inbox page (up to 50), not total unread messages across all pages.

## Notification and receipt behavior

- **Sending** means a local pending write; **Sent** means Firestore has acknowledged it; **Delivered** means a recipient-authenticated client has received that specific message or inbox summary; **Seen** means the recipient opened the correct thread and the message bubble was visible in a focused tab. Incoming bubbles have no outgoing status label.
- Old messages require no migration. They remain Sent until their recipient returns on the new client. If the recipient never returns, the sender should not expect Delivered or Seen. Receipts add one document write for delivery and one for seen, plus listener reads. The latest conversation read marker updates only after a Seen receipt exists.
- Sound is off until the user clicks **Enable sounds** on each browser/device. The click unlocks Web Audio and plays a short test tone. Notifications while the page is open also show a visual notice if sound is off or blocked. Mobile OS mute, browser autoplay policy, hidden/suspended tabs, and background operation can prevent sound. There is no background push service.
- For a store picture, place an owner-approved WebP file at `chat/store-avatar.webp` (under 1 MB), rebuild, then set **Store avatar path** on `/admin/staff` to `/images/store-avatar.webp`. The owner setting accepts only same-site `/images/` paths. Without it, a round `G` appears. A missing/broken image falls back to `G`. The customer read marker uses a generic avatar; no customer upload is required.
- The chat CSS uses 16px or larger phone inputs and a visual-viewport-sized panel. A browser emulator can check layout and focus retention, but actual iOS Safari and Android keyboard behavior needs a device check before release.

**Release order after approval:** deploy `firestore.rules` first, then the rebuilt Hosting artifact. The old clients cannot write new receipts; deploying Hosting before rules would make delivery/read status fail. No Console switch or new index is required. Do not deploy an artifact built with `firebase-config.local.json` or an emulator `firebase-config.json`. The deployed site uses Firebase Hosting's reserved public configuration URL.

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
