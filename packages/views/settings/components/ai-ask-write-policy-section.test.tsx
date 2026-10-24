import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { AiAskWritePolicySection } from "./ai-ask-write-policy-section";

initI18n();

function serve(role: string) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: { ceiling?: string } }) => {
    if (path === "/api/v1/orgs/acme/members/me") return Promise.resolve({ role });
    if (path === "/api/v1/orgs/acme/ai/ask-write-policy") return Promise.resolve({ ceiling: init?.method === "PUT" ? init.body?.ceiling : "plan" });
    return Promise.resolve({});
  });
}

const mount = () => render(wrap(<AiAskWritePolicySection orgSlug="acme" />));

beforeEach(() => {
  requestMock.mockReset();
});

describe("AiAskWritePolicySection", () => {
  it("offers the four ceilings with the server's choice selected", async () => {
    serve("admin");
    mount();
    const plan = await screen.findByRole("radio", { name: /Hỏi trước và Kế hoạch \(mặc định\)/ });
    await waitFor(() => expect(plan).toBeChecked());
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? r.textContent)).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "Tắt" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Chỉ Hỏi trước" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Cả Tự động" })).not.toBeChecked();
  });

  it("saving sends PUT with the picked ceiling", async () => {
    serve("owner");
    mount();
    fireEvent.click(await screen.findByRole("radio", { name: "Cả Tự động" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/ai/ask-write-policy", { method: "PUT", body: { ceiling: "auto" } }),
    );
  });

  it("is read-only for a non-admin", async () => {
    serve("member");
    mount();
    const off = await screen.findByRole("radio", { name: "Tắt" });
    await waitFor(() => expect(screen.getByRole("radio", { name: /Hỏi trước và Kế hoạch/ })).toBeChecked());
    expect(off).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(off);
    expect(requestMock).not.toHaveBeenCalledWith("/api/v1/orgs/acme/ai/ask-write-policy", expect.objectContaining({ method: "PUT" }));
  });
});
