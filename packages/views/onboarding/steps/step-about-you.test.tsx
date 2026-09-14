import { fireEvent, render, screen } from "@testing-library/react";
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

  it("toggles and untoggles a use case in the multi-select group", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={onChange} onAdvance={() => {}} onSkip={() => {}} />,
    );
    screen.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
    expect(onChange).toHaveBeenLastCalledWith({ use_case: ["meetings"], use_case_skipped: false });
    rerender(
      <StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, use_case: ["meetings"] }} onChange={onChange} onAdvance={() => {}} onSkip={() => {}} />,
    );
    expect(screen.getByRole("checkbox", { name: "Họp trực tuyến" })).toBeChecked();
    screen.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
    expect(onChange).toHaveBeenLastCalledWith({ use_case: [], use_case_skipped: false });
  });

  it("keeps continue blocked and names the empty Khác field as the blocker", () => {
    const { rerender } = render(
      <StepAboutYou
        answers={{ ...EMPTY_QUESTIONNAIRE, role: "other" }}
        onChange={() => {}}
        onAdvance={() => {}}
        onSkip={() => {}}
      />,
    );
    expectInactive(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(screen.getAllByText("Nhập nội dung cho mục Khác để tiếp tục.")[0]).toBeInTheDocument();
    // The same dead end reached from the multi-select group.
    rerender(
      <StepAboutYou
        answers={{ ...EMPTY_QUESTIONNAIRE, use_case: ["other"] }}
        onChange={() => {}}
        onAdvance={() => {}}
        onSkip={() => {}}
      />,
    );
    expectInactive(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(screen.getAllByText("Nhập nội dung cho mục Khác để tiếp tục.")[0]).toBeInTheDocument();
    // Typing the text is what unblocks it — and the hint says so.
    rerender(
      <StepAboutYou
        answers={{ ...EMPTY_QUESTIONNAIRE, use_case: ["other"], use_case_other: "Ghi chú" }}
        onChange={() => {}}
        onAdvance={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Tiếp tục" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getAllByText("Ổn rồi. Nhấn Tiếp tục khi bạn sẵn sàng.")[0]).toBeInTheDocument();
  });

  it("deselects Khác through the X button", () => {
    const onChange = vi.fn();
    render(
      <StepAboutYou
        answers={{ ...EMPTY_QUESTIONNAIRE, use_case: ["other"], use_case_other: "Ghi chú" }}
        onChange={onChange}
        onAdvance={() => {}}
        onSkip={() => {}}
      />,
    );
    screen.getByRole("button", { name: "Bỏ chọn Khác" }).click();
    expect(onChange).toHaveBeenCalledWith({ use_case: [], use_case_other: "" });
  });

  it("autofocuses the Khác field only when the choice came from a pointer", () => {
    // Arrow keys in a native radio group move AND select, so a keyboard user
    // passing over "Khác" must keep the roving ring instead of losing it to the
    // text field that has just mounted.
    const keyboard = render(
      <StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Khác" }));
    keyboard.rerender(
      <StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, role: "other" }} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: "Vai trò của bạn" })).not.toHaveFocus();
    keyboard.unmount();

    const pointer = render(
      <StepAboutYou answers={EMPTY_QUESTIONNAIRE} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />,
    );
    const chip = screen.getByRole("radio", { name: "Khác" });
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    pointer.rerender(
      <StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, role: "other" }} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />,
    );
    expect(screen.getByRole("textbox", { name: "Vai trò của bạn" })).toHaveFocus();
  });

  it("gives the selected chip its own dark-mode notch", () => {
    render(
      <StepAboutYou answers={{ ...EMPTY_QUESTIONNAIRE, role: "manager" }} onChange={() => {}} onAdvance={() => {}} onSkip={() => {}} />,
    );
    // Without the dark override the selected and unselected fills composite to
    // the same luminance (1.00:1 measured), leaving the Check glyph as the only
    // cue in the mode PRODUCT.md calls the default.
    const chip = screen.getByRole("radio", { name: "Quản lý" }).closest("[data-slot=option-chip]");
    expect(chip).toHaveClass("border-brand/70", "bg-brand/10", "dark:border-brand/80", "dark:bg-brand/16");
  });
});
