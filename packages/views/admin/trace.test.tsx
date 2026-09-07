import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminTraceView } from "./trace";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const trace = {
  trace_id: "t1",
  audit: [{ id: "e1", action: "task.updated", resource_type: "task", resource_id: "01J8X4TASK0N1P2Q3R4S5T6U7", occurred_at: "2026-09-06T00:00:02Z" }],
  outbox: [{ id: "x1", topic: "task.updated", status: "DONE", attempts: 1, created_at: "2026-09-06T00:00:03Z" }],
  actions: [{ id: "a1", action: "organization.suspended", reason: "Chưa thanh toán", created_at: "2026-09-06T00:00:01Z" }],
};

function nav(id?: string): NavigationAdapter {
  return {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/trace",
    searchParams: new URLSearchParams(id ? { id } : {}), getShareableUrl: (p) => `https://app.test${p}`,
  };
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminTraceView", () => {
  it("asks for a trace id before calling anything", () => {
    render(wrapWithNav(<AdminTraceView />, nav()));
    expect(screen.getByRole("status")).toHaveTextContent("Nhập trace id để tra");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("reads the id from the URL and renders one timeline sorted by time", async () => {
    requestMock.mockResolvedValue(trace);
    render(wrapWithNav(<AdminTraceView />, nav("t1")));
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("organization.suspended"),
      expect.stringContaining("task.updated"),
      expect.stringContaining("task.updated"),
    ]);
    expect(items[0]).toHaveTextContent("admin");
    expect(items[2]).toHaveTextContent("outbox");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/trace/t1");
  });

  it("looks up a typed id, updates the URL and copies the shareable link", async () => {
    requestMock.mockResolvedValue({ trace_id: "t2", audit: [], outbox: [], actions: [] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const adapter = nav();
    render(wrapWithNav(<AdminTraceView />, adapter));
    fireEvent.change(screen.getByRole("textbox", { name: "Trace id" }), { target: { value: " t2 " } });
    fireEvent.click(screen.getByRole("button", { name: "Tra cứu" }));
    expect(adapter.replace).toHaveBeenCalledWith("/admin/trace?id=t2");
    expect(await screen.findByRole("status")).toHaveTextContent("Không có dữ liệu cho trace này");
    fireEvent.click(screen.getByRole("button", { name: "Sao chép liên kết" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://app.test/admin/trace?id=t2"));
    vi.unstubAllGlobals();
  });

  it("shows the error state", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrapWithNav(<AdminTraceView />, nav("t1")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tra được trace");
  });
});
