import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDraft, prepareRelease, runAutomation } from "./changelog-automation.mjs";

const hash = (letter) => letter.repeat(40);
const initial = { id: "release-1-0-0", version: "1.0.0", date: "2026-10-12", sourceRef: hash("a"), contentKey: "initial", sections: [] };
const commits = [
  { hash: hash("b"), subject: "feat(chat): keep replies together", body: "" },
  { hash: hash("c"), subject: "fix(tasks): preserve an assignee", body: "" },
  { hash: hash("d"), subject: "UNI-1002: add meeting notes", body: "" },
  { hash: hash("e"), subject: "ci: pin runner", body: "" },
];
function approved() {
  const draft = createDraft({ releases: [initial], commits, sourceRef: hash("f"), date: "2026-10-13" });
  draft.ready = true;
  draft.title = { en: "Conversations stay with the work", vi: "Trao đổi cùng công việc" };
  draft.summary = { en: "Replies and assignments stay connected.", vi: "Giữ trả lời và người phụ trách gắn với công việc." };
  draft.note = { en: "Workspace permissions still apply.", vi: "Vẫn áp dụng quyền truy cập workspace." };
  for (const change of draft.changes) {
    if (change.kind === "review") { change.kind = "features"; change.include = true; }
    if (change.include) change.text = { en: "A reviewed update " + change.commit.slice(0, 6), vi: "Cập nhật đã duyệt " + change.commit.slice(0, 6) };
  }
  return draft;
}
const locales = () => ({ en: { other: "keep", changelog: { releases: { initial: {} } } }, vi: { other: "giữ", changelog: { releases: { initial: {} } } } });
const prepare = (manifest = approved(), extra = {}) => prepareRelease({ manifest, releases: [initial], locales: locales(), tag: "v1.1.0", sourceRef: hash("f"), ...extra });

test("aggregates all authors' commits, suggests a version, and retains ambiguous changes", () => {
  const result = createDraft({ releases: [initial], commits, sourceRef: hash("f"), date: "2026-10-13" });
  assert.equal(result.version, "1.1.0");
  assert.equal(result.ready, false);
  assert.deepEqual(result.changes.map((row) => row.commit), commits.map((row) => row.hash));
  assert.equal(result.changes[2].include, null);
  assert.equal(result.changes[3].include, false);
  assert.equal(result.changes[0].text.vi, "");
  for (const breaking of ["feat(api)!: change contract", "fix: change contract"]) {
    const draft = createDraft({ releases: [initial], commits: [{ hash: hash("b"), subject: breaking, body: "BREAKING CHANGE: new contract" }], sourceRef: hash("f"), date: "2026-10-13" });
    assert.equal(draft.version, "2.0.0");
  }
});

test("builds catalog and bilingual content from reviewed notes, preserving unrelated content", () => {
  const result = prepare();
  assert.equal(result.releases[0].id, "release-1-1-0");
  assert.equal(result.releases[0].sourceRef, hash("f"));
  assert.deepEqual(result.releases[0].sections.map((row) => row.kind), ["features", "fixes"]);
  assert.equal(result.locales.en.other, "keep");
  assert.equal(result.locales.vi.changelog.releases.v1_1_0.title, approved().title.vi);
  assert.match(result.notes, /## Tính năng mới/);
  assert.match(result.notes, /## Bug fixes/);
  assert.doesNotMatch(result.notes, /pin runner|UNI-1002/);
});

test("rejects unfinished translations, unresolved commits, unapproved notes and invalid tags", () => {
  const cases = [
    (row) => { row.ready = false; },
    (row) => { row.changes[0].text.vi = ""; },
    (row) => { row.changes[2].include = null; },
    (row) => { row.changes[3].excludeReason = ""; },
    (row) => { row.changes[1].commit = row.changes[0].commit; },
    (row) => { row.date = "2026-02-30"; },
  ];
  for (const mutate of cases) { const row = approved(); mutate(row); assert.throws(() => prepare(row)); }
  for (const tag of ["office-desktop-v1.1.0", "v1.1.0-beta.1", "v01.1.0", "../v1.1.0", "v1.0.1"]) {
    assert.throws(() => prepare(approved(), { tag }));
  }
});

test("reruns are idempotent and published versions cannot be rewritten", () => {
  const first = prepare();
  const again = prepare(approved(), { releases: first.releases, locales: first.locales });
  assert.deepEqual(again.releases, first.releases);
  assert.deepEqual(again.locales, first.locales);
  const later = [...first.releases, { ...initial, version: "1.2.0", sourceRef: hash("e") }];
  assert.deepEqual(prepare(approved(), { releases: later, locales: first.locales }).releases, later);
  const changed = approved();
  changed.title.en = "Changed after publishing";
  assert.throws(() => prepare(changed, { releases: first.releases, locales: first.locales }), /immutable/);
  assert.throws(() => prepare(approved(), { releases: [{ ...initial, version: "1.2.0" }] }), /newer/);
});


function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "uniwork-changelog-"));
  t.after(() => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + "\\") && !resolve(root).startsWith(resolve(tmpdir()) + "/")) throw new Error("Unexpected temp path");
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const save = (path, value) => {
    const file = join(root, path);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  };
  git("init", "--initial-branch=develop");
  git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Changelog Test");
  save("work.txt", "baseline"); git("add", "."); git("commit", "-m", "chore: baseline");
  const baseline = git("rev-parse", "HEAD");
  save("packages/core/changelog/releases.json", [{ ...initial, sourceRef: baseline }]);
  for (const [locale, dictionary] of Object.entries(locales())) save("packages/core/i18n/locales/" + locale + ".json", dictionary);
  git("add", "."); git("commit", "-m", "chore: initial catalog");
  save("work.txt", "new feature"); git("-c", "user.name=Another Member", "-c", "user.email=member@example.invalid", "add", ".");
  git("-c", "user.name=Another Member", "-c", "user.email=member@example.invalid", "commit", "-m", "feat: add shared work");
  return { root, git, save, baseline };
}

test("Git integration: drafts collect history; only reviewed tag snapshots can update files", (t) => {
  const { root, git, save } = fixture(t);
  const source = git("rev-parse", "HEAD");
  const draft = runAutomation({ root, command: "draft", to: source, date: "2026-10-13", output: "draft" }).manifest;
  assert.equal(draft.changes.length, 2);
  assert.equal(draft.version, "1.1.0");
  const ready = { ...draft, ready: true, title: { en: "Shared work", vi: "Công việc chung" }, summary: { en: "Updates from the team.", vi: "Cập nhật từ nhóm." }, note: { en: "Uses existing permissions.", vi: "Áp dụng quyền hiện có." } };
  ready.changes[1].text = { en: "Share the work.", vi: "Chia sẻ công việc." };
  save("packages/core/changelog/pending/1.1.0.json", ready);
  git("add", "packages/core/changelog/pending/1.1.0.json"); git("commit", "-m", "docs: approve release notes"); git("tag", "v1.1.0");
  const result = runAutomation({ root, command: "prepare", tag: "v1.1.0", develop: "develop", output: "release" });
  assert.equal(result.releases[0].sourceRef, git("rev-parse", "v1.1.0"));
  assert.equal(JSON.parse(readFileSync(join(root, "packages/core/changelog/releases.json")))[0].version, "1.1.0");
  const before = readFileSync(join(root, "packages/core/i18n/locales/vi.json"), "utf8");
  runAutomation({ root, command: "prepare", tag: "v1.1.0", develop: "develop", output: "release" });
  assert.equal(readFileSync(join(root, "packages/core/i18n/locales/vi.json"), "utf8"), before);
});

test("Git integration: stale notes and tags outside develop fail before any write", (t) => {
  const { root, git, save } = fixture(t);
  const draft = runAutomation({ root, command: "draft", to: "HEAD", date: "2026-10-13", output: "draft" }).manifest;
  const ready = { ...draft, ready: true, title: { en: "Title", vi: "Tiêu đề" }, summary: { en: "Summary", vi: "Tóm tắt" }, note: { en: "Note", vi: "Ghi chú" } };
  ready.changes[1].text = { en: "Share work.", vi: "Chia sẻ công việc." };
  save("packages/core/changelog/pending/1.1.0.json", ready);
  save("work.txt", "additional unreviewed behavior");
  git("add", "."); git("commit", "-m", "fix: new behavior"); git("tag", "v1.1.0");
  const catalog = readFileSync(join(root, "packages/core/changelog/releases.json"), "utf8");
  assert.throws(() => runAutomation({ root, command: "prepare", tag: "v1.1.0", develop: "develop", output: "release" }), /stale/);
  assert.equal(readFileSync(join(root, "packages/core/changelog/releases.json"), "utf8"), catalog);
  git("switch", "-c", "other"); save("other.txt", "branch"); git("add", "."); git("commit", "-m", "feat: outside develop"); git("tag", "v1.2.0");
  assert.throws(() => runAutomation({ root, command: "prepare", tag: "v1.2.0", develop: "develop", output: "release" }), /develop/);
});

test("rejects output paths outside the repository before writing", (t) => {
  const { root } = fixture(t);
  assert.throws(() => runAutomation({ root, command: "draft", output: ".." }), /within/);
  if (process.platform === "win32") assert.throws(() => runAutomation({ root, command: "draft", output: "Z:/outside" }), /within/);
});
