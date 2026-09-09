import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigateInternal } from "./navigate-internal";
import type { NavigationAdapter } from "./types";

describe("navigateInternal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes through the adapter and no-ops without one", () => {
    const push = vi.fn();
    navigateInternal({ push } as unknown as NavigationAdapter, "/a");
    expect(push).toHaveBeenCalledWith("/a");
    expect(() => navigateInternal(null, "/a")).not.toThrow();
  });

  it("opens a shareable URL for tab intents", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    navigateInternal(
      {
        getShareableUrl: (path: string) => `https://app.test${path}`,
      } as NavigationAdapter,
      "/tasks",
      "background-tab",
    );
    expect(open).toHaveBeenCalledWith(
      "https://app.test/tasks",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("falls back to the path when there is no adapter", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    navigateInternal(undefined, "/tasks", "foreground-tab");
    expect(open).toHaveBeenCalledWith("/tasks", "_blank", "noopener,noreferrer");
  });
});
