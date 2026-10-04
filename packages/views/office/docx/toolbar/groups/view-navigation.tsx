"use client";

// A6-wire (UNI-924): the View tab's navigation group. W-H typed the toggle but
// it snapshotted `navigationPane.get()` at build time, so its `pressed` value
// went stale (F6). The toggle is mounted as a live `custom` item that subscribes
// to the pane store. The pane itself is mounted by the toolbar-level
// `RibbonDialogHosts` (F7), so folding the group cannot destroy it.
import { ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../../ribbon";
import { DocxNavigationHost } from "../../view";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, registerRibbonDialogHost, ribbonHostItem, useRibbonOpen, useRibbonOpenLive } from "./ribbon-open-store";

/** Shared open state of the navigation pane. */
const navigationPane = createRibbonOpenStore();

/** The live navigation toggle: subscribes to the pane store so `aria-pressed`
 * tracks the current state instead of a build-time snapshot (F6). */
function NavigationToggle() {
  const { t } = useTranslation();
  const open = useRibbonOpenLive(navigationPane);
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={t("office.docx.view.navigation.label")}
      aria-pressed={open}
      data-ribbon-item="view-navigation"
      data-testid="docx-navigation-ribbon-toggle"
      onClick={() => navigationPane.set(!open)}
    >
      <ListTree aria-hidden />
    </Button>
  );
}

/** The typed ribbon items for the View > navigation group. */
export function viewNavigationRibbonItems(_context: DocxToolbarGroupContext): readonly RibbonItem[] {
  return [
    {
      kind: "custom",
      id: "view-navigation",
      labelKey: "office.docx.view.navigation.label",
      width: 96,
      render: () => <NavigationToggle />,
    },
    ribbonHostItem("view-navigation-host", "office.docx.toolbar.groups.navigation"),
  ];
}

/** View > navigation: this component owns the pane and is mounted by
 * `RibbonDialogHosts`. */
export function ViewNavigationGroup(_props: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open] = useRibbonOpen(navigationPane);
  return (
    <Popover open={open} onOpenChange={navigationPane.set}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("office.docx.view.navigation.label")}
            data-testid="docx-navigation-toggle"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
        }
      >
        <ListTree aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="h-80 max-h-[70vh] w-80 overflow-hidden p-0">
        <DocxNavigationHost className="min-h-0 flex-1" onClose={() => navigationPane.set(false)} />
      </PopoverContent>
    </Popover>
  );
}

registerRibbonDialogHost("view-navigation-host", ViewNavigationGroup);
