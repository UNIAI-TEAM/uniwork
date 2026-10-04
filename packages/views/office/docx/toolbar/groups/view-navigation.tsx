"use client";

// A6-wire (UNI-924): the View tab's navigation group. W-H adds a typed ribbon
// toggle for the navigation pane; the pane itself (view/navigation-host.tsx)
// reads the live document outline and scrolls the clicked heading, so no engine
// accessor is needed here. A zero-width host item keeps this component (which
// mounts the pane) mounted next to the typed toggle. The ruler toggle stays out
// of the typed model: the ruler is mounted by the view chrome with no toggle
// seam (noted in the W-H report).
import { ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { RibbonItem } from "../../../ribbon";
import { DocxNavigationHost } from "../../view";
import type { DocxToolbarGroupContext } from "../types";
import { createRibbonOpenStore, ribbonHostItem, useRibbonOpen } from "./ribbon-open-store";

/** Shared open state of the navigation pane. */
const navigationPane = createRibbonOpenStore();

/** The typed ribbon items for the View > navigation group. */
export function viewNavigationRibbonItems(context: DocxToolbarGroupContext): readonly RibbonItem[] {
  return [
    {
      kind: "toggle",
      id: "view-navigation",
      labelKey: "office.docx.view.navigation.label",
      icon: ListTree,
      size: "large",
      collapseAs: "small",
      pressed: navigationPane.get(),
      onExecute: () => navigationPane.set(!navigationPane.get()),
    },
    ribbonHostItem("view-navigation-host", "office.docx.toolbar.groups.navigation", ViewNavigationGroup, context),
  ];
}

/** View > navigation: the typed items live on the registry entry; this
 * component keeps the pane mount and stays exported for direct use. */
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

ViewNavigationGroup.ribbonItems = viewNavigationRibbonItems;





