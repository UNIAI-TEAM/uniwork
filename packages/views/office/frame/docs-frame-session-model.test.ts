import { describe, expect, it, vi } from "vitest";
import type { DocsFrameApi } from "@uniwork/core/office/docs-frame-api";

// Every shipped module has AI panels, so the `spec.ai === false` row needs a module spec of its own.
vi.mock("@uniwork/core/office/office-modules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/office/office-modules")>();
  return { ...actual, officeModuleSpec: (module: Parameters<typeof actual.officeModuleSpec>[0]) => ({ ...actual.officeModuleSpec(module), ai: module !== "pdf" }) };
});

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

describe("officeModuleCapabilities saveCopy grant (UNI-1872)", () => {
  const withSaveCopy = { saveCopy: vi.fn() } as unknown as DocsFrameApi;

  it("grants saveCopy: true only for docs when editable (not readonly, canEdit true) and api.saveCopy is present", () => {
    const caps = officeModuleCapabilities("docs", false, withSaveCopy, undefined, false, true);
    expect(caps.saveCopy).toBe(true);
  });

  it("omits saveCopy when readonly, when canEdit is false, when api.saveCopy is absent, or for any module other than docs", () => {
    expect("saveCopy" in officeModuleCapabilities("docs", true, withSaveCopy, undefined, false, true)).toBe(false);
    expect("saveCopy" in officeModuleCapabilities("docs", false, withSaveCopy, undefined, false, false)).toBe(false);
    expect("saveCopy" in officeModuleCapabilities("docs", false, api, undefined, false, true)).toBe(false);
    for (const mod of ["pdf", "markdown", "html", "slides", "sheets"] as const) {
      expect("saveCopy" in officeModuleCapabilities(mod, false, withSaveCopy, undefined, false, true)).toBe(false);
    }
  });
});

