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
import { boundedUniaiTimeout, isUniaiTimeout, makeUniwork, syncRun, withUniaiRetries } from "./sync.mjs";

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
    ["user-long", { name: "Long", email: "12345mmmin@gmail.com" }],
    ["user-vinh", { name: "Vinh", email: "bavinh2803@gmail.com" }],
    ["user-stranger", { name: "Lạ", email: "la@example.com" }],
  ]);
  const agents = new Map([["agent-1", { name: "LEVI" }]]);
  const uniwork = new Map([
    ["hien.tran.vietants@gmail.com", { user_id: "uw-hien" }],
    ["longthldz@gmail.com", { user_id: "uw-long" }],
    ["vinhnba2803.work@gmail.com", { user_id: "uw-vinh" }],
  ]);
  assert.deepEqual(
    mapAssignee({ assignee_id: "user-hien", assignee_type: "member" }, people, agents, uniwork),
    { assigneeId: "uw-hien", note: null },
  );
  assert.deepEqual(
    mapAssignee({ assignee_id: "user-long", assignee_type: "member" }, people, agents, uniwork),
    { assigneeId: "uw-long", note: null },
  );
  assert.deepEqual(
    mapAssignee({ assignee_id: "user-vinh", assignee_type: "member" }, people, agents, uniwork),
    { assigneeId: "uw-vinh", note: null },
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
  assert.ok(got.order.includes("parent"));
  assert.ok(got.order.includes("child"));
  assert.ok(got.order.indexOf("parent") < got.order.indexOf("child"));
  assert.ok(got.order.includes("tail"));
  assert.ok(!got.order.includes("a"));
  assert.ok(!got.order.includes("b"));
});

test("loadConfig reads the example shape and the two tokens", () => {
  const files = new Map([
    ["scripts/uniai-sync/config.json", JSON.stringify({
      uniai_project_id: "57602a20-04e8-4c08-abd5-415ccd882e05",
      uniwork_origin: "https://uniwork.example/",
      uniwork_workspace_id: "ws",
      uniwork_project_id: "prj",
    })],
  ]);
  const cfg = loadConfig(
    { UNIWORK_MCP_TOKEN: "uwm_at_x", UNIWORK_SESSION_TOKEN: "sess" },
    (path) => files.get(path),
  );
  assert.equal(cfg.uniaiProjectId, "57602a20-04e8-4c08-abd5-415ccd882e05");
  assert.equal(cfg.projectId, "prj");
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

function world(issues, comments = {}) {
  const mcp = [];
  const metadata = new Map();
  const tasks = [];
  const commentsByTask = new Map();
  let seq = 0;
  const uniworkMembers = [
    { user_id: "uw-hien", email: "hien.tran.vietants@gmail.com" },
  ];
  const labels = [];
  return {
    mcp,
    metadata,
    tasks,
    deps: {
      config: {
        uniaiProjectId: "57602a20-04e8-4c08-abd5-415ccd882e05",
        origin: "https://uniwork.example",
        workspaceId: "ws",
        projectId: "prj",
        mcpToken: "uwm_at_x",
        sessionToken: "sess",
      },
      lock: { tryAcquire: () => true, release: () => {} },
      uniai: {
        listIssues: async () => issues.map((row) => ({
          ...row,
          metadata: { ...(row.metadata ?? {}), ...(metadata.get(row.id) ?? {}) },
        })),
        listComments: async (id) => comments[id] ?? [],
        listMembers: async () => [
          { user_id: "user-hien", email: "tranthihien.attt@gmail.com", name: "Hiền" },
        ],
        listAgents: async () => [{ id: "agent-1", name: "LEVI" }],
        setMetadata: async (id, key, value) => {
          const row = metadata.get(id) ?? {};
          row[key] = value;
          metadata.set(id, row);
        },
        deleteMetadata: async (id, key) => {
          const row = metadata.get(id);
          if (row) delete row[key];
        },
      },
      uniwork: {
        listMembers: async () => uniworkMembers,
        listLabels: async () => labels,
        createLabel: async (name) => {
          const row = { id: `label-${name}`, name };
          labels.push(row);
          return row;
        },
        queryTasks: async () => tasks.map((task) => ({ id: task.id, title: task.title })),
        getTask: async (id) => tasks.find((task) => task.id === id),
        createTask: async (args) => {
          mcp.push(["create_task", args]);
          const task = { id: `task-${++seq}`, revision: 1, labels: [], description_truncated: false, ...args };
          tasks.push(task);
          commentsByTask.set(task.id, []);
          return { id: task.id };
        },
        updateTask: async (args) => {
          mcp.push(["update_task", args]);
          const task = tasks.find((item) => item.id === args.task_id);
          if (task.failRevision) {
            task.failRevision = false;
            const error = new Error("revision_conflict");
            error.code = "revision_conflict";
            throw error;
          }
          Object.assign(task, args, { revision: task.revision + 1 });
          return { id: task.id };
        },
        listTaskComments: async (id) => commentsByTask.get(id) ?? [],
        addComment: async (args) => {
          mcp.push(["add_comment", args]);
          const row = { id: `c-${++seq}`, body: args.body };
          commentsByTask.get(args.task_id).push(row);
          return { id: row.id };
        },
      },
    },
  };
}

function issue(partial) {
  return {
    title: "Việc",
    description: "",
    status: "todo",
    priority: "none",
    start_date: null,
    due_date: null,
    assignee_id: "",
    assignee_type: "",
    labels: [],
    parent_issue_id: null,
    metadata: {},
    ...partial,
  };
}

test("sync creates a parent before a child and stores metadata before comments", async () => {
  const box = world(
    [
      issue({ id: "child", identifier: "UNI-2", parent_issue_id: "parent" }),
      issue({ id: "parent", identifier: "UNI-1", title: "Cha" }),
    ],
    { parent: [{ id: "note-1", author_id: "user-hien", author_type: "member", content: "đã xem", created_at: "2026-01-01T00:00:00Z" }] },
  );
  const order = [];
  const create = box.deps.uniwork.createTask;
  box.deps.uniwork.createTask = async (args) => {
    order.push(args.title);
    return create(args);
  };
  const setMetadata = box.deps.uniai.setMetadata;
  box.deps.uniai.setMetadata = async (id, key, value) => {
    if (key === "uniwork_task") order.push(`meta:${id}`);
    return setMetadata(id, key, value);
  };
  const add = box.deps.uniwork.addComment;
  box.deps.uniwork.addComment = async (args) => {
    order.push("comment");
    return add(args);
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.ok(order.indexOf("UNI-1: Cha") < order.indexOf("meta:parent"));
  assert.ok(order.indexOf("meta:parent") < order.indexOf("comment"));
  assert.ok(order.indexOf("UNI-1: Cha") < order.indexOf("UNI-2: Việc"));
  assert.ok(box.mcp.some((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-comment:note-1")));
  assert.ok(box.mcp.some((call) => call[0] === "add_comment" && String(call[1].body).includes("Hiền (hien.tran.vietants@gmail.com)")));
});

test("a second run with the same hash does not call update_task", async () => {
  const box = world([issue({ id: "only", identifier: "UNI-10", title: "Một" })]);
  await syncRun(box.deps);
  box.mcp.length = 0;
  box.deps.uniai.listIssues = async () => [
    issue({ id: "only", identifier: "UNI-10", title: "Một", metadata: box.metadata.get("only"), updated_at: "2099-01-01T00:00:00Z" }),
  ];
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.deepEqual(box.mcp, []);
});

test("an agent assignee is empty and commented once", async () => {
  const box = world([
    issue({ id: "ag", identifier: "UNI-11", assignee_id: "agent-1", assignee_type: "agent" }),
  ]);
  await syncRun(box.deps);
  await syncRun(box.deps);
  const notes = box.mcp.filter((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-assignee:"));
  assert.equal(notes.length, 1);
  assert.match(notes[0][1].body, /UniWork giao issue này cho LEVI\./);
  assert.equal(box.tasks[0].assignee_id, undefined);
});

test("a child waits until the parent has a task id", async () => {
  const box = world([issue({ id: "child", identifier: "UNI-2", parent_issue_id: "missing-parent" })]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.match(result.lines.join("\n"), /missing-parent/);
});

test("an unknown status fails that issue and continues", async () => {
  const box = world([
    issue({ id: "bad", identifier: "UNI-3", status: "triage" }),
    issue({ id: "good", identifier: "UNI-4", title: "Được" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 1);
  assert.equal(box.tasks[0].title, "UNI-4: Được");
});

test("title recovery attaches the only exact title and refuses two", async () => {
  const box = world([issue({ id: "one", identifier: "UNI-5", title: "Lạc" })]);
  box.tasks.push({ id: "already", title: "UNI-5: Lạc", revision: 4, labels: [], description: "", status: "todo", priority: "none" });
  box.deps.uniwork.queryTasks = async () => box.tasks.map((task) => ({ id: task.id, title: task.title }));
  await syncRun(box.deps);
  assert.equal(box.metadata.get("one").uniwork_task, "already");
  assert.equal(box.mcp.filter((call) => call[0] === "create_task").length, 0);

  const two = world([issue({ id: "two", identifier: "UNI-6", title: "Đôi" })]);
  two.tasks.push(
    { id: "a", title: "UNI-6: Đôi", revision: 1, labels: [] },
    { id: "b", title: "UNI-6: Đôi", revision: 1, labels: [] },
  );
  const result = await syncRun(two.deps);
  assert.equal(result.code, 1);
  assert.equal(two.mcp.filter((call) => call[0] === "create_task").length, 0);
  assert.equal(two.metadata.has("two"), false);
});

test("revision_conflict retries once", async () => {
  const box = world([issue({ id: "rev", identifier: "UNI-7", title: "Cũ" })]);
  await syncRun(box.deps);
  box.tasks[0].failRevision = true;
  box.mcp.length = 0;
  box.deps.uniai.listIssues = async () => [
    issue({ id: "rev", identifier: "UNI-7", title: "Mới", metadata: box.metadata.get("rev") }),
  ];
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.equal(box.mcp.filter((call) => call[0] === "update_task").length, 2);
  assert.equal(box.tasks[0].title, "UNI-7: Mới");
});

test("401 during startup stops the run before listing issues", async () => {
  const box = world([issue({ id: "only", identifier: "UNI-401", title: "Chưa chạy" })]);
  let listed = 0;
  box.deps.uniai.listIssues = async () => {
    listed += 1;
    return [];
  };
  box.deps.uniwork.listMembers = async () => {
    const error = new Error("unauthorized");
    error.code = "unauthorized";
    throw error;
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join("\n"), /unauthorized/);
  assert.equal(listed, 0);
  assert.equal(box.metadata.size, 0);
});

test("401 stops the run and does not write the hash", async () => {
  const box = world([
    issue({ id: "first", identifier: "UNI-8", title: "Trước" }),
    issue({ id: "second", identifier: "UNI-9", title: "Sau" }),
  ]);
  box.deps.uniwork.createTask = async () => {
    const error = new Error("unauthorized");
    error.code = "unauthorized";
    throw error;
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.metadata.has("first"), false);
  assert.equal(box.metadata.has("second"), false);
});

test("a cycle is reported and creates nothing in the cycle", async () => {
  const box = world([
    issue({ id: "a", identifier: "UNI-20", parent_issue_id: "b" }),
    issue({ id: "b", identifier: "UNI-21", parent_issue_id: "a" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.match(result.lines.join("\n"), /cycle/);
});

test("description overflow is commented once", async () => {
  const box = world([
    issue({ id: "long", identifier: "UNI-22", description: "à".repeat(16005) }),
  ]);
  await syncRun(box.deps);
  await syncRun(box.deps);
  const overflows = box.mcp.filter((call) => call[0] === "add_comment" && String(call[1].body).includes("uniai-description-overflow"));
  assert.equal(overflows.length, 1);
  assert.equal([...box.tasks[0].description].length, 16000);
});

test("a held lock exits 0 and does not list issues", async () => {
  const box = world([issue({ id: "x", identifier: "UNI-23" })]);
  let listed = 0;
  box.deps.uniai.listIssues = async () => {
    listed += 1;
    return [];
  };
  box.deps.lock = { tryAcquire: () => false, release: () => {} };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.equal(listed, 0);
  assert.match(result.lines.join("\n"), /already running/);
});

test("a missing label is created once and shared by the next issue", async () => {
  const box = world([
    issue({ id: "l1", identifier: "UNI-30", title: "Một", labels: [{ name: "uw-backend" }] }),
    issue({ id: "l2", identifier: "UNI-31", title: "Hai", labels: [{ name: "uw-backend" }] }),
  ]);
  let creates = 0;
  const createLabel = box.deps.uniwork.createLabel;
  box.deps.uniwork.createLabel = async (name) => {
    creates += 1;
    return createLabel(name);
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.equal(creates, 1);
  const made = box.mcp.filter((call) => call[0] === "create_task");
  assert.equal(made.length, 2);
  assert.deepEqual(made[0][1].label_ids, ["label-uw-backend"]);
  assert.deepEqual(made[1][1].label_ids, ["label-uw-backend"]);
});

test("two labels with one name fail only the issue that needs it", async () => {
  const box = world([
    issue({ id: "dup", identifier: "UNI-32", title: "Trùng", labels: [{ name: "uw-backend" }] }),
    issue({ id: "plain", identifier: "UNI-33", title: "Thường" }),
  ]);
  box.deps.uniwork.listLabels = async () => [
    { id: "x1", name: "uw-backend" },
    { id: "x2", name: "uw-backend" },
  ];
  let creates = 0;
  box.deps.uniwork.createLabel = async () => {
    creates += 1;
    return { id: "never", name: "uw-backend" };
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(creates, 0);
  assert.match(result.lines.join("\n"), /duplicate label uw-backend/);
  const made = box.mcp.filter((call) => call[0] === "create_task");
  assert.equal(made.length, 1);
  assert.equal(made[0][1].title, "UNI-33: Thường");
  assert.equal(box.metadata.has("dup"), false);
});

test("a reply to a deleted UniAI comment is posted without reply_to", async () => {
  const box = world(
    [issue({ id: "thread", identifier: "UNI-34", title: "Luồng" })],
    {
      thread: [
        { id: "gone", author_id: "user-hien", author_type: "member", content: "cũ", created_at: "2026-01-01T00:00:00Z", deleted_at: "2026-01-02T00:00:00Z" },
        { id: "kid", parent_id: "gone", author_id: "user-hien", author_type: "member", content: "trả lời", created_at: "2026-01-03T00:00:00Z" },
      ],
    },
  );
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  const adds = box.mcp.filter((call) => call[0] === "add_comment");
  assert.equal(adds.length, 1);
  assert.ok(String(adds[0][1].body).includes("uniai-comment:kid"));
  assert.equal("reply_to" in adds[0][1], false);
  assert.ok(box.metadata.get("thread").uniwork_sync);
});

test("a reply whose live parent cannot be copied yet does not write the hash", async () => {
  const box = world(
    [issue({ id: "loop", identifier: "UNI-35", title: "Vòng" })],
    {
      loop: [
        { id: "p", parent_id: "q", author_id: "user-hien", author_type: "member", content: "một", created_at: "2026-01-01T00:00:00Z" },
        { id: "q", parent_id: "p", author_id: "user-hien", author_type: "member", content: "hai", created_at: "2026-01-02T00:00:00Z" },
      ],
    },
  );
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.match(result.lines.join("\n"), /waiting comment loop/);
  assert.equal(box.mcp.filter((call) => call[0] === "add_comment").length, 0);
  assert.equal(box.metadata.get("loop")?.uniwork_sync, undefined);
});

test("a reply listed before its live parent is posted after it with reply_to", async () => {
  const box = world(
    [issue({ id: "order", identifier: "UNI-36", title: "Thứ tự" })],
    {
      order: [
        { id: "a-child", parent_id: "z-parent", author_id: "user-hien", author_type: "member", content: "con", created_at: "2026-01-01T00:00:00Z" },
        { id: "z-parent", author_id: "user-hien", author_type: "member", content: "cha", created_at: "2026-01-01T00:00:00Z" },
      ],
    },
  );
  const parentRowIds = [];
  const add = box.deps.uniwork.addComment;
  box.deps.uniwork.addComment = async (args) => {
    const row = await add(args);
    if (String(args.body).includes("uniai-comment:z-parent")) parentRowIds.push(row.id);
    return row;
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  const adds = box.mcp.filter((call) => call[0] === "add_comment");
  assert.equal(adds.length, 2);
  assert.ok(String(adds[0][1].body).includes("uniai-comment:z-parent"));
  assert.ok(String(adds[1][1].body).includes("uniai-comment:a-child"));
  assert.equal(parentRowIds.length, 1);
  assert.equal(adds[1][1].reply_to, parentRowIds[0]);
  assert.ok(box.metadata.get("order").uniwork_sync);
});

test("a synced task rehosts a UniAI image and rewrites the link", async () => {
  const image = "https://uniai.unicomhub.com/api/attachments/01a139b4-050f-709d-91a1-e4018b8ee2fd/download";
  const row = issue({
    id: "pic",
    identifier: "UNI-9",
    title: "Ảnh",
    description: `Xem ![image.png](${image})`,
    attachments: [{ id: "01a139b2-da35-7a74-9e83-3a1463486b95", filename: "note.pdf", content_type: "application/pdf" }],
  });
  row.metadata = { uniwork_task: "task-pic", uniwork_sync: syncHash(row, []) };
  const box = world([row]);
  box.tasks.push({
    id: "task-pic",
    title: "UNI-9: Ảnh",
    revision: 2,
    description: row.description,
    labels: [],
    description_truncated: false,
    status: "todo",
    priority: "none",
  });
  const downloads = [];
  box.deps.uniai.downloadAttachment = async (id) => {
    downloads.push(id);
    return { filename: id.endsWith("2fd") ? "image.png" : "note.pdf", bytes: Buffer.from(id), contentType: "application/octet-stream" };
  };
  const uploads = [];
  box.deps.uniwork.uploadAttachment = async (taskId, file, purpose) => {
    uploads.push({ taskId, filename: file.filename, purpose });
    return { id: `att-${uploads.length}` };
  };
  let comment = { id: "c1", body: `<!-- uniai-comment:n1 -->\nAn (a@b.c)\n\n![shot.png](${image})` };
  box.deps.uniwork.listTaskComments = async () => [comment];
  box.deps.uniwork.updateComment = async (id, body) => {
    comment = { id, body };
  };

  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  assert.deepEqual(downloads, [
    "01a139b4-050f-709d-91a1-e4018b8ee2fd",
    "01a139b2-da35-7a74-9e83-3a1463486b95",
  ]);
  assert.equal(uploads[0].purpose, "task_attachment");
  assert.equal(uploads[1].purpose, "task_attachment");
  const task = box.tasks.find((item) => item.id === "task-pic");
  assert.match(task.description, /\/api\/v1\/attachments\/att-1\/download/);
  assert.doesNotMatch(task.description, /uniai\.unicomhub\.com/);
  assert.match(comment.body, /\/api\/v1\/attachments\/att-1\/download/);
  assert.match(comment.body, /uniai-comment:n1/);
  const files = JSON.parse(box.metadata.get("pic").uniwork_files);
  assert.equal(files.clean, true);
  assert.equal(files.map["01a139b4-050f-709d-91a1-e4018b8ee2fd"], "att-1");

  downloads.length = 0;
  const again = await syncRun(box.deps);
  assert.equal(again.code, 0);
  assert.deepEqual(downloads, []);
});

test("a child recreates a parent whose stored task is not in this workspace", async () => {
  const parent = issue({ id: "parent", identifier: "UNI-1", title: "Cha" });
  parent.metadata = { uniwork_task: "stale", uniwork_sync: syncHash(parent, []) };
  const box = world([
    parent,
    issue({ id: "child", identifier: "UNI-2", title: "Con", parent_issue_id: "parent" }),
  ]);
  const create = box.deps.uniwork.createTask;
  box.deps.uniwork.createTask = async (args) => {
    if (args.parent_task_id === "stale") throw new Error("not found or not accessible");
    return create(args);
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
  const creates = box.mcp.filter((call) => call[0] === "create_task");
  assert.equal(creates.length, 2);
  assert.equal(creates[0][1].title, "UNI-1: Cha");
  assert.equal(creates[0][1].parent_task_id, undefined);
  const parentTask = box.metadata.get("parent").uniwork_task;
  assert.notEqual(parentTask, "stale");
  assert.equal(creates[1][1].parent_task_id, parentTask);
  assert.match(result.lines.at(-1), /created 2, updated 0, skipped 0/);
});

test("a parent that fails in the same run leaves the child waiting without a second failure", async () => {
  const box = world([
    issue({ id: "parent", identifier: "UNI-40", title: "Cha", status: "triage" }),
    issue({ id: "child", identifier: "UNI-41", title: "Con", parent_issue_id: "parent" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.ok(result.lines.includes("waiting child"));
  assert.ok(result.lines.includes("bad status parent"));
  const childLines = result.lines.filter((line) => line.includes("child"));
  assert.deepEqual(childLines, ["waiting child"]);
});

test("a child of an issue inside a cycle is not created", async () => {
  const box = world([
    issue({ id: "a", identifier: "UNI-42", parent_issue_id: "b" }),
    issue({ id: "b", identifier: "UNI-43", parent_issue_id: "a" }),
    issue({ id: "kid", identifier: "UNI-44", title: "Con", parent_issue_id: "a" }),
  ]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.tasks.length, 0);
  assert.match(result.lines.join("\n"), /cycle parent kid/);
});

test("a changed issue on the second run keeps one assignee note and one overflow comment", async () => {
  const rows = [
    issue({
      id: "again",
      identifier: "UNI-45",
      title: "Lặp",
      description: "à".repeat(16005),
      assignee_id: "agent-1",
      assignee_type: "agent",
    }),
  ];
  const comments = { again: [] };
  const box = world(rows, comments);
  assert.equal((await syncRun(box.deps)).code, 0);
  const firstHash = box.metadata.get("again").uniwork_sync;
  assert.ok(firstHash);

  rows[0].status = "done";
  comments.again.push({
    id: "late",
    author_id: "user-hien",
    author_type: "member",
    content: "thêm",
    created_at: "2026-02-01T00:00:00Z",
  });
  assert.equal((await syncRun(box.deps)).code, 0);
  assert.notEqual(box.metadata.get("again").uniwork_sync, firstHash);
  assert.equal(box.tasks[0].status, "done");
  const adds = box.mcp.filter((call) => call[0] === "add_comment");
  assert.equal(adds.filter((call) => String(call[1].body).includes("uniai-assignee:")).length, 1);
  assert.equal(adds.filter((call) => String(call[1].body).includes("uniai-description-overflow")).length, 1);
  assert.equal(adds.filter((call) => String(call[1].body).includes("uniai-comment:late")).length, 1);
});

test("a partial update note fails the issue and does not write the hash", async () => {
  const box = world([issue({ id: "part", identifier: "UNI-46", title: "Dở" })]);
  assert.equal((await syncRun(box.deps)).code, 0);
  const firstHash = box.metadata.get("part").uniwork_sync;
  box.deps.uniai.listIssues = async () => [
    issue({ id: "part", identifier: "UNI-46", title: "Dở", status: "done", metadata: { uniwork_task: "task-1" } }),
  ];
  box.deps.uniwork.updateTask = async (args) => ({ id: args.task_id, note: "parent_task_id failed" });
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join("\n"), /partial part: parent_task_id failed/);
  assert.equal(box.metadata.get("part").uniwork_sync, firstHash);
});

test("a partial create note keeps the task id but not the hash", async () => {
  const box = world([issue({ id: "made", identifier: "UNI-47", title: "Mới" })]);
  const create = box.deps.uniwork.createTask;
  box.deps.uniwork.createTask = async (args) => ({ ...(await create(args)), note: "labels failed" });
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.equal(box.metadata.get("made").uniwork_task, "task-1");
  assert.equal(box.metadata.get("made").uniwork_sync, undefined);
});

test("a comment list failure skips that issue and the run continues", async () => {
  const box = world([
    issue({ id: "bad", identifier: "UNI-48", title: "Hỏng" }),
    issue({ id: "ok", identifier: "UNI-49", title: "Tốt" }),
  ]);
  box.deps.uniai.listComments = async (id) => {
    if (id === "bad") throw new Error("boom");
    return [];
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join("\n"), /error bad: boom/);
  assert.equal(box.tasks.length, 1);
  assert.equal(box.tasks[0].title, "UNI-49: Tốt");
  assert.equal(box.metadata.has("bad"), false);
});

test("401 while listing comments stops the run with no metadata writes", async () => {
  const box = world([
    issue({ id: "one", identifier: "UNI-50", title: "Một" }),
    issue({ id: "two", identifier: "UNI-51", title: "Hai" }),
  ]);
  box.deps.uniai.listComments = async () => {
    throw Object.assign(new Error("unauthorized"), { code: "unauthorized" });
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join("\n"), /unauthorized/);
  assert.equal(box.metadata.size, 0);
  assert.equal(box.tasks.length, 0);
});

test("a listIssues failure returns code 1 with a reason", async () => {
  const box = world([]);
  box.deps.uniai.listIssues = async () => {
    throw new Error("uniai down");
  };
  const result = await syncRun(box.deps);
  assert.equal(result.code, 1);
  assert.match(result.lines.join("\n"), /uniai down/);
});

for (const status of [403, 404]) {
  test(`startup REST ${status} stops the run and names the status`, async () => {
    const box = world([issue({ id: "x", identifier: "UNI-52" })]);
    let listed = 0;
    box.deps.uniai.listIssues = async () => {
      listed += 1;
      return [];
    };
    box.deps.uniwork.listLabels = async () => {
      throw Object.assign(new Error(`HTTP ${status} nope`), { status });
    };
    const result = await syncRun(box.deps);
    assert.equal(result.code, 1);
    assert.match(result.lines.join("\n"), new RegExp(`HTTP ${status}`));
    assert.equal(listed, 0);
    assert.equal(box.metadata.size, 0);
  });
}

test("an empty project with a 200 answer is a clean run", async () => {
  const box = world([]);
  const result = await syncRun(box.deps);
  assert.equal(result.code, 0);
});

function mcpHarness(replies) {
  const clock = { at: 0 };
  const sleeps = [];
  const seen = [];
  const queue = [...replies];
  const env = {
    now: () => clock.at,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.at += ms;
    },
    fetch: async (url, init) => {
      seen.push({ url, init });
      const text = queue.length > 1 ? queue.shift() : queue[0];
      return { ok: true, status: 200, text: async () => text };
    },
  };
  const config = { origin: "https://uniwork.example", workspaceId: "ws", mcpToken: "uwm_at_x", sessionToken: "s" };
  return { uniwork: makeUniwork(config, env), clock, sleeps, seen };
}

function toolReply(payload, isError = false) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }], isError } });
}

test("MCP calls accept both JSON and event-stream", async () => {
  const h = mcpHarness([toolReply({ item: { id: "t1" } })]);
  await h.uniwork.createTask({ title: "x" });
  const accept = h.seen[0].init.headers.Accept;
  assert.ok(accept.includes("application/json"));
  assert.ok(accept.includes("text/event-stream"));
});

test("create_task and update_task thread the note out", async () => {
  const h = mcpHarness([
    toolReply({ item: { id: "t1" }, note: "labels failed" }),
    toolReply({ item: { id: "t1" } }),
  ]);
  assert.deepEqual(await h.uniwork.createTask({ title: "x" }), { id: "t1", note: "labels failed" });
  assert.deepEqual(await h.uniwork.updateTask({ task_id: "t1" }), { id: "t1", note: "" });
});

test("write_rate_limited waits and retries the same call", async () => {
  const h = mcpHarness([
    toolReply("write_rate_limited: slow down", true),
    toolReply({ item: { id: "c1" } }),
  ]);
  const row = await h.uniwork.addComment({ task_id: "t", body: "b" });
  assert.equal(row.id, "c1");
  assert.equal(h.seen.length, 2);
  assert.equal(h.seen[0].init.body, h.seen[1].init.body);
  assert.deepEqual(h.sleeps, [60_000]);
});

test("a stuck write limiter fails the call after a few waits", async () => {
  const h = mcpHarness([toolReply("write_rate_limited: slow down", true)]);
  await assert.rejects(h.uniwork.addComment({ task_id: "t", body: "b" }), /write_rate_limited/);
  assert.equal(h.seen.length, 4);
  assert.equal(h.sleeps.filter((ms) => ms === 60_000).length, 3);
});

test("writes stay at 25 per minute and all calls at 100", async () => {
  const stamps = [];
  const h = mcpHarness([toolReply({ item: { id: "c" } })]);
  const base = h.seen;
  for (let i = 0; i < 60; i += 1) {
    await h.uniwork.addComment({ task_id: "t", body: String(i) });
    stamps.push(h.clock.at);
  }
  assert.equal(base.length, 60);
  for (let i = 25; i < stamps.length; i += 1) assert.ok(stamps[i] - stamps[i - 25] >= 60_000);

  const reads = mcpHarness([toolReply({ task: { id: "t" } })]);
  const readStamps = [];
  for (let i = 0; i < 230; i += 1) {
    await reads.uniwork.getTask("t");
    readStamps.push(reads.clock.at);
  }
  for (let i = 100; i < readStamps.length; i += 1) assert.ok(readStamps[i] - readStamps[i - 100] >= 60_000);
});

function timeoutError(stderr = "Request timed out: the server did not respond in time.") {
  return Object.assign(new Error(`Command failed: uniai issue comment list\n${stderr}`), {
    stderr: Buffer.from(stderr),
  });
}

test("boundedUniaiTimeout caps a long wait and keeps a short one", () => {
  assert.equal(boundedUniaiTimeout(""), null);
  assert.equal(boundedUniaiTimeout("1000"), "60s");
  assert.equal(boundedUniaiTimeout("2m"), "60s");
  assert.equal(boundedUniaiTimeout("45"), "45s");
  assert.equal(boundedUniaiTimeout("30s"), "30s");
  assert.equal(boundedUniaiTimeout("not-a-duration"), "not-a-duration");
});

test("isUniaiTimeout reads the CLI timeout text from stderr", () => {
  assert.equal(isUniaiTimeout(timeoutError()), true);
  assert.equal(isUniaiTimeout(new Error("unauthorized")), false);
});

test("a timed out uniai call is retried and then kept", async () => {
  let calls = 0;
  const pauses = [];
  const value = await withUniaiRetries(async () => {
    calls += 1;
    if (calls < 3) throw timeoutError();
    return "ok";
  }, { pause: async (attempt) => pauses.push(attempt) });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [1, 2]);
});

test("a non-timeout uniai failure is not retried", async () => {
  let calls = 0;
  await assert.rejects(withUniaiRetries(async () => {
    calls += 1;
    throw new Error("unauthorized");
  }), /unauthorized/);
  assert.equal(calls, 1);
});

test("three timeouts surface the last CLI error", async () => {
  let calls = 0;
  await assert.rejects(withUniaiRetries(async () => {
    calls += 1;
    throw timeoutError();
  }), /Request timed out/);
  assert.equal(calls, 3);
});
