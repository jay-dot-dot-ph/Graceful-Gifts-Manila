import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'sheet-edit-trigger.gs'), 'utf8');
const sheetId = '1qowXiNelPflvWPYv1lWWCf7z9AnltCL5Tem8Sus-arI';
const values = new Map([['GITHUB_ACTIONS_TOKEN', 'test-token-never-sent-to-github']]);
const triggers = [];
const calls = [];
let now = 1_000_000;
let responseCode = 204;
const properties = {
  getProperty: (key) => values.get(key) ?? null,
  setProperty: (key, value) => { values.set(key, value); },
  deleteProperty: (key) => { values.delete(key); },
};
const newTrigger = (name) => ({
  forSpreadsheet: () => ({
    onEdit: () => ({ create: () => triggers.push({ name }) }),
    onChange: () => ({ create: () => triggers.push({ name }) }),
  }),
  timeBased: () => ({ everyMinutes: (minutes) => ({ create: () => { assert.equal(minutes, 1); triggers.push({ name }); } }) }),
});
const context = {
  Date: class extends Date { static now() { return now; } },
  JSON,
  Number,
  String,
  Boolean,
  Error,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => sheetId }) },
  PropertiesService: { getScriptProperties: () => properties },
  ScriptApp: {
    getProjectTriggers: () => triggers.map((trigger) => ({ getHandlerFunction: () => trigger.name, trigger })),
    deleteTrigger: (wrapper) => { triggers.splice(triggers.indexOf(wrapper.trigger), 1); },
    newTrigger,
  },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
  UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return { getResponseCode: () => responseCode }; } },
};
runInNewContext(source, context);
context.setupSheetTriggers();
assert.equal(triggers.length, 3);
context.setupSheetTriggers();
assert.equal(triggers.length, 3, 'setup must not duplicate triggers');
context.markSheetChanged({ source: { getId: () => sheetId } });
now += 20_000;
context.markSheetChanged({ source: { getId: () => sheetId } });
now += 20_000;
context.dispatchPendingSheetChange();
assert.equal(calls.length, 0, 'nearby edits should be batched');
now += 20_000;
context.dispatchPendingSheetChange();
assert.equal(calls.length, 1);
assert.deepEqual(JSON.parse(calls[0].options.payload), { ref: 'main' });
assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token-never-sent-to-github');
assert.equal(context.getSheetTriggerStatus().pendingEditAt, null);
assert.equal(JSON.stringify(context.getSheetTriggerStatus()).includes('test-token'), false);
context.markSheetChanged({ source: { getId: () => sheetId } });
now += 40_000;
responseCode = 403;
assert.throws(() => context.dispatchPendingSheetChange(), /HTTP 403/);
assert.equal(context.getSheetTriggerStatus().pendingEditAt !== null, true, 'failed dispatch must remain pending');
responseCode = 204;
now += 60_000;
context.dispatchPendingSheetChange();
assert.equal(context.getSheetTriggerStatus().pendingEditAt, null);
assert.equal(context.getSheetTriggerStatus().lastError, null);
context.markSheetChanged({ source: { getId: () => sheetId } });
now += 40_000;
responseCode = 403;
for (let attempt = 0; attempt < 5; attempt++) {
  assert.throws(() => context.dispatchPendingSheetChange(), /HTTP 403/);
  now += Math.pow(2, attempt) * 60_000;
}
assert.equal(context.getSheetTriggerStatus().paused, true);
const attemptedCalls = calls.length;
context.dispatchPendingSheetChange();
assert.equal(calls.length, attemptedCalls, 'paused trigger must stop retrying');
responseCode = 204;
context.requestCatalogRefresh();
assert.equal(context.getSheetTriggerStatus().paused, false);
assert.equal(context.getSheetTriggerStatus().pendingEditAt, null);
console.log('Sheet edit trigger batching, dispatch, and retry checks passed.');
