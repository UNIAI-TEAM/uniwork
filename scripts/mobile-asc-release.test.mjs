import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { AscError, STATES, ascToken, main, phasedReleaseOf, setPhasedRelease } from "./mobile-asc-release.mjs";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const P8 = privateKey.export({ type: "pkcs8", format: "pem" });
const ENV = { ASC_KEY_ID: "KEY123", ASC_ISSUER_ID: "issuer-uuid", ASC_PRIVATE_KEY: P8 };

/** An App Store Connect holding one version and its phased release; checks every token and records the calls. */
function fakeAsc({ version = "0.3.0", phased = "ACTIVE", hasPhased = true } = {}) {
  const calls = [];
  const state = { phased };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body });
    const [header, claims, signature] = init.headers.authorization.replace("Bearer ", "").split(".");
    const valid = crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)) });
    if (!valid || JSON.parse(Buffer.from(claims, "base64url").toString()).aud !== "appstoreconnect-v1") return reply(401, { errors: [{ detail: "bad token" }] });
    const parsed = new URL(url);
    if (method === "GET" && parsed.pathname === "/v1/apps/6400000000/appStoreVersions") {
      if (parsed.searchParams.get("filter[versionString]") !== version) return reply(200, { data: [] });
      return reply(200, {
        data: [{ id: "v1", relationships: { appStoreVersionPhasedRelease: { data: hasPhased ? { type: "appStoreVersionPhasedReleases", id: "p1" } : null } } }],
        included: hasPhased ? [{ type: "appStoreVersionPhasedReleases", id: "p1", attributes: { phasedReleaseState: state.phased } }] : [],
      });
    }
    if (method === "PATCH" && parsed.pathname === "/v1/appStoreVersionPhasedReleases/p1") {
      state.phased = JSON.parse(init.body).data.attributes.phasedReleaseState;
      return reply(200, {});
    }
    return reply(500, "not json");
  };
  return { fetchImpl, calls, state };
}

const token = ascToken({ keyId: ENV.ASC_KEY_ID, issuerId: ENV.ASC_ISSUER_ID, privateKey: P8 }, Date.UTC(2026, 9, 22));

test("the API key signs a 20-minute ES256 token for App Store Connect", () => {
  const [header, claims] = token.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
  assert.deepEqual(header, { alg: "ES256", kid: "KEY123", typ: "JWT" });
  assert.equal(claims.exp - claims.iat, 1200);
  assert.equal(claims.iss, "issuer-uuid");
  assert.throws(() => ascToken({ keyId: "k", issuerId: "", privateKey: P8 }), /are all needed/);
  assert.throws(() => ascToken({ keyId: "k", issuerId: "i", privateKey: "not a key" }), /not an App Store Connect API key/);
});

test("a version's phased release is found by its version string", async () => {
  const asc = fakeAsc({ phased: "PAUSED" });
  assert.deepEqual(await phasedReleaseOf({ appId: "6400000000", version: "0.3.0", token, fetchImpl: asc.fetchImpl }), { id: "p1", state: "PAUSED" });
  assert.match(asc.calls[0].url, /filter%5Bplatform%5D=IOS&include=appStoreVersionPhasedRelease/);
  assert.equal(await phasedReleaseOf({ appId: "6400000000", version: "0.3.0", token, fetchImpl: fakeAsc({ hasPhased: false }).fetchImpl }), null);
  await assert.rejects(phasedReleaseOf({ appId: "6400000000", version: "9.9.9", token, fetchImpl: asc.fetchImpl }), /no App Store version 9\.9\.9/);
  await assert.rejects(phasedReleaseOf({ appId: "com.uniworkos.chat", version: "0.3.0", token, fetchImpl: asc.fetchImpl }), /numeric Apple ID/);
  await assert.rejects(phasedReleaseOf({ appId: "6400000000", version: "0.3.0", token: "x.y.z", fetchImpl: asc.fetchImpl }), AscError);
});

test("pausing a rolling phased release changes it once; a second pause is no change, and a complete one is refused", async () => {
  const asc = fakeAsc();
  const paused = await setPhasedRelease({ appId: "6400000000", version: "0.3.0", state: STATES.pause, token, fetchImpl: asc.fetchImpl });
  assert.deepEqual(paused, { state: "PAUSED", previous: "ACTIVE", alreadyInState: false });
  assert.deepEqual(JSON.parse(asc.calls.at(-1).body), { data: { type: "appStoreVersionPhasedReleases", id: "p1", attributes: { phasedReleaseState: "PAUSED" } } });
  const again = await setPhasedRelease({ appId: "6400000000", version: "0.3.0", state: "PAUSED", token, fetchImpl: asc.fetchImpl });
  assert.equal(again.alreadyInState, true);
  assert.equal(asc.calls.filter((c) => c.method === "PATCH").length, 1);
  await assert.rejects(setPhasedRelease({ appId: "6400000000", version: "0.3.0", state: "PAUSED", token, fetchImpl: fakeAsc({ phased: "COMPLETE" }).fetchImpl }), /is complete/);
  await assert.rejects(setPhasedRelease({ appId: "6400000000", version: "0.3.0", state: "PAUSED", token, fetchImpl: fakeAsc({ hasPhased: false }).fetchImpl }), /no phased release/);
  await assert.rejects(setPhasedRelease({ appId: "6400000000", version: "0.3.0", state: "HALTED", token, fetchImpl: asc.fetchImpl }), /not HALTED/);
});

test("the command line pauses, resumes and completes, and refuses what it cannot do", async () => {
  const asc = fakeAsc();
  const lines = [];
  const run = (argv, env = ENV) => main(argv, { env, fetchImpl: asc.fetchImpl, log: (line) => lines.push(line) });
  await run(["pause", "--app-id", "6400000000", "--version", "0.3.0"]);
  assert.equal(lines.at(-1), "App Store 0.3.0: phased release ACTIVE → PAUSED");
  await run(["resume", "--app-id", "6400000000", "--version", "0.3.0"]);
  await run(["resume", "--app-id", "6400000000", "--version", "0.3.0"]);
  assert.equal(lines.at(-1), "App Store 0.3.0: phased release already ACTIVE");
  await run(["complete", "--app-id", "6400000000", "--version", "0.3.0"]);
  assert.equal(asc.state.phased, "COMPLETE");
  await assert.rejects(run(["halt", "--version", "0.3.0"]), /unknown command halt/);
  await assert.rejects(run(["pause", "--app-id", "6400000000"]), /--version is required/);
  await assert.rejects(run(["pause", "--version"]), /expected --name value pairs/);
  await assert.rejects(run(["pause", "--app-id", "6400000000", "--version", "0.3.0"], {}), /are all needed/);
});
