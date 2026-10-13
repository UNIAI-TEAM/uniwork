// X-02 (UNI-1339): the frame protocol this repo vendors in packages/core/office
// must be the protocol every pinned genoffice frame bundle was built against.
// The fork records sha256 of its raw web/docs/protocol/{types,endpoint,host}.ts
// in each bundle's manifest.json (protocolSha256), the sync script copies it
// into apps/web/platform/office-frame/<module>.pin.json, and this test hashes
// the vendored copies normalised back to the fork form and compares.
//
// Normalisation (the same rule on both sides, agreed with the vendoring lane):
// drop the leading `//` vendor header lines, then the `/* eslint-disable ... */`
// lines right after them, and rewrite the import specifiers to the fork's
// ('./docs-frame-protocol' -> './types', './docs-frame-endpoint' -> './endpoint').
//
// protocolSha256 is optional in pins until the re-pin from a fork release
// (Advisor x-contracts:2, option A): pins without it must all agree on that,
// and the test says so out loud instead of passing silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OFFICE_DIR = join(repoRoot, "packages", "core", "office");
const PIN_DIR = join(repoRoot, "apps", "web", "platform", "office-frame");
const MODULES = ["docs", "pdf", "markdown", "html", "slides", "sheets"];

/** pin key -> vendored file (fork file: types.ts, endpoint.ts, host.ts) */
export const VENDORED_FILES = Object.freeze({
  protocol: "docs-frame-protocol.ts",
  endpoint: "docs-frame-endpoint.ts",
  host: "docs-frame-host.ts",
});

/**
 * A vendored file back in the fork's form. Lines split on CRLF or LF and are
 * joined with LF, so a CRLF checkout hashes like the fork's LF bytes.
 * @param {string} text
 * @returns {string}
 */
export function normaliseVendored(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && /^\/\//.test(lines[i])) i += 1;
  while (i < lines.length && /^\/\* eslint-disable .*\*\/$/.test(lines[i])) i += 1;
  return lines
    .slice(i)
    .join("\n")
    .replaceAll("'./docs-frame-protocol'", "'./types'")
    .replaceAll("'./docs-frame-endpoint'", "'./endpoint'");
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/** @returns {{ protocol: string, endpoint: string, host: string }} */
export function vendoredProtocolSha256(dir = OFFICE_DIR) {
  return Object.fromEntries(
    Object.entries(VENDORED_FILES).map(([key, file]) => [key, sha256(normaliseVendored(readFileSync(join(dir, file), "utf8")))]),
  );
}

function readPins() {
  return MODULES.map((module) => ({ module, pin: JSON.parse(readFileSync(join(PIN_DIR, `${module}.pin.json`), "utf8")) }));
}

test("normalisation strips the vendor header and pragmas and restores the fork's import specifiers", () => {
  const vendored = [
    "// Vendored from the genoffice fork,",
    "// web/docs/protocol/host.ts at abc",
    "/* eslint-disable max-lines -- vendored contract file */",
    "/**",
    " * Host side.",
    " */",
    "import { createEndpoint } from './docs-frame-endpoint'",
    "import type { Api } from './docs-frame-protocol'",
    "// a comment inside the body stays",
    "",
  ].join("\n");
  assert.equal(
    normaliseVendored(vendored),
    ["/**", " * Host side.", " */", "import { createEndpoint } from './endpoint'", "import type { Api } from './types'", "// a comment inside the body stays", ""].join("\n"),
  );
  // a file without header is its own fork form
  assert.equal(normaliseVendored("export const a = 1\n"), "export const a = 1\n");
});

test("a CRLF copy of each vendored file normalises to the same hash as the LF file", () => {
  for (const file of Object.values(VENDORED_FILES)) {
    const lf = readFileSync(join(OFFICE_DIR, file), "utf8").replaceAll("\r\n", "\n");
    const crlf = lf.replaceAll("\n", "\r\n");
    assert.notEqual(crlf, lf);
    assert.equal(sha256(normaliseVendored(crlf)), sha256(normaliseVendored(lf)), file);
  }
});

test("every frame pin records the same protocolSha256, equal to the vendored protocol", (t) => {
  const pins = readPins();
  const recorded = pins.filter(({ pin }) => pin.protocolSha256 !== undefined);
  if (recorded.length === 0) {
    // Not a skip: all six pins agree that none records the protocol yet.
    t.diagnostic(
      "NOTE: no frame pin records protocolSha256 yet; the re-pin is pending the fork release (X-02 r2). " +
        `Vendored protocol sha256: ${JSON.stringify(vendoredProtocolSha256())}`,
    );
    console.log("frame-protocol-vendor: no pin records protocolSha256 yet (all six agree); the re-pin is pending the fork release (X-02 r2)");
    return;
  }
  const missing = pins.filter(({ pin }) => pin.protocolSha256 === undefined).map(({ module }) => module);
  assert.deepEqual(missing, [], `some pins record protocolSha256 and some do not (missing: ${missing.join(", ")}); re-pin all six together`);
  const expected = vendoredProtocolSha256();
  for (const { module, pin } of pins) {
    assert.deepEqual(
      pin.protocolSha256,
      expected,
      `${module}.pin.json was built against another frame protocol than packages/core/office vendors; re-vendor or re-pin`,
    );
  }
});

test("the vendored protocol carries init.downloadMaxBytes and validates it as a positive safe integer (X-02 r2b)", () => {
  const source = normaliseVendored(readFileSync(join(OFFICE_DIR, VENDORED_FILES.protocol), "utf8"));
  const init = source.slice(source.indexOf("export interface InitPayload"), source.indexOf("export interface InitRecovery"));
  assert.match(init, /^ {2}downloadMaxBytes\?: number$/m, "InitPayload declares an optional downloadMaxBytes");
  assert.match(source, /function isPositiveSafeInt\(x: unknown\): x is number \{\s*return typeof x === 'number' && Number\.isSafeInteger\(x\) && x > 0\s*\}/);
  assert.match(source, /isOpt\(x\.downloadMaxBytes, isPositiveSafeInt\)/, "isInitPayload accepts the field only when absent or a positive safe integer");
});

test("the vendored protocol carries the G8-08 comments part: capability, commentsLevel, user id, the shared HTTP mapping", () => {
  const source = normaliseVendored(readFileSync(join(OFFICE_DIR, VENDORED_FILES.protocol), "utf8"));
  const init = source.slice(source.indexOf("export interface InitPayload"), source.indexOf("export interface InitRecovery"));
  assert.match(init, /^ {2}commentsLevel\?: CommentsLevel$/m, "InitPayload declares an optional commentsLevel");
  assert.match(source, /export function commentsErrorFromHttp\(/, "the fork's one HTTP -> protocol error mapping is vendored for the host to use");
  assert.match(source, /'comments\.list'/);
  assert.match(source, /'comments\.reveal'/);
  assert.match(source, /'comments\.changed'/);
  assert.match(source, /'mentions\.search'/);
  assert.match(source, /PROTOCOL_VERSION = 1\b/, "G8-08 adds options only, the protocol stays version 1");
});

test("the three vendored files name one fork commit in their header", () => {
  const shas = Object.entries(VENDORED_FILES).map(([key, file]) => {
    const header = readFileSync(join(OFFICE_DIR, file), "utf8").split(/\r?\n/).slice(0, 3).join("\n");
    const match = header.match(new RegExp(`web/docs/protocol/${key === "protocol" ? "types" : key}\\.ts at ([0-9a-f]{40})`));
    assert.ok(match, `${file}: no fork commit in its header`);
    return match[1];
  });
  assert.equal(new Set(shas).size, 1, `the vendored files come from different fork commits: ${shas.join(", ")}`);
});
