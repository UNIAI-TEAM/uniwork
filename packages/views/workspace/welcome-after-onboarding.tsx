"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dismissWelcome, useSeedWelcomeTask, useWelcomeSignal } from "@uniwork/core/onboarding";
import type { Workspace } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog,
  DialogContent,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";

/** Một lần sau onboarding: seed task hướng dẫn (server idempotent) rồi dialog 🎉. */
export function WelcomeAfterOnboarding({ workspace, onOpenTask }: { workspace: Workspace; onOpenTask: (taskId: string) => void }) {
  const { signal, dismissed } = useWelcomeSignal();
  if (!signal || dismissed || signal.workspaceId !== workspace.id) return null;
  return <Seeder workspaceId={workspace.id} onOpenTask={onOpenTask} />;
}

function Seeder({ workspaceId, onOpenTask }: { workspaceId: string; onOpenTask: (id: string) => void }) {
  const { t } = useTranslation();
  const seed = useSeedWelcomeTask();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fired = useRef(false); // StrictMode double-mount: server idempotent, nhưng tránh 2 request

  useEffect(() => {
    if (fired.current || taskId || failed) return;
    fired.current = true;
    seed.mutate(workspaceId, {
      onSuccess: (d) => setTaskId(d.task.id),
      onError: () => {
        setFailed(true);
        fired.current = false;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, taskId, failed]);

  if (failed) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) dismissWelcome(); }}>
        <DialogContent>
          <DialogTitle>{t("onboarding.welcome_after_onboarding.error_title")}</DialogTitle>
          <p className="text-body text-text-secondary">{t("onboarding.welcome_after_onboarding.error_body")}</p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={dismissWelcome}>{t("onboarding.welcome_after_onboarding.dismiss")}</Button>
            <Button onClick={() => setFailed(false)}>{t("onboarding.welcome_after_onboarding.retry")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (!taskId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-text-secondary" />
          <p className="text-body text-text-secondary">{t("onboarding.welcome_after_onboarding.loading")}</p>
        </div>
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) dismissWelcome(); }}>
      <DialogContent className="w-[560px]">
        {/* The heading below is the visible one; the dialog still needs an
            accessible name, so this repeats it for screen readers only. */}
        <DialogTitle className="sr-only">{t("onboarding.welcome_after_onboarding.title")}</DialogTitle>
        <div className="flex flex-col items-center gap-4 pt-2">
          <div className="animate-welcome-emoji-pop text-6xl" aria-hidden>
            🎉
          </div>
          <h2 className="text-center text-display-sm font-semibold text-primary">{t("onboarding.welcome_after_onboarding.title")}</h2>
          <p className="max-w-md text-center text-body text-text-secondary">{t("onboarding.welcome_after_onboarding.subtitle")}</p>
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body font-medium text-primary">{t("onboarding.welcome_after_onboarding.card_title")}</p>
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-micro font-medium text-brand">
                {t("onboarding.welcome_after_onboarding.status_in_progress")}
              </span>
            </div>
            <p className="mt-1 text-caption text-text-secondary">{t("onboarding.welcome_after_onboarding.card_subtitle")}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={() => { dismissWelcome(); onOpenTask(taskId); }}>
            {t("onboarding.welcome_after_onboarding.got_it")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
