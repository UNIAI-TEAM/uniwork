import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { StepWorkspace } from "./step-workspace";

initI18n();
beforeEach(() => requestMock.mockReset());
const org = { id: "o1", slug: "unicom", name: "Unicom" };

describe("StepWorkspace", () => {
  it("creates in the given org and reports busy", async () => {
    // resolve chậm để trạng thái busy quan sát được
    requestMock.mockImplementationOnce(
      () =>
        new Promise((r) =>
          setTimeout(
            () => r({ workspace: { id: "w1", slug: "doi-alpha", name: "Đội Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" } }),
            30,
          ),
        ),
    );
    const onCreated = vi.fn();
    const onBusy = vi.fn();
    render(wrap(<StepWorkspace organization={org} existing={[]} onCreated={onCreated} onBusyChange={onBusy} />));
    expect(screen.getByText("localhost:3000/unicom/")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: "Đội Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Đội Alpha" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ slug: "doi-alpha" })));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/workspaces", expect.objectContaining({ method: "POST" }));
    expect(onBusy).toHaveBeenCalledWith(true);
  });
  it("409 → inline error", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    render(wrap(<StepWorkspace organization={org} existing={[]} onCreated={() => {}} />));
    fireEvent.change(screen.getByLabelText("Tên workspace"), { target: { value: "Đội Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Đội Alpha" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });
});
