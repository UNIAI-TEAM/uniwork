"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone, type ModuleKey } from "../layout/module-tones";

/** The modules Ask UNI reads today: search_workspace and the readers cover these and nothing outside UniWork. */
const SOURCES = ["tasks", "projects", "documents", "meetings", "chat", "people"] as const satisfies readonly ModuleKey[];

/**
 * Where UNI looks, drawn the way ClickUp Brain shows its connected apps, under the panel's header. A first look only
 * (the owner's call, 2026-10-24): it lists the modules UNI already reads, connects nothing, and "+" stays
 * disabled until real connectors ship. Hiding it lasts while the panel stays open.
 */
export function AskUniSourcesBar() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div data-slot="ask-uni-sources" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{t("ai.source_bar.title")}</span>
      <ul aria-label={t("ai.source_bar.title")} className="flex items-center gap-1">
        {SOURCES.map((m) => (
          <li key={m}>
            <Tooltip>
              <TooltipTrigger render={<span role="img" aria-label={t(`nav.${m}`)} className="inline-flex" />}>
                <IconTile icon={MODULE_ICONS[m]} tone={moduleTone(m)} size="xs" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t(`nav.${m}`)}</TooltipContent>
            </Tooltip>
          </li>
        ))}
        <li>
          <Tooltip>
            <TooltipTrigger
              render={
                // Kept in the tab order so its tooltip can say why it does nothing yet.
                <Button type="button" variant="ghost" size="icon-xs" aria-disabled className="size-5 rounded-[5px] border border-dashed border-border text-muted-foreground" />
              }
              aria-label={t("ai.source_bar.more")}
            >
              <Plus aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("ai.source_bar.more")}</TooltipContent>
          </Tooltip>
        </li>
      </ul>
      <Tooltip>
        <TooltipTrigger
          render={<Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => setHidden(true)} />}
          aria-label={t("ai.source_bar.hide")}
        >
          <X aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("ai.source_bar.hide")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
