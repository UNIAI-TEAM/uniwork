"use client";

/**
 * The HTML ribbon (Amendment R, R8): the HTML surface's tabs and labelled
 * groups, defined once as data and mounted on the shared `OfficeRibbon`
 * (UNI-931).
 *
 * The ribbon owns the tab row and the group body. It is the surface assembler
 * for the HTML format: the Insert tab exposes H4's insert intents (heading,
 * paragraph, image from file / URL, a table size picker, list, button and
 * section presets) and the Inline/Paragraph tabs the marks and block styles,
 * all wired to caller callbacks so the editor shell applies them through H3's
 * pure ops - never a string splice. Undo/redo ride the ribbon's quick-access
 * slot (C6) and Find plus the Source | Split | Preview | Present control its
 * trailing slot (C6/C11). No floating controls (C9).
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Code,
  Heading1,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  Minus,
  Pilcrow,
  Redo2,
  Search,
  Square,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { OfficeRibbon, type OfficeRibbonProps } from "../ribbon";
import type { RibbonGroup, RibbonIcon, RibbonItem, RibbonTab } from "../ribbon/types";

/** The HTML insert intents the ribbon exposes; the shell maps each to H3 ops. */
export type HtmlInlineMark = "bold" | "italic" | "underline" | "strike" | "code";
export type HtmlBlockStyle = "paragraph" | "heading1" | "heading2" | "heading3" | "blockquote";

/** i18next keys for the HTML ribbon's own labels (see MISSING KEYS list). */
export const HTML_RIBBON_KEYS = {
  label: "office.html.ribbon.label",
  home: "office.html.ribbon.tabs.home",
  insert: "office.html.ribbon.tabs.insert",
  clipboard: "office.html.ribbon.groups.clipboard",
  inline: "office.html.ribbon.groups.inline",
  paragraph: "office.html.ribbon.groups.paragraph",
  image: "office.html.ribbon.groups.image",
  tableSizeLabel: "office.html.ribbon.tableSizeLabel",
  orderedList: "office.html.ribbon.orderedList",
  blockquote: "office.html.ribbon.blockquote",
} as const;

/** Every action the ribbon can raise; all optional so a host wires only what it has. */
export interface HtmlRibbonCommands {
  onUndo?: () => void;
  onRedo?: () => void;
  onInlineMark?: (mark: HtmlInlineMark) => void;
  onSetBlock?: (block: HtmlBlockStyle) => void;
  onInsertList?: (kind: "unordered" | "ordered") => void;
  onInsertImageFile?: () => void;
  onInsertImageUrl?: (url: string) => void;
  onInsertTable?: (rows: number, columns: number) => void;
  onInsertButton?: () => void;
  onInsertSection?: () => void;
  onInsertHorizontalRule?: () => void;
}

/** Which marks/blocks currently read as "on". */
export interface HtmlRibbonState {
  readOnly?: boolean;
  marks?: Partial<Record<HtmlInlineMark, boolean>>;
  block?: HtmlBlockStyle;
  list?: "unordered" | "ordered" | null;
}

export interface HtmlRibbonOptions {
  commands?: HtmlRibbonCommands;
  state?: HtmlRibbonState;
  /** Trailing Find affordance; the caller owns the panel and the Ctrl+F key. */
  onFind?: () => void;
  /** View mode shown by the trailing segmented control (C11). */
  viewMode?: "source" | "split" | "preview";
  onViewModeChange?: (mode: "source" | "split" | "preview") => void;
  /** Present mode toggle (H2); when supplied a Present control is added. */
  presenting?: boolean;
  onTogglePresent?: () => void;
  /** Persisted collapse scope, one per format. Defaults to "html". */
  scope?: string;
  layout?: OfficeRibbonProps["layout"];
  className?: string;
}

export interface HtmlRibbonProps extends HtmlRibbonOptions {
  /** The HTML editor is always available to the ribbon once mounted. */
  editor?: unknown;
}

const MARK_ICONS: Record<HtmlInlineMark, RibbonIcon> = {
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  code: Code,
};

const MARK_LABEL_KEYS: Record<HtmlInlineMark, string> = {
  bold: "office.html.float.bold",
  italic: "office.html.float.italic",
  underline: "office.html.inline.underline",
  strike: "office.html.inline.strike",
  code: "office.html.inline.code",
};

const BLOCK_STYLES: readonly { id: HtmlBlockStyle; labelKey: string; icon: RibbonIcon }[] = [
  { id: "paragraph", labelKey: "office.html.ribbon.paragraph", icon: Pilcrow },
  { id: "heading1", labelKey: "office.html.ribbon.heading", icon: Heading1 },
  { id: "heading2", labelKey: "office.html.ribbon.heading", icon: Heading1 },
  { id: "heading3", labelKey: "office.html.ribbon.heading", icon: Heading1 },
  { id: "blockquote", labelKey: HTML_RIBBON_KEYS.blockquote, icon: Minus },
];

const TABLE_MAX = 6;

/**
 * Whether an image URL may be offered to the document at all.
 *
 * The isolated preview gate keeps a URL only when it resolves through the
 * scoped asset proxy; an external `http(s)://`, protocol-relative or
 * `javascript:`/`data:` URL, or one carrying markup characters, is dropped. A
 * URL the gate would drop must not be offered, so this mirrors that rule for
 * the ribbon's image-from-URL control: only a relative or root-absolute path
 * without a scheme is accepted.
 */
export function htmlImageUrlAllowed(url: string): boolean {
  const value = url.trim();
  if (value.length === 0) return false;
  if (/[<>]/.test(value)) return false;
  if (value.startsWith("//")) return false;
  // A scheme (javascript:, data:, http:, mailto:, ...) is never an asset path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || /\s/u.test(ch)) return false;
  }
  return true;
}

/** Image-from-URL control: one popover that refuses a URL the gate would drop. */
function ImageUrlPopover({ disabled, onInsert }: { disabled: boolean; onInsert?: (url: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const label = t("office.html.ribbon.imageUrl");
  const allowed = htmlImageUrlAllowed(url);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-disabled={disabled || undefined} data-html-image-url />}
      >
        <Link2 aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-2" data-html-image-url-popover>
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t("office.html.ribbon.imageUrlPlaceholder")}
          aria-label={t("office.html.ribbon.imageUrlPlaceholder")}
          data-html-image-url-input
        />
        {url.length > 0 && !allowed ? (
          <p className="text-caption text-destructive" role="alert">{t("office.html.ribbon.imageUrlRefused")}</p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={disabled || !allowed}
          onClick={() => {
            onInsert?.(url.trim());
            setOpen(false);
            setUrl("");
          }}
        >
          {t("office.html.ribbon.imageUrlInsert")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A grid size picker: hover a cell to pick rows x columns (word-processor style). */
function TableSizePicker({ disabled, onPick, label }: { disabled: boolean; onPick: (rows: number, columns: number) => void; label: string }) {
  const { t } = useTranslation();
  const [size, setSize] = useState<{ rows: number; columns: number }>({ rows: 0, columns: 0 });
  return (
    <div className="flex flex-col items-center gap-1 px-1" data-html-table-picker role="group" aria-label={label}>
      {Array.from({ length: TABLE_MAX }, (_, r) => (
        <div key={r} className="flex gap-0.5">
          {Array.from({ length: TABLE_MAX }, (_, c) => {
            const active = r <= size.rows - 1 && c <= size.columns - 1;
            return (
              <button
                key={c}
                type="button"
                aria-label={t("office.html.ribbon.tableSize", { rows: r + 1, cols: c + 1 })}
                aria-disabled={disabled || undefined}
                data-html-table-cell={`${r + 1}x${c + 1}`}
                className={`size-3 rounded-[2px] border border-border ${active ? "bg-brand" : "bg-background"}`}
                onMouseEnter={() => setSize({ rows: r + 1, columns: c + 1 })}
                onFocus={() => setSize({ rows: r + 1, columns: c + 1 })}
                onClick={() => {
                  if (!disabled) onPick(r + 1, c + 1);
                }}
              />
            );
          })}
        </div>
      ))}
      <span className="text-caption text-muted-foreground" data-html-table-size-label>
        {size.rows > 0 ? t("office.html.ribbon.tableSize", { rows: size.rows, cols: size.columns }) : label}
      </span>
    </div>
  );
}

/** Build the HTML ribbon tabs. Pure of layout: the ribbon decides sizing and collapse. */
export function useHtmlRibbonTabs(options: HtmlRibbonOptions = {}): RibbonTab[] {
  const { t } = useTranslation();
  const { commands = {}, state = {} } = options;
  const readOnly = state.readOnly === true;
  const mark = (id: HtmlInlineMark): boolean => state.marks?.[id] === true;

  return useMemo<RibbonTab[]>(() => {
    const inline: RibbonGroup = {
      id: "inline",
      labelKey: HTML_RIBBON_KEYS.inline,
      priority: 50,
      items: (Object.keys(MARK_ICONS) as HtmlInlineMark[]).map<RibbonItem>((id, index) => ({
        kind: "toggle",
        id,
        labelKey: MARK_LABEL_KEYS[id],
        icon: MARK_ICONS[id],
        size: index === 0 ? "large" : "icon",
        pressed: mark(id),
        disabled: readOnly || !commands.onInlineMark,
        onExecute: () => commands.onInlineMark?.(id),
      })),
    };
    const paragraph: RibbonGroup = {
      id: "paragraph",
      labelKey: HTML_RIBBON_KEYS.paragraph,
      priority: 40,
      items: [
        ...BLOCK_STYLES.map<RibbonItem>((style) => ({
          kind: "toggle",
          id: `block-${style.id}`,
          labelKey: style.labelKey,
          icon: style.icon,
          size: style.id === "paragraph" ? "large" : "icon",
          pressed: state.block === style.id,
          disabled: readOnly || !commands.onSetBlock,
          onExecute: () => commands.onSetBlock?.(style.id),
        })),
        {
          kind: "toggle",
          id: "list-unordered",
          labelKey: "office.html.ribbon.list",
          icon: List,
          size: "icon",
          pressed: state.list === "unordered",
          disabled: readOnly || !commands.onInsertList,
          onExecute: () => commands.onInsertList?.("unordered"),
        },
        {
          kind: "toggle",
          id: "list-ordered",
          labelKey: HTML_RIBBON_KEYS.orderedList,
          icon: List,
          size: "icon",
          pressed: state.list === "ordered",
          disabled: readOnly || !commands.onInsertList,
          onExecute: () => commands.onInsertList?.("ordered"),
        },
      ],
    };
    const insert: RibbonGroup = {
      id: "insert",
      labelKey: "office.html.ribbon.label",
      priority: 20,
      items: [
        {
          kind: "button",
          id: "image-file",
          labelKey: "office.html.ribbon.imageFile",
          icon: ImageIcon,
          size: "large",
          disabled: readOnly || !commands.onInsertImageFile,
          onExecute: () => commands.onInsertImageFile?.(),
        },
        {
          kind: "custom",
          id: "image-url",
          labelKey: "office.html.ribbon.imageUrl",
          icon: Link2,
          width: 36,
          collapseAs: "icon",
          render: () => <ImageUrlPopover disabled={readOnly || !commands.onInsertImageUrl} onInsert={commands.onInsertImageUrl} />,
        },
        {
          kind: "custom",
          id: "table-size",
          labelKey: "office.html.ribbon.table",
          icon: Table2,
          width: 96,
          render: () => (
            <TableSizePicker
              disabled={readOnly || !commands.onInsertTable}
              label={t("office.html.ribbon.tableSizeLabel")}
              onPick={(rows, columns) => commands.onInsertTable?.(rows, columns)}
            />
          ),
        },
        {
          kind: "button",
          id: "button-preset",
          labelKey: "office.html.ribbon.button",
          icon: Square,
          size: "icon",
          disabled: readOnly || !commands.onInsertButton,
          onExecute: () => commands.onInsertButton?.(),
        },
        {
          kind: "button",
          id: "section-preset",
          labelKey: "office.html.ribbon.section",
          icon: Square,
          size: "icon",
          disabled: readOnly || !commands.onInsertSection,
          onExecute: () => commands.onInsertSection?.(),
        },
        {
          kind: "button",
          id: "horizontal-rule",
          labelKey: "office.html.ribbon.hr",
          icon: Minus,
          size: "icon",
          disabled: readOnly || !commands.onInsertHorizontalRule,
          onExecute: () => commands.onInsertHorizontalRule?.(),
        },
      ],
    };
    return [
      {
        id: "home",
        labelKey: HTML_RIBBON_KEYS.home,
        groups: [
          {
            id: "clipboard",
            labelKey: HTML_RIBBON_KEYS.clipboard,
            priority: 60,
            icon: Undo2,
            items: [
              {
                kind: "button",
                id: "undo",
                labelKey: "office.html.actions.undo",
                icon: Undo2,
                size: "large",
                shortcut: "Ctrl+Z",
                disabled: readOnly || !commands.onUndo,
                onExecute: () => commands.onUndo?.(),
              },
              {
                kind: "button",
                id: "redo",
                labelKey: "office.html.actions.redo",
                icon: Redo2,
                size: "icon",
                shortcut: "Ctrl+Y",
                disabled: readOnly || !commands.onRedo,
                onExecute: () => commands.onRedo?.(),
              },
            ],
          },
          paragraph,
          inline,
        ],
      },
      { id: "insert", labelKey: HTML_RIBBON_KEYS.insert, groups: [insert] },
    ];
  }, [commands, readOnly, state.block, state.list, state.marks, t]);
}

/** The HTML ribbon surface: the shared ribbon with the HTML tabs and trailing controls. */
export function HtmlRibbon({
  commands,
  state,
  onFind,
  viewMode = "split",
  onViewModeChange,
  presenting = false,
  onTogglePresent,
  scope = "html",
  layout,
  className,
}: HtmlRibbonProps) {
  const { t } = useTranslation();
  const readOnly = state?.readOnly === true;
  const tabs = useHtmlRibbonTabs({ commands, state, onFind, viewMode, onViewModeChange, presenting, onTogglePresent, scope, layout, className });

  const quickAccess = useMemo(
    () => (
      <>
        <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.html.actions.undo")} disabled={readOnly || !commands?.onUndo} onClick={() => commands?.onUndo?.()}>
          <Undo2 aria-hidden />
        </Button>
        <Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.html.actions.redo")} disabled={readOnly || !commands?.onRedo} onClick={() => commands?.onRedo?.()}>
          <Redo2 aria-hidden />
        </Button>
      </>
    ),
    [commands, readOnly, t],
  );

  const setViewMode = useCallback((mode: string) => onViewModeChange?.(mode as "source" | "split" | "preview"), [onViewModeChange]);

  const trailing = useMemo(
    () => (
      <>
        {onFind ? (
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="toolbar" size="icon-sm" aria-label={t("office.common.chrome.find")} onClick={onFind} />}>
              <Search aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("office.common.chrome.find")}</TooltipContent>
          </Tooltip>
        ) : null}
        {onViewModeChange ? (
          <ToggleGroup value={[viewMode]} onValueChange={(value) => value[0] && setViewMode(value[0])} aria-label={t("office.html.view.label")}>
            <ToggleGroupItem value="source" className="h-7 px-2 text-label">{t("office.html.view.source")}</ToggleGroupItem>
            <ToggleGroupItem value="split" className="h-7 px-2 text-label">{t("office.html.view.split")}</ToggleGroupItem>
            <ToggleGroupItem value="preview" className="h-7 px-2 text-label">{t("office.html.view.preview")}</ToggleGroupItem>
          </ToggleGroup>
        ) : null}
        {onTogglePresent ? (
          <Button type="button" variant="toolbar" size="icon-sm" aria-pressed={presenting} aria-label={t(presenting ? "office.html.present.exit" : "office.html.present.enter")} onClick={onTogglePresent}>
            <Square aria-hidden />
          </Button>
        ) : null}
      </>
    ),
    [onFind, onTogglePresent, onViewModeChange, presenting, setViewMode, t, viewMode],
  );

  return (
    <OfficeRibbon
      tabs={tabs}
      scope={scope}
      quickAccess={quickAccess}
      trailing={trailing}
      layout={layout}
      labelKey={HTML_RIBBON_KEYS.label}
      className={className}
    />
  );
}
