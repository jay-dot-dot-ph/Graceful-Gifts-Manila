# Chat UI and message receipts (local implementation)

This upgrade is **not deployed**. The live site continues to use its previous chat until the owner explicitly approves a production release. It changes only the existing chat, admin inbox, product inquiry snapshot, Firestore rules, and their tests. The Google Sheets catalog adapter and scheduled refresh are unchanged.

## Receipt meanings

| Label | Evidence |
| --- | --- |
| Sending | A local pending message has not been confirmed by Firestore. The Send action is disabled until the attempt resolves. |
| Sent | The transaction completed and the message exists in Firestore. This does not imply a recipient received it. |
| Delivered | The recipient's synced, visible customer page or authorized staff inbox received the conversation summary containing that message ID and wrote a receipt on that message. For customer messages, the first currently authorized owner/admin or assigned staff device to acknowledge counts. |
| Seen | The recipient opened the thread in a visible, focused tab and the message bubble intersected the thread viewport. Its receipt is written by that recipient. An inbox preview alone does not mark Seen. |
| Failed / Retry | The client did not receive a successful send confirmation. Retry reuses the same 20-character message ID; the transaction returns the existing message if a previous attempt committed, preventing a duplicate. |

These states are conservative. A hidden or offline recipient remains **Sent** until a qualifying receipt arrives. A message can move directly from Sent to Seen when a recipient opens it before a separate delivery receipt. An authorized user could technically call Firestore directly to acknowledge without reading; security rules can enforce identity and immutable receipt fields, but cannot prove a human looked at the screen.

## Data and compatibility

New messages still use `conversations/{customerUid}/messages/{messageId}`. Optional message fields are `deliveredAt`, `deliveredByUid`, `seenAt`, and `seenByUid`. Firestore server timestamps and rules make them write-once. The existing `customerReadAt` and `staffReadAt` conversation fields remain unread watermarks; the new client advances them only when the latest incoming message is visibly Seen. Existing messages need no migration and display Sent until a new receipt is earned.

Product snapshots keep the existing ID, name, brand, price, image, and URL, and can now include catalog-provided `size` and `stock`. Empty size and unknown stock are omitted. Images remain existing `/images/` catalog files; broken images fall back to a text mark. The product link is reconstructed from the validated Watch ID. The rules accept both old and new product snapshots. Legacy cached clients can still send messages while the new rules roll out, but their former read-watermark-only action will no longer mark Seen; refreshing to the new client restores that behavior.

No new index or data migration is required. No Cloud Functions, push service, or Blaze-only service was added. A typical message still uses two writes (message plus conversation summary); delivery and Seen add up to two message writes and one read-watermark write. Opening an inbox can cause additional receipt checks, so monitor Firestore reads and writes under real usage.

## Local verification

Use the Auth and Firestore emulators and the gitignored local emulator configuration described in [CHAT_SETUP.md](CHAT_SETUP.md). Then run:

```powershell
npm run build:firebase
npm run dev
npm run test:chat-ui-unit
npm run test:chat-rules
npm run test:chat-browser
npm run test:unit
npm run test:live
npm run test:browser
npm run test:history
npm run test:search
npm run test:opening
```

Run the rules and chat browser tests against the emulator only. Do not put emulator configuration into a production build.

## Production release after owner approval

1. Review the diff and verify that `hosting-dist/firebase-config.json` is `{}` for Firebase Hosting. Hosting uses its reserved `/__/firebase/init.json` web configuration.
2. Deploy `firestore.rules` first with `firebase deploy --only firestore:rules --project graceful-gifts-manila`. The existing index file is unchanged.
3. Build and verify the Hosting artifact, then deploy Hosting. A push to `main` also triggers the existing automatic Hosting workflow, so do not push to `main` before approval.
4. Test a customer inquiry, owner reply, inbox-only Delivered, visible-thread Seen, staff assignment, and a mobile chat on the live site. Use real accounts without sharing passwords or service-account keys.

There is no Firebase Console setting to add for this upgrade. Authentication providers, the owner account, and Firestore already exist.
