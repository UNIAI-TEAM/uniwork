import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createFileUploadExtension } from "./file-upload";

/** A trailing plugin whose handlePaste is the last one in the chain. */
function probePlugin(onPaste: () => void) {
  return new Plugin({
    key: new PluginKey("pasteProbe"),
    props: {
      handlePaste() {
        onPaste();
        return true;
      },
    },
  });
}

function mountEditor(onPaste: () => void) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    // No upload ref: the extension still mounts for paste classification, and a
    // missing ref must mean "no upload", never a throw.
    extensions: [StarterKit, createFileUploadExtension(undefined)],
    content: "<p></p>",
  });
  // Registered after mount so the probe's handlePaste sits at the END of the
  // chain: if our handler throws, `someProp` aborts and the probe never runs.
  editor.registerPlugin(probePlugin(onPaste));
  return editor;
}

function pasteEvent(files: File[], text = ""): ClipboardEvent {
  return {
    clipboardData: {
      files,
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
}

/** Run the whole handlePaste chain, exactly as ProseMirror's `someProp` does. */
function runPasteChain(editor: Editor, event: ClipboardEvent): boolean {
  return (
    editor.view.someProp("handlePaste", (handler) =>
      handler(editor.view, event, editor.view.state.selection.content()),
    ) === true
  );
}

describe("createFileUploadExtension without an upload handler", () => {
  const editors: Editor[] = [];
  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it("does not abort later handlePaste plugins on a mixed clipboard", () => {
    const onPaste = vi.fn();
    const editor = mountEditor(onPaste);
    editors.push(editor);

    // A clipboard that carries BOTH a file and text. Before the `?.` guard the
    // missing ref threw here, and a throw inside `someProp` aborts the whole
    // chain: every later plugin's handlePaste is skipped, so the text is lost.
    const file = new File(["png"], "shot.png", { type: "image/png" });
    expect(() => runPasteChain(editor, pasteEvent([file], "fallback text"))).not.toThrow();

    // The chain reached the trailing plugin instead of stopping at ours.
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("leaves a file-only paste for later plugins instead of claiming it", () => {
    const onPaste = vi.fn();
    const editor = mountEditor(onPaste);
    editors.push(editor);

    runPasteChain(editor, pasteEvent([new File(["png"], "shot.png", { type: "image/png" })]));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });
});
