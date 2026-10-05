/**
 * Media panel i18n (B8ui, UNI-927) - the panel's own dictionary.
 *
 * The shared locale files (`packages/core/i18n/locales/{en,vi}.json`) are shared
 * by every worker of this lane, so this panel keeps its strings here: one plain
 * `{ "office.pptx.media.<key>": { en, vi } }` map. Every JSX string in the
 * panel calls `t()` with the exact key listed below, so the wire round only has
 * to copy these entries into the two locale files (no key rewriting).
 *
 * Key parity is a hard rule: both locales exist for every key, both carry the
 * same `{{vars}}`, and no copy is blank - `media-i18n.test.ts` pins all three.
 * Vietnamese copy is written with \uXXXX escapes so the file survives any
 * lossy authoring channel (the F1/F11 class the lane already hit once).
 */
export interface PptxMediaI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.media.*` key this panel renders, in source order. */
export const PPTX_MEDIA_I18N: Readonly<Record<string, PptxMediaI18nEntry>> = {
  "office.pptx.media.title": { en: "Media", vi: "Ph\u01b0\u01a1ng ti\u1ec7n" },
  "office.pptx.media.loading": { en: "Loading the media tools...", vi: "\u0110ang t\u1ea3i c\u00f4ng c\u1ee5 ph\u01b0\u01a1ng ti\u1ec7n..." },
  "office.pptx.media.empty": { en: "Select a slide to insert media", vi: "Ch\u1ecdn m\u1ed9t trang chi\u1ebfu \u0111\u1ec3 ch\u00e8n ph\u01b0\u01a1ng ti\u1ec7n" },
  "office.pptx.media.busy": { en: "Applying...", vi: "\u0110ang \u00e1p d\u1ee5ng..." },
  "office.pptx.media.error_title": { en: "The media change could not be applied", vi: "Kh\u00f4ng th\u1ec3 \u00e1p d\u1ee5ng thay \u0111\u1ed5i ph\u01b0\u01a1ng ti\u1ec7n" },
  "office.pptx.media.error_hint": { en: "The document was not changed. {{message}}", vi: "T\u00e0i li\u1ec7u ch\u01b0a b\u1ecb thay \u0111\u1ed5i. {{message}}" },
  "office.pptx.media.unbound": { en: "Media changes are not connected to this editor yet.", vi: "Thay \u0111\u1ed5i ph\u01b0\u01a1ng ti\u1ec7n ch\u01b0a \u0111\u01b0\u1ee3c k\u1ebft n\u1ed1i v\u1edbi tr\u00ecnh so\u1ea1n th\u1ea3o n\u00e0y." },
  "office.pptx.media.readonly": { en: "This presentation is read-only.", vi: "B\u1ea3n tr\u00ecnh b\u00e0y n\u00e0y ch\u1ec9 \u0111\u1ecdc." },
  "office.pptx.media.no_slide": { en: "Select a slide to insert media.", vi: "Ch\u1ecdn m\u1ed9t trang chi\u1ebfu \u0111\u1ec3 ch\u00e8n ph\u01b0\u01a1ng ti\u1ec7n." },
  "office.pptx.media.video.insert": { en: "Video", vi: "Video" },
  "office.pptx.media.video.hint": { en: "Insert an audio or video file from this device.", vi: "Ch\u00e8n t\u1ec7p \u00e2m thanh ho\u1eb7c video t\u1eeb thi\u1ebft b\u1ecb n\u00e0y." },
  "office.pptx.media.audio.insert": { en: "Audio", vi: "\u00c2m thanh" },
  "office.pptx.media.audio.hint": { en: "Insert an audio file from this device.", vi: "Ch\u00e8n t\u1ec7p \u00e2m thanh t\u1eeb thi\u1ebft b\u1ecb n\u00e0y." },
  "office.pptx.media.replace": { en: "Replace media", vi: "Thay ph\u01b0\u01a1ng ti\u1ec7n" },
  "office.pptx.media.replace_hint": { en: "Swap the selected element's poster image.", vi: "\u0110\u1ed5i \u1ea3nh xem tr\u01b0\u1edbc c\u1ee7a ph\u1ea7n t\u1eed \u0111ang ch\u1ecdn." },
  "office.pptx.media.no_target": { en: "Select an audio or video element on the slide first.", vi: "Ch\u1ecdn m\u1ed9t ph\u1ea7n t\u1eed \u00e2m thanh ho\u1eb7c video tr\u00ean trang chi\u1ebfu tr\u01b0\u1edbc." },
  "office.pptx.media.remove": { en: "Remove media", vi: "X\u00f3a ph\u01b0\u01a1ng ti\u1ec7n" },
  "office.pptx.media.remove_hint": { en: "Delete the selected media element from the slide.", vi: "X\u00f3a ph\u1ea7n t\u1eed ph\u01b0\u01a1ng ti\u1ec7n \u0111ang ch\u1ecdn kh\u1ecfi trang chi\u1ebfu." },
  "office.pptx.media.unsupported": { en: "{{ext}} is not a supported media format.", vi: "{{ext}} kh\u00f4ng ph\u1ea3i \u0111\u1ecbnh d\u1ea1ng ph\u01b0\u01a1ng ti\u1ec7n \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3." },
  "office.pptx.media.read_failed": { en: "The file could not be read.", vi: "Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c t\u1ec7p." },
  "office.pptx.media.poster_label": { en: "Poster frame", vi: "\u1ea2nh xem tr\u01b0\u1edbc" },
  "office.pptx.media.poster_choose": { en: "Choose a poster image", vi: "Ch\u1ecdn \u1ea3nh xem tr\u01b0\u1edbc" },
  "office.pptx.media.poster_none": { en: "No poster chosen; the engine generates a placeholder.", vi: "Ch\u01b0a ch\u1ecdn \u1ea3nh xem tr\u01b0\u1edbc; b\u1ed9 m\u00e1y s\u1ebd t\u1ea1o \u1ea3nh t\u1ea1m." },
  "office.pptx.media.poster_selected": { en: "Poster: {{name}}", vi: "\u1ea2nh xem tr\u01b0\u1edbc: {{name}}" },
  "office.pptx.media.poster_unsupported": { en: "{{ext}} is not a supported poster image.", vi: "{{ext}} kh\u00f4ng ph\u1ea3i \u1ea3nh xem tr\u01b0\u1edbc \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3." },
} as const;

/** Locales this panel ships copy for. */
export type PptxMediaLocale = "en" | "vi";

/** Flat map -> the nested dictionary i18next expects (dotted keys are levels). */
export function mediaPanelDictionary(locale: PptxMediaLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_MEDIA_I18N)) {
    const parts = key.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next !== "object" || next === null) node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] as string] = entry[locale];
  }
  return root;
}

/** `{{var}}` names used by a copy string, sorted - parity checks use it. */
export function pptxMediaI18nVars(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort();
}