// @vitest-environment jsdom
// UNI-927 B6 (S2) - the mounted adapter surface hands the shared PptxEditor the
// two Masters panel reads. The shared editor is stubbed so the test sees exactly
// the props the web host passes, not the panel's own behaviour (views owns that).

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { OfficeCapabilityEntry, OfficeIdentity } from "@uniwork/core/office";
import type { DraftKeyProvider } from "./draft-key-provider";
import type { IndexedDbDraftStore } from "./draft-store";
import type { PptxSessionRuntime } from "./pptx-runtime";

const seen = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  getI18n: () => ({ hasResourceBundle: () => false, addResourceBundle: () => undefined, on: () => undefined }),
}));
vi.mock("@uniwork/office-upstream/pptx-renderer", () => ({
  getSlideNotes: () => "",
  parseMasterPart: () => null,
}));
vi.mock("@uniwork/views/office/pptx/editor-view", () => ({
  PptxEditor: (props: Record<string, unknown>) => {
    seen.props = props;
    return createElement("div", { "data-stub-editor": true });
  },
}));
import { createPptxFormatAdapter } from "./pptx-adapter";
import type { PptxDocumentsTransport } from "./pptx-save-transport";

const identity: OfficeIdentity = {
  deploymentId: "dep",
  accountId: "acct",
  organizationId: "org",
  workspaceId: "ws",
  documentId: "doc",
  generation: 1,
  baseVersionId: "version-1",
  baseRevision: "1",
};
const capability: OfficeCapabilityEntry = {
  format: "pptx",
  operation: "serialize",
  host: "web",
  engineBuild: "genoffice-test",
  contractRevision: "office-editor-host/1",
  status: "available",
  fidelityWarnings: [],
};
const MASTER = "ppt/slideMasters/slideMaster1.xml";

function engineDouble(): PptxSessionRuntime {
  return {
    open: vi.fn(async ({ documentId }) => ({ outcome: "opened" as const, document_id: documentId, document_model_ref: "model-1", snapshot: { revision: 0, edits: [] }, warnings: [] })),
    edit: vi.fn(async () => ({ revision: 1 })),
    snapshot: vi.fn(() => ({ revision: 0, edits: [] })),
    undo: vi.fn(async () => true),
    redo: vi.fn(async () => true),
    serialize: vi.fn(async () => ({ bytes: new Uint8Array([80, 75, 3, 4]), checksum: "sha256-output", warnings: [] })),
    slides: vi.fn(() => [{ id: "s1", hidden: false, elements: [] }]),
    deck: vi.fn(() => ({ slides: [{ id: "s1", elements: [] }], size: { cx: 12192000, cy: 6858000 } })),
    masterParts: vi.fn(() => [{ partPath: MASTER, kind: "master" as const, name: "Office Theme" }]),
    masterElements: vi.fn(() => [{ id: "m1", type: "text", label: "title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: "#112233" }]),
    release: vi.fn(async () => undefined),
  };
}

const files: PptxDocumentsTransport = {
  read: vi.fn(async () => new Uint8Array([80, 75, 3, 4])),
  upload: vi.fn(),
  commit: vi.fn(),
} as unknown as PptxDocumentsTransport;

afterEach(() => { seen.props = null; });

describe("web PPTX adapter masters wiring", () => {
  it("passes masterParts and masterElements to the mounted editor, bound to the live runtime session", async () => {
    const engine = engineDouble();
    const adapter = createPptxFormatAdapter({
      identity,
      session: { sessionId: "session", deploymentId: "dep", accountId: "acct", generation: 1 },
      runtime: engine,
      documents: files,
      capability,
      draftStore: {
        checkpointEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
        rebaseEncrypted: vi.fn(async () => ({ status: "stored", metadata: {} })),
        recoverEncrypted: vi.fn(async () => ({ status: "missing" as const })),
        deleteDurable: vi.fn(async () => undefined),
        list: vi.fn(async () => []),
        clearMemory: vi.fn(),
      } as unknown as IndexedDbDraftStore,
      keyProvider: {
        encrypt: vi.fn(),
        decrypt: vi.fn(),
        recover: vi.fn(),
        clearMemory: vi.fn(async () => undefined),
        registerCleanup: vi.fn(() => () => undefined),
      } as unknown as DraftKeyProvider,
    });

    const container = document.createElement("div");
    document.body.append(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let root!: Root;
    await act(async () => { root = createRoot(container); root.render(adapter.editorView as ReactElement); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(container.querySelector("[data-stub-editor]")).not.toBeNull();
    const props = seen.props as { masterParts: () => unknown[]; masterElements: (partPath: string) => unknown[] };
    expect(typeof props.masterParts).toBe("function");
    expect(typeof props.masterElements).toBe("function");
    expect(props.masterParts()).toEqual([{ partPath: MASTER, kind: "master", name: "Office Theme" }]);
    expect(props.masterElements(MASTER)).toEqual([{ id: "m1", type: "text", label: "title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: "#112233" }]);
    expect(engine.masterElements).toHaveBeenCalledWith("model-1", MASTER);

    await act(async () => { root.unmount(); });
    container.remove();
    await adapter.session.dispose();
    expect(props.masterParts()).toEqual([]);
  });
});
