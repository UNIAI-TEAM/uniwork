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

/** Rows of `server/internal/outbox/catalogue.go`, the machine source of truth. */
function goCatalogue() {
  const src = read("server/internal/outbox/catalogue.go");
  const rowPattern =
    /\{Topic: "([^"]+)", Version: (\d+), Payload: \[\]string\{([^}]*)\}, Scope: Scope(\w+), Delivery: Delivery(\w+)\},/g;
  const rows = [];
  for (const m of src.matchAll(rowPattern)) {
    const [, topic, version, payload, scope, delivery] = m;
    rows.push({
      topic,
      version: Number(version),
      payload: [...payload.matchAll(/"([^"]+)"/g)].map((p) => p[1]),
      scope: SCOPES[scope],
      delivery: delivery.toLowerCase(),
    });
  }
  return rows.sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Rows of the table in `docs/events/CATALOGUE.md`. */
function docCatalogue() {
  const lines = read("docs/events/CATALOGUE.md").split("\n");
  return lines
    .filter((l) => l.startsWith("| `"))
    .map((l) => {
      const cells = l.split("|").map((c) => c.trim());
      return {
        topic: cells[1].replaceAll("`", ""),
        version: Number(cells[2]),
        payload: cells[3] === "—" ? [] : cells[3].split(",").map((k) => k.trim().replaceAll("`", "")),
        scope: cells[4],
        delivery: cells[5],
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
  for (const { topic, payload, scope } of goCatalogue()) {
    assert.match(topic, /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/, `${topic} is not <entity>.<verb>`);
    assert.doesNotMatch(topic, /\.v\d+$/, `${topic} carries a version in its name; use the event_version column`);
    // Payload keys are ids, for events a client can receive. A key that is not
    // an id is content, and content in an event is a field somebody was not
    // supposed to see. Infrastructure topics are exempt: provider.* addresses a
    // conference room by the provider's own name for it, which is not our id.
    if (scope === "-") continue;
    for (const key of payload) {
      assert.match(
        key,
        /(_id|^version$)$/,
        `${topic} carries payload key "${key}"; payloads are ids only, consumers refetch`,
      );
    }
  }
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
