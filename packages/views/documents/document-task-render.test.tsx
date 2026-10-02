import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

const { t } = initI18n();
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const content = { type: "doc", content: [{ type: "taskList", content: [
  { type: "taskItem", attrs: { checked: false }, content: [paragraph("Parent"),
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Child")] }] },
  ] },
] }, { type: "paragraph" }] };
beforeEach(() => { requestMock.mockReset().mockResolvedValue({ members: [] }); });

it.each([true, false])("keeps nested task lists semantic with editable=%s", async (editable) => {
  const onChange = vi.fn();
  render(wrap(<DocumentEditor wsId="ws1" documentId="d1" initialContent={content} content={content}
    contentRevision="3" dirty={false} editable={editable} onChange={onChange} onUploadAsset={vi.fn()} />));
  await screen.findByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) });
  document.querySelectorAll('ul[data-type="taskList"]').forEach((list) => {
    expect(Array.from(list.children).map((child) => child.tagName)).toEqual(["LI"]);
  });
  expect(screen.getByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) })).toBeChecked();
  if (!editable) {
    const checkbox = screen.getByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) });
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  }
});

it("toggles the existing task checked attribute through the shared checkbox", async () => {
  const onChange = vi.fn();
  render(wrap(<DocumentEditor wsId="ws1" documentId="d1" initialContent={content} content={content}
    contentRevision="3" dirty={false} editable onChange={onChange} onUploadAsset={vi.fn()} />));
  fireEvent.click(await screen.findByRole("checkbox", { name: t("documents.page_ui.toggle_task", { task: "Child" }) }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.lastCall?.[0].content[0]).toMatchObject({ content: [{ content: [
    paragraph("Parent"), { type: "taskList", content: [{ attrs: { checked: false } }] },
  ] }] });
});
