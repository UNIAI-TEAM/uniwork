import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EMPTY_QUESTIONNAIRE } from "@uniwork/core/onboarding";
import { StepAboutYou } from "./step-about-you";
import { expectInactive } from "../../test/inactive";

initI18n();

describe("StepAboutYou", () => {
  it("disables continue until a group is answered; stamps skipped groups on continue", () => {
    const onChange = vi.fn();
    const onAdvance = vi.fn();
    const { rerender } = render(
      <StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={onChange} onAdvance={onAdvance} onSkip={() => {}} />,
    );
    expectInactive(screen.getByRole("button", { name: "Tiếp tục" }));
    screen.getByRole("radio", { name: "Quản lý" }).click();
    expect(onChange).toHaveBeenCalledWith({ role: "manager", role_other: "", role_skipped: false });
    rerender(
      <StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, role: "manager" }} onChange={onChange} onAdvance={onAdvance} onSkip={() => {}} />,
    );
    screen.getByRole("button", { name: "Tiếp tục" }).click();
    expect(onChange).toHaveBeenLastCalledWith({ use_case: [], use_case_other: "", use_case_skipped: true });
    expect(onAdvance).toHaveBeenCalled();
  });
  it("skip stamps both groups", () => {
    const onChange = vi.fn();
    const onSkip = vi.fn();
    render(<StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={onChange} onAdvance={() => {}} onSkip={onSkip} />);
    screen.getByRole("button", { name: "Bỏ qua" }).click();
    expect(onChange).toHaveBeenCalledWith({
      role: null, role_other: "", role_skipped: true, use_case: [], use_case_other: "", use_case_skipped: true,
    });
    expect(onSkip).toHaveBeenCalled();
  });
});
