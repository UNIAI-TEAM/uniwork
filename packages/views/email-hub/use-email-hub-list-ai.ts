"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import { useSummarizeEmailHubThread } from "@uniwork/core/email-hub/hooks";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { toastApiError } from "../toast-api-error";
import { emailHubLocale } from "./email-hub-format";

/**
 * The AI summaries the hub keeps per thread: the one-click analyse from a list
 * row and the summary the open thread's rail reports back, so the list can show
 * it without a second request.
 */
export function useEmailHubListAi(wsId: string, accountId: string | null, selectedId: string | null) {
  const { t, i18n } = useTranslation();
  const locale = emailHubLocale(i18n.language);
  const summarizeThread = useSummarizeEmailHubThread(wsId);
  const { data: aiCaps } = useAiCapabilities(wsId);
  const aiEnabled = !!aiCaps?.enabled;
  const [threadAiSummaries, setThreadAiSummaries] = useState<Record<string, EmailHubThreadSummary>>({});
  const [analyzingThreadId, setAnalyzingThreadId] = useState<string | null>(null);

  const analyzeFromList = useCallback(
    (threadId: string) => {
      if (!accountId || !aiEnabled) return;
      setAnalyzingThreadId(threadId);
      summarizeThread.mutate(
        { accountId, threadId, locale: locale === "en-US" ? "en" : "vi" },
        {
          onSuccess: (data) => {
            if (data.summary) setThreadAiSummaries((prev) => ({ ...prev, [threadId]: data }));
          },
          onError: (err) => {
            if (errorCode(err) === "nothing_to_summarize") toast.error(t("email_hub.ai.nothing_to_summarize"));
            else toastApiError(err, t("email_hub.ai.summarize_error"));
          },
          onSettled: () => setAnalyzingThreadId(null),
        },
      );
    },
    [accountId, aiEnabled, locale, summarizeThread, t],
  );

  const handleThreadAiSummary = useCallback(
    (data: EmailHubThreadSummary) => {
      if (!selectedId) return;
      setThreadAiSummaries((prev) => {
        const cur = prev[selectedId];
        if (cur?.summary === data.summary && cur?.cached === data.cached && cur?.summarized_at === data.summarized_at) {
          return prev;
        }
        return { ...prev, [selectedId]: data };
      });
    },
    [selectedId],
  );

  return { aiEnabled, threadAiSummaries, analyzingThreadId, analyzeFromList, handleThreadAiSummary };
}
