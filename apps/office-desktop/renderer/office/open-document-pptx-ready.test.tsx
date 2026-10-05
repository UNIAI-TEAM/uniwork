/** @vitest-environment jsdom */
// UNI-927 W1 (visual-END B2): the real desktop surface has no deck and no slides
// until openEditor() resolves, and opening does not bump the revision. The PPTX
// shell must re-read both when the open completes, or the first open stays empty.
import { render, waitFor } from "@testing-library/react";
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

const probe = vi.hoisted(() => ({ views: [] as Array<Record<string, unknown>> }));
vi.mock("@uniwork/views/office/pptx", async () => {
  const { createElement } = await import("react");
  return {
    PptxEditorView: (props: Record<string, unknown>) => {
      probe.views.push(props);
      return createElement("div", { "data-testid": "pptx-editor-view-probe" });
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
  const session = createPptxDocumentSession(bridge, identity, { dataBase64: "UEsDBA==", checksum }, () => {
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
