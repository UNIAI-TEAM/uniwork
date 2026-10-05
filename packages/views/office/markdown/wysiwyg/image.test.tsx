// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor as CoreEditor } from "@tiptap/core";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { NodeViewProps } from "@tiptap/react";
import { MarkdownImageView } from "./image-view";
import { MarkdownImageScopeProvider, type MarkdownImageScope } from "./image-scope";
import { createMarkdownImageUploadExtension, type MarkdownImageUploader } from "./image-upload";
import { imageSaveBlocked, type ImageAssetPort } from "./image-resolve";
import { createMarkdownEditorExtensions } from "./extensions";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const PORT: ImageAssetPort = { displayUrl: (id) => `blob:${id}` };
const MANIFEST = { entries: [{ path: "assets/logo.png", asset_id: "asset-logo", status: "ready" as const }] };

/** Minimal NodeViewProps for the pure render tests. */
function nodeProps(attrs: Record<string, unknown>, editable = true): Record<string, unknown> {
  return {
    node: { attrs },
    editor: { isEditable: editable },
    selected: false,
    deleteNode: vi.fn(),
    updateAttributes: vi.fn(),
    decorations: [],
    getPos: () => 0,
    extension: {},
    HTMLAttributes: {},
    view: {},
    innerDecorations: {},
  };
}

function renderImage(attrs: Record<string, unknown>, scope: MarkdownImageScope) {
  const props = nodeProps(attrs) as unknown as NodeViewProps;
  return render(
    <MarkdownImageScopeProvider scope={scope}>
      <MarkdownImageView {...props} />
    </MarkdownImageScopeProvider>,
  );
}

describe("MarkdownImageView", () => {
  it("resolves a relative path through the manifest to the host display URL", () => {
    renderImage({ src: "assets/logo.png", alt: "Logo" }, { manifest: MANIFEST, port: PORT });
    const image = screen.getByTestId("md-image");
    expect(image).toHaveAttribute("src", "blob:asset-logo");
    expect(image).toHaveAttribute("alt", "Logo");
    expect(image).toHaveAttribute("data-resolution", "manifest");
    // The authored path never reaches the DOM as an image src.
    expect(image.getAttribute("src")).not.toContain("assets/logo.png");
  });

  it("renders a typed unavailable state for a path that is not in the manifest", () => {
    renderImage({ src: "assets/unknown.png", alt: "Missing" }, { manifest: MANIFEST, port: PORT });
    expect(screen.queryByTestId("md-image")).toBeNull();
    const unavailable = screen.getByTestId("md-image-unavailable");
    expect(unavailable).toHaveAttribute("data-resolution", "unavailable:not_in_manifest");
  });

  it("opens the viewer on the image, not a floating command button", async () => {
    renderImage({ src: "assets/logo.png", alt: "Logo" }, { manifest: MANIFEST, port: PORT });
    screen.getByTestId("md-image-open").click();
    expect(await screen.findByTestId("md-image-viewer")).toHaveAttribute("src", "blob:asset-logo");
  });
});

describe("Markdown image paste/drop upload", () => {
  function mountEditor(uploader: MarkdownImageUploader | undefined, onAssetFailure = vi.fn<(name: string, status: string) => void>()) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new CoreEditor({
      element,
      extensions: [
        ...createMarkdownEditorExtensions(),
        createMarkdownImageUploadExtension({ getUploader: () => uploader, onAssetFailure }),
      ],
      content: "<p>before</p>",
    });
    return { editor, onAssetFailure };
  }

  function pasteImage(editor: CoreEditor, file: File) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [file], getData: () => "" } });
    editor.view.dom.dispatchEvent(event);
  }

  it("sends a pasted image file to the injected upload port, never a transport", async () => {
    const uploader = vi.fn<MarkdownImageUploader>(async () => ({ path: "assets/pasted.png", assetId: "asset-pasted" }));
    const { editor } = mountEditor(uploader);
    try {
      const file = new File(["png"], "pasted.png", { type: "image/png" });
      await act(async () => { pasteImage(editor, file); });
      await waitFor(() => expect(uploader).toHaveBeenCalledTimes(1));
      expect(uploader.mock.calls[0]?.[0]).toBe(file);
      // The placeholder settles to the RELATIVE path the host returned.
      await waitFor(() => expect(editor.getHTML()).toContain("assets/pasted.png"));
    } finally {
      editor.destroy();
    }
  });

  it("keeps the document unsavable when the upload fails", async () => {
    const uploader = vi.fn<MarkdownImageUploader>(async () => null);
    const { editor, onAssetFailure } = mountEditor(uploader);
    try {
      const file = new File(["png"], "broken.png", { type: "image/png" });
      await act(async () => { pasteImage(editor, file); });
      await waitFor(() => expect(onAssetFailure).toHaveBeenCalledWith("broken.png", "failed"));
      // The failed placeholder is not serialized as content.
      expect(editor.getHTML()).not.toContain("uploading");
      // And the shared invariant blocks the save.
      expect(imageSaveBlocked({ entries: [] }, { "broken.png": "failed" })).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("drops the in-flight placeholder from serialized Markdown", async () => {
    // An upload that never settles: the placeholder must not be content.
    const uploader = vi.fn<MarkdownImageUploader>(() => new Promise<never>(() => {}));
    const { editor } = mountEditor(uploader);
    try {
      const file = new File(["png"], "slow.png", { type: "image/png" });
      await act(async () => { pasteImage(editor, file); });
      await waitFor(() => expect(uploader).toHaveBeenCalled());
      expect(editor.getMarkdown()).not.toContain("slow.png");
    } finally {
      editor.destroy();
    }
  });
});
