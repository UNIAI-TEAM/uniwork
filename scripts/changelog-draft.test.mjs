import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCommit, draftRelease } from "./changelog-draft.mjs";

test("classifies Conventional Commits and keeps nonconforming work for review", () => {
  assert.equal(classifyCommit("feat(tasks): save a view").kind, "features");
  assert.equal(classifyCommit("fix(chat)!: keep focus").kind, "fixes");
  assert.equal(classifyCommit("perf(search): return faster").kind, "improvements");
  assert.equal(classifyCommit("UNI-1001: six Office editors").kind, "review");
  assert.equal(classifyCommit("ci: pin a tool").kind, "internal");
});
test("drafts require editorial review and escape commit markup", () => {
  const draft = draftRelease([{ hash: "a".repeat(40), subject: "feat: <script> [link]" }, { hash: "b".repeat(40), subject: "chore: dependency pin" }], "1.1.0", "2026-10-13");
  assert.match(draft, /Review, rewrite for users/);
  assert.match(draft, /\\<script\\>/);
  assert.match(draft, /Internal changes/);
});
