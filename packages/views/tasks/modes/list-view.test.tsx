import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { ListView } from "./list-view";

initI18n();

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Suite row",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

describe("modes/ListView", () => {
  it("renders task titles from props without fetching", async () => {
    render(wrap(<ListView tasks={[sample]} />));
    expect(await screen.findByText("Suite row")).toBeInTheDocument();
  });

  it("does not mount agent trigger or squad assign chrome", () => {
    render(wrap(<ListView tasks={[sample]} />));
    expect(screen.queryByTestId("list-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("list-squad-assign")).toBeNull();
  });
});
