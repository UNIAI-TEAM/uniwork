import { render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import type { DocumentShareScope } from "@uniwork/core/types/document";
import { DocAccessCell } from "./cells";
import { formatBytes, formatListDate } from "./format";
import { daysLeft, docListGroupId, docListGroupLabelKey, type DocListGroupId, type DocListGroupScreen } from "./groups";
import vectors from "./doclist-vectors.json";

// doclist-vectors.json is the truth the web and the desktop app share: inputs
// and the strings they must produce, in both languages. Dates are local
// wall-clock strings without an offset, so the cases hold in any timezone.
// This file only reads it; change an expectation there, never here.

const { t } = initI18n();
const LOCALES = ["vi", "en"] as const;

beforeAll(async () => {
  await setLocale("vi");
});
afterEach(async () => {
  await setLocale("vi");
});

const at = (local: string) => new Date(local);

describe("vectors: dates", () => {
  for (const [index, c] of vectors.dates.cases.entries()) {
    for (const locale of LOCALES) {
      it(`#${index} ${String(c.at)} -> ${c[locale]} (${locale})`, () => {
        const now = at("now" in c ? String(c.now) : vectors.dates.now);
        expect(formatListDate(c.at, now, locale)).toBe(c[locale]);
      });
    }
  }
});

describe("vectors: bytes", () => {
  for (const c of vectors.bytes.cases) {
    for (const locale of LOCALES) {
      it(`${c.label} -> ${c[locale]} (${locale})`, () => {
        expect(formatBytes(c.bytes, locale)).toBe(c[locale]);
      });
    }
  }
});

describe("vectors: access pill and level line", () => {
  for (const c of vectors.access.cases) {
    for (const locale of LOCALES) {
      it(`${c.label} (${locale})`, async () => {
        await setLocale(locale);
        const { container } = render(
          <DocAccessCell
            visibility={c.visibility}
            shareScope={c.share_scope as DocumentShareScope | null}
            myLevel={c.my_level}
            adminScope={"admin_scope" in c ? c.admin_scope : undefined}
            isOwner={"is_owner" in c ? c.is_owner : undefined}
          />,
        );
        const pill = container.querySelector("[data-access-kind]");
        expect(pill?.getAttribute("data-access-kind")).toBe(c.pill);
        expect(pill?.textContent).toBe(c.pill_text[locale]);
        const sub = pill?.nextElementSibling?.textContent ?? null;
        expect(sub).toBe(c.sub ? c.sub[locale] : null);
      });
    }
  }
});

describe("vectors: days left", () => {
  for (const c of vectors.days_left.cases) {
    for (const locale of LOCALES) {
      it(`${c.label} (${locale})`, async () => {
        await setLocale(locale);
        const days = daysLeft(c.purge_after, at(vectors.days_left.now));
        expect(days).toBe(c.days);
        expect(days === null ? null : t("documents.list.days_left", { count: days })).toBe(c[locale]);
      });
    }
  }
});

describe("vectors: group labels", () => {
  for (const c of vectors.groups.cases) {
    it(c.label, async () => {
      const input = {
        at: "at" in c.input ? c.input.at : undefined,
        purgeAfter: "purgeAfter" in c.input ? c.input.purgeAfter : undefined,
      };
      const id = docListGroupId(c.screen as DocListGroupScreen, input, at(c.now));
      expect(id).toBe(c.group);
      for (const locale of LOCALES) {
        await setLocale(locale);
        expect(t(docListGroupLabelKey(id))).toBe(c[locale]);
      }
    });
  }

  it("lists every group label of both languages", async () => {
    for (const locale of LOCALES) {
      await setLocale(locale);
      for (const [id, words] of Object.entries(vectors.groups.labels)) {
        expect(t(docListGroupLabelKey(id as DocListGroupId))).toBe(words[locale]);
      }
    }
  });
});

describe("vectors: documents.list.* keys", () => {
  const leaves = (value: unknown, prefix: string): string[] =>
    value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => leaves(child, `${prefix}.${key}`))
      : [prefix];

  it("equals the leaf keys of both locale files, sorted", () => {
    expect([...vectors.i18n_keys]).toEqual([...vectors.i18n_keys].sort());
    expect(leaves(vi.documents.list, "documents.list").sort()).toEqual(vectors.i18n_keys);
    expect(leaves(en.documents.list, "documents.list").sort()).toEqual(vectors.i18n_keys);
  });
});
