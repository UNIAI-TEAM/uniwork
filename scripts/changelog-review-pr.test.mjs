import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDraft, runAutomation } from "./changelog-automation.mjs";
import { preparePublication, checkPublication } from "./changelog-review-pr.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "uniwork-review-pr-"));
  t.after(() => {
    const prefix = resolve(tmpdir());
    if (!resolve(root).startsWith(prefix + "\\") && !resolve(root).startsWith(prefix + "/")) throw new Error("Unexpected temp path");
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const save = (path, value) => {
    const file = join(root, path);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  };
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  git("init", "--initial-branch=develop");
  git("config", "user.name", "Changelog test");
  git("config", "user.email", "test@example.invalid");
  save("work.txt", "baseline"); git("add", "."); git("commit", "-m", "chore: baseline");
  const baseline = git("rev-parse", "HEAD");
  save("packages/core/changelog/releases.json", [{ id: "release-1-0-0", version: "1.0.0", date: "2026-10-12", sourceRef: baseline, contentKey: "initial", sections: [] }]);
  for (const locale of ["en", "vi"]) save("packages/core/i18n/locales/" + locale + ".json", { unrelated: "keep", changelog: { releases: { initial: { title: "keep " + locale } } } });
  git("add", "."); git("commit", "-m", "docs: initial catalog");
  save("work.txt", "shared work"); git("add", "."); git("commit", "-m", "feat: share work");
  const base = git("rev-parse", "HEAD");
  const commits = git("log", "--reverse", "--no-merges", "--format=%H%x00%s", baseline + ".." + base).split("\n").map(line => {
    const [hash, subject] = line.split("\0"); return { hash, subject, body: "" };
  });
  const manifest = createDraft({ releases: read("packages/core/changelog/releases.json"), commits, sourceRef: base, date: "2026-10-13" });
  Object.assign(manifest, { ready: true, title: { en: "Shared work", vi: "Công việc chung" }, summary: { en: "Connect the team.", vi: "Kết nối nhóm." }, note: { en: "Existing permissions apply.", vi: "Áp dụng quyền hiện có." } });
  manifest.changes.find(row => row.include).text = { en: "Share work with the team.", vi: "Chia sẻ công việc với nhóm." };
  const manifestPath = "packages/core/changelog/pending/1.1.0.json";
  save(manifestPath, manifest);
  const prepare = () => preparePublication({ root, manifestPath, source: base, output: "preview", issue: "UNI-1417" });
  const commit = () => {
    git("add", "packages/core/changelog", "packages/core/i18n/locales");
    git("commit", "-m", "docs: propose reviewed changelog"); return git("rev-parse", "HEAD");
  };
  return { root, git, save, read, base, manifest, manifestPath, prepare, commit };
}

test("one PR contains real bilingual prose, the catalog and a readable preview without creating a tag", t => {
  const f = fixture(t);
  const result = f.prepare();
  assert.equal(f.read("packages/core/changelog/releases.json")[0].sourceRef, f.base);
  assert.equal(f.read("packages/core/i18n/locales/vi.json").changelog.releases.v1_1_0.title, "Công việc chung");
  const preview = readFileSync(join(f.root, "packages/core/changelog/pending/1.1.0.md"), "utf8");
  assert.match(preview, /Tiếng Việt/); assert.match(preview, /English/);
  assert.match(result.prBody, /Công việc chung/); assert.match(result.prBody, /Share work with the team/);
  assert.equal(f.git("tag"), "");
  const head = f.commit();
  assert.equal(checkPublication({ root: f.root, base: f.base, head }).kind, "publication");
  assert.equal(f.git("diff", "--name-only", f.base, head).split("\n").length, 5);
});

test("incomplete translations fail before modifying the catalog", t => {
  const f = fixture(t); const before = f.read("packages/core/changelog/releases.json");
  f.manifest.changes.find(row => row.include).text.vi = "";
  f.save(f.manifestPath, f.manifest);
  assert.throws(f.prepare, /translation/);
  assert.deepEqual(f.read("packages/core/changelog/releases.json"), before);
});

test("a newer develop snapshot invalidates publication before writing", t => {
  const f = fixture(t);
  f.save("work.txt", "new unreviewed change"); f.git("add", "work.txt"); f.git("commit", "-m", "fix: more work");
  const before = f.read("packages/core/changelog/releases.json");
  assert.throws(() => preparePublication({ root: f.root, manifestPath: f.manifestPath, source: "HEAD", output: "preview", issue: "UNI-1417" }), /snapshot|refresh|source/i);
  assert.deepEqual(f.read("packages/core/changelog/releases.json"), before);
});

test("publication rejects unrelated code, unrelated locale edits and rewriting older releases", t => {
  for (const mutation of [
    f => f.save("work.txt", "unrelated code"),
    f => { const locale = f.read("packages/core/i18n/locales/en.json"); locale.unrelated = "changed"; f.save("packages/core/i18n/locales/en.json", locale); },
    f => { const catalog = f.read("packages/core/changelog/releases.json"); catalog[1].date = "2026-10-11"; f.save("packages/core/changelog/releases.json", catalog); },
  ]) {
    const f = fixture(t); f.prepare(); mutation(f);
    f.git("add", "."); f.git("commit", "-m", "docs: proposal with unrelated changes");
    assert.throws(() => checkPublication({ root: f.root, base: f.base, head: "HEAD" }));
  }
});

test("every source commit is required and Markdown must match the approved JSON", t => {
  const f = fixture(t);
  f.manifest.changes.pop(); f.save(f.manifestPath, f.manifest);
  assert.throws(f.prepare, /every source commit/);
  const g = fixture(t); g.prepare();
  g.save("packages/core/changelog/pending/1.1.0.md", "# Different prose");
  const head = g.commit();
  assert.throws(() => checkPublication({ root: g.root, base: g.base, head }), /preview|Markdown/);
});

test("rerunning preparation preserves edits outside Changelog and is idempotent", t => {
  const f = fixture(t); f.prepare(); const before = f.read("packages/core/changelog/releases.json");
  f.prepare(); assert.deepEqual(f.read("packages/core/changelog/releases.json"), before);
  const locale = f.read("packages/core/i18n/locales/en.json"); locale.unrelated = "human edit";
  f.save("packages/core/i18n/locales/en.json", locale);
  assert.throws(f.prepare, /overwrite|unrelated/i);
  assert.equal(f.read("packages/core/i18n/locales/en.json").unrelated, "human edit");
});

test("ordinary PRs and the existing notes-only workflow remain supported", t => {
  const f = fixture(t);
  assert.equal(checkPublication({ root: f.root, base: f.base, head: f.base }).kind, "no-publication");
  const head = f.commit();
  assert.equal(checkPublication({ root: f.root, base: f.base, head }).kind, "notes-only");
});

test("a tag may be added after a reviewed publication without rewriting the published metadata", t => {
  const f = fixture(t); f.prepare(); f.commit(); f.git("tag", "v1.1.0");
  const before = f.read("packages/core/changelog/releases.json");
  runAutomation({ root: f.root, command: "prepare", tag: "v1.1.0", develop: "develop", output: "tag-preview" });
  assert.deepEqual(f.read("packages/core/changelog/releases.json"), before);
});

test("preparation refuses mismatched manifest paths and outputs outside the checkout", t => {
  const f = fixture(t);
  f.save("packages/core/changelog/pending/1.2.0.json", f.manifest);
  assert.throws(() => preparePublication({ root: f.root, manifestPath: "packages/core/changelog/pending/1.2.0.json", source: f.base, output: "preview", issue: "UNI-1417" }), /path|version/);
  assert.throws(() => preparePublication({ root: f.root, manifestPath: f.manifestPath, source: f.base, output: "..", issue: "UNI-1417" }), /checkout|repository/);
});

test("untrusted source refs and evidence URLs are rejected before shared files are modified", t => {
  for (const mutation of [
    manifest => { manifest.previousSourceRef = "--all"; },
    manifest => { manifest.changes.find(row => row.include).evidence = { kind: "pr", url: "https://example.invalid/pull/1" }; },
  ]) {
    const f = fixture(t); const before = f.read("packages/core/changelog/releases.json");
    mutation(f.manifest); f.save(f.manifestPath, f.manifest);
    assert.throws(f.prepare, /reference|evidence/);
    assert.deepEqual(f.read("packages/core/changelog/releases.json"), before);
  }
});

test("legacy tag-generated catalog PRs still pass the content guard", t => {
  const f = fixture(t);
  f.git("add", f.manifestPath); f.git("commit", "-m", "docs: reviewed notes");
  const tagSource = f.git("rev-parse", "HEAD"); f.git("tag", "v1.1.0");
  runAutomation({ root: f.root, command: "prepare", tag: "v1.1.0", develop: "develop", output: "tag-preview" });
  f.git("add", "packages/core/changelog/releases.json", "packages/core/i18n/locales");
  f.git("commit", "-m", "docs: publish tagged catalog");
  assert.equal(checkPublication({ root: f.root, base: tagSource, head: "HEAD" }).kind, "publication");
});
