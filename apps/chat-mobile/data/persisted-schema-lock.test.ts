// What the device store keeps outlives the code that wrote it: an OTA can
// change the reader while the data stays. Each persisted thing has a version
// (the query cache's buster, each queue's zustand version) and a schema module
// that reads it back. This test pins the hash of each schema module to the
// version it was last reviewed at, so editing a reader is a decision about the
// version — bump it (with a migrate step for a queue) when a kept record now
// means something else — never an accident. Rewrite the lock after deciding:
//   UPDATE_PERSISTED_LOCK=1 pnpm --filter @uniwork/chat-mobile exec vitest run data/persisted-schema-lock.test.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CACHE_SCHEMA_VERSION } from "./persisted-cache";
import { useChatSendStore } from "./stores/chat-send-store";
import { useDraftStore } from "./stores/draft-store";
import { usePendingOpsStore } from "./stores/pending-ops-store";
import { useReportedMessagesStore } from "./stores/reported-messages-store";

const APP = path.resolve(__dirname, "..");
const LOCK = path.join(__dirname, "persisted-schema.lock.json");

const current: Record<string, { version: number | undefined; file: string }> = {
  "query-cache": { version: CACHE_SCHEMA_VERSION, file: "data/persisted-cache.ts" },
  "chat-send-outbox": { version: useChatSendStore.persist.getOptions().version, file: "lib/persisted-records.ts" },
  "chat-pending-ops": { version: usePendingOpsStore.persist.getOptions().version, file: "lib/persisted-records.ts" },
  "chat-drafts": { version: useDraftStore.persist.getOptions().version, file: "lib/drafts.ts" },
  "chat-reported-messages": { version: useReportedMessagesStore.persist.getOptions().version, file: "lib/reported-messages.ts" },
};

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(path.join(APP, file))).digest("hex");
const actual = Object.fromEntries(Object.entries(current).map(([name, { version, file }]) => [name, { version, file, sha256: sha(file) }]));

describe("persisted schema lock", () => {
  it("every persisted thing's reader is the one its version was reviewed at", () => {
    if (process.env.UPDATE_PERSISTED_LOCK) fs.writeFileSync(LOCK, `${JSON.stringify(actual, null, 2)}\n`);
    const locked: unknown = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    expect(
      actual,
      "A persisted reader changed. If a kept record now means something else, bump its version (CACHE_SCHEMA_VERSION, or the store's version plus a migrate step); then rewrite the lock (header of this file).",
    ).toEqual(locked);
  });
});
