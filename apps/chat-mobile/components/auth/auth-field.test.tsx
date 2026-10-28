import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import { render, viText } from "@/test/render";
import { AuthField, FieldNote, PasswordField } from "./auth-field";
import { CodeField } from "./code-field";

describe("AuthField", () => {
  it("names the input with its label for screen readers, and gives its error as the hint once there is one", async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { rerender } = await render(<AuthField label="Email" hint="ví dụ" value="" onFocus={onFocus} onBlur={onBlur} testID="field" />);
    const input = screen.getByTestId("field");
    expect(input.props.accessibilityLabel).toBe("Email");
    expect(input.props.accessibilityHint).toBe("ví dụ");
    expect(screen.getByText("ví dụ")).toBeTruthy();
    await act(async () => fireEvent(input, "focus"));
    await act(async () => fireEvent(input, "blur"));
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await rerender(<AuthField label="Email" hint="ví dụ" value="" error="Nhập email" testID="field" />);
    expect(screen.getByTestId("field").props.accessibilityHint).toBe("Nhập email");
    expect(screen.getByText("Nhập email")).toBeTruthy();
    expect(screen.queryByText("ví dụ")).toBeNull();
    if (Platform.OS === "ios") expect(announce).toHaveBeenCalledWith("Nhập email");
  });

  it("keeps a field it cannot edit now on screen, and works with no hint", async () => {
    await render(<AuthField label="Tên" value="An" editable={false} testID="field" />);
    expect(screen.getByTestId("field").props.editable).toBe(false);
    expect(screen.getByTestId("field").props.accessibilityHint).toBeUndefined();
  });
});

describe("PasswordField", () => {
  it("hides the password until asked, then shows it, and asks the system for a new one when creating", async () => {
    const { rerender } = await render(<PasswordField label="Mật khẩu" value="pw" testID="pw" />);
    expect(screen.getByTestId("pw").props).toMatchObject({ secureTextEntry: true, textContentType: "password", autoComplete: "current-password" });
    const toggle = screen.getByTestId("pw-toggle");
    expect(toggle.props.accessibilityLabel).toBe(viText("common.show_password"));
    await act(async () => fireEvent.press(toggle));
    expect(screen.getByTestId("pw").props.secureTextEntry).toBe(false);
    expect(screen.getByTestId("pw-toggle").props.accessibilityLabel).toBe(viText("common.hide_password"));
    await rerender(<PasswordField create label="Mật khẩu" value="" />);
    expect(screen.getByLabelText("Mật khẩu").props).toMatchObject({
      textContentType: "newPassword",
      autoComplete: "new-password",
      passwordRules: "minlength: 8;",
    });
  });
});

describe("FieldNote", () => {
  it("says nothing without an error or a hint", async () => {
    await render(<FieldNote />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe("CodeField", () => {
  it("draws each digit in its box, keeps digits only, and hands on a full code once", async () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const { rerender } = await render(<CodeField label="Mã" value="" onChange={onChange} onComplete={onComplete} testID="code" />);
    const input = screen.getByTestId("code");
    expect(input.props).toMatchObject({ textContentType: "oneTimeCode", keyboardType: "number-pad", maxLength: 6, accessibilityLabel: "Mã" });
    await act(async () => fireEvent(input, "focus"));
    await act(async () => fireEvent.changeText(input, "12a3"));
    expect(onChange).toHaveBeenLastCalledWith("123");
    expect(onComplete).not.toHaveBeenCalled();
    await rerender(<CodeField label="Mã" value="123" onChange={onChange} onComplete={onComplete} testID="code" />);
    // The boxes are drawn for the eye only: the input carries the code for screen readers.
    expect(screen.getByText("1", { includeHiddenElements: true })).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("code"), "123 456"));
    expect(onComplete).toHaveBeenCalledWith("123456");
    await rerender(<CodeField label="Mã" value="123456" onChange={onChange} onComplete={onComplete} testID="code" />);
    await act(async () => fireEvent.changeText(screen.getByTestId("code"), "123456"));
    expect(onComplete).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent(screen.getByTestId("code"), "blur"));
  });

  it("keeps the field but takes no typing while a check runs or a lock waits, and says its error", async () => {
    const { rerender } = await render(<CodeField label="Mã" value="" busy onChange={jest.fn()} onComplete={jest.fn()} hint="6 số" testID="code" />);
    expect(screen.getByTestId("code").props.editable).toBe(false);
    expect(screen.getByTestId("code").props.accessibilityState).toEqual({ busy: true, disabled: false });
    expect(screen.getByText("6 số")).toBeTruthy();
    await rerender(<CodeField label="Mã" value="" disabled error="Mã chưa đúng" onChange={jest.fn()} onComplete={jest.fn()} testID="code" />);
    expect(screen.getByTestId("code").props.editable).toBe(false);
    expect(screen.getByText("Mã chưa đúng")).toBeTruthy();
  });
});
