# Rebuild the Firebase catalog after Sheet edits

The public Firebase site is a static export of the **2026 WATCHES - GRACE** spreadsheet. This bound Google Apps Script requests the existing GitHub Actions build after staff edits the Sheet. The build reads the brand tabs, exports current product details and photos, and deploys to Firebase Hosting. Nearby edits are batched into one request after at least 30 seconds of quiet time; the one-minute Apps Script timer and GitHub/Firebase build add a few more minutes. The six-hour GitHub schedule remains a fallback.

## One-time setup

1. While signed in as `jay-dot-dot-ph`, create a [fine-grained GitHub personal access token](https://github.com/settings/personal-access-tokens/new) with resource owner `jay-dot-dot-ph`, access limited to **Graceful-Gifts-Manila**, and repository **Actions: Read and write** permission. Choose an expiry and save a reminder to renew it. Do not add the token to this repository or send it in chat.
2. Open the [2026 WATCHES - GRACE Sheet](https://docs.google.com/spreadsheets/d/1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8/edit). Choose **Extensions → Apps Script**. Replace the bound project's `Code.gs` contents with [sheet-edit-trigger.gs](sheet-edit-trigger.gs), then save.
3. In Apps Script **Project Settings → Script Properties**, add `GITHUB_ACTIONS_TOKEN` with the token as its value.
4. Select `setupSheetTriggers` in the function menu, click **Run**, and approve the Google authorization prompts. This installs the edit, change, and one-minute timer triggers. Re-running setup replaces only these three triggers.
5. Select `requestCatalogRefresh` and click **Run** once. Check [GitHub Actions](https://github.com/jay-dot-dot-ph/Graceful-Gifts-Manila/actions/workflows/firebase-hosting.yml) for a new `workflow_dispatch` run, then check the [live catalog](https://graceful-gifts-manila.web.app). `getSheetTriggerStatus` reports the last dispatch and any dispatch error without displaying the token.

The trigger responds to manual edits and spreadsheet changes. Google does not run edit triggers for values changed by scripts or API requests; the six-hour scheduled build still checks those changes. After a dispatch error, the timer retries with increasing delays up to five times, then pauses. `getSheetTriggerStatus` shows the error and paused state; correct the token or access problem and run `requestCatalogRefresh` to retry. If a build fails, the existing live site stays published; inspect the GitHub run for the error.

The token grants workflow-dispatch access to this repository, so only trusted Sheet/Apps Script editors should have access to the bound script. Rotate the token in Script Properties when it expires or if its access should be revoked.
