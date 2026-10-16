import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "../../app/(auth)/auth/desktop/authorize/page";

const state = vi.hoisted(() => ({ status: "loading", read: vi.fn(), replace: vi.fn() }));
vi.mock("@uniwork/core/auth", () => ({ useSession: () => ({ status: state.status }) }));
vi.mock("@uniwork/core", () => ({ api: { auth: { desktopConsent: (...args: unknown[]) => state.read(...args), desktopConsentCommand: vi.fn() } } }));
vi.mock("@uniwork/views/navigation", () => ({ useNavigation: () => ({ searchParams: new URLSearchParams("attempt_id=attempt-1"), replace: state.replace }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@uniwork/views/auth/desktop-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/views/auth/desktop-consent")>()),
  DesktopConsentView: ({ state, callbackUrl }: { state: string; callbackUrl?: string }) => <div data-testid="consent-state" data-callback={callbackUrl ?? ""}>{state}</div>,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.status = "loading"; state.read.mockReset(); state.replace.mockReset(); sessionStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
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
