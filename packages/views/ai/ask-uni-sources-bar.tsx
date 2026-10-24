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
 * Apps UNI does not read yet, shown faded and named "coming soon". Single-colour marks from Simple Icons (CC0 path
 * data, simple-icons@13.21.0); the names and logos are their owners' trademarks.
 */
const APPS = [
  { name: "Google Drive", path: "M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z" },
  { name: "Slack", path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" },
  { name: "Gmail", path: "M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" },
  { name: "GitHub", path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" },
] as const;

/**
 * Where UNI looks, drawn the way ClickUp Brain shows its connected apps, under the panel's header. A first look only
 * (the owner's call, 2026-10-24): it lists the modules UNI already reads, then a few outside apps faded as coming
 * soon; it connects nothing, and "+" stays disabled until real connectors ship. Hiding it lasts while the panel
 * stays open.
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
        <li aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        {APPS.map(({ name, path }) => {
          const label = t("ai.source_bar.app_soon", { name });
          return (
            <li key={name}>
              <Tooltip>
                <TooltipTrigger render={<span role="img" aria-label={label} className="inline-flex size-5 items-center justify-center rounded-[5px] bg-muted text-muted-foreground opacity-60" />}>
                  <svg aria-hidden viewBox="0 0 24 24" className="size-3 fill-current">
                    <path d={path} />
                  </svg>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
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
