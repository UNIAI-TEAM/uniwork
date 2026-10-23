import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting } from "@uniwork/core/types";
import { requestMock } from "../test/api-mock";
import { MeetingAIAccessCard, MeetingAIRestrictedNotice } from "./meeting-ai-access-card";

const meeting = {
  id: "m1", workspace_id: "w1", title: "Đánh giá", description: "", starts_at: "2026-10-20T02:00:00Z",
  ends_at: "2026-10-20T03:00:00Z", room_name: "uw_mtg_m1", created_by: "u1", status: "SCHEDULED",
  scribe_enabled: true, ai_content_shared: false,
} satisfies Meeting;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function serve(policy: string, puts: { path: string; body: unknown }[] = []) {
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "PUT") {
      puts.push({ path, body: opts.body });
      return Promise.resolve({ meeting: { ...meeting, ...(opts.body as object) } });
    }
    if (path === "/api/v1/workspaces/w1/meeting-capabilities") {
      return Promise.resolve({ scribe: policy !== "off", scribe_policy: policy });
    }
    return Promise.resolve({});
  });
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

// UNI-1995 access: the scribe switch outside the room (#16) and the clerk's
// "share AI content with the workspace" switch (#4).
describe("MeetingAIAccessCard", () => {
  it("lets the host switch the scribe and a clerk share the AI content", async () => {
    const puts: { path: string; body: unknown }[] = [];
    serve("opt_in", puts);
    render(wrap(<MeetingAIAccessCard workspaceId="w1" meeting={meeting} canHost canClerk />));
    const scribe = await screen.findByRole("switch", { name: "Thư ký AI" });
    expect(scribe).toBeChecked();
    await userEvent.click(scribe);
    await userEvent.click(screen.getByRole("switch", { name: "Chia sẻ nội dung AI với cả workspace" }));
    await waitFor(() =>
      expect(puts).toEqual([
        { path: "/api/v1/meetings/m1/scribe", body: { enabled: false } },
        { path: "/api/v1/meetings/m1/ai-sharing", body: { shared: true } },
      ]),
    );
  });

  it("says the organization turned the scribe off instead of offering a switch that would be refused", async () => {
    serve("off");
    render(wrap(<MeetingAIAccessCard workspaceId="w1" meeting={meeting} canHost canClerk={false} />));
    expect(await screen.findByTestId("meeting-scribe-off-by-policy")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("shows a clerk who is not the host only the sharing switch, and a plain member nothing", async () => {
    serve("on");
    const { unmount } = render(wrap(<MeetingAIAccessCard workspaceId="w1" meeting={meeting} canHost={false} canClerk />));
    expect(await screen.findByRole("switch", { name: "Chia sẻ nội dung AI với cả workspace" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Thư ký AI" })).not.toBeInTheDocument();
    unmount();
    const { container } = render(wrap(<MeetingAIAccessCard workspaceId="w1" meeting={meeting} canHost={false} canClerk={false} />));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MeetingAIRestrictedNotice", () => {
  it("tells a member outside the meeting who the AI content is for", () => {
    render(<MeetingAIRestrictedNotice />);
    expect(screen.getByTestId("meeting-ai-restricted")).toHaveTextContent(/chỉ chủ trì, thư ký, người được mời/);
  });
});
