import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChangeSummary, changeEntries, shortId } from "./event-presenter";

initI18n();

describe("event presenter", () => {
  it("reads a bare value as the new state and a from/to pair as a move", () => {
    expect(changeEntries({ changes: { title: "x", status: { from: "a", to: "b" } } })).toEqual([
      ["title", { to: "x" }],
      ["status", { from: "a", to: "b" }],
    ]);
  });

  it("caps the inline diff and counts the rest", () => {
    render(<ChangeSummary event={{ changes: { a: 1, b: 2, c: 3, d: 4 } }} max={2} empty="—" />);
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.queryByText("c")).toBeNull();
    expect(screen.getByText("+2 trường")).toBeInTheDocument();
  });

  it("names a cleared field instead of rendering nothing", () => {
    render(<ChangeSummary event={{ changes: { due: { from: "2026-01-01", to: null } } }} empty="—" />);
    expect(screen.getByText("Không có")).toBeInTheDocument();
  });

  it("shortens a ULID but leaves a short id alone", () => {
    expect(shortId("01J8Z0M3K9Q2V4X6Y8A0B2C4D6")).toBe("01J8…C4D6");
    expect(shortId("u1")).toBe("u1");
  });

  it("translates a known changed field instead of showing its raw column name", () => {
    render(<ChangeSummary event={{ changes: { status: { from: "todo", to: "done" } } }} empty="—" />);
    expect(screen.getByText("Trạng thái")).toBeInTheDocument();
    expect(screen.queryByText("status")).toBeNull();
  });

  it("falls back to the raw key for a field the UI has no translation for", () => {
    render(<ChangeSummary event={{ changes: { some_future_column: "x" } }} empty="—" />);
    expect(screen.getByText("some_future_column")).toBeInTheDocument();
  });

  it("translates the fields and enum values the server writes, per resource", () => {
    render(
      <ChangeSummary
        event={{ resource_type: "organization_member", changes: { role: { from: "member", to: "owner" }, slug: "acme" } }}
        empty="—"
      />,
    );
    expect(screen.getByText("Vai trò")).toBeInTheDocument();
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Chủ sở hữu")).toBeInTheDocument();
    expect(screen.getByText("Định danh")).toBeInTheDocument();
    expect(screen.queryByText("owner")).toBeNull();
  });

  it("reads a status in the vocabulary of its resource", () => {
    render(<ChangeSummary event={{ resource_type: "meeting", changes: { status: { from: "SCHEDULED", to: "CANCELED" } } }} empty="—" />);
    expect(screen.getByText("Đã lên lịch")).toBeInTheDocument();
    expect(screen.getByText("Đã hủy")).toBeInTheDocument();
  });

  it("says yes or no for a flag and keeps an unknown value as written", () => {
    render(<ChangeSummary event={{ changes: { archived: { from: false, to: true }, role: "auditor" } }} empty="—" />);
    expect(screen.getByText("Lưu trữ")).toBeInTheDocument();
    expect(screen.getByText("Không")).toBeInTheDocument();
    expect(screen.getByText("Có")).toBeInTheDocument();
    expect(screen.getByText("auditor")).toBeInTheDocument();
  });

  it("translates agent as a role and a task priority", () => {
    render(<ChangeSummary event={{ resource_type: "task", changes: { role: "agent", priority: "urgent" } }} empty="—" />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Khẩn cấp")).toBeInTheDocument();
  });
});
