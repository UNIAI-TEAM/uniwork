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
