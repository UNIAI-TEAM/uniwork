import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateChannelDialog } from "./create-channel-dialog";

const mutateAsync = vi.fn();

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useCreateChatChannel: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@uniwork/core/tasks", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/tasks")>()),
  useProjects: () => ({ data: { projects: [] } }),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({ data: [], isLoading: false }),
}));

beforeAll(() => {
  initI18n();
});

describe("CreateChannelDialog", () => {
  it("shows the server error inline when creating fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    const onOpenChange = vi.fn();

    render(
      wrap(
        <CreateChannelDialog open onOpenChange={onOpenChange} workspaceId="ws1" currentUserId="self" />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Tên kênh"), { target: { value: "marketing" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo kênh" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: "marketing", visibility: "public" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("labels the visibility choices and switches to private", () => {
    render(wrap(<CreateChannelDialog open onOpenChange={vi.fn()} workspaceId="ws1" currentUserId="self" />));

    const group = screen.getByRole("radiogroup", { name: "Phạm vi" });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[1]!);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
  });
});
