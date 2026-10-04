import { describe, expect, it } from "vitest";
import type { HeaderFooterEdit } from "@uniwork/office-engine/pptx";
import {
  PPTX_HF_TEXT_MAX,
  buildHeaderFooterEdit,
  draftFromSettings,
  emptyHeaderFooterDraft,
  isHeaderFooterSettingsEmpty,
  normalizeHeaderFooterText,
  settingsFromDraft,
  validateHeaderFooterDraft,
} from "./headerfooter-model";

const value = <T>(r: { ok: true; value: T } | { ok: false; code: string }) => {
  if (!r.ok) throw new Error("expected ok, got " + r.code);
  return r.value;
};
const codeOf = (r: { ok: true } | { ok: false; code: string }) => (r.ok ? "" : r.code);

describe("emptyHeaderFooterDraft / draftFromSettings", () => {
  it("starts with nothing shown", () => {
    expect(emptyHeaderFooterDraft()).toEqual({ footer: "", slideNum: false, date: "", dateAuto: false });
  });

  it("seeds the fields from the deck settings and nulls the missing text", () => {
    expect(draftFromSettings({ footer: "hi", slideNum: true, date: null })).toEqual({
      footer: "hi",
      slideNum: true,
      date: "",
      dateAuto: false,
    });
    expect(draftFromSettings(null)).toEqual(emptyHeaderFooterDraft());
    expect(draftFromSettings(undefined)).toEqual(emptyHeaderFooterDraft());
  });
});

describe("normalizeHeaderFooterText", () => {
  it("turns empty and whitespace into the engine's null", () => {
    expect(normalizeHeaderFooterText("")).toBeNull();
    expect(normalizeHeaderFooterText("   ")).toBeNull();
    expect(normalizeHeaderFooterText("  page  ")).toBe("page");
  });
});

describe("validateHeaderFooterDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(value(validateHeaderFooterDraft({ footer: "a", slideNum: true, date: "b", dateAuto: true })).slideNum).toBe(true);
  });

  it("refuses a text past the cap with the engine's code", () => {
    expect(codeOf(validateHeaderFooterDraft({ footer: "x".repeat(PPTX_HF_TEXT_MAX + 1), slideNum: false, date: "", dateAuto: false }))).toBe("bad_hf_settings");
    expect(codeOf(validateHeaderFooterDraft({ footer: "", slideNum: false, date: "y".repeat(PPTX_HF_TEXT_MAX + 1), dateAuto: false }))).toBe("bad_hf_settings");
  });
});

describe("settingsFromDraft", () => {
  it("maps text to null and drops a lone auto flag", () => {
    expect(settingsFromDraft({ footer: " ", slideNum: false, date: "", dateAuto: true })).toEqual({
      footer: null,
      slideNum: false,
      date: null,
    });
    expect(settingsFromDraft({ footer: "f", slideNum: true, date: "2026-10-04", dateAuto: true })).toEqual({
      footer: "f",
      slideNum: true,
      date: "2026-10-04",
      dateAuto: true,
    });
  });

  it("keeps dateAuto only alongside a real date", () => {
    const s = settingsFromDraft({ footer: "", slideNum: false, date: "now", dateAuto: false });
    expect(s).not.toHaveProperty("dateAuto");
  });
});

describe("isHeaderFooterSettingsEmpty", () => {
  it("is true only when nothing is requested", () => {
    expect(isHeaderFooterSettingsEmpty({ footer: null, slideNum: false, date: null })).toBe(true);
    expect(isHeaderFooterSettingsEmpty({ footer: "f", slideNum: false, date: null })).toBe(false);
    expect(isHeaderFooterSettingsEmpty({ footer: null, slideNum: true, date: null })).toBe(false);
    expect(isHeaderFooterSettingsEmpty({ footer: null, slideNum: false, date: "d" })).toBe(false);
  });
});

describe("buildHeaderFooterEdit", () => {
  it("emits the apply_header_footer union member", () => {
    const edit = value(buildHeaderFooterEdit({ footer: "Confidential", slideNum: true, date: "2026-10-04", dateAuto: true }));
    expect(edit).toEqual({
      op: "apply_header_footer",
      settings: { footer: "Confidential", slideNum: true, date: "2026-10-04", dateAuto: true },
    });
    const typed: HeaderFooterEdit = edit;
    expect(typed.op).toBe("apply_header_footer");
  });

  it("omits dateAuto when the date is empty", () => {
    const edit = value(buildHeaderFooterEdit({ footer: "", slideNum: true, date: "", dateAuto: true }));
    expect(edit.settings).toEqual({ footer: null, slideNum: true, date: null });
  });

  it("refuses a no-op draft over an already-empty deck", () => {
    expect(codeOf(buildHeaderFooterEdit(emptyHeaderFooterDraft()))).toBe("no_hf_changes");
    expect(codeOf(buildHeaderFooterEdit(emptyHeaderFooterDraft(), { footer: null, slideNum: false, date: null }))).toBe("no_hf_changes");
  });

  it("allows an empty draft when the deck currently shows something (a clear)", () => {
    expect(value(buildHeaderFooterEdit(emptyHeaderFooterDraft(), { footer: "old", slideNum: true, date: null })).settings).toEqual({
      footer: null,
      slideNum: false,
      date: null,
    });
  });

  it("refuses a text past the cap before it reaches the op", () => {
    expect(codeOf(buildHeaderFooterEdit({ footer: "z".repeat(PPTX_HF_TEXT_MAX + 1), slideNum: false, date: "", dateAuto: false }))).toBe("bad_hf_settings");
  });
});