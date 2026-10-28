import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { localeAdapter, requestMock, wrap } from "../test/api-mock";
import { SocialSignIn, webSignInProviders } from "./social-sign-in";

initI18n();

const ALL_ON = { google: true, apple: true, apple_web: true, google_native: true };

beforeEach(async () => {
  requestMock.mockReset();
  localeAdapter.persist.mockClear();
  await setLocale("vi");
  resetRuntimeConfig();
  configureRuntime({ apiUrl: "http://api.test" });
});

describe("SocialSignIn", () => {
  it("holds the space of two buttons while providers load, and gives all of it back when none is offered", async () => {
    let answer: (value: unknown) => void = () => {};
    requestMock.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { container } = render(wrap(<SocialSignIn />));
    // Reserved, not shown: nothing to read, nothing to click, no layout jump.
    const placeholder = container.querySelector("[data-slot=social-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder?.querySelectorAll(".h-12")).toHaveLength(2);
    expect(screen.queryAllByRole("link")).toHaveLength(0);

    answer({ google: false, apple: false, apple_web: false, google_native: false });
    await waitFor(() => expect(container.querySelector("[data-slot=social-placeholder]")).toBeNull());
    // No orphan divider: with nothing above it, "or use email" would introduce nothing.
    expect(container.textContent).toBe("");
  });

  it("offers Google then Apple as two links in one named group, with the divider under them", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    render(wrap(<SocialSignIn next="/acme/team" />));
    const group = await screen.findByRole("group", { name: "Đăng nhập bằng Google hoặc Apple" });
    const links = within(group).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Tiếp tục với Google", "Tiếp tục với Apple"]);
    expect(links[0]).toHaveAttribute("href", "http://api.test/api/v1/auth/google/start?next=%2Facme%2Fteam");
    expect(links[1]).toHaveAttribute("href", "http://api.test/api/v1/auth/apple/start?next=%2Facme%2Fteam");
    expect(screen.getByText("hoặc dùng email")).toBeInTheDocument();
    // The divider follows the buttons: providers first, then the form (spec §4.1).
    expect(group.compareDocumentPosition(screen.getByText("hoặc dùng email")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders real links, not buttons acting as links", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    render(wrap(<SocialSignIn />));
    for (const name of ["Tiếp tục với Google", "Tiếp tục với Apple"]) {
      const link = await screen.findByRole("link", { name });
      expect(link.tagName).toBe("A");
      expect(link).not.toHaveAttribute("role");
      expect(link).not.toHaveAttribute("type");
    }
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("carries intent=sign_up from the register screen beside next", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    render(wrap(<SocialSignIn next="/invite/tok" intent="sign_up" />));
    expect(await screen.findByRole("link", { name: "Tiếp tục với Google" })).toHaveAttribute(
      "href",
      "http://api.test/api/v1/auth/google/start?next=%2Finvite%2Ftok&intent=sign_up",
    );
    expect(screen.getByRole("link", { name: "Tiếp tục với Apple" })).toHaveAttribute(
      "href",
      "http://api.test/api/v1/auth/apple/start?next=%2Finvite%2Ftok&intent=sign_up",
    );
  });

  it.each([
    ["only Google", { google: true, apple: false, apple_web: false, google_native: false }, ["Tiếp tục với Google"]],
    // `apple` is the iPhone's sheet: without the web's Services ID the browser flow would 503.
    ["Apple on the iPhone only", { google: false, apple: true, apple_web: false, google_native: true }, []],
    ["only Apple on the web", { google: false, apple: false, apple_web: true, google_native: false }, ["Tiếp tục với Apple"]],
  ])("follows the deployment's flags: %s", async (_name, flags, expected) => {
    requestMock.mockResolvedValue(flags);
    const { container } = render(wrap(<SocialSignIn />));
    await waitFor(() => expect(container.querySelector("[data-slot=social-placeholder]")).toBeNull());
    expect(screen.queryAllByRole("link").map((l) => l.textContent)).toEqual(expected);
    if (expected.length === 0) expect(container.textContent).toBe("");
  });

  it("styles both as the outline pill, and turns Apple white on black in dark mode only", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    render(wrap(<SocialSignIn />));
    const google = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    const apple = screen.getByRole("link", { name: "Tiếp tục với Apple" });
    for (const link of [google, apple]) {
      // buttonVariants() alone concatenates base + variant; only cn() drops the
      // base `border-transparent` that would otherwise beat `border-input`.
      expect(link.className).toContain("border-input");
      expect(link.className).not.toContain("border-transparent");
      expect(link.className).toContain("rounded-full");
    }
    // cn() must replace the outline variant's dark fill, or it wins the cascade.
    expect(apple.className).toContain("dark:bg-foreground");
    expect(apple.className).not.toContain("dark:bg-input/30");
    expect(apple.className).toContain("dark:hover:text-background");
    expect(google.className).toContain("dark:bg-input/30");
    expect(google.className).not.toContain("dark:bg-foreground");
  });
});

describe("SocialSignIn while a sign-in waits to be linked (spec §4.4)", () => {
  it("leaves the waiting provider's button out and keeps next on the other", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    render(wrap(<SocialSignIn next="/auth/continue?step=link" except="apple" />));
    const group = await screen.findByRole("group", { name: "Đăng nhập bằng Google hoặc Apple" });
    const links = within(group).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Tiếp tục với Google"]);
    expect(links[0]).toHaveAttribute("href", "http://api.test/api/v1/auth/google/start?next=%2Fauth%2Fcontinue%3Fstep%3Dlink");
  });

  it("holds one button's space while the caller learns which one goes", async () => {
    requestMock.mockResolvedValue(ALL_ON);
    const { container } = render(wrap(<SocialSignIn hold />));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const placeholder = container.querySelector("[data-slot=social-placeholder]");
    expect(placeholder?.querySelectorAll(".h-12")).toHaveLength(1);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("webSignInProviders", () => {
  it("reads google and apple_web, never the iPhone's apple flag", () => {
    expect(webSignInProviders(undefined)).toEqual([]);
    expect(webSignInProviders(ALL_ON)).toEqual(["google", "apple"]);
    expect(webSignInProviders({ google: false, apple: true, apple_web: false, google_native: true })).toEqual([]);
  });
});
