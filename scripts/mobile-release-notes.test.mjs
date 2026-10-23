import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MAX_NOTES, NOTES_FILE, draftFrom, notesFor, parseNotes } from "./mobile-release-notes.mjs";

const root = path.resolve(import.meta.dirname, "..");

// The production promotion sends these to Play (scripts/mobile-play-release.mjs): the version the app builds now has
// its notes in both languages of the listing, within Play's limit, before anyone tags it.
test("the app's current store version has its What's new in Vietnamese and English", () => {
  const version = fs.readFileSync(path.join(root, "apps/chat-mobile/app.config.ts"), "utf8").match(/^\s+version: "(\d+\.\d+\.\d+)",$/m)?.[1];
  assert.ok(version, "app.config.ts names a version");
  const result = notesFor(fs.readFileSync(NOTES_FILE, "utf8"), version);
  assert.equal(result.problems, undefined, (result.problems ?? []).join("\n"));
  assert.deepEqual(result.releaseNotes.map((n) => n.language), ["vi-VN", "en-US"]);
});

test("the notes parser reads one section per version and reports what Play would refuse", () => {
  const md = ["# Title", "intro", "## 1.0.0", "### vi-VN", "", "Mới", "### en-US", "New", "", "## Not a version", "### vi-VN", "ignored", "## 0.9.0", "### en-US", "Old"].join("\n");
  assert.deepEqual(parseNotes(md), { "1.0.0": { "vi-VN": "Mới", "en-US": "New" }, "0.9.0": { "en-US": "Old" } });
  assert.deepEqual(notesFor(md, "1.0.0"), { releaseNotes: [{ language: "vi-VN", text: "Mới" }, { language: "en-US", text: "New" }] });
  assert.deepEqual(notesFor(md, "0.9.0").problems, ["0.9.0: no vi-VN notes"]);
  assert.match(notesFor(md, "2.0.0").problems[0], /no "## 2\.0\.0" section/);
  const long = `## 1.0.0\n### vi-VN\n${"ầ".repeat(MAX_NOTES + 1)}\n### en-US\nok\n### fr-FR\nbonjour`;
  assert.deepEqual(notesFor(long, "1.0.0").problems, [`1.0.0: the vi-VN notes are ${MAX_NOTES + 1} characters, Play takes ${MAX_NOTES}`, "1.0.0: languages the listing does not have: fr-FR"]);
  assert.equal(notesFor(`## 1.0.0\n### vi-VN\n${"ầ".repeat(MAX_NOTES)}\n### en-US\nok`, "1.0.0").problems, undefined, "the limit counts characters, not bytes");
});

test("a draft keeps the app's features and fixes and the issue titles", () => {
  assert.deepEqual(
    draftFrom(["feat(chat-mobile): reply from the notification", "fix(chat-mobile): the contacts index no longer crashes", "test(chat-mobile): floors", "feat(server): pushes", "UNI-2053: UniChat mobile 8/10", ""]),
    ["- reply from the notification", "- Fix: the contacts index no longer crashes", "- UniChat mobile 8/10"],
  );
});
