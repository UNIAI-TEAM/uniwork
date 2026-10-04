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
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Code,
  Frame,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MonitorPlay,
  Pilcrow,
  RectangleHorizontal,
  Redo2,
  Search,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { OfficeRibbon, type OfficeRibbonProps } from "../ribbon";
import type { RibbonGroup, RibbonIcon, RibbonItem, RibbonTab } from "../ribbon/types";
import { htmlImageUrlAllowed, ImageUrlPopover, TableSizePicker } from "./ribbon-controls";

export { htmlImageUrlAllowed };

/** The HTML insert intents the ribbon exposes; the shell maps each to H3 ops. */
export type HtmlInlineMark = "bold" | "italic" | "underline" | "strike" | "code";
export type HtmlBlockStyle = "paragraph" | "heading1" | "heading2" | "heading3" | "blockquote";

/** i18next keys for the HTML ribbon's own labels (see MISSING KEYS list). */
export const HTML_RIBBON_KEYS = {
  /** Landmark name for the ribbon region (distinct from the Insert tab label). */
  ribbonLabel: "office.html.ribbon.ribbonLabel",
  label: "office.html.ribbon.label",
  home: "office.html.ribbon.tabs.home",
  insert: "office.html.ribbon.tabs.insert",
  clipboard: "office.html.ribbon.groups.clipboard",
  inline: "office.html.ribbon.groups.inline",
  paragraph: "office.html.ribbon.groups.paragraph",
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
  { id: "heading2", labelKey: "office.html.ribbon.heading", icon: Heading2 },
  { id: "heading3", labelKey: "office.html.ribbon.heading", icon: Heading3 },
  { id: "blockquote", labelKey: HTML_RIBBON_KEYS.blockquote, icon: Minus },
];

/** Build the HTML ribbon tabs. Pure of layout: the ribbon decides sizing and collapse. */
export function useHtmlRibbonTabs(options: HtmlRibbonOptions = {}): RibbonTab[] {
  const { t } = useTranslation();
  const { commands = {}, state = {} } = options;
  const readOnly = state.readOnly === true;

  return useMemo<RibbonTab[]>(() => {
    const mark = (id: HtmlInlineMark): boolean => state.marks?.[id] === true;
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
          icon: ListOrdered,
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
          icon: RectangleHorizontal,
          size: "icon",
          disabled: readOnly || !commands.onInsertButton,
          onExecute: () => commands.onInsertButton?.(),
        },
        {
          kind: "button",
          id: "section-preset",
          labelKey: "office.html.ribbon.section",
          icon: Frame,
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
            <MonitorPlay aria-hidden />
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
      labelKey={HTML_RIBBON_KEYS.ribbonLabel}
      className={className}
    />
  );
}
