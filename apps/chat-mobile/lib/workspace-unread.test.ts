import { describe, expect, it } from "vitest";
import { badgeText, unreadForTabBadge, unreadInOtherWorkspaces, unreadOfWorkspace, workspaceMetaKind } from "./workspace-unread";

const summary = {
  direct: { unread: 2, mentions: 1 },
  workspaces: [
    { workspace_id: "a", unread: 6, mentions: 0 },
    { workspace_id: "b", unread: 7, mentions: 2 },
    { workspace_id: "c", unread: 0, mentions: 0 },
  ],
};

describe("workspace-unread", () => {
  it("reads one workspace's counts, zero without a row", () => {
    expect(unreadOfWorkspace(summary, "b")).toEqual({ unread: 7, mentions: 2 });
    expect(unreadOfWorkspace(summary, "zzz")).toEqual({ unread: 0, mentions: 0 });
    expect(unreadOfWorkspace(undefined, "a")).toEqual({ unread: 0, mentions: 0 });
  });

  it("counts the other workspaces for the pill and the open one plus direct for the tab", () => {
    expect(unreadInOtherWorkspaces(summary, "a")).toBe(7);
    expect(unreadInOtherWorkspaces(undefined, "a")).toBe(0);
    expect(unreadForTabBadge(summary, "a")).toBe(8);
    expect(unreadForTabBadge(summary, "c")).toBe(2);
  });

  it("picks the row's meta line", () => {
    expect(workspaceMetaKind({ unread: 6, mentions: 0 }, true)).toBe("open_unread");
    expect(workspaceMetaKind({ unread: 0, mentions: 0 }, true)).toBe("open");
    expect(workspaceMetaKind({ unread: 7, mentions: 2 }, false)).toBe("unread_mentions");
    expect(workspaceMetaKind({ unread: 4, mentions: 0 }, false)).toBe("unread");
    expect(workspaceMetaKind({ unread: 0, mentions: 0 }, false)).toBe("none");
  });

  it("caps a badge at 99+ and hides zero", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(120)).toBe("99+");
  });
});
