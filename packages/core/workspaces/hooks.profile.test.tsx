import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/endpoints/workspaces")>();
  return { ...actual, patchWorkspace: vi.fn(), uploadWorkspaceIcon: vi.fn(), removeWorkspaceIcon: vi.fn() };
});

import * as workspaces from "../api/endpoints/workspaces";
import type { Workspace } from "../types";
import { usePatchWorkspace, useRemoveWorkspaceIcon, useUploadWorkspaceIcon } from "./hooks";
import { workspaceKeys } from "./keys";

function setup<T>(hook: () => T) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(hook, {
    wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
  });
  return { result, invalidate, qc };
}

function expectWorkspaceRefreshed(invalidate: { mock: { calls: unknown[][] } }) {
  expect(invalidate.mock.calls).toContainEqual([{ queryKey: workspaceKeys.list() }]);
  expect(invalidate.mock.calls).toContainEqual([{ queryKey: workspaceKeys.bySlugs("acme", "team") }]);
}

describe("workspace profile mutations", () => {
  beforeEach(() => {
    vi.mocked(workspaces.patchWorkspace).mockReset().mockResolvedValue(null);
    vi.mocked(workspaces.uploadWorkspaceIcon).mockReset().mockResolvedValue(null);
    vi.mocked(workspaces.removeWorkspaceIcon).mockReset().mockResolvedValue(null);
  });

  it("patches any profile field and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => usePatchWorkspace("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1", description: "Mô tả" });
    expect(workspaces.patchWorkspace).toHaveBeenCalledWith("ws1", { description: "Mô tả" });
    expectWorkspaceRefreshed(invalidate);
  });

  it("seeds the new slug's workspace so the redirect does not flash a loader", async () => {
    const renamed = { id: "ws1", organization_slug: "acme", slug: "growth", name: "Team" } as Workspace;
    vi.mocked(workspaces.patchWorkspace).mockResolvedValue(renamed);
    const { result, qc } = setup(() => usePatchWorkspace("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1", slug: "growth" });
    expect(qc.getQueryData(workspaceKeys.bySlugs("acme", "growth"))).toBe(renamed);
  });

  it("does not seed a by-slug entry when the slug was not sent", async () => {
    vi.mocked(workspaces.patchWorkspace).mockResolvedValue({ id: "ws1", organization_slug: "acme", slug: "team" } as Workspace);
    const { result, qc } = setup(() => usePatchWorkspace("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1", name: "Renamed" });
    expect(qc.getQueryData(workspaceKeys.bySlugs("acme", "team"))).toBeUndefined();
  });

  it("uploads the icon and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => useUploadWorkspaceIcon("acme", "team"));
    const file = new File(["x"], "i.png", { type: "image/png" });
    await result.current.mutateAsync({ wsId: "ws1", file });
    expect(workspaces.uploadWorkspaceIcon).toHaveBeenCalledWith("ws1", file);
    expectWorkspaceRefreshed(invalidate);
  });

  it("removes the icon and refreshes the workspace", async () => {
    const { result, invalidate } = setup(() => useRemoveWorkspaceIcon("acme", "team"));
    await result.current.mutateAsync({ wsId: "ws1" });
    expect(workspaces.removeWorkspaceIcon).toHaveBeenCalledWith("ws1");
    expectWorkspaceRefreshed(invalidate);
  });
});
