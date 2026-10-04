"use client";

/**
 * MarkdownSlash — the Markdown slash menu (M3), mounted on the shared
 * suggestion machinery.
 *
 * There is NO second slash engine here. The plugin is `@tiptap/suggestion`'s
 * `Suggestion`, the popup is `createSuggestionPopupRender` (the same renderer
 * the page-document menu and the mention picker use), the trigger provenance is
 * `isTriggerArmedAt` (typed `/` only, never a pasted path), and the list's
 * keyboard policy is `picker-keys.ts`. What Markdown adds lives in
 * `slash-items.ts`: the 14 block items, the filter and the insert commands.
 *
 * Like the M7 find integration, the plugin is registered at RUNTIME
 * (`editor.registerPlugin`) rather than through M1's extension array, so the
 * editor core and its byte round-trip contract are untouched. Unregistering on
 * unmount drops the popup and its decorations with it.
 *
 * C9: this is a contextual affordance (it opens only at a typed `/`), never a
 * command button floating over the canvas.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import type { Plugin } from "@tiptap/pm/state";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { useTranslation } from "react-i18next";
import { createSuggestionPopupRender } from "../../../editor/extensions/suggestion-popup";
import {
  isTriggerArmedAt,
  SuggestionTriggerArmingExtension,
} from "../../../editor/extensions/suggestion-trigger-arming";
import { MarkdownSlashList, type MarkdownSlashListHandle } from "./slash-list";
import {
  filterMarkdownSlashItems,
  insertMarkdownSlashItem,
  type MarkdownSlashItem,
  type MarkdownSlashTranslate,
} from "./slash-items";

/** The one plugin key the menu registers and unregisters under. */
export const markdownSlashPluginKey = new PluginKey("markdownSlashSuggestion");

export interface MarkdownSlashPluginOptions {
  editor: Editor;
  translate: MarkdownSlashTranslate;
  /**
   * Host port for the image entry (M5). Read at COMMAND time through the
   * getter, so a port wired after mount is picked up without re-registering.
   */
  getChooseImage?: () => (() => void) | undefined;
}

/**
 * Build the slash plugin. Pure of React: the component below supplies the live
 * translate + image port, and the tests mount it directly.
 */
export function createMarkdownSlashPlugin({ editor, translate, getChooseImage }: MarkdownSlashPluginOptions): Plugin {
  return Suggestion<MarkdownSlashItem>({
    editor,
    pluginKey: markdownSlashPluginKey,
    char: "/",
    // Any prefix: `/` is meaningful mid-sentence ("text /quote"), and the
    // mid-word exclusion below is what keeps a path like `/usr` from opening it.
    allowedPrefixes: null,
    shouldShow: ({ editor: live, range }) => isTriggerArmedAt(live, range.from),
    allow: ({ editor: live, state, range }) => {
      if (!live.isEditable) return false;
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.name === "codeBlock") return false;
      // Start of the block, or preceded by whitespace: a `/` glued to a word
      // (a URL path, a fraction) is text, not a menu request.
      const before = $from.parent.textBetween(0, $from.parentOffset).at(-1) ?? "";
      return $from.parent.isTextblock && ($from.parentOffset === 0 || /\s/u.test(before));
    },
    items: ({ query }) => filterMarkdownSlashItems(query, translate),
    command: ({ editor: live, range, props }) =>
      insertMarkdownSlashItem(live, range, props.id, { chooseImage: getChooseImage?.() }),
    render: createSuggestionPopupRender({
      pluginKey: markdownSlashPluginKey,
      component: MarkdownSlashList,
      getProps: (props) => ({ items: props.items, editor: props.editor, command: props.command }),
      onKeyDown: (ref: MarkdownSlashListHandle | null | undefined, { event }) => ref?.onKeyDown(event) ?? false,
    }),
  });
}

export interface MarkdownSlashProps {
  /** The live M1 editor instance, or null before it mounts. */
  editor: Editor | null;
  /** Host port for the image entry (M5). Absent -> that pick is inert. */
  chooseImage?: () => void;
  /** Ref holding the host's image picker, read at command time. */
  chooseImageRef?: RefObject<(() => void) | undefined>;
}

/**
 * The menu's mount. Renders nothing: the popup is portaled by the suggestion
 * renderer, so this component's only job is the plugin's lifetime.
 */
export function MarkdownSlash({ editor, chooseImage, chooseImageRef }: MarkdownSlashProps) {
  const { t } = useTranslation();
  const translateRef = useRef<MarkdownSlashTranslate>(t);
  translateRef.current = t;
  const fallbackRef = useRef(chooseImage);
  fallbackRef.current = chooseImage;

  useEffect(() => {
    if (!editor) return undefined;
    editor.registerPlugin(
      createMarkdownSlashPlugin({
        editor,
        translate: (key, options) => translateRef.current(key, options),
        getChooseImage: () => chooseImageRef?.current ?? fallbackRef.current,
      }),
      // Placement, not just registration. `registerPlugin` alone appends, and
      // the plugin array IS the precedence order: appended last, the shared
      // `blurShortcut` extension's Escape binding (which blurs the editor)
      // claims the key first and the menu's own Escape handler never runs.
      // Inserting right AFTER the trigger-arming plugin fixes that while
      // keeping the arming plugin's `apply` ahead of ours - `isTriggerArmedAt`
      // only reports the current transaction once that apply has run, so a
      // plugin placed before it would never see an armed trigger.
      (plugin, plugins) => {
        const armingPrefix = `${SuggestionTriggerArmingExtension.name}$`;
        // `Plugin#key` is the runtime string but is absent from
        // prosemirror-state's public types, so it is read through the same
        // narrowing cast the page-slash test uses.
        const index = plugins.findIndex((candidate) =>
          (candidate as Plugin & { key: string }).key.startsWith(armingPrefix),
        );
        if (index === -1) return [...plugins, plugin];
        return [...plugins.slice(0, index + 1), plugin, ...plugins.slice(index + 1)];
      },
    );
    return () => {
      editor.unregisterPlugin(markdownSlashPluginKey);
    };
  }, [editor, chooseImageRef]);

  return null;
}
