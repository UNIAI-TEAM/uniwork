import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../app/(auth)/auth/desktop/authorize/page";

const state = vi.hoisted(() => ({ status: "loading", search: "attempt_id=attempt-1", read: vi.fn(), command: vi.fn(), replace: vi.fn(), logout: vi.fn() }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: state.status }), useLogout: () => ({ mutateAsync: state.logout }) }));
vi.mock("@uniwork/core", () => ({ api: { auth: { desktopConsent: (...args: unknown[]) => state.read(...args), desktopConsentCommand: (...args: unknown[]) => state.command(...args) } } }));
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ searchParams: new URLSearchParams(state.search), replace: state.replace }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/views/auth/desktop-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/views/auth/desktop-consent")>()),
  DesktopConsentView: ({ state, consent, callbackUrl, onDecision, onRetry, onSwitchAccount }: { state: string; consent: unknown; callbackUrl?: string; onDecision: (decision: "approve" | "cancel") => Promise<void>; onRetry: () => void; onSwitchAccount: () => Promise<void> }) => (
    <div data-testid="consent-state" data-callback={callbackUrl ?? ""} data-loaded={consent ? "yes" : "no"}>{state}
      <button type="button" data-testid="approve" onClick={() => void onDecision("approve")} />
      <button type="button" data-testid="retry" onClick={onRetry} />
      <button type="button" data-testid="not-you" onClick={() => void onSwitchAccount()} />
    </div>
  ),
}));

const assign = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.status = "loading"; state.search = "attempt_id=attempt-1"; state.read.mockReset(); state.logout.mockReset(); state.command.mockReset(); state.replace.mockReset(); sessionStorage.clear();
  assign.mockReset(); vi.stubGlobal("location", { assign });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const renderPage = async () => { await act(async () => { root.render(<Page />); }); };

it("waits for web session initialization before fetching consent", async () => {
  await renderPage();
  expect(state.read).not.toHaveBeenCalled();
  state.status = "authed";
  state.read.mockResolvedValue({ status: "pending" });
  await renderPage();
  expect(state.read).toHaveBeenCalledExactlyOnceWith("attempt-1");
});

it("preserves the attempt in the login return destination for an anonymous arrival", async () => {
  state.status = "anon";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Dattempt-1");
  expect(state.read).not.toHaveBeenCalled();
});

// Spec §3.5: the app's provider button reaches /login, which follows it once;
// the way back here leaves it out, so a signed-in return shows the consent.
it.each([
  ["google", "&provider=google"],
  ["apple", "&provider=apple"],
  ["Apple", ""],
  ["github", ""],
])("forwards the provider hint %s to login only when it is one the server takes", async (hint, expected) => {
  state.status = "anon";
  state.search = `attempt_id=attempt-1&provider=${hint}`;
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith(`/login?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Dattempt-1${expected}`);
});

it.each(["approved", "cancelled", "expired"])("uses the authoritative %s result after reload", async (status) => {
  state.status = "authed";
  state.read.mockResolvedValue({ status });
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.textContent).toBe(status);
});

it("reports malformed consent as an error rather than an expired request", async () => {
  state.status = "authed"; state.read.mockResolvedValue(null);
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.textContent).toBe("error");
});

it.each([
  ["uniworkchat://auth/callback", "uniworkchat://auth/callback?code=c&state=s", "uniworkchat://auth/callback?code=c&state=s"],
  ["uniworkchat://auth/callback", "evil://auth/callback?code=c&state=s", ""],
  ["uniworkchat://auth/callback", "uniwork-office://auth/callback?code=c&state=s", ""],
])("reopens the app only on the attempt's own scheme (%s, saved %s)", async (redirectUri, saved, expected) => {
  state.status = "authed";
  state.read.mockResolvedValue({ status: "approved", redirect_uri: redirectUri });
  sessionStorage.setItem("desktop-callback:attempt-1", saved);
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.getAttribute("data-callback")).toBe(expected);
});

it.each([
  ["uniworkchat://auth/callback?code=c&state=s", "approved", "uniworkchat://auth/callback?code=c&state=s"],
  ["https://evil.example/x", "error", null],
])("shows a live approval only when %s matches the attempt's redirect (%s)", async (callbackUrl, expectedState, stored) => {
  state.status = "authed";
  state.read.mockResolvedValue({ status: "pending", attempt_id: "attempt-1", csrf_token: "c", redirect_uri: "uniworkchat://auth/callback" });
  state.command.mockResolvedValue({ status: "approved", callback_url: callbackUrl });
  await renderPage();
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="approve"]')?.click(); });
  expect(state.command).toHaveBeenCalledExactlyOnceWith({ attempt_id: "attempt-1", csrf_token: "c", decision: "approve" });
  const view = container.querySelector('[data-testid="consent-state"]');
  expect(view?.textContent).toBe(expectedState);
  expect(view?.getAttribute("data-callback")).toBe(stored ?? "");
  expect(sessionStorage.getItem("desktop-callback:attempt-1")).toBe(stored);
  // An approval opens the app by itself; a callback on another scheme never opens.
  expect(assign.mock.calls).toEqual(stored ? [[stored]] : []);
});

it("opens nothing by itself for an approval read back after a reload", async () => {
  state.status = "authed";
  state.read.mockResolvedValue({ status: "approved", redirect_uri: "uniworkchat://auth/callback" });
  sessionStorage.setItem("desktop-callback:attempt-1", "uniworkchat://auth/callback?code=c&state=s");
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.textContent).toBe("approved");
  expect(assign).not.toHaveBeenCalled();
});

it("hands the view its own loading shape instead of a bare status line", async () => {
  state.status = "authed";
  state.read.mockReturnValue(new Promise(() => {}));
  await renderPage();
  const view = container.querySelector('[data-testid="consent-state"]');
  expect(view?.textContent).toBe("pending");
  expect(view?.getAttribute("data-loaded")).toBe("no");
});

it("reads the attempt again on retry, showing the loading shape meanwhile", async () => {
  state.status = "authed";
  state.read.mockResolvedValueOnce(null);
  await renderPage();
  expect(container.querySelector('[data-testid="consent-state"]')?.textContent).toBe("error");
  state.read.mockReturnValueOnce(new Promise(() => {}));
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="retry"]')?.click(); });
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[data-testid="consent-state"]')?.textContent).toBe("pending");
});

it("signs this browser out for someone else, who then signs in for the same attempt", async () => {
  state.status = "authed";
  state.search = "attempt_id=attempt-1&provider=apple";
  state.read.mockResolvedValue({ status: "pending" });
  state.logout.mockResolvedValue(undefined);
  await renderPage();
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="not-you"]')?.click(); });
  expect(state.logout).toHaveBeenCalledTimes(1);
  // The store drops to anon; the page sends the browser to sign in, hint and all.
  state.status = "anon";
  await renderPage();
  expect(state.replace).toHaveBeenCalledWith("/login?next=%2Fauth%2Fdesktop%2Fauthorize%3Fattempt_id%3Dattempt-1&provider=apple");
});
