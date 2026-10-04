import { expect, it } from "vitest";
import { createIpcDispatcher, validateIpcRequest } from "./ipc";
import { DESKTOP_DOCUMENT_FORMATS } from "./document-format";

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

const libraryRow = (format: string) => ({ id: "doc-1", workspaceId: "ws-1", title: `Plan.${format}`, kind: "file", format, version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true });

it("accepts the three OOXML library formats and refuses any other format", () => {
  expect(DESKTOP_DOCUMENT_FORMATS).toEqual(["docx", "xlsx", "pptx"]);
  const dispatch = createIpcDispatcher({ "desktop:library-list": () => ({ documents: [libraryRow("pptx")], nextCursor: null, engineAvailable: true }) }, sender);
  return expect(dispatch("desktop:library-list", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1" })).resolves.toMatchObject({ documents: [{ format: "pptx" }] });
});

it("refuses a library response whose format is outside the OOXML vocabulary", async () => {
  const dispatch = createIpcDispatcher({ "desktop:library-list": () => ({ documents: [libraryRow("pdf")], nextCursor: null, engineAvailable: true }) }, sender);
  await expect(dispatch("desktop:library-list", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1" })).rejects.toMatchObject({ code: "schema" });
});

it("accepts a pptx open response mime type and refuses a foreign one", async () => {
  const pptx = { document: libraryRow("pptx"), dataBase64: "aGVsbG8=", filename: "Deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", checksum: `sha256:${"a".repeat(64)}` };
  const dispatch = createIpcDispatcher({ "desktop:office-open": () => pptx }, sender);
  await expect(dispatch("desktop:office-open", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" })).resolves.toMatchObject({ document: { format: "pptx" } });
  const foreign = createIpcDispatcher({ "desktop:office-open": () => ({ ...pptx, mimeType: "application/pdf" }) }, sender);
  await expect(foreign("desktop:office-open", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" })).rejects.toMatchObject({ code: "schema" });
});
