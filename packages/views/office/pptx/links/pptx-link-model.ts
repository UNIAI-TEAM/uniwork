/**
 * Hyperlink editor model (A6ui, UNI-927) - the pure half.
 *
 * The draft is the three shapes the vendored `setLink` guard accepts
 * (`requireLinkTarget`, pptx-ops registry.ts:352): a web address, a jump to a
 * slide, or a named show action. Validation here is the UI's pre-flight so a
 * button never sends a link the engine would refuse; the engine still re-checks
 * every field.
 *
 * Emitted edits are the REAL registered `set_link` kind, so the wire round
 * forwards them to the editor's edit channel unchanged.
 */
import {
  PPTX_NAMED_ACTIONS,
  type FindLinkEdit,
  type PptxLinkTarget,
  type PptxNamedAction,
} from "@uniwork/office-engine/pptx";

export type PptxSetLinkEdit = Extract<FindLinkEdit, { op: "set_link" }>;

export const PPTX_LINK_MODES = ["url", "slide", "action"] as const;
export type PptxLinkMode = (typeof PPTX_LINK_MODES)[number];

/** The placeholder a fresh URL field opens with, and the value the editor
 * refuses (an address with no host is not a link). */
export const PPTX_LINK_URL_PREFIX = "https://";

/** The named action a fresh action mode starts on. */
export const PPTX_DEFAULT_NAMED_ACTION: PptxNamedAction = "nextslide";

export interface PptxLinkDraft {
  mode: PptxLinkMode;
  url: string;
  slideIndex: number;
  action: PptxNamedAction;
}

/** Seed the fields from the element's current link (null = no link yet). */
export function draftFromLink(link: PptxLinkTarget | null | undefined): PptxLinkDraft {
  if (!link) {
    return { mode: "url", url: "", slideIndex: 0, action: PPTX_DEFAULT_NAMED_ACTION };
  }
  if (link.kind === "url") {
    return { mode: "url", url: link.url, slideIndex: 0, action: PPTX_DEFAULT_NAMED_ACTION };
  }
  if (link.kind === "slide") {
    return { mode: "slide", url: "", slideIndex: link.slideIndex, action: PPTX_DEFAULT_NAMED_ACTION };
  }
  return { mode: "action", url: "", slideIndex: 0, action: link.action };
}

export function normalizeUrl(url: string): string {
  return url.trim();
}

export type PptxLinkValidation =
  | { ok: true; link: PptxLinkTarget }
  | { ok: false; reasonKey: string };

/** Pre-flight the draft; the reason key is a full office.pptx.links.* i18n key
 * so the editor shows the same sentence the engine guard would. */
export function validateLinkDraft(draft: PptxLinkDraft, slideCount: number): PptxLinkValidation {
  if (draft.mode === "url") {
    const url = normalizeUrl(draft.url);
    if (!url || url === PPTX_LINK_URL_PREFIX || /\s/.test(url)) {
      return { ok: false, reasonKey: "office.pptx.links.invalid_url" };
    }
    return { ok: true, link: { kind: "url", url } };
  }
  if (draft.mode === "slide") {
    if (!Number.isInteger(draft.slideIndex) || draft.slideIndex < 0 || draft.slideIndex >= slideCount) {
      return { ok: false, reasonKey: "office.pptx.links.invalid_slide" };
    }
    return { ok: true, link: { kind: "slide", slideIndex: draft.slideIndex } };
  }
  if (!(PPTX_NAMED_ACTIONS as readonly string[]).includes(draft.action)) {
    return { ok: false, reasonKey: "office.pptx.links.invalid_action" };
  }
  return { ok: true, link: { kind: "action", action: draft.action } };
}

/** One validated link -> the `set_link` edit the editor's channel takes. */
export function buildSetLinkEdit(
  slideIndex: number,
  elementId: string,
  link: PptxLinkTarget,
): PptxSetLinkEdit {
  return { op: "set_link", slideIndex, elementId, link };
}

/** A one-line readout of the current link: an i18n key plus its `{{vars}}`. */
export interface PptxLinkSummary {
  key: string;
  vars?: Record<string, string>;
}

export function linkSummary(link: PptxLinkTarget | null | undefined): PptxLinkSummary {
  if (!link) return { key: "office.pptx.links.none" };
  if (link.kind === "url") return { key: "office.pptx.links.url_summary", vars: { url: link.url } };
  if (link.kind === "slide") {
    return { key: "office.pptx.links.slide_summary", vars: { index: String(link.slideIndex + 1) } };
  }
  return { key: `office.pptx.links.action.${link.action}` };
}