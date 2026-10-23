// The machine-readable expectation of a fault case (G7-03a, UNI-1380; review r1
// R1-2). `docs/office/g5g6g7/fault/cases.json` `expect` is the ONE place a
// case's numbers live: the server and app drivers read them from here instead
// of hard-coding the same values, so the matrix and the assertion cannot drift.
// A key a driver does not read is a `cases.test.mjs` / `server-cases.test.mjs`
// failure; a key a driver needs and the row lacks throws when the driver asks.
//
//   expect.server      versionDelta (int; a run with another number carries it in its exit's own expect),
//                      versionDeltaAfterAi, lookup {status, outcome?, errorCode?},
//                      statuses {step: int | "dropped" | "reset" | int[]},
//                      errorCodes {step: code}
//   expect.proxyLog    counts / status lists over the proxy log (PROXY_LOG_KEYS)
//   expect.clientPath  the intent's state path (matchStatePath pattern)
//   expect.clientIntents, expect.clientIntentsWhileFull   trace intent counts
//   expect.notes       prose of the matrix columns; never asserted
//
// An exit of a multi-exit row may carry `expect` with the same shape: it is
// merged over the row's (a key it names replaces the row's).

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isStatus = (value) => isCount(value) || (typeof value === "string" && value !== "");

const TOP_KEYS = new Set(["server", "proxyLog", "clientPath", "clientIntents", "clientIntentsWhileFull", "offline", "notes"]);
const SERVER_KEYS = new Set(["versionDelta", "versionDeltaAfterAi", "lookup", "statuses", "errorCodes"]);
const LOOKUP_KEYS = new Set(["status", "outcome", "errorCode"]);

/**
 * The offline-library states of the fork's S3 rows (`OFFLINE_ROW_STATES`,
 * apps/shell/src/shared/offline-library.ts): the values `expect.offline.*States`
 * may name, so a typo in cases.json fails here instead of never matching a row.
 */
export const OFFLINE_ROW_STATES = Object.freeze([
  "revoked", "deleted", "lease-expired", "locked", "disk-full", "corrupt", "interrupted", "downloading", "verifying",
  "lease-expiring", "update-available", "update-kept", "waiting-network", "archived", "moved", "view-only", "ready",
]);

/** `expect.offline` (the FL rows): the machine-readable shape of the offline-library readings. */
const OFFLINE_KEYS = Object.freeze({
  boolean: ["capabilityOn", "neverReadyWhileFaulted", "neverServedTampered", "contentNotServed", "draftKept", "keptOldCopy",
    "neverExtendsLease", "nothingDecrypted", "accountALockedWhileSignedOut", "accountAScopeWiped", "deploymentAScopeUnchanged",
    "signedOutKeepsNoName"],
  // `downloadRequestsMin` is a proxy-log key (expect.proxyLog), never an offline one (review r1 R1-1)
  count: ["plaintextCopies", "accountBRows", "accountBCopies", "accountBPlaintextNames", "deploymentBRows", "deploymentBCopies", "deploymentARows",
    "diskMountMb", "diskLeaveBytes", "layerBudgetBytes", "clockSkewMinutes", "renewRefusalStatus"],
  // refusal codes of an offline action (fork shared/offline-library.ts OfflineFailureCode): a driver accepts these and no other
  codes: ["openRefusalCodes"],
  // shortLeaseStates: what a row reads once the rewritten short lease is granted (fork lease/clock.ts: < 4 h left = lease-expiring)
  states: ["faultedStates", "recoveredStates", "firstLaunchStates", "shortLeaseStates", "regrantStates", "tamperAccepts", "tamperNeverStates"],
  text: ["lockReason", "renewRefusalCode"],
});

/** Every `expect.offline` key, whatever its kind: the app-driver coverage test reads a row's keys against this. */
export const OFFLINE_EXPECT_KEYS = Object.freeze(Object.values(OFFLINE_KEYS).flat());

function checkOffline(offline, where, problems) {
  if (!offline || typeof offline !== "object" || Array.isArray(offline)) {
    problems.push(`${where}: expect.offline is not an object`);
    return;
  }
  for (const key of Object.keys(offline)) {
    if (!OFFLINE_KEYS.boolean.includes(key) && !OFFLINE_KEYS.count.includes(key) && !OFFLINE_KEYS.states.includes(key) && !OFFLINE_KEYS.text.includes(key) && !OFFLINE_KEYS.codes.includes(key))
      problems.push(`${where}: unknown expect.offline key "${key}"`);
  }
  for (const key of OFFLINE_KEYS.boolean) if (key in offline && typeof offline[key] !== "boolean") problems.push(`${where}: expect.offline.${key} is not a boolean`);
  for (const key of OFFLINE_KEYS.count) if (key in offline && !isCount(offline[key])) problems.push(`${where}: expect.offline.${key} is not a count`);
  for (const key of OFFLINE_KEYS.states) {
    const list = offline[key];
    if (key in offline && !(Array.isArray(list) && list.length > 0 && list.every((s) => OFFLINE_ROW_STATES.includes(s))))
      problems.push(`${where}: expect.offline.${key} is not a non-empty list of offline row states`);
  }
  for (const key of OFFLINE_KEYS.codes) {
    const list = offline[key];
    if (key in offline && !(Array.isArray(list) && list.length > 0 && list.every((c) => typeof c === "string" && /^[a-z_]+$/.test(c))))
      problems.push(`${where}: expect.offline.${key} is not a non-empty list of refusal codes`);
  }
  for (const key of OFFLINE_KEYS.text) if (key in offline && !(typeof offline[key] === "string" && offline[key])) problems.push(`${where}: expect.offline.${key} is not a string`);
}

/** Counts and status lists over the proxy log; `*Min` = at least, `*Statuses` = the exact status sequence. */
export const PROXY_LOG_KEYS = Object.freeze({
  // server rows
  commitPosts: "count", commitPostStatuses: "statuses", commitLookups: "count", commitLookupsMin: "count",
  commitLookupStatuses: "statuses", uploadPosts: "count", uploadPostStatuses: "statuses", aiPosts: "count",
  keyTags: "count", uploadKeyTags: "count", aKeyTags: "count", commitPostsSucceeded: "count",
  // app rows
  upstreamCommits200: "count", writesBeforeRuleLifted: "count", commitPostsMin: "count", commitPostsAfterStop: "count",
  uploadPostsAfterStop: "count", commitPostsWhileBlocked: "count", commitPostsWhilePaused: "count",
  commitLookupsAfterStuckMin: "count", uploadPostsReachedUpstreamMin: "count", appCommitPosts: "count",
  writesAfterForeignSignIn: "count", writesWhileFull: "count",
  // G7-03b (FL) rows: the content downloads of one document the proxy saw
  downloadRequestsMin: "count",
});

function checkShape(expect, where, problems, { partial }) {
  if (!expect || typeof expect !== "object" || Array.isArray(expect)) {
    problems.push(`${where}: expect is not an object`);
    return;
  }
  for (const key of Object.keys(expect)) if (!TOP_KEYS.has(key)) problems.push(`${where}: unknown expect key "${key}"`);
  const server = expect.server;
  if (server !== undefined) {
    for (const key of Object.keys(server)) if (!SERVER_KEYS.has(key)) problems.push(`${where}: unknown expect.server key "${key}"`);
    if ("versionDelta" in server) {
      if (!isCount(server.versionDelta)) problems.push(`${where}: expect.server.versionDelta is not a count`);
    } else if (!partial) problems.push(`${where}: expect.server.versionDelta missing`);
    if ("versionDeltaAfterAi" in server && !isCount(server.versionDeltaAfterAi)) problems.push(`${where}: expect.server.versionDeltaAfterAi is not a count`);
    if (server.lookup !== undefined) {
      const lookup = server.lookup;
      for (const key of Object.keys(lookup ?? {})) if (!LOOKUP_KEYS.has(key)) problems.push(`${where}: unknown expect.server.lookup key "${key}"`);
      if (!isCount(lookup?.status)) problems.push(`${where}: expect.server.lookup.status is not an HTTP status`);
      for (const key of ["outcome", "errorCode"]) if (key in (lookup ?? {}) && !(typeof lookup[key] === "string" && lookup[key])) problems.push(`${where}: expect.server.lookup.${key} is not a string`);
    }
    for (const [step, value] of Object.entries(server.statuses ?? {})) {
      if (!(isStatus(value) || (Array.isArray(value) && value.length > 0 && value.every(isCount)) || (Array.isArray(value) && value.length > 0 && value.every((v) => Array.isArray(v) && v.every(isCount)))))
        problems.push(`${where}: expect.server.statuses.${step} is not a status, a status list or a list of status pairs`);
    }
    for (const [step, value] of Object.entries(server.errorCodes ?? {})) if (!(typeof value === "string" && value)) problems.push(`${where}: expect.server.errorCodes.${step} is not a code`);
  } else if (!partial) problems.push(`${where}: expect.server missing`);
  for (const [key, value] of Object.entries(expect.proxyLog ?? {})) {
    const kind = PROXY_LOG_KEYS[key];
    if (!kind) problems.push(`${where}: unknown expect.proxyLog key "${key}"`);
    else if (kind === "count" ? !isCount(value) : !(Array.isArray(value) && value.length > 0 && value.every(isStatus))) problems.push(`${where}: expect.proxyLog.${key} is not a ${kind}`);
  }
  if ("clientPath" in expect && !(Array.isArray(expect.clientPath) && expect.clientPath.length > 0 && expect.clientPath.every((s) => typeof s === "string" && s)))
    problems.push(`${where}: expect.clientPath is not a list of state names`);
  for (const key of ["clientIntents", "clientIntentsWhileFull"]) if (key in expect && !isCount(expect[key])) problems.push(`${where}: expect.${key} is not a count`);
  if ("offline" in expect) checkOffline(expect.offline, where, problems);
  if (!partial) {
    const notes = expect.notes;
    if (!notes || typeof notes !== "object" || Array.isArray(notes)) problems.push(`${where}: expect.notes missing`);
    else for (const [key, list] of Object.entries(notes)) if (!(Array.isArray(list) && list.length > 0 && list.every((t) => typeof t === "string" && t))) problems.push(`${where}: expect.notes.${key} is not a list of prose lines`);
  } else if ("notes" in expect) problems.push(`${where}: an exit's expect carries no notes`);
}

/** Every problem with a row's `expect` (and its exits' `expect`), as readable lines; empty when it is sound. */
export function validateExpect(row) {
  const problems = [];
  checkShape(row?.expect, row?.id ?? "(row)", problems, { partial: false });
  for (const exit of row?.exits ?? []) {
    if (exit.expect !== undefined) checkShape(exit.expect, `${row.id} / ${exit.exit}`, problems, { partial: true });
  }
  if (row?.layer === "server" && row.expect && ("clientPath" in row.expect || "clientIntents" in row.expect)) problems.push(`${row.id}: a server row has no client path`);
  return problems;
}

const pick = (over, base) => (over === undefined ? base : over);

/**
 * The expectation of one run of `row`: the row's `expect` with the run's exit
 * `expect` merged over it. Reading a key the row does not carry throws, so a
 * driver can never fall back to a number of its own.
 */
export function caseExpect(row, exit = null) {
  const base = row?.expect ?? {};
  const over = exit?.expect ?? {};
  const id = row?.id ?? "(row)";
  const server = { ...base.server, ...over.server };
  const lookup = base.server?.lookup || over.server?.lookup ? { ...base.server?.lookup, ...over.server?.lookup } : undefined;
  const statuses = { ...base.server?.statuses, ...over.server?.statuses };
  const errorCodes = { ...base.server?.errorCodes, ...over.server?.errorCodes };
  const proxyLog = { ...base.proxyLog, ...over.proxyLog };
  const offline = { ...base.offline, ...over.offline };
  const need = (value, what) => {
    if (value === undefined) throw new Error(`${id}: cases.json expect.${what} is missing (the driver reads it, never a number of its own)`);
    return value;
  };
  const count = (value, what) => {
    const found = need(value, what);
    if (!isCount(found)) throw new Error(`${id}: expect.${what} is not a count: ${JSON.stringify(found)}`);
    return found;
  };
  return {
    versionDelta: () => count(server.versionDelta, "server.versionDelta"),
    versionDeltaAfterAi: () => count(server.versionDeltaAfterAi, "server.versionDeltaAfterAi"),
    lookup: () => need(lookup, "server.lookup"),
    status: (step) => need(statuses[step], `server.statuses.${step}`),
    errorCode: (step) => need(errorCodes[step], `server.errorCodes.${step}`),
    proxy: (key) => need(proxyLog[key], `proxyLog.${key}`),
    proxyKeys: () => Object.keys(proxyLog),
    /** one `expect.offline` value (the FL rows): the driver reads its states and counts here, never a literal of its own */
    offline: (key) => need(offline[key], `offline.${key}`),
    offlineKeys: () => Object.keys(offline),
    clientPath: () => need(pick(over.clientPath, base.clientPath), "clientPath"),
    clientIntents: () => count(pick(over.clientIntents, base.clientIntents), "clientIntents"),
    clientIntentsWhileFull: () => count(pick(over.clientIntentsWhileFull, base.clientIntentsWhileFull), "clientIntentsWhileFull"),
  };
}

/** `expected` is a status, "dropped", or a list of acceptable statuses; `actual` the answer's status. */
export const statusMatches = (expected, actual) => (Array.isArray(expected) ? expected.includes(actual) : expected === actual);

/** The outcome a lookup answer carries: `{outcome}` on 200, `error.fields.outcome` on 410. */
export const lookupOutcomeOf = (res) => res?.body?.error?.fields?.outcome ?? res?.body?.outcome ?? null;

/**
 * One proxy-log measure against its expectation: `<name>Min` = at least,
 * `<name>Statuses` = the exact status sequence, anything else = equal.
 */
export function compareMeasure(key, expected, actual) {
  if (/Min$/.test(key)) return Number.isInteger(actual) && actual >= expected;
  if (/Statuses$/.test(key)) return Array.isArray(actual) && actual.length === expected.length && actual.every((value, i) => value === expected[i]);
  return actual === expected;
}
