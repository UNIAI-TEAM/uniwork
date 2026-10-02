import { expect, it, vi } from "vitest";
import { createPreloadBridge, exposePreloadBridge } from "./index";

it("allowlists tab updates and accepts opaque local ids for native Save", async () => {
  const invoke = vi.fn().mockResolvedValue({ updated: true });
  let event: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke, on: (channel, listener) => { if (channel === "desktop:office-save-requested") event = listener; } });
  const documentId = `file_${"a".repeat(150)}`;
  const payload = { sessionGeneration: "session_1234", documentIds: [documentId], activeDocumentId: documentId };
  await expect(bridge.call("desktop:tabs-update", payload)).resolves.toEqual({ updated: true });
  expect(invoke).toHaveBeenCalledWith("desktop:tabs-update", payload);
  const received = vi.fn();
  bridge.onOfficeSaveRequested(received);
  event?.({}, { documentId });
  expect(received).toHaveBeenCalledWith({ documentId });
  event?.({}, { documentId: "/secret" });
  event?.({}, { documentId, path: "/secret" });
  expect(received).toHaveBeenCalledOnce();
});

it("exposes only the typed bridge and forwards an allowlisted call", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true });
  const bridge = createPreloadBridge({ invoke });
  await expect(bridge.call("desktop:bootstrap", { sessionGeneration: "session_1234" })).resolves.toEqual({ ok: true });
  expect(invoke).toHaveBeenCalledWith("desktop:bootstrap", { sessionGeneration: "session_1234" });
  await expect(bridge.call("desktop:unknown" as never, {} as never)).rejects.toThrow(/allowlisted/);
});

it("uses context isolation's explicit main-world name", () => {
  const exposeInMainWorld = vi.fn();
  exposePreloadBridge({ exposeInMainWorld }, { invoke: vi.fn() });
  expect(exposeInMainWorld).toHaveBeenCalledWith("uniworkOffice", expect.objectContaining({ channels: expect.any(Array) }));
});

it("accepts only the narrow launch event and never forwards a ticket", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (_channel, next) => { listener = next; } });
  const received: unknown[] = [];
  bridge.onLaunchRequested((event) => received.push(event));
  listener?.({}, { documentId: "doc-1", operation: "view", launch_ticket: "secret" });
  listener?.({}, { documentId: "doc-1", operation: "view" });
  expect(received).toEqual([{ documentId: "doc-1", operation: "view" }]);
  expect(JSON.stringify(received)).not.toContain("secret");
});

it("forwards only metadata from auth session change events", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (_channel, next) => { listener = next; } });
  const received: unknown[] = [];
  bridge.onSessionChanged((metadata) => received.push(metadata));
  listener?.({}, { status: "signed-in", accountId: "account-1", deploymentId: "production-eu" });
  listener?.({}, { status: "signed-out", accessToken: "secret" });
  expect(received).toEqual([{ status: "signed-in", accountId: "account-1", deploymentId: "production-eu" }]);
  expect(JSON.stringify(received)).not.toContain("secret");
});

it("buffers a leave request that arrives before the renderer subscribes", () => {
  let listener: ((...args: unknown[]) => void) | undefined;
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (channel, next) => { if (channel === "desktop:leave-requested") listener = next; } });
  listener?.({}, { requestId: "leave-1", reason: "close" });
  const received: unknown[] = [];
  const unsubscribe = bridge.onLeaveRequested((event) => received.push(event));
  expect(received).toEqual([{ requestId: "leave-1", reason: "close" }]);
  unsubscribe();
  listener?.({}, { requestId: "leave-2", reason: "update" });
  expect(received).toHaveLength(1);
  listener?.({}, { requestId: "leave-3", reason: "not-a-reason" });
  listener?.({}, { requestId: "leave-4", reason: "close", extra: "secret" });
  expect(received).toHaveLength(1);
  expect(JSON.stringify(received)).not.toContain("secret");
});

it("delivers every buffered native file and launch in channel order after subscription", () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const bridge = createPreloadBridge({ invoke: vi.fn(), on: (channel, listener) => { listeners.set(channel, listener); } });
  const file = (handle: string) => listeners.get("desktop:file-open-requested")?.({}, { handle });
  const launch = (documentId: string, version: number) => listeners.get("desktop:launch-requested")?.({}, { documentId, operation: "view", version });
  const handles = ["a", "b", "c"].map((letter) => `file_${letter.repeat(40)}`);
  handles.forEach(file);
  launch("a", 7); launch("b", 8);
  const files: string[] = [];
  const launches: unknown[] = [];
  const offFile = bridge.onFileOpenRequested((event) => files.push(event.handle));
  const offLaunch = bridge.onLaunchRequested((event) => launches.push(event));
  expect(files).toEqual(handles);
  expect(launches).toEqual([{ documentId: "a", operation: "view", version: 7 }, { documentId: "b", operation: "view", version: 8 }]);
  offFile(); offLaunch();
  file(handles[0]!); file(handles[1]!);
  launch("c", 9); launch("d", 10);
  bridge.onFileOpenRequested((event) => files.push(event.handle));
  bridge.onLaunchRequested((event) => launches.push(event));
  expect(files).toEqual([...handles, handles[0], handles[1]]);
  expect(launches.slice(2)).toEqual([{ documentId: "c", operation: "view", version: 9 }, { documentId: "d", operation: "view", version: 10 }]);
  bridge.onFileOpenRequested((event) => files.push(event.handle));
  bridge.onLaunchRequested((event) => launches.push(event));
  expect(files).toHaveLength(5);
  expect(launches).toHaveLength(4);
});
