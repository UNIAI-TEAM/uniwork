import { describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import { composeFrameInit } from "./docs-frame-init";
// Every shipped module has AI panels, so the `spec.ai === false` row needs a module spec of its own.
vi.mock("@uniwork/core/office/office-modules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/office/office-modules")>();
  return { ...actual, officeModuleSpec: (module: Parameters<typeof actual.officeModuleSpec>[0]) => ({ ...actual.officeModuleSpec(module), ai: module !== "pdf" }) };
});

// Loaded after vi.mock so the mocked officeModuleSpec is active.
const { officeModuleCapabilities } = await import("./docs-frame-session-model");

const api = {} as DocsFrameApi;
const all = { ai: true, web_search: true, image_search: true, image_generation: true, uniwork_ai: true };

describe("officeModuleCapabilities AI grant", () => {
  it("reads uniworkAi apart from ai, and gives the cloud tools to either", () => {
    expect(officeModuleCapabilities("docs", false, api, { ai: false, web_search: true, image_search: false, image_generation: true, uniwork_ai: true }))
      .toMatchObject({ ai: false, uniworkAi: true, webSearch: true, imageSearch: false, imageGeneration: true });
    expect(officeModuleCapabilities("docs", false, api, { ai: true, web_search: true, image_search: true, image_generation: false }))
      .toMatchObject({ ai: true, uniworkAi: false, webSearch: true, imageSearch: true, imageGeneration: false });
  });

  it("keeps uniworkAi and the cloud tools off with no grant, an absent uniwork_ai, or neither AI", () => {
    expect(officeModuleCapabilities("docs", false, api)).toMatchObject({ ai: false, uniworkAi: false, webSearch: false, imageSearch: false, imageGeneration: false });
    expect(officeModuleCapabilities("docs", false, api, { ai: true, web_search: false, image_search: false, image_generation: false }).uniworkAi).toBe(false);
    expect(officeModuleCapabilities("docs", false, api, { ai: false, web_search: true, image_search: true, image_generation: true, uniwork_ai: false }))
      .toMatchObject({ uniworkAi: false, webSearch: false, imageSearch: false, imageGeneration: false });
  });

  it("grants nothing AI to a module whose spec has no AI panels", () => {
    expect(officeModuleCapabilities("pdf", false, api, all)).toMatchObject({ ai: false, uniworkAi: false, webSearch: false, imageSearch: false, imageGeneration: false });
  });

  it("keeps UniWork AI for a read-only viewer, who still cannot save", () => {
    expect(officeModuleCapabilities("docs", true, api, all)).toMatchObject({ uniworkAi: true, save: false });
  });
});

describe("officeModuleCapabilities and composeFrameInit saveCopy grant (UNI-1872, UNI-1892)", () => {
  const withSaveCopy = { saveCopy: vi.fn() } as unknown as DocsFrameApi;
  const frameToken = { token: "tok-1", tokenExpiresAt: Date.now() + 60_000 };
  const limits = { upload_max_bytes: 50 * 1024 * 1024, save_warn_ratio: 0.9 };
  const mintedEditable = {
    token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 60_000).toISOString(), expires_in: 60,
    document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: true, module: "docs" as const,
  };
  const editableOptions: DocsFrameSessionOptions = {
    iframeRef: { current: null }, frameOrigin: "https://uniwork.test", api: withSaveCopy, wsId: "ws-1",
    fileRef: { kind: "document", id: "doc-1" }, readonly: false, locale: "vi", theme: "light", onError: vi.fn(),
  };

  it("grants saveCopy: true for docs when editable (not readonly, canEdit true) and api.saveCopy is present", () => {
    const caps = officeModuleCapabilities("docs", false, withSaveCopy, undefined, false, true);
    expect(caps.saveCopy).toBe(true);
  });

  it("keeps saveCopy: true in composeFrameInit when a docs tab is view-only only because it is lockedOut", async () => {
    const { init, lockedOut } = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedEditable, source: false, editLock: { held: false, lockId: undefined, onLocked: vi.fn() }, limits,
    });
    expect(lockedOut).toBe(true);
    expect(init.capabilities).toMatchObject({ save: false, saveAs: false, download: false, saveCopy: true });
  });

  it("omits saveCopy for source sessions, readonly pages, viewers (can_edit: false), absent api.saveCopy, or non-docs modules", async () => {
    const fromSource = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "chat:s-1", name: "An", uid: "u-1",
      minted: { ...mintedEditable, can_edit: false, source_id: "chat:s-1", parent_kind: "chat_channel", parent_id: "c-1", readonly: true },
      source: true, editLock: null, limits,
    });
    expect("saveCopy" in fromSource.init.capabilities).toBe(false);

    const fromReadonly = await composeFrameInit({
      module: "docs", frameToken, current: { ...editableOptions, readonly: true }, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedEditable, source: false, editLock: null, limits,
    });
    expect("saveCopy" in fromReadonly.init.capabilities).toBe(false);

    const fromViewer = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: { ...mintedEditable, can_edit: false }, source: false, editLock: null, limits,
    });
    expect("saveCopy" in fromViewer.init.capabilities).toBe(false);

    expect("saveCopy" in officeModuleCapabilities("docs", true, withSaveCopy, undefined, false, true)).toBe(false);
    expect("saveCopy" in officeModuleCapabilities("docs", false, withSaveCopy, undefined, false, false)).toBe(false);
    expect("saveCopy" in officeModuleCapabilities("docs", false, api, undefined, false, true)).toBe(false);
    for (const mod of ["pdf", "markdown", "html", "slides", "sheets"] as const) {
      expect("saveCopy" in officeModuleCapabilities(mod, false, withSaveCopy, undefined, false, true)).toBe(false);
    }
  });
});

