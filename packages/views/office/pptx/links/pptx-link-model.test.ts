// A6ui (UNI-927) - pure hyperlink model tests.
//
// The three link shapes and the exact `set_link` edits the editor emits are
// pinned here without a DOM, including the removal case (a null link).
import { describe, expect, it } from "vitest";
import { PPTX_NAMED_ACTIONS } from "@uniwork/office-engine/pptx";
import {
  PPTX_DEFAULT_NAMED_ACTION,
  PPTX_LINK_URL_PREFIX,
  buildSetLinkEdit,
  draftFromLink,
  linkSummary,
  normalizeUrl,
  validateLinkDraft,
} from "./pptx-link-model";

describe("draftFromLink", () => {
  it("opens on a fresh url draft when the element has no link", () => {
    expect(draftFromLink(null)).toEqual({
      mode: "url",
      url: "",
      slideIndex: 0,
      action: PPTX_DEFAULT_NAMED_ACTION,
    });
  });

  it("seeds each link shape onto its own mode", () => {
    expect(draftFromLink({ kind: "url", url: "https://a.test" }).mode).toBe("url");
    expect(draftFromLink({ kind: "url", url: "https://a.test" }).url).toBe("https://a.test");
    expect(draftFromLink({ kind: "slide", slideIndex: 3 })).toEqual({
      mode: "slide",
      url: "",
      slideIndex: 3,
      action: PPTX_DEFAULT_NAMED_ACTION,
    });
    expect(draftFromLink({ kind: "action", action: "endshow" }).action).toBe("endshow");
  });
});

describe("validateLinkDraft", () => {
  it("accepts a trimmed web address", () => {
    const result = validateLinkDraft({ mode: "url", url: "  https://a.test  ", slideIndex: 0, action: "nextslide" }, 3);
    expect(result).toEqual({ ok: true, link: { kind: "url", url: "https://a.test" } });
  });

  it("refuses an empty or placeholder address", () => {
    const draft = { mode: "url" as const, url: "", slideIndex: 0, action: "nextslide" as const };
    expect(validateLinkDraft(draft, 3)).toEqual({ ok: false, reasonKey: "office.pptx.links.invalid_url" });
    expect(validateLinkDraft({ ...draft, url: PPTX_LINK_URL_PREFIX }, 3).ok).toBe(false);
    expect(validateLinkDraft({ ...draft, url: "two words" }, 3).ok).toBe(false);
  });

  it("accepts an in-range slide and refuses one outside the deck", () => {
    const draft = { mode: "slide" as const, url: "", slideIndex: 1, action: "nextslide" as const };
    expect(validateLinkDraft(draft, 3)).toEqual({ ok: true, link: { kind: "slide", slideIndex: 1 } });
    expect(validateLinkDraft({ ...draft, slideIndex: 3 }, 3).ok).toBe(false);
    expect(validateLinkDraft({ ...draft, slideIndex: -1 }, 3).ok).toBe(false);
  });

  it("accepts every named action", () => {
    for (const action of PPTX_NAMED_ACTIONS) {
      const draft = { mode: "action" as const, url: "", slideIndex: 0, action };
      expect(validateLinkDraft(draft, 1)).toEqual({ ok: true, link: { kind: "action", action } });
    }
  });
});

describe("buildSetLinkEdit", () => {
  it("builds the exact set_link edit", () => {
    expect(buildSetLinkEdit(2, "t7", { kind: "url", url: "https://a.test" })).toEqual({
      op: "set_link",
      slideIndex: 2,
      elementId: "t7",
      link: { kind: "url", url: "https://a.test" },
    });
  });

  it("carries a null link to remove the hyperlink", () => {
    expect(buildSetLinkEdit(0, "t1", null)).toEqual({
      op: "set_link",
      slideIndex: 0,
      elementId: "t1",
      link: null,
    });
  });
});

describe("linkSummary and normalizeUrl", () => {
  it("names the current link, including the none case", () => {
    expect(linkSummary(null)).toEqual({ key: "office.pptx.links.none" });
    expect(linkSummary({ kind: "url", url: "https://a.test" })).toEqual({
      key: "office.pptx.links.url_summary",
      vars: { url: "https://a.test" },
    });
    expect(linkSummary({ kind: "slide", slideIndex: 1 })).toEqual({
      key: "office.pptx.links.slide_summary",
      vars: { index: "2" },
    });
    expect(linkSummary({ kind: "action", action: "endshow" }).key).toBe("office.pptx.links.action.endshow");
  });

  it("trims whitespace only", () => {
    expect(normalizeUrl("  https://a.test  ")).toBe("https://a.test");
  });
});
