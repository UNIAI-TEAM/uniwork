import { describe, expect, it } from "vitest";
import type { WSEventType } from "../types/events";
import { sourcesWaveFor } from "./source-events";

describe("sourcesWaveFor", () => {
  it.each([
    ["attachment.uploaded", { workspace_id: "ws1", task_id: "t1" }, "now"],
    ["attachment.deleted", { task_id: "t1" }, "now"],
    ["recording.ready", { meeting_id: "m1" }, "now"],
    ["chat.message.created", { room_id: "r1", message_id: "m1" }, "slow"],
    ["chat.message.deleted", { room_id: "r1", message_id: "m1" }, "slow"],
    ["email_hub.new_mail", { account_id: "a1" }, "slow"],
  ] as const)("%s marks the sources list stale (%s)", (type, payload, wave) => {
    expect(sourcesWaveFor("ws1", type as WSEventType, { ...payload })).toBe(wave);
  });

  it("ignores a task attachment frame stamped for another workspace", () => {
    expect(sourcesWaveFor("ws1", "attachment.uploaded", { workspace_id: "ws2" })).toBeNull();
  });

  it("ignores new mail stamped for another workspace, keeps one for this one", () => {
    expect(sourcesWaveFor("ws1", "email_hub.new_mail", { account_id: "a1", workspace_id: "ws2" })).toBeNull();
    expect(sourcesWaveFor("ws1", "email_hub.new_mail", { account_id: "a1", workspace_id: "ws1" })).toBe("slow");
  });

  it.each(["chat.message.updated", "chat.typing", "recording.started", "document.updated", "task.updated"] as const)(
    "leaves %s alone",
    (type) => {
      expect(sourcesWaveFor("ws1", type, {})).toBeNull();
    },
  );
});
