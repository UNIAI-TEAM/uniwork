// The `protocol` check (contract 2.1): the three fork protocol sources at the
// pin SHA, read as raw bytes through `git -C <fork> show <sha>:<path>`, against
// the installed bundle's manifest.protocolSha256 and the six *.pin.json. The
// installed manifest must also name the pin it claims to hold — its own version
// and gitSha (F-03): equal digests from another build are a FAIL, never a pass.
//
// A pin before X-02 records nothing: then the check is NOTE (said out loud,
// never a PASS) and the artifact carries the recomputed digests.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OFFICE_MODULES,
  PROTOCOL_SHA256_KEYS,
  parseManifest,
  parseProtocolSha256,
  sha256Hex,
} from "../../../../apps/web/platform/office-frame/frame-bundle.mjs";
import {
  DEFAULT_PIN_DIR,
  PROTOCOL_FILES,
  relativeToOut,
  resolveInstalledBundle,
  runGit,
  sameRevision,
  tail,
} from "./job-lib.mjs";

/**
 * The six pins. A pin file that is absent is a missing record; a
 * protocolSha256 that is present but malformed is reported, never guessed.
 * @param {string} [pinDir]
 */
export function readPins(pinDir = DEFAULT_PIN_DIR) {
  return OFFICE_MODULES.map((module) => {
    const file = join(pinDir, `${module}.pin.json`);
    if (!existsSync(file)) return { module, file, missing: true, version: null, gitSha: null, recorded: null, invalid: null };
    const raw = JSON.parse(readFileSync(file, "utf8"));
    let recorded = null;
    let invalid = null;
    if (raw.protocolSha256 !== undefined) {
      try {
        recorded = parseProtocolSha256(raw.protocolSha256, `${module}.pin.json`);
      } catch (error) {
        invalid = error.message;
      }
    }
    return {
      module,
      file,
      missing: false,
      version: typeof raw.version === "string" ? raw.version : null,
      gitSha: typeof raw.gitSha === "string" ? raw.gitSha : null,
      recorded,
      invalid,
    };
  });
}

/**
 * The sha256 of each protocol file's raw bytes at a fork revision. A revision
 * the checkout cannot read is a blocker, not a mismatch: nothing was compared.
 * @param {{ forkDir: string, forkSha: string }} options
 */
export function recomputeForkProtocol({ forkDir, forkSha }) {
  /** @type {Record<string, string>} */
  const hashes = {};
  const blocked = [];
  for (const key of PROTOCOL_SHA256_KEYS) {
    const path = PROTOCOL_FILES[key];
    const run = runGit(["-C", forkDir, "show", `${forkSha}:${path}`]);
    if (run.status !== 0) {
      const why = tail(String(run.stderr ?? run.error?.message ?? ""), 2) || "git show failed";
      blocked.push(`fork_unreadable:${key} (${why.trim()})`);
      continue;
    }
    hashes[key] = sha256Hex(run.stdout);
  }
  return { hashes: Object.keys(hashes).length > 0 ? hashes : null, blocked };
}

/**
 * Every FAIL reason the comparison produces; an empty list means the records
 * agree with the fork (or none records at all — the caller decides NOTE).
 *
 * `manifestMissing` (no installed bundle at all) keeps the one-side rule out:
 * a manifest that is not there records nothing, and the caller reports the
 * check BLOCKED rather than accusing the pins of a one-sided record.
 * @param {{ recomputed: Record<string, string> | null, manifestRecord: Record<string, string> | null, manifestMissing?: boolean, pins: ReturnType<typeof readPins> }} options
 */
export function compareProtocol({ recomputed, manifestRecord, manifestMissing = false, pins }) {
  const fail = [];
  const recorded = pins.filter((pin) => pin.recorded);
  for (const pin of pins) {
    if (pin.missing) fail.push(`pin_missing:${pin.module}`);
    if (pin.invalid) fail.push(`pin_invalid:${pin.module}`);
  }
  // The re-pin moves all six together: a pin that still carries no record, or
  // one that carries a different value, is a disagreement among the six.
  if (recorded.length > 0 && recorded.length < pins.length) fail.push("pins_disagree");
  if (new Set(recorded.map((pin) => JSON.stringify(pin.recorded))).size > 1) fail.push("pins_disagree");
  const manifestHas = Boolean(manifestRecord);
  if (!manifestMissing && manifestHas !== recorded.length > 0) fail.push("recorded_on_one_side");
  if (manifestRecord && recomputed) {
    for (const key of PROTOCOL_SHA256_KEYS) {
      if (manifestRecord[key] !== recomputed[key]) fail.push(`manifest_mismatch:${key}`);
    }
  }
  if (recomputed) {
    for (const pin of recorded) {
      for (const key of PROTOCOL_SHA256_KEYS) {
        if (pin.recorded[key] !== recomputed[key]) fail.push(`pin_mismatch:${pin.module}:${key}`);
      }
    }
  }
  return fail;
}

/**
 * Run the check and write <out>/protocol-hash.json.
 * @param {{ forkDir?: string | null, forkSha?: string | null, installedRoot?: string | null, pinDir?: string, outDir: string }} options
 */
export function runProtocolCheck({ forkDir, forkSha, installedRoot, pinDir = DEFAULT_PIN_DIR, outDir }) {
  const pins = readPins(pinDir);
  const fail = [];
  const blocked = [];
  const docsPin = pins.find((pin) => pin.module === "docs") ?? null;
  const gitShas = new Set(pins.filter((pin) => !pin.missing && pin.gitSha).map((pin) => pin.gitSha));

  // The default revision is the one docs.pin.json names, and it is only usable
  // when all six pins agree on it (contract 1).
  let sha = forkSha ?? docsPin?.gitSha ?? null;
  if (!forkSha && gitShas.size > 1) fail.push("pins_disagree");
  if (!forkDir) blocked.push("fork_dir_missing");
  if (!sha) blocked.push("fork_sha_unresolved");

  const recomputed = forkDir && sha ? recomputeForkProtocol({ forkDir, forkSha: sha }) : { hashes: null, blocked: ["fork_unreadable:no fork checkout"] };
  blocked.push(...recomputed.blocked);

  const installed = resolveInstalledBundle(installedRoot ?? null, docsPin?.version ?? null);
  let manifest = null;
  let manifestPath = null;
  let manifestRecord = null;
  if (installed.dir) {
    manifestPath = join(installed.dir, "manifest.json");
    try {
      manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
      manifestRecord = manifest.protocolSha256 ?? null;
    } catch (error) {
      fail.push(`manifest_unreadable (${error.message})`);
    }
  } else {
    blocked.push(`installed_bundle_missing (${installed.missing})`);
  }

  // F-03: the digests can agree while the installed bundle is another build —
  // the check proves the bundle that would be served is the pin's, so the
  // manifest's own version and gitSha must name the pin too. The tolerant
  // candidate (the bundle directory itself) passes only when they do.
  if (manifest) {
    if (docsPin?.gitSha && !sameRevision(manifest.gitSha, docsPin.gitSha)) fail.push("installed_manifest_mismatch:gitSha");
    if (docsPin?.version && manifest.version !== docsPin.version) fail.push("installed_manifest_mismatch:version");
  }

  fail.push(...compareProtocol({ recomputed: recomputed.hashes, manifestRecord, manifestMissing: manifestPath === null, pins }));

  // NOTE only when the comparison ran clean AND nothing recorded the protocol.
  const notes = fail.length === 0 && blocked.length === 0 && !manifestRecord && !pins.some((pin) => pin.recorded)
    ? ["protocol_sha256_not_recorded"]
    : [];
  const status = fail.length > 0 ? "FAIL" : blocked.length > 0 ? "BLOCKED" : notes.length > 0 ? "NOTE" : "PASS";
  const reasons = fail.length > 0 ? fail : blocked.length > 0 ? blocked : notes;

  const artifactPath = join(outDir, "protocol-hash.json");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        forkSha: sha,
        recomputed: recomputed.hashes,
        installed: manifestPath ? { path: manifestPath, protocolSha256: manifestRecord, version: manifest?.version ?? null } : null,
        pins: Object.fromEntries(pins.map((pin) => [pin.module, { version: pin.version, gitSha: pin.gitSha, protocolSha256: pin.recorded, error: pin.invalid }])),
        verdict: { status, reasons },
      },
      null,
      2,
    )}\n`,
  );

  return { status, reasons, artifacts: [relativeToOut(outDir, artifactPath)] };
}