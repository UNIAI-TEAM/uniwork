import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

type Entry = string | Entry[] | { [k: string]: Entry };
type Dict = { [k: string]: Entry };

function flatten(obj: Dict | Entry[], prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const VI = flatten(vi as Dict);
const EN = flatten(en as Dict);

/** i18next JSON v4: một khoá đếm được có thể tồn tại dưới dạng `_one`/`_other`. */
const PLURAL = ["_one", "_other", "_zero", "_two", "_few", "_many"];
const stem = (key: string) => {
  const hit = PLURAL.find((s) => key.endsWith(s));
  return hit ? key.slice(0, -hit.length) : key;
};
const stems = (keys: string[]) => new Set(keys.map(stem));

/**
 * PRODUCT.md hứa hai ngôn ngữ ngang nhau. Một khoá thiếu không làm app vỡ — nó
 * lặng lẽ rơi về tiếng Việt giữa một màn hình tiếng Anh, và không ai thấy cho
 * đến khi người dùng thấy. Đây là chỗ duy nhất bắt được điều đó.
 */
describe("vi/en parity", () => {
  const viStems = stems(Object.keys(VI));
  const enStems = stems(Object.keys(EN));

  it("mọi khoá tiếng Việt đều có bản tiếng Anh", () => {
    expect([...viStems].filter((k) => !enStems.has(k)).sort()).toEqual([]);
  });

  it("không có khoá tiếng Anh mồ côi", () => {
    expect([...enStems].filter((k) => !viStems.has(k)).sort()).toEqual([]);
  });

  it("hai bên nội suy cùng một bộ biến", () => {
    const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
    const mismatched: string[] = [];
    for (const [key, viText] of Object.entries(VI)) {
      // So theo stem: `sent_title` (vi) đối với `sent_title_one` (en).
      const enText = EN[key] ?? EN[`${stem(key)}_other`] ?? EN[`${stem(key)}_one`];
      if (enText === undefined) continue;
      if (vars(viText) !== vars(enText)) mismatched.push(`${key}: vi(${vars(viText)}) en(${vars(enText)})`);
    }
    expect(mismatched).toEqual([]);
  });

  it("không có chuỗi nào bị lỗi mã hoá (U+FFFD hoặc UTF-8 đọc nhầm thành Latin-1)", () => {
    // Mojibake of a UTF-8 text decoded as Latin-1/CP1252 starts a pair with Ã/Â/Ä/Å or â + a C1 / punctuation char;
    // real Vietnamese has no such pair, and U+FFFD marks bytes that were already lost (UNI-1232: office.format).
    const mojibake = /[\u00c2-\u00c5][\u0080-\u00bf]|\u00e2[\u0080-\u00bf\u20ac]|\ufffd/;
    const bad = (dict: Record<string, string>) => Object.entries(dict).filter(([, v]) => mojibake.test(v)).map(([k]) => k).sort();
    expect({ vi: bad(VI), en: bad(EN) }).toEqual({ vi: [], en: [] });
  });

  it("không có chuỗi tiếng Anh nào bị bỏ trống", () => {
    expect(Object.entries(EN).filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
  });

  it("thư viện Documents dùng \"Tài liệu\" trong tiếng Việt, không để nguyên \"Documents\" (UNI-1469 V-F1)", () => {
    const keys = {
      "documents.home.folders.create_title_root": "Thư mục mới ở Tài liệu (gốc)",
      "documents.home.move.root": "Tài liệu (gốc)",
      "documents.home.folder_invalid.back": "Về Tài liệu (gốc)",
      "documents.home.search.label": "Tìm trong Tài liệu",
      "documents.home.search.path_root": "Tài liệu (gốc)",
    };
    expect(Object.fromEntries(Object.keys(keys).map((k) => [k, VI[k]]))).toEqual(keys);
    const leftover = Object.entries(VI)
      .filter(([k, v]) => k.startsWith("documents.") && /\bDocuments\b/.test(v))
      .map(([k]) => k);
    expect(leftover).toEqual([]);
  });

  it("DOC-05 break-glass và thông báo document_break_glass có đủ bản vi/en đúng chuẩn", () => {
    expect(VI["documents.breakGlass.lockedTitle"]).toBe("Tài liệu này là riêng tư");
    expect(EN["documents.breakGlass.lockedTitle"]).toBe("This document is private");
    expect(VI["documents.breakGlass.reasonTooShort"]).toBe("Hãy nhập lý do ít nhất 10 ký tự.");
    expect(EN["documents.breakGlass.reasonTooShort"]).toBe(
      "Enter a reason of at least 10 characters.",
    );
    expect(VI["documents.breakGlass.reasonTooLong"]).toBe("Lý do tối đa 500 ký tự.");
    expect(EN["documents.breakGlass.reasonTooLong"]).toBe(
      "Reason must be 500 characters or fewer.",
    );
    expect(VI["documents.breakGlass.selfShareError"]).toBe(
      "Quản trị viên không thể tự cấp quyền qua mục Chia sẻ. Hãy dùng Truy cập khẩn cấp (24 giờ, có ghi nhật ký).",
    );
    expect(EN["documents.breakGlass.selfShareError"]).toBe(
      "Admins can't grant themselves access through Share. Use Emergency access (24 hours, audited).",
    );
    expect(VI["notifications.kind.document_break_glass"]).toBe(
      "{{actor}} đã mở truy cập khẩn cấp (chỉ xem, 24 giờ) vào tài liệu “{{document}}”.",
    );
    expect(EN["notifications.kind.document_break_glass"]).toBe(
      "{{actor}} opened emergency view access (24h) to “{{document}}”.",
    );
    expect(VI["notifications.kindTitle.document_break_glass"]).toBe(
      "Truy cập khẩn cấp vào tài liệu",
    );
    expect(EN["notifications.kindTitle.document_break_glass"]).toBe(
      "Emergency access to document",
    );
  });

  it("trạng thái tài liệu riêng tư đọc là \"Riêng tư\"/\"Private\" ở mọi bề mặt, không còn \"Hạn chế\"/\"Restricted\"", () => {
    expect(VI["documents.home.access_filters.restricted"]).toBe("Riêng tư");
    expect(EN["documents.home.access_filters.restricted"]).toBe("Private");
    expect(VI["documents.share.visibility_restricted"]).toBe("Riêng tư");
    expect(EN["documents.share.visibility_restricted"]).toBe("Private");
    expect(VI["org.members.transfer_docs.skipped_self_other"]).toBe(
      "{{count}} tài liệu riêng tư không thể chuyển cho chính bạn.",
    );
    expect(EN["org.members.transfer_docs.skipped_self_other"]).toBe(
      "{{count}} private documents can't be transferred to yourself.",
    );
  });
});

