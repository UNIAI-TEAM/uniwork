/** @vitest-environment jsdom */
// UNI-927 R3fix-followup (D-3): the real PptxEditorView is mounted here, so the
// Save control's accessible name proves the destination reaches the shell.
import { render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createPptxDocumentSession } from "./pptx-session";
import type { DesktopPptxAdapter, DesktopPptxEditorHandle } from "./pptx-adapter";
import type { RendererBridge } from "../app";

const identity = { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "v1" };
const checksum = `sha256:${"a".repeat(64)}`;

vi.mock("@uniwork/office-upstream/pptx-renderer", () => ({
  buildRenderSlide: () => ({ nodes: [], widthPx: 960, heightPx: 540 }),
  makeViewport: (size: { cx: number; cy: number }, fitWidthPx: number) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  commitSaved: () => undefined,
  getSlideNotes: () => "",
  HeuristicMetrics: class {},
  listSlideLayouts: () => [],
  openPptx: async () => ({ deck: { slides: [] } }),
  reparseDeck: (opened: unknown) => opened,
  runTxn: () => ({ applied: true, records: [] }),
  savePptx: async () => new Uint8Array(),
}));

function mount(local: boolean) {
  const bridge = {
    call: (async (channel: string) => (channel === "desktop:draft-list" ? { drafts: [] } : {})) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  const surface = {
    format: "pptx",
    open: async () => undefined,
    getDirtyGeneration: () => 0,
    captureSnapshot: async () => ({ generation: 0, fingerprint: "fp", value: { revision: 0, edits: [] } }),
    undo: () => undefined,
    redo: () => undefined,
    dispose: async () => undefined,
    slides: () => [{ id: "s1", hidden: false }],
    deck: () => ({ slides: [{ id: "s1", elements: [] }], size: { cx: 12192000, cy: 6858000 } }),
    revision: () => 0,
    snapshot: () => ({ revision: 0, edits: [] }),
    restore: async () => undefined,
    serialize: async () => ({ bytes: new Uint8Array([1]), checksum: "sha256:x" }),
    edit: async () => ({ revision: 0 }),
  } as unknown as DesktopPptxEditorHandle;
  const opened = { format: "pptx" as const, dataBase64: "UEsDBA==", checksum, ...(local ? { localHandle: "local:pathhash" } : {}) };
  const session = createPptxDocumentSession(bridge, identity, opened, () => ({
    editor: surface,
    capability: { format: "pptx", operation: "serialize", host: "desktop", engineBuild: "test", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] },
    open: async () => ({ outcome: "opened", document_id: identity.documentId, format: "pptx" }),
  } as unknown as DesktopPptxAdapter));
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Deck.pptx" active kind={local ? "local" : "cloud"} onBack={() => undefined} />);
}

it("names the local target on the Save button of a pptx opened from this computer", async () => {
  mount(true);
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("office.shell.save_to_device") })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: i18n.t("office.shell.save_to_cloud") })).toBeNull();
});

it("keeps the cloud name on the Save button of a cloud pptx", async () => {
  mount(false);
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("office.shell.save_to_cloud") })).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: i18n.t("office.shell.save_to_device") })).toBeNull();
});
