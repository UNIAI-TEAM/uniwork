import { ChatRoomSchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { channelDirectory } from "./channel-directory";

const channel = (id: string, name: string, extra: Record<string, unknown> = {}): ChatRoomRecord =>
  ChatRoomSchema.parse({ id, workspace_id: "w1", kind: "channel", name, member_count: 0, ...extra });

describe("channelDirectory", () => {
  it("lists the joinable channels and the public ones already joined, once each, A–Z", () => {
    const discoverable = [channel("c2", "thiết kế"), channel("c1", "dev")];
    const mine = [
      channel("c1", "dev"),
      channel("c3", "bán hàng"),
      channel("c4", "riêng", { visibility: "private" }),
      channel("c5", "chung", { is_default: true }),
      ChatRoomSchema.parse({ id: "g1", workspace_id: "w1", kind: "group", name: "nhóm", member_count: 0 }),
    ];
    expect(channelDirectory(discoverable, mine, "").map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
  });

  it("finds a channel by its name or its topic, without the marks", () => {
    const list = [channel("c1", "dev", { topic: "Thảo luận kỹ thuật" }), channel("c2", "thiết kế")];
    expect(channelDirectory(list, [], "thiet").map((c) => c.id)).toEqual(["c2"]);
    expect(channelDirectory(list, [], "ky thuat").map((c) => c.id)).toEqual(["c1"]);
  });
});
