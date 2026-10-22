# Graceful Gifts Manila chat setup

## Photo and video messages (disabled implementation, October 22, 2026)

Customer and staff chat now support one photo or video per message, with an optional caption, upload progress, retry, and private inline viewing. A customer sends one text message first so that Storage rules can verify an existing conversation. The file picker accepts JPEG, PNG, WebP, GIF, MP4, WebM, and MOV. Still photos are reduced in the browser when possible; uploads are limited to 8 MB for the stored photo and 30 MB for video. MOV playback depends on the recipient's browser; a download link is shown for videos. Private media uses authenticated `getBlob()` reads, never shareable download-token URLs. Media loads only as bubbles approach the visible thread. Upload speed depends on the sender's connection, and video playback begins after the authorized download completes.

**Photo and video uploads remain disabled.** The build writes `/media-config.json` with `enabled:false` unless `GGM_CHAT_MEDIA_ENABLED=true`, and the Hosting workflow explicitly sets it to false. The attach controls stay hidden while off. This switch must remain off until the following setup is complete. Firebase [requires Blaze for Cloud Storage access](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024); do not upgrade billing without the owner's approval. Blaze has no-cost allowances, but storage, download traffic, operations, and Firestore reads made by Storage rules can incur usage charges. No third-party subscription or Cloud Function is needed for this implementation.

After the owner approves billing and release:

1. In Firebase Console, upgrade this project to **Blaze**, set a billing budget/alert, and create the Cloud Storage for Firebase default bucket. Keep the bucket name in the Firebase web app configuration (`storageBucket`); the Hosting reserved init JSON normally supplies it. Do not put service account credentials in the browser.
2. Deploy `storage.rules` and the updated `firestore.rules` with `firebase deploy --only firestore:rules,storage --project graceful-gifts-manila`. The Storage rules use Firestore staff and conversation documents. If Firebase asks to enable the Storage service account's Firestore access for cross-service rules, approve that project permission.
3. Apply the included `storage.cors.json` to the actual bucket: `gsutil cors set storage.cors.json gs://YOUR_BUCKET_NAME`. Replace the placeholder with the bucket shown in Firebase Console. The exact Hosting origin is listed in the file. Authenticated browser downloads need [bucket CORS](https://firebase.google.com/docs/storage/web/download-files#cors_configuration); there is no public read rule.
4. After explicit approval, change the Hosting workflow build environment value `GGM_CHAT_MEDIA_ENABLED` from `false` to `true`. Build and deploy Hosting only after the rules and CORS are active. Keep it false to disable new uploads; existing media messages remain viewable while Storage is accessible.
5. Test a customer photo and video from a separate browser/device, staff reply with photo and video, a 30 MB limit rejection, unauthorized media reads, reassignment, staff revocation, and phone playback. Monitor Firebase Console **Storage → Usage**, **Firestore → Usage**, and Cloud Billing after release. An upload can be left without a linked message if the Firestore send fails; review these orphan objects for manual cleanup. Do not apply a blanket expiration policy without deciding how long chat history should remain available. Consider Firebase App Check enforcement before substantial traffic.

For a local emulator test, put this gitignored public configuration in `firebase-config.local.json`:

```json
{"apiKey":"demo-key","authDomain":"demo-graceful-gifts-manila.firebaseapp.com","projectId":"demo-graceful-gifts-manila","appId":"1:123456789:web:demo","storageBucket":"demo-graceful-gifts-manila.firebasestorage.app","emulator":true}
```

Start `firebase emulators:start --only auth,firestore,storage --project demo-graceful-gifts-manila`. Build with `GGM_CHAT_MEDIA_ENABLED=true`, then run `npm run test:chat-rules` and `npm run test:chat-media-rules`. These tests use only the emulators. Do not deploy an emulator-configured artifact.

## What the repository now contains

- `chat/customer.js`: anonymous sign-in when chat opens, one persistent conversation per browser Auth UID, watch attachments, real-time messages, unread badge, history paging (40 messages), loading and sending states.
- `chat/admin.js`: individual email/password sign-in, real-time inbox, staff-only assigned queries, owner/admin assignment, status changes, replies, owner staff management, activity view, and a per-device sound control. Admin routes are `/admin/chat` and `/admin/staff`.
- `chat/firebase.js`: shared Firebase connection and transactional message writes. On Firebase Hosting it reads the public web configuration from `/__/firebase/init.json`. No service account or privileged credential goes to the browser.
- `chat/guest.js`: stable guest labels and geometric avatars derived from conversation IDs, with no third-party avatar service or Firestore write.
- `chat/push.js` and `chat/messaging-sw.js`: opt-in staff browser token registration and a worker ready to receive trusted data-only push messages. A sending backend has not been approved or deployed.
- `firestore.rules` and `firestore.indexes.json`: enforce anonymous customer isolation, active staff roles, assigned staff scope, message validation, timestamps, a three-second customer send interval, immutable messages, immutable owner access, and audit records for assignment/status changes. Roles live in Firestore `staff/{uid}` documents and are checked by rules on protected operations.
- The original Google Sheet catalog build, search, filters, favorites storage, product images, theme, and scheduled deployment workflow are retained.

## Production state and required setup

**Production state (October 21, 2026):** The existing chat and catalog are live at https://graceful-gifts-manila.web.app. The mobile UI, sound-default, guest identity, product preview, and push-registration changes described below are **local only**. They have not been pushed, had their updated token rules deployed, or been released to Hosting. The default Firestore database, anonymous and Email/Password Authentication, owner profile, and existing composite index are already configured. No new index is needed for the local changes.

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
4. **Rules and index:** Existing chat rules and the `assignedStaffUid` + `lastMessageAt` index are live. The new `staff/{uid}/pushTokens/{tokenId}` rules in this worktree require deployment before the push-registration UI is released. The existing index remains sufficient.
5. **Hosting:** Rebuild the complete catalog artifact and deploy Hosting only after updated rules are live and the owner explicitly approves this revision. The existing GitHub Action continues to refresh the catalog from the public Sheet; pushing to `main` would trigger a production deployment.
6. **Staff onboarding:** Create a separate email/password user for each staff member in Authentication **Users**. Copy that user's UID. Sign in as owner at `/admin/staff`, enter the UID, name, email, and `staff` or `admin` role, and grant access. Deliver each person's own initial password through a private channel and ask them to change it. Staff creation in the dashboard grants access to an already created Auth user; it does not create Auth credentials. Disable a person in the owner dashboard to deny future protected Firestore operations immediately, even if their Auth session remains signed in.

Firebase Hosting supplies the public web app configuration through its [reserved init JSON URL](https://firebase.google.com/docs/hosting/reserved-urls). It contains identifiers, not administrator secrets. For a non-Hosting preview, use a gitignored `firebase-config.local.json`; the build copies it to `hosting-dist/firebase-config.json`. Never put administrator passwords, service-account JSON, private keys, or privileged tokens in that file. The client uses `/__/firebase/init.json` first on Hosting. The local emulator configuration is read only on `localhost` or `127.0.0.1`.

## Data model

- `conversations/{customerUid}`: customer UID, optional customer-provided name/contact, status (`new`, `open`, `pending`, `resolved`), assigned staff UID or null, product references, latest message summary, sender, timestamps, and customer/staff read timestamps. The deterministic ID avoids duplicate conversations from the same retained anonymous session.
- `conversations/{customerUid}/messages/{messageId}`: immutable sender UID/role, text, server timestamp, and watch references. Message and summary are written in one transaction; rules require them to agree.
- `conversations/{customerUid}/receipts/{messageId}`: recipient-authenticated delivery time and optional seen time/reader UID. The sender can read the receipt but cannot write it. The recipient writes Delivered after a server-backed listener receives the message or its inbox summary; Seen is written only after the correct thread renders the bubble while the tab is visible and focused. The small circular marker means an authorized store representative saw a customer message, or the customer saw a staff reply. It does not imply that the owner personally read it.
- `staff/{authUid}`: owner, admin, or staff role; active flag; name, email, and creation metadata. Roles are enforced by Firestore rules, not by UI visibility.
- `auditLogs/{logId}`: immutable, rule-linked status and assignment records visible to the owner.
- `settings/chat`: optional owner-controlled `storeAvatarUrl` pointing to a same-site `/images/` asset. Sound preference is on by default in each browser; the user can mute it. Browsers still require a user gesture before audio can play.
- `staff/{authUid}/pushTokens/{tokenHash}`: the active staff member's own FCM registration token. Firestore rules prevent other clients from reading or writing it. Disabled staff cannot add a token; sign-out removes the browser's token. A trusted future sender must re-check active role and assignment before sending.

The client listens to at most 50 inbox summaries, 40 recent messages, and 100 recent receipts per open conversation. Older messages and their receipts, plus inbox pages, load on request. Staff queries include the assigned UID; rules reject wider reads. Listeners are removed when accounts or selected conversations change. The red inbox badge counts unread eligible conversations in the loaded inbox page (up to 50), not total unread messages across all pages.

## Notification and receipt behavior

- **Sending** means a local pending write; **Sent** means Firestore has acknowledged it; **Delivered** means a recipient-authenticated client has received that specific message or inbox summary; **Seen** means the recipient opened the correct thread and the message bubble was visible in a focused tab. Incoming bubbles have no outgoing status label.
- Old messages require no migration. They remain Sent until their recipient returns on the new client. If the recipient never returns, the sender should not expect Delivered or Seen. Receipts add one document write for delivery and one for seen, plus listener reads. The latest conversation read marker updates only after a Seen receipt exists.
- Sound preference is on by default. The first permitted tap or key press unlocks Web Audio; a separate enable action is unnecessary. A visible **Mute sounds** control remains. Browser autoplay policy, device volume/mute, and suspended tabs can still prevent sound. The chime waveform, pitch, and timing are unchanged.
- For a store picture, place an owner-approved WebP file at `chat/store-avatar.webp` (under 1 MB), rebuild, then set **Store avatar path** on `/admin/staff` to `/images/store-avatar.webp`. The owner setting accepts only same-site `/images/` paths. Without it, a round `G` appears. A missing/broken image falls back to `G`. The customer read marker uses a generic avatar; no customer upload is required.
- The chat CSS uses 16px or larger phone inputs and a visual-viewport-sized panel. A browser emulator can check layout and focus retention, but actual iOS Safari and Android keyboard behavior needs a device check before release.

## Background notification preparation

The local revision adds an explicit **Enable background alerts** action for signed-in staff, a root-scoped service worker, FCM token storage under that staff account, token removal on sign-out, and a click path to `/admin/chat?conversation=...`. The action stays hidden until a valid public VAPID key and browser support are present. The worker accepts **data-only** pushes with `kind=customer-message`, `conversationId`, and `messageId`; it suppresses a system notification when an admin tab is already visible, and uses the message ID as the notification tag. The live Firestore inbox still provides the foreground sound, badge, and visual notice.

**Automatic background delivery is not yet active.** No trusted message sender has been deployed and no billable service has been enabled. A browser cannot safely send FCM messages itself: it would expose privileged credentials and let customers choose recipients. The sender must run in a trusted environment, react only to newly created customer messages, read the latest conversation and active staff profiles, target owner/admin plus assigned staff only, remove expired tokens, and choose whether a preview may appear on the lock screen. It should send data-only payloads to avoid duplicate browser notifications. An owner-approved Cloud Functions trigger is one option; an existing trusted server could also send them. [Firebase says automated sends require a trusted server](https://firebase.google.com/docs/cloud-messaging/fcm-architecture); [Cloud Functions requires Blaze](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans). FCM itself is [no-cost](https://firebase.google.com/pricing); function invocation, networking, and related Firestore use can incur charges after the Blaze no-cost quotas. No billing upgrade or paid backend should be made without owner approval.

Before a future push release, in Firebase Console open **Project settings → Cloud Messaging → Web Push certificates**, generate a key pair, and put **only the public VAPID key** in the GitHub Actions secret `GGM_FCM_VAPID_PUBLIC_KEY`. The workflow writes it to public `/push-config.json`; this public key is not a service-account credential. Check that the FCM API is enabled. Deploy the token rules before Hosting. Staff then sign in on each Edge profile/device and click **Enable background alerts** to grant browser permission. Never paste a service-account key or private VAPID key into source, GitHub workflow text, or the browser config.

For Edge on Windows, allow notifications for the site in Edge and enable notifications for Edge under **Windows Settings → System → Notifications**. Windows Do Not Disturb, Edge background restrictions, OS sleep, an offline computer, and a fully terminated browser can delay or prevent delivery. The Windows notification sound is controlled by Windows, not the in-page chime. See [Edge push documentation](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push) and [Windows notification settings](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows). Real Edge minimized delivery must be tested after an approved trusted sender exists; the local worker test only simulates receiving a push.

**Release order after approval:** deploy `firestore.rules` first, then the rebuilt Hosting artifact. Token registration cannot work until its rules are live. Do not deploy an artifact built with `firebase-config.local.json` or an emulator `firebase-config.json`. The deployed site uses Firebase Hosting's reserved public configuration URL.

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
npm run test:push-worker
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

Use Firebase Console **Firestore → Usage**, **Authentication → Usage/Users**, **Hosting → Usage**, and **Firestore → Indexes** after launch. The UI shows permission, connection, and send errors; the local tests cover role denial and revocation. Real-time in-page indicators work while the site or dashboard is open. The browser-side push registration is prepared but automatic background sending, automatic Auth-user creation from the owner dashboard, and stronger abuse controls such as server-side IP throttling still require a trusted backend. No paid backend has been introduced. Anonymous customers recover history only while their browser retains its Firebase Auth storage; clearing storage or switching browsers creates a new conversation. The three-second rule rate limit reduces repeat sends by one anonymous identity but cannot stop a determined user from creating fresh anonymous identities. Consider Firebase App Check before higher traffic or abuse exposure.

## Chat moderation (October 22, 2026)

The chat header no longer has a status selector, and the inbox no longer has a status filter. Owner and admin accounts see a three-dot conversation menu. Both roles can block and unblock the selected anonymous customer; only the owner can permanently delete a chat. Staff cannot use either action. Firestore rules enforce these limits and log block, unblock, and delete actions in owner-visible `auditLogs`.

Blocking records the customer's anonymous Firebase Auth UID in `blockedCustomers/{uid}`. The rules then reject reads, sends, and receipt writes from that UID; staff replies to that blocked chat are also disabled. Unblocking restores access. A visitor who clears site data or uses another browser gets a new anonymous UID, so this is a session-identity block, not a permanent person or IP ban. Stronger abuse controls require a trusted backend or App Check.

Delete asks for confirmation, temporarily blocks new messages, removes messages and receipts in batches, removes any attached media when Storage is available, then deletes the conversation and temporary block together. A pre-existing block record survives deletion. Because that visitor no longer has an inbox row, an owner who later wants to lift such a block must delete `blockedCustomers/{CUSTOMER_UID}` in Firebase Console → Firestore → Data; use the deleted conversation ID from the owner audit log. If a batch fails, reopen the chat and retry or unblock the visitor; the temporary block remains until then. Deleted messages cannot be recovered through the dashboard. Deletion adds Firestore delete operations; the block record and audit entry add small numbers of reads and writes. No paid service is enabled for moderation.

Deploy `firestore.rules` before Hosting. The existing GitHub Actions workflow deploys Hosting from `main` but does not deploy Firestore rules. The media upload feature remains off unless `GGM_CHAT_MEDIA_ENABLED` is explicitly set to `true`; no Storage billing or bucket setup is required for chat moderation.
