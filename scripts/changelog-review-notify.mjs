import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The webhook is a secret. Never log its URL, response body, or transport error. */
export async function notifyReviewer({ webhookUrl, sourceSha, runId, changeCount, fetchImpl = fetch }) {
  if (!webhookUrl) return "not-configured";
  let endpoint;
  try { endpoint = new URL(webhookUrl); } catch { throw new Error("Invalid UniAI webhook endpoint."); }
  if (endpoint.protocol !== "https:" || endpoint.host !== "uniai.unicomhub.com" ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/api\/webhooks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u.test(endpoint.pathname)) {
    throw new Error("Invalid UniAI webhook endpoint.");
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? "") || !/^[1-9]\d*$/u.test(runId ?? "") ||
      !Number.isSafeInteger(changeCount) || changeCount < 0) throw new Error("Invalid develop review metadata.");
  if (changeCount === 0) return "no-change";
  let response;
  try {
    response = await fetchImpl(endpoint.href, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository: "UNIAI-TEAM/uniwork", ref: "refs/heads/develop", source_sha: sourceSha,
        run_url: "https://github.com/UNIAI-TEAM/uniwork/actions/runs/" + runId }),
    });
  } catch { throw new Error("UniAI reviewer request failed; check endpoint connectivity and Autopilot runs."); }
  if (!response.ok) throw new Error("UniAI reviewer rejected the request (HTTP " + response.status + ").");
  return "accepted";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const draft = JSON.parse(readFileSync(".changelog-ci/unreleased.json", "utf8"));
    const result = await notifyReviewer({ webhookUrl: process.env.UNIAI_CHANGELOG_WEBHOOK_URL,
      sourceSha: draft.sourceRef, runId: process.env.GITHUB_RUN_ID, changeCount: draft.changes.length });
    if (result === "not-configured") console.log("::warning::Configure UNIAI_CHANGELOG_WEBHOOK_URL to dispatch develop reviews to UniAI.");
    else console.log(result === "no-change" ? "No new commits to review." : "UniAI Changelog review request accepted.");
  } catch (error) {
    // JSON parse and filesystem errors may contain private draft content or local paths.
    console.error(error.message.startsWith("UniAI reviewer") || error.message.startsWith("Invalid UniAI") ||
      error.message === "Invalid develop review metadata." ? error.message : "Could not read the develop Changelog draft.");
    process.exitCode = 1;
  }
}
