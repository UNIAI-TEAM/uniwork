import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../../test/api-mock";
import { PushPreviewPolicySection } from "./push-preview-policy-section";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

// The host renders Vietnamese (test/api-mock.tsx › localeAdapter).
const SWITCH = "Ẩn nội dung tin trong thông báo";
const HINT = "Áp dụng cho mọi thành viên: thông báo tin nhắn chỉ nói có tin mới, ai gửi và ở đâu, không hiện chữ trong tin.";

type Init = { method?: string; body?: { hidden?: boolean } };

function serve(policy: Record<string, unknown>, put?: (init: Init) => Promise<unknown>) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path === "/api/v1/orgs/acme/push-preview-policy" && init?.method === "PUT") {
      return put?.(init) ?? Promise.resolve({ ...policy, hidden: init.body?.hidden ?? false });
    }
    if (path === "/api/v1/orgs/acme/push-preview-policy") return Promise.resolve(policy);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  requestMock.mockReset();
  toastError.mockReset();
});

describe("PushPreviewPolicySection", () => {
  it("lets an owner or admin hide the words of every chat push, and says what that does", async () => {
    serve({ hidden: false, hidden_at: null, can_manage: true });
    render(wrap(<PushPreviewPolicySection orgSlug="acme" />));
    const toggle = await screen.findByRole("switch", { name: SWITCH });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(HINT)).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "true"));
    const put = requestMock.mock.calls.find(([, init]) => (init as Init | undefined)?.method === "PUT");
    expect(put).toEqual(["/api/v1/orgs/acme/push-preview-policy", { method: "PUT", body: { hidden: true } }]);
  });

  it("shows nothing to a member who cannot change it", async () => {
    serve({ hidden: true, hidden_at: "2026-10-22T08:00:00Z", can_manage: false });
    const { container } = render(wrap(<PushPreviewPolicySection orgSlug="acme" />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(requestMock).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the server refused, and keeps the switch where it was", async () => {
    serve({ hidden: false, hidden_at: null, can_manage: true }, () => Promise.reject(Object.assign(new Error("forbidden"), { status: 403 })));
    render(wrap(<PushPreviewPolicySection orgSlug="acme" />));
    fireEvent.click(await screen.findByRole("switch", { name: SWITCH }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("switch", { name: SWITCH })).toHaveAttribute("aria-checked", "false");
  });
});
