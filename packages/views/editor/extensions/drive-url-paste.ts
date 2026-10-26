/**
 * Google Drive URL paste detector extension (spec §7.5, QĐ 8).
 *
 * Observes `handlePaste` on the editor, extracts any Google Drive file IDs from
 * the pasted text/HTML via `extractDriveFileIdsFromPaste`, reports them through
 * `onPasteDriveFileIdsRef`, and ALWAYS returns `false` so `linkOnPaste` and
 * `markdownPaste` insert the link exactly as today.
 */
import type { RefObject } from "react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { extractDriveFileIdsFromPaste } from "../../tasks/drive-paste-url";

export function createDriveUrlPasteExtension(
  onPasteDriveFileIdsRef?: RefObject<((fileIds: string[]) => void) | undefined>,
) {
  return Extension.create({
    name: "driveUrlPaste",
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("driveUrlPaste"),
          props: {
            handlePaste(_view, event) {
              const callback = onPasteDriveFileIdsRef?.current;
              if (!callback) return false;
              const clipboard = event.clipboardData;
              if (!clipboard) return false;

              const text = clipboard.getData("text/plain");
              const html = clipboard.getData("text/html");
              const ids = extractDriveFileIdsFromPaste(text, html);
              if (ids.length > 0) {
                callback(ids);
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
