import { test } from "node:test";
import assert from "node:assert/strict";
import { ANR_RATE_FLOOR, CRASH_RATE_FLOOR, dayBefore, playVitals, vitalsReasons } from "./mobile-play-vitals.mjs";

const LA = { id: "America/Los_Angeles" };

/** Play's reporting API for one app: each metric set's freshness and its rows per version code; records the queries. */
function fakeReporting({ freshness = { year: 2026, month: 10, day: 1, timeZone: LA }, rows = {}, status = 200 } = {}) {
  const queries = [];
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.headers.authorization, "Bearer tok");
    const reply = (body) => ({ ok: status === 200, status, json: async () => body });
    const set = url.match(/apps\/com\.uniworkos\.chat\/(\w+MetricSet)(:query)?$/);
    if (!set) return { ok: false, status: 404, json: async () => Promise.reject(new Error("not json")) };
    if (!set[2]) return reply(freshness ? { freshnessInfo: { freshnesses: [{ aggregationPeriod: "HOURLY" }, { aggregationPeriod: "DAILY", latestEndTime: freshness }] } } : {});
    const body = JSON.parse(init.body);
    queries.push({ set: set[1], body });
    return reply({ rows: rows[set[1]] ?? [] });
  };
  return { fetchImpl, queries };
}

const row = (code, metric, value, users) => ({
  dimensions: [{ dimension: "versionCode", stringValue: code }],
  metrics: [{ metric, decimalValue: { value: String(value) } }, { metric: "distinctUsers", decimalValue: { value: String(users) } }],
});

test("the day before a Play date keeps its time zone and crosses months", () => {
  assert.deepEqual(dayBefore({ year: 2026, month: 10, day: 1, timeZone: LA }), { year: 2026, month: 9, day: 30, timeZone: LA });
  assert.deepEqual(dayBefore({ year: 2026, month: 1, day: 1 }), { year: 2025, month: 12, day: 31 });
});

test("vitals are read for the latest complete day, crash and ANR rates joined per version code", async () => {
  const play = fakeReporting({
    rows: {
      crashRateMetricSet: [row("12", "userPerceivedCrashRate", 0.002, 120), row("11", "userPerceivedCrashRate", "bad", 50), { dimensions: [], metrics: [] }],
      anrRateMetricSet: [row("12", "userPerceivedAnrRate", 0.006, 130)],
    },
  });
  const vitals = await playVitals({ packageName: "com.uniworkos.chat", token: "tok", fetchImpl: play.fetchImpl });
  assert.deepEqual(Object.fromEntries(vitals), {
    12: { crashRate: 0.002, anrRate: 0.006, users: 130, day: "2026-09-30" },
    11: { crashRate: null, anrRate: null, users: 50, day: "2026-09-30" },
  });
  assert.deepEqual(play.queries[0].body, {
    timelineSpec: { aggregationPeriod: "DAILY", startTime: { year: 2026, month: 9, day: 30, timeZone: LA }, endTime: { year: 2026, month: 10, day: 1, timeZone: LA } },
    dimensions: ["versionCode"],
    metrics: ["userPerceivedCrashRate", "distinctUsers"],
    pageSize: 100,
  });
  assert.equal(play.queries[1].body.metrics[0], "userPerceivedAnrRate");
  assert.equal((await playVitals({ packageName: "com.uniworkos.chat", token: "tok", fetchImpl: fakeReporting({ freshness: null }).fetchImpl })).size, 0, "no data yet");
  await assert.rejects(playVitals({ packageName: "com.uniworkos.chat", token: "tok", fetchImpl: fakeReporting({ status: 403 }).fetchImpl }), /Play Reporting GET \/com\.uniworkos\.chat\/crashRateMetricSet answered 403/);
  await assert.rejects(playVitals({ packageName: "other", token: "tok", fetchImpl: fakeReporting().fetchImpl }), /answered 404: no message/);
});

test("Google's bad-behaviour thresholds stop a version code once enough people used it", () => {
  assert.equal(CRASH_RATE_FLOOR, 0.0109);
  assert.equal(ANR_RATE_FLOOR, 0.0047);
  const day = "2026-09-30";
  assert.deepEqual(vitalsReasons({ crashRate: 0.011, anrRate: 0.0048, users: 20, day }, 20), [
    "Play vitals: user-perceived crash rate 1.10 % over 20 users on 2026-09-30",
    "Play vitals: user-perceived ANR rate 0.48 % over 20 users on 2026-09-30",
  ]);
  assert.deepEqual(vitalsReasons({ crashRate: 0.05, anrRate: 0.05, users: 19, day }, 20), [], "too few people to say");
  assert.deepEqual(vitalsReasons({ crashRate: 0.0109, anrRate: null, users: 500, day }, 20), []);
  assert.deepEqual(vitalsReasons(null, 20), []);
});
