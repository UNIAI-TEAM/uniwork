"use client";
import { CalendarDays, CircleCheck, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

type Status = "in_progress" | "done" | "upcoming";

/**
 * Một buổi sáng của đội trên UniWork: 5 card xếp nghiêng như chồng giấy —
 * task, bình luận, cuộc họp — minh hoạ cho tuyên ngôn "một không gian".
 */
export function WelcomeIllustration() {
  const { t } = useTranslation();
  const i = (k: string) => t(`onboarding.welcome.illustration.${k}`);
  return (
    // Toàn khối là minh hoạ: 5 thẻ việc dựng sẵn, không phải dữ liệu của user.
    // Để screen reader đọc chúng như nội dung thật là nói dối; câu chú thích ngay
    // phía trên đã mang trọn ý nghĩa của hình.
    <div aria-hidden className="flex w-full max-w-[460px] flex-col gap-3">
      <MockCard
        actor={{ name: i("card1_actor"), initial: i("card1_initial") }}
        refLabel={i("card1_ref")}
        content={
          <>
            <Mention>{i("card1_mention")}</Mention>
            {i("card1_body")}
          </>
        }
      />
      <MockCard
        className="-translate-x-5 -rotate-[1.2deg]"
        actor={{ name: i("card2_actor"), initial: i("card2_initial") }}
        refLabel={i("card2_ref")}
        content={i("card2_body")}
        status="in_progress"
        statusLabel={i("card2_status")}
      />
      <MockCard
        className="translate-x-8 rotate-[1.6deg]"
        actor={{ name: i("card3_actor"), icon: "meeting" }}
        refLabel={i("card3_ref")}
        content={i("card3_body")}
        status="upcoming"
        statusLabel={i("card3_status")}
      />
      <MockCard
        className="-translate-x-6 -rotate-[0.8deg]"
        actor={{ name: i("card4_actor"), initial: i("card4_initial") }}
        refLabel={i("card4_ref")}
        content={i("card4_body")}
        status="done"
        statusLabel={i("card4_status")}
        timestamp={i("card4_timestamp")}
      />
      <MockCard
        className="translate-x-6 rotate-[1deg]"
        actor={{ name: i("card5_actor"), initial: i("card5_initial") }}
        refLabel={i("card5_ref")}
        content={
          <>
            {i("card5_prefix")}
            <Mention>{i("card5_mention")}</Mention>
            {i("card5_body")}
          </>
        }
      />
    </div>
  );
}

function MockCard({
  actor,
  refLabel,
  content,
  status,
  statusLabel,
  timestamp,
  className,
}: {
  actor: { name: string; initial?: string; icon?: "meeting" };
  refLabel: string;
  content: ReactNode;
  status?: Status;
  statusLabel?: string;
  timestamp?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface px-4 py-3.5 shadow-sm", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {actor.icon === "meeting" ? (
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full border border-line bg-subtle/40 text-primary">
              <CalendarDays className="size-3.5" />
            </span>
          ) : (
            <span aria-hidden className="flex size-6 items-center justify-center rounded-full bg-primary text-micro font-semibold text-inverse">
              {actor.initial}
            </span>
          )}
          <span className="truncate text-body font-medium text-primary">{actor.name}</span>
        </div>
        <span className="shrink-0 font-mono text-micro text-secondary">{refLabel}</span>
      </div>
      <p className="mt-2.5 text-body leading-snug text-primary">{content}</p>
      {status && (
        <div className="mt-3 flex items-center gap-2 text-caption">
          <span
            className={cn(
              "flex items-center gap-1.5 font-medium",
              status === "done" ? "text-success-text" : status === "in_progress" ? "text-warning-text" : "text-brand",
            )}
          >
            {status === "done" ? (
              <CircleCheck className="size-3.5" />
            ) : status === "in_progress" ? (
              <CircleDot className="size-3.5 animate-pulse" />
            ) : (
              <CalendarDays className="size-3.5" />
            )}
            {statusLabel}
          </span>
          {timestamp && (
            <>
              <span className="text-secondary">·</span>
              <span className="text-secondary">{timestamp}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Mention({ children }: { children: ReactNode }) {
  return <span className="font-medium text-brand">{children}</span>;
}
