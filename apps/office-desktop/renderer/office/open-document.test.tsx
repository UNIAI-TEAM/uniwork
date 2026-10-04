/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { OpenByteDocument } from "./open-document";
import { createByteDocumentSession } from "./session";
import { createPptxDocumentSession } from "./pptx-session";
import type { DesktopPptxAdapter, DesktopPptxEditorHandle } from "./pptx-adapter";
import type { RendererBridge } from "../app";
import { createByteTestEditor } from "../../test/byte-editor";

const identity = { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", generation: 1, baseRevision: "1", baseVersionId: "v1" };
const checksum = `sha256:${"a".repeat(64)}`;
const draft = { draftId: "doc-1:v1:1", identity: { deploymentId: "lane", accountId: "account-1", organizationId: "org-1", workspaceId: "ws-1", documentId: "doc-1", base: { revision: "1", version: "v1" } }, generation: 2, checksum: `sha256:${"c".repeat(64)}`, byteLength: 5, updatedAt: 9 };
const olderDraft = { ...draft, draftId: "doc-1:v0:0", identity: { ...draft.identity, base: { revision: "0", version: "v0" } } };

function mount(handler: (channel: string, payload: unknown) => Promise<unknown>, active = true) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const bridge = {
    call: (async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return handler(channel, payload); }) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  const session = createByteDocumentSession(bridge, identity, { dataBase64: "aGVsbG8=", checksum }, { createEditor: createByteTestEditor });
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Plan.docx" active={active} kind="cloud" signedIn onBack={() => undefined} />);
  return { calls, session };
}

it("offers a matching draft on the document screen and restores it", async () => {
  const { calls, session } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: "d29ybGQ=" };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-recover")).toBe(true));
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.library.draftRecovered"))).toBeInTheDocument());
  expect((await session.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("keeps an inactive tab's recovery offer hidden and its Save control disabled", async () => {
  const { calls } = mount(async (channel) => channel === "desktop:draft-list" ? { drafts: [draft] } : {}, false);
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-list")).toBe(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("office.save.action.save_to_cloud") })).toBeNull();
});

it("labels a conflicting draft and discards exactly that older-base row", async () => {
  const { calls } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [olderDraft] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: i18n.t("office.recovery.recover") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-discard")).toBe(true));
  expect(calls.find((call) => call.channel === "desktop:draft-discard")?.payload).toMatchObject({ draftId: olderDraft.draftId, generation: olderDraft.generation });
});

it("keeps a refused discard open instead of reporting a false success", async () => {
  mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [olderDraft] };
    if (channel === "desktop:draft-discard") throw Object.assign(new Error("draft operation refused"), { code: "storage_unavailable" });
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.discard") }));
  await waitFor(() => expect(screen.getByText(i18n.t("office.recovery.write_failed"))).toBeInTheDocument());
  expect(screen.getByText(i18n.t("office.recovery.conflict_title"))).toBeInTheDocument();
});

it("renders the typed locked notice instead of a generic found-draft prompt", async () => {
  mount(async (channel) => {
    if (channel === "desktop:draft-list") throw Object.assign(new Error("draft operation refused"), { code: "draft_recovery_locked" });
    return {};
  });
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.getByText(i18n.t("office.recovery.locked"))).toBeInTheDocument();
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

it("shows the typed locked notice when recovery is refused by a locked store", async () => {
  const { calls } = mount(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "locked", metadata: draft, code: "draft_recovery_locked" };
    return {};
  });
  expect(await screen.findByText(i18n.t("office.recovery.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.recovery.recover") }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:draft-recover")).toBe(true));
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
  expect(screen.queryByText(i18n.t("office.recovery.write_failed"))).not.toBeInTheDocument();
});

it("shows no recovery prompt when the store holds no draft for this document", async () => {
  mount(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await waitFor(() => expect(screen.getByRole("button", { name: i18n.t("officeDesktop.library.back") })).toBeInTheDocument());
  expect(screen.queryByText(i18n.t("office.recovery.title"))).not.toBeInTheDocument();
});

// UNI-927 DESKTOP-BIND: the desktop host must bind the pptx edit ports instead
// of mounting a view-only deck. The shared view is stubbed so the props the host
// passes and the channel a committed edit travels on are asserted directly.
// The generated pptx artifact is a heavy browser bundle and is irrelevant to
// port binding; the runtime imports it, so stub it exactly as the web adapter
// test does instead of loading it in jsdom.
vi.mock("@uniwork/office-upstream/pptx-renderer", () => ({
  buildRenderSlide: () => ({ nodes: [], widthPx: 960, heightPx: 540 }),
  makeViewport: (size: { cx: number; cy: number }, fitWidthPx: number) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  commitSaved: () => undefined,
  // pptx-runtime reads getSlideNotes off the artifact namespace at module load
  // (an optional member); the mock must carry it or the import throws before
  // any test runs. The suite drives a fake runtime, so it is never called.
  getSlideNotes: () => "",
  HeuristicMetrics: class {},
  listSlideLayouts: () => [],
  openPptx: async () => ({ deck: { slides: [] } }),
  reparseDeck: (opened: unknown) => opened,
  runTxn: () => ({ applied: true, records: [] }),
  savePptx: async () => new Uint8Array(),
}));

const pptxProbe = vi.hoisted(() => ({ views: [] as Array<Record<string, unknown>> }));
vi.mock("@uniwork/views/office/pptx", async () => {
  const { createElement } = await import("react");
  return {
    PptxEditorView: (props: Record<string, unknown>) => {
      pptxProbe.views.push(props);
      return createElement("div", { "data-testid": "pptx-editor-view-probe" });
    },
  };
});

/** The desktop surface the session drives: a real edit channel whose revision
 * advances exactly like the adapter's, and a deck that reads the documented
 * text shape the find port walks. */
function createPptxTestSurface(onDirty: (generation: number) => void) {
  const record = { edits: [] as Array<Array<Record<string, unknown>>>, revision: 0 };
  const surface = {
    format: "pptx",
    open: async () => undefined,
    getDirtyGeneration: () => record.edits.length,
    captureSnapshot: async () => ({ generation: record.edits.length, fingerprint: "fp", value: { revision: record.revision, edits: [] } }),
    undo: () => undefined,
    redo: () => undefined,
    dispose: async () => undefined,
    slides: () => [{ id: "s1", hidden: false, elements: [{ id: "el-1", type: "text" }] }],
    snapshot: () => ({ revision: record.revision, edits: [] }),
    deck: () => ({ slides: [{ id: "s1", elements: [{ id: "el-1", type: "text", text: { paragraphs: [{ runs: [{ text: "Title" }] }] } }] }], size: { cx: 12192000, cy: 6858000 } }),
    revision: () => record.revision,
    restore: async () => undefined,
    serialize: async () => ({ bytes: new Uint8Array([1]), checksum: "sha256:x" }),
    edit: async (batch: readonly Record<string, unknown>[]) => {
      record.edits.push([...batch]);
      record.revision += 1;
      onDirty(record.edits.length);
      return { revision: record.revision };
    },
  };
  return { surface: surface as unknown as DesktopPptxEditorHandle, record };
}

it("binds every desktop pptx edit port and advances the revision on a committed text edit", async () => {
  const bridge = {
    call: (async (channel: string) => (channel === "desktop:draft-list" ? { drafts: [] } : {})) as RendererBridge["call"],
    onSessionChanged: () => () => undefined,
  } as RendererBridge;
  let created!: ReturnType<typeof createPptxTestSurface>;
  const session = createPptxDocumentSession(
    bridge,
    identity,
    { dataBase64: "UEsDBA==", checksum },
    (onDirty) => {
      created = createPptxTestSurface(onDirty);
      return {
        editor: created.surface,
        capability: { format: "pptx", operation: "serialize", host: "desktop", engineBuild: "test", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] },
        open: async () => ({ outcome: "opened", document_id: identity.documentId, format: "pptx" }),
      } as unknown as DesktopPptxAdapter;
    },
  );
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Deck.pptx" active kind="cloud" onBack={() => undefined} />);

  // The deck is only bound once the async open resolves; wait for that render.
  await waitFor(() => expect(pptxProbe.views.at(-1)?.deck).toBeDefined());
  const props = pptxProbe.views.at(-1)!;
  // The mounted view receives every edit port the desktop surface supports.
  for (const port of ["onCommitText", "onTransform", "onApplyEdit", "onDeleteElements", "onFind"]) {
    expect(typeof props[port], port).toBe("function");
  }
  expect(props.deck).toMatchObject({ revision: 0 });

  // A committed text edit reaches the handle's edit channel as edit_text.
  await act(async () => {
    await (props.onCommitText as (commit: unknown) => Promise<unknown>)({ slideIndex: 0, elementId: "el-1", paragraphs: [{ runs: [{ text: "Edited" }] }] });
  });
  expect(created.record.edits).toEqual([[{ op: "edit_text", slideIndex: 0, elementId: "el-1", paragraphs: [{ runs: [{ text: "Edited" }] }] }]]);

  // The published revision advances, so the deck memo (and the canvas) sees it.
  await waitFor(() => expect((pptxProbe.views.at(-1)?.deck as { revision: number } | undefined)?.revision).toBe(1));
});
