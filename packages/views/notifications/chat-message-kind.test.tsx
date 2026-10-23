import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { NOTIFICATION_KINDS, type Notification, type Workspace } from "@uniwork/core/types";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";
import { NotificationTitle } from "./notification-title";
import { resourceHref } from "./resource-href";

// UNI-2141: a plain message in a group, channel or workspace room notifies every other member, one
// row per room while unread, as `chat_message`. It reads as a chat row, sits under updates (nobody
// asked anything of the person), and opens the room at the newest message.

initI18n();

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const roomMessage: Notification = {
  id: "n1", kind: "chat_message", workspace_id: "ws1", organization_id: "o1", resource_type: "chat_message",
  resource_id: "m2", resource_parent_id: "r1", resource_deleted: false, resource_access_lost: false, comment_deleted: false,
  actor_kind: "human", actor_id: "u2", title_key: "notifications.kind.chat_message", count: 2,
  created_at: "2026-10-23T03:00:00Z", params: { actor: "Minh", room: "ca-nha" },
};

const sentence = (n: Notification) => {
  const { container, unmount } = render(<NotificationTitle notification={n} unread={false} />);
  const text = container.textContent ?? "";
  unmount();
  return text;
};

beforeEach(async () => {
  await setLocale("vi");
});
afterEach(async () => {
  cleanup();
  await setLocale("vi");
});

describe("chat_message kind", () => {
  it("is a known chat kind under updates", () => {
    expect(NOTIFICATION_KINDS).toContain("chat_message");
    expect(kindIcon("chat_message")).toBe(MODULE_ICONS.chat);
    expect(kindTone("chat_message")).toEqual(moduleTone("chat"));
    expect(inboxCategory(roomMessage.kind)).toBe("updates");
  });

  it("names the sender and the room in both languages", async () => {
    expect(sentence(roomMessage)).toContain("Minh đã nhắn trong ca-nha");
    await setLocale("en");
    expect(sentence(roomMessage)).toContain("Minh sent a message in ca-nha");
  });

  it("opens the room at the newest message", () => {
    expect(resourceHref(roomMessage, workspace, [workspace])).toBe("/acme/team/chat?room=r1&message=m2");
  });
});
