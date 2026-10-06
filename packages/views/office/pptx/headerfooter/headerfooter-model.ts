/**
 * Header/footer panel model (B7ui, UNI-927) - the pure half of the
 * Header & Footer panel.
 *
 * Everything here is data or a pure function, so the panel stays presentational
 * and the contract the serialized UI-wire round binds is testable without React.
 *
 * Binding contract (committed B7e engine half,
 * `packages/office-engine/src/pptx/edits/headerfooter-edits.ts`): this panel
 * emits exactly that module's `apply_header_footer` union member
 *   { op: "apply_header_footer", settings: PptxHeaderFooterSettings }
 * whose `settings` mirror the vendored HeaderFooterOptions one-for-one
 * (pptx-engine/src/headerfooter.ts:15-24):
 *   footer?:   string | null   (null/"" = no footer)
 *   slideNum?: boolean         (show the slide number)
 *   date?:     string | null   (fixed date text)
 *   dateAuto?: boolean         (dynamic datetime field)
 *
 * The op is deck-level (no slide target): `applyHeaderFooter` rewrites the
 * dt/ftr/sldNum placeholders on every slide, so the panel never picks a target.
 *
 * Refusals mirror the engine builder's own guard so the panel can explain a
 * refusal BEFORE an edit reaches the session: the same stable code
 * (`bad_hf_settings`) and the same message shape a `PptxEngineError` carries,
 * plus `no_hf_changes` for a request that would leave the deck exactly as it is
 * (the vendored op throws "nothing changed (same settings as before)",
 * slide-ops.ts:612-613).
 */
import type { HeaderFooterEdit, PptxHeaderFooterSettings } from "@uniwork/office-engine/pptx";

/** The settings shape this panel emits (re-exported for the wire round). */
export type { PptxHeaderFooterSettings };

/** Field length cap, so a paste of a whole document cannot reach the op. */
export const PPTX_HF_TEXT_MAX = 255;

/** The panel's editable draft: every field is the primitive its input owns. */
export interface PptxHeaderFooterDraft {
  footer: string;
  slideNum: boolean;
  date: string;
  dateAuto: boolean;
}

/** The engine builder's refusal codes this model can produce. */
export type PptxHeaderFooterRefusalCode = "bad_hf_settings" | "no_hf_changes";

/** A refusal in the shape a `PptxEngineError` carries (code + message). */
export interface PptxHeaderFooterRefusal {
  code: PptxHeaderFooterRefusalCode;
  message: string;
}

/** Result of a validated build: the edit, or the engine's refusal shape. */
export type PptxHeaderFooterValidation<T> =
  | { ok: true; value: T }
  | ({ ok: false } & PptxHeaderFooterRefusal);

const refuse = <T>(code: PptxHeaderFooterRefusalCode, message: string): PptxHeaderFooterValidation<T> => ({
  ok: false,
  code,
  message,
});

/** A fresh draft: nothing shown, so applying it clears the placeholders. */
export function emptyHeaderFooterDraft(): PptxHeaderFooterDraft {
  return { footer: "", slideNum: false, date: "", dateAuto: false };
}

/** Draft seed from the deck's current settings (dialog echo-back). */
export function draftFromSettings(
  settings: PptxHeaderFooterSettings | null | undefined,
): PptxHeaderFooterDraft {
  if (!settings) return emptyHeaderFooterDraft();
  return {
    footer: settings.footer ?? "",
    slideNum: settings.slideNum === true,
    date: settings.date ?? "",
    dateAuto: settings.dateAuto === true,
  };
}

/** "" and whitespace-only mean "no footer/date" - the engine's null. */
export function normalizeHeaderFooterText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Field validation: both texts are strings within the cap, both flags boolean. */
export function validateHeaderFooterDraft(
  draft: PptxHeaderFooterDraft,
): PptxHeaderFooterValidation<PptxHeaderFooterDraft> {
  if (typeof draft.footer !== "string") return refuse("bad_hf_settings", '"footer" must be a string');
  if (typeof draft.date !== "string") return refuse("bad_hf_settings", '"date" must be a string');
  if (typeof draft.slideNum !== "boolean") return refuse("bad_hf_settings", '"slideNum" must be a boolean');
  if (typeof draft.dateAuto !== "boolean") return refuse("bad_hf_settings", '"dateAuto" must be a boolean');
  if (draft.footer.length > PPTX_HF_TEXT_MAX) {
    return refuse("bad_hf_settings", "footer text is too long (max " + PPTX_HF_TEXT_MAX + ")");
  }
  if (draft.date.length > PPTX_HF_TEXT_MAX) {
    return refuse("bad_hf_settings", "date text is too long (max " + PPTX_HF_TEXT_MAX + ")");
  }
  return { ok: true, value: draft };
}

/**
 * Draft -> engine settings. An empty date drops `dateAuto` with it: the
 * vendored applyHeaderFooter only writes the date placeholder when `date` is
 * truthy (headerfooter.ts:88-108), so a lone `dateAuto` could never change the
 * deck and would make the op report "nothing changed".
 */
export function settingsFromDraft(draft: PptxHeaderFooterDraft): PptxHeaderFooterSettings {
  const footer = normalizeHeaderFooterText(draft.footer);
  const date = normalizeHeaderFooterText(draft.date);
  return {
    footer,
    slideNum: draft.slideNum,
    date,
    ...(date !== null && draft.dateAuto ? { dateAuto: true } : {}),
  };
}

/** True when the settings ask the deck for nothing at all. */
export function isHeaderFooterSettingsEmpty(settings: PptxHeaderFooterSettings): boolean {
  return !settings.footer && settings.slideNum !== true && !settings.date;
}

/**
 * One validated draft -> the `apply_header_footer` edit. `current` (the deck's
 * settings when the panel opened) lets the model refuse the no-op case the
 * vendored op would reject: an empty draft over an already-empty deck.
 */
export function buildHeaderFooterEdit(
  draft: PptxHeaderFooterDraft,
  current?: PptxHeaderFooterSettings | null,
): PptxHeaderFooterValidation<HeaderFooterEdit> {
  const checked = validateHeaderFooterDraft(draft);
  if (!checked.ok) return checked;
  const settings = settingsFromDraft(draft);
  if (isHeaderFooterSettingsEmpty(settings) && isHeaderFooterSettingsEmpty(settingsFromDraft(draftFromSettings(current)))) {
    return refuse("no_hf_changes", "header/footer needs a footer, a date or the slide number");
  }
  return { ok: true, value: { op: "apply_header_footer", settings } };
}