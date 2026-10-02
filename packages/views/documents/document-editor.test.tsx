import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

const { t } = initI18n();

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ members: [] });
});

it("changes readonly permission without treating unchanged content as a user edit", async () => {
  const onChange = vi.fn();
  const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved body" }] }] };
  const view = (editable: boolean) => wrap(<DocumentEditor wsId="ws1" documentId="d1"
    initialContent={content} content={content} contentRevision="3" dirty={false}
    editable={editable} onChange={onChange} onUploadAsset={vi.fn()} />);
  const { rerender } = render(view(true));
  const body = await screen.findByRole("textbox", { name: t("documents.editor.aria_label") });
  rerender(view(false));
  await waitFor(() => expect(body).toHaveAttribute("contenteditable", "false"));
  expect(onChange).not.toHaveBeenCalled();
  rerender(view(true));
  await waitFor(() => expect(body).toHaveAttribute("contenteditable", "true"));
  expect(onChange).not.toHaveBeenCalled();
  expect(body).toHaveTextContent("Saved body");
});
