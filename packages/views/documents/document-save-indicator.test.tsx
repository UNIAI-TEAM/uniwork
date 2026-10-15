import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { wrap } from "../test/api-mock";
import { DocumentSaveIndicator } from "./document-save-indicator";

const { t } = initI18n();

const state = (phase: DocumentSaveState["phase"]): DocumentSaveState => ({
  phase, revision: "3", dirty: true, idempotencyKey: null, errorClass: null, errorCode: null,
  errorFields: undefined, sentEditLockId: undefined, acked: null,
});

// V-1: at a phone width the header cannot fit title + status + holder chip; the status keeps its icon
// and its accessible name and shows the words from sm up, instead of being clipped mid-word.
describe("DocumentSaveIndicator compact", () => {
  it.each([
    ["debouncing", "documents.save.unsaved"],
    ["saving", "documents.save.saving"],
  ] as const)("%s: the words are sr-only below sm, never dropped", (phase, key) => {
    const text = t(key);
    render(wrap(<DocumentSaveIndicator compact state={state(phase)} />));
    const words = screen.getByText(text);
    expect(words).toHaveClass("sr-only", "sm:not-sr-only");
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("not compact: the words always show", () => {
    render(wrap(<DocumentSaveIndicator state={state("debouncing")} />));
    expect(screen.getByText(t("documents.save.unsaved"))).not.toHaveClass("sr-only");
  });
});
