import type { UploadResult } from "@uniwork/core/hooks/use-file-upload";
import type { Attachment } from "@uniwork/core/types";
import type { MentionItem } from "./extensions/mention-suggestion";
import type { BuiltinCommandSuggestionOptions } from "./extensions/slash-command-suggestion";
import type { CreateSubTaskFn } from "./bubble-menu";
import type { TextAnchor } from "./text-anchor";

export interface ContentEditorBaseProps {
  /**
   * `baseMarkdown` is the last authoritative controlled value this editor
   * actually adopted before producing `markdown`. A dirty-editor realtime
   * guard may intentionally skip newer server content, so callers must not
   * substitute the latest prop value for this base.
   */
  onUpdate?: (markdown: string, baseMarkdown: string) => void;
  placeholder?: string;
  className?: string;
  debounceMs?: number;
  onSubmit?: () => void;
  onBlur?: () => void;
  /**
   * Upload transport. `uploadId` is minted by the editor when it inserts the
   * placeholder node; a host backed by a draft store MUST adopt it as the
   * upload's `clientUploadId` so both records share one identity — that is
   * what lets a settle find its placeholder in a document a later mount
   * rebuilt. Hosts with no persistence may ignore it.
   */
  onUploadFile?: (file: File, uploadId: string) => Promise<UploadResult | null>;
  /**
   * Character count above which a plain-text paste is uploaded as a
   * `pasted-text.txt` attachment instead of being inserted as body text.
   * Requires `onUploadFile`; without an uploader the paste stays text.
   *
   * Opt-in ON PURPOSE, and today only chat passes it: a wall of pasted text
   * there is context handed to an agent for one turn, and reads better as an
   * attachment than as a body nobody scrolls. Every other editor keeps the
   * paste inline — in task and project descriptions a long paste IS the
   * content, and in task comments it is prose a human reader is expected to
   * see in the thread.
   */
  pasteAsFileThreshold?: number;
  /**
   * Fired whenever this editor's "any attachment still uploading" answer
   * flips. The document IS the upload queue — every path (paste, drop, the
   * upload button, the imperative `uploadFile`) inserts a node with
   * `attrs.uploading` before awaiting, and clears or removes it on settle —
   * so hosts can drive a submit gate off one source of truth instead of a
   * counter of their own that a manual node delete would desync.
   *
   * Pair it with the submit-time `hasActiveUploads()` second check: this
   * callback drives the rendered button state, and the ref read is what a
   * keyboard submit racing the last upload's settle must consult.
   *
   * Hosts that don't gate (the autosaved description editor) omit it and
   * pay nothing — the scan below is skipped entirely when it's absent.
   */
  onUploadingChange?: (uploading: boolean) => void;
  /** Show the floating formatting toolbar on text selection. Defaults true. */
  showBubbleMenu?: boolean;
  /**
   * ID of the task this editor belongs to. When set, the bubble menu exposes
   * a "Create sub-task from selection" action that parents the new task
   * under this ID and replaces the selection with a mention link.
   */
  currentTaskId?: string;
  onCreateSubTask?: CreateSubTaskFn;
  /**
   * When true, the `@` suggestion picker is disabled but the mention node
   * type remains in the schema, so existing mentions pasted in from other
   * UniWork editors still render as the normal pill. Use for editors where
   * *creating* a new mention has no business meaning (e.g. agent system
   * prompts) but *preserving* an existing one still matters.
   */
  disableMentions?: boolean;
  /** Chat can surface current/recent task/project suggestions. Other editors use default mention behavior. */
  mentionMode?: "default" | "context";
  mentionContextItems?: MentionItem[];
  /** Enable the `/` command picker. Defaults false. */
  enableSlashCommands?: boolean;
  /**
   * Which `/` menu to show when enableSlashCommands is true: "skill" (default)
   * lists the active agent's skills (chat); "command" shows the fixed built-in
   * command menu (task comments), e.g. /note.
   */
  slashCommandMode?: "skill" | "command";
  /**
   * Quick actions to offer in the "command" `/` menu, plus the resolver that
   * turns a pick into the text it would post (UNI-0). Read through
   * functions so a newly created action appears without remounting the editor.
   */
  quickActionMenu?: BuiltinCommandSuggestionOptions;
  /**
   * Attachments referenced by this content. The download buttons on file
   * cards and images inside the editor look up an attachment by `url` and
   * fetch a fresh CloudFront signature at click time, so a stale URL
   * persisted in markdown never opens. Pass `task.attachments` /
   * `comment.attachments` etc.; omit when no attachment context is
   * available (NodeView buttons fall back to opening the raw URL).
   */
  attachments?: Attachment[];
  /**
   * Flush a pending debounced `onUpdate` when the editor unmounts instead of
   * dropping it. Default false ON PURPOSE: most composers clear their draft
   * and then unmount (comment edit cancel, create-task / feedback submit),
   * and a flush there would hand the discarded content right back to
   * `onUpdate`, resurrecting the cleared draft. Opt in only where closing
   * means "keep what the user last saw" — e.g. the task-detail description
   * editor, whose 1500ms debounce would otherwise drop a paste made just
   * before the modal closes.
   */
  flushPendingOnUnmount?: boolean;
  /**
   * Called once when the Tiptap instance exists and its initial content is
   * set (creation is deferred past first paint by `immediatelyRender: false`).
   * Readonly-first hosts such as comment and reply composers use this as the
   * signal to swap their static shell for the live editor.
   */
  onReady?: () => void;
}

export type ContentEditorValueProps =
  | {
      /** Initial markdown, read once when the editor mounts. */
      defaultValue?: string;
      value?: never;
    }
  | {
      /**
       * Externally synchronized markdown. Use only when changes from outside
       * this editor must replace its document (for example realtime server
       * updates or switching the document held by a stable editor instance).
       */
      value: string;
      defaultValue?: never;
    };

export type ContentEditorProps = ContentEditorBaseProps & ContentEditorValueProps;

export interface ContentEditorRef {
  getMarkdown: () => string;
  clearContent: () => void;
  focus: () => void;
  /**
   * Focus and place the caret at the document position under the given
   * viewport coordinates. Used by readonly-first hosts so the click that
   * summoned the editor lands the caret where the user clicked, matching
   * the always-mounted editor's behavior. Falls back to focusing the end
   * when no position resolves (click below the last line). Must be called
   * while the editor element is laid out (not display: none).
   */
  focusAtCoords: (coords: { x: number; y: number }) => void;
  /**
   * Focus and place the caret at the document position a text anchor
   * resolves to. Preferred over `focusAtCoords` for readonly-first hosts:
   * the anchor is a logical position ("block N, character M"), so it is
   * immune to layout differences between the readonly render and the
   * editor render — which is exactly where pixel coordinates drift on
   * long documents.
   */
  focusAtAnchor: (anchor: TextAnchor) => void;
  /** Drop focus from the editor. Used by `useComposerSubmit`'s
   *  `afterAccepted: "blur"` on surfaces where a send ends the turn, so the
   *  composer stops reading as "still writing". */
  blur: () => void;
  uploadFile: (file: File) => void;
  /** True when file uploads are still in progress. */
  hasActiveUploads: () => boolean;
  /**
   * Append a markdown fragment to the end of the document (parsed, not raw
   * text), firing the normal `onUpdate` pipeline. For the upload write-back
   * path (UNI-0): an upload that outlived the mount that started it settles
   * while a NEW editor instance is showing the same draft — that editor never
   * owned the upload's promise, so this is how the finished attachment's link
   * lands in the visible document instead of only in the persisted draft.
   *
   * Returns whether the insert actually landed. The imperative handle exists
   * from the component's first commit, but the Tiptap instance is created in a
   * passive effect — in that window (and after destroy) this is a no-op and
   * returns false so the caller can fall back or retry instead of silently
   * losing the fragment.
   */
  insertMarkdownAtEnd: (markdown: string) => boolean;
  /**
   * Draw a placeholder for an upload this document is not showing yet, and
   * report whether it landed.
   *
   * A composer that reopens over an upload a previous mount started has the
   * draft's record of it but no node — placeholders are never serialised, so
   * they die with the document that drew them. Without this the user faces a
   * composer that looks idle while a send gate quietly blocks on the upload.
   * Returns false when the Tiptap instance is not up yet (the handle exists
   * from first commit, the instance arrives a passive effect later), so the
   * caller can retry rather than assume.
   */
  insertUploadPlaceholder: (upload: {
    uploadId: string;
    filename: string;
    size?: number;
  }) => boolean;
  /**
   * Turn a placeholder into the finished attachment, in place. False when this
   * document holds no node for the id — the caller then falls back to
   * appending the link.
   */
  settleUploadPlaceholder: (uploadId: string, result: UploadResult) => boolean;
  /**
   * Cancel the pending debounced `onUpdate` and hand its markdown back to the
   * caller instead of firing it. Returns null when nothing is pending.
   *
   * For hosts that re-point ONE editor instance at a different destination
   * (chat swaps `draftKey` between sessions). A debounce armed under the old
   * destination would otherwise fire after the switch and, because `onUpdate`
   * always resolves to the latest render's closure, write the old document
   * into the NEW destination. Taking the markdown back lets the host commit it
   * where it was actually typed. Flushing also marks the editor clean, so the
   * dirty guard stops suppressing the incoming synchronized `value`.
   *
   * Distinct from `flushPendingOnUnmount`: this is for a LIVE editor changing
   * targets, so it reads the current document rather than a cached copy.
   */
  flushPendingUpdate: () => string | null;
  /**
   * Force `markdown` into the document, bypassing the synchronized `value`
   * guards.
   *
   * Those guards SKIP permanently rather than defer: `lastSyncedValueRef`
   * advances before they run, so a `value` they refuse is never
   * re-applied. That is correct for their usual case (the cache will send
   * another value), but not for a host that re-points ONE instance at a
   * different document and must land it exactly once — chat's draft switch,
   * where an in-flight upload makes Guard 0 refuse the swap.
   *
   * The caller owns the safety the guards normally provide: only call once the
   * reason for the block is gone (upload settled) and any pending edits have
   * been flushed, or this destroys them.
   */
  adoptContent: (markdown: string) => void;
}

