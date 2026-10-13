import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { prepareRelease } from "./changelog-automation.mjs";

const CATALOG = "packages/core/changelog/releases.json";
const LOCALE = locale => "packages/core/i18n/locales/" + locale + ".json";
const SHA = /^[0-9a-f]{40}$/u;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const JSON_TEXT = value => JSON.stringify(value, null, 2) + "\n";
const paths = version => [
  "packages/core/changelog/pending/" + version + ".json",
  "packages/core/changelog/pending/" + version + ".md", CATALOG, LOCALE("en"), LOCALE("vi"),
];
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function git(root, args) { return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }).trimEnd(); }
function commit(root, ref) {
  requireValue(typeof ref === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(ref), "Invalid Git reference.");
  return git(root, ["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]).trim();
}
function ancestor(root, from, to) {
  try { git(root, ["merge-base", "--is-ancestor", from, to]); } catch { throw new Error("Invalid release source ancestry."); }
}
const at = (root, ref, path) => git(root, ["show", ref + ":" + path]);
const read = (root, ref, path) => JSON.parse(at(root, ref, path));
const changed = (root, base, head) => git(root, ["diff", "--name-only", base, head, "--"]).split("\n").filter(Boolean);
function safePath(root, path) {
  const file = resolve(root, path);
  const rel = relative(root, file);
  requireValue(rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep), "Output must stay within the checkout.");
  let parent = file;
  while (!existsSync(parent)) parent = resolve(parent, "..");
  const actual = realpathSync(parent);
  const actualRel = relative(realpathSync(root), actual);
  requireValue(!isAbsolute(actualRel) && actualRel !== ".." && !actualRel.startsWith(".." + sep), "Path escapes the checkout.");
  requireValue(!existsSync(file) || !lstatSync(file).isSymbolicLink(), "Symbolic output paths are not allowed.");
  return file;
}
function write(root, path, value) {
  const file = safePath(root, path); mkdirSync(resolve(file, ".."), { recursive: true }); writeFileSync(file, value, "utf8");
}
function verifyCommits(root, manifest) {
  requireValue(SHA.test(manifest.sourceRef) && SHA.test(manifest.previousSourceRef), "Invalid manifest source references.");
  ancestor(root, manifest.previousSourceRef, manifest.sourceRef);
  const hashes = git(root, ["log", "--no-merges", "--format=%H", manifest.previousSourceRef + ".." + manifest.sourceRef, "--"]).split("\n").filter(Boolean).sort();
  requireValue(Array.isArray(manifest.changes) && isDeepStrictEqual(hashes, manifest.changes.map(row => row.commit).sort()), "Draft must account for every source commit.");
}
function build(root, manifest, base, publicationSource = base) {
  requireValue(VERSION.test(manifest.version), "Invalid release version.");
  verifyCommits(root, manifest);
  for (const row of manifest.changes) if (row.evidence?.kind === "pr") requireValue(/^https:\/\/github\.com\/UNIAI-TEAM\/uniwork\/pull\/[1-9]\d*$/u.test(row.evidence.url ?? ""), "PR evidence must stay in the UniWork repository.");
  return prepareRelease({
    manifest, releases: read(root, base, CATALOG),
    locales: Object.fromEntries(["en", "vi"].map(locale => [locale, read(root, base, LOCALE(locale))])),
    tag: "v" + manifest.version, sourceRef: publicationSource,
  });
}
const preview = result => "# UniWork v" + result.version + "\n\n" + result.notes;
function assertScope(files, allowed) { requireValue(files.every(path => allowed.includes(path)), "Changelog publication contains unrelated files."); }

/** Agent prepares a proposal only. No push, tag, merge or release is performed here. */
export function preparePublication({ root, manifestPath, source = "origin/develop", output = ".changelog-ci", issue }) {
  safePath(root, output);
  const manifest = JSON.parse(readFileSync(safePath(root, manifestPath), "utf8"));
  const allowed = paths(manifest.version);
  requireValue(manifestPath === allowed[0], "Manifest path must match its version.");
  requireValue(/^UNI-[1-9]\d*$/u.test(issue ?? ""), "Provide the content review issue key.");
  const base = commit(root, source);
  requireValue(manifest.sourceRef === base, "Reviewed source snapshot is stale; refresh from develop before preparing the PR.");
  assertScope(changed(root, base, commit(root, "HEAD")), allowed);
  const result = build(root, manifest, base);
  const outputs = [[CATALOG, result.releases], ...["en", "vi"].map(locale => [LOCALE(locale), result.locales[locale]])];
  // Never overwrite unrelated human edits in these shared files, even on a retry.
  for (const [path, value] of outputs) {
    const current = JSON.parse(readFileSync(safePath(root, path), "utf8"));
    requireValue(isDeepStrictEqual(current, read(root, base, path)) || isDeepStrictEqual(current, value), "Refusing to overwrite unrelated edits in " + path);
  }
  for (const [path, value] of outputs) write(root, path, JSON_TEXT(value));
  write(root, allowed[1], preview(result));
  const prBody = "Issue: " + issue + " (C-07 / UNI-443)\n\n" +
    "## Review / Duyệt nội dung\n\n" +
    "Review the Vietnamese and English text below. Request changes here or approve and merge this PR when CI passes. " +
    "This PR already includes the manifest, readable preview, catalog and both Changelog translations. " +
    "After merge and the normal web deployment, the version appears on /changelog; no artifact download or manual tag is needed.\n\n" +
    "Source / Nguồn: " + base + "\n\n" + preview(result) +
    "\n## Evidence / Bằng chứng\n\n" +
    manifest.changes.map(row => "- " + row.commit + ": " + (row.include ? "include / " + row.kind : "exclude / " + row.excludeReason.replace(/[\r\n]/gu, " ")) + (row.evidence?.kind === "pr" ? " — " + row.evidence.url : " — commit fallback")).join("\n") + "\n";
  write(root, output + "/pr-body.md", prBody);
  write(root, output + "/review.json", JSON_TEXT({ issue, version: result.version, sourceRef: base, files: allowed }));
  return { ...result, prBody, files: allowed };
}

/** Read-only CI guard: validates data generated by a content PR against its base, not the agent's claims. */
export function checkPublication({ root, base = "origin/develop", head = "HEAD" }) {
  const baseRef = commit(root, base); const headRef = commit(root, head);
  // Only inspect this PR's changes; a release added to develop after the
  // branch split must not look like a catalog deletion in an unrelated PR.
  const branchPoint = git(root, ["merge-base", baseRef, headRef]);
  const files = changed(root, branchPoint, headRef);
  const manifests = files.filter(path => /^packages\/core\/changelog\/pending\/\d+\.\d+\.\d+\.json$/u.test(path));
  if (!files.includes(CATALOG)) {
    if (!manifests.length) return { kind: "no-publication" };
    requireValue(manifests.length === 1, "Review one release at a time.");
    const manifest = read(root, headRef, manifests[0]);
    assertScope(files, paths(manifest.version).slice(0, 2));
    requireValue(manifest.sourceRef === baseRef, "Reviewed source snapshot is stale; refresh the PR.");
    build(root, manifest, baseRef);
    return { kind: "notes-only", version: manifest.version };
  }
  const previous = read(root, baseRef, CATALOG); const proposed = read(root, headRef, CATALOG);
  requireValue(Array.isArray(proposed) && proposed.length === previous.length + 1, "Publication must add exactly one release.");
  const record = proposed[0]; requireValue(SHA.test(record.sourceRef), "Invalid published source reference."); requireValue(VERSION.test(record.version), "Invalid release version.");
  const allowed = paths(record.version); assertScope(files, allowed);
  const manifest = read(root, headRef, allowed[0]);
  const direct = files.includes(allowed[0]);
  if (direct) requireValue(manifest.sourceRef === baseRef && record.sourceRef === baseRef, "Reviewed source snapshot is stale; refresh the PR.");
  else {
    // Existing stable-tag publication PRs remain valid; the tag snapshot was checked by the release job.
    ancestor(root, manifest.sourceRef, record.sourceRef); ancestor(root, record.sourceRef, baseRef);
    assertScope(changed(root, manifest.sourceRef, record.sourceRef), allowed.slice(0, 2));
  }
  const expected = build(root, manifest, baseRef, record.sourceRef);
  requireValue(isDeepStrictEqual(proposed, expected.releases), "Published metadata changed or catalog does not match the reviewed manifest.");
  for (const locale of ["en", "vi"]) requireValue(isDeepStrictEqual(read(root, headRef, LOCALE(locale)), expected.locales[locale]), "Unrelated locale edits or Changelog text does not match the reviewed manifest.");
  if (direct) requireValue(at(root, headRef, allowed[1]).trimEnd() === preview(expected).trimEnd(), "Readable Markdown preview must match the reviewed JSON.");
  return { kind: "publication", version: record.version, sourceRef: record.sourceRef };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2); const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    requireValue(["--manifest", "--source", "--output", "--issue", "--base", "--head"].includes(args[i]) && args[i + 1], "Invalid review PR arguments.");
    flags[args[i].slice(2) === "manifest" ? "manifestPath" : args[i].slice(2)] = args[i + 1];
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  requireValue(command === "prepare" || command === "check", "Use prepare or check.");
  const result = command === "prepare" ? preparePublication({ root, ...flags }) : checkPublication({ root, ...flags });
  process.stdout.write(command === "prepare" ? "Review PR prepared for v" + result.version + "; no publication performed.\n" : "Changelog PR check passed: " + result.kind + "\n");
}
