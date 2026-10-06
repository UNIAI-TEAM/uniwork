/** @vitest-environment jsdom */
// UNI-927 R3fix-draft (R2-4): a relaunched LOCAL .pptx with a draft in the
// store must offer it through the same DraftRecoveryPrompt the DOCX path uses.
// Main already lists the row under the restart-stable path identity; the PPTX
// shell never asked for it, so the deck opened silently over the draft.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createPptxDocumentSession } from "./pptx-session";
import type { DesktopPptxAdapter, DesktopPptxEditorHandle } from "./pptx-adapter";
import type { PptxDeckSnapshot } from "./pptx-runtime";
import type { RendererBridge } from "../app";

const checksum = `sha256:${"a".repeat(64)}`;
// A relaunch hands the tab a fresh handle; the base is the file's bytes (checksum + mtime).
const identity = { deploymentId: "local", accountId: "local", organizationId: "local", workspaceId: "local", documentId: "handle-after-relaunch", generation: 1, baseRevision: "1700000000000", baseVersionId: checksum };
const snapshot = { revision: 3, edits: [{ op: "add_element", slideIndex: 0, kind: "rect", xPx: 1, yPx: 1, wPx: 10, hPx: 10 }] } as unknown as PptxDeckSnapshot;
const snapshotBase64 = btoa(JSON.stringify(snapshot));
const draftIdentity = { deploymentId: "local-device", accountId: "local:device", organizationId: "local", workspaceId: "local", documentId: "local:pathhash", base: { revision: "1700000000000", version: checksum } };
const draft = { draftId: "local:pathhash:0123456789abcdef", identity: draftIdentity, generation: 3, checksum: `sha256:${"c".repeat(64)}`, byteLength: 64, updatedAt: 9 };
const staleDraft = { ...draft, draftId: "local:pathhash:fedcba9876543210", identity: { ...draftIdentity, base: { revision: "1690000000000", version: `sha256:${"b".repeat(64)}` } } };

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

vi.mock("@uniwork/views/office/pptx", async () => {
  const { createElement } = await import("react");
  // The probe renders the notice slot inside its own box, so a test can tell a notice routed through the view from one left above it.
  return { PptxEditorView: (props: { openState?: string; notice?: unknown }) => createElement("div", { "data-testid": "pptx-editor-view-probe", "data-open-state": props.openState }, createElement("div", { "data-testid": "pptx-notice-slot" }, props.notice as never)) };
});

function mount(handler: (channel: string, payload: unknown) => Promise<unknown>) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const restored: PptxDeckSnapshot[] = [];
  const bridge = {
    call: (async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return handler(channel, payload); }) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  let onDirty: (generation: number) => void = () => undefined;
  const surface = {
    format: "pptx",
    open: async () => undefined,
    getDirtyGeneration: () => 0,
    captureSnapshot: async () => ({ generation: 0, fingerprint: "fp", value: { revision: 0, edits: [] } }),
    undo: () => undefined,
    redo: () => undefined,
    dispose: async () => undefined,
    slides: () => [{ id: "s1", hidden: false }],
    deck: () => ({ slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }),
    revision: () => restored.length,
    snapshot: () => ({ revision: 0, edits: [] }),
    restore: async (value: PptxDeckSnapshot) => { restored.push(value); onDirty(value.revision); },
    serialize: async () => ({ bytes: new Uint8Array([1]), checksum }),
    edit: async () => ({ revision: 0 }),
  } as unknown as DesktopPptxEditorHandle;
  const session = createPptxDocumentSession(bridge, identity, { format: "pptx", dataBase64: "UEsDBA==", checksum, localHandle: identity.documentId }, (dirty) => {
    onDirty = dirty;
    return { editor: surface } as unknown as DesktopPptxAdapter;
  });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Deck.pptx" active kind="local" onBack={() => undefined} />);
  return { calls, restored, session };
}

it("offers the relaunched local deck's draft and recovers exactly the pre-kill snapshot", async () => {
  const { calls, restored, session } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: snapshotBase64 };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  expect(calls.find((call) => call.channel === "desktop:draft-list")?.payload).toMatchObject({ documentId: identity.documentId });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(restored).toEqual([snapshot]));
  expect(calls.find((call) => call.channel === "desktop:draft-recover")?.payload).toMatchObject({ draftId: draft.draftId, currentBase: { revision: identity.baseRevision, version: identity.baseVersionId } });
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.library.draftRecovered"))).toBeInTheDocument());
  // Routed through the view's notice slot (under the file header), not rendered above the shell.
  expect(screen.getByTestId("pptx-notice-slot")).toContainElement(screen.getByText(i18n.t("officeDesktop.library.draftRecovered")));
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
  // The recovered deck is unsaved work: Save must have something to write.
  expect(session.coordinator.getState().dirtyGeneration).toBe(snapshot.revision);
});

it("labels a draft whose base file changed as a conflict and Discard removes exactly that row", async () => {
  const { calls, restored } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [staleDraft] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: i18n.t("office.recovery.recover") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-discard")).toBe(true));
  expect(calls.find((call) => call.channel === "desktop:draft-discard")?.payload).toMatchObject({ draftId: staleDraft.draftId, generation: staleDraft.generation });
  await waitFor(() => expect(screen.queryByText(i18n.t("office.recovery.conflict_title"))).not.toBeInTheDocument());
  expect(restored).toEqual([]);
});

it("shows no prompt when Save + reopen left no draft for the file", async () => {
  const { calls } = mount(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-list")).toBe(true));
  await waitFor(() => expect(screen.getByTestId("pptx-editor-view-probe").dataset.openState).toBe("ready"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("renders the typed locked notice instead of a prompt", async () => {
  mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [], locked: true };
    return {};
  });
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.getByTestId("pptx-notice-slot")).toContainElement(document.querySelector('[data-testid="office-recovery-locked"]') as HTMLElement);
  expect(screen.queryByRole("dialog")).toBeNull();
});
