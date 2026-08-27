"use client";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
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
    // `<main>`: các bước 1–4 nhận landmark từ StepShell, còn màn đầu tiên của
    // cả luồng thì trước đây không có landmark nào — không có đích để "nhảy tới
    // nội dung", không có gì cho chế độ duyệt landmark của screen reader.
    // `lg:` on the min-height: it exists so the two-column hero has room for
    // the illustration, and that column only appears at `lg`. Unqualified it
    // also applied to a phone held landscape (~390px of viewport height) and to
    // a 1280x800 window at 200% zoom, turning a hero that fits into one the
    // user has to scroll for no reason.
    <main className="animate-onboarding-enter flex h-full min-h-[640px] flex-col lg:flex-row">
      <div className="flex flex-col lg:flex-1">
        <div className="flex flex-1 flex-col justify-center px-6 pb-12 pt-16 sm:px-10 md:px-20 lg:px-20 lg:pt-0 xl:px-24">
          <div className="flex w-full max-w-[540px] flex-col gap-8">
            <div className="flex items-center gap-2.5">
              <Logo variant="mark" size={22} decorative />
              <span className="font-serif text-title-lg font-medium tracking-tight text-foreground">
                {t("onboarding.welcome.wordmark")}
              </span>
            </div>

            <h1 className="text-balance font-serif text-hero font-medium leading-[1.04] tracking-tight text-foreground sm:text-hero-lg">
              {t("onboarding.welcome.headline_line1")}{" "}
              <br />
              {t("onboarding.welcome.headline_line2")}{" "}
              <em className="italic text-brand">{t("onboarding.welcome.headline_emphasis")}</em>
            </h1>

            <div className="flex flex-col gap-4">
              <p className="text-title leading-relaxed text-foreground">{t("onboarding.welcome.lede")}</p>
              <p className="text-body leading-relaxed text-muted-foreground">{t("onboarding.welcome.lede_secondary")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => run("next", onNext)} aria-disabled={pending !== null || undefined}>
                {pending === "next" && <Loader2 className="size-4 animate-spin" />}
                {t("onboarding.welcome.start")}
                <ArrowRight className="size-4" />
              </Button>
              {onSkip && (
                <Button size="lg" variant="ghost" onClick={() => run("skip", onSkip)} aria-disabled={pending !== null || undefined}>
                  {pending === "skip" && <Loader2 className="size-4 animate-spin" />}
                  {t("onboarding.welcome.skip_existing")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Cột phải: minh hoạ, ẩn dưới lg để headline + CTA giữ tiêu điểm. */}
      <div className="hidden border-l border-border bg-muted/40 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-8 py-8">
          <p className="max-w-[440px] text-balance text-center font-serif text-body-lg italic leading-snug text-muted-foreground">
            {t("onboarding.welcome.illustration_caption")}
          </p>
          <WelcomeIllustration />
        </div>
      </div>
    </main>
  );
}
