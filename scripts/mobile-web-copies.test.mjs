import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appFiles,
  codeChars,
  COPY_MARK,
  copiedCodeChars,
  copyHeaderOf,
  drift,
  headerOf,
  MANIFEST,
  nextCeiling,
  nextManifest,
  pathsNamedIn,
  readManifest,
  scanCopies,
  sourcesIn,
  targetProblem,
} from "./mobile-web-copies.mjs";

// ADR 0011 keeps views and the stateful core modules out of the phone, so some
// web logic is copied into apps/chat-mobile. A copy names its source in its
// header; apps/chat-mobile/web-copies.json records the hash of each source as
// of the last review. This test is also in ci.yml's script list: a PR that
// changes only the web still fails here until the phone's copy is looked at.

test("every copy in the app is recorded against the current hash of each web source it names", () => {
  const lines = drift();
  assert.deepEqual(
    lines,
    [],
    "A web source of a mobile copy changed, or a copy's header and the manifest disagree. Review each copy " +
      `against its source (port the fix, or decide it does not apply), then run node scripts/mobile-web-copies.mjs --write and commit ${MANIFEST}:\n` +
      lines.join("\n"),
  );
});

test("the copies never grow past the ratchet the manifest records", () => {
  const { copiedCodeChars: ceiling } = readManifest();
  assert.equal(typeof ceiling, "number", `${MANIFEST} has no copiedCodeChars ratchet: run node scripts/mobile-web-copies.mjs --write`);
  const size = copiedCodeChars();
  assert.ok(
    size <= ceiling,
    `The phone's copies of web code grew to ${size} code characters, past the ratchet's ${ceiling}. Move the logic into a ` +
      "pure core module (an endpoint factory, a function taking its dependencies) and import it instead; raise " +
      `copiedCodeChars in ${MANIFEST} by hand only in a reviewed PR that says why it cannot be shared.`,
  );
});

// A ratchet with no goal only says "not worse": the copies dropped about 8% in
// the remediation that added it and nothing said how far they still had to go.
test("the ratchet has a dated target below it, and the copies reach it by that date", () => {
  const manifest = readManifest();
  assert.equal(targetProblem(manifest), null, targetProblem(manifest) ?? "");
  assert.ok(manifest.target.copiedCodeChars < manifest.copiedCodeChars || copiedCodeChars() <= manifest.target.copiedCodeChars);
});

test("the target fails when missing, malformed or overdue, and not before its date", () => {
  const target = { copiedCodeChars: 50_000, by: "2027-02-28", why: "launch + 1" };
  assert.match(targetProblem({ copiedCodeChars: 90_000 }), /no target/);
  assert.match(targetProblem({ copiedCodeChars: 90_000, target: { ...target, why: "" } }), /no target/);
  assert.match(targetProblem({ copiedCodeChars: 90_000, target: { ...target, by: "soon" } }), /not a YYYY-MM-DD/);
  assert.equal(targetProblem({ copiedCodeChars: 90_000, target }, new Date("2027-02-28T12:00:00Z")), null);
  assert.match(targetProblem({ copiedCodeChars: 90_000, target }, new Date("2027-03-01T00:00:01Z")), /past the target of 50000 due 2027-02-28/);
  assert.equal(targetProblem({ copiedCodeChars: 49_000, target }, new Date("2027-06-01T00:00:00Z")), null);
});

test("--write lowers the ratchet and keeps the target as it was", () => {
  const target = { copiedCodeChars: 50_000, by: "2027-02-28", why: "launch + 1" };
  const written = nextManifest({}, 80_000, { copiedCodeChars: 90_000, target, copies: {} });
  assert.equal(written.copiedCodeChars, 80_000);
  assert.deepEqual(written.target, target);
  assert.equal(nextManifest({}, 95_000, { copiedCodeChars: 90_000, target, copies: {} }).copiedCodeChars, 90_000);
  assert.equal(nextManifest({}, 1_000, undefined).target, undefined);
});

test("the ratchet counts code, not layout: wrapping a line or adding a comment does not move it", () => {
  const packed = 'import { a, b } from "x";\nexport const f = (n: number) => a(n) + b(n);\n';
  const wrapped = '// what f does\nimport {\n  a,\n  b\n} from "x";\n\nexport const f = (n: number) =>\n  a(n) + b(n);\n';
  assert.equal(codeChars(wrapped), codeChars(packed));
  assert.ok(codeChars(`${packed}export const g = 1;\n`) > codeChars(packed));
});

test("the ratchet only goes down", () => {
  assert.equal(nextCeiling(4000, 5000), 4000);
  assert.equal(nextCeiling(5200, 5000), 5000);
  assert.equal(nextCeiling(4000, undefined), 4000);
});

test("the manifest records copies only, each with at least one source", () => {
  const { copies } = readManifest();
  const scanned = scanCopies();
  for (const [file, sources] of Object.entries(copies)) {
    assert.ok(Object.keys(sources).length > 0, `${file} records no source`);
    assert.ok(scanned[file], `${file} is recorded but its header names no web source`);
  }
});

test("a header's sources are read with braces expanded and only existing repo files kept", () => {
  const header = headerOf(
    [
      "// Copied from packages/core/chat/{search-fold.ts,",
      "// initials.ts} and packages/views/chat/{chat-room-moderation-utils,use-resolved-room-permissions}.ts;",
      "// mirrors packages/core/chat/does-not-exist.ts and apps/chat-mobile/lib/utils.ts.",
      'import x from "y";',
      "// not part of the header: packages/core/chat/poll-utils.ts",
    ].join("\n"),
  );
  assert.deepEqual(sourcesIn(header), [
    "packages/core/chat/initials.ts",
    "packages/core/chat/search-fold.ts",
    "packages/views/chat/chat-room-moderation-utils.ts",
    "packages/views/chat/use-resolved-room-permissions.ts",
  ]);
});

test("a copy whose header names a web path is a copy: the path resolves to a file", () => {
  // S7 review: a path wrapped over two comment lines, or a "port of" header, used to slip past the scan.
  const scanned = scanCopies();
  const unread = [];
  for (const file of appFiles()) {
    const header = copyHeaderOf(file);
    if (!COPY_MARK.test(header) || pathsNamedIn(header).length === 0) continue;
    if (!scanned[file]) unread.push(`${file}: ${pathsNamedIn(header).join(", ")}`);
  }
  assert.deepEqual(unread, [], "A copy names a web path that resolves to no file: fix the header so the path reads whole:\n" + unread.join("\n"));
});

test("a path wrapped after a slash, and a \"port of\" header, are read", () => {
  const wrapped = headerOf(
    [
      "// The send side, copied from packages/core/chat/",
      "// {search-fold,initials}.ts; the routes are packages/core/api/endpoints/",
      "// chat-users.ts, copied: ADR 0011.",
    ].join("\n"),
  );
  assert.deepEqual(sourcesIn(wrapped), ["packages/core/api/endpoints/chat-users.ts", "packages/core/chat/initials.ts", "packages/core/chat/search-fold.ts"]);
  const port = headerOf("// Settings, the phone's port of packages/views/settings/components/\n// delete-account-dialog.tsx: what erasure does.\n");
  assert.ok(COPY_MARK.test(port));
  assert.deepEqual(sourcesIn(port), ["packages/views/settings/components/delete-account-dialog.tsx"]);
  assert.deepEqual(pathsNamedIn("// See apps/chat-mobile/lib/a.ts and packages/core/chat/{a,b}.ts."), ["packages/core/chat/{a,b}.ts"]);
});

test("drift names a changed source, a new copy, a dropped source and a stale entry", () => {
  const copies = { "apps/chat-mobile/lib/a.ts": ["packages/core/chat/search-fold.ts"], "apps/chat-mobile/lib/new.ts": ["packages/core/chat/initials.ts"] };
  const manifest = {
    copies: {
      "apps/chat-mobile/lib/a.ts": { "packages/core/chat/search-fold.ts": "0".repeat(64), "packages/core/chat/initials.ts": "0".repeat(64) },
      "apps/chat-mobile/lib/gone.ts": { "packages/core/chat/initials.ts": "0".repeat(64) },
    },
  };
  assert.deepEqual(drift(copies, manifest), [
    "apps/chat-mobile/lib/a.ts: packages/core/chat/search-fold.ts changed since the copy was last reviewed",
    `apps/chat-mobile/lib/a.ts: ${MANIFEST} records packages/core/chat/initials.ts, which the header no longer names`,
    `apps/chat-mobile/lib/new.ts: a copy of packages/core/chat/initials.ts not in ${MANIFEST}`,
    `apps/chat-mobile/lib/gone.ts: in ${MANIFEST} but no longer a copy (or gone)`,
  ]);
  assert.deepEqual(
    drift({ "apps/chat-mobile/lib/a.ts": ["packages/core/chat/search-fold.ts"] }, { copies: { "apps/chat-mobile/lib/a.ts": {} } }),
    [`apps/chat-mobile/lib/a.ts: names packages/core/chat/search-fold.ts, which ${MANIFEST} does not record`],
  );
});

test("run as a command from a checkout whose path has a space, it still reports drift", () => {
  // realpath: the main module's URL is the real path, and macOS's tmpdir is a symlink.
  const repo = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "web-copies-")), "VA Work");
  for (const dir of ["scripts", "apps/chat-mobile/lib", "apps/chat-mobile/data", "apps/chat-mobile/components"]) {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
  }
  fs.copyFileSync(new URL("./mobile-web-copies.mjs", import.meta.url), path.join(repo, "scripts/mobile-web-copies.mjs"));
  const stale = "apps/chat-mobile/lib/gone.ts";
  fs.writeFileSync(path.join(repo, MANIFEST), JSON.stringify({ copiedCodeChars: 0, copies: { [stale]: {} } }));
  try {
    const run = spawnSync(process.execPath, [path.join(repo, "scripts/mobile-web-copies.mjs")], { encoding: "utf8" });
    assert.equal(run.stdout, `${stale}: in ${MANIFEST} but no longer a copy (or gone)\n`);
    assert.equal(run.status, 1);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});
