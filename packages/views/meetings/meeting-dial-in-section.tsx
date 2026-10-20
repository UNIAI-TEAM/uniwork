"use client";
import { Phone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingDialIn, useRotateMeetingDialInPin } from "@uniwork/core/meetings/dial-in";
import { Button } from "@uniwork/ui/components/ui/button";
import { ConfirmDialog } from "../common/form-dialog";
import { PanelCard } from "../common/panel-card";
import { moduleTone } from "../layout/module-tones";
import { toastApiError } from "../toast-api-error";

/**
 * How to call into the meeting by phone (spec 2026-10-20-meeting-scribe-agent-design
 * §5.4): the deployment's number and the meeting's PIN. Hidden unless the
 * server offers dial-in for this meeting; the host may draw a new PIN.
 */
export function MeetingDialInSection({ meetingId, canHost }: { meetingId: string; canHost: boolean }) {
  const { t } = useTranslation();
  const { data } = useMeetingDialIn(meetingId);
  const rotate = useRotateMeetingDialInPin(meetingId);
  const [confirming, setConfirming] = useState(false);
  if (!data?.enabled || !data.number || !data.pin) return null;

  return (
    <>
      <PanelCard
        id="dial-in-heading"
        icon={Phone}
        iconTone={moduleTone("meetings")}
        title={t("meetings.dialIn.title")}
        description={t("meetings.dialIn.description")}
        footer={
          canHost ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
              {t("meetings.dialIn.rotate")}
            </Button>
          ) : undefined
        }
      >
        <dl className="-my-2 divide-y divide-border">
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="shrink-0 text-label text-muted-foreground">{t("meetings.dialIn.number")}</dt>
            <dd className="min-w-0 text-right text-body tabular-nums text-foreground">{data.number}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="shrink-0 text-label text-muted-foreground">{t("meetings.dialIn.pin")}</dt>
            <dd className="min-w-0 text-right text-body font-medium tabular-nums tracking-widest text-foreground">
              {data.pin}
            </dd>
          </div>
        </dl>
      </PanelCard>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("meetings.dialIn.rotateTitle")}
        description={t("meetings.dialIn.rotateHint")}
        confirmLabel={t("meetings.dialIn.rotate")}
        pending={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              toast.success(t("meetings.dialIn.rotated"));
            },
            onError: (err) => toastApiError(err, t("common.error")),
          })
        }
      />
    </>
  );
}
