import { render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DocumentSummaryRow } from "../library-rows";
import { docListRowFields } from "./row-fields";
import { DocScreenCell, DocScreenLine, type DocListMemberLookup } from "./screen-cells";

// The two screen columns of Thùng rác and Lưu trữ (UNI-2045 W2/W3).
// deleted: who deleted · (date · "Còn N ngày", N = max(1, ceil((purge_after - now)/24h)), red at N <= 7).
// shelved: avatar + who shelved · date.

initI18n();

const NOW = new Date(2026, 9, 21, 9, 5, 0);
const at = (days: number, minutes = 0) => new Date(NOW.getTime() + days * 86_400_000 + minutes * 60_000).toISOString();

function doc(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Báo cáo.docx",
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  } as DocumentSummaryRow;
}

const trashed = (over: Partial<DocumentSummaryRow> = {}) =>
  doc({ archived_at: new Date(2026, 9, 21, 8, 0).toISOString(), archived_by: "u2", purge_after: at(30), ...over });

const members: DocListMemberLookup = (id) => (id === "u2" ? { name: "Mai Trường", avatarUrl: null } : "former");

function renderCell(column: "deleted" | "shelved", row: DocumentSummaryRow, member: DocListMemberLookup = members) {
  return render(<DocScreenCell column={column} fields={docListRowFields(row)} member={member} />);
}

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deleted screen column", () => {
  it("names who deleted on the main line and the date · days left below it (vi)", () => {
    renderCell("deleted", trashed());
    expect(screen.getByText("Mai Trường")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("Còn 30 ngày")).toBeInTheDocument();
  });

  it("puts the countdown on its own line under the date, so a 118px column cannot cut it (F3)", () => {
    renderCell("deleted", trashed());
    const date = screen.getByText("08:00");
    const left = screen.getByText("Còn 30 ngày");
    // Two sibling lines of the cell; no dot between them and no truncation of the countdown.
    expect(left.parentElement).toBe(date.parentElement);
    expect(date.parentElement).toHaveClass("flex-col");
    expect(date.parentElement?.textContent).not.toContain("·");
  });

  it("speaks English with the shared date words", async () => {
    await setLocale("en");
    try {
      renderCell("deleted", trashed({ archived_at: new Date(2026, 9, 20, 16, 30).toISOString(), purge_after: at(2) }));
      expect(screen.getByText("Yesterday, 16:30")).toBeInTheDocument();
      expect(screen.getByText("2 days left")).toBeInTheDocument();
    } finally {
      await setLocale("vi");
    }
  });

  it.each([
    ["an hour left reads 1 and is red", at(0, 60), "Còn 1 ngày", true],
    ["past the deadline still reads 1", at(0, -5), "Còn 1 ngày", true],
    ["exactly 7 days is red", at(7), "Còn 7 ngày", true],
    ["7 days and a minute is 8 and not red", at(7, 1), "Còn 8 ngày", false],
  ])("%s", (_label, purgeAfter, text, red) => {
    renderCell("deleted", trashed({ purge_after: purgeAfter }));
    const left = screen.getByText(text);
    if (red) expect(left).toHaveClass("text-destructive");
    else expect(left).not.toHaveClass("text-destructive");
  });

  it("falls back to a former member, a dash for nobody, and leaves days left out without purge_after", () => {
    const { unmount } = renderCell("deleted", trashed({ archived_by: "gone" }));
    expect(screen.getByText("Thành viên cũ")).toBeInTheDocument();
    unmount();
    renderCell("deleted", trashed({ archived_by: null, purge_after: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.queryByText(/Còn/)).not.toBeInTheDocument();
  });

  it("writes no name while the member list is still loading", () => {
    renderCell("deleted", trashed(), () => null);
    expect(screen.queryByText("Mai Trường")).not.toBeInTheDocument();
    expect(screen.queryByText("Thành viên cũ")).not.toBeInTheDocument();
  });

  it("stacks the same words on one narrow line under Name", () => {
    render(<DocScreenLine column="deleted" fields={docListRowFields(trashed())} member={members} />);
    expect(screen.getByText("Mai Trường · 08:00 · Còn 30 ngày")).toBeInTheDocument();
  });

  it("lets the narrow line wrap instead of cutting the countdown at 390 (F7)", () => {
    render(<DocScreenLine column="deleted" fields={docListRowFields(trashed())} member={members} />);
    expect(screen.getByText(/Còn 30 ngày/)).not.toHaveClass("truncate");
  });
});

describe("shelved screen column", () => {
  const shelved = (over: Record<string, unknown> = {}) =>
    doc({ shelved_at: new Date(2026, 9, 18, 10, 0).toISOString(), shelved_by: "u2", ...over } as Partial<DocumentSummaryRow>);

  it("draws the avatar and who shelved, then the date", () => {
    renderCell("shelved", shelved());
    expect(screen.getByText("Mai Trường")).toBeInTheDocument();
    expect(screen.getByText("18/10")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='avatar']")).not.toBeNull();
  });

  it("names the system for a null shelved_by and a former member for an unknown id", () => {
    const { unmount } = renderCell("shelved", shelved({ shelved_by: null }));
    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    unmount();
    renderCell("shelved", shelved({ shelved_by: "gone" }));
    expect(screen.getByText("Cựu thành viên")).toBeInTheDocument();
  });

  it("stacks who · date on the narrow line", () => {
    render(<DocScreenLine column="shelved" fields={docListRowFields(shelved())} member={members} />);
    expect(screen.getByText("Mai Trường · 18/10")).toBeInTheDocument();
  });
});
