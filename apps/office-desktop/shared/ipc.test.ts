import { expect, it } from "vitest";
import { createIpcDispatcher, validateIpcRequest } from "./ipc";
import { DESKTOP_DOCUMENT_FORMATS } from "./document-formats";
import { desktopLibraryResponseSchema, desktopOfficeContextResponseSchema, desktopOfficeOpenResponseSchema, desktopPublicConfigResponseSchema, sanitizeDesktopPublicFlags } from "./ipc";

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
  const checkpoint = { sessionGeneration: sender.sessionGeneration, draftId: "draft", generation: 1, data: Uint8Array.from(Buffer.from("b2s=", "base64")) };
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

it("accepts the registry library formats, pptx included", () => {
  expect(DESKTOP_DOCUMENT_FORMATS).toEqual(["docx", "pdf", "md", "html", "xlsx", "pptx"]);
  const dispatch = createIpcDispatcher({ "desktop:library-list": () => ({ documents: [libraryRow("pptx")], nextCursor: null, engineAvailable: true }) }, sender);
  return expect(dispatch("desktop:library-list", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1" })).resolves.toMatchObject({ documents: [{ format: "pptx" }] });
});

it("refuses a library response whose format is outside the desktop format table", async () => {
  const dispatch = createIpcDispatcher({ "desktop:library-list": () => ({ documents: [libraryRow("txt")], nextCursor: null, engineAvailable: true }) }, sender);
  await expect(dispatch("desktop:library-list", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1" })).rejects.toMatchObject({ code: "schema" });
});

it("accepts a pptx open response mime type and refuses a foreign one", async () => {
  const pptx = { document: libraryRow("pptx"), data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), filename: "Deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", checksum: `sha256:${"a".repeat(64)}` };
  const dispatch = createIpcDispatcher({ "desktop:office-open": () => pptx }, sender);
  await expect(dispatch("desktop:office-open", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" })).resolves.toMatchObject({ document: { format: "pptx" } });
  const foreign = createIpcDispatcher({ "desktop:office-open": () => ({ ...pptx, mimeType: "text/plain" }) }, sender);
  await expect(foreign("desktop:office-open", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" })).rejects.toMatchObject({ code: "schema" });
});

it("carries docx, pdf, md, html, xlsx and pptx through the widened library and open schemas", () => {
  const document = (format: string) => ({ id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: `Plan.${format}`, kind: "file", format, version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true });
  for (const format of ["docx", "pdf", "md", "html", "xlsx", "pptx"]) {
    expect(desktopLibraryResponseSchema.safeParse({ documents: [document(format)], nextCursor: null, engineAvailable: false }).success).toBe(true);
  }
  // A format the host does not carry yet is rejected at the wire boundary.
  for (const format of ["markdown", "txt"]) {
    expect(desktopLibraryResponseSchema.safeParse({ documents: [document(format)], nextCursor: null, engineAvailable: false }).success).toBe(false);
  }
});

it("accepts a carried MIME type on an office-open response and refuses others", () => {
  const document = { id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.xlsx", kind: "file", format: "xlsx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  const response = { document, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), filename: "Plan.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", checksum: `sha256:${"a".repeat(64)}` };
  expect(desktopOfficeOpenResponseSchema.safeParse(response).success).toBe(true);
  expect(desktopOfficeOpenResponseSchema.safeParse({ ...response, mimeType: "text/plain" }).success).toBe(false);
});

it("validates the metadata-only office-context open surface", () => {
  const document = { id: "01J8X4DOC0N1P2Q3R4S5T6U7", workspaceId: "ws-1", title: "Plan.xlsx", kind: "file", format: "xlsx", version: 1, revision: "9", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  expect(desktopOfficeContextResponseSchema.safeParse({ document }).success).toBe(true);
  expect(desktopOfficeContextResponseSchema.safeParse({ document, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")) }).success).toBe(false);
  expect(() => validateIpcRequest("desktop:office-context", { sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1" }, sender)).not.toThrow();
});

it("requires a carried format on an office-save request", () => {
  const save = (format: string) => ({ sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1", format, intentId: "intent-1", idempotencyKey: "key-1", baseVersionId: "version-1", baseRevision: "9", data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), checksum: `sha256:${"a".repeat(64)}` });
  for (const format of ["docx", "xlsx", "pptx"]) expect(() => validateIpcRequest("desktop:office-save", save(format), sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:office-save", save("txt"), sender)).toThrow();
});

it("validates the office-job request surface in main", () => {
  const job = (overrides: Record<string, unknown> = {}) => ({ sessionGeneration: sender.sessionGeneration, workspaceId: "ws-1", documentId: "doc-1", format: "xlsx", operation: "edit", baseRevision: "9", edits: [{ op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } }], ...overrides });
  expect(() => validateIpcRequest("desktop:office-job", job(), sender)).not.toThrow();
  // An open job carries no edit list: the key is absent, not present-but-undefined
  // (the IPC size walk refuses a bare undefined value on the wire).
  const openJob = job({ operation: "open" }) as Record<string, unknown>;
  delete openJob.edits;
  expect(() => validateIpcRequest("desktop:office-job", openJob, sender)).not.toThrow();
  // Unknown operations, a non-decimal base and a non-array edit list all refuse.
  expect(() => validateIpcRequest("desktop:office-job", job({ operation: "serialize" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ baseRevision: "nine" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ edits: "set_cell" }), sender)).toThrow();
  // The job carries a carried format and refuses one the host does not carry.
  expect(() => validateIpcRequest("desktop:office-job", job({ format: "docx" }), sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ format: "txt" }), sender)).toThrow();
  expect(() => validateIpcRequest("desktop:office-job", job({ format: undefined }), sender)).toThrow();
});

it("accepts an optional organization id on the public-config request and nothing else", () => {
  const request = { sessionGeneration: "session_1234" };
  expect(() => validateIpcRequest("desktop:public-config", request, sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:public-config", { ...request, organizationId: "org-1" }, sender)).not.toThrow();
  expect(() => validateIpcRequest("desktop:public-config", { ...request, organizationId: "" }, sender)).toThrow();
  expect(() => validateIpcRequest("desktop:public-config", { ...request, extra: 1 }, sender)).toThrow();
});

it("keeps the Office flags when a public flag catalogue runs past the cap (R4-7)", () => {
  // 200 other flags listed first: an insertion-order cut at 128 would drop every office_* key.
  const raw: Record<string, unknown> = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`flag_${index}`, true]));
  Object.assign(raw, { office_docx: false, office_engine: true, "Bad-Key": true, office_pdf: "yes" });
  const flags = sanitizeDesktopPublicFlags(raw);
  expect(Object.keys(flags)).toHaveLength(128);
  expect(flags.office_engine).toBe(true);
  expect(flags.office_docx).toBe(false);
  expect(Object.keys(flags).slice(0, 2)).toEqual(["office_engine", "office_docx"]);
  expect(flags).not.toHaveProperty("Bad-Key");
  expect(flags).not.toHaveProperty("office_pdf");
  expect(desktopPublicConfigResponseSchema.safeParse({ flags }).success).toBe(true);
});
