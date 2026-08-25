import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { WorkspacePickerView } from "./workspace-picker-view";

initI18n();
beforeEach(() => requestMock.mockReset());

describe("WorkspacePickerView", () => {
  it("groups workspaces by organization", async () => {
    requestMock.mockResolvedValueOnce({
      workspaces: [
        { id: "w1", slug: "a", name: "Alpha", organization_id: "o1", organization_slug: "unicom", organization_name: "Unicom" },
        { id: "w2", slug: "b", name: "Beta", organization_id: "o2", organization_slug: "acme", organization_name: "Acme" },
      ],
    });
    const onPick = vi.fn();
    render(wrap(<WorkspacePickerView onPick={onPick} onCreate={() => {}} />));
    expect(await screen.findByRole("heading", { name: /Unicom/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Acme/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" }));
  });
  it("empty → onCreate", async () => {
    requestMock.mockResolvedValueOnce({ workspaces: [] });
    const onCreate = vi.fn();
    render(wrap(<WorkspacePickerView onPick={() => {}} onCreate={onCreate} />));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalled());
  });
});
