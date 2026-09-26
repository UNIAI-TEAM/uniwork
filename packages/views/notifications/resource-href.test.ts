import { describe, expect, it } from "vitest";
import type { Notification, Workspace } from "@uniwork/core/types";
import { resourceHref } from "./resource-href";

const workspace = { slug: "team", organization_slug: "acme" } as Workspace;
const base = {
  id: "n1", kind: "chat_follow_up", workspace_id: "ws1", organization_id: "o1", resource_deleted: false,
  actor_kind: "human", actor_id: "u2", title_key: "", params: {}, count: 1, created_at: "",
};

describe("resourceHref", () => {
  it("opens a chat message in its room, scrolled to it", () => {
    const n = { ...base, resource_type: "chat_message", resource_id: "m1", resource_parent_id: "r1" } as Notification;
    expect(resourceHref(n, workspace)).toBe("/acme/team/chat?room=r1&message=m1");
  });

  it("falls back to Chat when the room is unknown", () => {
    const n = { ...base, resource_type: "chat_message", resource_id: "m1" } as Notification;
    expect(resourceHref(n, workspace)).toBe("/acme/team/chat");
  });
});
