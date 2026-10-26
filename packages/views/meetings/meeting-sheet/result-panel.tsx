"use client";
import { useEffect, useRef } from "react";
import { Check, CircleAlert, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../../api-error-copy";
import { inviteLinkUrl } from "../invite-link-url";
import { kitButton } from "../meeting-detail/ui/kit-buttons";
import { runRows, type RowState, type SubmitRun } from "./run-submit-plan";
import { roleLabelKey } from "./person-role-row";

type T = ReturnType<typeof useTranslation>["t"];

/** Why a step failed, in the row's caption: the server's words, or the network sentence. */
export function failureReason(err: unknown, t: T): string {
  if (err instanceof TypeError) return t("meetings.sheet.networkReason");
  return apiErrorCopy(err) ?? t("common.error");
}

function sentence(row: RowState, ctx: { nameOf: (id: string) => string; workspaceName: string; edit: boolean }, t: T): string {
  const failed = row.status === "failed";
  const steps = row.steps;
  const names = (kind: string, onlyFailed: boolean) =>
    steps
      .filter((s) => s.step.kind === kind && (!onlyFailed || s.state.status === "failed"))
      .map((s) => ("userId" in s.step ? ctx.nameOf(s.step.userId) : ""))
      .join(", ");
  const first = steps[0]!.step;
  switch (first.row) {
    case "people": {
      if (failed) return t("meetings.inviteFailedNames", { names: names("invite", true) || names("remove", true) });
      const invited = names("invite", false);
      if (ctx.edit) return invited ? t("meetings.sheet.resultInvited", { names: invited }) : t("meetings.sheet.resultRemoved", { names: names("remove", false) });
      return t("meetings.sheet.resultPeople", { names: invited });
    }
    case "scribe": {
      const on = first.kind === "scribe" && first.enabled;
      return failed
        ? t("meetings.sheet.resultScribeFailed", { state: t(on ? "meetings.sheet.off" : "meetings.sheet.on") })
        : t("meetings.sheet.resultScribe", { state: t(on ? "meetings.sheet.on" : "meetings.sheet.off") });
    }
    case "sharing": {
      const shared = first.kind === "sharing" && first.shared;
      if (failed) return t("meetings.sheet.resultSharingFailed");
      return shared ? t("meetings.sheet.resultSharedWorkspace", { name: ctx.workspaceName }) : t("meetings.sheet.resultSharedMeeting");
    }
    case "roles": {
      const sec = steps.find((s) => s.step.kind === "role" && s.step.role === "SECRETARY");
      const target = failed ? (steps.find((s) => s.state.status === "failed") ?? steps[0]!) : (sec ?? steps[0]!);
      const step = target.step.kind === "role" ? target.step : null;
      const name = step ? ctx.nameOf(step.userId) : "";
      if (failed) {
        const base =
          step?.role === "SECRETARY"
            ? t("meetings.sheet.resultSecretaryFailed", { name })
            : t("meetings.sheet.resultRoleFailed", { name, role: t(roleLabelKey(step?.role ?? "MEMBER")) });
        return target.state.waiting ? `${base} ${t("meetings.sheet.waitingInvite")}` : base;
      }
      return step?.role === "SECRETARY"
        ? t("meetings.governance.secretaryAssigned", { name })
        : t("meetings.sheet.resultRole", { name, role: t(roleLabelKey(step?.role ?? "MEMBER")) });
    }
    case "quorum": {
      const value = first.kind === "quorum" ? first.value : 0;
      if (value === 0) return failed ? t("meetings.sheet.resultQuorumClearFailed") : t("meetings.sheet.resultQuorumCleared");
      return t(failed ? "meetings.sheet.resultQuorumFailed" : "meetings.sheet.resultQuorum", { percent: value });
    }
    case "motions": {
      const creates = steps.filter((s) => s.step.kind === "motionCreate");
      if (failed) {
        const bad = creates.find((s) => s.state.status === "failed");
        return bad && bad.step.kind === "motionCreate"
          ? t("meetings.sheet.resultMotionFailed", { title: bad.step.motion.title })
          : t("meetings.sheet.resultMotionsFailed");
      }
      return creates.length ? t("meetings.sheet.resultMotions", { count: creates.length }) : t("meetings.sheet.resultMotionsSaved");
    }
    default:
      return first.kind === "link"
        ? t(failed ? "meetings.sheet.resultLinkFailed" : "meetings.sheet.resultLink", { name: first.name })
        : "";
  }
}

function LinkSecret({ id, secret }: { id: string; secret: string }) {
  const { t } = useTranslation();
  const url = inviteLinkUrl(id, secret);
  return (
    <div className="mt-2">
      <div className="flex gap-2 max-sm:flex-col">
        <input
          readOnly
          value={url}
          aria-label={t("meetings.sheet.linkUrlAria")}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-caption text-foreground outline-none focus-visible:outline-2 focus-visible:outline-ring"
        />
        <Button
          variant="outline"
          size="lg"
          className={cn(kitButton.base, kitButton.outline)}
          onClick={() => void copyText(url).then((ok) => ok && toast.success(t("meetings.linkCopied"), { position: "bottom-center" }))}
        >
          {t("meetings.sheet.copyLink")}
        </Button>
      </div>
      <p className="mt-1.5 text-caption text-muted-foreground">{t("meetings.linkSecretOnce")}</p>
    </div>
  );
}

/**
 * Honest partial success (create brief §2.11): one row per thing the person
 * set — ✓ and what now exists, or ! with the reason and [Thử lại] — and a
 * created guest link's one-time URL. Focus lands on the heading.
 */
export function ResultPanelBody({
  run,
  nameOf,
  workspaceName,
  onRetry,
}: {
  run: SubmitRun;
  nameOf: (userId: string) => string;
  workspaceName: string;
  onRetry: (keys: RowState["key"][]) => void;
}) {
  const { t } = useTranslation();
  const rows = runRows(run);
  const ctx = { nameOf, workspaceName, edit: run.plan.mode === "edit" };
  return (
    <ul>
      {rows.map((row) => {
        const failedStep = row.steps.find((s) => s.state.status === "failed");
        const link = row.steps[0]?.state.link;
        return (
          <li key={row.key} className="grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 py-3">
            {row.status === "running" ? (
              <Spinner className="mt-0.5 size-4 text-muted-foreground" />
            ) : row.status === "failed" ? (
              <CircleAlert aria-hidden className="mt-0.5 size-4 text-destructive" />
            ) : (
              <Check aria-hidden className="mt-0.5 size-4 text-success" />
            )}
            <div className="min-w-0" aria-busy={row.status === "running" || undefined}>
              <p className="text-body">{row.status === "running" ? t("meetings.sheet.retrying") : sentence(row, ctx, t)}</p>
              {row.status === "failed" && failedStep && !failedStep.state.waiting ? (
                <p className="text-caption text-muted-foreground">{failureReason(failedStep.state.error, t)}</p>
              ) : null}
              {link ? <LinkSecret id={link.id} secret={link.secret} /> : null}
            </div>
            {row.status === "failed" ? (
              <Button variant="outline" size="default" className={cn(kitButton.sm, kitButton.outline, "self-center")} onClick={() => onRetry([row.key])}>
                {t("common.retry")}
              </Button>
            ) : (
              <span />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ResultPanelHead({ run, caption }: { run: SubmitRun; caption: { title: string; day: string; range: string } }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const failures = runRows(run).some((r) => r.status === "failed");
  const title =
    run.plan.mode === "edit" ? t(failures ? "meetings.sheet.resultSavedPartly" : "meetings.changesSaved") : t("meetings.created");
  return (
    <div className="min-w-0">
      <h2 ref={ref} tabIndex={-1} className="flex items-center gap-2 text-title-sm font-semibold outline-none">
        <CircleCheck aria-hidden className="size-4 text-success" />
        {title}
      </h2>
      <p className="mt-1 truncate text-caption text-muted-foreground">
        {caption.title} ·{" "}
        <span className="whitespace-nowrap">
          {caption.day ? `${caption.day} · ` : null}
          <time className="tabular-nums">{caption.range}</time>
        </span>
      </p>
    </div>
  );
}
