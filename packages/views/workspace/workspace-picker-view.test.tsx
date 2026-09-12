import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { WorkspacePickerView } from "./workspace-picker-view";

initI18n();

const me: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
});

describe("WorkspacePickerView", () => {
  it("groups workspaces by organization", async () => {
    requestMock.mockResolvedValueOnce({
      workspaces: [
        { id: "w1", slug: "a", name: "Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" },
        { id: "w2", slug: "b", name: "Beta", organization_id: "o2", organization_slug: "acme", organization_name: "Acme" },
      ],
    });
    const onPick = vi.fn();
    render(wrap(<WorkspacePickerView onPick={onPick} onCreate={() => {}} />));
    expect(await screen.findByRole("heading", { name: /Unicom/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Acme/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" }));
  });
  /**
   * jsdom không dựng layout nên không đo được tràn ngang; cái chốt được ở đây là
   * nguyên nhân. Nút là grid item, mặc định `min-width: auto`, nên nó neo ở bề
   * rộng nội dung và `truncate` bên trong vô hiệu — trang tràn 41px ở 375px.
   * Bỏ `min-w-0` đi là lỗi quay lại.
   */
  it("lets the workspace row shrink so its long URL can truncate", async () => {
    requestMock.mockResolvedValueOnce({
      workspaces: [
        { id: "w1", slug: "doi-san-pham", name: "Đội sản phẩm", organization_id: "o1", organization_slug: "audit-ux-eight", organization_name: "Audit UX Eight" },
      ],
    });
    render(wrap(<WorkspacePickerView onPick={() => {}} onCreate={() => {}} />));
    const row = await screen.findByRole("button", { name: /Đội sản phẩm/ });
    expect(row.className).toMatch(/\bmin-w-0\b/);
    expect(row.querySelector(".font-mono")?.className).toMatch(/\btruncate\b/);
  });
  it("empty → onCreate", async () => {
    requestMock.mockResolvedValueOnce({ workspaces: [] });
    const onCreate = vi.fn();
    render(wrap(<WorkspacePickerView onPick={() => {}} onCreate={onCreate} />));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalled());
  });
});
