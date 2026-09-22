import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MemberMultiPicker } from "./member-multi-picker";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

function membersRespond(members: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/members") ? members() : Promise.resolve({}),
  );
}

const EMPTY = "Chưa có thành viên khác trong workspace.";

function renderPicker() {
  render(wrapWithNav(<MemberMultiPicker workspaceId="w1" value={[]} onChange={() => {}} />));
}

describe("MemberMultiPicker", () => {
  it("shows a loading skeleton, not the empty copy, while members load", () => {
    membersRespond(() => new Promise(() => {}));
    renderPicker();

    expect(screen.getByRole("status")).toHaveTextContent("Đang tải…");
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  });

  it("shows the empty copy once no other member arrives", async () => {
    membersRespond(() => Promise.resolve({ members: [] }));
    renderPicker();

    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });

  it("offers a retry instead of the empty copy when members fail", async () => {
    membersRespond(() => Promise.reject(new ApiError("boom", "internal", 500)));
    renderPicker();

    expect(await screen.findByText("Không tải được danh sách thành viên.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

    membersRespond(() => Promise.resolve({ members: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();
  });
});
