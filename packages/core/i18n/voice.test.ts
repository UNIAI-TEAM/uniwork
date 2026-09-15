import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The parts of the Vietnamese voice guide (docs/conventions.md §2 and §3) that
 * a machine can hold. Register, tone and "a button starts with a verb" stay
 * with the reviewer; these are the ones that drift one pasted string at a time.
 * They read vi.json only: Vietnamese is the language the product is written
 * in, and English is translated from it.
 */

type Tree = { readonly [key: string]: unknown };

type Rule = {
  /** What the guide says, which is also what a failure reads. */
  readonly rule: string;
  /** Never global: `test` must not carry state between strings. */
  readonly pattern: RegExp;
  /** A string the rule must flag. */
  readonly flags: string;
  /** The corrected form, plus look-alikes the rule must leave alone. */
  readonly passes: string;
  /** Strings the rule would flag that are right as written, each with its reason. */
  readonly allow?: Readonly<Record<string, string>>;
};

const LETTER = "a-zà-ỹđ";

const RULES: readonly Rule[] = [
  {
    rule: "no “vui lòng” padding (§3 Register)",
    pattern: /vui lòng/iu,
    flags: "Không lưu được. Vui lòng thử lại.",
    passes: "Không lưu được. Thử lại.",
  },
  {
    rule: "no “quý khách” (§3 Register)",
    pattern: /quý khách/iu,
    flags: "Cảm ơn quý khách",
    passes: "Cảm ơn bạn",
  },
  {
    rule: "an ellipsis is the single character … (§3 Punctuation)",
    pattern: /\.\.\./u,
    flags: "Đang tải...",
    passes: "Đang tải…",
  },
  {
    rule: "quotes are curly “…”, never straight (§3 Punctuation)",
    pattern: /"/u,
    flags: 'Bình chọn "Ăn trưa" đã đóng',
    passes: "Bình chọn “Ăn trưa” đã đóng",
  },
  {
    rule: "punctuation is ASCII, never full-width (§3 Punctuation)",
    pattern: /[，。：；！？（）]/u,
    flags: "Đã lưu！",
    passes: "Đã lưu!",
  },
  {
    rule: "workspace stays “workspace”, never “không gian làm việc” (§2)",
    pattern: /không gian làm việc/iu,
    flags: "Thành viên không gian làm việc",
    passes: "Thành viên workspace",
  },
  {
    rule: "UNI is UNI, never “trợ lý ảo” (§2)",
    pattern: /trợ lý ảo/iu,
    flags: "Hỏi trợ lý ảo",
    passes: "Hỏi UNI",
  },
  {
    rule: "a thread is “thread”, never “luồng” (§2)",
    pattern: /luồng/iu,
    flags: "Luồng đã giải quyết",
    passes: "Thread đã giải quyết",
  },
  {
    rule: "a task is “việc” or “công việc”, never “task” (§2)",
    // `{{task}}` is a variable name, not copy.
    pattern: /(?<!\{\{)\b(?:sub-)?tasks?\b(?!\}\})/iu,
    flags: "Thêm sub-task",
    passes: "{{actor}} đã giao bạn việc “{{task}}”",
    allow: {
      "settings.audit.filters.action_placeholder": "an audit action identifier, typed as it is stored",
      "settings.audit.filters.resource_type_placeholder": "an audit resource identifier, typed as it is stored",
    },
  },
  {
    // Old and new placement differ only in open syllables oa, oe, uy; after
    // q the u belongs to the consonant, so quý is right either way.
    rule: "tone marks sit on the main vowel: hủy, xóa, tùy, never huỷ, xoá, tuỳ (§3 Punctuation)",
    pattern: new RegExp(`(?<!q)(?:o[àáảãạ]|o[èéẻẽẹ]|u[ỳýỷỹỵ])(?![${LETTER}])`, "iu"),
    flags: "Huỷ cuộc họp",
    passes: "Hủy khoản thanh toán quý này",
  },
  {
    rule: "no leading, trailing or doubled spaces (§3 Punctuation)",
    pattern: /^ | $| {2}/u,
    flags: "Lưu  thay đổi",
    passes: "Lưu thay đổi",
    allow: {
      "onboarding.welcome.illustration.card1_body": "follows a bold name in the same sentence",
      "onboarding.welcome.illustration.card5_prefix": "precedes a bold name in the same sentence",
      "onboarding.welcome.illustration.card5_body": "follows a bold name in the same sentence",
      "onboarding.step_organization.url_preview_prefix": "precedes the URL it introduces",
      "onboarding.step_workspace.url_preview_prefix": "precedes the URL it introduces",
    },
  },
];

function strings(tree: Tree, prefix = "", out: [string, string][] = []): [string, string][] {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.push([path, value]);
    else if (value !== null && typeof value === "object") strings(value as Tree, path, out);
  }
  return out;
}

const VI = strings(JSON.parse(readFileSync(resolve(process.cwd(), "i18n/locales/vi.json"), "utf8")) as Tree);
const VI_BY_KEY = new Map(VI);

describe("Vietnamese voice", () => {
  for (const { rule, pattern, flags, passes, allow = {} } of RULES) {
    describe(rule, () => {
      it("fires on a violation", () => {
        expect(pattern.test(flags)).toBe(true);
      });

      it("stays quiet on the corrected form", () => {
        expect(pattern.test(passes)).toBe(false);
      });

      it("holds across vi.json", () => {
        const found = VI.filter(([key, text]) => pattern.test(text) && !(key in allow)).map(
          ([key, text]) => `${key}: ${text}`,
        );
        expect(found).toEqual([]);
      });

      it("allows only strings that still need it", () => {
        const stale = Object.keys(allow).filter((key) => !pattern.test(VI_BY_KEY.get(key) ?? ""));
        expect(stale).toEqual([]);
      });
    });
  }
});
