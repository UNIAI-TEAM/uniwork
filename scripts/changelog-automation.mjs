import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { classifyCommit, draftRelease } from "./changelog-draft.mjs";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const SHA = /^[0-9a-f]{40}$/u;
const KINDS = ["features", "improvements", "fixes"];
const CATALOG = "packages/core/changelog/releases.json";
const LOCALE = (locale) => "packages/core/i18n/locales/" + locale + ".json";
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !Number.isNaN(new Date(value + "T00:00:00Z").valueOf()) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) { const difference = BigInt(a.split(".")[i]) - BigInt(b.split(".")[i]); if (difference) return difference > 0n ? 1 : -1; }
  return 0;
}
function latestRelease(releases) {
  requireValue(releases.length > 0 && releases.every((row) => VERSION.test(row.version) && SHA.test(row.sourceRef)), "Invalid published release catalog.");
  return [...releases].sort((a, b) => compareVersions(b.version, a.version))[0];
}
function bilingual(value, label) {
  for (const locale of ["en", "vi"]) requireValue(typeof value?.[locale] === "string" && value[locale].trim().length > 0, "Missing " + label + " translation: " + locale);
}
function escapeMarkdown(text) { return text.replace(/[\\`*_{}\[\]<>]/gu, "\\$&"); }

export function createDraft({ releases, commits, sourceRef, date }) {
  const previous = latestRelease(releases);
  requireValue(SHA.test(sourceRef) && validDate(date), "Invalid source commit or date.");
  const version = previous.version.split(".").map(BigInt);
  const breaking = commits.some((row) => /^[a-z]+(?:\([^)]+\))?!:/u.test(row.subject) || /^BREAKING[ -]CHANGE:/mu.test(row.body ?? ""));
  if (breaking) { version[0]++; version[1] = 0n; version[2] = 0n; }
  else if (commits.some((row) => classifyCommit(row.subject).kind === "features")) { version[1]++; version[2] = 0n; }
  else version[2]++;
  return {
    schemaVersion: 1, version: version.join("."), date, ready: false,
    sourceRef, previousSourceRef: previous.sourceRef,
    title: { en: "", vi: "" }, summary: { en: "", vi: "" }, note: { en: "", vi: "" },
    changes: commits.map((commit) => {
      const row = classifyCommit(commit.subject);
      return {
        commit: commit.hash, subject: commit.subject, kind: row.kind,
        include: row.kind === "review" ? null : row.kind !== "internal",
        excludeReason: row.kind === "internal" ? "Internal change; confirm during review." : "",
        text: { en: "", vi: "" },
      };
    }),
  };
}

/** Only approved bilingual prose reaches the public catalog; commit subjects remain draft metadata. */
export function prepareRelease({ manifest, releases, locales, tag, sourceRef }) {
  requireValue(typeof tag === "string" && tag.startsWith("v") && VERSION.test(tag.slice(1)), "Use a stable application tag vMAJOR.MINOR.PATCH.");
  const version = tag.slice(1);
  requireValue(manifest.schemaVersion === 1 && manifest.version === version && manifest.ready === true, "Release notes must be ready and match the tag.");
  requireValue(SHA.test(sourceRef) && SHA.test(manifest.sourceRef) && SHA.test(manifest.previousSourceRef) && validDate(manifest.date), "Invalid release source or date.");
  const existing = releases.find((row) => row.version === version);
  const previous = latestRelease(existing ? releases.filter((row) => compareVersions(row.version, version) < 0) : releases);
  requireValue(compareVersions(version, previous.version) > 0, "Release version must be newer than the published baseline.");
  requireValue(manifest.previousSourceRef === previous.sourceRef, "Release draft uses a different published baseline; regenerate it.");
  requireValue(manifest.date >= previous.date, "Release date is older than the published baseline.");
  for (const field of ["title", "summary", "note"]) bilingual(manifest[field], field);
  requireValue(Array.isArray(manifest.changes), "Release changes must be an array.");
  const seen = new Set();
  const groups = Object.fromEntries(KINDS.map((kind) => [kind, []]));
  for (const row of manifest.changes) {
    requireValue(SHA.test(row.commit) && !seen.has(row.commit), "Duplicate or invalid source commit.");
    seen.add(row.commit);
    requireValue(typeof row.include === "boolean", "Each ambiguous commit needs an explicit include/exclude decision.");
    if (!row.include) { requireValue(typeof row.excludeReason === "string" && row.excludeReason.trim(), "Excluded commits need a reason."); continue; }
    requireValue(KINDS.includes(row.kind), "Included changes need a public category.");
    bilingual(row.text, "change");
    groups[row.kind].push({ key: "c" + row.commit, text: row.text });
  }
  requireValue(Object.values(groups).some((rows) => rows.length), "No reviewed public changes to release.");
  const contentKey = "v" + version.replaceAll(".", "_");
  const record = {
    id: "release-" + version.replaceAll(".", "-"), version, date: manifest.date, sourceRef, contentKey,
    sections: KINDS.filter((kind) => groups[kind].length).map((kind) => ({ kind, items: groups[kind].map((row) => row.key) })),
  };
  const resultLocales = structuredClone(locales);
  const texts = {};
  for (const locale of ["en", "vi"]) {
    const content = { title: manifest.title[locale], summary: manifest.summary[locale], note: manifest.note[locale] };
    for (const kind of KINDS) if (groups[kind].length) content[kind] = Object.fromEntries(groups[kind].map((row) => [row.key, row.text[locale]]));
    texts[locale] = content;
    requireValue(resultLocales[locale]?.changelog?.releases, "Missing changelog locale container.");
    const old = resultLocales[locale].changelog.releases[contentKey];
    if (existing || old) requireValue(isDeepStrictEqual(old, content), "Published release content is immutable.");
    resultLocales[locale].changelog.releases[contentKey] = content;
  }
  if (existing) requireValue(isDeepStrictEqual(existing, record), "Published release metadata is immutable.");
  const resultReleases = existing ? structuredClone(releases) : [record, ...structuredClone(releases)];
  const labels = { en: { features: "New features", improvements: "Improvements", fixes: "Bug fixes" }, vi: { features: "Tính năng mới", improvements: "Cải tiến", fixes: "Sửa lỗi" } };
  const notes = ["en", "vi"].map((locale) => {
    const content = texts[locale];
    return "## " + (locale === "en" ? "English" : "Tiếng Việt") + "\n\n" + escapeMarkdown(content.title) + "\n\n" +
      escapeMarkdown(content.summary) + "\n\n" + KINDS.filter((kind) => groups[kind].length).map((kind) =>
        "## " + labels[locale][kind] + "\n\n" + groups[kind].map((row) => "- " + escapeMarkdown(row.text[locale])).join("\n")
      ).join("\n\n") + "\n\n" + escapeMarkdown(content.note);
  }).join("\n\n---\n\n") + "\n";
  return { releases: resultReleases, locales: resultLocales, notes, version, sourceRef };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
}
function resolveCommit(root, ref) {
  requireValue(typeof ref === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(ref), "Invalid Git reference.");
  return git(root, ["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]).trim();
}
function ancestor(root, from, to, message) {
  try { git(root, ["merge-base", "--is-ancestor", from, to]); } catch { throw new Error(message); }
}
function readCommits(root, from, to) {
  const raw = git(root, ["log", "--reverse", "--no-merges", "--format=%H%x00%s%x00%b%x00", from + ".." + to, "--"]);
  const fields = raw.split("\0");
  const commits = [];
  for (let i = 0; i + 2 < fields.length; i += 3) commits.push({ hash: fields[i].trim(), subject: fields[i + 1], body: fields[i + 2] });
  return commits;
}
function inside(root, path) {
  const file = resolve(root, path);
  const rel = relative(root, file);
  requireValue(rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep) && !resolve(file).startsWith("\\\\"), "Output must stay within the repository.");
  return file;
}
function write(root, path, content) {
  const file = inside(root, path);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, content, "utf8");
}
const json = (value) => JSON.stringify(value, null, 2) + "\n";

/** Local preparation only. GitHub mutations belong to the explicit workflow steps. */
export function runAutomation({ root, command, to = "HEAD", date = new Date().toISOString().slice(0, 10), tag, develop = "origin/develop", output = ".changelog-ci" }) {
  inside(root, output); // Validate before any write.
  const releases = JSON.parse(readFileSync(resolve(root, CATALOG), "utf8"));
  if (command === "draft") {
    const sourceRef = resolveCommit(root, to);
    const previous = latestRelease(releases);
    ancestor(root, previous.sourceRef, sourceRef, "Published baseline is not an ancestor of the draft.");
    const commits = readCommits(root, previous.sourceRef, sourceRef);
    const manifest = createDraft({ releases, commits, sourceRef, date });
    write(root, output + "/unreleased.json", json(manifest));
    write(root, output + "/unreleased.md", draftRelease(commits, manifest.version, date));
    return { manifest };
  }
  requireValue(command === "prepare" && typeof tag === "string" && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag), "Unknown command or invalid stable release tag.");
  const sourceRef = resolveCommit(root, "refs/tags/" + tag);
  const developRef = resolveCommit(root, develop);
  ancestor(root, sourceRef, developRef, "Release tag must be on develop.");
  const pendingPath = "packages/core/changelog/pending/" + tag.slice(1) + ".json";
  let manifest;
  try { manifest = JSON.parse(git(root, ["show", sourceRef + ":" + pendingPath])); }
  catch { throw new Error("No reviewed notes in tag snapshot: " + pendingPath); }
  requireValue(SHA.test(manifest.sourceRef) && SHA.test(manifest.previousSourceRef), "Invalid manifest source references.");
  ancestor(root, manifest.previousSourceRef, manifest.sourceRef, "Invalid draft baseline ancestry.");
  ancestor(root, manifest.sourceRef, sourceRef, "Reviewed draft is not an ancestor of the release tag.");
  const changed = git(root, ["diff", "--name-only", manifest.sourceRef, sourceRef, "--"]).split("\n").filter(Boolean);
  const published = releases.find((row) => row.version === tag.slice(1));
  const allowed = published?.sourceRef === manifest.sourceRef ? [pendingPath, pendingPath.replace(/\.json$/u, ".md"), CATALOG, LOCALE("en"), LOCALE("vi")] : [pendingPath];
  requireValue(changed.every((path) => allowed.includes(path)), "Release notes are stale: application code changed after the reviewed draft.");
  const commits = readCommits(root, manifest.previousSourceRef, manifest.sourceRef);
  requireValue(Array.isArray(manifest.changes) && isDeepStrictEqual([...commits.map((row) => row.hash)].sort(), [...manifest.changes.map((row) => row.commit)].sort()), "Draft does not account for every source commit.");
  const locales = Object.fromEntries(["en", "vi"].map((locale) => [locale, JSON.parse(readFileSync(resolve(root, LOCALE(locale)), "utf8"))]));
  const result = prepareRelease({ manifest, releases, locales, tag, sourceRef: published?.sourceRef ?? sourceRef });
  for (const [path, value] of [[CATALOG, result.releases], ...["en", "vi"].map((locale) => [LOCALE(locale), result.locales[locale]])]) write(root, path, json(value));
  write(root, output + "/release-notes.md", result.notes);
  write(root, output + "/pr-body.md", "Issue: UNI-1310 (C-07 / UNI-443)\n\nPublish approved bilingual notes for " + tag + ". Source: " + sourceRef +
    ". Updates only the public release catalog and locale content. The tagged source contains the reviewed manifest.\n\n" + result.notes);
  write(root, output + "/release.json", json({ tag, version: result.version, sourceRef }));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    requireValue(["--to", "--date", "--tag", "--develop", "--output"].includes(args[i]) && args[i + 1], "Usage: changelog-automation.mjs draft|prepare [--to ref] [--date YYYY-MM-DD] [--tag vX.Y.Z] [--output directory]");
    flags.set(args[i].slice(2), args[i + 1]);
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = runAutomation({ root, command, ...Object.fromEntries(flags) });
  process.stdout.write(command === "draft" ? "Draft ready; suggested v" + result.manifest.version + "\n" : "Approved release ready: v" + result.version + "\n");
}
