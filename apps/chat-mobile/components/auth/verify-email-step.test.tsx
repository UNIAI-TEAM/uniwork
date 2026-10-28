import { act, fireEvent, screen } from "@testing-library/react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/data/auth/store";
import { useResendVerification, useVerifyEmail } from "@/data/mutations/account";
import { render, viText } from "@/test/render";
import { VerifyEmailStep } from "./verify-email-step";

jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("@/data/mutations/account", () => ({ useVerifyEmail: jest.fn(), useResendVerification: jest.fn() }));

const apiError = (code: string, status: number) => Object.assign(new Error(code), { name: "ApiError", status, body: { error: { code } } });
const verify = { mutateAsync: jest.fn(async (_code: string) => undefined), isPending: false };
const resend = { mutateAsync: jest.fn(async (_: undefined) => undefined), isPending: false };

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
  jest.mocked(useVerifyEmail).mockReturnValue(verify as never);
  jest.mocked(useResendVerification).mockReturnValue(resend as never);
  useAuthStore.setState({ user: { id: "u1", email: "moi@congty.vn", display_name: "Mới", email_verified_at: null } as never });
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("VerifyEmailStep", () => {
  it("counts the first minute down before a code may be mailed again, then mails it and says so", async () => {
    await render(<VerifyEmailStep />);
    expect(screen.getByText(viText("auth.verify.subtitle", { email: "moi@congty.vn" }))).toBeTruthy();
    expect(screen.getByText(viText("auth.verify.resendIn", { seconds: 60 }))).toBeTruthy();
    expect(screen.getByTestId("verify-resend")).toBeDisabled();
    await act(async () => jest.advanceTimersByTime(60_000));
    await act(async () => fireEvent.press(screen.getByTestId("verify-resend")));
    expect(resend.mutateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText(viText("auth.verify.resent"))).toBeTruthy();
    expect(screen.getByTestId("verify-resend")).toBeDisabled();
  });

  it("says a code asked again too soon, and waits the minute again", async () => {
    resend.mutateAsync.mockRejectedValueOnce(apiError("rate_limited", 429));
    await render(<VerifyEmailStep />);
    await act(async () => jest.advanceTimersByTime(60_000));
    await act(async () => fireEvent.press(screen.getByTestId("verify-resend")));
    expect(screen.getByText(viText("auth.verify.resendTooSoon"))).toBeTruthy();
    expect(screen.getByTestId("verify-resend")).toBeDisabled();
  });

  it("says another refusal of the resend in its own words", async () => {
    resend.mutateAsync.mockRejectedValueOnce(apiError("internal", 500));
    await render(<VerifyEmailStep />);
    await act(async () => jest.advanceTimersByTime(60_000));
    await act(async () => fireEvent.press(screen.getByTestId("verify-resend")));
    expect(screen.getByText(viText("auth.social.errors.server"))).toBeTruthy();
  });

  it("checks the six digits, clears a wrong code, and shows the check running", async () => {
    verify.mutateAsync.mockRejectedValueOnce(apiError("invalid_code", 400));
    const { rerender } = await render(<VerifyEmailStep />);
    await act(async () => fireEvent.changeText(screen.getByTestId("verify-code"), "111111"));
    expect(verify.mutateAsync).toHaveBeenCalledWith("111111");
    expect(screen.getByText(viText("auth.verify.invalidCode"))).toBeTruthy();
    expect(screen.getByTestId("verify-code").props.value).toBe("");
    jest.mocked(useVerifyEmail).mockReturnValue({ ...verify, isPending: true } as never);
    await rerender(<VerifyEmailStep />);
    expect(screen.getByLabelText(viText("auth.verify.verifying"))).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("verify-code"), "222222"));
    expect(verify.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("signs out for a wrong address, and opens Settings to delete the account", async () => {
    const logout = jest.fn(async () => undefined);
    useAuthStore.setState({ logout });
    await render(<VerifyEmailStep />);
    await act(async () => fireEvent.press(screen.getByTestId("verify-logout")));
    expect(logout).toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("verify-settings")));
    expect(router.push).toHaveBeenCalledWith("/account");
  });
});
