import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AssigneeOption } from "../../tasks/pickers/assignee-picker";
import { wrap } from "../../test/api-mock";
import { ProjectLeadPicker } from "./project-lead-picker";

const options: AssigneeOption[] = [
  { id: "u1", kind: "human", name: "Nguyễn Văn An" },
  { id: "u2", kind: "human", name: "Trần Bình" },
  { id: "a1", kind: "agent", name: "Uni Bot" },
];

function renderPicker(lead: { lead_type: string | null; lead_id: string | null }) {
  const onChange = vi.fn();
  const onRowClick = vi.fn();
  render(
    wrap(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for a clickable table row
      <div onClick={onRowClick}>
        <ProjectLeadPicker project={lead} options={options} onChange={onChange} />
      </div>,
    ),
  );
  return { onChange, onRowClick };
}

beforeAll(() => {
  initI18n();
});

describe("ProjectLeadPicker", () => {
  it("lists members and agents in their own groups under a search box", async () => {
    const { onRowClick } = renderPicker({ lead_type: null, lead_id: null });
    fireEvent.click(screen.getByRole("button", { name: /Phụ trách/ }));

    expect(await screen.findByLabelText("Gán phụ trách…")).toBeInTheDocument();
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uni Bot" })).toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("matches names without diacritics and assigns an agent", async () => {
    const { onChange, onRowClick } = renderPicker({ lead_type: null, lead_id: null });
    fireEvent.click(screen.getByRole("button", { name: /Phụ trách/ }));
    fireEvent.change(await screen.findByLabelText("Gán phụ trách…"), {
      target: { value: "nguyen van" },
    });
    expect(screen.getByRole("button", { name: "Nguyễn Văn An" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trần Bình" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Gán phụ trách…"), { target: { value: "uni" } });
    fireEvent.click(screen.getByRole("button", { name: "Uni Bot" }));
    expect(onChange).toHaveBeenCalledWith({ lead_type: "agent", lead_id: "a1" });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("clears the lead", async () => {
    const { onChange } = renderPicker({ lead_type: "member", lead_id: "u2" });
    fireEvent.click(screen.getByRole("button", { name: /Trần Bình/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Chưa có phụ trách" }));
    expect(onChange).toHaveBeenCalledWith({ lead_type: null, lead_id: null });
  });

  it("says so when nothing matches", async () => {
    renderPicker({ lead_type: null, lead_id: null });
    fireEvent.click(screen.getByRole("button", { name: /Phụ trách/ }));
    fireEvent.change(await screen.findByLabelText("Gán phụ trách…"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("Không có kết quả")).toBeInTheDocument();
  });
});
