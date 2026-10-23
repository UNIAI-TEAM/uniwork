import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentEditor } from "./document-editor";

vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestBlob: (...args: unknown[]) => transport(...args),
  };
});

const content = { type: "doc", content: [{ type: "paragraph", content: [
  { type: "image", attrs: { src: "asset://asset1", alt: "Chart" } },
] }] };
const onChange = vi.fn();
const createUrl = vi.fn();
const revokeUrl = vi.fn();
const { t } = initI18n();

beforeEach(() => {
  requestMock.mockReset();
  onChange.mockReset();
  createUrl.mockReset().mockReturnValue("blob:chart");
  revokeUrl.mockReset();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createUrl;
    static revokeObjectURL = revokeUrl;
  });
  requestMock.mockImplementation((path: string) => Promise.resolve(
    path.includes("/assets/") ? new Blob(["image"], { type: "image/png" }) : { members: [] },
  ));
});
afterEach(() => { vi.unstubAllGlobals(); });

function view(editable: boolean, documentId = "d1") {
  return wrap(<DocumentEditor wsId="ws1" documentId={documentId} initialContent={content}
    content={content} contentRevision="3" dirty={false} editable={editable}
    onChange={onChange} onUploadAsset={vi.fn()} />);
}

it.each([true, false])("renders authenticated asset bytes with editable=%s without changing persisted JSON", async (editable) => {
  const mounted = render(view(editable));
  const image = await screen.findByRole("img", { name: "Chart" });
  expect(image).toHaveAttribute("src", "blob:chart");
  expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d1/assets/asset1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(createUrl).toHaveBeenCalledWith(expect.any(Blob));
  expect(onChange).not.toHaveBeenCalled();
  mounted.unmount();
  expect(revokeUrl).toHaveBeenCalledWith("blob:chart");
});

it("resolves an unchanged asset id again when the document scope changes", async () => {
  const mounted = render(view(false));
  await screen.findByRole("img", { name: "Chart" });
  createUrl.mockReturnValue("blob:other-document");
  mounted.rerender(view(false, "d2"));
  await waitFor(() => expect(screen.getByRole("img", { name: "Chart" })).toHaveAttribute("src", "blob:other-document"));
  expect(requestMock).toHaveBeenCalledWith("/api/v1/documents/d2/assets/asset1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(revokeUrl).toHaveBeenCalledWith("blob:chart");
  expect(onChange).not.toHaveBeenCalled();
});

it.each(["vi", "en"] as const)("localizes loading and denied image states in %s", async (locale) => {
  await setLocale(locale);
  let rejectAsset: ((error: Error) => void) | undefined;
  requestMock.mockImplementation((path: string) => path.includes("/assets/")
    ? new Promise<Blob>((_resolve, reject) => { rejectAsset = reject; })
    : Promise.resolve({ members: [] }));
  render(view(false));
  expect(await screen.findByText(t("documents.page_ui.image_loading"))).toBeInTheDocument();
  await act(async () => { rejectAsset?.(new ApiError("Denied", "forbidden", 403)); });
  expect(await screen.findByText(t("documents.save.asset_load_failed"))).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Chart" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
