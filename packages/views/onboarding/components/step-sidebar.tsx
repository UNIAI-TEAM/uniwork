"use client";
import { ArrowLeft, Check } from "lucide-react";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ONBOARDING_STEP_ORDER, type OnboardingStep } from "@uniwork/core/onboarding";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
} from "@uniwork/ui/components/ui/stepper";
import { cn } from "@uniwork/ui/lib/utils";
import { BrandRail, BrandRailAside, RAIL_WIDTH_ONBOARDING } from "../../layout/brand-rail";

export { RAIL_VAR_FALLBACK } from "../../layout/brand-rail";

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
            className={cn("h-1 flex-1 rounded-full transition-colors", index <= currentIndex ? "bg-primary" : "bg-border")}
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-caption font-medium text-muted-foreground">
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
  return (
    <BrandRailAside width={RAIL_WIDTH_ONBOARDING}>
      <BrandRail
        header={
          <>
            <span className="flex min-w-0 items-center gap-2">
              <Logo variant="mark" tone="mono" size={20} decorative />
              <span className="truncate text-label font-medium text-foreground">{t("onboarding.step_nav.wordmark")}</span>
            </span>
            {onBack ? (
              <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} disabled={backDisabled} aria-label={t("common.back")}>
                <ArrowLeft />
              </Button>
            ) : null}
          </>
        }
        footer={footer}
      >
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
                            ? "bg-primary text-primary-foreground ring-primary"
                            : isCurrent
                              ? "text-transparent ring-muted-foreground"
                              : "text-transparent ring-input",
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
                        <StepperTitle className={cn("transition-colors", isCurrent || isDone ? "text-foreground" : "text-muted-foreground")}>
                          {t(`onboarding.step_nav.${stepId}.label`)}
                        </StepperTitle>
                        <StepperDescription className="mt-0.5 max-w-none text-muted-foreground">
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
                            isDone ? "bg-muted-foreground" : "bg-border",
                          )}
                        />
                      ) : null}
                    </StepperItem>
                  );
                })}
              </StepperNav>
            </Stepper>
          </div>
      </BrandRail>
    </BrandRailAside>
  );
}
