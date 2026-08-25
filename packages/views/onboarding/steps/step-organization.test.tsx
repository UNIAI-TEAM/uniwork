import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { StepOrganization } from "./step-organization";
import { expectInactive } from "../../test/inactive";

initI18n();
beforeEach(() => requestMock.mockReset());

describe("StepOrganization", () => {
  it("shows inline error on 409", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("dup", "conflict", 409));
    render(wrap(<StepOrganization organizations={[]} selected={null} onSelected={() => {}} />));
    fireEvent.change(screen.getByLabelText("Tên tổ chức"), { target: { value: "Unicom" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo Unicom" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("đã có người dùng"));
  });
  it("resume: picking an existing org enables continue", () => {
    const onSelected = vi.fn();
    const org = { id: "o1", slug: "unicom", name: "Unicom", role: "owner" };
    render(wrap(<StepOrganization organizations={[org]} selected={null} onSelected={onSelected} />));
    expectInactive(screen.getByRole("button", { name: "Tiếp tục" }));
    fireEvent.click(screen.getByRole("radio", { name: /Unicom/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục với Unicom" }));
    expect(onSelected).toHaveBeenCalledWith(org);
  });
});
