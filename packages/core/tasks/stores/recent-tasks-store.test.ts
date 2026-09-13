import { act, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/endpoints/auth", () => ({
  refreshSession: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
}));

import { resetAuthStoreForTests, useAuthStore } from "../../auth/store";
import { CoreProvider } from "../../platform/core-provider";
import { defaultStorage } from "../../platform/storage";
import type { User } from "../../types/user";
import { useRecentTasks, useRecentTasksStore } from "./recent-tasks-store";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const STORAGE_KEY = "uniwork_recent_tasks";
const store = () => useRecentTasksStore.getState();
const visit = (id: string, title = `Task ${id}`) => ({ id, identifier: `TEAM-${id}`, title });
const ids = (workspaceId: string) => (store().byWorkspace[workspaceId] ?? []).map((entry) => entry.id);

beforeEach(() => {
  useRecentTasksStore.setState({ byWorkspace: {} });
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(user);
});

describe("recent tasks store", () => {
  it("ghi cùng một task hai lần giữ một mục, đưa nó lên đầu và cập nhật tiêu đề", () => {
    store().recordVisit("w1", visit("a"));
    store().recordVisit("w1", visit("b"));
    store().recordVisit("w1", visit("a", "Tiêu đề mới"));

    expect(ids("w1")).toEqual(["a", "b"]);
    expect(store().byWorkspace.w1?.[0]).toMatchObject({
      id: "a",
      identifier: "TEAM-a",
      title: "Tiêu đề mới",
    });
  });

  it("giữ tối đa 20 mục mỗi workspace, mục cũ nhất rơi ra", () => {
    for (let i = 0; i < 21; i += 1) store().recordVisit("w1", visit(`t${i}`));

    expect(ids("w1")).toHaveLength(20);
    expect(ids("w1")[0]).toBe("t20");
    expect(ids("w1")).not.toContain("t0");
  });

  it("giữ tối đa 50 workspace, workspace có lượt xem cũ nhất rơi ra", () => {
    for (let i = 0; i < 50; i += 1) store().recordVisit(`ws-${i}`, visit("a"));
    // Revisiting ws-0 makes it the newest, so ws-1 is now the oldest.
    store().recordVisit("ws-0", visit("b"));
    store().recordVisit("ws-new", visit("c"));

    const workspaces = Object.keys(store().byWorkspace);
    expect(workspaces).toHaveLength(50);
    expect(workspaces).not.toContain("ws-1");
    expect(workspaces).toContain("ws-0");
    expect(workspaces).toContain("ws-new");
  });

  it("forget gỡ đúng một task, và gỡ cả workspace khi không còn mục nào", () => {
    store().recordVisit("w1", visit("a"));
    store().recordVisit("w1", visit("b"));

    store().forget("w1", "a");
    expect(ids("w1")).toEqual(["b"]);

    const before = store().byWorkspace;
    store().forget("w1", "unknown");
    store().forget("w-none", "b");
    expect(store().byWorkspace).toBe(before);

    store().forget("w1", "b");
    expect(Object.keys(store().byWorkspace)).toEqual([]);
  });

  it("bỏ dữ liệu lưu hỏng khi nạp, không ném lỗi", () => {
    const { merge } = useRecentTasksStore.persist.getOptions();
    const current = store();

    expect(merge?.("not an object", current).byWorkspace).toEqual({});
    expect(merge?.({ byWorkspace: ["w1"] }, current).byWorkspace).toEqual({});

    const merged = merge?.(
      {
        byWorkspace: {
          notList: "a",
          empty: [],
          w1: [
            { id: "a", identifier: "TEAM-1", title: "A", visitedAt: 5 },
            { identifier: "TEAM-2", title: "no id", visitedAt: 4 },
            { id: "", identifier: "TEAM-3", title: "blank id", visitedAt: 3 },
            { id: "b", identifier: 7, title: "bad identifier", visitedAt: 2 },
            { id: "a", identifier: "TEAM-1", title: "duplicate", visitedAt: 1 },
            { id: "c", identifier: "TEAM-4", title: "C" },
            null,
          ],
        },
      },
      current,
    );

    expect(merged?.byWorkspace).toEqual({
      w1: [
        { id: "a", identifier: "TEAM-1", title: "A", visitedAt: 5 },
        { id: "c", identifier: "TEAM-4", title: "C", visitedAt: 0 },
      ],
    });
    expect(merged?.recordVisit).toBe(current.recordVisit);
  });

  it("đăng xuất xoá task gần đây khỏi bộ nhớ và khỏi storage", async () => {
    // Titles are task content: left behind, the next person to sign in on
    // this browser reads the previous person's task titles in the palette.
    render(createElement(CoreProvider, { children: createElement("div") }));
    store().recordVisit("w1", visit("a", "Kế hoạch sáp nhập"));
    store().recordVisit("w1", visit("b"));
    expect(defaultStorage.getItem(STORAGE_KEY)).toContain("Kế hoạch sáp nhập");

    await useAuthStore.getState().logout();

    expect(store().byWorkspace).toEqual({});
    expect(defaultStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("khi không còn phiên đăng nhập, recordVisit và forget không ghi gì", async () => {
    store().recordVisit("w1", visit("a"));
    // No CoreProvider here, so logout runs no cleanup: this pins the store's
    // own refusal.
    await useAuthStore.getState().logout();
    const persisted = defaultStorage.getItem(STORAGE_KEY);

    store().recordVisit("w1", visit("b", "Sau khi đăng xuất"));
    store().forget("w1", "a");

    expect(ids("w1")).toEqual(["a"]);
    expect(defaultStorage.getItem(STORAGE_KEY)).toBe(persisted);
  });
});

describe("useRecentTasks", () => {
  it("trả cùng tham chiếu giữa các lần render khi không đổi, kể cả workspace chưa có gì", () => {
    let renders = 0;
    const { result, rerender } = renderHook(() => {
      renders += 1;
      return useRecentTasks("w1");
    });
    const empty = result.current;
    rerender();
    expect(result.current).toBe(empty);
    expect(result.current).toEqual([]);

    act(() => store().recordVisit("w1", visit("a")));
    const recorded = result.current;
    rerender();
    expect(result.current).toBe(recorded);
    // Mount, rerender, store change, rerender. A selector that builds a fresh
    // array on each call would loop (or throw "getSnapshot should be cached").
    expect(renders).toBe(4);
  });

  it("lượt xem ở workspace khác không render lại người đọc của workspace này", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useRecentTasks("w1");
    });

    act(() => store().recordVisit("w2", visit("a")));

    expect(renders).toBe(1);
  });
});
