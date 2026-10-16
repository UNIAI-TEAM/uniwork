import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { formatLockTime } from "./edit-lock-copy";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { libraryLadder } from "./library-columns";
import { documentRow, type DocumentSummaryRow } from "./library-rows";

// UNI-1645 (addendum §11.4): a row whose document someone is editing shows the holder's avatar.

const { t } = initI18n();
const HOLD = (() => {
  const d = new Date();
  d.setHours(22, 30, 0, 0);
  return d.toISOString();
})();

function item(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "page",
    title: "Kế hoạch Q4",
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "edit",
    created_by: "",
    created_by_kind: "human",
    updated_by: "",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

const handlers: LibraryRowHandlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
};

function renderRow(doc: DocumentSummaryRow) {
  return render(
    <table>
      <tbody>
        <LibraryRowView row={documentRow(doc)} handlers={handlers} archived={false} ladder={libraryLadder(false)} />
      </tbody>
    </table>,
  );
}

describe("library row edit-lock holder", () => {
  it("shows who is editing: avatar, the word, and the full name for screen readers", () => {
    renderRow(item({ edit_lock: { holder_id: "u2", holder_name: "Bình Trần", holder_avatar_url: null, since: "2026-10-15T03:12:00Z", held_by_me: false } }));
    const holder = screen.getByRole("img", { name: t("documents.editLock.rowEditingLabel", { name: "Bình Trần" }) });
    expect(holder).toHaveAttribute("title", "Bình Trần đang sửa");
    expect(within(holder).getByText("đang sửa")).toBeTruthy();
    expect(within(holder).getByText("BT")).toBeTruthy();
  });

  it("shows 'đang sửa · offline đến HH:mm' and includes the offline end time in the accessible name when offline_hold_until is set (V3-8, R6-2)", () => {
    renderRow(
      item({
        edit_lock: {
          holder_id: "u2",
          holder_name: "Hưng Nguyễn",
          holder_avatar_url: null,
          since: "2026-10-15T03:12:00Z",
          offline_hold_until: HOLD,
          held_by_me: false,
        },
      }),
    );
    const time = formatLockTime(HOLD, "vi");
    const expectedLabel = t("documents.editLock.bannerOfflineHold", { name: "Hưng Nguyễn", time });
    const holder = screen.getByLabelText(expectedLabel);
    expect(holder).toBe(screen.getByRole("img", { name: expectedLabel }));
    expect(holder).toHaveAttribute("title", expectedLabel);
    expect(within(holder).getByText(`đang sửa · offline đến ${time}`)).toBeTruthy();
  });

  it("omits the holder chip when the lock is held by the current user (V3-7)", () => {
    renderRow(item({ edit_lock: { holder_id: "me", holder_name: "Bạn", holder_avatar_url: null, since: "2026-10-15T03:12:00Z", held_by_me: true } }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
  });

  it("shows nothing when no one is editing", () => {
    renderRow(item({ edit_lock: null }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
    renderRow(item({ id: "d2" }));
    expect(screen.queryByTestId("edit-lock-holder")).toBeNull();
  });
});
