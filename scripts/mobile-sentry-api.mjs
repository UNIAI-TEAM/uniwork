// What scripts/mobile-release-health.mjs reads from Sentry, one function per question, over a `fetch` it is given
// (tests hand it a fake Sentry). Every call needs a token with org:read (event:read for the issue tags); a refusal
// is an error naming the call, never an empty answer, so the gate cannot read a broken token as "all healthy".
const DAY = "24h";

export class SentryError extends Error {}

/** A client for one organization: `get(path, params)` → parsed JSON, `url` → the issue permalink base. */
export function sentryClient({ org, token, url = "https://sentry.io", fetchImpl }) {
  const base = url.replace(/\/+$/, "");
  const get = async (path, params) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    const response = await fetchImpl(`${base}/api/0/organizations/${encodeURIComponent(org)}${path}${query}`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new SentryError(`Sentry answered ${response.status} for ${path.replace(/\/\d+\//, "/<id>/")}: check SENTRY_AUTH_TOKEN (org:read, event:read) and SENTRY_ORG`);
    return response.json();
  };
  return { get };
}

/** The last 24 hours of sessions in `environment`, per release: sessions, users and the crash-free rate of each. */
export async function sessionsByRelease(client, environment) {
  const body = await client.get("/sessions/", [
    ["field", "sum(session)"],
    ["field", "crash_free_rate(session)"],
    ["field", "count_unique(user)"],
    ["field", "crash_free_rate(user)"],
    ["groupBy", "release"],
    ["environment", environment],
    ["statsPeriod", DAY],
    ["interval", "1d"],
    ["project", "-1"],
    ["per_page", "100"],
  ]);
  const rate = (value) => (typeof value === "number" ? value : null);
  return (body.groups ?? []).map((group) => ({
    release: typeof group?.by?.release === "string" ? group.by.release : null,
    sessions: Number(group?.totals?.["sum(session)"] ?? 0) || 0,
    crashFree: rate(group?.totals?.["crash_free_rate(session)"]),
    users: Number(group?.totals?.["count_unique(user)"] ?? 0) || 0,
    crashFreeUsers: rate(group?.totals?.["crash_free_rate(user)"]),
  }));
}

const issueOf = (issue) => ({
  id: String(issue?.id ?? ""),
  shortId: typeof issue?.shortId === "string" ? issue.shortId : String(issue?.id ?? "?"),
  users: Number(issue?.userCount ?? 0) || 0,
  permalink: typeof issue?.permalink === "string" ? issue.permalink : null,
});

/**
 * Crashes that are new in a release: unresolved, unhandled issues whose first event was in it (Sentry's
 * `firstRelease`), seen in `environment` over the last 24 hours. A canary is judged on these when it has too few
 * sessions for a rate to mean anything.
 */
export async function newCrashesIn(client, release, environment) {
  const body = await client.get("/issues/", {
    query: `is:unresolved error.unhandled:true firstRelease:"${release}"`,
    environment,
    statsPeriod: DAY,
    project: "-1",
    limit: "25",
  });
  return (Array.isArray(body) ? body : []).map(issueOf);
}

async function topTag(client, issueId, key) {
  const body = await client.get(`/issues/${encodeURIComponent(issueId)}/tags/${key}/`);
  const top = (body?.topValues ?? [])[0]?.value;
  return typeof top === "string" ? top : null;
}

/**
 * OTA updates phones could not launch (apps/chat-mobile/data/release/launch-health.ts): one issue per failed update
 * and OS, tagged `failed_update_id` and `os`. Returns `{ updateId, os, users, shortId }` for each that names its
 * update.
 */
export async function launchFailures(client, environment) {
  const body = await client.get("/issues/", { query: "has:failed_update_id", environment, statsPeriod: DAY, project: "-1", limit: "25" });
  const out = [];
  for (const issue of (Array.isArray(body) ? body : []).map(issueOf)) {
    const updateId = await topTag(client, issue.id, "failed_update_id");
    if (!updateId || updateId === "unknown") continue;
    const os = await topTag(client, issue.id, "os");
    // The app tags `os` android|ios; Sentry may show its own "iOS 18.1" / "Android 15" there instead.
    out.push({ updateId: updateId.toLowerCase(), os: /ios/i.test(os ?? "") ? "ios" : "android", users: issue.users, shortId: issue.shortId });
  }
  return out;
}
