import { act, renderHook } from "@testing-library/react-native";
// The auth store reaches the query client, which reads NetInfo; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
import type { SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import * as Haptics from "expo-haptics";
import { useNavigation } from "expo-router";
import { BackHandler, Platform } from "react-native";
import { holdStep, forgetPendingSignIn, usePendingSignIn } from "@/data/auth/pending-sign-in";
import type { SignInOutcome } from "@/data/auth/sign-in";
import { useAuthStore } from "@/data/auth/store";
import { useToastStore } from "@/data/stores/toast-store";
import { viText } from "@/test/render";
import { useCountdown } from "./use-countdown";
import { shownFailure, useFailureMessage, useSignIn, type ShownFailure } from "./use-sign-in";
import { useStepBack } from "./use-step-back";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/lib/i18n/singleton";

const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
const failure = (over: Partial<SignInFailure>): SignInFailure => ({
  code: "x",
  status: null,
  kind: "form",
  key: "auth.social.errors.generic",
  values: {},
  provider: null,
  retryAfterSeconds: null,
  retry: null,
  proofs: null,
  maskedEmail: null,
  ...over,
});

const realLogin = useAuthStore.getState().login;
afterEach(() => {
  jest.useRealTimers();
  forgetPendingSignIn();
  useToastStore.getState().clear();
  useAuthStore.setState({ user: null, login: realLogin });
});

describe("useFailureMessage", () => {
  it("counts a wait down to its deadline, said as it began rather than at each tick, then has nothing left to say", async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const locked = shownFailure(failure({ kind: "wait", key: "auth.social.errors.second_factor_locked", retryAfterSeconds: 2 }), 1_000_000);
    expect(locked.deadlineMs).toBe(1_002_000);
    const { result } = await renderHook(() => useFailureMessage(locked), { wrapper });
    const sentence = viText("auth.social.errors.second_factor_locked");
    const asBegun = `${sentence} ${viText("auth.social.retry.seconds", { count: 2 })}`;
    expect(result.current).toEqual({ message: asBegun, spoken: asBegun, waiting: true });
    await act(async () => jest.advanceTimersByTime(1_000));
    // The eye sees the countdown; a screen reader keeps the line it heard once.
    expect(result.current).toEqual({ message: `${sentence} ${viText("auth.social.retry.seconds", { count: 1 })}`, spoken: asBegun, waiting: true });
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(result.current).toEqual({ message: null, spoken: null, waiting: false });
  });

  it("says a wait with no deadline with its phrase, and any other failure as its sentence", async () => {
    const later = shownFailure(failure({ kind: "wait", key: "auth.social.errors.rate_limited", retry: { key: "auth.social.retry.later" } }));
    const { result, rerender } = await renderHook<ReturnType<typeof useFailureMessage>, { shown: ShownFailure | null }>(
      ({ shown }) => useFailureMessage(shown),
      { wrapper, initialProps: { shown: later } },
    );
    expect(result.current.message).toBe(`${viText("auth.social.errors.rate_limited")} ${viText("auth.social.retry.later")}`);
    await rerender({ shown: shownFailure(failure({ kind: "wait", key: "auth.social.errors.rate_limited" })) });
    expect(result.current.message).toBe(viText("auth.social.errors.rate_limited"));
    await rerender({ shown: shownFailure(failure({})) });
    expect(result.current).toEqual({ message: viText("auth.social.errors.generic"), spoken: null, waiting: false });
    await rerender({ shown: null });
    expect(result.current).toEqual({ message: null, spoken: null, waiting: false });
  });

  it("names the provider a failure names, in the screen's language", async () => {
    const unmatched = shownFailure(failure({ key: "mobile.sign_in.link_unmatched", provider: "apple" }));
    const { result } = await renderHook(() => useFailureMessage(unmatched), { wrapper });
    expect(result.current.message).toBe(viText("mobile.sign_in.link_unmatched", { provider: "Apple" }));
    expect(result.current.message).toMatch(/Apple/);
  });
});

describe("useSignIn", () => {
  it("runs one sign-in at a time, and says once what the session brought", async () => {
    holdStep({ kind: "mfa", token: "m", context: { method: "google", email: "an@gmail.com", provider: "google" } }, Date.now());
    let finish: (outcome: SignInOutcome) => void = () => undefined;
    const login = jest.fn(() => new Promise<SignInOutcome>((resolve) => (finish = resolve)));
    useAuthStore.setState({ login });
    const { result } = await renderHook(() => useSignIn("second_factor"), { wrapper });
    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = result.current.run({ method: "second_factor", code: "123456" }, "verify");
    });
    expect(result.current.busy).toBe("verify");
    await act(async () => expect(await result.current.run({ method: "second_factor", code: "1" })).toBeNull());
    await act(async () => {
      finish({ kind: "signed_in", reclaimed: true, linkSkipped: "provider_taken" });
      await first;
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBeNull();
    expect(useToastStore.getState().toasts.map((t) => [t.tone, t.message])).toEqual([
      ["success", viText("auth.social.reclaimed")],
      ["info", viText("auth.social.linkSkipped.withProvider", { provider: "Google" })],
    ]);
  });

  it("tells a skipped link without a provider in the generic words, and keeps the failure off an unmounted screen", async () => {
    useAuthStore.setState({ login: jest.fn(async () => ({ kind: "signed_in", reclaimed: false, linkSkipped: "x" }) as SignInOutcome) });
    const { result, unmount } = await renderHook(() => useSignIn("sign_in"), { wrapper });
    await act(async () => void (await result.current.run({ method: "password", email: "a@b.c", password: "p" })));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([viText("auth.social.linkSkipped.generic")]);
    await act(async () => useAuthStore.setState({ login: jest.fn(async () => Promise.reject(new Error("late"))) }));
    const run = result.current.run;
    await unmount();
    await act(async () => expect(await run({ method: "browser" })).toMatchObject({ ok: false }));
    expect(usePendingSignIn.getState().interrupted).toBeNull();
  });
});

describe("a sign-in to link an identity held", () => {
  it("asks a provider's sheet to link, and says one that matches no account either without leaving the screen", async () => {
    const login = jest.fn(async (): Promise<SignInOutcome> => ({ kind: "unmatched", provider: "apple" }));
    useAuthStore.setState({ login });
    const { result } = await renderHook(() => useSignIn("sign_in", { linkMode: true }), { wrapper });
    let answer: unknown;
    await act(async () => {
      answer = await result.current.run({ method: "apple" }, "apple");
    });
    expect(login).toHaveBeenCalledWith({ method: "apple", linking: true });
    expect(answer).toMatchObject({ ok: false, failure: { key: "mobile.sign_in.link_unmatched", provider: "apple" } });
    expect(result.current.shown?.failure).toMatchObject({ key: "mobile.sign_in.link_unmatched", provider: "apple" });
    // A password is no provider's sheet: sent as it is.
    await act(async () => void (await result.current.run({ method: "password", email: "a@b.c", password: "p" }, "password")));
    expect(login).toHaveBeenLastCalledWith({ method: "password", email: "a@b.c", password: "p" });
  });
});

describe("a failed sign-in", () => {
  it("is felt as the system's error, and said", async () => {
    useAuthStore.setState({ login: jest.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "TransportError", code: "invalid_credentials", status: 401 }))) });
    const { result } = await renderHook(() => useSignIn("sign_in"), { wrapper });
    await act(async () => void (await result.current.run({ method: "password", email: "a@b.c", password: "p" }, "password")));
    expect(result.current.shown?.failure.key).toBe("auth.social.errors.invalid_credentials");
    const feel = Platform.OS === "ios" ? Haptics.notificationAsync : Haptics.performAndroidHapticsAsync;
    expect(feel).toHaveBeenCalled();
  });

  it("says a failure a screen hands it as a form's, never as a provider sheet's", async () => {
    const { result } = await renderHook(() => useSignIn("ticket"), { wrapper });
    let said: unknown;
    await act(async () => {
      said = result.current.fail(new Error("odd"));
    });
    expect(said).toMatchObject({ code: "unknown", key: "auth.continue.errors.generic" });
    expect(result.current.shown?.failure.key).toBe("auth.continue.errors.generic");
  });
});

describe("useCountdown", () => {
  it("is zero with no deadline", async () => {
    const { result } = await renderHook(() => useCountdown(null));
    expect(result.current).toBe(0);
  });

  it("counts a deadline that arrives late from the moment it arrives, from its first frame", async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const seen: number[] = [];
    const { rerender } = await renderHook<void, { deadline: number | null }>(({ deadline }) => void seen.push(useCountdown(deadline)), {
      initialProps: { deadline: null },
    });
    // The screen stayed open ten minutes, then a 429 asked for a minute.
    jest.setSystemTime(1_600_000);
    await rerender({ deadline: 1_660_000 });
    expect(seen.slice(1)).not.toContain(660);
    expect(seen.at(-1)).toBe(60);
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(seen.at(-1)).toBe(59);
  });
});

describe("useStepBack", () => {
  it("takes Android's back button only while a step is open", async () => {
    const back = jest.fn();
    const listen = jest.spyOn(BackHandler, "addEventListener");
    const { rerender, unmount } = await renderHook<void, { active: boolean }>(({ active }) => useStepBack(active, back), { initialProps: { active: false } });
    expect(listen).not.toHaveBeenCalled();
    await rerender({ active: true });
    const handler = listen.mock.calls[0]?.[1] as unknown as () => boolean;
    expect(handler()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("turns iOS's edge swipe off while a step is open, since it would leave the whole screen", async () => {
    const { setOptions } = useNavigation();
    const { rerender } = await renderHook<void, { active: boolean }>(({ active }) => useStepBack(active, jest.fn()), { initialProps: { active: false } });
    expect(setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
    await rerender({ active: true });
    expect(setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
  });
});
