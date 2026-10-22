import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { AiAskModelsSection } from "./ai-ask-models-section";

initI18n();

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, init?: { method?: string }) =>
    Promise.resolve(path === "/api/v1/orgs/acme/ai/ask-models" ? { models: init?.method === "PUT" ? ["haiku"] : ["haiku", "sonnet"] } : {}),
  );
});

const mount = () => render(wrap(<AiAskModelsSection orgSlug="acme" />));

describe("AiAskModelsSection", () => {
  it("lists Haiku, Sonnet, Opus with switches from GET ask-models", async () => {
    mount();
    const haiku = await screen.findByRole("switch", { name: "Haiku 5.5" });
    await waitFor(() => expect(haiku).toBeChecked());
    expect(screen.getByRole("switch", { name: "Sonnet 5.5" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Opus 5.5" })).not.toBeChecked();
  });

  it("toggling sends PUT with the new list", async () => {
    mount();
    const opus = await screen.findByRole("switch", { name: "Opus 5.5" });
    await waitFor(() => expect(screen.getByRole("switch", { name: "Haiku 5.5" })).toBeChecked());
    fireEvent.click(opus);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/ai/ask-models", {
        method: "PUT",
        body: { models: ["haiku", "sonnet", "opus"] },
      }),
    );
  });

  it("Opus shows the cost note", async () => {
    mount();
    expect(await screen.findByText("Opus dùng nhiều hạn mức token hơn các model khác.")).toBeInTheDocument();
  });

  it("auto is not a switch", async () => {
    mount();
    await screen.findByRole("switch", { name: "Opus 5.5" });
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getByText("Tự động")).toBeInTheDocument();
  });

  it("a second toggle before any refetch carries both changes", async () => {
    // GET never changes: only the PUT answer can tell the section the first change landed.
    requestMock.mockImplementation((path: string, init?: { method?: string; body?: { models: string[] } }) =>
      Promise.resolve(
        path === "/api/v1/orgs/acme/ai/ask-models"
          ? { models: init?.method === "PUT" ? init.body?.models : ["haiku", "sonnet"] }
          : {},
      ),
    );
    mount();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Haiku 5.5" })).toBeChecked());
    fireEvent.click(screen.getByRole("switch", { name: "Opus 5.5" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Opus 5.5" })).toBeChecked());
    await waitFor(() => expect(screen.getByRole("switch", { name: "Opus 5.5" })).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(screen.getByRole("switch", { name: "Haiku 5.5" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenLastCalledWith("/api/v1/orgs/acme/ai/ask-models", {
        method: "PUT",
        body: { models: ["sonnet", "opus"] },
      }),
    );
  });
});
