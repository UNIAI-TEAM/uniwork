// Android vitals of UniChat per version code, from the Play Developer Reporting API (audit
// "thresholds-unreachable-at-pilot-scale": only Sentry's crash-free rate was gated, and an ANR — the app frozen for
// five seconds — never reaches Sentry as a crash). Google's own "bad behaviour" thresholds, the ones Play uses to
// demote an app in the store, are the floor: user-perceived crash rate 1.09 %, user-perceived ANR rate 0.47 %, over
// the latest complete day Play has (it lags a day or two, so this backs the hourly Sentry rules, never replaces them),
// and only once enough people stand behind the rate (vitalsReasons).
// Node built-ins only; scripts/mobile-release-health.mjs reads it with the service account's reporting token.
export const REPORTING_SCOPE = "https://www.googleapis.com/auth/playdeveloperreporting";
const API = "https://playdeveloperreporting.googleapis.com/v1beta1/apps";
export const CRASH_RATE_FLOOR = 0.0109;
export const ANR_RATE_FLOOR = 0.0047;

const METRIC_SETS = [
  { set: "crashRateMetricSet", metric: "userPerceivedCrashRate", key: "crashRate" },
  { set: "anrRateMetricSet", metric: "userPerceivedAnrRate", key: "anrRate" },
];

/** The day before a Play DateTime, same time zone (Play's DAILY periods are whole days in America/Los_Angeles). */
export function dayBefore(end) {
  const date = new Date(Date.UTC(end.year, end.month - 1, end.day));
  date.setUTCDate(date.getUTCDate() - 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), ...(end.timeZone ? { timeZone: end.timeZone } : {}) };
}

const decimal = (metrics, name) => {
  const value = Number(metrics?.find((m) => m.metric === name)?.decimalValue?.value);
  return Number.isFinite(value) ? value : null;
};

async function call(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Play Reporting ${method} ${url.replace(API, "")} answered ${response.status}: ${json?.error?.message ?? "no message"}`);
  return json;
}

/**
 * The latest complete day's user-perceived crash and ANR rates per version code: a Map of version code →
 * `{ crashRate, anrRate, users, day }` (a rate is null when Play has none for that code).
 */
export async function playVitals({ packageName, token, fetchImpl }) {
  const byCode = new Map();
  for (const { set, metric, key } of METRIC_SETS) {
    const base = `${API}/${encodeURIComponent(packageName)}/${set}`;
    const meta = await call(fetchImpl, token, "GET", base);
    const end = (meta.freshnessInfo?.freshnesses ?? []).find((f) => f.aggregationPeriod === "DAILY")?.latestEndTime;
    if (!end) continue;
    const start = dayBefore(end);
    const body = await call(fetchImpl, token, "POST", `${base}:query`, {
      timelineSpec: { aggregationPeriod: "DAILY", startTime: start, endTime: end },
      dimensions: ["versionCode"],
      metrics: [metric, "distinctUsers"],
      pageSize: 100,
    });
    for (const row of body.rows ?? []) {
      const code = row.dimensions?.find((d) => d.dimension === "versionCode")?.stringValue;
      if (!code) continue;
      const entry = byCode.get(code) ?? { crashRate: null, anrRate: null, users: 0, day: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}` };
      entry[key] = decimal(row.metrics, metric);
      entry.users = Math.max(entry.users, decimal(row.metrics, "distinctUsers") ?? 0);
      byCode.set(code, entry);
    }
  }
  return byCode;
}

/**
 * Why a version code's vitals stop its rollout (empty when they do not). Both a rate over Google's floor and enough
 * people behind it: Play reports one day, so at pilot scale one person's crash is already over 1.09 % of 91 users and
 * one ANR over 0.47 % of 212 — Google's own floors are 28-day rates for exactly that reason. `minUsers` is the day's
 * users below which nothing is said, `minAffected` the people the rate stands for (round(rate × users)), the same bar
 * as the Sentry rule's crashed users.
 */
export function vitalsReasons(vitals, { minUsers, minAffected }) {
  if (!vitals || vitals.users < minUsers) return [];
  const pct = (v) => `${(v * 100).toFixed(2)} %`;
  const reasons = [];
  for (const [label, rate, floor] of [
    ["crash", vitals.crashRate, CRASH_RATE_FLOOR],
    ["ANR", vitals.anrRate, ANR_RATE_FLOOR],
  ]) {
    if (rate === null || rate <= floor) continue;
    const affected = Math.round(rate * vitals.users);
    if (affected < minAffected) continue;
    reasons.push(`Play vitals: user-perceived ${label} rate ${pct(rate)} over ${vitals.users} users (${affected} people) on ${vitals.day}`);
  }
  return reasons;
}
