#!/usr/bin/env node
// Moves a UniChat Android build between Google Play tracks through the Play
// Developer API (audit "no-production-pipeline-binary-promotion"): the binary
// promoted is the one already live on the track it comes from, by version
// code, never a rebuild. Node built-ins only (no SDK): a service-account JWT
// for a token, then one edit — read the tracks, write the target, commit.
//
//   promote --package <id> --version-code <n> --from <track> --to <track>
//           --status draft|inProgress|completed [--rollout <0..1>] [--notes-version <x.y.z>]
//       the release of that version code on --from goes to --to, with the
//       notes of apps/chat-mobile/store/release-notes.md. --from = --to widens
//       (or resumes) a staged rollout in place.
//   halt --package <id> --version-code <n> --track <track>
//       stops that release reaching more phones (phones that have it keep it).
//
// The service account's key (JSON) is read from PLAY_SERVICE_ACCOUNT_JSON.
// chat-mobile-promote.yml and chat-mobile-release-health.yml run it;
// scripts/mobile-play-release.test.mjs runs it against a fake Play.
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { NOTES_FILE, notesFor } from "./mobile-release-notes.mjs";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
export const TRACKS = ["internal", "alpha", "beta", "production"];
const STATUSES = ["draft", "inProgress", "completed"];
/** A release that has been live on a track: what a promotion may take from it. */
const LIVE = new Set(["completed", "inProgress", "halted"]);

export class PlayError extends Error {}

const b64url = (data) => Buffer.from(data).toString("base64url");

/** An OAuth access token for the service account (RFC 7523 JWT bearer grant). */
export async function accessToken(serviceAccountJson, fetchImpl, now = Date.now()) {
  let key;
  try {
    key = JSON.parse(serviceAccountJson);
  } catch {
    throw new PlayError("PLAY_SERVICE_ACCOUNT_JSON is not JSON");
  }
  if (!key?.client_email || !key?.private_key) throw new PlayError("PLAY_SERVICE_ACCOUNT_JSON has no client_email or private_key");
  const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat, exp: iat + 3600 }))}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");
  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") throw new PlayError(`Google refused the service account (${response.status}): ${body.error_description ?? body.error ?? "no token"}`);
  return body.access_token;
}

/** One Play edit: `run` reads and writes tracks, then the edit is committed (or deleted when `run` throws). */
async function withEdit({ packageName, token, fetchImpl }, run) {
  const call = async (method, path, body) => {
    const response = await fetchImpl(`${API}/${encodeURIComponent(packageName)}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) throw new PlayError(`Play ${method} ${path} answered ${response.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
    return json;
  };
  const edit = await call("POST", "/edits", {});
  try {
    const result = await run({
      getTrack: (track) => call("GET", `/edits/${edit.id}/tracks/${track}`),
      putTrack: (track, releases) => call("PUT", `/edits/${edit.id}/tracks/${track}`, { track, releases }),
    });
    await call("POST", `/edits/${edit.id}:commit`);
    return result;
  } catch (error) {
    await call("DELETE", `/edits/${edit.id}`).catch(() => undefined);
    throw error;
  }
}

const hasCode = (release, versionCode) => (release.versionCodes ?? []).map(String).includes(String(versionCode));

/** Checks a promotion's arguments; the Play release it writes, or a PlayError. */
export function plannedRelease({ versionCode, status, rollout, releaseNotes, name }) {
  if (!/^\d+$/.test(String(versionCode))) throw new PlayError(`--version-code must be a number, got ${versionCode}`);
  if (!STATUSES.includes(status)) throw new PlayError(`--status must be one of ${STATUSES.join(", ")}`);
  const release = { name, versionCodes: [String(versionCode)], status, ...(releaseNotes ? { releaseNotes } : {}) };
  if (status === "inProgress") {
    const fraction = Number(rollout);
    if (!(fraction > 0 && fraction < 1)) throw new PlayError(`a staged rollout needs --rollout between 0 and 1 (exclusive), got ${rollout}`);
    release.userFraction = fraction;
  } else if (rollout !== undefined && rollout !== "") {
    throw new PlayError(`--rollout only applies to --status inProgress (Play ignores it on ${status})`);
  }
  return release;
}

export async function promote({ packageName, versionCode, from, to, status, rollout, releaseNotes, name, token, fetchImpl }) {
  if (!TRACKS.includes(from) || !TRACKS.includes(to)) throw new PlayError(`tracks are ${TRACKS.join(", ")}`);
  if (TRACKS.indexOf(to) < TRACKS.indexOf(from)) throw new PlayError(`a build moves towards production, not from ${from} back to ${to}`);
  const release = plannedRelease({ versionCode, status, rollout, releaseNotes, name });
  return withEdit({ packageName, token, fetchImpl }, async ({ getTrack, putTrack }) => {
    const source = await getTrack(from);
    const tested = (source.releases ?? []).find((r) => hasCode(r, versionCode) && LIVE.has(r.status));
    if (!tested) throw new PlayError(`version code ${versionCode} has not been live on ${from}: only a build that was is promoted`);
    // Widening in place keeps the release's own name and notes unless new ones are given.
    const next = from === to ? { ...tested, ...release, name: release.name ?? tested.name, releaseNotes: release.releaseNotes ?? tested.releaseNotes } : release;
    if (next.status !== "inProgress") delete next.userFraction;
    await putTrack(to, [next]);
    return next;
  });
}

export async function halt({ packageName, versionCode, track, token, fetchImpl }) {
  if (!TRACKS.includes(track)) throw new PlayError(`tracks are ${TRACKS.join(", ")}`);
  return withEdit({ packageName, token, fetchImpl }, async ({ getTrack, putTrack }) => {
    const current = await getTrack(track);
    const releases = current.releases ?? [];
    const target = releases.find((r) => hasCode(r, versionCode) && (r.status === "inProgress" || r.status === "completed"));
    if (!target) throw new PlayError(`no rolling-out or completed release of version code ${versionCode} on ${track} to halt`);
    const next = releases.map((r) => (r === target ? { ...r, status: "halted" } : r));
    await putTrack(track, next);
    return { ...target, status: "halted" };
  });
}

/** `--name value` pairs. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith("--") || rest[i + 1] === undefined) throw new PlayError(`expected --name value pairs, got ${rest.slice(i).join(" ")}`);
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return { command, options };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, notesMarkdown, log = console.log } = {}) {
  const { command, options } = parseArgs(argv);
  const packageName = options.package;
  if (!packageName) throw new PlayError("--package is required");
  if (!env.PLAY_SERVICE_ACCOUNT_JSON) throw new PlayError("PLAY_SERVICE_ACCOUNT_JSON is not set: the Play service account key (runbook › Thiết lập lần đầu)");
  const token = await accessToken(env.PLAY_SERVICE_ACCOUNT_JSON, fetchImpl);
  if (command === "promote") {
    let releaseNotes;
    if (options["notes-version"]) {
      const notes = notesFor(notesMarkdown ?? fs.readFileSync(NOTES_FILE, "utf8"), options["notes-version"]);
      if (notes.problems) throw new PlayError(notes.problems.join("; "));
      releaseNotes = notes.releaseNotes;
    }
    const name = options["notes-version"] ? `${options["notes-version"]} (${options["version-code"]})` : undefined;
    const release = await promote({ packageName, versionCode: options["version-code"], from: options.from, to: options.to, status: options.status, rollout: options.rollout, releaseNotes, name, token, fetchImpl });
    log(`${packageName}: version code ${options["version-code"]} is ${release.status} on ${options.to}${release.userFraction ? ` for ${release.userFraction * 100} % of phones` : ""}`);
    return release;
  }
  if (command === "halt") {
    const release = await halt({ packageName, versionCode: options["version-code"], track: options.track, token, fetchImpl });
    log(`${packageName}: version code ${options["version-code"]} is halted on ${options.track}`);
    return release;
  }
  throw new PlayError(`unknown command ${command ?? "(none)"}: promote or halt`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.log(`::error::${error instanceof PlayError ? error.message : error}`);
    process.exit(1);
  });
}
