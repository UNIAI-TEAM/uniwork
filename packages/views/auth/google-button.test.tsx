import { render, screen } from "@testing-library/react";
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
  it("renders nothing while providers load or when Google is off", async () => {
    requestMock.mockResolvedValue({ google: false });
    render(wrap(<GoogleButton />));
    expect(screen.queryByRole("link", { name: "Tiếp tục với Google" })).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Tiếp tục với Google" })).toBeNull();
  });

  it("links to the API start route with the sanitized next path when Google is on", async () => {
    requestMock.mockResolvedValue({ google: true });
    render(wrap(<GoogleButton next="/acme/team" />));
    const link = await screen.findByRole("link", { name: "Tiếp tục với Google" });
    expect(link).toHaveAttribute("href", "http://api.test/api/v1/auth/google/start?next=%2Facme%2Fteam");
    expect(screen.getByText("hoặc")).toBeInTheDocument();
  });
});
