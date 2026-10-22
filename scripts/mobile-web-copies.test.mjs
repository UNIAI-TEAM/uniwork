import { test } from "node:test";
import assert from "node:assert/strict";
import { appFiles, COPY_MARK, copiedLines, copyHeaderOf, drift, headerOf, MANIFEST, nextCeiling, pathsNamedIn, readManifest, scanCopies, sourcesIn } from "./mobile-web-copies.mjs";

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

test("the copied lines never grow past the ratchet the manifest records", () => {
  const { copiedLines: ceiling } = readManifest();
  assert.equal(typeof ceiling, "number", `${MANIFEST} has no copiedLines ratchet: run node scripts/mobile-web-copies.mjs --write`);
  const lines = copiedLines();
  assert.ok(
    lines <= ceiling,
    `The phone's copies of web code grew to ${lines} lines, past the ratchet's ${ceiling}. Move the logic into a ` +
      "pure core module (an endpoint factory, a function taking its dependencies) and import it instead; raise " +
      `copiedLines in ${MANIFEST} by hand only in a reviewed PR that says why it cannot be shared.`,
  );
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
