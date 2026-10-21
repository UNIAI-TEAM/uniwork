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
import { syncRun } from "./sync.mjs";

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
