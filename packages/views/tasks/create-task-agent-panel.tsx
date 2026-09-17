"use client";

import { useState } from "react";
import { Maximize2, Minimize2, Paperclip, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogDescription, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { PillButton } from "../common/pill-button";
import { ContentEditor } from "../editor";
import { useOptionalWorkspace } from "../layout/workspace-context";

export type CreateTaskAgentPanelProps = {
  workspaceId: string;
  carry?: Record<string, unknown> | null;
  onClose: () => void;
  onSwitchMode: (carry?: Record<string, unknown> | null) => void;
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
};

function projectIdFromCarry(carry?: Record<string, unknown> | null): string | undefined {
  const value = carry?.project_id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Agent create-panel chrome. Submit is gated (ADR 0010): toast only —
 * no useCreateTask / POST /tasks until a real agent-create API exists.
 */
export function CreateTaskAgentPanel({
  carry,
  onClose,
  onSwitchMode,
  isExpanded,
  setIsExpanded,
}: CreateTaskAgentPanelProps) {
  const { t } = useTranslation();
  const workspaceContext = useOptionalWorkspace();
  const workspaceName = workspaceContext?.workspace.name ?? t("tasks.new");
  const agentName = "Agent";
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState<string | undefined>(() => projectIdFromCarry(carry));
  const [createAnother, setCreateAnother] = useState(false);

  const submit = () => {
    toast.error(t("tasks.create.agent_unavailable"));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <DialogTitle className="truncate text-body font-medium">
            {workspaceName}
            <span className="mx-1.5 text-muted-foreground" aria-hidden>
              ›
            </span>
            {t("tasks.create.agent_breadcrumb")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("tasks.create.sr_agent")}</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={isExpanded ? t("tasks.create.collapse") : t("tasks.create.expand")}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common.close")} onClick={onClose}>
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar size="sm" aria-hidden>
            <AvatarFallback>{agentName.slice(0, 1)}</AvatarFallback>
          </Avatar>
          <p className="text-body text-muted-foreground">
            {t("tasks.create.agent_will_start", { name: agentName })}
          </p>
        </div>

        <div className="min-h-24">
          <ContentEditor
            defaultValue={prompt}
            ariaLabel={t("tasks.description")}
            placeholder={t("tasks.create.description_placeholder")}
            onDocumentChange={setPrompt}
            onSubmit={submit}
          />
        </div>

        {projectId ? (
          <div className="flex flex-wrap items-center gap-2">
            <PillButton
              type="button"
              aria-label={t("tasks.create.project")}
              onClick={() => setProjectId(undefined)}
            >
              <span className="truncate">{projectId}</span>
            </PillButton>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <PillButton type="button" aria-label={t("tasks.detail.attachments_section")}>
            <Paperclip className="size-3.5" aria-hidden />
          </PillButton>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSwitchMode({ project_id: projectId })}
          >
            {t("tasks.create.switch_to_manual")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-muted-foreground">
            <Switch
              checked={createAnother}
              onCheckedChange={setCreateAnother}
              aria-label={t("tasks.create.create_another_short")}
            />
            <span aria-hidden>{t("tasks.create.create_another_short")}</span>
          </label>
          <Button type="button" onClick={submit}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
