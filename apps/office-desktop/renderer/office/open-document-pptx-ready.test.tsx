/** @vitest-environment jsdom */
// UNI-927 W1 (visual-END B2): the real desktop surface has no deck and no slides
// until openEditor() resolves, and opening does not bump the revision. The PPTX
// shell must re-read both when the open completes, or the first open stays empty.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createPptxDocumentSession } from "./pptx-session";
import type { DesktopPptxAdapter, DesktopPptxEditorHandle } from "./pptx-adapter";
import type { RendererBridge } from "../app";

const identity = { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "v1" };
const checksum = `sha256:${"a".repeat(64)}`;

// The generated pptx artifact is a heavy browser bundle; stub it as open-document.test.tsx does.
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

const probe = vi.hoisted(() => ({ views: [] as Array<Record<string, unknown>>, editors: [] as Array<Record<string, unknown>> }));
vi.mock("@uniwork/views/office/pptx", async () => {
  const { createElement } = await import("react");
  return {
    PptxEditorView: (props: Record<string, unknown>) => {
      probe.views.push(props);
      return createElement("div", { "data-testid": "pptx-editor-view-probe" });
    },
    PptxEditor: (props: Record<string, unknown>) => {
      probe.editors.push(props);
      return createElement("div", { "data-testid": "pptx-editor-probe" });
    },
  };
});

/** A surface that, like the real one, publishes nothing until open() resolves. */
function createLateOpenSurface() {
  let opened = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const surface = {
    format: "pptx",
    open: async () => { await gate; opened = true; },
    getDirtyGeneration: () => 0,
    captureSnapshot: async () => ({ generation: 0, fingerprint: "fp", value: { revision: 0, edits: [] } }),
    undo: () => undefined,
    redo: () => undefined,
    dispose: async () => undefined,
    slides: () => (opened ? [{ id: "s1", hidden: false }, { id: "s2", hidden: true }] : []),
    deck: () => (opened ? { slides: [{ id: "s1" }, { id: "s2" }], size: { cx: 12192000, cy: 6858000 } } : null),
    revision: () => 0,
    snapshot: () => ({ revision: 0, edits: [] }),
    restore: async () => undefined,
    serialize: async () => ({ bytes: new Uint8Array([1]), checksum: "sha256:x" }),
    edit: async () => ({ revision: 0 }),
  };
  return { surface: surface as unknown as DesktopPptxEditorHandle, release };
}

it("shows the real slides and deck on first open without any edit", async () => {
  const bridge = {
    call: (async (channel: string) => (channel === "desktop:draft-list" ? { drafts: [] } : {})) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  let created!: ReturnType<typeof createLateOpenSurface>;
  const session = createPptxDocumentSession(bridge, identity, { format: "pptx", data: Uint8Array.from(Buffer.from("UEsDBA==", "base64")), checksum }, () => {
    created = createLateOpenSurface();
    return {
      editor: created.surface,
      capability: { format: "pptx", operation: "serialize", host: "desktop", engineBuild: "test", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] },
      open: async () => ({ outcome: "opened", document_id: identity.documentId, format: "pptx" }),
    } as unknown as DesktopPptxAdapter;
  });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Deck.pptx" active kind="cloud" onBack={() => undefined} />);

  // Before the open resolves there is nothing to show and the view is loading.
  await waitFor(() => expect(probe.views.length).toBeGreaterThan(0));
  expect(probe.views.at(-1)?.deck).toBeUndefined();
  expect(probe.views.at(-1)?.slides).toEqual([]);
  expect(probe.views.at(-1)?.openState).toBe("loading");

  created.release();
  await waitFor(() => expect(probe.views.at(-1)?.openState).toBe("ready"));
  expect(probe.views.at(-1)?.slides).toEqual([
    { id: "s1", label: "1", hidden: false },
    { id: "s2", label: "2", hidden: true },
  ]);
  expect(probe.views.at(-1)?.deck).toMatchObject({ revision: 0, deck: { slides: [{ id: "s1" }, { id: "s2" }] } });
});

function readOnlyPptxSession(bridge: RendererBridge, onSurface?: (created: ReturnType<typeof createLateOpenSurface>) => void) {
  return createPptxDocumentSession(bridge, identity, { format: "pptx", data: Uint8Array.from(Buffer.from("UEsDBA==", "base64")), checksum, canSave: false }, () => ({
    editor: (() => { const created = createLateOpenSurface(); onSurface?.(created); return created.surface; })(),
    capability: { format: "pptx", operation: "serialize", host: "desktop", engineBuild: "test", contractRevision: "office-editor-host/1", status: "readonly", fidelityWarnings: [] },
    open: async () => ({ outcome: "opened", document_id: identity.documentId, format: "pptx" }),
  } as unknown as DesktopPptxAdapter));
}
const pptxBridge = () => ({ call: (async (channel: string) => (channel === "desktop:draft-list" ? { drafts: [] } : {})) as RendererBridge["call"], onSessionChanged: () => () => undefined } as RendererBridge);

it("a flag-off PPTX tab shows one neutral notice over the deck, view-only, with a Back button and no permission chip or alert (UIQ-1, r6 F2)", async () => {
  const bridge = pptxBridge();
  let created!: ReturnType<typeof createLateOpenSurface>;
  const onBack = vi.fn();
  probe.editors.length = 0;
  const { container } = render(<OpenByteDocument bridge={bridge} identity={identity} session={readOnlyPptxSession(bridge, (value) => { created = value; })} readOnlyReason="feature_off" title="Deck.pptx" active kind="cloud" onBack={onBack} />);
  await waitFor(() => expect(container.querySelectorAll("[data-testid='office-feature-off']")).toHaveLength(1));
  expect(container.querySelector("[data-testid='office-feature-off']")?.getAttribute("data-reason")).toBe("feature_off");
  expect(container.querySelector("[data-testid^='office-save-permission']")).toBeNull();
  expect(container.querySelector("[data-testid^='office-capability-']")).toBeNull();
  expect(container.querySelector("[data-testid='pptx-editor-view-probe']")).toBeNull();
  // No deck before the open resolves; then the opened deck, with no edit port bound.
  expect(container.querySelector("[data-testid='readonly-deck']")).toBeNull();
  created.release();
  await waitFor(() => expect(container.querySelector("[data-testid='readonly-deck'] [data-testid='pptx-editor-probe']")).not.toBeNull());
  const props = probe.editors.at(-1)!;
  expect(props.deck).toMatchObject({ deck: { slides: [{ id: "s1" }, { id: "s2" }] } });
  expect(props.slides).toEqual([{ id: "s1", label: "1", hidden: false }, { id: "s2", label: "2", hidden: true }]);
  for (const port of ["onCommitText", "onTransform", "onApplyEdit", "onDeleteElements", "onTextEdit"]) expect(props[port]).toBeUndefined();
  const handle = props.editorHandle as { edit?: unknown; dispose: () => Promise<void> };
  expect(handle.edit).toBeUndefined();
  expect(props.includeSave).toBe(false);
  // Back, like the byte and XLSX shells.
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.library.back") }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it("a PPTX tab whose flags have not loaded says so, not that editing is off", async () => {
  const bridge = pptxBridge();
  const { container } = render(<OpenByteDocument bridge={bridge} identity={identity} session={readOnlyPptxSession(bridge)} readOnlyReason="flags_unknown" title="Deck.pptx" active kind="cloud" onBack={() => undefined} />);
  await waitFor(() => expect(container.querySelector("[data-testid='office-feature-off']")?.getAttribute("data-reason")).toBe("flags_unknown"));
  expect(screen.queryByText(i18n.t("officeDesktop.library.flagsUnknownTitle", { format: "PPTX" }))).not.toBeNull();
  expect(screen.queryByText(i18n.t("officeDesktop.library.featureOffTitle", { format: "PPTX" }))).toBeNull();
});

it("a read-only PPTX tab without the flag reason still goes through the deck view and shows no feature-off notice", async () => {
  const bridge = pptxBridge();
  const { container } = render(<OpenByteDocument bridge={bridge} identity={identity} session={readOnlyPptxSession(bridge)} title="Deck.pptx" active kind="cloud" onBack={() => undefined} />);
  await waitFor(() => expect(container.querySelector("[data-testid='pptx-editor-view-probe']")).not.toBeNull());
  expect(container.querySelector("[data-testid='office-feature-off']")).toBeNull();
});
