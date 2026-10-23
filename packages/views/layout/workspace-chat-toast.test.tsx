import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceChatToast } from "./workspace-chat-toast";

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

const dm = (id: string, workspaceId: string, at: string) => ({
  id, kind: "chat_dm", workspace_id: workspaceId, resource_type: "chat_message", resource_id: `m-${id}`,
  resource_parent_id: "r1", actor_kind: "human", actor_id: "u9", title_key: "chat_dm",
  params: { actor: "Ngô Thanh Tâm", room: "" }, created_at: at,
});

let notifications: unknown[] = [];
const sent: { path: string; body: unknown }[] = [];

beforeEach(() => {
  notifications = [];
  sent.length = 0;
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path.startsWith("/api/v1/workspaces/w2/chat/rooms/r1/messages") && init?.method === "POST") {
      sent.push({ path, body: init.body });
      return Promise.resolve({});
    }
    if (path === "/api/v1/workspaces/w2/chat/rooms") {
      return Promise.resolve({
        rooms: [{
          id: "r1", kind: "dm", name: "", workspace_id: "w2", member_count: 2,
          last_message_sender_id: "u9", last_message_kind: "text", last_message_body: "Anh duyệt giúp em báo giá Đối tác ABC nhé",
        }],
      });
    }
    if (path.startsWith("/api/v1/workspaces")) return Promise.resolve({ workspaces: [tt, kd] });
    if (path.startsWith("/api/v1/me/notifications")) return Promise.resolve({ notifications });
    return Promise.resolve({});
  });
});

async function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const nav = fakeNav("/unicom/truyen-thong/chat");
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={tt} user={me}>
        <WorkspaceChatToast />
      </WorkspaceProvider>,
      nav,
      client,
    ),
  );
  // The first list is the backlog: nothing toasts for it.
  await vi.waitFor(() => expect(client.getQueryData(["notifications", "list", "", true, 20])).toBeDefined());
  const arrive = async (rows: unknown[]) => {
    notifications = rows;
    await act(() => client.refetchQueries({ queryKey: ["notifications"] }));
  };
  return { nav, arrive };
}

describe("WorkspaceChatToast", () => {
  it("shows a new DM from another workspace with its preview, and opens its room", async () => {
    const { nav, arrive } = await renderHost();
    expect(screen.queryByRole("status")).toBeNull();
    await arrive([dm("n1", "w2", "2026-10-18T03:44:00Z")]);
    const card = await screen.findByRole("status");
    expect(card).toHaveTextContent("Kinh doanh");
    expect(card).toHaveTextContent("Ngô Thanh Tâm");
    expect(await screen.findByText("Anh duyệt giúp em báo giá Đối tác ABC nhé")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    expect(nav.push).toHaveBeenCalledWith("/unicom/kinh-doanh/chat?room=r1&message=m-n1");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays quiet for the open workspace", async () => {
    const { arrive } = await renderHost();
    await arrive([dm("n2", "w1", "2026-10-18T03:45:00Z")]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sits in the conversation's anchor when the page marks one", async () => {
    const anchor = document.body.appendChild(document.createElement("div"));
    anchor.setAttribute("data-chat-toast-anchor", "");
    const { arrive } = await renderHost();
    await arrive([dm("n4", "w2", "2026-10-18T03:47:00Z")]);
    expect(anchor).toContainElement(await screen.findByRole("status"));
    anchor.remove();
  });

  it("answers from the card", async () => {
    const { arrive } = await renderHost();
    await arrive([dm("n3", "w2", "2026-10-18T03:46:00Z")]);
    fireEvent.click(await screen.findByRole("button", { name: "Trả lời nhanh" }));
    const field = screen.getByRole("textbox", { name: "Trả lời Ngô Thanh Tâm" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Ok em" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi" }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({ body: "Ok em" });
    await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
