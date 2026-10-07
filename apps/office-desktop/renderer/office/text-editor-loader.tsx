import { useMemo } from "react";
import { HtmlEditor } from "@uniwork/views/office/html";
import { MarkdownEditor } from "@uniwork/views/office/markdown";
import type { OfficeEditorLoader } from "@uniwork/views/office/editor-slot";
import { createDesktopTextPreviewPort } from "./text-preview-port";
import type { DesktopEditorLoaderConfig } from "./editor-registry";

/** The shared views dispose their editor and cancel the coordinator when they
 * unmount. The byte session owns both lifetimes (a recovered draft remounts the
 * view over the same session), so the view gets handles whose teardown is inert;
 * everything else reads through to the live session. */
function sessionOwned<T extends object>(target: T, inert: readonly string[]): T {
  return new Proxy(target, {
    get(object, key) {
      if (typeof key === "string" && inert.includes(key)) return async () => undefined;
      return Reflect.get(object, key);
    },
  });
}

/** Mount the shared Markdown or HTML editor over the desktop byte session. */
export function textEditorLoader(format: "md" | "html", { documentKey, title, session, capability, surfaceVersion, printPort }: DesktopEditorLoaderConfig): OfficeEditorLoader<Uint8Array> {
  const preview = createDesktopTextPreviewPort(format);
  return async () => ({ default: function DesktopTextEditor() {
    const editor = useMemo(() => sessionOwned(session.editor, ["dispose", "cancel"]), []);
    const coordinator = useMemo(() => sessionOwned(session.coordinator, ["cancel"]), []);
    // The editors contribute their Print entry through `HeaderActionsFill`;
    // the desktop shell's slot provider renders it in the document menu.
    const open = useMemo(() => ({ open: async () => {
      await session.openEditor();
      // A surface that failed to open throws inside openEditor, so this is the opened outcome.
      return session.editor.openOutcome!()!;
    } }), []);
    const props = { documentKey, title, editor: editor as never, coordinator: coordinator as never, preview: preview as never, printPort, capability: { ...capability, format } as never, open: open as never };
    return format === "md" ? <MarkdownEditor key={surfaceVersion} {...props} /> : <HtmlEditor key={surfaceVersion} {...props} />;
  } });
}
