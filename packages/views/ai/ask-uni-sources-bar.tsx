"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { GitHubMark, GmailMark, GoogleDriveMark, SlackMark } from "../common/provider-icons";

/** Apps UNI does not read yet, each in its own colours and named "coming soon". */
const APPS = [
  { name: "Google Drive", Mark: GoogleDriveMark },
  { name: "Slack", Mark: SlackMark },
  { name: "Gmail", Mark: GmailMark },
  { name: "GitHub", Mark: GitHubMark },
] as const;

/**
 * The apps UNI will connect to, drawn the way ClickUp Brain shows its connected apps, under the panel's header. A
 * first look only (the owner's call, 2026-10-24): every app is named "coming soon", nothing connects, and "+" stays
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
        {APPS.map(({ name, Mark }) => {
          const label = t("ai.source_bar.app_soon", { name });
          return (
            <li key={name}>
              <Tooltip>
                <TooltipTrigger render={<span role="img" aria-label={label} className="inline-flex size-6 items-center justify-center rounded-md bg-muted text-foreground opacity-80" />}>
                  <Mark className="size-3.5" />
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
                <Button type="button" variant="ghost" size="icon-xs" aria-disabled className="rounded-md border border-dashed border-border text-muted-foreground" />
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
