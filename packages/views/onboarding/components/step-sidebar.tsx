"use client";
import { ArrowLeft, Check } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ONBOARDING_STEP_ORDER, type OnboardingStep } from "@uniwork/core/onboarding";
import { Button } from "@uniwork/ui/components/ui/button";
import { DotSphere } from "@uniwork/ui/components/ui/dot-sphere";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@uniwork/ui/components/ui/stepper";
import { useCssVars } from "@uniwork/ui/hooks/use-css-var";
import { useMediaQuery } from "@uniwork/ui/hooks/use-media-query";
import { cn, withAlpha } from "@uniwork/ui/lib/utils";

/**
 * Canvas 2D không nhận `var()`, nên màu của dot-sphere phải là chuỗi thật.
 * `useCssVars` đọc chúng từ chính panel rail (scope `.dark`) thay vì chép cứng —
 * đổi token là rail đổi theo. Fallback chỉ dùng cho frame SSR đầu tiên.
 */
export const RAIL_VAR_FALLBACK = { "--uw-rail-bg": "#1b1b1f", "--uw-brand": "#6584ff" };

/**
 * Thanh tiến độ gọn cho < md (rail ẩn): Back + các đoạn + tên bước + slot footer.
 */
export function StepProgressBar({
  currentStep,
  onBack,
  backDisabled,
  footer,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const currentIndex = Math.max(0, ONBOARDING_STEP_ORDER.indexOf(currentStep as never));
  const key = ONBOARDING_STEP_ORDER[currentIndex]!;
  return (
    <div className="mb-6 flex items-center gap-3 md:hidden">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={backDisabled}
          aria-label={t("common.back")}
          className="-ml-2 shrink-0"
        >
          <ArrowLeft />
        </Button>
      ) : null}
      {/* min-w giữ các đoạn khỏi bị bóp về sợi chỉ khi nhãn bước dài ở 375px. */}
      <span aria-hidden className="flex min-w-[5rem] flex-1 items-center gap-1.5">
        {ONBOARDING_STEP_ORDER.map((stepId, index) => (
          <span
            key={stepId}
            className={cn("h-1 flex-1 rounded-full transition-colors", index <= currentIndex ? "bg-primary" : "bg-line")}
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-caption font-medium text-secondary">
        {/* Các đoạn tiến độ là aria-hidden, nên vị trí phải được nói bằng chữ:
            dưới md rail bị ẩn và đây là chỉ báo tiến độ duy nhất. */}
        <span className="sr-only">
          {t("onboarding.step_nav.position", {
            current: currentIndex + 1,
            total: ONBOARDING_STEP_ORDER.length,
          })}{" "}
        </span>
        {t(`onboarding.step_nav.${key}.label`)}
      </span>
      {footer ? <span className="shrink-0">{footer}</span> : null}
    </div>
  );
}

/**
 * Rail bên trái: panel tối scope `.dark` (token đổi màu chỉ trong subtree),
 * dot-sphere làm nền, stepper dọc. KHÔNG phải tablist — bước là route, không
 * có panel id; vị trí đánh dấu bằng aria-current="step". Chỉ bước đã xong mới
 * click được: đi tới phải qua validation của bước hiện tại.
 */
export function StepSidebar({
  currentStep,
  onBack,
  backDisabled,
  onStepChange,
  footer,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  onStepChange?: (step: OnboardingStep) => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const currentIndex = Math.max(0, ONBOARDING_STEP_ORDER.indexOf(currentStep as never));
  const panelRef = useRef<HTMLDivElement>(null);
  const railVars = useCssVars(panelRef, RAIL_VAR_FALLBACK);
  // Hai cơ chế ẩn khác nhau, cho hai vấn đề khác nhau — trước đây gộp làm một và
  // hỏng cả hai:
  //
  // BỐ CỤC ẩn bằng CSS. `useMediaQuery` trả `false` ở render đầu (và khi SSR) rồi
  // mới chỉnh trong effect, tức là SAU khi trình duyệt đã vẽ. Gác cả <aside> vào
  // nó nghĩa là mọi lần mở onboarding trên desktop đều vẽ một khung không rail
  // trước, rồi 22rem nhảy vào — cột nội dung `mx-auto` trượt ngang ~11rem sau
  // khi hydrate xong. CSS thì áp ngay từ pixel đầu tiên, không có bước nhảy nào.
  //
  // CANVAS ẩn bằng JS. `display:none` vẫn mount subtree và vẫn chạy mọi effect:
  // vòng lặp rAF của dot-sphere sẽ quay 60fps trên điện thoại để vẽ một canvas
  // 0×0. Cái đó phải chặn ở tầng React, và chỉ cái đó.
  const showSphere = useMediaQuery("(min-width: 768px)");

  return (
    <aside className="hidden shrink-0 md:block md:w-[19rem] md:p-3 lg:w-[22rem] lg:p-4">
      <div
        ref={panelRef}
        className="dark relative isolate flex h-full w-full flex-col overflow-hidden rounded-2xl px-5 pb-5 text-primary ring-1 ring-line"
        style={{ background: "var(--uw-rail-bg)" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {showSphere && (
          <DotSphere
            dotGap={19}
            motion="wave"
            sphereCount={5}
            sphereRadius="20%"
            dotRadiusMax={1.9}
            speed={0.4}
            bgColor={railVars["--uw-rail-bg"]}
            dotColor={withAlpha(railVars["--uw-brand"], 0.5)}
          />
          )}
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col pt-5">
          <header className="flex min-h-9 shrink-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-5 shrink-0 rounded-md bg-brand" />
              <span className="truncate text-label font-medium text-primary">{t("onboarding.step_nav.wordmark")}</span>
            </span>
            {onBack ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} disabled={backDisabled} aria-label={t("common.back")}>
                <ArrowLeft />
              </Button>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center py-10">
            <Stepper
              value={currentIndex + 1}
              orientation="vertical"
              role="group"
              aria-label={t("onboarding.step_nav.label")}
              className="flex w-full flex-col items-start justify-center gap-0"
            >
              <StepperNav className="w-full">
                {ONBOARDING_STEP_ORDER.map((stepId, index) => {
                  const isDone = index < currentIndex;
                  const isCurrent = index === currentIndex;
                  const isLast = index === ONBOARDING_STEP_ORDER.length - 1;
                  const canReturn = isDone && !!onStepChange && !backDisabled;

                  const body = (
                    <>
                      <StepperIndicator
                        className={cn(
                          "mt-0.5 size-4 shrink-0 border-0 bg-transparent ring-1 transition-colors",
                          isDone
                            ? "bg-primary text-inverse ring-primary"
                            : isCurrent
                              ? "text-transparent ring-secondary"
                              : "text-transparent ring-line-loud",
                        )}
                      >
                        {isDone ? (
                          <Check aria-hidden className="size-3" />
                        ) : isCurrent ? (
                          <span aria-hidden className="block size-1.5 rounded-full bg-primary" />
                        ) : (
                          <span className="sr-only">{index + 1}</span>
                        )}
                      </StepperIndicator>
                      <div className="min-w-0 flex-1 text-left">
                        <StepperTitle className={cn("transition-colors", isCurrent || isDone ? "text-primary" : "text-secondary")}>
                          {t(`onboarding.step_nav.${stepId}.label`)}
                        </StepperTitle>
                        <StepperDescription className="mt-0.5 max-w-none text-secondary">
                          {t(`onboarding.step_nav.${stepId}.description`)}
                        </StepperDescription>
                      </div>
                    </>
                  );

                  return (
                    <StepperItem
                      key={stepId}
                      step={index + 1}
                      completed={isDone}
                      className="relative w-full items-start not-last:flex-1"
                      {...(isCurrent ? { "aria-current": "step" as const } : {})}
                    >
                      {canReturn ? (
                        <button
                          type="button"
                          onClick={() => onStepChange(stepId)}
                          className="flex w-full items-start gap-3 rounded-md pb-6 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          {body}
                        </button>
                      ) : (
                        <div className={cn("flex w-full items-start gap-3 text-left", !isLast && "pb-6")}>{body}</div>
                      )}
                      {/* Một hairline liên tục sau hàng thay vì đoạn ngắn giữa các hàng. */}
                      {!isLast ? (
                        <StepperSeparator
                          className={cn(
                            "absolute left-2 top-6 -order-1 m-0 w-px -translate-x-1/2",
                            "group-data-[orientation=vertical]/stepper-nav:h-[calc(100%-1.75rem)]",
                            isDone ? "bg-secondary" : "bg-line",
                          )}
                        />
                      ) : null}
                    </StepperItem>
                  );
                })}
              </StepperNav>
            </Stepper>
          </div>

          {footer ? <footer className="flex min-h-8 shrink-0 items-end justify-between gap-4">{footer}</footer> : null}
        </div>
      </div>
    </aside>
  );
}
