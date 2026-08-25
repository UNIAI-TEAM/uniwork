"use client";
import { useRef, type ReactNode } from "react";
import type { OnboardingStep } from "@uniwork/core/onboarding";
import { useScrollFade } from "@uniwork/ui/hooks/use-scroll-fade";
import { cn } from "@uniwork/ui/lib/utils";
import { StepProgressBar, StepSidebar } from "./step-sidebar";

/** Một thước đo duy nhất cho mọi bước (28rem). */
export const STEP_COLUMN = "mx-auto flex min-h-full w-full max-w-[28rem] flex-col";
export const STEP_GUTTER = "px-6 py-8 sm:px-10 lg:px-14 lg:py-10";

/** aria-live vì các pane tồn tại xuyên bước — screen reader không có sự kiện điều hướng. */
export function StepHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <h1 className="text-balance text-title-lg font-semibold text-primary">{title}</h1>
      {description ? <p className="text-pretty text-body text-secondary">{description}</p> : null}
    </div>
  );
}

/** Nút hành động ghim đáy cột (mt-auto chống min-h-full), xếp dọc full-width. */
export function StepFooter({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mt-auto flex flex-col gap-2 pb-2 pt-10">
      {hint ? (
        <p aria-live="polite" className="text-caption text-secondary">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Khung cho mọi bước: rail trái + nội dung cuộn phải. Được hoist lên flow (render
 * một lần) để rail không remount và không replay fade mỗi lần chuyển bước.
 */
export function StepShell({
  currentStep,
  onBack,
  backDisabled,
  onStepChange,
  chromeFooter,
  children,
}: {
  currentStep: OnboardingStep;
  onBack?: () => void;
  backDisabled?: boolean;
  onStepChange?: (step: OnboardingStep) => void;
  chromeFooter?: ReactNode;
  children: ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const fadeStyle = useScrollFade(mainRef);
  return (
    <div className="animate-onboarding-enter flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex min-h-0 flex-1">
        <StepSidebar currentStep={currentStep} onBack={onBack} backDisabled={backDisabled} onStepChange={onStepChange} footer={chromeFooter} />
        <main ref={mainRef} style={fadeStyle} className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", STEP_GUTTER)}>
          <div className={STEP_COLUMN}>
            <StepProgressBar currentStep={currentStep} onBack={onBack} backDisabled={backDisabled} footer={chromeFooter} />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
