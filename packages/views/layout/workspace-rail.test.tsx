import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "./workspace-context";
import { initialsOf, WorkspaceRail, workspaceTint } from "./workspace-rail";

initI18n();

const me: User = {
  id: "u1", email: "quang@uni.vn", display_name: "Quang Phạm",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const ws = (id: string, slug: string, name: string): Workspace => ({
  id, slug, name, organization_id: "o1", organization_slug: "unicom", organization_name: "UNICOM",
});
const tt = ws("w1", "truyen-thong", "Truyền thông");
const kd = ws("w2", "kinh-doanh", "Kinh doanh");
const sp = ws("w3", "san-pham", "Sản phẩm");
const ns = ws("w4", "nhan-su", "Nhân sự");

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/workspaces")) return Promise.resolve({ workspaces: [tt, kd, sp, ns] });
    if (path === "/api/v1/me/chat/unread-summary") {
      return Promise.resolve({
        direct: { unread: 0, mentions: 0 },
        workspaces: [
          { workspace_id: "w1", unread: 4, mentions: 0 },
          { workspace_id: "w2", unread: 7, mentions: 1 },
          { workspace_id: "w3", unread: 2, mentions: 0 },
        ],
      });
    }
    if (path === "/api/v1/me/notifications/unread-count") return Promise.resolve({ total: 1, by_workspace: { w4: 1 } });
    return Promise.resolve({});
  });
});

function renderRail() {
  const nav = fakeNav("/unicom/truyen-thong/chat");
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={tt} user={me}>
        <WorkspaceRail />
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

describe("WorkspaceRail", () => {
  it("draws one initials tile per workspace, the current one marked", async () => {
    renderRail();
    expect(await screen.findByRole("button", { name: /^Sản phẩm/ })).toHaveTextContent("SP");
    const current = screen.getByRole("button", { name: "Truyền thông" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveTextContent("TT");
  });

  it("shows another workspace's chat unread, red when it mentions the reader", async () => {
    renderRail();
    const sales = await screen.findByRole("button", { name: "Kinh doanh, 7 tin nhắn chưa đọc, 1 tin nhắn nhắc bạn" });
    expect(sales).toHaveTextContent("7");
    expect(sales.querySelector(".bg-destructive-solid")).not.toBeNull();
    const product = screen.getByRole("button", { name: "Sản phẩm, 2 tin nhắn chưa đọc" });
    expect(product.querySelector(".bg-primary")).toHaveTextContent("2");
    // Unread notifications alone are news without a count.
    expect(screen.getByRole("button", { name: "Nhân sự, Có thông báo chưa đọc ở workspace khác" })).toHaveTextContent("NS");
  });

  it("switches workspace to its chat and stays put on the current one", async () => {
    const nav = renderRail();
    fireEvent.click(await screen.findByRole("button", { name: /^Kinh doanh/ }));
    expect(nav.push).toHaveBeenCalledWith("/unicom/kinh-doanh/chat");
    fireEvent.click(screen.getByRole("button", { name: "Truyền thông" }));
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("keeps the account actions: settings, theme, language, new workspace, sign out", async () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Cài đặt" }));
    expect(await screen.findByRole("menuitem", { name: "Cài đặt" })).toHaveAttribute("href", "/unicom/truyen-thong/settings");
    expect(screen.getByRole("menuitemradio", { name: /Tối/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "English" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /tài khoản$/ }));
    expect(await screen.findByRole("menuitem", { name: "Workspace mới" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Đăng xuất" })).toBeInTheDocument();
  });
});

describe("rail helpers", () => {
  it("takes two initials and colours by list order", () => {
    expect(initialsOf("Truyền thông")).toBe("TT");
    expect(initialsOf("  ")).toBe("?");
    expect(workspaceTint([tt, kd, sp, ns], "w2")).toBe("orange");
    expect(workspaceTint([tt], "missing")).toBe("blue");
  });
});
