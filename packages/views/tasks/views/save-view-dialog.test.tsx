import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { wrap } from "../../test/api-mock";
import { SaveViewDialog } from "./save-view-dialog";

initI18n();

const createMutate = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useCreateTaskView: () => ({
      mutate: createMutate,
      mutateAsync: createMutate,
      isPending: false,
    }),
    usePatchTaskView: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

beforeEach(() => {
  createMutate.mockReset();
  createMutate.mockImplementation((_body, opts?: { onSuccess?: (v: unknown) => void }) => {
    opts?.onSuccess?.({ id: "view-1", name: "Focus", revision: 1 });
  });
});

describe("SaveViewDialog", () => {
  it("calls createTaskView with the draft name and workspace scope", async () => {
    const store = getTaskSurfaceViewStore("test-save-view");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SaveViewDialog
            workspaceId="w1"
            open
            onOpenChange={() => {}}
            scope={{ kind: "workspace" }}
          />
        </ViewStoreProvider>,
      ),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /tên|name/i }), {
      target: { value: "Focus board" },
    });
    fireEvent.click(screen.getByRole("button", { name: /lưu|save/i }));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalled();
    });
    const body = createMutate.mock.calls[0]?.[0] as {
      name: string;
      scope_type: string;
      visibility: string;
    };
    expect(body.name).toBe("Focus board");
    expect(body.scope_type).toBe("workspace");
    expect(body.visibility).toMatch(/private|workspace/);
  });
});
