import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentEditorRef } from "./content-editor";
import { useComposerSubmit } from "./use-composer-submit";
import type { UploadGate } from "./use-upload-gate";

// The composer tests mock this hook, so the guards the send key relies on
// (the key calls submit() directly, bypassing the Send button's aria-disabled
// check) are pinned here against the real implementation.
function setup(markdown: string, opts: { blocked?: boolean } = {}) {
  const editorRef = {
    current: { getMarkdown: () => markdown } as unknown as ContentEditorRef,
  };
  const uploadGate: UploadGate = {
    uploading: opts.blocked ?? false,
    onUploadingChange: () => {},
    isBlocked: () => opts.blocked ?? false,
  };
  const onSubmit = vi.fn(() => new Promise<boolean>(() => {}));
  const { result } = renderHook(() =>
    useComposerSubmit({ editorRef, uploadGate, onSubmit }),
  );
  return { result, onSubmit };
}

describe("useComposerSubmit guards", () => {
  it("does not send empty content", async () => {
    const { result, onSubmit } = setup("");
    await act(async () => { void result.current.submit(); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send whitespace-only content", async () => {
    const { result, onSubmit } = setup("  \n\t \n");
    await act(async () => { void result.current.submit(); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send while an attachment is uploading", async () => {
    const { result, onSubmit } = setup("có file", { blocked: true });
    await act(async () => { void result.current.submit(); });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends once when submit is called twice in the same tick", async () => {
    const { result, onSubmit } = setup("một lần thôi");
    await act(async () => {
      void result.current.submit();
      void result.current.submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("một lần thôi");
    expect(result.current.submitting).toBe(true);
  });
});
