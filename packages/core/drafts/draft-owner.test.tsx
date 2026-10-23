import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn().mockResolvedValue(null),
  logout: vi.fn(),
}));

import * as auth from "../api/endpoints/auth";
import { setAccessToken } from "../api/session";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { CoreProvider } from "../platform/core-provider";
import { defaultStorage } from "../platform/storage";
import { useCommentDraftStore } from "../tasks/stores/comment-draft-store";
import { useRecentTasksStore } from "../tasks/stores/recent-tasks-store";
import type { User } from "../types/user";

const DRAFTS_KEY = "uniwork_task_comment_drafts";
const RECENT_KEY = "uniwork_recent_tasks";
const A_DRAFT = "nháp chưa gửi của A";
const A_TITLE = "Kế hoạch sáp nhập của A";

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    display_name: id,
    onboarded_at: null,
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  };
}

const userA = makeUser("user-a");
const userB = makeUser("user-b");

interface Stores {
  useAuthStore: typeof useAuthStore;
  useCommentDraftStore: typeof useCommentDraftStore;
  useRecentTasksStore: typeof useRecentTasksStore;
}

const live: Stores = { useAuthStore, useCommentDraftStore, useRecentTasksStore };

/** Where both the login form and a successful refresh end up. */
function signIn(user: User) {
  setAccessToken(`token-${user.id}`);
  useAuthStore.getState().setUser(user);
}

/**
 * What a refresh the transport could not complete does: it clears the token
 * and nothing else. No logout request, no logout callback, no cleanup.
 */
function expireSession() {
  setAccessToken(null);
}

function writeTaskContent(stores: Stores) {
  stores.useCommentDraftStore.getState().setDraft("task-1", A_DRAFT);
  stores.useRecentTasksStore
    .getState()
    .recordVisit("w1", { id: "task-1", identifier: "TEAM-1", title: A_TITLE });
}

function expectTaskContentGone(stores: Stores) {
  expect(stores.useCommentDraftStore.getState().draftFor("task-1")).toBe("");
  expect(stores.useRecentTasksStore.getState().byWorkspace).toEqual({});
  expect(defaultStorage.getItem(DRAFTS_KEY) ?? "").not.toContain(A_DRAFT);
  expect(defaultStorage.getItem(RECENT_KEY) ?? "").not.toContain(A_TITLE);
}

function expectTaskContentKept(stores: Stores) {
  expect(stores.useCommentDraftStore.getState().draftFor("task-1")).toBe(A_DRAFT);
  expect(stores.useRecentTasksStore.getState().byWorkspace.w1?.map((entry) => entry.title)).toEqual([
    A_TITLE,
  ]);
  expect(defaultStorage.getItem(DRAFTS_KEY)).toContain(A_DRAFT);
  expect(defaultStorage.getItem(RECENT_KEY)).toContain(A_TITLE);
}

/** Mount the provider the web app mounts, and let its session check settle. */
async function mountApp() {
  render(
    <CoreProvider>
      <div />
    </CoreProvider>,
  );
  await vi.waitFor(() => expect(useAuthStore.getState().status).toBe("anon"));
}

/**
 * A page reload: every module is evaluated again over the same localStorage,
 * so the stores hydrate while the session is still loading.
 */
async function reloadPage() {
  vi.resetModules();
  const freshAuth = await import("../api/endpoints/auth");
  const stores: Stores = {
    useAuthStore: (await import("../auth/store")).useAuthStore,
    useCommentDraftStore: (await import("../tasks/stores/comment-draft-store")).useCommentDraftStore,
    useRecentTasksStore: (await import("../tasks/stores/recent-tasks-store")).useRecentTasksStore,
  };
  return { stores, refreshSession: vi.mocked(freshAuth.refreshSession) };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setAccessToken(null);
  vi.mocked(auth.logout).mockClear();
  useCommentDraftStore.setState(useCommentDraftStore.getInitialState());
  useRecentTasksStore.setState(useRecentTasksStore.getInitialState());
  // After the resets: a reset writes the empty state back through `persist`.
  defaultStorage.removeItem(DRAFTS_KEY);
  defaultStorage.removeItem(RECENT_KEY);
});

describe("dữ liệu bền của nháp và task gần đây khi phiên hết hạn mà không đăng xuất", () => {
  it("phiên của A hết hạn rồi B đăng nhập: nháp và task gần đây của A mất khỏi bộ nhớ lẫn storage", async () => {
    await mountApp();
    signIn(userA);
    writeTaskContent(live);

    expireSession();
    expect(useAuthStore.getState().status).toBe("anon");
    expect(auth.logout).not.toHaveBeenCalled();
    // Expiry alone clears nothing: the same person may be back in a moment.
    expectTaskContentKept(live);

    signIn(userB);

    expectTaskContentGone(live);
  });

  it("phiên của A hết hạn rồi A đăng nhập lại: nháp và task gần đây vẫn còn", async () => {
    await mountApp();
    signIn(userA);
    writeTaskContent(live);

    expireSession();
    signIn(userA);

    expectTaskContentKept(live);
  });

  it("B đăng nhập rồi ghi nháp của mình: nháp đó được lưu và không bị xoá khi B đăng nhập lại", async () => {
    await mountApp();
    signIn(userA);
    writeTaskContent(live);
    expireSession();
    signIn(userB);

    useCommentDraftStore.getState().setDraft("task-2", "nháp của B");
    expireSession();
    signIn(userB);

    expect(useCommentDraftStore.getState().drafts).toEqual({ "task-2": "nháp của B" });
    expect(defaultStorage.getItem(DRAFTS_KEY)).toContain("nháp của B");
  });
});

describe("dữ liệu bền của nháp và task gần đây sau khi tải lại trang", () => {
  it("storage còn dữ liệu của A, cookie đăng nhập là của B: không hiện dữ liệu của A", async () => {
    signIn(userA);
    writeTaskContent(live);

    const page = await reloadPage();
    // Hydrated while the session is still loading, before anything renders it.
    expect(page.stores.useAuthStore.getState().status).toBe("loading");
    expect(page.stores.useCommentDraftStore.getState().draftFor("task-1")).toBe(A_DRAFT);

    page.refreshSession.mockResolvedValueOnce({ user: userB, access_token: "token-b" });
    await page.stores.useAuthStore.getState().initialize();

    expect(page.stores.useAuthStore.getState().user?.id).toBe("user-b");
    expectTaskContentGone(page.stores);
  });

  it("storage còn dữ liệu của A, cookie đăng nhập vẫn là của A: dữ liệu còn nguyên", async () => {
    signIn(userA);
    writeTaskContent(live);

    const page = await reloadPage();
    page.refreshSession.mockResolvedValueOnce({ user: userA, access_token: "token-a" });
    await page.stores.useAuthStore.getState().initialize();

    expectTaskContentKept(page.stores);
  });

  // The shape both stores wrote before they recorded who wrote it. Whose it
  // is cannot be known, so nobody gets it.
  it("dữ liệu lưu không ghi người sở hữu thì không hiện cho người đăng nhập nào", async () => {
    defaultStorage.setItem(
      DRAFTS_KEY,
      JSON.stringify({ state: { drafts: { "task-1": A_DRAFT } }, version: 0 }),
    );
    defaultStorage.setItem(
      RECENT_KEY,
      JSON.stringify({
        state: {
          byWorkspace: { w1: [{ id: "task-1", identifier: "TEAM-1", title: A_TITLE, visitedAt: 1 }] },
        },
        version: 0,
      }),
    );

    const page = await reloadPage();
    page.refreshSession.mockResolvedValueOnce({ user: userA, access_token: "token-a" });
    await page.stores.useAuthStore.getState().initialize();

    expectTaskContentGone(page.stores);
  });
});
