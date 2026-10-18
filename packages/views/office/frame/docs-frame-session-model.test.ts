import { describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";
import type { DocsFrameSessionOptions } from "./docs-frame-session-model";
import { composeFrameInit } from "./docs-frame-init";
import { frameCommentsLevel } from "./frame-comments-events";
import type { FrameCommentsBinding } from "./use-frame-comments";
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

  it("keeps saveCopy: true in composeFrameInit when a docs tab is view-only only because it is lockedOut or shelved", async () => {
    const { init, lockedOut } = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedEditable, source: false, editLock: { held: false, lockId: undefined, onLocked: vi.fn() }, limits, shelved: false,
    });
    expect(lockedOut).toBe(true);
    expect(init.capabilities).toMatchObject({ save: false, saveAs: false, download: false, saveCopy: true });

    const fromShelved = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedEditable, source: false, editLock: null, limits, shelved: true,
    });
    expect(fromShelved.init.capabilities).toMatchObject({ save: false, saveAs: false, download: false, saveCopy: true });
  });

  it("omits saveCopy for source sessions, readonly pages, viewers (can_edit: false), absent api.saveCopy, or non-docs modules", async () => {
    const fromSource = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "chat:s-1", name: "An", uid: "u-1",
      minted: { ...mintedEditable, can_edit: false, source_id: "chat:s-1", parent_kind: "chat_channel", parent_id: "c-1", readonly: true },
      source: true, editLock: null, limits, shelved: false,
    });
    expect("saveCopy" in fromSource.init.capabilities).toBe(false);

    const fromReadonly = await composeFrameInit({
      module: "docs", frameToken, current: { ...editableOptions, readonly: true }, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedEditable, source: false, editLock: null, limits, shelved: false,
    });
    expect("saveCopy" in fromReadonly.init.capabilities).toBe(false);

    const fromViewer = await composeFrameInit({
      module: "docs", frameToken, current: editableOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: { ...mintedEditable, can_edit: false }, source: false, editLock: null, limits, shelved: false,
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

describe("officeModuleCapabilities exportPdf grant (RFW3-2)", () => {
  it("grants exportPdf to slides without api.export, requires api.export for docs, and keeps sheets/pdf/markdown/html off", () => {
    expect(officeModuleCapabilities("slides", false, api).exportPdf).toBe(true);
    expect(officeModuleCapabilities("slides", true, api).exportPdf).toBe(true);
    expect(officeModuleCapabilities("docs", false, api).exportPdf).toBe(false);
    expect(officeModuleCapabilities("docs", false, { export: vi.fn() } as unknown as DocsFrameApi).exportPdf).toBe(true);
    for (const mod of ["pdf", "markdown", "html", "sheets"] as const) {
      expect(officeModuleCapabilities(mod, false, api).exportPdf).toBe(false);
    }
  });
});

describe("composeFrameInit readOnly profile (UNI-1876, UNI-1901)", () => {
  const fullCapabilitiesApi = { saveAs: vi.fn(), saveCopy: vi.fn(), export: vi.fn(), addAttachments: vi.fn(), uploadImage: vi.fn() } as unknown as DocsFrameApi;
  const frameToken = { token: "tok-1", tokenExpiresAt: Date.now() + 60_000 };
  const limits = { upload_max_bytes: 50 * 1024 * 1024, save_warn_ratio: 0.9 };
  const mintedFor = (module: "docs" | "pdf" | "markdown" | "html" | "slides" | "sheets", canEdit: boolean) => ({
    token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 60_000).toISOString(), expires_in: 60,
    document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module,
  });
  const baseOptions: DocsFrameSessionOptions = {
    iframeRef: { current: null }, frameOrigin: "https://uniwork.test", api: fullCapabilitiesApi, wsId: "ws-1",
    fileRef: { kind: "document", id: "doc-1" }, readonly: false, locale: "vi", theme: "light", onError: vi.fn(),
  };

  it("sends no profile for editors or lockedOut tabs, while lockedOut keeps save: false, saveCopy: true, and commentsLevel", async () => {
    for (const mod of ["docs", "pdf", "markdown", "html", "slides", "sheets"] as const) {
      const editor = await composeFrameInit({
        module: mod, frameToken, current: baseOptions, doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor(mod, true), source: false, editLock: { held: true, lockId: "L1", onLocked: vi.fn() }, limits,
      });
      expect("profile" in editor.init).toBe(false);
      expect(editor.init.capabilities).toMatchObject({ save: true, saveAs: true });
    }

    const augmentInit = vi.fn((init, session: { canEdit: boolean | undefined; readonly: boolean }) => ({
      ...init,
      commentsLevel: (session.readonly ? "view" : "edit") as "view" | "edit",
    }));
    const lockedOut = await composeFrameInit({
      module: "docs", frameToken,
      current: { ...baseOptions, comments: { augmentInit, api: {} as never, attach: vi.fn(), detach: vi.fn() } },
      doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedFor("docs", true), source: false, editLock: { held: false, lockId: undefined, onLocked: vi.fn() }, limits,
    });
    expect("profile" in lockedOut.init).toBe(false);
    expect(lockedOut.init.capabilities).toMatchObject({ save: false, saveAs: false, saveCopy: true });
    expect(lockedOut.init.commentsLevel).toBe("edit");
  });

  it("sends profile: 'readOnly' and withholds save, saveAs, and saveCopy for source, viewer (can_edit: false), and readonly across all six modules", async () => {
    for (const mod of ["docs", "pdf", "markdown", "html", "slides", "sheets"] as const) {
      const fromSource = await composeFrameInit({
        module: mod, frameToken, current: baseOptions, doc: "chat:s-1", name: "An", uid: "u-1",
        minted: { ...mintedFor(mod, false), source_id: "chat:s-1", parent_kind: "chat_channel", parent_id: "c-1", readonly: true },
        source: true, editLock: null, limits,
      });
      expect(fromSource.init.profile).toBe("readOnly");
      expect(fromSource.init.capabilities).toMatchObject({ save: false, saveAs: false });
      expect("saveCopy" in fromSource.init.capabilities).toBe(false);

      const fromViewer = await composeFrameInit({
        module: mod, frameToken, current: baseOptions, doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor(mod, false), source: false, editLock: null, limits,
      });
      expect(fromViewer.init.profile).toBe("readOnly");
      expect(fromViewer.init.capabilities).toMatchObject({ save: false, saveAs: false });
      expect("saveCopy" in fromViewer.init.capabilities).toBe(false);

      const fromReadonly = await composeFrameInit({
        module: mod, frameToken, current: { ...baseOptions, readonly: true }, doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor(mod, true), source: false, editLock: null, limits,
      });
      expect(fromReadonly.init.profile).toBe("readOnly");
      expect(fromReadonly.init.capabilities).toMatchObject({ save: false, saveAs: false });
      expect("saveCopy" in fromReadonly.init.capabilities).toBe(false);
    }
  });

  it("sends profile: 'readOnly' for a shelved document even when the minted token says can_edit, while saveCopy stays granted (ARCHIVE-01)", async () => {
    const { init } = await composeFrameInit({
      module: "docs", frameToken, current: baseOptions, doc: "doc-1", name: "An", uid: "u-1",
      minted: mintedFor("docs", true), source: false, editLock: null, limits, shelved: true,
    });
    expect(init.profile).toBe("readOnly");
    expect(init.capabilities).toMatchObject({ save: false, saveAs: false });
    // copyRefused does not include shelved (the server's CopyDocument accepts a shelved
    // source), and the token still says can_edit: the copy capability survives.
    expect(init.capabilities).toMatchObject({ saveCopy: true });
  });

});

describe("composeFrameInit readOnly profile and the comment level (RFH-1)", () => {
  const fullApi = { saveAs: vi.fn(), saveCopy: vi.fn(), export: vi.fn(), addAttachments: vi.fn(), uploadImage: vi.fn() } as unknown as DocsFrameApi;
  const frameToken = { token: "tok-1", tokenExpiresAt: Date.now() + 60_000 };
  const limits = { upload_max_bytes: 50 * 1024 * 1024, save_warn_ratio: 0.9 };
  const mintedFor = (module: "docs" | "sheets", canEdit: boolean) => ({
    token: "tok-1", token_type: "Bearer", expires_at: new Date(Date.now() + 60_000).toISOString(), expires_in: 60,
    document_id: "doc-1", workspace_id: "ws-1", organization_id: "org-1", can_edit: canEdit, module,
  });
  const baseOptions: DocsFrameSessionOptions = {
    iframeRef: { current: null }, frameOrigin: "https://uniwork.test", api: fullApi, wsId: "ws-1",
    fileRef: { kind: "document", id: "doc-1" }, readonly: false, locale: "vi", theme: "light", onError: vi.fn(),
  };
  // Mirrors the real binding (use-frame-comments.ts): commentsLevel comes from the same
  // `my_level` the session options carry, and its readonly flag is the init's readOnlyProfile.
  const commentsBinding = (myLevel: string | null | undefined): FrameCommentsBinding => ({
    augmentInit: (init, { canEdit, readonly }) => ({
      ...init,
      capabilities: { ...init.capabilities, comments: true },
      commentsLevel: frameCommentsLevel({ myLevel, readonly, canEdit }),
    }),
    api: {} as FrameCommentsBinding["api"],
    attach: vi.fn(),
    detach: vi.fn(),
  });
  const optionsWithLevel = (myLevel: string | null | undefined) =>
    Object.assign({}, baseOptions, { myLevel, comments: commentsBinding(myLevel) });

  it("keeps comments for a comment-level user (can_edit: false): no profile, commentsLevel 'comment', save/saveAs/saveCopy withheld, Docs and not", async () => {
    for (const mod of ["docs", "sheets"] as const) {
      const { init } = await composeFrameInit({
        module: mod, frameToken, current: optionsWithLevel("comment"), doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor(mod, false), source: false, editLock: null, limits,
      });
      expect("profile" in init).toBe(false);
      expect(init.commentsLevel).toBe("comment");
      expect(init.capabilities).toMatchObject({ comments: true, save: false, saveAs: false });
      expect("saveCopy" in init.capabilities).toBe(false);
    }
  });

  it("stays a viewer with can_edit: false for a view level, a level the client does not know, or none", async () => {
    for (const myLevel of ["view", "owner", "", null, undefined]) {
      const { init } = await composeFrameInit({
        module: "docs", frameToken, current: optionsWithLevel(myLevel), doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor("docs", false), source: false, editLock: null, limits,
      });
      expect(init.profile).toBe("readOnly");
      expect(init.commentsLevel).toBe("view");
      expect(init.capabilities).toMatchObject({ save: false, saveAs: false });
      expect("saveCopy" in init.capabilities).toBe(false);
    }
  });

  it("keeps comments for a comment-level user on a read-only host page (SVH-1): no profile, commentsLevel 'comment', save/saveAs/saveCopy withheld, Docs and not", async () => {
    // The real host passes readonly={!canEdit}, so a commenter arrives with readonly: true
    // as well as can_edit: false; the RFH-1 exemption must cover both signals.
    for (const mod of ["docs", "sheets"] as const) {
      const { init } = await composeFrameInit({
        module: mod, frameToken, current: { ...optionsWithLevel("comment"), readonly: true }, doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor(mod, false), source: false, editLock: null, limits,
      });
      expect("profile" in init).toBe(false);
      expect(init.commentsLevel).toBe("comment");
      expect(init.capabilities).toMatchObject({ comments: true, save: false, saveAs: false });
      expect("saveCopy" in init.capabilities).toBe(false);
    }
  });

  it("stays a viewer on a read-only host page for a view level, a level the client does not know, or none", async () => {
    for (const myLevel of ["view", "owner", "", null, undefined]) {
      const { init } = await composeFrameInit({
        module: "docs", frameToken, current: { ...optionsWithLevel(myLevel), readonly: true }, doc: "doc-1", name: "An", uid: "u-1",
        minted: mintedFor("docs", false), source: false, editLock: null, limits,
      });
      expect(init.profile).toBe("readOnly");
      expect(init.commentsLevel).toBe("view");
      expect(init.capabilities).toMatchObject({ save: false, saveAs: false });
      expect("saveCopy" in init.capabilities).toBe(false);
    }
  });

  it("keeps a source session read-only even at the comment level", async () => {
    const { init } = await composeFrameInit({
      module: "docs", frameToken, current: optionsWithLevel("comment"), doc: "chat:s-1", name: "An", uid: "u-1",
      minted: { ...mintedFor("docs", false), source_id: "chat:s-1", parent_kind: "chat_channel", parent_id: "c-1", readonly: true },
      source: true, editLock: null, limits,
    });
    expect(init.profile).toBe("readOnly");
    expect(init.commentsLevel).toBe("view");
  });
});

