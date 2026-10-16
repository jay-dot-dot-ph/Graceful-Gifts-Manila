// Copy this file into the Apps Script project bound to the 2026 WATCHES - GRACE Sheet.
// Store the repository-scoped GitHub token in Script Properties as GITHUB_ACTIONS_TOKEN.
const GGM_SHEET_ID = '1YL-EBPWoU3nUNtUwr1GPtlqOUWY7e2GDLCtw8YCwge8';
const GGM_WORKFLOW_URL = 'https://api.github.com/repos/jay-dot-dot-ph/Graceful-Gifts-Manila/actions/workflows/firebase-hosting.yml/dispatches';
const GGM_PENDING_KEY = 'GGM_PENDING_EDIT_AT';
const GGM_FIRST_PENDING_KEY = 'GGM_FIRST_PENDING_EDIT_AT';
const GGM_LAST_DISPATCH_KEY = 'GGM_LAST_DISPATCH_AT';
const GGM_LAST_ERROR_KEY = 'GGM_LAST_DISPATCH_ERROR';
const GGM_ATTEMPTS_KEY = 'GGM_DISPATCH_ATTEMPTS';
const GGM_NEXT_ATTEMPT_KEY = 'GGM_NEXT_DISPATCH_ATTEMPT_AT';
const GGM_PAUSED_KEY = 'GGM_DISPATCH_PAUSED';
const GGM_TOKEN_KEY = 'GITHUB_ACTIONS_TOKEN';
const GGM_DEBOUNCE_MS = 30 * 1000;
const GGM_MAX_WAIT_MS = 10 * 60 * 1000;
const GGM_MAX_ATTEMPTS = 5;

// Run once from the Apps Script editor after setting GITHUB_ACTIONS_TOKEN.
function setupSheetTriggers() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== GGM_SHEET_ID) {
    throw new Error('Open the 2026 WATCHES - GRACE spreadsheet before installing these triggers.');
  }
  if (!PropertiesService.getScriptProperties().getProperty(GGM_TOKEN_KEY)) {
    throw new Error('Set GITHUB_ACTIONS_TOKEN in Project Settings > Script Properties first.');
  }
  const handlers = ['markSheetChanged', 'dispatchPendingSheetChange'];
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (handlers.includes(trigger.getHandlerFunction())) ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('markSheetChanged').forSpreadsheet(spreadsheet).onEdit().create();
  ScriptApp.newTrigger('markSheetChanged').forSpreadsheet(spreadsheet).onChange().create();
  ScriptApp.newTrigger('dispatchPendingSheetChange').timeBased().everyMinutes(1).create();
  return getSheetTriggerStatus();
}

// The edit and change triggers only mark the Sheet as dirty. They never send a request per cell.
function markSheetChanged(event) {
  if (!event || !event.source || event.source.getId() !== GGM_SHEET_ID) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty(GGM_FIRST_PENDING_KEY)) properties.setProperty(GGM_FIRST_PENDING_KEY, String(Date.now()));
    properties.setProperty(GGM_PENDING_KEY, String(Date.now()));
  } finally {
    lock.releaseLock();
  }
}

// Runs every minute and sends one rebuild request after edits have settled.
function dispatchPendingSheetChange() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const pending = Number(properties.getProperty(GGM_PENDING_KEY));
    const firstPending = Number(properties.getProperty(GGM_FIRST_PENDING_KEY));
    if (!pending || properties.getProperty(GGM_PAUSED_KEY) === 'true') return;
    if (Date.now() - pending < GGM_DEBOUNCE_MS && Date.now() - firstPending < GGM_MAX_WAIT_MS) return;
    if (Date.now() < Number(properties.getProperty(GGM_NEXT_ATTEMPT_KEY))) return;
    const token = properties.getProperty(GGM_TOKEN_KEY);
    if (!token) {
      const error = 'GITHUB_ACTIONS_TOKEN is missing from Script Properties.';
      recordDispatchFailure(properties, error);
      throw new Error(error);
    }

    let response;
    try {
      response = UrlFetchApp.fetch(GGM_WORKFLOW_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        payload: JSON.stringify({ ref: 'main' }),
        muteHttpExceptions: true,
      });
    } catch (error) {
      recordDispatchFailure(properties, 'GitHub request failed');
      throw error;
    }
    const status = response.getResponseCode();
    if (status !== 200 && status !== 204) {
      const error = 'GitHub workflow dispatch returned HTTP ' + status;
      recordDispatchFailure(properties, error);
      throw new Error(error);
    }
    properties.deleteProperty(GGM_PENDING_KEY);
    properties.deleteProperty(GGM_FIRST_PENDING_KEY);
    properties.deleteProperty(GGM_LAST_ERROR_KEY);
    properties.deleteProperty(GGM_ATTEMPTS_KEY);
    properties.deleteProperty(GGM_NEXT_ATTEMPT_KEY);
    properties.setProperty(GGM_LAST_DISPATCH_KEY, String(Date.now()));
  } finally {
    lock.releaseLock();
  }
}

function recordDispatchFailure(properties, message) {
  const attempts = Number(properties.getProperty(GGM_ATTEMPTS_KEY)) + 1;
  properties.setProperty(GGM_ATTEMPTS_KEY, String(attempts));
  properties.setProperty(GGM_LAST_ERROR_KEY, message);
  if (attempts >= GGM_MAX_ATTEMPTS) {
    properties.setProperty(GGM_PAUSED_KEY, 'true');
  } else {
    properties.setProperty(GGM_NEXT_ATTEMPT_KEY, String(Date.now() + Math.pow(2, attempts - 1) * 60 * 1000));
  }
}

// Run this once after setup to verify a workflow dispatch without editing a product.
function requestCatalogRefresh() {
  const properties = PropertiesService.getScriptProperties();
  properties.deleteProperty(GGM_PAUSED_KEY);
  properties.deleteProperty(GGM_ATTEMPTS_KEY);
  properties.deleteProperty(GGM_NEXT_ATTEMPT_KEY);
  properties.setProperty(GGM_FIRST_PENDING_KEY, String(Date.now() - GGM_DEBOUNCE_MS));
  properties.setProperty(GGM_PENDING_KEY, String(Date.now() - GGM_DEBOUNCE_MS));
  dispatchPendingSheetChange();
  return getSheetTriggerStatus();
}

function getSheetTriggerStatus() {
  const properties = PropertiesService.getScriptProperties();
  const timestamp = (key) => {
    const value = properties.getProperty(key);
    return value ? new Date(Number(value)).toISOString() : null;
  };
  return {
    installedTriggers: ScriptApp.getProjectTriggers().map((trigger) => trigger.getHandlerFunction()),
    pendingEditAt: timestamp(GGM_PENDING_KEY),
    lastDispatchAt: timestamp(GGM_LAST_DISPATCH_KEY),
    lastError: properties.getProperty(GGM_LAST_ERROR_KEY),
    retryAttempts: Number(properties.getProperty(GGM_ATTEMPTS_KEY)) || 0,
    paused: properties.getProperty(GGM_PAUSED_KEY) === 'true',
    tokenConfigured: Boolean(properties.getProperty(GGM_TOKEN_KEY)),
  };
}
