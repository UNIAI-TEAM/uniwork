"use client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { WelcomeIllustration } from "./welcome-illustration";

/**
 * Bước 0 — intro sản phẩm, hiện mỗi lần vào onboarding (bước không persist).
 * Hero 2 cột từ lg: trái = lockup + headline serif + lede + CTA; phải = minh hoạ.
 * `onSkip` chỉ được truyền khi user đã có ≥1 workspace.
 */
export function StepWelcome({
  onNext,
  onSkip,
}: {
  onNext: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // Nút nào đang chạy → spinner riêng, khoá cả hai.
  const [pending, setPending] = useState<"next" | "skip" | null>(null);

  const run = async (which: "next" | "skip", fn?: () => void | Promise<void>) => {
    if (pending || !fn) return;
    setPending(which);
    try {
      await fn();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="animate-onboarding-enter flex h-full min-h-[640px] flex-col lg:flex-row">
      <div className="flex flex-col lg:flex-1">
        <div className="flex flex-1 flex-col justify-center px-6 pb-12 pt-16 sm:px-10 md:px-20 lg:px-20 lg:pt-0 xl:px-24">
          <div className="flex w-full max-w-[540px] flex-col gap-8">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="size-5 rounded-md bg-brand" />
              <span className="font-serif text-title-lg font-medium tracking-tight text-primary">
                {t("onboarding.welcome.wordmark")}
              </span>
            </div>

            <h1 className="text-balance font-serif text-5xl font-medium leading-[1.04] tracking-tight text-primary sm:text-6xl">
              {t("onboarding.welcome.headline_line1")}
              <br />
              {t("onboarding.welcome.headline_line2")}{" "}
              <em className="italic text-brand">{t("onboarding.welcome.headline_emphasis")}</em>
            </h1>

            <div className="flex flex-col gap-4">
              <p className="text-title leading-relaxed text-primary">{t("onboarding.welcome.lede")}</p>
              <p className="text-body leading-relaxed text-secondary">{t("onboarding.welcome.lede_secondary")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => run("next", onNext)} disabled={pending !== null}>
                {pending === "next" && <Loader2 className="size-4 animate-spin" />}
                {t("onboarding.welcome.start")}
                <ArrowRight className="size-4" />
              </Button>
              {onSkip && (
                <Button size="lg" variant="ghost" onClick={() => run("skip", onSkip)} disabled={pending !== null}>
                  {pending === "skip" && <Loader2 className="size-4 animate-spin" />}
                  {t("onboarding.welcome.skip_existing")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cột phải: minh hoạ, ẩn dưới lg để headline + CTA giữ tiêu điểm. */}
      <div className="hidden border-l border-line bg-subtle/40 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-8 py-8">
          <p className="max-w-[440px] text-balance text-center font-serif text-body-lg italic leading-snug text-secondary">
            {t("onboarding.welcome.illustration_caption")}
          </p>
          <WelcomeIllustration />
        </div>
      </div>
    </div>
  );
}
