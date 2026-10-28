import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WSClient } from "../api/ws-client";
import type { WSMessage } from "../api/ws-types";
import { driveKeys } from "../drive/keys";
import { driveFrameKeys } from "./drive-events";
import { useRealtimeSync } from "./use-realtime-sync";

function fakeClient() {
  const anyHandlers = new Set<(msg: WSMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  const client = {
    onAny: (h: (msg: WSMessage) => void) => {
      anyHandlers.add(h);
      return () => anyHandlers.delete(h);
    },
    onReconnect: (h: () => void) => {
      reconnectHandlers.add(h);
      return () => reconnectHandlers.delete(h);
    },
    emit: (msg: { type: string; payload?: Record<string, string> }) =>
      anyHandlers.forEach((h) => h(msg as unknown as WSMessage)),
  };
  return client as unknown as WSClient & typeof client;
}

describe("driveFrameKeys and realtime invalidation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps every drive_file.* frame in the active workspace to driveKeys.workspace(wsId)", () => {
    for (const type of [
      "drive_file.linked",
      "drive_file.access_changed",
      "drive_file.task_linked",
      "drive_file.unlinked",
      "drive_file.updated",
    ]) {
      expect(driveFrameKeys("ws1", type, { workspace_id: "ws1", drive_file_id: "df1" })).toEqual([
        driveKeys.workspace("ws1"),
      ]);
      expect(driveFrameKeys("ws1", type, { workspace_id: "ws2", drive_file_id: "df1" })).toEqual([]);
    }
  });

  it("includes driveKeys.task(wsId, taskId) when drive_file.task_linked carries task_id", () => {
    expect(
      driveFrameKeys("ws1", "drive_file.task_linked", {
        workspace_id: "ws1",
        drive_file_id: "df1",
        task_id: "t1",
      }),
    ).toEqual([driveKeys.workspace("ws1"), driveKeys.task("ws1", "t1")]);
  });

  it("maps drive_connection.changed to connections and every cached driveKeys.workspace(*)", () => {
    expect(driveFrameKeys("ws1", "drive_connection.changed", { connection_id: "dc1", user_id: "u1" })).toEqual([
      driveKeys.connections("ws1"),
      driveKeys.all,
    ]);
  });

  it("maps drive_task_proposal.converted and task.deleted to driveKeys.workspace(wsId)", () => {
    expect(
      driveFrameKeys("ws1", "drive_task_proposal.converted", {
        workspace_id: "ws1",
        proposal_id: "p1",
      }),
    ).toEqual([driveKeys.workspace("ws1")]);
    expect(
      driveFrameKeys("ws1", "drive_task_proposal.converted", {
        workspace_id: "ws2",
        proposal_id: "p1",
      }),
    ).toEqual([]);

    expect(
      driveFrameKeys("ws1", "task.deleted", {
        workspace_id: "ws1",
        task_id: "t1",
      }),
    ).toEqual([driveKeys.workspace("ws1")]);
    expect(
      driveFrameKeys("ws1", "task.deleted", {
        workspace_id: "ws2",
        task_id: "t1",
      }),
    ).toEqual([]);
  });

  it("returns null for unrelated frames", () => {
    expect(driveFrameKeys("ws1", "task.updated", { task_id: "t1" })).toBeNull();
    expect(driveFrameKeys("ws1", "document.updated", { document_id: "d1" })).toBeNull();
  });

  it("invalidates connections and all cached driveKeys.workspace(*) via useRealtimeSync without writing payload data", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    qc.setQueryData(driveKeys.connections("ws1"), { connections: [] });
    qc.setQueryData(driveKeys.workspace("ws1"), { files: ["a"] });
    qc.setQueryData(driveKeys.workspace("ws2"), { files: ["b"] });

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const setQueryDataSpy = vi.spyOn(qc, "setQueryData");
    const client = fakeClient();

    renderHook(() => useRealtimeSync(client, "ws1"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });

    client.emit({
      type: "drive_connection.changed",
      payload: { connection_id: "dc1", user_id: "u1" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(qc.getQueryState(driveKeys.connections("ws1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(driveKeys.workspace("ws1"))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(driveKeys.workspace("ws2"))?.isInvalidated).toBe(true);
    expect(setQueryDataSpy).not.toHaveBeenCalled();

    invalidateSpy.mockClear();
    client.emit({
      type: "task.deleted",
      payload: { workspace_id: "ws1", task_id: "t1" },
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const calledKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(calledKeys).toContain(JSON.stringify(driveKeys.workspace("ws1")));
    expect(calledKeys).toContain(JSON.stringify(["tasks", "ws1"]));
  });

  it("invalidates task drive-files query keys for drive_file.task_linked, unlinked, updated, and access_changed", () => {
    vi.useFakeTimers();
    for (const type of [
      "drive_file.task_linked",
      "drive_file.unlinked",
      "drive_file.updated",
      "drive_file.access_changed",
    ]) {
      const qc = new QueryClient();
      qc.setQueryData(driveKeys.task("ws1", "t1"), [{ id: "df1" }]);
      const setQueryDataSpy = vi.spyOn(qc, "setQueryData");
      const client = fakeClient();

      renderHook(() => useRealtimeSync(client, "ws1"), {
        wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
      });

      client.emit({
        type,
        payload: { workspace_id: "ws1", drive_file_id: "df1", task_id: "t1", user_id: "u1" },
      });
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(qc.getQueryState(driveKeys.task("ws1", "t1"))?.isInvalidated).toBe(true);
      expect(setQueryDataSpy).not.toHaveBeenCalled();
    }
  });
});
