"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OnboardingStep } from "@uniwork/core/onboarding";
import { useScrollFade } from "@uniwork/ui/hooks/use-scroll-fade";
import { cn } from "@uniwork/ui/lib/utils";
import { StepProgressBar, StepSidebar } from "./step-sidebar";

/** Một thước đo duy nhất cho mọi bước (28rem). */
export const STEP_COLUMN = "mx-auto flex min-h-full w-full max-w-[28rem] flex-col";
export const STEP_GUTTER = "px-6 py-8 sm:px-10 lg:px-14 lg:py-10";

/**
 * Id của dòng gợi ý ở chân bước. CTA của mỗi bước trỏ `aria-describedby` vào
 * đây: dòng đó là thứ giải thích VÌ SAO nút chưa bấm được, và không có cách nào
 * khác để người dùng bàn phím nghe được nó. Một hằng số dùng chung là đủ — tại
 * mỗi thời điểm chỉ có đúng một StepFooter trong cây.
 */
export const STEP_HINT_ID = "onboarding-step-hint";

/**
 * Tiêu đề bước, đồng thời là đích nhận tiêu điểm khi chuyển bước (xem StepShell).
 * KHÔNG dùng aria-live: vùng live phải có mặt trong DOM trước khi nội dung đổi
 * mới đọc đáng tin, mà tiêu đề thì mount mới theo từng bước. Chuyển tiêu điểm
 * vào đây vừa announce đúng, vừa đặt lại thứ tự Tab về đầu nội dung.
 */
export function StepHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1
        data-step-heading
        tabIndex={-1}
        className="text-balance text-title-lg font-semibold text-primary outline-none"
      >
        {title}
      </h1>
      {description ? <p className="text-pretty text-body text-secondary">{description}</p> : null}
    </div>
  );
}

/** Giữ lại giá trị sau khi nó ngừng đổi trong `delay` ms. */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * Nút hành động ghim đáy cột (mt-auto chống min-h-full), xếp dọc full-width.
 *
 * Hint hiện ngay bằng mắt, nhưng bản ĐỌC cho screen reader đi qua một vùng live
 * cố định và chỉ cập nhật khi chuỗi đã đứng yên: hint của bước Tổ chức/Workspace
 * nội suy tên đang gõ, để nguyên thì mỗi ký tự là một lần đọc lại cả câu.
 */
export function StepFooter({ children, hint }: { children: ReactNode; hint?: string }) {
  const announced = useSettled(hint ?? "", 700);
  return (
    <div className="mt-auto flex flex-col gap-2 pb-2 pt-10">
      {/* `aria-hidden`: bản chữ CHÍNH THỨC của hint là vùng live bên dưới, cũng
          là đích của `aria-describedby` từ CTA. Để cả hai cùng đọc được nghĩa là
          screen reader đọc câu này hai lần — một lần theo thứ tự đọc, một lần
          khi vùng live đổi. */}
      {hint ? <p aria-hidden className="text-caption text-secondary">{hint}</p> : null}
      <span id={STEP_HINT_ID} className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
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
  // Chỉ mờ ở ĐẦU TRÊN. Phần tử cuối của cột luôn là CTA chính của bước, nên vệt
  // mờ ở đáy làm mờ đúng nút quan trọng nhất — và làm mờ cả vòng focus của nó
  // khi người dùng bàn phím vừa Tab tới (WCAG 2.4.11). Tín hiệu "còn nội dung
  // bên dưới" đã có thanh cuộn, vốn đã được nhuộm theo palette ở base.css.
  const fadeStyle = useScrollFade(mainRef, { start: 32, end: 0 });

  // Bấm "Tiếp tục" làm nút đó biến mất khỏi DOM → trình duyệt trả tiêu điểm về
  // <body> → Tab kế tiếp bắt đầu lại từ đầu trang và screen reader không biết đã
  // sang bước khác. Nhận lại tiêu điểm về tiêu đề bước mới.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const main = mainRef.current;
      if (!main) return;
      main.scrollTop = 0;
      // Bước nào tự autoFocus một ô nhập thì nhường — chỉ nhận khi không ai giữ.
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      main.querySelector<HTMLElement>("[data-step-heading]")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [currentStep]);

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
