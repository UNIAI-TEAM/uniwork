#!/usr/bin/env node
// The App Store side of a UniChat iOS rollout (audit "ios-no-release-path"): an App Store version goes out as a
// 7-day phased release, and this pauses, resumes or completes it through the App Store Connect API, so the hourly
// release-health run (scripts/mobile-release-health.mjs) stops a bad iOS build the way it halts an Android one on
// Play, and "UniChat mobile promote" (platform ios) moves it by hand. Node built-ins only: an ES256 JWT from the API
// key, then two calls — find the version's phased release, PATCH its state.
//
//   pause|resume|complete --app-id <Apple ID of the app> --version <x.y.z>
//
// env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (the .p8 key's PEM; App Manager role). Until the Apple Developer
// account exists (UNI-1838) nothing sets them and both callers say so instead of acting.
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const API = "https://api.appstoreconnect.apple.com";
/** What each command sets the phased release to. */
export const STATES = { pause: "PAUSED", resume: "ACTIVE", complete: "COMPLETE" };

export class AscError extends Error {}

const b64url = (data) => Buffer.from(data).toString("base64url");

/** A 20-minute App Store Connect token (Apple's ceiling), signed ES256 with the API key. */
export function ascToken({ keyId, issuerId, privateKey }, now = Date.now()) {
  if (!keyId || !issuerId || !privateKey) throw new AscError("ASC_KEY_ID, ASC_ISSUER_ID and ASC_PRIVATE_KEY are all needed for App Store Connect");
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }))}.${b64url(JSON.stringify({ iss: issuerId, iat, exp: iat + 1200, aud: "appstoreconnect-v1" }))}`;
  let signature;
  try {
    signature = crypto.sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
  } catch {
    throw new AscError("ASC_PRIVATE_KEY is not an App Store Connect API key (.p8 PEM)");
  }
  return `${unsigned}.${signature.toString("base64url")}`;
}

async function call(fetchImpl, token, method, path, body) {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!response.ok) throw new AscError(`App Store Connect ${method} ${path.split("?")[0]} answered ${response.status}: ${json?.errors?.[0]?.detail ?? text.slice(0, 200)}`);
  return json;
}

/** The phased release of one iOS App Store version: `{ id, state }`, or null when it has none (released at once). */
export async function phasedReleaseOf({ appId, version, token, fetchImpl }) {
  if (!/^\d+$/.test(String(appId ?? ""))) throw new AscError(`--app-id must be the app's numeric Apple ID, got ${appId}`);
  const query = new URLSearchParams({ "filter[versionString]": version, "filter[platform]": "IOS", include: "appStoreVersionPhasedRelease", limit: "1" });
  const body = await call(fetchImpl, token, "GET", `/v1/apps/${appId}/appStoreVersions?${query}`);
  const found = body.data?.[0];
  if (!found) throw new AscError(`no App Store version ${version} for app ${appId}`);
  const link = found.relationships?.appStoreVersionPhasedRelease?.data;
  if (!link) return null;
  const phased = (body.included ?? []).find((item) => item.type === "appStoreVersionPhasedReleases" && item.id === link.id);
  return { id: link.id, state: phased?.attributes?.phasedReleaseState ?? "UNKNOWN" };
}

/**
 * Sets a version's phased release to `state`. Returns `{ state, previous, alreadyInState }`; a version without a phased
 * release, or one already complete (Apple cannot undo that), is an AscError a person has to read.
 */
export async function setPhasedRelease({ appId, version, state, token, fetchImpl }) {
  if (!Object.values(STATES).includes(state)) throw new AscError(`a phased release is set to ${Object.values(STATES).join(", ")}, not ${state}`);
  const phased = await phasedReleaseOf({ appId, version, token, fetchImpl });
  if (!phased) throw new AscError(`App Store version ${version} has no phased release: it reached every phone at once (remove it from sale by hand)`);
  if (phased.state === state) return { state, previous: phased.state, alreadyInState: true };
  if (phased.state === "COMPLETE") throw new AscError(`the phased release of ${version} is complete: every phone can already update to it`);
  await call(fetchImpl, token, "PATCH", `/v1/appStoreVersionPhasedReleases/${phased.id}`, {
    data: { type: "appStoreVersionPhasedReleases", id: phased.id, attributes: { phasedReleaseState: state } },
  });
  return { state, previous: phased.state, alreadyInState: false };
}

/** `--name value` pairs after the command. */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith("--") || rest[i + 1] === undefined) throw new AscError(`expected --name value pairs, got ${rest.slice(i).join(" ")}`);
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, options };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log, now = Date.now() } = {}) {
  const { command, options } = parseArgs(argv);
  const state = STATES[command];
  if (!state) throw new AscError(`unknown command ${command ?? "(none)"}: ${Object.keys(STATES).join(", ")}`);
  if (!options.version) throw new AscError("--version is required");
  const token = ascToken({ keyId: env.ASC_KEY_ID, issuerId: env.ASC_ISSUER_ID, privateKey: env.ASC_PRIVATE_KEY }, now);
  const result = await setPhasedRelease({ appId: options["app-id"], version: options.version, state, token, fetchImpl });
  log(`App Store ${options.version}: phased release ${result.alreadyInState ? `already ${state}` : `${result.previous} → ${state}`}`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`::error::${error instanceof AscError ? error.message : error}`);
    process.exit(1);
  });
}
