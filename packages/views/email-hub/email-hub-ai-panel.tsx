"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api/http";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import {
  useCreateEmailHubSummaryTasks,
  useEmailHubThreadSummary,
  useSummarizeEmailHubThread,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import {
  buildSummaryTaskItems,
  previewAssigneeId,
  type SummaryTaskFieldOverrides,
} from "@uniwork/core/meetings/summary-task-items";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../toast-api-error";
import { EmailHubAiActionItemsCard } from "./email-hub-ai-action-items-card";
import { EmailHubAiSummaryDetail } from "./email-hub-ai-insight";
import { EmailHubCreateSummaryTasksDialog } from "./email-hub-create-summary-tasks-dialog";

function emailThreadFocusId(accountId: string, threadId: string) {
  return `${accountId}|${threadId}`;
}

function summarySyncKey(threadId: string, data: EmailHubThreadSummary) {
  return `${threadId}:${data.summary}:${data.cached}:${data.summarized_at}:${data.action_items.length}`;
}

export function EmailHubAiPanel({
  wsId,
  accountId,
  threadId,
  bodyReady,
  initialSummary,
  onSummaryChange,
}: {
  wsId: string;
  accountId: string;
  threadId: string;
  bodyReady: boolean;
  initialSummary?: EmailHubThreadSummary;
  onSummaryChange?: (summary: EmailHubThreadSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: caps } = useAiCapabilities(wsId);
  const { data: members } = useMembers(wsId);
  const aiOn = caps?.enabled ?? false;
  const locale = i18n.language.startsWith("en") ? "en" : "vi";
  const summarize = useSummarizeEmailHubThread(wsId);
  const { data: cachedSummary, isFetching: cachedLoading } = useEmailHubThreadSummary(
    wsId,
    accountId,
    threadId,
    locale,
    aiOn && bodyReady,
  );
  const createTasks = useCreateEmailHubSummaryTasks(wsId);
  const [summary, setSummary] = useState<EmailHubThreadSummary | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<number, string | undefined>>({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const onSummaryChangeRef = useRef(onSummaryChange);
  const syncedSummaryKeyRef = useRef("");

  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange;
  }, [onSummaryChange]);

  const memberPreview = useMemo(
    () => (members ?? []).map((m) => ({ user_id: m.user_id, display_name: m.display_name })),
    [members],
  );

  const applySummary = useCallback(
    (data: EmailHubThreadSummary) => {
      setSummary(data);
      setPicked(new Set(data.action_items.map((_, i) => i)));
      const overrides: Record<number, string | undefined> = {};
      data.action_items.forEach((item, index) => {
        const guess = previewAssigneeId(item.owner, memberPreview);
        if (guess) overrides[index] = guess;
      });
      setAssigneeOverrides(overrides);
    },
    [memberPreview],
  );

  useEffect(() => {
    syncedSummaryKeyRef.current = "";
    setSummary(null);
    setPicked(new Set());
    setAssigneeOverrides({});
  }, [threadId]);

  useEffect(() => {
    const data = cachedSummary?.summary ? cachedSummary : initialSummary?.summary ? initialSummary : null;
    if (!data?.summary) return;
    const key = summarySyncKey(threadId, data);
    if (syncedSummaryKeyRef.current === key) return;
    syncedSummaryKeyRef.current = key;
    applySummary(data);
    if (cachedSummary?.summary) {
      onSummaryChangeRef.current?.(cachedSummary);
    }
  }, [
    threadId,
    cachedSummary,
    initialSummary,
    cachedSummary?.summary,
    cachedSummary?.cached,
    cachedSummary?.summarized_at,
    cachedSummary?.action_items.length,
    initialSummary?.summary,
    initialSummary?.cached,
    initialSummary?.summarized_at,
    initialSummary?.action_items.length,
    applySummary,
  ]);

  const actionItems = summary?.action_items ?? [];
  const pickedList = useMemo(() => [...picked].sort((a, b) => a - b), [picked]);

  const runSummarize = () => {
    summarize.mutate(
      { accountId, threadId, locale, force: !!summary },
      {
        onSuccess: (data) => {
          syncedSummaryKeyRef.current = summarySyncKey(threadId, data);
          applySummary(data);
          onSummaryChangeRef.current?.(data);
        },
        onError: (err) => {
          const code = errorCode(err);
          if (code === "nothing_to_summarize") {
            toast.error(t("email_hub.ai.nothing_to_summarize"));
            return;
          }
          toastApiError(err, t("email_hub.load_error"));
        },
      },
    );
  };

  const submitCreate = (input: {
    projectId?: string;
    assignees: Record<number, string | undefined>;
    fields: SummaryTaskFieldOverrides;
  }) => {
    const items = buildSummaryTaskItems(
      actionItems.map((item) => ({ title: item.title, owner: item.owner, due: item.due })),
      picked,
      input.assignees,
      input.projectId,
      input.fields,
    );
    if (items.length === 0) return;
    createTasks.mutate(
      {
        accountId,
        threadId,
        items: items.map((item) => ({
          title: item.title,
          owner: item.owner,
          due_spoken: item.due_spoken,
          assignee_id: item.assignee_id,
          project_id: item.project_id,
          priority: item.priority,
          due_date: item.due_date,
        })),
      },
      {
        onSuccess: (ids) => {
          toast.success(t("email_hub.ai.tasks_created", { count: ids.length }));
          setCreateDialogOpen(false);
          setPicked(new Set());
          setAssigneeOverrides({});
        },
        onError: (err) => toastApiError(err, t("email_hub.load_error")),
      },
    );
  };

  const openAskUni = () => {
    useAiPanelStore.getState().openWithFocus({
      kind: "email_thread",
      id: emailThreadFocusId(accountId, threadId),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={summary ? "outline" : "brandSubtle"}
          disabled={!aiOn || !bodyReady || summarize.isPending}
          aria-busy={summarize.isPending || undefined}
          onClick={runSummarize}
        >
          {summarize.isPending ? <Spinner className="size-3.5" /> : <Sparkles aria-hidden />}
          {summarize.isPending
            ? t("email_hub.ai.analyzing_short")
            : summary
              ? t("email_hub.ai.regenerate")
              : t("email_hub.ai.summarize")}
        </Button>
        <Button type="button" variant="outline" disabled={!aiOn} onClick={openAskUni}>
          <MessageSquare aria-hidden />
          {t("email_hub.ai.ask_uni")}
        </Button>
      </div>

      {!aiOn ? (
        <p className="text-caption text-pretty text-muted-foreground">{t("email_hub.ai.disabled")}</p>
      ) : !bodyReady ? (
        <p className="text-caption text-muted-foreground">{t("email_hub.ai.wait_body")}</p>
      ) : cachedLoading && !summary ? (
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("email_hub.ai.loading_cached")}
        </div>
      ) : null}

      {summary ? (
        <div className="space-y-3">
          <EmailHubAiSummaryDetail summary={summary} />
          {summary.cached ? (
            <p className="text-caption text-pretty text-muted-foreground">{t("email_hub.ai.cached_hint")}</p>
          ) : null}
          <EmailHubAiActionItemsCard
            locale={locale}
            actionItems={actionItems}
            picked={picked}
            onPickedChange={setPicked}
            onOpenCreateDialog={() => setCreateDialogOpen(true)}
            createDisabled={picked.size === 0}
          />
          <EmailHubCreateSummaryTasksDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            wsId={wsId}
            pickedIndices={pickedList}
            actionItems={actionItems}
            initialAssignees={assigneeOverrides}
            onConfirm={submitCreate}
            pending={createTasks.isPending}
          />
        </div>
      ) : null}
    </div>
  );
}
