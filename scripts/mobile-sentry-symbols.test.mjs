import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { debugIdOf, main } from "./mobile-sentry-symbols.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "mobile-sentry-symbols.mjs");
const ID = "9cb99fdc-9bcb-4595-9d8d-223c48e83914";
const RELEASE = "com.uniworkos.chat@0.3.1+12";
const noZip = spawnSync("zip", ["-v"]).status !== 0;

// What Hermes leaves of the Metro debug-ID snippet: a bytecode header, then the literal in the string table
// (read from 0.3.1 (12)'s base/assets/index.android.bundle). The `//# debugId=` comment does not survive Hermes.
const hermesBundle = (id) =>
  Buffer.concat([Buffer.from("c61fbc03c103191f6200000000000000", "hex"), Buffer.from(`\0\0_sentryDebugIds\0sentry-dbid-${id}\0${id}\0`, "latin1")]);

/** A fake Sentry on a free local port: `answer(url)` → [status, body]; every request is recorded. */
async function fakeSentry(answer) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    const [status, body] = answer(new URL(req.url, "http://x"), requests.length);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** An AAB-shaped zip holding `bundle` at base/assets/index.android.bundle (or nothing, for null). */
function fixtureAab(dir, bundle) {
  const src = fs.mkdtempSync(path.join(dir, "aab-"));
  fs.mkdirSync(path.join(src, "base", "assets"), { recursive: true });
  fs.mkdirSync(path.join(src, "base", "dex"), { recursive: true });
  fs.writeFileSync(path.join(src, "base", "dex", "classes.dex"), "dex\n035\0");
  if (bundle !== null) fs.writeFileSync(path.join(src, "base", "assets", "index.android.bundle"), bundle);
  execFileSync("zip", ["-qr", "../app.aab", "base"], { cwd: src });
  const aab = path.join(dir, `${path.basename(src)}.aab`);
  fs.renameSync(path.join(dir, "app.aab"), aab);
  return aab;
}

/** Runs the script as the workflow does, in a child process (the fake Sentry answers from this one). */
function run(file, sentryUrl, { env = {}, args = [] } = {}) {
  return new Promise((resolve) => {
    const output = path.join(path.dirname(file), `output-${path.basename(file)}`);
    fs.writeFileSync(output, "");
    execFile(
      process.execPath,
      [SCRIPT, file, "--release", RELEASE, "--attempts", "1", "--delay-ms", "0", ...args],
      { env: { PATH: process.env.PATH, SENTRY_AUTH_TOKEN: "sntrys_test", SENTRY_ORG: "unicom", SENTRY_PROJECT: "unichat-mobile", SENTRY_URL: sentryUrl, GITHUB_OUTPUT: output, ...env } },
      (error, stdout) => resolve({ status: error ? error.code : 0, stdout, output: fs.readFileSync(output, "utf8") }),
    );
  });
}

test("the debug ID is read from a Hermes bundle's string table and from a plain bundle's comment", () => {
  assert.equal(debugIdOf(hermesBundle(ID.toUpperCase())), ID);
  assert.equal(debugIdOf(`var a=1;\n//# debugId=${ID}\n//# sourceMappingURL=index.android.bundle.map`), ID);
  // Both present: the snippet's ID is the one the SDK reports with a crash.
  assert.equal(debugIdOf(`_sentryDebugIdIdentifier="sentry-dbid-${ID}";\n//# debugId=00000000-0000-0000-0000-000000000000`), ID);
  assert.equal(debugIdOf("var a=1;"), null);
  assert.equal(debugIdOf("sentry-dbid-not-a-uuid"), null);
});

test("a debug ID Sentry resolves to an artifact bundle passes, asked of the right project with the token", { skip: noZip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  const sentry = await fakeSentry((url) =>
    url.pathname === "/api/0/projects/unicom/unichat-mobile/artifact-lookup/" && url.searchParams.get("debug_id") === ID
      ? [200, [{ id: "artifact_bundle/42", type: "bundle", url: "http://x/?download=artifact_bundle/42", resolved_with: "debug-id" }]]
      : [200, []],
  );
  try {
    const result = await run(fixtureAab(dir, hermesBundle(ID)), sentry.url);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`has the source map for debug ID ${ID} \\(artifact_bundle/42\\)`));
    assert.equal(result.output, `debug_id=${ID}\n`, "the summary can name the debug ID");
    assert.deepEqual(sentry.requests, [{ url: `/api/0/projects/unicom/unichat-mobile/artifact-lookup/?debug_id=${ID}`, auth: "Bearer sntrys_test" }]);
  } finally {
    await sentry.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a debug ID Sentry does not know fails, naming the release and the debug ID, after the retries", { skip: noZip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  // What artifact-lookup answers when the debug ID matches nothing: the newest bundles of the empty release, and
  // legacy release files. Neither is this binary's map, nor is an entry that does not say how it was found.
  const sentry = await fakeSentry(() => [
    200,
    [
      { id: "artifact_bundle/9", type: "bundle", resolved_with: "release" },
      { id: "artifact_bundle/10", type: "bundle" },
      { id: "release_file/7", type: "bundle", resolved_with: "release-old" },
      { id: "release_file/8", type: "file", resolved_with: "release-old" },
    ],
  ]);
  try {
    const result = await run(fixtureAab(dir, hermesBundle(ID)), sentry.url, { args: ["--attempts", "3"] });
    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`::error::Sentry unicom/unichat-mobile has no artifact bundle with debug ID ${ID}, the JS bundle of release ${RELEASE.replace(/[.+]/g, "\\$&")}: its source map did not upload`));
    assert.equal(sentry.requests.length, 3, "asked once per attempt");
  } finally {
    await sentry.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an upload Sentry is still indexing passes on a later attempt", { skip: noZip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  const sentry = await fakeSentry((_url, n) => (n === 1 ? [502, { detail: "bad gateway" }] : n === 2 ? [200, []] : [200, [{ id: "artifact_bundle/42", type: "bundle", resolved_with: "debug-id" }]]));
  try {
    const result = await run(fixtureAab(dir, `var a=1;\n//# debugId=${ID}\n`), sentry.url, { args: ["--attempts", "3"] });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(sentry.requests.length, 3);
  } finally {
    await sentry.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bundle without a debug ID fails explaining why, without asking Sentry", { skip: noZip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  const sentry = await fakeSentry(() => [200, []]);
  try {
    const result = await run(fixtureAab(dir, "var a = 1;\n//# sourceMappingURL=index.android.bundle.map"), sentry.url);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /::error::the JS bundle of release com\.uniworkos\.chat@0\.3\.1\+12 \([^)]*base\/assets\/index\.android\.bundle\) carries no Sentry debug ID[^\n]*getSentryExpoConfig/);
    assert.equal(result.output, "");
    assert.equal(sentry.requests.length, 0);
    const empty = await run(fixtureAab(dir, null), sentry.url);
    assert.equal(empty.status, 1);
    assert.match(empty.stdout, /::error::[^\n]+ has no JS bundle \(base\/assets\/index\.android\.bundle or assets\/index\.android\.bundle\)/);
  } finally {
    await sentry.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a refused token fails saying the token is wrong, not that the upload failed, and is not retried", { skip: noZip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  for (const status of [401, 403]) {
    const sentry = await fakeSentry(() => [status, { detail: "Invalid token" }]);
    try {
      const result = await run(fixtureAab(dir, hermesBundle(ID)), sentry.url, { args: ["--attempts", "3"] });
      assert.equal(result.status, 1);
      assert.match(result.stdout, new RegExp(`::error::Sentry refused SENTRY_AUTH_TOKEN \\(HTTP ${status}\\)[^\\n]*This says nothing about the upload`));
      assert.doesNotMatch(result.stdout, /did not upload/);
      assert.equal(sentry.requests.length, 1);
    } finally {
      await sentry.close();
    }
  }
  const sentry = await fakeSentry(() => [404, { detail: "The requested resource does not exist" }]);
  try {
    const result = await run(fixtureAab(dir, hermesBundle(ID)), sentry.url);
    assert.match(result.stdout, /::error::Sentry has no project unicom\/unichat-mobile \(HTTP 404\): check the SENTRY_ORG and SENTRY_PROJECT variables/);
  } finally {
    await sentry.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a plain bundle file is read directly, and missing settings or arguments are an error, not a pass", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentry-symbols-"));
  try {
    const bundle = path.join(dir, "index.android.bundle");
    fs.writeFileSync(bundle, hermesBundle(ID));
    const lines = [];
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [{ id: "artifact_bundle/1", type: "bundle", resolved_with: "debug-id" }] });
    const env = { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "o", SENTRY_PROJECT: "p" };
    assert.equal(await main([bundle, "--release", RELEASE], { env, fetchImpl, log: (l) => lines.push(l) }), 0, lines.join("\n"));
    assert.equal(await main([bundle, "--release", RELEASE], { env: { ...env, SENTRY_PROJECT: "" }, fetchImpl, log: (l) => lines.push(l) }), 1);
    assert.match(lines.at(-1), /::error::SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT must all be set/);
    assert.equal(await main([bundle], { env, fetchImpl, log: () => {} }), 2, "no --release");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
