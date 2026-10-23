import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskProperty } from "@uniwork/core/types";
import {
  CreateTaskCustomProperties,
  isValidPropertyDraft,
} from "./create-task-custom-properties";

initI18n();

function property(overrides: Partial<TaskProperty>): TaskProperty {
  return {
    id: "prop-1",
    organization_id: "org-1",
    workspace_id: "ws-1",
    name: "Loại",
    type: "select",
    description: "",
    config: {},
    position: 1,
    usage_count: 0,
    created_at: "2026-09-17T00:00:00Z",
    updated_at: "2026-09-17T00:00:00Z",
    ...overrides,
  };
}

describe("CreateTaskCustomProperties", () => {
  it("renders select properties through the same pill and property picker", () => {
    const onChange = vi.fn();
    render(
      <CreateTaskCustomProperties
        properties={[
          property({
            config: {
              icon: "tag",
              options: [
                { value: "bug", label: "Lỗi", color: "#ef4444" },
                { value: "feature", label: "Tính năng", color: "#3b82f6" },
              ],
            },
          }),
        ]}
        values={{}}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Loại" });
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger.querySelector('[data-property-icon="tag"]')).not.toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Lỗi" }));
    expect(onChange).toHaveBeenCalledWith("prop-1", "bug");
  });

  it("uses a pill-triggered editor for text properties", () => {
    render(
      <CreateTaskCustomProperties
        properties={[property({ name: "Khách hàng", type: "text" })]}
        values={{}}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Khách hàng" });
    expect(trigger).toHaveClass("rounded-full");
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Khách hàng" })).toBeInTheDocument();
  });

  it("does not commit non-finite numbers or unsafe URL schemes", () => {
    expect(isValidPropertyDraft("number", "1e999")).toBe(false);
    const onChange = vi.fn();
    render(
      <CreateTaskCustomProperties
        properties={[
          property({ id: "number", name: "Điểm", type: "number" }),
          property({ id: "url", name: "Liên kết", type: "url" }),
        ]}
        values={{}}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Liên kết" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Liên kết" }), {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.getByRole("button", { name: /Lưu|Save/ })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
