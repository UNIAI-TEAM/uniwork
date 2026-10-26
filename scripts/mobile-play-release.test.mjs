import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { PlayError, accessToken, halt, haltOnTracks, main, parseArgs, plannedRelease, promote } from "./mobile-play-release.mjs";
import { NOTES_FILE } from "./mobile-release-notes.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_ACCOUNT = JSON.stringify({ client_email: "release@uniwork.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });

/** A Play that holds tracks per package and records every call. */
function fakePlay(tracks = {}) {
  const calls = [];
  const state = structuredClone(tracks);
  let edits = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body });
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
    if (url === "https://oauth2.googleapis.com/token") {
      const assertion = new URLSearchParams(init.body).get("assertion");
      const [header, claims, signature] = assertion.split(".");
      const valid = crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url"));
      const { scope, iss } = JSON.parse(Buffer.from(claims, "base64url").toString());
      return valid && scope.endsWith("/androidpublisher") && iss.endsWith("gserviceaccount.com") ? json(200, { access_token: "tok" }) : json(400, { error: "invalid_grant" });
    }
    assert.equal(init.headers.authorization, "Bearer tok");
    const path = url.replace("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.uniworkos.chat", "");
    if (method === "POST" && path === "/edits") return json(200, { id: `e${++edits}` });
    const track = path.match(/^\/edits\/e\d+\/tracks\/(\w+)$/)?.[1];
    if (method === "GET" && track) return state[track] ? json(200, { track, releases: state[track] }) : json(404, { error: { message: "Track not found" } });
    if (method === "PUT" && track) {
      state[track] = JSON.parse(init.body).releases;
      return json(200, JSON.parse(init.body));
    }
    if (method === "POST" && /:commit$/.test(path)) return json(200, { id: "e" });
    if (method === "DELETE") return json(204, undefined);
    return json(500, { error: { message: `unexpected ${method} ${path}` } });
  };
  return { fetchImpl, calls, state };
}

const notes = [{ language: "vi-VN", text: "Có gì mới" }, { language: "en-US", text: "What's new" }];
const base = { packageName: "com.uniworkos.chat", token: "tok" };

test("the service account signs its own token request", async () => {
  const play = fakePlay();
  assert.equal(await accessToken(SERVICE_ACCOUNT, play.fetchImpl), "tok");
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
  await assert.rejects(accessToken(JSON.stringify({ client_email: "x@gserviceaccount.com", private_key: other }), play.fetchImpl), /Google refused the service account \(400\): invalid_grant/);
  await assert.rejects(accessToken("{", play.fetchImpl), /not JSON/);
  await assert.rejects(accessToken("{}", play.fetchImpl), /no client_email or private_key/);
});

test("only a version code that was live on the track it comes from is promoted, and the edit is committed", async () => {
  const play = fakePlay({ internal: [{ name: "0.3.0 (12)", versionCodes: ["12"], status: "completed" }], production: [] });
  const release = await promote({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", from: "internal", to: "production", status: "inProgress", rollout: "0.05", releaseNotes: notes, name: "0.3.0 (12)" });
  assert.deepEqual(release, { name: "0.3.0 (12)", versionCodes: ["12"], status: "inProgress", userFraction: 0.05, releaseNotes: notes });
  assert.deepEqual(play.state.production, [release]);
  assert.match(play.calls.at(-1).url, /\/edits\/e1:commit$/);

  const missing = fakePlay({ internal: [{ versionCodes: ["11"], status: "completed" }, { versionCodes: ["12"], status: "draft" }] });
  await assert.rejects(
    promote({ ...base, fetchImpl: missing.fetchImpl, versionCode: "12", from: "internal", to: "production", status: "draft" }),
    /version code 12 has not been live on internal: only a build that was is promoted/,
  );
  assert.equal(missing.calls.at(-1).method, "DELETE", "a refused promotion leaves no open edit");
  assert.equal(missing.state.production, undefined, "and writes nothing");
});

test("widening a staged rollout keeps the release and its notes, and completing it drops the fraction", async () => {
  const live = { name: "0.3.0 (12)", versionCodes: ["12"], status: "inProgress", userFraction: 0.05, releaseNotes: notes };
  const play = fakePlay({ production: [live] });
  await promote({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", from: "production", to: "production", status: "inProgress", rollout: "0.2" });
  assert.deepEqual(play.state.production, [{ ...live, userFraction: 0.2 }]);
  await promote({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", from: "production", to: "production", status: "completed" });
  assert.deepEqual(play.state.production, [{ name: "0.3.0 (12)", versionCodes: ["12"], status: "completed", releaseNotes: notes }]);
});

test("a promotion's arguments are checked before Play is asked", async () => {
  assert.throws(() => plannedRelease({ versionCode: "12a", status: "draft" }), /--version-code must be a number/);
  assert.throws(() => plannedRelease({ versionCode: 12, status: "halted" }), /--status must be one of draft, inProgress, completed/);
  assert.throws(() => plannedRelease({ versionCode: 12, status: "inProgress", rollout: "1" }), /between 0 and 1/);
  assert.throws(() => plannedRelease({ versionCode: 12, status: "inProgress" }), /between 0 and 1/);
  assert.throws(() => plannedRelease({ versionCode: 12, status: "draft", rollout: "0.1" }), /only applies to --status inProgress/);
  assert.deepEqual(plannedRelease({ versionCode: 12, status: "draft", rollout: "" }), { name: undefined, versionCodes: ["12"], status: "draft" });
  const play = fakePlay();
  await assert.rejects(promote({ ...base, fetchImpl: play.fetchImpl, versionCode: 12, from: "production", to: "internal", status: "draft" }), /moves towards production/);
  await assert.rejects(promote({ ...base, fetchImpl: play.fetchImpl, versionCode: 12, from: "qa", to: "production", status: "draft" }), /tracks are/);
  assert.equal(play.calls.length, 0);
});

test("halt stops a rolling-out or completed release and leaves the others", async () => {
  const older = { versionCodes: ["11"], status: "completed" };
  const play = fakePlay({ production: [older, { versionCodes: ["12"], status: "inProgress", userFraction: 0.2 }] });
  const halted = await halt({ ...base, fetchImpl: play.fetchImpl, versionCode: 12, track: "production" });
  assert.deepEqual(halted, { versionCodes: ["12"], status: "halted", userFraction: 0.2 });
  assert.deepEqual(play.state.production, [older, halted]);
  // The hourly health run halts the same bad build every hour: a second halt changes nothing and is not an error.
  const again = await halt({ ...base, fetchImpl: play.fetchImpl, versionCode: 12, track: "production" });
  assert.deepEqual(again, { ...halted, alreadyHalted: true });
  assert.equal(play.calls.at(-1).method, "DELETE", "an edit with nothing to change is dropped, not committed");
  await assert.rejects(halt({ ...base, fetchImpl: play.fetchImpl, versionCode: 13, track: "production" }), /no rolling-out or completed release of version code 13/);
  await assert.rejects(halt({ ...base, fetchImpl: play.fetchImpl, versionCode: 12, track: "nightly" }), /tracks are/);
  const absent = fakePlay();
  await assert.rejects(halt({ ...base, fetchImpl: absent.fetchImpl, versionCode: 12, track: "beta" }), /answered 404: Track not found/);
});

// Audit "Release engineering" (verifier miss): a build staged on alpha or beta reports to the same Sentry environment
// as production, so the health run halts it wherever it rolls out.
test("haltOnTracks halts the build on the first track that rolls it out, and says when it was halted before", async () => {
  const play = fakePlay({ production: [{ versionCodes: ["11"], status: "completed" }], beta: [{ versionCodes: ["12"], status: "inProgress", userFraction: 0.5 }], alpha: [] });
  const found = await haltOnTracks({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", tracks: ["production", "beta", "alpha"] });
  assert.deepEqual(found, { track: "beta", release: { versionCodes: ["12"], status: "halted", userFraction: 0.5 }, alreadyHalted: false });
  assert.match(play.calls.at(-1).url, /:commit$/);
  const again = await haltOnTracks({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", tracks: ["production", "beta", "alpha"] });
  assert.equal(again.alreadyHalted, true);
  assert.equal(await haltOnTracks({ ...base, fetchImpl: play.fetchImpl, versionCode: "99", tracks: ["production", "beta", "alpha"] }), null);
  assert.equal(play.calls.at(-1).method, "DELETE");
  await assert.rejects(haltOnTracks({ ...base, fetchImpl: play.fetchImpl, versionCode: "12", tracks: ["qa"] }), /tracks are/);
});

test("the command line promotes with the version's notes from the repo, and halts", async () => {
  const play = fakePlay({ internal: [{ versionCodes: ["12"], status: "completed" }] });
  const lines = [];
  const env = { PLAY_SERVICE_ACCOUNT_JSON: SERVICE_ACCOUNT };
  const markdown = fs.readFileSync(NOTES_FILE, "utf8");
  const release = await main(["promote", "--package", "com.uniworkos.chat", "--version-code", "12", "--from", "internal", "--to", "production", "--status", "draft", "--notes-version", "0.3.0"], {
    env,
    fetchImpl: play.fetchImpl,
    log: (line) => lines.push(line),
  });
  assert.equal(release.name, "0.3.0 (12)");
  assert.deepEqual(release.releaseNotes.map((n) => n.language), ["vi-VN", "en-US"]);
  assert.match(lines[0], /version code 12 is draft on production$/);
  await assert.rejects(
    main(["promote", "--package", "com.uniworkos.chat", "--version-code", "12", "--from", "internal", "--to", "production", "--status", "draft", "--notes-version", "9.9.9"], { env, fetchImpl: play.fetchImpl, notesMarkdown: markdown }),
    /no "## 9\.9\.9" section/,
  );
  const staged = fakePlay({ internal: [{ versionCodes: ["12"], status: "completed" }] });
  await main(["promote", "--package", "com.uniworkos.chat", "--version-code", "12", "--from", "internal", "--to", "beta", "--status", "inProgress", "--rollout", "0.5"], { env, fetchImpl: staged.fetchImpl, log: (line) => lines.push(line) });
  assert.match(lines.at(-1), /inProgress on beta for 50 % of phones$/);
  const halting = fakePlay({ production: [{ versionCodes: ["12"], status: "completed" }] });
  await main(["halt", "--package", "com.uniworkos.chat", "--version-code", "12", "--track", "production"], { env, fetchImpl: halting.fetchImpl, log: (line) => lines.push(line) });
  assert.match(lines.at(-1), /12 is halted on production$/);
  await main(["halt", "--package", "com.uniworkos.chat", "--version-code", "12", "--track", "production"], { env, fetchImpl: halting.fetchImpl, log: (line) => lines.push(line) });
  assert.match(lines.at(-1), /12 is already halted on production$/);
  await assert.rejects(main(["rollback", "--package", "com.uniworkos.chat"], { env, fetchImpl: play.fetchImpl }), /unknown command rollback/);
  await assert.rejects(main(["halt", "--track", "production"], { env, fetchImpl: play.fetchImpl }), /--package is required/);
  await assert.rejects(main(["halt", "--package", "com.uniworkos.chat"], { env: {}, fetchImpl: play.fetchImpl }), /PLAY_SERVICE_ACCOUNT_JSON is not set/);
  assert.throws(() => parseArgs(["halt", "--track"]), PlayError);
});
