import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

// UNI-2033: the copy of "open a lost comment's version read-only", exact in vi (the contract's
// table) and the proposed English, each with the {{n}} placeholder in the D i18n style.

type Collab = Record<string, string>;
const collab = (locale: { documents: { collab: unknown } }) => locale.documents.collab as Collab;

const EXPECTED: Record<string, [string, string]> = {
  collabAnchorLost: ["Đoạn được bình luận không còn trong bản hiện tại", "The commented passage is not in the current version"],
  collabAnchorViewVersion: ["Xem ở phiên bản {{n}}", "View in version {{n}}"],
  collabVersionViewBanner: ["Bạn đang xem phiên bản {{n}} (chỉ đọc)", "You are viewing version {{n}} (read-only)"],
  collabVersionViewBack: ["Về bản hiện tại", "Back to the current version"],
  collabVersionViewUnavailable: ["Không mở được phiên bản này", "This version could not be opened"],
};

describe("version view copy (UNI-2033)", () => {
  it.each(Object.entries(EXPECTED))("%s is the contract's text in vi and en", (key, [viText, enText]) => {
    expect(collab(vi)[key]).toBe(viText);
    expect(collab(en)[key]).toBe(enText);
  });

  it("carries {{n}} where the number goes, in both languages", () => {
    for (const key of ["collabAnchorViewVersion", "collabVersionViewBanner"]) {
      expect(collab(vi)[key]).toContain("{{n}}");
      expect(collab(en)[key]).toContain("{{n}}");
    }
  });
});
