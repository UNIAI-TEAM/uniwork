"use client";

import { ListTree } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { DocxNavigationHost } from "../../view";
import type { DocxToolbarGroupContext } from "../types";

/** A6-wire: the View tab's navigation group owns the pane's open state and
 *  renders the pane as a popover; the pane itself (view/navigation-host.tsx)
 *  reads the live document outline and scrolls the clicked heading, so no
 *  engine accessor is needed here. */
export function ViewNavigationGroup(_props: DocxToolbarGroupContext) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            aria-label={t("office.docx.view.navigation.label")}
            data-testid="docx-navigation-toggle"
          />
        }
      >
        <ListTree aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="h-80 max-h-[70vh] w-80 overflow-hidden p-0">
        <DocxNavigationHost className="min-h-0 flex-1" onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
