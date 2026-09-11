import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { requestMock, wrap } from "../test/api-mock";
import { GoogleButton } from "./google-button";

initI18n();

beforeEach(() => {
  requestMock.mockReset();
  resetRuntimeConfig();
  configureRuntime({ apiUrl: "http://api.test" });
});

describe("GoogleButton", () => {
  it("holds the space while providers load and gives it back when Google is off", async () => {
    requestMock.mockResolvedValue({ google: false });
    const { container } = render(wrap(<GoogleButton />));
    // Reserved, not shown: nothing to read, nothing to click, no layout jump.
    expect(container.querySelector("[data-slot=google-placeholder]")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Tiếp tục với Google" })).toBeNull();
    await waitFor(() => expect(container.querySelector("[data-slot=google-placeholder]")).toBeNull());
    expect(screen.queryByRole("link", { name: "Tiếp tục với Google" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("links to the API start route with the sanitized next path when Google is on", async () => {
    requestMock.mockResolvedValue({ google: true });
    render(wrap(<GoogleButton next="/acme/team" />));
    const link = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    expect(link).toHaveAttribute("href", "http://api.test/api/v1/auth/google/start?next=%2Facme%2Fteam");
    expect(screen.getByText("hoặc")).toBeInTheDocument();
    // buttonVariants() alone concatenates base + variant; only cn() drops the
    // base `border-transparent` that would otherwise beat `border-input`.
    expect(link.className).toContain("border-input");
    expect(link.className).not.toContain("border-transparent");
  });
});
