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
  "office.pptx.insert.title": { en: "Insert", vi: "Chèn" },
  "office.pptx.insert.sections_label": { en: "Insert tools", vi: "Công cụ chèn" },
  "office.pptx.insert.loading": { en: "Loading the insert tools…", vi: "Đang tải công cụ chèn…" },
  "office.pptx.insert.busy": { en: "Applying the insert…", vi: "Đang áp dụng thao tác chèn…" },
  "office.pptx.insert.no_slide": { en: "Select a slide to insert into.", vi: "Chọn một trang chiếu để chèn." },
  "office.pptx.insert.disabled_hint": {
    en: "Insert is unavailable while the editor is busy.",
    vi: "Không thể chèn khi trình soạn thảo đang bận.",
  },
  "office.pptx.insert.close": { en: "Close", vi: "Đóng" },
  "office.pptx.insert.error_title": { en: "Insert failed", vi: "Chèn thất bại" },

  // Shapes gallery
  "office.pptx.insert.shapes.title": { en: "Shapes", vi: "Hình dạng" },
  "office.pptx.insert.shapes.description": {
    en: "Insert a preset shape on the current slide.",
    vi: "Chèn một hình dựng sẵn vào trang chiếu hiện tại.",
  },
  "office.pptx.insert.shapes.open": { en: "Shapes", vi: "Hình dạng" },
  "office.pptx.insert.shapes.gallery_label": { en: "Shape gallery", vi: "Thư viện hình dạng" },
  "office.pptx.insert.shapes.group.lines": { en: "Lines", vi: "Đường" },
  "office.pptx.insert.shapes.group.rects": { en: "Rectangles", vi: "Hình chữ nhật" },
  "office.pptx.insert.shapes.group.basic": { en: "Basic shapes", vi: "Hình cơ bản" },
  "office.pptx.insert.shapes.group.arrows": { en: "Block arrows", vi: "Mũi tên khối" },
  "office.pptx.insert.shapes.group.stars": { en: "Stars and banners", vi: "Ngôi sao và băng rôn" },
  "office.pptx.insert.shapes.group.flowchart": { en: "Flowchart", vi: "Lưu đồ" },
  "office.pptx.insert.shapes.group.callouts": { en: "Callouts", vi: "Chú thích" },
  "office.pptx.insert.shapes.prst.line": { en: "Line", vi: "Đường thẳng" },
  "office.pptx.insert.shapes.prst.lineArrow": { en: "Arrow", vi: "Mũi tên" },
  "office.pptx.insert.shapes.prst.lineArrowDouble": { en: "Double arrow", vi: "Mũi tên hai đầu" },
  "office.pptx.insert.shapes.prst.lineBent": { en: "Elbow connector", vi: "Đường nối gấp khúc" },
  "office.pptx.insert.shapes.prst.lineCurved": { en: "Curved connector", vi: "Đường nối cong" },
  "office.pptx.insert.shapes.prst.rect": { en: "Rectangle", vi: "Hình chữ nhật" },
  "office.pptx.insert.shapes.prst.roundRect": { en: "Rounded rectangle", vi: "Hình chữ nhật bo góc" },
  "office.pptx.insert.shapes.prst.snip1Rect": { en: "Snip one corner", vi: "Cắt một góc" },
  "office.pptx.insert.shapes.prst.snipRoundRect": { en: "Snip and round", vi: "Cắt góc và bo tròn" },
  "office.pptx.insert.shapes.prst.ellipse": { en: "Ellipse", vi: "Hình elip" },
  "office.pptx.insert.shapes.prst.triangle": { en: "Isosceles triangle", vi: "Tam giác cân" },
  "office.pptx.insert.shapes.prst.rtTriangle": { en: "Right triangle", vi: "Tam giác vuông" },
  "office.pptx.insert.shapes.prst.diamond": { en: "Diamond", vi: "Hình thoi" },
  "office.pptx.insert.shapes.prst.pentagon": { en: "Pentagon", vi: "Ngũ giác" },
  "office.pptx.insert.shapes.prst.hexagon": { en: "Hexagon", vi: "Lục giác" },
  "office.pptx.insert.shapes.prst.octagon": { en: "Octagon", vi: "Bát giác" },
  "office.pptx.insert.shapes.prst.parallelogram": { en: "Parallelogram", vi: "Hình bình hành" },
  "office.pptx.insert.shapes.prst.trapezoid": { en: "Trapezoid", vi: "Hình thang" },
  "office.pptx.insert.shapes.prst.plus": { en: "Cross", vi: "Hình chữ thập" },
  "office.pptx.insert.shapes.prst.donut": { en: "Donut", vi: "Hình vành khuyên" },
  "office.pptx.insert.shapes.prst.blockArc": { en: "Block arc", vi: "Cung khối" },
  "office.pptx.insert.shapes.prst.heart": { en: "Heart", vi: "Hình trái tim" },
  "office.pptx.insert.shapes.prst.sun": { en: "Sun", vi: "Mặt trời" },
  "office.pptx.insert.shapes.prst.cloud": { en: "Cloud", vi: "Đám mây" },
  "office.pptx.insert.shapes.prst.lightningBolt": { en: "Lightning bolt", vi: "Tia chớp" },
  "office.pptx.insert.shapes.prst.rightArrow": { en: "Right arrow", vi: "Mũi tên phải" },
  "office.pptx.insert.shapes.prst.leftArrow": { en: "Left arrow", vi: "Mũi tên trái" },
  "office.pptx.insert.shapes.prst.upArrow": { en: "Up arrow", vi: "Mũi tên lên" },
  "office.pptx.insert.shapes.prst.downArrow": { en: "Down arrow", vi: "Mũi tên xuống" },
  "office.pptx.insert.shapes.prst.leftRightArrow": { en: "Left-right arrow", vi: "Mũi tên trái-phải" },
  "office.pptx.insert.shapes.prst.upDownArrow": { en: "Up-down arrow", vi: "Mũi tên lên-xuống" },
  "office.pptx.insert.shapes.prst.chevron": { en: "Chevron", vi: "Hình chữ V" },
  "office.pptx.insert.shapes.prst.homePlate": { en: "Pentagon arrow", vi: "Mũi tên ngũ giác" },
  "office.pptx.insert.shapes.prst.star4": { en: "4-point star", vi: "Sao 4 cánh" },
  "office.pptx.insert.shapes.prst.star5": { en: "5-point star", vi: "Sao 5 cánh" },
  "office.pptx.insert.shapes.prst.star6": { en: "6-point star", vi: "Sao 6 cánh" },
  "office.pptx.insert.shapes.prst.star8": { en: "8-point star", vi: "Sao 8 cánh" },
  "office.pptx.insert.shapes.prst.star12": { en: "12-point star", vi: "Sao 12 cánh" },
  "office.pptx.insert.shapes.prst.ribbon": { en: "Ribbon", vi: "Băng rôn" },
  "office.pptx.insert.shapes.prst.flowChartProcess": { en: "Process", vi: "Xử lý" },
  "office.pptx.insert.shapes.prst.flowChartDecision": { en: "Decision", vi: "Quyết định" },
  "office.pptx.insert.shapes.prst.flowChartTerminator": { en: "Terminator", vi: "Bắt đầu/Kết thúc" },
  "office.pptx.insert.shapes.prst.flowChartDocument": { en: "Document", vi: "Tài liệu" },
  "office.pptx.insert.shapes.prst.flowChartConnector": { en: "Connector", vi: "Điểm nối" },
  "office.pptx.insert.shapes.prst.wedgeRectCallout": { en: "Rectangular callout", vi: "Chú thích chữ nhật" },
  "office.pptx.insert.shapes.prst.wedgeRoundRectCallout": { en: "Rounded callout", vi: "Chú thích bo góc" },
  "office.pptx.insert.shapes.prst.wedgeEllipseCallout": { en: "Oval callout", vi: "Chú thích elip" },
  "office.pptx.insert.shapes.prst.cloudCallout": { en: "Cloud callout", vi: "Chú thích đám mây" },

  // Text box
  "office.pptx.insert.text_box.title": { en: "Text box", vi: "Hộp văn bản" },
  "office.pptx.insert.text_box.insert": { en: "Text box", vi: "Hộp văn bản" },
  "office.pptx.insert.text_box.hint": {
    en: "Adds an empty text box you can type into.",
    vi: "Thêm một hộp văn bản trống để bạn nhập nội dung.",
  },

  // Picture
  "office.pptx.insert.image.title": { en: "Picture", vi: "Hình ảnh" },
  "office.pptx.insert.image.insert": { en: "Picture", vi: "Hình ảnh" },
  "office.pptx.insert.image.choose": { en: "Choose an image file", vi: "Chọn tệp hình ảnh" },
  "office.pptx.insert.image.replace": { en: "Replace picture", vi: "Thay hình ảnh" },
  "office.pptx.insert.image.replace_hint": {
    en: "Swap the file behind the selected picture.",
    vi: "Đổi tệp ảnh của hình đang chọn.",
  },
  "office.pptx.insert.image.no_target": {
    en: "Select a picture on the slide to replace it.",
    vi: "Chọn một hình ảnh trên trang chiếu để thay thế.",
  },
  "office.pptx.insert.image.unsupported": {
    en: "{{ext}} is not a supported image format.",
    vi: "{{ext}} không phải định dạng ảnh được hỗ trợ.",
  },
  "office.pptx.insert.image.read_failed": {
    en: "The picture could not be read.",
    vi: "Không đọc được hình ảnh.",
  },

  // WordArt
  "office.pptx.insert.wordart.title": { en: "WordArt", vi: "WordArt" },
  "office.pptx.insert.wordart.insert": { en: "Insert WordArt", vi: "Chèn WordArt" },
  "office.pptx.insert.wordart.description": {
    en: "Insert decorative text with a preset style.",
    vi: "Chèn chữ trang trí theo kiểu dựng sẵn.",
  },
  "office.pptx.insert.wordart.open": { en: "WordArt", vi: "WordArt" },
  "office.pptx.insert.wordart.text_label": { en: "Text", vi: "Nội dung" },
  "office.pptx.insert.wordart.text_placeholder": { en: "Your text", vi: "Nội dung của bạn" },
  "office.pptx.insert.wordart.preset.blue": { en: "Blue, bold", vi: "Xanh dương, đậm" },
  "office.pptx.insert.wordart.preset.gold": { en: "Gold, bold", vi: "Vàng, đậm" },
  "office.pptx.insert.wordart.preset.red": { en: "Red, bold", vi: "Đỏ, đậm" },
  "office.pptx.insert.wordart.preset.purple": { en: "Purple, bold", vi: "Tím, đậm" },
  "office.pptx.insert.wordart.preset.green-italic": { en: "Green, bold italic", vi: "Xanh lá, đậm nghiêng" },
  "office.pptx.insert.wordart.preset.white-orange": { en: "White with orange outline", vi: "Trắng viền cam" },
  "office.pptx.insert.wordart.preset.white-red": { en: "White with red outline", vi: "Trắng viền đỏ" },
  "office.pptx.insert.wordart.preset.gold-brown": { en: "Gold with brown outline", vi: "Vàng viền nâu" },
  "office.pptx.insert.wordart.preset.sky-navy": { en: "Sky with navy outline", vi: "Xanh da trời viền xanh đậm" },
  "office.pptx.insert.wordart.preset.navy-white": { en: "Navy with white outline", vi: "Xanh đậm viền trắng" },
  "office.pptx.insert.wordart.preset.black-gold": { en: "Black with gold outline", vi: "Đen viền vàng" },
  "office.pptx.insert.wordart.preset.silver-dark": { en: "Silver with dark outline", vi: "Bạc viền xám đậm" },

  // Connectors
  "office.pptx.insert.connector.title": { en: "Connectors", vi: "Đường nối" },
  "office.pptx.insert.connector.hint": {
    en: "Glues a connector to two shapes so it follows them.",
    vi: "Gắn đường nối vào hai hình để đường nối đi theo chúng.",
  },
  "office.pptx.insert.connector.kind_label": { en: "Connector type", vi: "Kiểu đường nối" },
  "office.pptx.insert.connector.kind.straight": { en: "Straight", vi: "Thẳng" },
  "office.pptx.insert.connector.kind.elbow": { en: "Elbow", vi: "Gấp khúc" },
  "office.pptx.insert.connector.kind.curved": { en: "Curved", vi: "Cong" },
  "office.pptx.insert.connector.from_label": { en: "Start shape", vi: "Hình bắt đầu" },
  "office.pptx.insert.connector.to_label": { en: "End shape", vi: "Hình kết thúc" },
  "office.pptx.insert.connector.arrow_label": { en: "Arrowheads", vi: "Đầu mũi tên" },
  "office.pptx.insert.connector.arrow.none": { en: "None", vi: "Không" },
  "office.pptx.insert.connector.arrow.end": { en: "End", vi: "Cuối" },
  "office.pptx.insert.connector.arrow.both": { en: "Both", vi: "Cả hai" },
  "office.pptx.insert.connector.insert": { en: "Add connector", vi: "Thêm đường nối" },
  "office.pptx.insert.connector.empty": {
    en: "Add at least two shapes to connect them.",
    vi: "Thêm ít nhất hai hình để nối chúng.",
  },
  "office.pptx.insert.connector.pick_both": {
    en: "Choose two different shapes.",
    vi: "Chọn hai hình khác nhau.",
  },

  // Group
  "office.pptx.insert.group.title": { en: "Group", vi: "Nhóm" },
  "office.pptx.insert.group.apply": { en: "Group selection", vi: "Nhóm phần đang chọn" },
  "office.pptx.insert.group.hint": {
    en: "Groups the selected elements so they move together.",
    vi: "Nhóm các thành phần đang chọn để chúng di chuyển cùng nhau.",
  },
  "office.pptx.insert.group.need_two": {
    en: "Select at least two elements to group.",
    vi: "Chọn ít nhất hai thành phần để nhóm.",
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