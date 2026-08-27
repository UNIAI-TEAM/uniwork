import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { NewTaskDialog } from "./new-task-dialog";

initI18n();

describe("NewTaskDialog", () => {
  it("opens when controlled open=true without rendering a trigger button", () => {
    render(
      wrap(
        <NewTaskDialog workspaceId="ws1" open showTrigger={false} onOpenChange={() => {}} />,
      ),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Việc mới" })).toBeNull();
  });
});
