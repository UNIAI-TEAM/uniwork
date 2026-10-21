import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AccessReportFilters } from "@uniwork/core/types/document-access-report";
import { fakeNav, wrapWithNav } from "../../test/api-mock";
import { AccessReportFiltersBar } from "./access-report-filters";

// The search box commits to the URL once typing pauses; the URL answers a beat
// later, and what the reader typed in between must survive that answer.

const { t } = initI18n();

function bar(filters: AccessReportFilters, onFiltersChange: (next: AccessReportFilters) => void) {
  return wrapWithNav(
    <AccessReportFiltersBar
      wsId="ws1"
      folderId={undefined}
      view="documents"
      filters={filters}
      kind={undefined}
      onFiltersChange={onFiltersChange}
      onKindChange={vi.fn()}
      onReset={vi.fn()}
    />,
    fakeNav("/acme/doi/documents/access-report"),
  );
}

describe("AccessReportFiltersBar - search", () => {
  it("keeps characters typed while the URL has not yet echoed the last commit", async () => {
    vi.useFakeTimers();
    try {
      const commits: AccessReportFilters[] = [];
      const onChange = (next: AccessReportFilters) => commits.push(next);
      const view = render(bar({}, onChange));
      const box = screen.getByRole("searchbox", { name: t("documents.accessReport.search_documents") });

      fireEvent.change(box, { target: { value: "ab" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(commits.at(-1)?.q).toBe("ab");

      // The reader types on before router.replace lands, then the URL echoes "ab".
      fireEvent.change(box, { target: { value: "abc" } });
      view.rerender(bar({ q: "ab" }, onChange));
      expect(box).toHaveValue("abc");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(commits.at(-1)?.q).toBe("abc");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still replaces the text when the URL changes by itself (Clear filters, back)", async () => {
    const view = render(bar({ q: "xyz" }, vi.fn()));
    const box = screen.getByRole("searchbox", { name: t("documents.accessReport.search_documents") });
    expect(box).toHaveValue("xyz");
    view.rerender(bar({}, vi.fn()));
    await waitFor(() => expect(box).toHaveValue(""));
  });
});
