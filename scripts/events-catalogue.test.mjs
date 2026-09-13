import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// The event catalogue exists three times: as prose for people, as a Go table
// the dispatcher routes with, and as a TypeScript list the client switches on.
// Three copies is a deliberate cost — each reader gets the form it can use —
// and it is only affordable because drift fails here rather than in production,
// where it looks like a screen that quietly stops updating.

const SCOPES = {
  Workspace: "workspace",
  Organization: "organization",
  User: "user",
  Chat: "chat",
  Room: "room",
  None: "-",
};

const quoted = (list) => [...(list ?? "").matchAll(/"([^"]+)"/g)].map((p) => p[1]);

/** Rows of `server/internal/outbox/catalogue.go`, the machine source of truth. */
function goCatalogue() {
  const src = read("server/internal/outbox/catalogue.go");
  const rowPattern =
    /\{Topic: "([^"]+)", Version: (\d+), Payload: \[\]string\{([^}]*)\}(?:, Patch: \[\]string\{([^}]*)\})?, Scope: Scope(\w+), Delivery: Delivery(\w+)\},/g;
  const rows = [];
  for (const m of src.matchAll(rowPattern)) {
    const [, topic, version, payload, patch, scope, delivery] = m;
    rows.push({
      topic,
      version: Number(version),
      payload: quoted(payload),
      patch: quoted(patch),
      scope: SCOPES[scope],
      delivery: delivery.toLowerCase(),
    });
  }
  return rows.sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Rows of the table in `docs/events/CATALOGUE.md`. */
function docCatalogue() {
  const lines = read("docs/events/CATALOGUE.md").split("\n");
  const keys = (cell) => (cell === "—" ? [] : cell.split(",").map((k) => k.trim().replaceAll("`", "")));
  return lines
    .filter((l) => l.startsWith("| `"))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return {
        topic: cells[1].replaceAll("`", ""),
        version: Number(cells[2]),
        payload: keys(cells[3]),
        patch: keys(cells[4]),
        scope: cells[5],
        delivery: cells[6],
      };
    })
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Topic names in `packages/core/types/events.ts`. */
function clientTopics() {
  const src = read("packages/core/types/events.ts");
  const block = src.split("export const WS_EVENT_TYPES = [")[1].split("] as const;")[0];
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

test("the Go catalogue and the documented table agree", () => {
  assert.deepEqual(
    docCatalogue(),
    goCatalogue(),
    "docs/events/CATALOGUE.md and server/internal/outbox/catalogue.go disagree",
  );
});

test("every catalogue row has the one-line shape this file parses", () => {
  // goCatalogue() reads rows with a one-line regex, so a row in any other shape
  // (fields reordered, gofmt's multi-line form) would be invisible to every rule
  // in this file. Each row has exactly one Topic key: count them outside
  // comments, so neither a comment quoting a row nor a commented-out row that
  // the regex still matches can balance a row the parser missed.
  const code = read("server/internal/outbox/catalogue.go").replace(/\/\/.*$/gm, "");
  assert.equal(
    goCatalogue().length,
    (code.match(/\bTopic:/g) ?? []).length,
    "a row in server/internal/outbox/catalogue.go is not in the one-line shape goCatalogue() parses",
  );
});

test("the client knows every event that has a realtime audience", () => {
  // Events with no scope (provider.*, webhook.deliver) are infrastructure: they
  // belong to the catalogue because they share the outbox, but nothing on the
  // client listens for them, so the client list would only grow noise.
  const expected = goCatalogue()
    .filter((r) => r.scope !== "-")
    .map((r) => r.topic)
    .sort();
  assert.deepEqual(
    clientTopics(),
    expected,
    "packages/core/types/events.ts does not match the catalogue's client-visible events",
  );
});

test("event names follow <entity>.<verb> and carry no version", () => {
  for (const { topic } of goCatalogue()) {
    assert.match(topic, /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, `${topic} is not <entity>.<verb>`);
    assert.doesNotMatch(topic, /\.v\d+$/, `${topic} carries a version in its name; use the event_version column`);
  }
});

const REVISION_KEYS = new Set(["revision", "revision_before"]);

test("payload keys are ids or revisions; content travels only through Patch", () => {
  // A payload key that is not an id is content, and content in an event is a
  // field somebody may not be allowed to see. ADR 0015 lets exactly one row
  // carry content, and only the fields it names in Patch: task.updated, whose
  // readers are every member of the workspace it fans out to. Patch is checked
  // before the infrastructure exemption below, so no row — scoped or not — can
  // open a second content channel without failing here. The revision pair
  // exists only to guard a patch, so a row without Patch may not carry it.
  for (const { topic, payload, patch, scope } of goCatalogue()) {
    if (patch.length > 0) {
      assert.equal(topic, "task.updated", `${topic} declares Patch; only task.updated may (ADR 0015)`);
      assert.ok(
        payload.includes("revision_before") && payload.includes("revision"),
        `${topic} declares Patch without revision_before and revision`,
      );
    }
    // Infrastructure topics are exempt from the id rule: provider.* addresses a
    // conference room by the provider's own name for it, which is not our id.
    if (scope === "-") continue;
    for (const key of payload) {
      if (REVISION_KEYS.has(key)) {
        assert.ok(
          patch.length > 0,
          `${topic} carries payload key "${key}" without Patch; the revision pair only guards a patch (ADR 0015)`,
        );
        continue;
      }
      assert.match(key, /(_id|^version$)$/, `${topic} carries payload key "${key}"; payloads are ids (ADR 0015)`);
    }
  }
});

test("the patchable task fields are exactly the ones ADR 0015 accepted", () => {
  const row = goCatalogue().find((r) => r.topic === "task.updated");
  assert.ok(row, "task.updated is missing from server/internal/outbox/catalogue.go");
  assert.deepEqual([...row.patch].sort(), ["due_date", "priority", "status", "title"]);
});

test("every event has a scope or is explicitly infrastructure", () => {
  for (const { topic, scope, delivery } of goCatalogue()) {
    assert.ok(
      ["workspace", "organization", "user", "chat", "room", "-"].includes(scope),
      `${topic} has an unknown scope "${scope}"`,
    );
    assert.ok(["outbox", "ephemeral"].includes(delivery), `${topic} has an unknown delivery "${delivery}"`);
    if (scope === "-") {
      assert.equal(delivery, "outbox", `${topic} has no audience, so ephemeral delivery would drop it entirely`);
    }
  }
});
