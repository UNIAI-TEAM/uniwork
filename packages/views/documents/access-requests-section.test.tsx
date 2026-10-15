import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AccessRequestsSection } from "./access-requests-section";

// DOC7-W02 (manager side, access addendum §3.4): the "Yêu cầu truy cập" section
// of the share dialog. The transport is mocked with SDO-shaped answers
// (§4.3), so the real schemas stay in the loop.

const { t } = initI18n();
const LIST = "/api/v1/documents/d1/access-requests";

const binh = {
  id: "r1",
  requester_id: "u2",
  requester_name: "Bình",
  requested_level: "view",
  message: "Mình cần xem để chuẩn bị họp thứ Hai",
  source: { kind: "task", id: "t1", title: "Báo giá Q4" },
  created_at: "2026-10-15T01:00:00Z",
  expires_at: "2026-11-14T01:00:00Z",
};
const chi = {
  id: "r2",
  requester_id: "u3",
  requester_name: "Chi",
  requested_level: "edit",
  message: "",
  source: null,
  created_at: "2026-10-14T01:00:00Z",
  expires_at: "2026-11-13T01:00:00Z",
};

let pending: { requests: unknown[] };

function serve(over: { approve?: () => Promise<unknown>; decline?: () => Promise<unknown> } = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === LIST && !opts?.method) return Promise.resolve(pending);
    if (path === `${LIST}/r1/approve`) {
      return (
        over.approve?.() ??
        Promise.resolve({ id: "r1", status: "approved", share_id: "s1" }).then((res) => {
          pending = { requests: pending.requests.filter((r) => (r as { id: string }).id !== "r1") };
          return res;
        })
      );
    }
    if (path === `${LIST}/r1/decline`) {
      return (
        over.decline?.() ??
        Promise.resolve({ id: "r1", status: "declined" }).then((res) => {
          pending = { requests: pending.requests.filter((r) => (r as { id: string }).id !== "r1") };
          return res;
        })
      );
    }
    return Promise.resolve({});
  });
}

function renderSection(props: { focusOnOpen?: boolean } = {}) {
  return render(wrapWithNav(<AccessRequestsSection wsId="ws1" documentId="d1" {...props} />));
}

const calls = (path: string) => requestMock.mock.calls.filter((c) => c[0] === path);

async function pickOption(label: string, option: string | RegExp) {
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const item = await screen.findByRole("option", { name: option });
  // Base UI's select commits on a pointer press, not on a bare click.
  fireEvent.pointerDown(item, { pointerType: "mouse" });
  fireEvent.pointerUp(item, { pointerType: "mouse" });
  fireEvent.click(item);
  await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
}

beforeEach(() => {
  pending = { requests: [binh, chi] };
  serve();
});
afterEach(() => {
  requestMock.mockReset();
});

describe("AccessRequestsSection", () => {
  it("heads the section with the pending count and lists name, level asked, message, source and time", async () => {
    renderSection();
    await screen.findByText("Bình");
    const heading = await screen.findByRole("heading", { name: t("documents.access_request.section_title", { count: 2 }) });
    const section = heading.closest("section") as HTMLElement;
    const first = within(section).getByRole("listitem", { name: /Bình/ });
    expect(within(first).getByText("Bình")).toBeInTheDocument();
    expect(within(first).getByText("Mình cần xem để chuẩn bị họp thứ Hai")).toBeInTheDocument();
    // The caption line reads "level · source" (the select below shows the level too).
    const source = within(first).getByText(t("documents.access_request.row_source", { source: "Báo giá Q4" }));
    expect(source.parentElement).toHaveTextContent(`${t("documents.share.level_view")} · ${source.textContent}`);
    expect(first.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-15T01:00:00Z");
    // A source the manager cannot read, or none, reads as a plain link.
    const second = within(section).getByRole("listitem", { name: /Chi/ });
    const link = within(second).getByText(t("documents.access_request.row_source_unknown"));
    expect(link.parentElement).toHaveTextContent(`${t("documents.share.level_edit")} · ${link.textContent}`);
  });

  it("shows the empty state when nobody is waiting", async () => {
    pending = { requests: [] };
    renderSection();
    expect(await screen.findByText(t("documents.access_request.none_pending"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("documents.access_request.section_title", { count: 0 }) })).toBeInTheDocument();
  });

  it("offers the asked level and the other levels up to edit, and approves at the chosen one", async () => {
    renderSection();
    await screen.findByText("Bình");
    const first = screen.getByRole("listitem", { name: /Bình/ });
    const levelLabel = `${t("documents.share.level_label")} Bình`;
    fireEvent.click(within(first).getByRole("combobox", { name: levelLabel }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([t("documents.share.level_view"), t("documents.share.level_edit")]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await pickOption(levelLabel, t("documents.share.level_edit"));
    fireEvent.click(within(first).getByRole("button", { name: new RegExp(t("documents.access_request.approve")) }));
    await waitFor(() => expect(calls(`${LIST}/r1/approve`)).toHaveLength(1));
    expect(calls(`${LIST}/r1/approve`)[0]![1]).toMatchObject({ method: "POST", body: { level: "edit" } });
  });

  it("offers a lower level than asked (spec 3.1), never manage, defaulting to the asked one", async () => {
    renderSection();
    await screen.findByText("Chi");
    const row = screen.getByRole("listitem", { name: /Chi/ });
    const levelLabel = `${t("documents.share.level_label")} Chi`;
    const trigger = within(row).getByRole("combobox", { name: levelLabel });
    expect(trigger).toHaveTextContent(t("documents.share.level_edit"));
    fireEvent.click(trigger);
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([t("documents.share.level_view"), t("documents.share.level_edit")]);
    expect(options).not.toContain(t("documents.share.level_manage"));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    await pickOption(levelLabel, t("documents.share.level_view"));
    fireEvent.click(within(row).getByRole("button", { name: new RegExp(t("documents.access_request.approve")) }));
    await waitFor(() => expect(calls(`${LIST}/r2/approve`)).toHaveLength(1));
    expect(calls(`${LIST}/r2/approve`)[0]![1]).toMatchObject({ body: { level: "view" } });
  });

  it("keeps comment only on a request that asked for it", async () => {
    pending = { requests: [{ ...binh, id: "r3", requested_level: "comment" }] };
    renderSection();
    await screen.findByText("Bình");
    fireEvent.click(screen.getByRole("combobox", { name: `${t("documents.share.level_label")} Bình` }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([
      t("documents.share.level_view"),
      // No comment label exists until DOC-05 lands; the section falls back to the raw level.
      t("documents.share.level_comment", { defaultValue: "comment" }),
      t("documents.share.level_edit"),
    ]);
  });

  it("approves at the requested level by default, awaits the server, then drops the row and says so", async () => {
    let release: (v: unknown) => void = () => undefined;
    serve({ approve: () => new Promise((resolve) => { release = resolve; }) });
    renderSection();
    await screen.findByText("Bình");
    const first = screen.getByRole("listitem", { name: /Bình/ });
    const approve = within(first).getByRole("button", { name: new RegExp(t("documents.access_request.approve")) });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveAttribute("aria-disabled", "true"));
    expect(calls(`${LIST}/r1/approve`)[0]![1]).toMatchObject({ body: { level: "view" } });
    // Not optimistic: the row is still there and a second press is a no-op.
    expect(screen.getByRole("listitem", { name: /Bình/ })).toBeInTheDocument();
    fireEvent.click(approve);
    expect(calls(`${LIST}/r1/approve`)).toHaveLength(1);
    pending = { requests: [chi] };
    release({ id: "r1", status: "approved", share_id: "s1" });
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Bình/ })).not.toBeInTheDocument());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      t("documents.access_request.approved", { name: "Bình", level: t("documents.share.level_view") }),
    );
    expect(screen.getByRole("heading", { name: t("documents.access_request.section_title", { count: 1 }) })).toBeInTheDocument();
  });

  it("declines, waits for the server, then reports the decline", async () => {
    renderSection();
    await screen.findByText("Bình");
    const first = screen.getByRole("listitem", { name: /Bình/ });
    fireEvent.click(within(first).getByRole("button", { name: new RegExp(t("documents.access_request.decline")) }));
    await waitFor(() => expect(calls(`${LIST}/r1/decline`)).toHaveLength(1));
    expect(await screen.findByRole("status")).toHaveTextContent(t("documents.access_request.declined", { name: "Bình" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Bình/ })).not.toBeInTheDocument());
  });

  it("answers 409 access_request_closed with the handled-already line and reloads the list", async () => {
    serve({
      approve: () => {
        pending = { requests: [chi] };
        return Promise.reject(new ApiError("closed", "access_request_closed", 409));
      },
    });
    renderSection();
    await screen.findByText("Bình");
    const before = calls(LIST).length;
    const first = screen.getByRole("listitem", { name: /Bình/ });
    fireEvent.click(within(first).getByRole("button", { name: new RegExp(t("documents.access_request.approve")) }));
    expect(await screen.findByText(t("documents.access_request.closed"))).toBeInTheDocument();
    await waitFor(() => expect(calls(LIST).length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Bình/ })).not.toBeInTheDocument());
  });

  it("keeps the row and shows an alert when the decision fails for another reason", async () => {
    serve({ decline: () => Promise.reject(new ApiError("boom", "internal", 500)) });
    renderSection();
    await screen.findByText("Bình");
    const first = screen.getByRole("listitem", { name: /Bình/ });
    fireEvent.click(within(first).getByRole("button", { name: new RegExp(t("documents.access_request.decline")) }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /Bình/ })).toBeInTheDocument();
  });

  it("moves focus to the section heading when it was opened from the inbox link", async () => {
    renderSection({ focusOnOpen: true });
    const heading = await screen.findByRole("heading", { name: t("documents.access_request.section_title", { count: 2 }) });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("does not take focus when opened normally", async () => {
    renderSection();
    const heading = await screen.findByRole("heading", { name: t("documents.access_request.section_title", { count: 2 }) });
    expect(heading).not.toHaveFocus();
  });

  it("offers a retry when the list cannot be read", async () => {
    requestMock.mockReset();
    requestMock.mockImplementationOnce(() => Promise.reject(new ApiError("down", "internal", 500)));
    requestMock.mockImplementation(() => Promise.resolve(pending));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.share.retry") }));
    expect(await screen.findByText("Bình")).toBeInTheDocument();
  });
});
