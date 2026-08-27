import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { StepSidebar } from "./step-sidebar";

initI18n();

describe("StepSidebar", () => {
  it("marks current step, lets only completed steps be clicked", () => {
    const onStepChange = vi.fn();
    render(<StepSidebar currentStep="workspace" onStepChange={onStepChange} />);
    const current = screen.getByText("Workspace").closest('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(screen.getByRole("button", { name: /Về bạn/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tổ chức/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mời đồng nghiệp/ })).toBeNull();
    screen.getByRole("button", { name: /Về bạn/ }).click();
    expect(onStepChange).toHaveBeenCalledWith("about_you");
  });
  it("locks rail when backDisabled", () => {
    render(<StepSidebar currentStep="workspace" onStepChange={() => {}} backDisabled />);
    expect(screen.queryByRole("button", { name: /Về bạn/ })).toBeNull();
  });
});
