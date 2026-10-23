#!/usr/bin/env node
// The "What's new" text of each UniChat store version, in Vietnamese and
// English, from apps/chat-mobile/store/release-notes.md (one `## <version>`
// section, one `### vi-VN` and one `### en-US` under it). The production
// promotion hands it to Play (scripts/mobile-play-release.mjs), so a version
// without both is not promoted; scripts/mobile-release-notes.test.mjs fails
// while the app's current version has none.
//
//   node scripts/mobile-release-notes.mjs check <version>   exit 1 unless both languages are there and fit
//   node scripts/mobile-release-notes.mjs draft             the app's feat/fix commits since the last tag, to write from
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
export const NOTES_FILE = path.join(root, "apps/chat-mobile/store/release-notes.md");
export const LANGUAGES = ["vi-VN", "en-US"];
/** Play's limit for one language's release notes. */
export const MAX_NOTES = 500;

/** Every version's notes: { "0.3.0": { "vi-VN": "…", "en-US": "…" } }. */
export function parseNotes(markdown) {
  const out = {};
  let version = null;
  let language = null;
  for (const line of markdown.split("\n")) {
    const v = line.match(/^## (\d+\.\d+\.\d+)\s*$/);
    if (v) {
      version = v[1];
      language = null;
      out[version] = {};
      continue;
    }
    if (/^## /.test(line)) {
      version = null;
      continue;
    }
    const l = line.match(/^### (\S+)\s*$/);
    if (l && version) {
      language = l[1];
      out[version][language] = "";
      continue;
    }
    if (version && language) out[version][language] += `${line}\n`;
  }
  for (const notes of Object.values(out)) for (const key of Object.keys(notes)) notes[key] = notes[key].trim();
  return out;
}

/** The notes of `version` in Play's shape, or the problems that keep it from being promoted. */
export function notesFor(markdown, version) {
  const notes = parseNotes(markdown)[version];
  if (!notes) return { problems: [`no "## ${version}" section in apps/chat-mobile/store/release-notes.md`] };
  const problems = [];
  for (const language of LANGUAGES) {
    const text = notes[language] ?? "";
    if (!text) problems.push(`${version}: no ${language} notes`);
    else if ([...text].length > MAX_NOTES) problems.push(`${version}: the ${language} notes are ${[...text].length} characters, Play takes ${MAX_NOTES}`);
  }
  const unknown = Object.keys(notes).filter((language) => !LANGUAGES.includes(language));
  if (unknown.length) problems.push(`${version}: languages the listing does not have: ${unknown.join(", ")}`);
  if (problems.length) return { problems };
  return { releaseNotes: LANGUAGES.map((language) => ({ language, text: notes[language] })) };
}

/** The lines worth a note among commit subjects: the app's features and fixes, issue keys kept. */
export function draftFrom(subjects) {
  return subjects
    .map((subject) => subject.match(/^(feat|fix)\(chat-mobile\): (.+)$/) ?? subject.match(/^(UNI-\d+): (.+)$/))
    .filter(Boolean)
    .map(([, kind, text]) => `- ${kind === "fix" ? "Fix: " : ""}${text}`);
}

function main(argv) {
  const [command, version] = argv;
  if (command === "check" && version) {
    const result = notesFor(fs.readFileSync(NOTES_FILE, "utf8"), version);
    for (const problem of result.problems ?? []) console.log(`::error::${problem}`);
    return result.problems ? 1 : 0;
  }
  if (command === "draft") {
    const tags = execFileSync("git", ["tag", "--list", "chat-mobile-v*", "--sort=-v:refname"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    const range = tags[0] ? `${tags[0]}..HEAD` : "HEAD";
    const subjects = execFileSync("git", ["log", "--format=%s", range, "--", "apps/chat-mobile"], { cwd: root, encoding: "utf8" }).split("\n");
    console.log(`Since ${tags[0] ?? "the first commit"}:\n${draftFrom(subjects).join("\n")}`);
    return 0;
  }
  console.error("usage: mobile-release-notes.mjs check <version> | draft");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
