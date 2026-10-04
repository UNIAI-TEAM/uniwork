/**
 * Format panel i18n (A4ui, UNI-927) - the panel's own dictionary.
 *
 * Same self-contained contract as the Design / Insert / Animations panels: the
 * SHARED locale files (packages/core/i18n/locales/{en,vi}.json) belong to the
 * chrome worker, so this panel keeps every string it renders in its own file -
 * a flat map of the exact `office.pptx.format.*` keys the components pass to
 * `t()`, each with its `en` and `vi` copy. The serialized UI-wire round copies
 * these entries into the shared locales (the `formatPanelDictionary` helper
 * below produces the nested shape those files use).
 *
 * Key parity is a hard rule: both locales exist for every key, every key a
 * component can produce (fill modes, dash names, anchors, autofit modes, align
 * modes) has an entry here, and both locales carry the same `{{vars}}` -
 * `format-i18n.test.ts` proves it against the model's vocabularies.
 */

/** One key's copy in both supported locales. */
export interface PptxFormatI18nEntry {
  en: string;
  vi: string;
}

/** Every `office.pptx.format.*` key this panel renders, in source order. */
export const PPTX_FORMAT_I18N: Readonly<Record<string, PptxFormatI18nEntry>> = {
  "office.pptx.format.title": { en: "Format", vi: "Äá»‹nh dáº¡ng" },
  "office.pptx.format.sections_label": { en: "Format tools", vi: "CÃ´ng cá»¥ Ä‘á»‹nh dáº¡ng" },
  "office.pptx.format.loading": { en: "Loading the format tools...", vi: "Äang táº£i cÃ´ng cá»¥ Ä‘á»‹nh dáº¡ng..." },
  "office.pptx.format.busy": { en: "Applying...", vi: "Äang Ã¡p dá»¥ng..." },
  "office.pptx.format.empty": {
    en: "Select an element to format it",
    vi: "Chá»n má»™t Ä‘á»‘i tÆ°á»£ng Ä‘á»ƒ Ä‘á»‹nh dáº¡ng",
  },
  "office.pptx.format.unbound": {
    en: "Format changes are not connected to this editor yet.",
    vi: "Thay Ä‘á»•i Ä‘á»‹nh dáº¡ng chÆ°a Ä‘Æ°á»£c káº¿t ná»‘i vá»›i trÃ¬nh soáº¡n tháº£o nÃ y.",
  },
  "office.pptx.format.readonly": { en: "This presentation is read-only.", vi: "Báº£n trÃ¬nh bÃ y nÃ y chá»‰ Ä‘á»c." },
  "office.pptx.format.error_title": {
    en: "The format change could not be applied",
    vi: "KhÃ´ng thá»ƒ Ã¡p dá»¥ng thay Ä‘á»•i Ä‘á»‹nh dáº¡ng",
  },
  "office.pptx.format.error_hint": {
    en: "The document was not changed. {{message}}",
    vi: "TÃ i liá»‡u chÆ°a bá»‹ thay Ä‘á»•i. {{message}}",
  },
  "office.pptx.format.invalid_color": { en: "Enter a color as #RRGGBB.", vi: "Nháºp mÃ u theo dáº¡ng #RRGGBB." },
  "office.pptx.format.invalid_number": { en: "Enter a number greater than 0.", vi: "Nháºp má»™t sá»‘ lá»›n hÆ¡n 0." },
  "office.pptx.format.invalid_number_zero": { en: "Enter a number of 0 or more.", vi: "Nháºp má»™t sá»‘ tá»« 0 trá»Ÿ lÃªn." },

  // Fill
  "office.pptx.format.fill_label": { en: "Fill", vi: "MÃ u ná»n" },
  "office.pptx.format.fill.solid": { en: "Solid fill", vi: "MÃ u Ä‘Æ¡n" },
  "office.pptx.format.fill.gradient": { en: "Gradient fill", vi: "Chuyá»ƒn sáº¯c" },
  "office.pptx.format.fill.none": { en: "No fill", vi: "KhÃ´ng cÃ³ mÃ u ná»n" },
  "office.pptx.format.fill_color": { en: "Fill color", vi: "MÃ u ná»n" },
  "office.pptx.format.gradient_from": { en: "Gradient start color", vi: "MÃ u báº¯t Ä‘áº§u" },
  "office.pptx.format.gradient_to": { en: "Gradient end color", vi: "MÃ u káº¿t thÃºc" },
  "office.pptx.format.gradient_angle": { en: "Gradient angle in degrees", vi: "GÃ³c chuyá»ƒn sáº¯c (Ä‘á»™)" },
  "office.pptx.format.gradient_radial": { en: "Radial gradient", vi: "Chuyá»ƒn sáº¯c toáº£ trÃ²n" },

  // Line
  "office.pptx.format.line_label": { en: "Line", vi: "ÄÆ°á»ng viá»n" },
  "office.pptx.format.line.none": { en: "No outline", vi: "KhÃ´ng cÃ³ Ä‘Æ°á»ng viá»n" },
  "office.pptx.format.line.solid": { en: "Outline", vi: "ÄÆ°á»ng viá»n" },
  "office.pptx.format.line_color": { en: "Outline color", vi: "MÃ u Ä‘Æ°á»ng viá»n" },
  "office.pptx.format.line_width": { en: "Outline width in points", vi: "Äá»™ dÃ y Ä‘Æ°á»ng viá»n (Ä‘iá»ƒm)" },
  "office.pptx.format.line_dash": { en: "Dash style", vi: "Kiá»ƒu nÃ©t" },
  "office.pptx.format.dash.solid": { en: "Solid", vi: "Liá»n" },
  "office.pptx.format.dash.dash": { en: "Dash", vi: "Gáº¡ch" },
  "office.pptx.format.dash.dot": { en: "Dot", vi: "Cháº¥m" },
  "office.pptx.format.dash.lgDash": { en: "Long dash", vi: "Gáº¡ch dÃ i" },
  "office.pptx.format.dash.lgDashDot": { en: "Long dash dot", vi: "Gáº¡ch dÃ i cháº¥m" },
  "office.pptx.format.dash.lgDashDotDot": { en: "Long dash dot dot", vi: "Gáº¡ch dÃ i hai cháº¥m" },
  "office.pptx.format.dash.sysDash": { en: "System dash", vi: "Gáº¡ch há»‡ thá»‘ng" },
  "office.pptx.format.dash.sysDot": { en: "System dot", vi: "Cháº¥m há»‡ thá»‘ng" },

  // Effects
  "office.pptx.format.effects_label": { en: "Effects", vi: "Hiá»‡u á»©ng" },
  "office.pptx.format.shadow_label": { en: "Shadow", vi: "Äá»• bÃ³ng" },
  "office.pptx.format.shadow_on": { en: "Drop shadow", vi: "Äá»• bÃ³ng" },
  "office.pptx.format.shadow_color": { en: "Shadow color", vi: "MÃ u bÃ³ng" },
  "office.pptx.format.shadow_blur": { en: "Shadow blur in points", vi: "Äá»™ má» bÃ³ng (Ä‘iá»ƒm)" },
  "office.pptx.format.shadow_dist": { en: "Shadow distance in points", vi: "Khoáº£ng cÃ¡ch bÃ³ng (Ä‘iá»ƒm)" },
  "office.pptx.format.shadow_dir": { en: "Shadow direction in degrees", vi: "HÆ°á»›ng bÃ³ng (Ä‘á»™)" },
  "office.pptx.format.shadow_inner": { en: "Inner shadow", vi: "BÃ³ng trong" },
  "office.pptx.format.glow_label": { en: "Glow", vi: "PhÃ¡t sÃ¡ng" },
  "office.pptx.format.glow_on": { en: "Glow", vi: "PhÃ¡t sÃ¡ng" },
  "office.pptx.format.glow_color": { en: "Glow color", vi: "MÃ u phÃ¡t sÃ¡ng" },
  "office.pptx.format.glow_radius": { en: "Glow radius in points", vi: "BÃ¡n kÃnh phÃ¡t sÃ¡ng (Ä‘iá»ƒm)" },
  "office.pptx.format.soft_edge_label": { en: "Soft edge in points", vi: "LÃ m má» cÃ²n (Ä‘iá»ƒm)" },

  // Size / geometry
  "office.pptx.format.geometry_label": { en: "Shape geometry", vi: "HÃ¬nh dáº¡ng hÃ¬nh há»c" },
  "office.pptx.format.geometry_prst": { en: "Preset shape name", vi: "TÃªn hÃ¬nh dá»±ng sáºµn" },
  "office.pptx.format.geometry_hint": {
    en: "An OOXML preset name such as roundRect or ellipse.",
    vi: "TÃªn dá»±ng sáºµn OOXML nhÆ° roundRect hoáº·c ellipse.",
  },
  "office.pptx.format.adjust_label": { en: "Shape adjustment", vi: "Äiá»u chá»‰nh hÃ¬nh dáº¡ng" },
  "office.pptx.format.adjust_placeholder": { en: "adj=0.25", vi: "adj=0.25" },
  "office.pptx.format.adjust_hint": {
    en: "One or more name=value pairs, separated by commas.",
    vi: "Má»™t hoáº·c nhiá»u cáº·p tÃªn=giÃ¡ trá»‹, cÃ¡ch nhau báº±ng dáº¥u pháº©y.",
  },
  "office.pptx.format.adjust_invalid": {
    en: "Enter name=value pairs with numeric values, for example adj=0.25.",
    vi: "Nháºp cÃ¡c cáº·p tÃªn=giÃ¡ trá»‹ vá»›i giÃ¡ trá»‹ sá»‘, vÃ dá»¥ adj=0.25.",
  },

  // Arrange
  "office.pptx.format.arrange_label": { en: "Arrange", vi: "Sáº¯p xáº¿p" },
  "office.pptx.format.group": { en: "Group", vi: "Nhá»Ÿm" },
  "office.pptx.format.ungroup": { en: "Ungroup", vi: "TÃ¡ch nhÃ³m" },
  "office.pptx.format.flip_h": { en: "Flip horizontally", vi: "Láº­t ngang" },
  "office.pptx.format.flip_v": { en: "Flip vertically", vi: "Láº­t dá»c" },
  "office.pptx.format.align_label": { en: "Align", vi: "CÄƒn chá»‰nh" },
  "office.pptx.format.align.left": { en: "Align left", vi: "CÄƒn trÃ¡i" },
  "office.pptx.format.align.centerH": { en: "Align center", vi: "CÄƒn giá»¯a" },
  "office.pptx.format.align.right": { en: "Align right", vi: "CÄƒn pháº£i" },
  "office.pptx.format.align.top": { en: "Align top", vi: "CÄƒn trÃªn" },
  "office.pptx.format.align.centerV": { en: "Align middle", vi: "CÄƒn giá»¯a dá»c" },
  "office.pptx.format.align.bottom": { en: "Align bottom", vi: "CÄƒn dÆ°á»›i" },
  "office.pptx.format.align_to_label": { en: "Align relative to", vi: "CÄƒn theo" },
  "office.pptx.format.align_to_selection": { en: "Selection", vi: "VÃ¹ng chá»n" },
  "office.pptx.format.align_to_slide": { en: "Slide", vi: "Trang" },
  "office.pptx.format.distribute_h": { en: "Distribute horizontally", vi: "PhÃ¢n bá»‘ ngang" },
  "office.pptx.format.distribute_v": { en: "Distribute vertically", vi: "PhÃ¢n bá»‘ dá»c" },
  "office.pptx.format.need_two": {
    en: "Select at least two elements.",
    vi: "Chá»n Ãt nháº¥t hai Ä‘á»‘i tÆ°á»£ng.",
  },
  "office.pptx.format.need_three": {
    en: "Select at least three elements.",
    vi: "Chá»n Ãt nháº¥t ba Ä‘á»‘i tÆ°á»£ng.",
  },
  "office.pptx.format.need_group": {
    en: "Select a single group to ungroup.",
    vi: "Chá»n má»™t nhÃ³m Ä‘á»ƒ tÃ¡ch.",
  },

  // Text
  "office.pptx.format.text_label": { en: "Text", vi: "VÄƒn báº£n" },
  "office.pptx.format.anchor_label": { en: "Vertical anchor", vi: "Neo dá»c" },
  "office.pptx.format.anchor.top": { en: "Top", vi: "TrÃªn" },
  "office.pptx.format.anchor.middle": { en: "Middle", vi: "Giá»¯a" },
  "office.pptx.format.anchor.bottom": { en: "Bottom", vi: "DÆ°á»›i" },
  "office.pptx.format.autofit_label": { en: "Autofit", vi: "Tá»± Ä‘á»™ng vá»«a" },
  "office.pptx.format.autofit.none": { en: "Do not autofit", vi: "KhÃ´ng tá»± Ä‘á»™ng vá»«a" },
  "office.pptx.format.autofit.shrink": { en: "Shrink text on overflow", vi: "Thu nhá» vÄƒn báº£n khi trÃ n" },
  "office.pptx.format.autofit.resize": { en: "Resize shape to fit text", vi: "Äiá»u chá»‰nh hÃ¬nh theo vÄƒn báº£n" },
  "office.pptx.format.wrap": { en: "Wrap text in shape", vi: "Xuá»‘ng dÃ²ng trong hÃ¬nh" },

  "office.pptx.format.apply": { en: "Apply", vi: "Ãp dá»¥ng" },
};

/** Locales this panel ships copy for. */
export type PptxFormatLocale = "en" | "vi";

/**
 * Nest the flat key map into the shape the shared locale files use, so the
 * UI-wire round can merge it verbatim (`office.pptx.format.*` -> nested
 * objects). Pure: no i18next instance is touched here.
 */
export function formatPanelDictionary(locale: PptxFormatLocale): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_FORMAT_I18N)) {
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