import assert from "node:assert/strict";
import test from "node:test";
import { notifyReviewer } from "./changelog-review-notify.mjs";

const sourceSha = "a".repeat(40);
const webhookUrl = "https://uniai.unicomhub.com/api/webhooks/autopilot/test-token";
const input = { webhookUrl, sourceSha, runId: "123", changeCount: 2 };

test("missing integration or unchanged develop does not dispatch a review", async () => {
  const fetchImpl = () => { throw new Error("Unexpected dispatch"); };
  assert.equal(await notifyReviewer({ ...input, webhookUrl: "", fetchImpl }), "not-configured");
  assert.equal(await notifyReviewer({ ...input, changeCount: 0, fetchImpl }), "no-change");
});

test("only the approved UniAI endpoint receives fixed develop metadata", async () => {
  let called = false;
  const result = await notifyReviewer({ ...input, fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, webhookUrl);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      repository: "UNIAI-TEAM/uniwork", ref: "refs/heads/develop", source_sha: sourceSha,
      run_url: "https://github.com/UNIAI-TEAM/uniwork/actions/runs/123",
    });
    return { ok: true, status: 202 };
  } });
  assert.equal(result, "accepted");
  assert.equal(called, true);
});

test("invalid endpoint or event fails before sending anything", async () => {
  const fetchImpl = () => { throw new Error("Unexpected dispatch"); };
  for (const url of [
    "http://uniai.unicomhub.com/api/webhooks/autopilot/test-token",
    "https://example.com/api/webhooks/autopilot/test-token", "not-a-url",
    "https://uniai.unicomhub.com/elsewhere", webhookUrl + "?redirect=elsewhere",
    webhookUrl + "#fragment", webhookUrl.replace("https://", "https://user:password@"),
  ]) await assert.rejects(notifyReviewer({ ...input, webhookUrl: url, fetchImpl }), /endpoint/);
  for (const invalid of [{ sourceSha: "develop" }, { runId: "../private" }, { changeCount: -1 }]) {
    await assert.rejects(notifyReviewer({ ...input, ...invalid, fetchImpl }), /metadata/);
  }
});

test("HTTP and transport errors never expose the webhook URL or response body", async () => {
  await assert.rejects(notifyReviewer({ ...input, fetchImpl: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
  try {
    await notifyReviewer({ ...input, fetchImpl: async () => { throw new Error("Credential in " + webhookUrl); } });
    assert.fail("Expected failure");
  } catch (error) {
    assert.match(error.message, /request failed/);
    assert.doesNotMatch(error.message, /test-token|https:/);
  }
});
