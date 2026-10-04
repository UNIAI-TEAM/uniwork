/**
 * A3ui (UNI-927) - the Insert panel's own i18n keys.
 *
 * The shared locale files (`packages/core/i18n/locales/{en,vi}.json`) belong to
 * the serialized UI-wire round, so this panel keeps its strings here: one plain
 * `{ "office.pptx.insert.<key>": { en, vi } }` map. Every JSX string in the
 * panel calls `t()` with the exact key listed below, so the wire round only has
 * to copy these entries into the two locale files (no key rewriting).
 *
 * `key` is the full i18next key; `vars` lists the `{{...}}` placeholders the
 * copy carries, and `insert-i18n.test.ts` pins key parity + placeholder parity
 * between `en` and `vi`.
 */
export interface PptxInsertI18nEntry {
  en: string;
  vi: string;
}

export const PPTX_INSERT_I18N: Readonly<Record<string, PptxInsertI18nEntry>> = {
  "office.pptx.insert.title": { en: "Insert", vi: "ChÃ¨n" },
  "office.pptx.insert.sections_label": { en: "Insert tools", vi: "CÃ´ng cá»¥ chÃ¨n" },
  "office.pptx.insert.loading": { en: "Loading the insert toolsâ€¦", vi: "Äang táº£i cÃ´ng cá»¥ chÃ¨nâ€¦" },
  "office.pptx.insert.busy": { en: "Applying the insertâ€¦", vi: "Äang Ã¡p dá»¥ng thao tÃ¡c chÃ¨nâ€¦" },
  "office.pptx.insert.no_slide": { en: "Select a slide to insert into.", vi: "Chọn một trang chiếu để chèn." },
  "office.pptx.insert.disabled_hint": {
    en: "Insert is unavailable while the editor is busy.",
    vi: "KhÃ´ng thá»ƒ chÃ¨n khi trÃ¬nh soáº¡n tháº£o Ä‘ang báº­n.",
  },
  "office.pptx.insert.close": { en: "Close", vi: "ÄÃ³ng" },
  "office.pptx.insert.error_title": { en: "Insert failed", vi: "ChÃ¨n tháº¥t báº¡i" },

  // Shapes gallery
  "office.pptx.insert.shapes.title": { en: "Shapes", vi: "HÃ¬nh dáº¡ng" },
  "office.pptx.insert.shapes.description": {
    en: "Insert a preset shape on the current slide.",
    vi: "ChÃ¨n má»™t hÃ¬nh dá»±ng sáºµn vÃ o trang chiáº¿u hiá»‡n táº¡i.",
  },
  "office.pptx.insert.shapes.open": { en: "Shapes", vi: "HÃ¬nh dáº¡ng" },
  "office.pptx.insert.shapes.gallery_label": { en: "Shape gallery", vi: "ThÆ° viá»‡n hÃ¬nh dáº¡ng" },
  "office.pptx.insert.shapes.group.lines": { en: "Lines", vi: "ÄÆ°á»ng" },
  "office.pptx.insert.shapes.group.rects": { en: "Rectangles", vi: "HÃ¬nh chá»¯ nháº­t" },
  "office.pptx.insert.shapes.group.basic": { en: "Basic shapes", vi: "HÃ¬nh cÆ¡ báº£n" },
  "office.pptx.insert.shapes.group.arrows": { en: "Block arrows", vi: "MÅ©i tÃªn khá»‘i" },
  "office.pptx.insert.shapes.group.stars": { en: "Stars and banners", vi: "NgÃ´i sao vÃ  bÄƒng rÃ´n" },
  "office.pptx.insert.shapes.group.flowchart": { en: "Flowchart", vi: "LÆ°u Ä‘á»“" },
  "office.pptx.insert.shapes.group.callouts": { en: "Callouts", vi: "ChÃº thÃ­ch" },
  "office.pptx.insert.shapes.prst.line": { en: "Line", vi: "ÄÆ°á»ng tháº³ng" },
  "office.pptx.insert.shapes.prst.lineArrow": { en: "Arrow", vi: "MÅ©i tÃªn" },
  "office.pptx.insert.shapes.prst.lineArrowDouble": { en: "Double arrow", vi: "MÅ©i tÃªn hai Ä‘áº§u" },
  "office.pptx.insert.shapes.prst.lineBent": { en: "Elbow connector", vi: "ÄÆ°á»ng ná»‘i gáº¥p khÃºc" },
  "office.pptx.insert.shapes.prst.lineCurved": { en: "Curved connector", vi: "ÄÆ°á»ng ná»‘i cong" },
  "office.pptx.insert.shapes.prst.rect": { en: "Rectangle", vi: "HÃ¬nh chá»¯ nháº­t" },
  "office.pptx.insert.shapes.prst.roundRect": { en: "Rounded rectangle", vi: "HÃ¬nh chá»¯ nháº­t bo gÃ³c" },
  "office.pptx.insert.shapes.prst.snip1Rect": { en: "Snip one corner", vi: "Cáº¯t má»™t gÃ³c" },
  "office.pptx.insert.shapes.prst.snipRoundRect": { en: "Snip and round", vi: "Cáº¯t gÃ³c vÃ  bo trÃ²n" },
  "office.pptx.insert.shapes.prst.ellipse": { en: "Ellipse", vi: "HÃ¬nh elip" },
  "office.pptx.insert.shapes.prst.triangle": { en: "Isosceles triangle", vi: "Tam giÃ¡c cÃ¢n" },
  "office.pptx.insert.shapes.prst.rtTriangle": { en: "Right triangle", vi: "Tam giÃ¡c vuÃ´ng" },
  "office.pptx.insert.shapes.prst.diamond": { en: "Diamond", vi: "HÃ¬nh thoi" },
  "office.pptx.insert.shapes.prst.pentagon": { en: "Pentagon", vi: "NgÅ© giÃ¡c" },
  "office.pptx.insert.shapes.prst.hexagon": { en: "Hexagon", vi: "Lá»¥c giÃ¡c" },
  "office.pptx.insert.shapes.prst.octagon": { en: "Octagon", vi: "BÃ¡t giÃ¡c" },
  "office.pptx.insert.shapes.prst.parallelogram": { en: "Parallelogram", vi: "HÃ¬nh bÃ¬nh hÃ nh" },
  "office.pptx.insert.shapes.prst.trapezoid": { en: "Trapezoid", vi: "HÃ¬nh thang" },
  "office.pptx.insert.shapes.prst.plus": { en: "Cross", vi: "HÃ¬nh chá»¯ tháº­p" },
  "office.pptx.insert.shapes.prst.donut": { en: "Donut", vi: "HÃ¬nh vÃ nh khuyÃªn" },
  "office.pptx.insert.shapes.prst.blockArc": { en: "Block arc", vi: "Cung khá»‘i" },
  "office.pptx.insert.shapes.prst.heart": { en: "Heart", vi: "HÃ¬nh trÃ¡i tim" },
  "office.pptx.insert.shapes.prst.sun": { en: "Sun", vi: "Máº·t trá»i" },
  "office.pptx.insert.shapes.prst.cloud": { en: "Cloud", vi: "ÄÃ¡m mÃ¢y" },
  "office.pptx.insert.shapes.prst.lightningBolt": { en: "Lightning bolt", vi: "Tia chá»›p" },
  "office.pptx.insert.shapes.prst.rightArrow": { en: "Right arrow", vi: "MÅ©i tÃªn pháº£i" },
  "office.pptx.insert.shapes.prst.leftArrow": { en: "Left arrow", vi: "MÅ©i tÃªn trÃ¡i" },
  "office.pptx.insert.shapes.prst.upArrow": { en: "Up arrow", vi: "MÅ©i tÃªn lÃªn" },
  "office.pptx.insert.shapes.prst.downArrow": { en: "Down arrow", vi: "MÅ©i tÃªn xuá»‘ng" },
  "office.pptx.insert.shapes.prst.leftRightArrow": { en: "Left-right arrow", vi: "MÅ©i tÃªn trÃ¡i-pháº£i" },
  "office.pptx.insert.shapes.prst.upDownArrow": { en: "Up-down arrow", vi: "MÅ©i tÃªn lÃªn-xuá»‘ng" },
  "office.pptx.insert.shapes.prst.chevron": { en: "Chevron", vi: "HÃ¬nh chá»¯ V" },
  "office.pptx.insert.shapes.prst.homePlate": { en: "Pentagon arrow", vi: "MÅ©i tÃªn ngÅ© giÃ¡c" },
  "office.pptx.insert.shapes.prst.star4": { en: "4-point star", vi: "Sao 4 cÃ¡nh" },
  "office.pptx.insert.shapes.prst.star5": { en: "5-point star", vi: "Sao 5 cÃ¡nh" },
  "office.pptx.insert.shapes.prst.star6": { en: "6-point star", vi: "Sao 6 cÃ¡nh" },
  "office.pptx.insert.shapes.prst.star8": { en: "8-point star", vi: "Sao 8 cÃ¡nh" },
  "office.pptx.insert.shapes.prst.star12": { en: "12-point star", vi: "Sao 12 cÃ¡nh" },
  "office.pptx.insert.shapes.prst.ribbon": { en: "Ribbon", vi: "BÄƒng rÃ´n" },
  "office.pptx.insert.shapes.prst.flowChartProcess": { en: "Process", vi: "Xá»­ lÃ½" },
  "office.pptx.insert.shapes.prst.flowChartDecision": { en: "Decision", vi: "Quyáº¿t Ä‘á»‹nh" },
  "office.pptx.insert.shapes.prst.flowChartTerminator": { en: "Terminator", vi: "Báº¯t Ä‘áº§u/Káº¿t thÃºc" },
  "office.pptx.insert.shapes.prst.flowChartDocument": { en: "Document", vi: "TÃ i liá»‡u" },
  "office.pptx.insert.shapes.prst.flowChartConnector": { en: "Connector", vi: "Äiá»ƒm ná»‘i" },
  "office.pptx.insert.shapes.prst.wedgeRectCallout": { en: "Rectangular callout", vi: "ChÃº thÃ­ch chá»¯ nháº­t" },
  "office.pptx.insert.shapes.prst.wedgeRoundRectCallout": { en: "Rounded callout", vi: "ChÃº thÃ­ch bo gÃ³c" },
  "office.pptx.insert.shapes.prst.wedgeEllipseCallout": { en: "Oval callout", vi: "ChÃº thÃ­ch elip" },
  "office.pptx.insert.shapes.prst.cloudCallout": { en: "Cloud callout", vi: "ChÃº thÃ­ch Ä‘Ã¡m mÃ¢y" },

  // Text box
  "office.pptx.insert.text_box.title": { en: "Text box", vi: "Há»™p vÄƒn báº£n" },
  "office.pptx.insert.text_box.insert": { en: "Text box", vi: "Há»™p vÄƒn báº£n" },
  "office.pptx.insert.text_box.hint": {
    en: "Adds an empty text box you can type into.",
    vi: "ThÃªm má»™t há»™p vÄƒn báº£n trá»‘ng Ä‘á»ƒ báº¡n nháº­p ná»™i dung.",
  },

  // Picture
  "office.pptx.insert.image.title": { en: "Picture", vi: "HÃ¬nh áº£nh" },
  "office.pptx.insert.image.insert": { en: "Picture", vi: "HÃ¬nh áº£nh" },
  "office.pptx.insert.image.choose": { en: "Choose an image file", vi: "Chá»n tá»‡p hÃ¬nh áº£nh" },
  "office.pptx.insert.image.replace": { en: "Replace picture", vi: "Thay hÃ¬nh áº£nh" },
  "office.pptx.insert.image.replace_hint": {
    en: "Swap the file behind the selected picture.",
    vi: "Äá»•i tá»‡p áº£nh cá»§a hÃ¬nh Ä‘ang chá»n.",
  },
  "office.pptx.insert.image.no_target": {
    en: "Select a picture on the slide to replace it.",
    vi: "Chá»n má»™t hÃ¬nh áº£nh trÃªn trang chiáº¿u Ä‘á»ƒ thay tháº¿.",
  },
  "office.pptx.insert.image.unsupported": {
    en: "{{ext}} is not a supported image format.",
    vi: "{{ext}} khÃ´ng pháº£i Ä‘á»‹nh dáº¡ng áº£nh Ä‘Æ°á»£c há»— trá»£.",
  },

  // WordArt
  "office.pptx.insert.wordart.title": { en: "WordArt", vi: "WordArt" },
  "office.pptx.insert.wordart.description": {
    en: "Insert decorative text with a preset style.",
    vi: "ChÃ¨n chá»¯ trang trÃ­ theo kiá»ƒu dá»±ng sáºµn.",
  },
  "office.pptx.insert.wordart.open": { en: "WordArt", vi: "WordArt" },
  "office.pptx.insert.wordart.text_label": { en: "Text", vi: "Ná»™i dung" },
  "office.pptx.insert.wordart.text_placeholder": { en: "Your text", vi: "Ná»™i dung cá»§a báº¡n" },
  "office.pptx.insert.wordart.preset.blue": { en: "Blue, bold", vi: "Xanh dÆ°Æ¡ng, Ä‘áº­m" },
  "office.pptx.insert.wordart.preset.gold": { en: "Gold, bold", vi: "VÃ ng, Ä‘áº­m" },
  "office.pptx.insert.wordart.preset.red": { en: "Red, bold", vi: "Äá», Ä‘áº­m" },
  "office.pptx.insert.wordart.preset.purple": { en: "Purple, bold", vi: "TÃ­m, Ä‘áº­m" },
  "office.pptx.insert.wordart.preset.green-italic": { en: "Green, bold italic", vi: "Xanh lÃ¡, Ä‘áº­m nghiÃªng" },
  "office.pptx.insert.wordart.preset.white-orange": { en: "White with orange outline", vi: "Tráº¯ng viá»n cam" },
  "office.pptx.insert.wordart.preset.white-red": { en: "White with red outline", vi: "Tráº¯ng viá»n Ä‘á»" },
  "office.pptx.insert.wordart.preset.gold-brown": { en: "Gold with brown outline", vi: "VÃ ng viá»n nÃ¢u" },
  "office.pptx.insert.wordart.preset.sky-navy": { en: "Sky with navy outline", vi: "Xanh da trá»i viá»n xanh Ä‘áº­m" },
  "office.pptx.insert.wordart.preset.navy-white": { en: "Navy with white outline", vi: "Xanh Ä‘áº­m viá»n tráº¯ng" },
  "office.pptx.insert.wordart.preset.black-gold": { en: "Black with gold outline", vi: "Äen viá»n vÃ ng" },
  "office.pptx.insert.wordart.preset.silver-dark": { en: "Silver with dark outline", vi: "Báº¡c viá»n xÃ¡m Ä‘áº­m" },

  // Connectors
  "office.pptx.insert.connector.title": { en: "Connectors", vi: "ÄÆ°á»ng ná»‘i" },
  "office.pptx.insert.connector.hint": {
    en: "Glues a connector to two shapes so it follows them.",
    vi: "Gáº¯n Ä‘Æ°á»ng ná»‘i vÃ o hai hÃ¬nh Ä‘á»ƒ Ä‘Æ°á»ng ná»‘i Ä‘i theo chÃºng.",
  },
  "office.pptx.insert.connector.kind_label": { en: "Connector type", vi: "Kiá»ƒu Ä‘Æ°á»ng ná»‘i" },
  "office.pptx.insert.connector.kind.straight": { en: "Straight", vi: "Tháº³ng" },
  "office.pptx.insert.connector.kind.elbow": { en: "Elbow", vi: "Gáº¥p khÃºc" },
  "office.pptx.insert.connector.kind.curved": { en: "Curved", vi: "Cong" },
  "office.pptx.insert.connector.from_label": { en: "Start shape", vi: "HÃ¬nh báº¯t Ä‘áº§u" },
  "office.pptx.insert.connector.to_label": { en: "End shape", vi: "HÃ¬nh káº¿t thÃºc" },
  "office.pptx.insert.connector.arrow_label": { en: "Arrowheads", vi: "Äáº§u mÅ©i tÃªn" },
  "office.pptx.insert.connector.arrow.none": { en: "None", vi: "KhÃ´ng" },
  "office.pptx.insert.connector.arrow.end": { en: "End", vi: "Cuá»‘i" },
  "office.pptx.insert.connector.arrow.both": { en: "Both", vi: "Cáº£ hai" },
  "office.pptx.insert.connector.insert": { en: "Add connector", vi: "ThÃªm Ä‘Æ°á»ng ná»‘i" },
  "office.pptx.insert.connector.empty": {
    en: "Add at least two shapes to connect them.",
    vi: "ThÃªm Ã­t nháº¥t hai hÃ¬nh Ä‘á»ƒ ná»‘i chÃºng.",
  },
  "office.pptx.insert.connector.pick_both": {
    en: "Choose two different shapes.",
    vi: "Chá»n hai hÃ¬nh khÃ¡c nhau.",
  },

  // Group
  "office.pptx.insert.group.title": { en: "Group", vi: "NhÃ³m" },
  "office.pptx.insert.group.apply": { en: "Group selection", vi: "NhÃ³m pháº§n Ä‘ang chá»n" },
  "office.pptx.insert.group.hint": {
    en: "Groups the selected elements so they move together.",
    vi: "NhÃ³m cÃ¡c thÃ nh pháº§n Ä‘ang chá»n Ä‘á»ƒ chÃºng di chuyá»ƒn cÃ¹ng nhau.",
  },
  "office.pptx.insert.group.need_two": {
    en: "Select at least two elements to group.",
    vi: "Chá»n Ã­t nháº¥t hai thÃ nh pháº§n Ä‘á»ƒ nhÃ³m.",
  },
} as const;

/** Flat map -> the nested dictionary i18next expects (dotted keys are levels). */
export function pptxInsertNestedDictionary(locale: "en" | "vi"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(PPTX_INSERT_I18N)) {
    const parts = key.split(".");
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i] as string;
      const next = cursor[part];
      if (typeof next !== "object" || next === null) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1] as string] = entry[locale];
  }
  return out;
}

/** `{{var}}` names used by a copy string, sorted - parity checks use it. */
export function pptxInsertI18nVars(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort();
}