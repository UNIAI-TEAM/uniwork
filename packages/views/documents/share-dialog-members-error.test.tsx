import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { ShareDialog } from "./share-dialog";

const { t } = initI18n();

// The candidates endpoint answers 404 here, so the picker uses its local
// fallback directory (a server answer, even an empty one, is never replaced).
const candidatesUnavailable = () => Promise.reject(new ApiError("not found", "not_found", 404));

const WS = "ws1";
const ORG = "o1";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

const doc: Document = {
  ...DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    organization_id: ORG,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "7",
    my_level: "manage",
    visibility: "workspace",
    updated_at: "2026-09-28T03:00:00Z",
  }),
} as Document;

/** Owner u9 and a grant to u2: u2 is on member page 1, u9 on page 2. */
const accessPayload = {
  my_level: "manage",
  via: "member",
  acl_owner: { user_id: "u9", level: "manage", via: "member" },
  shares: [
    {
      id: "s1",
      principal_type: "user",
      principal_id: "u2",
      level: "view",
      active: true,
      granted_by: "u1",
      granted_by_kind: "human",
      created_at: "2026-09-27T03:00:00Z",
    },
  ],
  links: [],
};

const page1 = {
  members: [
    { user_id: "u2", email: "binh@acme.vn", display_name: "Bình", role: "member", created_at: "" },
    { user_id: "u3", email: "chi@acme.vn", display_name: "Chi", role: "member", created_at: "" },
  ],
  next_cursor: "c2",
};
const page2 = {
  members: [
    { user_id: "u5", email: "minh@acme.vn", display_name: "Minh", role: "member", created_at: "" },
    { user_id: "u9", email: "owner@acme.vn", display_name: "Chủ Tài Liệu", role: "owner", created_at: "" },
  ],
  next_cursor: "",
};

/** `failPage1` / `failPage2` count how many more times that page answers 500. */
function serve(fails: { page1?: number; page2?: number }) {
  const left = { page1: fails.page1 ?? 0, page2: fails.page2 ?? 0 };
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/documents/d1/shares") return Promise.resolve(accessPayload);
    if (path.includes("/share-candidates")) return candidatesUnavailable();
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      const second = path.includes("cursor=c2");
      const key = second ? "page2" : "page1";
      if (left[key] > 0) {
        left[key] -= 1;
        return Promise.reject(new Error("members 500"));
      }
      return Promise.resolve(second ? page2 : page1);
    }
    if (path === `/api/v1/orgs/${ORG}/workspaces`) return Promise.resolve({ workspaces: [] });
    return Promise.resolve({});
  });
}

function renderDialog() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ShareDialog open onOpenChange={() => undefined} wsId={WS} doc={doc} />
      </WorkspaceProvider>,
    ),
  );
}

/** Search the people picker by name and pick the match. */
async function pickPerson(name: string) {
  const input = screen.getByRole("combobox", { name: t("documents.share.principal_placeholder") });
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.change(input, { target: { value: name } });
  const item = await screen.findByRole("option", { name: new RegExp(name) });
  fireEvent.click(item);
  await screen.findByRole("button", { name: t("documents.share.people_remove", { name }) });
}

beforeEach(() => {
  serve({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfig();
});

describe("ShareDialog member loading errors", () => {
  it("first page fails: error line + Retry, rows stay neutral, Retry names them", async () => {
    serve({ page1: 1 });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(t("documents.share.members_error_first"))).toBeInTheDocument();
    // Not final: neither "Unknown member" nor a raw id stands in for a name.
    expect(screen.queryByText(t("documents.share.person_unknown"))).toBeNull();
    expect(screen.queryByText("u2")).toBeNull();
    expect(screen.queryByText("u9")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: t("documents.share.retry") }));

    expect(await screen.findByText("Bình")).toBeInTheDocument();
    expect(await screen.findByText("Chủ Tài Liệu")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText(t("documents.share.person_unknown"))).toBeNull();
  });

  it("first page fails: Retry is aria-disabled (keeps focus) with a spinner while page 1 reloads, the line stays", async () => {
    serve({ page1: 1 });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));
    const alert = await screen.findByRole("alert");

    // The retry's page-1 answer is held until the test releases it.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = requestMock.getMockImplementation();
    requestMock.mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (String(path).startsWith("/api/v1/orgs/acme/members") && !String(path).includes("cursor=")) await held;
      return answer?.(path, ...rest);
    });

    const user = userEvent.setup();
    const retry = within(alert).getByRole("button", { name: t("documents.share.retry") });
    retry.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    // aria-disabled, not native disabled: the button stays in the tab order
    // and keeps keyboard focus while the retry is in flight.
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(retry).not.toBeDisabled();
    expect(document.activeElement).toBe(retry);
    expect(retry.querySelector("svg.animate-spin")).not.toBeNull();
    // The line does not flash away while the retry is in flight.
    expect(screen.getByRole("alert")).toBe(alert);
    const callsBefore = requestMock.mock.calls.length;
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(retry);
    expect(requestMock.mock.calls).toHaveLength(callsBefore);
    expect(document.activeElement).toBe(retry);

    release();
    expect(await screen.findByText("Bình")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("later page fails: page-1 people stay pickable, error line shown, Retry resumes the walk", async () => {
    serve({ page2: 1 });
    renderDialog();
    await screen.findByText(t("documents.share.access_title"));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(t("documents.share.members_error_partial"))).toBeInTheDocument();
    // The owner's page is missing, so their name is not "Unknown" yet.
    expect(screen.queryByText(t("documents.share.person_unknown"))).toBeNull();
    await pickPerson("Chi");
    expect(screen.queryByRole("option", { name: /Minh/ })).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: t("documents.share.retry") }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("Chủ Tài Liệu")).toBeInTheDocument();
    await pickPerson("Minh");
    // Page 2 was requested twice: the failure and the retry from that page.
    const page2Calls = requestMock.mock.calls.filter(([p]) => String(p).includes("cursor=c2"));
    expect(page2Calls).toHaveLength(2);
    // Resuming does not restart from page 1.
    const page1Calls = requestMock.mock.calls.filter(
      ([p]) => String(p).startsWith("/api/v1/orgs/acme/members") && !String(p).includes("cursor="),
    );
    expect(page1Calls).toHaveLength(1);
  });

  it("page bound hit with a cursor left: says so and offers no Retry", async () => {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/shares") return Promise.resolve(accessPayload);
      if (path.includes("/share-candidates")) return candidatesUnavailable();
      if (path.startsWith("/api/v1/orgs/acme/members")) {
        // Every page names a next cursor, as a runaway server would.
        return Promise.resolve({ members: [], next_cursor: `c${Math.random()}` });
      }
      return Promise.resolve({});
    });
    renderDialog();

    const alert = await screen.findByRole("alert", undefined, { timeout: 8000 });
    expect(within(alert).getByText(t("documents.share.members_error_limit"))).toBeInTheDocument();
    expect(within(alert).queryByRole("button")).toBeNull();
    expect(requestMock.mock.calls.filter(([p]) => String(p).startsWith("/api/v1/orgs/acme/members"))).toHaveLength(40);
  });
});
