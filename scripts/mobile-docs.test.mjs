import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// apps/chat-mobile/CLAUDE.md is read by every agent session that touches the
// app, so it is a map, not a manual: layers, boundaries, where code goes and
// which test holds each rule. The design of each part lives in
// docs/engineering/unichat-mobile/. It grew to 900 lines once because nothing
// held it; these tests do.
const root = path.resolve(import.meta.dirname, "..");
const APP = "apps/chat-mobile";
const DOCS = "docs/engineering/unichat-mobile";
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const MAX_LINES = 200;
const MAX_BYTES = 20_000;

test("the app's CLAUDE.md stays a short map", () => {
  const doc = read(`${APP}/CLAUDE.md`);
  const lines = doc.split("\n").length;
  assert.ok(lines <= MAX_LINES, `${APP}/CLAUDE.md has ${lines} lines (cap ${MAX_LINES}): move the detail into ${DOCS}/<part>.md`);
  assert.ok(Buffer.byteLength(doc) <= MAX_BYTES, `${APP}/CLAUDE.md is ${Buffer.byteLength(doc)} bytes (cap ${MAX_BYTES})`);
});

test("every part document is on the map and in the index, and every one named exists", () => {
  const claude = read(`${APP}/CLAUDE.md`);
  const index = read(`${DOCS}/README.md`);
  const parts = fs.readdirSync(path.join(root, DOCS)).filter((f) => f.endsWith(".md") && f !== "README.md");
  assert.ok(parts.length > 0, `${DOCS} has no part documents`);
  for (const part of parts) {
    assert.ok(claude.includes(`${DOCS}/${part}`), `${APP}/CLAUDE.md does not point at ${DOCS}/${part}`);
    assert.ok(index.includes(`(${part})`), `${DOCS}/README.md does not list ${part}`);
  }
  for (const named of claude.matchAll(/docs\/engineering\/unichat-mobile\/([\w.-]+\.md)/g)) {
    assert.ok(exists(`${DOCS}/${named[1]}`), `${APP}/CLAUDE.md points at ${DOCS}/${named[1]}, which is not there`);
  }
});

test("every path the map names still exists", () => {
  const doc = read(`${APP}/CLAUDE.md`);
  const dead = [];
  for (const [, token] of doc.matchAll(/`([^`\s]+)`/g)) {
    // A file path: has a slash and an extension, no glob, placeholder or route parameter.
    if (!/\/[^/]*\.[a-z]{2,4}$/.test(token) || /[*<>{}[\]]/.test(token)) continue;
    if (!exists(token) && !exists(`${APP}/${token}`)) dead.push(token);
  }
  assert.deepEqual(dead, [], `${APP}/CLAUDE.md names paths that are not there`);
});

test("each part document carries its status line", () => {
  for (const part of fs.readdirSync(path.join(root, DOCS)).filter((f) => f.endsWith(".md"))) {
    assert.match(read(`${DOCS}/${part}`), /^> \*\*Trạng thái:\*\* /m, `${DOCS}/${part} has no "> **Trạng thái:**" line`);
  }
});
