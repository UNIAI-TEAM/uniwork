import { render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DocAccessCell, DocNameCell, DocPersonCell } from "./cells";

// The three cells every list screen shares (contract UNI-2045): Name (type
// icon, title, location line), Access (scope pill + "You: level" / "Owner"),
// Person (avatar 24 + display name).

initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

const scopeOf = (over: Partial<{ users: number; workspaces: number; organization: boolean; public_link: boolean; home_workspace: boolean }> = {}) => ({
  users: 0,
  workspaces: 0,
  organization: false,
  public_link: false,
  home_workspace: false,
  ...over,
});

describe("DocNameCell", () => {
  it("draws the icon of the file's extension, the title and the location line", () => {
    render(<DocNameCell kind="file" title="Báo giá tháng 10.docx" location="Kinh doanh › Báo giá" />);
    expect(screen.getByRole("img", { name: /word/i })).toBeInTheDocument();
    expect(screen.getByText("Báo giá tháng 10.docx")).toBeInTheDocument();
    expect(screen.getByText("Kinh doanh › Báo giá")).toBeInTheDocument();
  });

  it("draws a page and a folder by kind, whatever the title ends with", () => {
    const { rerender } = render(<DocNameCell kind="page" title="Họp tuần.pdf" />);
    expect(screen.getByRole("img", { name: /uninote|trang|page/i })).toBeInTheDocument();
    rerender(<DocNameCell kind="folder" title="Hợp đồng" />);
    expect(screen.getByRole("img", { name: /thư mục|folder/i })).toBeInTheDocument();
  });

  it("takes an explicit format over the title's extension", () => {
    render(<DocNameCell kind="file" format="xlsx" title="Bảng lương" />);
    expect(screen.getByRole("img", { name: /xlsx|excel/i })).toBeInTheDocument();
  });

  it("shows no location line when there is none, and gives a long title its full text on hover", () => {
    render(<DocNameCell kind="file" title="Tên rất dài.pdf" location={null} />);
    expect(screen.getByText("Tên rất dài.pdf")).toHaveAttribute("title", "Tên rất dài.pdf");
    expect(screen.queryByTestId("doclist-location")).not.toBeInTheDocument();
  });
});

describe("DocAccessCell", () => {
  it("shows Riêng tư with the viewer's level as 'Bạn: Sửa'", () => {
    render(<DocAccessCell visibility="restricted" shareScope={scopeOf()} myLevel="edit" />);
    expect(screen.getByText("Riêng tư")).toBeInTheDocument();
    expect(screen.getByText("Bạn: Sửa")).toBeInTheDocument();
  });

  it("shows Workspace for a workspace-visible document", () => {
    render(<DocAccessCell visibility="workspace" shareScope={scopeOf({ home_workspace: true })} myLevel="view" />);
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Bạn: Xem")).toBeInTheDocument();
  });

  it("shows Được chia sẻ for a restricted document that people, workspaces, the organization or a link can reach", () => {
    for (const share of [{ users: 2 }, { workspaces: 1 }, { organization: true }, { public_link: true }]) {
      const { unmount } = render(<DocAccessCell visibility="restricted" shareScope={scopeOf(share)} myLevel="comment" />);
      expect(screen.getByText("Được chia sẻ")).toBeInTheDocument();
      expect(screen.getByText("Bạn: Bình luận")).toBeInTheDocument();
      unmount();
    }
  });

  it("reads Chủ sở hữu instead of the level when is_owner is true", () => {
    render(<DocAccessCell visibility="restricted" shareScope={scopeOf()} myLevel="manage" isOwner />);
    expect(screen.getByText("Chủ sở hữu")).toBeInTheDocument();
    expect(screen.queryByText(/Bạn:/)).not.toBeInTheDocument();
  });

  it("falls back to the level line when is_owner is absent or false", () => {
    const { rerender } = render(<DocAccessCell visibility="restricted" shareScope={scopeOf()} myLevel="manage" />);
    expect(screen.getByText("Bạn: Quản lý")).toBeInTheDocument();
    rerender(<DocAccessCell visibility="restricted" shareScope={scopeOf()} myLevel="manage" isOwner={false} />);
    expect(screen.getByText("Bạn: Quản lý")).toBeInTheDocument();
  });

  it("degrades without a level or a scope instead of throwing", () => {
    render(<DocAccessCell visibility="restricted" shareScope={null} myLevel={null} />);
    expect(screen.getByText("Riêng tư")).toBeInTheDocument();
    expect(screen.queryByText(/Bạn:/)).not.toBeInTheDocument();
  });

  it("reads an unknown level as no level line, and manage for an administrator without a level", () => {
    const { rerender } = render(<DocAccessCell visibility="workspace" shareScope={null} myLevel="owner-ish" />);
    expect(screen.queryByText(/Bạn:/)).not.toBeInTheDocument();
    rerender(<DocAccessCell visibility="restricted" shareScope={null} myLevel={null} adminScope />);
    expect(screen.getByText("Bạn: Quản lý")).toBeInTheDocument();
  });

  it("speaks English when the locale is en", async () => {
    await setLocale("en");
    render(<DocAccessCell visibility="restricted" shareScope={scopeOf({ users: 1 })} myLevel="edit" />);
    expect(screen.getByText("Shared")).toBeInTheDocument();
    expect(screen.getByText("You: Edit")).toBeInTheDocument();
    await setLocale("vi");
  });
});

describe("DocAccessCell pill", () => {
  // Rules.dc.html section 1 draws a filled pill: Hạn chế/Riêng tư grey,
  // Workspace blue, Được chia sẻ amber. The pill is the Badge primitive with
  // semantic tokens, so it follows light and dark.
  const pillOf = (kind: "restricted" | "workspace" | "shared") => {
    const props =
      kind === "workspace"
        ? { visibility: "workspace", shareScope: scopeOf({ home_workspace: true }) }
        : { visibility: "restricted", shareScope: scopeOf(kind === "shared" ? { users: 1 } : {}) };
    const { container } = render(<DocAccessCell {...props} myLevel="manage" />);
    return container.querySelector("[data-access-kind]") as HTMLElement;
  };

  it.each([
    ["restricted", "bg-muted", "text-muted-foreground"],
    ["workspace", "bg-primary/10", "text-primary"],
    ["shared", "bg-warning-soft", "text-warning-soft-foreground"],
  ] as const)("draws %s as a filled Badge with %s %s", (kind, fill, ink) => {
    const pill = pillOf(kind);
    expect(pill).toHaveAttribute("data-access-kind", kind);
    expect(pill).toHaveAttribute("data-slot", "badge");
    expect(pill).toHaveClass("rounded-4xl", fill, ink);
  });

  it("keeps the level line under the pill, outside it", () => {
    const pill = pillOf("restricted");
    expect(pill).toHaveTextContent("Riêng tư");
    expect(pill).not.toHaveTextContent("Bạn:");
    expect(screen.getByText("Bạn: Quản lý").previousElementSibling).toBe(pill);
  });

  it("truncates a long label inside the pill instead of overflowing", () => {
    const pill = pillOf("shared");
    expect(pill.querySelector(".truncate")).toHaveTextContent("Được chia sẻ");
    expect(pill).toHaveClass("max-w-full");
  });
});

describe("DocPersonCell", () => {
  it("shows a 24px avatar and the display name", () => {
    const { container } = render(<DocPersonCell name="Lê Thu" />);
    expect(screen.getByText("Lê Thu")).toBeInTheDocument();
    const avatar = container.querySelector("[data-slot='avatar'], [class*='size-6']");
    expect(avatar).not.toBeNull();
  });

  it("shows the viewer's own name like anyone else's", () => {
    render(<DocPersonCell name="An" />);
    expect(screen.getByText("An")).toBeInTheDocument();
  });

  it("falls back to the dash for a missing, empty or blank name, without throwing", () => {
    for (const name of [null, undefined, "", "   "]) {
      const { container, unmount } = render(<DocPersonCell name={name} />);
      expect(within(container).getByText("—")).toBeInTheDocument();
      unmount();
    }
  });
});
