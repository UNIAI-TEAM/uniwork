import assert from "node:assert/strict";
import test from "node:test";
import {
  assigneeNote,
  commentBody,
  descriptionParts,
  mapAssignee,
  syncHash,
  taskTitle,
  DESC_LIMIT,
  TITLE_LIMIT,
} from "./map.mjs";
import { orderIssues } from "./order.mjs";
import { createLock } from "./lock.mjs";
import { loadConfig } from "./config.mjs";

test("taskTitle prefixes the key once and cuts at 500 runes", () => {
  assert.equal(taskTitle("UNI-423", "Sửa cổng"), "UNI-423: Sửa cổng");
  assert.equal(taskTitle("UNI-423", "UNI-423: Sửa cổng"), "UNI-423: Sửa cổng");
  assert.equal(taskTitle("UNI-423", "UNI-4230: khác"), "UNI-423: UNI-4230: khác");
  const long = taskTitle("UNI-423", "à".repeat(600));
  assert.equal([...long].length, TITLE_LIMIT);
  assert.ok(long.startsWith("UNI-423: "));
});

test("syncHash ignores deleted comments and comment text", () => {
  const issue = {
    title: "A",
    description: "",
    status: "todo",
    priority: "none",
    start_date: null,
    due_date: null,
    assignee_id: "",
    labels: [{ name: "uw-backend" }, { name: "phase-C" }],
    parent_issue_id: "",
  };
  const live = [{ id: "c2", content: "một" }, { id: "c1", content: "hai" }];
  const edited = [{ id: "c2", content: "đổi" }, { id: "c1", content: "hai" }];
  const withDeleted = [...live, { id: "c3", content: "x", deleted_at: "2026-01-01T00:00:00Z" }];
  assert.equal(syncHash(issue, live), syncHash(issue, edited));
  assert.equal(syncHash(issue, live), syncHash(issue, withDeleted));
  assert.notEqual(syncHash(issue, live), syncHash({ ...issue, status: "done" }, live));
});

test("description overflow is the tail after 16000 runes", () => {
  const text = "à".repeat(DESC_LIMIT + 5);
  const parts = descriptionParts(text);
  assert.equal([...parts.body].length, DESC_LIMIT);
  assert.equal(parts.overflow, "à".repeat(5));
  assert.equal(descriptionParts("ngắn").overflow, "");
});

test("comment body keeps the marker and the author line", () => {
  const body = commentBody({
    id: "c1",
    name: "An",
    agent: false,
    email: "hien.tran.vietants@gmail.com",
    content: "xin chào",
  });
  assert.ok(body.startsWith("<!-- uniai-comment:c1 -->\n"));
  assert.ok(body.includes("An (hien.tran.vietants@gmail.com)"));
  assert.ok(body.endsWith("xin chào"));
  const agent = commentBody({ id: "c2", name: "LEVI", agent: true, email: null, content: "x" });
  assert.match(agent, /LEVI \(agent\)/);
  const huge = commentBody({ id: "c3", name: "An", agent: false, email: "a@b.c", content: "à".repeat(30000) });
  assert.equal([...huge].length, 20000);
  assert.ok(huge.startsWith("<!-- uniai-comment:c3 -->\n"));
});

test("assignee note names the UniAI person or agent", () => {
  assert.match(
    assigneeNote({ id: "a1", name: "LEVI", agent: true, email: null }),
    /<!-- uniai-assignee:a1 -->\nUniWork giao issue này cho LEVI\.\n/,
  );
  assert.match(
    assigneeNote({ id: "u1", name: "Hiền", agent: false, email: "hien.tran.vietants@gmail.com" }),
    /UniWork giao issue này cho Hiền \(hien.tran.vietants@gmail.com\)\./,
  );
});

test("mapAssignee applies the three email pairs and leaves agents unassigned", () => {
  const people = new Map([
    ["user-hien", { name: "Hiền", email: "tranthihien.attt@gmail.com" }],
    ["user-stranger", { name: "Lạ", email: "la@example.com" }],
  ]);
  const agents = new Map([["agent-1", { name: "LEVI" }]]);
  const uniwork = new Map([["hien.tran.vietants@gmail.com", { user_id: "uw-hien" }]]);
  assert.deepEqual(
    mapAssignee({ assignee_id: "user-hien", assignee_type: "member" }, people, agents, uniwork),
    { assigneeId: "uw-hien", note: null },
  );
  const stranger = mapAssignee(
    { assignee_id: "user-stranger", assignee_type: "member" },
    people,
    agents,
    uniwork,
  );
  assert.equal(stranger.assigneeId, null);
  assert.equal(stranger.note.name, "Lạ");
  const agent = mapAssignee({ assignee_id: "agent-1", assignee_type: "agent" }, people, agents, uniwork);
  assert.equal(agent.assigneeId, null);
  assert.equal(agent.note.agent, true);
  assert.equal(agent.note.name, "LEVI");
});

test("orderIssues puts parents first and reports only the cycle", () => {
  const issues = [
    { id: "child", parent_issue_id: "parent" },
    { id: "parent", parent_issue_id: null },
    { id: "a", parent_issue_id: "b" },
    { id: "b", parent_issue_id: "a" },
    { id: "tail", parent_issue_id: "a" },
  ];
  const got = orderIssues(issues);
  assert.deepEqual(got.cycles.sort(), ["a", "b"]);
  assert.ok(got.order.indexOf("parent") < got.order.indexOf("child"));
  assert.ok(got.order.includes("tail"));
  assert.ok(!got.order.includes("a"));
  assert.ok(!got.order.includes("b"));
});

test("loadConfig reads the example shape and the two tokens", () => {
  const files = new Map([
    ["scripts/uniai-sync/config.json", JSON.stringify({
      uniai_project_id: "57602a20-04e8-4c08-abd5-415ccd882e05",
      uniwork_origin: "https://uniwork.example",
      uniwork_workspace_id: "ws",
      uniwork_project_id: "prj",
    })],
  ]);
  const cfg = loadConfig(
    { UNIWORK_MCP_TOKEN: "uwm_at_x", UNIWORK_SESSION_TOKEN: "sess" },
    (path) => files.get(path),
  );
  assert.equal(cfg.workspaceId, "ws");
  assert.equal(cfg.mcpToken, "uwm_at_x");
  assert.equal(cfg.sessionToken, "sess");
  assert.equal(cfg.origin, "https://uniwork.example");
});

test("createLock refuses a live pid and replaces a dead one", () => {
  const disk = new Map();
  const fs = {
    readFileSync: (path) => {
      if (!disk.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return disk.get(path);
    },
    writeFileSync: (path, value) => disk.set(path, value),
    unlinkSync: (path) => disk.delete(path),
  };
  const first = createLock(fs, () => 11, () => true);
  assert.equal(first.tryAcquire(), true);
  const second = createLock(fs, () => 22, () => true);
  assert.equal(second.tryAcquire(), false);
  const third = createLock(fs, () => 33, () => false);
  assert.equal(third.tryAcquire(), true);
  assert.equal(disk.get("scripts/uniai-sync/.sync.lock"), "33");
  third.release();
  assert.equal(disk.has("scripts/uniai-sync/.sync.lock"), false);
});
