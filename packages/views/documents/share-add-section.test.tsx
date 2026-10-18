import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { ShareAddSection, type ShareMembersDirectory } from "./share-add-section";

initI18n();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const doc: Pick<Document, "id" | "workspace_id" | "organization_id"> = {
  id: "d1",
  workspace_id: "w1",
  organization_id: "o1",
};

const emptyMembers: ShareMembersDirectory = {
  rows: [],
  isLoading: false,
  error: null,
  retry: vi.fn(),
};

const candidatesResponse = {
  items: [
    {
      principal_type: "user",
      principal_id: "u2",
      name: "Nguyễn An",
      secondary: "an@acme.vn",
      direct_level: null,
      is_home_workspace: false,
    },
    {
      principal_type: "user",
      principal_id: "u3",
      name: "Trần Bình",
      secondary: "binh@acme.vn",
      direct_level: "view",
      is_home_workspace: false,
    },
    {
      principal_type: "user",
      principal_id: "u4",
      name: "Lê Chi",
      secondary: "chi@acme.vn",
      direct_level: null,
      is_home_workspace: false,
    },
    {
      principal_type: "workspace",
      principal_id: "w1",
      name: "Kinh doanh",
      secondary: "",
      direct_level: null,
      is_home_workspace: true,
    },
    {
      principal_type: "organization",
      principal_id: "o1",
      name: "Acme",
      secondary: "",
      direct_level: null,
      is_home_workspace: false,
    },
  ],
  next_cursor: "",
};

function renderAddSection() {
  return render(
    wrap(
      <ShareAddSection
        wsId="w1"
        doc={doc}
        open
        shares={[]}
        members={emptyMembers}
        orgWorkspaces={[{ id: "w1", name: "Kinh doanh" }]}
        organization={{ id: "o1", name: "Acme" }}
      />,
    ),
  );
}

describe("ShareAddSection (SH-W1 Area 1)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.clearAllMocks();
  });

  it("AC01: groups candidates by Người / Workspace / Tổ chức, shows existing grant badge, and shares 1 person with View", async () => {
    const accessCalls: Array<{ items: unknown[]; dry_run?: boolean }> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
        return Promise.resolve(candidatesResponse);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        accessCalls.push(opts.body);
        return Promise.resolve({
          batch_id: opts.body.dry_run ? "" : "01JBATCH1",
          dry_run: Boolean(opts.body.dry_run),
          results: [{ index: 0, status: "granted" }],
          preview: { users: [], groups: [], warnings: [] },
        });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAddSection();

    const combobox = screen.getByRole("combobox", { name: "Chọn đối tượng" });
    await user.click(combobox);

    const listbox = await screen.findByRole("listbox");
    expect(await within(listbox).findByText("Người")).toBeInTheDocument();
    expect(within(listbox).getByText("Workspace")).toBeInTheDocument();
    expect(within(listbox).getByText("Tổ chức")).toBeInTheDocument();
    expect(within(listbox).getByText("Đã có quyền: Chỉ xem")).toBeInTheDocument();
    expect(within(listbox).getByText("Mọi thành viên của workspace này")).toBeInTheDocument();
    expect(within(listbox).getByText("Mọi thành viên trong tổ chức")).toBeInTheDocument();

    await user.click(within(listbox).getByRole("option", { name: /Nguyễn An/ }));
    expect(screen.getByText("Đã chọn 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));

    await waitFor(() => expect(accessCalls).toHaveLength(2));
    expect(accessCalls[0]).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: "view" }],
      dry_run: true,
    });
    expect(accessCalls[1]).toEqual({
      items: [{ principal_type: "user", principal_id: "u2", level: "view" }],
      dry_run: false,
    });
    expect(toast.success).toHaveBeenCalledWith("Đã chia sẻ cho 1 đối tượng");
  });

  it("AC02/AC03: supports custom per-principal levels, live summary, apply-all confirm, and on_existing keep/update", async () => {
    const accessCalls: Array<{ items: unknown[]; dry_run?: boolean }> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
        return Promise.resolve(candidatesResponse);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        accessCalls.push(opts.body);
        return Promise.resolve({
          batch_id: opts.body.dry_run ? "" : "01JBATCH2",
          dry_run: Boolean(opts.body.dry_run),
          results: opts.body.items.map((_: unknown, index: number) => ({ index, status: "granted" })),
          preview: { users: [], groups: [], warnings: [] },
        });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAddSection();

    const combobox = screen.getByRole("combobox", { name: "Chọn đối tượng" });
    await user.click(combobox);
    let listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Nguyễn An/ }));

    await user.click(combobox);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /Trần Bình/ }));

    await user.click(combobox);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /Lê Chi/ }));

    expect(screen.getByText("Đã chọn 3")).toBeInTheDocument();
    // Trần Bình already has direct_level=view, so its chip defaults to "Giữ Chỉ xem".
    expect(screen.getByText("Giữ Chỉ xem")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Thiết lập quyền riêng" }));
    expect(screen.getByRole("status")).toHaveTextContent("3 Chỉ xem");

    // Set Nguyễn An to Chỉnh sửa.
    await user.click(screen.getByRole("combobox", { name: "Mức quyền của Nguyễn An" }));
    await user.click(await screen.findByRole("option", { name: "Chỉnh sửa" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 Chỉ xem · 1 Chỉnh sửa");

    // Clicking "Áp dụng cho tất cả" asks for confirmation before overwriting custom levels.
    await user.click(screen.getByRole("button", { name: "Áp dụng cho tất cả" }));
    expect(screen.getByText("Đặt tất cả 3 đối tượng thành Chỉ xem?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 Chỉ xem · 1 Chỉnh sửa");

    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));
    await waitFor(() => expect(accessCalls).toHaveLength(2));
    expect(accessCalls[1]?.items).toEqual([
      { principal_type: "user", principal_id: "u2", level: "edit" },
      { principal_type: "user", principal_id: "u3", level: "view", on_existing: "keep" },
      { principal_type: "user", principal_id: "u4", level: "view" },
    ]);
    expect(toast.success).toHaveBeenCalledWith("Đã chia sẻ cho 3 đối tượng");
  });

  it("shows dry_run preview confirmation on wide_scope warning before committing", async () => {
    const accessCalls: Array<{ items: unknown[]; dry_run?: boolean }> = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: any }) => {
      if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
        return Promise.resolve(candidatesResponse);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        accessCalls.push(opts.body);
        return Promise.resolve({
          batch_id: opts.body.dry_run ? "" : "01JBATCH3",
          dry_run: Boolean(opts.body.dry_run),
          results: [{ index: 0, status: "granted" }],
          preview: {
            users: [],
            groups: [
              {
                principal_type: "organization",
                principal_id: "o1",
                member_count: 42,
                losing_count: 0,
              },
            ],
            warnings: [{ code: "wide_scope", index: 0 }],
          },
        });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAddSection();

    await user.click(screen.getByRole("combobox", { name: "Chọn đối tượng" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Acme/ }));

    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));

    const confirmBox = await screen.findByTestId("share-add-confirm");
    expect(confirmBox).toHaveTextContent(
      "Chia sẻ cho toàn bộ Tổ chức Acme (42 thành viên) ở mức Chỉ xem",
    );
    expect(accessCalls).toHaveLength(1);
    expect(accessCalls[0]?.dry_run).toBe(true);

    await user.click(within(confirmBox).getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(accessCalls).toHaveLength(2));
    expect(accessCalls[1]?.dry_run).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Đã chia sẻ cho 1 đối tượng");
  });

  it("TV2-05: cancelling the share confirm hands focus back to the Chia sẻ button", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: { dry_run?: boolean } }) => {
      if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
        return Promise.resolve(candidatesResponse);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.resolve({
          batch_id: "",
          dry_run: Boolean(opts.body?.dry_run),
          results: [{ index: 0, status: "granted" }],
          preview: {
            users: [],
            groups: [{ principal_type: "organization", principal_id: "o1", member_count: 42, losing_count: 0 }],
            warnings: [{ code: "wide_scope", index: 0 }],
          },
        });
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAddSection();

    await user.click(screen.getByRole("combobox", { name: "Chọn đối tượng" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Acme/ }));

    const submit = screen.getByRole("button", { name: "Chia sẻ" });
    await user.click(submit);

    const confirmBox = await screen.findByTestId("share-add-confirm");
    await user.click(within(confirmBox).getByRole("button", { name: "Huỷ" }));

    await waitFor(() => expect(submit).toHaveFocus());
  });

  it("AC04/U-SH3: keeps chips, marks each rejected chip with its text reason, and fires no success toast on 422 document_access_rejected", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith("/api/v1/documents/d1/share-candidates")) {
        return Promise.resolve(candidatesResponse);
      }
      if (path === "/api/v1/documents/d1/access" && opts?.method === "PUT") {
        return Promise.reject(
          new ApiError("rejected", "document_access_rejected", 422, undefined, {
            rejected: [
              {
                index: 1,
                principal_type: "user",
                principal_id: "u4",
                code: "principal_not_in_organization",
              },
            ],
          }),
        );
      }
      return Promise.resolve({});
    });

    const user = userEvent.setup();
    renderAddSection();

    const combobox = screen.getByRole("combobox", { name: "Chọn đối tượng" });
    await user.click(combobox);
    let listbox = await screen.findByRole("listbox");
    await user.click(await within(listbox).findByRole("option", { name: /Nguyễn An/ }));

    await user.click(combobox);
    listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: /Lê Chi/ }));

    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));

    expect(await screen.findByTestId("rejected-reason-u4")).toHaveTextContent(
      "Không thuộc tổ chức này",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Lê Chi: Không thuộc tổ chức này");
    // Chips are kept so the user can remove the rejected one and retry.
    expect(screen.getByRole("button", { name: "Bỏ chọn Nguyễn An" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ chọn Lê Chi" })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
