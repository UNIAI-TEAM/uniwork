import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = `sha256:${"a".repeat(64)}`;
const opened = { dataBase64: "aGVsbG8=", checksum };

it("sends the opened snapshot once through coordinator save and blocks a concurrent menu save", async () => {
  let complete!: (value: unknown) => void;
  const call = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
  const session = createByteDocumentSession({ call: call as never }, identity, opened);
  const first = session.coordinator.save("button");
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
  await expect(session.coordinator.save("menu")).resolves.toMatchObject({ accepted: false, reason: "saving" });
  const request = call.mock.calls[0] as unknown as [string, { intentId: string; idempotencyKey: string; dataBase64: string }];
  expect(request[0]).toBe("desktop:office-save");
  expect(request[1].dataBase64).toBe(opened.dataBase64);
  complete({ documentId: "doc", intentId: request[1].intentId, idempotencyKey: request[1].idempotencyKey, revision: "3", versionId: "v3", checksum });
  await expect(first).resolves.toMatchObject({ accepted: true });
  expect(session.coordinator.getState().identity.baseVersionId).toBe("v3");
});

it("routes local Save to the original opaque handle and records a confirmed save", async () => {
  const handle = `file_${"x".repeat(40)}`;
  const call = vi.fn(async () => ({ opened: true, metadata: { handle, name: "Local.docx", byteLength: 5, modifiedAtMs: 10, checksum } }));
  const session = createByteDocumentSession({ call: call as never }, { ...identity, documentId: handle, baseRevision: "0" }, { ...opened, localHandle: handle });
  await expect(session.coordinator.save("menu")).resolves.toMatchObject({ accepted: true });
  expect(call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle, dataBase64: "aGVsbG8=" }));
  expect(session.coordinator.getState().lastSavedGeneration).toBe(session.coordinator.getState().dirtyGeneration);
});
