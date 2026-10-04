import { expect, it } from "vitest";
import { createIpcDispatcher, validateIpcRequest } from "./ipc";
import { desktopLibraryResponseSchema, desktopOfficeContextResponseSchema, desktopOfficeOpenResponseSchema } from "./ipc";

const sender = { senderId: 1, expectedSenderId: 1, frameId: 0, expectedFrameId: 0, origin: "uniwork-office-app://app", expectedOrigin: "uniwork-office-app://app", sessionGeneration: "session_1234" };
const tabs = { sessionGeneration: sender.sessionGeneration, documentIds: ["a", "b"], activeDocumentId: "b" };

it("validates tab membership, uniqueness, opaque ids, maximum eight and live IPC session", () => {
  expect(validateIpcRequest("desktop:tabs-update", tabs, sender)).toEqual(tabs);
  expect(validateIpcRequest("desktop:tabs-update", { ...tabs, activeDocumentId: null }, sender)).toMatchObject({ activeDocumentId: null });
  for (const invalid of [
    { ...tabs, documentIds: Array.from({ length: 9 }, (_, n) => String(n)) },
    { ...tabs, documentIds: ["b", "b"] },
    { ...tabs, activeDocumentId: "c" },
    { ...tabs, documentIds: ["/secret"], activeDocumentId: null },
    { ...tabs, documentIds: ["a".repeat(161)], activeDocumentId: null },
    { ...tabs, sessionGeneration: "session_stale" },
    { ...tabs, accountId: "account-a" },
  ]) expect(() => validateIpcRequest("desktop:tabs-update", invalid, sender)).toThrow();
});

it("requires document id on checkpoint and recovery but keeps account-level list/discard", () => {
  const checkpoint = { sessionGeneration: sender.sessionGeneration, draftId: "draft", generation: 1, dataBase64: "b2s=" };
  const recovery = { sessionGeneration: sender.sessionGeneration, draftId: "draft", currentBase: { version: "1", revision: "1" } };
  expect(() => validateIpcRequest("desktop:draft-checkpoint", checkpoint, sender)).toThrow();
  expect(() => validateIpcRequest("desktop:draft-recover", recovery, sender)).toThrow();
  const documentId = `file_${"a".repeat(64)}`;
  expect(validateIpcRequest("desktop:draft-checkpoint", { ...checkpoint, documentId }, sender)).toMatchObject({ documentId });
  expect(validateIpcRequest("desktop:draft-recover", { ...recovery, documentId }, sender)).toMatchObject({ documentId });
  for (const request of [{ sessionGeneration: sender.sessionGeneration }, { sessionGeneration: sender.sessionGeneration, documentId }]) {
    expect(validateIpcRequest("desktop:draft-list", request, sender)).toEqual(request);
    expect(validateIpcRequest("desktop:draft-discard", { ...request, draftId: "draft", generation: 1 }, sender)).toMatchObject(request);
  }
});

it("validates tabs-update responses", async () => {
  const dispatch = createIpcDispatcher({ "desktop:tabs-update": () => ({ updated: true, path: "/secret" }) }, sender);
  await expect(dispatch("desktop:tabs-update", tabs)).rejects.toMatchObject({ code: "schema" });
});

it("carries docx and xlsx through the widened library and open schemas", () => {
  const document = (format: string) => ({ id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: `Plan.${format}`, kind: "file", format, version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true });
  for (const format of ["docx", "xlsx"]) {
    expect(desktopLibraryResponseSchema.safeParse({ documents: [document(format)], nextCursor: null, engineAvailable: false }).success).toBe(true);
  }
  // A format the host does not carry yet is rejected at the wire boundary.
  for (const format of ["pptx", "pdf", "md", "html"]) {
    expect(desktopLibraryResponseSchema.safeParse({ documents: [document(format)], nextCursor: null, engineAvailable: false }).success).toBe(false);
  }
});

it("accepts one of the two carried MIME types on an office-open response and refuses others", () => {
  const document = { id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.xlsx", kind: "file", format: "xlsx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  const response = { document, dataBase64: "aGVsbG8=", filename: "Plan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", checksum: `sha256:${"a".repeat(64)}` };
  expect(desktopOfficeOpenResponseSchema.safeParse(response).success).toBe(true);
  expect(desktopOfficeOpenResponseSchema.safeParse({ ...response, mimeType: "application/pdf" }).success).toBe(false);
});

it("validates the metadata-only office-context open surface", () => {
  const document = { id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.xlsx", kind: "file", format: "xlsx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  expect(desktopOfficeContextResponseSchema.safeParse({ document }).success).toBe(true);
  expect(desktopOfficeContextResponseSchema.safeParse({ document, dataBase64: "aGVsbG8=" }).success).toBe(false);
  expect(() => validateIpcRequest("desktop:office-context", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" }, sender)).not.toThrow();
});

it("requires a carried format on an office-save request", () => {
  const save = (format: string) => ({ sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1", format, intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", dataBase64: "aGVsbG8=", checksum: `sha256:${"a".repeat(64)}` });
  for (const format of ["docx", "xlsx"]) expect(() => validateIpcRequest("desktop:office-save", save(format), sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:office-save", save("pptx"), sender)).toThrow();
});

it("validates the office-job request surface in main", () => {
  const job = (overrides: Record<string, unknown> = {}) => ({ sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1", format: "xlsx", operation: "edit", baseRevision: "9", edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }], ...overrides });
  expect(() => validateIpcRequest("desktop:office-job", job(), sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ operation: "open", edits: undefined }), sender)).not.toThrow();
  // Unknown operations, a non-decimal base and a non-array edit list all refuse.
  expect(() => validateIpcRequest("desktop:office-job", job({ operation: "serialize" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ baseRevision: "nine" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ edits: "set_cell" }), sender)).toThrow();
  // The job carries a carried format and refuses one the host does not carry.
  expect(() => validateIpcRequest("desktop:office-job", job({ format: "docx" }), sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ format: "pptx" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ format: undefined }), sender)).toThrow();
});
