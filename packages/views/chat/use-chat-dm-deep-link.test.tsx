import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { useChatDmDeepLink } from "./use-chat-dm-deep-link";

const user = { id: "u1", email: "ha@acme.vn", display_name: "Hà", locale: "vi" } as User;
const workspace: Workspace = {
  id: "ws1",
  slug: "doi",
  name: "Đội",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function nav(search: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/chat",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function run(search: string, person: Record<string, unknown> | null) {
  requestMock.mockImplementation((path?: string) =>
    path?.startsWith("/api/v1/orgs/acme/people/")
      ? person
        ? Promise.resolve({ person, reports: [] })
        : Promise.reject(new Error("not found"))
      : Promise.resolve({}),
  );
  const open = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) =>
    wrap(
      <NavigationProvider value={nav(search)}>
        <WorkspaceProvider workspace={workspace} user={user}>
          {children}
        </WorkspaceProvider>
      </NavigationProvider>,
    );
  renderHook(() => useChatDmDeepLink(open, true), { wrapper });
  return open;
}

/** Directory lookups only; the shell makes calls of its own. */
function peopleCalls(): number {
  return requestMock.mock.calls.filter(([path]) => String(path).startsWith("/api/v1/orgs/acme/people/")).length;
}

const an = {
  user_id: "u2",
  display_name: "Nguyễn Văn Ân",
  email: "an@acme.vn",
  org_role: "member",
  status: "active",
};

describe("useChatDmDeepLink", () => {
  beforeEach(() => requestMock.mockReset());

  it("opens the conversation with the person the link names, named from the directory", async () => {
    const open = run("dm=u2", an);
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith({
        kind: "dm",
        contact: { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn Ân" },
      }),
    );
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a deactivated person, the reader, or someone not found", async () => {
    const deactivated = run("dm=u2", { ...an, status: "deactivated" });
    const self = run("dm=u2", { ...an, is_self: true });
    const missing = run("dm=u9", null);
    await waitFor(() => expect(peopleCalls()).toBe(3));
    await new Promise((r) => setTimeout(r, 50));
    expect(deactivated).not.toHaveBeenCalled();
    expect(self).not.toHaveBeenCalled();
    expect(missing).not.toHaveBeenCalled();
  });

  it("stays out of the way without a link", () => {
    const open = run("", an);
    expect(open).not.toHaveBeenCalled();
    expect(peopleCalls()).toBe(0);
  });
});
