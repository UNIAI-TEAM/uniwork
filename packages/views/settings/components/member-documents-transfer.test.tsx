import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { OrgMembersSection } from "./org-members-section";

initI18n();

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const members = [
  { user_id: "u1", email: "ha@acme.vn", display_name: "Đỗ Thị Hà", role: "owner", created_at: "" },
  { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "member", created_at: "" },
  { user_id: "u4", email: "chi@acme.vn", display_name: "Lê Chi", role: "member", created_at: "" },
  {
    user_id: "u3",
    email: "binh@acme.vn",
    display_name: "Trần Bình",
    role: "member",
    created_at: "",
    deactivated_at: "2026-09-10T00:00:00Z",
  },
  {
    user_id: "u5",
    email: "duc@acme.vn",
    display_name: "Phạm Đức",
    role: "admin",
    created_at: "",
    deactivated_at: "2026-09-11T00:00:00Z",
  },
];

type Init = { method?: string; body?: Record<string, string> } | undefined;

const ownershipPath = (id: string) => `/api/v1/orgs/acme/members/${id}/document-ownership`;
const counted = { user_id: "u2", total: 3, workspaces: [{ workspace_id: "w1", workspace_name: "Team", count: 3 }] };
const batch = (over: Record<string, unknown>) => ({
  bulk_id: "b1",
  transferred: 0,
  skipped: { recipient_not_member: 0, self_restricted: 0 },
  has_more: false,
  cursor: "",
  ...over,
});

type Answers = {
  deactivate?: () => Promise<unknown>;
  /** The caller's own organization role (the member list's gates read it). */
  role?: string;
  count?: () => Promise<unknown>;
  transfer?: (init: Init, n: number) => Promise<unknown>;
};

function mockApi(answers: Answers = {}) {
  let transfers = 0;
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path.endsWith("/members/me")) return Promise.resolve({ role: answers.role ?? "owner" });
    if (path.includes("/members?")) return Promise.resolve({ members });
    if (path.endsWith("/document-ownership") && init?.method === "POST") {
      return (answers.transfer ?? (() => Promise.resolve(batch({ transferred: 3 }))))(init, transfers++);
    }
    if (path.endsWith("/document-ownership")) return (answers.count ?? (() => Promise.resolve(counted)))();
    if (path.endsWith("/deactivate") && answers.deactivate) return answers.deactivate();
    if (init?.method === "POST") return Promise.resolve({ status: "ok" });
    return Promise.resolve({});
  });
}

const posts = () =>
  requestMock.mock.calls
    .filter(([, init]) => (init as Init)?.method === "POST")
    .map(([path, init]) => [String(path), (init as Init)?.body] as const);
const countCalls = () =>
  requestMock.mock.calls.filter(([path, init]) => String(path).endsWith("/document-ownership") && !(init as Init)?.method)
    .length;

async function openDeactivate(name = "Nguyễn Văn An") {
  const ui = userEvent.setup();
  render(wrap(<OrgMembersSection orgSlug="acme" />));
  const row = (await screen.findByText(name)).closest("li")!;
  await ui.click(within(row).getByRole("button", { name: "Vô hiệu hóa" }));
  const dialog = await screen.findByRole("alertdialog");
  return { ui, dialog };
}

/** Types into the searchable picker (diacritics folded) and clicks the option whose name matches. */
async function pickRecipient(ui: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, name: string, query = name) {
  await ui.type(await within(dialog).findByRole("combobox", { name: "Chuyển cho" }), query);
  await ui.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

const memberPages = () =>
  requestMock.mock.calls.filter(([path]) => String(path).includes("/members?") && String(path).includes("status=active"))
    .length;

describe("deactivating a member with documents (DOC6-W02)", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("shows a spinner while counting and keeps Vô hiệu hóa enabled", async () => {
    mockApi({ count: () => new Promise(() => {}) });
    const { ui, dialog } = await openDeactivate();
    expect(within(dialog).getByText("Đang đếm tài liệu…")).toBeInTheDocument();
    const button = within(dialog).getByRole("button", { name: "Vô hiệu hóa" });
    expect(button).toBeEnabled();
    await ui.click(button);
    await waitFor(() => expect(posts()).toEqual([["/api/v1/orgs/acme/members/u2/deactivate", undefined]]));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("warns when the count fails, retries it, and still lets the admin deactivate", async () => {
    let attempts = 0;
    mockApi({ count: () => (attempts++ === 0 ? Promise.reject(new Error("offline")) : Promise.resolve(counted)) });
    const { ui, dialog } = await openDeactivate();
    expect(await within(dialog).findByText(/Chưa đếm được tài liệu/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Chuyển cho" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Vô hiệu hóa" })).toBeEnabled();

    await ui.click(within(dialog).getByRole("button", { name: "Thử lại" }));
    expect(await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.")).toBeInTheDocument();
    expect(countCalls()).toBe(2);
  });

  it("deactivates with no transfer step when the member owns nothing", async () => {
    mockApi({ count: () => Promise.resolve({ user_id: "u2", total: 0, workspaces: [] }) });
    const { ui, dialog } = await openDeactivate();
    await waitFor(() => expect(within(dialog).queryByText("Đang đếm tài liệu…")).not.toBeInTheDocument());
    expect(within(dialog).queryByText("Chuyển cho")).not.toBeInTheDocument();
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));
    await waitFor(() => expect(posts()).toEqual([["/api/v1/orgs/acme/members/u2/deactivate", undefined]]));
  });

  it("keeps Vô hiệu hóa focusable with aria-disabled while the lock is in flight, and never sends twice", async () => {
    mockApi({ deactivate: () => new Promise(() => {}) });
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    const button = within(dialog).getByRole("button", { name: "Vô hiệu hóa" });
    await ui.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("aria-busy", "true");
    await ui.click(button);
    expect(posts().filter(([path]) => path.endsWith("/deactivate"))).toHaveLength(1);
  });

  it("does not page through the members while counting, after a failed count, or with no documents", async () => {
    mockApi({ count: () => new Promise(() => {}) });
    let { dialog } = await openDeactivate();
    expect(within(dialog).getByText("Đang đếm tài liệu…")).toBeInTheDocument();
    expect(memberPages()).toBe(0);
    cleanup();

    mockApi({ count: () => Promise.reject(new Error("offline")) });
    ({ dialog } = await openDeactivate());
    await within(dialog).findByText(/Chưa đếm được tài liệu/);
    expect(memberPages()).toBe(0);
    cleanup();

    mockApi({ count: () => Promise.resolve({ user_id: "u2", total: 0, workspaces: [] }) });
    ({ dialog } = await openDeactivate());
    await waitFor(() => expect(within(dialog).queryByText("Đang đếm tài liệu…")).not.toBeInTheDocument());
    expect(memberPages()).toBe(0);
  });

  it("loads the members once there are documents to move, and the picker searches without diacritics", async () => {
    mockApi();
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    await waitFor(() => expect(memberPages()).toBeGreaterThan(0));
    await ui.type(within(dialog).getByRole("combobox", { name: "Chuyển cho" }), "le chi");
    expect(await screen.findByRole("option", { name: /Lê Chi/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Đỗ Thị Hà/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Để sau" })).toBeInTheDocument();
  });

  it("offers a recipient picker with Để sau, and Để sau transfers nothing", async () => {
    mockApi();
    const { ui, dialog } = await openDeactivate();
    expect(await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.")).toBeInTheDocument();
    expect(within(dialog).getByText("Team: 3")).toBeInTheDocument();
    await ui.type(within(dialog).getByRole("combobox", { name: "Chuyển cho" }), "a");
    // The member being deactivated and the deactivated ones are not offered.
    await screen.findByRole("option", { name: /Lê Chi/ });
    expect(screen.queryByRole("option", { name: /Nguyễn Văn An/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Trần Bình/ })).not.toBeInTheDocument();
    // "Để sau" stays listed whatever is typed.
    await ui.click(await screen.findByRole("option", { name: "Để sau" }));
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));
    await waitFor(() => expect(posts()).toEqual([["/api/v1/orgs/acme/members/u2/deactivate", undefined]]));
  });

  it("deactivates first, then moves the documents batch by batch and reports the skips", async () => {
    mockApi({
      transfer: (init, n) =>
        Promise.resolve(
          n === 0
            ? batch({ transferred: 2, has_more: true, cursor: "c1", skipped: { recipient_not_member: 1, self_restricted: 0 } })
            : batch({ transferred: 1, skipped: { recipient_not_member: 0, self_restricted: 2 } }),
        ),
    });
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    await pickRecipient(ui, dialog, "Lê Chi");
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));

    expect(await within(dialog).findByText("Đã chuyển 3 tài liệu cho Lê Chi.")).toBeInTheDocument();
    expect(posts().map(([path]) => path)).toEqual([
      "/api/v1/orgs/acme/members/u2/deactivate",
      ownershipPath("u2"),
      ownershipPath("u2"),
    ]);
    expect(posts()[1]![1]).toEqual({ to_user_id: "u4" });
    expect(posts()[2]![1]).toEqual({ to_user_id: "u4", bulk_id: "b1", cursor: "c1" });
    expect(within(dialog).getByText("1 tài liệu ở workspace mà Lê Chi chưa tham gia chưa được chuyển.")).toBeInTheDocument();
    expect(within(dialog).getByText("2 tài liệu riêng tư không thể chuyển cho chính bạn.")).toBeInTheDocument();
    // The result stays until the admin closes it.
    expect(within(dialog).getByRole("button", { name: "Đóng" })).toBeEnabled();
  });

  it("keeps the account deactivated when a batch fails and resumes from the last cursor on Thử lại", async () => {
    mockApi({
      transfer: (_init, n) =>
        n === 0
          ? Promise.resolve(batch({ transferred: 2, has_more: true, cursor: "c1" }))
          : n === 1
            ? Promise.reject(new Error("boom"))
            : Promise.resolve(batch({ transferred: 1 })),
    });
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    await pickRecipient(ui, dialog, "Lê Chi");
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));

    expect(await within(dialog).findByText(/Chưa chuyển được tài liệu\. Tài khoản đã được vô hiệu hóa/)).toBeInTheDocument();
    expect(within(dialog).getByText("Đã chuyển 2 tài liệu cho Lê Chi.")).toBeInTheDocument();
    await ui.click(within(dialog).getByRole("button", { name: "Thử lại" }));
    expect(await within(dialog).findByText("Đã chuyển 3 tài liệu cho Lê Chi.")).toBeInTheDocument();
    const last = posts().at(-1)!;
    expect(last[1]).toEqual({ to_user_id: "u4", bulk_id: "b1", cursor: "c1" });
    // One deactivate, never repeated by the retry.
    expect(posts().filter(([path]) => path.endsWith("/deactivate"))).toHaveLength(1);
  });
});

describe("the deactivation dialog after the account is locked (visual r1 F-02, F-03)", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("retitles itself and keeps focus inside, on the heading, once the lock is done", async () => {
    mockApi();
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    await pickRecipient(ui, dialog, "Lê Chi");
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));
    await within(dialog).findByText("Đã chuyển 3 tài liệu cho Lê Chi.");
    const heading = within(dialog).getByRole("heading", { name: "Nguyễn Văn An đã bị vô hiệu hóa" });
    // The confirmation question and its pre-confirm body are gone.
    expect(within(dialog).queryByText("Vô hiệu hóa Nguyễn Văn An?")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/sẽ không vào được tổ chức/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Chuyển tài liệu/)).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(heading);
  });

  it("keeps focus in the dialog when the first batch fails", async () => {
    mockApi({ transfer: () => Promise.reject(new Error("boom")) });
    const { ui, dialog } = await openDeactivate();
    await within(dialog).findByText("Nguyễn Văn An đang là chủ sở hữu của 3 tài liệu.");
    await pickRecipient(ui, dialog, "Lê Chi");
    await ui.click(within(dialog).getByRole("button", { name: "Vô hiệu hóa" }));
    await within(dialog).findByText(/Chưa chuyển được tài liệu\. Tài khoản đã được vô hiệu hóa/);
    expect(within(dialog).getByRole("heading", { name: "Nguyễn Văn An đã bị vô hiệu hóa" })).toBeInTheDocument();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("the row dialog's anatomy (visual r1 F-04, F-05, F-06)", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  async function openRow() {
    const ui = userEvent.setup();
    render(wrap(<OrgMembersSection orgSlug="acme" />));
    const row = (await screen.findByText("Trần Bình")).closest("li")!;
    await ui.click(within(row).getByRole("button", { name: "Chuyển tài liệu" }));
    return { ui, dialog: await screen.findByRole("dialog") };
  }

  it("offers only Đóng when there is nothing to move (no dead confirm)", async () => {
    mockApi({ count: () => Promise.resolve({ user_id: "u3", total: 0, workspaces: [] }) });
    const { dialog } = await openRow();
    await within(dialog).findByText("Trần Bình không còn sở hữu tài liệu nào.");
    expect(within(dialog).queryByRole("button", { name: "Chuyển" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Hủy" })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Đóng" })).toHaveLength(1);
  });

  it("says Chuyển tài liệu once, and offers one Đóng when the result is in", async () => {
    mockApi({ count: () => Promise.resolve({ ...counted, user_id: "u3" }) });
    const { ui, dialog } = await openRow();
    await within(dialog).findByText("Trần Bình đang là chủ sở hữu của 3 tài liệu.");
    expect(within(dialog).getAllByText("Chuyển tài liệu")).toHaveLength(1);
    await pickRecipient(ui, dialog, "Nguyễn Văn An");
    await ui.click(within(dialog).getByRole("button", { name: "Chuyển" }));
    await within(dialog).findByText("Đã chuyển 3 tài liệu cho Nguyễn Văn An.");
    expect(within(dialog).getAllByRole("button", { name: "Đóng" })).toHaveLength(1);
  });

  it("keeps the confirm on screen, busy and aria-disabled, while the batches run", async () => {
    mockApi({
      count: () => Promise.resolve({ ...counted, user_id: "u3" }),
      transfer: () => new Promise(() => {}),
    });
    const { ui, dialog } = await openRow();
    await within(dialog).findByText("Trần Bình đang là chủ sở hữu của 3 tài liệu.");
    await pickRecipient(ui, dialog, "Nguyễn Văn An");
    await ui.click(within(dialog).getByRole("button", { name: "Chuyển" }));
    const confirm = await within(dialog).findByRole("button", { name: "Chuyển" });
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).toHaveAttribute("aria-busy", "true");
  });
});

describe("Chuyển tài liệu on a deactivated row", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  async function openRow() {
    const ui = userEvent.setup();
    render(wrap(<OrgMembersSection orgSlug="acme" />));
    const row = (await screen.findByText("Trần Bình")).closest("li")!;
    await ui.click(within(row).getByRole("button", { name: "Chuyển tài liệu" }));
    return { ui, dialog: await screen.findByRole("dialog") };
  }

  it("says so when the member owns no documents", async () => {
    mockApi({ count: () => Promise.resolve({ user_id: "u3", total: 0, workspaces: [] }) });
    const { dialog } = await openRow();
    expect(await within(dialog).findByText("Trần Bình không còn sở hữu tài liệu nào.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Chuyển cho" })).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
  });

  it("transfers to the picked member only after the confirmation", async () => {
    mockApi({ count: () => Promise.resolve({ ...counted, user_id: "u3" }) });
    const { ui, dialog } = await openRow();
    await within(dialog).findByText("Trần Bình đang là chủ sở hữu của 3 tài liệu.");
    const submit = within(dialog).getByRole("button", { name: "Chuyển" });
    // aria-disabled, not disabled: the button stays reachable by keyboard.
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toHaveAttribute("disabled");
    await ui.click(submit);
    expect(posts()).toEqual([]);
    await pickRecipient(ui, dialog, "Nguyễn Văn An");
    expect(posts()).toEqual([]);
    await ui.click(submit);
    expect(await within(dialog).findByText("Đã chuyển 3 tài liệu cho Nguyễn Văn An.")).toBeInTheDocument();
    expect(posts()).toEqual([[ownershipPath("u3"), { to_user_id: "u2" }]]);
  });

  it("says the caller cannot act, not that counting failed, when the server refuses with 403", async () => {
    mockApi({ count: () => Promise.reject(new ApiError("forbidden", "forbidden", 403)) });
    const { dialog } = await openRow();
    expect(await within(dialog).findByText("Bạn không có quyền chuyển tài liệu của thành viên này.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Chưa đếm được tài liệu/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("is hidden on a deactivated admin when the caller is an admin (only the owner acts on admins)", async () => {
    mockApi({ role: "admin" });
    render(wrap(<OrgMembersSection orgSlug="acme" />));
    const admin = (await screen.findByText("Phạm Đức")).closest("li")!;
    const member = (await screen.findByText("Trần Bình")).closest("li")!;
    expect(within(member).getByRole("button", { name: "Chuyển tài liệu" })).toBeInTheDocument();
    expect(within(admin).queryByRole("button", { name: "Chuyển tài liệu" })).not.toBeInTheDocument();
  });

  it("is offered on a deactivated admin to the owner", async () => {
    mockApi({ role: "owner" });
    render(wrap(<OrgMembersSection orgSlug="acme" />));
    const admin = (await screen.findByText("Phạm Đức")).closest("li")!;
    expect(within(admin).getByRole("button", { name: "Chuyển tài liệu" })).toBeInTheDocument();
  });
});
