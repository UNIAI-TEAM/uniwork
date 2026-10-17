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

/**
 * U-UN1 (UNI-1812): the rich-text document kind (`kind=page`) is the product
 * name UniNote in every language. Keys are listed by name on purpose: "Trang" /
 * "Page" also means pagination, the home page and print pages, so no fuzzy scan
 * of every string would be safe.
 */
const KIND_KEYS = [
  "auth.connect.shareDocuments",
  "documents.file_types.page",
  "documents.page.new_page",
  "documents.copy.page_not_supported",
  "documents.archive.archive_folder_description",
  "documents.home.create.page.card",
  "documents.home.create.page.hint",
  "documents.home.create.page.menu",
  "documents.home.chips.page",
  "documents.home.groups.type.page",
  "documents.errors.document_parent_kind",
];

/** Keys where "Trang" keeps its ordinary meaning (pagination, home page, print pages). */
const PAGE_WORD_KEYS = [
  "ui.pagination_next",
  "ui.pagination_previous",
  "home.title",
  "nav.home",
  "officeDesktop.print.range",
  "officeDesktop.print.nextPage",
  "officeDesktop.print.previousPage",
  "documents.collab.collabAnchorPage",
];

/** The subset whose English copy says "Page" too (the home page is "Home"). */
const EN_PAGE_WORD_KEYS = PAGE_WORD_KEYS.filter((k) => !/home|nav\.home/.test(k));

const VI_KIND_WORD = /\b(trang)\b/i;
const EN_KIND_WORD = /\bpages?\b/i;

describe("UniNote naming (U-UN1)", () => {
  it.each(KIND_KEYS)("%s names the kind UniNote in vi and en", (key) => {
    expect(VI[key], `vi ${key}`).toBeDefined();
    expect(EN[key], `en ${key}`).toBeDefined();
    expect(VI[key]).toContain("UniNote");
    expect(EN[key]).toContain("UniNote");
    expect(VI[key]).not.toMatch(VI_KIND_WORD);
    expect(EN[key]).not.toMatch(EN_KIND_WORD);
  });

  it("the create hint keeps its two promises: tasks and mentions", () => {
    expect(VI["documents.home.create.page.hint"]).toMatch(/công việc/);
    expect(VI["documents.home.create.page.hint"]).toMatch(/nhắc tên/);
    expect(EN["documents.home.create.page.hint"]).toMatch(/tasks/i);
    expect(EN["documents.home.create.page.hint"]).toMatch(/mention/i);
  });

  it.each(PAGE_WORD_KEYS)("%s keeps the ordinary page word", (key) => {
    expect(VI[key], `vi ${key}`).toMatch(VI_KIND_WORD);
    expect(VI[key]).not.toContain("UniNote");
    expect(EN[key]).not.toContain("UniNote");
    if (EN_PAGE_WORD_KEYS.includes(key)) expect(EN[key], `en ${key}`).toMatch(EN_KIND_WORD);
  });
});
